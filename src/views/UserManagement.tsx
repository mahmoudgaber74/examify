import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, Loader2, RefreshCw, ShieldCheck, UserCog, X } from 'lucide-react';
import { Card, SectionHeader } from '../components/ui';
import { useAuthSafe } from '../lib/auth-helpers';
import { supabase } from '../lib/auth';

interface StaffRow {
  id: string;
  user_id: string;
  full_name: string;
  role: string;
  is_active: boolean;
}

const ROLE_LABELS: Record<string, string> = {
  super_admin: 'مدير النظام',
  school_admin: 'مدير المؤسسة',
  teacher: 'معلم',
  grader: 'مصحح',
  data_entry: 'إدخال بيانات',
};

export function UserManagement() {
  const { user, role, institutionId } = useAuthSafe();
  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadStaff = useCallback(async () => {
    setLoading(true);
    setError(null);
    const query = supabase
      .from('staff_profiles')
      .select('id, user_id, full_name, role, is_active')
      .order('full_name');
    if (role !== 'super_admin' && institutionId) query.eq('institution_id', institutionId);

    const { data, error: fetchError } = await query;
    if (fetchError) setError(fetchError.message);
    else setStaff((data as StaffRow[]) ?? []);
    setLoading(false);
  }, [institutionId, role]);

  useEffect(() => {
    void loadStaff();
  }, [loadStaff]);

  const pendingCount = useMemo(() => staff.filter((member) => !member.is_active).length, [staff]);
  const activeCount = staff.length - pendingCount;
  const orderedStaff = useMemo(
    () => [...staff].sort((a, b) => Number(a.is_active) - Number(b.is_active) || a.full_name.localeCompare(b.full_name, 'ar')),
    [staff],
  );

  async function toggleStaffMember(member: StaffRow) {
    if (member.user_id === user?.id) return;
    setSavingId(member.id);
    setError(null);
    setNotice(null);

    const nextIsActive = !member.is_active;
    const { error: updateError } = await supabase
      .from('staff_profiles')
      .update({ is_active: nextIsActive })
      .eq('id', member.id);

    if (updateError) {
      setError(updateError.message);
    } else {
      setStaff((current) => current.map((item) => item.id === member.id ? { ...item, is_active: nextIsActive } : item));
      setNotice(nextIsActive ? 'تم قبول وتفعيل الحساب.' : 'تم تعطيل الحساب.');
      if (institutionId && user) {
        await supabase.from('audit_log').insert({
          institution_id: institutionId,
          actor_id: user.id,
          actor_role: role,
          action: nextIsActive ? 'staff.approved' : 'staff.disabled',
          entity_type: 'staff_profile',
          entity_id: member.id,
          details: { full_name: member.full_name, role: member.role },
        });
      }
    }
    setSavingId(null);
  }

  return (
    <Card className="p-7">
      <SectionHeader
        title="إدارة المستخدمين"
        subtitle={`إدارة حسابات فريق المؤسسة · ${activeCount} نشط${pendingCount ? ` · ${pendingCount} قيد المراجعة` : ''}`}
        action={
          <button type="button" onClick={() => void loadStaff()} className="btn-outline !min-h-10 !px-4 !py-2.5 !text-sm">
            <RefreshCw size={16} /> تحديث
          </button>
        }
      />

      {pendingCount > 0 && (
        <div className="mb-5 flex items-start gap-3 rounded-2xl border border-warning-100 bg-warning-50 px-4 py-3.5 text-warning-800">
          <ShieldCheck size={20} className="mt-0.5 shrink-0" />
          <div>
            <p className="text-base font-600">طلبات انضمام تحتاج موافقتك</p>
            <p className="mt-1 text-sm leading-6">راجع الحسابات ذات الحالة «قيد المراجعة»، ثم اضغط «قبول وتفعيل» للسماح لها باستخدام النظام.</p>
          </div>
        </div>
      )}

      {notice && <div className="mb-4 flex items-center gap-2 rounded-xl bg-accent-50 px-4 py-3 text-sm text-accent-700"><Check size={17} />{notice}</div>}
      {error && <div className="mb-4 flex items-center gap-2 rounded-xl bg-danger-50 px-4 py-3 text-sm text-danger-700"><X size={17} />{error}</div>}

      {loading ? (
        <div className="flex items-center justify-center py-14 text-brand-600"><Loader2 size={26} className="animate-spin" /></div>
      ) : staff.length === 0 ? (
        <div className="py-14 text-center text-base text-ink-500">لا توجد حسابات موظفين.</div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-ink-100">
          <table className="w-full text-base">
            <thead className="border-b border-ink-100 bg-ink-50 text-right text-sm font-600 text-ink-500">
              <tr>
                <th className="px-4 py-4">الاسم</th>
                <th className="px-4 py-4">الدور</th>
                <th className="px-4 py-4">الحالة</th>
                <th className="px-4 py-4">الإجراء</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-50">
              {orderedStaff.map((member) => (
                <tr key={member.id} className={!member.is_active ? 'bg-warning-50/30' : undefined}>
                  <td className="px-4 py-4 font-600 text-ink-800">{member.full_name}</td>
                  <td className="px-4 py-4 text-ink-600">{ROLE_LABELS[member.role] ?? member.role}</td>
                  <td className="px-4 py-4">
                    <span className={`inline-flex min-w-[108px] justify-center rounded-lg px-3 py-2 text-sm font-600 ${member.is_active ? 'bg-accent-50 text-accent-700' : 'bg-warning-50 text-warning-700'}`}>
                      {member.is_active ? 'نشط' : 'قيد المراجعة'}
                    </span>
                  </td>
                  <td className="px-4 py-4">
                    {member.user_id === user?.id ? (
                      <span className="text-sm text-ink-400">حسابك الحالي</span>
                    ) : (
                      <button type="button" onClick={() => void toggleStaffMember(member)} disabled={savingId === member.id} className="btn-outline !min-h-10 !px-4 !py-2 !text-sm disabled:opacity-60">
                        {savingId === member.id ? <Loader2 size={16} className="animate-spin" /> : member.is_active ? <X size={16} /> : <ShieldCheck size={16} />}
                        {member.is_active ? 'تعطيل' : 'قبول وتفعيل'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-6 flex items-start gap-3 rounded-2xl bg-ink-50 px-4 py-3.5 text-sm leading-6 text-ink-600">
        <UserCog size={19} className="mt-0.5 shrink-0 text-ink-400" />
        <span>إضافة المعلم أو الموظف تتم حاليًا من شاشة التسجيل باختيار «الانضمام إلى مؤسسة». بعد التسجيل يظهر الحساب هنا «قيد المراجعة»، ولا يستطيع استخدام صلاحياته إلا بعد موافقتك.</span>
      </div>
    </Card>
  );
}
