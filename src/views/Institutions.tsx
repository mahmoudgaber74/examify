import { useState, useEffect, useCallback, useMemo } from 'react';
import { Plus, Search, Trash2, Edit3, Loader2, AlertCircle, Building2, Users, GraduationCap, ToggleLeft, ToggleRight, MapPin } from 'lucide-react';
import { Card, SectionHeader, Badge, EmptyState } from '../components/ui';
import { supabase, useAuthSafe } from '../lib/auth-helpers';
import { getArabicErrorMessage } from '../lib/translate';

interface InstitutionRow {
  id: string;
  name: string;
  name_en: string | null;
  country: string | null;
  city: string | null;
  email: string | null;
  phone: string | null;
  logo_url: string | null;
  subscription_plan: string;
  subscription_status: string;
  max_students: number;
  max_teachers: number;
  is_active: boolean;
  created_at: string;
}

interface BranchRow {
  id: string;
  institution_id: string;
  name: string;
  address: string | null;
  phone: string | null;
  is_active: boolean;
}

type Counts = { students: number; teachers: number; exams: number; branches: number };

const PLAN_LABELS: Record<string, { label: string; tone: 'neutral' | 'brand' | 'accent' | 'gold' }> = {
  free: { label: 'مجاني', tone: 'neutral' },
  basic: { label: 'أساسي', tone: 'brand' },
  pro: { label: 'احترافي', tone: 'accent' },
  enterprise: { label: 'مؤسسي', tone: 'gold' },
};

const emptyCounts: Counts = { students: 0, teachers: 0, exams: 0, branches: 0 };

