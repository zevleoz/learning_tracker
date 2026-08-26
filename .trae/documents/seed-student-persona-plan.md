# 计划：为学生账号填充模拟学习数据

## 概述

为学生账号 `2135982912@qq.com` 生成一个 SQL 脚本，在 Supabase SQL Editor 中运行，填充 4 周约 65 条 `learning_sessions` 数据。营造一个"数学有问题"的学生形象：数学只被动上课、时间很晚且短、无自主学习复习练习；其他科目也以被动为主，但时间稍好。

## 当前状态分析

### 数据库结构（已确认）
- `profiles`：`id`（uuid, 关联 auth.users）、`role`、`full_name`、`school_name`/`school_id`
- `courses`：`name`（**英文名**）、`subject`、`source`、`created_by`、`is_shared`
- `chapters` → `units` → `concepts`：课程层级结构
- `learning_sessions`：
  - `category`：1=学习, 2=复习, 3=练习
  - `form`：varchar（学校课堂/学校作业/自主学习/自主复习/自主练习/自主预习/校外线上/校外线下）
  - `eval_type`：1=主观(self_rating), 2=客观(score)
  - `chapter_id`/`unit_id`：可空（学生可选择性关联）
- `teacher_student_connections`：`teacher_id`/`student_id`/`status`(0=pending,1=accepted)
- RLS：`learning_sessions` 要求 `student_id = auth.uid()`，但 SQL Editor 以 postgres 身份运行，绕过 RLS

### 学生已有 syllabus（用户确认）
- 课程名为英文，已存在于数据库中
- 数学课程的章节/单元可能存在归类混乱（用户描述的特征），脚本不修改 syllabus，仅引用现有结构

### 现有 seed 脚本模式（参考）
- `seed_test_student_complete.sql`：使用 `DO $$ ... $$` PL/pgSQL 块，通过变量查找课程 ID，按周批量插入
- `schema.patch-fake-data.sql`：类似模式，按天插入

## 学生人设设计

### 核心特征
1. **数学问题严重**：
   - 只有被动上课（`学校课堂` category=1 / `学校作业` category=3）
   - 时间很晚：`start_time` = 21:00~22:00
   - 时间很短：`duration_minutes` = 20~30
   - 分数低：score = 50~70
   - **完全没有**自主学习/复习/练习/预习
   - 经常不关联 chapter/unit（不善于归类）

2. **其他科目也偏被动**（但比数学稍好）：
   - 以 `学校课堂`/`学校作业`/`校外线上`/`校外线下` 为主
   - 偶尔有 1~2 次 `自主学习`/`自主复习`（每周最多 1~2 次，非数学科目）
   - 时间正常：`start_time` = 15:00~20:00
   - 时长中等：`duration_minutes` = 30~45
   - 分数中等：score = 65~85
   - 通常关联 chapter/unit

3. **整体**：基本无主动输出，被动学习为主

### 数据分布（4 周，约 65 条）

| 周次 | 总条数 | 数学 | 其他科目 | 特征 |
|------|--------|------|----------|------|
| 3周前 | ~15 | 3 | 12 | 初始状态 |
| 2周前 | ~17 | 3 | 14 | 略有变化 |
| 上周 | ~18 | 3 | 15 | 略有变化 |
| 本周 | ~15 | 2~3 | 12~13 | 截至今天 |

### 数学数据样例（每周）
```
- 周一 21:00, 学校课堂, 学习, 客观, score=58, 25min, chapter_id=null
- 周三 21:30, 学校作业, 练习, 客观, score=55, 20min, chapter_id=null
- 周五 21:00, 学校课堂, 学习, 客观, score=62, 25min, chapter_id=现有(可能错位)
```

### 其他科目数据样例（每周）
```
- 周一 18:00, 学校课堂, 学习, 客观, score=72, 35min, chapter_id=正常
- 周二 17:00, 学校作业, 练习, 客观, score=75, 30min, chapter_id=正常
- 周四 19:00, 校外线上, 学习, 客观, score=70, 40min, chapter_id=正常
- 周六 14:00, 自主复习, 复习, 主观, self_rating=60, 30min（少量自主）
```

## 实施步骤

### 步骤 1：创建 SQL 脚本文件

**文件**：`supabase/seed_student_persona.sql`

脚本结构（PL/pgSQL `DO $$ ... $$` 块）：

