import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const authorization = request.headers.get('Authorization');
    if (!authorization) return json({ error: 'authorization_required' }, 401);
    const client = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_ANON_KEY') ?? '', { global: { headers: { Authorization: authorization } } });
    const { data: { user }, error: userError } = await client.auth.getUser();
    if (userError || !user) return json({ error: 'unauthorized' }, 401);
    const input = await request.json() as { omr_result_id?: string; template_version?: number; questions_count?: number; choices_count?: number; columns?: number; template_id?: string };
    if (!input.omr_result_id || !input.template_version || !input.questions_count || !input.choices_count) return json({ error: 'invalid_omr_request' }, 400);
    const { data: result, error: resultError } = await client.from('omr_results').select('id, bubble_sheet_id, original_storage_path').eq('id', input.omr_result_id).single();
    if (resultError || !result || !result.original_storage_path) return json({ error: 'omr_result_not_found_or_forbidden' }, 404);
    const requestId = crypto.randomUUID();
    const { data: job, error: jobError } = await client.rpc('enqueue_omr_processing_job', {
      p_scan_id: result.id, p_template_id: input.template_id ?? result.bubble_sheet_id, p_request_id: requestId,
      p_engine: 'opencv', p_engine_version: '0.1.0', p_max_attempts: 3,
    });
    if (jobError || !job) return json({ error: jobError?.message ?? 'omr_job_create_failed' }, 400);
    const row = job as { id: string; status: string; request_id: string };
    return json({ job_id: row.id, job_status: row.status, request_id: row.request_id, queued: true });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'omr_job_enqueue_failed' }, 400);
  }
});
