/*
  First-party, consented marketing funnel events.
  Only an opaque client id and bounded event metadata are stored; no email,
  name, phone number, or authentication token is written to this table.
*/

CREATE TABLE IF NOT EXISTS public.marketing_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id text NOT NULL CHECK (char_length(client_id) BETWEEN 1 AND 80),
  event_name text NOT NULL CHECK (event_name IN (
    'page_view', 'signup_start', 'signup_step', 'signup_submit',
    'sign_up', 'signup_error', 'login', 'login_error', 'cta_click'
  )),
  page_path text NOT NULL DEFAULT '/' CHECK (char_length(page_path) BETWEEN 1 AND 500),
  parameters jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (octet_length(parameters::text) <= 8000),
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS marketing_events_occurred_at_idx ON public.marketing_events (occurred_at DESC);
CREATE INDEX IF NOT EXISTS marketing_events_event_name_idx ON public.marketing_events (event_name, occurred_at DESC);
CREATE INDEX IF NOT EXISTS marketing_events_client_id_idx ON public.marketing_events (client_id, occurred_at DESC);

ALTER TABLE public.marketing_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "marketing_events_public_insert" ON public.marketing_events;
CREATE POLICY "marketing_events_public_insert" ON public.marketing_events
  FOR INSERT TO anon, authenticated
  WITH CHECK (
    char_length(client_id) BETWEEN 1 AND 80
    AND char_length(page_path) BETWEEN 1 AND 500
    AND octet_length(parameters::text) <= 8000
  );

DROP POLICY IF EXISTS "marketing_events_super_admin_select" ON public.marketing_events;
CREATE POLICY "marketing_events_super_admin_select" ON public.marketing_events
  FOR SELECT TO authenticated
  USING (public.current_user_role() = 'super_admin');

GRANT INSERT ON TABLE public.marketing_events TO anon, authenticated;
GRANT SELECT ON TABLE public.marketing_events TO authenticated;
