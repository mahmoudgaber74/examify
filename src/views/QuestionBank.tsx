import { useState, useEffect, useCallback, useMemo } from 'react';
import { Plus, Search, Trash2, Edit3, Loader2, AlertCircle, BookOpen, Filter, CheckCircle2, Copy, Eye, X, ListChecks, FileQuestion, Layers3, Upload, FileUp } from 'lucide-react';
import { Card, SectionHeader, Badge, EmptyState } from '../components/ui';
import { supabase, useAuthSafe } from '../lib/auth-helpers';
import type { UserRole } from '../lib/auth';
import { ar, getArabicErrorMessage } from '../lib/translate';
import { extractQuestionFile, parseImportedQuestions, type ImportedQuestion } from '../lib/question-import';

interface QuestionRow {
  id: string;
  type: string;
  prompt: string;
  difficulty: string;
  points: number;
  unit: string | null;
  lesson: string | null;
  subject_id: string | null;
  explanation: string | null;
  metadata: Record<string, unknown> | null;
}

interface OptionRow {
  id: string;
  label: string;
  is_correct: boolean;
  sort_order: number;
}

interface SubjectRow { id: string; name: string; is_active: boolean; }
interface FillBlankRow { id: string; acceptedAnswers: string; caseSensitive: boolean; ignoreExtraSpaces: boolean; }
interface MatchingPairRow { leftId: string; left: string; rightId: string; right: string; }
interface OrderingItemRow { id: string; label: string; }

