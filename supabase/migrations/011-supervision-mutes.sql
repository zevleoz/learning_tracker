-- ================================================================
-- 011 导师端：隐藏 / 暂停学生（测试账号不发消息、不提醒导师）
-- ================================================================
-- 一人最多一行：
--   mode = 'hidden'   永久生效（until 为 null）
--   mode = 'snoozed'  到 until（含）为止；until < 今天 自动失效
--
-- 生效时：
--   · 定时任务 runSupervisionJob 不为这位学生生成任何草稿，
--     名下仍是 draft / snoozed 的草稿会被撤下（meta.drop_reason = 已隐藏 / 暂停）
--   · 导师端「今天」和「这周谁记了」把他移入折叠的「已隐藏」，可恢复
--
-- 可重复执行（幂等）。依赖：public.profiles、public.is_connected_teacher_of()（001 / 008）
-- ================================================================

create table if not exists public.supervision_mutes (
  student_id uuid primary key references public.profiles(id) on delete cascade,
  mode       text not null check (mode in ('hidden', 'snoozed')),
  until      date,                                        -- snoozed 时必填；hidden 为 null
  reason     text,                                        -- 可选：'test' 等
  set_by     uuid references public.profiles(id) on delete set null,
  set_at     timestamptz not null default now(),
  constraint supervision_mutes_snoozed_until
    check (mode <> 'snoozed' or until is not null),
  constraint supervision_mutes_hidden_until
    check (mode <> 'hidden' or until is null)
);

alter table public.supervision_mutes enable row level security;

-- 与 supervision_drafts 同款：只有这位学生的已连接导师（且 role >= 2）能读写
drop policy if exists sm_select on public.supervision_mutes;
create policy sm_select on public.supervision_mutes for select
  using (public.is_connected_teacher_of(student_id));

drop policy if exists sm_insert on public.supervision_mutes;
create policy sm_insert on public.supervision_mutes for insert to authenticated
  with check (public.is_connected_teacher_of(student_id));

drop policy if exists sm_update on public.supervision_mutes;
create policy sm_update on public.supervision_mutes for update
  using (public.is_connected_teacher_of(student_id))
  with check (public.is_connected_teacher_of(student_id));

drop policy if exists sm_delete on public.supervision_mutes;
create policy sm_delete on public.supervision_mutes for delete
  using (public.is_connected_teacher_of(student_id));

-- 学生零访问：没有学生相关的 policy；再把多余的表权限收掉（RLS 之外的第二道门）
revoke all on public.supervision_mutes from anon;
grant select, insert, update, delete on public.supervision_mutes to authenticated;

-- ================================================================
-- 执行结果（把这里的输出贴回即可判断是否成功）
-- ================================================================
select 'check_1 supervision_mutes 表是否已建（应为 1 行）' as item,
       case when to_regclass('public.supervision_mutes') is null then 'FAIL' else 'PASS' end as detail;

select 'check_2 策略数量（应为 4 行）' as item,
       count(*)::text as detail
  from pg_policies
  where schemaname = 'public' and tablename = 'supervision_mutes'
    and policyname in ('sm_select', 'sm_insert', 'sm_update', 'sm_delete');
