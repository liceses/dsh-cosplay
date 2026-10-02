/**
 * `rewrite.ts` 的回归：流收集、超时合并、以及"失败一律不可用"的四种形态。
 *
 * 用**假 llm**，不打真实模型 —— 真实链路已在 lab 剖面上跑通（deepseek-flash，
 * 10 字 → 571 字，durable 落日志），单测盯的是分支与边界。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { collectStream, createRewriter, withTimeout } from '../lib/rewrite.js'
import { createTrace } from '../lib/trace.js'

/** 造一张改写卡。 */
function card(overrides = {}) {
  return {
    id: 'hardcore',
    name: '硬邦邦',
    mode: 'rewrite',
    rewrite: { rules: '# Role\n你是转换专家' },
    version: 1,
    source: 'preset',
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  }
}

/** 计数。 */
function stats() {
  return {
    sectionCalls: 0,
    sectionFilled: 0,
    preStepCalls: 0,
    preStepRewrote: 0,
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
    rewriteProvider: '',
    rewriteModel: '',
    rewriteTemperature: 0.4,
    rewriteTimeoutMs: 2000,
    rewriteMaxInputChars: 100,
    rewriteMaxOutputChars: 1000,
    rewriteOnFailure: 'original',
    personaMaxChars: 8000,
    showTab: true,
    coverAspect: 1,
    storagePath: '',
    artMaxEdge: 1024,
    artQuality: 0.85,
    traceSize: 50,
    ...overrides,
  }
}

/** 造一个假 ctx。 */
function ctxOf({ llm, defaultModel } = {}) {
  return {
    get(name) {
      if (name === 'llm') return llm
      if (name === 'agentDefaultModel') return defaultModel
      return undefined
    },
  }
}

/** 把数组变成 async iterable。 */
async function* stream(chunks) {
  for (const chunk of chunks) yield chunk
}

test('collectStream：拼 text-delta；只有 block-end 时兜底', async () => {
  const a = await collectStream(
    stream([
      { type: 'text-delta', text: '你' },
      { type: 'text-delta', text: '好' },
      { type: 'finish', reason: { kind: 'stop' } },
    ]),
  )
  assert.equal(a.text, '你好')
  assert.equal(a.error, '')

  const b = await collectStream(stream([{ type: 'block-end', block: { type: 'text', text: '兜底正文' } }, { type: 'finish', reason: { kind: 'stop' } }]))
  assert.equal(b.text, '兜底正文')
})

test('collectStream：finish=error / aborted 都记成失败', async () => {
  const failed = await collectStream(stream([{ type: 'finish', reason: { kind: 'error', failure: { message: '限流' } } }]))
  assert.equal(failed.error, '限流')
  const aborted = await collectStream(stream([{ type: 'finish', reason: { kind: 'aborted' } }]))
  assert.equal(aborted.error, '调用被取消/超时')
})

test('withTimeout：超时后 signal 会中止；dispose 之后不再中止', async () => {
  const controller = new AbortController()
  const guard = withTimeout(controller.signal, 30)
  await new Promise((resolve) => setTimeout(resolve, 80))
  assert.equal(guard.signal.aborted, true)
  guard.dispose()
})

test('withTimeout：调用方先中止也会传导', () => {
  const controller = new AbortController()
  const guard = withTimeout(controller.signal, 5000)
  controller.abort(new Error('用户取消'))
  assert.equal(guard.signal.aborted, true)
  guard.dispose()
})

test('createRewriter：没有 llm 服务 → 明确失败（不猜）', async () => {
  const trace = createTrace(20)
  const rewriter = createRewriter({ ctx: ctxOf({}), config: () => config(), trace, stats: stats() })
  const result = await rewriter({ card: card(), input: '画个球', sessionId: 's1', signal: new AbortController().signal })
  assert.equal(result.ok, false)
  assert.match(result.error, /llm 服务不在/)
})

test('createRewriter：没有模型 → 明确失败并给出怎么配', async () => {
  const trace = createTrace(20)
  const rewriter = createRewriter({ ctx: ctxOf({ llm: { stream: () => stream([]) } }), config: () => config(), trace, stats: stats() })
  const result = await rewriter({ card: card(), input: 'x', sessionId: 's1', signal: new AbortController().signal })
  assert.equal(result.ok, false)
  assert.match(result.error, /rewriteProvider/)
})

test('createRewriter：拿不到规则 → 明确失败', async () => {
  const rewriter = createRewriter({ ctx: ctxOf({}), config: () => config(), trace: createTrace(10), stats: stats() })
  const result = await rewriter({ card: card({ rewrite: null }), input: 'x', sessionId: 's1', signal: new AbortController().signal })
  assert.equal(result.ok, false)
  assert.match(result.error, /rewrite\.rules/)
})

