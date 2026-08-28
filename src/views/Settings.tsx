import { useEffect, useState } from 'react';
import { Card, Badge, SectionHeader, ProgressBar } from '../components/ui';
import { EVENT_CATALOG, MICROSERVICES } from '../lib/data';
import { UserManagement } from './UserManagement';
import { supabase, useAuthSafe } from '../lib/auth-helpers';
import { getArabicErrorMessage } from '../lib/translate';
import {
  Building2, Palette, Shield, Webhook, Server, CreditCard, Check,
  Globe, KeyRound, Database, Cloud, GitBranch, Zap, Loader2, Plus, Pencil, Trash2, Upload,
} from 'lucide-react';

const TABS = ['المؤسسة', 'العلامة البيضاء', 'الأمان', 'كتالوج الأحداث', 'البنية التحتية', 'الفوترة', 'users'] as const;
type Tab = typeof TABS[number];

interface InstitutionSettings {
  domain?: string;
  timezone?: string;
  language?: string;
  academicYear?: string;
  brandName?: string;
  primaryColor?: string;
  security?: { twofa?: boolean; encryptionAtRest?: boolean; encryptionInTransit?: boolean; rbac?: boolean; deviceTracking?: boolean; anomalyDetection?: boolean; auditLogs?: boolean };
}

interface InstitutionRecord {
  name: string;
  country: string | null;
  logo_url: string | null;
  website: string | null;
  settings: InstitutionSettings | null;
}

interface BranchRecord { id: string; institution_id: string; name: string; address: string | null; phone: string | null; is_active: boolean; }

const PLANS = [
  { name: 'المبتدئ', price: '199$', period: '/شهر', features: ['حتى 500 متعلّم', 'مؤسسة واحدة', 'تصحيح ذكي أساسي', 'دعم بريد إلكتروني'], current: false },
  { name: 'المهني', price: '899$', period: '/شهر', features: ['حتى 5,000 متعلّم', '3 فروع', 'حزمة ذكاء كاملة', 'دعم ذو أولوية', 'لوحة تحليلات'], current: true },
  { name: 'الأعمال', price: '2,499$', period: '/شهر', features: ['حتى 25,000 متعلّم', 'فروع غير محدودة', 'جاهز للعلامة البيضاء', 'مدير حساب مخصّص', 'وصول API'], current: false },
  { name: 'المؤسسي', price: 'حسب الطلب', period: '', features: ['متعلّمون غير محدودين', 'متعدّد المناطق', 'خيار على الموقع', 'SLA 99.99%', 'نماذج ذكاء مخصّصة'], current: false },
];

