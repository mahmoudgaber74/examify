import { useEffect, useState } from 'react';
import {
  ArrowLeft,
  BarChart3,
  BookOpenCheck,
  Building2,
  CheckCircle2,
  ChevronDown,
  ClipboardCheck,
  FileSpreadsheet,
  GraduationCap,
  LineChart,
  ShieldCheck,
  Sparkles,
  Users,
} from 'lucide-react';
import { trackMarketingEvent } from '../lib/marketing-analytics';

interface LandingPageProps {
  onStart: (signupType: 'institution' | 'existing') => void;
  onLogin: () => void;
}

const FEATURES = [
  { icon: ClipboardCheck, title: 'إنشاء امتحان في دقائق', text: 'كوّن امتحاناتك من بنك الأسئلة، حدد الدرجات والوقت، وانشرها للطلاب بسهولة.', action: 'ابدأ إنشاء امتحان', signupType: 'institution' as const },
  { icon: FileSpreadsheet, title: 'تصحيح البابل شيت وOMR', text: 'حوّل ورقة الإجابة إلى نتائج دقيقة مع مراجعة بشرية للحالات غير الواضحة.', action: 'جرّب التصحيح الذكي', signupType: 'institution' as const },
  { icon: LineChart, title: 'تقارير تفهمك النتيجة', text: 'اعرف مستوى كل طالب وفصل ومادة من خلال تقارير واضحة قابلة للتصدير.', action: 'استكشف التقارير', signupType: 'institution' as const },
  { icon: Sparkles, title: 'ذكاء اصطناعي يساعد المدرس', text: 'ولّد أسئلة، حلل نقاط الضعف، واستفد من أدوات تعليمية ذكية داخل نفس المنصة.', action: 'ابدأ كمدرس', signupType: 'existing' as const },
];

const HOW_IT_WORKS = [
  { number: '01', icon: ClipboardCheck, title: 'أنشئ امتحانك', text: 'اختَر المادة والأسئلة والدرجات والوقت، ثم جهّز الامتحان للنشر أو الطباعة.' },
  { number: '02', icon: FileSpreadsheet, title: 'اجمع الإجابات وصححها', text: 'استقبل إجابات الطلاب إلكترونيًا أو ارفع أوراق البابل شيت وراجع الحالات غير الواضحة.' },
  { number: '03', icon: LineChart, title: 'افهم النتيجة', text: 'راجع الدرجات وتقارير الأداء، واستخدم البيانات لاتخاذ خطوة تعليمية أوضح.' },
];

const PLANS = [
  { name: 'تجربة مجانية', description: 'للبداية واختبار المنصة', price: '0', availability: 'متاح الآن', cta: 'ابدأ الآن', signupType: 'institution' as const, tone: 'border-ink-100 bg-white', features: ['إنشاء الامتحانات', 'بنك أسئلة أساسي', 'تقارير النتائج', 'دعم البداية'] },
  { name: 'للمدرس', description: 'للمدرسين أصحاب المجموعات', price: 'قريبًا', availability: 'قريبًا', cta: 'سجل اهتمامك', signupType: 'existing' as const, tone: 'border-brand-200 bg-brand-50', features: ['كل أدوات المدرس', 'تصحيح OMR والبابل شيت', 'تحليلات أداء الطلاب', 'تصدير PDF وExcel'] },
  { name: 'للمؤسسة', description: 'للمدارس والفرق التعليمية', price: 'تواصل معنا', availability: 'حل مخصص', cta: 'اطلب عرضًا', signupType: 'institution' as const, tone: 'border-ink-950 bg-ink-950 text-white', features: ['إدارة المدرسين والطلاب', 'فروع وفصول متعددة', 'صلاحيات وإدارة مركزية', 'تقارير مؤسسية متقدمة'] },
];

const FAQS = [
  { question: 'هل أستطيع تجربة إكزاميفاي قبل الاشتراك؟', answer: 'نعم، يمكنك إنشاء حساب مؤسسة والبدء بفترة تجريبية مجانية قبل اختيار الخطة المناسبة.' },
  { question: 'هل يدعم البرنامج تصحيح البابل شيت؟', answer: 'نعم، يمكنك إنشاء نموذج ورقة الإجابة، تصوير الأوراق أو رفعها، ثم الحصول على التصحيح والنتائج مع إمكانية المراجعة البشرية.' },
  { question: 'هل يمكن للمدرس استخدام البرنامج بدون مؤسسة؟', answer: 'نعم، يمكن للمدرس التسجيل والانضمام إلى مؤسسة موجودة، أو التواصل معنا لتفعيل مساحة مناسبة لطريقة عمله.' },
  { question: 'هل بيانات الطلاب والمؤسسة آمنة؟', answer: 'نحن نفصل بيانات كل مؤسسة عن الأخرى ونقيد الوصول حسب الصلاحيات. كما أن بيانات التسويق مجهولة ولا تتضمن أسماء أو إيميلات الزوار.' },
];

