import { useMemo } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { toLocalDateStr } from '../../lib/date.js';
import {
  weekRange, minutesByCategory, dailyMinutes, computeStreak, pendingObjective,
  subjectBreakdown, calibration, headlineInsight, OBJECTIVE_STEPS,
} from '../../lib/studentStats.js';
import { SUBJECTIVE_STEPS } from '../../lib/rating.js';
import { useStudentData, openLogSheet, fmtHM, fmtDuration } from '../../lib/useStudentData.js';
import '../../styles/student-home.css';

const HEAT_WEEKS = 26;
const VERDICT_CLASS = { 一致: 'ok', 偏乐观: 'warn', 偏保守: 'flat' };

function addDays(str, n) {
  const [y, m, d] = str.split('-').map(Number);
  return toLocalDateStr(new Date(y, m - 1, d + n));
}
function mondayIndex(str) {
  const [y, m, d] = str.split('-').map(Number);
  return (new Date(y, m - 1, d).getDay() + 6) % 7;
}
function nearest(steps, v) {
  return steps.reduce((best, s) => (Math.abs(s.value - v) < Math.abs(best.value - v) ? s : best), steps[0]);
}
function dayLabel(str) {
  const [, m, d] = str.split('-').map(Number);
  return `${m}月${d}日`;
}

/** 26 周 × 7 天，列 = 周（周一在上）。level 0–4 按区间内最大值分档；休息日单独标出。 */
function buildHeat(sessions, todayStr, restDates) {
  const start = addDays(weekRange(todayStr).start, -(HEAT_WEEKS - 1) * 7);
  const end = weekRange(todayStr).end;
  const days = dailyMinutes(sessions, start, end);
  const max = Math.max(0, ...days.map((d) => d.minutes));
  const rest = new Set(restDates);
  return days.map((d) => {
    let level = 0;
    if (d.minutes > 0 && max > 0) level = Math.min(4, Math.max(1, Math.ceil((d.minutes / max) * 4)));
    return {
      ...d, level, future: d.date > todayStr, rest: d.minutes === 0 && rest.has(d.date),
    };
  });
}

function Sparkline({ points }) {
  if (points.length < 2) return null;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const xy = points.map((p, i) => [
    (i / (points.length - 1)) * 256 + 2,
    52 - ((p - min) / span) * 44 - 2,
  ]);
  const last = xy[xy.length - 1];
  return (
    <svg className="sh-spark" viewBox="0 0 260 56" preserveAspectRatio="none" aria-hidden="true">
      <polyline points={xy.map((p) => p.join(',')).join(' ')} />
      <circle cx={last[0]} cy={last[1]} r="3" />
    </svg>
  );
}

function PageState({ loading, error, onRetry }) {
  if (loading) {
    return (
      <div className="sh-page" aria-busy="true" aria-label="正在加载">
        <div className="sh-skel" /><div className="sh-skel" />
      </div>
    );
  }
  return (
    <div className="sh-page">
      <div className="sh-card sh-state" role="alert">
        <b>没能加载你的记录</b>
        请检查网络后重试。
        <div><button type="button" className="sh-link" onClick={onRetry}>重试</button></div>
      </div>
    </div>
  );
}

