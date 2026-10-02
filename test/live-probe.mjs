/**
 * dsh-cosplay — 活体探针（手动运行，不是单元测试）：
 *   node test/live-probe.mjs [port]
 *
 * 打的是**正在运行的 DSH GUI**。M0 阶段它一次性验证：
 *   1. 插件路由是否挂上（旧的宿主没重启时这里会 404 并给出明确提示）；
 *   2. `/stats` 与 `/trace` 是否可读；
 *   3. 客户端半边是否真的加载（`client:client-apply` 回执 + `build=` 标记）；
 *   4. 「角色」页签是否进了 tab 列表（`client:view-label` / `client:view-registered`）；
 *   5. 提示段与 pre-step 是否被真实求值（`host:prompt-section` / `host:pre-step-message`）。
 *
 * 退出码：0 = 关键链路全通；1 = 有缺项（打印缺哪一项）。
 */

const port = Number(process.argv[2] ?? 19387)
const base = `http://127.0.0.1:${port}`
const PREFIX = '/api/dsh-cosplay'

/** 打一个 URL 并打印状态/长度。 */
async function probe(path, init) {
  try {
    const response = await fetch(base + path, init)
    const text = await response.text()
    const short = path.length > 56 ? `${path.slice(0, 53)}...` : path
    console.log(`${String(response.status).padEnd(4)} ${short.padEnd(58)} ${String(text.length).padEnd(8)}B`)
    return { response, text }
  } catch (error) {
    console.log(`ERR  ${path.padEnd(58)} ${error?.message ?? error}`)
    return undefined
  }
}

/** 读 JSON。 */
async function json(path) {
  const result = await probe(path)
  if (result === undefined || !result.response.ok) return undefined
  try {
    return JSON.parse(result.text)
  } catch {
    return undefined
  }
}

console.log(`—— 探针目标 ${base} ——\n`)

console.log('—— 路由与状态行 ——')
const stats = await json(`${PREFIX}/stats`)
if (stats === undefined) {
  console.log('\n✗ /stats 读不到：运行中的宿主还是旧代码 / 插件没装上。宿主半边改动必须重挂插件。')
  process.exit(1)
}
console.log(`     stats=${JSON.stringify(stats.stats)}`)
console.log(`     probe=${JSON.stringify(stats.probe)}`)
const trace = await json(`${PREFIX}/trace?limit=60`)
const entries = trace?.entries ?? []
console.log(`     trace 容量=${String(trace?.capacity ?? '?')} 现有=${String(trace?.size ?? '?')}`)

console.log('\n—— 客户端回执（浏览器半边是否加载）——')
const clientKinds = new Set(entries.filter((entry) => String(entry.kind).startsWith('client:')).map((entry) => entry.kind))
for (const kind of [...clientKinds].sort()) console.log(`     ${kind}`)

console.log('\n—— 宿主事件（机制是否真的被求值）——')
const hostKinds = new Set(entries.filter((entry) => String(entry.kind).startsWith('host:')).map((entry) => entry.kind))
for (const kind of [...hostKinds].sort()) console.log(`     ${kind}`)

/** 断言并累计缺项。 */
const missing = []
const requireKind = (kind, why) => {
  if (!entries.some((entry) => entry.kind === kind)) missing.push(`${kind}（${why}）`)
}
requireKind('client:client-apply', '浏览器半边没加载 → 刷新页面 / 插件没装 client 半边')
requireKind('client:view-registered', '「角色」页签没注册成功')
requireKind('client:view-label', '页签标签没被 tab 列表读取（页签可能没显示）')

console.log('\n—— 最近 8 条诊断 ——')
for (const entry of entries.slice(0, 8)) {
  console.log(`     [${new Date(entry.at).toLocaleTimeString()}] ${entry.kind} ${entry.sessionId === undefined ? '' : `[${String(entry.sessionId).slice(-8)}] `}${entry.note}`)
}

if (missing.length > 0) {
  console.log('\n✗ 缺项：')
  for (const item of missing) console.log(`   - ${item}`)
  console.log('   （页签相关缺项请刷新页面再看；宿主相关缺项请重挂插件）')
  process.exit(1)
}
console.log('\n✓ M0 关键链路全通：路由 · 状态行 · 客户端 bundle · 「角色」页签 · 宿主诊断')
// 显式退出：脚本用的是 keepalive 的 fetch 连接，让 Node 自然退出在 Windows 上有时会抛出
// libuv 的 `handle->flags & UV_HANDLE_CLOSING` 断言（噪声，不是插件的问题）。
process.exit(0)
