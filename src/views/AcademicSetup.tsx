import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, BookOpen, Calendar, Check, GraduationCap, Layers3, Loader2, Plus, Search, ToggleLeft, ToggleRight, UserCheck, X } from 'lucide-react';
import { Badge, Card, EmptyState, SectionHeader } from '../components/ui';
import { supabase, useAuthSafe } from '../lib/auth-helpers';
import type { UserRole } from '../lib/auth';

type Tab = 'years' | 'stages' | 'grades' | 'classes' | 'subjects' | 'gradeSubjects' | 'teachers';

type AcademicYear = { id: string; institution_id: string; name: string; start_date: string; end_date: string; is_current: boolean; is_active: boolean };
type Stage = { id: string; institution_id: string; name: string; code: string | null; sort_order: number; is_active: boolean };
type Grade = { id: string; institution_id: string; education_stage_id: string | null; name: string; code: string | null; sort_order: number; is_active: boolean };
type Branch = { id: string; name: string; is_active: boolean };
type ClassRow = { id: string; institution_id: string; branch_id: string | null; academic_year_id: string | null; grade_level_id: string | null; name: string; academic_year: string; is_active: boolean };
type Section = { id: string; class_id: string; name: string; capacity: number | null; is_active: boolean };
type Subject = { id: string; institution_id: string; name: string; name_en: string | null; code: string | null; is_active: boolean };
type Staff = { id: string; full_name: string; role: string; is_active: boolean };
type GradeSubject = { id: string; institution_id: string; academic_year_id: string; grade_level_id: string; subject_id: string; class_id: string | null; is_required: boolean; is_active: boolean };
type SubjectTeacher = { id: string; subject_id: string; class_id: string; teacher_id: string; academic_year_id: string | null; grade_level_id: string | null; section_id: string | null; is_active: boolean };

const tabs: { id: Tab; label: string }[] = [
  { id: 'years', label: 'الأعوام الدراسية' },
  { id: 'stages', label: 'المراحل التعليمية' },
  { id: 'grades', label: 'الصفوف' },
  { id: 'classes', label: 'الفصول والشعب' },
  { id: 'subjects', label: 'المواد' },
  { id: 'gradeSubjects', label: 'توزيع المواد' },
  { id: 'teachers', label: 'توزيع المعلمين' },
];

