-- ================================================================
-- 010 学生头像
--   私有 bucket：avatars；路径约定 {user_id}/avatar-{时间戳}.jpg
--   仅本人可读、写、删（导师不可见）；前端用 createSignedUrl 生成短时链接。
--   profiles.avatar_path 保存 bucket 内路径。
-- 由用户在 Supabase Dashboard → SQL Editor 整段执行（幂等，可重复运行）。
-- 未执行时前端只隐藏头像，不影响其它资料。
-- ================================================================

insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', false)
on conflict (id) do nothing;

drop policy if exists avatars_owner_select on storage.objects;
create policy avatars_owner_select on storage.objects
  for select to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists avatars_owner_insert on storage.objects;
create policy avatars_owner_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists avatars_owner_update on storage.objects;
create policy avatars_owner_update on storage.objects
  for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists avatars_owner_delete on storage.objects;
create policy avatars_owner_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

alter table public.profiles
  add column if not exists avatar_path text;

-- 验证：bucket 与列都已创建
select
  case when exists (select 1 from storage.buckets where id = 'avatars')
       then 'PASS bucket 已创建' else 'FAIL bucket 缺失' end as check_1,
  case when exists (select 1 from information_schema.columns
                    where table_schema = 'public' and table_name = 'profiles' and column_name = 'avatar_path')
       then 'PASS avatar_path 已创建' else 'FAIL avatar_path 缺失' end as check_2;
