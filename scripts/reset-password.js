// 目标账号：jeff@example.com（教师/导师测试账号），密码来自 SCRIPT_MENTOR_PASSWORD
import { createClient } from '@supabase/supabase-js';
import { requireSupabase, requireEnv } from './env.js';

const { url: SUPABASE_URL, key: SUPABASE_ANON_KEY } = requireSupabase();
const MENTOR_PASSWORD = requireEnv('SCRIPT_MENTOR_PASSWORD', '导师/教师测试账号的密码');

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function resetPassword() {
  console.log('Resetting password...');
  
  try {
    const { error } = await supabase.auth.admin.updateUserById(
      'e233e55e-9af4-4174-b254-7ae77d8309f4',
      { password: MENTOR_PASSWORD }
    );
    
    if (error) {
      console.error('Error:', error);
      return;
    }
    
    console.log('Password reset successful!');
    
    const { data, error: loginError } = await supabase.auth.signInWithPassword({
      email: 'jeff@example.com',
      password: MENTOR_PASSWORD,
    });
    
    if (loginError) {
      console.error('Login error:', loginError);
      return;
    }
    
    console.log('Login successful!');
    console.log('User ID:', data.user.id);
    
  } catch (err) {
    console.error('Error:', err);
  }
}

resetPassword();