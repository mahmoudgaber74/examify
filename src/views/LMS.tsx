import { useState, useEffect, useCallback } from 'react';
import { Plus, Trash2, Edit3, Loader2, AlertCircle, BookOpen, CheckCircle2, Clock, Eye, Video, FileText } from 'lucide-react';
import { Card, SectionHeader, Badge, EmptyState, ProgressBar } from '../components/ui';
import { supabase, useAuthSafe } from '../lib/auth-helpers';
import type { UserRole } from '../lib/auth';

interface LessonRow {
  id: string;
  title: string;
  description: string | null;
  content_html: string | null;
  video_url: string | null;
  duration_minutes: number;
  sort_order: number;
  is_published: boolean;
  subject_id: string;
}
interface SubjectRow { id: string; name: string; }
interface ProgressRow { lesson_id: string; status: string; progress_percent: number; time_spent_seconds: number; }

export function LMS() {
  const { institutionId, role, user } = useAuthSafe();
  const canEdit = ['super_admin', 'school_admin', 'teacher'].includes(role as UserRole);
  const isStudent = role === 'student';
  const [subjects, setSubjects] = useState<SubjectRow[]>([]);
  const [lessons, setLessons] = useState<LessonRow[]>([]);
  const [progress, setProgress] = useState<Record<string, ProgressRow>>({});
  const [selectedSubject, setSelectedSubject] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showEditor, setShowEditor] = useState(false);
  const [editing, setEditing] = useState<LessonRow | null>(null);
  const [viewing, setViewing] = useState<LessonRow | null>(null);

  const loadSubjects = useCallback(async () => {
    if (!institutionId) return;
    const { data } = await supabase.from('subjects').select('id, name').eq('institution_id', institutionId).eq('is_active', true).order('name');
    setSubjects((data as SubjectRow[]) ?? []);
  }, [institutionId]);

  const loadLessons = useCallback(async () => {
    if (!institutionId) return;
    setLoading(true);
    let query = supabase.from('lessons').select('*').eq('institution_id', institutionId).order('sort_order');
    if (selectedSubject) query = query.eq('subject_id', selectedSubject);
    if (isStudent) query = query.eq('is_published', true);
    const { data, error: err } = await query;
    if (err) { setError(err.message); setLoading(false); return; }
    setLessons((data as LessonRow[]) ?? []);

    // Load progress for students
    if (isStudent && user) {
      const { data: student } = await supabase.from('student_profiles').select('id').eq('user_id', user.id).maybeSingle();
      if (student) {
        const { data: progData } = await supabase.from('lesson_progress').select('lesson_id, status, progress_percent, time_spent_seconds').eq('student_id', (student as { id: string }).id);
        const progMap: Record<string, ProgressRow> = {};
        for (const p of (progData as ProgressRow[]) ?? []) progMap[p.lesson_id] = p;
        setProgress(progMap);
      }
    }
    setLoading(false);
  }, [institutionId, selectedSubject, isStudent, user]);

  useEffect(() => { loadSubjects(); }, [loadSubjects]);
  useEffect(() => { loadLessons(); }, [loadLessons]);

  async function markProgress(lesson: LessonRow, status: string, percent: number) {
    if (!user) return;
    const { data: student } = await supabase.from('student_profiles').select('id').eq('user_id', user.id).maybeSingle();
    if (!student) return;
    const studentId = (student as { id: string }).id;
    await supabase.from('lesson_progress').upsert({
      lesson_id: lesson.id,
      student_id: studentId,
      status,
      progress_percent: percent,
      last_accessed_at: new Date().toISOString(),
      completed_at: status === 'completed' ? new Date().toISOString() : null,
    }, { onConflict: 'lesson_id,student_id' });
    setProgress((prev) => ({ ...prev, [lesson.id]: { lesson_id: lesson.id, status, progress_percent: percent, time_spent_seconds: prev[lesson.id]?.time_spent_seconds ?? 0 } }));
  }

  if (loading) return <div className="flex justify-center py-16"><Loader2 size={24} className="animate-spin text-brand-600" /></div>;

  if (viewing) {
    return (
      <div className="max-w-3xl mx-auto space-y-4">
        <div className="flex items-center justify-between">
          <button onClick={() => setViewing(null)} className="btn-ghost">← رجوع</button>
          {isStudent && (
            <div className="flex gap-2">
              <button onClick={() => markProgress(viewing, 'in_progress', 50)} className="btn-outline"><Clock size={16} /> قيد القراءة</button>
              <button onClick={() => markProgress(viewing, 'completed', 100)} className="btn-primary"><CheckCircle2 size={16} /> إكمال</button>
            </div>
          )}
        </div>
        <Card className="p-6">
          <h2 className="font-display text-xl font-700 text-ink-900 mb-2">{viewing.title}</h2>
          {viewing.description && <p className="text-sm text-ink-500 mb-4">{viewing.description}</p>}
          {viewing.video_url && (
            <div className="mb-4 rounded-xl overflow-hidden bg-ink-950 aspect-video">
              <video src={viewing.video_url} controls className="w-full h-full" />
            </div>
          )}
          {viewing.content_html && (
            <div className="prose prose-sm max-w-none text-ink-800" dir="auto" dangerouslySetInnerHTML={{ __html: viewing.content_html }} />
          )}
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <SectionHeader
        title="إدارة التعلّم"
        subtitle="الدروس والمحتوى التعليمي مع تتبع تقدم الطلاب"
        action={canEdit && (
          <button onClick={() => { setEditing(null); setShowEditor(true); }} className="btn-primary"><Plus size={16} /> درس جديد</button>
        )}
      />

      {error && <div className="flex items-center gap-2 p-3 rounded-xl bg-danger-50 border border-danger-200"><AlertCircle size={18} className="text-danger-600" /><p className="text-sm text-danger-700">{error}</p></div>}

      <Card className="p-4">
        <div className="flex items-center gap-3">
          <BookOpen size={16} className="text-ink-400" />
          <select className="input !w-auto" value={selectedSubject} onChange={(e) => setSelectedSubject(e.target.value)}>
            <option value="">كل المواد</option>
            {subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
      </Card>

      {lessons.length === 0 ? (
        <Card><EmptyState icon={<BookOpen size={40} />} title="لا توجد دروس" subtitle={canEdit ? "ابدأ بإنشاء أول درس" : "لم يُنشر أي درس بعد"} /></Card>
      ) : (
        <div className="grid gap-3">
          {lessons.map((lesson, i) => {
            const prog = progress[lesson.id];
            return (
              <Card key={lesson.id} hover className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3 flex-1 min-w-0">
                    <div className="grid place-items-center w-10 h-10 rounded-xl bg-brand-100 text-brand-700 shrink-0 font-700 nums-latin">{i + 1}</div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="font-700 text-ink-900 truncate">{lesson.title}</h3>
                        {!lesson.is_published && canEdit && <Badge tone="neutral">مسودة</Badge>}
                        {prog?.status === 'completed' && <Badge tone="accent">مكتمل</Badge>}
                        {prog?.status === 'in_progress' && <Badge tone="brand">قيد القراءة</Badge>}
                      </div>
                      {lesson.description && <p className="text-sm text-ink-500 line-clamp-1">{lesson.description}</p>}
                      <div className="flex items-center gap-3 text-xs text-ink-400 mt-1">
                        <span className="flex items-center gap-1"><Clock size={12} /> {lesson.duration_minutes} دقيقة</span>
                        {lesson.video_url && <span className="flex items-center gap-1"><Video size={12} /> فيديو</span>}
                        {lesson.content_html && <span className="flex items-center gap-1"><FileText size={12} /> محتوى</span>}
                      </div>
                      {isStudent && prog && <ProgressBar value={prog.progress_percent} className="mt-2" />}
                    </div>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <button onClick={() => setViewing(lesson)} className="grid place-items-center w-8 h-8 rounded-lg text-ink-400 hover:bg-ink-100 hover:text-ink-700"><Eye size={16} /></button>
                    {canEdit && (
                      <>
                        <button onClick={() => { setEditing(lesson); setShowEditor(true); }} className="grid place-items-center w-8 h-8 rounded-lg text-ink-400 hover:bg-ink-100 hover:text-ink-700"><Edit3 size={16} /></button>
                        <button onClick={async () => { if (confirm('حذف هذا الدرس؟')) { await supabase.from('lessons').delete().eq('id', lesson.id); loadLessons(); } }} className="grid place-items-center w-8 h-8 rounded-lg text-ink-400 hover:bg-danger-50 hover:text-danger-600"><Trash2 size={16} /></button>
                      </>
                    )}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {showEditor && <LessonEditor institutionId={institutionId ?? ''} subjects={subjects} editing={editing} onClose={() => setShowEditor(false)} onSaved={() => { setShowEditor(false); setEditing(null); loadLessons(); }} />}
    </div>
  );
}

function LessonEditor({ institutionId, subjects, editing, onClose, onSaved }: { institutionId: string; subjects: SubjectRow[]; editing: LessonRow | null; onClose: () => void; onSaved: () => void }) {
  const [title, setTitle] = useState(editing?.title ?? '');
  const [description, setDescription] = useState(editing?.description ?? '');
  const [contentHtml, setContentHtml] = useState(editing?.content_html ?? '');
  const [videoUrl, setVideoUrl] = useState(editing?.video_url ?? '');
  const [duration, setDuration] = useState(editing?.duration_minutes ?? 45);
  const [subjectId, setSubjectId] = useState(editing?.subject_id ?? subjects[0]?.id ?? '');
  const [isPublished, setIsPublished] = useState(editing?.is_published ?? false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    setSaving(true);
    setError(null);
    if (!title.trim()) { setError('العنوان مطلوب'); setSaving(false); return; }
    if (!subjectId) { setError('المادة مطلوبة'); setSaving(false); return; }
    const data = { institution_id: institutionId, subject_id: subjectId, title: title.trim(), description: description || null, content_html: contentHtml || null, video_url: videoUrl || null, duration_minutes: Number(duration), is_published: isPublished };
    try {
      if (editing) { const { error: err } = await supabase.from('lessons').update(data).eq('id', editing.id); if (err) throw err; }
      else { const { error: err } = await supabase.from('lessons').insert(data); if (err) throw err; }
      onSaved();
    } catch (e) { setError(e instanceof Error ? e.message : 'حدث خطأ'); } finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-50 bg-ink-950/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div className="card w-full max-w-2xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 bg-white border-b border-ink-100 px-6 py-4 flex items-center justify-between">
          <h3 className="font-display text-lg font-700 text-ink-900">{editing ? 'تعديل الدرس' : 'درس جديد'}</h3>
          <button onClick={onClose} className="text-ink-400 hover:text-ink-700 text-xl">✕</button>
        </div>
        <div className="p-6 space-y-4">
          {error && <div className="flex items-center gap-2 p-3 rounded-xl bg-danger-50 border border-danger-200"><AlertCircle size={18} className="text-danger-600" /><p className="text-sm text-danger-700">{error}</p></div>}
          <div><label className="label">العنوان</label><input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="عنوان الدرس" /></div>
          <div><label className="label">المادة</label><select className="input" value={subjectId} onChange={(e) => setSubjectId(e.target.value)}><option value="">اختر المادة</option>{subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
          <div><label className="label">الوصف</label><input className="input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="وصف موجز" /></div>
          <div><label className="label">رابط الفيديو (اختياري)</label><input className="input" value={videoUrl} onChange={(e) => setVideoUrl(e.target.value)} dir="ltr" placeholder="https://..." /></div>
          <div><label className="label">المحتوى (HTML)</label><textarea className="input min-h-[150px] resize-y font-mono text-xs" value={contentHtml} onChange={(e) => setContentHtml(e.target.value)} dir="ltr" placeholder="<p>محتوى الدرس...</p>" /></div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="label">المدة (دقيقة)</label><input type="number" className="input" value={duration} onChange={(e) => setDuration(Number(e.target.value))} /></div>
            <div><label className="label">الحالة</label><select className="input" value={isPublished ? '1' : '0'} onChange={(e) => setIsPublished(e.target.value === '1')}><option value="0">مسودة</option><option value="1">منشور</option></select></div>
          </div>
        </div>
        <div className="sticky bottom-0 bg-white border-t border-ink-100 px-6 py-4 flex justify-end gap-2">
          <button onClick={onClose} className="btn-ghost">إلغاء</button>
          <button onClick={handleSave} disabled={saving} className="btn-primary disabled:opacity-60">{saving ? <Loader2 size={16} className="animate-spin" /> : null}{editing ? 'حفظ' : 'إنشاء'}</button>
        </div>
      </div>
    </div>
  );
}
