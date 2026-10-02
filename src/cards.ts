/**
 * dsh-cosplay — 角色卡的数据层（**纯函数，host 与浏览器半边共用**）。
 *
 * 这个文件是"分享/导入导出"的唯一权威：一个包能不能进库、一张卡长什么样，
 * 全部由这里的规范化决定。两条纪律：
 *
 * 1. **绝不抛**：外部输入（用户手改的 JSON、别人发来的包）一律走 `normalizeCard` /
 *    `validatePack`，把问题收进 `errors[]`，能修的修（裁剪、补默认值），不能修的拒绝。
 *    "导入一个坏包把插件搞崩"是不可接受的失败模式。
 * 2. **规范化是幂等的**：`normalize(normalize(x)) === normalize(x)`，这样"读了写、写了读"
 *    不会每次都产生新 diff（有单测盯着）。
 *
 * 这里**不能** import `node:*`（浏览器半边要用），所以 id 摘要用纯 JS 的 FNV-1a；
 * 立绘字节的 sha256 在 host 侧的 `library.ts` 里算。
 */

import { CARD_ID_RE } from './types.js'
import type { CardMeta, CardMode, CosplayArt, CosplayCard, CosplayCover, CosplayPack, CosplayRewrite } from './types.js'

/** 卡片的硬上限（超出即裁剪，并在 `errors` 里留一句）。 */
export const CARD_LIMITS = {
  name: 24,
  title: 40,
  description: 120,
  tags: 8,
  tag: 12,
  persona: 20_000,
  rules: 20_000,
  examples: 4,
  exampleChars: 4_000,
  /**
   * 尾部回声（`tailLine`）的字数上限。
   *
   * 为什么这么短：这是往系统提示词**最末尾**放的那一句"角色声音"重申。
   * 首尾各说一次只在"**一条**关键约束 + **逐字**"时才有效 —— 一长段就变成
   * 新的规则堆（优先级信号消失），还可能和开头那句被读成两条冲突约束。
   */
  tailLine: 200,
} as const

/** 允许的立绘 MIME。 */
export const ART_MIME: Readonly<Record<string, string>> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
}

/** 合法生效方式。 */
const MODES: readonly CardMode[] = ['system', 'rewrite', 'both']

/** 一条问题（给人看的）。 */
export interface Issue {
  /** 出问题的字段/位置（`cards[2].name` 这种）。 */
  where: string
  message: string
}

/** 规范化结果。 */
export interface Normalized<T> {
  value: T
  issues: Issue[]
}

/** 裁剪字符串：去首尾空白 + 限长。 */
export function clampText(value: unknown, max: number): string {
  if (typeof value !== 'string') return ''
  const text = value.trim()
  return text.length > max ? text.slice(0, max) : text
}

/** 纯 JS FNV-1a（32 位，够做 id 摘要；与 sha256 无关，别混用）。 */
export function fnv1a(text: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

/** 由名字生成 id：ASCII 优先，纯中文等则退到摘要。 */
export function cardIdFromName(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)
  if (slug !== '' && CARD_ID_RE.test(slug)) return slug
  return `c-${fnv1a(name)}`
}

/** 立绘 id（sha256 前 16 位）。 */
export function artIdFromSha(sha256: string): string {
  return `a-${sha256.slice(0, 16)}`
}

/** 合法卡 id 判定（小写字母数字与连字符）。 */
export function isCardId(value: unknown): value is string {
  return typeof value === 'string' && CARD_ID_RE.test(value.trim().toLowerCase())
}

/** 取 id：已有合法 id 就沿用，否则由名字生成，最后兜一个随机尾巴保证唯一。 */
export function resolveCardId(raw: unknown, name: string, taken: ReadonlySet<string>): string {
  const given = typeof raw === 'string' ? raw.trim().toLowerCase() : ''
  let id = CARD_ID_RE.test(given) ? given : cardIdFromName(name)
  if (!taken.has(id)) return id
  for (let index = 2; index < 1000; index++) {
    const candidate = `${id.slice(0, 36)}-${index}`
    if (!taken.has(candidate)) return candidate
  }
  return `${id.slice(0, 30)}-${Date.now().toString(36)}`
}

