# Tasks

- [x] Task 1: 修复幻影 B+ 写入路径（Learning.jsx）
  - [x] SubTask 1.1: `handleSubmit` 的 `hasObjective`/`gradeLabelValue` 计算加入 `category === 3` 守卫；非练习类写入 `grade_label: null`、`eval_type: 1`
  - [x] SubTask 1.2: `onSaveEdit` 加入同样的类别守卫，编辑非练习类记录保存时将幻影 `grade_label` 清洗为 NULL
  - [x] SubTask 1.3: 检查快速记录按钮等所有重置 `objIdx/objDeferred` 的入口，确认在守卫下不会产生副作用
- [x] Task 2: 编辑流程的客观评价默认值与可移除性
  - [x] SubTask 2.1: `onStartEdit` 中 `r.grade_label` 为空时默认 `objDeferred=true`（稍后补充），避免未触碰客观区保存即注入 B+
  - [x] SubTask 2.2: 编辑模式且记录已有客观评价时，客观评估区显示「清除客观评价」操作，保存后将 `grade_label` 置 NULL
  - [x] SubTask 2.3: 保存成功后刷新最近记录与待补填列表，清除后的练习类记录回到待补填
- [x] Task 3: 记录卡片「客观」标签显示守卫
  - [x] SubTask 3.1: 最近记录卡片仅当 `r.category === 3` 时渲染「客观：X」标签
- [x] Task 4: 学生端桌面响应式打磨
  - [x] SubTask 4.1: Learning 页 ≥1024px 双栏布局（表单列 + 最近记录列），移动端保持单列（样式追加到 src/index.css 末尾）
  - [x] SubTask 4.2: 排查学生端页面（Learning/Review/Syllabus/Notifications）横向滚动与超宽元素并修正
  - [x] SubTask 4.3: 确认所有模态框（待补填、成绩编辑、ProfileEditor）在桌面与移动端均视口居中完整可见
  - [x] SubTask 4.4: 交互元素补齐 hover 与 focus-visible 反馈（扁平、细线、中性墨色）
- [x] Task 5: 验证
  - [x] SubTask 5.1: 运行 jest 与 build 通过
  - [x] SubTask 5.2: 本地浏览器走查：创建学习类记录不出现 B+；编辑不注入 B+；清除客观评价生效；桌面双栏与移动端单列均正常

# Task Dependencies
- Task 2 依赖 Task 1（共用保存路径）
- Task 3 与 Task 1/2 无依赖，可并行
- Task 4 与 Task 1-3 无依赖，可并行
- Task 5 依赖 Task 1-4
