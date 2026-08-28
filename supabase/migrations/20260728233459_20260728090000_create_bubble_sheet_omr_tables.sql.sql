/*
# المرحلة الثانية — البابل شيت و OMR

## الجداول الجديدة
1. `bubble_sheets` — نماذج البابل شيت (قالب لكل امتحان)
2. `omr_results` — نتائج قراءة الأوراق
3. `omr_answers` — الإجابات المقرؤة لكل سؤال في كل ورقة

## الأمان
- RLS مفعّل، عزل حسب institution_id
- المعلم ومدير المدرسة يديران النماذج ويقرآن النتائج
*/

CREATE TABLE IF NOT EXISTS bubble_sheets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id uuid NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  exam_id uuid NOT NULL REFERENCES examify_exams(id) ON DELETE CASCADE,
  model_label text NOT NULL DEFAULT 'A', -- A, B, C, D
  questions_count integer NOT NULL DEFAULT 20,
  choices_count integer NOT NULL DEFAULT 4,
  include_student_id boolean NOT NULL DEFAULT true,
  include_student_name boolean NOT NULL DEFAULT true,
  include_qr boolean NOT NULL DEFAULT true,
  pdf_url text,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS omr_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id uuid NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  bubble_sheet_id uuid REFERENCES bubble_sheets(id) ON DELETE SET NULL,
  exam_id uuid NOT NULL REFERENCES examify_exams(id) ON DELETE CASCADE,
  student_profile_id uuid REFERENCES student_profiles(id) ON DELETE SET NULL,
  student_name text,
  student_code text,
  image_url text,
  model_label text DEFAULT 'A',
  status text NOT NULL DEFAULT 'pending', -- pending, reviewed, approved, needs_review
  score integer NOT NULL DEFAULT 0,
  total_questions integer NOT NULL DEFAULT 0,
  correct_count integer NOT NULL DEFAULT 0,
  wrong_count integer NOT NULL DEFAULT 0,
  empty_count integer NOT NULL DEFAULT 0,
  confidence numeric(5,2) DEFAULT 0,
  reviewed_by uuid REFERENCES auth.users(id),
  reviewed_at timestamptz,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS omr_answers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  omr_result_id uuid NOT NULL REFERENCES omr_results(id) ON DELETE CASCADE,
  question_number integer NOT NULL,
  detected_answer text, -- A, B, C, D, or empty
  correct_answer text,
  is_correct boolean,
  confidence numeric(5,2) DEFAULT 0,
  needs_manual_review boolean NOT NULL DEFAULT false,
  manual_override text,
  created_at timestamptz DEFAULT now(),
  UNIQUE(omr_result_id, question_number)
);

ALTER TABLE bubble_sheets ENABLE ROW LEVEL SECURITY;
ALTER TABLE omr_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE omr_answers ENABLE ROW LEVEL SECURITY;

-- bubble_sheets
DROP POLICY IF EXISTS "bubble_sheets_select" ON bubble_sheets;
CREATE POLICY "bubble_sheets_select" ON bubble_sheets FOR SELECT
  TO authenticated USING (
    public.current_user_role() = 'super_admin'
    OR institution_id = public.current_user_institution_id()
  );

DROP POLICY IF EXISTS "bubble_sheets_insert" ON bubble_sheets;
CREATE POLICY "bubble_sheets_insert" ON bubble_sheets FOR INSERT
  TO authenticated WITH CHECK (
    public.current_user_role() IN ('super_admin', 'school_admin', 'teacher')
    AND institution_id = public.current_user_institution_id()
  );

DROP POLICY IF EXISTS "bubble_sheets_update" ON bubble_sheets;
CREATE POLICY "bubble_sheets_update" ON bubble_sheets FOR UPDATE
  TO authenticated USING (
    public.current_user_role() IN ('super_admin', 'school_admin', 'teacher')
    AND institution_id = public.current_user_institution_id()
  ) WITH CHECK (
    public.current_user_role() IN ('super_admin', 'school_admin', 'teacher')
    AND institution_id = public.current_user_institution_id()
  );

