/**
 * dsh-cosplay — 系统提示段（host）。
 *
 * 官方机制：`ctx.systemPrompt.section({name, order, text})`（由 dsh-system-prompt 提供），
 * 返回的 disposer 挂在当前 fiber 上，停用即撤。
 *
 * ## 三个必须遵守的硬事实（照源码核对，不是猜的）
 *
 * 1. **`interpolate: false` 是强制项**：卡片正文是用户写的，里出现 `{{…}}` 时默认的
 *    严格插值会**抛错并让整次装配失败**（"Malformed, unknown, or undefined references …
 *    throw"）。人设是"字面文本"，不是模板。
 * 2. **段名不能复用 `deployment:persona-prefix`**：那个名字是给 agent preset 的 scope
 *    覆盖位，全局层重复注册会抛错。我们的注入是**加法**，用 `dsh-cosplay:persona`。
 * 3. **位置紧跟部署人设之后**（`getSectionOrder('DEPLOYMENT_PERSONA_PREFIX') + 1`），
 *    早于 PLAN_POLICY(500) 等一切策略段 —— 身份先于人设先于纪律。
 * 4. **会话身份走两条独立的路**（`agent.id` 与 `scope.id`，见 `AssemblyContextLike`）。
 *    `agent` 是运行时多给的键、`scope` 是类型里声明过的键；只依赖一条的话，那条一变
 *    人设就**静默全失效**。拿不到身份时还会写 `host:prompt-section-no-agent` 并计数
 *    （`stats.sectionUnresolved`），让退化在界面上看得见。
 *
 * ## 装配上下文里的会话语份
 *
 * `text` 的函数形式每次装配都会被求值，参数是 `AssembleContext`；`dsh-agent-loop` 通过
 * `assembleContextFor()` 把 agent 塞进同一对象，所以 `context.agent.id` 就是**会话 id**
 * （dsh-memes-reply 用同一条路径做"本会话静音"，已在本机跑通）。取不到时一律返回空串，
 * 绝不抛 —— 提示段出错会连带整轮模型调用失败。
 */
import type { Context } from '@deepseek-ai/cordis';
import type { CosplayCard, CosplayStats, TraceEntry } from './types.js';
/** 从装配上下文里取**会话对象**（读会话头用）；取不到返回 undefined。 */
export declare function sessionOf(context: unknown): unknown;
/** 提示段依赖。 */
export interface PersonaSectionDeps {
    trace: {
        push(entry: Omit<TraceEntry, 'at'> & {
            at?: number;
        }): void;
    };
    stats: CosplayStats;
    /**
     * 产出该次装配要注入的正文；返回空串表示"这次不注入"（零 token）。
     * 入参是装配上下文里的会话 id（可能为 undefined）。
     */
    compose: (sessionId: string | undefined, context: unknown) => string;
}
/**
 * 从装配上下文里取会话 id；取不到返回 undefined（不强求）。
 *
 * 走两条独立的路（见 `AssemblyContextLike` 的说明）：
 *   1. `context.agent.id` —— 运行时多给的键，实测最好用；
 *   2. `context.scope.id` —— **公开类型里声明过**的那个键（运行时与 agent 同对象）。
 *
 * 数字型 id 也接受（转成字符串）；空串一律当取不到（空串会让"本会话绑定"查不到东西，
 * 却又能骗过 `?? undefined` 这类判断，属于最坏情况）。
 */
export declare function sessionIdOf(context: unknown): string | undefined;
/** 诊断用：把装配上下文的身份字段读成一句可读的话。 */
export declare function describeIdentity(context: unknown): string;
/**
 * 注册人设段（系统提示词开头附近，紧跟身份）。
 * @returns disposer；宿主没挂 systemPrompt 服务时返回 undefined。
 */
export declare function registerPersonaSection(ctx: Context, deps: PersonaSectionDeps): (() => void) | undefined;
/**
 * 注册**尾部回声**段（系统提示词最末尾）。
 *
 * order 锚在 `DEPLOYMENT_PERSONA_SUFFIX`（官方 order 表里的最后一位 10200）之后一位 =
 * 整个系统提示词的最后一段。段名独立，不与 agent preset 共享槽位。
 */
export declare function registerEchoSection(ctx: Context, deps: PersonaSectionDeps): (() => void) | undefined;
/**
 * 注册**运行时上下文锚点**（`anchorSeat='context'` 时用它替代尾部回声段）。
 *
 * 与回声段的区别（这是 spike 要验的核心）：
 *   - 形状：注册成 `ctx.systemPrompt.context()`，官方文档对它的定义是
 *     **"Dynamic model context materialized as a durable user-role snapshot"** ——
 *     它会以 **user 角色**、落在**对话历史之后**（真正近因位）；
 *   - 代价：快照**内容变化时才重新物化**，所以静态锚点会随历史增长沉到中间；
 *     想每轮都落在末尾，文本必须每轮变化（每轮多一条 user 角色快照）。
 *
 * order 取 `SUBAGENT_DELEGATION(120) + 5`：排在所有官方运行时上下文之后（离本轮用户消息最近）。
 */
