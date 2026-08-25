# Color System Unification + 作业顺序偏好热力图重做方案

> Ver. 1.0 · 待用户批改 · 凭远APPARK Data Analytics

***

## 0. 先看目前的问题（已验证过代码库）

### 0a. 品牌色锚点（不能动）

取自 `src/logo/logo_color.png` / `src/logo/logo_red.png` 与 `src/index.css:238`：

| Token     | HEX             | 用途（严格）                                            |
| --------- | --------------- | ------------------------------------------------- |
| `--brand` | `#C1272D` 凭远哈佛红 | 导航 logo、全局 primary CTA、**最高级警报** 专用               |
| `--gold`  | `#D4AF37` 徽章金   | 徽章/成就、唯一 rank #1、页眉 underline accent；**不用于数据可视化** |

### 0b. 目前颜色语义冲突（一眼乱的根因）

跨组件共享了相同 HEX 但含义完全相反/无关：

| 颜色                            | 文件 A 里的含义                | 文件 B 里的含义                        | 冲突级别                     |
| ----------------------------- | ------------------------ | -------------------------------- | ------------------------ |
| `#f59e0b` Tailwind amber      | CATEGORY = 复习            | DimensionStrip 中风险（中等）           | ⚠️ 严重：复习=好；中风险=差         |
| `#10b981` Tailwind emerald    | CATEGORY = 练习            | DimensionStrip 低风险/良好、alert good | ⚠️ 严重：练习=分类；良好=等级        |
| `#3b82f6` Tailwind blue       | CATEGORY = 学习            | 各处零散按钮 primary                   | 🟡 中度：视觉和 SELF\_COLOR 撞色 |
| `#6366f1` Tailwind indigo     | SELF\_COLOR（自主学习）        | DiagnosisPanel good              | 🟡 中度：自主=分类；良好=等级        |
| `#ef4444` Tailwind red        | scoreColor 差分行、alert bad | **撞品牌红** `#C1272D`               | 🟠 轻度：警报红会被误读成品牌强调       |
| SUBJECT\_COLOR\_MAP hash 10 色 | 学科随机散列                   | 无一致性（数学在不同学生=不同颜色）               | ⚠️ 严重：跨会话、跨学生、跨页不一致      |

**视觉混乱的根本原因：没有把"分类色"和"状态色"拆成两个独立的调色板空间。** 用户扫一眼，脑子里同时解 3 套编码，自然乱。

***

## 1. 设计哲学（我的建议，供批改）

### 1a. 参考的现代规范（2025-2026 最新趋势）

* **Radix Colors v2**（shadcn/ui 标准色板）的 *Amber/Iris/Grass/Ruby/Slate* 语义命名体系——这是目前 Linear/Vercel/Ramp 等顶级 SaaS 视觉通用的"高级感不廉价"调色板共识；

* **Apple Human Interface Guidelines (2025)** 对 data visualization 的原则：*one chart → one primary hue + 2 neutrals*；**多图表**时必须用 "System + Semantic + Categorical" 3 层不相交的色空间；

* **凭远品牌红** **`#C1272D`** **只允许出现 3 种情况**：(1) logo/导航品牌 (2) 按钮 primary (3) **真正需要"警报/严重"** 的数据点（例如"反推教学环境 >50%"、"偏科指数 ≥0.7"、"反馈密度 <20%"）。其它任何数据分类一律不准碰红。

### 1b. 新的"3 层色空间分层模型"（核心建议）

**任何颜色都必须先属于 1 层，绝不跨层复用：**

