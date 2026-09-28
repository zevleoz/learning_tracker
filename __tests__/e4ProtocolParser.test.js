import fs from 'fs';
import path from 'path';
import { parseE4Protocol, buildEvalIndex } from '../src/lib/e4ProtocolParser.js';
import {
  CHECKLIST_ROWS,
  DIMENSION_ORDER,
  JUDGMENT_STATES,
  buildReportDraft,
  deriveConfirmedIssues,
} from '../src/lib/e4ReportTemplate.js';

const fixturesDir = path.join(__dirname, 'fixtures');
const leoMd = fs.readFileSync(path.join(fixturesDir, 'e4_protocol_25_leo.md'), 'utf8');
const catherineMd = fs.readFileSync(path.join(fixturesDir, 'e4_protocol_27_catherine.md'), 'utf8');

describe('E4 protocol parser', () => {
  test('parses Leo fixture into 4 dimensions with expected question counts', () => {
    const p = parseE4Protocol(leoMd);
    expect(p.version).toBe('v1.2');
    expect(p.dimensionOrder).toEqual(['E1', 'E2', 'E3', 'E4']);
    expect(p.dimensions.E1.questions).toHaveLength(8);
    expect(p.dimensions.E2.questions).toHaveLength(0);
    expect(p.dimensions.E2.block).toBeTruthy();
    expect(p.dimensions.E3.questions).toHaveLength(11);
    expect(p.dimensions.E4.questions).toHaveLength(8);
  });

  test('captures verdict/list/topic/evals/refs/judgment per question', () => {
    const p = parseE4Protocol(leoMd);
    const confidence = p.dimensions.E1.questions[0];
    expect(confidence.verdict).toBe('健康');
    expect(confidence.list).toBe('强潜能');
    expect(confidence.evals.length).toBeGreaterThanOrEqual(2);
    expect(confidence.evals[0]).toMatchObject({ metric: expect.any(String) });
    expect(confidence.judgment).toContain('自信');

    const parent = p.dimensions.E1.questions.find((q) => q.title.includes('亲子关系'));
    expect(parent.evals.some((e) => e.metric.includes('亲近-母亲'))).toBe(true);
    expect(parent.evals.find((e) => e.metric.includes('信任-母亲')).note).toMatch(/满分/);

    const logic = p.dimensions.E4.questions.find((q) => q.title.includes('第一组'));
    expect(logic.refs.length).toBeGreaterThan(0);
    expect(logic.refs[0].metric).toContain('推理能力');
  });

  test('parses META, core problems, follow-up leads and overview strengths', () => {
    const p = parseE4Protocol(leoMd);
    expect(p.meta.student).toBe('Leo');
    expect(p.meta.grade).toBe('初一');
    expect(p.meta.school).toBe('星河湾');
    expect(p.meta.date).toBe('2026-09-05');
    expect(p.meta.rosterTag).toBe('弱干预');
    expect(p.coreProblems.length).toBeGreaterThan(0);
    expect(p.followUpLeads.length).toBeGreaterThan(0);
    expect(p.y4Interpretation).toContain('总体印象');
    expect(p.overview.strengths).toContain('E3');
  });

  test('E2 block carries combined verdict and four energy evals', () => {
    const p = parseE4Protocol(leoMd);
    const block = p.dimensions.E2.block;
    expect(block.verdict).toBe('关注');
    const metrics = block.evals.map((e) => e.metric).join(' ');
    expect(metrics).toContain('睡眠习惯');
    expect(metrics).toContain('饮食习惯');
    expect(metrics).toContain('运动习惯');
    expect(metrics).toContain('躯体外貌');
  });

  test('parses Catherine fixture including 需介入/强干预 labels', () => {
    const p = parseE4Protocol(catherineMd);
    expect(p.dimensions.E1.questions).toHaveLength(8);
    expect(p.dimensions.E3.questions).toHaveLength(11);
    expect(p.dimensions.E4.questions).toHaveLength(8);
    const anxiety = p.dimensions.E1.questions.find((q) => q.title.includes('焦虑状态'));
    expect(anxiety.verdict).toBe('需介入');
    expect(anxiety.list).toContain('强干预');
  });

  test('buildEvalIndex resolves REF metrics to first-occurrence values', () => {
    const p = parseE4Protocol(leoMd);
    const idx = buildEvalIndex(p);
    expect(idx.get('认知能力-推理能力百分位')?.value).toBeTruthy();
  });

  test('never throws on empty / truncated input', () => {
    const empty = parseE4Protocol('');
    expect(empty.dimensions.E1.questions).toEqual([]);
    expect(empty.meta).toEqual(expect.objectContaining({ student: '' }));
    const truncated = parseE4Protocol(leoMd.slice(0, 400));
    expect(truncated.dimensions).toBeTruthy();
    expect(() => buildReportDraft(truncated)).not.toThrow();
    expect(() => parseE4Protocol(null)).not.toThrow();
  });
});

