-- ================================================================
-- 006 成长地图 PDF 落库（FEAT-1）
-- 私有 bucket：e4-growth-maps
--   路径约定：{e4_student_id}/{report_id}/{filename}
--   仅导师及以上（public.is_mentor()）可读、写、删；
--   前端通过 createSignedUrl 生成短时下载/预览链接。
-- 由用户在 Supabase Dashboard → SQL Editor 整段执行（幂等，可重复运行）。
-- ================================================================

insert into storage.buckets (id, name, public)
values ('e4-growth-maps', 'e4-growth-maps', false)
on conflict (id) do nothing;

drop policy if exists e4_growth_maps_select on storage.objects;
create policy e4_growth_maps_select on storage.objects
  for select to authenticated
  using (bucket_id = 'e4-growth-maps' and public.is_mentor());

drop policy if exists e4_growth_maps_insert on storage.objects;
create policy e4_growth_maps_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'e4-growth-maps' and public.is_mentor());

drop policy if exists e4_growth_maps_update on storage.objects;
create policy e4_growth_maps_update on storage.objects
  for update to authenticated
  using (bucket_id = 'e4-growth-maps' and public.is_mentor())
  with check (bucket_id = 'e4-growth-maps' and public.is_mentor());

drop policy if exists e4_growth_maps_delete on storage.objects;
create policy e4_growth_maps_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'e4-growth-maps' and public.is_mentor());

-- 验证：bucket 存在
select case when exists (select 1 from storage.buckets where id = 'e4-growth-maps')
            then 'PASS bucket 已创建'
            else 'FAIL bucket 缺失' end as check_1;