export function LandingPage({ onStart, onLogin }: LandingPageProps) {
  const [openFaq, setOpenFaq] = useState(0);
  useEffect(() => {
    trackMarketingEvent('page_view', { page: 'landing', audience: 'public' });
  }, []);

  function start(signupType: 'institution' | 'existing') {
    trackMarketingEvent('cta_click', { page: 'landing', cta: signupType === 'institution' ? 'institution_signup' : 'teacher_signup' });
    onStart(signupType);
  }

  return (
    <div className="sales-landing min-h-screen overflow-hidden bg-ink-50 text-ink-900" dir="rtl">
      <header className="sticky top-0 z-20 border-b border-ink-100/80 bg-white/90 backdrop-blur-xl">
          <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-4 lg:px-8">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-600 text-white shadow-soft">
              <GraduationCap size={23} />
            </div>
            <div>
              <p className="font-display text-lg font-800 text-ink-950">إكزاميفاي AI</p>
              <p className="text-[11px] text-ink-400">منصة الامتحانات الذكية</p>
            </div>
          </div>
          <div className="flex items-center gap-2 sm:gap-5">
            <nav className="hidden items-center gap-5 text-sm text-ink-500 lg:flex" aria-label="روابط الصفحة"><a href="#features" className="hover:text-brand-600">المميزات</a><a href="#how-it-works" className="hover:text-brand-600">كيف تعمل</a><a href="#pricing" className="hover:text-brand-600">الأسعار</a><a href="#faq" className="hover:text-brand-600">الأسئلة الشائعة</a></nav>
            <button type="button" onClick={() => { trackMarketingEvent('cta_click', { page: 'landing', cta: 'login' }); onLogin(); }} className="btn-outline min-h-9 px-3 text-xs sm:px-4 sm:text-sm">تسجيل الدخول</button>
          </div>
        </div>
      </header>

      <main>
        <section className="relative isolate">
          <div className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_15%_15%,rgba(37,99,235,0.16),transparent_34%),radial-gradient(circle_at_85%_20%,rgba(20,184,166,0.13),transparent_30%)]" />
          <div className="mx-auto grid max-w-7xl items-center gap-12 px-5 pb-20 pt-16 lg:grid-cols-[1.1fr_0.9fr] lg:px-8 lg:pb-28 lg:pt-24">
            <div>
              <h1 className="max-w-3xl font-display text-4xl font-800 leading-[1.2] tracking-tight text-ink-950 sm:text-5xl lg:text-6xl">
                خلّي وقتك للشرح،<span className="text-brand-600"> وإكزاميفاي يتولى التقييم</span>
              </h1>
              <p className="mt-6 max-w-2xl text-lg leading-9 text-ink-600 sm:text-xl">
                منصة عربية للمدرسين والمدارس لإنشاء الامتحانات، تصحيح البابل شيت، متابعة أداء الطلاب، وإصدار تقارير احترافية بدون جداول مرهقة.
              </p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <button type="button" onClick={() => start('institution')} className="btn-primary min-h-12 px-6 text-base">
                  <Building2 size={19} /> ابدأ مؤسستك مجانًا <ArrowLeft size={18} />
                </button>
                <button type="button" onClick={() => start('existing')} className="btn-outline min-h-12 px-6 text-base">
                  <GraduationCap size={19} /> أنا مدرس
                </button>
              </div>
              <div className="mt-7 flex flex-wrap gap-x-5 gap-y-2 text-sm text-ink-500">
                <span className="inline-flex items-center gap-1.5"><CheckCircle2 size={16} className="text-accent-600" /> تجربة مجانية</span>
                <span className="inline-flex items-center gap-1.5"><CheckCircle2 size={16} className="text-accent-600" /> إعداد سريع</span>
                <span className="inline-flex items-center gap-1.5"><CheckCircle2 size={16} className="text-accent-600" /> تقارير قابلة للتصدير</span>
              </div>
            </div>

            <div className="relative mx-auto w-full max-w-lg">
              <div className="absolute -inset-5 rounded-[2.5rem] bg-brand-500/10 blur-2xl" />
              <div className="relative rounded-[2rem] border border-white/70 bg-white/45 p-4 shadow-2xl shadow-brand-900/10 backdrop-blur-xl sm:p-6">
                <div className="flex items-center justify-between border-b border-ink-100 pb-4">
                  <div>
                    <p className="text-xs text-ink-400">لوحة المؤسسة</p>
                    <p className="mt-1 font-display text-lg font-800">نظرة سريعة على الأداء</p>
                  </div>
                  <div className="rounded-xl bg-accent-50 p-2.5 text-accent-600"><BarChart3 size={22} /></div>
                </div>
                <div className="mt-5 grid grid-cols-2 gap-3">
                  <div className="rounded-2xl border border-white/60 bg-brand-50/70 p-4 backdrop-blur-md"><p className="text-xs text-brand-700">الامتحانات</p><p className="mt-2 text-2xl font-800 text-brand-900"><AnimatedNumber value={24} /></p><p className="mt-1 text-xs text-brand-600">هذا الشهر</p></div>
                  <div className="rounded-2xl border border-white/60 bg-accent-50/70 p-4 backdrop-blur-md"><p className="text-xs text-accent-700">متوسط النجاح</p><p className="mt-2 text-2xl font-800 text-accent-900"><AnimatedNumber value={86} suffix="%" /></p><p className="mt-1 text-xs text-accent-600"><AnimatedNumber value={12} prefix="+" suffix="%" /> عن الشهر السابق</p></div>
                </div>
                <div className="mt-4 rounded-2xl border border-white/70 bg-white/35 p-4 backdrop-blur-md">
                  <div className="mb-4 flex items-center justify-between"><p className="font-700">أداء الفصول</p><LineChart size={18} className="text-brand-600" /></div>
                  <div className="space-y-3">
                    {[{ label: 'الصف الثالث', value: 92 }, { label: 'الصف الرابع', value: 84 }, { label: 'الصف الخامس', value: 78 }].map(({ label, value }) => (
                      <div key={label}>
                        <div className="mb-1 flex justify-between text-xs text-ink-500"><span>{label}</span><span><AnimatedNumber value={value} suffix="%" /></span></div>
                        <AnimatedProgress value={value} />
                      </div>
                    ))}
                  </div>
                </div>
                <div className="mt-4 flex items-center gap-3 rounded-2xl border border-white/60 bg-white/45 p-3 text-sm text-ink-600 backdrop-blur-md"><ShieldCheck size={19} className="text-accent-600" /> بيانات مؤسستك معزولة وآمنة</div>
              </div>
            </div>
          </div>
        </section>

        <section className="border-y border-ink-100 bg-white py-5">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-center gap-x-10 gap-y-3 px-5 text-sm text-ink-500 lg:justify-between lg:px-8">
            <span className="font-700 text-ink-700">كل دورة التقييم في مكان واحد</span>
            <span className="inline-flex items-center gap-2"><CheckCircle2 size={16} className="text-accent-600" /> صلاحيات واضحة لكل دور</span>
            <span className="inline-flex items-center gap-2"><CheckCircle2 size={16} className="text-accent-600" /> إلكتروني أو بابل شيت</span>
            <span className="inline-flex items-center gap-2"><CheckCircle2 size={16} className="text-accent-600" /> تقارير قابلة للتصدير</span>
          </div>
        </section>

        <section id="features" className="border-y border-ink-100 bg-white py-16 sm:py-20">
          <div className="mx-auto max-w-7xl px-5 lg:px-8">
            <div className="max-w-2xl"><p className="text-sm font-800 text-brand-600">كل أدوات التقييم التي تحتاجها</p><h2 className="mt-3 font-display text-3xl font-800 sm:text-4xl">من أول سؤال لآخر تقرير</h2><p className="mt-4 leading-8 text-ink-500">إكزاميفاي يجمع دورة التقييم كاملة في تجربة واحدة واضحة للمدرس والإدارة والطالب.</p></div>
            <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {FEATURES.map(({ icon: Icon, title, text, action, signupType }) => <article key={title} className="group flex h-full flex-col rounded-2xl border border-ink-100 bg-ink-50/60 p-5 shadow-sm transition-all duration-300 hover:-translate-y-1.5 hover:border-brand-200 hover:bg-white hover:shadow-xl hover:shadow-brand-900/10"><div className="mb-5 flex h-11 w-11 items-center justify-center rounded-xl bg-brand-100 text-brand-700 transition-transform duration-300 group-hover:scale-110 group-hover:rotate-3"><Icon size={22} /></div><h3 className="font-display text-lg font-800">{title}</h3><p className="mt-3 flex-1 text-sm leading-7 text-ink-500">{text}</p><button type="button" onClick={() => start(signupType)} className="mt-5 inline-flex items-center gap-2 self-start text-sm font-800 text-brand-600 transition-colors hover:text-brand-800">{action}<ArrowLeft size={16} className="transition-transform group-hover:-translate-x-1" /></button></article>)}
            </div>
          </div>
        </section>

        <section id="how-it-works" className="mx-auto max-w-7xl px-5 py-16 sm:py-20 lg:px-8">
          <div className="max-w-2xl"><p className="text-sm font-800 text-brand-600">من أول سؤال لآخر تقرير</p><h2 className="mt-3 font-display text-3xl font-800 sm:text-4xl">طريقة شغل بسيطة وواضحة</h2><p className="mt-4 leading-8 text-ink-500">بدل التنقل بين أدوات كثيرة، خلّي إنشاء الامتحان والتصحيح وتحليل النتائج في مسار واحد.</p></div>
          <div className="mt-10 grid gap-4 md:grid-cols-3">
            {HOW_IT_WORKS.map(({ number, icon: Icon, title, text }) => <article key={number} className="group relative rounded-3xl border border-ink-100 bg-white p-6 shadow-sm transition-all duration-300 hover:-translate-y-1 hover:border-brand-200 hover:shadow-xl hover:shadow-brand-900/10"><div className="flex items-center justify-between"><div className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-50 text-brand-600 transition-transform duration-300 group-hover:scale-110"><Icon size={22} /></div><span className="font-display text-3xl font-800 text-brand-100 nums-latin">{number}</span></div><h3 className="mt-6 font-display text-xl font-800">{title}</h3><p className="mt-3 text-sm leading-7 text-ink-500">{text}</p></article>)}
          </div>
        </section>

        <section id="pricing" className="mx-auto max-w-7xl px-5 py-16 sm:py-20 lg:px-8">
          <div className="max-w-2xl"><p className="text-sm font-800 text-brand-600">خطط تناسب طريقة شغلك</p><h2 className="mt-3 font-display text-3xl font-800 sm:text-4xl">ابدأ بدون مخاطرة</h2><p className="mt-4 leading-8 text-ink-500">ابدأ مجانًا، ثم اختر الخطة المناسبة عندما تكبر احتياجاتك.</p></div>
          <div className="mt-10 grid gap-4 lg:grid-cols-3">
            {PLANS.map((plan, index) => <article key={plan.name} className={`group relative flex h-full flex-col rounded-3xl border p-6 shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-xl sm:p-8 ${plan.tone}`}>
              {index === 1 && <span className="absolute -top-3 right-6 rounded-full bg-brand-600 px-3 py-1 text-xs font-800 text-white">الأكثر طلبًا</span>}
              <div className="flex items-start justify-between gap-3"><div><h3 className="font-display text-xl font-800">{plan.name}</h3><p className={`mt-2 text-sm ${index === 2 ? 'text-ink-300' : 'text-ink-500'}`}>{plan.description}</p></div><span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-700 ${index === 2 ? 'bg-white/10 text-brand-200' : index === 1 ? 'bg-brand-100 text-brand-700' : 'bg-accent-50 text-accent-700'}`}>{plan.availability}</span></div>
              <p className="mt-6 font-display text-3xl font-800">{plan.price}{plan.price === '0' && <span className="mr-1 text-sm font-500">جنيه</span>}</p>
              <ul className={`mt-6 flex-1 space-y-3 text-sm ${index === 2 ? 'text-ink-200' : 'text-ink-600'}`}>{plan.features.map((feature) => <li key={feature} className="flex items-center gap-2"><CheckCircle2 size={16} className={index === 2 ? 'text-brand-300' : 'text-accent-600'} />{feature}</li>)}</ul>
              <button type="button" onClick={() => start(plan.signupType)} className={index === 2 ? 'btn mt-8 w-full bg-white text-ink-950 hover:bg-brand-50' : index === 1 ? 'btn-primary mt-8 w-full' : 'btn-outline mt-8 w-full'}>{plan.cta} <ArrowLeft size={16} /></button>
            </article>)}
          </div>
        </section>

        <section className="mx-auto grid max-w-7xl gap-6 px-5 py-16 sm:py-20 lg:grid-cols-2 lg:px-8">
          <article className="rounded-3xl bg-ink-950 p-7 text-white sm:p-10"><div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/10 text-brand-300"><Building2 size={24} /></div><h2 className="mt-6 font-display text-2xl font-800">للمدارس والمؤسسات</h2><p className="mt-3 leading-8 text-ink-300">أنشئ مساحة مؤسستك، أضف المدرسين والطلاب، ووحّد الامتحانات والنتائج والتقارير تحت إدارة واحدة.</p><button type="button" onClick={() => start('institution')} className="btn mt-7 bg-white text-ink-950 hover:bg-brand-50">إنشاء مؤسسة <ArrowLeft size={17} /></button></article>
          <article className="rounded-3xl border border-brand-100 bg-brand-50 p-7 sm:p-10"><div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-brand-600 shadow-sm"><GraduationCap size={24} /></div><h2 className="mt-6 font-display text-2xl font-800 text-ink-950">للمدرسين</h2><p className="mt-3 leading-8 text-ink-600">أنشئ امتحاناتك، صحح أوراق الإجابة، واكتشف مستوى طلابك من غير ما تغيّر طريقة شغلك.</p><button type="button" onClick={() => start('existing')} className="btn-primary mt-7">ابدأ كمدرس <ArrowLeft size={17} /></button></article>
        </section>

        <section className="border-t border-ink-100 bg-white py-16 sm:py-20">
          <div className="mx-auto max-w-5xl px-5 text-center lg:px-8"><p className="text-sm font-800 text-brand-600">بداية بسيطة</p><h2 className="mt-3 font-display text-3xl font-800 sm:text-4xl">جاهز تبني امتحانك الأول؟</h2><p className="mx-auto mt-4 max-w-2xl leading-8 text-ink-500">ابدأ بتجربة مجانية، واكتشف كيف يمكن لفريقك توفير وقت التصحيح وتحويل النتائج إلى قرارات تعليمية.</p><button type="button" onClick={() => start('institution')} className="btn-primary mt-7 min-h-12 px-7 text-base"><Users size={19} /> ابدأ الآن مجانًا</button></div>
        </section>

        <section id="faq" className="mx-auto max-w-4xl px-5 py-16 sm:py-20 lg:px-8">
          <div className="text-center"><p className="text-sm font-800 text-brand-600">أسئلة قبل البداية</p><h2 className="mt-3 font-display text-3xl font-800 sm:text-4xl">كل ما تحتاج معرفته</h2></div>
          <div className="mt-10 space-y-3">{FAQS.map((faq, index) => <div key={faq.question} className="overflow-hidden rounded-2xl border border-ink-100 bg-white"><button type="button" onClick={() => setOpenFaq(openFaq === index ? -1 : index)} className="flex w-full items-center justify-between gap-4 px-5 py-4 text-right font-700"><span>{faq.question}</span><ChevronDown size={18} className={`shrink-0 text-brand-600 transition-transform ${openFaq === index ? 'rotate-180' : ''}`} /></button>{openFaq === index && <p className="border-t border-ink-100 px-5 py-4 text-sm leading-7 text-ink-500">{faq.answer}</p>}</div>)}</div>
        </section>
      </main>

      <footer className="border-t border-ink-100 bg-ink-50 py-7"><div className="mx-auto flex max-w-7xl flex-col gap-2 px-5 text-sm text-ink-500 sm:flex-row sm:items-center sm:justify-between lg:px-8"><span>© 2026 إكزاميفاي AI</span><span className="inline-flex items-center gap-1.5"><BookOpenCheck size={16} /> تعليم أذكى، قرارات أوضح</span></div></footer>
    </div>
  );
}

function AnimatedNumber({ value, prefix = '', suffix = '', duration = 1100 }: { value: number; prefix?: string; suffix?: string; duration?: number }) {
  const [displayValue, setDisplayValue] = useState(0);

  useEffect(() => {
    let frame = 0;
    const startedAt = performance.now();
    const animate = (now: number) => {
      const progress = Math.min((now - startedAt) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplayValue(Math.round(value * eased));
      if (progress < 1) frame = requestAnimationFrame(animate);
    };
    frame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frame);
  }, [duration, value]);

  return <span className="nums-latin">{prefix}{displayValue.toLocaleString('en-US')}{suffix}</span>;
}

function AnimatedProgress({ value }: { value: number }) {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const frame = requestAnimationFrame(() => setProgress(value));
    return () => cancelAnimationFrame(frame);
  }, [value]);

  return <div className="h-2 overflow-hidden rounded-full bg-ink-100"><div className="h-full rounded-full bg-brand-500 transition-[width] duration-1000 ease-out" style={{ width: `${progress}%` }} /></div>;
}
