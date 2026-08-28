import { useState } from 'react';
import { CODE_SUBMISSIONS, SAMPLE_CODE, type CodeSubmission } from '../lib/data';
import { Card, Badge, SectionHeader, ProgressBar } from '../components/ui';
import {
  Code2, Play, Terminal, Shield, Cpu, Gauge, Copy, Check, AlertCircle,
  FileWarning, Clock, MemoryStick, Lock, Loader2,
} from 'lucide-react';

const LANG_COLORS: Record<string, string> = {
  Python: 'bg-accent-600', Java: 'bg-danger-500', TypeScript: 'bg-brand-600',
  'C++': 'bg-ink-700', Go: 'bg-warning-500', Rust: 'bg-orange-500',
};

const STATUS_TONE: Record<CodeSubmission['status'], 'accent' | 'warning' | 'danger'> = {
  'ناجح': 'accent', 'جزئي': 'warning', 'فاشل': 'danger',
};

export function Programming() {
  const [selected, setSelected] = useState<CodeSubmission>(CODE_SUBMISSIONS[0]);
  const [copied, setCopied] = useState(false);
  const [running, setRunning] = useState(false);
  const [runResult, setRunResult] = useState<{ passed: number; total: number; output: string } | null>(null);

  const copy = () => {
    navigator.clipboard?.writeText(SAMPLE_CODE);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const runCode = () => {
    setRunning(true);
    setRunResult(null);
    setTimeout(() => {
      const passed = selected.testsPassed;
      const total = selected.testsTotal;
      setRunResult({
        passed,
        total,
        output: passed === total
          ? 'جميع الاختبارات نجحت.\n> تنفيذ: 38ms\n> ذاكرة: 14.2MB\n> حالة: مقبول'
          : `${passed}/${total} اختبارات نجحت.\n> فشل في الاختبار ${passed + 1}: خطأ تأكيد\n> المتوقّع: [1,2,3,1]\n> الفعلي: [1,2,3]`,
      });
      setRunning(false);
    }, 1500);
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {[
          { label: 'اللغات', value: '9', icon: Code2 },
          { label: 'البيئة المعزولة', value: 'Docker', icon: Lock },
          { label: 'اختبارات (30 يوم)', value: '2.4M', icon: Play },
          { label: 'انتحال مكتشف', value: '1,820', icon: FileWarning },
          { label: 'متوسط التشغيل', value: '42ms', icon: Gauge },
        ].map((s) => (
          <Card key={s.label} className="p-4">
            <s.icon size={18} className="text-ink-400 mb-2" />
            <p className="text-xs text-ink-500">{s.label}</p>
            <p className="font-display font-700 text-ink-900 nums-latin">{s.value}</p>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-5 gap-6">
        <Card className="xl:col-span-2 p-0 overflow-hidden">
          <div className="p-5 border-b border-ink-100"><SectionHeader title="التسليمات" subtitle="نتائج التنفيذ في بيئة معزولة" /></div>
          <div className="divide-y divide-ink-50 max-h-[560px] overflow-y-auto">
            {CODE_SUBMISSIONS.map((sub) => (
              <button key={sub.id} onClick={() => { setSelected(sub); setRunResult(null); }} className={`w-full text-right p-4 hover:bg-ink-50 transition flex items-center gap-3 ${selected.id === sub.id ? 'bg-brand-50/60 border-r-2 border-brand-600' : ''}`}>
                <div className={`grid place-items-center w-9 h-9 rounded-lg text-white text-[10px] font-700 ${LANG_COLORS[sub.language]} nums-latin`}>{sub.language.slice(0, 2).toUpperCase()}</div>
                <div className="flex-1 min-w-0">
                  <p className="font-600 text-sm text-ink-900 truncate">{sub.student}</p>
                  <p className="text-xs text-ink-500 truncate">{sub.challenge}</p>
                </div>
                <div className="text-left shrink-0">
                  <Badge tone={STATUS_TONE[sub.status]}>{sub.status}</Badge>
                  <p className="text-[11px] text-ink-400 mt-1 nums-latin">{sub.testsPassed}/{sub.testsTotal} اختبار</p>
                </div>
              </button>
            ))}
          </div>
        </Card>

        <div className="xl:col-span-3 space-y-4">
          <Card className="overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2.5 bg-ink-950 text-ink-200">
              <div className="flex items-center gap-2">
                <span className={`px-2 py-0.5 rounded text-[10px] font-700 text-white ${LANG_COLORS[selected.language]} nums-latin`}>{selected.language}</span>
                <span className="text-sm font-600">{selected.challenge}</span>
              </div>
              <div className="flex items-center gap-1">
                <button onClick={copy} className="grid place-items-center w-7 h-7 rounded text-ink-400 hover:bg-white/10 transition" title="نسخ">
                  {copied ? <Check size={14} className="text-accent-400" /> : <Copy size={14} />}
                </button>
                <button onClick={runCode} disabled={running} className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-accent-600 text-white text-xs font-600 hover:bg-accent-700 transition disabled:opacity-60">
                  {running ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />} تشغيل
                </button>
              </div>
            </div>
            <div className="bg-ink-950 text-ink-100 p-4 overflow-x-auto font-mono text-[13px] leading-relaxed max-h-[320px] overflow-y-auto">
              <pre className="whitespace-pre"><code>{SAMPLE_CODE.split('\n').map((line, i) => (
                <div key={i} className="flex">
                  <span className="text-ink-600 select-none w-8 text-left pl-3 shrink-0 nums-latin">{i + 1}</span>
                  <span className={line.trim().startsWith('#') || line.trim().startsWith('"""') ? 'text-ink-500 italic' : line.includes('def ') ? 'text-brand-300' : ''}>{line || ' '}</span>
                </div>
              ))}</code></pre>
            </div>
            {runResult && (
              <div className="bg-ink-900 text-ink-100 p-4 font-mono text-xs border-t border-white/5 animate-fade-in">
                <div className="flex items-center gap-2 mb-2">
                  <Terminal size={14} className="text-accent-400" />
                  <span className="text-ink-400">المخرجات</span>
                  <Badge tone={runResult.passed === runResult.total ? 'accent' : 'warning'}>{runResult.passed}/{runResult.total} نجاح</Badge>
                </div>
                <pre className="whitespace-pre-wrap text-ink-300 nums-latin">{runResult.output}</pre>
              </div>
            )}
          </Card>

          <Card className="p-5">
            <SectionHeader title="نتائج الاختبارات" subtitle={`${selected.testsPassed}/${selected.testsTotal} ناجحة`} action={<Terminal size={18} className="text-ink-400" />} />
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
              {[
                { label: 'زمن التشغيل', value: selected.runtime, icon: Clock },
                { label: 'الذاكرة', value: selected.memory, icon: MemoryStick },
                { label: 'التعقيد', value: selected.complexity, icon: Cpu },
                { label: 'الانتحال', value: `${selected.plagiarism}%`, icon: Shield },
              ].map((m) => (
                <div key={m.label} className="rounded-xl bg-ink-50 p-3">
                  <m.icon size={15} className="text-ink-400 mb-1" />
                  <p className="text-[11px] text-ink-500">{m.label}</p>
                  <p className="font-display font-700 text-ink-900 text-sm nums-latin">{m.value}</p>
                </div>
              ))}
            </div>
            <div className="space-y-1.5">
              {Array.from({ length: selected.testsTotal }).map((_, i) => {
                const pass = i < selected.testsPassed;
                return (
                  <div key={i} className="flex items-center gap-2.5 p-2 rounded-lg hover:bg-ink-50">
                    {pass ? <Check size={15} className="text-accent-600" /> : <AlertCircle size={15} className="text-danger-500" />}
                    <span className="text-sm text-ink-700 flex-1">{pass ? `اختبار ${i + 1}: اختبار مخفي ناجح` : `اختبار ${i + 1}: فشل — خطأ تأكيد`}</span>
                    <span className={`text-xs font-600 nums-latin ${pass ? 'text-accent-600' : 'text-danger-600'}`}>{pass ? 'نجاح' : 'فشل'}</span>
                  </div>
                );
              })}
            </div>
          </Card>

          <Card className="p-5">
            <SectionHeader title="مراجعة الكود بالذكاء الاصطناعي" subtitle="تحليل ثابت وأمني وتعقيد" action={<Cpu size={18} className="text-brand-600" />} />
            <div className="space-y-3">
              {[
                { label: 'التحليل الثابت', score: 92, note: 'لا مشاكل حرجة. اقتراحان بسيطان للأسلوب.' },
                { label: 'التحليل الأمني', score: 98, note: 'لا ثغرات مكتشفة. تنفيذ آمن للخيوط.' },
                { label: 'تحليل التعقيد', score: 88, note: 'عمليات O(1) مؤكّدة. تنازع الأقفال مقبول.' },
                { label: 'كشف الانتحال', score: 96, note: `تشابه ${selected.plagiarism}% — ضمن النطاق المقبول.` },
              ].map((r) => (
                <div key={r.label} className="p-3 rounded-xl border border-ink-100">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-sm font-600 text-ink-800">{r.label}</span>
                    <span className="text-sm font-700 text-ink-900 nums-latin">{r.score}/100</span>
                  </div>
                  <ProgressBar value={r.score} tone={r.score > 90 ? 'accent' : 'brand'} className="mb-2" />
                  <p className="text-xs text-ink-500">{r.note}</p>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
