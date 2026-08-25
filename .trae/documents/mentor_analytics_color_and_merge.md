# 导师端数据分析：维度总览精简 + 颜色去评价化 + 深度分析合并

## 概述

三方面改动：
1. **维度总览** 7 卡片 → 4 卡片（删除学科分配、练习质量、反馈密度）
2. **颜色去评价化** — 移除所有 SEM good/risk/alert 色码和主观判断文案
3. **深度分析合并** — 学习/复习/练习循环并入学科时间分配详情；自主复习/外部复习合并为单一复习 + 自主占比文本

---

## 当前状态

### DimensionStrip.jsx
- 7 张卡片：参与度 / 总时长 / 学科分配 / 复习占比 / 练习质量 / 自主比例 / 反馈密度
- 每张卡片用 SEM（good/moderate/risk/alert）着色值和 bar
- sub 文案含主观判断："全勤" "偏科风险" "自主性强" "依赖外部" "反馈充足/不足"
- 工作日/周末 bar 用 SELF_COLOR(蓝) + EXTERNAL_COLOR(紫)
- gridTemplateColumns: `repeat(7, 1fr)`

### DeepDivePanels.jsx
- **SubjectAllocationPanel** (L182-331):
  - 4 段堆叠条：学习 + 自主复习 + 外部复习 + 练习（4 色）
  - riskRow() 生成 "复习占比极低" "复习依赖外部" 等判断
  - risk 背景色 + ⚠ 警告图标
  - Legend 4 项：学习 / 自主复习 / 外部复习 / 练习
- **CategoryCyclePanel** (L334-389):
  - 独立面板，环形图 + 学/复/练占比
- 主入口 (L1091-1099) 有 6 个 CollapsiblePanel：
  1. 学科时间分配详情（SubjectAllocationPanel）
  2. 作业顺序偏好热力图
  3. 学习-复习-练习循环（CategoryCyclePanel）← 要并入 #1
  4. 自主学习趋势
  5. 练习质量分析
  6. 教育诊断结论

---

## 改动计划

### Part 1: DimensionStrip.jsx — 精简为 4 卡片 + 去评价化

**删除 3 张卡片**（从 `cards` 数组移除）：
- 学科分配（index 2）— 删除
- 练习质量（index 4）— 删除
- 反馈密度（index 6）— 删除

**保留 4 张卡片**：参与度 / 总时长 / 复习占比 / 自主比例

**颜色改中性**：
- 所有 `color` 字段 → `#0f172a`（黑），不再用 SEM.good/risk/alert
- bar 背景 → `#4F46E5`（品牌紫），不再用 SEM 色
- 工作日/周末 bar → `#0f172a` + `#94a3b8`（深灰 + 浅灰），不再用 SELF_COLOR/EXTERNAL_COLOR

**删除所有主观 sub 文案**：
- 参与度：删 `"全勤"` / `"X天未记录"` → sub 改为 `null` 或纯数据 `"共${dims.totalDays}天"`
- 总时长：保持 `"日均X"` （纯数据，已是中性的）
- 复习占比：保持 `"学X% · 练X%"`（纯数据）
- 自主比例：删 `"自主性强"` / `"中等"` / `"依赖外部"` → sub 改为 `null`

**网格**：`repeat(7, 1fr)` → `repeat(4, 1fr)`

### Part 2: DeepDivePanels.jsx — SubjectAllocationPanel 重构

**数据层改动**：
- 删除 `reviewSelf` / `reviewOther` 字段
- 保留 `studyMins` / `reviewMins` / `practiceMins`（3 类）
- 新增 `selfMins`（该学科所有自主形式时长）和 `selfPct`
- 删除 `reviewSelfPct`

```js
// 新数据结构
map[name] = {
  total: 0,
  studyMins: 0, reviewMins: 0, practiceMins: 0,
  selfMins: 0,  // 所有 isSelfForm 的时长
};
// ...
const selfPct = d.total > 0 ? Math.round(d.selfMins / d.total * 100) : 0;
```

**渲染层改动**：
- 堆叠条 4 段 → 3 段：学习(STU) + 复习(REV) + 练习(PRAC)
- 删除 `REV_OTHER` 段
- 指标行：`学X% · 复X% · 练X%`（3 色）+ `自主X%`（灰色文本标签，非独立颜色段）
- 删除 riskRow / riskBg / riskColor / ⚠ 警告
- Legend 4 项 → 3 项：学习 / 复习 / 练习

**颜色**：
- STU = `CATEGORY_COLORS[1]`（学习蓝）
- REV = `CATEGORY_COLORS[2]`（复习紫）
- PRAC = `CATEGORY_COLORS[3]`（练习青）
- 自主占比用 `#94a3b8` 灰色文本

### Part 3: 合并 CategoryCyclePanel → SubjectAllocationPanel

**在 SubjectAllocationPanel 顶部加入循环总览**：

将 CategoryCyclePanel 的环形图 + 3 类总时/占比，放在学科逐行分配的上方：

```jsx
<div>
  {/* 循环总览（原 CategoryCyclePanel 内容） */}
  <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 12 }}>
    <svg>... 环形图 ...</svg>
    <div>... 学/复/练 占比列表 ...</div>
  </div>
  {/* 学科逐行分配（原 SubjectAllocationPanel 内容） */}
  <div>... 各学科堆叠条 ...</div>
</div>
```

**主入口改动** (L1091-1099)：
- 删除 `<CollapsiblePanel title="学习-复习-练习循环">` 面板
- SubjectAllocationPanel 标题可改为 "学科时间分配与学习循环" 或保持不变

### Part 4: 清理 SEM 和 EXTERNAL_COLOR 引用

- DimensionStrip.jsx：删除 `SEM` import 和定义（不再使用）
- DeepDivePanels.jsx：保留 `SEM` 定义（其他面板如 DiagnosisPanel 可能使用），但 SubjectAllocationPanel 不再引用
- WeekGrid.jsx：`EXTERNAL_COLOR` 仍导出但 DeepDivePanels 不再导入

---

## 文件变更

| 文件 | 操作 |
|------|------|
| `src/components/DimensionStrip.jsx` | 修改：7→4 卡片，移除 SEM 色 + 主观文案，grid 4 列 |
| `src/components/DeepDivePanels.jsx` | 修改：SubjectAllocationPanel 4→3 色 + 合并循环面板 + 删除 risk 判断；主入口删除循环面板 |

**不改动**：WeekGrid.jsx、WeekReviewDashboard.jsx、StudentDashboard.jsx、Mentor.jsx

---

## 验证步骤

1. 导师登录 → 数据分析 tab → 选择学生
2. 维度总览：确认只有 4 张卡片（参与度/总时长/复习占比/自主比例）
3. 维度总览：确认无红/绿/黄色，值和 bar 均为黑/灰/品牌紫
4. 维度总览：确认无 "全勤/偏科风险/自主性强/依赖外部" 等主观文案
5. 深度分析 → 学科时间分配详情：
   - 确认顶部有环形图（学/复/练循环）
   - 确认各学科行为 3 段堆叠（学习/复习/练习），无自主/外部复习区分
   - 确认有 "自主X%" 灰色文本标签
   - 确认无 ⚠ 警告和风险背景色
6. 深度分析：确认无独立的 "学习-复习-练习循环" 面板
7. `npm run build` 无错误
