-- Phase 6.1: retain trusted audio metadata and the provider transcript separately.
ALTER TABLE public.tutor_messages
  ADD COLUMN IF NOT EXISTS attachment_mime_type varchar(100),
  ADD COLUMN IF NOT EXISTS audio_transcript text;

ALTER TABLE public.tutor_messages
  DROP CONSTRAINT IF EXISTS tutor_messages_attachment_mime_type_check;
ALTER TABLE public.tutor_messages
  ADD CONSTRAINT tutor_messages_attachment_mime_type_check
  CHECK (attachment_mime_type IS NULL OR attachment_mime_type IN (
    'image/jpeg', 'image/png', 'image/webp',
    'audio/webm', 'audio/webm;codecs=opus', 'audio/ogg', 'audio/ogg;codecs=opus', 'audio/mp4', 'audio/mpeg'
  ));

UPDATE storage.buckets
SET allowed_mime_types = ARRAY[
  'image/jpeg', 'image/png', 'image/webp',
  'audio/webm', 'audio/webm;codecs=opus', 'audio/mpeg', 'audio/ogg', 'audio/ogg;codecs=opus', 'audio/mp4'
]
WHERE id = 'tutor_attachments';

COMMENT ON COLUMN public.tutor_messages.attachment_url IS 'Private Storage path only; never a public URL.';
COMMENT ON COLUMN public.tutor_messages.audio_transcript IS 'Provider transcript of the original audio attachment; the attachment is retained.';
