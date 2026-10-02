/**
 * 装配级集成测试：用**桩服务**把 `apply()` 真跑一遍。
 *
 * 验证四件事真的挂上了：路由、人设提示段、pre-step 钩子、`/cosplay` 命令；
 * 并且把"绑定一张卡 → 提示段产出正文"这条链在进程内走通（不碰正在运行的 GUI）。
 *
 * `DSH_HOME` 指向临时目录：测试绝不读写用户真实的 `<DSH_HOME>/cosplay`。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const verifyHome = mkdtempSync(join(tmpdir(), 'cosplay-home-'))
process.env.DSH_HOME = verifyHome

const { apply, Config } = await import('../lib/index.js')
const { DEFAULT_CONFIG } = await import('../lib/config.js')
const { resolveLive } = await import('../lib/schema.js')
const { PROMPT_SECTION, PROMPT_ECHO_SECTION, ROUTE_PREFIX } = await import('../lib/protocol.js')

/** 造一个假 ctx，记录所有注册。 */
function makeHarness({ promptSectionOrder = 0 } = {}) {
  const routes = []
  const commands = []
  const listeners = new Map()
  const disposers = []
  const sections = []
  const live = Object.fromEntries(Object.keys(DEFAULT_CONFIG).map((key) => [key, { get: () => DEFAULT_CONFIG[key] }]))
  const ctx = {
    fiber: { uid: 1 },
    logger: { info: () => {}, warn: () => {} },
    webServer: {
      register(route) {
        routes.push(route)
        return () => {}
      },
    },
    get(name) {
      if (name === 'systemPrompt') {
        return {
          // 官方 order 表的值（prefix=0 / suffix=10200），两个锚点都认。
          getSectionOrder: (anchor) =>
            anchor === 'DEPLOYMENT_PERSONA_SUFFIX' ? 10200 : promptSectionOrder,
          section(section) {
            sections.push(section)
            return () => {}
          },
        }
      }
      if (name === 'commands') return { register: (command) => (commands.push(command), () => {}) }
      if (name === 'clientModules') {
        return { graph: () => ({ rev: 'rev', entries: [{ id: 'dsh-cosplay', url: 'plugins/??dsh-cosplay/client.js' }] }), onGraphChanged: () => () => {} }
      }
      return undefined
    },
    on(name, listener) {
      listeners.set(name, listener)
      return () => listeners.delete(name)
    },
    effect(callback) {
      const value = callback()
      if (typeof value === 'function') disposers.push(value)
      return value
    },
    inject(_deps, callback) {
      callback(ctx)
      return () => {}
    },
  }
  return { ctx, routes, commands, listeners, disposers, sections, live }
}

test('Config 是导出的 schemastery 对象，且覆盖 DEFAULT_CONFIG 的每个字段', () => {
  assert.equal(typeof Config, 'function')
  const resolved = resolveLive(Object.fromEntries(Object.keys(DEFAULT_CONFIG).map((key) => [key, { get: () => undefined }])))
  for (const key of Object.keys(DEFAULT_CONFIG)) {
    assert.equal(resolved[key], DEFAULT_CONFIG[key], `${key} 的默认值应能被补全`)
  }
})

test('apply()：路由 / 提示段 / pre-step 钩子 / 命令全部挂上', () => {
  const box = makeHarness()
  apply(box.ctx, box.live)

  assert.equal(box.routes.length, 1)
  assert.equal(box.routes[0].kind, 'prefix')
  assert.equal(box.routes[0].path, ROUTE_PREFIX)

  // 两段：人设段（开头附近）+ 尾部回声段（真末尾，默认关）。
  assert.equal(box.sections.length, 2)
  assert.equal(box.sections[0].name, PROMPT_SECTION)
  assert.equal(box.sections[0].order, 1, '应紧跟部署人设（锚点 0 + 1）')
  assert.equal(box.sections[0].interpolate, false, '用户文本必须按字面渲染')
  assert.equal(box.sections[1].name, PROMPT_ECHO_SECTION)
  assert.equal(box.sections[1].order, 10201, '回声落在所有官方段之后（DEPLOYMENT_PERSONA_SUFFIX=10200 + 1）')

  assert.equal(typeof box.listeners.get('agent/pre-step'), 'function')
  assert.equal(typeof box.listeners.get('session/event'), 'function')

  assert.equal(box.commands.length, 1)
  assert.equal(box.commands[0].name, 'cosplay')

  assert.ok(box.disposers.length >= 4, '每个能力都应挂在 effect 上（停用即净）')
})

