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
import { createCosplayCommand } from './command.js';
import { effectiveCardId } from './bindings.js';
import { DEFAULT_CONFIG } from './config.js';
import { installPreStepHook } from './hook.js';
import { createLibrary, resolveLibraryPaths } from './library.js';
import { installDurableObserver } from './observe.js';
import { PACKAGE_NAME } from './protocol.js';
import { composeEchoText, composePersonaText, modeIncludes, registerEchoSection, registerPersonaSection } from './prompt.js';
import { createCosplayRoute } from './route.js';
import { createRewriter } from './rewrite.js';
import { Config, resolveLive } from './schema.js';
import { createState } from './state.js';
import { createTrace } from './trace.js';
/** cordis 插件名。 */
export const name = 'cosplay';
/** 硬依赖：没有 webServer 就没有路由（界面数据、诊断全走它）。 */
export const inject = ['webServer'];
/** 导出给 loader 的插件 Config（0.1.7+ 的设置表单就是从这里投影出来的）。 */
export { Config };
/** 建一份全零计数。 */
function createStats() {
    return {
        sectionCalls: 0,
        sectionFilled: 0,
        preStepCalls: 0,
        preStepRewrote: 0,
        rewrite: { calls: 0, ok: 0, failed: 0, cached: 0, lastMs: 0, lastModel: '' },
        durableUserMessages: 0,
    };
}
/**
 * 挂载。
 * @param ctx - 宿主插件上下文。
 * @param live - 解析后的活配置：**每个字段都是 `Volatile` 引用，读值要 `.get()`**。
 */
