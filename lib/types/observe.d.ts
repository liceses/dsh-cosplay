/**
 * dsh-cosplay — durable 事件观测（host，诊断用）。
 *
 * 存在的唯一理由：**证明改写真的落地了**。
 *
 * `agent/pre-step` 的替换结果会被 `dsh-agent-loop` 写成 durable 的 `user/message`
 * 事件（见 `hook.ts` 文件头的源码引用）。这条观测把那个事件抓成一条诊断回执，
 * 于是"模型到底收到了什么"和"会话日志里到底存了什么"是同一份证据 —— 不需要读文件、
 * 也不需要在浏览器里翻。
 *
 * ## 隐私边界（很重要）
 *
 * `session/event` 是**全进程**的（每个会话的每条事件都会经过这里，包括你正在用的这个
 * 会话）。所以这里有一条硬闸：**只记录"本轮探针真正改写过"的会话**
 * （`probe.touched`）。其余会话一条都不记，正文更不会进缓冲。
 */
import type { Context } from '@deepseek-ai/cordis';
import type { ProbeRuntime } from './route.js';
import type { CosplayStats, TraceEntry } from './types.js';
/** 观测依赖。 */
export interface ObserveDeps {
    trace: {
        push(entry: Omit<TraceEntry, 'at'> & {
            at?: number;
        }): void;
    };
    stats: CosplayStats;
    probe: ProbeRuntime;
}
/**
 * 装上 durable 观测。
 * @returns disposer（挂 fiber 上，停用即撤）。
 */
export declare function installDurableObserver(ctx: Context, deps: ObserveDeps): () => void;
