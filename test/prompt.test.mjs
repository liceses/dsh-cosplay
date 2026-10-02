/**
 * `prompt.ts` 的回归：两条链路的内容组装与清洗。
 *
 * 这里盯的是"模型到底看到什么"：人设注入的头尾纪律不能被长人设挤掉、
 * 改写调用的输出纪律必须存在、模型给的脏输出必须被洗干净。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { composePersonaText, composeRewriteSystem, effectiveMode, messageOf, modeIncludes, sanitizeRewritten } from '../lib/prompt.js'

/** 造一张卡（跳过规范化，直接给形状）。 */
function card(overrides = {}) {
  return { id: 'x', name: '测试卡', mode: 'system', persona: '你是测试卡', version: 1, source: 'custom', createdAt: 0, updatedAt: 0, ...overrides }
}

test('effectiveMode / modeIncludes：卡片 mode 与全局策略的组合', () => {
  assert.equal(effectiveMode(card({ mode: 'system' }), 'card'), 'system')
  assert.equal(effectiveMode(card({ mode: 'rewrite' }), 'card'), 'rewrite')
  assert.equal(effectiveMode(card({ mode: 'both' }), 'card'), 'system', 'both 在人设段优先显示 system')
  assert.equal(effectiveMode(card({ mode: 'system' }), 'rewrite'), 'rewrite', '全局策略覆盖卡片')
  assert.equal(effectiveMode(card({ mode: 'rewrite' }), 'system'), 'system')

  assert.equal(modeIncludes(card({ mode: 'both' }), 'card', 'system'), true)
  assert.equal(modeIncludes(card({ mode: 'both' }), 'card', 'rewrite'), true)
  assert.equal(modeIncludes(card({ mode: 'system' }), 'card', 'rewrite'), false)
  assert.equal(modeIncludes(card({ mode: 'system' }), 'rewrite', 'rewrite'), true)
  assert.equal(modeIncludes(card({ mode: 'rewrite' }), 'system', 'rewrite'), false)
})

test('composePersonaText：没人设 → 空串（零 token）', () => {
  assert.equal(composePersonaText(card({ persona: '' }), 8000), '')
  assert.equal(composePersonaText(card({ persona: '   ' }), 8000), '')
  assert.equal(composePersonaText(card({ persona: undefined }), 8000), '')
})

test('composePersonaText：头尾纪律在，人设被截断时也还在', () => {
  const text = composePersonaText(card({ persona: 'A'.repeat(500) }), 400)
  assert.ok(text.includes('【角色扮演 · dsh-cosplay】'))
  assert.ok(text.includes('扮演纪律：'))
  // 权限阶梯是本次新增的固定尾块：无论人设多长都不许被截掉。
  assert.ok(text.includes('事实、安全、工具使用纪律与用户明确的硬约束 > 角色设定 > 历史旧口吻'), '权限阶梯不能被截掉')
  assert.ok(text.includes('已截断'))
  assert.ok(text.length <= 420, `总长应受控，实际 ${text.length}`)
})

test('composeRewriteSystem：没规则 → 空串；有规则 → 带输出纪律', () => {
  assert.equal(composeRewriteSystem(card({ mode: 'rewrite', rewrite: null })), '')
  assert.equal(composeRewriteSystem(card({ mode: 'rewrite' })), '')
  const system = composeRewriteSystem(card({ mode: 'rewrite', rewrite: { rules: '# Role\n你是专家' } }))
  assert.ok(system.includes('# Role'))
  assert.ok(system.includes('只输出改写后的最终提示词正文'))
  assert.ok(system.includes('不要用引号、代码块围栏'))
})

test('composeRewriteSystem：示例被渲染成 few-shot', () => {
  const system = composeRewriteSystem(
    card({ mode: 'rewrite', rewrite: { rules: 'r', examples: [{ input: '画个球', output: '给我搞个球！' }] } }),
  )
  assert.ok(system.includes('### 示例 1'))
  assert.ok(system.includes('输入：画个球'))
  assert.ok(system.includes('输出：给我搞个球！'))
})

test('sanitizeRewritten：剥围栏、剥成对引号、折叠空行、截断', () => {
  assert.equal(sanitizeRewritten('```\n正文\n```', 100), '正文')
  assert.equal(sanitizeRewritten('```markdown\n正文\n```', 100), '正文')
  assert.equal(sanitizeRewritten('“正文”', 100), '正文')
  assert.equal(sanitizeRewritten('「正文」', 100), '正文')
  assert.equal(sanitizeRewritten('"正文"', 100), '正文')
  assert.equal(sanitizeRewritten('a\n\n\n\nb', 100), 'a\n\nb')
  assert.equal(sanitizeRewritten('x'.repeat(50), 10).length, 10)
  assert.equal(sanitizeRewritten('   ', 100), '')
})

test('messageOf：各种错误形状都能读成一句话', () => {
  assert.equal(messageOf(new Error('boom')), 'boom')
  assert.equal(messageOf('plain'), 'plain')
  assert.equal(messageOf({ a: 1 }), '{"a":1}')
  const cyclic = {}
  cyclic.self = cyclic
  assert.equal(typeof messageOf(cyclic), 'string')
})
