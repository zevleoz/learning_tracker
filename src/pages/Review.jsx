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
 *  区块 2：月度趋势柱状图
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

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setLoading(false); return; }

      // 取近 180 天数据（供月度趋势）
      const { data, error } = await supabase
        .from('learning_sessions')
        .select(`
          id, session_date, duration_minutes, category, form, eval_type,
          score, course_id,
          course:course_id(name, subject)
        `)
        .eq('student_id', user.id)
        .gte('session_date', new Date(Date.now() - 180 * 24 * 3600 * 1000).toISOString().slice(0, 10))
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

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: '40px 16px', color: '#64748b', fontSize: '14px' }}>
        加载中…
      </div>
    );
  }

  return (
    <div style={{ paddingBottom: '112px' }}>
      <HeroBlock sessions={sessions} />
      <MonthlyBarsBlock sessions={sessions} />
      <SubjectMatrixBlock sessions={sessions} />
      <ObjectiveScoresBlock sessions={sessions} />
    </div>
  );
}

// 供老师端复用：只需传入某个学生的 sessions 数组（每个元素需包含
// date, subject, duration_minutes, category, form, eval_type, score）
// 即可渲染同样的 4 个 Review 区块
export function ReviewDashboard({ sessions, footerNote }) {
  return (
    <div>
      <HeroBlock sessions={sessions} />
      <MonthlyBarsBlock sessions={sessions} />
      <SubjectMatrixBlock sessions={sessions} />
      <ObjectiveScoresBlock sessions={sessions} />
      {footerNote && (
        <div style={{ textAlign: 'center', fontSize: '11px', color: '#94a3b8', marginTop: '12px' }}>
          {footerNote}
        </div>
      )}
    </div>
  );
}
