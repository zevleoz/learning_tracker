# 学生端 Desktop UI 与 Bug 修复计划

## 概述

为学生端添加 Desktop UI 适配，大屏幕时首页为课程页（树形表格视图），移动端首页为记录页。同时修复时间显示错误等 bug。

## 现状分析

### 路由结构 (App.jsx)
- `/` → 重定向到 `/syllabus`（所有设备统一）
- `/syllabus` → 课程页
- `/learning` → 记录页
- `/review` → 回顾页
- `/mentor` → 导师页

### Layout.jsx 响应式情况
- 已有 `isMobile` 检测（768px 断点）
- 移动端：顶部 bar + 底部 pill 导航
- 桌面端：顶部吸附 bar + 横向导航
- 导师页 desktop 已有特例：`isMentorDesktop` 时直接渲染 `<Outlet />` 不套 Layout

### Syllabus.jsx (课程页)
- 纯移动端设计：窄卡片堆叠，展开式表单
- 功能：增删改查 课程/章节/单元
- 没有利用桌面端宽度，没有键盘快捷键

### Learning.jsx (记录页)
- 表单式设计，已支持桌面和移动端
- 时间使用 `<input type="date">` 和 `<input type="time">`

### 已发现 Bug
1. **时间显示错误** (Learning.jsx L71-81)：`fmtRecentDate()` 用 `new Date(iso)` 解析 `"2026-07-10"` 格式日期，JS 会解析为 UTC 午夜，在 UTC 后方的时区（如美国）会显示为前一天
2. **FORM_PRESET 未定义** (Learning.jsx L261)：`onAddCustomForm()` 引用了 `FORM_PRESET` 但该变量从未定义（应为 `ALL_FORM_PRESET`），添加自定义学习形式时会崩溃

## 修改计划

### 1. 响应式首页重定向

**文件**: `src/App.jsx`

将 `/` 的重定向改为根据屏幕尺寸判断：
- 大屏幕 → `/syllabus`（课程页）
- 小屏幕 → `/learning`（记录页）

方案：创建一个 `ResponsiveRedirect` 组件，使用 `window.matchMedia('(max-width: 767px)')` 判断设备，重定向到对应页面。

### 2. Desktop 课程页树形表格视图

**文件**: `src/pages/Syllabus.jsx` + `src/index.css`

在现有 Syllabus 组件中添加桌面端布局，不创建新文件：

#### 布局结构
```
┌──────────────────────────────────────────────────┐
│  添加课程按钮（顶部）                               │
├──────────────────────────────────────────────────┤
│  ┌─课程名──┬─学科──┬─章节─────────────────────┐  │
│  │ AP微积分 │ 数学 │ 第1章 函数与导数          │  │
│  │         │     │   · 导数的定义             │  │
│  │         │     │   · 导数的计算             │  │
│  │         │     │ 第2章 积分                 │  │
│  │         │     │   · 不定积分               │  │
│  ├─────────┼─────┼───────────────────────────┤  │
│  │ AP物理   │ 物理 │ 第1章 力学                │  │
│  │         │     │   · 牛顿定律               │  │
│  └─────────┴─────┴───────────────────────────┘  │
└──────────────────────────────────────────────────┘
```

#### 实现细节
- 通过 `isDesktop` 状态切换渲染（复用 Layout.jsx 的 768px 断点逻辑）
- 桌面端用 CSS Grid 布局，课程名+学科为左列（固定宽度），章节单元为右列（flex展开）
- 章节行支持点击展开/折叠，显示单元列表
- 点击课程名/章节名/单元名直接进入编辑（inline edit），回车保存，Esc 取消
- 添加章节/单元输入框内联在对应层级下方
- 利用桌面端宽空间，同校共享课程用并排列展示而非堆叠

#### 交互优化
- 鼠标 hover 时显示操作按钮（编辑/删除）
- 输入框 autoFocus + Enter 提交
- Tab 键可在课程→章节→单元输入框间导航

### 3. 修复时间显示 Bug

**文件**: `src/pages/Learning.jsx`

修改 `fmtRecentDate()` 函数（L71-81）：

```javascript
// 修复前：
const d = new Date(iso);  // "2026-07-10" → UTC 午夜 → 时区偏移

// 修复后：
const d = new Date(iso + 'T00:00:00');  // 强制本地时间解析
```

同时修复 `Review.jsx` 和 `src/lib/date.js` 中相同模式的问题（如 `isWeekday()` 已正确使用 `+ 'T00:00:00'`，确认其他地方一致）。

### 4. 修复 FORM_PRESET Bug

**文件**: `src/pages/Learning.jsx`

L261: `FORM_PRESET` → `ALL_FORM_PRESET`

### 5. Desktop 记录页优化（轻量）

**文件**: `src/pages/Learning.jsx` + `src/index.css`

现有记录页已基本可用，仅做轻量优化：
- 桌面端表单卡片加宽（max-width: 720px → 移除限制或加大）
- "最近记录"列表桌面端用双列网格展示
- 快速记录按钮在桌面端横排展示

## 涉及文件

| 文件 | 修改内容 |
|------|---------|
| `src/App.jsx` | 添加 ResponsiveRedirect 组件 |
| `src/pages/Syllabus.jsx` | 添加桌面端树形表格视图 |
| `src/pages/Learning.jsx` | 修复时间bug、FORM_PRESET bug、轻量桌面优化 |
| `src/index.css` | 添加桌面端 Syllabus 样式、记录页桌面样式 |

## 验证步骤

1. 桌面端（>768px）打开应用 → 应自动跳转到课程页
2. 移动端（≤767px）打开应用 → 应自动跳转到记录页
3. 桌面端课程页：树形表格正确展示，点击可编辑，Enter/Esc 快捷键工作
4. 保存记录后查看最近记录：日期显示正确（无时区偏移）
5. 添加自定义学习形式：不再崩溃
6. 运行 `npm run build` 确认无编译错误
