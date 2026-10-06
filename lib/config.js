/**
 * dsh-cosplay — 默认配置（**纯常量**，浏览器半边要读它）。
 *
 * 这个文件刻意不 import schemastery：schema 在 `schema.ts`（host only），
 * 形状与默认值在这里，两边共用一份常量，避免"面板显示的值"与"代码里的默认值"漂移。
 */
/** 默认配置。 */
export const DEFAULT_CONFIG = {
    enabled: true,
    strategy: 'card',
    defaultCardId: '',
    injectIntoUnboundSessions: false,
    rewriteProvider: '',
    rewriteModel: '',
    rewriteTemperature: 0.4,
    rewriteTimeoutMs: 20000,
    rewriteMaxInputChars: 6000,
    rewriteMaxOutputChars: 4000,
    rewriteOnFailure: 'original',
    rewriteContextTurns: 6,
    rewriteContextMaxChars: 2400,
    rewriteGuardUnresolved: true,
    personaEcho: true,
    anchorSeat: 'system',
    thinkingFlavor: 'off',
    ignoreSubagents: true,
    inheritFromParent: false,
    personaMaxChars: 8000,
    showTab: true,
    coverAspect: 1,
    storagePath: '',
    artMaxEdge: 1024,
    artQuality: 0.85,
    enableProbeEndpoints: false,
    traceSize: 200,
};
/** 默认卡片的生效方式（预置卡与新建卡共用）。 */
export const DEFAULT_CARD_MODE = 'system';
/** 把面板读到的原始值补成完整配置。 */
export function resolveConfig(raw) {
    const value = (raw ?? {});
    const out = { ...DEFAULT_CONFIG };
    for (const key of Object.keys(DEFAULT_CONFIG)) {
        const next = value[key];
        if (next !== undefined && next !== null)
            out[key] = next;
    }
    return out;
}
//# sourceMappingURL=config.js.map