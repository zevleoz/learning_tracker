import { useState, useMemo, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ComposedChart, Area, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
} from 'recharts';
import { useSubjectColors } from './DeepDivePanels.jsx';
import {
  fmtMins, scoreColor, CATEGORY_NAMES, CATEGORY_COLORS,
  isSelfForm, SELF_COLOR, getWeeksInRange,
} from './WeekGrid.jsx';
import { isWeekday, shortDate } from '../lib/date.js';
import DateRangeCalendar from './DateRangeCalendar.jsx';

// ── 时间预设 ──
const TIME_PRESETS = [
  { id: 'week',    label: '本周',  days: 7 },
  { id: 'month',   label: '本月',  days: 30 },
  { id: 'quarter', label: '近3月', days: 90 },
  { id: 'year',    label: '全年',  days: 365 },
  { id: 'custom',  label: '自定义', days: 0 },
];

function getPresetRange(id) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const preset = TIME_PRESETS.find(p => p.id === id);
  if (!preset || !preset.days) return null;
  const start = new Date(today);
  start.setDate(today.getDate() - preset.days + 1);
  return { start, end: today };
}

// ── 统计计算 ──
function computeStats(sessions) {
  if (!sessions || sessions.length === 0) {
    return {
      total: 0, dailyAvg: 0, activeDays: 0, spanDays: 0,
      byDate: {},
      weekdayAvg: 0, weekendAvg: 0,
      currentStreak: 0, longestStreak: 0,
      subjectAnalysis: [], recentSessions: [],
    };
  }

  const total = sessions.reduce((a, s) => a + (s.duration_minutes || 0), 0);

  // 按日期聚合
  const byDate = {};
  for (const s of sessions) {
    const d = s.date?.split('T')[0];
    if (!d) continue;
    if (!byDate[d]) byDate[d] = 0;
    byDate[d] += s.duration_minutes || 0;
  }
  const uniqueDates = Object.keys(byDate).sort();
  const activeDays = uniqueDates.length;

  // 日期跨度
  let spanDays = 1;
  if (uniqueDates.length > 0) {
    const earliest = new Date(uniqueDates[0] + 'T00:00:00');
    const latest = new Date(uniqueDates[uniqueDates.length - 1] + 'T00:00:00');
    spanDays = Math.max(1, Math.round((latest - earliest) / 86400000) + 1);
  }
  const dailyAvg = Math.round(total / spanDays);

  // 工作日/周末日均
  let weekdayTotal = 0, weekendTotal = 0, weekdayDays = 0, weekendDays = 0;
  for (const [date, mins] of Object.entries(byDate)) {
    if (isWeekday(date)) { weekdayTotal += mins; weekdayDays++; }
    else { weekendTotal += mins; weekendDays++; }
  }
  const weekdayAvg = weekdayDays > 0 ? Math.round(weekdayTotal / weekdayDays) : 0;
  const weekendAvg = weekendDays > 0 ? Math.round(weekendTotal / weekendDays) : 0;

  // 连续学习
  const dateSet = new Set(uniqueDates);
  const todayStr = new Date().toISOString().slice(0, 10);
  let currentStreak = 0;
  const todayD = new Date(todayStr + 'T00:00:00');
  for (let i = 0; i < 365; i++) {
    const d = new Date(todayD);
    d.setDate(todayD.getDate() - i);
    const dStr = d.toISOString().slice(0, 10);
    if (dateSet.has(dStr)) currentStreak++;
    else if (i > 0) break;
  }
  let longestStreak = 0, temp = 0;
  for (let i = 0; i < uniqueDates.length; i++) {
    if (i === 0) { temp = 1; }
    else {
      const prev = new Date(uniqueDates[i - 1] + 'T00:00:00');
      const curr = new Date(uniqueDates[i] + 'T00:00:00');
      const diff = Math.round((curr - prev) / 86400000);
      temp = diff === 1 ? temp + 1 : 1;
    }
    longestStreak = Math.max(longestStreak, temp);
  }

  // 学科 × 类型 × 自主
  const bySubjectType = {};
  for (const s of sessions) {
    const name = (s.subject || '未分类').trim();
    if (!bySubjectType[name]) {
      bySubjectType[name] = { name, total: 0, byCat: { 1: 0, 2: 0, 3: 0 }, selfTotal: 0 };
    }
    const cat = Number(s.category) || 1;
    const mins = s.duration_minutes || 0;
    bySubjectType[name].total += mins;
    bySubjectType[name].byCat[cat] += mins;
    if (isSelfForm(s.form)) bySubjectType[name].selfTotal += mins;
  }
  const subjectAnalysis = Object.values(bySubjectType)
    .map(x => ({
      ...x,
      pct: total > 0 ? Math.round(x.total / total * 100) : 0,
      selfPct: x.total > 0 ? Math.round(x.selfTotal / x.total * 100) : 0,
    }))
    .sort((a, b) => b.total - a.total);

  // 最近记录
  const recentSessions = [...sessions]
    .sort((a, b) => (a.date > b.date ? -1 : a.date < b.date ? 1 : 0))
    .slice(0, 10);

  return {
    total, dailyAvg, activeDays, spanDays, byDate,
    weekdayAvg, weekendAvg,
    currentStreak, longestStreak,
    subjectAnalysis, recentSessions,
  };
}

