-- ================================================================
-- 学生人设数据填充脚本（硬编码真实 syllabus ID）
-- 学生: 2135982912@qq.com (user_id: fcf5a8c5-2a36-49aa-9c1b-2c2ea754bfe8)
--
-- 真实 syllabus:
--   1. IB AA HL (数学)      - 7fc83e4c-ad97-488e-8f1d-541ab6cac513
--   2. Physics              - 32634a55-afe7-4522-b529-f077b7f5f733
--   3. English              - 858625cf-d381-4f7b-b68d-b5d28a3b43f1
--   4. Language & Literature- abac9184-5cff-4b54-ac13-5d00edf4ca77
--
-- 人设: 数学有问题的学生
--   - IB AA HL: 只被动上课, 时间很晚(21:00+), 短(20-30min), 低分(50-70),
--              完全无自主学习/复习/练习, 章节单元经常 NULL 或错位
--   - 其他科目: 被动为主, 时间正常(15:00-20:00), 中等(30-45min), 分数(65-85),
--              偶尔少量自主复习(self_rating偏低)
--
-- 运行方式: Supabase Dashboard → SQL Editor → 粘贴运行
-- ================================================================

-- ========== 1. 先清理该学生所有旧数据（包括之前错误的记录）==========
DELETE FROM learning_sessions
WHERE student_id = 'fcf5a8c5-2a36-49aa-9c1b-2c2ea754bfe8';

-- ========== 2. 插入数据 ==========

-- ================================================================
-- 第 1 周（3 周前）
-- ================================================================

-- ---- IB AA HL 数学（3条）: 被动, 晚, 短, 低分, 不关联/错位 ----
INSERT INTO learning_sessions
  (student_id, course_id, chapter_id, unit_id, category, form, eval_type, score, self_rating, duration_minutes, session_date, start_time)
VALUES
  -- Mon 21:00 学校课堂, 不关联
  ('fcf5a8c5-2a36-49aa-9c1b-2c2ea754bfe8', '7fc83e4c-ad97-488e-8f1d-541ab6cac513', NULL, NULL, 1, '学校课堂', 2, 58, NULL, 25, date_trunc('week', current_date)::date - 21, '21:00'),
  -- Wed 21:30 学校作业, 不关联
  ('fcf5a8c5-2a36-49aa-9c1b-2c2ea754bfe8', '7fc83e4c-ad97-488e-8f1d-541ab6cac513', NULL, NULL, 3, '学校作业', 2, 55, NULL, 20, date_trunc('week', current_date)::date - 19, '21:30'),
  -- Fri 21:00 学校课堂, 错位：chapter=PROPERTIES OF CURVES 但 unit=The chain rule (属于另一个chapter)
  ('fcf5a8c5-2a36-49aa-9c1b-2c2ea754bfe8', '7fc83e4c-ad97-488e-8f1d-541ab6cac513',
   '18456911-8292-4d5f-9bab-7b8b2c301ab8',  -- PROPERTIES OF CURVES (chapter)
   'f1fbda99-f83b-4756-9ffa-761ff06bc779',  -- The chain rule (属于 RULES OF DIFFERENTIATION 的 unit) → 错位
   1, '学校课堂', 2, 62, NULL, 25, date_trunc('week', current_date)::date - 17, '21:00');

-- ---- Physics（3条）----
INSERT INTO learning_sessions
  (student_id, course_id, chapter_id, unit_id, category, form, eval_type, score, self_rating, duration_minutes, session_date, start_time)
VALUES
  ('fcf5a8c5-2a36-49aa-9c1b-2c2ea754bfe8', '32634a55-afe7-4522-b529-f077b7f5f733',
   'd68fe1a7-e633-437c-b49f-92a3e5381c09', '8b2735b0-ed9f-411c-abad-5e6daa51b857', 1, '学校课堂', 2, 72, NULL, 35, date_trunc('week', current_date)::date - 21, '18:00'),
  ('fcf5a8c5-2a36-49aa-9c1b-2c2ea754bfe8', '32634a55-afe7-4522-b529-f077b7f5f733',
   'd68fe1a7-e633-437c-b49f-92a3e5381c09', '8b2735b0-ed9f-411c-abad-5e6daa51b857', 3, '学校作业', 2, 70, NULL, 30, date_trunc('week', current_date)::date - 19, '19:00'),
  ('fcf5a8c5-2a36-49aa-9c1b-2c2ea754bfe8', '32634a55-afe7-4522-b529-f077b7f5f733',
   'd68fe1a7-e633-437c-b49f-92a3e5381c09', 'aaaa5a60-8993-41e7-8b5f-c64463bd6620', 1, '校外线下', 2, 65, NULL, 50, date_trunc('week', current_date)::date - 16, '14:00');

