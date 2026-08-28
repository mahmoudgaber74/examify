import { useAuth } from '../components/AuthProvider';
import type { UserRole } from './auth';

export function useAuthSafe() {
  const ctx = useAuth();
  return {
    user: ctx.user,
    role: ctx.role as UserRole,
    institutionId: ctx.institutionId,
    fullName: ctx.fullName,
    isActive: ctx.isActive,
    loading: ctx.loading,
    signOut: ctx.signOut,
  };
}

export { supabase } from './auth';
