/* Phase 3: preserve legacy rows in an isolated tenant, then make tenancy mandatory. */
BEGIN;

INSERT INTO public.institutions (id, name, name_en, subscription_plan, subscription_status, is_active)
VALUES ('00000000-0000-0000-0000-000000000001', 'System / Legacy', 'System / Legacy', 'free', 'active', false)
ON CONFLICT (id) DO NOTHING;

/* These tables were created before tenant ownership existed. Preserve their rows,
   but make them inaccessible to normal institution users through the isolated tenant. */
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS institution_id uuid REFERENCES public.institutions(id) ON DELETE RESTRICT;
ALTER TABLE public.exams ADD COLUMN IF NOT EXISTS institution_id uuid REFERENCES public.institutions(id) ON DELETE RESTRICT;
ALTER TABLE public.courses ADD COLUMN IF NOT EXISTS institution_id uuid REFERENCES public.institutions(id) ON DELETE RESTRICT;
ALTER TABLE public.certificates ADD COLUMN IF NOT EXISTS institution_id uuid REFERENCES public.institutions(id) ON DELETE RESTRICT;
ALTER TABLE public.submissions ADD COLUMN IF NOT EXISTS institution_id uuid REFERENCES public.institutions(id) ON DELETE RESTRICT;
ALTER TABLE public.chat_messages ADD COLUMN IF NOT EXISTS institution_id uuid REFERENCES public.institutions(id) ON DELETE RESTRICT;
ALTER TABLE public.cart_items ADD COLUMN IF NOT EXISTS institution_id uuid REFERENCES public.institutions(id) ON DELETE RESTRICT;
ALTER TABLE public.parents ADD COLUMN IF NOT EXISTS institution_id uuid REFERENCES public.institutions(id) ON DELETE RESTRICT;
ALTER TABLE public.parent_students ADD COLUMN IF NOT EXISTS institution_id uuid REFERENCES public.institutions(id) ON DELETE RESTRICT;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS institution_id uuid REFERENCES public.institutions(id) ON DELETE RESTRICT;
ALTER TABLE public.notification_preferences ADD COLUMN IF NOT EXISTS institution_id uuid REFERENCES public.institutions(id) ON DELETE RESTRICT;
ALTER TABLE public.audit_log ADD COLUMN IF NOT EXISTS institution_id uuid REFERENCES public.institutions(id) ON DELETE RESTRICT;
ALTER TABLE public.user_notifications ADD COLUMN IF NOT EXISTS institution_id uuid REFERENCES public.institutions(id) ON DELETE RESTRICT;
ALTER TABLE public.subject_teachers ADD COLUMN IF NOT EXISTS institution_id uuid REFERENCES public.institutions(id) ON DELETE RESTRICT;
ALTER TABLE public.class_students ADD COLUMN IF NOT EXISTS institution_id uuid REFERENCES public.institutions(id) ON DELETE RESTRICT;
ALTER TABLE public.lesson_progress ADD COLUMN IF NOT EXISTS institution_id uuid REFERENCES public.institutions(id) ON DELETE RESTRICT;

UPDATE public.students SET institution_id = '00000000-0000-0000-0000-000000000001' WHERE institution_id IS NULL;
UPDATE public.exams SET institution_id = '00000000-0000-0000-0000-000000000001' WHERE institution_id IS NULL;
UPDATE public.courses SET institution_id = '00000000-0000-0000-0000-000000000001' WHERE institution_id IS NULL;
UPDATE public.certificates SET institution_id = '00000000-0000-0000-0000-000000000001' WHERE institution_id IS NULL;
UPDATE public.submissions SET institution_id = '00000000-0000-0000-0000-000000000001' WHERE institution_id IS NULL;
UPDATE public.chat_messages SET institution_id = '00000000-0000-0000-0000-000000000001' WHERE institution_id IS NULL;
UPDATE public.cart_items SET institution_id = '00000000-0000-0000-0000-000000000001' WHERE institution_id IS NULL;
UPDATE public.parents SET institution_id = '00000000-0000-0000-0000-000000000001' WHERE institution_id IS NULL;
UPDATE public.parent_students SET institution_id = '00000000-0000-0000-0000-000000000001' WHERE institution_id IS NULL;
UPDATE public.notifications SET institution_id = '00000000-0000-0000-0000-000000000001' WHERE institution_id IS NULL;
UPDATE public.notification_preferences SET institution_id = '00000000-0000-0000-0000-000000000001' WHERE institution_id IS NULL;
UPDATE public.audit_log SET institution_id = '00000000-0000-0000-0000-000000000001' WHERE institution_id IS NULL;
UPDATE public.user_notifications SET institution_id = '00000000-0000-0000-0000-000000000001' WHERE institution_id IS NULL;
UPDATE public.subject_teachers SET institution_id = '00000000-0000-0000-0000-000000000001' WHERE institution_id IS NULL;
UPDATE public.class_students SET institution_id = '00000000-0000-0000-0000-000000000001' WHERE institution_id IS NULL;
UPDATE public.lesson_progress SET institution_id = '00000000-0000-0000-0000-000000000001' WHERE institution_id IS NULL;

ALTER TABLE public.students ALTER COLUMN institution_id SET NOT NULL;
ALTER TABLE public.exams ALTER COLUMN institution_id SET NOT NULL;
ALTER TABLE public.courses ALTER COLUMN institution_id SET NOT NULL;
ALTER TABLE public.certificates ALTER COLUMN institution_id SET NOT NULL;
ALTER TABLE public.submissions ALTER COLUMN institution_id SET NOT NULL;
ALTER TABLE public.chat_messages ALTER COLUMN institution_id SET NOT NULL;
ALTER TABLE public.cart_items ALTER COLUMN institution_id SET NOT NULL;
ALTER TABLE public.parents ALTER COLUMN institution_id SET NOT NULL;
ALTER TABLE public.parent_students ALTER COLUMN institution_id SET NOT NULL;
ALTER TABLE public.notifications ALTER COLUMN institution_id SET NOT NULL;
ALTER TABLE public.notification_preferences ALTER COLUMN institution_id SET NOT NULL;
ALTER TABLE public.audit_log ALTER COLUMN institution_id SET NOT NULL;
ALTER TABLE public.user_notifications ALTER COLUMN institution_id SET NOT NULL;
ALTER TABLE public.subject_teachers ALTER COLUMN institution_id SET NOT NULL;
ALTER TABLE public.class_students ALTER COLUMN institution_id SET NOT NULL;
ALTER TABLE public.lesson_progress ALTER COLUMN institution_id SET NOT NULL;

COMMIT;
