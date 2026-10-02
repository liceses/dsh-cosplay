/**
 * dsh-cosplay — 斜杠命令 `/cosplay`（host）。
 *
 * 命令结果**不进模型历史**（dsh-commands 的语义），所以它最适合干这些"人按的开关"：
 *   /cosplay                 状态（总开关、策略、本会话角色、库统计、最近改写）
 *   /cosplay list [关键词]    卡片清单
 *   /cosplay on | off        本会话开/关（逃生阀）
 *   /cosplay none            本会话取消角色
 *   /cosplay <id | 名字>      本会话换上这张卡
 *
 * 为什么要有命令而不是全靠界面：**页签坏了的时候你还能自救**（客户端半边的问题不该
 * 让你连"关掉角色"都做不到）。
 */

import type { CommandDefinition, CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import type { CosplayConfig } from './config.js'
import type { Library } from './library.js'
import type { StateStore } from './state.js'
import type { CosplayCard } from './types.js'

/** 命令名（不含前导斜杠）。 */
export const COMMAND_NAME = 'cosplay'

/** 命令依赖。 */
export interface CommandDeps {
  config: () => CosplayConfig
  library: () => Library
  state: () => StateStore
}

/** 成功结果。 */
function success(text: string): CommandResult {
  return { kind: 'success', text }
}

/** 失败结果。 */
function failure(text: string): CommandResult {
  return { kind: 'error', text }
}

const USAGE = [
  '用法：',
  '  /cosplay                状态',
  '  /cosplay list [关键词]   卡片清单',
  '  /cosplay on | off       本会话开/关',
  '  /cosplay none           本会话取消角色',
  '  /cosplay <id | 名字>     本会话换上这张卡',
].join('\n')

/** 按 id 或名字找一张卡（名字支持包含匹配）。 */
export function findCard(cards: readonly CosplayCard[], query: string): CosplayCard | undefined {
  const needle = query.trim().toLowerCase()
  if (needle === '') return undefined
  const exact = cards.find((card) => card.id === needle || card.name.toLowerCase() === needle)
  if (exact !== undefined) return exact
  return cards.find((card) => card.name.toLowerCase().includes(needle) || card.id.includes(needle))
}

/** 一行卡片摘要。 */
function cardLine(card: CosplayCard): string {
  const mode = card.mode === 'system' ? '人设' : card.mode === 'rewrite' ? '改写' : '人设+改写'
  const tags = card.source === 'preset' ? '预设' : '自定义'
  return `  ${card.id.padEnd(18)} ${card.name} · ${mode} · ${tags}${card.description === undefined ? '' : ` · ${card.description}`}`
}

/** 构建 `/cosplay`。 */
export function createCosplayCommand(deps: CommandDeps): CommandDefinition {
  return {
    name: COMMAND_NAME,
    description: '角色扮演：状态、卡片清单、本会话开关与换卡',
    input: { hint: '[list|on|off|none|<id|名字>]' },
    handler: (invocation: CommandInvocation): CommandResult => {
      const cfg = deps.config()
      const library = deps.library()
      const state = deps.state()
      const sessionId = String(invocation.agent.id)
      const binding = state.binding(sessionId)
      const raw = invocation.rawInput.trim()
      const parts = raw.split(/\s+/).filter((part) => part !== '')
      const head = (parts[0] ?? '').toLowerCase()

      const status = (): string => {
        const info = library.info()
        const bound = binding?.cardId ?? null
        const card = bound === null ? undefined : library.get(bound)
        const recent = state.rewritesOf(sessionId, 3)
        return [
          `状态：总开关${cfg.enabled ? '开' : '关'} · 策略 ${cfg.strategy} · 本会话${binding?.enabled === false ? '已关闭' : '启用中'}`,
          `本会话角色：${card === undefined ? (bound === null ? '（没有）' : `（绑定 ${bound} 但卡不存在）`) : `${card.name}（${card.id}）`}`,
          `默认卡：${cfg.defaultCardId === '' ? '（未设）' : cfg.defaultCardId}`,
          `卡片库：${info.cards} 张（预设 ${info.presets} · 自定义 ${info.customs}）· 立绘 ${info.artFiles} 张 · ${(info.bytes / 1024 / 1024).toFixed(1)} MB`,
          `目录：${info.root}`,
          ...(recent.length === 0
            ? ['最近改写：（无）']
            : ['最近改写：', ...recent.map((item) => `  ${item.ok ? '✓' : '✗'} ${item.cardId} · ${item.inChars}→${item.outChars} 字 · ${item.ms}ms${item.error === undefined ? '' : ` · ${item.error}`}`)]),
          '',
          USAGE,
        ].join('\n')
      }

      if (head === '') return success(status())

      if (head === 'list') {
        const query = parts.slice(1).join(' ')
        const cards = library.list().filter((card) => query === '' || card.name.includes(query) || card.id.includes(query.toLowerCase()))
        if (cards.length === 0) return failure(`没有匹配的卡片${query === '' ? '' : `：${query}`}`)
        return success([`卡片清单（${cards.length}/${library.list().length}）：`, ...cards.map(cardLine)].join('\n'))
      }

      if (head === 'on' || head === 'off') {
        const next = state.setBinding(sessionId, { enabled: head === 'on' })
        return success(`本会话角色已${next.enabled ? '启用' : '关闭'}${next.enabled ? '' : '（注入与改写都停，零 token）'}`)
      }

      if (head === 'none') {
        state.setBinding(sessionId, { cardId: null })
        return success('本会话已取消角色（下一条消息不再注入、不再改写）')
      }

      const card = findCard(library.list(), raw)
      if (card === undefined) {
        return failure(`找不到卡片：${raw}\n\n${USAGE}`)
      }
      state.setBinding(sessionId, { cardId: card.id, enabled: true })
      const warn =
        card.mode === 'rewrite' && cfg.strategy === 'card'
          ? '\n（改写型卡片：你发送的每条消息都会先经一次模型改写，多花一次调用。要停就 /cosplay off）'
          : ''
      return success(`本会话角色已切换为「${card.name}」（${card.id} · ${card.mode}）${warn}`)
    },
  }
}
