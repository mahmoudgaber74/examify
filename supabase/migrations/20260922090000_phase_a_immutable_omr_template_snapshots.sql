-- Phase A: immutable OMR layout and exact question/option snapshots.
-- Historical bubble_sheets remain legacy and are not backfilled.

ALTER TABLE public.bubble_sheets
  ADD COLUMN IF NOT EXISTS snapshot_state text NOT NULL DEFAULT 'legacy',
  ADD COLUMN IF NOT EXISTS generator_version text NOT NULL DEFAULT 'legacy',
  ADD COLUMN IF NOT EXISTS page_orientation text NOT NULL DEFAULT 'portrait',
  ADD COLUMN IF NOT EXISTS finalized_at timestamptz,
  ADD COLUMN IF NOT EXISTS is_finalized boolean NOT NULL DEFAULT false;

-- Composite keys used below prove that every snapshot belongs to the same
-- exam/question graph as its parent. Existing primary keys remain unchanged.
CREATE UNIQUE INDEX IF NOT EXISTS bubble_sheets_id_exam_unique
  ON public.bubble_sheets(id, exam_id);
CREATE UNIQUE INDEX IF NOT EXISTS exam_questions_exam_question_unique_idx
  ON public.exam_questions(exam_id, question_id);
CREATE UNIQUE INDEX IF NOT EXISTS question_options_id_question_unique_idx
  ON public.question_options(id, question_id);

ALTER TABLE public.bubble_sheets DROP CONSTRAINT IF EXISTS bubble_sheets_snapshot_state_check;
ALTER TABLE public.bubble_sheets ADD CONSTRAINT bubble_sheets_snapshot_state_check
  CHECK ((snapshot_state = 'legacy' AND is_finalized = false AND finalized_at IS NULL)
      OR (snapshot_state = 'draft' AND is_finalized = false)
      OR (snapshot_state = 'exact' AND is_finalized = true AND finalized_at IS NOT NULL));
ALTER TABLE public.bubble_sheets DROP CONSTRAINT IF EXISTS bubble_sheets_page_orientation_check;
ALTER TABLE public.bubble_sheets ADD CONSTRAINT bubble_sheets_page_orientation_check
  CHECK (page_orientation IN ('portrait', 'landscape'));

CREATE TABLE IF NOT EXISTS public.bubble_sheet_sections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bubble_sheet_id uuid NOT NULL REFERENCES public.bubble_sheets(id) ON DELETE CASCADE,
  section_key text NOT NULL,
  title text,
  visual_index integer NOT NULL CHECK (visual_index >= 0),
  question_start_index integer NOT NULL CHECK (question_start_index >= 1),
  question_count integer NOT NULL CHECK (question_count >= 0),
  page_number integer NOT NULL DEFAULT 1 CHECK (page_number >= 1),
  normalized_x numeric(10,8) NOT NULL CHECK (normalized_x >= 0 AND normalized_x <= 1),
  normalized_y numeric(10,8) NOT NULL CHECK (normalized_y >= 0 AND normalized_y <= 1),
  normalized_width numeric(10,8) NOT NULL CHECK (normalized_width > 0 AND normalized_width <= 1),
  normalized_height numeric(10,8) NOT NULL CHECK (normalized_height > 0 AND normalized_height <= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (bubble_sheet_id, section_key), UNIQUE (bubble_sheet_id, visual_index), UNIQUE (id, bubble_sheet_id),
  CHECK (normalized_x + normalized_width <= 1), CHECK (normalized_y + normalized_height <= 1)
);

