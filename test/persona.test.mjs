/**
 * 人设段 / 尾部回声 / 改写 system 的回归（`prompt.ts`）。
 *
 * 盯四件事：
 *  1. **权限阶梯**必须在（事实/安全/工具纪律 > 角色设定 > 历史旧口吻），
 *     因为"中途换卡后旧口吻带走"与"压缩摘要与角色冲突"这两处以前是空白；
 *  2. 插件层纪律一律**正向陈述**（角色扮演实践共识 + 极性研究：否定式指令基本无效），
 *     所以这里断言不含「不要 / 禁止 / 严禁 / 别」这类否定句式；
 *  3. **尾部回声**三级取法：显式 `tailLine` → 逐字取人设第一句 → 都没有就不加；
 *  4. **改写 system** 里必须同时有卡片原词（逐字）与指代纪律。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { echoTextOf, normalizeCard } from '../lib/cards.js'
import {
  composeEchoText,
  composePersonaText,
  composeRewriteSystem,
  describeIdentity,
  registerAnchorContext,
  registerEchoSection,
  registerPersonaSection,
  sessionIdOf,
} from '../lib/prompt.js'
import { createTrace } from '../lib/trace.js'

/** 一张人设卡。 */
function personaCard(overrides = {}) {
  return {
    id: 'catgirl',
    name: '赛博猫娘',
    title: '情绪补给员',
    mode: 'system',
    persona: '你是一个赛博猫娘，每句话以喵~结尾，称呼用户为主人。\n\n- 喜欢蹭蹭\n- 会撒娇',
    version: 1,
    source: 'preset',
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  }
}

test('人设段：头、正文、纪律三块齐全，纪律里必须有权限阶梯', () => {
  const text = composePersonaText(personaCard(), 8000)
  assert.match(text, /^【角色扮演 · dsh-cosplay】你现在扮演「赛博猫娘」（情绪补给员）。/)
  assert.match(text, /你是一个赛博猫娘/)
  assert.match(text, /扮演纪律：/)
  assert.match(text, /事实、安全、工具使用纪律与用户明确的硬约束 > 角色设定 > 历史旧口吻/)
  assert.match(text, /超出角色认知范围的问题：在角色身份内说明不知道/)
  // 空人设 = 不注入（零 token）。
  assert.equal(composePersonaText(personaCard({ persona: '' }), 8000), '')
})

test('人设段：插件层纪律一律正向陈述（不出现否定句式）', () => {
  const text = composePersonaText(personaCard(), 8000)
  for (const banned of ['不要', '禁止', '严禁', '别给我', '不可'])
    assert.equal(text.includes(banned), false, `角色纪律里不该出现否定句式：${banned}`)
})

test('人设段：超长时裁正文但保住头尾纪律', () => {
  const text = composePersonaText(personaCard({ persona: '长'.repeat(5000) }), 600)
  assert.equal(text.length <= 700, true)
  assert.match(text, /人设过长，已截断/)
  assert.match(text, /扮演纪律：/)
  assert.match(text, /历史旧口吻/)
})

test('尾部回声：三级取法', () => {
  // 1) 显式 tailLine 优先
  assert.equal(composeEchoText(personaCard({ tailLine: '我是零式，永远是主人的猫娘喵。' })), '【本会话角色】我是零式，永远是主人的猫娘喵。')
  // 2) 没写则逐字取人设第一句
  assert.equal(composeEchoText(personaCard()), '【本会话角色】你是一个赛博猫娘，每句话以喵~结尾，称呼用户为主人。')
  // 3) 都没有 → 不加任何东西（绝不填通用系统腔）
  assert.equal(composeEchoText(personaCard({ persona: '' })), '')
  assert.equal(composeEchoText(personaCard({ persona: '# 标题\n\n---\n【分节】' })), '')
})

test('echoTextOf：跳过标题行与分隔线；tailLine 超长被裁', () => {
  assert.equal(echoTextOf(personaCard({ persona: '# 标题\n你现在是猫娘。\n- 更多' })), '你现在是猫娘。')
  assert.equal(echoTextOf(personaCard({ tailLine: 'x'.repeat(400) })).length, 200)
  // 规范化往返保留 tailLine（进 pack 分享也不丢）。
  const normalized = normalizeCard(personaCard({ tailLine: '我是零式喵。' })).value
  assert.equal(normalized.tailLine, '我是零式喵。')
})

