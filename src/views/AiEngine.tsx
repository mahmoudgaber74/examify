import { useState, useCallback, useEffect } from 'react';
import { ScanLine, Brain, Sparkles, TrendingDown, Map as MapIcon, Loader2, AlertCircle, Upload, Download, RefreshCw, Check, Plus, Eye } from 'lucide-react';
import { Card, SectionHeader, Badge, EmptyState, ProgressBar } from '../components/ui';
import { supabase, useAuthSafe } from '../lib/auth-helpers';
import { extractTextWithProgress } from '../lib/ocr-engine';
import { detectWeakTopics, saveWeakTopics, generateStudyPlan, type WeakTopic } from '../lib/weak-topics';

type Tab = 'ocr' | 'grading' | 'generator' | 'weak' | 'plans';
type AiResultState = {
  id: string;
  score: number;
  maxScore: number;
  feedback: string;
  confidence: number;
  needsReview: boolean;
  status: string;
  structured: any;
};

export function AiEngine() {
  const [tab, setTab] = useState<Tab>('ocr');

  return (
    <div className="space-y-5">
      <SectionHeader title="الذكاء الاصطناعي و OCR" subtitle="تصحيح ذكي، استخراج نصوص، توليد أسئلة، اكتشاف الضعف، وخطط دراسية" />

      <div className="flex gap-1 p-1 rounded-xl bg-ink-100 overflow-x-auto">
        <TabBtn tab="ocr" current={tab} onClick={setTab} icon={<ScanLine size={16} />} label="OCR" />
        <TabBtn tab="grading" current={tab} onClick={setTab} icon={<Brain size={16} />} label="تصحيح ذكي" />
        <TabBtn tab="generator" current={tab} onClick={setTab} icon={<Sparkles size={16} />} label="توليد أسئلة" />
        <TabBtn tab="weak" current={tab} onClick={setTab} icon={<TrendingDown size={16} />} label="نقاط الضعف" />
        <TabBtn tab="plans" current={tab} onClick={setTab} icon={<MapIcon size={16} />} label="خطط دراسية" />
      </div>

      {tab === 'ocr' && <OcrTab />}
      {tab === 'grading' && <GradingTab />}
      {tab === 'generator' && <GeneratorTab />}
      {tab === 'weak' && <WeakTab />}
      {tab === 'plans' && <PlansTab />}
    </div>
  );
}

function TabBtn({ tab, current, onClick, icon, label }: { tab: Tab; current: Tab; onClick: (t: Tab) => void; icon: React.ReactNode; label: string }) {
  return (
    <button data-testid={`ai-tab-${tab}`} onClick={() => onClick(tab)} className={`flex-1 min-w-fit py-2.5 px-3 rounded-lg text-sm font-600 flex items-center justify-center gap-2 whitespace-nowrap ${current === tab ? 'bg-white shadow-sm' : 'text-ink-500'}`}>
      {icon} {label}
    </button>
  );
}

