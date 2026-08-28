import { expect, test, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { login, logout, monitorPage, psqlScalar, state } from './helpers';

function sqlValue(value: string) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

async function openView(page: Page, id: string) {
  const nav = page.getByTestId(`nav-${id}`).first();
  await expect(nav).toBeVisible({ timeout: 10_000 });
  await nav.click();
}

test.describe.serial('AI grading workflow', () => {
  test.setTimeout(120_000);

  test('grader creates, reviews, approves, and downstream reports use AI-reviewed score', async ({ page }, testInfo) => {
    const assertClean = monitorPage(page, testInfo);
    const s = state();
    const suffix = Date.now().toString(36);
    const examId = randomUUID();
    const questionId = randomUUID();
    const attemptId = randomUUID();
    const answerId = randomUUID();
    const examTitle = `AI Review E2E ${suffix}`;

    psqlScalar(`
      insert into public.questions (id, institution_id, subject_id, type, prompt, difficulty, points, metadata)
      values (
        ${sqlValue(questionId)}::uuid,
        ${sqlValue(s.ids.instA)}::uuid,
        ${sqlValue(s.ids.subjectA)}::uuid,
        'essay',
        ${sqlValue(`Explain the water cycle ${suffix}`)},
        'medium',
        10,
        ${sqlValue(JSON.stringify({ rubric: { criteria: [{ name: 'content', points: 5 }, { name: 'reasoning', points: 3 }, { name: 'clarity', points: 2 }] } }))}::jsonb
      );

      insert into public.examify_exams (id, institution_id, subject_id, class_id, title, total_points, passing_score, duration_minutes, max_attempts, status, show_result_immediately)
      values (${sqlValue(examId)}::uuid, ${sqlValue(s.ids.instA)}::uuid, ${sqlValue(s.ids.subjectA)}::uuid, ${sqlValue(s.ids.classA)}::uuid, ${sqlValue(examTitle)}, 10, 50, 30, 1, 'published', false);

      insert into public.exam_questions (exam_id, question_id, points, sort_order)
      values (${sqlValue(examId)}::uuid, ${sqlValue(questionId)}::uuid, 10, 0);

      alter table public.exam_attempts disable trigger trg_enforce_exam_attempt_canonical_write;
      insert into public.exam_attempts (id, exam_id, student_id, attempt_number, status, submitted_at, is_result_published)
      values (${sqlValue(attemptId)}::uuid, ${sqlValue(examId)}::uuid, ${sqlValue(s.ids.studentAProfile)}::uuid, 41, 'submitted', now(), false);
      alter table public.exam_attempts enable trigger trg_enforce_exam_attempt_canonical_write;

      alter table public.answers disable trigger trg_enforce_answer_canonical_write;
      insert into public.answers (id, attempt_id, question_id, text_answer)
      values (${sqlValue(answerId)}::uuid, ${sqlValue(attemptId)}::uuid, ${sqlValue(questionId)}::uuid, 'Evaporation, condensation, precipitation, runoff, collection, and groundwater movement are linked stages powered by the sun.');
      alter table public.answers enable trigger trg_enforce_answer_canonical_write;

      select 'ok';
    `);

    await login(page, s.users.graderA.email, s.password);
    await openView(page, 'aiengine');
    await page.getByTestId('ai-tab-grading').click();
    await page.getByTestId('ai-attempt-select').selectOption(attemptId);
    await expect(page.getByText(`Explain the water cycle ${suffix}`)).toBeVisible({ timeout: 20_000 });
    await page.getByTestId('ai-grade-answer').click();
    await expect(page.getByTestId('ai-grading-result')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('ai-rubric')).toBeVisible();
    await expect(page.getByTestId('ai-feedback')).not.toHaveText('');

    await page.getByTestId('ai-final-score').fill('8');
    await page.getByTestId('ai-review-reason').fill('E2E human review');
    await page.getByTestId('ai-approve-result').click();
    await expect(page.getByText('معتمدة')).toBeVisible({ timeout: 20_000 });

    const approvedState = psqlScalar(`
      select a.awarded_points::text || '|' || ea.status || '|' || ea.score::text || '|' || ea.is_result_published::text
      from public.answers a
      join public.exam_attempts ea on ea.id = a.attempt_id
      where a.id = ${sqlValue(answerId)}::uuid;
    `);
    expect(approvedState).toBe('8.00|graded|8.00|false');

    await logout(page);
    await login(page, s.users.studentA.email, s.password);
    await openView(page, 'examresults');
    await expect(page.getByText(examTitle)).toHaveCount(0);

    psqlScalar(`
      update public.exam_attempts
      set status = 'approved',
          approved_by = ${sqlValue(s.users.graderA.id)}::uuid,
          approved_at = now(),
          is_result_published = true
      where id = ${sqlValue(attemptId)}::uuid;
      select 'ok';
    `);

    await page.reload();
    await expect(page.getByText(examTitle).first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('80.0%').first()).toBeVisible();

    await logout(page);
    await login(page, s.users.graderA.email, s.password);
    await openView(page, 'reports');
    await page.getByTestId('reports-filter-exam').selectOption(examId);
    await expect(page.getByTestId('reports-total-attempts')).toHaveText('1', { timeout: 20_000 });
    await expect(page.getByTestId('reports-average')).toHaveText('80.0%');

    await assertClean();
  });
});
