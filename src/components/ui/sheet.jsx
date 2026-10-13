import * as React from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Sheet — 右侧滑出面板（沿用 dialog.jsx 的手写 portal 模式，无新增依赖）
 *
 * <Sheet open={open} onOpenChange={setOpen}>
 *   <SheetContent onClose={() => setOpen(false)}>…</SheetContent>
 * </Sheet>
 *
 * 行为：Esc 关闭、点击遮罩关闭、framer-motion 滑入 + 遮罩淡入。
 */
function Sheet({ open, onOpenChange, children }) {
  React.useEffect(() => {
    if (!open) return;
    function onKey(e) {
      if (e.key === 'Escape') onOpenChange(false);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onOpenChange]);

  if (typeof document === 'undefined') return null;

  const content = open && React.isValidElement(children)
    ? React.cloneElement(children, { key: 'sheet-content' })
    : null;

  return createPortal(
    <AnimatePresence>
      {open && [
        <motion.div
          key="sheet-overlay"
          className="mentor-sheet-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          onMouseDown={() => onOpenChange(false)}
        />,
        content,
      ]}
    </AnimatePresence>,
    document.body
  );
}

const SheetContent = React.forwardRef(({ className, children, onClose, ...props }, ref) => (
  <motion.div
    ref={ref}
    role="dialog"
    aria-modal="true"
    className={cn('mentor-sheet-panel', className)}
    initial={{ x: '100%' }}
    animate={{ x: 0 }}
    exit={{ x: '100%' }}
    transition={{ type: 'tween', duration: 0.28, ease: [0.32, 0.72, 0, 1] }}
    {...props}
  >
    {children}
    {onClose && (
      <button
        type="button"
        onClick={onClose}
        className="mentor-sheet-close"
        aria-label="关闭"
      >
        <X className="h-4 w-4" />
      </button>
    )}
  </motion.div>
));
SheetContent.displayName = 'SheetContent';

const SheetHeader = ({ className, ...props }) => (
  <div className={cn('mentor-sheet-header', className)} {...props} />
);

const SheetTitle = React.forwardRef(({ className, ...props }, ref) => (
  <h2 ref={ref} className={cn('mentor-sheet-title', className)} {...props} />
));
SheetTitle.displayName = 'SheetTitle';

const SheetDescription = ({ className, ...props }) => (
  <p className={cn('mentor-sheet-description', className)} {...props} />
);

export { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription };
