import { useState, useEffect } from 'react';
import { Card, Badge, SectionHeader, ProgressBar, Sparkline } from '../components/ui';
import { BRANCHES, STUDENTS } from '../lib/data';
import { supabase } from '../lib/supabase';
import {
  BarChart3, TrendingUp, Users, GraduationCap, DollarSign, AlertTriangle,
  Download, Filter, ArrowUpRight, ArrowDownRight, Activity, Target,
} from 'lucide-react';

const DASHBOARDS = ['تنفيذي', 'فرعي', 'إداري', 'معلّم', 'طالب', 'ذكاء'];
const TIME_RANGES = ['30 يوم', '90 يوم', 'سنة', 'الكل'];

const PERFORMANCE_DATA = [
  { month: 'يناير', pass: 82, attendance: 91, engagement: 78 },
  { month: 'فبراير', pass: 83, attendance: 92, engagement: 80 },
  { month: 'مارس', pass: 84, attendance: 90, engagement: 82 },
  { month: 'أبريل', pass: 85, attendance: 93, engagement: 84 },
  { month: 'مايو', pass: 86, attendance: 92, engagement: 86 },
  { month: 'يونيو', pass: 87, attendance: 94, engagement: 88 },
];

const SUBJECT_PERFORMANCE = [
  { subject: 'الرياضيات', score: 84, change: 3.2 },
  { subject: 'علوم الحاسب', score: 91, change: 5.1 },
  { subject: 'العلوم', score: 78, change: -1.4 },
  { subject: 'اللغات', score: 86, change: 2.8 },
  { subject: 'العلوم الإنسانية', score: 82, change: 1.1 },
  { subject: 'إدارة الأعمال', score: 79, change: -0.8 },
];

const RISK_FACTORS = [
  { factor: 'انخفاض الحضور', count: 4820, pct: 38 },
  { factor: 'تأخّر تسليم الواجبات', count: 3210, pct: 26 },
  { factor: 'انخفاض درجة التفاعل', count: 2480, pct: 20 },
  { factor: 'رسوب في التقييمات', count: 1898, pct: 16 },
];

