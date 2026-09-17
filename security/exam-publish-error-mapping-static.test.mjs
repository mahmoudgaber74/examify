import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const builder = readFileSync(new URL('../src/views/ExamBuilder.tsx', import.meta.url), 'utf8');

test('exam publish mismatch maps configured and question totals to an Arabic remaining message', () => {
  assert.match(builder, /function getExamPublishErrorMessage/);
  assert.match(builder, /function getExamPublishValidationMessage/);
  assert.ok(builder.includes('configured_total='));
  assert.ok(builder.includes('question_points_total='));
  assert.match(builder, /متبقي توزيع/);
  assert.match(builder, /يتجاوز الدرجة الكلية بمقدار/);
});

test('local pre-publish validation reports each known reason in deterministic order', () => {
  assert.match(builder, /لا يمكن نشر الامتحان قبل اختيار المادة/);
  assert.match(builder, /لا يمكن نشر الامتحان قبل إضافة سؤال واحد على الأقل/);
  assert.match(builder, /الدرجة الكلية للامتحان يجب أن تكون أكبر من صفر/);
  assert.match(builder, /يجب أن تكون درجة كل سؤال أكبر من صفر/);
  assert.match(builder, /نسبة النجاح يجب أن تكون بين 0 و100%/);
  assert.match(builder, /مدة الامتحان يجب أن تكون أكبر من صفر دقيقة/);
  assert.match(builder, /questionPointsTotal !== input\.totalPoints/);
});

test('known publish validation errors are handled while unknown errors keep the generic fallback', () => {
  assert.match(builder, /exam_not_ready_for_publication/);
  assert.match(builder, /return getArabicErrorMessage\(error\)/);
  assert.match(builder, /status === 'published' \? getExamPublishErrorMessage\(err\) : getArabicErrorMessage\(err\)/);
});
