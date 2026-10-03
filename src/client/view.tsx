/**
 * dsh-cosplay — 「角色」页签（`conversation.view` 的入口 id `cosplay`）。
 *
 * ## 形状
 *
 * 一级：近方形圆角卡片的网格（有立绘就用立绘，没有就用占位表情 + 名字）。
 * 点一张 → 二级详情（大图 + 人设/规则全文 + 使用/停用/编辑/复制/导出/删除）。
 * 详情里点"编辑" → 就地变成编辑器（同一个页签里，不弹窗）。
 *
 * ## 这一层负责的策略（写在这里，免得将来忘了为什么）
 *
 * "默认卡"由**本页签在会话里第一次打开时**写成本会话的显式绑定：于是只有你真的
 * 打开过角色页签的会话才会自动上角色，subagent / 后台会话不会被悄悄套上人设
 * （宿主侧的 `injectIntoUnboundSessions` 默认关着，就是这条的兜底）。
 */

import { useEffect, useMemo, useState, type ChangeEvent, type ReactElement } from 'react'
import { useSessionCard } from './binding.js'
import { COPY, VIEW_LABEL } from './copy.js'
import { composeRewriteSystem } from '../prompt.js'
import { CardEditor } from './editor.js'
import {
  copyCard,
  deleteCard,
  exportPack,
  exportWrite,
  fetchCard,
  fetchLibrary,
  importPack,
  postDebug,
  rewriteOnce,
} from './api.js'
import type { CardMeta, CosplayCard } from '../types.js'

/** 页签当前停在哪一层。 */
type Screen = { kind: 'grid' } | { kind: 'detail'; id: string } | { kind: 'edit'; id: string | undefined }

/** 详情里显示的单卡数据（元数据 + 全文）。 */
interface DetailState {
  meta: CardMeta
  card: CosplayCard | undefined
  loading: boolean
}

/** 已经报过"挂载"的会话（模块级去重；渲染期只写模块变量，不 setState）。 */
const mountedReported = new Set<string>()

