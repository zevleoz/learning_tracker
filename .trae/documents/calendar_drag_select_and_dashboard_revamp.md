# 日历拖拽选择 + 学生/导师数据展示优化

## 概述

三项改动：
1. **WeekReviewDashboard 自定义区间选择器** → 替换为携程/订酒店式拖拽日历
2. **学生端 Review 页** → 全新设计现代化数据看板，替换 legacy v1 SharedDashboard
3. **导师端学生管理详情面板** → 现代化重设计，展示更丰富的学生数据快照

---

## 当前状态分析

### 1. 日历区间选择（WeekReviewDashboard.jsx L216-266）
- 点击「自定义」按钮后展开一个面板，内含两个 `<input type="date">` + 应用/取消按钮
- 交互不直观：需手动输入/选择两个日期，无视觉化日历网格
- 预设按钮（本周/上周/近2周/近4周/本月/自定义）保持不变

### 2. 学生端数据看板（Review.jsx → SharedDashboard.jsx）
- Review.jsx L148-153 渲染 6 个 legacy v1 组件：HeroBlock / StreakBlock / EfficiencyBlock / MonthlyBarsBlock / SubjectSummaryBlock / SuggestionsBlock
- SharedDashboard.jsx 全文标记 `@legacy v1`，使用 inline style + glassmorphism
- 时间筛选仅有 4 个按钮：本周/本月/近3月/全年（无自定义区间）
- 数据信息基本但呈现方式陈旧，缺乏视觉层级和交互性

### 3. 导师端学生详情面板（Mentor.jsx L1263-1340，移动端）
- 点击学生后展开 overlay 面板，仅显示：
  - 2 个统计数字（学习记录数、累计时长）
  - 一行提示「💡 周度复盘请前往「数据分析」tab」
  - 最近 5 条 session 列表（科目名 + 时长）
  - 「前往数据分析 →」按钮
- 信息密度极低，无法快速了解学生整体状况

### 可用技术栈
- `framer-motion@^12.42.2` — 动画
- `recharts@^3.10.0` — 图表（学生端新看板可用）
- `lucide-react@^1.21.0` — 图标
- 无日历库，需自建 DateRangeCalendar 组件

### 数据模型
学生 session 字段（Review.jsx 和 Mentor.jsx 共享）：
- `date` (session_date), `time` (start_time), `duration_minutes`
- `category` (1=学/2=复/3=练), `form`, `eval_type`, `score`
- `subject` (course name), `subjectCategory`

### 学科色彩系统
- `CATEGORICAL_PALETTE` 定义在 DeepDivePanels.jsx L29-42（12 色黄金角交错，零灰色）
- `useSubjectColors(sessionList)` — session 内去重分配，≤12 门 0 重色
- `subjectColor(name)` — 兼容性单参数函数
- 新学生看板和导师详情面板均复用此色彩系统

---

## 改动计划

### Part 1: DateRangeCalendar 组件（新建）

**文件**: `src/components/DateRangeCalendar.jsx`（新建）

**功能**: 携程/订酒店式拖拽选择日期区间的日历组件

**交互逻辑**:
- 点击日期 → 设为起始日，进入拖拽态
- 拖动到另一日期 → 高亮起始到当前的连续区间
- 松手/点击第二日期 → 确认区间，调用 `onChange`
- 再次点击 → 重置起始日
- 若点击日期早于当前起始日 → 重置为新起始日

**组件 API**:
```jsx
<DateRangeCalendar
  start={Date}           // 当前起始日
  end={Date}             // 当前结束日
  onChange={(s, e) => {}} // 区间确认回调
  onClose={() => {}}     // 关闭日历
  maxDate={new Date()}   // 最大可选日期（默认今天）
  minDate={Date}         // 最小可选日期（默认 365 天前）
/>
```

**视觉设计**:
- 月历网格：7 列 × 5-6 行
- 星期表头：一/二/三/四/五/六/日
- 选中区间：连续色带（`rgba(79,70,229,0.15)` 底色 + 两端圆形填充 `#4F46E5`）
- 今日：蓝色边框圈
- 非本月日期：灰色淡显
- 月份导航：‹ 2026年8月 ›
- 桌面端：双月并排（当前月 + 下月）
- 移动端：单月，左右滑动切换（framer-motion drag）
- 尺寸：紧凑型，高度 ~280px（单月）