export function apply(ctx, live) {
    const readConfig = () => resolveLive(live);
    const log = (message) => {
        ctx.logger?.info?.(`dsh-cosplay: ${message}`);
    };
    const stats = createStats();
    // 环形缓冲容量在建实例时定下；改 traceSize 需要重挂插件（诊断参数，不值得为它做热更新）。
    const trace = createTrace(readConfig().traceSize || DEFAULT_CONFIG.traceSize);
    const probe = { armed: false, touched: new Set(), sessions: [] };
    /**
     * 惰性单例：库与状态。
     *
     * 为什么不用"apply 时建一次"：用户可能在设置里改 `storagePath`，而改设置**不会重挂插件**。
     * 这里每次读的时候比对根目录，变了就重建（同一进程里换库是罕见操作，代价可以接受）。
     */
    let libraryCache;
    const library = () => {
        const root = resolveLibraryPaths(readConfig().storagePath).root;
        if (libraryCache === undefined || libraryCache.root !== root) {
            libraryCache = { root, value: createLibrary({ root, log }) };
            log(`卡片库：${root}`);
        }
        return libraryCache.value;
    };
    let stateCache;
    const state = () => {
        const file = resolveLibraryPaths(readConfig().storagePath).library.replace(/library\.json$/, 'state.json');
        if (stateCache === undefined || stateCache.file !== file) {
            stateCache = { file, value: createState(file) };
        }
        return stateCache.value;
    };
    const rewrite = createRewriter({ ctx, config: readConfig, trace, stats });
    // 1) 前缀路由（库 / 分享 / 会话绑定 / 诊断 / 探针）
    ctx.effect(() => ctx.webServer.register(createCosplayRoute({ ctx, config: readConfig, stats, trace, probe, library, state, rewrite })), 'dsh-cosplay: route');
    // 2) 人设注入段
    /** 已经报过"注入了多长"的 (会话, 卡) —— 每组合只报一次，别刷爆环形缓冲。 */
    const personaReported = new Set();
    ctx.effect(() => registerPersonaSection(ctx, {
        trace,
        stats,
        compose: (sessionId) => {
            const cfg = readConfig();
            if (!cfg.enabled || sessionId === undefined)
                return '';
            // 判定只有一份（`bindings.ts`）：浏览器半边显示的角色走的也是它。
            const cardId = effectiveCardId({
                binding: state().binding(sessionId),
                defaultCardId: cfg.defaultCardId,
                injectIntoUnbound: cfg.injectIntoUnboundSessions,
            });
            if (cardId === '')
                return '';
            const card = library().get(cardId);
            if (card === undefined)
                return '';
            if (!modeIncludes(card, cfg.strategy, 'system'))
                return '';
            const text = composePersonaText(card, cfg.personaMaxChars);
            const mark = `${sessionId}:${card.id}`;
            if (text !== '' && !personaReported.has(mark) && personaReported.size < 32) {
                personaReported.add(mark);
                // 标记这个会话：durable 观测只为"角色真的生效过"的会话记日志（其余一条都不记）。
                probe.touched.add(sessionId);
                trace.push({
                    kind: 'host:persona-injected',
                    sessionId,
                    id: card.id,
                    note: `注入「${card.name}」人设 ${text.length} 字（上限 ${cfg.personaMaxChars}）`,
                });
            }
            return text;
        },
    }) ?? (() => { }), 'dsh-cosplay: persona section');
    // 3) 尾部回声段（可选，`personaEcho`）：把角色的**原话**放到系统提示词最末尾。
    //    只用卡片自己的文字（`tailLine`，否则逐字取人设第一句），插件绝不自己造句 ——
    //    造句会变成通用系统腔，还会和开头那句对不上（换说法 = 被读成第二条冲突约束）。
    const echoReported = new Set();
    ctx.effect(() => registerEchoSection(ctx, {
        trace,
        stats,
        compose: (sessionId) => {
            const cfg = readConfig();
            if (!cfg.enabled || !cfg.personaEcho || sessionId === undefined)
                return '';
            const cardId = effectiveCardId({
                binding: state().binding(sessionId),
                defaultCardId: cfg.defaultCardId,
                injectIntoUnbound: cfg.injectIntoUnboundSessions,
            });
            if (cardId === '')
                return '';
            const card = library().get(cardId);
            if (card === undefined)
                return '';
            if (!modeIncludes(card, cfg.strategy, 'system'))
                return '';
            const text = composeEchoText(card);
            const mark = `${sessionId}:${card.id}`;
            if (text !== '' && !echoReported.has(mark) && echoReported.size < 32) {
                echoReported.add(mark);
                trace.push({
                    kind: 'host:persona-echo',
                    sessionId,
                    id: card.id,
                    note: `尾部回声 ${text.length} 字（放在系统提示词末尾）`,
                });
            }
            return text;
        },
    }) ?? (() => { }), 'dsh-cosplay: echo section');
    // 4) 改写链路（`agent/pre-step`）
    ctx.effect(() => installPreStepHook(ctx, { trace, stats, config: readConfig, library, state, probe, rewrite }), 'dsh-cosplay: pre-step hook');
    // 5) durable 观测（只为被改写过的会话记录正文预览，见 observe.ts 的隐私边界）
    ctx.effect(() => installDurableObserver(ctx, { trace, stats, probe }), 'dsh-cosplay: durable observer');
    // 6) 斜杠命令 `/cosplay`（界面坏掉时的逃生阀）
    const commands = ctx.get('commands');
    if (commands !== undefined) {
        ctx.effect(() => commands.register(createCosplayCommand({ config: readConfig, library, state })), 'dsh-cosplay: /cosplay command');
    }
    else {
        log('commands 服务缺失，/cosplay 未注册');
    }
    // 6) 客户端装配图观测（"要不要刷新页面"的答案在这里）
    const anyCtx = ctx;
    anyCtx.inject(['clientModules'], (inner) => {
        const modules = inner.clientModules;
        if (modules === undefined || typeof modules.onGraphChanged !== 'function')
            return;
        inner.effect(() => modules.onGraphChanged(() => {
            try {
                const graph = modules.graph();
                const entry = graph.entries.find((candidate) => candidate.id === PACKAGE_NAME);
                trace.push({
                    kind: 'host:client-graph-changed',
                    note: `rev=${graph.rev} 条目 ${graph.entries.length} 个 · 本包${entry === undefined ? '不在' : `在树内 url=${entry.url}`}` +
                        '（页面是否已装载看 client:client-apply 回执）',
                });
            }
            catch {
                // 观测失败不影响任何东西。
            }
        }), 'dsh-cosplay: client graph observer');
    });
    const info = library().info();
    log(`已挂载 · 路由 ${PACKAGE_NAME} · 卡片 ${info.cards} 张（预设 ${info.presets} / 自定义 ${info.customs}）· ` +
        `库 ${info.root} · 提示段=${ctx.get('systemPrompt') === undefined ? '缺失' : '已接'} · ` +
        `命令=${commands === undefined ? '缺失' : '已接'} · llm=${ctx.get('llm') === undefined ? '缺失' : '已接'}`);
}
//# sourceMappingURL=index.js.map