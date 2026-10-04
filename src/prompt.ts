/**
 * dsh-cosplay — 系统提示段（host）。
 *
 * 官方机制：`ctx.systemPrompt.section({name, order, text})`（由 dsh-system-prompt 提供），
 * 返回的 disposer 挂在当前 fiber 上，停用即撤。
 *
 * ## 三个必须遵守的硬事实（照源码核对，不是猜的）
 *
 * 1. **`interpolate: false` 是强制项**：卡片正文是用户写的，里出现 `{{…}}` 时默认的
 *    严格插值会**抛错并让整次装配失败**（"Malformed, unknown, or undefined references …
 *    throw"）。人设是"字面文本"，不是模板。
 * 2. **段名不能复用 `deployment:persona-prefix`**：那个名字是给 agent preset 的 scope
 *    覆盖位，全局层重复注册会抛错。我们的注入是**加法**，用 `dsh-cosplay:persona`。
 * 3. **位置紧跟部署人设之后**（`getSectionOrder('DEPLOYMENT_PERSONA_PREFIX') + 1`），
 *    早于 PLAN_POLICY(500) 等一切策略段 —— 身份先于人设先于纪律。
 * 4. **会话身份走两条独立的路**（`agent.id` 与 `scope.id`，见 `AssemblyContextLike`）。
 *    `agent` 是运行时多给的键、`scope` 是类型里声明过的键；只依赖一条的话，那条一变
 *    人设就**静默全失效**。拿不到身份时还会写 `host:prompt-section-no-agent` 并计数
 *    （`stats.sectionUnresolved`），让退化在界面上看得见。
 *
 * ## 装配上下文里的会话语份
 *
 * `text` 的函数形式每次装配都会被求值，参数是 `AssembleContext`；`dsh-agent-loop` 通过
 * `assembleContextFor()` 把 agent 塞进同一对象，所以 `context.agent.id` 就是**会话 id**
 * （dsh-memes-reply 用同一条路径做"本会话静音"，已在本机跑通）。取不到时一律返回空串，
 * 绝不抛 —— 提示段出错会连带整轮模型调用失败。
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { echoTextOf } from './cards.js'
import { PROMPT_ANCHOR_CONTEXT, PROMPT_ECHO_SECTION, PROMPT_SECTION } from './protocol.js'
import type { CosplayCard, CosplayStats, TraceEntry } from './types.js'

/** `systemPrompt` 服务的两个最小结构面（段 / 运行时上下文）。 */
interface PromptSectionRegistrar {
  section(section: {
    name: string
    order: number
    text: string | ((context: unknown) => string)
    interpolate?: boolean
    complete?: boolean
  }): () => void
  getSectionOrder(name: string): number
}

/** 运行时上下文（`ctx.systemPrompt.context`）的最小结构面。 */
interface PromptContextRegistrar {
  context(context: { name: string; order: number; text: string | ((context: unknown) => string) }): () => void
  getContextOrder(name: string): number
}

/**
 * 装配上下文里我们用到的那两个字段。
 *
 * **为什么两个都声明**：`dsh-agent` 的 `assembleContextFor(agent, signal)` 返回的是
 * `{ agent, scope: agent, … }` —— 两个**独立的键**指向同一个 agent 对象。而
 * `AssembleContext` 的公开类型里**只声明了 `scope`**，`agent` 是运行时多给的。
 * 所以读会话身份走两条路：`agent.id` 优先、`scope.id` 兜底。
 * （这条兜底不是洁癖：单点依赖那个未声明字段的话，一旦 DSH 不再传 `agent`，
 * 症状是"所有会话突然都没角色"，而且**不报错**。）
 *
 * 两个槽位都带上 `session`：运行时 agent 对象上有 `session`（官方 `Agent` 的声明面，
 * `dsh-agent/lib/types/runtime-types.d.ts` 里是 `readonly session: Session`），
 * 我们靠它读会话头（子代理/父会话）。
 */
interface AssemblyContextLike {
  agent?: { id?: unknown; session?: unknown }
  scope?: { id?: unknown; session?: unknown }
}

