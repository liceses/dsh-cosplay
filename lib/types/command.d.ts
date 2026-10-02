/**
 * dsh-cosplay — 斜杠命令 `/cosplay`（host）。
 *
 * 命令结果**不进模型历史**（dsh-commands 的语义），所以它最适合干这些"人按的开关"：
 *   /cosplay                 状态（总开关、策略、本会话角色、库统计、最近改写）
 *   /cosplay list [关键词]    卡片清单
 *   /cosplay on | off        本会话开/关（逃生阀）
 *   /cosplay none            本会话取消角色
 *   /cosplay <id | 名字>      本会话换上这张卡
 *
 * 为什么要有命令而不是全靠界面：**页签坏了的时候你还能自救**（客户端半边的问题不该
 * 让你连"关掉角色"都做不到）。
 */
import type { CommandDefinition } from '@deepseek-ai/dsh-commands';
import type { CosplayConfig } from './config.js';
import type { Library } from './library.js';
import type { StateStore } from './state.js';
import type { CosplayCard } from './types.js';
/** 命令名（不含前导斜杠）。 */
export declare const COMMAND_NAME = "cosplay";
/** 命令依赖。 */
export interface CommandDeps {
    config: () => CosplayConfig;
    library: () => Library;
    state: () => StateStore;
}
/** 按 id 或名字找一张卡（名字支持包含匹配）。 */
export declare function findCard(cards: readonly CosplayCard[], query: string): CosplayCard | undefined;
/** 构建 `/cosplay`。 */
export declare function createCosplayCommand(deps: CommandDeps): CommandDefinition;
