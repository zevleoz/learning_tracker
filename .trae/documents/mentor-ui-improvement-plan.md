# Mentor Intelligence Workspace - Improvement Plan

## Analysis: Current Problems

### 1. Raw SVG Charts Look Amateurish
- Hand-drawn SVG elements lack professional polish
- No tooltips, hover states, or interactivity
- Fixed pixel dimensions, not responsive
- Missing visual refinements (antialiasing, smooth curves, proper spacing)

### 2. No Decision-Support Narrative
- Page is a vertical scroll of 6+ disconnected charts
- No logical flow: "what's happening → why it matters → what to do"
- Mentor has to mentally piece together insights across disconnected sections

### 3. Redundant Data Tables
- Every chart duplicates information below it in a data table
- If exact numbers are needed, tooltips would be more appropriate
- Adds visual noise and forces unnecessary scrolling

### 4. Generic Chart Titles
- Titles like "自主 vs 辅导时间对比" are descriptive but don't frame the data
- Mentor asks questions, not descriptions: "哪些科目过度依赖辅导？"

### 5. Single-Column Layout Wastes Space
- Wide desktop screens have unused horizontal space
- Forces excessive vertical scrolling

### 6. No Sticky Context
- Key observations and action items are buried at the bottom
- Mentor loses context as they scroll through charts

## Solution: Two-Column Decision-Support Layout

### New Information Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  Header: Student Selection + Hero Insight                       │
├──────────────────────┬──────────────────────────────────────────┤
│                      │                                          │
│  LEFT COLUMN         │  RIGHT COLUMN (Sticky)                    │
│  Diagnostic          │                                          │
│  Visualizations      │  Key Observations                        │
│                      │  ───────────────────                      │
│  • 哪些科目过度依赖辅导？ │  • 学习频率不足                        │
│     Self vs Non-Self │  • 自主学习率偏低                        │
│     by Subject       │  • 物理/英语表现偏弱                      │
│                      │                                          │
│  • 学习行为如何分布？    │  ───────────────────                    │
│     Study/Review/    │                                          │
│     Practice         │  Action Items                            │
│                      │  ───────────────────                      │
│  • 周学习模式有何规律？  │  • 1. 提升物理/英语成绩               │
│     Weekday vs       │  • 2. 培养自主学习习惯                   │
│     Weekend          │  • 3. 提高学习频率                       │
│                      │                                          │
│  • 科目投入产出分析    │                                          │
│     Time vs Score    │                                          │
│                      │                                          │
│  • 学习趋势变化        │                                          │
│     14/30 Day Trend  │                                          │
│                      │                                          │
└──────────────────────┴──────────────────────────────────────────┘
```

### Files to Modify

1. **`src/pages/MentorAnalytics.jsx`** - Complete rewrite with:
   - Recharts integration
   - Two-column layout
   - Question-based section headers
   - Sticky context panel
   - Remove redundant data tables

2. **`src/index.css`** - Update styles for:
   - Two-column layout
   - Sticky positioning
   - Recharts container styling
   - Document-style improvements

3. **`package.json`** - Add Recharts dependency

### Implementation Steps

#### Step 1: Install Recharts
```bash
npm install recharts
```

#### Step 2: Refactor MentorAnalytics.jsx
- Import Recharts components: `BarChart`, `Bar`, `LineChart`, `Line`, `ScatterChart`, `Scatter`, `XAxis`, `YAxis`, `Tooltip`, `Legend`, `ResponsiveContainer`, `Cell`
- Create `DiagnosticSection` component that wraps each chart with a question header
- Create `ContextPanel` component for sticky observations and actions
- Rewrite all chart components using Recharts
- Remove all `chart-data-list` sections
- Implement two-column flex layout

#### Step 3: Update CSS
- Add `.mentor-intelligence__main` with `display: grid; grid-template-columns: 1fr 320px; gap: 48px;`
- Add `.mentor-intelligence__context` with `position: sticky; top: 48px;`
- Style Recharts containers with proper spacing and alignment
- Refine chart tooltips to show detailed information

#### Step 4: Test Build and Functionality
- Verify all charts render correctly
- Test tooltip interactions
- Verify sticky panel behavior
- Ensure responsive layout works

### Chart Mapping (Recharts)

| Current Chart | Recharts Type | Question Header |
|---------------|---------------|-----------------|
| SelfVsNonSelfByCourseChart | Horizontal BarChart | 哪些科目过度依赖辅导？ |
| LearningBehaviorDistribution | Horizontal BarChart (stacked) | 学习行为如何分布？ |
| WeeklyPatternChart | Grouped BarChart | 周学习模式有何规律？ |
| SubjectPerformanceChart | ScatterChart | 科目投入产出是否匹配？ |
| LearningTrendChart | ComboChart (Bar + Line) | 学习趋势如何变化？ |

### Risk Handling

1. **Recharts Compatibility**: Verify React version compatibility before installing
2. **Data Migration**: Ensure existing data structures work with Recharts
3. **Tooltip Styling**: Custom tooltips may need CSS overrides
4. **Sticky Positioning**: May need z-index adjustments for proper layering
5. **Performance**: Recharts can be heavy - use ResponsiveContainer carefully

### Success Criteria

- ✅ All charts use Recharts with professional tooltips and hover states
- ✅ Two-column layout with sticky context panel
- ✅ Chart sections framed as mentor questions
- ✅ No redundant data tables below charts
- ✅ Build completes without errors
- ✅ Page is responsive and accessible

---

*Plan generated based on user feedback and advisor recommendations*
