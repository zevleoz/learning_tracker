# 前端版本更新提示 实施计划

## 问题回答（结论先行）

1. **不会自动"推"到学生设备。** Web 应用无法像原生 App 一样主动下发代码，更新只能在客户端发起请求时发生。
2. **目前的实际行为：** 项目已有手写 Service Worker（[public/sw.js](file:///Users/jefflau/projects/一表人才/public/sw.js)），HTML 导航是 network-first，Vite 构建产物带内容 hash。所以学生**只要刷新页面、或重新打开页面，拿到的就是最新版**；唯一的漏洞是**长时间不关闭的标签页会一直运行旧代码**（导师工作台尤其常见）。
3. **两种策略对比：**
   - 静默强制刷新：实现简单，但用户正在填表单/写会议记录时会丢失输入，不可接受。
   - **检测新版本 → 弹窗/横幅提示 → 用户点击后刷新（推荐）**，业界标准做法（vite-plugin-pwa 的 prompt 模式同理）。
4. **电脑端和手机端用同一套代码。** 额外加一层不依赖 Service Worker 的 `version.json` 轮询，覆盖微信内置浏览器等 SW 不可用的环境。

## Repository Research（现状）

- 构建：Vite 5，产物 `/assets/*` 文件名带内容 hash；[vite.config.js](file:///Users/jefflau/projects/一表人才/vite.config.js) 无版本号机制。
- 部署：Vercel，[vercel.json](file:///Users/jefflau/projects/一表人才/vercel.json) 只有 SPA rewrite，**没有显式缓存头**（Vercel 默认对 HTML 做 revalidate、对 hash 资源做 immutable，基本合理但不显式）。
- Service Worker：[public/sw.js](file:///Users/jefflau/projects/一表人才/public/sw.js) 已实现 HTML network-first、静态资源 SWR、`skipWaiting()` + `clients.claim()`，但**没有任何"新版本已就绪"的客户端通知**；其 SWR 逻辑会把未来的 `/version.json` 也缓存，需排除。
- 注册：[src/main.jsx](file:///Users/jefflau/projects/一表人才/src/main.jsx#L16-L22) 仅生产环境注册，注册对象未保留，无法监听 `updatefound`。
- 数据安全：E4 各页面均为自动保存（输入即写库），无集中式 pending 队列；刷新前预留一个 flush 事件 + 短等待即可。
- UI 约束：中性墨色、1px 细线、10px 圆角、无表情符号；浮层必须完全位于视口内，移动端留安全区。

## 方案总览（三层防御）

1. **缓存头显式化**：HTML 与 sw.js 不缓存（或必须 revalidate），hash 资源 immutable。
2. **双通道检测**：SW 的 `updatefound` + 应用层轮询 `/version.json`（SW 不可用时的兜底）。
3. **非阻塞更新提示**：底部细线横幅，用户确认后刷新；开机后无人交互时检测到新版本则静默刷新。

## Files and Modules

- `vite.config.js`：新增内联小插件，构建结束时写 `dist/version.json`（含 buildId、构建时间、commit sha）；用 `define` 注入当前 buildId。
- `vercel.json`：新增 headers 规则（sw.js / index.html：no-cache；/assets/*：immutable）。
- `public/sw.js`：`/version.json` 改为 network-only（不进 SWR）；activate 后向所有 client postMessage 通知。
- `src/main.jsx`：保留 SW registration 引用，挂到 `window.__SW_REG__` 供检测逻辑使用（dev 不注册）。
- `src/lib/useAppUpdate.js`（新增）：检测核心 hook，逻辑尽量纯函数化以便测试。
- `src/components/UpdatePrompt.jsx`（新增）：更新提示横幅。
- `src/App.jsx`：在 ErrorBoundary 内挂载 UpdatePrompt。
- `src/index.css`：少量样式追加到文件末尾（遵循既有约定）。
- `__tests__/useApp_update.test.jsx`（新增）：检测逻辑与交互测试。

## Implementation Steps

1. **vite.config.js 生成版本信息**
   - buildId 取 `VERCEL_GIT_COMMIT_SHA` 前 7 位，本地构建回退为时间戳。
   - `define: { __APP_BUILD__: JSON.stringify(buildId) }`。
   - 内联插件用 `closeBundle` 把 `{ buildId, builtAt, commit }` 写入 `dist/version.json`。

2. **vercel.json 缓存头**
   - `/sw.js` → `Cache-Control: no-cache`（最关键，保证浏览器及时做字节比对）。
   - `/index.html` → `no-cache`。
   - `/assets/(.*)` → `public, max-age=31536000, immutable`。

3. **改造 public/sw.js**
   - fetch 处理中：`url.pathname === '/version.json'` 时直接 `return`（走网络，不缓存）。
   - activate 末尾：`self.clients.matchAll()` 给每个客户端 `postMessage({ type: 'SW_ACTIVATED', build })`。
   - 其余策略保持不变。

4. **main.jsx 暴露 registration**
   - 注册成功后 `window.__SW_REG__ = reg`；其余行为不变。

5. **useAppUpdate.js 检测逻辑**
   - 触发时机：页面加载后一次、`visibilitychange` 回到可见、`online`、定时每 45 分钟。
   - 通道 A（SW 可用）：监听 `reg.addEventListener('updatefound')`，新 worker installed 为 waiting 状态即判定有新版；每次触发时调 `reg.update()`。
   - 通道 B（通用兜底）：`fetch('/version.json', { cache: 'no-store' })`，比较 `buildId !== __APP_BUILD__`。
   - 任一条命中 → 返回 `{ hasUpdate }`，同一 buildId 只提示一次；用户点"稍后"则本次 buildId 不再提示（新 buildId 出现才再次提示）。
   - **静默刷新规则**：加载后 15 秒内完成首次检测，且期间无任何 pointerdown/keydown/touchstart 交互，直接刷新，不弹提示。

6. **UpdatePrompt.jsx UI**
   - 固定在视口底部居中（桌面 max-width 420px，移动端左右留 16px + `env(safe-area-inset-bottom)`），白底、1px 细线、10px 圆角，无表情符号。
   - 文案："发现新版本，刷新后生效"；按钮：墨色实心"立即更新"+ 安静的文本按钮"稍后"。
   - 点击更新：派发 `window.dispatchEvent(new Event('app:before-reload'))`（让有未完成自动保存的页面 flush），等待 600ms 后 `window.location.reload()`。
   - 组件提供 framer-motion 的轻微上滑淡入（与现有动效一致）。

7. **App.jsx 挂载 + index.css 追加样式**。

8. **测试**：版本比较纯函数、检测命中/未命中、"稍后"抑制、确认更新派发事件；jest 全量保持通过。

## Dependencies and Considerations

- 无需新增 npm 依赖，全部用现有能力实现。
- 无数据库变更，无打印路由变更。
- iOS 主屏幕 PWA：冷启动经 SW network-first 本就是新版；切回前台由 visibilitychange 触发检测。
- Android Chrome：SW 完整支持。
- 微信/QQ 内置浏览器等 SW 不可用环境：靠通道 B + no-cache 头生效，确认刷新后即加载新版。
- Web Push（sw.js 中已有 push 处理）是通知通道，不能替代版本检测，本次不接入。

## Validation

- `npm run build` 后检查 `dist/version.json` 存在且 buildId 与注入常量一致。
- `npm run preview`：手改 dist/version.json 模拟新版本，验证横幅出现、点击后刷新、"稍后"被抑制。
- Chrome DevTools → Application → Service Workers 的 Update on reload 验证 SW 通道。
- 手机 Safari / 微信内打开做一次实机验证（横幅位置、安全区、视口内完整可见）。
- `npm test` 全量通过（现有 8 个 Learning 遗留失败可接受）。

## Risks

- **刷新丢失未保存输入**：全站输入均自动写库；更新前派发 flush 事件并等待 600ms；用户主动点确认，风险可控。
- **轮询打扰用户**：45 分钟 + 仅可见时检测；同一 buildId 只提示一次；无更新时完全无感知。
- **旧 sw.js 被 HTTP 缓存导致更新延迟**：vercel.json 对 /sw.js 显式 no-cache，且通道 B 不依赖 SW。
- **SWR 缓存中旧 hash 资源长期堆积**：现状已存在，本次不处理；后续可在 SW activate 时按 index.html 引用清单清理（记录为低优先级）。
