// E4《阶段学习力复盘报告》固定模板定义 + 一表人才数据 → 报告草稿映射。
// 文案严格对齐用户提供的《E4阶段学习力复盘报告模版.pdf》（8 页）。
// 数据存于 e4_reports(form_data)，report_type='progress'。
import { hoursMinutes } from './e4ProgressData.js';

export const MODULE_STATUSES = ['稳定', '需关注', '当前重点', '信息不足'];

// 四个模块：P7 状态行 + P6/P4 的说明文案
export const PROGRESS_MODULES = [
  { key: 'Emotion', cn: '学业情绪', tint: 'red', judgmentHint: '综合分学科情绪及会议反馈' },
  { key: 'Energy', cn: '身心能量', tint: 'orange', judgmentHint: '综合作息、精力及实际学习状态' },
  { key: 'Engine', cn: '认知引擎', tint: 'teal', judgmentHint: '综合复习方式、学习策略及练习质量' },
  { key: 'Engagement', cn: '学习投入', tint: 'blue', judgmentHint: '综合参与节奏、时间投入及自主性' },
];

export const PROGRESS_STATIC = {
  brandKicker: 'E4 · LEARN WITH EASE',
  title: 'E4 阶段学习力复盘报告',
  en: 'E4 LEARNING PROGRESS REVIEW',
  intro: '基于阶段行为数据与学生复盘会议，更新当前学习状态，并确定下一阶段最值得优先验证的方向。',
  confidentiality: '本报告用于阶段学习支持与家庭沟通。页面中的判断会根据后续数据与复盘持续更新，不构成医学、心理或教育诊断。',
  footerCenter: '阶段学习力复盘报告',

  // ---- P2 阶段起点 ----
  p2Chapter: 'STAGE START',
  p2No: '02',
  p2Title: '阶段起点',
  p2En: 'STARTING POINT AND EVIDENCE RANGE',
  p2Lead: '本页用于明确本阶段复盘所承接的目标，以及本次判断所依据的信息范围。具体分析与结论将在后续页面呈现。',
  priorTitle: '上阶段验证目标',
  priorItems: [
    { key: 'priorIssues', label: '上阶段优先问题', hint: '承接上期报告填写一至两项' },
    { key: 'priorDirection', label: '上阶段解决方向', hint: '承接上期报告中的简要解决思路' },
    { key: 'verifyFocus', label: '本阶段重点验证', hint: '填写本阶段需要观察的行为或变化' },
  ],
  scopeTitle: '本次信息范围',
  scopeItems: [
    { key: 'priorReport', label: '上期学习力报告', hint: '上阶段关键问题、成长方案及待验证目标' },
    { key: 'trackerData', label: '一表人才数据', hint: '数据起止日期；记录覆盖情况' },
    { key: 'meeting', label: '学生复盘会议', hint: '会议日期；主要讨论范围' },
    { key: 'other', label: '其他补充信息', hint: '家长反馈、教师评价、家长会信息等；没有则填写未提供' },
  ],
  p2Note: '本页只界定复盘起点和证据范围，不提前给出阶段结论。',

  // ---- P3 学习参与与节奏 ----
  p3Chapter: 'LEARNING RHYTHM',
  p3No: '03',
  p3Title: '学习参与与节奏',
  p3En: 'PARTICIPATION AND LEARNING RHYTHM',
  p3Lead: '通过整月记录观察课外学习是否持续，以及工作日和周末的可用学习时间是否得到合理使用。',
  summaryLabels: ['记录覆盖', '总学习时长', '有记录工作日平均', '有记录周末平均'],
  calendarTitle: '阶段学习日历',
  calendarEmpty: '从一表人才导出整月学习日历',
  observationLabel: '阶段观察',
  observationHint: '结合数据与复盘会议说明：记录是否连续；主要中断发生在哪里；工作日和周末的课外学习时间是否充足、稳定；节假日、比赛或课程安排是否能够解释异常数据。',
  p3Note: '空白日期不直接等同于未学习。本页只反映一表人才中已经记录的课外学习情况。',

  // ---- P4 学科投入、学习结构与练习质量 ----
  p4Chapter: 'SUBJECT ANALYSIS',
  p4No: '04',
  p4Title: '学科投入、学习结构与练习质量',
  p4En: 'SUBJECT TIME STRUCTURE AND PRACTICE QUALITY',
  p4Lead: '本页用于判断各学科获得的学习时间是否符合当前需要，复习是否形成稳定比例，以及练习反馈能否支持后续改进。',
  subjectTableTitle: '分学科数据',
  problemTableTitle: '发现问题的学科',
  problemHint1: '填写时间投入、复习比例或练习质量方面的具体问题',
  problemHint2: '选填；按照问题优先级从上到下排列',
  p4Note: '时间和比例本身不代表合理或不合理，需要结合近期课程、任务难度、成绩变化及学生实际需求综合判断。',

  // ---- P5 分学科自主性 ----
  p5Chapter: 'AUTONOMY',
  p5No: '05',
  p5Title: '分学科自主性',
  p5En: 'AUTONOMY BY SUBJECT',
  p5Lead: '沿用上一页的学科顺序，观察学生在不同学科中有多少学习任务由自己主动安排和完成。',
  p5TableTitle: '学科自主占比',
  p5ObservationHint: '说明哪些学科已经表现出较强自主性；哪些学科或任务仍依赖老师、家长或课程安排；这种差异可能与任务类型、兴趣、难度或学习习惯有什么关系。',
  p5Note: '自主占比仅基于一表人才中已经记录的任务，需要结合学生对任务来源和实际执行过程的说明理解。',

  // ---- P6 分学科学业情绪 ----
  p6Chapter: 'ACADEMIC EMOTION',
  p6No: '06',
  p6Title: '分学科学业情绪',
  p6En: 'ACADEMIC EMOTION BY SUBJECT',
  p6Lead: '按照相同的学科顺序，记录学生对当前学习内容、课堂环境和自身能力的真实感受。',
  p6ColHeaders: ['学科', '当前学习体验', '情绪与信心', '当前发现'],
  p6Placeholders: ['当前内容、课堂体验与教师互动', '兴趣、投入、抗拒、焦虑或自信', '结合复盘会议形成的简要判断'],
  p6Note: '本页主要依据学生复盘会议中的真实表达，不使用一表人才数据直接推断情绪；未充分讨论的学科标注信息不足。',

  // ---- P7 E4 阶段综合判断 ----
  p7Chapter: 'E4 SUMMARY',
  p7No: '07',
  p7Title: 'E4 阶段综合判断',
  p7En: 'INTEGRATED E4 STAGE ASSESSMENT',
  p7Lead: '综合前述数据与复盘会议，更新四个模块的当前状态。这里呈现的是阶段判断，不是对学生能力的固定评分。',
  p7ColHeaders: ['E4 模块', '当前状态', '综合判断'],
  statusLegend: '稳定表示当前未发现明显限制；需关注表示已有线索但尚非首要问题；当前重点表示下一阶段需要优先处理；信息不足表示证据尚不能支持判断。',

  // ---- P8 下一阶段成长方案与复盘安排 ----
  p8Chapter: 'NEXT STAGE',
  p8No: '08',
  p8Title: '下一阶段成长方案与复盘安排',
  p8En: 'NEXT STAGE GROWTH PLAN AND REVIEW',
  p8Lead: '下一阶段只选择当前最值得优先处理的问题，给出简要解决思路，并明确下次需要验证的变化。',
  goalsTitle: '下一阶段优先目标',
  goalItems: [
    { key: 'goal1', label: '优先目标一', hint: '填写', optional: false },
    { key: 'goal2', label: '优先目标二', hint: '可选', optional: true },
    { key: 'reason', label: '选择原因', hint: '简要说明为什么优先处理以上问题', optional: false },
  ],
  solutionsTitle: '问题解决方案',
  solutionBoundary: '本部分只说明方向和方法，不拆解为每日任务、执行频率或量化要求。',
  nextTitle: '下次复盘',
  nextItems: [
    { key: 'reviewDate', label: '预计复盘时间', hint: '填写', type: 'date' },
    { key: 'verifyFocus', label: '重点验证', hint: '填写下一阶段需要观察的行为或变化' },
  ],
  refNoteText: '一表人才数据＋学生复盘会议［可补充其他来源］',
  p8Principle: '下一阶段不同时解决所有问题，而是通过少量、明确、可验证的调整，进一步确认真正适合学生的方法。',
};

