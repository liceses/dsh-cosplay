/**
 * dsh-cosplay — 默认配置（**纯常量**，浏览器半边要读它）。
 *
 * 这个文件刻意不 import schemastery：schema 在 `schema.ts`（host only），
 * 形状与默认值在这里，两边共用一份常量，避免"面板显示的值"与"代码里的默认值"漂移。
 */

import type { CardMode } from './types.js'

/** 配置形状。 */
export interface CosplayConfig {
  /** 总开关：关掉后既不注入也不改写。 */
  enabled: boolean
  /**
   * 生效方式策略：
   * - `card`（默认）：按每张卡的 `mode` 决定；
   * - `system` / `rewrite`：全局强制覆盖（实验与逃生阀用）。
   */
  strategy: 'card' | 'system' | 'rewrite'
  /** 新会话默认角色卡 id；留空 = 不自动上角色。 */
  defaultCardId: string
  /** 是否给"从没在 UI 里打开过"的会话也套用默认卡（默认关：避免污染 subagent 会话）。 */
  injectIntoUnboundSessions: boolean
  /** 改写用的 provider；留空 = 用当前默认模型。 */
  rewriteProvider: string
  /** 改写用的 model；留空 = 用当前默认模型。 */
  rewriteModel: string
  /** 改写温度。 */
  rewriteTemperature: number
  /** 单次改写超时（ms）。 */
  rewriteTimeoutMs: number
  /** 送进改写的用户输入上限（字符）。 */
  rewriteMaxInputChars: number
  /** 改写输出上限（字符）。 */
  rewriteMaxOutputChars: number
  /** 改写失败时的行为：original = 用原文继续（默认）；block = 拒绝这一步。 */
  rewriteOnFailure: 'original' | 'block'
  /**
   * 改写时带多少条最近对话（人话 + 助手话）作为上下文。
   *
   * 为什么需要：改写调用本身是**无状态**的。没有上下文时，"把这个提交到仓库"里的
   * "这个"没有指代对象，模型会抓住它上下文里唯一存在的名词（也就是卡片自己的规则），
   * 于是把**任务主体**换掉。0 = 关闭（退回旧行为）。
   */
  rewriteContextTurns: number
  /** 带进改写的上下文总字数上限（单条另有 800 字上限）。 */
  rewriteContextMaxChars: number
  /**
   * 原文含指代词（这个/它/上一轮…）但拿不到上下文时，**跳过改写**、原样放行。
   *
   * 保守优先于"编一个"：无法解析指代时改写必然瞎猜主体，保留原文至少不会把任务改错。
   */
  rewriteGuardUnresolved: boolean
  /**
   * 锚点（尾部回声）放在哪个座位：
   * - `system`（默认）：系统提示词**末尾**的独立段（`order=10201`）。
   *   注意：整个请求是 `system → 历史 → 本轮消息`，所以它仍然属于**最前面**；
   * - `context`：注册成**运行时上下文**，以 user 角色落在**对话历史之后**（真正的近因位）。
   *   代价：快照只在内容变化时重新物化，所以静态锚点会随历史增长沉到中间。
   *
   * 见 `docs/backlog.md` 的 B1 与判定的 spike 规则。
   */
  anchorSeat: 'system' | 'context'
  /**
   * **角色风味思维链**：把 E4 的思考链风格标记逐字追加到**本会话首条用户消息末尾**
   * （E4 说那是训练时的注入位；放 system 里效果次之）。
   *
   * - `off`（默认）：一个字节都不加；
   * - `immersive`：让思考变成第一人称内心戏（实测：思考语言 0% → 63% 中文、英文分析腔 3/3 → 0/4）；
   * - `analysis`：反过来，禁止括号独白与第一人称。
   *
   * 只在这三件事同时成立时才生效：**第 1 轮** + **本会话真的有角色人设**（system 链路生效）
   * + 开关不是 `off`。代价是**改动了你的原话**（durable、对话里可见），所以默认关。
   * 详见 `docs/backlog.md` 的 B4（含实测数据与"没复现括号独白"的结论）。
   */
  thinkingFlavor: 'off' | 'immersive' | 'analysis'
  /**
   * 是否在系统提示词**最末尾**再放一句角色的原话（"尾部回声"）。
   *
   * 默认**开**，依据是本项目自己的对照实验（`scripts/experiment-persona.mjs`，
   * 同模型同卡同探针，只差这一行；3 轮 × 两组）：
   *   - 人设标记（猫娘=「喵」）密度：开 1.16/百字 vs 关 0.91/百字；
   *   - 独立评审（不知分组）按固定 rubric 打分：开 17 / 关 10，差异主要在
   *     "角色认知边界的处理"与"元话语"；
   *   - 代价约 +40 字/请求；实测回声落在全部官方段之后（真末尾）。
   * 文献提示推理模型对首尾复述的收益**更小**（我们的默认模型就是 high reasoning），
   * 所以这里的结论只当作"无害 + 略有帮助"，样本不大；不想要就把这个开关关掉。
   */
  personaEcho: boolean
  /**
   * 子代理会话（`session.header.origin === 'subagent'`）一律不注入、不改写。
   *
   * 默认**开**，理由不只是"别污染"：实测子代理的**首条任务提示词 `source.kind === 'user'`**，
   * 所以一旦 `injectIntoUnboundSessions` 打开且默认卡是改写卡，父代理精心写的任务说明
   * 会被改写成另一种风格再交给子代理 —— 这是个真实的脚枪，用这条焊死。
   */
  ignoreSubagents: boolean
  /**
   * 子代理是否继承**父会话**绑定的角色卡（默认关）。
   *
   * 只在 `ignoreSubagents=false` 时有意义（否则子代理整条链路不参与）。
   * 只沿父链看**一层**：父会话 id 在会话头里，父会话的绑定在我们自己的 `state.json` 里，
   * 所以不需要再去加载父会话对象。
   */
  inheritFromParent: boolean
  /** 系统注入正文的长度上限（字符），保护上下文。 */
  personaMaxChars: number
  /** 是否在「对话 / 轨迹」旁显示「角色」页签。 */
  showTab: boolean
  /** 角色卡封面宽高比（1 = 近方形）。 */
  coverAspect: number
  /** 卡片库目录；留空 = `<DSH_HOME>/cosplay`。 */
  storagePath: string
  /** 立绘上传前压到的最长边（px）。 */
  artMaxEdge: number
  /** 立绘压缩质量（0.1..1）。 */
  artQuality: number
  /** 诊断环形缓冲容量。 */
  traceSize: number
}

