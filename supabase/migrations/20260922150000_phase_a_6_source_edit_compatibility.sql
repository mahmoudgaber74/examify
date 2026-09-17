-- Phase A.6: finalized snapshots retain their own immutable option values.
-- Source question options are replaceable by the atomic authoring RPC; a
-- finalized snapshot must therefore not prevent source option replacement.
ALTER TABLE public.bubble_sheet_options
  DROP CONSTRAINT IF EXISTS bubble_sheet_options_option_id_question_id_fkey;
ALTER TABLE public.bubble_sheet_options
  ADD CONSTRAINT bubble_sheet_options_option_id_question_id_fkey
  FOREIGN KEY (option_id, question_id)
  REFERENCES public.question_options(id, question_id) ON DELETE RESTRICT;

CREATE OR REPLACE FUNCTION public.update_single_answer_question_options(
  p_question_id uuid, p_options jsonb
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
DECLARE v_question public.questions%ROWTYPE; v_count integer; v_index integer := 0; v_option jsonb; v_option_id uuid; v_result jsonb;
BEGIN
  IF auth.uid() IS NULL OR public.current_user_role() NOT IN ('super_admin','school_admin','teacher') THEN RAISE EXCEPTION 'OBJECTIVE_QUESTION_WRITE_NOT_ALLOWED'; END IF;
  SELECT * INTO v_question FROM public.questions WHERE id=p_question_id;
  IF NOT FOUND OR v_question.type NOT IN ('multiple_choice','true_false') OR v_question.institution_id <> public.current_user_institution_id()
     OR (public.current_user_role()='teacher' AND NOT public.teacher_can_manage_question(p_question_id)) THEN RAISE EXCEPTION 'OBJECTIVE_QUESTION_NOT_FOUND_OR_FORBIDDEN'; END IF;
  IF jsonb_typeof(p_options) IS DISTINCT FROM 'array' OR jsonb_array_length(p_options)<2
     OR (SELECT count(*) FROM jsonb_array_elements(p_options) o WHERE btrim(coalesce(o->>'label',''))='')>0
     OR (SELECT count(*) FROM jsonb_array_elements(p_options) o WHERE coalesce((o->>'is_correct')::boolean,false))<>1 THEN RAISE EXCEPTION 'MCQ_REQUIRES_EXACTLY_ONE_CORRECT_OPTION'; END IF;
  SELECT count(*) INTO v_count FROM public.question_options WHERE question_id=p_question_id;
  IF v_count <> jsonb_array_length(p_options) THEN RAISE EXCEPTION 'OBJECTIVE_OPTION_COUNT_CHANGE_REQUIRES_NEW_QUESTION'; END IF;
  FOR v_option IN SELECT value FROM jsonb_array_elements(p_options) LOOP
    v_index := v_index + 1;
    SELECT id INTO v_option_id FROM public.question_options WHERE question_id=p_question_id ORDER BY sort_order,id OFFSET v_index-1 LIMIT 1;
    UPDATE public.question_options SET label=btrim(v_option->>'label'), is_correct=coalesce((v_option->>'is_correct')::boolean,false), sort_order=v_index-1 WHERE id=v_option_id;
  END LOOP;
  SELECT coalesce(jsonb_agg(to_jsonb(qo) ORDER BY qo.sort_order,qo.id),'[]'::jsonb) INTO v_result FROM public.question_options qo WHERE qo.question_id=p_question_id;
  RETURN jsonb_build_object('question_id',p_question_id,'options',v_result);
END; $$;

REVOKE ALL ON FUNCTION public.update_single_answer_question_options(uuid,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_single_answer_question_options(uuid,jsonb) TO authenticated;
