import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://rkmspodctprrwmeiteos.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJrbXNwb2RjdHBycndtZWl0ZW9zIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE3NTcxNDcsImV4cCI6MjA5NzMzMzE0N30.hmV09hgpQ2xcO6PoTJqhuQGvRErxbHuQ76w-Y65p0ZM';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function createTeacher() {
  console.log('Creating new teacher account...');
  
  try {
    const { data, error } = await supabase.auth.signUp({
      email: 'mentor@example.com',
      password: 'mentor123',
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
      console.log('  Password: mentor123');
    }
    
  } catch (err) {
    console.error('Error:', err);
  }
}

createTeacher();