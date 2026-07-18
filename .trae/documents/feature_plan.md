# 功能修改计划

## 1. 学习行为时间冲突检测

### 问题描述
学生在记录学习行为时，如果同一时间段内已经有学习记录，应该检测到冲突并拒绝创建。

### 修改文件
- `src/pages/Learning.jsx`

### 修改步骤
1. 在 `onSubmit` 函数中，提交前查询数据库检查时间冲突
2. 查询条件：
   - `student_id = auth.uid()`
   - `session_date = 当前选择的日期`
   - 时间范围重叠：`start_time < 新结束时间 AND end_time > 新开始时间`
3. 如果存在冲突，显示错误提示"该时间段已有学习记录"
4. 同样在 `onSaveEdit` 函数中添加冲突检测

### 潜在风险
- 并发创建记录可能导致冲突（可以接受，概率低）

---

## 2. 回顾页图表按课程名称统计

### 问题描述
当前回顾页底部的水平柱状图（SubjectSummaryBlock）按科目（subject）划分，需要改为按课程名称（course name）统计。

### 修改文件
- `src/components/SharedDashboard.jsx` - `SubjectSummaryBlock` 组件

### 修改步骤
1. 修改 `SubjectSummaryBlock` 中的数据分组逻辑
2. 将 `s.subject` 改为 `s.course?.name` 或 `s.course_name`
3. 保持图表样式不变，只改变分组依据

### 注意事项
- 需要确保 sessions 数据中包含 course 信息
- 需要处理 course 为空的情况（显示"未分类"）

---

## 3. 将"学科"字段改为"校内/校外"标签

### 问题描述
当前课程创建时有"学科"（subject）字段，需要改为让用户选择"校内"或"校外"标签。

### 修改文件
1. `src/pages/Syllabus.jsx` - 添加/编辑课程表单
2. `supabase/schema.sql` - 数据库表结构（需要考虑向后兼容）

### 修改方案
方案 A：修改现有 `subject` 字段的语义（简单但有风险）
- 将 subject 字段的输入从自由文本改为选择"校内"或"校外"
- 需要处理已有数据（保留现有值，新创建的使用新标签）

方案 B：新增 `course_type` 字段（更安全）
- 在 courses 表中新增 `course_type smallint default 1` 字段（1=校内，2=校外）
- 保留现有 `subject` 字段用于向后兼容
- 修改前端表单使用新字段

**推荐方案 B**，因为：
- 不影响现有数据
- 保留了原有的 subject 字段用于其他功能
- 更清晰的语义

### 修改步骤
1. 创建 SQL 补丁添加 `course_type` 字段
2. 修改 `Syllabus.jsx` 中的添加/编辑表单
3. 将文本输入改为选择框（校内/校外）
4. 更新 `createCourse` 和 `updateCourse` 函数

---

## 实施顺序

1. 先实现时间冲突检测（最简单）
2. 再修改回顾页图表
3. 最后修改课程分类功能（涉及数据库变更）

---

## 数据库变更

需要在 Supabase SQL Editor 中运行：

```sql
-- 添加 course_type 字段
alter table if exists public.courses add column if not exists course_type smallint default 1;

-- 创建索引
create index if not exists courses_course_type_idx on public.courses(course_type);
```

`course_type` 取值：
- `1` = 校内课程
- `2` = 校外课程
