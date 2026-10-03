/**
 * dsh-cosplay — 设置页（`settings.section`）。
 *
 * 与「角色」页签的分工：页签是**用**角色的地方（网格/详情/绑定），设置页是**管**库的地方
 * ——存储路径与占用、预设与自定义的数量、无引用立绘的清理、以及一张实时诊断表
 * （提示段/改写/durable 消息的计数 + 最近轨迹）。技术参数（模型、超时、上限）走
 * 插件自己的 Config 表单（侧栏「插件 → 已安装 → dsh-cosplay」），这里不重复画一遍。
 */

import { useCallback, useEffect, useState, useSyncExternalStore, type ReactElement } from 'react'
import { SETTINGS_LABEL } from './copy.js'
import { fetchDiagnostics, fetchLibrary, postDebug, pruneArt, type DiagnosticsResponse, type LibraryResponse } from './api.js'
import { DEFAULT_CONFIG, type CosplayConfig } from '../config.js'
import type { SettingsScope } from '../settings-source.js'

/** 时间戳 → 本地时分秒。 */
function clockOf(at: number): string {
  const date = new Date(at)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

/** 人类可读的体积。 */
function mb(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/** 设置页入参。 */
export interface SettingsProps {
  /** 设置来源（延迟绑定句柄；没挂上时读到的 value 是 undefined）。 */
  scope: SettingsScope<CosplayConfig>
}

/** 设置页。 */
export function CosplaySettings({ scope }: SettingsProps): ReactElement {
  const [data, setData] = useState<DiagnosticsResponse | undefined>(undefined)
  const [library, setLibrary] = useState<LibraryResponse | undefined>(undefined)
  const [note, setNote] = useState('')
  const [error, setError] = useState('')

  // 设置快照：走官方设置通道（没挂上时回落默认值）。
  const snapshot = useSyncExternalStore(
    (listener) => scope.subscribe(listener),
    () => scope.getSnapshot(),
    () => scope.getSnapshot(),
  )
  const config = { ...DEFAULT_CONFIG, ...(snapshot.value ?? {}) }

  const refresh = useCallback(async (): Promise<void> => {
    const [next, nextLibrary] = await Promise.all([fetchDiagnostics(), fetchLibrary()])
    setData(next)
    setLibrary(nextLibrary)
    setError(next === undefined ? '读不到 /api/dsh-cosplay/diagnostics —— 宿主半边没装上或没重挂' : '')
  }, [])

  useEffect(() => {
    void refresh()
    const timer = setInterval(() => void refresh(), 5000)
    return () => clearInterval(timer)
  }, [refresh])

  const info = data?.info
  const stats = data?.stats
  const cards = library?.cards ?? []

  return (
    <div className="dsh-cosplay-view">
      <div className="dsh-cosplay-head">
        <span className="dsh-cosplay-title">{SETTINGS_LABEL}</span>
        <span className="dsh-cosplay-sub">卡片库管理 + 实时诊断（技术参数在「插件 → dsh-cosplay」的表单里）</span>
      </div>

      {error !== '' ? <div className="dsh-cosplay-error">{error}</div> : null}
      {note !== '' ? <div className="dsh-cosplay-ok">{note}</div> : null}

      <div className="dsh-cosplay-card-panel">
        <div className="dsh-cosplay-card-title">卡片库</div>
        <dl className="dsh-cosplay-kv">
          <dt>目录</dt>
          <dd>{info?.root ?? '—'}</dd>
          <dt>卡片</dt>
          <dd>
            {info === undefined ? '—' : `${String(info.cards)} 张（预设 ${String(info.presets)} · 自定义 ${String(info.customs)}）`}
          </dd>
          <dt>立绘</dt>
          <dd>{info === undefined ? '—' : `${String(info.artFiles)} 张 · 库总体积 ${mb(info.bytes)}`}</dd>
          <dt>无引用立绘</dt>
          <dd>
            {data === undefined ? '—' : `${String(data.orphans)} 张`}
            {data !== undefined && data.orphans > 0 ? (
              <button
                type="button"
                className="dsh-cosplay-btn tiny"
                style={{ marginLeft: 8 }}
                onClick={() => {
                  void (async () => {
                    const result = await pruneArt()
                    setNote(result?.ok === true ? `已清理 ${String(result.removed)} 张无引用立绘` : '清理失败')
                    postDebug({ kind: 'art-prune', note: `removed=${String(result?.removed ?? '?')}` })
                    await refresh()
                  })()
                }}
              >
                清理
              </button>
            ) : null}
          </dd>
        </dl>
      </div>

      <div className="dsh-cosplay-card-panel">
        <div className="dsh-cosplay-card-title">默认角色（新会话）</div>
        <div className="dsh-cosplay-bar">
          <select
            className="dsh-cosplay-select"
            style={{ maxWidth: 320 }}
            value={config.defaultCardId}
            disabled={!snapshot.writable}
            onChange={(event) => {
              const next = event.target.value
              void (async () => {
                const accepted = await scope.set('defaultCardId', next)
                postDebug({
                  kind: 'setting-default-card',
                  ...(next === '' ? {} : { id: next }),
                  note: accepted ? `默认卡 → ${next === '' ? '（空）' : next}` : '写入被拒（设置不可写？）',
                })
                setNote(accepted ? `默认角色已设为 ${next === '' ? '（空）' : next}` : '写入被拒：这个部署的设置文档不接受写入')
              })()
            }}
          >
            <option value="">（不自动上角色）</option>
            {cards.map((meta) => (
              <option key={meta.id} value={meta.id}>
                {meta.cover?.emoji ?? '🎭'} {meta.name}
                {meta.source === 'custom' ? '（自定义）' : ''}
              </option>
            ))}
          </select>
          <span className="dsh-cosplay-hint">
            你在界面里打开过的会话会自动用这张卡（第一轮就生效）；没有默认卡时，新会话是「无角色」，可以用输入框左边的 chip 现选。
          </span>
        </div>
        <div className="dsh-cosplay-note" style={{ marginTop: 6 }}>
          这条写的是插件配置里的 <code>defaultCardId</code>
          {snapshot.status !== 'ready' ? `（当前设置状态：${snapshot.status}）` : ''}。
          想让"从没在界面里打开过的会话"（含 subagent）也套用，需要另外打开插件配置里的 `injectIntoUnboundSessions`。
        </div>
      </div>

      <div className="dsh-cosplay-card-panel">
        <div className="dsh-cosplay-card-title">链路计数（宿主实时读数）</div>
        <dl className="dsh-cosplay-kv">
          <dt>人设注入</dt>
          <dd>
            提示段求值 {stats?.sectionCalls ?? '—'} 次 · 产出正文 {stats?.sectionFilled ?? '—'} 次
          </dd>
          <dt>身份探针</dt>
          <dd className={(stats?.sectionUnresolved ?? 0) + (stats?.preStepUnresolved ?? 0) > 0 ? 'dsh-cosplay-error' : undefined}>
            取不到会话身份：提示段 {stats?.sectionUnresolved ?? '—'} 次 · pre-step {stats?.preStepUnresolved ?? '—'} 次
            {(stats?.sectionUnresolved ?? 0) + (stats?.preStepUnresolved ?? 0) > 0
              ? '（应恒为 0；>0 说明 DSH 改了装配上下文/载荷形状，角色会静默失效）'
              : '（应恒为 0）'}
          </dd>
          <dt>改写链路</dt>
          <dd>
            pre-step 调用 {stats?.preStepCalls ?? '—'} 次 · 改写 {stats?.preStepRewrote ?? '—'} 次 · durable 用户消息{' '}
            {stats?.durableUserMessages ?? '—'} 条
          </dd>
          <dt>模型改写</dt>
          <dd>
            调用 {stats?.rewrite.calls ?? '—'} · 成功 {stats?.rewrite.ok ?? '—'} · 失败 {stats?.rewrite.failed ?? '—'} · 缓存{' '}
            {stats?.rewrite.cached ?? '—'} · 最近 {stats?.rewrite.lastMs ?? 0}ms {stats?.rewrite.lastModel ?? ''}
          </dd>
        </dl>
      </div>

      <div className="dsh-cosplay-card-panel">
        <div className="dsh-cosplay-card-title">最近诊断（最新在前 · 每 5 秒刷新）</div>
        <div className="dsh-cosplay-trace">
          {(data?.trace ?? []).map((entry, index) => (
            <div key={`${String(entry.at)}-${String(index)}`}>
              <span className="dsh-cosplay-trace-kind">{entry.kind}</span> {clockOf(entry.at)}{' '}
              {entry.sessionId === undefined ? '' : `[${entry.sessionId.slice(-8)}] `}
              {entry.note}
            </div>
          ))}
          {(data?.trace.length ?? 0) === 0 ? <span className="dsh-cosplay-note">（暂无回执）</span> : null}
        </div>
      </div>

      <div className="dsh-cosplay-note">
        常用命令：<code>/cosplay</code> 状态 · <code>/cosplay list</code> 清单 · <code>/cosplay off</code> 本会话关闭 ·{' '}
        <code>/cosplay &lt;名字&gt;</code> 换卡。界面出问题时命令是你的逃生阀。
      </div>
    </div>
  )
}