/** 时间戳 → 本地时分。 */
function clockOf(at: number): string {
  const date = new Date(at)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

/** 卡片上的模式角标。 */
function modeLabel(mode: CardMeta['mode']): string {
  return mode === 'system' ? '人设' : mode === 'rewrite' ? '改写' : '人设+改写'
}

/** 一张卡片。 */
function CardTile({ meta, active, aspect, onOpen }: { meta: CardMeta; active: boolean; aspect: number; onOpen: () => void }): ReactElement {
  const hue = meta.cover?.hue ?? 210
  return (
    <button type="button" className={`dsh-cosplay-tile${active ? ' active' : ''}`} onClick={onOpen} title={meta.description ?? meta.name}>
      <span className="dsh-cosplay-tile-art" style={{ aspectRatio: `${String(aspect)} / 1` }}>
        {meta.artUrl === undefined ? (
          <span
            className="dsh-cosplay-tile-fallback"
            style={{ background: `linear-gradient(140deg, hsl(${String(hue)} 70% 62% / 0.35), hsl(${String((hue + 48) % 360)} 70% 55% / 0.22))` }}
          >
            {meta.cover?.emoji ?? '🎭'}
          </span>
        ) : (
          <img src={meta.artUrl} alt={meta.name} loading="lazy" draggable={false} />
        )}
      </span>
      <span className="dsh-cosplay-badges">
        {active ? <span className="dsh-cosplay-badge brand">{COPY.inUse}</span> : null}
        {meta.source === 'preset' ? <span className="dsh-cosplay-badge">预设</span> : null}
      </span>
      <span className="dsh-cosplay-tile-meta">
        <span className="dsh-cosplay-tile-name">{meta.name}</span>
        <span className="dsh-cosplay-tile-desc">
          {meta.description ?? `${modeLabel(meta.mode)}${meta.source === 'custom' ? ' · 自定义' : ''}`}
        </span>
      </span>
    </button>
  )
}

/** 「角色」页签。 */
export function CosplayView(props: { sessionId?: unknown }): ReactElement {
  const sessionId = typeof props.sessionId === 'string' ? props.sessionId : ''
  // 绑定与卡片库都由共享 hook 管（它同时负责"挂载即落地默认卡"，见 binding.ts）。
  const session = useSessionCard(sessionId)
  const library = session.library
  const [screen, setScreen] = useState<Screen>({ kind: 'grid' })
  const [detail, setDetail] = useState<DetailState | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const [rewritePreview, setRewritePreview] = useState('')
  /** 是否展开"实际发送的完整 system prompt"（透明性：卡片 rules + 插件追加的输出纪律）。 */
  const [showFullPrompt, setShowFullPrompt] = useState(false)
  /** 展开哪一条改写记录的「原文 ↔ 改写后」对照（key = messageId-at）。 */
  const [expandedRewrite, setExpandedRewrite] = useState('')

  // 同步回执：组件只要被渲染就会留下这一条（模块级去重，不用 state 也不进 effect）。
  if (sessionId !== '' && !mountedReported.has(sessionId) && mountedReported.size < 8) {
    mountedReported.add(sessionId)
    postDebug({ kind: 'view-mounted', sessionId, note: `「${VIEW_LABEL}」页签渲染（M1）` })
  }

  const refresh = session.reload

  useEffect(() => {
    if (library === undefined && !session.loading) setError('读不到 /api/dsh-cosplay/library —— 宿主半边没装上或没重挂')
  }, [library, session.loading])

  const activeId = session.boundId
  const enabled = session.enabled
  const aspect = library?.config.coverAspect ?? 1

  /** 打开详情（按 id：先拿最新的元数据，再读全文）。 */
  const openDetailById = async (id: string): Promise<void> => {
    const lib = library ?? (await fetchLibrary())
    const meta = lib?.cards.find((candidate) => candidate.id === id)
    if (meta === undefined) {
      setScreen({ kind: 'grid' })
      return
    }
    setScreen({ kind: 'detail', id })
    setDetail({ meta, card: undefined, loading: true })
    const full = await fetchCard(id)
    setDetail((current) => (current === undefined || current.meta.id !== id ? current : { meta, card: full?.card, loading: false }))
  }

  /** 打开详情（手上已有元数据）。 */
  const openDetail = (meta: CardMeta): Promise<void> => openDetailById(meta.id)

  /** 在本会话使用。 */
  const useCard = async (id: string): Promise<void> => {
    if (sessionId === '') {
      setError('这个页签要挂在会话里用（当前没有会话）')
      return
    }
    setBusy(true)
    try {
      await session.setCard(id)
      setNote('已在本会话启用')
    } finally {
      setBusy(false)
    }
  }

  /** 本会话停用（注入与改写都停）。 */
  const disable = async (): Promise<void> => {
    if (sessionId === '') return
    setBusy(true)
    try {
      await session.setEnabled(false)
      setNote('本会话已停用角色（零 token）')
    } finally {
      setBusy(false)
    }
  }

  /** 复制为自定义。 */
  const copyToCustom = async (id: string): Promise<void> => {
    setBusy(true)
    try {
      const result = await copyCard(id, {})
      if (result?.ok === true && result.card !== null) {
        setNote(`已复制为自定义卡：${result.card.name}`)
        postDebug({ kind: 'card-copied', id: result.card.id, note: `来源 ${id}` })
        await refresh()
        await openDetailById(result.card.id)
      } else setError('复制失败')
    } finally {
      setBusy(false)
    }
  }

  /** 导出：优先"落盘"（路径可复制），同时给一份浏览器下载。 */
  const doExport = async (ids: string[] | undefined): Promise<void> => {
    setBusy(true)
    try {
      const written = await exportWrite(ids)
      const pack = await exportPack(ids)
      if (pack !== undefined) {
        try {
          const blob = new Blob([JSON.stringify(pack, null, 2)], { type: 'application/json' })
          const url = URL.createObjectURL(blob)
          const anchor = document.createElement('a')
          anchor.href = url
          anchor.download = `cosplay-${String(Date.now())}.json`
          anchor.click()
          setTimeout(() => URL.revokeObjectURL(url), 4000)
        } catch {
          // 浏览器拒绝下载也没关系：宿主已经落盘了。
        }
      }
      setNote(written?.ok === true ? `已导出到磁盘：${written.path}` : '已生成导出文件（磁盘落点不可用）')
      postDebug({ kind: 'export', note: written?.ok === true ? `path=${written.path} cards=${String(written.cards)}` : 'download only' })
    } finally {
      setBusy(false)
    }
  }

  /** 导入。 */
  const doImport = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (file === undefined) return
    setBusy(true)
    try {
      const text = await file.text()
      let parsed: unknown
      try {
        parsed = JSON.parse(text) as unknown
      } catch {
        setError('这个文件不是 JSON')
        return
      }
      const result = await importPack(parsed)
      if (result === undefined) {
        setError('导入失败（宿主没响应）')
        return
      }
      setNote(`导入完成：新增 ${String(result.added)} · 覆盖 ${String(result.replaced)} · 跳过 ${String(result.skipped)}${result.errors.length === 0 ? '' : ` · ${String(result.errors.length)} 条说明`}`)
      setError(result.errors.length === 0 ? '' : result.errors.slice(0, 3).join(' / '))
      postDebug({ kind: 'import', note: `added=${String(result.added)} replaced=${String(result.replaced)} errors=${String(result.errors.length)}` })
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  /** 手动改写一次（排障/预览）。 */
  const tryRewrite = async (cardId: string): Promise<void> => {
    if (sessionId === '') {
      setError('手动改写需要会话上下文')
      return
    }
    setBusy(true)
    try {
      const result = await rewriteOnce({ sessionId, cardId, text: '帮我用 Canvas 画一个赛博朋克风的机械骷髅头像。' })
      if (result === undefined) setError('改写请求失败')
      else if (result.ok) {
        setRewritePreview(result.text)
        setNote(`改写成功（${String(result.ms)}ms · ${result.model}）`)
      } else {
        setRewritePreview('')
        setError(`改写失败：${result.error}`)
      }
    } finally {
      setBusy(false)
    }
  }

  const cards = useMemo(() => library?.cards ?? [], [library])

  // ── 编辑器 ──────────────────────────────────────────────────────────────
  if (screen.kind === 'edit') {
    const existing = screen.id === undefined ? undefined : detail?.card
    return (
      <div className="dsh-cosplay-view">
        <CardEditor
          initial={existing}
          artMaxEdge={library?.config.artMaxEdge ?? 1024}
          artQuality={library?.config.artQuality ?? 0.85}
          onSaved={(card) => {
            setNote(`已保存「${card.name}」`)
            setScreen({ kind: 'grid' })
            void (async () => {
              await refresh()
              await openDetailById(card.id)
            })()
          }}
          onCancel={() => setScreen({ kind: 'grid' })}
        />
      </div>
    )
  }

  // ── 二级详情 ────────────────────────────────────────────────────────────
  if (screen.kind === 'detail' && detail !== undefined) {
    const { meta, card } = detail
    return (
      <div className="dsh-cosplay-view">
        <div className="dsh-cosplay-bar">
          <button type="button" className="dsh-cosplay-btn" onClick={() => setScreen({ kind: 'grid' })}>
            ← {COPY.back}
          </button>
          <span className="dsh-cosplay-spacer" />
          {activeId === meta.id && enabled ? (
            <button type="button" className="dsh-cosplay-btn" onClick={() => void disable()} disabled={busy}>
              {COPY.disable}
            </button>
          ) : (
            <button type="button" className="dsh-cosplay-btn primary" onClick={() => void useCard(meta.id)} disabled={busy}>
              {COPY.use}
            </button>
          )}
          <button type="button" className="dsh-cosplay-btn" onClick={() => setScreen({ kind: 'edit', id: meta.id })} disabled={busy || meta.source === 'preset'}>
            {COPY.edit}
          </button>
          <button type="button" className="dsh-cosplay-btn" onClick={() => void copyToCustom(meta.id)} disabled={busy}>
            {COPY.copyToCustom}
          </button>
          <button type="button" className="dsh-cosplay-btn" onClick={() => void doExport([meta.id])} disabled={busy}>
            导出这张
          </button>
          {meta.source === 'custom' ? (
            <button
              type="button"
              className="dsh-cosplay-btn danger"
              disabled={busy}
              onClick={() => {
                void (async () => {
                  await deleteCard(meta.id)
                  postDebug({ kind: 'card-deleted', id: meta.id, note: 'detail' })
                  await refresh()
                  setScreen({ kind: 'grid' })
                })()
              }}
            >
              {COPY.remove}
            </button>
          ) : null}
        </div>

        {note !== '' ? <div className="dsh-cosplay-ok">{note}</div> : null}
        {error !== '' ? <div className="dsh-cosplay-error">{error}</div> : null}

        <div className="dsh-cosplay-detail">
          <span
            className="dsh-cosplay-detail-art"
            onClick={() => {
              if (meta.artUrl !== undefined) window.open(meta.artUrl, '_blank', 'noopener,noreferrer')
            }}
            title={meta.artUrl === undefined ? '没有立绘' : COPY.preview}
          >
            {meta.artUrl === undefined ? (
              <span className="dsh-cosplay-tile-fallback" style={{ background: `linear-gradient(140deg, hsl(${String(meta.cover?.hue ?? 210)} 70% 62% / 0.35), hsl(260 70% 55% / 0.22))` }}>
                {meta.cover?.emoji ?? '🎭'}
              </span>
            ) : (
              <img src={meta.artUrl} alt={meta.name} draggable={false} />
            )}
          </span>

          <div className="dsh-cosplay-detail-body">
            <div>
              <div className="dsh-cosplay-h2">
                {meta.name}
                {meta.title === undefined ? '' : ` · ${meta.title}`}
              </div>
              <div className="dsh-cosplay-desc">
                {meta.description ?? '（没有简介）'} · {modeLabel(meta.mode)} · {meta.source === 'preset' ? '预设（只读）' : '自定义'}
              </div>
            </div>
            {(meta.tags ?? []).length > 0 ? (
              <div className="dsh-cosplay-tags">
                {(meta.tags ?? []).map((tag) => (
                  <span className="dsh-cosplay-tag" key={tag}>
                    {tag}
                  </span>
                ))}
              </div>
            ) : null}

            {meta.source === 'preset' ? (
              <div className="dsh-cosplay-note">
                预设卡可以直接用（点「{COPY.use}」）。只有想改它时才需要「{COPY.copyToCustom}」——
                这样插件升级时预设还能更新，你的改动也不会被覆盖。
              </div>
            ) : null}

            {detail.loading ? <div className="dsh-cosplay-note">读取中…</div> : null}

            {card?.persona !== undefined && card.persona !== '' ? (
              <div>
                <div className="dsh-cosplay-card-title">人设（注入系统提示）</div>
                <pre className="dsh-cosplay-pre">{card.persona}</pre>
              </div>
            ) : null}

            {card?.rewrite !== undefined && card.rewrite !== null ? (
              <div>
                <div className="dsh-cosplay-card-title">改写规则（卡片里的 rules，原样）</div>
                <pre className="dsh-cosplay-pre">{card.rewrite.rules}</pre>
                <div className="dsh-cosplay-bar" style={{ marginTop: 8 }}>
                  <button type="button" className="dsh-cosplay-btn" onClick={() => setShowFullPrompt((value) => !value)}>
                    {showFullPrompt ? '收起重写调用的完整 system prompt' : '看实际发送的完整 system prompt'}
                  </button>
                  <button type="button" className="dsh-cosplay-btn" onClick={() => void tryRewrite(meta.id)} disabled={busy}>
                    {COPY.manualRewrite}
                  </button>
                  <span className="dsh-cosplay-hint">
                    改写调用 = 卡片 rules + 示例 + 插件追加的输出纪律（下面就是原文，没有隐藏内容）
                  </span>
                </div>
                {showFullPrompt ? <pre className="dsh-cosplay-pre" style={{ marginTop: 8 }}>{composeRewriteSystem(card)}</pre> : null}
                {rewritePreview !== '' ? <pre className="dsh-cosplay-pre" style={{ marginTop: 8 }}>{rewritePreview}</pre> : null}
              </div>
            ) : null}

            {(session.binding?.rewrites ?? []).length > 0 ? (
              <div>
                <div className="dsh-cosplay-card-title">本会话最近改写</div>
                <div className="dsh-cosplay-hint" style={{ marginBottom: 4 }}>
                  点「原文 ↔ 改写后」能对着看：改写只该动措辞，不该换掉任务主体（换会话也换不掉历史）。
                </div>
                <div className="dsh-cosplay-trace">
                  {(session.binding?.rewrites ?? []).map((item) => {
                    const key = `${item.messageId}-${String(item.at)}`
                    const expanded = expandedRewrite === key
                    return (
                      <div key={key}>
                        <span className="dsh-cosplay-trace-kind">{item.ok ? '✓' : '✗'}</span> {clockOf(item.at)} ·{' '}
                        {item.cardId} · {String(item.inChars)}→{String(item.outChars)} 字 · {String(item.ms)}ms · {item.model}
                        {item.contextTurns === undefined ? '' : ` · 上下文 ${String(item.contextTurns)} 条/${String(item.contextChars ?? 0)} 字`}
                        {item.error === undefined ? '' : ` · ${item.error}`}
                        {item.original === undefined ? null : (
                          <button
                            type="button"
                            className="dsh-cosplay-btn tiny"
                            style={{ marginLeft: 6 }}
                            onClick={() => setExpandedRewrite(expanded ? '' : key)}
                          >
                            {expanded ? '收起' : '原文 ↔ 改写后'}
                          </button>
                        )}
                        {expanded && item.original !== undefined ? (
                          <div className="dsh-cosplay-compare">
                            <div>
                              <div className="dsh-cosplay-hint">你发的原文（{String(item.inChars)} 字）</div>
                              <pre className="dsh-cosplay-pre">{item.original}</pre>
                            </div>
                            <div>
                              <div className="dsh-cosplay-hint">模型实际收到的（{String(item.outChars)} 字）</div>
                              <pre className="dsh-cosplay-pre">{item.preview}</pre>
                            </div>
                          </div>
                        ) : null}
                      </div>
                    )
                  })}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    )
  }

  // ── 一级网格 ────────────────────────────────────────────────────────────
  const boundMeta = cards.find((meta) => meta.id === activeId)
  return (
    <div className="dsh-cosplay-view">
      <div className="dsh-cosplay-bar">
        <span className="dsh-cosplay-title">{VIEW_LABEL}卡</span>
        <span className="dsh-cosplay-sub">
          {COPY.boundTo}：{boundMeta === undefined ? COPY.none : `${boundMeta.name}${enabled ? '' : '（已停用）'}`}
        </span>
        <span className="dsh-cosplay-spacer" />
        <label className="dsh-cosplay-btn" style={{ cursor: 'pointer' }}>
          {COPY.importPack}
          <input type="file" accept="application/json,.json" style={{ display: 'none' }} onChange={(event) => void doImport(event)} />
        </label>
        <button type="button" className="dsh-cosplay-btn" onClick={() => void doExport(undefined)} disabled={busy}>
          {COPY.exportAll}
        </button>
        <button type="button" className="dsh-cosplay-btn" onClick={() => setScreen({ kind: 'edit', id: undefined })} disabled={busy}>
          + {COPY.newCard}
        </button>
        <button type="button" className="dsh-cosplay-btn" onClick={() => void refresh()} disabled={busy}>
          {COPY.refresh}
        </button>
      </div>

      {note !== '' ? <div className="dsh-cosplay-ok">{note}</div> : null}
      {error !== '' ? <div className="dsh-cosplay-error">{error}</div> : null}

      {cards.length === 0 ? (
        <div className="dsh-cosplay-note">
          卡片库是空的。可以「{COPY.newCard}」，也可以「{COPY.importPack}」一个别人发来的卡包
          {library === undefined ? '。' : `（库目录：${library.root}）`}
        </div>
      ) : (
        <div className="dsh-cosplay-grid">
          {cards.map((meta) => (
            <CardTile key={meta.id} meta={meta} aspect={aspect} active={meta.id === activeId && enabled} onOpen={() => void openDetail(meta)} />
          ))}
        </div>
      )}

      <div className="dsh-cosplay-note">
        点一张卡 → 二级详情 → 在本会话使用。改写型卡片（角标「改写」）会让每条消息先经一次模型改写：
        多一次调用、多约 1–3 秒，随时可以「本会话停用」或 <code>/cosplay off</code> 一键停。
      </div>
    </div>
  )
}
