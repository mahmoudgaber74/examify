import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const view = readFileSync(new URL('../src/views/BubbleSheet.tsx', import.meta.url), 'utf8');
const viewResultStart = view.indexOf('async function viewResult');
const viewResultEnd = view.indexOf('\n  async function deleteResult', viewResultStart);
const viewResult = view.slice(viewResultStart, viewResultEnd);

test('result detail reloads persisted result before committing summary and answers', () => {
  assert.ok(viewResultStart >= 0 && viewResultEnd > viewResultStart);
  assert.match(viewResult, /supabase\.from\('omr_results'\)\.select\(OMR_RESULT_COLUMNS\)\.eq\('id', r\.id\)\.maybeSingle\(\)/);
  assert.match(viewResult, /supabase\.from\('omr_answers'\)/);
  assert.match(viewResult, /const persistedResult = latestResult as OmrResultRow/);
  assert.match(viewResult, /const persistedAnswers = \(latestAnswers as typeof answers\) \?\? \[\]/);
  assert.match(viewResult, /setSelected\(persistedResult\)/);
  assert.match(viewResult, /setAnswers\(persistedAnswers\)/);
  assert.doesNotMatch(viewResult, /setSelected\(r\)/);
});

test('summary cards retain the canonical confidence source', () => {
  assert.match(view, /displayedOmrConfidence\(selected\)/);
  assert.match(view, /selected\.correct_count/);
  assert.match(view, /selected\.wrong_count/);
  assert.match(view, /selected\.empty_count/);
});

test('queued OpenCV responses do not become final result summaries', () => {
  const scanPath = view.slice(view.indexOf("if (engine === 'opencv')"), view.indexOf("} else {", view.indexOf("if (engine === 'opencv')")));
  assert.match(scanPath, /job_id/);
  assert.match(scanPath, /answers: \[\]/);
  assert.doesNotMatch(scanPath, /response\.questions\.map/);
});