type AdvancedConfig = {
  blanks?: { id: string; accepted_answers: string[]; case_sensitive: boolean; ignore_extra_spaces: boolean }[];
  pairs?: { left_id: string; left: string; right_id: string; right: string }[];
  items?: { id: string; label: string }[];
  partial_credit?: boolean;
  one_to_one?: boolean;
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

const ADVANCED_TYPES = ['fill_blank', 'matching', 'ordering'];
const EDITABLE_TYPES = ['multiple_choice', 'true_false', 'short_answer', 'essay', 'numeric', ...ADVANCED_TYPES];
const TYPE_OPTIONS = Object.entries(TYPE_LABELS).map(([value, label]) => ({
  value,
  label,
  disabled: false,
}));

const DIFFICULTY_LABELS: Record<string, { label: string; tone: 'accent' | 'warning' | 'danger' }> = {
  easy: { label: ar.difficulty.easy, tone: 'accent' },
  medium: { label: ar.difficulty.medium, tone: 'warning' },
  hard: { label: ar.difficulty.hard, tone: 'danger' },
};

function advancedConfigFromQuestion(question: QuestionRow | null): AdvancedConfig {
  const config = question?.metadata?.advanced_config;
  return config && typeof config === 'object' ? config as AdvancedConfig : {};
}

function defaultFillBlanks(): FillBlankRow[] {
  return [{ id: 'blank_1', acceptedAnswers: '', caseSensitive: false, ignoreExtraSpaces: true }];
}

function defaultMatchingPairs(): MatchingPairRow[] {
  return [
    { leftId: 'left_1', left: '', rightId: 'right_1', right: '' },
    { leftId: 'left_2', left: '', rightId: 'right_2', right: '' },
  ];
}

function defaultOrderingItems(): OrderingItemRow[] {
  return [
    { id: 'item_1', label: '' },
    { id: 'item_2', label: '' },
  ];
}

export function QuestionBank() {
  const { institutionId, role } = useAuthSafe();
  const canEdit = ['super_admin', 'school_admin', 'teacher'].includes(role as UserRole);
  const [questions, setQuestions] = useState<QuestionRow[]>([]);
  const [subjects, setSubjects] = useState<SubjectRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [filterSubject, setFilterSubject] = useState('all');
  const [filterType, setFilterType] = useState('all');
  const [filterDifficulty, setFilterDifficulty] = useState('all');
  const [showEditor, setShowEditor] = useState(false);
  const [viewing, setViewing] = useState<QuestionRow | null>(null);
  const [editing, setEditing] = useState<QuestionRow | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [importText, setImportText] = useState('');
  const [importFileName, setImportFileName] = useState('');
  const [importQuestions, setImportQuestions] = useState<ImportedQuestion[]>([]);
  const [importSubject, setImportSubject] = useState('');
  const [importDifficulty, setImportDifficulty] = useState('medium');
  const [importPoints, setImportPoints] = useState(1);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);

  const loadSubjects = useCallback(async () => {
    if (!institutionId) return;
    const { data, error: err } = await supabase
      .from('subjects')
      .select('id, name, is_active')
      .eq('institution_id', institutionId)
      .order('name');
    if (err) { console.error('Question bank subjects load failed', err); setError(getArabicErrorMessage(err)); return; }
    setSubjects((data as SubjectRow[]) ?? []);
  }, [institutionId]);

  const loadQuestions = useCallback(async () => {
    if (!institutionId) return;
    setLoading(true);
    setError(null);
    let query = supabase
      .from('questions')
      .select('id, type, prompt, difficulty, points, unit, lesson, subject_id, explanation, metadata')
      .eq('institution_id', institutionId)
      .order('created_at', { ascending: false });
    if (filterSubject !== 'all') query = query.eq('subject_id', filterSubject);
    if (filterType !== 'all') query = query.eq('type', filterType);
    if (filterDifficulty !== 'all') query = query.eq('difficulty', filterDifficulty);
    if (search.trim()) query = query.ilike('prompt', `%${search.trim()}%`);
    const { data, error: err } = await query;
    if (err) { console.error('Question bank load failed', err); setError(getArabicErrorMessage(err)); setLoading(false); return; }
    setQuestions((data as QuestionRow[]) ?? []);
    setLoading(false);
  }, [institutionId, filterDifficulty, filterSubject, filterType, search]);

  useEffect(() => { loadSubjects(); }, [loadSubjects]);
  useEffect(() => { loadQuestions(); }, [loadQuestions]);

  const editorSubjects = useMemo(() => (
    editing ? subjects.filter((subject) => subject.is_active || subject.id === editing.subject_id) : subjects.filter((subject) => subject.is_active)
  ), [editing, subjects]);

  const stats = useMemo(() => {
    const totalPoints = questions.reduce((sum, q) => sum + Number(q.points || 0), 0);
    const mcq = questions.filter((q) => q.type === 'multiple_choice').length;
    const withSubject = questions.filter((q) => q.subject_id).length;
    return { total: questions.length, totalPoints, mcq, withSubject };
  }, [questions]);

  async function handleDelete(id: string) {
    if (!confirm(ar.questionBank.deleteConfirm)) return;
    const { error: err } = await supabase.from('questions').delete().eq('id', id);
    if (err) { console.error('Question delete failed', err); setError(getArabicErrorMessage(err)); return; }
    setQuestions((prev) => prev.filter((q) => q.id !== id));
  }

  async function handleDuplicate(q: QuestionRow) {
    const { data, error: err } = await supabase
      .from('questions')
      .insert({
        institution_id: institutionId,
        subject_id: q.subject_id,
        type: q.type,
        prompt: `${q.prompt} (نسخة)`,
        difficulty: q.difficulty,
        points: q.points,
        unit: q.unit,
        lesson: q.lesson,
        explanation: q.explanation,
        metadata: q.metadata ?? {},
      })
      .select('id')
      .single();
    if (err) { console.error('Question duplicate failed', err); setError(getArabicErrorMessage(err)); return; }

    const { data: options } = await supabase.from('question_options').select('label, is_correct, sort_order').eq('question_id', q.id);
    if (options?.length && data) {
      await supabase.from('question_options').insert(options.map((option) => ({ ...option, question_id: (data as { id: string }).id })));
    }
    loadQuestions();
  }

  function handleEdit(q: QuestionRow) {
    setEditing(q);
    setShowEditor(true);
  }

  function handleNew() {
    setEditing(null);
    setShowEditor(true);
  }

  function openImport() {
    setImportText('');
    setImportFileName('');
    setImportQuestions([]);
    setImportSubject(editorSubjects[0]?.id ?? '');
    setImportError(null);
    setShowImport(true);
  }

  async function handleImportFile(file: File) {
    setImportError(null);
    setImportFileName(file.name);
    try {
      const text = await extractQuestionFile(file);
      setImportText(text);
      setImportQuestions(parseImportedQuestions(text));
    } catch (e) {
      setImportError(e instanceof Error ? e.message : 'تعذر قراءة الملف.');
      setImportQuestions([]);
    }
  }

  function reparseImportText() {
    const parsed = parseImportedQuestions(importText);
    setImportQuestions(parsed);
    setImportError(parsed.length ? null : 'لم يتم العثور على أسئلة. استخدم الترقيم مثل 1. أو 2.');
  }

  async function saveImportedQuestions() {
    if (!importSubject) { setImportError('اختر المادة أولاً.'); return; }
    if (!importQuestions.length) { setImportError('لا توجد أسئلة جاهزة للاستيراد.'); return; }
    setImporting(true);
    setImportError(null);
    let saved = 0;
    try {
      for (const question of importQuestions) {
        const { data, error: questionError } = await supabase.from('questions').insert({
          institution_id: institutionId,
          subject_id: importSubject,
          type: question.options.length >= 2 ? 'multiple_choice' : 'short_answer',
          prompt: question.prompt,
          difficulty: importDifficulty,
          points: importPoints,
          metadata: {},
        }).select('id').single();
        if (questionError) throw questionError;
        if (question.options.length >= 2 && data) {
          const { error: optionsError } = await supabase.from('question_options').insert(question.options.map((option) => ({ ...option, question_id: (data as { id: string }).id })));
          if (optionsError) throw optionsError;
        }
        saved += 1;
      }
      setShowImport(false);
      await loadQuestions();
    } catch (e) {
      setImportError(`تم حفظ ${saved} من ${importQuestions.length}. ${getArabicErrorMessage(e)}`);
    } finally {
      setImporting(false);
    }
  }

  function handleSaved() {
    setShowEditor(false);
    setEditing(null);
    loadQuestions();
  }

  if (!institutionId) {
    return <div className="card p-8 text-center text-ink-500">{ar.questionBank.loadingInstitution}</div>;
  }

  return (
    <div className="space-y-5">
      <SectionHeader
        title={ar.questionBank.title}
        subtitle={ar.questionBank.subtitle}
        action={canEdit && (
          <div className="flex flex-wrap gap-2">
            <button data-testid="question-import" onClick={openImport} className="btn-outline"><Upload size={16} /> استيراد PDF / Word</button>
            <button data-testid="question-add" onClick={handleNew} className="btn-primary"><Plus size={16} /> {ar.questionBank.addQuestion}</button>
          </div>
        )}
      />

      {error && (
        <div className="flex items-center gap-2 p-3 rounded-xl bg-danger-50 border border-danger-200">
          <AlertCircle size={18} className="text-danger-600" />
          <p className="text-sm text-danger-700">{error}</p>
          <button onClick={() => setError(null)} className="mr-auto text-xs text-ink-400">{ar.common.close}</button>
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Metric icon={<FileQuestion size={18} />} label={ar.questionBank.metrics.questions} value={stats.total} />
        <Metric icon={<ListChecks size={18} />} label={ar.questionBank.metrics.mcq} value={stats.mcq} />
        <Metric icon={<Layers3 size={18} />} label={ar.questionBank.metrics.withSubject} value={stats.withSubject} />
        <Metric icon={<CheckCircle2 size={18} />} label={ar.questionBank.metrics.totalPoints} value={stats.totalPoints} />
      </div>

      <Card className="p-4">
        <div className="grid gap-3 lg:grid-cols-[1fr_auto_auto_auto]">
          <div className="flex items-center gap-2 min-w-0">
            <Search size={16} className="text-ink-400 shrink-0" />
            <input data-testid="question-search" className="input !py-2" placeholder={ar.questionBank.searchPlaceholder} value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select className="input !py-2 lg:!w-48" value={filterSubject} onChange={(e) => setFilterSubject(e.target.value)}>
            <option value="all">{ar.questionBank.allSubjects}</option>
            {subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <select className="input !py-2 lg:!w-48" value={filterType} onChange={(e) => setFilterType(e.target.value)}>
            <option value="all">{ar.questionBank.allTypes}</option>
            {Object.entries(TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <select className="input !py-2 lg:!w-40" value={filterDifficulty} onChange={(e) => setFilterDifficulty(e.target.value)}>
            <option value="all">{ar.questionBank.difficulty}</option>
            {Object.entries(DIFFICULTY_LABELS).map(([v, d]) => <option key={v} value={v}>{d.label}</option>)}
          </select>
        </div>
      </Card>

      {loading ? (
        <QuestionSkeleton />
      ) : questions.length === 0 ? (
        <Card>
          <EmptyState icon={<BookOpen size={40} />} title={ar.questionBank.noResults} subtitle={ar.questionBank.noResultsSubtitle} />
          {canEdit && <div className="flex justify-center pb-8"><button onClick={handleNew} className="btn-primary"><Plus size={16} /> {ar.questionBank.addFirstQuestion}</button></div>}
        </Card>
      ) : (
        <div className="grid xl:grid-cols-2 gap-3">
          {questions.map((q) => (
            <QuestionCard
              key={q.id}
              question={q}
              subject={subjects.find((s) => s.id === q.subject_id)}
              canEdit={canEdit}
              onView={() => setViewing(q)}
              onEdit={() => handleEdit(q)}
              onDuplicate={() => handleDuplicate(q)}
              onDelete={() => handleDelete(q.id)}
            />
          ))}
        </div>
      )}

      {showEditor && (
        <QuestionEditor
          institutionId={institutionId}
          subjects={editorSubjects}
          editing={editing}
          onClose={() => setShowEditor(false)}
          onSaved={handleSaved}
        />
      )}

      {viewing && <QuestionPreview question={viewing} subject={subjects.find((s) => s.id === viewing.subject_id)} showCorrectAnswer onClose={() => setViewing(null)} />}
      {showImport && <QuestionImportModal
        subjects={editorSubjects}
        fileName={importFileName}
        text={importText}
        questions={importQuestions}
        subjectId={importSubject}
        difficulty={importDifficulty}
        points={importPoints}
        error={importError}
        saving={importing}
        onClose={() => setShowImport(false)}
        onFile={handleImportFile}
        onTextChange={setImportText}
        onReparse={reparseImportText}
        onSubjectChange={setImportSubject}
        onDifficultyChange={setImportDifficulty}
        onPointsChange={setImportPoints}
        onSave={saveImportedQuestions}
      />}
    </div>
  );
}

function QuestionImportModal({
  subjects, fileName, text, questions, subjectId, difficulty, points, error, saving,
  onClose, onFile, onTextChange, onReparse, onSubjectChange, onDifficultyChange, onPointsChange, onSave,
}: {
  subjects: SubjectRow[];
  fileName: string;
  text: string;
  questions: ImportedQuestion[];
  subjectId: string;
  difficulty: string;
  points: number;
  error: string | null;
  saving: boolean;
  onClose: () => void;
  onFile: (file: File) => void;
  onTextChange: (text: string) => void;
  onReparse: () => void;
  onSubjectChange: (value: string) => void;
  onDifficultyChange: (value: string) => void;
  onPointsChange: (value: number) => void;
  onSave: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 bg-ink-950/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div className="card w-full max-w-3xl max-h-[92vh] overflow-y-auto" onClick={(event) => event.stopPropagation()}>
        <div className="sticky top-0 z-10 bg-white border-b border-ink-100 px-6 py-4 flex items-center justify-between">
          <div><h3 className="font-display text-lg font-700 text-ink-900">استيراد أسئلة من ملف</h3><p className="text-xs text-ink-500 mt-1">يدعم ملفات PDF وWord بصيغة DOCX</p></div>
          <button onClick={onClose} className="text-ink-400 hover:text-ink-700"><X size={20} /></button>
        </div>
        <div className="p-6 space-y-4">
          <label className="flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-brand-200 bg-brand-50/50 p-8 cursor-pointer hover:bg-brand-50">
            <FileUp size={28} className="text-brand-600" />
            <span className="font-700 text-brand-700">اختر ملف PDF أو Word</span>
            <span className="text-xs text-ink-500">يفضل أن تكون الأسئلة مرقمة: 1. ثم 2.</span>
            <input data-testid="question-import-file" type="file" accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) onFile(file); }} />
          </label>
          {fileName && <p className="text-sm text-ink-600">الملف المختار: <span className="font-700">{fileName}</span></p>}
          <div><label className="label">النص المستخرج (يمكن تعديله قبل التحليل)</label><textarea data-testid="question-import-text" className="input min-h-[150px] resize-y leading-7" value={text} onChange={(event) => onTextChange(event.target.value)} placeholder={'1. ما هو ...\nA) ...\nB) ...\nالإجابة: A'} /><button type="button" onClick={onReparse} className="btn-outline mt-2 !py-2">إعادة تحليل النص</button></div>
          {error && <div data-testid="question-import-error" className="rounded-xl border border-danger-200 bg-danger-50 p-3 text-sm text-danger-700"><AlertCircle size={16} className="inline ml-1" />{error}</div>}
          <div className="grid md:grid-cols-3 gap-3">
            <div><label className="label">المادة</label><select data-testid="question-import-subject" className="input" value={subjectId} onChange={(event) => onSubjectChange(event.target.value)}><option value="">اختر المادة</option>{subjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.name}</option>)}</select></div>
            <div><label className="label">الصعوبة</label><select className="input" value={difficulty} onChange={(event) => onDifficultyChange(event.target.value)}><option value="easy">سهل</option><option value="medium">متوسط</option><option value="hard">صعب</option></select></div>
            <div><label className="label">الدرجة</label><input type="number" min="0.5" step="0.5" className="input nums-latin" value={points} onChange={(event) => onPointsChange(Number(event.target.value))} /></div>
          </div>
          <div className="rounded-xl border border-ink-100 bg-ink-50 p-4"><div className="flex items-center justify-between mb-3"><span className="font-700 text-ink-900">المعاينة</span><span className="chip bg-brand-50 text-brand-700">{questions.length} سؤال</span></div>{questions.length === 0 ? <p className="text-sm text-ink-500">ارفع ملفًا أو الصق النص ثم أعد التحليل.</p> : <div className="space-y-2 max-h-52 overflow-y-auto">{questions.map((question, index) => <div key={`${index}-${question.prompt}`} className="rounded-lg bg-white border border-ink-100 p-3 text-sm"><p className="font-600 text-ink-800">{index + 1}. {question.prompt}</p><p className="text-xs text-ink-500 mt-1">{question.options.length >= 2 ? `اختيار من متعدد (${question.options.length} اختيارات)` : 'إجابة قصيرة'}</p></div>)}</div>}</div>
        </div>
        <div className="sticky bottom-0 bg-white border-t border-ink-100 px-6 py-4 flex justify-end gap-2"><button onClick={onClose} className="btn-ghost">إلغاء</button><button data-testid="question-import-save" onClick={onSave} disabled={saving || questions.length === 0} className="btn-primary disabled:opacity-60">{saving ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />} استيراد وحفظ الأسئلة</button></div>
      </div>
    </div>
  );
}

