import fs from 'fs';
import path from 'path';
import { render, screen, fireEvent } from '@testing-library/react';
import { parseE4Protocol } from '../src/lib/e4ProtocolParser.js';
import { buildReportDraft } from '../src/lib/e4ReportTemplate.js';
import FirstReportPrint from '../src/components/e4/FirstReportPrint.jsx';

// PDF（最终文档）里的「下次复盘 / 时间」格必须能直接用同一套日期范围选择器填写：
// 点击单元格 → 日历弹层 → 悬停预览灰带 → 点击落点 → onPatch 写回 s07.nextReviewDate。
const leoMd = fs.readFileSync(path.join(__dirname, 'fixtures', 'e4_protocol_25_leo.md'), 'utf8');

function makeReport() {
  const draft = buildReportDraft(parseE4Protocol(leoMd));
  draft.section07.nextReviewDate = '2026-10-10~2026-10-17';
  draft.section07.nextReviewFocus = '减少提醒后能否自主启动。';
  return {
    id: 'test-leo',
    meeting_date: '2026-09-12',
    report_date: '2026-09-16',
    status: 'final',
    form_data: draft,
  };
}

const dayEl = (iso) => document.querySelector(`[data-day="${iso}"] button`);

describe('最终文档（PDF 版式）里的下次复盘日期范围', () => {
  it('只读版按中文范围显示', () => {
    render(<FirstReportPrint report={makeReport()} />);
    expect(screen.getAllByText('2026年10月10日 ~ 2026年10月17日').length).toBeGreaterThan(0);
  });

  it('可编辑版点击「时间」格 → 重选范围时悬停预览并写回', () => {
    const onPatch = jest.fn();
    render(<FirstReportPrint report={makeReport()} editable onPatch={onPatch} />);

    fireEvent.click(screen.getAllByText('2026年10月10日 ~ 2026年10月17日')[0]);

    // 点新起点后，鼠标划过即可预览（10-18 原本不在旧范围里）
    fireEvent.click(dayEl('2026-10-20'));
    fireEvent.mouseOver(dayEl('2026-10-23'));
    expect(document.querySelector('[data-day="2026-10-21"]').className).toContain('day-range-middle');
    expect(onPatch).not.toHaveBeenCalled();

    fireEvent.click(dayEl('2026-10-23'));
    expect(onPatch).toHaveBeenCalledWith(
      { area: 's07', key: 'nextReviewDate' },
      '2026-10-20~2026-10-23'
    );
  });
});
