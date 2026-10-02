/**
 * dsh-cosplay — 卡片库的磁盘层（**host only**）。
 *
 * ## 布局
 *
 * ```
 * <DSH_HOME>/cosplay/
 *   library.json          # 只存**自定义卡**（预设卡随包走，不落进去）
 *   library.json.bak      # 上一次成功写入的副本
 *   art/<artId>.<ext>     # 立绘字节，按 sha256 去重
 *   state.json            # 会话绑定 / 开关 / 改写记录（见 state.ts）
 *   exports/              # /export/write 的落点
 * ```
 *
 * ## 三条纪律
 *
 * 1. **预设卡只读**：它们从包目录 `presets/*.json` 现场读，不进 library.json。
 *    改预设 = "复制为自定义"（`copyCard` 生成新 id）。于是升级插件时预设会更新，
 *    而你的自定义卡一张都不会被覆盖。
 * 2. **坏库不许把插件带走**：解析失败的 library.json 会被改名成
 *    `library.json.corrupt-<ts>` 留证，然后从预设重建 —— 用户丢的是"哪张卡坏了"的
 *    提示，而不是整个插件。
 * 3. **写是一次原子替换**：同目录 `.tmp` + `renameSync`，且替换前把旧内容写成 `.bak`。
 *    所有写操作串行化（一个 promise 链），并发请求不会互相踩。
 */
import { type Issue } from './cards.js';
import type { CardMeta, CosplayArt, CosplayCard, CosplayPack, ImportResult } from './types.js';
/** 解析好的路径集合。 */
export interface LibraryPaths {
    root: string;
    library: string;
    backup: string;
    artDir: string;
    exportsDir: string;
    presetDir: string;
}
/** 一份立绘的索引项。 */
export interface ArtEntry {
    artId: string;
    mime: string;
    sha256: string;
    bytes: number;
    file: string;
}
/** 库依赖。 */
export interface LibraryOptions {
    /** 卡片库根目录；留空 = `<DSH_HOME>/cosplay`。 */
    root: string;
    /** 预设目录；默认包内 `presets/`。 */
    presetDir?: string;
    /** 时钟（测试可注入）。 */
    now?: () => number;
    /**
     * 预设目录指纹的检查间隔（ms，默认 1000）。
     *
     * 预设是**数据**，改文案不该要求重启应用；但每读一次卡片都 stat 一遍目录又太浪费，
     * 所以按间隔节流。测试把它设成 0 就能同步验证热重载。
     */
    presetCheckIntervalMs?: number;
    /** 日志。 */
    log?: (message: string) => void;
}
/** 卡片库。 */
export interface Library {
    readonly paths: LibraryPaths;
    /** 全部卡片（预设在前，自定义按最近更新倒序）。 */
    list(): CosplayCard[];
    get(id: string): CosplayCard | undefined;
    /** 元数据投影（页签网格用）。 */
    metas(): CardMeta[];
    /** 新建或更新一张自定义卡。 */
    upsert(raw: unknown): {
        card: CosplayCard | undefined;
        issues: Issue[];
    };
    /** 复制一张卡为新的自定义卡（预设卡改动的唯一正道）。 */
    copyCard(id: string, overrides?: Record<string, unknown>): {
        card: CosplayCard | undefined;
        issues: Issue[];
    };
    remove(id: string): boolean;
    /** 存一张立绘（按 sha256 去重），返回可直接写进卡片的引用。 */
    putArt(input: {
        bytes: Uint8Array;
        width?: number;
        height?: number;
    }): {
        art: CosplayArt | null;
        issues: Issue[];
    };
    /** 读一张立绘的字节。 */
    artBytes(artId: string): {
        bytes: Uint8Array;
        mime: string;
        sha256: string;
    } | undefined;
    /** 导入一个包。 */
    importPack(raw: unknown): ImportResult;
    /** 导出一个包（默认全部）。 */
    exportPack(ids?: readonly string[]): CosplayPack;
    /** 把包写到 `exports/`，返回绝对路径。 */
    writeExport(pack: CosplayPack): string;
    /** 没有被任何卡片引用的立绘。 */
    orphanArt(): string[];
    /** 清理无引用立绘，返回清掉的数量。 */
    pruneOrphanArt(): number;
    /** 存储信息（设置页显示）。 */
    info(): {
        root: string;
        cards: number;
        presets: number;
        customs: number;
        artFiles: number;
        bytes: number;
    };
    /** 丢弃内存缓存，下次读重新落盘（测试用）。 */
    invalidate(): void;
}
/** 包内预设目录。 */
export declare function defaultPresetDir(): string;
/** 解析库路径。 */
export declare function resolveLibraryPaths(root: string, presetDir?: string): LibraryPaths;
/** 建一个卡片库实例。 */
export declare function createLibrary(options: LibraryOptions): Library;
/** 兜底：把一个库文件读成卡片数组（测试与迁移用）。 */
export declare function readLibraryFile(file: string): CosplayCard[];
/** 供测试构造一张最小卡。 */
export declare function minimalCard(overrides: Partial<CosplayCard> & {
    name: string;
}): CosplayCard;
/** 立绘目录（诊断用）。 */
export declare function artDirOf(paths: LibraryPaths): string;
