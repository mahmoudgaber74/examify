import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const origins = (Deno.env.get('ALLOWED_ORIGINS') ?? '').split(',').map((v) => v.trim()).filter(Boolean);
const allowedOrigins = [...new Set([...origins, 'https://examifylugano.vercel.app'])];
const cors = (request: Request) => { const origin = request.headers.get('Origin'); const dev = origin && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin); return { 'Access-Control-Allow-Origin': origin && (allowedOrigins.includes(origin) || dev) ? origin : (allowedOrigins[0] ?? ''), Vary: 'Origin', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }; };
const json = (request: Request, value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { ...cors(request), 'Content-Type': 'application/json' } });
const REVIEW_CONFIDENCE_THRESHOLD = 0.75;
type VisionQuestion = { question_number?: number; detected_option?: string | null; confidence?: number; status?: string; needs_manual_review?: boolean; fill_scores?: Record<string, number> };

function reviewReason(question: VisionQuestion) {
  const status = (question.status ?? '').toLowerCase();
  if (question.needs_manual_review || ['multiple_marks', 'multiple', 'ambiguous'].includes(status)) return 'multiple_marks';
  if (['blank', 'no_mark', 'empty'].includes(status)) return 'no_mark_detected';
  if (['unreadable', 'invalid'].includes(status)) return 'unreadable_mark';
  if (Number(question.confidence ?? 0) < REVIEW_CONFIDENCE_THRESHOLD) return 'low_confidence';
  return null;
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(request) });
  if (request.method !== 'POST') return json(request, { error: 'method_not_allowed' }, 405);
  try {
    const authorization = request.headers.get('Authorization');
    if (!authorization) return json(request, { error: 'authorization_required' }, 401);
    const client = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_ANON_KEY') ?? '', { global: { headers: { Authorization: authorization } } });
    const { data: { user }, error: userError } = await client.auth.getUser();
    if (userError || !user) return json(request, { error: 'unauthorized' }, 401);
    const input = await request.json() as { omr_result_id?: string; template_version?: number; questions_count?: number; choices_count?: number; columns?: number; template_id?: string; questions?: VisionQuestion[] };
    if (!input.omr_result_id || !input.template_version || !input.questions_count || !input.choices_count) return json(request, { error: 'invalid_omr_request' }, 400);
    const { data: result, error: resultError } = await client.from('omr_results').select('id, bubble_sheet_id, original_storage_path').eq('id', input.omr_result_id).single();
    if (resultError || !result || !result.original_storage_path) return json(request, { error: 'omr_result_not_found_or_forbidden' }, 404);
    const requestId = crypto.randomUUID();
    const { data: job, error: jobError } = await client.rpc('enqueue_omr_processing_job', {
      p_scan_id: result.id, p_template_id: input.template_id ?? result.bubble_sheet_id, p_request_id: requestId,
      p_engine: 'opencv', p_engine_version: '0.1.0', p_max_attempts: 3,
    });
    if (jobError || !job) return json(request, { error: 'omr_job_create_failed' }, 400);
    const row = job as { id: string; status: string; request_id: string };
    // The normal path is asynchronous: the worker supplies `questions` to the
    // completion RPC. This normalization is also used by synchronous vision
    // adapters and makes ambiguity explicit instead of converting it to zero.
    const reviewReasons = (input.questions ?? []).map(reviewReason).filter((reason): reason is string => Boolean(reason));
    return json(request, {
      job_id: row.id, job_status: row.status, request_id: row.request_id, queued: true,
      review_required: reviewReasons.length > 0,
      review_reasons: [...new Set(reviewReasons)],
      review_confidence_threshold: REVIEW_CONFIDENCE_THRESHOLD,
    });
  } catch {
    return json(request, { error: 'omr_job_enqueue_failed' }, 400);
  }
});