function Metric({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <div className="rounded-xl border border-ink-100 bg-white px-4 py-3 flex items-center gap-3">
      <div className="grid place-items-center w-9 h-9 rounded-lg bg-brand-50 text-brand-600">{icon}</div>
      <div>
        <p className="text-xs text-ink-400">{label}</p>
        <p className="text-lg font-800 text-ink-900 nums-latin">{value}</p>
      </div>
    </div>
  );
}

function QuestionCard({ question, subject, canEdit, onView, onEdit, onDuplicate, onDelete }: { question: QuestionRow; subject?: SubjectRow; canEdit: boolean; onView: () => void; onEdit: () => void; onDuplicate: () => void; onDelete: () => void }) {
  const diff = DIFFICULTY_LABELS[question.difficulty] ?? DIFFICULTY_LABELS.medium;
  return (
    <Card hover className="p-4">
      <div className="flex items-start gap-3">
        <div className="grid place-items-center w-10 h-10 rounded-xl bg-ink-50 text-ink-500 shrink-0">
          <Filter size={18} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <Badge tone="brand">{TYPE_LABELS[question.type] ?? question.type}</Badge>
            <Badge tone={diff.tone}>{diff.label}</Badge>
            <span className="text-xs text-ink-400 nums-latin">{question.points} {ar.common.points}</span>
            {subject && <span className="text-xs text-ink-500">{subject.name}</span>}
          </div>
          <p className="text-sm font-600 text-ink-900 line-clamp-2">{question.prompt}</p>
          <div className="flex flex-wrap gap-2 mt-3 text-xs text-ink-400">
            {question.unit && <span>{ar.questionBank.unit}: {question.unit}</span>}
            {question.lesson && <span>{ar.questionBank.lesson}: {question.lesson}</span>}
            {!question.unit && !question.lesson && <span>{ar.questionBank.noUnitOrLesson}</span>}
          </div>
        </div>
        <div className="flex gap-1 shrink-0">
          <button data-testid="question-preview" onClick={onView} className="grid place-items-center w-8 h-8 rounded-lg text-ink-400 hover:bg-ink-100 hover:text-ink-700" title={ar.common.preview}><Eye size={16} /></button>
          {canEdit && <button data-testid="question-edit" onClick={onEdit} className="grid place-items-center w-8 h-8 rounded-lg text-ink-400 hover:bg-ink-100 hover:text-ink-700" title={ar.common.edit}><Edit3 size={16} /></button>}
          {canEdit && <button onClick={onDuplicate} className="grid place-items-center w-8 h-8 rounded-lg text-ink-400 hover:bg-ink-100 hover:text-ink-700" title={ar.common.duplicate}><Copy size={16} /></button>}
          {canEdit && <button onClick={onDelete} className="grid place-items-center w-8 h-8 rounded-lg text-ink-400 hover:bg-danger-50 hover:text-danger-600" title={ar.common.delete}><Trash2 size={16} /></button>}
        </div>
      </div>
    </Card>
  );
}

