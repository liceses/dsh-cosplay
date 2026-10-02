/**
 * dsh-cosplay — 插件自有状态（`<库根>/state.json`，**host only**）。
 *
 * 只存"人按过开关"和"发生过什么"两件事：
 *   - `sessions[sessionId] = { cardId, enabled }` —— 本会话绑了哪张卡、有没有被关掉；
 *   - `rewrites[sessionId] = [ …最近 20 条… ]` —— 改写诊断（模型 / 耗时 / 字数 / 失败原因 /
 *     原文 / 上下文用量；把原文留档，是为了"任务主体被换掉"能在 5 秒内被看出来）；
 *   - `global.lastCardId` —— 最后一次成功绑定的卡（新会话据此自动预选，"换会话不换角色"）。
 *
 * 三条纪律：
 * 1. **坏文件一律当空状态**：一个 json 坏掉绝不能让插件起不来。
 * 2. **原子写**：同目录 tmp + rename（与库文件同款）。
 * 3. **有界**：改写记录每会话 20 条、总量 50 个会话；`preview` 截断 400 字 ——
 *    诊断数据不该长成一个没人管的数据库（正文本身已经在会话日志里了，不必重存）。
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { CosplayState, RewriteRecord, SessionBinding } from './types.js'

/** 每会话保留的改写记录条数。 */
export const REWRITES_PER_SESSION = 20

/** 保留改写记录的会话数上限（超出丢最久没更新的）。 */
export const REWRITE_SESSIONS = 50

/** 记录里预览的长度上限。 */
const PREVIEW_CHARS = 400

/** 每个会话记住"用过哪几张卡"的上限（够判断"换过卡"，不必留全史）。 */
export const CARD_SEEN_LIMIT = 4

/** 空状态。 */
export function emptyState(): CosplayState {
  return { version: 1, sessions: {}, rewrites: {}, global: {} }
}

/** 宽松解析：任何异常都退化成空状态。 */
export function parseState(raw: unknown): CosplayState {
  if (raw === null || typeof raw !== 'object') return emptyState()
  const value = raw as Partial<CosplayState>
  const sessions: Record<string, SessionBinding> = {}
  if (value.sessions !== null && typeof value.sessions === 'object') {
    for (const [sessionId, entry] of Object.entries(value.sessions)) {
      if (entry === null || typeof entry !== 'object') continue
      const item = entry as Partial<SessionBinding>
      sessions[sessionId] = {
        cardId: typeof item.cardId === 'string' && item.cardId !== '' ? item.cardId : null,
        enabled: item.enabled !== false,
        updatedAt: typeof item.updatedAt === 'number' && Number.isFinite(item.updatedAt) ? Math.trunc(item.updatedAt) : 0,
        ...(Array.isArray(item.cardsSeen)
          ? { cardsSeen: item.cardsSeen.filter((id): id is string => typeof id === 'string' && id !== '').slice(0, CARD_SEEN_LIMIT) }
          : {}),
      }
    }
  }
  const rewrites: Record<string, RewriteRecord[]> = {}
  if (value.rewrites !== null && typeof value.rewrites === 'object') {
    for (const [sessionId, list] of Object.entries(value.rewrites)) {
      if (!Array.isArray(list)) continue
      rewrites[sessionId] = list
        .filter((item): item is RewriteRecord => item !== null && typeof item === 'object')
        .slice(0, REWRITES_PER_SESSION)
    }
  }
  return {
    version: 1,
    sessions,
    rewrites,
    global: value.global !== null && typeof value.global === 'object' ? { ...value.global } : {},
  }
}

