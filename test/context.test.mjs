/**
 * `context.ts` 的回归：**改写调用的对话上下文怎么取、怎么组装**。
 *
 * 这个文件盯的是那次真实事故（`session-cf7b1365`，2026-10-02 02:35）：
 * 用户说"兄弟 太夯了…**把这个**提交到我的仓库吧"，改写调用没有上下文，
 * 于是把"这个"填成了它上下文里唯一存在的名词（卡片规则里的"硬邦邦提示词转换器"），
 * 任务主体被整条换掉，主模型随后真的去建了一个错的仓库。
 *
 * 所以这里既要测"取到了对的东西"，也要测"排掉了噪声"与"预算边界"。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  CONTEXT_EMPTY,
  CONTEXT_HEADER,
  DEMAND_HEADER,
  collectRewriteContext,
  hasUnresolvedReference,
  renderRewriteInput,
  sourceKindOf,
  textOfEvent,
  trimMessage,
} from '../lib/context.js'

/** 造一条 `user/message` 事件。 */
function human(text, id = '') {
  return { type: 'user/message', data: { content: [{ type: 'text', text }], source: { kind: 'user' }, ...(id === '' ? {} : { id }) } }
}

/** 造一条框架注入的 user 消息（必须被排除）。 */
function injected(text, kind = 'runtime-context') {
  return { type: 'user/message', data: { content: [{ type: 'text', text }], source: { kind } } }
}

/** 造一条 `assistant/message` 事件（带 reasoning 块，必须只取 text）。 */
function assistant(text, extra = {}) {
  return {
    type: 'assistant/message',
    data: {
      message: {
        content: [
          { type: 'reasoning', text: '（这段推理不该进上下文）' },
          { type: 'text', text },
        ],
      },
    },
    ...extra,
  }
}

/** 用一组事件建一个 `eventAt`（seq = 下标）。 */
function sessionOf(events) {
  return {
    nodes: events.map((_, index) => index),
    eventAt: (seq) => events[seq],
  }
}

test('只收"人话 + 助手话"，框架注入与工具播报一律排除', () => {
  const events = [
    human('帮我做一个初音未来的个人介绍页面'),
    injected('<system-reminder>AGENTS.md…</system-reminder>', 'runtime-context'),
    injected('A skill is a reusable set of…', 'skills'),
    injected('background job pwsh-60 finished', 'tool-jobs'),
    assistant('搞完了。页面本体：miku/index.html'),
    { type: 'tool/call', data: { name: 'write' } },
    { type: 'tool/result', data: { content: [{ type: 'text', text: 'ok' }] } },
  ]
  const turns = collectRewriteContext({ ...sessionOf(events), maxTurns: 10 })
  assert.deepEqual(
    turns.map((turn) => turn.role),
    ['user', 'assistant'],
  )
  assert.match(turns[0].text, /初音未来/)
  assert.match(turns[1].text, /miku\/index\.html/)
  // reasoning 块不许混进来。
  assert.equal(turns[1].text.includes('这段推理'), false)
})

test('从末尾往前取满 maxTurns，并翻回时间正序', () => {
  const events = [human('一'), assistant('A1'), human('二'), assistant('A2'), human('三'), assistant('A3')]
  const turns = collectRewriteContext({ ...sessionOf(events), maxTurns: 4 })
  assert.deepEqual(
    turns.map((turn) => turn.text),
    ['二', 'A2', '三', 'A3'],
  )
})

test('maxTurns=0 或负值 = 不带上下文', () => {
  const events = [human('一'), assistant('A1')]
  assert.deepEqual(collectRewriteContext({ ...sessionOf(events), maxTurns: 0 }), [])
  assert.deepEqual(collectRewriteContext({ ...sessionOf(events), maxTurns: -3 }), [])
})

