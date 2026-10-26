import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { CalendarDays, CalendarClock, ChevronRight } from 'lucide-react';
import { listUpcomingMeetings, updateE4Student } from '../../lib/e4Store.js';
import {
  daysUntil, groupStudents, filterByScope, reportActionFor, formatMeetingRange, meetingTypeLabel,
} from '../../lib/e4Todos.js';
import { useAuth } from '../../lib/useAuth.js';
import ScopeSwitch, { useE4Scope } from '../../components/e4/ScopeSwitch.jsx';
import { toast } from '../../lib/toast.js';
import { Card, CardContent } from '@/components/ui/card.jsx';
import { Badge } from '@/components/ui/badge.jsx';
import { Button } from '@/components/ui/button.jsx';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog.jsx';
import { DatePicker } from '@/components/ui/date-picker.jsx';
import { useDayKey } from '../../lib/e4DayKey.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function ScheduleDialog({ item, onClose, onSaved }) {
  const [type, setType] = useState('first');
  const [dateRange, setDateRange] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setType(item?.next_meeting_type === 'progress' ? 'progress' : 'first');
    // 档案双列拼回范围串：仅起点时用 'start'（无波浪线，parseRangeValue 也能识别）
    const start = item?.next_meeting_date || '';
    const end = item?.next_meeting_end_date || '';
    setDateRange(start ? (end ? `${start}~${end}` : start) : '');
  }, [item]);

  async function save() {
    setSaving(true);
    try {
      // 拆成两列写回：仅起点时结束日为 null
      const [rawStart, rawEnd] = String(dateRange || '').split('~');
      const start = DATE_RE.test(rawStart || '') ? rawStart : null;
      const end = DATE_RE.test(rawEnd || '') ? rawEnd : null;
      await updateE4Student(item.id, {
        next_meeting_type: type,
        next_meeting_date: start,
        next_meeting_end_date: end,
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
            <div className="mb-1.5 text-[12.5px] text-[var(--e4-ink-2)]">日期范围</div>
            <DatePicker
              range
              value={dateRange}
              onChange={setDateRange}
              placeholder="选择日期范围（留空 = 待安排）"
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

function MeetingCard({ item, index, hot, onClick, onWriteReport, onSchedule }) {
  const diff = daysUntil(item.next_meeting_date);
  const overdue = diff !== null && diff < 0;
  const typeLabel = meetingTypeLabel(item.next_meeting_type);
  // 待写报告组：主操作按会议类型给出（首次会议记录报告 / 过程中报告）
  const action = hot ? reportActionFor(item) : null;

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
        className={`group h-full cursor-pointer bg-[var(--e4-bg-2)] text-[var(--e4-ink)] shadow-none transition-colors hover:bg-[var(--e4-bg-3)] ${
          hot
            ? 'border-amber-500/35 hover:border-amber-500/55'
            : 'border-[var(--e4-line)] hover:border-[var(--e4-line-2)]'
        }`}
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

          <div className="mt-auto flex items-center gap-1.5 text-[13px] text-[var(--e4-ink-2)]">
            <CalendarDays size={14} />
            <span>{formatMeetingRange(item.next_meeting_date, item.next_meeting_end_date)}</span>
            {diff === 0 && <span className="font-semibold text-amber-500 [body.e4-light_&]:text-amber-700">· 今天</span>}
            {diff !== null && diff > 0 && <span className="text-[var(--e4-ink-3)]">· {diff} 天后</span>}
            {overdue && <span className="text-[var(--e4-ink-3)]">· {hot ? `${-diff} 天前` : `已过 ${-diff} 天`}</span>}
          </div>

          {action && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onWriteReport(action.path); }}
              onKeyDown={(e) => e.stopPropagation()}
              className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-center text-[13px] font-semibold text-amber-500 transition-colors hover:bg-amber-500/20 [body.e4-light_&]:text-amber-700"
            >
              {action.label}
            </button>
          )}

          <div className="border-t border-[var(--e4-line)] pt-2.5 text-[12px] text-[var(--e4-ink-3)]">
            已出报告 <span className="font-semibold text-[var(--e4-ink-2)]">{item.touch_count}</span> 份
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

export default function E4TodosPage() {
  const nav = useNavigate();
  const { profile } = useAuth();
  const [scope, setScope] = useE4Scope();
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

  const visible = useMemo(
    () => (items ? filterByScope(items, scope, profile?.id) : null),
    [items, scope, profile?.id],
  );
  // 过了零点后重新分组（daysUntil 读当前时间，需要有东西触发重算）
  const dayKey = useDayKey();
  const grouped = useMemo(() => groupStudents(visible), [visible, dayKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // 首次会议 → 会前准备工作台；进程中 → 最新报告编辑界面；都没有则回退到学生档案
  function openItem(item) {
    const diff = daysUntil(item.next_meeting_date);
    if (item.next_meeting_type === 'first' && diff !== null && diff <= 0) {
      nav(reportActionFor(item).path);
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
          <p className="e4-page-subtitle">会议已过但还没写报告的排在最前；没有日期的归入「待安排」</p>
        </div>
        <ScopeSwitch value={scope} onChange={setScope} />
      </div>

      {error && <div className="e4-inline-error">{error}</div>}

      {items === null && !error && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-[168px] animate-pulse rounded-xl border border-[var(--e4-line)] bg-[var(--e4-bg-2)]" />
          ))}
        </div>
      )}

      {visible && visible.length === 0 && (
        <div className="e4-empty">
          <p>{scope === 'mine' && items.length > 0 ? '你名下暂无待办会议' : '暂无待办会议'}</p>
          <span>
            {scope === 'mine' && items.length > 0
              ? '学生的负责导师不是你；切换到「全部」可查看所有学生'
              : '新建 E4 学生或生成报告后，下次会议会出现在这里'}
          </span>
        </div>
      )}

      {grouped.map((group) => (
        <section key={group.key} className="mb-7">
          <div className="mb-3 flex items-center gap-2">
            <h2 className="text-[13px] font-semibold tracking-wide text-[var(--e4-ink-2)]">
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
                hot={group.key === 'report'}
                onClick={() => openItem(item)}
                onWriteReport={(path) => nav(path)}
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