**实现要点**:
- 使用 `useState` 管理 `viewMonth`（显示的月份）、`dragStart`、`dragEnd`、`isDragging`
- 使用 `useRef` 追踪鼠标/触摸位置
- `onMouseDown` / `onMouseEnter` / `onMouseUp` 处理桌面拖拽
- `onTouchStart` / `onTouchMove` / `onTouchEnd` 处理移动端
- 月份切换使用 framer-motion `AnimatePresence` + 滑动方向
- 不依赖任何第三方日历库

### Part 2: WeekReviewDashboard 集成日历（修改）

**文件**: `src/components/WeekReviewDashboard.jsx`

**改动范围**: L216-266（自定义日期选择器弹窗）

**改动内容**:
- 删除现有的 `<input type="date">` 面板
- 替换为 `DateRangeCalendar` 组件
- 点击「自定义」预设按钮时展开日历（保留 `showCustomPicker` 状态）
- 用户在日历上拖拽选择区间后，立即调用 `applyCustomRange` 逻辑
- 保留 `customStart` / `customEnd` 状态，但改为由日历组件驱动
- 关闭日历时保留已选区间（不需要「应用」按钮，拖拽完成即生效）

**改动前** (L216-266):
```jsx
{showCustomPicker && (
  <motion.div ...>
    <span>起始日期</span>
    <input type="date" ... />
    <span>结束日期</span>
    <input type="date" ... />
    <button>应用</button>
    <button>取消</button>
  </motion.div>
)}
```

**改动后**:
```jsx
{showCustomPicker && (
  <motion.div initial={{...}} animate={{...}}>
    <DateRangeCalendar
      start={customStart ? new Date(customStart) : getMonday(new Date())}
      end={customEnd ? new Date(customEnd) : new Date()}
      onChange={(s, e) => {
        setCustomStart(s.toISOString().split('T')[0]);
        setCustomEnd(e.toISOString().split('T')[0]);
        setCustomRange({ start: s, end: e });
        setPresetId('custom');
      }}
      onClose={() => setShowCustomPicker(false)}
    />
  </motion.div>
)}
```

**不变部分**:
- 预设按钮（本周/上周/近2周/近4周/本月/自定义）完全保留
- 区间导航（‹ ›）保留
- 学生姓名标签保留
- WeekGrid / DimensionStrip / DeepDivePanels 不受影响

### Part 3: 学生端全新数据看板（新建 + 修改）

**文件**: `src/components/StudentDashboard.jsx`（新建）+ `src/pages/Review.jsx`（修改）

#### StudentDashboard.jsx 设计

**整体结构**:
```
┌──────────────────────────────┐
│  时间筛选栏（预设按钮 + 日历）   │  ← 复用 DateRangeCalendar
├──────────────────────────────┤
│  Hero 总览                    │  ← 总时长 + 日均 + 趋势箭头
│  ┌──────┐ ┌──────┐ ┌──────┐  │
│  │总时长 │ │日均  │ │活跃天│  │
│  └──────┘ └──────┘ └──────┘  │
├──────────────────────────────┤
│  学科分布                     │  ← 横向条形图，用 CATEGORICAL_PALETTE
│  ████ 科目A    2h30m  35%    │
│  ██   科目B    1h15m  20%    │
│  █    科目C    0h45m  10%    │
├──────────────────────────────┤
│  学习节奏                     │  ← 工作日 vs 周末日均 + 连续天数
│  ┌──────────┐ ┌────────────┐ │
│  │工作日日均 │ │连续学习 X 天│ │
│  └──────────┘ └────────────┘ │
├──────────────────────────────┤
│  成绩趋势                     │  ← recharts 折线图（按日期）
│  ╱╲___╱╲___                  │
├──────────────────────────────┤
│  最近记录                     │  ← 时间线列表（日期/科目/时长/类别/分数）
│  8/22  数学  45m  练  85     │
│  8/21  英语  30m  学  —      │
├──────────────────────────────┤
│  数据洞察                     │  ← 2-3 条简短数据驱动观察
└──────────────────────────────┘
```

