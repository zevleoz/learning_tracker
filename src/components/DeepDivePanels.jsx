import { useMemo, useState, useEffect, useRef, Component, Fragment } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  CATEGORY_COLORS, CATEGORY_NAMES, SELF_COLOR, EXTERNAL_COLOR,
  fmtMins, isSelfForm, scoreColor, scoreToGrade,
} from './WeekGrid.jsx';
import { logger } from '../lib/logger.js';

// ── 主观评价标签映射（self_rating 值 → 可读文本） ──
const SELF_RATING_LABELS = {
  20: '没有听课', 40: '像在听天书', 60: '有不少没掌握',
  80: '基本掌握', 100: '完全掌握',
};

// ── 语义层 4 档颜色（承载"好不好"，与 CSS var 全局同步） ──
const SEM = {
  good:     '#16A34A',
  moderate: '#F59E0B',
  risk:     '#EA580C',
  alert:    '#C1272D',
  muted:    '#94a3b8',
};
const SEM_BG = {
  good:     'rgba(22,163,74,0.08)',
  moderate: 'rgba(245,158,11,0.08)',
  risk:     'rgba(234,88,12,0.08)',
  alert:    'rgba(193,39,45,0.08)',
};

// ── ③ 分类层学科色：12 色黄金角交错排列 ──
// 不做"语文=xxx 色"硬绑定——真实学生课程组合差异太大（AP/IB/竞赛/艺体）
// 策略：useSubjectColors(sessionList) 在"当前学生当前分析页面"内做去重分配，
//       ≤12 门学科 0 重色；跨页跨会话同名课程用稳定 hash 近似锚定。
// 原则：全色相覆盖、零灰色、相邻 index 色相差 ≥ 69°（黄金角 137.5° 派生），
//       明度 34–53 区间维持高级感，任何子集任意 N 门课程组合均有清晰分离。
const CATEGORICAL_PALETTE = [
  '#DC2626', // 0  Red 600      H0   L44 — 暖色起点
  '#0891B2', // 1  Cyan 600     H190 L37 — Δ170°
  '#9333EA', // 2  Purple 600   H271 L41 — Δ81°
  '#CA8A04', // 3  Yellow 600   H47  L42 — Δ136°
  '#2563EB', // 4  Blue 600     H217 L53 — Δ170°
  '#EA580C', // 5  Orange 600   H21  L45 — Δ164°
  '#10B981', // 6  Emerald 500  H160 L40 — Δ139°
  '#DB2777', // 7  Pink 600     H330 L48 — Δ170°
  '#65A30D', // 8  Lime 600     H80  L34 — Δ110°
  '#4F46E5', // 9  Indigo 600   H249 L52 — Δ169°
  '#D97706', // 10 Amber 600    H32  L37 — Δ143°
  '#C026D3', // 11 Fuchsia 600  H291 L48 — Δ101°
];

export function useSubjectColors(sessionList) {
  return useMemo(() => {
    const unique = Array.from(new Set(
      sessionList.map(s => (s.subject || '未分类').trim()).filter(Boolean)
    ));
    const map = new Map();
    const usedIdx = new Set();
    for (const name of unique) {
      // DJB2 xor — 稳定 hash，跨会话同名 -> 近似同一 index
      let h = 5381;
      for (let i = 0; i < name.length; i++) h = (((h << 5) + h) ^ name.charCodeAt(i)) >>> 0;
      let idx = h % CATEGORICAL_PALETTE.length;
      // session 内撞色的话线性探下个空位（保证当前页 ≤12 门 0 重色）
      while (usedIdx.has(idx) && usedIdx.size < CATEGORICAL_PALETTE.length) {
        idx = (idx + 1) % CATEGORICAL_PALETTE.length;
      }
      usedIdx.add(idx);
      map.set(name, CATEGORICAL_PALETTE[idx]);
    }
    const fallback = CATEGORICAL_PALETTE[11]; // fuchsia 兜底
    return (name) => map.get((name || '未分类').trim()) ?? fallback;
  }, [sessionList]);
}

// 兼容性单参数函数（没有 session scope 时使用，例如 DiagnosisPanel / 旧代码）
export function subjectColor(name) {
  const k = (name || '未分类').trim();
  let h = 5381;
  for (let i = 0; i < k.length; i++) h = (((h << 5) + h) ^ k.charCodeAt(i)) >>> 0;
  return CATEGORICAL_PALETTE[h % CATEGORICAL_PALETTE.length];
}

