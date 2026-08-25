// ═══════════════════════════════════════════════════════════
// @legacy v1 旧版复盘仪表盘 — 2026-08 版本
// 已被 WeekReviewDashboard.jsx 替代，代码保留以备复用
// 重新启用：在 Mentor.jsx 中将 USE_LEGACY_DASHBOARD 设为 true
// ═══════════════════════════════════════════════════════════
import { useMemo } from 'react';
import { fmtMinutes, isWeekday } from '../lib/date.js';

function IconClock({ color = '#6366f1' }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block', flexShrink: 0 }}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3.5 2" />
    </svg>
  );
}

function IconCalendar({ color = '#475569' }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block', flexShrink: 0 }}>
      <rect x="3" y="4.5" width="18" height="16" rx="2.5" />
      <path d="M8 3v3M16 3v3M3 10h18" />
    </svg>
  );
}

function IconBookOpen({ color = '#8b5cf6' }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block', flexShrink: 0 }}>
      <path d="M3 5v14l4-1h10l4 1V4l-4 1H7l-4-1z" />
      <path d="M12 4v15" />
    </svg>
  );
}

function IconTarget({ color = '#334155' }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block', flexShrink: 0 }}>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5" />
      <circle cx="12" cy="12" r="1.5" />
    </svg>
  );
}

const GRADE_TABLE = [
  { grade: 'A+', score: 97, color: '#10b981' },
  { grade: 'A',  score: 93, color: '#10b981' },
  { grade: 'A-', score: 90, color: '#10b981' },
  { grade: 'B+', score: 87, color: '#0ea5e9' },
  { grade: 'B',  score: 83, color: '#0ea5e9' },
  { grade: 'B-', score: 80, color: '#0ea5e9' },
  { grade: 'C+', score: 77, color: '#f59e0b' },
  { grade: 'C',  score: 73, color: '#f59e0b' },
  { grade: 'C-', score: 70, color: '#f59e0b' },
  { grade: 'D+', score: 67, color: '#fb923c' },
  { grade: 'D',  score: 63, color: '#fb923c' },
  { grade: 'D-', score: 60, color: '#fb923c' },
  { grade: 'F',  score: 50, color: '#f43f5e' },
];

function avgScoreToGrade(avg) {
  if (avg == null || isNaN(avg)) return null;
  let best = GRADE_TABLE[0];
  let minDiff = Infinity;
  for (const g of GRADE_TABLE) {
    const diff = Math.abs(g.score - avg);
    if (diff < minDiff) { minDiff = diff; best = g; }
  }
  return best;
}

function SectionShell({ children }) {
  return <div style={{ marginBottom: '32px' }}>{children}</div>;
}

