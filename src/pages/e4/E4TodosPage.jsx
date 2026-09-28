import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { CalendarDays, ChevronRight } from 'lucide-react';
import { listUpcomingMeetings } from '../../lib/e4Store.js';
import { Card, CardContent } from '@/components/ui/card.jsx';
import { Badge } from '@/components/ui/badge.jsx';

function formatDate(iso) {
  if (!iso) return '待安排';
  const d = new Date(`${iso}T00:00:00`);
  return d.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'short' });
}

function daysUntil(iso) {
  if (!iso) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const d = new Date(`${iso}T00:00:00`);
  return Math.round((d - today) / 86400000);
}

const GROUPS = [
  { key: 'overdue', title: '已过期', match: (d) => d !== null && d < 0 },
  { key: 'today', title: '今天', match: (d) => d === 0 },
  { key: 'week', title: '未来 7 天', match: (d) => d > 0 && d <= 7 },
  { key: 'later', title: '之后', match: (d) => d > 7 },
  { key: 'unscheduled', title: '待安排', match: (d) => d === null },
];

function MeetingCard({ item, index, onClick }) {
  const diff = daysUntil(item.next_meeting_date);
  const overdue = diff !== null && diff < 0;
  const typeLabel = item.next_meeting_type === 'progress' ? '进程中' : '首次';

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.04, duration: 0.3, ease: [0.32, 0.72, 0, 1] }}
    >
      <Card
        role="button"
        tabIndex={0}
        onClick={onClick}
        onKeyDown={(e) => { if (e.key === 'Enter') onClick(); }}
        className="group h-full cursor-pointer border-[var(--e4-line)] bg-[var(--e4-bg-2)] text-[var(--e4-ink)] shadow-none transition-colors hover:border-[var(--e4-line-2)] hover:bg-[var(--e4-bg-3)]"
      >
        <CardContent className="flex h-full flex-col gap-3 p-4">
          <div className="flex items-center justify-between">
            <Badge
              variant={item.next_meeting_type === 'progress' ? 'secondary' : 'default'}
              className={
                item.next_meeting_type === 'progress'
                  ? 'border-[var(--e4-line-2)] bg-transparent text-[var(--e4-ink-2)] hover:bg-transparent'
                  : 'border-transparent bg-[var(--e4-accent-dim)] text-[var(--e4-accent-strong)] hover:bg-[var(--e4-accent-dim)]'
              }
            >
              {typeLabel}
            </Badge>
            <ChevronRight
              size={15}
              className="text-[var(--e4-ink-3)] transition-transform group-hover:translate-x-0.5"
            />
          </div>

          <div className="flex items-center gap-2.5">
            <span className="e4-student-avatar e4-recent-avatar">{item.display_name?.charAt(0) || '?'}</span>
            <div className="min-w-0">
              <div className="truncate text-[15px] font-semibold">{item.display_name}</div>
              <div className="truncate text-[12px] text-[var(--e4-ink-3)]">
                {[item.grade, item.school].filter(Boolean).join(' · ') || '年级学校未填写'}
              </div>
            </div>
          </div>

          <div className={`mt-auto flex items-center gap-1.5 text-[13px] ${overdue ? 'text-red-400' : 'text-[var(--e4-ink-2)]'}`}>
            <CalendarDays size={14} />
            <span>{formatDate(item.next_meeting_date)}</span>
            {diff === 0 && <span className="font-semibold text-amber-500">· 今天</span>}
            {diff !== null && diff > 0 && <span className="text-[var(--e4-ink-3)]">· {diff} 天后</span>}
            {overdue && <span>· 已过 {-diff} 天</span>}
          </div>

          <div className="border-t border-[var(--e4-line)] pt-2.5 text-[12px] text-[var(--e4-ink-3)]">
            已触达 <span className="font-semibold text-[var(--e4-ink-2)]">{item.touch_count}</span> 次
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

export default function E4TodosPage() {
  const nav = useNavigate();
  const [items, setItems] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    listUpcomingMeetings()
      .then((rows) => { setItems(rows); setError(''); })
      .catch((err) => setError(err.message));
  }, []);

  const grouped = useMemo(() => {
    if (!items) return [];
    return GROUPS
      .map((g) => ({ ...g, rows: items.filter((it) => g.match(daysUntil(it.next_meeting_date))) }))
      .filter((g) => g.rows.length > 0);
  }, [items]);

  // 首次会议 → 会前准备工作台；进程中 → 最新报告编辑界面；都没有则回退到学生档案
  function openItem(item) {
    if (item.next_meeting_type === 'progress' && item.latest_report_id) {
      nav(`/e4/reports/${item.latest_report_id}/build`);
    } else if (item.next_meeting_type === 'first' && item.latest_prep_id) {
      nav(`/e4/prep/${item.latest_prep_id}`);
    } else if (item.latest_report_id) {
      nav(`/e4/reports/${item.latest_report_id}/build`);
    } else {
      nav(`/e4/students/${item.id}`);
    }
  }

  return (
    <div className="e4-page">
      <div className="e4-page-head">
        <div>
          <h1 className="e4-page-title">待办事项</h1>
          <p className="e4-page-subtitle">按时间顺序排列的 upcoming 会议，提醒每位学生的下一次触达</p>
        </div>
      </div>

      {error && <div className="e4-inline-error">{error}</div>}

      {items === null && !error && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-[168px] animate-pulse rounded-xl border border-[var(--e4-line)] bg-[var(--e4-bg-2)]" />
          ))}
        </div>
      )}

      {items && items.length === 0 && (
        <div className="e4-empty">
          <p>暂无待办会议</p>
          <span>新建 E4 学生或生成报告后，下次会议会出现在这里</span>
        </div>
      )}

      {grouped.map((group) => (
        <section key={group.key} className="mb-7">
          <div className="mb-3 flex items-center gap-2">
            <h2 className={`text-[13px] font-semibold tracking-wide ${group.key === 'overdue' ? 'text-red-400' : 'text-[var(--e4-ink-2)]'}`}>
              {group.title}
            </h2>
            <span className="text-[12px] text-[var(--e4-ink-3)]">{group.rows.length}</span>
            <div className="h-px flex-1 bg-[var(--e4-line)]" />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {group.rows.map((item, i) => (
              <MeetingCard key={item.id} item={item} index={i} onClick={() => openItem(item)} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
