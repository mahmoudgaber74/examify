import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const migration = fs.readFileSync('supabase/migrations/20260924150000_student_single_session_and_exam_device_guard.sql', 'utf8');
const authProvider = fs.readFileSync('src/components/AuthProvider.tsx', 'utf8');
const runner = fs.readFileSync('src/views/ExamRunner.tsx', 'utf8');

test('student session migration owns single-session claim and heartbeat', () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.student_sessions/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.claim_student_session/);
  assert.match(migration, /revoke_reason = 'new_login'/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.touch_student_session/);
  assert.match(migration, /auth_session_id = public\.current_auth_session_id\(\)/);
});

test('exam device lock detects and records simultaneous devices', () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.student_exam_device_locks/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.student_exam_device_conflicts/);
  assert.match(migration, /another_device_active/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.touch_student_exam_device/);
  assert.match(migration, /AS RESTRICTIVE FOR ALL TO authenticated/);
});

test('student browser claims and heartbeats its session', () => {
  assert.match(authProvider, /claim_student_session/);
  assert.match(authProvider, /touch_student_session/);
  assert.match(authProvider, /signOut\(\{ scope: 'local' \}\)/);
  assert.match(authProvider, /setInterval\(\(\) => \{ void heartbeat\(\); \}, 15000\)/);
});

test('active exam claims and heartbeats one device', () => {
  assert.match(runner, /claim_student_exam_device/);
  assert.match(runner, /touch_student_exam_device/);
  assert.match(runner, /examDeviceBlocked/);
  assert.match(runner, /setInterval\(\(\) => \{ void heartbeat\(\); \}, 10000\)/);
});
