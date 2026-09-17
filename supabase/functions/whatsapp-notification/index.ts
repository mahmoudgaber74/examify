import { createClient } from 'npm:@supabase/supabase-js@2';

const allowedOrigins = (Deno.env.get('ALLOWED_ORIGINS') ?? '').split(',').map((v) => v.trim()).filter(Boolean);
const rate = new Map<string, { count: number; reset: number }>();
const roles = new Set(['super_admin', 'school_admin', 'teacher', 'grader', 'data_entry']);
const types = new Set(['grade_posted', 'absence_alert', 'low_score', 'announcement', 'attendance_summary']);
function headers(req: Request) { const origin = req.headers.get('Origin'); const devOrigin = origin && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin) ? origin : ''; const allowed = origin && (allowedOrigins.includes(origin) || devOrigin) ? origin : (allowedOrigins[0] ?? ''); return { 'Access-Control-Allow-Origin': allowed, Vary: 'Origin', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey' }; }
function json(req: Request, body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers: { ...headers(req), 'Content-Type': 'application/json' } }); }
function limited(key: string) { const now = Date.now(); const item = rate.get(key); if (!item || item.reset < now) { rate.set(key, { count: 1, reset: now + 60_000 }); return false; } item.count++; return item.count > 20; }
function uuid(value: unknown): value is string { return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value); }
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: headers(req) });
  if (req.method !== 'POST') return json(req, { error: 'Method not allowed' }, 405);
  const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return json(req, { error: 'Authentication required' }, 401);
  try {
    const supabase = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
    const { data: auth, error: authError } = await supabase.auth.getUser(token);
    if (authError || !auth.user) return json(req, { error: 'Authentication failed' }, 401);
    if (limited(auth.user.id)) return json(req, { error: 'Rate limit exceeded' }, 429);
    const { data: staff } = await supabase.from('staff_profiles').select('institution_id, role, is_active').eq('user_id', auth.user.id).maybeSingle();
    if (!staff?.is_active || !roles.has(staff.role)) return json(req, { error: 'Not authorized' }, 403);
    const body = await req.json();
    if (body && uuid(body.publication_event_id)) {
      return await deliverPublicationEvent(req, supabase, staff, body.publication_event_id);
    }
    if (!body || !uuid(body.student_id) || !types.has(body.type) || typeof body.title !== 'string' || typeof body.body !== 'string' || body.title.length < 1 || body.title.length > 200 || body.body.length < 1 || body.body.length > 4000) return json(req, { error: 'Invalid request' }, 400);
    const { data: student } = await supabase.from('student_profiles').select('id, institution_id').eq('id', body.student_id).eq('institution_id', staff.institution_id).eq('is_active', true).maybeSingle();
    if (!student) return json(req, { error: 'Student not found' }, 404);
    const { data: links, error: linksError } = await supabase.from('parent_student_links').select('parent_id').eq('student_id', student.id).eq('institution_id', staff.institution_id).eq('can_receive_alerts', true);
    if (linksError) throw linksError;
    const parentIds = (links ?? []).map((l) => l.parent_id);
    if (!parentIds.length) return json(req, { sent: 0, whatsapp: false });
    const rows = parentIds.map((parent_id) => ({ institution_id: staff.institution_id, parent_id, student_id: student.id, type: body.type, title: body.title, body: body.body, data: typeof body.data === 'object' && body.data && !Array.isArray(body.data) ? body.data : {}, is_read: false, sent_via_whatsapp: false }));
    const { data: inserted, error: insertError } = await supabase.from('parent_notifications').insert(rows).select('id, parent_id');
    if (insertError) throw insertError;
    const accountSid = Deno.env.get('TWILIO_ACCOUNT_SID');
    const authToken = Deno.env.get('TWILIO_AUTH_TOKEN');
    let whatsapp = false;
    if (accountSid && authToken && inserted?.length) {
      const { data: parents } = await supabase.from('parent_profiles').select('id, phone').in('id', parentIds).eq('institution_id', staff.institution_id);
      for (const parent of parents ?? []) {
        if (!parent.phone) continue;
        try {
          await sendWhatsApp(parent.phone, body.title, body.body, accountSid, authToken);
          const notification = inserted.find((item) => item.parent_id === parent.id);
          if (notification) await supabase.from('parent_notifications').update({ sent_via_whatsapp: true }).eq('id', notification.id);
          whatsapp = true;
        } catch { /* retain in-app notification when provider delivery fails */ }
      }
    }
    return json(req, { sent: inserted?.length ?? 0, whatsapp });
  } catch { return json(req, { error: 'Request could not be processed' }, 500); }
});

