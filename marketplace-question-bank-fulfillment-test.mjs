import { createClient } from '@supabase/supabase-js';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const fixture = JSON.parse(readFileSync(new URL('./test-results/security-local-fixtures.json', import.meta.url), 'utf8'));
const make = (token) => createClient(fixture.SECURITY_TEST_SUPABASE_URL, fixture.SECURITY_TEST_SUPABASE_ANON_KEY, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false, autoRefreshToken: false } });
const buyerA = make(fixture.SECURITY_TEST_USER_A_TOKEN);
const buyerB = make(fixture.SECURITY_TEST_USER_B_TOKEN);
const adminA = make(fixture.SECURITY_TEST_ADMIN_A_TOKEN);
const adminB = make(fixture.SECURITY_TEST_ADMIN_B_TOKEN);
const superAdmin = make(fixture.SECURITY_TEST_SUPER_ADMIN_TOKEN);
const status = JSON.parse(execFileSync('cmd.exe', ['/c', '.\\node_modules\\.bin\\supabase.cmd', 'status', '-o', 'json'], { encoding: 'utf8' }));
const privileged = createClient(status.API_URL, status.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const institutionA = '10000000-0000-4000-8000-000000000001';
const institutionB = '10000000-0000-4000-8000-000000000002';
const staffA = '21000000-0000-4000-8000-000000000002';
const results = [];
const check = async (name, fn) => { try { await fn(); results.push(['PASS', name]); console.log(`PASS ${name}`); } catch (error) { results.push(['FAIL', name]); console.error(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`); } };
const expect = (value, message) => { if (!value) throw new Error(message); };
const noError = (error, message) => expect(!error, `${message}: ${error?.message ?? 'unknown error'}`);
const deny = (error, message) => expect(Boolean(error), `${message}: unexpectedly succeeded`);
const id = (label) => `phase93-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
const product = async (admin, productId, price, institutionId) => { const result = await admin.rpc('create_marketplace_product', { p_id: productId, p_title: `Phase 9.3 ${productId}`, p_price: price, p_type: 'digital_resource', p_institution_id: institutionId }); noError(result.error, `create ${productId}`); return result.data; };
const bankA = crypto.randomUUID();
const bankB = crypto.randomUUID();
const questionA = crypto.randomUUID();
const questionB = crypto.randomUUID();
const optionA = crypto.randomUUID();

for (const [bankId, tenant, title] of [[bankA, institutionA, 'Phase 9.3 Bank A'], [bankB, institutionB, 'Phase 9.3 Bank B']]) {
  const bank = await privileged.from('question_banks').upsert({ id: bankId, institution_id: tenant, owner_staff_id: tenant === institutionA ? staffA : null, title, status: 'published' });
  noError(bank.error, `provision ${title}`);
}
const questions = await privileged.from('questions').upsert([
  { id: questionA, institution_id: institutionA, teacher_id: staffA, question_bank_id: bankA, type: 'multiple_choice', prompt: 'Phase 9.3 protected question A', difficulty: 'easy', points: 1, is_public: false },
  { id: questionB, institution_id: institutionB, question_bank_id: bankB, type: 'multiple_choice', prompt: 'Phase 9.3 protected question B', difficulty: 'easy', points: 1, is_public: false },
]);
noError(questions.error, 'provision questions');
const options = await privileged.from('question_options').upsert([{ id: optionA, question_id: questionA, label: 'Buyer-visible option', is_correct: true, sort_order: 0 }]);
noError(options.error, 'provision options');

const productA = id('product-a');
const productB = id('product-b');
const createdA = await adminA.rpc('create_marketplace_product', { p_id: productA, p_title: 'Phase 9.3 Question Bank A', p_price: 15, p_type: 'digital_resource', p_institution_id: institutionA });
noError(createdA.error, 'create product A');
const mapping = await adminA.rpc('map_marketplace_product_to_question_bank', { p_product_id: productA, p_question_bank_id: bankA });
noError(mapping.error, 'map product A'); expect(mapping.data.question_bank_id === bankA, 'mapping does not return FK target');
await check('authorized manager maps own Question Bank', async () => expect(mapping.data.type === 'question_bank', 'wrong product type'));
await check('unauthorized manager cannot map foreign Question Bank', async () => { const r = await adminA.rpc('map_marketplace_product_to_question_bank', { p_product_id: productA, p_question_bank_id: bankB }); deny(r.error, 'foreign mapping'); });

const pending = await buyerA.rpc('add_marketplace_item_to_cart', { p_item_id: productA });
noError(pending.error, 'add product A');
const pendingOrder = await buyerA.rpc('create_marketplace_order', { p_idempotency_key: id('pending') });
noError(pendingOrder.error, 'create pending order'); expect(pendingOrder.data.status === 'pending', 'fixture order is not pending');
await check('pending order activation is denied', async () => { const r = await buyerA.rpc('activate_marketplace_entitlement', { p_order_id: pendingOrder.data.id }); deny(r.error, 'pending activation'); });
await check('buyer direct activation is denied', async () => { const r = await buyerA.rpc('activate_marketplace_entitlement', { p_order_id: pendingOrder.data.id }); deny(r.error, 'buyer activation'); });

const paid = await privileged.from('marketplace_orders').update({ status: 'paid', payment_provider: 'test-fixture-payment-verified' }).eq('id', pendingOrder.data.id).select('id').single();
noError(paid.error, 'controlled paid fixture');
const activated = await privileged.rpc('activate_marketplace_entitlement', { p_order_id: pendingOrder.data.id });
noError(activated.error, 'trusted activation'); expect(activated.data?.length === 1, 'trusted activation did not return one entitlement');
await check('trusted paid-fixture activation works', async () => { const entitlement = activated.data[0]; expect(entitlement.status === 'active' && entitlement.user_id === pendingOrder.data.user_id && entitlement.product_id === productA && entitlement.fulfillment_target_key === bankA, 'incorrect entitlement mapping'); expect(entitlement.activated_at, 'missing activation timestamp'); });
await check('sequential activation is idempotent', async () => { const again = await privileged.rpc('activate_marketplace_entitlement', { p_order_id: pendingOrder.data.id }); noError(again.error, 'activation retry'); expect(again.data?.[0]?.id === activated.data[0].id, 'retry returned another entitlement'); const q = await buyerA.from('marketplace_entitlements').select('id').eq('order_item_id', activated.data[0].order_item_id); noError(q.error, 'entitlement count'); expect(q.data?.length === 1, 'duplicate entitlement exists'); });
await check('entitled buyer reads purchased Question Bank through consumer RPC', async () => { const r = await buyerA.rpc('get_marketplace_question_bank', { p_product_id: productA }); noError(r.error, 'consumer access'); expect(r.data?.length === 1 && r.data[0].question_bank_id === bankA, 'purchased bank unavailable'); expect(!('is_correct' in r.data[0].options[0]), 'answer key leaked'); });
await check('non-entitled buyer is denied purchased Question Bank', async () => { const r = await buyerB.rpc('get_marketplace_question_bank', { p_product_id: productA }); deny(r.error, 'non-entitled access'); });
await check('cross-buyer and other-bank access are denied', async () => { const cross = await buyerB.from('question_banks').select('id').eq('id', bankA); const other = await buyerA.from('question_banks').select('id').eq('id', bankB); noError(cross.error, 'cross buyer bank read'); noError(other.error, 'other bank read'); expect(cross.data?.length === 0 && other.data?.length === 0, 'unrelated bank visible'); });
await check('entitled buyer cannot mutate bank or questions', async () => { const bankUpdate = await buyerA.from('question_banks').update({ title: 'tampered' }).eq('id', bankA).select('id'); const questionUpdate = await buyerA.from('questions').update({ prompt: 'tampered' }).eq('id', questionA).select('id'); const optionInsert = await buyerA.from('question_options').insert({ question_id: questionA, label: 'tampered', is_correct: false, sort_order: 2 }).select('id'); expect(Boolean(bankUpdate.error) || bankUpdate.data?.length === 0, 'bank update was not denied'); expect(Boolean(questionUpdate.error) || questionUpdate.data?.length === 0, 'question update was not denied'); deny(optionInsert.error, 'option insert'); });
await check('cross-tenant manager cannot mutate product', async () => { const r = await adminB.rpc('update_marketplace_product', { p_id: productA, p_title: 'cross tenant', p_price: 1, p_type: 'question_bank', p_cover_url: null }); deny(r.error, 'cross tenant product update'); });
await check('institution staff retains Question Bank access and cross-tenant staff is denied', async () => { const ownBank = await adminA.from('question_banks').select('id').eq('id', bankA); const ownQuestions = await adminA.from('questions').select('id').eq('question_bank_id', bankA); const foreignBank = await adminB.from('question_banks').select('id').eq('id', bankA); noError(ownBank.error, 'staff own bank'); noError(ownQuestions.error, 'staff own questions'); noError(foreignBank.error, 'cross tenant staff bank'); expect(ownBank.data?.length === 1 && ownQuestions.data?.length === 1 && foreignBank.data?.length === 0, 'Question Bank tenant regression'); });
await check('existing entitlement survives product unpublish but new purchase is blocked', async () => { const archive = await adminA.rpc('set_marketplace_product_active', { p_id: productA, p_is_active: false }); noError(archive.error, 'unpublish product'); const access = await buyerA.rpc('get_marketplace_question_bank', { p_product_id: productA }); noError(access.error, 'owned access after unpublish'); expect(access.data?.length === 1, 'owned access lost'); const add = await buyerA.rpc('add_marketplace_item_to_cart', { p_item_id: productA }); deny(add.error, 'unpublished product add'); });
await check('archived resource becomes unavailable without deleting entitlement history', async () => { const archive = await privileged.from('question_banks').update({ status: 'archived' }).eq('id', bankA); noError(archive.error, 'archive bank'); const access = await buyerA.rpc('get_marketplace_question_bank', { p_product_id: productA }); deny(access.error, 'archived resource access'); const entitlement = await buyerA.from('marketplace_entitlements').select('id,status').eq('product_id', productA); noError(entitlement.error, 'archived entitlement history'); expect(entitlement.data?.length === 1 && entitlement.data[0].status === 'active', 'entitlement history corrupted'); });

const productC = id('concurrent');
await product(adminA, productC, 18, institutionA);
await privileged.from('question_banks').update({ status: 'published' }).eq('id', bankA);
const mapC = await adminA.rpc('map_marketplace_product_to_question_bank', { p_product_id: productC, p_question_bank_id: bankA });
noError(mapC.error, 'map concurrent product');
const orderC = await (async () => { const a = await buyerA.rpc('add_marketplace_item_to_cart', { p_item_id: productC }); noError(a.error, 'concurrent add'); const o = await buyerA.rpc('create_marketplace_order', { p_idempotency_key: id('concurrent-order') }); noError(o.error, 'concurrent order'); const p = await privileged.from('marketplace_orders').update({ status: 'paid', payment_provider: 'test-fixture-payment-verified' }).eq('id', o.data.id).select('id').single(); noError(p.error, 'concurrent paid fixture'); return o.data; })();
const concurrent = await Promise.allSettled([1, 2].map(() => privileged.rpc('activate_marketplace_entitlement', { p_order_id: orderC.id })));
await check('concurrent trusted activation is idempotent', async () => { const successful = concurrent.filter((r) => r.status === 'fulfilled' && !r.value.error); expect(successful.length === 2, concurrent.map((r) => r.status === 'fulfilled' ? r.value.error?.message ?? 'ok' : r.reason?.message).join('; ')); expect(successful[0].value.data[0].id === successful[1].value.data[0].id, 'duplicate concurrent entitlement'); const q = await buyerA.from('marketplace_entitlements').select('id').eq('order_item_id', successful[0].value.data[0].order_item_id); noError(q.error, 'concurrent entitlement count'); expect(q.data?.length === 1, 'more than one entitlement'); });

console.log(`MARKETPLACE_QUESTION_BANK_RESULT PASS=${results.filter(([s]) => s === 'PASS').length} FAIL=${results.filter(([s]) => s === 'FAIL').length}`);
if (results.some(([s]) => s === 'FAIL')) process.exitCode = 1;
