import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { toast } from '../lib/toast.js';
import { ReviewDashboard } from '../components/SharedDashboard.jsx';
import MentorLayout from '../components/MentorLayout.jsx';
import MentorAnalyticsPage from './MentorAnalytics.jsx';

function fmtMinutes(mins) {
  if (!mins) return '0 分钟';
  if (mins < 60) return mins + ' 分钟';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h}h ${m}min` : `${h} 小时`;
}

export default function Mentor() {
  const [user, setUser] = useState(null);
  const [students, setStudents] = useState([]);
  const [connections, setConnections] = useState([]);
  const [picked, setPicked] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [busy, setBusy] = useState(false);
  const [deployCheck, setDeployCheck] = useState({ ok: true, message: '' });
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterSchool, setFilterSchool] = useState('all');
  const [activeView, setActiveView] = useState('students');
  const [inviteNotes, setInviteNotes] = useState({});
  const [sub, setSub] = useState(null);
  const [schools, setSchools] = useState([]);
  const [classStats, setClassStats] = useState({});
  const [editingSchoolId, setEditingSchoolId] = useState(null);
  const [editingSchoolValue, setEditingSchoolValue] = useState('');

  useEffect(() => {
    (async () => {
      const { data: { user: u } } = await supabase.auth.getUser();
      if (!u) return;
      setUser(u);
      await loadData(u.id);
    })();
  }, []);

  async function loadData(teacherId) {
    console.log('===== 老师端加载数据 =====');
    console.log('teacherId:', teacherId);

    const [pRes, cRes, sRes] = await Promise.all([
      supabase
        .from('profiles')
        .select('id, role, full_name, school_name, created_at')
        .in('role', [1])
        .order('created_at', { ascending: false })
        .limit(500),
      supabase
        .from('teacher_student_connections')
        .select('id, student_id, status, note, created_at, updated_at')
        .eq('teacher_id', teacherId),
      supabase
        .from('profiles')
        .select('school_name')
        .in('role', [1])
        .not('school_name', 'is', null)
        .not('school_name', 'eq', ''),
    ]);

    console.log('profiles 查询结果:', pRes);
    console.log('connections 查询结果:', cRes);
    console.log('schools 查询结果:', sRes);

    if (pRes.error) {
      console.error('profiles 查询错误:', pRes.error);
      setDeployCheck({ ok: false, message: `无法获取学生列表：${pRes.error.message}` });
    }

    if (cRes && cRes.error) {
      const code = cRes.error.code || '';
      const hint = code === '42P01' || /relation.*does not exist/i.test(cRes.error.message)
        ? '需要在 Supabase SQL Editor 运行 schema.patch-invites.sql 创建邀请表。'
        : '请检查数据库表和 RLS 策略是否已部署。';
      setDeployCheck({ ok: false, message: `邀请系统未就绪（${cRes.error.code || 'error'}: ${cRes.error.message}）— ${hint}` });
    } else if (user) {
      const pRes2 = await supabase
        .from('profiles')
        .select('id, role, full_name')
        .eq('id', user.id)
        .single();
      console.log('老师身份查询结果:', pRes2);
      if (pRes2.error) {
        setDeployCheck({ ok: false, message: `无法读取你的老师身份（${pRes2.error.code}: ${pRes2.error.message}）` });
      } else if (Number(pRes2.data.role) < 2) {
        setDeployCheck({ ok: false, message: `当前账号 role=${pRes2.data.role}，老师端需要 role>=2。` });
      }
    }

    setStudents(pRes.data || []);
    const map = {};
    for (const c of (cRes.data || [])) map[c.student_id] = c;
    setConnections(map);

    const schoolSet = new Set((sRes.data || []).map((p) => p.school_name).filter(Boolean));
    setSchools(Array.from(schoolSet).sort());

    await loadClassStats(teacherId);
  }

  async function loadClassStats(teacherId) {
    const connectedStudents = Object.values(connections)
      .filter((c) => c.status === 1)
      .map((c) => c.student_id);

    if (connectedStudents.length === 0) {
      setClassStats({
        totalStudents: 0,
        avgDailyMinutes: 0,
        avgScore: 0,
        activeStudents: 0,
      });
      return;
    }

    const { data: sessionData, error } = await supabase
      .from('learning_sessions')
      .select('student_id, duration_minutes, eval_type, score')
      .in('student_id', connectedStudents)
      .gte('session_date', new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString().slice(0, 10));

    if (error) {
      console.error('loadClassStats error:', error);
      return;
    }

    const studentMins = {};
    let totalScore = 0;
    let scoreCount = 0;

    for (const s of sessionData || []) {
      const sid = s.student_id;
      studentMins[sid] = (studentMins[sid] || 0) + (s.duration_minutes || 0);
      if (Number(s.eval_type) === 2 && s.score != null) {
        totalScore += Number(s.score);
        scoreCount++;
      }
    }

    const totalMins = Object.values(studentMins).reduce((a, b) => a + b, 0);
    const activeStudents = Object.keys(studentMins).length;

    setClassStats({
      totalStudents: connectedStudents.length,
      avgDailyMinutes: connectedStudents.length > 0 ? Math.round(totalMins / connectedStudents.length / 7) : 0,
      avgScore: scoreCount > 0 ? Math.round(totalScore / scoreCount) : 0,
      activeStudents,
    });
  }

  function startRealtime(teacherId) {
    if (sub) {
      sub.unsubscribe();
    }
    const channelName = `teacher_connections_${teacherId}`;
    const subscription = supabase
      .channel(channelName)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'teacher_student_connections',
        filter: `teacher_id=eq.${teacherId}`,
      }, (payload) => {
        console.log('Connection realtime event:', payload);
        loadData(teacherId);
      })
      .subscribe();
    setSub(subscription);
  }

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

  async function sendInvite(studentId) {
    if (!user) { toast('请先登录老师账号', { kind: 'error' }); return; }
    if (!deployCheck.ok) { toast('邀请系统尚未部署完成', { kind: 'error' }); return; }
    const note = inviteNotes[studentId] || '';
    try {
      const { error } = await supabase
        .from('teacher_student_connections')
        .insert({ teacher_id: user.id, student_id: studentId, status: 0, note });
      if (error) throw error;
      setConnections((m) => ({
        ...m,
        [studentId]: { id: 'new', student_id: studentId, status: 0, note, created_at: new Date().toISOString() },
      }));
      setInviteNotes((m) => ({ ...m, [studentId]: '' }));
      toast('已发送邀请，等待学生接受。', { kind: 'success' });
    } catch (err) {
      console.error('sendInvite failed:', err);
      const code = err && err.code;
      const msg = err && err.message;
      if (code === '42P01' || /relation.*does not exist/i.test(msg || '')) {
        toast('邀请表未创建。请在 Supabase SQL Editor 运行 schema.patch-invites.sql。', { kind: 'error' });
      } else if (code === '23505' || /unique.*constraint/i.test(msg || '')) {
        toast('该学生已经被邀请过了', { kind: 'error' });
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
      setConnections((m) => { const next = { ...m }; delete next[studentId]; return next; });
      toast('已撤回邀请', { kind: 'success' });
    } catch (err) {
      console.error('withdrawInvite failed:', err);
      toast(`撤回失败`, { kind: 'error' });
    }
  }

  async function disconnectStudent(studentId) {
    if (!confirm('确定断开与这位学生的连接吗？断开后将无法查看他的学习数据。')) return;
    const c = connections[studentId];
    if (!c || c.status !== 1) return;
    try {
      const { error } = await supabase
        .from('teacher_student_connections')
        .update({ status: 2, updated_at: new Date().toISOString() })
        .match({ teacher_id: user.id, student_id: studentId });
      if (error) throw error;
      setConnections((m) => ({ ...m, [studentId]: { ...c, status: 2, updated_at: new Date().toISOString() } }));
      if (picked?.id === studentId) setPicked(null);
      toast('已断开连接', { kind: 'success' });
    } catch (err) {
      console.error('disconnectStudent failed:', err);
      toast(`断开失败`, { kind: 'error' });
    }
  }

  async function saveSchoolName(studentId, newSchool) {
    if (!newSchool.trim()) {
      toast('学校名称不能为空', { kind: 'error' });
      return;
    }
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ school_name: newSchool.trim(), updated_at: new Date().toISOString() })
        .eq('id', studentId);
      if (error) throw error;
      setStudents((prev) => prev.map((s) => s.id === studentId ? { ...s, school_name: newSchool.trim() } : s));
      setSchools((prev) => {
        const updated = [...prev.filter((s) => s !== studentId), newSchool.trim()];
        return [...new Set(updated)].sort();
      });
      setEditingSchoolId(null);
      setEditingSchoolValue('');
      toast('学校名称已更新', { kind: 'success' });
    } catch (err) {
      console.error('saveSchoolName failed:', err);
      toast(`更新失败：${err.message}`, { kind: 'error' });
    }
  }

  const stats = useMemo(() => {
    const invited = Object.values(connections).filter((c) => c.status === 0).length;
    const connected = Object.values(connections).filter((c) => c.status === 1).length;
    const rejected = Object.values(connections).filter((c) => c.status === 2).length;
    return { total: students.length, invited, connected, rejected };
  }, [students, connections]);

  const filteredStudents = useMemo(() => {
    return students.filter((s) => {
      const name = s.full_name || '';
      const matchesSearch = name.toLowerCase().includes(searchQuery.toLowerCase());
      
      const matchesSchool = filterSchool === 'all' || s.school_name === filterSchool;
      
      const conn = connections[s.id];
      let matchesFilter = true;
      if (filterStatus === 'connected') matchesFilter = conn?.status === 1;
      else if (filterStatus === 'invited') matchesFilter = conn?.status === 0;
      else if (filterStatus === 'rejected') matchesFilter = conn?.status === 2;
      else if (filterStatus === 'uninvited') matchesFilter = !conn;
      return matchesSearch && matchesSchool && matchesFilter;
    });
  }, [students, connections, searchQuery, filterStatus, filterSchool]);

  if (!user) {
    return (
      <div className="mentor-page" style={{ padding: 40, fontSize: 14, color: '#475569' }}>
        正在加载…（请确认你是以老师账号登录）
      </div>
    );
  }

  const isDesktop = window.innerWidth > 768;

  if (isDesktop) {
    return (
      <MentorLayout activeView={activeView} onViewChange={setActiveView}>
        <div className="mentor-desktop-content">
          {!deployCheck.ok && (
            <div className="mentor-alert mentor-alert-error">
              <strong>⚠️ 邀请系统未就绪</strong>
              <div>{deployCheck.message}</div>
            </div>
          )}

          {activeView === 'students' && (
            <div className="mentor-students-page">
              <div className="mentor-page-header">
                <div>
                  <h1 className="mentor-page-title">学生管理</h1>
                  <p className="mentor-page-subtitle">管理你的学生连接和查看学习数据</p>
                </div>
              </div>



              <div className="mentor-main-layout">
                <div className="mentor-student-list-panel">
                  <div className="mentor-class-overview">
                    <div className="mentor-class-stat">
                      <div className="mentor-class-stat-value">{classStats.totalStudents || 0}</div>
                      <div className="mentor-class-stat-label">已连接学生</div>
                    </div>
                    <div className="mentor-class-stat">
                      <div className="mentor-class-stat-value">{classStats.activeStudents || 0}</div>
                      <div className="mentor-class-stat-label">本周活跃</div>
                    </div>
                    <div className="mentor-class-stat">
                      <div className="mentor-class-stat-value">{classStats.avgDailyMinutes || 0}m</div>
                      <div className="mentor-class-stat-label">日均学习</div>
                    </div>
                    <div className="mentor-class-stat">
                      <div className="mentor-class-stat-value">{classStats.avgScore || 0}</div>
                      <div className="mentor-class-stat-label">平均分数</div>
                    </div>
                  </div>

                  <div className="mentor-panel-header">
                    <h2 className="mentor-panel-title">学生列表</h2>
                    <span className="mentor-panel-count">{filteredStudents.length} 位学生</span>
                  </div>

                  <div className="mentor-search-bar">
                    <input
                      type="text"
                      placeholder="搜索学生姓名…"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="mentor-search-input"
                    />
                    <select
                      value={filterSchool}
                      onChange={(e) => setFilterSchool(e.target.value)}
                      className="mentor-filter-select"
                    >
                      <option value="all">所有学校</option>
                      {schools.map((school) => (
                        <option key={school} value={school}>{school}</option>
                      ))}
                    </select>
                    <select
                      value={filterStatus}
                      onChange={(e) => setFilterStatus(e.target.value)}
                      className="mentor-filter-select"
                    >
                      <option value="all">全部状态</option>
                      <option value="connected">已连接</option>
                      <option value="invited">邀请中</option>
                      <option value="rejected">已拒绝</option>
                      <option value="uninvited">未邀请</option>
                    </select>
                  </div>

                  <div className="mentor-student-table-container">
                    <table className="mentor-student-table">
                      <thead>
                        <tr>
                          <th>学生姓名</th>
                          <th>学校</th>
                          <th>注册时间</th>
                          <th>状态</th>
                          <th>操作</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredStudents.map((s) => {
                          const conn = connections[s.id];
                          const status = conn?.status ?? -1;
                          const isEditingSchool = editingSchoolId === s.id;
                          return (
                            <tr
                              key={s.id}
                              onClick={() => status === 1 && setPicked(s)}
                              className={`mentor-table-row ${status === 1 ? 'mentor-table-row-clickable' : ''} ${picked?.id === s.id ? 'mentor-table-row-selected' : ''}`}
                            >
                              <td>
                                <div className="mentor-table-name">{s.full_name || '(未命名)'}</div>
                              </td>
                              <td>
                                {isEditingSchool ? (
                                  <div className="mentor-school-edit">
                                    <input
                                      type="text"
                                      value={editingSchoolValue}
                                      onChange={(e) => setEditingSchoolValue(e.target.value)}
                                      className="mentor-school-input"
                                      autoFocus
                                      onKeyDown={(e) => {
                                        if (e.key === 'Enter') {
                                          e.stopPropagation();
                                          saveSchoolName(s.id, editingSchoolValue);
                                        } else if (e.key === 'Escape') {
                                          e.stopPropagation();
                                          setEditingSchoolId(null);
                                          setEditingSchoolValue('');
                                        }
                                      }}
                                    />
                                    <button className="mentor-school-btn-save" onClick={(e) => { e.stopPropagation(); saveSchoolName(s.id, editingSchoolValue); }}>✓</button>
                                    <button className="mentor-school-btn-cancel" onClick={(e) => { e.stopPropagation(); setEditingSchoolId(null); setEditingSchoolValue(''); }}>✕</button>
                                  </div>
                                ) : (
                                  <div className="mentor-table-school">
                                    {s.school_name || '-'}
                                    <button className="mentor-school-edit-btn" onClick={(e) => { e.stopPropagation(); setEditingSchoolId(s.id); setEditingSchoolValue(s.school_name || ''); }}>✏️</button>
                                  </div>
                                )}
                              </td>
                              <td className="mentor-table-date">
                                {String(s.created_at || '').slice(0, 10)}
                              </td>
                              <td>
                                <span className={`mentor-status-pill mentor-status-${status === 1 ? 'connected' : status === 0 ? 'invited' : status === 2 ? 'rejected' : 'uninvited'}`}>
                                  {status === 1 ? '已连接' : status === 0 ? '邀请中' : status === 2 ? '已拒绝' : '未邀请'}
                                </span>
                              </td>
                              <td className="mentor-table-actions">
                                {status === -1 && (
                                  <div className="mentor-invite-group">
                                    <input
                                      type="text"
                                      placeholder="邀请备注（可选）"
                                      value={inviteNotes[s.id] || ''}
                                      onChange={(e) => setInviteNotes((m) => ({ ...m, [s.id]: e.target.value }))}
                                      className="mentor-invite-note"
                                    />
                                    <button className="mentor-btn mentor-btn-primary" onClick={(e) => { e.stopPropagation(); sendInvite(s.id); }}>
                                      发送邀请
                                    </button>
                                  </div>
                                )}
                                {status === 0 && (
                                  <>
                                    <button className="mentor-btn mentor-btn-secondary" onClick={(e) => { e.stopPropagation(); withdrawInvite(s.id); }}>
                                      撤回
                                    </button>
                                    <button className="mentor-btn mentor-btn-primary" onClick={(e) => { e.stopPropagation(); sendInvite(s.id); }}>
                                      重发
                                    </button>
                                  </>
                                )}
                                {status === 2 && (
                                  <button className="mentor-btn mentor-btn-primary" onClick={(e) => { e.stopPropagation(); sendInvite(s.id); }}>
                                    再次邀请
                                  </button>
                                )}
                                {status === 1 && (
                                  <>
                                    <button className="mentor-btn mentor-btn-primary" onClick={(e) => { e.stopPropagation(); setPicked(s); }}>
                                      查看数据
                                    </button>
                                    <button className="mentor-btn mentor-btn-secondary" onClick={(e) => { e.stopPropagation(); disconnectStudent(s.id); }}>
                                      断开
                                    </button>
                                  </>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>

                    {filteredStudents.length === 0 && (
                      <div className="mentor-empty-state">
                        <div>暂无学生</div>
                        <div className="mentor-empty-sub">让学生注册后，他们会出现在这里</div>
                      </div>
                    )}
                  </div>
                </div>

                <div className="mentor-detail-panel">
                  {picked ? (
                    <>
                      <div className="mentor-panel-header">
                        <h2 className="mentor-panel-title">{picked.full_name || '学生'} 的学习数据</h2>
                        <button className="mentor-close-detail" onClick={() => setPicked(null)}>关闭</button>
                      </div>

                      {busy ? (
                        <div className="mentor-loading">加载中…</div>
                      ) : (
                        <div className="mentor-detail-content">
                          <div className="mentor-student-summary">
                            <div className="mentor-summary-item">
                              <span className="mentor-summary-label">学习记录</span>
                              <span className="mentor-summary-value">{sessions.length} 条</span>
                            </div>
                            <div className="mentor-summary-item">
                              <span className="mentor-summary-label">累计时长</span>
                              <span className="mentor-summary-value">{fmtMinutes(sessions.reduce((a, s) => a + (s.duration_minutes || 0), 0))}</span>
                            </div>
                          </div>

                          {sessions.length > 0 ? (
                            <ReviewDashboard sessions={sessions} />
                          ) : (
                            <div className="mentor-empty-state">
                              <div>该学生暂无学习记录</div>
                            </div>
                          )}
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="mentor-detail-placeholder">
                      <div className="mentor-detail-placeholder-icon">📊</div>
                      <div className="mentor-detail-placeholder-title">选择学生查看数据</div>
                      <div className="mentor-detail-placeholder-desc">从左侧列表选择已连接的学生，查看他们的学习分析报告</div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {activeView === 'analytics' && (
            <MentorAnalyticsPage 
              user={user} 
              students={students} 
              connections={Array.isArray(connections) ? connections : Object.values(connections)}
              onSelectStudent={(s) => { setPicked(s); setActiveView('students'); }}
            />
          )}

          {activeView === 'settings' && (
            <div className="mentor-settings-page">
              <div className="mentor-page-header">
                <h1 className="mentor-page-title">系统设置</h1>
                <p className="mentor-page-subtitle">管理你的导师账号和系统配置</p>
              </div>
              <div className="mentor-empty-state">
                <div>系统设置功能即将上线</div>
                <div className="mentor-empty-sub">敬请期待更多设置选项</div>
              </div>
            </div>
          )}
        </div>
      </MentorLayout>
    );
  }

  return (
    <div className="mentor-page" style={{ padding: '16px 16px 120px', maxWidth: 900, margin: '0 auto' }}>
      <header>
        <h1 style={{ fontSize: 22, margin: '8px 0 4px' }}>导师视图</h1>
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <button
            onClick={() => setActiveView('students')}
            className={`mentor-tab-btn ${activeView === 'students' ? 'mentor-tab-btn-active' : ''}`}
          >
            学生管理
          </button>
          <button
            onClick={() => setActiveView('analytics')}
            className={`mentor-tab-btn ${activeView === 'analytics' ? 'mentor-tab-btn-active' : ''}`}
          >
            数据分析
          </button>
        </div>
      </header>

      {activeView === 'students' ? (
        <>
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

          <section className="glass-card" style={{ marginTop: 16 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
              <SmallStat label="学生总数" value={stats.total} color="#64748b" />
              <SmallStat label="已连接" value={stats.connected} color="#10b981" />
              <SmallStat label="邀请中" value={stats.invited} color="#f59e0b" />
              <SmallStat label="被拒绝" value={stats.rejected} color="#ef4444" />
            </div>
          </section>

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
                      onPick={() => { if (c?.status === 1) setPicked(s); }}
                      onEditSchool={() => { setEditingSchoolId(s.id); setEditingSchoolValue(s.school_name || ''); }}
                    />
                  );
                })}
              </div>
            )}
          </section>

          {editingSchoolId && (
            <section className="glass-card" style={{ marginTop: 16, position: 'sticky', top: 16, zIndex: 100 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <h3 style={{ fontSize: 14, margin: 0 }}>修改学校名称</h3>
                <button onClick={() => { setEditingSchoolId(null); setEditingSchoolValue(''); }} style={{
                  fontSize: 16, color: '#94a3b8', background: 'none', border: 'none', cursor: 'pointer'
                }}>✕</button>
              </div>
              <input
                type="text"
                value={editingSchoolValue}
                onChange={(e) => setEditingSchoolValue(e.target.value)}
                placeholder="请输入学校名称"
                style={{ width: '100%', marginBottom: 8 }}
                autoFocus
              />
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => { setEditingSchoolId(null); setEditingSchoolValue(''); }} style={{
                  flex: 1, padding: '8px', borderRadius: 10, border: '1px solid rgba(15,23,42,0.15)',
                  background: '#fff', color: '#0f172a', cursor: 'pointer'
                }}>取消</button>
                <button onClick={() => saveSchoolName(editingSchoolId, editingSchoolValue)} style={{
                  flex: 1, padding: '8px', borderRadius: 10, background: '#6366f1',
                  color: '#fff', border: 'none', cursor: 'pointer'
                }}>保存</button>
              </div>
            </section>
          )}
        </>
      ) : (
        <MentorAnalyticsPage 
          user={user} 
          students={students} 
          connections={Array.isArray(connections) ? connections : Object.values(connections)}
          onSelectStudent={(s) => { setPicked(s); setActiveView('students'); }}
        />
      )}

      <style>{`
        .mentor-tab-btn {
          padding: 6px 16px;
          border-radius: 20px;
          font-size: 13px;
          background: rgba(255,255,255,0.5);
          border: 1px solid rgba(15,23,42,0.08);
          color: #64748b;
          transition: all 0.2s;
        }
        .mentor-tab-btn:hover {
          background: rgba(255,255,255,0.8);
        }
        .mentor-tab-btn-active {
          background: #6366f1;
          border-color: #6366f1;
          color: white;
        }
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

function StudentRow({ student, connection, onInvite, onWithdraw, onPick, onEditSchool }) {
  const status = connection?.status ?? -1;
  const name = student.full_name || '(未命名)';
  const school = student.school_name || '-';

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
        <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2, display: 'flex', alignItems: 'center', gap: 6 }}>
          <span>注册时间：{String(student.created_at || '').slice(0, 10)}</span>
          <button onClick={onEditSchool} style={{
            fontSize: 10, padding: '2px 6px', borderRadius: 6,
            background: 'rgba(99,102,241,0.1)', color: '#4338ca',
            border: 'none', cursor: 'pointer'
          }}>
            修改学校
          </button>
        </div>
        <div style={{ fontSize: 12, color: '#64748b', marginTop: 1 }}>
          学校：{school}
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

export { fmtMinutes };