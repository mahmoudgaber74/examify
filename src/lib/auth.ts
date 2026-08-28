import { createClient, type Session, type User } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

export type UserRole = 'super_admin' | 'school_admin' | 'teacher' | 'grader' | 'data_entry' | 'student' | 'parent' | 'anonymous';

export interface AuthProfile {
  user: User | null;
  role: UserRole;
  institutionId: string | null;
  fullName: string | null;
  isActive: boolean;
  loading: boolean;
}

export interface StaffProfileRow {
  id: string;
  user_id: string;
  institution_id: string;
  full_name: string;
  role: string;
  is_active: boolean;
  avatar_url: string | null;
}

export interface StudentProfileRow {
  id: string;
  user_id: string;
  institution_id: string;
  full_name: string;
  student_code: string | null;
  is_active: boolean;
  avatar_url: string | null;
}

export interface ParentProfileRow {
  id: string;
  user_id: string;
  institution_id: string;
  full_name: string;
  is_active: boolean;
  avatar_url: string | null;
}

export async function fetchUserProfile(user: User | null): Promise<{ role: UserRole; institutionId: string | null; fullName: string | null; isActive: boolean }> {
  if (!user) return { role: 'anonymous', institutionId: null, fullName: null, isActive: false };

  const { data: staff } = await supabase
    .from('staff_profiles')
    .select('id, institution_id, full_name, role, is_active')
    .eq('user_id', user.id)
    .maybeSingle() as { data: StaffProfileRow | null };

  if (staff) {
    return {
      role: staff.role as UserRole,
      institutionId: staff.institution_id,
      fullName: staff.full_name,
      isActive: staff.is_active,
    };
  }

  const { data: student } = await supabase
    .from('student_profiles')
    .select('id, institution_id, full_name, is_active')
    .eq('user_id', user.id)
    .maybeSingle() as { data: StudentProfileRow | null };

  if (student) {
    return {
      role: 'student',
      institutionId: student.institution_id,
      fullName: student.full_name,
      isActive: student.is_active,
    };
  }

  const { data: parent } = await supabase
    .from('parent_profiles')
    .select('id, institution_id, full_name, is_active')
    .eq('user_id', user.id)
    .maybeSingle() as { data: ParentProfileRow | null };

  if (parent) {
    return {
      role: 'parent',
      institutionId: parent.institution_id,
      fullName: parent.full_name,
      isActive: parent.is_active,
    };
  }

  return { role: 'anonymous', institutionId: null, fullName: null, isActive: false };
}

export async function signIn(email: string, password: string) {
  return supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
}

export async function requestPasswordReset(email: string) {
  return supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
    redirectTo: window.location.origin,
  });
}

export async function updatePassword(password: string) {
  return supabase.auth.updateUser({ password });
}

export async function signUp(params: {
  email: string;
  password: string;
  role: UserRole;
  fullName: string;
  phone?: string;
  institutionId?: string;
  institutionName?: string;
}) {
  return supabase.auth.signUp({
    email: params.email.trim().toLowerCase(),
    password: params.password,
    options: {
      data: {
        role: params.role,
        full_name: params.fullName,
        phone: params.phone,
        institution_id: params.institutionId,
        institution_name: params.institutionName,
      },
    },
  });
}

export async function signOut() {
  return supabase.auth.signOut();
}

export async function getSession(): Promise<Session | null> {
  const { data } = await supabase.auth.getSession();
  return data.session;
}

export async function getInstitutions() {
  return supabase.from('institutions').select('id, name').order('name');
}

export async function canBootstrapFirstAdmin() {
  return supabase.rpc('can_bootstrap_first_admin');
}

export async function bootstrapFirstAdmin() {
  return supabase.rpc('bootstrap_first_admin');
}