-- ---- English（3条）----
INSERT INTO learning_sessions
  (student_id, course_id, chapter_id, unit_id, category, form, eval_type, score, self_rating, duration_minutes, session_date, start_time)
VALUES
  ('fcf5a8c5-2a36-49aa-9c1b-2c2ea754bfe8', '858625cf-d381-4f7b-b68d-b5d28a3b43f1',
   '210d3e49-6898-48de-85f8-c7667d1439ee', '2c973b2e-4955-4c3b-99eb-b6051810b8b1', 1, '学校课堂', 2, 75, NULL, 40, date_trunc('week', current_date)::date - 20, '16:00'),
  ('fcf5a8c5-2a36-49aa-9c1b-2c2ea754bfe8', '858625cf-d381-4f7b-b68d-b5d28a3b43f1',
   '210d3e49-6898-48de-85f8-c7667d1439ee', '1db1b29b-12d0-4e7c-aa52-7e548b6edd53', 3, '学校作业', 2, 78, NULL, 30, date_trunc('week', current_date)::date - 17, '17:00'),
  ('fcf5a8c5-2a36-49aa-9c1b-2c2ea754bfe8', '858625cf-d381-4f7b-b68d-b5d28a3b43f1',
   '210d3e49-6898-48de-85f8-c7667d1439ee', NULL, 2, '自主复习', 1, NULL, 60, 30, date_trunc('week', current_date)::date - 16, '16:00');

-- ---- Language & Literature（3条）----
INSERT INTO learning_sessions
  (student_id, course_id, chapter_id, unit_id, category, form, eval_type, score, self_rating, duration_minutes, session_date, start_time)
VALUES
  ('fcf5a8c5-2a36-49aa-9c1b-2c2ea754bfe8', 'abac9184-5cff-4b54-ac13-5d00edf4ca77',
   '523c9b4e-476f-425c-ab3f-6517ff763678', 'af19e241-fdf6-4f1c-bcbf-0cf9221375c0', 1, '学校课堂', 2, 80, NULL, 35, date_trunc('week', current_date)::date - 19, '15:00'),
  ('fcf5a8c5-2a36-49aa-9c1b-2c2ea754bfe8', 'abac9184-5cff-4b54-ac13-5d00edf4ca77',
   '5622c995-f2cf-44f6-96df-b6e9fe425c52', 'a0f7a63f-18e5-4fb0-833b-c30ac621655f', 3, '学校作业', 2, 82, NULL, 25, date_trunc('week', current_date)::date - 17, '18:00'),
  ('fcf5a8c5-2a36-49aa-9c1b-2c2ea754bfe8', 'abac9184-5cff-4b54-ac13-5d00edf4ca77',
   '5622c995-f2cf-44f6-96df-b6e9fe425c52', 'a0f7a63f-18e5-4fb0-833b-c30ac621655f', 3, '学校作业', 2, 81, NULL, 25, date_trunc('week', current_date)::date - 16, '15:00');

-- ================================================================
-- 第 2 周（2 周前）
-- ================================================================

-- ---- IB AA HL 数学（4条）----
INSERT INTO learning_sessions
  (student_id, course_id, chapter_id, unit_id, category, form, eval_type, score, self_rating, duration_minutes, session_date, start_time)
