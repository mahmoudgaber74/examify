import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const auth = readFileSync(new URL('../src/views/Auth.tsx', import.meta.url), 'utf8');
const admin = readFileSync(new URL('../src/views/UserManagement.tsx', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../supabase/migrations/20260920100000_disable_first_admin_client_execution.sql', import.meta.url), 'utf8');
const signupMigration = readFileSync(new URL('../supabase/migrations/20260917111000_harden_signup_roles_and_bootstrap.sql', import.meta.url), 'utf8');

test('pending approval does not expose or call first-admin bootstrap', () => {
  assert.doesNotMatch(app, /bootstrapFirstAdmin|handleBootstrap|تفعيل أول مدير للنظام/);
  assert.match(app, /if \(!isActive && role !== 'super_admin'\)/);
  assert.match(app, /onClick=\{\(\) => void signOut\(\)\}/);
});

test('registration does not expose first-admin self-registration or availability probing', () => {
  assert.doesNotMatch(auth, /canBootstrapFirstAdmin|bootstrapFirstAdmin|isFirstUser|firstAdminAvailable/);
  assert.doesNotMatch(auth, /value: 'super_admin'/);
  assert.match(auth, /ROLE_LABELS\.filter\(\(r\) => r\.value === 'school_admin'\)/);
});

test('bootstrap RPCs are not executable by browser or anonymous roles', () => {
  for (const fn of ['bootstrap_first_admin', 'can_bootstrap_first_admin']) {
    assert.match(migration, new RegExp(`REVOKE EXECUTE ON FUNCTION public\\.${fn}\\(\\) FROM PUBLIC;`));
    assert.match(migration, new RegExp(`REVOKE EXECUTE ON FUNCTION public\\.${fn}\\(\\) FROM anon;`));
    assert.match(migration, new RegExp(`REVOKE EXECUTE ON FUNCTION public\\.${fn}\\(\\) FROM authenticated;`));
  }
  assert.doesNotMatch(migration, /GRANT EXECUTE/);
});

test('signup trigger ignores privileged role metadata and owns new tenant bootstrap', () => {
  assert.match(signupMigration, /SECURITY DEFINER/);
  assert.match(signupMigration, /SET search_path = public, pg_temp/);
  assert.match(signupMigration, /v_requested_role IN \('school_admin', 'teacher', 'student', 'parent'\)/);
  assert.doesNotMatch(signupMigration, /VALUES\s*\([^;]*'super_admin'/s);
  assert.match(signupMigration, /REVOKE ALL ON FUNCTION public\.handle_new_user\(\) FROM PUBLIC, anon, authenticated/);
});

test('legitimate staff approval remains an active-state update in the admin view', () => {
  assert.match(admin, /from\('staff_profiles'\)/);
  assert.match(admin, /const nextIsActive = !member\.is_active/);
  assert.match(admin, /is_active: nextIsActive/);
  assert.match(admin, /member\.user_id === user\?\.id/);
});
