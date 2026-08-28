import { useState, useEffect, useCallback } from 'react';
import { Loader2, Heart, TrendingUp, Calendar, Bell, Award, Check, X } from 'lucide-react';
import { Card, SectionHeader, Badge, EmptyState, ProgressBar } from '../components/ui';
import { supabase, useAuthSafe } from '../lib/auth-helpers';

interface LinkedStudent {
  student_id: string;
  full_name: string;
  relationship: string;
}
interface StudentGrade {
  id: string;
  assessment_title: string;
  score: number;
  max_score: number;
  subjects: { name: string };
}
interface StudentAttendance {
  id: string;
  date: string;
  status: string;
  subject_id: string | null;
}
interface NotificationRow {
  id: string;
  type: string;
  title: string;
  body: string | null;
  is_read: boolean;
  created_at: string;
}

export function Parents() {
  const { user, institutionId, role } = useAuthSafe();
  const isParent = role === 'parent';
  const [linkedStudents, setLinkedStudents] = useState<LinkedStudent[]>([]);
  const [selectedStudent, setSelectedStudent] = useState<string | null>(null);
  const [grades, setGrades] = useState<StudentGrade[]>([]);
  const [attendance, setAttendance] = useState<StudentAttendance[]>([]);
  const [notifications, setNotifications] = useState<NotificationRow[]>([]);
  const [loading, setLoading] = useState(true);

  const loadLinked = useCallback(async () => {
    if (!user || !institutionId) return;
    const { data: parent } = await supabase.from('parent_profiles').select('id').eq('user_id', user.id).maybeSingle();
    if (!parent) { setLoading(false); return; }
    const parentId = (parent as { id: string }).id;
    const { data: links } = await supabase
      .from('parent_student_links')
      .select('student_id, relationship, student_profiles!inner(full_name)')
      .eq('parent_id', parentId);
    setLinkedStudents(((links as any[]) ?? []).map((l) => ({ student_id: l.student_id, full_name: l.student_profiles?.full_name ?? '', relationship: l.relationship })));
    setLoading(false);
  }, [user, institutionId]);

  const loadStudentData = useCallback(async (studentId: string) => {
    setSelectedStudent(studentId);
    const [g, a, n] = await Promise.all([
      supabase.from('grade_book').select('id, assessment_title, score, max_score, subjects!inner(name)').eq('student_id', studentId).order('recorded_at', { ascending: false }).limit(20),
      supabase.from('attendance').select('id, date, status, subject_id').eq('student_id', studentId).order('date', { ascending: false }).limit(20),
      supabase.from('parent_notifications').select('id, type, title, body, is_read, created_at').eq('student_id', studentId).order('created_at', { ascending: false }).limit(10),
    ]);
    setGrades((g.data as unknown as StudentGrade[]) ?? []);
    setAttendance((a.data as StudentAttendance[]) ?? []);
    setNotifications((n.data as NotificationRow[]) ?? []);
  }, []);

  useEffect(() => { loadLinked(); }, [loadLinked]);
  useEffect(() => {
    if (linkedStudents.length === 1 && !selectedStudent) {
      void loadStudentData(linkedStudents[0].student_id);
    }
  }, [linkedStudents, selectedStudent, loadStudentData]);

  async function markRead(notifId: string) {
    await supabase.from('parent_notifications').update({ is_read: true }).eq('id', notifId);
    setNotifications((prev) => prev.map((n) => n.id === notifId ? { ...n, is_read: true } : n));
  }

  if (loading) return <div className="flex justify-center py-16"><Loader2 size={24} className="animate-spin text-brand-600" /></div>;

  if (!isParent) {
    return (
      <div className="space-y-5">
        <SectionHeader title="بوابة أولياء الأمور" subtitle="إدارة إشعارات ومتابعة أولياء الأمور" />
        <Card><EmptyState icon={<Heart size={40} />} title="هذه البوابة لأولياء الأمور" subtitle="سجّل دخول بحساب ولي أمر لمتابعة أبنائك" /></Card>
      </div>
    );
  }

  if (linkedStudents.length === 0) {
    return (
      <div className="space-y-5">
        <SectionHeader title="بوابة أولياء الأمور" />
        <Card><EmptyState icon={<Heart size={40} />} title="لم يتم ربط أبنائك بعد" subtitle="تواصل مع إدارة المدرسة لربط حسابك بأبنائك" /></Card>
      </div>
    );
  }

  const avgGrade = grades.length > 0 ? grades.reduce((sum, g) => sum + (g.score / g.max_score) * 100, 0) / grades.length : 0;
  const presentCount = attendance.filter((a) => a.status === 'present').length;
  const absentCount = attendance.filter((a) => a.status === 'absent').length;
  const attendanceRate = attendance.length > 0 ? (presentCount / attendance.length) * 100 : 0;

  return (
    <div className="space-y-5">
      <SectionHeader title="بوابة أولياء الأمور" subtitle="متابعة تقدم الأبناء والحضور والإشعارات" />

      {/* Student selector */}
      {linkedStudents.length > 1 && (
        <Card className="p-4">
          <div className="flex gap-2 flex-wrap">
            {linkedStudents.map((s) => (
              <button key={s.student_id} onClick={() => loadStudentData(s.student_id)}
                className={`px-4 py-2 rounded-xl text-sm font-600 transition ${selectedStudent === s.student_id ? 'bg-brand-600 text-white' : 'bg-ink-100 text-ink-600 hover:bg-ink-200'}`}>
                {s.full_name}
              </button>
            ))}
          </div>
        </Card>
      )}

      {!selectedStudent && linkedStudents.length === 1 && (
        <div className="flex justify-center py-8"><Loader2 size={20} className="animate-spin text-brand-600" /></div>
      )}

      {selectedStudent && (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card className="p-5">
              <div className="flex items-center gap-2 mb-2"><Award size={16} className="text-accent-600" /><span className="text-xs text-ink-500">متوسط الدرجات</span></div>
              <div className="text-3xl font-800 text-accent-600 nums-latin">{avgGrade.toFixed(1)}%</div>
              <ProgressBar value={avgGrade} tone="accent" className="mt-2" />
            </Card>
            <Card className="p-5">
              <div className="flex items-center gap-2 mb-2"><Calendar size={16} className="text-brand-600" /><span className="text-xs text-ink-500">نسبة الحضور</span></div>
              <div className="text-3xl font-800 text-brand-600 nums-latin">{attendanceRate.toFixed(0)}%</div>
              <ProgressBar value={attendanceRate} tone="brand" className="mt-2" />
            </Card>
            <Card className="p-5">
              <div className="flex items-center gap-2 mb-2"><Check size={16} className="text-accent-600" /><span className="text-xs text-ink-500">أيام الحضور</span></div>
              <div className="text-3xl font-800 text-accent-600 nums-latin">{presentCount}</div>
            </Card>
            <Card className="p-5">
              <div className="flex items-center gap-2 mb-2"><X size={16} className="text-danger-600" /><span className="text-xs text-ink-500">أيام الغياب</span></div>
              <div className="text-3xl font-800 text-danger-600 nums-latin">{absentCount}</div>
            </Card>
          </div>

          {/* Grades */}
          <Card className="p-5">
            <h3 className="font-700 text-ink-900 mb-3 flex items-center gap-2"><TrendingUp size={18} /> آخر الدرجات</h3>
            {grades.length === 0 ? <p className="text-sm text-ink-400 text-center py-4">لا توجد درجات</p> : (
              <div className="space-y-2">
                {grades.map((g) => {
                  const pct = (g.score / g.max_score) * 100;
                  return (
                    <div key={g.id} className="flex items-center gap-3 p-2 rounded-lg bg-ink-50">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-600 text-ink-800 truncate">{g.assessment_title}</p>
                        <p className="text-xs text-ink-400">{g.subjects?.name}</p>
                      </div>
                      <div className="text-left"><span className="text-sm font-700 nums-latin">{g.score}/{g.max_score}</span></div>
                      <div className="w-16"><ProgressBar value={pct} tone={pct >= 50 ? 'accent' : 'danger'} /></div>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>

          {/* Attendance */}
          <Card className="p-5">
            <h3 className="font-700 text-ink-900 mb-3 flex items-center gap-2"><Calendar size={18} /> سجل الحضور</h3>
            {attendance.length === 0 ? <p className="text-sm text-ink-400 text-center py-4">لا يوجد سجل</p> : (
              <div className="space-y-1">
                {attendance.map((a) => {
                  const tone = a.status === 'present' ? 'accent' : a.status === 'absent' ? 'danger' : a.status === 'late' ? 'warning' : 'neutral';
                  const label = a.status === 'present' ? 'حاضر' : a.status === 'absent' ? 'غائب' : a.status === 'late' ? 'متأخر' : 'بعذر';
                  return (
                    <div key={a.id} className="flex items-center gap-3 p-2 rounded-lg">
                      <span className="text-xs text-ink-500 nums-latin w-24">{new Date(a.date).toLocaleDateString('ar')}</span>
                      <Badge tone={tone}>{label}</Badge>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>

          {/* Notifications */}
          <Card className="p-5">
            <h3 className="font-700 text-ink-900 mb-3 flex items-center gap-2"><Bell size={18} /> الإشعارات</h3>
            {notifications.length === 0 ? <p className="text-sm text-ink-400 text-center py-4">لا توجد إشعارات</p> : (
              <div className="space-y-2">
                {notifications.map((n) => (
                  <div key={n.id} className={`p-3 rounded-xl border ${n.is_read ? 'border-ink-100 bg-white' : 'border-brand-200 bg-brand-50/50'}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1">
                        <p className="text-sm font-600 text-ink-900">{n.title}</p>
                        {n.body && <p className="text-xs text-ink-500 mt-0.5">{n.body}</p>}
                        <p className="text-xs text-ink-400 mt-1">{new Date(n.created_at).toLocaleString('ar')}</p>
                      </div>
                      {!n.is_read && <button onClick={() => markRead(n.id)} className="text-xs text-brand-600 hover:text-brand-700">تعليم كمقروء</button>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
