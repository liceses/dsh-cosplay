/**
 * 客户端产物契约：`lib/client.js` 必须是 GUI `__ModuleLoader__` 认的形状，
 * 且**只** require 运行时基线模块表里的东西。
 *
 * 这条测试是 `scripts/check-client-purity.mjs` 的单测版：门禁脚本会在 CI/prepublish 跑，
 * 这里保证"改坏了立刻有红灯"，而不是等到用户在浏览器里看到插件加载失败。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const BUNDLE = join(ROOT, 'lib', 'client.js')

/** 运行时 seed 的 9 个平台模块（0.1.7-rc.2 与 0.2.0-rc.1 逐字相同）。 */
const PLATFORM_MODULES = new Set([
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-dockkit',
])

/** 读产物。 */
function bundleText() {
  assert.equal(existsSync(BUNDLE), true, '先跑 npm run build（lib/client.js 不存在）')
  return readFileSync(BUNDLE, 'utf8')
}

test('产物是 __ModuleLoader__ 认的 CJS closure', () => {
  const text = bundleText()
  assert.equal(text.startsWith('window.__ModuleLoader__.load('), true)
  assert.match(text, /id:\s*"dsh-cosplay"/)
  const stripped = text.replace(/\/\/# sourceMappingURL=.*$/m, '').trimEnd()
  assert.match(stripped, /return module\.exports;\s*\}\s*\}\);$/)
})

test('产物的 require 全在基线模块表内', () => {
  const text = bundleText()
  const specs = new Set([...text.matchAll(/require\(\s*["']([^"']+)["']\s*\)/g)].map((match) => match[1]))
  for (const spec of specs) {
    assert.equal(PLATFORM_MODULES.has(spec), true, `产物 require 了非平台模块：${spec}`)
  }
  assert.ok(specs.size >= 1, '至少应有 react / react-jsx-runtime')
})

test('产物里没有宿主专用依赖的痕迹（schemastery / node 内建）', () => {
  const text = bundleText()
  for (const needle of ['schemastery', 'node:fs', 'node:path', 'node:crypto', 'node:os']) {
    assert.equal(text.includes(needle), false, `客户端产物里不该出现 ${needle}`)
  }
})

test('产物带 sourcemap 注释与导出面（apply / inject / CLIENT_BUILD）', () => {
  const text = bundleText()
  assert.match(text, /sourceMappingURL=client\.js\.map/)
  assert.match(text, /exports\.apply|apply:/)
  assert.match(text, /exports\.inject|inject:/)
  assert.match(text, /m1\.[0-9a-z.-]+/, '构建标记可用于核对"刷新后是不是新版"')
})
