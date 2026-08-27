# Plan: 滑轨触控优化 + 导航栏手势确认

## Summary

学生端移动端触控优化，两个改动：

1. **GlassRail 滑轨**：手指触控轨道任意位置即可拖动（不再需要精确点中白色圆点）
2. **导航栏**：已有 swipe 切 tab 逻辑，确认无需额外改动

***

## Current State Analysis

### GlassRail 滑轨（[Learning.jsx#L102-L154](file:///Users/jefflau/projects/一表人才/src/pages/Learning.jsx#L102-L154)）

**问题**：当前使用隐藏的 `<input type="range">` 接收滑动事件。iOS Safari 的原生 range input **不支持"点轨道任意位置跳到该值"**——必须先按住 34px 的 thumb 才能拖动。用户反馈"必须先找到白色圆点才能滑"。

**现有结构**：

* `.glass-rail-track`（48px 高，`padding: 0 20px`，圆角 999px）

  * `.glass-rail-steps`（吸附点）

  * `<input type="range">`（隐藏，`left:20px; right:20px; top:0; bottom:0`，`-webkit-appearance: none`，thumb 34px）

  * `.glass-rail-thumb-wrap`（`pointer-events: none`，纯视觉层）

    * `.glass-rail-thumb`（SVG 28px 圆，active 时 34px）

**关键约束**：13 档客观评价 GlassRail 的索引 0-12 不能破坏，NA 按钮互斥逻辑不受影响，disabled 态不响应。

### 导航栏（[Layout.jsx#L201-L247](file:///Users/jefflau/projects/一表人才/src/components/Layout.jsx#L201-L247)）

**已有**：nav pill 元素上已有 `touchstart/touchmove/touchend` 监听，水平滑动 >40px 切换 tab。逻辑正确：判断当前 tab index → dx<0 右切 / dx>0 左切。**无需改动**。

***

## Proposed Changes

### 改动 A：GlassRail 加自定义 Pointer Events

**文件**：`src/pages/Learning.jsx`（L102-154 GlassRail 组件）+ `src/index.css`（input pointer-events）

#### 方案：在 `.glass-rail-track` div 上加 pointer 事件，隐藏 input 设 `pointer-events: none`

1. **GlassRail 组件新增 ref + pointer handlers**：

```jsx
function GlassRail({ steps, idx, onChange, disabled, labelFn }) {
  const n = steps.length;
  const trackRef = useRef(null);
  const draggingRef = useRef(false);

  // 把 pointer 坐标转换为 step index
  function pointerToStep(clientX) {
    const el = trackRef.current;
    if (!el) return idx;
    const rect = el.getBoundingClientRect();
    // 轨道有效范围：padding 20px 两侧
    const usableLeft = rect.left + 20;
    const usableWidth = rect.width - 40;
    if (usableWidth <= 0) return idx;
    let ratio = (clientX - usableLeft) / usableWidth;
    ratio = Math.max(0, Math.min(1, ratio));
    return Math.round(ratio * (n - 1));
  }

  function onPointerDown(e) {
    if (disabled) return;
    e.target.setPointerCapture(e.pointerId);
    draggingRef.current = true;
    onChange(pointerToStep(e.clientX));
  }
  function onPointerMove(e) {
    if (!draggingRef.current || disabled) return;
    onChange(pointerToStep(e.clientX));
  }
  function onPointerUp(e) {
    draggingRef.current = false;
    try { e.target.releasePointerCapture(e.pointerId); } catch {}
  }

  // ... JSX 中 .glass-rail-track div 加 ref + onPointerDown/Move/Up/Cancel
}
```

1. **JSX 修改**：在 `<div className="glass-rail-track">` 上加：

   * `ref={trackRef}`

   * `onPointerDown={onPointerDown}`

   * `onPointerMove={onPointerMove}`

   * `onPointerUp={onPointerUp}`

   * `onPointerCancel={onPointerUp}`

   * `style={{ touchAction: 'none' }}`（防止滑动时页面滚动）

2. **隐藏 input 改为** **`pointer-events: none`**：

   * 在 CSS `.glass-rail input[type=range]` 加 `pointer-events: none`

   * 这样 input 不再接收 pointer 事件，避免与自定义 handler 冲突

   * input 仍保留在 DOM 中用于键盘无障碍（Tab + 方向键）

3. **disabled 态保护**：`onPointerDown` 第一行 `if (disabled) return`，确保 busy 时不响应

### 改动 B：导航栏 — 无需改动

现有 [Layout.jsx#L201-L247](file:///Users/jefflau/projects/一表人才/src/components/Layout.jsx#L201-L247) 的 swipe 逻辑已正确实现。用户提到"nav bar 也是一个逻辑"，现有代码满足需求。

***

## Assumptions & Decisions

1. **Pointer Events 统一方案**：用 `onPointerDown/Move/Up` 而非分别写 touch + mouse，因为 Pointer Events 在 iOS Safari 13+/Android Chrome 全支持，且天然处理 capture/release
2. **`setPointerCapture`**：手指滑出轨道时仍持续接收事件，不会断拖
3. **保守策略**：不碰 onChange 逻辑、不碰 NA 互斥、不碰 disabled 逻辑、不碰 idx 回显，只在 track div 加事件 + input 加 `pointer-events: none`
4. **不动 CSS 滑轨外观**：只加 `touch-action: none` inline style，不改 gradient/box-shadow/border-radius
5. **导航栏不改**：已有 swipe 逻辑正确且安全

***

## Verification Steps

1. `npx vite build` 零错误通过
2. 移动端打开记录页 → 手指点在滑轨任意位置（不需点中白圆点）→ thumb 跳到该位置 → 手指沿轨道滑动 → thumb 跟随 → 松手 → 值锁定
3. busy 态（提交中）→ 点滑轨无反应
4. NA 按钮互斥 → 点 NA → 滑轨 disabled → 点滑轨无反应
5. 桌面端鼠标 → 点轨道任意位置 → thumb 跳到 → 拖拽跟随（Pointer Events 统一支持鼠标）
6. 键盘 → Tab 到滑轨 → 方向键调值（input 仍可键盘操作）
7. 导航栏 → 在 nav pill 上左右滑 → 切 tab（已有功能验证）

