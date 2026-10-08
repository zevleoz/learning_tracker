// 目标账号：jeff@example.com（教师/导师测试账号），密码来自 SCRIPT_MENTOR_PASSWORD
import { createClient } from '@supabase/supabase-js';
import { requireSupabase, requireEnv } from './env.js';

const { url: SUPABASE_URL, key: SUPABASE_ANON_KEY } = requireSupabase();
const MENTOR_PASSWORD = requireEnv('SCRIPT_MENTOR_PASSWORD', '导师/教师测试账号的密码');

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function testLogin() {
  console.log('Testing login...');
  
  try {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: 'jeff@example.com',
      password: MENTOR_PASSWORD,
    });
    
    if (error) {
      console.error('Login error:', error);
      return;
    }
    
    console.log('Login successful!');
    console.log('User ID:', data.user.id);
    console.log('User email:', data.user.email);
    console.log('User metadata:', data.user.user_metadata);
    
    const { data: profileData, error: profileError } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', data.user.id)
      .single();
    
    if (profileError) {
      console.error('Profile error:', profileError);
    } else {
      console.log('Profile:', profileData);
    }
    
  } catch (err) {
    console.error('Error:', err);
  }
}

testLogin();