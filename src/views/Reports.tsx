import { useState, useEffect, useCallback } from 'react';
import { Loader2, AlertCircle, TrendingUp, Award, Users, BarChart3, Download, FileSpreadsheet } from 'lucide-react';
import { Card, SectionHeader, EmptyState, ProgressBar, Badge } from '../components/ui';
import { Select as DropdownSelect } from '../components/ui/Select';
import { supabase, useAuthSafe } from '../lib/auth-helpers';
import jsPDF from 'jspdf';
import { ar, getArabicErrorMessage } from '../lib/translate';
import { exportResultsWorkbook, type ReportExportAnswer } from '../lib/report-export';

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
  student_profiles?: { id: string; full_name: string; student_code: string | null; phone: string | null } | null;
}

interface OutcomeMasteryReport {
  learning_outcome_id: string;
  code: string;
  name_ar: string;
  question_count: number;
  attempt_count: number;
  answered_count: number;
  mastery_percentage: number | null;
  recommendation: string;
  is_sufficient: boolean;
}

interface StudentLearningReport {
  institution: { name: string; logo_url: string | null };
  student: { id: string; full_name: string; student_code: string | null; phone: string | null };
  exam: { id: string; title: string; subject_name: string | null; class_name: string | null; total_points: number; passing_score: number };
  eligible_attempt_count: number;
  attempts: { id: string; attempt_number: number; score: number | null; score_percentage: number | null; submitted_at: string | null }[];
  mastery: OutcomeMasteryReport[];
  questions: { question_id: string; question_number: number; prompt: string; unit: string | null; lesson: string | null; attempts_count: number; answered_count: number; correct_count: number; earned_points: number; possible_points: number }[];
}

interface ReportBranding {
  name: string;
  brandName: string;
  primaryColor: string;
  logoUrl: string | null;
  address: string;
  phone: string;
}

function hexToRgb(value: string): readonly [number, number, number] {
  const normalized = value.replace('#', '').trim();
  const hex = normalized.length === 3 ? normalized.split('').map((part) => `${part}${part}`).join('') : normalized;
  if (!/^[0-9a-f]{6}$/i.test(hex)) return [13, 148, 136];
  return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];
}