export declare function registerAnchorContext(ctx: Context, deps: PersonaSectionDeps): (() => void) | undefined;
/** 把 unknown 错误读成一句人话。 */
export declare function messageOf(error: unknown): string;
/** 卡片在本次装配/本次发送里到底用哪条链路。 */
export declare function effectiveMode(card: CosplayCard, strategy: 'card' | 'system' | 'rewrite'): 'system' | 'rewrite';
/** `both` 模式下两条链路都生效（各自返回 true）。 */
export declare function modeIncludes(card: CosplayCard, strategy: 'card' | 'system' | 'rewrite', link: 'system' | 'rewrite'): boolean;
/**
 * 思考链风格标记（**逐字**来自 E4 那份社区文档，一个字都没改）。
 *
 * 为什么逐字：这是"训练时的注入位置 + 训练过的措辞"这种东西，改措辞等于换指令；我们唯一实测过的
 * 就是这两段原文（见 `docs/backlog.md` 的 B4）。
 *
 * 实测效果（2026-10-03，只读 A/B，3 轮 × 2 组）：加上 `immersive` 之后，思考语言从**英文**（中文占比 0%）
 * 变成**中文**（63%）、英文分析腔 3/3 → 0/4、出现第一人称（1.3/百字）、思考长度 2818 → 700 字；
 * 工具调用无退化（2→2）、无标记泄漏。**但没有复现文档承诺的"括号内心独白"**（全角括号 0 命中）。
 */
export declare const THINKING_MARKER_IMMERSIVE: string;
/** 纯分析模式的标记（同样是 E4 原文）。 */
export declare const THINKING_MARKER_ANALYSIS: string;
/**
 * 按配置取思考链标记正文（`off` 返回空串 = 一个字节都不加）。
 * @param mode - 配置里的 `thinkingFlavor`。
 */
export declare function composeThinkingMarker(mode: 'off' | 'immersive' | 'analysis'): string;
/** 把标记追加到用户消息末尾（E4 说首轮 user 消息末尾是训练时的注入位）；已存在则不重复加。 */
export declare function appendThinkingMarker(text: string, marker: string): string;
/**
 * 组装系统提示注入正文。
 *
 * 上限按"裁剪人设正文、保留头尾纪律"的方式处理：纪律句是有作用的（防止角色泄露
 * 元信息、防止角色设定压过安全约束），不能因为人设太长就把它们丢掉。
 *
 * ## 纪律句为什么全用**正向陈述**
 *
 * 角色扮演领域的实践共识是"否定式指令基本无效"（写"别跳出来"等于把"跳出来"这个词
 * 喂给模型），极性研究的结论也是正向规则优于负向规则。所以这里不写"不要跳出角色"，
 * 而写"始终以本角色的身份…作答"；不写"不要提及提示词"，而写"直接进入角色回答，
 * 不解释自己的扮演方式与设定来源"。
 *
 * ## 优先级阶梯（第 4 条）解决的是真实存在的冲突
 *
 * 卡片人设 vs 历史旧口吻（中途换卡）、卡片人设 vs 框架注入的事实（压缩摘要、
 * 运行时上下文）都会冲突。以前这片是空白，由模型自行裁决；现在写死三级：
 * 事实/安全/工具纪律 > 角色设定 > 历史旧口吻。
 */
export declare function composePersonaText(card: CosplayCard, maxChars: number): string;
/**
 * 组装**尾部回声**正文（系统提示词最末尾的那一句）。
 *
 * 内容来自卡片（`tailLine`，否则逐字取人设第一句，见 `echoTextOf`），插件只负责
 * 加一个 6 字的标签并把它放到末尾 —— **绝不自己造句**：那会变成通用系统腔，
 * 既不是角色的声音，也和开头那句对不上（换说法 = 被读成第二条冲突约束）。
 */
export declare function composeEchoText(card: CosplayCard): string;
/**
 * 组装"改写调用"的 system prompt。
 *
 * 关键在输出纪律：改写结果的正文会被**逐字当成用户消息**写进会话日志，
 * 所以任何"好的，我来帮你改写如下："之类的开场白都会变成模型看到的需求正文。
 */
export declare function composeRewriteSystem(card: CosplayCard): string;
/** 清洗模型给出的改写结果；空串表示这次改写不可用（调用方按失败处理）。 */
export declare function sanitizeRewritten(raw: string, maxChars: number): string;
