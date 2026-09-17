import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, BarChart3, Loader2, RefreshCw, TrendingDown, Users } from 'lucide-react';
import { Card, ProgressBar, SectionHeader } from '../components/ui';
import { supabase } from '../lib/auth-helpers';

type FunnelRange = '7' | '30' | '90' | 'all';
type MarketingEventRow = {
  event_name: string;
  client_id: string;
  occurred_at: string;
  parameters: Record<string, unknown> | null;
};

const RANGES: { value: FunnelRange; label: string }[] = [
  { value: '7', label: '7 أيام' },
  { value: '30', label: '30 يومًا' },
  { value: '90', label: '90 يومًا' },
  { value: 'all', label: 'كل الوقت' },
];

const STAGES = [
  { event: 'page_view', label: 'زوار الصفحة' },
  { event: 'cta_click', label: 'ضغطوا على ابدأ' },
  { event: 'signup_start', label: 'فتحوا التسجيل' },
  { event: 'signup_submit', label: 'أرسلوا التسجيل' },
  { event: 'sign_up', label: 'أكملوا التسجيل' },
];

function rangeStart(range: FunnelRange) {
  if (range === 'all') return null;
  const start = new Date();
  start.setDate(start.getDate() - Number(range));
  return start.toISOString();
}

export function MarketingFunnel() {
  const [range, setRange] = useState<FunnelRange>('30');
  const [rows, setRows] = useState<MarketingEventRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    let query = supabase.from('marketing_events').select('event_name, client_id, occurred_at, parameters').order('occurred_at', { ascending: false }).limit(10000);
    const start = rangeStart(range);
    if (start) query = query.gte('occurred_at', start);
    const { data, error: queryError } = await query;
    if (queryError) setError(queryError.message);
    setRows((data as MarketingEventRow[]) ?? []);
    setLoading(false);
  }, [range]);

  useEffect(() => { void load(); }, [load]);

  const metrics = useMemo(() => {
    const stages = STAGES.map((stage) => ({ ...stage, count: new Set(rows.filter((row) => row.event_name === stage.event).map((row) => row.client_id)).size }));
    const sources = new Map<string, Set<string>>();
    for (const row of rows) {
      const source = typeof row.parameters?.utm_source === 'string' ? row.parameters.utm_source : 'مباشر / غير محدد';
      const clients = sources.get(source) ?? new Set<string>();
      clients.add(row.client_id);
      sources.set(source, clients);
    }
    return { stages, sources: Array.from(sources.entries()).map(([source, clients]) => ({ source, count: clients.size })).sort((a, b) => b.count - a.count).slice(0, 5) };
  }, [rows]);

  const visitors = metrics.stages[0]?.count ?? 0;
  const completed = metrics.stages[metrics.stages.length - 1]?.count ?? 0;
  const conversion = visitors ? (completed / visitors) * 100 : 0;

  if (loading) return <Card className="flex items-center justify-center p-8"><Loader2 size={24} className="animate-spin text-brand-600" /></Card>;

  return <Card className="p-5" data-testid="marketing-funnel">
    <SectionHeader
      title="Funnel التسويق والتسجيل"
      subtitle="قياس رحلة الزائر من صفحة التسويق حتى إنشاء الحساب"
      action={<button type="button" onClick={() => void load()} className="btn-outline"><RefreshCw size={15} /> تحديث</button>}
    />
    {error ? <div className="mt-4 flex items-center gap-2 rounded-xl bg-danger-50 p-3 text-sm text-danger-700"><AlertCircle size={17} /> تعذر تحميل بيانات الـFunnel: {error}</div> : <>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1 rounded-xl border border-ink-100 bg-ink-50 p-1">{RANGES.map((item) => <button type="button" key={item.value} onClick={() => setRange(item.value)} className={`rounded-lg px-3 py-1.5 text-xs font-600 ${range === item.value ? 'bg-brand-600 text-white' : 'text-ink-600 hover:bg-white'}`}>{item.label}</button>)}</div>
        <div className="flex items-center gap-2 text-sm text-ink-500"><TrendingDown size={16} className="text-brand-600" /> التحويل الكلي: <strong className="nums-latin text-ink-900">{conversion.toFixed(1)}%</strong></div>
      </div>
      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {metrics.stages.map((stage, index) => <div key={stage.event} className="rounded-2xl border border-ink-100 bg-ink-50/70 p-3"><div className="flex items-center gap-2 text-xs text-ink-500"><span className="flex h-6 w-6 items-center justify-center rounded-lg bg-white font-800 text-brand-700">{index + 1}</span>{stage.label}</div><p className="mt-3 font-display text-2xl font-800 nums-latin">{stage.count}</p><ProgressBar value={visitors ? (stage.count / visitors) * 100 : 0} tone={index === metrics.stages.length - 1 ? 'accent' : 'brand'} className="mt-2" /></div>)}
      </div>
      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-ink-100 p-4"><div className="flex items-center gap-2 font-700"><Users size={17} className="text-brand-600" /> مصادر الزيارات</div>{metrics.sources.length ? <div className="mt-4 space-y-3">{metrics.sources.map((source) => <div key={source.source} className="flex items-center justify-between text-sm"><span className="truncate text-ink-600">{source.source}</span><span className="nums-latin font-700 text-ink-900">{source.count}</span></div>)}</div> : <p className="mt-4 text-sm text-ink-400">لا توجد بيانات كافية بعد.</p>}</div>
        <div className="rounded-2xl border border-ink-100 p-4"><div className="flex items-center gap-2 font-700"><BarChart3 size={17} className="text-accent-600" /> قراءة سريعة</div><p className="mt-4 text-sm leading-7 text-ink-500">كل رقم يمثل مستخدمًا مجهول الهوية مرة واحدة في المرحلة. استخدم هذه النسب لمعرفة الصفحة أو الرسالة التي تحتاج تحسينًا.</p><div className="mt-3 rounded-xl bg-accent-50 p-3 text-sm text-accent-800">أكمل التسجيل: <strong className="nums-latin">{completed}</strong> من <strong className="nums-latin">{visitors}</strong> زائر.</div></div>
      </div>
    </>}
  </Card>;
}
