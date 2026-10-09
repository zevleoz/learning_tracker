import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { CalendarDays, CalendarClock, ChevronRight } from 'lucide-react';
import { listUpcomingMeetings, updateE4Student } from '../../lib/e4Store.js';
import { toast } from '../../lib/toast.js';
import { Card, CardContent } from '@/components/ui/card.jsx';
import { Badge } from '@/components/ui/badge.jsx';
import { Button } from '@/components/ui/button.jsx';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog.jsx';
import { DatePicker } from '@/components/ui/date-picker.jsx';

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

function ScheduleDialog({ item, onClose, onSaved }) {
  const [type, setType] = useState('first');
  const [date, setDate] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setType(item?.next_meeting_type === 'progress' ? 'progress' : 'first');
    setDate(item?.next_meeting_date || '');
  }, [item]);

  async function save() {
    setSaving(true);
    try {
      await updateE4Student(item.id, {
        next_meeting_type: type,
        next_meeting_date: date || null,
      });
      toast('下次会议已更新', { kind: 'success' });
      onSaved();
      onClose();
    } catch (err) {
      toast(err.message || '保存失败', { kind: 'error' });
    } finally {
      setSaving(false);
    }
  }

  const typeBtn = (value, label) => (
    <button
      type="button"
      onClick={() => setType(value)}
      className={`flex-1 rounded-md border px-3 py-2 text-[13px] font-medium transition-colors ${
        type === value
          ? 'border-[var(--e4-accent)] bg-[var(--e4-accent-dim)] text-[var(--e4-accent-strong)]'
          : 'border-[var(--e4-line-2)] text-[var(--e4-ink-2)] hover:bg-[var(--e4-bg-3)]'
      }`}
    >
      {label}
    </button>
  );

  return (
    <Dialog open={!!item} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent
        onClose={onClose}
        className="border-[var(--e4-line-2)] bg-[var(--e4-bg-2)] text-[var(--e4-ink)]"
      >
        <DialogHeader>
          <DialogTitle>安排下次会议 · {item?.display_name}</DialogTitle>
          <DialogDescription className="text-[var(--e4-ink-3)]">
            选择会议类型和日期；已服务过的学生可以直接安排进程中复盘
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div>
            <div className="mb-1.5 text-[12.5px] text-[var(--e4-ink-2)]">会议类型</div>
            <div className="flex gap-2">
              {typeBtn('first', '首次会议')}
              {typeBtn('progress', '进程中复盘')}
            </div>
          </div>
          <div>
            <div className="mb-1.5 text-[12.5px] text-[var(--e4-ink-2)]">日期（留空 = 待安排）</div>
            <DatePicker
              value={date}
              onChange={setDate}
              placeholder="待安排"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={saving} className="text-[var(--e4-ink-2)]">
            取消
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? '保存中…' : '保存'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MeetingCard({ item, index, onClick, onWriteReport, onSchedule }) {
  const diff = daysUntil(item.next_meeting_date);
  const overdue = diff !== null && diff < 0;
  const typeLabel = item.next_meeting_type === 'progress' ? '进程中' : '首次';
  // 首次会议日期已到（当天结束或已过）→ 提醒导师补首次会议记录报告
  const needsFirstReport = item.next_meeting_type === 'first' && diff !== null && diff <= 0;

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
            <span className="flex items-center gap-1">
              <button
                type="button"
                title="安排下次会议"
                onClick={(e) => { e.stopPropagation(); onSchedule(); }}
                onKeyDown={(e) => e.stopPropagation()}
                className="rounded-md p-1 text-[var(--e4-ink-3)] transition-colors hover:bg-[var(--e4-accent-dim)] hover:text-[var(--e4-accent-strong)]"
              >
                <CalendarClock size={16} />
              </button>
              <ChevronRight
                size={15}
                className="text-[var(--e4-ink-3)] transition-transform group-hover:translate-x-0.5"
              />
            </span>
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

          {needsFirstReport && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onWriteReport(); }}
              onKeyDown={(e) => e.stopPropagation()}
              className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-left text-[12px] font-medium text-amber-500 transition-colors hover:bg-amber-500/20"
            >
              会议已进行 · 点击填写首次会议记录报告 →
            </button>
          )}

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
  const [scheduleTarget, setScheduleTarget] = useState(null);

  function load() {
    listUpcomingMeetings()
      .then((rows) => { setItems(rows); setError(''); })
      .catch((err) => setError(err.message));
  }

  useEffect(() => {
    load();
  }, []);

  const grouped = useMemo(() => {
    if (!items) return [];
    return GROUPS
      .map((g) => ({ ...g, rows: items.filter((it) => g.match(daysUntil(it.next_meeting_date))) }))
      .filter((g) => g.rows.length > 0);
  }, [items]);

  // 首次会议 → 会前准备工作台；进程中 → 最新报告编辑界面；都没有则回退到学生档案
  function openItem(item) {
    const diff = daysUntil(item.next_meeting_date);
    if (item.next_meeting_type === 'first' && diff !== null && diff <= 0) {
      nav(`/e4/students/${item.id}/new-first`);
    } else if (item.next_meeting_type === 'progress' && item.latest_report_id) {
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
              <MeetingCard
                key={item.id}
                item={item}
                index={i}
                onClick={() => openItem(item)}
                onWriteReport={() => nav(`/e4/students/${item.id}/new-first`)}
                onSchedule={() => setScheduleTarget(item)}
              />
            ))}
          </div>
        </section>
      ))}

      <ScheduleDialog
        item={scheduleTarget}
        onClose={() => setScheduleTarget(null)}
        onSaved={load}
      />
    </div>
  );
}