function emptySubject(name = '') {
  return {
    subject: name,
    totalMinsText: '0 分钟',
    sharePctText: '0%',
    structureText: '学0%  复0%  练0%',
    reviewMinsText: '0 分钟',
    practiceCountText: '0 次',
    evalText: '',
    autonomyPctText: '0%',
    experience: '',
    emotion: '',
    finding: '',
  };
}

const emptySolution = () => ({ direction: '', arrangement: '' });

/**
 * 从上期报告提取「上阶段承接」内容，按报告类型分派字段：
 *   first    → form_data.section07.{nextReviewFocus, solutions[]}
 *   progress → form_data.p8.{goal1, goal2, solutions[]}
 * 之前只认 section07，导致第二份起的过程报告（上期是 progress）承接为空。
 * @returns {{ priorIssues: string, priorDirection: string }}
 */
export function extractCarry(prior) {
  const empty = { priorIssues: '', priorDirection: '' };
  const fd = prior?.form_data;
  if (!fd) return empty;
  const src = prior.report_type === 'progress' ? fd.p8 : fd.section07;
  if (!src) return empty;

  const priorIssues = prior.report_type === 'progress'
    ? [src.goal1, src.goal2].map((x) => String(x || '').trim()).filter(Boolean).join('；')
    : String(src.nextReviewFocus || '').trim();
  const priorDirection = (Array.isArray(src.solutions) ? src.solutions : [])
    .map((x) => String(x?.direction || '').trim())
    .filter(Boolean)
    .join('；');

  return { priorIssues, priorDirection };
}

