export interface ReportExportAttempt {
  id: string;
  submitted_at: string | null;
  score: number | null;
  score_percentage: number | null;
  is_passed: boolean | null;
  is_result_published: boolean;
  status: string;
  examify_exams: {
    id: string;
    title: string;
    total_points: number;
    passing_score: number;
    subjects?: { name: string } | null;
  };
  student_profiles?: {
    full_name: string;
    student_code: string | null;
    phone: string | null;
  } | null;
}

export interface ReportExportExamStat {
  exam: ReportExportAttempt['examify_exams'];
  total: number;
  passed: number;
  avg: number;
}

export interface ReportExportAnswer {
  attempt_id: string;
  question_id: string;
  question_number: number;
  option_id: string | null;
  text_answer: string | null;
  numeric_answer: number | null;
  is_correct: boolean | null;
  awarded_points: number | null;
  questions: {
    prompt: string;
    type: string;
    points: number;
  };
  selected_option_label: string | null;
  correct_option_label: string | null;
}

interface ReportExportOptions {
  attempts: ReportExportAttempt[];
  examStats: ReportExportExamStat[];
  answers?: ReportExportAnswer[];
  generatedAt?: Date;
}

const COLORS = {
  brand: '0B78D0',
  ink: '1F2937',
  muted: '64748B',
  light: 'EAF2F8',
  success: 'DCFCE7',
  danger: 'FEE2E2',
};

function styleTitle(row: { height?: number; eachCell: (callback: (cell: { fill: unknown; font: unknown; alignment: unknown }) => void) => void }) {
  row.height = 28;
  row.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.brand } };
    cell.font = { name: 'Arial', size: 16, bold: true, color: { argb: 'FFFFFF' } };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
  });
}

function styleHeader(row: { height?: number; eachCell: (callback: (cell: { fill: unknown; font: unknown; alignment: unknown; border: unknown }) => void) => void }) {
  row.height = 24;
  row.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.light } };
    cell.font = { name: 'Arial', size: 10, bold: true, color: { argb: COLORS.ink } };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    cell.border = {
      top: { style: 'thin', color: { argb: 'CBD5E1' } },
      bottom: { style: 'thin', color: { argb: 'CBD5E1' } },
      left: { style: 'thin', color: { argb: 'CBD5E1' } },
      right: { style: 'thin', color: { argb: 'CBD5E1' } },
    };
  });
}

function styleBody(row: { eachCell: (callback: (cell: { font: unknown; alignment: unknown; border: unknown }) => void) => void }) {
  row.eachCell((cell) => {
    cell.font = { name: 'Arial', size: 10, color: { argb: COLORS.ink } };
    cell.alignment = { horizontal: 'right', vertical: 'middle' };
    cell.border = {
      bottom: { style: 'hair', color: { argb: 'E2E8F0' } },
    };
  });
}