function QuestionSkeleton() {
  return (
    <div className="grid xl:grid-cols-2 gap-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="card p-4">
          <div className="h-4 w-32 rounded bg-ink-100 shimmer mb-3" />
          <div className="h-4 w-full rounded bg-ink-100 shimmer mb-2" />
          <div className="h-4 w-2/3 rounded bg-ink-100 shimmer" />
        </div>
      ))}
    </div>
  );
}

function QuestionPreview({ question, subject, showCorrectAnswer, onClose }: { question: QuestionRow; subject?: SubjectRow; showCorrectAnswer: boolean; onClose: () => void }) {
  const diff = DIFFICULTY_LABELS[question.difficulty] ?? DIFFICULTY_LABELS.medium;
  const advancedConfig = advancedConfigFromQuestion(question);
  const [options, setOptions] = useState<OptionRow[]>([]);
  const [loadingOptions, setLoadingOptions] = useState(false);
  const [optionsError, setOptionsError] = useState<string | null>(null);

  useEffect(() => {
    if (question.type !== 'multiple_choice') {
      setOptions([]);
      setOptionsError(null);
      return;
    }
    setLoadingOptions(true);
    setOptionsError(null);
    supabase
      .from('question_options')
      .select('id, label, is_correct, sort_order')
      .eq('question_id', question.id)
      .order('sort_order')
      .then(({ data, error }) => {
        if (error) {
          console.error('Question preview options load failed', error);
          setOptionsError(getArabicErrorMessage(error));
          setOptions([]);
        } else {
          setOptions((data as OptionRow[]) ?? []);
        }
        setLoadingOptions(false);
      });
  }, [question.id, question.type]);

  return (
    <div className="fixed inset-0 z-50 bg-ink-950/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div className="card w-full max-w-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="border-b border-ink-100 px-6 py-4 flex items-center justify-between">
          <h3 className="font-display text-lg font-700 text-ink-900">{ar.questionBank.previewQuestion}</h3>
          <button onClick={onClose} className="text-ink-400 hover:text-ink-700"><X size={20} /></button>
        </div>
        <div className="p-6 space-y-4">
          <div className="flex flex-wrap gap-2">
            <Badge tone="brand">{TYPE_LABELS[question.type] ?? question.type}</Badge>
            <Badge tone={diff.tone}>{diff.label}</Badge>
            <Badge tone="neutral">{question.points} {ar.common.points}</Badge>
            {subject && <Badge tone="neutral">{subject.name}</Badge>}
          </div>
          <div className="rounded-xl border border-ink-100 bg-ink-50 p-4 text-sm leading-7 text-ink-900 whitespace-pre-wrap">{question.prompt}</div>
          {question.type === 'multiple_choice' && (
            <div>
              <p className="label">{ar.questionBank.options}</p>
              {loadingOptions ? (
                <div className="flex items-center gap-2 text-sm text-ink-500"><Loader2 size={16} className="animate-spin" /> {ar.questionBank.optionsLoading}</div>
              ) : optionsError ? (
                <div className="rounded-xl border border-danger-200 bg-danger-50 p-3 text-sm text-danger-700">{optionsError}</div>
              ) : options.length === 0 ? (
                <div className="rounded-xl border border-warning-200 bg-warning-50 p-3 text-sm text-warning-700">{ar.questionBank.noStoredOptions}</div>
              ) : (
                <div className="space-y-2">
                  {options.map((option) => (
                    <div key={option.id} data-testid="preview-option" className={`flex items-center justify-between gap-3 rounded-xl border px-3 py-2 text-sm ${option.is_correct && showCorrectAnswer ? 'border-accent-200 bg-accent-50 text-accent-800' : 'border-ink-100 bg-white text-ink-700'}`}>
                      <span>{option.label}</span>
                      {option.is_correct && showCorrectAnswer && (
                        <span data-testid="preview-correct-option" className="inline-flex items-center gap-1 text-xs font-700 text-accent-700">
                          <CheckCircle2 size={14} /> {ar.questionBank.correct}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          {question.type === 'fill_blank' && (
            <div>
              <p className="label">الفراغات</p>
              <div className="space-y-2">
                {(advancedConfig.blanks ?? []).map((blank, index) => (
                  <div key={blank.id} data-testid="preview-fill-blank" className="rounded-xl border border-ink-100 bg-white p-3 text-sm">
                    <div className="font-700 text-ink-800 nums-latin">{index + 1}. {blank.id}</div>
                    {showCorrectAnswer && (
                      <p className="text-xs text-accent-700 mt-1">الإجابات المقبولة: {blank.accepted_answers.join('، ')}</p>
                    )}
                    <p className="text-xs text-ink-400 mt-1">{blank.case_sensitive ? 'حساس لحالة الأحرف' : 'غير حساس لحالة الأحرف'} · {blank.ignore_extra_spaces ? 'يتجاهل المسافات الزائدة' : 'يحافظ على المسافات'}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
          {question.type === 'matching' && (
            <div>
              <p className="label">أزواج التوصيل</p>
              <div className="grid gap-2">
                {(advancedConfig.pairs ?? []).map((pair) => (
                  <div key={pair.left_id} data-testid="preview-matching-pair" className="grid md:grid-cols-[1fr_auto_1fr] items-center gap-2 rounded-xl border border-ink-100 bg-white p-3 text-sm">
                    <span>{pair.left}</span>
                    <span className="text-ink-300">←</span>
                    <span className={showCorrectAnswer ? 'text-accent-700 font-700' : 'text-ink-500'}>{showCorrectAnswer ? pair.right : 'إجابة مخفية'}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {question.type === 'ordering' && (
            <div>
              <p className="label">الترتيب الصحيح</p>
              <div className="space-y-2">
                {(advancedConfig.items ?? []).map((item, index) => (
                  <div key={item.id} data-testid="preview-ordering-item" className="flex items-center gap-3 rounded-xl border border-ink-100 bg-white p-3 text-sm">
                    <span className="grid place-items-center w-7 h-7 rounded-lg bg-ink-100 text-ink-500 nums-latin">{index + 1}</span>
                    <span className={showCorrectAnswer ? 'text-ink-800' : 'text-ink-500'}>{showCorrectAnswer ? item.label : 'عنصر ترتيب'}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {question.explanation && (
            <div>
              <p className="label">{ar.questionBank.explanation}</p>
              <p className="text-sm text-ink-600 whitespace-pre-wrap">{question.explanation}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

interface EditorProps {
  institutionId: string;
  subjects: SubjectRow[];
  editing: QuestionRow | null;
  onClose: () => void;
  onSaved: () => void;
}

function QuestionEditor({ institutionId, subjects, editing, onClose, onSaved }: EditorProps) {
  const [type, setType] = useState(editing?.type ?? 'multiple_choice');
  const [prompt, setPrompt] = useState(editing?.prompt ?? '');
  const [difficulty, setDifficulty] = useState(editing?.difficulty ?? 'medium');
  const [points, setPoints] = useState(editing?.points ?? 1);
  const [subjectId, setSubjectId] = useState(editing?.subject_id ?? subjects[0]?.id ?? '');
  const [unit, setUnit] = useState(editing?.unit ?? '');
  const [lesson, setLesson] = useState(editing?.lesson ?? '');
  const [explanation, setExplanation] = useState(editing?.explanation ?? '');
  const [options, setOptions] = useState<OptionRow[]>([]);
  const [trueFalseAnswer, setTrueFalseAnswer] = useState<boolean>(true);
  const [shortAnswer, setShortAnswer] = useState(String(editing?.metadata?.correct_answer ?? ''));
  const [numericAnswer, setNumericAnswer] = useState(String(editing?.metadata?.correct_answer ?? ''));
  const [fillBlanks, setFillBlanks] = useState<FillBlankRow[]>(defaultFillBlanks());
  const [matchingPairs, setMatchingPairs] = useState<MatchingPairRow[]>(defaultMatchingPairs());
  const [orderingItems, setOrderingItems] = useState<OrderingItemRow[]>(defaultOrderingItems());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadingOptions, setLoadingOptions] = useState(false);

  useEffect(() => {
    if (!subjectId && subjects.length > 0) setSubjectId(subjects[0].id);
  }, [subjectId, subjects]);

  useEffect(() => {
    if (!editing) {
      setOptions([
        { id: '', label: '', is_correct: true, sort_order: 0 },
        { id: '', label: '', is_correct: false, sort_order: 1 },
      ]);
      setFillBlanks(defaultFillBlanks());
      setMatchingPairs(defaultMatchingPairs());
      setOrderingItems(defaultOrderingItems());
      return;
    }
    const config = advancedConfigFromQuestion(editing);
    setFillBlanks(config.blanks?.map((blank) => ({
      id: blank.id,
      acceptedAnswers: blank.accepted_answers.join('\n'),
      caseSensitive: Boolean(blank.case_sensitive),
      ignoreExtraSpaces: blank.ignore_extra_spaces !== false,
    })) ?? defaultFillBlanks());
    setMatchingPairs(config.pairs?.map((pair) => ({
      leftId: pair.left_id,
      left: pair.left,
      rightId: pair.right_id,
      right: pair.right,
    })) ?? defaultMatchingPairs());
    setOrderingItems(config.items?.map((item) => ({ id: item.id, label: item.label })) ?? defaultOrderingItems());
    setLoadingOptions(true);
    supabase.from('question_options').select('id, label, is_correct, sort_order').eq('question_id', editing.id).order('sort_order')
      .then(({ data }) => {
        const loaded = (data as OptionRow[]) ?? [];
        setOptions(loaded);
        if (editing.type === 'true_false') setTrueFalseAnswer(Boolean(loaded.find((option) => option.label === 'True' || option.label === 'صح')?.is_correct ?? true));
        setLoadingOptions(false);
      });
  }, [editing]);

  function addOption() {
    setOptions((prev) => [...prev, { id: '', label: '', is_correct: false, sort_order: prev.length }]);
  }

  function updateOption(idx: number, field: keyof OptionRow, value: string | boolean) {
    setOptions((prev) => prev.map((o, i) => i === idx ? { ...o, [field]: value } : o));
  }

  function removeOption(idx: number) {
    setOptions((prev) => prev.filter((_, i) => i !== idx));
  }

  function validateMultipleChoice() {
    const trimmedOptions = options.map((option, index) => ({
      label: option.label.trim(),
      is_correct: option.is_correct,
      sort_order: index,
    }));
    if (trimmedOptions.some((option) => !option.label)) return { error: ar.questionBank.optionsCannotBeEmpty };
    if (trimmedOptions.length < 2) return { error: ar.questionBank.addAtLeastTwoOptions };
    if (!trimmedOptions.some((option) => option.is_correct)) return { error: ar.questionBank.markCorrectOption };
    return { options: trimmedOptions };
  }

  function buildAdvancedConfig(): { config?: AdvancedConfig; error?: string } {
    if (type === 'fill_blank') {
      const blanks = fillBlanks.map((blank, index) => ({
        id: blank.id.trim() || `blank_${index + 1}`,
        accepted_answers: blank.acceptedAnswers.split('\n').map((answer) => answer.trim()).filter(Boolean),
        case_sensitive: blank.caseSensitive,
        ignore_extra_spaces: blank.ignoreExtraSpaces,
      }));
      if (blanks.length < 1) return { error: 'أضف فراغاً واحداً على الأقل.' };
      if (new Set(blanks.map((blank) => blank.id)).size !== blanks.length) return { error: 'معرفات الفراغات يجب أن تكون فريدة.' };
      if (blanks.some((blank) => blank.accepted_answers.length === 0)) return { error: 'كل فراغ يحتاج إجابة مقبولة واحدة على الأقل.' };
      return { config: { blanks, partial_credit: true } };
    }

    if (type === 'matching') {
      const pairs = matchingPairs.map((pair, index) => ({
        left_id: pair.leftId.trim() || `left_${index + 1}`,
        left: pair.left.trim(),
        right_id: pair.rightId.trim() || `right_${index + 1}`,
        right: pair.right.trim(),
      }));
      if (pairs.length < 2) return { error: 'أضف زوجين على الأقل للتوصيل.' };
      if (pairs.some((pair) => !pair.left || !pair.right)) return { error: 'لا يمكن ترك أي طرف في زوج التوصيل فارغاً.' };
      if (new Set(pairs.map((pair) => pair.left_id)).size !== pairs.length) return { error: 'معرفات الطرف الأيسر يجب أن تكون فريدة.' };
      if (new Set(pairs.map((pair) => pair.right_id)).size !== pairs.length) return { error: 'معرفات الطرف الأيمن يجب أن تكون فريدة.' };
      return { config: { pairs, partial_credit: true, one_to_one: true } };
    }

    if (type === 'ordering') {
      const items = orderingItems.map((item, index) => ({ id: item.id.trim() || `item_${index + 1}`, label: item.label.trim() }));
      if (items.length < 2) return { error: 'أضف عنصرين على الأقل للترتيب.' };
      if (items.some((item) => !item.label)) return { error: 'لا يمكن ترك عناصر الترتيب فارغة.' };
      if (new Set(items.map((item) => item.id)).size !== items.length) return { error: 'معرفات عناصر الترتيب يجب أن تكون فريدة.' };
      return { config: { items, partial_credit: true } };
    }

    return {};
  }

  function addFillBlank() {
    setFillBlanks((prev) => [...prev, { id: `blank_${prev.length + 1}`, acceptedAnswers: '', caseSensitive: false, ignoreExtraSpaces: true }]);
  }

  function addMatchingPair() {
    setMatchingPairs((prev) => [...prev, { leftId: `left_${prev.length + 1}`, left: '', rightId: `right_${prev.length + 1}`, right: '' }]);
  }

  function addOrderingItem() {
    setOrderingItems((prev) => [...prev, { id: `item_${prev.length + 1}`, label: '' }]);
  }

  function moveOrderingItem(index: number, direction: -1 | 1) {
    setOrderingItems((prev) => {
      const nextIndex = index + direction;
      if (nextIndex < 0 || nextIndex >= prev.length) return prev;
      const copy = [...prev];
      [copy[index], copy[nextIndex]] = [copy[nextIndex], copy[index]];
      return copy;
    });
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    if (!prompt.trim()) { setError(ar.questionBank.textRequired); setSaving(false); return; }
    if (!subjectId) { setError(ar.questionBank.subjectRequired); setSaving(false); return; }
    if (!EDITABLE_TYPES.includes(type)) { setError(ar.questionBank.unsupportedType); setSaving(false); return; }

    const validatedOptions = type === 'multiple_choice' ? validateMultipleChoice() : null;
    if (validatedOptions?.error) { setError(validatedOptions.error); setSaving(false); return; }
    const advanced = ADVANCED_TYPES.includes(type) ? buildAdvancedConfig() : null;
    if (advanced?.error) { setError(advanced.error); setSaving(false); return; }

    try {
      const questionData = {
        institution_id: institutionId,
        subject_id: subjectId || null,
        type,
        prompt: prompt.trim(),
        difficulty,
        points: Number(points),
        unit: unit || null,
        lesson: lesson || null,
        explanation: explanation || null,
        metadata: type === 'short_answer' ? { correct_answer: shortAnswer.trim().toLowerCase() } : type === 'numeric' ? { correct_answer: numericAnswer } : editing?.metadata ?? {},
      };

      if (type === 'multiple_choice') {
        const { error: rpcErr } = await supabase.rpc('save_multiple_choice_question', {
          p_question_id: editing?.id ?? null,
          p_institution_id: institutionId,
          p_subject_id: subjectId,
          p_prompt: prompt.trim(),
          p_difficulty: difficulty,
          p_points: Number(points),
          p_unit: unit,
          p_lesson: lesson,
          p_explanation: explanation,
          p_metadata: editing?.metadata ?? {},
          p_options: validatedOptions?.options ?? [],
        });
        if (rpcErr) throw rpcErr;
        onSaved();
        return;
      }

      if (ADVANCED_TYPES.includes(type)) {
        const { error: rpcErr } = await supabase.rpc('save_advanced_question', {
          p_question_id: editing?.id ?? null,
          p_institution_id: institutionId,
          p_subject_id: subjectId,
          p_type: type,
          p_prompt: prompt.trim(),
          p_difficulty: difficulty,
          p_points: Number(points),
          p_unit: unit,
          p_lesson: lesson,
          p_explanation: explanation,
          p_metadata: editing?.metadata ?? {},
          p_config: advanced?.config ?? {},
        });
        if (rpcErr) throw rpcErr;
        onSaved();
        return;
      }

      let questionId = editing?.id;

      if (editing) {
        const { error: err } = await supabase.from('questions').update(questionData).eq('id', editing.id);
        if (err) throw err;
      } else {
        const { data, error: err } = await supabase.from('questions').insert(questionData).select('id').single();
        if (err) throw err;
        questionId = (data as { id: string }).id;
      }

      if (!questionId) throw new Error('Failed to save question.');

      if (type === 'true_false') {
        await supabase.from('question_options').delete().eq('question_id', questionId);
        const { error: optErr } = await supabase.from('question_options').insert([
          { question_id: questionId, label: 'True', is_correct: trueFalseAnswer, sort_order: 0 },
          { question_id: questionId, label: 'False', is_correct: !trueFalseAnswer, sort_order: 1 },
        ]);
        if (optErr) throw optErr;
      }

      onSaved();
    } catch (e) {
      console.error('Question save failed', e);
      setError(getArabicErrorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-ink-950/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div className="card w-full max-w-4xl max-h-[92vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 bg-white border-b border-ink-100 px-6 py-4 flex items-center justify-between z-10">
          <div>
            <h3 className="font-display text-lg font-700 text-ink-900">{editing ? ar.questionBank.editQuestion : ar.questionBank.addQuestion}</h3>
            <p className="text-xs text-ink-400 mt-1">يدعم الحفظ الذري والتحقق قبل إنشاء السؤال أو تعديله.</p>
          </div>
          <button onClick={onClose} className="text-ink-400 hover:text-ink-700"><X size={20} /></button>
        </div>

        <div className="p-6 space-y-5">
          {error && <div data-testid="question-editor-error" className="flex items-center gap-2 p-3 rounded-xl bg-danger-50 border border-danger-200"><AlertCircle size={18} className="text-danger-600" /><p className="text-sm text-danger-700">{error}</p></div>}

          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <label className="label">{ar.questionBank.type}</label>
              <select data-testid="question-type-select" className="input" value={type} onChange={(e) => setType(e.target.value)} disabled={!!editing}>
                {TYPE_OPTIONS.map((option) => <option key={option.value} value={option.value} disabled={option.disabled}>{option.label}</option>)}
              </select>
            </div>
            <div>
              <label className="label">{ar.questionBank.subject}</label>
              <select data-testid="question-subject-select" className="input" value={subjectId} onChange={(e) => setSubjectId(e.target.value)}>
                <option value="">{ar.questionBank.selectSubject}</option>
                {subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className="label">{ar.questionBank.questionText}</label>
            <textarea data-testid="question-prompt" className="input min-h-[132px] resize-y leading-7" value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder={ar.questionBank.questionPlaceholder} />
          </div>

          <div className="grid md:grid-cols-4 gap-4">
            <div>
              <label className="label">{ar.questionBank.difficulty}</label>
              <select className="input" value={difficulty} onChange={(e) => setDifficulty(e.target.value)}>
                <option value="easy">{ar.difficulty.easy}</option>
                <option value="medium">{ar.difficulty.medium}</option>
                <option value="hard">{ar.difficulty.hard}</option>
              </select>
            </div>
            <div>
              <label className="label">{ar.questionBank.points}</label>
              <input type="number" step="0.5" min="0.5" className="input" value={points} onChange={(e) => setPoints(Number(e.target.value))} />
            </div>
            <div>
              <label className="label">{ar.questionBank.unit}</label>
              <input className="input" value={unit} onChange={(e) => setUnit(e.target.value)} />
            </div>
            <div>
              <label className="label">{ar.questionBank.lesson}</label>
              <input className="input" value={lesson} onChange={(e) => setLesson(e.target.value)} />
            </div>
          </div>

          {type === 'multiple_choice' && (
            <div className="rounded-xl border border-ink-100 p-4">
              <div className="flex items-center justify-between mb-3">
                <label className="font-700 text-sm text-ink-900">{ar.questionBank.options}</label>
                <button type="button" data-testid="add-option" onClick={addOption} className="btn-outline !py-1.5 !px-3 text-xs"><Plus size={14} /> {ar.questionBank.addOption}</button>
              </div>
              {loadingOptions ? <Loader2 size={16} className="animate-spin" /> : (
                <div className="space-y-2">
                  {options.map((opt, idx) => (
                    <div key={idx} className="grid grid-cols-[auto_1fr_auto] items-center gap-2">
                      <input data-testid="option-correct" type="checkbox" checked={opt.is_correct} onChange={(e) => updateOption(idx, 'is_correct', e.target.checked)} className="w-4 h-4 rounded" title={ar.questionBank.correctOption} />
                      <input data-testid="option-label" className="input !py-2" placeholder={`اختيار ${idx + 1}`} value={opt.label} onChange={(e) => updateOption(idx, 'label', e.target.value)} />
                      <button type="button" data-testid="remove-option" onClick={() => removeOption(idx)} className="grid place-items-center w-8 h-8 rounded-lg text-ink-400 hover:text-danger-600"><Trash2 size={16} /></button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {type === 'true_false' && (
            <div className="rounded-xl border border-ink-100 p-4">
              <label className="font-700 text-sm text-ink-900">{ar.questionBank.correctAnswer}</label>
              <div className="flex gap-4 mt-3">
                <label className="flex items-center gap-2 cursor-pointer"><input type="radio" name="tf" checked={trueFalseAnswer} onChange={() => setTrueFalseAnswer(true)} /> صح</label>
                <label className="flex items-center gap-2 cursor-pointer"><input type="radio" name="tf" checked={!trueFalseAnswer} onChange={() => setTrueFalseAnswer(false)} /> خطأ</label>
              </div>
            </div>
          )}

          {type === 'short_answer' && (
            <div>
              <label className="label">{ar.questionBank.correctShortAnswer}</label>
              <input className="input" value={shortAnswer} onChange={(e) => setShortAnswer(e.target.value)} />
            </div>
          )}

          {type === 'numeric' && (
            <div>
              <label className="label">{ar.questionBank.correctNumericAnswer}</label>
              <input type="number" step="any" className="input" value={numericAnswer} onChange={(e) => setNumericAnswer(e.target.value)} dir="ltr" />
            </div>
          )}

          {type === 'fill_blank' && (
            <div className="rounded-xl border border-ink-100 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <label className="font-700 text-sm text-ink-900">الفراغات والإجابات المقبولة</label>
                <button type="button" data-testid="add-fill-blank" onClick={addFillBlank} className="btn-outline !py-1.5 !px-3 text-xs"><Plus size={14} /> إضافة فراغ</button>
              </div>
              <p className="text-xs text-ink-400">استخدم معرفات مثل blank_1، واكتب كل إجابة مقبولة في سطر مستقل.</p>
              {fillBlanks.map((blank, index) => (
                <div key={index} data-testid="fill-blank-row" className="rounded-xl bg-ink-50 border border-ink-100 p-3 space-y-2">
                  <div className="grid md:grid-cols-[160px_1fr_auto] gap-2">
                    <input data-testid="fill-blank-id" className="input !py-2 nums-latin" value={blank.id} onChange={(e) => setFillBlanks((prev) => prev.map((row, i) => i === index ? { ...row, id: e.target.value } : row))} dir="ltr" />
                    <textarea data-testid="fill-blank-answers" className="input min-h-[76px] resize-y" value={blank.acceptedAnswers} onChange={(e) => setFillBlanks((prev) => prev.map((row, i) => i === index ? { ...row, acceptedAnswers: e.target.value } : row))} placeholder="إجابة مقبولة في كل سطر" />
                    <button type="button" data-testid="remove-fill-blank" onClick={() => setFillBlanks((prev) => prev.filter((_, i) => i !== index))} className="grid place-items-center w-9 h-9 rounded-lg text-ink-400 hover:text-danger-600"><Trash2 size={16} /></button>
                  </div>
                  <div className="flex flex-wrap gap-4 text-xs text-ink-600">
                    <label className="flex items-center gap-2"><input type="checkbox" checked={blank.caseSensitive} onChange={(e) => setFillBlanks((prev) => prev.map((row, i) => i === index ? { ...row, caseSensitive: e.target.checked } : row))} /> حساس لحالة الأحرف</label>
                    <label className="flex items-center gap-2"><input type="checkbox" checked={blank.ignoreExtraSpaces} onChange={(e) => setFillBlanks((prev) => prev.map((row, i) => i === index ? { ...row, ignoreExtraSpaces: e.target.checked } : row))} /> تجاهل المسافات الزائدة</label>
                  </div>
                </div>
              ))}
            </div>
          )}

          {type === 'matching' && (
            <div className="rounded-xl border border-ink-100 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <label className="font-700 text-sm text-ink-900">أزواج التوصيل</label>
                <button type="button" data-testid="add-matching-pair" onClick={addMatchingPair} className="btn-outline !py-1.5 !px-3 text-xs"><Plus size={14} /> إضافة زوج</button>
              </div>
              {matchingPairs.map((pair, index) => (
                <div key={index} data-testid="matching-pair-row" className="grid md:grid-cols-[120px_1fr_120px_1fr_auto] gap-2 items-start rounded-xl bg-ink-50 border border-ink-100 p-3">
                  <input data-testid="matching-left-id" className="input !py-2 nums-latin" value={pair.leftId} onChange={(e) => setMatchingPairs((prev) => prev.map((row, i) => i === index ? { ...row, leftId: e.target.value } : row))} dir="ltr" />
                  <input data-testid="matching-left-text" className="input !py-2" value={pair.left} onChange={(e) => setMatchingPairs((prev) => prev.map((row, i) => i === index ? { ...row, left: e.target.value } : row))} placeholder="الطرف الأيسر" />
                  <input data-testid="matching-right-id" className="input !py-2 nums-latin" value={pair.rightId} onChange={(e) => setMatchingPairs((prev) => prev.map((row, i) => i === index ? { ...row, rightId: e.target.value } : row))} dir="ltr" />
                  <input data-testid="matching-right-text" className="input !py-2" value={pair.right} onChange={(e) => setMatchingPairs((prev) => prev.map((row, i) => i === index ? { ...row, right: e.target.value } : row))} placeholder="الطرف الأيمن" />
                  <button type="button" data-testid="remove-matching-pair" onClick={() => setMatchingPairs((prev) => prev.filter((_, i) => i !== index))} className="grid place-items-center w-9 h-9 rounded-lg text-ink-400 hover:text-danger-600"><Trash2 size={16} /></button>
                </div>
              ))}
            </div>
          )}

          {type === 'ordering' && (
            <div className="rounded-xl border border-ink-100 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <label className="font-700 text-sm text-ink-900">العناصر بالترتيب الصحيح</label>
                <button type="button" data-testid="add-ordering-item" onClick={addOrderingItem} className="btn-outline !py-1.5 !px-3 text-xs"><Plus size={14} /> إضافة عنصر</button>
              </div>
              {orderingItems.map((item, index) => (
                <div key={index} data-testid="ordering-item-row" className="grid grid-cols-[auto_120px_1fr_auto_auto_auto] gap-2 items-center rounded-xl bg-ink-50 border border-ink-100 p-3">
                  <span className="text-xs font-700 text-ink-400 nums-latin">{index + 1}</span>
                  <input data-testid="ordering-item-id" className="input !py-2 nums-latin" value={item.id} onChange={(e) => setOrderingItems((prev) => prev.map((row, i) => i === index ? { ...row, id: e.target.value } : row))} dir="ltr" />
                  <input data-testid="ordering-item-label" className="input !py-2" value={item.label} onChange={(e) => setOrderingItems((prev) => prev.map((row, i) => i === index ? { ...row, label: e.target.value } : row))} placeholder="نص العنصر" />
                  <button type="button" data-testid="ordering-move-up" onClick={() => moveOrderingItem(index, -1)} disabled={index === 0} className="btn-ghost !py-1 !px-2 text-xs disabled:opacity-40">أعلى</button>
                  <button type="button" data-testid="ordering-move-down" onClick={() => moveOrderingItem(index, 1)} disabled={index === orderingItems.length - 1} className="btn-ghost !py-1 !px-2 text-xs disabled:opacity-40">أسفل</button>
                  <button type="button" data-testid="remove-ordering-item" onClick={() => setOrderingItems((prev) => prev.filter((_, i) => i !== index))} className="grid place-items-center w-9 h-9 rounded-lg text-ink-400 hover:text-danger-600"><Trash2 size={16} /></button>
                </div>
              ))}
            </div>
          )}

          {!EDITABLE_TYPES.includes(type) && (
            <div className="rounded-xl border border-warning-200 bg-warning-50 p-4 text-sm text-warning-600">
              {ar.questionBank.editorComingSoonMessage}
            </div>
          )}

          <div>
            <label className="label">{ar.questionBank.explanation}</label>
            <textarea className="input min-h-[80px] resize-y" value={explanation} onChange={(e) => setExplanation(e.target.value)} placeholder={ar.questionBank.explanationPlaceholder} />
          </div>
        </div>

        <div className="sticky bottom-0 bg-white border-t border-ink-100 px-6 py-4 flex justify-end gap-2">
          <button onClick={onClose} className="btn-ghost">{ar.common.cancel}</button>
          <button data-testid="save-question" onClick={handleSave} disabled={saving || !EDITABLE_TYPES.includes(type)} className="btn-primary disabled:opacity-60">
            {saving ? <Loader2 size={16} className="animate-spin" /> : null}
            {editing ? ar.questionBank.saveChanges : ar.questionBank.createQuestion}
          </button>
        </div>
      </div>
    </div>
  );
}