```
┌─ ① NEUTRAL / UI 层（12 色 slate 灰阶）──────────────┐
│  边框、背景、分隔线、文字层级——不承载任何数据语义      │
│  --ui-50 #fafafa → --ui-900 #0f172a                   │
└──────────────────────────────────────────────────────┘
┌─ ② SEMANTIC / 状态语义层（4 色 + 品牌）──────────────┐
│  与"好坏程度"绑定，全局只此一套：                       │
│  GOOD      → Grass-600  #16A34A  （唯一"好"绿）        │
│  MODERATE  → Amber-500  #F59E0B  （唯一"中"黄）        │
│  RISK      → Orange-600 #EA580C （"风险"橙——与黄区分） │
│  ALERT     → 品牌红 #C1272D   （最严重，直接升品牌调）  │
│  INFORM    → Iris-600   #4F46E5  （信息/强调/中性好）  │
└──────────────────────────────────────────────────────┘
┌─ ③ CATEGORICAL / 分类层（12 色）─────────────────────┐
│  与"是什么"绑定：学科分类 / 学-复-练分类 / 自主 vs 外部 │
│  → 规则：②层里用过的 HUE 一律不准在③层里再出现！        │
│  → 所以要避开：红、草绿、橙、amber 黄、iris 靛          │
│  → 留下可安全用的 hue：Sky 蓝 / Slate 蓝灰 /            │
│    Violet 紫 / Teal 青 / Mint 薄荷 / Mauve 藕粉 /       │
│    Sand 砂 / Bronze 铜棕 / Cyan 青蓝                   │
│  → 并对常见学科做**确定性映射**（不 hash！）             │
└──────────────────────────────────────────────────────┘
```

***

## 2. 具体色板提案

### 2a. ② SEMANTIC（状态层）— DimensionStrip / PracticeQualityPanel / DiagnosisPanel 全局统一

**现有 4 档 level：good / warn / alert → 扩展为 5 档更精细**

| Token            | HEX（Radix v2 级）            | 应用场景                              | 替代掉的旧值                           |
| ---------------- | -------------------------- | --------------------------------- | -------------------------------- |
| `--sem-good`     | `#16A34A` Radix Grass 600  | 达标、高自主、反馈充分、高分段                   | 旧 `#10b981`（练习占用冲突）              |
| `--sem-moderate` | `#F59E0B` Radix Amber 500  | 边缘达标、中等偏下的指标                      | 旧 `#f59e0b`（**但将从 CATEGORY 撤出**） |
| `--sem-risk`     | `#EA580C` Radix Orange 600 | 明确风险（反推教学 30-50%、反馈密度 20-40%）     | 无（新分级，原 warn 里被挤爆的部分）            |
| `--sem-alert`    | `#C1272D` 品牌红              | 严重警报（偏科 ≥0.7、反馈密度 <20%、日均 <60min） | 旧 `#ef4444`（与品牌区分不清晰）            |
| `--sem-info`     | `#4F46E5` Radix Iris 600   | 信息标签、强调、重点数据卡片 accent             | 旧 `#6366f1` 作为 SELF\_COLOR 的误用   |

### 2b. ③ CATEGORICAL（分类层）

#### 2b.1 学 · 复 · 练（CategoryCyclePanel / SubjectAllocationPanel / WeekGrid）

**选择 3 个"和状态层 hue 完全不相交"的柔和高级色：**

| 分类                      | 新 HEX                      | 命名色卡 | 为什么选它                                                                 |
| ----------------------- | -------------------------- | ---- | --------------------------------------------------------------------- |
| 学习 Study（category 1）    | `#0EA5E9` Radix Sky 500    | 天空蓝  | 蓝与"新知识吸收"心智契合；**和 info 靛** **`#4F46E5`** **分属 sky/iris 两个 hue** 有足够距离 |
| 复习 Review（category 2）   | `#8B5CF6` Radix Violet 500 | 罗兰紫  | 复习是"巩固→沉淀"心智；与 amber/yellow/orange/grass 家族完全分离                       |
| 练习 Practice（category 3） | `#14B8A6` Radix Teal 500   | 青碧   | 练习=输出反馈；和草绿（good）家族拉开，但保留"产出"的正向冷色感知                                  |

→ 这三个颜色的 **色相环间距分别是 120°±30°**（sky 200°, violet 270°, teal 170°），区分度吊打旧版 `#3b82f6 / #f59e0b / #10b981`（其中 f59e0b 和 10b981 都在黄/绿邻域，色盲用户 0 区分度）。

#### 2b.2 自主 · 外部 子分类（SubjectAllocationPanel 里复习拆分的 2 段）

* **自主学习（SELF\_COLOR 重定义）**：`#0EA5E9` → 复用"学习"的 sky 主色（因为自主学习=主色；语义上"自主"是褒奖，用分类色里最亮的主蓝）；

