import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const provider = readFileSync(new URL('../src/components/AuthProvider.tsx', import.meta.url), 'utf8');
const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const auth = readFileSync(new URL('../src/views/Auth.tsx', import.meta.url), 'utf8');
const select = readFileSync(new URL('../src/components/ui/Select.tsx', import.meta.url), 'utf8');

test('AuthProvider tracks PASSWORD_RECOVERY only with a session', () => {
  assert.match(provider, /isPasswordRecovery/);
  assert.match(provider, /event === 'PASSWORD_RECOVERY' && newSession/);
  assert.match(provider, /setConfirmedPasswordRecovery\(true\)/);
  assert.match(provider, /hasConfirmedPasswordRecovery\(\)/);
  assert.doesNotMatch(provider, /window\.location\.hash\.includes\('type=recovery'\)/);
});

test('recovery routing precedes inactive approval routing', () => {
  assert.ok(app.indexOf('if (isPasswordRecovery && user)') < app.indexOf('if (!isActive && role !== \'super_admin\')'));
  assert.match(app, /if \(isPasswordRecovery && user\)\s*\{\s*return <Auth \/>;\s*\}/);
});

test('Auth reset mode depends on provider recovery state, not hash alone', () => {
  assert.match(auth, /if \(isPasswordRecovery\) setMode\('reset-password'\)/);
  assert.doesNotMatch(auth, /window\.location\.hash\.includes\('type=recovery'\)/);
});

test('normal inactive and authenticated application gates remain present', () => {
  assert.match(app, /if \(!user\)\s*\{[\s\S]*return <Auth initialMode=\{authMode\}/);
  assert.match(app, /if \(!isActive && role !== 'super_admin'\)/);
});

test('successful password reset ends recovery and returns to login', () => {
  assert.match(auth, /await signOut\(\);[\s\S]*setMode\('login'\)/);
  assert.match(provider, /setIsPasswordRecovery\(false\);/);
  assert.match(provider, /sessionStorage\.removeItem\(PASSWORD_RECOVERY_STORAGE_KEY\)/);
});

test('custom Select forwards the selected value before closing its portalled menu', () => {
  assert.match(select, /onClick=\{\(\) => choose\(option\.value\)\}/);
  assert.match(select, /onValueChange\(nextValue\)/);
  assert.match(select, /menuRef\.current\?\.contains\(target\)/);
  assert.match(select, /selected = options\.find\(\(option\) => option\.value === value\)/);
});
