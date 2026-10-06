# dsh-cosplay

让 DSH 里的模型**进入角色**：用「角色卡」规定它的身份、语气与提示词风格。

两条链路都实现，**卡里可选**：

| 链路 | 落点 | 适合谁 |
| --- | --- | --- |
| **人设注入** | 系统提示段 `dsh-cosplay:persona` | 猫娘这类"人设卡"：你正常说话，模型以角色身份作答 |
| **提示词改写** | `agent/pre-step` 替换用户消息 | 硬邦邦这类"改写卡"：你发一句，模型收到的是按规则重写后的 prompt |

入口是聊天区顶部的**「角色」页签**（就在「对话 / 轨迹」旁边）：卡片网格 → 点一张进二级详情 → 在本会话使用。

---

## 两条链路的机制（都已实测，不是设计稿）

**人设注入**：`ctx.systemPrompt.section({ name, order: 部署人设+1, interpolate: false, text })`。
实测证据（真实运行环境）：`host:prompt-section section=dsh-cosplay:persona order=1 agentId=session-… typeof=string`
—— 装配上下文里拿得到会话 id，所以"每个会话各自一张卡"成立。
`interpolate: false` 是**必须**的：卡片正文是你写的，出现 `{{…}}` 时默认的严格插值会抛错并让整次装配失败。

**提示词改写**：`agent/pre-step` 是官方唯一能在模型看到之前替换用户消息的通道，而替换后的消息会被
`dsh-agent-loop` 真实地 durable 写成 `user/message`（`lib/index.js:1061`）。实测证据：

```
host:pre-step-plan     按「硬邦邦」改写：原文 10 字（mode=rewrite strategy=card）
host:rewrite-ok        8327ms · deepseek-official/deepseek-flash · 10 字 → 571 字
host:durable-user-message seq=10 正文=571字 预览：老哥们，我时间金钱不多了，agent team 这次算了…
```

也就是说：**「对话」里那条用户消息本身就是改写后的 prompt**，模型收到的与日志逐字一致 ——
不需要另做一层"实际发送了什么"的黑箱展示。

### 改写调用**必须带上下文**（否则会把任务主体换掉）

改写调用是**无状态**的：它只拿到"这一轮原文"和"卡片规则"。于是（真实事故，
`session-cf7b1365`，2026-10-02 02:35）：

| | |
|---|---|
| 用户原话（`agent/inbox/spliced`） | 兄弟 太夯了 ，看的我硬邦邦！！！ 想让更多人硬邦邦，**把这个**提交到我的仓库吧！！直接新创一个！ |
| 上一轮真实交付物（`assistant/message`） | 搞完了。## 东西在哪 - 页面本体：**miku/index.html** |
| 当时的改写结果 | 任务：把我这套**硬邦邦的肌肉集团提示词转换器**直接新创一个 GitHub 仓库… |

"这个"没有指代对象 —— 而改写调用上下文里**唯一存在的名词就是卡片规则本身**（"硬邦邦提示词转换专家"），
模型于是合理地把它填了进去，主模型随后真的去建了一个**错的**仓库。

修法（`src/context.ts`）：改写时从**官方 surface**（`agent.session.surface.nodes` → `session.eventAt`，
与 `dsh-compaction-basic` 取摘要输入的同一组 API）取最近 **≤6 条 / ≤2400 字**的"人话 + 助手话"
（排除 skills / runtime-context / tool-jobs / agent-message 等框架注入与子代理播报），
组装成一条分区明确的 user 消息：`【最近对话（只读）】… 【本轮要改写的原始需求（只改这一段）】原文`。
另外加一条**指代守卫**：原文含"这个 / 它 / 上一轮"这类指代、又拿不到上下文时**跳过改写**、原样放行 ——
无法解析指代时改写必然瞎猜主体，保留原文至少不会把任务改错。

轨迹里会留下 `host:rewrite-context 带上下文 N 条 / M 字（原文 … 字，组装后 … 字）`，
没有上下文而跳过时留 `host:rewrite-skip-unresolved`（真实数值见下节「验证记录」）。

---

## 安装

**前提：装完要重挂插件（宿主半边）**；只改浏览器半边时刷新页面即可。

```bash
# 方式一：本地链接（开发用）
npm install && npm run build
dsh plugin --profile web add "link:D:\developing\DSH-plugin\dsh-cosplay"

# 方式二：GitHub（lib/ 已入库，免编译）
dsh plugin --profile web add github:<you>/dsh-cosplay
```

