// 只读诊断：学生记录在老师端不可见 —— 收集证据
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://rkmspodctprrwmeiteos.supabase.co'
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJrbXNwb2RjdHBycndtZWl0ZW9zIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE3NTcxNDcsImV4cCI6MjA5NzMzMzE0N30.hmV09hgpQ2xcO6PoTJqhuQGvRErxbHuQ76w-Y65p0ZM'

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

const { error: signErr } = await supabase.auth.signInWithPassword({
  email: 'admin@yibc.com',
  password: 'Admin@2026!',
})
if (signErr) { console.error('登录失败:', signErr.message); process.exit(1) }
console.log('=== 已用 admin 登录（只读查询）===\n')

// 1) 导师档案
const { data: profiles } = await supabase.from('profiles').select('id, full_name, role')
const teachers = (profiles || []).filter(p => p.role === 0 || p.role === 2)
const students = (profiles || []).filter(p => p.role === 1)
console.log(`PROFILES: 共 ${profiles?.length}，导师/管理员 ${teachers.length}，学生 ${students.length}`)
for (const t of teachers) console.log('  老师:', t.id.slice(0,8), t.full_name, 'role=' + t.role)

// 2) 连接分布
const { data: conns } = await supabase.from('teacher_student_connections').select('teacher_id, student_id, status')
const byTeacher = {}
for (const c of conns || []) {
  byTeacher[c.teacher_id] = byTeacher[c.teacher_id] || []
  byTeacher[c.teacher_id].push(c)
}
console.log(`\nCONNECTIONS: 共 ${conns?.length}`)
for (const [tid, list] of Object.entries(byTeacher)) {
  const t = teachers.find(x => x.id === tid)
  const statuses = list.reduce((m, c) => { m[c.status] = (m[c.status]||0)+1; return m }, {})
  console.log(`  ${t?.full_name || tid} (${tid.slice(0,8)}): ${list.length} 条`, JSON.stringify(statuses))
}
const noConnTeachers = teachers.filter(t => !byTeacher[t.id])
console.log('  零连接的老师:', noConnTeachers.map(t => `${t.full_name}(${t.id.slice(0,8)})`).join(', ') || '无')

// 3) 最近写入的学习记录（按 created_at）
const { data: recent } = await supabase
  .from('learning_sessions')
  .select('id, student_id, session_date, deleted_at, created_at, category, course_id')
  .order('created_at', { ascending: false })
  .limit(40)
console.log('\nRECENT learning_sessions (按 created_at 最近40条):')
const studentName = id => students.find(s => s.id === id)?.full_name || id?.slice(0,8)
for (const s of recent || []) {
  const conn = (conns || []).find(c => c.student_id === s.student_id)
  const connTeacher = conn ? (teachers.find(t => t.id === conn.teacher_id)?.full_name || conn.teacher_id.slice(0,8)) : '⚠️无连接'
  console.log(`  created=${s.created_at} | date=${s.session_date} | 学生=${studentName(s.student_id)} | deleted_at=${s.deleted_at === null ? 'NULL' : JSON.stringify(s.deleted_at)} | 连接老师=${connTeacher}(${conn?.status ?? '-'})`)
}

// 4) deleted_at 值分布
const { data: allSessions } = await supabase.from('learning_sessions').select('deleted_at')
const dist = {}
for (const s of allSessions || []) {
  const key = s.deleted_at === null ? 'NULL' : typeof s.deleted_at + ':' + JSON.stringify(s.deleted_at)
  dist[key] = (dist[key] || 0) + 1
}
console.log('\ndeleted_at 值分布:', JSON.stringify(dist))

// 5) 每个学生的记录数与最近记录日期
console.log('\n各学生记录统计:')
for (const st of students) {
  const { data: ss } = await supabase
    .from('learning_sessions')
    .select('session_date, deleted_at, created_at')
    .eq('student_id', st.id)
    .order('created_at', { ascending: false })
  if (!ss?.length) { console.log(`  ${st.full_name}: 0 条`); continue }
  const live = ss.filter(x => x.deleted_at === null)
  console.log(`  ${st.full_name}: 总${ss.length} 活${live.length} | 最新created=${ss[0].created_at} session_date=${ss[0].session_date}`)
}