// ── Panel 内部 Error Boundary (避免单个面板崩溃拖垮全局) ──
class PanelErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, errMsg: '' };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, errMsg: error?.message || String(error) };
  }
  componentDidCatch(error) {
    logger.warn('[Panel ErrorBoundary]', error);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          padding: 12, borderRadius: 8,
          background: 'rgba(239,68,68,0.06)',
          border: '1px solid rgba(239,68,68,0.15)',
          fontSize: 11, color: '#dc2626',
        }}>
          <div style={{ fontWeight: 700, marginBottom: 2 }}>⚠ 该模块加载失败</div>
          <div style={{ color: '#991b1b', fontSize: 10 }}>
            {String(this.state.errMsg || '').slice(0, 200)}
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// ── 可折叠面板壳 ─────────────────────────────────────
function CollapsiblePanel({ title, icon, defaultOpen = false, children, _dataKey }) {
  const [open, setOpen] = useState(defaultOpen);
  const contentRef = useRef(null);
  const [measuredH, setMeasuredH] = useState(0);

  // 展开后自动测量内容高度，用精确像素代替 'auto' 兼容 Framer Motion v12
  // _dataKey 变化时也重新测量（时间维度切换导致内容变化但面板仍开着的情况）
  useEffect(() => {
    if (open && contentRef.current) {
      const t = requestAnimationFrame(() => {
        if (contentRef.current) {
          setMeasuredH(contentRef.current.scrollHeight);
        }
      });
      return () => cancelAnimationFrame(t);
    } else {
      setMeasuredH(0);
    }
  }, [open, _dataKey]);

  return (
    <div style={{
      borderRadius: 12,
      background: 'rgba(255,255,255,0.5)',
      border: '1px solid rgba(15,23,42,0.06)',
      overflow: 'hidden',
    }}>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        style={{
          width: '100%', padding: '10px 12px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          background: 'transparent', border: 'none', cursor: 'pointer',
          fontSize: 13, fontWeight: 600, color: '#334155',
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 14 }}>{icon}</span>
          {title}
        </span>
        <span style={{
          transition: 'transform 0.2s',
          transform: open ? 'rotate(90deg)' : 'rotate(0deg)',
          fontSize: 12, color: '#94a3b8',
        }}>›</span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="content"
            initial={{ height: 0, opacity: 0 }}
            animate={{
              height: measuredH > 0 ? measuredH : 'auto',
              opacity: 1,
            }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: 'easeOut' }}
            style={{ overflow: 'hidden' }}
          >
            <div ref={contentRef} style={{ padding: '0 12px 12px 12px' }}>
              <PanelErrorBoundary>
                {children}
              </PanelErrorBoundary>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── 1. 学科时间分配与学习循环（学|复|练堆叠 + 循环总览 + 自主占比）──
function SubjectAllocationPanel({ sessions }) {
  const { subjectData, cycleData } = useMemo(() => {
    const map = {};
    const cycleMins = { 1: 0, 2: 0, 3: 0 };
    let totalSelfMins = 0;
    let totalMins = 0;
    for (const s of sessions) {
      const name = s.subject || '未分类';
      const cat = Number(s.category);
      const mins = s.duration_minutes || 0;
      const self = isSelfForm(s.form);

      if (!map[name]) {
        map[name] = { total: 0, studyMins: 0, reviewMins: 0, practiceMins: 0, selfMins: 0 };
      }
      map[name].total += mins;
      if (cat === 1) map[name].studyMins += mins;
      else if (cat === 2) map[name].reviewMins += mins;
      else if (cat === 3) map[name].practiceMins += mins;
      if (self) {
        map[name].selfMins += mins;
        totalSelfMins += mins;
      }
      totalMins += mins;

      if (cycleMins[cat] !== undefined) cycleMins[cat] += mins;
    }
    const subjectList = Object.entries(map)
      .map(([name, d]) => ({
        name, ...d,
        studyPct: d.total > 0 ? Math.round(d.studyMins / d.total * 100) : 0,
        reviewPct: d.total > 0 ? Math.round(d.reviewMins / d.total * 100) : 0,
        practicePct: d.total > 0 ? Math.round(d.practiceMins / d.total * 100) : 0,
        selfPct: d.total > 0 ? Math.round(d.selfMins / d.total * 100) : 0,
      }))
      .sort((a, b) => b.total - a.total);
    const cycleTotal = cycleMins[1] + cycleMins[2] + cycleMins[3];
    const selfPct = totalMins > 0 ? Math.round(totalSelfMins / totalMins * 100) : 0;
    return { subjectData: subjectList, cycleData: { mins: cycleMins, total: cycleTotal, selfMins: totalSelfMins, selfPct } };
  }, [sessions]);

  if (subjectData.length === 0) return <div style={emptyStyle}>暂无学科数据</div>;

  const maxMins = subjectData[0].total;
  const STU = CATEGORY_COLORS[1];
  const REV = CATEGORY_COLORS[2];
  const PRAC = CATEGORY_COLORS[3];

  // 环形图
  const radius = 36;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;
  const segments = [1, 2, 3].map(c => {
    const pct = cycleData.total > 0 ? cycleData.mins[c] / cycleData.total : 0;
    const seg = { c, pct, color: CATEGORY_COLORS[c], dashArray: `${pct * circumference} ${circumference}`, dashOffset: -offset * circumference };
    offset += pct;
    return seg;
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* 循环总览 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '4px 0' }}>
        <svg width="80" height="80" viewBox="0 0 80 80">
          <circle cx="40" cy="40" r={radius} fill="none" stroke="#f1f5f9" strokeWidth="8" />
          {segments.map((s, i) => (
            <circle key={i} cx="40" cy="40" r={radius} fill="none"
              stroke={s.color} strokeWidth="8"
              strokeDasharray={s.dashArray}
              strokeDashoffset={s.dashOffset}
              transform="rotate(-90 40 40)" strokeLinecap="butt" />
          ))}
          <text x="40" y="38" textAnchor="middle" fontSize="12" fontWeight="700" fill="#0f172a">
            {fmtMins(cycleData.total)}
          </text>
          <text x="40" y="48" textAnchor="middle" fontSize="8" fill="#94a3b8">总计</text>
        </svg>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1 }}>
          {[1, 2, 3].map(c => {
            const pct = cycleData.total > 0 ? Math.round(cycleData.mins[c] / cycleData.total * 100) : 0;
            return (
              <div key={c} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: CATEGORY_COLORS[c], flexShrink: 0 }} />
                <span style={{ color: '#475569', fontWeight: 500 }}>{CATEGORY_NAMES[c]}</span>
                <span style={{ color: '#94a3b8', fontSize: 10 }}>{fmtMins(cycleData.mins[c])}</span>
                <span style={{ fontWeight: 700, color: '#0f172a' }}>{pct}%</span>
              </div>
            );
          })}
          {/* 自主占比 — 文本展示，非第四种颜色 */}
          <div style={{ borderTop: '1px solid #f1f5f9', marginTop: 2, paddingTop: 4, display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
            <span style={{ width: 8, height: 8, flexShrink: 0 }} />
            <span style={{ color: '#475569', fontWeight: 500 }}>自主</span>
            <span style={{ color: '#94a3b8', fontSize: 10 }}>{fmtMins(cycleData.selfMins)}</span>
            <span style={{ fontWeight: 700, color: '#0f172a' }}>{cycleData.selfPct}%</span>
          </div>
        </div>
      </div>

      {/* 学科逐行分配 */}
      {subjectData.map((d, i) => (
        <div key={i} style={{ padding: '4px 8px', borderRadius: 8, border: '1px solid transparent' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, marginBottom: 4 }}>
            <span style={{
              width: 70, fontWeight: 600, color: '#475569',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flexShrink: 0,
            }}>
              {d.name}
            </span>
            <div style={{
              flex: 1, height: 14, borderRadius: 4,
              background: '#f1f5f9', overflow: 'hidden', display: 'flex',
            }}>
              <div style={{ width: `${(d.studyMins / maxMins) * 100}%`, background: STU }} />
              <div style={{ width: `${(d.reviewMins / maxMins) * 100}%`, background: REV }} />
              <div style={{ width: `${(d.practiceMins / maxMins) * 100}%`, background: PRAC }} />
            </div>
            <span style={{ width: 48, fontSize: 10, fontWeight: 700, color: '#0f172a', flexShrink: 0, textAlign: 'right' }}>
              {fmtMins(d.total)}
            </span>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', fontSize: 9, paddingLeft: 78 }}>
            <span style={{ color: STU }}>学{d.studyPct}%</span>
            <span style={{ color: REV }}>复{d.reviewPct}%</span>
            <span style={{ color: PRAC }}>练{d.practicePct}%</span>
            <span style={{ color: '#94a3b8' }}>自主{d.selfPct}%</span>
          </div>
        </div>
      ))}

      {/* Legend */}
      <div style={{ display: 'flex', gap: 10, marginTop: 2, fontSize: 9, color: '#94a3b8', flexWrap: 'wrap' }}>
        <span><span style={{ color: STU }}>■</span> 学习</span>
        <span><span style={{ color: REV }}>■</span> 复习</span>
        <span><span style={{ color: PRAC }}>■</span> 练习</span>
      </div>
    </div>
  );
}

