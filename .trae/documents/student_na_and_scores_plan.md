# 学生端 NA 选项 + 成绩 Tab 实施计划

> 生成时间：2026-08-26 | Plan Mode 文档
> 目标：在**不破坏现有功能**的前提下，完成 (A) 客观评价 NA 选项 和 (B) 成绩 Tab + 老师端成绩概览。

***

## 一、Repo 探索结论

### 1.1 改动 A（NA 选项）相关结构

| 位置             | 文件:行                                                                                             | 内容                                                                                              |
| -------------- | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| 13 档客观评级定义     | [Learning.jsx:40-53](file:///Users/jefflau/projects/一表人才/src/pages/Learning.jsx#L40-L53)         | `OBJECTIVE_STEPS` 数组：F(0)→D-(1)→…→A+(12)，共 13 项，`GlassRail` 滑动组件索引依赖 value 0-12 连续              |
| 百分制区间映射        | [Learning.jsx:56-70](file:///Users/jefflau/projects/一表人才/src/pages/Learning.jsx#L56-L70)         | `GRADE_RANGES` 对象，key 为 letter grade label（不含 NA）                                               |
| view state 定义  | [Learning.jsx:196-197](file:///Users/jefflau/projects/一表人才/src/pages/Learning.jsx#L196-L197)     | `const [view, setView] = useState('record');` 两值 `'record' \| 'pending'`                        |
| 顶部 seg-tabs    | [Learning.jsx:698-714](file:///Users/jefflau/projects/一表人才/src/pages/Learning.jsx#L698-L714)     | 两个 seg-tab 按钮 + 待补填 badge，样式 iOS segmented                                                      |
| 表单客观评价段        | [Learning.jsx:1040-1099](file:///Users/jefflau/projects/一表人才/src/pages/Learning.jsx#L1040-L1099) | GlassRail + deferred segmented (现在填写/稍后补充) + grade legend 4 列网格                                 |
| 待补填弹窗 grade 网格 | [Learning.jsx:1260-1310](file:///Users/jefflau/projects/一表人才/src/pages/Learning.jsx#L1260-L1310) | 13 档 4 列网格按钮，居中 modal(已 createPortal 到 body)                                                    |
| 待补填列表 SQL 过滤   | Learning.jsx 查询 pending                                                                          | `category=3 AND grade_label IS NULL AND score IS NULL` — **关键约束**：NA 存非 null 值后自动从 pending 列表消失 |

### 1.2 改动 B（成绩 Tab + 概览）相关结构

| 位置                  | 文件:行                                                                                                                    | 内容                                                                                                                  |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| 校内课程识别字段            | [Syllabus.jsx:572-573](file:///Users/jefflau/projects/一表人才/src/pages/Syllabus.jsx#L572-L573)                            | `courses.course_type === 1` → 校内课程，`=== 2` → 校外课程；默认 1                                                              |
| Syllabus 查询 select  | [Syllabus.jsx:49-56](file:///Users/jefflau/projects/一表人才/src/pages/Syllabus.jsx#L49-L56)                                | `courses` 表字段：id, name, subject, **source**, **course\_type**, created\_by, chapters\[] + deleted\_at 过滤            |
| Mentor 数据分析渲染       | [Mentor.jsx:1020-1104](file:///Users/jefflau/projects/一表人才/src/pages/Mentor.jsx#L1020-L1104)                            | `activeView === 'analytics'` → WeekReviewDashboard (L1085) 渲染后关闭 `</motion.div>` (L1103)，**L1085–L1091 之间是成绩概览插入点** |
| DeepDivePanels 面板顺序 | [DeepDivePanels.jsx:1333-1349](file:///Users/jefflau/projects/一表人才/src/components/DeepDivePanels.jsx#L1333-L1349)       | 5 个 CollapsiblePanel：学科时间分配→学习趋势识别→自主学习趋势→练习质量分析→**教育诊断结论** (最末 L1346)                                              |
| DeepDivePanels 注入   | [WeekReviewDashboard.jsx:277-283](file:///Users/jefflau/projects/一表人才/src/components/WeekReviewDashboard.jsx#L277-L283) | 传 `key` + `sessions` + `weeks` + `student` → 可扩展 prop 注入 examScores                                                 |

***

## 二、改动 A：客观评价 NA 选项（不破坏现有功能）

### 2.1 设计方案

**核心原则**：**不改动** `OBJECTIVE_STEPS` 数组、**不改动** GlassRail 滑轨 0-12 索引，避免破坏现有保存/回显逻辑。NA 作为**独立的 seg-button** 在旁边提供。

**grade\_label 存值约定**：`'N/A'`（字符串，非 null）。

* 语义：该练习不适用客观评分。

* 行为：因 `grade_label IS NOT NULL`，**自动从待补填列表消失**（符合"这个练习不会有成绩，不需要以后再补"的语义）。

### 2.2 具体改动清单

#### A-1 表单区（Learning.jsx 表单 category=3 段）

在现有 grade legend 4 列网格**下方**（GlassRail + deferred segmented 之下），新增一行：

```
┌───────────────────────────────────────────────────────────┐
│  [GlassRail 滑轨 — 现有 F→A+ 13 档，不动]                  │
│  [现在填写 / 稍后补充 segmented — 现有，不动]              │
│  ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐   grade legend 4列，不动  │
│  │ A+  │ │ A   │ │ A-  │ │ B+  │                           │
│  └─────┘ └─────┘ └─────┘ └─────┘                           │
│  ┌────────────────────────────────────────────┐           │
│  │  标记为不适用 (N/A)   ← 新增独立按钮        │           │
│  └────────────────────────────────────────────┘           │
└───────────────────────────────────────────────────────────┘
```

* NA 按钮视觉：浅灰色描边 `border: 1px solid #e2e8f0`，背景 `#f8fafc`，文字 `color: #64748b` + 斜体 `fontStyle: 'italic'`，与正常分值区分但不过度。

* 选中 NA 时：高亮描边 `#94a3b8` + 背景 `#f1f5f9`。

* **互斥逻辑**：点 NA → GlassRail 禁用 + "稍后补充" 禁用（且切换成"现在填写"状态）；选 GlassRail 或切"稍后补充"→ NA 状态取消。

#### A-2 待补填弹窗 grade 网格（Learning.jsx 代补填 modal 内）

在现有 13 档 4 列网格下方，**单独新增一行**放 NA 按钮（不并入 4 列网格本身，避免 reflow）：

```
┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐
│ A+  │ │ A   │ │ A-  │ │ B+  │   ← 现有 13 档，不动
└─────┘ └─────┘ └─────┘ └─────┘
...
┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐
│ D   │ │ D-  │ │ F   │ │ (空) │
└─────┘ └─────┘ └─────┘ └─────┘
┌───────────────────────────────────────┐
│    标记为不适用 (N/A)       ← 新增 NA 按钮
└───────────────────────────────────────┘
```

* 样式与表单 NA 按钮一致（灰色描边+斜体）。

* 点击 NA → 保存 `grade_label='N/A'` 并关闭 modal → 该条目从待补填列表移除。

#### A-3 保存逻辑（Learning.jsx handleSave / handlePendingFill）

新增 `isObjNA: boolean` state（默认 false）。
保存时分支：

```
objDeferred === true → grade_label = null, score = null, eval_type = 1 (仅主观)
isObjNA    === true → grade_label = 'N/A', score = null, eval_type = 2 (主观+客观)
else (正常评分)    → grade_label = OBJECTIVE_STEPS[objIdx].label, score = value (0-12), eval_type = 2
```

* 关键：`isObjNA` 与 `objDeferred` 互斥，不可同时 true。

* 现有 `OBJECTIVE_STEPS` **完全不动**，GlassRail objIdx 仍 0-12 连续。

#### A-4 记录列表和练习质量分析中的显示

Learning.jsx 记录列表、PracticeQualityPanel 中显示客观评价标签时：

```js
grade_label === 'N/A' → 显示 <span style={{color:'#94a3b8', fontStyle:'italic'}}>客观：N/A</span>
grade_label == null   → 显示 "客观：待补充"（现有逻辑不动）
其他                  → 显示现有 letter grade（不动）
```

#### A-5 回显逻辑（编辑/待补填弹窗打开时）

打开已有记录：

* 若 `grade_label === 'N/A'` → `setIsObjNA(true)`，GlassRail 置灰禁用，deferred=false。

* 其他情况 → 现有回显逻辑不动（objIdx 映射、pending/grade\_label==null 走待补充）。

### 2.3 风险控制

| 风险                                    | 应对                                                          |
| ------------------------------------- | ----------------------------------------------------------- |
| OBJECTIVE\_STEPS 被改动导致 GlassRail 索引错位 | **不改动** OBJECTIVE\_STEPS，NA 作为独立按钮实现                        |
| NA 存值后仍进入待补填                          | 存非 null 的 `'N/A'`，现有 `grade_label IS NULL` 过滤会自动排除          |
| NA 与 deferred 互斥逻辑未处理                 | save 前加校验断言，UI 上点其一禁用另一                                     |
| score\_to\_grade 或其他函数遇到 'N/A' 崩溃     | 所有 score/grade\_label 读取处加 nullish 保护，遇到非 letter 值回退显示字符串原值 |

***

## 三、改动 B：成绩 Tab + 老师端成绩概览

### 3.1 数据库层（先执行 SQL 补丁）

**新文件**：`supabase/schema.patch-exam-scores.sql`（幂等脚本，生产需在 Supabase SQL Editor 先执行）

```sql
-- ── 考试成绩表 ─────────────────────────────────────
create table if not exists public.exam_scores (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references auth.users(id) on delete cascade,
  course_id uuid not null references public.courses(id) on delete cascade,
  exam_name varchar(64) not null,          -- 如：月考、期末、期中考试、单元测
  exam_date date not null,
  score numeric(5,2),                      -- 百分制分数，可空（可能只有等第）
  grade_label varchar(8),                  -- 等第，如 A+、90、优；可空
  notes text,                              -- 备注，可空
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  deleted_at timestamptz
);

-- 索引
create index if not exists idx_exam_scores_student_course on public.exam_scores(student_id, course_id) where deleted_at is null;
create index if not exists idx_exam_scores_course on public.exam_scores(course_id) where deleted_at is null;
create index if not exists idx_exam_scores_student_date on public.exam_scores(student_id, exam_date desc) where deleted_at is null;

-- RLS
alter table public.exam_scores enable row level security;

drop policy if exists "exam_scores_select_own_or_mentor" on public.exam_scores;
create policy "exam_scores_select_own_or_mentor" on public.exam_scores for select
using (
  student_id = auth.uid()
  or is_connected_teacher_of(student_id)
);

drop policy if exists "exam_scores_insert_own" on public.exam_scores;
create policy "exam_scores_insert_own" on public.exam_scores for insert
with check (
  student_id = auth.uid()
);

drop policy if exists "exam_scores_update_own" on public.exam_scores;
create policy "exam_scores_update_own" on public.exam_scores for update
using ( student_id = auth.uid() )
with check ( student_id = auth.uid() );

drop policy if exists "exam_scores_delete_own" on public.exam_scores;
create policy "exam_scores_delete_own" on public.exam_scores for delete
using ( student_id = auth.uid() );

-- 触发器 updated_at
drop trigger if exists set_timestamp_exam_scores on public.exam_scores;
create trigger set_timestamp_exam_scores
before update on public.exam_scores
for each row execute function trigger_set_timestamp();
```

### 3.2 学生端成绩 Tab（Learning.jsx）

#### B-1 view 状态扩展 + tab 按钮

* `view` 扩展：`'record' | 'pending' | 'scores'`（默认 `'record'` 不变）

* seg-tabs 新增第三个按钮「成绩」，badge 显示已有成绩总数（可选）

* 三个 tab 宽度均分：`flex: 1` 各占 1/3

#### B-2 数据加载（useEffect，user.id 变化时 / view==='scores' 时）

**并行拉两个查询**：

1. 校内课程列表（自动拉入，学生无需手动创建）

```sql
select id, name, subject from courses
where created_by = auth.uid()
  and course_type = 1       -- 关键：仅校内课程
  and deleted_at is null
order by created_at desc
```

1. 该学生的所有考试成绩（未软删除）

```sql
select * from exam_scores
where student_id = auth.uid()
  and deleted_at is null
order by exam_date desc
```

* 用 `Promise.all` 并行

* cancelled flag 防竞态

#### B-3 UI 结构（view==='scores' 分支）

**容器**：gap:12 的 flex-col，适配移动端 + 桌面端。

**每张课程卡片**：

```
┌──────────────────────────────────────────────────┐
│  英语                              已记录 3 次   │  ← 头部：课程名 + 记录数 badge
├──────────────────────────────────────────────────┤
│  [1] 期末考试    2026-06-20   92分 (A-)  编辑 删│  ← 按日期倒序
│  [2] 月考        2026-05-15   88分 (B+)  编辑 删│
│  [3] 单元测      2026-04-28   N/A        编辑 删│
│                                                  │
│  [+ 新增成绩]                                    │  ← 按钮，点了弹小 modal
└──────────────────────────────────────────────────┘
```

* 无校内课程 → 显示 empty state："请先在 Syllabus 创建校内课程"（带跳转提示）

* 有课程但无成绩 → 卡片内 empty："还没有记录成绩" + 大号 \[+ 新增成绩]

#### B-4 新增/编辑成绩 Modal（createPortal 到 document.body）

**居中简洁表单**（移动端单列 + 桌面端适配）：

| 字段    | 控件                                             | 规则                           |
| ----- | ---------------------------------------------- | ---------------------------- |
| 考试名称  | `<input>`                                      | placeholder "如：期末考试、月考"，必填   |
| 考试日期  | `<input type="date">`                          | 默认今天，必填                      |
| 分数    | `<input type="number" min=0 max=100 step=0.1>` | 百分制，可选（空则 grade\_label 必填其一） |
| 等第/评级 | `<input>`                                      | placeholder "如 A+、优、合格"，可选   |
| 备注    | `<textarea>`                                   | 可选，最多 200 字                  |

* 保存：至少填「分数」或「等第」其中之一（否则提示"请填写分数或评级"）

* 模式：createPortal 到 body + backdrop 居中 + framer-motion scale 动画（复用代补填弹窗模式）

#### B-5 CRUD 逻辑 + RLS 保护

所有操作加 RLS 错误友好提示 + console.error：

```js
catch (e) {
  console.error('exam_scores op failed:', e);
  toast(friendlyError(e, '保存失败'), { kind: 'error' });
}
```

删除 = 软删除（`UPDATE SET deleted_at = now()`）

### 3.3 老师端成绩概览（数据分析最底部）

**插入位置决策**：放在 **Mentor.jsx** L1085 `WeekReviewDashboard` 之后（L1085–L1091 之间，`</motion.div>` 前）。

* 理由：用户说"数据分析最下面"，WeekReviewDashboard=概览+深度分析面板，之后放**独立**的"成绩概览"卡片最自然，不需要塞进深度分析内部面板的 CollapsiblePanel 结构里。

#### B-6 Mentor.jsx 加成绩数据加载

* 新增 state：`studentScores`、`studentScoresLoading`

* picked.id 变化时（现有 useEffect L357-394 附近），并行增加：

```sql
select es.*, c.name as course_name from exam_scores es
join courses c on c.id = es.course_id
where es.student_id = picked.id
  and es.deleted_at is null
order by c.name, es.exam_date desc
```

#### B-7 成绩概览 UI（Mentor.jsx 内独立 section）

标题样式与上方"深度分析"一致：左侧小紫色 bar + 粗体标题「校内课程成绩概览」。

内部布局：`gridTemplateColumns: repeat(auto-fill, minmax(260px, 1fr))` 网格，每门校内课程一张卡片：

```
┌────────────────────────────────────────┐
│  英语                          3 条记录 │
├────────────────────────────────────────┤
│  [最新 3 条，按日期倒序]                │
│  · 期末考试   2026-06-20   92 分 (A-)  │
│  · 月考       2026-05-15   88 分 (B+)  │
│  · 单元测     2026-04-28   N/A          │
└────────────────────────────────────────┘
```

* 无成绩数据 → 卡片内显示 "暂无成绩记录"（#94a3b8 灰色字）

* 未选中学生 → 不显示此 section（与现有 empty state 一致）

* 配色：#0f172a / #94a3b8 中性黑灰，**不使用红黄绿评价色**（项目硬约束）

***

## 四、文件清单与改动范围

| # | 文件                                       | 改动类型    | 说明                                                       |
| - | ---------------------------------------- | ------- | -------------------------------------------------------- |
| 1 | `supabase/schema.patch-exam-scores.sql`  | **新文件** | 考试成绩表 + RLS + 索引 + 触发器，幂等                                |
| 2 | `src/pages/Learning.jsx`                 | 修改      | A-1\~A-5（NA 选项）+ B-1\~B-5（成绩 tab）                        |
| 3 | `src/pages/Mentor.jsx`                   | 修改      | B-6\~B-7（成绩概览加载 + 渲染）                                    |
| 4 | `src/components/WeekReviewDashboard.jsx` | 修改可选    | 如果把成绩概览移入 DeepDivePanels 内部用这个；本方案选 Mentor.jsx，**此文件不动** |
| 5 | `src/components/DeepDivePanels.jsx`      | 修改可选    | 同上，**本方案不动**                                             |

**文件总数**：4 个（1 新 3 改，其中 2 个可选不动）

***

## 五、假设与依赖

### 5.1 显式假设

1. **NA 存值字符串**：`'N/A'`（斜杠分隔，标准写法）。如果用户偏好 `'NA'` 或中文 `'不适用'`，只需改一个常量，逻辑无变化。
2. **校内课程识别**：`courses.course_type === 1`（Syllabus.jsx L572 代码确认）。
3. **待补填语义**：`grade_label === 'N/A'` 视为"已处理"，自动从代补填列表移除（符合"不适用 → 不需要以后补"直觉）。
4. **成绩 exam\_scores 百分制或等第二选一**：至少填一项，不强求格式一致性（用户明确说"不规定考试类别"）。
5. **成绩概览插入点**：Mentor.jsx 内 WeekReviewDashboard 之后独立 section（不是 DeepDivePanels 内部第 6 个 CollapsiblePanel）——如果用户更希望它是可折叠面板，需要切换方案。

### 5.2 依赖

* 依赖已有的 `is_connected_teacher_of(student_id)` SQL 函数（项目已有，用于 teacher-student 连接鉴权）

* 依赖已有的 `trigger_set_timestamp()` 触发器函数（项目已有）

* 前端依赖：**无新 npm 包**。全部用现有 framer-motion、supabase-js、createPortal 实现

***

## 六、验证清单（上线前必做）

### A 改动验证（NA 选项）

| #  | 验证点                                     | 预期                        |
| -- | --------------------------------------- | ------------------------- |
| A1 | 正常选 A+→F 13 档保存 + 回显                    | 与改动前完全一致，无异常              |
| A2 | "稍后补充"保存 → 待补填列表出现                      | 与改动前完全一致，无异常              |
| A3 | 点 NA → 保存 → 列表显示"客观：N/A"（灰色斜体）          | grade\_label='N/A'，不进入待补填 |
| A4 | 已选 NA 时切"稍后补充" → NA 自动取消                | 互斥生效                      |
| A5 | 待补填弹窗里点 NA → 条目从待补填消失                   | 与表单 NA 语义一致               |
| A6 | 编辑一条 grade\_label='N/A' 的记录 → 打开时 NA 选中 | 回显正确                      |
| A7 | 练习质量分析遇到 N/A 条目 → 不崩溃                   | 正常显示"N/A"标签               |

### B 改动验证（成绩 Tab + 概览）

| #   | 验证点                                           | 预期                          |
| --- | --------------------------------------------- | --------------------------- |
| B1  | SQL 补丁在 Supabase SQL Editor 执行成功（无报错）         | exam\_scores 表创建，RLS 生效     |
| B2  | 学生端 3 个 tab 均可切换（记录/待补填/成绩）                   | seg-tabs 三等分不折行，移动端适配       |
| B3  | Syllabus 里创建 course\_type=1 的课程 → 自动出现在成绩 tab | course\_type=2 的校外课程**不出现** |
| B4  | 点「+ 新增成绩」→ 填 exam\_name + date + score → 保存成功 | 列表即时刷新，日期倒序                 |
| B5  | 只填 grade\_label 不填 score → 也能保存（二选一）          | 提示正确                        |
| B6  | 删除成绩 → 软删除（deleted\_at 写入，列表消失）               | RLS 允许自己删除                  |
| B7  | 学生 A 的成绩 → 学生 B 登录后看不到                        | RLS select 策略生效             |
| B8  | 导师端选学生 → 数据分析最底部显示「校内课程成绩概览」                  | 每门课卡片，最新 3 条记录，颜色中性黑灰       |
| B9  | 学生无校内课程 → 成绩 tab 显示 empty state               | 不崩溃                         |
| B10 | 学生有校内课程但无成绩 → 概览卡片显示"暂无成绩记录"                  | 不崩溃                         |
| B11 | 构建 `npx vite build` 通过                        | 无 TS/语法错误                   |

### 回归验证（关键，防止"搞出 bug"）

| #  | 验证点                                             |
| -- | ----------------------------------------------- |
| R1 | 学习记录新增/编辑/删除（学习/复习/练习三种）全流程正常                   |
| R2 | 待补填列表筛选（grade\_label IS NULL）正常，原 13 档选择保存/回显正常 |
| R3 | 导师端数据分析（含 5 个深度分析面板）正常展示，不被成绩概览破坏布局             |
| R4 | 课表 tab（刚上线的功能）正常展示                              |
| R5 | 移动端（≤640px）seg-tabs 三段不折行，成绩 tab 不溢出            |

***

## 七、执行顺序（降低风险）

1. **先写 SQL 补丁** → schema.patch-exam-scores.sql，本地/生产先跑通（不影响现有任何功能）
2. **再改 Learning.jsx 改动 A（NA）** → 单独自测 A1–A7，确认原功能无回归
3. **再改 Learning.jsx 改动 B（成绩 Tab）** → 自测 B1–B7、B9、B11
4. **最后改 Mentor.jsx（成绩概览）** → 自测 B8、B10、R3
5. **跑** **`npx vite build`** → 必须通过
6. **手动回归 R1–R5**

> 以上顺序确保每一步都可单独回滚，出问题立即定位在哪一步引入。

