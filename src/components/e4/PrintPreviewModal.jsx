import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { PAPERS, loadPaper, savePaper, pdfFileName, exportE4Pdf } from '../../lib/e4PdfExport.js';
import { toast } from '../../lib/toast.js';

// 打印预览浮层：不跳路由，在当前页面上层直接预览文档。
// 「下载 PDF」在应用内逐页生成 PDF 文件（A4 / US Letter 可选），不走浏览器打印对话框——
// Safari 打印会强加页边距并缩放页面，导致溢出、空白页（见 lib/e4PdfExport.js）。
// 打印样式（body.e4-print-modal-open，见 index.css 末尾）保留给用户自行 ⌘P 的情况。
export default function PrintPreviewModal({ open, onClose, title, badge, children }) {
  const docWrapRef = useRef(null);
  const [paper, setPaper] = useState(loadPaper);
  const [progress, setProgress] = useState(null); // null | { done, total }

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape' && !progress) onClose?.(); };
    document.addEventListener('keydown', onKey);
    document.body.classList.add('e4-print-modal-open');
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.classList.remove('e4-print-modal-open');
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose, progress]);

  function choosePaper(next) {
    setPaper(next);
    savePaper(next);
  }

  async function download() {
    const docEl = docWrapRef.current?.querySelector('.e4-print-doc');
    if (!docEl || progress) return;
    setProgress({ done: 0, total: docEl.querySelectorAll('.e4-page-shell').length });
    try {
      await exportE4Pdf(docEl, {
        paper,
        fileName: pdfFileName(typeof title === 'string' ? title : ''),
        onProgress: (done, total) => setProgress({ done, total }),
      });
      toast('PDF 已生成并开始下载', { kind: 'success' });
    } catch (err) {
      toast(`PDF 生成失败：${err?.message || '请重试'}`, { kind: 'error' });
    } finally {
      setProgress(null);
    }
  }

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
              <button type="button" className="e4-btn-ghost" onClick={onClose} disabled={!!progress}>
                关闭
              </button>
              <div className="e4-print-toolbar-title">
                {title}
                {badge}
              </div>
              <div className="e4-print-toolbar-actions">
                <div className="e4-paper-switch" role="group" aria-label="纸张大小">
                  {Object.entries(PAPERS).map(([key, p]) => (
                    <button
                      key={key}
                      type="button"
                      aria-pressed={paper === key}
                      className={paper === key ? 'is-on' : ''}
                      onClick={() => choosePaper(key)}
                      disabled={!!progress}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
                <button type="button" className="e4-btn-primary" onClick={download} disabled={!!progress}>
                  {progress ? `生成中 ${progress.done}/${progress.total}…` : '下载 PDF'}
                </button>
              </div>
            </div>
          </div>
          <div
            ref={docWrapRef}
            className="e4-print-modal-scroll"
            onMouseDown={(e) => { if (e.target === e.currentTarget && !progress) onClose?.(); }}
          >
            {children}
          </div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}
