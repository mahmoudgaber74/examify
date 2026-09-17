import { expect, test } from '@playwright/test';

test('public landing page leads to institution signup', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /خلّي وقتك للشرح/ })).toBeVisible();
  await expect(page.getByText('ابدأ بدون مخاطرة')).toBeVisible();
  await page.getByRole('button', { name: /ابدأ مؤسستك مجانًا/ }).first().click();
  await expect(page.getByText('طريقة إنشاء الحساب')).toBeVisible();
  await expect(page.getByText('اسم المؤسسة')).toBeVisible();
  await page.getByRole('button', { name: 'العودة إلى الصفحة الرئيسية' }).click();
  await expect(page.getByRole('heading', { name: /خلّي وقتك للشرح/ })).toBeVisible();
});

test('institution signup creates an active local workspace', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /ابدأ مؤسستك مجانًا/ }).first().click();
  await page.getByPlaceholder('مثال: مدرسة المستقبل').fill(`مؤسسة اختبار ${Date.now()}`);
  await page.getByPlaceholder('أدخل اسمك الكامل').fill('مدير اختبار');
  await page.getByPlaceholder('you@example.com').fill(`institution-${Date.now()}@e2e.local`);
  await page.locator('input[type="password"]').first().fill('E2e-Test-Password-123!');
  await page.getByRole('button', { name: 'إنشاء حساب' }).click();
  await expect(page.getByRole('heading', { name: /أنشئ امتحانًا وصحح أوراقه/ })).toBeVisible({ timeout: 15_000 });
});

test('teacher signup joins an institution and waits for approval', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /أنا مدرس/ }).first().click();
  await page.getByRole('button', { name: 'الانضمام لمؤسسة' }).click();
  await expect(page.getByRole('button', { name: 'المؤسسة' })).toBeVisible();
  await page.getByRole('button', { name: 'المؤسسة' }).click();
  await expect.poll(() => page.getByRole('option').count(), { timeout: 15_000 }).toBeGreaterThan(0);
  await page.getByRole('option').first().click();
  await page.getByPlaceholder('أدخل اسمك الكامل').fill('مدرس اختبار');
  await page.getByPlaceholder('you@example.com').fill(`teacher-${Date.now()}@e2e.local`);
  await page.locator('input[type="password"]').first().fill('E2e-Test-Password-123!');
  await page.getByRole('button', { name: 'إنشاء حساب' }).click();
  await expect(page.getByText('حسابك قيد المراجعة')).toBeVisible({ timeout: 15_000 });
});