DROP POLICY IF EXISTS "bubble_sheets_delete" ON bubble_sheets;
CREATE POLICY "bubble_sheets_delete" ON bubble_sheets FOR DELETE
  TO authenticated USING (
    public.current_user_role() IN ('super_admin', 'school_admin')
    AND institution_id = public.current_user_institution_id()
  );

-- omr_results
DROP POLICY IF EXISTS "omr_results_select" ON omr_results;
CREATE POLICY "omr_results_select" ON omr_results FOR SELECT
  TO authenticated USING (
    public.current_user_role() = 'super_admin'
    OR institution_id = public.current_user_institution_id()
  );

DROP POLICY IF EXISTS "omr_results_insert" ON omr_results;
CREATE POLICY "omr_results_insert" ON omr_results FOR INSERT
  TO authenticated WITH CHECK (
    public.current_user_role() IN ('super_admin', 'school_admin', 'teacher', 'grader')
    AND institution_id = public.current_user_institution_id()
  );

DROP POLICY IF EXISTS "omr_results_update" ON omr_results;
CREATE POLICY "omr_results_update" ON omr_results FOR UPDATE
  TO authenticated USING (
    public.current_user_role() IN ('super_admin', 'school_admin', 'teacher', 'grader')
    AND institution_id = public.current_user_institution_id()
  ) WITH CHECK (
    public.current_user_role() IN ('super_admin', 'school_admin', 'teacher', 'grader')
    AND institution_id = public.current_user_institution_id()
  );

DROP POLICY IF EXISTS "omr_results_delete" ON omr_results;
CREATE POLICY "omr_results_delete" ON omr_results FOR DELETE
  TO authenticated USING (
    public.current_user_role() IN ('super_admin', 'school_admin')
    AND institution_id = public.current_user_institution_id()
  );

-- omr_answers
DROP POLICY IF EXISTS "omr_answers_select" ON omr_answers;
CREATE POLICY "omr_answers_select" ON omr_answers FOR SELECT
  TO authenticated USING (
    EXISTS (
      SELECT 1 FROM omr_results r
      WHERE r.id = omr_answers.omr_result_id
      AND (r.institution_id = public.current_user_institution_id() OR public.current_user_role() = 'super_admin')
    )
  );

DROP POLICY IF EXISTS "omr_answers_insert" ON omr_answers;
CREATE POLICY "omr_answers_insert" ON omr_answers FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (
      SELECT 1 FROM omr_results r
      WHERE r.id = omr_answers.omr_result_id
      AND r.institution_id = public.current_user_institution_id()
      AND public.current_user_role() IN ('super_admin', 'school_admin', 'teacher', 'grader')
    )
  );

DROP POLICY IF EXISTS "omr_answers_update" ON omr_answers;
CREATE POLICY "omr_answers_update" ON omr_answers FOR UPDATE
  TO authenticated USING (
    EXISTS (
      SELECT 1 FROM omr_results r
      WHERE r.id = omr_answers.omr_result_id
      AND r.institution_id = public.current_user_institution_id()
      AND public.current_user_role() IN ('super_admin', 'school_admin', 'teacher', 'grader')
    )
  ) WITH CHECK (
    EXISTS (
      SELECT 1 FROM omr_results r
      WHERE r.id = omr_answers.omr_result_id
      AND r.institution_id = public.current_user_institution_id()
      AND public.current_user_role() IN ('super_admin', 'school_admin', 'teacher', 'grader')
    )
  );

DROP POLICY IF EXISTS "omr_answers_delete" ON omr_answers;
CREATE POLICY "omr_answers_delete" ON omr_answers FOR DELETE
  TO authenticated USING (
    EXISTS (
      SELECT 1 FROM omr_results r
      WHERE r.id = omr_answers.omr_result_id
      AND r.institution_id = public.current_user_institution_id()
      AND public.current_user_role() IN ('super_admin', 'school_admin', 'teacher')
    )
  );

CREATE INDEX IF NOT EXISTS idx_bubble_sheets_exam ON bubble_sheets(exam_id);
CREATE INDEX IF NOT EXISTS idx_omr_results_exam ON omr_results(exam_id);
CREATE INDEX IF NOT EXISTS idx_omr_results_status ON omr_results(status);
CREATE INDEX IF NOT EXISTS idx_omr_answers_result ON omr_answers(omr_result_id);