/**
 * 解析一张卡最终用哪个 id。
 *
 * **显式 id 是身份，派生 id 只是占位** —— 这条区分决定了"导入同一个包两次"的结果：
 *
 * - 包里写了 `id` → 沿用（同 id 就是同一张卡，导入即覆盖）；
 * - 包里没写 id → 由名字派生，并且必须避开 `avoid`（已有库 + 预设 + 同批），
 *   于是永远不会顶掉别人。
 */
export function resolveCardIdFor(raw: unknown, name: string, taken: ReadonlySet<string>, avoid: ReadonlySet<string>): string {
  const given = typeof raw === 'string' ? raw.trim().toLowerCase() : ''
  if (CARD_ID_RE.test(given)) {
    // 显式 id：只跟"同一批里已经用掉的 id"让位（库里的同 id 由调用方决定覆盖）。
    if (!taken.has(given)) return given
    return resolveCardId(given, name, new Set([...taken, ...avoid]))
  }
  return resolveCardId(undefined, name, new Set([...taken, ...avoid]))
}

/** 规范化一个封面。 */
function normalizeCover(raw: unknown): CosplayCover | null {
  if (raw === null || typeof raw !== 'object') return null
  const value = raw as { emoji?: unknown; hue?: unknown }
  const emoji = typeof value.emoji === 'string' ? Array.from(value.emoji.trim()).slice(0, 4).join('') : ''
  const hue = typeof value.hue === 'number' && Number.isFinite(value.hue) ? ((Math.trunc(value.hue) % 360) + 360) % 360 : undefined
  if (emoji === '' && hue === undefined) return null
  return { ...(emoji === '' ? {} : { emoji }), ...(hue === undefined ? {} : { hue }) }
}

/** 规范化一个立绘引用（只认结构；文件是否存在由 library 侧判定）。 */
function normalizeArt(raw: unknown): CosplayArt | null {
  if (raw === null || typeof raw !== 'object') return null
  const value = raw as Partial<CosplayArt>
  const artId = typeof value.artId === 'string' ? value.artId.trim() : ''
  const sha256 = typeof value.sha256 === 'string' ? value.sha256.trim().toLowerCase() : ''
  if (!CARD_ID_RE.test(artId) || !/^[0-9a-f]{64}$/.test(sha256)) return null
  const mime = typeof value.mime === 'string' && value.mime in ART_MIME ? value.mime : 'image/png'
  const bytes = typeof value.bytes === 'number' && Number.isFinite(value.bytes) ? Math.max(0, Math.trunc(value.bytes)) : 0
  return {
    artId,
    mime,
    bytes,
    sha256,
    ...(typeof value.width === 'number' && Number.isFinite(value.width) ? { width: Math.max(0, Math.trunc(value.width)) } : {}),
    ...(typeof value.height === 'number' && Number.isFinite(value.height) ? { height: Math.max(0, Math.trunc(value.height)) } : {}),
  }
}

