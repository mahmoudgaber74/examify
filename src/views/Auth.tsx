import { useState, useEffect } from 'react';
import { GraduationCap, Loader2, AlertCircle, LogIn, UserPlus, Building2, ShieldCheck } from 'lucide-react';
import { signIn, signUp, getInstitutions, requestPasswordReset, updatePassword, type UserRole } from '../lib/auth';
import { useAuth } from '../components/AuthProvider';
import { Select } from '../components/ui/Select';
import { trackMarketingEvent } from '../lib/marketing-analytics';

interface InstitutionOption {
  id: string;
  name: string;
}

interface AuthProps {
  initialMode?: 'login' | 'signup';
  initialSignupType?: 'institution' | 'existing';
  onBackToLanding?: () => void;
}

const ROLE_LABELS: { value: UserRole; label: string; selfRegister: boolean }[] = [
  { value: 'school_admin', label: 'مدير المدرسة', selfRegister: true },
  { value: 'teacher', label: 'معلم', selfRegister: true },
  { value: 'student', label: 'طالب', selfRegister: true },
  { value: 'parent', label: 'ولي أمر', selfRegister: true },
];

export function Auth({ initialMode = 'login', initialSignupType = 'institution', onBackToLanding }: AuthProps) {
  const { isPasswordRecovery, signOut } = useAuth();
  const [mode, setMode] = useState<'login' | 'signup' | 'reset-request' | 'reset-password'>(initialMode);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirmation, setPasswordConfirmation] = useState('');
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState<UserRole>('student');
  const [signupType, setSignupType] = useState<'institution' | 'existing'>(initialSignupType);
  const [institutionName, setInstitutionName] = useState('');
  const [institutionId, setInstitutionId] = useState('');
  const [institutions, setInstitutions] = useState<InstitutionOption[]>([]);
  const [institutionsLoaded, setInstitutionsLoaded] = useState(false);
  const [institutionsLoadError, setInstitutionsLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  useEffect(() => {
    if (isPasswordRecovery) setMode('reset-password');
  }, [isPasswordRecovery]);

  useEffect(() => {
    if (mode === 'signup') trackMarketingEvent('signup_start', { step: 'signup_form', signup_type: signupType });
  }, [mode, signupType]);

  useEffect(() => {
    if (mode !== 'signup') return;
    if (signupType === 'institution') {
      setInstitutionsLoaded(true);
      setInstitutionsLoadError(null);
      return;
    }
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
    return () => { cancelled = true; };
  }, [mode, signupType]);

  const needsInstitution = signupType === 'existing';
  const availableRoles = signupType === 'institution'
    ? ROLE_LABELS.filter((r) => r.value === 'school_admin')
    : ROLE_LABELS;

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
        if (err) setError(err.message.includes('redirect') ? 'رابط إعادة التعيين غير مضبوط. حاول مرة أخرى لاحقًا.' : err.message);
        else setInfo('تم إرسال رابط إعادة تعيين كلمة المرور إلى بريدك الإلكتروني.');
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
      trackMarketingEvent('signup_submit', { step: 'signup_form', role, signup_type: signupType });
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
      if (signupType === 'institution' && institutionName.trim().length < 2) {
        setError('اكتب اسم المؤسسة بشكل صحيح');
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
          trackMarketingEvent('login_error', { method: 'email', reason: err.message.slice(0, 120) });
          setError(err.message === 'Invalid login credentials' ? 'البريد الإلكتروني أو كلمة المرور غير صحيحة. تأكد من استخدام نفس قاعدة البيانات المحلية التي سجلت عليها.' : err.message.includes('Email not confirmed') ? 'يجب تأكيد البريد الإلكتروني قبل تسجيل الدخول.' : err.message);
        } else {
          trackMarketingEvent('login', { method: 'email' });
        }
      } else {
        const { error: err } = await signUp({
          email,
          password,
          role,
          fullName,
          phone,
          institutionId: institutionId || undefined,
          institutionName: signupType === 'institution' ? institutionName.trim() : undefined,
        });
        if (err) {
          trackMarketingEvent('signup_error', { method: 'email', reason: err.message.slice(0, 120) });
          const friendlyError = err.message === 'institution_name_invalid'
            ? 'اسم المؤسسة يجب أن يكون بين حرفين و160 حرفًا.'
            : err.message === 'school_admin_requires_institution'
              ? 'اختر إنشاء مؤسسة جديدة أو اختر مؤسسة موجودة للانضمام إليها.'
              : err.message;
          setError(friendlyError);
        } else {
          trackMarketingEvent('sign_up', { method: 'email', role, signup_type: signupType });
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

        {onBackToLanding && (
          <button type="button" onClick={onBackToLanding} className="mb-4 w-full text-center text-sm text-brand-600 hover:text-brand-700">
            العودة إلى الصفحة الرئيسية
          </button>
        )}

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
                  <label className="label">طريقة إنشاء الحساب</label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setSignupType('institution');
                        setRole('school_admin');
                        setInstitutionId('');
                        trackMarketingEvent('signup_step', { step: 'signup_type_selected', signup_type: 'institution' });
                      }}
                      className={`flex items-center justify-center gap-2 rounded-xl border px-3 py-3 text-sm font-600 transition-colors ${signupType === 'institution' ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-ink-200 text-ink-500 hover:border-brand-300'}`}
                    >
                      <Building2 size={17} /> إنشاء مؤسسة
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setSignupType('existing');
                        setRole('teacher');
                        setInstitutionName('');
                        trackMarketingEvent('signup_step', { step: 'signup_type_selected', signup_type: 'existing' });
                      }}
                      className={`flex items-center justify-center gap-2 rounded-xl border px-3 py-3 text-sm font-600 transition-colors ${signupType === 'existing' ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-ink-200 text-ink-500 hover:border-brand-300'}`}
                    >
                      <UserPlus size={17} /> الانضمام لمؤسسة
                    </button>
                  </div>
                  <p className="text-xs text-ink-400 mt-2">
                    {signupType === 'institution' ? 'أنشئ مساحة مؤسستك وابدأ التجربة المجانية.' : 'اختر مؤسسة موجودة ليتم تفعيل حسابك من إدارتها.'}
                  </p>
                </div>

                {signupType === 'institution' && (
                  <div>
                    <label className="label">اسم المؤسسة</label>
                    <input className="input" value={institutionName} onChange={(e) => setInstitutionName(e.target.value)} required placeholder="مثال: مدرسة المستقبل" />
                  </div>
                )}

                <div>
                  <label className="label">الاسم الكامل</label>
                  <input className="input" value={fullName} onChange={(e) => setFullName(e.target.value)} required placeholder="أدخل اسمك الكامل" />
                </div>

                <div>
                  <label className="label">نوع الحساب</label>
                  <Select value={role} onValueChange={(value) => { setRole(value as UserRole); trackMarketingEvent('signup_step', { step: 'role_selected', role: value }); }} options={availableRoles.map((r) => ({ value: r.value, label: r.label }))} ariaLabel="نوع الحساب" />
                  {signupType === 'existing' && role !== 'student' && role !== 'parent' && role !== 'super_admin' && (
                    <p className="text-xs text-ink-400 mt-1.5">سيتم تفعيل حسابك من مدير المؤسسة بعد التسجيل</p>
                  )}
                </div>

                {needsInstitution && (
                  <div>
                    <label className="label">المؤسسة</label>
                    <Select value={institutionId} onValueChange={(value) => { setInstitutionId(value); trackMarketingEvent('signup_step', { step: 'institution_selected' }); }} options={institutions.map((inst) => ({ value: inst.id, label: inst.name }))} placeholder="اختر المؤسسة" ariaLabel="المؤسسة" required />
                    {/*
                      <option value="">اختر المؤسسة</option>
                    */}
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
            <button type="button" className="text-sm text-brand-600 hover:text-brand-700 mt-4 w-full" onClick={() => { if (isPasswordRecovery) void signOut(); setMode('login'); setError(null); setInfo(null); }}>
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