> **DSH Desktop 用户**：`desktop` profile 由 Electron 独占管理，命令行会被拒绝，
> 请在**设置 → 插件**界面填仓库地址（或本地路径）。

没网时：`node scripts/link-sdk.mjs` 把 `node_modules/@deepseek-ai/*` 指向本机 SDK 镜像，
`npx tsc --noEmit` 与 `npm run build` 照样能跑（只需要 typescript 与 tsdown 在本地）。

---

## 快速上手

**新建会话的第一屏就能选角**：输入框左下角（`+` / 权限 / 模式 那一排）有一个 `🎭 无角色` 胶囊 ——
点它弹出卡片列表，选一张，然后直接发第一句话。第二轮开始顶部才会出现
「对话 / 轨迹 / **角色**」页签，那里是卡片管理面（网格 / 二级详情 / 编辑 / 立绘 / 导入导出）。

> **为什么入口在输入框而不是页签**：DSH 的**空白会话不渲染页签条**
> （`dsh-client-ui-conversation`：`showTabs = !hideChrome && …`，空白态 `hideChrome = blank`；
> 视图区在 blank 阶段直接 `return null`）。所以"打开角色页签再选角"对**第一轮**根本不成立 ——
> chip 就是为这件事存在的：它随会话视图挂载，**在你敲字之前就把"本会话用哪张卡"写进宿主**。

1. **新建会话 → 点 chip → 选一张卡 → 发第一句话**（实测首轮就带角色：回复以「喵~」结尾）；
2. 正常说话：
   - 人设卡（如「赛博猫娘」）：回复以角色口吻作答；
   - 改写卡（如「硬邦邦」）：你发的「画一张秦始皇骑北极熊」在日志里就变成了那篇暴躁甲方 prompt；
3. 想停：chip 里的「本会话停用」／详情页「本会话停用」／命令 `/cosplay off`（**零 token**）；
4. 想每个新会话都自动上角色：什么都不用配 —— 你**上次选过的那张卡**会被新会话自动继承
   （`lastCardId`）；想固定成另一张就配 **设置 → 角色扮演 → 默认角色**。
   换卡时会提示"会话里换过卡、旧口吻还在历史里"，想从干净上下文开始角色就开个新会话。

命令是界面出问题时的逃生阀：

| 命令 | 作用 |
| --- | --- |
| `/cosplay` | 状态（总开关 / 策略 / 本会话角色 / 库统计 / 最近改写） |
| `/cosplay list [关键词]` | 卡片清单 |
| `/cosplay on` \| `off` | 本会话开 / 关 |
| `/cosplay none` | 本会话取消角色 |
| `/cosplay <id \| 名字>` | 本会话换上这张卡 |

---

## 角色卡的数据结构

一张卡（`CosplayCard`）的字段与上限：

| 字段 | 说明 |
| --- | --- |
| `id` | `[a-z0-9][a-z0-9-]{0,39}`，进 URL（天然防路径穿越） |
| `name` / `title` / `description` | 显示名（≤24 字）/ 称号（≤40）/ 一句话简介（≤120） |
| `tags` | ≤8 个，每个 ≤12 字 |
| `mode` | `system`（人设注入）/ `rewrite`（改写输入）/ `both` |
| `persona` | 注入系统提示的正文（≤20000 字，实际注入受 `personaMaxChars` 约束） |
| `tailLine` | **可选**：尾部回声（≤200 字，用人设第一人称写）。它会出现在系统提示词**最末尾**（`order=10201`，在所有官方段之后），用来在近因位置重申角色的声音；没写就自动逐字取 `persona` 的第一句（跳过 `#`/`【` 标题行），都没有就不加。默认**不启用**（见 `personaEcho` 配置） |
| `rewrite.rules` | 改写调用的 system prompt 主体（≤20000 字） |
| `rewrite.examples[]` | few-shot 示例 ≤4 组（**强烈建议写**，硬邦邦的效果主要靠它锚定） |
| `art` | 立绘引用 `{ artId, mime, bytes, sha256, width?, height? }`，可选 |
| `cover` | 无立绘时的占位 `{ emoji, hue }` |

### 单文件多卡：`dsh-cosplay-pack`

导出/导入/预设**共用同一个格式**，所以"别人发来的包"和"插件自带的预设"是同一种东西：

```json
{
  "format": "dsh-cosplay-pack",
  "version": 1,
  "exportedAt": 1759320000000,
  "cards": [ { "id": "hardcore", "name": "硬邦邦", "mode": "rewrite", "rewrite": { "rules": "…", "examples": [ … ] } } ],
  "art": { "a-0123456789abcdef": { "mime": "image/png", "base64": "iVBORw0…", "sha256": "…" } }
}
```

