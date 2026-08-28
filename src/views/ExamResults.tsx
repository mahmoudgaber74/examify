import { useState, useEffect, useCallback } from 'react';
import { Loader2, AlertCircle, TrendingUp } from 'lucide-react';
import { Card, SectionHeader, Badge, EmptyState } from '../components/ui';
import { supabase, useAuthSafe } from '../lib/auth-helpers';

interface AttemptWithDetails {
  id: string;
  status: string;
  score: number | null;
  score_percentage: number | null;
  is_passed: boolean | null;
  is_result_published: boolean;
  submitted_at: string | null;
  graded_at: string | null;
  approved_at: string | null;
  examify_exams: { id: string; title: string; total_points: number; passing_score: number; show_correct_answers: boolean };
}

interface AnswerWithQuestion {
  question_id: string;
  option_id: string | null;
  text_answer: string | null;
  numeric_answer: number | null;
  answer_payload: Record<string, unknown> | null;
  is_correct: boolean | null;
  awarded_points: number | null;
  questions: { prompt: string; type: string; explanation: string | null; metadata: Record<string, unknown> | null };
  question_options?: { id: string; label: string; is_correct: boolean }[];
}

type AdvancedConfig = {
  blanks?: { id: string; accepted_answers?: string[] }[];
  pairs?: { left_id: string; left: string; right_id: string; right: string }[];
  items?: { id: string; label: string }[];
};

function resultAdvancedConfig(answer: AnswerWithQuestion): AdvancedConfig {
  const config = answer.questions.metadata?.advanced_config;
  return config && typeof config === 'object' ? config as AdvancedConfig : {};
}