CREATE TABLE IF NOT EXISTS public.bubble_sheet_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bubble_sheet_id uuid NOT NULL REFERENCES public.bubble_sheets(id) ON DELETE CASCADE,
  section_id uuid NOT NULL, question_id uuid NOT NULL, exam_id uuid NOT NULL,
  global_question_number integer NOT NULL CHECK (global_question_number >= 1),
  section_question_number integer NOT NULL CHECK (section_question_number >= 1),
  page_number integer NOT NULL CHECK (page_number >= 1),
  sort_snapshot integer NOT NULL CHECK (sort_snapshot >= 0),
  normalized_x numeric(10,8) NOT NULL CHECK (normalized_x >= 0 AND normalized_x <= 1),
  normalized_y numeric(10,8) NOT NULL CHECK (normalized_y >= 0 AND normalized_y <= 1),
  normalized_width numeric(10,8) NOT NULL CHECK (normalized_width > 0 AND normalized_width <= 1),
  normalized_height numeric(10,8) NOT NULL CHECK (normalized_height > 0 AND normalized_height <= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (bubble_sheet_id, question_id), UNIQUE (bubble_sheet_id, global_question_number), UNIQUE (id, bubble_sheet_id), UNIQUE (id, question_id),
  FOREIGN KEY (section_id, bubble_sheet_id) REFERENCES public.bubble_sheet_sections(id, bubble_sheet_id) ON DELETE RESTRICT,
  FOREIGN KEY (exam_id, question_id) REFERENCES public.exam_questions(exam_id, question_id) ON DELETE RESTRICT,
  FOREIGN KEY (bubble_sheet_id, exam_id) REFERENCES public.bubble_sheets(id, exam_id) ON DELETE RESTRICT,
  CHECK (normalized_x + normalized_width <= 1), CHECK (normalized_y + normalized_height <= 1)
);