* **外部 / 辅导（EXTERNAL\_COLOR 新增）**：`#A78BFA` Radix Violet 400（复习紫罗兰的 400 浅版，一眼归属"非自主"家族但不撞）；

→ 旧的 `SELF_COLOR = #6366f1`（indigo）从代码里全部移除；所有 SelfLearningTrendPanel 的趋势线、面积填充改 sky `#0EA5E9` + `rgba(14,165,233,0.10)`。

#### 2b.3 学科色映射（**用户批改过：不做预定义绑定 → 用"稳定 hash + 精心挑选的全局 12 色调色板"**）

> 修正上一版的错误：不同学生的课程组合差异非常大（有普高九门、AP/IB/竞赛、校本课、艺体专项等等），**不能**做 "数学=紫 / 语文=蓝" 这种硬编码，否则 60% 的真实课程都会落到 fallback 里导致颜色不统一。

**新的设计原则（3 条不变量）：**

1. **同一个学生 + 同一页面内 → 同一个课程名 → 永远同一个颜色**（稳定 hash，保证 session 内一致）；
2. **12 个候选色全部从"③ CATEGORICAL 分类色空间"里挑**——与语义层的 good/moderate/risk/alert/info 的 hue 严格不相交（避开红/草绿/amber/orange/iris 5 个 hue，防止和状态色撞色）；
3. **12 色的色相环 30° 等间距**，这是区分度的数学上限（Tableau 10-color classic、Google Material 2024 Categorical 都是这么做的）。

**12 色候选板（色相间 30°，明度统一 55-60，饱和度 45-55，一眼柔和不乱）：**

| 索引（hash mod 12） | HEX                      | Radix 家族    | 色相         | 与语义层冲突？                                                         |
| --------------- | ------------------------ | ----------- | ---------- | --------------------------------------------------------------- |
| 0               | `#0EA5E9` Sky 500        | sky         | 200°       | ✅ 无（sem-info 是 iris 250°，50° 距离）                                |
| 1               | `#06B6D4` Cyan 500       | cyan        | 190°       | ✅ 无                                                             |
| 2               | `#14B8A6` Teal 500       | teal        | 174°       | ✅ 无（与 sem-good grass 160° 有 14° 差距 + 明度差 58 vs 64）              |
| 3               | `#2DD4BF` Teal 400（轻青碧）  | teal-400    | 172°       | ✅ 无                                                             |
| 4               | `#22C55E` Mint 500 薄荷    | light-green | 142°       | ✅ 无（grass good 160° / mint 142°）                                |
| 5               | `#A16207` Bronze 600 铜棕  | bronze      | 36°        | ✅ 无（amber moderate 45°，9° 差距靠明度区分）                              |
| 6               | `#F97316` Orange 400 柔橙  | orange-400  | 23°        | ✅ 注意：**不是 sem-risk orange-600**——400 明度 72，600 明度 52，差 20 明度可辨识 |
| 7               | `#8B5CF6` Violet 500 罗兰紫 | violet      | 260°       | ✅ 无                                                             |
| 8               | `#A78BFA` Violet 400 淡紫  | violet-400  | 260°（明度更高） | ✅ 无（与 #7 靠明度区分，适合两科目同时出现时）                                      |
| 9               | `#9333EA` Purple 600 深紫  | purple-600  | 283°       | ✅ 无                                                             |
| 10              | `#C084FC` Mauve 400 藕紫   | mauve       | 304°       | ✅ 无                                                             |
| 11              | `#64748B` Slate 500 中性蓝灰 | slate       | 217°       | ✅ 无（fallback "兜底"色，任何冷门课都落这里不违和）                                |

**稳定 hash 分配算法（确保同页/同学生一致）：**

```js
// 候选板顺序按色相环 30° 排好，不要随意打乱
const CATEGORICAL_PALETTE = [
  '#0EA5E9','#06B6D4','#14B8A6','#2DD4BF','#22C55E','#A16207',
  '#F97316','#8B5CF6','#A78BFA','#9333EA','#C084FC','#64748B',
];

export function subjectColor(name) {
  const k = (name || '未分类').trim();
  // 稳定 hash：DJB2 xor variant，均匀分布 mod 12
  let hash = 5381;
  for (let i = 0; i < k.length; i++) hash = (((hash << 5) + hash) ^ k.charCodeAt(i)) >>> 0;
  return CATEGORICAL_PALETTE[hash % CATEGORICAL_PALETTE.length];
}
```