VALUES
  ('fcf5a8c5-2a36-49aa-9c1b-2c2ea754bfe8', '7fc83e4c-ad97-488e-8f1d-541ab6cac513', NULL, NULL, 1, '学校课堂', 2, 62, NULL, 25, date_trunc('week', current_date)::date - 14, '21:00'),
  ('fcf5a8c5-2a36-49aa-9c1b-2c2ea754bfe8', '7fc83e4c-ad97-488e-8f1d-541ab6cac513', NULL, NULL, 3, '学校作业', 2, 58, NULL, 20, date_trunc('week', current_date)::date - 12, '21:30'),
  -- 错位：chapter=PROPERTIES OF CURVES, unit=The product rule (属于 RULES OF DIFFERENTIATION)
  ('fcf5a8c5-2a36-49aa-9c1b-2c2ea754bfe8', '7fc83e4c-ad97-488e-8f1d-541ab6cac513',
   '18456911-8292-4d5f-9bab-7b8b2c301ab8', 'd44f8fcc-6fd4-4d82-a23c-2dae3bd94721',
   1, '学校课堂', 2, 61, NULL, 25, date_trunc('week', current_date)::date - 10, '21:00'),
  ('fcf5a8c5-2a36-49aa-9c1b-2c2ea754bfe8', '7fc83e4c-ad97-488e-8f1d-541ab6cac513', NULL, NULL, 3, '学校作业', 2, 55, NULL, 20, date_trunc('week', current_date)::date - 8, '21:00');

-- ---- Physics（4条）----
INSERT INTO learning_sessions
  (student_id, course_id, chapter_id, unit_id, category, form, eval_type, score, self_rating, duration_minutes, session_date, start_time)
VALUES
  ('fcf5a8c5-2a36-49aa-9c1b-2c2ea754bfe8', '32634a55-afe7-4522-b529-f077b7f5f733',
   'd68fe1a7-e633-437c-b49f-92a3e5381c09', 'aaaa5a60-8993-41e7-8b5f-c64463bd6620', 1, '学校课堂', 2, 73, NULL, 35, date_trunc('week', current_date)::date - 14, '18:00'),
  ('fcf5a8c5-2a36-49aa-9c1b-2c2ea754bfe8', '32634a55-afe7-4522-b529-f077b7f5f733',
   '8a8578f9-a6a5-4139-ae71-c25be4e36bf8', '04002299-a74b-498f-b78f-6169c7cc9405', 1, '校外线上', 2, 71, NULL, 40, date_trunc('week', current_date)::date - 12, '19:00'),
  ('fcf5a8c5-2a36-49aa-9c1b-2c2ea754bfe8', '32634a55-afe7-4522-b529-f077b7f5f733',
   '8a8578f9-a6a5-4139-ae71-c25be4e36bf8', '04002299-a74b-498f-b78f-6169c7cc9405', 3, '学校作业', 2, 66, NULL, 35, date_trunc('week', current_date)::date - 10, '17:00'),
  ('fcf5a8c5-2a36-49aa-9c1b-2c2ea754bfe8', '32634a55-afe7-4522-b529-f077b7f5f733',
   '8a8578f9-a6a5-4139-ae71-c25be4e36bf8', '04002299-a74b-498f-b78f-6169c7cc9405', 2, '自主复习', 1, NULL, 40, 25, date_trunc('week', current_date)::date - 8, '16:00');

-- ---- English（3条）----
INSERT INTO learning_sessions
  (student_id, course_id, chapter_id, unit_id, category, form, eval_type, score, self_rating, duration_minutes, session_date, start_time)
VALUES
  ('fcf5a8c5-2a36-49aa-9c1b-2c2ea754bfe8', '858625cf-d381-4f7b-b68d-b5d28a3b43f1',
   '875f6c39-d7e6-4d48-a968-0c0a2dcdcf1d', '701e599f-4d7f-47b6-8491-633e91e42c42', 3, '学校作业', 2, 76, NULL, 30, date_trunc('week', current_date)::date - 14, '17:00'),
  ('fcf5a8c5-2a36-49aa-9c1b-2c2ea754bfe8', '858625cf-d381-4f7b-b68d-b5d28a3b43f1',
   '875f6c39-d7e6-4d48-a968-0c0a2dcdcf1d', '9167903c-1fb6-4edd-a3dc-d55874fdaec0', 1, '学校课堂', 2, 77, NULL, 35, date_trunc('week', current_date)::date - 12, '15:00'),
  ('fcf5a8c5-2a36-49aa-9c1b-2c2ea754bfe8', '858625cf-d381-4f7b-b68d-b5d28a3b43f1',
   '875f6c39-d7e6-4d48-a968-0c0a2dcdcf1d', '7b9b754d-e188-4d92-8f78-b342f26dab09', 3, '学校作业', 2, 79, NULL, 30, date_trunc('week', current_date)::date - 10, '19:00');

