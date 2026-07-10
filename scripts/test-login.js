import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://rkmspodctprrwmeiteos.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJrbXNwb2RjdHBycndtZWl0ZW9zIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE3NTcxNDcsImV4cCI6MjA5NzMzMzE0N30.hmV09hgpQ2xcO6PoTJqhuQGvRErxbHuQ76w-Y65p0ZM';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function testLogin() {
  console.log('Testing login...');
  
  try {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: 'jeff@example.com',
      password: 'password123',
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