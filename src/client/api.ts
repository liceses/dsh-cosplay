/**
 * dsh-cosplay — 浏览器半边与宿主的数据通道。
 *
 * 一律走本插件自己的同源路由（实测匿名可达、只认回环 Host）：
 *   GET  /api/dsh-cosplay/library · /card/<id> · /art/<artId> · /binding · /diagnostics · /stats · /trace
 *   POST /api/dsh-cosplay/card · /card/copy · /card/delete · /art · /import · /export/write · /binding · /rewrite · /debug
 *
 * **浏览器控制台宿主看不到** —— 所以关键动作都要 `postDebug` 回传宿主，
 * 否则"页签为什么没出来"在宿主侧完全不可观测（dsh-memes-reply 的教训）。
 */

import { DEBUG_PATH, LIBRARY_PATH, ROUTE_PREFIX, STATS_PATH, TRACE_PATH } from '../protocol.js'
import type { CardMeta, CosplayArt, CosplayCard, CosplayPack, ImportResult } from '../types.js'

/** 同源 JSON GET；失败返回 undefined（调用方降级显示，绝不抛）。 */
export async function getJson<T>(path: string): Promise<T | undefined> {
  try {
    const response = await fetch(path, { headers: { accept: 'application/json' } })
    if (!response.ok) return undefined
    return (await response.json()) as T
  } catch {
    return undefined
  }
}

/** 同源 JSON POST；失败返回 undefined。 */
export async function postJson<T>(path: string, body: unknown): Promise<T | undefined> {
  try {
    const response = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    const text = await response.text()
    try {
      return JSON.parse(text) as T
    } catch {
      return undefined
    }
  } catch {
    return undefined
  }
}

/* ─────────────────────────────── 卡片库 ─────────────────────────────── */

/** `/library` 的响应。 */
export interface LibraryResponse {
  ok: boolean
  root: string
  info: { root: string; cards: number; presets: number; customs: number; artFiles: number; bytes: number }
  cards: CardMeta[]
  /**
   * 最后一次成功绑定的卡 id（空 = 没有）。
   *
   * 新会话 chip 在没有显式绑定时自动预选它 —— "换会话不换角色"。
   * 优先级：显式绑定 > lastCardId > `config.defaultCardId`。
   */
  lastCardId?: string
  config: {
    enabled: boolean
    strategy: 'card' | 'system' | 'rewrite'
    defaultCardId: string
    coverAspect: number
    artMaxEdge: number
    artQuality: number
  }
  ts: number
}

/** 读卡片库（元数据投影）。 */
export function fetchLibrary(): Promise<LibraryResponse | undefined> {
  return getJson<LibraryResponse>(LIBRARY_PATH)
}

/** 读单卡全文。 */
export function fetchCard(id: string): Promise<{ ok: boolean; card: CosplayCard } | undefined> {
  return getJson(`${ROUTE_PREFIX}/card/${encodeURIComponent(id)}`)
}

/** 新建/更新一张自定义卡。 */
export function saveCard(card: Partial<CosplayCard>): Promise<{ ok: boolean; card: CosplayCard | null; issues: { where: string; message: string }[] } | undefined> {
  return postJson(`${ROUTE_PREFIX}/card`, { card })
}

/** 复制为自定义卡。 */
export function copyCard(id: string, overrides: Record<string, unknown> = {}): Promise<{ ok: boolean; card: CosplayCard | null; issues: { where: string; message: string }[] } | undefined> {
  return postJson(`${ROUTE_PREFIX}/card/copy`, { id, overrides })
}

/** 删除一张自定义卡。 */
export function deleteCard(id: string): Promise<{ ok: boolean } | undefined> {
  return postJson(`${ROUTE_PREFIX}/card/delete`, { id })
}

/** 存一张立绘（base64，不带 data URL 前缀）。 */
export function uploadArt(input: { base64: string; width?: number; height?: number }): Promise<{ ok: boolean; art: CosplayArt | null; issues: { where: string; message: string }[] } | undefined> {
  return postJson(`${ROUTE_PREFIX}/art`, input)
}

/* ─────────────────────────────── 分享 ─────────────────────────────── */

/** 导出包（默认全部卡）。 */
export function exportPack(ids?: string[]): Promise<CosplayPack | undefined> {
  const query = ids === undefined || ids.length === 0 ? '' : `?ids=${encodeURIComponent(ids.join(','))}`
  return getJson<CosplayPack>(`${ROUTE_PREFIX}/export${query}`)
}

/** 导出并落盘到 `<库根>/exports/`，返回绝对路径。 */
export function exportWrite(ids?: string[]): Promise<{ ok: boolean; path: string; cards: number; art: number; error?: string } | undefined> {
  return postJson(`${ROUTE_PREFIX}/export/write`, ids === undefined ? {} : { ids })
}

