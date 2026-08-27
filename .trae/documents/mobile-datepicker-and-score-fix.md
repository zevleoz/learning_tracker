# Plan: Mobile Date Picker + 修复成绩保存

## Summary

两个改动：

1. **学生端移动日期选择器**：把记录表单里的原生 `<input type="date">` 替换为自定义触控日历组件（仅移动端，Mentor 桌面端不动）
2. **修复成绩保存**：根因是 `schema.patch-exam-scores.sql` 引用了从未定义的 `public.trigger_set_timestamp()` 函数 → SQL 执行失败 → 表未创建 → INSERT 报错

***

## Current State Analysis

### 问题 1：日期选择器

* **当前实现**：[Learning.jsx#L1375-1378](file:///Users/jefflau/projects/一表人才/src/pages/Learning.jsx#L1375-L1378) 使用原生 `<input type="date">`

* 移动端原生 date picker 体验差：不同浏览器/系统 UI 不一致、触控目标小、不支持滑动切换月份

* 项目无日期选择器库（package.json 无依赖），但有 `framer-motion`（已安装）可用于动画

### 问题 2：成绩保存失败 — 根因找到

* **[schema.patch-exam-scores.sql#L65-68](file:///Users/jefflau/projects/一表人才/supabase/schema.patch-exam-scores.sql#L65-L68)**：引用 `public.trigger_set_timestamp()` 函数

* **该函数在整个代码库中从未定义**（已全局搜索确认）

* 用户在 Supabase SQL Editor 执行此补丁时，最后一步 `CREATE TRIGGER` 会报 `function public.trigger_set_timestamp() does not exist` → 可能导致整个脚本失败 → 表未创建 → INSERT 报 `relation "exam_scores" does not exist`

* 即使表创建成功，trigger 失败也让用户误以为补丁没跑成功

***

## Proposed Changes

### 改动 A：修复 SQL 补丁（根因修复）

**文件**：`supabase/schema.patch-exam-scores.sql`

在 trigger 创建之前（L63 附近）插入 `trigger_set_timestamp()` 函数定义：

```sql
-- ── 4. updated_at 触发器 ───────────────────────
create or replace function public.trigger_set_timestamp()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists set_timestamp_exam_scores on public.exam_scores;
create trigger set_timestamp_exam_scores
before update on public.exam_scores
for each row execute function public.trigger_set_timestamp();
```

这样用户重新执行此补丁就不会再报错。

### 改动 B：前端 saveScore 加预检 + 详细诊断

**文件**：`src/pages/Learning.jsx`（saveScore 函数 \~L559）

1. **预检**：在 insert/update 前先 `SELECT 1 FROM exam_scores LIMIT 1` 探测表是否存在
2. 如果预检失败 → 显示明确的 UI 级提示（不只是 toast），引导用户去执行 SQL 补丁
3. **详细日志**：catch 里把完整 error 对象 `JSON.stringify` 打到 console，方便远程诊断
4. **保留**：之前加的 friendlyErr 中文映射全部保留不动

### 改动 C：移动端日历日期选择器

**文件**：`src/pages/Learning.jsx`（新增组件 + 替换 input）

#### 新增 `MobileDatePicker` 组件（放在 LiquidGlassFlash 组件之后）

组件设计：

* **触发器**：一个可点击的日期显示条（显示当前选中日期，如 "2026-08-27"），点击后弹出日历

* **日历面板**：底部弹出的 modal（createPortal 到 body），framer-motion spring 动画

  * 月份标题 + ‹ › 箭头切换

  * 7 列网格（周日\~周六），日期格触控目标 ≥ 44px

  * **滑动切换**：左右滑动手势切月（framer-motion drag + dragOffset 判断方向）

  * 选中日期高亮（#0f172a 圆形背景 + 白色文字）

  * 今天用 #94a3b8 描边圆点标记

  * 配色严格用项目中性色 #0f172a / #94a3b8 / #e2e8f0

* **关闭**：点击遮罩或选中日期后自动关闭

* **仅移动端**：用 `window.matchMedia('(max-width: 767px)')` 判断，桌面端保持原生 `<input type="date">` 不变

#### 替换记录表单日期输入

在 [Learning.jsx#L1373-1379](file:///Users/jefflau/projects/一表人才/src/pages/Learning.jsx#L1373-L1379)：

* 移动端：渲染 `<MobileDatePicker value={dateStr} onChange={setDateStr} disabled={busy} />`

* 桌面端：保持 `<input type="date">` 不变

不改动时间输入（开始/结束 `<input type="time">`），用户只要求改日期选择器。

***

## Assumptions & Decisions

1. **不新增 npm 依赖**：日历组件完全用 React + framer-motion 实现，不引入 react-datepicker 等第三方库
2. **仅改学生端 Learning.jsx**：Mentor.jsx 桌面端不动
3. **仅改日期选择**：开始/结束时间仍用原生 `<input type="time">`（移动端原生 time picker 体验可接受）
4. **SQL 补丁函数名**：用 `trigger_set_timestamp` 保持与原脚本一致，加 `CREATE OR REPLACE` 确保幂等
5. **成绩 modal 里的日期选择也用 MobileDatePicker**：[Learning.jsx#L1952-1959](file:///Users/jefflau/projects/一表人才/src/pages/Learning.jsx#L1952-L1959) 的成绩 modal 考试日期也替换

***

## Verification Steps

1. `npx vite build` 零错误通过
2. 移动端（手机/DevTools 模拟）打开记录页 → 日期显示条可点击 → 弹出日历 → 左右滑动切月 → 点选日期 → 关闭 → 日期已更新
3. 桌面端打开记录页 → 日期仍是原生 `<input type="date">`
4. 用户重新执行修复后的 `schema.patch-exam-scores.sql`（在 Supabase SQL Editor）→ 不再报错
5. 成绩 tab 新增成绩 → 保存成功 → LiquidGlass ✓ 反馈 → 列表出现新成绩
6. 如果成绩仍然失败 → console 日志会显示完整 error JSON → 可精确定位

