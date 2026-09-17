import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

const fixture = JSON.parse(readFileSync(new URL('./test-results/security-local-fixtures.json', import.meta.url), 'utf8'));
const client = (token) => createClient(fixture.SECURITY_TEST_SUPABASE_URL, fixture.SECURITY_TEST_SUPABASE_ANON_KEY, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false } });
const buyer = client(fixture.SECURITY_TEST_USER_A_TOKEN);
const results = [];
const check = async (name, fn) => { try { await fn(); results.push(['PASS', name]); console.log(`PASS ${name}`); } catch (error) { results.push(['FAIL', name]); console.error(`FAIL ${name}: ${error.message}`); } };
const expect = (value, message) => { if (!value) throw new Error(message); };
const productId = `phase92-${Date.now()}`;
const created = await buyer.rpc('add_marketplace_item_to_cart', { p_item_id: 'mk1' });
if (created.error) throw new Error(`HARNESS_ERROR cannot create pending fixture: ${created.error.message}`);
const order = await buyer.rpc('create_marketplace_order', { p_idempotency_key: `phase92-${Date.now()}` });
if (order.error || order.data?.status !== 'pending') throw new Error(`HARNESS_ERROR pending order fixture failed: ${order.error?.message ?? order.data?.status}`);

await check('buyer cannot directly activate an entitlement', async () => {
  const result = await buyer.rpc('activate_marketplace_entitlement', { p_order_id: order.data.id });
  expect(result.error, 'buyer activation unexpectedly succeeded');
});
await check('pending order cannot activate an entitlement', async () => {
  const result = await buyer.rpc('activate_marketplace_entitlement', { p_order_id: order.data.id });
  expect(result.error, 'pending order activation unexpectedly succeeded');
});
await check('pending order has no active entitlement', async () => {
  const items = await buyer.from('marketplace_order_items').select('id').eq('order_id', order.data.id);
  expect(!items.error, items.error?.message ?? 'pending item lookup failed');
  const result = await buyer.from('marketplace_entitlements').select('id').in('order_item_id', (items.data ?? []).map((item) => item.id)).eq('status', 'active');
  expect(!result.error && result.data.length === 0, result.error?.message ?? 'active entitlement exists for pending order');
});
console.log(`MARKETPLACE_FULFILLMENT_RESULT PASS=${results.filter(([status]) => status === 'PASS').length} FAIL=${results.filter(([status]) => status === 'FAIL').length}`);
if (results.some(([status]) => status === 'FAIL')) process.exitCode = 1;
