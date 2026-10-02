/**
 * dsh-cosplay — 对外契约类型与运行时形状。
 *
 * **纯类型 + 纯常量**，浏览器半边也会 import 它（所以绝不能在这里 import node 内建、
 * schemastery 或任何宿主专用模块）。
 *
 * 角色卡的数据结构是"分享/导入导出"的载体，一旦发布就只能做**兼容性扩展**
 * （加可选字段、升 version + 迁移），不能改语义。
 */

/* ────────────────────────────── 角色卡 ────────────────────────────── */

/** id 白名单：小写字母数字与连字符（进 URL，因此路由天然不存在路径穿越）。 */
export const CARD_ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/

/** 单张角色卡的立绘引用（字节在 `art/` 目录里，按 sha256 去重）。 */
export interface CosplayArt {
  /** 立绘 id：`a-<sha256 前 16 位>`。 */
  artId: string
  /** 图片 MIME（png / jpeg / webp / gif）。 */
  mime: string
  /** 字节数。 */
  bytes: number
  /** 内容摘要（去重与缓存失效都靠它）。 */
  sha256: string
  /** 原始像素宽（客户端读取 naturalWidth 后回报；缺失不影响渲染）。 */
  width?: number
  /** 原始像素高。 */
  height?: number
}

/** 无立绘时的占位封面（emoji + 色相）。 */
export interface CosplayCover {
  emoji?: string
  /** 0..360。 */
  hue?: number
}

/** 改写规则（存在即代表该卡具备"用户提示词改写"能力）。 */
export interface CosplayRewrite {
  /** 改写调用的 system prompt 主体。 */
  rules: string
  /** few-shot 示例（≤4 组）。 */
  examples?: { input: string; output: string }[]
  /** 0..1；缺省用全局 `rewriteTemperature`。 */
  temperature?: number
  /** 输出上限；缺省用全局 `rewriteMaxOutputChars`。 */
  maxOutputChars?: number
}

/** 一张角色卡。 */
export interface CosplayCard {
  id: string
  /** 显示名，≤24 字。 */
  name: string
  /** 称号 / 副标题，≤40 字。 */
  title?: string
  /** 卡片上的一句话简介，≤120 字。 */
  description?: string
  /** 标签，≤8 个。 */
  tags?: string[]
  cover?: CosplayCover | null
  art?: CosplayArt | null
  /** 该卡的默认生效方式：系统提示注入 / 用户提示词改写 / 两者。 */
  mode: CardMode
  /** 系统提示注入正文（人设、语气、称呼、禁忌）。 */
  persona?: string
  /**
   * 尾部回声（可选，≤200 字）：用人设第一人称写的一句话。
   *
   * 它会出现在**系统提示词的最末尾**（`order = DEPLOYMENT_PERSONA_SUFFIX + 1`），
   * 用来在"近因位置"重申角色的声音。首尾各一次只在**一条**关键约束、且**逐字**时才有效，
   * 所以这里刻意只允许很短的一句话；没写就自动取 `persona` 的第一句原话（跳过标题行）。
   */
  tailLine?: string
  /** 改写规则。 */
  rewrite?: CosplayRewrite | null
  /** 来源：预设只读，自定义可编辑。 */
  source: 'preset' | 'custom'
  createdAt: number
  updatedAt: number
  version: 1
}

/** 卡片生效方式。 */
export type CardMode = 'system' | 'rewrite' | 'both'

/** 卡片元数据投影（`/library` 返回这个，不带 persona/rewrite 正文与立绘字节）。 */
export interface CardMeta {
  id: string
  name: string
  title?: string
  description?: string
  tags?: string[]
  cover?: CosplayCover | null
  hasArt: boolean
  /** 立绘 URL（相对同源），带 rev 便于 immutable 缓存失效。 */
  artUrl?: string
  mode: CardMode
  hasPersona: boolean
  hasRewrite: boolean
  source: 'preset' | 'custom'
  updatedAt: number
}

/* ────────────────────────────── 包（分享载体） ────────────────────────────── */

/** 单文件多卡包：`cosplay-*.json`。 */
export interface CosplayPack {
  format: 'dsh-cosplay-pack'
  version: 1
  exportedAt: number
  cards: CosplayCard[]
  /** artId → 内联字节（导出时把 `art/` 文件内联进来，导入时再拆回文件）。 */
  art: Record<string, { mime: string; base64: string; width?: number; height?: number; sha256: string }>
}

/** 导入结果。 */
export interface ImportResult {
  ok: boolean
  added: number
  replaced: number
  skipped: number
  errors: string[]
}

/* ────────────────────────────── 运行时状态 ────────────────────────────── */

/** 一个会话的绑定与开关。 */
export interface SessionBinding {
  /** 显式绑定的卡 id；null = 没有角色。 */
  cardId: string | null
  /** 本会话总开关（`/cosplay off`）。 */
  enabled: boolean
  updatedAt: number
  /**
   * 本会话**用过**的卡（最近在前，≤4 个）。
   *
   * 用途是给一个诚实的提示：中途换卡**不会**让历史里旧口吻的对话消失 ——
   * 那些消息是 append-only 的 durable 记录。想从干净上下文开始角色，就开新会话
   * （新会话会自动继承 `lastCardId`）。
   */
  cardsSeen?: string[]
}

/** 一次改写的记录（诊断用；改写正文本身已经在会话日志里）。 */
export interface RewriteRecord {
  messageId: string
  turn: number
  at: number
  cardId: string
  model: string
  ok: boolean
  ms: number
  inChars: number
  outChars: number
  /** 用户这一轮的**原文**（≤4000 字）。 */
  original?: string
  /** 这次改写带了几条对话上下文。 */
  contextTurns?: number
  /** 上下文一共多少字。 */
  contextChars?: number
  error?: string
  /** 改写结果前 400 字。 */
  preview: string
}

/** `<DSH_HOME>/cosplay/state.json`。 */
export interface CosplayState {
  version: 1
  sessions: Record<string, SessionBinding>
  rewrites: Record<string, RewriteRecord[]>
  global: {
    lastImportAt?: number
    /**
     * 最后一次**成功绑定**的卡 id。
     *
     * 用途：新会话 chip 在没有显式绑定时自动预选它 —— "换会话不换角色"。
     * 优先级：显式绑定 > lastCardId > `defaultCardId`。
     */
    lastCardId?: string
  }
}

/* ────────────────────────────── 诊断 ────────────────────────────── */

/** 环形诊断缓冲里的一条。 */
export interface TraceEntry {
  at: number
  kind: string
  sessionId?: string
  turn?: number
  id?: string
  note: string
}

/** 计数（`/stats` 的状态行）。 */
export interface CosplayStats {
  /** 提示段被求值的次数。 */
  sectionCalls: number
  /** 提示段真正产出正文的次数（≠0 才说明有注入）。 */
  sectionFilled: number
  /** pre-step 钩子被调用的次数。 */
  preStepCalls: number
  /** 其中真正改写了消息的次数。 */
  preStepRewrote: number
  /** 模型改写：调用 / 成功 / 失败 / 缓存命中。 */
  rewrite: { calls: number; ok: number; failed: number; cached: number; lastMs: number; lastModel: string }
  /** durable `user/message` 观测到的条数（M0 证据链）。 */
  durableUserMessages: number
}