导入规则（有测试盯着）：

- 包里**写了 `id`** → 按 id 覆盖（同一个包导两次 = 同一批卡更新，不会堆叠）；
- 包里**没写 `id`** → 由名字派生并避开已有库与预设，永远不会顶掉别人；
- 与**预设**撞 id → 稳定改名为 `<id>-custom` 后作为自定义卡导入（预设永远只读）；
- 单张卡坏掉只跳过它并记账，不会让整个包白导。

### 立绘

- 上传前在浏览器里压到最长边 `artMaxEdge`（默认 1024）、质量 `artQuality`；
- 宿主侧**按字节签名**判定类型（不信任声明的 mime），只收 PNG / JPEG / GIF / WebP；
- 按 `sha256` 去重，同一张图重复上传不会存两份；
- 带透明通道保持 PNG（避免 JPEG 黑边）。

---

## 卡片库在哪

```
<DSH_HOME>/cosplay/
  library.json          # 只存**自定义卡**（预设随包走，不落这里）
  library.json.bak      # 上一次成功写入的副本
  art/<artId>.<ext>     # 立绘字节，按 sha256 去重
  state.json            # 本会话绑定 / 开关 / 每会话最近 20 条改写记录（含原文）/ lastCardId
  exports/              # 「导出到磁盘」的落点
```

三条纪律：**预设只读**（改预设 = 复制为自定义，插件升级时预设还能更新）；
**坏库隔离**（解析失败改名成 `library.json.corrupt-<ts>` 留证后从空库继续，插件绝不起不来）；
**原子写**（同目录 tmp + rename）。

---

## 配置

两处入口，各管各的：

- **侧栏 插件 → 已安装 → dsh-cosplay 的设置表单**（技术参数，由插件 Config 投影）
- **设置 → 角色扮演**（卡片库管理 + 实时诊断）

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `enabled` | `true` | 总开关：关掉后既不注入也不改写 |
| `strategy` | `card` | `card` = 按卡片自己的 `mode`；`system` / `rewrite` = 全局强制覆盖 |
| `defaultCardId` | 空 | 新会话默认角色卡（优先级：**显式绑定 > 上次用的卡 > defaultCardId**） |
| `injectIntoUnboundSessions` | `false` | 是否给"从没在界面里打开过"的会话也套默认卡（默认关：不污染 subagent 会话） |
| `rewriteProvider` / `rewriteModel` | 空 | 改写用哪个模型；留空 = 用当前默认模型 |
| `rewriteTemperature` | `0.4` | 改写温度 |
| `rewriteTimeoutMs` | `20000` | 单次改写超时（超时按失败处理，回落原文） |
| `rewriteMaxInputChars` / `rewriteMaxOutputChars` | `6000` / `4000` | 输入截断 / 输出上限 |
| `rewriteOnFailure` | `original` | 改写失败时：`original` = 用原文继续；`block` = 拒绝这一步（会打断本轮，慎用） |
| `rewriteContextTurns` | `6` | 改写时带多少条最近对话（≈3 轮）；`0` = 不带，退回旧行为 |
| `rewriteContextMaxChars` | `2400` | 带进改写的上下文总字数上限（单条另有 800 字上限，超出走"保头保尾 + 中略"） |
| `rewriteGuardUnresolved` | `true` | 原文含"这个 / 它 / 上一轮"这类指代、又拿不到上下文时**跳过改写**（原样放行） |
| `thinkingFlavor` | `off` | **角色风味思维链**：把 E4 的思考链风格标记**逐字**追加到**本会话首条用户消息末尾**。`immersive` = 让思考变成第一人称内心戏（实测：思考语言 0% → 63% 中文、英文分析腔 3/3 → 0/4）；`analysis` = 反之。只在**第 1 轮 + 本会话真有角色人设**时生效。**默认关**：它会**改动你的原话**（durable、对话里可见） |
| `anchorSeat` | `system` | 锚点座位：`system` = 系统提示词末尾（现状）；`context` = 注册成运行时上下文（以 user 角色落在**对话历史之后**）。**默认 `system`**：spike 实测静态 `context` 锚点只在第 1 轮落在历史之后、之后就沉底（详见 [backlog B1](docs/backlog.md)） |
| `personaEcho` | `true` | 在系统提示词**最末尾**再放一句角色原话（"尾部回声"）。默认开，依据见「人设 × 上下文」一节的对照实验；不想要就关掉（代价约 +40 字/请求） |
| `ignoreSubagents` | `true` | **子代理会话一律不注入、不改写**。实测子代理的任务提示词 `source.kind` 也是 `user`，不隔离的话（配合 `injectIntoUnboundSessions` + 改写卡）父代理写的任务说明会被改写成另一种风格 |
| `inheritFromParent` | `false` | 子代理是否继承父会话的角色卡。只沿父链看**一层**（父会话 id 在会话头 `parentSession` 里，父会话的绑定在我们的 `state.json` 里）；需先关掉 `ignoreSubagents` |
| `personaMaxChars` | `8000` | 人设注入长度上限（超出裁人设、保留头尾纪律） |
| `showTab` | `true` | 是否显示「角色」页签 |
| `coverAspect` | `1` | 卡片封面的宽高比（1 = 近方形） |
| `storagePath` | 空 | 卡片库目录；留空 = `<DSH_HOME>/cosplay`（**改完重挂插件生效**） |
| `artMaxEdge` / `artQuality` | `1024` / `0.85` | 立绘压缩 |
| `traceSize` | `200` | 诊断环形缓冲容量 |
| `enableProbeEndpoints` | `false` | 是否挂载 `/probe/*` 三个**开发期自检端点**。默认关：它们能把任意文本当用户消息投给 agent、能停/归档任意会话（跑 `test/live-probe.mjs`、对照实验脚本时才打开；详见下方「已知限制」） |

