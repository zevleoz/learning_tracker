import { useState, useMemo, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import WeekGrid, { getMonday, getWeeksInRange, fmtDateShort } from './WeekGrid.jsx';
import DimensionStrip from './DimensionStrip.jsx';
import DeepDivePanels from './DeepDivePanels.jsx';
import DateRangeCalendar from './DateRangeCalendar.jsx';
import { toast } from '../lib/toast.js';

// ── 时段预设 ─────────────────────────────────────────
const PRESETS = [
  { id: 'thisWeek',  label: '本周',   weeks: 1 },
  { id: 'lastWeek',  label: '上周',   weeks: 1 },
  { id: '2weeks',    label: '近2周',  weeks: 2 },
  { id: '4weeks',    label: '近4周',  weeks: 4 },
  { id: 'thisMonth', label: '本月',   weeks: 5 },
  { id: 'custom',    label: '自定义',  weeks: 0 },
];

function getPresetRange(presetId) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  switch (presetId) {
    case 'thisWeek': {
      const monday = getMonday(today);
      return { start: monday, end: new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6) };
    }
    case 'lastWeek': {
      const thisMonday = getMonday(today);
      const lastMonday = new Date(thisMonday);
      lastMonday.setDate(lastMonday.getDate() - 7);
      return { start: lastMonday, end: new Date(lastMonday.getFullYear(), lastMonday.getMonth(), lastMonday.getDate() + 6) };
    }
    case '2weeks': {
      const monday = getMonday(today);
      const start = new Date(monday);
      start.setDate(start.getDate() - 7);
      return { start, end: new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6) };
    }
    case '4weeks': {
      const monday = getMonday(today);
      const start = new Date(monday);
      start.setDate(start.getDate() - 21);
      return { start, end: new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6) };
    }
    case 'thisMonth': {
      const first = new Date(today.getFullYear(), today.getMonth(), 1);
      const last = new Date(today.getFullYear(), today.getMonth() + 1, 0);
      return { start: first, end: last };
    }
    default: {
      const monday = getMonday(today);
      return { start: monday, end: new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6) };
    }
  }
}

function shiftRange(range, direction) {
  const days = Math.round((range.end - range.start) / (24 * 3600 * 1000)) + 1;
  const offset = direction * days;
  const start = new Date(range.start);
  start.setDate(start.getDate() + offset);
  const end = new Date(range.end);
  end.setDate(end.getDate() + offset);
  return { start, end };
}