CREATE TABLE IF NOT EXISTS public.bubble_sheet_options (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bubble_sheet_question_id uuid NOT NULL,
  question_id uuid NOT NULL, option_id uuid NOT NULL,
  option_label text NOT NULL CHECK (length(trim(option_label)) > 0),
  visual_index integer NOT NULL CHECK (visual_index >= 0),
  normalized_x numeric(10,8) NOT NULL CHECK (normalized_x >= 0 AND normalized_x <= 1),
  normalized_y numeric(10,8) NOT NULL CHECK (normalized_y >= 0 AND normalized_y <= 1),
  normalized_width numeric(10,8) NOT NULL CHECK (normalized_width > 0 AND normalized_width <= 1),
  normalized_height numeric(10,8) NOT NULL CHECK (normalized_height > 0 AND normalized_height <= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (bubble_sheet_question_id, option_id), UNIQUE (bubble_sheet_question_id, visual_index), UNIQUE (bubble_sheet_question_id, option_label),
  FOREIGN KEY (bubble_sheet_question_id) REFERENCES public.bubble_sheet_questions(id) ON DELETE CASCADE,
  FOREIGN KEY (bubble_sheet_question_id, question_id) REFERENCES public.bubble_sheet_questions(id, question_id) ON DELETE CASCADE,
  FOREIGN KEY (option_id, question_id) REFERENCES public.question_options(id, question_id) ON DELETE RESTRICT,
  CHECK (normalized_x + normalized_width <= 1), CHECK (normalized_y + normalized_height <= 1)
);

CREATE INDEX IF NOT EXISTS bubble_sheet_sections_sheet_idx ON public.bubble_sheet_sections(bubble_sheet_id, visual_index);
CREATE INDEX IF NOT EXISTS bubble_sheet_questions_sheet_idx ON public.bubble_sheet_questions(bubble_sheet_id, global_question_number);
CREATE INDEX IF NOT EXISTS bubble_sheet_questions_section_idx ON public.bubble_sheet_questions(section_id);
CREATE INDEX IF NOT EXISTS bubble_sheet_questions_question_idx ON public.bubble_sheet_questions(question_id);
CREATE INDEX IF NOT EXISTS bubble_sheet_options_question_idx ON public.bubble_sheet_options(bubble_sheet_question_id, visual_index);
CREATE INDEX IF NOT EXISTS bubble_sheet_options_option_idx ON public.bubble_sheet_options(option_id);

ALTER TABLE public.bubble_sheet_sections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bubble_sheet_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bubble_sheet_options ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.validate_bubble_sheet_snapshot_state()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE section_total integer; question_total integer; option_total integer;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.is_finalized THEN RAISE EXCEPTION 'finalized_bubble_sheet_delete_denied'; END IF;
    RETURN OLD;
  END IF;
  IF OLD.is_finalized THEN
    IF NEW.exam_id IS DISTINCT FROM OLD.exam_id OR NEW.institution_id IS DISTINCT FROM OLD.institution_id
      OR NEW.model_label IS DISTINCT FROM OLD.model_label OR NEW.template_version IS DISTINCT FROM OLD.template_version
      OR NEW.questions_count IS DISTINCT FROM OLD.questions_count OR NEW.choices_count IS DISTINCT FROM OLD.choices_count
      OR NEW.qr_token IS DISTINCT FROM OLD.qr_token OR NEW.page_size IS DISTINCT FROM OLD.page_size
      OR NEW.page_orientation IS DISTINCT FROM OLD.page_orientation OR NEW.generator_version IS DISTINCT FROM OLD.generator_version
      OR NEW.sections IS DISTINCT FROM OLD.sections OR NEW.snapshot_state IS DISTINCT FROM OLD.snapshot_state
      OR NEW.finalized_at IS DISTINCT FROM OLD.finalized_at OR NEW.is_finalized IS DISTINCT FROM OLD.is_finalized THEN
      RAISE EXCEPTION 'finalized_bubble_sheet_layout_immutable';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.is_finalized THEN
    IF NEW.snapshot_state <> 'exact' OR NEW.finalized_at IS NULL THEN RAISE EXCEPTION 'bubble_sheet_snapshot_state_invalid'; END IF;
    SELECT count(*) INTO section_total FROM public.bubble_sheet_sections WHERE bubble_sheet_id = NEW.id;
    SELECT count(*) INTO question_total FROM public.bubble_sheet_questions WHERE bubble_sheet_id = NEW.id;
    SELECT count(*) INTO option_total FROM public.bubble_sheet_options o JOIN public.bubble_sheet_questions q ON q.id=o.bubble_sheet_question_id WHERE q.bubble_sheet_id=NEW.id;
    IF section_total < 1 OR question_total <> NEW.questions_count OR option_total <> NEW.questions_count * NEW.choices_count THEN RAISE EXCEPTION 'bubble_sheet_snapshot_incomplete'; END IF;
    IF EXISTS (SELECT 1 FROM public.bubble_sheet_questions q WHERE q.bubble_sheet_id=NEW.id AND q.global_question_number NOT BETWEEN 1 AND NEW.questions_count) THEN RAISE EXCEPTION 'bubble_sheet_question_number_invalid'; END IF;
    IF (SELECT count(DISTINCT global_question_number) FROM public.bubble_sheet_questions WHERE bubble_sheet_id=NEW.id) <> NEW.questions_count THEN RAISE EXCEPTION 'bubble_sheet_question_number_non_contiguous'; END IF;
    IF EXISTS (SELECT 1 FROM public.bubble_sheet_sections s WHERE s.bubble_sheet_id=NEW.id AND (SELECT count(*) FROM public.bubble_sheet_questions q WHERE q.section_id=s.id)<>s.question_count) THEN RAISE EXCEPTION 'bubble_sheet_section_count_mismatch'; END IF;
    IF (SELECT COALESCE(sum(question_count),0) FROM public.bubble_sheet_sections WHERE bubble_sheet_id=NEW.id)<>NEW.questions_count THEN RAISE EXCEPTION 'bubble_sheet_section_total_mismatch'; END IF;
    IF EXISTS (SELECT 1 FROM public.bubble_sheet_options o JOIN public.bubble_sheet_questions q ON q.id=o.bubble_sheet_question_id WHERE q.bubble_sheet_id=NEW.id GROUP BY o.bubble_sheet_question_id HAVING count(*)<>NEW.choices_count OR count(DISTINCT visual_index)<>NEW.choices_count OR min(visual_index)<>0 OR max(visual_index)<>NEW.choices_count-1) THEN RAISE EXCEPTION 'bubble_sheet_option_layout_invalid'; END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_bubble_sheet_snapshot_state ON public.bubble_sheets;
CREATE TRIGGER trg_validate_bubble_sheet_snapshot_state BEFORE INSERT OR UPDATE OR DELETE ON public.bubble_sheets FOR EACH ROW EXECUTE FUNCTION public.validate_bubble_sheet_snapshot_state();

CREATE OR REPLACE FUNCTION public.reject_finalized_bubble_sheet_child_mutation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE sheet_id uuid;
BEGIN
  IF TG_TABLE_NAME='bubble_sheet_sections' THEN sheet_id := CASE WHEN TG_OP='DELETE' THEN OLD.bubble_sheet_id ELSE NEW.bubble_sheet_id END;
  ELSIF TG_TABLE_NAME='bubble_sheet_questions' THEN sheet_id := CASE WHEN TG_OP='DELETE' THEN OLD.bubble_sheet_id ELSE NEW.bubble_sheet_id END;
  ELSE SELECT q.bubble_sheet_id INTO sheet_id FROM public.bubble_sheet_questions q WHERE q.id=CASE WHEN TG_OP='DELETE' THEN OLD.bubble_sheet_question_id ELSE NEW.bubble_sheet_question_id END;
  END IF;
  IF EXISTS (SELECT 1 FROM public.bubble_sheets WHERE id=sheet_id AND is_finalized) THEN RAISE EXCEPTION 'finalized_bubble_sheet_layout_immutable'; END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_reject_finalized_bubble_sheet_sections ON public.bubble_sheet_sections;
CREATE TRIGGER trg_reject_finalized_bubble_sheet_sections BEFORE INSERT OR UPDATE OR DELETE ON public.bubble_sheet_sections FOR EACH ROW EXECUTE FUNCTION public.reject_finalized_bubble_sheet_child_mutation();
DROP TRIGGER IF EXISTS trg_reject_finalized_bubble_sheet_questions ON public.bubble_sheet_questions;
CREATE TRIGGER trg_reject_finalized_bubble_sheet_questions BEFORE INSERT OR UPDATE OR DELETE ON public.bubble_sheet_questions FOR EACH ROW EXECUTE FUNCTION public.reject_finalized_bubble_sheet_child_mutation();
DROP TRIGGER IF EXISTS trg_reject_finalized_bubble_sheet_options ON public.bubble_sheet_options;
CREATE TRIGGER trg_reject_finalized_bubble_sheet_options BEFORE INSERT OR UPDATE OR DELETE ON public.bubble_sheet_options FOR EACH ROW EXECUTE FUNCTION public.reject_finalized_bubble_sheet_child_mutation();

DROP POLICY IF EXISTS bubble_sheet_sections_select ON public.bubble_sheet_sections;
CREATE POLICY bubble_sheet_sections_select ON public.bubble_sheet_sections FOR SELECT TO authenticated USING (public.current_user_role() IN ('super_admin','school_admin','teacher') AND EXISTS (SELECT 1 FROM public.bubble_sheets b WHERE b.id=bubble_sheet_id AND (public.is_super_admin() OR b.institution_id=public.current_user_institution_id())));
DROP POLICY IF EXISTS bubble_sheet_questions_select ON public.bubble_sheet_questions;
CREATE POLICY bubble_sheet_questions_select ON public.bubble_sheet_questions FOR SELECT TO authenticated USING (public.current_user_role() IN ('super_admin','school_admin','teacher') AND EXISTS (SELECT 1 FROM public.bubble_sheets b WHERE b.id=bubble_sheet_id AND (public.is_super_admin() OR b.institution_id=public.current_user_institution_id())));
DROP POLICY IF EXISTS bubble_sheet_options_select ON public.bubble_sheet_options;
CREATE POLICY bubble_sheet_options_select ON public.bubble_sheet_options FOR SELECT TO authenticated USING (public.current_user_role() IN ('super_admin','school_admin','teacher') AND EXISTS (SELECT 1 FROM public.bubble_sheet_questions q JOIN public.bubble_sheets b ON b.id=q.bubble_sheet_id WHERE q.id=bubble_sheet_question_id AND (public.is_super_admin() OR b.institution_id=public.current_user_institution_id())));
REVOKE ALL ON public.bubble_sheet_sections, public.bubble_sheet_questions, public.bubble_sheet_options FROM anon;
GRANT SELECT ON public.bubble_sheet_sections, public.bubble_sheet_questions, public.bubble_sheet_options TO authenticated;

CREATE OR REPLACE FUNCTION public.create_exact_bubble_sheet_snapshot(p_snapshot jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE p_exam_id uuid := (p_snapshot->>'exam_id')::uuid; p_sheet_id uuid; p_section_id uuid; p_question_id uuid; p_question jsonb; p_option jsonb; p_section jsonb;
DECLARE actor_role text := public.current_user_role(); v_institution uuid; v_questions integer := (p_snapshot->>'questions_count')::integer; v_choices integer := (p_snapshot->>'choices_count')::integer;
BEGIN
  IF auth.uid() IS NULL OR actor_role NOT IN ('super_admin','school_admin','teacher') THEN RAISE EXCEPTION 'omr_template_create_not_allowed'; END IF;
  SELECT institution_id INTO v_institution FROM public.examify_exams WHERE id=p_exam_id;
  IF v_institution IS NULL OR (actor_role<>'super_admin' AND v_institution<>public.current_user_institution_id()) THEN RAISE EXCEPTION 'omr_template_exam_institution_denied'; END IF;
  IF v_questions IS NULL OR v_questions<1 OR v_choices IS NULL OR v_choices<2 OR v_choices>8 THEN RAISE EXCEPTION 'omr_template_dimensions_invalid'; END IF;
  IF jsonb_array_length(COALESCE(p_snapshot->'sections','[]'::jsonb))<1 OR jsonb_array_length(COALESCE(p_snapshot->'questions','[]'::jsonb))<>v_questions THEN RAISE EXCEPTION 'omr_template_mapping_incomplete'; END IF;
  INSERT INTO public.bubble_sheets(institution_id,exam_id,model_label,questions_count,choices_count,include_student_id,include_student_name,include_qr,template_version,qr_token,sections,status,snapshot_state,generator_version,page_size,page_orientation,is_finalized,generated_by)
  VALUES(v_institution,p_exam_id,COALESCE(p_snapshot->>'model_label','A'),v_questions,v_choices,COALESCE((p_snapshot->>'include_student_id')::boolean,true),COALESCE((p_snapshot->>'include_student_name')::boolean,true),COALESCE((p_snapshot->>'include_qr')::boolean,true),(p_snapshot->>'template_version')::integer,(p_snapshot->>'qr_token')::uuid,COALESCE(p_snapshot->'sections','[]'::jsonb),'active','draft',COALESCE(p_snapshot->>'generator_version','phase-a-v1'),COALESCE(p_snapshot->>'page_size','A4'),COALESCE(p_snapshot->>'page_orientation','portrait'),false,auth.uid()) RETURNING id INTO p_sheet_id;
  FOR p_section IN SELECT * FROM jsonb_array_elements(p_snapshot->'sections') LOOP
    INSERT INTO public.bubble_sheet_sections(bubble_sheet_id,section_key,title,visual_index,question_start_index,question_count,page_number,normalized_x,normalized_y,normalized_width,normalized_height)
    VALUES(p_sheet_id,p_section->>'section_key',p_section->>'title',(p_section->>'visual_index')::integer,(p_section->>'question_start_index')::integer,(p_section->>'question_count')::integer,(p_section->>'page_number')::integer,(p_section->>'normalized_x')::numeric,(p_section->>'normalized_y')::numeric,(p_section->>'normalized_width')::numeric,(p_section->>'normalized_height')::numeric) RETURNING id INTO p_section_id;
  END LOOP;
  FOR p_question IN SELECT * FROM jsonb_array_elements(p_snapshot->'questions') LOOP
    p_question_id := (p_question->>'question_id')::uuid;
    SELECT id INTO p_section_id FROM public.bubble_sheet_sections WHERE bubble_sheet_id=p_sheet_id AND visual_index=(p_question->>'section_visual_index')::integer;
    IF p_section_id IS NULL THEN RAISE EXCEPTION 'omr_template_section_not_found'; END IF;
    INSERT INTO public.bubble_sheet_questions(bubble_sheet_id,section_id,question_id,exam_id,global_question_number,section_question_number,page_number,sort_snapshot,normalized_x,normalized_y,normalized_width,normalized_height)
    VALUES(p_sheet_id,p_section_id,p_question_id,p_exam_id,(p_question->>'global_question_number')::integer,(p_question->>'section_question_number')::integer,(p_question->>'page_number')::integer,(p_question->>'sort_snapshot')::integer,(p_question->>'normalized_x')::numeric,(p_question->>'normalized_y')::numeric,(p_question->>'normalized_width')::numeric,(p_question->>'normalized_height')::numeric);
    FOR p_option IN SELECT * FROM jsonb_array_elements(COALESCE(p_question->'options','[]'::jsonb)) LOOP
      INSERT INTO public.bubble_sheet_options(bubble_sheet_question_id,question_id,option_id,option_label,visual_index,normalized_x,normalized_y,normalized_width,normalized_height)
      VALUES((SELECT id FROM public.bubble_sheet_questions WHERE bubble_sheet_id=p_sheet_id AND question_id=p_question_id),p_question_id,(p_option->>'option_id')::uuid,p_option->>'option_label',(p_option->>'visual_index')::integer,(p_option->>'normalized_x')::numeric,(p_option->>'normalized_y')::numeric,(p_option->>'normalized_width')::numeric,(p_option->>'normalized_height')::numeric);
    END LOOP;
  END LOOP;
  IF EXISTS (SELECT 1 FROM public.bubble_sheet_sections s WHERE s.bubble_sheet_id=p_sheet_id AND (SELECT count(*) FROM public.bubble_sheet_questions q WHERE q.section_id=s.id)<>s.question_count) THEN RAISE EXCEPTION 'bubble_sheet_section_count_mismatch'; END IF;
  IF (SELECT count(DISTINCT global_question_number) FROM public.bubble_sheet_questions WHERE bubble_sheet_id=p_sheet_id)<>v_questions OR (SELECT COALESCE(sum(question_count),0) FROM public.bubble_sheet_sections WHERE bubble_sheet_id=p_sheet_id)<>v_questions THEN RAISE EXCEPTION 'bubble_sheet_question_number_invalid'; END IF;
  IF EXISTS (SELECT 1 FROM public.bubble_sheet_options o JOIN public.bubble_sheet_questions q ON q.id=o.bubble_sheet_question_id WHERE q.bubble_sheet_id=p_sheet_id GROUP BY o.bubble_sheet_question_id HAVING count(*)<>v_choices OR count(DISTINCT option_label)<>v_choices OR count(DISTINCT visual_index)<>v_choices OR min(visual_index)<>0 OR max(visual_index)<>v_choices-1) THEN RAISE EXCEPTION 'bubble_sheet_option_layout_invalid'; END IF;
  UPDATE public.bubble_sheets SET snapshot_state='exact',is_finalized=true,finalized_at=now() WHERE id=p_sheet_id;
  RETURN jsonb_build_object('id',p_sheet_id,'exam_id',p_exam_id,'snapshot_state','exact','is_finalized',true);
END;
$$;

REVOKE ALL ON FUNCTION public.create_exact_bubble_sheet_snapshot(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_exact_bubble_sheet_snapshot(jsonb) TO authenticated;
