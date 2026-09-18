# Staging Deployment & Verification Checklist

## 1. Isolated staging configuration

- Create or select a separate Supabase staging project. Do not link this repository to Production while validating.
- Add only the public browser variables to Vercel:
  - `VITE_SUPABASE_URL`
  - `VITE_SUPABASE_ANON_KEY`
  - `VITE_GA_MEASUREMENT_ID`
  - `VITE_META_PIXEL_ID`
  - `VITE_TIKTOK_PIXEL_ID`
- Never add a Supabase `service_role` key or provider secret to Vercel browser environment variables.
- Add the staging site URL to Supabase Auth redirect URLs and verify email-confirmation links.
- Keep the staging site excluded from indexing until the public domain is ready.

## 2. Database and Edge Functions

- Link the Supabase CLI to the staging project only after checking the project reference.
- Run the migrations and verify the final migration list, including:
  - `20260913110000_enable_self_service_institution_signup.sql`
  - `20260913120000_create_marketing_events.sql`
- Deploy Edge Functions with staging secrets only: AI grading, AI question generation, Tutor, OMR, WhatsApp, and result notifications.
- Verify RLS and cross-tenant isolation with two separate institution accounts.

## 3. Browser acceptance gates

- Public Landing Page opens without authentication and its institution/teacher CTAs reach the correct signup flow.
- Institution signup creates an active trial workspace.
- Teacher signup joins an institution and remains pending until approval.
- Consent banner gates GA4, Meta Pixel, TikTok Pixel, and first-party marketing event storage.
- Super admin can view the marketing funnel; other roles cannot read marketing events.
- Toasts, confirmations, errors, RTL layout, PDF exports, electronic exams, and OMR review work on desktop and mobile.

## 4. Observability and rollback

- Verify Vercel deployment logs, Supabase Auth logs, Edge Function logs, and browser console errors.
- Run one test conversion using a staging UTM URL and confirm the event appears in the funnel without storing PII.
- Capture the migration version and deployment URL in the release record.
- Keep the previous deployment available for rollback; do not remove local fixtures or migration history.

- OpenAI AI grading and Tutor end-to-end provider calls.
- Twilio WhatsApp delivery, retries, and provider failure handling.
- External OMR worker and real image-processing pipeline.
- Production-browser Tutor microphone/audio behavior.
- Deployed `Permissions-Policy` verification for camera/microphone.
- Deno Edge Function runtime validation.
- Python OMR environment and pytest execution.
- Cross-tenant verification against isolated staging fixtures.

Run these checks against an isolated staging Supabase project with rotated secrets, real role fixtures, and captured logs. External provider/runtime checks do not change local Phase 7/8 status.