export function Settings() {
  const { institutionId, role } = useAuthSafe();
  const canManage = role === 'super_admin' || role === 'school_admin';
  const [tab, setTab] = useState<Tab>('المؤسسة');
  const [theme, setTheme] = useState({ primary: '#1a55f5', name: 'جامعة الملك سعود', domain: 'ksu.examify.ai' });
  const [orgForm, setOrgForm] = useState({ name: 'جامعة الملك سعود', country: 'السعودية', domain: 'ksu.examify.ai', timezone: 'آسيا/الرياض (GMT+3)', language: 'العربية', year: 'سبتمبر – يونيو' });
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [security, setSecurity] = useState({ twofa: true, encryptionAtRest: true, encryptionInTransit: true, rbac: true, deviceTracking: true, anomalyDetection: true, auditLogs: true });
  const [loadingSettings, setLoadingSettings] = useState(true);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [branches, setBranches] = useState<BranchRecord[]>([]);
  const [branchForm, setBranchForm] = useState({ name: '', address: '', phone: '' });
  const [editingBranch, setEditingBranch] = useState<string | null>(null);
  const [logoPath, setLogoPath] = useState<string | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [uploadingLogo, setUploadingLogo] = useState(false);

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
      setOrgForm({ name: row?.name ?? 'مؤسستي', country: row?.country ?? 'السعودية', domain: saved.domain ?? '', timezone: saved.timezone ?? 'آسيا/الرياض (GMT+3)', language: saved.language ?? 'العربية', year: saved.academicYear ?? 'سبتمبر – يونيو' });
      setTheme({ primary: saved.primaryColor ?? '#1a55f5', name: saved.brandName ?? row?.name ?? 'مؤسستي', domain: saved.domain ?? row?.website ?? '' });
      if (saved.security) setSecurity((currentSecurity) => ({ ...currentSecurity, ...saved.security }));
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

  async function saveSecuritySettings() {
    if (!institutionId) return;
    setSaving(true);
    setSettingsError(null);
    const { data: current, error: readError } = await supabase.from('institutions').select('settings').eq('id', institutionId).maybeSingle();
    if (readError) { setSettingsError(getArabicErrorMessage(readError)); setSaving(false); return; }
    const currentSettings = ((current as { settings?: InstitutionSettings & { security?: typeof security } } | null)?.settings ?? {});
    const { error } = await supabase.from('institutions').update({ settings: { ...currentSettings, security } }).eq('id', institutionId);
    setSaving(false);
    if (error) { setSettingsError(getArabicErrorMessage(error)); return; }
    setToast('تم حفظ إعدادات الأمان');
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
    setBranchForm({ name: '', address: '', phone: '' }); setEditingBranch(null); await refreshBranches();
  }

  async function toggleBranch(branch: BranchRecord) {
    const { error } = await supabase.from('branches').update({ is_active: !branch.is_active }).eq('id', branch.id).eq('institution_id', institutionId);
    if (error) setSettingsError(getArabicErrorMessage(error)); else await refreshBranches();
  }

  async function deleteBranch(branch: BranchRecord) {
    if (!confirm(`هل تريد حذف فرع ${branch.name}؟`)) return;
    const { error } = await supabase.from('branches').delete().eq('id', branch.id).eq('institution_id', institutionId);
    if (error) setSettingsError(getArabicErrorMessage(error)); else await refreshBranches();
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
    setLogoPath(path); setLogoPreview(signed?.signedUrl ?? URL.createObjectURL(file)); setUploadingLogo(false);
    setToast('تم رفع الشعار وحفظه'); setTimeout(() => setToast(null), 2500);
  }

  const saveOrg = async () => {
    if (!institutionId) { setSettingsError('لا توجد مؤسسة مرتبطة بهذا الحساب.'); return; }
    setSaving(true);
    setSettingsError(null);
    const { data: current, error: readError } = await supabase.from('institutions').select('settings').eq('id', institutionId).maybeSingle();
    if (readError) { setSettingsError(getArabicErrorMessage(readError)); setSaving(false); return; }
    const currentSettings = ((current as { settings?: InstitutionSettings } | null)?.settings ?? {});
    const { error } = await supabase.from('institutions').update({ name: orgForm.name.trim(), country: orgForm.country, settings: { ...currentSettings, domain: orgForm.domain.trim(), timezone: orgForm.timezone, language: orgForm.language, academicYear: orgForm.year } }).eq('id', institutionId);
    setSaving(false);
    if (error) { setSettingsError(getArabicErrorMessage(error)); return; }
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
    setToast('تم حفظ إعدادات العلامة التجارية');
    setTimeout(() => setToast(null), 2500);
  };

  const toggleSecurity = (key: keyof typeof security) => {
    setSecurity((prev) => ({ ...prev, [key]: !prev[key] }));
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
        {TABS.map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`px-4 py-2 rounded-lg text-sm font-600 whitespace-nowrap transition ${tab === t ? 'bg-brand-600 text-white shadow-soft' : 'text-ink-600 hover:bg-ink-100'}`}>{t === 'users' ? 'المستخدمون' : t}</button>
        ))}
      </div>

      {tab === 'users' && <UserManagement />}

      {tab === 'المؤسسة' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <Card className="lg:col-span-2 p-6">
            <SectionHeader title="ملف المؤسسة" subtitle="إعدادات المؤسسة الأساسية" action={<Building2 size={18} className="text-ink-400" />} />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div><label className="label">اسم المؤسسة</label><input className="input" value={orgForm.name} onChange={(e) => setOrgForm({ ...orgForm, name: e.target.value })} /></div>
              <div><label className="label">الدولة</label><select className="input" value={orgForm.country} onChange={(e) => setOrgForm({ ...orgForm, country: e.target.value })}><option>السعودية</option><option>مصر</option><option>ألمانيا</option><option>كندا</option></select></div>
              <div><label className="label">النطاق الأساسي</label><input className="input nums-latin" value={orgForm.domain} onChange={(e) => setOrgForm({ ...orgForm, domain: e.target.value })} /></div>
              <div><label className="label">المنطقة الزمنية</label><select className="input" value={orgForm.timezone} onChange={(e) => setOrgForm({ ...orgForm, timezone: e.target.value })}><option>آسيا/الرياض (GMT+3)</option><option>أوروبا/برلين</option><option>أمريكا/مكسيكو</option></select></div>
              <div><label className="label">اللغة الافتراضية</label><select className="input" value={orgForm.language} onChange={(e) => setOrgForm({ ...orgForm, language: e.target.value })}><option>العربية</option><option>English</option><option>Español</option><option>Deutsch</option></select></div>
              <div><label className="label">صيغة العام الدراسي</label><select className="input" value={orgForm.year} onChange={(e) => setOrgForm({ ...orgForm, year: e.target.value })}><option>سبتمبر – يونيو</option><option>يناير – ديسمبر</option></select></div>
            </div>
            <div className="flex gap-2 mt-5"><button onClick={saveOrg} disabled={saving} className="btn-primary disabled:opacity-60">{saving ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />} حفظ التغييرات</button><button onClick={() => setOrgForm({ name: 'جامعة الملك سعود', country: 'السعودية', domain: 'ksu.examify.ai', timezone: 'آسيا/الرياض (GMT+3)', language: 'العربية', year: 'سبتمبر – يونيو' })} className="btn-outline">إلغاء</button></div>
          </Card>
          <Card className="p-6">
            <SectionHeader title="الفروع" subtitle={`${branches.filter((branch) => branch.is_active).length} نشط`} />
            <div className="space-y-2.5">
              {branches.map((b) => (
                <div key={b.id} className="flex items-center gap-3 p-2.5 rounded-xl border border-ink-100">
                  <Globe size={16} className="text-ink-400 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-600 text-ink-800 truncate">{b.name}</p>
                    <p className="text-[11px] text-ink-400 nums-latin">{b.address || 'بدون عنوان'}{b.phone ? ` · ${b.phone}` : ''}</p>
                  </div>
                  <Badge tone={b.is_active ? 'accent' : 'warning'}>{b.is_active ? 'نشط' : 'متوقف'}</Badge>
                  {canManage && <div className="flex gap-1"><button type="button" onClick={() => { setEditingBranch(b.id); setBranchForm({ name: b.name, address: b.address ?? '', phone: b.phone ?? '' }); }} className="p-1.5 text-ink-400 hover:text-brand-600" title="تعديل"><Pencil size={14} /></button><button type="button" onClick={() => void toggleBranch(b)} className="text-xs text-ink-500 hover:text-brand-600">{b.is_active ? 'تعطيل' : 'تفعيل'}</button><button type="button" onClick={() => void deleteBranch(b)} className="p-1.5 text-ink-400 hover:text-danger-600" title="حذف"><Trash2 size={14} /></button></div>}
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
              {[
                { key: 'twofa' as const, label: 'المصادقة الثنائية', desc: 'مطلوبة لجميع حسابات المدراء' },
                { key: 'encryptionAtRest' as const, label: 'التشفير أثناء التخزين', desc: 'AES-256 عبر جميع القواعد' },
                { key: 'encryptionInTransit' as const, label: 'التشفير أثناء النقل', desc: 'TLS 1.3 مفعّل' },
                { key: 'rbac' as const, label: 'التحكم بالوصول حسب الدور', desc: 'صلاحيات دقيقة لكل خدمة' },
                { key: 'deviceTracking' as const, label: 'تتبّع الأجهزة', desc: 'مراقبة وتقييد جلسات الأجهزة' },
                { key: 'anomalyDetection' as const, label: 'كشف النشاط المشبوه', desc: 'تنبيهات شذوذ بالذكاء الاصطناعي' },
                { key: 'auditLogs' as const, label: 'سجلات التدقيق', desc: 'غير قابلة للتغيير، احتفاظ 7 سنوات' },
              ].map((s) => (
                <div key={s.key} className="flex items-center justify-between p-3 rounded-xl border border-ink-100">
                  <div><p className="text-sm font-600 text-ink-800">{s.label}</p><p className="text-xs text-ink-500">{s.desc}</p></div>
                  <button onClick={() => toggleSecurity(s.key)} className="relative inline-flex items-center cursor-pointer">
                    <span className={`w-11 h-6 rounded-full transition relative after:content-[''] after:absolute after:top-0.5 after:right-0.5 after:bg-white after:rounded-full after:h-5 after:w-5 after:transition ${security[s.key] ? 'bg-accent-600 after:-translate-x-5' : 'bg-ink-200'}`} />
                  </button>
                </div>
              ))}
              <button type="button" onClick={() => void saveSecuritySettings()} disabled={saving} className="btn-primary w-full mt-3 disabled:opacity-60">{saving ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />} حفظ إعدادات الأمان</button>
            </div>
          </Card>
          <Card className="p-6">
            <SectionHeader title="شهادات الامتثال" />
            <div className="grid grid-cols-2 gap-3">
              {['SOC 2 Type II', 'GDPR', 'ISO 27001', 'FERPA', 'HIPAA', 'CCPA'].map((c) => (
                <div key={c} className="p-4 rounded-xl bg-accent-50 border border-accent-100 flex items-center gap-2">
                  <Check size={18} className="text-accent-600" />
                  <div><p className="text-sm font-700 text-ink-900 nums-latin">{c}</p><p className="text-[11px] text-ink-500">معتمد</p></div>
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
          </Card>
        </div>
      )}

      {tab === 'كتالوج الأحداث' && (
        <Card className="overflow-hidden">
          <div className="p-5 border-b border-ink-100"><SectionHeader title="بنية مدفوعة بالأحداث" subtitle="Apache Kafka · 11 حدث مجالي" action={<Webhook size={18} className="text-brand-600" />} /></div>
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
              { label: 'السحابة', value: 'متعدّد السحابات', icon: Cloud, items: 'Azure · AWS · GCP' },
              { label: 'التنسيق', value: 'Kubernetes', icon: GitBranch, items: '14 خدمة' },
              { label: 'القواعد', value: 'PostgreSQL', icon: Database, items: '+ Redis · ES · MinIO' },
              { label: 'المراقبة', value: 'Prometheus', icon: Server, items: '+ Grafana · ELK' },
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
            <SectionHeader title="صحّة الخدمات المصغّرة" subtitle="14 خدمة · 99.97% متوسط التشغيل" action={<Server size={18} className="text-ink-400" />} />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {MICROSERVICES.map((svc) => (
                <div key={svc.name} className="flex items-center gap-3 p-3 rounded-xl border border-ink-100">
                  <span className={`w-2 h-2 rounded-full shrink-0 ${svc.status === 'سليم' ? 'bg-accent-500' : 'bg-warning-500 animate-pulse-soft'}`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-600 text-ink-800 truncate">{svc.name}</p>
                    <p className="text-[11px] text-ink-400 nums-latin">{svc.db} · {svc.rps.toLocaleString()} طلب/ث</p>
                  </div>
                  <span className="text-sm font-700 text-ink-900 tabular-nums nums-latin">{svc.uptime}%</span>
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}

      {tab === 'الفوترة' && (
        <div className="space-y-6">
          <Card className="p-6">
            <SectionHeader title="الباقة الحالية" action={<CreditCard size={18} className="text-brand-600" />} />
            <div className="flex items-center justify-between p-4 rounded-xl bg-brand-50 border border-brand-100">
              <div>
                <div className="flex items-center gap-2"><p className="font-display text-lg font-700 text-ink-900">الباقة المهنية</p><Badge tone="brand">نشطة</Badge></div>
                <p className="text-sm text-ink-500 mt-0.5 nums-latin">899$/شهر · تتجدّد 28 يوليو 2026</p>
              </div>
              <div className="text-left">
                <p className="text-xs text-ink-500">أرصدة الذكاء المتبقّية</p>
                <p className="font-display text-xl font-800 text-ink-900 nums-latin">842,300</p>
              </div>
            </div>
            <div className="mt-4">
              <div className="flex justify-between text-xs mb-1.5"><span className="text-ink-500 font-600">استخدام أرصدة الذكاء هذا الشهر</span><span className="font-700 text-ink-900 nums-latin">68%</span></div>
              <ProgressBar value={68} tone="brand" />
            </div>
          </Card>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {PLANS.map((p) => (
              <Card key={p.name} className={`p-5 ${p.current ? 'border-2 border-brand-500' : ''}`}>
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
                <button onClick={() => window.alert(p.current ? `إدارة باقة ${p.name}` : `طلب ترقية إلى باقة ${p.name}`)} className={`w-full ${p.current ? 'btn-outline' : 'btn-primary'}`}>{p.current ? 'إدارة' : 'ترقية'}</button>
              </Card>
            ))}
          </div>
          <Card className="p-6">
            <SectionHeader title="مصادر الإيرادات" subtitle="نموذج أعمال متنوّع" action={<Zap size={18} className="text-gold-600" />} />
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
              {[
                { label: 'الاشتراكات', value: '3.2M$' },
                { label: 'أرصدة الذكاء', value: '840k$' },
                { label: 'السوق', value: '420k$' },
                { label: 'العلامة البيضاء', value: '210k$' },
                { label: 'الشهادات', value: '95k$' },
                { label: 'إيرادات API', value: '58k$' },
              ].map((r) => (
                <div key={r.label} className="p-3 rounded-xl bg-ink-50">
                  <p className="text-[11px] text-ink-500">{r.label}</p>
                  <p className="font-display font-700 text-ink-900 nums-latin">{r.value}</p>
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
