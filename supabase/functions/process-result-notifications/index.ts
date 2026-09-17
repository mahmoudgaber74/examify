import { createClient } from 'npm:@supabase/supabase-js@2';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type ClaimedEvent = {
  id: string;
  attempt_id: string;
  institution_id: string;
  status: string;
  processing_claim_token: string;
};

type NotificationRow = {
  id: string;
  parent_id: string;
  student_id: string | null;
  institution_id: string;
  data: Record<string, unknown> | null;
  dedupe_key: string | null;
  whatsapp_status: string | null;
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function isAuthorized(request: Request) {
  const expected = Deno.env.get('PROCESSOR_INTERNAL_TOKEN');
  const supplied = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
  return Boolean(expected && supplied && supplied === expected);
}

function eventIdFromBody(body: unknown) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const keys = Object.keys(body as Record<string, unknown>);
  if (keys.length !== 1 || keys[0] !== 'publication_event_id') return null;
  const eventId = (body as Record<string, unknown>).publication_event_id;
  return typeof eventId === 'string' && UUID_PATTERN.test(eventId) ? eventId : null;
}

function isBatchBody(body: unknown) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return false;
  const value = body as Record<string, unknown>;
  return Object.keys(value).length === 1 && value.batch === true;
}

function rpcReturnedRow(data: unknown) {
  return Array.isArray(data) ? data.length > 0 : Boolean(data);
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json({ error: 'POST required' }, 405);
  if (!isAuthorized(request)) return json({ error: 'Internal authorization required' }, 401);

  const serviceUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!serviceUrl || !serviceKey) return json({ error: 'Processor unavailable' }, 503);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid request' }, 400);
  }
  const eventId = eventIdFromBody(body);
  const batchMode = isBatchBody(body);
  if (!eventId && !batchMode) return json({ error: 'publication_event_id or batch required' }, 400);

  const supabase = createClient(serviceUrl, serviceKey);
  let claimedEvents: ClaimedEvent[];
  if (batchMode) {
    const { data, error } = await supabase.rpc('claim_result_publication_events_batch', { p_limit: 25 });
    if (error) return json({ error: 'Event batch claim failed' }, 500);
    claimedEvents = (data ?? []) as ClaimedEvent[];
  } else {
    const { data, error } = await supabase.rpc('claim_result_publication_event', { p_event_id: eventId });
    if (error) return json({ error: 'Event claim failed' }, 500);
    const claimed = (Array.isArray(data) ? data[0] : data) as ClaimedEvent | null;
    claimedEvents = claimed ? [claimed] : [];
  }

  if (!claimedEvents.length) {
    return batchMode
      ? json({ batch: true, claimed: 0, processed: 0, failed: 0 })
      : json({ event_id: eventId, status: 'not_claimed' });
  }

  let processed = 0;
  let failed = 0;
  let ownershipLost = 0;
  let persistenceErrors = 0;
  for (const claimed of claimedEvents) {
    try {
      const { data: attempt, error: attemptError } = await supabase
        .from('exam_attempts')
        .select('student_id')
        .eq('id', claimed.attempt_id)
        .maybeSingle();
      if (attemptError || !attempt?.student_id) throw new Error('attempt_lookup_failed');

      const { data: notifications, error: notificationsError } = await supabase
        .from('parent_notifications')
        .select('id, parent_id, student_id, institution_id, data, dedupe_key, whatsapp_status')
        .eq('student_id', attempt.student_id);
      if (notificationsError) throw new Error('notification_lookup_failed');

      const eventNotifications = ((notifications ?? []) as NotificationRow[]).filter((notification) => {
        const data = notification.data ?? {};
        return data.attempt_id === claimed.attempt_id
          || data.exam_attempt_id === claimed.attempt_id
          || notification.dedupe_key === `grade_posted:${claimed.attempt_id}:${notification.parent_id}`;
      });

      for (const notification of eventNotifications) {
        if (notification.whatsapp_status === 'sent') continue;

        let reason = 'provider_disabled';
        const { data: parent, error: parentError } = await supabase
          .from('parent_profiles')
          .select('institution_id, is_active, phone')
          .eq('id', notification.parent_id)
          .maybeSingle();
        if (parentError || !parent) reason = 'parent_not_found';
        else if (notification.institution_id !== claimed.institution_id || parent.institution_id !== claimed.institution_id) reason = 'institution_mismatch';
        else {
          const { data: link, error: linkError } = await supabase
            .from('parent_student_links')
            .select('can_view_grades, can_receive_alerts')
            .eq('parent_id', notification.parent_id)
            .eq('student_id', attempt.student_id)
            .maybeSingle();
          if (linkError) reason = 'link_lookup_failed';
          else if (!link?.can_view_grades) reason = 'grades_disabled';
          else if (!parent.is_active) reason = 'inactive_parent';
          else if (!link.can_receive_alerts) reason = 'alerts_disabled';
          else if (!parent.phone) reason = 'missing_phone';
        }

        const { error: updateError } = await supabase
          .from('parent_notifications')
          .update({
            whatsapp_status: 'skipped',
            whatsapp_last_error: reason,
            whatsapp_processing_started_at: null,
            whatsapp_next_attempt_at: null,
          })
          .eq('id', notification.id)
          .neq('whatsapp_status', 'sent');
        if (updateError) throw new Error('notification_update_failed');
      }

      const { data: completedData, error: completeError } = await supabase.rpc('complete_result_publication_event', {
        p_event_id: claimed.id,
        p_claim_token: claimed.processing_claim_token,
      });
      if (completeError) throw new Error('event_completion_persistence_failed');
      if (!rpcReturnedRow(completedData)) {
        ownershipLost += 1;
        continue;
      }
      processed += 1;
    } catch {
      const { data: failedData, error: failError } = await supabase.rpc('fail_result_publication_event', {
        p_event_id: claimed.id,
        p_claim_token: claimed.processing_claim_token,
        p_error: 'processor_failure',
        p_retry_after_seconds: 300,
      });
      if (failError) persistenceErrors += 1;
      else if (!rpcReturnedRow(failedData)) ownershipLost += 1;
      else failed += 1;
    }
  }

  return batchMode
    ? json({ batch: true, claimed: claimedEvents.length, processed, failed, ownership_lost: ownershipLost, persistence_errors: persistenceErrors, provider: 'disabled' }, persistenceErrors > 0 ? 500 : ownershipLost > 0 ? 409 : 200)
    : processed === 1
      ? json({ event_id: claimedEvents[0].id, status: 'processed', provider: 'disabled' })
      : ownershipLost > 0
        ? json({ error: 'Event lease ownership lost', event_id: claimedEvents[0].id }, 409)
        : persistenceErrors > 0
          ? json({ error: 'Processor persistence failed', event_id: claimedEvents[0].id }, 500)
          : json({ error: 'Processor failed', event_id: claimedEvents[0].id }, 500);
});
