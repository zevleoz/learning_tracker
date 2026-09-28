# E4 报告打印对齐参考设计 Implementation Plan

## Repository Research

当前打印实现位于 `src/components/e4/FirstReportPrint.jsx`，样式集中在 `src/index.css` 的 `.e4-print-*` 段（L7862 起约 200 行）。内容逻辑已对（封面 / 02 如何阅读 / 03–06 四维清单 / 07 综合判断），但视觉骨架与参考设计差距较大。`e4ReportTemplate.js` 已提供 DIMENSIONS（含四个 narrative key 颜色语义）、CHECKLIST_ROWS、JUDGMENT_STATES、REPORT_STATIC 文案，模板层无需改动，全部为组件 + CSS 改动。

参考图（已拿到前 5 页：封面 / 02 如何阅读 / 03 Emotion / 04 Energy / 05 Engine），用户将继续上传剩余 2 页（06 Engagement / 07 综合判断）。**本方案基于已知 5 页设计 + 合理外推 06 / 07**，若后续上传后发现 07 页有独特设计，届时按真实图微调。

### 参考设计 vs 当前实现差距矩阵

| 元素 | 参考 | 当前 | 涉及文件 |
|------|------|------|----------|
| **每页四角** 虚线 L 裁切标记 | ✅ | ❌ | CSS |
| **每页底部** 三列页脚（品牌 / 模板信息 / 页码 X/7） | ✅ | ❌ | JSX + CSS |
| **每页顶部** 章节条（红色● + 章节名 + 右对齐 学生·日期） | ✅ | ❌ | JSX + CSS |
| 封面：品牌盾形 Logo（凭远 APP·ARK + WORK HARD · DREAM BIG） | ✅ | ❌（只有 kicker） | JSX + CSS（用现有 SVG 或 emoji 代替） |
| 封面信息表：label 红色、无边框行式 | ✅ | ❌（label 灰、有分隔线） | CSS |
| 封面保密声明：红色左边框 + 浅红底 | ✅ | ❌（只有顶部分隔线） | CSS |
| 02 如何阅读：4E 网格 2×2，每个 E 有专属色（Emotion 红 / Energy 橙 / Engine 青 / Engagement 绿） | ✅ | ❌（纵向列表、无配色） | JSX + CSS + REPORT_STATIC 小幅 |
| 02 如何阅读：判断流程 01–04 横排 4 格 | ✅ | ❌（2×2 卡片） | JSX + CSS |
| 02 如何阅读：四种判断 2×2 卡片带语义色 | ✅ | ❌（灰底无状态色） | JSX + CSS |
| 02 底部阅读原则：红色左边框 + 居中文字 | ✅ | ❌（普通段落） | CSS |
| 维度页表格表头：深色海军底 + 白字 | ✅ | ❌（浅灰底） | CSS |
| 维度页「综合判断」列：按 verdict 上色（暂未发现=青 / 可能存在=橙 / 已确认问题=红） | ✅ | ❌（纯文本） | JSX + CSS |
| 维度页底部 narrative 盒子：每种有专属色条（coreFinding=青 / followUp=橙 / learningImpact=橙 / strengths=蓝） | ✅ | ❌（统一灰白） | JSX + CSS + DIMENSIONS 扩 `barColor` |
| 维度页 intro 段落置于「核心问题」上方 | ✅ | ✅ | 已对齐 |
| 维度页 supplement 表格存在 | ✅ | ✅ | 已对齐 |
| 页码总数写死 7 | ✅ | ❌ | JSX 常量 `const TOTAL_PAGES = 7` |

### 设计 token 推断（从参考图提取）

- `--e4-red: #C43B3B`（标签、●、保密/原则左边框、Emotion 标题）
- `--e4-red-bg: #FDF1F1`（保守估计，保密声明底色）
- `--e4-orange: #D97706`（可能存在、followUp、learningImpact、Energy 标题）
- `--e4-orange-bg: #FFF7ED`
- `--e4-teal: #14B8A6`（暂未发现、coreFinding、Engine 标题）
- `--e4-teal-bg: #F0FDFA`
- `--e4-blue: #3B82F6`（可利用优势、Engagement 标题）
- `--e4-blue-bg: #EFF6FF`
- `--e4-navy: #1E2A3A`（表头深色底）
- `--e4-text: #1F2937`、`--e4-muted: #64748B`
- 字体：系统 sans-serif，正文 10–10.5pt，表头 9.5pt 白字，数字大号 30–36pt 极粗

### 模板层改动（极少）

REPORT_STATIC.fourE / processSteps / states 已有数据，只需在模板中给 E 和 state 加一个 `tint` 字段映射到 CSS 变量名。DIMENSIONS 每个 narrative 加 `barColor` 字段（4 种：teal/orange/blue）。这两处都在 `src/lib/e4ReportTemplate.js`，不影响已生成的报告，只是给新渲染提供钩子。

## Files and Modules

