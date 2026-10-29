import { shouldSwipe } from '../src/lib/useTabSwipe.js';

function makeTarget(tag = 'div') {
  const el = document.createElement(tag);
  document.body.appendChild(el);
  return el;
}

function swipe(target, overrides = {}) {
  return shouldSwipe({
    startX: 120,
    dx: -150,
    dy: 20,
    viewportW: 375,
    target,
    ...overrides,
  });
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('shouldSwipe · 正常情况', () => {
  it('明显横向滑动（|dx| > 60 且 |dx| > 1.5|dy|）才放行', () => {
    expect(swipe(makeTarget())).toBe(true);
    expect(swipe(makeTarget(), { dx: 150 })).toBe(true); // 右滑同样成立
  });

  it('参数缺失或视口为 0 时拒绝', () => {
    expect(shouldSwipe()).toBe(false);
    expect(swipe(makeTarget(), { viewportW: 0 })).toBe(false);
    expect(swipe(null)).toBe(false);
  });
});

describe('shouldSwipe · 排除项', () => {
  it('起点在屏幕左右 24px 内：留给 Safari 返回手势', () => {
    expect(swipe(makeTarget(), { startX: 10 })).toBe(false);
    expect(swipe(makeTarget(), { startX: 370 })).toBe(false);
    expect(swipe(makeTarget(), { startX: 120 })).toBe(true);
  });

  it('起点在 input / select / textarea / [role=slider] / 可点控件 / [data-no-swipe] 内', () => {
    const input = makeTarget('input');
    expect(swipe(input)).toBe(false);

    const select = makeTarget('select');
    expect(swipe(select)).toBe(false);

    const textarea = makeTarget('textarea');
    expect(swipe(textarea)).toBe(false);

    const slider = makeTarget();
    slider.setAttribute('role', 'slider');
    expect(swipe(slider)).toBe(false);

    // 「再记一次」的预设是 button，滑它不应切页
    const button = makeTarget('button');
    expect(swipe(button)).toBe(false);

    const link = makeTarget('a');
    expect(swipe(link)).toBe(false);

    const noSwipe = makeTarget();
    noSwipe.setAttribute('data-no-swipe', '');
    const child = document.createElement('span');
    noSwipe.appendChild(child);
    expect(swipe(child)).toBe(false);
  });

  it('起点在横向滚动区域里（图表等）', () => {
    const scroller = document.createElement('div');
    scroller.style.overflowX = 'auto';
    Object.defineProperty(scroller, 'scrollWidth', { value: 320, configurable: true });
    Object.defineProperty(scroller, 'clientWidth', { value: 180, configurable: true });
    const row = document.createElement('span');
    scroller.appendChild(row);
    document.body.appendChild(scroller);

    expect(swipe(row)).toBe(false);

    // 同样设置 overflow 但内容没溢出 → 不算横向滚动
    Object.defineProperty(scroller, 'scrollWidth', { value: 180, configurable: true });
    expect(swipe(row)).toBe(true);
  });

  it('有面板/弹层打开（aria-modal）时不滑', () => {
    const dlg = document.createElement('div');
    dlg.setAttribute('aria-modal', 'true');
    document.body.appendChild(dlg);
    expect(swipe(makeTarget())).toBe(false);
  });

  it('位移不够横向：不到 60px，或不够“横”', () => {
    expect(swipe(makeTarget(), { dx: -60 })).toBe(false);
    expect(swipe(makeTarget(), { dx: -90, dy: 80 })).toBe(false); // 90 <= 1.5 × 80
    expect(swipe(makeTarget(), { dx: -90, dy: 50 })).toBe(true);  // 90 > 1.5 × 50
  });

  it('纵向为主的滑动不触发', () => {
    expect(swipe(makeTarget(), { dx: -30, dy: -200 })).toBe(false);
  });
});