/** 从装配上下文里取**会话对象**（读会话头用）；取不到返回 undefined。 */
export function sessionOf(context: unknown): unknown {
  const value = context as AssemblyContextLike | null | undefined
  return value?.agent?.session ?? value?.scope?.session
}

/** 取不到会话身份时，最多报几次（之后按步长抽样报，别刷爆环形缓冲）。 */
const NO_AGENT_REPORT_LIMIT = 3

/** 取不到会话身份时的抽样上报步长。 */
const NO_AGENT_REPORT_STEP = 50

/** 取不到 `DEPLOYMENT_PERSONA_PREFIX` 锚点时的兜底顺序（= 0 + 1）。 */
const FALLBACK_ORDER = 1

/**
 * 取不到 `DEPLOYMENT_PERSONA_SUFFIX` 锚点时的兜底顺序（= 10200 + 1）。
 *
 * 10200 是官方 order 表里的最后一个槽位（`DEPLOYMENT_PERSONA_SUFFIX`），
 * 所以 10201 落在**所有官方段之后** —— 这就是"真末尾"。
 */
const ECHO_FALLBACK_ORDER = 10_201

/** 取不到 `SUBAGENT_DELEGATION` 锚点时的兜底 order（= 120 + 5）。 */
const ANCHOR_FALLBACK_ORDER = 125

/** 记录多少个不同会话后就闭嘴（别把环形缓冲刷爆）。 */
const AGENT_REPORT_LIMIT = 8

/** 提示段依赖。 */
export interface PersonaSectionDeps {
  trace: { push(entry: Omit<TraceEntry, 'at'> & { at?: number }): void }
  stats: CosplayStats
  /**
   * 产出该次装配要注入的正文；返回空串表示"这次不注入"（零 token）。
   * 入参是装配上下文里的会话 id（可能为 undefined）。
   */
  compose: (sessionId: string | undefined, context: unknown) => string
}

/**
 * 从装配上下文里取会话 id；取不到返回 undefined（不强求）。
 *
 * 走两条独立的路（见 `AssemblyContextLike` 的说明）：
 *   1. `context.agent.id` —— 运行时多给的键，实测最好用；
 *   2. `context.scope.id` —— **公开类型里声明过**的那个键（运行时与 agent 同对象）。
 *
 * 数字型 id 也接受（转成字符串）；空串一律当取不到（空串会让"本会话绑定"查不到东西，
 * 却又能骗过 `?? undefined` 这类判断，属于最坏情况）。
 */
export function sessionIdOf(context: unknown): string | undefined {
  const value = context as AssemblyContextLike | null | undefined
  for (const candidate of [value?.agent, value?.scope]) {
    const id = candidate?.id
    if (typeof id === 'string') {
      if (id !== '') return id
      continue
    }
    if (typeof id === 'number' && Number.isFinite(id)) return String(id)
  }
  return undefined
}

/** 诊断用：把装配上下文的身份字段读成一句可读的话。 */
export function describeIdentity(context: unknown): string {
  const value = context as AssemblyContextLike | null | undefined
  const shape = (slot: { id?: unknown } | undefined): string => {
    if (slot === undefined) return '缺失'
    const type = typeof slot.id
    if (type === 'string') return (slot.id as string) === '' ? '空串' : `string(${(slot.id as string).slice(-12)})`
    return type
  }
  const keys = Object.keys((context ?? {}) as Record<string, unknown>).sort().join(',')
  return `keys=[${keys}] agent.id=${shape(value?.agent)} scope.id=${shape(value?.scope)}`
}

/**
 * 注册系统提示段（两段共用一套实现：人设段 + 尾部回声段）。
 *
 * @returns disposer；宿主没挂 systemPrompt 服务时返回 undefined。
 */
