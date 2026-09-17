-- Phase A.3: objective question writes are atomic and client table writes
-- cannot bypass the exact-one-correct invariant.

CREATE OR REPLACE FUNCTION public.save_single_answer_question(
  p_question_id uuid,
  p_institution_id uuid,
  p_subject_id uuid,
  p_type text,
  p_prompt text,
  p_difficulty text,
  p_points numeric,
  p_unit text,
  p_lesson text,
  p_explanation text,
  p_metadata jsonb,
  p_options jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_question_id uuid;
  v_options jsonb;
BEGIN
  IF auth.uid() IS NULL OR public.current_user_role() NOT IN ('super_admin','school_admin','teacher') THEN
    RAISE EXCEPTION 'OBJECTIVE_QUESTION_WRITE_NOT_ALLOWED';
  END IF;
  IF p_type NOT IN ('multiple_choice','true_false') THEN
    RAISE EXCEPTION 'OBJECTIVE_QUESTION_TYPE_INVALID';
  END IF;
  IF p_institution_id IS NULL OR p_institution_id <> public.current_user_institution_id() THEN
    RAISE EXCEPTION 'OBJECTIVE_QUESTION_INSTITUTION_MISMATCH';
  END IF;
  IF p_prompt IS NULL OR btrim(p_prompt) = '' OR p_subject_id IS NULL THEN
    RAISE EXCEPTION 'OBJECTIVE_QUESTION_REQUIRED_FIELD';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.subjects s WHERE s.id=p_subject_id AND s.institution_id=p_institution_id) THEN
    RAISE EXCEPTION 'OBJECTIVE_QUESTION_SUBJECT_INVALID';
  END IF;
  IF public.current_user_role() = 'teacher' AND NOT public.teacher_has_subject_scope(p_subject_id) THEN
    RAISE EXCEPTION 'OBJECTIVE_QUESTION_SUBJECT_FORBIDDEN';
  END IF;
  IF jsonb_typeof(p_options) IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_options) < 2
     OR (SELECT count(*) FROM jsonb_array_elements(p_options) o WHERE btrim(coalesce(o->>'label',''))='') > 0
     OR (SELECT count(*) FROM jsonb_array_elements(p_options) o WHERE coalesce((o->>'is_correct')::boolean,false)) <> 1 THEN
    RAISE EXCEPTION 'MCQ_REQUIRES_EXACTLY_ONE_CORRECT_OPTION';
  END IF;

  IF p_question_id IS NULL THEN
    INSERT INTO public.questions(institution_id,subject_id,type,prompt,difficulty,points,unit,lesson,explanation,metadata)
    VALUES(p_institution_id,p_subject_id,p_type,btrim(p_prompt),p_difficulty,p_points,
           nullif(btrim(coalesce(p_unit,'')),''),nullif(btrim(coalesce(p_lesson,'')),''),
           nullif(btrim(coalesce(p_explanation,'')),''),coalesce(p_metadata,'{}'::jsonb))
    RETURNING id INTO v_question_id;
  ELSE
    IF NOT EXISTS (
      SELECT 1 FROM public.questions q
      WHERE q.id=p_question_id AND q.institution_id=p_institution_id
        AND (public.current_user_role() IN ('super_admin','school_admin') OR public.teacher_can_manage_question(q.id))
    ) THEN RAISE EXCEPTION 'OBJECTIVE_QUESTION_NOT_FOUND_OR_FORBIDDEN'; END IF;
    UPDATE public.questions
    SET subject_id=p_subject_id,type=p_type,prompt=btrim(p_prompt),difficulty=p_difficulty,points=p_points,
        unit=nullif(btrim(coalesce(p_unit,'')),''),lesson=nullif(btrim(coalesce(p_lesson,'')),''),
        explanation=nullif(btrim(coalesce(p_explanation,'')),''),metadata=coalesce(p_metadata,'{}'::jsonb)
    WHERE id=p_question_id;
    v_question_id := p_question_id;
  END IF;

  DELETE FROM public.question_options WHERE question_id=v_question_id;
  INSERT INTO public.question_options(question_id,label,is_correct,sort_order)
  SELECT v_question_id,btrim(o->>'label'),coalesce((o->>'is_correct')::boolean,false),ord::integer-1
  FROM jsonb_array_elements(p_options) WITH ORDINALITY AS x(o,ord);
  SELECT coalesce(jsonb_agg(to_jsonb(qo) ORDER BY qo.sort_order),'[]'::jsonb) INTO v_options
  FROM public.question_options qo WHERE qo.question_id=v_question_id;
  RETURN jsonb_build_object('question_id',v_question_id,'options',v_options);
