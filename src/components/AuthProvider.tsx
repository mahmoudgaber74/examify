import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { type Session, type User } from '@supabase/supabase-js';
import { supabase, fetchUserProfile, type UserRole } from '../lib/auth';
import { getClientDeviceId, getClientDeviceLabel } from '../lib/session-guard';

const PASSWORD_RECOVERY_STORAGE_KEY = 'examify.password-recovery.confirmed';

function hasConfirmedPasswordRecovery() {
  try {
    return window.sessionStorage.getItem(PASSWORD_RECOVERY_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

function setConfirmedPasswordRecovery(confirmed: boolean) {
  try {
    if (confirmed) window.sessionStorage.setItem(PASSWORD_RECOVERY_STORAGE_KEY, 'true');
    else window.sessionStorage.removeItem(PASSWORD_RECOVERY_STORAGE_KEY);
  } catch {
    // Session storage may be unavailable in restricted browser contexts.
  }
}

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  role: UserRole;
  institutionId: string | null;
  fullName: string | null;
  isActive: boolean;
  isPasswordRecovery: boolean;
  loading: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  session: null,
  user: null,
  role: 'anonymous',
  institutionId: null,
  fullName: null,
  isActive: false,
  isPasswordRecovery: false,
  loading: true,
  signOut: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState<UserRole>('anonymous');
  const [institutionId, setInstitutionId] = useState<string | null>(null);
  const [fullName, setFullName] = useState<string | null>(null);
  const [isActive, setIsActive] = useState(false);
  const [isPasswordRecovery, setIsPasswordRecovery] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    const resetAuthState = () => {
      setSession(null);
      setUser(null);
      setRole('anonymous');
      setInstitutionId(null);
      setFullName(null);
      setIsActive(false);
    };

    const loadProfileAndClaimStudentSession = async (nextSession: Session | null) => {
      if (!nextSession?.user) {
        resetAuthState();
        return;
      }
      const profile = await fetchUserProfile(nextSession.user);
      if (!mounted) return;
      if (profile.role === 'student') {
        const { data, error } = await supabase.rpc('claim_student_session', {
          p_device_id: getClientDeviceId(),
          p_device_label: getClientDeviceLabel(),
        });
        if (error || !(data as { ok?: boolean } | null)?.ok) {
          // Fail closed: a student session that cannot be registered must not
          // continue to access exams as an untracked browser.
          await supabase.auth.signOut({ scope: 'local' });
          if (mounted) resetAuthState();
          return;
        }
      }
      setRole(profile.role);
      setInstitutionId(profile.institutionId);
      setFullName(profile.fullName);
      setIsActive(profile.isActive);
    };

    const { data: authListener } = supabase.auth.onAuthStateChange((event, newSession) => {
      (async () => {
        if (!mounted) return;
        setSession(newSession);
        setUser(newSession?.user ?? null);
        if (event === 'PASSWORD_RECOVERY' && newSession) {
          setConfirmedPasswordRecovery(true);
          setIsPasswordRecovery(true);
        } else if (!newSession) {
          setConfirmedPasswordRecovery(false);
          setIsPasswordRecovery(false);
        }
        await loadProfileAndClaimStudentSession(newSession);
        if (!mounted) return;
        setLoading(false);
      })();
    });

    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data.session);
      setUser(data.session?.user ?? null);
      const confirmedRecovery = Boolean(data.session && hasConfirmedPasswordRecovery());
      setIsPasswordRecovery(confirmedRecovery);
      if (!data.session) setConfirmedPasswordRecovery(false);
      loadProfileAndClaimStudentSession(data.session).then(() => {
        if (mounted) setLoading(false);
      });
    });

    return () => {
      mounted = false;
      authListener.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!session || role !== 'student') return;
    let mounted = true;
    const heartbeat = async () => {
      const { data, error } = await supabase.rpc('touch_student_session', {
        p_device_id: getClientDeviceId(),
      });
      if (mounted && (error || data !== true)) {
        await supabase.auth.signOut({ scope: 'local' });
      }
    };
    const timer = window.setInterval(() => { void heartbeat(); }, 15000);
    return () => { mounted = false; window.clearInterval(timer); };
  }, [session, role]);

  const handleSignOut = async () => {
    await supabase.auth.signOut({ scope: 'local' });
    setSession(null);
    setUser(null);
    setRole('anonymous');
    setInstitutionId(null);
    setFullName(null);
    setIsActive(false);
    setConfirmedPasswordRecovery(false);
    setIsPasswordRecovery(false);
  };

  return (
    <AuthContext.Provider value={{ session, user, role, institutionId, fullName, isActive, isPasswordRecovery, loading, signOut: handleSignOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
