/**
 * dsh-cosplay — 「本会话角色」的共享状态（浏览器半边）。
 *
 * ## 这个 hook 解决的那个硬伤
 *
 * DSH 的空白会话**不显示页签条**（`dsh-client-ui-conversation`：`showTabs = !hideChrome && …`，
 * 而空白态 `hideChrome = blank`；视图区在 blank 阶段直接 `return null`）。
 * 所以"打开角色页签再选角"这条路对**第一轮**根本不成立 —— 页签要等第一轮开始才出现。
 *
 * 修法：把"绑定落地"从"打开角色页签"提前到**会话视图挂载时**，并把入口放进输入框工具行
 * （`conversation.input.left`，Hero 状态同样渲染）。于是：
 *
 *   新建会话 → chip 挂载 → 立刻把生效值写成显式绑定 → 你敲字发送时宿主已经知道用哪张卡。
 *
 * ## 只写一次
 *
 * `materializeDefault` 用模块级 Set 去重：一个会话只在"还没有显式绑定"时落地一次默认卡，
 * 之后（包括你手动改成"无角色"）都不会被再写回去。
 */

import { useCallback, useEffect, useState } from 'react'
import { effectiveCardId } from '../bindings.js'
import type { CardMeta } from '../types.js'
import { fetchBinding, fetchLibrary, postDebug, putBinding, type BindingResponse, type LibraryResponse } from './api.js'

/** 已经落地过默认卡的会话。 */
const materialized = new Set<string>()

/** hook 的返回值。 */
export interface SessionCardState {
  loading: boolean
  error: string
  library: LibraryResponse | undefined
  binding: BindingResponse | undefined
  /** 实际生效的卡 id（空串 = 没有角色）。 */
  effectiveId: string
  /** 生效卡的元数据。 */
  card: CardMeta | null
  /** 本会话是否启用（`false` = 零注入零改写）。 */
  enabled: boolean
  /** 显式绑定（null = 没有显式绑定）。 */
  boundId: string | null
  setCard: (cardId: string | null) => Promise<void>
  setEnabled: (enabled: boolean) => Promise<void>
  reload: () => Promise<void>
}

/**
 * 读/写本会话的角色。
 * @param sessionId - 当前会话 id（空串 = 没有会话，hook 退化成空闲状态）。
 */
export function useSessionCard(sessionId: string): SessionCardState {
  const [library, setLibrary] = useState<LibraryResponse | undefined>(undefined)
  const [binding, setBinding] = useState<BindingResponse | undefined>(undefined)
  const [loading, setLoading] = useState(sessionId !== '')
  const [error, setError] = useState('')

  const reload = useCallback(async (): Promise<void> => {
    const nextLibrary = await fetchLibrary()
    setLibrary(nextLibrary)
    if (sessionId === '') {
      setBinding(undefined)
      setLoading(false)
      return
    }
    const nextBinding = await fetchBinding(sessionId)
    setBinding(nextBinding)
    setLoading(false)
    setError(nextBinding === undefined ? '读不到本会话的角色绑定（宿主半边没装上或没重挂？）' : '')

    // 新会话落地哪张卡（只写一次）：优先级 **lastCardId > defaultCardId**。
    // lastCardId = "你上次真的选过的那张"（换会话不换角色）；defaultCardId = 全局默认。
    const lastCardId = typeof nextLibrary?.lastCardId === 'string' ? nextLibrary.lastCardId : ''
    const inherited = lastCardId !== '' ? lastCardId : (nextLibrary?.config.defaultCardId ?? '')
    const source = lastCardId !== '' ? '上次用的卡' : '默认卡'
    const explicit = nextBinding !== undefined && nextBinding.binding.updatedAt !== 0
    if (!explicit && inherited !== '' && !materialized.has(sessionId)) {
      materialized.add(sessionId)
      const result = await putBinding(sessionId, { cardId: inherited, enabled: true })
      postDebug({
        kind: 'binding-materialized',
        sessionId,
        id: inherited,
        note: result?.ok === true ? `会话视图挂载 → 落地${source}（首轮就带角色）` : `落地${source}失败`,
      })
      if (result?.ok === true) setBinding(await fetchBinding(sessionId))
    }
  }, [sessionId])

  useEffect(() => {
    void reload()
  }, [reload])

  const setCard = useCallback(
    async (cardId: string | null): Promise<void> => {
      if (sessionId === '') {
        setError('这个入口要挂在会话里用（当前没有会话）')
        return
      }
      const result = await putBinding(sessionId, { cardId, enabled: true })
      if (result?.ok === true) {
        materialized.add(sessionId)
        postDebug({ kind: 'binding-set', sessionId, ...(cardId === null ? {} : { id: cardId }), note: cardId === null ? '清空角色' : '选定角色' })
        setBinding(await fetchBinding(sessionId))
        setError('')
      } else setError('绑定失败（宿主没响应？）')
    },
    [sessionId],
  )

  const setEnabled = useCallback(
    async (enabled: boolean): Promise<void> => {
      if (sessionId === '') return
      const result = await putBinding(sessionId, { enabled })
      if (result?.ok === true) {
        materialized.add(sessionId)
        postDebug({ kind: 'binding-enabled', sessionId, note: enabled ? '本会话启用角色' : '本会话停用角色（零 token）' })
        setBinding(await fetchBinding(sessionId))
      } else setError('切换失败')
    },
    [sessionId],
  )

  const boundId = binding?.binding.cardId ?? null
  const enabled = binding?.binding.enabled !== false
  const effectiveId = effectiveCardId({
    binding: binding?.binding,
    // 客户端的"默认卡"已经物化成显式绑定了，所以这里不再叠加默认卡逻辑（避免显示与生效漂移）。
    defaultCardId: '',
    injectIntoUnbound: false,
  })

  return {
    loading,
    error,
    library,
    binding,
    effectiveId,
    card: binding?.card ?? (library?.cards.find((meta) => meta.id === effectiveId) ?? null),
    enabled,
    boundId,
    setCard,
    setEnabled,
    reload,
  }
}
