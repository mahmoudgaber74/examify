import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync('src/views/ExamBuilder.tsx', 'utf8');

test('inline MCQ save accepts the deployed question_id RPC response', () => {
  assert.match(source, /function extractSavedQuestionId\(data: unknown\)/);
  assert.match(source, /response\.question_id/);
  assert.match(source, /const savedQuestionId = extractSavedQuestionId\(data\)/);
  assert.match(source, /handleAddQuestion\(savedQuestionId/);
});

test('inline MCQ save keeps explicit compatibility fallbacks', () => {
  assert.match(source, /response\.id/);
  assert.match(source, /response\.question\?\.id/);
  assert.match(source, /Array\.isArray\(data\) \? data\[0\] : data/);
});
