import { useEffect, useMemo, useState } from 'react';
import { supabase, type DbCartItem } from '../lib/supabase';
import { Card, Badge } from '../components/ui';
import { Store, ShoppingCart, Search, Heart, X, Check, Trash2, Loader2 } from 'lucide-react';

const TYPES = ['الكل', 'دورة', 'بنك أسئلة', 'قالب امتحان', 'مسار تعلّم', 'مورد رقمي'];
type MarketplaceCatalogItem = { id: string; title: string; type: string; price: number; cover: string; category: string; isFulfillable: boolean };
const typeLabels: Record<string, string> = { question_bank: 'بنك أسئلة', learning_path: 'مسار تعلّم', exam_template: 'قالب امتحان', course: 'دورة', digital_resource: 'مورد رقمي' };

export function Marketplace() {
  const [products, setProducts] = useState<MarketplaceCatalogItem[]>([]);
  const [type, setType] = useState('الكل');
  const [search, setSearch] = useState('');
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [cart, setCart] = useState<DbCartItem[]>([]);
  const [showCart, setShowCart] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [checkingOut, setCheckingOut] = useState(false);
  const [ownedProductIds, setOwnedProductIds] = useState<Set<string>>(new Set());

  const refreshCart = async () => {
    const { data, error: cartError } = await supabase.from('cart_items').select('*').order('created_at', { ascending: false });
    if (cartError) setError('تعذر تحميل السلة حالياً.'); else setCart((data as DbCartItem[]) ?? []);
  };
  useEffect(() => {
    refreshCart();
    supabase.from('marketplace_entitlements').select('product_id').eq('status', 'active').then(({ data }) => {
      setOwnedProductIds(new Set(((data as { product_id: string }[]) ?? []).map((item) => item.product_id)));
    });
      supabase.from('marketplace_products').select('id, title, price, type, cover_url, fulfillment_target_type, question_bank_id').eq('is_active', true).order('created_at').then(({ data, error: productError }) => {
      setLoading(false);
      if (productError) { setError('تعذر تحميل الكتالوج حالياً.'); return; }
      setProducts(((data as { id: string; title: string; price: number; type: string; cover_url: string | null; fulfillment_target_type: string; question_bank_id: string | null }[]) ?? []).map((product) => ({ id: product.id, title: product.title, type: typeLabels[product.type] ?? 'مورد رقمي', price: Number(product.price), cover: product.cover_url ?? '', category: product.type, isFulfillable: product.type === 'question_bank' && product.fulfillment_target_type === 'question_bank' && Boolean(product.question_bank_id) })));
    });
  }, []);
  const filtered = useMemo(() => products.filter((product) => (type === 'الكل' || product.type === type) && (!search || product.title.includes(search))), [products, search, type]);
  const notify = (message: string) => { setToast(message); window.setTimeout(() => setToast(null), 2500); };
  const addToCart = async (item: MarketplaceCatalogItem) => { if (!item.isFulfillable) { notify('هذا المنتج غير متاح للشراء حالياً.'); return; } const { error: addError } = await supabase.rpc('add_marketplace_item_to_cart', { p_item_id: item.id }); if (addError) notify('تعذر إضافة المورد أو أنه لم يعد متاحاً.'); else { await refreshCart(); notify('تمت الإضافة إلى السلة.'); } };
  const removeFromCart = async (id: string) => { const { error: removeError } = await supabase.from('cart_items').delete().eq('id', id); if (!removeError) setCart((items) => items.filter((item) => item.id !== id)); };
  const checkout = async () => { setCheckingOut(true); const { data, error: checkoutError } = await supabase.rpc('create_marketplace_order', { p_idempotency_key: crypto.randomUUID() }); setCheckingOut(false); if (checkoutError || !data) { notify('الدفع غير متاح حالياً؛ لم يتم إكمال الشراء.'); return; } await refreshCart(); setShowCart(false); notify('تم إنشاء طلب معلّق فقط. الدفع والملكية الرقمية غير متاحين حالياً.'); };
  const toggleFavorite = (id: string) => setFavorites((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });

  return <div className="space-y-6">
    {toast && <div className="fixed top-20 left-1/2 z-50 -translate-x-1/2 rounded-xl bg-accent-600 px-4 py-2.5 text-sm font-600 text-white shadow-pop"><Check size={16} className="inline mr-2" />{toast}</div>}
    <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-accent-600 via-accent-700 to-ink-950 p-7 text-white"><Badge tone="gold"><Store size={11} /> السوق</Badge><h2 className="mt-3 max-w-xl font-display text-2xl font-800">موارد تعليمية منشورة للمعاينة.</h2><p className="mt-2 max-w-lg text-sm text-accent-100">الكتالوج متاح، لكن الدفع والشراء والتحميل المدفوع غير متاحين حالياً.</p></div>
    <div className="flex flex-wrap items-center gap-3"><div className="flex min-w-[200px] max-w-sm flex-1 items-center gap-2 rounded-xl border border-ink-200 bg-white px-3 py-2"><Search size={16} className="text-ink-400" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="ابحث في الكتالوج…" className="flex-1 bg-transparent text-sm outline-none" /></div><div className="flex gap-1.5 overflow-x-auto">{TYPES.map((itemType) => <button key={itemType} onClick={() => setType(itemType)} className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-600 ${type === itemType ? 'bg-ink-900 text-white' : 'border border-ink-200 bg-white text-ink-600'}`}>{itemType}</button>)}</div><button onClick={() => setShowCart(true)} className="btn-primary relative mr-auto"><ShoppingCart size={16} /> السلة{cart.length > 0 && <span className="absolute -left-1.5 -top-1.5 grid h-5 w-5 place-items-center rounded-full bg-danger-500 text-[10px] text-white">{cart.length}</span>}</button></div>
    {error && <Card className="p-6 text-center text-danger-700">{error}</Card>}
    {loading ? <Card className="p-8 text-center text-ink-500">جاري تحميل الكتالوج…</Card> : filtered.length === 0 ? <Card className="p-8 text-center text-ink-500">لا توجد موارد منشورة متاحة حالياً.</Card> : <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">{filtered.map((item) => <Card key={item.id} hover className="overflow-hidden"><div className="relative h-44"><img src={item.cover} alt={item.title} className="h-full w-full object-cover" /><button aria-label="إضافة إلى المفضلة" onClick={() => toggleFavorite(item.id)} className="absolute left-2.5 top-2.5 grid h-8 w-8 place-items-center rounded-full bg-white/90 text-ink-600"><Heart size={15} fill={favorites.has(item.id) ? 'currentColor' : 'none'} /></button></div><div className="p-4"><div className="flex items-start justify-between gap-2"><h3 className="min-h-[2.5rem] font-display font-700 text-ink-900">{item.title}</h3>{ownedProductIds.has(item.id) && <Badge tone="accent">مملوك</Badge>}</div><p className="mt-2 text-xs text-ink-500">{item.isFulfillable ? 'المبيعات والتقييمات غير متاحة بعد.' : 'هذا المنتج غير متاح للشراء حالياً.'}</p><div className="mt-4 flex items-center justify-between border-t border-ink-100 pt-3"><span className="font-display text-lg font-800 text-ink-900">${item.price.toFixed(2)}</span><button onClick={() => addToCart(item)} disabled={ownedProductIds.has(item.id) || !item.isFulfillable} className="btn-primary !px-3 !py-2 disabled:cursor-not-allowed disabled:opacity-50"><ShoppingCart size={15} /> {ownedProductIds.has(item.id) ? 'مملوك' : item.isFulfillable ? 'إضافة' : 'غير متاح'}</button></div></div></Card>)}</div>}
    {showCart && <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-950/50 p-4" onClick={() => setShowCart(false)}><div className="card flex max-h-[80vh] w-full max-w-md flex-col" onClick={(event) => event.stopPropagation()}><div className="flex items-center justify-between border-b border-ink-100 p-5"><h3 className="font-display font-700">السلة ({cart.length})</h3><button aria-label="إغلاق السلة" onClick={() => setShowCart(false)}><X size={18} /></button></div><div className="flex-1 space-y-3 overflow-y-auto p-4">{cart.length === 0 ? <p className="py-12 text-center text-sm text-ink-500">السلة فارغة</p> : cart.map((item) => <div key={item.id} className="flex items-center gap-3 rounded-xl border border-ink-100 p-3"><div className="min-w-0 flex-1"><p className="truncate text-sm font-600">{item.title}</p><p className="text-xs text-ink-500">السعر النهائي يحسبه الخادم.</p></div><button aria-label="حذف من السلة" onClick={() => removeFromCart(item.id)}><Trash2 size={15} /></button></div>)}</div>{cart.length > 0 && <div className="border-t border-ink-100 p-5"><button onClick={checkout} disabled={checkingOut} className="btn-primary w-full">{checkingOut ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />} إنشاء طلب معلّق</button></div>}</div></div>}
  </div>;
}
