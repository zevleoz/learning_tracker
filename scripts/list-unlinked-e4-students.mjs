// 只读清点：列出 E4 学生里 Y4 关联缺失的记录，供导师在「学生详情页 → 关联 Y4 报告」逐个补上。
//
// 背景（R1）：建档向导曾在 createE4Student 里丢掉 y4_* 四个字段，
// 因此历史学生在「没当场生成报告」的情况下 y4_report_id 为空，详情页显示未关联。
// 该丢失不可自动恢复——当时选过哪份报告从未落库，只能人工重选。本脚本不做任何写操作。
//
// 运行：node scripts/list-unlinked-e4-students.mjs
// 依赖 .env.scripts（见 scripts/env.js）。只读登录：依次尝试 SCRIPT_ADMIN_EMAIL / SCRIPT_ADMIN_PASSWORD。
import { createClient } from '@supabase/supabase-js';
import { requireSupabase, requireEnv } from './env.js';

const { url, key } = requireSupabase();
const email = process.env.SCRIPT_ADMIN_EMAIL || 'admin@yibc.com';
const password = requireEnv('SCRIPT_ADMIN_PASSWORD', `${email} 的密码`);

const supabase = createClient(url, key);
const { error: signErr } = await supabase.auth.signInWithPassword({ email, password });
if (signErr) {
  console.error('登录失败：', signErr.message);
  process.exit(1);
}

const { data, error } = await supabase
  .from('e4_students')
  .select('id, display_name, y4_student_id, y4_report_id, y4_student_name, archived_at, created_at')
  .order('created_at', { ascending: false });
if (error) {
  console.error('读取 e4_students 失败：', error.message);
  process.exit(1);
}

const rows = data || [];
const unlinked = rows.filter((s) => !s.y4_report_id);
const halfLinked = unlinked.filter((s) => s.y4_student_id);

console.log(`E4 学生共 ${rows.length} 位，其中待补关联 ${unlinked.length} 位`);
console.log(`  已有 Y4 学生、只缺报告：${halfLinked.length} 位（打开关联弹窗会直接进选报告那一步）`);
console.log(`  完全没有 Y4 关联：${unlinked.length - halfLinked.length} 位（需从头搜学生）\n`);

if (!unlinked.length) {
  console.log('没有待补关联的学生。');
} else {
  console.log('id                                    | 姓名        | 状态     | 创建时间');
  for (const s of unlinked) {
    const state = s.y4_student_id ? `缺报告（Y4 学生 #${s.y4_student_id}）` : '未关联';
    console.log(
      `${s.id} | ${(s.display_name || '').padEnd(10)} | ${(s.archived_at ? `已归档·${state}` : state).padEnd(28)} | ${(s.created_at || '').slice(0, 10)}`,
    );
  }
  console.log('\n补关联方式：学生详情页 → 关联 Y4 报告（每人约 10 秒）。');
}
