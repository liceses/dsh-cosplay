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

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ART_MIME, artIdFromSha, buildPack, cardToMeta, normalizeCard, parsePack, resolveCardId, sniffImage, type Issue } from './cards.js'
import { DEFAULT_CARD_MODE } from './config.js'
import { dshHome } from './paths.js'
import type { CardMeta, CosplayArt, CosplayCard, CosplayPack, ImportResult } from './types.js'

/** 库文件里真正持久化的形状。 */
interface LibraryFile {
  format: 'dsh-cosplay-library'
  version: 1
  updatedAt: number
  cards: CosplayCard[]
  /**
   * 立绘索引：artId → 元数据。
   *
   * 为什么要持久化它：sha256 是"缓存失效 + 导入去重"的钥匙，而每次启动把
   * 几百 MB 立绘全读一遍算摘要是不可接受的启动成本。索引里有的就信索引，
   * 只有**目录里多出来的文件**（手工拷进来的）才现算。
   */
  art: Record<string, { mime: string; sha256: string; bytes: number }>
}

/** 解析好的路径集合。 */
export interface LibraryPaths {
  root: string
  library: string
  backup: string
  artDir: string
  exportsDir: string
  presetDir: string
}

/** 一份立绘的索引项。 */
export interface ArtEntry {
  artId: string
  mime: string
  sha256: string
  bytes: number
  file: string
}

/** 库依赖。 */
export interface LibraryOptions {
  /** 卡片库根目录；留空 = `<DSH_HOME>/cosplay`。 */
  root: string
  /** 预设目录；默认包内 `presets/`。 */
  presetDir?: string
  /** 时钟（测试可注入）。 */
  now?: () => number
  /**
   * 预设目录指纹的检查间隔（ms，默认 1000）。
   *
   * 预设是**数据**，改文案不该要求重启应用；但每读一次卡片都 stat 一遍目录又太浪费，
   * 所以按间隔节流。测试把它设成 0 就能同步验证热重载。
   */
  presetCheckIntervalMs?: number
  /** 日志。 */
  log?: (message: string) => void
}

/** 卡片库。 */
export interface Library {
  readonly paths: LibraryPaths
  /** 全部卡片（预设在前，自定义按最近更新倒序）。 */
  list(): CosplayCard[]
  get(id: string): CosplayCard | undefined
  /** 元数据投影（页签网格用）。 */
  metas(): CardMeta[]
  /** 新建或更新一张自定义卡。 */
  upsert(raw: unknown): { card: CosplayCard | undefined; issues: Issue[] }
  /** 复制一张卡为新的自定义卡（预设卡改动的唯一正道）。 */
  copyCard(id: string, overrides?: Record<string, unknown>): { card: CosplayCard | undefined; issues: Issue[] }
  remove(id: string): boolean
  /** 存一张立绘（按 sha256 去重），返回可直接写进卡片的引用。 */
  putArt(input: { bytes: Uint8Array; width?: number; height?: number }): { art: CosplayArt | null; issues: Issue[] }
  /** 读一张立绘的字节。 */
  artBytes(artId: string): { bytes: Uint8Array; mime: string; sha256: string } | undefined
  /** 导入一个包。 */
  importPack(raw: unknown): ImportResult
  /** 导出一个包（默认全部）。 */
  exportPack(ids?: readonly string[]): CosplayPack
  /** 把包写到 `exports/`，返回绝对路径。 */
  writeExport(pack: CosplayPack): string
  /** 没有被任何卡片引用的立绘。 */
  orphanArt(): string[]
  /** 清理无引用立绘，返回清掉的数量。 */
  pruneOrphanArt(): number
  /** 存储信息（设置页显示）。 */
  info(): { root: string; cards: number; presets: number; customs: number; artFiles: number; bytes: number }
  /** 丢弃内存缓存，下次读重新落盘（测试用）。 */
  invalidate(): void
}

/** 包内预设目录。 */
export function defaultPresetDir(): string {
  return fileURLToPath(new URL('../presets/', import.meta.url))
}