**区块详细设计**:

1. **时间筛选栏**
   - 预设按钮：本周 / 本月 / 近3月 / 全年 / 自定义
   - 「自定义」展开 DateRangeCalendar（复用 Part 1 组件）
   - 刷新按钮

2. **Hero 总览卡片**
   - 主数字：选中区间总学习时长（大号 monospace 字体）
   - 副信息：日均时长、活跃天数、区间跨度
   - 趋势指示：与上一同等长度区间对比的 ↑/↓ 百分比
   - 设计：白色卡片 + 微妙阴影，无 glassmorphism

3. **学科分布**
   - 横向条形图：每科目一行，左色块 + 科目名 + 时长 + 占比
   - 色块使用 `useSubjectColors(sessionList)` 分配颜色
   - 按时长降序排列
   - 条形宽度按占比

4. **学习节奏**
   - 左卡：工作日日均 vs 周末日均（两个数字 + 对比指示）
   - 右卡：当前连续学习天数 + 本周活跃天数 / 7

5. **成绩趋势**（recharts）
   - 折线图：X 轴日期，Y 轴分数
   - 仅显示有客观评估（eval_type=2）的 session
   - 按学科着色（使用 subjectColor）
   - 空数据时显示占位提示

6. **最近记录**
   - 时间线列表：日期 / 科目（带颜色点）/ 时长 / 类别（学/复/练标签）/ 分数
   - 最多 10 条
   - 紧凑行布局

7. **数据洞察**
   - 2-3 条简短观察，基于实际数据
   - 例如：「数学投入占比 45%，建议平衡文科」「周末学习时长偏低」
   - 无数据时隐藏

**样式原则**:
- 白色/浅灰底卡片，`border-radius: 12px`
- 字体：系统默认 + monospace 数字
- 间距：卡片间 12px gap，内边距 16px
- 响应式：移动端单列，桌面端部分双列
- 动画：framer-motion 入场动画，数字 count-up
- 颜色：品牌紫 `#4F46E5` 为主色，状态色绿/橙/红

**复用**:
- 从 DeepDivePanels.jsx 导入 `useSubjectColors` / `subjectColor`
- 从 WeekGrid.jsx 导入 `getMonday` / `getWeeksInRange` / `fmtDateShort`
- 从 `lib/date.js` 导入 `fmtMinutes` / `isWeekday`

#### Review.jsx 修改

**改动**:
- 删除 SharedDashboard 全部 import
- 替换为 `import StudentDashboard from '../components/StudentDashboard.jsx'`
- 保留 session 数据获取逻辑不变
- 传递 `sessions` 给 `StudentDashboard`
- 删除旧的时间筛选按钮（移入 StudentDashboard 内部）

**改动前** (Review.jsx L148-153):
```jsx
<HeroBlock sessions={filteredSessions} />
<StreakBlock sessions={filteredSessions} />
<EfficiencyBlock sessions={filteredSessions} />
<MonthlyBarsBlock sessions={filteredSessions} />
<SubjectSummaryBlock sessions={sessions} />
<SuggestionsBlock sessions={filteredSessions} />
```

**改动后**:
```jsx
<StudentDashboard sessions={sessions} />
```

**保留不变**:
- `fetchSessions()` 数据获取逻辑
- loading 状态
- session 数据映射逻辑

### Part 4: 导师端学生详情面板重设计（修改）

**文件**: `src/pages/Mentor.jsx`（L1263-1340，移动端 detail overlay）

**当前状态**: 仅显示 2 个统计数字 + 5 条 recent sessions + 跳转按钮

**重设计**:

