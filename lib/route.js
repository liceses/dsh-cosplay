/**
 * dsh-cosplay — HTTP 路由（host）。
 *
 * 一条前缀路由 `/api/dsh-cosplay`，管四类事：
 *
 * **卡片库**
 *   GET  /library              卡片元数据投影 + 存储信息（页签网格与设置页用）
 *   GET  /card/<id>            单卡全文（编辑表单用）
 *   POST /card                 新建/更新一张自定义卡
 *   POST /card/copy            复制为自定义卡（预设卡改动的唯一正道）
 *   POST /card/delete          删一张自定义卡
 *   GET  /art/<artId>          立绘字节（immutable + ETag/304）
 *   POST /art                  存一张立绘（按 sha256 去重）
 *
 * **分享**
 *   GET  /export?ids=a,b       导出包（立绘内联 base64）
 *   POST /export/write         导出并落盘到 exports/，返回绝对路径
 *   POST /import               导入包
 *
 * **本会话**
 *   GET  /binding?sessionId=   读本会话绑定与开关
 *   POST /binding              写绑定与开关（客户端在会话打开时写入生效值）
 *   POST /rewrite              手动改写一次（预览/排障）
 *   GET  /diagnostics?sessionId=  诊断：计数 + 本会话改写记录 + 轨迹尾
 *
 * **机制自检与观测**
 *   GET  /stats · /trace · /client-entry   宿主诊断
 *   POST /debug                             客户端回执入口
 *   POST /probe/arm · /probe/turn · /probe/archive   一次性探针（M0 保留）
 *
 * ## 围栏
 *
 * **只接受回环 Host，且不发任何 CORS 头**（与 dsh-showme-html / dsh-memes-reply 同款）。
 * 每个写端点都有请求体上限；`art` 的白名单是"按字节签名判定"而不是信任声明的 mime。
 */
import { cardToMeta, sniffImage } from './cards.js';
import { messageOf, composeRewriteSystem } from './prompt.js';
import { CLIENT_ENTRY_PATH, DEBUG_PATH, LIBRARY_PATH, MAX_ART_BYTES, MAX_BODY_BYTES, MAX_DEBUG_NOTE_CHARS, PACKAGE_NAME, PROBE_ARCHIVE_PATH, PROBE_ARM_PATH, PROBE_MARKER, PROBE_TURN_PATH, ROUTE_PREFIX, STATS_PATH, TRACE_PATH, } from './protocol.js';
/** 只接受回环 Host。 */
export function isLoopback(req) {
    const host = String(req.headers.host ?? '');
    const name = host.startsWith('[') ? host.slice(1, host.indexOf(']')) : host.split(':')[0];
    return name === '127.0.0.1' || name === 'localhost' || name === '::1';
}
/** 取一个请求头（node:http 的头可能是 string 或 string[]）。 */
function headerOf(req, name) {
    const value = req.headers[name];
    if (typeof value === 'string')
        return value;
    if (Array.isArray(value))
        return value[0];
    return undefined;
}
/**
 * **本地等价围栏**：`dsh-client-connection` 不在时用它（语义照抄框架的 `isTrustedApiRequest`）。
 *
 * 框架那份（`isTrustedApiRequest`）做三件事：Host 必须是回环或可信 authority；
 * **拒绝 `sec-fetch-site: cross-site`**；有 `Origin` 时它必须与 Host 同源（没有 `Origin` 则放行 ——
 * 那是给本机原生客户端留的口子）。
 *
 * 为什么必须有这一条：我们的路由前缀 `/api/dsh-cosplay` 比框架的 `/api` **更长**，而宿主
 * webserver 是 `Longest-prefix-wins`（`dsh-host-webserver` 的注释原文），所以框架自己那道
 * `/api` 围栏（可信来源 403 + 浏览器会话 401）在我们的路径上**不会执行** —— 必须自己接上
 * （优先用框架服务，见 `admissionStatus()`）。这是外部安全报告 issue #1 的核心。
 */