export default function Insights({ today: todayProp } = {}) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const {
    loading, error, reload, sessions, exams, examCourses, today,
  } = useStudentData({ today: todayProp });
  const todayStr = toLocalDateStr(today);

  const view = useMemo(() => {
    const week = weekRange(todayStr);
    const cat = minutesByCategory(sessions, week);
    const streak = computeStreak(sessions, todayStr);
    const daysIn = mondayIndex(todayStr) + 1;
    const courseExams = examCourses
      .map((c) => {
        const rows = exams
          .filter((e) => e.course_id === c.id && Number.isFinite(Number(e.score)) && e.score !== null)
          .sort((a, b) => String(a.exam_date).localeCompare(String(b.exam_date)));
        return { course: c, rows };
      })
      .filter((x) => x.rows.length > 0);
    return {
      cat, streak, daysIn,
      avg: Math.round(cat.total / daysIn),
      pending: pendingObjective(sessions).length,
      headline: headlineInsight(sessions, todayStr),
      heat: buildHeat(sessions, todayStr, streak.restDates),
      subjects: subjectBreakdown(sessions, week),
      calib: calibration(sessions, { weeks: 4, today: todayStr }),
      courseExams,
      hasAny: sessions.length > 0,
    };
  }, [sessions, exams, examCourses, todayStr]);

  if (loading || error) return <PageState loading={loading} error={error} onRetry={reload} />;

  const { cat, streak, daysIn, avg, pending, headline, heat, subjects, calib, courseExams } = view;
  const heatDays = heat.filter((d) => !d.future);
  const activeDays = heatDays.filter((d) => d.minutes > 0).length;
  const maxSubject = Math.max(1, ...subjects.map((s) => s.total));

  return (
    <div className="sh-page">
      <header>
        <p className="sh-eyebrow">本周 {dayLabel(weekRange(todayStr).start)}–{dayLabel(weekRange(todayStr).end)}</p>
        <h1 className="sh-h1">洞察</h1>
      </header>

      <div className="sh-grid two">
        <section className="sh-card" aria-label="本周重点">
          <p className="sh-eyebrow">本周重点</p>
          <p className="sh-ins">{headline.title}</p>
          <p className="sh-note" style={{ marginTop: 6 }}>{headline.detail}</p>
          {headline.action && (
            <button
              type="button" className="sh-link" style={{ marginTop: 10 }}
              onClick={() => openLogSheet(navigate, headline.action.log || {}, pathname)}
            >
              {headline.action.label} ›
            </button>
          )}
        </section>

        <section className="sh-card sh-stats" aria-label="统计">
          <div className="sh-stat"><span className="sh-note">本周总时长</span><b>{fmtHM(cat.total)}</b></div>
          <div className="sh-stat"><span className="sh-note">日均（本周 {daysIn} 天）</span><b>{avg}′</b></div>
          <div className="sh-stat streak"><span className="sh-note">连续记录</span><b>{streak.current} 天</b></div>
          <div className="sh-stat">
            <span className="sh-note">待补填</span>
            <b>{pending > 0 ? <Link to="/records?tab=pending">{pending}</Link> : 0}</b>
          </div>
        </section>
      </div>

      <section className="sh-card" aria-label="26 周">
        <h2 className="sh-h2">26 周 <small>每格一天，颜色越深记录越多</small></h2>
        <div className="sh-heat-scroll">
          <div className="sh-heat" role="img" aria-label={`近 26 周有 ${activeDays} 天记录`}>
            {heat.map((d) => (
              <i
                key={d.date}
                className={[d.future ? 'future' : '', d.rest ? 'rest' : d.level ? `l${d.level}` : ''].filter(Boolean).join(' ')}
                title={`${dayLabel(d.date)} ${d.rest ? '休息' : d.minutes > 0 ? `${d.minutes} 分钟` : '无记录'}`}
              />
            ))}
          </div>
        </div>
        <div className="sh-heat-leg">
          少<i /><i className="l1" /><i className="l2" /><i className="l3" /><i className="l4" />多
          <i className="rest" />休息日
        </div>
      </section>

      <div className="sh-grid two">
        <section className="sh-card" aria-label="科目分布">
          <h2 className="sh-h2">科目分布 <small>本周</small></h2>
          {subjects.length === 0 ? (
            <p className="sh-empty">本周还没有记录，记一次就会出现在这里。</p>
          ) : (
            <>
              {subjects.map((s) => (
                <div className="sh-subj" key={s.course}>
                  <span className="name">{s.course}</span>
                  <div className="sh-stack" style={{ width: `${Math.max(8, (s.total / maxSubject) * 100)}%` }}>
                    <i className="d-study" style={{ flex: s.study }} />
                    <i className="d-review" style={{ flex: s.review }} />
                    <i className="d-practice" style={{ flex: s.practice }} />
                  </div>
                  <span className="tot">{fmtDuration(s.total)}</span>
                </div>
              ))}
              <div className="sh-legend">
                <span><i className="sh-dot d-study" />学习</span>
                <span><i className="sh-dot d-review" />复习</span>
                <span><i className="sh-dot d-practice" />练习</span>
              </div>
            </>
          )}
        </section>

        <section className="sh-card" aria-label="自评与实测">
          <h2 className="sh-h2">自评 vs 实测 <small>练习，近 4 周</small></h2>
          {calib.length === 0 ? (
            <p className="sh-empty">补上练习的客观评价后，这里会对比你的自评和实测等第。</p>
          ) : (
            <div className="sh-list">
              {calib.map((c) => {
                const self = nearest(SUBJECTIVE_STEPS, 20 + c.avgSelf * 80).label;
                const grade = OBJECTIVE_STEPS[Math.round(c.avgGrade * 12)].label;
                return (
                  <div className="sh-li" key={c.course}>
                    <div className="t">
                      <b>{c.course}</b>
                      <span>自评 {self} · 实测平均 {grade} · {c.n} 次</span>
                    </div>
                    <span className={`sh-tag ${VERDICT_CLASS[c.verdict]}`}><i className="sh-dot" />{c.verdict}</span>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>

      <section className="sh-card" aria-label="考试趋势">
        <h2 className="sh-h2">考试趋势 <small>校内课程</small></h2>
        {courseExams.length === 0 ? (
          <p className="sh-empty">还没有考试成绩。在记录里录入后，这里会显示每门校内课程的走势。</p>
        ) : (
          courseExams.map(({ course, rows }) => {
            const latest = rows[rows.length - 1];
            return (
              <div className="sh-exam" key={course.id}>
                <div className="sh-exam-head">
                  <div>
                    <b>{course.name}</b>
                    <p className="sh-note">{rows.length} 次考试 · 最近 {dayLabel(String(latest.exam_date).slice(0, 10))}</p>
                  </div>
                  <div className="sh-exam-score">
                    {Number(latest.score)}
                    {latest.grade_label && <small>{latest.grade_label}</small>}
                  </div>
                </div>
                <Sparkline points={rows.map((r) => Number(r.score))} />
              </div>
            );
          })
        )}
      </section>
    </div>
  );
}
