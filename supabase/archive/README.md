# supabase/archive —— 历史 schema 补丁（只读存档）

这里的 30 个文件是 2026 年早期手工执行的 schema 补丁与种子数据（`schema.patch-*.sql`、
`schema.sql`、`schema.v2.sql`、`seed_*.sql`）。它们记录的是**当时的**数据库状态，
互相之间存在覆盖关系（例如 metadata→role 同步触发器在后续补丁中被反复重建/删除）。

**不再从这里执行任何 SQL。** 权威来源是：

- `supabase/migrations/*.sql` —— 之后所有变更一律新增迁移文件，按序号执行；
- 生产库的真实状态以数据库为准（见下方「导出基线」）。

## 迁移执行清单（按序号，幂等，可在 SQL Editor 整段执行）

| 文件 | 用途 |
|---|---|
| `001-production-setup.sql` | 生产环境基础配置 |
| `002-teacher-key-verify.sql` | 教师注册密钥改为服务端哈希校验 |
| `003-e4-reports-delete-policy.sql` | e4_reports 删除策略 |
| `004-enable-realtime-sessions.sql` | learning_sessions realtime |
| `005-role-security-consolidation.sql` | **SEC-6** 关闭 metadata→role 提权链（含审计与验证 SQL） |
| `006-e4-growth-maps-storage.sql` | **FEAT-1** 成长地图私有 bucket + RLS |
| `007-e4-students-archive.sql` | **E4-2** 学生软归档（archived_at + 归档/恢复 RPC） |

## 导出基线（DEBT-3，由产品方执行一次）

```bash
# 方式 A：Supabase CLI
supabase db dump --db-url "$SUPABASE_DB_URL" -f supabase/migrations/000-baseline.sql

# 方式 B：pg_dump（在本地有直连串时）
pg_dump "$SUPABASE_DB_URL" --schema=public --schema=storage --no-owner --no-privileges \
  -f supabase/migrations/000-baseline.sql
```

导出后把 `000-baseline.sql` 顶部的注释改为「以本文件为当前生产快照，之后变更走迁移」。

## 已废弃表（DEBT-4，基线里保留数据并标注 deprecated）

全仓检索确认基本不再读写：`concepts`、`student_courses`、`daily_checkins`、
`mentor_feedback`、`signals`。在基线文件中给这些表加
`comment on table public.<name> is 'deprecated: 历史遗留，暂不删除';`。