/**
 * 预设卡的内容契约（`presets/*.json`）。
 *
 * 这个文件管两件事：
 *
 * 1. **预设卡要"写全"**：每张人设卡必须齐五段（身份锚 / 说话方式 / 边界 / 格式契约 / 样例），
 *    长度在预算内，并且**不许出现"每句话…"这类绝对量化词** —— 那条是实测踩过的坑
 *    （绝对约束做不到，模型要么破坏格式，要么无视规则）。
 *
 * 2. **硬邦邦的 rules 逐字节不许动**：那是作者粘贴过来的原词，插件只负责搬运，不负责润色。
 *    这里用 sha256 把它锁住：谁手滑改了一个字，测试立刻红，并告诉他人该改哪里、
 *    不该改哪里。整卡也一并锁（防止顺手改 description/tags）。
 *
 * 依据见 `docs/research-persona-prompting-2026-10.md` 与 `docs/playbook-persona-cards.md`。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { echoTextOf, normalizeCard } from '../lib/cards.js'

/** 读预设包（相对测试文件解析，不受 cwd 影响）。 */
function readPack(name) {
  return JSON.parse(readFileSync(new URL(`../presets/${name}`, import.meta.url), 'utf8'))
}

const sha256 = (text) => createHash('sha256').update(text, 'utf8').digest('hex')

/** 期望的 id 集合：改名 / 删卡必须是有意识的改动，不能顺手发生。 */
const PERSONA_IDS = ['catgirl', 'translator', 'code-reviewer', 'gentle-senpai', 'chuuni-mage']
const REWRITE_IDS = ['hardcore', 'briefing']

/** 人设卡必须齐的五段标记（第一段是"身份锚"，没有标签，靠 `echoTextOf` 单独断言）。 */
const PERSONA_MARKERS = ['说话方式：', '边界：', '格式契约：', '样例：']

/** 人设正文的预算（字）：够写清行为即可；上限护住"别拿形容词换长度"。 */
const PERSONA_MIN = 250
const PERSONA_MAX = 600

/**
 * 硬邦邦的指纹（作者原词，**不许变**）。
 *
 * 换这两个值之前先确认：真的是作者本人要求改的，而不是你为了让测试变绿。
 */
const HARDCORE_CARD_SHA = 'e28cdccc6ad1baeb3a5ab0a00e5b2f7180118429020f5a1bc1ef8cd9c3af6e1c'
const HARDCORE_RULES_SHA = '78af1714297e2c162e4cc3118d9f20c8fb9fd16aa505a8d9a60e627c170df99c'
const HARDCORE_RULES_CHARS = 1014

/** 归一化后的卡（字段顺序固定，因此指纹只对内容敏感）。 */
function normalized(raw) {
  const { value, issues } = normalizeCard(raw, { source: 'preset' })
  return { value, issues }
}

test('预设包结构 + id 集合（改名/删卡必须是有意识的改动）', () => {
  for (const [file, ids] of [
    ['personas.json', PERSONA_IDS],
    ['rewriters.json', REWRITE_IDS],
  ]) {
    const pack = readPack(file)
    assert.equal(pack.format, 'dsh-cosplay-pack')
    assert.equal(pack.version, 1)
    assert.deepEqual(
      pack.cards.map((card) => card.id),
      ids,
      `${file} 的卡片 id/顺序变了 —— 这是契约改动，请显式确认`,
    )
    for (const card of pack.cards) assert.equal(card.source, 'preset', '预设卡必须标 source=preset')
  }
})

test('每张预设卡都能通过规范化，且零 issue', () => {
  for (const file of ['personas.json', 'rewriters.json']) {
    for (const raw of readPack(file).cards) {
      const { issues } = normalized(raw)
      assert.deepEqual(issues, [], `${raw.id} 规范化有 issue：${JSON.stringify(issues)}`)
    }
  }
})

