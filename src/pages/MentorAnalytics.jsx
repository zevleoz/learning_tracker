import { useState, useEffect, useMemo } from 'react';
import { supabase } from '../lib/supabase.js';
import { isSelfForm } from '../components/SharedDashboard.jsx';
import {
  XAxis, YAxis, Tooltip, ResponsiveContainer, ComposedChart, Area
} from 'recharts';
import {
  TrendingDown, AlertTriangle, BookOpen, Target, Clock, Calendar, Award
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

function calculateHealthScore(avgScore, selfRate, activeDays, sessionTrend) {
  const scoreComponent = Math.min(avgScore / 100, 1) * 40;
  const selfComponent = Math.min(selfRate / 100, 1) * 30;
  const consistencyComponent = Math.min(activeDays / 30, 1) * 30;
  const trendBonus = sessionTrend > 0 ? Math.min(sessionTrend * 5, 5) : 0;
  return Math.round(Math.min(scoreComponent + selfComponent + consistencyComponent + trendBonus, 100));
}

function getHealthState(healthScore, sessionTrend) {
  if (healthScore >= 85) return { level: '良好', color: '#171717', label: '学习状态稳定' };
  if (healthScore >= 70) {
    if (sessionTrend > 0) return { level: '进步中', color: '#525252', label: '近期表现提升' };
    return { level: '一般', color: '#8E8E93', label: '存在提升空间' };
  }
  if (healthScore >= 55) return { level: '需关注', color: '#B91C1C', label: '需要加强监督' };
  return { level: '危险', color: '#B91C1C', label: '需要重点干预' };
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

      if (progress < 1) {
        requestAnimationFrame(animate);
      }
    };

    requestAnimationFrame(animate);
  }, [value, duration]);

  return <span>{prefix}{displayValue}{suffix}</span>;
}

function generateObservations(selfRate, subjectTimeData, sessions) {
  const observations = [];

  // Calculate daily averages based on actual calendar dates
  const byDate = {};
  for (const s of sessions) {
    const date = s.date?.split('T')[0];
    if (date) {
      byDate[date] = (byDate[date] || 0) + (s.duration_minutes || 0);
    }
  }
  let workdayMins = 0, weekendMins = 0, workdayDateCount = 0, weekendDateCount = 0;
  for (const [date, mins] of Object.entries(byDate)) {
    const dayIndex = new Date(date).getDay();
    if (dayIndex === 0 || dayIndex === 6) {
      weekendMins += mins;
      weekendDateCount++;
    } else {
      workdayMins += mins;
      workdayDateCount++;
    }
  }
  const workdayAvg = workdayDateCount > 0 ? Math.round(workdayMins / workdayDateCount) : 0;
  const weekendAvg = weekendDateCount > 0 ? Math.round(weekendMins / weekendDateCount) : 0;
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
  
  const bySubjEfficiency = {};
  for (const s of sessions) {
    const subj = s.subject || '未分类';
    bySubjEfficiency[subj] = bySubjEfficiency[subj] || { mins: 0, scoreSum: 0, scoreCount: 0 };
    bySubjEfficiency[subj].mins += s.duration_minutes || 0;
    if (Number(s.eval_type) === 2 && s.score != null && s.score !== '') {
      bySubjEfficiency[subj].scoreSum += Number(s.score);
      bySubjEfficiency[subj].scoreCount++;
    }
  }
  const efficiencyData = Object.entries(bySubjEfficiency)
    .map(([name, data]) => ({ name, mins: data.mins, avgScore: data.scoreCount > 0 ? Math.round(data.scoreSum / data.scoreCount) : 0 }))
    .filter(d => d.avgScore > 0);
  const avgMins = efficiencyData.length > 0 ? efficiencyData.reduce((sum, d) => sum + d.mins, 0) / efficiencyData.length : 0;
  const avgScoreEff = efficiencyData.length > 0 ? efficiencyData.reduce((sum, d) => sum + d.avgScore, 0) / efficiencyData.length : 70;
  const highLowCount = efficiencyData.filter(d => d.mins > avgMins && d.avgScore < avgScoreEff).length;
  const efficiencyRatio = efficiencyData.length > 0 ? Math.round((highLowCount / efficiencyData.length) * 100) : 0;
  
  if (efficiencyRatio >= 40) {
    observations.push({
      priority: 3,
      icon: <AlertTriangle className="w-5 h-5" />,
      title: '学习效率存在系统性问题',
      detail: `Chart 3显示：${efficiencyRatio}%科目处于"高投入低产出"象限，需调整学习方法`,
      severity: 'warning'
    });
  }
  
  const weekSelfData = [];
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
    weekSelfData.push(weekMins > 0 ? Math.round((selfMins / weekMins) * 100) : 0);
  }
  const selfTrend = weekSelfData.length >= 2 ? weekSelfData[weekSelfData.length - 1] - weekSelfData[0] : 0;
  
  if (selfTrend < -10) {
    observations.push({
      priority: 4,
      icon: <TrendingDown className="w-5 h-5" />,
      title: '自主学习能力连续下滑',
      detail: `Chart 4显示：近4周自主学习率从${weekSelfData[0]}%降至${weekSelfData[weekSelfData.length - 1]}%，下降${Math.abs(selfTrend)}个百分点`,
      severity: 'warning'
    });
  }
  
  const totalDuration = sessions.reduce((sum, s) => sum + (s.duration_minutes || 0), 0);
  const subjectCount = Object.keys(bySubjEfficiency).length;
  const idealPct = subjectCount > 0 ? Math.round((1 / subjectCount) * 100) : 16.7;
  // Use subjectCategory for science/arts classification, not the course name
  const SCIENCE_CATEGORIES = ['物理', '数学', '化学', '生物', '计算机', 'science', 'math', 'physics', 'chemistry', 'biology', 'cs'];
  const subjToCategory = {};
  for (const s of sessions) {
    if (s.subject && !subjToCategory[s.subject]) {
      subjToCategory[s.subject] = s.subjectCategory || null;
    }
  }
  const sciencePct = efficiencyData.filter(d => {
    const cat = subjToCategory[d.name];
    return cat && SCIENCE_CATEGORIES.includes(cat);
  }).reduce((sum, d) => {
    return totalDuration > 0 ? sum + Math.round((d.mins / totalDuration) * 100) : sum;
  }, 0);
  
  if (sciencePct > 60) {
    observations.push({
      priority: 5,
      icon: <BookOpen className="w-5 h-5" />,
      title: '存在严重偏科',
      detail: `Chart 5显示：理科投入占比${sciencePct}%，理想均衡应为${idealPct}%，文科偏差度显著`,
      severity: 'warning'
    });
  }
  
  const bySubjEval = {};
  for (const s of sessions) {
    const subj = s.subject || '未分类';
    bySubjEval[subj] = bySubjEval[subj] || { total: 0, eval: 0 };
    bySubjEval[subj].total += s.duration_minutes || 0;
    if (s.category === 3) bySubjEval[subj].eval += s.duration_minutes || 0;
  }
  const lowQualityCount = Object.values(bySubjEval).filter(d => d.total > 0 && (d.eval / d.total * 100) < 30).length;
  
  if (lowQualityCount >= 2) {
    observations.push({
      priority: 6,
      icon: <Award className="w-5 h-5" />,
      title: '练习质量偏低',
      detail: `Chart 6显示：${lowQualityCount}科客观评估练习占比低于30%，应试训练过度，能力培养不足`,
      severity: 'warning'
    });
  }
  
  const heatMap = {};
  ['周一', '周二', '周三', '周四', '周五', '周六', '周日'].forEach(day => { heatMap[day] = 0; });
  for (const s of sessions) {
    const date = s.date?.split('T')[0];
    if (date) {
      const dayIndex = new Date(date).getDay();
      const dayName = dayIndex === 0 ? '周日' : ['周一', '周二', '周三', '周四', '周五', '周六'][dayIndex - 1];
      heatMap[dayName] += s.duration_minutes || 0;
    }
  }
  const lowDays = Object.entries(heatMap).filter(([, mins]) => mins < 30).map(([day]) => day);
  
  if (lowDays.length >= 2) {
    observations.push({
      priority: 7,
      icon: <Calendar className="w-5 h-5" />,
      title: '学习节奏极不规律',
      detail: `Chart 7显示：${lowDays.join('、')}学习时间不足30分钟，需制定固定学习日程`,
      severity: 'warning'
    });
  }
  
  if (selfRate < 40) {
    observations.push({
      priority: 8,
      icon: <AlertTriangle className="w-5 h-5" />,
      title: '自主学习率偏低',
      detail: `自主学习仅占${selfRate}%，建议提升至40%以上以培养独立学习能力`,
      severity: 'warning'
    });
  }
  
  return observations.sort((a, b) => a.priority - b.priority).slice(0, 5);
}

