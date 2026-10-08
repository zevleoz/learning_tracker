import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { supabase } from '../lib/supabase.js';
import { logger } from '../lib/logger.js';
import { toLocalDateStr } from '../lib/date.js';
import StudentDashboard from '../components/StudentDashboard.jsx';

export default function Review() {
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const location = useLocation();

  // shouldIgnore() 返回 true 时说明本次请求已过期（组件卸载或路由切换），丢弃结果
  async function fetchSessions(shouldIgnore = () => false) {
    setLoading(true);
    setLoadError(null);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (shouldIgnore()) return;
      if (!user) { setLoading(false); return; }

      // 课程名保留历史值：课程被软删除后，旧记录仍显示当时的课程名（不隐藏记录本身）
      const { data, error } = await supabase
        .from('learning_sessions')
        .select(`
          id, session_date, start_time, duration_minutes, category, form, eval_type,
          score, course_id,
          course:course_id(name, subject)
        `)
        .eq('student_id', user.id)
        .is('deleted_at', null)
        .gte('session_date', toLocalDateStr(new Date(Date.now() - 365 * 24 * 3600 * 1000)))
        .order('session_date', { ascending: false })
        .limit(2000);

      if (error) {
        logger.error('Review fetch error', error);
        throw error;
      }

      const list = (data || []).map((s) => {
        const courseName = Array.isArray(s.course)
          ? (s.course[0]?.name)
          : s.course?.name;
        const courseSubject = Array.isArray(s.course)
          ? (s.course[0]?.subject)
          : s.course?.subject;
        return {
          ...s,
          date: String(s.session_date || '').slice(0, 10),
          time: s.start_time ? String(s.start_time).slice(0, 5) : null,
          subject: courseName || (s.course_id ? `课程-${String(s.course_id).slice(0, 8)}` : '未分类'),
          subjectCategory: courseSubject || null,
        };
      });
      if (shouldIgnore()) return;
      setSessions(list);
    } catch (err) {
      if (shouldIgnore()) return;
      logger.error('Review fetch failed:', err);
      setLoadError('数据加载失败，请刷新页面重试');
    } finally {
      if (!shouldIgnore()) setLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    fetchSessions(() => cancelled);
    return () => { cancelled = true; };
  }, [location.pathname]);

  if (loading) {
    return (
      <div className="loading-state" style={{ padding: '60px 16px' }}>
        <div className="loading-spinner"></div>
        <span>加载中…</span>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="empty-state" style={{ padding: '40px 16px' }}>
        <div className="empty-state-icon">⚠</div>
        <h3>加载失败</h3>
        <p>{loadError}</p>
        <button
          className="btn btn-primary btn-sm"
          onClick={() => fetchSessions()}
          style={{ marginTop: 12 }}
        >刷新重试</button>
      </div>
    );
  }

  if (sessions.length === 0) {
    return (
      <div className="empty-state" style={{ padding: '40px 16px' }}>
        <div className="empty-state-icon"></div>
        <h3>还没有学习记录</h3>
        <p>去「记录」页面记录第一次学习，这里会自动生成数据分析。</p>
        <a href="/learning" className="btn btn-primary btn-sm" style={{ marginTop: 12, textDecoration: 'none' }}>
          去记录
        </a>
      </div>
    );
  }

  return (
    <div>
      <StudentDashboard sessions={sessions} />
    </div>
  );
}
