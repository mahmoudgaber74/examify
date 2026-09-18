import { useState, useEffect, useCallback, useMemo } from 'react';
import { Plus, Search, Loader2, AlertCircle, Users, Calendar, BookOpen, TrendingUp, Download, Upload, Check, X, Eye, Pencil, Archive, FileSpreadsheet, Building2, ArrowRight } from 'lucide-react';
import { Card, SectionHeader, Badge, EmptyState, ProgressBar } from '../components/ui';
import { Select as DropdownSelect } from '../components/ui/Select';
import { supabase, useAuthSafe } from '../lib/auth-helpers';
import type { UserRole } from '../lib/auth';
import { useFeedback } from '../components/FeedbackProvider';

type Tab = 'students' | 'structure' | 'attendance' | 'grades' | 'subjects';
type StudentStatus = 'active' | 'suspended' | 'graduated' | 'archived';

interface StudentRow {
  id: string;
  institution_id: string;
  first_name: string | null;
  father_name: string | null;
  family_name: string | null;
  full_name: string;
  full_name_en: string | null;
  student_code: string | null;
  seat_number: string | null;
  national_id: string | null;
  gender: string | null;
  birth_date: string | null;
  email: string | null;
  phone: string | null;
  avatar_url: string | null;
  grade_level_id: string | null;
  status: StudentStatus | null;
  is_active: boolean;
  archived_at: string | null;
}

interface ClassRow { id: string; institution_id: string; name: string; grade_level_id: string | null; branch_id: string | null; academic_year: string; academic_year_id?: string | null; is_active: boolean; }
interface AcademicYearRow { id: string; institution_id: string; name: string; is_active: boolean; is_current?: boolean; }
interface GradeLevelRow { id: string; institution_id: string; name: string; name_en: string | null; education_stage_id?: string | null; sort_order: number; is_active: boolean; }
interface BranchRow { id: string; institution_id: string; name: string; address: string | null; phone: string | null; is_active: boolean; }
interface SectionRow { id: string; institution_id?: string; name: string; code?: string | null; class_id: string; academic_year_id?: string | null; grade_level_id?: string | null; branch_id?: string | null; capacity: number | null; is_active: boolean; }
interface SubjectRow {
  id: string;
  institution_id: string;
  name: string;
  name_en: string | null;
  code: string | null;
  is_active: boolean;
  created_at: string | null;
}
interface ClassStudentRow { id: string; class_id: string; section_id: string | null; student_id: string; academic_year_id?: string | null; grade_level_id?: string | null; status?: string | null; seat_number?: string | null; }
interface GradeBookRow { id: string; student_id: string; subject_id: string; assessment_title: string; score: number; max_score: number; weight: number; subjects: { name: string }; }

type StudentProfileQueryRow = {
  id: string;
  institution_id: string;
  full_name: string;
  full_name_en: string | null;
  student_code: string | null;
  phone: string | null;
  avatar_url: string | null;
  grade_level_id: string | null;
  is_active: boolean;
  first_name?: string | null;
  father_name?: string | null;
  family_name?: string | null;
  seat_number?: string | null;
  national_id?: string | null;
  gender?: string | null;
  birth_date?: string | null;
  email?: string | null;
  status?: StudentStatus | null;
  archived_at?: string | null;
};

const STUDENT_PROFILE_BASE_SELECT = 'id, institution_id, first_name, father_name, family_name, full_name, full_name_en, student_code, seat_number, national_id, gender, birth_date, email, phone, avatar_url, grade_level_id, status, archived_at, is_active';

interface StudentFormValues {
  id?: string;
  firstName: string;
  fatherName: string;
  familyName: string;
  fullName: string;
  fullNameEn: string;
  studentCode: string;
  seatNumber: string;
  nationalId: string;
  gender: '' | 'male' | 'female' | 'other';
  birthDate: string;
  email: string;
  phone: string;
  academicYearId: string;
  branchId: string;
  gradeLevelId: string;
  classId: string;
  sectionId: string;
  status: StudentStatus;
  parentName: string;
  parentRelationship: string;
  parentPhone: string;
  parentEmail: string;
}

const emptyStudentForm: StudentFormValues = {
  firstName: '',
  fatherName: '',
  familyName: '',
  fullName: '',
  fullNameEn: '',
  studentCode: '',
  seatNumber: '',
  nationalId: '',
  gender: '',
  birthDate: '',
  email: '',
  phone: '',
  academicYearId: '',
  branchId: '',
  gradeLevelId: '',
  classId: '',
  sectionId: '',
  status: 'active',
  parentName: '',
  parentRelationship: '',
  parentPhone: '',
  parentEmail: '',
};

const statusLabels: Record<StudentStatus, string> = {
  active: 'نشط',
  suspended: 'موقوف',
  graduated: 'متخرج',
  archived: 'مؤرشف',
};

export function SIS() {
  const { institutionId, role, user } = useAuthSafe();
  const canEdit = ['super_admin', 'school_admin'].includes(role as UserRole);
  const canManageStudents = ['super_admin', 'school_admin', 'data_entry'].includes(role as UserRole);
  const canManageSubjects = ['super_admin', 'school_admin'].includes(role as UserRole);
  const canManageStructure = ['super_admin', 'school_admin'].includes(role as UserRole);
  const [tab, setTab] = useState<Tab>('students');
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [academicYears, setAcademicYears] = useState<AcademicYearRow[]>([]);
  const [gradeLevels, setGradeLevels] = useState<GradeLevelRow[]>([]);
  const [branches, setBranches] = useState<BranchRow[]>([]);
  const [sections, setSections] = useState<SectionRow[]>([]);
  const [subjects, setSubjects] = useState<SubjectRow[]>([]);
  const [classStudents, setClassStudents] = useState<ClassStudentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadMeta = useCallback(async () => {
    if (!institutionId) return;
    const [yearRes, branchRes, gradeRes, classRes, sectionRes, subjectRes] = await Promise.all([
      supabase.from('academic_years').select('id, institution_id, name, is_active, is_current').eq('institution_id', institutionId).order('name', { ascending: false }),
      supabase.from('branches').select('id, institution_id, name, address, phone, is_active').eq('institution_id', institutionId).order('name'),
      supabase.from('grade_levels').select('id, institution_id, education_stage_id, name, name_en, sort_order, is_active').eq('institution_id', institutionId).order('sort_order'),
      supabase.from('classes').select('id, institution_id, name, grade_level_id, branch_id, academic_year, academic_year_id, is_active').eq('institution_id', institutionId).order('name'),
      supabase.from('sections').select('id, institution_id, name, code, class_id, academic_year_id, grade_level_id, branch_id, capacity, is_active').eq('institution_id', institutionId).order('name'),
      supabase.from('subjects').select('id, institution_id, name, name_en, code, is_active, created_at').eq('institution_id', institutionId).order('name'),
    ]);
    setAcademicYears((yearRes.data as AcademicYearRow[]) ?? []);
    setBranches((branchRes.data as BranchRow[]) ?? []);
    setGradeLevels(((gradeRes.data as Omit<GradeLevelRow, 'is_active'>[] | null) ?? []).map((row) => ({ ...row, is_active: true })));
    setClasses((classRes.data as ClassRow[]) ?? []);
    setSections((sectionRes.data as SectionRow[]) ?? []);
    setSubjects((subjectRes.data as SubjectRow[]) ?? []);
  }, [institutionId]);

  const loadStudents = useCallback(async () => {
    if (!institutionId) return;
    setLoading(true);
    setError(null);

    const [studentRes, classStudentRes] = await Promise.all([
      supabase
        .from('student_profiles')
        .select(STUDENT_PROFILE_BASE_SELECT)
        .eq('institution_id', institutionId)
        .order('full_name'),
      supabase.from('class_students').select('id, institution_id, class_id, section_id, student_id, academic_year_id, grade_level_id, status, seat_number').eq('institution_id', institutionId).eq('status', 'active'),
    ]);

    const studentRows = studentRes.data as StudentProfileQueryRow[] | null;
    if (studentRes.error) {
      setError(studentRes.error.message);
      setLoading(false);
      return;
    }
    setStudents((studentRows ?? []).map(normalizeStudentProfileRow));
    setClassStudents((classStudentRes.data as ClassStudentRow[]) ?? []);
    setLoading(false);
  }, [institutionId]);

  useEffect(() => { loadMeta(); }, [loadMeta]);
  useEffect(() => { loadStudents(); }, [loadStudents]);
  useEffect(() => {
    if (tab === 'subjects' && !canManageSubjects) setTab('students');
  }, [canManageSubjects, tab]);

  const activeSubjects = useMemo(() => subjects.filter((subject) => subject.is_active), [subjects]);

  return (
    <div className="space-y-5">
      <SectionHeader title="إدارة الطلاب" subtitle="إدارة بيانات الطلاب وتسجيلهم ومتابعة الحضور والدرجات داخل المؤسسة." />

      {error && (
        <div className="flex items-center gap-2 p-3 rounded-xl bg-danger-50 border border-danger-200">
          <AlertCircle size={18} className="text-danger-600" />
          <p className="text-sm text-danger-700">{error}</p>
          <button onClick={() => setError(null)} className="mr-auto text-xs text-ink-400">إغلاق</button>
        </div>
      )}

      <div className={`grid grid-cols-2 gap-1.5 rounded-2xl border border-ink-100 bg-ink-100/80 p-1.5 shadow-sm ${canManageStructure ? 'sm:grid-cols-5' : 'sm:grid-cols-4'}`}>
        <TabBtn tab="students" current={tab} onClick={setTab} icon={<Users size={16} />} label="الطلاب" />
        <TabBtn tab="attendance" current={tab} onClick={setTab} icon={<Calendar size={16} />} label="الحضور والغياب" />
        <TabBtn tab="grades" current={tab} onClick={setTab} icon={<TrendingUp size={16} />} label="الدرجات" />
        {canManageSubjects && <TabBtn tab="subjects" current={tab} onClick={setTab} icon={<BookOpen size={16} />} label="المواد" />}
        {canManageStructure && <TabBtn tab="structure" current={tab} onClick={setTab} icon={<Building2 size={16} />} label="الهيكل الأكاديمي" />}
      </div>

      {tab === 'structure' && canManageStructure && (
        <AcademicStructureTab
          institutionId={institutionId ?? ''}
          branches={branches}
          gradeLevels={gradeLevels}
          classes={classes}
          sections={sections}
          onUpdated={loadMeta}
        />
      )}
      {tab === 'students' && (
        <StudentsTab
          institutionId={institutionId ?? ''}
          actorId={user?.id ?? null}
          role={role}
          academicYears={academicYears}
          students={students}
          classStudents={classStudents}
          classes={classes}
          gradeLevels={gradeLevels}
          branches={branches}
          sections={sections}
          loading={loading}
          canManageStudents={canManageStudents}
          onUpdated={loadStudents}
        />
      )}
      {tab === 'attendance' && <AttendanceTab institutionId={institutionId ?? ''} students={students.filter((s) => s.status !== 'archived')} classStudents={classStudents} classes={classes} subjects={activeSubjects} canEdit={canEdit} />}
      {tab === 'grades' && <GradesTab institutionId={institutionId ?? ''} students={students.filter((s) => s.status !== 'archived')} classStudents={classStudents} classes={classes} subjects={activeSubjects} canEdit={canEdit} />}
      {tab === 'subjects' && canManageSubjects && (
        <SubjectsTab
          institutionId={institutionId ?? ''}
          actorId={user?.id ?? null}
          role={role}
          subjects={subjects}
          loading={loading}
          onUpdated={loadMeta}
        />
      )}
    </div>
  );
}