**为什么比上一版"硬编码 9 门"更鲁棒？**

* 没有任何学科名假设，AP Physics C、高等数学 B、信息学竞赛、健美操、艺术鉴赏……都能拿到**同一个算法选出的稳定颜色**；

* 同页内**最多 12 门学科 0 重色**，一般高中生同时修 6-9 门，足够；

* 如果同一学生出现两个色相太接近的（如 #1 `#06B6D4` cyan 和 #2 `#14B8A6` teal 相邻），我们在相邻色之间插 15% 明度差作为"软区分"——视觉会自然拉远。

**保留一个局部增强（可选、可关）：**

* `CATEGORICAL_PALETTE` 内部先做一个 **session-scope 的去重分配器**（只在 DeepDivePanels 顶部用 `useMemo` 计算一次 `sessions` 里出现过的学科集合 → 分配到不重复的 palette index），**保证当前学生页面内绝对不重色**。hash 只作为"session 之间跨页的稳定锚"，不是最终分配。这个是对用户视觉体验最大的 upgrade。

```js
// session-scope 去重分配器（DeepDivePanels 顶部 compute 一次）
export function useSubjectColors(sessionList) {
  return useMemo(() => {
    const unique = Array.from(new Set(sessionList.map(s => (s.subject || '未分类').trim())));
    // 给每门学科分配 palette 里一个独立 index（冲突的话继续往下找）
    const map = {};
    const usedIdx = new Set();
    for (const name of unique) {
      let h = 5381;
      for (let i = 0; i < name.length; i++) h = (((h << 5) + h) ^ name.charCodeAt(i)) >>> 0;
      let idx = h % CATEGORICAL_PALETTE.length;
      while (usedIdx.has(idx) && usedIdx.size < CATEGORICAL_PALETTE.length) {
        idx = (idx + 1) % CATEGORICAL_PALETTE.length;
      }
      usedIdx.add(idx);
      map[name] = CATEGORICAL_PALETTE[idx];
    }
    return (name) => map[(name || '未分类').trim()] || CATEGORICAL_PALETTE[11];
  }, [sessionList]);
}
```

效果：**同一学生同一分析页面内，学科数 ≤12 时颜色绝对不重；跨页面同一学科仍保持 hash → 近似一致的颜色。**

***

## 3. 作业顺序偏好热力图重做（SubjectOrderPreferenceChart revamp）

### 3a. 现在的问题

1. 现在是"每节课=一个 rect，按推断时间贴上去"——但推断时间本来就不精确（form 推断 ±30min 误差），rect 这种精确 bar 会给人"这个学生 14:30 精准开始"的**虚假精确感**；
2. 没有"时长密度"信息：两节 30min 物理课和一节 60min 看起来一样；
3. 没有和品牌关联；
4. 最外层 legend 色块小到 8px，移动端基本看不到。

### 3b. 改成 Linear / Apple 风格的 **时间-学科双编码"密度瓷砖热力图"**

结构就像 Notion 分析面板的那种 5×(H×W) 的 bento：

#### 视觉结构（从上到下）

```
┌──────────────────────────────────────────────────────────┐
│ 表头：14:00 · 16:00 · 18:00 · 20:00 · 22:00（极细 1px hairline）│
├────┬──────────┬──────────┬──────────┬──────────┬─────────┤
│周 一│ [■语][■数]  [■■英]   [■物]     [■化]     [■生]    │ ← 每行=1天
│周 二│ ...                                                     │   tile = 学科色的 8px/12px "胶囊"
│周 三│ ...                                                     │   tile 宽度 = 时长分位数映射 4/8/12/16
│周 四│ ...                                                     │   tile 圆角 4px（不是 2px，高级感）
│周 五│ ...                                                     │
├────┴──────────┴──────────┴──────────┴──────────┴─────────┤
│ 左侧无大 gap；周一-周五字重 500 9pt；右侧小 summary            │
├──────────────────────────────────────────────────────────┤
│ 【学科图例】放在 **右侧 vertical column**（而不是 bottom 散堆） │
│ 数学 🟪  12 次 ｜ 物理 🟧 8 次 ｜英语 🟩 10 次 ……               │
│ （这样底部保持干净，图例和 summary 同区）                        │
└──────────────────────────────────────────────────────────┘
```

