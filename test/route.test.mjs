/**
 * `route.ts` 的回归：围栏、卡片 CRUD、立绘字节、导入导出、会话绑定、诊断。
 *
 * 用**真的 library + state**（临时目录）+ 假 req/res 打真路由处理器 —— 不经过 HTTP，
 * 但走的完全是生产代码路径（含围栏、体积上限、ETag/304、字节签名校验）。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createLibrary } from '../lib/library.js'
import { createState } from '../lib/state.js'
import { createCosplayRoute } from '../lib/route.js'
import { createTrace } from '../lib/trace.js'

/** 沙箱 + 路由。 */
function setup({ llm } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'cosplay-route-'))
  const presetDir = join(dir, 'presets')
  mkdirSync(presetDir, { recursive: true })
  writeFileSync(
    join(presetDir, 'p.json'),
    JSON.stringify({ cards: [{ id: 'preset-a', name: '预设甲', persona: '你是预设甲' }] }),
    'utf8',
  )
  const root = join(dir, 'library')
  const library = createLibrary({ root, presetDir })
  const state = createState(join(root, 'state.json'), () => 1000)
  const trace = createTrace(50)
  const stats = {
    sectionCalls: 0,
    sectionFilled: 0,
    preStepCalls: 0,
    preStepRewrote: 0,
    rewrite: { calls: 0, ok: 0, failed: 0, cached: 0, lastMs: 0, lastModel: '' },
    durableUserMessages: 0,
  }
  const probe = { armed: false, touched: new Set(), sessions: [] }
  const route = createCosplayRoute({
    ctx: { get: () => undefined, logger: { info: () => {} } },
    config: () => ({
      enabled: true,
      strategy: 'card',
      defaultCardId: '',
      showTab: true,
      coverAspect: 1,
      artMaxEdge: 1024,
      artQuality: 0.85,
      rewriteProvider: '',
      rewriteModel: '',
      rewriteTimeoutMs: 5000,
      rewriteOnFailure: 'original',
    }),
    stats,
    trace,
    probe,
    library: () => library,
    state: () => state,
    rewrite: llm ?? (async () => ({ ok: true, text: '改写好了', model: 'p/m', ms: 3, error: '', cached: false })),
  })
  return {
    library,
    state,
    trace,
    stats,
    probe,
    route,
    done() {
      const allowed = join(tmpdir(), 'cosplay-route-')
      if (!dir.startsWith(allowed)) throw new Error(`refusing to delete ${dir}`)
      rmSync(dir, { recursive: true, force: true })
    },
  }
}

/** 打一次路由。 */
async function call(route, method, url, body, headers = {}) {
  const chunks = []
  const res = {
    statusCode: 0,
    headers: {},
    writeHead(status, extra) {
      this.statusCode = status
      this.headers = extra ?? {}
      return this
    },
    end(payload) {
      if (payload !== undefined) chunks.push(Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload)))
      return this
    },
  }
  const listeners = {}
  const req = {
    method,
    url,
    headers: { host: '127.0.0.1:19387', ...headers },
    setEncoding() {},
    on(event, callback) {
      listeners[event] = callback
      return this
    },
    destroy() {
      listeners.error?.(new Error('destroyed'))
    },
  }
  const promise = route.handler(req, res)
  if (body !== undefined) listeners.data?.(typeof body === 'string' ? body : JSON.stringify(body))
  listeners.end?.()
  await promise
  const raw = Buffer.concat(chunks)
  let json
  try {
    json = JSON.parse(raw.toString('utf8'))
  } catch {
    json = undefined
  }
  return { status: res.statusCode, headers: res.headers, raw, json }
}

test('围栏：非回环 Host 一律 403', async () => {
  const box = setup()
  try {
    const result = await call(box.route, 'GET', '/api/dsh-cosplay/stats', undefined, { host: 'evil.example.com' })
    assert.equal(result.status, 403)
  } finally {
    box.done()
  }
})