export function AcademicSetup() {
  const { institutionId, role } = useAuthSafe();
  const canManage = ['super_admin', 'school_admin'].includes(role as UserRole);
  const [tab, setTab] = useState<Tab>('years');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ kind: Tab; row?: Record<string, unknown> } | null>(null);
  const [years, setYears] = useState<AcademicYear[]>([]);
  const [stages, setStages] = useState<Stage[]>([]);
  const [grades, setGrades] = useState<Grade[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [sections, setSections] = useState<Section[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [gradeSubjects, setGradeSubjects] = useState<GradeSubject[]>([]);
  const [subjectTeachers, setSubjectTeachers] = useState<SubjectTeacher[]>([]);

  const load = useCallback(async () => {
    if (!institutionId) return;
    setLoading(true);
    setError(null);
    const [yearRes, stageRes, gradeRes, branchRes, classRes, sectionRes, subjectRes, staffRes, gradeSubjectRes, teacherRes] = await Promise.all([
      supabase.from('academic_years').select('*').eq('institution_id', institutionId).order('start_date', { ascending: false }),
      supabase.from('education_stages').select('*').eq('institution_id', institutionId).order('sort_order'),
      supabase.from('grade_levels').select('id, institution_id, education_stage_id, name, code, sort_order, is_active').eq('institution_id', institutionId).order('sort_order'),
      supabase.from('branches').select('id, name, is_active').eq('institution_id', institutionId).order('name'),
      supabase.from('classes').select('id, institution_id, branch_id, academic_year_id, grade_level_id, name, academic_year, is_active').eq('institution_id', institutionId).order('name'),
      supabase.from('sections').select('id, class_id, name, capacity, is_active').order('name'),
      supabase.from('subjects').select('id, institution_id, name, name_en, code, is_active').eq('institution_id', institutionId).order('name'),
      supabase.from('staff_profiles').select('id, full_name, role, is_active').eq('institution_id', institutionId).eq('role', 'teacher').order('full_name'),
      supabase.from('grade_subjects').select('*').eq('institution_id', institutionId),
      supabase.from('subject_teachers').select('id, subject_id, class_id, teacher_id, academic_year_id, grade_level_id, section_id, is_active').eq('institution_id', institutionId),
    ]);
    const firstError = [yearRes, stageRes, gradeRes, branchRes, classRes, sectionRes, subjectRes, staffRes, gradeSubjectRes, teacherRes].find((res) => res.error)?.error;
    if (firstError) setError(firstError.message);
    setYears((yearRes.data as AcademicYear[]) ?? []);
    setStages((stageRes.data as Stage[]) ?? []);
    setGrades((gradeRes.data as Grade[]) ?? []);
    setBranches((branchRes.data as Branch[]) ?? []);
    setClasses((classRes.data as ClassRow[]) ?? []);
    setSections((sectionRes.data as Section[]) ?? []);
    setSubjects((subjectRes.data as Subject[]) ?? []);
    setStaff((staffRes.data as Staff[]) ?? []);
    setGradeSubjects((gradeSubjectRes.data as GradeSubject[]) ?? []);
    setSubjectTeachers((teacherRes.data as SubjectTeacher[]) ?? []);
    setLoading(false);
  }, [institutionId]);

  useEffect(() => { load(); }, [load]);

  const names = useMemo(() => ({
    year: new Map(years.map((row) => [row.id, row.name])),
    stage: new Map(stages.map((row) => [row.id, row.name])),
    grade: new Map(grades.map((row) => [row.id, row.name])),
    branch: new Map(branches.map((row) => [row.id, row.name])),
    class: new Map(classes.map((row) => [row.id, row.name])),
    section: new Map(sections.map((row) => [row.id, row.name])),
    subject: new Map(subjects.map((row) => [row.id, row.name])),
    teacher: new Map(staff.map((row) => [row.id, row.full_name])),
  }), [branches, classes, grades, sections, staff, stages, subjects, years]);

  function open(kind: Tab, row?: Record<string, unknown>) {
    setEditing({ kind, row });
    setError(null);
  }

  async function toggle(table: string, id: string, isActive: boolean) {
    if (isActive && !confirm('سيتم تعطيل السجل للعمليات الجديدة مع بقاء البيانات المرتبطة. هل تريد المتابعة؟')) return;
    const { error: err } = await supabase.from(table).update({ is_active: !isActive }).eq('id', id);
    if (err) { setError(err.message); return; }
    setNotice(isActive ? 'تم التعطيل.' : 'تم التفعيل.');
    load();
  }

  const term = query.trim().toLowerCase();
  const match = (values: Array<string | null | undefined>) => !term || values.some((value) => (value ?? '').toLowerCase().includes(term));

  if (!institutionId) return <Card className="p-8 text-center text-ink-500">لا توجد مؤسسة مرتبطة بالحساب.</Card>;
  if (!canManage) return <Card className="p-8 text-center text-ink-500">هذه الصفحة متاحة لمدير المدرسة فقط.</Card>;

  return (
    <div className="space-y-5" data-testid="academic-setup-page">
      <SectionHeader title="الإعداد الأكاديمي" subtitle="الأعوام، المراحل، الصفوف، الفصول، المواد، وتوزيع المعلمين من مصدر واحد." />
      {notice && <StateMessage tone="ok" message={notice} onClose={() => setNotice(null)} />}
      {error && <StateMessage tone="error" message={error} onClose={() => setError(null)} />}

      <Card className="p-3">
        <div className="flex gap-1 overflow-x-auto">
          {tabs.map((item) => (
            <button data-testid={`academic-tab-${item.id}`} key={item.id} onClick={() => setTab(item.id)} className={`px-3 py-2 rounded-lg text-sm font-600 whitespace-nowrap ${tab === item.id ? 'bg-brand-600 text-white' : 'text-ink-600 hover:bg-ink-100'}`}>
              {item.label}
            </button>
          ))}
        </div>
      </Card>

      <Card className="p-4 flex flex-col md:flex-row gap-3">
        <div className="flex items-center gap-2 flex-1">
          <Search size={16} className="text-ink-400" />
          <input data-testid="academic-search" className="input !py-2" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="بحث..." />
        </div>
        <button data-testid={`academic-add-${tab}`} className="btn-primary md:w-auto" onClick={() => open(tab)}><Plus size={16} /> إضافة</button>
      </Card>

      {loading ? <div data-testid="academic-loading" className="flex justify-center py-16"><Loader2 size={24} className="animate-spin text-brand-600" /></div> : (
        <>
          {tab === 'years' && <Grid empty="لم تنشأ أعوام دراسية بعد." icon={<Calendar size={40} />}>{years.filter((row) => match([row.name])).map((row) => <Item key={row.id} testId={`academic-item-year-${row.id}`} title={row.name} meta={`${row.start_date} - ${row.end_date}`} active={row.is_active} badge={row.is_current ? 'الحالي' : undefined} onEdit={() => open('years', row as unknown as Record<string, unknown>)} onToggle={() => toggle('academic_years', row.id, row.is_active)} />)}</Grid>}
          {tab === 'stages' && <Grid empty="لم تنشأ مراحل تعليمية بعد." icon={<Layers3 size={40} />}>{stages.filter((row) => match([row.name, row.code])).map((row) => <Item key={row.id} testId={`academic-item-stage-${row.id}`} title={row.name} meta={row.code ?? 'بدون كود'} active={row.is_active} onEdit={() => open('stages', row as unknown as Record<string, unknown>)} onToggle={() => toggle('education_stages', row.id, row.is_active)} />)}</Grid>}
          {tab === 'grades' && <Grid empty="أنشئ مرحلة أولاً ثم أضف الصفوف داخلها." icon={<GraduationCap size={40} />}>{grades.filter((row) => match([row.name, row.code, names.stage.get(row.education_stage_id ?? '')])).map((row) => <Item key={row.id} testId={`academic-item-grade-${row.id}`} title={row.name} meta={`${names.stage.get(row.education_stage_id ?? '') ?? 'بدون مرحلة'} · ${row.code ?? 'بدون كود'}`} active={row.is_active} onEdit={() => open('grades', row as unknown as Record<string, unknown>)} onToggle={() => toggle('grade_levels', row.id, row.is_active)} />)}</Grid>}
          {tab === 'classes' && <Grid empty="أنشئ عاماً وصفاً أولاً ثم أضف الفصول والشعب." icon={<Layers3 size={40} />}>{classes.filter((row) => match([row.name, names.grade.get(row.grade_level_id ?? ''), names.year.get(row.academic_year_id ?? '')])).map((row) => <Item key={row.id} testId={`academic-item-class-${row.id}`} title={row.name} meta={`${names.year.get(row.academic_year_id ?? '') ?? row.academic_year} · ${names.grade.get(row.grade_level_id ?? '') ?? 'بدون صف'} · ${names.branch.get(row.branch_id ?? '') ?? 'بدون فرع'} · الشعب: ${sections.filter((section) => section.class_id === row.id).map((section) => section.name).join(', ') || 'لا توجد'}`} active={row.is_active} onEdit={() => open('classes', row as unknown as Record<string, unknown>)} onToggle={() => toggle('classes', row.id, row.is_active)} />)}</Grid>}
          {tab === 'subjects' && <Grid empty="لم تنشأ مواد بعد." icon={<BookOpen size={40} />}>{subjects.filter((row) => match([row.name, row.code])).map((row) => <Item key={row.id} testId={`academic-item-subject-${row.id}`} title={row.name} meta={row.code ?? 'بدون كود'} active={row.is_active} onEdit={() => open('subjects', row as unknown as Record<string, unknown>)} onToggle={() => toggle('subjects', row.id, row.is_active)} />)}</Grid>}
          {tab === 'gradeSubjects' && <Grid empty="اربط المواد بالصفوف حتى يرثها الطلاب." icon={<BookOpen size={40} />}>{gradeSubjects.filter((row) => match([names.subject.get(row.subject_id), names.grade.get(row.grade_level_id), names.year.get(row.academic_year_id)])).map((row) => <Item key={row.id} testId={`academic-item-grade-subject-${row.id}`} title={names.subject.get(row.subject_id) ?? 'مادة'} meta={`${names.year.get(row.academic_year_id) ?? ''} · ${names.grade.get(row.grade_level_id) ?? ''} · ${row.class_id ? names.class.get(row.class_id) : 'كل فصول الصف'} · ${row.is_required ? 'إجبارية' : 'اختيارية'}`} active={row.is_active} onEdit={() => open('gradeSubjects', row as unknown as Record<string, unknown>)} onToggle={() => toggle('grade_subjects', row.id, row.is_active)} />)}</Grid>}
          {tab === 'teachers' && <Grid empty="اربط المعلمين بالمواد والفصول." icon={<UserCheck size={40} />}>{subjectTeachers.filter((row) => match([names.teacher.get(row.teacher_id), names.subject.get(row.subject_id), names.class.get(row.class_id)])).map((row) => <Item key={row.id} testId={`academic-item-teacher-${row.id}`} title={names.teacher.get(row.teacher_id) ?? 'معلم'} meta={`${names.subject.get(row.subject_id) ?? ''} · ${names.class.get(row.class_id) ?? ''} · ${row.section_id ? names.section.get(row.section_id) : 'كل الشعب'}`} active={row.is_active} onEdit={() => open('teachers', row as unknown as Record<string, unknown>)} onToggle={() => toggle('subject_teachers', row.id, row.is_active)} />)}</Grid>}
        </>
      )}

      {editing && (
        <AcademicEditor
          kind={editing.kind}
          row={editing.row}
          institutionId={institutionId}
          years={years}
          stages={stages}
          grades={grades}
          branches={branches}
          classes={classes}
          sections={sections}
          subjects={subjects}
          staff={staff}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); setNotice('تم الحفظ بنجاح.'); load(); }}
          onError={setError}
        />
      )}
    </div>
  );
}