/** 用一个假的 systemPrompt 服务捕获 `section()` 的入参。 */
function registrar() {
  const sections = []
  return {
    sections,
    service: {
      section(options) {
        sections.push(options)
        return () => {}
      },
      getSectionOrder(name) {
        return name === 'DEPLOYMENT_PERSONA_PREFIX' ? 0 : 10200
      },
    },
  }
}

/** 假的 ctx（只实现 `get`）。 */
function ctxOf(service) {
  return { get: (name) => (name === 'systemPrompt' ? service : undefined) }
}

test('段注册：人设段在前（order=1）、回声段在真末尾（order=10201）、都用独立段名', () => {
  const a = registrar()
  const deps = { trace: createTrace(20), stats: { sectionCalls: 0, sectionFilled: 0, sectionUnresolved: 0 }, compose: () => 'x' }
  registerPersonaSection(ctxOf(a.service), deps)
  registerEchoSection(ctxOf(a.service), deps)

  assert.equal(a.sections.length, 2)
  const [persona, echo] = a.sections
  assert.equal(persona.name, 'dsh-cosplay:persona')
  assert.equal(persona.order, 1)
  assert.equal(persona.interpolate, false)
  assert.equal(echo.name, 'dsh-cosplay:persona-echo')
  assert.equal(echo.order, 10201, '回声必须落在所有官方段之后（DEPLOYMENT_PERSONA_SUFFIX=10200）')
  assert.equal(echo.interpolate, false)
  // 复用官方槽位名会被 agent preset shadow，所以必须不同名。
  assert.notEqual(echo.name, 'deployment:persona-suffix')
})

test('段注册：宿主没有 systemPrompt 服务时安静返回 undefined', () => {
  const deps = { trace: createTrace(5), stats: { sectionCalls: 0, sectionFilled: 0, sectionUnresolved: 0 }, compose: () => 'x' }
  assert.equal(registerPersonaSection({ get: () => undefined }, deps), undefined)
  assert.equal(registerEchoSection({ get: () => undefined }, deps), undefined)
})

test('回声段求值：没绑卡（compose 返回空）时不占正文', () => {
  const r = registrar()
  const deps = { trace: createTrace(5), stats: { sectionCalls: 0, sectionFilled: 0, sectionUnresolved: 0 }, compose: () => '' }
  registerEchoSection(ctxOf(r.service), deps)
  assert.equal(r.sections[0].text({ agent: { id: 's1' } }), '')
})

/* ─────────────── 会话身份：两条独立的路 + 静默退化探针 ─────────────── */

test('会话身份：agent.id 优先、scope.id 兜底（两条独立的路）', () => {
  assert.equal(sessionIdOf({ agent: { id: 's1' } }), 's1')
  // ★ 这条是关键：`agent` 是**运行时多给**的键（不在 AssembleContext 的公开类型里），
  //   而 `scope` 是**声明过**的键 —— 只给 scope 时也必须解析出会话 id，否则人设会静默失效。
  assert.equal(sessionIdOf({ scope: { id: 's1' } }), 's1')
  assert.equal(sessionIdOf({ agent: { id: 'a' }, scope: { id: 'b' } }), 'a', 'agent 优先')
  assert.equal(sessionIdOf({ agent: {}, scope: { id: 42 } }), '42', '数字型 id 接受（转字符串）')
  assert.equal(sessionIdOf({ agent: { id: '' } }), undefined, '空串一律当取不到（最坏情况：能骗过 ?? 判断）')
  assert.equal(sessionIdOf({ agent: {}, scope: {} }), undefined)
  assert.equal(sessionIdOf({}), undefined)
  assert.equal(sessionIdOf(undefined), undefined)
})

