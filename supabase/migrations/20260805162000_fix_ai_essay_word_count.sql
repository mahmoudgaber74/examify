create or replace function public.ai_grade_answer_internal(
  p_question_type text,
  p_question_prompt text,
  p_student_answer text,
  p_model_answer text,
  p_max_points numeric,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
stable
as $$
declare
  v_answer text := coalesce(p_student_answer, '');
  v_model text := coalesce(p_model_answer, '');
  v_normalized_answer text := public.ai_normalize_text(v_answer);
  v_normalized_model text := public.ai_normalize_text(v_model);
  v_points numeric := 0;
  v_confidence numeric := 0.55;
  v_summary text := 'Internal grading estimate requires human review.';
  v_flags text[] := array[]::text[];
  v_criteria jsonb := '[]'::jsonb;
  v_words integer := 0;
  v_overlap integer := 0;
  v_model_words text[];
  v_word text;
  v_criterion jsonb;
  v_criterion_name text;
  v_criterion_max numeric;
  v_criterion_awarded numeric;
  v_rubric jsonb;
begin
  if coalesce((p_metadata->>'force_ai_failure')::boolean, false) then
    raise exception 'ai_provider_unavailable';
  end if;

  if p_question_type not in ('short_answer', 'essay') then
    raise exception 'ai_grading_question_type_not_supported';
  end if;

  if length(trim(v_answer)) = 0 then
    v_flags := array_append(v_flags, 'empty_answer');
    return jsonb_build_object(
      'awarded_points', 0,
      'max_points', p_max_points,
      'confidence', 0.98,
      'requires_review', true,
      'summary', 'Empty answer requires human review.',
      'criteria', jsonb_build_array(jsonb_build_object('name', 'content', 'awarded', 0, 'max', p_max_points, 'comment', 'empty answer')),
      'flags', to_jsonb(v_flags)
    );
  end if;

  if v_normalized_answer ~ '(ignore|system|developer|previous|instructions|prompt|override|jailbreak)' then
    v_flags := array_append(v_flags, 'prompt_injection');
  end if;

  if p_question_type = 'short_answer' then
    if v_normalized_model <> '' and v_normalized_answer = v_normalized_model then
      v_points := p_max_points;
      v_confidence := 0.95;
      v_summary := 'Answer matches the model answer.';
    elsif v_normalized_model <> '' and (position(v_normalized_model in v_normalized_answer) > 0 or position(v_normalized_answer in v_normalized_model) > 0) then
      v_points := round((p_max_points * 0.75)::numeric, 2);
      v_confidence := 0.78;
      v_summary := 'Answer is close to the model answer.';
    else
      v_model_words := regexp_split_to_array(v_normalized_model, '\s+');
      foreach v_word in array v_model_words loop
        if length(v_word) > 2 and position(v_word in v_normalized_answer) > 0 then
          v_overlap := v_overlap + 1;
        end if;
      end loop;
      if coalesce(array_length(v_model_words, 1), 0) > 0 then
        v_points := round((p_max_points * least(1, v_overlap::numeric / greatest(array_length(v_model_words, 1), 1)))::numeric, 2);
      end if;
      v_confidence := case when v_points >= p_max_points * 0.5 then 0.72 else 0.62 end;
      v_summary := 'Short answer estimated from model answer similarity.';
    end if;
    v_criteria := jsonb_build_array(jsonb_build_object('name', 'content', 'awarded', v_points, 'max', p_max_points, 'comment', v_summary));
  else
    v_words := coalesce(array_length(public.ai_text_words(v_answer), 1), 0);
    v_rubric := coalesce(p_metadata->'rubric'->'criteria', p_metadata->'rubric');
    if jsonb_typeof(v_rubric) <> 'array' then
      v_rubric := jsonb_build_array(
        jsonb_build_object('name', 'content', 'points', round((p_max_points * 0.45)::numeric, 2)),
        jsonb_build_object('name', 'reasoning', 'points', round((p_max_points * 0.35)::numeric, 2)),
        jsonb_build_object('name', 'clarity', 'points', round((p_max_points * 0.20)::numeric, 2))
      );
      v_flags := array_append(v_flags, 'default_rubric_used');
    end if;

    for v_criterion in select * from jsonb_array_elements(v_rubric) loop
      v_criterion_name := coalesce(v_criterion->>'name', 'criterion');
      v_criterion_max := coalesce(nullif(v_criterion->>'points', '')::numeric, nullif(v_criterion->>'max', '')::numeric, 1);
      v_criterion_awarded := case
        when v_words >= 120 then v_criterion_max
        when v_words >= 60 then round((v_criterion_max * 0.75)::numeric, 2)
        when v_words >= 25 then round((v_criterion_max * 0.45)::numeric, 2)
        else round((v_criterion_max * 0.2)::numeric, 2)
      end;
      v_points := v_points + v_criterion_awarded;
      v_criteria := v_criteria || jsonb_build_array(jsonb_build_object(
        'name', v_criterion_name,
        'awarded', v_criterion_awarded,
        'max', v_criterion_max,
        'comment', 'rubric estimate'
      ));
    end loop;

    v_points := least(p_max_points, round(v_points::numeric, 2));
    v_confidence := case when v_words >= 60 then 0.74 else 0.58 end;
    v_summary := 'Essay answer estimated from rubric and response length.';
  end if;

  if v_confidence < 0.7 then
    v_flags := array_append(v_flags, 'low_confidence');
  end if;

  return jsonb_build_object(
    'awarded_points', least(p_max_points, greatest(0, v_points)),
    'max_points', p_max_points,
    'confidence', v_confidence,
    'requires_review', v_confidence < 0.7 or array_length(v_flags, 1) is not null,
    'summary', v_summary,
    'criteria', v_criteria,
    'flags', to_jsonb(v_flags)
  );
end;
$$;
