import { useState } from 'react';
import { Sidebar, MobileNav } from './components/Sidebar';
import { Topbar } from './components/Topbar';
import { PWAInstallPrompt } from './components/PWAInstall';
import { AuthProvider, useAuth } from './components/AuthProvider';
import { Auth } from './views/Auth';
import { bootstrapFirstAdmin } from './lib/auth';
import { type ViewId, NAV_ITEMS } from './lib/navigation';
import { Dashboard } from './views/Dashboard';
import { Assessment } from './views/Assessment';
import { Tutor } from './views/Tutor';
import { Grading } from './views/Grading';
import { Analytics } from './views/Analytics';
import { LMS } from './views/LMS';
import { Programming } from './views/Programming';
import { MathEngine } from './views/MathEngine';
import { Certification } from './views/Certification';
import { Marketplace } from './views/Marketplace';
import { SIS } from './views/SIS';
import { Parents } from './views/Parents';
import { Settings } from './views/Settings';
import { QuestionBank } from './views/QuestionBank';
import { ExamBuilder } from './views/ExamBuilder';
import { ExamRunner } from './views/ExamRunner';
import { ExamResults } from './views/ExamResults';
import { Institutions } from './views/Institutions';
import { AcademicSetup } from './views/AcademicSetup';
import { BubbleSheet } from './views/BubbleSheet';
import { OmrOperations } from './views/OmrOperations';
import { Reports } from './views/Reports';
import { AiEngine } from './views/AiEngine';
import { Loader2, ShieldCheck } from 'lucide-react';

const SUBTITLES: Record<ViewId, string> = {
  dashboard: 'ذكاء لحظي عبر جميع المؤسسات والفروع والمتعلمين',
  assessment: 'إنشاء وجدولة ومراقبة تقييمات مولّدة بالذكاء الاصطناعي على نطاق واسع',
  tutor: 'تعلّم وتدريب ذكي شخصي ومسارات تعلّم تكيّفية',
  grading: 'تصحيح ذكي بالذكاء الاصطناعي مع تقييم بالمعايير ومراجعة بشرية',
  lms: 'دروس ودروس مباشرة وتتبّع التقدّم',
  programming: 'تقييمات برمجية في بيئة معزولة مع تحليل ثابت وكشف الانتحال',
  math: 'تصحيح رياضي خطوة بخطوة مع التعرّف على الخط وتقييم جزئي',
  analytics: 'ذكاء أعمال تنفيذي وفرعي وإداري',
  certification: 'شهادات واعتمادات رقمية موثّقة بالبلوكشين',
  marketplace: 'شراء وبيع الدورات وبنوك الأسئلة وقوالب الامتحانات',
  sis: 'نظام معلومات الطلاب مع التنبؤ بالمخاطر والتفاعل',
  parents: 'تتبع تقدّم الأبناء وإشعارات فورية عبر واتساب',
  settings: 'المؤسسة والفروع والعلامة البيضاء والتهيئة الأمنية',
  questionbank: 'بنك الأسئلة — إنشاء وإدارة وتصنيف الأسئلة',
  exambuilder: 'منشئ الامتحانات — بناء وجدولة ونشر الامتحانات',
  examrunner: 'الامتحانات — أداء الامتحانات المتاحة',
  examresults: 'النتائج — متابعة الدرجات والتحليل',
  institutions: 'إدارة المؤسسات والمدارس',
  academicsetup: 'إدارة الأعوام والمراحل والصفوف والفصول والمواد وتوزيع المعلمين',
  bubblesheet: 'إنشاء ومسح وتصحيح أوراق البابل شيت',
  omrops: 'مراقبة طوابير ومحاولات معالجة OMR',
  reports: 'تقارير وتحليلات محسوبة من بيانات الامتحانات',
  aiengine: 'ذكاء اصطناعي للتصحيح، توليد الأسئلة، اكتشاف الضعف، وخطط دراسية',
};

const ROLE_VIEWS: Record<string, ViewId[]> = {
  super_admin: ['dashboard', 'institutions', 'academicsetup', 'analytics', 'sis', 'assessment', 'questionbank', 'exambuilder', 'bubblesheet', 'omrops', 'aiengine', 'grading', 'examresults', 'reports', 'settings'],
  school_admin: ['dashboard', 'academicsetup', 'sis', 'assessment', 'questionbank', 'exambuilder', 'bubblesheet', 'omrops', 'aiengine', 'grading', 'examresults', 'reports', 'analytics', 'parents', 'settings'],
  teacher: ['dashboard', 'questionbank', 'exambuilder', 'bubblesheet', 'omrops', 'aiengine', 'grading', 'examresults', 'reports', 'sis'],
  grader: ['dashboard', 'bubblesheet', 'omrops', 'aiengine', 'grading', 'examresults', 'reports'],
  data_entry: ['dashboard', 'sis'],
  student: ['dashboard', 'examrunner', 'examresults'],
  parent: ['dashboard', 'parents'],
};

function getAccessibleViews(role: string): ViewId[] {
  return ROLE_VIEWS[role] ?? ['dashboard'];
}

