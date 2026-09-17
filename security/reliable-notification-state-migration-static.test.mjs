import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(new URL('../supabase/migrations/20260921150000_reliable_notification_state.sql', import.meta.url), 'utf8');
const baseSchema = readFileSync(new URL('../supabase/migrations/20260728234158_20260728100000_create_lms_sis_parents_tables.sql.sql', import.meta.url), 'utf8');

test('notification state migration adds safe event and delivery lifecycles', () => {
  assert.match(migration, /processing_started_at timestamptz/);
  assert.match(migration, /next_attempt_at timestamptz/);
  assert.match(migration, /attempt_count integer NOT NULL DEFAULT 0/);
  assert.match(migration, /status IN \('pending', 'processing', 'processed', 'failed', 'created'\)/);
  assert.match(migration, /attempt_count >= 0/);
  assert.match(migration, /whatsapp_status text NOT NULL DEFAULT 'skipped'/);
  assert.match(migration, /whatsapp_attempts integer NOT NULL DEFAULT 0/);
  assert.match(migration, /whatsapp_provider_message_id text/);
  assert.match(migration, /whatsapp_last_error text/);
  assert.match(migration, /whatsapp_next_attempt_at timestamptz/);
  assert.match(migration, /whatsapp_processing_started_at timestamptz/);
  assert.match(migration, /whatsapp_sent_at timestamptz/);
  assert.match(migration, /whatsapp_status IN \('pending', 'processing', 'sent', 'skipped', 'failed'\)/);
  assert.match(migration, /whatsapp_attempts >= 0/);
});

test('historical notifications are safe by default and only retryable states are indexed', () => {
  assert.match(migration, /Historical rows are intentionally not enqueued/);
  assert.match(migration, /status IN \('pending', 'failed'\)/);
  assert.match(migration, /whatsapp_status IN \('pending', 'failed'\)/);
  assert.doesNotMatch(migration, /UPDATE\s+public\.(result_publication_events|parent_notifications)/i);
  assert.doesNotMatch(migration, /CREATE\s+(OR\s+REPLACE\s+)?TRIGGER/i);
  assert.doesNotMatch(migration, /TWILIO|whatsapp-notification/i);
});

test('compatibility fields remain present and migration is forward/idempotent', () => {
  assert.match(migration, /ADD COLUMN IF NOT EXISTS/);
  assert.match(baseSchema, /sent_via_whatsapp boolean NOT NULL DEFAULT false/);
  assert.match(migration, /whatsapp_status/); // new state is additive; compatibility fields are not dropped
  assert.match(migration, /DROP CONSTRAINT IF EXISTS/);
});
