/**
 * dsh-cosplay — 路径常量（host only）。
 *
 * 与 `dsh-home-paths` 同规则：先看 `DSH_HOME`，再退到 `~/.dsh`。
 * 单独一个文件是为了让"库在哪"只有一个答案（路由、库、状态、诊断都读它）。
 */
/** 解析 DSH home。 */
export declare function dshHome(): string;
/** 本插件在 DSH home 下的目录名。 */
export declare const PLUGIN_HOME_DIR = "cosplay";
/** 默认的卡片库根目录。 */
export declare function defaultStorageRoot(): string;
