import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, BarChart3, Download, Loader2, Target, Users } from 'lucide-react';
import { Card, Badge, EmptyState, ProgressBar, SectionHeader } from '../components/ui';
import { supabase, useAuthSafe } from '../lib/auth-helpers';

type Student = { id: string; full_name: string; is_active: boolean };
type Subject = { id: string; name: string };
type Exam = { id: string; title: string; subject_id: string | null; class_id: string | null; status: string; created_at: string };
type Attempt = { id: string; exam_id: string; student_id: string; score_percentage: number | null; is_passed: boolean | null; status: string; submitted_at: string | null; created_at: string };
type Attendance = { student_id: string; status: string; date: string };
type Grade = { student_id: string; subject_id: string; score: number; max_score: number; recorded_at: string };
type ClassStudent = { student_id: string; class_id: string; status: string };
type ClassRow = { id: string; name: string; branch_id: string | null };
type Branch = { id: string; name: string };
type AnalyticsData = { students: Student[]; subjects: Subject[]; exams: Exam[]; attempts: Attempt[]; attendance: Attendance[]; grades: Grade[]; classStudents: ClassStudent[]; classes: ClassRow[]; branches: Branch[] };

const EMPTY: AnalyticsData = { students: [], subjects: [], exams: [], attempts: [], attendance: [], grades: [], classStudents: [], classes: [], branches: [] };
const ranges = [{ value: '30', label: '30 يوم' }, { value: '90', label: '90 يوم' }, { value: '365', label: 'سنة' }, { value: 'all', label: 'الكل' }];

function sinceDate(range: string) { if (range === 'all') return null; const date = new Date(); date.setDate(date.getDate() - Number(range)); return date; }
function inRange(value: string | null, start: Date | null) { return !start || (value ? new Date(value) >= start : false); }
function average(values: number[]) { return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0; }

