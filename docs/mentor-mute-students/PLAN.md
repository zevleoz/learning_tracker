# 导师端：隐藏 / 暂停学生（测试账号不发消息、不提醒导师）

## 为什么 「待发」是空的

草稿只由定时任务 `runSupervisionJob`（api-lib/supervision.mjs，pg_cron 每 15 分钟）生成，不是每天每人一条：

- 上海时间 23:00–06:00 不跑（`inQuietHours`）。
- 首月学生：昨天没记才提醒（`NUDGE_GAP_FIRST_MONTH = 2`）；从没记过的，注册第 3 天起才提醒。
- 同一学生两次提醒至少隔 3 天（`NUDGE_MIN_INTERVAL_DAYS`），推迟 / 跳过过的也不再提醒。
- 每轮最多 15 条（`MAX_DRAFTS_PER_RUN`）。

所以页面上「要跟进 13 人、待发 0 条」多半是规则判定为「这一轮不需要发」，不是故障。
**未验证**：我没有连数据库，无法确认 Sean 等人这轮为什么没出草稿。确认方法：查 `supervision_drafts` 里这些学生最近一条的 `status / handled_at / created_at`，以及 pg_cron 那边 `run` 的返回值（`summary.skipped`）。

## 目标

1. 每个学生行可以「隐藏」或「暂停 3 / 5 / 7 天」，也可以「恢复」。
2. 被隐藏 / 暂停的学生：不生成草稿、不提醒导师、从「今天」和「这周谁记了」的主列表移走，放进折叠的「已隐藏 N」。
3. 测试账号用「隐藏」即可，永久生效，不需要单独做测试标记。
4. UI 保持现状：只在行尾加一个操作入口（小按钮 / 右键菜单），不改版（见 [[mentor-ui-minimal-change]]）。

## 方案（选最省 token 的一条）

**数据：一张新表 `supervision_mutes`**，一人最多一行，不改 profiles / e4_students。

```sql
create table if not exists public.supervision_mutes (
  student_id uuid primary key references public.profiles(id) on delete cascade,
  mode       text not null check (mode in ('hidden', 'snoozed')),
  until      date,                       -- snoozed 时必填；hidden 为 null
  reason     text,                       -- 可选：'test' 等
  set_by     uuid references public.profiles(id),
  set_at     timestamptz not null default now()
);
-- RLS：导师角色可 select / insert / update / delete（与 supervision_drafts 的策略同款）
```

有效判定：`mode = 'hidden'` 或 `mode = 'snoozed' and until >= today`。

**为什么不用 profiles 加列：** profiles 的 RLS 和 upsert 逻辑（008 / 005 迁移）已经很绕，单开一张表不碰它们。

**后端（一处改动）：** `runSupervisionJob` 开始时多读一次 `supervision_mutes`（一个 GET），把有效的学生从 `students` 里滤掉；同时把这些学生名下 `status='draft'` 的行置为 `dropped`（复用已有的 `dropRows`，原因写 `DROP_MUTED`）。这样不用在每个生成分支里各判一次。

**前端：**
- 一个小 hook `useMutes`：读一次表，返回 `mutes`、`hide(id)`、`snooze(id, days)`、`restore(id)`，全部直接用 supabase 客户端（不新增 API 端点）。
- `WeekBoard` 和「今天」队列按 `mutes` 过滤；底部加一行「已隐藏 N 人」折叠，展开可恢复。
- 行尾一个 `⋯` 按钮，菜单：隐藏 / 暂停 3 天 / 5 天 / 7 天。右键同一个菜单（`onContextMenu`）。
- 暂停的学生在行上显示「再看：MM-DD」。

## 拆分（两个可以并行，文件不重叠）

先固定合同：表名 `supervision_mutes`、字段如上、过滤规则如上。之后：

| 任务 | 文件 | 建议模型 |
|---|---|---|
| A. 迁移 SQL + 后端过滤 + 丢弃草稿 + 单元测试 | `supabase/migrations/011-supervision-mutes.sql`，`api-lib/supervision.mjs`，`__tests__/supervision*.test.*` | Sonnet（逻辑小，但要守住 quiet hours / 一人一草稿不变量） |
| B. `useMutes` + 行菜单 + 折叠区 + 过滤 | `src/components/mentor/useMutes.js`（新），`WeekBoard.jsx`，`MessageQueue.jsx`，`src/pages/Mentor.jsx` 接线，`__tests__/mentorTracker.test.jsx` | Haiku（组件小，照现有 MessageCard 的写法） |

两个任务都不 push，只留在工作区。注意 `src/pages/Mentor.jsx` 现在有未提交的改动（13 行），B 动它之前先确认这些改动要不要保留。最后由你决定谁来审合并。

## 验收

- 测试账号设为「隐藏」后：下一轮 job 不再生成它的草稿；已有草稿变 `dropped`；页面里它进「已隐藏」。
- 「暂停 3 天」到期后（`until < today`）自动回到主列表，且 job 可以再出草稿。
- 恢复后立即回到主列表。
- 普通学生的行为不变（回归：`mentorTracker.test.jsx`、`mentorMessageCard.test.jsx` 全绿）。

## 不做的事

- 不改草稿生成的提醒规则本身。
- 不做批量操作，先做单人。
- 不加测试标记字段（隐藏已经能覆盖测试账号）。
