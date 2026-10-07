import { motion } from 'framer-motion';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { CATEGORY_COLORS, CATEGORY_NAMES, fmtMins, scoreColor } from './WeekGrid.jsx';

// 主观评价标签：与学员端「记录」页 SUBJECTIVE_STEPS 文案一致
const SUBJECTIVE_LABEL = {
  100: '完全掌握',
  80: '基本掌握',
  60: '有不少没掌握',
  40: '像在听天书',
  20: '没有听课',
};

const WEEKDAY_LABEL = ['日', '一', '二', '三', '四', '五', '六'];

function fmtDayTitle(dateStr) {
  const [y, m, d] = String(dateStr).split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return `${m}月${d}日 周${WEEKDAY_LABEL[date.getDay()]}`;
}

// 元信息之间的分隔符
function Dot() {
  return <span aria-hidden="true" className="text-border">·</span>;
}

// ── 单条记录：时间 | 学科 + 元信息 + 备注 | 时长 + 评价 ──
function RecordRow({ record: r }) {
  const cat = Number(r.category);
  const catColor = CATEGORY_COLORS[cat] || '#94a3b8';
  const catName = CATEGORY_NAMES[cat] || '—';
  const path = [r.chapter?.name, r.unit?.name].filter(Boolean).join(' · ');
  const hasSubjective = r.self_rating != null;
  const hasObjective = cat === 3 && (r.grade_label || r.score != null);

  return (
    <div className="grid grid-cols-[3rem_minmax(0,1fr)_auto] gap-x-3 py-3">
      {/* 时间 */}
      <div className="pt-0.5 font-mono text-xs tabular-nums text-muted-foreground">
        {r.time || ''}
      </div>

      {/* 学科 / 元信息 / 备注 */}
      <div className="min-w-0">
        <div className="text-sm font-medium text-foreground">{r.subject || '未分类'}</div>

        <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className="h-1.5 w-1.5 rounded-full"
              style={{ background: catColor }}
            />
            {catName}
          </span>
          {r.form && <><Dot /><span>{r.form}</span></>}
          {path && <><Dot /><span>{path}</span></>}
        </div>

        {r.notes && (
          <div className="mt-2 rounded-md bg-muted px-2.5 py-2 text-xs leading-relaxed">
            <span className="mr-1.5 font-medium text-muted-foreground">备注</span>
            <span className="whitespace-pre-wrap text-foreground">{r.notes}</span>
          </div>
        )}
      </div>

      {/* 时长 / 评价 */}
      <div className="flex flex-col items-end gap-0.5 text-right">
        <div className="text-sm font-medium tabular-nums text-foreground">
          {fmtMins(r.duration_minutes || 0)}
        </div>
        {hasSubjective && (
          <div className="text-xs text-muted-foreground">
            主观：{SUBJECTIVE_LABEL[r.self_rating] || r.self_rating}
          </div>
        )}
        {hasObjective && r.grade_label && (
          <div className={cn(
            'text-xs text-muted-foreground',
            r.grade_label === 'N/A' && 'italic'
          )}>
            客观：{r.grade_label}
          </div>
        )}
        {hasObjective && r.score != null && (
          <div
            className="text-xs font-medium tabular-nums"
            style={{ color: scoreColor(Number(r.score)) }}
          >
            {r.score} 分
          </div>
        )}
      </div>
    </div>
  );
}

// ── 当日明细 ──
export default function DayDetailPanel({ dateStr, sessions = [], onClose, isMobile = false }) {
  const totalMins = sessions.reduce((a, s) => a + (s.duration_minutes || 0), 0);
  const padX = isMobile ? 'px-3' : 'px-4';

  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.2 }}
      className="overflow-hidden"
    >
      <Card
        role="region"
        aria-label="当日学习明细"
        className="rounded-md border-border shadow-none"
      >
        <CardHeader className={cn('flex flex-row flex-wrap items-center justify-between space-y-0 gap-x-3 gap-y-1 border-b border-border py-2.5', padX)}>
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="text-sm font-medium text-foreground">{fmtDayTitle(dateStr)}</span>
            <span className="text-xs tabular-nums text-muted-foreground">合计 {fmtMins(totalMins)}</span>
            <Dot />
            <span className="text-xs tabular-nums text-muted-foreground">{sessions.length} 条记录</span>
          </div>
          {onClose && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onClose}
              className="h-7 px-2 text-xs font-normal text-muted-foreground hover:text-foreground"
            >
              收起
            </Button>
          )}
        </CardHeader>

        <CardContent className={cn('divide-y divide-border py-0', padX)}>
          {sessions.map((r, i) => (
            <RecordRow key={r.id || i} record={r} />
          ))}
        </CardContent>
      </Card>
    </motion.div>
  );
}