function SectionTitle({ Icon, title, subtitle, color = '#475569' }) {
  return (
    <div style={{ marginBottom: '16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <Icon color={color} />
        <h2 style={{ fontSize: '16px', fontWeight: 600, color: '#0f172a', margin: 0, letterSpacing: '-0.01em' }}>{title}</h2>
      </div>
      {subtitle && <p style={{ fontSize: '12px', color: '#64748b', margin: '4px 0 0 28px' }}>{subtitle}</p>}
    </div>
  );
}

function EmptyState() {
  return (
    <div style={{
      background: 'rgba(255,255,255,0.2)',
      borderRadius: '16px',
      padding: '32px 16px',
      textAlign: 'center',
      border: '1px dashed rgba(148,163,184,0.4)'
    }}>
      <div style={{ color: '#94a3b8', fontSize: '13px' }}>暂无数据</div>
      <div style={{ color: '#94a3b8', fontSize: '11px', marginTop: '4px' }}>去记录页添加学习记录</div>
    </div>
  );
}

function TimeAmount({ minutes, scale = 1 }) {
  const mins = Math.max(0, Math.round(Number(minutes) || 0));
  const h = Math.floor(mins / 60);
  const m = mins % 60;

  const hSize = 22 * scale;
  const mSize = 11 * scale;

  return (
    <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 2, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
      <span style={{ fontSize: hSize, fontWeight: 700, color: '#0f172a', lineHeight: 1 }}>{h}h</span>
      <span style={{ fontSize: mSize, fontWeight: 500, color: '#94a3b8', lineHeight: 1 }}>{String(m).padStart(2, '0')}m</span>
    </span>
  );
}

const SELF_FORMS = ['自主预习', '自主复习', '自主练习'];

function isSelfForm(form) {
  if (typeof form === 'number') return [2, 3, 4].includes(form);
  const s = String(form || '');
  return SELF_FORMS.includes(s);
}

/** @legacy v1 学习总览卡片（总时长/日均/4周均值） */
function HeroBlock({ sessions = [] }) {
  const stats = useMemo(() => {
    if (!sessions || sessions.length === 0) {
      return { total: 0, avg: 0, weekdayAvg: 0, weekendAvg: 0, wk4Avg: 0, we4Avg: 0, days: 0 };
    }
    const today = new Date();

    let wk7 = 0, we7 = 0, wk7Days = 0, we7Days = 0;
    let wk28 = 0, we28 = 0, wk28Days = 0, we28Days = 0;

    const dateSet7 = new Set();
    const dateSet28 = new Set();

    for (let i = 0; i < 7; i++) {
      const d = new Date(today); d.setDate(today.getDate() - i);
      const iso = d.toISOString().slice(0, 10);
      dateSet7.add(iso);
      if (isWeekday(iso)) wk7Days++; else we7Days++;
    }
    for (let i = 0; i < 28; i++) {
      const d = new Date(today); d.setDate(today.getDate() - i);
      const iso = d.toISOString().slice(0, 10);
      dateSet28.add(iso);
      if (isWeekday(iso)) wk28Days++; else we28Days++;
    }

    for (const s of sessions) {
      const mins = s.duration_minutes || 0;
      if (dateSet7.has(s.date)) {
        if (isWeekday(s.date)) wk7 += mins; else we7 += mins;
      }
      if (dateSet28.has(s.date)) {
        if (isWeekday(s.date)) wk28 += mins; else we28 += mins;
      }
    }

    const total = sessions.reduce((a, s) => a + (s.duration_minutes || 0), 0);

    // Calculate actual date span from sessions for accurate daily average
    const allDates = sessions.map(s => s.date?.split('T')[0]).filter(Boolean).sort();
    const uniqueDateCount = new Set(allDates).size;
    let spanDays = 7;
    if (allDates.length > 0) {
      const earliest = new Date(allDates[0]);
      const latest = new Date(allDates[allDates.length - 1]);
      spanDays = Math.max(1, Math.round((latest - earliest) / (24 * 3600 * 1000)) + 1);
    }

    return {
      total,
      avg: Math.round(total / Math.max(spanDays, 1)),
      weekdayAvg: wk7Days > 0 ? Math.round(wk7 / wk7Days) : 0,
      weekendAvg: we7Days > 0 ? Math.round(we7 / we7Days) : 0,
      wk4Avg: wk28Days > 0 ? Math.round(wk28 / wk28Days) : 0,
      we4Avg: we28Days > 0 ? Math.round(we28 / we28Days) : 0,
      days: spanDays,
    };
  }, [sessions]);

  const hasData = stats.total > 0;

  if (!hasData) {
    return (
      <SectionShell>
        <SectionTitle Icon={IconClock} title="学习总览" subtitle="本周学习情况汇总" color="#6366f1" />
        <EmptyState />
      </SectionShell>
    );
  }

  return (
    <SectionShell>
      <SectionTitle Icon={IconClock} title="学习总览" subtitle="本周学习情况汇总" color="#6366f1" />

      <div style={{ textAlign: 'center', padding: '12px 0 24px' }}>
        <div>
          <TimeAmount minutes={stats.total} scale={2} />
        </div>
        <div style={{ color: '#9ca3af', fontSize: '13px', marginTop: '8px' }}>
          日均 <TimeAmount minutes={stats.avg} scale={0.55} /> · 近 {stats.days} 天 · {stats.total > 0 ? '有记录' : '暂无'}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
        <div style={{
          background: 'rgba(255,255,255,0.4)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          border: '1px solid rgba(255,255,255,0.4)',
          borderTop: '3px solid #6366f1',
          borderRadius: '16px',
          padding: '20px',
        }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            color: '#475569',
            fontSize: '12px',
            fontWeight: 500,
            marginBottom: '6px',
          }}>
            <span style={{ width: '6px', height: '6px', borderRadius: '3px', background: '#6366f1', display: 'inline-block' }} />
            工作日 · 近 7 天
          </div>
          <div style={{ marginTop: '6px', lineHeight: 1.1 }}>
            <TimeAmount minutes={stats.weekdayAvg} scale={1.3} />
          </div>
          <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '10px', display: 'inline-flex', alignItems: 'baseline', gap: 4 }}>
            4 周均 <TimeAmount minutes={stats.wk4Avg} scale={0.5} />
          </div>
        </div>

        <div style={{
          background: 'rgba(255,255,255,0.4)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          border: '1px solid rgba(255,255,255,0.4)',
          borderTop: '3px solid #f59e0b',
          borderRadius: '16px',
          padding: '20px',
        }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            color: '#475569',
            fontSize: '12px',
            fontWeight: 500,
            marginBottom: '6px',
          }}>
            <span style={{ width: '6px', height: '6px', borderRadius: '3px', background: '#f59e0b', display: 'inline-block' }} />
            周末 · 近 7 天
          </div>
          <div style={{ marginTop: '6px', lineHeight: 1.1 }}>
            <TimeAmount minutes={stats.weekendAvg} scale={1.3} />
          </div>
          <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '10px', display: 'inline-flex', alignItems: 'baseline', gap: 4 }}>
            4 周均 <TimeAmount minutes={stats.we4Avg} scale={0.5} />
          </div>
        </div>
      </div>
    </SectionShell>
  );
}