END;
$$;

REVOKE ALL ON FUNCTION public.save_single_answer_question(uuid,uuid,uuid,text,text,text,numeric,text,text,text,jsonb,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_single_answer_question(uuid,uuid,uuid,text,text,text,numeric,text,text,text,jsonb,jsonb) TO authenticated;

-- The established MCQ RPC remains the atomic compatibility path; it must be
-- able to replace options within its own transaction after direct table DML is
-- restricted.
CREATE OR REPLACE FUNCTION public.save_multiple_choice_question(
  p_question_id uuid, p_institution_id uuid, p_subject_id uuid, p_prompt text,
  p_difficulty text, p_points numeric, p_unit text, p_lesson text,
  p_explanation text, p_metadata jsonb, p_options jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN public.save_single_answer_question(
    p_question_id, p_institution_id, p_subject_id, 'multiple_choice', p_prompt,
    p_difficulty, p_points, p_unit, p_lesson, p_explanation, p_metadata, p_options
  );
END;
$$;

DROP POLICY IF EXISTS questions_insert ON public.questions;
CREATE POLICY questions_insert ON public.questions FOR INSERT TO authenticated
WITH CHECK (
  type NOT IN ('multiple_choice','true_false')
  AND institution_id = public.current_user_institution_id()
  AND (public.current_user_role() IN ('super_admin','school_admin')
       OR (public.current_user_role() = 'teacher' AND teacher_id = public.current_staff_profile_id()
           AND subject_id IS NOT NULL AND public.teacher_has_subject_scope(subject_id)))
);

DROP POLICY IF EXISTS questions_update ON public.questions;
CREATE POLICY questions_update ON public.questions FOR UPDATE TO authenticated
USING (
  type NOT IN ('multiple_choice','true_false')
  AND ((public.current_user_role() IN ('super_admin','school_admin') AND institution_id = public.current_user_institution_id())
       OR public.teacher_can_manage_question(id))
)
WITH CHECK (
  type NOT IN ('multiple_choice','true_false')
  AND ((public.current_user_role() IN ('super_admin','school_admin') AND institution_id = public.current_user_institution_id())
       OR (public.teacher_can_manage_question(id) AND institution_id = public.current_user_institution_id()))
);

DROP POLICY IF EXISTS question_options_insert ON public.question_options;
CREATE POLICY question_options_insert ON public.question_options FOR INSERT TO authenticated
WITH CHECK (EXISTS (
  SELECT 1 FROM public.questions q
  WHERE q.id=question_options.question_id
    AND q.type NOT IN ('multiple_choice','true_false')
    AND ((public.current_user_role() IN ('super_admin','school_admin')) OR public.teacher_can_manage_question(q.id))
));

DROP POLICY IF EXISTS question_options_update ON public.question_options;
CREATE POLICY question_options_update ON public.question_options FOR UPDATE TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.questions q WHERE q.id=question_options.question_id
    AND q.type NOT IN ('multiple_choice','true_false')
    AND ((public.current_user_role() IN ('super_admin','school_admin')) OR public.teacher_can_manage_question(q.id))
))
WITH CHECK (EXISTS (
  SELECT 1 FROM public.questions q WHERE q.id=question_options.question_id
    AND q.type NOT IN ('multiple_choice','true_false')
    AND ((public.current_user_role() IN ('super_admin','school_admin')) OR public.teacher_can_manage_question(q.id))
));

DROP POLICY IF EXISTS question_options_delete ON public.question_options;
CREATE POLICY question_options_delete ON public.question_options FOR DELETE TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.questions q WHERE q.id=question_options.question_id
    AND q.type NOT IN ('multiple_choice','true_false')
    AND ((public.current_user_role() IN ('super_admin','school_admin')) OR public.teacher_can_manage_question(q.id))
));
