import { render, screen, fireEvent } from '@testing-library/react';
import { PAPERS, placePage, pdfFileName, loadPaper, savePaper } from '../src/lib/e4PdfExport.js';
import PrintPreviewModal from '../src/components/e4/PrintPreviewModal.jsx';

jest.mock('framer-motion', () => {
  const React = require('react');
  return {
    AnimatePresence: ({ children }) => <>{children}</>,
    motion: { div: React.forwardRef(({ initial, animate, exit, transition, ...rest }, ref) => <div ref={ref} {...rest} />) },
  };
});

describe('E4 报告直接生成 PDF（不走 Safari 打印对话框）', () => {
  test('210×270 页面在 A4 上原尺寸、上下左右居中', () => {
    const box = placePage('a4', 210, 270);
    expect(box.width).toBeCloseTo(210);
    expect(box.height).toBeCloseTo(270);
    expect(box.x).toBeCloseTo(0);
    expect(box.y).toBeCloseTo(13.5);
  });

  test('在 US Letter 上等比放大到纸宽，整页仍在纸内', () => {
    const box = placePage('letter', 210, 270);
    expect(box.width).toBeCloseTo(PAPERS.letter.width);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(PAPERS.letter.height + 1e-9);
  });

  test('内容超高的页面缩小放进纸里，不会裁掉', () => {
    const box = placePage('letter', 210, 300);
    expect(box.height).toBeCloseTo(PAPERS.letter.height);
    expect(box.x).toBeGreaterThan(0);
  });

  test('文件名去掉系统不允许的字符', () => {
    expect(pdfFileName('Leo · 首次学习力分析报告')).toBe('Leo · 首次学习力分析报告.pdf');
    expect(pdfFileName('a/b:c*?')).toBe('a b c.pdf');
    expect(pdfFileName('')).toBe('E4 报告.pdf');
  });

  test('纸型选择会被记住', () => {
    savePaper('letter');
    expect(loadPaper()).toBe('letter');
    savePaper('a4');
    expect(loadPaper()).toBe('a4');
  });

  test('预览工具条：可选 A4 / US Letter，「下载 PDF」不再调用浏览器打印', () => {
    const print = jest.spyOn(window, 'print').mockImplementation(() => {});
    render(
      <PrintPreviewModal open title="Leo · 首次学习力分析报告" onClose={() => {}}>
        <div className="e4-print-doc" />
      </PrintPreviewModal>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'US Letter' }));
    expect(screen.getByRole('button', { name: 'US Letter' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'A4' })).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(screen.getByRole('button', { name: '下载 PDF' }));
    expect(print).not.toHaveBeenCalled();
    print.mockRestore();
  });
});