---

## 诊断

浏览器控制台宿主看不到，所以关键动作都会经 `POST /api/dsh-cosplay/debug` 回传宿主的环形缓冲：

```bash
# 状态行（计数 + 配置 + 探针）
curl http://127.0.0.1:19387/api/dsh-cosplay/stats

# 最近 60 条回执（客户端与宿主都在这）
curl "http://127.0.0.1:19387/api/dsh-cosplay/trace?limit=60"

# 一个会话的绑定 + 最近改写记录
curl "http://127.0.0.1:19387/api/dsh-cosplay/diagnostics?sessionId=<id>"

# 活体探针（对正在运行的 GUI 一次把关键链路打一遍）
node test/live-probe.mjs 19387
```

**身份探针（`sectionUnresolved` / `preStepUnresolved`，应恒为 0）**：本插件的角色是**按会话**解析的，
而"会话身份"来自装配上下文与 pre-step 载荷里的运行时对象 —— 那些形状**不在插件契约里**。
一旦 DSH 改了它们，症状会是「所有会话突然都没角色」而且**不报错**。所以：

- 解析走**两条独立的路**：`agent.id` 优先，`scope.id` 兜底
  （实测 `assembleContextFor()` 返回 `{ agent, scope: agent, … }`，两个键指向同一 agent；
  `scope` 是 `AssembleContext` 里**声明过**的字段，`agent` 是运行时多给的）；
- pre-step 侧同样两条：`agent.id` → `agent.session.id` → `session.header.id`；
- 两条都取不到时：**本次不注入/不改写**，写一条 `host:prompt-section-no-agent`（或
  `host:pre-step-no-agent`）回执，并把计数累加到上面两个字段里 —— 界面上「设置 → 角色扮演 →
  链路计数 → 身份探针」会变红。**看到它 > 0 就是"该升级适配了"，不是玄学。**

「设置 → 角色扮演」页把同一份数据画在你面前（计数 + 诊断流）。

---

## 人设 × 上下文（实测 + 文献，不是感觉）

> **四份配套文档**（2026-10）：
> - [角色扮演 / 人设提示词的证据报告](docs/research-persona-prompting-2026-10.md) —— 14 条证据、按日期与可信度分级、
>   明确标注"降权（时代性）"与"未精读"的条目、以及**上一轮设计的 4 处修正**（含一处方法学自我批评）；
> - [角色卡写作与运维 · 行动指南](docs/playbook-persona-cards.md) —— 五段模板、预算、反模式表、
>   7 张预设卡逐卡改造清单、锚点座位的 spike 判定规则、验证与回滚；
> - [预设卡实际注入内容（dump）](docs/preset-dump.md) —— 由 `node scripts/dump-presets.mjs` 生成，
>   把"模型最后看到的那些字"整段摊开（含插件层扮演纪律与尾部回声）；
> - [待办与规划](docs/backlog.md) —— 已规划未开工项（带依据/成本/依赖）、低成本小项、
>   仓库与环境层面的待决、以及**明确不做的事项及理由**。

