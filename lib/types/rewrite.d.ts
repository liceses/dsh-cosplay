/**
 * dsh-cosplay — 模型改写（host only）。
 *
 * 一次改写 = 一次**辅助模型调用**，用的就是你在界面上选的那个模型的默认选择
 * （`ctx.agentDefaultModel.currentSelection()`；也可以被插件配置里的
 * `rewriteProvider` / `rewriteModel` 覆盖）。范本是官方一手实现
 * `dsh-session-title-llm`：`ctx.llm.stream({provider, model, system, messages, maxTokens, signal})`，
 * 逐块收 `text-delta`，用 `finish.reason.kind` 判成败。
 *
 * ## 五条硬约束（每一条都对应一个线上会出现的事故）
 *
 * 1. **绝不拖住会话**：超时（默认 20s）与调用方 signal 合并；超时/报错一律按"这次改写不可用"
 *    返回，由调用方回落原文。
 * 2. **绝不重复计费**：同一条消息（`messageId`）在 `hook.ts` 里只改写一次；
 *    这里再加一层 `(卡, 组装后输入)` 的内容缓存，重试/回退路径不会重复花钱。
 * 3. **结果必须清洗**：改写正文会被逐字当成用户消息写进日志，所以代码块围栏、
 *    外层引号、三连空行都在这里剥掉。
 * 4. **不猜 provider**：拿不到 provider/model 就如实失败并说明原因，不去猜一个"看起来能用"的。
 * 5. **不写日志**：辅助调用不进会话历史（`purpose` 也刻意不设，避免被适配器按别的用途处理）。
 */
import type { Context } from '@deepseek-ai/cordis';
import type { CosplayConfig } from './config.js';
import type { Trace } from './trace.js';
import type { CosplayCard, CosplayStats } from './types.js';
/** 一次流式块（只声明我们读到的字段）。 */
type ChunkLike = {
    type: 'text-delta';
    index?: number;
    text: string;
} | {
    type: 'block-end';
    block?: {
        type?: string;
        text?: string;
    };
} | {
    type: 'finish';
    reason?: {
        kind?: string;
        failure?: {
            message?: string;
        };
    };
} | {
    type: string;
};
/** 改写请求。 */
export interface RewriteRequest {
    card: CosplayCard;
    /**
     * 送进改写调用的用户消息正文。
     *
     * 注意这里**不是**用户原文，而是 `renderRewriteInput()` 的产物：
     * 「最近对话（只读）」分区 + 「本轮原始需求」分区。改写调用是无状态的，
     * 不给上下文时"这个/它"没有指代对象，模型会抓住它上下文里唯一存在的名词
     * （也就是卡片规则本身）当任务主体 —— 那正是把"提交 miku 页面"改写成
     * "提交硬邦邦转换器"的原因。
     */
    input: string;
    sessionId: string;
    /** 调用方（那一轮）的取消信号。 */
    signal: AbortSignal;
}
/** 改写结果。 */
export interface RewriteResult {
    ok: boolean;
    /** 成功时的改写正文。 */
    text: string;
    /** 实际用的模型（`provider/model`）。 */
    model: string;
    /** 耗时（ms）。 */
    ms: number;
    /** 失败原因（成功时为空）。 */
    error: string;
    /** 是否来自内容缓存（没花钱）。 */
    cached: boolean;
}
/** 改写器依赖。 */
export interface RewriterDeps {
    ctx: Context;
    config: () => CosplayConfig;
    trace: Trace;
    stats: CosplayStats;
    /** 时钟（测试注入）。 */
    now?: () => number;
}
/** 把调用方 signal 与超时合并（Node 20.3+ 有 `AbortSignal.any`，没有就手工接）。 */
export declare function withTimeout(signal: AbortSignal, timeoutMs: number): {
    signal: AbortSignal;
    dispose: () => void;
};
/** 从块流里收正文 + 判成败。 */
export declare function collectStream(chunks: AsyncIterable<ChunkLike>): Promise<{
    text: string;
    error: string;
}>;
/** 建一个改写器。 */
export declare function createRewriter(deps: RewriterDeps): (request: RewriteRequest) => Promise<RewriteResult>;
export {};
