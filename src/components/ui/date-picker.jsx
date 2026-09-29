// shadcn 风格日期选择器：Popover + Calendar 组合
// 单选值协议: 'yyyy-MM-dd' 字符串，空值为 ''
// 范围值协议: 'yyyy-MM-dd~yyyy-MM-dd' 字符串，空值为 ''
import { useState } from 'react';
import { Calendar as CalendarIcon, X } from 'lucide-react';
import { format, isValid, parseISO } from 'date-fns';
import { cn } from '@/lib/utils';
import { Button } from './button.jsx';
import { Popover, PopoverContent, PopoverTrigger } from './popover.jsx';
import { Calendar } from './calendar.jsx';

// 解析范围值 'yyyy-MM-dd~yyyy-MM-dd' → { from, to }
function parseRange(val) {
  if (!val || typeof val !== 'string') return null;
  const parts = val.split('~');
  const from = parseISO(parts[0]);
  const to = parts[1] ? parseISO(parts[1]) : null;
  if (!isValid(from)) return null;
  return { from, to: to && isValid(to) ? to : undefined };
}

export default function DatePicker({
  value = '',
  onChange,
  placeholder = '选择日期',
  disabled = false,
  clearable = true,
  open: openProp,
  defaultOpen = false,
  onOpenChange,
  align = 'start',
  className,
  trigger,
  displayFormat = 'yyyy年MM月dd日',
  boundary,
  id,
  range = false, // true 时使用日期范围模式
}) {
  const [innerOpen, setInnerOpen] = useState(defaultOpen);
  const controlled = openProp !== undefined;
  const open = controlled ? openProp : innerOpen;
  const setOpen = (v) => {
    if (!controlled) setInnerOpen(v);
    onOpenChange?.(v);
  };

  // ---- 单选模式 ----
  const parsed = value ? parseISO(value) : null;
  const valid = !!parsed && isValid(parsed);

  const handleSelect = (d) => {
    if (!d) return;
    onChange?.(format(d, 'yyyy-MM-dd'));
    setOpen(false);
  };

  // ---- 范围模式 ----
  const rangeVal = range ? parseRange(value) : null;
  const rangeValid = !!rangeVal;

  const handleRangeSelect = (r, selectedDay) => {
    if (!r) return;
    const from = r.from ? format(r.from, 'yyyy-MM-dd') : '';
    const to = r.to ? format(r.to, 'yyyy-MM-dd') : '';
    if (from && to) {
      onChange?.(`${from}~${to}`);
      setOpen(false);
    } else if (from && !to) {
      onChange?.(`${from}~`);
    } else {
      onChange?.('');
    }
  };

  const rangeLabel = rangeValid
    ? rangeVal.to
      ? `${format(rangeVal.from, displayFormat)} ~ ${format(rangeVal.to, displayFormat)}`
      : `${format(rangeVal.from, displayFormat)} ~ ?`
    : '';

  const showClear = clearable && !disabled && (range ? rangeValid : valid);
  const label = range ? rangeLabel : valid ? format(parsed, displayFormat) : '';

  const defaultTrigger = (
    <Button
      type="button"
      variant="outline"
      id={id}
      disabled={disabled}
      className={cn(
        'w-full justify-start gap-2 text-left font-normal',
        !label && 'text-muted-foreground',
        className
      )}
    >
      <CalendarIcon className="h-4 w-4 shrink-0 opacity-70" />
      <span className="flex-1 truncate">
        {label || placeholder}
      </span>
      {showClear && (
        <span
          role="button"
          aria-label="清除日期"
          tabIndex={-1}
          className="ml-auto rounded-sm p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onChange?.('');
          }}
        >
          <X className="h-3.5 w-3.5" />
        </span>
      )}
    </Button>
  );

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        if (!disabled) setOpen(o);
      }}
    >
      <PopoverTrigger asChild>{trigger ?? defaultTrigger}</PopoverTrigger>
      <PopoverContent className="w-auto p-0" align={align} collisionBoundary={boundary}>
        {range ? (
          <Calendar
            mode="range"
            selected={rangeVal || undefined}
            defaultMonth={rangeVal?.from || new Date()}
            onSelect={handleRangeSelect}
            numberOfMonths={1}
            autoFocus
          />
        ) : (
          <Calendar
            mode="single"
            selected={valid ? parsed : undefined}
            defaultMonth={valid ? parsed : new Date()}
            onSelect={handleSelect}
            autoFocus
          />
        )}
      </PopoverContent>
    </Popover>
  );
}
