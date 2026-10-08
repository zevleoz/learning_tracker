import { render, act } from '@testing-library/react';
import { useMergedAutosave } from '../src/lib/useAutosave.js';

jest.mock('../src/lib/toast.js', () => ({ toast: jest.fn() }));
// eslint-disable-next-line import/first
import { toast } from '../src/lib/toast.js';

// BUG-1：多个数据源（form_data / minutes_text / 日期）共用一个待存区，
// 否则后一次 persist 的 clearTimeout 会把前一次不同字段的改动一起取消。
function Probe({ save, delay = 700 }) {
  const api = useMergedAutosave(save, { delay });
  Probe.api = api;
  return <div data-testid="save-state">{api.saveState}</div>;
}

describe('useMergedAutosave', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
    Probe.api = null;
  });

  it('窗口内不同字段的改动合并为一次保存', async () => {
    const save = jest.fn().mockResolvedValue(undefined);
    render(<Probe save={save} />);

    // 首次保存立即执行（页面加载后的首次落盘）
    act(() => { Probe.api.persist({ form_data: { a: 1 } }); });
    await act(async () => { jest.advanceTimersByTime(0); });
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenLastCalledWith({ form_data: { a: 1 } });

    // 300ms 内先改表单，再改会议纪要：两次改动必须一起保存
    act(() => { Probe.api.persist({ form_data: { a: 2 } }); });
    await act(async () => { jest.advanceTimersByTime(300); });
    act(() => { Probe.api.persist({ minutes_text: '纪要内容' }); });
    await act(async () => { jest.advanceTimersByTime(700); });

    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenLastCalledWith({ form_data: { a: 2 }, minutes_text: '纪要内容' });
  });

  it('日期字段与表单字段同样合并', async () => {
    const save = jest.fn().mockResolvedValue(undefined);
    render(<Probe save={save} />);

    act(() => { Probe.api.persist({ form_data: { a: 1 } }); });
    await act(async () => { jest.advanceTimersByTime(0); });

    act(() => {
      Probe.api.persist({ meeting_date: '2026-10-01' });
      Probe.api.persist({ report_date: '2026-10-08' });
      Probe.api.persist({ minutes_text: 'M' });
    });
    await act(async () => { jest.advanceTimersByTime(700); });

    expect(save).toHaveBeenLastCalledWith({
      meeting_date: '2026-10-01', report_date: '2026-10-08', minutes_text: 'M',
    });
  });

  it('保存失败：内容合回待存区，下次改动静默重试且不丢字段', async () => {
    const save = jest.fn()
      .mockResolvedValueOnce(undefined)          // 首次成功
      .mockRejectedValueOnce(new Error('offline')); // 第二次失败
    render(<Probe save={save} />);

    act(() => { Probe.api.persist({ form_data: { a: 1 } }); });
    await act(async () => { jest.advanceTimersByTime(0); });

    act(() => { Probe.api.persist({ form_data: { a: 2 } }); });
    await act(async () => { jest.advanceTimersByTime(700); });
    expect(save).toHaveBeenCalledTimes(2);
    expect(toast).toHaveBeenCalled();

    // 失败内容 + 新改动一起重试
    act(() => { Probe.api.persist({ minutes_text: 'M' }); });
    await act(async () => { jest.advanceTimersByTime(700); });
    expect(save).toHaveBeenLastCalledWith({ form_data: { a: 2 }, minutes_text: 'M' });
  });

  it('卸载时立即落盘，不等延时结束', async () => {
    const save = jest.fn().mockResolvedValue(undefined);
    const { unmount } = render(<Probe save={save} />);

    act(() => { Probe.api.persist({ form_data: { a: 1 } }); });
    await act(async () => { jest.advanceTimersByTime(0); });

    act(() => { Probe.api.persist({ minutes_text: 'M' }); });
    unmount();
    await act(async () => { jest.advanceTimersByTime(0); });

    expect(save).toHaveBeenLastCalledWith({ minutes_text: 'M' });
  });
});