import { useCallback, useEffect, useMemo, useState } from 'react';
import { Archive, BookOpen, Check, Edit3, Layers3, Loader2, Plus, Search, Target, X } from 'lucide-react';
import { Badge, Card, EmptyState, SectionHeader } from '../components/ui';
import { Select as DropdownSelect } from '../components/ui/Select';
import { useFeedback } from '../components/FeedbackProvider';
import { supabase, useAuthSafe } from '../lib/auth-helpers';

type Subject = { id: string; name: string; is_active: boolean };
type LearningOutcome = {
  id: string;
  institution_id: string;
  subject_id: string;
  subject_name: string;
  academic_year: string | null;
  grade_level_id: string | null;
  unit: string | null;
  lesson: string | null;
  code: string;
  name_ar: string;
  description: string | null;
  status: 'active' | 'archived';
  display_order: number;
  question_count: number;
  created_at: string;
  updated_at: string;
};

type FormState = {
  subject_id: string;
  code: string;
  name_ar: string;
  description: string;
  academic_year: string;
  unit: string;
  lesson: string;
  display_order: string;
};

const emptyForm: FormState = {
  subject_id: '', code: '', name_ar: '', description: '', academic_year: '', unit: '', lesson: '', display_order: '0',
};

function formFromRow(row?: LearningOutcome): FormState {
  if (!row) return emptyForm;
  return {
    subject_id: row.subject_id,
    code: row.code,
    name_ar: row.name_ar,
    description: row.description ?? '',
    academic_year: row.academic_year ?? '',
    unit: row.unit ?? '',
    lesson: row.lesson ?? '',
    display_order: String(row.display_order ?? 0),
  };
}

