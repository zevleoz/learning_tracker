import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { X } from 'lucide-react';
import LogForm from './LogForm.jsx';
import { useMediaQuery } from '../../lib/useMediaQuery.js';
import '../../styles/student-logging.css';

/* ============ Sheet：手机底部弹层 / 桌面右侧面板 / 居中对话框 ============ */
export function Sheet({
  open, onClose, onRequestClose = onClose, title, children, footer, headerExtra,
  variant = 'sheet',
}) {
  const dialog = variant === 'dialog';
  const desktop = useMediaQuery('(min-width: 900px)');
  const reduce = useReducedMotion();
  const titleId = useId();
  const panelRef = useRef(null);
  const returnFocus = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    returnFocus.current = document.activeElement;
    const prevOverflow = document.body.style.overflow;
    if (dialog || !desktop) document.body.style.overflow = 'hidden';
    const t = setTimeout(() => panelRef.current?.focus(), 0);
    return () => {
      clearTimeout(t);
      document.body.style.overflow = prevOverflow;
      const el = returnFocus.current;
      if (el && typeof el.focus === 'function' && document.contains(el)) el.focus();
    };
  }, [open, desktop, dialog]);

  function onKeyDown(e) {
    if (e.key === 'Escape') {
      // 日历等弹层自己处理 Esc；只有焦点仍在面板内时才关闭
      if (e.defaultPrevented) return;
      e.stopPropagation();
      onRequestClose();
      return;
    }
    if (e.key !== 'Tab' || !panelRef.current) return;
    const nodes = panelRef.current.querySelectorAll(
      'button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    if (!nodes.length) return;
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    if (e.shiftKey && (document.activeElement === first || document.activeElement === panelRef.current)) {
      e.preventDefault(); last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault(); first.focus();
    }
  }

  const offscreen = dialog
    ? { opacity: 0, y: 10, scale: 0.985 }
    : desktop ? { x: 'calc(100% + 24px)' } : { y: '100%' };
  const onscreen = dialog ? { opacity: 1, y: 0, scale: 1 } : desktop ? { x: 0 } : { y: 0 };
  const transition = reduce
    ? { duration: 0 }
    : dialog ? { duration: 0.18 } : { type: 'tween', ease: [0.32, 0.72, 0, 1], duration: 0.38 };
  const target = (typeof document !== 'undefined' && document.querySelector('.yb-student')) || document.body;

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className={dialog ? 'yb-lg yb-dialog-wrap' : 'yb-lg'} key="yb-sheet">
          <motion.div
            className="yb-sheet-scrim"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={reduce ? { duration: 0 } : { duration: 0.2 }}
            onClick={onRequestClose}
            aria-hidden="true"
          />
          <motion.div
            ref={panelRef}
            className={`yb-sheet${dialog ? ' yb-dialog' : ''}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            tabIndex={-1}
            onKeyDown={onKeyDown}
            initial={offscreen} animate={onscreen} exit={offscreen}
            transition={transition}
          >
            <div className="yb-sheet__grab" aria-hidden="true" />
            <div className="yb-sheet__h">
              <h2 id={titleId}>{title}</h2>
              {headerExtra}
              <button type="button" className="yb-sheet__close" onClick={onRequestClose} aria-label="关闭">
                <X size={18} strokeWidth={2} aria-hidden="true" />
              </button>
            </div>
            <div className="yb-sheet__b">{children}</div>
            {footer && <div className="yb-sheet__f">{footer}</div>}
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    target,
  );
}

/* ============ 记一笔：Sheet / Dialog + 表单 ============ */
// 表单本身在 LogForm；这里只负责弹层与关闭确认的桥接。
export default function LogSheet({
  open, onClose, mode = 'new', editRow = null, preset = null, variant = 'sheet',
  courses = [], loadingCourses = false, recent = [], customForms = [],
  onAddCustomForm, onSave, busy = false,
}) {
  const formRef = useRef(null);
  const editing = mode === 'edit' && !!editRow;

  return (
    <Sheet
      open={open}
      onClose={onClose}
      onRequestClose={() => formRef.current?.requestClose()}
      title={editing ? '编辑记录' : '记一下'}
      variant={variant}
    >
      <LogForm
        ref={formRef}
        open={open}
        layout={variant === 'dialog' ? 'two-col' : 'sheet'}
        mode={mode}
        editRow={editRow}
        preset={preset}
        courses={courses}
        loadingCourses={loadingCourses}
        recent={recent}
        customForms={customForms}
        onAddCustomForm={onAddCustomForm}
        onSave={onSave}
        onClose={onClose}
        busy={busy}
      />
    </Sheet>
  );
}
