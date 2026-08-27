// 假数据生成 + Letter Grade 诊断工具
// 访问 /debug-tools 打开本页
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase.js'

const FORMS = [
  '自主预习', '自主复习', '自主练习', '校外线上', '校外线下',
  '学校课堂', '学校作业', '课堂练习(不算分)', '课堂练习(算分)'
]
const SELF_FORMS = ['自主预习', '自主复习', '自主练习']

// 科目 → 行为、时长、评估类型 的组合配置
const SUBJECT_PROFILE = [
  { name: '语文', cat: 1,       minsR: [45, 90],  review: true, practice: true,  study: true,  objective: [70, 95] },
  { name: '数学', cat: 1,       minsR: [60, 120], review: true, practice: true,  study: true,  objective: [65, 98] },
  { name: '英语', cat: 1,       minsR: [40, 90],  review: true, practice: true,  study: true,  objective: [72, 94] },
  { name: '物理', cat: 1,       minsR: [40, 90],  review: true, practice: true,  study: false, objective: [60, 90] },
  { name: '化学', cat: 1,       minsR: [40, 80],  review: true, practice: true,  study: false, objective: [55, 88] },
  { name: '生物', cat: 1,       minsR: [30, 60],  review: true, practice: false, study: true,  objective: [75, 92] },
]

function rand(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min }
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)] }

// Score → 最近 Grade
const GRADE_TABLE = [
  { grade: 'A+', score: 97 },
  { grade: 'A',  score: 93 },
  { grade: 'A-', score: 90 },
  { grade: 'B+', score: 87 },
  { grade: 'B',  score: 83 },
  { grade: 'B-', score: 80 },
  { grade: 'C+', score: 77 },
  { grade: 'C',  score: 73 },
  { grade: 'C-', score: 70 },
  { grade: 'D+', score: 67 },
  { grade: 'D',  score: 63 },
  { grade: 'D-', score: 60 },
  { grade: 'F',  score: 50 },
]
function scoreToGradeLabel(score) {
  let best = GRADE_TABLE[0], min = Infinity
  for (const g of GRADE_TABLE) {
    const d = Math.abs(g.score - score)
    if (d < min) { min = d; best = g }
  }
  return best.grade
}

