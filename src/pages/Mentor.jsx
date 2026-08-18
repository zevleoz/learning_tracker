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
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    const handler = (e) => setIsMobile(e.matches);
    handler(mq);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

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

  if (!isMobile) {
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
    <div className="mentor-mobile">
      <header className="m-mentor-header">
        <div className="m-mentor-header__top">
          <h1 className="m-mentor-title">导师视图</h1>
        </div>
        <nav className="m-mentor-tabs">
          <button
            onClick={() => setActiveView('students')}
            className={`m-mentor-tab ${activeView === 'students' ? 'm-mentor-tab-active' : ''}`}
          >
            学生管理
          </button>
          <button
            onClick={() => setActiveView('analytics')}
            className={`m-mentor-tab ${activeView === 'analytics' ? 'm-mentor-tab-active' : ''}`}
          >
            数据分析
          </button>
          <button
            onClick={() => setActiveView('settings')}
            className={`m-mentor-tab ${activeView === 'settings' ? 'm-mentor-tab-active' : ''}`}
          >
            设置
          </button>
        </nav>
      </header>

      {activeView === 'students' ? (
        <div className="m-mentor-content">
          {!deployCheck.ok && (
            <motion.div
              className="glass m-deploy-alert"
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3 }}
            >
              <div style={{ fontSize: 14, fontWeight: 700, color: '#7f1d1d' }}>⚠️ 邀请系统未就绪</div>
              <div style={{ marginTop: 4, fontSize: 12, color: '#991b1b' }}>{deployCheck.message}</div>
            </motion.div>
          )}

          <section className="glass m-mentor-stats-grid">
            <div className="m-mentor-stat-card">
              <div className="m-mentor-stat-value" style={{ color: '#64748b' }}>{stats.total}</div>
              <div className="m-mentor-stat-label">学生总数</div>
            </div>
            <div className="m-mentor-stat-card">
              <div className="m-mentor-stat-value" style={{ color: '#171717' }}>{stats.connected}</div>
              <div className="m-mentor-stat-label">已连接</div>
            </div>
            <div className="m-mentor-stat-card">
              <div className="m-mentor-stat-value" style={{ color: '#8E8E93' }}>{stats.invited}</div>
              <div className="m-mentor-stat-label">邀请中</div>
            </div>
            <div className="m-mentor-stat-card">
              <div className="m-mentor-stat-value" style={{ color: '#B91C1C' }}>{stats.rejected}</div>
              <div className="m-mentor-stat-label">被拒绝</div>
            </div>
          </section>

          {classStats.totalStudents > 0 && (
            <section className="glass m-mentor-class-stats">
              <div className="m-class-stat-item">
                <span className="m-class-stat-value">{classStats.totalStudents}</span>
                <span className="m-class-stat-label">已连接学生</span>
              </div>
              <div className="m-class-stat-divider" />
              <div className="m-class-stat-item">
                <span className="m-class-stat-value">{classStats.activeStudents || 0}</span>
                <span className="m-class-stat-label">本周活跃</span>
              </div>
              <div className="m-class-stat-divider" />
              <div className="m-class-stat-item">
                <span className="m-class-stat-value">{fmtMinutes(classStats.avgDailyMinutes || 0)}</span>
                <span className="m-class-stat-label">日均时长</span>
              </div>
            </section>
          )}

          <section className="m-filter-bar">
            <div className="m-search-wrap">
              <input
                type="text"
                placeholder="搜索学生…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="m-search-input"
              />
            </div>
            <div className="m-filter-chips">
              {[
                { k: 'all', label: '全部' },
                { k: 'connected', label: '已连接' },
                { k: 'invited', label: '邀请中' },
                { k: 'rejected', label: '已拒绝' },
                { k: 'uninvited', label: '未邀请' },
              ].map((f) => (
                <button
                  key={f.k}
                  onClick={() => setFilterStatus(f.k)}
                  className={`m-filter-chip ${filterStatus === f.k ? 'm-filter-chip-active' : ''}`}
                >
                  {f.label}
                </button>
              ))}
            </div>
            {schools.length > 0 && (
              <div className="m-filter-chips">
                <span className="m-filter-label">学校：</span>
                <button
                  onClick={() => setFilterSchool('all')}
                  className={`m-filter-chip ${filterSchool === 'all' ? 'm-filter-chip-active' : ''}`}
                >
                  全部学校
                </button>
                {schools.map((s) => (
                  <button
                    key={s}
                    onClick={() => setFilterSchool(s)}
                    className={`m-filter-chip ${filterSchool === s ? 'm-filter-chip-active' : ''}`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
          </section>

          <div className="m-student-list">
            {filteredStudents.map((s) => {
              const conn = connections[s.id];
              const status = conn?.status ?? -1;
              return (
                <motion.div
                  key={s.id}
                  className="glass m-student-card"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3 }}
                >
                  <div className="m-student-card__header">
                    <div className="m-student-card__avatar">
                      {(s.full_name || '?').charAt(0).toUpperCase()}
                    </div>
                    <div className="m-student-card__info">
                      <div className="m-student-card__name">{s.full_name || '(未命名)'}</div>
                      <div className="m-student-card__meta">
                        {s.school_name || '未设置学校'} · {String(s.created_at || '').slice(0, 10)}
                      </div>
                    </div>
                    <span className={`m-status-pill m-status-pill--${status === 1 ? 'connected' : status === 0 ? 'invited' : status === 2 ? 'rejected' : 'uninvited'}`}>
                      {status === 1 ? '已连接' : status === 0 ? '邀请中' : status === 2 ? '已拒绝' : '未邀请'}
                    </span>
                  </div>

                  <div className="m-student-card__actions">
                    {status === 1 && (
                      <>
                        <button
                          className="m-action-btn m-action-btn--primary"
                          onClick={() => setPicked(s)}
                        >
                          查看数据
                        </button>
                        <button
                          className="m-action-btn m-action-btn--danger"
                          onClick={() => disconnectStudent(s.id)}
                        >
                          断开
                        </button>
                      </>
                    )}
                    {status === 0 && (
                      <>
                        <button className="m-action-btn" onClick={() => withdrawInvite(s.id)}>
                          撤回邀请
                        </button>
                        <button
                          className="m-action-btn m-action-btn--primary"
                          onClick={() => sendInvite(s.id)}
                        >
                          重发
                        </button>
                      </>
                    )}
                    {status === 2 && (
                      <button
                        className="m-action-btn m-action-btn--primary"
                        onClick={() => sendInvite(s.id)}
                      >
                        再次邀请
                      </button>
                    )}
                    {status === -1 && (
                      <button
                        className="m-action-btn m-action-btn--primary"
                        onClick={() => sendInvite(s.id)}
                      >
                        发送邀请
                      </button>
                    )}
                    <button
                      className="m-action-btn m-action-btn--ghost"
                      onClick={() => {
                        setEditingSchoolId(s.id);
                        setEditingSchoolValue(s.school_name || '');
                      }}
                    >
                      编辑学校
                    </button>
                  </div>

                  {editingSchoolId === s.id && (
                    <motion.div
                      className="m-school-edit"
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                    >
                      <input
                        type="text"
                        placeholder="输入学校名称"
                        value={editingSchoolValue}
                        onChange={(e) => setEditingSchoolValue(e.target.value)}
                        className="m-school-input"
                      />
                      <div className="m-school-edit__actions">
                        <button
                          className="m-action-btn"
                          onClick={() => { setEditingSchoolId(null); setEditingSchoolValue(''); }}
                        >
                          取消
                        </button>
                        <button
                          className="m-action-btn m-action-btn--primary"
                          onClick={() => { saveSchoolName(s.id, editingSchoolValue); setEditingSchoolId(null); }}
                        >
                          保存
                        </button>
                      </div>
                    </motion.div>
                  )}

                  {status === -1 && editingSchoolId !== s.id && (
                    <div className="m-invite-form">
                      <textarea
                        placeholder="邀请备注（选填）"
                        value={inviteNotes[s.id] || ''}
                        onChange={(e) => setInviteNotes({ ...inviteNotes, [s.id]: e.target.value })}
                        className="m-invite-note"
                        rows={2}
                      />
                      <button
                        className="m-action-btn m-action-btn--primary"
                        onClick={() => sendInvite(s.id)}
                      >
                        发送邀请
                      </button>
                    </div>
                  )}
                </motion.div>
              );
            })}
            {filteredStudents.length === 0 && (
              <div className="m-empty-state">
                <div className="m-empty-state__icon">📋</div>
                <div className="m-empty-state__text">暂无学生</div>
              </div>
            )}
          </div>

          <AnimatePresence>
            {picked && (
              <motion.div
                className="m-detail-overlay"
                initial={{ opacity: 0, y: 40 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 40 }}
                transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              >
                <div className="m-detail-header">
                  <button
                    className="m-detail-close"
                    onClick={() => setPicked(null)}
                  >
                    ✕
                  </button>
                  <div className="m-detail-title">{picked.full_name || '学生'} 的学习数据</div>
                  <div className="m-detail-spacer" />
                </div>
                <div className="m-detail-body">
                  <section className="glass m-detail-stats">
                    <div className="m-detail-stat">
                      <div className="m-detail-stat__value">{sessions.length}</div>
                      <div className="m-detail-stat__label">学习记录</div>
                    </div>
                    <div className="m-detail-stat-divider" />
                    <div className="m-detail-stat">
                      <div className="m-detail-stat__value">{fmtMinutes(sessions.reduce((a, s) => a + (s.duration_minutes || 0), 0))}</div>
                      <div className="m-detail-stat__label">累计时长</div>
                    </div>
                  </section>
                  {busy ? (
                    <div className="m-loading">加载中…</div>
                  ) : sessions.length > 0 ? (
                    <div className="m-detail-dashboard">
                      <ReviewDashboard sessions={sessions} />
                    </div>
                  ) : (
                    <div className="m-empty-state">
                      <div className="m-empty-state__text">该学生暂无学习记录</div>
                    </div>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      ) : activeView === 'analytics' ? (
        <div className="m-mentor-content">
          <section className="glass m-analytics-summary">
            <div className="m-analytics-summary__title">班级数据分析</div>
            <div className="m-analytics-summary__sub">全体学生的学习表现概览</div>
          </section>
          <div className="m-analytics-container">
            <MentorAnalyticsPage
              user={user}
              students={students}
              connections={Array.isArray(connections) ? connections : Object.values(connections)}
              onSelectStudent={(s) => { setPicked(s); }}
            />
          </div>
        </div>
      ) : activeView === 'settings' ? (
        <div className="m-mentor-content">
          <section className="glass m-settings-card">
            <div className="m-settings-header">
              <div className="m-settings-avatar">
                {(user?.user_metadata?.full_name || user?.email || 'M').charAt(0).toUpperCase()}
              </div>
              <div className="m-settings-info">
                <div className="m-settings-name">{user?.user_metadata?.full_name || user?.email || '导师'}</div>
                <div className="m-settings-role">导师账户</div>
              </div>
            </div>
            <div className="m-settings-list">
              <button className="m-settings-item">
                <span>通知设置</span>
                <span className="m-settings-item__arrow">›</span>
              </button>
              <button className="m-settings-item">
                <span>隐私与安全</span>
                <span className="m-settings-item__arrow">›</span>
              </button>
              <button className="m-settings-item">
                <span>帮助与反馈</span>
                <span className="m-settings-item__arrow">›</span>
              </button>
            </div>
            <button className="m-signout-btn" onClick={() => supabase.auth.signOut()}>
              退出登录
            </button>
          </section>
        </div>
      ) : null}
    </div>
  );
}