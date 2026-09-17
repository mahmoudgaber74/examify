import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const runner = fs.readFileSync(new URL('../src/views/ExamRunner.tsx', import.meta.url), 'utf8');

test('exam timer cannot submit before questions and a finite server deadline are ready', () => {
  assert.match(runner, /if \(!activeAttempt \|\| !activeExam \|\| questions\.length === 0\) return;/);
  assert.match(runner, /if \(!Number\.isFinite\(endTime\)\)/);
  assert.match(runner, /if \(remaining <= 0 && questions\.length > 0\)/);
});

test('camera permission/model failure is unavailable, not an automatic cheating strike', () => {
  assert.match(runner, /setError\('تعذر تشغيل الكاميرا/);
  assert.doesNotMatch(runner, /registerViolation\('CAMERA_UNAVAILABLE'/);
});

test('proctoring starts only after the loaded exam has questions', () => {
  assert.match(runner, /if \(!activeAttempt \|\| !activeExam \|\| questions\.length === 0 \|\| result/);
});

test('failed violation logging cannot increment strikes or submit automatically', () => {
  assert.match(runner, /if \(violationError\) \{[\s\S]*?لم يتم احتسابها أو إرسال الامتحان تلقائيًا/);
  assert.match(runner, /if \(violationError\) \{[\s\S]*?return;[\s\S]*?const nextStrike/);
});

test('correlated focus events share one incident and violation auto-submit is one-shot', () => {
  assert.match(runner, /PROCTORING_DEDUPE_WINDOW_MS = 1200/);
  assert.match(runner, /lastIncident\.type === 'WINDOW_BLUR'/);
  assert.match(runner, /lastIncident\.type === 'TAB_SWITCH'/);
  assert.match(runner, /if \(correlatedFocusEvent\) return;/);
  assert.match(runner, /violationAutoSubmitRef\.current/);
});

test('violations require a ready runner and do not count after submission starts', () => {
  assert.match(runner, /!activeExam \|\| questions\.length === 0 \|\| submissionStartedRef\.current/);
  assert.match(runner, /if \(nextStrike >= MAX_STRIKES && !violationAutoSubmitRef\.current\)/);
});
