-- ================================================================
-- AI 监督流程 v2：消息草稿表 supervision_drafts 升级
-- 可重复执行（幂等）。在 Supabase SQL Editor 里整段运行（生产库只有一个，运行前确认项目）。
--
-- 运行顺序：
--   1) 先确认 schema.patch-supervision.sql（v1 建表）已经执行过；本补丁只改它，不建表
--   2) 在 Supabase SQL Editor 运行本文件（整段，一次）
--   3) 然后才能部署新的服务端（api/supervision）和新的客户端（学生管理首页 / 学生页）
--      ——新客户端会写 snooze_until / skip_reason，新服务端会写 kind = 'nudge'、
--      status = 'snoozed' / 'dropped'、meta；这些在本补丁之前都会被数据库拒绝
--   4) 回滚：见文末（旧客户端不受本补丁影响，补丁只放宽，不收紧已有数据）
--
-- 改了什么：
--   · kind 多一个 'nudge'（温和提醒）；status 多 'snoozed'（过几天再说）和 'dropped'（系统撤下）
--   · 新列 snooze_until（几号再出现）、skip_reason（跳过的原因）、meta（服务端写的说明，客户端不可改）
--   · 一个 (student_id, created_at desc) 索引，给学生页的历史和「最近一次提醒」用
--   · 客户端可更新的列增加 snooze_until、skip_reason；meta 仍然只有服务端（service role）能写
--   · 约束：status = 'snoozed' 时必须有 snooze_until
--   · 已有数据全部保持有效（只放宽取值，没有改任何一行）
-- ================================================================

-- ----------------------------------------------------------------
-- 1) 重建 kind / status 的 check 约束
--    v1 用的是建表时的行内 check，名字由 Postgres 自动生成，所以不能写死名字：
--    从 pg_constraint 里找出「只约束 kind」或「只约束 status」的 check，删掉后重建。
--    删与建在同一个 DO 块里，是一个事务，中途不会出现没有约束的瞬间。
--    重复执行时：上次建的约束也只约束单列，会被同样找到、删掉、再建回，结果不变。
-- ----------------------------------------------------------------
do $$
declare
  rel     constant regclass := 'public.supervision_drafts'::regclass;
  col_kind   smallint;
  col_status smallint;
  c record;
begin
  select attnum into col_kind   from pg_attribute where attrelid = rel and attname = 'kind'   and not attisdropped;
  select attnum into col_status from pg_attribute where attrelid = rel and attname = 'status' and not attisdropped;

  for c in
    select conname from pg_constraint
    where conrelid = rel and contype = 'c'
      and (conkey = array[col_kind] or conkey = array[col_status])
  loop
    execute format('alter table public.supervision_drafts drop constraint %I', c.conname);
  end loop;

  alter table public.supervision_drafts
    add constraint supervision_drafts_kind_check
    check (kind in ('daily', 'weekly', 'nudge'));
  alter table public.supervision_drafts
    add constraint supervision_drafts_status_check
    check (status in ('draft', 'sent', 'snoozed', 'skipped', 'dropped'));
end
$$;

-- ----------------------------------------------------------------
-- 2) 新列
-- ----------------------------------------------------------------
alter table public.supervision_drafts add column if not exists snooze_until date;
alter table public.supervision_drafts add column if not exists skip_reason  text;
-- meta：why / facts / alts / lint / nudge / system_push_date / recommend_snooze / from_snooze / drop_reason
--       只由服务端写入（客户端没有这一列的 update 权限）
alter table public.supervision_drafts add column if not exists meta jsonb not null default '{}'::jsonb;

-- status = 'snoozed' 必须有 snooze_until（已有行都不是 snoozed，加上即生效）
alter table public.supervision_drafts drop constraint if exists supervision_drafts_snoozed_has_date;
alter table public.supervision_drafts
  add constraint supervision_drafts_snoozed_has_date
  check (status <> 'snoozed' or snooze_until is not null);

-- ----------------------------------------------------------------
-- 3) 索引
-- ----------------------------------------------------------------
create index if not exists supervision_drafts_student_created
  on public.supervision_drafts (student_id, created_at desc);

-- ----------------------------------------------------------------
-- 4) 权限：客户端可更新的列。meta 不在其中，仍是服务端专属。
--    RLS 的 select / update policy 不变（仍是「已连接的导师」）。
-- ----------------------------------------------------------------
revoke update on public.supervision_drafts from authenticated;
grant update (edited_body, status, handled_by, handled_at, snooze_until, skip_reason)
  on public.supervision_drafts to authenticated;

-- ================================================================
-- 回滚（仅在需要时手动运行；已有 nudge / snoozed / dropped 行时要先处理，否则收紧约束会失败）：
--   update public.supervision_drafts set status = 'skipped' where status in ('snoozed', 'dropped');
--   delete from public.supervision_drafts where kind = 'nudge';
--   alter table public.supervision_drafts drop constraint supervision_drafts_snoozed_has_date;
--   -- 然后把 supervision_drafts_kind_check / _status_check 换回 v1 的取值，
--   -- 并把 grant update 改回 (edited_body, status, handled_by, handled_at)
-- 新增的三列和索引留着无害，不必删除。
-- ================================================================
