# 学生端学习行为记录 — 评价流程重构

## 摘要

将学生端 `Learning.jsx` 的评价录入从"主观/客观二选一"改为"主观必填 + 客观可选（仅练习类，可滞后填写）"。同时修复表单 category 标签与数据库/分析面板的映射不一致问题（前置必要修复）。

---

## 当前状态分析

### 评价录入流程（[Learning.jsx:171-178, 363-379, 505-520, 810-881](file:///Users/jefflau/projects/一表人才/src/pages/Learning.jsx)）
- `evalType` state（1=主观 / 2=客观），二选一 toggle
- 提交时根据 `evalType` 写入 `self_rating` **或** `grade_label`，互斥
- 编辑时回显 `eval_type` 并据此切换显示哪个值
- UI：`eval-tabs` 两个按钮 + 单个 `GlassRail` 滑轨

### Category 映射不一致（前置 bug）
- **表单**（[Learning.jsx:11-15, 20-24](file:///Users/jefflau/projects/一表人才/src/pages/Learning.jsx#L11)）：1=复习, 2=练习, 3=学习
- **数据库 / 分析面板**（[schema.sql:175](file:///Users/jefflau/projects/一表人才/supabase/schema.sql#L175), [WeekGrid.jsx:12](file:///Users/jefflau/projects/一表人才/src/components/WeekGrid.jsx#L12), seed 数据, [DeepDivePanels.jsx:449](file:///Users/jefflau/projects/一表人才/src/components/DeepDivePanels.jsx#L449)）：1=学习, 2=复习, 3=练习
- 后果：学生选"练习"存为 category=2，但练习质量分析面板筛 `category===3`，这些记录不会出现 → 新功能端到端断裂

### 数据库 schema（[schema.sql:167-198](file:///Users/jefflau/projects/一表人才/supabase/schema.sql#L167)）
- `eval_type smallint not null default 1`（1=主观 2=客观）
- `self_rating` 和 `grade_label` 都是可空字段（无 NOT NULL 约束）
- `score` 字段独立存在，可存百分制

### 分析面板读取方式（[DeepDivePanels.jsx:454-455](file:///Users/jefflau/projects/一表人才/src/components/DeepDivePanels.jsx#L454)）
```js
const hasObj = (s.grade_label != null && s.grade_label !== '') || (s.score != null && s.score !== '');
const hasSubj = s.self_rating != null;
```
分析面板已按字段存在性判断，**不依赖 eval_type** → 后端无需改动。

---

## 改动方案

### 改动 1：修复 Category 映射（前置必要修复）

**文件**：[Learning.jsx](file:///Users/jefflau/projects/一表人才/src/pages/Learning.jsx)

将 `CATEGORY_OPTS` 和 `FORM_PRESET_BY_CATEGORY` 的 key 重排为数据库约定：

```jsx
// 旧
const CATEGORY_OPTS = [
  { key: 1, label: '复习' },
  { key: 2, label: '练习' },
  { key: 3, label: '学习' },
];
const FORM_PRESET_BY_CATEGORY = {
  3: ['自主预习', '校外线上', '校外线下'],       // 学习
  1: ['自主复习', '校外线上', '校外线下'],       // 复习
  2: ['自主练习', '校外线上', '校外线下', '课外作业', '学校作业'], // 练习
};

// 新
const CATEGORY_OPTS = [
  { key: 1, label: '学习' },
  { key: 2, label: '复习' },
  { key: 3, label: '练习' },
];
const FORM_PRESET_BY_CATEGORY = {
  1: ['自主预习', '校外线上', '校外线下'],                                 // 学习
  2: ['自主复习', '校外线上', '校外线下'],                                 // 复习
  3: ['自主练习', '校外线上', '校外线下', '课外作业', '学校作业'],          // 练习
};
```

同步更新默认值：
- [L172](file:///Users/jefflau/projects/一表人才/src/pages/Learning.jsx#L172) `useState(3)` → `useState(1)`（默认"学习"）
- [L435](file:///Users/jefflau/projects/一表人才/src/pages/Learning.jsx#L435) `setCategory(r.category || 3)` → `setCategory(r.category || 1)`
- [L455](file:///Users/jefflau/projects/一表人才/src/pages/Learning.jsx#L455) `setCategory(3)` → `setCategory(1)`

> **数据迁移提示**：如果生产环境已有学生通过表单创建的记录，旧记录的 category 值会与新标签不匹配。本次不处理数据迁移（开发期 seed 数据用的是数据库约定，已正确）。如有生产数据需迁移，单独处理。

---

### 改动 2：移除 eval-type toggle，主观必填

**文件**：[Learning.jsx](file:///Users/jefflau/projects/一表人才/src/pages/Learning.jsx)

#### State 变更（[L174-177](file:///Users/jefflau/projects/一表人才/src/pages/Learning.jsx#L174)）
```jsx
// 旧
const [evalType, setEvalType] = useState(1);
const [subjIdx, setSubjIdx] = useState(3);
const [objIdx, setObjIdx] = useState(9);

// 新
// 移除 evalType
const [subjIdx, setSubjIdx] = useState(3);     // 主观必填，默认"基本掌握"
const [objIdx, setObjIdx] = useState(null);     // 客观可选，null=暂不填写
const [objDeferred, setObjDeferred] = useState(true); // 默认暂不填写（可滞后）
```

#### UI 变更（[L810-881](file:///Users/jefflau/projects/一表人才/src/pages/Learning.jsx#L810)）
移除 `eval-tabs` toggle，改为：

```jsx
{/* ---- 5) 主观评估（必填）---- */}
<div className="rec-block">
  <div className="rec-label">主观评估 <span style={{color:'#94a3b8',fontSize:11,fontWeight:400}}>* 必填</span></div>
  <GlassRail steps={SUBJECTIVE_STEPS} idx={subjIdx} onChange={setSubjIdx} disabled={busy} />
</div>

{/* ---- 5b) 客观评估（仅练习类，可选/可滞后）---- */}
{category === 3 && (
  <div className="rec-block">
    <div className="rec-label">
      客观评估
      <span style={{color:'#94a3b8',fontSize:11,fontWeight:400}}>（可选，可滞后填写）</span>
    </div>
    {/* 暂不填写 toggle */}
    <label style={{display:'flex',alignItems:'center',gap:6,marginBottom:8,fontSize:12,color:'#475569',cursor:'pointer'}}>
      <input type="checkbox" checked={objDeferred} onChange={e => {
        setObjDeferred(e.target.checked);
        if (!e.target.checked && objIdx === null) setObjIdx(9); // 首次展开给默认 B+
      }} disabled={busy} />
      暂不填写，稍后补充
    </label>
    {!objDeferred && (
      <>
        <GlassRail steps={OBJECTIVE_STEPS} idx={objIdx} onChange={setObjIdx} disabled={busy} />
        {/* grade legend 保留 */}
      </>
    )}
  </div>
)}
```

#### 备注占位符（[L889-891](file:///Users/jefflau/projects/一表人才/src/pages/Learning.jsx#L889)）
旧代码按 `evalType` 切换占位符。新逻辑改为按 `category===3 && !objDeferred` 切换：
```jsx
placeholder={category === 3 && !objDeferred
  ? "这次分数的解释：比如这次考试的哪一部分丢分最多？..."
  : "关于这次学习，你想记录的补充说明：..."}
```

---

### 改动 3：提交逻辑（新建 + 编辑）

**文件**：[Learning.jsx](file:///Users/jefflau/projects/一表人才/src/pages/Learning.jsx)

#### 新建 payload（[L363-379](file:///Users/jefflau/projects/一表人才/src/pages/Learning.jsx#L363)）
```jsx
const payload = {
  student_id: user.id,
  course_id: courseId,
  chapter_id: chapterId || null,
  unit_id: unitId || null,
  category,
  form: formValue,
  eval_type: !objDeferred && objIdx !== null ? 2 : 1,  // 标记：有客观=2，否则=1
  duration_minutes: duration,
  notes: notes.trim() || null,
  session_date: dateStr,
  start_time: newStartTime,
  end_time: newEndTime,
  self_rating: SUBJECTIVE_STEPS[subjIdx].value,  // 始终写入
  // 客观：仅在练习类且未暂缓时写入
  ...(!objDeferred && objIdx !== null
    ? { grade_label: OBJECTIVE_STEPS[objIdx].label }
    : { grade_label: null }),
};
```

#### 编辑 payload（[L505-520](file:///Users/jefflau/projects/一表人才/src/pages/Learning.jsx#L505)）
同上结构：始终写 `self_rating`，条件写 `grade_label`。

#### 编辑回显（[L437-443](file:///Users/jefflau/projects/一表人才/src/pages/Learning.jsx#L437)）
```jsx
// 旧：按 eval_type 二选一加载
// 新：两个字段独立加载
const subjIdxLoaded = SUBJECTIVE_STEPS.findIndex(s => s.value === r.self_rating);
setSubjIdx(subjIdxLoaded >= 0 ? subjIdxLoaded : 3);

if (r.grade_label) {
  const objIdxLoaded = OBJECTIVE_STEPS.findIndex(s => s.label === r.grade_label);
  setObjIdx(objIdxLoaded >= 0 ? objIdxLoaded : 9);
  setObjDeferred(false);
} else {
  setObjIdx(null);
  setObjDeferred(true);
}
```

#### 提交后重置（[L390-392](file:///Users/jefflau/projects/一表人才/src/pages/Learning.jsx#L390), [L457-459](file:///Users/jefflau/projects/一表人才/src/pages/Learning.jsx#L457)）
移除 `setEvalType(1)`，改为 `setObjIdx(null); setObjDeferred(true);`

---

### 改动 4：最近记录列表显示

**文件**：[Learning.jsx:943](file:///Users/jefflau/projects/一表人才/src/pages/Learning.jsx#L943)

旧：按 `eval_type` 二选一显示主观或客观标签
新：两个字段独立显示，反映"主观必填 + 客观可选"

```jsx
{/* 旧 */}
<span className="record-tag record-tag--eval">
  {r.eval_type === 1 ? SUBJECTIVE_STEPS.find(s => s.value === r.self_rating)?.label : r.grade_label}
</span>

{/* 新 */}
{r.self_rating != null && (
  <span className="record-tag record-tag--eval">
    主观：{SUBJECTIVE_STEPS.find(s => s.value === r.self_rating)?.label || '-'}
  </span>
)}
{r.grade_label && (
  <span className="record-tag record-tag--eval">
    客观：{r.grade_label}
  </span>
)}
{r.category === 3 && !r.grade_label && (
  <span className="record-tag record-tag--eval" style={{color:'#94a3b8'}}>
    客观：待补充
  </span>
)}
```

> "客观：待补充"标签让"滞后填写"的记录可见，提醒学生回来补填。

---

### 改动 5：清理死代码

**文件**：[Learning.jsx:594-597](file:///Users/jefflau/projects/一表人才/src/pages/Learning.jsx#L594)

`evalLabel` 函数已定义但从未使用，删除。

---

## 不改动项

- **数据库 schema**：`eval_type`、`self_rating`、`grade_label` 字段定义不变。`eval_type` 语义微调（1=仅主观 / 2=含客观），但分析面板已按字段存在性判断，不影响读取。
- **分析面板**（DeepDivePanels / StudentDashboard / Mentor）：已按 `self_rating != null` 和 `grade_label != null` 判断，无需改动。
- **CSS**：`eval-tabs` / `eval-tab` 样式不再被引用，但保留不删（避免影响其他潜在引用，后续清理）。
- **GlassRail 组件**：复用现有实现，不改动。

---

## 假设与决策

1. **客观评价默认"暂不填写"**：用户强调"可以滞后填写"是常见场景，故默认 `objDeferred=true`，学生需主动取消勾选才会展开客观滑轨。这样也避免学生随意给个默认 B+ 当客观评价。
2. **`eval_type` 字段保留**：不删字段、不改 schema。新记录按"有客观=2 / 无客观=1"写入，向后兼容旧记录。
3. **`category===3` 作为"练习"判断**：基于数据库约定（1=学习/2=复习/3=练习），与分析面板一致。
4. **不处理生产数据迁移**：开发期 seed 数据已用数据库约定。如有生产数据需迁移旧表单记录的 category 值，单独处理。
5. **"暂不填写"用 checkbox 而非隐藏**：让学生明确感知"我选择了滞后"，而非"我没看到客观评价字段"。

---

## 验证步骤

1. `npm run build` 通过，无编译错误
2. 手动测试（学生端）：
   - 选"学习"→ 只看到主观评估，无客观字段
   - 选"复习"→ 只看到主观评估，无客观字段
   - 选"练习"→ 看到主观 + 客观（默认勾选"暂不填写"）
   - 取消勾选"暂不填写"→ 客观滑轨展开，可选 letter grade
   - 提交"练习 + 暂不填写"→ 记录列表显示"主观：xxx" + "客观：待补充"
   - 提交"练习 + 填写客观"→ 记录列表显示"主观：xxx" + "客观：B+"
   - 编辑"待补充"记录 → 客观字段默认展开"暂不填写"，可取消勾选并补填
3. 手动测试（导师端）：
   - 学生选"练习"存的记录 → 出现在练习质量分析面板（category=3 被正确筛选）
   - "待补充"记录的客观评价数为 0，主观评价数正常计数
