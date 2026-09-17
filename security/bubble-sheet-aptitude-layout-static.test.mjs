import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const layout = readFileSync(new URL('../src/lib/bubble-sheet.ts', import.meta.url), 'utf8');

test('aptitude template uses four columns for each of two sections', () => {
  assert.match(layout, /function splitIntoFourColumns\(total: number\)/);
  assert.match(layout, /sectionIndex \* 4 \+ columnIndex/);
  assert.match(layout, /sections\.length === 2 && config\.choicesCount === 4/);
  assert.match(layout, /return buildAptitudeBubbleSheetLayout\(config, sections\)/);
});

test('aptitude template preserves OMR geometry and four answer choices', () => {
  assert.match(layout, /pageCount: 1/);
  assert.match(layout, /sourceOptions\.slice\(0, 4\)/);
  assert.match(layout, /sectionVisualIndex: visualIndex/);
  assert.match(layout, /globalQuestionNumber/);
  assert.match(layout, /layout\.sections\.forEach\(\(section\) =>/);
});