-- ---- Language & Literature（3条）----
INSERT INTO learning_sessions
  (student_id, course_id, chapter_id, unit_id, category, form, eval_type, score, self_rating, duration_minutes, session_date, start_time)
VALUES
  ('fcf5a8c5-2a36-49aa-9c1b-2c2ea754bfe8', 'abac9184-5cff-4b54-ac13-5d00edf4ca77',
   '5622c995-f2cf-44f6-96df-b6e9fe425c52', '3d9171e5-3d4e-47dc-9463-58bd2143f582', 3, '学校作业', 2, 81, NULL, 25, date_trunc('week', current_date)::date - 13, '18:00'),
  ('fcf5a8c5-2a36-49aa-9c1b-2c2ea754bfe8', 'abac9184-5cff-4b54-ac13-5d00edf4ca77',
   '5622c995-f2cf-44f6-96df-b6e9fe425c52', '3d9171e5-3d4e-47dc-9463-58bd2143f582', 2, '自主复习', 1, NULL, 60, 30, date_trunc('week', current_date)::date - 11, '16:00'),
  ('fcf5a8c5-2a36-49aa-9c1b-2c2ea754bfe8', 'abac9184-5cff-4b54-ac13-5d00edf4ca77',
   'f9ae6c99-de01-43b7-b148-2383475512c6', 'c3fef55f-7480-4121-976d-212c3fb5a6cc', 1, '学校课堂', 2, 83, NULL, 35, date_trunc('week', current_date)::date - 9, '15:00');

-- ================================================================
-- 第 3 周（上周）
-- ================================================================

-- ---- IB AA HL 数学（4条）----
INSERT INTO learning_sessions
  (student_id, course_id, chapter_id, unit_id, category, form, eval_type, score, self_rating, duration_minutes, session_date, start_time)
VALUES
  ('fcf5a8c5-2a36-49aa-9c1b-2c2ea754bfe8', '7fc83e4c-ad97-488e-8f1d-541ab6cac513', NULL, NULL, 1, '学校课堂', 2, 63, NULL, 25, date_trunc('week', current_date)::date - 7, '21:00'),
  ('fcf5a8c5-2a36-49aa-9c1b-2c2ea754bfe8', '7fc83e4c-ad97-488e-8f1d-541ab6cac513', NULL, NULL, 3, '学校作业', 2, 59, NULL, 20, date_trunc('week', current_date)::date - 5, '21:30'),
  -- 错位：chapter=PROPERTIES OF CURVES, unit=The quotient rule (属于 RULES OF DIFFERENTIATION)
  ('fcf5a8c5-2a36-49aa-9c1b-2c2ea754bfe8', '7fc83e4c-ad97-488e-8f1d-541ab6cac513',
   '18456911-8292-4d5f-9bab-7b8b2c301ab8', '7edea625-3b13-43d6-bbf6-20c69081ba37',
   1, '学校课堂', 2, 62, NULL, 25, date_trunc('week', current_date)::date - 3, '21:00'),
  ('fcf5a8c5-2a36-49aa-9c1b-2c2ea754bfe8', '7fc83e4c-ad97-488e-8f1d-541ab6cac513', NULL, NULL, 3, '学校作业', 2, 56, NULL, 20, date_trunc('week', current_date)::date - 1, '21:00');

-- ---- Physics（4条）----
INSERT INTO learning_sessions
  (student_id, course_id, chapter_id, unit_id, category, form, eval_type, score, self_rating, duration_minutes, session_date, start_time)
