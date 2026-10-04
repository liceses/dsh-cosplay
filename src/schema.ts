/**
 * dsh-cosplay — 插件 Config（schemastery，**host only**）。
 *
 * 这个文件 import 了 schemastery，所以**浏览器半边绝不能 import 它**（会把 schemastery
 * 打进浏览器）。纯常量在 `config.ts`，类型在 `types.ts`，client 只用那两个。
 *
 * ## 0.1.7 起这个 schema 就是设置表单本身
 *
 * `SettingsForms` 从插件导出的 **`Config`** 投影表单，键是 **profile 条目 id**
 * （本包 = `cosplay`）。所以导出名必须是 `Config`，且每个要出现在表单里的字段都要
 * `.volatile()`（`volatileForm()` 只挑 volatile 字段）。
 *
 * ## `.volatile()` 的两条硬规则（照 schemastery 源码核对过）
 *
 * - `Schema.prototype.extra()` **返回副本**，必须收集返回值 —— 一律写成链式
 *   `.default(...).description(...).volatile()`。写成 `const f = Schema.number(); f.volatile()`
 *   会把标记丢掉。
 * - volatile 字段必须落在固定对象路径、不能嵌套在另一个 volatile 里（数组元素 / inner /
 *   映射键会抛 `volatile fields require a fixed object path`）。
 */

import Schema from '@deepseek-ai/schemastery'
import type { Volatile } from '@deepseek-ai/cordis'
import { DEFAULT_CONFIG, type CosplayConfig } from './config.js'

/** 插件 Config（= 设置表单）。 */
export const Config = Schema.object({
  enabled: Schema.boolean().default(DEFAULT_CONFIG.enabled).description('总开关：关掉后既不注入人设也不改写输入').volatile(),
  strategy: Schema.union([Schema.const('card' as const), Schema.const('system' as const), Schema.const('rewrite' as const)])
    .default(DEFAULT_CONFIG.strategy)
    .description('生效方式：card = 按角色卡自己的设置（默认）；system = 只注入系统提示；rewrite = 只改写用户输入')
    .volatile(),
  defaultCardId: Schema.string()
    .default(DEFAULT_CONFIG.defaultCardId)
    .description('新会话默认角色卡 id（留空 = 不自动上角色）')
    .volatile(),
  injectIntoUnboundSessions: Schema.boolean()
    .default(DEFAULT_CONFIG.injectIntoUnboundSessions)
    .description('是否给从没在界面里打开过的会话也套用默认卡（默认关：避免影响 subagent 会话）')
    .volatile(),
  rewriteProvider: Schema.string()
    .default(DEFAULT_CONFIG.rewriteProvider)
    .description('改写用的 provider 路由（留空 = 用当前默认模型）')
    .volatile(),
  rewriteModel: Schema.string()
    .default(DEFAULT_CONFIG.rewriteModel)
    .description('改写用的模型 id（留空 = 用当前默认模型）')
    .volatile(),
  rewriteTemperature: Schema.number()
    .default(DEFAULT_CONFIG.rewriteTemperature)
    .description('改写温度（0..1，默认 0.4）')
    .volatile(),
  rewriteTimeoutMs: Schema.number()
    .default(DEFAULT_CONFIG.rewriteTimeoutMs)
    .description('单次改写超时（ms，默认 20000）；超时按失败处理')
    .volatile(),
  rewriteMaxInputChars: Schema.number()
    .default(DEFAULT_CONFIG.rewriteMaxInputChars)
    .description('送进改写的用户输入上限（字符，默认 6000）')
    .volatile(),
  rewriteMaxOutputChars: Schema.number()
    .default(DEFAULT_CONFIG.rewriteMaxOutputChars)
    .description('改写输出上限（字符，默认 4000）')
    .volatile(),
  rewriteOnFailure: Schema.union([Schema.const('original' as const), Schema.const('block' as const)])
    .default(DEFAULT_CONFIG.rewriteOnFailure)
    .description('改写失败时：original = 用原文继续（默认）；block = 拒绝这一步（会打断本轮，慎用）')
    .volatile(),
  rewriteContextTurns: Schema.number()
    .default(DEFAULT_CONFIG.rewriteContextTurns)
    .description('改写时带多少条最近对话作为上下文（默认 6 条 ≈ 3 轮；0 = 不带，退回旧行为）')
    .volatile(),
  rewriteContextMaxChars: Schema.number()
    .default(DEFAULT_CONFIG.rewriteContextMaxChars)
    .description('带进改写的上下文总字数上限（默认 2400；单条另有 800 字上限）')
    .volatile(),
  rewriteGuardUnresolved: Schema.boolean()
    .default(DEFAULT_CONFIG.rewriteGuardUnresolved)
    .description('原文含"这个/它/上一轮"这类指代、但拿不到上下文时，跳过改写并原样放行（默认开）')
    .volatile(),
  anchorSeat: Schema.union([Schema.const('system' as const), Schema.const('context' as const)])
    .default(DEFAULT_CONFIG.anchorSeat)
    .description('锚点座位：system = 系统提示词末尾（默认）；context = 运行时上下文（落在对话历史之后，真正的近因位，但静态锚点会随历史沉底）')
    .volatile(),
  thinkingFlavor: Schema.union([
    Schema.const('off' as const),
    Schema.const('immersive' as const),
    Schema.const('analysis' as const),
  ])
    .default(DEFAULT_CONFIG.thinkingFlavor)
    .description('角色风味思维链：把思考链风格标记追加到本会话首条用户消息末尾（仅第 1 轮 + 有角色时生效）。immersive = 第一人称内心戏；analysis = 禁止内心戏。默认关（会改动你的原话）')
    .volatile(),
  personaEcho: Schema.boolean()
    .default(DEFAULT_CONFIG.personaEcho)
    .description('在系统提示词最末尾再放一句角色原话（"尾部回声"）。默认开：本项目对照实验里它让人设标记密度 0.91→1.16/百字、独立评审 10→17 分，代价约 +40 字/请求')
    .volatile(),
  ignoreSubagents: Schema.boolean()
    .default(DEFAULT_CONFIG.ignoreSubagents)
    .description('子代理会话一律不注入、不改写（默认开）。子代理的任务提示词也算"用户消息"，不隔离的话会被单卡改写成另一种风格')
    .volatile(),
  inheritFromParent: Schema.boolean()
    .default(DEFAULT_CONFIG.inheritFromParent)
    .description('子代理是否继承父会话绑定的角色卡（默认关；只沿父链看一层，且需先关掉 ignoreSubagents）')
    .volatile(),
  personaMaxChars: Schema.number()
    .default(DEFAULT_CONFIG.personaMaxChars)
    .description('系统提示注入正文的长度上限（字符，默认 8000）')
    .volatile(),
  showTab: Schema.boolean()
    .default(DEFAULT_CONFIG.showTab)
    .description('是否在「对话 / 轨迹」旁显示「角色」页签')
    .volatile(),
  coverAspect: Schema.number().default(DEFAULT_CONFIG.coverAspect).description('角色卡封面宽高比（1 = 近方形）').volatile(),
  storagePath: Schema.string()
    .default(DEFAULT_CONFIG.storagePath)
    .description('角色卡库目录（留空 = <DSH_HOME>/cosplay）')
    .volatile(),
  artMaxEdge: Schema.number().default(DEFAULT_CONFIG.artMaxEdge).description('立绘上传前压到的最长边（px，默认 1024）').volatile(),
  artQuality: Schema.number().default(DEFAULT_CONFIG.artQuality).description('立绘压缩质量（0.1..1，默认 0.85）').volatile(),
  traceSize: Schema.number().default(DEFAULT_CONFIG.traceSize).description('诊断环形缓冲容量（默认 200）').volatile(),
})