/** 导入包。 */
export function importPack(pack: unknown): Promise<ImportResult | undefined> {
  return postJson<ImportResult>(`${ROUTE_PREFIX}/import`, { pack })
}

/* ─────────────────────────────── 本会话 ─────────────────────────────── */

/** `/binding` 的响应。 */
export interface BindingResponse {
  ok: boolean
  sessionId: string
  binding: { cardId: string | null; enabled: boolean; updatedAt: number; cardsSeen?: string[] }
  card: CardMeta | null
  rewrites: {
    messageId: string
    turn: number
    at: number
    cardId: string
    model: string
    ok: boolean
    ms: number
    inChars: number
    outChars: number
    /** 用户这一轮的原文（≤4000 字）；老记录可能没有。 */
    original?: string
    /** 这次改写带了几条对话上下文。 */
    contextTurns?: number
    /** 上下文一共多少字。 */
    contextChars?: number
    error?: string
    preview: string
  }[]
}

/** 读本会话绑定。 */
export function fetchBinding(sessionId: string): Promise<BindingResponse | undefined> {
  if (sessionId === '') return Promise.resolve(undefined)
  return getJson<BindingResponse>(`${ROUTE_PREFIX}/binding?sessionId=${encodeURIComponent(sessionId)}`)
}

/** 写本会话绑定。 */
export function putBinding(sessionId: string, patch: { cardId?: string | null; enabled?: boolean }): Promise<{ ok: boolean; binding: { cardId: string | null; enabled: boolean } } | undefined> {
  return postJson(`${ROUTE_PREFIX}/binding`, { sessionId, ...patch })
}

/** 手动改写一次（预览用）。 */
export function rewriteOnce(input: { sessionId: string; cardId: string; text: string }): Promise<
  | { ok: boolean; text: string; model: string; ms: number; error: string; cached: boolean; cardName: string }
  | undefined
> {
  return postJson(`${ROUTE_PREFIX}/rewrite`, input)
}

/* ─────────────────────────────── 诊断 ─────────────────────────────── */

/** `/stats` 的响应。 */
export interface StatsResponse {
  ok: boolean
  plugin: string
  stats: {
    sectionCalls: number
    sectionFilled: number
    preStepCalls: number
    preStepRewrote: number
    durableUserMessages: number
    rewrite: { calls: number; ok: number; failed: number; cached: number; lastMs: number; lastModel: string }
  }
  config: Record<string, unknown>
  probe: { armed: boolean; sessions: string[]; touched: string[] }
  trace: { size: number; capacity: number }
  ts: number
}

/** 读状态行。 */
export function fetchStats(): Promise<StatsResponse | undefined> {
  return getJson<StatsResponse>(STATS_PATH)
}

/** `/trace` 的响应。 */
export interface TraceResponse {
  ok: boolean
  capacity: number
  size: number
  entries: { at: number; kind: string; sessionId?: string; turn?: number; id?: string; note: string }[]
}

/** 读诊断轨迹。 */
export function fetchTrace(limit = 40): Promise<TraceResponse | undefined> {
  return getJson<TraceResponse>(`${TRACE_PATH}?limit=${String(limit)}`)
}

/** `/diagnostics` 的响应。 */
export interface DiagnosticsResponse {
  ok: boolean
  stats: StatsResponse['stats']
  info: LibraryResponse['info']
  orphans: number
  sessionId?: string
  rewrites?: BindingResponse['rewrites']
  trace: TraceResponse['entries']
}

/** 读诊断（设置页用）。 */
export function fetchDiagnostics(sessionId = ''): Promise<DiagnosticsResponse | undefined> {
  const query = sessionId === '' ? '' : `?sessionId=${encodeURIComponent(sessionId)}`
  return getJson<DiagnosticsResponse>(`${ROUTE_PREFIX}/diagnostics${query}`)
}

/** 清理无引用立绘。 */
export function pruneArt(): Promise<{ ok: boolean; removed: number } | undefined> {
  return postJson(`${ROUTE_PREFIX}/art/prune`, {})
}

/**
 * 客户端回执：关键动作回传宿主（进环形缓冲，`/trace` 可读）。
 * 一律 fire-and-forget，失败静默 —— 诊断绝不能影响功能。
 */
export function postDebug(entry: { kind: string; sessionId?: string; turn?: number; id?: string; note?: string }): void {
  try {
    void fetch(DEBUG_PATH, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(entry),
      keepalive: true,
    }).catch(() => {})
  } catch {
    // 忽略
  }
}
