/**
 * 兼容性回归：`@deepseek-ai/dsh-*` 的 peer 区间必须同时容纳受支持的每个运行时。
 *
 * 为什么这条必须有测试：DSH 启动期的兼容闸门（`dsh-app-boot` 的
 * `evaluatePluginCompatibility`）只认 `peerDependencies` 里的 `@deepseek-ai/dsh-*`，
 * 且用 `semver.satisfies(runtime, range, { includePrerelease: true })` 判定。
 * **预发布版 + caret 是个坑**：`^0.1.7-rc.1` 的上界是 `0.2.0`（不含），
 * 碰到 `0.2.0-rc.1` 必然被拒 —— 2026-09-28 就是这样被桌面端拒过一次。
 * 所以跨小版本一律写显式区间 `>=A <B`。
 *
 * 本用例在两个运行时上都断一遍：0.1.7-rc.2（npm 全局 CLI 的 web profile）
 * 与 0.2.0-rc.1（DSH Desktop）。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import semver from 'semver'

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))

/** 受支持的运行时版本。 */
const RUNTIMES = ['0.1.7-rc.2', '0.2.0-rc.1']

/** 参与闸门的 peer（DSH 自己的包）。 */
function gatedPeers() {
  return Object.entries(manifest.peerDependencies ?? {}).filter(([name]) => name === '@deepseek-ai/dsh' || name.startsWith('@deepseek-ai/dsh-'))
}

test('peer 里确实有一批 @deepseek-ai/dsh-*（闸门扫的就是它们）', () => {
  assert.ok(gatedPeers().length >= 8, `实际只有 ${gatedPeers().length} 个`)
})

test('每个 dsh-* peer 区间都容纳 0.1.7-rc.2 与 0.2.0-rc.1', () => {
  const failures = []
  for (const [name, range] of gatedPeers()) {
    for (const runtime of RUNTIMES) {
      if (!semver.satisfies(runtime, range, { includePrerelease: true })) {
        failures.push(`${name}@${range} 不满足 ${runtime}`)
      }
    }
  }
  assert.deepEqual(failures, [])
})

test('engines.dsh 声明与之一致（不参与闸门，但别自相矛盾）', () => {
  const range = manifest.engines?.dsh
  assert.equal(typeof range, 'string')
  for (const runtime of RUNTIMES) {
    assert.equal(semver.satisfies(runtime, range, { includePrerelease: true }), true, `engines.dsh=${range} 应容纳 ${runtime}`)
  }
})

test('caret 反例：证明这个坑是真的（回归护栏）', () => {
  assert.equal(semver.satisfies('0.2.0-rc.1', '^0.1.7-rc.1', { includePrerelease: true }), false)
  assert.equal(semver.satisfies('0.1.7-rc.2', '^0.1.7-rc.1', { includePrerelease: true }), true)
  assert.equal(semver.satisfies('0.2.0-rc.1', '>=0.1.7-rc.1 <0.3', { includePrerelease: true }), true)
})

test('客户端声明：platform=web，且不依赖非基线的模块请求', () => {
  const client = manifest.dsh?.client
  assert.equal(client?.platform, 'web')
  assert.equal(client?.external ?? undefined, undefined, '本插件只需要基线模块表，不需要额外 external 请求')
  const inject = client?.inject ?? []
  assert.ok(Array.isArray(inject))
  // inject 是"信息性边"，只允许写真实存在于运行时的包。
  for (const name of inject) assert.match(name, /^@deepseek-ai\/dsh-client-ui-/)
})

test('bundle patch 与条目 id 自洽', () => {
  const patch = manifest.dsh?.bundle?.patch
  assert.equal(typeof patch, 'string')
  const yml = readFileSync(join(ROOT, patch), 'utf8')
  assert.match(yml, /id:\s*cosplay/)
  assert.match(yml, /name:\s*'dsh-cosplay'/)
  assert.equal(manifest.name, 'dsh-cosplay')
})

test('导出的入口与文件声明一致', () => {
  assert.equal(manifest.exports['.'].default, './lib/index.js')
  assert.equal(manifest.exports['./client'].default, './lib/client.js')
  assert.ok(manifest.files.includes('lib/client.js'))
  assert.ok(manifest.files.includes('presets'))
})
