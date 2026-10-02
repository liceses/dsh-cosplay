/**
 * dsh-cosplay — 路径常量（host only）。
 *
 * 与 `dsh-home-paths` 同规则：先看 `DSH_HOME`，再退到 `~/.dsh`。
 * 单独一个文件是为了让"库在哪"只有一个答案（路由、库、状态、诊断都读它）。
 */
import { homedir } from 'node:os';
import { join } from 'node:path';
/** 解析 DSH home。 */
export function dshHome() {
    const fromEnv = process.env.DSH_HOME;
    return fromEnv !== undefined && fromEnv !== '' ? fromEnv : join(homedir(), '.dsh');
}
/** 本插件在 DSH home 下的目录名。 */
export const PLUGIN_HOME_DIR = 'cosplay';
/** 默认的卡片库根目录。 */
export function defaultStorageRoot() {
    return join(dshHome(), PLUGIN_HOME_DIR);
}
//# sourceMappingURL=paths.js.map