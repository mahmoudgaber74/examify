import { expect, type Page, type TestInfo } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export type E2EState = {
  run: string;
  supabaseUrl: string;
  anonKey: string;
  password: string;
  ids: Record<string, string>;
  users: Record<string, { id: string; email: string }>;
};

export function state(): E2EState {
  return JSON.parse(readFileSync(resolve('test-results/e2e-state.json'), 'utf8')) as E2EState;
}

export function psqlScalar(sql: string) {
  const output = execFileSync('docker', ['exec', '-i', 'supabase_db_project', 'psql', '-U', 'postgres', '-d', 'postgres', '-t', '-A', '-v', 'ON_ERROR_STOP=1'], {
    input: sql,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  return output.trim();
}

export async function login(page: Page, email: string, password: string) {
  await page.goto('/');
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.locator('button[type="submit"]').click();
  await expect(page.locator('main')).toBeVisible({ timeout: 20_000 });
}

export async function logout(page: Page) {
  await page.getByTestId('auth-logout').first().click();
  await expect(page.locator('input[type="email"]')).toBeVisible({ timeout: 10_000 });
}

export function monitorPage(page: Page, testInfo: TestInfo, allowedStatusUrls: RegExp[] = [], allowedConsoleMessages: RegExp[] = []) {
  const consoleErrors: string[] = [];
  const badResponses: string[] = [];
  const allowed = [
    /\/auth\/v1\/token/i,
    ...allowedStatusUrls,
  ];

  page.on('console', (message) => {
    if (message.type() === 'error' && !allowedConsoleMessages.some((pattern) => pattern.test(message.text()))) {
      consoleErrors.push(message.text());
    }
  });
  page.on('pageerror', (error) => {
    consoleErrors.push(error.message);
  });
  page.on('response', (response) => {
    const status = response.status();
    if (![400, 401, 403, 500].includes(status)) return;
    const url = response.url();
    if (allowed.some((pattern) => pattern.test(url))) return;
    badResponses.push(`${status} ${url}`);
  });

  return async () => {
    if (consoleErrors.length) {
      await testInfo.attach('console-errors', { body: consoleErrors.join('\n'), contentType: 'text/plain' });
    }
    if (badResponses.length) {
      await testInfo.attach('network-errors', { body: badResponses.join('\n'), contentType: 'text/plain' });
    }
    expect(consoleErrors, 'unexpected browser console errors').toEqual([]);
    expect(badResponses, 'unexpected 400/401/403/500 responses').toEqual([]);
  };
}

export const tinyPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAASwAAAEsCAIAAAD2HxkiAAABWElEQVR4nO3UMQ0AAAwDsJz/0G2h4QkJtOquwC4AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgJ8GfAABRXkXiwAAAABJRU5ErkJggg==',
  'base64',
);