这一节回答三个被真实问过的问题。数据来自本机真实会话日志（857 个会话全量扫描 + 逐轮统计），
文献结论按可信度标注。

| 问题 | 结论 | 证据 |
| --- | --- | --- |
| 人设是"只第一轮注入"吗？ | **不是**。每次装配（每次请求）都重新求值，绑定后每次 `system/message` 都带着它 | 本会话 8 次 SYS 提交，02:13 之后每次含 337 字注入段，位置固定在第 111 字符 |
| 先无角色聊几轮、再切角色，会变弱吗？ | **注入强度不变**，但"历史示范一致性"会变差 —— 前几轮里助手自己说的话是本会话最强的风格示范 | 本会话 4 轮无角色 → 第 5 轮切学姐：**切换立刻生效**（首个大答人设标记命中 20 处、明确用「先…然后…最后」结构） |
| 中途换卡会被旧口吻污染吗？ | **分两侧**：助手口吻几乎不被带走（被改写的是用户消息）；但**历史里的"你"不可逆地被改了**，而且改写一旦换了主体，历史里就留下一条错的任务 | 猫娘 4 轮喵密度 2.6→1.2→1.7→1.1（无衰减）；被硬邦邦改了 2/2 条用户消息的会话里，助手 3 条正文命中硬邦邦词仅 2 次（0.10/百字） |

