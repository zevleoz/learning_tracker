-- ================================================================
-- 为 jeff@example.com 插入代表性假数据
-- ================================================================

-- 1. 获取 jeff 的用户 ID
DO $$
DECLARE
    jeff_id UUID;
    math_course_id UUID;
    english_course_id UUID;
    physics_course_id UUID;
    chemistry_course_id UUID;
    history_course_id UUID;
    today DATE := CURRENT_DATE;
BEGIN
    -- 获取 jeff 的用户 ID
    SELECT id INTO jeff_id FROM public.profiles WHERE email = 'jeff@example.com';
    
    IF jeff_id IS NULL THEN
        RAISE NOTICE 'jeff@example.com 不存在，跳过插入';
        RETURN;
    END IF;

    RAISE NOTICE 'Found jeff ID: %', jeff_id;

    -- 2. 创建或获取课程（5个科目）
    -- 数学
    SELECT id INTO math_course_id FROM public.courses WHERE subject = '数学' LIMIT 1;
    IF math_course_id IS NULL THEN
        INSERT INTO public.courses (name, subject, source) 
        VALUES ('高中数学', '数学', 1) 
        RETURNING id INTO math_course_id;
        RAISE NOTICE 'Created math course: %', math_course_id;
    END IF;

    -- 英语
    SELECT id INTO english_course_id FROM public.courses WHERE subject = '英语' LIMIT 1;
    IF english_course_id IS NULL THEN
        INSERT INTO public.courses (name, subject, source) 
        VALUES ('高中英语', '英语', 1) 
        RETURNING id INTO english_course_id;
        RAISE NOTICE 'Created english course: %', english_course_id;
    END IF;

    -- 物理
    SELECT id INTO physics_course_id FROM public.courses WHERE subject = '物理' LIMIT 1;
    IF physics_course_id IS NULL THEN
        INSERT INTO public.courses (name, subject, source) 
        VALUES ('高中物理', '物理', 1) 
        RETURNING id INTO physics_course_id;
        RAISE NOTICE 'Created physics course: %', physics_course_id;
    END IF;

    -- 化学
    SELECT id INTO chemistry_course_id FROM public.courses WHERE subject = '化学' LIMIT 1;
    IF chemistry_course_id IS NULL THEN
        INSERT INTO public.courses (name, subject, source) 
        VALUES ('高中化学', '化学', 1) 
        RETURNING id INTO chemistry_course_id;
        RAISE NOTICE 'Created chemistry course: %', chemistry_course_id;
    END IF;

    -- 历史
    SELECT id INTO history_course_id FROM public.courses WHERE subject = '历史' LIMIT 1;
    IF history_course_id IS NULL THEN
        INSERT INTO public.courses (name, subject, source) 
        VALUES ('高中历史', '历史', 1) 
        RETURNING id INTO history_course_id;
        RAISE NOTICE 'Created history course: %', history_course_id;
    END IF;

    -- 3. 删除 jeff 现有的学习记录（避免重复）
    DELETE FROM public.learning_sessions WHERE student_id = jeff_id;
    RAISE NOTICE 'Deleted existing sessions for jeff';

    -- 4. 插入30天的学习记录
    -- 数学：基础好，分数高，学习时间稳定
    -- 英语：中等，分数波动，有提升趋势
    -- 物理：较弱，分数偏低，需要更多练习
    -- 化学：中等偏上，分数稳定
    -- 历史：较强，分数高，复习时间多

    -- 第1-7天：初始状态
    INSERT INTO public.learning_sessions (student_id, course_id, category, form, eval_type, score, duration_minutes, session_date) VALUES
    -- 数学
    (jeff_id, math_course_id, 1, '自主学习', 2, 85, 45, today - INTERVAL '30 days'),
    (jeff_id, math_course_id, 2, '自主复习', 1, NULL, 30, today - INTERVAL '29 days'),
    (jeff_id, math_course_id, 3, '自主练习', 2, 88, 40, today - INTERVAL '28 days'),
    (jeff_id, math_course_id, 1, '自主学习', 2, 86, 50, today - INTERVAL '25 days'),
    (jeff_id, math_course_id, 3, '校外线上', 2, 90, 60, today - INTERVAL '23 days'),
    (jeff_id, math_course_id, 2, '自主复习', 1, NULL, 25, today - INTERVAL '21 days'),
    -- 英语
    (jeff_id, english_course_id, 1, '自主学习', 2, 72, 35, today - INTERVAL '30 days'),
    (jeff_id, english_course_id, 3, '自主练习', 2, 70, 30, today - INTERVAL '28 days'),
    (jeff_id, english_course_id, 1, '校外线下', 2, 75, 60, today - INTERVAL '26 days'),
    (jeff_id, english_course_id, 2, '自主复习', 1, NULL, 20, today - INTERVAL '24 days'),
    (jeff_id, english_course_id, 3, '自主练习', 2, 73, 35, today - INTERVAL '22 days'),
    -- 物理
    (jeff_id, physics_course_id, 1, '自主学习', 2, 62, 40, today - INTERVAL '29 days'),
    (jeff_id, physics_course_id, 3, '自主练习', 2, 58, 35, today - INTERVAL '27 days'),
    (jeff_id, physics_course_id, 1, '校外线上', 2, 65, 60, today - INTERVAL '25 days'),
    (jeff_id, physics_course_id, 2, '自主复习', 1, NULL, 25, today - INTERVAL '23 days'),
    (jeff_id, physics_course_id, 3, '自主练习', 2, 60, 40, today - INTERVAL '20 days'),
    -- 化学
    (jeff_id, chemistry_course_id, 1, '自主学习', 2, 78, 35, today - INTERVAL '30 days'),
    (jeff_id, chemistry_course_id, 2, '自主复习', 1, NULL, 25, today - INTERVAL '28 days'),
    (jeff_id, chemistry_course_id, 3, '自主练习', 2, 80, 30, today - INTERVAL '26 days'),
    (jeff_id, chemistry_course_id, 1, '自主学习', 2, 79, 40, today - INTERVAL '24 days'),
    (jeff_id, chemistry_course_id, 3, '校外线上', 2, 82, 50, today - INTERVAL '22 days'),
    -- 历史
    (jeff_id, history_course_id, 1, '自主学习', 2, 88, 30, today - INTERVAL '29 days'),
    (jeff_id, history_course_id, 2, '自主复习', 1, NULL, 35, today - INTERVAL '27 days'),
    (jeff_id, history_course_id, 3, '自主练习', 2, 90, 25, today - INTERVAL '25 days'),
    (jeff_id, history_course_id, 2, '自主复习', 1, NULL, 30, today - INTERVAL '23 days'),
    (jeff_id, history_course_id, 1, '自主学习', 2, 87, 35, today - INTERVAL '21 days');

    -- 第8-14天：中期，有进步
    INSERT INTO public.learning_sessions (student_id, course_id, category, form, eval_type, score, duration_minutes, session_date) VALUES
    -- 数学
    (jeff_id, math_course_id, 1, '自主学习', 2, 87, 45, today - INTERVAL '20 days'),
    (jeff_id, math_course_id, 3, '自主练习', 2, 91, 45, today - INTERVAL '18 days'),
    (jeff_id, math_course_id, 2, '自主复习', 1, NULL, 30, today - INTERVAL '16 days'),
    (jeff_id, math_course_id, 1, '校外线上', 2, 89, 60, today - INTERVAL '14 days'),
    -- 英语
    (jeff_id, english_course_id, 1, '自主学习', 2, 76, 40, today - INTERVAL '19 days'),
    (jeff_id, english_course_id, 3, '自主练习', 2, 75, 35, today - INTERVAL '17 days'),
    (jeff_id, english_course_id, 1, '校外线下', 2, 78, 60, today - INTERVAL '15 days'),
    (jeff_id, english_course_id, 2, '自主复习', 1, NULL, 25, today - INTERVAL '13 days'),
    -- 物理
    (jeff_id, physics_course_id, 1, '自主学习', 2, 64, 45, today - INTERVAL '20 days'),
    (jeff_id, physics_course_id, 3, '自主练习', 2, 62, 40, today - INTERVAL '18 days'),
    (jeff_id, physics_course_id, 1, '校外线上', 2, 68, 60, today - INTERVAL '16 days'),
    (jeff_id, physics_course_id, 3, '自主练习', 2, 65, 45, today - INTERVAL '14 days'),
    -- 化学
    (jeff_id, chemistry_course_id, 1, '自主学习', 2, 80, 35, today - INTERVAL '19 days'),
    (jeff_id, chemistry_course_id, 2, '自主复习', 1, NULL, 30, today - INTERVAL '17 days'),
    (jeff_id, chemistry_course_id, 3, '自主练习', 2, 83, 35, today - INTERVAL '15 days'),
    -- 历史
    (jeff_id, history_course_id, 1, '自主学习', 2, 89, 30, today - INTERVAL '20 days'),
    (jeff_id, history_course_id, 2, '自主复习', 1, NULL, 40, today - INTERVAL '18 days'),
    (jeff_id, history_course_id, 3, '自主练习', 2, 92, 30, today - INTERVAL '16 days');

    -- 第15-21天：进步明显
    INSERT INTO public.learning_sessions (student_id, course_id, category, form, eval_type, score, duration_minutes, session_date) VALUES
    -- 数学
    (jeff_id, math_course_id, 1, '自主学习', 2, 88, 50, today - INTERVAL '13 days'),
    (jeff_id, math_course_id, 3, '自主练习', 2, 93, 50, today - INTERVAL '11 days'),
    (jeff_id, math_course_id, 2, '自主复习', 1, NULL, 35, today - INTERVAL '9 days'),
    (jeff_id, math_course_id, 1, '校外线上', 2, 91, 60, today - INTERVAL '7 days'),
    -- 英语
    (jeff_id, english_course_id, 1, '自主学习', 2, 79, 45, today - INTERVAL '12 days'),
    (jeff_id, english_course_id, 3, '自主练习', 2, 78, 40, today - INTERVAL '10 days'),
    (jeff_id, english_course_id, 1, '校外线下', 2, 81, 60, today - INTERVAL '8 days'),
    (jeff_id, english_course_id, 2, '自主复习', 1, NULL, 30, today - INTERVAL '6 days'),
    -- 物理
    (jeff_id, physics_course_id, 1, '自主学习', 2, 67, 50, today - INTERVAL '13 days'),
    (jeff_id, physics_course_id, 3, '自主练习', 2, 68, 45, today - INTERVAL '11 days'),
    (jeff_id, physics_course_id, 1, '校外线上', 2, 72, 60, today - INTERVAL '9 days'),
    (jeff_id, physics_course_id, 3, '自主练习', 2, 70, 50, today - INTERVAL '7 days'),
    -- 化学
    (jeff_id, chemistry_course_id, 1, '自主学习', 2, 82, 40, today - INTERVAL '12 days'),
    (jeff_id, chemistry_course_id, 2, '自主复习', 1, NULL, 35, today - INTERVAL '10 days'),
    (jeff_id, chemistry_course_id, 3, '自主练习', 2, 85, 40, today - INTERVAL '8 days'),
    -- 历史
    (jeff_id, history_course_id, 1, '自主学习', 2, 90, 35, today - INTERVAL '13 days'),
    (jeff_id, history_course_id, 2, '自主复习', 1, NULL, 45, today - INTERVAL '11 days'),
    (jeff_id, history_course_id, 3, '自主练习', 2, 93, 35, today - INTERVAL '9 days');

    -- 第22-30天：近期，继续进步
    INSERT INTO public.learning_sessions (student_id, course_id, category, form, eval_type, score, duration_minutes, session_date) VALUES
    -- 数学
    (jeff_id, math_course_id, 1, '自主学习', 2, 90, 50, today - INTERVAL '6 days'),
    (jeff_id, math_course_id, 3, '自主练习', 2, 94, 55, today - INTERVAL '4 days'),
    (jeff_id, math_course_id, 2, '自主复习', 1, NULL, 40, today - INTERVAL '2 days'),
    (jeff_id, math_course_id, 3, '校外线上', 2, 95, 60, today - INTERVAL '1 day'),
    -- 英语
    (jeff_id, english_course_id, 1, '自主学习', 2, 82, 50, today - INTERVAL '5 days'),
    (jeff_id, english_course_id, 3, '自主练习', 2, 80, 45, today - INTERVAL '3 days'),
    (jeff_id, english_course_id, 1, '校外线下', 2, 84, 60, today - INTERVAL '1 day'),
    -- 物理
    (jeff_id, physics_course_id, 1, '自主学习', 2, 71, 55, today - INTERVAL '6 days'),
    (jeff_id, physics_course_id, 3, '自主练习', 2, 73, 50, today - INTERVAL '4 days'),
    (jeff_id, physics_course_id, 1, '校外线上', 2, 76, 60, today - INTERVAL '2 days'),
    (jeff_id, physics_course_id, 3, '自主练习', 2, 74, 55, today),
    -- 化学
    (jeff_id, chemistry_course_id, 1, '自主学习', 2, 84, 45, today - INTERVAL '5 days'),
    (jeff_id, chemistry_course_id, 2, '自主复习', 1, NULL, 40, today - INTERVAL '3 days'),
    (jeff_id, chemistry_course_id, 3, '自主练习', 2, 87, 45, today),
    -- 历史
    (jeff_id, history_course_id, 1, '自主学习', 2, 91, 40, today - INTERVAL '6 days'),
    (jeff_id, history_course_id, 2, '自主复习', 1, NULL, 50, today - INTERVAL '4 days'),
    (jeff_id, history_course_id, 3, '自主练习', 2, 94, 40, today - INTERVAL '2 days');

    RAISE NOTICE 'Successfully inserted fake data for jeff@example.com';

END $$;

SELECT '假数据插入完成' as result;