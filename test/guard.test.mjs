/**
 * 指代守卫 + 上下文接线的回归（`hook.ts` 的 4) / 4b) 两步）。
 *
 * **这个文件用的就是那次真实事故的原文**（`session-cf7b1365`，2026-10-02 02:35）：
 *
 *   原话：兄弟 太夯了 ，看的我硬邦邦！！！ 想让更多人硬邦邦，把这个提交到我的仓库吧！！直接新创一个！
 *   历史：用户「帮我做一个初音未来的个人介绍页面」→ 助手「搞完了。页面本体：miku/index.html」
 *   当时的改写结果：任务：把我这套硬邦邦的肌肉集团提示词转换器直接新创一个 GitHub 仓库…
 *
 * 两条断言把这件事钉死：
 *   1. **有上下文时**，送进改写调用的输入里必须出现上一轮的真实交付物（`miku/index.html`）；
 *   2. **没有上下文时**，含指代的原文**不改写**（原样放行），而不是让模型自己编一个主体。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { installPreStepHook, textOfMessage } from '../lib/hook.js'
import { createTrace } from '../lib/trace.js'

/** 事故原文。 */
const ACCIDENT_TEXT = '兄弟 太夯了 ，看的我硬邦邦！！！ 想让更多人硬邦邦，把这个提交到我的仓库吧！！直接新创一个！ 我要发到github page！让更多人看看'

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

/** 配置（含本次新增的上下文/守卫字段）。 */
function config(overrides = {}) {
  return {
    enabled: true,
    strategy: 'card',
    defaultCardId: '',
    injectIntoUnboundSessions: false,
    rewriteOnFailure: 'original',
    rewriteTimeoutMs: 1000,
    rewriteMaxInputChars: 8000,
    rewriteMaxOutputChars: 1000,
    rewriteContextTurns: 6,
    rewriteContextMaxChars: 2400,
    rewriteGuardUnresolved: true,
    // 子代理规则（真实默认值：整条链路隔离、继承关）
    ignoreSubagents: true,
    inheritFromParent: false,
    personaMaxChars: 8000,
    traceSize: 50,
    ...overrides,
  }
}

/** 硬邦邦（改写卡）。 */
const CARD = {
  id: 'hardcore',
  name: '硬邦邦',
  mode: 'rewrite',
  rewrite: { rules: '# Role: 硬邦邦提示词转换专家' },
  version: 1,
  source: 'preset',
  createdAt: 0,
  updatedAt: 0,
}

/** 用户消息。 */
function message(text, id = 'm1') {
  return { id, role: 'user', content: [{ type: 'text', text }], source: { kind: 'user' } }
}

/** 真实历史的两条事件（surface 里就是这个形状）。 */
function accidentSurface() {
  return [
    {
      type: 'user/message',
      data: { id: 'h1', content: [{ type: 'text', text: '帮我做一个初音未来的个人介绍页面' }], source: { kind: 'user' } },
    },
    {
      type: 'assistant/message',
      data: { message: { content: [{ type: 'text', text: '搞完了。**没起 team**。## 东西在哪 - 页面本体：miku/index.html' }] } },
    },
    {
      type: 'user/message',
      data: { id: 'noise', content: [{ type: 'text', text: 'A skill is a reusable set of…（9718 字的框架注入）' }], source: { kind: 'skills' } },
    },
  ]
}

