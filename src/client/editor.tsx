/**
 * dsh-cosplay — 角色卡编辑器（二级界面里的"编辑"）。
 *
 * 形状刻意贴 DSH 原版：**没有独立弹窗**，就在页签里就地展开（与"角色卡 → 点击 → 二级界面"
 * 是同一层），字段用主题变量画的输入框，保存/取消固定在底部。
 *
 * 立绘走"选文件 → canvas 压到上限 → POST /art"三步；拿到的是宿主算好的 sha256 引用，
 * 所以同一张图重复上传不会存两份（按内容去重）。
 */

import { useRef, useState, type ChangeEvent, type ReactElement } from 'react'
import { COPY } from './copy.js'
import { prepareArt } from './image.js'
import { deleteCard, postDebug, saveCard, uploadArt } from './api.js'
import type { CardMode, CosplayCard } from '../types.js'

/** 表单用的草稿形状（比卡片更适合编辑：标签与示例用文本/数组表示）。 */
export interface CardDraft {
  id: string
  name: string
  title: string
  description: string
  tagsText: string
  mode: CardMode
  persona: string
  rewriteRules: string
  examples: { input: string; output: string }[]
  coverEmoji: string
  art: CosplayCard['art']
}

/** 由卡片生成草稿。 */
export function draftOf(card: CosplayCard | undefined): CardDraft {
  return {
    id: card?.id ?? '',
    name: card?.name ?? '',
    title: card?.title ?? '',
    description: card?.description ?? '',
    tagsText: (card?.tags ?? []).join(' '),
    mode: card?.mode ?? 'system',
    persona: card?.persona ?? '',
    rewriteRules: card?.rewrite?.rules ?? '',
    examples: card?.rewrite?.examples ?? [],
    coverEmoji: card?.cover?.emoji ?? '',
    art: card?.art ?? null,
  }
}

/** 草稿 → 提交给宿主的卡片（宿主会再规范化一遍）。 */
export function cardOf(draft: CardDraft): Partial<CosplayCard> {
  const tags = draft.tagsText
    .split(/[\s,，]+/)
    .map((tag) => tag.trim())
    .filter((tag) => tag !== '')
  const examples = draft.examples.filter((pair) => pair.input.trim() !== '' && pair.output.trim() !== '')
  return {
    ...(draft.id === '' ? {} : { id: draft.id }),
    name: draft.name,
    ...(draft.title.trim() === '' ? {} : { title: draft.title.trim() }),
    ...(draft.description.trim() === '' ? {} : { description: draft.description.trim() }),
    ...(tags.length === 0 ? {} : { tags }),
    mode: draft.mode,
    ...(draft.persona.trim() === '' ? {} : { persona: draft.persona }),
    ...(draft.rewriteRules.trim() === ''
      ? {}
      : {
          rewrite: {
            rules: draft.rewriteRules,
            ...(examples.length === 0 ? {} : { examples }),
          },
        }),
    cover: draft.coverEmoji.trim() === '' ? null : { emoji: draft.coverEmoji.trim() },
    art: draft.art ?? null,
    source: 'custom',
  }
}

/** 编辑器入参。 */
export interface EditorProps {
  initial: CosplayCard | undefined
  artMaxEdge: number
  artQuality: number
  onSaved: (card: CosplayCard) => void
  onCancel: () => void
}