export function localFenceRejection(req) {
    if (!isLoopback(req))
        return 403;
    if (headerOf(req, 'sec-fetch-site') === 'cross-site')
        return 403;
    const origin = headerOf(req, 'origin');
    if (origin === undefined)
        return undefined;
    const host = headerOf(req, 'host');
    try {
        // Origin 必须与 Host 同源（端口也要一致；浏览器跨站会带别的 origin）
        return new URL(origin).host === host ? undefined : 403;
    }
    catch {
        return 403;
    }
}
/**
 * 取框架的围栏服务（没有 / 形状不对 / 取不到都返回 undefined → 走本地等价围栏）。
 *
 * 为什么不"没有就拒绝"：`connection` 是框架的一个**可选**服务（不同部署不一定有），
 * 它不在时正确做法是退回我们自己的等价围栏，而不是把插件整成不可用。
 * 只有**服务存在但自己抛错**时才是失败关闭（见下面的 catch）。
 */
function connectionFenceOf(ctx) {
    try {
        if (typeof ctx.get !== 'function')
            return undefined;
        const service = ctx.get('connection');
        if (service === undefined || typeof service.requestRejection !== 'function')
            return undefined;
        return service;
    }
    catch {
        return undefined;
    }
}
/**
 * 入站请求的准入状态：`undefined` 表示放行，`401` / `403` 表示拒绝。
 *
 * 优先用**框架自己的**围栏（`connection.requestRejection()`，文档原话是
 * "Apply the configured Host/Origin fence, then browser authentication"）——
 * 这样我们的路由与框架 `/api` 是**同一道边界**：浏览器页面带着会话 cookie 照常通过，
 * 无 cookie 的本机进程被 401，跨站页面被 403。
 * 服务不在（别的部署）时退回 `localFenceRejection()`；服务存在但抛错则**失败关闭**（403）。
 */