function generateActions(sessions) {
  const result = [];
  if (!sessions || sessions.length === 0) return result;

  const totalMins = sessions.reduce((a, s) => a + (s.duration_minutes || 0), 0);
  let selfMins = 0;
  for (const s of sessions) {
    if (isSelfForm(s.form)) selfMins += s.duration_minutes || 0;
  }
  const selfRate = totalMins > 0 ? Math.round((selfMins / totalMins) * 100) : 0;
  const activeDays = new Set(sessions.map(s => s.date?.split('T')[0])).size;
  
  const bySubj = {};
  for (const s of sessions) {
    const subj = s.subject || '未分类';
    bySubj[subj] = bySubj[subj] || { scoreSum: 0, scoreCount: 0, mins: 0 };
    bySubj[subj].mins += s.duration_minutes || 0;
    if (Number(s.eval_type) === 2 && s.score != null && s.score !== '') {
      bySubj[subj].scoreSum += Number(s.score);
      bySubj[subj].scoreCount++;
    }
  }
  
  const weakSubjects = Object.entries(bySubj)
    .filter(([, data]) => data.scoreCount > 0 && Math.round(data.scoreSum / data.scoreCount) < 70)
    .map(([name, data]) => ({ name, score: Math.round(data.scoreSum / data.scoreCount) }))
    .sort((a, b) => a.score - b.score);
  
  if (weakSubjects.length > 0) {
    const weakest = weakSubjects[0];
    const practiceSessions = sessions.filter(s => s.subject === weakest.name && s.category === 3);
    const practiceCount = practiceSessions.length;
    // Calculate weekly average based on date span
    const practiceDates = practiceSessions.map(s => s.date?.split('T')[0]).filter(Boolean);
    const uniqueDates = new Set(practiceDates);
    const dateSpan = uniqueDates.size > 0
      ? Math.max(1, Math.ceil((Date.now() - new Date(Math.min(...practiceDates.map(d => new Date(d)))).getTime()) / (7 * 24 * 3600 * 1000)))
      : 0;
    const weeklyAvg = dateSpan > 0 ? (practiceCount / dateSpan).toFixed(1) : '0';
    result.push({
      priority: 1,
      title: `提升${weakSubjects.map(s => s.name).join('、')}成绩`,
      description: `${weakest.name}平均${weakest.score}分，低于70分达标线，需要针对性辅导`,
      suggestion: `当前${weakest.name}每周练习约${weeklyAvg}次 → 建议每周至少2次专项训练`,
      type: 'danger'
    });
  }
  
  if (selfRate < 40) {
    const otherMins = totalMins - selfMins;
    const otherPct = totalMins > 0 ? Math.round((otherMins / totalMins) * 100) : 0;
    result.push({
      priority: 2,
      title: '培养自主学习习惯',
      description: `自主学习仅占${selfRate}%（${fmtMinutes(selfMins)}），校外辅导${fmtMinutes(otherMins)}`,
      suggestion: `当前辅导占比${otherPct}% → 建议降至50%以下`,
      type: 'warning'
    });
  }
  
  if (activeDays < 10) {
    result.push({
      priority: 3,
      title: '提高学习频率',
      description: `近30天仅${activeDays}天有学习记录，建议增加学习频率`,
      suggestion: `当前每周${Math.round(activeDays / 4)}天 → 建议每周至少5天学习`,
      type: 'warning'
    });
  }
  
  const avgScoreAll = Object.values(bySubj).filter(d => d.scoreCount > 0).length > 0
    ? Math.round(Object.values(bySubj).filter(d => d.scoreCount > 0).reduce((sum, d) => sum + d.scoreSum, 0) / Object.values(bySubj).filter(d => d.scoreCount > 0).reduce((sum, d) => sum + d.scoreCount, 0))
    : 0;
  
  if (avgScoreAll >= 80 && activeDays >= 15 && selfRate >= 50) {
    result.push({
      priority: 10,
      title: '保持良好状态',
      description: `平均${avgScoreAll}分，自主率${selfRate}%，学习表现优秀`,
      suggestion: '保持当前节奏，适当增加挑战性学习内容',
      type: 'success'
    });
  }
  
  return result.sort((a, b) => a.priority - b.priority);
}