/**
 * 解析后的配置形状：**每个字段都是活引用**，读值要 `.get()`。
 *
 * volatile 字段在 `Schema.resolve` 里被 `createVolatile()` 包成 `Volatile<T>`，
 * 而 loader 的 `_commitVolatile` 会把新值提交进**同一个引用** —— 插件不重挂就能看到新值。
 */
export type LiveConfig = {
  readonly [K in keyof CosplayConfig]: Volatile<CosplayConfig[K]>
}

/**
 * 把活配置解成一份普通值快照（每次现读并补默认值）。
 *
 * 这样下游（路由 / 提示段 / 钩子 / 命令）完全不必知道自己拿到的是不是 `Volatile`。
 */
export function resolveLive(live: LiveConfig | undefined): CosplayConfig {
  const record = (live ?? {}) as unknown as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(DEFAULT_CONFIG)) {
    const field = record[key]
    out[key] =
      field !== null && typeof field === 'object' && typeof (field as { get?: unknown }).get === 'function'
        ? (field as { get(): unknown }).get()
        : field
  }
  return resolveConfigLocal(out)
}

/** 本地补默认值（避免从 config.ts 再引一次 resolveConfig 造成循环 import 的错觉）。 */
function resolveConfigLocal(raw: unknown): CosplayConfig {
  const value = (raw ?? {}) as Partial<CosplayConfig>
  const out = { ...DEFAULT_CONFIG }
  for (const key of Object.keys(DEFAULT_CONFIG) as Array<keyof CosplayConfig>) {
    const next = value[key]
    if (next !== undefined && next !== null) (out as Record<string, unknown>)[key] = next
  }
  return out
}