/** 解析库路径。 */
export function resolveLibraryPaths(root: string, presetDir?: string): LibraryPaths {
  const base = root.trim() === '' ? join(dshHome(), 'cosplay') : root.trim()
  return {
    root: base,
    library: join(base, 'library.json'),
    backup: join(base, 'library.json.bak'),
    artDir: join(base, 'art'),
    exportsDir: join(base, 'exports'),
    presetDir: presetDir ?? defaultPresetDir(),
  }
}

/** 读一个 JSON 文件；失败返回 undefined。 */
function readJson(file: string): unknown {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as unknown
  } catch {
    return undefined
  }
}

/** 原子写：先备份旧内容，再 tmp + rename。 */
function writeAtomic(file: string, text: string): void {
  mkdirSync(dirname(file), { recursive: true })
  try {
    if (existsSync(file)) writeFileSync(`${file}.bak`, readFileSync(file))
  } catch {
    // 备份失败不影响这次写入。
  }
  const tmp = `${file}.tmp`
  writeFileSync(tmp, text, 'utf8')
  renameSync(tmp, file)
}

/** 目录里所有文件的大小和。 */
function dirBytes(dir: string): number {
  let total = 0
  try {
    for (const name of readdirSync(dir)) {
      try {
        total += statSync(join(dir, name)).size
      } catch {
        // 单个文件读不到就算了。
      }
    }
  } catch {
    // 目录不存在 = 0。
  }
  return total
}

/** 扩展名 → mime。 */
function mimeOfFile(file: string): string {
  const ext = extname(file).replace('.', '').toLowerCase()
  for (const [mime, suffix] of Object.entries(ART_MIME)) if (suffix === ext) return mime
  return 'application/octet-stream'
}

