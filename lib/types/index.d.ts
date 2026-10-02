/**
 * dsh-cosplay — host 插件入口。
 *
 * ## 这个插件干什么
 *
 * 用**角色卡**让模型进入角色扮演。两条链路都实现，卡里可选（也受全局策略覆盖）：
 *
 * | 链路 | 落点 | 什么时候用 |
 * | --- | --- | --- |
 * | 人设注入 | 系统提示段 `dsh-cosplay:persona` | 猫娘这类"人设卡"：你正常说话，模型以角色身份作答 |
 * | 提示词改写 | `agent/pre-step` 替换用户消息 | 硬邦邦这类"改写卡"：你发一句，模型收到的是按规则重写后的 prompt |
 *
 * 两条链路的机制都已在真实运行环境里实测（见 `.dsh/showme/cosplay-m0/evidence.html`）：
 * 系统段能拿到 `agent.id`；改写结果会 durable 写成 `user/message`（模型收到的与日志逐字一致）。
 *
 * ## 装配纪律
 *
 * - 顶层 `inject` 只写**一定存在**的服务（webServer）。把 `settings` / `systemPrompt` 这类
 *   可能改名、可能不存在的服务写进顶层 inject，会让 loader 永久 pending —— 整个 profile 起不来。
 * - 每个能力都挂在 `ctx.effect` 上：停用即净。
 * - 库/状态/改写器都是**惰性单例**：配置里的 `storagePath` 改了不用重挂插件。
 */
import type { Context } from '@deepseek-ai/cordis';
import { Config, type LiveConfig } from './schema.js';
/** cordis 插件名。 */
export declare const name = "cosplay";
/** 硬依赖：没有 webServer 就没有路由（界面数据、诊断全走它）。 */
export declare const inject: string[];
/** 导出给 loader 的插件 Config（0.1.7+ 的设置表单就是从这里投影出来的）。 */
export { Config };
export type { LiveConfig };
/**
 * 挂载。
 * @param ctx - 宿主插件上下文。
 * @param live - 解析后的活配置：**每个字段都是 `Volatile` 引用，读值要 `.get()`**。
 */
export declare function apply(ctx: Context, live: LiveConfig): void;
