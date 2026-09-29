// E4《首次学习力会议会前准备》模板定义 + 协议→会前草稿映射。
// 文案严格对齐根目录《首次学习力会议会前准备模板.docx》。
// 数据存于 e4_reports(form_data)，report_type='prep'。

export const PREP_DIMENSION_ORDER = ['E1', 'E2', 'E3', 'E4'];

export const PREP_DIMENSIONS = {
  E1: {
    code: 'E1',
    short: 'Emotion',
    title: 'Emotion 学业情绪',
    en: 'EMOTIONAL READINESS FOR LEARNING',
    intro: '先读取Y4协议中的判断，再勾选本次会议最需要确认的项目。第三列只保留对应的VERDICT原文，不复制分数，也不改写成导师结论。',
    tint: 'red',
  },
  E2: {
    code: 'E2',
    short: 'Energy',
    title: 'Energy 身心能量',
    en: 'PHYSICAL RESOURCES FOR LEARNING',
    intro: 'Y4协议对Energy提供一条模块级整体判断，展示在表格上方；每行第三列为协议中对应的单项评级，未涉及的行留空，用于准备会议追问。',
    tint: 'orange',
    moduleLevel: true, // 模块级总述：判断全文在表格上方展示一次，第三列按行显示对应评级
  },
  E3: {
    code: 'E3',
    short: 'Engine',
    title: 'Engine 认知引擎',
    en: 'COGNITIVE RESOURCES AND MOTIVATION',
    intro: '从信息处理、执行功能与学习动机三个方面准备确认。仅勾选当前最值得追问的项目，不需要在会议中机械地逐项询问。',
    tint: 'teal',
  },
  E4: {
    code: 'E4',
    short: 'Engagement',
    title: 'Engagement 学习投入',
    en: 'STRATEGIES PLANNING AND SELF MONITORING',
    intro: '重点确认学生是否把已有能力转化为合适的方法、计划和调整行为。第三列仍只复制Y4协议中的对应VERDICT原文。',
    tint: 'blue',
  },
};

// 协议 VERDICT → 语义点颜色（仅小圆点使用语义色）
export const VERDICT_DOT = {
  需介入: '#C4535A',
  需支持: '#C4535A',
  关注: '#C99A3D',
  需关注: '#C99A3D',
  中性: '#8F897B',
  健康: '#6D9A6A',
};

