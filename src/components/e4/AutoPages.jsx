// E4 打印自适应分页容器：两阶段渲染。
// 1. 隐藏测量容器（与纸张同宽 178mm 内宽）渲染全部单元，读取每个 block / 表格行的实测高度；
// 2. 用 paginateUnits 打包成若干 A4 页，逐页渲染 PageShell，页码按实际页数动态生成。
// 屏幕预览与打印走同一渲染结果，所见即所印。
import { useLayoutEffect, useRef, useState } from 'react';
import { paginateUnits } from '../../lib/e4Pagination.js';

// 纸张内尺寸：210mm − 左右各 16mm；内容区高 = 297mm − 上 16mm − 下 14mm
const INNER_WIDTH_MM = 178;
const INNER_HEIGHT_MM = 267;
const SAFETY_MM = 6; // 安全余量：吸收 offsetTop/offsetHeight 取整与打印缩放误差

function UnitView({ unit, slice }) {
  if (unit.kind === 'table') {
    const rows = slice ? unit.rows.slice(slice.start, slice.end) : unit.rows;
    return (
      <div className="e4-pg-unit">
        <table className={unit.tableClassName || 'e4-navy-table'}>
          {unit.head}
          <tbody>{rows}</tbody>
        </table>
      </div>
    );
  }
  return <div className="e4-pg-unit">{unit.node}</div>;
}

function PageShell({ cover, chapterLabel, chapterTint = 'red', studentLine, brandKicker, footerCenter, pageIndex, totalPages, children }) {
  return (
    <section className={`e4-print-page e4-page-shell ${cover ? 'is-cover' : ''}`}>
      {!cover && (
        <div className={`e4-chapter-strip e4-tint-${chapterTint}`}>
          <div className="e4-chapter-left">
            <span className="e4-chapter-dot">●</span>
            <span className="e4-chapter-label">{chapterLabel}</span>
          </div>
          <div className="e4-chapter-right">{studentLine}</div>
        </div>
      )}
      {cover && <div className="e4-cover-top-spacer" />}
      <div className="e4-page-body">{children}</div>
      <footer className="e4-page-footer">
        <span className="e4-foot-brand">{brandKicker}</span>
        {footerCenter && <span className="e4-foot-template">{footerCenter}</span>}
        <span className="e4-foot-page">第 {pageIndex} 页 / 共 {totalPages} 页</span>
      </footer>
    </section>
  );
}

// jsdom 无布局（offsetHeight 恒为 0），测试环境跳过测量，直接按 section 一壳一页渲染
const IS_TEST = typeof process !== 'undefined' && process.env?.NODE_ENV === 'test';