function AcademicEditor({ kind, row, institutionId, years, stages, grades, branches, classes, sections, subjects, staff, onClose, onSaved, onError }: {
  kind: Tab; row?: Record<string, unknown>; institutionId: string; years: AcademicYear[]; stages: Stage[]; grades: Grade[]; branches: Branch[]; classes: ClassRow[]; sections: Section[]; subjects: Subject[]; staff: Staff[]; onClose: () => void; onSaved: () => void; onError: (message: string) => void;
}) {
  const [values, setValues] = useState<Record<string, string | boolean>>(() => ({
    name: String(row?.name ?? ''),
    code: String(row?.code ?? ''),
    start_date: String(row?.start_date ?? new Date().toISOString().slice(0, 10)),
    end_date: String(row?.end_date ?? new Date(new Date().getFullYear(), 11, 31).toISOString().slice(0, 10)),
    is_current: Boolean(row?.is_current ?? false),
    is_active: Boolean(row?.is_active ?? true),
    education_stage_id: String(row?.education_stage_id ?? ''),
    academic_year_id: String(row?.academic_year_id ?? years.find((year) => year.is_current)?.id ?? years[0]?.id ?? ''),
    grade_level_id: String(row?.grade_level_id ?? ''),
    branch_id: String(row?.branch_id ?? ''),
    class_id: String(row?.class_id ?? ''),
    section_id: String(row?.section_id ?? ''),
    subject_id: String(row?.subject_id ?? ''),
    teacher_id: String(row?.teacher_id ?? ''),
    is_required: Boolean(row?.is_required ?? true),
  }));
  const [saving, setSaving] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const classSections = values.class_id ? sections.filter((section) => section.class_id === values.class_id) : [];
  const selectedClass = values.class_id ? classes.find((item) => item.id === values.class_id) : null;

  function set(key: string, value: string | boolean) {
    setValues((prev) => {
      const next = { ...prev, [key]: value };
      if (key === 'education_stage_id') next.grade_level_id = '';
      if (key === 'grade_level_id') next.class_id = '';
      if (key === 'class_id') {
        next.section_id = '';
        const cls = classes.find((item) => item.id === value);
        next.grade_level_id = cls?.grade_level_id ?? next.grade_level_id;
        next.academic_year_id = cls?.academic_year_id ?? next.academic_year_id;
      }
      return next;
    });
  }

  async function save() {
    setSaving(true);
    setLocalError(null);
    let table = '';
    let payload: Record<string, unknown> = {};
    if (kind === 'years') {
      if (!values.name || !values.start_date || !values.end_date) return fail('اسم العام وتواريخه مطلوبة.');
      table = 'academic_years';
      payload = { institution_id: institutionId, name: values.name, start_date: values.start_date, end_date: values.end_date, is_current: values.is_current, is_active: values.is_active };
    } else if (kind === 'stages') {
      if (!values.name) return fail('اسم المرحلة مطلوب.');
      table = 'education_stages';
      payload = { institution_id: institutionId, name: values.name, code: values.code || null, sort_order: Number(values.sort_order || 0), is_active: values.is_active };
    } else if (kind === 'grades') {
      if (!values.name || !values.education_stage_id) return fail('اسم الصف والمرحلة مطلوبان.');
      table = 'grade_levels';
      payload = { institution_id: institutionId, education_stage_id: values.education_stage_id, name: values.name, code: values.code || null, sort_order: Number(values.sort_order || 0), is_active: values.is_active };
    } else if (kind === 'classes') {
      if (!values.name || !values.academic_year_id || !values.grade_level_id) return fail('اسم الفصل والعام والصف مطلوبة.');
      table = 'classes';
      payload = { institution_id: institutionId, name: values.name, branch_id: values.branch_id || null, academic_year_id: values.academic_year_id, academic_year: years.find((year) => year.id === values.academic_year_id)?.name ?? 'غير محدد', grade_level_id: values.grade_level_id, is_active: values.is_active };
    } else if (kind === 'subjects') {
      if (!values.name || !values.code) return fail('اسم المادة والكود مطلوبان.');
      table = 'subjects';
      payload = { institution_id: institutionId, name: values.name, name_en: null, code: String(values.code).toUpperCase(), is_active: values.is_active };
    } else if (kind === 'gradeSubjects') {
      if (!values.academic_year_id || !values.grade_level_id || !values.subject_id) return fail('العام والصف والمادة مطلوبة.');
      table = 'grade_subjects';
      payload = { institution_id: institutionId, academic_year_id: values.academic_year_id, grade_level_id: values.grade_level_id, subject_id: values.subject_id, class_id: values.class_id || null, is_required: values.is_required, is_active: values.is_active };
    } else {
      if (!values.teacher_id || !values.subject_id || !values.class_id) return fail('المعلم والمادة والفصل مطلوبة.');
      table = 'subject_teachers';
      payload = {
        teacher_id: values.teacher_id,
        subject_id: values.subject_id,
        class_id: values.class_id,
        section_id: values.section_id || null,
        academic_year_id: selectedClass?.academic_year_id ?? (values.academic_year_id || null),
        grade_level_id: selectedClass?.grade_level_id ?? (values.grade_level_id || null),
        is_active: values.is_active,
      };
    }
    const result = row?.id
      ? await supabase.from(table).update(payload).eq('id', row.id as string)
      : await supabase.from(table).insert(payload);
    setSaving(false);
    if (result.error) { onError(result.error.message); return; }
    onSaved();
  }

  function fail(message: string) {
    setSaving(false);
    setLocalError(message);
  }

  return (
    <div className="fixed inset-0 z-50 bg-ink-950/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div data-testid={`academic-editor-${kind}`} className="card w-full max-w-2xl max-h-[90vh] overflow-y-auto" onClick={(event) => event.stopPropagation()}>
        <div className="sticky top-0 bg-white border-b border-ink-100 px-6 py-4 flex items-center justify-between">
          <h3 className="font-display text-lg font-700 text-ink-900">{row?.id ? 'تعديل' : 'إضافة'} {tabs.find((item) => item.id === kind)?.label}</h3>
          <button onClick={onClose} className="text-ink-400 hover:text-ink-700"><X size={20} /></button>
        </div>
        <div className="p-6 space-y-4">
          {localError && <StateMessage tone="error" message={localError} />}
          {['years', 'stages', 'grades', 'classes', 'subjects'].includes(kind) && <Field testId="academic-field-name" label="الاسم" value={String(values.name)} onChange={(value) => set('name', value)} />}
          {['stages', 'grades', 'subjects'].includes(kind) && <Field testId="academic-field-code" label="الكود" value={String(values.code)} onChange={(value) => set('code', value)} dir="ltr" />}
          {kind === 'years' && <div className="grid grid-cols-2 gap-4"><Field testId="academic-field-start-date" label="تاريخ البداية" type="date" value={String(values.start_date)} onChange={(value) => set('start_date', value)} /><Field testId="academic-field-end-date" label="تاريخ النهاية" type="date" value={String(values.end_date)} onChange={(value) => set('end_date', value)} /></div>}
          {['grades'].includes(kind) && <Select testId="academic-select-stage" label="المرحلة" value={String(values.education_stage_id)} onChange={(value) => set('education_stage_id', value)} options={stages.filter((item) => item.is_active || item.id === values.education_stage_id).map((item) => [item.id, item.name])} />}
          {['classes'].includes(kind) && <><Select testId="academic-select-branch" label="الفرع" value={String(values.branch_id)} onChange={(value) => set('branch_id', value)} options={branches.filter((item) => item.is_active || item.id === values.branch_id).map((item) => [item.id, item.name])} optional="بدون فرع" /><Select testId="academic-select-year" label="العام الدراسي" value={String(values.academic_year_id)} onChange={(value) => set('academic_year_id', value)} options={years.filter((item) => item.is_active || item.id === values.academic_year_id).map((item) => [item.id, item.name])} /><Select testId="academic-select-grade" label="الصف" value={String(values.grade_level_id)} onChange={(value) => set('grade_level_id', value)} options={grades.filter((item) => item.is_active || item.id === values.grade_level_id).map((item) => [item.id, item.name])} /></>}
          {kind === 'gradeSubjects' && <><Select testId="academic-select-year" label="العام الدراسي" value={String(values.academic_year_id)} onChange={(value) => set('academic_year_id', value)} options={years.filter((item) => item.is_active || item.id === values.academic_year_id).map((item) => [item.id, item.name])} /><Select testId="academic-select-grade" label="الصف" value={String(values.grade_level_id)} onChange={(value) => set('grade_level_id', value)} options={grades.filter((item) => item.is_active || item.id === values.grade_level_id).map((item) => [item.id, item.name])} /><Select testId="academic-select-subject" label="المادة" value={String(values.subject_id)} onChange={(value) => set('subject_id', value)} options={subjects.filter((item) => item.is_active || item.id === values.subject_id).map((item) => [item.id, item.name])} /><Select testId="academic-select-class" label="فصل محدد" value={String(values.class_id)} onChange={(value) => set('class_id', value)} options={classes.filter((item) => item.grade_level_id === values.grade_level_id).map((item) => [item.id, item.name])} optional="كل فصول الصف" /></>}
          {kind === 'teachers' && <><Select testId="academic-select-teacher" label="المعلم" value={String(values.teacher_id)} onChange={(value) => set('teacher_id', value)} options={staff.filter((item) => item.is_active || item.id === values.teacher_id).map((item) => [item.id, item.full_name])} /><Select testId="academic-select-subject" label="المادة" value={String(values.subject_id)} onChange={(value) => set('subject_id', value)} options={subjects.filter((item) => item.is_active || item.id === values.subject_id).map((item) => [item.id, item.name])} /><Select testId="academic-select-class" label="الفصل" value={String(values.class_id)} onChange={(value) => set('class_id', value)} options={classes.filter((item) => item.is_active || item.id === values.class_id).map((item) => [item.id, `${item.name} - ${item.academic_year}`])} /><Select testId="academic-select-section" label="الشعبة" value={String(values.section_id)} onChange={(value) => set('section_id', value)} options={classSections.map((item) => [item.id, item.name])} optional="كل الشعب" /></>}
          {kind === 'gradeSubjects' && <CheckField testId="academic-check-required" label="مادة إجبارية" checked={Boolean(values.is_required)} onChange={(value) => set('is_required', value)} />}
          <CheckField testId="academic-check-active" label="نشط" checked={Boolean(values.is_active)} onChange={(value) => set('is_active', value)} />
          {kind === 'years' && <CheckField testId="academic-check-current" label="العام الحالي" checked={Boolean(values.is_current)} onChange={(value) => set('is_current', value)} />}
        </div>
        <div className="sticky bottom-0 bg-white border-t border-ink-100 px-6 py-4 flex justify-end gap-2">
          <button data-testid="academic-cancel" onClick={onClose} className="btn-ghost">إلغاء</button>
          <button data-testid="academic-save" onClick={save} disabled={saving} className="btn-primary disabled:opacity-60">{saving ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />} حفظ</button>
        </div>
      </div>
    </div>
  );
}

