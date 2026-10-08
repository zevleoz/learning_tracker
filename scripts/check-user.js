import { createClient } from '@supabase/supabase-js';
import { requireSupabase } from './env.js';

const { url: SUPABASE_URL, key: SUPABASE_ANON_KEY } = requireSupabase();

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