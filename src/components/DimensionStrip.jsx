import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { fmtMins, isSelfForm } from './WeekGrid.jsx';

// ── 维度卡片 ──────────────────────────────────────────
function DimensionCard({ icon, label, value, sub, bar, color, index, bars }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.04, duration: 0.25 }}
      style={{
        padding: '10px 8px',
        borderRadius: 10,
        background: 'rgba(255,255,255,0.6)',
        border: '1px solid rgba(15,23,42,0.06)',
        display: 'flex', flexDirection: 'column', gap: 3,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <span style={{ fontSize: 12, lineHeight: 1 }}>{icon}</span>
        <span style={{ fontSize: 10, fontWeight: 600, color: '#94a3b8', letterSpacing: 0.3 }}>{label}</span>
      </div>
      <div style={{ fontSize: 17, fontWeight: 800, color: color || '#0f172a', lineHeight: 1.2 }}>
        {value}
      </div>
      {sub && (
        <div style={{ fontSize: 9, color: '#94a3b8' }}>{sub}</div>
      )}
      {bars ? (
        // Multi-bar mode: [{label, value, color, pct}]
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 2 }}>
          {bars.map((b, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{
                fontSize: 8, fontWeight: 600, color: b.color, width: 24, flexShrink: 0,
              }}>{b.label}</span>
              <div style={{ flex: 1, height: 4, borderRadius: 2, background: '#f1f5f9', overflow: 'hidden' }}>
                <div style={{
                  height: '100%',
                  width: `${Math.min(b.pct, 100)}%`,
                  background: b.color,
                  borderRadius: 2,
                  transition: 'width 0.4s ease',
                }} />
              </div>
              <span style={{ fontSize: 8, color: b.color, width: 30, textAlign: 'right', flexShrink: 0 }}>
                {b.value}
              </span>
            </div>
          ))}
        </div>
      ) : (bar !== undefined && bar !== null ? (
        <div style={{ marginTop: 2, height: 4, borderRadius: 2, background: '#f1f5f9', overflow: 'hidden' }}>
          <div style={{
            height: '100%',
            width: `${Math.min(bar, 100)}%`,
            background: color || '#4F46E5', // sem-info iris-600，承载"信息强调"不与分类色冲突
            borderRadius: 2,
            transition: 'width 0.4s ease',
          }} />
        </div>
      ) : null)}
    </motion.div>
  );
}

