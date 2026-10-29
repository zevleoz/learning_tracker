import { useEffect, useRef } from 'react';

// 横向滑动才算拖动：超过这个距离、且比纵向更明显，才接管手势
const START_PX = 8;

// 手指横坐标落在哪一格（传入每个按钮的 DOMRect）；落在间隙或控件外时取最近一格
export function segIndexNear(clientX, rects) {
  if (!Array.isArray(rects) || !rects.length || !Number.isFinite(clientX)) return -1;
  let best = -1;
  let bestDist = Infinity;
  for (let i = 0; i < rects.length; i++) {
    const r = rects[i];
    if (!r) continue;
    if (clientX >= r.left && clientX <= r.right) return i;
    const dist = Math.abs(clientX - (r.left + r.right) / 2);
    if (dist < bestDist) { bestDist = dist; best = i; }
  }
  return best;
}

/**
 * 分段控件：按住横向滑动，选手指下那一格（点按仍走 click，行为不变）。
 * onPick(index)：按 <div> 里按钮的顺序给下标，由调用方映射成值 / tab。
 * 返回 { ref, onPointerDown, shouldSkipClick }；按钮的 onClick 先问 shouldSkipClick，滑动后再补上的 click 不重复选。
 */
export function useSegDrag({ onPick, disabled = false } = {}) {
  const rootRef = useRef(null);
  const gesture = useRef(null);   // { id, x, y, active, lastIdx }
  const listeners = useRef(null);
  const skipClick = useRef(false);
  const onPickRef = useRef(onPick);
  useEffect(() => { onPickRef.current = onPick; }, [onPick]);

  function detach() {
    const l = listeners.current;
    if (!l) return;
    window.removeEventListener('pointermove', l.move);
    window.removeEventListener('pointerup', l.up);
    window.removeEventListener('pointercancel', l.up);
    listeners.current = null;
  }

  useEffect(() => () => detach(), []);

  function pickAt(clientX) {
    const root = rootRef.current;
    const g = gesture.current;
    if (!root || !g) return;
    const rects = Array.from(root.querySelectorAll('button'), b => b.getBoundingClientRect());
    const idx = segIndexNear(clientX, rects);
    if (idx < 0 || idx === g.lastIdx) return;
    g.lastIdx = idx;
    onPickRef.current?.(idx);
  }

  function onPointerDown(e) {
    if (disabled) return;
    if (e.pointerType === 'mouse' && e.button > 0) return;
    skipClick.current = false;
    detach();
    gesture.current = { id: e.pointerId, x: e.clientX, y: e.clientY, active: false, lastIdx: -1 };
    const move = (ev) => {
      const g = gesture.current;
      if (!g) return;
      if (g.id !== undefined && ev.pointerId !== undefined && ev.pointerId !== g.id) return;
      const dx = ev.clientX - g.x;
      const dy = ev.clientY - g.y;
      if (!g.active) {
        if (Math.abs(dx) <= START_PX || Math.abs(dx) <= Math.abs(dy)) return;
        g.active = true;
      }
      pickAt(ev.clientX);
    };
    const up = () => {
      const g = gesture.current;
      gesture.current = null;
      if (g?.active) {
        // 拖动结束后浏览器可能还会补一个 click；别让它把停下的那格改回按下的那格
        skipClick.current = true;
        setTimeout(() => { skipClick.current = false; }, 0);
      }
      detach();
    };
    listeners.current = { move, up };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  function shouldSkipClick() {
    if (!skipClick.current) return false;
    skipClick.current = false;
    return true;
  }

  return { ref: rootRef, onPointerDown, shouldSkipClick };
}
