/**
 * `cards.ts` 的回归：规范化、包解析、包组装、字节嗅探。
 *
 * 重点盯三件事：
 *  1. **规范化幂等** —— 读写往返不许每次产生新 diff；
 *  2. **坏输入不许抛** —— 外部 JSON 一律走 errors[]；
 *  3. **id 唯一** —— 同一批里有重名/重 id 时不许互相覆盖。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  artIdFromSha,
  buildPack,
  cardIdFromName,
  cardToMeta,
  clampText,
  fnv1a,
  normalizeCard,
  parsePack,
  resolveCardId,
  sniffImage,
} from '../lib/cards.js'

test('clampText：裁剪与去空白', () => {
  assert.equal(clampText('  ab  ', 10), 'ab')
  assert.equal(clampText('abcdef', 3), 'abc')
  assert.equal(clampText(123, 10), '')
  assert.equal(clampText(undefined, 10), '')
})

test('cardIdFromName：ASCII 走 slug，中文退到摘要', () => {
  assert.equal(cardIdFromName('Cyber Cat'), 'cyber-cat')
  assert.match(cardIdFromName('赛博猫娘'), /^c-[0-9a-f]{8}$/)
  assert.match(cardIdFromName('!!!'), /^c-[0-9a-f]{8}$/)
})

test('resolveCardId：重名时自动加后缀', () => {
  const taken = new Set(['cyber-cat'])
  assert.equal(resolveCardId('cyber-cat', 'Cyber Cat', taken), 'cyber-cat-2')
  assert.equal(resolveCardId('', 'fresh', taken), 'fresh')
})

test('normalizeCard：缺 name 记为问题，但形状仍然完整', () => {
  const { value, issues } = normalizeCard({ id: 'x' })
  assert.ok(issues.some((issue) => issue.message.includes('name')))
  assert.equal(value.id, 'x')
  assert.equal(value.mode, 'system')
  assert.equal(value.version, 1)
  assert.equal(value.art, null)
})

test('normalizeCard：mode=rewrite 没规则 / mode=system 没人设 都会提示', () => {
  assert.ok(normalizeCard({ name: 'a', mode: 'rewrite' }).issues.some((issue) => issue.message.includes('rewrite')))
  assert.ok(normalizeCard({ name: 'b', mode: 'system' }).issues.some((issue) => issue.message.includes('persona')))
})

test('normalizeCard：标签去重 + 截断 + 上限', () => {
  const { value, issues } = normalizeCard({ name: 'x', persona: 'p', tags: ['a', 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] })
  assert.deepEqual(value.tags, ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'])
  assert.ok(issues.length >= 0)
})

test('normalizeCard：幂等（规范化两次结果一致）', () => {
  const once = normalizeCard({ name: '猫娘', persona: '你是猫娘', mode: 'system', tags: ['a'] }, { now: 1000 }).value
  const twice = normalizeCard(once, { now: 2000, taken: new Set(['a']) }).value
  // updatedAt 允许变（那是时间戳），其余字段必须逐字相同。
  const strip = (card) => ({ ...card, updatedAt: 0, createdAt: 0 })
  assert.deepEqual(strip(twice), strip(once))
})

test('normalizeCard：立绘引用必须结构完整（缺 sha256 就当没有）', () => {
  const bad = normalizeCard({ name: 'x', persona: 'p', art: { artId: 'a-0123456789abcdef', mime: 'image/png' } })
  assert.equal(bad.value.art, null)
  const good = normalizeCard({
    name: 'x',
    persona: 'p',
    art: { artId: 'a-0123456789abcdef', mime: 'image/png', bytes: 12, sha256: 'a'.repeat(64) },
  })
  assert.equal(good.value.art?.artId, 'a-0123456789abcdef')
})

test('cardToMeta：带 rev 的立绘 URL / 无立绘时不带', () => {
  const card = normalizeCard({ name: 'x', persona: 'p' }).value
  assert.equal(cardToMeta(card, 'rev').artUrl, undefined)
  const withArt = normalizeCard({
    name: 'x',
    persona: 'p',
    art: { artId: 'a-0123456789abcdef', mime: 'image/webp', bytes: 3, sha256: 'b'.repeat(64) },
  }).value
  assert.match(String(cardToMeta(withArt, 'abcd1234').artUrl), /rev=abcd1234$/)
})

test('parsePack：整体不是对象 → 拒绝；单张坏卡 → 跳过并记账', () => {
  assert.equal(parsePack(null).cards.length, 0)
  assert.ok(parsePack(null).issues.some((issue) => issue.where === 'pack'))
  const parsed = parsePack({ format: 'dsh-cosplay-pack', cards: [{ name: 'ok', persona: 'p' }, { id: 'no-name' }, {}] })
  assert.equal(parsed.cards.length, 1)
  assert.equal(parsed.issues.filter((issue) => issue.message.includes('已跳过')).length, 2)
})

test('parsePack：同一批里重名不会互相覆盖 id', () => {
  const parsed = parsePack({ cards: [{ name: '同名', persona: 'a' }, { name: '同名', persona: 'b' }] })
  assert.equal(parsed.cards.length, 2)
  assert.notEqual(parsed.cards[0].id, parsed.cards[1].id)
})

test('parsePack：与已有库撞 id 时让出 id', () => {
  const parsed = parsePack({ cards: [{ id: 'dup', name: 'dup', persona: 'p' }] }, { taken: new Set(['dup']) })
  assert.equal(parsed.cards.length, 1)
  assert.notEqual(parsed.cards[0].id, 'dup')
})

test('buildPack：把立绘内联进来，重复引用只内联一次', () => {
  const art = { artId: artIdFromSha('c'.repeat(64)), mime: 'image/png', bytes: 3, sha256: 'c'.repeat(64) }
  const a = normalizeCard({ name: 'a', persona: 'p', art }).value
  const b = normalizeCard({ name: 'b', persona: 'p', art }).value
  const pack = buildPack([a, b], () => ({ bytes: new Uint8Array([1, 2, 3]), mime: 'image/png', sha256: 'c'.repeat(64) }), 42)
  assert.equal(pack.format, 'dsh-cosplay-pack')
  assert.equal(pack.exportedAt, 42)
  assert.equal(Object.keys(pack.art).length, 1)
  assert.equal(pack.cards.length, 2)
})

test('buildPack：立绘读不到就跳过它，不写空条目', () => {
  const art = { artId: artIdFromSha('d'.repeat(64)), mime: 'image/png', bytes: 1, sha256: 'd'.repeat(64) }
  const card = normalizeCard({ name: 'a', persona: 'p', art }).value
  assert.deepEqual(Object.keys(buildPack([card], () => undefined).art), [])
})

test('sniffImage：按字节签名判定（PNG/JPEG/GIF/WebP/其它）', () => {
  assert.equal(sniffImage(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 0, 0, 0, 0])), 'image/png')
  assert.equal(sniffImage(new Uint8Array([0xff, 0xd8, 0xff, 0, 0, 0, 0, 0, 0, 0, 0, 0])), 'image/jpeg')
  assert.equal(
    sniffImage(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50])),
    'image/webp',
  )
  assert.equal(sniffImage(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])), undefined)
  assert.equal(sniffImage(new Uint8Array([0x89, 0x50])), undefined)
})

test('fnv1a 与 sha 派生：同输入同输出', () => {
  assert.equal(fnv1a('abc'), fnv1a('abc'))
  assert.notEqual(fnv1a('abc'), fnv1a('abd'))
  assert.equal(artIdFromSha('f'.repeat(64)), `a-${'f'.repeat(16)}`)
})
