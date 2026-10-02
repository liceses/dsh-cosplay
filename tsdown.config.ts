/**
 * dsh-cosplay — 客户端 bundle 构建（浏览器半边）。
 *
 * 产物形状与 dsh-memes-reply 完全一致（那一条链已在本机 DSH Desktop 0.2.0-rc.1 上真跑通）：
 *  - `lib/client.js` 是一个 **CJS closure**，由 GUI 的 `__ModuleLoader__` 装载：
 *    `window.__ModuleLoader__.load({ id, factory: (require) => { ... } })`；
 *  - 平台模块保持 external，由 loader 的冻结模块表回答；其余依赖一律内联；
 *  - host 半边不在这里构建（`tsc -p tsconfig.build.json` 直出 ESM + d.ts）。
 *
 * ## 模块表白名单（实测，两个运行时逐字相同）
 *
 * 0.1.7-rc.2 与 0.2.0-rc.1 的 web shell 引导 seed 都是这 9 个：
 * ```
 * react, react/jsx-runtime, react-dom, react-dom/client,
 * @deepseek-ai/cordis, @deepseek-ai/dsh-client-store,
 * @deepseek-ai/dsh-client-ui-slots, @deepseek-ai/dsh-client-ui-primitives,
 * @deepseek-ai/dsh-client-ui-dockkit
 * ```
 * 本插件的浏览器半边**只 require 这张表里的东西** —— 会话视图槽位、设置通道、会话输入
 * 机这些能力全部通过 `ctx.<service>` 拿，不 import 它们的运行时入口。这样 bundle 在
 * 任何 DSH 部署里都不会因为"某个包的 client 半边没到"而解析失败。
 */

import type { UserConfig } from 'tsdown'

const ID = 'dsh-cosplay'

/** 由 loader 模块表提供的平台模块（= 两个运行时的 seed，一字不差）。 */
const PLATFORM_MODULES = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-dockkit',
] as const

/** 浏览器 bundle。 */
const clientConfig: UserConfig = {
  name: `${ID}/client`,
  entry: { client: 'src/client/index.tsx' },
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  dts: false,
  sourcemap: true,
  clean: false,
  deps: {
    neverBundle: [...PLATFORM_MODULES],
    // tsdown 0.22 取消了布尔形式（`alwaysBundle: true` 会被归一化成 `[true]`，
    // 一旦出现不在 neverBundle 里的裸导入就抛 "Expected pattern to be a non-empty string"）。
    // 用受支持的 NoExternalFn 谓词把「除平台模块外一律内联」写清楚。
    alwaysBundle: (id: string) => !(PLATFORM_MODULES as readonly string[]).includes(id),
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    'import.meta.env.MODE': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    'import.meta.env': JSON.stringify({ MODE: process.env.NODE_ENV ?? 'production' }),
  },
  outputOptions: {
    entryFileNames: 'client.js',
    banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(ID)}, factory: (require) => {`,
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
}

export default [clientConfig]
