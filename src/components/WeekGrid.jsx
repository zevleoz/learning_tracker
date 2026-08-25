import { useMemo } from 'react';
import { motion } from 'framer-motion';

// ── 色彩 & 常量 ──────────────────────────────────────
// 新 3 层色空间（与 index.css :root 的 CSS 变量保持同步）
// 语义层颜色只承载"好坏程度"，分类层颜色只承载"是什么"——绝不互用
export const CATEGORY_COLORS = {
  1: '#2563EB', // 学 = Blue 600 深邃权威蓝（与品牌红补色对比）
  2: '#7C3AED', // 复 = Violet 600（含红色成分，呼应品牌暖色）
  3: '#0D9488', // 练 = Teal 600（饱和度 86%，不再 muddy；L31 形成明度梯度）
};
export const CATEGORY_NAMES  = { 1: '学', 2: '复', 3: '练' };
export const SELF_FORMS = ['自主预习', '自主复习', '自主练习'];
export const SELF_COLOR = '#2563EB';      // 自主 = Blue 600（跟随 Study 主色）
export const EXTERNAL_COLOR = '#A78BFA';  // 外部/辅导 = Violet 400 淡紫
export const EMPTY_COLOR = '#e2e8f0';

export function isSelfForm(form) {
  const s = String(form || '');
  return SELF_FORMS.includes(s);
}