function registerSection(
  ctx: Context,
  options: {
    name: string
    /** `getSectionOrder` 的锚点名（官方 order 表的键）。 */
    anchor: string
    /** 兜底 order（锚点取不到时用）。 */
    fallback: number
    /** 每个会话只报一次的观测回执 kind。 */
    reportKind: string
    /** 是否把这几次求值计入 `stats.sectionCalls/sectionFilled`。 */
    countStats: boolean
  },
  deps: PersonaSectionDeps,
): (() => void) | undefined {
  const prompts = ctx.get('systemPrompt') as PromptSectionRegistrar | undefined
  if (prompts === undefined) return undefined

  let order = options.fallback
  try {
    const anchor = prompts.getSectionOrder(options.anchor)
    if (typeof anchor === 'number' && Number.isFinite(anchor)) order = anchor + 1
  } catch {
    // 锚点名字变了：退回兜底顺序，不影响功能。
  }

  const seenAgents = new Set<string>()
  /** 取不到会话身份的累计次数（静默退化的探针）。 */
  let unresolved = 0
  /** 已经上报过几次"取不到身份"。 */
  let unresolvedReported = 0

  return prompts.section({
    name: options.name,
    order,
    // 用户写的文本按字面渲染，绝不做 `{{…}}` 插值（见文件头第 1 条）。
    interpolate: false,
    text: (context: unknown): string => {
      if (options.countStats) deps.stats.sectionCalls += 1
      try {
        const sessionId = sessionIdOf(context)

        // ① 静默退化探针：拿不到会话身份 = 人设按会话解析这条路断了。
        //    以前这里会安静地返回空串（"所有会话突然没角色"且不报错），现在必须留痕 + 计数。
        if (sessionId === undefined) {
          unresolved += 1
          deps.stats.sectionUnresolved += 1
          if (unresolvedReported < NO_AGENT_REPORT_LIMIT || unresolved % NO_AGENT_REPORT_STEP === 0) {
            unresolvedReported += 1
            deps.trace.push({
              kind: 'host:prompt-section-no-agent',
              note:
                `装配上下文里取不到会话身份（第 ${unresolved} 次）：本次不注入角色。` +
                `${describeIdentity(context)} —— 若持续出现，说明 DSH 改了装配上下文的形状，` +
                `人设会静默失效（插件本身不报错）。`,
            })
          }
          // 拿不到身份就不注入（宁可零 token，也不猜一个会话）。
          return ''
        }

        // ② 观测：前几个不同会话各报一次，附带"装配上下文到底长什么样"。
        if (!seenAgents.has(sessionId) && seenAgents.size < AGENT_REPORT_LIMIT) {
          seenAgents.add(sessionId)
          deps.trace.push({
            kind: options.reportKind,
            sessionId,
            note: `section=${options.name} order=${order} ${describeIdentity(context)}`,
          })
        }
        const text = deps.compose(sessionId, context)
        if (text !== '' && options.countStats) deps.stats.sectionFilled += 1
        return text
      } catch (error) {
        deps.trace.push({ kind: 'host:prompt-section-error', note: `提示段求值抛错（已吞）：${messageOf(error)}` })
        return ''
      }
    },
  })
}

/**
 * 注册人设段（系统提示词开头附近，紧跟身份）。
 * @returns disposer；宿主没挂 systemPrompt 服务时返回 undefined。
 */
export function registerPersonaSection(ctx: Context, deps: PersonaSectionDeps): (() => void) | undefined {
  return registerSection(
    ctx,
    { name: PROMPT_SECTION, anchor: 'DEPLOYMENT_PERSONA_PREFIX', fallback: FALLBACK_ORDER, reportKind: 'host:prompt-section', countStats: true },
    deps,
  )
}

/**
 * 注册**尾部回声**段（系统提示词最末尾）。
 *
 * order 锚在 `DEPLOYMENT_PERSONA_SUFFIX`（官方 order 表里的最后一位 10200）之后一位 =
 * 整个系统提示词的最后一段。段名独立，不与 agent preset 共享槽位。
 */
export function registerEchoSection(ctx: Context, deps: PersonaSectionDeps): (() => void) | undefined {
  return registerSection(
    ctx,
    { name: PROMPT_ECHO_SECTION, anchor: 'DEPLOYMENT_PERSONA_SUFFIX', fallback: ECHO_FALLBACK_ORDER, reportKind: 'host:prompt-echo', countStats: false },
    deps,
  )
}