test('空历史 / 没有 surface → 空数组（不许抛）', () => {
  assert.deepEqual(collectRewriteContext({ nodes: [], eventAt: () => undefined, maxTurns: 6 }), [])
  assert.deepEqual(collectRewriteContext({ nodes: [0, 1], eventAt: () => undefined, maxTurns: 6 }), [])
})

test('按 id 排除"本轮那条"（防止把要改写的原文当成历史）', () => {
  const events = [human('旧话', 'm1'), human('这一轮', 'm2')]
  const turns = collectRewriteContext({ ...sessionOf(events), maxTurns: 6, excludeMessageId: 'm2' })
  assert.deepEqual(
    turns.map((turn) => turn.text),
    ['旧话'],
  )
})

test('超长消息保头保尾并打省略标记', () => {
  const long = `${'头'.repeat(100)}${'中'.repeat(500)}${'尾'.repeat(100)}`
  const trimmed = trimMessage(long, 200)
  assert.equal(trimmed.length <= 200 + '…（中略）…'.length, true)
  assert.equal(trimmed.startsWith('头'), true)
  assert.equal(trimmed.endsWith('尾'), true)
  assert.match(trimmed, /…（中略）…/)
  // 没超限就原样返回。
  assert.equal(trimMessage('短', 200), '短')
})

test('总量上限会丢掉更早的，保留最近的', () => {
  const events = [human('早'.repeat(400)), assistant('近'.repeat(400))]
  const turns = collectRewriteContext({ ...sessionOf(events), maxTurns: 6, maxCharsPerMessage: 400, maxCharsTotal: 450 })
  assert.equal(turns.length, 1)
  assert.equal(turns[0].text, '近'.repeat(400))
})

test('组装：分区标记齐全，原文逐字落在最后一段', () => {
  const original = '兄弟 太夯了 ，看的我硬邦邦！！！ 想让更多人硬邦邦，把这个提交到我的仓库吧！！'
  const text = renderRewriteInput(
    original,
    [
      { role: 'user', text: '帮我做一个初音未来的个人介绍页面' },
      { role: 'assistant', text: '搞完了。页面本体：miku/index.html' },
    ],
    'D:\\developing\\DSH-plugin\\dsh-cosplay',
  )
  assert.equal(text.includes(CONTEXT_HEADER), true)
  assert.equal(text.includes(DEMAND_HEADER), true)
  assert.equal(text.includes('miku/index.html'), true)
  assert.equal(text.includes('当前工作目录：D:\\developing\\DSH-plugin\\dsh-cosplay'), true)
  // 原文必须**逐字**出现在最后一段（改写调用据此知道"只改这一段"）。
  assert.equal(text.endsWith(`${DEMAND_HEADER}\n${original}`), true)
})

test('组装：没有上下文时明确告知（并提示保留指代词）', () => {
  const text = renderRewriteInput('把这个提交到仓库', [])
  assert.equal(text.includes(CONTEXT_EMPTY), true)
  assert.equal(text.endsWith(`${DEMAND_HEADER}\n把这个提交到仓库`), true)
})

test('指代检测：命中真指代，放过"其他"这类假阳性', () => {
  for (const text of ['把这个提交到我的仓库吧', '上一轮做的页面呢', '它现在能跑了吗', '刚才那个仓库名'])
    assert.equal(hasUnresolvedReference(text), true, `应命中：${text}`)
  for (const text of ['其他文件夹不用看', '其它方案也行', '帮我写一个登录页面', '编译报错了看看'])
    assert.equal(hasUnresolvedReference(text), false, `不该命中：${text}`)
})

test('事件读取的两个小工具', () => {
  assert.equal(textOfEvent(human('你好')), '你好')
  assert.equal(sourceKindOf(human('你好')), 'user')
  assert.equal(sourceKindOf(injected('x', 'skills')), 'skills')
  assert.equal(sourceKindOf({ type: 'assistant/message', data: { message: { content: [], source: { kind: 'model' } } } }), 'model')
})
