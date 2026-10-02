/**
 * dsh-cosplay — `agent/pre-step` 拦截（host）：**改写卡**的那条链路。
 *
 * ## 为什么是这个事件
 *
 * 官方事件契约（`dsh-agent/lib/types/runtime-types.d.ts`）：
 * > Reject a proposed step or replace the messages that enter it.
 * > Calling `next()` preserves the current messages.
 *
 * 它是**唯一**能在模型看到之前替换用户消息的官方通道；而且被替换后的消息会被
 * `dsh-agent-loop` 真实地 durable 写进会话日志：
 *
 * ```js
 * // dsh-agent-loop/lib/index.js:1061
 * if (firstAttempt) for (const message of decision.messages) this.session.append("user/message", message, { surfaceOp: "append" })
 * ```
 *
 * 也就是说：**「对话」里那条用户消息本身就是改写后的 prompt**，模型收到的与日志逐字一致。
 * 这是"改写型角色卡"的全部立足点（M0 探针已在真实浏览器+真实模型上验证过这条链）。
 *
 * ## 五条纪律（每一条都有代价换来的理由）
 *
 * 1. **先 `await next()`**：默认决策里带着 `runtimeContext.project()` 产出的动态上下文
 *    消息（见同一文件 :910-918）。自己造 `{kind:'enter', messages:[...]}` 会把它丢掉，
 *    模型就看不到沙箱/审批策略那一段。
 * 2. **只改 `role==='user'` 且 `source.kind==='user'`**：会话日志里同样是 user 角色的消息
 *    还有 system-reminder / skills 清单 / runtime-context 等一大票，动它们等于篡改框架注入；
 *    而历史里的 assistant/tool 消息是模型自己的产物。`source.kind==='user'` 是 M0 实测值
 *    （`host:pre-step-message role=user source.kind=user`）。
 * 3. **按 message.id 幂等**：同一个消息被再次提出（重试/补步）时复用上一次结果，
 *    绝不重复调用模型、也不重复计费。
 * 4. **绝不抛**：钩子里抛错会打断整轮对话。任何异常都退回原样决策并留一条诊断。
 * 5. **失败按配置回落**：默认 `original`（用原文继续，用户只是没拿到风格改写），
 *    可配成 `block`（拒绝这一步）——那条路会打断本轮，所以默认关着。
 */

import type { Context } from '@deepseek-ai/cordis'
import type { ContentBlock, UserMessage } from '@deepseek-ai/dsh-llm/types'
import type {} from '@deepseek-ai/dsh-agent'
import type { CosplayConfig } from './config.js'
import { effectiveCardId } from './bindings.js'
import { collectRewriteContext, hasUnresolvedReference, renderRewriteInput, type ContextTurn } from './context.js'
import { modeIncludes } from './prompt.js'
import { messageOf } from './prompt.js'
import type { ProbeRuntime } from './route.js'
import type { Library } from './library.js'
import type { StateStore } from './state.js'
import type { RewriteResult } from './rewrite.js'
import type { CosplayCard, CosplayStats, TraceEntry } from './types.js'

/** 默认决策的形状（只声明我们用到的字段）。 */
type PreStepDecisionLike =
  | { kind: 'reject' }
  | { kind: 'enter'; messages: UserMessage[]; startsRequestSeries?: true }

/** 会话的最小结构面（官方 surface API —— `dsh-compaction-basic` 取摘要输入用的同一组）。 */
interface SessionLike {
  surface?: { nodes?: readonly number[] }
  eventAt?(seq: number): { type: string; data?: unknown } | undefined
  header?: { cwd?: unknown }
}

/** 钩子载荷。 */
interface PreStepPayload {
  agent: { id: unknown; session?: SessionLike }
  messages: UserMessage[]
  turn: number
  step: number
  signal: AbortSignal
}

/** 观测到多少个不同 (会话, 消息) 后就闭嘴（别把环形缓冲刷爆）。 */
const OBSERVE_LIMIT = 24

/** 改写记录里保留的原文长度上限（够看清"主体有没有被换掉"）。 */
const REWRITE_ORIGINAL_LIMIT = 4000

