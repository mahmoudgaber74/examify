import { useState, useEffect, useCallback } from 'react';
import { Loader2, AlertCircle, TrendingUp, Award, Users, BarChart3, Download, FileSpreadsheet } from 'lucide-react';
import { Card, SectionHeader, EmptyState, ProgressBar } from '../components/ui';
import { supabase, useAuthSafe } from '../lib/auth-helpers';
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import { ar, getArabicErrorMessage } from '../lib/translate';

interface ReportExam {
  id: string;
  title: string;
  subject_id: string | null;
  total_points: number;
  passing_score: number;
  subjects?: { name: string } | null;
}

interface AttemptForReport {
  id: string;
  submitted_at: string | null;
  score: number | null;
  score_percentage: number | null;
  is_passed: boolean | null;
  is_result_published: boolean;
  status: string;
  examify_exams: ReportExam;
}

export function Reports() {
  const { institutionId, role } = useAuthSafe();
  const [attempts, setAttempts] = useState<AttemptForReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterExam, setFilterExam] = useState('all');
  const [filterSubject, setFilterSubject] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [exams, setExams] = useState<ReportExam[]>([]);

  const load = useCallback(async () => {
    if (!institutionId) return;
    setLoading(true);
    setError(null);

    const { data: examData } = await supabase
      .from('examify_exams')
      .select('id, title, subject_id, total_points, passing_score, subjects(name)')
      .eq('institution_id', institutionId)
      .order('created_at', { ascending: false });
    const loadedExams = (examData as unknown as ReportExam[]) ?? [];
    setExams(loadedExams);

    let query = supabase
      .from('exam_attempts')
      .select('id, submitted_at, score, score_percentage, is_passed, is_result_published, status, examify_exams!inner(id, title, subject_id, total_points, passing_score, subjects(name))')
      .eq('examify_exams.institution_id', institutionId)
      .in('status', ['submitted', 'auto_submitted', 'graded', 'approved']);

    if (filterExam !== 'all') query = query.eq('exam_id', filterExam);
    if (filterSubject !== 'all') query = query.eq('examify_exams.subject_id', filterSubject);
    if (filterStatus !== 'all') query = query.eq('status', filterStatus);
    if (dateFrom) query = query.gte('submitted_at', `${dateFrom}T00:00:00.000Z`);
    if (dateTo) query = query.lte('submitted_at', `${dateTo}T23:59:59.999Z`);

    const { data, error: err } = await query.order('submitted_at', { ascending: false });
    if (err) { console.error('Reports load failed', err); setError(getArabicErrorMessage(err)); setLoading(false); return; }
    setAttempts((data as unknown as AttemptForReport[]) ?? []);
    setLoading(false);
  }, [dateFrom, dateTo, filterExam, filterStatus, filterSubject, institutionId]);

  useEffect(() => { load(); }, [load]);

  // Compute analytics
  const published = attempts.filter((a) => a.is_result_published || role !== 'student');
  const totalAttempts = published.length;
  const passed = published.filter((a) => a.is_passed).length;
  const failed = totalAttempts - passed;
  const passRate = totalAttempts > 0 ? (passed / totalAttempts) * 100 : 0;
  const avgScore = totalAttempts > 0 ? published.reduce((sum, a) => sum + (a.score_percentage ?? 0), 0) / totalAttempts : 0;
  const highest = totalAttempts > 0 ? Math.max(...published.map((a) => a.score_percentage ?? 0)) : 0;
  const lowest = totalAttempts > 0 ? Math.min(...published.map((a) => a.score_percentage ?? 0)) : 0;
  const subjects = Array.from(new Map(exams.filter((exam) => exam.subject_id).map((exam) => [exam.subject_id, exam.subjects?.name ?? 'بدون اسم'])).entries());

  // Per-exam breakdown
  const examStats = exams.map((exam) => {
    const examAttempts = published.filter((a) => a.examify_exams.id === exam.id);
    const total = examAttempts.length;
    const examPassed = examAttempts.filter((a) => a.is_passed).length;
    const examAvg = total > 0 ? examAttempts.reduce((s, a) => s + (a.score_percentage ?? 0), 0) / total : 0;
    return { exam, total, passed: examPassed, avg: examAvg };
  }).filter((s) => s.total > 0);

  function exportExcel() {
    const rows = published.map((a) => ({
      'الامتحان': a.examify_exams.title,
      'المادة': a.examify_exams.subjects?.name ?? '',
      'الدرجة': a.score ?? 0,
      'النسبة': a.score_percentage?.toFixed(1) ?? '0',
      'النتيجة': a.is_passed ? 'ناجح' : 'راسب',
      'الحالة': a.status,
      'منشور': a.is_result_published ? 'نعم' : 'لا',
      'تاريخ التسليم': a.submitted_at ? new Date(a.submitted_at).toLocaleString('ar') : '',
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'النتائج');
    XLSX.writeFile(wb, `تقرير-النتائج-${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  function exportPDF() {
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    pdf.setFontSize(16);
    pdf.setFont('helvetica', 'bold');
    pdf.text(ar.reports.reportTitle, 15, 20);
    pdf.setFontSize(10);
    pdf.setFont('helvetica', 'normal');
    pdf.text(`${ar.reports.date}: ${new Date().toLocaleDateString('ar')}`, 15, 28);
    pdf.text(`${ar.reports.totalAttempts}: ${totalAttempts}`, 15, 35);
    pdf.text(`${ar.reports.passRate}: ${passRate.toFixed(1)}%`, 15, 42);
    pdf.text(`${ar.reports.average}: ${avgScore.toFixed(1)}%`, 15, 49);
    pdf.text(`${ar.reports.highestLowest}: ${highest.toFixed(1)}% / ${lowest.toFixed(1)}%`, 15, 56);

    let y = 68;
    pdf.setFont('helvetica', 'bold');
    pdf.text(ar.reports.perExamBreakdown, 15, y);
    y += 8;
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(9);
    for (const s of examStats) {
      pdf.text(`${s.exam.title}: ${s.total} ${ar.reports.attempts}, ${s.passed} ${ar.reports.passed}, ${ar.reports.average} ${s.avg.toFixed(1)}%`, 15, y);
      y += 6;
      if (y > 280) { pdf.addPage(); y = 20; }
    }

    pdf.save(`تقرير-النتائج-${new Date().toISOString().slice(0, 10)}.pdf`);
  }

  if (loading) return <div className="flex justify-center py-16"><Loader2 size={24} className="animate-spin text-brand-600" /></div>;

  return (
    <div className="space-y-5">
      <SectionHeader
        title={ar.reports.title}
        subtitle={ar.reports.subtitle}
        action={
          <div className="flex gap-2">
            <button data-testid="reports-export-excel" onClick={exportExcel} disabled={totalAttempts === 0} className="btn-outline disabled:opacity-40"><FileSpreadsheet size={16} /> Excel</button>
            <button data-testid="reports-export-pdf" onClick={exportPDF} disabled={totalAttempts === 0} className="btn-outline disabled:opacity-40"><Download size={16} /> PDF</button>
          </div>
        }
      />

      {error && (
        <div className="flex items-center gap-2 p-3 rounded-xl bg-danger-50 border border-danger-200">
          <AlertCircle size={18} className="text-danger-600" />
          <p className="text-sm text-danger-700">{error}</p>
        </div>
      )}

      <Card className="p-4">
        <div className="grid md:grid-cols-5 gap-3">
          <select data-testid="reports-filter-exam" className="input" value={filterExam} onChange={(e) => setFilterExam(e.target.value)}>
            <option value="all">{ar.reports.allExams}</option>
            {exams.map((e) => <option key={e.id} value={e.id}>{e.title}</option>)}
          </select>
          <select data-testid="reports-filter-subject" className="input" value={filterSubject} onChange={(e) => setFilterSubject(e.target.value)}>
            <option value="all">جميع المواد</option>
            {subjects.map(([id, name]) => <option key={id} value={id ?? ''}>{name}</option>)}
          </select>
          <select data-testid="reports-filter-status" className="input" value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
            <option value="all">جميع الحالات</option>
            <option value="submitted">بانتظار التصحيح</option>
            <option value="auto_submitted">مسلّم تلقائيًا</option>
            <option value="graded">تم التصحيح</option>
            <option value="approved">معتمد</option>
          </select>
          <input data-testid="reports-date-from" type="date" className="input" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          <input data-testid="reports-date-to" type="date" className="input" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
        </div>
      </Card>

      {totalAttempts === 0 ? (
        <Card><EmptyState icon={<BarChart3 size={40} />} title={ar.reports.noData} subtitle={ar.reports.noDataSubtitle} /></Card>
      ) : (
        <>
          {/* KPI cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card className="p-5">
              <div className="flex items-center gap-2 mb-2"><TrendingUp size={16} className="text-brand-600" /><span className="text-xs text-ink-500">{ar.reports.passRate}</span></div>
              <div data-testid="reports-pass-rate" className="text-3xl font-800 text-brand-600 nums-latin">{passRate.toFixed(1)}%</div>
              <ProgressBar value={passRate} tone="brand" className="mt-2" />
            </Card>
            <Card className="p-5">
              <div className="flex items-center gap-2 mb-2"><Award size={16} className="text-accent-600" /><span className="text-xs text-ink-500">{ar.reports.average}</span></div>
              <div data-testid="reports-average" className="text-3xl font-800 text-accent-600 nums-latin">{avgScore.toFixed(1)}%</div>
              <ProgressBar value={avgScore} tone="accent" className="mt-2" />
            </Card>
            <Card className="p-5">
              <div className="flex items-center gap-2 mb-2"><Users size={16} className="text-ink-600" /><span className="text-xs text-ink-500">{ar.reports.totalAttempts}</span></div>
              <div data-testid="reports-total-attempts" className="text-3xl font-800 text-ink-800 nums-latin">{totalAttempts}</div>
              <div className="text-xs text-ink-400 mt-2 nums-latin">{passed} {ar.reports.passed} · {failed} {ar.reports.failed}</div>
            </Card>
            <Card className="p-5">
              <div className="flex items-center gap-2 mb-2"><BarChart3 size={16} className="text-gold-600" /><span className="text-xs text-ink-500">{ar.reports.highestLowest}</span></div>
              <div className="text-2xl font-800 text-gold-600 nums-latin">{highest.toFixed(1)}%</div>
              <div className="text-xs text-ink-400 mt-1 nums-latin">{ar.reports.lowest}: {lowest.toFixed(1)}%</div>
            </Card>
          </div>

          {/* Per-exam breakdown */}
          <Card className="p-5">
            <h3 className="font-700 text-ink-900 mb-4">{ar.reports.perExamAnalysis}</h3>
            <div className="space-y-3">
              {examStats.map((s) => (
                <div key={s.exam.id} className="flex items-center gap-4 p-3 rounded-xl bg-ink-50">
                  <div className="flex-1 min-w-0">
                    <h4 className="font-600 text-ink-800 truncate">{s.exam.title}</h4>
                    <div className="flex items-center gap-3 text-xs text-ink-400 mt-1">
                      <span className="nums-latin">{s.total} {ar.reports.attempts}</span>
                      <span className="nums-latin">{s.passed} {ar.reports.passed}</span>
                      <span className="nums-latin">{ar.reports.average}: {s.avg.toFixed(1)}%</span>
                    </div>
                  </div>
                  <div className="w-32 shrink-0">
                    <ProgressBar value={s.avg} tone={s.avg >= 50 ? 'accent' : 'danger'} />
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
