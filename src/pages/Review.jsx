import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { fmtMinutes, isWeekday } from '../lib/date.js';

/* ================================================================
 *  图标 (20x20, stroke-width=1.8)
 * ================================================================ */
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

/* ================================================================
 *  Letter Grade 映射
 * ================================================================ */
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

/* ================================================================
 *  共享工具
 * ================================================================ */
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
  // 把分钟展示为：
  //   xh    黑色大字体 +  xm    灰色小字体
  // 例如  150min  =>  2h    30m
  // 当没有小时部分或没有分钟部分时，保留为 "0h" / "00m" 便于对齐
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


function isSelfForm(form) {
  // form: varchar(50)。自主 = 2,3,4,5,6 对应文本里含 "自主预习/自主复习/自主练习/校外线上/校外线下"
  // 同时兼容旧 smallint 值
  if (typeof form === 'number') return [2, 3, 4, 5, 6].includes(form);
  const s = String(form || '');
  return s.includes('自主') || s.includes('校外');
}

/* ================================================================
 *  区块 1：总览 Hero
 * ================================================================ */
function HeroBlock({ sessions }) {
  const stats = useMemo(() => {
    if (!sessions || sessions.length === 0) {
      return { total: 0, avg: 0, weekdayAvg: 0, weekendAvg: 0, wk4Avg: 0, we4Avg: 0, days: 0 };
    }
    const today = new Date();

    // 最近 7 天工作日/周末
    let wk7 = 0, we7 = 0, wk7Days = 0, we7Days = 0;
    // 最近 28 天
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

    return {
      total,
      avg: Math.round(total / Math.max(7, 1)),
      weekdayAvg: wk7Days > 0 ? Math.round(wk7 / wk7Days) : 0,
      weekendAvg: we7Days > 0 ? Math.round(we7 / we7Days) : 0,
      wk4Avg: wk28Days > 0 ? Math.round(wk28 / wk28Days) : 0,
      we4Avg: we28Days > 0 ? Math.round(we28 / we28Days) : 0,
      days: 7,
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

      {/* 居中大数字 */}
      <div style={{ textAlign: 'center', padding: '12px 0 24px' }}>
        <div>
          <TimeAmount minutes={stats.total} scale={2} />
        </div>
        <div style={{ color: '#9ca3af', fontSize: '13px', marginTop: '8px' }}>
          日均 <TimeAmount minutes={stats.avg} scale={0.55} /> · 近 {stats.days} 天
        </div>
      </div>

      {/* 工作日 / 周末 对比卡片 */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
        {/* 工作日卡片 */}
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

        {/* 周末卡片 */}
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

/* ================================================================
 *  区块 2：学习连续性（Streak）
 * ================================================================ */
function StreakBlock({ sessions }) {
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

/* ================================================================
 *  区块 3：学习效率指标
 * ================================================================ */
function EfficiencyBlock({ sessions }) {
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

    let efficiencyGrade = null;
    if (hours > 0) {
      if (scorePerHour >= 15) efficiencyGrade = { grade: 'A', color: '#10b981' };
      else if (scorePerHour >= 10) efficiencyGrade = { grade: 'B', color: '#0ea5e9' };
      else if (scorePerHour >= 5) efficiencyGrade = { grade: 'C', color: '#f59e0b' };
      else efficiencyGrade = { grade: 'D', color: '#fb923c' };
    }

    return { scorePerHour, avgSession, efficiencyGrade };
  }, [sessions]);

  if (stats.efficiencyGrade === null) {
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
          <div style={{ fontSize: '12px', color: '#64748b', marginBottom: '8px' }}>效率评分</div>
          <div style={{
            fontSize: '48px',
            fontWeight: 800,
            color: stats.efficiencyGrade.color,
            lineHeight: 1,
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          }}>
            {stats.efficiencyGrade.grade}
          </div>
          <div style={{ fontSize: '10px', color: '#94a3b8', marginTop: '4px' }}>
            每小时平均分数：{stats.scorePerHour} 分
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

/* ================================================================
 *  区块 4：月度趋势柱状图
 * ================================================================ */
function MonthlyBarsBlock({ sessions }) {
  const data = useMemo(() => {
    // 取最近 6 个月
    const today = new Date();
    const months = []; // [{ year, month, label, weekdaySum, weekdayDays, weekendSum, weekendDays }]
    for (let i = 5; i >= 0; i--) {
      const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
      const year = d.getFullYear();
      const month = d.getMonth(); // 0-indexed
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

    // 填充每天计数
    for (const m of months) {
      const daysInMonth = new Date(m.year, m.month + 1, 0).getDate();
      for (let d = 1; d <= daysInMonth; d++) {
        const day = new Date(m.year, m.month, d);
        if (day > today) break;
        const iso = day.toISOString().slice(0, 10);
        if (isWeekday(iso)) m.wkDays++; else m.weDays++;
      }
    }

    // 聚合 session
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

    // 计算日均
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

  // 柱状图
  const maxVal = Math.max(...data.flatMap((m) => [m.wkAvg, m.weAvg]), 30);
  // y 轴取到最近的 2h 倍数
  const niceMax = Math.ceil(maxVal / 120) * 120 || 120;
  const yTicks = [0, 120, 240, 360, 480].filter((v) => v <= niceMax);

  // SVG 尺寸
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
            {/* y 轴刻度 */}
            {yTicks.map((v, i) => {
              const y = H - padB - scale(v);
              const h = Math.floor(v / 60);
              const m = v % 60;
              return (
                <g key={i}>
                  <line x1={padL} y1={y} x2={W - padR} y2={y} stroke={v === 0 ? '#cbd5e1' : 'transparent'} strokeWidth="1" />
                  {/* 主标签：xh  */}
                  <text x={padL - 6} y={y + 3} fontSize="10" textAnchor="end" fill="#0f172a" fontFamily="ui-monospace, monospace" fontWeight="700">
                    {h}h
                  </text>
                  {/* 次要标签：xm（仅当 m>0 时显示） */}
                  {m > 0 && (
                    <text x={padL - 24} y={y + 3} fontSize="8" textAnchor="end" fill="#94a3b8" fontFamily="ui-monospace, monospace">
                      {String(m).padStart(2, '0')}m
                    </text>
                  )}
                </g>
              );
            })}

            {/* 分组柱 */}
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
                  {/* 工作日柱 */}
                  <rect
                    x={gx}
                    y={m.hasData ? yBase - wkH : yBase}
                    width={barW}
                    height={m.hasData ? wkH : 4}
                    rx={m.hasData ? 4 : 2}
                    fill={m.hasData ? '#6366f1' : '#e5e7eb'}
                  />
                  {/* 周末柱 */}
                  <rect
                    x={gx + barW + innerPad}
                    y={m.hasData ? yBase - weH : yBase}
                    width={barW}
                    height={m.hasData ? weH : 4}
                    rx={m.hasData ? 4 : 2}
                    fill={m.hasData ? '#f59e0b' : '#e5e7eb'}
                  />

                  {/* 顶部数值/占位 */}
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

                  {/* x 轴标签 */}
                  <text x={gx + groupW / 2} y={yBase + 16} fontSize="11" textAnchor="middle" fill="#94a3b8">
                    {m.label}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>

        {/* 图例 */}
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

/* ================================================================
 *  区块 3：科目投入矩阵（横向滚动卡片）
 * ================================================================ */
function SubjectMatrixBlock({ sessions }) {
  const subjects = useMemo(() => {
    // 本周（最近 7 天）
    const today = new Date();
    const weekSet = new Set();
    for (let i = 0; i < 7; i++) {
      const d = new Date(today); d.setDate(today.getDate() - i);
      weekSet.add(d.toISOString().slice(0, 10));
    }

    const bySubj = {};
    for (const s of sessions) {
      if (!weekSet.has(s.date)) continue;
      const subj = s.subject || '未分类';
      const mins = s.duration_minutes || 0;
      const self = isSelfForm(s.form);

      bySubj[subj] = bySubj[subj] || {
        subject: subj,
        total: 0,
        review: { total: 0, self: 0 },
        practice: { total: 0, self: 0 },
        study: { total: 0, self: 0 },
      };

      bySubj[subj].total += mins;
      if (s.category === 2) {
        bySubj[subj].review.total += mins;
        if (self) bySubj[subj].review.self += mins;
      } else if (s.category === 3) {
        bySubj[subj].practice.total += mins;
        if (self) bySubj[subj].practice.self += mins;
      } else if (s.category === 1) {
        bySubj[subj].study.total += mins;
        if (self) bySubj[subj].study.self += mins;
      }
    }

    const arr = Object.values(bySubj)
      .filter((x) => x.total > 0)
      .sort((a, b) => b.total - a.total);

    // 最大总时长，用于条形相对长度
    const maxTotal = arr.length > 0 ? Math.max(...arr.map((x) => x.total)) : 0;
    for (const x of arr) x._maxTotal = maxTotal;

    return arr;
  }, [sessions]);

  if (subjects.length === 0) {
    return (
      <SectionShell>
        <SectionTitle Icon={IconBookOpen} title="科目投入" subtitle="本周各科目学习·复习·练习 分解" color="#8b5cf6" />
        <EmptyState />
      </SectionShell>
    );
  }

  const colorSelfRatio = (ratio) => {
    if (ratio > 0.7) return '#10b981';
    if (ratio >= 0.3) return '#f59e0b';
    return '#f43f5e';
  };

  return (
    <SectionShell>
      <SectionTitle Icon={IconBookOpen} title="科目投入" subtitle="本周各科目学习·复习·练习 分解" color="#8b5cf6" />

      <div style={{
        display: 'flex',
        gap: '12px',
        overflowX: 'auto',
        paddingBottom: '8px',
        scrollbarWidth: 'thin',
        scrollSnapType: 'x mandatory',
      }}>
        {subjects.map((subj, idx) => {
          const totalSelf = subj.review.self + subj.practice.self + subj.study.self;
          const selfRatio = subj.total > 0 ? totalSelf / subj.total : 0;

          const rows = [
            { key: 'review',  label: '复习', color: '#8b5cf6', data: subj.review },
            { key: 'practice', label: '练习', color: '#0ea5e9', data: subj.practice },
            { key: 'study',    label: '学习', color: '#10b981', data: subj.study },
          ];

          return (
            <div key={subj.subject} style={{
              flex: '0 0 auto',
              width: '280px',
              background: 'rgba(255,255,255,0.4)',
              backdropFilter: 'blur(20px)',
              WebkitBackdropFilter: 'blur(20px)',
              border: '1px solid rgba(255,255,255,0.4)',
              borderRadius: '16px',
              padding: '20px',
              scrollSnapAlign: 'start',
              display: 'flex',
              flexDirection: 'column',
            }}>
              {/* 科目名 + 总时长 */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '16px' }}>
                <span style={{ fontSize: '14px', fontWeight: 600, color: '#334155' }}>{subj.subject}</span>
                <TimeAmount minutes={subj.total} scale={0.9} />
              </div>

              {/* 三行 行为类型 */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {rows.map((row) => {
                  const selfPct = subj.total > 0 ? Math.round((row.data.self / subj._maxTotal) * 100) : 0;
                  const totalPct = subj.total > 0 ? Math.round((row.data.total / subj._maxTotal) * 100) : 0;
                  return (
                    <div key={row.key}>
                      <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        marginBottom: '4px',
                      }}>
                        <span style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '6px',
                          fontSize: '12px',
                          color: row.data.total > 0 ? '#475569' : '#94a3b8',
                        }}>
                          <span style={{
                            width: '6px',
                            height: '6px',
                            borderRadius: '3px',
                            background: row.color,
                            display: 'inline-block',
                          }} />
                          {row.label}
                        </span>
                        <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 4 }}>
                          <TimeAmount minutes={row.data.self} scale={0.4} />
                          <span style={{ fontSize: '11px', color: '#94a3b8' }}>/</span>
                          <TimeAmount minutes={row.data.total} scale={0.4} />
                        </span>
                      </div>
                      {/* 背景轨道 */}
                      <div style={{
                        background: '#e5e7eb',
                        borderRadius: '999px',
                        height: '8px',
                        width: '100%',
                        overflow: 'hidden',
                        position: 'relative',
                      }}>
                        {/* 非自主部分（同色浅色） */}
                        {totalPct > 0 && (
                          <div style={{
                            position: 'absolute',
                            left: 0,
                            top: 0,
                            bottom: 0,
                            width: totalPct + '%',
                            background: row.color + '33',
                          }} />
                        )}
                        {/* 自主部分（实色，覆盖在前） */}
                        {selfPct > 0 && (
                          <div style={{
                            position: 'absolute',
                            left: 0,
                            top: 0,
                            bottom: 0,
                            width: selfPct + '%',
                            background: row.color,
                            borderRadius: '999px',
                          }} />
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* 自主占比 */}
              <div style={{ marginTop: '16px', paddingTop: '12px', borderTop: '1px dashed rgba(148,163,184,0.3)' }}>
                <div style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'baseline',
                }}>
                  <span style={{ fontSize: '11px', color: '#94a3b8' }}>自主占比</span>
                  <span style={{
                    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                    fontSize: '14px',
                    fontWeight: 700,
                    color: colorSelfRatio(selfRatio),
                  }}>
                    {Math.round(selfRatio * 100)}%
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </SectionShell>
  );
}

/* ================================================================
 *  区块 4：客观评估平均分
 * ================================================================ */
function ObjectiveScoresBlock({ sessions }) {
  const rows = useMemo(() => {
    // 所有 eval_type 等于 2（客观评估） 且 score 非空的记录聚合。
    // 注意：Postgres smallint 在 Supabase.js 中可能是 number / string；
    //       score 同样可能是 string/null。用 Number() 宽松比对。
    const by = {};
    for (const s of sessions) {
      if (Number(s.eval_type) !== 2) continue;
      if (s.score == null || s.score === '' || Number.isNaN(Number(s.score))) continue;
      const subj = s.subject || '未分类';
      by[subj] = by[subj] || { subject: subj, scoreSum: 0, count: 0 };
      by[subj].scoreSum += Number(s.score);
      by[subj].count += 1;
    }

    const arr = Object.values(by).map((x) => ({
      ...x,
      avg: x.count > 0 ? x.scoreSum / x.count : 0,
      grade: x.count > 0 ? avgScoreToGrade(x.scoreSum / x.count) : null,
    }));

    // 同时也收录没有客观评估但在 sessions 中出现过的科目 → 显示占位
    // 为简洁起见，这里只展示有客观评估的科目。
    // 若完全没有客观评估 → EmptyState
    return arr.sort((a, b) => b.avg - a.avg);
  }, [sessions]);

  if (rows.length === 0) {
    return (
      <SectionShell>
        <SectionTitle Icon={IconTarget} title="客观评估" subtitle="各科目客观平均分" color="#334155" />
        <EmptyState />
      </SectionShell>
    );
  }

  return (
    <SectionShell>
      <SectionTitle Icon={IconTarget} title="客观评估" subtitle="各科目客观平均分" color="#334155" />

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))',
        gap: '12px',
      }}>
        {rows.map((r) => {
          const grade = r.grade;
          const color = grade ? grade.color : '#94a3b8';
          return (
            <div key={r.subject} style={{
              background: color + '14',
              border: '1px solid ' + color + '40',
              borderRadius: '16px',
              padding: '14px 10px 12px',
              textAlign: 'center',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '4px',
            }}>
              <div style={{
                fontSize: '12px',
                fontWeight: 500,
                color: '#334155',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                maxWidth: '100%',
              }}>{r.subject}</div>
              <div style={{
                fontSize: '32px',
                lineHeight: 1,
                fontWeight: 800,
                letterSpacing: '-0.02em',
                color: color,
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                marginTop: '4px',
              }}>
                {grade ? grade.grade : '—'}
              </div>
              <div style={{
                fontSize: '10px',
                color: '#94a3b8',
                marginTop: '2px',
              }}>{r.count} 次 · 平均 {Math.round(r.avg)}</div>
            </div>
          );
        })}
      </div>
    </SectionShell>
  );
}

/* ================================================================
 *  主组件
 * ================================================================ */
export default function Review() {
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [timeRange, setTimeRange] = useState('week');

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setLoading(false); return; }

      const { data, error } = await supabase
        .from('learning_sessions')
        .select(`
          id, session_date, duration_minutes, category, form, eval_type,
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

      const list = (data || []).map((s) => ({
        ...s,
        date: String(s.session_date || '').slice(0, 10),
        subject: s.course?.subject || s.course?.name || '未分类',
      }));
      setSessions(list);
      setLoading(false);
    })();
  }, []);

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
      <SubjectMatrixBlock sessions={filteredSessions} />
      <ObjectiveScoresBlock sessions={filteredSessions} />
    </div>
  );
}

// 供老师端复用：只需传入某个学生的 sessions 数组（每个元素需包含
// date, subject, duration_minutes, category, form, eval_type, score）
// 即可渲染同样的 4 个 Review 区块
function SuggestionsBlock({ sessions }) {
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

    const subjSessions = sessions.filter(s => s.eval_type === 1);
    const avgSubj = subjSessions.length > 0
      ? subjSessions.reduce((a, s) => a + (s.self_rating || 0), 0) / subjSessions.length
      : null;

    const suggestions = [];

    if (avgDaily < 30) {
      suggestions.push({
        icon: '📚',
        text: '最近学习时间较少，建议每天安排至少 30 分钟专注学习。',
        color: '#f59e0b',
      });
    }

    if (avgGradeScore !== null && avgGradeScore < 75) {
      suggestions.push({
        icon: '🎯',
        text: '客观评估分数偏低，建议重点复习薄弱科目，多做练习题。',
        color: '#ef4444',
      });
    }

    if (avgSubj !== null && avgSubj < 60) {
      suggestions.push({
        icon: '💡',
        text: '自我评估显示掌握程度不足，建议回顾课堂笔记或寻求老师帮助。',
        color: '#f59e0b',
      });
    }

    if (avgSubj !== null && avgGradeScore !== null && avgSubj > 80 && avgGradeScore < 75) {
      suggestions.push({
        icon: '🔍',
        text: '自我感觉良好但实际分数偏低，建议多做模拟测试检验真实水平。',
        color: '#8b5cf6',
      });
    }

    if (totalMins > 420 && avgGradeScore !== null && avgGradeScore < 85) {
      suggestions.push({
        icon: '⏰',
        text: '学习时间充足但效率有待提高，建议优化学习方法和时间管理。',
        color: '#0ea5e9',
      });
    }

    if (suggestions.length === 0) {
      suggestions.push({
        icon: '🎉',
        text: '学习状态良好，继续保持！建议尝试挑战更高难度的内容。',
        color: '#10b981',
      });
    }

    return suggestions.slice(0, 3);
  }, [sessions]);

  if (suggestions.length === 0) return null;

  return (
    <SectionShell>
      <SectionTitle 
        Icon={IconTarget} 
        title="学习建议" 
        subtitle="根据你的学习数据提供建议" 
        color="#f59e0b" 
      />
      <div style={{
        background: 'rgba(255,255,255,0.4)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        border: '1px solid rgba(255,255,255,0.4)',
        borderRadius: '16px',
        padding: '16px',
      }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {suggestions.map((s, i) => (
            <div key={i} style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: '10px',
              padding: '10px 12px',
              background: 'rgba(255,255,255,0.5)',
              borderRadius: '10px',
            }}>
              <span style={{ fontSize: '18px', lineHeight: 1 }}>{s.icon}</span>
              <span style={{ fontSize: '13px', color: '#334155', lineHeight: 1.5 }}>
                {s.text}
              </span>
            </div>
          ))}
        </div>
      </div>
    </SectionShell>
  );
}

export function ReviewDashboard({ sessions, footerNote }) {
  return (
    <div>
      <HeroBlock sessions={sessions} />
      <StreakBlock sessions={sessions} />
      <EfficiencyBlock sessions={sessions} />
      <MonthlyBarsBlock sessions={sessions} />
      <SubjectMatrixBlock sessions={sessions} />
      <ObjectiveScoresBlock sessions={sessions} />
      <SuggestionsBlock sessions={sessions} />
      {footerNote && (
        <div style={{ textAlign: 'center', fontSize: '11px', color: '#94a3b8', marginTop: '12px' }}>
          {footerNote}
        </div>
      )}
    </div>
  );
}