describe('report template mapping', () => {
  const draft = buildReportDraft(parseE4Protocol(leoMd));

  test('produces 39 rows in total: 31 main + 8 meeting supplements', () => {
    const all = DIMENSION_ORDER.flatMap((d) => draft.sections[d].rows);
    expect(all).toHaveLength(39);
    expect(CHECKLIST_ROWS).toHaveLength(39);
    const counts = { E1: 8, E2: 7, E3: 11, E4: 13 };
    for (const d of DIMENSION_ORDER) {
      expect(draft.sections[d].rows).toHaveLength(counts[d]);
    }
    expect(draft.sections.E2.rows.filter((r) => r.supplement)).toHaveLength(3);
    expect(draft.sections.E4.rows.filter((r) => r.supplement)).toHaveLength(5);
  });

  test('every non-supplement row has a Y4 clue and uses a valid default judgment', () => {
    for (const d of DIMENSION_ORDER) {
      draft.sections[d].rows
        .filter((r) => !r.supplement)
        .forEach((r) => {
          if (!r.y4Clue) throw new Error(`missing Y4 clue at ${d}/${r.rowId}`);
          expect(JUDGMENT_STATES).toContain(r.judgment);
          expect(r.y4Clue).not.toMatch(/\[EVAL\]|\[VERDICT\]|\[REF\]|undefined/);
        });
    }
  });

  test('supplement rows carry no Y4 clue', () => {
    const supplements = DIMENSION_ORDER.flatMap((d) => draft.sections[d].rows).filter((r) => r.supplement);
    expect(supplements).toHaveLength(8);
    supplements.forEach((r) => expect(r.y4Clue).toBe(''));
  });

  test('确定性需求 is its own checklist row filled from the protocol judgment', () => {
    const labels = DIMENSION_ORDER.flatMap((d) => draft.sections[d].rows.map((r) => r.label));
    expect(labels).toContain('确定性需求');
    const row = draft.sections.E4.rows.find((r) => r.rowId === 'egt-certainty');
    expect(row.y4Clue).toBe('健康。有确定性需求，偏好可预测的结构与规则，可利用结构化工具（如「一表人才」）辅助其学习过程。');
    const clues = draft.additionalClues.E4 || [];
    expect(clues.some((c) => c.title.includes('确定性需求'))).toBe(false);
  });

  test('question rows use the protocol 判断 text as the Y4 clue, not raw metrics', () => {
    const planning = draft.sections.E4.rows.find((r) => r.rowId === 'egt-planning');
    expect(planning.y4Clue).toBe('需支持。责任心不低但自主性偏低，可能影响其主动规划和执行任务的能力，需帮助其建立结构化计划。');
    const methods = draft.sections.E4.rows.find((r) => r.rowId === 'egt-methods');
    expect(methods.y4Clue).toBe('需支持。深层与表面策略均偏低，表明其缺乏系统性的学习方法，需引导其建立有效的学习策略体系。');
  });

  test('Energy exercise row defaults to 可能存在 on 中等, sleep to 暂未发现 on 良好', () => {
    const rows = draft.sections.E2.rows;
    expect(rows.find((r) => r.rowId === 'ene-exercise').judgment).toBe('可能存在');
    expect(rows.find((r) => r.rowId === 'ene-sleep').judgment).toBe('暂未发现');
  });

  test('confirmed issues derive only from rows set to 已确认问题, grouped by dimension', () => {
    const sections = JSON.parse(JSON.stringify(draft.sections));
    sections.E3.rows.find((r) => r.rowId === 'eng-motivation').judgment = '已确认问题';
    sections.E3.rows.find((r) => r.rowId === 'eng-motivation').meetingNote = '多数任务依赖外部推动';
    sections.E4.rows.find((r) => r.rowId === 'egt-planning').judgment = '已确认问题';
    const issues = deriveConfirmedIssues(sections);
    expect(issues.map((i) => i.dimension)).toEqual(['E3', 'E4']);
    expect(issues[0].text).toContain('多数任务依赖外部推动');
  });

  test('cover is prefilled from protocol meta; section 07 starts mentor-blank', () => {
    expect(draft.cover.studentName).toBe('Leo');
    expect(draft.cover.y4Date).toBe('2026-09-05');
    expect(draft.cover.reportNature).toBe('首次学习力分析报告');
    expect(draft.section07.familyQuote).toBe('');
    expect(draft.section07.studentQuote).toBe('');
    expect(draft.section07.solutions).toHaveLength(3);
    expect(draft.section07.solutions.every((s) => !s.direction && !s.arrangement)).toBe(true);
    expect(draft.section07.nextReviewDate).toBe('');
    expect(draft.section07.nextReviewFocus).toBe('');
  });

  test('Catherine draft also maps without gaps', () => {
    const d2 = buildReportDraft(parseE4Protocol(catherineMd));
    const missing = DIMENSION_ORDER.flatMap((dim) => d2.sections[dim].rows)
      .filter((r) => !r.supplement && !r.y4Clue);
    expect(missing.map((r) => r.rowId)).toEqual([]);
  });
});
