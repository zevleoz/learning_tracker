// 读取现有学习记录 + 课程 + 档案，帮助诊断 & 准备假数据
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://rkmspodctprrwmeiteos.supabase.co'
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJrbXNwb2RjdHBycndtZWl0ZW9zIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE3NTcxNDcsImV4cCI6MjA5NzMzMzE0N30.hmV0b9hgpQ2xcO6PoTJqhuQGvRErxbHuQ76w-Y56pZM'

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

async function main() {
  const { data: user, error: authErr } = await supabase.auth.getUser()
  console.log('USER:', JSON.stringify(user, null, 2), 'authErr:', authErr?.message)

  // 取 courses
  const { data: courses } = await supabase.from('courses').select('id, name, subject').limit(20)
  console.log('\nCOURSES:')
  for (const c of courses || []) console.log(' -', c.id, c.name, '/ subject=', c.subject)

  // 取 profiles
  const { data: profiles } = await supabase.from('profiles').select('id, full_name').limit(10)
  console.log('\nPROFILES:')
  for (const p of profiles || []) console.log(' -', p.id, p.full_name)

  // 取最近 20 条学习记录
  const { data: sessions } = await supabase
    .from('learning_sessions')
    .select('id, session_date, duration_minutes, category, form, eval_type, self_rating, grade_label, score, course_id, student_id')
    .order('session_date', { ascending: false })
    .limit(30)

  console.log('\nLEARNING_SESSIONS (最近30条):')
  for (const s of sessions || []) {
    console.log(
      ' -',
      s.session_date,
      '| dur=' + s.duration_minutes + 'm',
      '| cat=' + s.category,
      '| form=' + s.form,
      '| eval_type=' + s.eval_type,
      '| score=' + s.score,
      '| grade_label=' + s.grade_label,
      '| self_rating=' + s.self_rating,
      '| course_id=' + s.course_id,
      '| student_id=' + s.student_id
    )
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