```
┌──────────────────────────────┐
│  ✕  Jeff 的学习数据            │
├──────────────────────────────┤
│  ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐
│  │  45 │ │ 38h │ │ 2.1h│ │ 4/7 │
│  │记录  │ │累计  │ │日均  │ │本周  │
│  └─────┘ └─────┘ └─────┘ └─────┘
├──────────────────────────────┤
│  学科分布                     │
│  ● 数学   18h  47%  ████████  │
│  ● 英语   10h  26%  ████      │
│  ● 物理    6h  16%  ██        │
│  ● 化学    4h  11%  █         │
├──────────────────────────────┤
│  最近评估                     │
│  数学  85  A-   8/22          │
│  英语  78  C+   8/20          │
│  物理  92  A    8/18          │
├──────────────────────────────┤
│  最近活动                     │
│  8/22  数学  45m  练          │
│  8/21  英语  30m  学          │
│  8/20  物理  60m  复          │
├──────────────────────────────┤
│  [前往深度分析 →]              │
└──────────────────────────────┘
```

**改动内容**:
- 统计数字从 2 个扩展为 4 个：学习记录 / 累计时长 / 日均时长 / 本周活跃天
- 新增「学科分布」区块：科目名 + 颜色点 + 时长 + 占比 + 迷你进度条
  - 使用 `subjectColor(name)` 分配颜色（从 DeepDivePanels 导入）
- 新增「最近评估」区块：有客观评估分数的最近 3-5 条记录（科目 + 分数 + 等级 + 日期）
- 保留「最近活动」但改为 3 条（紧凑）
- 保留「前往深度分析」按钮
- 删除「💡 周度复盘请前往「数据分析」tab」提示（按钮已足够明确）

**实现要点**:
- 在 Mentor.jsx 中导入 `subjectColor` from DeepDivePanels
- 在 detail overlay 内部计算学科分布（useMemo）
- 保持现有 overlay 的动画和样式框架
- 移动端优先设计，卡片宽度自适应

---

## 文件变更清单

| 文件 | 操作 | 改动 |
|------|------|------|
| `src/components/DateRangeCalendar.jsx` | 新建 | 拖拽选择日历组件 |
| `src/components/WeekReviewDashboard.jsx` | 修改 | L216-266 替换日历选择器 |
| `src/components/StudentDashboard.jsx` | 新建 | 全新学生数据看板 |
| `src/pages/Review.jsx` | 修改 | 替换 SharedDashboard → StudentDashboard |
| `src/pages/Mentor.jsx` | 修改 | L1263-1340 重设计学生详情面板 |

**不改动**:
- `src/components/SharedDashboard.jsx` — 保留 legacy 代码，不删除（可能被其他地方引用）
- `src/components/DeepDivePanels.jsx` — 仅导入 `useSubjectColors` / `subjectColor`，不修改
- `src/components/WeekGrid.jsx` — 仅导入工具函数，不修改
- `src/components/DimensionStrip.jsx` — 不涉及
- `src/pages/MentorAnalytics.jsx` — legacy 不动

---

## 验证步骤

1. **日历组件**:
   - 点击「自定义」展开日历
   - 拖拽选择区间 → 数据看板立即更新
   - 月份切换正常
   - 移动端单月滑动切换
   - 预设按钮仍正常工作

2. **学生看板**:
   - `/review` 页面显示全新看板
   - 时间筛选正常（预设 + 自定义日历）
   - 学科分布使用新调色板，颜色清晰分离
   - 成绩趋势图表正常渲染
   - 空数据时优雅降级

3. **导师详情面板**:
   - 学生管理 tab 点击学生 → 详情面板展开
   - 4 个统计数字正确
   - 学科分布颜色与 WeekReviewDashboard 一致
   - 最近评估和活动正常显示
   - 「前往深度分析」按钮跳转正常

4. **构建验证**:
   - `npm run build` 无错误
   - 无控制台报错

---

## 假设与决策

1. **日历不引入第三方库** — 自建组件保证设计一致性和包体积控制
2. **StudentDashboard 不使用 WeekReviewDashboard** — 学生端需要更轻量的个人视角，不需要导师级的深度分析
3. **SharedDashboard 保留不删** — 避免破坏潜在引用，Review.jsx 不再使用即可
4. **学生看板复用 DateRangeCalendar** — 统一交互体验，减少重复代码
5. **导师详情面板移动端优先** — 该面板主要在移动端 overlay 中使用
6. **学科颜色跨组件一致** — 通过导入 `useSubjectColors` / `subjectColor` 保证学生看板和导师详情面板颜色与 WeekReviewDashboard 一致
