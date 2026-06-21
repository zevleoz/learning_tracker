// 老师端：
//   1) 列表页：展示 profiles 中 role=1 的所有学生，每行显示"邀请/已连接/等待中"状态按钮
//   2) 下拉选学生看 Review（只能选已连接学生），并显示该学生学习记录
//   3) 底部抽屉：点击行 → 打开详情；点击"发送邀请"按钮发起邀请
//
// 数据结构：
//   teacher_student_connections(id, teacher_id, student_id, status: 0=pending/1=accepted/2=rejected)
import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { toast } from '../lib/toast.js';
import { ReviewDashboard } from './Review.jsx';

function fmtMinutes(mins) {
  if (!mins) return '0 分钟';
  if (mins < 60) return mins + ' 分钟';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h}h ${m}min` : `${h} 小时`;
}

function dateISO(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export default function Mentor() {
  const [user, setUser] = useState(null);
  const [students, setStudents] = useState([]);          // [{id, full_name, created_at}]
  const [connections, setConnections] = useState({});     // { studentId: {id, status, ...} }
  const [picked, setPicked] = useState(null);            // 当前选中的学生（必须已连接才能看数据）
  const [sessions, setSessions] = useState([]);           // 该学生的 sessions
  const [busy, setBusy] = useState(false);
  const [deployCheck, setDeployCheck] = useState({ ok: true, message: '' });

  // ---- 登录态 ----
  useEffect(() => {
    (async () => {
      const { data: { user: u } } = await supabase.auth.getUser();
      if (!u) return;
      setUser(u);

      // 拉取 profiles(role=1) + 我发出的连接
      const [pRes, cRes] = await Promise.all([
        supabase
          .from('profiles')
          .select('id, role, full_name, school_id, created_at')
          .in('role', [1])
          .order('created_at', { ascending: false })
          .limit(500),
        supabase
          .from('teacher_student_connections')
          .select('id, student_id, status, note, created_at')
          .eq('teacher_id', u.id),
      ]);

      // 诊断：如果表还没创建或 RLS 策略没跑，给用户一个明确提示
      if (cRes && cRes.error) {
        const code = cRes.error.code || '';
        const hint = code === '42P01' || /relation.*does not exist/i.test(cRes.error.message)
          ? '需要在 Supabase SQL Editor 运行 schema.patch-invites.sql 创建邀请表。'
          : '请检查数据库表和 RLS 策略是否已部署。';
        setDeployCheck({ ok: false, message: `邀请系统未就绪（${cRes.error.code || 'error'}: ${cRes.error.message}）— ${hint}` });
      } else {
        // 进一步检查：当前 profile 是否真的在数据库里 role>=2
        // （user_metadata 可能与实际 profile 不一致）
        const pRes2 = await supabase
          .from('profiles')
          .select('id, role, full_name')
          .eq('id', u.id)
          .single();
        if (pRes2.error) {
          setDeployCheck({ ok: false, message: `无法读取你的老师身份（${pRes2.error.code}: ${pRes2.error.message}）— 请先在 Supabase Auth 中完成注册并同步 profile.role=2。` });
        } else if (Number(pRes2.data.role) < 2) {
          setDeployCheck({ ok: false, message: `当前账号 role=${pRes2.data.role}，老师端需要 role>=2。请在注册页选择"我是老师"后进入。` });
        }
      }

      setStudents(pRes.data || []);
      const map = {};
      for (const c of (cRes.data || [])) map[c.student_id] = c;
      setConnections(map);
    })();
  }, []);

  // ---- 选中学生后：拉取他的学习记录（仅已连接才能拿到数据）----
  useEffect(() => {
    if (!picked) return setSessions([]);
    let cancelled = false;
    setBusy(true);
    supabase
      .from('learning_sessions')
      .select(`
        id, session_date, duration_minutes, category, form, eval_type,
        score, course_id, course:course_id(name, subject)
      `)
      .eq('student_id', picked.id)
      .order('session_date', { ascending: false })
      .limit(2000)
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          console.error('mentor load sessions', error);
          toast('加载学生学习记录失败：' + error.message, { kind: 'error' });
          setSessions([]);
        } else {
          setSessions(
            (data || []).map((s) => ({
              ...s,
              date: String(s.session_date || '').slice(0, 10),
              subject: s.course?.subject || s.course?.name || '未分类',
            }))
          );
        }
        setBusy(false);
      });
    return () => { cancelled = true; };
  }, [picked]);

  // ---- 动作：发送邀请 / 撤回 / 重新邀请 ----
  async function sendInvite(studentId, note = '') {
    if (!user) {
      toast('请先登录老师账号', { kind: 'error' });
      return;
    }
    if (!deployCheck.ok) {
      toast('邀请系统尚未部署完成，请先运行 schema.patch-invites.sql', { kind: 'error' });
      return;
    }
    try {
      const { error } = await supabase
        .from('teacher_student_connections')
        .insert({ teacher_id: user.id, student_id: studentId, status: 0, note });
      if (error) throw error;
      // 成功：本地乐观更新
      setConnections((m) => ({
        ...m,
        [studentId]: { id: 'new', student_id: studentId, status: 0, note, created_at: new Date().toISOString() },
      }));
      toast('已发送邀请，等待学生接受。', { kind: 'success' });
    } catch (err) {
      console.error('sendInvite failed:', err);
      const code = err && err.code;
      const msg = err && err.message;
      // 42P01 = relation does not exist（表没建）
      if (code === '42P01' || /relation.*does not exist/i.test(msg || '')) {
        toast('邀请表未创建。请在 Supabase SQL Editor 运行 schema.patch-invites.sql。', { kind: 'error' });
      } else if (code === '23505' || /unique.*constraint/i.test(msg || '')) {
        toast('该学生已经被邀请过了', { kind: 'error' });
      } else if (msg && /new row violates row-level security/i.test(msg)) {
        toast('RLS 策略拦截：当前账号不是老师（role>=2）或 teacher_id 不等于你。请确认注册时选择了"我是老师"。', { kind: 'error' });
      } else {
        toast(`邀请失败（${code || 'error'}: ${msg || '未知错误'}）`, { kind: 'error' });
      }
    }
  }

  async function withdrawInvite(studentId) {
    if (!confirm('确定撤回这封邀请吗？')) return;
    const c = connections[studentId];
    if (!c || c.status !== 0) return;
    try {
      const { error } = await supabase
        .from('teacher_student_connections')
        .delete()
        .match({ teacher_id: user.id, student_id: studentId });
      if (error) throw error;
      setConnections((m) => {
        const next = { ...m };
        delete next[studentId];
        return next;
      });
      toast('已撤回邀请', { kind: 'success' });
    } catch (err) {
      console.error('withdrawInvite failed:', err);
      const code = err && err.code;
      const msg = err && err.message;
      toast(`撤回失败（${code || 'error'}: ${msg || '未知错误'}）`, { kind: 'error' });
    }
  }

  // ---- 统计小数据 ----
  const stats = useMemo(() => {
    const invited = Object.values(connections).filter((c) => c.status === 0).length;
    const connected = Object.values(connections).filter((c) => c.status === 1).length;
    const rejected = Object.values(connections).filter((c) => c.status === 2).length;
    return { total: students.length, invited, connected, rejected };
  }, [students, connections]);

  // ---- UI ----
  if (!user) {
    return (
      <div style={{ padding: 40, fontSize: 14, color: '#475569' }}>
        正在加载…（请确认你是以老师账号登录）
      </div>
    );
  }

  return (
    <div className="mentor-page" style={{ padding: '16px 16px 120px', maxWidth: 900, margin: '0 auto' }}>
      <header>
        <h1 style={{ fontSize: 22, margin: '8px 0 4px' }}>导师视图</h1>
        <p style={{ color: '#64748b', fontSize: 13, margin: 0 }}>
          下方是所有注册了的学生。点击“发送邀请”，学生接受后你就能看到他的学习数据与 Review。
        </p>
      </header>

      {!deployCheck.ok && (
        <section style={{
          marginTop: 16, padding: '14px 16px', borderRadius: 12,
          background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)',
          color: '#7f1d1d', fontSize: 13, lineHeight: 1.55,
        }}>
          <b style={{ fontSize: 14 }}>⚠️ 邀请系统未就绪</b>
          <div style={{ marginTop: 4 }}>{deployCheck.message}</div>
          <div style={{ marginTop: 8, fontSize: 12, color: '#991b1b' }}>
            请打开项目根目录下的 <code>supabase/schema.patch-invites.sql</code>，
            复制全部内容到 Supabase Console → SQL Editor → 执行。完成后刷新本页。
          </div>
        </section>
      )}

      {/* 数据概览 */}
      <section className="glass-card" style={{ marginTop: 16 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
          <SmallStat label="学生总数" value={stats.total} color="#64748b" />
          <SmallStat label="已连接" value={stats.connected} color="#10b981" />
          <SmallStat label="邀请中" value={stats.invited} color="#f59e0b" />
          <SmallStat label="被拒绝" value={stats.rejected} color="#ef4444" />
        </div>
      </section>

      {/* 学生 Review 看板 */}
      {stats.connected > 0 && (
        <section className="glass-card" style={{ marginTop: 16 }}>
          <div className="field" style={{ marginBottom: 8 }}>
            <label>查看某学生的 Review（下拉中只有你已连接的学生）</label>
            <select
              value={picked?.id || ''}
              onChange={(e) => {
                const id = e.target.value;
                if (!id) return setPicked(null);
                const stu = students.find((x) => x.id === id);
                setPicked(stu || null);
              }}
              style={{ width: '100%' }}
            >
              <option value="">-- 选择学生 --</option>
              {students
                .filter((s) => connections[s.id]?.status === 1)
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.full_name || '(未命名)'}
                  </option>
                ))}
            </select>
          </div>

          {picked && (
            <div style={{ marginTop: 8 }}>
              {busy ? (
                <p style={{ color: '#94a3b8', fontSize: 13 }}>加载中…</p>
              ) : (
                <div>
                  <div style={{
                    padding: '12px 16px', fontSize: 13, color: '#334155',
                    background: 'rgba(99,102,241,0.06)',
                    border: '1px solid rgba(99,102,241,0.2)',
                    borderRadius: 10, marginBottom: 12,
                  }}>
                    <b>{picked.full_name || '(未命名)'}</b> · 最近学习记录 {sessions.length} 条 ·
                    累计 {fmtMinutes(sessions.reduce((a, s) => a + (s.duration_minutes || 0), 0))}
                  </div>
                  {sessions.length > 0 ? (
                    <ReviewDashboard sessions={sessions} />
                  ) : (
                    <EmptyBlock text="该学生暂无学习记录。" />
                  )}
                </div>
              )}
            </div>
          )}
        </section>
      )}

      {/* 学生列表（邀请） */}
      <section className="glass-card" style={{ marginTop: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <h2 style={{ fontSize: 15, margin: 0 }}>学生列表</h2>
          <span style={{ fontSize: 12, color: '#94a3b8' }}>共 {students.length} 位</span>
        </div>

        {students.length === 0 ? (
          <EmptyBlock text="暂无学生注册。" sub="让学生在你的学校注册，他们出现后你可以在这里发送邀请。" />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
            {students.map((s) => {
              const c = connections[s.id];
              return (
                <StudentRow
                  key={s.id}
                  student={s}
                  connection={c || null}
                  onInvite={() => sendInvite(s.id)}
                  onWithdraw={() => withdrawInvite(s.id)}
                  onPick={() => {
                    if (c?.status === 1) setPicked(s);
                  }}
                />
              );
            })}
          </div>
        )}
      </section>

      <style>{`
        .glass-card {
          background: rgba(255,255,255,0.4);
          border: 1px solid rgba(255,255,255,0.4);
          backdrop-filter: blur(20px);
          -webkit-backdrop-filter: blur(20px);
          padding: 16px;
          border-radius: 16px;
        }
        .mentor-page select, .mentor-page input {
          background: rgba(255,255,255,0.7);
          border: 1px solid rgba(15,23,42,0.1);
          border-radius: 10px;
          padding: 8px 10px;
          font-size: 13px;
          color: #0f172a;
        }
      `}</style>
    </div>
  );
}

function SmallStat({ label, value, color }) {
  return (
    <div style={{
      background: 'rgba(255,255,255,0.55)',
      border: '1px solid rgba(15,23,42,0.06)',
      borderRadius: 12, padding: '10px 12px', textAlign: 'center',
    }}>
      <div style={{ fontSize: 11, color: '#64748b' }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color, fontFamily: 'ui-monospace, Menlo, monospace', lineHeight: 1.1, marginTop: 4 }}>
        {value}
      </div>
    </div>
  );
}

function EmptyBlock({ text, sub }) {
  return (
    <div style={{
      padding: 28, textAlign: 'center', fontSize: 13, color: '#64748b',
      background: 'rgba(255,255,255,0.3)', borderRadius: 12,
    }}>
      <div style={{ marginBottom: 4 }}>{text}</div>
      {sub && <div style={{ fontSize: 12, color: '#94a3b8' }}>{sub}</div>}
    </div>
  );
}

function StudentRow({ student, connection, onInvite, onWithdraw, onPick }) {
  const status = connection?.status ?? -1; // -1=未邀请 0=等待 1=已连接 2=拒绝
  const name = student.full_name || '(未命名)';

  const statusPill = (() => {
    switch (status) {
      case 1: return <Pill color="#10b981">已连接</Pill>;
      case 0: return <Pill color="#f59e0b">等待学生接受</Pill>;
      case 2: return <Pill color="#ef4444">已拒绝</Pill>;
      default: return <Pill color="#64748b">未邀请</Pill>;
    }
  })();

  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      gap: 12, padding: '10px 12px', borderRadius: 12,
      background: 'rgba(255,255,255,0.55)',
      border: '1px solid rgba(15,23,42,0.06)',
    }}>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 14, fontWeight: 500, color: '#0f172a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {name}
        </div>
        <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>
          注册时间：{String(student.created_at || '').slice(0, 10)}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
        {statusPill}
        {status === -1 && (
          <button className="btn btn-primary" onClick={onInvite} style={{ fontSize: 12, padding: '6px 12px' }}>
            发送邀请
          </button>
        )}
        {status === 0 && (
          <button className="btn" onClick={onWithdraw} style={{ fontSize: 12, padding: '6px 10px' }}>
            撤回
          </button>
        )}
        {(status === 0 || status === 2) && (
          <button className="btn" onClick={onInvite} style={{ fontSize: 12, padding: '6px 10px' }}>
            {status === 2 ? '再次邀请' : '重发'}
          </button>
        )}
        {status === 1 && (
          <button className="btn btn-primary" onClick={onPick} style={{ fontSize: 12, padding: '6px 12px' }}>
            查看 Review
          </button>
        )}
      </div>

      <style>{`
        .btn { padding: 8px 14px; font-size: 13px; border-radius: 10px; border: 1px solid rgba(15,23,42,0.15); background: #fff; color: #0f172a; cursor: pointer; }
        .btn-primary { background: #6366f1; color: #fff; border: 1px solid #6366f1; }
        .btn-primary:hover { background: #4f46e5; }
      `}</style>
    </div>
  );
}

function Pill({ children, color }) {
  return (
    <span style={{
      fontSize: 11, fontWeight: 600, padding: '3px 8px', borderRadius: 999,
      color, background: color + '22', border: `1px solid ${color}55`, whiteSpace: 'nowrap',
    }}>
      {children}
    </span>
  );
}

// 让 StudentRow / Pill 不 lint warning
export { dateISO };
