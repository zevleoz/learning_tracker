import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://rkmspodctprrwmeiteos.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJrbXNwb2RjdHBycndtZWl0ZW9zIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE3NTcxNDcsImV4cCI6MjA5NzMzMzE0N30.hmV09hgpQ2xcO6PoTJqhuQGvRErxbHuQ76w-Y65p0ZM';

const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
    console.log('=== 插入假数据开始 ===');

    const jeffId = 'e233e55e-9af4-4174-b254-7ae77d8309f4';
    console.log('使用 jeff ID:', jeffId);

    const { error: deleteError } = await supabase
        .from('learning_sessions')
        .delete()
        .eq('student_id', jeffId);

    if (deleteError) {
        console.error('删除现有记录失败:', deleteError);
        return;
    }
    console.log('已删除现有学习记录');

    const today = new Date();
    const sessions = [];

    // 数学：基础好，分数高，学习时间稳定
    const mathSessions = [
        { course: '数学', category: 1, form: '自主学习', eval_type: 2, score: 85, duration: 45, daysAgo: 30 },
        { course: '数学', category: 2, form: '自主复习', eval_type: 1, score: null, duration: 30, daysAgo: 29 },
        { course: '数学', category: 3, form: '自主练习', eval_type: 2, score: 88, duration: 40, daysAgo: 28 },
        { course: '数学', category: 1, form: '自主学习', eval_type: 2, score: 86, duration: 50, daysAgo: 25 },
        { course: '数学', category: 3, form: '校外线上', eval_type: 2, score: 90, duration: 60, daysAgo: 23 },
        { course: '数学', category: 2, form: '自主复习', eval_type: 1, score: null, duration: 25, daysAgo: 21 },
        { course: '数学', category: 1, form: '自主学习', eval_type: 2, score: 87, duration: 45, daysAgo: 20 },
        { course: '数学', category: 3, form: '自主练习', eval_type: 2, score: 91, duration: 45, daysAgo: 18 },
        { course: '数学', category: 2, form: '自主复习', eval_type: 1, score: null, duration: 30, daysAgo: 16 },
        { course: '数学', category: 1, form: '校外线上', eval_type: 2, score: 89, duration: 60, daysAgo: 14 },
        { course: '数学', category: 1, form: '自主学习', eval_type: 2, score: 88, duration: 50, daysAgo: 13 },
        { course: '数学', category: 3, form: '自主练习', eval_type: 2, score: 93, duration: 50, daysAgo: 11 },
        { course: '数学', category: 2, form: '自主复习', eval_type: 1, score: null, duration: 35, daysAgo: 9 },
        { course: '数学', category: 1, form: '校外线上', eval_type: 2, score: 91, duration: 60, daysAgo: 7 },
        { course: '数学', category: 1, form: '自主学习', eval_type: 2, score: 90, duration: 50, daysAgo: 6 },
        { course: '数学', category: 3, form: '自主练习', eval_type: 2, score: 94, duration: 55, daysAgo: 4 },
        { course: '数学', category: 2, form: '自主复习', eval_type: 1, score: null, duration: 40, daysAgo: 2 },
        { course: '数学', category: 3, form: '校外线上', eval_type: 2, score: 95, duration: 60, daysAgo: 1 },
    ];

    // 英语：中等，分数波动，有提升趋势
    const englishSessions = [
        { course: '英语', category: 1, form: '自主学习', eval_type: 2, score: 72, duration: 35, daysAgo: 30 },
        { course: '英语', category: 3, form: '自主练习', eval_type: 2, score: 70, duration: 30, daysAgo: 28 },
        { course: '英语', category: 1, form: '校外线下', eval_type: 2, score: 75, duration: 60, daysAgo: 26 },
        { course: '英语', category: 2, form: '自主复习', eval_type: 1, score: null, duration: 20, daysAgo: 24 },
        { course: '英语', category: 3, form: '自主练习', eval_type: 2, score: 73, duration: 35, daysAgo: 22 },
        { course: '英语', category: 1, form: '自主学习', eval_type: 2, score: 76, duration: 40, daysAgo: 19 },
        { course: '英语', category: 3, form: '自主练习', eval_type: 2, score: 75, duration: 35, daysAgo: 17 },
        { course: '英语', category: 1, form: '校外线下', eval_type: 2, score: 78, duration: 60, daysAgo: 15 },
        { course: '英语', category: 2, form: '自主复习', eval_type: 1, score: null, duration: 25, daysAgo: 13 },
        { course: '英语', category: 1, form: '自主学习', eval_type: 2, score: 79, duration: 45, daysAgo: 12 },
        { course: '英语', category: 3, form: '自主练习', eval_type: 2, score: 78, duration: 40, daysAgo: 10 },
        { course: '英语', category: 1, form: '校外线下', eval_type: 2, score: 81, duration: 60, daysAgo: 8 },
        { course: '英语', category: 2, form: '自主复习', eval_type: 1, score: null, duration: 30, daysAgo: 6 },
        { course: '英语', category: 1, form: '自主学习', eval_type: 2, score: 82, duration: 50, daysAgo: 5 },
        { course: '英语', category: 3, form: '自主练习', eval_type: 2, score: 80, duration: 45, daysAgo: 3 },
        { course: '英语', category: 1, form: '校外线下', eval_type: 2, score: 84, duration: 60, daysAgo: 1 },
    ];

    // 物理：较弱，分数偏低，需要更多练习
    const physicsSessions = [
        { course: '物理', category: 1, form: '自主学习', eval_type: 2, score: 62, duration: 40, daysAgo: 29 },
        { course: '物理', category: 3, form: '自主练习', eval_type: 2, score: 58, duration: 35, daysAgo: 27 },
        { course: '物理', category: 1, form: '校外线上', eval_type: 2, score: 65, duration: 60, daysAgo: 25 },
        { course: '物理', category: 2, form: '自主复习', eval_type: 1, score: null, duration: 25, daysAgo: 23 },
        { course: '物理', category: 3, form: '自主练习', eval_type: 2, score: 60, duration: 40, daysAgo: 20 },
        { course: '物理', category: 1, form: '自主学习', eval_type: 2, score: 64, duration: 45, daysAgo: 20 },
        { course: '物理', category: 3, form: '自主练习', eval_type: 2, score: 62, duration: 40, daysAgo: 18 },
        { course: '物理', category: 1, form: '校外线上', eval_type: 2, score: 68, duration: 60, daysAgo: 16 },
        { course: '物理', category: 3, form: '自主练习', eval_type: 2, score: 65, duration: 45, daysAgo: 14 },
        { course: '物理', category: 1, form: '自主学习', eval_type: 2, score: 67, duration: 50, daysAgo: 13 },
        { course: '物理', category: 3, form: '自主练习', eval_type: 2, score: 68, duration: 45, daysAgo: 11 },
        { course: '物理', category: 1, form: '校外线上', eval_type: 2, score: 72, duration: 60, daysAgo: 9 },
        { course: '物理', category: 3, form: '自主练习', eval_type: 2, score: 70, duration: 50, daysAgo: 7 },
        { course: '物理', category: 1, form: '自主学习', eval_type: 2, score: 71, duration: 55, daysAgo: 6 },
        { course: '物理', category: 3, form: '自主练习', eval_type: 2, score: 73, duration: 50, daysAgo: 4 },
        { course: '物理', category: 1, form: '校外线上', eval_type: 2, score: 76, duration: 60, daysAgo: 2 },
        { course: '物理', category: 3, form: '自主练习', eval_type: 2, score: 74, duration: 55, daysAgo: 0 },
    ];

    // 化学：中等偏上，分数稳定
    const chemistrySessions = [
        { course: '化学', category: 1, form: '自主学习', eval_type: 2, score: 78, duration: 35, daysAgo: 30 },
        { course: '化学', category: 2, form: '自主复习', eval_type: 1, score: null, duration: 25, daysAgo: 28 },
        { course: '化学', category: 3, form: '自主练习', eval_type: 2, score: 80, duration: 30, daysAgo: 26 },
        { course: '化学', category: 1, form: '自主学习', eval_type: 2, score: 79, duration: 40, daysAgo: 24 },
        { course: '化学', category: 3, form: '校外线上', eval_type: 2, score: 82, duration: 50, daysAgo: 22 },
        { course: '化学', category: 1, form: '自主学习', eval_type: 2, score: 80, duration: 35, daysAgo: 19 },
        { course: '化学', category: 2, form: '自主复习', eval_type: 1, score: null, duration: 30, daysAgo: 17 },
        { course: '化学', category: 3, form: '自主练习', eval_type: 2, score: 83, duration: 35, daysAgo: 15 },
        { course: '化学', category: 1, form: '自主学习', eval_type: 2, score: 82, duration: 40, daysAgo: 12 },
        { course: '化学', category: 2, form: '自主复习', eval_type: 1, score: null, duration: 35, daysAgo: 10 },
        { course: '化学', category: 3, form: '自主练习', eval_type: 2, score: 85, duration: 40, daysAgo: 8 },
        { course: '化学', category: 1, form: '自主学习', eval_type: 2, score: 84, duration: 45, daysAgo: 5 },
        { course: '化学', category: 2, form: '自主复习', eval_type: 1, score: null, duration: 40, daysAgo: 3 },
        { course: '化学', category: 3, form: '自主练习', eval_type: 2, score: 87, duration: 45, daysAgo: 0 },
    ];

    // 历史：较强，分数高，复习时间多
    const historySessions = [
        { course: '历史', category: 1, form: '自主学习', eval_type: 2, score: 88, duration: 30, daysAgo: 29 },
        { course: '历史', category: 2, form: '自主复习', eval_type: 1, score: null, duration: 35, daysAgo: 27 },
        { course: '历史', category: 3, form: '自主练习', eval_type: 2, score: 90, duration: 25, daysAgo: 25 },
        { course: '历史', category: 2, form: '自主复习', eval_type: 1, score: null, duration: 30, daysAgo: 23 },
        { course: '历史', category: 1, form: '自主学习', eval_type: 2, score: 87, duration: 35, daysAgo: 21 },
        { course: '历史', category: 1, form: '自主学习', eval_type: 2, score: 89, duration: 30, daysAgo: 20 },
        { course: '历史', category: 2, form: '自主复习', eval_type: 1, score: null, duration: 40, daysAgo: 18 },
        { course: '历史', category: 3, form: '自主练习', eval_type: 2, score: 92, duration: 30, daysAgo: 16 },
        { course: '历史', category: 1, form: '自主学习', eval_type: 2, score: 90, duration: 35, daysAgo: 13 },
        { course: '历史', category: 2, form: '自主复习', eval_type: 1, score: null, duration: 45, daysAgo: 11 },
        { course: '历史', category: 3, form: '自主练习', eval_type: 2, score: 93, duration: 35, daysAgo: 9 },
        { course: '历史', category: 1, form: '自主学习', eval_type: 2, score: 91, duration: 40, daysAgo: 6 },
        { course: '历史', category: 2, form: '自主复习', eval_type: 1, score: null, duration: 50, daysAgo: 4 },
        { course: '历史', category: 3, form: '自主练习', eval_type: 2, score: 94, duration: 40, daysAgo: 2 },
    ];

    // 合并所有会话
    [...mathSessions, ...englishSessions, ...physicsSessions, ...chemistrySessions, ...historySessions].forEach((s) => {
        const sessionDate = new Date(today);
        sessionDate.setDate(today.getDate() - s.daysAgo);
        
        sessions.push({
            student_id: jeffId,
            course_id: '00000000-0000-0000-0000-000000000000',
            category: s.category,
            form: s.form,
            eval_type: s.eval_type,
            score: s.score,
            duration_minutes: s.duration,
            session_date: sessionDate.toISOString().split('T')[0],
        });
    });

    // 分批插入数据（每次最多100条）
    const batchSize = 100;
    for (let i = 0; i < sessions.length; i += batchSize) {
        const batch = sessions.slice(i, i + batchSize);
        const { error: insertError } = await supabase
            .from('learning_sessions')
            .insert(batch);

        if (insertError) {
            console.error('插入数据失败:', insertError);
            return;
        }
        console.log(`已插入 ${Math.min(i + batchSize, sessions.length)} / ${sessions.length} 条记录`);
    }

    console.log('=== 假数据插入完成 ===');
    console.log(`共插入 ${sessions.length} 条学习记录`);
}

main().catch(console.error);