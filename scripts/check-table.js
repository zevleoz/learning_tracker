import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://rkmspodctprrwmeiteos.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJrbXNwb2RjdHBycndtZWl0ZW9zIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE3NTcxNDcsImV4cCI6MjA5NzMzMzE0N30.hmV09hgpQ2xcO6PoTJqhuQGvRErxbHuQ76w-Y65p0ZM';

const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
    console.log('=== 检查表结构 ===');
    
    const { data, error } = await supabase
        .from('learning_sessions')
        .select('*')
        .limit(1);
    
    if (error) {
        console.error('查询失败:', error);
        return;
    }
    
    if (data && data.length > 0) {
        console.log('learning_sessions 表列:', Object.keys(data[0]));
        console.log('示例数据:', data[0]);
    } else {
        console.log('表为空，尝试插入一条测试数据...');
        
        const testResult = await supabase
            .from('learning_sessions')
            .insert({
                student_id: 'test',
                course_id: 'test',
                category: 1,
                form: '自主学习',
                eval_type: 1,
                score: null,
                duration_minutes: 30,
                session_date: new Date().toISOString().split('T')[0],
            })
            .select('*');
        
        console.log('插入结果:', testResult);
    }
}

main().catch(console.error);
