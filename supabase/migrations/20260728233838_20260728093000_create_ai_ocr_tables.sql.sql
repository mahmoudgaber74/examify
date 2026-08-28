/*
# المرحلة الثالثة — الذكاء الاصطناعي و OCR

## الجداول الجديدة
1. `ai_grading_results` — نتائج التصحيح الذكي للأسئلة المقالية
2. `ai_generated_questions` — الأسئلة المولّدة آلياً
3. `weak_topics` — نقاط الضعف المكتشفة لدى الطلاب
4. `study_plans` — خطط الدراسة التكيّفية
5. `study_plan_items` — عناصر خطة الدراسة

## الأمان
- RLS مفعّل، عزل حسب institution_id
*/

CREATE TABLE IF NOT EXISTS ai_grading_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id uuid NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  attempt_id uuid REFERENCES exam_attempts(id) ON DELETE CASCADE,
  answer_id uuid REFERENCES answers(id) ON DELETE CASCADE,
  question_id uuid REFERENCES questions(id) ON DELETE SET NULL,
  student_text text,
  ai_score numeric(6,2),
  ai_max_score numeric(6,2),
  ai_feedback text,
  ai_confidence numeric(5,2),
  rubric_scores jsonb,
  status text NOT NULL DEFAULT 'pending', -- pending, graded, needs_review, approved
  model_used text DEFAULT 'rule-based',
  created_at timestamptz DEFAULT now(),
  reviewed_at timestamptz
);

