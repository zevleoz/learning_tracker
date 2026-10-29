import { shouldCloseSheet, SHEET_CLOSE_PX, SHEET_CLOSE_VELOCITY } from '../src/lib/sheetDrag.js';

describe('shouldCloseSheet · 下拉关闭弹层', () => {
  test('下拉超过 120px：关闭', () => {
    expect(shouldCloseSheet({ offsetY: SHEET_CLOSE_PX + 1 })).toBe(true);
  });

  test('下拉不足 120px 且不快：不关闭', () => {
    expect(shouldCloseSheet({ offsetY: 60, velocityY: 0 })).toBe(false);
  });

  test('刚好 120px 不算（超过才算）', () => {
    expect(shouldCloseSheet({ offsetY: SHEET_CLOSE_PX })).toBe(false);
  });

  test('位移很小但快速下甩（> 600px/s）：关闭', () => {
    expect(shouldCloseSheet({ offsetY: 40, velocityY: SHEET_CLOSE_VELOCITY + 1 })).toBe(true);
  });

  test('向上拖（负位移 / 负速度）：不关闭', () => {
    expect(shouldCloseSheet({ offsetY: -200, velocityY: -900 })).toBe(false);
  });

  test('缺省参数不关闭', () => {
    expect(shouldCloseSheet()).toBe(false);
    expect(shouldCloseSheet({})).toBe(false);
  });
});
