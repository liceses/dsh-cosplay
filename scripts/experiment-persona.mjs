/**
 * 人设对照实验：**中途换人设 / 强冲突切换 / 尾部回声**到底有没有影响。
 *
 * ```bash
 * node scripts/experiment-persona.mjs 31999                # A/B/C 三组
 * node scripts/experiment-persona.mjs 31999 --arm A --label echo-on --out .dsh/exp-A-echo.json
 * ```
 *
 * ## 为什么只做这几格
 *
 * "关键约束首尾各说一次有用""注意力呈 U 型"已有文献结论（Lost in the Middle /
 * Critical Instruction Repetition），不必我们再验。文献**没覆盖**的是这套具体组合：
 * deepseek-flash（high reasoning）× 中文 × DSH 这套提示词栈。所以实验只测这一格。
 *
 * | 组 | 设计 | 回答什么 |
 * | --- | --- | --- |
 * | A  | 第 1 轮就绑「赛博猫娘」 | 基线 |
 * | A′ | 同 A，但宿主配置打开 `personaEcho`（需另外切换） | 尾部回声在推理模型上有没有用/有害 |
 * | B  | 前 N-1 轮无角色 → 第 N 轮绑猫娘 | "中途切入"（复现真实会话里的那次） |
 * | C  | 前 N-1 轮绑「硬邦邦」（用户消息被改写成甲方文）→ 第 N 轮绑猫娘 | **强冲突切换**（自然样本缺的那格） |
 *
 * ## 读什么
 *
 * 每轮问同一批**纯闲聊探针**（不触发工具）；输出里同时给出：
 *   - 每轮模型**实际收到**的用户消息（C 组能看到被改写成甲方文）；
 *   - 每条助手回复（交给独立评审按固定 rubric 打分，脚本不做自评）；
 *   - 机械指标：猫娘标记「喵」的每百字密度、上一阶段风格词（老哥们/冲冲冲/哥们）残留。
 *
 * 结果写到 `--out` 指定的 JSON，方便直接喂给评审。
 */

import { readdirSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { eventSourceKind, eventText, readSessionEvents } from './session-log.mjs'

const args = process.argv.slice(2)
const port = Number(args[0] ?? 31999)
const turns = args.includes('--turns') ? Number(args[args.indexOf('--turns') + 1]) : 3
const only = args.includes('--arm') ? args[args.indexOf('--arm') + 1] : ''
const label = args.includes('--label') ? args[args.indexOf('--label') + 1] : ''
const personaCard = args.includes('--card') ? args[args.indexOf('--card') + 1] : 'catgirl'
const cardLabel = args.includes('--card-label') ? args[args.indexOf('--card-label') + 1] : personaCard
const out = args.includes('--out') ? args[args.indexOf('--out') + 1] : join('.dsh', `experiment-persona-${label || 'default'}.json`)
const base = `http://127.0.0.1:${port}/api/dsh-cosplay`
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** 固定探针（纯闲聊，不触发工具；四组完全一致）。 */
const PROBES = [
  '你好呀，你今天心情怎么样？',
  '讲一件你今天遇到的小事给我听，别太长。',
  '我有点累，随便陪我聊两句吧。',
]

/** 上一阶段的风格词（用来量"旧口吻残留"）。 */
const OLD_STYLE = ['老哥们', '冲冲冲', '哥们', '硬邦邦', '一把梭', '耍起']

async function post(path, body) {
  const response = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  })
  return response.json().catch(() => undefined)
}

/** 找会话目录（会话可能落在任意 workspace 目录下）。 */
function sessionDirOf(sessionId) {
  const root = join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'sessions')
  for (const workspace of readdirSync(root)) {
    const dir = join(root, workspace)
    let entries = []
    try {
      if (!statSync(dir).isDirectory()) continue
      entries = readdirSync(dir)
    } catch {
      continue
    }
    const hit = entries.find((name) => name.includes(sessionId))
    if (hit !== undefined) return join(dir, hit)
  }
  throw new Error(`找不到会话目录：${sessionId}`)
}

