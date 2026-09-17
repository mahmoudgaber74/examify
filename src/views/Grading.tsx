import { useState, useEffect, useCallback } from 'react';
import {
  AlertCircle,
  Award,
  CheckCircle2,
  FileText,
  Gauge,
  Loader2,
  Pencil,
  RotateCw,
  Send,
  X,
} from 'lucide-react';
import { Card, Badge, SectionHeader, ProgressBar, EmptyState } from '../components/ui';
import { supabase, useAuthSafe } from '../lib/auth-helpers';
import { ar, getArabicErrorMessage } from '../lib/translate';

interface AttemptRow {
  id: string;
  status: string;
  score: number | null;
  score_percentage: number | null;
  is_passed: boolean | null;
  is_result_published: boolean;
  submitted_at: string | null;
  graded_at: string | null;
  examify_exams: {
    id: string;
    title: string;
    total_points: number;
    passing_score: number;
  };
  student_profiles: {
    id: string;
    full_name: string;
    student_code: string | null;
  };
}

interface AnswerRow {
  id: string;
  question_id: string;
  option_id: string | null;
  text_answer: string | null;
  numeric_answer: number | null;
  is_correct: boolean | null;
  awarded_points: number | null;
  grader_notes: string | null;
  questions: {
    prompt: string;
    type: string;
    points: number;
  };
  question_options: {
    id: string;
    label: string;
    is_correct: boolean;
  } | null;
}

const STATUS_LABELS: Record<string, { label: string; tone: 'accent' | 'warning' | 'neutral' | 'brand' }> = {
  submitted: { label: ar.statuses.grading.submitted, tone: 'warning' },
  auto_submitted: { label: ar.statuses.grading.auto_submitted, tone: 'warning' },
  graded: { label: ar.statuses.grading.graded, tone: 'brand' },
  approved: { label: ar.statuses.grading.approved, tone: 'accent' },
};

const TYPE_LABELS: Record<string, string> = {
  multiple_choice: ar.questionTypes.multiple_choice,
  true_false: ar.questionTypes.true_false,
  short_answer: ar.questionTypes.short_answer,
  essay: ar.questionTypes.essay,
  numeric: ar.questionTypes.numeric,
  fill_blank: ar.questionTypes.fill_blank,
  matching: ar.questionTypes.matching,
  ordering: ar.questionTypes.ordering,
};

const AUTO_GRADED_TYPES = new Set(['multiple_choice', 'true_false', 'fill_blank', 'matching', 'ordering']);

function isManualAnswer(answer: AnswerRow) {
  return !AUTO_GRADED_TYPES.has(answer.questions.type);
}

function statusMeta(status: string) {
  return STATUS_LABELS[status] ?? { label: status, tone: 'neutral' as const };
}

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleString('ar') : ar.grading.noSubmissionTime;
}

function answerText(answer: AnswerRow) {
  if (answer.question_options) return answer.question_options.label;
  if (answer.numeric_answer != null) return String(answer.numeric_answer);
  if (answer.text_answer) return answer.text_answer;
  return ar.grading.noAnswer;
}

