/**
 * dsh-cosplay — 浏览器半边的样式。
 *
 * ## 为什么手写 CSS 而不引官方 primitives
 *
 * `@deepseek-ai/dsh-client-ui-primitives` 在基线模块表里、可以用（它的 Button/Input/Tag
 * 都是现成的）。这里仍然手写，理由只有一个：**角色卡网格的几何与 DSH 原版是同一套
 * 主题变量**（`--dsw-alias-*`），而卡片尺寸/圆角/描边/悬停要按立绘比例精确控制，
 * 套一层组件反而要跟它的内联样式打架。所有颜色一律走主题变量，明暗主题自动跟随。
 *
 * 变量名照 `cordis_inspect` 的 Theme.listTokens 实测清单（14 个）：
 *   bg-base / bg-layer-1 / bg-layer-2 / bg-overlay / border-l1 / border-l2
 *   brand-primary / label-primary / label-secondary / state-{error,idle,success,warn}-primary
 *   specific-sidebar-fill
 */

/** 插件样式表。 */
export const CSS = `
.dsh-cosplay-view {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 16px 20px 28px;
  color: var(--dsw-alias-label-primary, inherit);
}
.dsh-cosplay-head { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
.dsh-cosplay-title { font-size: 14px; font-weight: 600; letter-spacing: 0.01em; }
.dsh-cosplay-sub { font-size: 12px; color: var(--dsw-alias-label-secondary, #667085); }
.dsh-cosplay-spacer { flex: 1; }

.dsh-cosplay-bar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.dsh-cosplay-card-panel {
  border: 1px solid var(--dsw-alias-border-l1, #e4e7ec);
  background: var(--dsw-alias-bg-layer-1, transparent);
  border-radius: 12px;
  padding: 12px 14px;
}
.dsh-cosplay-card-title {
  font-size: 12px; font-weight: 600; color: var(--dsw-alias-label-secondary, #667085);
  margin-bottom: 8px; letter-spacing: 0.02em;
}

/* ── 按钮 ─────────────────────────────────────────────────────────── */
.dsh-cosplay-btn {
  appearance: none; border: 1px solid var(--dsw-alias-border-l1, #e4e7ec);
  background: var(--dsw-alias-bg-layer-2, rgba(127,127,127,0.06));
  color: var(--dsw-alias-label-primary, inherit);
  border-radius: 8px; padding: 6px 12px; font-size: 12px; line-height: 1.4;
  cursor: pointer; transition: border-color 120ms ease, background 120ms ease, opacity 120ms ease;
  white-space: nowrap;
}
.dsh-cosplay-btn:hover:not(:disabled) { border-color: var(--dsw-alias-brand-primary, #4d6bfe); }
.dsh-cosplay-btn:disabled { opacity: 0.45; cursor: not-allowed; }
.dsh-cosplay-btn.primary {
  background: var(--dsw-alias-brand-primary, #4d6bfe); border-color: var(--dsw-alias-brand-primary, #4d6bfe);
  color: #fff; font-weight: 600;
}
.dsh-cosplay-btn.danger:hover:not(:disabled) { border-color: var(--dsw-alias-state-error-primary, #d92d20); color: var(--dsw-alias-state-error-primary, #d92d20); }
.dsh-cosplay-btn.tiny { padding: 3px 8px; font-size: 11px; border-radius: 6px; }

/* ── 卡片网格 ─────────────────────────────────────────────────────── */
.dsh-cosplay-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 12px; }
.dsh-cosplay-tile {
  position: relative; display: flex; flex-direction: column;
  border-radius: 12px; border: 1px solid var(--dsw-alias-border-l1, #e4e7ec);
  background: var(--dsw-alias-bg-layer-2, rgba(127,127,127,0.05));
  overflow: hidden; cursor: pointer; padding: 0; text-align: left;
  transition: border-color 120ms ease, transform 120ms ease, box-shadow 120ms ease;
  color: inherit;
}
.dsh-cosplay-tile:hover { border-color: var(--dsw-alias-brand-primary, #4d6bfe); transform: translateY(-1px); }
.dsh-cosplay-tile.active {
  border-color: var(--dsw-alias-brand-primary, #4d6bfe);
  box-shadow: 0 0 0 1px var(--dsw-alias-brand-primary, #4d6bfe) inset;
}
.dsh-cosplay-tile-art { position: relative; width: 100%; aspect-ratio: 1 / 1; overflow: hidden; display: flex; align-items: center; justify-content: center; }
.dsh-cosplay-tile-art img { width: 100%; height: 100%; object-fit: cover; display: block; }
.dsh-cosplay-tile-fallback { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; font-size: 34px; }
.dsh-cosplay-tile-meta { padding: 8px 10px 10px; display: flex; flex-direction: column; gap: 2px; }
.dsh-cosplay-tile-name { font-size: 13px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsh-cosplay-tile-desc { font-size: 11px; color: var(--dsw-alias-label-secondary, #667085); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsh-cosplay-badges { position: absolute; top: 6px; left: 6px; right: 6px; display: flex; gap: 4px; align-items: flex-start; flex-wrap: wrap; pointer-events: none; }
.dsh-cosplay-badge {
  font-size: 10px; line-height: 1; padding: 3px 6px; border-radius: 999px;
  background: var(--dsw-alias-bg-overlay, rgba(0,0,0,0.55)); color: var(--dsw-alias-label-primary, #fff);
  border: 1px solid var(--dsw-alias-border-l2, rgba(255,255,255,0.25));
}
.dsh-cosplay-badge.brand { background: var(--dsw-alias-brand-primary, #4d6bfe); border-color: transparent; color: #fff; font-weight: 600; }

/* ── 二级详情 ─────────────────────────────────────────────────────── */
.dsh-cosplay-detail { display: grid; grid-template-columns: minmax(180px, 260px) 1fr; gap: 18px; align-items: start; }
.dsh-cosplay-detail-art {
  width: 100%; aspect-ratio: 1 / 1; border-radius: 12px; overflow: hidden;
  border: 1px solid var(--dsw-alias-border-l1, #e4e7ec); background: var(--dsw-alias-bg-layer-2, rgba(127,127,127,0.06));
  display: flex; align-items: center; justify-content: center; cursor: zoom-in;
}
.dsh-cosplay-detail-art img { width: 100%; height: 100%; object-fit: cover; display: block; }
.dsh-cosplay-detail-body { display: flex; flex-direction: column; gap: 10px; min-width: 0; }
.dsh-cosplay-h2 { font-size: 16px; font-weight: 600; }
.dsh-cosplay-desc { font-size: 12px; color: var(--dsw-alias-label-secondary, #667085); }
.dsh-cosplay-tags { display: flex; gap: 6px; flex-wrap: wrap; }
.dsh-cosplay-tag {
  font-size: 11px; padding: 2px 8px; border-radius: 999px;
  border: 1px solid var(--dsw-alias-border-l1, #e4e7ec); color: var(--dsw-alias-label-secondary, #667085);
}
.dsh-cosplay-pre {
  font-family: var(--dsh-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
  font-size: 11px; line-height: 1.6; white-space: pre-wrap; word-break: break-word;
  background: var(--dsw-alias-bg-layer-2, rgba(127,127,127,0.06));
  border: 1px solid var(--dsw-alias-border-l1, #e4e7ec); border-radius: 8px;
  padding: 10px 12px; max-height: 220px; overflow: auto; margin: 0;
}

/* ── 表单 ─────────────────────────────────────────────────────────── */
.dsh-cosplay-form { display: flex; flex-direction: column; gap: 12px; }
.dsh-cosplay-field { display: flex; flex-direction: column; gap: 4px; }
.dsh-cosplay-label { font-size: 12px; color: var(--dsw-alias-label-secondary, #667085); }
.dsh-cosplay-hint { font-size: 11px; color: var(--dsw-alias-label-secondary, #667085); }
.dsh-cosplay-input, .dsh-cosplay-textarea, .dsh-cosplay-select {
  width: 100%; box-sizing: border-box;
  background: var(--dsw-alias-bg-base, transparent); color: var(--dsw-alias-label-primary, inherit);
  border: 1px solid var(--dsw-alias-border-l1, #e4e7ec); border-radius: 8px;
  padding: 7px 10px; font-size: 13px; font-family: inherit;
}
.dsh-cosplay-textarea { min-height: 120px; resize: vertical; line-height: 1.6; font-family: var(--dsh-font-mono, ui-monospace, Menlo, monospace); font-size: 12px; }
.dsh-cosplay-row { display: flex; gap: 10px; flex-wrap: wrap; }
.dsh-cosplay-row > .dsh-cosplay-field { flex: 1; min-width: 140px; }

/* ── 原文 ↔ 改写后 对照 ─────────────────────────────────────────── */
.dsh-cosplay-compare {
  display: grid; grid-template-columns: 1fr 1fr; gap: 8px;
  margin-top: 6px; align-items: start;
}
.dsh-cosplay-compare > div { min-width: 0; }
.dsh-cosplay-compare .dsh-cosplay-pre { max-height: 220px; overflow: auto; margin-top: 2px; }
@media (max-width: 720px) { .dsh-cosplay-compare { grid-template-columns: 1fr; } }

/* ── 诊断 ─────────────────────────────────────────────────────────── */
.dsh-cosplay-kv { display: grid; grid-template-columns: max-content 1fr; gap: 4px 12px; font-size: 12px; }
.dsh-cosplay-kv dt { color: var(--dsw-alias-label-secondary, #667085); }
.dsh-cosplay-kv dd { margin: 0; font-variant-numeric: tabular-nums; min-width: 0; word-break: break-all; }
.dsh-cosplay-trace {
  max-height: 240px; overflow: auto; font-size: 11px; line-height: 1.7;
  font-family: var(--dsh-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
  white-space: pre-wrap; word-break: break-word;
}
.dsh-cosplay-trace-kind { color: var(--dsw-alias-brand-primary, #4d6bfe); }
.dsh-cosplay-note { font-size: 12px; color: var(--dsw-alias-label-secondary, #667085); line-height: 1.6; }
.dsh-cosplay-error { font-size: 12px; color: var(--dsw-alias-state-error-primary, #d92d20); }
.dsh-cosplay-ok { font-size: 12px; color: var(--dsw-alias-state-success-primary, #12b76a); }
.dsh-cosplay-issues { font-size: 11px; color: var(--dsw-alias-state-warn-primary, #dc6803); display: flex; flex-direction: column; gap: 2px; }

/* ── 输入框工具行里的角色 chip + 浮层 ─────────────────────────────── */
.dsh-cosplay-chip {
  display: inline-flex; align-items: center; gap: 5px;
  height: 24px; padding: 0 8px; border-radius: 999px;
  border: 1px solid var(--dsw-alias-border-l1, #e4e7ec);
  background: var(--dsw-alias-bg-layer-2, rgba(127,127,127,0.06));
  color: var(--dsw-alias-label-primary, inherit);
  font-size: 12px; line-height: 1; cursor: pointer; white-space: nowrap;
  transition: border-color 120ms ease, opacity 120ms ease;
}
.dsh-cosplay-chip:hover { border-color: var(--dsw-alias-brand-primary, #4d6bfe); }
.dsh-cosplay-chip.empty { color: var(--dsw-alias-label-secondary, #667085); }
.dsh-cosplay-chip.off { opacity: 0.55; }
.dsh-cosplay-chip-emoji { font-size: 12px; line-height: 1; }
.dsh-cosplay-chip-name { max-width: 96px; overflow: hidden; text-overflow: ellipsis; }
.dsh-cosplay-chip-mode {
  font-size: 10px; padding: 1px 5px; border-radius: 999px;
  background: var(--dsw-alias-brand-primary, #4d6bfe); color: #fff; font-weight: 600;
}
.dsh-cosplay-avatar { border-radius: 6px; object-fit: cover; display: inline-block; flex: none; }
.dsh-cosplay-avatar.fallback {
  display: inline-flex; align-items: center; justify-content: center;
  font-size: 11px; border-radius: 6px; flex: none;
}
.dsh-cosplay-pop {
  position: fixed; z-index: 1000; width: 300px;
  display: flex; flex-direction: column;
  background: var(--dsw-alias-bg-overlay, var(--dsw-alias-bg-layer-1, #fff));
  border: 1px solid var(--dsw-alias-border-l1, #e4e7ec);
  border-radius: 12px; box-shadow: 0 12px 32px rgba(0,0,0,0.18);
  overflow: hidden;
}
.dsh-cosplay-pop-head {
  display: flex; align-items: baseline; gap: 6px;
  padding: 8px 10px; font-size: 12px; font-weight: 600;
  color: var(--dsw-alias-label-secondary, #667085);
  border-bottom: 1px solid var(--dsw-alias-border-l1, #e4e7ec);
}
.dsh-cosplay-pop-list { overflow: auto; max-height: 260px; padding: 4px; }
.dsh-cosplay-pop-item {
  display: flex; align-items: center; gap: 8px; width: 100%;
  padding: 5px 6px; border-radius: 8px; border: 1px solid transparent;
  background: transparent; color: inherit; font-size: 12px; text-align: left; cursor: pointer;
}
.dsh-cosplay-pop-item:hover { background: var(--dsw-alias-bg-layer-2, rgba(127,127,127,0.08)); }
.dsh-cosplay-pop-item.active { border-color: var(--dsw-alias-brand-primary, #4d6bfe); }
.dsh-cosplay-pop-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsh-cosplay-pop-tag {
  margin-left: 6px; font-size: 10px; padding: 1px 5px; border-radius: 999px;
  border: 1px solid var(--dsw-alias-border-l1, #e4e7ec); color: var(--dsw-alias-label-secondary, #667085);
}
.dsh-cosplay-pop-mode { font-size: 10px; color: var(--dsw-alias-label-secondary, #667085); flex: none; }
.dsh-cosplay-pop-foot {
  display: flex; align-items: center; gap: 6px;
  padding: 8px 10px; border-top: 1px solid var(--dsw-alias-border-l1, #e4e7ec);
}
`
