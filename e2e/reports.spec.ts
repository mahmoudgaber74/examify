import { expect, test } from '@playwright/test';
import { login, monitorPage, psqlScalar, state } from './helpers';

function sqlValue(value: string) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

test.describe('Reports', () => {
  test.setTimeout(90_000);

  test('reports use real attempt data, filters affect the query, and exports are available', async ({ page }, testInfo) => {
    const assertClean = monitorPage(page, testInfo);
    const s = state();
    const suffix = Date.now().toString(36);
    const examOther = psqlScalar('select gen_random_uuid();');
    const attemptA = psqlScalar('select gen_random_uuid();');
    const attemptB = psqlScalar('select gen_random_uuid();');
    const attemptUnpublished = psqlScalar('select gen_random_uuid();');
    const answerA = psqlScalar('select gen_random_uuid();');
    const questionA = psqlScalar(`select question_id::text from public.exam_questions where exam_id = ${sqlValue(s.ids.examA)}::uuid order by sort_order limit 1;`);
    const examTotalPoints = psqlScalar(`select total_points::text from public.examify_exams where id = ${sqlValue(s.ids.examA)}::uuid;`);

    psqlScalar(`
      insert into public.examify_exams (id, institution_id, subject_id, class_id, title, total_points, passing_score, duration_minutes, status)
      values (${sqlValue(examOther)}::uuid, ${sqlValue(s.ids.instA)}::uuid, ${sqlValue(s.ids.subjectA)}::uuid, ${sqlValue(s.ids.classA)}::uuid, ${sqlValue(`تقرير اختبار آخر ${suffix}`)}, 100, 50, 30, 'published');
      alter table public.exam_attempts disable trigger trg_enforce_exam_attempt_canonical_write;
      insert into public.exam_attempts (id, exam_id, student_id, attempt_number, status, submitted_at, score, score_percentage, is_passed, is_result_published)
      values
        (${sqlValue(attemptA)}::uuid, ${sqlValue(s.ids.examA)}::uuid, ${sqlValue(s.ids.studentAProfile)}::uuid, 10, 'approved', '2026-08-05T10:00:00Z', (${sqlValue(examTotalPoints)}::numeric * 0.8), 80, true, true),
        (${sqlValue(attemptB)}::uuid, ${sqlValue(s.ids.examA)}::uuid, ${sqlValue(s.ids.studentBProfile)}::uuid, 10, 'approved', '2026-08-05T11:00:00Z', (${sqlValue(examTotalPoints)}::numeric * 0.4), 40, false, true),
        (${sqlValue(attemptUnpublished)}::uuid, ${sqlValue(examOther)}::uuid, ${sqlValue(s.ids.studentAProfile)}::uuid, 10, 'graded', '2026-08-04T10:00:00Z', 90, 90, true, false);
      alter table public.exam_attempts enable trigger trg_enforce_exam_attempt_canonical_write;
      alter table public.answers disable trigger trg_enforce_answer_canonical_write;
      insert into public.answers (id, attempt_id, question_id, text_answer, is_correct, awarded_points)
      values (${sqlValue(answerA)}::uuid, ${sqlValue(attemptA)}::uuid, ${sqlValue(questionA)}::uuid, 'إجابة اختبارية للتقارير', true, 1);
      alter table public.answers enable trigger trg_enforce_answer_canonical_write;
      select 'ok';
    `);

    await login(page, s.users.adminA.email, s.password);
    await page.getByTestId('nav-reports').click();
    await expect(page.getByTestId('reports-total-attempts')).toHaveText('3', { timeout: 20_000 });
    await expect(page.getByTestId('reports-average')).toHaveText('70.0%');
    await expect(page.getByTestId('reports-pass-rate')).toHaveText('66.7%');

    await page.getByTestId('reports-filter-exam').selectOption(s.ids.examA);
    await expect(page.getByTestId('reports-total-attempts')).toHaveText('2', { timeout: 20_000 });
    await expect(page.getByTestId('reports-average')).toHaveText('60.0%');

    await page.getByTestId('reports-filter-status').selectOption('approved');
    await expect(page.getByTestId('reports-total-attempts')).toHaveText('2', { timeout: 20_000 });
    await page.getByTestId('reports-filter-status').selectOption('graded');
    await expect(page.getByText('لا توجد بيانات')).toBeVisible({ timeout: 20_000 });

    await page.getByTestId('reports-filter-exam').selectOption('all');
    await page.getByTestId('reports-filter-status').selectOption('all');
    await page.getByTestId('reports-date-from').fill('2026-08-05');
    await page.getByTestId('reports-date-to').fill('2026-08-05');
    await expect(page.getByTestId('reports-total-attempts')).toHaveText('2', { timeout: 20_000 });

    const excelDownload = page.waitForEvent('download');
    await page.getByTestId('reports-export-excel').click();
    expect((await excelDownload).suggestedFilename()).toMatch(/\.xlsx$/);

    const pdfDownload = page.waitForEvent('download');
    await page.getByTestId('reports-export-pdf').click();
    expect((await pdfDownload).suggestedFilename()).toMatch(/\.pdf$/);

    const responsesPdfDownload = page.waitForEvent('download');
    await page.getByTestId('reports-export-responses-pdf').click();
    expect((await responsesPdfDownload).suggestedFilename()).toMatch(/student-responses.*\.pdf$/);

    const comparisonPdfDownload = page.waitForEvent('download');
    await page.getByTestId('reports-export-comparison-pdf').click();
    expect((await comparisonPdfDownload).suggestedFilename()).toMatch(/grade-comparison.*\.pdf$/);

    psqlScalar(`
      delete from public.answers where id = ${sqlValue(answerA)}::uuid;
      delete from public.exam_attempts where id in (${sqlValue(attemptA)}::uuid, ${sqlValue(attemptB)}::uuid, ${sqlValue(attemptUnpublished)}::uuid);
      delete from public.examify_exams where id = ${sqlValue(examOther)}::uuid;
      select 'ok';
    `);
    await assertClean();
  });
});