export function admissionStatus(ctx, req) {
    const fence = connectionFenceOf(ctx);
    if (fence !== undefined) {
        try {
            return fence.requestRejection({ headers: req.headers });
        }
        catch {
            return 403; // 围栏本身出错时宁可拒绝，也不放行
        }
    }
    return localFenceRejection(req);
}
/** 统一 JSON 响应。 */
export function sendJson(res, status, payload) {
    const body = JSON.stringify(payload);
    res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': String(Buffer.byteLength(body)),
        'Cache-Control': 'no-store',
    });
    res.end(body);
}
/** 读一个小请求体（超限直接掐掉，返回 undefined）。 */
async function readBody(req, limit) {
    return new Promise((resolve) => {
        let raw = '';
        req.setEncoding('utf8');
        req.on('data', (chunk) => {
            raw += chunk;
            if (raw.length > limit) {
                req.destroy();
                resolve(undefined);
            }
        });
        req.on('end', () => resolve(raw));
        req.on('error', () => resolve(undefined));
    });
}
/** pathname（去掉 query）。 */
function pathnameOf(url) {
    const raw = url ?? '/';
    const cut = raw.indexOf('?');
    return cut < 0 ? raw : raw.slice(0, cut);
}
/** query 参数。 */
function queryOf(url, key) {
    const raw = url ?? '';
    const cut = raw.indexOf('?');
    if (cut < 0)
        return null;
    return new URLSearchParams(raw.slice(cut + 1)).get(key);
}
/** 解析 JSON 体。 */
function parseJson(raw) {
    if (raw === undefined || raw.trim() === '')
        return undefined;
    try {
        const value = JSON.parse(raw);
        return value !== null && typeof value === 'object' ? value : undefined;
    }
    catch {
        return undefined;
    }
}
/** 立绘 id 形状。 */
const ART_ID_RE = /^a-[0-9a-f]{16}$/;
/** 构建这条前缀路由。 */
export function createCosplayRoute(deps) {
    const { ctx, config, stats, trace, probe } = deps;
    /** 状态行。 */
    const statsPayload = () => {
        const cfg = config();
        return {
            ok: true,
            plugin: PACKAGE_NAME,
            stats,
            config: {
                enabled: cfg.enabled,
                strategy: cfg.strategy,
                defaultCardId: cfg.defaultCardId,
                showTab: cfg.showTab,
                rewriteProvider: cfg.rewriteProvider,
                rewriteModel: cfg.rewriteModel,
                rewriteTimeoutMs: cfg.rewriteTimeoutMs,
                rewriteOnFailure: cfg.rewriteOnFailure,
            },
            probe: { armed: probe.armed, sessions: probe.sessions, touched: [...probe.touched] },
            trace: { size: trace.size(), capacity: trace.capacity() },
            ts: Date.now(),
        };
    };
    /** 发立绘字节（ETag + immutable + 304）。 */
    const sendArt = (req, res, artId) => {
        const found = deps.library().artBytes(artId);
        if (found === undefined) {
            sendJson(res, 404, { ok: false, error: `立绘不存在：${artId}` });
            return;
        }
        const etag = `"${found.sha256}"`;
        const headers = {
            'Content-Type': found.mime,
            ETag: etag,
            'Cache-Control': 'private, max-age=31536000, immutable',
            'X-Content-Type-Options': 'nosniff',
        };
        if (String(req.headers['if-none-match'] ?? '') === etag) {
            res.writeHead(304, headers);
            res.end();
            return;
        }
        headers['Content-Length'] = String(found.bytes.byteLength);
        res.writeHead(200, headers);
        if ((req.method ?? 'GET').toUpperCase() === 'HEAD')
            res.end();
        else
            res.end(found.bytes);
    };
    return {
        kind: 'prefix',
        path: ROUTE_PREFIX,
        handler: async (req, res) => {
            // 准入：优先借框架自己的围栏（Host/Origin + 浏览器会话 cookie），退回本地等价围栏。
            // 见 `admissionStatus()` 的注释 —— 我们的前缀比框架 `/api` 长，会顶掉框架那道围栏。
            const rejection = admissionStatus(ctx, req);
            if (rejection !== undefined) {
                sendJson(res, rejection, { ok: false, error: rejection === 401 ? 'unauthorized' : 'loopback same-origin only' });
                return;
            }
            const path = pathnameOf(req.url);
            const method = (req.method ?? 'GET').toUpperCase();
            const rest = path.slice(ROUTE_PREFIX.length);
            // ── 诊断 ───────────────────────────────────────────────────────────────
            if (path === STATS_PATH && (method === 'GET' || method === 'HEAD')) {
                sendJson(res, 200, statsPayload());
                return;
            }
            if (path === TRACE_PATH && method === 'GET') {
                const raw = queryOf(req.url, 'limit');
                const limit = raw === null || raw.trim() === '' ? 50 : Number(raw);
                sendJson(res, 200, {
                    ok: true,
                    capacity: trace.capacity(),
                    size: trace.size(),
                    entries: trace.list(Number.isFinite(limit) ? limit : 50),
                });
                return;
            }
            if (path === DEBUG_PATH && method === 'POST') {
                const body = parseJson(await readBody(req, 64 * 1024));
                if (body === undefined) {
                    sendJson(res, 400, { ok: false, error: 'body 必须是 JSON 对象' });
                    return;
                }
                trace.push({
                    kind: typeof body.kind === 'string' && body.kind !== '' ? `client:${body.kind}` : 'client:?',
                    ...(typeof body.sessionId === 'string' && body.sessionId !== '' ? { sessionId: body.sessionId } : {}),
                    ...(typeof body.turn === 'number' && Number.isFinite(body.turn) ? { turn: body.turn } : {}),
                    ...(typeof body.id === 'string' && body.id !== '' ? { id: body.id } : {}),
                    note: typeof body.note === 'string' ? body.note.slice(0, MAX_DEBUG_NOTE_CHARS) : '',
                });
                sendJson(res, 200, { ok: true });
                return;
            }
            if (path === CLIENT_ENTRY_PATH && method === 'GET') {
                const modules = ctx.get('clientModules');
                if (modules === undefined) {
                    sendJson(res, 503, { ok: false, error: 'clientModules 服务不在（这个部署没有 Web 客户端装配）' });
                    return;
                }
                try {
                    const graph = modules.graph();
                    const entry = graph.entries.find((candidate) => candidate.id === PACKAGE_NAME);
                    sendJson(res, 200, {
                        ok: true,
                        rev: graph.rev,
                        inGraph: entry !== undefined,
                        entry: entry ?? null,
                        batches: graph.batches.filter((batch) => batch.entries.includes(PACKAGE_NAME)),
                        graphEntries: graph.entries.length,
                    });
                }
                catch (error) {
                    sendJson(res, 500, { ok: false, error: messageOf(error) });
                }
                return;
            }
            // ── 卡片库 ─────────────────────────────────────────────────────────────
            if (path === LIBRARY_PATH && method === 'GET') {
                const library = deps.library();
                sendJson(res, 200, {
                    ok: true,
                    root: library.info().root,
                    info: library.info(),
                    cards: library.metas(),
                    // 最后一次成功绑定的卡：新会话 chip 没有显式绑定时自动预选它（"换会话不换角色"）。
                    lastCardId: deps.state().lastCardId(),
                    config: {
                        enabled: config().enabled,
                        strategy: config().strategy,
                        defaultCardId: config().defaultCardId,
                        coverAspect: config().coverAspect,
                        artMaxEdge: config().artMaxEdge,
                        artQuality: config().artQuality,
                    },
                    ts: Date.now(),
                });
                return;
            }
            if (rest.startsWith('/card/') && method === 'GET') {
                const id = rest.slice('/card/'.length);
                const card = deps.library().get(id);
                if (card === undefined)
                    sendJson(res, 404, { ok: false, error: `卡不存在：${id}` });
                else
                    sendJson(res, 200, { ok: true, card });
                return;
            }
            if (rest === '/card' && method === 'POST') {
                const body = parseJson(await readBody(req, MAX_BODY_BYTES));
                if (body === undefined) {
                    sendJson(res, 400, { ok: false, error: 'body 必须是 JSON 对象' });
                    return;
                }
                const result = deps.library().upsert(body.card ?? body);
                sendJson(res, result.card === undefined ? 400 : 200, {
                    ok: result.card !== undefined,
                    card: result.card ?? null,
                    issues: result.issues,
                });
                return;
            }
            if (rest === '/card/copy' && method === 'POST') {
                const body = parseJson(await readBody(req, MAX_BODY_BYTES));
                const id = typeof body?.id === 'string' ? body.id : '';
                const overrides = body?.overrides !== null && typeof body?.overrides === 'object' ? body.overrides : {};
                const result = deps.library().copyCard(id, overrides);
                sendJson(res, result.card === undefined ? 404 : 200, {
                    ok: result.card !== undefined,
                    card: result.card ?? null,
                    issues: result.issues,
                });
                return;
            }
            if (rest === '/card/delete' && method === 'POST') {
                const body = parseJson(await readBody(req, 64 * 1024));
                const id = typeof body?.id === 'string' ? body.id : '';
                const removed = deps.library().remove(id);
                sendJson(res, removed ? 200 : 404, { ok: removed, id });
                return;
            }
            if (rest === '/art/prune' && method === 'POST') {
                const removed = deps.library().pruneOrphanArt();
                trace.push({ kind: 'host:art-prune', note: `清理无引用立绘 ${removed} 张` });
                sendJson(res, 200, { ok: true, removed });
                return;
            }
            if (rest.startsWith('/art/') && (method === 'GET' || method === 'HEAD')) {
                const artId = rest.slice('/art/'.length);
                if (!ART_ID_RE.test(artId)) {
                    sendJson(res, 400, { ok: false, error: 'artId 形状不合法' });
                    return;
                }
                sendArt(req, res, artId);
                return;
            }
            if (rest === '/art' && method === 'POST') {
                const body = parseJson(await readBody(req, MAX_ART_BYTES));
                if (body === undefined) {
                    sendJson(res, 400, { ok: false, error: `body 必须是 JSON 对象（且不超过 ${Math.round(MAX_ART_BYTES / 1024 / 1024)} MB）` });
                    return;
                }
                const base64 = typeof body.base64 === 'string' ? body.base64 : '';
                if (base64 === '') {
                    sendJson(res, 400, { ok: false, error: '缺少 base64' });
                    return;
                }
                const bytes = new Uint8Array(Buffer.from(base64, 'base64'));
                if (bytes.byteLength === 0) {
                    sendJson(res, 400, { ok: false, error: 'base64 解出来是空字节' });
                    return;
                }
                if (bytes.byteLength > MAX_ART_BYTES / 2) {
                    sendJson(res, 413, { ok: false, error: `立绘超过上限（${(MAX_ART_BYTES / 2 / 1024 / 1024).toFixed(0)} MB）` });
                    return;
                }
                const sniffed = sniffImage(bytes);
                if (sniffed === undefined) {
                    sendJson(res, 415, { ok: false, error: '只接受 PNG / JPEG / GIF / WebP（按字节签名判定）' });
                    return;
                }
                const stored = deps.library().putArt({
                    bytes,
                    ...(typeof body.width === 'number' && Number.isFinite(body.width) ? { width: Math.trunc(body.width) } : {}),
                    ...(typeof body.height === 'number' && Number.isFinite(body.height) ? { height: Math.trunc(body.height) } : {}),
                });
                sendJson(res, stored.art === null ? 400 : 200, { ok: stored.art !== null, art: stored.art, issues: stored.issues });
                return;
            }
            // ── 分享：导出/导入 ────────────────────────────────────────────────────
            if (rest === '/export' && method === 'GET') {
                const raw = queryOf(req.url, 'ids');
                const ids = raw === null || raw.trim() === '' ? undefined : raw.split(',').map((id) => id.trim()).filter((id) => id !== '');
                const pack = deps.library().exportPack(ids);
                trace.push({ kind: 'host:export', note: `导出 ${pack.cards.length} 张卡 · 内联立绘 ${Object.keys(pack.art).length} 张` });
                sendJson(res, 200, pack);
                return;
            }
            if (rest === '/export/write' && method === 'POST') {
                const body = parseJson(await readBody(req, 64 * 1024));
                const ids = Array.isArray(body?.ids) ? body.ids.filter((id) => typeof id === 'string') : undefined;
                try {
                    const pack = deps.library().exportPack(ids);
                    const file = deps.library().writeExport(pack);
                    trace.push({ kind: 'host:export-write', note: `${pack.cards.length} 张卡 → ${file}` });
                    sendJson(res, 200, { ok: true, path: file, cards: pack.cards.length, art: Object.keys(pack.art).length });
                }
                catch (error) {
                    sendJson(res, 500, { ok: false, error: messageOf(error) });
                }
                return;
            }
            if (rest === '/import' && method === 'POST') {
                const body = parseJson(await readBody(req, MAX_ART_BYTES));
                if (body === undefined) {
                    sendJson(res, 400, { ok: false, error: 'body 必须是 JSON 对象（或超过体积上限）' });
                    return;
                }
                const pack = body.pack ?? body;
                const result = deps.library().importPack(pack);
                trace.push({
                    kind: 'host:import',
                    note: `导入：新增 ${result.added} · 覆盖 ${result.replaced} · 跳过 ${result.skipped} · 问题 ${result.errors.length}`,
                });
                sendJson(res, result.ok ? 200 : 400, result);
                return;
            }
            // ── 本会话 ─────────────────────────────────────────────────────────────
            if (rest === '/binding' && method === 'GET') {
                const sessionId = queryOf(req.url, 'sessionId') ?? '';
                if (sessionId === '') {
                    sendJson(res, 400, { ok: false, error: '需要 sessionId' });
                    return;
                }
                const binding = deps.state().binding(sessionId);
                const cardId = binding?.cardId ?? null;
                const card = cardId === null ? undefined : deps.library().get(cardId);
                sendJson(res, 200, {
                    ok: true,
                    sessionId,
                    binding: binding ?? { cardId: null, enabled: true, updatedAt: 0 },
                    card: card === undefined ? null : cardToMeta(card, card.art === null || card.art === undefined ? '' : card.art.sha256.slice(0, 8)),
                    rewrites: deps.state().rewritesOf(sessionId, 5),
                });
                return;
            }
            if (rest === '/binding' && method === 'POST') {
                const body = parseJson(await readBody(req, 64 * 1024));
                const sessionId = typeof body?.sessionId === 'string' ? body.sessionId : '';
                if (sessionId === '') {
                    sendJson(res, 400, { ok: false, error: '需要 sessionId' });
                    return;
                }
                const patch = {};
                if (body !== undefined && 'cardId' in body)
                    patch.cardId = typeof body.cardId === 'string' && body.cardId !== '' ? body.cardId : null;
                if (body !== undefined && typeof body.enabled === 'boolean')
                    patch.enabled = body.enabled;
                const next = deps.state().setBinding(sessionId, patch);
                const card = next.cardId === null ? undefined : deps.library().get(next.cardId);
                trace.push({
                    kind: 'host:binding',
                    sessionId,
                    ...(next.cardId === null ? {} : { id: next.cardId }),
                    note: `会话绑定更新：cardId=${next.cardId ?? 'null'} enabled=${String(next.enabled)}${card === undefined ? '' : ` name=${card.name}`}`,
                });
                sendJson(res, 200, { ok: true, binding: next });
                return;
            }
            if (rest === '/rewrite' && method === 'POST') {
                const body = parseJson(await readBody(req, MAX_BODY_BYTES));
                const sessionId = typeof body?.sessionId === 'string' ? body.sessionId : '';
                const text = typeof body?.text === 'string' ? body.text : '';
                if (text.trim() === '') {
                    sendJson(res, 400, { ok: false, error: '需要 text' });
                    return;
                }
                const id = typeof body?.cardId === 'string' && body.cardId !== ''
                    ? body.cardId
                    : (deps.state().binding(sessionId)?.cardId ?? config().defaultCardId);
                const card = deps.library().get(id);
                if (card === undefined) {
                    sendJson(res, 404, { ok: false, error: `卡不存在：${id === '' ? '(未指定)' : id}` });
                    return;
                }
                if (composeRewriteSystem(card) === '') {
                    sendJson(res, 400, { ok: false, error: `「${card.name}」没有 rewrite.rules，不能改写` });
                    return;
                }
                const controller = new AbortController();
                const timer = setTimeout(() => controller.abort(), Math.max(1000, config().rewriteTimeoutMs));
                try {
                    // 手动试跑是"单句直通"：没有会话上下文，所以原文就是输入本体
                    // （要验上下文链路，用真实会话 + `/trace` 里的 host:rewrite-context）。
                    const result = await deps.rewrite({ card, input: text, sessionId, signal: controller.signal });
                    clearTimeout(timer);
                    sendJson(res, result.ok ? 200 : 502, { ...result, ok: result.ok, cardId: card.id, cardName: card.name });
                }
                catch (error) {
                    clearTimeout(timer);
                    sendJson(res, 500, { ok: false, error: messageOf(error) });
                }
                return;
            }
            if (rest === '/diagnostics' && method === 'GET') {
                const sessionId = queryOf(req.url, 'sessionId') ?? '';
                sendJson(res, 200, {
                    ok: true,
                    stats,
                    info: deps.library().info(),
                    orphans: deps.library().orphanArt().length,
                    ...(sessionId === '' ? {} : { sessionId, binding: deps.state().binding(sessionId) ?? null, rewrites: deps.state().rewritesOf(sessionId, 20) }),
                    trace: trace.list(40),
                });
                return;
            }
            // ── M0 探针（**默认关闭**的开发期自检工具）────────────────────────────
            // 为什么默认关：`probe/turn` 会把请求体里的任意文本当作真实用户输入投给 agent
            // （继承 profile 的权限模式），`probe/archive` 能停/归档任意会话，`probe/arm` 改全局状态。
            // 即便现在有了与框架同级的准入围栏，这类"能执行 prompt"的开发工具也不该默认张开
            // （外部安全报告 issue #1）。要跑 `test/live-probe.mjs` 或对照实验脚本时，
            // 在插件配置里把 `enableProbeEndpoints` 打开。
            const probePaths = [PROBE_ARM_PATH, PROBE_TURN_PATH, PROBE_ARCHIVE_PATH];
            if (probePaths.includes(path)) {
                if (!config().enableProbeEndpoints) {
                    sendJson(res, 403, {
                        ok: false,
                        error: 'probe endpoints are disabled by default; set enableProbeEndpoints=true in the plugin config to use them',
                    });
                    return;
                }
            }
            if (path === PROBE_ARM_PATH && method === 'POST') {
                const body = parseJson(await readBody(req, MAX_BODY_BYTES));
                const armed = body?.armed !== false;
                probe.armed = armed;
                trace.push({ kind: 'host:probe-arm', note: `探针 ${armed ? '已武装' : '已解除'}（只有武装时带标记的消息才会被改写）` });
                sendJson(res, 200, { ok: true, armed });
                return;
            }
            if (path === PROBE_TURN_PATH && method === 'POST') {
                const body = parseJson(await readBody(req, MAX_BODY_BYTES));
                const sessions = ctx.get('sessionController');
                if (sessions === undefined) {
                    sendJson(res, 503, { ok: false, error: 'sessionController 服务不在（这个部署不能起探针会话）' });
                    return;
                }
                const text = typeof body?.text === 'string' && body.text.trim() !== ''
                    ? body.text
                    : `${PROBE_MARKER}\n请只回复一句话：把你在本轮收到的用户消息正文**原样**复述一遍。不要调用任何工具。`;
                try {
                    // 传了 sessionId 就往**已有会话**里发（多轮对照实验用）；否则新建一个。
                    const reuse = typeof body?.sessionId === 'string' ? body.sessionId.trim() : '';
                    let sessionId = '';
                    if (reuse !== '') {
                        sessionId = reuse;
                    }
                    else {
                        const created = await sessions.create({ cwd: process.cwd() });
                        sessionId = String(created.sessionId);
                        probe.sessions.push(sessionId);
                    }
                    // 自检用：可以在投递之前把这张卡绑到会话上（于是这一轮就走真实的注入/改写链路）。
                    const bindCardId = typeof body?.bindCardId === 'string' ? body.bindCardId.trim() : '';
                    if (bindCardId !== '') {
                        deps.state().setBinding(sessionId, { cardId: bindCardId, enabled: true });
                        trace.push({ kind: 'host:probe-turn-bound', sessionId, id: bindCardId, note: `探针会话已绑定「${bindCardId}」` });
                    }
                    trace.push({ kind: 'host:probe-turn-created', sessionId, note: `探针会话${reuse === '' ? '已创建' : '复用'}；即将投递消息（${text.length} 字）` });
                    const controller = new AbortController();
                    const timer = setTimeout(() => controller.abort(), 30_000);
                    const receipt = await sessions.prompt({ requestId: `cosplay-probe-${Date.now().toString(36)}`, sessionId, mode: 'queue', content: [{ type: 'text', text }] }, controller.signal);
                    clearTimeout(timer);
                    trace.push({ kind: 'host:probe-turn-accepted', sessionId, note: `消息已进入收件箱：accepted=${String(receipt.accepted)}` });
                    sendJson(res, 200, { ok: true, sessionId, accepted: receipt.accepted, text });
                }
                catch (error) {
                    trace.push({ kind: 'host:probe-turn-failed', note: `起探针会话失败：${messageOf(error)}` });
                    sendJson(res, 500, { ok: false, error: messageOf(error) });
                }
                return;
            }
            if (path === PROBE_ARCHIVE_PATH && method === 'POST') {
                const body = parseJson(await readBody(req, MAX_BODY_BYTES));
                const sessionId = typeof body?.sessionId === 'string' ? body.sessionId : '';
                const workspaces = ctx.get('workspaceController');
                if (sessionId === '' || workspaces === undefined) {
                    sendJson(res, 400, { ok: false, error: '需要 sessionId，且部署要有 workspaceController' });
                    return;
                }
                try {
                    // `stopActivity` 默认 true：探针会话往往正在跑一个回合，不先停就会被
                    // `workspace/session-active` 拒掉（M1 自检时实测过一次 500）。
                    await workspaces.archiveSession({ sessionId, stopActivity: body?.stopActivity !== false });
                    probe.sessions = probe.sessions.filter((id) => id !== sessionId);
                    trace.push({ kind: 'host:probe-archived', sessionId, note: '探针会话已归档' });
                    sendJson(res, 200, { ok: true, sessionId });
                }
                catch (error) {
                    sendJson(res, 500, { ok: false, error: messageOf(error) });
                }
                return;
            }
            sendJson(res, 404, { ok: false, error: `unknown cosplay route: ${method} ${path}` });
        },
    };
}
//# sourceMappingURL=route.js.map