test('提示段的锚点变了也能兜底（getSectionOrder 抛错时不崩）', () => {
  const box = makeHarness()
  box.ctx.get = (name) => {
    if (name === 'systemPrompt') {
      return {
        getSectionOrder() {
          throw new Error('锚点改名了')
        },
        section(section) {
          box.sections.push(section)
          return () => {}
        },
      }
    }
    return undefined
  }
  apply(box.ctx, box.live)
  assert.equal(box.sections.length, 2)
  assert.equal(box.sections[0].order, 1, '兜底顺序 = 1')
  assert.equal(box.sections[1].order, 10201, '回声的兜底顺序 = 10201')
})

test('端到端：绑定一张人设卡 → 提示段产出正文；关掉会话 → 归零', () => {
  const home = join(verifyHome, 'e2e')
  mkdirSync(home, { recursive: true })
  const box = makeHarness()
  // 用临时 store 指到子目录：把 storagePath 指过去。
  const scoped = Object.fromEntries(Object.keys(DEFAULT_CONFIG).map((key) => [key, { get: () => DEFAULT_CONFIG[key] }]))
  scoped.storagePath = { get: () => home }
  apply(box.ctx, scoped)

  const section = box.sections[0]
  const text = (sessionId) => section.text({ agent: { id: sessionId } })
  assert.equal(text('s1'), '', '没有绑定时不注入')

  // 通过路由建一张卡 + 绑定（走真实生产路径）。
  const req = (method, url, body) => {
    const chunks = []
    const res = {
      writeHead(status, headers) {
        this.statusCode = status
        this.headers = headers
      },
      end(payload) {
        if (payload !== undefined) chunks.push(Buffer.from(String(payload)))
      },
    }
    const events = {}
    const request = {
      method,
      url,
      headers: { host: '127.0.0.1:19387' },
      setEncoding() {},
      on(event, callback) {
        events[event] = callback
        return this
      },
      destroy() {},
    }
    const promise = box.routes[0].handler(request, res)
    if (body !== undefined) events.data?.(JSON.stringify(body))
    events.end?.()
    return promise.then(() => JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'))
  }

  return (async () => {
    const created = await req('POST', `${ROUTE_PREFIX}/card`, { card: { id: 'my-catgirl', name: '我的猫娘', persona: '你是猫娘，每句话以喵~结尾' } })
    assert.equal(created.ok, true)
    await req('POST', `${ROUTE_PREFIX}/binding`, { sessionId: 's1', cardId: 'my-catgirl' })

    const injected = text('s1')
    assert.ok(injected.includes('你是猫娘'), '人设正文应被注入')
    assert.ok(injected.includes('扮演纪律：'))

    await req('POST', `${ROUTE_PREFIX}/binding`, { sessionId: 's1', enabled: false })
    assert.equal(text('s1'), '', '会话关掉后零注入')

    await req('POST', `${ROUTE_PREFIX}/binding`, { sessionId: 's1', enabled: true })
    assert.ok(text('s1').includes('你是猫娘'))

    rmSync(home, { recursive: true, force: true })
  })()
})

test('清理临时家目录', () => {
  const allowed = join(tmpdir(), 'cosplay-home-')
  if (!verifyHome.startsWith(allowed)) throw new Error(`refusing to delete ${verifyHome}`)
  rmSync(verifyHome, { recursive: true, force: true })
})
