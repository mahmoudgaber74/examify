import { useState, useEffect } from 'react';
import { MARKETPLACE, type MarketplaceItem } from '../lib/data';
import { supabase, type DbCartItem } from '../lib/supabase';
import { Card, Badge, SectionHeader } from '../components/ui';
import {
  Store, Star, ShoppingCart, Search, Plus, TrendingUp,
  DollarSign, Users, ArrowUpRight, Heart, X, Check, Trash2, Loader2,
} from 'lucide-react';

const TYPES = ['الكل', 'دورة', 'بنك أسئلة', 'قالب امتحان', 'مسار تعلّم', 'مورد رقمي'];

export function Marketplace() {
  const [type, setType] = useState('الكل');
  const [search, setSearch] = useState('');
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [cart, setCart] = useState<DbCartItem[]>([]);
  const [showCart, setShowCart] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [checkingOut, setCheckingOut] = useState(false);

  const filtered = MARKETPLACE.filter((m) => {
    const matchesType = type === 'الكل' || m.type === type;
    const matchesSearch = !search || m.title.includes(search) || m.author.includes(search);
    return matchesType && matchesSearch;
  });

  const fetchCart = async () => {
    const { data } = await supabase.from('cart_items').select('*').order('created_at', { ascending: false });
    if (data) setCart(data as DbCartItem[]);
  };

  useEffect(() => { fetchCart(); }, []);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  };

  const addToCart = async (item: MarketplaceItem) => {
    const exists = cart.some((c) => c.item_id === item.id);
    if (exists) {
      showToast('العنصر موجود في السلة بالفعل');
      return;
    }
    const { error } = await supabase.from('cart_items').insert({
      item_id: item.id,
      title: item.title,
      price: item.price,
      cover_url: item.cover,
      type: item.type,
    });
    if (!error) {
      fetchCart();
      showToast('تمت الإضافة للسلة');
    }
  };

  const removeFromCart = async (id: string) => {
    const { error } = await supabase.from('cart_items').delete().eq('id', id);
    if (!error) {
      setCart((prev) => prev.filter((c) => c.id !== id));
    }
  };

  const toggleFav = (id: string) => {
    setFavorites((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const checkout = async () => {
    setCheckingOut(true);
    setTimeout(async () => {
      for (const item of cart) {
        await supabase.from('cart_items').delete().eq('id', item.id);
      }
      setCart([]);
      setCheckingOut(false);
      setShowCart(false);
      showToast('تم إتمام الشراء بنجاح');
    }, 1500);
  };

  const cartTotal = cart.reduce((s, c) => s + Number(c.price), 0);

  return (
    <div className="space-y-6">
      {toast && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-4 py-2.5 rounded-xl bg-accent-600 text-white shadow-pop animate-fade-in">
          <Check size={16} /> <span className="text-sm font-600">{toast}</span>
        </div>
      )}

      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-accent-600 via-accent-700 to-ink-950 text-white p-7 lg:p-9">
        <div className="absolute inset-0 grid-bg opacity-15" />
        <div className="absolute -left-16 -bottom-16 w-64 h-64 rounded-full bg-accent-400/20 blur-3xl" />
        <div className="relative">
          <Badge tone="gold"><Store size={11} /> السوق</Badge>
          <h2 className="font-display text-2xl lg:text-3xl font-800 mt-3 max-w-xl text-balance">
            اشترِ وبِع الدورات وبنوك الأسئلة وقوالب الامتحانات.
          </h2>
          <p className="text-accent-100 mt-2 max-w-lg text-sm lg:text-base">
            مشاركة إيرادات للمعلّمين والمؤسسات. تقسيم 70/30. مدفوعات فورية.
          </p>
          <div className="flex flex-wrap gap-2.5 mt-5">
            <button className="btn bg-white text-ink-900 hover:bg-ink-100"><Plus size={16} /> اعرض مورداً</button>
            <button className="btn bg-white/10 text-white border border-white/20 hover:bg-white/20 backdrop-blur">كن بائعاً</button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'إجمالي المبيعات (30 يوم)', value: '1.24M$', icon: DollarSign, tone: 'text-accent-600 bg-accent-50' },
          { label: 'بائعون نشطون', value: '4,820', icon: Users, tone: 'text-brand-600 bg-brand-50' },
          { label: 'عناصر معروضة', value: '18,400', icon: Store, tone: 'text-gold-600 bg-gold-500/10' },
          { label: 'متوسط التقييم', value: '4.8/5', icon: Star, tone: 'text-brand-600 bg-brand-50' },
        ].map((s) => (
          <Card key={s.label} className="p-4 flex items-center gap-3">
            <div className={`grid place-items-center w-10 h-10 rounded-xl ${s.tone}`}><s.icon size={20} /></div>
            <div><p className="text-xs text-ink-500">{s.label}</p><p className="font-display font-700 text-ink-900 text-lg nums-latin">{s.value}</p></div>
          </Card>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white border border-ink-200 flex-1 min-w-[200px] max-w-sm">
          <Search size={16} className="text-ink-400" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="ابحث في السوق…" className="bg-transparent text-sm outline-none flex-1 placeholder:text-ink-400" />
        </div>
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
          {TYPES.map((t) => (
            <button key={t} onClick={() => setType(t)} className={`px-3 py-1.5 rounded-lg text-xs font-600 whitespace-nowrap transition ${type === t ? 'bg-ink-900 text-white' : 'bg-white border border-ink-200 text-ink-600 hover:bg-ink-50'}`}>{t}</button>
          ))}
        </div>
        <button onClick={() => setShowCart(true)} className="btn-primary mr-auto relative">
          <ShoppingCart size={16} /> السلة
          {cart.length > 0 && <span className="absolute -top-1.5 -left-1.5 grid place-items-center w-5 h-5 rounded-full bg-danger-500 text-white text-[10px] font-700 nums-latin">{cart.length}</span>}
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
        {filtered.map((item: MarketplaceItem) => (
          <Card key={item.id} hover className="overflow-hidden group">
            <div className="relative h-44 overflow-hidden">
              <img src={item.cover} alt={item.title} className="absolute inset-0 w-full h-full object-cover transition-transform duration-500 group-hover:scale-105" />
              <div className="absolute inset-0 bg-gradient-to-t from-ink-950/60 to-transparent" />
              <div className="absolute top-2.5 right-2.5"><Badge tone="brand">{item.type}</Badge></div>
              <button onClick={() => toggleFav(item.id)} className={`absolute top-2.5 left-2.5 grid place-items-center w-8 h-8 rounded-full transition ${favorites.has(item.id) ? 'bg-danger-500 text-white' : 'bg-white/90 text-ink-600 hover:bg-white hover:text-danger-500'}`}><Heart size={15} fill={favorites.has(item.id) ? 'currentColor' : 'none'} /></button>
              <div className="absolute bottom-2.5 right-2.5 text-white">
                <p className="text-[10px] text-ink-200">{item.category}</p>
              </div>
            </div>
            <div className="p-4">
              <h3 className="font-display font-700 text-ink-900 leading-tight line-clamp-2 min-h-[2.5rem]">{item.title}</h3>
              <p className="text-xs text-ink-500 mt-1">بقلم {item.author}</p>
              <div className="flex items-center gap-3 mt-3 text-xs text-ink-500 nums-latin">
                <span className="flex items-center gap-0.5"><Star size={12} className="text-gold-500 fill-gold-500" /> {item.rating}</span>
                <span className="flex items-center gap-0.5"><ShoppingCart size={12} /> {item.sales.toLocaleString()} مبيع</span>
                <span className="flex items-center gap-0.5 text-accent-600"><TrendingUp size={12} /> رائج</span>
              </div>
              <div className="flex items-center justify-between mt-4 pt-3 border-t border-ink-100">
                <div>
                  <p className="text-[10px] text-ink-400">السعر</p>
                  <p className="font-display text-lg font-800 text-ink-900 nums-latin">${item.price}</p>
                </div>
                <button onClick={() => addToCart(item)} className="btn-primary !py-2 !px-3"><ShoppingCart size={15} /> <span className="hidden sm:inline">أضف للسلة</span></button>
              </div>
            </div>
          </Card>
        ))}
      </div>

      <Card className="p-6">
        <SectionHeader title="مشاركة إيرادات البائعين" subtitle="مدفوعات فورية وشفّافة" action={<ArrowUpRight size={18} className="text-accent-600" />} />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[
            { tier: 'قياسي', seller: '70%', platform: '30%', note: 'يبدأ جميع البائعين هنا', active: false },
            { tier: 'معلّم موثّق', seller: '80%', platform: '20%', note: 'بعد 100 مبيع', active: true },
            { tier: 'مؤسسة شريكة', seller: '85%', platform: '15%', note: 'عقود مؤسسية', active: false },
          ].map((t) => (
            <div key={t.tier} className={`p-5 rounded-xl border-2 ${t.active ? 'border-brand-500 bg-brand-50/40' : 'border-ink-100'}`}>
              <div className="flex items-center justify-between mb-2">
                <p className="font-700 text-ink-900">{t.tier}</p>
                {t.active && <Badge tone="brand">الأكثر شيوعاً</Badge>}
              </div>
              <div className="flex items-end gap-1 mb-3">
                <span className="font-display text-3xl font-800 text-ink-900 nums-latin">{t.seller}</span>
                <span className="text-sm text-ink-400 mb-1">للبائع</span>
              </div>
              <p className="text-xs text-ink-500">{t.note}</p>
              <div className="mt-3"><div className="h-2 rounded-full bg-ink-100 overflow-hidden"><div className="h-full bg-accent-500" style={{ width: t.seller }} /></div></div>
            </div>
          ))}
        </div>
      </Card>

      {/* نافذة السلة */}
      {showCart && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-ink-950/50 backdrop-blur-sm animate-fade-in" onClick={() => setShowCart(false)}>
          <div className="card w-full max-w-md max-h-[80vh] flex flex-col animate-slide-in" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-5 border-b border-ink-100">
              <h3 className="font-display font-700 text-ink-900 flex items-center gap-2"><ShoppingCart size={18} /> سلة التسوق ({cart.length})</h3>
              <button onClick={() => setShowCart(false)} className="grid place-items-center w-8 h-8 rounded-lg text-ink-400 hover:bg-ink-100"><X size={18} /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {cart.length === 0 ? (
                <div className="text-center py-12">
                  <div className="grid place-items-center w-14 h-14 rounded-2xl bg-ink-50 text-ink-300 mx-auto mb-3"><ShoppingCart size={26} /></div>
                  <p className="text-sm text-ink-500">سلتك فارغة</p>
                </div>
              ) : cart.map((item) => (
                <div key={item.id} className="flex items-center gap-3 p-3 rounded-xl border border-ink-100">
                  {item.cover_url && <img src={item.cover_url} alt={item.title} className="w-12 h-12 rounded-lg object-cover" />}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-600 text-ink-900 truncate">{item.title}</p>
                    <p className="text-xs text-ink-500">{item.type}</p>
                  </div>
                  <p className="text-sm font-700 text-ink-900 nums-latin">${item.price}</p>
                  <button onClick={() => removeFromCart(item.id)} className="grid place-items-center w-7 h-7 rounded-lg text-ink-400 hover:bg-danger-50 hover:text-danger-600 transition"><Trash2 size={14} /></button>
                </div>
              ))}
            </div>
            {cart.length > 0 && (
              <div className="p-5 border-t border-ink-100 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-ink-500">الإجمالي</span>
                  <span className="font-display text-xl font-800 text-ink-900 nums-latin">${cartTotal.toFixed(2)}</span>
                </div>
                <button onClick={checkout} disabled={checkingOut} className="btn-primary w-full disabled:opacity-60">
                  {checkingOut ? <><Loader2 size={16} className="animate-spin" /> جارٍ الدفع…</> : <><Check size={16} /> إتمام الشراء</>}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
