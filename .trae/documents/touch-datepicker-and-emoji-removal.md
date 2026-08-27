# Plan: 回顾页面触控日期区间选择器 + 全局 Emoji 清除

## Summary

三个改动：

1. **撤销 Learning.jsx 的 MobileDatePicker**：删掉我上次加的整个组件和 📅 emoji，恢复原生 `<input type="date">`
2. **改造 DateRangeCalendar.jsx**：在回顾页面的自定义日期区间选择器中加入「手指按住滑动选区间」触控手势 + 现代 iOS 风格
3. **全局移除 emoji**：清除整个代码库 15+ 文件中约 64 处 emoji 字符

***

## Current State Analysis

### 问题 1：Learning.jsx 的 MobileDatePicker 需要撤销

* 我在 [Learning.jsx#L268-475](file:///Users/jefflau/projects/一表人才/src/pages/Learning.jsx#L268-L475) 加了 `MobileDatePicker` 组件，包含一个 📅 emoji

* 在 [L1606-L1613](file:///Users/jefflau/projects/一表人才/src/pages/Learning.jsx#L1606-L1613) 和 [L2187-L2202](file:///Users/jefflau/projects/一表人才/src/pages/Learning.jsx#L2187-L2202) 用它替换了原生 `<input type="date">`

* 还加了 `isMobile` state 和对应的 useEffect

* **需全部撤销**，恢复原生 input

### 问题 2：DateRangeCalendar.jsx 的交互需改造

* **现有文件**：[DateRangeCalendar.jsx](file:///Users/jefflau/projects/一表人才/src/components/DateRangeCalendar.jsx)（198 行）

* **当前交互**：click 选 start → hover 预览 → click 选 end。移动端 hover 不存在，只能两次点击

* **用户需求**：手指按住 start date，保持按住滑动到 end date，抬起确认区间

* **当前样式**：36px 格子、#4F46E5 indigo 选中色、桌面双月、移动单月

* **调用方**：[StudentDashboard.jsx#L513-L522](file:///Users/jefflau/projects/一表人才/src/components/StudentDashboard.jsx#L513-L522) 的 Toolbar 组件

### 问题 3：全局 emoji 清除

* 已用 Grep 确认 64 处 emoji，分布在 15+ 文件

* 类型：装饰图标（📊📅📘📚等）、UI 符号（✓✕⚠️等）、toast 文本（🎉等）

* 替换策略：

  * 装饰图标 → CSS/SVG icon 或纯文字

  * UI 符号 ✓/✕ → 保留（是 Unicode 符号不是 emoji，但统一处理）

  * toast 文本中的 emoji → 删除 emoji 保留文字

***

## Proposed Changes

### 改动 A：撤销 Learning.jsx 的 MobileDatePicker

**文件**：`src/pages/Learning.jsx`

1. 删除 L268-475 的整个 `MobileDatePicker` 组件（含 `WEEK_LABELS`、`MONTH_LABELS` 常量）
2. 删除 `isMobile` state + 对应 useEffect（L523-L531）
3. 恢复 L1604-L1609 的日期输入为原生 `<input type="date">`（去掉 isMobile 三元）
4. 恢复 L2187-L2202 的成绩 modal 日期输入为原生 `<input type="date">`（去掉 isMobile 三元）
5. 保留 `dragDir` state 也不需要了（如果存在的话）

### 改动 B：DateRangeCalendar.jsx 触控滑动选区间

**文件**：`src/components/DateRangeCalendar.jsx`

#### B1. 新增触控手势逻辑

在 `MonthGrid` 组件的日期格 `<div>` 上加 touch 事件：

* `onTouchStart`：手指按下 → 设置 `selStart = 该日期`，清除 `selEnd`，进入 dragging 模式

* `onTouchMove`：手指移动 → 用 `document.elementFromPoint(touch.clientX, touch.clientY)` 找到手指下方的日期格 → 更新 `hoverDate` 实时预览区间

* `onTouchEnd`：手指抬起 → 把 `hoverDate` 设为 `selEnd`，调用 `onChange(selStart, selEnd)`，退出 dragging 模式

关键实现：

* 日期格需要 `data-date` 属性（YYYY-MM-DD 格式）供 `elementFromPoint` 后查找

* `onTouchMove` 需要 `e.preventDefault()` 防止页面滚动（但需 `touch-action: none` CSS 配合）

* 桌面端保留原有 `onClick` + `onMouseEnter` 交互不变

#### B2. 移动端 UI 升级为底部弹窗

在 `DateRangeCalendar` 主组件中：

* 移动端：用 `createPortal(..., document.body)` 包裹为底部弹出 sheet（类似 iOS 的 modal sheet）

* `framer-motion` spring 动画从底部滑入

* 格子高度从 36px 增大到 44px（HIG 触控标准）

* 保留现有的月份导航 ‹ › 和区间标签

* 保留现有 indigo #4F46E5 选中色（与 StudentDashboard 一致）

* 关闭按钮 ✕ 保留（这是 Unicode 符号不是 emoji）

#### B3. 移动端月份切换也支持滑动

* 整个日历区域支持左右滑动切月（`drag="x"` + `onDragEnd` offset 判断）

* 与现有 `AnimatePresence` 月份切换动画结合

### 改动 C：全局移除 emoji

按文件处理，每个 emoji 替换策略：

| 文件                      | emoji                       | 替换为                 |
| ----------------------- | --------------------------- | ------------------- |
| Learning.jsx            | 📅 (MobileDatePicker)       | 整个组件删除              |
| Learning.jsx            | 📘 L1283                    | 纯文字或 CSS icon       |
| Learning.jsx            | ✓ L1449                     | SVG checkmark       |
| Learning.jsx            | ✏️ L1538                    | 文字"编辑"              |
| Learning.jsx            | 📚 L1551                    | 纯文字                 |
| Learning.jsx            | ✓ L1837                     | 文字"已选"              |
| StudentDashboard.jsx    | 📊 L274                     | 纯文字空状态              |
| StudentDashboard.jsx    | 📅 L290                     | 纯文字空状态              |
| Review\.jsx             | ⚠️ L77                      | 纯文字                 |
| Review\.jsx             | 📊 L92                      | 纯文字                 |
| Mentor.jsx              | ⚠️ L680                     | 纯文字                 |
| Mentor.jsx              | 👥 L753                     | 纯文字                 |
| Mentor.jsx              | 🔍 L1032                    | 纯文字                 |
| Mentor.jsx              | 💡 L1114                    | 纯文字                 |
| Mentor.jsx              | 📊 L1383                    | 纯文字                 |
| Mentor.jsx              | 📖 L1547/L1556              | 纯文字                 |
| Mentor.jsx              | ⚠️ L1644                    | 纯文字                 |
| Mentor.jsx              | 📋 L1881                    | 纯文字                 |
| Mentor.jsx              | 📊 L2107                    | 纯文字                 |
| Mentor.jsx              | 📖 L2223/L2229              | 纯文字                 |
| MentorAnalytics.jsx     | ⚠️ L1459                    | 纯文字                 |
| Login.jsx               | 🧑‍🏫 L349                  | 纯文字                 |
| Syllabus.jsx            | ⚠️ L358, 📖 L407/L1187      | 纯文字                 |
| Syllabus.jsx            | ✓ L527/L564/L1039/L1076     | 保留（checkmark UI 符号） |
| Signup.jsx              | 🎉 L119/L125                | 删除 emoji            |
| Notifications.jsx       | 🎉 L145, 📨 L197            | 删除 emoji / 纯文字      |
| DebugTools.jsx          | 🎉/❌/🧪/📥/🗑/🔎/📌         | 删除 emoji            |
| SharedDashboard.jsx     | 🎉 L374/L1025               | 删除 emoji            |
| DimensionStrip.jsx      | ✓ L150                      | 保留（UI 符号）           |
| DeepDivePanels.jsx      | ⚠/✓/✎ L875/L932/L1343/L1346 | 保留（UI 符号）           |
| WeekReviewDashboard.jsx | 📋 L140                     | 纯文字                 |
| ProfileEditor.jsx       | ✕ L333                      | 保留（UI 符号）           |
| DateRangeCalendar.jsx   | ✕ L294                      | 保留（UI 符号）           |
| ErrorBoundary.jsx       | ⚠️ L43                      | 纯文字                 |
| StatusStates.jsx        | 📋/⚠️/📡                    | 纯文字或 CSS icon       |
| DeepDivePanels.jsx      | ⚠ L104                      | 保留（UI 符号）           |

策略简化：

* **装饰性 emoji**（📊📅📚📘 etc）→ 直接删除，空状态用纯文字 + CSS 样式（字号/颜色对比）

* **toast 中的 emoji**（🎉 etc）→ 删除 emoji 保留文字

* **Unicode 符号**（✓ ✕ ⚠ ✎）→ 保留，这些是排版符号不是 emoji

***

## Assumptions & Decisions

1. **只改 DateRangeCalendar.jsx**：Learning.jsx 的 MobileDatePicker 完全撤销，不做移动端日历替换
2. **保留 #4F46E5 indigo**：DateRangeCalendar 和 StudentDashboard 的现有配色不动，只改交互和布局
3. **✓ ✕ ⚠ 等排版符号保留**：这些是 Unicode 符号不是 emoji，在 UI 中有功能意义（选中标记、关闭按钮等）
4. **桌面端 DateRangeCalendar 交互不变**：只加移动端 touch 逻辑，桌面保留 click+hover
5. **touch-action: none** 加在日期网格容器上，防止滑动时页面滚动
6. **elementFromPoint 方案**：这是最可靠的触控滑动选区间方案，不需要计算坐标

***

## Verification Steps

1. `npx vite build` 零错误通过
2. **回顾页面移动端**：点「自定义」→ 日历从底部弹出 → 手指按住一个日期 → 不松手滑动到另一个日期 → 松手 → 区间选中 → 数据刷新
3. **回顾页面桌面端**：点「自定义」→ 日历展开 → click start → hover 预览 → click end → 区间选中（交互不变）
4. **Learning.jsx**：记录表单日期恢复原生 `<input type="date">`，成绩 modal 日期也恢复原生
5. **全局无 emoji**：grep 确认代码库中不再有 emoji 字符（✓✕⚠ 等排版符号除外）