// ── 2. 学习-复习-练习循环 ────────────────────────────
function CategoryCyclePanel({ sessions }) {
  const data = useMemo(() => {
    const mins = { 1: 0, 2: 0, 3: 0 };
    for (const s of sessions) {
      const c = Number(s.category);
      if (mins[c] !== undefined) mins[c] += s.duration_minutes || 0;
    }
    const total = mins[1] + mins[2] + mins[3];
    return { mins, total };
  }, [sessions]);

  if (data.total === 0) return <div style={emptyStyle}>暂无分类数据</div>;

  const radius = 40;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;
  const segments = [1, 2, 3].map(c => {
    const pct = data.total > 0 ? data.mins[c] / data.total : 0;
    const seg = { c, pct, color: CATEGORY_COLORS[c], dashArray: `${pct * circumference} ${circumference}`, dashOffset: -offset * circumference };
    offset += pct;
    return seg;
  });

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '4px 0' }}>
      <svg width="100" height="100" viewBox="0 0 100 100">
        <circle cx="50" cy="50" r={radius} fill="none" stroke="#f1f5f9" strokeWidth="10" />
        {segments.map((s, i) => (
          <circle key={i} cx="50" cy="50" r={radius} fill="none"
            stroke={s.color} strokeWidth="10"
            strokeDasharray={s.dashArray}
            strokeDashoffset={s.dashOffset}
            transform="rotate(-90 50 50)" strokeLinecap="butt" />
        ))}
        <text x="50" y="48" textAnchor="middle" fontSize="14" fontWeight="700" fill="#0f172a">
          {fmtMins(data.total)}
        </text>
        <text x="50" y="60" textAnchor="middle" fontSize="9" fill="#94a3b8">总计</text>
      </svg>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1 }}>
        {[1, 2, 3].map(c => {
          const pct = data.total > 0 ? Math.round(data.mins[c] / data.total * 100) : 0;
          return (
            <div key={c} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: CATEGORY_COLORS[c], flexShrink: 0 }} />
              <span style={{ color: '#475569', fontWeight: 500 }}>{CATEGORY_NAMES[c]}</span>
              <span style={{ color: '#94a3b8', fontSize: 10 }}>{fmtMins(data.mins[c])}</span>
              <span style={{ marginLeft: 'auto', fontWeight: 700, color: CATEGORY_COLORS[c] }}>{pct}%</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── 3. 自主学习趋势 ──────────────────────────────────
function SelfLearningTrendPanel({ sessions, weeks = [] }) {
  const data = useMemo(() => {
    if (weeks.length === 0) return [];
    return weeks.map(weekStart => {
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekEnd.getDate() + 6);
      const weekSessions = sessions.filter(s => {
        const d = s.date?.split('T')[0];
        if (!d) return false;
        const dt = new Date(d + 'T00:00:00');
        return dt >= weekStart && dt <= weekEnd;
      });
      const total = weekSessions.reduce((a, s) => a + (s.duration_minutes || 0), 0);
      const self = weekSessions.filter(s => isSelfForm(s.form)).reduce((a, s) => a + (s.duration_minutes || 0), 0);
      return {
        label: `${weekStart.getMonth() + 1}/${weekStart.getDate()}`,
        pct: total > 0 ? Math.round(self / total * 100) : 0,
      };
    });
  }, [sessions, weeks]);

  if (data.length === 0) return <div style={emptyStyle}>暂无趋势数据</div>;

  const w = 480, h = 100, pad = 12;
  const points = data.map((d, i) => ({
    x: pad + (i / Math.max(data.length - 1, 1)) * (w - 2 * pad),
    y: h - pad - (d.pct / 100) * (h - 2 * pad),
  }));
  const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ');
  const areaD = `${pathD} L${points[points.length - 1].x},${h - pad} L${points[0].x},${h - pad} Z`;

  return (
    <div>
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ width: '100%' }}>
        {/* 30% reference line */}
        <line x1={pad} y1={h - pad - 0.3 * (h - 2 * pad)} x2={w - pad} y2={h - pad - 0.3 * (h - 2 * pad)}
          stroke="#fbbf24" strokeWidth="1" strokeDasharray="3 3" opacity="0.5" />
        <path d={areaD} fill={SELF_COLOR} opacity="0.1" />
        <path d={pathD} fill="none" stroke={SELF_COLOR} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        {points.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r="3.5" fill={SELF_COLOR} />
        ))}
        {data.map((d, i) => (
          <text key={i} x={points[i].x} y={h - 2} textAnchor="middle" fontSize="10" fill="#94a3b8">
            {d.label}
          </text>
        ))}
      </svg>
      <div style={{ display: 'flex', gap: 12, marginTop: 4, fontSize: 9, color: '#94a3b8' }}>
        <span><span style={{ color: SELF_COLOR }}>●</span> 自主占比</span>
        <span><span style={{ color: '#fbbf24' }}>┄</span> 30% 警戒线</span>
      </div>
    </div>
  );
}

