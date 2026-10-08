import { createClient } from '@supabase/supabase-js';
import { requireSupabase, requireEnv } from './env.js';

const { url: SUPABASE_URL, key: SUPABASE_ANON_KEY } = requireSupabase();
const MENTOR_PASSWORD = requireEnv('SCRIPT_MENTOR_PASSWORD', '导师/教师测试账号的密码');

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function checkRole() {
  console.log('Checking user role...');
  
  try {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: 'mentor@example.com',
      password: MENTOR_PASSWORD,
    });
    
    if (error) {
      console.error('Login error:', error);
      return;
    }
    
    console.log('User ID:', data.user.id);
    console.log('User email:', data.user.email);
    console.log('User metadata:', JSON.stringify(data.user.user_metadata, null, 2));
    
    const { data: profileData, error: profileError } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', data.user.id)
      .single();
    
    if (profileError) {
      console.error('Profile error:', profileError);
    } else {
      console.log('Profile:', JSON.stringify(profileData, null, 2));
    }
    
    const role = Number(data?.user?.user_metadata?.role) || 1;
    console.log('Role:', role);
    console.log('Should navigate to:', role >= 2 ? '/mentor' : '/syllabus');
    
  } catch (err) {
    console.error('Error:', err);
  }
}

checkRole();