/** 建 harness —— 记录每次 rewrite 收到的 `input`。 */
function harness({ surface = [], cfg = config(), binding = { cardId: 'hardcore', enabled: true }, bindings = {}, sessionId = 's1', header } = {}) {
  const trace = createTrace(80)
  const counters = stats()
  const calls = []
  const records = []
  const asked = []
  let listener
  const ctx = {
    on(name, fn) {
      if (name === 'agent/pre-step') listener = fn
      return () => {
        listener = undefined
      }
    },
  }
  installPreStepHook(ctx, {
    trace,
    stats: counters,
    config: () => cfg,
    library: () => ({ get: (id) => (id === 'hardcore' ? CARD : undefined) }),
    state: () => ({
      // 按 id 查绑定：`bindings` 里显式给了就用它，否则退回单个 `binding`（兼容旧用例）。
      binding: (id) => {
        asked.push(id)
        return Object.prototype.hasOwnProperty.call(bindings, id) ? bindings[id] : binding
      },
      recordRewrite: (id, record) => records.push({ sessionId: id, ...record }),
    }),
    probe: { armed: false, touched: new Set(), sessions: [] },
    rewrite: async (request) => {
      calls.push(request)
      return { ok: true, text: '老哥们，任务：把 miku 页面提交到仓库！', model: 'p/m', ms: 5, error: '', cached: false }
    },
  })
  const session = {
    id: sessionId,
    surface: { nodes: surface.map((_, index) => index) },
    eventAt: (seq) => surface[seq],
    header: header ?? { cwd: 'D:\\developing\\DSH-plugin\\dsh-cosplay' },
  }
  return {
    trace,
    calls,
    records,
    asked,
    stats: counters,
    run: (text, { id = 'm1', withSession = true } = {}) =>
      listener(
        {
          agent: withSession ? { id: sessionId, session } : { id: sessionId },
          messages: [message(text, id)],
          turn: 2,
          step: 1,
          signal: new AbortController().signal,
        },
        async () => ({ kind: 'enter', messages: [message(text, id)] }),
      ),
  }
}

test('事故复现：带上下文时，改写输入里出现上一轮的真实交付物', async () => {
  const h = harness({ surface: accidentSurface() })
  const decision = await h.run(ACCIDENT_TEXT)
  assert.equal(decision.kind, 'enter')
  assert.equal(h.calls.length, 1)

  const input = h.calls[0].input
  assert.match(input, /最近对话/)
  assert.match(input, /初音未来/, '必须带上前一轮的用户需求')
  assert.match(input, /miku\/index\.html/, '必须带上上一轮的真实交付物（指代对象）')
  assert.match(input, /当前工作目录/)
  assert.equal(input.endsWith(`【本轮要改写的原始需求（只改这一段）】\n${ACCIDENT_TEXT}`), true, '原文逐字且只改这一段')
  // 噪声不许进来。
  assert.equal(input.includes('A skill is a reusable set of'), false, 'skills 注入必须被排除')
  // 记录里要留档：原文 + 上下文用量（下次能在界面上对着看）。
  assert.equal(h.records[0].original, ACCIDENT_TEXT)
  assert.equal(h.records[0].contextTurns, 2)
  assert.equal(typeof h.records[0].contextChars, 'number')
  assert.equal(h.trace.list().some((entry) => entry.kind === 'host:rewrite-context'), true)
})

test('没有上下文且原文含指代 → 跳过改写（原样放行，不编主体）', async () => {
  const h = harness({ surface: [] })
  const decision = await h.run(ACCIDENT_TEXT)
  assert.equal(decision.kind, 'enter')
  assert.equal(textOfMessage(decision.messages[0]), ACCIDENT_TEXT, '原文必须原样放行')
  assert.equal(h.calls.length, 0, '一个模型调用都不该发生（省钱也省错）')
  assert.equal(h.stats.preStepRewrote, 0)
  assert.equal(h.trace.list().some((entry) => entry.kind === 'host:rewrite-skip-unresolved'), true)
})

test('没有上下文但不含指代 → 照常改写（守卫不误伤）', async () => {
  const h = harness({ surface: [] })
  const decision = await h.run('画一张秦始皇骑北极熊')
  assert.equal(h.calls.length, 1)
  assert.match(h.calls[0].input, /暂无可用上下文/)
  assert.equal(textOfMessage(decision.messages[0]), '老哥们，任务：把 miku 页面提交到仓库！')
})

