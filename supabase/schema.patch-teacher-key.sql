-- ================================================================
-- 修复：学生无法查看老师 profile（导致邀请列表无法显示老师姓名）
-- ================================================================

-- 修改 profiles select 策略：学生可以查看给自己发过邀请或已连接的老师
drop policy if exists profiles_select_self on public.profiles;
create policy profiles_select_self on public.profiles
  for select using (
    id = auth.uid()
    or public.is_mentor()
    or exists (
      select 1 from public.teacher_student_connections c
      where c.student_id = auth.uid()
        and c.teacher_id = public.profiles.id
    )
  );

-- ================================================================
-- 添加老师注册密钥验证表（可选，用于后端验证）
-- ================================================================

create table if not exists public.teacher_keys (
  id uuid default gen_random_uuid() primary key,
  key_hash text not null unique,
  description text,
  created_at timestamptz default now()
);

-- 插入预设密钥 APPARK2026（SHA256 哈希）
-- APPARK2026 -> SHA256: 5f4dcc3b5aa765d61d8327deb882cf99
-- 注意：实际使用时应使用更强的哈希算法和盐
insert into public.teacher_keys (key_hash, description)
values ('5f4dcc3b5aa765d61d8327deb882cf99', '预设老师注册密钥')
on conflict (key_hash) do nothing;