function downloadWorkbook(buffer: unknown, filename: string) {
  const blob = new Blob([buffer as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export async function exportResultsWorkbook({ attempts, examStats, answers = [], generatedAt = new Date() }: ReportExportOptions) {
  const { Workbook: WorkbookConstructor } = await import('exceljs');
  const workbook = new WorkbookConstructor();
  workbook.creator = 'Examify';
  workbook.created = generatedAt;
  workbook.modified = generatedAt;

  const summary = workbook.addWorksheet('ملخص النتائج', { views: [{ rightToLeft: true }] });
  summary.columns = [
    { key: 'name', width: 30 },
    { key: 'code', width: 16 },
    { key: 'phone', width: 18 },
    { key: 'exam', width: 28 },
    { key: 'subject', width: 18 },
    { key: 'status', width: 16 },
    { key: 'score', width: 12 },
    { key: 'percentage', width: 14 },
    { key: 'grade', width: 12 },
    { key: 'passed', width: 12 },
    { key: 'submittedAt', width: 22 },
  ];
  summary.mergeCells('A1:K1');
  summary.getCell('A1').value = 'تقرير نتائج الطلاب';
  styleTitle(summary.getRow(1));
  summary.mergeCells('A2:K2');
  summary.getCell('A2').value = `تاريخ الإنشاء: ${generatedAt.toLocaleString('ar-EG')}`;
  summary.getCell('A2').font = { name: 'Arial', size: 10, color: { argb: COLORS.muted } };
  summary.getCell('A2').alignment = { horizontal: 'right' };

  const total = attempts.length;
  const passed = attempts.filter((attempt) => attempt.is_passed === true).length;
  const average = total > 0 ? attempts.reduce((sum, attempt) => sum + (attempt.score_percentage ?? 0), 0) / total : 0;
  const highest = total > 0 ? Math.max(...attempts.map((attempt) => attempt.score_percentage ?? 0)) : 0;
  const lowest = total > 0 ? Math.min(...attempts.map((attempt) => attempt.score_percentage ?? 0)) : 0;
  summary.addRows([
    [],
    ['إجمالي المحاولات', total, 'ناجح', passed, 'نسبة النجاح', total > 0 ? passed / total : 0, 'المتوسط', average / 100, 'الأعلى', highest / 100, 'الأقل', lowest / 100],
  ]);
  const kpiRow = summary.getRow(4);
  kpiRow.font = { name: 'Arial', size: 10, bold: true, color: { argb: COLORS.ink } };
  kpiRow.alignment = { horizontal: 'center', vertical: 'middle' };
  kpiRow.eachCell((cell, columnNumber) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: columnNumber % 2 === 0 ? 'FFFFFF' : COLORS.light } };
  });
  for (const cell of ['F4', 'H4', 'J4', 'L4']) summary.getCell(cell).numFmt = '0.00%';

  const headerRow = summary.addRow(['اسم الطالب', 'كود الطالب', 'هاتف الطالب', 'الامتحان', 'المادة', 'الحالة', 'الدرجة', 'النسبة المئوية', 'التقدير', 'ناجح', 'تاريخ التسليم']);
  styleHeader(headerRow);
  for (const attempt of attempts) {
    const percentage = attempt.score_percentage ?? 0;
    const row = summary.addRow({
      name: attempt.student_profiles?.full_name ?? 'غير معروف',
      code: attempt.student_profiles?.student_code ?? '',
      phone: attempt.student_profiles?.phone ?? '',
      exam: attempt.examify_exams.title,
      subject: attempt.examify_exams.subjects?.name ?? 'بدون مادة',
      status: attempt.status,
      score: attempt.score ?? 0,
      percentage: percentage / 100,
      grade: percentage >= 90 ? 'A' : percentage >= 80 ? 'B' : percentage >= 70 ? 'C' : percentage >= 60 ? 'D' : 'F',
      passed: attempt.is_passed === true ? 'نعم' : 'لا',
      submittedAt: attempt.submitted_at ? new Date(attempt.submitted_at).toLocaleString('ar-EG') : '',
    });
    styleBody(row);
    row.getCell('H').numFmt = '0.00%';
    row.getCell('J').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: attempt.is_passed === true ? COLORS.success : COLORS.danger } };
  }
  summary.autoFilter = { from: 'A5', to: 'K5' };
  summary.views = [{ state: 'frozen', ySplit: 5, rightToLeft: true }];

  const exams = workbook.addWorksheet('ملخص الامتحانات', { views: [{ rightToLeft: true }] });
  exams.columns = [
    { key: 'exam', width: 32 },
    { key: 'subject', width: 22 },
    { key: 'attempts', width: 14 },
    { key: 'passed', width: 14 },
    { key: 'passRate', width: 16 },
    { key: 'average', width: 16 },
  ];
  exams.mergeCells('A1:F1');
  exams.getCell('A1').value = 'ملخص أداء الامتحانات';
  styleTitle(exams.getRow(1));
  const examHeader = exams.addRow(['الامتحان', 'المادة', 'عدد الطلاب', 'الناجحون', 'نسبة النجاح', 'متوسط النتيجة']);
  styleHeader(examHeader);
  for (const stat of examStats) {
    const row = exams.addRow({
      exam: stat.exam.title,
      subject: stat.exam.subjects?.name ?? 'بدون مادة',
      attempts: stat.total,
      passed: stat.passed,
      passRate: stat.total > 0 ? stat.passed / stat.total : 0,
      average: stat.avg / 100,
    });
    styleBody(row);
    row.getCell('E').numFmt = '0.00%';
    row.getCell('F').numFmt = '0.00%';
  }
  exams.views = [{ state: 'frozen', ySplit: 2, rightToLeft: true }];

  const attemptsById = new Map(attempts.map((attempt) => [attempt.id, attempt]));
  const answersByAttempt = new Map<string, ReportExportAnswer[]>();
  for (const answer of answers) {
    const current = answersByAttempt.get(answer.attempt_id) ?? [];
    current.push(answer);
    answersByAttempt.set(answer.attempt_id, current);
  }

  const responses = workbook.addWorksheet('إجابات الطلاب', { views: [{ rightToLeft: true }] });
  responses.columns = [
    { key: 'student', width: 30 },
    { key: 'exam', width: 28 },
    { key: 'number', width: 10 },
    { key: 'question', width: 42 },
    { key: 'studentAnswer', width: 20 },
    { key: 'correctAnswer', width: 20 },
    { key: 'status', width: 16 },
    { key: 'score', width: 12 },
    { key: 'points', width: 12 },
    { key: 'confidence', width: 16 },
  ];
  responses.mergeCells('A1:J1');
  responses.getCell('A1').value = 'تقرير إجابات الطلاب';
  styleTitle(responses.getRow(1));
  responses.mergeCells('A2:J2');
  responses.getCell('A2').value = 'يشمل الإجابة التي تم رصدها، مفتاح الإجابة، وحالة التصحيح لكل سؤال.';
  responses.getCell('A2').font = { name: 'Arial', size: 10, color: { argb: COLORS.muted } };
  responses.getCell('A2').alignment = { horizontal: 'right' };
  const responseHeader = responses.addRow(['اسم الطالب', 'الامتحان', 'رقم السؤال', 'السؤال', 'إجابة الطالب', 'الإجابة الصحيحة', 'الحالة', 'الدرجة', 'النقاط الممكنة', 'ملاحظة']);
  styleHeader(responseHeader);
  for (const answer of answers) {
    const attempt = attemptsById.get(answer.attempt_id);
    const hasResponse = Boolean(answer.selected_option_label || answer.text_answer || answer.numeric_answer != null);
    const status = answer.is_correct === true ? 'صحيحة' : answer.is_correct === false ? 'خطأ' : hasResponse ? 'تحتاج مراجعة' : 'غير مجاب';
    const row = responses.addRow({
      student: attempt?.student_profiles?.full_name ?? 'غير معروف',
      exam: attempt?.examify_exams.title ?? '',
      number: answer.question_number,
      question: answer.questions.prompt,
      studentAnswer: answer.selected_option_label ?? answer.text_answer ?? (answer.numeric_answer != null ? String(answer.numeric_answer) : ''),
      correctAnswer: answer.correct_option_label ?? '',
      status,
      score: answer.awarded_points ?? 0,
      points: answer.questions.points,
      confidence: answer.is_correct === true ? 'عالية' : answer.is_correct === false ? 'عالية' : 'مراجعة',
    });
    styleBody(row);
    row.getCell('G').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: answer.is_correct === true ? COLORS.success : answer.is_correct === false ? COLORS.danger : 'FEF3C7' } };
  }
  responses.autoFilter = { from: 'A4', to: 'J4' };
  responses.views = [{ state: 'frozen', ySplit: 4, rightToLeft: true }];

  const frequency = workbook.addWorksheet('التوزيع التكراري', { views: [{ rightToLeft: true }] });
  frequency.columns = [
    { key: 'exam', width: 32 },
    { key: 'grade', width: 12 },
    { key: 'range', width: 18 },
    { key: 'count', width: 14 },
    { key: 'percentage', width: 16 },
  ];
  frequency.mergeCells('A1:E1');
  frequency.getCell('A1').value = 'تقرير التوزيع التكراري للدرجات';
  styleTitle(frequency.getRow(1));
  const frequencyHeader = frequency.addRow(['الامتحان', 'التقدير', 'النطاق', 'عدد الطلاب', 'النسبة المئوية']);
  styleHeader(frequencyHeader);
  const gradeBands = [
    { grade: 'A', range: '90% فأعلى', min: 90 },
    { grade: 'B', range: '80% - 89.99%', min: 80 },
    { grade: 'C', range: '70% - 79.99%', min: 70 },
    { grade: 'D', range: '60% - 69.99%', min: 60 },
    { grade: 'F', range: 'أقل من 60%', min: 0 },
  ];
  for (const stat of examStats) {
    const examAttempts = attempts.filter((attempt) => attempt.examify_exams.id === stat.exam.id);
    for (const [index, band] of gradeBands.entries()) {
      const upper = index === 0 ? Infinity : gradeBands[index - 1].min;
      const count = examAttempts.filter((attempt) => {
        const percentage = attempt.score_percentage ?? 0;
        return percentage >= band.min && percentage < upper;
      }).length;
      const row = frequency.addRow({ exam: stat.exam.title, grade: band.grade, range: band.range, count, percentage: stat.total > 0 ? count / stat.total : 0 });
      styleBody(row);
      row.getCell('E').numFmt = '0.00%';
    }
  }
  frequency.views = [{ state: 'frozen', ySplit: 2, rightToLeft: true }];

  const questionStats = workbook.addWorksheet('تحليل الأسئلة', { views: [{ rightToLeft: true }] });
  questionStats.columns = [
    { key: 'exam', width: 28 },
    { key: 'number', width: 10 },
    { key: 'question', width: 42 },
    { key: 'attempts', width: 14 },
    { key: 'correct', width: 14 },
    { key: 'incorrect', width: 14 },
    { key: 'unanswered', width: 14 },
    { key: 'needsReview', width: 16 },
    { key: 'correctPercentage', width: 18 },
  ];
  questionStats.mergeCells('A1:I1');
  questionStats.getCell('A1').value = 'تقرير تحليل الأسئلة';
  styleTitle(questionStats.getRow(1));
  const questionHeader = questionStats.addRow(['الامتحان', 'رقم السؤال', 'السؤال', 'عدد المحاولات', 'الصحيح', 'الخطأ', 'غير مجاب', 'تحتاج مراجعة', 'نسبة الإجابة الصحيحة']);
  styleHeader(questionHeader);
  const questionGroups = new Map<string, { exam: string; number: number; prompt: string; attempts: number; correct: number; incorrect: number; unanswered: number; needsReview: number }>();
  for (const answer of answers) {
    const attempt = attemptsById.get(answer.attempt_id);
    if (!attempt) continue;
    const key = `${attempt.examify_exams.id}:${answer.question_id}`;
    const metric = questionGroups.get(key) ?? { exam: attempt.examify_exams.title, number: answer.question_number, prompt: answer.questions.prompt, attempts: 0, correct: 0, incorrect: 0, unanswered: 0, needsReview: 0 };
    metric.attempts += 1;
    if (answer.is_correct === true) metric.correct += 1;
    else if (answer.is_correct === false) metric.incorrect += 1;
    else if (!answer.selected_option_label && !answer.text_answer && answer.numeric_answer == null) metric.unanswered += 1;
    else metric.needsReview += 1;
    questionGroups.set(key, metric);
  }
  for (const metric of questionGroups.values()) {
    const row = questionStats.addRow({
      exam: metric.exam,
      number: metric.number,
      question: metric.prompt,
      attempts: metric.attempts,
      correct: metric.correct,
      incorrect: metric.incorrect,
      unanswered: metric.unanswered,
      needsReview: metric.needsReview,
      correctPercentage: metric.attempts > 0 ? metric.correct / metric.attempts : 0,
    });
    styleBody(row);
    row.getCell('I').numFmt = '0.00%';
  }
  questionStats.autoFilter = { from: 'A2', to: 'I2' };
  questionStats.views = [{ state: 'frozen', ySplit: 2, rightToLeft: true }];

  const progress = workbook.addWorksheet('إنجاز الطلاب', { views: [{ rightToLeft: true }] });
  progress.columns = [
    { key: 'student', width: 30 },
    { key: 'exam', width: 28 },
    { key: 'score', width: 14 },
    { key: 'percentage', width: 16 },
    { key: 'answered', width: 14 },
    { key: 'correct', width: 14 },
    { key: 'review', width: 16 },
    { key: 'gap', width: 16 },
  ];
  progress.mergeCells('A1:H1');
  progress.getCell('A1').value = 'تقرير إنجاز الطلاب';
  styleTitle(progress.getRow(1));
  const progressHeader = progress.addRow(['اسم الطالب', 'الامتحان', 'الدرجة', 'النسبة المئوية', 'الإجابات', 'الإجابات الصحيحة', 'تحتاج مراجعة', 'الفارق عن المتوسط']);
  styleHeader(progressHeader);
  for (const attempt of attempts) {
    const attemptAnswers = answersByAttempt.get(attempt.id) ?? [];
    const percentage = attempt.score_percentage ?? 0;
    const row = progress.addRow({
      student: attempt.student_profiles?.full_name ?? 'غير معروف',
      exam: attempt.examify_exams.title,
      score: attempt.score ?? 0,
      percentage: percentage / 100,
      answered: attemptAnswers.filter((answer) => answer.selected_option_label || answer.text_answer || answer.numeric_answer != null).length,
      correct: attemptAnswers.filter((answer) => answer.is_correct === true).length,
      review: attemptAnswers.filter((answer) => answer.is_correct === null && (answer.selected_option_label || answer.text_answer || answer.numeric_answer != null)).length,
      gap: (percentage - (examStats.find((stat) => stat.exam.id === attempt.examify_exams.id)?.avg ?? percentage)) / 100,
    });
    styleBody(row);
    row.getCell('D').numFmt = '0.00%';
    row.getCell('H').numFmt = '0.00%';
  }
  progress.autoFilter = { from: 'A2', to: 'H2' };
  progress.views = [{ state: 'frozen', ySplit: 2, rightToLeft: true }];

  const buffer = await workbook.xlsx.writeBuffer();
  downloadWorkbook(buffer, `examify-results-${generatedAt.toISOString().slice(0, 10)}.xlsx`);
}
