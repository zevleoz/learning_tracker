import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://rkmspodctprrwmeiteos.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJrbXNwb2RjdHBycndtZWl0ZW9zIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE3NTcxNDcsImV4cCI6MjA5NzMzMzE0N30.hmV09hgpQ2xcO6PoTJqhuQGvRErxbHuQ76w-Y65p0ZM';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function connectAllStudents() {
  console.log('Admin 登录中...');
  const { data: signIn, error: signInErr } = await supabase.auth.signInWithPassword({
    email: 'admin@yibc.com',
    password: 'Admin@2026!',
  });
  if (signInErr) {
    console.error('登录失败:', signInErr.message);
    return;
  }
  const adminId = signIn.user.id;
  console.log('Admin ID:', adminId, 'role:', signIn.user.user_metadata?.role);

  // 查所有学生
  const { data: students, error: sErr } = await supabase
    .from('profiles')
    .select('id, full_name')
    .eq('role', 1)
    .limit(500);
  if (sErr) {
    console.error('查询学生失败:', sErr.message);
    return;
  }
  console.log(`找到 ${students.length} 位学生，开始建立连接...`);

  // 查已有连接
  const { data: existing } = await supabase
    .from('teacher_student_connections')
    .select('student_id')
    .eq('teacher_id', adminId);
  const existingSet = new Set((existing || []).map((c) => c.student_id));

  // 批量插入新连接（status=1 已连接），跳过已存在的
  const toInsert = students
    .filter((s) => !existingSet.has(s.id) && s.id !== adminId)
    .map((s) => ({
      teacher_id: adminId,
      student_id: s.id,
      status: 1,
      note: 'auto-admin',
    }));

  console.log(`需要新建 ${toInsert.length} 条连接（已存在 ${existingSet.size} 条）`);

  if (toInsert.length === 0) {
    console.log('所有连接已存在，无需操作');
    return;
  }

  // 分批插入（每批 100 条，避免单次请求过大）
  const BATCH = 100;
  let inserted = 0;
  for (let i = 0; i < toInsert.length; i += BATCH) {
    const batch = toInsert.slice(i, i + BATCH);
    const { error: insErr } = await supabase
      .from('teacher_student_connections')
      .insert(batch);
    if (insErr) {
      console.error(`批次 ${i / BATCH + 1} 插入失败:`, insErr.message);
    } else {
      inserted += batch.length;
      console.log(`批次 ${i / BATCH + 1}: 插入 ${batch.length} 条 (累计 ${inserted})`);
    }
  }

  console.log(`\n========================================`);
  console.log(`  完成！共建立 ${inserted} 条连接`);
  console.log(`  Admin 现在可以直接查看所有学生数据`);
  console.log(`========================================`);

  // 验证
  const { data: verify } = await supabase
    .from('teacher_student_connections')
    .select('id, student_id, status')
    .eq('teacher_id', adminId);
  console.log(`验证：当前共 ${verify?.length || 0} 条连接`);
}

connectAllStudents();
