/**
 * dsh-cosplay — 改写调用的**对话上下文**（宿主侧，纯函数）。
 *
 * ## 为什么需要这个文件
 *
 * 改写调用是**无状态**的：它只拿到"这一轮原文"与"卡片规则"。于是
 *
 * > 兄弟 太夯了，看的我硬邦邦！！！ 想让更多人硬邦邦，**把这个**提交到我的仓库吧！！
 *
 * 里的"这个"没有指代对象 —— 而改写调用的上下文里**唯一存在的名词就是卡片规则本身**
 * （"硬邦邦提示词转换专家"），模型于是合理地把它填了进去，任务主体被整条换掉，
 * 主模型随后真的去建了一个错的仓库。这不是模型不行，是我们没给它看懂指代所需的信息。
 *
 * ## 取什么、怎么取
 *
 * 走**官方 surface**（和 `dsh-compaction-basic` 取摘要输入的做法一致）：
 * `agent.session.surface.nodes` → `session.eventAt(seq)`。用 surface 而不是裸日志，
 * 是因为**压缩之后** surface 里是摘要节点，裸日志里的原文可能已被 shadow。
 *
 * 只收两类，其余一律排除：
 *   - `user/message` 且 `data.source.kind === 'user'` —— **人**说的话；
 *   - `assistant/message` 的 **text 块**（丢掉 reasoning）。
 *
 * 必须排除的噪声（实测它们的体积与误导性都很高，本会话里 `skills` 一条就 9718 字）：
 * `runtime-context` / `skills` / `tool-jobs` / `agent-message` / `subagent-settled` /
 * `user-approval` 等 —— 它们是框架注入与子代理播报，不是"人说的话"。
 *
 * ## 组装成什么样
 *
 * 组装成**一条** user 消息，分区明确（`renderRewriteInput`）。为什么不拆成多条：
 * 多条历史会让模型把"上下文"当成"要改写的内容"，甚至改写历史本身。
 */

/** 一条上下文消息（只保留人话与助手话）。 */
export interface ContextTurn {
  role: 'user' | 'assistant'
  text: string
}

/**
 * 事件的最小结构（只声明我们真正读的字段）。
 *
 * 结构化而非 import `dsh-session` 的类型，是为了让这个模块**不依赖宿主**、
 * 能被 node 直接单测（测试里喂普通对象即可）。
 */
export interface ContextEventLike {
  type: string
  data?: unknown
}

/** 取上下文时的参数。 */
export interface CollectOptions {
  /** surface 节点（seq），按时间正序。 */
  nodes: readonly number[]
  /** 取事件（一般是 `session.eventAt`）。 */
  eventAt(seq: number): ContextEventLike | undefined
  /** 最多带多少条消息（默认 6 条 ≈ 3 轮）。0 或负数 = 不带上下文。 */
  maxTurns: number
  /** 单条消息的字数上限（默认 800）。 */
  maxCharsPerMessage?: number
  /** 全部上下文的字数上限（默认 2400）。 */
  maxCharsTotal?: number
  /** 排除这条消息（按 id；防止把"本轮要改写的原文"当成历史）。 */
  excludeMessageId?: string
}

/** 默认上限（与 README 的配置表一致）。 */
export const CONTEXT_DEFAULTS = {
  maxCharsPerMessage: 800,
  maxCharsTotal: 2400,
} as const

/** 从事件里取文本（只认 text 块，丢掉 reasoning / tool 调用）。 */
export function textOfEvent(event: ContextEventLike): string {
  const data = (event.data ?? {}) as Record<string, unknown>
  const message = (data.content !== undefined ? data : (data.message ?? {})) as { content?: unknown }
  const content = Array.isArray(message.content) ? message.content : []
  const parts: string[] = []
  for (const block of content) {
    if (block === null || typeof block !== 'object') continue
    const typed = block as { type?: unknown; text?: unknown }
    if (typed.type !== 'text') continue
    if (typeof typed.text === 'string') parts.push(typed.text)
  }
  return parts.join('')
}

/** 事件的来源 kind（`user/message` 与 `assistant/message` 都在 data.source 上）。 */
export function sourceKindOf(event: ContextEventLike): string {
  const data = (event.data ?? {}) as Record<string, unknown>
  const direct = (data.source ?? {}) as { kind?: unknown }
  if (typeof direct.kind === 'string') return direct.kind
  const nested = ((data.message ?? {}) as { source?: { kind?: unknown } }).source
  return typeof nested?.kind === 'string' ? nested.kind : ''
}

/** 事件的 id（用于排除"本轮那条"）。 */
function idOf(event: ContextEventLike): string {
  const data = (event.data ?? {}) as Record<string, unknown>
  const id = data.id ?? (data.message as { id?: unknown } | undefined)?.id
  return typeof id === 'string' ? id : ''
}

