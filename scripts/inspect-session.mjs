/**
 * 看**模型实际收到了什么**（从会话日志的原始字节里挖，不是复述）。
 *
 *   node scripts/inspect-session.mjs <会话id前缀> [--outline] [--full-system] [--users N] [--grep "某句话"]
 *
 * 挖四样：
 *   1. `system/message` —— **最终系统提示词**（所有段拼完之后的那一份，含 dsh-cosplay 注入段的位置）；
 *   2. `user/message`   —— 最终进入模型上下文的用户消息（改写卡里它就是改写后的正文）；
 *   3. `request/header` —— 那次请求的 provider / model / 工具数等元信息；
 *   4. `--grep`         —— 一段文字在整份日志里出现几次、落在哪些事件上
 *      （用来回答"我的原话到底进没进日志"）。
 *
 * 为什么需要它：会话日志是**多帧拼接**的 zstd 容器，直接用通用工具解不开（见 session-log.mjs）。
 */

import { readSessionEvents, clockOf, eventText, eventSourceKind, findSessionDir, personaOf } from './session-log.mjs'

const args = process.argv.slice(2)
const prefix = args[0]
const flag = (name) => args.includes(name)
const value = (name, fallback) => (args.includes(name) ? Number(args[args.indexOf(name) + 1]) : fallback)

if (prefix === undefined) {
  console.error('用法：node scripts/inspect-session.mjs <会话id前缀> [--outline] [--full-system] [--users N] [--grep "…"]')
  process.exit(1)
}

const dir = findSessionDir(prefix)
if (dir === undefined) {
  console.error(`找不到会话目录（前缀 ${prefix}）`)
  process.exit(1)
}
const { events, frames, bytes, file } = readSessionEvents(dir)
const text = events.map((event) => JSON.stringify(event)).join('\n')

console.log(`会话目录：${dir}`)
console.log(`容器：${file} · ${bytes} 字节 · ${frames} 帧 · 事件 ${events.length} 条`)
const counts = {}
for (const event of events) counts[event.type] = (counts[event.type] ?? 0) + 1
console.log(
  `事件分布：${Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 14)
    .map(([kind, count]) => `${kind}=${count}`)
    .join(' ')}`,
)

const systems = events.filter((event) => event.type === 'system/message')
const users = events.filter((event) => event.type === 'user/message')
const headers = events.filter((event) => event.type === 'request/header')

console.log(`\n══════ 系统提示词（system/message ${systems.length} 条）══════`)
if (systems.length > 0) {
  const last = systems[systems.length - 1]
  const body = eventText(last)
  const marker = '【角色扮演 · dsh-cosplay】'
  const at = body.indexOf(marker)
  const echo = body.indexOf('【本会话角色】')
  const card = personaOf(body)
  console.log(`最后一条 seq=${last.seq} · 长度 ${body.length} 字符 · 人设=${card ?? '无'}`)
  console.log(at < 0 ? `${marker} → 本会话没有注入段` : `${marker} → 第 ${at} 个字符（全文 ${((at / body.length) * 100).toFixed(1)}%）`)
  if (echo >= 0) console.log(`【本会话角色】尾部回声 → 第 ${echo} 个字符（是否在末尾自己看：其后还有 ${body.length - echo} 字）`)
  if (at >= 0) {
    console.log('\n—— 注入段**之前**紧挨着的 300 字符 ——')
    console.log(body.slice(Math.max(0, at - 300), at))
    console.log('\n—— 注入段开头 900 字符 ——')
    console.log(body.slice(at, at + 900))
  }
  if (flag('--outline')) {
    console.log('\n—— 结构图（按 ≥2 连续空行切块）——')
    const blocks = []
    const regex = /\n{2,}/g
    let cursor = 0
    let match
    while ((match = regex.exec(body)) !== null) {
      const chunk = body.slice(cursor, match.index)
      if (chunk.trim() !== '') blocks.push({ at: cursor, text: chunk })
      cursor = match.index + match[0].length
    }
    const tail = body.slice(cursor)
    if (tail.trim() !== '') blocks.push({ at: cursor, text: tail })
    blocks.forEach((block, index) => {
      const mine = block.text.includes(marker) || block.text.includes('【本会话角色】')
      console.log(`${String(index + 1).padStart(3)} @${String(block.at).padStart(5)} ${String(block.text.length).padStart(5)}字 ${mine ? '←★ 本插件' : ''} ${block.text.split('\n')[0].slice(0, 80)}`)
    })
  }
  if (flag('--full-system')) {
    console.log('\n—— 完整系统提示词 ——')
    console.log(body)
  }
}

console.log(`\n══════ 用户消息（${users.length} 条，显示最后 ${value('--users', 3)} 条）══════`)
for (const event of users.slice(-value('--users', 3))) {
  const body = eventText(event)
  console.log(`\n— seq=${event.seq} ${clockOf(event.time ?? 0)} source.kind=${eventSourceKind(event) || '?'} 长度=${body.length}`)
  console.log(body.length > 800 ? `${body.slice(0, 800)}…（截断，原文 ${body.length} 字）` : body)
}

console.log(`\n══════ 请求头（${headers.length} 条，最后 1 条）══════`)
for (const event of headers.slice(-1)) {
  const header = event.data?.header ?? {}
  console.log(
    JSON.stringify({
      seq: event.seq,
      provider: header.config?.provider,
      model: header.config?.model,
      reasoningEffort: header.config?.reasoningEffort,
      maxTokens: header.config?.maxTokens,
      tools: Array.isArray(header.tools) ? header.tools.length : undefined,
      reason: event.data?.reason,
    }),
  )
}

const needle = flag('--grep') ? args[args.indexOf('--grep') + 1] : undefined
if (needle !== undefined) {
  console.log(`\n══════ 全文检索 ══════`)
  console.log(`「${needle}」出现 ${text.split(needle).length - 1} 次`)
  for (const event of events) {
    if (JSON.stringify(event).includes(needle)) console.log(`  · seq=${event.seq} type=${event.type} ${clockOf(event.time ?? 0)}`)
  }
}
