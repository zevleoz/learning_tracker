-- ================================================================
-- AI 监督流程：导师草稿表 supervision_drafts
-- 可重复执行（幂等）。在 Supabase SQL Editor 里整段运行。
--
-- 谁写：
--   · 草稿的创建与「重新生成」只走服务端（/api/supervision，用 service role，绕过 RLS）
--   · 已连接的导师只能读，并且只能改 edited_body / status / handled_by / handled_at 四列
--   · 学生零访问：没有任何学生相关的 policy
-- 依赖：public.profiles、public.is_connected_teacher_of()（migrations/001-production-setup.sql）
-- ================================================================

-- 通用 updated_at 触发器（E4 补丁里已有同样的函数；这里重复定义是无害的）
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.supervision_drafts (
  id           uuid primary key default gen_random_uuid(),
  student_id   uuid not null references public.profiles(id) on delete cascade,
  kind         varchar(8) not null check (kind in ('daily', 'weekly')),
  period_start date not null,
  period_end   date not null,
  body         text not null,                 -- AI 原稿
  edited_body  text,                          -- 导师改过的版本
  evidence     jsonb not null default '[]'::jsonb, -- 引用的记录 id
  model        varchar(64),
  status       varchar(8) not null default 'draft' check (status in ('draft', 'sent', 'skipped')),
  handled_by   uuid references public.profiles(id) on delete set null,
  handled_at   timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (student_id, kind, period_start)
);
create index if not exists supervision_drafts_period on public.supervision_drafts (period_start desc);

drop trigger if exists supervision_drafts_updated on public.supervision_drafts;
create trigger supervision_drafts_updated before update on public.supervision_drafts
  for each row execute function public.set_updated_at();

alter table public.supervision_drafts enable row level security;
drop policy if exists sd_select on public.supervision_drafts;
create policy sd_select on public.supervision_drafts for select
  using (public.is_connected_teacher_of(student_id));
drop policy if exists sd_update on public.supervision_drafts;
create policy sd_update on public.supervision_drafts for update
  using (public.is_connected_teacher_of(student_id))
  with check (public.is_connected_teacher_of(student_id));
-- 客户端只能改这几列；插入和重新生成只走服务端（service role）
revoke update on public.supervision_drafts from authenticated;
grant update (edited_body, status, handled_by, handled_at) on public.supervision_drafts to authenticated;
-- 学生零访问：没有学生相关的 policy。

-- ================================================================
-- 以下为示例，已注释，不会被执行。把 <...> 换成真实值后手动运行。
-- ================================================================

-- ----------------------------------------------------------------
-- 每 15 分钟触发一次草稿生成（需先启用 pg_cron 与 pg_net）
--   · 任务自己会跳过上海时间 23:00–06:00，并且重复触发是安全的（唯一键兜底）
--   · NOTIFY_SECRET 与 Vercel 环境变量一致；不要把真实值提交进仓库
-- ----------------------------------------------------------------
-- create extension if not exists pg_cron;
-- create extension if not exists pg_net;
--
-- select cron.schedule(
--   'yb-supervision-tick',
--   '*/15 * * * *',
--   $$
--   select net.http_post(
--     url     := 'https://<your-domain>/api/supervision',
--     headers := jsonb_build_object(
--       'Content-Type', 'application/json',
--       'x-notify-secret', '<NOTIFY_SECRET>'
--     ),
--     body    := '{"type":"run"}'::jsonb
--   );
--   $$
-- );
-- -- 取消：select cron.unschedule('yb-supervision-tick');
