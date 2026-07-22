import { useState, useEffect, useMemo } from 'react';
import { isSelfForm } from '../components/SharedDashboard.jsx';
import {
  BarChart, Bar, LineChart, Line, ScatterChart, Scatter,
  XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, Cell,
  ComposedChart, Area
} from 'recharts';
import {
  TrendingDown, AlertTriangle, BookOpen, TrendingUp, Flame, CheckCircle,
  Target, Clock, Calendar, Award, ArrowRight, User
} from 'lucide-react';

function fmtMinutes(mins) {
  if (mins < 60) return `${mins}分钟`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h}小时${m}分钟` : `${h}小时`;
}

function scoreToLetter(score) {
  if (score >= 93) return 'A';
  if (score >= 90) return 'A-';
  if (score >= 87) return 'B+';
  if (score >= 83) return 'B';
  if (score >= 80) return 'B-';
  if (score >= 77) return 'C+';
  if (score >= 73) return 'C';
  if (score >= 70) return 'C-';
  if (score >= 67) return 'D+';
  if (score >= 60) return 'D';
  return 'F';
}

function AnimatedNumber({ value, duration = 1000, prefix = '', suffix = '' }) {
  const [displayValue, setDisplayValue] = useState(0);
  useEffect(() => {
    let startTime;
    const startValue = 0;
    const endValue = value;
    const animate = (timestamp) => {
      if (!startTime) startTime = timestamp;
      const progress = Math.min((timestamp - startTime) / duration, 1);
      const easeOut = 1 - Math.pow(1 - progress, 3);
      setDisplayValue(Math.round(startValue + (endValue - startValue) * easeOut));
      if (progress < 1) requestAnimationFrame(animate);
    };
    requestAnimationFrame(animate);
  }, [value, duration]);
  return <span>{prefix}{displayValue}{suffix}</span>;
}

function generateObservations(avgScore, selfRate, activeDays, subjectData, sessionTrend, recentMins, prevMins, subjectTimeData, sessions) {
  const observations = [];
  const weekdays = ['周一', '周二', '周三', '周四', '周五'];
  const weekendDays = ['周六', '周日'];
  const byDay = {};
  weekdays.forEach(day => { byDay[day] = 0; });
  weekendDays.forEach(day => { byDay[day] = 0; });
  for (const s of sessions) {
    const date = s.date?.split('T')[0];
    if (date) {
      const dayIndex = new Date(date).getDay();
      const dayName = dayIndex === 0 ? '周日' : ['周一', '周二', '周三', '周四', '周五', '周六'][dayIndex - 1];
      byDay[dayName] += s.duration_minutes || 0;
    }
  }
  const workdayMins = weekdays.reduce((sum, day) => sum + byDay[day], 0);
  const weekendMins = weekendDays.reduce((sum, day) => sum + byDay[day], 0);
  const workdayAvg = workdayMins > 0 ? Math.round(workdayMins / 5) : 0;
  const weekendAvg = weekendMins > 0 ? Math.round(weekendMins / 2) : 0;
  const gapPercent = workdayAvg > 0 ? Math.round(((workdayAvg - weekendAvg) / workdayAvg) * 100) : 0;
  
  const weekData = [];
  const today = new Date();
  for (let w = 3; w >= 0; w--) {
    let weekMins = 0;
    for (let d = 6; d >= 0; d--) {
      const date = new Date(today);
      date.setDate(date.getDate() - w * 7 - d);
      const dateStr = date.toISOString().split('T')[0];
      for (const s of sessions) {
        if (s.date?.startsWith(dateStr)) weekMins += s.duration_minutes || 0;
      }
    }
    weekData.push(weekMins);
  }
  const avgWeekMins = weekData.reduce((sum, m) => sum + m, 0) / weekData.length;
  const volatility = avgWeekMins > 0 ? Math.round((Math.sqrt(weekData.reduce((sum, m) => sum + Math.pow(m - avgWeekMins, 2), 0) / weekData.length) / avgWeekMins) * 100) : 0;
  
  if (gapPercent > 30 || volatility > 30) {
    observations.push({
      priority: 1,
      icon: <Clock className="w-5 h-5" />,
      title: '时间管理能力薄弱',
      detail: `Chart 1显示：周末学习时长比工作日低${gapPercent}%，4周波动±${volatility}%，稳定性不足`,
      severity: 'warning'
    });
  }
  
  if (subjectTimeData.length >= 2) {
    const totalMins = subjectTimeData.reduce((sum, d) => sum + d.total, 0);
    const topTwoPct = totalMins > 0 ? Math.round((subjectTimeData[0].total + subjectTimeData[1].total) / totalMins * 100) : 0;
    const lowInvestment = subjectTimeData.filter(d => totalMins > 0 && (d.total / totalMins * 100) < 10).map(d => d.name);
    if (topTwoPct > 50) {
      observations.push({
        priority: 2,
        icon: <Target className="w-5 h-5" />,
        title: '学科投入严重不均',
        detail: `Chart 2显示：${subjectTimeData[0].name}、${subjectTimeData[1].name}占用${topTwoPct}%总时长，${lowInvestment.join('、')}投入不足`,
        severity: 'warning'
      });
    }
  }
  
  return observations.sort((a, b) => a.priority - b.priority).slice(0, 5);
}

function generateActions(sessions) {
  const result = [];
  const totalMins = sessions.reduce((a, s) => a + (s.duration_minutes || 0), 0);
  let selfMins = 0;
  for (const s of sessions) {
    if (isSelfForm(s.form)) selfMins += s.duration_minutes || 0;
  }
  const selfRate = totalMins > 0 ? Math.round((selfMins / totalMins) * 100) : 0;
  
  if (selfRate < 40) {
    result.push({
      priority: 1,
      title: '培养自主学习习惯',
      description: `自主学习仅占${selfRate}%（${fmtMinutes(selfMins)}），校外辅导${fmtMinutes(totalMins - selfMins)}`,
      suggestion: `当前辅导占比${Math.round(((totalMins - selfMins) / totalMins) * 100)}% → 建议降至50%以下`,
      type: 'warning'
    });
  }
  
  return result.sort((a, b) => a.priority - b.priority);
}

function HeroInsight({ student, sessions }) {
  const stats = useMemo(() => {
    const totalMins = sessions.reduce((a, s) => a + (s.duration_minutes || 0), 0);
    let scoreSum = 0;
    let scoreCount = 0;
    let selfMins = 0;
    
    for (const s of sessions) {
      if (Number(s.eval_type) === 2 && s.score != null && s.score !== '') {
        scoreSum += Number(s.score);
        scoreCount++;
      }
      if (isSelfForm(s.form)) selfMins += s.duration_minutes || 0;
    }
    
    const avgScore = scoreCount > 0 ? Math.round(scoreSum / scoreCount) : 0;
    const activeDays = new Set(sessions.map(s => s.date?.split('T')[0])).size;
    const selfRate = totalMins > 0 ? Math.round((selfMins / totalMins) * 100) : 0;
    
    return {
      avgScore,
      avgLetter: scoreCount > 0 ? scoreToLetter(avgScore) : '-',
      selfRate,
      activeDays,
      totalMins,
      sessionCount: sessions.length
    };
  }, [sessions]);

  const getAvatarInitial = (name) => {
    if (!name) return '演';
    return name.charAt(0).toUpperCase();
  };

  return (
    <section className="ui-card ui-card--hero">
      <div className="insight-hero">
        <div className="insight-hero__header">
          <div className="insight-hero__identity">
            <div className="insight-hero__avatar">
              {getAvatarInitial(student.full_name || '演示学生')}
            </div>
            <div>
              <h1 className="insight-hero__name">{student.full_name || '演示学生'}</h1>
              <p className="insight-hero__meta">{student.school_name || '示例学校'} · 最近活跃</p>
            </div>
          </div>
        </div>
        <div className="insight-hero__metrics">
          <div className="insight-metric">
            <span className="insight-metric__label">平均分数</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span className="insight-metric__value">
                <AnimatedNumber value={stats.avgScore} />
              </span>
              {stats.avgLetter !== '-' && (
                <span className="insight-metric__letter">
                  {stats.avgLetter}
                </span>
              )}
            </div>
          </div>
          <div className={`insight-metric ${stats.selfRate === 0 ? 'insight-metric--warning' : ''}`}>
            <span className="insight-metric__label">自主学习率</span>
            <span className="insight-metric__value">
              <AnimatedNumber value={stats.selfRate} suffix="%" />
            </span>
          </div>
          <div className="insight-metric">
            <span className="insight-metric__label">活跃天数</span>
            <span className="insight-metric__value">
              <AnimatedNumber value={stats.activeDays} suffix="天" />
            </span>
          </div>
          <div className="insight-metric">
            <span className="insight-metric__label">累计时长</span>
            <span className="insight-metric__value">{fmtMinutes(stats.totalMins)}</span>
          </div>
        </div>
      </div>
    </section>
  );
}

function DiagnosticSection({ title, subtext, children }) {
  return (
    <section className="ui-card ui-card--chart">
      <div className="mckinsey-section">
        <h2 className="mckinsey-section__action-title">{title}</h2>
        {subtext && <p className="mckinsey-section__subtext">{subtext}</p>}
        <div className="mckinsey-section__chart">{children}</div>
        <p className="mckinsey-section__source">数据来源：学生近 4 周学习记录</p>
      </div>
    </section>
  );
}

function ContextPanel({ observations, actions }) {
  return (
    <aside className="mentor-intelligence__context">
      <div className="context-panel">
        <div className="context-panel__section">
          <h3 className="context-panel__title">关键发现</h3>
          <div className="context-panel__list">
            {observations.map((obs, i) => (
              <div key={i} className={`context-panel__item context-panel__item--${obs.severity}`}>
                <div className="context-panel__content">
                  <span className="context-panel__item-title">{obs.title}</span>
                  <span className="context-panel__detail">{obs.detail}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="context-panel__divider" />
        <div className="context-panel__section">
          <div className="context-panel__header">
            <h3 className="context-panel__title">行动建议</h3>
            <span className="context-panel__badge">{actions.length} 项</span>
          </div>
          <div className="context-panel__list">
            {actions.map((action, i) => (
              <div key={i} className="context-panel__action">
                <span className="context-panel__action-number">{i + 1}.</span>
                <div className="context-panel__action-content">
                  <span className="context-panel__action-title">{action.title}</span>
                  <span className="context-panel__action-description">{action.description}</span>
                  <div className="context-panel__action-suggestion">
                    <span className="context-panel__action-arrow">→</span>
                    <span>{action.suggestion}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </aside>
  );
}

function Chart1LearningDurationPattern({ sessions }) {
  const chartData = useMemo(() => {
    const weekdays = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
    const byDay = {};
    weekdays.forEach(day => {
      byDay[day] = { mins: 0, isWeekend: ['周六', '周日'].includes(day) };
    });
    
    for (const s of sessions) {
      const date = s.date?.split('T')[0];
      if (date) {
        const dayIndex = new Date(date).getDay();
        const dayName = weekdays[dayIndex === 0 ? 6 : dayIndex - 1];
        byDay[dayName].mins += s.duration_minutes || 0;
      }
    }
    
    const workdayDays = weekdays.slice(0, 5);
    const weekendDays = weekdays.slice(5);
    
    const workdayMins = workdayDays.reduce((sum, day) => sum + byDay[day].mins, 0);
    const weekendMins = weekendDays.reduce((sum, day) => sum + byDay[day].mins, 0);
    
    const workdayCount = workdayDays.filter(day => byDay[day].mins > 0).length;
    const weekendCount = weekendDays.filter(day => byDay[day].mins > 0).length;
    
    const workdayAvg = workdayCount > 0 ? Math.round(workdayMins / workdayCount) : 0;
    const weekendAvg = weekendCount > 0 ? Math.round(weekendMins / weekendCount) : 0;
    
    const weekData = [];
    const today = new Date();
    for (let w = 3; w >= 0; w--) {
      let weekMins = 0;
      for (let d = 6; d >= 0; d--) {
        const date = new Date(today);
        date.setDate(date.getDate() - w * 7 - d);
        const dateStr = date.toISOString().split('T')[0];
        for (const s of sessions) {
          if (s.date?.startsWith(dateStr)) {
            weekMins += s.duration_minutes || 0;
          }
        }
      }
      weekData.push(weekMins);
    }
    
    const avgWeekMins = weekData.reduce((sum, m) => sum + m, 0) / weekData.length;
    const variance = weekData.reduce((sum, m) => sum + Math.pow(m - avgWeekMins, 2), 0) / weekData.length;
    const stdDev = Math.sqrt(variance);
    const volatility = avgWeekMins > 0 ? Math.round((stdDev / avgWeekMins) * 100) : 0;
    
    const gradeAvg = 150;
    const gapPercent = workdayAvg > 0 ? Math.round(((workdayAvg - weekendAvg) / workdayAvg) * 100) : 0;
    
    return {
      workdayAvg,
      weekendAvg,
      volatility,
      gradeAvg,
      gapPercent,
      maxAvg: Math.max(workdayAvg, weekendAvg, gradeAvg)
    };
  }, [sessions]);

  return (
    <div className="mckinsey-chart">
      <div className="mckinsey-chart__body">
        <div className="mckinsey-bar-group">
          <div className="mckinsey-bar-row">
            <span className="mckinsey-bar-label">工作日平均</span>
            <div className="mckinsey-bar-track">
              <div 
                className="mckinsey-bar-fill" 
                style={{ width: `${chartData.workdayAvg / chartData.maxAvg * 100}%` }}
              >
                <span className="mckinsey-bar-value">{fmtMinutes(chartData.workdayAvg)}</span>
              </div>
              <div 
                className="mckinsey-bar-reference" 
                style={{ left: `${chartData.gradeAvg / chartData.maxAvg * 100}%` }}
              >
                <span className="mckinsey-bar-reference-label">年级平均</span>
              </div>
            </div>
          </div>
          <div className="mckinsey-bar-row">
            <span className="mckinsey-bar-label">周末平均</span>
            <div className="mckinsey-bar-track">
              <div 
                className="mckinsey-bar-fill mckinsey-bar-fill--secondary" 
                style={{ width: `${chartData.weekendAvg / chartData.maxAvg * 100}%` }}
              >
                <span className="mckinsey-bar-value">{fmtMinutes(chartData.weekendAvg)}</span>
              </div>
            </div>
          </div>
        </div>
        <div className="mckinsey-callout">
          <span className="mckinsey-callout__value" style={{ color: chartData.volatility > 30 ? '#B91C1C' : '#171717' }}>
            4周波动 ±{chartData.volatility}%
          </span>
          {chartData.volatility > 30 && (
            <span className="mckinsey-callout__label">稳定性严重不足</span>
          )}
        </div>
      </div>
    </div>
  );
}

function Chart2SubjectInvestmentStructure({ sessions }) {
  const chartData = useMemo(() => {
    const bySubj = {};
    for (const s of sessions) {
      const subj = s.subject || '未分类';
      bySubj[subj] = bySubj[subj] || { self: 0, other: 0, total: 0 };
      const mins = s.duration_minutes || 0;
      if (isSelfForm(s.form)) bySubj[subj].self += mins;
      else bySubj[subj].other += mins;
      bySubj[subj].total += mins;
    }
    
    const totalMins = Object.values(bySubj).reduce((sum, d) => sum + d.total, 0);
    
    const data = Object.entries(bySubj)
      .map(([name, data]) => ({
        name,
        self: data.self,
        other: data.other,
        total: data.total,
        pct: totalMins > 0 ? Math.round((data.total / totalMins) * 100) : 0,
        selfRate: data.total > 0 ? Math.round((data.self / data.total) * 100) : 0
      }))
      .sort((a, b) => b.total - a.total);
    
    return { data };
  }, [sessions]);

  const maxTotal = Math.max(...chartData.data.map(d => d.total), 1);

  return (
    <div className="mckinsey-chart">
      <div className="mckinsey-chart__body">
        <ResponsiveContainer width="100%" height={chartData.data.length * 50 + 20}>
          <BarChart data={chartData.data} layout="vertical" margin={{ top: 8, right: 120, left: 60, bottom: 8 }}>
            <XAxis type="number" domain={[0, 'dataMax']} tick={{ fontSize: 11, fill: '#8E8E93' }} axisLine={false} tickLine={false} grid={{ stroke: '#F2F2F7', strokeWidth: 1 }} />
            <YAxis type="category" dataKey="name" width={50} tick={{ fontSize: 13, fill: '#171717', fontWeight: 500 }} axisLine={false} tickLine={false} />
            <Tooltip />
            <Bar dataKey="other" fill="#E5E5EA" radius={[0, 0, 0, 0]} barSize={24} />
            <Bar dataKey="self" fill="#B91C1C" radius={[0, 6, 6, 0]} barSize={24} />
            {chartData.data.map((d, i) => (
              <g key={`labels-${i}`}>
                <text x={d.total + 10} y={i * 50 + 16} textAnchor="start" fontSize={11} fontWeight={600} fill="#171717">{fmtMinutes(d.total)}</text>
                <text x={d.total + 10} y={i * 50 + 32} textAnchor="start" fontSize={10} fill="#525252">{d.pct}% · 自主{d.selfRate}%</text>
              </g>
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function Chart3LearningEfficiencyMatrix({ sessions }) {
  const chartData = useMemo(() => {
    const bySubj = {};
    for (const s of sessions) {
      const subj = s.subject || '未分类';
      bySubj[subj] = bySubj[subj] || { mins: 0, scoreSum: 0, scoreCount: 0, evalMins: 0 };
      bySubj[subj].mins += s.duration_minutes || 0;
      if (Number(s.eval_type) === 2 && s.score != null && s.score !== '') {
        bySubj[subj].scoreSum += Number(s.score);
        bySubj[subj].scoreCount++;
      }
      if (s.category === 3) bySubj[subj].evalMins += s.duration_minutes || 0;
    }
    
    const data = Object.entries(bySubj)
      .map(([name, data]) => ({
        name,
        mins: data.mins,
        avgScore: data.scoreCount > 0 ? Math.round(data.scoreSum / data.scoreCount) : 0,
        evalPct: data.mins > 0 ? Math.round((data.evalMins / data.mins) * 100) : 0,
        size: Math.max(data.evalPct, 10)
      }))
      .filter(d => d.avgScore > 0);
    
    const avgMins = data.length > 0 ? data.reduce((sum, d) => sum + d.mins, 0) / data.length : 0;
    const avgScore = data.length > 0 ? data.reduce((sum, d) => sum + d.avgScore, 0) / data.length : 70;
    
    return { data, avgMins, avgScore, maxMins: Math.max(...data.map(d => d.mins), 1) };
  }, [sessions]);

  return (
    <div className="mckinsey-chart">
      <div className="mckinsey-chart__body">
        <ResponsiveContainer width="100%" height={280}>
          <ScatterChart margin={{ top: 32, right: 60, left: 70, bottom: 48 }}>
            <XAxis type="number" dataKey="mins" name="周投入时长" domain={[0, 'dataMax']} tick={{ fontSize: 11, fill: '#8E8E93' }} axisLine={false} tickLine={false} />
            <YAxis type="number" dataKey="avgScore" name="平均分数" domain={[0, 100]} tick={{ fontSize: 11, fill: '#8E8E93' }} axisLine={false} tickLine={false} />
            <Tooltip formatter={(value, name, props) => {
              const d = props.payload;
              return [`${d.name}`, `投入: ${fmtMinutes(d.mins)}`, `分数: ${d.avgScore}`, `客观评估: ${d.evalPct}%`];
            }} />
            <Line type="line" x1={chartData.avgMins} y1="0" x2={chartData.avgMins} y2="100" stroke="#E5E5EA" strokeWidth={1} strokeDasharray="4 4" />
            <Line type="line" x1="0" y1={chartData.avgScore} x2={chartData.maxMins} y2={chartData.avgScore} stroke="#E5E5EA" strokeWidth={1} strokeDasharray="4 4" />
            <Scatter name="科目" data={chartData.data}>
              {chartData.data.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={entry.mins > chartData.avgMins && entry.avgScore < chartData.avgScore ? '#B91C1C' : '#525252'} stroke="#FFFFFF" strokeWidth={1} />
              ))}
            </Scatter>
            {chartData.data.map((entry, index) => (
              <text key={`label-${index}`} x={entry.mins + 6} y={entry.avgScore + 4} textAnchor="start" fontSize={11} fill="#525252">{entry.name}</text>
            ))}
          </ScatterChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function Chart4SelfLearningTrend({ sessions }) {
  const chartData = useMemo(() => {
    const weekData = [];
    const today = new Date();
    
    for (let w = 3; w >= 0; w--) {
      let weekMins = 0;
      let selfMins = 0;
      for (let d = 6; d >= 0; d--) {
        const date = new Date(today);
        date.setDate(date.getDate() - w * 7 - d);
        const dateStr = date.toISOString().split('T')[0];
        for (const s of sessions) {
          if (s.date?.startsWith(dateStr)) {
            weekMins += s.duration_minutes || 0;
            if (isSelfForm(s.form)) selfMins += s.duration_minutes || 0;
          }
        }
      }
      weekData.push({ week: `第${4 - w}周`, selfRate: weekMins > 0 ? Math.round((selfMins / weekMins) * 100) : 0, total: weekMins });
    }
    
    return { data: weekData, gradeAvg: 35 };
  }, [sessions]);

  return (
    <div className="mckinsey-chart">
      <div className="mckinsey-chart__body">
        <ResponsiveContainer width="100%" height={220}>
          <ComposedChart data={chartData.data} margin={{ top: 32, right: 40, left: 40, bottom: 36 }}>
            <defs>
              <linearGradient id="areaGradient" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" stopColor="#B91C1C" stopOpacity={0.3}/>
                <stop offset="100%" stopColor="#B91C1C" stopOpacity={0.05}/>
              </linearGradient>
            </defs>
            <XAxis type="category" dataKey="week" tick={{ fontSize: 12, fill: '#525252', fontWeight: 500 }} axisLine={false} tickLine={false} />
            <YAxis type="number" domain={[0, 100]} tick={{ fontSize: 11, fill: '#8E8E93' }} axisLine={false} tickLine={false} />
            <Tooltip />
            <Area type="monotone" dataKey="selfRate" fill="url(#areaGradient)" stroke="#B91C1C" strokeWidth={2.5} dot={{ r: 6, fill: '#B91C1C', stroke: '#FFFFFF', strokeWidth: 2 }} />
            <Line type="monotone" dataKey={() => chartData.gradeAvg} stroke="#E5E5EA" strokeWidth={1} strokeDasharray="4 4" />
            <text x="50%" y="16" textAnchor="middle" fontSize={10} fill="#8E8E93">年级平均 {chartData.gradeAvg}%</text>
            {chartData.data.map((d, i) => (
              <text key={`value-${i}`} x={i} y={d.selfRate - 8} textAnchor="middle" fontSize={11} fontWeight={600} fill="#171717">{d.selfRate}%</text>
            ))}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function Chart5SubjectBalanceDeviation({ sessions }) {
  const chartData = useMemo(() => {
    const bySubj = {};
    for (const s of sessions) {
      const subj = s.subject || '未分类';
      bySubj[subj] = (bySubj[subj] || 0) + (s.duration_minutes || 0);
    }
    
    const totalMins = Object.values(bySubj).reduce((sum, m) => sum + m, 0);
    const subjectCount = Object.keys(bySubj).length;
    const idealPct = subjectCount > 0 ? Math.round((1 / subjectCount) * 100) : 16.7;
    
    const data = Object.entries(bySubj)
      .map(([name, mins]) => {
        const actualPct = totalMins > 0 ? Math.round((mins / totalMins) * 100) : 0;
        const deviation = actualPct - idealPct;
        return { name, mins, actualPct, idealPct, deviation, absDeviation: Math.abs(deviation) };
      })
      .sort((a, b) => b.absDeviation - a.absDeviation);
    
    const maxDeviation = Math.max(...data.map(d => Math.abs(d.deviation)), 1);
    
    return { data, idealPct, maxDeviation };
  }, [sessions]);

  return (
    <div className="mckinsey-chart">
      <div className="mckinsey-chart__body">
        <div className="mckinsey-deviation-chart">
          <div className="mckinsey-deviation-reference">
            <span className="mckinsey-deviation-reference-label">理想均衡 {chartData.idealPct}%</span>
          </div>
          {chartData.data.map((d, i) => (
            <div key={i} className="mckinsey-deviation-row">
              <span className="mckinsey-deviation-label">{d.name}</span>
              <div className="mckinsey-deviation-track">
                <div 
                  className={`mckinsey-deviation-fill ${d.deviation >= 0 ? 'mckinsey-deviation-fill--positive' : 'mckinsey-deviation-fill--negative'}`}
                  style={{ width: `${Math.abs(d.deviation) / chartData.maxDeviation * 100}%`, [d.deviation >= 0 ? 'left' : 'right']: '50%' }}
                >
                  <span className="mckinsey-deviation-value">{d.deviation >= 0 ? '+' : ''}{d.deviation}%</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Chart6PracticeQualityTracking({ sessions }) {
  const chartData = useMemo(() => {
    const bySubj = {};
    for (const s of sessions) {
      const subj = s.subject || '未分类';
      bySubj[subj] = bySubj[subj] || { total: 0, eval: 0 };
      bySubj[subj].total += s.duration_minutes || 0;
      if (s.category === 3) bySubj[subj].eval += s.duration_minutes || 0;
    }
    
    const data = Object.entries(bySubj)
      .map(([name, data]) => ({ name, evalPct: data.total > 0 ? Math.round((data.eval / data.total) * 100) : 0, total: data.total, eval: data.eval }))
      .sort((a, b) => a.evalPct - b.evalPct);
    
    return { data, targetPct: 40, warningThreshold: 30, maxPct: Math.max(...data.map(d => d.evalPct), 40) };
  }, [sessions]);

  return (
    <div className="mckinsey-chart">
      <div className="mckinsey-chart__body">
        <ResponsiveContainer width="100%" height={chartData.data.length * 50 + 20}>
          <BarChart data={chartData.data} layout="vertical" margin={{ top: 8, right: 80, left: 60, bottom: 8 }}>
            <XAxis type="number" domain={[0, 'dataMax']} tick={{ fontSize: 11, fill: '#8E8E93' }} axisLine={false} tickLine={false} grid={{ stroke: '#F2F2F7', strokeWidth: 1 }} />
            <YAxis type="category" dataKey="name" width={50} tick={{ fontSize: 13, fill: '#171717', fontWeight: 500 }} axisLine={false} tickLine={false} />
            <Tooltip />
            <Line type="line" x1={chartData.targetPct} y1="0" x2={chartData.targetPct} y2={chartData.data.length} stroke="#171717" strokeWidth={1} strokeDasharray="4 4" />
            <text x={chartData.targetPct + 4} y={14} textAnchor="start" fontSize={10} fill="#171717">目标 40%</text>
            <Bar dataKey="evalPct" radius={[0, 6, 6, 0]} barSize={24}>
              {chartData.data.map((d, i) => (
                <Cell key={`cell-${i}`} fill={d.evalPct < chartData.warningThreshold ? '#B91C1C' : d.evalPct >= chartData.targetPct ? '#171717' : '#525252'} />
              ))}
            </Bar>
            {chartData.data.map((d, i) => (
              <text key={`label-${i}`} x={d.evalPct + 8} y={i * 50 + 30} textAnchor="start" dominantBaseline="middle" fontSize={11} fontWeight={600} fill="#171717">{d.evalPct}%</text>
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function Chart7WeeklyHeatDistribution({ sessions }) {
  const chartData = useMemo(() => {
    const weekdays = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
    const hours = Array.from({ length: 24 }, (_, i) => i);
    
    const heatMap = {};
    weekdays.forEach(day => {
      heatMap[day] = {};
      hours.forEach(h => {
        heatMap[day][h] = 0;
      });
    });
    
    for (const s of sessions) {
      const date = s.date?.split('T')[0];
      const time = s.date?.split('T')[1]?.split(':')[0];
      if (date && time) {
        const dayIndex = new Date(date).getDay();
        const dayName = weekdays[dayIndex === 0 ? 6 : dayIndex - 1];
        const hour = parseInt(time, 10);
        heatMap[dayName][hour] += s.duration_minutes || 0;
      }
    }
    
    const maxMins = Math.max(...weekdays.flatMap(day => hours.map(h => heatMap[day][h])), 1);
    const lowDays = weekdays.filter(day => hours.reduce((sum, h) => sum + heatMap[day][h], 0) < 30);
    
    return { heatMap, weekdays, hours, maxMins, lowDays };
  }, [sessions]);

  const getHeatColor = (value, max) => {
    const intensity = value / max;
    if (intensity === 0) return '#FFFFFF';
    if (intensity < 0.25) return '#FEE2E2';
    if (intensity < 0.5) return '#FECACA';
    if (intensity < 0.75) return '#FCA5A5';
    return '#B91C1C';
  };

  return (
    <div className="mckinsey-chart">
      <div className="mckinsey-chart__body">
        <div className="mckinsey-heatmap">
          <div className="mckinsey-heatmap__header">
            {chartData.hours.filter(h => h % 4 === 0).map(h => (
              <div key={h} className="mckinsey-heatmap__hour-label">{h}:00</div>
            ))}
          </div>
          <div className="mckinsey-heatmap__body">
            {chartData.weekdays.map((day) => (
              <div key={day} className="mckinsey-heatmap__row">
                <span className="mckinsey-heatmap__day-label">{day}</span>
                <div className="mckinsey-heatmap__cells">
                  {chartData.hours.map((hour) => {
                    const value = chartData.heatMap[day][hour];
                    return (
                      <div key={hour} className="mckinsey-heatmap__cell" style={{ background: getHeatColor(value, chartData.maxMins), borderColor: value > 0 ? '#FFFFFF' : 'transparent' }} title={`${day} ${hour}:00 - ${fmtMinutes(value)}`} />
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
          <div className="mckinsey-heatmap__legend">
            <span className="mckinsey-heatmap__legend-label">无学习</span>
            <div className="mckinsey-heatmap__legend-gradient" />
            <span className="mckinsey-heatmap__legend-label">高强度</span>
          </div>
          {chartData.lowDays.length > 0 && (
            <div className="mckinsey-callout mckinsey-callout--heatmap">
              <span className="mckinsey-callout__label">{chartData.lowDays.join('、')}学习空白期</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const demoSessions = [
  { subject: '数学', duration_minutes: 210, eval_type: 2, score: 86, form: '自主学习', category: 1, date: '2026-07-08T10:00:00' },
  { subject: '数学', duration_minutes: 90, eval_type: 2, score: 88, form: '自主学习', category: 3, date: '2026-07-07T14:00:00' },
  { subject: '英语', duration_minutes: 220, eval_type: 2, score: 73, form: '校外辅导', category: 1, date: '2026-07-06T09:00:00' },
  { subject: '英语', duration_minutes: 80, eval_type: 2, score: 75, form: '自主学习', category: 3, date: '2026-07-05T15:00:00' },
  { subject: '物理', duration_minutes: 235, eval_type: 2, score: 64, form: '校外辅导', category: 1, date: '2026-07-04T10:00:00' },
  { subject: '物理', duration_minutes: 120, eval_type: 2, score: 62, form: '自主学习', category: 2, date: '2026-07-03T16:00:00' },
  { subject: '化学', duration_minutes: 160, eval_type: 2, score: 79, form: '自主学习', category: 1, date: '2026-07-02T11:00:00' },
  { subject: '化学', duration_minutes: 80, eval_type: 2, score: 81, form: '自主学习', category: 3, date: '2026-07-01T14:00:00' },
  { subject: '历史', duration_minutes: 140, eval_type: 2, score: 87, form: '自主学习', category: 1, date: '2026-06-30T09:00:00' },
  { subject: '历史', duration_minutes: 60, eval_type: 2, score: 85, form: '自主学习', category: 2, date: '2026-06-29T15:00:00' },
  { subject: '语文', duration_minutes: 130, eval_type: 2, score: 80, form: '自主学习', category: 1, date: '2026-06-28T10:00:00' },
  { subject: '语文', duration_minutes: 70, eval_type: 2, score: 78, form: '自主学习', category: 3, date: '2026-06-27T16:00:00' },
  { subject: '数学', duration_minutes: 120, eval_type: 2, score: 84, form: '自主学习', category: 2, date: '2026-06-26T14:00:00' },
  { subject: '英语', duration_minutes: 150, eval_type: 2, score: 71, form: '校外辅导', category: 1, date: '2026-06-25T09:00:00' },
  { subject: '物理', duration_minutes: 180, eval_type: 2, score: 66, form: '校外辅导', category: 1, date: '2026-06-24T11:00:00' },
  { subject: '化学', duration_minutes: 100, eval_type: 2, score: 77, form: '自主学习', category: 2, date: '2026-06-23T15:00:00' },
  { subject: '历史', duration_minutes: 90, eval_type: 2, score: 86, form: '自主学习', category: 3, date: '2026-06-22T10:00:00' },
  { subject: '语文', duration_minutes: 110, eval_type: 2, score: 79, form: '自主学习', category: 1, date: '2026-06-21T16:00:00' },
  { subject: '数学', duration_minutes: 180, eval_type: 2, score: 82, form: '自主学习', category: 1, date: '2026-06-20T09:00:00' },
  { subject: '英语', duration_minutes: 100, eval_type: 2, score: 74, form: '自主学习', category: 3, date: '2026-06-19T14:00:00' },
  { subject: '物理', duration_minutes: 150, eval_type: 2, score: 63, form: '校外辅导', category: 1, date: '2026-06-18T11:00:00' },
  { subject: '化学', duration_minutes: 120, eval_type: 2, score: 78, form: '自主学习', category: 1, date: '2026-06-17T15:00:00' },
  { subject: '历史', duration_minutes: 80, eval_type: 2, score: 88, form: '自主学习', category: 2, date: '2026-06-16T10:00:00' },
  { subject: '语文', duration_minutes: 90, eval_type: 2, score: 81, form: '自主学习', category: 3, date: '2026-06-15T16:00:00' },
  { subject: '数学', duration_minutes: 60, eval_type: 2, score: 85, form: '自主学习', category: 3, date: '2026-06-14T14:00:00' },
  { subject: '英语', duration_minutes: 180, eval_type: 2, score: 72, form: '校外辅导', category: 1, date: '2026-06-13T09:00:00' },
  { subject: '物理', duration_minutes: 60, eval_type: 2, score: 65, form: '自主学习', category: 2, date: '2026-06-12T15:00:00' },
];

export default function MentorAnalyticsTest() {
  const [sessions] = useState(demoSessions);
  
  const stats = useMemo(() => {
    const totalMins = sessions.reduce((a, s) => a + (s.duration_minutes || 0), 0);
    let scoreSum = 0;
    let scoreCount = 0;
    let selfMins = 0;
    
    for (const s of sessions) {
      if (Number(s.eval_type) === 2 && s.score != null && s.score !== '') {
        scoreSum += Number(s.score);
        scoreCount++;
      }
      if (isSelfForm(s.form)) selfMins += s.duration_minutes || 0;
    }
    
    const avgScore = scoreCount > 0 ? Math.round(scoreSum / scoreCount) : 0;
    const activeDays = new Set(sessions.map(s => s.date?.split('T')[0])).size;
    const selfRate = totalMins > 0 ? Math.round((selfMins / totalMins) * 100) : 0;
    
    const bySubjTime = {};
    for (const s of sessions) {
      const subj = s.subject || '未分类';
      bySubjTime[subj] = bySubjTime[subj] || { self: 0, other: 0, total: 0 };
      const mins = s.duration_minutes || 0;
      if (isSelfForm(s.form)) bySubjTime[subj].self += mins;
      else bySubjTime[subj].other += mins;
      bySubjTime[subj].total += mins;
    }
    const subjectTimeData = Object.entries(bySubjTime)
      .map(([name, data]) => ({ name, self: data.self, other: data.other, total: data.total, selfRate: data.total > 0 ? Math.round((data.self / data.total) * 100) : 0 }))
      .sort((a, b) => b.total - a.total);
    
    return {
      observations: generateObservations(avgScore, selfRate, activeDays, [], 0, 0, 0, subjectTimeData, sessions),
      actions: generateActions(sessions)
    };
  }, [sessions]);

  return (
    <div className="mentor-intelligence">
      <header className="mentor-intelligence__header">
        <div>
          <h1 className="mentor-intelligence__title">学生洞察</h1>
          <p className="mentor-intelligence__subtitle">帮助你快速理解学生状态，做出精准决策</p>
        </div>
      </header>
      <main className="mentor-intelligence__main">
        <div className="mentor-intelligence__content">
          <HeroInsight student={{ full_name: '演示学生', school_name: '示例学校' }} sessions={sessions} />
          <DiagnosticSection title="周末学习时长比工作日低 40%，且 4 周波动率超过 ±35%，时间管理能力薄弱" subtext="学习时长模式与稳定性">
            <Chart1LearningDurationPattern sessions={sessions} />
          </DiagnosticSection>
          <DiagnosticSection title="物理、数学两科占用 62% 总时长，语文、历史投入严重不足" subtext="学科投入结构（堆叠水平 Bar）">
            <Chart2SubjectInvestmentStructure sessions={sessions} />
          </DiagnosticSection>
          <DiagnosticSection title="50% 科目处于'高投入低产出'象限，学习效率存在系统性问题" subtext="学习效率矩阵（散点图 / 气泡图）">
            <Chart3LearningEfficiencyMatrix sessions={sessions} />
          </DiagnosticSection>
          <DiagnosticSection title="自主学习能力连续 4 周下滑，从 15% 降至 0%，需立即干预" subtext="自主学习能力趋势（Area Chart）">
            <Chart4SelfLearningTrend sessions={sessions} />
          </DiagnosticSection>
          <DiagnosticSection title="理科投入占比 78%，文科偏差度超过 3 个标准差，存在严重偏科" subtext="学科均衡性偏差（瀑布图 / 偏差 Bar）">
            <Chart5SubjectBalanceDeviation sessions={sessions} />
          </DiagnosticSection>
          <DiagnosticSection title="3 科客观评估练习占比低于 30%，应试训练过度，能力培养不足" subtext="练习质量追踪（水平 Bar + 目标线）">
            <Chart6PracticeQualityTracking sessions={sessions} />
          </DiagnosticSection>
          <DiagnosticSection title="学习集中在晚间 22:00 后，周一、周二几乎零投入，学习节奏极不规律" subtext="周学习热力分布（日历热力图）">
            <Chart7WeeklyHeatDistribution sessions={sessions} />
          </DiagnosticSection>
        </div>
        <ContextPanel observations={stats.observations} actions={stats.actions} />
      </main>
    </div>
  );
}
