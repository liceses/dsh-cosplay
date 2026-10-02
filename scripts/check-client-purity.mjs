/**
 * dsh-cosplay — 浏览器半边纯净化门禁。
 *
 * 两道检查，都对着**产物**说话（源码扫描只作为补充）：
 *
 * 1. **产物契约**：`lib/client.js` 必须是 GUI `__ModuleLoader__` 认的 CJS closure
 *    （`window.__ModuleLoader__.load({ id, factory })` + `return module.exports; } });`）。
 * 2. **模块表白名单**：bundle 里出现的每一个 `require("…")` 都必须落在运行时 seed 的 9 个
 *    平台模块里。"除平台模块外一律内联"是 tsdown 配置承诺的事，这里把它变成门禁 ——
 *    一次意外的跨半边 import 只会让用户看到一个"插件加载失败"的页面。
 *
 * 用法：`node scripts/check-client-purity.mjs`（`npm run check:client`）
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const BUNDLE = join(ROOT, 'lib', 'client.js')

/** 运行时 seed 的平台模块（0.1.7-rc.2 与 0.2.0-rc.1 逐字相同，实测）。 */
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

/** 源码里禁止出现在浏览器半边的名字（宿主专用）。 */
const FORBIDDEN_SOURCE_PATTERNS = [
  { re: /from\s+['"]node:/, why: 'node 内建模块' },
  { re: /require\(\s*['"]node:/, why: 'node 内建模块' },
  { re: /from\s+['"]@deepseek-ai\/schemastery['"]/, why: 'schemastery（宿主设置 schema）' },
  { re: /from\s+['"][^'"]*\/schema(\.js)?['"]/, why: 'schema.ts（会带进 schemastery）' },
  { re: /from\s+['"]node:fs['"]/, why: '文件系统' },
]

const failures = []

function fail(message) {
  failures.push(message)
}

// ── 1) 产物契约 ──────────────────────────────────────────────────────────────
let bundle = ''
try {
  bundle = readFileSync(BUNDLE, 'utf8')
} catch {
  console.error(`✗ 读不到产物 ${BUNDLE} —— 先跑 npm run build`)
  process.exit(1)
}

if (!bundle.startsWith('window.__ModuleLoader__.load(')) {
  fail('产物开头不是 window.__ModuleLoader__.load({ … })，GUI 不会装载它')
}
if (!bundle.includes('"id": "dsh-cosplay"') && !bundle.includes("id: 'dsh-cosplay'") && !bundle.includes('id: "dsh-cosplay"')) {
  fail('产物里的 module id 不是 dsh-cosplay')
}
// 去掉末尾的 sourcemap 注释再判 closure 结尾（tsdown 会把 //# sourceMappingURL 追加在最后）。
const stripped = bundle.replace(/\/\/# sourceMappingURL=.*$/m, '').trimEnd()
if (!/return module\.exports;\s*\}\s*\}\);$/.test(stripped)) {
  fail('产物结尾不是 `return module.exports; } });`，closure 不完整')
}

// ── 2) 模块表白名单 ──────────────────────────────────────────────────────────
const requires = new Set()
for (const match of bundle.matchAll(/require\(\s*["']([^"']+)["']\s*\)/g)) requires.add(match[1])
for (const spec of requires) {
  if (!PLATFORM_MODULES.has(spec)) fail(`产物 require 了非平台模块：${spec}（模块表里没有它 → 浏览器里会解析失败）`)
}

// ── 3) 源码补充扫描 ──────────────────────────────────────────────────────────
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else out.push(full)
  }
  return out
}

for (const file of walk(join(ROOT, 'src', 'client'))) {
  const text = readFileSync(file, 'utf8')
  for (const { re, why } of FORBIDDEN_SOURCE_PATTERNS) {
    if (re.test(text)) fail(`${relative(ROOT, file)} 里出现了禁止的 ${why}`)
  }
}

// ── 结论 ─────────────────────────────────────────────────────────────────────
if (failures.length > 0) {
  console.error('✗ 客户端纯净化检查未通过：')
  for (const message of failures) console.error(`  - ${message}`)
  process.exit(1)
}

console.log(`✓ 客户端纯净化检查通过：require 仅 [${[...requires].sort().join(', ')}]`)