export function Analytics() {
  const { institutionId } = useAuthSafe();
  const [range, setRange] = useState('30');
  const [data, setData] = useState<AnalyticsData>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!institutionId) return;
    setLoading(true); setError(null);
    const [studentRes, subjectRes, examRes, attendanceRes, gradeRes, classStudentRes, classRes, branchRes] = await Promise.all([
      supabase.from('student_profiles').select('id, full_name, is_active').eq('institution_id', institutionId).order('full_name'),
      supabase.from('subjects').select('id, name').eq('institution_id', institutionId).order('name'),
      supabase.from('examify_exams').select('id, title, subject_id, class_id, status, created_at').eq('institution_id', institutionId).order('created_at', { ascending: false }),
      supabase.from('attendance').select('student_id, status, date').eq('institution_id', institutionId),
      supabase.from('grade_book').select('student_id, subject_id, score, max_score, recorded_at').eq('institution_id', institutionId),
      supabase.from('class_students').select('student_id, class_id, status').eq('status', 'active'),
      supabase.from('classes').select('id, name, branch_id').eq('institution_id', institutionId),
      supabase.from('branches').select('id, name').eq('institution_id', institutionId),
    ]);
    const firstError = [studentRes, subjectRes, examRes, attendanceRes, gradeRes, classStudentRes, classRes, branchRes].find((result) => result.error)?.error;
    if (firstError) { setError(firstError.message); setLoading(false); return; }
    const exams = (examRes.data as Exam[]) ?? [];
    let attempts: Attempt[] = [];
    if (exams.length) {
      const attemptRes = await supabase.from('exam_attempts').select('id, exam_id, student_id, score_percentage, is_passed, status, submitted_at, created_at').in('exam_id', exams.map((exam) => exam.id));
      if (attemptRes.error) { setError(attemptRes.error.message); setLoading(false); return; }
      attempts = (attemptRes.data as Attempt[]) ?? [];
    }
    setData({ students: (studentRes.data as Student[]) ?? [], subjects: (subjectRes.data as Subject[]) ?? [], exams, attempts, attendance: (attendanceRes.data as Attendance[]) ?? [], grades: (gradeRes.data as Grade[]) ?? [], classStudents: (classStudentRes.data as ClassStudent[]) ?? [], classes: (classRes.data as ClassRow[]) ?? [], branches: (branchRes.data as Branch[]) ?? [] });
    setLoading(false);
  }, [institutionId]);

  useEffect(() => { load(); }, [load]);

  const metrics = useMemo(() => {
    const start = sinceDate(range);
    const exams = data.exams.filter((exam) => inRange(exam.created_at, start));
    const attempts = data.attempts.filter((attempt) => inRange(attempt.submitted_at ?? attempt.created_at, start));
    const scored = attempts.filter((attempt) => attempt.score_percentage !== null);
    const attendance = data.attendance.filter((row) => inRange(row.date, start));
    const grades = data.grades.filter((row) => inRange(row.recorded_at, start));
    const subjectNames = new Map(data.subjects.map((subject) => [subject.id, subject.name]));
    const examMap = new Map(data.exams.map((exam) => [exam.id, exam]));
    const classMap = new Map(data.classes.map((row) => [row.id, row]));
    const subjectScores = new Map<string, number[]>();
    const branchScores = new Map<string, number[]>();
    const studentScores = new Map<string, number[]>();
    for (const attempt of scored) {
      const exam = examMap.get(attempt.exam_id);
      if (exam?.subject_id) subjectScores.set(exam.subject_id, [...(subjectScores.get(exam.subject_id) ?? []), Number(attempt.score_percentage)]);
      const branchId = exam?.class_id ? classMap.get(exam.class_id)?.branch_id : null;
      if (branchId) branchScores.set(branchId, [...(branchScores.get(branchId) ?? []), Number(attempt.score_percentage)]);
      studentScores.set(attempt.student_id, [...(studentScores.get(attempt.student_id) ?? []), Number(attempt.score_percentage)]);
    }
    const subjectPerformance = Array.from(subjectScores.entries()).map(([id, scores]) => ({ name: subjectNames.get(id) ?? 'بدون مادة', score: average(scores), count: scores.length })).sort((a, b) => b.score - a.score);
    const branchPerformance = data.branches.map((branch) => ({ name: branch.name, score: average(branchScores.get(branch.id) ?? []), count: branchScores.get(branch.id)?.length ?? 0 })).filter((row) => row.count > 0).sort((a, b) => b.score - a.score);
    const topStudents = Array.from(studentScores.entries()).map(([id, scores]) => ({ name: data.students.find((student) => student.id === id)?.full_name ?? 'طالب', score: average(scores), count: scores.length })).sort((a, b) => b.score - a.score).slice(0, 6);
    const absence = new Map<string, { total: number; absent: number }>();
    for (const row of attendance) { const current = absence.get(row.student_id) ?? { total: 0, absent: 0 }; current.total += 1; if (row.status === 'absent') current.absent += 1; absence.set(row.student_id, current); }
    const riskStudents = data.students.map((student) => { const row = absence.get(student.id); const score = average(studentScores.get(student.id) ?? []); const absenceRate = row?.total ? row.absent / row.total : 0; return { name: student.full_name, score, risk: (score > 0 && score < 50) || absenceRate >= 0.3 }; }).filter((student) => student.risk).slice(0, 6);
    const attendanceRate = attendance.length ? (attendance.filter((row) => row.status === 'present' || row.status === 'late').length / attendance.length) * 100 : 0;
    return { exams, attempts, scored, attendance, grades, subjectPerformance, branchPerformance, topStudents, riskStudents, attendanceRate, avgScore: average(scored.map((attempt) => Number(attempt.score_percentage))), passRate: scored.length ? (scored.filter((attempt) => attempt.is_passed === true).length / scored.length) * 100 : 0 };
  }, [data, range]);

  function exportAnalytics() {
    const rows = [['المؤشر', 'القيمة'], ['الطلاب النشطون', String(data.students.filter((student) => student.is_active).length)], ['الامتحانات', String(metrics.exams.length)], ['المحاولات', String(metrics.attempts.length)], ['متوسط الدرجات', `${metrics.avgScore.toFixed(1)}%`], ['نسبة النجاح', `${metrics.passRate.toFixed(1)}%`], ['نسبة الحضور', `${metrics.attendanceRate.toFixed(1)}%`]];
    const csv = rows.map((row) => row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' })); const link = document.createElement('a'); link.href = url; link.download = 'examify-analytics.csv'; link.click(); URL.revokeObjectURL(url);
  }

  if (loading) return <div className="flex justify-center py-20"><Loader2 size={28} className="animate-spin text-brand-600" /></div>;
  if (error) return <Card className="p-6"><div className="flex items-center gap-2 text-danger-700"><AlertCircle size={18} /> تعذر تحميل التحليلات: {error}</div></Card>;
  const activeStudents = data.students.filter((student) => student.is_active).length;
  const cards: { label: string; value: string | number; icon: typeof Users }[] = [
    { label: 'الطلاب النشطون', value: activeStudents, icon: Users },
    { label: 'الامتحانات', value: metrics.exams.length, icon: BarChart3 },
    { label: 'المحاولات', value: metrics.attempts.length, icon: Target },
    { label: 'متوسط الدرجات', value: `${metrics.avgScore.toFixed(1)}%`, icon: Target },
    { label: 'نسبة الحضور', value: `${metrics.attendanceRate.toFixed(1)}%`, icon: Users },
  ];
  return <div className="space-y-6">
    <SectionHeader title="التحليلات وذكاء الأعمال" subtitle="مؤشرات حقيقية محسوبة من بيانات مؤسستك" action={<button onClick={exportAnalytics} className="btn-outline"><Download size={16} /> تصدير CSV</button>} />
    <div className="flex flex-wrap items-center justify-between gap-3"><div className="flex gap-1 p-1 bg-white rounded-xl border border-ink-100">{ranges.map((item) => <button key={item.value} onClick={() => setRange(item.value)} className={`px-3 py-1.5 rounded-lg text-xs font-600 ${range === item.value ? 'bg-brand-600 text-white' : 'text-ink-600 hover:bg-ink-50'}`}>{item.label}</button>)}</div><span className="text-xs text-ink-400">البيانات مفلترة حسب الفترة المختارة</span></div>
    <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">{cards.map(({ label, value, icon: Icon }) => <Card key={label} className="p-4"><div className="flex items-center gap-2 text-ink-500"><Icon size={17} /><span className="text-xs">{label}</span></div><p className="font-display text-2xl font-800 text-ink-900 mt-2 nums-latin">{value}</p></Card>)}</div>
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">{[['نسبة النجاح', metrics.passRate, 'من المحاولات التي لها درجات'], ['متوسط الدرجات', metrics.avgScore, 'من الامتحانات والمحاولات']].map(([label, value, note]) => <Card key={String(label)} className="p-5"><div className="flex justify-between text-sm"><span>{label}</span><strong className="nums-latin">{Number(value).toFixed(1)}%</strong></div><ProgressBar value={Number(value)} tone="brand" className="mt-3" /><p className="text-xs text-ink-400 mt-2">{note}</p></Card>)}</div>
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-6"><Card className="p-5"><SectionHeader title="أداء المواد" subtitle="محسوب من درجات المحاولات" />{metrics.subjectPerformance.length ? <div className="space-y-4">{metrics.subjectPerformance.map((row) => <div key={row.name}><div className="flex justify-between text-sm mb-1"><span>{row.name}</span><span className="nums-latin">{row.score.toFixed(1)}% · {row.count} محاولة</span></div><ProgressBar value={row.score} tone={row.score >= 60 ? 'accent' : 'danger'} /></div>)}</div> : <EmptyState title="لا توجد درجات بعد" subtitle="ستظهر هنا نتائج المحاولات المصححة." />}</Card><Card className="p-5"><SectionHeader title="مقارنة الفروع" subtitle="متوسط الدرجات حسب الفرع" />{metrics.branchPerformance.length ? <div className="space-y-4">{metrics.branchPerformance.map((row) => <div key={row.name} className="flex items-center gap-3"><span className="w-32 truncate text-sm">{row.name}</span><div className="flex-1"><ProgressBar value={row.score} tone="brand" /></div><span className="w-20 text-left text-sm nums-latin">{row.score.toFixed(1)}%</span></div>)}</div> : <EmptyState title="لا توجد بيانات فروع" subtitle="اربط الامتحانات بفصول وفروع لتظهر المقارنة." />}</Card></div>
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-6"><Card className="p-5"><SectionHeader title="أعلى الطلاب أداءً" subtitle="حسب متوسط الدرجات" />{metrics.topStudents.length ? <div className="space-y-3">{metrics.topStudents.map((student) => <div key={student.name} className="flex items-center gap-3 p-3 rounded-xl bg-ink-50"><div className="flex-1 font-600">{student.name}<span className="block text-xs text-ink-400">{student.count} محاولة</span></div><strong className="text-accent-700 nums-latin">{student.score.toFixed(1)}%</strong></div>)}</div> : <EmptyState title="لا توجد نتائج" subtitle="سيظهر الطلاب بعد تصحيح المحاولات." />}</Card><Card className="p-5"><SectionHeader title="طلاب يحتاجون متابعة" subtitle="انخفاض الدرجات أو ارتفاع الغياب" />{metrics.riskStudents.length ? <div className="space-y-3">{metrics.riskStudents.map((student) => <div key={student.name} className="flex items-center gap-3 p-3 rounded-xl bg-danger-50"><div className="flex-1 font-600">{student.name}<span className="block text-xs text-ink-500">متوسط: {student.score ? `${student.score.toFixed(1)}%` : 'لا توجد درجات'}</span></div><Badge tone="danger">متابعة</Badge></div>)}</div> : <EmptyState title="لا توجد إشارات خطر" subtitle="لا توجد مؤشرات متابعة في الفترة الحالية." />}</Card></div>
    {!data.students.length && !data.exams.length && !data.grades.length && <Card><EmptyState title="لا توجد بيانات تحليلية بعد" subtitle="ابدأ بإضافة طلاب وإنشاء امتحانات وتسجيل محاولات حتى تظهر المؤشرات الحقيقية." /></Card>}
  </div>;
}
