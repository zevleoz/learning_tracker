-- ================================================================
-- schema.patch.sql — 专门修复"注册失败 failed to fetch"（无限递归）问题
--
-- 使用方法：在 Supabase Dashboard → SQL Editor 里整段执行一次即可。
-- 会把旧的有问题的 policy / function 清理掉，重新装上 is_mentor() 版本。
-- ================================================================

-- 1) 先建 is_mentor()：SECURITY DEFINER，在特权 context 里读 profiles，不破环递归
create or replace function public.is_mentor() returns boolean
language plpgsql security definer set search_path = public as $$
begin
    if current_setting('request.jwt.claims', true) is not null then
        if coalesce(
            current_setting('request.jwt.claims', true)::json -> 'app_metadata'  ->> 'role',
            current_setting('request.jwt.claims', true)::json -> 'user_metadata' ->> 'role',
            ''
        ) = 'mentor'
        then
            return true;
        end if;
    end if;

    if auth.uid() is null then return false; end if;
    return exists (
        select 1 from public.profiles
        where id = auth.uid() and role = 'mentor'::app_role
    );
end;
$$;

-- 2) 确保 profiles / 其它表 RLS 已开（如果之前 schema.sql 跑过，这里不会报错）
alter table public.profiles           enable row level security;
alter table public.subjects           enable row level security;
alter table public.chapters           enable row level security;
alter table public.check_ins          enable row level security;
alter table public.learning_sessions  enable row level security;
alter table public.mentor_feedback    enable row level security;
alter table public.push_subscriptions enable row level security;

-- 3) 删除旧 policy（用 do$$ 避免不存在时抛错；pg_policies 的列是 schemaname/tablename/policyname）
do $$
declare
    pol record;
begin
    for pol in
        select schemaname as s, tablename as t, policyname as n
        from pg_policies
        where schemaname = 'public'
          and tablename in ('profiles','subjects','chapters','check_ins','learning_sessions','mentor_feedback','push_subscriptions')
    loop
        execute format('drop policy if exists %I on %I.%I', pol.n, pol.s, pol.t);
    end loop;
end $$;

-- 4) 重新写入不递归的新 policy
create policy "profiles_select_self_or_mentor"
    on public.profiles for select
    using ( id = auth.uid() or public.is_mentor() );

create policy "profiles_update_self"
    on public.profiles for update
    using ( id = auth.uid() );

create policy "subjects_owner_all"
    on public.subjects for all
    using ( owner_id = auth.uid() );

create policy "subjects_mentor_read"
    on public.subjects for select
    using ( public.is_mentor() );

create policy "chapters_owner_all"
    on public.chapters for all
    using ( exists (select 1 from public.subjects s where s.id = chapters.subject_id and s.owner_id = auth.uid()) );

create policy "chapters_mentor_read"
    on public.chapters for select
    using ( public.is_mentor() );

create policy "check_ins_self_write"
    on public.check_ins for all
    using ( student_id = auth.uid() );

create policy "check_ins_mentor_read"
    on public.check_ins for select
    using ( public.is_mentor() );

create policy "sessions_self_write"
    on public.learning_sessions for all
    using ( student_id = auth.uid() );

create policy "sessions_mentor_read"
    on public.learning_sessions for select
    using ( public.is_mentor() );

create policy "feedback_mentor_write"
    on public.mentor_feedback for insert
    with check ( public.is_mentor() );

create policy "feedback_read_relevant"
    on public.mentor_feedback for select
    using ( student_id = auth.uid() or mentor_id = auth.uid() or public.is_mentor() );

create policy "push_self_all"
    on public.push_subscriptions for all
    using ( user_id = auth.uid() );

-- 5) 如果 handle_new_user 触发器还没装，这里补一份（防止 schema.sql 被跳过）
create or replace function public.handle_new_user()
returns trigger as $$
begin
    insert into public.profiles (id, email, display_name, role, created_at)
    values (
        new.id,
        new.email,
        coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)),
        coalesce((new.raw_user_meta_data->>'role')::public.app_role, 'student'::public.app_role),
        now()
    )
    on conflict (id) do nothing;
    return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
    after insert on auth.users
    for each row execute function public.handle_new_user();
