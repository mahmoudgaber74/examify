import { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, CheckCircle2, Clock3, RefreshCw, StopCircle, XCircle, type LucideIcon } from 'lucide-react';
import { supabase, useAuthSafe } from '../lib/auth-helpers';
import { Card, SectionHeader } from '../components/ui';

type Job = { id: string; scan_id: string; request_id: string; status: string; attempt_count: number; max_attempts: number; queued_at: string; started_at: string | null; completed_at: string | null; next_retry_at: string | null; processing_time_ms: number | null; error_code: string | null; error_message_safe: string | null; engine_version: string | null; heartbeat_at: string | null };
const labels: Record<string, string> = { queued: 'في الانتظار', processing: 'قيد المعالجة', retrying: 'إعادة محاولة', completed: 'مكتمل', needs_review: 'يحتاج مراجعة', failed: 'فشل', approved: 'معتمد', cancelled: 'ملغى' };

export function OmrOperations() {
  const { role } = useAuthSafe();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [status, setStatus] = useState('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    setLoading(true);
    const { data, error: queryError } = await supabase.rpc('list_omr_processing_jobs', { p_status: status === 'all' ? null : status, p_limit: 100 });
    setJobs((data as Job[]) ?? []); setError(queryError?.message ?? null); setLoading(false);
  }, [status]);
  useEffect(() => { load(); const timer = window.setInterval(load, 5000); return () => window.clearInterval(timer); }, [load]);
  const stats = useMemo(() => ({ queued: jobs.filter(j => j.status === 'queued').length, processing: jobs.filter(j => j.status === 'processing').length, retrying: jobs.filter(j => j.status === 'retrying').length, failed: jobs.filter(j => j.status === 'failed').length, review: jobs.filter(j => j.status === 'needs_review').length }), [jobs]);
  async function retry(id: string) { const { error: e } = await supabase.rpc('manual_retry_omr_processing_job', { p_job_id: id }); if (e) setError(e.message); else load(); }
  async function cancel(id: string) { const { error: e } = await supabase.rpc('cancel_omr_processing_job', { p_job_id: id }); if (e) setError(e.message); else load(); }
  if (role === 'student' || role === 'parent') return <Card><p className="text-sm text-ink-500">ليس لديك صلاحية لمراقبة المعالجة.</p></Card>;
  const cards: Array<[keyof typeof stats, string, LucideIcon]> = [['queued','في الانتظار',Clock3],['processing','قيد المعالجة',Activity],['retrying','إعادة محاولة',RefreshCw],['failed','فشل',XCircle],['review','مراجعة',CheckCircle2]];
  return <div className="space-y-6" dir="rtl">
    <SectionHeader title="مراقبة معالجة OMR" subtitle="حالة الطوابير والمحاولات والأخطاء الفعلية من قاعدة البيانات المحلية" />
    <div className="grid grid-cols-2 md:grid-cols-5 gap-3">{cards.map(([key,label,Icon]) => <Card key={String(key)} className="p-4"><div className="flex items-center gap-2 text-ink-500 text-xs"><Icon size={15}/>{label}</div><div className="text-2xl font-700 mt-2">{stats[key]}</div></Card>)}</div>
    <Card className="p-0 overflow-hidden"><div className="p-4 border-b border-ink-100 flex items-center justify-between"><select value={status} onChange={e => setStatus(e.target.value)} className="input w-auto"><option value="all">كل الحالات</option>{Object.entries(labels).map(([v,l]) => <option key={v} value={v}>{l}</option>)}</select><button onClick={load} className="btn-secondary flex items-center gap-2"><RefreshCw size={15}/>تحديث</button></div>
      {error && <p className="p-4 text-sm text-red-600">{error}</p>}{loading && !jobs.length ? <p className="p-6 text-sm text-ink-500">جارٍ التحميل...</p> : <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-right text-ink-500 border-b border-ink-100"><th className="p-3">Job</th><th>الحالة</th><th>المحاولة</th><th>الزمن</th><th>آخر خطأ</th><th>إجراء</th></tr></thead><tbody>{jobs.map(job => <tr key={job.id} className="border-b border-ink-50"><td className="p-3"><code className="text-xs">{job.id.slice(0,8)}</code><div className="text-[10px] text-ink-400">{job.request_id.slice(0,12)}</div></td><td><span className="badge">{labels[job.status] ?? job.status}</span></td><td>{job.attempt_count}/{job.max_attempts}</td><td>{job.processing_time_ms ? `${job.processing_time_ms} ms` : '—'}</td><td className="max-w-xs">{job.error_message_safe ?? '—'}{job.error_code && <div className="text-[10px] text-ink-400">{job.error_code}</div>}</td><td><div className="flex gap-2">{(job.status === 'failed' || job.status === 'retrying') && <button className="btn-secondary text-xs" onClick={() => retry(job.id)}>إعادة</button>}{(job.status === 'queued' || job.status === 'retrying') && <button className="btn-secondary text-xs text-red-600" onClick={() => cancel(job.id)}><StopCircle size={13}/></button>}</div></td></tr>)}</tbody></table>{!jobs.length && <p className="p-6 text-center text-sm text-ink-500">لا توجد Jobs.</p>}</div>}</Card>
  </div>;
}
