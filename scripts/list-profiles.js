import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://rkmspodctprrwmeiteos.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJrbXNwb2RjdHBycndtZWl0ZW9zIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE3NTcxNDcsImV4cCI6MjA5NzMzMzE0N30.hmV09hgpQ2xcO6PoTJqhuQGvRErxbHuQ76w-Y65p0ZM';

const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
    const { data: profiles, error } = await supabase
        .from('profiles')
        .select('*');
    
    if (error) {
        console.error('Error:', error);
        return;
    }
    
    console.log('Profiles:', JSON.stringify(profiles, null, 2));
}

main().catch(console.error);