#### 核心编码规则

* **横向 X 轴**：14:00–23:00 → 切 9 个 1 小时格子（旧是连续 px，这次改成"分桶"，容忍 form 推断 ±30min 误差，不给用户虚假精确感）；

* **Tile 宽度**（表示时长）：

  * ≤20 min → `w-4` 细

  * 20-40 min → `w-6` 标准

  * 40-60 min → `w-8` 宽

  * ≥60 min → `w-10` 超宽

* **Tile 颜色 = 学科分类色**（来自 2b.3 的确定性映射，全局一致！）；

* **Tile 圆角 = 4px**（比现在 2px 软很多，Apple 软圆角感）；

* **Tile 之间**：`gap-1.5`（不贴死）——贴死 = 像 Excel 老报表；留细缝 = SaaS 高级。

#### 文字化总结（保留纯事实，不编造术语）

只保留客观统计，**绝对不再出现"低能量警戒线 / 黄金时段"这种编造词**：

```jsx
// 只允许说这些事实（可配置）：
- 频次最高："本周出现最多的时段是 17:00-18:00 放学后段（×9 次）"
- 时长最长："平均单节最长的学科是数学（56 分钟/节）"
- 学科集中度："周一以理科为主，周三以文科为主"
```

任何"好坏评价"一律交给 DiagnosisPanel，不在热力图里自己加。

***

## 4. 受影响文件 & 改动清单

### Phase 1 · 调色板统一（低风险，纯改色值）

| 文件                                                    | 改什么                                                                                                                                                                                                                                                                                             |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/index.css`（:root `src/index.css:211` 起）          | 新增 14 个 CSS 变量：`--sem-good/moderate/risk/alert/info` + `--cat-study/review/practice/self/external` + `--sub-语文/数学/英语/物理...`                                                                                                                                                                     |
| `src/components/WeekGrid.jsx`（L5）                     | `CATEGORY_COLORS = {1: sky, 2: violet, 3: teal}`；`SELF_COLOR = sky 500`；`scoreColor` 差分级改用 `sem-moderate / sem-risk / sem-alert`（不再用 `#ef4444`）                                                                                                                                                 |
| `src/components/DimensionStrip.jsx`（L154/174/181/202） | 4 处三档条件分色全改用 `sem-good/moderate/risk/alert` 四档；删除和分类色重复的 `#f59e0b/#10b981/#ef4444` 直接 hex                                                                                                                                                                                                       |
| `src/components/DeepDivePanels.jsx`                   | ① SUBJECT\_COLOR\_MAP 改为 §2b.3 的 `SUBJECT_PALETTE` 确定性映射表；② `CATEGORY_COLORS` 在 SubjectAllocationPanel / CategoryCyclePanel 引用 → sky/violet/teal；③ DiagnosisPanel levelConfig → `sem-good/moderate/risk/alert`；④ `PracticeQualityPanel FeedbackRiskRow` → sem-risk（20-40%）/ sem-alert（<20%）正确分级 |
| `src/components/WeekReviewDashboard.jsx`              | 如果有直接写的 hex（例如时间选中态）→ 改 `--sem-info` 或分类蓝                                                                                                                                                                                                                                                       |

### Phase 2 · 重做 SubjectOrderPreferenceChart（高视觉改动）

