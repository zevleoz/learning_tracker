import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';

// 打印预览浮层：不跳路由，在当前页面上层直接预览 A4 文档并可立即打印 / 下载 PDF。
// 打印时通过 body.e4-print-modal-open 隐藏应用壳层，只输出纸张内容（见 index.css 末尾）。

// 页边距清零必须是顶层 @page：Safari（WebKit）忽略写在 @media print 里的 @page，
// 页边距改由 Safari 打印面板决定——时有时无地在每张纸顶部多出约 21mm（60pt），
// 270mm 的页面被挤出一截，每页后面多一张只有页脚的纸。只在 E4 打印预览打开期间挂上，不影响一表人才其他页面。
export function mountE4PageRule() {
  const style = document.createElement('style');
  style.dataset.e4Page = '';
  style.textContent = '@page { margin: 0; }';
  document.head.appendChild(style);
  return style;
}

export default function PrintPreviewModal({ open, onClose, title, badge, children }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    document.addEventListener('keydown', onKey);
    document.body.classList.add('e4-print-modal-open');
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const pageStyle = mountE4PageRule();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.classList.remove('e4-print-modal-open');
      document.body.style.overflow = prevOverflow;
      pageStyle.remove();
    };
  }, [open, onClose]);

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="e4-print-modal"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          role="dialog"
          aria-modal="true"
          aria-label={typeof title === 'string' ? title : '打印预览'}
        >
          <div className="e4-print-toolbar no-print">
            <div className="e4-print-toolbar-inner">
              <button type="button" className="e4-btn-ghost" onClick={onClose}>
                关闭
              </button>
              <div className="e4-print-toolbar-title">
                {title}
                {badge}
              </div>
              <button type="button" className="e4-btn-primary" onClick={() => window.print()}>
                下载 PDF
              </button>
            </div>
          </div>
          <div
            className="e4-print-modal-scroll"
            onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
          >
            {children}
          </div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}
