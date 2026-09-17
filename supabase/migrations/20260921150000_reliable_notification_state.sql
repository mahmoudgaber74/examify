/*
  Forward-only notification processing state.
  Historical rows are intentionally not enqueued for provider delivery.
*/

ALTER TABLE public.result_publication_events
  ADD COLUMN IF NOT EXISTS processing_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS attempt_count integer NOT NULL DEFAULT 0;

/* `created` is retained for compatibility with events written by the previous
   browser-triggered processor. It is not a retryable state. */
ALTER TABLE public.result_publication_events
  DROP CONSTRAINT IF EXISTS result_publication_events_status_check;
ALTER TABLE public.result_publication_events
  ADD CONSTRAINT result_publication_events_status_check
  CHECK (status IN ('pending', 'processing', 'processed', 'failed', 'created'));

ALTER TABLE public.result_publication_events
  DROP CONSTRAINT IF EXISTS result_publication_events_attempt_count_check;
ALTER TABLE public.result_publication_events
  ADD CONSTRAINT result_publication_events_attempt_count_check
  CHECK (attempt_count >= 0);

ALTER TABLE public.parent_notifications
  ADD COLUMN IF NOT EXISTS whatsapp_status text NOT NULL DEFAULT 'skipped',
  ADD COLUMN IF NOT EXISTS whatsapp_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS whatsapp_provider_message_id text,
  ADD COLUMN IF NOT EXISTS whatsapp_last_error text,
  ADD COLUMN IF NOT EXISTS whatsapp_next_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS whatsapp_processing_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS whatsapp_sent_at timestamptz;

ALTER TABLE public.parent_notifications
  DROP CONSTRAINT IF EXISTS parent_notifications_whatsapp_status_check;
ALTER TABLE public.parent_notifications
  ADD CONSTRAINT parent_notifications_whatsapp_status_check
  CHECK (whatsapp_status IN ('pending', 'processing', 'sent', 'skipped', 'failed'));

ALTER TABLE public.parent_notifications
  DROP CONSTRAINT IF EXISTS parent_notifications_whatsapp_attempts_check;
ALTER TABLE public.parent_notifications
  ADD CONSTRAINT parent_notifications_whatsapp_attempts_check
  CHECK (whatsapp_attempts >= 0);

CREATE INDEX IF NOT EXISTS idx_result_publication_events_retry
  ON public.result_publication_events (status, next_attempt_at)
  WHERE status IN ('pending', 'failed');

CREATE INDEX IF NOT EXISTS idx_parent_notifications_whatsapp_retry
  ON public.parent_notifications (whatsapp_status, whatsapp_next_attempt_at)
  WHERE whatsapp_status IN ('pending', 'failed');