/** 角色卡编辑器。 */
export function CardEditor({ initial, artMaxEdge, artQuality, onSaved, onCancel }: EditorProps): ReactElement {
  const [draft, setDraft] = useState<CardDraft>(() => draftOf(initial))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [issues, setIssues] = useState<string[]>([])
  const fileRef = useRef<HTMLInputElement | null>(null)

  /** 改一个字段。 */
  const set = <K extends keyof CardDraft>(key: K, value: CardDraft[K]): void => setDraft((previous) => ({ ...previous, [key]: value }))

  /** 选立绘 → 压缩 → 上传。 */
  const onPickArt = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (file === undefined) return
    setBusy(true)
    setError('')
    try {
      const prepared = await prepareArt(file, artMaxEdge, artQuality)
      const stored = await uploadArt({ base64: prepared.base64, width: prepared.width, height: prepared.height })
      if (stored === undefined || !stored.ok || stored.art === null) {
        setError(stored?.issues?.[0]?.message ?? '立绘上传失败')
        return
      }
      set('art', stored.art)
      postDebug({
        kind: 'art-uploaded',
        id: stored.art.artId,
        note: `${prepared.width}x${prepared.height} · ${Math.round(prepared.sourceBytes / 1024)}KB → ${Math.round(stored.art.bytes / 1024)}KB · sha=${stored.art.sha256.slice(0, 8)}`,
      })
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setBusy(false)
    }
  }

  /** 保存。 */
  const onSave = async (): Promise<void> => {
    setBusy(true)
    setError('')
    setIssues([])
    try {
      const result = await saveCard(cardOf(draft))
      if (result === undefined) {
        setError('宿主没有响应（插件还在吗？）')
        return
      }
      setIssues(result.issues.map((issue) => `${issue.where}：${issue.message}`))
      if (result.ok && result.card !== null) {
        postDebug({ kind: 'card-saved', id: result.card.id, note: `「${result.card.name}」mode=${result.card.mode}` })
        onSaved(result.card)
        return
      }
      setError('保存被拒绝，看看下面的提示')
    } finally {
      setBusy(false)
    }
  }

  /** 删卡。 */
  const onDelete = async (): Promise<void> => {
    if (draft.id === '') return
    setBusy(true)
    try {
      const result = await deleteCard(draft.id)
      postDebug({ kind: 'card-deleted', id: draft.id, note: result?.ok === true ? 'ok' : 'failed' })
      if (result?.ok === true) onCancel()
      else setError('删除失败（预设卡不能删；自定义卡才行）')
    } finally {
      setBusy(false)
    }
  }

  const isPreset = initial?.source === 'preset'

  return (
    <div className="dsh-cosplay-form">
      <div className="dsh-cosplay-bar">
        <button type="button" className="dsh-cosplay-btn" onClick={onCancel} disabled={busy}>
          ← {COPY.back}
        </button>
        <span className="dsh-cosplay-sub">{draft.id === '' ? '新建自定义角色卡' : `编辑 ${draft.id}`}</span>
        <span className="dsh-cosplay-spacer" />
        {draft.id !== '' && !isPreset ? (
          <button type="button" className="dsh-cosplay-btn danger" onClick={() => void onDelete()} disabled={busy}>
            {COPY.remove}
          </button>
        ) : null}
        <button type="button" className="dsh-cosplay-btn primary" onClick={() => void onSave()} disabled={busy || draft.name.trim() === ''}>
          {busy ? '处理中…' : COPY.save}
        </button>
      </div>

      {error !== '' ? <div className="dsh-cosplay-error">{error}</div> : null}
      {issues.length > 0 ? (
        <div className="dsh-cosplay-issues">
          {issues.map((issue, index) => (
            <span key={`${String(index)}-${issue}`}>· {issue}</span>
          ))}
        </div>
      ) : null}

      <div className="dsh-cosplay-row">
        <label className="dsh-cosplay-field">
          <span className="dsh-cosplay-label">名字（必填，≤24 字）</span>
          <input className="dsh-cosplay-input" value={draft.name} onChange={(event) => set('name', event.target.value)} placeholder="例如：赛博猫娘" />
        </label>
        <label className="dsh-cosplay-field">
          <span className="dsh-cosplay-label">称号 / 副标题</span>
          <input className="dsh-cosplay-input" value={draft.title} onChange={(event) => set('title', event.target.value)} placeholder="例如：猫耳 AI 终端 · 零式" />
        </label>
      </div>

      <label className="dsh-cosplay-field">
        <span className="dsh-cosplay-label">一句话简介（卡片上显示）</span>
        <input className="dsh-cosplay-input" value={draft.description} onChange={(event) => set('description', event.target.value)} placeholder="例如：每句话以「喵~」结尾，技术照样给对" />
      </label>

      <div className="dsh-cosplay-row">
        <label className="dsh-cosplay-field">
          <span className="dsh-cosplay-label">标签（空格分隔，≤8 个）</span>
          <input className="dsh-cosplay-input" value={draft.tagsText} onChange={(event) => set('tagsText', event.target.value)} placeholder="人设 可爱 通用" />
        </label>
        <label className="dsh-cosplay-field">
          <span className="dsh-cosplay-label">占位表情（没有立绘时显示）</span>
          <input className="dsh-cosplay-input" value={draft.coverEmoji} onChange={(event) => set('coverEmoji', event.target.value)} placeholder="🐱" />
        </label>
        <label className="dsh-cosplay-field">
          <span className="dsh-cosplay-label">生效方式</span>
          <select className="dsh-cosplay-select" value={draft.mode} onChange={(event) => set('mode', event.target.value as CardMode)}>
            <option value="system">人设注入（模型以角色身份作答）</option>
            <option value="rewrite">改写输入（模型收到改写后的 prompt）</option>
            <option value="both">两者都要</option>
          </select>
        </label>
      </div>

      <div className="dsh-cosplay-field">
        <span className="dsh-cosplay-label">立绘（可选）</span>
        <div className="dsh-cosplay-bar">
          <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={(event) => void onPickArt(event)} />
          <button type="button" className="dsh-cosplay-btn" onClick={() => fileRef.current?.click()} disabled={busy}>
            {COPY.uploadArt}
          </button>
          {draft.art !== null && draft.art !== undefined ? (
            <>
              <span className="dsh-cosplay-sub">
                {draft.art.mime} · {Math.round(draft.art.bytes / 1024)} KB · {String(draft.art.width ?? '?')}×{String(draft.art.height ?? '?')}
              </span>
              <button type="button" className="dsh-cosplay-btn tiny" onClick={() => set('art', null)} disabled={busy}>
                {COPY.clearArt}
              </button>
            </>
          ) : (
            <span className="dsh-cosplay-hint">没立绘就用占位表情，卡片照样好看</span>
          )}
        </div>
      </div>

      <label className="dsh-cosplay-field">
        <span className="dsh-cosplay-label">人设（注入系统提示的正文；`system` / `both` 用）</span>
        <textarea className="dsh-cosplay-textarea" value={draft.persona} onChange={(event) => set('persona', event.target.value)} placeholder="你是……语气……称呼……禁忌……" />
      </label>

      <label className="dsh-cosplay-field">
        <span className="dsh-cosplay-label">改写规则（改写调用的 system prompt 主体；`rewrite` / `both` 用）</span>
        <textarea className="dsh-cosplay-textarea" value={draft.rewriteRules} onChange={(event) => set('rewriteRules', event.target.value)} placeholder="你是……转换专家。规则 1……规则 2……" />
      </label>

      <div className="dsh-cosplay-field">
        <span className="dsh-cosplay-label">改写示例（few-shot，≤4 组；可选但很有用）</span>
        {draft.examples.map((pair, index) => (
          <div className="dsh-cosplay-row" key={`ex-${String(index)}`}>
            <label className="dsh-cosplay-field">
              <span className="dsh-cosplay-hint">输入 {index + 1}</span>
              <input
                className="dsh-cosplay-input"
                value={pair.input}
                onChange={(event) =>
                  set(
                    'examples',
                    draft.examples.map((item, at) => (at === index ? { ...item, input: event.target.value } : item)),
                  )
                }
              />
            </label>
            <label className="dsh-cosplay-field">
              <span className="dsh-cosplay-hint">输出 {index + 1}</span>
              <input
                className="dsh-cosplay-input"
                value={pair.output}
                onChange={(event) =>
                  set(
                    'examples',
                    draft.examples.map((item, at) => (at === index ? { ...item, output: event.target.value } : item)),
                  )
                }
              />
            </label>
            <button
              type="button"
              className="dsh-cosplay-btn tiny"
              onClick={() => set('examples', draft.examples.filter((_item, at) => at !== index))}
            >
              移除
            </button>
          </div>
        ))}
        <div className="dsh-cosplay-bar">
          <button
            type="button"
            className="dsh-cosplay-btn tiny"
            onClick={() => set('examples', [...draft.examples, { input: '', output: '' }])}
            disabled={draft.examples.length >= 4}
          >
            + 加一组示例
          </button>
        </div>
      </div>
    </div>
  )
}
