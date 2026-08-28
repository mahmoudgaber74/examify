import { expect, test, type Page } from '@playwright/test';
import { login, monitorPage, state } from './helpers';

const allViews = [
  'dashboard',
  'institutions',
  'analytics',
  'sis',
  'assessment',
  'questionbank',
  'exambuilder',
  'bubblesheet',
  'aiengine',
  'grading',
  'examresults',
  'reports',
  'parents',
  'settings',
  'examrunner',
] as const;

const roleMatrix = {
  super_admin: ['dashboard', 'institutions', 'analytics', 'sis', 'assessment', 'questionbank', 'exambuilder', 'bubblesheet', 'aiengine', 'grading', 'examresults', 'reports', 'settings'],
  school_admin: ['dashboard', 'sis', 'assessment', 'questionbank', 'exambuilder', 'bubblesheet', 'aiengine', 'grading', 'examresults', 'reports', 'analytics', 'parents', 'settings'],
  teacher: ['dashboard', 'questionbank', 'exambuilder', 'bubblesheet', 'aiengine', 'grading', 'examresults', 'reports', 'sis'],
  grader: ['dashboard', 'bubblesheet', 'aiengine', 'grading', 'examresults', 'reports'],
  data_entry: ['dashboard', 'sis'],
  student: ['dashboard', 'examrunner', 'examresults'],
  parent: ['dashboard', 'parents'],
} as const;

async function visibleNavIds(page: Page) {
  const visible: string[] = [];
  for (const view of allViews) {
    if (await page.getByTestId(`nav-${view}`).first().isVisible().catch(() => false)) visible.push(view);
  }
  return visible.sort();
}

test.describe('role access navigation matrix', () => {
  test.setTimeout(60_000);

  for (const [role, expected] of Object.entries(roleMatrix)) {
    test(`${role} sees only its configured pages`, async ({ page }, testInfo) => {
      const assertClean = monitorPage(page, testInfo);
      const s = state();
      const user =
        role === 'super_admin' ? s.users.superAdmin :
        role === 'school_admin' ? s.users.adminA :
        role === 'teacher' ? s.users.teacherA :
        role === 'grader' ? s.users.graderA :
        role === 'data_entry' ? s.users.dataEntryA :
        role === 'parent' ? s.users.parentA :
        s.users.studentA;

      await login(page, user.email, s.password);

      const actual = await visibleNavIds(page);
      expect(actual).toEqual([...expected].sort());

      for (const view of allViews) {
        const locator = page.getByTestId(`nav-${view}`).first();
        if (expected.includes(view as never)) {
          await expect(locator, `${role} should see ${view}`).toBeVisible();
        } else {
          await expect(locator, `${role} should not see ${view}`).toHaveCount(0);
        }
      }

      const allowedTarget = expected.find((view) => view !== 'dashboard') ?? 'dashboard';
      await page.goto(`/?view=${allowedTarget}`);
      await expect(page.locator('main')).toBeVisible({ timeout: 20_000 });
      await expect(page.getByTestId(`nav-${allowedTarget}`).first(), `${role} should open allowed view directly`).toBeVisible();

      const deniedTarget = allViews.find((view) => !expected.includes(view as never));
      if (deniedTarget) {
        await page.goto(`/?view=${deniedTarget}`);
        await expect(page.locator('main')).toBeVisible({ timeout: 20_000 });
        await expect(page.getByTestId(`nav-${deniedTarget}`).first(), `${role} should not see denied direct view`).toHaveCount(0);
        await expect(page.getByTestId('nav-dashboard').first()).toBeVisible();
      }

      await assertClean();
    });
  }
});