function requestedViewFromUrl(): ViewId {
  if (typeof window === 'undefined') return 'dashboard';
  const requested = new URLSearchParams(window.location.search).get('view');
  return NAV_ITEMS.some((item) => item.id === requested) ? requested as ViewId : 'dashboard';
}

function AppContent() {
  const { user, role, loading, isActive, signOut } = useAuth();
  const [view, setViewState] = useState<ViewId>(() => requestedViewFromUrl());
  const [collapsed, setCollapsed] = useState(false);
  const [bootstrapLoading, setBootstrapLoading] = useState(false);
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);

  async function handleBootstrap() {
    setBootstrapLoading(true);
    setBootstrapError(null);
    const { error } = await bootstrapFirstAdmin();
    if (error) {
      setBootstrapError(error.message === 'bootstrap_already_completed'
        ? 'تم إعداد مدير النظام بالفعل. استخدم حساب المدير لتفعيل هذا الحساب.'
        : error.message);
      setBootstrapLoading(false);
      return;
    }
    window.location.reload();
  }

  function setView(next: ViewId) {
    setViewState(next);
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      url.searchParams.set('view', next);
      window.history.replaceState(null, '', url);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-ink-50">
        <Loader2 size={32} className="animate-spin text-brand-600" />
      </div>
    );
  }

  if (!user) {
    return <Auth />;
  }

  if (!isActive && role !== 'super_admin') {
    return (
      <div className="flex items-center justify-center h-screen bg-ink-50 p-4">
        <div className="card p-8 max-w-md text-center">
          <div className="w-16 h-16 rounded-full bg-warning-50 text-warning-600 flex items-center justify-center mx-auto mb-4">
            <Loader2 size={32} className="animate-pulse" />
          </div>
          <h2 className="font-display text-xl font-700 text-ink-900 mb-2">حسابك قيد المراجعة</h2>
          <p className="text-sm text-ink-500">سيتم تفعيل حسابك من مدير المؤسسة. ستصلك إشعار عند التفعيل.</p>
          <button type="button" onClick={handleBootstrap} disabled={bootstrapLoading} className="btn-primary mt-5 w-full justify-center disabled:opacity-60">
            {bootstrapLoading ? <Loader2 size={17} className="animate-spin" /> : <ShieldCheck size={17} />}
            تفعيل أول مدير للنظام
          </button>
          <button type="button" onClick={() => void signOut()} className="btn-outline mt-3 w-full justify-center">
            العودة لتسجيل الدخول بحساب آخر
          </button>
          {bootstrapError && <p className="text-sm text-danger-600 mt-3">{bootstrapError}</p>}
        </div>
      </div>
    );
  }

  const accessibleViews = getAccessibleViews(role);
  const safeView = accessibleViews.includes(view) ? view : 'dashboard';
  const activeItem = NAV_ITEMS.find((n) => n.id === safeView);

  return (
    <div className="flex h-screen overflow-hidden bg-ink-50">
      <Sidebar active={safeView} onSelect={setView} collapsed={collapsed} onToggleCollapse={() => setCollapsed(!collapsed)} accessibleViews={accessibleViews} />
      <div className="flex-1 flex flex-col min-w-0">
        <MobileNav active={safeView} onSelect={setView} accessibleViews={accessibleViews} />
        <Topbar title={activeItem?.label ?? 'إكزاميفاي AI'} subtitle={SUBTITLES[safeView]} onNavigate={setView} accessibleViews={accessibleViews} onCreateExam={() => setView('exambuilder')} />
        <main className="flex-1 overflow-y-auto">
          <div key={safeView} className="animate-fade-in p-5 lg:p-8 max-w-[1600px] mx-auto">
            {safeView === 'dashboard' && <Dashboard onNavigate={setView} />}
            {safeView === 'assessment' && <Assessment />}
            {safeView === 'tutor' && <Tutor />}
            {safeView === 'grading' && <Grading />}
            {safeView === 'analytics' && <Analytics />}
            {safeView === 'lms' && <LMS />}
            {safeView === 'programming' && <Programming />}
            {safeView === 'math' && <MathEngine />}
            {safeView === 'certification' && <Certification />}
            {safeView === 'marketplace' && <Marketplace />}
            {safeView === 'sis' && <SIS />}
            {safeView === 'parents' && <Parents />}
            {safeView === 'settings' && <Settings />}
            {safeView === 'questionbank' && <QuestionBank />}
            {safeView === 'exambuilder' && <ExamBuilder />}
            {safeView === 'examrunner' && <ExamRunner />}
            {safeView === 'examresults' && <ExamResults />}
            {safeView === 'bubblesheet' && <BubbleSheet />}
            {safeView === 'omrops' && <OmrOperations />}
            {safeView === 'reports' && <Reports />}
            {safeView === 'aiengine' && <AiEngine />}
            {safeView === 'institutions' && <Institutions />}
            {safeView === 'academicsetup' && <AcademicSetup />}
          </div>
        </main>
      </div>
      <PWAInstallPrompt />
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}