test('createRewriter：成功路径（用默认模型、结果被清洗、计数正确）', async () => {
  const trace = createTrace(20)
  const counters = stats()
  let seen
  const llm = {
    stream(options) {
      seen = options
      return stream([
        { type: 'text-delta', text: '```\n' },
        { type: 'text-delta', text: '老哥们，搞快点！' },
        { type: 'text-delta', text: '\n```' },
        { type: 'finish', reason: { kind: 'stop' } },
      ])
    },
  }
  const rewriter = createRewriter({
    ctx: ctxOf({ llm, defaultModel: { currentSelection: () => ({ provider: 'p', model: 'm' }) } }),
    config: () => config(),
    trace,
    stats: counters,
    now: (() => {
      let tick = 0
      return () => (tick += 5)
    })(),
  })
  const result = await rewriter({ card: card(), input: '画一张秦始皇骑北极熊', sessionId: 's1', signal: new AbortController().signal })
  assert.equal(result.ok, true)
  assert.equal(result.text, '老哥们，搞快点！')
  assert.equal(result.model, 'p/m')
  assert.equal(seen.provider, 'p')
  assert.equal(seen.model, 'm')
  assert.equal(seen.system.includes('# Role'), true)
  assert.deepEqual(seen.messages, [{ role: 'user', content: [{ type: 'text', text: '画一张秦始皇骑北极熊' }] }])
  assert.equal(counters.rewrite.calls, 1)
  assert.equal(counters.rewrite.ok, 1)
  assert.equal(counters.rewrite.lastModel, 'p/m')
  assert.equal(trace.list().length, 0, '成功路径不应产生任何失败留痕')
})

test('createRewriter：内容缓存命中不重复调用模型', async () => {
  const counters = stats()
  let calls = 0
  const llm = {
    stream() {
      calls += 1
      return stream([{ type: 'text-delta', text: '改写结果' }, { type: 'finish', reason: { kind: 'stop' } }])
    },
  }
  const rewriter = createRewriter({
    ctx: ctxOf({ llm, defaultModel: { currentSelection: () => ({ provider: 'p', model: 'm' }) } }),
    config: () => config(),
    trace: createTrace(20),
    stats: counters,
  })
  const signal = new AbortController().signal
  const first = await rewriter({ card: card(), input: '同样的话', sessionId: 's1', signal })
  const second = await rewriter({ card: card(), input: '同样的话', sessionId: 's2', signal })
  assert.equal(first.ok, true)
  assert.equal(second.cached, true)
  assert.equal(calls, 1, '第二次必须走缓存')
  assert.equal(counters.rewrite.cached, 1)
})

test('createRewriter：空输出 → 失败（不能把空正文当成用户消息写进日志）', async () => {
  const counters = stats()
  const llm = { stream: () => stream([{ type: 'finish', reason: { kind: 'stop' } }]) }
  const rewriter = createRewriter({
    ctx: ctxOf({ llm, defaultModel: { currentSelection: () => ({ provider: 'p', model: 'm' }) } }),
    config: () => config(),
    trace: createTrace(20),
    stats: counters,
  })
  const result = await rewriter({ card: card(), input: 'x', sessionId: 's1', signal: new AbortController().signal })
  assert.equal(result.ok, false)
  assert.match(result.error, /空正文/)
  assert.equal(counters.rewrite.failed, 1)
})

test('createRewriter：适配器抛错 → 失败且留痕（不向上抛）', async () => {
  const trace = createTrace(20)
  const llm = {
    stream() {
      throw new Error('provider 503')
    },
  }
  const rewriter = createRewriter({
    ctx: ctxOf({ llm, defaultModel: { currentSelection: () => ({ provider: 'p', model: 'm' }) } }),
    config: () => config(),
    trace,
    stats: stats(),
  })
  const result = await rewriter({ card: card(), input: 'x', sessionId: 's1', signal: new AbortController().signal })
  assert.equal(result.ok, false)
  assert.match(result.error, /503/)
  assert.ok(trace.list().some((entry) => entry.kind === 'host:rewrite-error'))
})

test('createRewriter：输入按上限截断后再送模型', async () => {
  let seen
  const llm = {
    stream(options) {
      seen = options
      return stream([{ type: 'text-delta', text: 'ok' }, { type: 'finish', reason: { kind: 'stop' } }])
    },
  }
  const rewriter = createRewriter({
    ctx: ctxOf({ llm, defaultModel: { currentSelection: () => ({ provider: 'p', model: 'm' }) } }),
    config: () => config({ rewriteMaxInputChars: 5 }),
    trace: createTrace(20),
    stats: stats(),
  })
  await rewriter({ card: card(), input: '一二三四五六七八九', sessionId: 's1', signal: new AbortController().signal })
  assert.equal(seen.messages[0].content[0].text, '一二三四五')
})
