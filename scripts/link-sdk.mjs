/**
 * 离线兜底：把 `node_modules/@deepseek-ai/*` 指向本机的 SDK 镜像（Windows 用 junction）。
 *
 * 为什么需要它：`npm install` 装 devDependencies 需要网络与 npm registry；而类型镜像
 * 本机就有（`upgrade/_sdk-020` = 0.2.0-rc.1 全量，`upgrade/.sdk-mirror` = 0.1.7-rc.2）。
 * 没网时用这个脚本把类型接上，`npx tsc --noEmit` 与 `npm run build` 照样能跑。
 *
 * 用法：
 *   node scripts/link-sdk.mjs                       # 默认指向 upgrade/_sdk-020
 *   node scripts/link-sdk.mjs --from <镜像目录>      # 指定别的镜像
 *   node scripts/link-sdk.mjs --dry-run             # 只看会做什么
 *
 * 纪律：**只在缺失时创建**，绝不覆盖 npm 真正装出来的包（要覆盖得先把那个目录删掉）。
 * 已存在的条目一律跳过并如实报告。
 */

import { existsSync, mkdirSync, readdirSync, symlinkSync, lstatSync } from 'node:fs'
import { join, resolve } from 'node:path'

const ROOT = resolve(new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))

/** 默认镜像（本机）。 */
const DEFAULT_MIRRORS = [
  'D:/developing/DSH-plugin/upgrade/_sdk-020/node_modules/@deepseek-ai',
  'D:/developing/DSH-plugin/upgrade/.sdk-mirror/node_modules/@deepseek-ai',
]

const argv = process.argv.slice(2)
const dryRun = argv.includes('--dry-run')
const fromIndex = argv.indexOf('--from')
const requested = fromIndex >= 0 ? argv[fromIndex + 1] : undefined

const source = requested ?? DEFAULT_MIRRORS.find((candidate) => existsSync(candidate))
if (source === undefined || !existsSync(source)) {
  console.error('✗ 找不到 SDK 镜像。用 --from <目录> 指定（目录里应直接是包目录）。')
  console.error('  试过：', DEFAULT_MIRRORS.join('  |  '))
  process.exit(1)
}

const target = join(ROOT, 'node_modules', '@deepseek-ai')
mkdirSync(target, { recursive: true })

/** 条目是否存在（连断掉的链接也算存在 —— 那需要人来处理，不该被静默覆盖）。 */
function exists(path) {
  try {
    lstatSync(path)
    return true
  } catch {
    return false
  }
}

let linked = 0
let skipped = 0
let failed = 0

for (const name of readdirSync(source)) {
  const from = join(source, name)
  const to = join(target, name)
  if (exists(to)) {
    skipped += 1
    continue
  }
  if (dryRun) {
    console.log(`（dry-run）junction ${to} -> ${from}`)
    linked += 1
    continue
  }
  try {
    symlinkSync(from, to, 'junction')
    linked += 1
  } catch (error) {
    failed += 1
    console.error(`✗ ${name}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

console.log(`镜像：${source}`)
console.log(`结果：新建 ${linked} · 已存在跳过 ${skipped} · 失败 ${failed}${dryRun ? '（dry-run，未落盘）' : ''}`)
if (failed > 0) process.exit(1)