test('人设卡齐五段：身份锚 + 说话方式 + 边界 + 格式契约 + 样例', () => {
  for (const raw of readPack('personas.json').cards) {
    const { value } = normalized(raw)
    const persona = value.persona ?? ''
    for (const marker of PERSONA_MARKERS) {
      assert.equal(persona.includes(marker), true, `${value.id} 缺少「${marker}」这一段`)
    }
    // 第一句是"身份锚"：它会被 personaEcho 自动搬到系统提示词末尾，所以必须能独立成立。
    const echo = echoTextOf(value)
    assert.equal(echo !== '', true, `${value.id} 取不到尾部回声（第一句可能是空行或标题行）`)
    assert.equal(echo, persona.split('\n')[0].trim(), `${value.id} 的锚点应当是正文第一行`)
    assert.equal(echo.length <= 60, true, `${value.id} 的锚点太长（${echo.length} 字），回声会被撑大`)
  }
})

test('人设正文长度在预算内', () => {
  for (const raw of readPack('personas.json').cards) {
    const length = (normalized(raw).value.persona ?? '').length
    assert.equal(length >= PERSONA_MIN, true, `${raw.id} 人设只有 ${length} 字，太瘦（下限 ${PERSONA_MIN}）`)
    assert.equal(length <= PERSONA_MAX, true, `${raw.id} 人设 ${length} 字，超预算（上限 ${PERSONA_MAX}）`)
  }
})

test('人设卡禁止绝对量化词（实测踩过的坑）', () => {
  // "每句话以喵~结尾"这类做不到的绝对约束，会让模型要么破坏格式、要么无视规则。
  const banned = [/每句话/, /每一句/, /永远不/, /绝不出现/, /100% ?/]
  for (const raw of readPack('personas.json').cards) {
    const persona = normalized(raw).value.persona ?? ''
    for (const pattern of banned) {
      assert.equal(pattern.test(persona), false, `${raw.id} 里出现了绝对量化词 ${String(pattern)}`)
    }
  }
})

test('边界句与格式句是"实义"的（不是占位）', () => {
  // 边界句必须交代"碰到不确定时怎么办" —— 措辞不强制统一，但必须是**其中一类**：
  // 说明不知道 / 标成待确认 / 保留原文待定（这套标记同步写在 playbook §1 里，别两处漂移）。
  const uncertainty = /不知道|未载|记不得|待确认|待定|没把握|不确定|看不懂/
  for (const raw of readPack('personas.json').cards) {
    const persona = normalized(raw).value.persona ?? ''
    const boundary = persona.split('边界：')[1]?.split('\n')[0] ?? ''
    const format = persona.split('格式契约：')[1]?.split('\n')[0] ?? ''
    assert.match(boundary, uncertainty, `${raw.id} 的边界句没写"不确定时怎么办"`)
    // 格式句必须点名那些"不许被角色改写"的东西。
    assert.match(format, /代码|命令|路径|报错|版本号/, `${raw.id} 的格式句没点名要原样保留的东西`)
  }
})

test('硬邦邦：rules 逐字节未改 + 整卡未改（作者原词，插件只搬运）', () => {
  const card = readPack('rewriters.json').cards.find((item) => item.id === 'hardcore')
  assert.equal(card !== undefined, true, '硬邦邦必须还在 rewriters.json 里')

  assert.equal(card.rewrite.rules.length, HARDCORE_RULES_CHARS, 'rules 字数变了 —— 这是作者原词，不该动')
  assert.equal(
    sha256(card.rewrite.rules),
    HARDCORE_RULES_SHA,
    '硬邦邦的 rules 被改动了。它来自作者粘贴的原文，插件不许润色；要改必须先问作者，再更新本测试里的指纹。',
  )
  assert.equal(
    sha256(JSON.stringify(normalized(card).value)),
    HARDCORE_CARD_SHA,
    '硬邦邦整卡指纹变了（rules 之外的字段也被动过）。若确实要改元数据，请显式更新本测试的指纹。',
  )
})

test('需求翻译机（插件自带的改写卡）：含长度契约与"不编造路径"', () => {
  const card = readPack('rewriters.json').cards.find((item) => item.id === 'briefing')
  const rules = card.rewrite.rules
  assert.match(rules, /长度控制在原文的 1–3 倍/, '缺长度契约（角色扮演会与指令遵循争资源，长度要写死）')
  assert.match(rules, /一律写成假设，不编造具体路径/, '缺"不编造路径/版本"的纪律')
  assert.match(rules, /逐条保留，不许改写掉/, '缺"已知条件逐条保留"')
})
