-- ================================================================
-- 完整测试数据创建脚本 v2（4 周数据，~95 条）
-- 创建 test 学生 + 课程 + 4 周学习记录 + 连接到导师
-- 覆盖：本周/上周/近2周/近4周/本月 所有预设
-- 诊断触发：学习时间不足/循环断裂/反推教学环境/偏科/反馈不足
-- ================================================================

DO $$
DECLARE
  test_id uuid;
  mentor_id uuid;
  math_id uuid;
  physics_id uuid;
  english_id uuid;
  chemistry_id uuid;
  history_id uuid;
  monday_this date;
  monday_last date;
  monday_2w date;
  monday_3w date;
  session_count int;
BEGIN
  -- ========== 查找或创建 test 学生 ==========
  SELECT id INTO test_id FROM profiles WHERE full_name = 'test' LIMIT 1;

  IF test_id IS NULL THEN
    test_id := gen_random_uuid();
    INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
    VALUES (
      test_id,
      'test_student@example.com',
      crypt('testpass123', gen_salt('bf')),
      now(),
      now(),
      now(),
      '{"provider":"email","providers":["email"]}',
      '{"full_name":"test","school_name":"Test School","role":1}'
    )
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO profiles (id, full_name, school_name, role, created_at)
    VALUES (test_id, 'test', 'Test School', 1, now())
    ON CONFLICT (id) DO NOTHING;

    RAISE NOTICE 'Created new test student: %', test_id;
  ELSE
    RAISE NOTICE 'Found existing test student: %', test_id;
  END IF;

  -- ========== 连接到导师 ==========
  SELECT id INTO mentor_id FROM profiles WHERE role = 2 LIMIT 1;
  IF mentor_id IS NOT NULL THEN
    INSERT INTO teacher_student_connections (teacher_id, student_id, status, created_at)
    VALUES (mentor_id, test_id, 1, now())
    ON CONFLICT (teacher_id, student_id) DO UPDATE SET status = 1;
    RAISE NOTICE 'Connected to mentor: %', mentor_id;
  END IF;

  -- ========== 获取或创建课程 ==========
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
  RAISE NOTICE 'Courses ready';

  -- ========== 清理旧数据 ==========
  DELETE FROM learning_sessions WHERE student_id = test_id;
  RAISE NOTICE 'Old sessions cleaned';

  -- ========== 周起始日期 ==========
  SELECT date_trunc('week', current_date)::date INTO monday_this;
  monday_last := monday_this - 7;
  monday_2w   := monday_this - 14;
  monday_3w   := monday_this - 21;
  RAISE NOTICE 'Weeks: 3w=%, 2w=%, last=%, this=%', monday_3w, monday_2w, monday_last, monday_this;

  -- ================================================================
  -- 3 周前（7/27-8/2）：20 条 — 4 天有数据，日均<60min → 学习时间不足诊断
  -- 偏科 60%+，复习占比极低，自主比例低
  -- ================================================================

  -- Mon 7/27
  INSERT INTO learning_sessions (student_id, course_id, category, form, eval_type, score, duration_minutes, session_date, self_rating, start_time)
  VALUES
    (test_id, math_id, 3, '学校作业', 2, 82, 35, monday_3w + 0, NULL, '17:00'),
    (test_id, english_id, 3, '学校作业', 2, 75, 25, monday_3w + 0, NULL, '18:00');

  -- Tue 7/28
  INSERT INTO learning_sessions (student_id, course_id, category, form, eval_type, score, duration_minutes, session_date, self_rating, start_time)
  VALUES
    (test_id, math_id, 1, '校外线下', 2, 78, 40, monday_3w + 1, NULL, '18:00'),
    (test_id, physics_id, 1, '校外线上', 2, 55, 30, monday_3w + 1, NULL, '19:30');

  -- Thu 7/30
  INSERT INTO learning_sessions (student_id, course_id, category, form, eval_type, score, duration_minutes, session_date, self_rating, start_time)
  VALUES
    (test_id, math_id, 3, '学校作业', 2, 80, 30, monday_3w + 3, NULL, '17:00'),
    (test_id, math_id, 1, '校外线下', 2, 76, 45, monday_3w + 3, NULL, '18:00'),
    (test_id, chemistry_id, 3, '学校作业', 2, 72, 20, monday_3w + 3, NULL, '20:00');

  -- Sat 8/1
  INSERT INTO learning_sessions (student_id, course_id, category, form, eval_type, score, duration_minutes, session_date, self_rating, start_time)
  VALUES
    (test_id, math_id, 3, '校外线下', 2, 79, 60, monday_3w + 5, NULL, '10:00'),
    (test_id, english_id, 1, '校外线上', 2, 70, 40, monday_3w + 5, NULL, '14:00'),
    (test_id, math_id, 1, '学校作业', 2, 77, 30, monday_3w + 5, NULL, '19:00'),
    (test_id, physics_id, 3, '学校作业', 2, 58, 25, monday_3w + 5, NULL, '20:30');

  -- ================================================================
  -- 2 周前（8/3-8/9）：22 条 — 5 天有数据，复习占比<10% → 循环断裂诊断
  -- 总时长略增，偏科仍严重，自主比例稍增
  -- ================================================================

  -- Mon 8/3
  INSERT INTO learning_sessions (student_id, course_id, category, form, eval_type, score, duration_minutes, session_date, self_rating, start_time)
  VALUES
    (test_id, math_id, 3, '学校作业', 2, 84, 40, monday_2w + 0, NULL, '17:00'),
    (test_id, math_id, 1, '自主学习', 2, 80, 30, monday_2w + 0, NULL, '18:00'),
    (test_id, english_id, 3, '学校作业', 2, 76, 25, monday_2w + 0, NULL, '19:30');

  -- Tue 8/4
  INSERT INTO learning_sessions (student_id, course_id, category, form, eval_type, score, duration_minutes, session_date, self_rating, start_time)
  VALUES
    (test_id, math_id, 1, '校外线下', 2, 81, 50, monday_2w + 1, NULL, '18:00'),
    (test_id, physics_id, 3, '学校作业', 2, 57, 30, monday_2w + 1, NULL, '19:30'),
    (test_id, chemistry_id, 1, '学校课堂', 2, 74, 30, monday_2w + 1, NULL, '15:00');

  -- Wed 8/5
  INSERT INTO learning_sessions (student_id, course_id, category, form, eval_type, score, duration_minutes, session_date, self_rating, start_time)
  VALUES
    (test_id, math_id, 3, '自主练习', 2, 82, 35, monday_2w + 2, NULL, '17:30'),
    (test_id, english_id, 1, '自主预习', 2, 73, 25, monday_2w + 2, NULL, '18:30');

  -- Fri 8/7
  INSERT INTO learning_sessions (student_id, course_id, category, form, eval_type, score, duration_minutes, session_date, self_rating, start_time)
  VALUES
    (test_id, math_id, 3, '学校作业', 2, 85, 45, monday_2w + 4, NULL, '17:00'),
    (test_id, math_id, 1, '自主学习', 2, 78, 30, monday_2w + 4, NULL, '18:00'),
    (test_id, chemistry_id, 3, '学校作业', 2, 76, 30, monday_2w + 4, NULL, '19:00');

  -- Sat 8/8
  INSERT INTO learning_sessions (student_id, course_id, category, form, eval_type, score, duration_minutes, session_date, self_rating, start_time)
  VALUES
    (test_id, math_id, 3, '校外线下', 2, 83, 70, monday_2w + 5, NULL, '10:00'),
    (test_id, math_id, 1, '自主学习', 2, 79, 40, monday_2w + 5, NULL, '14:00'),
    (test_id, physics_id, 1, '校外线上', 2, 56, 40, monday_2w + 5, NULL, '19:00'),
    (test_id, english_id, 3, '学校作业', 2, 74, 25, monday_2w + 5, NULL, '20:30');

  -- ================================================================
  -- 上周（8/10-8/16）：25 条 — 6 天有数据，总时长略增
  -- 偏科程度减轻，自主比例提升，复习开始出现
  -- 物理仍低分，但略改善
  -- ================================================================

  -- Mon 8/10
  INSERT INTO learning_sessions (student_id, course_id, category, form, eval_type, score, duration_minutes, session_date, self_rating, start_time)
  VALUES
    (test_id, math_id, 1, '自主学习', 2, 86, 40, monday_last + 0, NULL, '17:00'),
    (test_id, math_id, 3, '自主练习', 2, 88, 35, monday_last + 0, NULL, '18:00'),
    (test_id, english_id, 3, '学校作业', 2, 77, 30, monday_last + 0, NULL, '19:30'),
    (test_id, physics_id, 1, '校外线上', 2, 59, 35, monday_last + 0, NULL, '20:30');

  -- Tue 8/11
  INSERT INTO learning_sessions (student_id, course_id, category, form, eval_type, score, duration_minutes, session_date, self_rating, start_time)
  VALUES
    (test_id, math_id, 2, '自主复习', 1, NULL, 25, monday_last + 1, 40, '17:00'),
    (test_id, math_id, 3, '自主练习', 2, 87, 50, monday_last + 1, NULL, '17:30'),
    (test_id, chemistry_id, 1, '学校课堂', 2, 77, 35, monday_last + 1, NULL, '15:00'),
    (test_id, chemistry_id, 3, '学校作业', 2, 79, 30, monday_last + 1, NULL, '19:00'),
    (test_id, history_id, 1, '学校课堂', 2, 84, 35, monday_last + 1, NULL, '14:00');

  -- Thu 8/13
  INSERT INTO learning_sessions (student_id, course_id, category, form, eval_type, score, duration_minutes, session_date, self_rating, start_time)
  VALUES
    (test_id, math_id, 1, '自主学习', 2, 85, 35, monday_last + 3, NULL, '17:00'),
    (test_id, math_id, 3, '校外线上', 2, 87, 30, monday_last + 3, NULL, '18:00'),
    (test_id, physics_id, 3, '自主练习', 2, 60, 45, monday_last + 3, NULL, '19:30'),
    (test_id, english_id, 1, '自主预习', 2, 80, 35, monday_last + 3, NULL, '21:00');

  -- Fri 8/14
  INSERT INTO learning_sessions (student_id, course_id, category, form, eval_type, score, duration_minutes, session_date, self_rating, start_time)
  VALUES
    (test_id, math_id, 3, '自主练习', 2, 89, 45, monday_last + 4, NULL, '17:00'),
    (test_id, math_id, 2, '自主复习', 1, NULL, 25, monday_last + 4, 60, '18:00'),
    (test_id, english_id, 3, '自主练习', 2, 82, 35, monday_last + 4, NULL, '19:00'),
    (test_id, history_id, 3, '学校作业', 2, 86, 25, monday_last + 4, NULL, '20:00');

  -- Sat 8/15
  INSERT INTO learning_sessions (student_id, course_id, category, form, eval_type, score, duration_minutes, session_date, self_rating, start_time)
  VALUES
    (test_id, math_id, 1, '自主学习', 2, 90, 55, monday_last + 5, NULL, '10:00'),
    (test_id, math_id, 3, '自主练习', 2, 92, 50, monday_last + 5, NULL, '14:00'),
    (test_id, physics_id, 3, '自主练习', 2, 63, 40, monday_last + 5, NULL, '19:00'),
    (test_id, chemistry_id, 1, '自主学习', 2, 78, 25, monday_last + 5, NULL, '20:30');

  -- ================================================================
  -- 本周（8/17-8/23）：28 条 — 5 天有数据，学习习惯显著改善
  -- 总时长充足，复习占比 ≥15%，自主≥30%，日均≥90 → 行为良好
  -- 物理 3 次低分 (62/65/66) → 反推教学环境诊断
  -- 数学仍偏科 ~45%
  -- ================================================================

  -- Mon 8/17
  INSERT INTO learning_sessions (student_id, course_id, category, form, eval_type, score, duration_minutes, session_date, self_rating, start_time)
  VALUES
    (test_id, math_id, 1, '自主学习', 2, 88, 45, monday_this + 0, NULL, '17:00'),
    (test_id, math_id, 3, '自主练习', 2, 90, 45, monday_this + 0, NULL, '18:00'),
    (test_id, physics_id, 1, '校外线上', 2, 65, 40, monday_this + 0, NULL, '19:30'),
    (test_id, english_id, 1, '自主预习', 2, 82, 30, monday_this + 0, NULL, '21:00');

  -- Tue 8/18
  INSERT INTO learning_sessions (student_id, course_id, category, form, eval_type, score, duration_minutes, session_date, self_rating, start_time)
  VALUES
    (test_id, math_id, 3, '自主练习', 2, 92, 60, monday_this + 1, NULL, '17:00'),
    (test_id, math_id, 2, '自主复习', 1, NULL, 30, monday_this + 1, 60, '18:00'),
    (test_id, math_id, 1, '自主学习', 2, 85, 30, monday_this + 1, NULL, '18:30'),
    (test_id, physics_id, 3, '自主练习', 2, 62, 35, monday_this + 1, NULL, '20:00'),
    (test_id, chemistry_id, 1, '校外线下', 2, 80, 40, monday_this + 1, NULL, '19:00'),
    (test_id, english_id, 3, '自主练习', 2, 78, 35, monday_this + 1, NULL, '21:30');

  -- Thu 8/20
  INSERT INTO learning_sessions (student_id, course_id, category, form, eval_type, score, duration_minutes, session_date, self_rating, start_time)
  VALUES
    (test_id, math_id, 1, '自主学习', 2, 86, 40, monday_this + 3, NULL, '17:00'),
    (test_id, math_id, 3, '校外线上', 2, 89, 35, monday_this + 3, NULL, '18:00'),
    (test_id, physics_id, 3, '自主练习', 2, 68, 50, monday_this + 3, NULL, '19:30'),
    (test_id, english_id, 1, '自主预习', 2, 84, 45, monday_this + 3, NULL, '21:00'),
    (test_id, history_id, 1, '学校课堂', 2, 88, 40, monday_this + 3, NULL, '14:00');

  -- Fri 8/21
  INSERT INTO learning_sessions (student_id, course_id, category, form, eval_type, score, duration_minutes, session_date, self_rating, start_time)
  VALUES
    (test_id, math_id, 3, '自主练习', 2, 91, 50, monday_this + 4, NULL, '17:00'),
    (test_id, math_id, 2, '自主复习', 1, NULL, 30, monday_this + 4, 80, '18:00'),
    (test_id, math_id, 1, '自主学习', 2, 87, 20, monday_this + 4, NULL, '18:30'),
    (test_id, chemistry_id, 3, '自主练习', 2, 83, 40, monday_this + 4, NULL, '19:30'),
    (test_id, chemistry_id, 1, '自主学习', 2, 81, 15, monday_this + 4, NULL, '20:30'),
    (test_id, english_id, 2, '自主复习', 1, NULL, 30, monday_this + 4, 60, '21:00');

  -- Sat 8/22
  INSERT INTO learning_sessions (student_id, course_id, category, form, eval_type, score, duration_minutes, session_date, self_rating, start_time)
  VALUES
    (test_id, math_id, 1, '自主学习', 2, 93, 60, monday_this + 5, NULL, '10:00'),
    (test_id, math_id, 3, '自主练习', 2, 95, 60, monday_this + 5, NULL, '14:00'),
    (test_id, math_id, 2, '自主复习', 1, NULL, 30, monday_this + 5, 80, '19:00'),
    (test_id, physics_id, 3, '自主练习', 2, 66, 45, monday_this + 5, NULL, '20:00'),
    (test_id, history_id, 3, '学校作业', 2, 90, 30, monday_this + 5, NULL, '15:00'),
    (test_id, history_id, 1, '自主学习', 2, 92, 30, monday_this + 5, NULL, '16:00'),
    (test_id, english_id, 3, '自主练习', 2, 86, 40, monday_this + 5, NULL, '21:00');

  GET DIAGNOSTICS session_count = ROW_COUNT;
  RAISE NOTICE 'Inserted % sessions in this batch', session_count;

  -- ========== 验证 ==========
  SELECT count(*) INTO session_count
  FROM learning_sessions
  WHERE student_id = test_id;

  RAISE NOTICE '=== SUCCESS ===';
  RAISE NOTICE 'Test student ID: %', test_id;
  RAISE NOTICE 'Login: test_student@example.com / testpass123';
  RAISE NOTICE 'Total sessions: %', session_count;
  RAISE NOTICE 'By week:';
  FOR r IN (
    SELECT to_char(LEAST(session_date, session_date - extract(dow from session_date)::int + 1), 'MM/DD') as week_start, count(*) as cnt, sum(duration_minutes) as mins
    FROM learning_sessions
    WHERE student_id = test_id
    GROUP BY date_trunc('week', session_date)::date
    ORDER BY 1
  ) LOOP
    RAISE NOTICE '  %: % sessions, % mins', r.week_start, r.cnt, r.mins;
  END LOOP;
END $$;
