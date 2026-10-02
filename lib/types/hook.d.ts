/**
 * dsh-cosplay — `agent/pre-step` 拦截（host）：**改写卡**的那条链路。
 *
 * ## 为什么是这个事件
 *
 * 官方事件契约（`dsh-agent/lib/types/runtime-types.d.ts`）：
 * > Reject a proposed step or replace the messages that enter it.
 * > Calling `next()` preserves the current messages.
 *
 * 它是**唯一**能在模型看到之前替换用户消息的官方通道；而且被替换后的消息会被
 * `dsh-agent-loop` 真实地 durable 写进会话日志：
 *
 * ```js
 * // dsh-agent-loop/lib/index.js:1061
 * if (firstAttempt) for (const message of decision.messages) this.session.append("user/message", message, { surfaceOp: "append" })
 * ```
 *
 * 也就是说：**「对话」里那条用户消息本身就是改写后的 prompt**，模型收到的与日志逐字一致。
 * 这是"改写型角色卡"的全部立足点（M0 探针已在真实浏览器+真实模型上验证过这条链）。
 *
 * ## 五条纪律（每一条都有代价换来的理由）
 *
 * 1. **先 `await next()`**：默认决策里带着 `runtimeContext.project()` 产出的动态上下文
 *    消息（见同一文件 :910-918）。自己造 `{kind:'enter', messages:[...]}` 会把它丢掉，
 *    模型就看不到沙箱/审批策略那一段。
 * 2. **只改 `role==='user'` 且 `source.kind==='user'`**：会话日志里同样是 user 角色的消息
 *    还有 system-reminder / skills 清单 / runtime-context 等一大票，动它们等于篡改框架注入；
 *    而历史里的 assistant/tool 消息是模型自己的产物。`source.kind==='user'` 是 M0 实测值
 *    （`host:pre-step-message role=user source.kind=user`）。
 * 3. **按 message.id 幂等**：同一个消息被再次提出（重试/补步）时复用上一次结果，
 *    绝不重复调用模型、也不重复计费。
 * 4. **绝不抛**：钩子里抛错会打断整轮对话。任何异常都退回原样决策并留一条诊断。
 * 5. **失败按配置回落**：默认 `original`（用原文继续，用户只是没拿到风格改写），
 *    可配成 `block`（拒绝这一步）——那条路会打断本轮，所以默认关着。
 */
import type { Context } from '@deepseek-ai/cordis';
import type { ContentBlock, UserMessage } from '@deepseek-ai/dsh-llm/types';
import type { CosplayConfig } from './config.js';
import type { ProbeRuntime } from './route.js';
import type { Library } from './library.js';
import type { StateStore } from './state.js';
import type { RewriteResult } from './rewrite.js';
import type { CosplayCard, CosplayStats, TraceEntry } from './types.js';
/** 把一条消息里的文本块拼起来。 */
export declare function textOfMessage(message: {
    content?: readonly ContentBlock[];
} | undefined): string;
/**
 * 用新文本替换一条用户消息里的文本块，**保留**图片/文件等非文本块。
 *
 * 文本放在最前（改写 prompt 是任务本体），附件块保持原顺序跟在后面。
 */
export declare function replaceUserText(message: UserMessage, text: string): UserMessage;
/** 一条消息的来源种类。 */
export declare function sourceKindOf(message: UserMessage): string;
/** 改写判定结果。 */
export type RewriteOutcome = {
    kind: 'text';
    text: string;
} | {
    kind: 'keep';
} | {
    kind: 'block';
    error: string;
};
/** pre-step 装配依赖。 */
export interface PreStepDeps {
    trace: {
        push(entry: Omit<TraceEntry, 'at'> & {
            at?: number;
        }): void;
    };
    stats: CosplayStats;
    config: () => CosplayConfig;
    library: () => Library;
    state: () => StateStore;
    /** M0 探针（保留为自检工具：武装 + 消息带标记时才动手）。 */
    probe: ProbeRuntime;
    /** 真正调用模型的地方（`input` 是组装好的"上下文 + 原文"）。 */
    rewrite: (request: {
        card: CosplayCard;
        input: string;
        sessionId: string;
        signal: AbortSignal;
    }) => Promise<RewriteResult>;
}
/**
 * 装上 pre-step 钩子。
 * @returns disposer（`ctx.on` 返回的那个，插件卸载自动摘掉）。
 */
export declare function installPreStepHook(ctx: Context, deps: PreStepDeps): () => void;