export const PREP_STATIC = {
  brandKicker: 'E4 · LEARN WITH EASE',
  title: '首次学习力会议会前准备',
  en: 'E4 FIRST LEARNING MEETING PREPARATION',
  kickerNote: '学习力导师会前准备用',
  lead: '本模板用于首次学习力会议的会前准备。学习力导师结合已有资料，提前确定学科讨论顺序和E4待确认问题，并据此准备会议中的追问。测评判断只提供线索；是否构成实际问题，仍需结合学生的具体经历确认。会议结束后，再根据学生会议与家长反馈完成《首次学习力分析报告》。',
  attendeeOptions: ['学生', '家长', '导师'],
  meetingStructureTitle: '会议固定结构',
  meetingStructure: [
    { no: '01', stage: '学科情况', source: '三级象限图、Growth Talk（如有）、成绩与课程资料、学生会中确认', output: '1至3门重点学科及具体学习情境' },
    { no: '02', stage: 'E4确认', source: 'Y4导出协议、E4统一排查清单、学生具体事件', output: '核心发现、待观察线索与优先问题' },
    { no: '03', stage: '阶段方案', source: '已确认问题、学生意愿、导师判断', output: '匹配问题的阶段解决方向与第一步行动' },
    { no: '04', stage: '家长反馈', source: '家庭最初问题、学生会议结论、家长补充', output: '家长共识、补充信息与支持边界' },
    { no: '05', stage: '书面总结', source: 'Y4、学生会议、家长反馈', output: '《首次学习力分析报告》' },
  ],
  sourcesKicker: 'MEETING PREPARATION',
  sourcesTitle: '会前资料来源与完整性',
  sourcesEn: 'SOURCES AND COMPLETENESS',
  sourcesLead: '会前只整理能够帮助会议判断的信息，并明确每条信息来自哪里、是否完整。缺失或相互矛盾的资料应被标记为待确认，不提前写成结论。',
  sources: [
    { key: 'parent', label: '家长最初反映的问题', contentHint: '家庭最希望解决的问题、持续时间及已经尝试的方法', origin: '销售／测评师／家长文字或录音／其他', statusOptions: ['完整', '部分', '未取得'] },
    { key: 'y4', label: 'Y4测评及E4协议', contentHint: '测评日期、E4分析及需要关注的方向', origin: 'Y4导出与E4协议MD文件', statusOptions: ['完整', '部分', '未取得'] },
    { key: 'growthmap', label: '三级象限图／Growth Talk（如有）', contentHint: '学科喜好、擅长程度、投入情况等线索', origin: '三级象限图／Growth Talk记录', statusOptions: ['有', '无／不适用'] },
    { key: 'academic', label: '学业资料', contentHint: '近期成绩、课程内容、学校及补课安排', origin: '成绩单／学校／家长／学生', statusOptions: ['完整', '部分', '未取得'] },
    { key: 'other', label: '其他补充资料', contentHint: '教师反馈、既往尝试、作息或其他相关信息', origin: '', statusOptions: ['完整', '部分', '未取得'] },
  ],
  recordPrinciple: '记录原则　只有在存在可靠文字或录音记录时，才引用"家长原话"；否则概括主要意思，并标明信息来源。',
  subjectsKicker: 'PART 1  SUBJECT REVIEW',
  subjectsTitle: '学科线索与重点排序',
  subjectsEn: 'SUBJECT CLUES AND MEETING ORDER',
  subjectsLead: '整合现有资料，提前排出预计讨论顺序。这里记录的是会前已经掌握的线索和准备追问的方向，不填写会议后的判断。',
  subjectTypes: ['特别愿意', '特别需要', '特别逃避'],
  subjectClueHint: '整合三级象限图、Growth Talk、成绩资料与家庭反馈',
  sortNote: '排序说明　请按照预计的会议讨论顺序由上至下填写。通常可从学生最愿意谈、最容易提供具体事件的学科切入，再进入当前最需要改善或明显逃避的学科。导师可根据学生实际情况调整顺序，但需要保留清晰的排序依据。',
  confirmKicker: 'Y4 TO E4 CONFIRMATION PREPARATION',
  confirmCols: ['重点', '统一排查问题', 'Y4协议判断', '会议中需要确认的现象'],
};