/** @legacy v1 连续学习卡片（连续天数/本周天数/最长记录） */
function StreakBlock({ sessions = [] }) {
  const stats = useMemo(() => {
    if (!sessions || sessions.length === 0) {
      return { current: 0, longest: 0, weekDays: 0, weekTotal: 7 };
    }

    const today = new Date();
    const dateSet = new Set(sessions.map((s) => s.date).filter(Boolean));

    const weekSet = new Set();
    for (let i = 0; i < 7; i++) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      weekSet.add(d.toISOString().slice(0, 10));
    }
    const weekDays = [...weekSet].filter((d) => dateSet.has(d)).length;

    const sortedDates = [...dateSet].sort();
    let current = 0;
    let longest = 0;
    let temp = 0;

    for (let i = 0; i < sortedDates.length; i++) {
      if (i === 0) {
        temp = 1;
      } else {
        const prev = new Date(sortedDates[i - 1]);
        const curr = new Date(sortedDates[i]);
        const diff = (curr - prev) / (1000 * 60 * 60 * 24);
        if (diff === 1) {
          temp++;
        } else {
          temp = 1;
        }
      }
      longest = Math.max(longest, temp);
    }

    const todayStr = today.toISOString().slice(0, 10);
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().slice(0, 10);

    if (dateSet.has(todayStr) || dateSet.has(yesterdayStr)) {
      let i = 0;
      while (true) {
        const d = new Date(today);
        d.setDate(today.getDate() - i);
        const dStr = d.toISOString().slice(0, 10);
        if (dateSet.has(dStr)) {
          current++;
          i++;
        } else {
          break;
        }
      }
    }

    return { current, longest, weekDays, weekTotal: 7 };
  }, [sessions]);

  if (stats.current === 0 && stats.weekDays === 0) {
    return null;
  }

  const streakColor = stats.current >= 7 ? '#10b981' : stats.current >= 3 ? '#f59e0b' : '#94a3b8';

  return (
    <SectionShell>
      <SectionTitle Icon={IconCalendar} title="学习连续性" subtitle="坚持就是胜利" color="#f59e0b" />

      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: '12px',
      }}>
        <div style={{
          background: 'rgba(255,255,255,0.4)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          border: '1px solid rgba(255,255,255,0.4)',
          borderRadius: '16px',
          padding: '16px',
          textAlign: 'center',
        }}>
          <div style={{ fontSize: '12px', color: '#64748b', marginBottom: '8px' }}>当前连续学习</div>
          <div style={{
            fontSize: '40px',
            fontWeight: 800,
            color: streakColor,
            lineHeight: 1,
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          }}>
            {stats.current}
          </div>
          <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '2px' }}>天</div>
          {stats.current >= 7 && (
            <div style={{ fontSize: '10px', color: '#10b981', marginTop: '8px', fontWeight: 600 }}>
              🎉 太棒了！连续一周！
            </div>
          )}
        </div>

        <div style={{
          background: 'rgba(255,255,255,0.4)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          border: '1px solid rgba(255,255,255,0.4)',
          borderRadius: '16px',
          padding: '16px',
          textAlign: 'center',
        }}>
          <div style={{ fontSize: '12px', color: '#64748b', marginBottom: '8px' }}>本周学习天数</div>
          <div style={{
            fontSize: '40px',
            fontWeight: 800,
            color: '#6366f1',
            lineHeight: 1,
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          }}>
            {stats.weekDays}
          </div>
          <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '2px' }}>/{stats.weekTotal} 天</div>
          <div style={{
            marginTop: '8px',
            height: '6px',
            background: '#e5e7eb',
            borderRadius: '999px',
            overflow: 'hidden',
          }}>
            <div style={{
              height: '100%',
              background: '#6366f1',
              borderRadius: '999px',
              width: `${(stats.weekDays / stats.weekTotal) * 100}%`,
              transition: 'width 0.3s ease',
            }} />
          </div>
        </div>
      </div>

      {stats.longest > 0 && (
        <div style={{
          marginTop: '12px',
          padding: '10px 14px',
          background: 'rgba(245,158,11,0.08)',
          borderRadius: '12px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}>
          <span style={{ fontSize: '12px', color: '#64748b' }}>最长连续记录</span>
          <span style={{
            fontSize: '14px',
            fontWeight: 700,
            color: '#f59e0b',
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          }}>
            {stats.longest} 天
          </span>
        </div>
      )}
    </SectionShell>
  );
}

