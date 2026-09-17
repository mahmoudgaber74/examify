import { useEffect, useState } from 'react';
import { Card, Badge, SectionHeader } from '../components/ui';
import { EVENT_CATALOG } from '../lib/data';
import { UserManagement } from './UserManagement';
import { supabase, useAuthSafe } from '../lib/auth-helpers';
import { getArabicErrorMessage } from '../lib/translate';
import { useFeedback } from '../components/FeedbackProvider';
import { applyInstitutionTheme } from '../lib/institution-theme';
import {
  Building2, Palette, Shield, Webhook, Server, CreditCard, Check,
  Globe, MapPin, Phone, KeyRound, Database, Cloud, GitBranch, Loader2, Plus, Pencil, Trash2, Upload, ShieldCheck, History,
} from 'lucide-react';

const TABS = ['المؤسسة', 'العلامة البيضاء', 'الأمان', 'التوثيق التقني', 'البنية التحتية', 'الفوترة', 'users'] as const;
type Tab = typeof TABS[number];

interface InstitutionSettings {
  domain?: string;
  timezone?: string;
  language?: string;
  academicYear?: string;
  brandName?: string;
  primaryColor?: string;
  reportAddress?: string;
  reportPhone?: string;
}

interface InstitutionRecord {
  name: string;
  country: string | null;
  logo_url: string | null;
  website: string | null;
  settings: InstitutionSettings | null;
}

interface BranchRecord { id: string; institution_id: string; name: string; address: string | null; phone: string | null; is_active: boolean; }
interface MfaFactor { id: string; status: string; friendly_name?: string; }
interface AuditRecord { id: string; action: string; actor_role: string | null; created_at: string; }

const PLANS = [
  { name: 'المبتدئ', price: 'قريبًا', period: '', features: ['حتى 500 متعلّم', 'مؤسسة واحدة', 'تصحيح ذكي أساسي', 'دعم بريد إلكتروني'], current: false },
  { name: 'المهني', price: 'قريبًا', period: '', features: ['حتى 5,000 متعلّم', '3 فروع', 'حزمة ذكاء كاملة', 'دعم ذو أولوية', 'لوحة تحليلات'], current: false },
  { name: 'الأعمال', price: 'قريبًا', period: '', features: ['حتى 25,000 متعلّم', 'فروع غير محدودة', 'جاهز للعلامة البيضاء', 'مدير حساب مخصّص', 'وصول API'], current: false },
  { name: 'المؤسسي', price: 'تواصل معنا', period: '', features: ['متعلّمون غير محدودين', 'متعدّد المناطق', 'خيار على الموقع', 'دعم مؤسسي', 'نماذج ذكاء مخصّصة'], current: false },
];

