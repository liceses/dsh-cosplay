/**
 * `library.ts` 的回归：预设只读、自定义增删改、立绘去重、导入导出、坏库隔离。
 *
 * 全程在**临时目录**里跑（每个用例一个 `mkdtempSync`），绝不碰用户真实的
 * `<DSH_HOME>/cosplay`。清理前做前缀校验（AGENTS.md 的硬规则）。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createLibrary, resolveLibraryPaths } from '../lib/library.js'

/** 造一个临时沙箱。 */
function sandbox() {
  const dir = mkdtempSync(join(tmpdir(), 'cosplay-lib-'))
  const presetDir = join(dir, 'presets')
  const root = join(dir, 'library')
  mkdirSync(presetDir, { recursive: true })
  return {
    dir,
    presetDir,
    root,
    /** 写一个预设文件。 */
    preset(file, cards) {
      writeFileSync(join(presetDir, file), JSON.stringify({ format: 'dsh-cosplay-pack', version: 1, cards, art: {} }), 'utf8')
    },
    done() {
      const allowed = join(tmpdir(), 'cosplay-lib-')
      if (!dir.startsWith(allowed)) throw new Error(`refusing to delete ${dir}`)
      rmSync(dir, { recursive: true, force: true })
    },
  }
}

/** 建库（预设目录显式传入，绝不读包内预设）。 */
function open(box, now) {
  return createLibrary({
    root: box.root,
    presetDir: box.presetDir,
    ...(now === undefined ? {} : { now }),
  })
}

/** 一张 PNG 的最小字节（够 sniffImage 认出来）。 */
function pngBytes(seed) {
  return new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, seed, seed, seed, seed])
}

test('resolveLibraryPaths：留空 = <DSH_HOME>/cosplay；显式根与预设目录生效', () => {
  const paths = resolveLibraryPaths('')
  assert.match(paths.root, /cosplay$/)
  assert.match(paths.library, /library\.json$/)
  assert.match(paths.artDir, /art$/)
  const explicit = resolveLibraryPaths(join(tmpdir(), 'xyz'), join(tmpdir(), 'presets'))
  assert.equal(explicit.root, join(tmpdir(), 'xyz'))
  assert.equal(explicit.presetDir, join(tmpdir(), 'presets'))
})

test('预设卡：读得进来、只读、排序稳定', () => {
  const box = sandbox()
  try {
    box.preset('a.json', [{ id: 'preset-a', name: '预设甲', persona: 'p', mode: 'system' }])
    box.preset('b.json', [{ id: 'preset-b', name: '预设乙', persona: 'p', mode: 'system' }])
    const library = open(box)
    assert.equal(library.list().length, 2)
    assert.deepEqual(library.list().map((card) => card.id), ['preset-a', 'preset-b'])
    assert.equal(library.list()[0].source, 'preset')

    // 改预设 = 被拒（预设随包走，升级时会更新；改动只能通过"复制为自定义"）。
    const refused = library.upsert({ id: 'preset-a', name: '改预设', persona: 'x' })
    assert.equal(refused.card, undefined)
    assert.ok(refused.issues[0].message.includes('只读'))

    // 复制为自定义：拿到新 id。
    const copied = library.copyCard('preset-a')
    assert.equal(copied.card?.source, 'custom')
    assert.notEqual(copied.card?.id, 'preset-a')
    assert.equal(library.list().length, 3)
  } finally {
    box.done()
  }
})

test('自定义卡：落盘 + 重开仍在 + 删除生效', () => {
  const box = sandbox()
  try {
    box.preset('a.json', [{ id: 'preset-a', name: '预设甲', persona: 'p' }])
    const first = open(box, () => 1000)
    const created = first.upsert({ name: '我的卡', persona: '你是我的卡', tags: ['x', 'y'] })
    assert.equal(created.card?.source, 'custom')
    assert.ok(existsSync(first.paths.library), 'library.json 应已落盘')
    const onDisk = JSON.parse(readFileSync(first.paths.library, 'utf8'))
    assert.equal(onDisk.cards.length, 1)
    assert.equal(onDisk.format, 'dsh-cosplay-library')

    const second = open(box)
    assert.equal(second.list().length, 2)
    assert.equal(second.get(created.card.id)?.name, '我的卡')

    assert.equal(second.remove(created.card.id), true)
    assert.equal(second.remove('nope'), false)
    const third = open(box)
    assert.equal(third.list().length, 1)
  } finally {
    box.done()
  }
})