export default function AutoPages({ sections, brandKicker, footerCenter, docClassName = '' }) {
  const measureRef = useRef(null);
  const lastSigRef = useRef('');
  const [paged, setPaged] = useState(null); // [{ si, unitSlices, continued }...] 拍平后的页列表

  useLayoutEffect(() => {
    if (IS_TEST) return undefined;
    const el = measureRef.current;
    if (!el) return undefined;
    const timer = setTimeout(() => {
      // 实测 1mm → px：必须用 getBoundingClientRect（offsetHeight 会把 1mm≈3.7795px 取整成 4px，
      // 导致整页预算被放大约 6%，内容溢出产生空白页）
      const probe = el.querySelector('.e4-pg-mmprobe');
      const pxPerMm = probe ? probe.getBoundingClientRect().height : 3.7795;
      const innerPx = INNER_HEIGHT_MM * pxPerMm;
      const safetyPx = SAFETY_MM * pxPerMm;

      const flat = [];
      sections.forEach((section, si) => {
        // 同 section 内按文档顺序取单元节点，用相邻 offsetTop 差值推算实际占位高度
        // （含 unit 自身的上/下 margin；相邻 margin 折叠在差值中自然体现）。
        // 测量容器与正式渲染的包裹结构相同（.e4-pg-unit，flow-root），保证两条路径高度一致。
        const pairs = section.units
          .map((unit, ui) => ({ unit, ui, node: el.querySelector(`[data-e4-unit="${si}-${ui}"]`) }))
          .filter((p) => p.node);
        pairs.forEach(({ unit, ui, node }, idx) => {
          const next = pairs[idx + 1];
          const occupied = next
            ? next.node.offsetTop - node.offsetTop
            : node.getBoundingClientRect().height; // section 末尾单元：含下 margin 的自身高度
          if (unit.kind === 'table') {
            const trs = Array.from(node.querySelectorAll('tbody tr'));
            flat.push({
              id: `${si}-${ui}`,
              kind: 'table',
              height: occupied,
              rowHeights: trs.map((tr) => tr.getBoundingClientRect().height),
            });
          } else {
            flat.push({ id: `${si}-${ui}`, kind: 'block', height: occupied });
          }
        });
      });

      const pages = [];
      sections.forEach((section, si) => {
        const units = section.units.map((_, ui) => flat.find((f) => f.id === `${si}-${ui}`)).filter(Boolean);
        const sectionPages = paginateUnits(units, innerPx, safetyPx);
        sectionPages.forEach((unitSlices, pi) => {
          // 只存 section 下标与切片，渲染时取当前 sections，避免内容变化但高度不变时出现陈旧节点
          pages.push({ si, unitSlices, continued: pi > 0 });
        });
      });
      // 高度签名不变则跳过，避免 setState 引发的重复重排
      const sig = flat.map((f) => `${f.id}:${f.height}:${(f.rowHeights || []).join(',')}`).join('|');
      if (sig !== lastSigRef.current) {
        lastSigRef.current = sig;
        setPaged(pages);
      }
    }, 150); // 防抖：可编辑模式输入抖动时合并重排
    return () => clearTimeout(timer);
  }, [sections]);

  const totalPages = paged ? paged.length : 0;

  return (
    <div className={`e4-print-doc ${docClassName}`}>
      {/* 测量容器：屏幕与打印均不可见 */}
      {!IS_TEST && (
        <div className="e4-pg-measure" ref={measureRef} aria-hidden="true">
        <div className="e4-pg-mmprobe" style={{ height: '1mm' }} />
        {sections.map((section, si) =>
          section.units.map((unit, ui) => (
            <div key={`${si}-${ui}`} data-e4-unit={`${si}-${ui}`} className="e4-pg-unit">
              {unit.kind === 'table' ? (
                <table className={unit.tableClassName || 'e4-navy-table'}>
                  {unit.head}
                  <tbody>{unit.rows}</tbody>
                </table>
              ) : (
                unit.node
              )}
            </div>
          ))
        )}
        </div>
      )}

      {/* 渲染阶段：首帧（未测量）按原顺序渲染，测量完成后按页渲染 */}
      {!paged
        ? sections.map((section, si) => (
            <PageShell
              key={section.key ?? si}
              cover={section.cover}
              chapterLabel={section.chapterLabel}
              chapterTint={section.chapterTint}
              studentLine={section.studentLine}
              brandKicker={brandKicker}
              footerCenter={footerCenter}
              pageIndex={si + 1}
              totalPages={sections.length}
            >
              {section.units.map((unit, ui) => <UnitView key={ui} unit={unit} />)}
            </PageShell>
          ))
        : paged.map((page, i) => {
            const section = sections[page.si];
            return (
              <PageShell
                key={i}
                cover={section.cover}
                chapterLabel={page.continued ? `${section.chapterLabel}（续）` : section.chapterLabel}
                chapterTint={section.chapterTint}
                studentLine={section.studentLine}
                brandKicker={brandKicker}
                footerCenter={footerCenter}
                pageIndex={i + 1}
                totalPages={totalPages}
              >
                {page.unitSlices.map((slice, si2) => {
                  const unit = section.units[Number(slice.id.split('-')[1])];
                  return <UnitView key={si2} unit={unit} slice={slice} />;
                })}
              </PageShell>
            );
          })}
    </div>
  );
}
