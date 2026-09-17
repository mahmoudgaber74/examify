import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const migration = fs.readFileSync(
  new URL('../supabase/migrations/20260923110000_phase_b8_page_index_bound.sql', import.meta.url),
  'utf8',
);

test('Phase B.8 enforces the page index bounds on the page row', () => {
  assert.match(migration, /ADD CONSTRAINT bubble_sheet_pages_page_index_within_count_check/);
  assert.match(migration, /CHECK \(page_index >= 1 AND page_index <= page_count\)/);
});
