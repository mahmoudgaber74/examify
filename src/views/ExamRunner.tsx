import { useState, useEffect, useCallback, useRef } from 'react';
import { Clock, Loader2, AlertCircle, FileText, CheckCircle2, Send, ArrowRight, ArrowLeft } from 'lucide-react';
import '@tensorflow/tfjs';
import * as blazeface from '@tensorflow-models/blazeface';
import { Card, SectionHeader, Badge, EmptyState } from '../components/ui';
import { supabase, useAuthSafe } from '../lib/auth-helpers';
import { getClientDeviceId, getClientDeviceLabel } from '../lib/session-guard';

interface ExamSummary {
  id: string;
  title: string;
  description: string | null;
  instructions: string | null;
  duration_minutes: number;
  start_at: string | null;
  end_at: string | null;
  status: string;
  total_points: number;
  passing_score: number;
  max_attempts: number;
  show_result_immediately: boolean;
  show_correct_answers: boolean;
  subject_id: string | null;
  shuffle_questions?: boolean;
  shuffle_options?: boolean;
}

interface ExamQuestionItem {
  id: string;
  question_id: string;
  points: number;
  sort_order: number;
  questions: {
    id: string;
    type: string;
    prompt: string;
    image_url: string | null;
    explanation: string | null;
    metadata: Record<string, unknown> | null;
  };
  options?: { id: string; label: string; sort_order: number }[];
}

interface AttemptRow {
  id: string;
  attempt_number?: number;
  status: string;
  started_at: string;
  deadline_at: string;
  offline_recovery_token: string | null;
  submitted_at: string | null;
  score: number | null;
  score_percentage: number | null;
  is_passed: boolean | null;
  is_result_published: boolean;
}

interface AttemptSummary {
  attempts_used: number;
  max_attempts: number;
  attempts_remaining: number;
  has_in_progress: boolean;
  latest_attempt_id: string | null;
  latest_status: string | null;
  is_result_published: boolean;
}

interface SubmitAttemptResult {
  status: string;
  score: number;
  score_percentage: number;
  is_passed: boolean | null;
  needs_manual_grading: boolean;
  is_result_published: boolean;
}

type AnswerState = {
  optionId?: string;
  text?: string;
  numeric?: string;
  payload?: Record<string, unknown>;
};

type FillBlankConfig = { blanks?: { id: string; accepted_answers?: string[]; case_sensitive?: boolean; ignore_extra_spaces?: boolean }[] };
type MatchingConfig = { pairs?: { left_id: string; left: string; right_id: string; right: string }[] };
type OrderingConfig = { items?: { id: string; label: string }[] };

const TYPE_LABELS: Record<string, string> = {
  multiple_choice: 'اختيار من متعدد',
  true_false: 'صح أو خطأ',
  short_answer: 'إجابة قصيرة',
  essay: 'مقال',
  numeric: 'رقمي',
  fill_blank: 'إكمال فراغ',
  matching: 'توصيل العناصر',
  ordering: 'ترتيب العناصر',
};

function advancedConfig(q: ExamQuestionItem): FillBlankConfig & MatchingConfig & OrderingConfig {
  const config = q.questions.metadata?.advanced_config;
  return config && typeof config === 'object' ? config as FillBlankConfig & MatchingConfig & OrderingConfig : {};
}

function hashText(value: string) {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) hash = ((hash << 5) - hash) + value.charCodeAt(i);
  return Math.abs(hash);
}

function stableShuffle<T extends { id?: string; left_id?: string; right_id?: string }>(items: T[], seed: string) {
  return [...items].sort((a, b) => {
    const aKey = a.id ?? a.left_id ?? a.right_id ?? '';
    const bKey = b.id ?? b.left_id ?? b.right_id ?? '';
    return hashText(`${seed}:${aKey}`) - hashText(`${seed}:${bKey}`);
  });
}

function attemptDraftKey(attemptId: string) {
  return `examify:exam-attempt-draft:${attemptId}`;
}

function readAttemptDraft(attemptId: string): Record<string, AnswerState> {
  try {
    const raw = localStorage.getItem(attemptDraftKey(attemptId));
    return raw ? JSON.parse(raw) as Record<string, AnswerState> : {};
  } catch {
    return {};
  }
}

function writeAttemptDraft(attemptId: string, answers: Record<string, AnswerState>) {
  try {
    localStorage.setItem(attemptDraftKey(attemptId), JSON.stringify(answers));
  } catch {
    // Supabase remains the source of truth if browser storage is unavailable.
  }
}

function clearAttemptDraft(attemptId: string) {
  try { localStorage.removeItem(attemptDraftKey(attemptId)); } catch { /* noop */ }
}

type QueuedSubmission = { attemptId: string; answers: Record<string, AnswerState>; auto: boolean; timeRemainingSeconds: number; recoveryToken: string | null };
function queuedSubmissionKey(attemptId: string) { return `examify:exam-submission-queue:${attemptId}`; }
function readQueuedSubmission(attemptId: string): QueuedSubmission | null {
  try {
    const raw = localStorage.getItem(queuedSubmissionKey(attemptId));
    return raw ? JSON.parse(raw) as QueuedSubmission : null;
  } catch { return null; }
}
function writeQueuedSubmission(submission: QueuedSubmission) {
  try { localStorage.setItem(queuedSubmissionKey(submission.attemptId), JSON.stringify(submission)); } catch { /* keep the exam locked if storage is unavailable */ }
}
function clearQueuedSubmission(attemptId: string) {
  try { localStorage.removeItem(queuedSubmissionKey(attemptId)); } catch { /* noop */ }
}

