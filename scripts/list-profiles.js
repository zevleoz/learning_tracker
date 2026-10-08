import { createClient } from '@supabase/supabase-js';
import { requireSupabase } from './env.js';

const { url: supabaseUrl, key: supabaseKey } = requireSupabase();

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