// ============ OCR Tab ============
function OcrTab() {
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<{ text: string; confidence: number } | null>(null);
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [language, setLanguage] = useState<'ara' | 'eng' | 'ara+eng'>('ara+eng');
  const [error, setError] = useState<string | null>(null);

  async function handleScan() {
    if (!file) return;
    setScanning(true);
    setError(null);
    setProgress(0);
    try {
      const res = await extractTextWithProgress(file, language, (p) => setProgress(Math.round(p * 100)));
      setResult({ text: res.text, confidence: res.confidence });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'حدث خطأ');
    } finally {
      setScanning(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card className="p-6 space-y-4">
        <h3 className="font-700 text-ink-900">استخراج النص من الصور (OCR)</h3>
        {error && <div className="flex items-center gap-2 p-3 rounded-xl bg-danger-50 border border-danger-200"><AlertCircle size={18} className="text-danger-600" /><p className="text-sm text-danger-700">{error}</p></div>}
        <div>
          <label className="label">لغة النص</label>
          <select className="input !w-auto" value={language} onChange={(e) => setLanguage(e.target.value as 'ara' | 'eng' | 'ara+eng')}>
            <option value="ara+eng">عربي + إنجليزي</option>
            <option value="ara">عربي فقط</option>
            <option value="eng">إنجليزي فقط</option>
          </select>
        </div>
        <div className="border-2 border-dashed border-ink-200 rounded-xl p-8 text-center hover:border-brand-400 transition cursor-pointer" onClick={() => document.getElementById('ocr-upload')?.click()}>
          {file ? (
            <div className="space-y-2">
              <img src={URL.createObjectURL(file)} alt="preview" className="max-h-48 mx-auto rounded-lg" />
              <p className="text-sm text-ink-600">{file.name}</p>
            </div>
          ) : (
            <div className="space-y-2"><Upload size={32} className="mx-auto text-ink-400" /><p className="text-sm text-ink-500">ارفع صورة الإجابة المكتوبة بخط اليد</p></div>
          )}
          <input id="ocr-upload" type="file" accept="image/*" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </div>
        {scanning && <div><ProgressBar value={progress} /><p className="text-xs text-ink-500 mt-1 text-center nums-latin">{progress}%</p></div>}
        <button onClick={handleScan} disabled={scanning || !file} className="btn-primary w-full disabled:opacity-40">
          {scanning ? <Loader2 size={18} className="animate-spin" /> : <ScanLine size={18} />}
          استخراج النص
        </button>
      </Card>

      {result && (
        <Card className="p-6">
          <div className="flex items-center justify-between mb-3">
            <h4 className="font-700 text-ink-900">النص المستخرج</h4>
            <Badge tone={result.confidence > 70 ? 'accent' : 'warning'}>الثقة: {Math.round(result.confidence)}%</Badge>
          </div>
          <div className="bg-ink-50 rounded-xl p-4 text-sm text-ink-800 whitespace-pre-wrap min-h-[100px]" dir="auto">
            {result.text || 'لم يتم استخراج نص'}
          </div>
          <button onClick={() => navigator.clipboard.writeText(result.text)} className="btn-outline mt-3"><Download size={16} /> نسخ النص</button>
        </Card>
      )}
    </div>
  );
}

// ============ AI Grading Tab ============
function mapAiResult(row: any): AiResultState {
  const structured = row.structured_result ?? {};
  const score = Number(row.final_score ?? row.ai_score ?? structured.awarded_points ?? 0);
  const maxScore = Number(row.ai_max_score ?? structured.max_points ?? 10);
  const confidence = Number(row.ai_confidence ?? structured.confidence ?? 0);
  const feedback = String(row.ai_feedback ?? structured.summary ?? '');
  const status = String(row.status ?? 'completed');
  const explicitReview = typeof row.requires_review === 'boolean' ? row.requires_review : undefined;
  return {
    id: String(row.id),
    score,
    maxScore,
    feedback,
    confidence,
    needsReview: (explicitReview ?? status === 'needs_review') || confidence < 0.7,
    status,
    structured,
  };
}

function GradingTab() {
  const { institutionId } = useAuthSafe();
  const [attempts, setAttempts] = useState<{ id: string; examify_exams: { title: string }; status: string }[]>([]);
  const [selectedAttempt, setSelectedAttempt] = useState<string | null>(null);
  const [answers, setAnswers] = useState<{ id: string; question_id: string; text_answer: string | null; questions: { prompt: string; type: string; metadata: any }; awarded_points: number | null }[]>([]);
  const [grading, setGrading] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, AiResultState>>({});
  const [reviewScores, setReviewScores] = useState<Record<string, string>>({});
  const [reviewReasons, setReviewReasons] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!institutionId) return;
    const { data } = await supabase
      .from('exam_attempts')
      .select('id, status, examify_exams!inner(title)')
      .in('status', ['submitted', 'auto_submitted', 'graded', 'approved'])
      .order('submitted_at', { ascending: false })
      .limit(20);
    setAttempts((data as any[]) ?? []);
    setLoading(false);
  }, [institutionId]);

  useEffect(() => { load(); }, [load]);

  async function loadAnswers(attemptId: string) {
    setSelectedAttempt(attemptId);
    setError(null);
    const { data } = await supabase
      .from('answers')
      .select('id, question_id, text_answer, awarded_points, questions!inner(prompt, type, metadata)')
      .eq('attempt_id', attemptId)
      .not('text_answer', 'is', null)
      .in('questions.type', ['short_answer', 'essay']);

    const loadedAnswers = (data as any[]) ?? [];
    setAnswers(loadedAnswers);

    if (loadedAnswers.length === 0) {
      setResults({});
      setReviewScores({});
      return;
    }

    const answerIds = loadedAnswers.map((a) => a.id);
    const { data: aiRows } = await supabase
      .from('ai_grading_results')
      .select('id, answer_id, ai_score, ai_max_score, ai_feedback, ai_confidence, requires_review, status, structured_result, final_score')
      .in('answer_id', answerIds)
      .order('created_at', { ascending: false });

    const nextResults: Record<string, AiResultState> = {};
    const nextScores: Record<string, string> = {};
    for (const row of (aiRows as any[]) ?? []) {
      if (nextResults[row.answer_id]) continue;
      const score = Number(row.final_score ?? row.ai_score ?? 0);
      nextResults[row.answer_id] = mapAiResult(row);
      nextScores[row.answer_id] = String(score);
    }
    setResults(nextResults);
    setReviewScores(nextScores);
  }

  async function gradeAnswer(answerId: string, idx: number) {
    const a = answers[idx];
    if (!a?.text_answer) return;
    setGrading(answerId);
    setError(null);
    try {
      const { data, error: rpcError } = await supabase.rpc('create_ai_grading_job', { p_answer_id: answerId });
      if (rpcError) throw rpcError;
      const row = Array.isArray(data) ? data[0] : data;
      if (!row) throw new Error('ai_grading_no_result');
      const mapped = mapAiResult({
        id: row.job_id,
        ai_score: row.awarded_points,
        ai_max_score: row.max_points,
        ai_feedback: row.structured_result?.summary ?? '',
        ai_confidence: row.confidence,
        requires_review: row.requires_review,
        status: row.status,
        structured_result: row.structured_result,
      });
      setResults((prev) => ({ ...prev, [answerId]: mapped }));
      setReviewScores((prev) => ({ ...prev, [answerId]: String(mapped.score) }));
    } catch (e) {
      console.error(e);
      setError(e instanceof Error ? e.message : 'تعذر تنفيذ التصحيح الذكي');
    } finally {
      setGrading(null);
    }
  }

  async function approveAiResult(answerId: string) {
    const result = results[answerId];
    if (!result) return;
    setGrading(answerId);
    setError(null);
    try {
      const score = Number(reviewScores[answerId] ?? result.score);
      const reason = reviewReasons[answerId]?.trim() || 'تمت المراجعة من المعلم';
      const { error: rpcError } = await supabase.rpc('approve_ai_grading_result', {
        p_result_id: result.id,
        p_final_score: score,
        p_review_reason: reason,
      });
      if (rpcError) throw rpcError;
      setResults((prev) => ({
        ...prev,
        [answerId]: { ...result, score, status: 'approved', needsReview: false },
      }));
    } catch (e) {
      console.error(e);
      setError(e instanceof Error ? e.message : 'تعذر اعتماد نتيجة التصحيح');
    } finally {
      setGrading(null);
    }
  }

  if (loading) return <div className="flex justify-center py-16"><Loader2 size={24} className="animate-spin text-brand-600" /></div>;

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <label className="label">اختر محاولة للتصحيح</label>
        <select data-testid="ai-attempt-select" className="input" value={selectedAttempt ?? ''} onChange={(e) => loadAnswers(e.target.value)}>
          <option value="">اختر...</option>
          {attempts.map((a) => <option key={a.id} value={a.id}>{a.examify_exams.title} — {a.status}</option>)}
        </select>
        {error && <div data-testid="ai-grading-error" className="mt-3 flex items-center gap-2 p-3 rounded-xl bg-danger-50 border border-danger-200"><AlertCircle size={18} className="text-danger-600" /><p className="text-sm text-danger-700">{error}</p></div>}
      </Card>

      {selectedAttempt && answers.length === 0 && (
        <Card><EmptyState icon={<Brain size={40} />} title="لا توجد إجابات نصية" subtitle="هذه المحاولة لا تحتوي على أسئلة مقالية أو قصيرة" /></Card>
      )}

      {answers.map((a, i) => (
        <Card key={a.id} className="p-4">
          <div className="flex items-start gap-2 mb-2">
            <Badge tone="brand">{a.questions.type}</Badge>
            <p className="text-sm font-600 text-ink-800">{a.questions.prompt}</p>
          </div>
          <div className="bg-ink-50 rounded-xl p-3 text-sm text-ink-700 mb-3" dir="auto">{a.text_answer}</div>
          {results[a.id] ? (
            <div data-testid="ai-grading-result" className="space-y-3">
              <div className="flex items-center gap-3">
                <Badge tone={results[a.id].needsReview ? 'warning' : 'accent'}>الدرجة: {results[a.id].score}/{results[a.id].maxScore}</Badge>
                <Badge tone="neutral">الثقة: {Math.round(results[a.id].confidence * 100)}%</Badge>
                {results[a.id].needsReview && <Badge tone="danger">تحتاج مراجعة</Badge>}
                {results[a.id].status === 'approved' && <Badge tone="accent">معتمدة</Badge>}
              </div>
              <p data-testid="ai-feedback" className="text-sm text-ink-600">{results[a.id].feedback}</p>
              {Array.isArray(results[a.id].structured?.criteria) && results[a.id].structured.criteria.length > 0 && (
                <div data-testid="ai-rubric" className="grid sm:grid-cols-2 gap-2">
                  {results[a.id].structured.criteria.map((criterion: any, index: number) => (
                    <div key={`${a.id}-criterion-${index}`} className="rounded-lg border border-ink-100 bg-white p-2 text-xs text-ink-600">
                      <div className="font-700 text-ink-800">{criterion.name ?? `Criterion ${index + 1}`}</div>
                      <div>{Number(criterion.awarded ?? 0)}/{Number(criterion.max ?? 0)}</div>
                    </div>
                  ))}
                </div>
              )}
              {Array.isArray(results[a.id].structured?.flags) && results[a.id].structured.flags.length > 0 && (
                <div data-testid="ai-flags" className="flex flex-wrap gap-2">
                  {results[a.id].structured.flags.map((flag: string) => <Badge key={flag} tone="warning">{flag}</Badge>)}
                </div>
              )}
              <div className="grid sm:grid-cols-[140px_1fr_auto] gap-2">
                <input
                  data-testid="ai-final-score"
                  type="number"
                  min="0"
                  max={results[a.id].maxScore}
                  step="0.25"
                  className="input"
                  value={reviewScores[a.id] ?? String(results[a.id].score)}
                  onChange={(e) => setReviewScores((prev) => ({ ...prev, [a.id]: e.target.value }))}
                  disabled={results[a.id].status === 'approved'}
                />
                <input
                  data-testid="ai-review-reason"
                  className="input"
                  value={reviewReasons[a.id] ?? ''}
                  onChange={(e) => setReviewReasons((prev) => ({ ...prev, [a.id]: e.target.value }))}
                  placeholder="ملاحظة المراجعة"
                  disabled={results[a.id].status === 'approved'}
                />
                <button data-testid="ai-approve-result" onClick={() => approveAiResult(a.id)} disabled={grading === a.id || results[a.id].status === 'approved'} className="btn-primary disabled:opacity-40">
                  {grading === a.id ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
                  اعتماد
                </button>
              </div>
            </div>
          ) : (
            <button data-testid="ai-grade-answer" onClick={() => gradeAnswer(a.id, i)} disabled={grading === a.id} className="btn-primary disabled:opacity-40">
              {grading === a.id ? <Loader2 size={16} className="animate-spin" /> : <Brain size={16} />}
              تصحيح ذكي
            </button>
          )}
        </Card>
      ))}
    </div>
  );
}

