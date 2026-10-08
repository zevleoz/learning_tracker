-- ================================================================
-- schema.patch-growth.sql  —  为"成长可视化 / slow-hesitant 检测"加最小字段
-- 运行方式：Supabase Dashboard → SQL Editor → 粘贴 → 执行
-- 可重复执行（CREATE … IF NOT EXISTS / DO）
-- ================================================================

-- 1) 新增 mastery_level 枚举（"自我评估"的结构化版本）
DO $$ BEGIN
  CREATE TYPE public.mastery_level AS ENUM ('不熟', '还行', '掌握');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2) learning_sessions 加列
ALTER TABLE public.learning_sessions
  ADD COLUMN IF NOT EXISTS mastery_level public.mastery_level;

ALTER TABLE public.learning_sessions
  ADD COLUMN IF NOT EXISTS self_assessed_on timestamptz;

COMMENT ON COLUMN public.learning_sessions.mastery_level
  IS '学生本次学习结束后对该章节的自我评估；用于成长曲线 & hesitant 检测';

COMMENT ON COLUMN public.learning_sessions.feedback_score
  IS '客观分数（0-100 或 1-5 都可以，前端建议 0-100）；用于成长可视化 Y 轴';

-- 3) 为成长曲线 / slow 检测建立索引（都是复合查询常用路径）
CREATE INDEX IF NOT EXISTS ls_student_subject_chapter_date_idx
  ON public.learning_sessions (student_id, subject_id, chapter_id, session_date);

CREATE INDEX IF NOT EXISTS ls_student_date_idx
  ON public.learning_sessions (student_id, session_date);

CREATE INDEX IF NOT EXISTS ls_student_mastery_idx
  ON public.learning_sessions (student_id, mastery_level);

-- 4) 给导师后台用的两个便捷视图：按 (学生, 章节) 聚合的"画像"
CREATE OR REPLACE VIEW public.chapter_progress AS
  SELECT
    student_id,
    subject_id,
    chapter_id,
    COUNT(*)                                                               AS sessions,
    ROUND(AVG(EXTRACT(EPOCH FROM (end_time - start_time))/60)::numeric, 1) AS avg_minutes,
    MAX(EXTRACT(EPOCH FROM (end_time - start_time))/60)::int               AS max_minutes,
    ROUND(AVG(feedback_score), 1)                                          AS avg_score,
    MIN(feedback_score)                                                    AS min_score,
    MAX(feedback_score)                                                    AS max_score,
    COUNT(*) FILTER (WHERE category = '复习')                              AS review_sessions,
    COUNT(*) FILTER (WHERE mastery_level = '不熟')                         AS low_mastery_sessions,
    MIN(session_date)                                                      AS first_study_date,
    MAX(session_date)                                                      AS last_study_date
  FROM public.learning_sessions
  GROUP BY student_id, subject_id, chapter_id;

CREATE OR REPLACE VIEW public.student_progress AS
  SELECT
    student_id,
    COUNT(*)                                                     AS total_sessions,
    ROUND(SUM(EXTRACT(EPOCH FROM (end_time - start_time))/60)::numeric, 1) AS total_minutes,
    ROUND(AVG(feedback_score), 1)                                AS avg_score,
    COUNT(DISTINCT subject_id)                                   AS subject_count,
    COUNT(DISTINCT chapter_id)                                   AS chapter_count,
    MAX(session_date) - MIN(session_date)                        AS days_span,
    MAX(session_date)                                            AS last_active_date
  FROM public.learning_sessions
  GROUP BY student_id;

-- 5) RLS：导师可读上述聚合视图（视图默认走基表 RLS，只要导师本来能读 learning_sessions 就够用）
GRANT SELECT ON public.chapter_progress, public.student_progress TO authenticated;

-- 6) 触发器：写入 session 时自动填 self_assessed_on
CREATE OR REPLACE FUNCTION public.set_self_assessed_on()
  RETURNS trigger
  LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.mastery_level IS NOT NULL AND NEW.self_assessed_on IS NULL THEN
    NEW.self_assessed_on = now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_self_assessed_on ON public.learning_sessions;
CREATE TRIGGER trg_set_self_assessed_on
BEFORE INSERT OR UPDATE OF mastery_level, self_assessed_on
ON public.learning_sessions
FOR EACH ROW
EXECUTE FUNCTION public.set_self_assessed_on();
