/**
 * 人设时间线 / 全量扫描（回答"人设会不会随上下文变弱、中途换卡会不会被污染"）。
 *
 * ```bash
 * # 单会话时间线：每次系统提示词提交（注入的是谁）+ 每轮助手正文的人设标记命中数
 * node scripts/inspect-persona.mjs <会话id前缀>
 *
 * # 全量扫描：每个会话的人设时间线（谁 → 谁 → 谁）+ 轮数 + 喵密度
 * node scripts/inspect-persona.mjs --scan
 * node scripts/inspect-persona.mjs --scan --only-persona   # 只看用过角色卡的会话
 * ```
 *
 * 为什么这么设计：
 *   - 人设段是**每次装配都求值**的，所以"哪次 system/message 带着谁"就是权威的注入时间线；
 *   - 猫娘的「喵」是干净的人设标记（基准密度近 0），用它的**每百字密度**看有没有随轮次衰减；
 *   - "中途换卡"的自然样本需要跨 system/message 比对，所以时间线比统计更有用。
 */

import { clockOf, eventText, eventSourceKind, findSessionDir, personaOf, readSessionEvents, sessionsRoot } from './session-log.mjs'
import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/** 人设标记（按卡片名配关键词）。 */
const MARKERS = {
  猫娘: ['喵'],
  学姐: ['先', '然后', '最后', '卡在哪', '踩过'],
  硬邦邦: ['老哥们', '冲冲冲', '硬邦邦', '哥们'],
  魔法师: ['✨', '吾', '魔法'],
  翻译官: ['目标', '验收', '边界', '已知条件'],
}

/** 选一组标记。 */
function markersFor(name) {
  const key = Object.keys(MARKERS).find((candidate) => name.includes(candidate))
  return key === undefined ? ['喵'] : MARKERS[key]
}

/** 单会话时间线。 */
function timeline(prefix) {
  const dir = findSessionDir(prefix)
  if (dir === undefined) {
    console.log(`\n### ${prefix}：找不到`)
    return
  }
  const { events, file, frames, bytes } = readSessionEvents(dir)
  console.log(`\n### ${prefix}（${events.length} 事件 · ${frames} 帧 · ${bytes} 字节 · ${file}）`)

  let markerKey = '猫娘'
  let lastTurn = -1
  for (const event of events) {
    const at = event.time ?? 0
    if (event.type === 'system/message') {
      const body = eventText(event)
      const name = personaOf(body)
      if (name !== undefined) markerKey = name
      const echo = body.includes('【本会话角色】') ? ' +尾回声' : ''
      console.log(`  ${clockOf(at)} SYS  ${String(body.length).padStart(5)}字  注入=${name === undefined ? '无' : `「${name}」`}${echo}`)
      continue
    }
    if (event.type === 'user/message' && eventSourceKind(event) === 'user') {
      const body = eventText(event)
      console.log(`  ${clockOf(at)} USER ${String(body.length).padStart(5)}字  ${body.replace(/\s+/g, ' ').slice(0, 70)}`)
      continue
    }
    if (event.type === 'assistant/message') {
      const body = eventText(event)
      if (body.trim() === '') continue
      const turn = event.data?.turn ?? 0
      const step = event.data?.step ?? 0
      if (turn !== lastTurn) lastTurn = turn
      const words = markersFor(markerKey)
      const hits = words.reduce((sum, word) => sum + (body.split(word).length - 1), 0)
      const density = (hits / (body.length / 100)).toFixed(2)
      console.log(`  ${clockOf(at)} ASST ${String(body.length).padStart(5)}字  t${turn}/s${step} [${markerKey}] 命中${hits} 密度${density}  ${body.replace(/\s+/g, ' ').slice(0, 56)}`)
    }
  }
}

/** 全量扫描。 */
function scan(onlyPersona) {
  const root = sessionsRoot()
  const rows = []
  for (const workspace of readdirSync(root)) {
    const workspaceDir = join(root, workspace)
    let sessions = []
    try {
      if (!statSync(workspaceDir).isDirectory()) continue
      sessions = readdirSync(workspaceDir)
    } catch {
      continue
    }
    for (const name of sessions) {
      const dir = join(workspaceDir, name)
      try {
        if (!statSync(dir).isDirectory()) continue
      } catch {
        continue
      }
      let events = []
      try {
        events = readSessionEvents(dir).events
      } catch {
        continue
      }
      if (events.length === 0) continue

      const phases = []
      const push = (persona) => {
        if (phases.length > 0 && phases[phases.length - 1].persona === persona) return
        phases.push({ persona, assistantTurns: 0, userTurns: 0, chars: 0, meow: 0 })
      }
      let lastTurn = -1
      for (const event of events) {
        if (event.type === 'system/message') {
          push(personaOf(eventText(event)) ?? '无')
          continue
        }
        if (event.type === 'user/message' && eventSourceKind(event) === 'user') {
          if (phases.length === 0) push('无')
          phases[phases.length - 1].userTurns += 1
          continue
        }
        if (event.type === 'assistant/message') {
          const body = eventText(event)
          if (body.trim() === '') continue
          const turn = event.data?.turn ?? 0
          if (turn !== lastTurn) {
            lastTurn = turn
            if (phases.length > 0) phases[phases.length - 1].assistantTurns += 1
          }
          const phase = phases[phases.length - 1]
          if (phase !== undefined) {
            phase.chars += body.length
            phase.meow += body.split('喵').length - 1
          }
        }
      }
      if (phases.length === 0) continue
      rows.push({ name, phases, switches: phases.length - 1, events: events.length })
    }
  }
  rows.sort((a, b) => b.switches - a.switches || b.events - a.events)
  const shown = onlyPersona ? rows.filter((row) => row.phases.some((phase) => phase.persona !== '无')) : rows
  console.log(`${rows.length} 个会话（显示 ${shown.length} 个）。${onlyPersona ? '只列"有人设过"的' : '按"人设切换次数"排序'}：\n`)
  for (const row of shown) {
    const line = row.phases
      .map((phase) => `${phase.persona}(${String(phase.userTurns)}人话/${String(phase.assistantTurns)}助手回/喵密度${phase.chars > 0 ? (phase.meow / (phase.chars / 100)).toFixed(2) : '—'})`)
      .join(' → ')
    console.log(`${row.switches > 0 ? '★' : ' '} ${row.name.slice(-12)}  ${line}`)
  }
}

const args = process.argv.slice(2)
if (args.includes('--scan')) scan(args.includes('--only-persona'))
else if (args[0] !== undefined) timeline(args[0])
else {
  console.error('用法：node scripts/inspect-persona.mjs <会话id前缀>  |  --scan [--only-persona]')
  process.exit(1)
}
