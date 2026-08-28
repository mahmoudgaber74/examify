import { useState, useEffect } from 'react';
import { CERTIFICATES, type Certificate } from '../lib/data';
import { supabase, type DbCertificate } from '../lib/supabase';
import { Card, Badge, SectionHeader, ProgressBar } from '../components/ui';
import {
  Award, QrCode, Link2, Download, Search, Plus, ShieldCheck, Sparkles,
  CheckCircle2, Eye, Send, X, Loader2,
} from 'lucide-react';

const VERIFY_TONE: Record<string, 'brand' | 'accent' | 'warning'> = {
  'بلوكشين': 'brand',
  'QR': 'accent',
  'قيد المراجعة': 'warning',
};

function mapCert(db: DbCertificate): Certificate {
  return {
    id: db.id,
    recipient: db.recipient,
    program: db.program,
    issuer: db.issuer,
    issued: db.issued_date ?? '',
    credentialId: db.credential_id,
    verified: db.verified_method as Certificate['verified'],
    score: db.score,
  };
}

export function Certification() {
  const [certificates, setCertificates] = useState<Certificate[]>(CERTIFICATES);
  const [selected, setSelected] = useState<Certificate>(CERTIFICATES[0]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showIssue, setShowIssue] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [form, setForm] = useState({ recipient: '', program: '', issuer: '', score: 80 });

  const fetchCerts = async () => {
    setLoading(true);
    const { data } = await supabase.from('certificates').select('*').order('issued_date', { ascending: false });
    if (data && data.length > 0) {
      const mapped = (data as DbCertificate[]).map(mapCert);
      setCertificates(mapped);
      setSelected(mapped[0]);
    }
    setLoading(false);
  };

  useEffect(() => { fetchCerts(); }, []);

  const filtered = certificates.filter((c) => !search || c.recipient.includes(search) || c.program.includes(search));

  const issueCert = async () => {
    if (!form.recipient.trim() || !form.program.trim()) return;
    const credId = `EXM-${form.program.slice(0, 2).toUpperCase()}-2026-${String(Math.floor(Math.random() * 9999)).padStart(4, '0')}`;
    const { error } = await supabase.from('certificates').insert({
      recipient: form.recipient,
      program: form.program,
      issuer: form.issuer || 'إكزاميفاي AI',
      issued_date: new Date().toISOString().slice(0, 10),
      credential_id: credId,
      verified_method: 'قيد المراجعة',
      score: form.score,
    });
    if (!error) {
      setShowIssue(false);
      setForm({ recipient: '', program: '', issuer: '', score: 80 });
      setToast('تم إصدار الشهادة بنجاح');
      setTimeout(() => setToast(null), 2500);
      fetchCerts();
    }
  };

  const verifyCert = async () => {
    setVerifying(true);
    setTimeout(async () => {
      const { error } = await supabase.from('certificates').update({ verified_method: 'بلوكشين' }).eq('id', selected.id);
      if (!error) {
        setCertificates((prev) => prev.map((c) => c.id === selected.id ? { ...c, verified: 'بلوكشين' } : c));
        setSelected((prev) => ({ ...prev, verified: 'بلوكشين' }));
        setToast('تم التحقق من الشهادة على البلوكشين');
        setTimeout(() => setToast(null), 2500);
      }
      setVerifying(false);
    }, 1500);
  };

  return (
    <div className="space-y-6">
      {toast && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-4 py-2.5 rounded-xl bg-accent-600 text-white shadow-pop animate-fade-in">
          <CheckCircle2 size={16} /> <span className="text-sm font-600">{toast}</span>
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'مُصدرة (30 يوم)', value: '12,840', icon: Award, tone: 'text-brand-600 bg-brand-50' },
          { label: 'موثّقة بالبلوكشين', value: String(certificates.filter((c) => c.verified === 'بلوكشين').length), icon: Link2, tone: 'text-accent-600 bg-accent-50' },
          { label: 'موثّقة بـ QR', value: String(certificates.filter((c) => c.verified === 'QR').length), icon: QrCode, tone: 'text-gold-600 bg-gold-500/10' },
          { label: 'قيد المراجعة', value: String(certificates.filter((c) => c.verified === 'قيد المراجعة').length), icon: Eye, tone: 'text-warning-600 bg-warning-50' },
        ].map((s) => (
          <Card key={s.label} className="p-4 flex items-center gap-3">
            <div className={`grid place-items-center w-10 h-10 rounded-xl ${s.tone}`}><s.icon size={20} /></div>
            <div><p className="text-xs text-ink-500">{s.label}</p><p className="font-display font-700 text-ink-900 text-lg nums-latin">{s.value}</p></div>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <Card className="p-0 overflow-hidden">
          <div className="p-5 border-b border-ink-100">
            <SectionHeader title="الاعتمادات المُصدرة" />
            <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-ink-50 mt-2">
              <Search size={15} className="text-ink-400" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="ابحث عن مستلمين…" className="bg-transparent text-sm outline-none flex-1 placeholder:text-ink-400" />
            </div>
          </div>
          <div className="divide-y divide-ink-50 max-h-[520px] overflow-y-auto">
            {loading ? (
              <div className="p-8 text-center"><Loader2 size={24} className="animate-spin text-brand-600 mx-auto" /></div>
            ) : filtered.map((c) => (
              <button key={c.id} onClick={() => setSelected(c)} className={`w-full text-right p-4 hover:bg-ink-50 transition flex items-center gap-3 ${selected.id === c.id ? 'bg-brand-50/60 border-r-2 border-brand-600' : ''}`}>
                <div className="grid place-items-center w-10 h-10 rounded-xl bg-gradient-to-br from-gold-400 to-gold-600 text-white"><Award size={18} /></div>
                <div className="flex-1 min-w-0">
                  <p className="font-600 text-sm text-ink-900 truncate">{c.recipient}</p>
                  <p className="text-xs text-ink-500 truncate">{c.program}</p>
                  <p className="text-[11px] text-ink-400 mt-0.5 font-mono nums-latin">{c.credentialId}</p>
                </div>
                <Badge tone={VERIFY_TONE[c.verified]}>{c.verified}</Badge>
              </button>
            ))}
          </div>
        </Card>

        <Card className="xl:col-span-2 p-6">
          <SectionHeader title="معاينة الاعتماد" subtitle={selected.credentialId} action={<button onClick={() => setShowIssue(true)} className="btn-primary"><Plus size={16} /> إصدار جديد</button>} />
          <div className="relative rounded-2xl overflow-hidden bg-gradient-to-br from-ink-950 via-brand-900 to-brand-700 p-8 text-white">
            <div className="absolute inset-0 grid-bg opacity-15" />
            <div className="absolute top-4 left-4"><Sparkles size={28} className="text-brand-300/60" /></div>
            <div className="relative">
              <div className="flex items-center justify-between mb-8">
                <div className="flex items-center gap-2">
                  <div className="grid place-items-center w-9 h-9 rounded-lg bg-white/10"><Award size={18} /></div>
                  <div><p className="text-xs tracking-widest text-brand-200">إكزاميفاي AI</p><p className="text-[10px] text-ink-300">شهادة إنجاز</p></div>
                </div>
                <Badge tone={VERIFY_TONE[selected.verified]}>{selected.verified}</Badge>
              </div>
              <p className="text-sm text-ink-300">تشهد هذه الشهادة بأن</p>
              <p className="font-display text-3xl font-800 my-1">{selected.recipient}</p>
              <p className="text-sm text-ink-300 mb-6">قد أتمّ بنجاح</p>
              <p className="font-display text-xl font-700 text-brand-200">{selected.program}</p>
              <p className="text-sm text-ink-300 mt-1">صادرة من {selected.issuer}</p>
              <div className="flex items-end justify-between mt-8 pt-6 border-t border-white/10">
                <div>
                  <p className="text-[10px] tracking-widest text-ink-400">الدرجة النهائية</p>
                  <p className="font-display text-2xl font-800 nums-latin">{selected.score}%</p>
                </div>
                <div>
                  <p className="text-[10px] tracking-widest text-ink-400">تاريخ الإصدار</p>
                  <p className="text-sm font-600 nums-latin">{selected.issued}</p>
                </div>
                <div className="grid place-items-center w-16 h-16 rounded-lg bg-white p-1.5">
                  <QrCode size={48} className="text-ink-950" />
                </div>
              </div>
              <p className="text-[10px] text-ink-400 mt-4 font-mono nums-latin">المعرّف: {selected.credentialId} · تحقّق على verify.examify.ai</p>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-5">
            {[
              { label: 'التحقق', value: selected.verified, icon: ShieldCheck },
              { label: 'الدرجة', value: `${selected.score}%`, icon: Award },
              { label: 'المُصدِر', value: selected.issuer, icon: Send },
              { label: 'الحالة', value: 'صالحة', icon: CheckCircle2 },
            ].map((m) => (
              <div key={m.label} className="rounded-xl border border-ink-100 p-3">
                <m.icon size={15} className="text-ink-400 mb-1" />
                <p className="text-[11px] text-ink-500">{m.label}</p>
                <p className="text-sm font-700 text-ink-900 truncate">{m.value}</p>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap gap-2 mt-5">
            <button onClick={verifyCert} disabled={verifying || selected.verified === 'بلوكشين'} className="btn-primary disabled:opacity-60">
              {verifying ? <><Loader2 size={16} className="animate-spin" /> جارٍ التحقق…</> : <><Link2 size={16} /> تحقّق على السلسلة</>}
            </button>
            <button className="btn-outline"><Download size={16} /> تحميل PDF</button>
            <button className="btn-outline"><Send size={16} /> مشاركة</button>
          </div>
        </Card>
      </div>

      <Card className="p-6">
        <SectionHeader title="بوابة التحقق" subtitle="التحقق من الاعتمادات العامة — بلوكشين و QR" action={<ShieldCheck size={18} className="text-accent-600" />} />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[
            { title: 'الترسيخ على البلوكشين', desc: 'كل تجزئة اعتماد مرسّخة على سلسلة عامة للتحقق المانع للتلاعب.', icon: Link2, pct: 100 },
            { title: 'تحقق QR', desc: 'كل شهادة تحمل رمز QR فريد يربط ببوابة التحقق.', icon: QrCode, pct: 100 },
            { title: 'بوابة أصحاب العمل', desc: 'يتحقّق المسؤولون من اعتمادات المرشحين فوراً عبر البوابة العامة.', icon: Eye, pct: 92 },
          ].map((f) => (
            <div key={f.title} className="p-4 rounded-xl border border-ink-100">
              <f.icon size={20} className="text-brand-600 mb-2" />
              <p className="font-700 text-ink-900">{f.title}</p>
              <p className="text-sm text-ink-500 mt-1">{f.desc}</p>
              <ProgressBar value={f.pct} tone="accent" className="mt-3" />
            </div>
          ))}
        </div>
      </Card>

      {/* نافذة إصدار شهادة */}
      {showIssue && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-ink-950/50 backdrop-blur-sm animate-fade-in" onClick={() => setShowIssue(false)}>
          <div className="card w-full max-w-md p-6 animate-slide-in" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-display font-700 text-ink-900">إصدار شهادة جديدة</h3>
              <button onClick={() => setShowIssue(false)} className="grid place-items-center w-8 h-8 rounded-lg text-ink-400 hover:bg-ink-100"><X size={18} /></button>
            </div>
            <div className="space-y-4">
              <div><label className="label">اسم المستلم</label><input className="input" value={form.recipient} onChange={(e) => setForm({ ...form, recipient: e.target.value })} placeholder="مثال: ليلى الفارسي" /></div>
              <div><label className="label">البرنامج</label><input className="input" value={form.program} onChange={(e) => setForm({ ...form, program: e.target.value })} placeholder="مثال: تعلّم الآلة المتقدّم" /></div>
              <div><label className="label">المُصدِر</label><input className="input" value={form.issuer} onChange={(e) => setForm({ ...form, issuer: e.target.value })} placeholder="مثال: جامعة الملك سعود" /></div>
              <div>
                <label className="label">الدرجة: {form.score}%</label>
                <input type="range" min={50} max={100} value={form.score} onChange={(e) => setForm({ ...form, score: +e.target.value })} className="w-full accent-brand-600" />
              </div>
            </div>
            <div className="flex gap-2 mt-5">
              <button onClick={issueCert} className="btn-primary flex-1"><Award size={16} /> إصدار</button>
              <button onClick={() => setShowIssue(false)} className="btn-outline">إلغاء</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