VALUES
  ('fcf5a8c5-2a36-49aa-9c1b-2c2ea754bfe8', '32634a55-afe7-4522-b529-f077b7f5f733',
   'd68fe1a7-e633-437c-b49f-92a3e5381c09', 'aaaa5a60-8993-41e7-8b5f-c64463bd6620', 1, '学校课堂', 2, 74, NULL, 35, date_trunc('week', current_date)::date - 7, '18:00'),
  ('fcf5a8c5-2a36-49aa-9c1b-2c2ea754bfe8', '32634a55-afe7-4522-b529-f077b7f5f733',
   'd68fe1a7-e633-437c-b49f-92a3e5381c09', '30d98ffd-30a5-4df7-ae31-57108bc73490', 3, '学校作业', 2, 73, NULL, 30, date_trunc('week', current_date)::date - 6, '19:00'),
  ('fcf5a8c5-2a36-49aa-9c1b-2c2ea754bfe8', '32634a55-afe7-4522-b529-f077b7f5f733',
   '8a8578f9-a6a5-4139-ae71-c25be4e36bf8', '04002299-a74b-498f-b78f-6169c7cc9405', 1, '校外线上', 2, 75, NULL, 40, date_trunc('week', current_date)::date - 3, '19:00'),
  ('fcf5a8c5-2a36-49aa-9c1b-2c2ea754bfe8', '32634a55-afe7-4522-b529-f077b7f5f733',
   '8a8578f9-a6a5-4139-ae71-c25be4e36bf8', '04002299-a74b-498f-b78f-6169c7cc9405', 2, '自主复习', 1, NULL, 60, 30, date_trunc('week', current_date)::date - 2, '16:00');

-- ---- English（3条）----
INSERT INTO learning_sessions
  (student_id, course_id, chapter_id, unit_id, category, form, eval_type, score, self_rating, duration_minutes, session_date, start_time)
VALUES
  ('fcf5a8c5-2a36-49aa-9c1b-2c2ea754bfe8', '858625cf-d381-4f7b-b68d-b5d28a3b43f1',
   '875f6c39-d7e6-4d48-a968-0c0a2dcdcf1d', '701e599f-4d7f-47b6-8491-633e91e42c42', 1, '学校课堂', 2, 76, NULL, 35, date_trunc('week', current_date)::date - 5, '15:00'),
  ('fcf5a8c5-2a36-49aa-9c1b-2c2ea754bfe8', '858625cf-d381-4f7b-b68d-b5d28a3b43f1',
   'f247b0f6-fc46-4049-a267-3921e72039e0', '5edd3ea1-27ea-40e8-8978-06d8dbffd58e', 3, '学校作业', 2, 80, NULL, 30, date_trunc('week', current_date)::date - 3, '17:00'),
  ('fcf5a8c5-2a36-49aa-9c1b-2c2ea754bfe8', '858625cf-d381-4f7b-b68d-b5d28a3b43f1',
   'f247b0f6-fc46-4049-a267-3921e72039e0', '5edd3ea1-27ea-40e8-8978-06d8dbffd58e', 1, '学校课堂', 2, 78, NULL, 35, date_trunc('week', current_date)::date - 1, '15:00');

-- ---- Language & Literature（3条）----
INSERT INTO learning_sessions
  (student_id, course_id, chapter_id, unit_id, category, form, eval_type, score, self_rating, duration_minutes, session_date, start_time)
VALUES
  ('fcf5a8c5-2a36-49aa-9c1b-2c2ea754bfe8', 'abac9184-5cff-4b54-ac13-5d00edf4ca77',
   'f9ae6c99-de01-43b7-b148-2383475512c6', 'c3fef55f-7480-4121-976d-212c3fb5a6cc', 3, '学校作业', 2, 82, NULL, 25, date_trunc('week', current_date)::date - 6, '18:00'),
  ('fcf5a8c5-2a36-49aa-9c1b-2c2ea754bfe8', 'abac9184-5cff-4b54-ac13-5d00edf4ca77',
   'f9ae6c99-de01-43b7-b148-2383475512c6', '51edf640-9d8e-49b4-9dd6-2d6a78403df9', 2, '自主复习', 1, NULL, 40, 30, date_trunc('week', current_date)::date - 4, '16:00'),
  ('fcf5a8c5-2a36-49aa-9c1b-2c2ea754bfe8', 'abac9184-5cff-4b54-ac13-5d00edf4ca77',
   'f9ae6c99-de01-43b7-b148-2383475512c6', '51edf640-9d8e-49b4-9dd6-2d6a78403df9', 1, '学校课堂', 2, 84, NULL, 35, date_trunc('week', current_date)::date - 2, '15:00');

-- ================================================================
-- 第 4 周（本周，周一至今）
-- ================================================================

-- ---- IB AA HL 数学（1条）----
INSERT INTO learning_sessions
  (student_id, course_id, chapter_id, unit_id, category, form, eval_type, score, self_rating, duration_minutes, session_date, start_time)