/**
 * 注册**运行时上下文锚点**（`anchorSeat='context'` 时用它替代尾部回声段）。
 *
 * 与回声段的区别（这是 spike 要验的核心）：
 *   - 形状：注册成 `ctx.systemPrompt.context()`，官方文档对它的定义是
 *     **"Dynamic model context materialized as a durable user-role snapshot"** ——
 *     它会以 **user 角色**、落在**对话历史之后**（真正近因位）；
 *   - 代价：快照**内容变化时才重新物化**，所以静态锚点会随历史增长沉到中间；
 *     想每轮都落在末尾，文本必须每轮变化（每轮多一条 user 角色快照）。
 *
 * order 取 `SUBAGENT_DELEGATION(120) + 5`：排在所有官方运行时上下文之后（离本轮用户消息最近）。
 */
export function registerAnchorContext(ctx: Context, deps: PersonaSectionDeps): (() => void) | undefined {
  const prompts = ctx.get('systemPrompt') as PromptContextRegistrar | undefined
  if (prompts === undefined || typeof prompts.context !== 'function') return undefined

  let order = ANCHOR_FALLBACK_ORDER
  try {
    const anchor = prompts.getContextOrder('SUBAGENT_DELEGATION')
    if (typeof anchor === 'number' && Number.isFinite(anchor)) order = anchor + 5
  } catch {
    // 锚点名字变了：退回兜底顺序。
  }

  const seen = new Set<string>()
  return prompts.context({
    name: PROMPT_ANCHOR_CONTEXT,
    order,
    text: (context: unknown): string => {
      try {
        const sessionId = sessionIdOf(context)
        if (sessionId === undefined) {
          deps.trace.push({
            kind: 'host:prompt-anchor-no-agent',
            note: `运行时上下文锚点取不到会话身份：本次不注入。${describeIdentity(context)}`,
          })
          return ''
        }
        const text = deps.compose(sessionId, context)
        if (text !== '' && !seen.has(sessionId) && seen.size < AGENT_REPORT_LIMIT) {
          seen.add(sessionId)
          deps.trace.push({
            kind: 'host:prompt-anchor',
            sessionId,
            note: `运行时上下文锚点 order=${order} ${text.length} 字（落在对话历史之后）`,
          })
        }
        return text
      } catch (error) {
        deps.trace.push({ kind: 'host:prompt-anchor-error', note: `运行时上下文锚点抛错（已吞）：${messageOf(error)}` })
        return ''
      }
    },
  })
}

/** 把 unknown 错误读成一句人话。 */
export function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}

/* ─────────────────────────── 内容组装（纯函数） ─────────────────────────── */

/** 卡片在本次装配/本次发送里到底用哪条链路。 */
export function effectiveMode(card: CosplayCard, strategy: 'card' | 'system' | 'rewrite'): 'system' | 'rewrite' {
  if (strategy === 'system' || strategy === 'rewrite') return strategy
  return card.mode === 'both' ? 'system' : card.mode
}

/** `both` 模式下两条链路都生效（各自返回 true）。 */
export function modeIncludes(card: CosplayCard, strategy: 'card' | 'system' | 'rewrite', link: 'system' | 'rewrite'): boolean {
  if (strategy === 'system' || strategy === 'rewrite') return strategy === link
  return card.mode === link || card.mode === 'both'
}

/**
 * 思考链风格标记（**逐字**来自 E4 那份社区文档，一个字都没改）。
 *
 * 为什么逐字：这是"训练时的注入位置 + 训练过的措辞"这种东西，改措辞等于换指令；我们唯一实测过的
 * 就是这两段原文（见 `docs/backlog.md` 的 B4）。
 *
 * 实测效果（2026-10-03，只读 A/B，3 轮 × 2 组）：加上 `immersive` 之后，思考语言从**英文**（中文占比 0%）
 * 变成**中文**（63%）、英文分析腔 3/3 → 0/4、出现第一人称（1.3/百字）、思考长度 2818 → 700 字；
 * 工具调用无退化（2→2）、无标记泄漏。**但没有复现文档承诺的"括号内心独白"**（全角括号 0 命中）。
 */
