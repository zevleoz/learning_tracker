# 导师端周历：点击日期展开当日明细（含备注）

## 摘要

导师端「数据分析」页面的周历总览中，每个有记录的日期卡片目前只显示聚合数字（总时长、学/复/练占比、学科、自主占比）。本次改动让导师**点击某一天的卡片**，在该周行下方**内联展开**当天全部记录明细：学科、类型、形式、时长、章节·单元、评价，以及**学生填写的备注原文（完整不截断）**。再点一次、点面板「收起」或按 Esc 收起。

不改数据库、不改学生端、不改打印/PDF 路由。

## 现状分析

### 相关文件与关键位置

| 文件 | 位置 | 现状 |
| --- | --- | --- |
| [WeekGrid.jsx](file:///Users/jefflau/projects/一表人才/src/components/WeekGrid.jsx#L83-L255) | `DayCard` | 桌面竖版卡片 / 移动横条，纯展示聚合数据 |
| [WeekGrid.jsx](file:///Users/jefflau/projects/一表人才/src/components/WeekGrid.jsx#L258-L303) | `WeekGrid` | 已声明 `onDayClick` prop 并接到 `DayCard` 上，但**无人传值**，等于未启用 |
| [WeekReviewDashboard.jsx](file:///Users/jefflau/projects/一表人才/src/components/WeekReviewDashboard.jsx#L294-L327) | 周历渲染 | 按周渲染 `WeekGrid`，未传 `onDayClick` |
| [Mentor.jsx](file:///Users/jefflau/projects/一表人才/src/pages/Mentor.jsx#L428-L457) | `fetchPickedSessions` | 已 select 并透传 `notes`（备注）、`start_time`、`score`、`self_rating`、`grade_label`、`category`、`form`、`chapter.name`、`unit.name`，并映射出 `date` / `time` / `subject` |
| [WeekReviewDashboard.jsx](file:///Users/jefflau/projects/一表人才/src/components/WeekReviewDashboard.jsx) | 调用方 | 导师端桌面（Mentor.jsx L1634）与移动端（L2503）共用同一个组件 |

### 结论

- **数据已就绪**：`sessions` 数组里已有备注和全部单条记录字段，无需新增查询或迁移。
- `WeekGrid` 已预留 `onDayClick`，本次只需接线 + 新建明细组件。
- 空白天卡片（虚线 `—`）当前不带 `onClick`，保持不可点击即可（无数据不展开）。
- 设计规范：沿用 `.trae` 既有约束——细线边框、白色/浅色底、小圆角、语义色仅作小圆点/文字、hover 即时反馈、`focus-visible` 焦点环、备注长文不截断、移动端同功能。

## 改动方案

### 1. 新建 `src/components/DayDetailPanel.jsx`

**Props**：`{ dateStr, sessions, onClose, isMobile }`
- `dateStr`：`YYYY-MM-DD`
- `sessions`：当天记录（已排序，见 3）
- `onClose`：收起回调

**结构**

```
┌───────────────────────────────────────────────┐
│ 10月5日 周一   合计 3h20'  ·  4 条记录    [收起] │  ← 头部（左：日期；右：统计 + 细线小按钮）
├───────────────────────────────────────────────┤
│ 14:30  ● 练  数学  自主练习          45'        │  ← 记录 1：时间 / 类型点 / 学科 / 形式 / 时长
│ 第3章 · 3.2 一元二次方程                        │  ← 章节 · 单元（有则显示）
│ 客观：B+ · 87 分                                │  ← 评价（主观或客观）
│ │ 备注                                          │  ← 备注块（左侧细轨 + 小标签）
│ │ 今天题量偏少，但错题都重新做了一遍……            │  ← 备注原文，完整显示，pre-wrap
├───────────────────────────────────────────────┤
│ 19:00  ● 学  英语  自主预习          30'        │  ← 记录 2（hairline 分隔）
└───────────────────────────────────────────────┘
```

**字段显示规则**（字段名对齐 `WeekGrid` / `Learning.jsx` 的既有语义，不发明新术语）

- 头部：`M月D日 周X`（`dateStr` 解析，星期用 `['日','一','二','三','四','五','六']`）；`合计 ${fmtMins(总时长)}`；`${sessions.length} 条记录`；右侧「收起」按钮。
- 每条记录第一行：`time`（等宽字体、`#94a3b8`，无则留空）→ 6px 分类圆点（`CATEGORY_COLORS`）+ `CATEGORY_NAMES`（学/复/练）→ `subject` 加粗 → `form` 文本（如「自主练习」）→ 右对齐时长 `fmtMins`。
- 第二行：`chapter?.name · unit?.name`（仅在有值时显示）。
- 第三行评价（两者取存在的）：
  - `self_rating != null` → `主观：{SUBJECTIVE_LABEL[self_rating]}`，标签映射与 [Learning.jsx](file:///Users/jefflau/projects/一表人才/src/pages/Learning.jsx#L31-L37) 一致：`100 完全掌握 / 80 基本掌握 / 60 有不少没掌握 / 40 像在听天书 / 20 没有听课`。
  - `category === 3`：`grade_label` 存在 → `客观：{grade_label}`（`N/A` 时灰色斜体）；`score != null` → 追加 `· {score} 分`，分数用 `scoreColor(score)` 小字着色。
- **备注**：`r.notes` 存在时才渲染；`whiteSpace: 'pre-wrap'`，`lineHeight: 1.7`，字号 12.5，颜色 `#475569`，左侧 2px 细轨 + 「备注」小标签（11px `#94a3b8`）。长文完整换行展示，不截断、不加省略号。

**样式**（遵循项目「去 AI 味」规范）

- 外层：`background: '#fff'`，`border: '1px solid rgba(15,23,42,0.08)'`，`borderTop: '2px solid #4F46E5'`（呼应卡片主色、标示展开态），`borderRadius: 10`，`padding: isMobile ? 16 : '20px 24px'`。
- 记录之间：`borderTop: '1px solid #f1f5f9'` 细线分隔，不做卡中卡、不加阴影。
- 无糖果色填充：分类色只出现在 6px 圆点与文字；无渐变。
- 动画：`motion.div`，`initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}`，外层 `overflow: hidden`（与 [StudentDashboard.jsx](file:///Users/jefflau/projects/一表人才/src/components/StudentDashboard.jsx#L530-L550) 内联日历展开一致）。
- 从 `./WeekGrid.jsx` 引入 `CATEGORY_COLORS`、`CATEGORY_NAMES`、`fmtMins`、`scoreColor`（均已 export）。`SUBJECTIVE_LABEL`、`WEEKDAY_LABEL` 在本文件内定义为局部常量。

### 2. `src/components/WeekGrid.jsx`：日卡片可点击 + 选中/悬停反馈

- `WeekGrid` 增加 `selectedDate` prop：`WeekGrid({ sessions, weekStart, isMobile, onDayClick, selectedDate })`，向 `DayCard` 传 `isSelected={selectedDate === dateKey(date)}`（新增局部 `dateKey(d)` 帮助函数，格式 `YYYY-MM-DD`，与 `toLocalDateStr` 同格式）。
- `DayCard({ dayName, date, daySessions, isMobile, onClick, isSelected })`：
  - 新增局部 `const [hover, setHover] = useState(false)`（需从 react 引入 `useState`）。
  - 有 `onClick` 时（桌面卡片 + 移动横条均适用）：
    - `role="button"`、`tabIndex={0}`、`className="wk-daycard"`；
    - `onMouseEnter/onMouseLeave` 切换 `hover`；
    - `onKeyDown`：`Enter` / `Space` 触发 `onClick`（`Space` 需 `e.preventDefault()`）；
    - 边框：`isSelected ? '1px solid #4F46E5' : hover ? '1px solid rgba(79,70,229,0.35)' : '1px solid rgba(15,23,42,0.06)'`（基础边框本来就是 1px，无布局跳动）；
    - 背景沿用现有 `rgba(99,102,241, 0.03 + intensity*0.06)` 公式，`isSelected` 时上浮到 `0.14` 浅底。
  - 无 `onClick` 的（空白天）保持现状，不加 role / 交互。
- 点击区域与现有 `onClick` 接线不变（[WeekGrid.jsx L283/L299](file:///Users/jefflau/projects/一表人才/src/components/WeekGrid.jsx#L283-L299)）。

### 3. `src/components/WeekReviewDashboard.jsx`：状态接线 + 面板落位

1. 顶部引入：`DayDetailPanel`、`AnimatePresence`（`framer-motion` 已引入 `motion`，补 `AnimatePresence`）。
2. 新增状态：`const [selectedDay, setSelectedDay] = useState(null);`（`YYYY-MM-DD` 字符串）。
3. 当天记录 memo（在 `periodSessions` 之后）：

```js
const selectedDaySessions = useMemo(() => {
  if (!selectedDay) return [];
  return sessions
    .filter(s => s.date?.split('T')[0] === selectedDay)
    .sort((a, b) =>
      String(a.time || '').localeCompare(String(b.time || '')) ||
      String(a.created_at || '').localeCompare(String(b.created_at || '')));
}, [sessions, selectedDay]);
```

4. 点击切换：

```js
function handleDayClick(date) {
  const key = toLocalDateStr(date);   // 已从 '../lib/date.js' 引入
  setSelectedDay(prev => (prev === key ? null : key));
}
```

5. 收起联动：
   - Esc：`useEffect`，仅 `selectedDay` 存在时挂 `window` keydown，`Escape` → `setSelectedDay(null)`，卸载时移除。
   - 切换时段 / 切换学生时重置：`useEffect(() => { setSelectedDay(null); }, [presetId, customRange, student?.id]);`
6. 周行渲染（[WeekReviewDashboard.jsx L304-L325](file:///Users/jefflau/projects/一表人才/src/components/WeekReviewDashboard.jsx#L304-L325) 的 `weeks.map` 内部）：给 `WeekGrid` 传 `onDayClick={handleDayClick} selectedDate={selectedDay}`；在 `WeekGrid` 之后紧接渲染面板，**只在该周包含 `selectedDay` 时显示**：

```jsx
{(() => {
  if (!selectedDay || selectedDaySessions.length === 0) return null;
  const d = new Date(selectedDay + 'T00:00:00');
  const weekEnd = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + 6);
  if (d < weekStart || d > weekEnd) return null;
  return (
    <AnimatePresence>
      <div style={{ marginTop: 8 }}>
        <DayDetailPanel
          dateStr={selectedDay}
          sessions={selectedDaySessions}
          onClose={() => setSelectedDay(null)}
          isMobile={isMobile}
        />
      </div>
    </AnimatePresence>
  );
})()}
```

移动端（`isMobile`）复用同一面板：`WeekGrid` 移动版是 7 条横条，面板出现在整周横条列下方。

### 4. `src/index.css`：追加焦点环样式（追加到文件末尾）

```css
/* 导师端周历：可点击日卡片的键盘焦点环 */
.wk-daycard:focus-visible {
  outline: 2px solid rgba(79, 70, 229, 0.45);
  outline-offset: 2px;
}
```

（hover 反馈用组件内 state 实现，无需 CSS；`outline` 未被内联样式覆盖，类选择器可直接生效。）

### 5. 新增 `__tests__/WeekDayDetail.test.jsx`（轻量，2 个用例）

- 构造与「本周」预设对齐的固定数据：取 `getMonday(new Date())`（从 `WeekGrid.jsx` 导出），在该周一与周二各放记录，备注字段填入特征文本（如 `今天题量偏少，错题都重做了`）。
- 用例 1「点击日期展开当日明细并显示备注」：`render(<WeekReviewDashboard sessions={fixtures} student={{ full_name: 'Leo' }} />)`；点击包含该日 `M/D` 文本的可点击卡片（`screen.getByText('10/5')` → `.closest('[role="button"]')`）；断言当日两条记录的学科与**备注原文**均出现、非当日记录不出现。
- 用例 2「再次点击 / 点收起后面板关闭」：再点同一天（或点「收起」），`waitFor(() => expect(screen.queryByText(备注文本)).not.toBeInTheDocument())`。
- 环境依赖已具备：`setupEnv.js` 已 mock `matchMedia`；`WeekReviewDashboard` 依赖链不含 supabase，无需额外 mock。

## 假设与决策

- **展示形式**：按用户确认，采用「周行下方通栏内联展开」，不用弹窗/抽屉。
- **只对有待办记录的日期可点击**：空白天卡片维持现状（虚线、不可点）。数据为空时组件不存在展开入口，面板内部不做无数据的空态。
- **数据来源不变**：直接使用 `sessions` prop（导师端已在 `fetchPickedSessions` 中拉到 `notes` 等字段），不新增 Supabase 查询、不改表结构、不改 RLS。
- **作用范围**：只改导师端共用组件 `WeekReviewDashboard`（桌面 + 移动自动同时生效）；学生端 `StudentDashboard`、遗留 `SharedDashboard`、打印路由均不改动。
- **备注即 `notes` 字段**：学生端「记录」页的「备注」表单字段，落库列名 `notes`，导师端已透传。
- **标签文案**：主观评价沿用学生端所见文案（`SUBJECTIVE_STEPS`），客观评价用 `grade_label` / `score`，不新造词。
- **不做**：编辑、删除、跳转学生端记录页、导出等能力本次不涉及。

## 验证步骤

1. `npx jest __tests__/WeekDayDetail.test.jsx` —— 新用例通过。
2. `npx jest` —— 回归全量测试；既有基线为 90 通过 / 8 个 Learning 既有失败可接受。
3. `npm run build` —— 构建通过（确认无循环引用 / 语法错误）。
4. 手动验证（`npm run dev`，导师账号进入「数据分析」→ 选择学生）：
   - 桌面：点击有记录的日期卡片 → 该周下方展开面板，含备注原文；再点击同日 → 收起；点「收起」/按 Esc → 收起；点击另一周日期 → 面板移动到对应周行下方。
   - 悬停卡片有浅底 + 边框反馈；Tab 键聚焦卡片显示焦点环，Enter/Space 可展开。
   - 切换时段预设/前后翻页/切换学生后面板自动收起。
   - 移动窄屏（或 `isMobile` 生效时）：横条卡片同样可点，面板在周下方展开，无横向滚动、无遮挡。