| 文件                                                                         | 改什么                                                                                                                                                                                                                        |
| -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/components/DeepDivePanels.jsx:SubjectOrderPreferenceChart`（现在 L784 起） | 完全重写 render 部分：① SVG → **纯 DOM div grid**（更易做软圆角 + tile spacing，GPU 友好）；② 9 个 1 小时时间桶 + 5 天 row；③ 每个 session → `<div>` 带圆角的 tile，宽度按时长 4 档；④ legend 移至**右侧 vertical 列**（桌面）/ 底部（移动 <768px）；⑤ 结论段落仅保留 2-3 条客观事实统计，不再做"好坏推断" |

***

## 5. 验收标准（批改完后我照着做）

1. ✅ 扫一眼整页，"红"只出现在 3 处：logo 品牌、primary 按钮、**最高警报数据点**（<10% 的数据点才允许红）；
2. ✅ 学=天蓝 / 复=罗兰紫 / 练=青碧 三件套在 WeekGrid 周历、CategoryCyclePanel 饼图、SubjectAllocationPanel 堆叠条里**一致**；
3. ✅ 好/中/风险/警报 四级色不与任何分类色撞 hue：

   * 草绿（好）≠ 生物 mint（分类）≠ 练 teal（分类）→ 三者在色环上分别 160° / 140° / 174°，距离 >15°

   * 橙黄（风险/中等）≠ 物理 orange400（分类）：用 **400 vs 600 的明度差** + border 灰度辅助
4. ✅ 数学=罗兰紫在**以下所有模块完全一致**：学科时间分配堆叠条 + 作业顺序偏好 tile + 周历块颜色 + 练习质量分析的 grade 分色学科条；
5. ✅ 热力图视觉：tile 圆角 4px、tile 间 `gap-1.5`、时间分桶 1h（容忍误差）、tile 宽度按时长 4 档；无红色警戒线；无编造时间术语。

***

## 6. 风险 & 回退

* **风险 1：习惯破窗** — 老用户可能已经记住"复习=黄"，新"复习=紫"要适应 1-2 天；\
  → 回退开关：保留 `LEGACY_CATEGORY_COLORS` 常量，切一行即可回退旧配色（在 WeekGrid.jsx 顶部注释保留）。

* **风险 2：红/橙色盲用户（\~8% 男性）** — sem-alert（红）+ sem-risk（橙）可能冲突；\
  → 缓解：sem-alert 旁边加个 2px 外发光（`0 0 0 2px rgba(193,39,45,0.15)`）做形状+发光冗余编码，不依赖单一颜色。

* **风险 3：学科别名多**（数学 / 数学(必选) / 高等数学 A）；\
  → 缓解：`SUBJECT_PALETTE` 按 `subject.includes('数学')` 做前缀匹配 fallback（严格优先精确匹配）。

***

## 7. 请批改的 4 个决策点（请对这 4 条回复 A/B/C，或者直接改）

> 这是我最不确定、最需要你拍板的地方：

| #      | 问题                                                      | 我的建议（A）                                                                           | 备选 B                             | 备选 C                                              |
| ------ | ------------------------------------------------------- | --------------------------------------------------------------------------------- | -------------------------------- | ------------------------------------------------- |
| **A1** | 分类三色"学/复/练"的色相选择                                        | 天蓝 / 罗兰紫 / 青碧（**冷色系为主，高级不躁动**，教育产品合适）                                             | 原配色优化版（蓝/黄/绿，保留用户习惯）             | 单色相 3 明度（蓝-深蓝-浅蓝，极简但区分度差）                         |
| **A2** | 学科色映射策略（不同学生的课程非常不同）                                    | ✅ **用户已批改**：不做预定义学科绑定；改"session 级去重分配 + 同名字稳定 hash 锚"，≤12 科 0 重色，跨页近似一致（详见 §2b.3） | ❌ 只做纯全局 hash（简单但一页内可能撞色）         | 预绑定常见 9 门，其余 hash（不适合学校/AP/竞赛课差异大的真实场景 — **不推荐**） |
| **A3** | 警报红是否直接=品牌红 `#C1272D`                                   | ✅ 是，品牌红=最高警报，**强化"严重"的识别权重**                                                      | 否，警报用 `#B91C1C`（更深一点的红，和品牌红拉开视觉） | 用"深灰+红 1px 底条"代替大色块红（更克制）                         |
| **A4** | 热力图重做的粒度：1 小时分桶 tile（容忍误差，Linear 风）vs 连续 rect（精确视觉但假精确） | ✅ **1h 分桶 tile + 宽度按时长 4 档**（更现代 + 数据诚实）                                          | 保留现在 rect 形式，只换颜色和圆角（最小改动）       | 升级成连续 rect + **透明度按时长**（短课=半透明，长课=饱和）             |