CREATE TABLE IF NOT EXISTS ai_generated_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id uuid NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  subject_id uuid REFERENCES subjects(id) ON DELETE SET NULL,
  teacher_id uuid REFERENCES staff_profiles(id) ON DELETE SET NULL,
  topic text,
  difficulty text,
  type text,
  generated_content jsonb NOT NULL,
  status text NOT NULL DEFAULT 'draft', -- draft, reviewed, imported
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS weak_topics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id uuid NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  student_id uuid REFERENCES student_profiles(id) ON DELETE CASCADE,
  subject_id uuid REFERENCES subjects(id) ON DELETE SET NULL,
  topic text NOT NULL,
  subtopic text,
  weakness_score numeric(5,2) NOT NULL DEFAULT 0,
  occurrences integer NOT NULL DEFAULT 1,
  detected_from_exam_id uuid REFERENCES examify_exams(id) ON DELETE SET NULL,
  detected_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS study_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id uuid NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES student_profiles(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  target_exam_id uuid REFERENCES examify_exams(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'active', -- active, completed, archived
  expected_improvement numeric(5,2),
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS study_plan_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  study_plan_id uuid NOT NULL REFERENCES study_plans(id) ON DELETE CASCADE,
  title text NOT NULL,
  type text NOT NULL DEFAULT 'lesson', -- lesson, exercise, assessment, project
  duration_minutes integer NOT NULL DEFAULT 30,
  sort_order integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending', -- pending, in_progress, done
  weak_topic_id uuid REFERENCES weak_topics(id) ON DELETE SET NULL,
  rationale text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE ai_grading_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_generated_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE weak_topics ENABLE ROW LEVEL SECURITY;
ALTER TABLE study_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE study_plan_items ENABLE ROW LEVEL SECURITY;

-- ai_grading_results
DROP POLICY IF EXISTS "ai_grading_select" ON ai_grading_results;
CREATE POLICY "ai_grading_select" ON ai_grading_results FOR SELECT
  TO authenticated USING (
    public.current_user_role() = 'super_admin'
    OR institution_id = public.current_user_institution_id()
  );
DROP POLICY IF EXISTS "ai_grading_insert" ON ai_grading_results;
CREATE POLICY "ai_grading_insert" ON ai_grading_results FOR INSERT
  TO authenticated WITH CHECK (
    public.current_user_role() IN ('super_admin', 'school_admin', 'teacher', 'grader')
    AND institution_id = public.current_user_institution_id()
  );
DROP POLICY IF EXISTS "ai_grading_update" ON ai_grading_results;
CREATE POLICY "ai_grading_update" ON ai_grading_results FOR UPDATE
  TO authenticated USING (
    public.current_user_role() IN ('super_admin', 'school_admin', 'teacher', 'grader')
    AND institution_id = public.current_user_institution_id()
  ) WITH CHECK (
    public.current_user_role() IN ('super_admin', 'school_admin', 'teacher', 'grader')
    AND institution_id = public.current_user_institution_id()
  );
DROP POLICY IF EXISTS "ai_grading_delete" ON ai_grading_results;
CREATE POLICY "ai_grading_delete" ON ai_grading_results FOR DELETE
  TO authenticated USING (
    public.current_user_role() IN ('super_admin', 'school_admin')
    AND institution_id = public.current_user_institution_id()
  );

-- ai_generated_questions
DROP POLICY IF EXISTS "ai_gen_q_select" ON ai_generated_questions;
CREATE POLICY "ai_gen_q_select" ON ai_generated_questions FOR SELECT
  TO authenticated USING (
    public.current_user_role() = 'super_admin'
    OR institution_id = public.current_user_institution_id()
  );
DROP POLICY IF EXISTS "ai_gen_q_insert" ON ai_generated_questions;
CREATE POLICY "ai_gen_q_insert" ON ai_generated_questions FOR INSERT
  TO authenticated WITH CHECK (
    public.current_user_role() IN ('super_admin', 'school_admin', 'teacher')
    AND institution_id = public.current_user_institution_id()
  );
DROP POLICY IF EXISTS "ai_gen_q_update" ON ai_generated_questions;
CREATE POLICY "ai_gen_q_update" ON ai_generated_questions FOR UPDATE
  TO authenticated USING (
    public.current_user_role() IN ('super_admin', 'school_admin', 'teacher')
    AND institution_id = public.current_user_institution_id()
  ) WITH CHECK (
    public.current_user_role() IN ('super_admin', 'school_admin', 'teacher')
    AND institution_id = public.current_user_institution_id()
  );
DROP POLICY IF EXISTS "ai_gen_q_delete" ON ai_generated_questions;
CREATE POLICY "ai_gen_q_delete" ON ai_generated_questions FOR DELETE
  TO authenticated USING (
    public.current_user_role() IN ('super_admin', 'school_admin')
    AND institution_id = public.current_user_institution_id()
  );

-- weak_topics
DROP POLICY IF EXISTS "weak_topics_select" ON weak_topics;
CREATE POLICY "weak_topics_select" ON weak_topics FOR SELECT
  TO authenticated USING (
    public.current_user_role() = 'super_admin'
    OR institution_id = public.current_user_institution_id()
    OR EXISTS (SELECT 1 FROM student_profiles sp WHERE sp.id = weak_topics.student_id AND sp.user_id = auth.uid())
  );
DROP POLICY IF EXISTS "weak_topics_insert" ON weak_topics;
CREATE POLICY "weak_topics_insert" ON weak_topics FOR INSERT
  TO authenticated WITH CHECK (
    public.current_user_role() IN ('super_admin', 'school_admin', 'teacher')
    AND institution_id = public.current_user_institution_id()
  );
DROP POLICY IF EXISTS "weak_topics_update" ON weak_topics;
CREATE POLICY "weak_topics_update" ON weak_topics FOR UPDATE
  TO authenticated USING (
    public.current_user_role() IN ('super_admin', 'school_admin', 'teacher')
    AND institution_id = public.current_user_institution_id()
  ) WITH CHECK (
    public.current_user_role() IN ('super_admin', 'school_admin', 'teacher')
    AND institution_id = public.current_user_institution_id()
  );
DROP POLICY IF EXISTS "weak_topics_delete" ON weak_topics;
CREATE POLICY "weak_topics_delete" ON weak_topics FOR DELETE
  TO authenticated USING (
    public.current_user_role() IN ('super_admin', 'school_admin')
    AND institution_id = public.current_user_institution_id()
  );

-- study_plans
DROP POLICY IF EXISTS "study_plans_select" ON study_plans;
CREATE POLICY "study_plans_select" ON study_plans FOR SELECT
  TO authenticated USING (
    public.current_user_role() = 'super_admin'
    OR institution_id = public.current_user_institution_id()
    OR EXISTS (SELECT 1 FROM student_profiles sp WHERE sp.id = study_plans.student_id AND sp.user_id = auth.uid())
  );
DROP POLICY IF EXISTS "study_plans_insert" ON study_plans;
CREATE POLICY "study_plans_insert" ON study_plans FOR INSERT
  TO authenticated WITH CHECK (
    public.current_user_role() IN ('super_admin', 'school_admin', 'teacher')
    AND institution_id = public.current_user_institution_id()
  );
DROP POLICY IF EXISTS "study_plans_update" ON study_plans;
CREATE POLICY "study_plans_update" ON study_plans FOR UPDATE
  TO authenticated USING (
    public.current_user_role() IN ('super_admin', 'school_admin', 'teacher')
    AND institution_id = public.current_user_institution_id()
  ) WITH CHECK (
    public.current_user_role() IN ('super_admin', 'school_admin', 'teacher')
    AND institution_id = public.current_user_institution_id()
  );
DROP POLICY IF EXISTS "study_plans_delete" ON study_plans;
CREATE POLICY "study_plans_delete" ON study_plans FOR DELETE
  TO authenticated USING (
    public.current_user_role() IN ('super_admin', 'school_admin')
    AND institution_id = public.current_user_institution_id()
  );

-- study_plan_items
DROP POLICY IF EXISTS "study_plan_items_select" ON study_plan_items;
CREATE POLICY "study_plan_items_select" ON study_plan_items FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM study_plans sp WHERE sp.id = study_plan_items.study_plan_id AND (sp.institution_id = public.current_user_institution_id() OR public.current_user_role() = 'super_admin'))
    OR EXISTS (SELECT 1 FROM study_plans sp JOIN student_profiles st ON st.id = sp.student_id WHERE sp.id = study_plan_items.study_plan_id AND st.user_id = auth.uid())
  );
