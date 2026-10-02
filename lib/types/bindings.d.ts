/**
 * dsh-cosplay — 「本会话到底用哪张卡」的唯一判定（**纯函数，host 与浏览器半边共用**）。
 *
 * 这段判定以前散在三处（宿主提示段、宿主 pre-step 钩子、浏览器页签），
 * 于是"页签显示的角色"和"实际生效的角色"有漂移的风险。现在只有这一份：
 *
 * | 输入 | 结果 |
 * | --- | --- |
 * | 本会话被显式关掉（`enabled === false`） | 空（零注入、零改写） |
 * | 显式绑定了某张卡 | 那张卡（**绑定是人的决定，优先级最高**） |
 * | 没绑定 + 允许套默认卡 + 配了默认卡 | 默认卡 |
 * | 其余 | 空 |
 *
 * 注意"没绑定"的语义：客户端会在**会话视图挂载时**把生效值写成本会话的显式绑定
 * （见 `client/binding.ts`），所以默认卡只对"你在界面里打开过的会话"生效 ——
 * 这是为了不把角色悄悄套到 subagent / 后台会话上。
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
/**
 * 解析本会话实际生效的角色卡 id。
 * @returns 卡 id，或空串（= 没有角色）。
 */
export declare function effectiveCardId(input: EffectiveCardInput): string;
