-- ================================================================
-- Week Review Dashboard 测试数据
-- 为学生 Jeff 生成本周（Mon-Sun）的学习记录
-- 设计覆盖所有 7 个维度 + 触发诊断规则
-- ================================================================

DO $$
DECLARE
  jeff_id uuid;
  math_id uuid;
  physics_id uuid;
  english_id uuid;
  chemistry_id uuid;
  history_id uuid;
  monday date;
  session_count int;
BEGIN
  -- 查找 Jeff
  SELECT id INTO jeff_id
  FROM profiles
  WHERE full_name ILIKE '%jeff%'
  LIMIT 1;

  IF jeff_id IS NULL THEN
    RAISE NOTICE 'ERROR: No student named Jeff found';
    RETURN;
  END IF;

  RAISE NOTICE 'Jeff ID: %', jeff_id;

  -- 清理旧数据
  DELETE FROM learning_sessions WHERE student_id = jeff_id;
  RAISE NOTICE 'Old sessions deleted';

  -- 获取或创建课程（先查后插，避免 ON CONFLICT 报错）
  SELECT id INTO math_id FROM courses WHERE name = '数学' LIMIT 1;
  IF math_id IS NULL THEN
    INSERT INTO courses (name, subject, source, is_shared) VALUES ('数学', '数学', 1, false) RETURNING id INTO math_id;
  END IF;

  SELECT id INTO physics_id FROM courses WHERE name = '物理' LIMIT 1;
  IF physics_id IS NULL THEN
    INSERT INTO courses (name, subject, source, is_shared) VALUES ('物理', '物理', 1, false) RETURNING id INTO physics_id;
  END IF;

  SELECT id INTO english_id FROM courses WHERE name = '英语' LIMIT 1;
  IF english_id IS NULL THEN
    INSERT INTO courses (name, subject, source, is_shared) VALUES ('英语', '英语', 1, false) RETURNING id INTO english_id;
  END IF;

  SELECT id INTO chemistry_id FROM courses WHERE name = '化学' LIMIT 1;
  IF chemistry_id IS NULL THEN
    INSERT INTO courses (name, subject, source, is_shared) VALUES ('化学', '化学', 1, false) RETURNING id INTO chemistry_id;
  END IF;

  SELECT id INTO history_id FROM courses WHERE name = '历史' LIMIT 1;
  IF history_id IS NULL THEN
    INSERT INTO courses (name, subject, source, is_shared) VALUES ('历史', '历史', 1, false) RETURNING id INTO history_id;
  END IF;

  RAISE NOTICE 'Courses: 数学=%, 物理=%, 英语=%, 化学=%, 历史=%', math_id, physics_id, english_id, chemistry_id, history_id;

  -- 本周周一
  SELECT date_trunc('week', current_date)::date INTO monday;
  RAISE NOTICE 'Monday: %', monday;

  -- MONDAY (day 0)
  INSERT INTO learning_sessions (student_id, course_id, category, form, eval_type, score, duration_minutes, session_date, self_rating)
  VALUES
    (jeff_id, math_id, 1, '自主学习', 2, 88, 45, monday + 0, NULL),
    (jeff_id, math_id, 3, '自主练习', 2, 90, 45, monday + 0, NULL),
    (jeff_id, physics_id, 1, '校外线上', 2, 65, 40, monday + 0, NULL),
    (jeff_id, english_id, 1, '自主预习', 2, 82, 30, monday + 0, NULL);

  -- TUESDAY (day 1)
  INSERT INTO learning_sessions (student_id, course_id, category, form, eval_type, score, duration_minutes, session_date, self_rating)
  VALUES
    (jeff_id, math_id, 3, '自主练习', 2, 92, 60, monday + 1, NULL),
    (jeff_id, math_id, 2, '自主复习', 1, NULL, 30, monday + 1, 60),
    (jeff_id, math_id, 1, '自主学习', 2, 85, 30, monday + 1, NULL),
    (jeff_id, physics_id, 3, '自主练习', 2, 62, 35, monday + 1, NULL),
    (jeff_id, chemistry_id, 1, '校外线下', 2, 80, 40, monday + 1, NULL),
    (jeff_id, english_id, 3, '自主练习', 2, 78, 35, monday + 1, NULL);

  -- THURSDAY (day 3)
  INSERT INTO learning_sessions (student_id, course_id, category, form, eval_type, score, duration_minutes, session_date, self_rating)
  VALUES
    (jeff_id, math_id, 1, '自主学习', 2, 86, 40, monday + 3, NULL),
    (jeff_id, math_id, 3, '校外线上', 2, 89, 35, monday + 3, NULL),
    (jeff_id, physics_id, 3, '自主练习', 2, 68, 50, monday + 3, NULL),
    (jeff_id, english_id, 1, '自主预习', 2, 84, 45, monday + 3, NULL),
    (jeff_id, history_id, 1, '学校课堂', 2, 88, 40, monday + 3, NULL);

  -- FRIDAY (day 4)
  INSERT INTO learning_sessions (student_id, course_id, category, form, eval_type, score, duration_minutes, session_date, self_rating)
  VALUES
    (jeff_id, math_id, 3, '自主练习', 2, 91, 50, monday + 4, NULL),
    (jeff_id, math_id, 2, '自主复习', 1, NULL, 30, monday + 4, 80),
    (jeff_id, math_id, 1, '自主学习', 2, 87, 20, monday + 4, NULL),
    (jeff_id, chemistry_id, 3, '自主练习', 2, 83, 40, monday + 4, NULL),
    (jeff_id, chemistry_id, 1, '自主学习', 2, 81, 15, monday + 4, NULL),
    (jeff_id, english_id, 2, '自主复习', 1, NULL, 30, monday + 4, 60);

  -- SATURDAY (day 5)
  INSERT INTO learning_sessions (student_id, course_id, category, form, eval_type, score, duration_minutes, session_date, self_rating)
  VALUES
    (jeff_id, math_id, 1, '自主学习', 2, 93, 60, monday + 5, NULL),
    (jeff_id, math_id, 3, '自主练习', 2, 95, 60, monday + 5, NULL),
    (jeff_id, math_id, 2, '自主复习', 1, NULL, 30, monday + 5, 80),
    (jeff_id, physics_id, 3, '自主练习', 2, 66, 45, monday + 5, NULL),
    (jeff_id, history_id, 3, '学校作业', 2, 90, 30, monday + 5, NULL),
    (jeff_id, history_id, 1, '自主学习', 2, 92, 30, monday + 5, NULL),
    (jeff_id, english_id, 3, '自主练习', 2, 86, 40, monday + 5, NULL);

  GET DIAGNOSTICS session_count = ROW_COUNT;

  RAISE NOTICE 'Test data inserted successfully!';
  RAISE NOTICE 'Total rows inserted: %', session_count;

  SELECT count(*) INTO session_count
  FROM learning_sessions
  WHERE student_id = jeff_id
  AND session_date >= monday
  AND session_date <= monday + 6;

  RAISE NOTICE 'Jeff sessions this week: %', session_count;
END $$;
