/**
 * dsh-cosplay — durable 事件观测（host，诊断用）。
 *
 * 存在的唯一理由：**证明改写真的落地了**。
 *
 * `agent/pre-step` 的替换结果会被 `dsh-agent-loop` 写成 durable 的 `user/message`
 * 事件（见 `hook.ts` 文件头的源码引用）。这条观测把那个事件抓成一条诊断回执，
 * 于是"模型到底收到了什么"和"会话日志里到底存了什么"是同一份证据 —— 不需要读文件、
 * 也不需要在浏览器里翻。
 *
 * ## 隐私边界（很重要）
 *
 * `session/event` 是**全进程**的（每个会话的每条事件都会经过这里，包括你正在用的这个
 * 会话）。所以这里有一条硬闸：**只记录"本轮探针真正改写过"的会话**
 * （`probe.touched`）。其余会话一条都不记，正文更不会进缓冲。
 */
import { messageOf } from './prompt.js';
/** 回执里正文预览的长度上限。 */
const PREVIEW_CHARS = 300;
/** 把消息里的文本块拼起来（结构化读，不 import llm 包的实现）。 */
function textOf(message) {
    const content = message?.content;
    if (!Array.isArray(content))
        return '';
    let text = '';
    for (const block of content) {
        if (block === null || typeof block !== 'object')
            continue;
        const typed = block;
        if (typed.type === 'text' && typeof typed.text === 'string')
            text += typed.text;
    }
    return text;
}
/** 单行预览。 */
function preview(text) {
    const oneLine = text.replace(/\s+/g, ' ').trim();
    return oneLine.length > PREVIEW_CHARS ? `${oneLine.slice(0, PREVIEW_CHARS)}…（共 ${text.length} 字）` : oneLine;
}
/** 取一个可选的会话事件字段（只接受有限数字）。 */
function numberField(data, key) {
    const value = data[key];
    return typeof value === 'number' && Number.isFinite(value) ? { [key]: value } : {};
}
/**
 * 装上 durable 观测。
 * @returns disposer（挂 fiber 上，停用即撤）。
 */
export function installDurableObserver(ctx, deps) {
    const listener = (session, event) => {
        try {
            const sessionId = String(session?.id ?? '');
            if (sessionId === '' || !deps.probe.touched.has(sessionId))
                return;
            const type = String(event?.type ?? '');
            const seq = typeof event?.seq === 'number' ? event.seq : undefined;
            const data = (event?.data ?? {});
            if (type === 'user/message') {
                const message = data;
                const text = textOf(message);
                deps.stats.durableUserMessages += 1;
                deps.trace.push({
                    kind: 'host:durable-user-message',
                    sessionId,
                    ...(typeof message.id === 'string' ? { id: message.id } : {}),
                    ...numberField(data, 'turn'),
                    note: `seq=${seq ?? '?'} 正文=${text.length}字 预览：${preview(text)}`,
                });
                return;
            }
            if (type === 'assistant/message') {
                const text = textOf(data.message);
                deps.trace.push({
                    kind: 'host:assistant-message',
                    sessionId,
                    ...numberField(data, 'turn'),
                    note: `seq=${seq ?? '?'} step=${String(data.step ?? '?')} 正文=${text.length}字 预览：${preview(text)}`,
                });
                return;
            }
            if (type === 'assistant/attempt') {
                deps.trace.push({
                    kind: 'host:assistant-attempt',
                    sessionId,
                    ...numberField(data, 'turn'),
                    note: `seq=${seq ?? '?'} 未提交任何消息的模型尝试（失败/取消/重试）fields=[${Object.keys(data).sort().join(',')}]`,
                });
                return;
            }
            if (type === 'turn/end') {
                deps.trace.push({
                    kind: 'host:turn-end',
                    sessionId,
                    ...numberField(data, 'turn'),
                    note: `seq=${seq ?? '?'} fields=[${Object.keys(data).sort().join(',')}]` +
                        ('error' in data ? ` error=${messageOf(data.error)}` : ''),
                });
            }
        }
        catch (error) {
            // 观测绝不能影响会话。
            deps.trace.push({ kind: 'host:observe-error', note: `durable 观测抛错（已吞）：${messageOf(error)}` });
        }
    };
    // `ctx.on` 返回的 disposer 已归属当前 fiber，插件卸载会自动摘掉。
    return ctx.on('session/event', listener);
}
//# sourceMappingURL=observe.js.map