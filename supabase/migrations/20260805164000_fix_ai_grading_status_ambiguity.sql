create or replace function public.create_ai_grading_job(p_answer_id uuid)
returns table (
  job_id uuid,
  status text,
  awarded_points numeric,
  max_points numeric,
  confidence numeric,
  requires_review boolean,
  structured_result jsonb
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor_role text := public.current_user_role();
  answer_row public.answers%rowtype;
  attempt_row public.exam_attempts%rowtype;
  question_row public.questions%rowtype;
  exam_row public.examify_exams%rowtype;
  created_job_id uuid;
  max_points numeric;
  exam_points numeric;
  model_answer text;
  result_json jsonb;
  result_status text;
  start_clock timestamptz := clock_timestamp();
begin
  if actor_role not in ('super_admin', 'school_admin', 'teacher', 'grader') then
    raise exception 'ai_grading_not_allowed';
  end if;

  select * into answer_row from public.answers where id = p_answer_id;
  if answer_row.id is null then
    raise exception 'ai_grading_answer_not_found';
  end if;

  select * into attempt_row from public.exam_attempts where id = answer_row.attempt_id;
  select * into question_row from public.questions where id = answer_row.question_id;
  select * into exam_row from public.examify_exams where id = attempt_row.exam_id;

  if exam_row.id is null or question_row.id is null then
    raise exception 'ai_grading_context_missing';
  end if;
  if actor_role <> 'super_admin' and exam_row.institution_id <> public.current_user_institution_id() then
    raise exception 'ai_grading_institution_denied';
  end if;
  if question_row.type not in ('short_answer', 'essay') then
    raise exception 'ai_grading_question_type_not_supported';
  end if;

  select eq.points into exam_points
  from public.exam_questions eq
  where eq.exam_id = attempt_row.exam_id
    and eq.question_id = question_row.id
  limit 1;
  max_points := coalesce(exam_points, question_row.points, 1);

  select coalesce(question_row.metadata->>'correct_answer', question_row.metadata->>'model_answer', '')
  into model_answer;

  insert into public.ai_grading_results (
    institution_id,
    attempt_id,
    answer_id,
    question_id,
    student_text,
    ai_max_score,
    status,
    provider,
    model_used,
    prompt_version
  )
  values (
    exam_row.institution_id,
    attempt_row.id,
    answer_row.id,
    question_row.id,
    answer_row.text_answer,
    max_points,
    'processing',
    'internal',
    'rule-based-v1',
    'ai-grading-v1'
  )
  returning id into created_job_id;

  begin
    result_json := public.validate_ai_grading_structured_result(
      public.ai_grade_answer_internal(question_row.type, question_row.prompt, coalesce(answer_row.text_answer, ''), model_answer, max_points, question_row.metadata),
      max_points
    );
    result_status := case when (result_json->>'requires_review')::boolean then 'needs_review' else 'completed' end;

    update public.ai_grading_results
    set
      status = result_status,
      ai_score = (result_json->>'awarded_points')::numeric,
      ai_feedback = result_json->>'summary',
      ai_confidence = (result_json->>'confidence')::numeric,
      rubric_scores = result_json->'criteria',
      structured_result = result_json,
      flags = result_json->'flags',
      requires_review = (result_json->>'requires_review')::boolean,
      input_tokens = ceil(length(coalesce(question_row.prompt, '') || ' ' || coalesce(answer_row.text_answer, '')) / 4.0),
      output_tokens = ceil(length(result_json::text) / 4.0),
      estimated_cost = 0,
      duration_ms = greatest(1, floor(extract(epoch from (clock_timestamp() - start_clock)) * 1000)::integer),
      updated_at = now()
    where id = created_job_id;
  exception when others then
    result_json := jsonb_build_object(
      'awarded_points', 0,
      'max_points', max_points,
      'confidence', 0,
      'requires_review', true,
      'summary', 'AI grading provider failed.',
      'criteria', jsonb_build_array(),
      'flags', jsonb_build_array('provider_failure')
    );

    update public.ai_grading_results
    set
      status = 'failed',
      ai_score = 0,
      ai_feedback = result_json->>'summary',
      ai_confidence = 0,
      rubric_scores = result_json->'criteria',
      structured_result = result_json,
      flags = result_json->'flags',
      requires_review = true,
      error_message = sqlerrm,
      input_tokens = ceil(length(coalesce(question_row.prompt, '') || ' ' || coalesce(answer_row.text_answer, '')) / 4.0),
      output_tokens = ceil(length(result_json::text) / 4.0),
      estimated_cost = 0,
      duration_ms = greatest(1, floor(extract(epoch from (clock_timestamp() - start_clock)) * 1000)::integer),
      updated_at = now()
    where id = created_job_id;
  end;

  insert into public.audit_log (institution_id, actor_id, actor_role, action, entity_type, entity_id, details)
  values (
    exam_row.institution_id,
    auth.uid(),
    actor_role,
    case when exists (select 1 from public.ai_grading_results r where r.id = created_job_id and r.status = 'failed') then 'ai_grading_job_failed' else 'ai_grading_job_created' end,
    'ai_grading_result',
    created_job_id,
    jsonb_build_object('answer_id', answer_row.id, 'provider', 'internal', 'model', 'rule-based-v1')
  );

  return query
  select
    r.id,
    r.status,
    r.ai_score,
    r.ai_max_score,
    r.ai_confidence,
    r.requires_review,
    r.structured_result
  from public.ai_grading_results r
  where r.id = created_job_id;
end;
$$;
