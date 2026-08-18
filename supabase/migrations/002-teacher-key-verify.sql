-- ================================================================
-- TEACHER KEY VERIFICATION MIGRATION
-- 将老师注册密钥从前端明文比对改为后端哈希校验
-- ================================================================

-- ================================================================
-- PART 1: 启用 pgcrypto 扩展（用于 SHA256 计算）
-- ================================================================
create extension if not exists pgcrypto;

-- ================================================================
-- PART 2: 创建 teacher_keys 表（如不存在）
-- ================================================================
create table if not exists public.teacher_keys (
  id uuid default gen_random_uuid() primary key,
  key_hash text not null unique,
  description text,
  created_at timestamptz default now()
);

-- 开启 RLS：禁止前端直接读这张表（避免哈希被枚举）
alter table public.teacher_keys enable row level security;
drop policy if exists teacher_keys_select on public.teacher_keys;
drop policy if exists teacher_keys_insert on public.teacher_keys;
-- 不创建任何 select/insert 策略 = 任何前端用户都无法访问

-- ================================================================
-- PART 3: 清理旧错误数据，插入正确的密钥哈希
-- ================================================================

-- 清掉旧的错误数据（password 的 MD5，并非 APPARK2026 的 SHA256）
delete from public.teacher_keys
where key_hash = '5f4dcc3b5aa765d61d8327deb882cf99';

-- 插入正确的 APPARK2026 的 SHA256
-- SHA256('APPARK2026') = c17bb61a97a6ea871759bf21fdb28ba2022b4b9986338c8ae5c08aea2ebf61d6
insert into public.teacher_keys (key_hash, description)
values (
  encode(digest('APPARK2026', 'sha256'), 'hex'),
  '预设老师注册密钥 APPARK2026'
)
on conflict (key_hash) do nothing;

-- ================================================================
-- PART 4: 创建校验 RPC 函数
-- 客户端传明文，服务端算哈希后比对
-- ================================================================
create or replace function public.verify_teacher_key(key_text text)
returns boolean
language sql security definer as $$
  select exists (
    select 1 from public.teacher_keys
    where key_hash = encode(digest(key_text, 'sha256'), 'hex')
  );
$$;

-- 权限：匿名 + 已登录用户都能调用（注册时还没登录）
revoke all on function public.verify_teacher_key(text) from public;
grant execute on function public.verify_teacher_key(text) to anon, authenticated;

-- ================================================================
-- PART 5: 验证
-- ================================================================
select '✅ Teacher key verification migration completed' as result;
select '🔑 预置密钥 APPARK2026 已写入（哈希存储）' as info;
select '📡 RPC: public.verify_teacher_key(text) -> boolean' as info;
select '🧪 自测 verify_teacher_key(''APPARK2026''): ' || public.verify_teacher_key('APPARK2026') as test_correct;
select '🧪 自测 verify_teacher_key(''wrong''): ' || public.verify_teacher_key('wrong') as test_wrong;
