import { useState } from 'react';
import { Card, Badge, SectionHeader, ProgressBar } from '../components/ui';
import {
  Sigma, PenLine, CheckCircle2, XCircle, Lightbulb, Camera,
  FunctionSquare, LineChart, Calculator, Type, RotateCw, Loader2,
} from 'lucide-react';

const TOPICS = ['الجبر', 'التفاضل والتكامل', 'الهندسة', 'الإحصاء', 'الجبر الخطي', 'الرياضيات المتقطّعة'];

const STEPS = [
  { label: 'تحديد تقنية التكامل', correct: true, detail: 'جداء x و e^x → التكامل بالأجزاء' },
  { label: 'تطبيق قاعدة LIATE', correct: true, detail: 'u = x (جبري)، dv = e^x dx (أسي)' },
  { label: 'حساب du و v', correct: true, detail: 'du = dx، v = e^x' },
  { label: 'تطبيق الصيغة ∫u dv = uv − ∫v du', correct: true, detail: 'x·e^x − ∫e^x dx' },
  { label: 'تقييم التكامل المتبقّي', correct: false, detail: 'كتب الطالب +C لكنه أغفل الحد −e^x' },
  { label: 'الإجابة النهائية', correct: false, detail: 'المتوقّع: x·e^x − e^x + C · الطالب: x·e^x + C' },
];

