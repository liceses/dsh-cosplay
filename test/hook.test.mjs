/**
 * `hook.ts` 的回归：pre-step 拦截的五条纪律。
 *
 * 这一层是最容易出人命的地方（钩子抛错会打断整轮对话、改错消息会篡改日志），
 * 所以每条纪律都要有一条对应的用例：
 *  1. 先 `next()`，动态上下文消息不许丢；
 *  2. 只动 `role=user` 且 `source.kind=user`；
 *  3. 按 message.id 幂等；
 *  4. 内部抛错 → 原样返回决策；
 *  5. 失败按配置回落（original 继续 / block 拒绝这一步）。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { installPreStepHook, preStepSessionIdOf, replaceUserText, sourceKindOf, textOfMessage } from '../lib/hook.js'
import { createTrace } from '../lib/trace.js'

/** 计数。 */
function stats() {
  return {
    sectionCalls: 0,
    sectionFilled: 0,
    sectionUnresolved: 0,
    preStepCalls: 0,
    preStepRewrote: 0,
    preStepUnresolved: 0,
    rewrite: { calls: 0, ok: 0, failed: 0, cached: 0, lastMs: 0, lastModel: '' },
    durableUserMessages: 0,
  }
}

/** 配置。 */
function config(overrides = {}) {
  return {
    enabled: true,
    strategy: 'card',
    defaultCardId: '',
    injectIntoUnboundSessions: false,
    rewriteOnFailure: 'original',
    rewriteTimeoutMs: 1000,
    rewriteMaxInputChars: 1000,
    rewriteMaxOutputChars: 1000,
    // 本次新增：上下文与指代守卫（这里刻意关掉上下文，让本文件专注"五条纪律"；
    // 上下文/守卫的行为在 guard.test.mjs 里用真实事故原文测）。
    rewriteContextTurns: 0,
    rewriteContextMaxChars: 2400,
    rewriteGuardUnresolved: false,
    // 子代理规则（真实默认值：隔离开、继承关）
    ignoreSubagents: true,
    inheritFromParent: false,
    thinkingFlavor: 'off',
    personaMaxChars: 8000,
    traceSize: 50,
    ...overrides,
  }
}

/** 一张改写卡。 */
function card(overrides = {}) {
  return { id: 'hardcore', name: '硬邦邦', mode: 'rewrite', rewrite: { rules: 'r' }, version: 1, source: 'preset', createdAt: 0, updatedAt: 0, ...overrides }
}

/** 一条用户消息。 */
function message(overrides = {}) {
  return { id: 'm1', role: 'user', content: [{ type: 'text', text: '画一张秦始皇骑北极熊' }], source: { kind: 'user' }, ...overrides }
}

/** 建一个 harness：捕获 pre-step 监听器。 */
function harness({ cards = [card()], binding, rewrite, cfg = config(), probe = { armed: false, touched: new Set(), sessions: [] }, records = [] } = {}) {
  const trace = createTrace(50)
  const counters = stats()
  let listener
  const ctx = {
    on(name, fn) {
      if (name === 'agent/pre-step') listener = fn
      return () => {
        listener = undefined
      }
    },
  }
  const library = {
    get(id) {
      return cards.find((candidate) => candidate.id === id)
    },
  }
  const asked = []
  const store = {
    binding(sessionId) {
      asked.push(sessionId)
      return binding
    },
    recordRewrite(sessionId, record) {
      records.push({ sessionId, ...record })
   },
  }
  installPreStepHook(ctx, {
    trace,
    stats: counters,
    config: () => cfg,
    library: () => library,
    state: () => store,
    probe,
    rewrite: rewrite ?? (async () => ({ ok: true, text: '老哥们，搞快点！', model: 'p/m', ms: 12, error: '', cached: false })),
  })
  return {
    trace,
    stats: counters,
    records,
    probe,
    /** 钩子问过哪些 sessionId（用来验证身份解析的兜底真的生效）。 */
    asked,
    /** 跑一次钩子。 */
    async run(payload, next) {
      return listener(payload, next)
    },
  }
}

/** 默认的 next：把用户消息 + 一条动态上下文消息交出来（模拟真实 loop）。 */
function defaultNext(messages) {
  return async () => ({ kind: 'enter', messages: [...messages, { id: 'ctx', role: 'user', content: [{ type: 'text', text: 'runtime context' }], source: { kind: 'runtime-context' } }] })
}