export function LearningOutcomes() {
  const { institutionId, role } = useAuthSafe();
  const { confirm, toast } = useFeedback();
  const canManage = role === 'super_admin' || role === 'school_admin';
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [outcomes, setOutcomes] = useState<LearningOutcome[]>([]);
  const [subjectFilter, setSubjectFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('active');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<LearningOutcome | null | undefined>(undefined);
  const [form, setForm] = useState<FormState>(emptyForm);

  const load = useCallback(async () => {
    if (!institutionId) return;
    setLoading(true);
    setError(null);
    const [subjectRes, outcomeRes] = await Promise.all([
      supabase.from('subjects').select('id, name, is_active').eq('institution_id', institutionId).order('name'),
      supabase.rpc('get_learning_outcomes', {
        p_subject_id: subjectFilter === 'all' ? null : subjectFilter,
        p_status: statusFilter,
      }),
    ]);
    if (subjectRes.error || outcomeRes.error) {
      setError(subjectRes.error?.message ?? outcomeRes.error?.message ?? 'تعذر تحميل نواتج التعلم.');
    }
    setSubjects((subjectRes.data as Subject[]) ?? []);
    setOutcomes((outcomeRes.data as LearningOutcome[]) ?? []);
    setLoading(false);
  }, [institutionId, statusFilter, subjectFilter]);

  useEffect(() => { void load(); }, [load]);

  const visibleOutcomes = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return outcomes;
    return outcomes.filter((outcome) => [outcome.code, outcome.name_ar, outcome.description, outcome.subject_name, outcome.unit, outcome.lesson]
      .some((value) => (value ?? '').toLowerCase().includes(normalized)));
  }, [outcomes, query]);

  function openCreate() {
    setEditing(null);
    setForm({ ...emptyForm, subject_id: subjectFilter === 'all' ? subjects.find((subject) => subject.is_active)?.id ?? '' : subjectFilter });
    setError(null);
  }

  function openEdit(row: LearningOutcome) {
    setEditing(row);
    setForm(formFromRow(row));
    setError(null);
  }

  function updateForm(key: keyof FormState, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function save() {
    if (!institutionId || saving) return;
    if (!form.subject_id || !form.code.trim() || !form.name_ar.trim()) {
      setError('اختر المادة واكتب كود واسم ناتج التعلم.');
      return;
    }
    setSaving(true);
    setError(null);
    const payload = {
      institution_id: institutionId,
      subject_id: form.subject_id,
      code: form.code.trim(),
      name_ar: form.name_ar.trim(),
      description: form.description.trim() || null,
      academic_year: form.academic_year.trim() || null,
      unit: form.unit.trim() || null,
      lesson: form.lesson.trim() || null,
      display_order: Math.max(0, Number.parseInt(form.display_order, 10) || 0),
    };
    const result = editing ? await supabase.from('learning_outcomes').update(payload).eq('id', editing.id) : await supabase.from('learning_outcomes').insert(payload);
    if (result.error) {
      setError(result.error.message.includes('learning_outcomes_unique_code') ? 'كود ناتج التعلم مستخدم بالفعل داخل هذه المادة.' : result.error.message);
      setSaving(false);
      return;
    }
    toast(editing ? 'تم تحديث ناتج التعلم.' : 'تم إنشاء ناتج التعلم.', 'success');
    setEditing(undefined);
    setSaving(false);
    await load();
  }

  async function archive(row: LearningOutcome) {
    const accepted = await confirm(`سيتم أرشفة «${row.name_ar}» مع إبقاء الأسئلة والنتائج المرتبطة به. هل تريد المتابعة؟`, { title: 'أرشفة ناتج التعلم', confirmLabel: 'أرشفة', tone: 'danger' });
    if (!accepted) return;
    const { error: archiveError } = await supabase.from('learning_outcomes').update({ status: 'archived' }).eq('id', row.id);
    if (archiveError) { setError(archiveError.message); return; }
    toast('تمت أرشفة ناتج التعلم.', 'success');
    await load();
  }

  if (!institutionId) return <Card className="p-8 text-center text-ink-500">لا توجد مؤسسة مرتبطة بالحساب.</Card>;
  if (editing !== undefined) {
    return <OutcomeEditor form={form} subjects={subjects} saving={saving} error={error} editing={Boolean(editing)} onChange={updateForm} onSave={() => void save()} onClose={() => setEditing(undefined)} />;
  }

  return (
    <div className="space-y-5" data-testid="learning-outcomes-page">
      <SectionHeader
        title="نواتج التعلم"
        subtitle="عرّف المهارات المستهدفة واربطها بالأسئلة لقياس الإتقان بوضوح."
        action={canManage ? <button type="button" data-testid="learning-outcome-add" className="btn-primary" onClick={openCreate}><Plus size={17} /> إضافة ناتج</button> : undefined}
      />
      {error && <div role="alert" className="rounded-xl border border-danger-200 bg-danger-50 px-4 py-3 text-sm text-danger-700">{error}</div>}
      <Card className="p-4">
        <div className="grid gap-3 md:grid-cols-[1fr_220px_180px]">
          <label className="relative block">
            <span className="sr-only">بحث في نواتج التعلم</span>
            <Search size={17} className="pointer-events-none absolute right-3 top-3.5 text-ink-400" />
            <input data-testid="learning-outcome-search" className="input !pr-10" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ابحث بالكود أو الاسم أو الوحدة..." />
          </label>
          <DropdownSelect value={subjectFilter} onValueChange={setSubjectFilter} ariaLabel="تصفية حسب المادة" options={[{ value: 'all', label: 'كل المواد' }, ...subjects.map((subject) => ({ value: subject.id, label: subject.name }))]} />
          <DropdownSelect value={statusFilter} onValueChange={setStatusFilter} ariaLabel="تصفية حسب الحالة" options={[{ value: 'active', label: 'النشطة' }, { value: 'archived', label: 'المؤرشفة' }, { value: 'all', label: 'كل الحالات' }]} />
        </div>
      </Card>
      <Card className="overflow-hidden">
        <div className="flex items-center justify-between border-b border-ink-100 px-5 py-4">
          <div><h2 className="font-display text-lg font-700 text-ink-900">قائمة النواتج</h2><p className="mt-1 text-sm text-ink-500">{visibleOutcomes.length} ناتج ظاهر · عدد الأسئلة محسوب من الروابط الفعلية</p></div>
          <Target size={22} className="text-brand-500" />
        </div>
        {loading ? <div className="flex justify-center py-16"><Loader2 size={26} className="animate-spin text-brand-600" /></div> : visibleOutcomes.length === 0 ? <EmptyState icon={<Target size={40} />} title="لا توجد نواتج تعلم" subtitle={query ? 'جرّب تغيير عبارة البحث أو الفلاتر.' : 'أضف أول ناتج تعلم لبدء ربط الأسئلة بالمهارات.'} /> : (
          <div className="divide-y divide-ink-100">
            {visibleOutcomes.map((outcome) => (
              <div key={outcome.id} data-testid={`learning-outcome-${outcome.id}`} className="flex flex-col gap-4 px-5 py-4 transition hover:bg-ink-50 md:flex-row md:items-center md:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2"><Badge tone="brand">{outcome.code}</Badge><h3 className="font-700 text-ink-900">{outcome.name_ar}</h3><Badge tone={outcome.status === 'active' ? 'accent' : 'neutral'}>{outcome.status === 'active' ? 'نشط' : 'مؤرشف'}</Badge></div>
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink-500"><span className="inline-flex items-center gap-1"><BookOpen size={14} /> {outcome.subject_name}</span>{outcome.unit && <span className="inline-flex items-center gap-1"><Layers3 size={14} /> الوحدة: {outcome.unit}</span>}{outcome.lesson && <span>الدرس: {outcome.lesson}</span>}</div>
                  {outcome.description && <p className="mt-2 text-sm leading-6 text-ink-500">{outcome.description}</p>}
                </div>
                <div className="flex items-center gap-2 md:shrink-0">
                  <div className="rounded-xl bg-ink-50 px-3 py-2 text-center"><strong className="block font-display text-lg text-ink-900 nums-latin">{outcome.question_count}</strong><span className="text-xs text-ink-500">سؤال مرتبط</span></div>
                  {canManage && outcome.status === 'active' && <><button type="button" className="btn-outline !px-3" onClick={() => openEdit(outcome)} aria-label={`تعديل ${outcome.name_ar}`}><Edit3 size={16} /> تعديل</button><button type="button" className="btn-ghost !px-3 text-warning-700" onClick={() => void archive(outcome)} aria-label={`أرشفة ${outcome.name_ar}`}><Archive size={16} /> أرشفة</button></>}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

function OutcomeEditor({ form, subjects, saving, error, editing, onChange, onSave, onClose }: {
  form: FormState;
  subjects: Subject[];
  saving: boolean;
  error: string | null;
  editing: boolean;
  onChange: (key: keyof FormState, value: string) => void;
  onSave: () => void;
  onClose: () => void;
}) {
  return (
    <div className="space-y-5" data-testid="learning-outcome-editor">
      <SectionHeader title={editing ? 'تعديل ناتج التعلم' : 'إضافة ناتج تعلم'} subtitle="سيتم استخدامه في تصنيف الأسئلة وتقارير الإتقان." action={<button type="button" className="btn-outline" onClick={onClose}><X size={16} /> رجوع</button>} />
      <Card className="p-5 sm:p-6">
        {error && <div role="alert" className="mb-5 rounded-xl border border-danger-200 bg-danger-50 px-4 py-3 text-sm text-danger-700">{error}</div>}
        <div className="grid gap-5 md:grid-cols-2">
          <div><label className="label">المادة *</label><DropdownSelect value={form.subject_id} onValueChange={(value) => onChange('subject_id', value)} options={subjects.filter((subject) => subject.is_active || subject.id === form.subject_id).map((subject) => ({ value: subject.id, label: subject.name }))} placeholder="اختر المادة" ariaLabel="المادة" /></div>
          <div><label className="label">كود الناتج *</label><input data-testid="learning-outcome-code" className="input nums-latin" value={form.code} onChange={(event) => onChange('code', event.target.value)} placeholder="مثل: MATH-ALG-01" dir="ltr" /></div>
          <div className="md:col-span-2"><label className="label">اسم ناتج التعلم *</label><input data-testid="learning-outcome-name" className="input" value={form.name_ar} onChange={(event) => onChange('name_ar', event.target.value)} placeholder="يحل المعادلات الخطية بطريقة صحيحة" /></div>
          <div><label className="label">العام الدراسي</label><input className="input" value={form.academic_year} onChange={(event) => onChange('academic_year', event.target.value)} placeholder="2026-2027" /></div>
          <div><label className="label">ترتيب العرض</label><input type="number" min="0" className="input nums-latin" value={form.display_order} onChange={(event) => onChange('display_order', event.target.value)} /></div>
          <div><label className="label">الوحدة</label><input className="input" value={form.unit} onChange={(event) => onChange('unit', event.target.value)} placeholder="الوحدة الأولى" /></div>
          <div><label className="label">الدرس أو الموضوع</label><input className="input" value={form.lesson} onChange={(event) => onChange('lesson', event.target.value)} placeholder="المعادلات" /></div>
          <div className="md:col-span-2"><label className="label">وصف اختياري</label><textarea className="input min-h-28 resize-y" value={form.description} onChange={(event) => onChange('description', event.target.value)} placeholder="وصف مختصر لما يجب أن يتقنه الطالب." /></div>
        </div>
        <div className="mt-6 flex flex-col-reverse gap-3 border-t border-ink-100 pt-5 sm:flex-row sm:justify-end"><button type="button" className="btn-outline" onClick={onClose}>إلغاء</button><button type="button" className="btn-primary" disabled={saving} onClick={onSave}>{saving ? <Loader2 size={17} className="animate-spin" /> : <Check size={17} />} {editing ? 'حفظ التعديلات' : 'إنشاء الناتج'}</button></div>
      </Card>
    </div>
  );
}
