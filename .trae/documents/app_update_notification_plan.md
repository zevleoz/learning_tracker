# 前端版本更新提示（按使用对象分区）实施计划

## 问题回答（结论先行）

1. **不会自动"推"到学生设备。** Web 应用无法像原生 App 一样主动下发代码，更新只能在客户端发起请求时发生。
2. **目前的实际行为：** 项目已有手写 Service Worker（[public/sw.js](file:///Users/jefflau/projects/一表人才/public/sw.js)），HTML 导航 network-first，Vite 构建产物带内容 hash。学生**只要刷新或重开页面，拿到的就是最新版**；漏洞是**长时间不关闭的标签页一直运行旧代码**。
3. **采用：检测新版本 → 非阻塞横幅提示 → 用户确认后刷新**（静默强刷会丢失正在填写的内容，不采用）。电脑端、手机端共用一套代码。
4. **按使用对象分区（本次重点）：** 版本信息按 `student`（学生端一表人才）、`mentor`（导师一表人才台）、`e4`（E4 工作台）三个面分别计算。只改了导师端/E4 时，学生不会收到任何提示；只有用户**实际使用的面**发生变化才提示。微信内置浏览器等无 SW 环境用 version.json 轮询兜底。

## Repository Research（现状）

- 构建：Vite 5，产物 `/assets/*` 文件名带内容 hash；无任何版本号机制（[vite.config.js](file:///Users/jefflau/projects/一表人才/vite.config.js)）。
- 部署：Vercel，[vercel.json](file:///Users/jefflau/projects/一表人才/vercel.json) 只有 SPA rewrite，无显式缓存头。
- SW：[public/sw.js](file:///Users/jefflau/projects/一表人才/public/sw.js) 已实现 HTML network-first、静态资源 SWR、`skipWaiting()` + `clients.claim()`，但无"新版本就绪"通知；其 SWR 会把未来的 `/version.json` 也缓存，需排除。
- 注册：[src/main.jsx](file:///Users/jefflau/projects/一表人才/src/main.jsx#L16-L22) 仅生产注册，registration 未保留。
- 路由边界：学生无 `/mentor`、`/e4` 访问权（[ProtectedRoute](file:///Users/jefflau/projects/一表人才/src/components/ProtectedRoute.jsx) minRole=2），分区提示在物理上也可隔离。
- 组件归属（已核实）：`SharedDashboard.jsx` 仅导师页引用；`DeepDivePanels.jsx` 学生与导师都引用（归共享）；`DimensionStrip`/`WeekGrid`/`WeekReviewDashboard` 仅学生。
- E4 各页面输入即自动保存，刷新前派发 flush 事件 + 短等待即可。
- UI 约束：中性墨色、1px 细线、10px 圆角、无表情符号；浮层必须完全位于视口内，移动端留安全区。

## 方案总览

1. **构建期分区摘要**：按文件路径把源码归入三个面（共用文件计入全部三个面），分别算 hash，写入 `/version.json` 并注入运行时常量。
2. **运行期按使用情况比对**：跟踪用户实际访问过的面（路由映射 + 7 天持久化），只比对这些面。
3. **双通道触发**：SW `updatefound`/activated + 应用层轮询 `/version.json`（无 SW 环境兜底）。
4. **非阻塞横幅**：明确告知哪个工作台更新；确认后 flush 自动保存并刷新；开机后无人交互时静默刷新。

## 文件归属与分区规则（构建期，自动推导）

不做手工映射（代码演进后会漂移，实际核查中已发现 Mentor 引用 WeekGrid、e4Store 被导师引用等跨面关系）。改为从各面入口页面出发，沿静态 import 图 BFS 自动推导文件归属：

- 入口：student = Learning/Syllabus/Review/Notifications；mentor = Mentor/MentorAnalytics(+Test)；e4 = `src/pages/e4/` 下全部页面（定义在 [surfaceHashes.js](file:///Users/jefflau/projects/一表人才/scripts/surfaceHashes.js)）。
- 一个文件被哪些面的依赖图触达就归属哪些面；bare import（node_modules）不入图，依赖版本变化由 package.json 兜底。
- 外壳文件（index.html、main.jsx、App.jsx、index.css、manifest、icons、package.json）计入全部三个面。

实测验证：改 E4 专属页面 → 仅 e4 摘要变化；改导师页面 → 仅 mentor 变化；改共享文件（如 supabase 客户端）→ 三个面都变，所有人提示。

## Files and Modules

- `vite.config.js`：新增内联函数，配置生成前遍历源码计算三个面的摘要；`define` 注入 `__SURFACE_BUILDS__`；内联插件在 `closeBundle` 写 `dist/version.json`。
- `vercel.json`：headers 规则（sw.js / index.html：no-cache；/assets/*：immutable）。
- `public/sw.js`：`/version.json` network-only 不缓存；activate 后向 clients postMessage 作为检测触发信号。
- `src/main.jsx`：保留 registration 到 `window.__SW_REG__`。
- `src/lib/useAppUpdate.js`（新增）：分区比对与检测核心，纯函数化便于测试。
- `src/components/UpdatePrompt.jsx`（新增）：更新横幅。
- `src/App.jsx`：挂载 SurfaceTracker（记录使用面）与 UpdatePrompt。
- `src/index.css`：样式追加到文件末尾。
- `__tests__/useApp_update.test.jsx`（新增）。

## Implementation Steps

1. **vite.config.js 计算分区摘要**
   - 用 node fs + crypto 在配置函数内遍历文件，按上表分类；每个面的摘要 = 该面文件（含共享文件）排序后「路径 + 内容」拼接的 sha256 前 10 位。
   - `define: { __SURFACE_BUILDS__: JSON.stringify({ student, mentor, e4 }) }`。
   - 内联插件 `closeBundle` 写 `dist/version.json`：`{ surfaces: {…}, builtAt, commit }`，commit 取 `VERCEL_GIT_COMMIT_SHA` 前 7 位。

2. **vercel.json 缓存头**
   - `/sw.js` → `no-cache`（最关键）；`/index.html` → `no-cache`；`/assets/(.*)` → `public, max-age=31536000, immutable`。

3. **public/sw.js**
   - fetch 中 `/version.json` 直接放行（network-only）。
   - activate 末尾给所有 client `postMessage({ type: 'SW_ACTIVATED' })`，作为客户端拉取 version.json 的触发信号；其余策略不变。

4. **main.jsx**：注册成功后挂 `window.__SW_REG__ = reg`。

5. **SurfaceTracker（写在 useAppUpdate.js 内导出）**
   - 路由映射：`/e4` 前缀（含打印路由）→ e4；`/mentor` → mentor；其余登录后路由 → student；`/login`、`/signup` 不记录。
   - localStorage 存各面最后访问时间，每次路由命中更新；比对时剔除超过 7 天未用的面。

6. **useAppUpdate.js 检测逻辑**
   - 触发时机：加载后一次、`visibilitychange` 回可见、`online`、每 45 分钟、收到 SW postMessage、SW `updatefound`（同时周期性调 `reg.update()`）。
   - 比对：`fetch('/version.json', { cache: 'no-store' })`，对"7 天内使用过的面"逐个比较 `remote.surfaces[s] !== __SURFACE_BUILDS__[s]`。
   - 返回 `{ hasUpdate, surfaces: [...] }`；同一批变化只提示一次；"稍后"后这些面在下次出现新摘要前不再提示。
   - **静默刷新**：加载后 15 秒内完成首次检测、且期间无 pointerdown/keydown/touchstart，直接刷新不弹横幅。

7. **UpdatePrompt.jsx**
   - 视口底部居中浮层（桌面 max-width 420px；移动左右 16px + `env(safe-area-inset-bottom)`），白底、1px 细线、10px 圆角、无表情符号。
   - 文案含变化面名称：如 "E4 工作台有新版本，刷新后生效"；多面同时变化用顿号连接。面名称：导师工作台 / E4 工作台 / 学生端。
   - 墨色实心"立即更新" + 文本按钮"稍后"。
   - 确认更新：派发 `app:before-reload` 事件（供页面 flush 自动保存），等 600ms 后 `window.location.reload()`。
   - framer-motion 轻微上滑淡入。

8. **App.jsx 挂载 + index.css 末尾追加样式**。

9. **测试**：分类规则（构造文件集合验证归属）、摘要比对（命中/未命中/只改无关面不提示）、使用面 7 天过期、"稍后"抑制、确认更新事件；jest 全量通过。

## Dependencies and Considerations

- 不新增 npm 依赖；无数据库变更；打印路由零改动。
- 即使全部代码被打进同一 chunk（App.jsx 目前静态导入所有页面），按源文件内容计算的摘要仍能精确区分变化面；学生保留旧 chunk 运行，直到自然刷新，行为无害。后续可顺手把页面改为 `React.lazy` 分包（本次不做）。
- iOS 主屏幕 PWA：冷启动 network-first 即新版；回前台 visibilitychange 触发检测。
- 微信/QQ 内置浏览器 SW 不可用：version.json 轮询 + no-cache 头覆盖。
- SW 的 push 通知不能替代版本检测，本次不接入。

## Validation

- `npm run build`：检查 `dist/version.json`，只改一个面的文件后重新构建，确认仅对应摘要变化。
- `npm run preview`：手改 dist/version.json 模拟各面更新，验证横幅文案、点击刷新、"稍后"抑制；模拟"仅 mentor 变化 + 当前为学生使用面"时无任何提示。
- Chrome DevTools Application 验证 SW 触发通道。
- 手机 Safari / 微信实机验证位置、安全区与视口完整性。
- `npm test` 全量通过（现有 8 个 Learning 遗留失败可接受）。

## Risks

- **刷新丢失输入**：全站输入自动写库 + flush 事件 600ms 等待 + 用户主动确认。
- **分区归类错误导致漏提示**：跨面文件统一归共享；拿不准默认共享；分类规则有单测锁定。
- **轮询打扰**：45 分钟且仅可见时检测，无变化完全无感。
- **旧 sw.js 被缓存**：显式 no-cache + version.json 通道不依赖 SW。
- **SWR 旧 hash 资源堆积**：现状问题，本次不处理，低优先级。
