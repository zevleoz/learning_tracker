import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://rkmspodctprrwmeiteos.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJrbXNwb2RjdHBycndtZWl0ZW9zIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE3NTcxNDcsImV4cCI6MjA5NzMzMzE0N30.hmV09hgpQ2xcO6PoTJqhuQGvRErxbHuQ76w-Y65p0ZM';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function checkRole() {
  console.log('Checking user role...');
  
  try {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: 'mentor@example.com',
      password: 'mentor123',
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