import { useState, useEffect } from 'react';
import { EXAMS, QUESTIONS, type Exam } from '../lib/data';
import { supabase, type DbExam } from '../lib/supabase';
import { Card, Badge, SectionHeader, ProgressBar } from '../components/ui';
import {
  Sparkles, Plus, Search, Clock, Users, FileCheck2, Brain,
  Lightbulb, Target, TrendingUp, BookOpen, Wand2, CheckCircle2, Loader2,
  X, Trash2, Pencil, AlertCircle,
} from 'lucide-react';

const STATUS_TONE: Record<Exam['status'], 'neutral' | 'brand' | 'accent' | 'gold' | 'warning'> = {
  'مسودة': 'neutral',
  'مجدول': 'brand',
  'مباشر': 'accent',
  'تحت التصحيح': 'gold',
  'منشور': 'neutral',
};

const DIFFICULTY_TONE: Record<Exam['difficulty'], 'neutral' | 'brand' | 'warning' | 'danger'> = {
  'تأسيسي': 'neutral',
  'متوسط': 'brand',
  'متقدّم': 'warning',
  'خبير': 'danger',
};

const QTYPE_COLORS: Record<string, string> = {
  'اختيار من متعدد': 'bg-brand-50 text-brand-700',
  'مقال': 'bg-gold-500/10 text-gold-600',
  'برمجة': 'bg-ink-900 text-white',
  'رياضيات': 'bg-accent-50 text-accent-700',
  'دراسة حالة': 'bg-warning-50 text-warning-600',
  'سحب وإفلات': 'bg-brand-50 text-brand-700',
  'صوتي': 'bg-danger-50 text-danger-600',
  'محاكاة': 'bg-ink-100 text-ink-700',
};

const STATUSES: Exam['status'][] = ['مسودة', 'مجدول', 'مباشر', 'تحت التصحيح', 'منشور'];
const DIFFICULTIES: Exam['difficulty'][] = ['تأسيسي', 'متوسط', 'متقدّم', 'خبير'];
const BLOOM_OPTIONS = ['تذكّر', 'فهم', 'تطبيق', 'تحليل', 'تقييم', 'إنشاء'];

interface ExamForm {
  title: string;
  subject: string;
  questions: number;
  duration: number;
  difficulty: Exam['difficulty'];
  status: Exam['status'];
  aiGenerated: boolean;
  bloom: string[];
}

const EMPTY_FORM: ExamForm = {
  title: '', subject: '', questions: 10, duration: 60, difficulty: 'متوسط', status: 'مسودة', aiGenerated: false, bloom: [],
};