// ── 卡片 ──
function Card({ children, style, delay = 0 }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, delay }}
      style={{
        background: '#fff',
        borderRadius: 12,
        border: '1px solid rgba(15,23,42,0.06)',
        boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
        padding: 16,
        ...style,
      }}
    >
      {children}
    </motion.div>
  );
}

function SectionLabel({ children }) {
  return (
    <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', letterSpacing: '0.02em', textTransform: 'uppercase', marginBottom: 12 }}>
      {children}
    </div>
  );
}

function StatBlock({ label, value, color }) {
  return (
    <div style={{
      padding: '12px 14px',
      borderRadius: 10,
      background: '#f8fafc',
      border: '1px solid rgba(15,23,42,0.04)',
    }}>
      <div style={{ fontSize: 10, fontWeight: 600, color: '#94a3b8', marginBottom: 4, letterSpacing: '0.01em' }}>
        {label}
      </div>
      <div style={{
        fontSize: 18, fontWeight: 700, color,
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', lineHeight: 1.2,
      }}>
        {value}
      </div>
    </div>
  );
}

// ── 主组件 ──
export default function StudentDashboard({ sessions = [] }) {
  const [presetId, setPresetId] = useState('week');
  const [customRange, setCustomRange] = useState(null);
  const [showCalendar, setShowCalendar] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    const handler = (e) => setIsMobile(e.matches);
    handler(mq);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  const range = customRange || getPresetRange(presetId) || getPresetRange('week');

  const filteredSessions = useMemo(() => {
    const startStr = range.start.toISOString().split('T')[0];
    const endStr = range.end.toISOString().split('T')[0];
    return sessions.filter(s => {
      const d = s.date?.split('T')[0];
      return d && d >= startStr && d <= endStr;
    });
  }, [sessions, range]);

  const stats = useMemo(() => computeStats(filteredSessions), [filteredSessions]);
  const getSubjectColor = useSubjectColors(filteredSessions);

  // 每日学习时长趋势数据
  const dailyChartData = useMemo(() => {
    if (!range) return [];
    const startD = new Date(range.start);
    startD.setHours(0, 0, 0, 0);
    const endD = new Date(range.end);
    endD.setHours(0, 0, 0, 0);
    const dayDiff = Math.round((endD - startD) / 86400000) + 1;

    if (dayDiff <= 60) {
      // 按日
      const data = [];
      for (let i = 0; i < dayDiff; i++) {
        const d = new Date(startD);
        d.setDate(startD.getDate() + i);
        const dStr = d.toISOString().split('T')[0];
        data.push({
          date: `${d.getMonth() + 1}/${d.getDate()}`,
          minutes: stats.byDate?.[dStr] || 0,
        });
      }
      return data;
    } else {
      // 按周（getWeeksInRange 返回 Date 数组，每个是该周一）
      const weekMondays = getWeeksInRange(range.start, range.end);
      return weekMondays.map(monday => {
        let total = 0;
        const cur = new Date(monday);
        cur.setHours(0, 0, 0, 0);
        const wEnd = new Date(monday);
        wEnd.setDate(monday.getDate() + 6); // 周日
        wEnd.setHours(0, 0, 0, 0);
        while (cur <= wEnd) {
          const dStr = cur.toISOString().split('T')[0];
          total += stats.byDate?.[dStr] || 0;
          cur.setDate(cur.getDate() + 1);
        }
        return {
          date: `${monday.getMonth() + 1}/${monday.getDate()}`,
          minutes: total,
        };
      });
    }
  }, [range, stats.byDate]);

  function handlePreset(id) {
    if (id === 'custom') {
      setShowCalendar(true);
    } else {
      setShowCalendar(false);
      setPresetId(id);
      setCustomRange(null);
    }
  }

  const rangeLabel = `${range.start.getMonth() + 1}/${range.start.getDate()} - ${range.end.getMonth() + 1}/${range.end.getDate()}`;

  // 空状态
  if (!sessions || sessions.length === 0) {
    return (
      <div style={{ padding: 32, textAlign: 'center' }}>
        <div style={{ fontSize: 28, marginBottom: 8 }}>📊</div>
        <div style={{ fontSize: 14, fontWeight: 600, color: '#475569', marginBottom: 4 }}>暂无学习记录</div>
        <div style={{ fontSize: 12, color: '#94a3b8' }}>去「记录」页添加学习记录后，数据将在此展示</div>
      </div>
    );
  }

  if (filteredSessions.length === 0) {
    return (
      <div style={{ paddingBottom: 112 }}>
        <Toolbar
          presetId={presetId} customRange={customRange} rangeLabel={rangeLabel}
          onPreset={handlePreset} showCalendar={showCalendar}
          setShowCalendar={setShowCalendar} setCustomRange={setCustomRange} setPresetId={setPresetId}
        />
        <div style={{ padding: 32, textAlign: 'center' }}>
          <div style={{ fontSize: 28, marginBottom: 8 }}>📅</div>
          <div style={{ fontSize: 14, fontWeight: 600, color: '#475569', marginBottom: 4 }}>该时段暂无记录</div>
          <div style={{ fontSize: 12, color: '#94a3b8' }}>试试切换其他时间范围</div>
        </div>
      </div>
    );
  }

  const streakColor = stats.currentStreak >= 7 ? '#10B981' : stats.currentStreak >= 3 ? '#EA580C' : '#64748b';

  return (
    <div style={{ paddingBottom: 112, display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* ── 时间筛选栏 ── */}
      <Toolbar
        presetId={presetId} customRange={customRange} rangeLabel={rangeLabel}
        onPreset={handlePreset} showCalendar={showCalendar}
        setShowCalendar={setShowCalendar} setCustomRange={setCustomRange} setPresetId={setPresetId}
      />

      {/* ── Hero 总览 ── */}
      <Card delay={0.02}>
        <SectionLabel>学习总览 · {rangeLabel}</SectionLabel>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <StatBlock label="总时长" value={fmtMins(stats.total)} color="#0f172a" />
          <StatBlock label="日均时长" value={fmtMins(stats.dailyAvg)} color="#0f172a" />
          <StatBlock label="活跃天数" value={`${stats.activeDays}天`} color="#4F46E5" />
          <StatBlock label="连续学习" value={`${stats.currentStreak}天`} color={streakColor} />
        </div>
      </Card>

      {/* ── 每日学习时长趋势 ── */}
      <Card delay={0.04}>
        <SectionLabel>每日学习时长</SectionLabel>
        <div style={{ height: 180 }}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={dailyChartData} margin={{ top: 8, right: 8, bottom: 0, left: -20 }}>
              <defs>
                <linearGradient id="trendGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#4F46E5" stopOpacity={0.15} />
                  <stop offset="100%" stopColor="#4F46E5" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis
                dataKey="date"
                tick={{ fontSize: 9, fill: '#94a3b8' }}
                axisLine={{ stroke: '#e2e8f0' }}
                tickLine={false}
                interval={dailyChartData.length > 20 ? Math.floor(dailyChartData.length / 8) : 0}
              />
              <YAxis hide />
              <Tooltip
                cursor={{ stroke: 'rgba(79,70,229,0.2)', strokeWidth: 1, fill: 'rgba(79,70,229,0.06)' }}
                contentStyle={{ borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 11 }}
                formatter={(v) => [fmtMins(v), '学习时长']}
                labelFormatter={(l) => `${l}`}
              />
              <Area type="monotone" dataKey="minutes" stroke="none" fill="url(#trendGrad)" />
              <Line
                type="monotone"
                dataKey="minutes"
                stroke="#4F46E5"
                strokeWidth={2}
                dot={{ r: 3, fill: '#4F46E5', strokeWidth: 0 }}
                activeDot={{ r: 6, fill: '#4F46E5', stroke: '#fff', strokeWidth: 2 }}
                connectNulls
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </Card>

      {/* ── 学科 × 学习类型 × 自主占比 ── */}
      {stats.subjectAnalysis.length > 0 && (
        <Card delay={0.06}>
          <SectionLabel>学科分析</SectionLabel>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {stats.subjectAnalysis.map((subj, i) => {
              const color = getSubjectColor(subj.name);
              const selfColor = subj.selfPct >= 60 ? SELF_COLOR : subj.selfPct >= 30 ? '#64748b' : '#94a3b8';
              return (
                <div key={i}>
                  {/* 学科行头部 */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, flexShrink: 0 }} />
                    <span style={{ fontSize: 12, fontWeight: 600, color: '#1e293b', flex: 1 }}>
                      {subj.name}
                    </span>
                    <span style={{ fontSize: 11, color: '#64748b', fontFamily: 'ui-monospace, monospace' }}>
                      {fmtMins(subj.total)}
                    </span>
                    <span style={{
                      fontSize: 10, fontWeight: 600, color: selfColor,
                      background: `${selfColor}0d`, borderRadius: 4, padding: '2px 6px',
                    }}>
                      自主 {subj.selfPct}%
                    </span>
                  </div>
                  {/* 堆叠条形图 */}
                  <div style={{ display: 'flex', height: 8, borderRadius: 4, overflow: 'hidden', background: '#f1f5f9', marginBottom: 4 }}>
                    {[1, 2, 3].map(cat => {
                      const w = subj.total > 0 ? (subj.byCat[cat] / subj.total) * 100 : 0;
                      if (w === 0) return null;
                      return (
                        <motion.div
                          key={cat}
                          initial={{ width: 0 }}
                          animate={{ width: `${w}%` }}
                          transition={{ duration: 0.4, delay: 0.04 * i + 0.02 * cat }}
                          style={{ height: '100%', background: CATEGORY_COLORS[cat] }}
                        />
                      );
                    })}
                  </div>
                  {/* 类型明细 */}
                  <div style={{ display: 'flex', gap: 12, fontSize: 10, color: '#94a3b8' }}>
                    {[1, 2, 3].map(cat => (
                      <span key={cat} style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                        <span style={{ width: 6, height: 6, borderRadius: '50%', background: CATEGORY_COLORS[cat] }} />
                        {CATEGORY_NAMES[cat]} {fmtMins(subj.byCat[cat] || 0)}
                      </span>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {/* ── 最近记录 ── */}
      {stats.recentSessions.length > 0 && (
        <Card delay={0.08}>
          <SectionLabel>最近记录</SectionLabel>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {stats.recentSessions.map((s, i) => {
              const subjName = (s.subject || '未分类').trim();
              const color = getSubjectColor(subjName);
              const cat = s.category;
              const catName = CATEGORY_NAMES[cat] || '—';
              const hasScore = Number(s.eval_type) === 2 && s.score != null && s.score !== '';
              return (
                <div key={i} style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '6px 0',
                  borderBottom: i < stats.recentSessions.length - 1 ? '1px solid #f1f5f9' : 'none',
                }}>
                  <span style={{ fontSize: 11, color: '#94a3b8', fontFamily: 'ui-monospace, monospace', minWidth: 36, flexShrink: 0 }}>
                    {shortDate(s.date)}
                  </span>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: color, flexShrink: 0 }} />
                  <span style={{ fontSize: 12, fontWeight: 500, color: '#1e293b', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {subjName}
                  </span>
                  <span style={{
                    fontSize: 10, fontWeight: 600, color: '#64748b',
                    background: '#f1f5f9', borderRadius: 4, padding: '1px 6px',
                    flexShrink: 0,
                  }}>{catName}</span>
                  <span style={{ fontSize: 11, color: '#64748b', fontFamily: 'ui-monospace, monospace', flexShrink: 0 }}>
                    {fmtMins(s.duration_minutes || 0)}
                  </span>
                  {hasScore && (
                    <span style={{
                      fontSize: 11, fontWeight: 700, fontFamily: 'ui-monospace, monospace',
                      color: scoreColor(Number(s.score)), flexShrink: 0, minWidth: 24, textAlign: 'right',
                    }}>
                      {s.score}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </Card>
      )}
    </div>
  );
}

// ── 工具栏 ──
function Toolbar({ presetId, customRange, rangeLabel, onPreset, showCalendar, setShowCalendar, setCustomRange, setPresetId }) {
  return (
    <>
      <div style={{ display: 'flex', gap: 6, padding: '0 0 4px', overflowX: 'auto', alignItems: 'center' }}>
        {TIME_PRESETS.map(p => {
          const active = !customRange && presetId === p.id;
          return (
            <button
              key={p.id}
              onClick={() => onPreset(p.id)}
              style={{
                flex: '0 0 auto',
                padding: '5px 12px',
                borderRadius: 999,
                fontSize: 12,
                fontWeight: 600,
                border: 'none',
                cursor: 'pointer',
                background: active ? '#4F46E5' : 'rgba(255,255,255,0.6)',
                color: active ? '#fff' : '#64748b',
                transition: 'all 0.15s',
                whiteSpace: 'nowrap',
              }}
            >
              {p.label}
            </button>
          );
        })}
        {customRange && (
          <span style={{ fontSize: 11, color: '#94a3b8', marginLeft: 'auto', whiteSpace: 'nowrap' }}>
            {rangeLabel}
          </span>
        )}
      </div>

      <AnimatePresence>
        {showCalendar && (
          <motion.div
            initial={{ opacity: 0, y: -4, height: 0 }}
            animate={{ opacity: 1, y: 0, height: 'auto' }}
            exit={{ opacity: 0, y: -4, height: 0 }}
            style={{ display: 'flex', justifyContent: 'center', overflow: 'hidden' }}
          >
            <DateRangeCalendar
              start={new Date()}
              end={new Date()}
              onChange={(s, e) => {
                setCustomRange({ start: s, end: e });
                setPresetId('custom');
                setShowCalendar(false);
              }}
              onClose={() => setShowCalendar(false)}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