- `src/components/e4/FirstReportPrint.jsx`：重写结构。加入 `PageShell` 子组件（统一渲染每页的顶部章节条 + 四角裁切 + 底部页脚）；封面加盾形 logo 占位；每个 `td.col-judgment` 按 verdict 加 className `judgment-teal / judgment-orange / judgment-red`；narrative box 按 `barColor` 加 className；页码计数用 `TOTAL_PAGES=7`。
- `src/lib/e4ReportTemplate.js`：给 REPORT_STATIC.fourE 每项加 `tint:'red|orange|teal|blue'`；states 每项加 `tint:'red|orange|teal|gray'`；DIMENSIONS[*].narratives 每项加 `barColor:'teal|orange|blue'`。**全部是追加字段，无破坏性改动**。
- `src/index.css` `.e4-print-*` 段（L7862–L8040 左右）：整段重写。引入上述 token；新增 `.e4-page-shell`（四角裁切、章节条、页脚）、`.e4-crop-mark`、`.e4-chapter-strip`、`.e4-page-footer`；表格表头改为 navy 白字；`.col-judgment` 按 verdict 上色；narrative box 按 barColor 上色；封面品牌 logo 占位；A4 @page 规则保持不变。

## Implementation Steps

1. **模板扩展**（`e4ReportTemplate.js`）：给 fourE / states / narratives 追加 tint / barColor 字段。**无破坏性**。
2. **JSX 结构重写**（`FirstReportPrint.jsx`）：
   - 抽取 `PageShell({chapterLabel, chapterTint, studentName, reportDate, pageIndex, children})` 组件，统一输出：四角裁切 div、顶部章节条（● tint 色 + chapterLabel 左、student·date 右）、children、底部页脚（三列 + `{pageIndex} / {TOTAL_PAGES}`）。
   - 封面：不用 PageShell（封面无章节条），但保留裁切标记 + 底部页脚；加盾形 logo（用内联 SVG 占位或 emoji，视觉对齐即可）；intro 段；信息表 label 红色；保密声明红色左边框 + 浅红底。
   - 02 如何阅读：用 PageShell（chapterLabel="INTRODUCTION", tint=red）；4E 改为 2×2 grid 带 tint；流程横排 4 格；判断状态 2×2 带 tint；阅读原则红框居中。
   - 03–06 维度页：PageShell（chapterLabel=`${dim.short.toUpperCase()} CHECKLIST`, tint=该 dim 主色）；表头 navy 白字；`td.col-judgment` 按 verdict 上色；底部 narrative box 按 barColor 上色。
   - 07 综合判断：PageShell（chapterLabel="JUDGMENT · ACTION PLAN" 或类似，等用户上传 07 参考图后微调）。
3. **CSS 整段替换**（index.css）：引入 token → PageShell / 裁切 / 章节条 / 页脚 → 封面 → 02 → 维度页（表格 + verdict 上色 + narrative 盒子）→ 打印 @media 覆盖。
4. **本地验证**：dev server 打开 `/e4/reports/:id/print`（若已有报告）或 build 后看产物；确保 A4 @page、分页、空单元格为「—」均保持。

## Dependencies and Considerations

- 已有 form_data 不包含新增 tint / barColor 字段 → 渲染时做 fallback（无 tint 用中性灰），旧报告仍能正常打印。**不要求重新拉取协议**。
- 封面盾形 logo：参考图有彩色校徽，我们没有源文件 → 用内联 SVG 或简化的色块+文字占位（"凭远 APP·ARK" + "WORK HARD · DREAM BIG"），视觉接近即可。后续有 logo 源文件时替换。
- 页码总数硬编码 7（参考图底栏显示 1/7、2/7…），与实际章节数匹配（封面 + 02 + 03–06 + 07 = 7 页）。如果后续加页改常量即可。
- 维度主色：从参考图提取 Emotion=红 / Energy=橙 / Engine=青 / Engagement=绿 → 在 DIMENSIONS 上新增 `accent` 字段。
- 打印时不加载外部字体，全部用系统栈 + pt 单位。

## Validation

- `npm run build` 通过（JSX/CSS 无语法错误）。
- `npm test` 原有 90 个通过、8 个既有 Learning 失败仍为原数字（不新增失败）。
- 浏览器 DevTools device toolbar 选 A4 100% → 每页分页正确、表头不跨页、narrative 盒子不与表格叠。
- 空 form_data 字段仍输出「—」，无 undefined / 空白。
- verdict 列颜色：暂未发现=青 / 可能存在=橙 / 已确认问题=红。
- 章节条、裁切、页脚每页一致出现。

## Risks

- **risk**: 用户后续上传的 06 / 07 页可能有不同设计（例如 07 有特殊 header 或表格结构） → handling: 先把通用骨架（PageShell）做扎实，07 的具体表格按最终参考图微调，属局部改动。
- **risk**: 真实打印时浏览器对 `background-color` 的支持 → handling: CSS 中保留 `@media print { -webkit-print-color-adjust: exact; print-color-adjust: exact; }`。
- **risk**: 中文 pt 字号跨浏览器细微差异 → handling: 全部用 pt 单位（参考图是印刷品按 pt 设计），同一浏览器内一致即可，允许细微差异。
- **risk**: 旧报告 form_data 无 tint 字段 → handling: 渲染 fallback（无 tint 时用中性色 `#64748b`），不崩。