/** 把一条消息里的文本块拼起来。 */
export function textOfMessage(message: { content?: readonly ContentBlock[] } | undefined): string {
  const content = message?.content
  if (!Array.isArray(content)) return ''
  let text = ''
  for (const block of content) {
    if (block !== null && typeof block === 'object' && (block as { type?: unknown }).type === 'text') {
      const value = (block as { text?: unknown }).text
      if (typeof value === 'string') text += value
    }
  }
  return text
}

/**
 * 用新文本替换一条用户消息里的文本块，**保留**图片/文件等非文本块。
 *
 * 文本放在最前（改写 prompt 是任务本体），附件块保持原顺序跟在后面。
 */
export function replaceUserText(message: UserMessage, text: string): UserMessage {
  const content = Array.isArray(message.content) ? message.content : []
  const rest = content.filter(
    (block) => !(block !== null && typeof block === 'object' && (block as { type?: unknown }).type === 'text'),
  )
  return { ...message, content: [{ type: 'text', text } as ContentBlock, ...rest] }
}

/** 一条消息的来源种类。 */
export function sourceKindOf(message: UserMessage): string {
  const source = (message as { source?: { kind?: unknown } }).source
  return typeof source?.kind === 'string' ? source.kind : ''
}

/** 内容块的种类列表（诊断用）。 */
function blockKindsOf(message: UserMessage): string {
  const content = Array.isArray(message.content) ? message.content : []
  return content.map((block) => String((block as { type?: unknown }).type ?? '?')).join('+')
}

/** 改写判定结果。 */
export type RewriteOutcome = { kind: 'text'; text: string } | { kind: 'keep' } | { kind: 'block'; error: string }

/** pre-step 装配依赖。 */
export interface PreStepDeps {
  trace: { push(entry: Omit<TraceEntry, 'at'> & { at?: number }): void }
  stats: CosplayStats
  config: () => CosplayConfig
  library: () => Library
  state: () => StateStore
  /** M0 探针（保留为自检工具：武装 + 消息带标记时才动手）。 */
  probe: ProbeRuntime
  /** 真正调用模型的地方（`input` 是组装好的"上下文 + 原文"）。 */
  rewrite: (request: {
    card: CosplayCard
    input: string
    sessionId: string
    signal: AbortSignal
  }) => Promise<RewriteResult>
}

/**
 * 装上 pre-step 钩子。
 * @returns disposer（`ctx.on` 返回的那个，插件卸载自动摘掉）。
 */