// ── 7 维度摘要条 ─────────────────────────────────────
export default function DimensionStrip({ sessions = [], period }) {
  const dims = useMemo(() => {
    const safe = sessions.filter(s => s && s.date);
    if (safe.length === 0) {
      return { activeDays: 0, totalDays: 0, totalMins: 0, dailyAvg: 0,
               workdayAvg: 0, weekendAvg: 0, topSubject: null, concentration: 0,
               reviewPct: 0, practicePct: 0, studyPct: 0,
               practiceAvgScore: null, selfPct: 0, feedbackPerDay: 0 };
    }

    // 01 参与度 — 活跃天数 / 时段总天数
    const dates = new Set(safe.map(s => s.date.split('T')[0]));
    const activeDays = dates.size;
    const totalDays = period
      ? Math.max(1, Math.round((new Date(period.end) - new Date(period.start)) / (24 * 3600 * 1000)) + 1)
      : activeDays;

    // 02 总时长
    const totalMins = safe.reduce((a, s) => a + (s.duration_minutes || 0), 0);
    const dailyAvg = activeDays > 0 ? Math.round(totalMins / activeDays) : 0;

    // Workday vs weekend daily average
    let workMins = 0, workDays = 0, weekendMins2 = 0, weekendDays = 0;
    for (const d of dates) {
      const dow = new Date(d + 'T00:00:00').getDay();
      const dayMins = safe
        .filter(s => s.date.split('T')[0] === d)
        .reduce((a, s) => a + (s.duration_minutes || 0), 0);
      if (dow === 0 || dow === 6) { weekendMins2 += dayMins; weekendDays++; }
      else { workMins += dayMins; workDays++; }
    }
    const workdayAvg = workDays > 0 ? Math.round(workMins / workDays) : 0;
    const weekendAvg = weekendDays > 0 ? Math.round(weekendMins2 / weekendDays) : 0;

    // 03 学科分配
    const subjMap = {};
    for (const s of safe) {
      const name = s.subject || '未分类';
      subjMap[name] = (subjMap[name] || 0) + (s.duration_minutes || 0);
    }
    const subjSorted = Object.entries(subjMap).sort((a, b) => b[1] - a[1]);
    const topSubject = subjSorted[0]?.[0] || null;
    const concentration = totalMins > 0 ? Math.round((subjSorted[0]?.[1] || 0) / totalMins * 100) : 0;

    // 04 复习占比 (category 1=学, 2=复, 3=练)
    const catMins = { 1: 0, 2: 0, 3: 0 };
    for (const s of safe) {
      const c = Number(s.category);
      if (catMins[c] !== undefined) catMins[c] += s.duration_minutes || 0;
    }
    const studyPct = totalMins > 0 ? Math.round(catMins[1] / totalMins * 100) : 0;
    const reviewPct = totalMins > 0 ? Math.round(catMins[2] / totalMins * 100) : 0;
    const practicePct = totalMins > 0 ? Math.round(catMins[3] / totalMins * 100) : 0;

    // 05 练习质量
    const practiceScores = safe
      .filter(s => Number(s.category) === 3 && Number(s.eval_type) === 2 && s.score != null && s.score !== '')
      .map(s => Number(s.score));
    const practiceAvgScore = practiceScores.length > 0
      ? Math.round(practiceScores.reduce((a, b) => a + b, 0) / practiceScores.length)
      : null;

    // 06 自主比例
    const selfMins = safe.filter(s => isSelfForm(s.form)).reduce((a, s) => a + (s.duration_minutes || 0), 0);
    const selfPct = totalMins > 0 ? Math.round(selfMins / totalMins * 100) : 0;

    // 07 反馈密度
    const feedbackCount = safe.filter(s =>
      (s.score != null && s.score !== '') || s.self_rating != null
    ).length;
    const feedbackPerDay = activeDays > 0 ? (feedbackCount / activeDays).toFixed(1) : '0';

    return {
      activeDays, totalDays, totalMins, dailyAvg, workdayAvg, weekendAvg,
      topSubject, concentration, studyPct, reviewPct, practicePct,
      practiceAvgScore, selfPct, feedbackPerDay,
    };
  }, [sessions, period]);

  const cards = [
    {
      icon: '✓', label: '参与度',
      value: `${dims.activeDays}/${dims.totalDays}天`,
      bar: (dims.activeDays / dims.totalDays) * 100,
    },
    {
      icon: '⏱', label: '总时长',
      value: fmtMins(dims.totalMins),
      sub: `日均${fmtMins(dims.dailyAvg)}`,
      bars: [
        {
          label: '工',
          value: fmtMins(dims.workdayAvg),
          color: '#0f172a',
          pct: Math.min(dims.workdayAvg / 180 * 100, 100),
        },
        {
          label: '末',
          value: fmtMins(dims.weekendAvg),
          color: '#94a3b8',
          pct: Math.min(dims.weekendAvg / 180 * 100, 100),
        },
      ],
    },
    {
      icon: '⟳', label: '复习占比',
      value: `复${dims.reviewPct}%`,
      sub: `学${dims.studyPct}% · 练${dims.practicePct}%`,
      bar: dims.reviewPct,
    },
    {
      icon: '◐', label: '自主比例',
      value: `${dims.selfPct}%`,
      bar: dims.selfPct,
    },
  ];

  return (
    <div>
      <div style={{
        fontSize: 12, fontWeight: 700, color: '#475569', marginBottom: 8,
        display: 'flex', alignItems: 'center', gap: 6,
      }}>
        <span style={{ width: 3, height: 14, background: '#4F46E5', borderRadius: 2, display: 'inline-block' }} />
        维度总览
      </div>
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(4, 1fr)',
        gap: 6,
      }}>
        {cards.map((c, i) => (
          <DimensionCard key={i} index={i} {...c} />
        ))}
      </div>
    </div>
  );
}