function HeroInsight({ student, sessions = [] }) {
  const stats = useMemo(() => {
    const safeSessions = sessions || [];
    const totalMins = safeSessions.reduce((a, s) => a + (s.duration_minutes || 0), 0);
    let scoreSum = 0;
    let scoreCount = 0;
    let selfMins = 0;
    
    for (const s of safeSessions) {
      if (Number(s.eval_type) === 2 && s.score != null && s.score !== '') {
        scoreSum += Number(s.score);
        scoreCount++;
      }
      if (isSelfForm(s.form)) selfMins += s.duration_minutes || 0;
    }
    
    const avgScore = scoreCount > 0 ? Math.round(scoreSum / scoreCount) : 0;
    const activeDays = new Set(safeSessions.map(s => s.date?.split('T')[0])).size;
    const selfRate = totalMins > 0 ? Math.round((selfMins / totalMins) * 100) : 0;
    
    const byDate = {};
    for (const s of safeSessions) {
      const date = s.date?.split('T')[0];
      if (date) {
        byDate[date] = (byDate[date] || 0) + (s.duration_minutes || 0);
      }
    }
    
    const recentDays = [];
    const today = new Date();
    for (let i = 13; i >= 0; i--) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];
      recentDays.push(byDate[dateStr] || 0);
    }
    
    const prevDays = [];
    for (let i = 27; i >= 14; i--) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];
      prevDays.push(byDate[dateStr] || 0);
    }
    
    const recentMins = recentDays.reduce((a, b) => a + b, 0);
      const prevMins = prevDays.reduce((a, b) => a + b, 0);
      const sessionTrend = prevMins > 0 ? Math.round(((recentMins - prevMins) / prevMins) * 100) : 0;
      
      const healthScore = calculateHealthScore(avgScore, selfRate, activeDays, sessionTrend);
      const healthState = getHealthState(healthScore, sessionTrend);
      
      const bySubj = {};
      for (const s of safeSessions) {
        const subj = s.subject || '未分类';
        bySubj[subj] = bySubj[subj] || { scoreSum: 0, scoreCount: 0 };
        if (Number(s.eval_type) === 2 && s.score != null && s.score !== '') {
          bySubj[subj].scoreSum += Number(s.score);
          bySubj[subj].scoreCount++;
        }
      }

      const bySubjTime = {};
      for (const s of safeSessions) {
        const subj = s.subject || '未分类';
        bySubjTime[subj] = bySubjTime[subj] || { self: 0, other: 0, total: 0 };
        const mins = s.duration_minutes || 0;
        if (isSelfForm(s.form)) bySubjTime[subj].self += mins;
        else bySubjTime[subj].other += mins;
        bySubjTime[subj].total += mins;
      }
      const subjectTimeData = Object.entries(bySubjTime)
        .map(([name, data]) => ({
          name,
          self: data.self,
          other: data.other,
          total: data.total,
          selfRate: data.total > 0 ? Math.round((data.self / data.total) * 100) : 0
        }))
        .sort((a, b) => b.total - a.total);

      const observations = generateObservations(selfRate, subjectTimeData, safeSessions);
    
    return {
      avgScore,
      avgLetter: scoreCount > 0 ? scoreToLetter(avgScore) : '-',
      selfRate,
      activeDays,
      healthScore,
      healthState,
      observations,
      totalMins,
      sessionCount: safeSessions.length
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
          <div className="insight-hero__health">
            <div className="insight-hero__health-score">
              <AnimatedNumber value={stats.healthScore} />
            </div>
            <div className="insight-hero__health-label">{stats.healthState.label}</div>
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

function DiagnosticSection({ title, subtext, children, animationIndex = 0 }) {
  return (
    <section className={`ui-card ui-card--chart animate-stagger-in animate-stagger-in--${animationIndex}`}>
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
                <div className="context-panel__icon-wrap">
                  <span className="context-panel__icon">{obs.icon}</span>
                </div>
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

function Chart1LearningDurationPattern({ sessions = [] }) {
  const chartData = useMemo(() => {
    // Group by actual calendar date, not day-of-week name
    const byDate = {};
    for (const s of sessions) {
      const date = s.date?.split('T')[0];
      if (date) {
        byDate[date] = (byDate[date] || 0) + (s.duration_minutes || 0);
      }
    }

    const workdayDates = [];
    const weekendDates = [];
    for (const [date, mins] of Object.entries(byDate)) {
      const dayIndex = new Date(date).getDay();
      if (dayIndex === 0 || dayIndex === 6) {
        weekendDates.push({ date, mins });
      } else {
        workdayDates.push({ date, mins });
      }
    }

    const workdayMins = workdayDates.reduce((sum, d) => sum + d.mins, 0);
    const weekendMins = weekendDates.reduce((sum, d) => sum + d.mins, 0);

    // Daily average = total minutes / number of unique dates
    const workdayAvg = workdayDates.length > 0 ? Math.round(workdayMins / workdayDates.length) : 0;
    const weekendAvg = weekendDates.length > 0 ? Math.round(weekendMins / weekendDates.length) : 0;
    
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
    
    const gapPercent = workdayAvg > 0 ? Math.round(((workdayAvg - weekendAvg) / workdayAvg) * 100) : 0;
    
    return {
      workdayAvg,
      weekendAvg,
      volatility,
      gapPercent,
      maxAvg: Math.max(workdayAvg, weekendAvg, 1)
    };
  }, [sessions]);

  return (
    <div className="mckinsey-chart">
      <div className="mckinsey-chart__body">
        <div className="mckinsey-bar-group">
          <div className="mckinsey-bar-row">
            <span className="mckinsey-bar-label">工作日日均</span>
            <div className="mckinsey-bar-track">
              <div 
                className="mckinsey-bar-fill" 
                style={{ width: `${chartData.workdayAvg / chartData.maxAvg * 100}%` }}
              >
                <span className="mckinsey-bar-value">{fmtMinutes(chartData.workdayAvg)}</span>
              </div>
            </div>
            <span className="mckinsey-bar-end-label">{fmtMinutes(chartData.workdayAvg)}</span>
          </div>
          <div className="mckinsey-bar-row">
            <span className="mckinsey-bar-label">周末日均</span>
            <div className="mckinsey-bar-track">
              <div 
                className="mckinsey-bar-fill mckinsey-bar-fill--secondary" 
                style={{ width: `${chartData.weekendAvg / chartData.maxAvg * 100}%` }}
              >
                <span className="mckinsey-bar-value">{fmtMinutes(chartData.weekendAvg)}</span>
              </div>
            </div>
            <span className="mckinsey-bar-end-label">{fmtMinutes(chartData.weekendAvg)}</span>
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

function Chart2SubjectInvestmentStructure({ sessions = [] }) {
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
    
    return { data, maxTotal: Math.max(...data.map(d => d.total), 1) };
  }, [sessions]);

  return (
    <div className="mckinsey-chart">
      <div className="mckinsey-chart__body">
        <div className="mckinsey-stacked-bar-chart">
          {chartData.data.map((d, i) => (
            <div key={i} className="mckinsey-stacked-bar-row">
              <span className="mckinsey-stacked-bar-label">{d.name}</span>
              <div className="mckinsey-stacked-bar-track">
                <div 
                  className="mckinsey-stacked-bar-fill mckinsey-stacked-bar-fill--other"
                  style={{ width: `${(d.other / chartData.maxTotal) * 100}%` }}
                />
                <div 
                  className="mckinsey-stacked-bar-fill mckinsey-stacked-bar-fill--self"
                  style={{ width: `${(d.self / chartData.maxTotal) * 100}%` }}
                />
              </div>
              <div className="mckinsey-stacked-bar-values">
                <span className="mckinsey-stacked-bar-value">{fmtMinutes(d.total)}</span>
                <span className="mckinsey-stacked-bar-meta">{d.pct}% · 自主{d.selfRate}%</span>
              </div>
            </div>
          ))}
        </div>
        <div className="mckinsey-stacked-bar-legend">
          <span className="mckinsey-stacked-bar-legend-item">
            <span className="mckinsey-stacked-bar-legend-dot" style={{ background: '#E5E5EA' }}></span>
            校外辅导
          </span>
          <span className="mckinsey-stacked-bar-legend-item">
            <span className="mckinsey-stacked-bar-legend-dot" style={{ background: '#B91C1C' }}></span>
            自主学习
          </span>
        </div>
      </div>
    </div>
  );
}

function Chart3LearningEfficiencyMatrix({ sessions = [] }) {
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
        evalPct: data.mins > 0 ? Math.round((data.evalMins / data.mins) * 100) : 0
      }))
      .filter(d => d.avgScore > 0);
    
    const avgMins = data.length > 0 ? data.reduce((sum, d) => sum + d.mins, 0) / data.length : 0;
    const avgScore = data.length > 0 ? data.reduce((sum, d) => sum + d.avgScore, 0) / data.length : 70;
    
    return { 
      data: data.map(d => ({
        ...d,
        quadrant: d.mins > avgMins && d.avgScore < avgScore ? 'high-low' :
                  d.mins > avgMins && d.avgScore >= avgScore ? 'high-high' :
                  d.mins <= avgMins && d.avgScore < avgScore ? 'low-low' : 'low-high',
        efficiencyScore: d.mins > 0 ? Math.round((d.avgScore / d.mins) * 100) : 0
      })), 
      avgMins, 
      avgScore,
      maxMins: data.length > 0 ? Math.max(...data.map(d => d.mins), 1) : 1
    };
  }, [sessions]);

  return (
    <div className="mckinsey-chart">
      <div className="mckinsey-chart__body">
        <div className="mckinsey-efficiency-table">
          <div className="mckinsey-efficiency-table__header">
            <div className="mckinsey-efficiency-table__col mckinsey-efficiency-table__col--name">科目</div>
            <div className="mckinsey-efficiency-table__col mckinsey-efficiency-table__col--duration">投入时长</div>
            <div className="mckinsey-efficiency-table__col mckinsey-efficiency-table__col--score">平均分数</div>
            <div className="mckinsey-efficiency-table__col mckinsey-efficiency-table__col--eval">客观评估</div>
            <div className="mckinsey-efficiency-table__col mckinsey-efficiency-table__col--status">状态</div>
          </div>
          {chartData.data.map((d, i) => (
            <div key={i} className="mckinsey-efficiency-table__row">
              <div className="mckinsey-efficiency-table__col mckinsey-efficiency-table__col--name">
                <span className="mckinsey-efficiency-table__name">{d.name}</span>
              </div>
              <div className="mckinsey-efficiency-table__col mckinsey-efficiency-table__col--duration">
                <div className="mckinsey-efficiency-table__bar-track">
                  <div 
                    className="mckinsey-efficiency-table__bar-fill"
                    style={{ width: `${(d.mins / chartData.maxMins) * 100}%` }}
                  />
                </div>
                <span className="mckinsey-efficiency-table__value">{fmtMinutes(d.mins)}</span>
              </div>
              <div className="mckinsey-efficiency-table__col mckinsey-efficiency-table__col--score">
                <div className="mckinsey-efficiency-table__score-bar">
                  <div 
                    className={`mckinsey-efficiency-table__score-fill ${d.avgScore >= 80 ? '' : d.avgScore >= 60 ? 'mckinsey-efficiency-table__score-fill--medium' : 'mckinsey-efficiency-table__score-fill--low'}`}
                    style={{ width: `${d.avgScore}%` }}
                  />
                </div>
                <span className={`mckinsey-efficiency-table__value ${d.avgScore >= 80 ? '' : d.avgScore >= 60 ? '' : 'text-red-600'}`}>{d.avgScore}</span>
              </div>
              <div className="mckinsey-efficiency-table__col mckinsey-efficiency-table__col--eval">
                <div className="mckinsey-efficiency-table__bar-track">
                  <div 
                    className={`mckinsey-efficiency-table__bar-fill ${d.evalPct >= 30 ? '' : 'mckinsey-efficiency-table__bar-fill--warning'}`}
                    style={{ width: `${d.evalPct}%` }}
                  />
                </div>
                <span className="mckinsey-efficiency-table__value">{d.evalPct}%</span>
              </div>
              <div className="mckinsey-efficiency-table__col mckinsey-efficiency-table__col--status">
                <span className={`mckinsey-efficiency-table__badge ${d.quadrant === 'high-low' ? 'mckinsey-efficiency-table__badge--warning' : ''}`}>
                  {d.quadrant === 'high-low' ? '高投入低产出' :
                   d.quadrant === 'high-high' ? '高效' :
                   d.quadrant === 'low-low' ? '需关注' : '低投入高效'}
                </span>
              </div>
            </div>
          ))}
        </div>
        <div className="mckinsey-efficiency-table__legend">
          <span className="mckinsey-efficiency-table__legend-item">
            <span className="mckinsey-efficiency-table__legend-dot" style={{ background: '#B91C1C' }}></span>
            高投入低产出（需调整）
          </span>
          <span className="mckinsey-efficiency-table__legend-item">
            <span className="mckinsey-efficiency-table__legend-dot" style={{ background: '#171717' }}></span>
            正常状态
          </span>
        </div>
      </div>
    </div>
  );
}

