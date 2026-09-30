# 修复"幽灵学习记录"：导师端 + 学生复盘页软删除过滤

## Summary

导师端查看学生的 review dashboard 时出现学生未填写的学习记录（例：Samson 最后一条记录是 28 号，导师端却多出 29 号的记录）。

**根因（已逐行确认）**：学生删除学习记录是**软删除**（`deleted_at` 置时间戳），但以下查询**没有过滤 `deleted_at`**，导致学生已删除的记录"复活"：

- [Mentor.jsx:419-428](file:///Users/jefflau/projects/一表人才/src/pages/Mentor.jsx#L419-L428) — 导师端学生详情的 sessions（喂给 L1561/L2422 两处 WeekReviewDashboard）← **29 号幽灵记录的直接来源**
- [Mentor.jsx:359-363](file:///Users/jefflau/projects/一表人才/src/pages/Mentor.jsx#L359-L363) — 导师端班级统计 `loadClassStats`
- [Review.jsx:20-30](file:///Users/jefflau/projects/一表人才/src/pages/Review.jsx#L20-L30) — 学生自己的 `/review` 复盘页（同类 bug，学生也会看到自己的幽灵记录，与 Learning 页最近记录列表矛盾）

**29 号记录的确切解释**：该记录真实存在于 DB 且 `deleted_at` 已置（学生曾填入后删除，或填错日期后删除）。学生端 Learning 页过滤了它所以"最后一条是 28 号"，导师端未过滤所以多出 29 号。可在 Supabase Dashboard 用 `select session_date, deleted_at from learning_sessions where student_id = '<id>' and session_date = '2026-09-29'` 验证（预计 `deleted_at` 非空）。修复后该记录自动从所有视图消失，**无需数据订正**。

**修复原则**：纯查询过滤，不删除/修改任何数据行，不动 e4，不动提交/删除逻辑，不动 DB/RLS。

## Current State Analysis

### 数据流（已确认）

- 学生提交：[Learning.jsx:789](file:///Users/jefflau/projects/一表人才/src/pages/Learning.jsx#L789) insert，`session_date` 为本地日期字符串；DB 列为 `date` 类型，存取原样，**已排除时区跨天嫌疑**。
- 学生删除：[Learning.jsx:678](file:///Users/jefflau/projects/一表人才/src/pages/Learning.jsx#L678) / [Learning.jsx:1001](file:///Users/jefflau/projects/一表人才/src/pages/Learning.jsx#L1001) 软删除；学生端 Learning 页 8 处读取全部带 `.is('deleted_at', null)`。
- 导师路由仅 `/mentor`（[App.jsx:78](file:///Users/jefflau/projects/一表人才/src/App.jsx#L78)）；`MentorAnalytics.jsx` 为无路由遗留代码，不可达，保持原样。
- DB 端无触发器/视图/RPC 制造数据；导师端全部 SELECT，查看行为不写数据。

## Proposed Changes

### 1. [Mentor.jsx](file:///Users/jefflau/projects/一表人才/src/pages/Mentor.jsx) — 2 处

- L419 学生详情 sessions 查询：`.eq('student_id', picked.id)` 后追加 `.is('deleted_at', null)`
  → 学生详情记录列表 + 两处 WeekReviewDashboard 不再显示已删记录
- L359 `loadClassStats` 查询：`.in('student_id', targetStudents)` 后追加 `.is('deleted_at', null)`
  → 班级平均时长/活跃人数不再计入已删记录

### 2. [Review.jsx](file:///Users/jefflau/projects/一表人才/src/pages/Review.jsx) — 1 处（用户已确认一并修）

- L20 复盘页查询：`.eq('student_id', user.id)` 后追加 `.is('deleted_at', null)`
  → 学生复盘页与 Learning 页最近记录列表一致；纯可见性修复，不删数据

### 明确不做的事

- 不动 e4 任何文件；不动学生端提交/删除逻辑（Learning.jsx 仅作为根因参照，零改动）
- 不物理删除 `learning_sessions` 任何行（含已软删除的行，保留作审计痕迹）
- 不动 MentorAnalytics.jsx（遗留代码）、DebugTools.jsx、数据库、RLS
- [date.js](file:///Users/jefflau/projects/一表人才/src/lib/date.js) `todayISO()` 用 UTC 日期是独立隐患（早 8 点前"今天"算成昨天，只影响统计窗口边界、不制造记录），本次不动

## Assumptions & Decisions

- 三处修改为同一过滤条件，对现有功能零副作用；各 dashboard 的空数据处理已有保护。
- 修复后导师端数据集 = 学生端数据集，两端完全同步。

## Verification

1. `npm run build` 通过
2. `npm test` 不新增失败（既有 Learning 相关失败为已知基线）
3. 手动验证：
   - 学生端填入一条记录 → 删除 → 导师端学生详情 review dashboard、班级统计、学生 `/review` 复盘页三处均不再显示该记录
   - （可选）Supabase Dashboard 查 Samson 的 29 号记录，确认 `deleted_at` 非空