VALUES
  ('fcf5a8c5-2a36-49aa-9c1b-2c2ea754bfe8', '7fc83e4c-ad97-488e-8f1d-541ab6cac513', NULL, NULL, 1, '学校课堂', 2, 60, NULL, 25, date_trunc('week', current_date)::date, '21:00');

-- ---- Physics（2条）----
INSERT INTO learning_sessions
  (student_id, course_id, chapter_id, unit_id, category, form, eval_type, score, self_rating, duration_minutes, session_date, start_time)
VALUES
  ('fcf5a8c5-2a36-49aa-9c1b-2c2ea754bfe8', '32634a55-afe7-4522-b529-f077b7f5f733',
   'd68fe1a7-e633-437c-b49f-92a3e5381c09', 'aaaa5a60-8993-41e7-8b5f-c64463bd6620', 1, '学校课堂', 2, 75, NULL, 35, date_trunc('week', current_date)::date, '18:00'),
  ('fcf5a8c5-2a36-49aa-9c1b-2c2ea754bfe8', '32634a55-afe7-4522-b529-f077b7f5f733',
   'd68fe1a7-e633-437c-b49f-92a3e5381c09', 'aaaa5a60-8993-41e7-8b5f-c64463bd6620', 2, '自主复习', 1, NULL, 60, 30, date_trunc('week', current_date)::date + 1, '19:00');

-- ---- English（2条）----
INSERT INTO learning_sessions
  (student_id, course_id, chapter_id, unit_id, category, form, eval_type, score, self_rating, duration_minutes, session_date, start_time)
VALUES
  ('fcf5a8c5-2a36-49aa-9c1b-2c2ea754bfe8', '858625cf-d381-4f7b-b68d-b5d28a3b43f1',
   '875f6c39-d7e6-4d48-a968-0c0a2dcdcf1d', '701e599f-4d7f-47b6-8491-633e91e42c42', 3, '学校作业', 2, 79, NULL, 30, date_trunc('week', current_date)::date, '17:00'),
  ('fcf5a8c5-2a36-49aa-9c1b-2c2ea754bfe8', '858625cf-d381-4f7b-b68d-b5d28a3b43f1',
   '875f6c39-d7e6-4d48-a968-0c0a2dcdcf1d', '9167903c-1fb6-4edd-a3dc-d55874fdaec0', 1, '学校课堂', 2, 77, NULL, 35, date_trunc('week', current_date)::date + 1, '15:00');

-- ---- Language & Literature（1条）----
INSERT INTO learning_sessions
  (student_id, course_id, chapter_id, unit_id, category, form, eval_type, score, self_rating, duration_minutes, session_date, start_time)
VALUES
  ('fcf5a8c5-2a36-49aa-9c1b-2c2ea754bfe8', 'abac9184-5cff-4b54-ac13-5d00edf4ca77',
   'f9ae6c99-de01-43b7-b148-2383475512c6', 'c3fef55f-7480-4121-976d-212c3fb5a6cc', 3, '学校作业', 2, 83, NULL, 25, date_trunc('week', current_date)::date + 1, '18:00');

-- ========== 3. 连接导师（如果未连接）==========
INSERT INTO teacher_student_connections (teacher_id, student_id, status, created_at)
SELECT p.id, 'fcf5a8c5-2a36-49aa-9c1b-2c2ea754bfe8', 1, now()
FROM profiles p
WHERE p.role = 2
ORDER BY p.created_at
LIMIT 1
ON CONFLICT (teacher_id, student_id) DO UPDATE SET status = 1, updated_at = now();

-- ========== 4. 验证统计 ==========
SELECT
  c.name AS course,
  count(*) AS sessions,
  round(avg(ls.score)) AS avg_score,
  round(avg(ls.duration_minutes)) AS avg_mins,
  count(*) FILTER (WHERE ls.chapter_id IS NULL) AS null_chapter,
  count(*) FILTER (WHERE ls.form LIKE '自主%') AS self_study_count
FROM learning_sessions ls
JOIN courses c ON c.id = ls.course_id
WHERE ls.student_id = 'fcf5a8c5-2a36-49aa-9c1b-2c2ea754bfe8'
GROUP BY c.name
ORDER BY c.name;