export function ExamResults() {
  const { user, role, institutionId } = useAuthSafe();
  const isStudent = role === 'student';
  const [attempts, setAttempts] = useState<AttemptWithDetails[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedAttempt, setSelectedAttempt] = useState<AttemptWithDetails | null>(null);
  const [answers, setAnswers] = useState<AnswerWithQuestion[]>([]);

  const loadAttempts = useCallback(async () => {
    if (!user || !institutionId) return;
    setLoading(true);
    setError(null);

    let query;
    if (isStudent) {
      const { data: student } = await supabase
        .from('student_profiles')
        .select('id')
        .eq('user_id', user.id)
        .maybeSingle();
      if (!student) { setError('لم يتم العثور على ملف الطالب'); setLoading(false); return; }
      query = supabase
        .from('exam_attempts')
        .select('id, status, score, score_percentage, is_passed, is_result_published, submitted_at, graded_at, approved_at, examify_exams!inner(id, title, total_points, passing_score, show_correct_answers)')
        .eq('student_id', (student as { id: string }).id)
        .eq('examify_exams.institution_id', institutionId)
        .order('submitted_at', { ascending: false });
    } else {
      query = supabase
        .from('exam_attempts')
        .select('id, status, score, score_percentage, is_passed, is_result_published, submitted_at, graded_at, approved_at, examify_exams!inner(id, title, total_points, passing_score, show_correct_answers)')
        .eq('examify_exams.institution_id', institutionId)
        .in('status', ['submitted', 'auto_submitted', 'graded', 'approved'])
        .order('submitted_at', { ascending: false });
    }

    const { data, error: err } = await query;
    if (err) { setError(err.message); setLoading(false); return; }
    setAttempts((data as unknown as AttemptWithDetails[]) ?? []);
    setLoading(false);
  }, [user, institutionId, isStudent]);

  useEffect(() => { loadAttempts(); }, [loadAttempts]);

  async function viewAttempt(attempt: AttemptWithDetails) {
    setSelectedAttempt(attempt);
    setAnswers([]);
    const { data, error: err } = await supabase
      .from('answers')
      .select('question_id, option_id, text_answer, numeric_answer, answer_payload, is_correct, awarded_points, questions!inner(prompt, type, explanation, metadata)')
      .eq('attempt_id', attempt.id);
    if (err) { setError(err.message); return; }

    const answersData = (data as unknown as AnswerWithQuestion[]) ?? [];
    for (const a of answersData) {
      const { data: opts } = await supabase
        .from('question_options')
        .select('id, label, is_correct')
        .eq('question_id', a.question_id);
      a.question_options = (opts as AnswerWithQuestion['question_options']) ?? [];
    }
    setAnswers(answersData);
  }

  async function publishResult(attemptId: string) {
    const { error: err } = await supabase.from('exam_attempts')
      .update({ is_result_published: true, status: 'approved', approved_at: new Date().toISOString() })
      .eq('id', attemptId);
    if (err) { setError(err.message); return; }
    setAttempts((prev) => prev.map((a) => a.id === attemptId ? { ...a, is_result_published: true, status: 'approved' } : a));
  }

  if (loading) {
    return <div className="flex justify-center py-16"><Loader2 size={24} className="animate-spin text-brand-600" /></div>;
  }

  if (selectedAttempt) {
    return (
      <div className="max-w-3xl mx-auto space-y-4">
        <div className="flex items-center justify-between">
          <button onClick={() => setSelectedAttempt(null)} className="btn-ghost">← رجوع</button>
          <h2 className="font-display text-lg font-700 text-ink-900">{selectedAttempt.examify_exams.title}</h2>
        </div>

        <Card className="p-6">
          {selectedAttempt.status === 'submitted' || selectedAttempt.status === 'auto_submitted' ? (
            <div className="mb-4 rounded-xl border border-warning-200 bg-warning-50 p-3 text-sm text-warning-700">
              قيد المراجعة: توجد أسئلة تحتاج تصحيحًا يدويًا قبل اعتماد النتيجة النهائية.
            </div>
          ) : null}
          <div className="grid grid-cols-3 gap-4 mb-6">
            <div className="text-center">
              <div className="text-3xl font-800 text-brand-600 nums-latin">{selectedAttempt.score_percentage?.toFixed(1) ?? '—'}%</div>
              <div className="text-xs text-ink-500 mt-1">النسبة</div>
            </div>
            <div className="text-center">
              <div className="text-3xl font-800 text-ink-800 nums-latin">{selectedAttempt.score ?? '—'}</div>
              <div className="text-xs text-ink-500 mt-1">الدرجة</div>
            </div>
            <div className="text-center">
              <div className={`text-3xl font-800 nums-latin ${selectedAttempt.is_passed == null ? 'text-warning-600' : selectedAttempt.is_passed ? 'text-accent-600' : 'text-danger-600'}`}>
                {selectedAttempt.is_passed == null ? 'قيد المراجعة' : selectedAttempt.is_passed ? 'ناجح' : 'راسب'}
              </div>
              <div className="text-xs text-ink-500 mt-1">الحالة</div>
            </div>
          </div>

          <div className="grid gap-2 rounded-xl bg-ink-50 p-3 text-xs text-ink-500 mb-5">
            <p>تاريخ التسليم: <span className="nums-latin">{selectedAttempt.submitted_at ? new Date(selectedAttempt.submitted_at).toLocaleString('ar') : '—'}</span></p>
            <p>تاريخ التصحيح: <span className="nums-latin">{selectedAttempt.graded_at ? new Date(selectedAttempt.graded_at).toLocaleString('ar') : '—'}</span></p>
            <p>تاريخ النشر: <span className="nums-latin">{selectedAttempt.approved_at ? new Date(selectedAttempt.approved_at).toLocaleString('ar') : '—'}</span></p>
          </div>

          <div className="space-y-3">
            {answers.map((a, i) => (
              <div key={i} className={`p-3 rounded-xl border ${a.is_correct === true ? 'border-accent-200 bg-accent-50/50' : a.is_correct === false ? 'border-danger-200 bg-danger-50/50' : 'border-ink-200'}`}>
                <div className="flex items-start gap-2">
                  <span className="text-xs font-700 text-ink-400 mt-0.5">{i + 1}</span>
                  <div className="flex-1">
                    <p className="text-sm text-ink-800 mb-1">{a.questions.prompt}</p>
                    {a.text_answer && <p className="text-xs text-ink-600">إجابتك: {a.text_answer}</p>}
                    {a.numeric_answer != null && <p className="text-xs text-ink-600 nums-latin">إجابتك: {a.numeric_answer}</p>}
                    {a.option_id && a.question_options && (
                      <p className="text-xs text-ink-600">إجابتك: {a.question_options.find((o) => o.id === a.option_id)?.label ?? '—'}</p>
                    )}
                    {a.questions.type === 'fill_blank' && (
                      <div className="mt-2 space-y-1 text-xs text-ink-600">
                        {(resultAdvancedConfig(a).blanks ?? []).map((blank, idx) => {
                          const values = (a.answer_payload?.blanks ?? {}) as Record<string, string>;
                          return <p key={blank.id}>فراغ {idx + 1}: {values[blank.id] || '—'}</p>;
                        })}
                      </div>
                    )}
                    {a.questions.type === 'matching' && (
                      <div className="mt-2 space-y-1 text-xs text-ink-600">
                        {(resultAdvancedConfig(a).pairs ?? []).map((pair) => {
                          const matches = (a.answer_payload?.matches ?? {}) as Record<string, string>;
                          const picked = (resultAdvancedConfig(a).pairs ?? []).find((item) => item.right_id === matches[pair.left_id]);
                          return <p key={pair.left_id}>{pair.left}: {picked?.right ?? '—'}</p>;
                        })}
                      </div>
                    )}
                    {a.questions.type === 'ordering' && (
                      <div className="mt-2 text-xs text-ink-600">
                        {(((a.answer_payload?.order ?? []) as string[])
                          .map((id) => (resultAdvancedConfig(a).items ?? []).find((item) => item.id === id)?.label)
                          .filter(Boolean) as string[])
                          .join(' ← ') || '—'}
                      </div>
                    )}
                    <div className="flex items-center gap-2 mt-1">
                      {a.is_correct === true && <Badge tone="accent">صحيحة</Badge>}
                      {a.is_correct === false && <Badge tone="danger">خطأ</Badge>}
                      {a.is_correct === null && <Badge tone="warning">بانتظار التصحيح اليدوي</Badge>}
                      <span className="text-xs text-ink-400 nums-latin">{a.awarded_points ?? 0} نقطة</span>
                    </div>
                    {selectedAttempt.examify_exams.show_correct_answers && a.questions.explanation && (
                      <p className="text-xs text-ink-500 mt-1 pt-1 border-t border-ink-100">{a.questions.explanation}</p>
                    )}
                  </div>
                </div>
              </div>
            ))}
            {answers.length === 0 && <p className="text-sm text-ink-400 text-center py-4">لا توجد إجابات</p>}
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <SectionHeader title="النتائج" subtitle={isStudent ? 'نتائج امتحاناتك' : 'نتائج الطلاب'} />

      {error && (
        <div className="flex items-center gap-2 p-3 rounded-xl bg-danger-50 border border-danger-200">
          <AlertCircle size={18} className="text-danger-600" />
          <p className="text-sm text-danger-700">{error}</p>
        </div>
      )}

      {attempts.length === 0 ? (
        <Card><EmptyState icon={<TrendingUp size={40} />} title="لا توجد نتائج بعد" subtitle="ستظهر نتائج الامتحانات هنا بعد التسليم" /></Card>
      ) : (
        <div className="grid gap-3">
          {attempts.map((a) => (
            <Card key={a.id} hover className="p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <h3 className="font-700 text-ink-900 truncate">{a.examify_exams.title}</h3>
                  <div className="flex items-center gap-3 text-xs text-ink-400 mt-1">
                    {a.submitted_at && <span>{new Date(a.submitted_at).toLocaleString('ar')}</span>}
                    <span>· {a.status === 'approved' ? 'معتمد' : a.status === 'graded' ? 'مصحح' : 'تم التسليم'}</span>
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  {a.is_result_published || !isStudent ? (
                    <div className="text-left">
                      <div className={`text-lg font-800 nums-latin ${a.is_passed == null ? 'text-warning-600' : a.is_passed ? 'text-accent-600' : 'text-danger-600'}`}>
                        {a.score_percentage?.toFixed(1) ?? '—'}%
                      </div>
                      <div className="text-xs text-ink-400 nums-latin">{a.score ?? '—'}/{a.examify_exams.total_points}</div>
                    </div>
                  ) : (
                    <Badge tone="warning">بانتظار النشر</Badge>
                  )}
                  <button data-testid="result-view" onClick={() => viewAttempt(a)} className="btn-ghost !py-1.5 !px-3 text-xs">عرض</button>
                  {!isStudent && !a.is_result_published && a.status === 'graded' && (
                    <button onClick={() => publishResult(a.id)} className="btn-primary !py-1.5 !px-3 text-xs">نشر</button>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
