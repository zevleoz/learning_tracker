# Vercel 部署前功能验证与加固计划

## 摘要
确保项目从本地开发环境（localhost）迁移到 Vercel 生产环境后，核心功能（学习记录的增/删/改/查）能正常工作。重点排查环境变量、Supabase RLS（行级安全策略）兼容性及潜在的权限问题。

---

## 当前状态分析

### 1. 环境变量 (Environment Variables)
- **代码位置**: `src/lib/supabase.js`
- **读取方式**: `import.meta.env.VITE_SUPABASE_URL` 和 `VITE_SUPABASE_ANON_KEY`
- **风险点**: Vercel 部署时必须在 Project Settings 中配置这两个变量。若缺失，Supabase 客户端将无法初始化，所有 API 调用将失败。

### 2. RLS（行级安全策略）兼容性
- **策略定义**: `supabase/schema.patch-check-policies.sql`
- **关键策略**:
  - `sessions_insert`: `with check (student_id = auth.uid())`
  - `sessions_update`: `using (student_id = auth.uid()) with check (student_id = auth.uid())`
  - `sessions_delete`: `using (student_id = auth.uid())`
  - `sessions_select_access`: `student_id = auth.uid() OR is_connected_teacher_of(student_id)`
- **代码逻辑检查** (`src/pages/Learning.jsx`):
  - **新增 (L370-434)**: `onSubmit` 正确使用了 `user.id` 作为 `student_id`。✅
  - **编辑 (L505-520)**: `onSaveEdit` 正确使用了 `user.id` 作为 `student_id`。✅
  - **删除 (L615-631)**: `onConfirmDelete` 执行的是软删除（`update ... set deleted_at`），触发 UPDATE 策略。RLS 会自动检查 `student_id = auth.uid()`，代码正确。✅
  - **查询**: `loadRecent` 查询自己的记录，符合 `student_id = auth.uid()` 策略。✅

### 3. 潜在风险
- **RLS 策略是否已部署**: 上述 RLS 策略必须在 Supabase 生产库中已部署。如果本地数据库（通过 seed 脚本）和生产数据库的 RLS 策略不一致，可能导致生产环境操作被拒绝。
- **错误提示**: 当 RLS 拒绝操作时，Supabase 会返回类似 "new row violates row-level security policy" 的错误。目前代码会用 `toast(err.message)` 显示，对普通用户不够友好，但功能上是安全的。

---

## 改动方案

### 改动 1：添加 Vercel 环境变量检查与友好提示
**文件**: `src/lib/supabase.js`
**操作**: 在 Supabase 客户端初始化后，增加一段检查逻辑。如果 URL 或 KEY 缺失（开发环境默认值是 `http://localhost:54321`），在控制台输出警告，提醒开发者在 Vercel 配置正确的环境变量。

```javascript
// 在 supabase.js 末尾添加
if (!import.meta.env.VITE_SUPABASE_URL || 
    import.meta.env.VITE_SUPABASE_URL.includes('localhost')) {
  console.warn('[DEPLOY WARNING] 检测到可能使用的是默认/本地 Supabase 配置。');
  console.warn('请在 Vercel Project Settings -> Environment Variables 中配置：');
  console.warn('  - VITE_SUPABASE_URL');
  console.warn('  - VITE_SUPABASE_ANON_KEY');
}
```

### 改动 2：优化 RLS 错误提示
**文件**: `src/pages/Learning.jsx`
**操作**: 在 `onSubmit`, `onSaveEdit`, `onConfirmDelete` 的 `catch` 块中，检测是否为 RLS 违规错误，并给出更友好的提示。

```javascript
// 替换现有的 catch 逻辑
catch (err) {
  let msg = err.message || '操作失败，请重试';
  if (msg.includes('row-level security')) {
    msg = '权限不足：您只能操作自己的学习记录。';
  }
  toast(msg, { kind: 'error' });
}
```

### 改动 3：生成 Vercel 部署指南
**操作**: 在项目根目录创建 `DEPLOY_VERCEL.md`（如果不存在），列出部署步骤和环境变量要求。

**内容大纲**:
1.  Vercel 项目导入步骤
2.  Environment Variables 配置清单 (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`)
3.  数据库迁移提醒（确保生产库有最新的 RLS 策略）
4.  构建与部署流程

---

## 不改动项

- **RLS 策略本身**: 代码逻辑已符合 RLS 要求，无需修改策略。
- **Supabase Schema**: 无需变更。

---

## 验证步骤

1.  **代码验证**: `npm run build` 通过。
2.  **手动测试（本地）**: 确保现有功能正常。
3.  **部署**: 推送到 GitHub，Vercel 自动部署。
4.  **线上验证**: 在 Vercel 生产环境测试完整流程（登录 -> 提交记录 -> 编辑 -> 删除）。
