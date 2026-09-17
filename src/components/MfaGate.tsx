import { useEffect, useState, type ReactNode } from 'react';
import { AlertCircle, Loader2, LogOut, ShieldCheck } from 'lucide-react';
import { supabase } from '../lib/auth';
import { useAuth } from './AuthProvider';

export function MfaGate({ children }: { children: ReactNode }) {
  const { user, signOut } = useAuth();
  const [status, setStatus] = useState<'checking' | 'ready' | 'required' | 'error'>('checking');
  const [factorId, setFactorId] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    if (!user) {
      setStatus('ready');
      return () => { mounted = false; };
    }
    void (async () => {
      const { data, error: assuranceError } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (!mounted) return;
      if (assuranceError) {
        setError('تعذر التحقق من حالة المصادقة الثنائية. حاول تحديث الصفحة.');
        setStatus('error');
        return;
      }
      if (data.currentLevel === 'aal1' && data.nextLevel === 'aal2') {
        const { data: factors, error: factorsError } = await supabase.auth.mfa.listFactors();
        if (!mounted) return;
        const factor = factors?.totp?.[0];
        if (factorsError || !factor) {
          setError('هذا الحساب يحتاج إعداد المصادقة الثنائية من صفحة الأمان أولًا.');
          setStatus('error');
          return;
        }
        setFactorId(factor.id);
        setStatus('required');
        return;
      }
      setStatus('ready');
    })();
    return () => { mounted = false; };
  }, [user]);

  async function verifyCode() {
    if (!factorId || !/^\d{6}$/.test(code.trim())) {
      setError('اكتب رمز المصادقة المكوّن من 6 أرقام.');
      return;
    }
    setBusy(true);
    setError(null);
    const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: code.trim() });
    setBusy(false);
    if (verifyError) {
      setError('رمز المصادقة غير صحيح أو انتهت صلاحيته. حاول مرة أخرى.');
      return;
    }
    setStatus('ready');
    setCode('');
  }

  if (status === 'ready') return <>{children}</>;
  if (status === 'checking') {
    return <div className="flex h-screen items-center justify-center bg-ink-50"><Loader2 size={30} className="animate-spin text-brand-600" /></div>;
  }
  return (
    <div className="flex min-h-screen items-center justify-center bg-ink-50 p-4">
      <div className="card w-full max-w-md p-6 sm:p-8">
        <div className="mb-5 flex items-start gap-3">
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-brand-50 text-brand-600"><ShieldCheck size={23} /></div>
          <div><h1 className="text-lg font-800 text-ink-900">تحقق إضافي مطلوب</h1><p className="mt-1 text-sm leading-6 text-ink-500">اكتب الرمز الظاهر في تطبيق المصادقة للمتابعة.</p></div>
        </div>
        {error && <div className="mb-4 flex items-start gap-2 rounded-xl border border-danger-200 bg-danger-50 p-3 text-sm text-danger-700"><AlertCircle size={17} className="mt-0.5 shrink-0" /><span>{error}</span></div>}
        {status === 'required' && <>
          <label className="label" htmlFor="mfa-gate-code">رمز المصادقة</label>
          <input id="mfa-gate-code" autoFocus inputMode="numeric" maxLength={6} className="input nums-latin text-center tracking-[0.45em]" value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))} onKeyDown={(event) => { if (event.key === 'Enter') void verifyCode(); }} placeholder="000000" />
          <button type="button" onClick={() => void verifyCode()} disabled={busy} className="btn-primary mt-4 w-full disabled:opacity-60">{busy ? <Loader2 size={16} className="animate-spin" /> : <ShieldCheck size={16} />} تحقق ودخول</button>
        </>}
        <button type="button" onClick={() => void signOut()} className="btn-ghost mt-2 w-full justify-center"><LogOut size={16} /> تسجيل الخروج</button>
      </div>
    </div>
  );
}