export function installPreStepHook(ctx: Context, deps: PreStepDeps): () => void {
  /** messageId → 已改写文本（幂等 + 不重复计费）。 */
  const cache = new Map<string, string>()
  const observed = new Set<string>()
  const warned = new Set<string>()

  /** 决定这条消息要不要改写。 */
  const decide = async (input: {
    sessionId: string
    message: UserMessage
    text: string
    turn: number
    signal: AbortSignal
    session?: SessionLike
  }): Promise<RewriteOutcome> => {
    const cfg = deps.config()
    if (!cfg.enabled) return { kind: 'keep' }

    // 1) M0 探针优先（自检路径；只在武装时生效）。
    if (deps.probe.armed) {
      const marker = input.text.includes('cosplay-probe-marker')
      if (marker) {
        deps.probe.touched.add(input.sessionId)
        deps.trace.push({
          kind: 'host:pre-step-rewrite',
          sessionId: input.sessionId,
          turn: input.turn,
          note: `命中探针标记 → 改写为 ${input.text.length + 16} 字（原 ${input.text.length} 字）`,
        })
        return { kind: 'text', text: `[cosplay-probe] ${input.text}` }
      }
    }

    // 2) 本会话的绑定（客户端在会话视图挂载时把"生效值"写进来）。
    //    判定只有一份：`effectiveCardId()`（浏览器半边显示的角色也走它）。
    const cardId = effectiveCardId({
      binding: deps.state().binding(input.sessionId),
      defaultCardId: cfg.defaultCardId,
      injectIntoUnbound: cfg.injectIntoUnboundSessions,
    })
    if (cardId === '') return { kind: 'keep' }

    const card = deps.library().get(cardId)
    if (card === undefined) {
      if (!warned.has(cardId)) {
        warned.add(cardId)
        deps.trace.push({
          kind: 'host:card-missing',
          sessionId: input.sessionId,
          id: cardId,
          note: `本会话绑定的卡不存在（${cardId}）：已按"无角色"处理。可能是卡片被删了。`,
        })
      }
      return { kind: 'keep' }
    }

    // 3) 这张卡在当前策略下要不要走"改写"这条链路。
    if (!modeIncludes(card, cfg.strategy, 'rewrite') || card.rewrite === null || card.rewrite === undefined) {
      return { kind: 'keep' }
    }
    if (input.text.trim() === '') return { kind: 'keep' }

    // 4) 取最近对话作为**改写调用的上下文**。
    //    改写调用是无状态的：没有上下文时"把这个提交到仓库"里的"这个"没有指代对象，
    //    模型会抓住它上下文里唯一存在的名词（卡片规则本身）当主体 → 任务主体被换掉。
    //    读历史失败一律按"没有上下文"处理：绝不因为读历史而打断用户发送。
    let turns: ContextTurn[] = []
    try {
      turns = collectRewriteContext({
        nodes: input.session?.surface?.nodes ?? [],
        eventAt: (seq) => {
          try {
            return input.session?.eventAt?.(seq)
          } catch {
            return undefined
          }
        },
        maxTurns: cfg.rewriteContextTurns,
        maxCharsTotal: cfg.rewriteContextMaxChars,
        excludeMessageId: String((input.message as { id?: unknown }).id ?? ''),
      })
    } catch (error) {
      deps.trace.push({
        kind: 'host:rewrite-context-error',
        sessionId: input.sessionId,
        turn: input.turn,
        note: `取上下文失败（按无上下文处理）：${messageOf(error)}`,
      })
    }

    // 4b) 指代守卫：原文含"这个/它/上一轮"这类指代、又拿不到上下文时**跳过改写**。
    //     无法解析指代时改写必然瞎猜主体；保留原文至少不会把任务改错。
    if (cfg.rewriteGuardUnresolved && turns.length === 0 && hasUnresolvedReference(input.text)) {
      deps.trace.push({
        kind: 'host:rewrite-skip-unresolved',
        sessionId: input.sessionId,
        turn: input.turn,
        id: card.id,
        note: `原文含指代但无可用上下文 → 不改写（原样放行 ${input.text.length} 字）`,
      })
      return { kind: 'keep' }
    }

    const contextChars = turns.reduce((sum, turn) => sum + turn.text.length, 0)
    const cwd = typeof input.session?.header?.cwd === 'string' ? input.session.header.cwd : undefined
    const assembled = renderRewriteInput(input.text, turns, cwd)
    if (turns.length > 0) {
      deps.trace.push({
        kind: 'host:rewrite-context',
        sessionId: input.sessionId,
        turn: input.turn,
        id: card.id,
        note: `带上下文 ${turns.length} 条 / ${contextChars} 字（原文 ${input.text.length} 字，组装后 ${assembled.length} 字）`,
      })
    }

    deps.trace.push({
      kind: 'host:pre-step-plan',
      sessionId: input.sessionId,
      turn: input.turn,
      id: card.id,
      note: `按「${card.name}」改写：原文 ${input.text.length} 字（mode=${card.mode} strategy=${cfg.strategy}）`,
    })

    const result = await deps.rewrite({ card, input: assembled, sessionId: input.sessionId, signal: input.signal })
    deps.state().recordRewrite(input.sessionId, {
      messageId: String((input.message as { id?: unknown }).id ?? ''),
      turn: input.turn,
      at: Date.now(),
      cardId: card.id,
      model: result.model,
      ok: result.ok,
      ms: result.ms,
      inChars: input.text.length,
      outChars: result.text.length,
      // 原文 + 上下文用量都要留档：下次"主体被换掉"能在 5 秒内看出来。
      original: input.text.slice(0, REWRITE_ORIGINAL_LIMIT),
      contextTurns: turns.length,
      contextChars,
      ...(result.ok ? {} : { error: result.error }),
      preview: result.ok ? result.text : result.error,
    })

    if (result.ok && result.text !== '') {
      // 标记这个会话：durable 观测（observe.ts）只为"被本插件改写过的会话"记日志，
      // 其余会话一条都不记（隐私边界）。
      deps.probe.touched.add(input.sessionId)
      deps.trace.push({
        kind: 'host:rewrite-ok',
        sessionId: input.sessionId,
        turn: input.turn,
        id: card.id,
        note: `${result.cached ? '缓存命中' : `${result.ms}ms`} · ${result.model} · ${input.text.length} 字 → ${result.text.length} 字`,
      })
      return { kind: 'text', text: result.text }
    }

    deps.trace.push({
      kind: 'host:rewrite-fallback',
      sessionId: input.sessionId,
      turn: input.turn,
      id: card.id,
      note:
        `改写不可用（${result.error}）→ 策略 ${cfg.rewriteOnFailure}：` +
        (cfg.rewriteOnFailure === 'block' ? '拒绝这一步' : '用原文继续'),
    })
    return cfg.rewriteOnFailure === 'block' ? { kind: 'block', error: result.error } : { kind: 'keep' }
  }

  const listener = async (payload: PreStepPayload, next: () => Promise<PreStepDecisionLike>): Promise<PreStepDecisionLike> => {
    deps.stats.preStepCalls += 1
    // 纪律 1：先拿默认决策 —— 里面带着动态上下文消息。
    const decision = await next()
    try {
      if (decision.kind !== 'enter' || payload.messages.length === 0) return decision
      const sessionId = String(payload.agent.id)

      for (const message of payload.messages) {
        if ((message as { role?: unknown }).role !== 'user') continue
        // 纪律 2：只动人提交的消息（source.kind === 'user'，M0 实测值）。
        if (sourceKindOf(message) !== 'user') continue
        const messageId = String((message as { id?: unknown }).id ?? '')

        const mark = `${sessionId}:${messageId}`
        if (!observed.has(mark) && observed.size < OBSERVE_LIMIT) {
          observed.add(mark)
          deps.trace.push({
            kind: 'host:pre-step-message',
            sessionId,
            turn: payload.turn,
            ...(messageId === '' ? {} : { id: messageId }),
            note: `role=user source.kind=user blocks=${blockKindsOf(message)} 文本=${textOfMessage(message).length}字 step=${payload.step}`,
          })
        }

        const text = textOfMessage(message)
        if (text === '') continue
        const cached = cache.get(messageId)
        if (cached !== undefined) {
          const index = decision.messages.findIndex((candidate) => String((candidate as { id?: unknown }).id ?? '') === messageId)
          if (index >= 0) {
            decision.messages[index] = replaceUserText(decision.messages[index] as UserMessage, cached)
            deps.stats.preStepRewrote += 1
          }
          continue
        }

        const outcome = await decide({
          sessionId,
          message,
          text,
          turn: payload.turn,
          signal: payload.signal,
          ...(payload.agent.session === undefined ? {} : { session: payload.agent.session }),
        })
        if (outcome.kind === 'block') {
          deps.trace.push({
            kind: 'host:pre-step-blocked',
            sessionId,
            turn: payload.turn,
            note: `按配置拒绝了这一步（rewriteOnFailure=block）：${outcome.error}`,
          })
          return { kind: 'reject' }
        }
        if (outcome.kind === 'keep') continue
        cache.set(messageId, outcome.text)
        if (cache.size > 256) cache.delete(cache.keys().next().value as string)
        const index = decision.messages.findIndex((candidate) => String((candidate as { id?: unknown }).id ?? '') === messageId)
        if (index < 0) continue
        decision.messages[index] = replaceUserText(decision.messages[index] as UserMessage, outcome.text)
        deps.stats.preStepRewrote += 1
      }
      return decision
    } catch (error) {
      // 纪律 4：钩子绝不打断一轮。
      deps.trace.push({
        kind: 'host:pre-step-error',
        sessionId: String(payload.agent.id),
        turn: payload.turn,
        note: `pre-step 钩子抛错（已吞，按原文继续）：${messageOf(error)}`,
      })
      return decision
    }
  }

  const dispose = ctx.on('agent/pre-step', listener as never)
  deps.trace.push({ kind: 'host:pre-step-installed', note: 'agent/pre-step 钩子已挂上（改写链路）' })
  return dispose
}