test('textOfMessage / replaceUserText / sourceKindOf 的基本行为', () => {
  const m = message({ content: [{ type: 'text', text: 'a' }, { type: 'image', attachment: {} }, { type: 'text', text: 'b' }] })
  assert.equal(textOfMessage(m), 'ab')
  const replaced = replaceUserText(m, 'NEW')
  assert.equal(textOfMessage(replaced), 'NEW')
  assert.equal(replaced.content.length, 2, '图片块必须保留')
  assert.equal(replaced.content[1].type, 'image')
  assert.equal(sourceKindOf(m), 'user')
  assert.equal(sourceKindOf({ id: 'x', role: 'user', content: [], source: {} }), '')
})

test('改写到"绑定了改写卡"的用户消息，且保留 next() 给的动态上下文消息', async () => {
  const h = harness({ binding: { cardId: 'hardcore', enabled: true } })
  const decision = await h.run({ agent: { id: 's1' }, messages: [message()], turn: 1, step: 1, signal: new AbortController().signal }, defaultNext([message()]))
  assert.equal(decision.kind, 'enter')
  assert.equal(textOfMessage(decision.messages[0]), '老哥们，搞快点！')
  assert.equal(decision.messages.length, 2, '上下文消息不能在替换时被丢掉')
  assert.equal(sourceKindOf(decision.messages[1]), 'runtime-context')
  assert.equal(h.stats.preStepRewrote, 1)
  assert.equal(h.records.length, 1)
  assert.equal(h.records[0].ok, true)
  assert.equal(h.probe.touched.has('s1'), true, '改写成功后要标记该会话以便 durable 观测')
})

test('不动非 human 来源的 user 消息（system-reminder / runtime-context）', async () => {
  const other = message({ id: 'm2', source: { kind: 'runtime-context' } })
  const h = harness({ binding: { cardId: 'hardcore', enabled: true } })
  const decision = await h.run({ agent: { id: 's1' }, messages: [other], turn: 1, step: 1, signal: new AbortController().signal }, defaultNext([other]))
  assert.equal(textOfMessage(decision.messages[0]), '画一张秦始皇骑北极熊')
  assert.equal(h.stats.preStepRewrote, 0)
})

test('不动 assistant/tool 消息', async () => {
  const assistant = { id: 'a1', role: 'assistant', content: [{ type: 'text', text: '模型自己说的' }], source: { kind: 'model' } }
  const h = harness({ binding: { cardId: 'hardcore', enabled: true } })
  const decision = await h.run(
    { agent: { id: 's1' }, messages: [assistant], turn: 1, step: 1, signal: new AbortController().signal },
    async () => ({ kind: 'enter', messages: [assistant] }),
  )
  assert.equal(textOfMessage(decision.messages[0]), '模型自己说的')
})

test('没有绑定 / 本会话被关 / 卡片不存在 / 不是改写卡 → 一律不动', async () => {
  const cases = [
    harness({ binding: undefined }),
    harness({ binding: { cardId: 'hardcore', enabled: false } }),
    harness({ binding: { cardId: 'nope', enabled: true } }),
    harness({ cards: [card({ mode: 'system', rewrite: null })], binding: { cardId: 'hardcore', enabled: true } }),
  ]
  for (const h of cases) {
    const decision = await h.run({ agent: { id: 's1' }, messages: [message()], turn: 1, step: 1, signal: new AbortController().signal }, defaultNext([message()]))
    assert.equal(textOfMessage(decision.messages[0]), '画一张秦始皇骑北极熊')
    assert.equal(h.stats.preStepRewrote, 0)
  }
})

test('全局 strategy=system 时，改写链路不生效', async () => {
  const h = harness({ binding: { cardId: 'hardcore', enabled: true }, cfg: config({ strategy: 'system' }) })
  const decision = await h.run({ agent: { id: 's1' }, messages: [message()], turn: 1, step: 1, signal: new AbortController().signal }, defaultNext([message()]))
  assert.equal(textOfMessage(decision.messages[0]), '画一张秦始皇骑北极熊')
})

test('幂等：同一条消息被再次提出时复用结果，不再调用模型', async () => {
  let calls = 0
  const h = harness({
    binding: { cardId: 'hardcore', enabled: true },
    rewrite: async () => {
      calls += 1
      return { ok: true, text: '只算一次', model: 'p/m', ms: 1, error: '', cached: false }
    },
  })
  const payload = { agent: { id: 's1' }, messages: [message()], turn: 1, step: 1, signal: new AbortController().signal }
  const first = await h.run(payload, defaultNext([message()]))
  const second = await h.run(payload, defaultNext([message()]))
  assert.equal(calls, 1)
  assert.equal(textOfMessage(first.messages[0]), '只算一次')
  assert.equal(textOfMessage(second.messages[0]), '只算一次')
})