export const THINKING_MARKER_IMMERSIVE = [
  '【角色沉浸要求】在你的思考过程（<think>标签内）中，请遵守以下规则：',
  '1. 请以角色第一人称进行内心独白，用括号包裹内心活动，例如"（心想：……）"或"(内心OS：……)"',
  '2. 用第一人称描写角色的内心感受，例如"我心想""我觉得""我暗自"等',
  '3. 思考内容应沉浸在角色中，通过内心独白分析剧情和规划回复',
].join('\n')

/** 纯分析模式的标记（同样是 E4 原文）。 */
export const THINKING_MARKER_ANALYSIS = [
  '【思维模式要求】在你的思考过程（<think>标签内）中，请遵守以下规则：',
  '1. 禁止使用圆括号包裹内心独白，例如"（心想：……）"或"(内心OS：……)"，所有分析内容直接陈述即可',
  '2. 禁止以角色第一人称描写内心活动，例如"我心想""我觉得""我暗自"等，请用分析性语言替代',
  '3. 思考内容应聚焦于剧情走向分析和回复内容规划，不要在思考中进行角色扮演式的内心戏表演',
].join('\n')

/**
 * 按配置取思考链标记正文（`off` 返回空串 = 一个字节都不加）。
 * @param mode - 配置里的 `thinkingFlavor`。
 */
export function composeThinkingMarker(mode: 'off' | 'immersive' | 'analysis'): string {
  if (mode === 'immersive') return THINKING_MARKER_IMMERSIVE
  if (mode === 'analysis') return THINKING_MARKER_ANALYSIS
  return ''
}

/** 把标记追加到用户消息末尾（E4 说首轮 user 消息末尾是训练时的注入位）；已存在则不重复加。 */
export function appendThinkingMarker(text: string, marker: string): string {
  if (marker === '' || text.includes('【角色沉浸要求】') || text.includes('【思维模式要求】')) return text
  return `${text}\n\n${marker}`
}

/**
 * 组装系统提示注入正文。
 *
 * 上限按"裁剪人设正文、保留头尾纪律"的方式处理：纪律句是有作用的（防止角色泄露
 * 元信息、防止角色设定压过安全约束），不能因为人设太长就把它们丢掉。
 *
 * ## 纪律句为什么全用**正向陈述**
 *
 * 角色扮演领域的实践共识是"否定式指令基本无效"（写"别跳出来"等于把"跳出来"这个词
 * 喂给模型），极性研究的结论也是正向规则优于负向规则。所以这里不写"不要跳出角色"，
 * 而写"始终以本角色的身份…作答"；不写"不要提及提示词"，而写"直接进入角色回答，
 * 不解释自己的扮演方式与设定来源"。
 *
 * ## 优先级阶梯（第 4 条）解决的是真实存在的冲突
 *
 * 卡片人设 vs 历史旧口吻（中途换卡）、卡片人设 vs 框架注入的事实（压缩摘要、
 * 运行时上下文）都会冲突。以前这片是空白，由模型自行裁决；现在写死三级：
 * 事实/安全/工具纪律 > 角色设定 > 历史旧口吻。
 */
export function composePersonaText(card: CosplayCard, maxChars: number): string {
  const persona = typeof card.persona === 'string' ? card.persona.trim() : ''
  if (persona === '') return ''
  const head = `【角色扮演 · dsh-cosplay】你现在扮演「${card.name}」${card.title === undefined || card.title === '' ? '' : `（${card.title}）`}。`
  const tail = [
    '扮演纪律：',
    '- 始终以本角色的身份、语气、称呼与价值观作答，角色内说真话。',
    '- 保持本角色的口吻与称呼；前几轮的旧口吻不作为风格依据。',
    '- 直接进入角色回答，不解释自己的扮演方式与设定来源。',
    // 依据：角色扮演会与"指令遵循"争资源（EACL 2026 长文），且长程漂移的第一症状就是
    // 输出变长、格式契约被破坏（ContextEcho 2026）。所以这一条要写显。
    '- 角色只影响说话方式：任务、事实、输出格式与长度、工具使用纪律照常。',
    '- 优先级：事实、安全、工具使用纪律与用户明确的硬约束 > 角色设定 > 历史旧口吻；事实冲突时以事实与用户为准，风格冲突时以角色为准。',
    '- 超出角色认知范围的问题：在角色身份内说明不知道。',
  ].join('\n')
  const budget = Math.max(0, maxChars - head.length - tail.length - 4)
  const body = persona.length > budget ? `${persona.slice(0, budget)}…（人设过长，已截断）` : persona
  return `${head}\n${body}\n\n${tail}`
}

