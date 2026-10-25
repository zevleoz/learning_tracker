import { useMemo } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { toLocalDateStr } from '../../lib/date.js';
import {
  weekRange, minutesByCategory, weekOverWeek, computeStreak, pendingObjective,
} from '../../lib/studentStats.js';
import { recentCombos } from '../../lib/sessionRules.js';
import {
  useStudentData, openLogSheet, fmtHM, courseName, CATEGORY_LABEL,
} from '../../lib/useStudentData.js';
import '../../styles/student-home.css';

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const CIRC = 2 * Math.PI * 45;
const CAT_CLASS = { 1: 'd-study', 2: 'd-review', 3: 'd-practice' };

function greeting(now) {
  const h = now.getHours();
  if (h < 5) return '夜深了';
  if (h < 11) return '早上好';
  if (h < 13) return '中午好';
  if (h < 18) return '下午好';
  return '晚上好';
}

function Ring({ study, review, practice, total }) {
  const sum = study + review + practice;
  let offset = 0;
  const arcs = [['var(--sh-study)', study], ['var(--sh-review)', review], ['var(--sh-practice)', practice]]
    .filter(([, v]) => v > 0 && sum > 0)
    .map(([color, v]) => {
      const len = (v / sum) * CIRC;
      const arc = { color, len, offset };
      offset += len;
      return arc;
    });
  return (
    <div className="sh-ring" role="img" aria-label={`本周共 ${fmtHM(total)}`}>
      <svg viewBox="0 0 104 104" aria-hidden="true">
        <circle cx="52" cy="52" r="45" fill="none" stroke="var(--sh-sunken)" strokeWidth="10" />
        {arcs.map((a) => (
          <circle
            key={a.color} cx="52" cy="52" r="45" fill="none" stroke={a.color} strokeWidth="10"
            strokeDasharray={`${a.len} ${CIRC - a.len}`} strokeDashoffset={-a.offset}
          />
        ))}
      </svg>
      <div className="c"><b>{fmtHM(total)}</b><span>本周</span></div>
    </div>
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

export default function Today({ today: todayProp } = {}) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { loading, error, reload, sessions, pendingInvites, today, profile } = useStudentData({ today: todayProp });
  const todayStr = toLocalDateStr(today);

  const view = useMemo(() => {
    const week = weekRange(todayStr);
    const cat = minutesByCategory(sessions, week);
    const wow = weekOverWeek(sessions, todayStr);
    const streak = computeStreak(sessions, todayStr);
    const pending = pendingObjective(sessions);
    const pendingCourses = [...new Set(pending.map(courseName))].slice(0, 3);
    const todayRows = sessions
      .filter((s) => String(s.session_date).slice(0, 10) === todayStr)
      .sort((a, b) => String(a.start_time || '').localeCompare(String(b.start_time || '')));
    return {
      cat, diff: wow.thisWeek - wow.lastWeekToDate, hasLast: wow.lastWeek > 0,
      streak, pending, pendingCourses, todayRows,
      todayMinutes: todayRows.reduce((n, s) => n + (Number(s.duration_minutes) || 0), 0),
      combos: recentCombos(sessions, 4),
    };
  }, [sessions, todayStr]);

  if (loading || error) return <PageState loading={loading} error={error} onRetry={reload} />;

  const { cat, diff, hasLast, streak, pending, pendingCourses, todayRows, todayMinutes, combos } = view;
  const name = profile?.full_name;
  const todoCount = (pending.length > 0 ? 1 : 0) + (pendingInvites > 0 ? 1 : 0);
  const openLog = (detail) => openLogSheet(navigate, detail, pathname);

  const compare = !hasLast && cat.total === 0
    ? '上周也没有记录，从今天开始。'
    : diff === 0 ? '和上周同期持平'
      : `比上周同期${diff > 0 ? '多' : '少'} ${Math.abs(diff)} 分`;
  const bar = (v) => `${cat.total > 0 ? Math.round((v / cat.total) * 100) : 0}%`;

  return (
    <div className="sh-page">
      <header>
        <p className="sh-eyebrow">{today.getMonth() + 1}月{today.getDate()}日 {WEEKDAYS[today.getDay()]}</p>
        <h1 className="sh-h1">{greeting(today)}{name ? `，${name}` : ''}</h1>
      </header>

      <div className="sh-grid today">
        <section className="sh-card" aria-label="本周">
          <div className="sh-ring-wrap">
            <Ring study={cat.study} review={cat.review} practice={cat.practice} total={cat.total} />
            <div className="sh-cbar">
              {[['学习', cat.study, 'd-study'], ['复习', cat.review, 'd-review'], ['练习', cat.practice, 'd-practice']].map(([label, v, cls]) => (
                <div className="r" key={label}>
                  <span>{label}</span>
                  <div className="sh-track"><i className={cls} style={{ width: bar(v) }} /></div>
                  <span>{fmtHM(v)}</span>
                </div>
              ))}
              <p className="sh-note">{compare}</p>
            </div>
          </div>
          <div className="sh-streak">
            {streak.current > 0 ? (
              <>
                <b>{streak.current}</b> 天连续
                <span>本周还可休息 {streak.restDaysLeftThisWeek} 天</span>
              </>
            ) : (
              <span style={{ marginLeft: 0, color: 'var(--sh-ink-3)' }}>今天记一次，开始计连续天数。</span>
            )}
          </div>
        </section>

        <section className="sh-card" aria-label="待办">
          <h2 className="sh-h2">待办 {todoCount > 0 && <small className="sh-num">{todoCount}</small>}</h2>
          {todoCount === 0 ? (
            <p className="sh-empty">没有待办，客观评价都已补齐。</p>
          ) : (
            <div className="sh-list">
              {pending.length > 0 && (
                <Link className="sh-li" to="/records?tab=pending">
                  <i className="sh-dot" style={{ background: 'var(--sh-brass-fill)' }} />
                  <div className="t">
                    <b>{pending.length} 条练习待补填客观评价</b>
                    <span>{pendingCourses.join(' · ')}</span>
                  </div>
                  <span className="chev" aria-hidden="true">›</span>
                </Link>
              )}
              {pendingInvites > 0 && (
                <Link className="sh-li" to="/me">
                  <i className="sh-dot" style={{ background: 'var(--sh-crest)' }} />
                  <div className="t">
                    <b>{pendingInvites === 1 ? '有一位导师想查看你的学习数据' : `有 ${pendingInvites} 位导师想查看你的学习数据`}</b>
                    <span>接受前可以看清对方能看到什么</span>
                  </div>
                  <span className="chev" aria-hidden="true">›</span>
                </Link>
              )}
            </div>
          )}
        </section>

        <section className="sh-card sh-wide" aria-label="今天">
          <h2 className="sh-h2">今天 {todayMinutes > 0 && <small className="sh-num">{todayMinutes}′</small>}</h2>
          {todayRows.length === 0 ? (
            <div className="sh-empty">
              今天还没有记录。
              <div><button type="button" className="sh-link" onClick={() => openLog({})}>记一次</button></div>
            </div>
          ) : (
            <div>
              {todayRows.map((s) => (
                <div className="sh-rec" key={s.id}>
                  <time>{String(s.start_time || '').slice(0, 5) || '—'}</time>
                  <div className="md">
                    <b>{courseName(s)}</b>
                    <span>{CATEGORY_LABEL[s.category] || ''}{s.form ? ` · ${s.form}` : ''}</span>
                  </div>
                  <div className="rt">{s.duration_minutes}′</div>
                </div>
              ))}
            </div>
          )}

          {combos.length > 0 && (
            <>
              <h2 className="sh-h2" style={{ marginTop: 16 }}>再记一次 <small>按你的习惯，点一下预填</small></h2>
              <div className="sh-chips">
                {combos.map((c) => (
                  <button
                    key={c.key} type="button" className="sh-chip"
                    onClick={() => openLog({
                      courseId: c.courseId, category: c.category, form: c.form,
                      durationMinutes: c.durationMinutes, chapterId: c.chapterId, unitId: c.unitId,
                    })}
                  >
                    <i className={`sh-dot ${CAT_CLASS[c.category] || ''}`} />
                    {c.courseName || '课程'} · {CATEGORY_LABEL[c.category]} <small>{c.durationMinutes}′</small>
                  </button>
                ))}
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