// ============ Question Generator Tab ============
function GeneratorTab() {
  const { institutionId } = useAuthSafe();
  const [subjects, setSubjects] = useState<{ id: string; name: string }[]>([]);
  const [topic, setTopic] = useState('');
  const [subjectId, setSubjectId] = useState('');
  const [difficulty, setDifficulty] = useState('medium');
  const [type, setType] = useState('multiple_choice');
  const [count, setCount] = useState(5);
  const [generating, setGenerating] = useState(false);
  const [generated, setGenerated] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!institutionId) return;
    supabase.from('subjects').select('id, name').eq('institution_id', institutionId).eq('is_active', true).order('name')
      .then(({ data }) => setSubjects((data as any[]) ?? []));
  }, [institutionId]);

  async function handleGenerate() {
    setGenerating(true);
    setError(null);
    try {
      const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-question-generator`;
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({ topic, subject: subjects.find((s) => s.id === subjectId)?.name ?? '', difficulty, type, count, language: 'ar' }),
      });
      if (!response.ok) throw new Error('فشل التوليد');
      const data = await response.json();
      setGenerated(data.questions ?? []);
      await supabase.from('ai_generated_questions').insert({
        institution_id: institutionId,
        subject_id: subjectId || null,
        topic,
        difficulty,
        type,
        generated_content: data,
        status: 'draft',
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'حدث خطأ');
    } finally {
      setGenerating(false);
    }
  }

  async function importQuestion(q: any) {
    const questionData = {
      institution_id: institutionId,
      subject_id: subjectId || null,
      type,
      prompt: q.prompt,
      difficulty,
      points: 1,
    };
    const { data, error: err } = await supabase.from('questions').insert(questionData).select('id').single();
    if (err) { setError(err.message); return; }
    const qId = (data as any).id;
    if (type === 'multiple_choice' && q.options) {
      await supabase.from('question_options').insert(q.options.map((label: string, i: number) => ({
        question_id: qId,
        label,
        is_correct: i === q.correct,
        sort_order: i,
      })));
    } else if (type === 'true_false') {
      await supabase.from('question_options').insert([
        { question_id: qId, label: 'صح', is_correct: q.correct === true, sort_order: 0 },
        { question_id: qId, label: 'خطأ', is_correct: q.correct === false, sort_order: 1 },
      ]);
    } else if (type === 'short_answer' && q.correctAnswer) {
      await supabase.from('questions').update({ metadata: { correct_answer: q.correctAnswer.toLowerCase().trim() } }).eq('id', qId);
    }
    alert('تم استيراد السؤال إلى بنك الأسئلة');
  }

  return (
    <div className="space-y-4">
      <Card className="p-6 space-y-4">
        <h3 className="font-700 text-ink-900">توليد أسئلة بالذكاء الاصطناعي</h3>
        {error && <div className="flex items-center gap-2 p-3 rounded-xl bg-danger-50 border border-danger-200"><AlertCircle size={18} className="text-danger-600" /><p className="text-sm text-danger-700">{error}</p></div>}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">المادة</label>
            <select className="input" value={subjectId} onChange={(e) => setSubjectId(e.target.value)}>
              <option value="">اختر المادة</option>
              {subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label">الموضوع</label>
            <input className="input" value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="مثال: التكامل بالأجزاء" />
          </div>
        </div>
        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="label">النوع</label>
            <select className="input" value={type} onChange={(e) => setType(e.target.value)}>
              <option value="multiple_choice">اختيار من متعدد</option>
              <option value="true_false">صح أو خطأ</option>
              <option value="short_answer">إجابة قصيرة</option>
              <option value="essay">مقال</option>
            </select>
          </div>
          <div>
            <label className="label">الصعوبة</label>
            <select className="input" value={difficulty} onChange={(e) => setDifficulty(e.target.value)}>
              <option value="easy">سهل</option>
              <option value="medium">متوسط</option>
              <option value="hard">صعب</option>
            </select>
          </div>
          <div>
            <label className="label">العدد</label>
            <input type="number" min="1" max="20" className="input" value={count} onChange={(e) => setCount(Number(e.target.value))} />
          </div>
        </div>
        <button onClick={handleGenerate} disabled={generating || !topic} className="btn-primary w-full disabled:opacity-40">
          {generating ? <Loader2 size={18} className="animate-spin" /> : <Sparkles size={18} />}
          توليد الأسئلة
        </button>
      </Card>

      {generated.length > 0 && (
        <div className="space-y-3">
          <h4 className="font-700 text-ink-900">الأسئلة المولّدة ({generated.length})</h4>
          {generated.map((q, i) => (
            <Card key={i} className="p-4">
              <p className="text-sm font-600 text-ink-800 mb-2">{i + 1}. {q.prompt}</p>
              {q.options && (
                <div className="space-y-1 mb-2">
                  {q.options.map((opt: string, j: number) => (
                    <div key={j} className={`text-sm px-2 py-1 rounded ${j === q.correct ? 'bg-accent-50 text-accent-700 font-600' : 'text-ink-600'}`}>
                      {String.fromCharCode(65 + j)}. {opt} {j === q.correct && <Check size={14} className="inline" />}
                    </div>
                  ))}
                </div>
              )}
              {q.correct !== undefined && typeof q.correct === 'boolean' && (
                <Badge tone="accent">{q.correct ? 'صح' : 'خطأ'}</Badge>
              )}
              {q.correctAnswer && <p className="text-xs text-ink-500">الإجابة: {q.correctAnswer}</p>}
              {q.rubric && <div className="text-xs text-ink-500 mt-1">معايير: {q.rubric.map((r: any) => r.criterion).join('، ')}</div>}
              <button onClick={() => importQuestion(q)} className="btn-outline mt-3 !py-1.5 !px-3 text-xs"><Plus size={14} /> استيراد للبنك</button>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

// ============ Weak Topics Tab ============
function WeakTab() {
  const { institutionId } = useAuthSafe();
  const [topics, setTopics] = useState<WeakTopic[]>([]);
  const [loading, setLoading] = useState(true);
  const [detecting, setDetecting] = useState(false);

  const load = useCallback(async () => {
    if (!institutionId) return;
    const { data } = await supabase
      .from('weak_topics')
      .select('student_id, topic, subtopic, weakness_score, occurrences, subjects!inner(name), student_profiles!inner(full_name)')
      .eq('institution_id', institutionId)
      .order('weakness_score', { ascending: false });
    const mapped: WeakTopic[] = ((data as any[]) ?? []).map((d) => ({
      studentId: d.student_id,
      studentName: d.student_profiles?.full_name ?? '',
      subjectId: d.subject_id ?? '',
      subjectName: d.subjects?.name ?? '',
      topic: d.topic,
      subtopic: d.subtopic,
      weaknessScore: d.weakness_score,
      occurrences: d.occurrences,
    }));
    setTopics(mapped);
    setLoading(false);
  }, [institutionId]);

  useEffect(() => { load(); }, [load]);

  async function handleDetect() {
    setDetecting(true);
    try {
      const detected = await detectWeakTopics(institutionId ?? '');
      await saveWeakTopics(institutionId ?? '', detected);
      await load();
    } catch (e) {
      console.error(e);
    } finally {
      setDetecting(false);
    }
  }

  if (loading) return <div className="flex justify-center py-16"><Loader2 size={24} className="animate-spin text-brand-600" /></div>;

  return (
    <div className="space-y-4">
      <Card className="p-4 flex items-center justify-between">
        <div>
          <h3 className="font-700 text-ink-900">نقاط الضعف المكتشفة</h3>
          <p className="text-xs text-ink-500 mt-1">تحليل آلي لإجابات الطلاب الخاطئة</p>
        </div>
        <button onClick={handleDetect} disabled={detecting} className="btn-primary disabled:opacity-40">
          {detecting ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
          تحليل واكتشاف
        </button>
      </Card>

      {topics.length === 0 ? (
        <Card><EmptyState icon={<TrendingDown size={40} />} title="لا توجد نقاط ضعف مكتشفة" subtitle="اضغط تحليل واكتشاف بعد تصحيح بعض الامتحانات" /></Card>
      ) : (
        <div className="grid gap-3">
          {topics.map((t, i) => (
            <Card key={i} hover className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1">
                  <h4 className="font-700 text-ink-900">{t.studentName}</h4>
                  <p className="text-sm text-ink-600 mt-0.5">{t.subjectName} — {t.topic}{t.subtopic ? ` (${t.subtopic})` : ''}</p>
                  <p className="text-xs text-ink-400 mt-1">{t.occurrences} إجابات خاطئة</p>
                </div>
                <div className="text-left shrink-0">
                  <div className="text-lg font-800 text-danger-600 nums-latin">{Math.round(t.weaknessScore)}%</div>
                  <div className="w-20"><ProgressBar value={t.weaknessScore} tone="danger" /></div>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

// ============ Study Plans Tab ============
function PlansTab() {
  const { institutionId } = useAuthSafe();
  const [plans, setPlans] = useState<{ id: string; title: string; description: string | null; status: string; expected_improvement: number | null; student_profiles: { full_name: string } }[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<string | null>(null);
  const [items, setItems] = useState<{ id: string; title: string; type: string; duration_minutes: number; status: string; rationale: string | null }[]>([]);

  const load = useCallback(async () => {
    if (!institutionId) return;
    const { data } = await supabase
      .from('study_plans')
      .select('id, title, description, status, expected_improvement, student_profiles!inner(full_name)')
      .eq('institution_id', institutionId)
      .order('created_at', { ascending: false });
    setPlans((data as any[]) ?? []);
    setLoading(false);
  }, [institutionId]);

  useEffect(() => { load(); }, [load]);

  async function viewPlan(planId: string) {
    setSelectedPlan(planId);
    const { data } = await supabase
      .from('study_plan_items')
      .select('id, title, type, duration_minutes, status, rationale')
      .eq('study_plan_id', planId)
      .order('sort_order');
    setItems((data as any[]) ?? []);
  }

  async function generateForStudent() {
    setGenerating(true);
    try {
      const detected = await detectWeakTopics(institutionId ?? '');
      if (detected.length === 0) { alert('لا توجد نقاط ضعف. حلل الامتحانات أولاً.'); return; }
      const byStudent = new Map<string, WeakTopic[]>();
      for (const t of detected) {
        const arr = byStudent.get(t.studentId) ?? [];
        arr.push(t);
        byStudent.set(t.studentId, arr);
      }
      for (const [studentId, studentTopics] of byStudent) {
        const plan = generateStudyPlan(studentTopics[0].studentName, studentTopics);
        const { data: planRow } = await supabase.from('study_plans').insert({
          institution_id: institutionId,
          student_id: studentId,
          title: plan.title,
          description: plan.description,
          expected_improvement: plan.expectedImprovement,
        }).select('id').single();
        if (!planRow) continue;
        const planId = (planRow as any).id;
        await supabase.from('study_plan_items').insert(plan.items.map((item, i) => ({
          study_plan_id: planId,
          title: item.title,
          type: item.type,
          duration_minutes: item.durationMinutes,
          sort_order: i,
          rationale: item.rationale,
        })));
      }
      await load();
    } catch (e) {
      console.error(e);
    } finally {
      setGenerating(false);
    }
  }

  async function updateItemStatus(itemId: string, status: string) {
    await supabase.from('study_plan_items').update({ status }).eq('id', itemId);
    setItems((prev) => prev.map((i) => i.id === itemId ? { ...i, status } : i));
  }

  if (loading) return <div className="flex justify-center py-16"><Loader2 size={24} className="animate-spin text-brand-600" /></div>;

  if (selectedPlan) {
    return (
      <Card className="p-6">
        <div className="flex items-center justify-between mb-4">
          <button onClick={() => setSelectedPlan(null)} className="btn-ghost">← رجوع</button>
          <h3 className="font-700 text-ink-900">عناصر الخطة</h3>
        </div>
        <div className="space-y-2">
          {items.map((item, i) => (
            <div key={item.id} className={`p-3 rounded-xl border ${item.status === 'done' ? 'border-accent-200 bg-accent-50/50' : item.status === 'in_progress' ? 'border-brand-200 bg-brand-50/50' : 'border-ink-200'}`}>
              <div className="flex items-center gap-3">
                <span className="text-xs font-700 text-ink-400 w-6">{i + 1}</span>
                <div className="flex-1">
                  <p className="text-sm font-600 text-ink-800">{item.title}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <Badge tone="neutral">{item.type}</Badge>
                    <span className="text-xs text-ink-400 nums-latin">{item.duration_minutes} دقيقة</span>
                    {item.rationale && <span className="text-xs text-ink-400">· {item.rationale}</span>}
                  </div>
                </div>
                <select value={item.status} onChange={(e) => updateItemStatus(item.id, e.target.value)} className="input !py-1 !px-2 !w-auto text-xs">
                  <option value="pending">معلق</option>
                  <option value="in_progress">قيد التنفيذ</option>
                  <option value="done">منجز</option>
                </select>
              </div>
            </div>
          ))}
          {items.length === 0 && <p className="text-sm text-ink-400 text-center py-4">لا توجد عناصر</p>}
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card className="p-4 flex items-center justify-between">
        <div>
          <h3 className="font-700 text-ink-900">خطط الدراسة التكيّفية</h3>
          <p className="text-xs text-ink-500 mt-1">توليد خطط شخصية بناءً على نقاط الضعف</p>
        </div>
        <button onClick={generateForStudent} disabled={generating} className="btn-primary disabled:opacity-40">
          {generating ? <Loader2 size={16} className="animate-spin" /> : <MapIcon size={16} />}
          توليد خطط
        </button>
      </Card>

      {plans.length === 0 ? (
        <Card><EmptyState icon={<MapIcon size={40} />} title="لا توجد خطط دراسية" subtitle="اضغط توليد خطط بعد تحليل نقاط الضعف" /></Card>
      ) : (
        <div className="grid gap-3">
          {plans.map((p) => (
            <Card key={p.id} hover className="p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="flex-1">
                  <h4 className="font-700 text-ink-900">{p.title}</h4>
                  {p.description && <p className="text-xs text-ink-500 mt-1">{p.description}</p>}
                  <div className="flex items-center gap-2 mt-2">
                    {p.expected_improvement && <Badge tone="accent">تحسّن متوقع: +{p.expected_improvement}%</Badge>}
                    <Badge tone={p.status === 'active' ? 'brand' : 'neutral'}>{p.status === 'active' ? 'نشطة' : p.status === 'completed' ? 'مكتملة' : 'مؤرشفة'}</Badge>
                  </div>
                </div>
                <button onClick={() => viewPlan(p.id)} className="btn-ghost !py-1.5 !px-3 text-xs"><Eye size={14} /> عرض</button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
