import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://rkmspodctprrwmeiteos.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJrbXNwb2RjdHBycndtZWl0ZW9zIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE3NTcxNDcsImV4cCI6MjA5NzMzMzE0N30.hmV09hgpQ2xcO6PoTJqhuQGvRErxbHuQ76w-Y65p0ZM';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function resetPassword() {
  console.log('Resetting password...');
  
  try {
    const { error } = await supabase.auth.admin.updateUserById(
      'e233e55e-9af4-4174-b254-7ae77d8309f4',
      { password: 'password123' }
    );
    
    if (error) {
      console.error('Error:', error);
      return;
    }
    
    console.log('Password reset successful!');
    
    const { data, error: loginError } = await supabase.auth.signInWithPassword({
      email: 'jeff@example.com',
      password: 'password123',
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