export function MathEngine() {
  const [topic, setTopic] = useState('التفاضل والتكامل');
  const [stepStates, setStepStates] = useState<boolean[]>(STEPS.map((s) => s.correct));
  const [verifying, setVerifying] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const toggleStep = (idx: number) => {
    setStepStates((prev) => prev.map((s, i) => i === idx ? !s : s));
  };

  const verify = () => {
    setVerifying(true);
    setTimeout(() => {
      setVerifying(false);
      const correctCount = stepStates.filter(Boolean).length;
      setToast(`التحقق اكتمل: ${correctCount}/${STEPS.length} خطوات صحيحة — الدرجة ${Math.round((correctCount / STEPS.length) * 100)}%`);
      setTimeout(() => setToast(null), 3000);
    }, 1500);
  };

  const reset = () => {
    setStepStates(STEPS.map((s) => s.correct));
    setToast(null);
  };

  const correctCount = stepStates.filter(Boolean).length;
  const score = Math.round((correctCount / STEPS.length) * 100);

  return (
    <div className="space-y-6">
      {toast && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-4 py-2.5 rounded-xl bg-brand-600 text-white shadow-pop animate-fade-in">
          <CheckCircle2 size={16} /> <span className="text-sm font-600">{toast}</span>
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'الموارد المدعومة', value: '6', icon: Sigma, tone: 'text-brand-600 bg-brand-50' },
          { label: 'دقّة التعرّف على الخط', value: '97.2%', icon: PenLine, tone: 'text-accent-600 bg-accent-50' },
          { label: 'التحقق من الخطوات', value: 'لحظي', icon: CheckCircle2, tone: 'text-gold-600 bg-gold-500/10' },
          { label: 'علامات جزئية ممنوحة', value: '84%', icon: Calculator, tone: 'text-brand-600 bg-brand-50' },
        ].map((s) => (
          <Card key={s.label} className="p-4 flex items-center gap-3">
            <div className={`grid place-items-center w-10 h-10 rounded-xl ${s.tone}`}><s.icon size={20} /></div>
            <div><p className="text-xs text-ink-500">{s.label}</p><p className="font-display font-700 text-ink-900 text-lg nums-latin">{s.value}</p></div>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2 space-y-4">
          <Card className="p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <FunctionSquare size={18} className="text-brand-600" />
                <h3 className="font-display font-700 text-ink-900">المسألة</h3>
              </div>
              <Badge tone="brand">{topic}</Badge>
            </div>
            <div className="rounded-xl bg-ink-50 p-6 text-center">
              <p className="font-mono text-2xl text-ink-900 nums-latin">∫ x² · e^x dx</p>
              <p className="text-sm text-ink-500 mt-2">احسب باستخدام التكامل بالأجزاء. أظهر جميع الخطوات.</p>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <button className="btn-outline"><Camera size={16} /> مسح العمل المكتوب</button>
              <button className="btn-outline"><Type size={16} /> كتابة الحل</button>
            </div>
          </Card>

          <Card className="p-6">
            <SectionHeader title="التحقق خطوة بخطوة" subtitle="وكيل حلّال الرياضيات · علامات جزئية مفعّلة" action={<CheckCircle2 size={18} className="text-accent-600" />} />
            <div className="space-y-2">
              {STEPS.map((step, i) => {
                const isCorrect = stepStates[i];
                return (
                  <button key={i} onClick={() => toggleStep(i)} className={`w-full text-right flex gap-3 p-3 rounded-xl border transition ${isCorrect ? 'border-accent-100 bg-accent-50/40' : 'border-danger-100 bg-danger-50/40'}`}>
                    <div className={`grid place-items-center w-7 h-7 rounded-full shrink-0 ${isCorrect ? 'bg-accent-100 text-accent-700' : 'bg-danger-100 text-danger-700'}`}>
                      {isCorrect ? <CheckCircle2 size={15} /> : <XCircle size={15} />}
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-600 text-ink-900 nums-latin">خطوة {i + 1}: {step.label}</p>
                      <p className="text-xs text-ink-500 mt-0.5">{step.detail}</p>
                    </div>
                    <Badge tone={isCorrect ? 'accent' : 'danger'}>{isCorrect ? '+1' : '+0'}</Badge>
                  </button>
                );
              })}
            </div>
            <div className="mt-4 p-4 rounded-xl bg-ink-50 flex items-center justify-between">
              <div>
                <p className="text-xs text-ink-500">الدرجة الحالية</p>
                <p className="font-display text-2xl font-800 text-ink-900 nums-latin">{correctCount}/{STEPS.length} <span className="text-base text-ink-400 font-600">({score}%)</span></p>
              </div>
              <div className="flex gap-2">
                <button onClick={verify} disabled={verifying} className="btn-primary disabled:opacity-60">
                  {verifying ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />} تحقق
                </button>
                <button onClick={reset} className="btn-outline"><RotateCw size={16} /> إعادة</button>
              </div>
            </div>
          </Card>
        </div>

        <div className="space-y-6">
          <Card className="p-5">
            <SectionHeader title="موارد الرياضيات" />
            <div className="space-y-1.5">
              {TOPICS.map((t) => (
                <button key={t} onClick={() => setTopic(t)} className={`w-full flex items-center justify-between p-2.5 rounded-lg text-sm font-600 transition ${topic === t ? 'bg-brand-50 text-brand-700' : 'text-ink-600 hover:bg-ink-50'}`}>
                  <span className="flex items-center gap-2"><Sigma size={15} /> {t}</span>
                  <span className="text-[11px] text-ink-400 nums-latin">{Math.floor(Math.random() * 400 + 100)} مسألة</span>
                </button>
              ))}
            </div>
          </Card>

          <Card className="p-5">
            <SectionHeader title="القدرات" />
            <div className="space-y-2.5">
              {[
                { label: 'التعرّف على الخط', icon: PenLine, pct: 97 },
                { label: 'التحقق من الخطوات', icon: CheckCircle2, pct: 99 },
                { label: 'العلامات الجزئية', icon: Calculator, pct: 84 },
                { label: 'فهم الصيغ', icon: FunctionSquare, pct: 96 },
                { label: 'التعرّف على الرسوم', icon: LineChart, pct: 91 },
                { label: 'كشف الأخطاء', icon: Lightbulb, pct: 94 },
              ].map((c) => (
                <div key={c.label}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="flex items-center gap-2 text-sm text-ink-700"><c.icon size={14} className="text-ink-400" /> {c.label}</span>
                    <span className="text-xs font-600 text-ink-600 nums-latin">{c.pct}%</span>
                  </div>
                  <ProgressBar value={c.pct} tone="brand" />
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
