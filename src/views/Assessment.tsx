import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, BarChart3, BookOpen, Calendar, CheckCircle2, Clock, FileCheck2, Loader2, Plus, RefreshCw, Users } from 'lucide-react';
import { Badge, Card, EmptyState, ProgressBar, SectionHeader } from '../components/ui';
import { supabase, useAuthSafe } from '../lib/auth-helpers';

type Exam = { id: string; title: string; subject_id: string | null; total_points: number; duration_minutes: number; status: string; created_at: string };
type Subject = { id: string; name: string };
type Question = { id: string; subject_id: string | null; type: string; difficulty: string };
type Attempt = { id: string; score_percentage: number | null; is_passed: boolean | null; status: string; submitted_at: string | null; exam_id: string };

const statusMeta: Record<string, { label: string; tone: 'neutral' | 'brand' | 'accent' | 'warning' }> = {
  draft: { label: 'مسودة', tone: 'neutral' },
  scheduled: { label: 'مجدول', tone: 'warning' },
  published: { label: 'منشور', tone: 'accent' },
  archived: { label: 'مؤرشف', tone: 'neutral' },
};

function go(view: string) { window.history.pushState({}, '', `/?view=${view}`); window.dispatchEvent(new PopStateEvent('popstate')); }

export function Assessment() {
  const { institutionId } = useAuthSafe();
  const [exams, setExams] = useState<Exam[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [tab, setTab] = useState<'overview' | 'exams' | 'bank' | 'generator'>('overview');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!institutionId) return;
    setLoading(true); setError(null);
    const [examRes, subjectRes, questionRes] = await Promise.all([
      supabase.from('examify_exams').select('id, title, subject_id, total_points, duration_minutes, status, created_at').eq('institution_id', institutionId).order('created_at', { ascending: false }),
      supabase.from('subjects').select('id, name').eq('institution_id', institutionId).order('name'),
      supabase.from('questions').select('id, subject_id, type, difficulty').eq('institution_id', institutionId),
    ]);
    const firstError = [examRes, subjectRes, questionRes].find((result) => result.error)?.error;
    if (firstError) { setError(firstError.message); setLoading(false); return; }
    const loadedExams = (examRes.data as Exam[]) ?? [];
    let loadedAttempts: Attempt[] = [];
    if (loadedExams.length) {
      const attemptRes = await supabase.from('exam_attempts').select('id, score_percentage, is_passed, status, submitted_at, exam_id').in('exam_id', loadedExams.map((exam) => exam.id));
      if (attemptRes.error) { setError(attemptRes.error.message); setLoading(false); return; }
      loadedAttempts = (attemptRes.data as Attempt[]) ?? [];
    }
    setExams(loadedExams); setSubjects((subjectRes.data as Subject[]) ?? []); setQuestions((questionRes.data as Question[]) ?? []); setAttempts(loadedAttempts); setLoading(false);
  }, [institutionId]);

  useEffect(() => { load(); }, [load]);

  const subjectNames = useMemo(() => new Map(subjects.map((subject) => [subject.id, subject.name])), [subjects]);
  const scoredAttempts = attempts.filter((attempt) => attempt.score_percentage !== null);
  const averageScore = scoredAttempts.length ? scoredAttempts.reduce((sum, attempt) => sum + Number(attempt.score_percentage), 0) / scoredAttempts.length : 0;
  const passRate = scoredAttempts.length ? scoredAttempts.filter((attempt) => attempt.is_passed).length / scoredAttempts.length * 100 : 0;
  const recentExams = tab === 'exams' ? exams : exams.slice(0, 6);

  if (loading) return <div className="flex justify-center py-20"><Loader2 size={28} className="animate-spin text-brand-600" /></div>;
  return <div className="space-y-6">
    {error && <div className="flex items-center gap-2 p-3 rounded-xl bg-danger-50 border border-danger-100 text-danger-700 text-sm"><AlertCircle size={17} />{error}<button onClick={() => void load()} className="mr-auto"><RefreshCw size={15} /></button></div>}
    <SectionHeader title="منصّة التقييم" subtitle="إدارة الامتحانات والمحاولات من بيانات مؤسستك الفعلية" action={<div className="flex gap-2"><button onClick={() => void load()} className="btn-outline"><RefreshCw size={16} /> تحديث</button><button onClick={() => go('exambuilder')} className="btn-primary"><Plus size={16} /> امتحان جديد</button></div>} />
    <div className="flex gap-1 p-1 bg-white rounded-xl border border-ink-100 w-fit">{[['overview', 'نظرة عامة'], ['exams', 'الامتحانات'], ['bank', 'بنك الأسئلة'], ['generator', 'مولد التقييم']].map(([value, label]) => <button key={value} onClick={() => setTab(value as typeof tab)} className={`px-4 py-2 rounded-lg text-sm font-600 ${tab === value ? 'bg-brand-600 text-white' : 'text-ink-600 hover:bg-ink-50'}`}>{label}</button>)}</div>
    <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">{[
      ['إجمالي الامتحانات', exams.length, FileCheck2], ['الامتحانات المنشورة', exams.filter((exam) => exam.status === 'published').length, CheckCircle2], ['الأسئلة', questions.length, BookOpen], ['المحاولات', attempts.length, Users], ['متوسط الدرجات', `${averageScore.toFixed(1)}%`, BarChart3],
    ].map(([label, value, Icon]) => <Card key={String(label)} className="p-4"><div className="flex items-center gap-2 text-ink-500">{typeof Icon === 'function' ? <Icon size={17} /> : null}<span className="text-xs">{String(label)}</span></div><p className="font-display text-2xl font-800 text-ink-900 mt-2 nums-latin">{String(value)}</p></Card>)}</div>
    {tab === 'overview' && <div className="grid grid-cols-1 lg:grid-cols-2 gap-6"><Card className="p-5"><SectionHeader title="مؤشرات الأداء" subtitle="من محاولات الطلاب المسجلة" /><div className="space-y-5 mt-5"><div><div className="flex justify-between text-sm mb-1"><span>نسبة النجاح</span><strong className="nums-latin">{passRate.toFixed(1)}%</strong></div><ProgressBar value={passRate} tone="accent" /></div><div><div className="flex justify-between text-sm mb-1"><span>متوسط الدرجات</span><strong className="nums-latin">{averageScore.toFixed(1)}%</strong></div><ProgressBar value={averageScore} tone="brand" /></div></div></Card><Card className="p-5"><SectionHeader title="إجراءات سريعة" subtitle="ابدأ من البيانات الحالية" /><div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-5"><button onClick={() => go('exambuilder')} className="btn-outline justify-start"><Calendar size={17} /> إدارة الامتحانات</button><button onClick={() => go('questionbank')} className="btn-outline justify-start"><BookOpen size={17} /> إدارة بنك الأسئلة</button><button onClick={() => go('grading')} className="btn-outline justify-start"><CheckCircle2 size={17} /> تصحيح المحاولات</button><button onClick={() => go('reports')} className="btn-outline justify-start"><BarChart3 size={17} /> التقارير</button></div></Card></div>}
    {tab !== 'bank' && <Card className="overflow-hidden"><SectionHeader title={tab === 'overview' ? 'آخر الامتحانات' : 'كل الامتحانات'} subtitle="من جدول examify_exams في المؤسسة الحالية" /><div className="overflow-x-auto"><table className="w-full text-sm"><thead className="bg-ink-50 text-ink-500 text-xs"><tr><th className="text-right px-5 py-3">الامتحان</th><th className="text-right px-5 py-3">المادة</th><th className="text-right px-5 py-3">الحالة</th><th className="text-right px-5 py-3">المدة</th><th className="text-right px-5 py-3">الدرجات</th></tr></thead><tbody className="divide-y divide-ink-50">{recentExams.map((exam) => <tr key={exam.id}><td className="px-5 py-3 font-600">{exam.title}</td><td className="px-5 py-3 text-ink-500">{exam.subject_id ? subjectNames.get(exam.subject_id) ?? '—' : '—'}</td><td className="px-5 py-3"><Badge tone={statusMeta[exam.status]?.tone ?? 'neutral'}>{statusMeta[exam.status]?.label ?? exam.status}</Badge></td><td className="px-5 py-3 nums-latin"><Clock size={13} className="inline ml-1" />{exam.duration_minutes} دقيقة</td><td className="px-5 py-3 nums-latin">{exam.total_points}</td></tr>)}</tbody></table></div>{!recentExams.length && <EmptyState title="لا توجد امتحانات" subtitle="أنشئ أول امتحان من إدارة الامتحانات." />}</Card>}
    {tab === 'bank' && <Card className="p-5"><SectionHeader title="بنك الأسئلة" subtitle="إجمالي الأسئلة حسب المادة والنوع من قاعدة البيانات" />{questions.length ? <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 mt-5">{subjects.map((subject) => { const count = questions.filter((question) => question.subject_id === subject.id).length; return <div key={subject.id} className="p-4 rounded-xl bg-ink-50"><div className="flex justify-between"><span className="font-600">{subject.name}</span><strong className="nums-latin">{count}</strong></div><ProgressBar value={questions.length ? count / questions.length * 100 : 0} tone="brand" className="mt-3" /></div>; })}</div> : <EmptyState title="لا توجد أسئلة بعد" subtitle="أضف أسئلة من بنك الأسئلة أو استورد ملف PDF/Word." />}<button onClick={() => go('questionbank')} className="btn-primary mt-5"><BookOpen size={16} /> فتح بنك الأسئلة</button></Card>}
    {tab === 'generator' && <Card className="p-6"><SectionHeader title="مولد التقييم الذكي" subtitle="استخدم محرك الذكاء الاصطناعي الفعلي لإنشاء أسئلة وتقييمات مرتبطة ببنك المؤسسة" /><p className="text-sm text-ink-600 mt-5">لن يتم عرض نتائج وهمية هنا. افتح محرك الذكاء الاصطناعي لإدخال المادة والأهداف ثم راجع الأسئلة قبل حفظها.</p><button onClick={() => go('aiengine')} className="btn-primary mt-5"><BarChart3 size={16} /> فتح محرك الذكاء الاصطناعي</button></Card>}
  </div>;
}
