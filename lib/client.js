window.__ModuleLoader__.load({
	id: "dsh-cosplay",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region src/protocol.ts
		/**
		* dsh-cosplay — 路由与协议常量（host 与浏览器半边共用同一份字符串）。
		*
		* 目的只有一个：不让"两边各自写死一个路径"漂移。这个文件必须是**纯模块**
		* （只允许常量与纯函数）—— 浏览器半边会 import 它。
		*/
		/** 本插件占用的路由前缀（webServer 前缀路由）。 */
		const ROUTE_PREFIX = "/api/dsh-cosplay";
		/** 客户端回执入口（浏览器看不到控制台，这是唯一可观测通道）。 */
		const DEBUG_PATH = `${ROUTE_PREFIX}/debug`;
		/**
		* profile 条目 id —— **0.1.7 起它就是设置命名空间**。
		*
		* DSH 0.1.7+ 的 SettingsForms 按 profile 条目 id 组织表单：宿主侧 `describe()` 列出的是
		* 条目 id，客户端 `ctx.configForms.get(entryId)` 的键也是它。所以这个常量必须与
		* `cordis.patch.yml` 里那一行的 `id:` 逐字一致。
		*/
		const ENTRY_ID = "cosplay";
		/** 客户端 `<style data-plugin>` 与诊断前缀用的包名。 */
		const PACKAGE_NAME = "dsh-cosplay";
		/** 浏览器半边在 `conversation.view` 里的条目 id（也就是页签 id）。 */
		const VIEW_ID = "cosplay";
		/** 我们注册到 `settings.section` 的页面 id。 */
		const SETTINGS_SECTION_ID = "cosplay";
		/** 卡片库数据端点（页签网格与设置页共用）。 */
		const LIBRARY_PATH = `${ROUTE_PREFIX}/library`;
		//#endregion
		//#region src/config.ts
		/** 默认配置。 */
		const DEFAULT_CONFIG = {
			enabled: true,
			strategy: "card",
			defaultCardId: "",
			injectIntoUnboundSessions: false,
			rewriteProvider: "",
			rewriteModel: "",
			rewriteTemperature: .4,
			rewriteTimeoutMs: 2e4,
			rewriteMaxInputChars: 6e3,
			rewriteMaxOutputChars: 4e3,
			rewriteOnFailure: "original",
			rewriteContextTurns: 6,
			rewriteContextMaxChars: 2400,
			rewriteGuardUnresolved: true,
			personaEcho: true,
			personaMaxChars: 8e3,
			showTab: true,
			coverAspect: 1,
			storagePath: "",
			artMaxEdge: 1024,
			artQuality: .85,
			traceSize: 200
		};
		//#endregion
		//#region src/settings-source.ts
		/**
		* 未挂载时的固定快照。
		*
		* 必须是**冻结的同一个引用** —— `useSyncExternalStore` 每次渲染读快照，
		* 每次都返回新对象会让 React 认定 store 一直在变，从而死循环。
		*/
		const UNAVAILABLE_SNAPSHOT = Object.freeze({
			status: "unavailable",
			value: void 0,
			base: void 0,
			user: void 0,
			revision: void 0,
			writable: false,
			mode: "memory"
		});
		/** 建一个延迟绑定句柄。 */
		function createLazyScope() {
			let live = null;
			let detachLive = null;
			let current = UNAVAILABLE_SNAPSHOT;
			const listeners = /* @__PURE__ */ new Set();
			const emit = () => {
				for (const listener of [...listeners]) listener();
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
					emit();
					return () => {
						detachLive?.();
						detachLive = null;
						live = null;
						current = UNAVAILABLE_SNAPSHOT;
						emit();
					};
				}
			};
		}
		//#endregion
		//#region src/client/api.ts
		/**
		* dsh-cosplay — 浏览器半边与宿主的数据通道。
		*
		* 一律走本插件自己的同源路由（实测匿名可达、只认回环 Host）：
		*   GET  /api/dsh-cosplay/library · /card/<id> · /art/<artId> · /binding · /diagnostics · /stats · /trace
		*   POST /api/dsh-cosplay/card · /card/copy · /card/delete · /art · /import · /export/write · /binding · /rewrite · /debug
		*
		* **浏览器控制台宿主看不到** —— 所以关键动作都要 `postDebug` 回传宿主，
		* 否则"页签为什么没出来"在宿主侧完全不可观测（dsh-memes-reply 的教训）。
		*/
		/** 同源 JSON GET；失败返回 undefined（调用方降级显示，绝不抛）。 */
		async function getJson(path) {
			try {
				const response = await fetch(path, { headers: { accept: "application/json" } });
				if (!response.ok) return void 0;
				return await response.json();
			} catch {
				return;
			}
		}
		/** 同源 JSON POST；失败返回 undefined。 */
		async function postJson(path, body) {
			try {
				const text = await (await fetch(path, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify(body)
				})).text();
				try {
					return JSON.parse(text);
				} catch {
					return;
				}
			} catch {
				return;
			}
		}
		/** 读卡片库（元数据投影）。 */
		function fetchLibrary() {
			return getJson(LIBRARY_PATH);
		}
		/** 读单卡全文。 */
		function fetchCard(id) {
			return getJson(`${ROUTE_PREFIX}/card/${encodeURIComponent(id)}`);
		}
		/** 新建/更新一张自定义卡。 */
		function saveCard(card) {
			return postJson(`${ROUTE_PREFIX}/card`, { card });
		}
		/** 复制为自定义卡。 */
		function copyCard(id, overrides = {}) {
			return postJson(`${ROUTE_PREFIX}/card/copy`, {
				id,
				overrides
			});
		}
		/** 删除一张自定义卡。 */
		function deleteCard(id) {
			return postJson(`${ROUTE_PREFIX}/card/delete`, { id });
		}
		/** 存一张立绘（base64，不带 data URL 前缀）。 */
		function uploadArt(input) {
			return postJson(`${ROUTE_PREFIX}/art`, input);
		}
		/** 导出包（默认全部卡）。 */
		function exportPack(ids) {
			return getJson(`${ROUTE_PREFIX}/export${ids === void 0 || ids.length === 0 ? "" : `?ids=${encodeURIComponent(ids.join(","))}`}`);
		}
		/** 导出并落盘到 `<库根>/exports/`，返回绝对路径。 */
		function exportWrite(ids) {
			return postJson(`${ROUTE_PREFIX}/export/write`, ids === void 0 ? {} : { ids });
		}
		/** 导入包。 */
		function importPack(pack) {
			return postJson(`${ROUTE_PREFIX}/import`, { pack });
		}
		/** 读本会话绑定。 */
		function fetchBinding(sessionId) {
			if (sessionId === "") return Promise.resolve(void 0);
			return getJson(`${ROUTE_PREFIX}/binding?sessionId=${encodeURIComponent(sessionId)}`);
		}
		/** 写本会话绑定。 */
		function putBinding(sessionId, patch) {
			return postJson(`${ROUTE_PREFIX}/binding`, {
				sessionId,
				...patch
			});
		}
		/** 手动改写一次（预览用）。 */
		function rewriteOnce(input) {
			return postJson(`${ROUTE_PREFIX}/rewrite`, input);
		}
		/** 读诊断（设置页用）。 */
		function fetchDiagnostics(sessionId = "") {
			return getJson(`${ROUTE_PREFIX}/diagnostics${sessionId === "" ? "" : `?sessionId=${encodeURIComponent(sessionId)}`}`);
		}
		/** 清理无引用立绘。 */
		function pruneArt() {
			return postJson(`${ROUTE_PREFIX}/art/prune`, {});
		}
		/**
		* 客户端回执：关键动作回传宿主（进环形缓冲，`/trace` 可读）。
		* 一律 fire-and-forget，失败静默 —— 诊断绝不能影响功能。
		*/
		function postDebug(entry) {
			try {
				fetch(DEBUG_PATH, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify(entry),
					keepalive: true
				}).catch(() => {});
			} catch {}
		}
		//#endregion
		//#region src/bindings.ts
		/**
		* 解析本会话实际生效的角色卡 id。
		* @returns 卡 id，或空串（= 没有角色）。
		*/
		function effectiveCardId(input) {
			const binding = input.binding;
			if (binding !== void 0 && binding.enabled === false) return "";
			const explicit = binding?.cardId;
			if (typeof explicit === "string" && explicit !== "") return explicit;
			if (input.injectIntoUnbound && input.defaultCardId !== "") return input.defaultCardId;
			return "";
		}
		//#endregion
		//#region src/client/binding.ts
		/**
		* dsh-cosplay — 「本会话角色」的共享状态（浏览器半边）。
		*
		* ## 这个 hook 解决的那个硬伤
		*
		* DSH 的空白会话**不显示页签条**（`dsh-client-ui-conversation`：`showTabs = !hideChrome && …`，
		* 而空白态 `hideChrome = blank`；视图区在 blank 阶段直接 `return null`）。
		* 所以"打开角色页签再选角"这条路对**第一轮**根本不成立 —— 页签要等第一轮开始才出现。
		*
		* 修法：把"绑定落地"从"打开角色页签"提前到**会话视图挂载时**，并把入口放进输入框工具行
		* （`conversation.input.left`，Hero 状态同样渲染）。于是：
		*
		*   新建会话 → chip 挂载 → 立刻把生效值写成显式绑定 → 你敲字发送时宿主已经知道用哪张卡。
		*
		* ## 只写一次
		*
		* `materializeDefault` 用模块级 Set 去重：一个会话只在"还没有显式绑定"时落地一次默认卡，
		* 之后（包括你手动改成"无角色"）都不会被再写回去。
		*/
		/** 已经落地过默认卡的会话。 */
		const materialized = /* @__PURE__ */ new Set();
		/**
		* 读/写本会话的角色。
		* @param sessionId - 当前会话 id（空串 = 没有会话，hook 退化成空闲状态）。
		*/
		function useSessionCard(sessionId) {
			const [library, setLibrary] = (0, react.useState)(void 0);
			const [binding, setBinding] = (0, react.useState)(void 0);
			const [loading, setLoading] = (0, react.useState)(sessionId !== "");
			const [error, setError] = (0, react.useState)("");
			const reload = (0, react.useCallback)(async () => {
				const nextLibrary = await fetchLibrary();
				setLibrary(nextLibrary);
				if (sessionId === "") {
					setBinding(void 0);
					setLoading(false);
					return;
				}
				const nextBinding = await fetchBinding(sessionId);
				setBinding(nextBinding);
				setLoading(false);
				setError(nextBinding === void 0 ? "读不到本会话的角色绑定（宿主半边没装上或没重挂？）" : "");
				const lastCardId = typeof nextLibrary?.lastCardId === "string" ? nextLibrary.lastCardId : "";
				const inherited = lastCardId !== "" ? lastCardId : nextLibrary?.config.defaultCardId ?? "";
				const source = lastCardId !== "" ? "上次用的卡" : "默认卡";
				if (!(nextBinding !== void 0 && nextBinding.binding.updatedAt !== 0) && inherited !== "" && !materialized.has(sessionId)) {
					materialized.add(sessionId);
					const result = await putBinding(sessionId, {
						cardId: inherited,
						enabled: true
					});
					postDebug({
						kind: "binding-materialized",
						sessionId,
						id: inherited,
						note: result?.ok === true ? `会话视图挂载 → 落地${source}（首轮就带角色）` : `落地${source}失败`
					});
					if (result?.ok === true) setBinding(await fetchBinding(sessionId));
				}
			}, [sessionId]);
			(0, react.useEffect)(() => {
				reload();
			}, [reload]);
			const setCard = (0, react.useCallback)(async (cardId) => {
				if (sessionId === "") {
					setError("这个入口要挂在会话里用（当前没有会话）");
					return;
				}
				if ((await putBinding(sessionId, {
					cardId,
					enabled: true
				}))?.ok === true) {
					materialized.add(sessionId);
					postDebug({
						kind: "binding-set",
						sessionId,
						...cardId === null ? {} : { id: cardId },
						note: cardId === null ? "清空角色" : "选定角色"
					});
					setBinding(await fetchBinding(sessionId));
					setError("");
				} else setError("绑定失败（宿主没响应？）");
			}, [sessionId]);
			const setEnabled = (0, react.useCallback)(async (enabled) => {
				if (sessionId === "") return;
				if ((await putBinding(sessionId, { enabled }))?.ok === true) {
					materialized.add(sessionId);
					postDebug({
						kind: "binding-enabled",
						sessionId,
						note: enabled ? "本会话启用角色" : "本会话停用角色（零 token）"
					});
					setBinding(await fetchBinding(sessionId));
				} else setError("切换失败");
			}, [sessionId]);
			const boundId = binding?.binding.cardId ?? null;
			const enabled = binding?.binding.enabled !== false;
			const effectiveId = effectiveCardId({
				binding: binding?.binding,
				defaultCardId: "",
				injectIntoUnbound: false
			});
			return {
				loading,
				error,
				library,
				binding,
				effectiveId,
				card: binding?.card ?? library?.cards.find((meta) => meta.id === effectiveId) ?? null,
				enabled,
				boundId,
				setCard,
				setEnabled,
				reload
			};
		}
		//#endregion
		//#region src/client/chip.tsx
		/**
		* dsh-cosplay — 输入框工具行里的「角色」chip（`conversation.input.left`）。
		*
		* ## 为什么是这里
		*
		* 空白会话不显示页签条，所以**第一轮之前没有任何地方能选角色**。而输入框工具行
		* （`+` / 权限 / 模式 那一排）是**加法型 list 座位**，Hero 状态同样渲染 ——
		* 于是「新建会话 → 点 chip → 选卡 → 发送」这条链在首轮就成立。
		*
		* 它同时也承担"绑定落地"：hook 在挂载时就把生效值写成显式绑定（见 `binding.ts`），
		* 所以就算你什么都不点，配了默认卡的新会话首轮也带角色。
		*
		* ## 交互
		*
		* 点 chip → 在它上方弹一个浮层（`position: fixed`，锚在按钮的 rect 上，避免被输入框的
		* overflow 裁掉）：卡片列表（带立绘小图/表情、模式角标、当前项高亮）+ 停用/无角色。
		* 点浮层外任意处关闭。
		*/
		/** 模式角标文案。 */
		function modeLabel$1(meta) {
			return meta.mode === "system" ? "人设" : meta.mode === "rewrite" ? "改写" : "人设+改写";
		}
		/** 卡片小图（立绘优先，退回表情）。 */
		function CardAvatar({ meta, size }) {
			if (meta.artUrl !== void 0) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("img", {
				className: "dsh-cosplay-avatar",
				src: meta.artUrl,
				alt: "",
				width: size,
				height: size,
				draggable: false
			});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: "dsh-cosplay-avatar fallback",
				style: {
					width: size,
					height: size,
					background: `linear-gradient(140deg, hsl(${String(meta.cover?.hue ?? 210)} 70% 62% / 0.4), hsl(${String(((meta.cover?.hue ?? 210) + 48) % 360)} 70% 55% / 0.25))`
				},
				children: meta.cover?.emoji ?? "🎭"
			});
		}
		/** 输入框工具行里的角色 chip。 */
		function CardChip({ sessionId: rawSessionId, openView, defaults }) {
			const sessionId = typeof rawSessionId === "string" ? rawSessionId : "";
			const state = useSessionCard(sessionId);
			/** 没有会话：这时 chip 管的是"新会话默认角色"（写插件配置）。 */
			const sessionless = sessionId === "";
			const defaultId = state.library?.config.defaultCardId ?? "";
			const defaultMeta = sessionless ? state.library?.cards.find((meta) => meta.id === defaultId) ?? null : null;
			const [open, setOpen] = (0, react.useState)(false);
			const [anchor, setAnchor] = (0, react.useState)(void 0);
			const buttonRef = (0, react.useRef)(null);
			/** 已经报过挂载的会话（去重）。 */
			const reported = (0, react.useRef)(false);
			(0, react.useEffect)(() => {
				if (reported.current || sessionId === "") return;
				reported.current = true;
				postDebug({
					kind: "chip-mounted",
					sessionId,
					note: "输入框角色 chip 已挂载（首轮即可选角）"
				});
			}, [sessionId]);
			/** 打开浮层：优先在按钮正上方，上方放不下就翻到下方。 */
			const toggle = (0, react.useCallback)(() => {
				const rect = buttonRef.current?.getBoundingClientRect();
				if (rect !== void 0) {
					const cards = state.library?.cards.length ?? 0;
					const height = Math.min(360, 118 + cards * 34);
					const left = Math.max(8, Math.min(rect.left, Math.max(8, window.innerWidth - 308)));
					const above = rect.top > height + 16;
					setAnchor(above ? {
						left,
						bottom: window.innerHeight - rect.top + 6
					} : {
						left,
						top: rect.bottom + 6
					});
				}
				setOpen((value) => !value);
			}, [state.library]);
			(0, react.useEffect)(() => {
				if (!open) return;
				const onDown = (event) => {
					const target = event.target;
					if (target !== null && buttonRef.current?.contains(target) === true) return;
					const panel = document.getElementById("dsh-cosplay-chip-panel");
					if (panel !== null && target !== null && panel.contains(target)) return;
					setOpen(false);
				};
				const onKey = (event) => {
					if (event.key === "Escape") setOpen(false);
				};
				document.addEventListener("mousedown", onDown);
				document.addEventListener("keydown", onKey);
				return () => {
					document.removeEventListener("mousedown", onDown);
					document.removeEventListener("keydown", onKey);
				};
			}, [open]);
			const card = sessionless ? defaultMeta : state.card;
			const label = card === null ? "无角色" : card.name;
			const title = sessionless ? card === null ? "还没有会话 · 点一下选一张卡作为新会话的默认角色" : `新会话默认角色：${card.name} · 点一下更换` : card === null ? "本会话还没有角色 · 点一下选一个（第一轮发送前就能选）" : `本会话角色：${card.name}${state.enabled ? "" : "（已停用）"} · 点一下更换`;
			/** 选中一张卡：有会话就绑本会话，没会话就写默认角色。 */
			const pick = (cardId) => {
				sessionless ? defaults?.set(cardId) : state.setCard(cardId);
				setOpen(false);
			};
			/**
			* 本会话是否换过卡（用来给一个诚实提示）。
			*
			* 为什么值得提示：换卡**只**改变之后注入的人设，历史里那些旧口吻的对话是
			* append-only 的 durable 记录、不会消失。想从干净上下文开始角色只能开新会话。
			*/
			const seen = state.binding?.binding.cardsSeen ?? [];
			const switched = !sessionless && seen.length > 1;
			const previousNames = seen.slice(1).reverse().map((id) => state.library?.cards.find((meta) => meta.id === id)?.name ?? id).join(" → ");
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
				ref: buttonRef,
				type: "button",
				className: `dsh-cosplay-chip${card === null ? " empty" : ""}${state.enabled ? "" : " off"}`,
				title,
				"aria-label": title,
				onClick: toggle,
				children: [
					card === null ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "dsh-cosplay-chip-emoji",
						children: "🎭"
					}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(CardAvatar, {
						meta: card,
						size: 14
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "dsh-cosplay-chip-name",
						children: label
					}),
					card !== null && card.mode !== "system" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "dsh-cosplay-chip-mode",
						children: modeLabel$1(card)
					}) : null
				]
			}), open && anchor !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				id: "dsh-cosplay-chip-panel",
				className: "dsh-cosplay-pop",
				style: {
					left: anchor.left,
					...anchor.top === void 0 ? { bottom: anchor.bottom } : { top: anchor.top },
					maxHeight: "min(60vh, 420px)"
				},
				role: "dialog",
				"aria-label": "选择本会话角色",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dsh-cosplay-pop-head",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: sessionless ? "新会话默认角色" : "本会话角色" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "dsh-cosplay-hint",
							children: sessionless ? "（还没有会话）" : state.enabled ? "" : "（已停用）"
						})]
					}),
					state.library === void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "dsh-cosplay-note",
						style: { padding: "8px 10px" },
						children: state.loading ? "读取中…" : "读不到卡片库（宿主半边没装上或没重挂？）"
					}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dsh-cosplay-pop-list",
						children: [(state.library.cards ?? []).map((meta) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
							type: "button",
							className: `dsh-cosplay-pop-item${meta.id === (sessionless ? defaultId : state.boundId) ? " active" : ""}`,
							onClick: () => pick(meta.id),
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(CardAvatar, {
									meta,
									size: 20
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
									className: "dsh-cosplay-pop-name",
									children: [meta.name, meta.source === "custom" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "dsh-cosplay-pop-tag",
										children: "自定义"
									}) : null]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "dsh-cosplay-pop-mode",
									children: modeLabel$1(meta)
								})
							]
						}, meta.id)), (state.library.cards ?? []).length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "dsh-cosplay-note",
							style: { padding: "8px 10px" },
							children: "卡片库是空的：去「角色」页签新建一张，或导入一个卡包"
						}) : null]
					}),
					state.error !== "" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "dsh-cosplay-error",
						style: { padding: "0 10px 6px" },
						children: state.error
					}) : null,
					switched ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dsh-cosplay-note",
						style: { padding: "0 10px 6px" },
						children: [
							"本会话换过卡（",
							previousNames,
							" → ",
							card?.name ?? "无角色",
							"）。历史里前面那些对话",
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: "不会" }),
							"随换卡改变，旧口吻还在；想让角色从干净上下文开始 → 新建会话 （会自动带上刚选的这张卡）。"
						]
					}) : null,
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dsh-cosplay-pop-foot",
						children: [
							sessionless ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "dsh-cosplay-btn tiny",
								onClick: () => {
									state.setEnabled(!state.enabled);
								},
								disabled: state.boundId === null,
								children: state.enabled ? "本会话停用" : "重新启用"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "dsh-cosplay-btn tiny",
								onClick: () => {
									if (sessionless) defaults?.set("");
									else state.setCard(null);
									setOpen(false);
								},
								children: sessionless ? "清空默认角色" : "清空角色"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: "dsh-cosplay-spacer" }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "dsh-cosplay-btn tiny",
								onClick: () => {
									if (sessionId !== "") openView?.(sessionId);
									setOpen(false);
								},
								disabled: openView === void 0 || sessionless,
								title: "卡片管理：编辑、导入导出、立绘。空白会话的页签要等第一轮开始才出现",
								children: "管理卡片…"
							})
						]
					})
				]
			}) : null] });
		}
		//#endregion
		//#region src/client/copy.ts
		/**
		* dsh-cosplay — 界面文案（集中一处，避免同一个词在不同地方写法不一致）。
		*
		* M1 只有中文；英文留 M2（届时在这里按 locale 分表即可，组件不动）。
		*/
		/** 页签标签（也是 `conversation.view` 条目的 label）。 */
		const VIEW_LABEL = "角色";
		/** 设置页标题。 */
		const SETTINGS_LABEL = "角色扮演";
		/** 常用按钮/状态文案。 */
		const COPY = {
			newCard: "新建角色卡",
			importPack: "导入卡包",
			exportAll: "导出全部",
			exportToDisk: "导出到磁盘",
			refresh: "刷新",
			inUse: "使用中",
			use: "在本会话使用",
			disable: "本会话停用",
			edit: "编辑",
			copyToCustom: "复制为自定义",
			remove: "删除",
			save: "保存",
			cancel: "取消",
			back: "返回列表",
			preview: "看大图",
			uploadArt: "上传立绘",
			clearArt: "移除立绘",
			presetReadonly: "预设卡只读",
			boundTo: "本会话角色",
			none: "（没有角色）",
			manualRewrite: "试改写一次"
		};
		//#endregion
		//#region src/client/settings.tsx
		/**
		* dsh-cosplay — 设置页（`settings.section`）。
		*
		* 与「角色」页签的分工：页签是**用**角色的地方（网格/详情/绑定），设置页是**管**库的地方
		* ——存储路径与占用、预设与自定义的数量、无引用立绘的清理、以及一张实时诊断表
		* （提示段/改写/durable 消息的计数 + 最近轨迹）。技术参数（模型、超时、上限）走
		* 插件自己的 Config 表单（侧栏「插件 → 已安装 → dsh-cosplay」），这里不重复画一遍。
		*/
		/** 时间戳 → 本地时分秒。 */
		function clockOf$1(at) {
			const date = new Date(at);
			const pad = (value) => String(value).padStart(2, "0");
			return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
		}
		/** 人类可读的体积。 */
		function mb(bytes) {
			return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
		}
		/** 设置页。 */
		function CosplaySettings({ scope }) {
			const [data, setData] = (0, react.useState)(void 0);
			const [library, setLibrary] = (0, react.useState)(void 0);
			const [note, setNote] = (0, react.useState)("");
			const [error, setError] = (0, react.useState)("");
			const snapshot = (0, react.useSyncExternalStore)((listener) => scope.subscribe(listener), () => scope.getSnapshot(), () => scope.getSnapshot());
			const config = {
				...DEFAULT_CONFIG,
				...snapshot.value ?? {}
			};
			const refresh = (0, react.useCallback)(async () => {
				const [next, nextLibrary] = await Promise.all([fetchDiagnostics(), fetchLibrary()]);
				setData(next);
				setLibrary(nextLibrary);
				setError(next === void 0 ? "读不到 /api/dsh-cosplay/diagnostics —— 宿主半边没装上或没重挂" : "");
			}, []);
			(0, react.useEffect)(() => {
				refresh();
				const timer = setInterval(() => void refresh(), 5e3);
				return () => clearInterval(timer);
			}, [refresh]);
			const info = data?.info;
			const stats = data?.stats;
			const cards = library?.cards ?? [];
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dsh-cosplay-view",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dsh-cosplay-head",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "dsh-cosplay-title",
							children: SETTINGS_LABEL
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "dsh-cosplay-sub",
							children: "卡片库管理 + 实时诊断（技术参数在「插件 → dsh-cosplay」的表单里）"
						})]
					}),
					error !== "" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "dsh-cosplay-error",
						children: error
					}) : null,
					note !== "" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "dsh-cosplay-ok",
						children: note
					}) : null,
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dsh-cosplay-card-panel",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "dsh-cosplay-card-title",
							children: "卡片库"
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("dl", {
							className: "dsh-cosplay-kv",
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: "目录" }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", { children: info?.root ?? "—" }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: "卡片" }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", { children: info === void 0 ? "—" : `${String(info.cards)} 张（预设 ${String(info.presets)} · 自定义 ${String(info.customs)}）` }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: "立绘" }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", { children: info === void 0 ? "—" : `${String(info.artFiles)} 张 · 库总体积 ${mb(info.bytes)}` }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: "无引用立绘" }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("dd", { children: [data === void 0 ? "—" : `${String(data.orphans)} 张`, data !== void 0 && data.orphans > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: "dsh-cosplay-btn tiny",
									style: { marginLeft: 8 },
									onClick: () => {
										(async () => {
											const result = await pruneArt();
											setNote(result?.ok === true ? `已清理 ${String(result.removed)} 张无引用立绘` : "清理失败");
											postDebug({
												kind: "art-prune",
												note: `removed=${String(result?.removed ?? "?")}`
											});
											await refresh();
										})();
									},
									children: "清理"
								}) : null] })
							]
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dsh-cosplay-card-panel",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "dsh-cosplay-card-title",
								children: "默认角色（新会话）"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "dsh-cosplay-bar",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
									className: "dsh-cosplay-select",
									style: { maxWidth: 320 },
									value: config.defaultCardId,
									disabled: !snapshot.writable,
									onChange: (event) => {
										const next = event.target.value;
										(async () => {
											const accepted = await scope.set("defaultCardId", next);
											postDebug({
												kind: "setting-default-card",
												...next === "" ? {} : { id: next },
												note: accepted ? `默认卡 → ${next === "" ? "（空）" : next}` : "写入被拒（设置不可写？）"
											});
											setNote(accepted ? `默认角色已设为 ${next === "" ? "（空）" : next}` : "写入被拒：这个部署的设置文档不接受写入");
										})();
									},
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
										value: "",
										children: "（不自动上角色）"
									}), cards.map((meta) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("option", {
										value: meta.id,
										children: [
											meta.cover?.emoji ?? "🎭",
											" ",
											meta.name,
											meta.source === "custom" ? "（自定义）" : ""
										]
									}, meta.id))]
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "dsh-cosplay-hint",
									children: "你在界面里打开过的会话会自动用这张卡（第一轮就生效）；没有默认卡时，新会话是「无角色」，可以用输入框左边的 chip 现选。"
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "dsh-cosplay-note",
								style: { marginTop: 6 },
								children: [
									"这条写的是插件配置里的 ",
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", { children: "defaultCardId" }),
									snapshot.status !== "ready" ? `（当前设置状态：${snapshot.status}）` : "",
									"。 想让\"从没在界面里打开过的会话\"（含 subagent）也套用，需要另外打开插件配置里的 `injectIntoUnboundSessions`。"
								]
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dsh-cosplay-card-panel",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "dsh-cosplay-card-title",
							children: "链路计数（宿主实时读数）"
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("dl", {
							className: "dsh-cosplay-kv",
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: "人设注入" }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("dd", { children: [
									"提示段求值 ",
									stats?.sectionCalls ?? "—",
									" 次 · 产出正文 ",
									stats?.sectionFilled ?? "—",
									" 次"
								] }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: "身份探针" }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("dd", {
									className: (stats?.sectionUnresolved ?? 0) + (stats?.preStepUnresolved ?? 0) > 0 ? "dsh-cosplay-error" : void 0,
									children: [
										"取不到会话身份：提示段 ",
										stats?.sectionUnresolved ?? "—",
										" 次 · pre-step ",
										stats?.preStepUnresolved ?? "—",
										" 次",
										(stats?.sectionUnresolved ?? 0) + (stats?.preStepUnresolved ?? 0) > 0 ? "（应恒为 0；>0 说明 DSH 改了装配上下文/载荷形状，角色会静默失效）" : "（应恒为 0）"
									]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: "改写链路" }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("dd", { children: [
									"pre-step 调用 ",
									stats?.preStepCalls ?? "—",
									" 次 · 改写 ",
									stats?.preStepRewrote ?? "—",
									" 次 · durable 用户消息",
									" ",
									stats?.durableUserMessages ?? "—",
									" 条"
								] }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: "模型改写" }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("dd", { children: [
									"调用 ",
									stats?.rewrite.calls ?? "—",
									" · 成功 ",
									stats?.rewrite.ok ?? "—",
									" · 失败 ",
									stats?.rewrite.failed ?? "—",
									" · 缓存",
									" ",
									stats?.rewrite.cached ?? "—",
									" · 最近 ",
									stats?.rewrite.lastMs ?? 0,
									"ms ",
									stats?.rewrite.lastModel ?? ""
								] })
							]
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dsh-cosplay-card-panel",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "dsh-cosplay-card-title",
							children: "最近诊断（最新在前 · 每 5 秒刷新）"
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dsh-cosplay-trace",
							children: [(data?.trace ?? []).map((entry, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "dsh-cosplay-trace-kind",
									children: entry.kind
								}),
								" ",
								clockOf$1(entry.at),
								" ",
								entry.sessionId === void 0 ? "" : `[${entry.sessionId.slice(-8)}] `,
								entry.note
							] }, `${String(entry.at)}-${String(index)}`)), (data?.trace.length ?? 0) === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dsh-cosplay-note",
								children: "（暂无回执）"
							}) : null]
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dsh-cosplay-note",
						children: [
							"常用命令：",
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", { children: "/cosplay" }),
							" 状态 · ",
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", { children: "/cosplay list" }),
							" 清单 · ",
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", { children: "/cosplay off" }),
							" 本会话关闭 ·",
							" ",
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", { children: "/cosplay <名字>" }),
							" 换卡。界面出问题时命令是你的逃生阀。"
						]
					})
				]
			});
		}
		//#endregion
		//#region src/client/styles.ts
		/**
		* dsh-cosplay — 浏览器半边的样式。
		*
		* ## 为什么手写 CSS 而不引官方 primitives
		*
		* `@deepseek-ai/dsh-client-ui-primitives` 在基线模块表里、可以用（它的 Button/Input/Tag
		* 都是现成的）。这里仍然手写，理由只有一个：**角色卡网格的几何与 DSH 原版是同一套
		* 主题变量**（`--dsw-alias-*`），而卡片尺寸/圆角/描边/悬停要按立绘比例精确控制，
		* 套一层组件反而要跟它的内联样式打架。所有颜色一律走主题变量，明暗主题自动跟随。
		*
		* 变量名照 `cordis_inspect` 的 Theme.listTokens 实测清单（14 个）：
		*   bg-base / bg-layer-1 / bg-layer-2 / bg-overlay / border-l1 / border-l2
		*   brand-primary / label-primary / label-secondary / state-{error,idle,success,warn}-primary
		*   specific-sidebar-fill
		*/
		/** 插件样式表。 */
		const CSS = `
.dsh-cosplay-view {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 16px 20px 28px;
  color: var(--dsw-alias-label-primary, inherit);
}
.dsh-cosplay-head { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
.dsh-cosplay-title { font-size: 14px; font-weight: 600; letter-spacing: 0.01em; }
.dsh-cosplay-sub { font-size: 12px; color: var(--dsw-alias-label-secondary, #667085); }
.dsh-cosplay-spacer { flex: 1; }

.dsh-cosplay-bar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.dsh-cosplay-card-panel {
  border: 1px solid var(--dsw-alias-border-l1, #e4e7ec);
  background: var(--dsw-alias-bg-layer-1, transparent);
  border-radius: 12px;
  padding: 12px 14px;
}
.dsh-cosplay-card-title {
  font-size: 12px; font-weight: 600; color: var(--dsw-alias-label-secondary, #667085);
  margin-bottom: 8px; letter-spacing: 0.02em;
}

/* ── 按钮 ─────────────────────────────────────────────────────────── */
.dsh-cosplay-btn {
  appearance: none; border: 1px solid var(--dsw-alias-border-l1, #e4e7ec);
  background: var(--dsw-alias-bg-layer-2, rgba(127,127,127,0.06));
  color: var(--dsw-alias-label-primary, inherit);
  border-radius: 8px; padding: 6px 12px; font-size: 12px; line-height: 1.4;
  cursor: pointer; transition: border-color 120ms ease, background 120ms ease, opacity 120ms ease;
  white-space: nowrap;
}
.dsh-cosplay-btn:hover:not(:disabled) { border-color: var(--dsw-alias-brand-primary, #4d6bfe); }
.dsh-cosplay-btn:disabled { opacity: 0.45; cursor: not-allowed; }
.dsh-cosplay-btn.primary {
  background: var(--dsw-alias-brand-primary, #4d6bfe); border-color: var(--dsw-alias-brand-primary, #4d6bfe);
  color: #fff; font-weight: 600;
}
.dsh-cosplay-btn.danger:hover:not(:disabled) { border-color: var(--dsw-alias-state-error-primary, #d92d20); color: var(--dsw-alias-state-error-primary, #d92d20); }
.dsh-cosplay-btn.tiny { padding: 3px 8px; font-size: 11px; border-radius: 6px; }

/* ── 卡片网格 ─────────────────────────────────────────────────────── */
.dsh-cosplay-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 12px; }
.dsh-cosplay-tile {
  position: relative; display: flex; flex-direction: column;
  border-radius: 12px; border: 1px solid var(--dsw-alias-border-l1, #e4e7ec);
  background: var(--dsw-alias-bg-layer-2, rgba(127,127,127,0.05));
  overflow: hidden; cursor: pointer; padding: 0; text-align: left;
  transition: border-color 120ms ease, transform 120ms ease, box-shadow 120ms ease;
  color: inherit;
}
.dsh-cosplay-tile:hover { border-color: var(--dsw-alias-brand-primary, #4d6bfe); transform: translateY(-1px); }
.dsh-cosplay-tile.active {
  border-color: var(--dsw-alias-brand-primary, #4d6bfe);
  box-shadow: 0 0 0 1px var(--dsw-alias-brand-primary, #4d6bfe) inset;
}
.dsh-cosplay-tile-art { position: relative; width: 100%; aspect-ratio: 1 / 1; overflow: hidden; display: flex; align-items: center; justify-content: center; }
.dsh-cosplay-tile-art img { width: 100%; height: 100%; object-fit: cover; display: block; }
.dsh-cosplay-tile-fallback { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; font-size: 34px; }
.dsh-cosplay-tile-meta { padding: 8px 10px 10px; display: flex; flex-direction: column; gap: 2px; }
.dsh-cosplay-tile-name { font-size: 13px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsh-cosplay-tile-desc { font-size: 11px; color: var(--dsw-alias-label-secondary, #667085); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsh-cosplay-badges { position: absolute; top: 6px; left: 6px; right: 6px; display: flex; gap: 4px; align-items: flex-start; flex-wrap: wrap; pointer-events: none; }
.dsh-cosplay-badge {
  font-size: 10px; line-height: 1; padding: 3px 6px; border-radius: 999px;
  background: var(--dsw-alias-bg-overlay, rgba(0,0,0,0.55)); color: var(--dsw-alias-label-primary, #fff);
  border: 1px solid var(--dsw-alias-border-l2, rgba(255,255,255,0.25));
}
.dsh-cosplay-badge.brand { background: var(--dsw-alias-brand-primary, #4d6bfe); border-color: transparent; color: #fff; font-weight: 600; }

/* ── 二级详情 ─────────────────────────────────────────────────────── */
.dsh-cosplay-detail { display: grid; grid-template-columns: minmax(180px, 260px) 1fr; gap: 18px; align-items: start; }
.dsh-cosplay-detail-art {
  width: 100%; aspect-ratio: 1 / 1; border-radius: 12px; overflow: hidden;
  border: 1px solid var(--dsw-alias-border-l1, #e4e7ec); background: var(--dsw-alias-bg-layer-2, rgba(127,127,127,0.06));
  display: flex; align-items: center; justify-content: center; cursor: zoom-in;
}
.dsh-cosplay-detail-art img { width: 100%; height: 100%; object-fit: cover; display: block; }
.dsh-cosplay-detail-body { display: flex; flex-direction: column; gap: 10px; min-width: 0; }
.dsh-cosplay-h2 { font-size: 16px; font-weight: 600; }
.dsh-cosplay-desc { font-size: 12px; color: var(--dsw-alias-label-secondary, #667085); }
.dsh-cosplay-tags { display: flex; gap: 6px; flex-wrap: wrap; }
.dsh-cosplay-tag {
  font-size: 11px; padding: 2px 8px; border-radius: 999px;
  border: 1px solid var(--dsw-alias-border-l1, #e4e7ec); color: var(--dsw-alias-label-secondary, #667085);
}
.dsh-cosplay-pre {
  font-family: var(--dsh-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
  font-size: 11px; line-height: 1.6; white-space: pre-wrap; word-break: break-word;
  background: var(--dsw-alias-bg-layer-2, rgba(127,127,127,0.06));
  border: 1px solid var(--dsw-alias-border-l1, #e4e7ec); border-radius: 8px;
  padding: 10px 12px; max-height: 220px; overflow: auto; margin: 0;
}

/* ── 表单 ─────────────────────────────────────────────────────────── */
.dsh-cosplay-form { display: flex; flex-direction: column; gap: 12px; }
.dsh-cosplay-field { display: flex; flex-direction: column; gap: 4px; }
.dsh-cosplay-label { font-size: 12px; color: var(--dsw-alias-label-secondary, #667085); }
.dsh-cosplay-hint { font-size: 11px; color: var(--dsw-alias-label-secondary, #667085); }
.dsh-cosplay-input, .dsh-cosplay-textarea, .dsh-cosplay-select {
  width: 100%; box-sizing: border-box;
  background: var(--dsw-alias-bg-base, transparent); color: var(--dsw-alias-label-primary, inherit);
  border: 1px solid var(--dsw-alias-border-l1, #e4e7ec); border-radius: 8px;
  padding: 7px 10px; font-size: 13px; font-family: inherit;
}
.dsh-cosplay-textarea { min-height: 120px; resize: vertical; line-height: 1.6; font-family: var(--dsh-font-mono, ui-monospace, Menlo, monospace); font-size: 12px; }
.dsh-cosplay-row { display: flex; gap: 10px; flex-wrap: wrap; }
.dsh-cosplay-row > .dsh-cosplay-field { flex: 1; min-width: 140px; }

/* ── 原文 ↔ 改写后 对照 ─────────────────────────────────────────── */
.dsh-cosplay-compare {
  display: grid; grid-template-columns: 1fr 1fr; gap: 8px;
  margin-top: 6px; align-items: start;
}
.dsh-cosplay-compare > div { min-width: 0; }
.dsh-cosplay-compare .dsh-cosplay-pre { max-height: 220px; overflow: auto; margin-top: 2px; }
@media (max-width: 720px) { .dsh-cosplay-compare { grid-template-columns: 1fr; } }

/* ── 诊断 ─────────────────────────────────────────────────────────── */
.dsh-cosplay-kv { display: grid; grid-template-columns: max-content 1fr; gap: 4px 12px; font-size: 12px; }
.dsh-cosplay-kv dt { color: var(--dsw-alias-label-secondary, #667085); }
.dsh-cosplay-kv dd { margin: 0; font-variant-numeric: tabular-nums; min-width: 0; word-break: break-all; }
.dsh-cosplay-trace {
  max-height: 240px; overflow: auto; font-size: 11px; line-height: 1.7;
  font-family: var(--dsh-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
  white-space: pre-wrap; word-break: break-word;
}
.dsh-cosplay-trace-kind { color: var(--dsw-alias-brand-primary, #4d6bfe); }
.dsh-cosplay-note { font-size: 12px; color: var(--dsw-alias-label-secondary, #667085); line-height: 1.6; }
.dsh-cosplay-error { font-size: 12px; color: var(--dsw-alias-state-error-primary, #d92d20); }
.dsh-cosplay-ok { font-size: 12px; color: var(--dsw-alias-state-success-primary, #12b76a); }
.dsh-cosplay-issues { font-size: 11px; color: var(--dsw-alias-state-warn-primary, #dc6803); display: flex; flex-direction: column; gap: 2px; }

/* ── 输入框工具行里的角色 chip + 浮层 ─────────────────────────────── */
.dsh-cosplay-chip {
  display: inline-flex; align-items: center; gap: 5px;
  height: 24px; padding: 0 8px; border-radius: 999px;
  border: 1px solid var(--dsw-alias-border-l1, #e4e7ec);
  background: var(--dsw-alias-bg-layer-2, rgba(127,127,127,0.06));
  color: var(--dsw-alias-label-primary, inherit);
  font-size: 12px; line-height: 1; cursor: pointer; white-space: nowrap;
  transition: border-color 120ms ease, opacity 120ms ease;
}
.dsh-cosplay-chip:hover { border-color: var(--dsw-alias-brand-primary, #4d6bfe); }
.dsh-cosplay-chip.empty { color: var(--dsw-alias-label-secondary, #667085); }
.dsh-cosplay-chip.off { opacity: 0.55; }
.dsh-cosplay-chip-emoji { font-size: 12px; line-height: 1; }
.dsh-cosplay-chip-name { max-width: 96px; overflow: hidden; text-overflow: ellipsis; }
.dsh-cosplay-chip-mode {
  font-size: 10px; padding: 1px 5px; border-radius: 999px;
  background: var(--dsw-alias-brand-primary, #4d6bfe); color: #fff; font-weight: 600;
}
.dsh-cosplay-avatar { border-radius: 6px; object-fit: cover; display: inline-block; flex: none; }
.dsh-cosplay-avatar.fallback {
  display: inline-flex; align-items: center; justify-content: center;
  font-size: 11px; border-radius: 6px; flex: none;
}
.dsh-cosplay-pop {
  position: fixed; z-index: 60; width: 300px;
  display: flex; flex-direction: column;
  background: var(--dsw-alias-bg-overlay, var(--dsw-alias-bg-layer-1, #fff));
  border: 1px solid var(--dsw-alias-border-l1, #e4e7ec);
  border-radius: 12px; box-shadow: 0 12px 32px rgba(0,0,0,0.18);
  overflow: hidden;
}
.dsh-cosplay-pop-head {
  display: flex; align-items: baseline; gap: 6px;
  padding: 8px 10px; font-size: 12px; font-weight: 600;
  color: var(--dsw-alias-label-secondary, #667085);
  border-bottom: 1px solid var(--dsw-alias-border-l1, #e4e7ec);
}
.dsh-cosplay-pop-list { overflow: auto; max-height: 260px; padding: 4px; }
.dsh-cosplay-pop-item {
  display: flex; align-items: center; gap: 8px; width: 100%;
  padding: 5px 6px; border-radius: 8px; border: 1px solid transparent;
  background: transparent; color: inherit; font-size: 12px; text-align: left; cursor: pointer;
}
.dsh-cosplay-pop-item:hover { background: var(--dsw-alias-bg-layer-2, rgba(127,127,127,0.08)); }
.dsh-cosplay-pop-item.active { border-color: var(--dsw-alias-brand-primary, #4d6bfe); }
.dsh-cosplay-pop-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsh-cosplay-pop-tag {
  margin-left: 6px; font-size: 10px; padding: 1px 5px; border-radius: 999px;
  border: 1px solid var(--dsw-alias-border-l1, #e4e7ec); color: var(--dsw-alias-label-secondary, #667085);
}
.dsh-cosplay-pop-mode { font-size: 10px; color: var(--dsw-alias-label-secondary, #667085); flex: none; }
.dsh-cosplay-pop-foot {
  display: flex; align-items: center; gap: 6px;
  padding: 8px 10px; border-top: 1px solid var(--dsw-alias-border-l1, #e4e7ec);
}
`;
		//#endregion
		//#region src/prompt.ts
		/**
		* 组装"改写调用"的 system prompt。
		*
		* 关键在输出纪律：改写结果的正文会被**逐字当成用户消息**写进会话日志，
		* 所以任何"好的，我来帮你改写如下："之类的开场白都会变成模型看到的需求正文。
		*/
		function composeRewriteSystem(card) {
			const rules = card.rewrite?.rules?.trim() ?? "";
			if (rules === "") return "";
			const parts = [rules];
			const examples = card.rewrite?.examples ?? [];
			if (examples.length > 0) {
				const rendered = examples.map((pair, index) => `### 示例 ${index + 1}\n输入：${pair.input}\n输出：${pair.output}`).join("\n\n");
				parts.push(`## 转换示例\n${rendered}`);
			}
			parts.push([
				"## 输出纪律（必须遵守）",
				"- 只输出改写后的最终提示词正文；",
				"- 不要解释、不要复述规则、不要提问、不要等待确认；",
				"- 不要用引号、代码块围栏或任何包裹层；",
				"- 保持原文里的事实性要求（对象、数量、专有名词、明确约束），只改写风格与结构。",
				"",
				"## 指代纪律（必须遵守）",
				"- 文本里的指代（它 / 这个 / 那个 / 上一个 / 刚才说的）要换成【最近对话】里真实出现过的具体对象，例如把\"把这个提交到仓库\"写成\"把上一轮交付的 miku 页面（miku/index.html）提交到仓库\"。",
				"- 解析不出来就原样保留那个指代词（仍写\"把这个提交到仓库\"），把\"你正在遵守的这套改写规则与角色设定\"当作风格模板，而不是用户的任务对象。"
			].join("\n"));
			return parts.join("\n\n");
		}
		//#endregion
		//#region src/client/image.ts
		/** data URL → base64（去掉前缀）。 */
		function stripDataUrl(dataUrl) {
			const comma = dataUrl.indexOf(",");
			return comma < 0 ? dataUrl : dataUrl.slice(comma + 1);
		}
		/** 读文件为 data URL。 */
		function readAsDataUrl(file) {
			return new Promise((resolve, reject) => {
				const reader = new FileReader();
				reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
				reader.onerror = () => reject(reader.error ?? /* @__PURE__ */ new Error("读取文件失败"));
				reader.readAsDataURL(file);
			});
		}
		/** 解开一张图。 */
		function decode(dataUrl) {
			return new Promise((resolve, reject) => {
				const image = new Image();
				image.onload = () => resolve(image);
				image.onerror = () => reject(/* @__PURE__ */ new Error("图片解码失败"));
				image.src = dataUrl;
			});
		}
		/**
		* 把用户选的文件压成立绘。
		* @param file - 用户选的文件。
		* @param maxEdge - 最长边上限（px）。
		* @param quality - JPEG/WebP 质量（0..1）。
		*/
		async function prepareArt(file, maxEdge, quality) {
			const source = await readAsDataUrl(file);
			const image = await decode(source);
			const width = image.naturalWidth || image.width;
			const height = image.naturalHeight || image.height;
			if (width === 0 || height === 0) throw new Error("图片尺寸为 0，换一张试试");
			const scale = Math.min(1, Math.max(64, Math.floor(maxEdge)) / Math.max(width, height));
			const targetW = Math.max(1, Math.round(width * scale));
			const targetH = Math.max(1, Math.round(height * scale));
			const canvas = document.createElement("canvas");
			canvas.width = targetW;
			canvas.height = targetH;
			const context = canvas.getContext("2d");
			if (context === null) return {
				base64: stripDataUrl(source),
				mime: file.type === "" ? "image/png" : file.type,
				width,
				height,
				sourceBytes: file.size
			};
			const png = file.type === "image/png" || file.type === "image/gif" || file.type === "image/webp";
			if (!png) {
				context.fillStyle = "#ffffff";
				context.fillRect(0, 0, targetW, targetH);
			}
			context.imageSmoothingQuality = "high";
			context.drawImage(image, 0, 0, targetW, targetH);
			const mime = png ? "image/png" : "image/jpeg";
			return {
				base64: stripDataUrl(canvas.toDataURL(mime, png ? void 0 : Math.min(1, Math.max(.1, quality)))),
				mime,
				width: targetW,
				height: targetH,
				sourceBytes: file.size
			};
		}
		//#endregion
		//#region src/client/editor.tsx
		/**
		* dsh-cosplay — 角色卡编辑器（二级界面里的"编辑"）。
		*
		* 形状刻意贴 DSH 原版：**没有独立弹窗**，就在页签里就地展开（与"角色卡 → 点击 → 二级界面"
		* 是同一层），字段用主题变量画的输入框，保存/取消固定在底部。
		*
		* 立绘走"选文件 → canvas 压到上限 → POST /art"三步；拿到的是宿主算好的 sha256 引用，
		* 所以同一张图重复上传不会存两份（按内容去重）。
		*/
		/** 由卡片生成草稿。 */
		function draftOf(card) {
			return {
				id: card?.id ?? "",
				name: card?.name ?? "",
				title: card?.title ?? "",
				description: card?.description ?? "",
				tagsText: (card?.tags ?? []).join(" "),
				mode: card?.mode ?? "system",
				persona: card?.persona ?? "",
				rewriteRules: card?.rewrite?.rules ?? "",
				examples: card?.rewrite?.examples ?? [],
				coverEmoji: card?.cover?.emoji ?? "",
				art: card?.art ?? null
			};
		}
		/** 草稿 → 提交给宿主的卡片（宿主会再规范化一遍）。 */
		function cardOf(draft) {
			const tags = draft.tagsText.split(/[\s,，]+/).map((tag) => tag.trim()).filter((tag) => tag !== "");
			const examples = draft.examples.filter((pair) => pair.input.trim() !== "" && pair.output.trim() !== "");
			return {
				...draft.id === "" ? {} : { id: draft.id },
				name: draft.name,
				...draft.title.trim() === "" ? {} : { title: draft.title.trim() },
				...draft.description.trim() === "" ? {} : { description: draft.description.trim() },
				...tags.length === 0 ? {} : { tags },
				mode: draft.mode,
				...draft.persona.trim() === "" ? {} : { persona: draft.persona },
				...draft.rewriteRules.trim() === "" ? {} : { rewrite: {
					rules: draft.rewriteRules,
					...examples.length === 0 ? {} : { examples }
				} },
				cover: draft.coverEmoji.trim() === "" ? null : { emoji: draft.coverEmoji.trim() },
				art: draft.art ?? null,
				source: "custom"
			};
		}
		/** 角色卡编辑器。 */
		function CardEditor({ initial, artMaxEdge, artQuality, onSaved, onCancel }) {
			const [draft, setDraft] = (0, react.useState)(() => draftOf(initial));
			const [busy, setBusy] = (0, react.useState)(false);
			const [error, setError] = (0, react.useState)("");
			const [issues, setIssues] = (0, react.useState)([]);
			const fileRef = (0, react.useRef)(null);
			/** 改一个字段。 */
			const set = (key, value) => setDraft((previous) => ({
				...previous,
				[key]: value
			}));
			/** 选立绘 → 压缩 → 上传。 */
			const onPickArt = async (event) => {
				const file = event.target.files?.[0];
				event.target.value = "";
				if (file === void 0) return;
				setBusy(true);
				setError("");
				try {
					const prepared = await prepareArt(file, artMaxEdge, artQuality);
					const stored = await uploadArt({
						base64: prepared.base64,
						width: prepared.width,
						height: prepared.height
					});
					if (stored === void 0 || !stored.ok || stored.art === null) {
						setError(stored?.issues?.[0]?.message ?? "立绘上传失败");
						return;
					}
					set("art", stored.art);
					postDebug({
						kind: "art-uploaded",
						id: stored.art.artId,
						note: `${prepared.width}x${prepared.height} · ${Math.round(prepared.sourceBytes / 1024)}KB → ${Math.round(stored.art.bytes / 1024)}KB · sha=${stored.art.sha256.slice(0, 8)}`
					});
				} catch (failure) {
					setError(failure instanceof Error ? failure.message : String(failure));
				} finally {
					setBusy(false);
				}
			};
			/** 保存。 */
			const onSave = async () => {
				setBusy(true);
				setError("");
				setIssues([]);
				try {
					const result = await saveCard(cardOf(draft));
					if (result === void 0) {
						setError("宿主没有响应（插件还在吗？）");
						return;
					}
					setIssues(result.issues.map((issue) => `${issue.where}：${issue.message}`));
					if (result.ok && result.card !== null) {
						postDebug({
							kind: "card-saved",
							id: result.card.id,
							note: `「${result.card.name}」mode=${result.card.mode}`
						});
						onSaved(result.card);
						return;
					}
					setError("保存被拒绝，看看下面的提示");
				} finally {
					setBusy(false);
				}
			};
			/** 删卡。 */
			const onDelete = async () => {
				if (draft.id === "") return;
				setBusy(true);
				try {
					const result = await deleteCard(draft.id);
					postDebug({
						kind: "card-deleted",
						id: draft.id,
						note: result?.ok === true ? "ok" : "failed"
					});
					if (result?.ok === true) onCancel();
					else setError("删除失败（预设卡不能删；自定义卡才行）");
				} finally {
					setBusy(false);
				}
			};
			const isPreset = initial?.source === "preset";
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dsh-cosplay-form",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dsh-cosplay-bar",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
								type: "button",
								className: "dsh-cosplay-btn",
								onClick: onCancel,
								disabled: busy,
								children: ["← ", COPY.back]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dsh-cosplay-sub",
								children: draft.id === "" ? "新建自定义角色卡" : `编辑 ${draft.id}`
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: "dsh-cosplay-spacer" }),
							draft.id !== "" && !isPreset ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "dsh-cosplay-btn danger",
								onClick: () => void onDelete(),
								disabled: busy,
								children: COPY.remove
							}) : null,
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "dsh-cosplay-btn primary",
								onClick: () => void onSave(),
								disabled: busy || draft.name.trim() === "",
								children: busy ? "处理中…" : COPY.save
							})
						]
					}),
					error !== "" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "dsh-cosplay-error",
						children: error
					}) : null,
					issues.length > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "dsh-cosplay-issues",
						children: issues.map((issue, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: ["· ", issue] }, `${String(index)}-${issue}`))
					}) : null,
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dsh-cosplay-row",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
							className: "dsh-cosplay-field",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dsh-cosplay-label",
								children: "名字（必填，≤24 字）"
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								className: "dsh-cosplay-input",
								value: draft.name,
								onChange: (event) => set("name", event.target.value),
								placeholder: "例如：赛博猫娘"
							})]
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
							className: "dsh-cosplay-field",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dsh-cosplay-label",
								children: "称号 / 副标题"
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								className: "dsh-cosplay-input",
								value: draft.title,
								onChange: (event) => set("title", event.target.value),
								placeholder: "例如：猫耳 AI 终端 · 零式"
							})]
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
						className: "dsh-cosplay-field",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "dsh-cosplay-label",
							children: "一句话简介（卡片上显示）"
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
							className: "dsh-cosplay-input",
							value: draft.description,
							onChange: (event) => set("description", event.target.value),
							placeholder: "例如：每句话以「喵~」结尾，技术照样给对"
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dsh-cosplay-row",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
								className: "dsh-cosplay-field",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "dsh-cosplay-label",
									children: "标签（空格分隔，≤8 个）"
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									className: "dsh-cosplay-input",
									value: draft.tagsText,
									onChange: (event) => set("tagsText", event.target.value),
									placeholder: "人设 可爱 通用"
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
								className: "dsh-cosplay-field",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "dsh-cosplay-label",
									children: "占位表情（没有立绘时显示）"
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									className: "dsh-cosplay-input",
									value: draft.coverEmoji,
									onChange: (event) => set("coverEmoji", event.target.value),
									placeholder: "🐱"
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
								className: "dsh-cosplay-field",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "dsh-cosplay-label",
									children: "生效方式"
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
									className: "dsh-cosplay-select",
									value: draft.mode,
									onChange: (event) => set("mode", event.target.value),
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
											value: "system",
											children: "人设注入（模型以角色身份作答）"
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
											value: "rewrite",
											children: "改写输入（模型收到改写后的 prompt）"
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
											value: "both",
											children: "两者都要"
										})
									]
								})]
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dsh-cosplay-field",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "dsh-cosplay-label",
							children: "立绘（可选）"
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dsh-cosplay-bar",
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									ref: fileRef,
									type: "file",
									accept: "image/*",
									style: { display: "none" },
									onChange: (event) => void onPickArt(event)
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: "dsh-cosplay-btn",
									onClick: () => fileRef.current?.click(),
									disabled: busy,
									children: COPY.uploadArt
								}),
								draft.art !== null && draft.art !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
									className: "dsh-cosplay-sub",
									children: [
										draft.art.mime,
										" · ",
										Math.round(draft.art.bytes / 1024),
										" KB · ",
										String(draft.art.width ?? "?"),
										"×",
										String(draft.art.height ?? "?")
									]
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: "dsh-cosplay-btn tiny",
									onClick: () => set("art", null),
									disabled: busy,
									children: COPY.clearArt
								})] }) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "dsh-cosplay-hint",
									children: "没立绘就用占位表情，卡片照样好看"
								})
							]
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
						className: "dsh-cosplay-field",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "dsh-cosplay-label",
							children: "人设（注入系统提示的正文；`system` / `both` 用）"
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("textarea", {
							className: "dsh-cosplay-textarea",
							value: draft.persona,
							onChange: (event) => set("persona", event.target.value),
							placeholder: "你是……语气……称呼……禁忌……"
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
						className: "dsh-cosplay-field",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "dsh-cosplay-label",
							children: "改写规则（改写调用的 system prompt 主体；`rewrite` / `both` 用）"
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("textarea", {
							className: "dsh-cosplay-textarea",
							value: draft.rewriteRules,
							onChange: (event) => set("rewriteRules", event.target.value),
							placeholder: "你是……转换专家。规则 1……规则 2……"
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dsh-cosplay-field",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dsh-cosplay-label",
								children: "改写示例（few-shot，≤4 组；可选但很有用）"
							}),
							draft.examples.map((pair, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "dsh-cosplay-row",
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
										className: "dsh-cosplay-field",
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
											className: "dsh-cosplay-hint",
											children: ["输入 ", index + 1]
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
											className: "dsh-cosplay-input",
											value: pair.input,
											onChange: (event) => set("examples", draft.examples.map((item, at) => at === index ? {
												...item,
												input: event.target.value
											} : item))
										})]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
										className: "dsh-cosplay-field",
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
											className: "dsh-cosplay-hint",
											children: ["输出 ", index + 1]
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
											className: "dsh-cosplay-input",
											value: pair.output,
											onChange: (event) => set("examples", draft.examples.map((item, at) => at === index ? {
												...item,
												output: event.target.value
											} : item))
										})]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: "dsh-cosplay-btn tiny",
										onClick: () => set("examples", draft.examples.filter((_item, at) => at !== index)),
										children: "移除"
									})
								]
							}, `ex-${String(index)}`)),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "dsh-cosplay-bar",
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: "dsh-cosplay-btn tiny",
									onClick: () => set("examples", [...draft.examples, {
										input: "",
										output: ""
									}]),
									disabled: draft.examples.length >= 4,
									children: "+ 加一组示例"
								})
							})
						]
					})
				]
			});
		}
		//#endregion
		//#region src/client/view.tsx
		/**
		* dsh-cosplay — 「角色」页签（`conversation.view` 的入口 id `cosplay`）。
		*
		* ## 形状
		*
		* 一级：近方形圆角卡片的网格（有立绘就用立绘，没有就用占位表情 + 名字）。
		* 点一张 → 二级详情（大图 + 人设/规则全文 + 使用/停用/编辑/复制/导出/删除）。
		* 详情里点"编辑" → 就地变成编辑器（同一个页签里，不弹窗）。
		*
		* ## 这一层负责的策略（写在这里，免得将来忘了为什么）
		*
		* "默认卡"由**本页签在会话里第一次打开时**写成本会话的显式绑定：于是只有你真的
		* 打开过角色页签的会话才会自动上角色，subagent / 后台会话不会被悄悄套上人设
		* （宿主侧的 `injectIntoUnboundSessions` 默认关着，就是这条的兜底）。
		*/
		/** 已经报过"挂载"的会话（模块级去重；渲染期只写模块变量，不 setState）。 */
		const mountedReported = /* @__PURE__ */ new Set();
		/** 时间戳 → 本地时分。 */
		function clockOf(at) {
			const date = new Date(at);
			const pad = (value) => String(value).padStart(2, "0");
			return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
		}
		/** 卡片上的模式角标。 */
		function modeLabel(mode) {
			return mode === "system" ? "人设" : mode === "rewrite" ? "改写" : "人设+改写";
		}
		/** 一张卡片。 */
		function CardTile({ meta, active, aspect, onOpen }) {
			const hue = meta.cover?.hue ?? 210;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
				type: "button",
				className: `dsh-cosplay-tile${active ? " active" : ""}`,
				onClick: onOpen,
				title: meta.description ?? meta.name,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "dsh-cosplay-tile-art",
						style: { aspectRatio: `${String(aspect)} / 1` },
						children: meta.artUrl === void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "dsh-cosplay-tile-fallback",
							style: { background: `linear-gradient(140deg, hsl(${String(hue)} 70% 62% / 0.35), hsl(${String((hue + 48) % 360)} 70% 55% / 0.22))` },
							children: meta.cover?.emoji ?? "🎭"
						}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("img", {
							src: meta.artUrl,
							alt: meta.name,
							loading: "lazy",
							draggable: false
						})
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						className: "dsh-cosplay-badges",
						children: [active ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "dsh-cosplay-badge brand",
							children: COPY.inUse
						}) : null, meta.source === "preset" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "dsh-cosplay-badge",
							children: "预设"
						}) : null]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						className: "dsh-cosplay-tile-meta",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "dsh-cosplay-tile-name",
							children: meta.name
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "dsh-cosplay-tile-desc",
							children: meta.description ?? `${modeLabel(meta.mode)}${meta.source === "custom" ? " · 自定义" : ""}`
						})]
					})
				]
			});
		}
		/** 「角色」页签。 */
		function CosplayView(props) {
			const sessionId = typeof props.sessionId === "string" ? props.sessionId : "";
			const session = useSessionCard(sessionId);
			const library = session.library;
			const [screen, setScreen] = (0, react.useState)({ kind: "grid" });
			const [detail, setDetail] = (0, react.useState)(void 0);
			const [busy, setBusy] = (0, react.useState)(false);
			const [note, setNote] = (0, react.useState)("");
			const [error, setError] = (0, react.useState)("");
			const [rewritePreview, setRewritePreview] = (0, react.useState)("");
			/** 是否展开"实际发送的完整 system prompt"（透明性：卡片 rules + 插件追加的输出纪律）。 */
			const [showFullPrompt, setShowFullPrompt] = (0, react.useState)(false);
			/** 展开哪一条改写记录的「原文 ↔ 改写后」对照（key = messageId-at）。 */
			const [expandedRewrite, setExpandedRewrite] = (0, react.useState)("");
			if (sessionId !== "" && !mountedReported.has(sessionId) && mountedReported.size < 8) {
				mountedReported.add(sessionId);
				postDebug({
					kind: "view-mounted",
					sessionId,
					note: `「${VIEW_LABEL}」页签渲染（M1）`
				});
			}
			const refresh = session.reload;
			(0, react.useEffect)(() => {
				if (library === void 0 && !session.loading) setError("读不到 /api/dsh-cosplay/library —— 宿主半边没装上或没重挂");
			}, [library, session.loading]);
			const activeId = session.boundId;
			const enabled = session.enabled;
			const aspect = library?.config.coverAspect ?? 1;
			/** 打开详情（按 id：先拿最新的元数据，再读全文）。 */
			const openDetailById = async (id) => {
				const meta = (library ?? await fetchLibrary())?.cards.find((candidate) => candidate.id === id);
				if (meta === void 0) {
					setScreen({ kind: "grid" });
					return;
				}
				setScreen({
					kind: "detail",
					id
				});
				setDetail({
					meta,
					card: void 0,
					loading: true
				});
				const full = await fetchCard(id);
				setDetail((current) => current === void 0 || current.meta.id !== id ? current : {
					meta,
					card: full?.card,
					loading: false
				});
			};
			/** 打开详情（手上已有元数据）。 */
			const openDetail = (meta) => openDetailById(meta.id);
			/** 在本会话使用。 */
			const useCard = async (id) => {
				if (sessionId === "") {
					setError("这个页签要挂在会话里用（当前没有会话）");
					return;
				}
				setBusy(true);
				try {
					await session.setCard(id);
					setNote("已在本会话启用");
				} finally {
					setBusy(false);
				}
			};
			/** 本会话停用（注入与改写都停）。 */
			const disable = async () => {
				if (sessionId === "") return;
				setBusy(true);
				try {
					await session.setEnabled(false);
					setNote("本会话已停用角色（零 token）");
				} finally {
					setBusy(false);
				}
			};
			/** 复制为自定义。 */
			const copyToCustom = async (id) => {
				setBusy(true);
				try {
					const result = await copyCard(id, {});
					if (result?.ok === true && result.card !== null) {
						setNote(`已复制为自定义卡：${result.card.name}`);
						postDebug({
							kind: "card-copied",
							id: result.card.id,
							note: `来源 ${id}`
						});
						await refresh();
						await openDetailById(result.card.id);
					} else setError("复制失败");
				} finally {
					setBusy(false);
				}
			};
			/** 导出：优先"落盘"（路径可复制），同时给一份浏览器下载。 */
			const doExport = async (ids) => {
				setBusy(true);
				try {
					const written = await exportWrite(ids);
					const pack = await exportPack(ids);
					if (pack !== void 0) try {
						const blob = new Blob([JSON.stringify(pack, null, 2)], { type: "application/json" });
						const url = URL.createObjectURL(blob);
						const anchor = document.createElement("a");
						anchor.href = url;
						anchor.download = `cosplay-${String(Date.now())}.json`;
						anchor.click();
						setTimeout(() => URL.revokeObjectURL(url), 4e3);
					} catch {}
					setNote(written?.ok === true ? `已导出到磁盘：${written.path}` : "已生成导出文件（磁盘落点不可用）");
					postDebug({
						kind: "export",
						note: written?.ok === true ? `path=${written.path} cards=${String(written.cards)}` : "download only"
					});
				} finally {
					setBusy(false);
				}
			};
			/** 导入。 */
			const doImport = async (event) => {
				const file = event.target.files?.[0];
				event.target.value = "";
				if (file === void 0) return;
				setBusy(true);
				try {
					const text = await file.text();
					let parsed;
					try {
						parsed = JSON.parse(text);
					} catch {
						setError("这个文件不是 JSON");
						return;
					}
					const result = await importPack(parsed);
					if (result === void 0) {
						setError("导入失败（宿主没响应）");
						return;
					}
					setNote(`导入完成：新增 ${String(result.added)} · 覆盖 ${String(result.replaced)} · 跳过 ${String(result.skipped)}${result.errors.length === 0 ? "" : ` · ${String(result.errors.length)} 条说明`}`);
					setError(result.errors.length === 0 ? "" : result.errors.slice(0, 3).join(" / "));
					postDebug({
						kind: "import",
						note: `added=${String(result.added)} replaced=${String(result.replaced)} errors=${String(result.errors.length)}`
					});
					await refresh();
				} finally {
					setBusy(false);
				}
			};
			/** 手动改写一次（排障/预览）。 */
			const tryRewrite = async (cardId) => {
				if (sessionId === "") {
					setError("手动改写需要会话上下文");
					return;
				}
				setBusy(true);
				try {
					const result = await rewriteOnce({
						sessionId,
						cardId,
						text: "帮我用 Canvas 画一个赛博朋克风的机械骷髅头像。"
					});
					if (result === void 0) setError("改写请求失败");
					else if (result.ok) {
						setRewritePreview(result.text);
						setNote(`改写成功（${String(result.ms)}ms · ${result.model}）`);
					} else {
						setRewritePreview("");
						setError(`改写失败：${result.error}`);
					}
				} finally {
					setBusy(false);
				}
			};
			const cards = (0, react.useMemo)(() => library?.cards ?? [], [library]);
			if (screen.kind === "edit") return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: "dsh-cosplay-view",
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(CardEditor, {
					initial: screen.id === void 0 ? void 0 : detail?.card,
					artMaxEdge: library?.config.artMaxEdge ?? 1024,
					artQuality: library?.config.artQuality ?? .85,
					onSaved: (card) => {
						setNote(`已保存「${card.name}」`);
						setScreen({ kind: "grid" });
						(async () => {
							await refresh();
							await openDetailById(card.id);
						})();
					},
					onCancel: () => setScreen({ kind: "grid" })
				})
			});
			if (screen.kind === "detail" && detail !== void 0) {
				const { meta, card } = detail;
				return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "dsh-cosplay-view",
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dsh-cosplay-bar",
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
									type: "button",
									className: "dsh-cosplay-btn",
									onClick: () => setScreen({ kind: "grid" }),
									children: ["← ", COPY.back]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: "dsh-cosplay-spacer" }),
								activeId === meta.id && enabled ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: "dsh-cosplay-btn",
									onClick: () => void disable(),
									disabled: busy,
									children: COPY.disable
								}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: "dsh-cosplay-btn primary",
									onClick: () => void useCard(meta.id),
									disabled: busy,
									children: COPY.use
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: "dsh-cosplay-btn",
									onClick: () => setScreen({
										kind: "edit",
										id: meta.id
									}),
									disabled: busy || meta.source === "preset",
									children: COPY.edit
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: "dsh-cosplay-btn",
									onClick: () => void copyToCustom(meta.id),
									disabled: busy,
									children: COPY.copyToCustom
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: "dsh-cosplay-btn",
									onClick: () => void doExport([meta.id]),
									disabled: busy,
									children: "导出这张"
								}),
								meta.source === "custom" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: "dsh-cosplay-btn danger",
									disabled: busy,
									onClick: () => {
										(async () => {
											await deleteCard(meta.id);
											postDebug({
												kind: "card-deleted",
												id: meta.id,
												note: "detail"
											});
											await refresh();
											setScreen({ kind: "grid" });
										})();
									},
									children: COPY.remove
								}) : null
							]
						}),
						note !== "" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "dsh-cosplay-ok",
							children: note
						}) : null,
						error !== "" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "dsh-cosplay-error",
							children: error
						}) : null,
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dsh-cosplay-detail",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dsh-cosplay-detail-art",
								onClick: () => {
									if (meta.artUrl !== void 0) window.open(meta.artUrl, "_blank", "noopener,noreferrer");
								},
								title: meta.artUrl === void 0 ? "没有立绘" : COPY.preview,
								children: meta.artUrl === void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "dsh-cosplay-tile-fallback",
									style: { background: `linear-gradient(140deg, hsl(${String(meta.cover?.hue ?? 210)} 70% 62% / 0.35), hsl(260 70% 55% / 0.22))` },
									children: meta.cover?.emoji ?? "🎭"
								}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("img", {
									src: meta.artUrl,
									alt: meta.name,
									draggable: false
								})
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "dsh-cosplay-detail-body",
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: "dsh-cosplay-h2",
										children: [meta.name, meta.title === void 0 ? "" : ` · ${meta.title}`]
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: "dsh-cosplay-desc",
										children: [
											meta.description ?? "（没有简介）",
											" · ",
											modeLabel(meta.mode),
											" · ",
											meta.source === "preset" ? "预设（只读）" : "自定义"
										]
									})] }),
									(meta.tags ?? []).length > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
										className: "dsh-cosplay-tags",
										children: (meta.tags ?? []).map((tag) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: "dsh-cosplay-tag",
											children: tag
										}, tag))
									}) : null,
									meta.source === "preset" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: "dsh-cosplay-note",
										children: [
											"预设卡可以直接用（点「",
											COPY.use,
											"」）。只有想改它时才需要「",
											COPY.copyToCustom,
											"」—— 这样插件升级时预设还能更新，你的改动也不会被覆盖。"
										]
									}) : null,
									detail.loading ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
										className: "dsh-cosplay-note",
										children: "读取中…"
									}) : null,
									card?.persona !== void 0 && card.persona !== "" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
										className: "dsh-cosplay-card-title",
										children: "人设（注入系统提示）"
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("pre", {
										className: "dsh-cosplay-pre",
										children: card.persona
									})] }) : null,
									card?.rewrite !== void 0 && card.rewrite !== null ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
											className: "dsh-cosplay-card-title",
											children: "改写规则（卡片里的 rules，原样）"
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("pre", {
											className: "dsh-cosplay-pre",
											children: card.rewrite.rules
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
											className: "dsh-cosplay-bar",
											style: { marginTop: 8 },
											children: [
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
													type: "button",
													className: "dsh-cosplay-btn",
													onClick: () => setShowFullPrompt((value) => !value),
													children: showFullPrompt ? "收起重写调用的完整 system prompt" : "看实际发送的完整 system prompt"
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
													type: "button",
													className: "dsh-cosplay-btn",
													onClick: () => void tryRewrite(meta.id),
													disabled: busy,
													children: COPY.manualRewrite
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													className: "dsh-cosplay-hint",
													children: "改写调用 = 卡片 rules + 示例 + 插件追加的输出纪律（下面就是原文，没有隐藏内容）"
												})
											]
										}),
										showFullPrompt ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("pre", {
											className: "dsh-cosplay-pre",
											style: { marginTop: 8 },
											children: composeRewriteSystem(card)
										}) : null,
										rewritePreview !== "" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("pre", {
											className: "dsh-cosplay-pre",
											style: { marginTop: 8 },
											children: rewritePreview
										}) : null
									] }) : null,
									(session.binding?.rewrites ?? []).length > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
											className: "dsh-cosplay-card-title",
											children: "本会话最近改写"
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
											className: "dsh-cosplay-hint",
											style: { marginBottom: 4 },
											children: "点「原文 ↔ 改写后」能对着看：改写只该动措辞，不该换掉任务主体（换会话也换不掉历史）。"
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
											className: "dsh-cosplay-trace",
											children: (session.binding?.rewrites ?? []).map((item) => {
												const key = `${item.messageId}-${String(item.at)}`;
												const expanded = expandedRewrite === key;
												return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [
													/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
														className: "dsh-cosplay-trace-kind",
														children: item.ok ? "✓" : "✗"
													}),
													" ",
													clockOf(item.at),
													" ·",
													" ",
													item.cardId,
													" · ",
													String(item.inChars),
													"→",
													String(item.outChars),
													" 字 · ",
													String(item.ms),
													"ms · ",
													item.model,
													item.contextTurns === void 0 ? "" : ` · 上下文 ${String(item.contextTurns)} 条/${String(item.contextChars ?? 0)} 字`,
													item.error === void 0 ? "" : ` · ${item.error}`,
													item.original === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
														type: "button",
														className: "dsh-cosplay-btn tiny",
														style: { marginLeft: 6 },
														onClick: () => setExpandedRewrite(expanded ? "" : key),
														children: expanded ? "收起" : "原文 ↔ 改写后"
													}),
													expanded && item.original !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
														className: "dsh-cosplay-compare",
														children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
															className: "dsh-cosplay-hint",
															children: [
																"你发的原文（",
																String(item.inChars),
																" 字）"
															]
														}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("pre", {
															className: "dsh-cosplay-pre",
															children: item.original
														})] }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
															className: "dsh-cosplay-hint",
															children: [
																"模型实际收到的（",
																String(item.outChars),
																" 字）"
															]
														}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("pre", {
															className: "dsh-cosplay-pre",
															children: item.preview
														})] })]
													}) : null
												] }, key);
											})
										})
									] }) : null
								]
							})]
						})
					]
				});
			}
			const boundMeta = cards.find((meta) => meta.id === activeId);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dsh-cosplay-view",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dsh-cosplay-bar",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: "dsh-cosplay-title",
								children: [VIEW_LABEL, "卡"]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: "dsh-cosplay-sub",
								children: [
									COPY.boundTo,
									"：",
									boundMeta === void 0 ? COPY.none : `${boundMeta.name}${enabled ? "" : "（已停用）"}`
								]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: "dsh-cosplay-spacer" }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
								className: "dsh-cosplay-btn",
								style: { cursor: "pointer" },
								children: [COPY.importPack, /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									type: "file",
									accept: "application/json,.json",
									style: { display: "none" },
									onChange: (event) => void doImport(event)
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "dsh-cosplay-btn",
								onClick: () => void doExport(void 0),
								disabled: busy,
								children: COPY.exportAll
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
								type: "button",
								className: "dsh-cosplay-btn",
								onClick: () => setScreen({
									kind: "edit",
									id: void 0
								}),
								disabled: busy,
								children: ["+ ", COPY.newCard]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "dsh-cosplay-btn",
								onClick: () => void refresh(),
								disabled: busy,
								children: COPY.refresh
							})
						]
					}),
					note !== "" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "dsh-cosplay-ok",
						children: note
					}) : null,
					error !== "" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "dsh-cosplay-error",
						children: error
					}) : null,
					cards.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dsh-cosplay-note",
						children: [
							"卡片库是空的。可以「",
							COPY.newCard,
							"」，也可以「",
							COPY.importPack,
							"」一个别人发来的卡包",
							library === void 0 ? "。" : `（库目录：${library.root}）`
						]
					}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "dsh-cosplay-grid",
						children: cards.map((meta) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(CardTile, {
							meta,
							aspect,
							active: meta.id === activeId && enabled,
							onOpen: () => void openDetail(meta)
						}, meta.id))
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dsh-cosplay-note",
						children: [
							"点一张卡 → 二级详情 → 在本会话使用。改写型卡片（角标「改写」）会让每条消息先经一次模型改写： 多一次调用、多约 1–3 秒，随时可以「本会话停用」或 ",
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", { children: "/cosplay off" }),
							" 一键停。"
						]
					})
				]
			});
		}
		//#endregion
		//#region src/client/index.tsx
		/**
		* 客户端构建标记：每次改浏览器半边就换一个。
		* 刷新后在 `/api/dsh-cosplay/stats` 的 `client:client-apply` 回执里核对 `build=`。
		*/
		const CLIENT_BUILD = "m1.1-chip-a";
		/** 顶层硬依赖：只有基线服务。 */
		const inject = ["slots"];
		/** 标签求值只报一次（tab 条每次重渲染都会调用 label）。 */
		let labelReported = false;
		/** 设置页注册只报一次。 */
		let settingsReported = false;
		/** 挂载浏览器半边。 */
		function apply(ctx) {
			postDebug({
				kind: "client-apply",
				note: `build=${CLIENT_BUILD} plugin=${PACKAGE_NAME}`
			});
			const scope = createLazyScope();
			ctx.inject(["configForms"], (inner) => {
				const service = inner.configForms;
				if (service === void 0 || typeof service.get !== "function") {
					postDebug({
						kind: "settings-source-missing",
						note: "configForms 不在（设置页只读默认值）"
					});
					return;
				}
				try {
					const live = service.get(ENTRY_ID);
					inner.effect(() => scope.attach(live), "dsh-cosplay: settings attach");
					postDebug({
						kind: "settings-source-attached",
						note: `entry=${ENTRY_ID} value=${JSON.stringify(scope.getSnapshot().value ?? {})}`
					});
				} catch (error) {
					postDebug({
						kind: "settings-source-failed",
						note: `接设置失败：${error instanceof Error ? error.message : String(error)}`
					});
				}
			});
			ctx.effect(() => {
				const style = document.createElement("style");
				style.dataset.plugin = PACKAGE_NAME;
				style.textContent = CSS;
				document.head.appendChild(style);
				return () => {
					style.remove();
				};
			}, "dsh-cosplay: styles");
			ctx.slots.inject("conversation.view", () => {
				postDebug({
					kind: "view-slot-declared",
					note: `conversation.view 已声明 → 准备注册 ${VIEW_ID}`
				});
				try {
					const dispose = ctx.slots.register({
						name: "conversation.view",
						id: VIEW_ID,
						order: 20,
						label: () => {
							if (!labelReported) {
								labelReported = true;
								postDebug({
									kind: "view-label",
									note: `页签标签被 tab 列表读取：id=${VIEW_ID} label=${VIEW_LABEL}`
								});
							}
							return VIEW_LABEL;
						}
					}, CosplayView);
					postDebug({
						kind: "view-registered",
						note: `register 成功 id=${VIEW_ID} order=20 · conversation.view 现有条目 [${ctx.slots.entries("conversation.view").map((entry) => String(entry.options.id ?? "?")).join(", ")}]`
					});
					return dispose;
				} catch (error) {
					postDebug({
						kind: "view-register-failed",
						note: `register 抛错（页签因此静默失效）：${error instanceof Error ? error.message : String(error)}`
					});
					return () => {};
				}
			});
			const openView = (sessionId) => {
				try {
					ctx.get("uiConversation")?.binding(sessionId)?.activate(VIEW_ID);
				} catch {}
			};
			ctx.slots.inject("conversation.input.left", () => {
				try {
					const dispose = ctx.slots.register({
						name: "conversation.input.left",
						id: "cosplay-card-chip",
						order: 20
					}, (props) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(CardChip, {
						...props,
						openView,
						defaults: { set: (cardId) => scope.set("defaultCardId", cardId) }
					}));
					postDebug({
						kind: "chip-registered",
						note: "输入框角色 chip 已注册（conversation.input.left）"
					});
					return dispose;
				} catch (error) {
					postDebug({
						kind: "chip-register-failed",
						note: `chip 注册抛错：${error instanceof Error ? error.message : String(error)}`
					});
					return () => {};
				}
			});
			ctx.slots.inject("settings.section", () => {
				try {
					const dispose = ctx.slots.register({
						name: "settings.section",
						id: SETTINGS_SECTION_ID,
						order: 30,
						label: () => SETTINGS_LABEL
					}, (props) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(CosplaySettings, {
						...props,
						scope
					}));
					if (!settingsReported) {
						settingsReported = true;
						postDebug({
							kind: "settings-registered",
							note: `设置页已注册 id=${SETTINGS_SECTION_ID} label=${SETTINGS_LABEL}`
						});
					}
					return dispose;
				} catch (error) {
					postDebug({
						kind: "settings-register-failed",
						note: `settings.section 注册抛错：${error instanceof Error ? error.message : String(error)}`
					});
					return () => {};
				}
			});
			postDebug({
				kind: "client-installed",
				note: `build=${CLIENT_BUILD} view=${VIEW_ID}(${COPY.newCard ? "卡片库" : ""}) settings=${SETTINGS_SECTION_ID}`
			});
		}
		//#endregion
		exports.CLIENT_BUILD = CLIENT_BUILD;
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map