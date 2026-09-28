# Checklist

- [x] 创建「学习」类记录（仅填主观评价）后，数据库写入的 `grade_label` 为 NULL、`eval_type` 为 1（Learning.jsx L767-770 类别守卫）
- [x] 创建「复习」类记录同样不写入任何客观评价（同一守卫覆盖 category 1/2）
- [x] 编辑一条无客观评价的记录（不改客观区）保存后仍无客观评价（onStartEdit 默认 objDeferred=true，L864）
- [x] 编辑历史幻影 B+ 的非练习类记录并保存后，`grade_label` 被置 NULL（onSaveEdit L928-931，纯 UPDATE 不删数据）
- [x] 编辑带客观评价的练习类记录，「清除客观评价」后保存，`grade_label` 为 NULL 且回到待补填列表（objDeferred 清除语义 + L1677-1681 显式提示 + 保存后 loadPending 刷新）
- [x] 记录卡片仅练习类显示「客观：X」标签；历史幻影值不再显示（L1758 显示守卫，数据库数据未改动）
- [x] 未执行任何 DELETE / 数据库结构变更（仅前端 UPDATE payload 置 null）
- [x] 桌面端（≥1024px）Learning 页双栏布局正常，无横向滚动（index.css L11149-11164 `.learn-cols` grid + 溢出修正节）
- [x] 移动端单列布局与原有交互（底部导航、滑动手势）不受影响（双栏仅 ≥1024px 生效，移动端样式未改动）
- [x] 所有模态框在桌面与移动端视口居中完整可见（Learning 两个 modal 已内联 fixed+flex 居中+85vh 上限；ProfileEditor 补 max-height 保险，L11199-11202）
- [x] 交互元素具备 hover 与 focus-visible 反馈（index.css L11204-11240 统一追加）
- [x] jest 测试与 build 通过（95 通过 / 8 个既有 Learning 失败，与基线一致；vite build ✓）