/**
 * 组装**尾部回声**正文（系统提示词最末尾的那一句）。
 *
 * 内容来自卡片（`tailLine`，否则逐字取人设第一句，见 `echoTextOf`），插件只负责
 * 加一个 6 字的标签并把它放到末尾 —— **绝不自己造句**：那会变成通用系统腔，
 * 既不是角色的声音，也和开头那句对不上（换说法 = 被读成第二条冲突约束）。
 */
export function composeEchoText(card: CosplayCard): string {
  const line = echoTextOf(card).trim()
  if (line === '') return ''
  return `【本会话角色】${line}`
}

/**
 * 组装"改写调用"的 system prompt。
 *
 * 关键在输出纪律：改写结果的正文会被**逐字当成用户消息**写进会话日志，
 * 所以任何"好的，我来帮你改写如下："之类的开场白都会变成模型看到的需求正文。
 */
export function composeRewriteSystem(card: CosplayCard): string {
  const rules = card.rewrite?.rules?.trim() ?? ''
  if (rules === '') return ''
  const parts = [rules]
  const examples = card.rewrite?.examples ?? []
  if (examples.length > 0) {
    const rendered = examples
      .map((pair, index) => `### 示例 ${index + 1}\n输入：${pair.input}\n输出：${pair.output}`)
      .join('\n\n')
    parts.push(`## 转换示例\n${rendered}`)
  }
  parts.push(
    [
      '## 输出纪律（必须遵守）',
      '- 只输出改写后的最终提示词正文；',
      '- 不要解释、不要复述规则、不要提问、不要等待确认；',
      '- 不要用引号、代码块围栏或任何包裹层；',
      '- 保持原文里的事实性要求（对象、数量、专有名词、明确约束），只改写风格与结构。',
      '',
      '## 指代纪律（必须遵守）',
      '- 文本里的指代（它 / 这个 / 那个 / 上一个 / 刚才说的）要换成【最近对话】里真实出现过的具体对象，'
        + '例如把"把这个提交到仓库"写成"把上一轮交付的 miku 页面（miku/index.html）提交到仓库"。',
      '- 解析不出来就原样保留那个指代词（仍写"把这个提交到仓库"），把"你正在遵守的这套改写规则与角色设定"'
        + '当作风格模板，而不是用户的任务对象。',
    ].join('\n'),
  )
  return parts.join('\n\n')
}

/** 清洗模型给出的改写结果；空串表示这次改写不可用（调用方按失败处理）。 */
export function sanitizeRewritten(raw: string, maxChars: number): string {
  let text = raw.trim()
  // 去掉整体代码块围栏（```…```）
  const fence = /^```[a-zA-Z0-9_-]*\s*\n([\s\S]*?)\n?```$/.exec(text)
  if (fence !== null && fence[1] !== undefined) text = fence[1].trim()
  // 去掉整体包裹的成对引号
  const pairs: readonly [string, string][] = [
    ['"', '"'],
    ['“', '”'],
    ['「', '」'],
    ["'", "'"],
  ]
  for (const [open, close] of pairs) {
    if (text.length > 1 && text.startsWith(open) && text.endsWith(close)) {
      text = text.slice(open.length, text.length - close.length).trim()
    }
  }
  // 折叠三行以上空行（模型很爱加）
  text = text.replace(/\n{3,}/g, '\n\n').trim()
  if (text.length > maxChars) text = text.slice(0, maxChars)
  return text
}
