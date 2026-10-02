/**
 * dsh-cosplay — 设置来源的**延迟绑定句柄**（纯模块，浏览器半边用；host 侧不碰）。
 *
 * 放在 `src/` 而不是 `src/client/` 是刻意的：`tsconfig.build.json` 只编译 `src/*.ts`，
 * 于是这个文件能被 node 直接 import 进单测，而 `src/client/**` 由 tsdown 单独打包。
 *
 * ## 为什么需要"延迟绑定"
 *
 * 客户端设置服务（`ctx.configForms`）在 0.1.7+ 才叫这个名字，而且**可能整个不存在**；
 * 更糟的是把它写进顶层 `inject` 会让 cordis loader 永久 pending
 * （实测：`web boot: 1 entry did not activate`，整个应用打不开）。
 *
 * 所以这里给一个**自己就是合法设置来源**的句柄：
 *   - 没挂上真服务时快照恒为 `unavailable`、`value` 是 `undefined`，读值的地方本来就回落到
 *     `DEFAULT_CONFIG`，所以插件照常工作；
 *   - `attach(live)` 之后读与订阅透传给真服务，并主动通知一次订阅者。
 */
/**
 * 未挂载时的固定快照。
 *
 * 必须是**冻结的同一个引用** —— `useSyncExternalStore` 每次渲染读快照，
 * 每次都返回新对象会让 React 认定 store 一直在变，从而死循环。
 */
const UNAVAILABLE_SNAPSHOT = Object.freeze({
    status: 'unavailable',
    value: undefined,
    base: undefined,
    user: undefined,
    revision: undefined,
    writable: false,
    mode: 'memory',
});
/** 建一个延迟绑定句柄。 */
export function createLazyScope() {
    let live = null;
    let detachLive = null;
    let current = UNAVAILABLE_SNAPSHOT;
    const listeners = new Set();
    const emit = () => {
        for (const listener of [...listeners])
            listener();
    };
    return {
        get attached() {
            return live !== null;
        },
        getSnapshot() {
            return live === null ? UNAVAILABLE_SNAPSHOT : current;
        },
        subscribe(listener) {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },
        // 未挂载时一律 `false`（调用方本来就会回落默认值）；挂载后透传真服务。
        async set(field, value) {
            return live === null ? false : await live.set(field, value);
        },
        async unset(field) {
            return live === null ? false : await live.unset(field);
        },
        async mutate(ops, expectedRevision) {
            return live === null ? false : await live.mutate(ops, expectedRevision);
        },
        attach(next) {
            detachLive?.();
            live = next;
            current = next.getSnapshot();
            detachLive = next.subscribe(() => {
                current = next.getSnapshot();
                emit();
            });
            // 挂载本身也是一次状态变化，必须通知 —— 否则界面会一直停在 unavailable。
            emit();
            return () => {
                detachLive?.();
                detachLive = null;
                live = null;
                current = UNAVAILABLE_SNAPSHOT;
                emit();
            };
        },
    };
}
//# sourceMappingURL=settings-source.js.map