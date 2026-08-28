import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

interface NotificationRequest {
  parent_id?: string;
  student_id?: string;
  institution_id: string;
  type: 'grade_posted' | 'absence_alert' | 'low_score' | 'announcement' | 'attendance_summary';
  title: string;
  body: string;
  data?: Record<string, any>;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const body: NotificationRequest = await req.json();

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Find parent(s) linked to this student
    let parentIds: string[] = [];

    if (body.parent_id) {
      parentIds = [body.parent_id];
    } else if (body.student_id) {
      const { data: links } = await supabase
        .from('parent_student_links')
        .select('parent_id')
        .eq('student_id', body.student_id)
        .eq('can_receive_alerts', true);
      parentIds = ((links as any[]) ?? []).map((l) => l.parent_id);
    }

    if (parentIds.length === 0) {
      return new Response(JSON.stringify({ message: 'No parents linked' }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Insert notification records
    const notifRows = parentIds.map((pid) => ({
      institution_id: body.institution_id,
      parent_id: pid,
      student_id: body.student_id ?? null,
      type: body.type,
      title: body.title,
      body: body.body,
      data: body.data ?? {},
      is_read: false,
      sent_via_whatsapp: false,
    }));

    const { data: inserted, error: insertErr } = await supabase
      .from('parent_notifications')
      .insert(notifRows)
      .select('id, parent_id');

    if (insertErr) throw insertErr;

    // Try to send via WhatsApp if API key is configured
    const whatsappKey = Deno.env.get('WHATSAPP_API_KEY') ?? Deno.env.get('TWILIO_AUTH_TOKEN');

    if (whatsappKey) {
      // Get parent phone numbers
      const { data: parents } = await supabase
        .from('parent_profiles')
        .select('id, phone')
        .in('id', parentIds);

      for (const parent of (parents as any[]) ?? []) {
        if (parent.phone) {
          try {
            await sendWhatsApp(parent.phone, body.title, body.body, whatsappKey);
            await supabase.from('parent_notifications')
              .update({ sent_via_whatsapp: true })
              .eq('parent_id', parent.id);
          } catch {
            // WhatsApp send failed — notification still saved in-app
          }
        }
      }
    }

    return new Response(JSON.stringify({ sent: inserted?.length ?? 0, whatsapp: !!whatsappKey }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

async function sendWhatsApp(phone: string, title: string, body: string, apiKey: string) {
  // Placeholder for WhatsApp Business API or Twilio integration
  // When a key is configured, this will send the message
  const message = `*${title}*\n\n${body}`;

  const response = await fetch('https://api.twilio.com/2010-04-01/Accounts/' + apiKey + '/Messages.json', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': 'Basic ' + btoa(apiKey + ':' + (Deno.env.get('TWILIO_ACCOUNT_SID') ?? '')),
    },
    body: new URLSearchParams({
      From: 'whatsapp:+14155238886',
      To: `whatsapp:${phone}`,
      Body: message,
    }),
  });

  if (!response.ok) throw new Error('WhatsApp send failed');
}