DROP POLICY IF EXISTS "study_plan_items_insert" ON study_plan_items;
CREATE POLICY "study_plan_items_insert" ON study_plan_items FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM study_plans sp WHERE sp.id = study_plan_items.study_plan_id AND sp.institution_id = public.current_user_institution_id() AND public.current_user_role() IN ('super_admin', 'school_admin', 'teacher'))
  );
DROP POLICY IF EXISTS "study_plan_items_update" ON study_plan_items;
CREATE POLICY "study_plan_items_update" ON study_plan_items FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM study_plans sp WHERE sp.id = study_plan_items.study_plan_id AND sp.institution_id = public.current_user_institution_id() AND public.current_user_role() IN ('super_admin', 'school_admin', 'teacher'))
    OR EXISTS (SELECT 1 FROM study_plans sp JOIN student_profiles st ON st.id = sp.student_id WHERE sp.id = study_plan_items.study_plan_id AND st.user_id = auth.uid())
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM study_plans sp WHERE sp.id = study_plan_items.study_plan_id AND sp.institution_id = public.current_user_institution_id() AND public.current_user_role() IN ('super_admin', 'school_admin', 'teacher'))
    OR EXISTS (SELECT 1 FROM study_plans sp JOIN student_profiles st ON st.id = sp.student_id WHERE sp.id = study_plan_items.study_plan_id AND st.user_id = auth.uid())
  );
DROP POLICY IF EXISTS "study_plan_items_delete" ON study_plan_items;
CREATE POLICY "study_plan_items_delete" ON study_plan_items FOR DELETE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM study_plans sp WHERE sp.id = study_plan_items.study_plan_id AND sp.institution_id = public.current_user_institution_id() AND public.current_user_role() IN ('super_admin', 'school_admin', 'teacher'))
  );

CREATE INDEX IF NOT EXISTS idx_ai_grading_attempt ON ai_grading_results(attempt_id);
CREATE INDEX IF NOT EXISTS idx_ai_gen_q_subject ON ai_generated_questions(subject_id);
CREATE INDEX IF NOT EXISTS idx_weak_topics_student ON weak_topics(student_id);
CREATE INDEX IF NOT EXISTS idx_study_plans_student ON study_plans(student_id);
CREATE INDEX IF NOT EXISTS idx_study_plan_items_plan ON study_plan_items(study_plan_id);