/** 规范化改写规则。 */
function normalizeRewrite(raw: unknown, issues: Issue[], where: string): CosplayRewrite | null {
  if (raw === null || typeof raw !== 'object') return null
  const value = raw as Partial<CosplayRewrite>
  const rules = clampText(value.rules, CARD_LIMITS.rules)
  if (rules === '') return null
  const examples: { input: string; output: string }[] = []
  if (Array.isArray(value.examples)) {
    for (const [index, item] of value.examples.entries()) {
      if (examples.length >= CARD_LIMITS.examples) {
        issues.push({ where: `${where}.examples`, message: `示例超过 ${CARD_LIMITS.examples} 组，多余的已丢弃` })
        break
      }
      if (item === null || typeof item !== 'object') continue
      const pair = item as { input?: unknown; output?: unknown }
      const input = clampText(pair.input, CARD_LIMITS.exampleChars)
      const output = clampText(pair.output, CARD_LIMITS.exampleChars)
      if (input === '' || output === '') continue
      examples.push({ input, output })
      void index
    }
  }
  const temperature =
    typeof value.temperature === 'number' && Number.isFinite(value.temperature)
      ? Math.min(1, Math.max(0, value.temperature))
      : undefined
  const maxOutputChars =
    typeof value.maxOutputChars === 'number' && Number.isFinite(value.maxOutputChars)
      ? Math.min(CARD_LIMITS.rules, Math.max(200, Math.trunc(value.maxOutputChars)))
      : undefined
  return {
    rules,
    ...(examples.length === 0 ? {} : { examples }),
    ...(temperature === undefined ? {} : { temperature }),
    ...(maxOutputChars === undefined ? {} : { maxOutputChars }),
  }
}

/** 规范化一张卡。 */
export function normalizeCard(
  raw: unknown,
  options: { source?: 'preset' | 'custom'; taken?: ReadonlySet<string>; avoid?: ReadonlySet<string>; now?: number; where?: string } = {},
): Normalized<CosplayCard> {
  const issues: Issue[] = []
  const where = options.where ?? 'card'
  const now = options.now ?? Date.now()
  const value = (raw ?? {}) as Partial<CosplayCard>

  const name = clampText(value.name, CARD_LIMITS.name)
  if (name === '') issues.push({ where: `${where}.name`, message: 'name 为空（必填）' })

  const mode: CardMode = MODES.includes(value.mode as CardMode) ? (value.mode as CardMode) : 'system'
  const persona = clampText(value.persona, CARD_LIMITS.persona)
  const tailLine = clampText(value.tailLine, CARD_LIMITS.tailLine)
  const rewrite = normalizeRewrite(value.rewrite, issues, where)

  if (mode === 'system' && persona === '') issues.push({ where: `${where}.persona`, message: 'mode=system 但没有 persona（这张卡不会生效）' })
  if (mode === 'rewrite' && rewrite === null) issues.push({ where: `${where}.rewrite`, message: 'mode=rewrite 但没有 rewrite.rules（这张卡不会生效）' })

  const tags: string[] = []
  if (Array.isArray(value.tags)) {
    for (const tag of value.tags) {
      const text = clampText(tag, CARD_LIMITS.tag)
      if (text === '' || tags.includes(text)) continue
      if (tags.length >= CARD_LIMITS.tags) {
        issues.push({ where: `${where}.tags`, message: `标签超过 ${CARD_LIMITS.tags} 个，多余的已丢弃` })
        break
      }
      tags.push(text)
    }
  }

  const id = resolveCardIdFor(
    value.id,
    name === '' ? `card-${fnv1a(JSON.stringify(raw))}` : name,
    options.taken ?? new Set(),
    options.avoid ?? new Set(),
  )

  return {
    value: {
      id,
      name: name === '' ? id : name,
      ...(clampText(value.title, CARD_LIMITS.title) === '' ? {} : { title: clampText(value.title, CARD_LIMITS.title) }),
      ...(clampText(value.description, CARD_LIMITS.description) === ''
        ? {}
        : { description: clampText(value.description, CARD_LIMITS.description) }),
      ...(tags.length === 0 ? {} : { tags }),
      cover: normalizeCover(value.cover),
      art: normalizeArt(value.art),
      mode,
      ...(persona === '' ? {} : { persona }),
      ...(tailLine === '' ? {} : { tailLine }),
      rewrite,
      source: value.source === 'preset' || options.source === 'preset' ? 'preset' : 'custom',
      createdAt: typeof value.createdAt === 'number' && Number.isFinite(value.createdAt) ? Math.trunc(value.createdAt) : now,
      updatedAt: typeof value.updatedAt === 'number' && Number.isFinite(value.updatedAt) ? Math.trunc(value.updatedAt) : now,
      version: 1,
    },
    issues,
  }
}