/** 默认配置。 */
export const DEFAULT_CONFIG: CosplayConfig = {
  enabled: true,
  strategy: 'card',
  defaultCardId: '',
  injectIntoUnboundSessions: false,
  rewriteProvider: '',
  rewriteModel: '',
  rewriteTemperature: 0.4,
  rewriteTimeoutMs: 20000,
  rewriteMaxInputChars: 6000,
  rewriteMaxOutputChars: 4000,
  rewriteOnFailure: 'original',
  rewriteContextTurns: 6,
  rewriteContextMaxChars: 2400,
  rewriteGuardUnresolved: true,
  personaEcho: true,
  anchorSeat: 'system',
  thinkingFlavor: 'off',
  ignoreSubagents: true,
  inheritFromParent: false,
  personaMaxChars: 8000,
  showTab: true,
  coverAspect: 1,
  storagePath: '',
  artMaxEdge: 1024,
  artQuality: 0.85,
  traceSize: 200,
}

/** 默认卡片的生效方式（预置卡与新建卡共用）。 */
export const DEFAULT_CARD_MODE: CardMode = 'system'

/** 把面板读到的原始值补成完整配置。 */
export function resolveConfig(raw: unknown): CosplayConfig {
  const value = (raw ?? {}) as Partial<CosplayConfig>
  const out = { ...DEFAULT_CONFIG }
  for (const key of Object.keys(DEFAULT_CONFIG) as Array<keyof CosplayConfig>) {
    const next = value[key]
    if (next !== undefined && next !== null) (out as Record<string, unknown>)[key] = next
  }
  return out
}
