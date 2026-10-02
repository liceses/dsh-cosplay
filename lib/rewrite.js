/**
 * dsh-cosplay — 模型改写（host only）。
 *
 * 一次改写 = 一次**辅助模型调用**，用的就是你在界面上选的那个模型的默认选择
 * （`ctx.agentDefaultModel.currentSelection()`；也可以被插件配置里的
 * `rewriteProvider` / `rewriteModel` 覆盖）。范本是官方一手实现
 * `dsh-session-title-llm`：`ctx.llm.stream({provider, model, system, messages, maxTokens, signal})`，
 * 逐块收 `text-delta`，用 `finish.reason.kind` 判成败。
 *
 * ## 五条硬约束（每一条都对应一个线上会出现的事故）
 *
 * 1. **绝不拖住会话**：超时（默认 20s）与调用方 signal 合并；超时/报错一律按"这次改写不可用"
 *    返回，由调用方回落原文。
 * 2. **绝不重复计费**：同一条消息（`messageId`）在 `hook.ts` 里只改写一次；
 *    这里再加一层 `(卡, 组装后输入)` 的内容缓存，重试/回退路径不会重复花钱。
 * 3. **结果必须清洗**：改写正文会被逐字当成用户消息写进日志，所以代码块围栏、
 *    外层引号、三连空行都在这里剥掉。
 * 4. **不猜 provider**：拿不到 provider/model 就如实失败并说明原因，不去猜一个"看起来能用"的。
 * 5. **不写日志**：辅助调用不进会话历史（`purpose` 也刻意不设，避免被适配器按别的用途处理）。
 */