function Chart4SelfLearningTrend({ sessions = [] }) {
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
      weekData.push({
        week: `第${4 - w}周`,
        selfRate: weekMins > 0 ? Math.round((selfMins / weekMins) * 100) : 0,
        total: weekMins
      });
    }
    
    const decline = weekData.length >= 2 ? weekData[weekData.length - 1].selfRate - weekData[0].selfRate : 0;
    const steepestIndex = weekData.length >= 2 
      ? weekData.reduce((minIdx, curr, idx, arr) => idx > 0 && curr.selfRate - arr[idx-1].selfRate < arr[minIdx].selfRate - arr[minIdx > 0 ? minIdx - 1 : 0].selfRate ? idx : minIdx, 0)
      : -1;
    
    return { data: weekData, decline, steepestIndex };
  }, [sessions]);

  return (
    <div className="mckinsey-chart">
      <div className="mckinsey-chart__body">
        <ResponsiveContainer width="100%" height={200}>
          <ComposedChart data={chartData.data} margin={{ top: 16, right: 40, left: 40, bottom: 36 }}>
            <defs>
              <linearGradient id="areaGradient" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" stopColor="#B91C1C" stopOpacity={0.3}/>
                <stop offset="100%" stopColor="#B91C1C" stopOpacity={0.05}/>
              </linearGradient>
            </defs>
            <XAxis 
              type="category" 
              dataKey="week" 
              tick={{ fontSize: 12, fill: '#525252', fontWeight: 500 }} 
              axisLine={false} 
              tickLine={false}
            />
            <YAxis 
              type="number" 
              domain={[0, 100]} 
              tick={{ fontSize: 11, fill: '#8E8E93' }} 
              axisLine={false} 
              tickLine={false}
            />
            <Tooltip />
            <Area 
              type="monotone" 
              dataKey="selfRate" 
              fill="url(#areaGradient)" 
              stroke="#B91C1C" 
              strokeWidth={2.5} 
              dot={{ r: 6, fill: '#B91C1C', stroke: '#FFFFFF', strokeWidth: 2 }}
              activeDot={{ r: 8 }}
            />
            {chartData.data.map((d, i) => (
              <text
                key={`value-${i}`}
                x={i}
                y={d.selfRate - 8}
                textAnchor="middle"
                fontSize={11}
                fontWeight={600}
                fill="#171717"
              >
                {d.selfRate}%
              </text>
            ))}
            {chartData.steepestIndex > 0 && chartData.data[chartData.steepestIndex].selfRate < chartData.data[chartData.steepestIndex - 1].selfRate - 5 && (
              <text
                x={chartData.steepestIndex}
                y={chartData.data[chartData.steepestIndex].selfRate + 20}
                textAnchor="middle"
                fontSize={9}
                fill="#B91C1C"
              >
                骤降
              </text>
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function Chart5SubjectBalanceDeviation({ sessions = [] }) {
  const chartData = useMemo(() => {
    const bySubj = {};
    for (const s of sessions) {
      const subj = s.subject || '未分类';
      bySubj[subj] = (bySubj[subj] || 0) + (s.duration_minutes || 0);
    }
    
    const totalMins = Object.values(bySubj).reduce((sum, m) => sum + m, 0);
    const subjectCount = Object.keys(bySubj).length;
    const idealPct = subjectCount > 0 ? Math.round((1 / subjectCount) * 100) : 16.7;
    
    const maxPct = totalMins > 0 ? Math.max(...Object.values(bySubj).map(m => Math.round((m / totalMins) * 100)), idealPct) : 100;
    
    const data = Object.entries(bySubj)
      .map(([name, mins]) => {
        const actualPct = totalMins > 0 ? Math.round((mins / totalMins) * 100) : 0;
        const deviation = actualPct - idealPct;
        return {
          name,
          actualPct,
          idealPct,
          deviation
        };
      })
      .sort((a, b) => b.actualPct - a.actualPct);
    
    return { data, idealPct, maxPct };
  }, [sessions]);

  return (
    <div className="mckinsey-chart">
      <div className="mckinsey-chart__body">
        <div className="mckinsey-balance-chart">
          {chartData.data.map((d, i) => (
            <div key={i} className="mckinsey-balance-row">
              <span className="mckinsey-balance-label">{d.name}</span>
              <div className="mckinsey-balance-track">
                <div 
                  className={`mckinsey-balance-fill ${d.deviation < 0 ? 'mckinsey-balance-fill--negative' : 'mckinsey-balance-fill--positive'}`}
                  style={{ width: `${(d.actualPct / chartData.maxPct) * 100}%` }}
                />
                <div 
                  className="mckinsey-balance-target"
                  style={{ left: `${(chartData.idealPct / chartData.maxPct) * 100}%` }}
                />
              </div>
              <div className="mckinsey-balance-values">
                <span className="mckinsey-balance-value">{d.actualPct}%</span>
                <span className={`mckinsey-balance-deviation ${d.deviation < 0 ? 'mckinsey-balance-deviation--negative' : ''}`}>
                  {d.deviation >= 0 ? '+' : ''}{d.deviation}%
                </span>
              </div>
            </div>
          ))}
        </div>
        <div className="mckinsey-balance-legend">
          <span className="mckinsey-balance-legend-item">
            <span className="mckinsey-balance-legend-line"></span>
            理想均衡 {chartData.idealPct}%
          </span>
          <span className="mckinsey-balance-legend-item">
            <span className="mckinsey-balance-legend-dot" style={{ background: '#171717' }}></span>
            投入过多
          </span>
          <span className="mckinsey-balance-legend-item">
            <span className="mckinsey-balance-legend-dot" style={{ background: '#B91C1C' }}></span>
            投入不足
          </span>
        </div>
      </div>
    </div>
  );
}

function Chart6PracticeQualityTracking({ sessions = [] }) {
  const chartData = useMemo(() => {
    const bySubj = {};
    for (const s of sessions) {
      const subj = s.subject || '未分类';
      bySubj[subj] = bySubj[subj] || { total: 0, eval: 0 };
      bySubj[subj].total += s.duration_minutes || 0;
      if (s.category === 3) bySubj[subj].eval += s.duration_minutes || 0;
    }
    
    const targetPct = 40;
    const warningThreshold = 30;
    
    const data = Object.entries(bySubj)
      .map(([name, data]) => ({
        name,
        evalPct: data.total > 0 ? Math.round((data.eval / data.total) * 100) : 0,
        total: data.total,
        eval: data.eval,
        status: data.total > 0 && (data.eval / data.total * 100) < warningThreshold ? 'low' : 
                data.total > 0 && (data.eval / data.total * 100) >= targetPct ? 'good' : 'medium'
      }))
      .sort((a, b) => a.evalPct - b.evalPct);
    
    return { data, targetPct, warningThreshold };
  }, [sessions]);

  return (
    <div className="mckinsey-chart">
      <div className="mckinsey-chart__body">
        <p className="mckinsey-section__subtext" style={{ marginBottom: 12 }}>
          客观评估占比 = 有标准答案的练习 / 总练习时间
        </p>
        <div className="mckinsey-practice-chart">
          {chartData.data.map((d, i) => (
            <div key={i} className="mckinsey-practice-row">
              <span className="mckinsey-practice-label">{d.name}</span>
              <div className="mckinsey-practice-track">
                <div 
                  className={`mckinsey-practice-fill mckinsey-practice-fill--${d.status}`}
                  style={{ width: `${d.evalPct}%` }}
                />
                <div 
                  className="mckinsey-practice-target"
                  style={{ left: `${chartData.targetPct}%` }}
                />
              </div>
              <span className={`mckinsey-practice-value ${d.status === 'low' ? 'mckinsey-practice-value--low' : ''}`}>
                {d.evalPct}%
              </span>
            </div>
          ))}
        </div>
        <div className="mckinsey-practice-legend">
          <span className="mckinsey-practice-legend-item">
            <span className="mckinsey-practice-legend-dot" style={{ background: '#171717' }}></span>
            达标（≥40%）
          </span>
          <span className="mckinsey-practice-legend-item">
            <span className="mckinsey-practice-legend-dot" style={{ background: '#525252' }}></span>
            待提升（30%-40%）
          </span>
          <span className="mckinsey-practice-legend-item">
            <span className="mckinsey-practice-legend-dot" style={{ background: '#B91C1C' }}></span>
            需加强（&lt;30%）
          </span>
          <span className="mckinsey-practice-legend-item">
            <span className="mckinsey-practice-legend-line"></span>
            目标线 40%
          </span>
        </div>
      </div>
    </div>
  );
}

function Chart7WeeklyHeatDistribution({ sessions = [] }) {
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
      const timeStr = s.time || (s.date?.includes('T') ? s.date.split('T')[1]?.split(':')[0] : null);
      if (date && timeStr) {
        const dayIndex = new Date(date).getDay();
        const dayName = weekdays[dayIndex === 0 ? 6 : dayIndex - 1];
        const hour = parseInt(timeStr, 10);
        if (hour >= 0 && hour < 24) {
          heatMap[dayName][hour] += s.duration_minutes || 0;
        }
      }
    }
    
    const maxMins = Math.max(...weekdays.flatMap(day => hours.map(h => heatMap[day][h])), 1);
    
    const peakHour = hours.reduce((maxHour, h) => {
      const total = weekdays.reduce((sum, day) => sum + heatMap[day][h], 0);
      const currentMax = weekdays.reduce((sum, day) => sum + heatMap[day][maxHour], 0);
      return total > currentMax ? h : maxHour;
    }, 0);
    
    const lowDays = weekdays.filter(day => {
      const total = hours.reduce((sum, h) => sum + heatMap[day][h], 0);
      return total < 30;
    });
    
    return { heatMap, weekdays, hours, maxMins, peakHour, lowDays };
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
                      <div
                        key={hour}
                        className="mckinsey-heatmap__cell"
                        style={{ 
                          background: getHeatColor(value, chartData.maxMins),
                          borderColor: value > 0 ? '#FFFFFF' : 'transparent'
                        }}
                        title={`${day} ${hour}:00 - ${fmtMinutes(value)}`}
                      />
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

export default function MentorAnalyticsPage({ students, connections }) {
  const [selectedStudent, setSelectedStudent] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const connectionList = useMemo(() => {
    if (!connections) return [];
    return Array.isArray(connections) ? connections : Object.values(connections);
  }, [connections]);

  const connectedStudents = useMemo(() => {
    return students.filter(s => 
      connectionList.some(c => c.student_id === s.id && (c.status === 'accepted' || c.status === 1))
    );
  }, [students, connectionList]);

  const stats = useMemo(() => {
    const safeSessions = sessions || [];
    const totalMins = safeSessions.reduce((a, s) => a + (s.duration_minutes || 0), 0);
    let scoreSum = 0;
    let scoreCount = 0;
    let selfMins = 0;
    
    for (const s of safeSessions) {
      if (Number(s.eval_type) === 2 && s.score != null && s.score !== '') {
        scoreSum += Number(s.score);
        scoreCount++;
      }
      if (isSelfForm(s.form)) selfMins += s.duration_minutes || 0;
    }
    
    const avgScore = scoreCount > 0 ? Math.round(scoreSum / scoreCount) : 0;
    const activeDays = new Set(safeSessions.map(s => s.date?.split('T')[0])).size;
    const selfRate = totalMins > 0 ? Math.round((selfMins / totalMins) * 100) : 0;
    
    const byDate = {};
    for (const s of safeSessions) {
      const date = s.date?.split('T')[0];
      if (date) {
        byDate[date] = (byDate[date] || 0) + (s.duration_minutes || 0);
      }
    }
    
    const recentDays = [];
    const today = new Date();
    for (let i = 13; i >= 0; i--) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];
      recentDays.push(byDate[dateStr] || 0);
    }
    
    const prevDays = [];
    for (let i = 27; i >= 14; i--) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];
      prevDays.push(byDate[dateStr] || 0);
    }
    
    const recentMins = recentDays.reduce((a, b) => a + b, 0);
    const prevMins = prevDays.reduce((a, b) => a + b, 0);
    const sessionTrend = prevMins > 0 ? Math.round(((recentMins - prevMins) / prevMins) * 100) : 0;
    
    const bySubj = {};
    for (const s of safeSessions) {
      const subj = s.subject || '未分类';
      bySubj[subj] = bySubj[subj] || { scoreSum: 0, scoreCount: 0 };
      if (Number(s.eval_type) === 2 && s.score != null && s.score !== '') {
        bySubj[subj].scoreSum += Number(s.score);
        bySubj[subj].scoreCount++;
      }
    }
    
    const subjectData = Object.entries(bySubj).map(([name, data]) => ({
      name,
      avgScore: data.scoreCount > 0 ? Math.round(data.scoreSum / data.scoreCount) : 0
    }));
    
    const bySubjTime = {};
    for (const s of safeSessions) {
      const subj = s.subject || '未分类';
      bySubjTime[subj] = bySubjTime[subj] || { self: 0, other: 0, total: 0 };
      const mins = s.duration_minutes || 0;
      if (isSelfForm(s.form)) bySubjTime[subj].self += mins;
      else bySubjTime[subj].other += mins;
      bySubjTime[subj].total += mins;
    }
    const subjectTimeData = Object.entries(bySubjTime)
      .map(([name, data]) => ({
        name,
        self: data.self,
        other: data.other,
        total: data.total,
        selfRate: data.total > 0 ? Math.round((data.self / data.total) * 100) : 0
      }))
      .sort((a, b) => b.total - a.total);
    
    return {
      observations: generateObservations(selfRate, subjectTimeData, safeSessions),
      actions: generateActions(safeSessions)
    };
  }, [sessions]);

  const loadSessions = async (studentId) => {
    setLoading(true);
    setError(null);
    try {
      let sessionData = [];
      
      if (!studentId) {
        sessionData = [
          { subject: 'AP微积分AB', subjectCategory: '数学', duration_minutes: 210, eval_type: 2, score: 86, form: '自主学习', category: 1, date: '2026-07-08', time: '10:00' },
          { subject: 'AP微积分AB', subjectCategory: '数学', duration_minutes: 90, eval_type: 2, score: 88, form: '自主学习', category: 3, date: '2026-07-07', time: '14:00' },
          { subject: 'AP英语文学', subjectCategory: '英语', duration_minutes: 220, eval_type: 2, score: 73, form: '校外辅导', category: 1, date: '2026-07-06', time: '09:00' },
          { subject: 'AP英语文学', subjectCategory: '英语', duration_minutes: 80, eval_type: 2, score: 75, form: '自主学习', category: 3, date: '2026-07-05', time: '15:00' },
          { subject: 'AP物理C', subjectCategory: '物理', duration_minutes: 235, eval_type: 2, score: 64, form: '校外辅导', category: 1, date: '2026-07-04', time: '10:00' },
          { subject: 'AP物理C', subjectCategory: '物理', duration_minutes: 120, eval_type: 2, score: 62, form: '自主学习', category: 2, date: '2026-07-03', time: '16:00' },
          { subject: 'AP化学', subjectCategory: '化学', duration_minutes: 160, eval_type: 2, score: 79, form: '自主学习', category: 1, date: '2026-07-02', time: '11:00' },
          { subject: 'AP化学', subjectCategory: '化学', duration_minutes: 80, eval_type: 2, score: 81, form: '自主学习', category: 3, date: '2026-07-01', time: '14:00' },
          { subject: '世界史', subjectCategory: '历史', duration_minutes: 140, eval_type: 2, score: 87, form: '自主学习', category: 1, date: '2026-06-30', time: '09:00' },
          { subject: '世界史', subjectCategory: '历史', duration_minutes: 60, eval_type: 2, score: 85, form: '自主学习', category: 2, date: '2026-06-29', time: '15:00' },
          { subject: 'AP语文', subjectCategory: '语文', duration_minutes: 130, eval_type: 2, score: 80, form: '自主学习', category: 1, date: '2026-06-28', time: '10:00' },
          { subject: 'AP语文', subjectCategory: '语文', duration_minutes: 70, eval_type: 2, score: 78, form: '自主学习', category: 3, date: '2026-06-27', time: '16:00' },
          { subject: 'AP微积分AB', subjectCategory: '数学', duration_minutes: 120, eval_type: 2, score: 84, form: '自主学习', category: 2, date: '2026-06-26', time: '14:00' },
          { subject: 'AP英语文学', subjectCategory: '英语', duration_minutes: 150, eval_type: 2, score: 71, form: '校外辅导', category: 1, date: '2026-06-25', time: '09:00' },
          { subject: 'AP物理C', subjectCategory: '物理', duration_minutes: 180, eval_type: 2, score: 66, form: '校外辅导', category: 1, date: '2026-06-24', time: '11:00' },
          { subject: 'AP化学', subjectCategory: '化学', duration_minutes: 100, eval_type: 2, score: 77, form: '自主学习', category: 2, date: '2026-06-23', time: '15:00' },
          { subject: '世界史', subjectCategory: '历史', duration_minutes: 90, eval_type: 2, score: 86, form: '自主学习', category: 3, date: '2026-06-22', time: '10:00' },
          { subject: 'AP语文', subjectCategory: '语文', duration_minutes: 110, eval_type: 2, score: 79, form: '自主学习', category: 1, date: '2026-06-21', time: '16:00' },
          { subject: 'AP微积分AB', subjectCategory: '数学', duration_minutes: 180, eval_type: 2, score: 82, form: '自主学习', category: 1, date: '2026-06-20', time: '09:00' },
          { subject: 'AP英语文学', subjectCategory: '英语', duration_minutes: 100, eval_type: 2, score: 74, form: '自主学习', category: 3, date: '2026-06-19', time: '14:00' },
          { subject: 'AP物理C', subjectCategory: '物理', duration_minutes: 150, eval_type: 2, score: 63, form: '校外辅导', category: 1, date: '2026-06-18', time: '11:00' },
          { subject: 'AP化学', subjectCategory: '化学', duration_minutes: 120, eval_type: 2, score: 78, form: '自主学习', category: 1, date: '2026-06-17', time: '15:00' },
          { subject: '世界史', subjectCategory: '历史', duration_minutes: 80, eval_type: 2, score: 88, form: '自主学习', category: 2, date: '2026-06-16', time: '10:00' },
          { subject: 'AP语文', subjectCategory: '语文', duration_minutes: 90, eval_type: 2, score: 81, form: '自主学习', category: 3, date: '2026-06-15', time: '16:00' },
          { subject: 'AP微积分AB', subjectCategory: '数学', duration_minutes: 60, eval_type: 2, score: 85, form: '自主学习', category: 3, date: '2026-06-14', time: '14:00' },
          { subject: 'AP英语文学', subjectCategory: '英语', duration_minutes: 180, eval_type: 2, score: 72, form: '校外辅导', category: 1, date: '2026-06-13', time: '09:00' },
          { subject: 'AP物理C', subjectCategory: '物理', duration_minutes: 60, eval_type: 2, score: 65, form: '自主学习', category: 2, date: '2026-06-12', time: '15:00' },
        ];
      } else {
        const { data, error: supabaseError } = await supabase
          .from('learning_sessions')
          .select(`
            id, session_date, start_time, duration_minutes, category, form, eval_type,
            score, course_id, course:course_id(name, subject)
          `)
          .eq('student_id', studentId)
          .order('session_date', { ascending: false })
          .limit(200);

        if (supabaseError) {
          console.error('Supabase error:', supabaseError);
          throw new Error('数据加载失败');
        }

        sessionData = (data || []).map((s) => {
          const courseName = Array.isArray(s.course)
            ? (s.course[0]?.name)
            : s.course?.name;
          return {
            ...s,
            date: String(s.session_date || '').slice(0, 10),
            time: s.start_time ? String(s.start_time).slice(0, 5) : null,
            subject: courseName || (s.course_id ? `课程-${String(s.course_id).slice(0, 8)}` : '未分类'),
            subjectCategory: Array.isArray(s.course)
              ? (s.course[0]?.subject)
              : s.course?.subject || null,
          };
        });
      }
      
      setSessions(sessionData);
    } catch (err) {
      console.error('Failed to load sessions:', err);
      setError(err.message || '加载数据时发生错误');
      setSessions([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSessions(selectedStudent?.id);
  }, [selectedStudent]);

  return (
    <div className="mentor-intelligence">
      <header className="mentor-intelligence__header">
        <div>
          <h1 className="mentor-intelligence__title">学生洞察</h1>
          <p className="mentor-intelligence__subtitle">帮助你快速理解学生状态，做出精准决策</p>
        </div>
        <div className="mentor-intelligence__select">
          <label>选择学生</label>
          <select 
            value={selectedStudent?.id || ''}
            onChange={(e) => {
              const id = e.target.value;
              setSelectedStudent(id ? students.find((s) => s.id === id) || null : null);
            }}
            className="mentor-intelligence__select-input"
          >
            <option value="">使用演示数据</option>
            {connectedStudents.map((s) => (
              <option key={s.id} value={s.id}>{s.full_name || '未命名'}</option>
            ))}
          </select>
        </div>
      </header>

      {loading ? (
        <div className="mentor-intelligence__loading">
          <span>加载中…</span>
        </div>
      ) : error ? (
        <div className="mentor-intelligence__error">
          <span>⚠️ {error}</span>
          <button onClick={() => loadSessions(selectedStudent?.id)} className="mentor-intelligence__retry-btn">
            重试
          </button>
        </div>
      ) : (
        <main className="mentor-intelligence__main">
          <div className="mentor-intelligence__content">
            <HeroInsight student={selectedStudent || { full_name: '演示学生', school_name: '示例学校' }} sessions={sessions} />
            <DiagnosticSection title="工作日与周末学习时长对比及4周波动分析" subtext="学习时长模式与稳定性" animationIndex="2">
              <Chart1LearningDurationPattern sessions={sessions} />
            </DiagnosticSection>
            <DiagnosticSection title="各课程学习时长投入结构分析" subtext="课程投入结构（堆叠水平 Bar）" animationIndex="3">
              <Chart2SubjectInvestmentStructure sessions={sessions} />
            </DiagnosticSection>
            <DiagnosticSection title="各课程学习效率矩阵：投入时长与产出对比" subtext="学习效率矩阵" animationIndex="4">
              <Chart3LearningEfficiencyMatrix sessions={sessions} />
            </DiagnosticSection>
            <DiagnosticSection title="自主学习能力近4周趋势变化" subtext="自主学习能力趋势（Area Chart）" animationIndex="5">
              <Chart4SelfLearningTrend sessions={sessions} />
            </DiagnosticSection>
            <DiagnosticSection title="各课程投入均衡性偏差分析" subtext="课程均衡性偏差（偏差 Bar）" animationIndex="6">
              <Chart5SubjectBalanceDeviation sessions={sessions} />
            </DiagnosticSection>
            <DiagnosticSection title="各课程客观评估练习占比追踪" subtext="练习质量追踪（水平 Bar + 目标线）" animationIndex="7">
              <Chart6PracticeQualityTracking sessions={sessions} />
            </DiagnosticSection>
            <DiagnosticSection title="学习时间在周各天、各时段的分布热力图" subtext="周学习热力分布（日历热力图）" animationIndex="8">
              <Chart7WeeklyHeatDistribution sessions={sessions} />
            </DiagnosticSection>
          </div>
          <ContextPanel observations={stats.observations} actions={stats.actions} />
        </main>
      )}
    </div>
  );
}