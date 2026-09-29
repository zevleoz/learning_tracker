// shadcn 风格日期选择器：Popover + Calendar 组合
// 值协议与原生 input[type=date] 一致：'yyyy-MM-dd' 字符串，空值为 ''
import { useState } from 'react';
import { Calendar as CalendarIcon, X } from 'lucide-react';
import { format, isValid, parseISO } from 'date-fns';
import { cn } from '@/lib/utils';
import { Button } from './button.jsx';
import { Popover, PopoverContent, PopoverTrigger } from './popover.jsx';
import { Calendar } from './calendar.jsx';

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
  trigger, // 自定义触发器（需可接收 ref/事件的单个元素）
  displayFormat = 'yyyy年MM月dd日',
  boundary, // 碰撞边界元素（默认走 clipping ancestors；缩放/裁剪容器内需传 document.body）
  id,
}) {
  const [innerOpen, setInnerOpen] = useState(defaultOpen);
  const controlled = openProp !== undefined;
  const open = controlled ? openProp : innerOpen;
  const setOpen = (v) => {
    if (!controlled) setInnerOpen(v);
    onOpenChange?.(v);
  };

  const parsed = value ? parseISO(value) : null;
  const valid = !!parsed && isValid(parsed);

  const handleSelect = (d) => {
    if (!d) return;
    onChange?.(format(d, 'yyyy-MM-dd'));
    setOpen(false);
  };

  const defaultTrigger = (
    <Button
      type="button"
      variant="outline"
      id={id}
      disabled={disabled}
      className={cn(
        'w-full justify-start gap-2 text-left font-normal',
        !valid && 'text-muted-foreground',
        className
      )}
    >
      <CalendarIcon className="h-4 w-4 shrink-0 opacity-70" />
      <span className="flex-1 truncate">
        {valid ? format(parsed, displayFormat) : placeholder}
      </span>
      {clearable && valid && !disabled && (
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
        <Calendar
          mode="single"
          selected={valid ? parsed : undefined}
          defaultMonth={valid ? parsed : new Date()}
          onSelect={handleSelect}
          autoFocus
        />
      </PopoverContent>
    </Popover>
  );
}