// ── 主组件 ───────────────────────────────────────────
export default function WeekReviewDashboard({ sessions = [], student }) {
  const [presetId, setPresetId] = useState('thisWeek');
  const [customRange, setCustomRange] = useState(null);
  const [showCustomPicker, setShowCustomPicker] = useState(false);
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    const handler = (e) => setIsMobile(e.matches);
    handler(mq);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  const range = customRange || getPresetRange(presetId);
  const weeks = useMemo(() => getWeeksInRange(range.start, range.end), [range]);

  // Filter sessions to selected period
  const periodSessions = useMemo(() => {
    const startStr = range.start.toISOString().split('T')[0];
    const endStr = range.end.toISOString().split('T')[0];
    return sessions.filter(s => {
      const d = s.date?.split('T')[0];
      return d && d >= startStr && d <= endStr;
    });
  }, [sessions, range]);

  function handlePreset(id) {
    if (id === 'custom') {
      setShowCustomPicker(true);
      // Default custom range = this week
      const mon = getMonday(new Date());
      const end = new Date(mon);
      end.setDate(end.getDate() + 6);
      setCustomStart(mon.toISOString().split('T')[0]);
      setCustomEnd(end.toISOString().split('T')[0]);
    } else {
      setShowCustomPicker(false);
      setPresetId(id);
      setCustomRange(null);
    }
  }

  function applyCustomRange() {
    const s = new Date(customStart + 'T00:00:00');
    const e = new Date(customEnd + 'T00:00:00');
    if (s > e) {
      toast('起始日期不能晚于结束日期', { kind: 'error' });
      return;
    }
    setCustomRange({ start: s, end: e });
    setShowCustomPicker(false);
    setPresetId('custom');
  }

  function handleNav(direction) {
    setCustomRange(shiftRange(range, direction));
  }

  const rangeLabel = `${fmtDateShort(range.start)} - ${fmtDateShort(range.end)}`;
  const studentName = student?.full_name || '学生';

  // ── Empty state ──
  if (!sessions || sessions.length === 0) {
    return (
      <div style={{
        padding: 32, textAlign: 'center',
        background: 'rgba(255,255,255,0.5)', borderRadius: 16,
        border: '1px solid rgba(15,23,42,0.06)',
      }}>
        <div style={{ fontSize: 28, marginBottom: 8 }}>📋</div>
        <div style={{ fontSize: 14, fontWeight: 600, color: '#475569', marginBottom: 4 }}>
          {studentName} 暂无学习记录
        </div>
        <div style={{ fontSize: 12, color: '#94a3b8' }}>
          当学生开始记录学习过程后，数据将在此展示
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* ── 时间选择器 ── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
        padding: '10px 12px', borderRadius: 12,
        background: 'rgba(255,255,255,0.6)',
        border: '1px solid rgba(15,23,42,0.06)',
      }}>
        {/* Preset buttons */}
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {PRESETS.map(p => {
            const active = !customRange && presetId === p.id;
            return (
              <button
                key={p.id}
                onClick={() => handlePreset(p.id)}
                style={{
                  padding: '4px 10px', fontSize: 11, fontWeight: 600,
                  borderRadius: 6, border: 'none', cursor: 'pointer',
                  background: active ? '#4F46E5' : 'transparent',
                  color: active ? 'white' : '#64748b',
                  transition: 'all 0.15s',
                }}
              >
                {p.label}
              </button>
            );
          })}
        </div>

        {/* Range display + navigation */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6,
          marginLeft: 'auto',
        }}>
          <button
            onClick={() => handleNav(-1)}
            style={navBtnStyle}
            title="上一时段"
          >‹</button>
          <span style={{
            fontSize: 12, fontWeight: 600, color: '#475569',
            minWidth: 80, textAlign: 'center',
          }}>
            {rangeLabel}
          </span>
          <button
            onClick={() => handleNav(1)}
            style={navBtnStyle}
            title="下一时段"
          >›</button>
        </div>

        {/* Student name */}
        {student && (
          <div style={{
            fontSize: 11, color: '#94a3b8',
            padding: '2px 8px', borderRadius: 6,
            background: 'rgba(99,102,241,0.06)',
          }}>
            {studentName}
          </div>
        )}
      </div>

      {/* ── 自定义日期日历（拖拽选择区间） ── */}
      {showCustomPicker && (
        <motion.div
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          style={{ display: 'flex', justifyContent: 'center' }}
        >
          <DateRangeCalendar
            start={customStart ? new Date(customStart + 'T00:00:00') : getMonday(new Date())}
            end={customEnd ? new Date(customEnd + 'T00:00:00') : new Date()}
            onChange={(s, e) => {
              setCustomStart(s.toISOString().split('T')[0]);
              setCustomEnd(e.toISOString().split('T')[0]);
              setCustomRange({ start: s, end: e });
              setPresetId('custom');
              setShowCustomPicker(false);
            }}
            onClose={() => setShowCustomPicker(false)}
          />
        </motion.div>
      )}

      {/* ── 周历网格 ── */}
      <div>
        <div style={{
          fontSize: 12, fontWeight: 700, color: '#475569', marginBottom: 8,
          display: 'flex', alignItems: 'center', gap: 6,
        }}>
          <span style={{ width: 3, height: 14, background: '#4F46E5', borderRadius: 2, display: 'inline-block' }} />
          周历总览 {weeks.length > 1 && `(${weeks.length} 周)`}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {weeks.map((weekStart, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.08, duration: 0.25 }}
            >
              {weeks.length > 1 && (
                <div style={{
                  fontSize: 10, fontWeight: 600, color: '#94a3b8',
                  marginBottom: 4, paddingLeft: 2,
                }}>
                  {fmtDateShort(weekStart)} - {fmtDateShort(new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + 6))}
                </div>
              )}
              <WeekGrid
                sessions={periodSessions}
                weekStart={weekStart}
                isMobile={isMobile}
              />
            </motion.div>
          ))}
        </div>
      </div>

      {/* ── 维度总览 ── */}
      <DimensionStrip sessions={periodSessions} period={range} />

      {/* ── 深度分析（key 跟随时间维度变化，强制面板重挂载以重新展开 + 测量高度）── */}
      <DeepDivePanels
        key={`${presetId}-${range.start.toISOString()}-${range.end.toISOString()}`}
        sessions={periodSessions}
        weeks={weeks}
        studentName={studentName}
      />
    </div>
  );
}

const navBtnStyle = {
  width: 24, height: 24, borderRadius: 6,
  border: '1px solid rgba(15,23,42,0.08)',
  background: 'transparent', cursor: 'pointer',
  fontSize: 14, color: '#64748b', lineHeight: 1,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
};
