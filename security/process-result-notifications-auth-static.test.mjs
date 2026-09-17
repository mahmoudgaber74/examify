import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const config = readFileSync(new URL('../supabase/config.toml', import.meta.url), 'utf8');
const processor = readFileSync(new URL('../supabase/functions/process-result-notifications/index.ts', import.meta.url), 'utf8');
function sourceFiles(directory) {
  return readdirSync(new URL(`../${directory}/`, import.meta.url), { withFileTypes: true }).flatMap((entry) => {
    const relative = `${directory}/${entry.name}`;
    if (entry.isDirectory()) return sourceFiles(relative);
    return /\.(ts|tsx|js|jsx)$/.test(entry.name) ? [relative] : [];
  });
}

test('only the internal processor disables gateway JWT verification', () => {
  assert.match(config, /\[functions\.process-result-notifications\]\s*\r?\nverify_jwt\s*=\s*false/);
  assert.doesNotMatch(config, /\[functions\.whatsapp-notification\][\s\S]*?verify_jwt\s*=\s*false/);
});

test('processor still requires its internal token in function code', () => {
  assert.match(processor, /Deno\.env\.get\('PROCESSOR_INTERNAL_TOKEN'\)/);
  assert.match(processor, /Authorization/);
  assert.match(processor, /Internal authorization required/);
  assert.match(processor, /if \(!isAuthorized\(request\)\)/);
});

test('processor token is not referenced by frontend source', () => {
  for (const file of sourceFiles('src')) {
    assert.doesNotMatch(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), /PROCESSOR_INTERNAL_TOKEN/);
  }
});
