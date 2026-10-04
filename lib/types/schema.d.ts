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
import Schema from '@deepseek-ai/schemastery';
import type { Volatile } from '@deepseek-ai/cordis';
import { type CosplayConfig } from './config.js';
/** 插件 Config（= 设置表单）。 */
export declare const Config: Schema<Schemastery.ObjectS<NoInfer<{
    enabled: Schema<boolean, boolean, "volatile-defined">;
    strategy: Schema<"system" | "rewrite" | "card", "system" | "rewrite" | "card", "volatile-defined">;
    defaultCardId: Schema<string, string, "volatile-defined">;
    injectIntoUnboundSessions: Schema<boolean, boolean, "volatile-defined">;
    rewriteProvider: Schema<string, string, "volatile-defined">;
    rewriteModel: Schema<string, string, "volatile-defined">;
    rewriteTemperature: Schema<number, number, "volatile-defined">;
    rewriteTimeoutMs: Schema<number, number, "volatile-defined">;
    rewriteMaxInputChars: Schema<number, number, "volatile-defined">;
    rewriteMaxOutputChars: Schema<number, number, "volatile-defined">;
    rewriteOnFailure: Schema<"original" | "block", "original" | "block", "volatile-defined">;
    rewriteContextTurns: Schema<number, number, "volatile-defined">;
    rewriteContextMaxChars: Schema<number, number, "volatile-defined">;
    rewriteGuardUnresolved: Schema<boolean, boolean, "volatile-defined">;
    anchorSeat: Schema<"system" | "context", "system" | "context", "volatile-defined">;
    personaEcho: Schema<boolean, boolean, "volatile-defined">;
    ignoreSubagents: Schema<boolean, boolean, "volatile-defined">;
    inheritFromParent: Schema<boolean, boolean, "volatile-defined">;
    personaMaxChars: Schema<number, number, "volatile-defined">;
    showTab: Schema<boolean, boolean, "volatile-defined">;
    coverAspect: Schema<number, number, "volatile-defined">;
    storagePath: Schema<string, string, "volatile-defined">;
    artMaxEdge: Schema<number, number, "volatile-defined">;
    artQuality: Schema<number, number, "volatile-defined">;
    traceSize: Schema<number, number, "volatile-defined">;
}>>, Schemastery.ObjectT<NoInfer<{
    enabled: Schema<boolean, boolean, "volatile-defined">;
    strategy: Schema<"system" | "rewrite" | "card", "system" | "rewrite" | "card", "volatile-defined">;
    defaultCardId: Schema<string, string, "volatile-defined">;
    injectIntoUnboundSessions: Schema<boolean, boolean, "volatile-defined">;
    rewriteProvider: Schema<string, string, "volatile-defined">;
    rewriteModel: Schema<string, string, "volatile-defined">;
    rewriteTemperature: Schema<number, number, "volatile-defined">;
    rewriteTimeoutMs: Schema<number, number, "volatile-defined">;
    rewriteMaxInputChars: Schema<number, number, "volatile-defined">;
    rewriteMaxOutputChars: Schema<number, number, "volatile-defined">;
    rewriteOnFailure: Schema<"original" | "block", "original" | "block", "volatile-defined">;
    rewriteContextTurns: Schema<number, number, "volatile-defined">;
    rewriteContextMaxChars: Schema<number, number, "volatile-defined">;
    rewriteGuardUnresolved: Schema<boolean, boolean, "volatile-defined">;
    anchorSeat: Schema<"system" | "context", "system" | "context", "volatile-defined">;
    personaEcho: Schema<boolean, boolean, "volatile-defined">;
    ignoreSubagents: Schema<boolean, boolean, "volatile-defined">;
    inheritFromParent: Schema<boolean, boolean, "volatile-defined">;
    personaMaxChars: Schema<number, number, "volatile-defined">;
    showTab: Schema<boolean, boolean, "volatile-defined">;
    coverAspect: Schema<number, number, "volatile-defined">;
    storagePath: Schema<string, string, "volatile-defined">;
    artMaxEdge: Schema<number, number, "volatile-defined">;
    artQuality: Schema<number, number, "volatile-defined">;
    traceSize: Schema<number, number, "volatile-defined">;
}>>, "plain">;
/**
 * 解析后的配置形状：**每个字段都是活引用**，读值要 `.get()`。
 *
 * volatile 字段在 `Schema.resolve` 里被 `createVolatile()` 包成 `Volatile<T>`，
 * 而 loader 的 `_commitVolatile` 会把新值提交进**同一个引用** —— 插件不重挂就能看到新值。
 */
export type LiveConfig = {
    readonly [K in keyof CosplayConfig]: Volatile<CosplayConfig[K]>;
};
/**
 * 把活配置解成一份普通值快照（每次现读并补默认值）。
 *
 * 这样下游（路由 / 提示段 / 钩子 / 命令）完全不必知道自己拿到的是不是 `Volatile`。
 */
export declare function resolveLive(live: LiveConfig | undefined): CosplayConfig;
