import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { listE4Students } from '../../lib/e4Store.js';

function IconPlus() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function IconSearch() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

function IconChevron() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

function IconSort({ asc }) {
  return (
    <svg
      className="e4-th-arrow"
      width="11"
      height="11"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ transform: asc ? 'rotate(180deg)' : 'none' }}
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

function SkeletonRows() {
  const bars = [
    [92, 38, 88, 120, 72],
    [76, 44, 104, 96, 64],
    [104, 36, 80, 128, 80],
    [84, 40, 96, 112, 68],
    [96, 42, 112, 104, 76],
  ];
  return (
    <>
      {bars.map((w, i) => (
        <tr key={i} className="e4-table-row" aria-hidden="true">
          <td>
            <div className="e4-table-student">
              <span className="e4-skeleton" style={{ width: 28, height: 28, borderRadius: 7 }} />
              <span className="e4-skeleton" style={{ width: w[0], height: 12 }} />
            </div>
          </td>
          <td><span className="e4-skeleton" style={{ width: w[1], height: 11 }} /></td>
          <td><span className="e4-skeleton" style={{ width: w[2], height: 11 }} /></td>
          <td><span className="e4-skeleton" style={{ width: w[3], height: 11 }} /></td>
          <td><span className="e4-skeleton" style={{ width: w[4], height: 11 }} /></td>
          <td />
        </tr>
      ))}
    </>
  );
}

function SortableTh({ label, className, col, sort, onSort }) {
  const active = sort.key === col;
  return (
    <th className={`${className || ''} ${active ? 'is-sorted' : ''}`}>
      <button
        type="button"
        className="e4-th-btn"
        onClick={() => onSort(col)}
        aria-label={`按${label}排序`}
      >
        {label}
        <IconSort asc={active && sort.dir === 'asc'} />
      </button>
    </th>
  );
}

function LinkState({ linked, primary, secondary }) {
  return (
    <span className={`e4-link-state ${linked ? 'is-on' : 'is-off'}`}>
      <span className="e4-link-dot" />
      <span className="e4-link-text">
        {linked ? primary || '已关联' : '未关联'}
        {linked && secondary && <em>{secondary}</em>}
      </span>
    </span>
  );
}

export default function E4StudentListPage() {
  const nav = useNavigate();
  const [students, setStudents] = useState(null);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState({ key: null, dir: 'asc' });

  function load() {
    listE4Students()
      .then((rows) => {
        setStudents(rows);
        setError('');
      })
      .catch((err) => setError(err.message));
  }

  useEffect(() => {
    load();
  }, []);

  function toggleSort(col) {
    setSort((prev) => {
      if (prev.key !== col) return { key: col, dir: 'asc' };
      if (prev.dir === 'asc') return { key: col, dir: 'desc' };
      return { key: null, dir: 'asc' };
    });
  }

  const filtered = useMemo(() => {
    if (!students) return [];
    const q = query.trim().toLowerCase();
    let rows = students;
    if (q) {
      rows = rows.filter((s) =>
        [s.display_name, s.grade, s.school, s.y4_student_name]
          .some((v) => String(v || '').toLowerCase().includes(q))
      );
    }
    if (sort.key) {
      const dir = sort.dir === 'asc' ? 1 : -1;
      rows = [...rows].sort((a, b) => {
        const va = String(a[sort.key === 'name' ? 'display_name' : 'grade'] || '');
        const vb = String(b[sort.key === 'name' ? 'display_name' : 'grade'] || '');
        return va.localeCompare(vb, 'zh-Hans-CN') * dir;
      });
    }
    return rows;
  }, [students, query, sort]);

  return (
    <div className="e4-page">
      <div className="e4-page-head">
        <div>
          <h1 className="e4-page-title">学生中心</h1>
          <p className="e4-page-subtitle">为每位学生建立 E4 档案，关联 Y4 测评并生成学习力分析报告</p>
        </div>
        <button type="button" className="e4-btn-primary" onClick={() => nav('/e4/new')}>
          <IconPlus />
          <span>新建 E4 学生</span>
        </button>
      </div>

      <div className="e4-toolbar">
        <div className="e4-search-wrap">
          <IconSearch />
          <input
            className="e4-search-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索学生姓名、年级或 Y4 姓名"
          />
        </div>
        {students && students.length > 0 && (
          <span className="e4-toolbar-count">
            共 <strong>{students.length}</strong> 位学生{query.trim() && ` · 匹配 ${filtered.length}`}
          </span>
        )}
      </div>

      {error && <div className="e4-inline-error">{error}</div>}

      {students === null && !error && (
        <div className="e4-table-card">
          <table className="e4-table">
            <thead>
              <tr>
                <th className="col-student">学生</th>
                <th className="col-grade">年级</th>
                <th className="col-school">学校</th>
                <th className="col-y4">Y4 测评</th>
                <th className="col-tracker">一表人才</th>
                <th className="col-action" aria-label="查看" />
              </tr>
            </thead>
            <tbody>
              <SkeletonRows />
            </tbody>
          </table>
        </div>
      )}

      {students && students.length === 0 && (
        <div className="e4-empty">
          <p>还没有 E4 学生档案</p>
          <span>建立第一位学生的 E4 档案，之后手动关联对应的 Y4 报告</span>
          <button type="button" className="e4-btn-primary e4-empty-action" onClick={() => nav('/e4/new')}>
            <IconPlus />
            <span>新建 E4 学生</span>
          </button>
        </div>
      )}

      {students && students.length > 0 && filtered.length === 0 && (
        <div className="e4-list-hint">没有匹配的学生</div>
      )}

      {filtered.length > 0 && (
        <motion.div
          className="e4-table-card"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.28, ease: [0.32, 0.72, 0, 1] }}
        >
          <table className="e4-table">
            <thead>
              <tr>
                <SortableTh label="学生" className="col-student" col="name" sort={sort} onSort={toggleSort} />
                <SortableTh label="年级" className="col-grade" col="grade" sort={sort} onSort={toggleSort} />
                <th className="col-school">学校</th>
                <th className="col-y4">Y4 测评</th>
                <th className="col-tracker">一表人才</th>
                <th className="col-action" aria-label="查看" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((s) => (
                <tr
                  key={s.id}
                  className="e4-table-row"
                  onClick={() => nav(`/e4/students/${s.id}`)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => { if (e.key === 'Enter') nav(`/e4/students/${s.id}`); }}
                >
                  <td>
                    <div className="e4-table-student">
                      <span className="e4-student-avatar e4-table-avatar">{s.display_name?.charAt(0) || '?'}</span>
                      <span className="e4-table-name">{s.display_name}</span>
                    </div>
                  </td>
                  <td className="e4-table-cell-muted">{s.grade || '—'}</td>
                  <td className="e4-table-cell-muted">{s.school || '—'}</td>
                  <td>
                    {s.y4_report_id ? (
                      <LinkState linked primary="已关联" secondary={s.y4_student_name ? `${s.y4_student_name} · #${s.y4_report_id}` : `#${s.y4_report_id}`} />
                    ) : (
                      <LinkState />
                    )}
                  </td>
                  <td>
                    {s.tracker_profile_id
                      ? <LinkState linked primary={s.tracker?.full_name || '已关联'} />
                      : <span className="e4-table-cell-muted">—</span>}
                  </td>
                  <td className="col-action"><span className="e4-table-chevron"><IconChevron /></span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </motion.div>
      )}
    </div>
  );
}
