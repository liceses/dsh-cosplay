/**
 * dsh-cosplay — 插件自有状态（`<库根>/state.json`，**host only**）。
 *
 * 只存"人按过开关"和"发生过什么"两件事：
 *   - `sessions[sessionId] = { cardId, enabled }` —— 本会话绑了哪张卡、有没有被关掉；
 *   - `rewrites[sessionId] = [ …最近 20 条… ]` —— 改写诊断（模型 / 耗时 / 字数 / 失败原因 /
 *     原文 / 上下文用量；把原文留档，是为了"任务主体被换掉"能在 5 秒内被看出来）；
 *   - `global.lastCardId` —— 最后一次成功绑定的卡（新会话据此自动预选，"换会话不换角色"）。
 *
 * 三条纪律：
 * 1. **坏文件一律当空状态**：一个 json 坏掉绝不能让插件起不来。
 * 2. **原子写**：同目录 tmp + rename（与库文件同款）。
 * 3. **有界**：改写记录每会话 20 条、总量 50 个会话；`preview` 截断 400 字 ——
 *    诊断数据不该长成一个没人管的数据库（正文本身已经在会话日志里了，不必重存）。
 */
import type { CosplayState, RewriteRecord, SessionBinding } from './types.js';
/** 每会话保留的改写记录条数。 */
export declare const REWRITES_PER_SESSION = 20;
/** 保留改写记录的会话数上限（超出丢最久没更新的）。 */
export declare const REWRITE_SESSIONS = 50;
/** 每个会话记住"用过哪几张卡"的上限（够判断"换过卡"，不必留全史）。 */
export declare const CARD_SEEN_LIMIT = 4;
/** 空状态。 */
export declare function emptyState(): CosplayState;
/** 宽松解析：任何异常都退化成空状态。 */
export declare function parseState(raw: unknown): CosplayState;
/** 状态仓库。 */
export interface StateStore {
    readonly file: string;
    /** 取整份状态（内存里的一份，直接读）。 */
    read(): CosplayState;
    /** 取某会话的绑定（没有就 undefined）。 */
    binding(sessionId: string): SessionBinding | undefined;
    /** 写某会话的绑定（只写传进来的字段）。 */
    setBinding(sessionId: string, patch: {
        cardId?: string | null;
        enabled?: boolean;
    }): SessionBinding;
    /** 清掉某会话的绑定（会话被删/重置时用）。 */
    clearBinding(sessionId: string): void;
    /** 记一条改写。 */
    recordRewrite(sessionId: string, record: Omit<RewriteRecord, 'preview'> & {
        preview: string;
    }): void;
    /** 读某会话的改写记录（最新在前）。 */
    rewritesOf(sessionId: string, limit?: number): RewriteRecord[];
    /** 最后一次成功绑定的卡 id（新会话据此自动预选；空 = 没有）。 */
    lastCardId(): string;
    /** 立即落盘（写操作已自动串行化，这里给诊断/关闭路径用）。 */
    save(): void;
}
/** 建状态仓库。 */
export declare function createState(file: string, now?: () => number): StateStore;