/**
 * 尾部回声的正文（纯函数，便于单测）。
 *
 * 三级取法，**插件自己绝不造句子**：
 *   1. 作者显式写的 `tailLine`；
 *   2. 否则逐字取 `persona` 的**第一句非标题行**（跳过 `#` 开头的 Markdown 标题、
 *      `【` 开头的分节标题、`---` 分隔线）—— 那是作者自己的原话；
 *   3. 都没有 → 空串（调用方据此**不加任何东西**，绝不用通用系统腔填充）。
 *
 * 为什么坚持"逐字"：首尾各说一次只在两次**字面相同**时才被读成同一条约束；
 * 换一种说法会被模型当成**第二条冲突约束**（这是"关键指令首尾复述"这个模式的已知边界）。
 */
export function echoTextOf(card: CosplayCard): string {
  const explicit = clampText(card.tailLine, CARD_LIMITS.tailLine)
  if (explicit !== '') return explicit
  for (const raw of (card.persona ?? '').split('\n')) {
    const line = raw.trim()
    if (line === '' || line === '---') continue
    if (line.startsWith('#') || line.startsWith('【')) continue
    return clampText(line, 120)
  }
  return ''
}

/** 元数据投影（`/library` 用：不带 persona/rewrite 正文，省带宽也省隐私面）。 */export function cardToMeta(card: CosplayCard, artRev: string): CardMeta {
  return {
    id: card.id,
    name: card.name,
    ...(card.title === undefined ? {} : { title: card.title }),
    ...(card.description === undefined ? {} : { description: card.description }),
    ...(card.tags === undefined ? {} : { tags: card.tags }),
    cover: card.cover ?? null,
    hasArt: card.art !== null && card.art !== undefined,
    ...(card.art === null || card.art === undefined ? {} : { artUrl: `/api/dsh-cosplay/art/${card.art.artId}?rev=${artRev}` }),
    mode: card.mode,
    hasPersona: typeof card.persona === 'string' && card.persona !== '',
    hasRewrite: card.rewrite !== null && card.rewrite !== undefined,
    source: card.source,
    updatedAt: card.updatedAt,
  }
}

/** 包解析结果。 */
export interface ParsedPack {
  cards: CosplayCard[]
  /** artId → 内联字节。 */
  art: Record<string, { mime: string; base64: string; sha256: string; width?: number; height?: number }>
  issues: Issue[]
}

/**
 * 解析一个包/库文件。
 *
 * 宽容度刻意设成这样：`cards` 必须是数组（否则整体拒绝），单张卡坏掉只跳过它并记一条，
 * 这样"别人的包里有 9 张好卡 + 1 张坏卡"不会让你一张都拿不到。
 *
 * @param options.taken - 同一个包里已经用掉的 id（内部维护，调用方一般不用传）。
 * @param options.avoid - **派生 id** 必须避开的名字集合（已有库 + 预设）；显式 id 不受它影响。
 */