// 每行：id / dim / label（统一排查问题）/ aliases（匹配协议 #### 标题）/ ask（确认现象默认文案）
export const PREP_ROWS = [
  // ---- Emotion ----
  { id: 'emo-confidence', dim: 'E1', label: '学习自信', aliases: ['学习的自信', '取得好的成绩'], ask: '是否相信自己能学会并取得理想结果；不同学科是否不同' },
  { id: 'emo-school', dim: 'E1', label: '学校环境', aliases: ['学校环境'], ask: '教师、同伴、课堂节奏、规则或评价是否影响学习情绪' },
  { id: 'emo-parent', dim: 'E1', label: '亲子关系', aliases: ['亲子关系'], ask: '家庭互动、提醒和期待是否影响学业情绪' },
  { id: 'emo-self-esteem', dim: 'E1', label: '整体自卑状态', aliases: ['自卑'], ask: '负面评价是否从某门学科延伸到对自己的整体否定' },
  { id: 'emo-anxiety', dim: 'E1', label: '焦虑状态', aliases: ['焦虑状态'], ask: '考试、作业或课堂提问是否带来持续紧张和回避' },
  { id: 'emo-sensitive', dim: 'E1', label: '高敏感内耗', aliases: ['高敏感'], ask: '错误或他人评价是否被反复思考并影响后续学习' },
  { id: 'emo-depressed', dim: 'E1', label: '不开心状态', aliases: ['不开心'], ask: '近期是否持续缺少兴趣或愉快感，并影响日常学习' },
  { id: 'emo-security', dim: 'E1', label: '安全感', aliases: ['安全感'], ask: '面对变化和不确定时是否过度需要稳定与确认' },
  // ---- Energy（模块级总述 + 按行 EVAL 评级）----
  { id: 'ene-sleep', dim: 'E2', label: '睡眠与恢复', evalMatch: '睡眠习惯', ask: '作息、入睡、夜间醒来、早晨清醒度及周末节律' },
  { id: 'ene-diet', dim: 'E2', label: '饮食与营养', evalMatch: '饮食习惯', ask: '早饭、正餐、饥饿或餐后困倦是否影响状态' },
  { id: 'ene-exercise', dim: 'E2', label: '运动情况', evalMatch: '运动习惯', ask: '运动频率、强度及运动后恢复情况' },
  { id: 'ene-daytime', dim: 'E2', label: '日间精力', ask: '一天中最清醒和最困倦的时段及课堂表现' },
  { id: 'ene-window', dim: 'E2', label: '学习时段与复习资源', ask: '放学后可用时间及精力较好时段的实际分配' },
  { id: 'ene-other', dim: 'E2', label: '其他身体因素', evalMatch: '躯体外貌', ask: '疼痛、视力、用药或其他身体情况是否影响学习' },
  // ---- Engine ----
  { id: 'eng-input', dim: 'E3', label: '信息输入基本功能', aliases: ['信息输入'], ask: '是否漏听、漏看关键信息；什么呈现方式更容易理解' },
  { id: 'eng-storage', dim: 'E3', label: '信息存储基本功能', aliases: ['信息存储'], ask: '学后保留和提取情况；怎样复习时记得更牢' },
  { id: 'eng-analysis', dim: 'E3', label: '信息分析基本功能', aliases: ['信息分析'], ask: '推理、比较、找规律和空间分析的真实表现' },
  { id: 'eng-speed', dim: 'E3', label: '信息加工速度', aliases: ['加工速度'], ask: '课堂跟随、限时任务和考试中是否来不及处理' },
  { id: 'eng-focus', dim: 'E3', label: '执行能力 专注力', aliases: ['执行能力-专注力'], ask: '能持续多久、被什么打断、什么时候反而能专注' },
  { id: 'eng-working-memory', dim: 'E3', label: '执行能力 运用记忆', aliases: ['运用记忆'], ask: '多步骤任务中是否忘记条件、漏步骤或反复回看' },
  { id: 'eng-flexibility', dim: 'E3', label: '执行能力 认知灵活性', aliases: ['认知灵活性'], ask: '题目变化或原方法无效时能否及时更换思路' },
  { id: 'eng-motivation', dim: 'E3', label: '学习动机是否足够', aliases: ['学习动机是否强大', '学习动机'], ask: '哪些任务会主动开始；哪些即使被要求也难启动' },
  { id: 'eng-success', dim: 'E3', label: '是否有渴望成功的动机', aliases: ['渴望成功'], ask: '是否真正想获得某种学习结果，以及这个结果的意义' },
  { id: 'eng-deep', dim: 'E3', label: '是否有深层学习动机', aliases: ['有深层学习动机', '深层学习动机'], ask: '是否愿意理解原理、建立联系并持续探索' },
  { id: 'eng-drive', dim: 'E3', label: '内驱力状态', aliases: ['内驱力'], ask: '自主选择、胜任体验和归属支持是否足够' },
  // ---- Engagement ----
  { id: 'egt-logic', dim: 'E4', label: '策略错配 数理逻辑', aliases: ['第一组'], ask: '实际方法是否发挥逻辑推理优势' },
  { id: 'egt-spatial', dim: 'E4', label: '策略错配 空间能力', aliases: ['第二组'], ask: '图像、结构、模型等方式是否适配并实际使用' },
  { id: 'egt-understand', dim: 'E4', label: '策略错配 基于理解的学习', aliases: ['第三组'], ask: '是否解释原理、建立联系并迁移应用' },
  { id: 'egt-surface', dim: 'E4', label: '策略错配 基于表面的学习', aliases: ['第四组'], ask: '背诵、重复和刷题是否使用得当' },
  { id: 'egt-methods', dim: 'E4', label: '学习方法与策略程度', aliases: ['方法的程度'], ask: '不同学科是否形成明确且有理由的方法' },
  { id: 'egt-planning', dim: 'E4', label: '计划性', aliases: ['计划性'], ask: '任务顺序、时间和启动动作是否由学生有效安排' },
  { id: 'egt-metacognition', dim: 'E4', label: '元认知潜力', aliases: ['元认知'], ask: '能否检查结果、发现无效并主动调整或求助' },
];

