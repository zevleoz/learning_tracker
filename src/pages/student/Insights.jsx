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

const HEAT_WEEKS_MAX = 26;   // 热力图最长 26 周（约一个学期）
const CALENDAR_WEEKS = 6;    // 记录不满 6 周时用日历，避免一大片空格子
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

function weeksBetween(mondayA, mondayB) {
  const [y1, m1, d1] = mondayA.split('-').map(Number);
  const [y2, m2, d2] = mondayB.split('-').map(Number);
  return Math.round((new Date(y2, m2 - 1, d2) - new Date(y1, m1 - 1, d1)) / (7 * 86400000));
}

/**
 * 学习日历 / 热力图，随学生的记录时长「长大」：
 *   - 没有记录：mode 'empty'
 *   - 第一条记录所在周到本周不满 CALENDAR_WEEKS 周：mode 'calendar'（按周成行、带日期）
 *   - 否则：mode 'heat'，从第一条记录所在周开始，最长 HEAT_WEEKS_MAX 周
 * 第一条记录之前的日子标为 before（不着色、不算空白），未来的日子标为 future。
 * level 0–4 按区间内最大值分档；休息日单独标出。
 */
function buildActivity(sessions, todayStr, restDates) {
  const dates = sessions
    .filter((s) => !s.deleted_at)
    .map((s) => s.session_date || s.date)
    .filter(Boolean)
    .sort();
  if (!dates.length) return { mode: 'empty', weeks: 0, days: [] };
  const first = dates[0];
  const thisWeek = weekRange(todayStr);
  const totalWeeks = Math.max(1, weeksBetween(weekRange(first).start, thisWeek.start) + 1);
  const mode = totalWeeks <= CALENDAR_WEEKS ? 'calendar' : 'heat';
  const weeks = Math.min(totalWeeks, HEAT_WEEKS_MAX);
  const start = addDays(thisWeek.start, -(weeks - 1) * 7);
  const days = dailyMinutes(sessions, start, thisWeek.end);
  const max = Math.max(0, ...days.map((d) => d.minutes));
  const rest = new Set(restDates);
  return {
    mode,
    weeks,
    days: days.map((d) => {
      let level = 0;
      if (d.minutes > 0 && max > 0) level = Math.min(4, Math.max(1, Math.ceil((d.minutes / max) * 4)));
      return {
        ...d,
        level,
        before: d.date < first,
        future: d.date > todayStr,
        today: d.date === todayStr,
        rest: d.minutes === 0 && rest.has(d.date),
      };
    }),
  };
}

function cellClass(d) {
  return [
    d.before ? 'before' : '',
    d.future ? 'future' : '',
    d.today ? 'today' : '',
    d.rest ? 'rest' : d.level ? `l${d.level}` : '',
  ].filter(Boolean).join(' ');
}
function cellTitle(d) {
  return `${dayLabel(d.date)} ${d.rest ? '休息' : d.minutes > 0 ? `${d.minutes} 分钟` : '无记录'}`;
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
      activity: buildActivity(sessions, todayStr, streak.restDates),
      subjects: subjectBreakdown(sessions, week),
      calib: calibration(sessions, { weeks: 4, today: todayStr }),
      courseExams,
      hasAny: sessions.length > 0,
    };
  }, [sessions, exams, examCourses, todayStr]);

  if (loading || error) return <PageState loading={loading} error={error} onRetry={reload} />;

  const { cat, streak, daysIn, avg, pending, headline, activity, subjects, calib, courseExams } = view;
  const activeDays = activity.days.filter((d) => !d.future && d.minutes > 0).length;
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

      <section className="sh-card" aria-label="学习日历">
        {activity.mode === 'empty' && (
          <>
            <h2 className="sh-h2">学习日历</h2>
            <p className="sh-empty">记下第一条后，这里会出现你的学习日历。</p>
          </>
        )}
        {activity.mode === 'calendar' && (
          <>
            <h2 className="sh-h2">学习日历 <small>从你的第一条记录开始，已记录 {activeDays} 天</small></h2>
            <div className="sh-cal" role="img" aria-label={`从第一条记录起有 ${activeDays} 天记录`}>
              {['一', '二', '三', '四', '五', '六', '日'].map((w) => <b key={w}>{w}</b>)}
              {activity.days.map((d) => (
                <i key={d.date} className={cellClass(d)} title={cellTitle(d)}>
                  <span>{Number(d.date.slice(8))}</span>
                  {!d.before && !d.future && d.minutes > 0 && <small>{d.minutes}′</small>}
                </i>
              ))}
            </div>
          </>
        )}
        {activity.mode === 'heat' && (
          <>
            <h2 className="sh-h2">{activity.weeks} 周 <small>每格一天，颜色越深记录越多</small></h2>
            <div className="sh-heat-scroll">
              <div className="sh-heat" role="img" aria-label={`近 ${activity.weeks} 周有 ${activeDays} 天记录`}>
                {activity.days.map((d) => (
                  <i key={d.date} className={cellClass(d)} title={cellTitle(d)} />
                ))}
              </div>
            </div>
          </>
        )}
        {activity.mode !== 'empty' && <div className="sh-heat-leg">
          少<i /><i className="l1" /><i className="l2" /><i className="l3" /><i className="l4" />多
          <i className="rest" />休息日
        </div>}
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
