# E4 报告内容填充质量提升 Implementation Plan

## Repository Research

当前内容填充链路：`parseE4Protocol(md)` → `buildReportDraft(protocol)` → form_data.sections.rows（38 行）。

**参考 PDF（Leo 报告）vs fixture 实际输出对比，5 大类差距：**

| 差距类别 | 当前输出示例 | 参考 PDF 实际内容 | 根因 |
|---------|------------|----------------|-----|
| **y4Clue 格式** | "学习自我调节 偏低；合群 较好；同伴-信任 高；同伴-沟通 不低；同伴-亲近 不低" | "同伴关系良好；自我调节 5.8 偏低，尚不能直接证明学校环境有影响。" | `evalSummary()` 只堆 metric+value，不做语义归纳、不取舍、不自然语言化 |
| **narrative coreFinding** | "待关注：学校环境" / "待关注：运用记忆\n待关注：认知灵活性\n..." | "Leo 整体学习信心与安全感较稳定。更值得关注的是重复任务带来的消极体验，以及高频家长提醒可能对自主性的影响。" | `draftCoreFinding()` 把每个 flagged question 的 title 机械拼 "待关注：" 前缀，不读协议 judgment 的自然语言段落 |
| **narrative followUp / learningImpact** | 全部空 | "确认低落或无聊是否只出现在特定任务中..." / "运动规律性可以提升，但目前不是最优问题。" | 没有从协议 `## OTHER_VARIABLES / ### 可能失真 / ### 跟进线索` 等 section 提取 followUp 内容的逻辑 |
| **verdict 取值** | 协议 verdict 是"关注"时 judgment 默认给"可能存在"——大部分正确但缺少导师的会议核实环节自动接入 | verdict 列在参考 PDF 里是导师结合会议纪要判断的结果 | 这是导师编辑的事情，不改；但 meetingNote 列需要导师能在 builder step 便捷录入 |
| **E2 block 级 y4Clue** | "睡眠习惯 评级:良好"（缺少原始分数 8.6） | "得分 8.6，评级良好。" | `findBlockEvals` + `evalSummary` 没保留原始分数和评级的自然语言格式 |

**38 行 checklist 匹配状态（用 Leo fixture 实测）：**
- E1 8/8 匹配（其中"整体自卑状态"aliases=['自卑'] 匹配到了"自卑自尊"——但协议里这个 question title 可能不含"自卑"二字？需要验证）
- E2 4/4 主表匹配 + 3 supplement 空行（正确，supplement 来自会议）
- E3 11/11 全匹配
- E4 7/7 主表匹配 + 5 supplement 空行（正确）

协议解析本身没问题，**全是 draft 生成逻辑的问题**。

**会议纪要接入方式：** meetingNote 字段在 builder step 里导师手动编辑（textarea 或从左侧纪要面板粘贴），当前链路不做 NLP 自动摘要。judgment 默认值由协议 verdict 推断，导师结合 meetingNote 最终选。

## Files and Modules

- **`src/lib/e4ReportTemplate.js`**（主要改动）：重写 4 个 helper 函数 + 新增 2 个自然语言摘要函数
  - `evalSummary()` → 自然语言摘要（保留原始值、取舍、排序）
  - `draftCoreFinding()` → 优先 block.judgment，再 fallback 到 flagged questions 的 judgment 拼接，输出完整中文句
  - 新增 `draftFollowUp(dimData, protocol)` → 从协议的"跟进线索""可能失真""核心问题"里取与当前维度相关的 followUp 句子
  - 新增 `naturalClue(evals, refs)` → 输出参考 PDF 风格的"得分 X，评级良好/中等；指标 Y 偏低"格式
  - `buildReportDraft` 里 narrative 调用改
- **`src/lib/e4ProtocolParser.js`**（只读，不改）
- **`__tests__/e4ProtocolParser.test.js`** 和 **`__tests__/e4ReportTemplate.test.js`**：更新期望输出（y4Clue 自然语言化、narrative 完整句）

## Implementation Steps

### Step 1: 重写 naturalClue — 自然语言摘要生成

目标：把原子化的 metric 列表变成参考 PDF 风格的自然语言句子。

示例（E1 学校环境）：
```
输入: [{metric:"学习自我调节", value:"5.8 偏低"}, {metric:"合群", value:"较好"}, ...]
输出: "学习自我调节 5.8 偏低；同伴关系良好（合群/信任/沟通均不低），尚不构成直接证据。"
```

