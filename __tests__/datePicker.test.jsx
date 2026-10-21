import { render, screen, fireEvent } from '@testing-library/react';
import { isValid } from 'date-fns';
import { DatePicker, parseRangeValue } from '../src/components/ui/date-picker.jsx';

describe('parseRangeValue', () => {
  it('完整范围解析出起止日', () => {
    const r = parseRangeValue('2026-10-01~2026-10-07');
    expect(r).not.toBeNull();
    expect(isValid(r.from)).toBe(true);
    expect(isValid(r.to)).toBe(true);
  });

  it('仅起点（尾部波浪线）to 为 null', () => {
    const r = parseRangeValue('2026-10-01~');
    expect(r).not.toBeNull();
    expect(isValid(r.from)).toBe(true);
    expect(r.to).toBeNull();
  });

  it('无波浪线的单日也可作为范围起点', () => {
    const r = parseRangeValue('2026-10-01');
    expect(r).not.toBeNull();
    expect(isValid(r.from)).toBe(true);
    expect(r.to).toBeNull();
  });

  it('空值与非法串返回 null', () => {
    expect(parseRangeValue('')).toBeNull();
    expect(parseRangeValue(undefined)).toBeNull();
    expect(parseRangeValue(null)).toBeNull();
    expect(parseRangeValue('待定')).toBeNull();
    expect(parseRangeValue('2026/10/01~2026/10/07')).toBeNull();
  });
});

describe('DatePicker 渲染冒烟：非法值不再抛异常', () => {
  it('单选合法值按 displayFormat 显示', () => {
    render(<DatePicker value="2026-10-01" displayFormat="yyyy-MM-dd" />);
    expect(screen.getByText('2026-10-01')).toBeInTheDocument();
  });

  it('范围值显示 from ~ to', () => {
    render(<DatePicker range value="2026-10-01~2026-10-07" displayFormat="yyyy-MM-dd" />);
    expect(screen.getByText('2026-10-01 ~ 2026-10-07')).toBeInTheDocument();
  });

  it('范围仅起点时只显示起点', () => {
    render(<DatePicker range value="2026-10-01~" displayFormat="yyyy-MM-dd" />);
    expect(screen.getByText('2026-10-01')).toBeInTheDocument();
  });

  it('非法单值按空值渲染 placeholder（曾经的崩溃类）', () => {
    render(<DatePicker value="2026-10-01~2026-10-07" placeholder="选择日期" displayFormat="yyyy-MM-dd" />);
    expect(screen.getByText('选择日期')).toBeInTheDocument();
  });

  it('完全无法解析的值也不抛异常', () => {
    render(<DatePicker value="待定" placeholder="选择日期" />);
    expect(screen.getByText('选择日期')).toBeInTheDocument();
  });
});

describe('DatePicker 范围交互', () => {
  const dayEl = (iso) => document.querySelector(`[data-day="${iso}"] button`);
  // 用 value 固定默认月份为 2026-10，避免测试依赖运行日期
  const openRange = (value) => (
    <DatePicker range defaultOpen value={value} displayFormat="yyyy-MM-dd" onChange={openRange.spy} />
  );
  beforeEach(() => { openRange.spy = jest.fn(); });
  afterEach(() => jest.clearAllMocks());

  it('已有完整范围时点击新起点 → 重开一段新范围', () => {
    render(openRange('2026-10-05~2026-10-08'));
    fireEvent.click(dayEl('2026-10-20'));
    fireEvent.click(dayEl('2026-10-22'));
    expect(openRange.spy).toHaveBeenCalledWith('2026-10-20~2026-10-22');
  });

  it('拖动（按下起点 → 滑过结束点 → 松开）→ 一次写入范围', () => {
    render(openRange('2026-10-05~2026-10-08'));
    fireEvent.mouseDown(dayEl('2026-10-10'));
    fireEvent.mouseOver(dayEl('2026-10-15'));
    fireEvent.mouseUp(window);
    expect(openRange.spy).toHaveBeenCalledWith('2026-10-10~2026-10-15');
  });

  it('反向拖动（结束点在起点之前）也成立', () => {
    render(openRange('2026-10-05'));
    fireEvent.mouseDown(dayEl('2026-10-20'));
    fireEvent.mouseOver(dayEl('2026-10-12'));
    fireEvent.mouseUp(window);
    expect(openRange.spy).toHaveBeenCalledWith('2026-10-12~2026-10-20');
  });

  it('仅按下原地松开（未位移）不写入，交给点击流', () => {
    render(openRange('2026-10-05~2026-10-08'));
    fireEvent.mouseDown(dayEl('2026-10-20'));
    fireEvent.mouseUp(window);
    expect(openRange.spy).not.toHaveBeenCalled();
  });

  it('拖动预览时区间中段带 day-range-middle（露出灰色带），端点不带', () => {
    render(openRange('2026-10-05~2026-10-08'));
    fireEvent.mouseDown(dayEl('2026-10-10'));
    fireEvent.mouseOver(dayEl('2026-10-15'));
    const mid = document.querySelector('[data-day="2026-10-12"]');
    const start = document.querySelector('[data-day="2026-10-10"]');
    const end = document.querySelector('[data-day="2026-10-15"]');
    expect(mid.className).toContain('day-range-middle');
    expect(start.className).not.toContain('day-range-middle');
    expect(end.className).not.toContain('day-range-middle');
  });

  it('只选中起点后，鼠标悬停（不按下）即预览灰度区间', () => {
    render(openRange('2026-10-05'));
    fireEvent.mouseOver(dayEl('2026-10-10'));
    expect(document.querySelector('[data-day="2026-10-07"]').className).toContain('day-range-middle');
    expect(document.querySelector('[data-day="2026-10-10"]').className).not.toContain('day-range-middle');
    expect(openRange.spy).not.toHaveBeenCalled();
  });

  it('悬停预览后再点击落点 → 写入一次完整范围', () => {
    render(openRange('2026-10-05'));
    fireEvent.mouseOver(dayEl('2026-10-10'));
    fireEvent.click(dayEl('2026-10-10'));
    expect(openRange.spy).toHaveBeenCalledTimes(1);
    expect(openRange.spy).toHaveBeenCalledWith('2026-10-05~2026-10-10');
  });

  it('悬停到起点之前的日期也预览，点击后按先后排序写入', () => {
    render(openRange('2026-10-15'));
    fireEvent.mouseOver(dayEl('2026-10-08'));
    expect(document.querySelector('[data-day="2026-10-11"]').className).toContain('day-range-middle');
    fireEvent.click(dayEl('2026-10-08'));
    expect(openRange.spy).toHaveBeenCalledWith('2026-10-08~2026-10-15');
  });

  it('未选起点时悬停不产生预览', () => {
    render(openRange('2026-10-05~2026-10-08'));
    fireEvent.mouseOver(dayEl('2026-10-20'));
    expect(document.querySelector('[data-day="2026-10-12"]').className).not.toContain('day-range-middle');
    expect(openRange.spy).not.toHaveBeenCalled();
  });
});