export function Analytics() {
  const [dash, setDash] = useState('تنفيذي');
  const [timeRange, setTimeRange] = useState('30 يوم');
  const [dbStats, setDbStats] = useState({ students: 0, exams: 0, avgScore: 0 });

  const exportAnalytics = () => {
    const rows = [
      ['المؤشر', 'القيمة'],
      ['الطلاب', String(dbStats.students)],
      ['الامتحانات', String(dbStats.exams)],
      ['متوسط الدرجة', `${dbStats.avgScore}%`],
      ['الفترة', timeRange],
    ];
    const csv = rows.map((row) => row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'examify-analytics.csv';
    link.click();
    URL.revokeObjectURL(url);
  };

  useEffect(() => {
    Promise.all([
      supabase.from('students').select('*', { count: 'exact', head: true }),
      supabase.from('exams').select('avg_score'),
    ]).then(([s, e]) => {
      const scores = (e.data ?? []).filter((r: any) => r.avg_score !== null).map((r: any) => r.avg_score);
      const avg = scores.length > 0 ? scores.reduce((a: number, b: number) => a + b, 0) / scores.length : 0;
      setDbStats({ students: s.count ?? 0, exams: e.data?.length ?? 0, avgScore: Math.round(avg * 10) / 10 });
    });
  }, [timeRange]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1 p-1 bg-white rounded-xl border border-ink-100">
          {DASHBOARDS.map((d) => (
            <button key={d} onClick={() => setDash(d)} className={`px-3.5 py-1.5 rounded-lg text-sm font-600 transition ${dash === d ? 'bg-brand-600 text-white' : 'text-ink-600 hover:bg-ink-100'}`}>{d}</button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 p-1 bg-white rounded-xl border border-ink-100">
            {TIME_RANGES.map((t) => (
              <button key={t} onClick={() => setTimeRange(t)} className={`px-3 py-1.5 rounded-lg text-xs font-600 transition ${timeRange === t ? 'bg-brand-600 text-white' : 'text-ink-600 hover:bg-ink-100'}`}>{t}</button>
            ))}
          </div>
          <button onClick={() => window.alert(`الفلاتر الحالية: ${dash} — ${timeRange}`)} className="btn-outline"><Filter size={15} /> مرشّحات</button>
          <button onClick={exportAnalytics} className="btn-outline"><Download size={15} /> تصدير</button>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="p-4 flex items-center gap-3">
          <div className="grid place-items-center w-10 h-10 rounded-xl bg-brand-50 text-brand-600"><Users size={20} /></div>
          <div><p className="text-xs text-ink-500">طلاب (قاعدة البيانات)</p><p className="font-display font-700 text-ink-900 text-lg nums-latin">{dbStats.students}</p></div>
        </Card>
        <Card className="p-4 flex items-center gap-3">
          <div className="grid place-items-center w-10 h-10 rounded-xl bg-accent-50 text-accent-600"><BarChart3 size={20} /></div>
          <div><p className="text-xs text-ink-500">امتحانات (قاعدة البيانات)</p><p className="font-display font-700 text-ink-900 text-lg nums-latin">{dbStats.exams}</p></div>
        </Card>
        <Card className="p-4 flex items-center gap-3">
          <div className="grid place-items-center w-10 h-10 rounded-xl bg-gold-500/10 text-gold-600"><Target size={20} /></div>
          <div><p className="text-xs text-ink-500">متوسط الدرجة (DB)</p><p className="font-display font-700 text-ink-900 text-lg nums-latin">{dbStats.avgScore}%</p></div>
        </Card>
        <Card className="p-4 flex items-center gap-3">
          <div className="grid place-items-center w-10 h-10 rounded-xl bg-brand-50 text-brand-600"><Activity size={20} /></div>
          <div><p className="text-xs text-ink-500">النطاق الزمني</p><p className="font-display font-700 text-ink-900 text-lg">{timeRange}</p></div>
        </Card>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'نسبة النجاح', value: '87.3%', delta: 1.9, icon: Target, tone: 'accent' as const, trend: [82, 83, 84, 85, 86, 87.3] },
          { label: 'الاحتفاظ', value: '94.1%', delta: 2.4, icon: Users, tone: 'brand' as const, trend: [90, 91, 92, 92.5, 93, 94.1] },
          { label: 'فعالية المعلّم', value: '8.6/10', delta: 0.4, icon: GraduationCap, tone: 'gold' as const, trend: [8.1, 8.2, 8.3, 8.4, 8.5, 8.6] },
          { label: 'إيراد لكل متعلّم', value: '3.76$', delta: 4.2, icon: DollarSign, tone: 'brand' as const, trend: [3.1, 3.3, 3.4, 3.5, 3.6, 3.76] },
        ].map((k) => (
          <Card key={k.label} className="p-5">
            <div className="flex items-center justify-between mb-3">
              <div className={`grid place-items-center w-9 h-9 rounded-lg bg-${k.tone}-50 text-${k.tone}-600`}><k.icon size={17} /></div>
              <span className={`flex items-center gap-0.5 text-xs font-700 nums-latin ${k.delta > 0 ? 'text-accent-600' : 'text-danger-600'}`}>{k.delta > 0 ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}{Math.abs(k.delta)}%</span>
            </div>
            <p className="text-xs text-ink-500">{k.label}</p>
            <p className="font-display text-2xl font-800 text-ink-900 mt-0.5 nums-latin">{k.value}</p>
            <div className="h-8 mt-2"><Sparkline data={k.trend} tone={k.tone} className="w-full h-full" /></div>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <Card className="xl:col-span-2 p-6">
          <SectionHeader title="اتجاهات الأداء" subtitle="متوسطات متحرّكة لـ 6 أشهر عبر جميع المؤسسات" action={<BarChart3 size={18} className="text-ink-400" />} />
          <div className="relative h-72">
            <svg viewBox="0 0 600 280" className="w-full h-full" preserveAspectRatio="none">
              {[0, 1, 2, 3, 4].map((i) => (
                <line key={i} x1="0" x2="600" y1={i * 70} y2={i * 70} stroke="#eceef2" strokeWidth="1" />
              ))}
              {(() => {
                const series = [
                  { key: 'pass', color: '#3174ff', label: 'نسبة النجاح' },
                  { key: 'attendance', color: '#10b981', label: 'الحضور' },
                  { key: 'engagement', color: '#eab308', label: 'التفاعل' },
                ];
                return series.map((s) => {
                  const pts = PERFORMANCE_DATA.map((d, i) => {
                    const x = (i / (PERFORMANCE_DATA.length - 1)) * 600;
                    const y = 280 - ((d[s.key as keyof typeof d] as number - 70) / 30) * 280;
                    return `${x},${y}`;
                  });
                  return <polyline key={s.key} points={pts.join(' ')} fill="none" stroke={s.color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />;
                });
              })()}
            </svg>
            <div className="absolute bottom-0 left-0 right-0 flex justify-between text-[10px] text-ink-400 px-1">
              {PERFORMANCE_DATA.map((d) => <span key={d.month}>{d.month}</span>)}
            </div>
          </div>
          <div className="flex items-center gap-4 mt-3">
            {[{ c: '#3174ff', l: 'نسبة النجاح' }, { c: '#10b981', l: 'الحضور' }, { c: '#eab308', l: 'التفاعل' }].map((s) => (
              <span key={s.l} className="flex items-center gap-1.5 text-xs text-ink-600"><span className="w-2.5 h-2.5 rounded-full" style={{ background: s.c }} /> {s.l}</span>
            ))}
          </div>
        </Card>

        <Card className="p-6">
          <SectionHeader title="التنبؤ بمخاطر الطلاب" subtitle="عوامل محدّدة بالذكاء الاصطناعي" action={<AlertTriangle size={18} className="text-warning-600" />} />
          <div className="grid place-items-center my-4">
            <div className="relative w-36 h-36">
              <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
                <circle cx="50" cy="50" r="42" fill="none" stroke="#eceef2" strokeWidth="8" />
                <circle cx="50" cy="50" r="42" fill="none" stroke="#ef4444" strokeWidth="8" strokeLinecap="round" strokeDasharray={`${2 * Math.PI * 42 * 0.097} ${2 * Math.PI * 42}`} />
              </svg>
              <div className="absolute inset-0 grid place-items-center text-center">
                <div>
                  <p className="font-display text-2xl font-800 text-ink-900 nums-latin">9.7%</p>
                  <p className="text-[10px] text-ink-500">معرّض للخطر</p>
                </div>
              </div>
            </div>
          </div>
          <div className="space-y-2.5">
            {RISK_FACTORS.map((r) => (
              <div key={r.factor}>
                <div className="flex justify-between text-xs mb-1"><span className="text-ink-600">{r.factor}</span><span className="font-600 text-ink-700 nums-latin">{r.count.toLocaleString()}</span></div>
                <ProgressBar value={r.pct} tone="danger" />
              </div>
            ))}
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <Card className="p-6">
          <SectionHeader title="أداء المواد" subtitle="حسب القسم · هذا الفصل" />
          <div className="space-y-3">
            {SUBJECT_PERFORMANCE.map((s) => (
              <div key={s.subject} className="flex items-center gap-3">
                <span className="text-sm text-ink-700 w-40 truncate">{s.subject}</span>
                <div className="flex-1"><ProgressBar value={s.score} tone={s.score > 85 ? 'accent' : s.score > 80 ? 'brand' : 'warning'} /></div>
                <span className="text-sm font-700 text-ink-900 w-10 text-left nums-latin">{s.score}%</span>
                <span className={`flex items-center gap-0.5 text-xs font-600 w-12 nums-latin ${s.change > 0 ? 'text-accent-600' : 'text-danger-600'}`}>{s.change > 0 ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}{Math.abs(s.change)}%</span>
              </div>
            ))}
          </div>
        </Card>

        <Card className="p-6">
          <SectionHeader title="مقارنة الفروع" subtitle="درجة الصحّة حسب المؤسسة" action={<Activity size={18} className="text-ink-400" />} />
          <div className="space-y-3">
            {BRANCHES.map((b) => (
              <div key={b.id} className="flex items-center gap-3 p-2.5 rounded-xl hover:bg-ink-50 transition">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-600 text-ink-800 truncate">{b.name}</p>
                  <p className="text-[11px] text-ink-400 nums-latin">{b.country} · {b.learners.toLocaleString()} متعلّم</p>
                </div>
                <div className="w-24"><ProgressBar value={b.health} tone={b.health > 90 ? 'accent' : 'brand'} /></div>
                <span className="text-sm font-700 text-ink-900 w-10 text-left nums-latin">{b.health}</span>
                <Badge tone={b.status === 'نشط' ? 'accent' : 'warning'}>{b.status}</Badge>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <Card className="p-6">
        <SectionHeader title="الأكثر تفوّقاً" subtitle="الطلاب الأكثر تحسّناً هذا الفصل" action={<TrendingUp size={18} className="text-accent-600" />} />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {STUDENTS.filter((s) => s.status === 'متميّز' || s.status === 'على المسار').slice(0, 6).map((s) => (
            <div key={s.id} className="flex items-center gap-3 p-3 rounded-xl border border-ink-100 hover:border-brand-200 transition">
              <img src={s.avatar} alt={s.name} className="w-10 h-10 rounded-full object-cover" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-600 text-ink-900 truncate">{s.name}</p>
                <p className="text-[11px] text-ink-400 truncate">{s.institution}</p>
              </div>
              <div className="text-left">
                <p className="text-sm font-700 text-ink-900 nums-latin">{s.gpa}</p>
                <p className="text-[10px] text-ink-400">المعدّل</p>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
