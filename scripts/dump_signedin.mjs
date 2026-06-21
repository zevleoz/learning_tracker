// 登录并查询所有学习记录，帮助排查 letter grade 不显示的问题
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://rkmspodctprrwmeiteos.supabase.co'
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJrbXNwb2RjdHBycndtZWl0ZW9zIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE3NTcxNDcsImV4cCI6MjA5NzMzMzE0N30.hmV0b9hgpQ2xcO6PoTJqhuQGvRErxbHuQ76w-Y56pZM'

const EMAIL = process.env.SB_EMAIL || 'tester@example.com'
const PASSWORD = process.env.SB_PASS || '123456'

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false },
})

async function main() {
  // 1. 登录
  const signIn = await supabase.auth.signInWithPassword({ email: EMAIL, password: PASSWORD })
  if (signIn.error) {
    console.log('登录失败，试图注册:', signIn.error.message)
    const up = await supabase.auth.signUp({
      email: EMAIL,
      password: PASSWORD,
      options: { data: { full_name: '测试用户', school_name: '测试学校' } },
    })
    if (up.error) { console.error('注册也失败:', up.error); process.exit(1) }
    console.log('注册成功，user id =', up.data.user?.id)
  } else {
    console.log('登录成功，user id =', signIn.data.user?.id)
  }

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) { console.error('getUser 为空'); process.exit(1) }
  const userId = user.id

  // 2. 查该用户所有课程（用于后续插入）
  const { data: courses } = await supabase
    .from('courses')
    .select('id, name, subject, source, is_shared, created_by')
    .limit(50)
  console.log('\n=== courses ===')
  for (const c of courses || []) console.log(' -', c.id, '|', c.name, '| subject=', c.subject, '| created_by=', c.created_by, '| is_shared=', c.is_shared)

  // 3. 查该用户所有学习记录（按 eval_type 分组）
  const { data: sessions } = await supabase
    .from('learning_sessions')
    .select('id, session_date, duration_minutes, category, form, eval_type, self_rating, grade_label, score, course_id, student_id, deleted_at')
    .eq('student_id', userId)
    .order('session_date', { ascending: false })
    .limit(200)

  console.log('\n=== learning_sessions (总数:', (sessions || []).length, ') ===')
  for (const s of sessions || []) {
    console.log(
      ' -',
      s.session_date,
      'dur=' + s.duration_minutes + 'm',
      'cat=' + s.category,
      'form=' + s.form,
      'eval_type=' + s.eval_type,
      'score=' + s.score,
      'grade_label=' + s.grade_label,
      'self_rating=' + s.self_rating,
      'course_id=' + s.course_id,
      'deleted_at=' + s.deleted_at
    )
  }

  // 4. 聚合：按 subject + eval_type=2，看平均分 & 数量
  const obj = (sessions || []).filter((s) => s.eval_type === 2 && s.score != null)
  const by = {}
  for (const s of obj) {
    const subj = s.course_id?.subject || s.course_id?.name || String(s.course_id)
    by[subj] = by[subj] || { count: 0, sum: 0 }
    by[subj].count++
    by[subj].sum += Number(s.score)
  }
  console.log('\n=== 客观评估聚合 ===')
  for (const [subj, v] of Object.entries(by)) {
    const avg = v.sum / v.count
    console.log(' -', subj, '| count=', v.count, '| avg=', avg.toFixed(2))
  }

  // 保存 userId 给后续脚本用
  console.log('\nUSER_ID:', userId)
}

main().catch((e) => { console.error(e); process.exit(1) })