export function Institutions() {
  const { role } = useAuthSafe();
  const isSuperAdmin = role === 'super_admin';
  const [institutions, setInstitutions] = useState<InstitutionRow[]>([]);
  const [branches, setBranches] = useState<BranchRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [showEditor, setShowEditor] = useState(false);
  const [showBranchEditor, setShowBranchEditor] = useState(false);
  const [editing, setEditing] = useState<InstitutionRow | null>(null);
  const [editingBranch, setEditingBranch] = useState<BranchRow | null>(null);
  const [selectedInstitutionId, setSelectedInstitutionId] = useState<string | null>(null);
  const [counts, setCounts] = useState<Record<string, Counts>>({});

  const loadInstitutions = useCallback(async () => {
    setLoading(true);
    setError(null);
    setNotice(null);

    const [institutionRes, branchRes] = await Promise.all([
      supabase.from('institutions').select('*').order('created_at', { ascending: false }),
      supabase.from('branches').select('id, institution_id, name, address, phone, is_active').order('name'),
    ]);

    if (institutionRes.error) { setError(getArabicErrorMessage(institutionRes.error)); setLoading(false); return; }
    if (branchRes.error) { setError(getArabicErrorMessage(branchRes.error)); setLoading(false); return; }

    const allInst = (institutionRes.data as InstitutionRow[]) ?? [];
    const allBranches = (branchRes.data as BranchRow[]) ?? [];
    setInstitutions(allInst);
    setBranches(allBranches);
    setSelectedInstitutionId((current) => current ?? allInst[0]?.id ?? null);
    setLoading(false);

    const countsMap: Record<string, Counts> = {};
    for (const inst of allInst) {
      const [s, t, e] = await Promise.all([
        supabase.from('student_profiles').select('id', { count: 'exact', head: true }).eq('institution_id', inst.id),
        supabase.from('staff_profiles').select('id', { count: 'exact', head: true }).eq('institution_id', inst.id),
        supabase.from('examify_exams').select('id', { count: 'exact', head: true }).eq('institution_id', inst.id),
      ]);
      countsMap[inst.id] = {
        students: s.count ?? 0,
        teachers: t.count ?? 0,
        exams: e.count ?? 0,
        branches: allBranches.filter((branch) => branch.institution_id === inst.id).length,
      };
    }
    setCounts(countsMap);
  }, []);

  useEffect(() => { loadInstitutions(); }, [loadInstitutions]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return institutions.filter((i) =>
      !term ||
      i.name.toLowerCase().includes(term) ||
      (i.name_en?.toLowerCase().includes(term) ?? false) ||
      (i.city?.toLowerCase().includes(term) ?? false) ||
      (i.email?.toLowerCase().includes(term) ?? false)
    );
  }, [institutions, search]);

  const selectedInstitution = institutions.find((item) => item.id === selectedInstitutionId) ?? filtered[0] ?? institutions[0] ?? null;
  const selectedBranches = selectedInstitution ? branches.filter((branch) => branch.institution_id === selectedInstitution.id) : [];

  async function handleToggleActive(inst: InstitutionRow) {
    setError(null);
    setNotice(null);
    const { error: err } = await supabase.from('institutions').update({ is_active: !inst.is_active }).eq('id', inst.id);
    if (err) { setError(getArabicErrorMessage(err)); return; }
    setInstitutions((prev) => prev.map((i) => i.id === inst.id ? { ...i, is_active: !i.is_active } : i));
    setNotice(inst.is_active ? 'تم تعطيل المؤسسة.' : 'تم تفعيل المؤسسة.');
  }

  async function handleSafeDelete(inst: InstitutionRow) {
    setError(null);
    setNotice(null);
    const c = counts[inst.id] ?? emptyCounts;
    const hasLinkedData = c.students + c.teachers + c.exams + c.branches > 0;

    if (hasLinkedData) {
      const { error: err } = await supabase.from('institutions').update({ is_active: false }).eq('id', inst.id);
      if (err) { setError(getArabicErrorMessage(err)); return; }
      setInstitutions((prev) => prev.map((i) => i.id === inst.id ? { ...i, is_active: false } : i));
      setNotice('لم يتم حذف المؤسسة لوجود بيانات مرتبطة. تم تعطيلها بدلًا من ذلك.');
      return;
    }

    if (!confirm('هل تريد حذف هذه المؤسسة الفارغة نهائيًا؟')) return;
    const { error: err } = await supabase.from('institutions').delete().eq('id', inst.id);
    if (err) { setError(getArabicErrorMessage(err)); return; }
    setInstitutions((prev) => prev.filter((i) => i.id !== inst.id));
    setNotice('تم حذف المؤسسة الفارغة.');
  }

  async function handleToggleBranch(branch: BranchRow) {
    setError(null);
    setNotice(null);
    const { error: err } = await supabase.from('branches').update({ is_active: !branch.is_active }).eq('id', branch.id);
    if (err) { setError(getArabicErrorMessage(err)); return; }
    setBranches((prev) => prev.map((item) => item.id === branch.id ? { ...item, is_active: !item.is_active } : item));
    setNotice(branch.is_active ? 'تم تعطيل الفرع.' : 'تم تفعيل الفرع.');
  }

  return (
    <div className="space-y-5">
      <SectionHeader
        title="إدارة المؤسسات"
        subtitle="إدارة المدارس والمؤسسات وفروعها على المنصة"
        action={isSuperAdmin && (
          <button data-testid="institution-add" onClick={() => { setEditing(null); setShowEditor(true); }} className="btn-primary">
            <Plus size={16} /> مؤسسة جديدة
          </button>
        )}
      />

      {error && <Alert tone="danger" message={error} />}
      {notice && <Alert tone="success" message={notice} />}

      <Card className="p-4">
        <div className="flex items-center gap-2">
          <Search size={16} className="text-ink-400" />
          <input data-testid="institution-search" className="input !py-2" placeholder="ابحث باسم المؤسسة أو المدينة..." value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </Card>

      {loading ? (
        <div data-testid="institutions-loading" className="flex justify-center py-16"><Loader2 size={24} className="animate-spin text-brand-600" /></div>
      ) : filtered.length === 0 ? (
        <Card><EmptyState icon={<Building2 size={40} />} title="لا توجد مؤسسات" subtitle="لا توجد نتائج مطابقة للبحث الحالي" /></Card>
      ) : (
        <div className="grid lg:grid-cols-[minmax(0,1fr)_380px] gap-4">
          <div className="grid gap-3">
            {filtered.map((inst) => {
              const plan = PLAN_LABELS[inst.subscription_plan] ?? PLAN_LABELS.free;
              const c = counts[inst.id] ?? emptyCounts;
              const selected = selectedInstitution?.id === inst.id;
              return (
                <Card key={inst.id} hover className={`p-5 ${selected ? 'ring-2 ring-brand-300' : ''}`}>
                  <button data-testid={`institution-row-${inst.id}`} type="button" onClick={() => setSelectedInstitutionId(inst.id)} className="w-full text-start">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-3 flex-1 min-w-0">
                        <div className="grid place-items-center w-12 h-12 rounded-xl bg-brand-100 text-brand-700 shrink-0">
                          {inst.logo_url ? <img src={inst.logo_url} alt={inst.name} className="w-full h-full rounded-xl object-cover" /> : <Building2 size={24} />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <h3 className="font-700 text-ink-900 truncate">{inst.name}</h3>
                            <Badge tone={plan.tone}>{plan.label}</Badge>
                            <Badge tone={inst.is_active ? 'accent' : 'danger'}>{inst.is_active ? 'نشطة' : 'غير نشطة'}</Badge>
                          </div>
                          <div className="flex flex-wrap items-center gap-3 text-xs text-ink-400">
                            {inst.country && <span>{inst.country}</span>}
                            {inst.city && <span>· {inst.city}</span>}
                            {inst.email && <span dir="ltr">· {inst.email}</span>}
                          </div>
                          <div className="flex items-center gap-4 mt-2 text-xs">
                            <span className="flex items-center gap-1 text-ink-500"><Users size={12} /> {c.students} طالب</span>
                            <span className="flex items-center gap-1 text-ink-500"><GraduationCap size={12} /> {c.teachers} موظف</span>
                            <span className="text-ink-500">{c.exams} اختبار</span>
                            <span className="text-ink-500">{c.branches} فرع</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </button>
                  {isSuperAdmin && (
                    <div className="flex gap-1 justify-end mt-3">
                      <button data-testid={`institution-toggle-${inst.id}`} onClick={() => handleToggleActive(inst)} className="grid place-items-center w-8 h-8 rounded-lg text-ink-400 hover:bg-ink-100" title={inst.is_active ? 'تعطيل' : 'تفعيل'}>
                        {inst.is_active ? <ToggleRight size={18} className="text-accent-600" /> : <ToggleLeft size={18} />}
                      </button>
                      <button data-testid={`institution-edit-${inst.id}`} onClick={() => { setEditing(inst); setShowEditor(true); }} className="grid place-items-center w-8 h-8 rounded-lg text-ink-400 hover:bg-ink-100 hover:text-ink-700" title="تعديل"><Edit3 size={16} /></button>
                      <button data-testid={`institution-delete-${inst.id}`} onClick={() => handleSafeDelete(inst)} className="grid place-items-center w-8 h-8 rounded-lg text-ink-400 hover:bg-danger-50 hover:text-danger-600" title="حذف أو تعطيل آمن"><Trash2 size={16} /></button>
                    </div>
                  )}
                </Card>
              );
            })}
          </div>

          <Card className="p-5 h-fit">
            <div className="flex items-start justify-between gap-3 mb-4">
              <div>
                <h3 className="font-700 text-ink-900">الفروع</h3>
                <p className="text-xs text-ink-500 mt-1">{selectedInstitution?.name ?? 'اختر مؤسسة لعرض فروعها'}</p>
              </div>
              {isSuperAdmin && selectedInstitution && (
                <button data-testid="branch-add" className="btn-secondary !py-2" onClick={() => { setEditingBranch(null); setShowBranchEditor(true); }}>
                  <Plus size={14} /> فرع
                </button>
              )}
            </div>
            {selectedBranches.length === 0 ? (
              <EmptyState icon={<MapPin size={32} />} title="لا توجد فروع" subtitle="أضف أول فرع لهذه المؤسسة" />
            ) : (
              <div className="space-y-2">
                {selectedBranches.map((branch) => (
                  <div data-testid={`branch-row-${branch.id}`} key={branch.id} className="rounded-lg border border-ink-100 p-3">
                    <div className="flex justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="font-600 text-sm text-ink-900 truncate">{branch.name}</p>
                          <Badge tone={branch.is_active ? 'accent' : 'danger'}>{branch.is_active ? 'نشط' : 'غير نشط'}</Badge>
                        </div>
                        {branch.address && <p className="text-xs text-ink-500 mt-1">{branch.address}</p>}
                        {branch.phone && <p className="text-xs text-ink-400 mt-1" dir="ltr">{branch.phone}</p>}
                      </div>
                      {isSuperAdmin && (
                        <div className="flex gap-1 shrink-0">
                          <button data-testid={`branch-toggle-${branch.id}`} onClick={() => handleToggleBranch(branch)} className="grid place-items-center w-8 h-8 rounded-lg text-ink-400 hover:bg-ink-100" title={branch.is_active ? 'تعطيل' : 'تفعيل'}>
                            {branch.is_active ? <ToggleRight size={17} className="text-accent-600" /> : <ToggleLeft size={17} />}
                          </button>
                          <button data-testid={`branch-edit-${branch.id}`} onClick={() => { setEditingBranch(branch); setShowBranchEditor(true); }} className="grid place-items-center w-8 h-8 rounded-lg text-ink-400 hover:bg-ink-100" title="تعديل"><Edit3 size={15} /></button>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      )}

      {showEditor && (
        <InstitutionEditor
          editing={editing}
          existing={institutions}
          onClose={() => setShowEditor(false)}
          onSaved={() => { setShowEditor(false); setEditing(null); loadInstitutions(); }}
        />
      )}
      {showBranchEditor && selectedInstitution && (
        <BranchEditor
          institutionId={selectedInstitution.id}
          editing={editingBranch}
          existing={selectedBranches}
          onClose={() => setShowBranchEditor(false)}
          onSaved={() => { setShowBranchEditor(false); setEditingBranch(null); loadInstitutions(); }}
        />
      )}
    </div>
  );
}

function Alert({ tone, message }: { tone: 'danger' | 'success'; message: string }) {
  const classes = tone === 'danger'
    ? 'bg-danger-50 border-danger-200 text-danger-700'
    : 'bg-accent-50 border-accent-200 text-accent-700';
  return (
    <div className={`flex items-center gap-2 p-3 rounded-xl border ${classes}`}>
      <AlertCircle size={18} />
      <p className="text-sm">{message}</p>
    </div>
  );
}

function InstitutionEditor({ editing, existing, onClose, onSaved }: { editing: InstitutionRow | null; existing: InstitutionRow[]; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(editing?.name ?? '');
  const [nameEn, setNameEn] = useState(editing?.name_en ?? '');
  const [country, setCountry] = useState(editing?.country ?? '');
  const [city, setCity] = useState(editing?.city ?? '');
  const [email, setEmail] = useState(editing?.email ?? '');
  const [phone, setPhone] = useState(editing?.phone ?? '');
  const [logoUrl, setLogoUrl] = useState(editing?.logo_url ?? '');
  const [plan, setPlan] = useState(editing?.subscription_plan ?? 'basic');
  const [maxStudents, setMaxStudents] = useState(editing?.max_students ?? 100);
  const [maxTeachers, setMaxTeachers] = useState(editing?.max_teachers ?? 10);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    setSaving(true);
    setError(null);
    const cleanName = name.trim();
    const duplicate = existing.some((inst) => inst.id !== editing?.id && inst.name.trim().toLowerCase() === cleanName.toLowerCase());
    if (!cleanName) { setError('اسم المؤسسة مطلوب'); setSaving(false); return; }
    if (duplicate) { setError('توجد مؤسسة بنفس الاسم. استخدم اسمًا مختلفًا.'); setSaving(false); return; }
    if (Number(maxStudents) < 1 || Number(maxTeachers) < 1) { setError('حدود الطلاب والمعلمين يجب أن تكون أكبر من صفر.'); setSaving(false); return; }

    const data = {
      name: cleanName,
      name_en: nameEn.trim() || null,
      country: country.trim() || null,
      city: city.trim() || null,
      email: email.trim() || null,
      phone: phone.trim() || null,
      logo_url: logoUrl.trim() || null,
      subscription_plan: plan,
      subscription_status: 'active',
      max_students: Number(maxStudents),
      max_teachers: Number(maxTeachers),
    };

    try {
      const { error: err } = editing
        ? await supabase.from('institutions').update(data).eq('id', editing.id)
        : await supabase.from('institutions').insert(data);
      if (err) throw err;
      onSaved();
    } catch (e) {
      setError(getArabicErrorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-ink-950/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div className="card w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 bg-white border-b border-ink-100 px-6 py-4 flex items-center justify-between">
          <h3 className="font-display text-lg font-700 text-ink-900">{editing ? 'تعديل المؤسسة' : 'مؤسسة جديدة'}</h3>
          <button onClick={onClose} className="text-ink-400 hover:text-ink-700 text-xl">×</button>
        </div>
        <div className="p-6 space-y-4">
          {error && <Alert tone="danger" message={error} />}
          <Field label="اسم المؤسسة" value={name} onChange={setName} testId="institution-name" placeholder="مثال: مدرسة النصر" />
          <Field label="الاسم بالإنجليزية - اختياري" value={nameEn} onChange={setNameEn} dir="ltr" />
          <div className="grid grid-cols-2 gap-4">
            <Field label="الدولة" value={country} onChange={setCountry} />
            <Field label="المدينة" value={city} onChange={setCity} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field label="البريد الإلكتروني" value={email} onChange={setEmail} dir="ltr" />
            <Field label="الهاتف" value={phone} onChange={setPhone} dir="ltr" />
          </div>
          <Field label="رابط الشعار" value={logoUrl} onChange={setLogoUrl} dir="ltr" placeholder="https://..." />
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="label">الخطة</label>
              <select data-testid="institution-plan" className="input" value={plan} onChange={(e) => setPlan(e.target.value)}>
                <option value="free">مجاني</option>
                <option value="basic">أساسي</option>
                <option value="pro">احترافي</option>
                <option value="enterprise">مؤسسي</option>
              </select>
            </div>
            <Field label="حد الطلاب" value={String(maxStudents)} onChange={(value) => setMaxStudents(Number(value))} type="number" />
            <Field label="حد المعلمين" value={String(maxTeachers)} onChange={(value) => setMaxTeachers(Number(value))} type="number" />
          </div>
        </div>
        <div className="sticky bottom-0 bg-white border-t border-ink-100 px-6 py-4 flex justify-end gap-2">
          <button onClick={onClose} className="btn-ghost">إلغاء</button>
          <button data-testid="institution-save" onClick={handleSave} disabled={saving} className="btn-primary disabled:opacity-60">
            {saving ? <Loader2 size={16} className="animate-spin" /> : null}
            {editing ? 'حفظ' : 'إنشاء'}
          </button>
        </div>
      </div>
    </div>
  );
}

function BranchEditor({ institutionId, editing, existing, onClose, onSaved }: { institutionId: string; editing: BranchRow | null; existing: BranchRow[]; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(editing?.name ?? '');
  const [address, setAddress] = useState(editing?.address ?? '');
  const [phone, setPhone] = useState(editing?.phone ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    setSaving(true);
    setError(null);
    const cleanName = name.trim();
    const duplicate = existing.some((branch) => branch.id !== editing?.id && branch.name.trim().toLowerCase() === cleanName.toLowerCase());
    if (!cleanName) { setError('اسم الفرع مطلوب'); setSaving(false); return; }
    if (duplicate) { setError('يوجد فرع بنفس الاسم داخل هذه المؤسسة.'); setSaving(false); return; }

    const payload = { institution_id: institutionId, name: cleanName, address: address.trim() || null, phone: phone.trim() || null };
    try {
      const { error: err } = editing
        ? await supabase.from('branches').update(payload).eq('id', editing.id)
        : await supabase.from('branches').insert(payload);
      if (err) throw err;
      onSaved();
    } catch (e) {
      setError(getArabicErrorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-ink-950/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div className="card w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="border-b border-ink-100 px-6 py-4 flex items-center justify-between">
          <h3 className="font-display text-lg font-700 text-ink-900">{editing ? 'تعديل الفرع' : 'فرع جديد'}</h3>
          <button onClick={onClose} className="text-ink-400 hover:text-ink-700 text-xl">×</button>
        </div>
        <div className="p-6 space-y-4">
          {error && <Alert tone="danger" message={error} />}
          <Field label="اسم الفرع" value={name} onChange={setName} testId="branch-name" />
          <Field label="العنوان" value={address} onChange={setAddress} />
          <Field label="الهاتف" value={phone} onChange={setPhone} dir="ltr" />
        </div>
        <div className="border-t border-ink-100 px-6 py-4 flex justify-end gap-2">
          <button onClick={onClose} className="btn-ghost">إلغاء</button>
          <button data-testid="branch-save" onClick={handleSave} disabled={saving} className="btn-primary disabled:opacity-60">
            {saving ? <Loader2 size={16} className="animate-spin" /> : null}
            حفظ
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, testId, placeholder, type = 'text', dir }: { label: string; value: string; onChange: (value: string) => void; testId?: string; placeholder?: string; type?: string; dir?: 'ltr' | 'rtl' }) {
  return (
    <div>
      <label className="label">{label}</label>
      <input data-testid={testId} className="input" type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} dir={dir} />
    </div>
  );
}