/** 状态仓库。 */
export interface StateStore {
  readonly file: string
  /** 取整份状态（内存里的一份，直接读）。 */
  read(): CosplayState
  /** 取某会话的绑定（没有就 undefined）。 */
  binding(sessionId: string): SessionBinding | undefined
  /** 写某会话的绑定（只写传进来的字段）。 */
  setBinding(sessionId: string, patch: { cardId?: string | null; enabled?: boolean }): SessionBinding
  /** 清掉某会话的绑定（会话被删/重置时用）。 */
  clearBinding(sessionId: string): void
  /** 记一条改写。 */
  recordRewrite(sessionId: string, record: Omit<RewriteRecord, 'preview'> & { preview: string }): void
  /** 读某会话的改写记录（最新在前）。 */
  rewritesOf(sessionId: string, limit?: number): RewriteRecord[]
  /** 最后一次成功绑定的卡 id（新会话据此自动预选；空 = 没有）。 */
  lastCardId(): string
  /** 立即落盘（写操作已自动串行化，这里给诊断/关闭路径用）。 */
  save(): void
}

/** 建状态仓库。 */
export function createState(file: string, now: () => number = () => Date.now()): StateStore {
  let state: CosplayState = emptyState()

  try {
    if (existsSync(file)) state = parseState(JSON.parse(readFileSync(file, 'utf8')) as unknown)
  } catch {
    state = emptyState()
  }

  const save = (): void => {
    try {
      mkdirSync(dirname(file), { recursive: true })
      const tmp = `${file}.tmp`
      writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
      renameSync(tmp, file)
    } catch {
      // 状态丢失只会让用户重按一次开关，不值得让整轮对话失败。
    }
  }

  /** 修剪改写记录的规模。 */
  const prune = (): void => {
    const ids = Object.keys(state.rewrites)
    if (ids.length <= REWRITE_SESSIONS) return
    const byRecency = ids
      .map((sessionId) => {
        const list = state.rewrites[sessionId] ?? []
        const last = list[0]?.at ?? 0
        return { sessionId, last }
      })
      .sort((left, right) => right.last - left.last)
    for (const { sessionId } of byRecency.slice(REWRITE_SESSIONS)) delete state.rewrites[sessionId]
  }

  return {
    file,

    read: () => state,

    binding(sessionId) {
      return state.sessions[sessionId]
    },

    setBinding(sessionId, patch) {
      const existing = state.sessions[sessionId]
      const next: SessionBinding = {
        cardId: patch.cardId === undefined ? (existing?.cardId ?? null) : patch.cardId,
        enabled: patch.enabled === undefined ? (existing?.enabled ?? true) : patch.enabled,
        updatedAt: now(),
        ...(existing?.cardsSeen === undefined ? {} : { cardsSeen: [...existing.cardsSeen] }),
      }
      state.sessions[sessionId] = next
      // "最近用过的卡"与"本会话用过哪些卡"只在**真的选了某张卡**时更新
      // （停用 / 清空不动它们）——新会话据此自动预选，且据此判断"换过卡"。
      if (typeof patch.cardId === 'string' && patch.cardId !== '') {
        state.global = { ...state.global, lastCardId: patch.cardId }
        const seen = (existing?.cardsSeen ?? []).filter((id) => id !== patch.cardId)
        next.cardsSeen = [patch.cardId, ...seen].slice(0, CARD_SEEN_LIMIT)
      }
      save()
      return next
    },

    clearBinding(sessionId) {
      if (state.sessions[sessionId] !== undefined) {
        delete state.sessions[sessionId]
        save()
      }
    },

    recordRewrite(sessionId, record) {
      const list = state.rewrites[sessionId] ?? []
      const preview = record.preview.length > PREVIEW_CHARS ? `${record.preview.slice(0, PREVIEW_CHARS)}…` : record.preview
      list.unshift({ ...record, preview })
      state.rewrites[sessionId] = list.slice(0, REWRITES_PER_SESSION)
      prune()
      save()
    },

    rewritesOf(sessionId, limit) {
      const list = state.rewrites[sessionId] ?? []
      return limit === undefined ? list : list.slice(0, Math.max(0, limit))
    },

    lastCardId() {
      const value = state.global.lastCardId
      return typeof value === 'string' ? value : ''
    },

    save,
  }
}
