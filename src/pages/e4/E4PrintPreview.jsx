// 开发预览：直接用 Leo 的真实 E4 协议 fixture 渲染打印页，无需登录/无 Supabase 依赖
// 访问：/e4/print-preview
import { useEffect, useState } from 'react';
import FirstReportPrint from '../../components/e4/FirstReportPrint.jsx';
import { parseE4Protocol } from '../../lib/e4ProtocolParser.js';
import { buildReportDraft } from '../../lib/e4ReportTemplate.js';
import leoProtocol from '../../dev/e4-protocol-leo.md?raw';

export default function E4PrintPreview() {
  const [report, setReport] = useState(null);

  useEffect(() => {
    // 构造一份 mock report 对象：用 Leo fixture 协议 + 预设的 section07 数据
    const parsed = parseE4Protocol(leoProtocol);
    const draft = buildReportDraft(parsed);

    // 手动填充 section07（mock 导师已写完的状态）
    draft.section07.familyQuote = 'Leo 理解能力不差，但写作业经常拖，提醒后才开始。看起来坐了很久，真正有效学习的时间不多。';
    draft.section07.studentQuote = '我不是不会，就是觉得有些作业很无聊。先看一下手机，后来就会拖得更久。';
    draft.section07.solutions = [
      { direction: '提升计划性', arrangement: '由于学生对于"确定性"需求高，且自身的"计划性"目前还不算优势资源，因此用"一表人才"来做"结构化"的学习机制，是非常适合的。' },
      { direction: '练习有效学习方法', arrangement: '目前学生对于学习方法和策略的运用比较少，我们也直接用"一表人才"帮助学生在过程中逐步养成习惯。' },
      { direction: '引导沟通方法', arrangement: '学校内对待不同学科老师的态度以及与不同老师（尤其是自己不喜欢的老师）的沟通方式，是要逐步引导的。' },
    ];
    draft.section07.nextReviewDate = '2026-10-10~2026-10-17';
    draft.section07.nextReviewFocus = '减少提醒后能否自主启动；手机造成的中断是否减少；使用新方法后，多步骤遗漏是否下降。';

    // 给 narrative box 补上默认值（让彩色盒子都显示出来）
    const fillNarrative = (code, key, text) => {
      if (draft.sections[code].narratives[key] === undefined || draft.sections[code].narratives[key] === '') {
        draft.sections[code].narratives[key] = text;
      }
    };
    fillNarrative('E1', 'coreFinding', 'Leo 整体学习信心与安全感较稳定。更值得关注的是重复任务带来的消极体验，以及高频家长提醒可能对自主性的影响。');
    fillNarrative('E1', 'followUp', '确认低落或无聊是否只出现在特定任务中，并观察减少提醒后任务启动是否改善。');
    fillNarrative('E2', 'coreFinding', '暂未发现睡眠、饮食或身体状态直接限制学习。运动规律性可以提升，但目前不是最优先问题。');
    fillNarrative('E2', 'learningImpact', 'Leo 的学习中断更可能与任务兴趣、计划和手机干扰有关，而非明显体力不足。');
    fillNarrative('E3', 'coreFinding', 'Leo 的基础认知资源较好。当前重点不是"能力不足"，而是自主学习动力偏弱；在干扰较多或步骤复杂的任务中，优势也未能稳定发挥。');
    fillNarrative('E3', 'strengths', '感知觉、加工速度、逻辑数学能力和学习自信较好；对动手研究与科技主题有明确兴趣。');
    fillNarrative('E4', 'coreFinding', 'Leo 拥有可用的认知能力，但尚未形成稳定的方法、计划和自我调整过程。重点是把"能学"逐步转化为可持续的真实行动。');

    const mockReport = {
      id: 'mock-leo',
      meeting_date: '2026-09-12',
      report_date: '2026-09-16',
      status: 'final',
      form_data: draft,
    };

    setReport(mockReport);
  }, []);

  if (!report) {
    return <div className="e4-page"><div className="e4-list-hint">加载预览中…</div></div>;
  }

  return (
    <div className="e4-print-route">
      <div className="e4-print-toolbar no-print">
        <div className="e4-print-toolbar-inner">
          <span className="e4-print-toolbar-title">
            🧪 开发预览 · Leo 首次学习力分析报告（mock 数据）
          </span>
          <button type="button" className="e4-btn-primary" onClick={() => window.print()}>
            下载 PDF
          </button>
        </div>
      </div>
      <FirstReportPrint report={report} />
    </div>
  );
}
