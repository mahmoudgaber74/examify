import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { type Session, type User } from '@supabase/supabase-js';
import { supabase, fetchUserProfile, type UserRole } from '../lib/auth';

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  role: UserRole;
  institutionId: string | null;
  fullName: string | null;
  isActive: boolean;
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
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data.session);
      setUser(data.session?.user ?? null);
      if (data.session?.user) {
        fetchUserProfile(data.session.user).then((profile) => {
          if (!mounted) return;
          setRole(profile.role);
          setInstitutionId(profile.institutionId);
          setFullName(profile.fullName);
          setIsActive(profile.isActive);
          setLoading(false);
        });
      } else {
        setLoading(false);
      }
    });

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      (async () => {
        if (!mounted) return;
        setSession(newSession);
        setUser(newSession?.user ?? null);
        if (newSession?.user) {
          const profile = await fetchUserProfile(newSession.user);
          if (!mounted) return;
          setRole(profile.role);
          setInstitutionId(profile.institutionId);
          setFullName(profile.fullName);
          setIsActive(profile.isActive);
        } else {
          setRole('anonymous');
          setInstitutionId(null);
          setFullName(null);
          setIsActive(false);
        }
        setLoading(false);
      })();
    });

    return () => {
      mounted = false;
      authListener.subscription.unsubscribe();
    };
  }, []);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    setSession(null);
    setUser(null);
    setRole('anonymous');
    setInstitutionId(null);
    setFullName(null);
    setIsActive(false);
  };

  return (
    <AuthContext.Provider value={{ session, user, role, institutionId, fullName, isActive, loading, signOut: handleSignOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
