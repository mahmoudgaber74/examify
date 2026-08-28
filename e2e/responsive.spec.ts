import { expect, test, type Page } from '@playwright/test';
import { login, monitorPage, state } from './helpers';

async function openView(page: Page, id: string) {
  const navItem = page.locator(`[data-testid="nav-${id}"]:visible`).first();
  if (!(await navItem.isVisible())) {
    await page.getByTestId('mobile-nav-toggle').click();
  }
  const visibleNavItem = page.locator(`[data-testid="nav-${id}"]:visible`).first();
  await expect(visibleNavItem).toBeVisible({ timeout: 10_000 });
  await visibleNavItem.scrollIntoViewIfNeeded();
  await visibleNavItem.click({ timeout: 10_000, force: true });
}

test('core authenticated pages render without runtime errors on the current viewport', async ({ page }, testInfo) => {
  const assertClean = monitorPage(page, testInfo);
  const s = state();

  await login(page, s.users.adminA.email, s.password);
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');

  for (const view of ['sis', 'questionbank', 'exambuilder', 'bubblesheet', 'grading'] as const) {
    await openView(page, view);
    await expect(page.locator('main')).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `${view} should not create page-level horizontal overflow`).toBeLessThanOrEqual(8);
  }

  await assertClean();
});
