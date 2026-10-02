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
import type { Context } from '@deepseek-ai/cordis';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver';
import type { CosplayConfig } from './config.js';
import type { Library } from './library.js';
import type { RewriteResult } from './rewrite.js';
import type { StateStore } from './state.js';
import type { Trace } from './trace.js';
import type { CosplayCard, CosplayStats } from './types.js';
/** 本插件的运行时状态（由 index.ts 持有）。 */
export interface ProbeRuntime {
    /** M0 探针是否武装：只有武装时 pre-step 才会改写带 `cosplay-probe-marker` 的消息。 */
    armed: boolean;
    /**
     * 被本插件**改写过**的会话集合。
     *
     * `session/event` 是进程级的（每个会话的每条事件都会经过 observe.ts），所以 durable
     * 观测用这个集合当闸门：只有被我们改写过正文的会话才值得记录"消息到底写成了什么"，
     * 其余会话一条都不记（隐私与噪声都省）。
     */
    touched: Set<string>;
    /** 起过的探针会话 id。 */
    sessions: string[];
}
/** 路由依赖。 */
export interface RouteDeps {
    ctx: Context;
    config: () => CosplayConfig;
    stats: CosplayStats;
    trace: Trace;
    probe: ProbeRuntime;
    library: () => Library;
    state: () => StateStore;
    /** 手动改写用（与 pre-step 同一条实现）。 */
    rewrite: (request: {
        card: CosplayCard;
        input: string;
        sessionId: string;
        signal: AbortSignal;
    }) => Promise<RewriteResult>;
}
/** 只接受回环 Host。 */
export declare function isLoopback(req: IncomingMessage): boolean;
/** 统一 JSON 响应。 */
export declare function sendJson(res: ServerResponse, status: number, payload: unknown): void;
/** 构建这条前缀路由。 */
export declare function createCosplayRoute(deps: RouteDeps): WebRoute;
