/**
 * 会话日志读取（`scripts/` 下的诊断工具共用）。
 *
 * ## 为什么要自己走 zstd 帧
 *
 * `session.v4.jsonl.zstd` **不是**一个 zstd 帧，而是 `dsh-session-persistence-jsonl` 的
 * **拼接帧容器**：第一帧只装 header 行，之后每批 appends 一帧。Node 的
 * `zstdDecompressSync` 与解压流都只吃第一帧 —— 直接解会"只得到一个 header 行"，
 * 看起来像"日志里什么都没有"（这个坑我们踩过）。
 *
 * 这里按 RFC 8878 自己扫帧边界（帧头 + 块头），解析不了的帧直接跳过（torn frame）。
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { zstdDecompressSync } from 'node:zlib'

/** zstd 魔数（小端读）。 */
const ZSTD_MAGIC = 0xfd2fb528

/** 会话根目录（`$DSH_HOME/sessions`）。 */
export function sessionsRoot() {
  return join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'sessions')
}

/** 扫出拼接容器里的每个完整帧。 */
export function scanFrames(buffer) {
  const frames = []
  let offset = 0
  while (offset + 6 <= buffer.length && buffer.readUInt32LE(offset) === ZSTD_MAGIC) {
    const start = offset
    offset += 4
    const descriptor = buffer[offset]
    offset += 1
    if ((descriptor & 0x08) !== 0) break // 保留位：不认识的容器，停
    const fcsFlag = descriptor >> 6
    const singleSegment = (descriptor & 0x20) !== 0
    const checksum = (descriptor & 0x04) !== 0
    const didFlag = descriptor & 0x03
    if (!singleSegment) offset += 1 // Window_Descriptor
    offset += [0, 1, 2, 4][didFlag] // Dictionary_ID
    offset += fcsFlag === 0 ? (singleSegment ? 1 : 0) : [0, 2, 4, 8][fcsFlag] // Frame_Content_Size
    let torn = false
    for (;;) {
      if (offset + 3 > buffer.length) {
        torn = true
        break
      }
      const b0 = buffer[offset]
      const b1 = buffer[offset + 1]
      const b2 = buffer[offset + 2]
      const last = (b0 & 1) === 1
      const type = (b0 >> 1) & 3
      const size = (b0 >> 3) | (b1 << 5) | (b2 << 13)
      offset += 3
      offset += type === 0 ? size : type === 1 ? 1 : size
      if (offset > buffer.length) {
        torn = true
        break
      }
      if (last) break
    }
    if (torn) break
    if (checksum) offset += 4
    if (offset > buffer.length) break
    frames.push({ start, end: offset })
  }
  return frames
}

/** 解出整份日志的明文（多帧拼接）。 */
export function decodeLog(file) {
  const raw = readFileSync(file)
  if (!file.endsWith('.zstd')) return { text: raw.toString('utf8'), frames: 1, bytes: raw.length }
  const parts = []
  let frames = 0
  for (const frame of scanFrames(raw)) {
    try {
      parts.push(zstdDecompressSync(raw.subarray(frame.start, frame.end)))
      frames += 1
    } catch {
      // 损坏/未写完的最后一帧：跳过
    }
  }
  return { text: Buffer.concat(parts).toString('utf8'), frames, bytes: raw.length }
}

/** 递归找一个名字里含 `needle` 的会话目录。 */
export function findSessionDir(needle, root = sessionsRoot()) {
  for (const workspace of readdirSync(root)) {
    const dir = join(root, workspace)
    let entries = []
    try {
      if (!statSync(dir).isDirectory()) continue
      entries = readdirSync(dir)
    } catch {
      continue
    }
    for (const name of entries) {
      if (!name.includes(needle)) continue
      const candidate = join(dir, name)
      try {
        if (statSync(candidate).isDirectory()) return candidate
      } catch {
        /* ignore */
      }
    }
  }
  return undefined
}

/** 读一个会话目录里的事件数组。 */
export function readSessionEvents(dir) {
  const file = readdirSync(dir).find((name) => name.endsWith('.jsonl.zstd') || name.endsWith('.jsonl'))
  if (file === undefined) return { events: [], file: undefined, frames: 0, bytes: 0 }
  const decoded = decodeLog(join(dir, file))
  const events = decoded.text
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => {
      try {
        return JSON.parse(line)
      } catch {
        return undefined
      }
    })
    .filter(Boolean)
  return { events, file, frames: decoded.frames, bytes: decoded.bytes }
}

/** 取一条消息事件的正文文本（只认 text 块）。 */
export function eventText(event) {
  const data = event?.data ?? {}
  const message = data.content !== undefined ? data : (data.message ?? {})
  const content = Array.isArray(message.content) ? message.content : []
  return content
    .filter((block) => block !== null && typeof block === 'object' && block.type === 'text')
    .map((block) => block.text)
    .join('')
}

/** 一条消息事件的来源 kind。 */
export function eventSourceKind(event) {
  const data = event?.data ?? {}
  const direct = data.source?.kind
  if (typeof direct === 'string') return direct
  const nested = data.message?.source?.kind
  return typeof nested === 'string' ? nested : ''
}

/** 本地时间（HH:mm:ss）。 */
export function clockOf(ms) {
  return new Date(ms).toLocaleTimeString('zh-CN', { hour12: false })
}

/** 人设段里"扮演的是哪张卡"（取不到 = 此刻没有注入）。 */
export function personaOf(systemText) {
  const hit = /【角色扮演 · dsh-cosplay】你现在扮演「([^」]+)」/.exec(systemText)
  return hit?.[1]
}
