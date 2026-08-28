import { useState, useEffect, useCallback } from 'react';
import { Plus, Search, Trash2, Edit3, Loader2, AlertCircle, Clock, Calendar, Send, X, Check, Zap } from 'lucide-react';
import { Card, SectionHeader, Badge, EmptyState } from '../components/ui';
import { supabase, useAuthSafe } from '../lib/auth-helpers';
import type { UserRole } from '../lib/auth';
import { ar, getArabicErrorMessage } from '../lib/translate';

interface ExamRow {
  id: string;
  title: string;
  description: string | null;
  instructions: string | null;
  subject_id: string | null;
  class_id: string | null;
  total_points: number;
  passing_score: number;
  duration_minutes: number;
  start_at: string | null;
  end_at: string | null;
  max_attempts: number;
  shuffle_questions: boolean;
  shuffle_options: boolean;
  show_result_immediately: boolean;
  show_correct_answers: boolean;
  status: string;
  created_at: string;
}

interface SubjectRow { id: string; name: string; is_active: boolean; }
interface ClassRow { id: string; name: string; grade_level_id: string | null; branch_id: string | null; academic_year: string; academic_year_id?: string | null; is_active: boolean; }
interface SectionRow { id: string; name: string; class_id: string; is_active: boolean; }
interface GradeSubjectRow { id: string; academic_year_id: string; grade_level_id: string; subject_id: string; class_id: string | null; is_active: boolean; }
interface SubjectTeacherRow { id: string; subject_id: string; class_id: string; teacher_id: string; section_id: string | null; is_active: boolean; }
interface QuestionRow { id: string; type: string; prompt: string; difficulty: string; points: number; }
interface ExamQuestionRow { id: string; question_id: string; points: number; sort_order: number; questions: { prompt: string; type: string; }; }