test('改写失败 + 策略 original → 用原文继续（fail-open）', async () => {
  const h = harness({
    binding: { cardId: 'hardcore', enabled: true },
    rewrite: async () => ({ ok: false, text: '', model: 'p/m', ms: 5, error: '超时', cached: false }),
  })
  const decision = await h.run({ agent: { id: 's1' }, messages: [message()], turn: 1, step: 1, signal: new AbortController().signal }, defaultNext([message()]))
  assert.equal(decision.kind, 'enter')
  assert.equal(textOfMessage(decision.messages[0]), '画一张秦始皇骑北极熊')
  assert.equal(h.records[0].ok, false)
  assert.equal(h.records[0].error, '超时')
})

test('改写失败 + 策略 block → 拒绝这一步', async () => {
  const h = harness({
    binding: { cardId: 'hardcore', enabled: true },
    cfg: config({ rewriteOnFailure: 'block' }),
    rewrite: async () => ({ ok: false, text: '', model: 'p/m', ms: 5, error: '超时', cached: false }),
  })
  const decision = await h.run({ agent: { id: 's1' }, messages: [message()], turn: 1, step: 1, signal: new AbortController().signal }, defaultNext([message()]))
  assert.equal(decision.kind, 'reject')
})

test('内部抛错 → 原样返回决策（绝不打断一轮）', async () => {
  const h = harness({
    binding: { cardId: 'hardcore', enabled: true },
    rewrite: async () => {
      throw new Error('模型适配器炸了')
    },
  })
  const decision = await h.run({ agent: { id: 's1' }, messages: [message()], turn: 1, step: 1, signal: new AbortController().signal }, defaultNext([message()]))
  assert.equal(decision.kind, 'enter')
  assert.equal(textOfMessage(decision.messages[0]), '画一张秦始皇骑北极熊')
  assert.ok(h.trace.list().some((entry) => entry.kind === 'host:pre-step-error'))
})

test('next() 已经拒绝时原样透传', async () => {
  const h = harness()
  const decision = await h.run({ agent: { id: 's1' }, messages: [message()], turn: 1, step: 1, signal: new AbortController().signal }, async () => ({ kind: 'reject' }))
  assert.equal(decision.kind, 'reject')
})

test('探针路径：武装 + 带标记才动手（M0 自检保留）', async () => {
  const probe = { armed: true, touched: new Set(), sessions: [] }
  const h = harness({ probe, binding: undefined })
  const marked = message({ content: [{ type: 'text', text: 'cosplay-probe-marker 你好' }] })
  const decision = await h.run({ agent: { id: 's1' }, messages: [marked], turn: 1, step: 1, signal: new AbortController().signal }, defaultNext([marked]))
  assert.match(textOfMessage(decision.messages[0]), /^\[cosplay-probe\] /)

  const h2 = harness({ probe: { armed: false, touched: new Set(), sessions: [] }, binding: undefined })
  const untouched = await h2.run({ agent: { id: 's1' }, messages: [marked], turn: 1, step: 1, signal: new AbortController().signal }, defaultNext([marked]))
  assert.equal(textOfMessage(untouched.messages[0]), 'cosplay-probe-marker 你好')
})

/* ─────────────── 会话身份：两条独立的路 + 静默退化探针 ─────────────── */

test('preStepSessionIdOf：agent.id 优先、agent.session.id 兜底、header 再兜底', () => {
  assert.equal(preStepSessionIdOf({ agent: { id: 's1' } }), 's1')
  assert.equal(preStepSessionIdOf({ agent: { session: { id: 's2' } } }), 's2')
  assert.equal(preStepSessionIdOf({ agent: { session: { header: { id: 's3' } } } }), 's3')
  assert.equal(preStepSessionIdOf({ agent: { id: 's1', session: { id: 's2' } } }), 's1', 'agent.id 优先')
  assert.equal(preStepSessionIdOf({ agent: {} }), undefined)
  assert.equal(preStepSessionIdOf({}), undefined)
})

