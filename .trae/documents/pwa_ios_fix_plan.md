# PWA iOS 修复计划

## 问题分析

您遇到的 **404 问题** 主要由以下三个关键缺失导致：

### 问题 1：Service Worker 未注册
[main.jsx](file:///Users/jefflau/projects/一表人才/src/main.jsx) 中没有任何 `navigator.serviceWorker.register()` 调用，导致 `sw.js` 文件存在但从未被激活。

### 问题 2：Manifest 未关联
[index.html](file:///Users/jefflau/projects/一表人才/index.html) 缺少 `<link rel="manifest">` 标签，iOS Safari 无法发现 PWA 配置，因此"添加到主屏幕"的快捷方式只是一个普通的网页书签。

### 问题 3：sw.js 缓存列表过期
[sw.js](file:///Users/jefflau/projects/一表人才/sw.js) 的 `PRECACHE_URLS` 引用了已不存在的旧文件：
- `login.html`, `signup.html`, `checkin.html`, `dashboard.html`, `mentor.html`
- `css/app.css`, `js/app.config.js`, `js/app.supabase.js`, `js/app.ui.js`
- `icon.svg`

当 `cache.addAll()` 遇到任何一个 404，整个缓存安装会失败，导致没有离线回退机制。

### 关于登录状态持久化
[useAuth.js](file:///Users/jefflau/projects/一表人才/src/lib/useAuth.js) 中已经正确使用了 `supabase.auth.getSession()` 和 `onAuthStateChange`，Supabase 默认将 session 存储在 localStorage 中。**iOS PWA 模式会保留 localStorage**，所以修复 404 后，用户不需要每次都登录。

## 修复步骤

### 步骤 1：更新 index.html
添加以下标签到 `<head>` 中：
- `<link rel="manifest" href="/manifest.json">` - 让浏览器发现 PWA 配置
- `<link rel="apple-touch-icon" href="/icons/icon-192.png">` - iOS 主屏幕图标
- `<meta name="apple-mobile-web-app-capable" content="yes">` - 启用全屏模式
- `<meta name="apple-mobile-web-app-status-bar-style" content="default">` - 状态栏样式

### 步骤 2：更新 manifest.json
修复图标引用，将 `icon.svg` 改为实际存在的 PNG 图标：
- 添加 `icons/icon-192.png` (192x192)
- 添加 `icons/icon-512.png` (512x512)

### 步骤 3：更新 sw.js
完全重写 `PRECACHE_URLS`，只包含 dist/ 目录中实际存在的文件：
- `./index.html`
- `./manifest.json`
- `./icons/icon-192.png`
- `./icons/icon-512.png`

注意：Vite 构建会生成带 hash 的 JS/CSS 文件（如 `index-DUh4X7kg.js`），这些不应该硬编码到 precache 中，应该通过运行时动态缓存。

### 步骤 4：注册 Service Worker
在 [main.jsx](file:///Users/jefflau/projects/一表人才/src/main.jsx) 末尾添加 service worker 注册代码。

### 步骤 5：构建并验证
```bash
npm run build
npm run preview --host
```

## 文件变更清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `index.html` | 修改 | 添加 manifest、apple-touch-icon 等 PWA 标签 |
| `manifest.json` | 修改 | 更新图标引用 |
| `sw.js` | 修改 | 更新 PRECACHE_URLS，移除不存在的文件 |
| `src/main.jsx` | 修改 | 添加 service worker 注册代码 |

## 预期结果

修复后：
1. ✅ "添加到主屏幕"能正确创建 PWA 快捷方式
2. ✅ 打开后不会出现 404
3. ✅ 登录状态会持久化（localStorage）
4. ✅ 支持离线缓存（service worker）
5. ✅ 显示正确的主屏幕图标

## 测试方法

1. 在 macOS Safari 或 iOS Safari 中访问部署后的应用
2. 点击分享按钮 → "添加到主屏幕"
3. 从主屏幕打开应用，验证是否正常加载
4. 登录后关闭应用，再次打开验证登录状态是否保留

## 风险提示

- 首次修复后，旧的 service worker 可能需要手动清除（Settings → Safari → Clear Website Data）
- 如果使用自定义域名，确保配置了 HTTPS（iOS PWA 要求）
