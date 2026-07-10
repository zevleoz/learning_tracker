import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://rkmspodctprrwmeiteos.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJrbXNwb2RjdHBycndtZWl0ZW9zIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE3NTcxNDcsImV4cCI6MjA5NzMzMzE0N30.hmV09hgpQ2xcO6PoTJqhuQGvRErxbHuQ76w-Y65p0ZM';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function checkUser() {
  console.log('Checking user...');
  
  try {
    const { data: users, error } = await supabase.auth.admin.listUsers();
    
    if (error) {
      console.error('Error:', error);
      return;
    }
    
    console.log('Users:', users.users.map(u => ({
      id: u.id,
      email: u.email,
      emailConfirmedAt: u.email_confirmed_at,
      userMetadata: u.user_metadata,
    })));
    
  } catch (err) {
    console.error('Error:', err);
  }
}

checkUser();