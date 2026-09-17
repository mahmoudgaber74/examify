import { useEffect, useState } from 'react';
import { supabase, useAuthSafe } from '../lib/auth-helpers';
import { Card, Badge } from '../components/ui';
import { Award, CheckCircle2, Eye, Loader2, Search, ShieldCheck } from 'lucide-react';

type Certificate = { id: string; recipient: string; program: string; issuer: string; issued_date: string | null; credential_id: string; verified_method: string; score: number; status?: string };
type Student = { id: string; full_name: string };
type Exam = { id: string; title: string };

export function Certification() {
  const { institutionId } = useAuthSafe();
  const [certificates, setCertificates] = useState<Certificate[]>([]);
  const [selected, setSelected] = useState<Certificate | null>(null);
  const [students, setStudents] = useState<Student[]>([]);
  const [exams, setExams] = useState<Exam[]>([]);
  const [studentId, setStudentId] = useState('');
  const [examId, setExamId] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [issuing, setIssuing] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => { void Promise.all([loadCertificates(), loadIssuanceOptions()]); }, [institutionId]);

  async function loadCertificates() {
    setLoading(true);
    const { data, error } = await supabase.from('certificates').select('id, recipient, program, issuer, issued_date, credential_id, verified_method, score, status').order('issued_date', { ascending: false });
    if (error) setMessage('Certificates could not be loaded.');
    const rows = (data as Certificate[]) ?? [];
    setCertificates(rows); setSelected((current) => rows.find((row) => row.id === current?.id) ?? rows[0] ?? null); setLoading(false);
  }

  async function loadIssuanceOptions() {
    if (!institutionId) return;
    const [studentResult, examResult] = await Promise.all([
      supabase.from('student_profiles').select('id, full_name').eq('institution_id', institutionId).eq('is_active', true).order('full_name'),
      supabase.from('examify_exams').select('id, title').eq('institution_id', institutionId).order('created_at', { ascending: false }),
    ]);
    if (studentResult.error || examResult.error) setMessage('Certificate issuance options are unavailable.');
    setStudents((studentResult.data as Student[]) ?? []); setExams((examResult.data as Exam[]) ?? []);
  }

  async function issueCertificate() {
    if (!studentId || !examId) { setMessage('Select a student and exam attempt to issue a certificate.'); return; }
    setIssuing(true); setMessage(null);
    const { error } = await supabase.rpc('issue_certificate_for_exam', { p_student_id: studentId, p_exam_id: examId, p_issuer: 'Examify' });
    if (error) setMessage('Certificate was not issued: the achievement could not be verified or the request is not authorized.');
    else { setMessage('Certificate issued from the verified achievement record.'); await loadCertificates(); }
    setIssuing(false);
  }

  async function revokeCertificate() {
    if (!selected || selected.status === 'revoked') return;
    setRevoking(true); setMessage(null);
    const { data, error } = await supabase.rpc('revoke_certificate', { p_certificate_id: selected.id });
    if (error) setMessage('Certificate was not revoked.');
    else { setMessage('Certificate revoked.'); const revoked = { ...selected, status: 'revoked' }; setSelected((data as Certificate) ?? revoked); setCertificates((rows) => rows.map((row) => row.id === selected.id ? ((data as Certificate) ?? revoked) : row)); }
    setRevoking(false);
  }

  async function verifyCertificate() {
    if (!selected) return;
    const { data, error } = await supabase.rpc('verify_certificate', { p_credential_id: selected.credential_id });
    const verification = Array.isArray(data) ? data[0] as { verification_status?: string } | undefined : undefined;
    setMessage(error ? 'Certificate record could not be verified.' : verification?.verification_status === 'REVOKED' ? 'Certificate record is revoked.' : verification?.verification_status === 'VALID' ? 'Verified Certificate Record' : 'Certificate was not found.');
  }

  const filtered = certificates.filter((certificate) => !search || certificate.recipient.toLowerCase().includes(search.toLowerCase()) || certificate.program.toLowerCase().includes(search.toLowerCase()));
  if (loading) return <Card className="p-10 text-center"><Loader2 className="mx-auto animate-spin text-brand-600" /></Card>;
  return <div className="space-y-6">
    {message && <div className="rounded-xl border border-ink-200 bg-ink-50 p-3 text-sm text-ink-700">{message}</div>}
    <Card className="p-5"><div className="flex items-center gap-3"><Award className="text-brand-600" /><div><h2 className="font-display text-xl font-700">Verified Certificate Records</h2><p className="text-sm text-ink-500">{certificates.length} stored record(s)</p></div></div><div className="mt-4 flex items-center gap-2 rounded-xl bg-ink-50 px-3 py-2"><Search size={15} className="text-ink-400" /><input value={search} onChange={(event) => setSearch(event.target.value)} className="flex-1 bg-transparent text-sm outline-none" placeholder="Search stored records" /></div></Card>
    <Card className="p-5"><h3 className="font-display text-lg font-700 text-ink-900">Issue from verified achievement</h3><p className="mt-1 text-sm text-ink-500">The server checks the published, passed attempt and generates the certificate identifier.</p><div className="mt-4 grid gap-3 md:grid-cols-3"><select value={studentId} onChange={(event) => setStudentId(event.target.value)} className="rounded-xl border border-ink-200 bg-white px-3 py-2 text-sm"><option value="">Select student</option>{students.map((student) => <option key={student.id} value={student.id}>{student.full_name}</option>)}</select><select value={examId} onChange={(event) => setExamId(event.target.value)} className="rounded-xl border border-ink-200 bg-white px-3 py-2 text-sm"><option value="">Select exam</option>{exams.map((exam) => <option key={exam.id} value={exam.id}>{exam.title}</option>)}</select><button onClick={() => void issueCertificate()} disabled={issuing || !students.length || !exams.length} className="btn-primary">{issuing ? <Loader2 size={16} className="animate-spin" /> : <Award size={16} />} Issue certificate</button></div></Card>
    {!selected ? <Card className="p-10 text-center"><Award size={32} className="mx-auto mb-3 text-ink-300" /><h2 className="font-display text-lg font-700 text-ink-900">No certificates issued</h2><p className="mt-2 text-sm text-ink-500">Certificates appear after a verified student achievement.</p></Card> : <div className="grid grid-cols-1 gap-6 lg:grid-cols-3"><Card className="p-0 divide-y divide-ink-100">{filtered.map((certificate) => <button key={certificate.id} onClick={() => setSelected(certificate)} className={`w-full p-4 text-right hover:bg-ink-50 ${selected.id === certificate.id ? 'bg-brand-50' : ''}`}><p className="font-600 text-ink-900">{certificate.recipient}</p><p className="text-xs text-ink-500">{certificate.program}</p><p className="mt-1 font-mono text-[11px] text-ink-400">{certificate.credential_id}</p></button>)}</Card><Card className="p-6 lg:col-span-2"><div className="flex items-start justify-between"><div><p className="text-sm text-ink-500">Recipient</p><h2 className="font-display text-2xl font-800 text-ink-900">{selected.recipient}</h2><p className="mt-1 text-brand-700">{selected.program}</p></div><Badge tone={selected.status === 'revoked' ? 'warning' : 'accent'}>{selected.status === 'revoked' ? 'Revoked' : 'Active'}</Badge></div><div className="mt-6 grid grid-cols-2 gap-3 text-sm"><div><p className="text-ink-500">Issuer</p><p className="font-600">{selected.issuer}</p></div><div><p className="text-ink-500">Issued</p><p className="font-600">{selected.issued_date ?? '—'}</p></div><div><p className="text-ink-500">Score</p><p className="font-600">{selected.score}%</p></div><div><p className="text-ink-500">Identifier</p><p className="font-mono text-xs">{selected.credential_id}</p></div></div><div className="mt-6 flex flex-wrap gap-2"><button onClick={() => void verifyCertificate()} className="btn-primary"><ShieldCheck size={16} /> Verify stored record</button><button onClick={() => void revokeCertificate()} disabled={revoking || selected.status === 'revoked'} className="btn-outline"><CheckCircle2 size={16} /> {revoking ? 'Revoking…' : selected.status === 'revoked' ? 'Revoked' : 'Revoke certificate'}</button><button disabled className="btn-outline opacity-60"><Eye size={16} /> PDF unavailable</button></div><div className="mt-4 text-xs text-ink-500">Verification checks the stored certificate record; identifiers are generated by the server. PDF generation is unavailable until an Arabic-capable renderer is deployed.</div></Card></div>}
  </div>;
}
