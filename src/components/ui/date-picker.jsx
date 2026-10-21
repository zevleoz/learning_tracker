import * as React from 'react';
import { format, isSameDay, isValid, parseISO } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import { CalendarDays, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button.jsx';
import { Calendar } from '@/components/ui/calendar.jsx';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover.jsx';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// 解析范围值 'yyyy-MM-dd~yyyy-MM-dd' → { from, to }（Date 对象；仅起点时 to 为 null）。
// 起始日缺失或非法一律返回 null，供 UI 与 DocField 复用、单测覆盖。
export function parseRangeValue(value) {
  if (!value || typeof value !== 'string') return null;
  const parts = value.split('~');
  const startRaw = (parts[0] || '').trim();
  if (!DATE_RE.test(startRaw)) return null;
  const from = parseISO(startRaw);
  if (!isValid(from)) return null;
  const endRaw = (parts[1] || '').trim();
  let to = null;
  if (endRaw) {
    const t = DATE_RE.test(endRaw) ? parseISO(endRaw) : null;
    if (t && isValid(t)) to = t;
  }
  return { from, to };
}

// 单日期 / 日期范围选择器。配色全部取自 shadcn 变量，变量按表面作用域化
// （.e4-dashboard 深色 / body.e4-light 浅色 / A4 纸张内还原浅色），因此无需在调用点
// 传 buttonClassName / contentClassName；className 只用于外层排版尺寸。
// 值协议：单选 'yyyy-MM-dd'；范围 'yyyy-MM-dd~yyyy-MM-dd'（起止齐全才回写），空值 ''。
// 防御：无法解析的 value 一律按空值渲染 placeholder，绝不抛异常
// （历史上范围串经 parseISO→format 会抛 Invalid time value 整页崩）。
export function DatePicker({
  value = '',
  onChange,
  placeholder = '选择日期',
  className,
  buttonClassName,
  contentClassName,
  allowClear = true,
  disabled = false,
  range = false,
  trigger,
  defaultOpen = false,
  onOpenChange,
  boundary,
  displayFormat = 'yyyy年M月d日 EEEE',
  id,
  align = 'start',
}) {
  const [innerOpen, setInnerOpen] = React.useState(defaultOpen);
  const [draft, setDraft] = React.useState(null); // 范围半成品（只点了起点），不写回父级
  const [hoverDay, setHoverDay] = React.useState(null); // 鼠标下的日期，用于实时预览
  const [dragAnchor, setDragAnchor] = React.useState(null); // 按下那一刻的日期
  const dragRef = React.useRef(null); // 拖动状态：{ from, to, moved }
  const setOpen = (v) => {
    setInnerOpen(v);
    // 开关弹层都丢弃半成品与预览，避免残留
    setDraft(null);
    setHoverDay(null);
    setDragAnchor(null);
    onOpenChange?.(v);
  };

  const iso = (d) => format(d, 'yyyy-MM-dd');

  // 单选解析：范围串/非法串一律视为空
  const singleDate = !range && value && DATE_RE.test(String(value)) ? parseISO(String(value)) : null;
  const hasSingle = !!singleDate && isValid(singleDate);
  const rangeVal = range ? parseRangeValue(value) : null;
  // 已提交的范围（to 用 undefined，react-day-picker v9 只认 undefined 不认 null）
  const committedRange = rangeVal ? { from: rangeVal.from, to: rangeVal.to ?? undefined } : undefined;

  const rangeLabel = rangeVal
    ? rangeVal.to
      ? `${format(rangeVal.from, displayFormat, { locale: zhCN })} ~ ${format(rangeVal.to, displayFormat, { locale: zhCN })}`
      : format(rangeVal.from, displayFormat, { locale: zhCN })
    : '';
  const label = range ? rangeLabel : hasSingle ? format(singleDate, displayFormat, { locale: zhCN }) : '';
  const canClear = allowClear && !disabled && (range ? !!rangeVal : hasSingle);

  const handleSelect = (d) => {
    if (!d || !isValid(d)) return;
    onChange?.(iso(d));
    setOpen(false);
  };

  // 待定起点：已经点过一次的起点；也兼容外部传入的「只有起点」的范围值
  const pendingStart = draft?.from ?? (rangeVal && !rangeVal.to ? rangeVal.from : null);

  // 实时预览：鼠标停在任意一天（不按也要），就画出「起点 → 该天」的灰度区间。
  // 拖动时以按下那一刻的日期为准：拖动相当于重新起一段，优先于已点选的起点。
  const previewStart = dragAnchor ?? pendingStart;
  const previewRange = React.useMemo(() => {
    if (!previewStart || !hoverDay || isSameDay(previewStart, hoverDay)) return null;
    const [a, b] = hoverDay < previewStart ? [hoverDay, previewStart] : [previewStart, hoverDay];
    return { from: a, to: b };
  }, [previewStart, hoverDay]);

  const shownRange = previewRange || draft || committedRange;

  // 写入范围并收起弹层
  const commitRange = React.useCallback(
    (a, b) => {
      const [x, y] = b < a ? [b, a] : [a, b];
      onChange?.(`${iso(x)}~${iso(y)}`);
      setOpen(false);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [onChange]
  );

  // 点击某天：还没有待定起点 → 记为起点；已有起点 → 直接闭合区间（同一天即单日范围）
  const handleDayPick = React.useCallback(
    (day) => {
      if (disabled) return;
      if (pendingStart) commitRange(pendingStart, day);
      else setDraft({ from: day, to: undefined });
    },
    [disabled, pendingStart, commitRange]
  );

  // 拖动流：按下记起点，滑过别的天实时预览，松开落点即写入
  const startDrag = React.useCallback((day) => {
    dragRef.current = { from: day, to: day, moved: false };
    setDragAnchor(day);
  }, []);

  const handleCalendarOver = (e) => {
    if (!range) return;
    // 没有待定起点、也没在拖动时，悬停不产生预览
    if (!dragRef.current && !pendingStart) return;
    const el = e.target instanceof Element ? e.target.closest('[data-day]') : null;
    const dayIso = el?.getAttribute('data-day') || '';
    if (!DATE_RE.test(dayIso)) return;
    const day = parseISO(dayIso);
    if (!isValid(day)) return;
    if (dragRef.current) {
      dragRef.current = {
        ...dragRef.current,
        to: day,
        moved: !isSameDay(day, dragRef.current.from),
      };
    }
    setHoverDay(day);
  };

  React.useEffect(() => {
    if (!range) return undefined;
    const onUp = () => {
      const d = dragRef.current;
      dragRef.current = null;
      if (!d) return;
      // 真正拖到别的天才提交；原地松手交给点击流处理
      if (!d.moved || !d.to || isSameDay(d.from, d.to)) {
        setDragAnchor(null);
        return;
      }
      commitRange(d.from, d.to);
    };
    window.addEventListener('mouseup', onUp);
    return () => window.removeEventListener('mouseup', onUp);
  }, [range, commitRange]);

  // 给每一天挂 data-day + mousedown + click：容器 mouseover 驱动预览，
  // 点击流由这里接管（不再走 react-day-picker 内部的 addToRange）。
  // 必须稳定引用，否则每次渲染都会重挂载日按钮、打断拖动。
  const RangeDayButton = React.useCallback(
    (props) => {
      const { day, modifiers: _modifiers, ...rest } = props;
      const value = day.date;
      return (
        <button
          {...rest}
          data-day={iso(value)}
          onMouseDown={(e) => {
            if (disabled) return;
            e.preventDefault(); // 阻断拖动时选中文本
            startDrag(value);
          }}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            handleDayPick(value);
          }}
        />
      );
    },
    [disabled, startDrag, handleDayPick]
  );

  const defaultTrigger = (
    <Button
      type="button"
      variant="outline"
      id={id}
      disabled={disabled}
      className={cn(
        'w-full justify-start text-left font-normal',
        !label && 'text-muted-foreground',
        buttonClassName
      )}
    >
      <CalendarDays className="h-4 w-4 shrink-0" />
      <span className="flex-1 truncate">{label || placeholder}</span>
    </Button>
  );

  return (
    <div className={cn('flex items-center gap-2', className)}>
      <Popover open={innerOpen} onOpenChange={(o) => { if (!disabled) setOpen(o); }}>
        <PopoverTrigger asChild>{trigger ?? defaultTrigger}</PopoverTrigger>
        <PopoverContent align={align} collisionBoundary={boundary} className={cn('w-auto p-0', contentClassName)}>
          {range ? (
            <div
              onMouseOver={handleCalendarOver}
              onMouseLeave={() => {
                if (!dragRef.current) setHoverDay(null);
              }}
              className="select-none"
            >
              <Calendar
                mode="range"
                selected={shownRange}
                defaultMonth={rangeVal?.from || new Date()}
                numberOfMonths={1}
                autoFocus
                // v9 的 useRange 只有在传了 onSelect 时才走「受控 selected」分支；
                // 点击流由 RangeDayButton 接管，这里只需一个占位函数。
                onSelect={() => {}}
                onNextClick={() => setHoverDay(null)}
                onPrevClick={() => setHoverDay(null)}
                components={{ DayButton: RangeDayButton }}
              />
            </div>
          ) : (
            <Calendar
              mode="single"
              selected={hasSingle ? singleDate : undefined}
              defaultMonth={hasSingle ? singleDate : new Date()}
              onSelect={handleSelect}
              autoFocus
            />
          )}
        </PopoverContent>
      </Popover>
      {canClear && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          title="清空"
          onClick={() => onChange?.('')}
          className="shrink-0 text-muted-foreground"
        >
          <X className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}

export default DatePicker;