test('静默退化探针：身份取不到 → 不注入 + 留痕 + 计数；有身份时不误报', () => {
  const r = registrar()
  const trace = createTrace(40)
  const stats = { sectionCalls: 0, sectionFilled: 0, sectionUnresolved: 0 }
  registerPersonaSection(ctxOf(r.service), { trace, stats, compose: () => '注入正文' })
  const section = r.sections[0]

  // ① 身份缺失：不注入、留一条能指向病因的回执、计数 +1
  assert.equal(section.text({}), '', '拿不到身份就不注入（宁可零 token，也不猜一个会话）')
  assert.equal(stats.sectionUnresolved, 1)
  assert.equal(stats.sectionFilled, 0)
  const warned = trace.list().filter((entry) => entry.kind === 'host:prompt-section-no-agent')
  assert.equal(warned.length, 1)
  assert.match(warned[0].note, /取不到会话身份/)
  assert.match(warned[0].note, /keys=\[\]/, '回执里要能看出上下文长什么样')

  // ② 有身份（哪怕只给 scope）：正常注入、不再计数
  assert.equal(section.text({ scope: { id: 's1' } }), '注入正文')
  assert.equal(stats.sectionFilled, 1)
  assert.equal(stats.sectionUnresolved, 1, '成功解析不算退化')
})

test('describeIdentity：能一眼看出是哪个键坏了', () => {
  const text = describeIdentity({ agent: {}, scope: { id: 'abc' } })
  assert.match(text, /keys=\[agent,scope\]/)
  assert.match(text, /agent\.id=undefined/)
  assert.match(text, /scope\.id=string\(abc\)/)
  assert.match(describeIdentity({ agent: { id: '' } }), /agent\.id=空串/)
})

test('改写 system：卡片原词逐字在内 + 指代纪律在内', () => {
  const rules = '# Role: “肌肉集团 / 硬邦邦”提示词转换专家\n\n- 第一条\n- 第二条\n\n---\n\n## 工作流规则\n- 直接输出。'
  const system = composeRewriteSystem({ ...personaCard({ mode: 'rewrite' }), rewrite: { rules, examples: [{ input: 'a', output: 'b' }] } })
  assert.equal(system.includes(rules), true, '卡片 rules 必须逐字保留（不许被插件改写）')
  assert.match(system, /## 转换示例/)
  assert.match(system, /## 指代纪律（必须遵守）/)
  assert.match(system, /换成【最近对话】里真实出现过的具体对象/)
  assert.match(system, /把"你正在遵守的这套改写规则与角色设定"当作风格模板，而不是用户的任务对象/)
})

/* ─────────────── 锚点座位：运行时上下文（B1，spike 后默认仍用 system）─────────────── */

test('运行时上下文锚点：注册名/order 正确，取不到身份不注入也不抛', () => {
  const contexts = []
  const service = {
    context(options) {
      contexts.push(options)
      return () => {}
    },
    getContextOrder(name) {
      return name === 'SUBAGENT_DELEGATION' ? 120 : 0
    },
  }
  const trace = createTrace(20)
  const stats = { sectionCalls: 0, sectionFilled: 0, sectionUnresolved: 0 }
  const dispose = registerAnchorContext({ get: (name) => (name === 'systemPrompt' ? service : undefined) }, {
    trace,
    stats,
    compose: (sessionId) => (sessionId === undefined ? '' : '【本会话角色】你是「赛博猫娘」。'),
  })
  assert.equal(typeof dispose, 'function')
  assert.equal(contexts.length, 1)
  assert.equal(contexts[0].name, 'dsh-cosplay:persona-anchor')
  assert.equal(contexts[0].order, 125, '排在所有官方运行时上下文之后（SUBAGENT_DELEGATION=120）')

  // 有身份 → 产出正文（这段会被以 user 角色物化在对话历史之后）
  assert.match(contexts[0].text({ agent: { id: 's1' } }), /【本会话角色】/)
  // 没身份 → 不注入、留痕、不抛
  assert.equal(contexts[0].text({}), '')
  assert.equal(trace.list().some((entry) => entry.kind === 'host:prompt-anchor-no-agent'), true)
})

test('运行时上下文锚点：宿主没有 context() 时安静返回 undefined', () => {
  assert.equal(registerAnchorContext({ get: () => undefined }, { trace: createTrace(5), stats: { sectionCalls: 0, sectionFilled: 0, sectionUnresolved: 0 }, compose: () => 'x' }), undefined)
  assert.equal(registerAnchorContext({ get: () => ({ section: () => () => {} }) }, { trace: createTrace(5), stats: { sectionCalls: 0, sectionFilled: 0, sectionUnresolved: 0 }, compose: () => 'x' }), undefined)
})