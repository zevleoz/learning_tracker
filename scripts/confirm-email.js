import { createClient } from '@supabase/supabase-js';
import { requireSupabase, requireEnv } from './env.js';

const { url: SUPABASE_URL, key: SUPABASE_ANON_KEY } = requireSupabase();
const MENTOR_PASSWORD = requireEnv('SCRIPT_MENTOR_PASSWORD', '导师/教师测试账号的密码');

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function confirmEmail() {
  console.log('Confirming email...');
  
  try {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: 'mentor@example.com',
      password: MENTOR_PASSWORD,
    });
    
    if (error) {
      console.error('Login error:', error);
      return;
    }
    
    console.log('Login successful!');
    console.log('User ID:', data.user.id);
    
    const { error: confirmError } = await supabase.auth.updateUser({
      email: 'mentor@example.com',
    });
    
    if (confirmError) {
      console.error('Update user error:', confirmError);
    } else {
      console.log('User updated');
    }
    
  } catch (err) {
    console.error('Error:', err);
  }
}

confirmEmail();