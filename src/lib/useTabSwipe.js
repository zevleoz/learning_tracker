import { useEffect, useRef } from 'react';

// 页面左右滑切 tab 的判定（纯函数，便于单测）。
// 排除：屏幕左右 24px 边缘（Safari 返回手势）、横向滚动区域（图表等）、
// 输入/可点控件/标了 data-no-swipe 的元素、有 aria-modal 弹层、以及不够“横向”的位移。
const EDGE_PX = 24;
const MIN_DX = 60;
const H_RATIO = 1.5;

// 起点是否在某个横向可滚动元素里
function hasHorizontalScroll(node, win) {
  for (let el = node; el && el.nodeType === 1; el = el.parentElement) {
    const style = win && win.getComputedStyle ? win.getComputedStyle(el) : null;
    if (!style) continue;
    const overflowX = style.overflowX;
    if ((overflowX === 'auto' || overflowX === 'scroll') && el.scrollWidth > el.clientWidth) return true;
  }
  return false;
}

export function shouldSwipe({ startX, dx, dy, viewportW, target } = {}) {
  if (!Number.isFinite(startX) || !Number.isFinite(viewportW) || viewportW <= 0) return false;
  // 1) 贴着屏幕左右边缘：留给 Safari 的返回手势
  if (startX < EDGE_PX || startX > viewportW - EDGE_PX) return false;
  if (!target || typeof target.closest !== 'function') return false;
  // 2) 输入控件 / 滑块 / 可点控件（再记一次的预设、链接等）/ 明确标了 data-no-swipe 的区域
  if (target.closest('input, select, textarea, button, a, [role="slider"], [data-no-swipe]')) return false;
  // 3) 起点在横向滚动区域里（如横向图表）
  const win = target.ownerDocument && target.ownerDocument.defaultView;
  if (hasHorizontalScroll(target, win)) return false;
  // 4) 有面板/弹层打开
  const doc = target.ownerDocument || (typeof document !== 'undefined' ? document : null);
  if (doc && doc.querySelector('[aria-modal="true"]')) return false;
  // 5) 位移必须明显横向：|dx| > 60 且 |dx| > 1.5 × |dy|
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return false;
  const adx = Math.abs(dx);
  if (adx <= MIN_DX) return false;
  if (adx <= Math.abs(dy) * H_RATIO) return false;
  return true;
}

// 只在粗指针（手机 / 平板触摸）上生效；鼠标不触发，桌面行为不变
export function isCoarsePointer(win = typeof window !== 'undefined' ? window : null) {
  try {
    return Boolean(win && win.matchMedia && win.matchMedia('(pointer: coarse)').matches);
  } catch {
    return false;
  }
}

/**
 * 手机页面上左右滑动切换 tab。
 * onSwipe(dir)：dir = -1 上一个、+1 下一个；越界由调用方判断（不循环）。
 */
export function useTabSwipe({ enabled = true, onSwipe } = {}) {
  const startRef = useRef(null);
  const onSwipeRef = useRef(onSwipe);
  useEffect(() => { onSwipeRef.current = onSwipe; }, [onSwipe]);

  useEffect(() => {
    if (!enabled || typeof window === 'undefined' || !isCoarsePointer()) return undefined;

    function onPointerDown(e) {
      if (e.pointerType === 'mouse' || e.isPrimary === false || startRef.current) return;
      startRef.current = { id: e.pointerId, x: e.clientX, y: e.clientY, target: e.target };
    }

    function onPointerUp(e) {
      const start = startRef.current;
      startRef.current = null;
      if (!start || e.pointerId !== start.id) return;
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      const viewportW = window.innerWidth || document.documentElement.clientWidth || 0;
      if (!shouldSwipe({ startX: start.x, dx, dy, viewportW, target: start.target })) return;
      if (onSwipeRef.current) onSwipeRef.current(dx > 0 ? -1 : 1);
    }

    function onPointerCancel() {
      startRef.current = null;
    }

    window.addEventListener('pointerdown', onPointerDown, { passive: true });
    window.addEventListener('pointerup', onPointerUp, { passive: true });
    window.addEventListener('pointercancel', onPointerCancel, { passive: true });
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerCancel);
    };
  }, [enabled]);
}