async function imageUrlToDataUrl(url: string | null) {
  if (!url || url.startsWith('data:')) return url;
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const blob = await response.blob();
    return await new Promise<string | null>((resolve) => {
      const reader = new FileReader();
      reader.onload = async () => {
        const result = typeof reader.result === 'string' ? reader.result : null;
        if (!result || !result.startsWith('data:image/svg+xml')) { resolve(result); return; }
        const image = new Image();
        image.onload = () => {
          const canvas = document.createElement('canvas');
          canvas.width = image.naturalWidth || 512;
          canvas.height = image.naturalHeight || 512;
          const context = canvas.getContext('2d');
          if (!context) { resolve(null); return; }
          context.drawImage(image, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL('image/png'));
        };
        image.onerror = () => resolve(null);
        image.src = result;
      };
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
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
  const [exporting, setExporting] = useState(false);
  const [reportAnswers, setReportAnswers] = useState<ReportExportAnswer[]>([]);
  const [outcomeMastery, setOutcomeMastery] = useState<OutcomeMasteryReport[]>([]);
  const [outcomeMasteryLoading, setOutcomeMasteryLoading] = useState(false);
  const [outcomeMasteryError, setOutcomeMasteryError] = useState<string | null>(null);
  const [studentReportId, setStudentReportId] = useState('');
  const [studentReport, setStudentReport] = useState<StudentLearningReport | null>(null);
  const [studentReportLoading, setStudentReportLoading] = useState(false);
  const [studentReportError, setStudentReportError] = useState<string | null>(null);
  const [reportBranding, setReportBranding] = useState<ReportBranding>({ name: 'Examify', brandName: 'Examify', primaryColor: '#0D9488', logoUrl: null, address: '', phone: '' });

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

    const { data: institutionData } = await supabase.from('institutions').select('name, logo_url, settings').eq('id', institutionId).maybeSingle();
    const institution = institutionData as { name?: string; logo_url?: string | null; settings?: { brandName?: string; primaryColor?: string; reportAddress?: string; reportPhone?: string } | null } | null;
    const settings = institution?.settings ?? {};
    let logoUrl: string | null = institution?.logo_url ?? null;
    if (logoUrl && !logoUrl.startsWith('http')) {
      const { data: signed } = await supabase.storage.from('public-assets').createSignedUrl(logoUrl, 60 * 60);
      logoUrl = signed?.signedUrl ?? null;
    }
    setReportBranding({
      name: institution?.name ?? 'Examify',
      brandName: settings.brandName ?? institution?.name ?? 'Examify',
      primaryColor: settings.primaryColor ?? '#0D9488',
      logoUrl,
      address: settings.reportAddress ?? '',
      phone: settings.reportPhone ?? '',
    });

    let query = supabase
      .from('exam_attempts')
      .select('id, submitted_at, score, score_percentage, is_passed, is_result_published, status, student_profiles(id, full_name, student_code, phone), examify_exams!inner(id, title, subject_id, total_points, passing_score, subjects(name))')
      .eq('examify_exams.institution_id', institutionId)
      .in('status', ['submitted', 'auto_submitted', 'graded', 'approved']);

    if (filterExam !== 'all') query = query.eq('exam_id', filterExam);
    if (filterSubject !== 'all') query = query.eq('examify_exams.subject_id', filterSubject);
    if (filterStatus !== 'all') query = query.eq('status', filterStatus);
    if (dateFrom) query = query.gte('submitted_at', `${dateFrom}T00:00:00.000Z`);
    if (dateTo) query = query.lte('submitted_at', `${dateTo}T23:59:59.999Z`);

    const { data, error: err } = await query.order('submitted_at', { ascending: false });
    if (err) { console.error('Reports load failed', err); setError(getArabicErrorMessage(err)); setLoading(false); return; }
    const loadedAttempts = (data as unknown as AttemptForReport[]) ?? [];
    setAttempts(loadedAttempts);

    if (loadedAttempts.length === 0) {
      setReportAnswers([]);
      setLoading(false);
      return;
    }

    const attemptIds = loadedAttempts.map((attempt) => attempt.id);
    const { data: answerData, error: answerError } = await supabase
      .from('answers')
      .select('attempt_id, question_id, option_id, text_answer, numeric_answer, is_correct, awarded_points, questions!inner(prompt, type, points)')
      .in('attempt_id', attemptIds)
      .order('created_at', { ascending: true });

    if (answerError) {
      console.error('Report answers load failed', answerError);
      setReportAnswers([]);
      setError(getArabicErrorMessage(answerError));
      setLoading(false);
      return;
    }

    const rawAnswers = (answerData as unknown as Omit<ReportExportAnswer, 'question_number' | 'selected_option_label' | 'correct_option_label'>[]) ?? [];
    const questionIds = [...new Set(rawAnswers.map((answer) => answer.question_id))];
    const { data: optionData, error: optionError } = questionIds.length > 0
      ? await supabase.from('question_options').select('id, question_id, label, is_correct, sort_order').in('question_id', questionIds).order('sort_order', { ascending: true })
      : { data: [], error: null };

    if (optionError) {
      console.error('Report answer options load failed', optionError);
      setReportAnswers([]);
      setError(getArabicErrorMessage(optionError));
      setLoading(false);
      return;
    }

    const examIds = [...new Set(loadedAttempts.map((attempt) => attempt.examify_exams.id))];
    const { data: examQuestionData, error: examQuestionError } = await supabase
      .from('exam_questions')
      .select('exam_id, question_id, sort_order')
      .in('exam_id', examIds)
      .order('sort_order', { ascending: true });
    if (examQuestionError) console.warn('Report question order unavailable', examQuestionError);
    const questionOrderByExam = new Map<string, number>();
    for (const item of (examQuestionData as { exam_id: string; question_id: string; sort_order: number }[]) ?? []) {
      questionOrderByExam.set(`${item.exam_id}:${item.question_id}`, item.sort_order + 1);
    }

    const optionsByQuestion = new Map<string, { id: string; label: string; is_correct: boolean }[]>();
    for (const option of (optionData as { id: string; question_id: string; label: string; is_correct: boolean }[]) ?? []) {
      const options = optionsByQuestion.get(option.question_id) ?? [];
      options.push(option);
      optionsByQuestion.set(option.question_id, options);
    }
    const questionNumbers = new Map<string, number>();
    const normalizedAnswers = rawAnswers.map((answer) => {
      const attempt = loadedAttempts.find((item) => item.id === answer.attempt_id);
      const questionKey = attempt ? `${attempt.examify_exams.id}:${answer.question_id}` : '';
      const fallbackNumber = (questionNumbers.get(answer.attempt_id) ?? 0) + 1;
      questionNumbers.set(answer.attempt_id, fallbackNumber);
      const options = optionsByQuestion.get(answer.question_id) ?? [];
      return {
        ...answer,
        question_number: questionOrderByExam.get(questionKey) ?? fallbackNumber,
        selected_option_label: options.find((option) => option.id === answer.option_id)?.label ?? null,
        correct_option_label: options.find((option) => option.is_correct)?.label ?? null,
      };
    });
    setReportAnswers(normalizedAnswers);
    setLoading(false);
  }, [dateFrom, dateTo, filterExam, filterStatus, filterSubject, institutionId]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (filterExam === 'all') { setOutcomeMastery([]); setOutcomeMasteryError(null); return; }
    let active = true;
    setOutcomeMasteryLoading(true); setOutcomeMasteryError(null);
    void supabase.rpc('get_learning_outcome_mastery', { p_exam_id: filterExam }).then(({ data, error: rpcError }) => {
      if (!active) return;
      if (rpcError) setOutcomeMasteryError(rpcError.message);
      setOutcomeMastery((data as OutcomeMasteryReport[]) ?? []);
      setOutcomeMasteryLoading(false);
    });
    return () => { active = false; };
  }, [filterExam]);

  useEffect(() => {
    if (filterExam === 'all' || !studentReportId) { setStudentReport(null); setStudentReportError(null); return; }
    let active = true;
    setStudentReportLoading(true); setStudentReportError(null);
    void supabase.rpc('get_student_learning_outcome_report', { p_exam_id: filterExam, p_student_id: studentReportId }).then(({ data, error: rpcError }) => {
      if (!active) return;
      if (rpcError) setStudentReportError(rpcError.message);
      setStudentReport((data as StudentLearningReport) ?? null);
      setStudentReportLoading(false);
    });
    return () => { active = false; };
  }, [filterExam, studentReportId]);

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

  const reportStudents = Array.from(new Map(attempts.filter((attempt) => filterExam === 'all' || attempt.examify_exams.id === filterExam).map((attempt) => [attempt.student_profiles?.student_code ?? attempt.student_profiles?.full_name ?? attempt.id, { id: attempt.student_profiles?.id ?? attempt.id, name: attempt.student_profiles?.full_name ?? 'غير محدد', code: attempt.student_profiles?.student_code }])).values());

  // Per-exam breakdown
  const examStats = exams.map((exam) => {
    const examAttempts = published.filter((a) => a.examify_exams.id === exam.id);
    const total = examAttempts.length;
    const examPassed = examAttempts.filter((a) => a.is_passed).length;
    const examAvg = total > 0 ? examAttempts.reduce((s, a) => s + (a.score_percentage ?? 0), 0) / total : 0;
    return { exam, total, passed: examPassed, avg: examAvg };
  }).filter((s) => s.total > 0);

  async function exportExcel() {
    if (exporting || totalAttempts === 0) return;
    setExporting(true);
    setError(null);
    try {
      await exportResultsWorkbook({
        attempts: published,
        examStats,
        answers: reportAnswers.filter((answer) => published.some((attempt) => attempt.id === answer.attempt_id)),
      });
    } catch (exportError) {
      console.error('Excel export failed', exportError);
      setError('تعذر إنشاء ملف Excel. حاول مرة أخرى.');
    } finally {
      setExporting(false);
    }
  }

  async function exportStudentLearningPDF() {
    if (!studentReport || studentReportLoading) return;
    const studentReportSnapshot = studentReport;
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const logoData = await imageUrlToDataUrl(studentReport.institution.logo_url);
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const margin = 14;
    const contentWidth = pageWidth - margin * 2;
    const navy: readonly [number, number, number] = [20, 35, 70];
    const teal: readonly [number, number, number] = hexToRgb(reportBranding.primaryColor);
    const ink: readonly [number, number, number] = [31, 41, 55];
    const muted: readonly [number, number, number] = [100, 116, 139];
    const line: readonly [number, number, number] = [226, 232, 240];
    const pale: readonly [number, number, number] = [248, 250, 252];
    let pageNumber = 1;
    let y = 0;

    function drawArabicText(text: string, rightX: number, baselineY: number, fontSize: number, color: readonly [number, number, number], bold = false, maxWidth = contentWidth) {
      const scale = 4;
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      if (!context) return;
      context.font = `${bold ? '700' : '400'} ${fontSize * scale}px Arial, sans-serif`;
      const measuredWidth = Math.ceil(context.measureText(text).width) + 8 * scale;
      const canvasWidth = Math.max(24, Math.min(Math.ceil(maxWidth * scale), measuredWidth));
      canvas.width = canvasWidth; canvas.height = Math.ceil((fontSize + 5) * scale);
      context.font = `${bold ? '700' : '400'} ${fontSize * scale}px Arial, sans-serif`;
      context.fillStyle = `rgb(${color[0]}, ${color[1]}, ${color[2]})`;
      context.direction = 'rtl'; context.textAlign = 'right'; context.textBaseline = 'alphabetic';
      context.fillText(text, canvasWidth - 4 * scale, fontSize * scale, canvasWidth - 8 * scale);
      pdf.addImage(canvas.toDataURL('image/png'), 'PNG', rightX - canvasWidth / scale, baselineY - fontSize + 1, canvasWidth / scale, (fontSize + 5) / scale);
    }

    function drawHeader() {
      pdf.setFillColor(...navy); pdf.rect(0, 0, pageWidth, 32, 'F');
      if (logoData && !logoData.startsWith('data:image/svg+xml')) pdf.addImage(logoData, logoData.startsWith('data:image/jpeg') ? 'JPEG' : 'PNG', margin, 6, 16, 16);
      pdf.setFillColor(...teal); pdf.rect(0, 29, pageWidth, 3, 'F');
      drawArabicText('تقرير إتقان نواتج التعلم', pageWidth - margin, 17, 15, [255, 255, 255], true);
      drawArabicText(`${studentReportSnapshot.institution.name} · ${studentReportSnapshot.exam.title}`, pageWidth - margin, 25, 8.5, [255, 255, 255]);
      pdf.setTextColor(...muted); pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8); pdf.text(String(pageNumber), margin, pageHeight - 8);
      drawArabicText(studentReportSnapshot.institution.name, pageWidth - margin, pageHeight - 8, 8, muted);
    }
    function newPage() { pdf.addPage(); pageNumber += 1; drawHeader(); y = 40; }
    function ensureSpace(height: number) { if (y + height > pageHeight - 17) newPage(); }

    drawHeader(); y = 42;
    pdf.setDrawColor(...line); pdf.setFillColor(...pale); pdf.roundedRect(margin, y, contentWidth, 34, 3, 3, 'FD');
    drawArabicText('الطالب', pageWidth - margin - 8, y + 9, 8, muted, false, 38);
    drawArabicText(studentReport.student.full_name, pageWidth - margin - 8, y + 19, 12, ink, true, 72);
    drawArabicText(studentReport.student.student_code ? `كود الطالب: ${studentReport.student.student_code}` : 'كود الطالب: —', pageWidth - margin - 8, y + 28, 8, muted, false, 72);
    drawArabicText('الامتحان', pageWidth - margin - 92, y + 9, 8, muted, false, 48);
    drawArabicText(studentReport.exam.title, pageWidth - margin - 92, y + 19, 10, ink, true, 70);
    drawArabicText(`${studentReport.exam.subject_name ?? 'بدون مادة'} · ${studentReport.exam.class_name ?? 'بدون فصل'}`, pageWidth - margin - 92, y + 28, 8, muted, false, 70);
    y += 43;
    drawArabicText(`المحاولات المعتمدة: ${studentReport.eligible_attempt_count}`, pageWidth - margin, y, 9, ink, true);
    y += 9;
    drawArabicText('إتقان نواتج التعلم', pageWidth - margin, y, 12, navy, true); y += 8;
    for (const outcome of studentReport.mastery) {
      ensureSpace(22);
      pdf.setDrawColor(...line); pdf.setFillColor(...pale); pdf.roundedRect(margin, y, contentWidth, 19, 2, 2, 'FD');
      drawArabicText(`${outcome.code} · ${outcome.name_ar}`, pageWidth - margin - 5, y + 7, 9, ink, true, contentWidth - 45);
      drawArabicText(outcome.is_sufficient ? outcome.recommendation : 'بيانات غير كافية', pageWidth - margin - 5, y + 14, 7.5, muted, false, contentWidth - 45);
      pdf.setTextColor(...teal); pdf.setFont('helvetica', 'bold'); pdf.setFontSize(10); pdf.text(outcome.mastery_percentage === null ? '—' : `${Number(outcome.mastery_percentage).toFixed(1)}%`, margin + 9, y + 10);
      y += 23;
    }
    if (!studentReport.mastery.length) { drawArabicText('لا توجد نواتج تعلم مرتبطة بالامتحان.', pageWidth - margin, y + 7, 9, muted); y += 20; }
    y += 3; drawArabicText('الأسئلة الداخلة في الحساب', pageWidth - margin, y, 12, navy, true); y += 8;
    for (const question of studentReport.questions) {
      ensureSpace(23);
      pdf.setDrawColor(...line); pdf.setFillColor(255, 255, 255); pdf.roundedRect(margin, y, contentWidth, 20, 2, 2, 'FD');
      drawArabicText(`#${question.question_number} · ${question.prompt}`, pageWidth - margin - 5, y + 8, 8.5, ink, false, contentWidth - 45);
      drawArabicText(`${question.unit ?? ''}${question.lesson ? ` · ${question.lesson}` : ''}`, pageWidth - margin - 5, y + 15, 7, muted, false, contentWidth - 45);
      pdf.setTextColor(...ink); pdf.setFont('helvetica', 'normal'); pdf.setFontSize(7.5); pdf.text(`${question.correct_count}/${question.answered_count || 0}`, margin + 8, y + 9);
      y += 24;
    }
    if (!studentReport.questions.length) drawArabicText('لا توجد أسئلة معتمدة في الحساب.', pageWidth - margin, y + 7, 9, muted);
    pdf.save(`examify-student-learning-${studentReport.student.student_code ?? studentReport.student.id}-${new Date().toISOString().slice(0, 10)}.pdf`);
  }

  async function exportPDF() {
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const logoData = await imageUrlToDataUrl(reportBranding.logoUrl);
    const brandingLine = [reportBranding.brandName, reportBranding.address, reportBranding.phone].filter(Boolean).join(' · ') || 'Examify';
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const margin = 14;
    const contentWidth = pageWidth - (margin * 2);
    const colors = {
      navy: [20, 35, 70] as const,
      teal: hexToRgb(reportBranding.primaryColor),
      orange: [245, 158, 11] as const,
      ink: [31, 41, 55] as const,
      muted: [100, 116, 139] as const,
      line: [226, 232, 240] as const,
      pale: [248, 250, 252] as const,
      white: [255, 255, 255] as const,
    };

    pdf.setR2L(false);

    function drawArabicText(
      text: string,
      rightX: number,
      baselineY: number,
      fontSize: number,
      color: readonly [number, number, number],
      bold = false,
      maxWidth = contentWidth,
    ) {
      const scale = 4;
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      if (!context) return;
      context.font = `${bold ? '700' : '400'} ${fontSize * scale}px Arial, sans-serif`;
      const measuredWidth = Math.ceil(context.measureText(text).width) + (8 * scale);
      const canvasWidth = Math.max(24, Math.min(Math.ceil(maxWidth * scale), measuredWidth));
      canvas.width = canvasWidth;
      canvas.height = Math.ceil((fontSize + 5) * scale);
      context.font = `${bold ? '700' : '400'} ${fontSize * scale}px Arial, sans-serif`;
      context.fillStyle = `rgb(${color[0]}, ${color[1]}, ${color[2]})`;
      context.direction = 'rtl';
      context.textAlign = 'right';
      context.textBaseline = 'alphabetic';
      context.fillText(text, canvasWidth - (4 * scale), fontSize * scale, canvasWidth - (8 * scale));
      pdf.addImage(canvas.toDataURL('image/png'), 'PNG', rightX - (canvasWidth / scale), baselineY - fontSize + 1, canvasWidth / scale, (fontSize + 5) / scale);
    }

    function drawPageHeader(pageNumber: number) {
      pdf.setFillColor(...colors.navy);
      pdf.rect(0, 0, pageWidth, 34, 'F');
      if (logoData && !logoData.startsWith('data:image/svg+xml')) pdf.addImage(logoData, logoData.startsWith('data:image/jpeg') ? 'JPEG' : 'PNG', margin, 6, 16, 16);
      pdf.setFillColor(...colors.teal);
      pdf.rect(0, 31, pageWidth, 3, 'F');
      drawArabicText(ar.reports.reportTitle, pageWidth - margin, 23, 17, colors.white, true);
      drawArabicText(`${brandingLine} · ${ar.reports.date}: ${new Date().toLocaleDateString('ar-EG')}`, pageWidth - margin, 29, 9, colors.white);
      pdf.setTextColor(...colors.ink);
      pdf.setFontSize(8);
      pdf.text(`${pageNumber}`, margin, pageHeight - 9, { align: 'left' });
      drawArabicText(reportBranding.brandName, pageWidth - margin, pageHeight - 9, 8, colors.ink);
    }

    function drawMetricCard(x: number, y: number, width: number, label: string, value: string, accent: readonly [number, number, number]) {
      pdf.setFillColor(...colors.pale);
      pdf.setDrawColor(...colors.line);
      pdf.roundedRect(x, y, width, 25, 3, 3, 'FD');
      pdf.setFillColor(...accent);
      pdf.roundedRect(x, y, 3, 25, 1.5, 1.5, 'F');
      drawArabicText(label, x + width - 8, y + 9, 8, colors.muted, false, width - 12);
      pdf.setTextColor(...colors.ink);
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(15);
      pdf.text(value, x + width - 8, y + 19, { align: 'right' });
    }

    function drawProgress(x: number, y: number, width: number, value: number) {
      const bounded = Math.max(0, Math.min(100, value));
      pdf.setFillColor(226, 232, 240);
      pdf.roundedRect(x, y, width, 4, 2, 2, 'F');
      const progressColor: readonly [number, number, number] = bounded >= 50 ? colors.teal : [239, 68, 68];
      pdf.setFillColor(...progressColor);
      pdf.roundedRect(x, y, width * (bounded / 100), 4, 2, 2, 'F');
    }

    function drawExamTable(startY: number, currentPage: number) {
      let y = startY;
      const columns = [
        { label: 'الامتحان', width: 76 },
        { label: 'عدد المحاولات', width: 29 },
        { label: 'الناجحون', width: 25 },
        { label: 'المتوسط', width: 32 },
      ];

      function drawTableHeader() {
        pdf.setFillColor(...colors.navy);
        pdf.roundedRect(margin, y, contentWidth, 11, 2, 2, 'F');
        let cursor = pageWidth - margin - 8;
        for (const column of columns) {
          drawArabicText(column.label, cursor, y + 7, 9, colors.white, true, column.width - 8);
          cursor -= column.width;
        }
        y += 11;
      }

      drawTableHeader();
      for (const [index, stat] of examStats.entries()) {
        if (y > pageHeight - 25) {
          pdf.addPage();
          currentPage += 1;
          drawPageHeader(currentPage);
          y = 48;
          drawTableHeader();
        }
        const rowColor: readonly [number, number, number] = index % 2 === 0 ? colors.white : colors.pale;
        pdf.setFillColor(...rowColor);
        pdf.setDrawColor(...colors.line);
        pdf.rect(margin, y, contentWidth, 17, 'FD');
        pdf.setTextColor(...colors.ink);
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(9);
        let cursor = pageWidth - margin - 8;
        drawArabicText(stat.exam.title, cursor, y + 7, 9, colors.ink, false, columns[0].width - 8);
        cursor -= columns[0].width;
        pdf.text(String(stat.total), cursor, y + 7, { align: 'right' });
        cursor -= columns[1].width;
        pdf.text(String(stat.passed), cursor, y + 7, { align: 'right' });
        cursor -= columns[2].width;
        pdf.setFont('helvetica', 'bold');
        pdf.text(`${stat.avg.toFixed(1)}%`, cursor, y + 7, { align: 'right' });
        drawProgress(cursor - 22, y + 11, 22, stat.avg);
        y += 17;
      }
      return currentPage;
    }

    let pageNumber = 1;
    drawPageHeader(pageNumber);
    const cardGap = 4;
    const cardWidth = (contentWidth - (cardGap * 3)) / 4;
    const cardY = 45;
    drawMetricCard(margin, cardY, cardWidth, ar.reports.totalAttempts, String(totalAttempts), colors.teal);
    drawMetricCard(margin + cardWidth + cardGap, cardY, cardWidth, ar.reports.passRate, `${passRate.toFixed(1)}%`, colors.orange);
    drawMetricCard(margin + ((cardWidth + cardGap) * 2), cardY, cardWidth, ar.reports.average, `${avgScore.toFixed(1)}%`, colors.navy);
    drawMetricCard(margin + ((cardWidth + cardGap) * 3), cardY, cardWidth, ar.reports.highestLowest, `${highest.toFixed(1)}% / ${lowest.toFixed(1)}%`, colors.teal);

    drawArabicText(ar.reports.perExamBreakdown, pageWidth - margin, 88, 12, colors.ink, true);
    pdf.setDrawColor(...colors.teal);
    pdf.setLineWidth(1.2);
    pdf.line(pageWidth - margin - 32, 91, pageWidth - margin, 91);
    pageNumber = drawExamTable(98, pageNumber);
    pdf.save(`examify-results-${new Date().toISOString().slice(0, 10)}.pdf`);
  }

  async function exportResponsesPDF() {
    if (totalAttempts === 0) return;
    const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    const logoData = await imageUrlToDataUrl(reportBranding.logoUrl);
    const brandingLine = [reportBranding.brandName, reportBranding.address, reportBranding.phone].filter(Boolean).join(' · ') || 'Examify';
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const margin = 12;
    const contentWidth = pageWidth - (margin * 2);
    const colors = {
      navy: [20, 35, 70] as const,
      teal: hexToRgb(reportBranding.primaryColor),
      orange: [245, 158, 11] as const,
      ink: [31, 41, 55] as const,
      muted: [100, 116, 139] as const,
      line: [226, 232, 240] as const,
      pale: [248, 250, 252] as const,
      white: [255, 255, 255] as const,
      success: [22, 163, 74] as const,
      danger: [220, 38, 38] as const,
      warning: [217, 119, 6] as const,
    };

    pdf.setR2L(false);

    function drawArabicText(
      text: string,
      rightX: number,
      baselineY: number,
      fontSize: number,
      color: readonly [number, number, number],
      bold = false,
      maxWidth = contentWidth,
    ) {
      const scale = 4;
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      if (!context) return;
      context.font = `${bold ? '700' : '400'} ${fontSize * scale}px Arial, sans-serif`;
      const measuredWidth = Math.ceil(context.measureText(text).width) + (8 * scale);
      const canvasWidth = Math.max(24, Math.min(Math.ceil(maxWidth * scale), measuredWidth));
      canvas.width = canvasWidth;
      canvas.height = Math.ceil((fontSize + 5) * scale);
      context.font = `${bold ? '700' : '400'} ${fontSize * scale}px Arial, sans-serif`;
      context.fillStyle = `rgb(${color[0]}, ${color[1]}, ${color[2]})`;
      context.direction = 'rtl';
      context.textAlign = 'right';
      context.textBaseline = 'alphabetic';
      context.fillText(text, canvasWidth - (4 * scale), fontSize * scale, canvasWidth - (8 * scale));
      pdf.addImage(canvas.toDataURL('image/png'), 'PNG', rightX - (canvasWidth / scale), baselineY - fontSize + 1, canvasWidth / scale, (fontSize + 5) / scale);
    }

    function answerText(answer: ReportExportAnswer) {
      if (answer.selected_option_label) return answer.selected_option_label;
      if (answer.text_answer) return answer.text_answer;
      if (answer.numeric_answer != null) return String(answer.numeric_answer);
      return '—';
    }

    function statusText(answer: ReportExportAnswer) {
      if (answer.is_correct === true) return 'صحيحة';
      if (answer.is_correct === false) return 'خطأ';
      return 'مراجعة يدوية';
    }

    const answersByAttempt = new Map<string, ReportExportAnswer[]>();
    for (const answer of reportAnswers) {
      const current = answersByAttempt.get(answer.attempt_id) ?? [];
      current.push(answer);
      answersByAttempt.set(answer.attempt_id, current);
    }

    let pageNumber = 0;
    for (const attempt of published) {
      if (pageNumber > 0) pdf.addPage();
      pageNumber += 1;
      const attemptAnswers = [...(answersByAttempt.get(attempt.id) ?? [])].sort((a, b) => a.question_number - b.question_number);
      const correctCount = attemptAnswers.filter((answer) => answer.is_correct === true).length;
      const reviewCount = attemptAnswers.filter((answer) => answer.is_correct == null).length;

      pdf.setFillColor(...colors.navy);
      pdf.rect(0, 0, pageWidth, 27, 'F');
      if (logoData && !logoData.startsWith('data:image/svg+xml')) pdf.addImage(logoData, logoData.startsWith('data:image/jpeg') ? 'JPEG' : 'PNG', margin, 5, 16, 16);
      pdf.setFillColor(...colors.teal);
      pdf.rect(0, 24, pageWidth, 3, 'F');
      drawArabicText('تقرير استجابات الطلاب', pageWidth - margin, 20, 16, colors.white, true);
      drawArabicText(`${brandingLine} · ${ar.reports.date}: ${new Date().toLocaleDateString('ar-EG')}`, pageWidth - margin, 25, 8, colors.white);

      const cardGap = 4;
      const cardWidth = (contentWidth - (cardGap * 3)) / 4;
      const cardY = 34;
      const cards = [
        { label: 'الطالب', value: attempt.student_profiles?.full_name ?? 'غير محدد', accent: colors.teal, arabicValue: true },
        { label: 'الامتحان', value: attempt.examify_exams.title, accent: colors.navy, arabicValue: true },
        { label: 'النتيجة', value: `${(attempt.score_percentage ?? 0).toFixed(1)}%`, accent: colors.orange, arabicValue: false },
        { label: 'الصحيحة / المراجعة', value: `${correctCount} / ${reviewCount}`, accent: colors.teal, arabicValue: false },
      ];
      for (const [index, card] of cards.entries()) {
        const x = margin + ((cardWidth + cardGap) * index);
        const cardAccent = card.accent as readonly [number, number, number];
        pdf.setFillColor(...colors.pale);
        pdf.setDrawColor(...colors.line);
        pdf.roundedRect(x, cardY, cardWidth, 23, 3, 3, 'FD');
        pdf.setFillColor(...cardAccent);
        pdf.roundedRect(x, cardY, 3, 23, 1.5, 1.5, 'F');
        drawArabicText(card.label, x + cardWidth - 7, cardY + 8, 7.5, colors.muted, false, cardWidth - 12);
        if (card.arabicValue) {
          drawArabicText(card.value, x + cardWidth - 7, cardY + 18, 10, colors.ink, true, cardWidth - 12);
        } else {
          pdf.setTextColor(...colors.ink);
          pdf.setFont('helvetica', 'bold');
          pdf.setFontSize(13);
          pdf.text(card.value, x + cardWidth - 7, cardY + 18, { align: 'right' });
        }
      }

      let y = 67;
      const columns = [
        { key: 'question', label: 'السؤال', width: 108 },
        { key: 'student', label: 'إجابة الطالب', width: 54 },
        { key: 'correct', label: 'الإجابة الصحيحة', width: 54 },
        { key: 'status', label: 'الحالة', width: 35 },
        { key: 'points', label: 'الدرجة', width: 22 },
      ] as const;
      const drawTableHeader = () => {
        pdf.setFillColor(...colors.navy);
        pdf.roundedRect(margin, y, contentWidth, 10, 2, 2, 'F');
        let cursor = pageWidth - margin - 7;
        for (const column of columns) {
          drawArabicText(column.label, cursor, y + 6.5, 8.5, colors.white, true, column.width - 8);
          cursor -= column.width;
        }
        y += 10;
      };
      drawTableHeader();

      for (const [index, answer] of attemptAnswers.entries()) {
        if (y > pageHeight - 20) {
          pdf.addPage();
          pageNumber += 1;
          pdf.setFillColor(...colors.navy);
          pdf.rect(0, 0, pageWidth, 27, 'F');
          if (logoData && !logoData.startsWith('data:image/svg+xml')) pdf.addImage(logoData, logoData.startsWith('data:image/jpeg') ? 'JPEG' : 'PNG', margin, 5, 16, 16);
          pdf.setFillColor(...colors.teal);
          pdf.rect(0, 24, pageWidth, 3, 'F');
          drawArabicText('تقرير استجابات الطلاب', pageWidth - margin, 20, 16, colors.white, true);
          drawArabicText(`${reportBranding.brandName} · الطالب: ${attempt.student_profiles?.full_name ?? 'غير محدد'}`, pageWidth - margin, 25, 8, colors.white);
          y = 34;
          drawTableHeader();
        }
        const rowColor: readonly [number, number, number] = index % 2 === 0 ? colors.white : colors.pale;
        pdf.setFillColor(...rowColor);
        pdf.setDrawColor(...colors.line);
        pdf.rect(margin, y, contentWidth, 14, 'FD');
        let cursor = pageWidth - margin - 7;
        drawArabicText(`${answer.question_number}. ${answer.questions.prompt}`, cursor, y + 8, 7.5, colors.ink, false, columns[0].width - 8);
        cursor -= columns[0].width;
        drawArabicText(answerText(answer), cursor, y + 8, 7.5, colors.ink, false, columns[1].width - 8);
        cursor -= columns[1].width;
        drawArabicText(answer.correct_option_label ?? '—', cursor, y + 8, 7.5, colors.ink, false, columns[2].width - 8);
        cursor -= columns[2].width;
        const statusColor: readonly [number, number, number] = answer.is_correct === true ? colors.success : answer.is_correct === false ? colors.danger : colors.warning;
        pdf.setFillColor(...statusColor);
        pdf.roundedRect(cursor - columns[3].width + 5, y + 3.5, columns[3].width - 10, 7, 3.5, 3.5, 'F');
        drawArabicText(statusText(answer), cursor - 5, y + 8, 7, colors.white, true, columns[3].width - 10);
        cursor -= columns[3].width;
        pdf.setTextColor(...colors.ink);
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(8.5);
        pdf.text(`${answer.awarded_points ?? 0}/${answer.questions.points}`, cursor, y + 8, { align: 'right' });
        y += 14;
      }

      pdf.setTextColor(...colors.muted);
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(8);
      pdf.text(`${pageNumber}`, margin, pageHeight - 8, { align: 'left' });
      drawArabicText(reportBranding.brandName, pageWidth - margin, pageHeight - 8, 8, colors.muted);
    }
    pdf.save(`examify-student-responses-${new Date().toISOString().slice(0, 10)}.pdf`);
  }

  async function exportComparisonPDF() {
    if (totalAttempts === 0) return;
    const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    const logoData = await imageUrlToDataUrl(reportBranding.logoUrl);
    const brandingLine = [reportBranding.brandName, reportBranding.address, reportBranding.phone].filter(Boolean).join(' · ') || 'Examify';
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const margin = 12;
    const contentWidth = pageWidth - (margin * 2);
    const colors = {
      navy: [20, 35, 70] as const,
      teal: hexToRgb(reportBranding.primaryColor),
      orange: [245, 158, 11] as const,
      ink: [31, 41, 55] as const,
      muted: [100, 116, 139] as const,
      line: [226, 232, 240] as const,
      pale: [248, 250, 252] as const,
      white: [255, 255, 255] as const,
      success: [22, 163, 74] as const,
      danger: [220, 38, 38] as const,
      warning: [217, 119, 6] as const,
    };

    pdf.setR2L(false);

    function drawArabicText(
      text: string,
      rightX: number,
      baselineY: number,
      fontSize: number,
      color: readonly [number, number, number],
      bold = false,
      maxWidth = contentWidth,
    ) {
      const scale = 4;
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      if (!context) return;
      context.font = `${bold ? '700' : '400'} ${fontSize * scale}px Arial, sans-serif`;
      const measuredWidth = Math.ceil(context.measureText(text).width) + (8 * scale);
      const canvasWidth = Math.max(24, Math.min(Math.ceil(maxWidth * scale), measuredWidth));
      canvas.width = canvasWidth;
      canvas.height = Math.ceil((fontSize + 5) * scale);
      context.font = `${bold ? '700' : '400'} ${fontSize * scale}px Arial, sans-serif`;
      context.fillStyle = `rgb(${color[0]}, ${color[1]}, ${color[2]})`;
      context.direction = 'rtl';
      context.textAlign = 'right';
      context.textBaseline = 'alphabetic';
      context.fillText(text, canvasWidth - (4 * scale), fontSize * scale, canvasWidth - (8 * scale));
      pdf.addImage(canvas.toDataURL('image/png'), 'PNG', rightX - (canvasWidth / scale), baselineY - fontSize + 1, canvasWidth / scale, (fontSize + 5) / scale);
    }

    const gradeFor = (percentage: number) => percentage >= 90 ? 'A' : percentage >= 80 ? 'B' : percentage >= 70 ? 'C' : percentage >= 60 ? 'D' : 'F';
    const rows = published.map((attempt) => ({
      student: attempt.student_profiles?.full_name ?? 'غير محدد',
      code: attempt.student_profiles?.student_code ?? '—',
      exam: attempt.examify_exams.title,
      subject: attempt.examify_exams.subjects?.name ?? 'بدون مادة',
      score: attempt.score ?? 0,
      percentage: attempt.score_percentage ?? 0,
      grade: gradeFor(attempt.score_percentage ?? 0),
      passed: attempt.is_passed,
    })).sort((a, b) => a.student.localeCompare(b.student, 'ar'));
    const uniqueStudents = new Set(rows.map((row) => row.student)).size;
    const comparisonAverage = rows.length > 0 ? rows.reduce((sum, row) => sum + row.percentage, 0) / rows.length : 0;

    let pageNumber = 0;
    const columns = [
      { label: 'الطالب', width: 62 },
      { label: 'الكود', width: 30 },
      { label: 'الامتحان', width: 70 },
      { label: 'المادة', width: 45 },
      { label: 'الدرجة', width: 22 },
      { label: 'النسبة', width: 26 },
      { label: 'التقدير', width: 18 },
    ] as const;

    const drawPageHeader = (subtitle: string) => {
      pdf.setFillColor(...colors.navy);
      pdf.rect(0, 0, pageWidth, 27, 'F');
      if (logoData && !logoData.startsWith('data:image/svg+xml')) pdf.addImage(logoData, logoData.startsWith('data:image/jpeg') ? 'JPEG' : 'PNG', margin, 5, 16, 16);
      pdf.setFillColor(...colors.teal);
      pdf.rect(0, 24, pageWidth, 3, 'F');
      drawArabicText('تقرير مقارنة التقديرات', pageWidth - margin, 20, 16, colors.white, true);
      drawArabicText(`${brandingLine} · ${subtitle}`, pageWidth - margin, 25, 8, colors.white);
    };

    const drawFooter = () => {
      pdf.setTextColor(...colors.muted);
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(8);
      pdf.text(`${pageNumber}`, margin, pageHeight - 8, { align: 'left' });
      drawArabicText(reportBranding.brandName, pageWidth - margin, pageHeight - 8, 8, colors.muted);
    };

    let y = 34;
    const firstPage = () => {
      const cardGap = 4;
      const cardWidth = (contentWidth - (cardGap * 3)) / 4;
      const cards = [
        { label: 'إجمالي السجلات', value: String(rows.length), accent: colors.teal },
        { label: 'عدد الطلاب', value: String(uniqueStudents), accent: colors.navy },
        { label: 'عدد الامتحانات', value: String(new Set(rows.map((row) => row.exam)).size), accent: colors.orange },
        { label: 'متوسط النتائج', value: `${comparisonAverage.toFixed(1)}%`, accent: colors.teal },
      ];
      for (const [index, card] of cards.entries()) {
        const x = margin + ((cardWidth + cardGap) * index);
        const accent = card.accent as readonly [number, number, number];
        pdf.setFillColor(...colors.pale);
        pdf.setDrawColor(...colors.line);
        pdf.roundedRect(x, y, cardWidth, 23, 3, 3, 'FD');
        pdf.setFillColor(...accent);
        pdf.roundedRect(x, y, 3, 23, 1.5, 1.5, 'F');
        drawArabicText(card.label, x + cardWidth - 7, y + 8, 7.5, colors.muted, false, cardWidth - 12);
        pdf.setTextColor(...colors.ink);
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(13);
        pdf.text(card.value, x + cardWidth - 7, y + 18, { align: 'right' });
      }
      y += 31;
    };

    const drawTableHeader = () => {
      pdf.setFillColor(...colors.navy);
      pdf.roundedRect(margin, y, contentWidth, 10, 2, 2, 'F');
      let cursor = pageWidth - margin - 7;
      for (const column of columns) {
        drawArabicText(column.label, cursor, y + 6.5, 8.5, colors.white, true, column.width - 8);
        cursor -= column.width;
      }
      y += 10;
    };

    pageNumber = 1;
    drawPageHeader(`${ar.reports.date}: ${new Date().toLocaleDateString('ar-EG')}`);
    firstPage();
    drawTableHeader();

    for (const [index, row] of rows.entries()) {
      if (y > pageHeight - 20) {
        drawFooter();
        pdf.addPage();
        pageNumber += 1;
        drawPageHeader('استكمال مقارنة الطلاب والامتحانات');
        y = 34;
        drawTableHeader();
      }
      const rowColor: readonly [number, number, number] = index % 2 === 0 ? colors.white : colors.pale;
      pdf.setFillColor(...rowColor);
      pdf.setDrawColor(...colors.line);
      pdf.rect(margin, y, contentWidth, 14, 'FD');
      let cursor = pageWidth - margin - 7;
      drawArabicText(row.student, cursor, y + 8, 7.5, colors.ink, false, columns[0].width - 8);
      cursor -= columns[0].width;
      drawArabicText(row.code, cursor, y + 8, 7.5, colors.ink, false, columns[1].width - 8);
      cursor -= columns[1].width;
      drawArabicText(row.exam, cursor, y + 8, 7.5, colors.ink, false, columns[2].width - 8);
      cursor -= columns[2].width;
      drawArabicText(row.subject, cursor, y + 8, 7.5, colors.ink, false, columns[3].width - 8);
      cursor -= columns[3].width;
      pdf.setTextColor(...colors.ink);
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(8.5);
      pdf.text(String(row.score), cursor, y + 8, { align: 'right' });
      cursor -= columns[4].width;
      pdf.text(`${row.percentage.toFixed(1)}%`, cursor, y + 8, { align: 'right' });
      cursor -= columns[5].width;
      const statusColor: readonly [number, number, number] = row.passed === true ? colors.success : row.passed === false ? colors.danger : colors.warning;
      pdf.setFillColor(...statusColor);
      pdf.roundedRect(cursor - columns[6].width + 4, y + 3.5, columns[6].width - 8, 7, 3.5, 3.5, 'F');
      drawArabicText(row.passed == null ? 'مراجعة' : row.passed ? row.grade : 'راسب', cursor - 4, y + 8, 7, colors.white, true, columns[6].width - 8);
      y += 14;
    }
    drawFooter();
    pdf.save(`examify-grade-comparison-${new Date().toISOString().slice(0, 10)}.pdf`);
  }

  if (loading) return <div className="flex justify-center py-16"><Loader2 size={24} className="animate-spin text-brand-600" /></div>;

  return (
    <div className="space-y-5">
      <SectionHeader
        title={ar.reports.title}
        subtitle={ar.reports.subtitle}
        action={
          <div className="flex gap-2">
            <button data-testid="reports-export-excel" onClick={() => void exportExcel()} disabled={totalAttempts === 0 || exporting} className="btn-outline disabled:opacity-40"><FileSpreadsheet size={16} /> {exporting ? 'جاري التصدير...' : 'Excel'}</button>
            <button data-testid="reports-export-pdf" onClick={exportPDF} disabled={totalAttempts === 0} className="btn-outline disabled:opacity-40"><Download size={16} /> PDF</button>
            <button data-testid="reports-export-responses-pdf" onClick={exportResponsesPDF} disabled={totalAttempts === 0 || reportAnswers.length === 0} className="btn-outline disabled:opacity-40"><Download size={16} /> استجابات PDF</button>
            <button data-testid="reports-export-comparison-pdf" onClick={exportComparisonPDF} disabled={totalAttempts === 0} className="btn-outline disabled:opacity-40"><Download size={16} /> مقارنة PDF</button>
          </div>
        }
      />

      {error && (
        <div className="flex items-center gap-2 p-3 rounded-xl bg-danger-50 border border-danger-200">
          <AlertCircle size={18} className="text-danger-600" />
          <p className="text-sm text-danger-700">{error}</p>
        </div>
      )}

      <Card className="p-5">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-700 text-ink-900">تصفية التقارير</h3>
            <p className="mt-1 text-sm text-ink-500">حدد نطاق البيانات التي تريد عرضها.</p>
          </div>
          <button type="button" onClick={() => { setFilterExam('all'); setFilterSubject('all'); setFilterStatus('all'); setDateFrom(''); setDateTo(''); }} className="btn-ghost !min-h-10 !px-3 !py-2 !text-sm">
            مسح الفلاتر
          </button>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <div>
            <label className="label !mb-1.5 !text-sm">الامتحان</label>
            <DropdownSelect
              testId="reports-filter-exam"
              value={filterExam}
              onValueChange={setFilterExam}
              ariaLabel="الامتحان"
              options={[{ value: 'all', label: ar.reports.allExams }, ...exams.map((exam) => ({ value: exam.id, label: exam.title }))]}
            />
          </div>
          <div>
            <label className="label !mb-1.5 !text-sm">المادة</label>
            <DropdownSelect
              testId="reports-filter-subject"
              value={filterSubject}
              onValueChange={setFilterSubject}
              ariaLabel="المادة"
              options={[{ value: 'all', label: 'جميع المواد' }, ...subjects.filter(([id]) => Boolean(id)).map(([id, name]) => ({ value: id as string, label: name }))]}
            />
          </div>
          <div>
            <label className="label !mb-1.5 !text-sm">الحالة</label>
            <DropdownSelect
              testId="reports-filter-status"
              value={filterStatus}
              onValueChange={setFilterStatus}
              ariaLabel="الحالة"
              options={[
                { value: 'all', label: 'جميع الحالات' },
                { value: 'submitted', label: 'بانتظار التصحيح' },
                { value: 'auto_submitted', label: 'مسلّم تلقائيًا' },
                { value: 'graded', label: 'تم التصحيح' },
                { value: 'approved', label: 'معتمد' },
              ]}
            />
          </div>
          <div>
            <label className="label !mb-1.5 !text-sm">من تاريخ</label>
            <input data-testid="reports-date-from" type="date" className="input !h-12 !py-3 !text-base" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          </div>
          <div>
            <label className="label !mb-1.5 !text-sm">إلى تاريخ</label>
            <input data-testid="reports-date-to" type="date" className="input !h-12 !py-3 !text-base" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          </div>
        </div>
      </Card>

      {filterExam !== 'all' && <Card className="space-y-4 p-5" data-testid="student-learning-report">
        <SectionHeader title="تقرير طالب مستقل" subtitle="يعرض فقط بيانات الطالب المسموح بها والنتائج المنشورة والمعتمدة." />
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <label className="w-full space-y-1.5 sm:max-w-md"><span className="label mb-0">اختيار الطالب</span><DropdownSelect testId="student-report-select" value={studentReportId} onValueChange={setStudentReportId} ariaLabel="اختيار الطالب للتقرير" options={[{ value: '', label: 'اختر طالبًا' }, ...reportStudents.map((student) => ({ value: student.id, label: student.code ? `${student.name} — ${student.code}` : student.name }))]} /></label>
          <button type="button" data-testid="student-report-export-pdf" onClick={() => void exportStudentLearningPDF()} disabled={!studentReport || studentReportLoading} className="btn-primary disabled:opacity-40"><Download size={16} /> تنزيل تقرير الطالب PDF</button>
        </div>
        {studentReportError && <p className="text-sm text-danger-700">تعذر تحميل تقرير الطالب: {studentReportError}</p>}
        {studentReportLoading && <div className="flex justify-center py-6"><Loader2 size={22} className="animate-spin text-brand-600" /></div>}
        {studentReport && !studentReportLoading && <div className="space-y-4 rounded-2xl border border-ink-100 bg-ink-50/60 p-4"><div className="grid gap-3 sm:grid-cols-3"><div><span className="text-xs text-ink-500">الطالب</span><strong className="mt-1 block">{studentReport.student.full_name}</strong></div><div><span className="text-xs text-ink-500">الامتحان</span><strong className="mt-1 block">{studentReport.exam.title}</strong></div><div><span className="text-xs text-ink-500">المحاولات المعتمدة</span><strong className="mt-1 block nums-latin">{studentReport.eligible_attempt_count}</strong></div></div><div className="grid gap-3 md:grid-cols-2">{studentReport.mastery.map((outcome) => <div key={outcome.learning_outcome_id} className="rounded-xl border border-ink-100 bg-white p-3"><div className="flex items-center justify-between gap-2"><span className="font-700">{outcome.code} · {outcome.name_ar}</span><Badge tone={outcome.is_sufficient ? 'accent' : 'neutral'}>{outcome.mastery_percentage === null ? 'بيانات غير كافية' : `${Number(outcome.mastery_percentage).toFixed(1)}%`}</Badge></div><ProgressBar value={outcome.mastery_percentage ?? 0} tone="brand" className="mt-2" /><p className="mt-2 text-xs text-ink-500">{outcome.is_sufficient ? outcome.recommendation : 'يلزم عدد أكبر من المحاولات لبناء استنتاج موثوق.'}</p></div>)}</div><p className="text-xs text-ink-500">تم بناء التقرير من {studentReport.questions.length} سؤالًا معتمدًا في الحساب، ولا يشمل المحاولات غير المنشورة أو التي تحتاج مراجعة.</p></div>}
      </Card>}

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

          {filterExam !== 'all' && <Card className="p-5" data-testid="reports-learning-outcomes">
            <SectionHeader title="تقرير إتقان نواتج التعلم" subtitle="ملخص الفصل/الامتحان من النتائج المنشورة والمعتمدة فقط." />
            {outcomeMasteryError && <p className="text-sm text-danger-700">تعذر تحميل التقرير: {outcomeMasteryError}</p>}
            {outcomeMasteryLoading && <div className="flex justify-center py-6"><Loader2 size={22} className="animate-spin text-brand-600" /></div>}
            {!outcomeMasteryLoading && !outcomeMasteryError && (outcomeMastery.length ? <div className="grid gap-3 md:grid-cols-2">{outcomeMastery.map((outcome) => <div key={outcome.learning_outcome_id} className="rounded-xl border border-ink-100 bg-ink-50 p-4"><div className="flex items-start justify-between gap-3"><div><div className="flex items-center gap-2"><Badge tone="brand">{outcome.code}</Badge><strong>{outcome.name_ar}</strong></div><p className="mt-2 text-xs text-ink-500">{outcome.question_count} أسئلة · {outcome.attempt_count} محاولات · {outcome.answered_count} إجابة محسوبة</p></div><Badge tone={outcome.is_sufficient ? (outcome.mastery_percentage ?? 0) >= 70 ? 'accent' : (outcome.mastery_percentage ?? 0) < 50 ? 'danger' : 'warning' : 'neutral'}>{outcome.is_sufficient ? outcome.recommendation : 'بيانات غير كافية'}</Badge></div><div className="mt-3 flex items-center gap-3"><ProgressBar value={outcome.mastery_percentage ?? 0} tone="brand" className="flex-1" /><strong className="nums-latin">{outcome.mastery_percentage === null ? '—' : `${Number(outcome.mastery_percentage).toFixed(1)}%`}</strong></div></div>)}</div> : <EmptyState title="لا توجد نواتج مرتبطة" subtitle="اربط الأسئلة بنواتج تعلم وانشر النتائج المعتمدة لظهور التقرير." />)}
          </Card>}
        </>
      )}
    </div>
  );
}
