/**
 * dsh-cosplay — 浏览器半边入口。
 *
 * 做四件事，全部挂在当前 fiber 上（停用即净）：
 *
 * 1. **最外层回执** `client-apply`：这一版 bundle 到底加载了没；
 * 2. 注入样式；
 * 3. 在 `conversation.view` 注册「角色」页签（坐在「对话 / 轨迹」旁边）；
 * 4. 在 `settings.section` 注册「角色扮演」设置页（卡片库管理 + 诊断）。
 *
 * ## 顶层 inject 只写 `slots`
 *
 * `slots` 是任何部署都有的基线服务。其余能力（设置通道 `configForms`、会话输入机
 * `conversation`、`sessions`）一律走受限 fiber 或 `ctx.get(...)` 判空降级 ——
 * 顶层 inject 引一个拿不到的服务会让 loader 永久 pending，实测能把整个应用弄到打不开。
 */

import type { Context } from '@deepseek-ai/cordis'
// 带来 `ctx.slots`（由 ui-renderer 的 client 面声明）。
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// `conversation.view` 的 SlotMap 增强由会话包声明（type-only import，构建期擦除）。
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// `settings.section` 的 SlotMap 增强由 settings 包声明（同上，type-only）。
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import {
  ENTRY_ID,
  PACKAGE_NAME,
  SETTINGS_SECTION_ID,
  SETTINGS_SECTION_ORDER,
  VIEW_ID,
  VIEW_ORDER,
} from '../protocol.js'
import { DEFAULT_CONFIG, type CosplayConfig } from '../config.js'
import { createLazyScope, type LazySettingsScope } from '../settings-source.js'
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import { postDebug } from './api.js'
import { CardChip, type CardChipProps } from './chip.js'
import { COPY, SETTINGS_LABEL, VIEW_LABEL } from './copy.js'
import { CosplaySettings } from './settings.js'
import { CSS } from './styles.js'
import { CosplayView } from './view.js'

/**
 * 客户端构建标记：每次改浏览器半边就换一个。
 * 刷新后在 `/api/dsh-cosplay/stats` 的 `client:client-apply` 回执里核对 `build=`。
 */
export const CLIENT_BUILD = 'm1.1-chip-a'

/** 顶层硬依赖：只有基线服务。 */
export const inject = ['slots']

/** 标签求值只报一次（tab 条每次重渲染都会调用 label）。 */
let labelReported = false
/** 设置页注册只报一次。 */
let settingsReported = false

