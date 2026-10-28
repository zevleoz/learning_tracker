// E4 报告直接生成 PDF 文件（不走浏览器打印对话框）。
// 浏览器打印在 Safari 下不可控：顶部强制约 21mm 页边距、按纸宽缩放文档，固定高度的页面总会溢出成空白页。
// 改为逐页把屏幕上的纸张（.e4-page-shell）渲染成图片，按所选纸型（A4 / US Letter）拼成 PDF，
// 各浏览器输出一致。渲染用 modern-screenshot（SVG foreignObject，由浏览器自己排版，和屏幕一致；
// html2canvas 自己重排文字，表头、单元格文字会整体下沉）。依赖按需加载，不进首屏包。

export const PAPERS = {
  a4: { label: 'A4', width: 210, height: 297 },
  letter: { label: 'US Letter', width: 215.9, height: 279.4 },
};

const PAPER_KEY = 'e4-pdf-paper';
const PX_PER_MM = 96 / 25.4;
const RENDER_SCALE = 2.5; // 约 240dpi：打印清晰，单页图片约 0.3MB

/** 上次选的纸型；没选过时美式英语环境默认 Letter，其余 A4。 */
export function loadPaper() {
  try {
    const saved = localStorage.getItem(PAPER_KEY);
    if (saved && PAPERS[saved]) return saved;
  } catch {
    /* 无痕模式等读不到存储：用默认值 */
  }
  return typeof navigator !== 'undefined' && navigator.language === 'en-US' ? 'letter' : 'a4';
}

export function savePaper(paper) {
  try {
    localStorage.setItem(PAPER_KEY, paper);
  } catch {
    /* 存不了就只在本次生效 */
  }
}

/**
 * 页面图片在纸上的位置（mm）：等比缩放到能放下整页，再水平、垂直居中。
 * 210×270 的页面在 A4 上原尺寸居中（上下各留 13.5mm），在 Letter 上按纸宽放大约 2.8%。
 */
export function placePage(paper, pageWidthMm, pageHeightMm) {
  const p = PAPERS[paper] || PAPERS.a4;
  const scale = Math.min(p.width / pageWidthMm, p.height / pageHeightMm);
  const width = pageWidthMm * scale;
  const height = pageHeightMm * scale;
  return { x: (p.width - width) / 2, y: (p.height - height) / 2, width, height };
}

/** 文件名去掉各系统不允许的字符。 */
export function pdfFileName(title) {
  const base = String(title || 'E4 报告').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim();
  return `${base || 'E4 报告'}.pdf`;
}

/**
 * 把文档里的每一页渲染进 PDF。
 * @param {HTMLElement} docEl  含 .e4-page-shell 的文档根节点（预览浮层里的 .e4-print-doc）
 * @param {{ paper?: 'a4'|'letter', fileName?: string, onProgress?: (done:number, total:number) => void, output?: 'save'|'datauristring' }} opts
 * @returns {Promise<string|undefined>} output 为 datauristring 时返回 PDF 的 data URI（测试用）
 */
export async function exportE4Pdf(docEl, { paper = 'a4', fileName = 'E4 报告.pdf', onProgress, output = 'save' } = {}) {
  const pages = Array.from(docEl?.querySelectorAll('.e4-page-shell') || []);
  if (pages.length === 0) throw new Error('没有可导出的页面');

  if (document.fonts?.ready) await document.fonts.ready;
  const [{ jsPDF }, { domToCanvas }] = await Promise.all([import('jspdf'), import('modern-screenshot')]);

  const p = PAPERS[paper] || PAPERS.a4;
  const pdf = new jsPDF({ unit: 'mm', format: [p.width, p.height], orientation: 'portrait', compress: true });

  for (let i = 0; i < pages.length; i += 1) {
    const page = pages[i];
    const canvas = await domToCanvas(page, {
      scale: RENDER_SCALE,
      backgroundColor: '#ffffff',
      // 编辑用的加行按钮等只在屏幕上出现
      filter: (node) => !node.classList?.contains('no-print'),
    });
    const box = placePage(paper, page.offsetWidth / PX_PER_MM, page.offsetHeight / PX_PER_MM);
    if (i > 0) pdf.addPage([p.width, p.height], 'portrait');
    pdf.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', box.x, box.y, box.width, box.height, undefined, 'FAST');
    onProgress?.(i + 1, pages.length);
    // 让出主线程，进度能刷新、页面不假死
    await new Promise((r) => setTimeout(r, 0));
  }

  if (output === 'datauristring') return pdf.output('datauristring');
  pdf.save(fileName);
  return undefined;
}
