# 修复导师端响应式：桌面端始终显示桌面版

## 问题

在桌面端浏览导师界面时，当浏览器窗口变窄（如分屏、侧边面板）会误触发移动端导师界面。用户希望：导师端只要不在手机上就显示桌面版，移除所有平板尺寸的自适应旧代码。学员端保持不变。

## 根因分析

导师端共有 3 处基于窗口宽度的响应式断点，桌面窄窗口会误触发：

| 文件                                       | 行号  | 断点                 | 作用                  | 问题          |
| ---------------------------------------- | --- | ------------------ | ------------------- | ----------- |
| `src/pages/Mentor.jsx`                   | 159 | `max-width: 480px` | 切换桌面/移动导师布局         | 桌面窄窗口误触发移动版 |
| `src/components/WeekReviewDashboard.jsx` | 76  | `max-width: 767px` | 切换周历 WeekGrid 桌面/移动 | 平板自适应旧代码    |
| `src/components/DateRangeCalendar.jsx`   | 217 | `max-width: 767px` | 切换日历选择器桌面/移动        | 共享组件，学员端也用  |

此外还有 1 处死 CSS（旧版平板自适应）：

* `src/index.css:6190` — `@media (max-width: 768px)` 影响 `ma-*` 类，但 `ma-*` 类已无任何 JSX 引用（已确认搜索结果为空），属于遗留死代码。

## 方案：双条件手机检测

用户确认采用「保留宽度 + 加设备检测」方案。用 `(pointer: coarse) and (hover: none) and (max-width: 480px)` 检测真实手机：

* 桌面（pointer: fine / hover: hover）→ 无论窗口多窄，isMobile 恒为 false → 桌面版

* 平板（pointer: coarse 但宽度 >480px）→ isMobile false → 桌面版

* 手机（触屏 + 无 hover + ≤480px）→ isMobile true → 移动版

## 具体改动

### 1. `src/pages/Mentor.jsx` (行 156-164)

将媒体查询从 `(max-width: 480px)` 改为 `(pointer: coarse) and (hover: none) and (max-width: 480px)`，更新注释说明改为双条件手机检测。

### 2. `src/components/WeekReviewDashboard.jsx` (行 75-81)

将媒体查询从 `(max-width: 767px)` 改为 `(pointer: coarse) and (hover: none) and (max-width: 480px)`，移除平板自适应断点。WeekGrid 在非手机时恒走桌面版。

### 3. `src/components/WeekReviewDashboard.jsx` (行 224 DateRangeCalendar 调用处)

给 `<DateRangeCalendar>` 传入 `isMobileOverride={isMobile}`，让日历选择器跟随导师端的手机检测结果，而非用自己的 767px 断点。

### 4. `src/components/DateRangeCalendar.jsx` (行 193-222 主组件)

* 组件签名新增可选 prop `isMobileOverride`

* `useEffect` 中：当 `isMobileOverride !== undefined` 时，直接 `setIsMobile(isMobileOverride)` 并跳过 matchMedia 监听；否则保持原有 767px 内部断点逻辑（学员端不受影响）

* 依赖数组加入 `isMobileOverride`

这样：

* 导师端（经 WeekReviewDashboard 传 prop）→ 使用手机检测

* 学员端（StudentDashboard 不传 prop）→ 保持 767px 平板自适应，不变

### 5. `src/index.css` (行 6190-6203)

删除 `@media (max-width: 768px) { ... }` 块（影响 `ma-overview__stats`、`ma-grid-2`、`ma-behavior`、`ma-behavior__stats`）。这些类已无 JSX 引用，是遗留死代码。

## 不变的部分

* **学员端**：`src/components/StudentDashboard.jsx` 行 189 的 `(max-width: 767px)` 断点保持不变

* **学员端 DateRangeCalendar 调用**：不传 `isMobileOverride`，保持 767px 内部断点

* **`src/index.css:7164`** `@media (max-width: 380px)` for `m-mentor-*`：保留（仅手机导师版用）

* **`src/components/Layout.jsx:135`**：学员端布局断点，不动

## 验证步骤

1. 桌面浏览器正常宽度 → 导师端显示桌面版（含侧边栏、桌面周历、桌面日历选择器）
2. 桌面浏览器拖窄到 400px → 导师端**仍然显示桌面版**（不再跳移动版）
3. 桌面浏览器拖窄到 300px → 导师端**仍然显示桌面版**
4. 用 Chrome DevTools 模拟 iPhone（触屏）→ 导师端显示移动版
5. 用 Chrome DevTools 模拟 iPad（768px+）→ 导师端显示桌面版
6. 学员端在 400px / 767px / 桌面宽度下 → 响应式行为与改动前一致（无变化）
7. 数据分析 tab 的周历网格在桌面窄窗口下保持桌面版布局