/** @legacy v1 效率分析卡片（效率指数/平均单次时长） */
function EfficiencyBlock({ sessions = [] }) {
  const stats = useMemo(() => {
    if (!sessions || sessions.length === 0) {
      return { scorePerHour: 0, avgSession: 0, efficiencyGrade: null };
    }

    const totalMins = sessions.reduce((a, s) => a + (s.duration_minutes || 0), 0);
    const hours = totalMins / 60;

    let scoreSum = 0;
    let scoreCount = 0;
    for (const s of sessions) {
      if (Number(s.eval_type) === 2 && s.score != null && s.score !== '') {
        scoreSum += Number(s.score);
        scoreCount++;
      }
    }

    const avgScore = scoreCount > 0 ? scoreSum / scoreCount : 0;
    const scorePerHour = hours > 0 ? Math.round(avgScore / hours * 10) / 10 : 0;
    const avgSession = Math.round(totalMins / sessions.length);

    let efficiencyColor = '#94a3b8';
    if (scorePerHour >= 15) efficiencyColor = '#10b981';
    else if (scorePerHour >= 10) efficiencyColor = '#0ea5e9';
    else if (scorePerHour >= 5) efficiencyColor = '#f59e0b';
    else if (scorePerHour > 0) efficiencyColor = '#fb923c';

    return { scorePerHour, avgSession, efficiencyColor };
  }, [sessions]);

  if (stats.scorePerHour === 0) {
    return null;
  }

  return (
    <SectionShell>
      <SectionTitle Icon={IconTarget} title="学习效率" subtitle="投入产出比分析" color="#334155" />

      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: '12px',
      }}>
        <div style={{
          background: 'rgba(255,255,255,0.4)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          border: '1px solid rgba(255,255,255,0.4)',
          borderRadius: '16px',
          padding: '16px',
          textAlign: 'center',
        }}>
          <div style={{ fontSize: '12px', color: '#64748b', marginBottom: '8px' }}>效率指数</div>
          <div style={{
            fontSize: '48px',
            fontWeight: 800,
            color: stats.efficiencyColor,
            lineHeight: 1,
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          }}>
            {stats.scorePerHour}
          </div>
          <div style={{ fontSize: '10px', color: '#94a3b8', marginTop: '4px' }}>
            分/小时
          </div>
        </div>

        <div style={{
          background: 'rgba(255,255,255,0.4)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          border: '1px solid rgba(255,255,255,0.4)',
          borderRadius: '16px',
          padding: '16px',
          textAlign: 'center',
        }}>
          <div style={{ fontSize: '12px', color: '#64748b', marginBottom: '8px' }}>平均单次时长</div>
          <div style={{
            fontSize: '36px',
            fontWeight: 700,
            color: '#8b5cf6',
            lineHeight: 1,
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          }}>
            <TimeAmount minutes={stats.avgSession} scale={1.5} />
          </div>
          <div style={{ fontSize: '10px', color: '#94a3b8', marginTop: '4px' }}>
            建议每次学习 25-45 分钟
          </div>
        </div>
      </div>

      <div style={{
        marginTop: '12px',
        padding: '12px 14px',
        background: 'rgba(99,102,241,0.06)',
        borderRadius: '12px',
        fontSize: '12px',
        color: '#475569',
        lineHeight: 1.5,
      }}>
        <strong>效率说明：</strong>效率评分基于「平均分数 / 学习小时数」计算。更高的效率意味着你用更少的时间取得了更好的成绩。
      </div>
    </SectionShell>
  );
}