export function Grading() {
  const { user, role, institutionId } = useAuthSafe();
  const [attempts, setAttempts] = useState<AttemptRow[]>([]);
  const [selected, setSelected] = useState<AttemptRow | null>(null);
  const [answers, setAnswers] = useState<AnswerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [answersLoading, setAnswersLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [editingScore, setEditingScore] = useState(false);
  const [manualScore, setManualScore] = useState('');
  const [manualGrades, setManualGrades] = useState<Record<string, { score: string; notes: string }>>({});
  const [gradingAnswerId, setGradingAnswerId] = useState<string | null>(null);

  const fetchAttempts = useCallback(async () => {
    if (!institutionId) return;
    setLoading(true);
    setError(null);

    const { data, error: fetchError } = await supabase
      .from('exam_attempts')
      .select(`
        id,
        status,
        score,
        score_percentage,
        is_passed,
        is_result_published,
        submitted_at,
        graded_at,
        examify_exams!inner(id, title, total_points, passing_score),
        student_profiles!inner(id, full_name, student_code)
      `)
      .in('status', ['submitted', 'auto_submitted', 'graded', 'approved'])
      .eq('examify_exams.institution_id', institutionId)
      .order('submitted_at', { ascending: false });

    if (fetchError) {
      console.error('Grading attempts load failed', fetchError);
      setError(getArabicErrorMessage(fetchError));
      setLoading(false);
      return;
    }

    const rows = (data as unknown as AttemptRow[]) ?? [];
    setAttempts(rows);
    setSelected((current) => {
      if (!rows.length) return null;
      if (!current) return rows[0];
      return rows.find((row) => row.id === current.id) ?? rows[0];
    });
    setLoading(false);
  }, [institutionId]);

  const fetchAnswers = useCallback(async (attemptId: string) => {
    // A selected attempt can be updated just as the user logs out. Do not
    // start a new protected request after the auth session has disappeared.
    if (!user) return;
    setAnswersLoading(true);
    setError(null);
    const { data, error: fetchError } = await supabase
      .from('answers')
      .select(`
        id,
        question_id,
        option_id,
        text_answer,
        numeric_answer,
        is_correct,
        awarded_points,
        grader_notes,
        questions!inner(prompt, type, points)
      `)
      .eq('attempt_id', attemptId)
      .order('created_at', { ascending: true });

    if (fetchError) {
      console.error('Grading answers load failed', fetchError);
      setError(getArabicErrorMessage(fetchError));
      setAnswersLoading(false);
      return;
    }

    const rows: AnswerRow[] = ((data as unknown as Omit<AnswerRow, 'question_options'>[]) ?? [])
      .map((answer) => ({ ...answer, question_options: null }));
    const questionIds = [...new Set(rows.map((answer) => answer.question_id))];

    if (questionIds.length) {
      const { data: options, error: optionsError } = await supabase
        .from('question_options')
        .select('id, question_id, label, is_correct')
        .in('question_id', questionIds);

      if (optionsError) {
        console.error('Grading answer options load failed', optionsError);
        setError(getArabicErrorMessage(optionsError));
        setAnswersLoading(false);
        return;
      }

      const optionsById = new Map(
        ((options as { id: string; question_id: string; label: string; is_correct: boolean }[]) ?? [])
          .map((option) => [option.id, option])
      );

      rows.forEach((answer) => {
        answer.question_options = answer.option_id ? optionsById.get(answer.option_id) ?? null : null;
      });
    }

    setAnswers(rows);
    setAnswersLoading(false);
  }, [user]);

  useEffect(() => { fetchAttempts(); }, [fetchAttempts]);
  useEffect(() => {
    const selectedAttemptId = selected?.id;
    if (selectedAttemptId) {
      setManualScore(selected?.score != null ? String(selected.score) : '');
      fetchAnswers(selectedAttemptId);
    } else {
      setAnswers([]);
      setManualScore('');
    }
  }, [selected?.id, selected?.score, fetchAnswers]);

  useEffect(() => {
    setManualGrades((current) => {
      const next = { ...current };
      answers.filter(isManualAnswer).forEach((answer) => {
        if (!next[answer.id]) {
          next[answer.id] = {
            score: answer.awarded_points == null ? '' : String(answer.awarded_points),
            notes: answer.grader_notes ?? '',
          };
        }
      });
      return next;
    });
  }, [answers]);

  function showToast(message: string) {
    setToast(message);
    setTimeout(() => setToast(null), 2500);
  }

  async function saveManualScore() {
    if (!selected || !user) return;
    const score = Number(manualScore);
    const totalPoints = Number(selected.examify_exams.total_points);

    if (!Number.isFinite(score) || score < 0 || score > totalPoints) {
      setError(`${ar.grading.scoreRange} ${totalPoints}`);
      return;
    }

    setActionLoading(true);
    setError(null);
    const { error: updateError } = await supabase.rpc('record_manual_exam_grade', {
      p_attempt_id: selected.id,
      p_score: score,
    });

    if (updateError) {
      console.error('Manual score save failed', updateError);
      setError(getArabicErrorMessage(updateError));
      setActionLoading(false);
      return;
    }

    setEditingScore(false);
    showToast(ar.grading.scoreSaved);
    await fetchAttempts();
    setActionLoading(false);
  }

  async function saveManualAnswer(answer: AnswerRow) {
    if (!selected || !user || !isManualAnswer(answer)) return;
    const draft = manualGrades[answer.id] ?? { score: '', notes: '' };
    const score = Number(draft.score);
    const maxPoints = Number(answer.questions.points);

    if (!Number.isFinite(score) || score < 0 || score > maxPoints) {
      setError(`${ar.grading.scoreRange} ${maxPoints}`);
      return;
    }

    setActionLoading(true);
    setGradingAnswerId(answer.id);
    setError(null);
    const { error: updateError } = await supabase.rpc('record_manual_answer_grade', {
      p_answer_id: answer.id,
      p_awarded_points: score,
      p_grader_notes: draft.notes.trim() || null,
    });

    if (updateError) {
      console.error('Manual answer grade save failed', updateError);
      setError(getArabicErrorMessage(updateError));
      setActionLoading(false);
      setGradingAnswerId(null);
      return;
    }

    showToast(ar.grading.scoreSaved);
    await Promise.all([fetchAnswers(selected.id), fetchAttempts()]);
    setActionLoading(false);
    setGradingAnswerId(null);
  }

  async function publishResult() {
    if (!selected || !user) return;
    setActionLoading(true);
    setError(null);

    const { error: updateError } = await supabase.rpc('publish_exam_result', {
      p_attempt_id: selected.id,
    });

    if (updateError) {
      console.error('Result publish failed', updateError);
      setError(getArabicErrorMessage(updateError));
      setActionLoading(false);
      return;
    }

    showToast(ar.grading.resultPublished);
    await fetchAttempts();
    setActionLoading(false);
  }

  async function unpublishForReview() {
    if (!selected) return;
    setActionLoading(true);
    setError(null);

    const { error: updateError } = await supabase.rpc('unpublish_exam_result', {
      p_attempt_id: selected.id,
      p_reason: 'Returned to teacher review',
    });

    if (updateError) {
      console.error('Result return for review failed', updateError);
      setError(getArabicErrorMessage(updateError));
      setActionLoading(false);
      return;
    }

    showToast(ar.grading.resultReturned);
    await fetchAttempts();
    setActionLoading(false);
  }

  const reviewedCount = attempts.filter((attempt) => attempt.status === 'graded' || attempt.status === 'approved').length;
  const pendingCount = attempts.filter((attempt) => attempt.status === 'submitted' || attempt.status === 'auto_submitted').length;
  const publishedCount = attempts.filter((attempt) => attempt.is_result_published).length;
  const averageScore = attempts.length
    ? attempts.reduce((sum, attempt) => sum + (attempt.score_percentage ?? 0), 0) / attempts.length
    : 0;
  const canGradeAnswers = ['super_admin', 'school_admin', 'teacher', 'grader'].includes(role);
  const canUseAttemptOverride = role === 'super_admin' || role === 'school_admin';
  const manualAnswers = answers.filter(isManualAnswer);
  const objectiveAnswers = answers.filter((answer) => !isManualAnswer(answer));
  const objectiveAwarded = objectiveAnswers.reduce((sum, answer) => sum + Number(answer.awarded_points ?? 0), 0);
  const objectiveMaximum = objectiveAnswers.reduce((sum, answer) => sum + Number(answer.questions.points), 0);
  const manualAwarded = manualAnswers.reduce((sum, answer) => sum + Number(answer.awarded_points ?? 0), 0);
  const manualMaximum = manualAnswers.reduce((sum, answer) => sum + Number(answer.questions.points), 0);
  const pendingManualCount = manualAnswers.filter((answer) => answer.awarded_points == null).length;
  const calculatedScore = objectiveAwarded + manualAwarded;

  return (
    <div className="space-y-6">
      {toast && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-4 py-2.5 rounded-xl bg-accent-600 text-white shadow-pop animate-fade-in">
          <CheckCircle2 size={16} /> <span className="text-sm font-600">{toast}</span>
        </div>
      )}

      <SectionHeader
        title={ar.grading.title}
        subtitle={ar.grading.subtitle}
      />

      {error && (
        <div className="flex items-center gap-2 p-3 rounded-xl bg-danger-50 border border-danger-200">
          <AlertCircle size={18} className="text-danger-600" />
          <p className="text-sm text-danger-700">{error}</p>
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: ar.grading.pendingReview, value: pendingCount, icon: FileText, tone: 'text-warning-600 bg-warning-50' },
          { label: ar.grading.reviewed, value: reviewedCount, icon: CheckCircle2, tone: 'text-brand-600 bg-brand-50' },
          { label: ar.grading.publishedResults, value: publishedCount, icon: Send, tone: 'text-accent-600 bg-accent-50' },
          { label: ar.grading.averageScore, value: `${averageScore.toFixed(1)}%`, icon: Gauge, tone: 'text-gold-600 bg-gold-500/10' },
        ].map((stat) => (
          <Card key={stat.label} className="p-4 flex items-center gap-3">
            <div className={`grid place-items-center w-10 h-10 rounded-xl ${stat.tone}`}><stat.icon size={20} /></div>
            <div>
              <p className="text-xs text-ink-500">{stat.label}</p>
              <p className="font-display font-700 text-ink-900 text-lg nums-latin">{stat.value}</p>
            </div>
          </Card>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 size={24} className="animate-spin text-brand-600" /></div>
      ) : attempts.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Award size={40} />}
            title={ar.grading.noAttempts}
            subtitle={ar.grading.noAttemptsSubtitle}
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-5 gap-6">
          <Card className="xl:col-span-2 p-0 overflow-hidden">
            <div className="divide-y divide-ink-50 max-h-[640px] overflow-y-auto">
              {attempts.map((attempt) => {
                const meta = statusMeta(attempt.status);
                return (
                  <button
                    key={attempt.id}
                    onClick={() => { setSelected(attempt); setEditingScore(false); }}
                    data-testid="grading-attempt"
                    className={`w-full text-right p-4 hover:bg-ink-50 transition ${selected?.id === attempt.id ? 'bg-brand-50/60 border-r-2 border-brand-600' : ''}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-700 text-sm text-ink-900 truncate">{attempt.student_profiles.full_name}</p>
                        <p className="text-xs text-ink-500 truncate">{attempt.examify_exams.title}</p>
                        <p className="text-[11px] text-ink-400 mt-1">{formatDate(attempt.submitted_at)}</p>
                      </div>
                      <div className="text-left shrink-0">
                        <p className="font-display font-800 text-ink-900 nums-latin">{attempt.score_percentage?.toFixed(1) ?? '—'}%</p>
                        <Badge tone={meta.tone}>{meta.label}</Badge>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </Card>

          <div className="xl:col-span-3 space-y-4">
            {selected && (
              <>
                <Card className="p-6">
                  <div className="flex items-start justify-between gap-4 mb-5">
                    <div>
                      <h3 className="font-display font-700 text-ink-900">{selected.student_profiles.full_name}</h3>
                      <p className="text-sm text-ink-500 mt-1">{selected.examify_exams.title}</p>
                      <p className="text-xs text-ink-400 mt-1 nums-latin">
                        {selected.student_profiles.student_code ?? ar.grading.noCode} · {formatDate(selected.submitted_at)}
                      </p>
                    </div>
                    <div className="text-left">
                      {canUseAttemptOverride && editingScore ? (
                        <div className="flex items-center gap-2">
                          <input
                            data-testid="grading-score-input"
                            type="number"
                            min={0}
                            max={selected.examify_exams.total_points}
                            value={manualScore}
                            onChange={(event) => setManualScore(event.target.value)}
                            className="w-24 rounded-lg border border-ink-200 px-2 py-1 text-lg font-700 text-ink-900 text-center nums-latin"
                          />
                          <span className="text-sm text-ink-400 nums-latin">/ {selected.examify_exams.total_points}</span>
                        </div>
                      ) : (
                        <p className="font-display text-3xl font-800 text-ink-900 mt-1 nums-latin">
                          {selected.score ?? '—'}
                          <span className="text-lg text-ink-400"> / {selected.examify_exams.total_points}</span>
                        </p>
                      )}
                      <div className="mt-1">
                        <Badge tone={statusMeta(selected.status).tone}>{statusMeta(selected.status).label}</Badge>
                      </div>
                    </div>
                  </div>

                  <ProgressBar value={selected.score_percentage ?? 0} tone={(selected.score_percentage ?? 0) >= selected.examify_exams.passing_score ? 'accent' : 'danger'} />

                  <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-2 text-xs text-ink-600">
                    <div className="rounded-lg bg-ink-50 p-2">الأسئلة الموضوعية: <strong className="nums-latin">{objectiveAwarded} / {objectiveMaximum}</strong></div>
                    <div className="rounded-lg bg-ink-50 p-2">الأسئلة اليدوية: <strong className="nums-latin">{manualAwarded} / {manualMaximum}</strong></div>
                    <div className="rounded-lg bg-ink-50 p-2">الإجمالي: <strong className="nums-latin">{calculatedScore} / {selected.examify_exams.total_points}</strong></div>
                    <div className="rounded-lg bg-ink-50 p-2">قيد التصحيح: <strong className="nums-latin">{pendingManualCount}</strong></div>
                  </div>

                  <div className="flex flex-wrap gap-2 mt-5">
                    {canUseAttemptOverride && editingScore ? (
                      <>
                        <button data-testid="grading-save-score" onClick={saveManualScore} disabled={actionLoading} className="btn-primary disabled:opacity-60">
                          {actionLoading ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
                          {ar.grading.saveScore}
                        </button>
                        <button onClick={() => setEditingScore(false)} className="btn-outline"><X size={16} /> {ar.common.cancel}</button>
                      </>
                    ) : (
                      <>
                        {canUseAttemptOverride && !selected.is_result_published && (
                          <button data-testid="grading-edit-score" onClick={() => setEditingScore(true)} className="btn-outline"><Pencil size={16} /> تعديل الدرجة النهائية استثنائيًا</button>
                        )}
                        <button data-testid="grading-publish-result" onClick={publishResult} disabled={actionLoading || selected.status !== 'graded' || pendingManualCount > 0} className="btn-primary disabled:opacity-50">
                          {actionLoading ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                          {ar.grading.approveAndPublish}
                        </button>
                        {selected.is_result_published && (
                          <button onClick={unpublishForReview} disabled={actionLoading} className="btn-ghost disabled:opacity-60">
                            <RotateCw size={16} /> {ar.grading.returnForReview}
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </Card>

                <Card className="p-5">
                  <div className="flex items-center justify-between mb-4">
                    <h4 className="font-700 text-ink-900">{ar.grading.attemptAnswers}</h4>
                    <span className="text-xs text-ink-400 nums-latin">{answers.length} {ar.grading.answersCount}</span>
                  </div>

                  {answersLoading ? (
                    <div className="p-8 text-center"><Loader2 size={22} className="animate-spin text-brand-600 mx-auto" /></div>
                  ) : answers.length === 0 ? (
                    <p className="text-sm text-ink-400 text-center py-6">{ar.grading.noSavedAnswers}</p>
                  ) : (
                    <div className="space-y-3">
                      {answers.map((answer, index) => (
                        <div key={answer.id} className="p-3 rounded-xl border border-ink-100 bg-white">
                          <div className="flex items-start gap-3">
                            <span className="text-xs font-700 text-ink-400 mt-1 nums-latin">{index + 1}</span>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1">
                                <Badge tone="neutral">{TYPE_LABELS[answer.questions.type] ?? answer.questions.type}</Badge>
                                {isManualAnswer(answer) ? (
                                  answer.awarded_points === null ? (
                                    <Badge tone="warning">{ar.grading.needsReview}</Badge>
                                  ) : answer.awarded_points === answer.questions.points ? (
                                    <Badge tone="accent">{ar.grading.correct}</Badge>
                                  ) : answer.awarded_points === 0 ? (
                                    <Badge tone="danger">{ar.grading.incorrect}</Badge>
                                  ) : (
                                    <Badge tone="warning">درجة جزئية</Badge>
                                  )
                                ) : (
                                  answer.is_correct === true ? <Badge tone="accent">{ar.grading.correct}</Badge> :
                                  answer.is_correct === false ? <Badge tone="danger">{ar.grading.incorrect}</Badge> :
                                  <Badge tone="warning">{ar.grading.needsReview}</Badge>
                                )}
                              </div>
                              <p className="text-sm text-ink-800 leading-relaxed">{answer.questions.prompt}</p>
                              <p className="text-sm text-ink-600 mt-2 whitespace-pre-wrap">{ar.grading.answer}: {answerText(answer)}</p>
                              <p className="text-xs text-ink-400 mt-2 nums-latin">
                                {ar.grading.awardedMarks}: {answer.awarded_points ?? 0} / {answer.questions.points}
                              </p>
                              {answer.grader_notes && <p className="text-xs text-ink-500 mt-1">{ar.grading.note}: {answer.grader_notes}</p>}
                              {canGradeAnswers && isManualAnswer(answer) && !selected.is_result_published && ['submitted', 'auto_submitted', 'graded'].includes(selected.status) && (
                                <div className="mt-3 rounded-lg border border-warning-200 bg-warning-50/50 p-3 space-y-2">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <label className="text-xs font-700 text-ink-700" htmlFor={`manual-score-${answer.id}`}>درجة السؤال</label>
                                    <input
                                      id={`manual-score-${answer.id}`}
                                      data-testid={`manual-answer-score-${answer.id}`}
                                      type="number"
                                      min={0}
                                      max={answer.questions.points}
                                      value={manualGrades[answer.id]?.score ?? ''}
                                      onChange={(event) => setManualGrades((current) => ({ ...current, [answer.id]: { ...(current[answer.id] ?? { notes: '' }), score: event.target.value } }))}
                                      className="w-24 rounded-lg border border-ink-200 bg-white px-2 py-1 text-center nums-latin"
                                    />
                                    <span className="text-xs text-ink-500 nums-latin">/ {answer.questions.points}</span>
                                  </div>
                                  <textarea
                                    aria-label="ملاحظات المصحح"
                                    data-testid={`manual-answer-notes-${answer.id}`}
                                    rows={2}
                                    value={manualGrades[answer.id]?.notes ?? ''}
                                    onChange={(event) => setManualGrades((current) => ({ ...current, [answer.id]: { ...(current[answer.id] ?? { score: '' }), notes: event.target.value } }))}
                                    placeholder="ملاحظات المصحح (اختياري)"
                                    className="w-full rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm"
                                  />
                                  <button
                                    data-testid={`manual-answer-save-${answer.id}`}
                                    onClick={() => saveManualAnswer(answer)}
                                    disabled={actionLoading}
                                    className="btn-primary disabled:opacity-60"
                                  >
                                    {gradingAnswerId === answer.id ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
                                    حفظ درجة السؤال
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </Card>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