test('立绘：按内容去重；非图片被拒；字节落盘', () => {
  const box = sandbox()
  try {
    const library = open(box)
    const bytes = pngBytes(7)
    const first = library.putArt({ bytes, width: 10, height: 20 })
    assert.equal(first.art?.mime, 'image/png')
    assert.equal(first.art?.width, 10)

    const again = library.putArt({ bytes: pngBytes(7) })
    assert.equal(again.art?.artId, first.art?.artId, '同样的字节应复用同一个 artId')
    assert.equal(readdirSync(library.paths.artDir).length, 1, '去重后只应有一个文件')

    const rejected = library.putArt({ bytes: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]) })
    assert.equal(rejected.art, null)
    assert.ok(rejected.issues[0].message.includes('PNG'))

    const read = library.artBytes(String(first.art?.artId))
    assert.deepEqual([...(read?.bytes ?? [])], [...bytes])
  } finally {
    box.done()
  }
})

test('导入/导出：立绘内联往返、预设 id 让位、重复导入覆盖而非堆叠', () => {
  const box = sandbox()
  try {
    box.preset('a.json', [{ id: 'hardcore', name: '硬邦邦', mode: 'rewrite', rewrite: { rules: 'r' } }])
    const library = open(box)
    const art = library.putArt({ bytes: pngBytes(3) })

    const pack = {
      format: 'dsh-cosplay-pack',
      version: 1,
      cards: [
        { id: 'mine', name: '我的卡', persona: 'p', art: art.art },
        { id: 'hardcore', name: '硬邦邦', mode: 'rewrite', rewrite: { rules: 'x' } },
      ],
      art: {
        [String(art.art?.artId)]: { mime: 'image/png', base64: Buffer.from(pngBytes(3)).toString('base64'), sha256: art.art?.sha256 },
      },
    }

    const first = library.importPack(pack)
    assert.equal(first.ok, true)
    assert.equal(first.added, 2, '一张新增 + 预设撞名的那张改名导入')
    assert.ok(first.errors.some((line) => line.includes('与预设卡同名')))

    const second = library.importPack(pack)
    assert.equal(second.replaced >= 1, true, '第二次应覆盖第一张')
    assert.equal(library.list().filter((card) => card.name === '我的卡').length, 1)

    const exported = library.exportPack()
    const mine = exported.cards.find((card) => card.name === '我的卡')
    assert.equal(mine.art?.artId, art.art?.artId)
    assert.ok(Object.keys(exported.art).length >= 1, '导出应内联立绘字节')

    const written = library.writeExport(exported)
    assert.ok(existsSync(written))
    assert.match(written, /exports/)
  } finally {
    box.done()
  }
})

test('坏库隔离：解析失败改名留证，库照常可用', () => {
  const box = sandbox()
  try {
    mkdirSync(box.root, { recursive: true })
    writeFileSync(join(box.root, 'library.json'), '{ this is not json', 'utf8')
    const library = open(box)
    assert.equal(library.list().length, 0)
    const leftovers = readdirSync(box.root).filter((name) => name.includes('.corrupt-'))
    assert.equal(leftovers.length, 1, '坏文件应被改名留证')
    const created = library.upsert({ name: '新卡', persona: 'p' })
    assert.ok(created.card !== undefined)
  } finally {
    box.done()
  }
})

