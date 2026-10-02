/**
 * dsh-cosplay — 诊断轨迹（环形缓冲，宿主内存，不落盘）。
 *
 * 为什么必须存在：**浏览器控制台宿主看不到**，而"客户端 bundle 到底加载了没 / 页签注册
 * 成功没 / pre-step 到底改没改"这些结论只能由两端往里写回执、再用 `/trace` 一次读全。
 * 这是 dsh-memes-reply 用一整轮事故换来的纪律（见其 README「诊断」一节）。
 */
import type { TraceEntry } from './types.js';
/** 环形轨迹。 */
export interface Trace {
    push(entry: Omit<TraceEntry, 'at'> & {
        at?: number;
    }): void;
    list(limit?: number): TraceEntry[];
    size(): number;
    capacity(): number;
}
/**
 * 建一个环形轨迹。
 * @param capacity - 容量；`<= 0` 时退化成 1（不让插件因为配置手滑而崩）。
 */
export declare function createTrace(capacity: number): Trace;
