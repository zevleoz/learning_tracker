import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://rkmspodctprrwmeiteos.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJrbXNwb2RjdHBycndtZWl0ZW9zIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE3NTcxNDcsImV4cCI6MjA5NzMzMzE0N30.hmV09hgpQ2xcO6PoTJqhuQGvRErxbHuQ76w-Y65p0ZM';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function createTeacher() {
  console.log('Creating teacher account...');
  
  try {
    const { error: signUpError } = await supabase.auth.signUp({
      email: 'jeff@example.com',
      password: 'password123',
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
      password: 'password123',
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