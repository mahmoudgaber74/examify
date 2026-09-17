import { useEffect, useState } from 'react';
import { Activity, AlertTriangle, ArrowLeft, BookOpen, Building2, CalendarDays, CheckCircle2, ClipboardList, Clock3, FileCheck2, Loader2, ScanLine, ShieldCheck, Users, Zap } from 'lucide-react';
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
      if (role === 'student' || role === 'teacher' || role === 'super_admin') {
        setLoading(false);
        return;
      }
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
  }, [institutionId, role]);

  if (role === 'super_admin') return <SuperAdminDashboard onNavigate={onNavigate} fullName={fullName} />;

  if (!institutionId) {
    return (
      <Card className="p-8">
        <EmptyState icon={<ClipboardList size={40} />} title="لم يتم ربط الحساب بمؤسسة" subtitle="أكمل إنشاء المؤسسة أو انتظر تفعيل الحساب للبدء." />
      </Card>
    );
  }

  if (role === 'student') return <StudentDashboard onNavigate={onNavigate} institutionId={institutionId} fullName={fullName} />;
  if (role === 'teacher') return <TeacherDashboard onNavigate={onNavigate} institutionId={institutionId} fullName={fullName} />;

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

interface SuperAdminInstitution {
  id: string;
  name: string;
  name_en: string | null;
  city: string | null;
  subscription_plan: string;
  subscription_status: string;
  is_active: boolean;
  created_at: string;
}

interface SuperAdminData {
  institutions: SuperAdminInstitution[];
  activeInstitutions: number;
  inactiveInstitutions: number;
  staff: number;
  students: number;
  exams: number;
  omrSheets: number;
  attempts: number;
}