/** @legacy v1 月度趋势图表（工作日/周末对比） */
function MonthlyBarsBlock({ sessions = [] }) {
  const data = useMemo(() => {
    const today = new Date();
    const months = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
      const year = d.getFullYear();
      const month = d.getMonth();
      months.push({
        year,
        month,
        label: (month + 1) + '月',
        wkSum: 0,
        wkDays: 0,
        weSum: 0,
        weDays: 0,
        hasData: false,
      });
    }

    for (const m of months) {
      const daysInMonth = new Date(m.year, m.month + 1, 0).getDate();
      for (let d = 1; d <= daysInMonth; d++) {
        const day = new Date(m.year, m.month, d);
        if (day > today) break;
        const iso = day.toISOString().slice(0, 10);
        if (isWeekday(iso)) m.wkDays++; else m.weDays++;
      }
    }

    for (const s of sessions) {
      const mins = s.duration_minutes || 0;
      if (!s.date) continue;
      const parts = s.date.split('-');
      if (parts.length < 3) continue;
      const y = parseInt(parts[0], 10);
      const mo = parseInt(parts[1], 10) - 1;
      const m = months.find((x) => x.year === y && x.month === mo);
      if (!m) continue;
      m.hasData = true;
      if (isWeekday(s.date)) m.wkSum += mins; else m.weSum += mins;
    }

    for (const m of months) {
      m.wkAvg = m.wkDays > 0 ? m.wkSum / m.wkDays : 0;
      m.weAvg = m.weDays > 0 ? m.weSum / m.weDays : 0;
    }

    return months;
  }, [sessions]);

  const hasData = data.some((m) => m.hasData);

  if (!hasData) {
    return (
      <SectionShell>
        <SectionTitle Icon={IconCalendar} title="月度趋势" subtitle="各月工作日 / 周末日均学习时长" color="#475569" />
        <EmptyState />
      </SectionShell>
    );
  }

  const maxVal = Math.max(...data.flatMap((m) => [m.wkAvg, m.weAvg]), 30);
  const niceMax = Math.ceil(maxVal / 120) * 120 || 120;
  const yTicks = [0, 120, 240, 360, 480].filter((v) => v <= niceMax);

  const H = 200;
  const padL = 34, padR = 8, padT = 12, padB = 30;
  const innerH = H - padT - padB;

  const barW = 20;
  const groupGap = 24;
  const innerPad = 6;
  const groupW = barW * 2 + innerPad;
  const totalInnerW = data.length * groupW + (data.length - 1) * groupGap;
  const W = padL + totalInnerW + padR;

  const scale = (v) => (v / niceMax) * innerH;

  return (
    <SectionShell>
      <SectionTitle Icon={IconCalendar} title="月度趋势" subtitle="各月工作日 / 周末日均学习时长" color="#475569" />

      <div style={{
        background: 'rgba(255,255,255,0.4)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        border: '1px solid rgba(255,255,255,0.4)',
        borderRadius: '16px',
        padding: '20px 12px 16px',
      }}>
        <div style={{ overflowX: 'auto' }}>
          <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: H, minWidth: 320 }}>
            {yTicks.map((v, i) => {
              const y = H - padB - scale(v);
              const h = Math.floor(v / 60);
              const m = v % 60;
              return (
                <g key={i}>
                  <line x1={padL} y1={y} x2={W - padR} y2={y} stroke={v === 0 ? '#cbd5e1' : 'transparent'} strokeWidth="1" />
                  <text x={padL - 6} y={y + 3} fontSize="10" textAnchor="end" fill="#0f172a" fontFamily="ui-monospace, monospace" fontWeight="700">
                    {h}h
                  </text>
                  {m > 0 && (
                    <text x={padL - 24} y={y + 3} fontSize="8" textAnchor="end" fill="#94a3b8" fontFamily="ui-monospace, monospace">
                      {String(m).padStart(2, '0')}m
                    </text>
                  )}
                </g>
              );
            })}

            {data.map((m, i) => {
              const gx = padL + i * (groupW + groupGap);
              const yBase = H - padB;
              const wkH = scale(m.wkAvg);
              const weH = scale(m.weAvg);
              const wkh = Math.floor(m.wkAvg / 60);
              const wkm = Math.round(m.wkAvg % 60);
              const weh = Math.floor(m.weAvg / 60);
              const wem = Math.round(m.weAvg % 60);
              return (
                <g key={i}>
                  <rect
                    x={gx}
                    y={m.hasData ? yBase - wkH : yBase}
                    width={barW}
                    height={m.hasData ? wkH : 4}
                    rx={m.hasData ? 4 : 2}
                    fill={m.hasData ? '#6366f1' : '#e5e7eb'}
                  />
                  <rect
                    x={gx + barW + innerPad}
                    y={m.hasData ? yBase - weH : yBase}
                    width={barW}
                    height={m.hasData ? weH : 4}
                    rx={m.hasData ? 4 : 2}
                    fill={m.hasData ? '#f59e0b' : '#e5e7eb'}
                  />

                  {m.hasData ? (
                    <>
                      {wkH > 20 && (
                        <g>
                          <text x={gx + barW / 2} y={yBase - wkH - 4} fontSize="9" textAnchor="middle" fill="#0f172a" fontFamily="ui-monospace, monospace" fontWeight="700">
                            {wkh}h
                          </text>
                          {wkm > 0 && (
                            <text x={gx + barW / 2 + 10} y={yBase - wkH - 4} fontSize="8" textAnchor="start" fill="#94a3b8" fontFamily="ui-monospace, monospace">
                              {String(wkm).padStart(2, '0')}m
                            </text>
                          )}
                        </g>
                      )}
                      {weH > 20 && (
                        <g>
                          <text x={gx + barW + innerPad + barW / 2} y={yBase - weH - 4} fontSize="9" textAnchor="middle" fill="#0f172a" fontFamily="ui-monospace, monospace" fontWeight="700">
                            {weh}h
                          </text>
                          {wem > 0 && (
                            <text x={gx + barW + innerPad + barW / 2 + 10} y={yBase - weH - 4} fontSize="8" textAnchor="start" fill="#94a3b8" fontFamily="ui-monospace, monospace">
                              {String(wem).padStart(2, '0')}m
                            </text>
                          )}
                        </g>
                      )}
                    </>
                  ) : (
                    <text x={gx + groupW / 2} y={yBase - 8} fontSize="10" textAnchor="middle" fill="#94a3b8">
                      —
                    </text>
                  )}

                  <text x={gx + groupW / 2} y={yBase + 16} fontSize="11" textAnchor="middle" fill="#94a3b8">
                    {m.label}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>

        <div style={{ display: 'flex', justifyContent: 'center', gap: '20px', marginTop: '12px', fontSize: '12px', color: '#64748b' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ width: '8px', height: '8px', borderRadius: '2px', background: '#6366f1', display: 'inline-block' }} />
            工作日
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ width: '8px', height: '8px', borderRadius: '2px', background: '#f59e0b', display: 'inline-block' }} />
            周末
          </span>
        </div>
      </div>
    </SectionShell>
  );
}