function Grid({ children, empty, icon }: { children: React.ReactNode; empty: string; icon: React.ReactNode }) {
  const hasChildren = Array.isArray(children) ? children.length > 0 : Boolean(children);
  return hasChildren ? <div className="grid gap-3">{children}</div> : <Card data-testid="academic-empty"><EmptyState icon={icon} title={empty} subtitle="أضف البيانات المطلوبة من زر الإضافة بالأعلى." /></Card>;
}

function Item({ title, meta, active, badge, onEdit, onToggle, testId }: { title: string; meta: string; active: boolean; badge?: string; onEdit: () => void; onToggle: () => void; testId: string }) {
  return (
    <Card data-testid={testId} className="p-4 flex items-center gap-3">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <h3 className="font-700 text-ink-900 truncate">{title}</h3>
          {badge && <Badge tone="brand">{badge}</Badge>}
          <Badge tone={active ? 'accent' : 'neutral'}>{active ? 'نشط' : 'معطل'}</Badge>
        </div>
        <p className="text-xs text-ink-500 mt-1 truncate">{meta}</p>
      </div>
      <button data-testid={`${testId}-edit`} onClick={onEdit} className="btn-outline !py-2">تعديل</button>
      <button data-testid={`${testId}-toggle`} onClick={onToggle} className="btn-ghost !p-2">{active ? <ToggleRight className="text-accent-600" /> : <ToggleLeft />}</button>
    </Card>
  );
}