function SuperAdminDashboard({ onNavigate, fullName }: { onNavigate: (v: ViewId) => void; fullName: string | null }) {
  const [data, setData] = useState<SuperAdminData>({ institutions: [], activeInstitutions: 0, inactiveInstitutions: 0, staff: 0, students: 0, exams: 0, omrSheets: 0, attempts: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    async function loadSuperAdminDashboard() {
      setLoading(true);
      setError(null);
      const [institutions, active, inactive, staff, students, exams, omrSheets, attempts] = await Promise.all([
        supabase.from('institutions').select('id, name, name_en, city, subscription_plan, subscription_status, is_active, created_at').order('created_at', { ascending: false }).limit(8),
        supabase.from('institutions').select('id', { count: 'exact', head: true }).eq('is_active', true),
        supabase.from('institutions').select('id', { count: 'exact', head: true }).eq('is_active', false),
        supabase.from('staff_profiles').select('id', { count: 'exact', head: true }),
        supabase.from('student_profiles').select('id', { count: 'exact', head: true }),
        supabase.from('examify_exams').select('id', { count: 'exact', head: true }),
        supabase.from('omr_results').select('id', { count: 'exact', head: true }),
        supabase.from('exam_attempts').select('id', { count: 'exact', head: true }),
      ]);

      if (!mounted) return;
      const firstError = [institutions, active, inactive, staff, students, exams, omrSheets, attempts].find((result) => result.error)?.error;
      if (firstError) setError('تعذر تحميل بعض مؤشرات النظام. افتح إدارة المؤسسات لمراجعة التفاصيل.');
      setData({
        institutions: (institutions.data as SuperAdminInstitution[]) ?? [],
        activeInstitutions: active.count ?? 0,
        inactiveInstitutions: inactive.count ?? 0,
        staff: staff.count ?? 0,
        students: students.count ?? 0,
        exams: exams.count ?? 0,
        omrSheets: omrSheets.count ?? 0,
        attempts: attempts.count ?? 0,
      });
      setLoading(false);
    }

    void loadSuperAdminDashboard();
    return () => { mounted = false; };
  }, []);

  const followUp = data.institutions.filter((institution) => !institution.is_active || ['suspended', 'past_due', 'expired'].includes(institution.subscription_status));
  const planLabel: Record<string, string> = { free: 'مجاني', basic: 'أساسي', pro: 'احترافي', enterprise: 'مؤسسي' };
  const statusLabel: Record<string, string> = { trial: 'تجريبي', active: 'نشط', suspended: 'موقوف', past_due: 'متأخر', expired: 'منتهي' };

  if (loading) return <div className="flex justify-center py-16"><Loader2 size={28} className="animate-spin text-brand-600" /></div>;

  return (
    <div className="space-y-6" data-testid="super-admin-dashboard">
      <div className="relative overflow-hidden rounded-2xl bg-ink-950 p-6 text-white lg:p-8">
        <div className="absolute inset-0 grid-bg opacity-10" />
        <div className="relative flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <Badge tone="brand">لوحة مدير النظام</Badge>
            <h1 className="mt-3 font-display text-2xl font-800 lg:text-3xl">مرحبًا {fullName ?? 'بك'}</h1>
            <p className="mt-2 max-w-2xl text-sm leading-7 text-ink-300">تابع حالة المنصة والمؤسسات والمستخدمين من لوحة مركزية مستقلة عن لوحات المدارس.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => onNavigate('institutions')} className="btn bg-white text-ink-950 hover:bg-ink-100"><Building2 size={17} /> إدارة المؤسسات</button>
            <button type="button" onClick={() => onNavigate('analytics')} className="btn border border-white/20 bg-white/10 text-white hover:bg-white/20"><Activity size={17} /> تحليلات النظام</button>
          </div>
        </div>
      </div>

      {error && <div className="flex items-center gap-2 rounded-xl border border-warning-200 bg-warning-50 p-4 text-sm text-warning-800"><AlertTriangle size={18} />{error}</div>}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StudentStat label="مؤسسات نشطة" value={data.activeInstitutions} icon={<Building2 size={20} />} />
        <StudentStat label="إجمالي المستخدمين" value={data.staff + data.students} icon={<Users size={20} />} />
        <StudentStat label="إجمالي الامتحانات" value={data.exams} icon={<FileCheck2 size={20} />} />
        <StudentStat label="أوراق OMR" value={data.omrSheets} icon={<ScanLine size={20} />} />
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <Card className="p-5 xl:col-span-2">
          <SectionHeader title="مؤشرات المنصة" subtitle="أرقام إجمالية على مستوى كل المؤسسات المسجلة." />
          <div className="grid gap-3 sm:grid-cols-2">
            <SummaryBox label="المؤسسات المتوقفة" value={data.inactiveInstitutions} />
            <SummaryBox label="المدرسون والإداريون" value={data.staff} />
            <SummaryBox label="الطلاب" value={data.students} />
            <SummaryBox label="محاولات الامتحانات" value={data.attempts} />
          </div>
          {followUp.length > 0 && <div className="mt-4 rounded-2xl border border-warning-200 bg-warning-50 p-4"><div className="flex items-center gap-2 font-700 text-warning-800"><AlertTriangle size={18} /> مؤسسات تحتاج متابعة</div><div className="mt-3 space-y-2">{followUp.slice(0, 4).map((institution) => <div key={institution.id} className="flex items-center justify-between gap-3 rounded-xl bg-white/70 px-3 py-2 text-sm"><span className="truncate text-ink-800">{institution.name}</span><Badge tone="warning">{institution.is_active ? (statusLabel[institution.subscription_status] ?? 'مراجعة') : 'متوقفة'}</Badge></div>)}</div></div>}
        </Card>

        <Card className="p-5">
          <SectionHeader title="اختصارات مدير النظام" subtitle="إدارة وتشغيل المنصة بسرعة." />
          <div className="space-y-3">
            <button type="button" onClick={() => onNavigate('institutions')} className="btn-outline w-full justify-between">إضافة مؤسسة جديدة <Building2 size={17} /></button>
            <button type="button" onClick={() => onNavigate('analytics')} className="btn-outline w-full justify-between">مراجعة التحليلات <Activity size={17} /></button>
            <button type="button" onClick={() => onNavigate('settings')} className="btn-outline w-full justify-between">إعدادات النظام <ShieldCheck size={17} /></button>
          </div>
        </Card>
      </div>

      <Card className="p-5">
        <SectionHeader title="أحدث المؤسسات" subtitle="آخر المؤسسات التي انضمت إلى المنصة." action={<button type="button" onClick={() => onNavigate('institutions')} className="btn-outline !min-h-10 !px-4 !py-2 !text-sm">عرض كل المؤسسات <ArrowLeft size={16} /></button>} />
        {data.institutions.length === 0 ? <EmptyState icon={<Building2 size={40} />} title="لا توجد مؤسسات بعد" subtitle="ابدأ بإضافة أول مؤسسة إلى المنصة." /> : <div className="grid gap-3 md:grid-cols-2">{data.institutions.map((institution) => <div key={institution.id} className="flex items-center justify-between gap-3 rounded-2xl border border-ink-100 p-4"><div className="flex min-w-0 items-center gap-3"><div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-600"><Building2 size={19} /></div><div className="min-w-0"><p className="truncate font-700 text-ink-900">{institution.name}</p><p className="mt-1 text-xs text-ink-500">{institution.city || 'بدون مدينة'} · {planLabel[institution.subscription_plan] ?? institution.subscription_plan}</p></div></div><Badge tone={institution.is_active ? 'accent' : 'neutral'}>{institution.is_active ? (statusLabel[institution.subscription_status] ?? 'نشط') : 'متوقفة'}</Badge></div>)}</div>}
      </Card>
    </div>
  );
}

interface TeacherExam {
  id: string;
  title: string;
  status: string;
  total_points: number;
  created_at: string;
}

interface TeacherAttempt {
  id: string;
  status: string;
  submitted_at: string | null;
  score_percentage: number | null;
  examify_exams: { title: string } | null;
}

interface TeacherDashboardData {
  exams: TeacherExam[];
  examCount: number;
  publishedExamCount: number;
  draftExamCount: number;
  questionCount: number;
  assignmentCount: number;
  attemptsToGrade: number;
  omrToReview: number;
  recentAttempts: TeacherAttempt[];
}

function TeacherDashboard({ onNavigate, institutionId, fullName }: { onNavigate: (v: ViewId) => void; institutionId: string; fullName: string | null }) {
  const { user } = useAuthSafe();
  const [data, setData] = useState<TeacherDashboardData>({ exams: [], examCount: 0, publishedExamCount: 0, draftExamCount: 0, questionCount: 0, assignmentCount: 0, attemptsToGrade: 0, omrToReview: 0, recentAttempts: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    async function loadTeacherDashboard() {
      if (!user) return;
      setLoading(true);
      setError(null);

      const { data: staff, error: staffError } = await supabase
        .from('staff_profiles')
        .select('id')
        .eq('user_id', user.id)
        .maybeSingle();
      const teacherId = (staff as { id?: string } | null)?.id;

      if (staffError || !teacherId) {
        if (mounted) {
          setError('تعذر ربط حساب المدرس بملفه الوظيفي. راجع مدير المؤسسة.');
          setLoading(false);
        }
        return;
      }

      const [examResult, examIdsResult, publishedExamResult, draftExamResult, questionResult, assignmentResult, attemptResult] = await Promise.all([
        supabase
          .from('examify_exams')
          .select('id, title, status, total_points, created_at')
          .eq('institution_id', institutionId)
          .eq('teacher_id', teacherId)
          .order('created_at', { ascending: false })
          .limit(6),
        supabase
          .from('examify_exams')
          .select('id')
          .eq('institution_id', institutionId)
          .eq('teacher_id', teacherId),
        supabase
          .from('examify_exams')
          .select('id', { count: 'exact', head: true })
          .eq('institution_id', institutionId)
          .eq('teacher_id', teacherId)
          .eq('status', 'published'),
        supabase
          .from('examify_exams')
          .select('id', { count: 'exact', head: true })
          .eq('institution_id', institutionId)
          .eq('teacher_id', teacherId)
          .eq('status', 'draft'),
        supabase
          .from('questions')
          .select('id', { count: 'exact', head: true })
          .eq('institution_id', institutionId)
          .eq('teacher_id', teacherId),
        supabase
          .from('subject_teachers')
          .select('id', { count: 'exact', head: true })
          .eq('institution_id', institutionId)
          .eq('teacher_id', teacherId)
          .eq('is_active', true),
        supabase
          .from('exam_attempts')
          .select('id, status, submitted_at, score_percentage, examify_exams!inner(title, teacher_id, institution_id)', { count: 'exact' })
          .eq('examify_exams.institution_id', institutionId)
          .eq('examify_exams.teacher_id', teacherId)
          .in('status', ['submitted', 'auto_submitted'])
          .order('submitted_at', { ascending: false, nullsFirst: false })
          .limit(6),
      ]);

      let omrToReview = 0;
      const examIds = ((examIdsResult.data as Array<{ id: string }> | null) ?? []).map((exam) => exam.id);
      if (examIds.length > 0) {
        const omrResult = await supabase
          .from('omr_results')
          .select('id', { count: 'exact', head: true })
          .eq('institution_id', institutionId)
          .eq('status', 'needs_review')
          .in('exam_id', examIds);
        omrToReview = omrResult.count ?? 0;
      }

      if (!mounted) return;
      const firstError = examResult.error ?? examIdsResult.error ?? publishedExamResult.error ?? draftExamResult.error ?? questionResult.error ?? assignmentResult.error ?? attemptResult.error;
      if (firstError) setError('تعذر تحميل بعض بيانات لوحة المدرس. يمكنك فتح الأقسام مباشرة من الاختصارات.');
      setData({
        exams: (examResult.data as TeacherExam[]) ?? [],
        examCount: examIds.length,
        publishedExamCount: publishedExamResult.count ?? 0,
        draftExamCount: draftExamResult.count ?? 0,
        questionCount: questionResult.count ?? 0,
        assignmentCount: assignmentResult.count ?? 0,
        attemptsToGrade: attemptResult.count ?? 0,
        omrToReview,
        recentAttempts: (attemptResult.data as unknown as TeacherAttempt[]) ?? [],
      });
      setLoading(false);
    }

    void loadTeacherDashboard();
    return () => { mounted = false; };
  }, [institutionId, user]);

  const needsAttention = [
    data.questionCount === 0 ? { title: 'أضف أول سؤال إلى بنكك', detail: 'أنشئ أسئلة جديدة أو استوردها لتستخدمها في امتحاناتك.', action: 'فتح بنك الأسئلة', view: 'questionbank' as ViewId, tone: 'warning' as const } : null,
    data.examCount === 0 ? { title: 'أنشئ أول امتحان لك', detail: 'ابدأ بإنشاء امتحان وربطه بالمادة والفصل المناسبين.', action: 'إنشاء امتحان', view: 'exambuilder' as ViewId, tone: 'warning' as const } : null,
    data.attemptsToGrade > 0 ? { title: `${data.attemptsToGrade.toLocaleString('ar')} محاولة تنتظر التصحيح`, detail: 'راجع إجابات الطلاب واعتمد الدرجات عند الانتهاء.', action: 'فتح التصحيح', view: 'grading' as ViewId, tone: 'warning' as const } : null,
    data.omrToReview > 0 ? { title: `${data.omrToReview.toLocaleString('ar')} ورقة OMR تحتاج مراجعة`, detail: 'راجع الحالات غير المؤكدة قبل اعتماد النتائج.', action: 'فتح مراجعة OMR', view: 'bubblesheet' as ViewId, tone: 'warning' as const } : null,
  ].filter(Boolean) as Array<{ title: string; detail: string; action: string; view: ViewId; tone: 'warning' }>;

  if (loading) return <div className="flex justify-center py-16"><Loader2 size={28} className="animate-spin text-brand-600" /></div>;

  return (
    <div className="space-y-6" data-testid="teacher-dashboard">
      <div className="relative overflow-hidden rounded-2xl bg-ink-950 p-6 text-white lg:p-8">
        <div className="absolute inset-0 grid-bg opacity-10" />
        <div className="relative flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <Badge tone="brand">لوحة المدرس</Badge>
            <h1 className="mt-3 font-display text-2xl font-800 lg:text-3xl">مرحبًا {fullName ?? 'بك'}</h1>
            <p className="mt-2 max-w-2xl text-sm leading-7 text-ink-300">تابع امتحاناتك وأسئلتك ومحاولات الطلاب التي تحتاج إلى تصحيح من مكان واحد.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => onNavigate('exambuilder')} className="btn bg-white text-ink-950 hover:bg-ink-100"><Zap size={17} /> إنشاء امتحان</button>
            <button type="button" onClick={() => onNavigate('questionbank')} className="btn border border-white/20 bg-white/10 text-white hover:bg-white/20"><BookOpen size={17} /> بنك الأسئلة</button>
          </div>
        </div>
      </div>

      {error && <div className="flex items-center gap-2 rounded-xl border border-warning-200 bg-warning-50 p-4 text-sm text-warning-800"><AlertTriangle size={18} />{error}</div>}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StudentStat label="امتحاناتي" value={data.examCount} icon={<FileCheck2 size={20} />} />
        <StudentStat label="أسئلتي" value={data.questionCount} icon={<BookOpen size={20} />} />
        <StudentStat label="تحتاج تصحيح" value={data.attemptsToGrade} icon={<ClipboardList size={20} />} />
        <StudentStat label="الفصول المسندة" value={data.assignmentCount} icon={<Users size={20} />} />
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <Card className="p-5 xl:col-span-2">
          <SectionHeader title="ما يحتاج إجراء" subtitle="أهم المهام المرتبطة بامتحاناتك وطلابك." />
          {needsAttention.length === 0 ? (
            <div className="rounded-2xl border border-accent-200 bg-accent-50 p-5 text-accent-800"><div className="flex items-center gap-2 font-700"><CheckCircle2 size={19} /> كل شيء جاهز حاليًا</div><p className="mt-2 text-sm">لا توجد محاولات أو أوراق معلقة للمراجعة.</p></div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {needsAttention.map((item) => <WorkflowStep key={item.title} done={false} title={item.title} detail={item.detail} action={item.action} onClick={() => onNavigate(item.view)} />)}
            </div>
          )}
        </Card>

        <Card className="p-5">
          <SectionHeader title="ملخص سريع" subtitle="نظرة على محتوى حسابك." />
          <div className="space-y-3">
            <SummaryBox label="امتحانات منشورة" value={data.publishedExamCount} />
            <SummaryBox label="مسودات امتحانات" value={data.draftExamCount} />
            <button type="button" onClick={() => onNavigate('grading')} className="btn-outline w-full">فتح شاشة التصحيح <ArrowLeft size={16} /></button>
          </div>
        </Card>
      </div>

      <Card className="p-5">
        <SectionHeader title="آخر امتحاناتي" subtitle="أحدث الامتحانات التي أنشأتها أنت." action={<button type="button" onClick={() => onNavigate('exambuilder')} className="btn-outline !min-h-10 !px-4 !py-2 !text-sm">إدارة الامتحانات <ArrowLeft size={16} /></button>} />
        {data.examCount === 0 ? <EmptyState icon={<ClipboardList size={40} />} title="لم تنشئ امتحانات بعد" subtitle="ابدأ بإنشاء أول امتحان من الزر أعلاه." /> : <div className="grid gap-2">{data.exams.map((exam) => { const status = STATUS_LABELS[exam.status] ?? STATUS_LABELS.draft; return <div key={exam.id} className="flex items-center justify-between gap-3 rounded-xl border border-ink-100 p-3"><div className="min-w-0"><p className="truncate font-700 text-ink-900">{exam.title}</p><p className="mt-1 text-xs text-ink-400 nums-latin">{new Date(exam.created_at).toLocaleDateString('ar')} · {exam.total_points} درجة</p></div><Badge tone={status.tone}>{status.label}</Badge></div>; })}</div>}
      </Card>

      {data.recentAttempts.length > 0 && <Card className="p-5"><SectionHeader title="آخر المحاولات المنتظرة" subtitle="محاولات الطلاب التي تحتاج مراجعتك." /><div className="grid gap-2 md:grid-cols-2">{data.recentAttempts.map((attempt) => <div key={attempt.id} className="flex items-center justify-between gap-3 rounded-xl border border-ink-100 p-3"><div className="min-w-0"><p className="truncate font-700 text-ink-900">{attempt.examify_exams?.title ?? 'امتحان'}</p><p className="mt-1 text-xs text-ink-500">{attempt.submitted_at ? new Date(attempt.submitted_at).toLocaleString('ar') : 'بانتظار التصحيح'}</p></div><Badge tone="warning">يحتاج تصحيح</Badge></div>)}</div></Card>}
    </div>
  );
}

interface StudentExam {
  id: string;
  title: string;
  total_points: number;
  duration_minutes: number;
  start_at: string | null;
  end_at: string | null;
  status: string;
}

interface StudentAttempt {
  id: string;
  exam_id: string;
  status: string;
  score: number | null;
  score_percentage: number | null;
  is_passed: boolean | null;
  is_result_published: boolean;
  submitted_at: string | null;
  attempt_number: number;
}

function StudentDashboard({ onNavigate, institutionId, fullName }: { onNavigate: (v: ViewId) => void; institutionId: string; fullName: string | null }) {
  const { user } = useAuthSafe();
  const [exams, setExams] = useState<StudentExam[]>([]);
  const [attempts, setAttempts] = useState<StudentAttempt[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    async function loadStudentDashboard() {
      if (!user) return;
      setLoading(true);
      setError(null);

      const { data: student, error: studentError } = await supabase
        .from('student_profiles')
        .select('id')
        .eq('user_id', user.id)
        .maybeSingle();

      if (studentError || !student) {
        if (mounted) {
          setError('تعذر تحميل ملف الطالب. حاول مرة أخرى لاحقًا.');
          setLoading(false);
        }
        return;
      }

      const studentId = (student as { id: string }).id;
      const [examResult, attemptResult] = await Promise.all([
        supabase.from('examify_exams').select('id, title, total_points, duration_minutes, start_at, end_at, status').eq('institution_id', institutionId).eq('status', 'published').order('start_at', { ascending: true, nullsFirst: false }),
        supabase.from('exam_attempts').select('id, exam_id, status, score, score_percentage, is_passed, is_result_published, submitted_at, attempt_number').eq('student_id', studentId).order('submitted_at', { ascending: false, nullsFirst: false }),
      ]);

      if (!mounted) return;
      const firstError = examResult.error ?? attemptResult.error;
      if (firstError) setError('تعذر تحميل بيانات لوحة الطالب. حاول مرة أخرى لاحقًا.');
      setExams((examResult.data as StudentExam[]) ?? []);
      setAttempts((attemptResult.data as StudentAttempt[]) ?? []);
      setLoading(false);
    }

    void loadStudentDashboard();
    return () => { mounted = false; };
  }, [institutionId, user]);

  const examById = new Map(exams.map((exam) => [exam.id, exam]));
  const latestAttemptByExam = new Map<string, StudentAttempt>();
  attempts.forEach((attempt) => {
    if (!latestAttemptByExam.has(attempt.exam_id)) latestAttemptByExam.set(attempt.exam_id, attempt);
  });
  const now = Date.now();
  const activeExams = exams.filter((exam) => (!exam.start_at || new Date(exam.start_at).getTime() <= now) && (!exam.end_at || new Date(exam.end_at).getTime() >= now));
  const upcomingExams = exams.filter((exam) => exam.start_at && new Date(exam.start_at).getTime() > now);
  const inProgressCount = attempts.filter((attempt) => attempt.status === 'in_progress').length;
  const publishedResults = attempts.filter((attempt) => attempt.is_result_published);
  const completedAttempts = attempts.filter((attempt) => ['submitted', 'auto_submitted', 'graded', 'approved'].includes(attempt.status));
  const visibleExams = [...activeExams, ...upcomingExams].slice(0, 6);

  if (loading) return <div className="flex justify-center py-16"><Loader2 size={28} className="animate-spin text-brand-600" /></div>;

  return (
    <div className="space-y-6" data-testid="student-dashboard">
      <div className="relative overflow-hidden rounded-2xl bg-brand-600 p-6 text-white lg:p-8">
        <div className="absolute inset-0 grid-bg opacity-10" />
        <div className="relative flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <span className="inline-flex rounded-full bg-white/15 px-3 py-1 text-sm font-600">لوحة الطالب</span>
            <h1 className="mt-3 font-display text-2xl font-800 lg:text-3xl">أهلاً {fullName ?? 'بك'}</h1>
            <p className="mt-2 max-w-2xl text-sm leading-7 text-white/80">تابع امتحاناتك، ابدأ المحاولات المتاحة، وراجع نتائجك من مكان واحد.</p>
          </div>
          <button type="button" onClick={() => onNavigate('examrunner')} className="btn bg-white text-brand-700 hover:bg-brand-50">
            <BookOpen size={17} /> عرض الامتحانات
          </button>
        </div>
      </div>

      {error && <div className="flex items-center gap-2 rounded-xl border border-danger-200 bg-danger-50 p-4 text-sm text-danger-700"><AlertTriangle size={18} />{error}</div>}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StudentStat label="امتحانات متاحة" value={exams.length} icon={<ClipboardList size={20} />} />
        <StudentStat label="امتحانات حالية" value={activeExams.length} icon={<Zap size={20} />} />
        <StudentStat label="قيد الحل" value={inProgressCount} icon={<Clock3 size={20} />} />
        <StudentStat label="نتائج منشورة" value={publishedResults.length} icon={<CheckCircle2 size={20} />} />
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <Card className="p-5 xl:col-span-2">
          <SectionHeader title="امتحاناتي" subtitle="الامتحانات الحالية والقادمة المخصصة لك." action={<button type="button" onClick={() => onNavigate('examrunner')} className="btn-outline !min-h-10 !px-4 !py-2 !text-sm">كل الامتحانات <ArrowLeft size={16} /></button>} />
          {visibleExams.length === 0 ? (
            <EmptyState icon={<ClipboardList size={40} />} title="لا توجد امتحانات متاحة حاليًا" subtitle="سيظهر الامتحان هنا بعد أن يخصصه لك المدرس وينشره." />
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {visibleExams.map((exam) => {
                const attempt = latestAttemptByExam.get(exam.id);
                const isUpcoming = Boolean(exam.start_at && new Date(exam.start_at).getTime() > now);
                return (
                  <div key={exam.id} className="rounded-2xl border border-ink-100 bg-ink-50/50 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0"><h3 className="truncate text-base font-700 text-ink-900">{exam.title}</h3><p className="mt-1 text-sm text-ink-500">{exam.duration_minutes} دقيقة · {exam.total_points} درجة</p></div>
                      <Badge tone={attempt?.status === 'in_progress' ? 'brand' : isUpcoming ? 'warning' : 'accent'}>{attempt?.status === 'in_progress' ? 'قيد الحل' : isUpcoming ? 'قادم' : 'متاح'}</Badge>
                    </div>
                    {isUpcoming && exam.start_at && <p className="mt-3 flex items-center gap-1.5 text-sm text-ink-500"><CalendarDays size={15} /> يبدأ {new Date(exam.start_at).toLocaleString('ar')}</p>}
                    <button type="button" onClick={() => onNavigate('examrunner')} className="mt-4 text-sm font-700 text-brand-600 hover:text-brand-700">{attempt?.status === 'in_progress' ? 'استكمال الامتحان' : isUpcoming ? 'عرض التفاصيل' : 'بدء الامتحان'} <ArrowLeft size={14} className="inline" /></button>
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        <Card className="p-5">
          <SectionHeader title="آخر النتائج" subtitle="نتائج الامتحانات المنشورة لك." />
          {publishedResults.length === 0 ? (
            <EmptyState icon={<CheckCircle2 size={36} />} title="لا توجد نتائج منشورة" subtitle="ستظهر نتائجك هنا بعد اعتمادها ونشرها." />
          ) : (
            <div className="space-y-3">
              {publishedResults.slice(0, 5).map((attempt) => {
                const exam = examById.get(attempt.exam_id);
                return <div key={attempt.id} className="flex items-center justify-between gap-3 rounded-xl border border-ink-100 p-3"><div className="min-w-0"><p className="truncate text-sm font-700 text-ink-800">{exam?.title ?? 'امتحان'}</p><p className="mt-1 text-xs text-ink-400">المحاولة {attempt.attempt_number}</p></div><span className={`text-lg font-800 nums-latin ${attempt.is_passed ? 'text-accent-600' : 'text-danger-600'}`}>{attempt.score_percentage?.toFixed(1) ?? '—'}%</span></div>;
              })}
              <button type="button" onClick={() => onNavigate('examresults')} className="btn-outline mt-2 w-full !min-h-10 !text-sm">عرض كل النتائج</button>
            </div>
          )}
        </Card>
      </div>

      <Card className="p-5">
        <SectionHeader title="ملخص المحاولات" subtitle="تابع المحاولات التي بدأتَها أو سلّمتها." />
        <div className="grid gap-3 sm:grid-cols-3">
          <SummaryBox label="إجمالي المحاولات" value={attempts.length} />
          <SummaryBox label="تم التسليم" value={completedAttempts.length} />
          <SummaryBox label="نتائج بانتظار النشر" value={completedAttempts.filter((attempt) => !attempt.is_result_published).length} />
        </div>
      </Card>
    </div>
  );
}

function StudentStat({ label, value, icon }: { label: string; value: number; icon: React.ReactNode }) {
  return <Card className="flex items-center gap-3 p-4"><div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-600">{icon}</div><div><p className="text-sm text-ink-500">{label}</p><p className="mt-0.5 font-display text-2xl font-800 text-ink-900 nums-latin">{value.toLocaleString('ar')}</p></div></Card>;
}

function SummaryBox({ label, value }: { label: string; value: number }) {
  return <div className="rounded-xl bg-ink-50 p-4"><p className="text-sm text-ink-500">{label}</p><p className="mt-2 font-display text-2xl font-800 text-ink-900 nums-latin">{value.toLocaleString('ar')}</p></div>;
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