实现：
1. 先按 verdict 等级分组：flagged(需支持/需介入) > watch(关注) > neutral(健康/中性)
2. 每个组内：对 attachment（母子亲近/同伴信任）这类相关指标做合并（"同伴信任、沟通、亲近 均高"）
3. 输出格式：对分数型保留原始值 + 评级；对标签型直接"评级良好/中等"
4. 最后拼接 question.judgment 的第一句（协议里已有导师写的判断）

### Step 2: 重写 draftCoreFinding — 完整中文句

目标：不再拼 "待关注：XXX"，而是输出参考 PDF 风格的段落摘要。

实现：
1. **优先**用 `dimData.block?.judgment` 的第一句（E2/E4 有 block，E1/E3 可能没有）
2. 其次取 flagged questions 的 `question.judgment`（协议里每个 question 都有导师写的"判断：..."自然语言段落），拼接成 1–2 句
3. 最后 fallback 到 `dimData.block?.judgment` 的原始句子（去掉前缀标签）

示例（E1 参考 PDF）：
```
当前实现: "待关注：学校环境"
目标输出: "整体情绪健康，但学校环境适应（同伴关系良好）仍需进一步核实是否产生影响。"
```

### Step 3: 新增 draftFollowUp — 从协议提取后续观察线索

目标：参考 PDF 里 E1 followUp 写的是"确认低落或无聊是否只出现在特定任务中，并观察减少提醒后任务启动是否改善。"——这些线索协议里有（OTHER_VARIABLES 下的"跟进线索与切入点""可能失真·先观察"）。

实现：
1. 从 `protocol.followUpLeads` 取与当前维度相关的前 2 条
2. 从 `protocol.watchItems` 取相关关键词
3. 如果没有协议线索，输出空（导师自己填）

### Step 4: 增强 E2 block 级 y4Clue 格式

当前 E2 block 的 evalKeys 是硬编码的，输出是"睡眠习惯 评级:良好"。目标：保留原始值（"得分 8.6，评级良好。"）。

实现：E2 block 的 evals 里 metric 已经包含原始值（"睡眠习惯 8.6 评级良好"），naturalClue 里专门处理 E2 的格式。

### Step 5: draft 输出后跑 Leo/Catherine fixture 验证

用 fixture 跑完整链路，diff 新输出 vs 参考 PDF，逐行修正。

## Dependencies and Considerations

- **不改 parser**：当前 parser 能解析所有维度、问题、evals、block、judgment 段落，够用
- **不改 CHECKLIST_ROWS aliases**：38 行匹配率 100%，问题在 draft 生成
- **会议纪要 meetingNote**：本轮不改——导师手动填，builder 里已有 textarea。但可以考虑加一个"从纪要自动提取"的辅助按钮（低优先级）
- **judgment 默认值**：VERDICT_DEFAULT_MAP 是协议 verdict → 建议 judgment 的映射，导师最终选定。这个逻辑不变
- **向后兼容**：已保存的报告 form_data 不应被新 draft 覆盖；只有新报告（form_data.sections 为空时）才用 buildReportDraft 的新逻辑

## Validation

1. `npm test` 通过（e4ProtocolParser + e4ReportTemplate 测试）
2. 用 Leo fixture 跑 buildReportDraft，逐行 diff y4Clue / narrative，人工检查与参考 PDF 的契合度
3. 用 Catherine fixture 跑，确认多学生不崩
4. dev 预览路由 `/e4/print-preview` 刷新，页面 1-7 内容更新正确

## Risks

- **naturalClue 规则覆盖不全**：不同学生协议的 metric 命名可能有差异 → 先用 Leo + Catherine 两个 fixture 验证，未知格式 fallback 到"原始值"而非崩溃
- **draftCoreFinding 的 block.judgment 为空**：某些学生的协议 E1 可能没有 block 级 judgment → fallback 到 flagged questions 拼接
- **narrative followUp 提取不准**：协议里的跟进线索可能跨维度、与当前维度无关 → 按 dimension 关键词过滤，无匹配则输出空（导师填）
- **不改 judgment 默认值映射**：VERDICT_DEFAULT_MAP 可能需要微调（比如协议 verdict 是"关注"时，参考 PDF 里有时给"暂未发现"有时给"可能存在"——这个由导师结合会议判断）
