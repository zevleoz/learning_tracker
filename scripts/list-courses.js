import { createClient } from '@supabase/supabase-js';
import { requireSupabase } from './env.js';

const { url: supabaseUrl, key: supabaseKey } = requireSupabase();

const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
    const { data: courses, error } = await supabase
        .from('courses')
        .select('id, name, subject');
    
    if (error) {
        console.error('Error:', error);
        return;
    }
    
    console.log('Courses:', JSON.stringify(courses, null, 2));
}

main().catch(console.error);