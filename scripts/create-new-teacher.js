import { createClient } from '@supabase/supabase-js';
import { requireSupabase, requireEnv } from './env.js';

const { url: SUPABASE_URL, key: SUPABASE_ANON_KEY } = requireSupabase();
const MENTOR_PASSWORD = requireEnv('SCRIPT_MENTOR_PASSWORD', '导师/教师测试账号的密码');

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function createTeacher() {
  console.log('Creating new teacher account...');
  
  try {
    const { data, error } = await supabase.auth.signUp({
      email: 'mentor@example.com',
      password: MENTOR_PASSWORD,
      options: {
        data: {
          full_name: '导师测试',
          school_name: '',
          role: 2,
        }
      }
    });
    
    if (error) {
      console.error('Sign up error:', error);
      return;
    }
    
    console.log('Sign up successful!');
    console.log('User ID:', data.user.id);
    
    const uid = data.user.id;
    
    const { error: upsertError } = await supabase.from('profiles').upsert({
      id: uid,
      full_name: '导师测试',
      school_name: '',
      role: 2,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'id' });
    
    if (upsertError) {
      console.error('Profile upsert error:', upsertError);
    } else {
      console.log('Profile created successfully!');
      console.log('Login credentials:');
      console.log('  Email: mentor@example.com');
      console.log('  Password: 见 .env.scripts（SCRIPT_MENTOR_PASSWORD）');
    }
    
  } catch (err) {
    console.error('Error:', err);
  }
}

createTeacher();