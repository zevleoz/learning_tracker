# Vercel 部署指南

本文档将指导您将「一表人才」项目从本地开发环境部署到 Vercel 生产环境。

---

## 1. 前置条件

- **GitHub 账号**: 您需要一个 GitHub 账号来托管代码。
- **Vercel 账号**: 您需要一个 Vercel 账号（可以使用 GitHub 账号直接登录）。
- **Supabase 项目**: 您需要一个已创建的 Supabase 项目，且包含最新的数据库 Schema 和 RLS 策略。

---

## 2. 部署步骤

### 2.1. 推送代码到 GitHub

```bash
# 在项目根目录执行
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/<您的用户名>/<仓库名>.git
git push -u origin main
```

### 2.2. 在 Vercel 导入项目

1. 登录 [Vercel](https://vercel.com/)。
2. 点击右上角 **"Add New Project"**。
3. 选择您刚刚推送到 GitHub 的仓库。
4. 在 **Configure Project** 页面，保持默认设置（Framework Preset 应为 Vite）。
5. **重要**: 在 **Environment Variables** 部分，添加以下两个变量：
   - `VITE_SUPABASE_URL`: 您的 Supabase 项目 URL（例如 `https://xxxxxxxx.supabase.co`）
   - `VITE_SUPABASE_ANON_KEY`: 您的 Supabase 匿名公钥（Anon Key）
6. 点击 **"Deploy"**。

### 2.3. 配置环境变量（如果在第 2.2 步跳过）

如果部署后发现功能异常（如登录失败、数据无法加载），很可能是环境变量未正确配置。

**操作步骤**:
1. 在 Vercel 项目仪表盘，点击 **"Settings"** -> **"Environment Variables"**。
2. 添加 `VITE_SUPABASE_URL` 和 `VITE_SUPABASE_ANON_KEY`（值同 2.2）。
3. 选择环境为 **"Production"** 和 **"Preview"**。
4. 点击 **"Save"**。
5. 重新部署：回到 **"Deployments"** 页面，点击最新的部署记录，选择 **"Redeploy"**。

---

## 3. 数据库配置检查

在部署前，请确保您的 Supabase 生产数据库已包含最新的 Schema 和 RLS 策略。

### 3.1. 检查 RLS 策略

打开 Supabase Dashboard -> SQL Editor，执行以下查询：

```sql
select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
from pg_policies
where tablename = 'learning_sessions';
```

**预期结果**: 应该看到 `sessions_select_access`, `sessions_insert`, `sessions_update`, `sessions_delete` 四条策略。

如果没有，请在 SQL Editor 中执行 `supabase/schema.patch-check-policies.sql` 文件的内容来重建策略。

### 3.2. 检查表结构

确保 `learning_sessions` 表包含 `self_rating` 和 `grade_label` 字段（用于新的评价流程）。

```sql
select column_name, data_type
from information_schema.columns
where table_name = 'learning_sessions'
and column_name in ('self_rating', 'grade_label', 'score', 'eval_type');
```

---

## 4. 验证部署

部署完成后，请按以下步骤验证核心功能：

### 4.1. 学生端功能测试
1. **登录**: 使用学生账号登录。
2. **提交记录**: 填写一条学习记录（选择"练习"类别，主观+客观评价）。
3. **查看记录**: 确认记录出现在"最近记录"列表。
4. **编辑记录**: 点击编辑，修改客观评价后保存。
5. **删除记录**: 点击删除按钮，确认记录被标记为已删除。
6. **待补填**: 切换到"待补填"标签页，测试补填客观评价功能。

### 4.2. 导师端功能测试
1. **登录**: 使用导师账号登录。
2. **学生管理**: 查看学生列表，测试左右分屏布局。
3. **数据分析**: 切换时间维度（本周/近4周），确认面板能正常展开且不被截断。
4. **练习质量**: 查看练习质量分析面板，测试卡片详情弹窗。

---

## 5. 常见问题排查

### Q1: 登录后页面空白或提示"加载失败"
- **原因**: 环境变量未配置或 Supabase URL 错误。
- **解决**: 检查 Vercel 的 Environment Variables 设置，确保 URL 格式为 `https://xxxxxxxx.supabase.co`。

### Q2: 提交学习记录时报错"权限不足"
- **原因**: RLS 策略未部署到生产数据库。
- **解决**: 在 Supabase SQL Editor 执行 `schema.patch-check-policies.sql` 重建策略。

### Q3: 学生管理页数据不显示
- **原因**: `teacher_student_connections` 表可能不存在或 RLS 限制。
- **解决**: 运行 `schema.patch-invites.sql` 确保邀请表已创建，并检查 `profiles` 表的 RLS 策略。

### Q4: 页面样式错乱
- **原因**: Vite 构建产物未正确生成。
- **解决**: 在 Vercel Dashboard 点击 **"Redeploy"** 或清除缓存后重新部署。

---

## 6. 后续维护

- **代码更新**: 每次推送到 `main` 分支，Vercel 会自动触发新的部署。
- **环境变量变更**: 如果 Supabase 项目迁移或密钥泄露，请立即在 Vercel 更新环境变量并重新部署。
- **数据库迁移**: 运行新的 SQL 脚本前，请在测试环境验证，避免影响生产数据。
