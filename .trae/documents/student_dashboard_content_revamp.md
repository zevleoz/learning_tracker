# 学生端 Review 页内容调整

## 测试账号

* **学生**: `test_student@example.com` / `testpass123`

* **导师**: `mentor@example.com` / `mentor123`

***

## 概述

学生端 StudentDashboard 内容调整：移除成绩趋势和数据洞察，新增每日学习时长趋势图和学科×学习类型×自主占比，保留连续天数和最近记录。

***

## 当前状态

StudentDashboard.jsx 当前 6 个区块：

1. 时间筛选栏 — 预设按钮 + 日历 ✅ 保留
2. Hero 总览 — 总时长/日均/活跃天 + 工作日/周末日均 — **简化**
3. 学科分布 — 仅总时长+占比 — **替换为学科×类型×自主**
4. 学习节奏 — 工作日vs周末 + 连续天数 — **拆分**
5. 成绩趋势 — recharts 折线图 — **删除**
6. 最近记录 — 时间线列表 ✅ 保留
7. 数据洞察 — 规则驱动观察 — **删除**

***

## 改动计划

### 删除

* **成绩趋势** (L360-386) — 学生已知自己分数，趋势图对自查无增量价值

* **数据洞察** (L435-437 + L514-577) — "建议"语气偏说教，学生自查不需要被"指导"

* **学习节奏** (L327-358) — 拆分：连续天数移入 Hero，工作日/周末移入学科卡片

### 新增/替换

#### 1. Hero 总览（简化增强）

保留结构，增加连续天数：

```
┌──────────────────────────────────┐
│  学习总览 · 8/18 - 8/24          │
│                                  │
│        12h 30m                   │
│  日均 1h47m · 活跃 6天 · 跨度7天  │
│                                  │
│  ┌──────┐ ┌──────┐ ┌──────┐     │
│  │  45  │ │ 1h47 │ │ 🔥7  │     │
│  │ 记录  │ │ 日均  │ │ 连续  │     │
│  └──────┘ └──────┘ └──────┘     │
└──────────────────────────────────┘
```

* MiniStat 从 3 个改为 3 个：学习记录 / 日均时长 / 连续天数

* 移除工作日日均和周末日均（移入学科卡片）

* 连续天数 ≥7 绿色，≥3 橙色，0 灰色

#### 2. 每日学习时长趋势（新增，替换成绩趋势位置）

recharts BarChart，展示区间内每天的学习总时长：

* X 轴：日期（M/D 格式）

* Y 轴：分钟（隐藏轴标签，仅 Tooltip 显示）

* 柱体颜色：#4F46E5 品牌紫

* 柱体圆角：radius=\[3,3,0,0]

* Tooltip：显示日期 + 时长（fmtMins 格式）

* **聚合策略**：

  * 区间 ≤ 60 天：按日展示

  * 区间 > 60 天：按周聚合（用 getWeeksInRange）

* 空日子（0 分钟）也展示空柱，让节奏可见

* 高度 160px

#### 3. 学科 × 学习类型 × 自主占比（替换学科分布）

每个学科一行，展示该学科在当前区间内的：

```
┌──────────────────────────────────┐
│  学科分析                         │
│                                  │
│  ● 数学    2h30m    自主 67%     │
│    ████████░░░░░░                │
│    学 1h00m · 复 45m · 练 45m    │
│                                  │
│  ● 英语    1h15m    自主 40%     │
│    ██████░░░░░░░░                │
│    学 45m · 复 30m · 练 0m       │
└──────────────────────────────────┘
```

**每行结构**：

* 学科颜色圆点 + 学科名 + 总时长 + 自主占比标签

* 堆叠条形图：学(#2563EB) / 复(#7C3AED) / 练(#0D9488) 三段，按 CATEGORY\_COLORS 着色

* 下方一行小字：学 Xh · 复 Xh · 练 Xh

**自主占比**：

* `isSelfForm(s.form)` 判断是否自主

* 占比 = 自主时长 / 学科总时长 × 100%

* 标签颜色：≥60% 用 SELF\_COLOR(#2563EB)，30-59% 用 #64748b，<30% 用 #94a3b8

**数据计算**（新增 computeStats 内逻辑）：

```js
// 学科 × 类型 × 自主
const bySubjectType = {};
for (const s of sessions) {
  const name = (s.subject || '未分类').trim();
  if (!bySubjectType[name]) {
    bySubjectType[name] = { name, total: 0, byCat: {1:0,2:0,3:0}, selfTotal: 0 };
  }
  const cat = Number(s.category) || 1;
  const mins = s.duration_minutes || 0;
  bySubjectType[name].total += mins;
  bySubjectType[name].byCat[cat] += mins;
  if (isSelfForm(s.form)) bySubjectType[name].selfTotal += mins;
}
const subjectAnalysis = Object.values(bySubjectType)
  .map(x => ({
    ...x,
    pct: total > 0 ? Math.round(x.total / total * 100) : 0,
    selfPct: x.total > 0 ? Math.round(x.selfTotal / x.total * 100) : 0,
  }))
  .sort((a, b) => b.total - a.total);
```

#### 4. 每日趋势数据（新增 computeStats 内逻辑）

```js
// 每日总时长
const dailyData = uniqueDates.map(d => ({
  date: shortDate(d),
  fullDate: d,
  minutes: byDate[d],
}));
// 填充空日子（区间内每天一条）
// 如果区间 ≤ 60 天，补全所有日期
```

### 保留不变

* 时间筛选栏（预设 + 日历）

* 最近记录列表（10 条，带学科颜色点 + 类别标签 + 时长）

***

## 最终区块顺序

1. 时间筛选栏
2. Hero 总览（总时长 + 日均 + 活跃天 + 连续天数）
3. 每日学习时长趋势（Line plot）
4. 学科 × 学习类型 × 自主占比（堆叠条形图 + 自主标签）
5. 最近记录

***

## 文件变更

| 文件                                    | 操作                                     |
| ------------------------------------- | -------------------------------------- |
| `src/components/StudentDashboard.jsx` | 修改：删除成绩趋势/数据洞察/学习节奏，新增每日趋势图和学科×类型×自主分析 |

**不改动**：

* Review\.jsx（已使用 StudentDashboard，接口不变）

* DateRangeCalendar.jsx

* WeekReviewDashboard.jsx

* Mentor.jsx

***

## 新增 import

```js
// 已有 → 改为
import { fmtMins, scoreColor, CATEGORY_NAMES, CATEGORY_COLORS, isSelfForm, SELF_COLOR } from './WeekGrid.jsx';
// 新增 recharts BarChart
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
// 移除 LineChart, Line（不再需要）
```

***

## 验证步骤

1. 登录 <test_student@example.com> / testpass123
2. 进入「回顾」页
3. 确认：

   * Hero 显示连续天数（非工作日/周末日均）

   * 每日学习时长趋势图正常渲染（柱状图）

   * 学科分析显示学/复/练堆叠条 + 自主占比

   * 无成绩趋势图

   * 无数据洞察区块

   * 最近记录正常
4. 切换时间范围（本周/本月/近3月/全年/自定义）确认所有区块响应
5. `npm run build` 无错误

