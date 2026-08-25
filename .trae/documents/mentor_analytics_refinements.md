# 导师数据分析页 — 第二轮优化

## Summary
对老师端数据分析页做 4 处改动：
1. 周历总览去掉客观评价展示（B+/B-/80+ 分数徽章）
2. 学科时间分配详情 — 循环总览 legend 可读性提升（百分比离 label 太远）
3. 用文本洞察面板替换"作业顺序偏好热力图" — 基于规则分析学生类型 + 作业顺序规律，consulting one-liner 风格输出
4. 自主学习趋势图放大，横向占比与前后图表对齐

---

## Current State Analysis

### 1. 周历总览分数徽章（需删除）
- [WeekGrid.jsx#L112-L115](file:///Users/jefflau/projects/一表人才/src/components/WeekGrid.jsx#L112-L115): `bestScore` 计算（筛选 eval_type=2 + score，取最高分）
- [WeekGrid.jsx#L187-L196](file:///Users/jefflau/projects/一表人才/src/components/WeekGrid.jsx#L187-L196): 移动端分数徽章渲染 `{scoreToGrade(bestScore)} {bestScore}`
- [WeekGrid.jsx#L270-L279](file:///Users/jefflau/projects/一表人才/src/components/WeekGrid.jsx#L270-L279): 桌面端分数徽章渲染
- `scoreColor()` / `scoreToGrade()` 定义在 L29-L51，WeekGrid 内部仍用于 bestScore；删除 bestScore 后这两个函数若无其他调用可保留（导出给 DeepDivePanels 用）

### 2. 学科时间分配详情 — legend 可读性
- [DeepDivePanels.jsx#L260-L279](file:///Users/jefflau/projects/一表人才/src/components/DeepDivePanels.jsx#L260-L279): 循环总览右侧列表
- 问题：每行用 `marginLeft: 'auto'` 把百分比推到最右，导致 label/分钟与百分比之间空隙过大
- 修复：去掉 `marginLeft: 'auto'`，label + 分钟 + 百分比紧凑排列

### 3. 作业顺序偏好热力图 → 文本洞察面板
- [DeepDivePanels.jsx#L842-L1048](file:///Users/jefflau/projects/一表人才/src/components/DeepDivePanels.jsx#L842-L1048): `SubjectOrderPreferenceChart` 组件（热力图 + 右侧图例 + 客观事实）
- [DeepDivePanels.jsx#L1083-L1085](file:///Users/jefflau/projects/一表人才/src/components/DeepDivePanels.jsx#L1083-L1085): 主入口中的 `<CollapsiblePanel title="作业顺序偏好热力图">`
- Session 数据结构确认（[Mentor.jsx#L307-L313](file:///Users/jefflau/projects/一表人才/src/pages/Mentor.jsx#L307-L313)）：每条 session 有 `date`、`time`(HH:MM 或 null)、`subject`(课程名)、`duration_minutes`、`category`、`form`
- 无现成 LLM/AI API 集成 → 用规则逻辑生成文本（与现有 `generateDiagnosis` 一致的模式）

### 4. 自主学习趋势图过小
- [DeepDivePanels.jsx#L390-L420](file:///Users/jefflau/projects/一表人才/src/components/DeepDivePanels.jsx#L390-L420): `SelfLearningTrendPanel`
- 问题：`const w = 200, h = 60` + `maxWidth: w`（200px）限制宽度，远小于其他面板（全宽）
- 修复：增大 viewBox 宽度至全宽（如 `w = 480`），去掉 `maxWidth` 限制，高度按比例增加

---

## Proposed Changes

### Change 1: WeekGrid.jsx — 删除分数徽章

**文件**: `src/components/WeekGrid.jsx`

1. **删除 bestScore 计算**（L112-L115）：
   ```js
   // 删除这段
   const scores = daySessions
     .filter(s => Number(s.eval_type) === 2 && s.score != null && s.score !== '')
     .map(s => Number(s.score));
   const bestScore = scores.length > 0 ? Math.max(...scores) : null;
   ```
   同时从 `return { totalMins, catMins, subjects, selfPct, bestScore, intensity }` 中移除 `bestScore`。

2. **删除移动端分数徽章**（L187-L196）：
   ```jsx
   // 删除整个 Score badge 块
   {data.bestScore !== null && (
     <div style={{ ... }}>
       {scoreToGrade(data.bestScore)} {data.bestScore}
     </div>
   )}
   ```

3. **删除桌面端分数徽章**（L270-L279）：同上。

4. **保留** `scoreColor` / `scoreToGrade` 导出（DeepDivePanels 的 PracticeQualityPanel 仍在用）。

---

### Change 2: DeepDivePanels.jsx — 循环总览 legend 可读性

**文件**: `src/components/DeepDivePanels.jsx`（SubjectAllocationPanel 内，约 L260-L279）

将循环总览右侧列表每行从「label + 分钟 ……………… 百分比」（百分比被 `marginLeft:auto` 推到最右）改为紧凑排列：

```jsx
// 每行：[色块] label 分钟 百分比%
<div key={c} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
  <span style={{ width: 8, height: 8, borderRadius: 2, background: CATEGORY_COLORS[c], flexShrink: 0 }} />
  <span style={{ color: '#475569', fontWeight: 500 }}>{CATEGORY_NAMES[c]}</span>
  <span style={{ color: '#94a3b8', fontSize: 10 }}>{fmtMins(cycleData.mins[c])}</span>
  <span style={{ fontWeight: 700, color: '#0f172a' }}>{pct}%</span>
</div>
```
- 去掉 `marginLeft: 'auto'`，百分比紧跟分钟显示
- 自主占比行同理

---

### Change 3: 用文本洞察面板替换热力图

**文件**: `src/components/DeepDivePanels.jsx`

#### 3a. 新建 `LearningPatternInsightPanel` 组件

替换 `SubjectOrderPreferenceChart`，用规则逻辑生成 consulting one-liner 文本。

**分析逻辑**：

1. **学生类型分类**（按作业高频时段）：
   - 从 sessions 提取 `s.time`（HH:MM），解析为小时
   - 对工作日 sessions（周一至周五）按小时桶统计频次
   - 取频次最高的小时段：
     - **晨读专家**：peak 在 6:00-10:00
     - **常规学习者**：peak 在 10:00-22:00
     - **夜猫子**：peak 在 22:00-次日 2:00（含 22, 23, 0, 1）
   - 对 null time 的 session：用 `inferStartHour`（已有逻辑）从 form 推断

2. **作业顺序规律**（按课程实际名称，不归类）：
   - 按工作日分组 sessions，每天按 time 升序排列
   - 记录每天的 subject 序列（只取有 ≥2 门不同科目的天）
   - 统计每个 subject 出现在"第一个"的频率、"第二个"的频率等
   - 若某个 subject 在第一位出现 ≥50% 的天数，输出"通常先做 [科目名]"
   - 同理第二位、第三位
   - 无足够规律（<3 天有多科目记录）时不输出顺序结论，只输出类型结论

3. **输出格式**（consulting one-liner，字体大小区分）：
   ```jsx
   <div>
     {/* 大字体类型标签 */}
     <div style={{ fontSize: 18, fontWeight: 800, color: '#0f172a' }}>
       {typeLabel}
     </div>
     {/* 小字体描述段 */}
     <div style={{ fontSize: 11, color: '#475569', lineHeight: 1.6, marginTop: 4 }}>
       {description}
     </div>
   </div>
   ```
   - description 示例：`该生作业高频时段集中在 19:00-21:00，通常先做「数学」，再做「英语」「物理」。`
   - 无顺序规律时：`该生作业高频时段集中在 19:00-21:00，作业顺序无固定规律。`

#### 3b. 主入口替换

```jsx
// 删除
<CollapsiblePanel title="作业顺序偏好热力图" icon="⏱">
  <SubjectOrderPreferenceChart sessions={sessions} />
</CollapsiblePanel>

// 替换为
<CollapsiblePanel title="学习行为洞察" icon="◎">
  <LearningPatternInsightPanel sessions={sessions} />
</CollapsiblePanel>
```

#### 3c. 保留旧组件
- `SubjectOrderPreferenceChart` 函数定义保留在文件中（不删除），仅从入口移除，便于未来恢复

---

### Change 4: 放大自主学习趋势图

**文件**: `src/components/DeepDivePanels.jsx`（SelfLearningTrendPanel，约 L390-L420）

1. **增大 viewBox**：`const w = 200, h = 60` → `const w = 480, h = 100`
2. **去掉 maxWidth 限制**：`style={{ width: '100%', maxWidth: w }}` → `style={{ width: '100%' }}`
3. **调整 padding**：`pad = 8` → `pad = 12`（配合更大画布）
4. **趋势线点增大**：`r="2.5"` → `r="3.5"`
5. **保持 viewBox 比例缩放**：SVG 会自动适配面板宽度

---

## Assumptions & Decisions

1. **"AI text-based output" = 规则逻辑生成文本**，非调用 LLM API。理由：
   - 项目无现成 LLM 集成基础设施
   - 分析逻辑（时段分类 + 顺序统计）是确定性的，规则可覆盖
   - 与现有 `generateDiagnosis` 模式一致
   - 若用户后续想要 LLM 生成自然语言，可单独提需求接入

2. **学生类型分类阈值**：
   - 晨读专家：peak ∈ [6, 10) 时
   - 常规学习者：peak ∈ [10, 22) 时
   - 夜猫子：peak ∈ [22, 2] 时（22, 23, 0, 1）
   - 仅分析工作日（周一至周五），排除周末

3. **顺序规律最小样本**：≥3 个工作日有多科目（≥2 门）记录才输出顺序结论

4. **科目名用实际课程名**：session.subject 已是 course.name，不归类

5. **旧组件保留**：SubjectOrderPreferenceChart 不删除，仅从入口移除

---

## Verification Steps

1. `npx vite build` 确认编译通过
2. 导师端打开学生数据分析页：
   - 周历总览日卡片不再显示 B+/B-/分数徽章
   - 学科时间分配详情的循环总览 legend 百分比紧跟分钟，可读性提升
   - "学习行为洞察"面板替代热力图，显示学生类型 + 顺序规律文本
   - 自主学习趋势图横向铺满，与前后图表宽度一致
3. 测试空数据场景（无 sessions）不报错
