import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { supabase } from '../lib/supabase.js';
import {
  HeroBlock,
  StreakBlock,
  EfficiencyBlock,
  MonthlyBarsBlock,
  SubjectSummaryBlock,
  SuggestionsBlock,
} from '../components/SharedDashboard.jsx';

export default function Review() {
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [timeRange, setTimeRange] = useState('week');
  const location = useLocation();

  async function fetchSessions() {
    setLoading(true);
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
        console.error('Review fetch error', error);
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
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchSessions();
  }, [location.pathname]);

  const filteredSessions = useMemo(() => {
    if (!sessions || sessions.length === 0) return [];

    const today = new Date();
    let days = 7;
    if (timeRange === 'month') days = 30;
    else if (timeRange === 'quarter') days = 90;
    else if (timeRange === 'year') days = 365;

    const cutoff = new Date(today);
    cutoff.setDate(today.getDate() - days);
    const cutoffStr = cutoff.toISOString().slice(0, 10);

    return sessions.filter((s) => s.date >= cutoffStr);
  }, [sessions, timeRange]);

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: '40px 16px', color: '#64748b', fontSize: '14px' }}>
        加载中…
      </div>
    );
  }

  const rangeOptions = [
    { key: 'week', label: '本周' },
    { key: 'month', label: '本月' },
    { key: 'quarter', label: '近3月' },
    { key: 'year', label: '全年' },
  ];

  return (
    <div style={{ paddingBottom: '112px' }}>
      <div style={{
        display: 'flex',
        gap: '8px',
        padding: '0 16px 12px',
        overflowX: 'auto',
      }}>
        <button
          onClick={fetchSessions}
          disabled={loading}
          style={{
            flex: '0 0 auto',
            padding: '6px 10px',
            borderRadius: '999px',
            fontSize: '12px',
            fontWeight: 500,
            border: 'none',
            cursor: 'pointer',
            background: 'rgba(255,255,255,0.4)',
            color: '#475569',
            transition: 'all 0.15s ease',
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
          }}
        >
          {loading ? '刷新中…' : '🔄'}
        </button>
        {rangeOptions.map((opt) => (
          <button
            key={opt.key}
            onClick={() => setTimeRange(opt.key)}
            style={{
              flex: '0 0 auto',
              padding: '6px 14px',
              borderRadius: '999px',
              fontSize: '12px',
              fontWeight: 500,
              border: 'none',
              cursor: 'pointer',
              background: timeRange === opt.key ? '#6366f1' : 'rgba(255,255,255,0.4)',
              color: timeRange === opt.key ? 'white' : '#475569',
              transition: 'all 0.15s ease',
            }}
          >
            {opt.label}
          </button>
        ))}
      </div>

      <HeroBlock sessions={filteredSessions} />
      <StreakBlock sessions={filteredSessions} />
      <EfficiencyBlock sessions={filteredSessions} />
      <MonthlyBarsBlock sessions={filteredSessions} />
      <SubjectSummaryBlock sessions={sessions} />
      <SuggestionsBlock sessions={filteredSessions} />
    </div>
  );
}