test('无引用立绘：识别与清理', () => {
  const box = sandbox()
  try {
    const library = open(box)
    const used = library.putArt({ bytes: pngBytes(1) })
    library.putArt({ bytes: pngBytes(2) })
    library.upsert({ name: '带立绘', persona: 'p', art: used.art })
    assert.equal(library.orphanArt().length, 1)
    assert.equal(library.pruneOrphanArt(), 1)
    assert.equal(library.orphanArt().length, 0)
    assert.equal(readdirSync(library.paths.artDir).length, 1)
  } finally {
    box.done()
  }
})

test('info：预设/自定义/立绘计数与体积', () => {
  const box = sandbox()
  try {
    box.preset('a.json', [{ id: 'preset-a', name: '预设甲', persona: 'p' }])
    const library = open(box)
    library.upsert({ name: '自定义', persona: 'p' })
    library.putArt({ bytes: pngBytes(9) })
    const info = library.info()
    assert.equal(info.presets, 1)
    assert.equal(info.customs, 1)
    assert.equal(info.cards, 2)
    assert.equal(info.artFiles, 1)
    assert.equal(info.root, library.paths.root)
  } finally {
    box.done()
  }
})

test('预设目录不存在也不致命（只有自定义卡可用）', () => {
  const box = sandbox()
  try {
    rmSync(box.presetDir, { recursive: true, force: true })
    const library = open(box)
    assert.equal(library.list().length, 0)
    assert.ok(library.upsert({ name: 'x', persona: 'p' }).card !== undefined)
  } finally {
    box.done()
  }
})

test('预设热重载：改预设文件后，同一个库实例立刻读到新文案（无需重启应用）', () => {
  const box = sandbox()
  try {
    box.preset('a.json', [{ id: 'p1', name: '旧名字', persona: '旧人设' }])
    const library = createLibrary({ root: box.root, presetDir: box.presetDir, presetCheckIntervalMs: 0 })
    assert.equal(library.get('p1')?.name, '旧名字')

    // 模拟"只改数据"：同一个库实例，没有重建、没有 invalidate、没有重启。
    box.preset('a.json', [{ id: 'p1', name: '新名字', persona: '新人设' }])
    assert.equal(library.get('p1')?.name, '新名字')
    assert.equal(library.metas()[0].name, '新名字')
    assert.equal(library.info().presets, 1)

    // 新增一个预设文件也会被发现。
    box.preset('b.json', [{ id: 'p2', name: '第二张', persona: 'p' }])
    assert.deepEqual(library.list().map((card) => card.id), ['p1', 'p2'])
  } finally {
    box.done()
  }
})

test('预设重载不会碰自定义卡与立绘索引', () => {
  const box = sandbox()
  try {
    box.preset('a.json', [{ id: 'p1', name: '预设', persona: 'p' }])
    const library = createLibrary({ root: box.root, presetDir: box.presetDir, presetCheckIntervalMs: 0 })
    const created = library.upsert({ name: '我的卡', persona: 'p' })
    const art = library.putArt({ bytes: pngBytes(5) })
    box.preset('a.json', [{ id: 'p1', name: '预设改名', persona: 'p' }])
    assert.equal(library.get('p1')?.name, '预设改名')
    assert.equal(library.get(created.card?.id)?.name, '我的卡')
    assert.equal(library.artBytes(String(art.art?.artId)) !== undefined, true)
  } finally {
    box.done()
  }
})

test('预设卡里的 rules 会被原样保留（不做任何改写）', () => {
  const box = sandbox()
  try {
    // 这条是给"预设文案必须是我给的原词"立的护栏：规范化不许动文本内容。
    const verbatim = '# Role: 测试\n\n- 第一行\n- 第二行\n\n---\n\n## 工作流规则\n- 直接输出。'
    box.preset('a.json', [{ id: 'rw', name: '改写卡', mode: 'rewrite', rewrite: { rules: verbatim } }])
    const library = createLibrary({ root: box.root, presetDir: box.presetDir, presetCheckIntervalMs: 0 })
    assert.equal(library.get('rw')?.rewrite?.rules, verbatim)
  } finally {
    box.done()
  }
})
