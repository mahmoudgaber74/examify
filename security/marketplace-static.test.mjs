import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ui = readFileSync(new URL('../src/views/Marketplace.tsx', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../supabase/migrations/20260905100000_phase9_1_marketplace_integrity.sql', import.meta.url), 'utf8');
const fulfillment = readFileSync(new URL('../supabase/migrations/20260905200000_phase9_2_marketplace_fulfillment_contract.sql', import.meta.url), 'utf8');

test('Marketplace UI has no fabricated commercial metrics', () => {
  for (const claim of ['$1.24M', '4,820', '18,400', '4.8/5', '70/30', '80/20', '85/15']) assert.equal(ui.includes(claim), false, claim);
  assert.match(ui, /payment|الدفع/i);
});
test('Marketplace migration defines private management and authoritative checkout', () => {
  assert.match(migration, /owner_type/);
  assert.match(migration, /REVOKE INSERT, UPDATE, DELETE ON public\.marketplace_products/);
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /ON CONFLICT \(user_id, item_id\)/);
});
test('fulfillment boundary cannot be called by buyers and rejects unavailable targets', () => {
  assert.match(fulfillment, /activate_marketplace_entitlement/);
  assert.match(fulfillment, /trusted_activation_required/);
  assert.match(fulfillment, /fulfillment_target_unavailable/);
  assert.match(fulfillment, /REVOKE ALL ON FUNCTION public\.activate_marketplace_entitlement/);
});