export function parsePack(
  raw: unknown,
  options: { now?: number; taken?: ReadonlySet<string>; avoid?: ReadonlySet<string> } = {},
): ParsedPack {
  const issues: Issue[] = []
  const value = (raw ?? {}) as Partial<CosplayPack>
  const list = Array.isArray(value.cards) ? value.cards : undefined
  if (list === undefined) {
    issues.push({ where: 'pack', message: 'cards 必须是数组' })
    return { cards: [], art: {}, issues }
  }
  if (value.format !== undefined && value.format !== 'dsh-cosplay-pack') {
    issues.push({ where: 'pack.format', message: `未知的 format=${String(value.format)}（仍尝试按本格式读取）` })
  }

  const art: ParsedPack['art'] = {}
  if (value.art !== null && typeof value.art === 'object') {
    for (const [artId, entry] of Object.entries(value.art as Record<string, unknown>)) {
      if (entry === null || typeof entry !== 'object') continue
      const item = entry as { mime?: unknown; base64?: unknown; sha256?: unknown; width?: unknown; height?: unknown }
      const base64 = typeof item.base64 === 'string' ? item.base64 : ''
      if (base64 === '') {
        issues.push({ where: `art.${artId}`, message: 'base64 为空，已丢弃' })
        continue
      }
      const mime = typeof item.mime === 'string' && item.mime in ART_MIME ? item.mime : 'image/png'
      art[artId] = {
        mime,
        base64,
        sha256: typeof item.sha256 === 'string' ? item.sha256.toLowerCase() : '',
        ...(typeof item.width === 'number' && Number.isFinite(item.width) ? { width: Math.trunc(item.width) } : {}),
        ...(typeof item.height === 'number' && Number.isFinite(item.height) ? { height: Math.trunc(item.height) } : {}),
      }
    }
  }

  const cards: CosplayCard[] = []
  // 本地 id 账本只装"同一个包里已经用掉的 id"；`options.avoid`（已有库 + 预设）只影响
  // **派生 id** 的卡 —— 显式 id 是身份，允许被导入方按 id 覆盖。
  const taken = new Set(options.taken ?? [])
  const avoid = new Set(options.avoid ?? [])
  for (const [index, item] of list.entries()) {
    const rawName = item !== null && typeof item === 'object' ? clampText((item as { name?: unknown }).name, CARD_LIMITS.name) : ''
    if (rawName === '') {
      issues.push({ where: `cards[${index}]`, message: '缺 name，已跳过这张卡' })
      continue
    }
    const normalized = normalizeCard(item, { now: options.now, taken, avoid, where: `cards[${index}]` })
    taken.add(normalized.value.id)
    cards.push(normalized.value)
    issues.push(...normalized.issues)
  }

  return { cards, art, issues }
}

/** 组装一个包（立绘字节由调用方提供 `getArtBytes`）。 */
export function buildPack(
  cards: readonly CosplayCard[],
  getArtBytes: (artId: string) => { bytes: Uint8Array; mime: string; sha256: string } | undefined,
  now = Date.now(),
): CosplayPack {
  const art: CosplayPack['art'] = {}
  for (const card of cards) {
    const ref = card.art
    if (ref === null || ref === undefined || art[ref.artId] !== undefined) continue
    const found = getArtBytes(ref.artId)
    if (found === undefined) continue
    art[ref.artId] = {
      mime: found.mime,
      base64: bytesToBase64(found.bytes),
      sha256: found.sha256,
      ...(ref.width === undefined ? {} : { width: ref.width }),
      ...(ref.height === undefined ? {} : { height: ref.height }),
    }
  }
  return { format: 'dsh-cosplay-pack', version: 1, exportedAt: now, cards: [...cards], art }
}

/** Uint8Array → base64（浏览器与 node 都能用，不引 Buffer）。 */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const step = 0x8000
  for (let offset = 0; offset < bytes.length; offset += step) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + step))
  }
  return btoa(binary)
}

/** base64 → Uint8Array（宿主侧用 `Buffer` 更快，这里保持一致实现）。 */
export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64)
  const out = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) out[index] = binary.charCodeAt(index)
  return out
}

/** 判断字节是否真的是那张图（不信任 mime 声明）。 */
export function sniffImage(bytes: Uint8Array): keyof typeof ART_MIME | undefined {
  if (bytes.length < 12) return undefined
  const at = (index: number): number => bytes[index] ?? 0
  if (at(0) === 0x89 && at(1) === 0x50 && at(2) === 0x4e && at(3) === 0x47) return 'image/png'
  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return 'image/jpeg'
  if (at(0) === 0x47 && at(1) === 0x49 && at(2) === 0x46) return 'image/gif'
  if (at(0) === 0x52 && at(1) === 0x49 && at(2) === 0x46 && at(3) === 0x46 && at(8) === 0x57 && at(9) === 0x45 && at(10) === 0x42 && at(11) === 0x50) {
    return 'image/webp'
  }
  return undefined
}
