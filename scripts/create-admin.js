import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://rkmspodctprrwmeiteos.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJrbXNwb2RjdHBycndtZWl0ZW9zIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE3NTcxNDcsImV4cCI6MjA5NzMzMzE0N30.hmV09hgpQ2xcO6PoTJqhuQGvRErxbHuQ76w-Y65p0ZM';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const ADMIN_EMAIL = 'admin@yibc.com';
const ADMIN_PASSWORD = 'Admin@2026!';

async function createAdmin() {
  console.log('Creating super admin (role=3) account...');

  try {
    // 1. signUp：role 写入 user_metadata，触发 handle_new_user 插入 profiles
    const { error: signUpError } = await supabase.auth.signUp({
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
      options: {
        data: {
          full_name: '超级管理员',
          school_name: '',
          role: 3,
        }
      }
    });

    if (signUpError) {
      console.log('Sign up error (may already exist):', signUpError.message);
    } else {
      console.log('Sign up OK');
    }

    // 2. 登录拿 session
    const { data: sessionData, error: signInError } = await supabase.auth.signInWithPassword({
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
    });

    if (signInError) {
      console.error('Sign in error:', signInError.message);
      return;
    }

    const uid = sessionData?.user?.id;
    console.log('User ID:', uid);

    if (uid) {
      // 3. upsert profiles 为 role=3（role 相同，guard 触发器允许）
      const { error: upsertError } = await supabase.from('profiles').upsert({
        id: uid,
        full_name: '超级管理员',
        school_name: '',
        role: 3,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'id' });

      if (upsertError) {
        console.error('Profile upsert error:', upsertError.message);
      } else {
        console.log('Profile upsert OK (role=3)');
      }

      // 4. 校验
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('id, role, full_name')
        .eq('id', uid)
        .single();

      if (profileError) {
        console.error('Verify error:', profileError.message);
      } else {
        console.log('=== 验证结果 ===');
        console.log('role:', profile.role, '(3=超级管理员/admin)');
        console.log('full_name:', profile.full_name);
      }
    }

    console.log('\n========================================');
    console.log('  超级管理员账号创建完成');
    console.log('  邮箱:', ADMIN_EMAIL);
    console.log('  密码:', ADMIN_PASSWORD);
    console.log('========================================');
  } catch (err) {
    console.error('Error:', err);
  }
}

createAdmin();
