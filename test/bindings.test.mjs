/**
 * `bindings.ts` 的回归：**"本会话到底用哪张卡"只有一个判定**。
 *
 * 这段逻辑以前散在宿主提示段、宿主 pre-step 钩子、浏览器页签三处，
 * "页签显示的角色"与"实际生效的角色"因此有漂移风险。现在三处都走这一个函数，
 * 所以它必须被钉死 —— 尤其是"关闭优先于默认卡"这条（关掉就该零 token）。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { effectiveCardId } from '../lib/bindings.js'

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
