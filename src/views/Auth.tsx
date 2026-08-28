import { useState, useEffect } from 'react';
import { GraduationCap, Loader2, AlertCircle, LogIn, UserPlus, Building2, ShieldCheck } from 'lucide-react';
import { signIn, signUp, getInstitutions, canBootstrapFirstAdmin, requestPasswordReset, updatePassword, signOut, type UserRole } from '../lib/auth';

interface InstitutionOption {
  id: string;
  name: string;
}

const ROLE_LABELS: { value: UserRole; label: string; selfRegister: boolean }[] = [
  { value: 'super_admin', label: 'مدير النظام', selfRegister: true },
  { value: 'school_admin', label: 'مدير المدرسة', selfRegister: true },
  { value: 'teacher', label: 'معلم', selfRegister: true },
  { value: 'student', label: 'طالب', selfRegister: true },
  { value: 'parent', label: 'ولي أمر', selfRegister: true },
];

export function Auth() {
  const [mode, setMode] = useState<'login' | 'signup' | 'reset-request' | 'reset-password'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirmation, setPasswordConfirmation] = useState('');
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState<UserRole>('student');
  const [institutionId, setInstitutionId] = useState('');
  const [institutionName, setInstitutionName] = useState('');
  const [institutions, setInstitutions] = useState<InstitutionOption[]>([]);
  const [institutionsLoaded, setInstitutionsLoaded] = useState(false);
  const [institutionsLoadError, setInstitutionsLoadError] = useState<string | null>(null);
  const [firstAdminAvailable, setFirstAdminAvailable] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  useEffect(() => {
    if (window.location.hash.includes('type=recovery')) setMode('reset-password');
  }, []);

  useEffect(() => {
    if (mode !== 'signup') return;
    let cancelled = false;
    setInstitutionsLoaded(false);
    setInstitutionsLoadError(null);
    getInstitutions().then(({ data, error: loadError }) => {
      if (!cancelled && data) setInstitutions(data as InstitutionOption[]);
      if (!cancelled && loadError) setInstitutionsLoadError('تعذر تحميل المؤسسات. تأكد من تشغيل خدمات قاعدة البيانات ثم حاول مرة أخرى.');
    }).catch(() => {
      if (!cancelled) setInstitutionsLoadError('تعذر تحميل المؤسسات. تأكد من تشغيل خدمات قاعدة البيانات ثم حاول مرة أخرى.');
    }).finally(() => {
      if (!cancelled) setInstitutionsLoaded(true);
    });
    canBootstrapFirstAdmin().then(({ data, error: loadError }) => {
      if (!cancelled && !loadError) setFirstAdminAvailable(data === true);
    });
    return () => { cancelled = true; };
  }, [mode]);

  const needsInstitution = role !== 'super_admin';
  const isFirstUser = institutionsLoaded && firstAdminAvailable;
  const availableRoles = ROLE_LABELS.filter((r) => (
    institutionsLoaded
      ? (isFirstUser ? r.value === 'super_admin' : r.value !== 'super_admin')
      : r.value !== 'super_admin'
  ));

  useEffect(() => {
    if (!institutionsLoaded) return;
    if (!availableRoles.some((r) => r.value === role)) {
      setRole(availableRoles[0]?.value ?? 'student');
    }
  }, [availableRoles, institutionsLoaded, role]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);

    if (mode === 'reset-request') {
      setLoading(true);
      try {
        const { error: err } = await requestPasswordReset(email);
        if (err) setError(err.message.includes('redirect') ? 'رابط إعادة التعيين غير مضبوط. أعد تشغيل خدمات Supabase المحلية ثم حاول مرة أخرى.' : err.message);
        else setInfo('تم إرسال رابط إعادة تعيين كلمة المرور. في الوضع المحلي افتح صندوق البريد التجريبي على http://127.0.0.1:54324 لرؤية الرسالة.');
      } finally {
        setLoading(false);
      }
      return;
    }

    if (mode === 'reset-password') {
      if (password.length < 6) {
        setError('كلمة المرور يجب أن تكون 6 أحرف على الأقل');
        return;
      }
      if (password !== passwordConfirmation) {
        setError('كلمتا المرور غير متطابقتين');
        return;
      }
      setLoading(true);
      try {
        const { error: err } = await updatePassword(password);
        if (err) setError(err.message);
        else {
          await signOut();
          setInfo('تم تغيير كلمة المرور بنجاح. يمكنك تسجيل الدخول الآن.');
          setPassword('');
          setPasswordConfirmation('');
          setMode('login');
          window.history.replaceState({}, document.title, window.location.pathname);
        }
      } finally {
        setLoading(false);
      }
      return;
    }

    if (mode === 'signup') {
      if (!institutionsLoaded) {
        setError('جارٍ تحميل المؤسسات. حاول مرة أخرى بعد لحظات.');
        return;
      }
      if (institutionsLoadError) {
        setError(institutionsLoadError);
        return;
      }
      if (password.length < 6) {
        setError('كلمة المرور يجب أن تكون 6 أحرف على الأقل');
        return;
      }
      if (isFirstUser && role !== 'super_admin') {
        setError('يجب أن يكون الحساب الأول مدير النظام.');
        return;
      }
      if (!isFirstUser && role === 'super_admin') {
        setError('التسجيل الذاتي لمدير النظام متاح فقط أثناء الإعداد الأول.');
        return;
      }
      if (role === 'super_admin' && isFirstUser && !institutionName.trim()) {
        setError('أدخل اسم المؤسسة الرئيسية.');
        return;
      }
      if (needsInstitution && !institutionId) {
        setError('يجب اختيار المؤسسة');
        return;
      }
    }

    setLoading(true);

    try {
      if (mode === 'login') {
        const { error: err } = await signIn(email, password);
        if (err) {
          setError(err.message === 'Invalid login credentials' ? 'البريد الإلكتروني أو كلمة المرور غير صحيحة. تأكد من استخدام نفس قاعدة البيانات المحلية التي سجلت عليها.' : err.message.includes('Email not confirmed') ? 'يجب تأكيد البريد الإلكتروني قبل تسجيل الدخول.' : err.message);
        }
      } else {
        const { error: err } = await signUp({
          email,
          password,
          role,
          fullName,
          phone,
          institutionId: institutionId || undefined,
          institutionName: isFirstUser ? institutionName : undefined,
        });
        if (err) {
          setError(err.message);
        } else {
          setInfo('تم إنشاء الحساب بنجاح. تحقق من بريدك الإلكتروني لتأكيد الحساب ثم سجّل الدخول.');
          setMode('login');
        }
      }
    } catch {
      setError('حدث خطأ غير متوقع. حاول مرة أخرى.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-ink-50 via-brand-50/30 to-ink-50 grid-bg">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <div className="w-16 h-16 rounded-2xl bg-brand-600 text-white flex items-center justify-center shadow-soft mb-3">
            <GraduationCap size={36} />
          </div>
          <h1 className="font-display text-2xl font-800 text-ink-900">إكزاميفاي AI</h1>
          <p className="text-sm text-ink-500 mt-1">منصة التصحيح الإلكتروني وإدارة الامتحانات</p>
        </div>

        <div className="card p-6 sm:p-8">
          {/* Tabs */}
          {(mode === 'login' || mode === 'signup') && <div className="flex gap-1 p-1 rounded-xl bg-ink-100 mb-6">
            <button
              type="button"
              onClick={() => { setMode('login'); setError(null); setInfo(null); }}
              className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-600 transition-all ${mode === 'login' ? 'bg-white text-ink-900 shadow-sm' : 'text-ink-500 hover:text-ink-700'}`}
            >
              <LogIn size={16} /> تسجيل الدخول
            </button>
            <button
              type="button"
              onClick={() => { setMode('signup'); setError(null); setInfo(null); }}
              className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-600 transition-all ${mode === 'signup' ? 'bg-white text-ink-900 shadow-sm' : 'text-ink-500 hover:text-ink-700'}`}
            >
              <UserPlus size={16} /> حساب جديد
            </button>
          </div>}

          {info && (
            <div className="flex items-start gap-2 p-3 rounded-xl bg-accent-50 border border-accent-200 mb-4">
              <ShieldCheck size={18} className="text-accent-600 shrink-0 mt-0.5" />
              <p className="text-sm text-accent-700">{info}</p>
            </div>
          )}

          {error && (
            <div className="flex items-start gap-2 p-3 rounded-xl bg-danger-50 border border-danger-200 mb-4">
              <AlertCircle size={18} className="text-danger-600 shrink-0 mt-0.5" />
              <p className="text-sm text-danger-700">{error}</p>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === 'signup' && (
              <>
                <div>
                  <label className="label">الاسم الكامل</label>
                  <input className="input" value={fullName} onChange={(e) => setFullName(e.target.value)} required placeholder="أدخل اسمك الكامل" />
                </div>

                <div>
                  <label className="label">نوع الحساب</label>
                  <select className="input" value={role} onChange={(e) => setRole(e.target.value as UserRole)}>
                    {availableRoles.map((r) => (
                      <option key={r.value} value={r.value}>{r.label}</option>
                    ))}
                  </select>
                  {role !== 'student' && role !== 'parent' && role !== 'super_admin' && (
                    <p className="text-xs text-ink-400 mt-1.5">سيتم تفعيل حسابك من مدير المؤسسة بعد التسجيل</p>
                  )}
                </div>

                {role === 'super_admin' && isFirstUser && (
                  <div>
                    <label className="label">اسم المؤسسة الرئيسية</label>
                    <input className="input" value={institutionName} onChange={(e) => setInstitutionName(e.target.value)} placeholder="اسم مؤسستك" />
                  </div>
                )}

                {needsInstitution && !isFirstUser && (
                  <div>
                    <label className="label">المؤسسة</label>
                    <select className="input" value={institutionId} onChange={(e) => setInstitutionId(e.target.value)} required>
                      <option value="">اختر المؤسسة</option>
                      {institutions.map((inst) => (
                        <option key={inst.id} value={inst.id}>{inst.name}</option>
                      ))}
                    </select>
                  </div>
                )}

                <div>
                  <label className="label">رقم الهاتف (اختياري)</label>
                  <input className="input" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+9665xxxxxxxx" dir="ltr" />
                </div>
              </>
            )}

            {(mode === 'login' || mode === 'signup') && <>
            <div>
              <label className="label">البريد الإلكتروني</label>
              <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="you@example.com" dir="ltr" />
            </div>

            <div>
              <label className="label">كلمة المرور</label>
              <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required placeholder="••••••••" dir="ltr" />
            </div>

            <button type="submit" disabled={loading} className="btn-primary w-full py-3 disabled:opacity-60 disabled:cursor-not-allowed">
              {loading ? <Loader2 size={18} className="animate-spin" /> : mode === 'login' ? <LogIn size={18} /> : <UserPlus size={18} />}
              {mode === 'login' ? 'دخول' : 'إنشاء حساب'}
            </button></>}

            {mode === 'reset-request' && <>
              <div>
                <label className="label">البريد الإلكتروني</label>
                <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="you@example.com" dir="ltr" />
              </div>
              <button type="submit" disabled={loading} className="btn-primary w-full py-3 disabled:opacity-60">
                {loading ? <Loader2 size={18} className="animate-spin" /> : <ShieldCheck size={18} />}
                إرسال رابط إعادة التعيين
              </button>
            </>}

            {mode === 'reset-password' && <>
              <div>
                <label className="label">كلمة المرور الجديدة</label>
                <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} dir="ltr" />
              </div>
              <div>
                <label className="label">تأكيد كلمة المرور</label>
                <input className="input" type="password" value={passwordConfirmation} onChange={(e) => setPasswordConfirmation(e.target.value)} required minLength={6} dir="ltr" />
              </div>
              <button type="submit" disabled={loading} className="btn-primary w-full py-3 disabled:opacity-60">
                {loading ? <Loader2 size={18} className="animate-spin" /> : <ShieldCheck size={18} />}
                حفظ كلمة المرور الجديدة
              </button>
            </>}
          </form>

          {mode === 'login' && (
            <button type="button" className="text-sm text-brand-600 hover:text-brand-700 mt-4 w-full" onClick={() => { setMode('reset-request'); setError(null); setInfo(null); }}>
              نسيت كلمة المرور؟
            </button>
          )}
          {(mode === 'reset-request' || mode === 'reset-password') && (
            <button type="button" className="text-sm text-brand-600 hover:text-brand-700 mt-4 w-full" onClick={() => { setMode('login'); setError(null); setInfo(null); }}>
              العودة إلى تسجيل الدخول
            </button>
          )}

          {mode === 'signup' && institutionsLoaded && needsInstitution && institutions.length === 0 && (
            <div className="flex items-center gap-2 mt-4 p-3 rounded-xl bg-ink-50 border border-ink-100">
              <Building2 size={16} className="text-ink-400 shrink-0" />
              <p className="text-xs text-ink-500">لا توجد مؤسسات مسجلة بعد. سجّل كـ "مدير النظام" لإنشاء أول مؤسسة.</p>
            </div>
          )}
        </div>

        <p className="text-center text-xs text-ink-400 mt-6">إكزاميفاي AI © 2026 — جميع الحقوق محفوظة</p>
      </div>
    </div>
  );
}
