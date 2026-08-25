import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { supabase } from '../lib/supabase.js';
import { logger } from '../lib/logger.js';
import StudentDashboard from '../components/StudentDashboard.jsx';

export default function Review() {
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const location = useLocation();

  async function fetchSessions() {
    setLoading(true);
    setLoadError(null);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setLoading(false); return; }

      const { data, error } = await supabase
        .from('learning_sessions')
        .select(`
          id, session_date, start_time, duration_minutes, category, form, eval_type,
          score, course_id,
          course:course_id(name, subject)
        `)
        .eq('student_id', user.id)
        .gte('session_date', new Date(Date.now() - 365 * 24 * 3600 * 1000).toISOString().slice(0, 10))
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
      setSessions(list);
    } catch (err) {
      logger.error('Review fetch failed:', err);
      setLoadError('数据加载失败，请刷新页面重试');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchSessions();
  }, [location.pathname]);

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: '40px 16px', color: '#64748b', fontSize: '14px' }}>
        加载中…
      </div>
    );
  }

  if (loadError) {
    return (
      <div style={{ textAlign: 'center', padding: '40px 16px' }}>
        <div style={{ fontSize: 28, marginBottom: 8 }}>⚠️</div>
        <p style={{ color: '#64748b', fontSize: '14px', marginBottom: 16 }}>{loadError}</p>
        <button
          onClick={() => fetchSessions()}
          style={{
            padding: '8px 20px', fontSize: 14, fontWeight: 600,
            borderRadius: 10, border: 'none', cursor: 'pointer',
            background: '#6366f1', color: 'white',
          }}
        >刷新重试</button>
      </div>
    );
  }

  return (
    <div style={{ padding: '0 16px', paddingBottom: '112px' }}>
      <StudentDashboard sessions={sessions} />
    </div>
  );
}