function addMinutesToDateTimeLocal(value: string, minutes: number) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const next = new Date(date.getTime() + minutes * 60_000);
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${next.getFullYear()}-${pad(next.getMonth() + 1)}-${pad(next.getDate())}T${pad(next.getHours())}:${pad(next.getMinutes())}`;
}

function minutesBetween(start: string, end: string) {
  const difference = new Date(end).getTime() - new Date(start).getTime();
  return Number.isFinite(difference) && difference > 0 ? Math.round(difference / 60_000) : null;
}

function toDateTimeLocal(value: string | null | undefined) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

const STATUS_LABELS: Record<string, { label: string; tone: 'neutral' | 'brand' | 'accent' | 'warning' | 'danger' }> = {
  draft: { label: ar.statuses.exam.draft, tone: 'neutral' },
  scheduled: { label: ar.statuses.exam.scheduled, tone: 'warning' },
  published: { label: ar.statuses.exam.published, tone: 'accent' },
  archived: { label: ar.statuses.exam.archived, tone: 'neutral' },
};

export function ExamBuilder() {
  const { institutionId, role, user } = useAuthSafe();
  const canEdit = ['super_admin', 'school_admin', 'teacher'].includes(role as UserRole);
  const [exams, setExams] = useState<ExamRow[]>([]);
  const [subjects, setSubjects] = useState<SubjectRow[]>([]);
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [sections, setSections] = useState<SectionRow[]>([]);
  const [gradeSubjects, setGradeSubjects] = useState<GradeSubjectRow[]>([]);
  const [teacherAssignments, setTeacherAssignments] = useState<SubjectTeacherRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [showEditor, setShowEditor] = useState(false);
  const [showQuickExam, setShowQuickExam] = useState(false);
  const [editing, setEditing] = useState<ExamRow | null>(null);

  const loadMeta = useCallback(async () => {
    if (!institutionId) return;
    const [subRes, classRes, sectionRes, gradeSubjectRes] = await Promise.all([
      supabase.from('subjects').select('id, name, is_active').eq('institution_id', institutionId).order('name'),
      supabase.from('classes').select('id, name, grade_level_id, branch_id, academic_year, academic_year_id, is_active').eq('institution_id', institutionId).eq('is_active', true).order('name'),
      supabase.from('sections').select('id, name, class_id, is_active').eq('is_active', true).order('name'),
      supabase.from('grade_subjects').select('id, academic_year_id, grade_level_id, subject_id, class_id, is_active').eq('institution_id', institutionId).eq('is_active', true),
    ]);
    if (subRes.error) console.error('Subjects load failed', subRes.error);
    if (classRes.error) console.error('Classes load failed', classRes.error);
    if (sectionRes.error) console.error('Sections load failed', sectionRes.error);
    if (subRes.data) setSubjects(subRes.data as SubjectRow[]);
    let visibleClasses = (classRes.data as ClassRow[]) ?? [];
    let visibleSubjects = (subRes.data as SubjectRow[]) ?? [];
    let assignments: SubjectTeacherRow[] = [];
    if (role === 'teacher' && user) {
      const { data: staff } = await supabase.from('staff_profiles').select('id').eq('user_id', user.id).maybeSingle();
      const teacherId = (staff as { id?: string } | null)?.id;
      if (teacherId) {
        const { data: assignmentData } = await supabase
          .from('subject_teachers')
          .select('id, subject_id, class_id, teacher_id, section_id, is_active')
          .eq('teacher_id', teacherId)
          .eq('is_active', true);
        assignments = (assignmentData as SubjectTeacherRow[]) ?? [];
        const classIds = new Set(assignments.map((item) => item.class_id));
        const subjectIds = new Set(assignments.map((item) => item.subject_id));
        visibleClasses = visibleClasses.filter((item) => classIds.has(item.id));
        visibleSubjects = visibleSubjects.filter((item) => subjectIds.has(item.id));
      }
    }
    setSubjects(visibleSubjects);
    setClasses(visibleClasses);
    if (sectionRes.data) setSections(sectionRes.data as SectionRow[]);
    if (gradeSubjectRes.data) setGradeSubjects(gradeSubjectRes.data as GradeSubjectRow[]);
    setTeacherAssignments(assignments);
  }, [institutionId, role, user]);

  const loadExams = useCallback(async () => {
    if (!institutionId) return false;
    setLoading(true);
    setError(null);
    let query = supabase
      .from('examify_exams')
      .select('*')
      .eq('institution_id', institutionId)
      .order('created_at', { ascending: false });
    if (filterStatus !== 'all') query = query.eq('status', filterStatus);
    if (search.trim()) query = query.ilike('title', `%${search.trim()}%`);
    const { data, error: err } = await query;
    if (err) {
      console.error('Exams load failed', err);
      setError(getArabicErrorMessage(err));
      setLoading(false);
      return false;
    }
    setExams((data as ExamRow[]) ?? []);
    setLoading(false);
    return true;
  }, [institutionId, filterStatus, search]);

  useEffect(() => { loadMeta(); }, [loadMeta]);
  useEffect(() => { loadExams(); }, [loadExams]);

  const activeSubjects = subjects.filter((subject) => subject.is_active);

  async function handleDelete(id: string) {
    if (!confirm(ar.examBuilder.deleteConfirm)) return;
    const { error: err } = await supabase.from('examify_exams').delete().eq('id', id);
    if (err) {
      console.error('Exam delete failed', err);
      setError(getArabicErrorMessage(err));
      return;
    }
    setExams((prev) => prev.filter((exam) => exam.id !== id));
  }

  async function handleStatusChange(id: string, status: string) {
    if (status === 'published') {
      const [{ data: exam, error: examError }, { count, error: questionsError }] = await Promise.all([
        supabase.from('examify_exams').select('title, subject_id, total_points, passing_score, duration_minutes').eq('id', id).single(),
        supabase.from('exam_questions').select('id', { count: 'exact', head: true }).eq('exam_id', id),
      ]);
      if (examError || questionsError) { setError(getArabicErrorMessage(examError || questionsError)); return; }
      if (!exam?.title?.trim() || !exam.subject_id || Number(exam.total_points) <= 0 || Number(exam.passing_score) < 0 || Number(exam.passing_score) > Number(exam.total_points) || Number(exam.duration_minutes) <= 0 || !count) {
        setError('لا يمكن نشر الامتحان قبل اختيار المادة وإضافة سؤال واحد على الأقل والتأكد من صحة الدرجات والمدة.');
        return;
      }
      if (!confirm('هل تريد نشر الامتحان الآن؟')) return;
    }
    const { error: err } = await supabase.from('examify_exams').update({ status }).eq('id', id);
    if (err) {
      console.error('Exam status update failed', err);
      setError(getArabicErrorMessage(err));
      return;
    }
    setExams((prev) => prev.map((exam) => exam.id === id ? { ...exam, status } : exam));
  }

  if (!institutionId) {
    return <div className="card p-8 text-center text-ink-500">{ar.questionBank.loadingInstitution}</div>;
  }

  return (
    <div className="space-y-5">
      <SectionHeader
        title={ar.examBuilder.title}
        subtitle={ar.examBuilder.subtitle}
        action={canEdit && (
          <button data-testid="exam-add" onClick={() => { setEditing(null); setShowEditor(true); }} className="btn-primary">
            <Plus size={16} /> {ar.examBuilder.newExam}
          </button>
        )}
      />

      {canEdit && (
        <Card className="p-4 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div>
            <h3 className="font-700 text-ink-900">{ar.examBuilder.quickExam}</h3>
            <p className="text-sm text-ink-500 mt-1">{ar.examBuilder.quickExamDescription}</p>
          </div>
          <button data-testid="quick-exam-open" onClick={() => setShowQuickExam(true)} className="btn-primary shrink-0">
            <Zap size={16} /> {ar.examBuilder.startQuickExam}
          </button>
        </Card>
      )}

      {error && (
        <div className="flex items-center gap-2 p-3 rounded-xl bg-danger-50 border border-danger-200">
          <AlertCircle size={18} className="text-danger-600" />
          <p className="text-sm text-danger-700">{error}</p>
        </div>
      )}

      <Card className="p-4">
        <div className="flex flex-wrap gap-3 items-center">
          <div className="flex items-center gap-2 flex-1 min-w-[200px]">
            <Search size={16} className="text-ink-400" />
            <input className="input !py-2" placeholder={ar.examBuilder.searchPlaceholder} value={search} onChange={(event) => setSearch(event.target.value)} />
          </div>
          <select className="input !py-2 !w-auto" value={filterStatus} onChange={(event) => setFilterStatus(event.target.value)}>
            <option value="all">{ar.common.allStatuses}</option>
            {Object.entries(STATUS_LABELS).map(([value, status]) => <option key={value} value={value}>{status.label}</option>)}
          </select>
        </div>
      </Card>

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 size={24} className="animate-spin text-brand-600" /></div>
      ) : exams.length === 0 ? (
        <Card><EmptyState icon={<Calendar size={40} />} title={ar.examBuilder.noExams} subtitle={ar.examBuilder.noExamsSubtitle} /></Card>
      ) : (
        <div className="grid gap-3">
          {exams.map((exam) => {
            const status = STATUS_LABELS[exam.status] ?? STATUS_LABELS.draft;
            const subject = subjects.find((item) => item.id === exam.subject_id);
            const cls = classes.find((item) => item.id === exam.class_id);
            return (
              <Card key={exam.id} hover className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="font-700 text-ink-900 truncate">{exam.title}</h3>
                      <Badge tone={status.tone}>{status.label}</Badge>
                    </div>
                    {exam.description && <p className="text-sm text-ink-500 line-clamp-1 mb-2">{exam.description}</p>}
                    <div className="flex flex-wrap items-center gap-3 text-xs text-ink-400">
                      {subject && <span>{subject.name}</span>}
                      {cls && <span>{cls.name}</span>}
                      <span className="flex items-center gap-1"><Clock size={12} /> {exam.duration_minutes} {ar.common.minutes}</span>
                      <span>{exam.total_points} {ar.common.points}</span>
                      <span>{ar.examBuilder.passingScore}: {exam.passing_score}</span>
                      <span>{ar.examBuilder.attempts}: {exam.max_attempts}</span>
                      {exam.start_at && <span>{new Date(exam.start_at).toLocaleDateString('ar')}</span>}
                    </div>
                  </div>
                  {canEdit && (
                    <div className="flex gap-1 shrink-0">
                      {exam.status === 'draft' && (
                        <button onClick={() => handleStatusChange(exam.id, 'published')} className="grid place-items-center w-8 h-8 rounded-lg text-accent-600 hover:bg-accent-50" title={ar.examBuilder.publish}><Send size={16} /></button>
                      )}
                      {exam.status === 'published' && (
                        <button onClick={() => handleStatusChange(exam.id, 'draft')} className="grid place-items-center w-8 h-8 rounded-lg text-warning-600 hover:bg-warning-50" title={ar.examBuilder.pause}><X size={16} /></button>
                      )}
                      <button onClick={() => { setEditing(exam); setShowEditor(true); }} className="grid place-items-center w-8 h-8 rounded-lg text-ink-400 hover:bg-ink-100 hover:text-ink-700" title={ar.common.edit}><Edit3 size={16} /></button>
                      <button onClick={() => handleDelete(exam.id)} className="grid place-items-center w-8 h-8 rounded-lg text-ink-400 hover:bg-danger-50 hover:text-danger-600" title={ar.common.delete}><Trash2 size={16} /></button>
                    </div>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {showEditor && (
        <ExamEditor
          institutionId={institutionId}
          subjects={editing ? subjects.filter((subject) => subject.is_active || subject.id === editing.subject_id) : activeSubjects}
          classes={classes}
          sections={sections}
          gradeSubjects={gradeSubjects}
          teacherAssignments={teacherAssignments}
          editing={editing}
          onClose={() => setShowEditor(false)}
          onSaved={async () => {
            const refreshed = await loadExams();
            if (!refreshed) throw new Error('Unable to refresh the exam list after saving.');
            setShowEditor(false);
            setEditing(null);
          }}
        />
      )}
      {showQuickExam && (
        <QuickExamModal
          institutionId={institutionId}
          subjects={activeSubjects}
          classes={classes}
          sections={sections}
          gradeSubjects={gradeSubjects}
          teacherAssignments={teacherAssignments}
          onClose={() => setShowQuickExam(false)}
          onSaved={() => { setShowQuickExam(false); loadExams(); }}
        />
      )}
    </div>
  );
}

interface EditorProps {
  institutionId: string;
  subjects: SubjectRow[];
  classes: ClassRow[];
  sections: SectionRow[];
  gradeSubjects: GradeSubjectRow[];
  teacherAssignments: SubjectTeacherRow[];
  editing: ExamRow | null;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}

function ExamEditor({ institutionId, subjects, classes, sections, gradeSubjects, teacherAssignments, editing, onClose, onSaved }: EditorProps) {
  const [title, setTitle] = useState(editing?.title ?? '');
  const [description, setDescription] = useState(editing?.description ?? '');
  const [instructions, setInstructions] = useState(editing?.instructions ?? '');
  const [subjectId, setSubjectId] = useState(editing?.subject_id ?? '');
  const [classId, setClassId] = useState(editing?.class_id ?? '');
  const [sectionId, setSectionId] = useState('');
  const [totalPoints, setTotalPoints] = useState(editing?.total_points ?? 100);
  const [passingScore, setPassingScore] = useState(editing?.passing_score ?? 50);
  const [duration, setDuration] = useState(editing?.duration_minutes ?? 60);
  const [startAt, setStartAt] = useState(toDateTimeLocal(editing?.start_at));
  const [endAt, setEndAt] = useState(toDateTimeLocal(editing?.end_at));
  const [maxAttempts, setMaxAttempts] = useState(editing?.max_attempts ?? 1);
  const [shuffleQ, setShuffleQ] = useState(editing?.shuffle_questions ?? false);
  const [shuffleO, setShuffleO] = useState(editing?.shuffle_options ?? false);
  const [showResult, setShowResult] = useState(editing?.show_result_immediately ?? false);
  const [showAnswers, setShowAnswers] = useState(editing?.show_correct_answers ?? false);
  const [status, setStatus] = useState(editing?.status ?? 'draft');
  const [saving, setSaving] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'details' | 'questions'>('details');
  const [examId, setExamId] = useState<string | null>(editing?.id ?? null);
  const [bankQuestions, setBankQuestions] = useState<QuestionRow[]>([]);
  const [examQuestions, setExamQuestions] = useState<ExamQuestionRow[]>([]);
  const [questionSearch, setQuestionSearch] = useState('');
  const [inlineType, setInlineType] = useState<'multiple_choice' | 'true_false' | 'short_answer' | 'numeric' | 'essay'>('multiple_choice');
  const [inlinePrompt, setInlinePrompt] = useState('');
  const [inlineOptions, setInlineOptions] = useState(['', '', '', '']);
  const [inlineCorrect, setInlineCorrect] = useState(0);
  const [inlineTextAnswer, setInlineTextAnswer] = useState('');
  const [inlineNumericAnswer, setInlineNumericAnswer] = useState('');
  const [inlinePoints, setInlinePoints] = useState(1);
  const [inlineSaving, setInlineSaving] = useState(false);
  const visibleSections = classId ? sections.filter((section) => section.class_id === classId) : [];
  const visibleSubjects = classId
    ? subjects.filter((subject) => {
      const classRow = classes.find((item) => item.id === classId);
      const assignedToGrade = gradeSubjects.some((item) =>
        item.subject_id === subject.id
        && item.grade_level_id === classRow?.grade_level_id
        && item.academic_year_id === classRow?.academic_year_id
        && (!item.class_id || item.class_id === classId)
      );
      const assignedToTeacher = teacherAssignments.length === 0 || teacherAssignments.some((item) => item.subject_id === subject.id && item.class_id === classId);
      return assignedToGrade && assignedToTeacher;
    })
    : subjects;

  const loadBankQuestions = useCallback(async () => {
    if (!institutionId || !subjectId) return;
    const { data } = await supabase
      .from('questions')
      .select('id, type, prompt, difficulty, points')
      .eq('institution_id', institutionId)
      .eq('subject_id', subjectId)
      .ilike('prompt', `%${questionSearch}%`)
      .order('created_at', { ascending: false })
      .limit(50);
    setBankQuestions((data as QuestionRow[]) ?? []);
  }, [institutionId, subjectId, questionSearch]);

  const loadExamQuestions = useCallback(async () => {
    if (!examId) return;
    const { data } = await supabase
      .from('exam_questions')
      .select('id, question_id, points, sort_order, questions!inner(prompt, type)')
      .eq('exam_id', examId)
      .order('sort_order');
    setExamQuestions((data as unknown as ExamQuestionRow[]) ?? []);
  }, [examId]);

  useEffect(() => { if (examId) loadExamQuestions(); }, [examId, loadExamQuestions]);
  useEffect(() => { loadBankQuestions(); }, [loadBankQuestions]);

  async function handleSaveDetails() {
    setSaving(true);
    setError(null);
    if (!title.trim()) { setError(ar.examBuilder.examTitleRequired); setSaving(false); return; }
    if (!subjectId) { setError('اختر المادة قبل حفظ الامتحان.'); setSaving(false); return; }
    if (!Number.isFinite(Number(totalPoints)) || Number(totalPoints) <= 0) { setError('الدرجة النهائية يجب أن تكون أكبر من صفر.'); setSaving(false); return; }
    if (!Number.isFinite(Number(passingScore)) || Number(passingScore) < 0 || Number(passingScore) > Number(totalPoints)) { setError('درجة النجاح يجب أن تكون بين صفر والدرجة النهائية.'); setSaving(false); return; }
    if (!Number.isFinite(Number(duration)) || Number(duration) <= 0) { setError('مدة الامتحان يجب أن تكون أكبر من صفر دقيقة.'); setSaving(false); return; }
    if (!Number.isInteger(Number(maxAttempts)) || Number(maxAttempts) < 1) { setError('عدد المحاولات يجب أن يكون رقمًا صحيحًا يبدأ من 1.'); setSaving(false); return; }
    if (endAt && !startAt) { setError('حدد وقت البداية أولًا قبل وقت النهاية.'); setSaving(false); return; }
    if (startAt && endAt && !minutesBetween(startAt, endAt)) { setError('وقت النهاية يجب أن يكون بعد وقت البداية.'); setSaving(false); return; }

    const examData = {
      institution_id: institutionId,
      subject_id: subjectId || null,
      class_id: classId || null,
      title: title.trim(),
      description: description || null,
      instructions: instructions || null,
      total_points: Number(totalPoints),
      passing_score: Number(passingScore),
      duration_minutes: Number(duration),
      start_at: startAt ? new Date(startAt).toISOString() : null,
      end_at: endAt ? new Date(endAt).toISOString() : null,
      max_attempts: Number(maxAttempts),
      shuffle_questions: shuffleQ,
      shuffle_options: shuffleO,
      show_result_immediately: showResult,
      show_correct_answers: showAnswers,
      status,
    };

    try {
      if (editing) {
        const { error: err } = await supabase.from('examify_exams').update(examData).eq('id', editing.id);
        if (err) throw err;
        setExamId(editing.id);
      } else {
        const { data, error: err } = await supabase.from('examify_exams').insert(examData).select('id').single();
        if (err) throw err;
        setExamId((data as { id: string }).id);
      }
      setTab('questions');
    } catch (error) {
      console.error('Exam save failed', error);
      setError(getArabicErrorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  async function handleAddQuestion(questionId: string, points: number) {
    if (!examId || examQuestions.some((question) => question.question_id === questionId)) return false;
    const { error: err } = await supabase.from('exam_questions').insert({
      exam_id: examId,
      question_id: questionId,
      points,
      sort_order: examQuestions.length,
    });
    if (err) { console.error('Exam question add failed', err); setError(getArabicErrorMessage(err)); return false; }
    await loadExamQuestions();
    return true;
  }

  async function handleCreateInlineQuestion() {
    if (!examId || !subjectId) { setError('احفظ بيانات الامتحان واختر المادة أولاً.'); return; }
    if (!inlinePrompt.trim()) { setError('اكتب نص السؤال أولاً.'); return; }
    if (inlineType === 'multiple_choice' && inlineOptions.some((option) => !option.trim())) { setError('اكتب جميع الاختيارات الأربعة.'); return; }
    setInlineSaving(true);
    setError(null);
    try {
      if (inlineType !== 'multiple_choice') {
        const metadata = inlineType === 'short_answer'
          ? { correct_answer: inlineTextAnswer.trim().toLowerCase() }
          : inlineType === 'numeric' ? { correct_answer: inlineNumericAnswer.trim() } : {};
        if (inlineType === 'short_answer' && !inlineTextAnswer.trim()) throw new Error('اكتب الإجابة النموذجية.');
        if (inlineType === 'numeric' && !inlineNumericAnswer.trim()) throw new Error('اكتب الإجابة الرقمية.');
        const { data: question, error: questionError } = await supabase.from('questions').insert({
          institution_id: institutionId,
          subject_id: subjectId,
          type: inlineType,
          prompt: inlinePrompt.trim(),
          difficulty: 'medium',
          points: Number(inlinePoints) || 1,
          metadata,
        }).select('id').single();
        if (questionError) throw questionError;
        if (inlineType === 'true_false') {
          const { error: optionsError } = await supabase.from('question_options').insert([
            { question_id: question.id, label: 'صح', is_correct: inlineCorrect === 0, sort_order: 0 },
            { question_id: question.id, label: 'خطأ', is_correct: inlineCorrect === 1, sort_order: 1 },
          ]);
          if (optionsError) throw optionsError;
        }
        const added = await handleAddQuestion(question.id, Number(inlinePoints) || 1);
        if (!added) await supabase.from('questions').delete().eq('id', question.id);
        if (added) {
          setInlinePrompt('');
          setInlineTextAnswer('');
          setInlineNumericAnswer('');
          setInlineCorrect(0);
        }
        return;
      }
      const { data, error: saveError } = await supabase.rpc('save_multiple_choice_question', {
        p_question_id: null,
        p_institution_id: institutionId,
        p_subject_id: subjectId,
        p_prompt: inlinePrompt.trim(),
        p_difficulty: 'medium',
        p_points: Number(inlinePoints) || 1,
        p_unit: null,
        p_lesson: null,
        p_explanation: null,
        p_metadata: {},
        p_options: inlineOptions.map((label, index) => ({ label: label.trim(), is_correct: index === inlineCorrect })),
      });
      if (saveError) throw saveError;
      const savedQuestion = (data as { question?: { id?: string } } | null)?.question;
      if (!savedQuestion?.id) throw new Error('تعذر معرفة السؤال المحفوظ.');
      const added = await handleAddQuestion(savedQuestion.id, Number(inlinePoints) || 1);
      if (added) {
        setInlinePrompt('');
        setInlineOptions(['', '', '', '']);
        setInlineCorrect(0);
      }
    } catch (createError) {
      console.error('Inline question save failed', createError);
      setError(getArabicErrorMessage(createError));
    } finally {
      setInlineSaving(false);
    }
  }

  async function handleRemoveQuestion(examQuestionId: string) {
    const { error: err } = await supabase.from('exam_questions').delete().eq('id', examQuestionId);
    if (err) { console.error('Exam question remove failed', err); setError(getArabicErrorMessage(err)); return; }
    loadExamQuestions();
  }

  async function handleAssignClass() {
    if (!examId || !classId) return;
    let existingQuery = supabase.from('exam_assignments').select('id').eq('exam_id', examId).eq('class_id', classId);
    existingQuery = sectionId ? existingQuery.eq('section_id', sectionId) : existingQuery.is('section_id', null);
    const { data: existing } = await existingQuery.maybeSingle();
    if (existing) { setError('هذا الامتحان مُعيّن بالفعل لهذا الفصل.'); return; }
    const { error: err } = await supabase.from('exam_assignments').insert({ exam_id: examId, class_id: classId, section_id: sectionId || null });
    if (err) { console.error('Exam assignment failed', err); setError(getArabicErrorMessage(err)); return; }
    alert(ar.examBuilder.assignedToClass);
  }

  async function handleDone() {
    if (saving || finishing) return;
    if (!examId) {
      setError(ar.examBuilder.examTitleRequired);
      return;
    }
    if (!subjectId || !examQuestions.length) {
      setError('أكمل بيانات الامتحان وأضف سؤالًا واحدًا على الأقل قبل الإنهاء.');
      return;
    }

    setFinishing(true);
    setError(null);
    try {
      await loadExamQuestions();
      await onSaved();
    } catch (finishError) {
      console.error('Exam finish failed', finishError);
      setError(getArabicErrorMessage(finishError));
    } finally {
      setFinishing(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-ink-950/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div className="card w-full max-w-3xl max-h-[90vh] overflow-y-auto" onClick={(event) => event.stopPropagation()}>
        <div className="sticky top-0 bg-white border-b border-ink-100 px-6 py-4 flex items-center justify-between">
          <h3 className="font-display text-lg font-700 text-ink-900">{editing ? ar.examBuilder.editExam : ar.examBuilder.newExam}</h3>
          <button type="button" onClick={onClose} className="text-ink-400 hover:text-ink-700 text-xl"><X size={20} /></button>
        </div>

        <div className="px-6 pt-4">
          <div className="flex gap-1 p-1 rounded-xl bg-ink-100">
            <button type="button" onClick={() => setTab('details')} className={`flex-1 py-2 rounded-lg text-sm font-600 ${tab === 'details' ? 'bg-white shadow-sm' : 'text-ink-500'}`}>{ar.examBuilder.details}</button>
            <button type="button" onClick={() => setTab('questions')} disabled={!examId} className={`flex-1 py-2 rounded-lg text-sm font-600 disabled:opacity-40 ${tab === 'questions' ? 'bg-white shadow-sm' : 'text-ink-500'}`}>{ar.examBuilder.questions}</button>
          </div>
        </div>

        <div className="p-6 space-y-4">
          {error && <div className="flex items-center gap-2 p-3 rounded-xl bg-danger-50 border border-danger-200"><AlertCircle size={18} className="text-danger-600" /><p className="text-sm text-danger-700">{error}</p></div>}

          {tab === 'details' && (
            <>
              <div>
                <label className="label">{ar.examBuilder.examTitle}</label>
                <input data-testid="exam-title" className="input" value={title} onChange={(event) => setTitle(event.target.value)} placeholder={ar.examBuilder.examTitlePlaceholder} />
              </div>
              <div>
                <label className="label">{ar.examBuilder.shortDescription}</label>
                <input className="input" value={description} onChange={(event) => setDescription(event.target.value)} placeholder={ar.examBuilder.descriptionPlaceholder} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">{ar.examBuilder.subject}</label>
                  <select data-testid="exam-subject" className="input" value={subjectId} onChange={(event) => setSubjectId(event.target.value)}>
                    <option value="">{ar.examBuilder.selectSubject}</option>
                    {visibleSubjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">{ar.examBuilder.class}</label>
                  <select data-testid="exam-class" className="input" value={classId} onChange={(event) => { setClassId(event.target.value); setSectionId(''); }}>
                    <option value="">{ar.examBuilder.selectClass}</option>
                    {classes.map((classRow) => <option key={classRow.id} value={classRow.id}>{classRow.name} - {classRow.academic_year}</option>)}
                  </select>
                </div>
              </div>
              {classId && (
                <div>
                  <label className="label">{ar.examBuilder.section}</label>
                  <select data-testid="exam-section" className="input" value={sectionId} onChange={(event) => setSectionId(event.target.value)}>
                    <option value="">{ar.examBuilder.allSections}</option>
                    {visibleSections.map((section) => <option key={section.id} value={section.id}>{section.name}</option>)}
                  </select>
                </div>
              )}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">{ar.examBuilder.totalMarks}</label>
                  <input type="number" className="input" value={totalPoints} onChange={(event) => setTotalPoints(Number(event.target.value))} />
                </div>
                <div>
                  <label className="label">{ar.examBuilder.passingScore}</label>
                  <input type="number" className="input" value={passingScore} onChange={(event) => setPassingScore(Number(event.target.value))} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">{ar.examBuilder.duration}</label>
                  <input type="number" min="1" className="input" value={duration} onChange={(event) => { const nextDuration = Math.max(1, Number(event.target.value) || 1); setDuration(nextDuration); if (startAt) setEndAt(addMinutesToDateTimeLocal(startAt, nextDuration)); }} />
                </div>
                <div>
                  <label className="label">{ar.examBuilder.attempts}</label>
                  <input type="number" min="1" className="input" value={maxAttempts} onChange={(event) => setMaxAttempts(Number(event.target.value))} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">{ar.examBuilder.startDate}</label>
                  <input type="datetime-local" className="input" value={startAt ? startAt.slice(0, 16) : ''} onChange={(event) => { const nextStart = event.target.value; setStartAt(nextStart); if (nextStart) setEndAt(addMinutesToDateTimeLocal(nextStart, duration)); }} />
                </div>
                <div>
                  <label className="label">{ar.examBuilder.endDate}</label>
                  <input type="datetime-local" className="input" min={startAt ? startAt.slice(0, 16) : undefined} value={endAt ? endAt.slice(0, 16) : ''} onChange={(event) => { const nextEnd = event.target.value; const nextDuration = startAt ? minutesBetween(startAt, nextEnd) : null; if (nextDuration) { setEndAt(nextEnd); setDuration(nextDuration); } else if (!nextEnd) { setEndAt(''); } else { setError('وقت النهاية يجب أن يكون بعد وقت البداية.'); } }} />
                </div>
              </div>
              <div>
                <label className="label">{ar.examBuilder.instructions}</label>
                <textarea className="input min-h-[60px] resize-y" value={instructions} onChange={(event) => setInstructions(event.target.value)} placeholder={ar.examBuilder.instructionsPlaceholder} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <label className="flex items-center gap-2 cursor-pointer text-sm"><input type="checkbox" checked={shuffleQ} onChange={(event) => setShuffleQ(event.target.checked)} /> {ar.examBuilder.shuffleQuestions}</label>
                <label className="flex items-center gap-2 cursor-pointer text-sm"><input type="checkbox" checked={shuffleO} onChange={(event) => setShuffleO(event.target.checked)} /> {ar.examBuilder.shuffleOptions}</label>
                <label className="flex items-center gap-2 cursor-pointer text-sm"><input type="checkbox" checked={showResult} onChange={(event) => setShowResult(event.target.checked)} /> {ar.examBuilder.showResultImmediately}</label>
                <label className="flex items-center gap-2 cursor-pointer text-sm"><input type="checkbox" checked={showAnswers} onChange={(event) => setShowAnswers(event.target.checked)} /> {ar.examBuilder.showCorrectAnswers}</label>
              </div>
              <div>
                <label className="label">{ar.examBuilder.examStatus}</label>
                <select data-testid="exam-status" className="input" value={status} onChange={(event) => setStatus(event.target.value)}>
                  {Object.entries(STATUS_LABELS).map(([value, item]) => <option key={value} value={value}>{item.label}</option>)}
                </select>
              </div>
              <button type="button" data-testid="exam-save-details" onClick={handleSaveDetails} disabled={saving} className="btn-primary w-full">
                {saving ? <Loader2 size={16} className="animate-spin" /> : null}
                {editing ? ar.questionBank.saveChanges : ar.examBuilder.saveAndContinue}
              </button>
            </>
          )}

          {tab === 'questions' && (
            <>
              {classId && (
                <div className="flex items-center gap-2 p-3 rounded-xl bg-brand-50 border border-brand-100">
                  <Check size={16} className="text-brand-600" />
                  <span className="text-sm text-brand-700">{ar.examBuilder.classAssignmentNotice}</span>
                  <button type="button" data-testid="exam-assign-class" onClick={handleAssignClass} className="btn-ghost !py-1 !px-2 text-xs mr-auto">{ar.examBuilder.assignToClass}</button>
                </div>
              )}

              <div>
                <h4 className="text-sm font-700 text-ink-800 mb-2">{ar.examBuilder.addedQuestions} ({examQuestions.length})</h4>
                {examQuestions.length === 0 ? (
                  <p className="text-xs text-ink-400 p-3">{ar.examBuilder.noAddedQuestions}</p>
                ) : (
                  <div className="space-y-2">
                    {examQuestions.map((examQuestion, index) => (
                      <div key={examQuestion.id} className="flex items-center gap-2 p-2 rounded-lg bg-ink-50 border border-ink-100">
                        <span className="text-xs font-700 text-ink-400 w-6">{index + 1}</span>
                        <span className="text-sm text-ink-800 flex-1 truncate">{examQuestion.questions?.prompt ?? ar.examBuilder.deletedQuestion}</span>
                        <span className="text-xs text-ink-400">{examQuestion.points} {ar.common.points}</span>
                        <button type="button" onClick={() => handleRemoveQuestion(examQuestion.id)} className="text-ink-400 hover:text-danger-600"><X size={14} /></button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="pt-4 border-t border-ink-100">
                <div className="rounded-xl border border-brand-100 bg-brand-50/60 p-4 mb-4">
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div><h4 className="text-sm font-700 text-brand-900">اكتب سؤالًا مباشرة</h4><p className="text-xs text-brand-700 mt-1">سيُحفظ السؤال في بنك الأسئلة ويُضاف للامتحان تلقائيًا.</p></div>
                     <select className="input !py-1.5 !w-auto text-xs" value={inlineType} onChange={(event) => setInlineType(event.target.value as typeof inlineType)} aria-label="نوع السؤال">
                       <option value="multiple_choice">اختيار من متعدد</option>
                       <option value="true_false">صح أو خطأ</option>
                       <option value="short_answer">إجابة قصيرة</option>
                       <option value="numeric">إجابة رقمية</option>
                       <option value="essay">مقالي</option>
                     </select>
                  </div>
                  <textarea data-testid="exam-inline-question" className="input min-h-[72px] resize-y mb-2" value={inlinePrompt} onChange={(event) => setInlinePrompt(event.target.value)} placeholder="اكتب نص السؤال هنا..." />
                   {inlineType === 'multiple_choice' && <div className="grid sm:grid-cols-2 gap-2">
                     {inlineOptions.map((option, index) => <div key={index} className="flex items-center gap-2"><input type="radio" name="inline-correct" checked={inlineCorrect === index} onChange={() => setInlineCorrect(index)} aria-label={`الإجابة الصحيحة ${index + 1}`} /><input data-testid={`exam-inline-option-${index}`} className="input !py-2" value={option} onChange={(event) => setInlineOptions((items) => items.map((item, i) => i === index ? event.target.value : item))} placeholder={`الاختيار ${index + 1}`} /></div>)}
                   </div>}
                   {inlineType === 'true_false' && <div className="flex gap-5 text-sm py-2"><label className="flex items-center gap-2"><input type="radio" name="inline-correct" checked={inlineCorrect === 0} onChange={() => setInlineCorrect(0)} /> صح</label><label className="flex items-center gap-2"><input type="radio" name="inline-correct" checked={inlineCorrect === 1} onChange={() => setInlineCorrect(1)} /> خطأ</label></div>}
                   {inlineType === 'short_answer' && <input className="input" value={inlineTextAnswer} onChange={(event) => setInlineTextAnswer(event.target.value)} placeholder="الإجابة النموذجية" />}
                   {inlineType === 'numeric' && <input type="number" step="any" className="input nums-latin" value={inlineNumericAnswer} onChange={(event) => setInlineNumericAnswer(event.target.value)} placeholder="الإجابة الرقمية" />}
                   {inlineType === 'essay' && <p className="text-xs text-brand-700 py-2">سيتم تصحيح السؤال المقالي يدويًا أو بالتصحيح الذكي.</p>}
                  <div className="flex flex-col sm:flex-row gap-2 mt-3">
                    <input className="input sm:max-w-[140px] nums-latin" type="number" min="0.25" step="0.25" value={inlinePoints} onChange={(event) => setInlinePoints(Number(event.target.value))} aria-label="درجة السؤال" />
                    <button type="button" data-testid="exam-inline-save" onClick={() => void handleCreateInlineQuestion()} disabled={inlineSaving} className="btn-primary flex-1 disabled:opacity-60">{inlineSaving ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />} حفظ وإضافة للامتحان</button>
                  </div>
                </div>
                <h4 className="text-sm font-700 text-ink-800 mb-2">{ar.examBuilder.bankQuestions}</h4>
                {!subjectId ? (
                  <p className="text-xs text-ink-400">{ar.examBuilder.chooseSubjectFirst}</p>
                ) : (
                  <>
                    <input data-testid="exam-question-search" className="input !py-2 mb-2" placeholder={ar.examBuilder.searchBankPlaceholder} value={questionSearch} onChange={(event) => setQuestionSearch(event.target.value)} />
                    <div className="space-y-2 max-h-[300px] overflow-y-auto">
                      {bankQuestions.map((question) => (
                        <div key={question.id} className="flex items-center gap-2 p-2 rounded-lg border border-ink-100 hover:bg-ink-50">
                          <span className="text-sm text-ink-800 flex-1 truncate">{question.prompt}</span>
                          <span className="text-xs text-ink-400">{question.points} {ar.common.points}</span>
                        <button type="button" data-testid="exam-bank-add-question" onClick={() => void handleAddQuestion(question.id, question.points)} disabled={examQuestions.some((item) => item.question_id === question.id)} className="btn-ghost !py-1 !px-2 text-xs disabled:opacity-50"><Plus size={14} /> {examQuestions.some((item) => item.question_id === question.id) ? 'تمت الإضافة' : ar.common.add}</button>
                        </div>
                      ))}
                      {bankQuestions.length === 0 && <p className="text-xs text-ink-400 p-2">{ar.examBuilder.noBankQuestions}</p>}
                    </div>
                  </>
                )}
              </div>

              <button type="button" data-testid="exam-editor-done" onClick={handleDone} disabled={finishing || saving} className="btn-primary w-full disabled:opacity-60">
                {finishing ? <Loader2 size={16} className="animate-spin" /> : null}
                {ar.common.done}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function QuickExamModal({
  institutionId,
  subjects,
  classes,
  sections,
  gradeSubjects,
  teacherAssignments,
  onClose,
  onSaved,
}: {
  institutionId: string;
  subjects: SubjectRow[];
  classes: ClassRow[];
  sections: SectionRow[];
  gradeSubjects: GradeSubjectRow[];
  teacherAssignments: SubjectTeacherRow[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState(`${ar.examBuilder.quickTitlePrefix} ${new Date().toLocaleDateString('ar')}`);
  const [subjectId, setSubjectId] = useState(subjects[0]?.id ?? '');
  const [classId, setClassId] = useState('');
  const [sectionId, setSectionId] = useState('');
  const [questionsCount, setQuestionsCount] = useState(20);
  const [choicesCount, setChoicesCount] = useState(4);
  const [answersText, setAnswersText] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const choices = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'].slice(0, choicesCount);
  const visibleSections = classId ? sections.filter((section) => section.class_id === classId) : [];
  const visibleSubjects = classId
    ? subjects.filter((subject) => {
      const classRow = classes.find((item) => item.id === classId);
      const assignedToGrade = gradeSubjects.some((item) =>
        item.subject_id === subject.id
        && item.grade_level_id === classRow?.grade_level_id
        && item.academic_year_id === classRow?.academic_year_id
        && (!item.class_id || item.class_id === classId)
      );
      const assignedToTeacher = teacherAssignments.length === 0 || teacherAssignments.some((item) => item.subject_id === subject.id && item.class_id === classId);
      return assignedToGrade && assignedToTeacher;
    })
    : subjects;

  function parseAnswerKey() {
    const compact = answersText
      .toUpperCase()
      .replace(/[^A-H]/g, '')
      .split('')
      .slice(0, questionsCount);
    const answers: string[] = [];
    for (let i = 0; i < questionsCount; i++) answers.push(compact[i] ?? '');
    return answers;
  }

  async function handleCreate() {
    const answerKey = parseAnswerKey();
    setError(null);

    if (!title.trim()) { setError(ar.examBuilder.examTitleRequired); return; }
    if (questionsCount < 1 || questionsCount > 200) { setError(ar.examBuilder.questionsRangeError); return; }
    if (choicesCount < 2 || choicesCount > 8) { setError(ar.examBuilder.choicesRangeError); return; }
    if (answerKey.some((answer) => !choices.includes(answer))) { setError(ar.examBuilder.answerKeyError); return; }

    setSaving(true);
    try {
      const totalPoints = questionsCount;
      const { data: exam, error: examError } = await supabase.from('examify_exams').insert({
        institution_id: institutionId,
        subject_id: subjectId || null,
        class_id: classId || null,
        title: title.trim(),
        description: ar.examBuilder.quickCreatedDescription,
        instructions: null,
        total_points: totalPoints,
        passing_score: Math.ceil(totalPoints * 0.5),
        duration_minutes: Math.max(30, questionsCount),
        max_attempts: 1,
        shuffle_questions: false,
        shuffle_options: false,
        show_result_immediately: false,
        show_correct_answers: false,
        status: 'draft',
      }).select('id').single();
      if (examError) throw examError;

      const examId = (exam as { id: string }).id;
      const questionRows = answerKey.map((answer, index) => ({
        institution_id: institutionId,
        subject_id: subjectId || null,
        type: 'multiple_choice',
        prompt: `${ar.examBuilder.quickQuestionPrompt} ${index + 1}`,
        difficulty: 'medium',
        points: 1,
        metadata: { quick_exam: true, answer },
      }));

      const { data: insertedQuestions, error: questionsError } = await supabase
        .from('questions')
        .insert(questionRows)
        .select('id');
      if (questionsError) throw questionsError;

      const questionIds = ((insertedQuestions as { id: string }[]) ?? []).map((question) => question.id);
      if (questionIds.length !== questionsCount) throw new Error(ar.examBuilder.quickQuestionsCreateFailed);

      const optionRows = questionIds.flatMap((questionId, questionIndex) => (
        choices.map((label, sortOrder) => ({
          question_id: questionId,
          label,
          is_correct: label === answerKey[questionIndex],
          sort_order: sortOrder,
        }))
      ));
      const examQuestionRows = questionIds.map((questionId, index) => ({
        exam_id: examId,
        question_id: questionId,
        points: 1,
        sort_order: index,
      }));

      const [optionsResult, examQuestionsResult, sheetResult] = await Promise.all([
        supabase.from('question_options').insert(optionRows),
        supabase.from('exam_questions').insert(examQuestionRows),
        supabase.from('bubble_sheets').insert({
          institution_id: institutionId,
          exam_id: examId,
          model_label: 'A',
          questions_count: questionsCount,
          choices_count: choicesCount,
          include_student_id: true,
          include_student_name: true,
          include_qr: true,
        }),
      ]);
      if (optionsResult.error) throw optionsResult.error;
      if (examQuestionsResult.error) throw examQuestionsResult.error;
      if (sheetResult.error) throw sheetResult.error;

      if (classId) {
        await supabase.from('exam_assignments').insert({ exam_id: examId, class_id: classId, section_id: sectionId || null });
      }

      onSaved();
    } catch (error) {
      console.error('Quick exam create failed', error);
      setError(getArabicErrorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-ink-950/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div className="card w-full max-w-2xl max-h-[90vh] overflow-y-auto" onClick={(event) => event.stopPropagation()}>
        <div className="sticky top-0 bg-white border-b border-ink-100 px-6 py-4 flex items-center justify-between">
          <h3 className="font-display text-lg font-700 text-ink-900">{ar.examBuilder.quickExam}</h3>
          <button onClick={onClose} className="text-ink-400 hover:text-ink-700 text-xl"><X size={20} /></button>
        </div>
        <div className="p-6 space-y-4">
          {error && <div className="flex items-center gap-2 p-3 rounded-xl bg-danger-50 border border-danger-200"><AlertCircle size={18} className="text-danger-600" /><p className="text-sm text-danger-700">{error}</p></div>}
          <div>
            <label className="label">{ar.examBuilder.examTitle}</label>
            <input className="input" value={title} onChange={(event) => setTitle(event.target.value)} />
          </div>
          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <label className="label">{ar.examBuilder.subject}</label>
              <select className="input" value={subjectId} onChange={(event) => setSubjectId(event.target.value)}>
                <option value="">{ar.examBuilder.noSubject}</option>
                {visibleSubjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.name}</option>)}
              </select>
            </div>
            <div>
              <label className="label">{ar.examBuilder.class}</label>
              <select className="input" value={classId} onChange={(event) => { setClassId(event.target.value); setSectionId(''); }}>
                <option value="">{ar.examBuilder.noClassAssignment}</option>
                {classes.map((classRow) => <option key={classRow.id} value={classRow.id}>{classRow.name} - {classRow.academic_year}</option>)}
              </select>
            </div>
          </div>
          {classId && (
            <div>
              <label className="label">{ar.examBuilder.section}</label>
              <select className="input" value={sectionId} onChange={(event) => setSectionId(event.target.value)}>
                <option value="">{ar.examBuilder.allSections}</option>
                {visibleSections.map((section) => <option key={section.id} value={section.id}>{section.name}</option>)}
              </select>
            </div>
          )}
          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <label className="label">{ar.examBuilder.questionsCount}</label>
              <input type="number" min="1" max="200" className="input" value={questionsCount} onChange={(event) => setQuestionsCount(Number(event.target.value))} />
            </div>
            <div>
              <label className="label">{ar.examBuilder.choicesCount}</label>
              <input type="number" min="2" max="8" className="input" value={choicesCount} onChange={(event) => setChoicesCount(Number(event.target.value))} />
            </div>
          </div>
          <div>
            <label className="label">{ar.examBuilder.answerKey}</label>
            <textarea
              className="input min-h-[120px] resize-y font-mono nums-latin"
              dir="ltr"
              value={answersText}
              onChange={(event) => setAnswersText(event.target.value)}
              placeholder={`${ar.examBuilder.answerKeyPlaceholder} ${choices.join('')}${choices.join('')}`}
            />
            <p className="text-xs text-ink-400 mt-1">{ar.examBuilder.answerKeyHint}</p>
          </div>
          <div className="card-soft p-3 text-sm text-ink-600">
            {questionsCount || 0} - {ar.examBuilder.quickSummary}
          </div>
          <button onClick={handleCreate} disabled={saving} className="btn-primary w-full disabled:opacity-60">
            {saving ? <Loader2 size={16} className="animate-spin" /> : <Zap size={16} />}
            {ar.examBuilder.createQuickExam}
          </button>
        </div>
      </div>
    </div>
  );
}
