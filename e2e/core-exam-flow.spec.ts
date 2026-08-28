import { expect, test, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { login, logout, monitorPage, psqlScalar, state } from './helpers';

function sqlValue(value: string) {
  return `'${value.replaceAll("'", "''")}'`;
}

async function openView(page: Page, id: string) {
  const nav = page.getByTestId(`nav-${id}`).first();
  await expect(nav).toBeVisible({ timeout: 10_000 });
  await nav.click();
}

function createWrongAnswerExam() {
  const s = state();
  const ids = {
    exam: randomUUID(),
    question: randomUUID(),
    correct: randomUUID(),
    wrong: randomUUID(),
  };
  psqlScalar(`
    insert into public.examify_exams (
      id, institution_id, subject_id, class_id, title, description, total_points,
      passing_score, duration_minutes, max_attempts, shuffle_questions, shuffle_options,
      show_result_immediately, show_correct_answers, status
    )
    values (
      ${sqlValue(ids.exam)}::uuid, ${sqlValue(s.ids.instA)}::uuid, ${sqlValue(s.ids.subjectA)}::uuid, ${sqlValue(s.ids.classA)}::uuid,
      ${sqlValue(`E2E Wrong Exam ${Date.now()}`)}, 'Created for wrong-answer flow', 1, 50, 30, 1, false, false, true, true, 'published'
    );
    insert into public.questions (id, institution_id, subject_id, type, prompt, difficulty, points, metadata)
    values (${sqlValue(ids.question)}::uuid, ${sqlValue(s.ids.instA)}::uuid, ${sqlValue(s.ids.subjectA)}::uuid, 'multiple_choice', ${sqlValue(`E2E wrong-answer question ${Date.now()}`)}, 'easy', 1, '{}'::jsonb);
    insert into public.question_options (id, question_id, label, is_correct, sort_order)
    values
      (${sqlValue(ids.correct)}::uuid, ${sqlValue(ids.question)}::uuid, 'Correct E2E option', true, 0),
      (${sqlValue(ids.wrong)}::uuid, ${sqlValue(ids.question)}::uuid, 'Wrong E2E option', false, 1);
    insert into public.exam_questions (exam_id, question_id, points, sort_order)
    values (${sqlValue(ids.exam)}::uuid, ${sqlValue(ids.question)}::uuid, 1, 0);
    insert into public.exam_assignments (exam_id, class_id)
    values (${sqlValue(ids.exam)}::uuid, ${sqlValue(s.ids.classA)}::uuid);
    select 1;
  `);
  return ids;
}

test.describe.serial('core exam flow with automatic grading', () => {
  test.setTimeout(120_000);

  test('student submits the correct answer and immediately sees the approved result', async ({ page }, testInfo) => {
    const assertClean = monitorPage(page, testInfo);
    const s = state();

    await login(page, s.users.studentA.email, s.password);
    await openView(page, 'examrunner');
    await expect(page.getByText(`E2E Exam ${s.run}`).first()).toBeVisible({ timeout: 20_000 });
    await page.getByTestId('exam-start').first().click();
    await expect(page.getByTestId('exam-option').first()).toBeVisible({ timeout: 20_000 });
    await page.getByTestId('exam-option').first().click();
    await expect(page.getByTestId('exam-option').first()).toHaveClass(/border-brand-500/);
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByTestId('exam-submit').click();
    await expect(page.getByText('تم التصحيح تلقائيًا')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('100.0%')).toBeVisible();

    const attemptState = psqlScalar(`
      select status || '|' || score::text || '|' || round(score_percentage)::text || '|' || is_passed::text || '|' || is_result_published::text
      from public.exam_attempts
      where exam_id = ${sqlValue(s.ids.examA)}::uuid
        and student_id = ${sqlValue(s.ids.studentAProfile)}::uuid
      order by started_at desc
      limit 1;
    `);
    expect(attemptState).toBe('approved|1.00|100|true|true');

    const answerState = psqlScalar(`
      select count(*)::text || '|' || bool_and(is_correct)::text || '|' || sum(awarded_points)::text
      from public.answers a
      join public.exam_attempts ea on ea.id = a.attempt_id
      where ea.exam_id = ${sqlValue(s.ids.examA)}::uuid
        and ea.student_id = ${sqlValue(s.ids.studentAProfile)}::uuid;
    `);
    expect(answerState).toBe('1|true|1.00');

    await page.getByRole('button', { name: 'العودة للامتحانات' }).click();
    await openView(page, 'examresults');
    await expect(page.getByText(`E2E Exam ${s.run}`).first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('100.0%').first()).toBeVisible();

    await logout(page);
    await login(page, s.users.graderA.email, s.password);
    await openView(page, 'reports');
    await expect(page.locator('main')).toContainText('100.0%', { timeout: 20_000 });

    await assertClean();
  });

  test('student submits a wrong answer and receives a failed published result', async ({ page }, testInfo) => {
    const assertClean = monitorPage(page, testInfo);
    const s = state();
    const fixture = createWrongAnswerExam();

    await login(page, s.users.studentB.email, s.password);
    await openView(page, 'examrunner');
    await expect(page.getByText('Created for wrong-answer flow').first()).toBeVisible({ timeout: 20_000 });
    const examCard = page.locator('.card').filter({ hasText: 'Created for wrong-answer flow' }).first();
    await examCard.getByTestId('exam-start').click();
    await expect(page.getByText('Wrong E2E option')).toBeVisible({ timeout: 20_000 });
    await page.getByText('Wrong E2E option').click();
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByTestId('exam-submit').click();
    await expect(page.getByText('تم التصحيح تلقائيًا')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('0.0%')).toBeVisible();

    const attemptState = psqlScalar(`
      select status || '|' || score::text || '|' || round(score_percentage)::text || '|' || is_passed::text || '|' || is_result_published::text
      from public.exam_attempts
      where exam_id = ${sqlValue(fixture.exam)}::uuid
        and student_id = ${sqlValue(s.ids.studentBProfile)}::uuid
      order by started_at desc
      limit 1;
    `);
    expect(attemptState).toBe('approved|0.00|0|false|true');

    await assertClean();
  });
});
