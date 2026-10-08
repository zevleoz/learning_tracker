// 以学生身份插入 2 条记录：A=今天(10/6)、B=补填上周六(10/3)，复现"学生补填老师看不到"
import { createClient } from '@supabase/supabase-js'
import { requireSupabase, requireEnv } from './env.js'

const { url: SUPABASE_URL, key: SUPABASE_ANON_KEY } = requireSupabase()
const TEST_PASSWORD = requireEnv('SCRIPT_TEST_PASSWORD', '学生测试账号的密码')

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
const { error: signErr } = await supabase.auth.signInWithPassword({ email: 'test@school.edu', password: TEST_PASSWORD })
if (signErr) { console.error('学生登录失败:', signErr.message); process.exit(1) }
const { data: { user } } = await supabase.auth.getUser()
console.log('学生已登录:', user.id)

// 找一门该学生的课程
const { data: cs } = await supabase.from('courses').select('id, name').eq('created_by', user.id).is('deleted_at', null).limit(1)
const courseId = cs?.[0]?.id || null
console.log('课程:', cs?.[0]?.name || '(无, course_id=null)')

const base = { student_id: user.id, course_id: courseId, category: 1, form: 'E2E同步测试', eval_type: 1, self_rating: 3, duration_minutes: 45 }
const { data: a, error: ea } = await supabase.from('learning_sessions').insert({ ...base, session_date: '2026-10-06', start_time: '09:00:00', end_time: '09:45:00', notes: 'E2E-A 今天提交今天' }).select().single()
const { data: b, error: eb } = await supabase.from('learning_sessions').insert({ ...base, session_date: '2026-10-03', start_time: '10:00:00', end_time: '10:45:00', notes: 'E2E-B 今天提交补填上周六' }).select().single()
if (ea || eb) { console.error('插入失败:', ea?.message, eb?.message); process.exit(1) }
console.log('E2E-A id:', a.id, 'session_date:', a.session_date, 'created_at:', a.created_at)
console.log('E2E-B id:', b.id, 'session_date:', b.session_date, 'created_at:', b.created_at)
