/**
 * 把预设卡**实际注入的 system 片段**整段打出来（给人过一眼 / 存档）。
 *
 * ```bash
 * node scripts/dump-presets.mjs              # 打到 stdout（markdown）
 * node scripts/dump-presets.mjs > docs/preset-dump.md
 * ```
 *
 * 为什么需要它（`docs/playbook-persona-cards.md` §5.2）：
 * 单测只能查"有没有五段、字数够不够"，**查不出"读起来对不对"**。所以每次改预设，
 * 都要把"模型最后看到的那些字"摊开看一遍 —— 包括插件层追加的扮演纪律与尾部回声。
 *
 * 这个脚本用的是**构建产物**（`lib/`）与**仓库里的 preset 文件**，所以它输出的就是
 * 运行时真正会拼出来的东西（不是另写一份示例）。
 */

import { readFileSync } from 'node:fs'
import { normalizeCard, echoTextOf } from '../lib/cards.js'
import { composeEchoText, composePersonaText, composeRewriteSystem } from '../lib/prompt.js'

/** 与人设段的默认上限保持一致（`personaMaxChars`）。 */
const PERSONA_MAX = 8000

const file = (name) => JSON.parse(readFileSync(new URL(`../presets/${name}`, import.meta.url), 'utf8'))

const out = []
out.push('# 预设卡实际注入内容（dump）')
out.push('')
out.push('> 本文件由 `node scripts/dump-presets.mjs > docs/preset-dump.md` 生成，**不要手改**。')
out.push('> 它打印的是**运行时真正会拼出来的字**（含插件层追加的扮演纪律与尾部回声）。')
out.push(`> 生成时间：${new Date().toISOString()}`)
out.push('')

for (const [packFile, kind] of [
  ['personas.json', '人设卡（注入系统提示词）'],
  ['rewriters.json', '改写卡（改的是你发出去的那句话）'],
]) {
  out.push(`## ${kind} · \`presets/${packFile}\``)
  out.push('')
  for (const raw of file(packFile).cards) {
    const { value } = normalizeCard(raw, { source: 'preset' })
    const persona = value.persona ?? ''
    const rules = value.rewrite?.rules ?? ''
    out.push(`### ${value.name}（\`${value.id}\` · mode=${value.mode}）`)
    out.push('')
    out.push(`- 卡片人设正文：**${persona.length} 字**${persona === '' ? '（该卡不注入）' : ''}`)
    if (rules !== '') out.push(`- 卡片改写规则：**${rules.length} 字**${value.rewrite?.examples === undefined ? '' : ` · 示例 ${value.rewrite.examples.length} 组`}`)
    if (persona !== '') {
      const echo = echoTextOf(value)
      out.push(`- 尾部回声：${echo === '' ? '（无）' : `**${echo.length} 字** —— \`${echo}\``}`)
      out.push(`- 五段标记：${['说话方式：', '边界：', '格式契约：', '样例：'].map((m) => `${m.replace('：', '')}${persona.includes(m) ? '✓' : '✗'}`).join(' · ')}`)
    }
    out.push('')
    if (persona !== '') {
      out.push('<details><summary>展开：注入系统提示词的那一段（含插件层纪律）</summary>')
      out.push('')
      out.push('```text')
      out.push(composePersonaText(value, PERSONA_MAX))
      out.push('```')
      out.push('')
      out.push('```text')
      out.push(composeEchoText(value) || '（本卡没有尾部回声）')
      out.push('```')
      out.push('</details>')
      out.push('')
    }
    if (rules !== '') {
      out.push('<details><summary>展开：改写调用的 system prompt（含示例与指代纪律）</summary>')
      out.push('')
      out.push('```text')
      out.push(composeRewriteSystem(value))
      out.push('```')
      out.push('</details>')
      out.push('')
    }
  }
}

process.stdout.write(`${out.join('\n')}\n`)
