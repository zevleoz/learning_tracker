# 导师数据分析页 — 第三轮优化

## Summary
两处改动：
1. "学习行为洞察" → "学习趋势识别" + 文本增强（consulting one-liner，同行大小字体交替）
2. 练习质量分析大改：每学科独立卡片 + 客观/主观计数 + 最近 5 次客观评价对应主观 + 可点击展开详情 modal

---

## Current State Analysis

### 1. LearningPatternInsightPanel（需改名 + 文本增强）
- [DeepDivePanels.jsx#L1064-L1181](file:///Users/jefflau/projects/一表人才/src/components/DeepDivePanels.jsx#L1064-L1181)
- 主入口标题："学习行为洞察"（[L1202](file:///Users/jefflau/projects/一表人才/src/components/DeepDivePanels.jsx#L1202)）
- 当前输出：大字体 typeLabel + 小字体 description（两行分离）
- 问题：文本太少，不够 consulting one-liner 风格

### 2. PracticeQualityPanel（需大改）
- [DeepDivePanels.jsx#L437-L577](file:///Users/jefflau/projects/一表人才/src/components/DeepDivePanels.jsx#L437-L577)
- 当前：客观评分行（name + avg + bar）+ 反馈密度风险行（红/黄/绿评价）
- 问题：不是 per-subject card 布局；有主观评价（红黄绿 risk 判断）违反用户"不要做评价"原则

### 3. 评估数据模型
- `eval_type`: 1=主观, 2=客观 ([schema.sql#L177](file:///Users/jefflau/projects/一表人才/supabase/schema.sql#L177))
- `self_rating`: 主观评分，值 20/40/60/80/100（[Learning.jsx#L28-L33](file:///Users/jefflau/projects/一表人才/src/pages/Learning.jsx#L28-L33)）
  - 20=没有听课, 40=像在听天书, 60=有不少没掌握, 80=基本掌握, 100=完全掌握
- `grade_label`: 客观 letter grade，如 B+/A-/C 等（[Learning.jsx#L36-L50](file:///Users/jefflau/projects/一表人才/src/pages/Learning.jsx#L36-L50)）
- `score`: 客观数值 0-100（schema 有，但学生表单只发 grade_label 不发 score）
- 当前表单逻辑（[Learning.jsx#L376-L379](file:///Users/jefflau/projects/一表人才/src/pages/Learning.jsx#L376-L379)）：evalType=1 只发 self_rating；evalType=2 只发 grade_label（二选一）
- 用户规划：以后主观必填、客观可选共存 → 每条 session 可能同时有 self_rating + grade_label

### 4. Mentor session 查询
- [Mentor.jsx#L294-L295](file:///Users/jefflau/projects/一表人才/src/pages/Mentor.jsx#L294-L295): 查询字段含 score, self_rating, grade_label，但**不含 notes**
- 详情 modal 需展示 notes → 需在查询中加 `notes`

---

## Proposed Changes

### Change 1: LearningPatternInsightPanel 改名 + 文本增强

**文件**: `src/components/DeepDivePanels.jsx`

#### 1a. 主入口标题改名
```jsx
// L1202
<CollapsiblePanel title="学习趋势识别" icon="◎">
```

#### 1b. 输出格式改为 consulting one-liner（同行大小字体交替）

将当前「大字 typeLabel + 小字 description 两行」改为单段文本，关键词用大字体/粗体，连接词用小字体：

```jsx
return (
  <div style={{ padding: '4px 2px', lineHeight: 1.8 }}>
    <span style={{ fontSize: 11, color: '#64748b' }}>该生属于</span>{' '}
    <span style={{ fontSize: 16, fontWeight: 800, color: '#0f172a' }}>{typeLabel}</span>
    <span style={{ fontSize: 11, color: '#64748b' }}>，高频时段</span>{' '}
    <span style={{ fontSize: 14, fontWeight: 700, color: '#0f172a' }}>{peakRange}</span>
    <span style={{ fontSize: 11, color: '#64748b' }}>；{orderClause}</span>
  </div>
);
```

示例输出（同行渲染）：
> 该生属于 **常规学习者**，高频时段 **19:00-20:00**；通常先做 **数学**，再做 **英语**。

其中 `数学`/`英语` 也用稍大粗体突出。无顺序规律时：`；作业顺序样本不足，暂无规律。`

需要在 `insight` 返回值中拆分为 `typeLabel`、`peakRange`、`orderClause` 三个片段，而非拼接的 `description` 字符串。

---

### Change 2: PracticeQualityPanel 大改

**文件**: `src/components/DeepDivePanels.jsx` + `src/pages/Mentor.jsx`

#### 2a. Mentor.jsx 查询加 notes
```jsx
// L294
id, session_date, start_time, duration_minutes, category, form, eval_type,
score, self_rating, grade_label, notes, course_id, course:course_id(name, subject)
```

#### 2b. 新增 SELF_RATING_LABELS 常量
在 DeepDivePanels.jsx 顶部新增：
```js
const SELF_RATING_LABELS = {
  20: '没有听课', 40: '像在听天书', 60: '有不少没掌握',
  80: '基本掌握', 100: '完全掌握',
};
```

#### 2c. 重写 PracticeQualityPanel

**数据计算**（useMemo）：
1. 过滤 category=3 的 sessions
2. 按 subject 分组
3. 每个 subject 统计：
   - `objCount`: 有客观评价的 session 数（grade_label 非空 或 score 非空）
   - `subjCount`: 有主观评价的 session 数（self_rating 非空）
   - `last5Obj`: 最近 5 次有客观评价的 session（按 date desc），每条含 `{ date, gradeLabel, score, selfRating }`
   - `allSessions`: 该 subject 的全部 practice sessions（用于 modal）

**卡片布局**：
```
┌───────────────────────────────────┐
│ 数学                          ›   │  ← 学科名 + 点击箭头
│                                   │
│ 客观 8 次    主观 12 次            │  ← 两项计数
│                                   │
│ B+  85    自评: 基本掌握          │  ← 最近5次客观评价
│ A-  90    自评: 完全掌握          │     每行: grade_label + score(如有) + 对应 self_rating
│ B   83    自评: —                 │     无对应主观时显示 —
│ C+  77    自评: 有不少没掌握      │
│ B+  87    自评: 基本掌握          │
└───────────────────────────────────┘
```

- 卡片可点击（`onClick` → 打开 modal）
- 客观评价行：`grade_label`（letter）+ `score`（数值，如有）+ `自评: {SELF_RATING_LABELS[self_rating] || '—'}`
- 学科色用 `useSubjectColors` 分配（复用已有分类色逻辑）

**卡片网格**：
```jsx
<div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 8 }}>
  {subjectCards.map(card => <SubjectCard ... />)}
</div>
```

#### 2d. 详情 Modal

点击卡片打开 framer-motion 动画 modal（AnimatePresence + overlay）：
- 半透明背景遮罩
- 居中/底部弹出的白色面板
- 标题：学科名 + 总练习次数
- 内容：该 subject 全部 practice sessions 列表，按日期倒序
- 每条记录显示：
  - 日期
  - form（学习行为类型，如"学校作业"、"校外线上"）
  - 时长（duration_minutes）
  - 评估信息：客观（grade_label + score 如有） / 主观（self_rating label）
  - notes（如有）

Modal 使用组件内 useState 管理开关状态，不需要路由改动（与 Mentor 单页内面板切换模式一致）。

---

## Assumptions & Decisions

1. **客观评价检测**：检查 `grade_label != null` 或 `score != null`（学生表单只发 grade_label，测试数据有 score，两者都查）

2. **主观评价检测**：检查 `self_rating != null`

3. **"对应"逻辑**：同一 session 的 self_rating 作为对应的主观评价。当前数据 eval_type=1/2 二选一所以无对应，显示 `—`。未来数据可同时存在。

4. **Modal 而非新路由**：与 Mentor 单页模式一致，用组件内 state + framer-motion 动画

5. **旧 PracticeQualityPanel 代码保留**：函数定义不删除，仅替换主入口引用（如果用户要回退）

6. **主观标签映射**：本地定义 SELF_RATING_LABELS，不导入 Learning.jsx（避免跨页面依赖）

7. **LearningPatternInsightPanel 文本**：返回结构化片段（typeLabel, peakRange, orderClause）而非拼接字符串，用 inline span 控制字体大小

---

## Verification Steps

1. `npx vite build` 编译通过
2. 导师端打开学生数据分析页 → 练习质量分析面板：
   - 每学科独立卡片，显示客观/主观计数
   - 最近 5 次客观评价显示 letter grade + 对应主观评价
   - 点击卡片弹出 modal，显示该学科全部练习记录
3. "学习趋势识别"面板文本为 consulting one-liner 风格，同行大小字体交替
4. 空数据场景不报错
5. 测试数据（有 score + grade_label）和真实学生数据（只有 grade_label）均正常显示