function TabBtn({ tab, current, onClick, icon, label }: { tab: Tab; current: Tab; onClick: (t: Tab) => void; icon: React.ReactNode; label: string }) {
  return <button data-testid={`sis-tab-${tab}`} onClick={() => onClick(tab)} className={`flex min-h-11 min-w-0 items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-center text-sm font-600 transition ${current === tab ? 'bg-white text-brand-700 shadow-sm ring-1 ring-ink-100' : 'text-ink-500 hover:bg-white/70 hover:text-ink-800'}`}><span className="shrink-0">{icon}</span><span className="truncate">{label}</span></button>;
}

type StructureKind = 'branch' | 'grade' | 'class' | 'section';

function AcademicStructureTab({
  institutionId,
  branches,
  gradeLevels,
  classes,
  sections,
  onUpdated,
}: {
  institutionId: string;
  branches: BranchRow[];
  gradeLevels: GradeLevelRow[];
  classes: ClassRow[];
  sections: SectionRow[];
  onUpdated: () => void;
}) {
  const { confirm } = useFeedback();
  const [editing, setEditing] = useState<{ kind: StructureKind; id?: string } | null>(null);
  const [form, setForm] = useState({
    name: '',
    nameEn: '',
    address: '',
    phone: '',
    branchId: '',
    gradeLevelId: '',
    classId: '',
    academicYear: '2026-2027',
    sortOrder: '0',
    capacity: '30',
    isActive: true,
  });
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const activeBranches = branches.filter((row) => row.is_active);
  const activeGrades = gradeLevels.filter((row) => row.is_active);
  const activeClasses = classes.filter((row) => row.is_active);

  function openCreate(kind: StructureKind) {
    setEditing({ kind });
    setError(null);
    setForm({
      name: '',
      nameEn: '',
      address: '',
      phone: '',
      branchId: '',
      gradeLevelId: '',
      classId: '',
      academicYear: '2026-2027',
      sortOrder: String(gradeLevels.length + 1),
      capacity: '30',
      isActive: true,
    });
  }

  function openEdit(kind: StructureKind, row: BranchRow | GradeLevelRow | ClassRow | SectionRow) {
    setEditing({ kind, id: row.id });
    setError(null);
    if (kind === 'branch') {
      const branch = row as BranchRow;
      setForm((prev) => ({ ...prev, name: branch.name, address: branch.address ?? '', phone: branch.phone ?? '', isActive: branch.is_active }));
    } else if (kind === 'grade') {
      const grade = row as GradeLevelRow;
      setForm((prev) => ({ ...prev, name: grade.name, nameEn: grade.name_en ?? '', sortOrder: String(grade.sort_order), isActive: grade.is_active }));
    } else if (kind === 'class') {
      const classRow = row as ClassRow;
      setForm((prev) => ({
        ...prev,
        name: classRow.name,
        branchId: classRow.branch_id ?? '',
        gradeLevelId: classRow.grade_level_id ?? '',
        academicYear: classRow.academic_year,
        isActive: classRow.is_active,
      }));
    } else {
      const section = row as SectionRow;
      setForm((prev) => ({ ...prev, name: section.name, classId: section.class_id, capacity: String(section.capacity ?? 30), isActive: section.is_active }));
    }
  }

  async function save() {
    if (!editing) return;
    if (!form.name.trim()) {
      setError('الاسم مطلوب.');
      return;
    }
    setSaving(true);
    setError(null);

    let result: { error: { message: string } | null };
    if (editing.kind === 'branch') {
      const payload = { institution_id: institutionId, name: form.name.trim(), address: form.address.trim() || null, phone: form.phone.trim() || null, is_active: form.isActive };
      result = editing.id
        ? await supabase.from('branches').update(payload).eq('id', editing.id)
        : await supabase.from('branches').insert(payload);
    } else if (editing.kind === 'grade') {
      const payload = { institution_id: institutionId, name: form.name.trim(), name_en: form.nameEn.trim() || null, sort_order: Number(form.sortOrder) || 0 };
      result = editing.id
        ? await supabase.from('grade_levels').update(payload).eq('id', editing.id)
        : await supabase.from('grade_levels').insert(payload);
    } else if (editing.kind === 'class') {
      const payload = {
        institution_id: institutionId,
        name: form.name.trim(),
        branch_id: form.branchId || null,
        grade_level_id: form.gradeLevelId || null,
        academic_year: form.academicYear.trim() || '2026-2027',
        is_active: form.isActive,
      };
      result = editing.id
        ? await supabase.from('classes').update(payload).eq('id', editing.id)
        : await supabase.from('classes').insert(payload);
    } else {
      if (!form.classId) {
        setSaving(false);
        setError('اختر الفصل قبل حفظ الشعبة.');
        return;
      }
      const payload = { class_id: form.classId, name: form.name.trim(), capacity: Number(form.capacity) || 30, is_active: form.isActive };
      result = editing.id
        ? await supabase.from('sections').update(payload).eq('id', editing.id)
        : await supabase.from('sections').insert(payload);
    }

    setSaving(false);
    if (result.error) {
      setError(formatAcademicError(result.error.message));
      return;
    }
    setSuccess(editing.id ? 'تم حفظ التعديلات.' : 'تم إنشاء السجل.');
    setEditing(null);
    onUpdated();
  }

  async function toggle(kind: StructureKind, id: string, active: boolean) {
    const next = !active;
    if (!next && !(await confirm('سيتم تعطيل السجل للعمليات الجديدة مع بقاء السجلات التاريخية ظاهرة. هل تريد المتابعة؟', { title: 'تعطيل السجل', confirmLabel: 'تعطيل السجل' }))) return;
    const table = kind === 'branch' ? 'branches' : kind === 'grade' ? 'grade_levels' : kind === 'class' ? 'classes' : 'sections';
    const { error: updateError } = await supabase.from(table).update({ is_active: next }).eq('id', id);
    if (updateError) {
      setError(formatAcademicError(updateError.message));
      return;
    }
    setSuccess(next ? 'تم تفعيل السجل.' : 'تم تعطيل السجل.');
    onUpdated();
  }

  return (
    <div className="space-y-4">
      {success && (
        <div className="flex items-center gap-2 p-3 rounded-xl bg-accent-50 border border-accent-200">
          <Check size={18} className="text-accent-600" />
          <p className="text-sm text-accent-700">{success}</p>
          <button onClick={() => setSuccess(null)} className="mr-auto text-xs text-ink-400">إغلاق</button>
        </div>
      )}
      {error && <FormError message={error} />}

      <Card className="p-4">
        <div className="flex flex-wrap gap-2">
          <button data-testid="structure-add-branch" onClick={() => openCreate('branch')} className="btn-outline"><Plus size={16} /> إضافة فرع</button>
          <button data-testid="structure-add-grade" onClick={() => openCreate('grade')} className="btn-outline"><Plus size={16} /> إضافة صف دراسي</button>
          <button data-testid="structure-add-class" onClick={() => openCreate('class')} className="btn-outline"><Plus size={16} /> إضافة فصل</button>
          <button data-testid="structure-add-section" onClick={() => openCreate('section')} className="btn-outline"><Plus size={16} /> إضافة شعبة</button>
        </div>
      </Card>

      <div className="grid lg:grid-cols-2 gap-4">
        <Card className="p-4">
          <h3 className="font-700 text-ink-900 mb-3">العلاقات الهرمية</h3>
          {classes.length === 0 ? (
            <EmptyState icon={<Building2 size={40} />} title="لا يوجد هيكل أكاديمي بعد" subtitle="ابدأ بإضافة صف دراسي ثم فصل وشعبة." />
          ) : (
            <div className="space-y-3">
              {gradeLevels.map((grade) => {
                const gradeClasses = classes.filter((row) => row.grade_level_id === grade.id);
                return (
                  <div key={grade.id} className="rounded-xl border border-ink-100 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <p className="font-700 text-ink-900">{grade.name}</p>
                        <p className="text-xs text-ink-400 nums-latin">ترتيب {grade.sort_order}</p>
                      </div>
                      <div className="flex items-center gap-1">
                        <Badge tone={grade.is_active ? 'accent' : 'neutral'}>{grade.is_active ? 'نشط' : 'غير نشط'}</Badge>
                        <button data-testid="structure-edit-grade" onClick={() => openEdit('grade', grade)} className="btn-ghost !p-2"><Pencil size={15} /></button>
                        <button onClick={() => toggle('grade', grade.id, grade.is_active)} className="btn-ghost !p-2"><Check size={15} /></button>
                      </div>
                    </div>
                    <div className="mt-3 space-y-2">
                      {gradeClasses.map((classRow) => {
                        const branch = classRow.branch_id ? branches.find((row) => row.id === classRow.branch_id) : null;
                        const classSections = sections.filter((section) => section.class_id === classRow.id);
                        return (
                          <div key={classRow.id} className="rounded-lg bg-ink-50 p-3">
                            <div className="flex items-center justify-between gap-2">
                              <div>
                                <p className="font-600 text-ink-800">{classRow.name}</p>
                                <p className="text-xs text-ink-400">{branch?.name ?? 'بدون فرع'} · <span className="nums-latin">{classRow.academic_year}</span></p>
                              </div>
                              <div className="flex items-center gap-1">
                                <Badge tone={classRow.is_active ? 'accent' : 'neutral'}>{classRow.is_active ? 'نشط' : 'غير نشط'}</Badge>
                                <button data-testid="structure-edit-class" onClick={() => openEdit('class', classRow)} className="btn-ghost !p-2"><Pencil size={15} /></button>
                                <button onClick={() => toggle('class', classRow.id, classRow.is_active)} className="btn-ghost !p-2"><Check size={15} /></button>
                              </div>
                            </div>
                            <div className="mt-2 flex flex-wrap gap-2">
                              {classSections.map((section) => (
                                <span key={section.id} className="inline-flex items-center gap-1 rounded-lg bg-white border border-ink-100 px-2 py-1 text-xs">
                                  {section.name}
                                  <span className="nums-latin text-ink-400">({section.capacity ?? 30})</span>
                                  <Badge tone={section.is_active ? 'accent' : 'neutral'}>{section.is_active ? 'نشط' : 'غير نشط'}</Badge>
                                  <button data-testid="structure-edit-section" onClick={() => openEdit('section', section)} className="text-ink-400 hover:text-ink-700"><Pencil size={13} /></button>
                                  <button onClick={() => toggle('section', section.id, section.is_active)} className="text-ink-400 hover:text-ink-700"><Check size={13} /></button>
                                </span>
                              ))}
                              {classSections.length === 0 && <span className="text-xs text-ink-400">لا توجد شعب داخل هذا الفصل.</span>}
                            </div>
                          </div>
                        );
                      })}
                      {gradeClasses.length === 0 && <p className="text-xs text-ink-400">لا توجد فصول داخل هذا الصف الدراسي.</p>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        <Card className="p-4">
          <h3 className="font-700 text-ink-900 mb-3">الفروع</h3>
          <div className="space-y-2">
            {branches.map((branch) => (
              <div key={branch.id} className="flex items-center justify-between gap-2 rounded-lg border border-ink-100 p-3">
                <div>
                  <p className="font-600 text-ink-900">{branch.name}</p>
                  <p className="text-xs text-ink-400">{branch.address || 'بدون عنوان'} {branch.phone ? `· ${branch.phone}` : ''}</p>
                </div>
                <div className="flex items-center gap-1">
                  <Badge tone={branch.is_active ? 'accent' : 'neutral'}>{branch.is_active ? 'نشط' : 'غير نشط'}</Badge>
                  <button data-testid="structure-edit-branch" onClick={() => openEdit('branch', branch)} className="btn-ghost !p-2"><Pencil size={15} /></button>
                  <button onClick={() => toggle('branch', branch.id, branch.is_active)} className="btn-ghost !p-2"><Check size={15} /></button>
                </div>
              </div>
            ))}
            {branches.length === 0 && <p className="text-sm text-ink-400">لا توجد فروع. يمكن تشغيل الهيكل بدون فرع.</p>}
          </div>
        </Card>
      </div>

      {editing && (
        <div className="fixed inset-0 z-50 bg-ink-950/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setEditing(null)}>
          <div className="card w-full max-w-xl" onClick={(event) => event.stopPropagation()}>
            <div className="border-b border-ink-100 px-6 py-4 flex items-center justify-between">
              <h3 className="font-display text-lg font-700 text-ink-900">{editing.id ? 'تعديل السجل' : 'إضافة سجل'}</h3>
              <button onClick={() => setEditing(null)} className="text-ink-400 hover:text-ink-700"><X size={20} /></button>
            </div>
            <div className="p-6 space-y-4">
              {error && <FormError message={error} />}
              <TextField label="الاسم" value={form.name} onChange={(value) => setForm((prev) => ({ ...prev, name: value }))} required placeholder="أدخل الاسم" />
              {editing.kind === 'branch' && (
                <>
                  <TextField label="العنوان" value={form.address} onChange={(value) => setForm((prev) => ({ ...prev, address: value }))} placeholder="العنوان" />
                  <TextField label="الهاتف" value={form.phone} onChange={(value) => setForm((prev) => ({ ...prev, phone: value }))} dir="ltr" placeholder="+201000000000" />
                </>
              )}
              {editing.kind === 'grade' && (
                <>
                  <TextField label="الاسم بالإنجليزية" value={form.nameEn} onChange={(value) => setForm((prev) => ({ ...prev, nameEn: value }))} dir="ltr" placeholder="اسم الصف بالإنجليزية" />
                  <TextField label="الترتيب" type="number" value={form.sortOrder} onChange={(value) => setForm((prev) => ({ ...prev, sortOrder: value }))} />
                </>
              )}
              {editing.kind === 'class' && (
                <>
                  <SelectField label="الفرع" value={form.branchId} onChange={(value) => setForm((prev) => ({ ...prev, branchId: value }))} options={[['', 'بدون فرع'], ...activeBranches.map((branch) => [branch.id, branch.name] as [string, string])]} />
                  <SelectField label="الصف الدراسي" value={form.gradeLevelId} onChange={(value) => setForm((prev) => ({ ...prev, gradeLevelId: value }))} options={[['', 'غير محدد'], ...activeGrades.map((grade) => [grade.id, grade.name] as [string, string])]} />
                  <TextField label="العام الدراسي" value={form.academicYear} onChange={(value) => setForm((prev) => ({ ...prev, academicYear: value }))} dir="ltr" placeholder="2026-2027" />
                </>
              )}
              {editing.kind === 'section' && (
                <>
                  <SelectField label="الفصل" value={form.classId} onChange={(value) => setForm((prev) => ({ ...prev, classId: value }))} options={[['', 'اختر الفصل'], ...activeClasses.map((classRow) => [classRow.id, classRow.name] as [string, string])]} />
                  <TextField label="السعة" type="number" value={form.capacity} onChange={(value) => setForm((prev) => ({ ...prev, capacity: value }))} />
                </>
              )}
              <label className="flex items-center gap-2 text-sm text-ink-700">
                <input type="checkbox" checked={form.isActive} onChange={(event) => setForm((prev) => ({ ...prev, isActive: event.target.checked }))} />
                نشط
              </label>
            </div>
            <div className="border-t border-ink-100 px-6 py-4 flex justify-end gap-2">
              <button onClick={() => setEditing(null)} className="btn-ghost">إلغاء</button>
              <button data-testid="structure-save" onClick={save} disabled={saving} className="btn-primary disabled:opacity-60">
                {saving ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
                حفظ
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SubjectsTab({
  institutionId,
  actorId,
  role,
  subjects,
  loading,
  onUpdated,
}: {
  institutionId: string;
  actorId: string | null;
  role: UserRole;
  subjects: SubjectRow[];
  loading: boolean;
  onUpdated: () => void;
}) {
  const { confirm } = useFeedback();
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [editing, setEditing] = useState<SubjectRow | null>(null);
  const [showEditor, setShowEditor] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const filteredSubjects = useMemo(() => {
    const term = query.trim().toLowerCase();
    return subjects.filter((subject) => {
      const matchesText = !term || [
        subject.name,
        subject.name_en ?? '',
        subject.code ?? '',
      ].some((value) => value.toLowerCase().includes(term));
      const matchesStatus = statusFilter === 'all'
        || (statusFilter === 'active' && subject.is_active)
        || (statusFilter === 'inactive' && !subject.is_active);
      return matchesText && matchesStatus;
    });
  }, [query, statusFilter, subjects]);

  async function toggleSubject(subject: SubjectRow) {
    const nextActive = !subject.is_active;
    if (!nextActive && !(await confirm(`هل تريد تعطيل مادة "${subject.name}"؟ ستظل السجلات السابقة مرتبطة بها.`, { title: 'تعطيل المادة', confirmLabel: 'تعطيل المادة' }))) return;
    setError(null);
    const { error: err } = await supabase
      .from('subjects')
      .update({ is_active: nextActive })
      .eq('id', subject.id)
      .select('id')
      .single();
    if (err) {
      setError(err.message);
      return;
    }
    await writeAudit(institutionId, actorId, role, nextActive ? 'subject.activate' : 'subject.disable', 'subjects', subject.id, { name: subject.name, code: subject.code });
    setSuccess(nextActive ? 'تم تفعيل المادة بنجاح.' : 'تم تعطيل المادة بنجاح.');
    onUpdated();
  }

  function openCreate() {
    setEditing(null);
    setShowEditor(true);
  }

  function openEdit(subject: SubjectRow) {
    setEditing(subject);
    setShowEditor(true);
  }

  if (loading) return <div className="flex justify-center py-16"><Loader2 size={24} className="animate-spin text-brand-600" /></div>;

  return (
    <div className="space-y-4">
      {success && (
        <div className="flex items-center gap-2 p-3 rounded-xl bg-accent-50 border border-accent-200">
          <Check size={18} className="text-accent-600" />
          <p className="text-sm text-accent-700">{success}</p>
          <button onClick={() => setSuccess(null)} className="mr-auto text-xs text-ink-400">إغلاق</button>
        </div>
      )}
      {error && <FormError message={error} />}

      <Card className="space-y-4 p-4 sm:p-5">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:items-end">
          <label className="min-w-0 space-y-1.5">
            <span className="label mb-0">البحث</span>
            <div className="flex items-center gap-2">
              <Search size={16} className="shrink-0 text-ink-400" />
              <input className="input h-12 w-full !py-0" placeholder="ابحث باسم المادة أو الكود" value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>
          </label>
          <label className="space-y-1.5">
            <span className="label mb-0">حالة المادة</span>
            <DropdownSelect
              value={statusFilter}
              onValueChange={(value) => setStatusFilter(value as 'all' | 'active' | 'inactive')}
              options={[{ value: 'all', label: 'جميع الحالات' }, { value: 'active', label: 'المواد النشطة' }, { value: 'inactive', label: 'المواد المعطلة' }]}
              ariaLabel="حالة المادة"
              testId="subject-status-filter"
            />
          </label>
          <button onClick={openCreate} className="btn-primary h-12 w-full"><Plus size={16} /> إضافة مادة</button>
        </div>
      </Card>

      {subjects.length === 0 ? (
        <Card>
          <EmptyState icon={<BookOpen size={40} />} title="لم تتم إضافة مواد حتى الآن" subtitle="أضف أول مادة لاستخدامها في الامتحانات والأسئلة والدرجات والدروس." />
          <div className="flex justify-center pb-8"><button onClick={openCreate} className="btn-primary"><Plus size={16} /> إضافة أول مادة</button></div>
        </Card>
      ) : filteredSubjects.length === 0 ? (
        <Card><EmptyState icon={<Search size={40} />} title="لا توجد مواد مطابقة" subtitle="عدّل البحث أو فلتر الحالة." /></Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-ink-50 text-ink-500 text-xs">
                <tr>
                  <th className="text-right font-600 px-4 py-3">الاسم العربي</th>
                  <th className="text-right font-600 px-4 py-3">الاسم الإنجليزي</th>
                  <th className="text-right font-600 px-4 py-3">الكود</th>
                  <th className="text-right font-600 px-4 py-3">الحالة</th>
                  <th className="text-right font-600 px-4 py-3">تاريخ الإنشاء</th>
                  <th className="text-right font-600 px-4 py-3">الإجراءات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-50">
                {filteredSubjects.map((subject) => (
                  <tr key={subject.id} className="hover:bg-ink-50/50">
                    <td className="px-4 py-3 font-700 text-ink-900">{subject.name}</td>
                    <td className="px-4 py-3 text-ink-600">{subject.name_en || 'غير مسجل'}</td>
                    <td className="px-4 py-3"><span className="font-mono text-xs text-ink-600 nums-latin">{subject.code || 'غير مسجل'}</span></td>
                    <td className="px-4 py-3"><Badge tone={subject.is_active ? 'accent' : 'neutral'}>{subject.is_active ? 'نشطة' : 'معطلة'}</Badge></td>
                    <td className="px-4 py-3 text-ink-500 nums-latin">{subject.created_at ? formatArabicDate(subject.created_at) : 'غير مسجل'}</td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1">
                        <button onClick={() => openEdit(subject)} className="grid place-items-center w-8 h-8 rounded-lg text-ink-400 hover:bg-ink-100 hover:text-ink-700" title="تعديل" aria-label="تعديل المادة"><Pencil size={16} /></button>
                        <button onClick={() => toggleSubject(subject)} className={`grid place-items-center w-8 h-8 rounded-lg ${subject.is_active ? 'text-warning-600 hover:bg-warning-50' : 'text-accent-600 hover:bg-accent-50'}`} title={subject.is_active ? 'تعطيل' : 'تفعيل'} aria-label={subject.is_active ? 'تعطيل المادة' : 'تفعيل المادة'}>
                          {subject.is_active ? <X size={16} /> : <Check size={16} />}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {showEditor && (
        <SubjectEditor
          institutionId={institutionId}
          actorId={actorId}
          role={role}
          subjects={subjects}
          editing={editing}
          onClose={() => setShowEditor(false)}
          onSaved={(message) => {
            setShowEditor(false);
            setEditing(null);
            setSuccess(message);
            onUpdated();
          }}
        />
      )}
    </div>
  );
}

function SubjectEditor({
  institutionId,
  actorId,
  role,
  subjects,
  editing,
  onClose,
  onSaved,
}: {
  institutionId: string;
  actorId: string | null;
  role: UserRole;
  subjects: SubjectRow[];
  editing: SubjectRow | null;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [name, setName] = useState(editing?.name ?? '');
  const [nameEn, setNameEn] = useState(editing?.name_en ?? '');
  const [code, setCode] = useState(editing?.code ?? '');
  const [isActive, setIsActive] = useState(editing?.is_active ?? true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    const normalized = normalizeSubjectForm({ name, nameEn, code });
    const validation = validateSubject(normalized, subjects, editing?.id);
    if (!validation.valid) {
      setError(Object.values(validation.errors).join(' '));
      setSaving(false);
      return;
    }

    const payload = {
      institution_id: institutionId,
      name: normalized.name,
      name_en: normalized.nameEn || null,
      code: normalized.code,
      is_active: isActive,
    };

    const result = editing
      ? await supabase.from('subjects').update(payload).eq('id', editing.id).select('id').single()
      : await supabase.from('subjects').insert(payload).select('id').single();

    if (result.error) {
      setError(subjectErrorMessage(result.error.message));
      setSaving(false);
      return;
    }

    const savedId = (result.data as { id: string }).id;
    await writeAudit(institutionId, actorId, role, editing ? 'subject.update' : 'subject.create', 'subjects', savedId, { name: normalized.name, code: normalized.code });
    setSaving(false);
    onSaved(editing ? 'تم حفظ تعديلات المادة بنجاح.' : 'تمت إضافة المادة بنجاح.');
  }

  return (
    <div className="fixed inset-0 z-50 bg-ink-950/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div className="card w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
        <div className="border-b border-ink-100 px-6 py-4 flex items-center justify-between">
          <h3 className="font-display text-lg font-700 text-ink-900">{editing ? 'تعديل المادة' : 'إضافة مادة'}</h3>
          <button onClick={onClose} className="text-ink-400 hover:text-ink-700" aria-label="إغلاق"><X size={20} /></button>
        </div>
        <div className="p-6 space-y-4">
          {error && <FormError message={error} />}
          <div><label className="label">اسم المادة بالعربية</label><input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="مثال: رياضيات" /></div>
          <div><label className="label">اسم المادة بالإنجليزية</label><input className="input" value={nameEn} onChange={(e) => setNameEn(e.target.value)} placeholder="مثال: Mathematics" /></div>
          <div><label className="label">كود المادة</label><input className="input nums-latin" dir="ltr" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="MATH" /></div>
          <label className="flex items-center justify-between p-3 rounded-xl bg-ink-50 cursor-pointer">
            <span>
              <span className="block text-sm font-700 text-ink-900">مادة نشطة</span>
              <span className="block text-xs text-ink-500">تظهر المواد النشطة عند إنشاء الامتحانات والأسئلة والدرجات والحضور والدروس.</span>
            </span>
            <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} className="w-5 h-5 accent-brand-600" />
          </label>
        </div>
        <div className="border-t border-ink-100 px-6 py-4 flex justify-end gap-2">
          <button onClick={onClose} className="btn-ghost">إلغاء</button>
          <button onClick={save} disabled={saving} className="btn-primary disabled:opacity-60">{saving ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}{editing ? 'حفظ التعديلات' : 'إضافة'}</button>
        </div>
      </div>
    </div>
  );
}

function normalizeSubjectForm(values: { name: string; nameEn: string; code: string }) {
  return {
    name: values.name.trim().replace(/\s+/g, ' '),
    nameEn: values.nameEn.trim().replace(/\s+/g, ' '),
    code: values.code.trim().replace(/\s+/g, '').toUpperCase(),
  };
}

function validateSubject(values: { name: string; nameEn: string; code: string }, subjects: SubjectRow[], currentId?: string): { valid: boolean; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  if (!values.name) errors.name = 'اسم المادة بالعربية مطلوب.';
  if (values.name.length > 120) errors.name = 'اسم المادة يجب ألا يتجاوز 120 حرفًا.';
  if (values.nameEn.length > 120) errors.nameEn = 'اسم المادة بالإنجليزية يجب ألا يتجاوز 120 حرفًا.';
  if (!values.code) errors.code = 'كود المادة مطلوب.';
  if (values.code.length > 24) errors.code = 'كود المادة يجب ألا يتجاوز 24 حرفًا.';
  if (values.code && !/^[A-Z0-9_-]+$/.test(values.code)) errors.code = 'كود المادة يمكن أن يحتوي على حروف إنجليزية وأرقام وشرطة فقط.';
  const duplicate = subjects.some((subject) => subject.id !== currentId && (subject.code ?? '').trim().toUpperCase() === values.code);
  if (duplicate) errors.code = 'كود المادة مستخدم داخل هذه المؤسسة.';
  return { valid: Object.keys(errors).length === 0, errors };
}

function subjectErrorMessage(message: string) {
  if (message.toLowerCase().includes('duplicate') || message.toLowerCase().includes('unique')) {
    return 'كود المادة مستخدم داخل هذه المؤسسة.';
  }
  return message;
}

function StudentsTab({
  institutionId,
  actorId,
  role,
  academicYears,
  students,
  classStudents,
  classes,
  gradeLevels,
  branches,
  sections,
  loading,
  canManageStudents,
  onUpdated,
}: {
  institutionId: string;
  actorId: string | null;
  role: UserRole;
  academicYears: AcademicYearRow[];
  students: StudentRow[];
  classStudents: ClassStudentRow[];
  classes: ClassRow[];
  gradeLevels: GradeLevelRow[];
  branches: BranchRow[];
  sections: SectionRow[];
  loading: boolean;
  canManageStudents: boolean;
  onUpdated: () => void;
}) {
  const { confirm, toast } = useFeedback();
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | StudentStatus>('all');
  const [branchFilter, setBranchFilter] = useState('');
  const [gradeFilter, setGradeFilter] = useState('');
  const [classFilter, setClassFilter] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [modalMode, setModalMode] = useState<'add' | 'edit' | 'view' | null>(null);
  const [activeStudent, setActiveStudent] = useState<StudentRow | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [importRows, setImportRows] = useState<StudentFormValues[] | null>(null);
  const pageSize = 10;

  const studentClassById = useMemo(() => new Map(classStudents.map((row) => [row.student_id, row])), [classStudents]);
  const classById = useMemo(() => new Map(classes.map((row) => [row.id, row])), [classes]);
  const sectionById = useMemo(() => new Map(sections.map((row) => [row.id, row])), [sections]);
  const gradeById = useMemo(() => new Map(gradeLevels.map((row) => [row.id, row])), [gradeLevels]);

  const filtered = useMemo(() => {
    const trimmed = query.trim().toLowerCase();
    return students.filter((student) => {
      const classLink = studentClassById.get(student.id);
      const classRow = classLink ? classById.get(classLink.class_id) : null;
      const matchesText = !trimmed || [
        student.full_name,
        student.full_name_en ?? '',
        student.student_code ?? '',
        student.seat_number ?? '',
        student.phone ?? '',
      ].some((value) => value.toLowerCase().includes(trimmed));
      const status = (student.status ?? (student.is_active ? 'active' : 'suspended')) as StudentStatus;
      return matchesText
        && (statusFilter === 'all' || status === statusFilter)
        && (!branchFilter || classRow?.branch_id === branchFilter)
        && (!gradeFilter || student.grade_level_id === gradeFilter || classRow?.grade_level_id === gradeFilter)
        && (!classFilter || classLink?.class_id === classFilter);
    });
  }, [branchFilter, classById, classFilter, gradeFilter, query, statusFilter, studentClassById, students]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pageRows = filtered.slice((page - 1) * pageSize, page * pageSize);

  useEffect(() => {
    if (page > pageCount) setPage(pageCount);
  }, [page, pageCount]);

  function openAdd() {
    setActiveStudent(null);
    setModalMode('add');
  }

  function openEdit(student: StudentRow) {
    setActiveStudent(student);
    setModalMode('edit');
  }

  function openView(student: StudentRow) {
    setActiveStudent(student);
    setModalMode('view');
  }

  async function archiveStudent(student: StudentRow) {
    if (!(await confirm(`هل تريد أرشفة الطالب "${student.full_name}"؟`, { title: 'أرشفة الطالب', confirmLabel: 'أرشفة الطالب' }))) return;
    let { error } = await supabase.from('student_profiles').update({
      status: 'archived',
      is_active: false,
      archived_at: new Date().toISOString(),
    }).eq('id', student.id);
    if (error && isMissingStudentProfileColumnError(error.message)) {
      const fallback = await supabase.from('student_profiles').update({ is_active: false }).eq('id', student.id);
      error = fallback.error;
    }
    if (!error) {
      await writeAudit(institutionId, actorId, role, 'student.archive', 'student_profiles', student.id, { full_name: student.full_name });
      setSuccess('تمت أرشفة الطالب بنجاح.');
      onUpdated();
    } else {
      toast(formatStudentError(error.message), 'error');
    }
  }

  async function toggleStudent(student: StudentRow) {
    const nextActive = !student.is_active;
    let { error } = await supabase.from('student_profiles').update({
      is_active: nextActive,
      status: nextActive ? 'active' : 'suspended',
      archived_at: null,
    }).eq('id', student.id);
    if (error && isMissingStudentProfileColumnError(error.message)) {
      const fallback = await supabase.from('student_profiles').update({ is_active: nextActive }).eq('id', student.id);
      error = fallback.error;
    }
    if (!error) {
      await writeAudit(institutionId, actorId, role, nextActive ? 'student.activate' : 'student.suspend', 'student_profiles', student.id, {});
      setSuccess(nextActive ? 'تمت إعادة تفعيل الطالب بنجاح.' : 'تم تعطيل حساب الطالب بنجاح.');
      onUpdated();
    } else {
      toast(formatStudentError(error.message), 'error');
    }
  }

  function exportRows(format: 'xlsx' | 'csv') {
    if (format === 'xlsx') {
      setSuccess('Excel export is unavailable. Use CSV export.');
      return;
    }
    const rows = filtered.map((student) => {
      const classLink = studentClassById.get(student.id);
      const classRow = classLink ? classById.get(classLink.class_id) : null;
      return [student.full_name, student.full_name_en ?? '', student.student_code ?? '', student.seat_number ?? '', student.phone ?? '', student.email ?? '', student.status ? statusLabels[student.status] : '', student.grade_level_id ? gradeById.get(student.grade_level_id)?.name ?? '' : '', classRow?.name ?? '', classLink?.section_id ? sectionById.get(classLink.section_id)?.name ?? '' : ''];
    });
    const csv = [['Name', 'English name', 'Student code', 'Seat number', 'Phone', 'Email', 'Status', 'Grade', 'Class', 'Section'], ...rows]
      .map((row) => row.map((value) => '"' + String(value).replace(/"/g, '""') + '"').join(',')).join('\n');
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    link.download = 'students-export.csv';
    link.click();
    URL.revokeObjectURL(link.href);
  }

  function downloadTemplate() {
    setSuccess('Excel template download is unavailable. Use the individual student form or CSV export.');
  }

  async function handleImportFile(_file: File) {
    void _file;
    setSuccess('Excel import is unavailable. No file was processed.');
  }

  async function saveImportRows() {
    if (!importRows) return;
    const validRows = importRows.filter((row) => validateStudent(row, students).valid);
    for (const row of validRows) {
      await saveStudentRecord({
        values: row,
        institutionId,
        actorId,
        role,
        mode: 'add',
        existingStudents: students,
      });
    }
    setImportRows(null);
    setSuccess(`تم استيراد ${validRows.length} من الطلاب بنجاح.`);
    onUpdated();
  }

  if (loading) return <div className="flex justify-center py-16"><Loader2 size={24} className="animate-spin text-brand-600" /></div>;

  if (modalMode) {
    return (
      <StudentFormPage
        mode={modalMode}
        student={activeStudent}
        institutionId={institutionId}
        actorId={actorId}
        role={role}
        academicYears={academicYears}
        existingStudents={students}
        classes={classes}
        gradeLevels={gradeLevels}
        branches={branches}
        sections={sections}
        classLink={activeStudent ? studentClassById.get(activeStudent.id) ?? null : null}
        onClose={() => setModalMode(null)}
        onSaved={(message) => {
          setModalMode(null);
          setSuccess(message);
          onUpdated();
        }}
      />
    );
  }

  return (
    <div className="space-y-4">
      {success && (
        <div className="flex items-center gap-2 p-3 rounded-xl bg-accent-50 border border-accent-200">
          <Check size={18} className="text-accent-600" />
          <p className="text-sm text-accent-700">{success}</p>
          <button onClick={() => setSuccess(null)} className="mr-auto text-xs text-ink-400">إغلاق</button>
        </div>
      )}

      <Card className="space-y-4 p-4 sm:p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <Search size={16} className="text-ink-400" />
            <input className="input !py-2" placeholder="ابحث باسم الطالب أو رقم القيد أو رقم الجلوس أو الهاتف" value={query} onChange={(e) => { setQuery(e.target.value); setPage(1); }} />
          </div>
          {canManageStudents && (
            <button data-testid="student-add" onClick={openAdd} className="btn-primary lg:w-auto"><Plus size={16} /> إضافة طالب</button>
          )}
        </div>

        <div className="grid grid-cols-1 gap-3 border-t border-ink-100 pt-4 sm:grid-cols-2 lg:grid-cols-4">
          <label className="space-y-1.5">
            <span className="label mb-0">الحالة</span>
            <DropdownSelect
              value={statusFilter}
              onValueChange={(value) => { setStatusFilter(value as 'all' | StudentStatus); setPage(1); }}
              options={[{ value: 'all', label: 'جميع الحالات' }, ...Object.entries(statusLabels).map(([value, label]) => ({ value, label }))]}
              ariaLabel="حالة الطالب"
              testId="student-status-filter"
            />
          </label>
          <label className="space-y-1.5">
            <span className="label mb-0">الفرع</span>
            <DropdownSelect
              value={branchFilter}
              onValueChange={(value) => { setBranchFilter(value); setPage(1); }}
              options={[{ value: '', label: 'جميع الفروع' }, ...branches.map((branch) => ({ value: branch.id, label: branch.name }))]}
              ariaLabel="فرع الطالب"
              testId="student-branch-filter"
            />
          </label>
          <label className="space-y-1.5">
            <span className="label mb-0">الصف</span>
            <DropdownSelect
              value={gradeFilter}
              onValueChange={(value) => { setGradeFilter(value); setPage(1); }}
              options={[{ value: '', label: 'جميع الصفوف' }, ...gradeLevels.map((grade) => ({ value: grade.id, label: grade.name }))]}
              ariaLabel="صف الطالب"
              testId="student-grade-filter"
            />
          </label>
          <label className="space-y-1.5">
            <span className="label mb-0">الفصل</span>
            <DropdownSelect
              value={classFilter}
              onValueChange={(value) => { setClassFilter(value); setPage(1); }}
              options={[{ value: '', label: 'جميع الفصول' }, ...classes.map((classRow) => ({ value: classRow.id, label: classRow.name }))]}
              ariaLabel="فصل الطالب"
              testId="student-class-filter"
            />
          </label>
        </div>

        <div className="flex flex-col gap-3 border-t border-ink-100 pt-4 sm:flex-row sm:flex-wrap sm:items-center">
          <div className="flex flex-wrap gap-2 sm:mr-auto">
            <button onClick={() => exportRows('xlsx')} className="btn-outline"><Download size={16} /> تصدير XLSX</button>
            <button onClick={() => exportRows('csv')} className="btn-outline">تصدير CSV</button>
          </div>
          <button onClick={downloadTemplate} className="btn-outline"><FileSpreadsheet size={16} /> تنزيل نموذج الاستيراد</button>
          {canManageStudents && (
            <label className="btn-outline cursor-pointer">
              <Upload size={16} /> استيراد Excel/CSV
              <input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void handleImportFile(file);
                event.currentTarget.value = '';
              }} />
            </label>
          )}
          {selected.size > 0 && canManageStudents && (
            <button onClick={async () => {
              const archiveRes = await supabase.from('student_profiles').update({ status: 'archived', is_active: false, archived_at: new Date().toISOString() }).in('id', Array.from(selected));
              if (archiveRes.error && isMissingStudentProfileColumnError(archiveRes.error.message)) {
                await supabase.from('student_profiles').update({ is_active: false }).in('id', Array.from(selected));
              }
              setSelected(new Set());
              onUpdated();
            }} className="btn-outline text-danger-600"><Archive size={16} /> أرشفة المحدد ({selected.size})</button>
          )}
        </div>
      </Card>

      {students.length === 0 ? (
        <Card>
          <EmptyState icon={<Users size={40} />} title="لم تتم إضافة طلاب حتى الآن" subtitle="أضف أول طالب لبدء إدارة بيانات الطلاب داخل المؤسسة." />
          {canManageStudents && <div className="flex justify-center pb-8"><button data-testid="student-add-empty" onClick={openAdd} className="btn-primary"><Plus size={16} /> إضافة أول طالب</button></div>}
        </Card>
      ) : pageRows.length === 0 ? (
        <Card><EmptyState icon={<Search size={40} />} title="لا يوجد طلاب مطابقون لبحثك" subtitle="عدّل كلمات البحث أو الفلاتر المستخدمة." /></Card>
      ) : (
        <div className="grid gap-2">
          {pageRows.map((student) => {
            const classLink = studentClassById.get(student.id);
            const classRow = classLink ? classById.get(classLink.class_id) : null;
            const sectionRow = classLink?.section_id ? sectionById.get(classLink.section_id) : null;
            const status = (student.status ?? (student.is_active ? 'active' : 'suspended')) as StudentStatus;
            return (
              <Card key={student.id} className="p-3 flex items-center gap-3" data-testid={`student-row-${student.id}`}>
                <input type="checkbox" checked={selected.has(student.id)} onChange={(event) => {
                  const next = new Set(selected);
                  if (event.target.checked) next.add(student.id); else next.delete(student.id);
                  setSelected(next);
                }} />
                <div className="grid place-items-center w-10 h-10 rounded-xl bg-brand-100 text-brand-700 font-700 shrink-0 overflow-hidden">
                  {student.avatar_url ? <img src={student.avatar_url} alt="" className="w-full h-full object-cover" /> : student.full_name.charAt(0)}
                </div>
                <div className="flex-1 min-w-0">
                  <h4 className="font-600 text-ink-900 truncate">{student.full_name}</h4>
                  <p className="text-xs text-ink-400 nums-latin truncate">
                    {student.student_code || 'رقم القيد غير مسجل'} {student.seat_number ? `| رقم الجلوس ${student.seat_number}` : ''} {classRow ? `| ${classRow.name}` : ''} {sectionRow ? `| ${sectionRow.name}` : ''}
                  </p>
                </div>
                <Badge tone={status === 'active' ? 'accent' : status === 'archived' ? 'neutral' : 'warning'}>{statusLabels[status]}</Badge>
                <div className="flex gap-1">
                  <button onClick={() => openView(student)} className="btn-ghost !p-2" title="عرض التفاصيل" aria-label="عرض التفاصيل"><Eye size={16} /></button>
                  {canManageStudents && <button data-testid={`student-edit-${student.id}`} onClick={() => openEdit(student)} className="btn-ghost !p-2" title="تعديل بيانات الطالب" aria-label="تعديل بيانات الطالب"><Pencil size={16} /></button>}
                  {canManageStudents && <button data-testid={`student-toggle-${student.id}`} onClick={() => toggleStudent(student)} className="btn-ghost !p-2" title={student.is_active ? 'تعطيل حساب الطالب' : 'تفعيل حساب الطالب'} aria-label={student.is_active ? 'تعطيل حساب الطالب' : 'تفعيل حساب الطالب'}><Check size={16} /></button>}
                  {canManageStudents && <button onClick={() => archiveStudent(student)} className="btn-ghost !p-2 text-danger-600" title="أرشفة الطالب" aria-label="أرشفة الطالب"><Archive size={16} /></button>}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <div className="flex items-center justify-between text-sm text-ink-500">
        <span>{formatStudentCount(filtered.length)}</span>
        <div className="flex items-center gap-2">
          <button className="btn-outline !py-1.5" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>السابق</button>
          <span className="nums-latin">الصفحة {page} من {pageCount}</span>
          <button className="btn-outline !py-1.5" disabled={page >= pageCount} onClick={() => setPage((p) => Math.min(pageCount, p + 1))}>التالي</button>
        </div>
      </div>

      {importRows && (
        <ImportPreviewModal
          rows={importRows}
          existingStudents={students}
          onClose={() => setImportRows(null)}
          onConfirm={saveImportRows}
        />
      )}
    </div>
  );
}

function StudentFormPage({
  mode,
  student,
  institutionId,
  actorId,
  role,
  academicYears,
  existingStudents,
  classes,
  gradeLevels,
  branches,
  sections,
  classLink,
  onClose,
  onSaved,
}: {
  mode: 'add' | 'edit' | 'view';
  student: StudentRow | null;
  institutionId: string;
  actorId: string | null;
  role: UserRole;
  academicYears: AcademicYearRow[];
  existingStudents: StudentRow[];
  classes: ClassRow[];
  gradeLevels: GradeLevelRow[];
  branches: BranchRow[];
  sections: SectionRow[];
  classLink: ClassStudentRow | null;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const readonly = mode === 'view';
  const [values, setValues] = useState<StudentFormValues>(() => student ? studentToForm(student, classLink, classes) : emptyStudentForm);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const currentClass = values.classId ? classes.find((classRow) => classRow.id === values.classId) : null;
  const visibleBranches = branches.filter((branch) => branch.is_active || branch.id === currentClass?.branch_id);
  const visibleGrades = gradeLevels.filter((grade) => grade.is_active || grade.id === values.gradeLevelId);
  const visibleClasses = classes.filter((classRow) => (
    (classRow.is_active || classRow.id === values.classId)
    && (!values.academicYearId || classRow.academic_year_id === values.academicYearId)
    && (!values.branchId || classRow.branch_id === values.branchId)
    && (!values.gradeLevelId || classRow.grade_level_id === values.gradeLevelId)
  ));
  const visibleSections = values.classId ? sections.filter((section) => (
    section.class_id === values.classId
    && (section.is_active || section.id === values.sectionId)
    && (!values.academicYearId || !section.academic_year_id || section.academic_year_id === values.academicYearId)
    && (!values.gradeLevelId || !section.grade_level_id || section.grade_level_id === values.gradeLevelId)
    && (!values.branchId || !section.branch_id || section.branch_id === values.branchId)
  )) : [];

  function update<K extends keyof StudentFormValues>(key: K, value: StudentFormValues[K]) {
    setValues((prev) => {
      const next = { ...prev, [key]: value };
      if (['firstName', 'fatherName', 'familyName'].includes(key)) {
        const generated = [next.firstName, next.fatherName, next.familyName].filter(Boolean).join(' ').trim();
        next.fullName = generated || prev.fullName;
      }
      if (key === 'branchId') {
        next.classId = '';
        next.sectionId = '';
      }
      if (key === 'academicYearId') {
        next.classId = '';
        next.sectionId = '';
      }
      if (key === 'gradeLevelId') {
        next.classId = '';
        next.sectionId = '';
      }
      if (key === 'classId') {
        const selectedClass = classes.find((classRow) => classRow.id === value);
        next.sectionId = '';
        next.branchId = selectedClass?.branch_id ?? next.branchId;
        next.gradeLevelId = selectedClass?.grade_level_id ?? next.gradeLevelId;
        next.academicYearId = selectedClass?.academic_year_id ?? next.academicYearId;
      }
      return next;
    });
  }

  async function submit(addAnother = false) {
    const result = validateStudent(values, existingStudents, student?.id);
    setErrors(result.errors);
    if (!result.valid) return;
    if (values.classId && visibleSections.length > 0 && !values.sectionId) {
      setErrors({ ...result.errors, sectionId: 'اختر الشعبة قبل حفظ تسجيل الطالب.' });
      return;
    }

    setSaving(true);
    const saveResult = await saveStudentRecord({
      values,
      institutionId,
      actorId,
      role,
      mode: mode === 'edit' ? 'edit' : 'add',
      existingStudents,
      studentId: student?.id,
    });
    setSaving(false);

    if (saveResult.error) {
      setErrors({ form: formatStudentError(saveResult.error) });
      return;
    }

    if (addAnother) {
      setValues(emptyStudentForm);
      onSaved('تم حفظ بيانات الطالب. يمكنك إضافة طالب آخر.');
      return;
    }
    onSaved(mode === 'edit' ? 'تم حفظ تعديلات الطالب بنجاح.' : 'تمت إضافة الطالب بنجاح.');
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <button onClick={onClose} className="btn-outline shrink-0"><ArrowRight size={16} /> العودة إلى الطلاب</button>
          <div className="hidden h-9 w-px bg-ink-200 sm:block" />
          <div className="min-w-0">
            <h3 className="truncate font-display text-xl font-700 text-ink-900">{mode === 'add' ? 'إضافة طالب جديد' : mode === 'edit' ? 'تعديل بيانات الطالب' : 'بيانات الطالب'}</h3>
            <p className="mt-1 text-sm text-ink-500">أدخل البيانات على مراحل واحفظها بسهولة داخل ملف الطالب.</p>
          </div>
        </div>
        <Badge tone={readonly ? 'neutral' : mode === 'edit' ? 'warning' : 'accent'}>{readonly ? 'عرض البيانات' : mode === 'edit' ? 'تعديل' : 'طالب جديد'}</Badge>
      </div>

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="min-w-0 space-y-5">
          <div className="card p-5 sm:p-6">
            <SelectField testId="student-academic-year" label="العام الدراسي" value={values.academicYearId} onChange={(value) => update('academicYearId', value)} disabled={readonly} options={[['', 'غير محدد'], ...academicYears.filter((year) => year.is_active || year.id === values.academicYearId).map((year) => [year.id, year.name] as [string, string])]} />
            {values.classId && visibleSections.length === 0 && <p className="mt-3 rounded-xl border border-warning-200 bg-warning-50 p-3 text-sm text-warning-800">لا توجد شُعب نشطة لهذا الفصل. أضف شعبة من الإعداد الأكاديمي ثم ارجع لاختيارها.</p>}
          </div>
          {errors.form && <FormError message={errors.form} />}

          <FormSection title="البيانات الأساسية">
            <TextField testId="student-first-name" label="الاسم الأول" value={values.firstName} onChange={(value) => update('firstName', value)} disabled={readonly} placeholder="أدخل الاسم الأول" />
            <TextField testId="student-father-name" label="اسم الأب" value={values.fatherName} onChange={(value) => update('fatherName', value)} disabled={readonly} placeholder="أدخل اسم الأب" />
            <TextField testId="student-family-name" label="اسم العائلة" value={values.familyName} onChange={(value) => update('familyName', value)} disabled={readonly} placeholder="أدخل اسم العائلة" />
            <TextField testId="student-full-name" label="الاسم الكامل" value={values.fullName} onChange={(value) => update('fullName', value)} error={errors.fullName} disabled required placeholder="يتولد من أجزاء الاسم" />
            <TextField label="الاسم بالإنجليزية" value={values.fullNameEn} onChange={(value) => update('fullNameEn', value)} disabled={readonly} placeholder="اكتب الاسم بالإنجليزية إن وجد" />
            <TextField testId="student-code" label="رقم القيد" value={values.studentCode} onChange={(value) => update('studentCode', value)} error={errors.studentCode} disabled={readonly} dir="ltr" placeholder="ST-001" />
            <TextField testId="student-seat-number" label="رقم الجلوس" value={values.seatNumber} onChange={(value) => update('seatNumber', value)} disabled={readonly} dir="ltr" placeholder="1001" />
            <TextField label="الرقم القومي" value={values.nationalId} onChange={(value) => update('nationalId', value)} disabled={readonly} dir="ltr" placeholder="أدخل الرقم القومي" />
            <SelectField label="النوع" value={values.gender} onChange={(value) => update('gender', value as StudentFormValues['gender'])} disabled={readonly} options={[['', 'غير محدد'], ['male', 'ذكر'], ['female', 'أنثى'], ['other', 'آخر']]} />
            <TextField label="تاريخ الميلاد" type="date" value={values.birthDate} onChange={(value) => update('birthDate', value)} disabled={readonly} />
            <TextField testId="student-email" label="البريد الإلكتروني" value={values.email} onChange={(value) => update('email', value)} error={errors.email} disabled={readonly} dir="ltr" placeholder="student@example.com" />
            <TextField label="رقم الهاتف" value={values.phone} onChange={(value) => update('phone', value)} error={errors.phone} disabled={readonly} dir="ltr" placeholder="+201000000000" />
          </FormSection>

          <FormSection title="البيانات الدراسية">
            <SelectField testId="student-branch" label="الفرع" value={values.branchId} onChange={(value) => update('branchId', value)} disabled={readonly} options={[['', 'بدون فرع'], ...visibleBranches.map((branch) => [branch.id, branch.name] as [string, string])]} />
            <SelectField testId="student-grade" label="الصف الدراسي" value={values.gradeLevelId} onChange={(value) => update('gradeLevelId', value)} disabled={readonly} options={[['', 'غير محدد'], ...visibleGrades.map((grade) => [grade.id, grade.name] as [string, string])]} />
            <SelectField testId="student-class" label="الفصل" value={values.classId} onChange={(value) => update('classId', value)} disabled={readonly} options={[['', 'غير محدد'], ...visibleClasses.map((classRow) => [classRow.id, `${classRow.name} - ${classRow.academic_year}`] as [string, string])]} />
            <SelectField testId="student-section" label="الشعبة" value={values.sectionId} onChange={(value) => update('sectionId', value)} disabled={readonly || !values.classId} options={[['', 'غير محدد'], ...visibleSections.map((section) => [section.id, section.name] as [string, string])]} />
            <SelectField label="حالة الطالب" value={values.status} onChange={(value) => update('status', value as StudentStatus)} disabled={readonly} options={Object.entries(statusLabels)} />
          </FormSection>

          <FormSection title="بيانات ولي الأمر">
            <TextField testId="student-parent-name" label="اسم ولي الأمر" value={values.parentName} onChange={(value) => update('parentName', value)} disabled={readonly} placeholder="أدخل اسم ولي الأمر" />
            <TextField label="صلة القرابة" value={values.parentRelationship} onChange={(value) => update('parentRelationship', value)} disabled={readonly} placeholder="الأب، الأم، ولي أمر" />
            <TextField testId="student-parent-phone" label="هاتف ولي الأمر" value={values.parentPhone} onChange={(value) => update('parentPhone', value)} disabled={readonly} dir="ltr" placeholder="+201000000000" />
            <TextField label="بريد ولي الأمر" value={values.parentEmail} onChange={(value) => update('parentEmail', value)} disabled={readonly} dir="ltr" placeholder="parent@example.com" />
          </FormSection>
        </div>

        <aside className="card hidden h-fit space-y-5 p-5 xl:sticky xl:top-5 xl:block">
          <div className="flex items-start gap-3">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-600"><Users size={19} /></div>
            <div>
              <h4 className="font-700 text-ink-900">ملف الطالب</h4>
              <p className="mt-1 text-xs leading-5 text-ink-500">راجع البيانات قبل الحفظ لضمان ظهور الطالب بشكل صحيح في التقارير.</p>
            </div>
          </div>
          <div className="space-y-3 border-t border-ink-100 pt-4 text-sm">
            <div className="flex items-center gap-2 text-ink-700"><span className="grid h-6 w-6 place-items-center rounded-full bg-brand-600 text-xs font-700 text-white">1</span> البيانات الأساسية</div>
            <div className="flex items-center gap-2 text-ink-700"><span className="grid h-6 w-6 place-items-center rounded-full bg-brand-100 text-xs font-700 text-brand-700">2</span> البيانات الدراسية</div>
            <div className="flex items-center gap-2 text-ink-700"><span className="grid h-6 w-6 place-items-center rounded-full bg-brand-100 text-xs font-700 text-brand-700">3</span> بيانات ولي الأمر</div>
          </div>
          <div className="rounded-xl bg-ink-50 p-3 text-xs leading-5 text-ink-500">الحقول التي تحمل علامة (*) مطلوبة لإتمام الحفظ.</div>
        </aside>
      </div>

      <div className="sticky bottom-4 z-20 flex flex-col gap-3 rounded-2xl border border-ink-100 bg-white/95 p-3 shadow-pop backdrop-blur sm:flex-row sm:items-center sm:justify-end">
          <button onClick={onClose} className="btn-ghost">إلغاء</button>
          {!readonly && (
            <>
              <button onClick={() => submit(true)} disabled={saving || mode === 'edit'} className="btn-outline disabled:opacity-50">حفظ وإضافة طالب آخر</button>
              <button data-testid="student-save" onClick={() => submit(false)} disabled={saving} className="btn-primary disabled:opacity-60">
                {saving ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
                حفظ
              </button>
            </>
          )}
      </div>
    </div>
  );
}

function FormSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="card space-y-4 p-5 sm:p-6">
      <div className="flex items-center gap-3 border-b border-ink-100 pb-4">
        <span className="h-6 w-1 rounded-full bg-brand-600" />
        <h4 className="font-700 text-ink-900">{title}</h4>
      </div>
      <div className="grid gap-x-5 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">{children}</div>
    </section>
  );
}

function TextField({ label, value, onChange, error, disabled, required, type = 'text', dir, placeholder, testId }: { label: string; value: string; onChange: (value: string) => void; error?: string; disabled?: boolean; required?: boolean; type?: string; dir?: 'ltr' | 'rtl' | 'auto'; placeholder?: string; testId?: string }) {
  return (
    <div>
      <label className="label">{label}{required ? ' *' : ''}</label>
      <input data-testid={testId} className={`input ${error ? 'border-danger-300' : ''}`} type={type} value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} dir={dir} placeholder={placeholder} />
      {error && <p className="text-xs text-danger-600 mt-1">{error}</p>}
    </div>
  );
}

function SelectField({ label, value, onChange, options, disabled, testId }: { label: string; value: string; onChange: (value: string) => void; options: [string, string][]; disabled?: boolean; testId?: string }) {
  return (
    <label className="space-y-1.5">
      <span className="label mb-0">{label}</span>
      <DropdownSelect
        value={value}
        onValueChange={onChange}
        options={options.map(([optionValue, labelText]) => ({ value: optionValue, label: labelText }))}
        disabled={disabled}
        ariaLabel={label}
        testId={testId}
      />
    </label>
  );
}

function FormError({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-2 p-3 rounded-xl bg-danger-50 border border-danger-200">
      <AlertCircle size={18} className="text-danger-600 shrink-0 mt-0.5" />
      <p className="text-sm text-danger-700">{message}</p>
    </div>
  );
}

function formatArabicDate(value: string) {
  return new Intl.DateTimeFormat('ar-EG', { year: 'numeric', month: 'short', day: 'numeric' }).format(new Date(value));
}

function formatStudentCount(count: number) {
  if (count === 0) return 'لا يوجد طلاب';
  if (count === 1) return 'طالب واحد';
  if (count === 2) return 'طالبان';
  if (count >= 3 && count <= 10) return `${count} طلاب`;
  return `${count} طالبًا`;
}

function formatStudentError(message: string) {
  const lower = message.toLowerCase();
  if (lower.includes('duplicate') || lower.includes('unique')) return 'هذه البيانات مستخدمة من قبل. راجع رقم القيد وحاول مرة أخرى.';
  if (lower.includes('permission') || lower.includes('row-level security')) return 'ليست لديك صلاحية لتنفيذ هذا الإجراء.';
  if (lower.includes('invalid input')) return 'توجد قيمة غير صحيحة في البيانات المدخلة.';
  if (isMissingStudentProfileColumnError(message)) return 'تعذر حفظ بعض الحقول التفصيلية للطالب. تم الاعتماد على البيانات الأساسية المتاحة.';
  return 'حدث خطأ غير متوقع. راجع البيانات وحاول مرة أخرى.';
}

function formatAcademicError(message: string) {
  const lower = message.toLowerCase();
  if (lower.includes('duplicate') || lower.includes('unique')) return 'يوجد سجل بنفس الاسم داخل نفس النطاق.';
  if (lower.includes('permission') || lower.includes('row-level security')) return 'ليست لديك صلاحية لإدارة هذا السجل.';
  if (lower.includes('institution_mismatch') || lower.includes('academic_institution_immutable')) return 'لا يمكن ربط بيانات من مؤسسة مختلفة.';
  if (lower.includes('inactive')) return 'لا يمكن استخدام سجل معطل في عملية جديدة.';
  if (lower.includes('section') && lower.includes('mismatch')) return 'الشعبة المحددة لا تتبع الفصل المختار.';
  return 'تعذر حفظ بيانات الهيكل الأكاديمي. راجع العلاقات وحاول مرة أخرى.';
}

function ImportPreviewModal({ rows, existingStudents, onClose, onConfirm }: { rows: StudentFormValues[]; existingStudents: StudentRow[]; onClose: () => void; onConfirm: () => void }) {
  const results = rows.map((row) => ({ row, validation: validateStudent(row, existingStudents) }));
  const validCount = results.filter((result) => result.validation.valid).length;

  return (
    <div className="fixed inset-0 z-50 bg-ink-950/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div className="card w-full max-w-4xl max-h-[88vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="border-b border-ink-100 px-6 py-4 flex items-center justify-between">
          <h3 className="font-display text-lg font-700 text-ink-900">معاينة الاستيراد</h3>
          <button onClick={onClose} className="text-ink-400 hover:text-ink-700" aria-label="إغلاق"><X size={20} /></button>
        </div>
        <div className="p-6 space-y-3">
          <p className="text-sm text-ink-500">يوجد {validCount} صف صالح من أصل {rows.length}. لن يتم حفظ الصفوف غير الصالحة.</p>
          <div className="grid gap-2">
            {results.slice(0, 30).map(({ row, validation }, index) => (
              <div key={index} className={`p-3 rounded-xl border ${validation.valid ? 'border-accent-200 bg-accent-50/40' : 'border-danger-200 bg-danger-50/40'}`}>
                <div className="flex items-center justify-between gap-3">
                  <p className="font-600 text-sm text-ink-800">{row.fullName || [row.firstName, row.fatherName, row.familyName].filter(Boolean).join(' ') || 'صف بدون اسم'}</p>
                  <Badge tone={validation.valid ? 'accent' : 'danger'}>{validation.valid ? 'صالح' : 'غير صالح'}</Badge>
                </div>
                {!validation.valid && <p className="text-xs text-danger-600 mt-1">{Object.values(validation.errors).join(' | ')}</p>}
              </div>
            ))}
          </div>
        </div>
        <div className="border-t border-ink-100 px-6 py-4 flex justify-end gap-2">
          <button onClick={onClose} className="btn-ghost">إلغاء</button>
          <button onClick={onConfirm} disabled={validCount === 0} className="btn-primary disabled:opacity-60"><Upload size={16} /> حفظ الصفوف الصالحة</button>
        </div>
      </div>
    </div>
  );
}

function normalizeStudentProfileRow(row: StudentProfileQueryRow): StudentRow {
  return {
    id: row.id,
    institution_id: row.institution_id,
    first_name: row.first_name ?? null,
    father_name: row.father_name ?? null,
    family_name: row.family_name ?? null,
    full_name: row.full_name?.trim() || 'طالب بدون اسم',
    full_name_en: row.full_name_en ?? null,
    student_code: row.student_code ?? null,
    seat_number: row.seat_number ?? null,
    national_id: row.national_id ?? null,
    gender: row.gender ?? null,
    birth_date: row.birth_date ?? null,
    email: row.email ?? null,
    phone: row.phone ?? null,
    avatar_url: row.avatar_url ?? null,
    grade_level_id: row.grade_level_id ?? null,
    status: row.status ?? (row.is_active ? 'active' : 'suspended'),
    is_active: row.is_active,
    archived_at: row.archived_at ?? null,
  };
}

function studentToForm(student: StudentRow, classLink: ClassStudentRow | null, classes: ClassRow[]): StudentFormValues {
  const classRow = classLink ? classes.find((row) => row.id === classLink.class_id) : null;
  return {
    id: student.id,
    firstName: student.first_name ?? '',
    fatherName: student.father_name ?? '',
    familyName: student.family_name ?? '',
    fullName: student.full_name,
    fullNameEn: student.full_name_en ?? '',
    studentCode: student.student_code ?? '',
    seatNumber: classLink?.seat_number ?? student.seat_number ?? '',
    nationalId: student.national_id ?? '',
    gender: (student.gender as StudentFormValues['gender']) ?? '',
    birthDate: student.birth_date ?? '',
    email: student.email ?? '',
    phone: student.phone ?? '',
    academicYearId: classLink?.academic_year_id ?? classRow?.academic_year_id ?? '',
    branchId: classRow?.branch_id ?? '',
    gradeLevelId: student.grade_level_id ?? '',
    classId: classLink?.class_id ?? '',
    sectionId: classLink?.section_id ?? '',
    status: (student.status ?? (student.is_active ? 'active' : 'suspended')) as StudentStatus,
    parentName: '',
    parentRelationship: '',
    parentPhone: '',
    parentEmail: '',
  };
}

function isMissingStudentProfileColumnError(message: string) {
  const normalized = message.toLowerCase();
  return normalized.includes('student_profiles') && (
    normalized.includes('does not exist') ||
    normalized.includes('could not find') ||
    normalized.includes('schema cache')
  );
}

function validateStudent(values: StudentFormValues, existingStudents: StudentRow[], currentId?: string): { valid: boolean; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  if (values.sectionId && !values.classId) errors.sectionId = 'لا يمكن اختيار شعبة بدون فصل أب.';
  const fullName = values.fullName.trim() || [values.firstName, values.fatherName, values.familyName].filter(Boolean).join(' ').trim();
  if (!fullName) errors.fullName = 'اسم الطالب مطلوب.';
  if (values.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email)) errors.email = 'أدخل بريدًا إلكترونيًا صحيحًا.';
  if (values.phone && !/^\+?[0-9\s-]{7,20}$/.test(values.phone)) errors.phone = 'رقم الهاتف غير صحيح.';
  if (values.studentCode.trim()) {
    const duplicate = existingStudents.some((student) => student.id !== currentId && (student.student_code ?? '').toLowerCase() === values.studentCode.trim().toLowerCase());
    if (duplicate) errors.studentCode = 'رقم القيد مستخدم لطالب آخر.';
  }
  return { valid: Object.keys(errors).length === 0, errors };
}

async function saveStudentRecord({
  values,
  institutionId,
  actorId,
  role,
  mode,
  existingStudents,
  studentId,
}: {
  values: StudentFormValues;
  institutionId: string;
  actorId: string | null;
  role: UserRole;
  mode: 'add' | 'edit';
  existingStudents: StudentRow[];
  studentId?: string;
}): Promise<{ error?: string; studentId?: string }> {
  const validation = validateStudent(values, existingStudents, studentId);
  if (!validation.valid) return { error: Object.values(validation.errors).join(' ') };
  const fullName = values.fullName.trim() || [values.firstName, values.fatherName, values.familyName].filter(Boolean).join(' ').trim();
  const basePayload = {
    institution_id: institutionId,
    first_name: values.firstName.trim() || null,
    father_name: values.fatherName.trim() || null,
    family_name: values.familyName.trim() || null,
    full_name: fullName,
    full_name_en: values.fullNameEn.trim() || null,
    student_code: values.studentCode.trim() || null,
    seat_number: values.seatNumber.trim() || null,
    national_id: values.nationalId.trim() || null,
    gender: values.gender || null,
    birth_date: values.birthDate || null,
    email: values.email.trim() || null,
    phone: values.phone.trim() || null,
    grade_level_id: values.gradeLevelId || null,
    status: values.status,
    is_active: values.status === 'active',
  };
  const studentRes = mode === 'edit' && studentId
    ? await supabase.from('student_profiles').update(basePayload).eq('id', studentId).select('id').single()
    : await supabase.from('student_profiles').insert(basePayload).select('id').single();

  if (studentRes.error) return { error: studentRes.error.message };
  const savedStudentId = (studentRes.data as { id: string }).id;

  if (mode === 'edit' || values.classId) {
    const closeLink = await supabase
      .from('class_students')
      .update({ status: 'transferred', ended_at: new Date().toISOString() })
      .eq('student_id', savedStudentId)
      .eq('status', 'active');
    if (closeLink.error) return { error: closeLink.error.message };
  }

  if (values.classId) {
    const classRes = await supabase.from('class_students').insert({
      institution_id: institutionId,
      class_id: values.classId,
      section_id: values.sectionId || null,
      student_id: savedStudentId,
      academic_year_id: values.academicYearId || null,
      grade_level_id: values.gradeLevelId || null,
      seat_number: values.seatNumber.trim() || null,
      status: 'active',
    });
    if (classRes.error) return { error: classRes.error.message };
  }

  if (values.parentName.trim() && values.parentPhone.trim()) {
    const parentRes = await supabase.from('parent_profiles').insert({
      institution_id: institutionId,
      full_name: values.parentName.trim(),
      phone: values.parentPhone.trim(),
      is_active: true,
    }).select('id').single();
    if (!parentRes.error) {
      await supabase.from('parent_student_links').insert({
        parent_id: (parentRes.data as { id: string }).id,
        student_id: savedStudentId,
        relationship: values.parentRelationship.trim() || 'guardian',
      });
    }
  }

  await writeAudit(institutionId, actorId, role, mode === 'edit' ? 'student.update' : 'student.create', 'student_profiles', savedStudentId, { full_name: fullName });
  return { studentId: savedStudentId };
}

async function writeAudit(institutionId: string, actorId: string | null, role: UserRole, action: string, entityType: string, entityId: string, details: Record<string, unknown>) {
  await supabase.from('audit_log').insert({
    institution_id: institutionId,
    actor_id: actorId,
    actor_role: role,
    action,
    entity_type: entityType,
    entity_id: entityId,
    details,
  });
}

function AttendanceTab({ institutionId, students, classStudents, classes, subjects, canEdit }: { institutionId: string; students: StudentRow[]; classStudents: ClassStudentRow[]; classes: ClassRow[]; subjects: SubjectRow[]; canEdit: boolean }) {
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [subjectId, setSubjectId] = useState('');
  const [records, setRecords] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const loadAttendance = useCallback(async () => {
    if (!institutionId || !date) return;
    const query = supabase.from('attendance').select('student_id, status').eq('institution_id', institutionId).eq('date', date);
    const { data } = subjectId ? await query.eq('subject_id', subjectId) : await query.is('subject_id', null);
    const map: Record<string, string> = {};
    for (const r of (data as { student_id: string; status: string }[]) ?? []) map[r.student_id] = r.status;
    setRecords(map);
  }, [date, institutionId, subjectId]);

  useEffect(() => { loadAttendance(); }, [loadAttendance]);

  function setStatus(studentId: string, status: string) {
    setRecords((prev) => ({ ...prev, [studentId]: status }));
  }

  const activeClassIds = useMemo(() => new Set(classes.filter((classRow) => classRow.is_active).map((classRow) => classRow.id)), [classes]);
  const attendanceStudents = useMemo(() => students.filter((student) => {
    const link = classStudents.find((row) => row.student_id === student.id);
    return link ? activeClassIds.has(link.class_id) : true;
  }), [activeClassIds, classStudents, students]);

  async function save() {
    setSaving(true);
    setSaved(false);
    const classByStudent = new Map(classStudents.map((row) => [row.student_id, row]));
    const rows = attendanceStudents.map((s) => ({
      institution_id: institutionId,
      student_id: s.id,
      class_id: classByStudent.get(s.id)?.class_id ?? null,
      subject_id: subjectId || null,
      date,
      status: records[s.id] ?? 'present',
    }));
    for (const r of rows) {
      await supabase.from('attendance').upsert(r, { onConflict: 'student_id,date,subject_id' });
    }
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  const statuses = [
    { value: 'present', label: 'حاضر', tone: 'accent' as const },
    { value: 'absent', label: 'غائب', tone: 'danger' as const },
    { value: 'late', label: 'متأخر', tone: 'warning' as const },
    { value: 'excused', label: 'غياب بعذر', tone: 'neutral' as const },
  ];

  return (
    <div className="space-y-4">
      <Card className="p-4 sm:p-5">
        <div className={`grid grid-cols-1 gap-3 ${canEdit ? 'sm:grid-cols-3' : 'sm:grid-cols-2'}`}>
          <label className="space-y-1.5"><span className="label mb-0">التاريخ</span><input type="date" className="input h-12 w-full !py-0" value={date} onChange={(e) => setDate(e.target.value)} /></label>
          <label className="space-y-1.5"><span className="label mb-0">المادة</span><DropdownSelect value={subjectId} onValueChange={setSubjectId} options={[{ value: '', label: 'حضور عام' }, ...subjects.map((s) => ({ value: s.id, label: s.name }))]} ariaLabel="مادة الحضور" testId="attendance-subject-filter" /></label>
          {canEdit && <button onClick={save} disabled={saving} className="btn-primary h-12 w-full self-end disabled:opacity-60">{saving ? <Loader2 size={16} className="animate-spin" /> : saved ? <Check size={16} /> : <Upload size={16} />}{saving ? 'جارٍ الحفظ' : saved ? 'تم الحفظ' : 'حفظ الحضور'}</button>}
        </div>
      </Card>

      {attendanceStudents.length === 0 ? (
        <Card><EmptyState icon={<Calendar size={40} />} title="لا يوجد طلاب" /></Card>
      ) : (
        <div className="grid gap-2">
          {attendanceStudents.map((s) => {
            const current = records[s.id] ?? 'present';
            return (
              <Card key={s.id} className="p-3 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <h4 className="font-600 text-ink-900 truncate">{s.full_name}</h4>
                </div>
                <div className="flex gap-1">
                  {statuses.map((st) => (
                    <button key={st.value} onClick={() => canEdit && setStatus(s.id, st.value)} disabled={!canEdit}
                      className={`px-3 py-1.5 rounded-lg text-xs font-600 transition ${current === st.value ? `bg-${st.tone === 'accent' ? 'accent' : st.tone === 'danger' ? 'danger' : st.tone === 'warning' ? 'warning' : 'ink'}-100 text-${st.tone === 'accent' ? 'accent' : st.tone === 'danger' ? 'danger' : st.tone === 'warning' ? 'warning' : 'ink'}-700` : 'bg-ink-50 text-ink-400 hover:bg-ink-100'}`}>
                      {st.label}
                    </button>
                  ))}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

function GradesTab({ institutionId, students, classStudents, classes, subjects, canEdit }: { institutionId: string; students: StudentRow[]; classStudents: ClassStudentRow[]; classes: ClassRow[]; subjects: SubjectRow[]; canEdit: boolean }) {
  const [subjectId, setSubjectId] = useState('');
  const [grades, setGrades] = useState<GradeBookRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!institutionId) return;
    setLoading(true);
    let query = supabase.from('grade_book').select('id, student_id, subject_id, assessment_title, score, max_score, weight, subjects!inner(name)').eq('institution_id', institutionId).order('recorded_at', { ascending: false });
    if (subjectId) query = query.eq('subject_id', subjectId);
    const { data } = await query;
    setGrades((data as unknown as GradeBookRow[]) ?? []);
    setLoading(false);
  }, [institutionId, subjectId]);

  useEffect(() => { load(); }, [load]);

  function exportExcel() {
    setNotice('Excel export is unavailable. No spreadsheet file was generated.');
  }

  return (
    <div className="space-y-4">
      <Card className="flex flex-col gap-3 p-4 sm:flex-row sm:items-end sm:p-5">
        <BookOpen size={18} className="mb-3 hidden text-ink-400 sm:block" />
        <label className="space-y-1.5 sm:w-64"><span className="label mb-0">المادة</span><DropdownSelect value={subjectId} onValueChange={setSubjectId} options={[{ value: '', label: 'جميع المواد' }, ...subjects.map((s) => ({ value: s.id, label: s.name }))]} ariaLabel="فلترة الدرجات حسب المادة" testId="grades-subject-filter" /></label>
        <div className="mr-auto flex gap-2">
          <button onClick={exportExcel} className="btn-outline h-12"><Download size={16} /> تصدير Excel</button>
          {canEdit && <button onClick={() => setShowAdd(true)} className="btn-primary h-12"><Plus size={16} /> إضافة درجة</button>}
        </div>
      </Card>
      {notice && <div className="rounded-xl border border-warning-200 bg-warning-50 p-3 text-sm text-warning-800">{notice}</div>}

      {loading ? <div className="flex justify-center py-16"><Loader2 size={24} className="animate-spin text-brand-600" /></div> :
        grades.length === 0 ? <Card><EmptyState icon={<TrendingUp size={40} />} title="لا توجد درجات" /></Card> :
        <div className="grid gap-2">
          {grades.map((g) => {
            const student = students.find((s) => s.id === g.student_id);
            const pct = (g.score / g.max_score) * 100;
            return (
              <Card key={g.id} className="p-3">
                <div className="flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <h4 className="font-600 text-ink-900 truncate">{student?.full_name ?? 'طالب غير مسجل'}</h4>
                    <p className="text-xs text-ink-400">{g.subjects?.name} | {g.assessment_title}</p>
                  </div>
                  <div className="text-left shrink-0">
                    <div className="text-sm font-700 nums-latin">{g.score}/{g.max_score}</div>
                    <div className="w-20"><ProgressBar value={pct} tone={pct >= 50 ? 'accent' : 'danger'} /></div>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      }

      {showAdd && <AddGradeModal institutionId={institutionId} students={students} classStudents={classStudents} classes={classes} subjects={subjects} onClose={() => setShowAdd(false)} onSaved={() => { setShowAdd(false); load(); }} />}
    </div>
  );
}

function AddGradeModal({ institutionId, students, classStudents, classes, subjects, onClose, onSaved }: { institutionId: string; students: StudentRow[]; classStudents: ClassStudentRow[]; classes: ClassRow[]; subjects: SubjectRow[]; onClose: () => void; onSaved: () => void }) {
  const [studentId, setStudentId] = useState('');
  const [subjectId, setSubjectId] = useState('');
  const [title, setTitle] = useState('');
  const [score, setScore] = useState('');
  const [maxScore, setMaxScore] = useState('100');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    if (!studentId || !subjectId || !title.trim() || !score) { setError('جميع الحقول مطلوبة.'); setSaving(false); return; }
    const classLink = classStudents.find((row) => row.student_id === studentId);
    const hasActiveClass = classLink ? classes.some((classRow) => classRow.id === classLink.class_id && classRow.is_active) : false;
    if (!hasActiveClass) { setError('اختر طالبًا مرتبطًا بفصل نشط قبل تسجيل الدرجة.'); setSaving(false); return; }
    const { error: err } = await supabase.from('grade_book').insert({
      institution_id: institutionId, student_id: studentId, subject_id: subjectId,
      assessment_title: title.trim(), score: Number(score), max_score: Number(maxScore),
    });
    if (err) { setError(formatStudentError(err.message)); setSaving(false); return; }
    onSaved();
  }

  return (
    <div className="fixed inset-0 z-50 bg-ink-950/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div className="card w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="border-b border-ink-100 px-6 py-4 flex items-center justify-between"><h3 className="font-display text-lg font-700 text-ink-900">إضافة درجة</h3><button onClick={onClose} className="text-ink-400 text-xl" aria-label="إغلاق">×</button></div>
        <div className="p-6 space-y-4">
          {error && <FormError message={error} />}
          <label className="space-y-1.5"><span className="label mb-0">الطالب</span><DropdownSelect value={studentId} onValueChange={setStudentId} options={[{ value: '', label: 'اختر الطالب' }, ...students.map((s) => ({ value: s.id, label: s.full_name }))]} ariaLabel="الطالب" testId="grade-student-select" /></label>
          <label className="space-y-1.5"><span className="label mb-0">المادة</span><DropdownSelect value={subjectId} onValueChange={setSubjectId} options={[{ value: '', label: 'اختر المادة' }, ...subjects.map((s) => ({ value: s.id, label: s.name }))]} ariaLabel="المادة" testId="grade-subject-select" /></label>
          <div><label className="label">اسم التقييم</label><input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="مثال: اختبار الشهر" /></div>
          <div className="grid grid-cols-2 gap-4"><div><label className="label">الدرجة</label><input type="number" step="any" className="input" value={score} onChange={(e) => setScore(e.target.value)} /></div><div><label className="label">الدرجة النهائية</label><input type="number" className="input" value={maxScore} onChange={(e) => setMaxScore(e.target.value)} /></div></div>
        </div>
        <div className="border-t border-ink-100 px-6 py-4 flex justify-end gap-2"><button onClick={onClose} className="btn-ghost">إلغاء</button><button onClick={save} disabled={saving} className="btn-primary disabled:opacity-60">{saving ? <Loader2 size={16} className="animate-spin" /> : null}حفظ</button></div>
      </div>
    </div>
  );
}