import { composeRewriteSystem, messageOf, sanitizeRewritten } from './prompt.js';
/** 内容缓存的容量（`卡+原文` → 改写结果）。 */
const CACHE_LIMIT = 32;
/** 把调用方 signal 与超时合并（Node 20.3+ 有 `AbortSignal.any`，没有就手工接）。 */
export function withTimeout(signal, timeoutMs) {
    const anySignal = AbortSignal.any;
    if (typeof anySignal === 'function') {
        const merged = anySignal([signal, AbortSignal.timeout(timeoutMs)]);
        return { signal: merged, dispose: () => { } };
    }
    const controller = new AbortController();
    const onAbort = () => controller.abort(signal.reason);
    if (signal.aborted)
        controller.abort(signal.reason);
    else
        signal.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(() => controller.abort(new Error(`改写超时（${timeoutMs}ms）`)), timeoutMs);
    return {
        signal: controller.signal,
        dispose: () => {
            clearTimeout(timer);
            signal.removeEventListener('abort', onAbort);
        },
    };
}
/** 从块流里收正文 + 判成败。 */
export async function collectStream(chunks) {
    let text = '';
    let fromBlockEnd = '';
    let error = '';
    for await (const chunk of chunks) {
        if (chunk.type === 'text-delta') {
            const delta = chunk.text;
            if (typeof delta === 'string')
                text += delta;
            continue;
        }
        if (chunk.type === 'block-end') {
            const block = chunk.block;
            if (block?.type === 'text' && typeof block.text === 'string')
                fromBlockEnd += block.text;
            continue;
        }
        if (chunk.type === 'finish') {
            const kind = chunk.reason?.kind ?? 'unknown';
            if (kind === 'error')
                error = chunk.reason?.failure?.message ?? '模型返回错误';
            else if (kind === 'aborted')
                error = '调用被取消/超时';
            continue;
        }
    }
    // 有些适配器只给 block-end 不给 text-delta，这时用 block-end 的正文兜底。
    if (text.trim() === '' && fromBlockEnd.trim() !== '')
        text = fromBlockEnd;
    return { text, error };
}
/** 建一个改写器。 */
export function createRewriter(deps) {
    const now = deps.now ?? (() => Date.now());
    const cache = new Map();
    /** 解析这次用哪个模型。 */
    const resolveModel = () => {
        const cfg = deps.config();
        const provider = cfg.rewriteProvider.trim();
        const model = cfg.rewriteModel.trim();
        if (provider !== '' && model !== '')
            return { provider, model };
        const fallback = deps.ctx.get('agentDefaultModel');
        try {
            const selection = fallback?.currentSelection();
            if (selection !== undefined && selection.provider !== '' && selection.model !== '') {
                return { provider: selection.provider, model: selection.model };
            }
        }
        catch {
            // currentSelection 抛错就当作没有默认模型。
        }
        return undefined;
    };
    return async (request) => {
        const started = now();
        const cfg = deps.config();
        const system = composeRewriteSystem(request.card);
        if (system === '') {
            return { ok: false, text: '', model: '', ms: 0, error: '这张卡没有 rewrite.rules', cached: false };
        }
        const input = request.input.length > cfg.rewriteMaxInputChars ? request.input.slice(0, cfg.rewriteMaxInputChars) : request.input;
        // 缓存键含**上下文**（整条 input），否则同一句原文配不同上下文会串结果。
        const cacheKey = `${request.card.id}\u0000${input}`;
        const hit = cache.get(cacheKey);
        if (hit !== undefined) {
            deps.stats.rewrite.cached += 1;
            return { ok: true, text: hit, model: '(缓存)', ms: 0, error: '', cached: true };
        }
        const llm = deps.ctx.get('llm');
        if (llm === undefined || typeof llm.stream !== 'function') {
            return { ok: false, text: '', model: '', ms: 0, error: 'llm 服务不在（这个部署不能做模型改写）', cached: false };
        }
        const route = resolveModel();
        if (route === undefined) {
            return {
                ok: false,
                text: '',
                model: '',
                ms: 0,
                error: '没有可用的模型：请先在界面上选一个默认模型，或在插件配置里填 rewriteProvider / rewriteModel',
                cached: false,
            };
        }
        const maxChars = request.card.rewrite?.maxOutputChars ?? cfg.rewriteMaxOutputChars;
        const temperature = request.card.rewrite?.temperature ?? cfg.rewriteTemperature;
        const guard = withTimeout(request.signal, Math.max(1000, cfg.rewriteTimeoutMs));
        deps.stats.rewrite.calls += 1;
        try {
            const chunks = llm.stream({
                provider: route.provider,
                model: route.model,
                system,
                // RequestUserInput 的形状：没有 id / source 的裸用户输入（不进会话日志）。
                messages: [{ role: 'user', content: [{ type: 'text', text: input }] }],
                maxTokens: Math.min(8000, Math.ceil(maxChars / 1.5) + 128),
                temperature,
                sessionId: request.sessionId,
                signal: guard.signal,
            });
            const collected = await collectStream(chunks);
            const ms = now() - started;
            const model = `${route.provider}/${route.model}`;
            if (collected.error !== '') {
                deps.stats.rewrite.failed += 1;
                deps.trace.push({
                    kind: 'host:rewrite-failed',
                    sessionId: request.sessionId,
                    id: request.card.id,
                    note: `模型改写失败（${ms}ms · ${model}）：${collected.error}`,
                });
                return { ok: false, text: '', model, ms, error: collected.error, cached: false };
            }
            const clean = sanitizeRewritten(collected.text, maxChars);
            if (clean === '') {
                deps.stats.rewrite.failed += 1;
                deps.trace.push({
                    kind: 'host:rewrite-empty',
                    sessionId: request.sessionId,
                    id: request.card.id,
                    note: `模型改写返回空正文（${ms}ms · ${model}，原始 ${collected.text.length} 字）`,
                });
                return { ok: false, text: '', model, ms, error: '模型返回空正文', cached: false };
            }
            cache.set(cacheKey, clean);
            if (cache.size > CACHE_LIMIT)
                cache.delete(cache.keys().next().value);
            deps.stats.rewrite.ok += 1;
            deps.stats.rewrite.lastMs = ms;
            deps.stats.rewrite.lastModel = model;
            return { ok: true, text: clean, model, ms, error: '', cached: false };
        }
        catch (error) {
            const ms = now() - started;
            deps.stats.rewrite.failed += 1;
            const message = messageOf(error);
            deps.trace.push({
                kind: 'host:rewrite-error',
                sessionId: request.sessionId,
                id: request.card.id,
                note: `模型改写抛错（${ms}ms · ${route.provider}/${route.model}）：${message}`,
            });
            return { ok: false, text: '', model: `${route.provider}/${route.model}`, ms, error: message, cached: false };
        }
        finally {
            guard.dispose();
        }
    };
}
//# sourceMappingURL=rewrite.js.map