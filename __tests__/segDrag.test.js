import { segIndexNear } from '../src/lib/segDrag.js';

// 三格等宽：0–66、67–133、134–200
const RECTS = [
  { left: 0, right: 66, top: 0, bottom: 34 },
  { left: 67, right: 133, top: 0, bottom: 34 },
  { left: 134, right: 200, top: 0, bottom: 34 },
];

describe('segIndexNear · 手指落在哪一格', () => {
  test('落在格子里：直接命中', () => {
    expect(segIndexNear(30, RECTS)).toBe(0);
    expect(segIndexNear(100, RECTS)).toBe(1);
    expect(segIndexNear(170, RECTS)).toBe(2);
  });

  test('落在两格之间的缝里：取最近一格', () => {
    expect(segIndexNear(66.5, RECTS)).toBe(0);
    expect(segIndexNear(67.5, RECTS)).toBe(1);
  });

  test('滑出控件左右边界：夹到首 / 末格', () => {
    expect(segIndexNear(-40, RECTS)).toBe(0);
    expect(segIndexNear(260, RECTS)).toBe(2);
  });

  test('没有格子 / 坐标无效：返回 -1', () => {
    expect(segIndexNear(100, [])).toBe(-1);
    expect(segIndexNear(100, null)).toBe(-1);
    expect(segIndexNear(NaN, RECTS)).toBe(-1);
    expect(segIndexNear(Infinity, RECTS)).toBe(-1);
  });
});