// ── 4. 练习质量分析（per-subject cards + modal） ─────
function PracticeQualityPanel({ sessions }) {
  const [selectedSubject, setSelectedSubject] = useState(null);

  const subjectCards = useMemo(() => {
    const map = {};
    for (const s of sessions) {
      if (Number(s.category) !== 3) continue;
      const name = s.subject || '未分类';
      if (!map[name]) map[name] = { name, allSessions: [], objCount: 0, subjCount: 0 };

      const hasObj = (s.grade_label != null && s.grade_label !== '') || (s.score != null && s.score !== '');
      const hasSubj = s.self_rating != null;

      if (hasObj) map[name].objCount++;
      if (hasSubj) map[name].subjCount++;
      map[name].allSessions.push(s);
    }

    return Object.values(map).map(c => {
      const sorted = [...c.allSessions].sort((a, b) =>
        String(b.date || '').localeCompare(String(a.date || ''))
      );
      const last5Obj = sorted
        .filter(s => (s.grade_label != null && s.grade_label !== '') || (s.score != null && s.score !== ''))
        .slice(0, 5);
      return { ...c, allSessions: sorted, last5Obj };
    }).sort((a, b) => b.allSessions.length - a.allSessions.length);
  }, [sessions]);

  if (subjectCards.length === 0) return <div style={emptyStyle}>暂无练习记录</div>;

  const selectedCard = subjectCards.find(c => c.name === selectedSubject);

  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 10 }}>
        {subjectCards.map(card => (
          <motion.div
            key={card.name}
            onClick={() => setSelectedSubject(card.name)}
            whileHover={{ y: -2 }}
            transition={{ duration: 0.15 }}
            style={{
              padding: '16px 18px',
              borderRadius: 12,
              background: '#fff',
              boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
              border: '1px solid rgba(15,23,42,0.06)',
              cursor: 'pointer',
            }}
          >
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <span style={{ fontSize: 14, fontWeight: 700, color: '#0f172a' }}>{card.name}</span>
              <span style={{ fontSize: 16, color: '#94a3b8', lineHeight: 1 }}>›</span>
            </div>

            {/* Stats — three equal columns with dividers */}
            <div style={{
              display: 'grid', gridTemplateColumns: '1fr 1fr 1fr',
              marginBottom: 12,
            }}>
              {[
                { val: card.allSessions.length, label: '总练习' },
                { val: card.objCount, label: '客观评价' },
                { val: card.subjCount, label: '主观评价' },
              ].map((stat, i) => (
                <div key={i} style={{
                  display: 'flex', flexDirection: 'column', gap: 3,
                  padding: '0 8px',
                  borderLeft: i === 0 ? 'none' : '1px solid #f1f5f9',
                }}>
                  <span style={{
                    fontSize: 20, fontWeight: 800, color: '#0f172a',
                    lineHeight: 1, fontVariantNumeric: 'tabular-nums',
                  }}>
                    {stat.val}
                  </span>
                  <span style={{ fontSize: 10, color: '#94a3b8' }}>{stat.label}</span>
                </div>
              ))}
            </div>

            {/* Last 5 objective evaluations */}
            {card.last5Obj.length > 0 ? (
              <div style={{
                display: 'flex', flexDirection: 'column', gap: 6,
                paddingTop: 10, borderTop: '1px solid #f1f5f9',
              }}>
                <div style={{ fontSize: 10, color: '#94a3b8', marginBottom: 2 }}>近 5 次客观评价</div>
                {card.last5Obj.map((s, i) => {
                  const grade = s.grade_label || (s.score != null ? scoreToGrade(Number(s.score)) : '—');
                  const scoreVal = s.score != null && s.score !== '' ? Number(s.score) : null;
                  const selfLabel = s.self_rating != null ? (SELF_RATING_LABELS[Number(s.self_rating)] || '—') : '—';
                  return (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11 }}>
                      <span style={{
                        fontWeight: 800, color: '#0f172a',
                        width: 24, flexShrink: 0,
                        fontVariantNumeric: 'tabular-nums',
                      }}>{grade}</span>
                      {scoreVal !== null && (
                        <span style={{
                          color: '#94a3b8', width: 28, flexShrink: 0, fontSize: 10,
                          fontVariantNumeric: 'tabular-nums',
                        }}>{scoreVal}</span>
                      )}
                      <span style={{
                        color: '#94a3b8', fontSize: 10, marginLeft: 'auto',
                        textAlign: 'right',
                      }}>{selfLabel}</span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div style={{
                fontSize: 11, color: '#94a3b8',
                paddingTop: 10, borderTop: '1px solid #f1f5f9',
              }}>暂无客观评价</div>
            )}
          </motion.div>
        ))}
      </div>

      <AnimatePresence>
        {selectedCard && (
          <SubjectPracticeModal
            subject={selectedCard.name}
            sessions={selectedCard.allSessions}
            onClose={() => setSelectedSubject(null)}
          />
        )}
      </AnimatePresence>
    </>
  );
}