/** 等这个会话攒够 n 轮（人话 + 助手回复都到位）。 */
async function waitFor(sessionId, expected, timeoutMs = 180_000) {
  const started = Date.now()
  for (;;) {
    const { events } = readSessionEvents(sessionDirOf(sessionId))
    const human = events.filter((event) => event.type === 'user/message' && eventSourceKind(event) === 'user')
    const replies = events.filter((event) => event.type === 'assistant/message').map((event) => eventText(event)).filter((text) => text.trim() !== '')
    if (replies.length >= expected && human.length >= expected) {
      return { human: human.map((event) => eventText(event)), replies, timeout: false }
    }
    if (Date.now() - started > timeoutMs) {
      return { human: human.map((event) => eventText(event)), replies, timeout: true }
    }
    await sleep(2000)
  }
}

/** 跑一组：`bindPlan(index)` 返回这一轮发之前要绑的卡（undefined = 不动）。 */
async function runArm(name, description, bindPlan) {
  console.log(`\n▶ 组 ${name}：${description}`)
  let sessionId
  const turnsData = []
  for (let index = 0; index < turns; index += 1) {
    const bindCardId = bindPlan(index)
    const result = await post('/probe/turn', {
      text: PROBES[index % PROBES.length],
      ...(sessionId === undefined ? {} : { sessionId }),
      ...(bindCardId === undefined ? {} : { bindCardId }),
    })
    if (result?.ok !== true) throw new Error(`投递失败：${JSON.stringify(result)}`)
    sessionId = result.sessionId
    const collected = await waitFor(sessionId, index + 1)
    const reply = collected.replies[index] ?? ''
    const received = collected.human[index] ?? ''
    const meow = reply.split('喵').length - 1
    const oldStyle = OLD_STYLE.reduce((sum, word) => sum + (reply.split(word).length - 1), 0)
    console.log(
      `   第 ${index + 1} 轮${bindCardId === undefined ? '' : `（绑 ${bindCardId}）`} → 收到 ${received.length} 字 / 回复 ${reply.length} 字 · 喵${meow}（密度 ${(meow / Math.max(1, reply.length / 100)).toFixed(2)}）· 旧风格词 ${oldStyle}${collected.timeout ? ' · 超时' : ''}`,
    )
    turnsData.push({
      turn: index + 1,
      bindCardId: bindCardId ?? null,
      probeAsked: PROBES[index % PROBES.length],
      received,
      reply,
      meow,
      oldStyle,
    })
  }
  return { name, description, sessionId, turns: turnsData }
}

const plans = {
  // A：第 1 轮就绑猫娘（之后不再改绑）
  A: () => [
    ['A', `${turns} 轮全程猫娘`, (index) => (index === 0 ? personaCard : undefined)],
  ],
  // B：前 N-1 轮无角色 → 第 N 轮绑猫娘
  B: () => [['B', `前 ${turns - 1} 轮无角色 → 第 ${turns} 轮切猫娘`, (index) => (index === turns - 1 ? personaCard : undefined)]],
  // C：前 N-1 轮硬邦邦 → 第 N 轮切猫娘（强冲突）
  C: () => [
    [
      'C',
      `前 ${turns - 1} 轮硬邦邦 → 第 ${turns} 轮切猫娘（强冲突）`,
      (index) => (index === turns - 1 ? personaCard : 'hardcore'),
    ],
  ],
}

const selected = only === '' ? ['A', 'B', 'C'] : [only.toUpperCase()]
const arms = []
for (const key of selected) {
  const entry = plans[key]
  if (entry === undefined) throw new Error(`未知组：${key}（可用 A / B / C）`)
  for (const [name, description, plan] of entry()) arms.push(await runArm(name, description, plan))
}

const payload = { label: label || 'default', port, turns, at: new Date().toISOString(), arms }
writeFileSync(out, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
console.log(`\n结果已写入 ${out}`)
console.log('判分提醒：交给**另起的评审会话**（不知分组）按固定 rubric 打分，别自评。')