/** 建一个卡片库实例。 */
export function createLibrary(options: LibraryOptions): Library {
  const paths = resolveLibraryPaths(options.root, options.presetDir)
  const now = options.now ?? (() => Date.now())
  const log = options.log ?? (() => {})
  const checkInterval = Math.max(0, options.presetCheckIntervalMs ?? 1000)

  /** 自定义卡（id → 卡）。 */
  let customs = new Map<string, CosplayCard>()
  /** 预设卡（id → 卡），启动时读一次；只读。 */
  let presets = new Map<string, CosplayCard>()
  /** 预设文件里声明的顺序（保证卡片网格顺序稳定）。 */
  let presetOrder: string[] = []
  /**
   * 预设目录的"指纹"（文件名 + 大小 + mtime）。
   *
   * 为什么要它：预设卡是**数据**，改文案不该要求重启应用。所以每次读卡片前拿目录指纹
   * 比一下，变了就重载（默认 1 秒最多查一次，热路径成本可忽略）。
   */
  let presetStamp = ''
  /** 上次查指纹的时间（真实时钟；与可注入的 `now()` 无关）。 */
  let presetCheckedAt = 0
  /** 立绘索引（artId → 索引项）。 */
  let art = new Map<string, ArtEntry>()
  /** sha256 → artId（去重）。 */
  let bySha = new Map<string, string>()

  /** 建目录。 */
  function ensureDirs(): void {
    for (const dir of [paths.root, paths.artDir, paths.exportsDir]) {
      try {
        mkdirSync(dir, { recursive: true })
      } catch (error) {
        log(`建目录失败 ${dir}：${String(error)}`)
      }
    }
  }

  /** 扫立绘目录，重建索引（文件名 `<artId>.<ext>`）；索引里已有的不重算 sha256。 */
  function scanArt(known: Record<string, { mime: string; sha256: string; bytes: number }> = {}): void {
    art = new Map()
    bySha = new Map()
    let files: string[] = []
    try {
      files = readdirSync(paths.artDir)
    } catch {
      return // 没有 art 目录 = 没有立绘。
    }
    for (const name of files) {
      const artId = name.replace(/\.[^.]+$/, '')
      const file = join(paths.artDir, name)
      let bytes = 0
      try {
        const info = statSync(file)
        if (!info.isFile()) continue
        bytes = info.size
      } catch {
        continue
      }
      const cached = known[artId]
      let sha256 = ''
      let mime = mimeOfFile(name)
      if (cached !== undefined && cached.bytes === bytes && /^[0-9a-f]{64}$/.test(cached.sha256)) {
        sha256 = cached.sha256
        mime = cached.mime in ART_MIME ? cached.mime : mime
      } else {
        try {
          sha256 = createHash('sha256').update(readFileSync(file)).digest('hex')
        } catch {
          continue
        }
      }
      art.set(artId, { artId, mime, sha256, bytes, file })
      if (sha256 !== '') bySha.set(sha256, artId)
    }
  }

  /** 预设目录的指纹（名字 + 大小 + mtime）。读不到目录返回空串。 */
  function presetStampOf(): string {
    try {
      return readdirSync(paths.presetDir)
        .filter((name) => name.toLowerCase().endsWith('.json'))
        .sort()
        .map((name) => {
          try {
            const info = statSync(join(paths.presetDir, name))
            return `${name}:${info.size}:${Math.trunc(info.mtimeMs)}`
          } catch {
            return `${name}:?`
          }
        })
        .join('|')
    } catch {
      return ''
    }
  }

  /**
   * 预设变了就重载（最多每秒查一次）。
   *
   * 这让"改预设文案"变成一次**纯数据改动**：不需要重启应用、不需要重挂插件 ——
   * 下一次读卡片（页签/详情/绑定/提示段）就会拿到新文案。
   */
  function presetsFresh(): void {
    const nowMs = Date.now()
    if (nowMs - presetCheckedAt < checkInterval) return
    presetCheckedAt = nowMs
    const stamp = presetStampOf()
    if (stamp !== presetStamp) {
      loadPresets()
      log('预设文件有变化 → 已重载（无需重启）')
    }
  }

  /** 读预设目录。 */
  function loadPresets(): void {
    presets = new Map()
    presetOrder = []
    presetStamp = presetStampOf()
    let files: string[] = []
    try {
      files = readdirSync(paths.presetDir).filter((name) => name.toLowerCase().endsWith('.json')).sort()
    } catch {
      log(`预设目录读不到（${paths.presetDir}）—— 只有自定义卡可用`)
      return
    }
    for (const name of files) {
      const raw = readJson(join(paths.presetDir, name))
      if (raw === undefined) {
        log(`预设文件解析失败：${name}`)
        continue
      }
      const parsed = parsePack(raw, { now: now(), avoid: new Set(presets.keys()) })
      for (const card of parsed.cards) {
        const preset: CosplayCard = { ...card, source: 'preset' }
        if (presets.has(preset.id)) {
          log(`预设 id 冲突（${preset.id}）：保留先读到的那个`)
          continue
        }
        presets.set(preset.id, preset)
        presetOrder.push(preset.id)
      }
      if (parsed.issues.length > 0) {
        log(`预设 ${name} 有 ${parsed.issues.length} 条规范化提示：${parsed.issues.map((issue) => `${issue.where}: ${issue.message}`).join('；')}`)
      }
    }
  }

  /** 读自定义卡 + 立绘索引。 */
  function loadCustoms(): { cards: CosplayCard[]; art: LibraryFile['art'] } {
    customs = new Map()
    if (!existsSync(paths.library)) return { cards: [], art: {} }
    const raw = readJson(paths.library)
    if (raw === undefined) {
      const stamp = new Date(now()).toISOString().replace(/[:.]/g, '-')
      const broken = `${paths.library}.corrupt-${stamp}`
      try {
        renameSync(paths.library, broken)
        log(`library.json 解析失败，已隔离到 ${broken}，从空库继续`)
      } catch (error) {
        log(`library.json 解析失败且隔离失败：${String(error)}`)
      }
      return { cards: [], art: {} }
    }
    const parsed = parsePack(raw, { now: now() })
    for (const card of parsed.cards) customs.set(card.id, { ...card, source: 'custom' })
    if (parsed.issues.length > 0) log(`library.json 有 ${parsed.issues.length} 条规范化提示`)
    const artIndex = (raw as Partial<LibraryFile>).art
    return { cards: [...customs.values()], art: artIndex !== null && typeof artIndex === 'object' ? artIndex : {} }
  }

  /**
   * 串行执行一次写操作。
   *
   * 现在 `flush()` 是**同步**的（`writeAtomic` 本身就是同步 tmp+rename），所以这里不再需要
   * 排队 —— 保留这个名字只是为了说明"写路径只有一个"。
   */
  function writeNow(): void {
    flush()
  }

  /** 把自定义卡 + 立绘索引写回磁盘。 */
  function flush(): void {
    const artIndex: LibraryFile['art'] = {}
    for (const [artId, entry] of art) artIndex[artId] = { mime: entry.mime, sha256: entry.sha256, bytes: entry.bytes }
    const file: LibraryFile = {
      format: 'dsh-cosplay-library',
      version: 1,
      updatedAt: now(),
      cards: [...customs.values()],
      art: artIndex,
    }
    writeAtomic(paths.library, `${JSON.stringify(file, null, 2)}\n`)
  }

  /** 全部 id（预设 + 自定义）—— 生成新 id 时用。 */
  function takenIds(): Set<string> {
    presetsFresh()
    return new Set([...presets.keys(), ...customs.keys()])
  }

  /** 卡片排序：预设按预设顺序，自定义按最近更新倒序。 */
  function ordered(): CosplayCard[] {
    const presetCards = presetOrder.map((id) => presets.get(id)).filter((card): card is CosplayCard => card !== undefined)
    const customCards = [...customs.values()].sort((left, right) => right.updatedAt - left.updatedAt || left.id.localeCompare(right.id))
    return [...presetCards, ...customCards]
  }

  // 启动即建目录、读预设、读库、扫立绘（索引里已有的不重算 sha256）。
  ensureDirs()
  loadPresets()
  const loaded = loadCustoms()
  scanArt(loaded.art)

  return {
    paths,

    list() {
      presetsFresh()
      return ordered()
    },

    get(id) {
      presetsFresh()
      return customs.get(id) ?? presets.get(id)
    },

    metas() {
      presetsFresh()
      return ordered().map((card) => cardToMeta(card, card.art === null || card.art === undefined ? '' : card.art.sha256.slice(0, 8)))
    },

    upsert(raw) {
      const value = (raw ?? {}) as { id?: unknown; source?: unknown }
      const id = typeof value.id === 'string' ? value.id.trim().toLowerCase() : ''
      const existingPreset = id !== '' ? presets.get(id) : undefined
      if (existingPreset !== undefined) {
        return { card: undefined, issues: [{ where: 'card.id', message: '预设卡是只读的：请用「复制为自定义」再改（这样插件升级时预设还能更新）' }] }
      }
      const existing = id !== '' ? customs.get(id) : undefined
      const taken = takenIds()
      if (existing !== undefined) taken.delete(existing.id)
      const normalized = normalizeCard({ ...(raw as object), source: 'custom' }, { source: 'custom', taken, now: now() })
      const card: CosplayCard = {
        ...normalized.value,
        ...(existing === undefined ? {} : { createdAt: existing.createdAt }),
        updatedAt: now(),
        source: 'custom',
      }
      customs.set(card.id, card)
      writeNow()
      return { card, issues: normalized.issues }
    },

    copyCard(id, overrides = {}) {
      const source = customs.get(id) ?? presets.get(id)
      if (source === undefined) return { card: undefined, issues: [{ where: 'card.id', message: `卡不存在：${id}` }] }
      const taken = takenIds()
      const name = typeof overrides.name === 'string' && overrides.name.trim() !== '' ? overrides.name : `${source.name}（副本）`
      const card: CosplayCard = {
        ...source,
        ...overrides,
        id: resolveCardId(undefined, name, taken),
        name,
        source: 'custom',
        createdAt: now(),
        updatedAt: now(),
      }
      customs.set(card.id, card)
      writeNow()
      return { card, issues: [] }
    },

    remove(id) {
      const existed = customs.delete(id)
      if (existed) writeNow()
      return existed
    },

    putArt(input) {
      const issues: Issue[] = []
      const sniffed = sniffImage(input.bytes)
      if (sniffed === undefined) {
        return { art: null, issues: [{ where: 'art', message: '字节不是 PNG / JPEG / GIF / WebP（按内容判定，不看声明的 mime）' }] }
      }
      const sha256 = createHash('sha256').update(input.bytes).digest('hex')
      const known = bySha.get(sha256)
      if (known !== undefined) {
        const entry = art.get(known)
        return {
          art: {
            artId: known,
            mime: entry?.mime ?? sniffed,
            bytes: input.bytes.byteLength,
            sha256,
            ...(input.width === undefined ? {} : { width: input.width }),
            ...(input.height === undefined ? {} : { height: input.height }),
          },
          issues,
        }
      }
      const artId = artIdFromSha(sha256)
      const suffix = ART_MIME[sniffed] ?? 'png'
      const file = join(paths.artDir, `${artId}.${suffix}`)
      try {
        ensureDirs()
        writeFileSync(file, input.bytes)
      } catch (error) {
        return { art: null, issues: [{ where: 'art', message: `立绘写盘失败：${String(error)}` }] }
      }
      art.set(artId, { artId, mime: sniffed, sha256, bytes: input.bytes.byteLength, file })
      bySha.set(sha256, artId)
      return {
        art: {
          artId,
          mime: sniffed,
          bytes: input.bytes.byteLength,
          sha256,
          ...(input.width === undefined ? {} : { width: input.width }),
          ...(input.height === undefined ? {} : { height: input.height }),
        },
        issues,
      }
    },

    artBytes(artId) {
      const entry = art.get(artId)
      if (entry === undefined) return undefined
      try {
        return { bytes: new Uint8Array(readFileSync(entry.file)), mime: entry.mime, sha256: entry.sha256 }
      } catch {
        return undefined
      }
    },

    importPack(raw) {
      // `avoid` 只作用于**派生 id** 的卡（包里没写 id 的那些）：它们必须避开已有库与预设，
      // 于是永远不会顶掉别人；写了 id 的卡则按 id 覆盖（同一个包导两次 = 同一批卡更新）。
      const parsed = parsePack(raw, { now: now(), avoid: new Set([...customs.keys(), ...presets.keys()]) })
      const errors = parsed.issues.map((issue) => `${issue.where}: ${issue.message}`)
      // "跳过" = 解析阶段就没能成卡的那些（缺 name / 结构不对）。
      let skipped = parsed.issues.filter((issue) => issue.message.includes('已跳过')).length
      let added = 0
      let replaced = 0
      /** 本轮导入里 artId 的重映射（包内 artId → 本地 artId）。 */
      const remap = new Map<string, string>()
      const inlineArt = parsed.art

      for (const card of parsed.cards) {
        // 立绘：把内联字节落盘（按 sha256 去重），并重写引用。
        let artRef = card.art
        if (artRef !== null && artRef !== undefined) {
          const inline = inlineArt[artRef.artId]
          if (inline === undefined) {
            errors.push(`card ${card.id}: 声明了立绘 ${artRef.artId} 但包里没有对应字节，已按无立绘导入`)
            artRef = null
          } else {
            const existingRemap = remap.get(artRef.artId)
            if (existingRemap !== undefined) {
              artRef = { ...artRef, artId: existingRemap }
            } else {
              const stored = this.putArt({
                bytes: new Uint8Array(Buffer.from(inline.base64, 'base64')),
                ...(inline.width === undefined ? {} : { width: inline.width }),
                ...(inline.height === undefined ? {} : { height: inline.height }),
              })
              if (stored.art === null) {
                errors.push(`card ${card.id}: 立绘落盘失败（${stored.issues.map((issue) => issue.message).join('；')}）`)
                artRef = null
              } else {
                remap.set(artRef.artId, stored.art.artId)
                artRef = stored.art
              }
            }
          }
        }

        const presetHit = presets.get(card.id)
        if (presetHit !== undefined) {
          // 与预设撞 id：**稳定地**改名成 `<id>-custom` 后作为自定义卡导入（绝不覆盖预设）。
          // 用固定后缀而不是随机/递增 id，是为了"同一个包导两次"落到同一张卡上（覆盖而非堆叠）。
          const stableId = `${card.id}-custom`.slice(0, 40)
          const targetId = resolveCardId(stableId, card.name, takenIds())
          const existingCustom = customs.get(stableId)
          const fresh = {
            ...card,
            id: existingCustom !== undefined ? stableId : targetId,
            art: artRef,
            source: 'custom' as const,
            createdAt: existingCustom?.createdAt ?? card.createdAt,
            updatedAt: now(),
          }
          customs.set(fresh.id, fresh)
          existingCustom === undefined ? (added += 1) : (replaced += 1)
          errors.push(`card ${card.id}: 与预设卡同名 id，已改名导入为 ${fresh.id}`)
          continue
        }
        const existing = customs.get(card.id)
        const next: CosplayCard = {
          ...card,
          art: artRef,
          source: 'custom',
          createdAt: existing?.createdAt ?? card.createdAt,
          updatedAt: now(),
        }
        customs.set(next.id, next)
        existing === undefined ? (added += 1) : (replaced += 1)
      }

      if (added + replaced > 0) {
        // 立绘落盘后把索引一起写回（flush 里带着当前的 art 索引）。
        writeNow()
      }
      return { ok: added + replaced > 0, added, replaced, skipped, errors }
    },

    exportPack(ids) {
      const all = ordered()
      const wanted = ids === undefined || ids.length === 0 ? all : all.filter((card) => ids.includes(card.id))
      return buildPack(wanted, (artId) => this.artBytes(artId), now())
    },

    writeExport(pack) {
      ensureDirs()
      const stamp = new Date(now()).toISOString().replace(/[:.]/g, '-')
      const file = join(paths.exportsDir, `cosplay-${stamp}.json`)
      writeFileSync(file, `${JSON.stringify(pack, null, 2)}\n`, 'utf8')
      return file
    },

    orphanArt() {
      const used = new Set<string>()
      for (const card of customs.values()) if (card.art !== null && card.art !== undefined) used.add(card.art.artId)
      for (const card of presets.values()) if (card.art !== null && card.art !== undefined) used.add(card.art.artId)
      return [...art.keys()].filter((artId) => !used.has(artId))
    },

    pruneOrphanArt() {
      const orphans = this.orphanArt()
      for (const artId of orphans) {
        const entry = art.get(artId)
        if (entry === undefined) continue
        try {
          rmSync(entry.file, { force: true })
        } catch {
          // 删不掉就留着，下次再说。
        }
        art.delete(artId)
        bySha.delete(entry.sha256)
      }
      return orphans.length
    },

    info() {
      presetsFresh()
      return {
        root: paths.root,
        cards: presets.size + customs.size,
        presets: presets.size,
        customs: customs.size,
        artFiles: art.size,
        bytes: dirBytes(paths.root),
      }
    },

    invalidate() {
      loadPresets()
      const again = loadCustoms()
      scanArt(again.art)
    },
  }
}

/** 兜底：把一个库文件读成卡片数组（测试与迁移用）。 */
export function readLibraryFile(file: string): CosplayCard[] {
  const raw = readJson(file)
  if (raw === undefined) return []
  return parsePack(raw).cards
}

/** 供测试构造一张最小卡。 */
export function minimalCard(overrides: Partial<CosplayCard> & { name: string }): CosplayCard {
  const normalized = normalizeCard({ mode: DEFAULT_CARD_MODE, persona: '测试人设', ...overrides }, { source: 'custom' })
  return normalized.value
}

/** 立绘目录（诊断用）。 */
export function artDirOf(paths: LibraryPaths): string {
  return paths.artDir
}