/** 这条事件是不是"人说的话"。 */
function isHumanMessage(event: ContextEventLike): boolean {
  return event.type === 'user/message' && sourceKindOf(event) === 'user'
}

/** 这条事件是不是助手的正文。 */
function isAssistantMessage(event: ContextEventLike): boolean {
  return event.type === 'assistant/message'
}

/**
 * 超长消息的裁剪：**保头也保尾**，中间打省略标记。
 *
 * 两头都留是有理由的：助手消息通常**开头**点名交付物（"## 东西在哪 - 页面本体：miku/index.html"），
 * 结尾常有结论；只留一头会丢掉指代消解最需要的那一侧。
 */
export function trimMessage(text: string, max: number): string {
  if (text.length <= max) return text
  const head = Math.max(1, Math.floor(max * 0.6))
  const tail = Math.max(1, max - head)
  return `${text.slice(0, head)}…（中略）…${text.slice(text.length - tail)}`
}

/**
 * 收集最近对话（时间正序返回）。
 *
 * 从末尾往前取满 `maxTurns` 条，并在超出 `maxCharsTotal` 时**丢掉更早的**（保留最近的）。
 * 至少会带上最靠近当前的那一条（哪怕它自己就超了总预算，也会被单条上限裁过）。
 */
export function collectRewriteContext(options: CollectOptions): ContextTurn[] {
  // 非有限值（配置缺失/NaN）一律当"不带上下文"——安全方向的默认，不是"尽可能多带"。
  const maxTurns = Number.isFinite(options.maxTurns) ? Math.max(0, Math.trunc(options.maxTurns)) : 0
  if (maxTurns === 0) return []
  const perMessage = Math.max(1, options.maxCharsPerMessage ?? CONTEXT_DEFAULTS.maxCharsPerMessage)
  const total = Math.max(1, options.maxCharsTotal ?? CONTEXT_DEFAULTS.maxCharsTotal)

  const picked: ContextTurn[] = []
  let used = 0
  for (let index = options.nodes.length - 1; index >= 0 && picked.length < maxTurns; index -= 1) {
    const seq = options.nodes[index]
    if (typeof seq !== 'number') continue
    const event = options.eventAt(seq)
    if (event === undefined) continue
    const human = isHumanMessage(event)
    if (!human && !isAssistantMessage(event)) continue
    if (options.excludeMessageId !== undefined && options.excludeMessageId !== '' && idOf(event) === options.excludeMessageId) continue
    const raw = textOfEvent(event).trim()
    if (raw === '') continue
    const text = trimMessage(raw, perMessage)
    if (picked.length > 0 && used + text.length > total) continue
    used += text.length
    picked.push({ role: human ? 'user' : 'assistant', text })
  }
  picked.reverse()
  return picked
}

/**
 * 指代词检测（守卫用）。
 *
 * 只匹配**真的需要前文**才能解析的说法；`它` 用后视断言排除"其他/其它"，
 * 避免把大量正常句子误判成"有指代"。
 */
export function hasUnresolvedReference(text: string): boolean {
  return /(?<!其)它|这个|那个|这些|那些|上一[轮次句步条]|刚才|这套|该(仓库|项目|文件|页面|网站)|此(仓库|项目|文件|页面|网站)/.test(text)
}

/** 分区标记（测试与文档都引用它，别改成别的写法）。 */
export const CONTEXT_HEADER = '【最近对话（只用来判断"这个/它/上一轮"指什么；不要改写这里，也不要把它抄进结果）】'
export const CONTEXT_EMPTY = '【最近对话】暂无可用上下文（遇到无法解析的指代就原样保留，不要自己发明对象）'
export const DEMAND_HEADER = '【本轮要改写的原始需求（只改这一段）】'

/**
 * 把上下文与本轮原文组装成**一条** user 消息。
 * @param original - 用户这一轮的原文（逐字放在最后一段，不得改动）。
 * @param context - `collectRewriteContext` 的结果（空数组 = 没有上下文）。
 * @param cwd - 当前工作目录（可选；"提交到仓库"这类任务需要知道是哪个工作区）。
 */
export function renderRewriteInput(original: string, context: readonly ContextTurn[], cwd?: string): string {
  const lines: string[] = []
  if (context.length === 0) {
    lines.push(CONTEXT_EMPTY)
  } else {
    lines.push(CONTEXT_HEADER)
    if (cwd !== undefined && cwd !== '') lines.push(`（当前工作目录：${cwd}）`)
    for (const turn of context) lines.push(`${turn.role === 'user' ? '用户' : '助手'}：${turn.text}`)
  }
  lines.push('', DEMAND_HEADER, original)
  return lines.join('\n')
}