export default function DebugTools() {
  const [user, setUser] = useState(null)
  const [courses, setCourses] = useState([])
  const [sessions, setSessions] = useState([])
  const [busy, setBusy] = useState(false)
  const [log, setLog] = useState([])
  const append = (line) => setLog((l) => [new Date().toLocaleTimeString() + ' | ' + line, ...l].slice(0, 80))

  // 取当前用户 & 数据
  useEffect(() => {
    (async () => {
      const { data: { user: u } } = await supabase.auth.getUser()
      if (!u) return
      setUser(u)

      const [coursesRes, sessRes] = await Promise.all([
        supabase.from('courses').select('id, name, subject').limit(100),
        supabase
          .from('learning_sessions')
          .select('id, session_date, duration_minutes, category, form, eval_type, self_rating, grade_label, score, course_id, student_id, deleted_at')
          .eq('student_id', u.id)
          .order('session_date', { ascending: false })
          .limit(500),
      ])
      setCourses(coursesRes.data || [])
      setSessions(sessRes.data || [])
      append(`加载完成：课程 ${coursesRes.data?.length || 0} 条，学习记录 ${sessRes.data?.length || 0} 条`)
    })()
  }, [])

  // 客观评估聚合（直接用原始字段，和 Review.jsx 同样的逻辑）
  const objAggregate = useMemo(() => {
    // 精确按页面里的逻辑聚合：
    // - eval_type === 2 （数字）
    // - score 非空
    // 注意：数据库里 eval_type 可能是字符串/数字/undefined；score 也是可能的字符串
    const result = {}
    for (const s of sessions) {
      // 宽松比较：数字 2 / 字符串 "2"
      if (Number(s.eval_type) !== 2) continue
      if (s.score == null || s.score === '' || Number.isNaN(Number(s.score))) continue

      // 科目名的两种来源
      const subj = s.course?.subject || s.course?.name || s.course_id || '未分类'
      const k = String(subj)
      result[k] = result[k] || { count: 0, sum: 0, rows: [] }
      result[k].count++
      result[k].sum += Number(s.score)
      result[k].rows.push({
        id: s.id, date: s.session_date, score: s.score, grade_label: s.grade_label,
        eval_type: s.eval_type, typeof_eval: typeof s.eval_type, typeof_score: typeof s.score,
      })
    }
    return result
  }, [sessions])

  // =============================================================
  // 动作：补假数据（先建课程，再建学习记录）
  // =============================================================
  async function populate() {
    if (!user) { append('请先登录'); return }
    setBusy(true)
    try {
      append('开始生成假数据…')

      // 1) 为每个需要的 subject 创建一个 course（若该 subject 已有 course 则复用）
      const existingSubjects = new Set((courses || []).map((c) => c.subject))
      const subjectToCourse = {}
      // 先找已有
      for (const c of courses || []) subjectToCourse[c.subject] = c.id

      // 新建缺失
      const needCreate = SUBJECT_PROFILE.filter((p) => !existingSubjects.has(p.name))
      if (needCreate.length) {
        const insertedIds = []
        for (const p of needCreate) {
          const { data, error } = await supabase.from('courses').insert({
            name: p.name,
            subject: p.name,
            source: 1,
            created_by: user.id,
            is_shared: false,
          }).select('id, subject').single()
          if (error) throw error
          subjectToCourse[data.subject] = data.id
          insertedIds.push(data.id)
        }
        append(`已新建课程：${needCreate.map((x) => x.name).join('、')}`)
      } else {
        append('所有科目已存在，无需新建课程')
      }

      // 2) 构建 30+ 条学习记录，分布在最近 6 个月的工作日/周末
      const today = new Date()
      const rows = []

      for (let i = 0; i < 60; i++) {
        const date = new Date(today)
        date.setDate(today.getDate() - i)

        // 每天 1~3 次学习，随机选择不同科目
        const timesPerDay = rand(1, 3)
        for (let t = 0; t < timesPerDay; t++) {
          const subjProf = pick(SUBJECT_PROFILE)
          const category = pick([
            ...(subjProf.study ? [1] : []),
            ...(subjProf.review ? [2] : []),
            ...(subjProf.practice ? [3] : []),
          ])
          const isSelf = Math.random() < 0.55 // ~55% 自主
          const form = isSelf ? pick(SELF_FORMS) : pick(FORMS.filter((f) => !SELF_FORMS.includes(f)))

          const mins = rand(subjProf.minsR[0], subjProf.minsR[1])

          // eval_type：~30% 是客观评估（category=3 时偏客观）
          const isObjective = category === 3 ? Math.random() < 0.55 : Math.random() < 0.15
          const eval_type = isObjective ? 2 : 1

          let score = null
          let self_rating = null
          let grade_label = null

          if (isObjective) {
            score = rand(subjProf.objective[0], subjProf.objective[1])
            grade_label = scoreToGradeLabel(score)
          } else {
            // 主观：self_rating 从 20,40,60,80,100 取一档
            self_rating = pick([20, 40, 60, 80, 100])
          }

          rows.push({
            student_id: user.id,
            course_id: subjectToCourse[subjProf.name],
            session_date: date.toISOString().slice(0, 10),
            duration_minutes: mins,
            category,
            form,
            eval_type,
            self_rating,
            grade_label,
            score,
          })
        }
      }

      append(`计划插入 ${rows.length} 条学习记录…`)

      // 批量插入（supabase single 上限，分批 50 条一批）
      let inserted = 0
      for (let i = 0; i < rows.length; i += 50) {
        const batch = rows.slice(i, i + 50)
        const { error } = await supabase.from('learning_sessions').insert(batch)
        if (error) throw error
        inserted += batch.length
        append(`已插入 ${inserted}/${rows.length} 条…`)
      }

      append('完成！回到 /review 页面查看效果')
    } catch (err) {
      console.error(err)
      append('错误：' + (err.message || JSON.stringify(err)))
    } finally {
      setBusy(false)
    }
  }

  // 清空该用户的所有学习记录（方便测试）
  async function clearAll() {
    if (!user) return
    if (!confirm('确定删除你账号下所有学习记录？此操作不可恢复。')) return
    setBusy(true)
    try {
      const { error } = await supabase
        .from('learning_sessions')
        .update({ deleted_at: new Date().toISOString() })
        .eq('student_id', user.id)
        .is('deleted_at', null)
      if (error) throw error
      append('已软删除全部学习记录')
    } catch (err) {
      append(err.message)
    } finally {
      setBusy(false)
    }
  }

  // =============================================================
  // 渲染
  // =============================================================
  return (
    <div style={{ padding: '20px 16px 140px', maxWidth: 760, margin: '0 auto', fontFamily: 'ui-sans-serif, system-ui, sans-serif', color: '#0f172a' }}>
      <h2 style={{ marginTop: 0 }}>Review 调试工具</h2>
      <p style={{ color: '#64748b', fontSize: 13 }}>
        {user ? `已登录：${user.email} (${user.id.slice(0, 8)}…)` : '未登录，请先在 /login 或 /signup 登录。'}
      </p>

      <div style={{ display: 'flex', gap: 10, margin: '16px 0 24px', flexWrap: 'wrap' }}>
        <button
          onClick={populate}
          disabled={busy || !user}
          style={{
            padding: '10px 16px', fontSize: 14, fontWeight: 600,
            background: '#6366f1', color: '#fff', border: 'none',
            borderRadius: 10, cursor: busy ? 'progress' : 'pointer',
            opacity: busy ? 0.7 : 1,
          }}
        >
          {busy ? '处理中…' : '生成 60 天假学习记录（6 科目 · 含客观评估）'}
        </button>
        <button
          onClick={clearAll}
          disabled={busy || !user}
          style={{
            padding: '10px 16px', fontSize: 14, fontWeight: 600,
            background: '#fff', color: '#dc2626', border: '1px solid #fca5a5',
            borderRadius: 10, cursor: 'pointer',
          }}
        >
          清空我的学习记录
        </button>
      </div>

      {/* ============================================================ */}
      {/* Letter Grade 不显示的诊断 */}
      {/* ============================================================ */}
      <div style={{ background: '#f1f5f9', borderRadius: 16, padding: 20, marginBottom: 24 }}>
        <h3 style={{ marginTop: 0, fontSize: 15 }}>Letter Grade 诊断</h3>

        <div style={{ fontSize: 13, lineHeight: 1.7, color: '#334155' }}>
          {Object.keys(objAggregate).length === 0 ? (
            <span style={{ color: '#94a3b8' }}>当前账号下没有 <code style={{ background: '#e2e8f0', padding: '1px 6px', borderRadius: 6 }}>eval_type=2</code> 且 <code style={{ background: '#e2e8f0', padding: '1px 6px', borderRadius: 6 }}>score 非空</code> 的记录。
            <br />→ 请点击上方"生成假数据"来填充；或手动在 /learning 添加带客观分数的练习。
            </span>
          ) : (
            <div>
              {Object.entries(objAggregate).map(([subj, v]) => (
                <div key={subj} style={{ marginBottom: 16 }}>
                  <div style={{ fontWeight: 600 }}>
                    {subj}：共 {v.count} 条客观评估，平均分 ≈ {(v.sum / v.count).toFixed(1)}
                    ，应显示为 <b>{scoreToGradeLabel(Math.round(v.sum / v.count))}</b>
                  </div>
                  <div style={{ fontSize: 12, color: '#64748b' }}>前 5 条原始行：</div>
                  {v.rows.slice(0, 5).map((r) => (
                    <div key={r.id} style={{ fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 11.5, color: '#334155' }}>
                      {r.date} | score={r.score}（{r.typeof_score}）| grade_label="{r.grade_label}" | eval_type={r.eval_type}（{r.typeof_eval}）
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={{ fontSize: 12, color: '#475569', marginTop: 16, lineHeight: 1.7 }}>
          <b>常见原因：</b>
          <ol style={{ paddingLeft: 20, margin: '6px 0' }}>
            <li><code>eval_type</code> 存的是 <code>字符串 "2"</code> / 数字 <code>2</code> / 其他枚举值？前端现在用 <code>Number(eval_type) === 2</code> 宽松比对。</li>
            <li><code>score</code> 为 <code>null</code> 或 0 —— 只有非空 score 才会计入平均分。</li>
            <li>课程没有 <code>subject</code> / 课程名 字段 → 会被归入"未分类"。</li>
            <li>两条客观评估的日期都在 180 天以前（本页拉取最近 180 天）。</li>
          </ol>
        </div>
      </div>

      {/* ============================================================ */}
      {/* 日志 */}
      {/* ============================================================ */}
      <div style={{
        background: '#0f172a', color: '#e2e8f0', padding: 16, borderRadius: 16,
        fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 12, lineHeight: 1.6,
        maxHeight: 260, overflowY: 'auto',
      }}>
        {log.length === 0 && <div style={{ color: '#64748b' }}>（暂无日志）</div>}
        {log.map((l, i) => <div key={i}>· {l}</div>)}
      </div>
    </div>
  )
}
