/**
 * dsh-cosplay — 诊断轨迹（环形缓冲，宿主内存，不落盘）。
 *
 * 为什么必须存在：**浏览器控制台宿主看不到**，而"客户端 bundle 到底加载了没 / 页签注册
 * 成功没 / pre-step 到底改没改"这些结论只能由两端往里写回执、再用 `/trace` 一次读全。
 * 这是 dsh-memes-reply 用一整轮事故换来的纪律（见其 README「诊断」一节）。
 */
/** 单条 note 的截断上限（防止一次回执把环形缓冲冲掉）。 */
const NOTE_LIMIT = 2000;
/**
 * 建一个环形轨迹。
 * @param capacity - 容量；`<= 0` 时退化成 1（不让插件因为配置手滑而崩）。
 */
export function createTrace(capacity) {
    const limit = Math.max(1, Math.floor(capacity));
    const ring = [];
    return {
        push(entry) {
            const note = entry.note.length > NOTE_LIMIT ? `${entry.note.slice(0, NOTE_LIMIT)}…（截断，原文 ${entry.note.length} 字）` : entry.note;
            ring.push({
                at: typeof entry.at === 'number' && Number.isFinite(entry.at) ? entry.at : Date.now(),
                kind: entry.kind,
                ...(entry.sessionId === undefined ? {} : { sessionId: entry.sessionId }),
                ...(entry.turn === undefined ? {} : { turn: entry.turn }),
                ...(entry.id === undefined ? {} : { id: entry.id }),
                note,
            });
            if (ring.length > limit)
                ring.splice(0, ring.length - limit);
        },
        list(count) {
            const take = count === undefined || !Number.isFinite(count) || count <= 0 ? limit : Math.min(Math.floor(count), limit);
            // 最新的在前（面板/探针脚本都按这个约定读）。
            return ring.slice(-take).reverse();
        },
        size: () => ring.length,
        capacity: () => limit,
    };
}
//# sourceMappingURL=trace.js.map