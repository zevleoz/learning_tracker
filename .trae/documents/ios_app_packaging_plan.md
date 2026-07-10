# iOS App 打包计划

## 项目调研结论

当前项目是一个 **React + Vite + Tailwind CSS** 单页应用（SPA），后端使用 **Supabase**，已具备基础的 PWA 配置（manifest.json、sw.js）。

### 当前状态分析

| 文件 | 状态 | 问题 |
|------|------|------|
| `package.json` | ✅ 正常 | React 18 + Vite 5 构建 |
| `manifest.json` | ⚠️ 需修复 | 引用了不存在的 `icon.svg` |
| `sw.js` | ⚠️ 需修复 | precache URL 指向旧的 HTML 文件（login.html, signup.html 等已不存在） |
| `dist/` | ✅ 构建产物存在 | 包含正确的 js/css/图片资源 |

## 推荐方案：Capacitor

**Capacitor** 是最佳选择，因为：
- 官方维护，与 Ionic 生态无缝集成
- 将现有 Web 应用直接打包为原生 iOS/Android 应用
- 保留所有 React 代码，无需重写
- 提供原生 API 桥接（相机、通知等）

## 前提条件

### 硬件要求
- **Mac 电脑**（必需，Xcode 仅支持 macOS）
- **iPhone 设备**（用于真机测试）

### 软件要求
- **Xcode**（最新版本，通过 App Store 安装）
- **Apple Developer 账号**（$99/年，用于 App Store 发布和真机调试）

### 项目修复（打包前必须完成）

#### 1. 修复 `sw.js` - 更新 precache 列表
当前 sw.js 引用了已不存在的旧 HTML 文件，会导致缓存失败。需要更新为 React 应用的实际路由结构。

#### 2. 修复 `manifest.json` - 更新图标引用
当前引用 `icon.svg`，但 dist/ 目录中只有 `icon-192.png` 和 `icon-512.png`。

## 实施步骤

### 阶段一：项目修复

**步骤 1.1**: 更新 `sw.js`
- 移除 `PRECACHE_URLS` 中过时的 HTML 文件引用
- 添加正确的 Vite 构建资源路径

**步骤 1.2**: 更新 `manifest.json`
- 将图标引用从 `icon.svg` 改为 `icons/icon-192.png` 和 `icons/icon-512.png`

**步骤 1.3**: 更新 `index.html`
- 添加 manifest 链接标签
- 更新图标链接

### 阶段二：Capacitor 集成

**步骤 2.1**: 安装 Capacitor 依赖
```bash
npm install @capacitor/core @capacitor/cli
```

**步骤 2.2**: 初始化 Capacitor 项目
```bash
npx cap init "Samson GPA 学习追踪" "com.samson.gpatracker"
```

**步骤 2.3**: 安装 iOS 平台
```bash
npm install @capacitor/ios
npx cap add ios
```

**步骤 2.4**: 配置 `capacitor.config.ts`
- 设置 `webDir` 为 `dist`
- 配置 iOS 相关设置

**步骤 2.5**: 构建并同步
```bash
npm run build
npx cap sync ios
```

### 阶段三：iOS 配置（Xcode）

**步骤 3.1**: 打开 Xcode 项目
```bash
npx cap open ios
```

**步骤 3.2**: 配置签名
- 在 Xcode 中选择项目 → Signing & Capabilities
- 添加 Apple Developer 账号
- 配置 Bundle Identifier

**步骤 3.3**: 添加必要的 Capabilities
- Push Notifications（如需要）
- Background Modes（如需要后台同步）

**步骤 3.4**: 测试构建
- 选择设备 → 点击 Build 按钮
- 验证应用能正常运行

### 阶段四：发布准备

**步骤 4.1**: 创建 App Store Connect 记录
- 登录 [App Store Connect](https://appstoreconnect.apple.com/)
- 创建新 App，配置基本信息

**步骤 4.2**: 归档构建
- 在 Xcode 中选择 Product → Archive
- 验证归档并上传至 App Store Connect

**步骤 4.3**: TestFlight 测试
- 在 App Store Connect 中添加测试人员
- 通过 TestFlight 分发测试版

**步骤 4.4**: 正式发布
- 完成审核信息填写
- 提交至 App Store 审核

## 备选方案：PWA（不推荐）

如果不想走原生路线，可以通过 Safari 的"添加到主屏幕"功能安装，但有以下限制：

| 特性 | PWA | Capacitor |
|------|-----|-----------|
| App Store 分发 | ❌ 不支持 | ✅ 支持 |
| 推送通知 | ⚠️ 有限支持 | ✅ 完整支持 |
| 离线缓存 | ✅ 支持 | ✅ 支持 |
| 后台运行 | ❌ 限制多 | ✅ 完整支持 |
| 原生 API | ❌ 不支持 | ✅ 支持 |

## 风险处理

### 风险 1：Apple 审核拒绝
- **缓解措施**：确保应用有明确的功能和价值，避免被认定为"只是一个网站包装"

### 风险 2：HTTPS 要求
- **缓解措施**：确保生产环境使用 HTTPS（Supabase 已默认支持）

### 风险 3：设备兼容性
- **缓解措施**：在多个 iOS 版本和设备上测试

## 文件变更清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `sw.js` | 修改 | 更新 precache URL 列表 |
| `manifest.json` | 修改 | 更新图标引用 |
| `index.html` | 修改 | 添加 manifest 链接 |
| `package.json` | 修改 | 添加 Capacitor 依赖 |
| `capacitor.config.ts` | 新建 | Capacitor 配置文件 |
| `ios/` | 新建 | iOS 原生项目目录 |

## 预期产出

1. 修复后的 PWA 配置文件
2. 完整的 Capacitor 项目结构
3. 可在 Xcode 中构建的 iOS 项目
4. 可提交至 App Store 的构建包