/** 挂载浏览器半边。 */
export function apply(ctx: Context): void {
  // 1) 最外层回执 —— 先建可观测性。
  postDebug({ kind: 'client-apply', note: `build=${CLIENT_BUILD} plugin=${PACKAGE_NAME}` })

  // 1b) 设置来源：**延迟绑定**（服务可能晚到、改名或整个不存在）。
  //     用它来读/写 `defaultCardId`（设置页的「默认角色」下拉）——绝不写进顶层 inject，
  //     那会让 loader 永久 pending、整个应用打不开（dsh-memes-reply 的实测教训）。
  const scope: LazySettingsScope<CosplayConfig> = createLazyScope<CosplayConfig>()
  const anyCtx = ctx as unknown as {
    inject(deps: string[], callback: (inner: Context) => void): unknown
  }
  anyCtx.inject(['configForms'], (inner) => {
    const service = (inner as unknown as { configForms?: { get<T>(entryId: string): ConfigForm<T> } }).configForms
    if (service === undefined || typeof service.get !== 'function') {
      postDebug({ kind: 'settings-source-missing', note: 'configForms 不在（设置页只读默认值）' })
      return
    }
    try {
      const live = service.get<CosplayConfig>(ENTRY_ID)
      inner.effect(() => scope.attach(live), 'dsh-cosplay: settings attach')
      postDebug({ kind: 'settings-source-attached', note: `entry=${ENTRY_ID} value=${JSON.stringify(scope.getSnapshot().value ?? {})}` })
    } catch (error) {
      postDebug({ kind: 'settings-source-failed', note: `接设置失败：${error instanceof Error ? error.message : String(error)}` })
    }
  })

  // 2) 样式（一个 <style data-plugin>，随 fiber 卸载一起移除）。
  ctx.effect(() => {
    const style = document.createElement('style')
    style.dataset.plugin = PACKAGE_NAME
    style.textContent = CSS
    document.head.appendChild(style)
    return () => {
      style.remove()
    }
  }, 'dsh-cosplay: styles')

  // 3) 「角色」页签：`conversation.view` 是 list 槽位（加法型，不抢别人的条目）。
  //    `slots.inject` 的回调只在槽位被声明之后跑；没装会话包时安静地不注册。
  ctx.slots.inject('conversation.view', () => {
    postDebug({ kind: 'view-slot-declared', note: `conversation.view 已声明 → 准备注册 ${VIEW_ID}` })
    try {
      const dispose = ctx.slots.register(
        {
          name: 'conversation.view',
          id: VIEW_ID,
          order: VIEW_ORDER,
          label: () => {
            if (!labelReported) {
              labelReported = true
              postDebug({ kind: 'view-label', note: `页签标签被 tab 列表读取：id=${VIEW_ID} label=${VIEW_LABEL}` })
            }
            return VIEW_LABEL
          },
        },
        CosplayView,
      )
      const entries = ctx.slots.entries('conversation.view')
      postDebug({
        kind: 'view-registered',
        note:
          `register 成功 id=${VIEW_ID} order=${VIEW_ORDER} · ` +
          `conversation.view 现有条目 [${entries.map((entry) => String((entry.options as { id?: unknown }).id ?? '?')).join(', ')}]`,
      })
      return dispose
    } catch (error) {
      // inject 回调里抛错只会进 renderer console（宿主看不到），所以必须自己回执。
      postDebug({
        kind: 'view-register-failed',
        note: `register 抛错（页签因此静默失效）：${error instanceof Error ? error.message : String(error)}`,
      })
      return () => {}
    }
  })

  // 4) 输入框工具行里的「角色」chip：**空白会话的第一屏就渲染**，所以首轮也能选角。
  //    （页签要等第一轮开始才出现 —— 这是 DSH 的既定行为，理由见 chip.tsx 文件头。）
  const openView = (sessionId: string): void => {
    try {
      const ui = ctx.get('uiConversation') as
        | { binding(id: string): { activate(view: string): void } | undefined }
        | undefined
      ui?.binding(sessionId)?.activate(VIEW_ID)
    } catch {
      // 打开视图失败不影响 chip 本身
    }
  }
  ctx.slots.inject('conversation.input.left', () => {
    try {
      const dispose = ctx.slots.register(
        { name: 'conversation.input.left', id: 'cosplay-card-chip', order: 20 },
        (props: unknown) => (
          <CardChip
            {...(props as CardChipProps)}
            openView={openView}
            // 没有会话时（应用刚启动的 Hero）选卡 = 设"新会话默认角色"，写插件配置。
            defaults={{ set: (cardId) => scope.set('defaultCardId', cardId) }}
          />
        ),
      )
      postDebug({ kind: 'chip-registered', note: '输入框角色 chip 已注册（conversation.input.left）' })
      return dispose
    } catch (error) {
      postDebug({
        kind: 'chip-register-failed',
        note: `chip 注册抛错：${error instanceof Error ? error.message : String(error)}`,
      })
      return () => {}
    }
  })

  // 5) 设置页：卡片库管理 + 诊断 + 默认角色。
  ctx.slots.inject('settings.section', () => {
    try {
      const dispose = ctx.slots.register(
        {
          name: 'settings.section',
          id: SETTINGS_SECTION_ID,
          order: SETTINGS_SECTION_ORDER,
          label: () => SETTINGS_LABEL,
        },
        (props: unknown) => <CosplaySettings {...(props as object)} scope={scope} />,
      )
      if (!settingsReported) {
        settingsReported = true
        postDebug({ kind: 'settings-registered', note: `设置页已注册 id=${SETTINGS_SECTION_ID} label=${SETTINGS_LABEL}` })
      }
      return dispose
    } catch (error) {
      postDebug({
        kind: 'settings-register-failed',
        note: `settings.section 注册抛错：${error instanceof Error ? error.message : String(error)}`,
      })
      return () => {}
    }
  })

  postDebug({
    kind: 'client-installed',
    note: `build=${CLIENT_BUILD} view=${VIEW_ID}(${COPY.newCard ? '卡片库' : ''}) settings=${SETTINGS_SECTION_ID}`,
  })
}