function Field({ label, value, onChange, type = 'text', dir, testId }: { label: string; value: string; onChange: (value: string) => void; type?: string; dir?: 'ltr' | 'rtl'; testId: string }) {
  return <div><label className="label">{label}</label><input data-testid={testId} className="input" value={value} onChange={(event) => onChange(event.target.value)} type={type} dir={dir} /></div>;
}

function Select({ label, value, onChange, options, optional, testId }: { label: string; value: string; onChange: (value: string) => void; options: string[][]; optional?: string; testId: string }) {
  return <div><label className="label">{label}</label><select data-testid={testId} className="input" value={value} onChange={(event) => onChange(event.target.value)}><option value="">{optional ?? 'اختر'}</option>{options.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></div>;
}

function CheckField({ label, checked, onChange, testId }: { label: string; checked: boolean; onChange: (checked: boolean) => void; testId: string }) {
  return <label className="flex items-center gap-2 text-sm text-ink-700"><input data-testid={testId} type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /> {label}</label>;
}

function StateMessage({ tone, message, onClose }: { tone: 'ok' | 'error'; message: string; onClose?: () => void }) {
  return (
    <div data-testid={`academic-message-${tone}`} className={`flex items-center gap-2 p-3 rounded-xl border ${tone === 'ok' ? 'bg-accent-50 border-accent-200 text-accent-700' : 'bg-danger-50 border-danger-200 text-danger-700'}`}>
      {tone === 'ok' ? <Check size={18} /> : <AlertCircle size={18} />}
      <p className="text-sm">{message}</p>
      {onClose && <button onClick={onClose} className="mr-auto text-xs text-ink-400">إغلاق</button>}
    </div>
  );
}
