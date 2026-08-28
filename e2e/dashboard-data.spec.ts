import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { login, monitorPage, psqlScalar, state } from './helpers';

function sqlValue(value: string) {
  return `'${value.replaceAll("'", "''")}'`;
}

function countFor(sql: string) {
  return Number(psqlScalar(sql));
}

function dashboardNumber(value: number) {
  const digits: Record<string, string> = {
    '0': '٠',
    '1': '١',
    '2': '٢',
    '3': '٣',
    '4': '٤',
    '5': '٥',
    '6': '٦',
    '7': '٧',
    '8': '٨',
    '9': '٩',
  };
  return String(value).replace(/[0-9]/g, (digit) => digits[digit]);
}

test('dashboard KPIs come from the current institution data and react to DB changes', async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  const assertClean = monitorPage(page, testInfo);
  const s = state();
  const tempQuestionId = randomUUID();
  const tempPrompt = `Dashboard KPI ${Date.now()}`;

  const expected = {
    students: countFor(`select count(*) from public.student_profiles where institution_id = ${sqlValue(s.ids.instA)}::uuid;`),
    questions: countFor(`select count(*) from public.questions where institution_id = ${sqlValue(s.ids.instA)}::uuid;`),
    exams: countFor(`select count(*) from public.examify_exams where institution_id = ${sqlValue(s.ids.instA)}::uuid;`),
    omr: countFor(`select count(*) from public.omr_results where institution_id = ${sqlValue(s.ids.instA)}::uuid;`),
  };

  await login(page, s.users.adminA.email, s.password);
  await expect(page.getByTestId('dashboard-stat-students')).toContainText(dashboardNumber(expected.students), { timeout: 20_000 });
  await expect(page.getByTestId('dashboard-stat-questions')).toContainText(dashboardNumber(expected.questions));
  await expect(page.getByTestId('dashboard-stat-exams')).toContainText(dashboardNumber(expected.exams));
  await expect(page.getByTestId('dashboard-stat-omr')).toContainText(dashboardNumber(expected.omr));

  psqlScalar(`
    insert into public.questions (id, institution_id, subject_id, type, prompt, difficulty, points, metadata)
    values (
      ${sqlValue(tempQuestionId)}::uuid,
      ${sqlValue(s.ids.instA)}::uuid,
      ${sqlValue(s.ids.subjectA)}::uuid,
      'short_answer',
      ${sqlValue(tempPrompt)},
      'easy',
      1,
      '{}'::jsonb
    );
    select count(*) from public.questions where institution_id = ${sqlValue(s.ids.instA)}::uuid;
  `);

  await page.reload();
  await expect(page.getByTestId('dashboard-stat-questions')).toContainText(dashboardNumber(expected.questions + 1), { timeout: 20_000 });

  psqlScalar(`delete from public.questions where id = ${sqlValue(tempQuestionId)}::uuid; select 1;`);
  await assertClean();
});
