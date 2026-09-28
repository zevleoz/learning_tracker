import fs from 'fs';
import path from 'path';
import { render, screen, fireEvent } from '@testing-library/react';
import { parseE4Protocol } from '../src/lib/e4ProtocolParser.js';
import {
  PREP_DIMENSION_ORDER, PREP_ROWS, PREP_STATIC, buildPrepDraft,
} from '../src/lib/e4PrepTemplate.js';
import PrepPrint from '../src/components/e4/PrepPrint.jsx';

const fixturesDir = path.join(__dirname, 'fixtures');
const leoMd = fs.readFileSync(path.join(fixturesDir, 'e4_protocol_25_leo.md'), 'utf8');
const catherineMd = fs.readFileSync(path.join(fixturesDir, 'e4_protocol_27_catherine.md'), 'utf8');

const student = { display_name: 'Leo', grade: 'G9', school: '鼎石' };

describe('E4 会前准备模板', () => {
  test('buildPrepDraft 生成 32 行并按维度分组', () => {
    const draft = buildPrepDraft(parseE4Protocol(leoMd), student);
    const total = PREP_DIMENSION_ORDER.reduce((n, c) => n + draft.prepRows[c].length, 0);
    expect(total).toBe(PREP_ROWS.length); // 32
    expect(draft.prepRows.E1).toHaveLength(8);
    expect(draft.prepRows.E2).toHaveLength(6);
    expect(draft.prepRows.E3).toHaveLength(11);
    expect(draft.prepRows.E4).toHaveLength(7);
  });

  test('每行自动录入协议 VERDICT 原文；E2 为模块级判断', () => {
    const draft = buildPrepDraft(parseE4Protocol(leoMd), student);
    for (const code of PREP_DIMENSION_ORDER) {
      draft.prepRows[code].forEach((r) => {
        expect(r.verdictText).toBeTruthy();
        expect(r.ask).toBeTruthy(); // 确认现象默认文案
        expect(r.checked).toBe(false);
      });
    }
    // E2 六行共享同一模块级判断
    const texts = new Set(draft.prepRows.E2.map((r) => r.verdictText));
    expect(texts.size).toBe(1);
    expect(draft.prepRows.E2[0].verdict).toBeTruthy();
  });

  test('封面/资料/学科初始结构', () => {
    const draft = buildPrepDraft(parseE4Protocol(catherineMd), student);
    expect(draft.prepCover.studentName).toBe('Leo');
    expect(draft.prepCover.gradeSchool).toBe('G9 · 鼎石');
    expect(draft.sources).toHaveLength(PREP_STATIC.sources.length);
    expect(draft.sources.find((s) => s.key === 'y4').content)
      .toBe('测评日期、E4分析及需要关注的方向');
    // 「会前已有内容」每行均预填通用清单文案
    draft.sources.forEach((s) => expect(s.content).toBeTruthy());
    expect(draft.sources.find((s) => s.key === 'parent').content)
      .toBe('家庭最希望解决的问题、持续时间及已经尝试的方法');
    expect(draft.sources.find((s) => s.key === 'other').content)
      .toBe('教师反馈、既往尝试、作息或其他相关信息');
    expect(draft.subjects).toHaveLength(6);
    expect(draft.growthMap).toBeNull();
  });

  test('PrepPrint 只读渲染：七页 + 关键区块 + VERDICT 原文', () => {
    const draft = buildPrepDraft(parseE4Protocol(leoMd), student);
    const { container } = render(<PrepPrint report={{ form_data: draft }} />);
    expect(container.querySelectorAll('.e4-print-page')).toHaveLength(7);
    expect(screen.getByText('首次学习力会议会前准备')).toBeInTheDocument();
    expect(screen.getByText('会议固定结构')).toBeInTheDocument();
    expect(screen.getByText('学科线索与重点排序')).toBeInTheDocument();
    // E2 模块级判断合并为一个单元格（rowspan=6）
    const merged = container.querySelector('td[rowspan="6"]');
    expect(merged).toBeTruthy();
    expect(merged.textContent).toContain(draft.prepRows.E2[0].verdictText.slice(0, 10));
  });

  test('PrepPrint 只读渲染：存量报告空 content 回落到默认预填文案', () => {
    const draft = buildPrepDraft(parseE4Protocol(leoMd), student);
    // 模拟旧数据：sources[].content 均为空
    draft.sources = draft.sources.map((s) => ({ ...s, content: '' }));
    const { container } = render(<PrepPrint report={{ form_data: draft }} />);
    PREP_STATIC.sources.forEach((meta) => {
      expect(container.textContent).toContain(meta.contentHint);
    });
  });

  test('PrepPrint 可编辑模式：勾选与封面编辑回写', () => {
    const draft = buildPrepDraft(parseE4Protocol(leoMd), student);
    const patches = [];
    const onPatch = (d, v) => patches.push([d, v]);
    const { container } = render(
      <PrepPrint report={{ form_data: draft }} editable onPatch={onPatch} onTableOp={() => {}} />
    );
    // 点击 E1 第一行的重点勾选框
    const firstCheck = container.querySelector('.e4-prep-confirm .e4-prep-check');
    fireEvent.click(firstCheck);
    expect(patches[0][0]).toMatchObject({ area: 'row', dim: 'E1', field: 'checked' });
    expect(patches[0][1]).toBe(true);
  });
});