1. **查找学生 ID**
   ```sql
   SELECT id INTO student_id FROM auth.users WHERE email = '2135982912@qq.com';
   ```
   - 如果不存在，RAISE EXCEPTION 终止

2. **查找课程（动态查找，不硬编码名称）**
   ```sql
   -- 数学：通过 name 或 subject 模糊匹配
   SELECT id INTO math_course_id FROM courses
   WHERE lower(name) LIKE '%math%' OR lower(subject) LIKE '%math%' OR subject = '数学'
   LIMIT 1;

   -- 查找该学生可见的所有其他课程（取前4个非数学课程）
   SELECT array_agg(id) INTO other_course_ids FROM courses
   WHERE id != math_course_id AND (created_by = student_id OR is_shared = true)
   LIMIT 4;
   ```

3. **查找各课程的章节/单元**
   ```sql
   -- 数学的章节/单元（可能错位，直接引用）
   SELECT id INTO math_chapter_id FROM chapters WHERE course_id = math_course_id ORDER BY order_idx LIMIT 1;
   SELECT id INTO math_unit_id FROM units WHERE chapter_id = math_chapter_id ORDER BY order_idx LIMIT 1;
   -- 其他课程同理
   ```

4. **清理旧数据**
   ```sql
   DELETE FROM learning_sessions WHERE student_id = student_id;
   ```

5. **按周插入数据**（4 周，约 65 条）
   - 数学期：21:00~22:00, 20~30min, 学校课堂/学校作业, score 50~70, chapter/unit 偶尔 null
   - 其他科目期：15:00~20:00, 30~45min, 多种 form, score 65~85, chapter/unit 正常关联
   - 每周 1~2 次非数学的自主复习（self_rating, eval_type=1）

6. **连接导师**（如果未连接）
   ```sql
   SELECT id INTO mentor_id FROM profiles WHERE role = 2 LIMIT 1;
   INSERT INTO teacher_student_connections (teacher_id, student_id, status)
   VALUES (mentor_id, student_id, 1)
   ON CONFLICT (teacher_id, student_id) DO UPDATE SET status = 1;
   ```

7. **输出验证统计**
   ```sql
   RAISE NOTICE '总记录数: %', ...;
   RAISE NOTICE '数学记录数: %', ...;
   RAISE NOTICE '各科分布: ...';
   ```

### 步骤 2：用户在 Supabase SQL Editor 运行脚本

1. 登录 Supabase Dashboard → SQL Editor
2. 粘贴 `supabase/seed_student_persona.sql` 内容
3. 点击 Run
4. 查看 Messages 中的 NOTICE 输出确认成功

### 步骤 3：验证数据

1. **数据库验证**（SQL 查询）：
   ```sql
   SELECT course_id, category, form, count(*), avg(score), avg(duration_minutes)
   FROM learning_sessions
   WHERE student_id = (SELECT id FROM auth.users WHERE email = '2135982912@qq.com')
   GROUP BY course_id, category, form;
   ```

2. **App 验证**（可选）：
   - 用学生账号登录 App，查看 Learning 页面是否显示数据
   - 用导师账号登录，查看数据分析页面是否正确展示该学生

## 假设与决策

1. **不修改 syllabus**：脚本仅查询现有 courses/chapters/units，不做 INSERT/UPDATE/DELETE
2. **数学识别**：通过 `lower(name) LIKE '%math%'` 或 `subject = '数学'` 动态查找数学课程
3. **其他课程**：动态查找学生可见的所有非数学课程，不硬编码名称
4. **导师连接**：自动连接到第一个 role=2 的导师（如果未连接）
5. **数据时间范围**：从 3 周前的周一到今天，覆盖"本周/上周/近2周/近4周"所有预设
6. **eval_type**：被动上课/作业用客观(score)，少量自主复习用主观(self_rating)
7. **chapter/unit 关联**：数学经常 null（不善于归类），其他科目正常关联
8. **脚本幂等**：可重复运行，先清理旧数据再插入

## 关键文件

- **新建**：`supabase/seed_student_persona.sql`（主脚本）
- **参考**：`supabase/seed_test_student_complete.sql`（现有模式参考）
- **参考**：`supabase/schema.sql`（表结构）
- **参考**：`supabase/schema.patch-invites.sql`（teacher_student_connections 结构）