async function deliverPublicationEvent(req: Request, supabase: ReturnType<typeof createClient>, staff: { institution_id: string; role: string; is_active: boolean }, eventId: string) {
  const { data: event, error: eventError } = await supabase
    .from('result_publication_events')
    .select('id, attempt_id, institution_id, exam_attempts!inner(student_id, score, score_percentage, examify_exams!inner(title))')
    .eq('id', eventId)
    .eq('institution_id', staff.institution_id)
    .maybeSingle();
  if (eventError) throw eventError;
  if (!event) return json(req, { error: 'Publication event not found' }, 404);

  const attempt = Array.isArray(event.exam_attempts) ? event.exam_attempts[0] : event.exam_attempts;
  if (!attempt?.student_id) return json(req, { error: 'Publication event is incomplete' }, 409);
  const { data: links, error: linksError } = await supabase.from('parent_student_links').select('parent_id').eq('student_id', attempt.student_id).eq('institution_id', staff.institution_id).eq('can_receive_alerts', true);
  if (linksError) throw linksError;
  const parentIds = (links ?? []).map((link) => link.parent_id);
  if (!parentIds.length) {
    await supabase.from('result_publication_events').update({ status: 'created', processed_at: new Date().toISOString() }).eq('id', event.id);
    return json(req, { event_id: event.id, sent: 0, whatsapp: false });
  }
  const title = 'Exam result published';
  const message = `The final result for ${attempt.examify_exams?.title ?? 'the exam'} is ${attempt.score ?? 'unavailable'} (${attempt.score_percentage ?? 'unavailable'}%).`;
  const rows = parentIds.map((parent_id) => ({
    institution_id: staff.institution_id,
    parent_id,
    student_id: attempt.student_id,
    type: 'grade_posted',
    title,
    body: message,
    data: { exam_attempt_id: event.attempt_id, publication_event_id: event.id, score: attempt.score, score_percentage: attempt.score_percentage },
    dedupe_key: `grade_posted:${event.attempt_id}:${parent_id}`,
    is_read: false,
    sent_via_whatsapp: false,
  }));
  const { error: insertError } = await supabase.from('parent_notifications').upsert(rows, { onConflict: 'institution_id,dedupe_key', ignoreDuplicates: true });
  if (insertError) throw insertError;
  const { data: notifications } = await supabase.from('parent_notifications').select('id, parent_id').in('dedupe_key', rows.map((row) => row.dedupe_key)).eq('institution_id', staff.institution_id);
  const accountSid = Deno.env.get('TWILIO_ACCOUNT_SID');
  const authToken = Deno.env.get('TWILIO_AUTH_TOKEN');
  let whatsapp = false;
  if (accountSid && authToken) {
    const { data: parents } = await supabase.from('parent_profiles').select('id, phone').in('id', parentIds).eq('institution_id', staff.institution_id);
    for (const parent of parents ?? []) {
      if (!parent.phone) continue;
      try {
        await sendWhatsApp(parent.phone, title, message, accountSid, authToken);
        const notification = (notifications ?? []).find((item) => item.parent_id === parent.id);
        if (notification) await supabase.from('parent_notifications').update({ sent_via_whatsapp: true, whatsapp_error: null }).eq('id', notification.id);
        whatsapp = true;
      } catch (error) {
        const notification = (notifications ?? []).find((item) => item.parent_id === parent.id);
        if (notification) await supabase.from('parent_notifications').update({ whatsapp_error: error instanceof Error ? error.message.slice(0, 500) : 'provider_failure' }).eq('id', notification.id);
      }
    }
  }
  await supabase.from('result_publication_events').update({ status: 'created', processed_at: new Date().toISOString(), last_error: null }).eq('id', event.id);
  return json(req, { event_id: event.id, sent: notifications?.length ?? 0, whatsapp });
}

async function sendWhatsApp(phone: string, title: string, body: string, accountSid: string, authToken: string) {
  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${btoa(`${accountSid}:${authToken}`)}` }, body: new URLSearchParams({ From: Deno.env.get('TWILIO_WHATSAPP_FROM') ?? 'whatsapp:+14155238886', To: `whatsapp:${phone}`, Body: `*${title}*\n\n${body}` }) });
  if (!response.ok) throw new Error('provider_failure');
}
