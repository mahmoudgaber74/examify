import { useEffect, useState } from 'react';
import { AlertTriangle, ArrowLeft, BookOpen, CheckCircle2, ClipboardList, FileCheck2, Loader2, ScanLine, Users, Zap } from 'lucide-react';
import { Card, SectionHeader, Badge, EmptyState, ProgressBar } from '../components/ui';
import { supabase, useAuthSafe } from '../lib/auth-helpers';
import { type ViewId } from '../lib/navigation';

interface DashboardStats {
  students: number;
  questions: number;
  exams: number;
  publishedExams: number;
  omrSheets: number;
  omrNeedsReview: number;
  omrApproved: number;
  gradedAttempts: number;
  publishedResults: number;
}

interface RecentExam {
  id: string;
  title: string;
  status: string;
  total_points: number;
  created_at: string;
}

const STATUS_LABELS: Record<string, { label: string; tone: 'neutral' | 'accent' | 'warning' | 'brand' }> = {
  draft: { label: 'مسودة', tone: 'neutral' },
  scheduled: { label: 'مجدول', tone: 'warning' },
  published: { label: 'منشور', tone: 'accent' },
  archived: { label: 'مؤرشف', tone: 'neutral' },
};

export function Dashboard({ onNavigate }: { onNavigate: (v: ViewId) => void }) {
  const { institutionId, role, fullName } = useAuthSafe();
  const [stats, setStats] = useState<DashboardStats>({
    students: 0,
    questions: 0,
    exams: 0,
    publishedExams: 0,
    omrSheets: 0,
    omrNeedsReview: 0,
    omrApproved: 0,
    gradedAttempts: 0,
    publishedResults: 0,
  });
  const [recentExams, setRecentExams] = useState<RecentExam[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    async function loadDashboard() {
      if (!institutionId) {
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const [
          students,
          questions,
          exams,
          publishedExams,
          omrSheets,
          omrNeedsReview,
          omrApproved,
          gradedAttempts,
          publishedResults,
          recent,
        ] = await Promise.all([
          supabase.from('student_profiles').select('id', { count: 'exact', head: true }).eq('institution_id', institutionId),
          supabase.from('questions').select('id', { count: 'exact', head: true }).eq('institution_id', institutionId),
          supabase.from('examify_exams').select('id', { count: 'exact', head: true }).eq('institution_id', institutionId),
          supabase.from('examify_exams').select('id', { count: 'exact', head: true }).eq('institution_id', institutionId).eq('status', 'published'),
          supabase.from('omr_results').select('id', { count: 'exact', head: true }).eq('institution_id', institutionId),
          supabase.from('omr_results').select('id', { count: 'exact', head: true }).eq('institution_id', institutionId).eq('status', 'needs_review'),
          supabase.from('omr_results').select('id', { count: 'exact', head: true }).eq('institution_id', institutionId).eq('status', 'approved'),
          supabase.from('exam_attempts').select('id, examify_exams!inner(institution_id)', { count: 'exact', head: true }).eq('examify_exams.institution_id', institutionId).in('status', ['graded', 'approved']),
          supabase.from('exam_attempts').select('id, examify_exams!inner(institution_id)', { count: 'exact', head: true }).eq('examify_exams.institution_id', institutionId).eq('is_result_published', true),
          supabase
            .from('examify_exams')
            .select('id, title, status, total_points, created_at')
            .eq('institution_id', institutionId)
            .order('created_at', { ascending: false })
            .limit(5),
        ]);

        const firstError = [students, questions, exams, publishedExams, omrSheets, omrNeedsReview, omrApproved, gradedAttempts, publishedResults, recent].find((res) => res.error)?.error;
        if (firstError) throw firstError;
        if (!mounted) return;

        setStats({
          students: students.count ?? 0,
          questions: questions.count ?? 0,
          exams: exams.count ?? 0,
          publishedExams: publishedExams.count ?? 0,
          omrSheets: omrSheets.count ?? 0,
          omrNeedsReview: omrNeedsReview.count ?? 0,
          omrApproved: omrApproved.count ?? 0,
          gradedAttempts: gradedAttempts.count ?? 0,
          publishedResults: publishedResults.count ?? 0,
        });
        setRecentExams((recent.data as RecentExam[]) ?? []);
      } catch (e) {
        if (mounted) setError(e instanceof Error ? e.message : 'تعذر تحميل لوحة التحكم');
      } finally {
        if (mounted) setLoading(false);
      }
    }

    void loadDashboard();
    return () => { mounted = false; };
  }, [institutionId]);

  if (!institutionId) {
    return (
      <Card className="p-8">
        <EmptyState icon={<ClipboardList size={40} />} title="لم يتم ربط الحساب بمؤسسة" subtitle="أكمل إنشاء المؤسسة أو انتظر تفعيل الحساب للبدء." />
      </Card>
    );
  }

  const reviewRate = stats.omrSheets > 0 ? (stats.omrNeedsReview / stats.omrSheets) * 100 : 0;
  const approvedRate = stats.omrSheets > 0 ? (stats.omrApproved / stats.omrSheets) * 100 : 0;
  const isTeacherFlow = ['school_admin', 'teacher', 'grader'].includes(role);
  const workflow = [
    { done: stats.students > 0, title: 'أضف الطلاب', detail: 'أدخل الطلاب أو استوردهم قبل توزيع الامتحان.', action: 'فتح الطلاب', view: 'sis' as ViewId },
    { done: stats.questions > 0, title: 'جهز بنك الأسئلة', detail: 'أنشئ الأسئلة أو استوردها وحدد الإجابات الصحيحة.', action: 'فتح بنك الأسئلة', view: 'questionbank' as ViewId },
    { done: stats.exams > 0, title: 'ابنِ الامتحان', detail: 'اختر المادة والدرجة وأضف الأسئلة إلى الامتحان.', action: 'فتح منشئ الامتحانات', view: 'exambuilder' as ViewId },
    { done: stats.publishedExams > 0, title: 'انشر الامتحان', detail: 'انشر الامتحان ليصبح متاحًا للطلاب أو للطباعة.', action: 'إدارة الامتحانات', view: 'exambuilder' as ViewId },
    { done: stats.gradedAttempts > 0 || stats.omrApproved > 0, title: 'صحح الإجابات', detail: 'صحح الامتحانات الإلكترونية أو راجع أوراق OMR واعتمدها.', action: 'فتح التصحيح', view: stats.omrSheets > 0 ? 'bubblesheet' as ViewId : 'grading' as ViewId },
    { done: stats.publishedResults > 0 || stats.omrApproved > 0, title: 'أصدر النتائج', detail: 'راجع النتائج وانشرها للطلاب وأولياء الأمور.', action: 'فتح النتائج', view: 'examresults' as ViewId },
  ];
  const completedSteps = workflow.filter((step) => step.done).length;
  const workflowProgress = Math.round((completedSteps / workflow.length) * 100);
  const nextStep = workflow.find((step) => !step.done);

  return (
    <div className="space-y-6">
      <div className="rounded-2xl bg-ink-950 text-white p-6 lg:p-8 overflow-hidden relative">
        <div className="absolute inset-0 grid-bg opacity-10" />
        <div className="relative flex flex-col lg:flex-row lg:items-center lg:justify-between gap-5">
          <div className="max-w-3xl">
            <Badge tone="brand">منصة التصحيح الذكي</Badge>
            <h1 className="font-display text-2xl lg:text-3xl font-800 mt-3">
              {isTeacherFlow ? 'أنشئ امتحانًا وصحح أوراقه في مسار واحد' : 'لوحة تشغيل منصة التصحيح الإلكتروني'}
            </h1>
            <p className="text-ink-300 mt-2 text-sm leading-7">
              مرحبًا {fullName ?? 'بك'}. هذه اللوحة تعرض بيانات المؤسسة الفعلية وتجمع خطوات الدورة الأولى: الطلاب، بنك الأسئلة، الامتحان، البابل شيت، المراجعة، ثم النتائج.
            </p>
          </div>
          <div className="flex flex-col sm:flex-row gap-2 shrink-0">
            <button onClick={() => onNavigate('exambuilder')} className="btn bg-white text-ink-950 hover:bg-ink-100">
              <Zap size={17} /> أنشئ امتحانًا وصحح أوراقه
            </button>
            <button onClick={() => onNavigate('bubblesheet')} className="btn bg-white/10 text-white border border-white/20 hover:bg-white/20">
              <ScanLine size={17} /> مسح أوراق
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 p-3 rounded-xl bg-danger-50 border border-danger-200">
          <AlertTriangle size={18} className="text-danger-600" />
          <p className="text-sm text-danger-700">{error}</p>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 size={24} className="animate-spin text-brand-600" /></div>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard testId="dashboard-stat-students" label="الطلاب" value={stats.students} icon={<Users size={20} />} />
            <StatCard testId="dashboard-stat-questions" label="الأسئلة" value={stats.questions} icon={<BookOpen size={20} />} />
            <StatCard testId="dashboard-stat-exams" label="الامتحانات" value={stats.exams} icon={<FileCheck2 size={20} />} />
            <StatCard testId="dashboard-stat-omr" label="أوراق OMR" value={stats.omrSheets} icon={<ScanLine size={20} />} />
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
            <Card className="p-5 xl:col-span-2">
              <SectionHeader title="مسار العمل" subtitle="اتبع الخطوات بالترتيب من إعداد الامتحان حتى إعلان النتائج." />
              <div className="mb-5 rounded-xl bg-ink-50 border border-ink-100 p-4">
                <div className="flex items-center justify-between gap-3 mb-2">
                  <div>
                    <p className="text-sm font-700 text-ink-900">تقدم المسار</p>
                    <p className="text-xs text-ink-500 mt-1">اكتملت {completedSteps} من {workflow.length} خطوات</p>
                  </div>
                  <span className="font-display font-800 text-xl text-brand-600 nums-latin">{workflowProgress}%</span>
                </div>
                <ProgressBar value={workflowProgress} tone={workflowProgress === 100 ? 'accent' : 'brand'} />
              </div>
              {nextStep && (
                <button type="button" onClick={() => onNavigate(nextStep.view)} className="w-full mb-4 flex items-center justify-between gap-3 rounded-xl border border-warning-200 bg-warning-50 p-3 text-right hover:bg-warning-100 transition">
                  <span className="flex items-center gap-2 min-w-0"><AlertTriangle size={17} className="text-warning-600 shrink-0" /><span className="text-sm text-warning-800 truncate">الخطوة التالية: <strong>{nextStep.title}</strong></span></span>
                  <ArrowLeft size={16} className="text-warning-700 shrink-0" />
                </button>
              )}
              <div className="grid md:grid-cols-2 gap-3">
                {workflow.map((step) => <WorkflowStep key={step.title} done={step.done} title={step.title} detail={step.detail} action={step.action} onClick={() => onNavigate(step.view)} />)}
              </div>
            </Card>

            <Card className="p-5">
              <SectionHeader title="جودة التصحيح" subtitle="مؤشرات مراجعة أوراق OMR." />
              <div className="space-y-4">
                <div>
                  <div className="flex items-center justify-between text-sm mb-1">
                    <span className="text-ink-600">المعتمدة</span>
                    <span className="font-700 nums-latin">{Math.round(approvedRate)}%</span>
                  </div>
                  <ProgressBar value={approvedRate} tone="accent" />
                </div>
                <div>
                  <div className="flex items-center justify-between text-sm mb-1">
                    <span className="text-ink-600">تحتاج مراجعة</span>
                    <span className="font-700 nums-latin">{stats.omrNeedsReview}</span>
                  </div>
                  <ProgressBar value={reviewRate} tone={reviewRate > 25 ? 'danger' : 'warning'} />
                </div>
                <button onClick={() => onNavigate('bubblesheet')} className="btn-outline w-full">
                  <CheckCircle2 size={16} /> افتح شاشة المراجعة
                </button>
              </div>
            </Card>
          </div>

          <Card className="p-5">
            <SectionHeader title="آخر الامتحانات" subtitle="أحدث امتحانات المؤسسة." action={<button onClick={() => onNavigate('exambuilder')} className="btn-outline !py-2"><FileCheck2 size={16} /> إدارة الامتحانات</button>} />
            {recentExams.length === 0 ? (
              <EmptyState icon={<ClipboardList size={40} />} title="لا توجد امتحانات بعد" subtitle="ابدأ بإنشاء أول امتحان من الزر الرئيسي." />
            ) : (
              <div className="grid gap-2">
                {recentExams.map((exam) => {
                  const status = STATUS_LABELS[exam.status] ?? STATUS_LABELS.draft;
                  return (
                    <div key={exam.id} className="flex items-center justify-between gap-3 p-3 rounded-xl border border-ink-100">
                      <div className="min-w-0">
                        <p className="font-700 text-ink-900 truncate">{exam.title}</p>
                        <p className="text-xs text-ink-400 nums-latin">{new Date(exam.created_at).toLocaleDateString('ar')} · {exam.total_points} درجة</p>
                      </div>
                      <Badge tone={status.tone}>{status.label}</Badge>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}

function StatCard({ label, value, icon, testId }: { label: string; value: number; icon: React.ReactNode; testId?: string }) {
  return (
    <Card hover className="p-4 flex items-center gap-3" data-testid={testId}>
      <div className="grid place-items-center w-10 h-10 rounded-xl bg-brand-50 text-brand-600">{icon}</div>
      <div>
        <p className="text-xs text-ink-500">{label}</p>
        <p className="font-display font-800 text-xl text-ink-900 nums-latin">{value.toLocaleString()}</p>
      </div>
    </Card>
  );
}

function WorkflowStep({ done, title, detail, action, onClick }: { done: boolean; title: string; detail: string; action: string; onClick: () => void }) {
  return (
    <div className="rounded-xl border border-ink-100 p-4 bg-white">
      <div className="flex items-start gap-3">
        <div className={`grid place-items-center w-9 h-9 rounded-lg shrink-0 ${done ? 'bg-accent-50 text-accent-600' : 'bg-warning-50 text-warning-600'}`}>
          {done ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-700 text-ink-900">{title}</h3>
            <Badge tone={done ? 'accent' : 'warning'}>{done ? 'جاهز' : 'مطلوب'}</Badge>
          </div>
          <p className="text-sm text-ink-500 mt-1 leading-6">{detail}</p>
          <button onClick={onClick} className="text-sm font-700 text-brand-600 hover:text-brand-700 mt-2">{action}</button>
        </div>
      </div>
    </div>
  );
}
