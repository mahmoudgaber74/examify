-- Local storage bucket bootstrap only.
-- Storage RLS functions and policies live in migrations so they are repeatable
-- across local reset, development, and production deployment workflows.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  ('avatars', 'avatars', false, 2097152, ARRAY['image/png', 'image/jpeg', 'image/webp']),
  ('student-files', 'student-files', false, 10485760, ARRAY['image/png', 'image/jpeg', 'image/webp', 'application/pdf']),
  ('exam-sheets', 'exam-sheets', false, 20971520, ARRAY['image/png', 'image/jpeg', 'image/webp', 'application/pdf']),
  ('question-assets', 'question-assets', false, 10485760, ARRAY['image/png', 'image/jpeg', 'image/webp', 'application/pdf', 'audio/mpeg', 'audio/wav']),
  ('lms-content', 'lms-content', false, 52428800, ARRAY['image/png', 'image/jpeg', 'image/webp', 'application/pdf', 'video/mp4', 'audio/mpeg']),
  ('certificates', 'certificates', false, 5242880, ARRAY['application/pdf', 'image/png', 'image/jpeg']),
  ('institution-documents', 'institution-documents', false, 26214400, ARRAY['application/pdf', 'image/png', 'image/jpeg', 'image/webp']),
  ('public-assets', 'public-assets', false, 5242880, ARRAY['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'])
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;
