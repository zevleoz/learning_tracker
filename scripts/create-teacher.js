// 目标账号：jeff@example.com（教师/导师测试账号），密码来自 SCRIPT_MENTOR_PASSWORD
import { createClient } from '@supabase/supabase-js';
import { requireSupabase, requireEnv } from './env.js';

const { url: SUPABASE_URL, key: SUPABASE_ANON_KEY } = requireSupabase();
const MENTOR_PASSWORD = requireEnv('SCRIPT_MENTOR_PASSWORD', '导师/教师测试账号的密码');

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function createTeacher() {
  console.log('Creating teacher account...');
  
  try {
    const { error: signUpError } = await supabase.auth.signUp({
      email: 'jeff@example.com',
      password: MENTOR_PASSWORD,
      options: {
        data: {
          full_name: 'Jeff老师',
          school_name: '',
          role: 2,
        }
      }
    });
    
    if (signUpError) {
      console.log('Sign up error (may already exist):', signUpError.message);
    }
    
    const { data: sessionData } = await supabase.auth.signInWithPassword({
      email: 'jeff@example.com',
      password: MENTOR_PASSWORD,
    });
    
    const uid = sessionData?.user?.id;
    console.log('User ID:', uid);
    
    if (uid) {
      const { error: upsertError } = await supabase.from('profiles').upsert({
        id: uid,
        full_name: 'Jeff老师',
        school_name: '',
        role: 2,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'id' });
      
      if (upsertError) {
        console.error('Profile upsert error:', upsertError);
      } else {
        console.log('Profile updated successfully');
      }
    }
    
    console.log('Teacher account created/updated successfully!');
  } catch (err) {
    console.error('Error:', err);
  }
}

createTeacher();