test('载荷缺会话身份 → 不改写、原文放行、留痕、计数（静默退化探针）', async () => {
  const h = harness({ binding: { cardId: 'hardcore', enabled: true } })
  const payload = { agent: {}, messages: [message()], turn: 1, step: 1, signal: new AbortController().signal }
  const decision = await h.run(payload, defaultNext([message()]))
  assert.equal(decision.kind, 'enter')
  assert.equal(textOfMessage(decision.messages[0]), '画一张秦始皇骑北极熊', '原文必须原样放行')
  assert.equal(h.stats.preStepRewrote, 0)
  assert.equal(h.stats.preStepUnresolved, 1)
  const warned = h.trace.list().filter((entry) => entry.kind === 'host:pre-step-no-agent')
  assert.equal(warned.length, 1)
  assert.match(warned[0].note, /取不到会话身份/)
})

test('agent.id 缺失但有 agent.session.id → 兜底生效，仍按该会话绑定改写', async () => {
  const h = harness({ binding: { cardId: 'hardcore', enabled: true } })
  const payload = { agent: { session: { id: 's-fallback' } }, messages: [message()], turn: 1, step: 1, signal: new AbortController().signal }
  const decision = await h.run(payload, defaultNext([message()]))
  assert.equal(textOfMessage(decision.messages[0]), '老哥们，搞快点！', '兜底解析出的会话必须真的被用来查绑定')
  assert.deepEqual(h.asked, ['s-fallback'])
  assert.equal(h.stats.preStepUnresolved, 0, '兜底成功不算退化')
})
/* ─────────────── 角色风味思维链（thinkingFlavor，第 1 轮才加）─────────────── */

test('角色风味思维链：第 1 轮 + 人设卡 → 标记追加到首条消息末尾；第 2 轮不加', async () => {
  const catgirl = { id: 'catgirl', name: '赛博猫娘', mode: 'system', persona: '你是猫娘', version: 1, source: 'preset', createdAt: 0, updatedAt: 0 }
  const h = harness({ cards: [catgirl], binding: { cardId: 'catgirl', enabled: true }, cfg: config({ thinkingFlavor: 'immersive' }) })

  const first = await h.run(
    { agent: { id: 's1' }, messages: [message()], turn: 1, step: 1, signal: new AbortController().signal },
    defaultNext([message()]),
  )
  const text1 = textOfMessage(first.messages[0])
  assert.equal(text1.startsWith('画一张秦始皇骑北极熊'), true, '原文必须还在最前')
  assert.equal(text1.includes('【角色沉浸要求】'), true, '第 1 轮要追加沉浸标记')
  assert.equal(text1.trimEnd().endsWith('通过内心独白分析剧情和规划回复'), true, '标记要逐字在末尾')

  const second = await h.run(
    { agent: { id: 's1' }, messages: [message({ id: 'm2' })], turn: 2, step: 1, signal: new AbortController().signal },
    defaultNext([message({ id: 'm2' })]),
  )
  assert.equal(textOfMessage(second.messages[0]).includes('【角色沉浸要求】'), false, '第 2 轮不该再加')
})

test('角色风味思维链：off / 无角色 / 只走改写链路的卡 → 都不加', async () => {
  const catgirl = { id: 'catgirl', name: '赛博猫娘', mode: 'system', persona: '你是猫娘', version: 1, source: 'preset', createdAt: 0, updatedAt: 0 }
  const payload = { agent: { id: 's1' }, messages: [message()], turn: 1, step: 1, signal: new AbortController().signal }

  const off = harness({ cards: [catgirl], binding: { cardId: 'catgirl', enabled: true }, cfg: config({ thinkingFlavor: 'off' }) })
  assert.equal(textOfMessage((await off.run(payload, defaultNext([message()]))).messages[0]).includes('【角色'), false)

  // analysis 模式加的是反向标记
  const analysis = harness({ cards: [catgirl], binding: { cardId: 'catgirl', enabled: true }, cfg: config({ thinkingFlavor: 'analysis' }) })
  const analyzed = textOfMessage((await analysis.run(payload, defaultNext([message()]))).messages[0])
  assert.equal(analyzed.includes('【思维模式要求】'), true)
  assert.equal(analyzed.includes('【角色沉浸要求】'), false)

  // 只走改写链路的卡（hardcore 是 mode=rewrite）→ 没有"角色人设"，不该加
  const rewriteOnly = harness({ cfg: config({ thinkingFlavor: 'immersive' }), binding: { cardId: 'hardcore', enabled: true } })
  const rewritten = textOfMessage((await rewriteOnly.run(payload, defaultNext([message()]))).messages[0])
  assert.equal(rewritten.includes('【角色沉浸要求】'), false, '没有 system 链路的卡不享受角色风味思维链')
})