export function fmtMins(mins) {
  if (!mins) return '0';
  if (mins < 60) return mins + '\'';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h}h${m}` : `${h}h`;
}

// 分数字颜色 → 走语义层 4 档，与分类色 hue 严格不相交
// good = grass-600  /  moderate = amber-500  /  risk = orange-600  /  alert = 品牌红
export function scoreColor(score) {
  if (score >= 85) return '#16A34A';  // sem-good（唯一"好"绿）
  if (score >= 75) return '#F59E0B';  // sem-moderate（唯一"中"黄）
  if (score >= 60) return '#EA580C';  // sem-risk（风险橙，与黄拉开明度差 20）
  return '#C1272D';                    // sem-alert（品牌红，最高警报）
}

export function scoreToGrade(score) {
  if (score >= 93) return 'A';
  if (score >= 90) return 'A-';
  if (score >= 87) return 'B+';
  if (score >= 83) return 'B';
  if (score >= 80) return 'B-';
  if (score >= 77) return 'C+';
  if (score >= 73) return 'C';
  if (score >= 70) return 'C-';
  if (score >= 60) return 'D';
  return 'F';
}

export function getMonday(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function getWeeksInRange(start, end) {
  const weeks = [];
  let monday = getMonday(start);
  const endDate = new Date(end);
  endDate.setHours(23, 59, 59, 999);
  while (monday <= endDate) {
    weeks.push(new Date(monday));
    const next = new Date(monday);
    next.setDate(next.getDate() + 7);
    monday = next;
  }
  return weeks;
}

export function fmtDateShort(d) {
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

const DAY_NAMES = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

// ── 日卡片 ────────────────────────────────────────────
function DayCard({ dayName, date, daySessions, isMobile, onClick }) {
  const data = useMemo(() => {
    if (!daySessions || daySessions.length === 0) return null;
    const totalMins = daySessions.reduce((a, s) => a + (s.duration_minutes || 0), 0);

    // Category breakdown
    const catMins = { 1: 0, 2: 0, 3: 0 };
    for (const s of daySessions) {
      const c = Number(s.category);
      if (catMins[c] !== undefined) catMins[c] += s.duration_minutes || 0;
    }

    // Subject breakdown
    const subjMap = {};
    for (const s of daySessions) {
      const name = s.subject || '未分类';
      subjMap[name] = (subjMap[name] || 0) + (s.duration_minutes || 0);
    }
    const subjects = Object.entries(subjMap)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([name, mins]) => ({ name, mins }));

    // Self-directed ratio
    const selfMins = daySessions
      .filter(s => isSelfForm(s.form))
      .reduce((a, s) => a + (s.duration_minutes || 0), 0);
    const selfPct = totalMins > 0 ? Math.round((selfMins / totalMins) * 100) : 0;

    // Intensity color (total minutes → background opacity)
    const intensity = Math.min(totalMins / 240, 1); // 240min = 4h → full intensity

    return { totalMins, catMins, subjects, selfPct, intensity };
  }, [daySessions]);

  const dateStr = fmtDateShort(date);

  // ── Empty day ──
  if (!data) {
    return (
      <div style={{
        borderRadius: 12,
        border: `1.5px dashed ${EMPTY_COLOR}`,
        padding: '12px 8px',
        minHeight: isMobile ? 56 : 120,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 4,
      }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: '#cbd5e1' }}>{dayName}</div>
        <div style={{ fontSize: 10, color: '#e2e8f0' }}>{dateStr}</div>
        <div style={{ fontSize: 18, color: '#e2e8f0', fontWeight: 300 }}>—</div>
      </div>
    );
  }

  // ── Active day ──
  if (isMobile) {
    // Horizontal strip for mobile
    return (
      <motion.div
        initial={{ opacity: 0, x: -10 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.2 }}
        onClick={onClick}
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '8px 10px', borderRadius: 10,
          background: `rgba(99,102,241,${0.04 + data.intensity * 0.08})`,
          border: '1px solid rgba(15,23,42,0.06)',
        }}
      >
        <div style={{ flexShrink: 0, width: 48 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: '#475569' }}>{dayName}</div>
          <div style={{ fontSize: 10, color: '#94a3b8' }}>{dateStr}</div>
        </div>
        <div style={{ fontSize: 18, fontWeight: 700, color: '#0f172a', width: 52, flexShrink: 0 }}>
          {fmtMins(data.totalMins)}
        </div>
        {/* Stacked bar */}
        <div style={{ display: 'flex', height: 6, borderRadius: 3, overflow: 'hidden', flex: 1, maxWidth: 80, background: '#f1f5f9' }}>
          {[1, 2, 3].map(c => {
            const w = data.totalMins > 0 ? (data.catMins[c] / data.totalMins) * 100 : 0;
            return w > 0 ? (
              <div key={c} style={{ width: `${w}%`, background: CATEGORY_COLORS[c] }} />
            ) : null;
          })}
        </div>
        {/* Subjects */}
        <div style={{ flex: 1, fontSize: 10, color: '#64748b', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
          {data.subjects.map(s => `${s.name.slice(0, 4)} ${fmtMins(s.mins)}`).join(' · ')}
        </div>
        {/* Self ratio */}
        <div style={{ fontSize: 10, fontWeight: 600, color: SELF_COLOR, flexShrink: 0 }}>
          {data.selfPct}%
        </div>
      </motion.div>
    );
  }

  // Desktop: vertical card
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      onClick={onClick}
      style={{
        borderRadius: 12,
        padding: '10px 8px',
        minHeight: 150,
        background: `rgba(99,102,241,${0.03 + data.intensity * 0.06})`,
        border: '1px solid rgba(15,23,42,0.06)',
        display: 'flex', flexDirection: 'column', gap: 6,
        cursor: onClick ? 'pointer' : 'default',
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: '#475569' }}>{dayName}</span>
        <span style={{ fontSize: 10, color: '#94a3b8' }}>{dateStr}</span>
      </div>

      {/* L1: Total minutes */}
      <div style={{ fontSize: 22, fontWeight: 800, color: '#0f172a', lineHeight: 1.1 }}>
        {fmtMins(data.totalMins)}
      </div>

      {/* L2: Stacked bar */}
      <div style={{ display: 'flex', height: 6, borderRadius: 3, overflow: 'hidden', background: '#f1f5f9' }}>
        {[1, 2, 3].map(c => {
          const w = data.totalMins > 0 ? (data.catMins[c] / data.totalMins) * 100 : 0;
          return w > 0 ? (
            <div key={c} style={{ width: `${w}%`, background: CATEGORY_COLORS[c] }} />
          ) : null;
        })}
      </div>
      <div style={{ display: 'flex', gap: 6, fontSize: 9, color: '#94a3b8' }}>
        {[1, 2, 3].map(c => (
          <span key={c}>
            <span style={{ color: CATEGORY_COLORS[c] }}>●</span>{CATEGORY_NAMES[c]}
            {data.totalMins > 0 ? Math.round(data.catMins[c] / data.totalMins * 100) : 0}%
          </span>
        ))}
      </div>

      {/* L3: Subjects */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 1, flex: 1 }}>
        {data.subjects.map((s, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#64748b' }}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 60 }}>
              {s.name.length > 6 ? s.name.slice(0, 5) + '…' : s.name}
            </span>
            <span style={{ fontWeight: 600, color: '#475569' }}>{fmtMins(s.mins)}</span>
          </div>
        ))}
      </div>

      {/* L4: Self ratio */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <svg width="12" height="12" viewBox="0 0 12 12">
          <circle cx="6" cy="6" r="5" fill="none" stroke="#e2e8f0" strokeWidth="2" />
          <circle cx="6" cy="6" r="5" fill="none" stroke={SELF_COLOR} strokeWidth="2"
            strokeDasharray={`${(data.selfPct / 100) * 31.4} 31.4`}
            transform="rotate(-90 6 6)" strokeLinecap="round" />
        </svg>
        <span style={{ fontSize: 10, fontWeight: 600, color: SELF_COLOR }}>{data.selfPct}%</span>
      </div>
    </motion.div>
  );
}

// ── 周历网格 ──────────────────────────────────────────
export default function WeekGrid({ sessions = [], weekStart, isMobile = false, onDayClick }) {
  const monday = getMonday(weekStart || new Date());

  const days = useMemo(() => {
    const byDay = Array.from({ length: 7 }, () => []);
    for (const s of sessions) {
      const dateStr = s.date?.split('T')[0];
      if (!dateStr) continue;
      const d = new Date(dateStr + 'T00:00:00');
      const diff = Math.round((d - monday) / (24 * 3600 * 1000));
      if (diff >= 0 && diff <= 6) byDay[diff].push(s);
    }
    return byDay;
  }, [sessions, monday]);

  if (isMobile) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {DAY_NAMES.map((name, i) => (
          <DayCard
            key={i}
            dayName={name}
            date={new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i)}
            daySessions={days[i]}
            isMobile
            onClick={onDayClick ? () => onDayClick(new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i)) : undefined}
          />
        ))}
      </div>
    );
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 6 }}>
      {DAY_NAMES.map((name, i) => (
        <DayCard
          key={i}
          dayName={name}
          date={new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i)}
          daySessions={days[i]}
          isMobile={false}
          onClick={onDayClick ? () => onDayClick(new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i)) : undefined}
        />
      ))}
    </div>
  );
}
