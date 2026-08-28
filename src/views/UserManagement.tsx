import { useCallback, useEffect, useState } from 'react';
import { Check, Loader2, RefreshCw, ShieldCheck, UserCog, X } from 'lucide-react';
import { Card, SectionHeader } from '../components/ui';
import { useAuthSafe } from '../lib/auth-helpers';
import { supabase } from '../lib/auth';

interface StaffRow { id: string; user_id: string; full_name: string; role: string; is_active: boolean; }
const ROLE_LABELS: Record<string, string> = { super_admin: 'مدير النظام', school_admin: 'مدير المؤسسة', teacher: 'معلم', grader: 'مصحح', data_entry: 'إدخال بيانات' };

export function UserManagement() {
  const { user, role, institutionId } = useAuthSafe();
  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadStaff = useCallback(async () => {
    setLoading(true); setError(null);
    let query = supabase.from('staff_profiles').select('id, user_id, full_name, role, is_active').order('full_name');
    if (role !== 'super_admin' && institutionId) query = query.eq('institution_id', institutionId);
    const { data, error: fetchError } = await query;
    if (fetchError) setError(fetchError.message); else setStaff((data as StaffRow[]) ?? []);
    setLoading(false);
  }, [institutionId, role]);

  useEffect(() => { void loadStaff(); }, [loadStaff]);

  async function toggleStaffMember(member: StaffRow) {
    if (member.user_id === user?.id) return;
    setSavingId(member.id); setError(null); setNotice(null);
    const { error: updateError } = await supabase.from('staff_profiles').update({ is_active: !member.is_active }).eq('id', member.id);
    if (updateError) setError(updateError.message);
    else { setStaff((current) => current.map((item) => item.id === member.id ? { ...item, is_active: !item.is_active } : item)); setNotice(member.is_active ? 'تم تعطيل الحساب.' : 'تم تفعيل الحساب.'); }
    setSavingId(null);
  }

  return (
    <Card className="p-6">
      <SectionHeader title="إدارة المستخدمين" subtitle="تفعيل أو تعطيل حسابات فريق المؤسسة" action={<button type="button" onClick={() => void loadStaff()} className="btn-outline !py-2"><RefreshCw size={15} /> تحديث</button>} />
      {notice && <div className="mb-4 flex items-center gap-2 rounded-xl bg-accent-50 px-3 py-2 text-sm text-accent-700"><Check size={16} />{notice}</div>}
      {error && <div className="mb-4 flex items-center gap-2 rounded-xl bg-danger-50 px-3 py-2 text-sm text-danger-700"><X size={16} />{error}</div>}
      {loading ? <div className="flex items-center justify-center py-12 text-brand-600"><Loader2 size={24} className="animate-spin" /></div> : staff.length === 0 ? <div className="py-12 text-center text-sm text-ink-500">لا توجد حسابات موظفين.</div> : (
        <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="border-b border-ink-100 text-right text-xs text-ink-500"><tr><th className="px-3 py-3">الاسم</th><th className="px-3 py-3">الدور</th><th className="px-3 py-3">الحالة</th><th className="px-3 py-3">الإجراء</th></tr></thead><tbody className="divide-y divide-ink-50">
          {staff.map((member) => <tr key={member.id}><td className="px-3 py-3 font-600 text-ink-800">{member.full_name}</td><td className="px-3 py-3 text-ink-600">{ROLE_LABELS[member.role] ?? member.role}</td><td className="px-3 py-3"><span className={`chip ${member.is_active ? 'bg-accent-50 text-accent-700' : 'bg-warning-50 text-warning-700'}`}>{member.is_active ? 'نشط' : 'قيد المراجعة'}</span></td><td className="px-3 py-3">{member.user_id === user?.id ? <span className="text-xs text-ink-400">حسابك الحالي</span> : <button type="button" onClick={() => void toggleStaffMember(member)} disabled={savingId === member.id} className="btn-outline !py-1.5 !text-xs disabled:opacity-60">{savingId === member.id ? <Loader2 size={14} className="animate-spin" /> : member.is_active ? <X size={14} /> : <ShieldCheck size={14} />}{member.is_active ? 'تعطيل' : 'تفعيل'}</button>}</td></tr>)}
        </tbody></table></div>
      )}
      <div className="mt-5 flex items-start gap-2 rounded-xl bg-ink-50 p-3 text-xs text-ink-500"><UserCog size={16} className="shrink-0 text-ink-400" />لا يمكن للمدير تعطيل حسابه الحالي، وتظل صلاحيات قاعدة البيانات هي الحماية الأساسية.</div>
    </Card>
  );
}