function matchPrepQuestion(row, questions) {
  if (!row.aliases) return null;
  return (questions || []).find((q) => row.aliases.some((a) => q.title.includes(a))) || null;
}

const emptySubject = () => ({ subject: '', clues: '', types: [], followUp: '' });

/**
 * 解析后的协议 → 会前准备草稿。
 * @param protocol parseE4Protocol 的结果
 * @param student  e4_students 行（用于封面预填）
 */
export function buildPrepDraft(protocol, student = {}) {
  const prepRows = {};
  for (const code of PREP_DIMENSION_ORDER) prepRows[code] = [];
  const moduleJudgments = {};

  for (const row of PREP_ROWS) {
    const dimData = protocol?.dimensions?.[row.dim];
    const base = {
      rowId: row.id,
      label: row.label,
      checked: false,
      verdict: '',
      verdictText: '',
      ask: row.ask,
      meetingNote: '',
    };
    if (PREP_DIMENSIONS[row.dim].moduleLevel) {
      // E2：模块级判断全文存到 moduleJudgments（表格上方展示一次）；
      // 每行 verdictText 为协议中对应的单项 EVAL 评级，无对应指标则留空
      if (!moduleJudgments[row.dim]) {
        moduleJudgments[row.dim] = {
          verdict: dimData?.block?.verdict || '',
          text: dimData?.block?.judgment || '',
        };
      }
      if (row.evalMatch) {
        const ev = (dimData?.block?.evals || []).find((e) => e.metric.includes(row.evalMatch));
        if (ev) {
          base.verdictText = `${ev.metric} ${ev.value}${ev.note ? `（${ev.note}）` : ''}`.trim();
        }
      }
    } else {
      const q = matchPrepQuestion(row, dimData?.questions);
      if (q) {
        base.verdict = q.verdict || '';
        base.verdictText = q.judgment || '';
      }
    }
    prepRows[row.dim].push(base);
  }

  const gradeSchool = [student.grade, student.school].filter(Boolean).join(' · ');

  return {
    modelVersion: 1,
    prepCover: {
      studentName: student.display_name || protocol?.meta?.student || '',
      gradeSchool,
      meetingDate: '',
      advisorName: '',
      attendees: { student: true, parent: true, advisor: true, otherText: '' },
      duration: '',
    },
    sources: PREP_STATIC.sources.map((s) => ({
      key: s.key,
      // 每行「会前已有内容」为全员统一的预填清单文案
      content: s.contentHint,
      origin: s.origin,
      status: '',
    })),
    subjects: Array.from({ length: 6 }, emptySubject),
    growthMap: null, // { fileName, uploadedAt } 成长地图 PDF 引用（AI 提取后续接入）
    moduleJudgments, // 模块级判断（如 E2）：{ verdict, text }，表格上方展示
    prepRows,
  };
}
