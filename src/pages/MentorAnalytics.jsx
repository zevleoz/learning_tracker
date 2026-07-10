import { useState, useEffect, useMemo } from 'react';
import { supabase } from '../lib/supabase';

function fmtMinutes(mins) {
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
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

function getLetterColor(letter) {
  const colors = { 'A': '#10b981', 'A-': '#10b981', 'B+': '#34d399', 'B': '#34d399', 'B-': '#34d399', 'C+': '#f59e0b', 'C': '#f59e0b', 'C-': '#f59e0b', 'D+': '#f97316', 'D': '#f97316', 'F': '#ef4444' };
  return colors[letter] || '#64748b';
}

function StudentOverviewCard({ student, sessions }) {
  const stats = useMemo(() => {
    const totalMins = sessions.reduce((a, s) => a + (s.duration_minutes || 0), 0);
    let scoreSum = 0;
    let scoreCount = 0;
    let selfMins = 0;
    let studyMins = 0;
    let practiceMins = 0;
    
    for (const s of sessions) {
      if (Number(s.eval_type) === 2 && s.score != null && s.score !== '') {
        scoreSum += Number(s.score);
        scoreCount++;
      }
      const mins = s.duration_minutes || 0;
      if (s.form && s.form.includes('自主')) {
        selfMins += mins;
      }
      if (s.category === 1) studyMins += mins;
      else if (s.category === 3) practiceMins += mins;
    }
    
    return { 
      totalMins, 
      avgScore: scoreCount > 0 ? Math.round(scoreSum / scoreCount) : 0, 
      avgLetter: scoreCount > 0 ? scoreToLetter(Math.round(scoreSum / scoreCount)) : '-',
      sessionCount: sessions.length, 
      selfRate: totalMins > 0 ? Math.round((selfMins / totalMins) * 100) : 0,
      studyMins,
      practiceMins,
    };
  }, [sessions]);

  return (
    <div className="ma-overview">
      <div className="ma-overview__student">
        <div className="ma-overview__avatar">{student.full_name?.charAt(0) || 'S'}</div>
        <div className="ma-overview__info">
          <div className="ma-overview__name">{student.full_name || '演示学生'}</div>
          <div className="ma-overview__school">{student.school_name || '示例学校'}</div>
        </div>
      </div>
      <div className="ma-overview__stats">
        <div className="ma-overview__stat">
          <span className="ma-overview__stat-label">学习记录</span>
          <span className="ma-overview__stat-value">{stats.sessionCount}</span>
        </div>
        <div className="ma-overview__stat">
          <span className="ma-overview__stat-label">累计时长</span>
          <span className="ma-overview__stat-value">{fmtMinutes(stats.totalMins)}</span>
        </div>
        <div className="ma-overview__stat">
          <span className="ma-overview__stat-label">平均分数</span>
          <span className="ma-overview__stat-value" style={{ color: getLetterColor(stats.avgLetter) }}>
            {stats.avgScore} <span className="ma-overview__stat-letter" style={{ background: getLetterColor(stats.avgLetter) }}>{stats.avgLetter}</span>
          </span>
        </div>
        <div className="ma-overview__stat">
          <span className="ma-overview__stat-label">自主学习率</span>
          <span className="ma-overview__stat-value">{stats.selfRate}%</span>
          <div className="ma-overview__stat-bar">
            <div className="ma-overview__stat-bar-fill" style={{ width: `${stats.selfRate}%` }}></div>
          </div>
        </div>
        <div className="ma-overview__stat">
          <span className="ma-overview__stat-label">学习时长</span>
          <span className="ma-overview__stat-value">{fmtMinutes(stats.studyMins)}</span>
        </div>
        <div className="ma-overview__stat">
          <span className="ma-overview__stat-label">练习时长</span>
          <span className="ma-overview__stat-value">{fmtMinutes(stats.practiceMins)}</span>
        </div>
      </div>
    </div>
  );
}

function SubjectBarChart({ sessions }) {
  const subjectData = useMemo(() => {
    const bySubj = {};
    for (const s of sessions) {
      const subj = s.subject || '未分类';
      bySubj[subj] = bySubj[subj] || { mins: 0, scoreSum: 0, scoreCount: 0 };
      bySubj[subj].mins += s.duration_minutes || 0;
      if (Number(s.eval_type) === 2 && s.score != null && s.score !== '') {
        bySubj[subj].scoreSum += Number(s.score);
        bySubj[subj].scoreCount++;
      }
    }
    
    const subjects = Object.entries(bySubj).map(([name, data]) => ({
      name,
      duration: data.mins,
      avgScore: data.scoreCount > 0 ? Math.round(data.scoreSum / data.scoreCount) : 0,
    }));
    
    const maxMins = Math.max(...subjects.map(s => s.duration), 1);
    
    return subjects.map(s => ({
      ...s,
      durationScore: Math.min(100, (s.duration / maxMins) * 100),
    }));
  }, [sessions]);

  if (subjectData.length === 0) {
    return <div className="ma-panel"><div className="ma-panel__header"><h3 className="ma-panel__title">科目投入产出对比</h3></div><div className="ma-empty">暂无数据</div></div>;
  }

  const chartWidth = 600;
  const chartHeight = 180;
  const padding = { top: 20, right: 40, bottom: 40, left: 60 };
  const barGap = 8;
  const totalBarWidth = (chartWidth - padding.left - padding.right - (subjectData.length - 1) * barGap) / subjectData.length;
  const singleBarWidth = totalBarWidth / 2 - 2;

  return (
    <div className="ma-panel">
      <div className="ma-panel__header">
        <h3 className="ma-panel__title">科目投入产出对比</h3>
        <span className="ma-panel__subtitle">{subjectData.length} 个科目</span>
      </div>
      <div className="ma-bar-chart">
        <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} className="ma-svg">
          {[0, 25, 50, 75, 100].map(val => {
            const y = padding.top + ((100 - val) / 100) * (chartHeight - padding.top - padding.bottom);
            return (
              <g key={val}>
                <line x1={padding.left} y1={y} x2={chartWidth - padding.right} y2={y} stroke="#f1f5f9" strokeWidth="1" />
                <text x={padding.left - 8} y={y + 4} textAnchor="end" fontSize="10" fill="#64748b">{val}</text>
              </g>
            );
          })}
          {subjectData.map((s, i) => {
            const x = padding.left + i * (totalBarWidth + barGap);
            const durationHeight = (s.durationScore / 100) * (chartHeight - padding.top - padding.bottom);
            const scoreHeight = (s.avgScore / 100) * (chartHeight - padding.top - padding.bottom);
            return (
              <g key={i}>
                <rect x={x} y={chartHeight - padding.bottom - durationHeight} width={singleBarWidth} height={durationHeight} fill="#6366f1" rx="4" />
                <rect x={x + singleBarWidth + 4} y={chartHeight - padding.bottom - scoreHeight} width={singleBarWidth} height={scoreHeight} fill="#10b981" rx="4" />
                <text x={x + singleBarWidth / 2} y={chartHeight - padding.bottom - durationHeight - 6} textAnchor="middle" fontSize="9" fill="#6366f1" fontWeight={600}>{Math.round(s.durationScore)}</text>
                <text x={x + singleBarWidth + 4 + singleBarWidth / 2} y={chartHeight - padding.bottom - scoreHeight - 6} textAnchor="middle" fontSize="9" fill="#10b981" fontWeight={600}>{s.avgScore}</text>
                <text x={x + totalBarWidth / 2} y={chartHeight - 8} textAnchor="middle" fontSize="11" fill="#334155" fontWeight={600}>{s.name}</text>
              </g>
            );
          })}
        </svg>
        <div className="ma-bar-chart__legend">
          <div className="ma-legend__item"><span className="ma-legend__color" style={{ background: '#6366f1' }}></span><span>学习时长</span></div>
          <div className="ma-legend__item"><span className="ma-legend__color" style={{ background: '#10b981' }}></span><span>分数表现</span></div>
        </div>
        <div className="ma-bar-chart__values">
          {subjectData.map((s, i) => (
            <div key={i} className="ma-bar-chart__value-item">
              <span className="ma-bar-chart__value-name">{s.name}</span>
              <span className="ma-bar-chart__value-duration">{fmtMinutes(s.duration)}</span>
              <span className="ma-bar-chart__value-score" style={{ color: getLetterColor(scoreToLetter(s.avgScore)) }}>
                {s.avgScore}分 <span style={{ background: getLetterColor(scoreToLetter(s.avgScore)) }}>{scoreToLetter(s.avgScore)}</span>
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function SubjectComparisonMatrix({ sessions }) {
  const [sortField, setSortField] = useState('duration');
  const [sortDir, setSortDir] = useState('desc');

  const subjectData = useMemo(() => {
    const bySubj = {};
    for (const s of sessions) {
      const subj = s.subject || '未分类';
      bySubj[subj] = bySubj[subj] || { mins: 0, scoreSum: 0, scoreCount: 0, selfMins: 0, studyMins: 0, reviewMins: 0, practiceMins: 0 };
      bySubj[subj].mins += s.duration_minutes || 0;
      if (Number(s.eval_type) === 2 && s.score != null && s.score !== '') {
        bySubj[subj].scoreSum += Number(s.score);
        bySubj[subj].scoreCount++;
      }
      if (s.form && s.form.includes('自主')) {
        bySubj[subj].selfMins += s.duration_minutes || 0;
      }
      if (s.category === 1) bySubj[subj].studyMins += s.duration_minutes || 0;
      else if (s.category === 2) bySubj[subj].reviewMins += s.duration_minutes || 0;
      else if (s.category === 3) bySubj[subj].practiceMins += s.duration_minutes || 0;
    }
    
    const totalMins = Object.values(bySubj).reduce((sum, d) => sum + d.mins, 0);
    
    return Object.entries(bySubj).map(([name, data]) => {
      const avgScore = data.scoreCount > 0 ? Math.round(data.scoreSum / data.scoreCount) : 0;
      const letter = scoreToLetter(avgScore);
      return {
        name,
        duration: data.mins,
        pct: totalMins > 0 ? Math.round((data.mins / totalMins) * 100) : 0,
        studyMins: data.studyMins,
        reviewMins: data.reviewMins,
        practiceMins: data.practiceMins,
        avgScore,
        letter,
        selfRate: data.mins > 0 ? Math.round((data.selfMins / data.mins) * 100) : 0,
      };
    }).sort((a, b) => {
      const valA = a[sortField];
      const valB = b[sortField];
      return sortDir === 'asc' ? valA - valB : valB - valA;
    });
  }, [sessions, sortField, sortDir]);

  const handleSort = (field) => {
    if (sortField === field) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir('desc');
    }
  };

  const totalMins = subjectData.reduce((sum, s) => sum + s.duration, 0);

  if (subjectData.length === 0) {
    return <div className="ma-panel"><div className="ma-panel__header"><h3 className="ma-panel__title">科目对比矩阵</h3></div><div className="ma-empty">暂无数据</div></div>;
  }

  return (
    <div className="ma-panel">
      <div className="ma-panel__header">
        <h3 className="ma-panel__title">科目对比矩阵</h3>
        <span className="ma-panel__subtitle">共 {subjectData.length} 个科目，总计 {fmtMinutes(totalMins)}</span>
      </div>
      <div className="ma-matrix">
        <table className="ma-matrix__table">
          <colgroup>
            <col style={{ width: '14%' }} />
            <col style={{ width: '24%' }} />
            <col style={{ width: '18%' }} />
            <col style={{ width: '16%' }} />
            <col style={{ width: '14%' }} />
            <col style={{ width: '14%' }} />
          </colgroup>
          <thead>
            <tr>
              <th onClick={() => handleSort('name')} className={`ma-matrix__th--sortable ${sortField === 'name' ? 'ma-matrix__th--sorted' : ''}`}>科目名称 {sortField === 'name' && (sortDir === 'asc' ? '↑' : '↓')}</th>
              <th onClick={() => handleSort('duration')} className={`ma-matrix__th--sortable ${sortField === 'duration' ? 'ma-matrix__th--sorted' : ''}`}>学习时长 {sortField === 'duration' && (sortDir === 'asc' ? '↑' : '↓')}</th>
              <th>占比</th>
              <th onClick={() => handleSort('avgScore')} className={`ma-matrix__th--sortable ${sortField === 'avgScore' ? 'ma-matrix__th--sorted' : ''}`}>客观评价 {sortField === 'avgScore' && (sortDir === 'asc' ? '↑' : '↓')}</th>
              <th>主观评价</th>
              <th onClick={() => handleSort('selfRate')} className={`ma-matrix__th--sortable ${sortField === 'selfRate' ? 'ma-matrix__th--sorted' : ''}`}>自主率 {sortField === 'selfRate' && (sortDir === 'asc' ? '↑' : '↓')}</th>
            </tr>
          </thead>
          <tbody>
            {subjectData.map((s, i) => {
              const level = s.avgScore >= 85 ? '优秀' : s.avgScore >= 70 ? '良好' : s.avgScore >= 60 ? '一般' : '薄弱';
              const levelColor = getLetterColor(s.letter);
              const totalTypeMins = s.studyMins + s.reviewMins + s.practiceMins;
              const needsAttention = s.avgScore < 70 || s.selfRate < 50;
              return (
                <tr key={i} className={needsAttention ? 'ma-matrix__tr--attention' : ''}>
                  <td className="ma-matrix__name">{s.name}</td>
                  <td className="ma-matrix__duration">
                    <div className="ma-matrix__duration-bar">
                      <div className="ma-matrix__duration-study" style={{ width: totalTypeMins > 0 ? `${(s.studyMins / totalTypeMins) * 100}%` : '0%' }} />
                      <div className="ma-matrix__duration-review" style={{ width: totalTypeMins > 0 ? `${(s.reviewMins / totalTypeMins) * 100}%` : '0%' }} />
                      <div className="ma-matrix__duration-practice" style={{ width: totalTypeMins > 0 ? `${(s.practiceMins / totalTypeMins) * 100}%` : '0%' }} />
                    </div>
                    <span className="ma-matrix__duration-text">{fmtMinutes(s.duration)}</span>
                  </td>
                  <td className="ma-matrix__bar">
                    <div className="ma-matrix__bar-track"><div className="ma-matrix__bar-fill" style={{ width: `${s.pct}%` }} /></div>
                    <span className="ma-matrix__bar-pct">{s.pct}%</span>
                  </td>
                  <td className="ma-matrix__score">
                    <span className="ma-matrix__score-number" style={{ color: levelColor }}>{s.avgScore}</span>
                    <span className="ma-matrix__score-letter" style={{ background: levelColor }}>{s.letter}</span>
                  </td>
                  <td className="ma-matrix__level">
                    <span style={{ background: `${levelColor}15`, color: levelColor }}>{level}</span>
                  </td>
                  <td className="ma-matrix__self">{s.selfRate}%</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="ma-matrix__legend">
          <div className="ma-legend__item"><span className="ma-legend__color" style={{ background: '#6366f1' }}></span><span>学习</span></div>
          <div className="ma-legend__item"><span className="ma-legend__color" style={{ background: '#8b5cf6' }}></span><span>复习</span></div>
          <div className="ma-legend__item"><span className="ma-legend__color" style={{ background: '#ec4899' }}></span><span>练习</span></div>
        </div>
      </div>
    </div>
  );
}

function LearningHeatmap({ sessions }) {
  const [tooltip, setTooltip] = useState(null);
  
  const heatmapData = useMemo(() => {
    const byDate = {};
    for (const s of sessions) {
      const date = s.date?.split('T')[0];
      if (date) {
        byDate[date] = (byDate[date] || 0) + (s.duration_minutes || 0);
      }
    }
    return byDate;
  }, [sessions]);

  const weeks = [];
  const today = new Date();
  const startDate = new Date(today);
  startDate.setDate(startDate.getDate() - 34);
  startDate.setDate(startDate.getDate() - startDate.getDay());

  while (startDate <= today) {
    const week = [];
    for (let i = 0; i < 7; i++) {
      const date = new Date(startDate);
      date.setDate(date.getDate() + i);
      const dateStr = date.toISOString().split('T')[0];
      week.push({ date: dateStr, mins: heatmapData[dateStr] || 0, isFuture: date > today });
    }
    weeks.push(week);
    startDate.setDate(startDate.getDate() + 7);
  }

  const maxMins = Math.max(...weeks.flat().map(d => d.mins), 1);
  const activeDays = weeks.flat().filter(d => d.mins > 0).length;
  const totalMins = weeks.flat().reduce((sum, d) => sum + d.mins, 0);

  const getColor = (mins) => {
    if (mins === 0) return '#f1f5f9';
    const ratio = mins / maxMins;
    if (ratio < 0.25) return '#dcfce7';
    if (ratio < 0.5) return '#bbf7d0';
    if (ratio < 0.75) return '#86efac';
    return '#22c55e';
  };

  const weekdays = ['一', '二', '三', '四', '五', '六', '日'];

  return (
    <div className="ma-panel">
      <div className="ma-panel__header">
        <h3 className="ma-panel__title">学习投入日历</h3>
        <span className="ma-panel__subtitle">最近 5 周</span>
      </div>
      <div className="ma-heatmap">
        <div className="ma-heatmap__summary">
          <div className="ma-heatmap__stat"><span className="ma-heatmap__stat-value">{fmtMinutes(totalMins)}</span><span className="ma-heatmap__stat-label">总学习时长</span></div>
          <div className="ma-heatmap__stat"><span className="ma-heatmap__stat-value">{activeDays}</span><span className="ma-heatmap__stat-label">活跃天数</span></div>
        </div>
        <div className="ma-heatmap__calendar">
          <div className="ma-heatmap__weekdays">
            {weekdays.map((day, i) => (
              <span key={i} className="ma-heatmap__weekday">{day}</span>
            ))}
          </div>
          <div className="ma-heatmap__weeks">
            {weeks.map((week, wi) => (
              <div key={wi} className="ma-heatmap__week">
                {week.map((day, di) => (
                  <div 
                    key={di} 
                    className={`ma-heatmap__cell ${day.isFuture ? 'ma-heatmap__cell--future' : ''}`} 
                    style={{ background: day.isFuture ? '#fff' : getColor(day.mins) }} 
                    onMouseEnter={(e) => {
                      if (!day.isFuture && day.mins > 0) {
                        const rect = e.currentTarget.getBoundingClientRect();
                        setTooltip({
                          date: day.date,
                          mins: day.mins,
                          x: rect.left + rect.width / 2,
                          y: rect.top - 10,
                        });
                      }
                    }}
                    onMouseLeave={() => setTooltip(null)}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
        <div className="ma-heatmap__legend">
          <span>少</span>
          {['#f1f5f9', '#dcfce7', '#bbf7d0', '#86efac', '#22c55e'].map((color, i) => (
            <span key={i} className="ma-heatmap__legend-cell" style={{ background: color }} />
          ))}
          <span>多</span>
        </div>
        {tooltip && (
          <div 
            className="ma-heatmap__tooltip" 
            style={{ left: tooltip.x, top: tooltip.y }}
          >
            <div className="ma-heatmap__tooltip-date">{tooltip.date}</div>
            <div className="ma-heatmap__tooltip-value">{fmtMinutes(tooltip.mins)}</div>
          </div>
        )}
      </div>
    </div>
  );
}

function LearningBehaviorAnalysis({ sessions }) {
  const behaviorData = useMemo(() => {
    let totalMins = 0;
    let studyMins = 0;
    let reviewMins = 0;
    let practiceMins = 0;
    let selfMins = 0;
    let externalMins = 0;
    
    for (const s of sessions) {
      const mins = s.duration_minutes || 0;
      totalMins += mins;
      if (s.category === 1) studyMins += mins;
      else if (s.category === 2) reviewMins += mins;
      else if (s.category === 3) practiceMins += mins;
      if (s.form && s.form.includes('自主')) {
        selfMins += mins;
      } else {
        externalMins += mins;
      }
    }
    
    return {
      totalMins,
      studyMins,
      reviewMins,
      practiceMins,
      selfMins,
      externalMins,
      selfRate: totalMins > 0 ? Math.round((selfMins / totalMins) * 100) : 0,
      studyPct: totalMins > 0 ? Math.round((studyMins / totalMins) * 100) : 0,
      reviewPct: totalMins > 0 ? Math.round((reviewMins / totalMins) * 100) : 0,
      practicePct: totalMins > 0 ? Math.round((practiceMins / totalMins) * 100) : 0,
      sessionCount: sessions.length,
      avgSessionMins: sessions.length > 0 ? Math.round(totalMins / sessions.length) : 0,
    };
  }, [sessions]);

  return (
    <div className="ma-panel">
      <div className="ma-panel__header">
        <h3 className="ma-panel__title">学习行为分析</h3>
        <span className="ma-panel__subtitle">共 {behaviorData.sessionCount} 次学习记录，总计 {fmtMinutes(behaviorData.totalMins)}</span>
      </div>
      <div className="ma-behavior">
        <div className="ma-behavior__section">
          <h4 className="ma-behavior__section-title">学习类型分配</h4>
          <div className="ma-behavior__bars">
            <div className="ma-behavior__bar">
              <div className="ma-behavior__bar-header">
                <span className="ma-behavior__bar-label">学习</span>
                <span className="ma-behavior__bar-value">{fmtMinutes(behaviorData.studyMins)} <span className="ma-behavior__bar-pct">{behaviorData.studyPct}%</span></span>
                <span className="ma-behavior__bar-ideal">理想 40%</span>
              </div>
              <div className="ma-behavior__bar-track">
                <div className="ma-behavior__bar-ideal-line" style={{ left: '40%' }} />
                <div className="ma-behavior__bar-fill" style={{ width: `${behaviorData.studyPct}%`, background: '#6366f1' }} />
              </div>
            </div>
            <div className="ma-behavior__bar">
              <div className="ma-behavior__bar-header">
                <span className="ma-behavior__bar-label">复习</span>
                <span className="ma-behavior__bar-value">{fmtMinutes(behaviorData.reviewMins)} <span className="ma-behavior__bar-pct">{behaviorData.reviewPct}%</span></span>
                <span className="ma-behavior__bar-ideal">理想 30%</span>
              </div>
              <div className="ma-behavior__bar-track">
                <div className="ma-behavior__bar-ideal-line" style={{ left: '30%' }} />
                <div className="ma-behavior__bar-fill" style={{ width: `${behaviorData.reviewPct}%`, background: '#8b5cf6' }} />
              </div>
            </div>
            <div className="ma-behavior__bar">
              <div className="ma-behavior__bar-header">
                <span className="ma-behavior__bar-label">练习</span>
                <span className="ma-behavior__bar-value">{fmtMinutes(behaviorData.practiceMins)} <span className="ma-behavior__bar-pct">{behaviorData.practicePct}%</span></span>
                <span className="ma-behavior__bar-ideal">理想 30%</span>
              </div>
              <div className="ma-behavior__bar-track">
                <div className="ma-behavior__bar-ideal-line" style={{ left: '30%' }} />
                <div className="ma-behavior__bar-fill" style={{ width: `${behaviorData.practicePct}%`, background: '#ec4899' }} />
              </div>
            </div>
          </div>
        </div>
        <div className="ma-behavior__section">
          <h4 className="ma-behavior__section-title">学习来源分配</h4>
          <div className="ma-behavior__donut">
            <div className="ma-behavior__donut-chart">
              <svg viewBox="0 0 120 120" className="ma-svg">
                <circle cx="60" cy="60" r="45" fill="none" stroke="#e2e8f0" strokeWidth="14" />
                <circle cx="60" cy="60" r="45" fill="none" stroke="#10b981" strokeWidth="14" strokeDasharray={`${behaviorData.selfRate * 2.83} 283`} strokeLinecap="round" transform="rotate(-90 60 60)" />
                <circle cx="60" cy="60" r="45" fill="none" stroke="#f59e0b" strokeWidth="14" strokeDasharray={`${(100 - behaviorData.selfRate) * 2.83} 283`} strokeLinecap="round" transform={`rotate(${behaviorData.selfRate * 3.6 - 90} 60 60)`} />
              </svg>
              <div className="ma-behavior__donut-center">
                <div className="ma-behavior__donut-value">{behaviorData.selfRate}%</div>
                <div className="ma-behavior__donut-label">自主学习率</div>
              </div>
            </div>
            <div className="ma-behavior__donut-stats">
              <div className="ma-behavior__donut-stat"><span>自主学习</span><span style={{ color: '#10b981' }}>{fmtMinutes(behaviorData.selfMins)}</span></div>
              <div className="ma-behavior__donut-stat"><span>校外辅导</span><span style={{ color: '#f59e0b' }}>{fmtMinutes(behaviorData.externalMins)}</span></div>
            </div>
          </div>
        </div>
        <div className="ma-behavior__stats">
          <div className="ma-behavior__stat"><span className="ma-behavior__stat-icon">⏱️</span><span className="ma-behavior__stat-value">{fmtMinutes(behaviorData.totalMins)}</span><span className="ma-behavior__stat-label">总时长</span></div>
          <div className="ma-behavior__stat"><span className="ma-behavior__stat-icon">📚</span><span className="ma-behavior__stat-value">{behaviorData.sessionCount}</span><span className="ma-behavior__stat-label">学习次数</span></div>
          <div className="ma-behavior__stat"><span className="ma-behavior__stat-icon">⌛</span><span className="ma-behavior__stat-value">{fmtMinutes(behaviorData.avgSessionMins)}</span><span className="ma-behavior__stat-label">平均时长</span></div>
          <div className="ma-behavior__stat"><span className="ma-behavior__stat-icon">📊</span><span className="ma-behavior__stat-value">{behaviorData.selfRate}%</span><span className="ma-behavior__stat-label">自主率</span></div>
        </div>
      </div>
    </div>
  );
}

function ScoreTrendChart({ sessions }) {
  const [showCount, setShowCount] = useState(5);
  const [selectedSubject, setSelectedSubject] = useState('all');

  const subjects = useMemo(() => {
    const subjs = new Set(sessions.filter(s => Number(s.eval_type) === 2 && s.score != null && s.score !== '').map(s => s.subject));
    return ['all', ...Array.from(subjs).filter(Boolean)];
  }, [sessions]);

  const scoreData = useMemo(() => {
    let filtered = sessions.filter(s => Number(s.eval_type) === 2 && s.score != null && s.score !== '');
    if (selectedSubject !== 'all') {
      filtered = filtered.filter(s => s.subject === selectedSubject);
    }
    return filtered
      .map(s => ({ date: s.date?.split('T')[0] || '', score: Number(s.score), letter: scoreToLetter(Number(s.score)), subject: s.subject }))
      .sort((a, b) => new Date(b.date) - new Date(a.date))
      .slice(0, showCount)
      .reverse();
  }, [sessions, showCount, selectedSubject]);

  if (scoreData.length === 0) {
    return <div className="ma-panel"><div className="ma-panel__header"><h3 className="ma-panel__title">分数趋势</h3></div><div className="ma-empty">暂无数据</div></div>;
  }

  const maxScore = 100;
  const minScore = Math.max(0, Math.min(...scoreData.map(s => s.score)) - 10);
  const padding = 40;
  const chartWidth = 600;
  const chartHeight = 180;

  return (
    <div className="ma-panel">
      <div className="ma-panel__header">
        <h3 className="ma-panel__title">分数趋势</h3>
        <div className="ma-panel__filter">
          <span className="ma-panel__subtitle">最近 {scoreData.length} 次评分</span>
          <div className="ma-trend__filter">
            <select 
              className="ma-trend__filter-select"
              value={selectedSubject}
              onChange={(e) => setSelectedSubject(e.target.value)}
            >
              {subjects.map(subj => (
                <option key={subj} value={subj}>{subj === 'all' ? '全部科目' : subj}</option>
              ))}
            </select>
            <button 
              className={`ma-trend__filter-btn ${showCount === 5 ? 'ma-trend__filter-btn--active' : ''}`}
              onClick={() => setShowCount(5)}
            >
              最近5次
            </button>
            <button 
              className={`ma-trend__filter-btn ${showCount === 10 ? 'ma-trend__filter-btn--active' : ''}`}
              onClick={() => setShowCount(10)}
            >
              最近10次
            </button>
          </div>
        </div>
      </div>
      <div className="ma-trend">
        <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} className="ma-svg">
          {[60, 80].map(score => {
            const y = padding + chartHeight - 2 * padding - ((score - minScore) / (maxScore - minScore)) * (chartHeight - 2 * padding);
            return <line key={score} x1={padding} y1={y} x2={chartWidth - padding} y2={y} stroke="#f59e0b" strokeWidth="1" strokeDasharray="4 4" />;
          })}
          {[0, 25, 50, 75, 100].map(score => {
            const y = padding + chartHeight - 2 * padding - ((score - minScore) / (maxScore - minScore)) * (chartHeight - 2 * padding);
            return <text key={score} x={padding - 8} y={y + 4} textAnchor="end" fontSize="10" fill="#64748b">{score}</text>;
          })}
          <path d={`M ${scoreData.map((s, i) => {
            const x = padding + (i / (scoreData.length - 1)) * (chartWidth - padding * 2);
            const y = padding + chartHeight - 2 * padding - ((s.score - minScore) / (maxScore - minScore)) * (chartHeight - 2 * padding);
            return `${x} ${y}`;
          }).join(' L ')}`} fill="none" stroke="#6366f1" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          {scoreData.map((s, i) => {
            const x = padding + (i / (scoreData.length - 1)) * (chartWidth - padding * 2);
            const y = padding + chartHeight - 2 * padding - ((s.score - minScore) / (maxScore - minScore)) * (chartHeight - 2 * padding);
            const color = getLetterColor(s.letter);
            return (
              <g key={s.date}>
                <circle cx={x} cy={y} r="6" fill={color} />
                <circle cx={x} cy={y} r="3" fill="white" />
                <text x={x} y={chartHeight - 10} textAnchor="middle" fontSize="9" fill="#64748b">{s.date.slice(5)}</text>
                <text x={x} y={y - 12} textAnchor="middle" fontSize="10" fill="#334155" fontWeight={600}>{s.score}</text>
                <text x={x} y={y + 18} textAnchor="middle" fontSize="9" fill={color} fontWeight={600}>{s.letter}</text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}

function EfficiencyTrendChart({ sessions }) {
  const efficiencyData = useMemo(() => {
    const byDate = {};
    for (const s of sessions) {
      const date = s.date?.split('T')[0];
      if (date) {
        byDate[date] = byDate[date] || { mins: 0, scoreSum: 0, scoreCount: 0 };
        byDate[date].mins += s.duration_minutes || 0;
        if (Number(s.eval_type) === 2 && s.score != null && s.score !== '') {
          byDate[date].scoreSum += Number(s.score);
          byDate[date].scoreCount++;
        }
      }
    }
    return Object.entries(byDate).map(([date, data]) => ({
      date,
      mins: data.mins,
      avgScore: data.scoreCount > 0 ? Math.round(data.scoreSum / data.scoreCount) : null,
    })).sort((a, b) => new Date(a.date) - new Date(b.date)).slice(-14);
  }, [sessions]);

  const avgScore = efficiencyData.filter(d => d.avgScore !== null).length > 0
    ? Math.round(efficiencyData.filter(d => d.avgScore !== null).reduce((sum, d) => sum + d.avgScore, 0) / efficiencyData.filter(d => d.avgScore !== null).length)
    : 0;
  const maxMins = Math.max(...efficiencyData.map(d => d.mins), 1);

  if (efficiencyData.length === 0) {
    return <div className="ma-panel"><div className="ma-panel__header"><h3 className="ma-panel__title">学习效率趋势</h3></div><div className="ma-empty">暂无数据</div></div>;
  }

  const padding = 40;
  const chartWidth = 600;
  const chartHeight = 200;

  return (
    <div className="ma-panel">
      <div className="ma-panel__header">
        <h3 className="ma-panel__title">学习效率趋势</h3>
        <span className="ma-panel__subtitle">最近 14 天 · 时长与分数对比</span>
      </div>
      <div className="ma-efficiency">
        <div className="ma-efficiency__info">
          <div className="ma-efficiency__info-item">
            <span className="ma-efficiency__info-icon">💡</span>
            <span className="ma-efficiency__info-text">效率评分 = 分数表现 / 学习时长</span>
          </div>
          <div className="ma-efficiency__info-item">
            <span className="ma-efficiency__info-icon">📈</span>
            <span className="ma-efficiency__info-text">投入高但分数低 = 效率低，需调整方法</span>
          </div>
          <div className="ma-efficiency__info-item">
            <span className="ma-efficiency__info-icon">🎯</span>
            <span className="ma-efficiency__info-text">投入适中但分数高 = 效率高，值得保持</span>
          </div>
        </div>
        <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} className="ma-svg">
          {[0, 25, 50, 75, 100].map(score => {
            const y = padding + ((100 - score) / 100) * (chartHeight - padding * 2);
            return <text key={score} x={padding - 8} y={y + 4} textAnchor="end" fontSize="10" fill="#64748b">{score}</text>;
          })}
          {avgScore > 0 && (
            <line x1={padding} y1={padding + ((100 - avgScore) / 100) * (chartHeight - padding * 2)} x2={chartWidth - padding} y2={padding + ((100 - avgScore) / 100) * (chartHeight - padding * 2)} stroke="#f59e0b" strokeWidth="1" strokeDasharray="4 4" />
          )}
          {efficiencyData.map((d, i) => {
            const x = padding + (i / (efficiencyData.length - 1)) * (chartWidth - padding * 2);
            const barHeight = (d.mins / maxMins) * (chartHeight - padding * 2) * 0.6;
            return (
              <g key={d.date}>
                <rect x={x - 12} y={chartHeight - padding - barHeight} width="24" height={barHeight} fill="#6366f1" fillOpacity="0.6" rx="4" />
                {d.avgScore !== null && (
                  <>
                    <circle cx={x} cy={padding + ((100 - d.avgScore) / 100) * (chartHeight - padding * 2)} r="4" fill="#10b981" />
                    <circle cx={x} cy={padding + ((100 - d.avgScore) / 100) * (chartHeight - padding * 2)} r="2" fill="white" />
                  </>
                )}
                <text x={x} y={chartHeight - 8} textAnchor="middle" fontSize="9" fill="#64748b">{d.date.slice(5)}</text>
              </g>
            );
          })}
        </svg>
        <div className="ma-efficiency__legend">
          <div className="ma-legend__item"><span className="ma-legend__color" style={{ background: '#6366f1' }}></span><span>学习时长</span></div>
          <div className="ma-legend__item"><span className="ma-legend__color" style={{ background: '#10b981' }}></span><span>分数</span></div>
        </div>
      </div>
    </div>
  );
}

function PainPointAnalysis({ sessions }) {
  const painPoints = useMemo(() => {
    const points = [];
    
    const totalMins = sessions.reduce((a, s) => a + (s.duration_minutes || 0), 0);
    const activeDays = new Set(sessions.map(s => s.date?.split('T')[0])).size;
    
    if (activeDays < 10) {
      points.push({
        type: 'warning',
        title: '学习频率不足',
        value: `${activeDays}天`,
        description: `最近30天内仅${activeDays}天有学习记录，学习不够规律`,
        suggestions: ['制定固定的学习时间表，保证每周至少学习5天', '设置每日学习提醒，养成良好的学习习惯'],
      });
    }
    
    const bySubj = {};
    for (const s of sessions) {
      const subj = s.subject || '未分类';
      bySubj[subj] = bySubj[subj] || { scoreSum: 0, scoreCount: 0 };
      if (Number(s.eval_type) === 2 && s.score != null && s.score !== '') {
        bySubj[subj].scoreSum += Number(s.score);
        bySubj[subj].scoreCount++;
      }
    }
    
    Object.entries(bySubj).forEach(([name, data]) => {
      if (data.scoreCount > 0) {
        const avgScore = Math.round(data.scoreSum / data.scoreCount);
        if (avgScore < 70) {
          points.push({
            type: 'warning',
            title: `${name}分数偏低`,
            value: `${avgScore}分`,
            description: `${name}科目平均分数仅${avgScore}分，需要重点关注`,
            suggestions: [`关注${name}学习方法，可能需要调整学习策略`, `增加${name}复习时间，巩固已学知识`],
          });
        }
      }
    });
    
    let selfMins = 0;
    for (const s of sessions) {
      if (s.form === '自主学习' || s.form === '自主复习' || s.form === '自主练习') {
        selfMins += s.duration_minutes || 0;
      }
    }
    const selfRate = totalMins > 0 ? Math.round((selfMins / totalMins) * 100) : 0;
    
    if (selfRate < 50) {
      points.push({
        type: 'warning',
        title: '自主学习率偏低',
        value: `${selfRate}%`,
        description: `自主学习仅占${selfRate}%，依赖校外辅导较多`,
        suggestions: ['鼓励学生独立思考，减少对辅导的依赖', '培养自主学习习惯，设置自主学习目标'],
      });
    }
    
    return points.sort((a, b) => (a.type === 'danger' ? -1 : 0));
  }, [sessions]);

  return (
    <div className="ma-panel">
      <div className="ma-panel__header">
        <h3 className="ma-panel__title">痛点诊断与建议</h3>
        <span className="ma-panel__subtitle">发现 {painPoints.length} 个问题</span>
      </div>
      <div className="ma-pain">
        {painPoints.length === 0 ? (
          <div className="ma-empty">学生学习状态良好，暂无明显痛点</div>
        ) : (
          painPoints.map((point, i) => (
            <div key={i} className={`ma-pain__item ma-pain__item--${point.type}`}>
              <div className="ma-pain__item-emoji">{point.type === 'danger' ? '⚠️' : '💡'}</div>
              <div className="ma-pain__item-priority">{i + 1}</div>
              <div className="ma-pain__item-info">
                <div className="ma-pain__item-title">{point.title}</div>
                <div className="ma-pain__item-description">{point.description}</div>
                <div className="ma-pain__item-suggestions">
                  <div className="ma-pain__item-suggestions-title">改进建议</div>
                  {point.suggestions.map((s, j) => (
                    <div key={j} className="ma-pain__item-suggestion">{j + 1}. {s}</div>
                  ))}
                </div>
              </div>
              <div className="ma-pain__item-value">{point.value}</div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export default function MentorAnalyticsPage({ user, students, connections }) {
  const [selectedStudent, setSelectedStudent] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(false);

  const connectedStudents = students.filter(s => 
    connections && connections.some(c => c.student_id === s.id && c.status === 'accepted')
  );

  const loadSessions = async (studentId) => {
    setLoading(true);
    try {
      let sessionData = [];
      
      if (!studentId) {
        sessionData = [
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
      } else {
        const { data } = await supabase
          .from('study_sessions')
          .select('*')
          .eq('student_id', studentId)
          .order('date', { ascending: false })
          .limit(100);
        sessionData = data || [];
      }
      
      setSessions(sessionData);
    } catch (error) {
      console.error('Failed to load sessions:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSessions(selectedStudent?.id);
  }, [selectedStudent]);

  return (
    <div className="ma-container">
      <div className="ma-header">
        <h1 className="ma-header__title">学生数据分析</h1>
        <p className="ma-header__subtitle">深入分析学生学习行为，精准诊断学习痛点</p>
        <div className="ma-header__select">
          <label className="ma-header__select-label">选择学生：</label>
          <select 
            value={selectedStudent?.id || ''}
            onChange={(e) => {
              const id = e.target.value;
              if (!id) {
                setSelectedStudent(null);
              } else {
                const student = students.find((s) => s.id === id);
                setSelectedStudent(student || null);
              }
            }}
            className="ma-select"
          >
            <option value="">使用演示数据</option>
            {connectedStudents.map((s) => (
              <option key={s.id} value={s.id}>
                {s.full_name || '未命名'}
              </option>
            ))}
          </select>
        </div>
      </div>

      {loading ? (
        <div className="ma-loading">加载中…</div>
      ) : (
        <div className="ma-content">
          <StudentOverviewCard student={selectedStudent || { full_name: '演示学生', school_name: '示例学校' }} sessions={sessions} />
          <SubjectBarChart sessions={sessions} />
          <SubjectComparisonMatrix sessions={sessions} />
          <div className="ma-grid-2">
            <LearningHeatmap sessions={sessions} />
          </div>
          <LearningBehaviorAnalysis sessions={sessions} />
          <ScoreTrendChart sessions={sessions} />
          <EfficiencyTrendChart sessions={sessions} />
          <PainPointAnalysis sessions={sessions} />
        </div>
      )}
    </div>
  );
}