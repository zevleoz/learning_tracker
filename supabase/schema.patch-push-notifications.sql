-- ================================================================
-- Web Push 通知：订阅表、提醒偏好、每日发送记录
--   * 幂等：可重复运行，不删除任何现有数据
--   * ★ 未执行：请人工在 Supabase SQL Editor 运行（先在测试项目验证）
--   * 服务端（/api/notify）用 service role 访问，绕过 RLS；前端只能读写自己的订阅
-- ================================================================

-- ----------------------------------------------------------------
-- 1) push_subscriptions：一台设备/浏览器一条（endpoint 唯一）
-- ----------------------------------------------------------------
create table if not exists public.push_subscriptions (
  id uuid default gen_random_uuid() primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);

create index if not exists push_subscriptions_user_idx
  on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;

drop policy if exists push_subs_select_own on public.push_subscriptions;
create policy push_subs_select_own on public.push_subscriptions
  for select using (user_id = auth.uid());

drop policy if exists push_subs_insert_own on public.push_subscriptions;
create policy push_subs_insert_own on public.push_subscriptions
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists push_subs_update_own on public.push_subscriptions;
create policy push_subs_update_own on public.push_subscriptions
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists push_subs_delete_own on public.push_subscriptions;
create policy push_subs_delete_own on public.push_subscriptions
  for delete to authenticated using (user_id = auth.uid());

-- 同一台设备换账号登录时，endpoint 已属于上一个账号，普通 upsert 会被 RLS 拒绝。
-- 这个函数以当前登录用户的身份「认领」该 endpoint（仅能写给自己）。
create or replace function public.register_push_subscription(
  p_endpoint text,
  p_p256dh text,
  p_auth text,
  p_user_agent text default null
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, user_agent, last_used_at)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth, p_user_agent, now())
  on conflict (endpoint) do update
    set user_id = excluded.user_id,
        p256dh = excluded.p256dh,
        auth = excluded.auth,
        user_agent = excluded.user_agent,
        last_used_at = now();
end;
$$;

revoke all on function public.register_push_subscription(text, text, text, text) from public, anon;
grant execute on function public.register_push_subscription(text, text, text, text) to authenticated;

-- ----------------------------------------------------------------
-- 2) profiles.notification_prefs：提醒偏好（缺省值见 DEFAULT）
--    inactive_reminder（几天没记录）默认开；daily_reminder（每日提醒）默认关，
--    但注册后前 30 天由服务端强制开启（看 profiles.created_at，不看这个值）；invites 默认开。
--    push_card_dismissed：今天页的「开启提醒」小卡片点了「不用」。
--    旧版的 pending_digest / streak_reminder / weekly_email 已移除，库里残留的旧键会被忽略。
--    已有该列的库：只更新默认值（幂等），不改现有行。
-- ----------------------------------------------------------------
alter table public.profiles
  add column if not exists notification_prefs jsonb not null default '{
    "inactive_reminder": true,
    "daily_reminder": false,
    "daily_reminder_time": "21:00",
    "invites": true
  }'::jsonb;

alter table public.profiles
  alter column notification_prefs set default '{
    "inactive_reminder": true,
    "daily_reminder": false,
    "daily_reminder_time": "21:00",
    "invites": true
  }'::jsonb;

-- ----------------------------------------------------------------
-- 3) push_deliveries：每天每位学生最多一条「非邀请」推送
--    部分唯一索引 = 并发安全的每日上限；邀请记录不受限（仅留痕）
--    几天没记录（kind='inactive'）的已发次数也从这里推算：sent_date 晚于学生最后记录日期的行
--    仅 service role 访问：启用 RLS 且不建任何策略
-- ----------------------------------------------------------------
create table if not exists public.push_deliveries (
  id uuid default gen_random_uuid() primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  sent_date date not null,            -- Asia/Shanghai 日期
  kind text not null,                 -- inactive / daily / invite（历史行可能还有 digest / streak）
  created_at timestamptz not null default now()
);

create unique index if not exists push_deliveries_one_per_day
  on public.push_deliveries (user_id, sent_date)
  where kind <> 'invite';

alter table public.push_deliveries enable row level security;

-- 可选清理（建议配合 pg_cron 每周一次）：
-- delete from public.push_deliveries where sent_date < current_date - 30;

-- ================================================================
-- 以下为示例，均已注释，不会被执行。把 <...> 换成真实值后手动运行。
-- ================================================================

-- ----------------------------------------------------------------
-- A) 每 15 分钟轮询 /api/notify（需先启用扩展 pg_cron 与 pg_net）
--    NOTIFY_SECRET 与 Vercel 环境变量一致；不要把真实值提交进仓库。
-- ----------------------------------------------------------------
-- create extension if not exists pg_cron;
-- create extension if not exists pg_net;
--
-- select cron.schedule(
--   'yb-notify-tick',
--   '*/15 * * * *',
--   $$
--   select net.http_post(
--     url     := 'https://<your-domain>/api/notify',
--     headers := jsonb_build_object(
--       'Content-Type', 'application/json',
--       'x-notify-secret', '<NOTIFY_SECRET>'
--     ),
--     body    := '{"type":"tick"}'::jsonb
--   );
--   $$
-- );
-- -- 取消：select cron.unschedule('yb-notify-tick');

-- ----------------------------------------------------------------
-- B) 新邀请即时推送：teacher_student_connections 新增 pending 行时通知学生
--    方式一（推荐）：Supabase 控制台 Database → Webhooks → 新建
--      Table: teacher_student_connections   Events: Insert
--      Type: HTTP Request  Method: POST  URL: https://<your-domain>/api/notify
--      Headers: x-notify-secret = <NOTIFY_SECRET>, Content-Type = application/json
--      （/api/notify 能直接识别 Webhook 载荷，仅处理 status = 0 的 INSERT）
--
--    方式二：用触发器 + pg_net
-- ----------------------------------------------------------------
-- create or replace function public.notify_new_invite() returns trigger
-- language plpgsql security definer set search_path = public as $$
-- begin
--   if new.status = 0 then
--     perform net.http_post(
--       url     := 'https://<your-domain>/api/notify',
--       headers := jsonb_build_object(
--         'Content-Type', 'application/json',
--         'x-notify-secret', '<NOTIFY_SECRET>'
--       ),
--       body    := jsonb_build_object(
--         'type', 'invite',
--         'student_id', new.student_id,
--         'teacher_id', new.teacher_id
--       )
--     );
--   end if;
--   return new;
-- end;
-- $$;
--
-- drop trigger if exists trg_notify_new_invite on public.teacher_student_connections;
-- create trigger trg_notify_new_invite
--   after insert on public.teacher_student_connections
--   for each row execute function public.notify_new_invite();