test('关掉守卫（rewriteGuardUnresolved=false）→ 含指代且无上下文也照样改写', async () => {
  const h = harness({ surface: [], cfg: config({ rewriteGuardUnresolved: false }) })
  const decision = await h.run(ACCIDENT_TEXT)
  assert.equal(h.calls.length, 1)
  assert.match(h.calls[0].input, /暂无可用上下文/)
  assert.equal(decision.kind, 'enter')
})

test('rewriteContextTurns=0 完全退回旧行为（不带上下文）', async () => {
  const h = harness({ surface: accidentSurface(), cfg: config({ rewriteContextTurns: 0, rewriteGuardUnresolved: false }) })
  await h.run('画一张秦始皇骑北极熊')
  assert.match(h.calls[0].input, /暂无可用上下文/)
  assert.equal(h.calls[0].input.includes('miku/index.html'), false)
})

test('会话对象缺失（拿不到 surface）→ 按无上下文处理，不抛', async () => {
  const h = harness({ surface: accidentSurface() })
  const decision = await h.run(ACCIDENT_TEXT, { withSession: false })
  assert.equal(decision.kind, 'enter')
  assert.equal(h.calls.length, 0, '无 surface 且含指代 → 守卫跳过')
})

/* ─────────────── 子代理隔离与继承（B3，端到端）─────────────── */

test('子代理：即使配了默认改写卡，也不动它的任务提示词（脚枪保险）', async () => {
  // 场景：injectIntoUnboundSessions=true + 默认卡=改写卡（最危险的配置）
  const h = harness({
    cfg: config({ injectIntoUnboundSessions: true, defaultCardId: 'hardcore' }),
    binding: undefined,
    sessionId: 'sub-1',
    header: { origin: 'subagent', parentSession: 'session-parent' },
  })
  const decision = await h.run('你是「铁骑」——按这个任务写生图提示词：…')
  assert.equal(textOfMessage(decision.messages[0]), '你是「铁骑」——按这个任务写生图提示词：…', '子代理的任务提示词必须原样')
  assert.equal(h.calls.length, 0, '一次模型调用都不该发生')
  assert.equal(h.stats.preStepRewrote, 0)
  assert.equal(h.trace.list().some((e) => e.kind === 'host:subagent-skipped'), true, '要留一条痕说明为什么没改')
})

test('子代理：关掉 ignoreSubagents 后默认卡照常生效（说明开关有效，不是硬编码）', async () => {
  const h = harness({
    cfg: config({ injectIntoUnboundSessions: true, defaultCardId: 'hardcore', ignoreSubagents: false }),
    binding: undefined,
    sessionId: 'sub-2',
    header: { origin: 'subagent', parentSession: 'session-parent' },
  })
  const decision = await h.run('写一段生图提示词')
  assert.equal(h.calls.length, 1)
  assert.equal(textOfMessage(decision.messages[0]), '老哥们，任务：把 miku 页面提交到仓库！')
})

test('子代理：inheritFromParent 打开则用父会话的卡（且会去查父会话的绑定）', async () => {
  const h = harness({
    cfg: config({ ignoreSubagents: false, inheritFromParent: true }),
    bindings: { 'session-parent': { cardId: 'hardcore', enabled: true, updatedAt: 9 } },
    binding: undefined,
    sessionId: 'sub-3',
    header: { origin: 'subagent', parentSession: 'session-parent' },
  })
  await h.run('写一段生图提示词')
  assert.equal(h.calls.length, 1, '继承了父会话的改写卡 → 会改写')
  assert.equal(h.asked.includes('session-parent'), true, '必须真的去查过父会话的绑定')
})

test('普通会话不受子代理规则影响（回归）', async () => {
  const h = harness({ binding: { cardId: 'hardcore', enabled: true } })
  await h.run('画一张秦始皇骑北极熊')
  assert.equal(h.calls.length, 1)
  assert.equal(h.trace.list().some((e) => e.kind === 'host:subagent-skipped'), false)
})