export function Settings({ onLogoChange }: { onLogoChange?: (logoUrl: string | null) => void }) {
  const { user, institutionId, role } = useAuthSafe();
  const { confirm } = useFeedback();
  const canManage = role === 'super_admin' || role === 'school_admin';
  const visibleTabs = TABS.filter((item) => (item !== 'التوثيق التقني' && item !== 'البنية التحتية') || role === 'super_admin');
  const [tab, setTab] = useState<Tab>('المؤسسة');
  const [theme, setTheme] = useState({ primary: '#1a55f5', name: 'جامعة الملك سعود', domain: 'ksu.examify.ai' });
  const [orgForm, setOrgForm] = useState({ name: 'جامعة الملك سعود', country: 'السعودية', domain: 'ksu.examify.ai', timezone: 'آسيا/الرياض (GMT+3)', language: 'العربية', year: 'سبتمبر – يونيو', reportAddress: '', reportPhone: '' });
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [loadingSettings, setLoadingSettings] = useState(true);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [branches, setBranches] = useState<BranchRecord[]>([]);
  const [branchForm, setBranchForm] = useState({ name: '', address: '', phone: '' });
  const [editingBranch, setEditingBranch] = useState<string | null>(null);
  const [logoPath, setLogoPath] = useState<string | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [mfaFactors, setMfaFactors] = useState<MfaFactor[]>([]);
  const [mfaSetup, setMfaSetup] = useState<{ id: string; qrCode: string; secret: string } | null>(null);
  const [mfaCode, setMfaCode] = useState('');
  const [mfaBusy, setMfaBusy] = useState(false);
  const [mfaError, setMfaError] = useState<string | null>(null);
  const [auditLogs, setAuditLogs] = useState<AuditRecord[]>([]);

  async function refreshBranches() {
    if (!institutionId) return;
    const { data, error } = await supabase.from('branches').select('id, institution_id, name, address, phone, is_active').eq('institution_id', institutionId).order('name');
    if (error) { setSettingsError(getArabicErrorMessage(error)); return; }
    setBranches((data as BranchRecord[]) ?? []);
  }

  useEffect(() => {
    let mounted = true;
    async function loadInstitutionSettings() {
      if (!institutionId) { setLoadingSettings(false); return; }
      const { data, error } = await supabase.from('institutions').select('name, country, logo_url, website, settings').eq('id', institutionId).maybeSingle();
      if (!mounted) return;
      if (error) { setSettingsError(getArabicErrorMessage(error)); setLoadingSettings(false); return; }
      const row = data as InstitutionRecord | null;
      const saved = row?.settings ?? {};
      setOrgForm({ name: row?.name ?? 'مؤسستي', country: row?.country ?? 'السعودية', domain: saved.domain ?? '', timezone: saved.timezone ?? 'آسيا/الرياض (GMT+3)', language: saved.language ?? 'العربية', year: saved.academicYear ?? 'سبتمبر – يونيو', reportAddress: saved.reportAddress ?? '', reportPhone: saved.reportPhone ?? '' });
      setTheme({ primary: saved.primaryColor ?? '#1a55f5', name: saved.brandName ?? row?.name ?? 'مؤسستي', domain: saved.domain ?? row?.website ?? '' });
      setLogoPath(row?.logo_url ?? null);
      if (row?.logo_url?.startsWith('http')) setLogoPreview(row.logo_url);
      else if (row?.logo_url) {
        const { data: signed } = await supabase.storage.from('public-assets').createSignedUrl(row.logo_url, 60 * 60);
        if (mounted) setLogoPreview(signed?.signedUrl ?? null);
      }
      setLoadingSettings(false);
    }
    void loadInstitutionSettings();
    return () => { mounted = false; };
  }, [institutionId]);

  useEffect(() => { void refreshBranches(); }, [institutionId]);

  useEffect(() => {
    let mounted = true;
    if (!user) return () => { mounted = false; };
    void supabase.auth.mfa.listFactors().then(({ data, error }) => {
      if (!mounted) return;
      if (error) { setMfaError('خدمة المصادقة الثنائية غير متاحة في إعدادات المشروع الحالية.'); return; }
      setMfaFactors((data?.totp ?? []) as MfaFactor[]);
    });
    return () => { mounted = false; };
  }, [user]);

  async function refreshAuditLogs() {
    if (!institutionId) return;
    const { data } = await supabase.from('audit_log').select('id, action, actor_role, created_at').eq('institution_id', institutionId).order('created_at', { ascending: false }).limit(8);
    setAuditLogs((data as AuditRecord[]) ?? []);
  }

  useEffect(() => { void refreshAuditLogs(); }, [institutionId]);

  async function recordAudit(action: string, details: Record<string, unknown> = {}) {
    if (!institutionId || !user) return;
    await supabase.from('audit_log').insert({ institution_id: institutionId, actor_id: user.id, actor_role: role, action, entity_type: 'institutions', entity_id: institutionId, details });
    await refreshAuditLogs();
  }

  async function startMfaSetup() {
    setMfaBusy(true); setMfaError(null);
    const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp', issuer: 'Examify AI', friendlyName: 'حساب المدير' });
    setMfaBusy(false);
    if (error || !data || data.type !== 'totp') { setMfaError('تعذر بدء إعداد المصادقة الثنائية. تأكد من تفعيل MFA في مشروع Supabase.'); return; }
    setMfaSetup({ id: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret });
  }

  async function verifyMfaSetup() {
    if (!mfaSetup || !/^\d{6}$/.test(mfaCode.trim())) { setMfaError('اكتب الرمز المكوّن من 6 أرقام.'); return; }
    setMfaBusy(true); setMfaError(null);
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: mfaSetup.id, code: mfaCode.trim() });
    setMfaBusy(false);
    if (error) { setMfaError('الرمز غير صحيح أو انتهت صلاحيته.'); return; }
    setMfaFactors([{ id: mfaSetup.id, status: 'verified', friendly_name: 'حساب المدير' }]);
    setMfaSetup(null); setMfaCode('');
    setToast('تم تفعيل المصادقة الثنائية لهذا الحساب');
    await recordAudit('security.mfa_enabled');
    setTimeout(() => setToast(null), 2500);
  }

  async function saveBranch() {
    if (!institutionId || !branchForm.name.trim()) { setSettingsError('اكتب اسم الفرع أولاً.'); return; }
    setSaving(true); setSettingsError(null);
    const payload = { name: branchForm.name.trim(), address: branchForm.address.trim() || null, phone: branchForm.phone.trim() || null };
    const response = editingBranch
      ? await supabase.from('branches').update(payload).eq('id', editingBranch).eq('institution_id', institutionId)
      : await supabase.from('branches').insert({ ...payload, institution_id: institutionId });
    setSaving(false);
    if (response.error) { setSettingsError(getArabicErrorMessage(response.error)); return; }
    await recordAudit(editingBranch ? 'branch.updated' : 'branch.created', { branch_name: payload.name });
    setBranchForm({ name: '', address: '', phone: '' }); setEditingBranch(null); await refreshBranches();
  }

  async function toggleBranch(branch: BranchRecord) {
    const { error } = await supabase.from('branches').update({ is_active: !branch.is_active }).eq('id', branch.id).eq('institution_id', institutionId);
    if (error) setSettingsError(getArabicErrorMessage(error)); else { await recordAudit(branch.is_active ? 'branch.disabled' : 'branch.enabled', { branch_id: branch.id }); await refreshBranches(); }
  }

  async function deleteBranch(branch: BranchRecord) {
    if (!(await confirm(`هل تريد حذف فرع ${branch.name}؟`, { title: 'حذف الفرع', confirmLabel: 'حذف الفرع' }))) return;
    const { error } = await supabase.from('branches').delete().eq('id', branch.id).eq('institution_id', institutionId);
    if (error) setSettingsError(getArabicErrorMessage(error)); else { await recordAudit('branch.deleted', { branch_name: branch.name }); await refreshBranches(); }
  }

  async function handleLogoUpload(file: File | undefined) {
    if (!file || !institutionId) return;
    if (!['image/png', 'image/jpeg', 'image/svg+xml'].includes(file.type) || file.size > 2 * 1024 * 1024) { setSettingsError('الشعار يجب أن يكون PNG أو JPG أو SVG وبحجم أقصى 2MB.'); return; }
    setUploadingLogo(true); setSettingsError(null);
    const extension = file.type === 'image/svg+xml' ? 'svg' : file.type === 'image/png' ? 'png' : 'jpg';
    // Storage policies require: institution UUID / site-public / owner UUID / file.
    const path = `${institutionId}/site-public/${(await supabase.auth.getUser()).data.user?.id ?? 'unknown'}/logo.${extension}`;
    if (path.includes('/unknown/')) { setSettingsError('تعذر التحقق من حساب المستخدم قبل رفع الشعار.'); setUploadingLogo(false); return; }
    const { error: uploadError } = await supabase.storage.from('public-assets').upload(path, file, { upsert: true, contentType: file.type });
    if (uploadError) { setSettingsError(getArabicErrorMessage(uploadError)); setUploadingLogo(false); return; }
    const { error: updateError } = await supabase.from('institutions').update({ logo_url: path }).eq('id', institutionId);
    if (updateError) { setSettingsError(getArabicErrorMessage(updateError)); setUploadingLogo(false); return; }
    const { data: signed } = await supabase.storage.from('public-assets').createSignedUrl(path, 60 * 60);
    const nextLogoUrl = signed?.signedUrl ?? URL.createObjectURL(file);
    setLogoPath(path); setLogoPreview(nextLogoUrl); onLogoChange?.(nextLogoUrl); setUploadingLogo(false);
    setToast('تم رفع الشعار وحفظه'); setTimeout(() => setToast(null), 2500);
  }

  const saveOrg = async () => {
    if (!institutionId) { setSettingsError('لا توجد مؤسسة مرتبطة بهذا الحساب.'); return; }
    setSaving(true);
    setSettingsError(null);
    const { data: current, error: readError } = await supabase.from('institutions').select('settings').eq('id', institutionId).maybeSingle();
    if (readError) { setSettingsError(getArabicErrorMessage(readError)); setSaving(false); return; }
    const currentSettings = ((current as { settings?: InstitutionSettings } | null)?.settings ?? {});
    const { error } = await supabase.from('institutions').update({ name: orgForm.name.trim(), country: orgForm.country, settings: { ...currentSettings, domain: orgForm.domain.trim(), timezone: orgForm.timezone, language: orgForm.language, academicYear: orgForm.year, reportAddress: orgForm.reportAddress.trim(), reportPhone: orgForm.reportPhone.trim() } }).eq('id', institutionId);
    setSaving(false);
    if (error) { setSettingsError(getArabicErrorMessage(error)); return; }
    await recordAudit('institution.settings_updated', { fields: ['name', 'country', 'domain', 'timezone', 'language', 'academicYear'] });
    setTheme((currentTheme) => ({ ...currentTheme, name: orgForm.name.trim(), domain: orgForm.domain.trim() }));
    setToast('تم حفظ إعدادات المؤسسة بنجاح');
    setTimeout(() => setToast(null), 2500);
  };

  const saveTheme = async () => {
    if (!institutionId) { setSettingsError('لا توجد مؤسسة مرتبطة بهذا الحساب.'); return; }
    setSaving(true);
    setSettingsError(null);
    const { data: current, error: readError } = await supabase.from('institutions').select('settings').eq('id', institutionId).maybeSingle();
    if (readError) { setSettingsError(getArabicErrorMessage(readError)); setSaving(false); return; }
    const currentSettings = ((current as { settings?: InstitutionSettings } | null)?.settings ?? {});
    const { error } = await supabase.from('institutions').update({ settings: { ...currentSettings, brandName: theme.name.trim(), domain: theme.domain.trim(), primaryColor: theme.primary } }).eq('id', institutionId);
    setSaving(false);
    if (error) { setSettingsError(getArabicErrorMessage(error)); return; }
    applyInstitutionTheme(theme.primary);
    await recordAudit('brand.settings_updated', { primary_color: theme.primary, brand_name: theme.name.trim() });
    setToast('تم حفظ إعدادات العلامة التجارية');
    setTimeout(() => setToast(null), 2500);
  };

  return (
    <div className="space-y-6">
      {toast && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-4 py-2.5 rounded-xl bg-accent-600 text-white shadow-pop animate-fade-in">
          <Check size={16} /> <span className="text-sm font-600">{toast}</span>
        </div>
      )}
      {settingsError && <div className="flex items-center gap-2 p-3 rounded-xl bg-danger-50 border border-danger-200"><span className="text-sm text-danger-700">{settingsError}</span></div>}
      {loadingSettings && <div className="flex items-center gap-2 rounded-xl border border-brand-100 bg-brand-50 p-3 text-sm text-brand-700"><Loader2 size={16} className="animate-spin" /> جاري تحميل إعدادات المؤسسة...</div>}

      <div className="flex items-center gap-1 p-1 bg-white rounded-xl border border-ink-100 overflow-x-auto no-scrollbar w-fit max-w-full">
        {visibleTabs.map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`px-4 py-2 rounded-lg text-sm font-600 whitespace-nowrap transition ${tab === t ? 'bg-brand-600 text-white shadow-soft' : 'text-ink-600 hover:bg-ink-100'}`}>{t === 'users' ? 'المستخدمون' : t}</button>
        ))}
      </div>

      {tab === 'users' && <UserManagement />}

      {tab === 'المؤسسة' && (
        <div className="space-y-6">
          <Card className="p-6">
            <SectionHeader title="ملف المؤسسة" subtitle="إعدادات المؤسسة الأساسية" action={<Building2 size={18} className="text-ink-400" />} />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div><label className="label">اسم المؤسسة</label><input className="input" value={orgForm.name} onChange={(e) => setOrgForm({ ...orgForm, name: e.target.value })} /></div>
              <div><label className="label">الدولة</label><select className="input" value={orgForm.country} onChange={(e) => setOrgForm({ ...orgForm, country: e.target.value })}><option>السعودية</option><option>مصر</option><option>ألمانيا</option><option>كندا</option></select></div>
              <div><label className="label">النطاق الأساسي</label><input className="input nums-latin" value={orgForm.domain} onChange={(e) => setOrgForm({ ...orgForm, domain: e.target.value })} /></div>
              <div><label className="label">المنطقة الزمنية</label><select className="input" value={orgForm.timezone} onChange={(e) => setOrgForm({ ...orgForm, timezone: e.target.value })}><option>آسيا/الرياض (GMT+3)</option><option>أوروبا/برلين</option><option>أمريكا/مكسيكو</option></select></div>
              <div><label className="label">اللغة الافتراضية</label><select className="input" value={orgForm.language} onChange={(e) => setOrgForm({ ...orgForm, language: e.target.value })}><option>العربية</option><option>English</option><option>Español</option><option>Deutsch</option></select></div>
              <div><label className="label">صيغة العام الدراسي</label><select className="input" value={orgForm.year} onChange={(e) => setOrgForm({ ...orgForm, year: e.target.value })}><option>سبتمبر – يونيو</option><option>يناير – ديسمبر</option></select></div>
              <div><label className="label">عنوان التقارير</label><input className="input" placeholder="العنوان الذي يظهر أسفل التقارير" value={orgForm.reportAddress} onChange={(e) => setOrgForm({ ...orgForm, reportAddress: e.target.value })} /></div>
              <div><label className="label">هاتف التقارير</label><input className="input nums-latin" dir="ltr" placeholder="رقم الهاتف الظاهر في التقارير" value={orgForm.reportPhone} onChange={(e) => setOrgForm({ ...orgForm, reportPhone: e.target.value })} /></div>
            </div>
            <div className="flex gap-2 mt-5"><button onClick={saveOrg} disabled={saving} className="btn-primary disabled:opacity-60">{saving ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />} حفظ التغييرات</button><button onClick={() => setOrgForm({ name: 'جامعة الملك سعود', country: 'السعودية', domain: 'ksu.examify.ai', timezone: 'آسيا/الرياض (GMT+3)', language: 'العربية', year: 'سبتمبر – يونيو', reportAddress: '', reportPhone: '' })} className="btn-outline">إلغاء</button></div>
          </Card>
          <Card className="p-6">
            <SectionHeader title="الفروع" subtitle={`${branches.filter((branch) => branch.is_active).length} نشط`} />
            <div className="space-y-3">
              {branches.map((b) => (
                <div key={b.id} className="rounded-2xl border border-ink-200 bg-ink-50/40 p-4 transition hover:border-brand-200 hover:bg-white">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-brand-50 text-brand-600"><Globe size={21} /></div>
                      <div className="min-w-0">
                        <p className="truncate text-base font-700 text-ink-900">{b.name}</p>
                        <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-ink-500">
                          <span className="inline-flex items-center gap-1.5"><MapPin size={14} className="shrink-0 text-ink-400" />{b.address || 'بدون عنوان'}</span>
                          {b.phone && <span dir="ltr" className="inline-flex items-center gap-1.5 nums-latin"><Phone size={14} className="shrink-0 text-ink-400" />{b.phone}</span>}
                        </div>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 border-t border-ink-200 pt-3 lg:border-t-0 lg:pt-0">
                      <span className={`inline-flex h-9 items-center rounded-lg border px-3 text-sm font-600 ${b.is_active ? 'border-accent-100 bg-accent-50 text-accent-700' : 'border-warning-100 bg-warning-50 text-warning-600'}`}>
                        {b.is_active ? 'نشط' : 'متوقف'}
                      </span>
                      {canManage && <>
                        <button type="button" onClick={() => { setEditingBranch(b.id); setBranchForm({ name: b.name, address: b.address ?? '', phone: b.phone ?? '' }); }} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-ink-200 bg-white px-3 text-sm text-ink-600 transition hover:border-brand-300 hover:text-brand-600" title="تعديل"><Pencil size={14} /> تعديل</button>
                        <button type="button" onClick={() => void toggleBranch(b)} className="inline-flex h-9 items-center rounded-lg border border-ink-200 bg-white px-3 text-sm text-ink-600 transition hover:border-brand-300 hover:text-brand-600">{b.is_active ? 'تعطيل' : 'تفعيل'}</button>
                        <button type="button" onClick={() => void deleteBranch(b)} className="grid h-9 w-9 place-items-center rounded-lg border border-danger-100 bg-white text-danger-500 transition hover:border-danger-300 hover:bg-danger-50" title="حذف"><Trash2 size={15} /></button>
                      </>}
                    </div>
                  </div>
                </div>
              ))}
              {branches.length === 0 && <p className="py-5 text-center text-sm text-ink-400">لا توجد فروع مضافة بعد.</p>}
            </div>
            {canManage && <div className="mt-3 border-t border-ink-100 pt-3 space-y-2"><div className="grid grid-cols-1 sm:grid-cols-3 gap-2"><input className="input" placeholder="اسم الفرع" value={branchForm.name} onChange={(e) => setBranchForm({ ...branchForm, name: e.target.value })} /><input className="input" placeholder="العنوان" value={branchForm.address} onChange={(e) => setBranchForm({ ...branchForm, address: e.target.value })} /><input className="input nums-latin" placeholder="الهاتف" value={branchForm.phone} onChange={(e) => setBranchForm({ ...branchForm, phone: e.target.value })} dir="ltr" /></div><div className="flex gap-2"><button type="button" onClick={() => void saveBranch()} disabled={saving} className="btn-primary flex-1"><Plus size={16} /> {editingBranch ? 'حفظ الفرع' : 'إضافة فرع'}</button>{editingBranch && <button type="button" onClick={() => { setEditingBranch(null); setBranchForm({ name: '', address: '', phone: '' }); }} className="btn-outline">إلغاء</button>}</div></div>}
          </Card>
        </div>
      )}

      {tab === 'العلامة البيضاء' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card className="p-6">
            <SectionHeader title="العلامة التجارية" subtitle="خصّص مظهر المنصّة" action={<Palette size={18} className="text-brand-600" />} />
            <div className="space-y-4">
              <div><label className="label">النطاق المخصّص</label><input className="input nums-latin" value={theme.domain} onChange={(e) => setTheme({ ...theme, domain: e.target.value })} /></div>
              <div><label className="label">الاسم الظاهر</label><input className="input" value={theme.name} onChange={(e) => setTheme({ ...theme, name: e.target.value })} /></div>
              <div>
                <label className="label">اللون الأساسي</label>
                <div className="flex items-center gap-2">
                  <input type="color" value={theme.primary} onChange={(e) => setTheme({ ...theme, primary: e.target.value })} className="w-12 h-10 rounded-lg border border-ink-200 cursor-pointer" />
                  <input className="input flex-1 nums-latin" value={theme.primary} onChange={(e) => setTheme({ ...theme, primary: e.target.value })} />
                </div>
              </div>
              <div>
                <label className="label">الشعار</label>
                <div className="flex items-center gap-3 p-3 rounded-xl border-2 border-dashed border-ink-200">
                  <div className="grid place-items-center w-12 h-12 rounded-lg text-white overflow-hidden" style={{ background: theme.primary }}>{logoPreview ? <img src={logoPreview} alt="شعار المؤسسة" className="w-full h-full object-contain bg-white" /> : <Building2 size={20} />}</div>
                  <div className="flex-1"><p className="text-sm font-600 text-ink-700 nums-latin">{logoPath ? 'شعار المؤسسة محفوظ' : 'لم يتم رفع شعار بعد'}</p><p className="text-xs text-ink-400">SVG أو PNG أو JPG، بحد أقصى 2MB</p></div>
                  <label className="btn-outline !py-2 !text-xs cursor-pointer"><Upload size={14} /> {uploadingLogo ? 'جاري الرفع...' : 'رفع شعار'}<input type="file" accept="image/png,image/jpeg,image/svg+xml" className="hidden" disabled={uploadingLogo} onChange={(e) => void handleLogoUpload(e.target.files?.[0])} /></label>
                </div>
              </div>
              <div className="flex items-center justify-between p-3 rounded-xl bg-ink-50">
                <div><p className="text-sm font-600 text-ink-800">تطبيق جوال مخصّص</p><p className="text-xs text-ink-500">تطبيقات iOS و Android بعلامتك</p></div>
                <label className="relative inline-flex items-center cursor-pointer"><input type="checkbox" defaultChecked className="sr-only peer" /><span className="w-11 h-6 bg-ink-200 peer-checked:bg-brand-600 rounded-full peer transition relative after:content-[''] after:absolute after:top-0.5 after:right-0.5 after:bg-white after:rounded-full after:h-5 after:w-5 after:transition peer-checked:after:-translate-x-5" /></label>
              </div>
              <button onClick={saveTheme} disabled={saving} className="btn-primary w-full disabled:opacity-60">{saving ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />} حفظ العلامة التجارية</button>
            </div>
          </Card>
          <Card className="p-6">
            <SectionHeader title="معاينة حيّة" subtitle="منصّتك بعلامتك التجارية" />
            <div className="rounded-2xl border border-ink-200 overflow-hidden">
              <div className="p-4 text-white" style={{ background: `linear-gradient(135deg, ${theme.primary}, ${theme.primary}dd)` }}>
                <div className="flex items-center gap-2">
                  <div className="grid place-items-center w-8 h-8 rounded-lg bg-white/20"><Building2 size={16} /></div>
                  <div><p className="font-display font-800 text-sm">{theme.name}</p><p className="text-[10px] opacity-80 nums-latin">{theme.domain}</p></div>
                </div>
              </div>
              <div className="p-4 space-y-2">
                <div className="h-8 rounded-lg" style={{ background: `${theme.primary}15` }} />
                <div className="grid grid-cols-3 gap-2">
                  {[1, 2, 3].map((i) => <div key={i} className="h-16 rounded-lg bg-ink-50" />)}
                </div>
                <div className="h-8 rounded-lg bg-ink-50" />
                <button className="w-full py-2 rounded-lg text-white text-sm font-600" style={{ background: theme.primary }}>زر أساسي</button>
              </div>
            </div>
          </Card>
        </div>
      )}

      {tab === 'الأمان' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card className="p-6">
            <SectionHeader title="الأمان والامتثال" action={<Shield size={18} className="text-accent-600" />} />
            <div className="space-y-3">
              <div className="rounded-xl border border-brand-100 bg-brand-50/50 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-2.5"><ShieldCheck size={19} className="mt-0.5 shrink-0 text-brand-600" /><div><p className="text-sm font-700 text-ink-900">المصادقة الثنائية للحساب</p><p className="mt-0.5 text-xs leading-5 text-ink-500">تحمي حساب المدير برمز من تطبيق المصادقة.</p></div></div>
                  {mfaFactors.length > 0 ? <span className="rounded-lg bg-accent-50 px-2.5 py-1 text-xs font-700 text-accent-700">مفعّلة</span> : <span className="rounded-lg bg-warning-50 px-2.5 py-1 text-xs font-700 text-warning-600">غير مفعّلة</span>}
                </div>
                {mfaError && <p className="mt-3 text-xs leading-5 text-danger-600">{mfaError}</p>}
                {!mfaSetup && mfaFactors.length === 0 && <button type="button" onClick={() => void startMfaSetup()} disabled={mfaBusy} className="btn-primary mt-3 w-full disabled:opacity-60">{mfaBusy ? <Loader2 size={15} className="animate-spin" /> : <ShieldCheck size={15} />} بدء إعداد المصادقة الثنائية</button>}
                {mfaSetup && <div className="mt-3 rounded-xl border border-ink-200 bg-white p-3">
                  <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-start"><img src={`data:image/svg+xml;utf-8,${encodeURIComponent(mfaSetup.qrCode)}`} alt="رمز إعداد المصادقة الثنائية" className="h-32 w-32 rounded-lg border border-ink-100 p-1" /><div className="min-w-0 flex-1"><p className="text-xs leading-5 text-ink-600">امسح الرمز باستخدام Google Authenticator أو أي تطبيق TOTP، ثم اكتب الرمز الظاهر.</p><p className="mt-2 break-all rounded-lg bg-ink-50 p-2 font-mono text-[11px] text-ink-600 nums-latin">{mfaSetup.secret}</p></div></div>
                  <input inputMode="numeric" maxLength={6} className="input nums-latin mt-3 text-center tracking-[0.4em]" value={mfaCode} onChange={(event) => setMfaCode(event.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="000000" aria-label="رمز المصادقة" />
                  <button type="button" onClick={() => void verifyMfaSetup()} disabled={mfaBusy} className="btn-primary mt-2 w-full disabled:opacity-60">{mfaBusy ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />} تأكيد التفعيل</button>
                </div>}
              </div>
              {[
                { key: 'encryptionAtRest' as const, label: 'التشفير أثناء التخزين', desc: 'AES-256 عبر البنية التحتية وقاعدة البيانات', status: 'مفعّل عبر المنصة' },
                { key: 'encryptionInTransit' as const, label: 'التشفير أثناء النقل', desc: 'الاتصالات الآمنة عبر HTTPS/TLS', status: 'مفعّل عبر المنصة' },
                { key: 'rbac' as const, label: 'التحكم بالوصول حسب الدور', desc: 'الصلاحيات محكومة بالأدوار وسياسات RLS', status: 'مفعّل' },
                { key: 'deviceTracking' as const, label: 'تتبّع الأجهزة', desc: 'مراقبة وتقييد جلسات الأجهزة', status: 'قيد التطوير' },
                { key: 'anomalyDetection' as const, label: 'كشف النشاط المشبوه', desc: 'تنبيهات شذوذ بالذكاء الاصطناعي', status: 'قيد التطوير' },
                { key: 'auditLogs' as const, label: 'سجلات التدقيق', desc: 'تسجيل تغييرات الإعدادات والبيانات الحساسة', status: 'مفعّلة' },
              ].map((s) => (
                <div key={s.key} className="flex items-center justify-between p-3 rounded-xl border border-ink-100">
                  <div className="min-w-0"><p className="text-sm font-600 text-ink-800">{s.label}</p><p className="text-xs text-ink-500">{s.desc}</p></div>
                  <span className={`mr-3 shrink-0 rounded-lg px-2.5 py-1 text-[11px] font-700 ${s.status === 'قيد التطوير' ? 'bg-warning-50 text-warning-600' : 'bg-accent-50 text-accent-700'}`}>{s.status}</span>
                </div>
              ))}
            </div>
          </Card>
          <Card className="p-6">
            <SectionHeader title="شهادات الامتثال" />
            <div className="grid grid-cols-2 gap-3">
              {['SOC 2 Type II', 'GDPR', 'ISO 27001', 'FERPA', 'HIPAA', 'CCPA'].map((c) => (
                <div key={c} className="p-4 rounded-xl bg-accent-50 border border-accent-100 flex items-center gap-2">
                  <Shield size={18} className="text-ink-400" />
                  <div><p className="text-sm font-700 text-ink-900 nums-latin">{c}</p><p className="text-[11px] text-ink-500">متطلبات مستهدفة</p></div>
                </div>
              ))}
            </div>
            <div className="mt-4 p-4 rounded-xl bg-ink-50">
              <div className="flex items-center gap-2 mb-2"><KeyRound size={16} className="text-ink-500" /><span className="text-sm font-600 text-ink-800">مفاتيح API</span></div>
              <div className="space-y-2">
                {[{ name: 'الإنتاج', key: 'exm_prod_••••••••4f2a' }, { name: 'التجريبي', key: 'exm_stg_••••••••9b1c' }].map((k) => (
                  <div key={k.name} className="flex items-center justify-between p-2 rounded-lg bg-white border border-ink-100">
                    <div><p className="text-xs font-600 text-ink-700">{k.name}</p><p className="text-[11px] font-mono text-ink-400 nums-latin">{k.key}</p></div>
                    <button onClick={() => window.alert(`تم طلب تدوير مفتاح ${k.name}. في الإنتاج يجب تأكيد العملية من الخادم.`)} className="text-xs font-600 text-brand-600">تدوير</button>
                  </div>
                ))}
              </div>
            </div>
            <div className="mt-4 rounded-xl border border-ink-100 bg-ink-50 p-4">
              <div className="mb-3 flex items-center gap-2"><History size={16} className="text-ink-500" /><span className="text-sm font-700 text-ink-800">آخر أنشطة الأمان</span></div>
              {auditLogs.length === 0 ? <p className="text-xs text-ink-500">لا توجد أنشطة مسجلة بعد.</p> : <div className="space-y-2">{auditLogs.slice(0, 5).map((log) => <div key={log.id} className="flex items-center justify-between gap-3 rounded-lg border border-ink-100 bg-white px-3 py-2"><span className="truncate text-xs font-600 text-ink-700">{log.action}</span><time className="shrink-0 text-[11px] text-ink-400 nums-latin" dateTime={log.created_at}>{new Date(log.created_at).toLocaleDateString('ar-EG')}</time></div>)}</div>}
            </div>
          </Card>
        </div>
      )}

      {tab === 'التوثيق التقني' && (
        <Card className="overflow-hidden">
          <div className="p-5 border-b border-ink-100"><SectionHeader title="خريطة الأحداث — توثيق تقني" subtitle={`توثيق ${EVENT_CATALOG.length} أحداث · التكامل التشغيلي غير متصل حاليًا`} action={<Webhook size={18} className="text-brand-600" />} /></div>
          <div className="m-5 rounded-xl border border-warning-100 bg-warning-50 p-4 text-sm leading-6 text-warning-700">هذه الصفحة مرجع معماري لفريق التطوير فقط. الأحداث المعروضة ليست اتصالًا مباشرًا بـ Kafka ولا يمكن تشغيلها أو مراقبتها من هنا.</div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-ink-50 text-ink-500 text-xs">
                <tr><th className="text-right font-600 px-4 py-3">الحدث</th><th className="text-right font-600 px-4 py-3">المُنتِج</th><th className="text-right font-600 px-4 py-3">المستهلكون</th><th className="text-right font-600 px-4 py-3">التكرار</th></tr>
              </thead>
              <tbody className="divide-y divide-ink-50">
                {EVENT_CATALOG.map((e) => (
                  <tr key={e.name} className="hover:bg-ink-50/50">
                    <td className="px-4 py-3"><span className="font-mono text-brand-700 font-600 nums-latin">{e.name}</span></td>
                    <td className="px-4 py-3 text-ink-600">{e.service}</td>
                    <td className="px-4 py-3"><div className="flex flex-wrap gap-1">{e.consumers.map((c) => <span key={c} className="chip bg-ink-100 text-ink-600 text-[10px]">{c}</span>)}</div></td>
                    <td className="px-4 py-3"><Badge tone={e.frequency === 'عالٍ جداً' ? 'danger' : e.frequency === 'عالي' ? 'brand' : 'neutral'}>{e.frequency}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {tab === 'البنية التحتية' && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { label: 'المنصة الحالية', value: 'Supabase', icon: Cloud, items: 'بيئة الإنتاج الحالية' },
              { label: 'قاعدة البيانات', value: 'PostgreSQL', icon: Database, items: 'مخزنة عبر Supabase' },
              { label: 'الخدمات الخلفية', value: 'Edge Functions', icon: GitBranch, items: 'وظائف آمنة على الخادم' },
              { label: 'الملفات', value: 'Supabase Storage', icon: Server, items: 'الشعارات والملفات المرفوعة' },
            ].map((s) => (
              <Card key={s.label} className="p-4">
                <s.icon size={18} className="text-brand-600 mb-2" />
                <p className="text-xs text-ink-500">{s.label}</p>
                <p className="font-display font-700 text-ink-900">{s.value}</p>
                <p className="text-[11px] text-ink-400 mt-0.5 nums-latin">{s.items}</p>
              </Card>
            ))}
          </div>
          <Card className="p-6">
            <SectionHeader title="حالة البنية التحتية" subtitle="المراقبة اللحظية غير مفعّلة حاليًا" action={<Server size={18} className="text-ink-400" />} />
            <div className="rounded-xl border border-warning-100 bg-warning-50 p-4 text-sm leading-6 text-warning-700">لا توجد لوحة مراقبة متصلة حاليًا بـPrometheus أو Grafana. هذه الصفحة تعرض مكونات البيئة الحالية فقط، ولا تعرض أرقام تشغيل وهمية.</div>
          </Card>
        </div>
      )}

      {tab === 'الفوترة' && (
        <div className="space-y-6">
          <Card className="p-6">
            <SectionHeader title="الفوترة والاشتراك" subtitle="إدارة الخطط والفواتير ستتوفر عند ربط بوابة الدفع" action={<CreditCard size={18} className="text-brand-600" />} />
            <div className="flex flex-col gap-3 rounded-xl border border-warning-100 bg-warning-50 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div><div className="flex items-center gap-2"><p className="font-display text-lg font-700 text-ink-900">الحساب التجريبي</p><Badge tone="warning">قيد التجهيز</Badge></div><p className="mt-1 text-sm text-ink-600">لا يوجد اشتراك مدفوع أو موعد تجديد مرتبط بهذا الحساب حاليًا.</p></div>
              <div className="rounded-lg bg-white/70 px-3 py-2 text-sm text-ink-600">استهلاك الذكاء: غير متاح</div>
            </div>
            <div className="mt-4 rounded-xl border border-ink-100 bg-ink-50 p-4 text-sm leading-6 text-ink-600">لن يتم عرض أرصدة أو نسب استخدام أو فواتير إلا بعد ربطها بسجل استهلاك حقيقي وبوابة دفع معتمدة.</div>
          </Card>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {PLANS.map((p) => (
              <Card key={p.name} className={`flex flex-col p-5 ${p.current ? 'border-2 border-brand-500' : ''}`}>
                <div className="flex items-center justify-between mb-1">
                  <p className="font-display font-700 text-ink-900">{p.name}</p>
                  {p.current && <Badge tone="brand">الحالية</Badge>}
                </div>
                <div className="flex items-end gap-0.5 mb-4">
                  <span className="font-display text-2xl font-800 text-ink-900 nums-latin">{p.price}</span>
                  <span className="text-sm text-ink-400 mb-1">{p.period}</span>
                </div>
                <ul className="space-y-1.5 mb-4">
                  {p.features.map((f) => (
                    <li key={f} className="flex items-start gap-2 text-xs text-ink-600"><Check size={13} className="text-accent-600 mt-0.5 shrink-0" /> {f}</li>
                  ))}
                </ul>
                <button type="button" disabled className="btn-outline mt-auto w-full cursor-not-allowed opacity-60">متاح قريبًا</button>
              </Card>
            ))}
          </div>
          {role === 'super_admin' && <Card className="p-6"><SectionHeader title="تقارير الإيرادات" subtitle="ستظهر بعد ربط نظام الاشتراكات والفواتير" action={<CreditCard size={18} className="text-ink-400" />} /><div className="rounded-xl border border-ink-100 bg-ink-50 p-4 text-sm leading-6 text-ink-600">لا توجد بيانات إيرادات حقيقية متاحة حاليًا. سيتم تفعيل هذا القسم مع بوابة الدفع وWebhooks الخاصة بالاشتراكات.</div></Card>}
        </div>
      )}
    </div>
  );
}
