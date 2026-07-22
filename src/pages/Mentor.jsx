import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase } from '../lib/supabase.js';
import { toast } from '../lib/toast.js';
import { logger } from '../lib/logger.js';
import { ReviewDashboard } from '../components/SharedDashboard.jsx';
import MentorLayout from '../components/MentorLayout.jsx';
import MentorAnalyticsPage from './MentorAnalytics.jsx';
import { AnimatedNumber, Skeleton, SlideUp } from '../components/animations';

function fmtMinutes(mins) {
  if (!mins) return '0 分钟';
  if (mins < 60) return mins + ' 分钟';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h}h ${m}min` : `${h} 小时`;
}

const statCardVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: (i) => ({
    opacity: 1,
    y: 0,
    transition: {
      delay: i * 0.1,
      duration: 0.4,
      ease: [0.4, 0, 0.2, 1],
    },
  }),
};

function StatCard({ label, value, color }) {
  return (
    <div style={{
      padding: '12px 10px',
      borderRadius: 12,
      background: 'rgba(255,255,255,0.6)',
      border: '1px solid rgba(0,0,0,0.06)',
      textAlign: 'center',
    }}>
      <div style={{
        fontSize: 20,
        fontWeight: 700,
        color: color,
        lineHeight: 1.2,
        marginBottom: 4,
      }}>{value}</div>
      <div style={{
        fontSize: 11,
        color: '#94a3b8',
        fontWeight: 500,
      }}>{label}</div>
    </div>
  );
}

const rowVariants = {
  hidden: { opacity: 0, x: -20 },
  visible: {
    opacity: 1,
    x: 0,
    transition: {
      duration: 0.3,
      ease: [0.4, 0, 0.2, 1],
    },
  },
  exit: {
    opacity: 0,
    x: 20,
    transition: {
      duration: 0.2,
    },
  },
};

const detailPanelVariants = {
  hidden: { opacity: 0, x: 20 },
  visible: {
    opacity: 1,
    x: 0,
    transition: {
      type: 'spring',
      damping: 25,
      stiffness: 200,
    },
  },
};

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
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data: { user: u } } = await supabase.auth.getUser();
      if (!u) return;
      setUser(u);
      await loadData(u.id);
      setIsLoading(false);
    })();
  }, []);

  async function loadData(teacherId) {
    logger.log('===== 老师端加载数据 =====');
    logger.log('teacherId:', teacherId);

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

    logger.log('profiles 查询结果:', pRes);
    logger.log('connections 查询结果:', cRes);
    logger.log('schools 查询结果:', sRes);

    if (pRes.error) {
      logger.error('profiles 查询错误:', pRes.error);
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
      logger.log('老师身份查询结果:', pRes2);
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
      logger.error('loadClassStats error:', error);
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
        logger.log('Connection realtime event:', payload);
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
          logger.error('mentor load sessions', error);
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
      logger.error('sendInvite failed:', err);
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
      logger.error('withdrawInvite failed:', err);
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
      logger.error('disconnectStudent failed:', err);
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
      logger.error('saveSchoolName failed:', err);
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
            <motion.div 
              className="mentor-alert mentor-alert-error"
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3 }}
            >
              <strong>⚠️ 邀请系统未就绪</strong>
              <div>{deployCheck.message}</div>
            </motion.div>
          )}

          {activeView === 'students' && (
            <motion.div 
              className="mentor-students-page"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.3 }}
            >
              <motion.div 
                className="mentor-page-header"
                initial={{ opacity: 0, y: -20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4 }}
              >
                <div>
                  <h1 className="mentor-page-title">学生管理</h1>
                  <p className="mentor-page-subtitle">管理你的学生连接和查看学习数据</p>
                </div>
              </motion.div>

              <motion.div 
                className="mentor-main-layout"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.1, duration: 0.3 }}
              >
                <div className="mentor-student-list-panel">
                  <div className="mentor-class-overview">
                    {[
                      { value: classStats.totalStudents || 0, label: '已连接学生', suffix: '' },
                      { value: classStats.activeStudents || 0, label: '本周活跃', suffix: '' },
                      { value: classStats.avgDailyMinutes || 0, label: '日均学习', suffix: 'm' },
                      { value: classStats.avgScore || 0, label: '平均分数', suffix: '' },
                    ].map((stat, index) => (
                      <motion.div
                        key={stat.label}
                        className="mentor-class-stat"
                        variants={statCardVariants}
                        initial="hidden"
                        animate="visible"
                        custom={index}
                      >
                        <div className="mentor-class-stat-value">
                          {isLoading ? (
                            <Skeleton height={28} width="60%" />
                          ) : (
                            <AnimatedNumber value={stat.value} suffix={stat.suffix} />
                          )}
                        </div>
                        <div className="mentor-class-stat-label">{stat.label}</div>
                      </motion.div>
                    ))}
                  </div>

                  <div className="mentor-panel-header">
                    <h2 className="mentor-panel-title">学生列表</h2>
                    <span className="mentor-panel-count">{filteredStudents.length} 位学生</span>
                  </div>

                  <div className="mentor-search-bar">
                    <motion.input
                      type="text"
                      placeholder="搜索学生姓名…"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="mentor-search-input"
                      whileFocus={{ scale: 1.01 }}
                      transition={{ type: 'spring', stiffness: 300 }}
                    />
                    <motion.select
                      value={filterSchool}
                      onChange={(e) => setFilterSchool(e.target.value)}
                      className="mentor-filter-select"
                      whileFocus={{ scale: 1.01 }}
                      transition={{ type: 'spring', stiffness: 300 }}
                    >
                      <option value="all">所有学校</option>
                      {schools.map((school) => (
                        <option key={school} value={school}>{school}</option>
                      ))}
                    </motion.select>
                    <motion.select
                      value={filterStatus}
                      onChange={(e) => setFilterStatus(e.target.value)}
                      className="mentor-filter-select"
                      whileFocus={{ scale: 1.01 }}
                      transition={{ type: 'spring', stiffness: 300 }}
                    >
                      <option value="all">全部状态</option>
                      <option value="connected">已连接</option>
                      <option value="invited">邀请中</option>
                      <option value="rejected">已拒绝</option>
                      <option value="uninvited">未邀请</option>
                    </motion.select>
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
                        <AnimatePresence>
                          {filteredStudents.map((s, index) => {
                            const conn = connections[s.id];
                            const status = conn?.status ?? -1;
                            const isEditingSchool = editingSchoolId === s.id;
                            return (
                              <motion.tr
                                key={s.id}
                                initial="hidden"
                                animate="visible"
                                exit="exit"
                                variants={rowVariants}
                                custom={index}
                                onClick={() => status === 1 && setPicked(s)}
                                className={`mentor-table-row ${status === 1 ? 'mentor-table-row-clickable' : ''} ${picked?.id === s.id ? 'mentor-table-row-selected' : ''}`}
                                whileHover={{ scale: 1.002 }}
                                transition={{ type: 'spring', stiffness: 300 }}
                              >
                                <td>
                                  <div className="mentor-table-name">{s.full_name || '(未命名)'}</div>
                                </td>
                                <td>
                                  {isEditingSchool ? (
                                    <div className="mentor-school-edit">
                                      <motion.input
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
                                        layout
                                        transition={{ duration: 0.2 }}
                                      />
                                      <motion.button 
                                        className="mentor-school-btn-save" 
                                        onClick={(e) => { e.stopPropagation(); saveSchoolName(s.id, editingSchoolValue); }}
                                        whileHover={{ scale: 1.05 }}
                                        whileTap={{ scale: 0.95 }}
                                      >✓</motion.button>
                                      <motion.button 
                                        className="mentor-school-btn-cancel" 
                                        onClick={(e) => { e.stopPropagation(); setEditingSchoolId(null); setEditingSchoolValue(''); }}
                                        whileHover={{ scale: 1.05 }}
                                        whileTap={{ scale: 0.95 }}
                                      >✕</motion.button>
                                    </div>
                                  ) : (
                                    <div className="mentor-table-school">
                                      {s.school_name || '-'}
                                      <motion.button 
                                        className="mentor-school-edit-btn" 
                                        onClick={(e) => { e.stopPropagation(); setEditingSchoolId(s.id); setEditingSchoolValue(s.school_name || ''); }}
                                        whileHover={{ scale: 1.1 }}
                                        whileTap={{ scale: 0.9 }}
                                      >✏️</motion.button>
                                    </div>
                                  )}
                                </td>
                                <td className="mentor-table-date">
                                  {String(s.created_at || '').slice(0, 10)}
                                </td>
                                <td>
                                  <motion.span 
                                    className={`mentor-status-pill mentor-status-${status === 1 ? 'connected' : status === 0 ? 'invited' : status === 2 ? 'rejected' : 'uninvited'}`}
                                    whileHover={{ scale: 1.05 }}
                                    transition={{ type: 'spring', stiffness: 300 }}
                                  >
                                    {status === 1 ? '已连接' : status === 0 ? '邀请中' : status === 2 ? '已拒绝' : '未邀请'}
                                  </motion.span>
                                </td>
                                <td className="mentor-table-actions">
                                  {status === -1 && (
                                    <div className="mentor-invite-group">
                                      <motion.input
                                        type="text"
                                        placeholder="邀请备注（可选）"
                                        value={inviteNotes[s.id] || ''}
                                        onChange={(e) => setInviteNotes((m) => ({ ...m, [s.id]: e.target.value }))}
                                        className="mentor-invite-note"
                                        whileFocus={{ scale: 1.01 }}
                                      />
                                      <motion.button 
                                        className="mentor-btn mentor-btn-primary" 
                                        onClick={(e) => { e.stopPropagation(); sendInvite(s.id); }}
                                        whileHover={{ scale: 1.02 }}
                                        whileTap={{ scale: 0.98 }}
                                        whileFocus={{ scale: 1.02 }}
                                      >
                                        发送邀请
                                      </motion.button>
                                    </div>
                                  )}
                                  {status === 0 && (
                                    <>
                                      <motion.button 
                                        className="mentor-btn mentor-btn-secondary" 
                                        onClick={(e) => { e.stopPropagation(); withdrawInvite(s.id); }}
                                        whileHover={{ scale: 1.02 }}
                                        whileTap={{ scale: 0.98 }}
                                      >
                                        撤回
                                      </motion.button>
                                      <motion.button 
                                        className="mentor-btn mentor-btn-primary" 
                                        onClick={(e) => { e.stopPropagation(); sendInvite(s.id); }}
                                        whileHover={{ scale: 1.02 }}
                                        whileTap={{ scale: 0.98 }}
                                      >
                                        重发
                                      </motion.button>
                                    </>
                                  )}
                                  {status === 2 && (
                                    <motion.button 
                                      className="mentor-btn mentor-btn-primary" 
                                      onClick={(e) => { e.stopPropagation(); sendInvite(s.id); }}
                                      whileHover={{ scale: 1.02 }}
                                      whileTap={{ scale: 0.98 }}
                                    >
                                      再次邀请
                                    </motion.button>
                                  )}
                                  {status === 1 && (
                                    <>
                                      <motion.button 
                                        className="mentor-btn mentor-btn-primary" 
                                        onClick={(e) => { e.stopPropagation(); setPicked(s); }}
                                        whileHover={{ scale: 1.02 }}
                                        whileTap={{ scale: 0.98 }}
                                      >
                                        查看数据
                                      </motion.button>
                                      <motion.button 
                                        className="mentor-btn mentor-btn-secondary" 
                                        onClick={(e) => { e.stopPropagation(); disconnectStudent(s.id); }}
                                        whileHover={{ scale: 1.02 }}
                                        whileTap={{ scale: 0.98 }}
                                      >
                                        断开
                                      </motion.button>
                                    </>
                                  )}
                                </td>
                              </motion.tr>
                            );
                          })}
                        </AnimatePresence>
                      </tbody>
                    </table>

                    {filteredStudents.length === 0 && (
                      <motion.div 
                        className="mentor-empty-state"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ duration: 0.3 }}
                      >
                        <div>暂无学生</div>
                        <div className="mentor-empty-sub">让学生注册后，他们会出现在这里</div>
                      </motion.div>
                    )}
                  </div>
                </div>

                <motion.div 
                  className="mentor-detail-panel"
                  key={picked?.id || 'empty'}
                  variants={detailPanelVariants}
                  initial="hidden"
                  animate="visible"
                >
                  {picked ? (
                    <>
                      <div className="mentor-panel-header">
                        <h2 className="mentor-panel-title">{picked.full_name || '学生'} 的学习数据</h2>
                        <motion.button 
                          className="mentor-close-detail" 
                          onClick={() => setPicked(null)}
                          whileHover={{ scale: 1.02 }}
                          whileTap={{ scale: 0.98 }}
                        >关闭</motion.button>
                      </div>

                      {busy ? (
                        <div className="mentor-loading">
                          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
                            <Skeleton height={20} width="40%" />
                            <Skeleton height={16} width="60%" />
                            <Skeleton height={16} width="40%" />
                          </div>
                        </div>
                      ) : (
                        <div className="mentor-detail-content">
                          <motion.div 
                            className="mentor-student-summary"
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.3 }}
                          >
                            <div className="mentor-summary-item">
                              <span className="mentor-summary-label">学习记录</span>
                              <span className="mentor-summary-value">
                                <AnimatedNumber value={sessions.length} suffix=" 条" />
                              </span>
                            </div>
                            <div className="mentor-summary-item">
                              <span className="mentor-summary-label">累计时长</span>
                              <span className="mentor-summary-value">
                                {fmtMinutes(sessions.reduce((a, s) => a + (s.duration_minutes || 0), 0))}
                              </span>
                            </div>
                          </motion.div>

                          {sessions.length > 0 ? (
                            <motion.div
                              initial={{ opacity: 0 }}
                              animate={{ opacity: 1 }}
                              transition={{ delay: 0.1, duration: 0.3 }}
                            >
                              <ReviewDashboard sessions={sessions} />
                            </motion.div>
                          ) : (
                            <motion.div 
                              className="mentor-empty-state"
                              initial={{ opacity: 0 }}
                              animate={{ opacity: 1 }}
                              transition={{ duration: 0.3 }}
                            >
                              <div>该学生暂无学习记录</div>
                            </motion.div>
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
                </motion.div>
              </motion.div>
            </motion.div>
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
            <motion.div 
              className="mentor-settings-page"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3 }}
            >
              <div className="mentor-page-header">
                <h1 className="mentor-page-title">系统设置</h1>
                <p className="mentor-page-subtitle">管理你的导师账号和系统配置</p>
              </div>
              <div className="mentor-empty-state">
                <div>系统设置功能即将上线</div>
                <div className="mentor-empty-sub">敬请期待更多设置选项</div>
              </div>
            </motion.div>
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
              <StatCard label="学生总数" value={stats.total} color="#64748b" />
              <StatCard label="已连接" value={stats.connected} color="#171717" />
              <StatCard label="邀请中" value={stats.invited} color="#8E8E93" />
              <StatCard label="被拒绝" value={stats.rejected} color="#B91C1C" />
            </div>
          </section>

          <section className="glass-card" style={{ marginTop: 16 }}>
            <div style={{ padding: '14px 16px', borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
              <span style={{ fontSize: 14, fontWeight: 600, color: '#1e293b' }}>学生列表</span>
              <span style={{ marginLeft: 8, fontSize: 12, color: '#94a3b8' }}>{students.length} 位学生</span>
            </div>
            <div style={{ padding: 12 }}>
              <input
                type="text"
                placeholder="搜索学生姓名…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{
                  width: '100%', padding: '10px 14px', borderRadius: 10,
                  border: '1px solid rgba(0,0,0,0.1)',
                  background: 'rgba(248,250,252,0.8)',
                  fontSize: 14,
                }}
              />
            </div>
            <div style={{ maxHeight: '60vh', overflowY: 'auto', overscrollBehavior: 'contain' }}>
              {filteredStudents.map((s) => {
                const conn = connections[s.id];
                const status = conn?.status ?? -1;
                return (
                  <div key={s.id} onClick={() => status === 1 && setPicked(s)} style={{
                    padding: '12px 16px',
                    borderBottom: '1px solid rgba(0,0,0,0.04)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 500 }}>{s.full_name || '(未命名)'}</div>
                      <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>
                        {s.school_name || '-'} · {String(s.created_at || '').slice(0, 10)}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <span className={`mentor-status-pill mentor-status-${status === 1 ? 'connected' : status === 0 ? 'invited' : status === 2 ? 'rejected' : 'uninvited'}`}>
                        {status === 1 ? '已连接' : status === 0 ? '邀请中' : status === 2 ? '已拒绝' : '未邀请'}
                      </span>
                      {status === 1 && (
                        <button className="mentor-btn mentor-btn-primary" onClick={(e) => { e.stopPropagation(); setPicked(s); }}>
                          查看数据
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
              {filteredStudents.length === 0 && (
                <div style={{ padding: 32, textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>
                  暂无学生
                </div>
              )}
            </div>
          </section>

          {picked && (
            <section className="glass-card" style={{ marginTop: 16 }}>
              <div style={{ padding: '14px 16px', borderBottom: '1px solid rgba(0,0,0,0.06)', display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 14, fontWeight: 600, color: '#1e293b' }}>{picked.full_name || '学生'} 的学习数据</span>
                <button onClick={() => setPicked(null)} style={{ fontSize: 12, color: '#64748b', background: 'transparent', border: 'none', cursor: 'pointer' }}>关闭</button>
              </div>
              <div style={{ padding: 16 }}>
                {busy ? (
                  <div style={{ padding: 32, textAlign: 'center', color: '#94a3b8' }}>加载中…</div>
                ) : (
                  <>
                    <div style={{ display: 'flex', gap: 24, marginBottom: 16 }}>
                      <div>
                        <div style={{ fontSize: 12, color: '#94a3b8' }}>学习记录</div>
                        <div style={{ fontSize: 20, fontWeight: 600, color: '#1e293b', marginTop: 4 }}>{sessions.length} 条</div>
                      </div>
                      <div>
                        <div style={{ fontSize: 12, color: '#94a3b8' }}>累计时长</div>
                        <div style={{ fontSize: 20, fontWeight: 600, color: '#1e293b', marginTop: 4 }}>{fmtMinutes(sessions.reduce((a, s) => a + (s.duration_minutes || 0), 0))}</div>
                      </div>
                    </div>
                    {sessions.length > 0 && <ReviewDashboard sessions={sessions} />}
                    {sessions.length === 0 && <div style={{ padding: 24, textAlign: 'center', color: '#94a3b8' }}>该学生暂无学习记录</div>}
                  </>
                )}
              </div>
            </section>
          )}
        </>
      ) : activeView === 'analytics' ? (
        <MentorAnalyticsPage
          user={user}
          students={students}
          connections={Array.isArray(connections) ? connections : Object.values(connections)}
          onSelectStudent={(s) => { setPicked(s); setActiveView('students'); }}
        />
      ) : null}
    </div>
  );
}