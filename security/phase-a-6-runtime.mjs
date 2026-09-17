import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const fixture = JSON.parse(fs.readFileSync('test-results/security-local-fixtures.json', 'utf8'));
const url = fixture.SECURITY_TEST_SUPABASE_URL;
const anonKey = fixture.SECURITY_TEST_SUPABASE_ANON_KEY;
const teacher = createClient(url, anonKey, { global: { headers: { Authorization: `Bearer ${fixture.SECURITY_TEST_TEACHER_A_TOKEN}` } }, auth: { persistSession: false } });
const examId = fixture.SECURITY_TEST_EXAM_A_ID;

async function source() {
  const { data, error } = await teacher.rpc('get_omr_eligible_exam_questions', { p_exam_id: examId });
  if (error) throw error;
  assert.ok(Array.isArray(data) && data.length > 0, 'fixture exam has no eligible OMR questions');
  const groups = new Map();
  for (const row of data) groups.set(row.exam_question_id, [...(groups.get(row.exam_question_id) ?? []), row]);
  const questions = [...groups.values()].sort((a, b) => a[0].question_ordinal - b[0].question_ordinal);
  const choices = new Set(questions.map((rows) => rows.length));
  assert.equal(choices.size, 1, 'fixture exam must have uniform options');
  const sectionId = questions[0][0].section_id;
  return { questions, choices: questions[0].length, sectionId };
}

function payload(graph, key, qr) {
  const questions = graph.questions.map((rows, index) => ({
    exam_question_id: rows[0].exam_question_id,
    question_id: rows[0].question_id,
    question_type: rows[0].question_type,
    points_snapshot: rows[0].points,
    omr_eligible: true,
    question_ordinal: index + 1,
    section_visual_index: 0,
    global_question_number: index + 1,
    section_question_number: index + 1,
    page_number: 1,
    sort_snapshot: rows[0].sort_order,
    normalized_x: 0.1,
    normalized_y: 0.2 + index * 0.05,
    normalized_width: 0.8,
    normalized_height: 0.03,
    options: rows.map((row, optionIndex) => ({
      option_id: row.option_id,
      option_label: row.option_label,
      canonical_option_ordinal: optionIndex + 1,
      visual_index: optionIndex,
      normalized_x: 0.1 + optionIndex * 0.18,
      normalized_y: 0.25 + index * 0.05,
      normalized_width: 0.1,
      normalized_height: 0.02,
    })),
  }));
  return {
    exam_id: examId, model_label: 'A', questions_count: questions.length, choices_count: graph.choices,
    include_student_id: true, include_student_name: true, include_qr: true, template_version: 1,
    qr_token: qr, generation_request_id: key, page_size: 'A4', page_orientation: 'portrait',
    generator_version: 'phase-a-v2', sections: [{ section_key: 'runtime-a6', title: 'Runtime A6', visual_index: 0,
      question_start_index: 1, question_count: questions.length, page_number: 1,
      normalized_x: 0.05, normalized_y: 0.1, normalized_width: 0.9, normalized_height: 0.8 }], questions,
  };
}

async function create(p) {
  const { data, error } = await teacher.rpc('create_exact_bubble_sheet_snapshot_idempotent', { p_snapshot: p });
  if (error) throw error;
  return data;
}

const graph = await source();
const concurrentKey = crypto.randomUUID();
const concurrent = await Promise.all([
  create(payload(graph, concurrentKey, crypto.randomUUID())),
  create(payload(graph, concurrentKey, crypto.randomUUID())),
]);
const { data: concurrentRows, error: concurrentError } = await teacher.from('bubble_sheets').select('id').eq('generation_request_id', concurrentKey);
if (concurrentError) throw concurrentError;
assert.equal(concurrentRows.length, 1, 'concurrent key created more than one snapshot');
assert.equal(concurrent[0].id, concurrent[1].id, 'concurrent callers did not resolve to one snapshot');
console.log(`PASS concurrent K1 callers=2 snapshot_count=${concurrentRows.length}`);

const k1 = crypto.randomUUID();
const v1 = await create(payload(graph, k1, crypto.randomUUID()));
const { data: v1Question, error: v1QuestionError } = await teacher.from('bubble_sheet_questions').select('id,points_snapshot').eq('bubble_sheet_id', v1.id).single();
if (v1QuestionError) throw v1QuestionError;
const { data: originalOptions, error: originalOptionsError } = await teacher.from('question_options').select('id,label,is_correct,sort_order').eq('question_id', graph.questions[0][0].question_id).order('sort_order').order('id');
if (originalOptionsError) throw originalOptionsError;
const changedOptions = originalOptions.map((option, index) => ({ label: index === 0 ? `${option.label} A6` : option.label, is_correct: option.is_correct }));
try {
  const { error: saveError } = await teacher.rpc('update_single_answer_question_options', { p_question_id: graph.questions[0][0].question_id, p_options: changedOptions });
  if (saveError) throw saveError;
  const graphV2 = await source();
  const k2 = crypto.randomUUID();
  const v2 = await create(payload(graphV2, k2, crypto.randomUUID()));
  const retryV2 = await create(payload(graphV2, k2, crypto.randomUUID()));
  const { data: v1After, error: v1AfterError } = await teacher.from('bubble_sheet_questions').select('points_snapshot').eq('bubble_sheet_id', v1.id).single();
  if (v1AfterError) throw v1AfterError;
  const { data: v1Option, error: v1OptionError } = await teacher.from('bubble_sheet_options').select('option_label').eq('bubble_sheet_question_id', v1Question.id).order('visual_index').limit(1).single();
  if (v1OptionError) throw v1OptionError;
  const { data: v2Question, error: v2QuestionError } = await teacher.from('bubble_sheet_questions').select('id,points_snapshot').eq('bubble_sheet_id', v2.id).single();
  if (v2QuestionError) throw v2QuestionError;
  const { data: v2Option, error: v2OptionError } = await teacher.from('bubble_sheet_options').select('option_label').eq('bubble_sheet_question_id', v2Question.id).order('visual_index').limit(1).single();
  if (v2OptionError) throw v2OptionError;
  assert.notEqual(v1.id, v2.id);
  assert.equal(v1Question.points_snapshot, v1After.points_snapshot);
  assert.notEqual(v1Option.option_label, v2Option.option_label);
  assert.equal(v2.id, retryV2.id);
  console.log(`PASS V1 immutable V2 regenerated retry_reused=true`);
} finally {
  await teacher.rpc('update_single_answer_question_options', { p_question_id: graph.questions[0][0].question_id, p_options: originalOptions.map((option) => ({ label: option.label, is_correct: option.is_correct })) });
}
console.log('PHASE_A6_RUNTIME_PASS');