// ── 4b. 学科练习详情 Modal ──────────────────────────
function SubjectPracticeModal({ subject, sessions, onClose }) {
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, []);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(15,23,42,0.4)', backdropFilter: 'blur(4px)',
        zIndex: 1000,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '24px 16px',
      }}
    >
      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 20, scale: 0.97 }}
        transition={{ type: 'spring', stiffness: 300, damping: 30 }}
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '92vw', maxWidth: 580, maxHeight: '85vh',
          background: '#fff', borderRadius: 16,
          boxShadow: '0 24px 80px rgba(0,0,0,0.15)',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div style={{
          padding: '16px 20px', borderBottom: '1px solid #f1f5f9',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          flexShrink: 0,
        }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#0f172a' }}>{subject}</div>
            <div style={{ fontSize: 11, color: '#94a3b8' }}>{sessions.length} 条练习记录</div>
          </div>
          <button
            onClick={onClose}
            style={{
              width: 32, height: 32, borderRadius: 8,
              background: '#f8fafc', border: 'none', cursor: 'pointer',
              fontSize: 14, color: '#0f172a',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >✕</button>
        </div>

        {/* Content */}
        <div style={{ overflowY: 'auto', padding: '4px 20px 20px', flex: 1 }}>
          {sessions.map((s, i) => {
            const grade = s.grade_label || (s.score != null ? scoreToGrade(Number(s.score)) : null);
            const scoreVal = s.score != null && s.score !== '' ? Number(s.score) : null;
            const selfLabel = s.self_rating != null ? (SELF_RATING_LABELS[Number(s.self_rating)] || null) : null;
            const dateStr = s.date ? String(s.date).slice(5) : '—';
            const chapterName = s.chapter?.name || null;
            const unitName = s.unit?.name || null;

            return (
              <div key={i} style={{ padding: '12px 0', borderBottom: '1px solid #f1f5f9' }}>
                {/* Date + form + duration */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <span style={{
                    fontSize: 11, fontWeight: 600, color: '#0f172a',
                    background: '#f1f5f9', padding: '2px 6px', borderRadius: 4, flexShrink: 0,
                    fontVariantNumeric: 'tabular-nums',
                  }}>{dateStr}</span>
                  <span style={{ fontSize: 12, color: '#0f172a', fontWeight: 500, flex: 1 }}>
                    {s.form || '—'}
                  </span>
                  <span style={{
                    fontSize: 11, color: '#94a3b8', flexShrink: 0,
                    fontVariantNumeric: 'tabular-nums',
                  }}>
                    {fmtMins(s.duration_minutes || 0)}
                  </span>
                </div>

                {/* Chapter / unit */}
                {(chapterName || unitName) && (
                  <div style={{ display: 'flex', gap: 8, marginBottom: 6, fontSize: 10, color: '#94a3b8' }}>
                    {chapterName && <span>章节: {chapterName}</span>}
                    {unitName && <span>小节: {unitName}</span>}
                  </div>
                )}

                {/* Evaluation badges */}
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {grade && (
                    <span style={{
                      fontSize: 11, fontWeight: 700, color: '#0f172a',
                      background: '#f1f5f9', padding: '2px 8px', borderRadius: 4,
                      fontVariantNumeric: 'tabular-nums',
                    }}>
                      客观 {grade}{scoreVal !== null ? ` ${scoreVal}` : ''}
                    </span>
                  )}
                  {selfLabel && (
                    <span style={{
                      fontSize: 11, color: '#0f172a',
                      background: '#fff', border: '1px solid #e2e8f0',
                      padding: '2px 8px', borderRadius: 4,
                    }}>
                      主观 {selfLabel}
                    </span>
                  )}
                  {!grade && !selfLabel && (
                    <span style={{ fontSize: 10, color: '#94a3b8' }}>无评价</span>
                  )}
                </div>

                {/* Notes */}
                {s.notes && (
                  <div style={{
                    fontSize: 11, color: '#94a3b8', marginTop: 8,
                    lineHeight: 1.5, padding: '6px 8px',
                    background: '#f8fafc', borderRadius: 6,
                  }}>
                    {s.notes}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </motion.div>
    </motion.div>
  );
}

// ── 5. 反馈密度时间线 ────────────────────────────────
function FeedbackDensityPanel({ sessions }) {
  const data = useMemo(() => {
    const byDate = {};
    for (const s of sessions) {
      const d = s.date?.split('T')[0];
      if (!d) continue;
      const hasFeedback = (s.score != null && s.score !== '') || s.self_rating != null;
      if (!byDate[d]) byDate[d] = { total: 0, feedback: 0, sessions: [] };
      byDate[d].total++;
      if (hasFeedback) byDate[d].feedback++;
      byDate[d].sessions.push(s);
    }
    return Object.entries(byDate)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .slice(-21); // last 21 active days
  }, [sessions]);

  if (data.length === 0) return <div style={emptyStyle}>暂无反馈数据</div>;

  const maxFeedback = Math.max(...data.map(([, d]) => d.feedback), 1);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      {data.map(([date, d]) => {
        const rate = d.total > 0 ? d.feedback / d.total : 0;
        return (
          <div key={date} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10 }}>
            <span style={{ width: 42, color: '#94a3b8', flexShrink: 0 }}>
              {date.slice(5)}
            </span>
            <div style={{ flex: 1, display: 'flex', gap: 1, height: 12, alignItems: 'center' }}>
              {Array.from({ length: d.total }).map((_, i) => (
                <div key={i} style={{
                  width: 6, height: 6, borderRadius: 2,
                  background: i < d.feedback ? SELF_COLOR : '#e2e8f0', // SELF_COLOR = 天蓝，分类色空间不撞
                }} />
              ))}
            </div>
            <span style={{ width: 28, textAlign: 'right', color: SELF_COLOR, fontWeight: 600, flexShrink: 0 }}>
              {Math.round(rate * 100)}%
            </span>
          </div>
        );
      })}
      <div style={{ marginTop: 4, fontSize: 9, color: '#94a3b8' }}>
        <span><span style={{ color: SELF_COLOR }}>■</span> 有反馈</span>
        {'  '}
        <span><span style={{ color: '#e2e8f0' }}>■</span> 无反馈</span>
      </div>
    </div>
  );
}

// ── 6. 教育诊断结论 ──────────────────────────────────
function generateDiagnosis(sessions) {
  const safe = sessions.filter(s => s && s.date);
  if (safe.length === 0) return [];

  const totalMins = safe.reduce((a, s) => a + (s.duration_minutes || 0), 0);
  const dates = new Set(safe.map(s => s.date.split('T')[0]));
  const activeDays = dates.size;
  const dailyAvg = activeDays > 0 ? totalMins / activeDays : 0;

  // Category ratio
  const catMins = { 1: 0, 2: 0, 3: 0 };
  for (const s of safe) {
    const c = Number(s.category);
    if (catMins[c] !== undefined) catMins[c] += s.duration_minutes || 0;
  }
  const reviewPct = totalMins > 0 ? catMins[2] / totalMins : 0;

  // Self ratio
  const selfMins = safe.filter(s => isSelfForm(s.form)).reduce((a, s) => a + (s.duration_minutes || 0), 0);
  const selfPct = totalMins > 0 ? selfMins / totalMins : 0;

  // Subject concentration
  const subjMap = {};
  for (const s of safe) {
    const name = s.subject || '未分类';
    subjMap[name] = (subjMap[name] || 0) + (s.duration_minutes || 0);
  }
  const subjSorted = Object.entries(subjMap).sort((a, b) => b[1] - a[1]);
  const topConcentration = totalMins > 0 ? (subjSorted[0]?.[1] || 0) / totalMins : 0;

  // Subject scores
  const subjScores = {};
  for (const s of safe) {
    if (Number(s.eval_type) !== 2 || s.score == null || s.score === '') continue;
    const name = s.subject || '未分类';
    if (!subjScores[name]) subjScores[name] = [];
    subjScores[name].push(Number(s.score));
  }

  const diagnoses = [];

  // Rule 1: Low self-direction — < 20% 直接升级成 alert（品牌红）
  if (selfPct < 0.2 && totalMins > 0) {
    diagnoses.push({
      level: 'alert', icon: '◐',
      title: '自主性严重不足',
      detail: `自主学习仅占 ${Math.round(selfPct * 100)}%，几乎所有学习由外部（老师/辅导班）安排，缺乏自我加工过程`,
      suggestion: '从"安排好任务后立刻去做"开始，逐步过渡到"自己列出当日任务清单"，建立规划肌肉',
    });
  } else if (selfPct < 0.3 && totalMins > 0) {
    diagnoses.push({
      level: 'warn', icon: '◐',
      title: '自主性不足',
      detail: `自主学习仅占 ${Math.round(selfPct * 100)}%，高度依赖外部驱动（老师/辅导班安排）`,
      suggestion: '逐步引导自主复盘、自主寻找知识缺口，从"老师叫做什么就做什么"过渡到"知道自己该学什么"',
    });
  }

  // Rule 2: Review cycle broken
  if (reviewPct < 0.15 && totalMins > 0) {
    diagnoses.push({
      level: 'warn', icon: '⟳',
      title: '学习-复习-练习循环断裂',
      detail: `复习仅占 ${Math.round(reviewPct * 100)}%，学习过程只有"上课+做作业"，缺少再次加工与提取`,
      suggestion: '建立规律复习节奏，避免考前才第一次系统复习。每次新学后 24h 内安排一次简短回顾',
    });
  }

  // Rule 3: Severe subject imbalance — >70% 升级 alert（品牌红），60-70% risk 橙
  if (topConcentration > 0.6 && subjSorted.length > 1) {
    if (topConcentration > 0.7) {
      diagnoses.push({
        level: 'alert', icon: '◎',
        title: '时间分配极度失衡',
        detail: `${subjSorted[0][0]} 占总时长 ${Math.round(topConcentration * 100)}%，其余科目实际处于停滞状态`,
        suggestion: '立即干预时间分配，哪怕每天只给第二重要科目 20 分钟，也比完全不碰强',
      });
    } else {
      diagnoses.push({
        level: 'risk', icon: '◎',
        title: '时间分配明显失衡',
        detail: `${subjSorted[0][0]} 占总时长 ${Math.round(topConcentration * 100)}%，其他科目投入不足`,
        suggestion: '调整时间分配，向薄弱科目倾斜。时间分配本身就是教育决策',
      });
    }
  }

  // Rule 4: Reverse inference — teaching environment
  const lowScoreSubjects = Object.entries(subjScores)
    .filter(([, scores]) => scores.length >= 3 && scores.reduce((a, b) => a + b, 0) / scores.length < 70)
    .map(([name, scores]) => ({
      name,
      avg: Math.round(scores.reduce((a, b) => a + b, 0) / scores.length),
    }));

  if (lowScoreSubjects.length > 0) {
    const hasGoodHabits = dailyAvg >= 90 && reviewPct >= 0.15 && selfPct >= 0.3;
    if (hasGoodHabits) {
      for (const sub of lowScoreSubjects) {
        diagnoses.push({
          level: 'alert', icon: '⚠',
          title: `${sub.name}：学习行为正常但成绩偏低`,
          detail: `该生日均 ${Math.round(dailyAvg)} 分钟、复习占比 ${Math.round(reviewPct * 100)}%、自主占比 ${Math.round(selfPct * 100)}%，行为无明显缺陷，但 ${sub.name} 均分仅 ${sub.avg} 分`,
          suggestion: '问题可能不在学生。建议检查：课堂教学完整度 / 教师反馈及时性 / 课程难度与基础匹配 / 学校支持资源',
        });
      }
    }
  }

  // Rule 5: Insufficient total time
  if (dailyAvg > 0 && dailyAvg < 60) {
    diagnoses.push({
      level: 'alert', icon: '⏱',
      title: '有效学习时间不足',
      detail: `日均仅 ${Math.round(dailyAvg)} 分钟，再好的学习方法也无法弥补输入不足`,
      suggestion: '优先解决"学不够"的问题，而非学习方法。检查是时间管理问题还是学习回避',
    });
  }

  // Rule 6: Low objective feedback density on practice
  //  - For all practice sessions (category=3), how many have eval_type=2 and a score?
  const totalPractice = safe.filter(s => Number(s.category) === 3);
  if (totalPractice.length >= 4) {
    const withFeedback = totalPractice.filter(s =>
      Number(s.eval_type) === 2 && s.score != null && s.score !== ''
    ).length;
    const feedbackPct = totalPractice.length > 0
      ? withFeedback / totalPractice.length
      : 0;
    if (feedbackPct < 0.2) {
      diagnoses.push({
        level: 'alert', icon: '◈',
        title: '练习反馈密度严重不足',
        detail: `${totalPractice.length} 次练习中仅 ${withFeedback} 次有客观评分（${Math.round(feedbackPct * 100)}%），` +
          `缺少"做得对不对"的即时反馈，大量作业训练价值被浪费`,
        suggestion: '引导学生记录每次练习的客观得分或主观自评。反馈越及时，调整成本越低',
      });
    } else if (feedbackPct < 0.4) {
      diagnoses.push({
        level: 'risk', icon: '◈',
        title: '练习反馈密度偏低',
        detail: `${totalPractice.length} 次练习中 ${withFeedback} 次有客观评分（${Math.round(feedbackPct * 100)}%），仍有较大提升空间`,
        suggestion: '对薄弱科目练习特别注意记录得分，形成可追踪的进步曲线',
      });
    } else if (feedbackPct < 0.5) {
      diagnoses.push({
        level: 'warn', icon: '◈',
        title: '练习反馈密度偏低',
        detail: `${totalPractice.length} 次练习中 ${withFeedback} 次有客观评分（${Math.round(feedbackPct * 100)}%），仍有提升空间`,
        suggestion: '对薄弱科目练习特别注意记录得分，形成可追踪的进步曲线',
      });
    }
  }

  // Positive note
  if (diagnoses.length === 0 && totalMins > 0) {
    diagnoses.push({
      level: 'good', icon: '✓',
      title: '学习行为健康',
      detail: `日均 ${Math.round(dailyAvg)} 分钟，复习占比 ${Math.round(reviewPct * 100)}%，自主占比 ${Math.round(selfPct * 100)}%，各维度指标合理`,
      suggestion: '保持当前节奏，持续关注趋势变化',
    });
  }

  return diagnoses;
}

function DiagnosisPanel({ sessions }) {
  const diagnoses = useMemo(() => generateDiagnosis(sessions), [sessions]);

  if (diagnoses.length === 0) return <div style={emptyStyle}>暂无诊断数据</div>;

  // Diagnosis 4 档 → SEM 全局统一调色板（新增 risk 橙，与 warn 黄/alert 红拉开）
  const levelConfig = {
    good:  { bg: SEM_BG.good,     border: 'rgba(22,163,74,0.22)',   color: SEM.good },
    warn:  { bg: SEM_BG.moderate, border: 'rgba(245,158,11,0.24)',  color: SEM.moderate },
    risk:  { bg: SEM_BG.risk,     border: 'rgba(234,88,12,0.24)',   color: SEM.risk },
    alert: { bg: SEM_BG.alert,    border: 'rgba(193,39,45,0.24)',  color: SEM.alert },
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {diagnoses.map((d, i) => {
        const cfg = levelConfig[d.level] || levelConfig.warn;
        return (
          <div key={i} style={{
            padding: '10px 12px', borderRadius: 8,
            background: cfg.bg, border: `1px solid ${cfg.border}`,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
              <span style={{ fontSize: 14, color: cfg.color }}>{d.icon}</span>
              <span style={{ fontSize: 12, fontWeight: 700, color: cfg.color }}>{d.title}</span>
            </div>
            <p style={{ fontSize: 11, color: '#475569', margin: '0 0 4px 0', lineHeight: 1.5 }}>
              {d.detail}
            </p>
            <p style={{ fontSize: 10, color: '#94a3b8', margin: 0, lineHeight: 1.5 }}>
              → {d.suggestion}
            </p>
          </div>
        );
      })}
    </div>
  );
}

// ── 作业顺序偏好热力图（一格一 tile，填满格子高度，gap 4px） ──
function SubjectOrderPreferenceChart({ sessions }) {
  const HOUR_BUCKETS = [14, 15, 16, 17, 18, 19, 20, 21, 22]; // 9 个 1h 桶（14:00-23:00）
  const DAY_LABELS = ['周一', '周二', '周三', '周四', '周五'];
  const WORKDAY_DOWS = [1, 2, 3, 4, 5];

  function inferStartHour(s) {
    if (s.time) {
      const h = Number((s.time || '').split(':')[0]);
      if (!Number.isNaN(h) && h >= 14 && h <= 23) return h;
    }
    const f = (s.form || '');
    if (f.includes('学校课堂')) return 14;
    if (f.includes('学校作业')) return 17;
    if (f.includes('校外线上')) return 19;
    if (f.includes('校外线下')) return 18;
    return 18;
  }

  // session 级学科色分配器（当前学生分析页面内 0 重色）
  const getSubjectColor = useSubjectColors(sessions);

  // 每个格子最多 1 个 session（用户确认：同一天同一时段不会有多个记录）
  // acc[rowIdx][hour] = { subject, mins } | null
  const { grid, legendItems, facts } = useMemo(() => {
    const acc = WORKDAY_DOWS.map(() =>
      HOUR_BUCKETS.reduce((o, h) => { o[h] = null; return o; }, {})
    );
    const subjStats = new Map(); // name -> {count, totalMins}

    for (const s of sessions) {
      const d = s.date?.split('T')[0];
      if (!d) continue;
      const dow = new Date(d + 'T00:00:00').getDay();
      if (!WORKDAY_DOWS.includes(dow)) continue;
      const rowIdx = dow - 1;
      const startH = Math.max(14, Math.min(22, inferStartHour(s)));
      const mins = Number(s.duration_minutes) || 0;
      if (mins <= 0) continue;
      const subj = s.subject || '未分类';
      // 一格一 tile：后到的覆盖先到的（极少见）
      acc[rowIdx][startH] = { subject: subj, mins };
      const cur = subjStats.get(subj) || { count: 0, totalMins: 0 };
      cur.count += 1;
      cur.totalMins += mins;
      subjStats.set(subj, cur);
    }

    // 右侧图例：按出现次数 desc 排序
    const legendItems = Array.from(subjStats.entries())
      .map(([name, st]) => ({
        name,
        count: st.count,
        avgMins: Math.round(st.totalMins / Math.max(st.count, 1)),
      }))
      .sort((a, b) => b.count - a.count);

    // 2-3 条纯客观事实（无主观评价，不编造术语）
    const factLines = [];
    // ① 频次最高的时段桶
    const hourCounts = {};
    for (let row of acc) {
      for (const h of HOUR_BUCKETS) {
        hourCounts[h] = (hourCounts[h] || 0) + (row[h] ? 1 : 0);
      }
    }
    const peak = HOUR_BUCKETS.map(h => ({ h, n: hourCounts[h] || 0 }))
      .sort((a, b) => b.n - a.n)[0];
    if (peak && peak.n > 0) {
      factLines.push(`频次最高时段：${peak.h}:00-${peak.h + 1}:00（${peak.n} 次）`);
    }
    // ② 平均单节时长最长的学科
    if (legendItems.length > 0) {
      const longest = [...legendItems].sort((a, b) => b.avgMins - a.avgMins)[0];
      if (longest.avgMins > 0) {
        factLines.push(`平均单节最长：${longest.name}（${longest.avgMins} 分钟/节）`);
      }
    }
    // ③ 安排最密的一天
    let busiestDay = null, busiestCount = 0;
    for (let rIdx = 0; rIdx < DAY_LABELS.length; rIdx++) {
      let c = 0;
      for (const h of HOUR_BUCKETS) if (acc[rIdx][h]) c++;
      if (c > busiestCount) { busiestCount = c; busiestDay = DAY_LABELS[rIdx]; }
    }
    if (busiestDay && busiestCount > 0) {
      factLines.push(`${busiestDay} 安排最密（${busiestCount} 节）`);
    }

    return { grid: acc, legendItems, facts: factLines.slice(0, 3) };
  }, [sessions]);

  const hasAny = grid.some(r => HOUR_BUCKETS.some(h => r[h] !== null));
  if (!hasAny) return <div style={emptyStyle}>暂无工作日作业时序数据</div>;

  return (
    <div>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        {/* 左侧：网格（一格一 tile，填满高度） */}
        <div style={{
          flex: 1,
          display: 'grid',
          gridTemplateColumns: '40px repeat(9, minmax(0,1fr))',
          gridAutoRows: '32px',
          rowGap: 4, columnGap: 4,
          minWidth: 0,
        }}>
          {/* 表头：时间刻度 */}
          <div />
          {HOUR_BUCKETS.map(h => (
            <div key={`th-${h}`} style={{
              fontSize: 9, color: '#94a3b8', textAlign: 'center',
              paddingBottom: 2, borderBottom: '1px solid #f1f5f9',
              display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
            }}>
              {h}
            </div>
          ))}
          {/* 每天一行 */}
          {DAY_LABELS.map((lbl, rIdx) => (
            <Fragment key={`row-${rIdx}`}>
              <div style={{
                fontSize: 10, fontWeight: 600, color: '#64748b',
                display: 'flex', alignItems: 'center',
                paddingRight: 4,
              }}>
                {lbl}
              </div>
              {HOUR_BUCKETS.map(h => {
                const cell = grid[rIdx][h];
                return (
                  <div key={`${rIdx}-${h}`} style={{
                    background: '#f8fafc',
                    borderRadius: 6,
                    display: 'flex',
                    alignItems: 'stretch',
                    padding: 0,
                    overflow: 'hidden',
                  }}>
                    {cell && (
                      <div
                        title={`${cell.subject} · ${cell.mins} 分钟 · ${h}:00 时段`}
                        style={{
                          flex: 1,
                          borderRadius: 6,
                          background: getSubjectColor(cell.subject),
                          boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.15)',
                          cursor: 'default',
                        }}
                      />
                    )}
                  </div>
                );
              })}
            </Fragment>
          ))}
        </div>

        {/* 右侧图例 */}
        <div style={{
          width: 160, flexShrink: 0,
          display: 'flex', flexDirection: 'column', gap: 10,
          padding: '8px 10px',
          borderRadius: 10,
          background: 'rgba(248,250,252,0.5)',
          border: '1px solid rgba(15,23,42,0.05)',
        }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: '#475569' }}>学科出现次数</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {legendItems.map(l => (
              <div key={l.name} style={{
                display: 'flex', alignItems: 'center', gap: 6,
                fontSize: 10,
              }}>
                <span style={{
                  width: 10, height: 10, borderRadius: 3, flexShrink: 0,
                  background: getSubjectColor(l.name),
                }} />
                <span style={{ color: '#0f172a', fontWeight: 600, minWidth: 0,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {l.name}
                </span>
                <span style={{
                  marginLeft: 'auto', fontWeight: 700,
                  color: '#64748b',
                }}>×{l.count}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 客观事实统计（只讲数据，不做评价） */}
      {facts.length > 0 && (
        <div style={{
          marginTop: 10, padding: '8px 10px', borderRadius: 8,
          background: 'rgba(79,70,229,0.05)',
          border: '1px solid rgba(79,70,229,0.10)',
          fontSize: 10, color: '#475569', lineHeight: 1.7,
        }}>
          {facts.map((f, i) => (
            <div key={i}>· {f}</div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── 学习趋势识别（文本输出，替代热力图） ──
function LearningPatternInsightPanel({ sessions, studentName = '学生' }) {
  const insight = useMemo(() => {
    const safe = sessions.filter(s => s && s.date);
    if (safe.length === 0) return null;

    // 解析 session 起始小时
    function parseHour(s) {
      if (s.time) {
        const h = Number(String(s.time).split(':')[0]);
        if (!Number.isNaN(h)) return h;
      }
      const f = s.form || '';
      if (f.includes('学校课堂')) return 14;
      if (f.includes('学校作业')) return 17;
      if (f.includes('校外线上')) return 19;
      if (f.includes('校外线下')) return 18;
      return 18;
    }

    // 仅分析工作日（周一至周五）
    const workdaySessions = safe.filter(s => {
      const d = s.date.split('T')[0];
      const dow = new Date(d + 'T00:00:00').getDay();
      return dow >= 1 && dow <= 5;
    });

    if (workdaySessions.length === 0) return null;

    // ① 时段频次 → 学生类型
    const hourCounts = {};
    for (const s of workdaySessions) {
      const h = parseHour(s);
      hourCounts[h] = (hourCounts[h] || 0) + 1;
    }
    const peakHour = Number(Object.entries(hourCounts).sort((a, b) => b[1] - a[1])[0][0]);

    let typeLabel = '';
    let peakRange = '';
    const fmtH = h => String(h).padStart(2, '0');
    if (peakHour >= 6 && peakHour < 10) {
      typeLabel = '晨读专家';
      peakRange = `${fmtH(peakHour)}:00-${fmtH(peakHour + 1)}:00`;
    } else if (peakHour >= 10 && peakHour < 22) {
      typeLabel = '常规学习者';
      peakRange = `${fmtH(peakHour)}:00-${fmtH(peakHour + 1)}:00`;
    } else {
      typeLabel = '夜猫子';
      peakRange = peakHour >= 22
        ? `${fmtH(peakHour)}:00 之后`
        : `深夜 ${fmtH(peakHour)}:00`;
    }

    // ② 作业顺序规律（按课程实际名称）
    const byDay = {};
    for (const s of workdaySessions) {
      const d = s.date.split('T')[0];
      if (!byDay[d]) byDay[d] = [];
      byDay[d].push(s);
    }

    const daySequences = [];
    for (const daySess of Object.values(byDay)) {
      const sorted = [...daySess].sort((a, b) =>
        String(a.time || '99:99').localeCompare(String(b.time || '99:99'))
      );
      const seen = [];
      for (const s of sorted) {
        const subj = s.subject || '未分类';
        if (!seen.includes(subj)) seen.push(subj);
      }
      if (seen.length >= 2) daySequences.push(seen);
    }

    let orderParts = [];
    let hasOrderData = false;
    if (daySequences.length >= 3) {
      hasOrderData = true;
      const maxLen = Math.max(...daySequences.map(s => s.length));
      for (let pos = 0; pos < Math.min(maxLen, 3); pos++) {
        const counts = {};
        let total = 0;
        for (const seq of daySequences) {
          if (seq[pos]) { counts[seq[pos]] = (counts[seq[pos]] || 0) + 1; total++; }
        }
        const sortedSubj = Object.entries(counts).sort((a, b) => b[1] - a[1]);
        if (sortedSubj.length > 0 && total > 0 && sortedSubj[0][1] / total >= 0.5) {
          orderParts.push(sortedSubj[0][0]);
        }
      }
      if (orderParts.length === 0) hasOrderData = false;
    }

    return { typeLabel, peakRange, orderParts, hasOrderData };
  }, [sessions]);

  if (!insight) return <div style={emptyStyle}>暂无学习行为数据</div>;

  const big = { fontSize: 16, fontWeight: 800, color: '#0f172a' };
  const mid = { fontSize: 13, fontWeight: 700, color: '#0f172a' };
  const sm = { fontSize: 11, color: '#64748b' };

  return (
    <div style={{ padding: '4px 2px', lineHeight: 2 }}>
      <span style={sm}>{studentName}属于</span>{' '}
      <span style={big}>{insight.typeLabel}</span>
      <span style={sm}>，高频时段</span>{' '}
      <span style={mid}>{insight.peakRange}</span>
      <span style={sm}>；</span>
      {insight.hasOrderData && insight.orderParts.length > 0 ? (
        <>
          <span style={sm}>通常先做</span>{' '}
          <span style={mid}>{insight.orderParts[0]}</span>
          {insight.orderParts.length >= 2 && (
            <>
              <span style={sm}>，再做</span>{' '}
              <span style={mid}>{insight.orderParts.slice(1).join('、')}</span>
            </>
          )}
        </>
      ) : (
        <span style={{ fontSize: 11, color: '#94a3b8' }}>作业顺序样本不足，暂无规律</span>
      )}
      <span style={sm}>。</span>
    </div>
  );
}

const emptyStyle = {
  fontSize: 11, color: '#94a3b8', textAlign: 'center', padding: '12px 0',
};

// ── 主面板容器 ───────────────────────────────────────
export default function DeepDivePanels({ sessions = [], weeks = [], studentName = '学生' }) {
  return (
    <div>
      <div style={{
        fontSize: 12, fontWeight: 700, color: '#475569', marginBottom: 8,
        display: 'flex', alignItems: 'center', gap: 6,
      }}>
        <span style={{ width: 3, height: 14, background: '#4F46E5', borderRadius: 2, display: 'inline-block' }} />
        深度分析
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <CollapsiblePanel title="学科时间分配详情" icon="◎" defaultOpen _dataKey={`${sessions.length}-${weeks.length}`}>
          <SubjectAllocationPanel sessions={sessions} />
        </CollapsiblePanel>
        <CollapsiblePanel title="学习趋势识别" icon="◎" defaultOpen _dataKey={`${sessions.length}-${weeks.length}`}>
          <LearningPatternInsightPanel sessions={sessions} studentName={studentName} />
        </CollapsiblePanel>
        <CollapsiblePanel title="自主学习趋势" icon="◐" defaultOpen _dataKey={`${sessions.length}-${weeks.length}`}>
          <SelfLearningTrendPanel sessions={sessions} weeks={weeks} />
        </CollapsiblePanel>
        <CollapsiblePanel title="练习质量分析" icon="✎" defaultOpen _dataKey={`${sessions.length}-${weeks.length}`}>
          <PracticeQualityPanel sessions={sessions} />
        </CollapsiblePanel>
        <CollapsiblePanel title="教育诊断结论" icon="⚠" defaultOpen _dataKey={`${sessions.length}-${weeks.length}`}>
          <DiagnosisPanel sessions={sessions} />
        </CollapsiblePanel>
      </div>
    </div>
  );
}
