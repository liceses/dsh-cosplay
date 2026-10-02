/**
 * 座位回归：**我们注册进去的每个槽位，必须真的由官方包声明过**。
 *
 * 为什么值得一条测试：槽位名/种类（list / single / keyed）是跨包契约，
 * 拼错一个字母的后果是"注册时抛错"或"注册成功但永远不渲染"——
 * 而这两种失败在浏览器里都只表现为**静默**（inject 回调里的异常只进 renderer console，
 * 宿主看不到）。这条测试把契约固定下来：改 DSH 版本、槽位改名时立刻红灯。
 *
 * 检查方式是直接读**已安装包**的类型声明（生产装配用的就是同一份包）。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')

/** 我们注册的座位（槽位名、期望的种类、来自哪个包、用哪个 id）。 */
const SEATS = [
  {
    slot: 'conversation.view',
    kind: 'list',
    id: 'cosplay',
    package: '@deepseek-ai/dsh-client-ui-conversation',
    types: 'lib/types/client/contract/slots.d.ts',
  },
  {
    slot: 'conversation.input.left',
    kind: 'list',
    id: 'cosplay-card-chip',
    package: '@deepseek-ai/dsh-client-ui-conversation',
    types: 'lib/types/client/contract/slots.d.ts',
  },
  {
    slot: 'settings.section',
    kind: 'list',
    id: 'cosplay',
    package: '@deepseek-ai/dsh-client-ui-settings',
    types: 'lib/types/client/contract/slots.d.ts',
  },
]

test('每个注册的槽位都由官方包声明，且种类是 list（加法型）', () => {
  for (const seat of SEATS) {
    const file = join(ROOT, 'node_modules', seat.package, seat.types)
    assert.equal(existsSync(file), true, `读不到 ${seat.package}/${seat.types}（先 npm install）`)
    const text = readFileSync(file, 'utf8')
    const index = text.indexOf(`'${seat.slot}':`)
    assert.ok(index >= 0, `官方包里没有声明槽位 ${seat.slot} —— 契约变了`)
    // 取该槽位声明块（到下一个顶层键或块结束），确认 kind。
    const block = text.slice(index, index + 400)
    assert.match(block, new RegExp(`kind:\\s*'${seat.kind}'`), `${seat.slot} 的种类不再是 ${seat.kind}`)
    assert.match(block, /scope:\s*'(session|root|session-maybe)'/, `${seat.slot} 的 scope 声明变了`)
  }
})

test('注册 id 符合槽位 kind 的校验规则（list 必须有 id，且形状合法）', () => {
  for (const seat of SEATS) {
    assert.equal(seat.kind, 'list')
    assert.match(seat.id, /^[a-z0-9][a-z0-9._-]*$/, `${seat.slot} 的 id 形状不合法：${seat.id}`)
  }
})

test('协议常量与实际注册用的是同一份（防止两处各写一个字符串）', async () => {
  const protocol = await import('../lib/protocol.js')
  assert.equal(protocol.VIEW_ID, 'cosplay')
  assert.equal(protocol.SETTINGS_SECTION_ID, 'cosplay')
  assert.equal(typeof protocol.VIEW_ORDER, 'number')
  assert.equal(typeof protocol.SETTINGS_SECTION_ORDER, 'number')
  // 页签必须排在 chat(0) / trajectory(10) 之后，才能出现在它们旁边。
  assert.ok(protocol.VIEW_ORDER > 10)
})

test('客户端 bundle 里确实带着 chip 的座位与回执（产物级检查）', () => {
  const bundle = readFileSync(join(ROOT, 'lib', 'client.js'), 'utf8')
  for (const needle of ['conversation.input.left', 'conversation.view', 'settings.section', 'chip-mounted']) {
    assert.equal(bundle.includes(needle), true, `产物里缺少 ${needle}`)
  }
})
