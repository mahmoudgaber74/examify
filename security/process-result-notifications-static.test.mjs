import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(new URL('../supabase/migrations/20260921160000_result_notification_processor_rpc.sql', import.meta.url), 'utf8');
const processor = readFileSync(new URL('../supabase/functions/process-result-notifications/index.ts', import.meta.url), 'utf8');

test('processor RPCs atomically claim, complete, and retry events', () => {
  assert.match(migration, /claim_result_publication_event\(p_event_id uuid\)/);
  assert.match(migration, /status = 'processing'/);
  assert.match(migration, /attempt_count = attempt_count \+ 1/);
  assert.match(migration, /processing_started_at < now\(\) - interval '10 minutes'/);
  assert.match(migration, /complete_result_publication_event/);
  assert.match(migration, /status = 'processed'/);
  assert.match(migration, /fail_result_publication_event/);
  assert.match(migration, /status = 'failed'/);
  assert.match(migration, /next_attempt_at = now\(\) \+ make_interval/);
});

test('processor is internal, bounded-batch capable, provider-disabled, and server-resolved', () => {
  assert.match(processor, /PROCESSOR_INTERNAL_TOKEN/);
  assert.match(processor, /keys\.length !== 1 \|\| keys\[0\] !== 'publication_event_id'/);
  assert.match(processor, /value\.batch === true/);
  assert.match(processor, /claim_result_publication_events_batch/);
  assert.match(processor, /p_limit: 25/);
  assert.match(processor, /claim_result_publication_event/);
  assert.match(processor, /parent_student_links/);
  assert.match(processor, /can_view_grades/);
  assert.match(processor, /can_receive_alerts/);
  assert.match(processor, /provider_disabled/);
  assert.match(processor, /whatsapp_status: 'skipped'/);
  assert.match(processor, /ownership_lost/);
  assert.match(processor, /persistence_errors/);
  assert.match(processor, /completeError/);
  assert.match(processor, /failError/);
  assert.match(processor, /rpcReturnedRow\(completedData\)/);
  assert.match(processor, /rpcReturnedRow\(failedData\)/);
  assert.doesNotMatch(processor, /TWILIO|whatsapp-notification|fetch\s*\(/i);
});

test('processor RPCs are not executable by browser roles', () => {
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.claim_result_publication_event\(uuid\) FROM PUBLIC, anon, authenticated/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.claim_result_publication_event\(uuid\) TO service_role/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.complete_result_publication_event\(uuid\) TO service_role/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.fail_result_publication_event\(uuid, text, integer\) TO service_role/);
});
