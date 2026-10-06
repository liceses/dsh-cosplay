/**
 * dsh-cosplay — 输入框工具行里的「角色」chip（`conversation.input.left`）。
 *
 * ## 为什么是这里
 *
 * 空白会话不显示页签条，所以**第一轮之前没有任何地方能选角色**。而输入框工具行
 * （`+` / 权限 / 模式 那一排）是**加法型 list 座位**，Hero 状态同样渲染 ——
 * 于是「新建会话 → 点 chip → 选卡 → 发送」这条链在首轮就成立。
 *
 * 它同时也承担"绑定落地"：hook 在挂载时就把生效值写成显式绑定（见 `binding.ts`），
 * 所以就算你什么都不点，配了默认卡的新会话首轮也带角色。
 *
 * ## 交互
 *
 * 点 chip → 在它上方弹一个浮层（`position: fixed`，锚在按钮的 rect 上，避免被输入框的
 * overflow 裁掉）：卡片列表（带立绘小图/表情、模式角标、当前项高亮）+ 停用/无角色。
 * 点浮层外任意处关闭。
 */

import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react'
import { createPortal } from 'react-dom'
import type { CardMeta } from '../types.js'
import { useSessionCard } from './binding.js'
import { postDebug } from './api.js'

/** chip 的入参（由 `conversation.input.left` 的会话标准件提供）。 */
export interface CardChipProps {
  sessionId?: unknown
  /** 打开「角色」页签（由 `index.tsx` 注入：走会话的视图激活）。 */
  openView?: (sessionId: string) => void
  /**
   * 没有会话时的落点：写插件配置里的 `defaultCardId`。
   *
   * 为什么需要它：应用刚启动、还没选中任何会话时，composer 是 session-maybe 的 ——
   * chip 照样渲染（回执里能看到 `chip-mounted` 没有 sessionId）。此时"选一张卡"
   * 唯一的合理含义就是"作为新会话的默认角色"，而不是弹一句"没有会话"。
   */
  defaults?: { set: (cardId: string) => Promise<boolean> }
}

/** 模式角标文案。 */
function modeLabel(meta: CardMeta): string {
  return meta.mode === 'system' ? '人设' : meta.mode === 'rewrite' ? '改写' : '人设+改写'
}

/** 卡片小图（立绘优先，退回表情）。 */
function CardAvatar({ meta, size }: { meta: CardMeta; size: number }): ReactElement {
  if (meta.artUrl !== undefined) {
    return <img className="dsh-cosplay-avatar" src={meta.artUrl} alt="" width={size} height={size} draggable={false} />
  }
  return (
    <span
      className="dsh-cosplay-avatar fallback"
      style={{
        width: size,
        height: size,
        background: `linear-gradient(140deg, hsl(${String(meta.cover?.hue ?? 210)} 70% 62% / 0.4), hsl(${String(((meta.cover?.hue ?? 210) + 48) % 360)} 70% 55% / 0.25))`,
      }}
    >
      {meta.cover?.emoji ?? '🎭'}
    </span>
  )
}