export function Assessment() {
  const [tab, setTab] = useState<'exams' | 'bank' | 'generator'>('exams');
  const [filter, setFilter] = useState('الكل');
  const [search, setSearch] = useState('');
  const [exams, setExams] = useState<Exam[]>(EXAMS);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<ExamForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [gen, setGen] = useState({ subject: 'التفاضل والتكامل 2', difficulty: 'متوسط', duration: 75, questions: 18, objectives: 'تقنيات التكامل، تقارب المتسلسلات، تطبيقات التكامل' });
  const [generating, setGenerating] = useState(false);
  const [generated, setGenerated] = useState(false);

  const fetchExams = async () => {
    setLoading(true);
    setError(null);
    const { data, error: dbError } = await supabase.from('exams').select('*').order('updated_at', { ascending: false });
    if (dbError) {
      setError('تعذّر الاتصال بقاعدة البيانات');
      setExams(EXAMS);
    } else if (data && data.length > 0) {
      const mapped: Exam[] = data.map((d: DbExam) => ({
        id: d.id,
        title: d.title,
        subject: d.subject,
        questions: d.questions_count,
        duration: d.duration,
        difficulty: d.difficulty as Exam['difficulty'],
        status: d.status as Exam['status'],
        enrolled: d.enrolled,
        avgScore: d.avg_score,
        aiGenerated: d.ai_generated,
        bloom: d.bloom_levels ?? [],
        updated: 'من قاعدة البيانات',
      }));
      setExams(mapped);
    } else {
      setExams(EXAMS);
    }
    setLoading(false);
  };

  useEffect(() => { fetchExams(); }, []);

  const filteredExams = exams.filter((e) => {
    const matchesFilter = filter === 'الكل' || e.status === filter;
    const matchesSearch = !search || e.title.includes(search) || e.subject.includes(search);
    return matchesFilter && matchesSearch;
  });

  const openAdd = () => {
    setForm(EMPTY_FORM);
    setEditingId(null);
    setShowModal(true);
  };

  const openEdit = (exam: Exam) => {
    setForm({
      title: exam.title, subject: exam.subject, questions: exam.questions,
      duration: exam.duration, difficulty: exam.difficulty, status: exam.status,
      aiGenerated: exam.aiGenerated, bloom: exam.bloom,
    });
    setEditingId(exam.id);
    setShowModal(true);
  };

  const toggleBloom = (b: string) => {
    setForm((f) => ({ ...f, bloom: f.bloom.includes(b) ? f.bloom.filter((x) => x !== b) : [...f.bloom, b] }));
  };

  const saveExam = async () => {
    if (!form.title.trim() || !form.subject.trim()) {
      setError('الرجاء إدخال العنوان والمادة');
      return;
    }
    setSaving(true);
    setError(null);
    const payload = {
      title: form.title,
      subject: form.subject,
      questions_count: form.questions,
      duration: form.duration,
      difficulty: form.difficulty,
      status: form.status,
      ai_generated: form.aiGenerated,
      bloom_levels: form.bloom,
      enrolled: 0,
      updated_at: new Date().toISOString(),
    };
    if (editingId) {
      const { error: updateError } = await supabase.from('exams').update(payload).eq('id', editingId);
      if (updateError) { setError('فشل حفظ تعديلات الامتحان'); setSaving(false); return; }
      if (updateError) setError('تعذّر تحديث الامتحان');
    } else {
      const { error: insertError } = await supabase.from('exams').insert(payload);
      if (insertError) { setError('فشل إنشاء الامتحان'); setSaving(false); return; }
      if (insertError) setError('تعذّر إضافة الامتحان');
    }
    setSaving(false);
    if (!error) {
      setShowModal(false);
      fetchExams();
    }
  };

  const confirmDelete = async () => {
    if (!deleteId) return;
    const { error: delError } = await supabase.from('exams').delete().eq('id', deleteId);
    if (delError) {
      setError('تعذّر حذف الامتحان');
    } else {
      setDeleteId(null);
      fetchExams();
    }
  };

  const changeStatus = async (exam: Exam, newStatus: Exam['status']) => {
    const { error: updateError } = await supabase.from('exams').update({ status: newStatus, updated_at: new Date().toISOString() }).eq('id', exam.id);
    if (!updateError) {
      setExams((prev) => prev.map((e) => e.id === exam.id ? { ...e, status: newStatus } : e));
    }
  };

  const startGeneration = () => {
    setGenerating(true);
    setGenerated(false);
    setTimeout(() => { setGenerating(false); setGenerated(true); }, 2200);
  };

  const saveGenerated = async () => {
    setSaving(true);
    const { error: insertError } = await supabase.from('exams').insert({
      title: `${gen.subject} — امتحان مولّد بالذكاء`,
      subject: gen.subject,
      questions_count: gen.questions,
      duration: gen.duration,
      difficulty: gen.difficulty,
      status: 'مسودة',
      ai_generated: true,
      bloom_levels: ['تطبيق', 'تحليل', 'تقييم'],
      enrolled: 0,
      updated_at: new Date().toISOString(),
    });
    setSaving(false);
    if (!insertError) {
      setGenerated(false);
      fetchExams();
      setTab('exams');
    }
  };

  return (
    <div className="space-y-6">
      {error && (
        <div className="flex items-center gap-2 p-3 rounded-xl bg-danger-50 border border-danger-100 text-danger-700 text-sm animate-fade-in">
          <AlertCircle size={16} />
          <span>{error}</span>
          <button onClick={() => setError(null)} className="mr-auto"><X size={16} /></button>
        </div>
      )}

      <div className="flex items-center gap-1 p-1 bg-white rounded-xl border border-ink-100 w-fit">
        {([['exams', 'الامتحانات'], ['bank', 'بنك الأسئلة'], ['generator', 'مولّد الامتحانات الذكي']] as const).map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)} className={`px-4 py-2 rounded-lg text-sm font-600 transition ${tab === id ? 'bg-brand-600 text-white shadow-soft' : 'text-ink-600 hover:bg-ink-100'}`}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'exams' && (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white border border-ink-200 flex-1 min-w-[220px] max-w-sm">
              <Search size={16} className="text-ink-400" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="ابحث عن امتحانات…" className="bg-transparent text-sm outline-none flex-1 placeholder:text-ink-400" />
            </div>
            <div className="flex items-center gap-1.5">
              {['الكل', 'مباشر', 'مجدول', 'تحت التصحيح', 'منشور', 'مسودة'].map((f) => (
                <button key={f} onClick={() => setFilter(f)} className={`px-3 py-1.5 rounded-lg text-xs font-600 transition ${filter === f ? 'bg-ink-900 text-white' : 'bg-white border border-ink-200 text-ink-600 hover:bg-ink-50'}`}>
                  {f}
                </button>
              ))}
            </div>
            <button onClick={openAdd} className="btn-primary mr-auto"><Plus size={16} /> امتحان جديد</button>
          </div>

          {loading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {[1, 2, 3, 4, 5, 6].map((i) => (
                <div key={i} className="card p-5 shimmer">
                  <div className="h-5 w-20 bg-ink-100 rounded mb-3" />
                  <div className="h-5 w-3/4 bg-ink-100 rounded mb-2" />
                  <div className="h-4 w-1/3 bg-ink-50 rounded mb-4" />
                  <div className="h-3 w-full bg-ink-50 rounded mb-2" />
                  <div className="h-3 w-2/3 bg-ink-50 rounded" />
                </div>
              ))}
            </div>
          ) : filteredExams.length === 0 ? (
            <Card className="p-12 text-center">
              <div className="grid place-items-center w-14 h-14 rounded-2xl bg-ink-50 text-ink-300 mx-auto mb-4"><FileCheck2 size={26} /></div>
              <h3 className="font-display font-700 text-ink-800">لا توجد امتحانات</h3>
              <p className="text-sm text-ink-500 mt-1">لم يتم العثور على امتحانات تطابق البحث. جرّب تعديل المرشّحات أو أنشئ امتحاناً جديداً.</p>
              <button onClick={openAdd} className="btn-primary mt-4"><Plus size={16} /> إنشاء امتحان</button>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {filteredExams.map((exam) => (
                <Card key={exam.id} hover className="p-5 group">
                  <div className="flex items-start justify-between gap-2 mb-3">
                    <div className="flex items-center gap-2">
                      {exam.aiGenerated && <Badge tone="brand"><Sparkles size={11} /> ذكاء</Badge>}
                      <Badge tone={DIFFICULTY_TONE[exam.difficulty]}>{exam.difficulty}</Badge>
                    </div>
                    <div className="relative">
                      <Badge tone={STATUS_TONE[exam.status]}>{exam.status}</Badge>
                      <select
                        value={exam.status}
                        onChange={(e) => changeStatus(exam, e.target.value as Exam['status'])}
                        className="absolute inset-0 opacity-0 cursor-pointer"
                        title="تغيير الحالة"
                      >
                        {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </div>
                  </div>
                  <h3 className="font-display font-700 text-ink-900 leading-tight">{exam.title}</h3>
                  <p className="text-xs text-ink-500 mt-1">{exam.subject}</p>
                  <div className="flex items-center gap-4 mt-4 text-xs text-ink-500 nums-latin">
                    <span className="flex items-center gap-1"><FileCheck2 size={13} /> {exam.questions} سؤال</span>
                    <span className="flex items-center gap-1"><Clock size={13} /> {exam.duration} دقيقة</span>
                    <span className="flex items-center gap-1"><Users size={13} /> {exam.enrolled.toLocaleString()}</span>
                  </div>
                  <div className="flex flex-wrap gap-1 mt-3">
                    {exam.bloom.map((b) => <span key={b} className="chip bg-ink-100 text-ink-600 text-[10px]">{b}</span>)}
                  </div>
                  {exam.avgScore !== null && (
                    <div className="mt-4">
                      <div className="flex justify-between text-xs mb-1"><span className="text-ink-500">متوسط الدرجة</span><span className="font-700 text-ink-800 nums-latin">{exam.avgScore}%</span></div>
                      <ProgressBar value={exam.avgScore} tone={exam.avgScore > 80 ? 'accent' : 'brand'} />
                    </div>
                  )}
                  <div className="flex items-center justify-between mt-4 pt-3 border-t border-ink-100">
                    <span className="text-[11px] text-ink-400">{exam.updated}</span>
                    <div className="flex items-center gap-1">
                      <button onClick={() => openEdit(exam)} className="grid place-items-center w-7 h-7 rounded-lg text-ink-400 hover:bg-brand-50 hover:text-brand-600 transition" title="تعديل"><Pencil size={14} /></button>
                      <button onClick={() => setDeleteId(exam.id)} className="grid place-items-center w-7 h-7 rounded-lg text-ink-400 hover:bg-danger-50 hover:text-danger-600 transition" title="حذف"><Trash2 size={14} /></button>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </>
      )}

      {tab === 'bank' && (
        <>
          <SectionHeader title="بنك الأسئلة المتقدّم" subtitle="8 أنواع أسئلة · شروح وتلميحات بالذكاء الاصطناعي وبيانات وصفية لكل عنصر" action={<button className="btn-primary"><Plus size={16} /> إضافة سؤال</button>} />
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-2 mb-4">
            {Object.keys(QTYPE_COLORS).map((t) => (
              <div key={t} className="text-center">
                <div className={`rounded-xl py-3 px-2 ${QTYPE_COLORS[t]}`}>
                  <p className="text-xs font-700">{t}</p>
                </div>
              </div>
            ))}
          </div>
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-ink-50 text-ink-500 text-xs">
                  <tr>
                    <th className="text-right font-600 px-4 py-3">النوع</th>
                    <th className="text-right font-600 px-4 py-3">السؤال</th>
                    <th className="text-right font-600 px-4 py-3 hidden md:table-cell">الموضوع</th>
                    <th className="text-right font-600 px-4 py-3 hidden lg:table-cell">بلوم</th>
                    <th className="text-right font-600 px-4 py-3">الصعوبة</th>
                    <th className="text-right font-600 px-4 py-3 hidden md:table-cell">نسبة النجاح</th>
                    <th className="text-right font-600 px-4 py-3">ذكاء</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-50">
                  {QUESTIONS.map((q) => (
                    <tr key={q.id} className="hover:bg-ink-50/50 transition">
                      <td className="px-4 py-3"><span className={`chip text-[10px] ${QTYPE_COLORS[q.type]}`}>{q.type}</span></td>
                      <td className="px-4 py-3 max-w-md"><p className="text-ink-800 line-clamp-1">{q.prompt}</p><p className="text-[11px] text-ink-400">{q.subtopic}</p></td>
                      <td className="px-4 py-3 hidden md:table-cell text-ink-600">{q.topic}</td>
                      <td className="px-4 py-3 hidden lg:table-cell"><span className="chip bg-ink-100 text-ink-600 text-[10px]">{q.bloom}</span></td>
                      <td className="px-4 py-3"><Badge tone={DIFFICULTY_TONE[q.difficulty]}>{q.difficulty}</Badge></td>
                      <td className="px-4 py-3 hidden md:table-cell">
                        <div className="flex items-center gap-2">
                          <div className="w-16"><ProgressBar value={q.successRate} tone={q.successRate > 75 ? 'accent' : q.successRate > 50 ? 'brand' : 'warning'} /></div>
                          <span className="text-xs font-600 text-ink-700 w-8 nums-latin">{q.successRate}%</span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1">
                          {q.aiExplanation && <span title="شرح ذكي" className="text-brand-500"><Lightbulb size={14} /></span>}
                          {q.aiHints && <span title="تلميحات ذكية" className="text-gold-500"><Brain size={14} /></span>}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}

      {tab === 'generator' && (
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          <Card className="lg:col-span-2 p-6">
            <div className="flex items-center gap-2 mb-1">
              <Wand2 size={18} className="text-brand-600" />
              <h2 className="font-display text-lg font-700 text-ink-900">مولّد الامتحانات الذكي</h2>
            </div>
            <p className="text-sm text-ink-500 mb-5">صِف ما تحتاجه. وكيل بنّاء الامتحانات يولّد تقييماً كاملاً ومتوازناً.</p>
            <div className="space-y-4">
              <div>
                <label className="label">المادة</label>
                <input className="input" value={gen.subject} onChange={(e) => setGen({ ...gen, subject: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">الصعوبة</label>
                  <select className="input" value={gen.difficulty} onChange={(e) => setGen({ ...gen, difficulty: e.target.value })}>
                    <option>تأسيسي</option><option>متوسط</option><option>متقدّم</option><option>خبير</option>
                  </select>
                </div>
                <div>
                  <label className="label">المدة (دقيقة)</label>
                  <input type="number" className="input nums-latin" value={gen.duration} onChange={(e) => setGen({ ...gen, duration: +e.target.value })} />
                </div>
              </div>
              <div>
                <label className="label">عدد الأسئلة</label>
                <input type="range" min={5} max={50} value={gen.questions} onChange={(e) => setGen({ ...gen, questions: +e.target.value })} className="w-full accent-brand-600" />
                <div className="flex justify-between text-xs text-ink-400 mt-1 nums-latin"><span>5</span><span className="font-700 text-brand-600">{gen.questions} سؤال</span><span>50</span></div>
              </div>
              <div>
                <label className="label">أهداف التعلّم</label>
                <textarea className="input min-h-[80px] resize-none" value={gen.objectives} onChange={(e) => setGen({ ...gen, objectives: e.target.value })} />
              </div>
              <button onClick={startGeneration} disabled={generating} className="btn-primary w-full disabled:opacity-60">
                {generating ? <><Loader2 size={16} className="animate-spin" /> جارٍ التوليد…</> : <><Sparkles size={16} /> توليد الامتحان</>}
              </button>
            </div>
          </Card>

          <div className="lg:col-span-3 space-y-4">
            {!generating && !generated && (
              <Card className="p-10 text-center border-dashed">
                <div className="grid place-items-center w-14 h-14 rounded-2xl bg-brand-50 text-brand-600 mx-auto mb-4"><Sparkles size={26} /></div>
                <h3 className="font-display font-700 text-ink-800">سيظهر امتحانك المولّد هنا</h3>
                <p className="text-sm text-ink-500 mt-1 max-w-sm mx-auto">ينتج الذكاء الاصطناعي امتحاناً كاملاً ومفتاح إجابات وتوزيع صعوبة وتغطية أهداف تعلّم وتنبؤ بالتحليلات.</p>
              </Card>
            )}
            {generating && (
              <Card className="p-8">
                <div className="space-y-4">
                  {['تحليل أهداف التعلّم', 'اختيار الأسئلة من البنك', 'موازنة توزيع الصعوبة', 'توليد مفتاح الإجابات والشروح', 'التنبؤ بتحليلات الامتحان'].map((step) => (
                    <div key={step} className="flex items-center gap-3">
                      <Loader2 size={16} className="animate-spin text-brand-600" />
                      <span className="text-sm text-ink-700">{step}</span>
                    </div>
                  ))}
                </div>
              </Card>
            )}
            {generated && (
              <>
                <Card className="p-6 animate-slide-in">
                  <div className="flex items-center gap-2 mb-4">
                    <CheckCircle2 size={20} className="text-accent-600" />
                    <h3 className="font-display font-700 text-ink-900">تم توليد الامتحان بنجاح</h3>
                    <Badge tone="brand"><Sparkles size={11} /> ذكاء</Badge>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
                    {[{ label: 'الأسئلة', value: gen.questions, icon: FileCheck2 }, { label: 'المدة', value: `${gen.duration}د`, icon: Clock }, { label: 'مستويات بلوم', value: 4, icon: Target }, { label: 'المتوسط المتوقّع', value: '78%', icon: TrendingUp }].map((s) => (
                      <div key={s.label} className="rounded-xl bg-ink-50 p-3">
                        <s.icon size={15} className="text-ink-400 mb-1" />
                        <p className="text-xs text-ink-500">{s.label}</p>
                        <p className="font-display font-700 text-ink-900 nums-latin">{s.value}</p>
                      </div>
                    ))}
                  </div>
                  <div className="space-y-2">
                    <p className="text-xs font-700 text-ink-500">توزيع الصعوبة</p>
                    {[['تأسيسي', 25], ['متوسط', 40], ['متقدّم', 25], ['خبير', 10]].map(([label, pct]) => (
                      <div key={label as string} className="flex items-center gap-3">
                        <span className="text-xs text-ink-600 w-20">{label}</span>
                        <div className="flex-1"><ProgressBar value={pct as number} tone="brand" /></div>
                        <span className="text-xs font-600 text-ink-700 w-8 text-left nums-latin">{pct}%</span>
                      </div>
                    ))}
                  </div>
                </Card>
                <Card className="p-6 animate-slide-in">
                  <p className="text-xs font-700 text-ink-500 mb-3">تغطية أهداف التعلّم</p>
                  <div className="space-y-2">
                    {['تطبيق التكامل بالأجزاء على الدوال المعقّدة', 'تحديد تقارب المتسلسلات اللانهائية', 'نمذجة أنظمة فيزيائية بالتكاملات المحدّدة', 'تقييم التكاملات غير الصحيحة'].map((obj, i) => (
                      <div key={obj} className="flex items-center gap-2.5">
                        <CheckCircle2 size={15} className="text-accent-600 shrink-0" />
                        <span className="text-sm text-ink-700">{obj}</span>
                        <span className="mr-auto text-xs font-600 text-ink-400 nums-latin">{Math.ceil(gen.questions * [0.3, 0.25, 0.25, 0.2][i])} سؤال</span>
                      </div>
                    ))}
                  </div>
                </Card>
                <div className="flex gap-3">
                  <button onClick={saveGenerated} disabled={saving} className="btn-primary flex-1 disabled:opacity-60">
                    {saving ? <><Loader2 size={16} className="animate-spin" /> جارٍ الحفظ…</> : <><BookOpen size={16} /> حفظ الامتحان</>}
                  </button>
                  <button onClick={() => setGenerated(false)} className="btn-outline">إعادة التوليد</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* نافذة إضافة/تعديل امتحان */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-ink-950/50 backdrop-blur-sm animate-fade-in" onClick={() => setShowModal(false)}>
          <div className="card w-full max-w-lg max-h-[90vh] overflow-y-auto animate-slide-in" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-5 border-b border-ink-100 sticky top-0 bg-white rounded-t-2xl">
              <h3 className="font-display font-700 text-ink-900">{editingId ? 'تعديل الامتحان' : 'امتحان جديد'}</h3>
              <button onClick={() => setShowModal(false)} className="grid place-items-center w-8 h-8 rounded-lg text-ink-400 hover:bg-ink-100"><X size={18} /></button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="label">عنوان الامتحان</label>
                <input className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="مثال: الكيمياء العضوية — منتصف الفصل" />
              </div>
              <div>
                <label className="label">المادة</label>
                <input className="input" value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} placeholder="مثال: الكيمياء" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">عدد الأسئلة</label>
                  <input type="number" min={1} className="input nums-latin" value={form.questions} onChange={(e) => setForm({ ...form, questions: +e.target.value })} />
                </div>
                <div>
                  <label className="label">المدة (دقيقة)</label>
                  <input type="number" min={1} className="input nums-latin" value={form.duration} onChange={(e) => setForm({ ...form, duration: +e.target.value })} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">الصعوبة</label>
                  <select className="input" value={form.difficulty} onChange={(e) => setForm({ ...form, difficulty: e.target.value as Exam['difficulty'] })}>
                    {DIFFICULTIES.map((d) => <option key={d} value={d}>{d}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">الحالة</label>
                  <select className="input" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as Exam['status'] })}>
                    {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="label">مستويات بلوم</label>
                <div className="flex flex-wrap gap-1.5">
                  {BLOOM_OPTIONS.map((b) => (
                    <button key={b} onClick={() => toggleBloom(b)} className={`chip transition ${form.bloom.includes(b) ? 'bg-brand-600 text-white' : 'bg-ink-100 text-ink-600 hover:bg-ink-200'}`}>
                      {form.bloom.includes(b) && <CheckCircle2 size={12} />} {b}
                    </button>
                  ))}
                </div>
              </div>
              <label className="flex items-center gap-2.5 cursor-pointer p-3 rounded-xl bg-ink-50">
                <input type="checkbox" checked={form.aiGenerated} onChange={(e) => setForm({ ...form, aiGenerated: e.target.checked })} className="w-4 h-4 accent-brand-600" />
                <span className="text-sm text-ink-700">مولّد بالذكاء الاصطناعي</span>
                <Sparkles size={15} className="text-brand-500 mr-auto" />
              </label>
            </div>
            <div className="flex gap-2 p-5 border-t border-ink-100 sticky bottom-0 bg-white rounded-b-2xl">
              <button onClick={saveExam} disabled={saving} className="btn-primary flex-1 disabled:opacity-60">
                {saving ? <><Loader2 size={16} className="animate-spin" /> جارٍ الحفظ…</> : <><CheckCircle2 size={16} /> {editingId ? 'حفظ التعديلات' : 'إنشاء الامتحان'}</>}
              </button>
              <button onClick={() => setShowModal(false)} className="btn-outline">إلغاء</button>
            </div>
          </div>
        </div>
      )}

      {/* نافذة تأكيد الحذف */}
      {deleteId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-ink-950/50 backdrop-blur-sm animate-fade-in" onClick={() => setDeleteId(null)}>
          <div className="card w-full max-w-sm p-6 animate-slide-in" onClick={(e) => e.stopPropagation()}>
            <div className="grid place-items-center w-12 h-12 rounded-xl bg-danger-50 text-danger-600 mx-auto mb-4"><Trash2 size={24} /></div>
            <h3 className="font-display font-700 text-ink-900 text-center">حذف الامتحان؟</h3>
            <p className="text-sm text-ink-500 text-center mt-1">لا يمكن التراجع عن هذا الإجراء. سيتم حذف الامتحان نهائياً.</p>
            <div className="flex gap-2 mt-5">
              <button onClick={confirmDelete} className="btn bg-danger-600 text-white hover:bg-danger-700 flex-1"><Trash2 size={16} /> حذف</button>
              <button onClick={() => setDeleteId(null)} className="btn-outline">إلغاء</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
