# 修复 Syllabus 删除不生效（数据"自动恢复"）问题

## Summary

用户（普通 user 角色）在课程大纲页删除课程/章节/单元后，过一会儿数据又出现。根因有两层，两层都修：

1. **前端查询层（必现 bug）**：`Syllabus.jsx` 加载时只对 `courses` 过滤了 `deleted_at is null`，嵌套的 `chapters`/`units` 查询完全没有过滤。所以即使软删除在数据库里成功写入 `deleted_at`，刷新页面后已删除的章节/单元会重新显示，看起来就像"删除被撤销了"。
2. **数据库 RLS 层（静默失败）**：基础 `schema.sql` 中 `chapters`/`units` 表**没有 UPDATE 策略**（只有 select/insert）。软删除是 `UPDATE ... SET deleted_at`，若修复补丁 `schema.patch-fix-curriculum-delete.sql` 未在生产库执行，UPDATE 被 RLS 拦截，**影响 0 行且不报错**（Supabase `.update()` 不带 `.select()` 时 0 行也返回 success）。前端误以为删除成功，本地 state 移除了该项，下次加载数据自然"回来了"。

## Current State Analysis

- 删除为软删除：`update({ deleted_at: new Date().toISOString() })`，见 [Syllabus.jsx](file:///Users/jefflau/projects/一表人才/src/pages/Syllabus.jsx#L239-L302)。
- 加载查询只过滤课程级 `deleted_at`，嵌套 chapters/units 无过滤：[Syllabus.jsx#L52-L59](file:///Users/jefflau/projects/一表人才/src/pages/Syllabus.jsx#L52-L59)。
- 同样问题存在于 [Learning.jsx#L395-L399](file:///Users/jefflau/projects/一表人才/src/pages/Learning.jsx#L395-L399)（学生记录页选课程树）和 [Mentor.jsx#L441-L449](file:///Users/jefflau/projects/一表人才/src/pages/Mentor.jsx#L441-L449)（导师查看学生大纲）。
- 基础 schema 无 chapters/units 的 UPDATE 策略：[schema.sql#L442-L465](file:///Users/jefflau/projects/一表人才/supabase/schema.sql#L442-L465)；修复补丁已存在但需确认是否已在生产库执行：[schema.patch-fix-curriculum-delete.sql](file:///Users/jefflau/projects/一表人才/supabase/schema.patch-fix-curriculum-delete.sql)。
- 数据库无任何 trigger 会重建 syllabus 数据（已排查），排除"自动恢复"逻辑。
- 测试 mock 的 `update()` 是 async 函数直接返回 `{data, error}`，不支持 `.update().eq().select()` 链式调用，需同步升级：[src/__mocks__/supabase.js#L140-L158](file:///Users/jefflau/projects/一表人才/src/__mocks__/supabase.js#L140-L158)。

## Proposed Changes

### 1. src/pages/Syllabus.jsx — 嵌套过滤 + 删除结果校验

**a) 加载查询加 deleted_at 并在映射时过滤**（L52-L76）：

```js
const { data: cs, error } = await supabase
  .from('courses')
  .select(`
    id, name, subject, source, course_type, created_by,
    chapters:chapters(id, name, order_idx, deleted_at, units(id, name, order_idx, deleted_at))
  `)
  .is('deleted_at', null)
  .order('created_at', { ascending: false });
```

映射时先过滤 units 再过滤 chapters：

```js
chapters: (c.chapters || [])
  .filter((ch) => !ch.deleted_at)
  .slice()
  .sort(...)
  .map((ch) => ({
    ...ch,
    units: (ch.units || []).filter((u) => !u.deleted_at).slice().sort(...)
  }))
```

**b) 三个删除函数增加"0 行受影响 = 失败"校验**（doDeleteCourse / doDeleteChapter / doDeleteUnit）：

```js
const { data, error } = await supabase
  .from('courses')
  .update({ deleted_at: new Date().toISOString() })
  .eq('id', courseId)
  .select('id');

if (error) { ...现有处理... }
if (!data || data.length === 0) {
  logger.error('deleteCourse: 0 rows affected (可能被 RLS 拦截)', { courseId });
  return toast('删除未生效（没有权限或数据不存在），请刷新页面重试', { kind: 'error' });
}
// 成功才移除本地 state
```

chapter/unit 同理。失败时**不动本地 state**（该项保留在列表中，与数据库一致）。

### 2. src/pages/Learning.jsx — 课程树同样过滤

- L397 嵌套 select 增加 `deleted_at`：`chapters(id, name, deleted_at, units(id, name, deleted_at))`。
- L401-L409 映射时过滤 `deleted_at` 非空的 chapters/units。

### 3. src/pages/Mentor.jsx — 导师端学生大纲同样过滤

- L445 嵌套 select 增加 `deleted_at`。
- L456-L467 映射时过滤。

### 4. src/__mocks__/supabase.js — update 支持链式调用

把 `async update(data)` 改为同步 builder（支持 `.eq()` / `.match()` / `.select()` / `await`），返回匹配行：

```js
update(data) {
  trackCall('update', tableName, data);
  const filters = [];
  const builder = {
    eq(field, value) { filters.push({ type: 'eq', field, value }); return builder; },
    match(conditions) { Object.entries(conditions).forEach(([f, v]) => builder.eq(f, v)); return builder; },
    select() { return Promise.resolve(builder.__run()); },
    then(resolve) { return Promise.resolve(builder.__run()).then(resolve); },
    __run() {
      const table = mockTables[tableName] || [];
      const matches = (row) => filters.every(f => f.type !== 'eq' || row[f.field] === f.value);
      mockTables[tableName] = table.map(row => matches(row) ? { ...row, ...data } : row);
      return { data: (mockTables[tableName] || []).filter(matches), error: null };
    },
  };
  return builder;
}
```

现有 `await ...update(...)` 调用方式不受影响（builder 是 thenable）。

### 5. __tests__/Syllabus.test.jsx — 新增测试

- **已删除章节/单元被过滤**：course row 内嵌 `chapters: [{name:'已删除章节', deleted_at:'2024-01-01', units:[{name:'已删除单元', deleted_at:'…'}, {name:'活跃单元', deleted_at:null}]}, {name:'活跃章节', deleted_at:null, units:[]}]`，断言已删除项不渲染、活跃项渲染。
- **删除失败路径（0 行受影响）**：渲染课程后用 `__setTableData('courses', [])` 模拟 RLS 拦截，点击删除并确认，断言出现"删除未生效"错误 toast。
- **删除成功路径**：正常删除后课程从列表消失，且 update 调用带 `deleted_at`。

### 6. 数据库确认（手动步骤，无代码改动）

在 Supabase SQL Editor 执行（只读检查）：

```sql
select column_name from information_schema.columns
where table_schema='public' and table_name in ('chapters','units') and column_name='deleted_at';

select tablename, policyname from pg_policies
where schemaname='public' and tablename in ('courses','chapters','units');
```

若缺 `deleted_at` 列或 `chapters_update`/`units_update` 策略，执行仓库中已有的幂等补丁 [schema.patch-fix-curriculum-delete.sql](file:///Users/jefflau/projects/一表人才/supabase/schema.patch-fix-curriculum-delete.sql)。

## Assumptions & Decisions

- 不改为物理删除：软删除是既有设计（不可撤销提示、导师端复用），只修"过滤缺失 + 静默失败"。
- 嵌套过滤用"select 带 deleted_at + 前端过滤"，不用 PostgREST 嵌套筛选语法，简单可靠且可测。
- 0 行受影响视为失败并向用户报错，不再静默成功。
- 复用现有幂等 SQL 补丁，不新建 SQL 文件。
- 已被静默失败"漏删"的历史数据不受影响，修复后用户重新删除即可。

## Verification

1. `npx jest __tests__/Syllabus.test.jsx`（或项目测试命令）全部通过，含新增 3 个用例。
2. 本地跑应用：删除章节/单元/课程 → 刷新页面 → 不再出现。
3. 模拟 RLS 拦截（或在未打补丁的环境）删除 → 出现明确错误 toast，而非假成功。
4. 数据库只读检查确认 deleted_at 列与 update 策略存在；缺失则执行补丁。
5. 回归检查 Learning 页课程树、导师端学生大纲不再显示已删除章节/单元。