test('GET /library：元数据投影（不含正文）', async () => {
  const box = setup()
  try {
    const result = await call(box.route, 'GET', '/api/dsh-cosplay/library')
    assert.equal(result.status, 200)
    assert.equal(result.json.ok, true)
    assert.equal(result.json.cards.length, 1)
    assert.equal(result.json.cards[0].hasPersona, true)
    assert.equal('persona' in result.json.cards[0], false, '投影里不该带正文')
    assert.match(result.json.root, /library$/)
  } finally {
    box.done()
  }
})

test('卡片 CRUD：新建 → 读全文 → 复制 → 删除；预设只读被拒', async () => {
  const box = setup()
  try {
    const created = await call(box.route, 'POST', '/api/dsh-cosplay/card', { card: { name: '我的卡', persona: '你是我的卡' } })
    assert.equal(created.status, 200)
    const id = created.json.card.id

    const full = await call(box.route, 'GET', `/api/dsh-cosplay/card/${id}`)
    assert.equal(full.json.card.persona, '你是我的卡')

    const copied = await call(box.route, 'POST', '/api/dsh-cosplay/card/copy', { id: 'preset-a' })
    assert.equal(copied.status, 200)
    assert.notEqual(copied.json.card.id, 'preset-a')

    const refused = await call(box.route, 'POST', '/api/dsh-cosplay/card', { card: { id: 'preset-a', name: '改预设', persona: 'x' } })
    assert.equal(refused.status, 400)
    assert.ok(refused.json.issues[0].message.includes('只读'))

    const removed = await call(box.route, 'POST', '/api/dsh-cosplay/card/delete', { id })
    assert.equal(removed.status, 200)
    const missing = await call(box.route, 'GET', `/api/dsh-cosplay/card/${id}`)
    assert.equal(missing.status, 404)
  } finally {
    box.done()
  }
})

test('立绘：非图片 415、图片 200、按内容去重、非法 id 400、ETag 304', async () => {
  const box = setup()
  try {
    const bad = await call(box.route, 'POST', '/api/dsh-cosplay/art', { base64: Buffer.from('not an image').toString('base64') })
    assert.equal(bad.status, 415)

    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4])
    const stored = await call(box.route, 'POST', '/api/dsh-cosplay/art', { base64: png.toString('base64'), width: 8, height: 8 })
    assert.equal(stored.status, 200)
    assert.equal(stored.json.art.mime, 'image/png')
    assert.equal(stored.json.art.width, 8)

    const again = await call(box.route, 'POST', '/api/dsh-cosplay/art', { base64: png.toString('base64') })
    assert.equal(again.json.art.artId, stored.json.art.artId, '同样字节应去重')

    const artId = stored.json.art.artId
    const served = await call(box.route, 'GET', `/api/dsh-cosplay/art/${artId}`)
    assert.equal(served.status, 200)
    assert.equal(served.headers['Content-Type'], 'image/png')
    assert.equal(served.headers['Cache-Control'].includes('immutable'), true)

    const cached = await call(box.route, 'GET', `/api/dsh-cosplay/art/${artId}`, undefined, { 'if-none-match': served.headers.ETag })
    assert.equal(cached.status, 304)

    const badId = await call(box.route, 'GET', '/api/dsh-cosplay/art/..%2Fetc%2Fpasswd')
    assert.equal(badId.status, 400)
  } finally {
    box.done()
  }
})

test('导出/落盘/导入：往返一次卡片与立绘都在', async () => {
  const box = setup()
  try {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9, 9, 9, 9])
    const art = (await call(box.route, 'POST', '/api/dsh-cosplay/art', { base64: png.toString('base64') })).json.art
    await call(box.route, 'POST', '/api/dsh-cosplay/card', { card: { id: 'mine', name: '我的卡', persona: 'p', art } })

    const exported = await call(box.route, 'GET', '/api/dsh-cosplay/export')
    assert.equal(exported.status, 200)
    assert.equal(exported.json.format, 'dsh-cosplay-pack')
    assert.ok(Object.keys(exported.json.art).length >= 1)

    const written = await call(box.route, 'POST', '/api/dsh-cosplay/export/write', {})
    assert.equal(written.status, 200)
    assert.match(written.json.path, /exports/)

    // 清空自定义卡后再导入，应该恢复。
    await call(box.route, 'POST', '/api/dsh-cosplay/card/delete', { id: 'mine' })
    const imported = await call(box.route, 'POST', '/api/dsh-cosplay/import', { pack: exported.json })
    assert.equal(imported.status, 200)
    assert.equal(imported.json.added >= 1, true)
    const restored = await call(box.route, 'GET', '/api/dsh-cosplay/card/mine')
    assert.equal(restored.json.card.name, '我的卡')
  } finally {
    box.done()
  }
})

