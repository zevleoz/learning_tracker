// 验证修复：用与修复后代码完全一致的查询与排序/过滤逻辑，确认 E2E-B（10/3 补填）能被老师端看到
// 然后软删 E2E-A / E2E-B 两条测试记录
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://rkmspodctprrwmeiteos.supabase.co'
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJrbXNwb2RjdHBycndtZWl0ZW9zIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE3NTcxNDcsImV4cCI6MjA5NzMzMzE0N30.hmV09hgpQ2xcO6PoTJqhuQGvRErxbHuQ76w-Y65p0ZM'

const admin = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
const { error: signErr } = await admin.auth.signInWithPassword({ email: 'admin@yibc.com', password: 'Admin@2026!' })
if (signErr) { console.error('admin 登录失败:', signErr.message); process.exit(1) }

// 找到测试学生
const { data: stu } = await admin.from('profiles').select('id, full_name').eq('role', 1)
const testStudent = (stu || []).find(s => s.full_name && s.full_name.includes('测试')) || null

// 通过 E2E 记录反查学生 id
const { data: e2eRows } = await admin
  .from('learning_sessions')
  .select('id, student_id, session_date, created_at, notes')
  .like('notes', 'E2E-%')
  .is('deleted_at', null)
if (!e2eRows?.length) { console.log('未找到 E2E 测试记录（可能已清理）'); process.exit(0) }
const studentId = e2eRows[0].student_id
console.log('E2E 记录:', e2eRows.map(r => `${r.notes} date=${r.session_date} created=${r.created_at}`).join('\n  '))

// ── 模拟修复后 Mentor.fetchPickedSessions 的查询 ──
const { data, error } = await admin
  .from('learning_sessions')
  .select(`id, session_date, created_at, duration_minutes, notes, course:course_id(name, subject)`)
  .eq('student_id', studentId)
  .is('deleted_at', null)
  .order('session_date', { ascending: false })
  .order('created_at', { ascending: false })
  .limit(2000)
if (error) { console.error('查询失败:', error.message); process.exit(1) }
const sessions = (data || []).map(s => ({ ...s, date: String(s.session_date || '').slice(0, 10) }))

// ── 模拟修复后的 recentSubmitted（按提交时间倒序）──
const recentSubmitted = [...sessions].sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
const top8 = recentSubmitted.slice(0, 8)
const bInTop8 = top8.find(s => s.notes?.startsWith('E2E-B'))
const aInTop8 = top8.find(s => s.notes?.startsWith('E2E-A'))
console.log('\n[验证1] 最新提交 Top8 含 E2E-A(今天):', !!aInTop8, '| 含 E2E-B(补填10/3):', !!bInTop8)

// ── 模拟修复后的 newOutsideRange（默认本周时段）──
const pad = n => String(n).padStart(2, '0')
const toLocal = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const today = new Date(); today.setHours(0, 0, 0, 0)
const day = today.getDay()
const monday = new Date(today); monday.setDate(today.getDate() - (day === 0 ? 6 : day - 1))
const startStr = toLocal(monday)
const endStr = toLocal(new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6))
const weekAgo = toLocal(new Date(Date.now() - 7 * 24 * 3600 * 1000))
const newOutside = sessions.filter(s => {
  if (!s.created_at) return false
  const submitted = String(s.created_at).slice(0, 10)
  if (submitted < weekAgo) return false
  const d = s.date?.split('T')[0]
  return d && (d < startStr || d > endStr)
})
console.log(`[验证2] 默认本周时段 ${startStr}~${endStr}，新提交提醒条会显示 ${newOutside.length} 条:`,
  newOutside.map(s => `${s.notes}(${s.date})`).join(', ') || '(无)')

const pass = !!bInTop8 && newOutside.some(s => s.notes?.startsWith('E2E-B'))
console.log(pass ? '\n✅ 修复验证通过：补填记录在「最新提交」和「新提交提醒」中均可见' : '\n❌ 验证失败')

// ── 清理：软删 E2E 测试记录 ──
for (const r of e2eRows) {
  const { error: e } = await admin.from('learning_sessions').update({ deleted_at: new Date().toISOString() }).eq('id', r.id)
  console.log(e ? `清理 ${r.notes} 失败: ${e.message}` : `已软删 ${r.notes} (${r.id.slice(0, 8)})`)
}
process.exit(pass ? 0 : 1)
