/**
 * dsh-cosplay — 角色卡的数据层（**纯函数，host 与浏览器半边共用**）。
 *
 * 这个文件是"分享/导入导出"的唯一权威：一个包能不能进库、一张卡长什么样，
 * 全部由这里的规范化决定。两条纪律：
 *
 * 1. **绝不抛**：外部输入（用户手改的 JSON、别人发来的包）一律走 `normalizeCard` /
 *    `validatePack`，把问题收进 `errors[]`，能修的修（裁剪、补默认值），不能修的拒绝。
 *    "导入一个坏包把插件搞崩"是不可接受的失败模式。
 * 2. **规范化是幂等的**：`normalize(normalize(x)) === normalize(x)`，这样"读了写、写了读"
 *    不会每次都产生新 diff（有单测盯着）。
 *
 * 这里**不能** import `node:*`（浏览器半边要用），所以 id 摘要用纯 JS 的 FNV-1a；
 * 立绘字节的 sha256 在 host 侧的 `library.ts` 里算。
 */
import type { CardMeta, CosplayCard, CosplayPack } from './types.js';
/** 卡片的硬上限（超出即裁剪，并在 `errors` 里留一句）。 */
export declare const CARD_LIMITS: {
    readonly name: 24;
    readonly title: 40;
    readonly description: 120;
    readonly tags: 8;
    readonly tag: 12;
    readonly persona: 20000;
    readonly rules: 20000;
    readonly examples: 4;
    readonly exampleChars: 4000;
    /**
     * 尾部回声（`tailLine`）的字数上限。
     *
     * 为什么这么短：这是往系统提示词**最末尾**放的那一句"角色声音"重申。
     * 首尾各说一次只在"**一条**关键约束 + **逐字**"时才有效 —— 一长段就变成
     * 新的规则堆（优先级信号消失），还可能和开头那句被读成两条冲突约束。
     */
    readonly tailLine: 200;
};
/** 允许的立绘 MIME。 */
export declare const ART_MIME: Readonly<Record<string, string>>;
/** 一条问题（给人看的）。 */
export interface Issue {
    /** 出问题的字段/位置（`cards[2].name` 这种）。 */
    where: string;
    message: string;
}
/** 规范化结果。 */
export interface Normalized<T> {
    value: T;
    issues: Issue[];
}
/** 裁剪字符串：去首尾空白 + 限长。 */
export declare function clampText(value: unknown, max: number): string;
/** 纯 JS FNV-1a（32 位，够做 id 摘要；与 sha256 无关，别混用）。 */
export declare function fnv1a(text: string): string;
/** 由名字生成 id：ASCII 优先，纯中文等则退到摘要。 */
export declare function cardIdFromName(name: string): string;
/** 立绘 id（sha256 前 16 位）。 */
export declare function artIdFromSha(sha256: string): string;
/** 合法卡 id 判定（小写字母数字与连字符）。 */
export declare function isCardId(value: unknown): value is string;
/** 取 id：已有合法 id 就沿用，否则由名字生成，最后兜一个随机尾巴保证唯一。 */
export declare function resolveCardId(raw: unknown, name: string, taken: ReadonlySet<string>): string;
/**
 * 解析一张卡最终用哪个 id。
 *
 * **显式 id 是身份，派生 id 只是占位** —— 这条区分决定了"导入同一个包两次"的结果：
 *
 * - 包里写了 `id` → 沿用（同 id 就是同一张卡，导入即覆盖）；
 * - 包里没写 id → 由名字派生，并且必须避开 `avoid`（已有库 + 预设 + 同批），
 *   于是永远不会顶掉别人。
 */
export declare function resolveCardIdFor(raw: unknown, name: string, taken: ReadonlySet<string>, avoid: ReadonlySet<string>): string;
/** 规范化一张卡。 */
export declare function normalizeCard(raw: unknown, options?: {
    source?: 'preset' | 'custom';
    taken?: ReadonlySet<string>;
    avoid?: ReadonlySet<string>;
    now?: number;
    where?: string;
}): Normalized<CosplayCard>;
/**
 * 尾部回声的正文（纯函数，便于单测）。
 *
 * 三级取法，**插件自己绝不造句子**：
 *   1. 作者显式写的 `tailLine`；
 *   2. 否则逐字取 `persona` 的**第一句非标题行**（跳过 `#` 开头的 Markdown 标题、
 *      `【` 开头的分节标题、`---` 分隔线）—— 那是作者自己的原话；
 *   3. 都没有 → 空串（调用方据此**不加任何东西**，绝不用通用系统腔填充）。
 *
 * 为什么坚持"逐字"：首尾各说一次只在两次**字面相同**时才被读成同一条约束；
 * 换一种说法会被模型当成**第二条冲突约束**（这是"关键指令首尾复述"这个模式的已知边界）。
 */
export declare function echoTextOf(card: CosplayCard): string;
/** 元数据投影（`/library` 用：不带 persona/rewrite 正文，省带宽也省隐私面）。 */ export declare function cardToMeta(card: CosplayCard, artRev: string): CardMeta;
/** 包解析结果。 */
export interface ParsedPack {
    cards: CosplayCard[];
    /** artId → 内联字节。 */
    art: Record<string, {
        mime: string;
        base64: string;
        sha256: string;
        width?: number;
        height?: number;
    }>;
    issues: Issue[];
}
/**
 * 解析一个包/库文件。
 *
 * 宽容度刻意设成这样：`cards` 必须是数组（否则整体拒绝），单张卡坏掉只跳过它并记一条，
 * 这样"别人的包里有 9 张好卡 + 1 张坏卡"不会让你一张都拿不到。
 *
 * @param options.taken - 同一个包里已经用掉的 id（内部维护，调用方一般不用传）。
 * @param options.avoid - **派生 id** 必须避开的名字集合（已有库 + 预设）；显式 id 不受它影响。
 */
export declare function parsePack(raw: unknown, options?: {
    now?: number;
    taken?: ReadonlySet<string>;
    avoid?: ReadonlySet<string>;
}): ParsedPack;
/** 组装一个包（立绘字节由调用方提供 `getArtBytes`）。 */
export declare function buildPack(cards: readonly CosplayCard[], getArtBytes: (artId: string) => {
    bytes: Uint8Array;
    mime: string;
    sha256: string;
} | undefined, now?: number): CosplayPack;
/** Uint8Array → base64（浏览器与 node 都能用，不引 Buffer）。 */
export declare function bytesToBase64(bytes: Uint8Array): string;
/** base64 → Uint8Array（宿主侧用 `Buffer` 更快，这里保持一致实现）。 */
export declare function base64ToBytes(base64: string): Uint8Array;
/** 判断字节是否真的是那张图（不信任 mime 声明）。 */
export declare function sniffImage(bytes: Uint8Array): keyof typeof ART_MIME | undefined;
