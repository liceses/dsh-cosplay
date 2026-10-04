/**
 * `bindings.ts` 的回归：**"本会话到底用哪张卡"只有一个判定**。
 *
 * 这段逻辑以前散在宿主提示段、宿主 pre-step 钩子、浏览器页签三处，
 * "页签显示的角色"与"实际生效的角色"因此有漂移风险。现在三处都走这一个函数，
 * 所以它必须被钉死 —— 尤其是"关闭优先于默认卡"这条（关掉就该零 token）。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { effectiveCardId, resolveCardId, sessionMetaOf } from '../lib/bindings.js'

/**
 * `resolveCardId` 的默认输入（不含子代理规则：与旧行为等价）。
 * @param overrides 覆盖项
 */
function input(overrides = {}) {
  return {
    binding: undefined,
    defaultCardId: '',
    injectIntoUnbound: false,
    isSubagent: false,
    ignoreSubagents: true,
    inheritFromParent: false,
    ...overrides,
  }
}

test('没有绑定 + 不允许默认 → 空（零注入）', () => {
  assert.equal(effectiveCardId({ binding: undefined, defaultCardId: '', injectIntoUnbound: false }), '')
  assert.equal(effectiveCardId({ binding: undefined, defaultCardId: 'catgirl', injectIntoUnbound: false }), '')
})

test('没有绑定 + 允许默认 + 配了默认 → 默认卡', () => {
  assert.equal(effectiveCardId({ binding: undefined, defaultCardId: 'catgirl', injectIntoUnbound: true }), 'catgirl')
  assert.equal(effectiveCardId({ binding: { cardId: null, enabled: true, updatedAt: 1 }, defaultCardId: 'catgirl', injectIntoUnbound: true }), 'catgirl')
})

test('显式绑定优先于默认卡（人的决定最大）', () => {
  assert.equal(
    effectiveCardId({ binding: { cardId: 'hardcore', enabled: true, updatedAt: 2 }, defaultCardId: 'catgirl', injectIntoUnbound: true }),
    'hardcore',
  )
})

test('本会话被关掉 → 空，连默认卡也不生效', () => {
  assert.equal(effectiveCardId({ binding: { cardId: 'hardcore', enabled: false, updatedAt: 3 }, defaultCardId: 'catgirl', injectIntoUnbound: true }), '')
  assert.equal(effectiveCardId({ binding: { cardId: null, enabled: false, updatedAt: 3 }, defaultCardId: 'catgirl', injectIntoUnbound: true }), '')
})

test('绑定成空串这类脏值都当"没绑定"', () => {
  assert.equal(effectiveCardId({ binding: { cardId: '', enabled: true, updatedAt: 1 }, defaultCardId: 'catgirl', injectIntoUnbound: true }), 'catgirl')
  assert.equal(effectiveCardId({ binding: { cardId: null, enabled: true, updatedAt: 1 }, defaultCardId: '', injectIntoUnbound: true }), '')
})

/* ─────────────── 子代理：默认隔离 + 可选继承（B3）─────────────── */

test('sessionMetaOf：认官方的 origin/parentSession（两种形状都认）', () => {
  // 运行时形状：session.header.*
  assert.deepEqual(sessionMetaOf({ header: { origin: 'subagent', parentSession: 'session-p1' } }), {
    isSubagent: true,
    parentSessionId: 'session-p1',
  })
  // 持久化形状：字段在顶层
  assert.deepEqual(sessionMetaOf({ origin: 'subagent', parentSession: 'session-p2' }), {
    isSubagent: true,
    parentSessionId: 'session-p2',
  })
  // 顶层会话
  assert.deepEqual(sessionMetaOf({ header: { cwd: 'D:\\x' } }), { isSubagent: false, parentSessionId: '' })
  // 防御：什么都读不到
  assert.deepEqual(sessionMetaOf(undefined), { isSubagent: false, parentSessionId: '' })
  assert.deepEqual(sessionMetaOf({ header: { origin: 'subagent', parentSession: 42 } }), { isSubagent: true, parentSessionId: '' })
})

test('子代理 + ignoreSubagents → 空（哪怕它自己绑了卡）', () => {
  assert.equal(
    resolveCardId(input({ isSubagent: true, binding: { cardId: 'catgirl', enabled: true, updatedAt: 1 } })),
    '',
    '子代理一律不注入/不改写（它自己的绑定也不生效）',
  )
  assert.equal(
    resolveCardId(input({ isSubagent: true, defaultCardId: 'hardcore', injectIntoUnbound: true })),
    '',
    '★ 这条是脚枪保险：默认改写卡不能去改子代理的任务提示词',
  )
})

test('关掉 ignoreSubagents 后，子代理按普通会话规则走', () => {
  assert.equal(
    resolveCardId(input({ isSubagent: true, ignoreSubagents: false, defaultCardId: 'catgirl', injectIntoUnbound: true })),
    'catgirl',
  )
  assert.equal(
    resolveCardId(input({ isSubagent: true, ignoreSubagents: false, binding: { cardId: 'catgirl', enabled: true, updatedAt: 1 } })),
    'catgirl',
  )
})

test('子代理继承父会话的卡（显式开关；父会话被关掉则不继承）', () => {
  const parentBinding = { cardId: 'gentle-senpai', enabled: true, updatedAt: 2 }
  assert.equal(
    resolveCardId(input({ isSubagent: true, ignoreSubagents: false, inheritFromParent: true, parentBinding })),
    'gentle-senpai',
  )
  // 默认关 → 不继承
  assert.equal(resolveCardId(input({ isSubagent: true, ignoreSubagents: false, parentBinding })), '')
  // 子代理自己绑了卡 → 自己的优先
  assert.equal(
    resolveCardId(input({ isSubagent: true, ignoreSubagents: false, inheritFromParent: true, parentBinding, binding: { cardId: 'catgirl', enabled: true, updatedAt: 3 } })),
    'catgirl',
  )
  // 父会话被显式关掉 → 不继承
  assert.equal(
    resolveCardId(input({ isSubagent: true, ignoreSubagents: false, inheritFromParent: true, parentBinding: { cardId: 'catgirl', enabled: false, updatedAt: 4 } })),
    '',
  )
  // 顶层会话即使开了继承也不看父绑定（父绑定只在子代理时有效）
  assert.equal(resolveCardId(input({ inheritFromParent: true, parentBinding })), '')
})

test('effectiveCardId 仍是旧行为（不含子代理规则）—— 浏览器半边与旧调用点不受影响', () => {
  assert.equal(effectiveCardId({ binding: { cardId: 'catgirl', enabled: true, updatedAt: 1 }, defaultCardId: 'hardcore', injectIntoUnbound: true }), 'catgirl')
  assert.equal(effectiveCardId({ binding: { cardId: null, enabled: false, updatedAt: 1 }, defaultCardId: 'hardcore', injectIntoUnbound: true }), '')
  assert.equal(effectiveCardId({ binding: undefined, defaultCardId: 'hardcore', injectIntoUnbound: true }), 'hardcore')
})