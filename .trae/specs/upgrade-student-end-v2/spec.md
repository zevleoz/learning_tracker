# 学生端学习记录 Bug 修复与桌面端 UI 打磨 Spec

## Why
学生端（手机 + 桌面）即将交付生产使用。当前存在一个明确的数据写入 Bug：学生只填写「主观评价」保存学习记录后，记录上会凭空出现一个「客观：B+」；进入编辑后无法移除该客观评价。同时学生端此前以移动端为主，桌面端体验需要一次响应式打磨，达到生产级水准。

## 根因分析（已定位）
1. `src/pages/Learning.jsx` 的 `handleSubmit`（约 L765）与 `onSaveEdit`（约 L923）计算 `hasObjective = !objDeferred && (isObjNA || objIdx !== null)` 时**未限定 `category === 3`**。而默认状态为 `objIdx=9`（B+）、`objDeferred=false`，导致「学习」「复习」类记录虽然界面上不显示客观评估区（UI 仅 `category === 3` 渲染，L1544），保存时仍写入 `grade_label='B+'`、`eval_type=2`。快速记录按钮（L1326-1333）同样会触发。
2. `onStartEdit`（L856-860）对无 `grade_label` 的记录默认 `objIdx=9` + `objDeferred=false`，学生仅改备注后保存即被注入 B+。
3. 客观评估编辑区仅对练习类渲染，非练习类记录上的幻影 B+ 在 UI 中**没有任何移除入口**；且编辑保存会再次回写 B+。

## What Changes
- 创建/编辑保存路径加入类别守卫：仅 `category === 3`（练习）时根据滑轨/NA/稍后补充写入 `grade_label` 与 `eval_type`；学习/复习类一律写 `grade_label: null`、`eval_type: 1`。编辑历史幻影记录保存时自动清洗为空值（UPDATE 置 null，**不删除任何数据**）。
- 编辑无客观评价的记录时，客观评估默认进入「稍后补充」状态，未触碰该区域时保存不注入任何客观评价。
- 编辑模式下为已有客观评价的记录提供显式「清除客观评价」操作（保存时将 `grade_label` 置 null），并保留「稍后补充」的清除语义。
- 记录卡片的「客观：X」标签仅对练习类记录显示，历史幻影值即刻不再展示（仅前端显示层守卫，数据库数据保持原样）。
- 学生端桌面响应式打磨（不改变核心功能）：
  - Learning 页桌面端（≥1024px）表单与最近记录双栏布局，充分利用页面宽度；移动端保持现有单列。
  - 全部学生端页面无横向滚动；模态框始终视口居中且完整可见。
  - 交互元素补齐 hover/focus-visible 反馈，遵循扁平、细线、中性墨色、无 AI 模板化元素的设计规范。
- **不改动数据库结构、不删除数据库中任何记录。**

## Impact
- Affected specs: 学生学习行为记录（创建/编辑/删除）、待补填客观评价、学生端桌面响应式
- Affected code: `src/pages/Learning.jsx`（主）、`src/index.css`（追加响应式样式）、`src/pages/Review.jsx` / `Syllabus.jsx` / `Notifications.jsx`（仅必要的宽度/滚动修正）

## ADDED Requirements

### Requirement: 客观评价仅对练习类记录写入
The system SHALL 仅在「学习行为类别 = 练习」时将客观评价（letter grade 或 N/A）写入 `learning_sessions.grade_label`；学习/复习类记录保存时 `grade_label` 必须为 NULL、`eval_type` 必须为 1。

#### Scenario: 学生创建学习类记录
- **WHEN** 学生选择「学习」类别，仅填写主观评价并保存
- **THEN** 新记录的 `grade_label` 为 NULL，记录卡片不显示任何「客观」标签

#### Scenario: 学生编辑无客观评价的记录但不触碰客观区
- **WHEN** 学生编辑一条无客观评价的记录，仅修改备注并保存
- **THEN** 保存后该记录 `grade_label` 仍为 NULL，不出现 B+

#### Scenario: 幻影 B+ 的自动清洗
- **WHEN** 学生编辑一条历史遗留的、非练习类且带有幻影 B+ 的记录并保存
- **THEN** 保存后 `grade_label` 被 UPDATE 为 NULL（数据不被删除）

### Requirement: 客观评价可显式移除
The system SHALL 在编辑已有客观评价的练习类记录时提供显式「清除客观评价」操作，保存后 `grade_label` 置 NULL 且该记录回到「待补填」列表。

#### Scenario: 移除已有客观评价
- **WHEN** 学生编辑一条带客观评价的记录，点击「清除客观评价」并保存
- **THEN** `grade_label` 变为 NULL，卡片显示「客观：待补充」，可在待补填标签页重新填写

### Requirement: 幻影值显示守卫
The system SHALL 仅在记录类别为练习时显示「客观：X」标签。

#### Scenario: 历史幻影记录展示
- **WHEN** 数据库中存在非练习类但 `grade_label='B+'` 的历史记录
- **THEN** 记录卡片不显示该客观标签，且数据库中该字段保持不变

### Requirement: 学生端桌面响应式
The system SHALL 在桌面宽度（≥1024px）下充分利用页面宽度呈现 Learning 页（表单 + 最近记录双栏），所有学生端页面无横向滚动，模态框始终完整可见于视口中心。

#### Scenario: 桌面端打开记录页
- **WHEN** 学生在 ≥1024px 宽桌面浏览器打开 /learning
- **THEN** 记录表单与最近记录以双栏呈现，无横向滚动，所有交互元素有 hover/focus 反馈

## REMOVED Requirements
无。