**位置与措辞的依据**（文献）：
- [Lost in the Middle](https://arxiv.org/abs/2307.03172v3) + [Attention Sinks](https://arxiv.org/abs/2309.17453)：
  注意力呈 **U 型**（开头强、中间弱、结尾强）→ 人设段放在**最前**（`order=1`）已是最优位。
  **注**：这两篇是 2023 年的，按本仓库的时代性政策**降权**（只取方向，不引数值）；
  更接近当下的证据（2026）见证据报告里的 E1/E2/E3。
- [Critical Instruction Repetition](https://raw.githubusercontent.com/agentpatterns-ai/website/main/instructions/critical-instruction-repetition.md)：
  关键约束"首尾各说一次"有效，但**只能一条、必须逐字**（换说法会被读成第二条冲突约束），
  且**推理模型收益明显更小** —— 所以我们只在末尾放**卡片自己的原话**，并且默认关。
- [JanitorAI 实践指南](https://help.janitorai.com/en/article/advanced-prompting-101-1ka4aon/)（角色扮演实践共识）：
  破角色是公认现象；"重复=噪声，只说一次"；**否定式指令基本无效**（写"别跳出来"等于把"跳出来"喂进去）
  → 插件层纪律一律**正向陈述**（有单测盯着不许出现「不要 / 禁止 / 严禁」）。
- [ERABAL](https://ar5iv.labs.arxiv.org/html/2409.14710) + [CharacterEval](https://aclanthology.org/2024.acl-long.638.pdf)：
  角色扮演的评测维度是"角色一致性 / 角色知识 / **未知问题拒绝（OOC 拒绝）**"，OOC 主因是
  "问到了角色认知边界之外" → 纪律里补了"超出角色认知范围的问题：在角色身份内说明不知道"。
- [MENTOR: Identity Drift in Dynamic Role-Playing](https://aclanthology.org/2026.findings-acl.1046.pdf)：
  **中途换人设的漂移是有专门文献的问题**，主流解法是记忆架构/训练而非提示词
  → 所以本插件的务实解是"换卡时提示开新会话"，不去硬扛历史。

**因此插件做了三件事**：
1. **权限阶梯**（写进人设段，正向陈述）：事实 / 安全 / 工具纪律 > 角色设定 > 历史旧口吻；
   事实冲突以事实与用户为准，风格冲突以角色为准。
2. **尾部回声**（`personaEcho`，**默认开**）：把卡片原话放到系统提示词真末尾（`order=10201`）。
3. **换卡的诚实提示 + 换会话不换角色**：本会话换过卡时提示"旧口吻还在历史里"（`cardsSeen`），
   新会话自动继承上次用的卡（`lastCardId`）。优先级：**显式绑定 > lastCardId > defaultCardId**。

### 对照实验（可复现：`node scripts/experiment-persona.mjs <端口>`）

同一模型（deepseek-flash / high）、同一张卡（赛博猫娘）、同一批纯闲聊探针，四组：
A 全程猫娘 · A′ 同 A 但打开尾部回声 · B 前 2 轮无角色 → 第 3 轮切猫娘 ·
C 前 2 轮**硬邦邦**（用户消息被改写成甲方文）→ 第 3 轮切猫娘。

| 组 | 人设刚生效那一轮的「喵」密度 | 全部回复的旧风格词残留 | 元话语/百字 |
| --- | --- | --- | --- |
| A（基线） | 0.85 | 0 | 0.15 |
| **A′ 尾部回声** | **1.75** | 0 | 0 |
| B（中途切入） | 0.73 | 0 | 0 |
| C（强冲突切入） | **2.69** | 0 | 0 |

**三个结论**：
- **"中途换人设会明显变弱"不成立**：B 组 0.73 只比基线低约 15%（阈值 40% 都没碰到），
  而**强冲突**的 C 组反而最高（2.69）—— 前两轮的暴躁甲方文并没有把角色带走，旧风格词残留全为 0。
- **尾部回声有轻微正向效果**：密度 0.85 → 1.75（首个回复），三轮均值 0.91 → 1.16；
  独立评审（另起会话、不知分组、按固定 rubric）打 **17 vs 10**，差异集中在
  "角色认知边界的处理"（角色内认账 vs 编造不存在的"今天"）与"元话语"。
  **诚实提示：每组只有 1 个会话 / 3 轮，差异可能含采样噪声**，所以只把它当"无害 + 略有帮助"。
- 回声的落点已用真实日志核实：它出现在**全部官方段之后**（`Your working directory is …` 之后那一块）。

---

## 怎么核对模型真正收到的东西

浏览器控制台宿主看不到，所以除了诊断端点，还有两个**直接读会话日志原始字节**的工具
（会话日志是**多帧拼接**的 zstd 容器，通用工具解不开 —— 这一点在 `scripts/session-log.mjs` 里有注释）：

```bash
# 1) 模型实际收到的 system / user / 请求头（+ 结构图、全文、全文检索）
node scripts/inspect-session.mjs <会话id前缀> --outline
node scripts/inspect-session.mjs <会话id前缀> --users 3
node scripts/inspect-session.mjs <会话id前缀> --grep "把这个提交到我的仓库"   # 原话到底进没进日志

# 2) 人设注入时间线（谁 → 谁 → 谁）与"每轮人设标记密度"
node scripts/inspect-persona.mjs <会话id前缀>
node scripts/inspect-persona.mjs --scan --only-persona
```

界面上也有对应入口：卡片详情页的「看实际发送的完整 system prompt」、以及每条改写记录的
「原文 ↔ 改写后」对照。

---

## 已知限制与代价（说清楚，不埋在代码里）

- **改写要多一次模型调用**：实测 3.3s（手动改写端点、deepseek-flash、10 字 → 579 字）
  到 8.3s（完整回合内），按默认模型计费；带上下文后每次再多送 ≤2400 字输入。
  这是"改写型角色卡"的固有代价 —— `/cosplay off` 或换成人设卡就没有。
- **改写结果会替换日志里的用户消息**：这是设计（模型收到的与日志一致），
  但意味着"你的原话"不再出现在对话里；**原文现在会留档在 `state.json` 的改写记录里**，
  也可以在「角色」页签的详情页展开「原文 ↔ 改写后」对照。想看当时的原话也可以用「轨迹」
  找 `agent/inbox/spliced` 事件（那里留着收件箱原文）。
- **换卡不会改历史**：人设只影响之后注入的段；历史里那些旧口吻的对话（含被改写过的用户消息）
  是 append-only 的 durable 记录，改不掉。想从干净上下文开始角色 → 开新会话。
- **桌面端 host 改动要重启应用**：Node 的模块缓存不会因为重挂条目而失效
  （实测：重挂后路由表还是旧的）。浏览器半边只需刷新页面。开发迭代建议用独立 profile：
  `dsh plugin --profile lab add link:<本包>` + `dsh --profile lab --port 31999 --no-open`。
- **预设只读**：想改就「复制为自定义」。
- **未在界面里打开过角色页签的会话不会自动上角色**（默认）—— 这是为了不把角色悄悄套到
  subagent 与后台会话上。要改：`injectIntoUnboundSessions`。
- **本会话的"换过卡"提示只看绑定历史**（`cardsSeen`，≤4 张），它不读会话正文，
  所以只是"提醒"，不是精确的"污染度"度量。
- **路由的准入边界与框架同级**（2026-10-06 修正，源自外部安全报告 [issue #1](https://github.com/liceses/dsh-cosplay/issues/1)）：
  我们的前缀 `/api/dsh-cosplay` 比框架的 `/api` **长**，而宿主 webserver 是 `Longest-prefix-wins`，
  所以框架自己那道 `/api` 围栏在我们的路径上**不会执行** —— 曾经因此裸奔（本机任意进程、甚至跨站页面
  都能调；`probe/turn` 能把任意文本当用户输入投给 agent）。现在每个请求先过
  `connection.requestRejection()`（框架原话：先 Host/Origin 围栏、再浏览器会话鉴权），
  与框架 `/api` 完全同级：**带页面 cookie 的正常请求 200 / 无 cookie 的本机进程 401 /
  跨站 403**。服务不在时退回本地等价围栏（回环 + 拒 `sec-fetch-site: cross-site` + Origin 必须同源）。
- **`probe/*` 三个自检端点默认关闭**（`enableProbeEndpoints`，默认 `false`）：它们能把任意文本当用户
  消息投给 agent、能停/归档任意会话，所以不默认张开。跑 `test/live-probe.mjs`、
  `scripts/experiment-persona.mjs` 这类自检/对照实验时在配置里打开。
- **残留风险（诚实说明）**：本机进程若**拿到了浏览器会话 cookie**，仍可调用这些端点
  —— 这与框架自己的 `/api` 是同一等级，是本机 HTTP 服务的固有边界，不是本插件独有的口子。
- **立绘走 `<DSH_HOME>` 磁盘**，不进官方附件流水线（那会把动画压成静图；这里也一样，
  所以只收 4 种静态格式）。
- 只做了中文界面（英文留 M2）。

---

## 开发

```bash
npm run typecheck            # tsc --noEmit（host + client 全量）
npx tsc -p tsconfig.sdk020.json   # 换一套 SDK 类型再查一遍（0.2.0 镜像）
npm run build                # tsc 出 host（lib/*.js + d.ts）→ tsdown 出客户端 bundle
npm run check:client         # 客户端 bundle 纯净化门禁
npm test                     # build + 纯洁检查 + 全部单测
node test/live-probe.mjs 31999    # 对运行中的 GUI 打活体探针
node scripts/link-sdk.mjs    # 没网时把 SDK 类型接上（镜像 junction）
```

测试分工：`cards`（规范化/包解析/id 语义/tailLine 往返）· `library`（预设只读/落盘/预设热重载/立绘去重/导入导出/坏库隔离）·
`prompt`（注入与改写组装/清洗/权限阶梯）· `rewrite`（流收集/超时/四种失败形态/内容缓存）·
`context`（上下文取法/噪声排除/裁剪与预算/组装分区）· `guard`（**用 02:35 真实事故做 fixture**：带上下文改对、无上下文跳过）·
`persona`（段注册与 order/尾部回声三级取法/正向措辞）· `state`（lastCardId / cardsSeen / 旧文件兼容）·
`hook`（pre-step 五条纪律）· `route`（围栏/CRUD/立绘/ETag/绑定/404）·
`apply`（桩服务跑真 `apply()`）· `bindings`（"本会话用哪张卡"的唯一判定）· `seats`（槽位契约与产物级检查）·
`manifest-compat`（peer 区间容纳两个运行时）· `client-bundle`（产物契约）。

浏览器半边的纪律：`src/client/**` 只能 import `react` / `@deepseek-ai/dsh-client-*` 与本包的纯模块
（`types.ts` / `protocol.ts` / `config.ts` / `cards.ts` / `bindings.ts` / `prompt.ts` / `settings-source.ts`）。
**绝不能** import `schema.ts`（会把 schemastery 打进浏览器）—— 由 `npm run check:client` 与
`test/client-bundle.test.mjs` 双重门禁。

**预设是数据，改它会立刻生效**：`presets/*.json` 的目录指纹（名字+大小+mtime）每秒最多比对一次，
变了就重载 —— 所以改预设文案**不需要重启应用、不需要重挂插件**（有单测盯着）。
宿主代码（`src/*.ts`）则相反：改了要重挂插件，桌面端受 Node 模块缓存影响**需要重启应用**
（实测：重挂后路由表还是旧的）。所以开发时用独立剖面最快：

```bash
dsh plugin --profile lab add link:D:\developing\DSH-plugin\dsh-cosplay
dsh --profile lab --port 31999 --no-open      # 拿到带 token 的 URL，用浏览器开
```

改客户端后要在 `/stats` 的 `client:client-apply` 回执里核对 `build=`（`src/client/index.tsx` 顶部
的 `CLIENT_BUILD`），否则你看到的可能还是上一版 bundle。

---

## 文件地图

| 路径 | 作用 |
| --- | --- |
| `src/index.ts` | host 装配：路由 + 提示段 + pre-step 钩子 + 命令 + 客户端图观测 |
| `src/cards.ts` | **数据层（纯函数）**：规范化、id 语义、包解析/组装、字节嗅探 |
| `src/library.ts` | 卡片库磁盘层：预设只读、原子写、立绘去重、导入导出、坏库隔离 |
| `src/state.ts` | `<库根>/state.json`：会话绑定、开关、改写记录（有界） |
| `src/prompt.ts` | 系统提示段注册 + 人设/改写 system prompt 组装 + 输出清洗 |
| `src/rewrite.ts` | 模型改写：`ctx.llm.stream` 流收集、超时、失败回落、内容缓存 |
| `src/hook.ts` | `agent/pre-step`：五条纪律 + 探针自检路径 |
| `src/route.ts` | 全部 HTTP 端点（回环围栏、体积上限、ETag/304） |
| `src/command.ts` | `/cosplay` |
| `src/observe.ts` | durable 事件观测（只为"角色生效过"的会话记录） |
| `src/trace.ts` / `src/protocol.ts` / `src/config.ts` / `src/schema.ts` / `src/types.ts` / `src/paths.ts` | 诊断环形缓冲、协议常量、默认配置、设置 schema、契约类型、路径 |
| `src/client/index.tsx` | 浏览器半边入口：回执 + 样式 + 两个槽位注册 |
| `src/client/view.tsx` | 「角色」页签：网格 ⇄ 二级详情 |
| `src/client/editor.tsx` | 角色卡编辑器（含立绘上传） |
| `src/client/settings.tsx` | 设置页：库管理 + 诊断 |
| `src/client/api.ts` / `image.ts` / `styles.ts` / `copy.ts` | 同源数据通道、图片压缩、样式（只用真名 `--dsw-alias-*` 变量）、文案 |
| `presets/personas.json` / `presets/rewriters.json` | 预设卡（人设 5 张 + 改写 2 张，含「硬邦邦」） |
| `scripts/check-client-purity.mjs` | 客户端产物契约与模块表白名单门禁 |
| `scripts/link-sdk.mjs` | 离线 SDK 类型镜像 junction |
| `test/live-probe.mjs` | 对运行中的 GUI 的活体探针 |
| `tsconfig.sdk020.json` | 第二套 SDK 类型（0.2.0 镜像）下的类型检查 |

---

## 座位表（它长在哪）

| 面 | 座位 | 说明 |
| --- | --- | --- |
| 角色页签 | `conversation.view`（id `cosplay`, order 20） | **list 槽位**（加法型），排在 chat(0) / trajectory(10) 之后；`showTab=false` 时不注册 |
| 角色 chip | `conversation.input.left`（id `cosplay-card-chip`, order 20） | 输入框工具行，**空白会话同样渲染** → 首轮就能选角；没有会话时它管的是"新会话默认角色" |
| 设置页 | `settings.section`（id `cosplay`, order 30） | 侧栏设置里的「角色扮演」 |
| 人设注入 | 系统提示段 `dsh-cosplay:persona`（order = 部署人设 + 1） | `interpolate: false`，加法而非替换 |
| 改写 | `agent/pre-step`（waterfall） | 只动 `role=user` 且 `source.kind=user` 的消息 |
| 诊断回执 | `POST /api/dsh-cosplay/debug` | 浏览器控制台宿主看不到，这是唯一可观测通道 |

---

## 验证记录（本机）

- **M0 探针**：客户端 bundle 装载 / 页签注册与显示 / `agent.id` 可读 / 改写进 durable `user/message`
  并被子模型复述 —— 四条都有回执与截图（`.dsh/showme/cosplay-m0/evidence.html`）。
- **M1 端到端（lab profile，0.1.7-rc.2，独立端口）**：
  - 猫娘：`host:persona-injected 注入「赛博猫娘」人设 402 字` → 回复「呼噜噜~ 主人终于来了喵！… 蹭蹭 (｡•̀ᴗ-)✧」；
  - 硬邦邦：`10 字 → 571 字`，durable 用户消息即为改写后的 prompt，模型随后按改写后的 prompt 行动；
  - 桌面端（0.2.0-rc.1）同一份代码同样激活成功。
- **单测**：80 条全过（含产物契约、peer 兼容、坏库隔离、失败回落）。
- **类型检查**：两套 SDK（0.1.7-rc.2 / 0.2.0-rc.1）都 0 错误。
