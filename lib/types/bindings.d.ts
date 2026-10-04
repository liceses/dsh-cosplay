/**
 * dsh-cosplay — 「本会话到底用哪张卡」的唯一判定（**纯函数，host 与浏览器半边共用**）。
 *
 * 这段判定以前散在三处（宿主提示段、宿主 pre-step 钩子、浏览器页签），
 * 于是"页签显示的角色"和"实际生效的角色"有漂移的风险。现在只有这一份。
 *
 * ## 判定顺序（`resolveCardId`）
 *
 * | 顺序 | 条件 | 结果 |
 * | --- | --- | --- |
 * | 1 | 子代理会话 + `ignoreSubagents` | 空（**零注入零改写**：子代理在干工程活，别给它套角色，也别改写它的任务说明） |
 * | 2 | 本会话被显式关掉（`enabled === false`） | 空 |
 * | 3 | 显式绑定了某张卡 | 那张卡（**绑定是人的决定，优先级最高**） |
 * | 4 | 子代理 + `inheritFromParent` + 父会话绑了卡 | 父会话那张卡 |
 * | 5 | 没绑定 + `injectIntoUnbound` + 配了默认卡 | 默认卡 |
 * | 6 | 其余 | 空 |
 *
 * ## 为什么"子代理"要单独处理（实测，不是推测）
 *
 * 子代理是**独立会话**（`session.header.origin === 'subagent'`，官方声明字段），
 * 本插件默认对它完全隔离。但 `injectIntoUnboundSessions=true` 时它会出事：
 * 实测子代理的**首条任务提示词 `source.kind === 'user'`** —— 于是父代理精心写的任务说明
 * 会被默认的改写卡改写成另一种风格。`ignoreSubagents`（默认开）就是把这条焊死。
 *
 * 注意"没绑定"的语义：客户端会在**会话视图挂载时**把生效值写成本会话的显式绑定
 * （见 `client/binding.ts`），所以默认卡只对"你在界面里打开过的会话"生效。
 */
import type { SessionBinding } from './types.js';
/** 判定输入。 */
export interface EffectiveCardInput {
    binding: SessionBinding | undefined;
    /** 新会话默认角色卡 id（空 = 不自动上角色）。 */
    defaultCardId: string;
    /** 是否给"从没在界面里打开过"的会话也套默认卡。 */
    injectIntoUnbound: boolean;
}
/** 完整判定输入（含子代理相关的两条）。 */
export interface ResolveCardInput extends EffectiveCardInput {
    /** 父会话的绑定（只有 `inheritFromParent` + 子代理时才会被看）。 */
    parentBinding?: SessionBinding | undefined;
    /** 本会话是不是子代理会话（`session.header.origin === 'subagent'`）。 */
    isSubagent: boolean;
    /** 子代理一律不注入、不改写（默认开）。 */
    ignoreSubagents: boolean;
    /** 子代理是否继承父会话的角色卡（默认关）。 */
    inheritFromParent: boolean;
}
/** 会话头里我们关心的那两项（官方 `SessionHeader` 的声明字段）。 */
export interface SessionMeta {
    /** 是不是子代理会话（`header.origin === 'subagent'`）。 */
    isSubagent: boolean;
    /** 父会话 id（`header.parentSession`）；没有就是空串。 */
    parentSessionId: string;
}
/**
 * 读会话的身份信息（防御式：读不到就当"顶层会话、没有父会话"）。
 *
 * 两种形状都认：运行时是 `session.header.*`，持久化事件的 header 字段也在顶层。
 * 依据是 `dsh-session` 的 `SessionHeader`：`origin?: 'subagent'`、`parentSession?: SessionId`
 * 都是**官方声明字段**（不是我们猜的运行时私货）。
 */
export declare function sessionMetaOf(session: unknown): SessionMeta;
/**
 * 解析本会话实际生效的角色卡 id（完整规则，见文件头的判定顺序表）。
 * @returns 卡 id，或空串（= 没有角色）。
 */
export declare function resolveCardId(input: ResolveCardInput): string;
/**
 * 旧签名的兼容层：只做"绑定 → 默认卡"这两条（不含子代理规则）。
 *
 * 保留它是因为浏览器半边与既有单测都用这个形状；新代码请用 `resolveCardId`。
 */
export declare function effectiveCardId(input: EffectiveCardInput): string;