/** 输入框工具行里的角色 chip。 */
export function CardChip({ sessionId: rawSessionId, openView, defaults }: CardChipProps): ReactElement | null {
  const sessionId = typeof rawSessionId === 'string' ? rawSessionId : ''
  const state = useSessionCard(sessionId)
  /** 没有会话：这时 chip 管的是"新会话默认角色"（写插件配置）。 */
  const sessionless = sessionId === ''
  const defaultId = state.library?.config.defaultCardId ?? ''
  const defaultMeta = sessionless ? (state.library?.cards.find((meta) => meta.id === defaultId) ?? null) : null
  const [open, setOpen] = useState(false)
  const [anchor, setAnchor] = useState<{ left: number; top?: number; bottom?: number } | undefined>(undefined)
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  /** 已经报过挂载的会话（去重）。 */
  const reported = useRef(false)

  useEffect(() => {
    if (reported.current || sessionId === '') return
    reported.current = true
    postDebug({ kind: 'chip-mounted', sessionId, note: '输入框角色 chip 已挂载（首轮即可选角）' })
  }, [sessionId])

  /** 打开浮层：优先在按钮正上方，上方放不下就翻到下方。 */
  const toggle = useCallback(() => {
    const rect = buttonRef.current?.getBoundingClientRect()
    if (rect !== undefined) {
      const cards = state.library?.cards.length ?? 0
      const height = Math.min(360, 118 + cards * 34)
      const left = Math.max(8, Math.min(rect.left, Math.max(8, window.innerWidth - 308)))
      const above = rect.top > height + 16
      setAnchor(above ? { left, bottom: window.innerHeight - rect.top + 6 } : { left, top: rect.bottom + 6 })
    }
    setOpen((value) => !value)
  }, [state.library])

  // 点浮层外 / Esc 关闭。
  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent): void => {
      const target = event.target as Node | null
      if (target !== null && buttonRef.current?.contains(target) === true) return
      const panel = document.getElementById('dsh-cosplay-chip-panel')
      if (panel !== null && target !== null && panel.contains(target)) return
      setOpen(false)
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const card = sessionless ? defaultMeta : state.card
  const label = card === null ? '无角色' : card.name
  const title = sessionless
    ? card === null
      ? '还没有会话 · 点一下选一张卡作为新会话的默认角色'
      : `新会话默认角色：${card.name} · 点一下更换`
    : card === null
      ? '本会话还没有角色 · 点一下选一个（第一轮发送前就能选）'
      : `本会话角色：${card.name}${state.enabled ? '' : '（已停用）'} · 点一下更换`
  /** 选中一张卡：有会话就绑本会话，没会话就写默认角色。 */
  const pick = (cardId: string): void => {
    void (sessionless ? defaults?.set(cardId) : state.setCard(cardId))
    setOpen(false)
  }

  /**
   * 本会话是否换过卡（用来给一个诚实提示）。
   *
   * 为什么值得提示：换卡**只**改变之后注入的人设，历史里那些旧口吻的对话是
   * append-only 的 durable 记录、不会消失。想从干净上下文开始角色只能开新会话。
   */
  const seen = state.binding?.binding.cardsSeen ?? []
  const switched = !sessionless && seen.length > 1
  const previousNames = seen
    .slice(1)
    .reverse()
    .map((id) => state.library?.cards.find((meta) => meta.id === id)?.name ?? id)
    .join(' → ')

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={`dsh-cosplay-chip${card === null ? ' empty' : ''}${state.enabled ? '' : ' off'}`}
        title={title}
        aria-label={title}
        onClick={toggle}
      >
        {card === null ? <span className="dsh-cosplay-chip-emoji">🎭</span> : <CardAvatar meta={card} size={14} />}
        <span className="dsh-cosplay-chip-name">{label}</span>
        {card !== null && card.mode !== 'system' ? <span className="dsh-cosplay-chip-mode">{modeLabel(card)}</span> : null}
      </button>

      {open && anchor !== undefined ? createPortal(
        <div
          id="dsh-cosplay-chip-panel"
          className="dsh-cosplay-pop"
          style={{
            left: anchor.left,
            ...(anchor.top === undefined ? { bottom: anchor.bottom } : { top: anchor.top }),
            maxHeight: 'min(60vh, 420px)',
          }}
          role="dialog"
          aria-label="选择本会话角色"
        >
          <div className="dsh-cosplay-pop-head">
            <span>{sessionless ? '新会话默认角色' : '本会话角色'}</span>
            <span className="dsh-cosplay-hint">{sessionless ? '（还没有会话）' : state.enabled ? '' : '（已停用）'}</span>
          </div>

          {state.library === undefined ? (
            <div className="dsh-cosplay-note" style={{ padding: '8px 10px' }}>
              {state.loading ? '读取中…' : '读不到卡片库（宿主半边没装上或没重挂？）'}
            </div>
          ) : (
            <div className="dsh-cosplay-pop-list">
              {(state.library.cards ?? []).map((meta) => (
                <button
                  key={meta.id}
                  type="button"
                  className={`dsh-cosplay-pop-item${meta.id === (sessionless ? defaultId : state.boundId) ? ' active' : ''}`}
                  onClick={() => pick(meta.id)}
                >
                  <CardAvatar meta={meta} size={20} />
                  <span className="dsh-cosplay-pop-name">
                    {meta.name}
                    {meta.source === 'custom' ? <span className="dsh-cosplay-pop-tag">自定义</span> : null}
                  </span>
                  <span className="dsh-cosplay-pop-mode">{modeLabel(meta)}</span>
                </button>
              ))}
              {(state.library.cards ?? []).length === 0 ? (
                <div className="dsh-cosplay-note" style={{ padding: '8px 10px' }}>
                  卡片库是空的：去「角色」页签新建一张，或导入一个卡包
                </div>
              ) : null}
            </div>
          )}

          {state.error !== '' ? <div className="dsh-cosplay-error" style={{ padding: '0 10px 6px' }}>{state.error}</div> : null}

          {switched ? (
            <div className="dsh-cosplay-note" style={{ padding: '0 10px 6px' }}>
              本会话换过卡（{previousNames} → {card?.name ?? '无角色'}）。历史里前面那些对话
              <strong>不会</strong>随换卡改变，旧口吻还在；想让角色从干净上下文开始 → 新建会话
              （会自动带上刚选的这张卡）。
            </div>
          ) : null}

          <div className="dsh-cosplay-pop-foot">
            {sessionless ? null : (
              <button
                type="button"
                className="dsh-cosplay-btn tiny"
                onClick={() => {
                  void state.setEnabled(!state.enabled)
                }}
                disabled={state.boundId === null}
              >
                {state.enabled ? '本会话停用' : '重新启用'}
              </button>
            )}
            <button
              type="button"
              className="dsh-cosplay-btn tiny"
              onClick={() => {
                if (sessionless) void defaults?.set('')
                else void state.setCard(null)
                setOpen(false)
              }}
            >
              {sessionless ? '清空默认角色' : '清空角色'}
            </button>
            <span className="dsh-cosplay-spacer" />
            <button
              type="button"
              className="dsh-cosplay-btn tiny"
              onClick={() => {
                if (sessionId !== '') openView?.(sessionId)
                setOpen(false)
              }}
              disabled={openView === undefined || sessionless}
              title="卡片管理：编辑、导入导出、立绘。空白会话的页签要等第一轮开始才出现"
            >
              管理卡片…
            </button>
          </div>
        </div>,
        document.body,
      ) : null}
    </>
  )
}
