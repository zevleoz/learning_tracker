# 数据库索引优化计划

## 一、PWA 体验 vs 原生网站

### PWA 的核心优势

| 特性 | 普通网站 | PWA | 原生 App |
|---|---|---|---|
| **安装方式** | 浏览器访问 | 添加到主屏幕 | App Store 下载 |
| **离线支持** | ❌ | ✅ (Service Worker) | ✅ |
| **推送通知** | ❌ | ✅ (Push API) | ✅ |
| **全屏模式** | ❌ | ✅ (standalone) | ✅ |
| **启动画面** | ❌ | ✅ (manifest) | ✅ |
| **URL 可见** | ✅ | ❌ (standalone) | ❌ |
| **更新方式** | 即时 | 后台更新 | App Store 审核 |
| **开发成本** | 低 | 中 | 高 |

### PWA 体验差异

**首次访问**: 普通网页，用户通过浏览器访问

**安装后**:
- 从主屏幕图标启动（像原生 App）
- 无浏览器地址栏和标签栏
- 全屏沉浸式体验
- 启动画面（类似原生 App 的 splash screen）

**使用中**:
- 可以离线使用已缓存的内容
- 接收推送通知
- 后台同步数据

**本质区别**: PWA 是"包装成 App 体验的网页"，但底层仍然是 HTML/CSS/JS。性能接近原生网站，但不如真正的原生 App。

---

## 二、数据库索引原理

### 为什么索引能加速查询

**无索引的情况**:
```
查询: SELECT * FROM learning_sessions WHERE student_id = 'xxx'
执行: 扫描整张表的每一行，逐一比较 student_id
时间复杂度: O(n) —— 表越大越慢
```

**有索引的情况**:
```
索引结构: B-Tree（平衡树）
查询: SELECT * FROM learning_sessions WHERE student_id = 'xxx'
执行: 通过 B-Tree 快速定位到目标行
时间复杂度: O(log n) —— 表再大也很快
```

### 索引的代价

| 操作 | 无索引 | 有索引 |
|---|---|---|
| **查询** | 慢 | 快 |
| **插入** | 快 | 慢（需要更新索引） |
| **更新** | 快 | 慢（需要更新索引） |
| **删除** | 快 | 慢（需要更新索引） |
| **存储空间** | 小 | 大（索引需要额外空间） |

### 索引类型

1. **B-Tree**: 最常用，适合等值查询和范围查询
2. **Hash**: 只适合等值查询，PostgreSQL 默认不用
3. **GiST/GIN**: 适合全文搜索、数组、JSON

---

## 三、当前索引分析

### 已有索引（schema.sql 第 378-385 行）

| 索引名 | 表名 | 列 | 用途 |
|---|---|---|---|
| idx_sessions_student_date | learning_sessions | (student_id, session_date desc) | 按学生+日期查询 |
| idx_sessions_course | learning_sessions | (course_id) | 按课程查询 |
| idx_sessions_chapter | learning_sessions | (chapter_id) | 按章节查询 |
| idx_signals_student | signals | (student_id, expires_at) | 按学生查询信号 |
| idx_chapters_course | chapters | (course_id, order_idx) | 按课程查询章节 |
| idx_units_chapter | units | (chapter_id, order_idx) | 按章节查询单元 |
| idx_concepts_unit | concepts | (unit_id, order_idx) | 按单元查询概念 |
| idx_checkins_student | daily_checkins | (student_id, checkin_date desc) | 按学生查询签到 |

### 缺失的索引

#### 1. learning_sessions(student_id, course_id)

**问题**: `refresh_signals_for` 函数（第 281-286 行）频繁执行:
```sql
select count(*), avg(score)
from public.learning_sessions
where student_id = sid and course_id = cid
  and chapter_id = v_chapter
  and deleted_at is null;
```

**当前情况**: 只有 `idx_sessions_student_date` 和 `idx_sessions_course`，没有 `(student_id, course_id)` 复合索引。

**影响**: 当 `learning_sessions` 表增长时，信号计算会变慢。

#### 2. learning_sessions(student_id, chapter_id)

**问题**: 同上，信号函数还按 `(student_id, chapter_id)` 查询。

#### 3. profiles(school_id, role)

**问题**: Mentor.jsx 和课程查询可能需要按学校+角色筛选。

#### 4. learning_sessions(student_id, course_id, chapter_id)

**问题**: 信号函数最常见的查询模式是 `(student_id, course_id, chapter_id)`。

---

## 四、优化方案

### 需要添加的索引

```sql
-- 1. 信号计算核心索引（最常用查询模式）
create index idx_sessions_student_course_chapter 
on public.learning_sessions(student_id, course_id, chapter_id)
where deleted_at is null;

-- 2. 学生+课程组合索引（用于课程统计）
create index idx_sessions_student_course 
on public.learning_sessions(student_id, course_id)
where deleted_at is null;

-- 3. profiles 学校+角色索引（用于导师筛选学生）
create index idx_profiles_school_role 
on public.profiles(school_id, role);

-- 4. profiles 邮箱索引（用于登录查询）
create index idx_profiles_email 
on public.profiles(email);

-- 5. mentor_feedback 学生+导师索引
create index idx_feedback_student_mentor 
on public.mentor_feedback(student_id, mentor_id);
```

### 索引清理建议

无需删除现有索引，它们仍然有用。

---

## 五、实施步骤

### 步骤 1: 创建 SQL Patch 文件

创建 `supabase/schema.patch-indexes.sql`，包含上述索引创建语句。

### 步骤 2: 在 Supabase 中执行

在 Supabase SQL Editor 中运行该 patch 文件。

### 步骤 3: 验证索引生效

使用 `EXPLAIN ANALYZE` 验证查询是否使用了新索引。

### 步骤 4: 监控性能

观察 Dashboard 加载速度和信号计算延迟。

---

## 六、风险评估

| 风险 | 概率 | 影响 | 缓解措施 |
|---|---|---|---|
| 索引创建耗时 | 低 | 中 | 在低峰期执行 |
| 索引占用空间 | 低 | 低 | 当前数据量小，影响可忽略 |
| 写入性能下降 | 低 | 低 | 索引数量合理，写入频率低 |
| 索引失效 | 极低 | 高 | 定期检查索引状态 |

---

## 七、预期效果

- **信号计算**: 从全表扫描变为索引查找，速度提升 10-100 倍
- **Dashboard 加载**: 更快的学习记录查询
- **导师页面**: 更快的学生列表加载
- **扩展性**: 支持更多用户和更多学习记录