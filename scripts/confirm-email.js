import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://rkmspodctprrwmeiteos.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJrbXNwb2RjdHBycndtZWl0ZW9zIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE3NTcxNDcsImV4cCI6MjA5NzMzMzE0N30.hmV09hgpQ2xcO6PoTJqhuQGvRErxbHuQ76w-Y65p0ZM';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function confirmEmail() {
  console.log('Confirming email...');
  
  try {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: 'mentor@example.com',
      password: 'mentor123',
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