/**
 * 聚合结果 + 学生 + 上期承接 → 过程报告草稿。
 * @param {Object} aggregate aggregateProgress 结果
 * @param {Object} student   e4_students 行
 * @param {Object} opts      { issueNumber, reportDate, periodStart, periodEnd, carry }
 * @param {Object} carry     上期报告承接 { priorIssues, priorDirection }
 */
export function buildProgressDraft(aggregate, student = {}, opts = {}) {
  const carry = opts.carry || {};
  const periodStart = opts.periodStart || aggregate?.period?.start || '';
  const periodEnd = opts.periodEnd || aggregate?.period?.end || '';
  const issueNumber = opts.issueNumber != null ? `第 ${opts.issueNumber} 期` : '第 1 期';
  const reportDate = opts.reportDate || '';

  const subjects = (aggregate?.subjects || []).map((s) => ({
    subject: s.subject,
    totalMinsText: hoursMinutes(s.minutes) || '0 分钟',
    sharePctText: `${s.sharePct || 0}%`,
    structureText: `学${s.learnPct || 0}%  复${s.reviewPct || 0}%  练${s.practicePct || 0}%`,
    reviewMinsText: (s.reviewMins ? hoursMinutes(s.reviewMins) : '0 分钟'),
    practiceCountText: `${s.practiceCount || 0} 次`,
    evalText: s.evalText || '',
    autonomyPctText: `${s.autonomousPct || 0}%`,
    experience: '',
    emotion: '',
    finding: '',
  }));
  // 至少给一版可编辑行，便于空数据时导师也能手填
  if (subjects.length === 0) subjects.push(emptySubject(), emptySubject(), emptySubject());

  const summary = aggregate?.summary || {};
  const calendar = aggregate?.calendar || {};

  return {
    modelVersion: 1,
    cover: {
      studentName: student.display_name || '',
      periodStart,
      periodEnd,
      issueNumber,
      reportDate,
    },
    p2: {
      priorIssues: carry.priorIssues || '',
      priorDirection: carry.priorDirection || '',
      verifyFocus: '',
      scope: {
        priorReport: '上阶段关键问题、成长方案及待验证目标',
        trackerData: periodStart && periodEnd ? `${periodStart} 至 ${periodEnd}；${summary.recordDays || 0} 天有记录` : '',
        meeting: '',
        other: '',
      },
    },
    p3: {
      recordCoverage: summary.recordDays != null && aggregate?.period?.totalDays
        ? `${summary.recordDays} / ${aggregate.period.totalDays} 天`
        : '',
      totalDuration: hoursMinutes(summary.totalMinutes),
      weekdayAvg: hoursMinutes(summary.weekdayAvgMins),
      weekendAvg: hoursMinutes(summary.weekendAvgMins),
      calendar,
      observation: '',
    },
    subjects,
    p4: {
      problems: [
        { subject: '', issue: '' },
        { subject: '', issue: '' },
      ],
    },
    p5: {
      observation: '',
    },
    p7: {
      modules: {
        Emotion: { status: '', judgment: '' },
        Energy: { status: '', judgment: '' },
        Engine: { status: '', judgment: '' },
        Engagement: { status: '', judgment: '' },
      },
    },
    p8: {
      goal1: '',
      goal2: '',
      reason: '',
      solutions: [emptySolution(), emptySolution(), emptySolution()],
      reviewDate: '',
      verifyFocus: '',
      refNote: PROGRESS_STATIC.refNoteText,
    },
  };
}