export function ExamRunner() {
  const { user, institutionId } = useAuthSafe();
  const [exams, setExams] = useState<ExamSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeExam, setActiveExam] = useState<ExamSummary | null>(null);
  const [activeAttempt, setActiveAttempt] = useState<AttemptRow | null>(null);
  const [questions, setQuestions] = useState<ExamQuestionItem[]>([]);
  const [answers, setAnswers] = useState<Record<string, AnswerState>>({});
  const [currentQ, setCurrentQ] = useState(0);
  const [timeLeft, setTimeLeft] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [isOnline, setIsOnline] = useState(() => typeof navigator === 'undefined' || navigator.onLine);
  const [submissionQueued, setSubmissionQueued] = useState(false);
  const [examLocked, setExamLocked] = useState(false);
  const [result, setResult] = useState<SubmitAttemptResult | null>(null);
  const [strikeCount, setStrikeCount] = useState(0);
  const [activeViolation, setActiveViolation] = useState<{ type: string; description: string } | null>(null);
  const [examDeviceBlocked, setExamDeviceBlocked] = useState(false);
  const [cameraStatus, setCameraStatus] = useState<'inactive' | 'starting' | 'active' | 'unavailable'>('inactive');
  const [attempts, setAttempts] = useState<Record<string, AttemptRow[]>>({});
  const [attemptSummaries, setAttemptSummaries] = useState<Record<string, AttemptSummary>>({});
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const autoSaveRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pendingAnswerWritesRef = useRef<Set<PromiseLike<void>>>(new Set());
  const answerWriteQueueRef = useRef<Promise<void>>(Promise.resolve());
  const activeSavePromiseRef = useRef<Promise<void> | null>(null);
  const submissionStartedRef = useRef(false);
  const violationCooldownRef = useRef<Map<string, number>>(new Map());
  const strikeCountRef = useRef(0);
  const handleSubmitRef = useRef<(auto: boolean) => Promise<void>>(async () => undefined);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const fullscreenRequestedRef = useRef(false);
  const lastIncidentRef = useRef<{ type: string; at: number } | null>(null);
  const violationAutoSubmitRef = useRef(false);
  const MAX_STRIKES = 3;
  const PROCTORING_DEDUPE_WINDOW_MS = 1200;

  useEffect(() => {
    const online = () => setIsOnline(true);
    const offline = () => setIsOnline(false);
    window.addEventListener('online', online);
    window.addEventListener('offline', offline);
    return () => { window.removeEventListener('online', online); window.removeEventListener('offline', offline); };
  }, []);

  const loadAttempt = useCallback(async (exam: ExamSummary, attempt: AttemptRow) => {
    if (attempt.status !== 'in_progress') return false;
    const queued = readQueuedSubmission(attempt.id);
    submissionStartedRef.current = Boolean(queued);
    lastIncidentRef.current = null;
    violationAutoSubmitRef.current = false;
    setExamLocked(Boolean(queued));
    setSubmissionQueued(Boolean(queued));
    setSubmitting(true);
    setError(null);

    const { data: eqData, error: eqErr } = await supabase
      .from('exam_questions')
      .select('id, question_id, points, sort_order, questions!inner(id, type, prompt, image_url, explanation, metadata)')
      .eq('exam_id', exam.id)
      .order('sort_order');

    if (eqErr) {
      setError(eqErr.message);
      setSubmitting(false);
      return false;
    }

    const examQuestions = (eqData as unknown as ExamQuestionItem[]) ?? [];
    const optionQuestionIds = new Set(examQuestions
      .filter((q) => q.questions.type === 'multiple_choice' || q.questions.type === 'true_false')
      .map((q) => q.question_id));

    if (optionQuestionIds.size > 0) {
      const { data: opts, error: optsErr } = await supabase.rpc('get_exam_question_options', { p_exam_id: exam.id });
      if (optsErr) {
        setError(optsErr.message);
        setSubmitting(false);
        return false;
      }
      const byQuestion = new Map<string, { id: string; label: string; sort_order: number }[]>();
      for (const opt of (opts as { question_id: string; id: string; label: string; sort_order: number }[]) ?? []) {
        if (!optionQuestionIds.has(opt.question_id)) continue;
        const rows = byQuestion.get(opt.question_id) ?? [];
        rows.push({ id: opt.id, label: opt.label, sort_order: opt.sort_order });
        byQuestion.set(opt.question_id, rows);
      }
      for (const q of examQuestions) {
        const options = byQuestion.get(q.question_id) ?? [];
        q.options = exam.shuffle_options ? stableShuffle(options, `${attempt.id}:options:${q.question_id}`) : options;
      }
    }

    const { data: existingAnswers, error: answersErr } = await supabase
      .from('answers')
      .select('question_id, option_id, text_answer, numeric_answer, answer_payload, matching_data, ordering_data')
      .eq('attempt_id', attempt.id);

    if (answersErr) {
      setError(answersErr.message);
      setSubmitting(false);
      return false;
    }

    const answerMap: Record<string, AnswerState> = {};
    for (const a of (existingAnswers as { question_id: string; option_id: string | null; text_answer: string | null; numeric_answer: number | null; answer_payload: Record<string, unknown> | null; matching_data: unknown; ordering_data: unknown }[]) ?? []) {
      answerMap[a.question_id] = {
        optionId: a.option_id ?? undefined,
        text: a.text_answer ?? undefined,
        numeric: a.numeric_answer != null ? String(a.numeric_answer) : undefined,
        payload: a.answer_payload ?? (
          a.matching_data ? { matches: a.matching_data } :
          a.ordering_data ? { order: a.ordering_data } :
          undefined
        ),
      };
    }

    const draftAnswers = readAttemptDraft(attempt.id);
    const restoredAnswers = { ...answerMap, ...draftAnswers };
    for (const [questionId, answer] of Object.entries(draftAnswers)) {
      queueAnswerPersistence(attempt.id, questionId, answer);
    }

    const orderedQuestions = exam.shuffle_questions ? stableShuffle(examQuestions, `${attempt.id}:questions`) : examQuestions;
    setQuestions(orderedQuestions);
    setAnswers(restoredAnswers);
    setActiveExam(exam);
    setActiveAttempt(attempt);
    const lastAnsweredQuestion = orderedQuestions.reduce((lastIndex, question, index) => (
      restoredAnswers[question.question_id] ? index : lastIndex
    ), 0);
    setCurrentQ(lastAnsweredQuestion);
    setResult(null);
    setSubmitting(false);
    return true;
  }, []);

  const loadExams = useCallback(async () => {
    if (!user || !institutionId) return;
    setLoading(true);
    setError(null);

    const { data: student, error: studentError } = await supabase
      .from('student_profiles')
      .select('id')
      .eq('user_id', user.id)
      .maybeSingle();

    if (studentError || !student) {
      setError('تعذر تحميل ملف الطالب. حاول مرة أخرى لاحقًا.');
      setLoading(false);
      return;
    }
    const studentId = (student as { id: string }).id;

    const { data: examData, error: err } = await supabase
      .from('examify_exams')
      .select('id, title, description, instructions, duration_minutes, start_at, end_at, status, total_points, passing_score, max_attempts, show_result_immediately, show_correct_answers, subject_id, shuffle_questions, shuffle_options')
      .eq('institution_id', institutionId)
      .eq('status', 'published')
      .order('created_at', { ascending: false });

    if (err) {
      setError('تعذر تحميل الامتحانات. حاول مرة أخرى لاحقًا.');
      setLoading(false);
      return;
    }

    const allExams = (examData as ExamSummary[]) ?? [];

    const attemptsMap: Record<string, AttemptRow[]> = {};
    const summariesMap: Record<string, AttemptSummary> = {};
    for (const exam of allExams) {
      const { data: summaryData, error: summaryError } = await supabase.rpc('get_student_exam_attempt_summary', {
        p_exam_id: exam.id,
      });
      if (summaryError || !summaryData) {
        setError('تعذر تحميل حالة محاولات الامتحان. حاول مرة أخرى لاحقًا.');
        setLoading(false);
        return;
      }
      summariesMap[exam.id] = summaryData as AttemptSummary;

      const { data: atts, error: attemptsError } = await supabase
        .from('exam_attempts')
        .select('id, attempt_number, status, started_at, deadline_at, offline_recovery_token, submitted_at, score, score_percentage, is_passed, is_result_published')
        .eq('exam_id', exam.id)
        .eq('student_id', studentId)
        .order('attempt_number', { ascending: false });
      if (attemptsError) {
        setError('تعذر تحميل تفاصيل محاولات الامتحان. حاول مرة أخرى لاحقًا.');
        setLoading(false);
        return;
      }
      attemptsMap[exam.id] = (atts as AttemptRow[]) ?? [];
    }
    setAttempts(attemptsMap);
    setAttemptSummaries(summariesMap);
    setExams(allExams);
    setLoading(false);

    const resumable = allExams
      .flatMap((exam) => (attemptsMap[exam.id] ?? []).map((attempt) => ({ exam, attempt })))
      .filter(({ attempt }) => attempt.status === 'in_progress')
      .sort((a, b) => new Date(b.attempt.started_at).getTime() - new Date(a.attempt.started_at).getTime())[0];
    if (resumable && !activeAttempt) await loadAttempt(resumable.exam, resumable.attempt);
  }, [user, institutionId, activeAttempt, loadAttempt]);

  useEffect(() => { loadExams(); }, [loadExams]);

  // Timer
  useEffect(() => {
    if (!activeAttempt || !activeExam || questions.length === 0) return;
    const endTime = new Date(activeAttempt.deadline_at).getTime();
    if (!Number.isFinite(endTime)) {
      setError('تعذر التحقق من وقت انتهاء الامتحان. حاول مرة أخرى لاحقًا.');
      return;
    }
    const update = () => {
      const remaining = Math.max(0, Math.floor((endTime - Date.now()) / 1000));
      setTimeLeft(remaining);
      if (remaining <= 0 && questions.length > 0) {
        if (timerRef.current) clearInterval(timerRef.current);
        handleSubmit(true);
      }
    };
    update();
    timerRef.current = setInterval(update, 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [activeAttempt, activeExam, questions.length]);

  // The account session guard prevents ordinary multi-login use. This second
  // heartbeat protects an active attempt if a token/device is copied while the
  // first browser is still answering.
  useEffect(() => {
    if (!activeAttempt) {
      setExamDeviceBlocked(false);
      return;
    }
    let mounted = true;
    const deviceId = getClientDeviceId();
    const deviceLabel = getClientDeviceLabel();
    const claim = async () => {
      const { data, error } = await supabase.rpc('claim_student_exam_device', {
        p_attempt_id: activeAttempt.id,
        p_device_id: deviceId,
        p_device_label: deviceLabel,
      });
      const allowed = !error && (data as { allowed?: boolean } | null)?.allowed === true;
      if (mounted && !allowed) {
        setExamDeviceBlocked(true);
        setExamLocked(true);
        setError('تم اكتشاف جهاز آخر يستخدم محاولة الامتحان. تم إيقاف الإجابة على هذا الجهاز حفاظًا على نزاهة الامتحان.');
      }
    };
    const heartbeat = async () => {
      if (!navigator.onLine) return;
      const { data, error } = await supabase.rpc('touch_student_exam_device', {
        p_attempt_id: activeAttempt.id,
        p_device_id: deviceId,
      });
      if (mounted && (error || data !== true)) {
        setExamDeviceBlocked(true);
        setExamLocked(true);
        setError('انتهت صلاحية جهاز الامتحان الحالي أو تم فتح المحاولة من جهاز آخر.');
      }
    };
    void claim();
    const timer = window.setInterval(() => { void heartbeat(); }, 10000);
    return () => { mounted = false; window.clearInterval(timer); };
  }, [activeAttempt?.id]);

  // Auto-save answers
  useEffect(() => {
    if (!activeAttempt) return;
    autoSaveRef.current = setInterval(() => { saveAnswers(false); }, 30000);
    return () => { if (autoSaveRef.current) clearInterval(autoSaveRef.current); };
  }, [activeAttempt, answers]);

  // Request fullscreen only after the runner has loaded its questions. A
  // browser permission/policy rejection leaves the exam usable and is not a
  // proctoring violation.
  useEffect(() => {
    if (!activeAttempt || !activeExam || questions.length === 0 || result || fullscreenRequestedRef.current) return;
    void document.documentElement.requestFullscreen()
      .then(() => { fullscreenRequestedRef.current = true; })
      .catch(() => undefined);
  }, [activeAttempt, activeExam, questions.length, result]);

  async function startExam(exam: ExamSummary) {
    if (!user) return;
    setError(null);
    setSubmitting(true);

    const { data: student } = await supabase
      .from('student_profiles')
      .select('id')
      .eq('user_id', user.id)
      .maybeSingle();
    if (!student) { setError('لم يتم العثور على ملف الطالب'); setSubmitting(false); return; }
    const { data: startedAttempt, error: startError } = await supabase.rpc('start_exam_attempt', {
      p_exam_id: exam.id,
    });
    if (startError || !startedAttempt) {
      const startMessage = startError?.message ?? '';
      setError(startMessage.includes('maximum_attempts_exceeded')
        ? 'تم استنفاد جميع محاولات هذا الامتحان.'
        : 'تعذر بدء محاولة الامتحان. حاول مرة أخرى لاحقًا.');
      setSubmitting(false);
      return;
    }
    const attemptId = (startedAttempt as { id: string }).id;
    /*
     * Attempt eligibility, ownership, numbering, and concurrency are enforced
     * by start_exam_attempt. The legacy client-side checks remain below only
     * until this function is simplified in a later cleanup.
     */
    /*
    // Check existing attempts
    const existing = attempts[exam.id] ?? [];
    const completed = existing.filter((a) => a.status === 'submitted' || a.status === 'auto_submitted' || a.status === 'graded' || a.status === 'approved');
    if (completed.length >= exam.max_attempts) {
      setError('لقد استنفدت جميع محاولات هذا الامتحان');
      setSubmitting(false);
      return;
    }

    // Check if there's an in-progress attempt
    const inProgress = existing.find((a) => a.status === 'in_progress');
    let attemptId: string;

    if (inProgress) {
      attemptId = inProgress.id;
    } else {
      const attemptNumber = existing.length + 1;
      const { data: newAttempt, error: attErr } = await supabase.from('exam_attempts').insert({
        exam_id: exam.id,
        student_id: studentId,
        attempt_number: attemptNumber,
        status: 'in_progress',
      }).select('id').single();
      if (attErr) { setError(attErr.message); setSubmitting(false); return; }
      attemptId = (newAttempt as { id: string }).id;
    }
    */

    const { data: persistedAttempt, error: persistedAttemptErr } = await supabase
      .from('exam_attempts')
      .select('id, attempt_number, status, started_at, deadline_at, offline_recovery_token, submitted_at, score, score_percentage, is_passed, is_result_published')
      .eq('id', attemptId)
      .single();
    if (persistedAttemptErr || !persistedAttempt) {
      setError('تعذر تحميل محاولة الامتحان. حاول مرة أخرى لاحقًا.');
      setSubmitting(false);
      return;
    }
    await loadAttempt(exam, persistedAttempt as AttemptRow);
  }

  function setAnswer(questionId: string, field: 'optionId' | 'text' | 'numeric', value: string) {
    if (submissionStartedRef.current || examDeviceBlocked) return;
    const nextAnswer = { ...answers[questionId], [field]: value };
    const nextAnswers = { ...answers, [questionId]: nextAnswer };
    setAnswers(nextAnswers);
    if (activeAttempt) writeAttemptDraft(activeAttempt.id, nextAnswers);
    if (activeAttempt) queueAnswerPersistence(activeAttempt.id, questionId, nextAnswer);
  }

  function setAnswerPayload(questionId: string, payload: Record<string, unknown>) {
    if (submissionStartedRef.current || examDeviceBlocked) return;
    const nextAnswer = { ...answers[questionId], payload };
    const nextAnswers = { ...answers, [questionId]: nextAnswer };
    setAnswers(nextAnswers);
    if (activeAttempt) writeAttemptDraft(activeAttempt.id, nextAnswers);
    if (activeAttempt) queueAnswerPersistence(activeAttempt.id, questionId, nextAnswer);
  }

  function queueAnswerPersistence(attemptId: string, questionId: string, ans: AnswerState) {
    if (submissionStartedRef.current) return;
    const pending = enqueueAnswerWrite(() => persistAnswer(attemptId, questionId, ans));
    trackAnswerWrite(pending);
  }

  function enqueueAnswerWrite(write: () => Promise<void>) {
    const queued = answerWriteQueueRef.current.catch(() => undefined).then(write);
    answerWriteQueueRef.current = queued.catch(() => undefined);
    return queued;
  }

  function trackAnswerWrite(pending: PromiseLike<void>) {
    pendingAnswerWritesRef.current.add(pending);
    void pending.then(
      () => pendingAnswerWritesRef.current.delete(pending),
      () => pendingAnswerWritesRef.current.delete(pending),
    );
  }

  async function flushPendingAnswerWrites() {
    // A save interval can be in the middle of queuing its writes when submit
    // starts. Wait for that batch first, then drain the set again so no answer
    // request can be left behind the submit RPC.
    while (activeSavePromiseRef.current || pendingAnswerWritesRef.current.size > 0) {
      const activeSave = activeSavePromiseRef.current;
      if (activeSave) await activeSave;
      const pending = [...pendingAnswerWritesRef.current];
      if (pending.length > 0) await Promise.all(pending);
    }
  }

  async function persistAnswer(attemptId: string, questionId: string, ans: AnswerState) {
    const row: { attempt_id: string; question_id: string; option_id?: string; text_answer?: string; numeric_answer?: number; answer_payload?: Record<string, unknown>; matching_data?: unknown; ordering_data?: unknown } = {
      attempt_id: attemptId,
      question_id: questionId,
    };
    if (ans.optionId) row.option_id = ans.optionId;
    if (ans.text) row.text_answer = ans.text;
    if (ans.numeric !== undefined && ans.numeric !== '') row.numeric_answer = Number(ans.numeric);
    if (ans.payload) {
      row.answer_payload = ans.payload;
      if ('matches' in ans.payload) row.matching_data = ans.payload.matches;
      if ('order' in ans.payload) row.ordering_data = ans.payload.order;
    }
    const { error: persistErr } = await supabase.from('answers').upsert(row, { onConflict: 'attempt_id,question_id' });
    if (persistErr) setError(persistErr.message);
  }

  async function saveAnswers(showToast: boolean) {
    if (!activeAttempt || submissionStartedRef.current) return;
    const writes = Object.entries(answers).map(([questionId, ans]) => {
      const row: { attempt_id: string; question_id: string; option_id?: string; text_answer?: string; numeric_answer?: number; answer_payload?: Record<string, unknown>; matching_data?: unknown; ordering_data?: unknown } = {
        attempt_id: activeAttempt.id,
        question_id: questionId,
      };
      if (ans.optionId) row.option_id = ans.optionId;
      if (ans.text) row.text_answer = ans.text;
      if (ans.numeric) row.numeric_answer = Number(ans.numeric);
      if (ans.payload) {
        row.answer_payload = ans.payload;
        if ('matches' in ans.payload) row.matching_data = ans.payload.matches;
        if ('order' in ans.payload) row.ordering_data = ans.payload.order;
      }

      const pending = enqueueAnswerWrite(() => persistAnswer(activeAttempt.id, questionId, ans));
      trackAnswerWrite(pending);
      return pending;
    });
    const savePromise = Promise.all(writes).then(() => undefined);
    activeSavePromiseRef.current = savePromise;
    try {
      await savePromise;
    } finally {
      if (activeSavePromiseRef.current === savePromise) activeSavePromiseRef.current = null;
    }
    if (showToast) { /* could show toast */ }
  }

  function answersPayload() {
    return Object.entries(answers).map(([questionId, ans]) => {
      const payload: Record<string, unknown> = {
        question_id: questionId,
        option_id: ans.optionId ?? null,
        text_answer: ans.text ?? null,
        numeric_answer: ans.numeric ?? null,
      };
      if (ans.payload) payload.answer_payload = ans.payload;
      return payload;
    });
  }

  const syncQueuedSubmission = useCallback(async () => {
    if (!activeAttempt || !activeExam || !isOnline || !submissionQueued) {
      return;
    }
    const queued = readQueuedSubmission(activeAttempt.id);
    if (!queued) { setSubmissionQueued(false); setExamLocked(false); submissionStartedRef.current = false; return; }
    setSubmitting(true);
    const { data, error: err } = await supabase.rpc('submit_exam_attempt', {
      p_attempt_id: queued.attemptId,
      p_answers: Object.entries(queued.answers).map(([questionId, answer]) => ({ question_id: questionId, option_id: answer.optionId ?? null, text_answer: answer.text ?? null, numeric_answer: answer.numeric ?? null, ...(answer.payload ? { answer_payload: answer.payload } : {}) })),
      p_auto: queued.auto,
      p_time_remaining_seconds: queued.timeRemainingSeconds,
      p_offline_recovery_token: queued.recoveryToken,
    });
    if (err) { setError('Submission is queued until the connection is available.'); setSubmitting(false); return; }
    clearQueuedSubmission(activeAttempt.id);
    clearAttemptDraft(activeAttempt.id);
    setSubmissionQueued(false);
    setResult(data as SubmitAttemptResult);
    setSubmitting(false);
  }, [activeAttempt, activeExam, isOnline, submissionQueued]);

  useEffect(() => { void syncQueuedSubmission(); }, [syncQueuedSubmission]);

  function isQuestionAnswered(q: ExamQuestionItem) {
    const ans = answers[q.question_id];
    if (!ans) return false;
    if (q.questions.type === 'multiple_choice' || q.questions.type === 'true_false') return Boolean(ans.optionId);
    if (q.questions.type === 'short_answer' || q.questions.type === 'essay') return Boolean(ans.text?.trim());
    if (q.questions.type === 'numeric') return ans.numeric !== undefined && ans.numeric !== '';
    if (q.questions.type === 'fill_blank') {
      const blanks = advancedConfig(q).blanks ?? [];
      const values = (ans.payload?.blanks ?? {}) as Record<string, string>;
      return blanks.every((blank) => String(values[blank.id] ?? '').trim() !== '');
    }
    if (q.questions.type === 'matching') {
      const pairs = advancedConfig(q).pairs ?? [];
      const values = (ans.payload?.matches ?? {}) as Record<string, string>;
      return pairs.every((pair) => Boolean(values[pair.left_id]));
    }
    if (q.questions.type === 'ordering') {
      const items = advancedConfig(q).items ?? [];
      const order = (ans.payload?.order ?? []) as string[];
      return order.length === items.length && items.every((item) => order.includes(item.id));
    }
    return true;
  }

  async function handleSubmit(auto: boolean) {
    if (!activeAttempt || !activeExam) return;
    if (submissionStartedRef.current || examDeviceBlocked) return;
    const firstMissing = questions.findIndex((question) => ['fill_blank', 'matching', 'ordering'].includes(question.questions.type) && !isQuestionAnswered(question));
    if (!auto && firstMissing >= 0) {
      setCurrentQ(firstMissing);
      setError('أكمل إجابة السؤال الحالي قبل التسليم.');
      return;
    }
    submissionStartedRef.current = true;
    setExamLocked(true);
    setSubmitting(true);
    if (timerRef.current) clearInterval(timerRef.current);
    if (autoSaveRef.current) clearInterval(autoSaveRef.current);
    await flushPendingAnswerWrites();

    if (!navigator.onLine) {
      writeQueuedSubmission({ attemptId: activeAttempt.id, answers, auto, timeRemainingSeconds: timeLeft, recoveryToken: activeAttempt.offline_recovery_token });
      setSubmissionQueued(true);
      setError('Offline Mode — Answers saved locally. Submission queued until the connection is restored.');
      setSubmitting(false);
      return;
    }

    const { data, error: err } = await supabase.rpc('submit_exam_attempt', {
      p_attempt_id: activeAttempt.id,
      p_answers: answersPayload(),
      p_auto: auto,
       p_time_remaining_seconds: timeLeft,
       p_offline_recovery_token: activeAttempt.offline_recovery_token,
    });

    if (err) {
      if (!navigator.onLine) {
        writeQueuedSubmission({ attemptId: activeAttempt.id, answers, auto, timeRemainingSeconds: timeLeft, recoveryToken: activeAttempt.offline_recovery_token });
        setSubmissionQueued(true);
        setError('Offline Mode — Answers saved locally. Submission queued until the connection is restored.');
      } else {
        submissionStartedRef.current = false;
        setExamLocked(false);
        setError(err.message);
      }
      setSubmitting(false);
      return;
    }

    clearAttemptDraft(activeAttempt.id);
    clearQueuedSubmission(activeAttempt.id);
    setSubmissionQueued(false);
    setResult(data as SubmitAttemptResult);
    setSubmitting(false);
  }

  handleSubmitRef.current = handleSubmit;

  const registerViolation = useCallback(async (type: string, description: string) => {
    if (!activeAttempt || !activeExam || questions.length === 0 || submissionStartedRef.current) return;
    const now = Date.now();
    const last = violationCooldownRef.current.get(type) ?? 0;
    if (now - last < 5000) return;
    violationCooldownRef.current.set(type, now);
    const lastIncident = lastIncidentRef.current;
    const correlatedFocusEvent = lastIncident
      && now - lastIncident.at <= PROCTORING_DEDUPE_WINDOW_MS
      && ((lastIncident.type === 'WINDOW_BLUR' && type === 'TAB_SWITCH')
        || (lastIncident.type === 'TAB_SWITCH' && type === 'WINDOW_BLUR'));
    // Reserve the incident slot before awaiting the audit RPC so concurrent
    // blur/visibility events cannot both consume a strike.
    if (!correlatedFocusEvent) lastIncidentRef.current = { type, at: now };
    const { error: violationError } = await supabase.rpc('log_exam_violation', {
      p_attempt_id: activeAttempt.id,
      p_violation_type: type,
      p_description: description,
    });
    // A client event must not become an automatic submission strike unless the
    // server successfully records it. This prevents transient auth/DNS/RPC
    // failures from falsely exhausting an attempt.
    if (violationError) {
      setError('تعذر تسجيل مخالفة الامتحان. لم يتم احتسابها أو إرسال الامتحان تلقائيًا.');
      return;
    }
    if (correlatedFocusEvent) return;
    const nextStrike = strikeCountRef.current + 1;
    strikeCountRef.current = nextStrike;
    setStrikeCount(nextStrike);
    setActiveViolation({ type, description });
    if (nextStrike >= MAX_STRIKES && !violationAutoSubmitRef.current) {
      violationAutoSubmitRef.current = true;
      setActiveViolation({ type, description: 'Maximum violations reached. The exam is being submitted and locked.' });
      await handleSubmitRef.current(true);
    }
  }, [activeAttempt]);

  // Lockdown events are scoped to an active attempt and never intercept the
  // rest of the application.
  useEffect(() => {
    if (!activeAttempt || result || submissionStartedRef.current) return;
    const visibility = () => { if (document.visibilityState === 'hidden') void registerViolation('TAB_SWITCH', 'The exam tab was hidden or another tab was opened.'); };
    const blur = () => { if (document.visibilityState === 'visible') void registerViolation('WINDOW_BLUR', 'The exam window lost focus.'); };
    const fullscreen = () => { if (fullscreenRequestedRef.current && !document.fullscreenElement) void registerViolation('FULLSCREEN_EXIT', 'Fullscreen mode was exited during the exam.'); };
    const preventContext = (event: Event) => { event.preventDefault(); void registerViolation('CONTEXT_MENU', 'The context menu was opened during the exam.'); };
    const preventCopy = (event: Event) => { event.preventDefault(); void registerViolation('COPY_ATTEMPT', 'Copying exam content was blocked.'); };
    const preventPaste = (event: Event) => { event.preventDefault(); void registerViolation('PASTE_ATTEMPT', 'Pasting content into the exam was blocked.'); };
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('blur', blur);
    document.addEventListener('fullscreenchange', fullscreen);
    document.addEventListener('contextmenu', preventContext);
    document.addEventListener('copy', preventCopy);
    document.addEventListener('paste', preventPaste);
    return () => {
      document.removeEventListener('visibilitychange', visibility); window.removeEventListener('blur', blur);
      document.removeEventListener('fullscreenchange', fullscreen); document.removeEventListener('contextmenu', preventContext);
      document.removeEventListener('copy', preventCopy); document.removeEventListener('paste', preventPaste);
    };
  }, [activeAttempt, registerViolation, result]);

  // Camera frames stay in the browser. Only the derived face-count violation
  // is sent to Supabase.
  useEffect(() => {
    if (!activeAttempt || !activeExam || questions.length === 0 || result || !navigator.mediaDevices?.getUserMedia) return;
    let cancelled = false;
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;
    setCameraStatus('starting');
    void (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        if (cancelled) { stream.getTracks().forEach((track) => track.stop()); return; }
        const video = videoRef.current;
        if (!video) throw new Error('camera_video_unavailable');
        video.srcObject = stream;
        await video.play();
        const model = await blazeface.load();
        if (cancelled) return;
        setCameraStatus('active');
        const inspect = async () => {
          if (cancelled || video.readyState < 2) return;
          const faces = await model.estimateFaces(video, false);
          if (faces.length === 0) void registerViolation('NO_FACE', 'No face was detected by the local camera model.');
          if (faces.length > 1) void registerViolation('MULTIPLE_FACES', 'More than one face was detected by the local camera model.');
        };
        await inspect();
        timer = setInterval(() => { void inspect(); }, 4000);
      } catch {
        if (!cancelled) {
          setCameraStatus('unavailable');
          setError('تعذر تشغيل الكاميرا. يستمر الامتحان بدون تقييم الكاميرا.');
        }
      }
    })();
    return () => { cancelled = true; if (timer) clearInterval(timer); if (stream) stream.getTracks().forEach((track) => track.stop()); if (videoRef.current) videoRef.current.srcObject = null; setCameraStatus('inactive'); };
  }, [activeAttempt, activeExam, questions.length, registerViolation, result]);

  function exitExam() {
    setExamLocked(false);
    if (timerRef.current) clearInterval(timerRef.current);
    if (autoSaveRef.current) clearInterval(autoSaveRef.current);
    if (activeAttempt) clearAttemptDraft(activeAttempt.id);
    submissionStartedRef.current = false;
    setActiveExam(null);
    setActiveAttempt(null);
    setQuestions([]);
    setAnswers({});
    setResult(null);
    setStrikeCount(0);
    strikeCountRef.current = 0;
    lastIncidentRef.current = null;
    violationAutoSubmitRef.current = false;
    setActiveViolation(null);
    fullscreenRequestedRef.current = false;
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    loadExams();
  }

  if (loading) {
    return <div className="flex justify-center py-16"><Loader2 size={24} className="animate-spin text-brand-600" /></div>;
  }

  // Result screen
  if (result && activeExam) {
    return (
      <div className="max-w-2xl mx-auto">
        <Card className="p-8 text-center">
          <div className="w-20 h-20 rounded-full mx-auto mb-4 flex items-center justify-center bg-accent-50 text-accent-600">
            <CheckCircle2 size={40} />
          </div>
          <h2 className="font-display text-2xl font-800 text-ink-900 mb-2">تم تسليم الامتحان</h2>
          <p className="text-ink-500 mb-6">{activeExam.title}</p>
          {result.needs_manual_grading ? (
            <p className="text-sm text-ink-500 mb-4">تم تسليم الاختبار بنجاح، والنتيجة قيد المراجعة.</p>
          ) : (
            <div className="mb-5 rounded-xl border border-accent-100 bg-accent-50 p-4">
              <p className="text-sm text-accent-700 mb-1">تم التصحيح تلقائيًا</p>
              <p data-testid="exam-result-percentage" className="font-display text-3xl font-800 text-accent-700 nums-latin">{Number(result.score_percentage).toFixed(1)}%</p>
              <p data-testid="exam-result-score" className="text-xs text-accent-700 nums-latin mt-1">{Number(result.score).toFixed(2)} / {activeExam.total_points}</p>
              <p className={`text-sm font-700 mt-2 ${result.is_passed ? 'text-accent-700' : 'text-danger-700'}`}>{result.is_passed ? 'ناجح' : 'راسب'}</p>
            </div>
          )}
          <button onClick={exitExam} className="btn-primary">العودة للامتحانات</button>
        </Card>
      </div>
    );
  }

  // Exam taking screen
  if (activeExam && activeAttempt && questions.length > 0) {
    const q = questions[currentQ];
    const ans = answers[q.question_id] ?? {};
    const mins = Math.floor(timeLeft / 60);
    const secs = timeLeft % 60;
    const lowTime = timeLeft < 60;

    return (
      <div className="max-w-3xl mx-auto space-y-4">
        {error && (
          <div data-testid="exam-runner-error" className="flex items-center gap-2 p-3 rounded-xl bg-danger-50 border border-danger-200">
            <AlertCircle size={18} className="text-danger-600" />
            <p className="text-sm text-danger-700">{error}</p>
          </div>
        )}
        {examDeviceBlocked && (
          <div role="alert" className="rounded-xl border border-danger-300 bg-danger-50 p-4 text-sm font-700 text-danger-800">
            هذه المحاولة مرتبطة بجهاز آخر حاليًا. لا يمكن متابعة الإجابة من أكثر من جهاز في نفس الوقت.
          </div>
        )}
        {!isOnline && <div className="rounded-xl border border-warning-200 bg-warning-50 p-3 text-sm text-warning-800">Offline Mode — Answers saved locally.</div>}
        {submissionQueued && <div className="rounded-xl border border-brand-200 bg-brand-50 p-3 text-sm text-brand-800">Submission queued. It will sync automatically when the connection is restored.</div>}
        <video ref={videoRef} muted playsInline className="sr-only" aria-hidden="true" />
        <div className={`rounded-xl border p-2 text-xs ${cameraStatus === 'active' ? 'border-accent-200 bg-accent-50 text-accent-700' : 'border-warning-200 bg-warning-50 text-warning-800'}`}>
          Camera proctoring: {cameraStatus === 'active' ? 'active locally; no video is uploaded' : cameraStatus === 'starting' ? 'starting' : 'unavailable — camera violations cannot be evaluated'} · Strikes: {strikeCount}/{MAX_STRIKES}
        </div>
        {activeViolation && (
          <div role="alertdialog" aria-modal="true" className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-5">
            <Card className="w-full max-w-lg border-4 border-danger-500 p-7 text-center shadow-2xl">
              <AlertCircle size={52} className="mx-auto mb-3 text-danger-600" />
              <h2 className="text-2xl font-800 text-danger-700">Academic integrity warning</h2>
              <p className="mt-3 text-ink-700">{activeViolation.description}</p>
              <p className="mt-3 font-800 text-danger-700">Strike {strikeCount} of {MAX_STRIKES}</p>
              {strikeCount < MAX_STRIKES ? <button onClick={() => setActiveViolation(null)} className="btn-primary mt-5 bg-danger-600 hover:bg-danger-700">I understand — return to exam</button> : <p className="mt-5 text-sm font-700 text-danger-700">Maximum strikes reached. The exam is locked and submission is in progress.</p>}
            </Card>
          </div>
        )}
        {/* Header */}
        <Card className="p-4 sticky top-0 z-10">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <h3 className="font-700 text-ink-900 truncate">{activeExam.title}</h3>
              <p className="text-xs text-ink-400">سؤال {currentQ + 1} من {questions.length} · {q.points} نقطة</p>
            </div>
            <div className={`flex items-center gap-2 px-4 py-2 rounded-xl font-700 nums-latin ${lowTime ? 'bg-danger-50 text-danger-600 animate-pulse' : 'bg-ink-100 text-ink-700'}`}>
              <Clock size={18} />
              {String(mins).padStart(2, '0')}:{String(secs).padStart(2, '0')}
            </div>
          </div>
          {/* Progress bar */}
          <div className="mt-3 h-1.5 rounded-full bg-ink-100 overflow-hidden">
            <div className="h-full bg-brand-500 transition-all" style={{ width: `${((currentQ + 1) / questions.length) * 100}%` }} />
          </div>
        </Card>

        {/* Question */}
        <Card className={`p-6 ${examLocked ? 'pointer-events-none opacity-70' : ''}`}>
          <div className="flex items-center gap-2 mb-3">
            <Badge tone="brand">{TYPE_LABELS[q.questions.type] ?? q.questions.type}</Badge>
          </div>
          <p className="text-lg text-ink-900 mb-6 leading-relaxed">{q.questions.prompt}</p>

          {q.questions.image_url && (
            <img src={q.questions.image_url} alt="صورة السؤال" className="rounded-xl mb-4 max-h-64 object-contain" />
          )}

          {/* Answer input */}
          {(q.questions.type === 'multiple_choice' || q.questions.type === 'true_false') && q.options && (
            <div className="space-y-2">
              {q.options.map((opt) => (
                <button
                  key={opt.id}
                  onClick={() => setAnswer(q.question_id, 'optionId', opt.id)}
                  data-testid="exam-option"
                  className={`w-full text-right p-3.5 rounded-xl border-2 transition-all flex items-center gap-3 ${ans.optionId === opt.id ? 'border-brand-500 bg-brand-50' : 'border-ink-200 hover:border-ink-300'}`}
                >
                  <span className={`w-5 h-5 rounded-full border-2 shrink-0 ${ans.optionId === opt.id ? 'border-brand-500 bg-brand-500' : 'border-ink-300'}`} />
                  <span className="text-sm text-ink-800">{opt.label}</span>
                </button>
              ))}
            </div>
          )}

          {q.questions.type === 'short_answer' && (
            <input className="input" placeholder="اكتب إجابتك هنا..." value={ans.text ?? ''} onChange={(e) => setAnswer(q.question_id, 'text', e.target.value)} dir="auto" />
          )}

          {q.questions.type === 'numeric' && (
            <input type="number" step="any" className="input" placeholder="اكتب الرقم..." value={ans.numeric ?? ''} onChange={(e) => setAnswer(q.question_id, 'numeric', e.target.value)} dir="ltr" />
          )}

          {q.questions.type === 'essay' && (
            <textarea className="input min-h-[150px] resize-y" placeholder="اكتب إجابتك المقالية هنا..." value={ans.text ?? ''} onChange={(e) => setAnswer(q.question_id, 'text', e.target.value)} dir="auto" />
          )}

          {q.questions.type === 'fill_blank' && (
            <FillBlankQuestion
              question={q}
              answer={ans.payload}
              onChange={(payload) => setAnswerPayload(q.question_id, payload)}
            />
          )}

          {q.questions.type === 'matching' && (
            <MatchingQuestion
              question={q}
              answer={ans.payload}
              onChange={(payload) => setAnswerPayload(q.question_id, payload)}
            />
          )}

          {q.questions.type === 'ordering' && (
            <OrderingQuestion
              question={q}
              answer={ans.payload}
              onChange={(payload) => setAnswerPayload(q.question_id, payload)}
            />
          )}
        </Card>

        {/* Navigation */}
        <div className="flex items-center justify-between gap-3">
          <button data-testid="exam-prev-question" onClick={() => setCurrentQ((p) => Math.max(0, p - 1))} disabled={examLocked || currentQ === 0} className="btn-outline disabled:opacity-40">
            <ArrowRight size={18} /> السابق
          </button>

          {/* Question navigator */}
          <div className="flex gap-1.5 flex-wrap justify-center">
            {questions.map((qq, i) => {
              const answered = isQuestionAnswered(qq);
              return (
                <button
                  key={qq.id}
                  onClick={() => setCurrentQ(i)} disabled={examLocked}
                  className={`w-8 h-8 rounded-lg text-xs font-600 transition-all ${i === currentQ ? 'bg-brand-600 text-white' : answered ? 'bg-accent-100 text-accent-700' : 'bg-ink-100 text-ink-500'}`}
                >
                  {i + 1}
                </button>
              );
            })}
          </div>

          {currentQ < questions.length - 1 ? (
            <button data-testid="exam-next-question" onClick={() => setCurrentQ((p) => Math.min(questions.length - 1, p + 1))} disabled={examLocked} className="btn-primary">
              التالي <ArrowLeft size={18} />
            </button>
          ) : (
            <button data-testid="exam-submit" onClick={() => handleSubmit(false)} disabled={examLocked || submitting} className="btn-primary bg-accent-600 hover:bg-accent-700">
              {submitting ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
              تسليم
            </button>
          )}
        </div>
      </div>
    );
  }

  // Exam list
  return (
    <div className="space-y-5">
      <SectionHeader title="الامتحانات" subtitle="الامتحانات المتاحة لك" />

      {error && (
        <div className="flex items-center gap-2 p-3 rounded-xl bg-danger-50 border border-danger-200">
          <AlertCircle size={18} className="text-danger-600" />
          <p className="text-sm text-danger-700">{error}</p>
        </div>
      )}

      {exams.length === 0 ? (
        <Card><EmptyState icon={<FileText size={40} />} title="لا توجد امتحانات متاحة" subtitle="عند نشر معلمك امتحان، سيظهر هنا" /></Card>
      ) : (
        <div className="grid gap-3">
          {exams.map((exam) => {
            const examAttempts = attempts[exam.id] ?? [];
            const summary = attemptSummaries[exam.id];
            const completed = examAttempts.filter((a) => ['submitted', 'auto_submitted', 'graded', 'approved'].includes(a.status));
            const inProgress = summary?.has_in_progress
              ? examAttempts.find((a) => a.status === 'in_progress')
              : undefined;
            const attemptsUsed = summary?.attempts_used ?? 0;
            const attemptsRemaining = summary?.attempts_remaining ?? 0;
            const canStart = attemptsRemaining > 0;
            const now = Date.now();
            const notYetOpen = exam.start_at && new Date(exam.start_at).getTime() > now;
            const closed = exam.end_at && new Date(exam.end_at).getTime() < now;

            return (
              <Card key={exam.id} hover className="p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <h3 className="font-700 text-ink-900 mb-1">{exam.title}</h3>
                    {exam.description && <p className="text-sm text-ink-500 line-clamp-2 mb-2">{exam.description}</p>}
                    <div className="flex flex-wrap items-center gap-3 text-xs text-ink-400">
                      <span className="flex items-center gap-1"><Clock size={12} /> {exam.duration_minutes} دقيقة</span>
                      <span>{exam.total_points} درجة</span>
                      <span>نجاح: {exam.passing_score}</span>
                      <span>محاولات: {attemptsUsed}/{summary?.max_attempts ?? exam.max_attempts}</span>
                      {exam.start_at && <span>· يبدأ: {new Date(exam.start_at).toLocaleString('ar')}</span>}
                    </div>
                  </div>
                  <div className="shrink-0">
                    {inProgress ? (
                      <button data-testid="exam-start" onClick={() => startExam(exam)} className="btn-primary">استكمال</button>
                    ) : notYetOpen ? (
                      <Badge tone="warning">لم يبدأ بعد</Badge>
                    ) : closed ? (
                      <Badge tone="danger">انتهى</Badge>
                    ) : !canStart ? (
                      <Badge tone="neutral">استنفدت المحاولات</Badge>
                    ) : (
                      <button data-testid="exam-start" onClick={() => startExam(exam)} className="btn-primary">بدء الامتحان</button>
                    )}
                  </div>
                </div>
                {attemptsUsed > 0 && (
                  <div className="mt-3 pt-3 border-t border-ink-100">
                    {completed.length > 0 ? completed.map((a, i) => (
                      <div key={a.id} className="flex items-center gap-2 text-xs text-ink-500">
                        <span>المحاولة {i + 1}:</span>
                        {a.is_result_published ? (
                          <span className="nums-latin">{a.score_percentage?.toFixed(1)}% — {a.is_passed ? 'ناجح' : 'راسب'}</span>
                        ) : (
                          <span>بانتظار النشر</span>
                        )}
                      </div>
                    )) : (
                      <div className="text-xs text-ink-500">تم التسليم — النتيجة قيد المراجعة</div>
                    )}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

function FillBlankQuestion({ question, answer, onChange }: { question: ExamQuestionItem; answer?: Record<string, unknown>; onChange: (payload: Record<string, unknown>) => void }) {
  const blanks = advancedConfig(question).blanks ?? [];
  const values = (answer?.blanks ?? {}) as Record<string, string>;

  function updateBlank(blankId: string, value: string) {
    onChange({ ...(answer ?? {}), blanks: { ...values, [blankId]: value } });
  }

  return (
    <div className="space-y-3">
      {blanks.map((blank, index) => (
        <label key={blank.id} data-testid="exam-fill-blank" className="block">
          <span className="label">الفراغ {index + 1}</span>
          <input
            data-testid={`exam-fill-blank-${blank.id}`}
            className="input"
            value={values[blank.id] ?? ''}
            onChange={(event) => updateBlank(blank.id, event.target.value)}
            dir="auto"
          />
        </label>
      ))}
    </div>
  );
}

function MatchingQuestion({ question, answer, onChange }: { question: ExamQuestionItem; answer?: Record<string, unknown>; onChange: (payload: Record<string, unknown>) => void }) {
  const pairs = advancedConfig(question).pairs ?? [];
  const leftItems = stableShuffle(pairs.map((pair) => ({ left_id: pair.left_id, left: pair.left })), `${question.question_id}:left`);
  const rightItems = stableShuffle(pairs.map((pair) => ({ right_id: pair.right_id, right: pair.right })), `${question.question_id}:right`);
  const matches = (answer?.matches ?? {}) as Record<string, string>;

  function updateMatch(leftId: string, rightId: string) {
    onChange({ ...(answer ?? {}), matches: { ...matches, [leftId]: rightId } });
  }

  return (
    <div className="space-y-3">
      {leftItems.map((left) => (
        <label key={left.left_id} data-testid="exam-matching-row" className="grid gap-2 md:grid-cols-[1fr_1fr] md:items-center rounded-xl border border-ink-100 bg-ink-50 p-3">
          <span className="text-sm font-700 text-ink-800">{left.left}</span>
          <select
            data-testid={`exam-matching-${left.left_id}`}
            className="input !py-2"
            value={matches[left.left_id] ?? ''}
            onChange={(event) => updateMatch(left.left_id, event.target.value)}
          >
            <option value="">اختر الإجابة المطابقة</option>
            {rightItems.map((right) => (
              <option key={right.right_id} value={right.right_id}>{right.right}</option>
            ))}
          </select>
        </label>
      ))}
    </div>
  );
}

function OrderingQuestion({ question, answer, onChange }: { question: ExamQuestionItem; answer?: Record<string, unknown>; onChange: (payload: Record<string, unknown>) => void }) {
  const items = advancedConfig(question).items ?? [];
  const initialOrder = stableShuffle(items, `${question.question_id}:order`).map((item) => item.id);
  const currentOrder = ((answer?.order ?? initialOrder) as string[]).filter((id) => items.some((item) => item.id === id));
  const missing = initialOrder.filter((id) => !currentOrder.includes(id));
  const order = [...currentOrder, ...missing];
  const byId = new Map(items.map((item) => [item.id, item]));

  function commit(nextOrder: string[]) {
    onChange({ ...(answer ?? {}), order: nextOrder });
  }

  useEffect(() => {
    if (!answer?.order && items.length > 0) commit(order);
    // The initial order is derived from the question id and should be committed once per question.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [question.question_id]);

  function move(index: number, direction: -1 | 1) {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= order.length) return;
    const next = [...order];
    [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
    commit(next);
  }

  function handleDrop(sourceId: string, targetId: string) {
    if (sourceId === targetId) return;
    const next = [...order];
    const from = next.indexOf(sourceId);
    const to = next.indexOf(targetId);
    if (from < 0 || to < 0) return;
    next.splice(from, 1);
    next.splice(to, 0, sourceId);
    commit(next);
  }

  return (
    <div className="space-y-2">
      {order.map((id, index) => {
        const item = byId.get(id);
        if (!item) return null;
        return (
          <div
            key={id}
            data-testid="exam-ordering-item"
            draggable
            onDragStart={(event) => event.dataTransfer.setData('text/plain', id)}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => handleDrop(event.dataTransfer.getData('text/plain'), id)}
            className="grid grid-cols-[auto_1fr_auto_auto] items-center gap-2 rounded-xl border border-ink-100 bg-white p-3"
          >
            <span className="grid place-items-center w-7 h-7 rounded-lg bg-ink-100 text-xs font-700 text-ink-500 nums-latin">{index + 1}</span>
            <span className="text-sm text-ink-800">{item.label}</span>
            <button type="button" data-testid="exam-order-up" onClick={() => move(index, -1)} disabled={index === 0} className="btn-ghost !py-1 !px-2 text-xs disabled:opacity-40">أعلى</button>
            <button type="button" data-testid="exam-order-down" onClick={() => move(index, 1)} disabled={index === order.length - 1} className="btn-ghost !py-1 !px-2 text-xs disabled:opacity-40">أسفل</button>
          </div>
        );
      })}
    </div>
  );
}