/** @legacy v1 科目投入结构（自主/校外 + 占比） */
function SubjectSummaryBlock({ sessions = [] }) {
  const courses = useMemo(() => {
    const today = new Date();
    const weekSet = new Set();
    for (let i = 0; i < 7; i++) {
      const d = new Date(today); d.setDate(today.getDate() - i);
      weekSet.add(d.toISOString().slice(0, 10));
    }

    const byCourse = {};
    for (const s of sessions) {
      const courseName = s.subject
        || (Array.isArray(s.course) ? s.course[0]?.name : s.course?.name)
        || (s.course_id ? `课程-${String(s.course_id).slice(0, 8)}` : '未分类');
      const mins = s.duration_minutes || 0;
      const self = isSelfForm(s.form);

      byCourse[courseName] = byCourse[courseName] || {
        courseName: courseName,
        totalMins: 0,
        review: 0,
        practice: 0,
        study: 0,
        self: 0,
        scoreSum: 0,
        scoreCount: 0,
        weekMins: 0,
      };

      byCourse[courseName].totalMins += mins;
      if (weekSet.has(s.date)) byCourse[courseName].weekMins += mins;
      if (self) byCourse[courseName].self += mins;
      if (s.category === 2) byCourse[courseName].review += mins;
      else if (s.category === 3) byCourse[courseName].practice += mins;
      else if (s.category === 1) byCourse[courseName].study += mins;
      
      if (Number(s.eval_type) === 2 && s.score != null && s.score !== '' && !Number.isNaN(Number(s.score))) {
        byCourse[courseName].scoreSum += Number(s.score);
        byCourse[courseName].scoreCount += 1;
      }
    }

    const arr = Object.values(byCourse).map((x) => ({
      ...x,
      avgScore: x.scoreCount > 0 ? x.scoreSum / x.scoreCount : 0,
      grade: x.scoreCount > 0 ? avgScoreToGrade(x.scoreSum / x.scoreCount) : null,
      selfRatio: x.totalMins > 0 ? x.self / x.totalMins : 0,
    }));

    return arr.sort((a, b) => b.totalMins - a.totalMins);
  }, [sessions]);

  if (courses.length === 0) {
    return (
      <SectionShell>
        <SectionTitle Icon={IconBookOpen} title="课程汇总" subtitle="各课程学习时长与评估" color="#8b5cf6" />
        <EmptyState />
      </SectionShell>
    );
  }

  const maxMins = Math.max(...courses.map((s) => s.totalMins), 1);

  return (
    <SectionShell>
      <SectionTitle Icon={IconBookOpen} title="课程汇总" subtitle="各课程学习时长与评估" color="#8b5cf6" />

      <div style={{
        background: 'rgba(255,255,255,0.4)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        border: '1px solid rgba(255,255,255,0.4)',
        borderRadius: '16px',
        overflow: 'hidden',
      }}>
        <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 60px 60px 50px 40px',
        gap: '8px',
        padding: '10px 14px',
        background: '#f1f5f9',
        fontSize: '11px',
        fontWeight: 600,
        color: '#64748b',
        borderBottom: '1px solid rgba(148,163,184,0.3)',
      }}>
          <div>课程</div>
          <div style={{ textAlign: 'right' }}>本周</div>
          <div style={{ textAlign: 'right' }}>总时长</div>
          <div style={{ textAlign: 'right' }}>自主</div>
          <div style={{ textAlign: 'center' }}>分数</div>
        </div>

        <div style={{ maxHeight: '400px', overflowY: 'auto' }}>
          {courses.map((course) => {
            const grade = course.grade;
            const gradeColor = grade ? grade.color : '#94a3b8';
            const selfColor = course.selfRatio > 0.7 ? '#10b981' : course.selfRatio >= 0.3 ? '#f59e0b' : '#f43f5e';
            
            const totalBarWidth = (course.totalMins / maxMins) * 100;
            const studyWidth = course.totalMins > 0 ? (course.study / course.totalMins) * totalBarWidth : 0;
            const reviewWidth = course.totalMins > 0 ? (course.review / course.totalMins) * totalBarWidth : 0;
            const practiceWidth = course.totalMins > 0 ? (course.practice / course.totalMins) * totalBarWidth : 0;

            return (
              <div key={course.courseName} style={{
                display: 'grid',
                gridTemplateColumns: '1fr 60px 60px 50px 40px',
                gap: '8px',
                padding: '10px 14px',
                borderBottom: '1px solid rgba(148,163,184,0.15)',
                alignItems: 'center',
                transition: 'background 0.15s',
              }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <div style={{ fontSize: '13px', fontWeight: 600, color: '#334155' }}>
                    {course.courseName}
                  </div>
                  <div style={{
                    display: 'flex',
                    height: '4px',
                    borderRadius: '999px',
                    overflow: 'hidden',
                    background: '#e5e7eb',
                    width: totalBarWidth + '%',
                  }}>
                    <div style={{
                      width: studyWidth + '%',
                      background: '#10b981',
                    }} />
                    <div style={{
                      width: reviewWidth + '%',
                      background: '#8b5cf6',
                    }} />
                    <div style={{
                      width: practiceWidth + '%',
                      background: '#0ea5e9',
                    }} />
                  </div>
                </div>

                <div style={{ textAlign: 'right' }}>
                  <TimeAmount minutes={course.weekMins} scale={0.5} />
                </div>

                <div style={{ textAlign: 'right' }}>
                  <TimeAmount minutes={course.totalMins} scale={0.5} />
                </div>

                <div style={{ textAlign: 'right' }}>
                  <span style={{
                    fontSize: '12px',
                    fontWeight: 700,
                    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                    color: selfColor,
                  }}>
                    {Math.round(course.selfRatio * 100)}%
                  </span>
                </div>

                <div style={{ textAlign: 'center' }}>
                  <span style={{
                    fontSize: '16px',
                    fontWeight: 800,
                    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                    color: gradeColor,
                  }}>
                    {grade ? grade.grade : '—'}
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        <div style={{
          display: 'flex',
          justifyContent: 'center',
          gap: '16px',
          padding: '10px 14px',
          background: '#f8fafc',
          fontSize: '10px',
          color: '#64748b',
          borderTop: '1px solid rgba(148,163,184,0.2)',
        }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
            <span style={{ width: '8px', height: '8px', borderRadius: '2px', background: '#10b981' }} />
            学习
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
            <span style={{ width: '8px', height: '8px', borderRadius: '2px', background: '#8b5cf6' }} />
            复习
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
            <span style={{ width: '8px', height: '8px', borderRadius: '2px', background: '#0ea5e9' }} />
            练习
          </span>
        </div>
      </div>
    </SectionShell>
  );
}

/** @legacy v1 导师建议卡片（基于自主学习率等指标生成建议） */
function SuggestionsBlock({ sessions = [] }) {
  const suggestions = useMemo(() => {
    if (!sessions || sessions.length === 0) return [];

    const totalMins = sessions.reduce((a, s) => a + (s.duration_minutes || 0), 0);
    const avgDaily = totalMins / Math.min(sessions.length, 7);
    
    const objSessions = sessions.filter(s => s.eval_type === 2);
    const avgGradeScore = objSessions.length > 0
      ? objSessions.reduce((a, s) => {
          const grade = GRADE_TABLE.find(g => g.grade === s.grade_label);
          return a + (grade?.score || 70);
        }, 0) / objSessions.length
      : null;

    const list = [];

    if (avgDaily < 30) {
      list.push({
        type: 'warning',
        title: '学习时长不足',
        msg: `近7天日均仅 ${Math.round(avgDaily)} 分钟，建议每天至少学习30分钟以保持学习连续性。`,
      });
    } else if (avgDaily >= 180) {
      list.push({
        type: 'warning',
        title: '注意劳逸结合',
        msg: `日均学习超过 ${Math.round(avgDaily)} 分钟，建议适当休息，避免过度疲劳影响效率。`,
      });
    }

    if (avgGradeScore != null && avgGradeScore < 70) {
      list.push({
        type: 'danger',
        title: '成绩偏低',
        msg: '最近的评估成绩低于70分，建议加强练习和复习。',
      });
    } else if (avgGradeScore != null && avgGradeScore >= 90) {
      list.push({
        type: 'success',
        title: '表现优秀',
        msg: '最近的评估成绩保持在90分以上，继续保持！',
      });
    }

    const selfMins = sessions.filter(s => isSelfForm(s.form)).reduce((a, s) => a + (s.duration_minutes || 0), 0);
    const selfRatio = totalMins > 0 ? selfMins / totalMins : 0;
    if (selfRatio < 0.3) {
      list.push({
        type: 'info',
        title: '自主学习比例偏低',
        msg: `自主学习仅占 ${Math.round(selfRatio * 100)}%，建议增加自主预习和复习时间。`,
      });
    }

    return list;
  }, [sessions]);

  if (suggestions.length === 0) {
    return (
      <SectionShell>
        <SectionTitle Icon={IconTarget} title="学习建议" subtitle="基于数据分析的个性化建议" color="#334155" />
        <div style={{
          background: 'rgba(255,255,255,0.4)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          border: '1px solid rgba(255,255,255,0.4)',
          borderRadius: '16px',
          padding: '20px',
          textAlign: 'center',
        }}>
          <div style={{ fontSize: '14px', color: '#10b981', fontWeight: 600, marginBottom: '4px' }}>🎉 表现不错！</div>
          <div style={{ fontSize: '12px', color: '#64748b' }}>继续保持当前的学习节奏</div>
        </div>
      </SectionShell>
    );
  }

  const colors = {
    success: { bg: 'rgba(16,185,129,0.08)', border: '#10b981', text: '#059669' },
    warning: { bg: 'rgba(245,158,11,0.08)', border: '#f59e0b', text: '#d97706' },
    danger: { bg: 'rgba(244,63,94,0.08)', border: '#f43f5e', text: '#dc2626' },
    info: { bg: 'rgba(99,102,241,0.08)', border: '#6366f1', text: '#4338ca' },
  };

  return (
    <SectionShell>
      <SectionTitle Icon={IconTarget} title="学习建议" subtitle="基于数据分析的个性化建议" color="#334155" />
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {suggestions.map((s, i) => {
          const c = colors[s.type] || colors.info;
          return (
            <div key={i} style={{
              background: c.bg,
              borderLeft: `3px solid ${c.border}`,
              borderRadius: '12px',
              padding: '14px 16px',
            }}>
              <div style={{ fontSize: '13px', fontWeight: 600, color: c.text, marginBottom: '4px' }}>
                {s.title}
              </div>
              <div style={{ fontSize: '12px', color: '#475569', lineHeight: 1.5 }}>
                {s.msg}
              </div>
            </div>
          );
        })}
      </div>
    </SectionShell>
  );
}

/**
 * @legacy v1 旧版复盘仪表盘主入口
 * @description 渲染 HeroBlock → StreakBlock → EfficiencyBlock → MonthlyBarsBlock → SubjectSummaryBlock → SuggestionsBlock
 * @status 已被 WeekReviewDashboard 替代
 * @reEnable Mentor.jsx 中将 USE_LEGACY_DASHBOARD 设为 true
 */
export function ReviewDashboard({ sessions, footerNote }) {
  return (
    <div>
      <HeroBlock sessions={sessions} />
      <StreakBlock sessions={sessions} />
      <EfficiencyBlock sessions={sessions} />
      <MonthlyBarsBlock sessions={sessions} />
      <SubjectSummaryBlock sessions={sessions} />
      <SuggestionsBlock sessions={sessions} />
      {footerNote && (
        <div style={{ textAlign: 'center', fontSize: '11px', color: '#94a3b8', marginTop: '12px' }}>
          {footerNote}
        </div>
      )}
    </div>
  );
}

export {
  IconClock,
  IconCalendar,
  IconBookOpen,
  IconTarget,
  TimeAmount,
  HeroBlock,
  StreakBlock,
  EfficiencyBlock,
  MonthlyBarsBlock,
  SubjectSummaryBlock,
  SuggestionsBlock,
  isSelfForm,
  avgScoreToGrade,
};
