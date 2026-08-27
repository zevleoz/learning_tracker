import { useState, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';

// ── 日历工具 ──
const DAY_LABELS = ['一', '二', '三', '四', '五', '六', '日'];

function startOfDay(d) {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  return r;
}

function isSameDay(a, b) {
  if (!a || !b) return false;
  return a.getFullYear() === b.getFullYear() &&
         a.getMonth() === b.getMonth() &&
         a.getDate() === b.getDate();
}

function isToday(d) {
  return isSameDay(d, new Date());
}

function isSameMonth(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
}

function getMonthGrid(monthFirst) {
  const first = new Date(monthFirst);
  const dow = first.getDay();
  const offset = dow === 0 ? 6 : dow - 1;
  const gridStart = new Date(first);
  gridStart.setDate(first.getDate() - offset);
  const cells = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(gridStart);
    d.setDate(gridStart.getDate() + i);
    cells.push(d);
  }
  return cells;
}

function addMonths(date, n) {
  const d = new Date(date);
  d.setMonth(d.getMonth() + n);
  return d;
}

function fmtMonthLabel(d) {
  return `${d.getFullYear()}年${d.getMonth() + 1}月`;
}

function fmtDateKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ── 单月日历 ──
function MonthGrid({
  monthFirst,
  selStart,
  selEnd,
  hoverDate,
  maxD,
  minD,
  onDateClick,
  onDateHover,
  onLeaveGrid,
  onTouchStart,
  onTouchMove,
  onTouchEnd,
  cellHeight,
  isMobile,
}) {
  const cells = useMemo(() => getMonthGrid(monthFirst), [monthFirst]);
  const today = startOfDay(new Date());

  const previewEnd = selEnd || hoverDate;
  const rangeStart = (selStart && previewEnd)
    ? (selStart <= previewEnd ? selStart : previewEnd)
    : null;
  const rangeEnd = (selStart && previewEnd)
    ? (selStart <= previewEnd ? previewEnd : selStart)
    : null;

  function inRange(d) {
    if (!rangeStart || !rangeEnd) return false;
    return d >= rangeStart && d <= rangeEnd;
  }
  function isRangeStart(d) { return rangeStart && isSameDay(d, rangeStart); }
  function isRangeEnd(d) { return rangeEnd && isSameDay(d, rangeEnd); }
  function isDisabled(d) { return d > maxD || d < minD; }

  return (
    <div
      onMouseLeave={onLeaveGrid}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      style={{ userSelect: 'none', touchAction: isMobile ? 'none' : 'auto' }}
    >
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', marginBottom: 4 }}>
        {DAY_LABELS.map(d => (
          <div key={d} style={{
            textAlign: 'center', fontSize: 11, fontWeight: 600,
            color: '#94a3b8', padding: '4px 0',
          }}>{d}</div>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2 }}>
        {cells.map((d, i) => {
          const inMonth = isSameMonth(d, monthFirst);
          const disabled = isDisabled(d);
          const isStart = isRangeStart(d);
          const isEnd = isRangeEnd(d);
          const middle = inRange(d) && !isStart && !isEnd;
          const isEdge = isStart || isEnd;
          const isTodayCell = isToday(d);

          return (
            <div
              key={i}
              data-date={fmtDateKey(d)}
              onClick={() => !disabled && onDateClick(d)}
              onMouseEnter={() => !disabled && onDateHover(d)}
              style={{
                position: 'relative',
                height: cellHeight,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: disabled ? 'default' : 'pointer',
                borderRadius: isEdge ? '50%' : 0,
                background: isEdge
                  ? '#4F46E5'
                  : middle
                    ? 'rgba(79,70,229,0.12)'
                    : 'transparent',
              }}
            >
              {middle && !isEdge && (
                <div style={{
                  position: 'absolute', inset: 0,
                  background: 'rgba(79,70,229,0.12)',
                }} />
              )}
              {isStart && rangeEnd && !isSameDay(rangeStart, rangeEnd) && (
                <div style={{
                  position: 'absolute', right: '50%', top: 0, bottom: 0,
                  width: '50%', background: 'rgba(79,70,229,0.12)',
                }} />
              )}
              {isEnd && rangeStart && !isSameDay(rangeStart, rangeEnd) && (
                <div style={{
                  position: 'absolute', left: '50%', top: 0, bottom: 0,
                  width: '50%', background: 'rgba(79,70,229,0.12)',
                }} />
              )}

              <span style={{
                position: 'relative', zIndex: 1,
                fontSize: isMobile ? 15 : 13,
                fontWeight: isEdge ? 700 : 500,
                color: isEdge
                  ? '#fff'
                  : disabled
                    ? '#cbd5e1'
                    : inMonth
                      ? isTodayCell ? '#4F46E5' : '#1e293b'
                      : '#cbd5e1',
                opacity: inMonth ? 1 : 0.4,
              }}>
                {d.getDate()}
              </span>

              {isTodayCell && !isEdge && (
                <div style={{
                  position: 'absolute', inset: 2,
                  borderRadius: '50%',
                  border: '1.5px solid #4F46E5',
                  pointerEvents: 'none',
                }} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── 主组件 ──
export default function DateRangeCalendar({
  start,
  end,
  onChange,
  onClose,
  maxDate,
  minDate,
}) {
  const maxD = maxDate ? startOfDay(maxDate) : startOfDay(new Date());
  const minD = minDate ? startOfDay(minDate) : new Date(maxD.getFullYear() - 1, maxD.getMonth(), maxD.getDate());

  const [viewMonth, setViewMonth] = useState(() => {
    const d = start ? new Date(start) : new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });

  const [selStart, setSelStart] = useState(start ? startOfDay(start) : null);
  const [selEnd, setSelEnd] = useState(end ? startOfDay(end) : null);
  const [hoverDate, setHoverDate] = useState(null);
  const [isMobile, setIsMobile] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef(null);

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    const handler = (e) => setIsMobile(e.matches);
    handler(mq);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  const nextMonth = addMonths(viewMonth, 1);
  const cellHeight = isMobile ? 44 : 36;

  function handleDateClick(date) {
    if (date > maxD || date < minD) return;
    if (!selStart || (selStart && selEnd)) {
      setSelStart(date);
      setSelEnd(null);
      setHoverDate(null);
    } else {
      const s = selStart <= date ? selStart : date;
      const e = selStart <= date ? date : selStart;
      setSelStart(s);
      setSelEnd(e);
      setHoverDate(null);
      onChange?.(s, e);
    }
  }

  function handleDateHover(date) {
    if (selStart && !selEnd && date >= minD && date <= maxD) {
      setHoverDate(date);
    } else {
      setHoverDate(null);
    }
  }

  // ── 触控滑动选区间 ──
  function handleTouchStart(e) {
    const touch = e.touches[0];
    const el = document.elementFromPoint(touch.clientX, touch.clientY);
    const cell = el?.closest?.('[data-date]');
    if (!cell) return;
    const dateKey = cell.getAttribute('data-date');
    const [y, m, d] = dateKey.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    if (date > maxD || date < minD) return;
    dragStartRef.current = date;
    setSelStart(date);
    setSelEnd(null);
    setHoverDate(date);
    setIsDragging(true);
  }

  function handleTouchMove(e) {
    if (!isDragging) return;
    e.preventDefault();
    const touch = e.touches[0];
    const el = document.elementFromPoint(touch.clientX, touch.clientY);
    const cell = el?.closest?.('[data-date]');
    if (!cell) return;
    const dateKey = cell.getAttribute('data-date');
    const [y, m, d] = dateKey.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    if (date > maxD || date < minD) return;
    setHoverDate(date);
  }

  function handleTouchEnd() {
    if (!isDragging) return;
    const end = hoverDate || dragStartRef.current;
    const s = selStart <= end ? selStart : end;
    const e = selStart <= end ? end : selStart;
    setSelStart(s);
    setSelEnd(e);
    setHoverDate(null);
    setIsDragging(false);
    dragStartRef.current = null;
    // 不立即调 onChange：让用户看到选中的区间，按「确定」按钮确认
  }

  const previewEnd = selEnd || hoverDate;
  const rangeLabel = (selStart && previewEnd)
    ? `${selStart.getMonth() + 1}/${selStart.getDate()} - ${previewEnd.getMonth() + 1}/${previewEnd.getDate()}`
    : selStart
      ? `${selStart.getMonth() + 1}/${selStart.getDate()} — 选择结束日期`
      : isMobile ? '按住日期并滑动选择区间' : '选择起始日期';

  const showDual = !isMobile && nextMonth <= addMonths(new Date(), 0);

  const calendarContent = (
    <div style={{
      background: '#fff',
      borderRadius: isMobile ? '20px 20px 0 0' : 12,
      border: isMobile ? 'none' : '1px solid rgba(15,23,42,0.08)',
      boxShadow: isMobile ? '0 -12px 40px rgba(0,0,0,0.15)' : '0 8px 32px rgba(0,0,0,0.08)',
      padding: 16,
      paddingBottom: isMobile ? 'calc(16px + env(safe-area-inset-bottom))' : 16,
      maxWidth: showDual ? 640 : 360,
      width: '100%',
    }}>
      {/* 顶部栏 */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: 12,
      }}>
        <span style={{
          fontSize: 12, fontWeight: 600, color: '#4F46E5',
          background: 'rgba(79,70,229,0.08)',
          padding: '4px 10px', borderRadius: 6,
        }}>
          {rangeLabel}
        </span>
        {onClose && (
          <button
            onClick={onClose}
            style={{
              border: 'none', background: 'transparent',
              cursor: 'pointer', fontSize: 16, color: '#94a3b8',
              padding: '2px 6px', lineHeight: 1,
            }}
          >✕</button>
        )}
      </div>

      {/* 月份导航 */}
      {isMobile ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16, marginBottom: 8 }}>
          <button
            onClick={() => setViewMonth(addMonths(viewMonth, -1))}
            disabled={addMonths(viewMonth, -1) < new Date(minD.getFullYear(), minD.getMonth(), 1)}
            style={navBtn}
          >‹</button>
          <span style={{ fontSize: 13, fontWeight: 600, color: '#1e293b', minWidth: 100, textAlign: 'center' }}>
            {fmtMonthLabel(viewMonth)}
          </span>
          <button
            onClick={() => setViewMonth(addMonths(viewMonth, 1))}
            disabled={viewMonth >= addMonths(maxD, -1)}
            style={navBtn}
          >›</button>
        </div>
      ) : (
        <div style={{ display: 'flex', justifyContent: showDual ? 'space-between' : 'center', marginBottom: 8, gap: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              onClick={() => setViewMonth(addMonths(viewMonth, -1))}
              disabled={addMonths(viewMonth, -1) < new Date(minD.getFullYear(), minD.getMonth(), 1)}
              style={navBtn}
            >‹</button>
            <span style={{ fontSize: 13, fontWeight: 600, color: '#1e293b' }}>
              {fmtMonthLabel(viewMonth)}
            </span>
          </div>
          {showDual && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: '#1e293b' }}>
                {fmtMonthLabel(nextMonth)}
              </span>
              <button
                onClick={() => setViewMonth(addMonths(viewMonth, 1))}
                disabled={viewMonth >= addMonths(maxD, -1)}
                style={navBtn}
              >›</button>
            </div>
          )}
        </div>
      )}

      {/* 日历网格 */}
      <div style={{ display: showDual ? 'grid' : 'block', gridTemplateColumns: showDual ? '1fr 1fr' : undefined, gap: showDual ? 16 : 0 }}>
        <AnimatePresence mode="wait">
          <motion.div
            key={viewMonth.toISOString()}
            initial={{ opacity: 0, x: isMobile ? -10 : 0 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: isMobile ? 10 : 0 }}
            transition={{ duration: 0.15 }}
          >
            <MonthGrid
              monthFirst={viewMonth}
              selStart={selStart}
              selEnd={selEnd}
              hoverDate={hoverDate}
              maxD={maxD}
              minD={minD}
              onDateClick={handleDateClick}
              onDateHover={handleDateHover}
              onLeaveGrid={() => setHoverDate(null)}
              onTouchStart={handleTouchStart}
              onTouchMove={handleTouchMove}
              onTouchEnd={handleTouchEnd}
              cellHeight={cellHeight}
              isMobile={isMobile}
            />
          </motion.div>
        </AnimatePresence>
        {showDual && (
          <MonthGrid
            monthFirst={nextMonth}
            selStart={selStart}
            selEnd={selEnd}
            hoverDate={hoverDate}
            maxD={maxD}
            minD={minD}
            onDateClick={handleDateClick}
            onDateHover={handleDateHover}
            onLeaveGrid={() => setHoverDate(null)}
            cellHeight={cellHeight}
            isMobile={isMobile}
          />
        )}
      </div>

      {/* 移动端确认按钮 */}
      {isMobile && (
        <div style={{ padding: '12px 4px 0' }}>
          <button
            type="button"
            onClick={() => {
              if (selStart && selEnd) onChange?.(selStart, selEnd);
              onClose?.();
            }}
            style={{
              width: '100%', padding: '12px 0', fontSize: 14, fontWeight: 600,
              border: 'none', borderRadius: 12, background: '#4F46E5',
              color: '#fff', cursor: 'pointer', fontFamily: 'inherit',
            }}
          >确定</button>
        </div>
      )}
    </div>
  );

  // 移动端：底部弹出 sheet
  if (isMobile) {
    return createPortal(
      <AnimatePresence>
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          onClick={onClose}
          style={{
            position: 'fixed', inset: 0, zIndex: 1200,
            background: 'rgba(15,23,42,0.45)',
            backdropFilter: 'blur(4px)',
            WebkitBackdropFilter: 'blur(4px)',
            display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
          }}
        >
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', stiffness: 360, damping: 36 }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* 抓手条 */}
            <div style={{ display: 'flex', justifyContent: 'center', padding: '10px 0 0' }}>
              <div style={{ width: 36, height: 4, borderRadius: 2, background: '#cbd5e1' }} />
            </div>
            {calendarContent}
          </motion.div>
        </motion.div>
      </AnimatePresence>,
      document.body
    );
  }

  // 桌面端：内联展开
  return calendarContent;
}

const navBtn = {
  border: 'none', background: 'rgba(99,102,241,0.06)',
  cursor: 'pointer', fontSize: 16, color: '#4F46E5',
  padding: '4px 10px', borderRadius: 6, lineHeight: 1,
  fontWeight: 600,
};