test('会话绑定：读写 + 诊断里能看到', async () => {
  const box = setup()
  try {
    const empty = await call(box.route, 'GET', '/api/dsh-cosplay/binding?sessionId=s1')
    assert.equal(empty.status, 200)
    assert.equal(empty.json.binding.cardId, null)

    const written = await call(box.route, 'POST', '/api/dsh-cosplay/binding', { sessionId: 's1', cardId: 'preset-a' })
    assert.equal(written.status, 200)
    assert.equal(written.json.binding.cardId, 'preset-a')

    const read = await call(box.route, 'GET', '/api/dsh-cosplay/binding?sessionId=s1')
    assert.equal(read.json.card.name, '预设甲')
    assert.equal(read.json.card.source, 'preset')

    const off = await call(box.route, 'POST', '/api/dsh-cosplay/binding', { sessionId: 's1', enabled: false })
    assert.equal(off.json.binding.enabled, false)

    const missing = await call(box.route, 'POST', '/api/dsh-cosplay/binding', {})
    assert.equal(missing.status, 400)

    const diagnostics = await call(box.route, 'GET', '/api/dsh-cosplay/diagnostics?sessionId=s1')
    assert.equal(diagnostics.json.binding.cardId, 'preset-a')
    assert.equal(Array.isArray(diagnostics.json.trace), true)
  } finally {
    box.done()
  }
})

test('手动改写端点：成功返回清洗后的正文；没有卡的请求 404', async () => {
  const box = setup()
  try {
    const ok = await call(box.route, 'POST', '/api/dsh-cosplay/rewrite', { sessionId: 's1', cardId: 'preset-a', text: '画个球' })
    // preset-a 是人设卡（没有 rewrite.rules）→ 应当被拒。
    assert.equal(ok.status, 400)
    assert.match(ok.json.error, /rewrite\.rules/)

    await call(box.route, 'POST', '/api/dsh-cosplay/card', { card: { id: 'rw', name: '改写卡', mode: 'rewrite', rewrite: { rules: 'r' } } })
    const good = await call(box.route, 'POST', '/api/dsh-cosplay/rewrite', { sessionId: 's1', cardId: 'rw', text: '画个球' })
    assert.equal(good.status, 200)
    assert.equal(good.json.text, '改写好了')
    assert.equal(good.json.cardName, '改写卡')

    const noText = await call(box.route, 'POST', '/api/dsh-cosplay/rewrite', { sessionId: 's1' })
    assert.equal(noText.status, 400)

    const noCard = await call(box.route, 'POST', '/api/dsh-cosplay/rewrite', { sessionId: 's1', cardId: 'ghost', text: 'x' })
    assert.equal(noCard.status, 404)
  } finally {
    box.done()
  }
})

test('诊断端点与 404：/stats 可读，未知路径 404', async () => {
  const box = setup()
  try {
    const stats = await call(box.route, 'GET', '/api/dsh-cosplay/stats')
    assert.equal(stats.status, 200)
    assert.equal(stats.json.plugin, 'dsh-cosplay')
    assert.equal(typeof stats.json.stats.preStepCalls, 'number')

    const debug = await call(box.route, 'POST', '/api/dsh-cosplay/debug', { kind: 'client-apply', note: 'hi' })
    assert.equal(debug.status, 200)
    assert.ok(box.trace.list().some((entry) => entry.kind === 'client:client-apply'))

    const missing = await call(box.route, 'GET', '/api/dsh-cosplay/nope')
    assert.equal(missing.status, 404)
    assert.match(missing.json.error, /unknown cosplay route/)
  } finally {
    box.done()
  }
})
