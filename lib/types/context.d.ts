/**
 * dsh-cosplay — 改写调用的**对话上下文**（宿主侧，纯函数）。
 *
 * ## 为什么需要这个文件
 *
 * 改写调用是**无状态**的：它只拿到"这一轮原文"与"卡片规则"。于是
 *
 * > 兄弟 太夯了，看的我硬邦邦！！！ 想让更多人硬邦邦，**把这个**提交到我的仓库吧！！
 *
 * 里的"这个"没有指代对象 —— 而改写调用的上下文里**唯一存在的名词就是卡片规则本身**
 * （"硬邦邦提示词转换专家"），模型于是合理地把它填了进去，任务主体被整条换掉，
 * 主模型随后真的去建了一个错的仓库。这不是模型不行，是我们没给它看懂指代所需的信息。
 *
 * ## 取什么、怎么取
 *
 * 走**官方 surface**（和 `dsh-compaction-basic` 取摘要输入的做法一致）：
 * `agent.session.surface.nodes` → `session.eventAt(seq)`。用 surface 而不是裸日志，
 * 是因为**压缩之后** surface 里是摘要节点，裸日志里的原文可能已被 shadow。
 *
 * 只收两类，其余一律排除：
 *   - `user/message` 且 `data.source.kind === 'user'` —— **人**说的话；
 *   - `assistant/message` 的 **text 块**（丢掉 reasoning）。
 *
 * 必须排除的噪声（实测它们的体积与误导性都很高，本会话里 `skills` 一条就 9718 字）：
 * `runtime-context` / `skills` / `tool-jobs` / `agent-message` / `subagent-settled` /
 * `user-approval` 等 —— 它们是框架注入与子代理播报，不是"人说的话"。
 *
 * ## 组装成什么样
 *
 * 组装成**一条** user 消息，分区明确（`renderRewriteInput`）。为什么不拆成多条：
 * 多条历史会让模型把"上下文"当成"要改写的内容"，甚至改写历史本身。
 */
/** 一条上下文消息（只保留人话与助手话）。 */
export interface ContextTurn {
    role: 'user' | 'assistant';
    text: string;
}
/**
 * 事件的最小结构（只声明我们真正读的字段）。
 *
 * 结构化而非 import `dsh-session` 的类型，是为了让这个模块**不依赖宿主**、
 * 能被 node 直接单测（测试里喂普通对象即可）。
 */
export interface ContextEventLike {
    type: string;
    data?: unknown;
}
/** 取上下文时的参数。 */
export interface CollectOptions {
    /** surface 节点（seq），按时间正序。 */
    nodes: readonly number[];
    /** 取事件（一般是 `session.eventAt`）。 */
    eventAt(seq: number): ContextEventLike | undefined;
    /** 最多带多少条消息（默认 6 条 ≈ 3 轮）。0 或负数 = 不带上下文。 */
    maxTurns: number;
    /** 单条消息的字数上限（默认 800）。 */
    maxCharsPerMessage?: number;
    /** 全部上下文的字数上限（默认 2400）。 */
    maxCharsTotal?: number;
    /** 排除这条消息（按 id；防止把"本轮要改写的原文"当成历史）。 */
    excludeMessageId?: string;
}
/** 默认上限（与 README 的配置表一致）。 */
export declare const CONTEXT_DEFAULTS: {
    readonly maxCharsPerMessage: 800;
    readonly maxCharsTotal: 2400;
};
/** 从事件里取文本（只认 text 块，丢掉 reasoning / tool 调用）。 */
export declare function textOfEvent(event: ContextEventLike): string;
/** 事件的来源 kind（`user/message` 与 `assistant/message` 都在 data.source 上）。 */
export declare function sourceKindOf(event: ContextEventLike): string;
/**
 * 超长消息的裁剪：**保头也保尾**，中间打省略标记。
 *
 * 两头都留是有理由的：助手消息通常**开头**点名交付物（"## 东西在哪 - 页面本体：miku/index.html"），
 * 结尾常有结论；只留一头会丢掉指代消解最需要的那一侧。
 */
export declare function trimMessage(text: string, max: number): string;
/**
 * 收集最近对话（时间正序返回）。
 *
 * 从末尾往前取满 `maxTurns` 条，并在超出 `maxCharsTotal` 时**丢掉更早的**（保留最近的）。
 * 至少会带上最靠近当前的那一条（哪怕它自己就超了总预算，也会被单条上限裁过）。
 */
export declare function collectRewriteContext(options: CollectOptions): ContextTurn[];
/**
 * 指代词检测（守卫用）。
 *
 * 只匹配**真的需要前文**才能解析的说法；`它` 用后视断言排除"其他/其它"，
 * 避免把大量正常句子误判成"有指代"。
 */
export declare function hasUnresolvedReference(text: string): boolean;
/** 分区标记（测试与文档都引用它，别改成别的写法）。 */
export declare const CONTEXT_HEADER = "\u3010\u6700\u8FD1\u5BF9\u8BDD\uFF08\u53EA\u7528\u6765\u5224\u65AD\"\u8FD9\u4E2A/\u5B83/\u4E0A\u4E00\u8F6E\"\u6307\u4EC0\u4E48\uFF1B\u4E0D\u8981\u6539\u5199\u8FD9\u91CC\uFF0C\u4E5F\u4E0D\u8981\u628A\u5B83\u6284\u8FDB\u7ED3\u679C\uFF09\u3011";
export declare const CONTEXT_EMPTY = "\u3010\u6700\u8FD1\u5BF9\u8BDD\u3011\u6682\u65E0\u53EF\u7528\u4E0A\u4E0B\u6587\uFF08\u9047\u5230\u65E0\u6CD5\u89E3\u6790\u7684\u6307\u4EE3\u5C31\u539F\u6837\u4FDD\u7559\uFF0C\u4E0D\u8981\u81EA\u5DF1\u53D1\u660E\u5BF9\u8C61\uFF09";
export declare const DEMAND_HEADER = "\u3010\u672C\u8F6E\u8981\u6539\u5199\u7684\u539F\u59CB\u9700\u6C42\uFF08\u53EA\u6539\u8FD9\u4E00\u6BB5\uFF09\u3011";
/**
 * 把上下文与本轮原文组装成**一条** user 消息。
 * @param original - 用户这一轮的原文（逐字放在最后一段，不得改动）。
 * @param context - `collectRewriteContext` 的结果（空数组 = 没有上下文）。
 * @param cwd - 当前工作目录（可选；"提交到仓库"这类任务需要知道是哪个工作区）。
 */
export declare function renderRewriteInput(original: string, context: readonly ContextTurn[], cwd?: string): string;
