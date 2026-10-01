import * as React from 'react';
import { format, parseISO } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import { CalendarDays, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button.jsx';
import { Calendar } from '@/components/ui/calendar.jsx';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover.jsx';

// 单日期选择器：value 为 'YYYY-MM-DD' 或 ''，onChange 回传同格式。
// 默认用 shadcn 中性变量；深色 E4 页面通过 buttonClassName / contentClassName 覆盖。
export function DatePicker({
  value,
  onChange,
  placeholder = '选择日期',
  className,
  buttonClassName,
  contentClassName,
  allowClear = true,
  disabled = false,
}) {
  const [open, setOpen] = React.useState(false);
  const selected = value ? parseISO(value) : undefined;

  return (
    <div className={cn('flex items-center gap-2', className)}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            disabled={disabled}
            className={cn(
              'w-full justify-start text-left font-normal',
              !value && 'text-muted-foreground',
              buttonClassName
            )}
          >
            <CalendarDays className="h-4 w-4" />
            {value ? format(selected, 'yyyy年M月d日 EEEE', { locale: zhCN }) : placeholder}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className={cn('w-auto p-0', contentClassName)}>
          <Calendar
            mode="single"
            selected={selected}
            onSelect={(d) => {
              onChange(d ? format(d, 'yyyy-MM-dd') : '');
              setOpen(false);
            }}
            initialFocus
          />
        </PopoverContent>
      </Popover>
      {allowClear && value && !disabled && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          title="清空"
          onClick={() => onChange('')}
          className="shrink-0 text-muted-foreground"
        >
          <X className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}

export default DatePicker;
