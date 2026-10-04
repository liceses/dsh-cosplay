/**
 * dsh-cosplay — 路由与协议常量（host 与浏览器半边共用同一份字符串）。
 *
 * 目的只有一个：不让"两边各自写死一个路径"漂移。这个文件必须是**纯模块**
 * （只允许常量与纯函数）—— 浏览器半边会 import 它。
 */
/** 本插件占用的路由前缀（webServer 前缀路由）。 */
export const ROUTE_PREFIX = '/api/dsh-cosplay';
/** 诊断端点（状态行 / 计数）。 */
export const STATS_PATH = `${ROUTE_PREFIX}/stats`;
/** 环形诊断缓冲（客户端回执 + 宿主事件，一次读全）。 */
export const TRACE_PATH = `${ROUTE_PREFIX}/trace`;
/** 客户端回执入口（浏览器看不到控制台，这是唯一可观测通道）。 */
export const DEBUG_PATH = `${ROUTE_PREFIX}/debug`;
/**
 * 客户端半边装配诊断：宿主到底有没有把本插件的浏览器半边交给页面。
 *
 * 装完插件后"要不要刷新页面"这个问题，答案就在这个端点里 —— 它读的是
 * `ctx.clientModules.graph()`（= 页面 `window.__DSH_BOOT__` 的宿主侧来源），
 * 并给出真实的 bundle 组合 URL，可以直接 GET 验字节。
 */
export const CLIENT_ENTRY_PATH = `${ROUTE_PREFIX}/client-entry`;
/** 探针端点（M0 用；M1 保留为诊断工具）。 */
export const PROBE_ARM_PATH = `${ROUTE_PREFIX}/probe/arm`;
export const PROBE_TURN_PATH = `${ROUTE_PREFIX}/probe/turn`;
export const PROBE_ARCHIVE_PATH = `${ROUTE_PREFIX}/probe/archive`;
/**
 * profile 条目 id —— **0.1.7 起它就是设置命名空间**。
 *
 * DSH 0.1.7+ 的 SettingsForms 按 profile 条目 id 组织表单：宿主侧 `describe()` 列出的是
 * 条目 id，客户端 `ctx.configForms.get(entryId)` 的键也是它。所以这个常量必须与
 * `cordis.patch.yml` 里那一行的 `id:` 逐字一致。
 */
export const ENTRY_ID = 'cosplay';
/** 客户端 `<style data-plugin>` 与诊断前缀用的包名。 */
export const PACKAGE_NAME = 'dsh-cosplay';
/** 浏览器半边在 `conversation.view` 里的条目 id（也就是页签 id）。 */
export const VIEW_ID = 'cosplay';
/** 页签顺序：chat=0、trajectory=10，我们排在它们之后。 */
export const VIEW_ORDER = 20;
/** 我们注册到 `settings.section` 的页面 id。 */
export const SETTINGS_SECTION_ID = 'cosplay';
/** 我们注册到 `settings.section` 的页面顺序。 */
export const SETTINGS_SECTION_ORDER = 30;
/**
 * 系统提示段的唯一名字。
 *
 * 用独立名字（而不是复用 `deployment:persona-prefix`）：复用会在全局层与
 * `dsh-system-prompt` 自己的注册撞名并**抛错**（那个名字是给 agent preset 用的
 * scope 覆盖位）。我们的注入是**加法**，不是替换。
 */
export const PROMPT_SECTION = 'dsh-cosplay:persona';
/**
 * 尾部回声段的名字（可选的第二段）。
 *
 * 为什么要在**系统提示词最末尾**再放一句角色原话：注意力在长上下文里呈 U 型
 * （开头强、中间弱、结尾强），关键约束"首尾各说一次"是被验证过的模式。但它的边界也很硬：
 * **只能一条、必须逐字**（换说法会被读成第二条冲突约束），而且**推理模型收益明显更小**
 * （模型会在思考里自己复述）—— 所以这一段默认关，是否翻开看实测。
 *
 * 仍然用独立段名、且**不复用** `deployment:persona-suffix`：那个槽位与 agent preset 共享，
 * 被 shadow 掉我们的回声会静默失效。order 取 `DEPLOYMENT_PERSONA_SUFFIX + 1`（真末尾）。
 */
export const PROMPT_ECHO_SECTION = 'dsh-cosplay:persona-echo';
/**
 * 锚点放在**运行时上下文**时用的注册名（`anchorSeat='context'` 才用）。
 *
 * 依据：`dsh-system-prompt` 对运行时上下文的定义是
 * **"Dynamic model context materialized as a durable user-role snapshot"** ——
 * 它以 user 角色、在**对话历史之后**落进请求，这正是 ContextEcho（E1）与社区规格（E5）
 * 都推荐的"近因位"；而系统提示词末尾（`PROMPT_ECHO_SECTION`）在整个请求里仍属**最前面**。
 *
 * 代价与限制（spike 要验的）：快照**内容变化时才重新物化**，所以静态锚点会随历史增长沉到中间；
 * 真要每轮都在末尾，锚点文本必须每轮变化（代价是每轮多一条 user 角色快照）。
 */
export const PROMPT_ANCHOR_CONTEXT = 'dsh-cosplay:persona-anchor';
/** 探针标记：只有带这个标记的用户消息才会被 M0 探针改写（绝不碰真实对话）。 */
export const PROBE_MARKER = 'cosplay-probe-marker';
/** 探针改写后的前缀（用来在会话日志里一眼认出这是探针产物）。 */
export const PROBE_REWRITE_PREFIX = '[cosplay-probe]';
/** 单次请求体上限（JSON POST）。 */
export const MAX_BODY_BYTES = 256 * 1024;
/** 立绘/导入的请求体上限（base64 后约 1.37 倍，留足余量）。 */
export const MAX_ART_BYTES = 10 * 1024 * 1024;
/** 卡片库数据端点（页签网格与设置页共用）。 */
export const LIBRARY_PATH = `${ROUTE_PREFIX}/library`;
/** 诊断回执单条上限。 */
export const MAX_DEBUG_NOTE_CHARS = 2000;
//# sourceMappingURL=protocol.js.map