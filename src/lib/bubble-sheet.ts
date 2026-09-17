import jsPDF from 'jspdf';
import QRCode from 'qrcode';

export interface BubbleSheetConfig {
  examId: string;
  examTitle: string;
  modelLabel: string;
  questionsCount: number;
  choicesCount: number;
  layoutSchemaVersion?: number;
  snapshotId?: string;
  templateVersion?: number;
  studentName?: string;
  studentCode?: string;
  institutionName?: string;
  includeStudentId: boolean;
  includeStudentName: boolean;
  includeQr: boolean;
  qrToken?: string;
  pageSize?: 'A4';
  sections?: BubbleSheetSection[];
  questions?: BubbleSheetSourceQuestion[];
  layout?: BubbleSheetLayout;
}

export interface BubbleSheetSection {
  title: string;
  questionsCount: number;
}

export interface BubbleSheetSourceOption { id: string; label: string; sortOrder: number; }
export interface BubbleSheetSourceQuestion {
  examQuestionId: string;
  questionId: string;
  questionType: string;
  points: number;
  sortOrder: number;
  options: BubbleSheetSourceOption[];
}

export interface NormalizedRect { x: number; y: number; width: number; height: number; }
export interface BubbleSheetLayoutOption {
  snapshotOptionId?: string;
  optionId?: string;
  label: string;
  canonicalOptionOrdinal?: number;
  visualIndex: number;
  rect: NormalizedRect;
}
export interface BubbleSheetLayoutQuestion {
  examQuestionId?: string;
  questionId?: string;
  snapshotQuestionId?: string;
  questionType?: string;
  points?: number;
  globalQuestionNumber: number;
  sectionVisualIndex: number;
  sectionQuestionNumber: number;
  pageNumber: number;
  rect: NormalizedRect;
  options: BubbleSheetLayoutOption[];
}
export interface BubbleSheetLayoutSection {
  sectionKey: string;
  title: string;
  visualIndex: number;
  questionStartIndex: number;
  questionCount: number;
  pageNumber: number;
  rect: NormalizedRect;
}
export interface BubbleSheetLayout {
  layoutSchemaVersion?: number;
  snapshotId?: string;
  examId?: string;
  pageWidthMm: number;
  pageHeightMm: number;
  orientation: 'portrait' | 'landscape';
  pageCount: number;
  pageIdentityRegion?: NormalizedRect;
  pageIdentities?: Array<{ pageIndex: number; pageCount: number; layoutSchemaVersion: number; pageToken: string }>;
  sections: BubbleSheetLayoutSection[];
  questions: BubbleSheetLayoutQuestion[];
}

export interface FinalizedBubbleSheetLayoutPayload {
  layout_schema_version: number;
  snapshot_id: string;
  exam_id: string;
  page_width_mm: number;
  page_height_mm: number;
  orientation: 'portrait' | 'landscape';
  page_count: number;
  page_identity_region?: NormalizedRect;
  pages?: Array<{ page_index: number; page_count: number; layout_schema_version: number; page_token: string }>;
  sections: Array<{
    snapshot_section_id: string;
    section_key: string;
    title: string | null;
    visual_index: number;
    question_start_index: number;
    question_count: number;
    page_number: number;
    rect: NormalizedRect;
  }>;
  questions: Array<{
    snapshot_question_id: string;
    exam_question_id: string | null;
    question_id: string;
    question_type: string | null;
    points: number | null;
    question_ordinal: number | null;
    global_question_number: number;
    section_visual_index: number;
    section_question_number: number;
    page_number: number;
    rect: NormalizedRect;
    options: Array<{
      snapshot_option_id: string;
      option_id: string;
      label: string;
      canonical_option_ordinal: number | null;
      visual_index: number;
      rect: NormalizedRect;
    }>;
  }>;
}

export function finalizedSnapshotToLayout(payload: FinalizedBubbleSheetLayoutPayload): BubbleSheetLayout {
  return {
    layoutSchemaVersion: payload.layout_schema_version,
    snapshotId: payload.snapshot_id,
    examId: payload.exam_id,
    pageWidthMm: payload.page_width_mm,
    pageHeightMm: payload.page_height_mm,
    orientation: payload.orientation,
    pageCount: payload.page_count,
    pageIdentityRegion: payload.page_identity_region,
    pageIdentities: payload.pages?.map((page) => ({ pageIndex: page.page_index, pageCount: page.page_count, layoutSchemaVersion: page.layout_schema_version, pageToken: page.page_token })),
    sections: payload.sections.map((section) => ({
      sectionKey: section.section_key,
      title: section.title ?? '',
      visualIndex: section.visual_index,
      questionStartIndex: section.question_start_index,
      questionCount: section.question_count,
      pageNumber: section.page_number,
      rect: section.rect,
    })),
    questions: payload.questions.map((question) => ({
      snapshotQuestionId: question.snapshot_question_id,
      examQuestionId: question.exam_question_id ?? undefined,
      questionId: question.question_id,
      questionType: question.question_type ?? undefined,
      points: question.points ?? undefined,
      globalQuestionNumber: question.global_question_number,
      sectionVisualIndex: question.section_visual_index,
      sectionQuestionNumber: question.section_question_number,
      pageNumber: question.page_number,
      rect: question.rect,
      options: question.options.map((option) => ({
        snapshotOptionId: option.snapshot_option_id,
        optionId: option.option_id,
        label: option.label,
        canonicalOptionOrdinal: option.canonical_option_ordinal ?? undefined,
        visualIndex: option.visual_index,
        rect: option.rect,
      })),
    })),
  };
}

const CHOICE_LABELS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

export const BUBBLE_SHEET_MODEL_LABELS = ['A', 'B', 'C', 'D'] as const;

function stableHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/**
 * Returns canonical option indexes in their visual order for a model.
 * Model A is the original order; B/C/D use stable per-question permutations
 * so the same model can always be reproduced during scanning and review.
 */
export function getBubbleSheetVisualOrder(modelLabel: string, questionKey: string, optionCount: number) {
  const indexes = Array.from({ length: optionCount }, (_, index) => index);
  if (modelLabel === 'A' || optionCount < 2) return indexes;

  let seed = stableHash(`${modelLabel}:${questionKey}`);
  for (let index = indexes.length - 1; index > 0; index--) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const swapIndex = seed % (index + 1);
    [indexes[index], indexes[swapIndex]] = [indexes[swapIndex], indexes[index]];
  }

  // Avoid silently producing the base order for a non-A model.
  if (indexes.every((value, index) => value === index)) {
    [indexes[0], indexes[1]] = [indexes[1], indexes[0]];
  }
  return indexes;
}

function getBubbleSheetVisualIndexMap(modelLabel: string, questionKey: string, optionCount: number) {
  const visualOrder = getBubbleSheetVisualOrder(modelLabel, questionKey, optionCount);
  return visualOrder.reduce<number[]>((map, canonicalIndex, visualIndex) => {
    map[canonicalIndex] = visualIndex;
    return map;
  }, []);
}

function splitIntoFourColumns(total: number) {
  const base = Math.floor(total / 4);
  const remainder = total % 4;
  return Array.from({ length: 4 }, (_, index) => base + (index < remainder ? 1 : 0));
}

function buildAptitudeBubbleSheetLayout(config: BubbleSheetConfig, sourceSections: BubbleSheetSection[]): BubbleSheetLayout {
  const pageW = 210;
  const pageH = 297;
  const margin = 14;
  const panelGap = 3;
  const panelW = (pageW - (margin * 2) - (panelGap * 3)) / 4;
  const panelH = 82;
  const panelYs = [76, 171];
  const rowTopPadding = 15;
  const rowBottomPadding = 5;
  const pageIdentityRegion = config.includeQr
    ? { x: (pageW - margin - 22) / pageW, y: 19 / pageH, width: 22 / pageW, height: 22 / pageH }
    : undefined;
  const sections: BubbleSheetLayoutSection[] = [];
  const questions: BubbleSheetLayoutQuestion[] = [];
  let sourceOffset = 0;
  let globalQuestionNumber = 1;

  sourceSections.forEach((sourceSection, sectionIndex) => {
    const columnCounts = splitIntoFourColumns(sourceSection.questionsCount);
    const visualTitle = sectionIndex === 0 ? 'كمي' : 'لفظي';
    let sectionQuestionOffset = 0;
    columnCounts.forEach((questionCount, columnIndex) => {
      const visualIndex = sectionIndex * 4 + columnIndex;
      const panelX = margin + columnIndex * (panelW + panelGap);
      const panelY = panelYs[sectionIndex];
      const rowSpacing = (panelH - rowTopPadding - rowBottomPadding) / Math.max(questionCount, 1);
      const questionStartIndex = globalQuestionNumber;
      sections.push({
        sectionKey: `aptitude-${sectionIndex === 0 ? 'quantitative' : 'verbal'}-${columnIndex + 1}`,
        title: visualTitle,
        visualIndex,
        questionStartIndex,
        questionCount,
        pageNumber: 1,
        rect: { x: panelX / pageW, y: panelY / pageH, width: panelW / pageW, height: panelH / pageH },
      });

      for (let row = 0; row < questionCount; row++) {
        const sourceQuestion = config.questions?.[sourceOffset + sectionQuestionOffset + row];
        const sourceOptions = sourceQuestion?.options ?? Array.from({ length: config.choicesCount }, (_, index) => ({ id: '', label: CHOICE_LABELS[index] ?? String(index), sortOrder: index }));
        const yRow = panelY + rowTopPadding + row * rowSpacing;
        const optionStep = (panelW - 15) / 4;
        const visibleOptions = sourceOptions.slice(0, 4);
        const visualIndexMap = getBubbleSheetVisualIndexMap(config.modelLabel, sourceQuestion?.questionId ?? `question-${globalQuestionNumber}`, visibleOptions.length);
        const options = visibleOptions.map((sourceOption, optionIndex) => {
          const visualIndex = visualIndexMap[optionIndex] ?? optionIndex;
          const cx = panelX + 5 + visualIndex * optionStep;
          const cy = yRow - 2.8;
          return {
            optionId: sourceOption.id || undefined,
            label: sourceOption.label || CHOICE_LABELS[optionIndex] || String(optionIndex),
            visualIndex,
            rect: { x: (cx - 2.8) / pageW, y: (cy - 2.8) / pageH, width: 5.6 / pageW, height: 5.6 / pageH },
          };
        });
        questions.push({
          examQuestionId: sourceQuestion?.examQuestionId,
          questionId: sourceQuestion?.questionId,
          questionType: sourceQuestion?.questionType,
          points: sourceQuestion?.points,
          globalQuestionNumber,
          sectionVisualIndex: visualIndex,
          sectionQuestionNumber: sectionQuestionOffset + row + 1,
          pageNumber: 1,
          rect: { x: panelX / pageW, y: (yRow - 7) / pageH, width: panelW / pageW, height: rowSpacing / pageH },
          options,
        });
        globalQuestionNumber += 1;
      }
      sectionQuestionOffset += questionCount;
    });
    sourceOffset += sourceSection.questionsCount;
  });

  return {
    layoutSchemaVersion: config.layoutSchemaVersion,
    snapshotId: config.snapshotId ?? config.layout?.snapshotId,
    examId: config.examId,
    pageWidthMm: pageW,
    pageHeightMm: pageH,
    orientation: 'portrait',
    pageCount: 1,
    pageIdentityRegion,
    sections,
    questions,
  };
}

function isAptitudeBubbleSheetLayout(layout: BubbleSheetLayout) {
  return layout.sections.length === 8
    && layout.sections.slice(0, 4).every((section) => section.rect.y < 0.5)
    && layout.sections.slice(4, 8).every((section) => section.rect.y > 0.5);
}

export function buildBubbleSheetLayout(config: BubbleSheetConfig): BubbleSheetLayout {
  const pageW = 210;
  const pageH = 297;
  const margin = 15;
  const rowSpacing = 8;
  const panelGap = 4;
  let y = 35;
  if (config.includeStudentName) y += 8;
  if (config.includeStudentId) y += 8;
  y += 4;
  if (config.includeQr) y += 28;
  const sourceSections = config.sections?.filter((section) => section.title.trim() && section.questionsCount > 0) ?? [];
  const sections = sourceSections.length > 0 ? sourceSections : [{ title: config.examTitle, questionsCount: config.questionsCount }];
  const hasFourOptionsPerQuestion = !config.questions || config.questions.every((question) => question.options.length === 4);
  if (sections.length === 2 && config.choicesCount === 4 && hasFourOptionsPerQuestion && sections.every((section) => section.questionsCount <= 52)) {
    return buildAptitudeBubbleSheetLayout(config, sections);
  }
  const columns = Math.min(Math.max(sections.length, 1), 4);
  const panelW = (pageW - (margin * 2) - (panelGap * (columns - 1))) / columns;
  const maxRows = Math.max(1, Math.floor((pageH - y - 48) / rowSpacing));
  const pageCount = Math.max(...sections.map((section) => Math.ceil(section.questionsCount / maxRows)), 1);
  const pageIdentityRegion = config.includeQr
    ? { x: (pageW - margin - 25) / pageW, y: (y - 5) / pageH, width: 25 / pageW, height: 25 / pageH }
    : undefined;
  const snapshotSections: BubbleSheetLayoutSection[] = [];
  const questions: BubbleSheetLayoutQuestion[] = [];
  let questionStart = 1;
  sections.forEach((section, sectionIndex) => {
    const panelX = margin + sectionIndex * (panelW + panelGap);
    snapshotSections.push({
      sectionKey: `section-${sectionIndex + 1}`,
      title: section.title,
      visualIndex: sectionIndex,
      questionStartIndex: questionStart,
      questionCount: section.questionsCount,
      pageNumber: 1,
      rect: { x: panelX / pageW, y: (y + 2) / pageH, width: panelW / pageW, height: (14 + maxRows * rowSpacing) / pageH },
    });
    for (let pageIndex = 0; pageIndex < Math.ceil(section.questionsCount / maxRows); pageIndex++) {
      const visibleRows = Math.min(maxRows, Math.max(0, section.questionsCount - pageIndex * maxRows));
      const panelY = pageIndex === 0 ? y + 2 : 26;
      for (let row = 0; row < visibleRows; row++) {
        const sectionQuestionNumber = pageIndex * maxRows + row + 1;
        const yRow = panelY + 16 + row * rowSpacing;
        const sourceQuestion = config.questions?.[questions.length];
        const sourceOptions = sourceQuestion?.options ?? (config.layoutSchemaVersion && config.layoutSchemaVersion >= 2
          ? []
          : Array.from({ length: config.choicesCount }, (_, index) => ({ id: '', label: CHOICE_LABELS[index] ?? String(index), sortOrder: index })));
        const visualIndexMap = getBubbleSheetVisualIndexMap(config.modelLabel, sourceQuestion?.questionId ?? `question-${questionStart + sectionQuestionNumber - 1}`, sourceOptions.length);
        const options = sourceOptions.map((sourceOption, canonicalIndex) => {
          const visualIndex = visualIndexMap[canonicalIndex] ?? canonicalIndex;
          const choiceStep = columns === 4 ? Math.max(5.2, Math.min(9, (panelW - 16) / Math.max(sourceOptions.length, 1))) : 9;
          const cx = panelX + 8 + 3 + visualIndex * choiceStep;
          const cy = yRow - 1.5;
          return { optionId: sourceOption.id || undefined, label: sourceOption.label || CHOICE_LABELS[visualIndex] || String(visualIndex), visualIndex, rect: { x: (cx - 2.8) / pageW, y: (cy - 2.8) / pageH, width: 5.6 / pageW, height: 5.6 / pageH } };
        });
        questions.push({ examQuestionId: sourceQuestion?.examQuestionId, questionId: sourceQuestion?.questionId, questionType: sourceQuestion?.questionType, points: sourceQuestion?.points, globalQuestionNumber: questionStart + sectionQuestionNumber - 1, sectionVisualIndex: sectionIndex, sectionQuestionNumber, pageNumber: pageIndex + 1, rect: { x: panelX / pageW, y: (yRow - 4) / pageH, width: panelW / pageW, height: 8 / pageH }, options });
      }
    }
    questionStart += section.questionsCount;
  });
  return { layoutSchemaVersion: config.layoutSchemaVersion, snapshotId: config.snapshotId ?? config.layout?.snapshotId, examId: config.examId, pageWidthMm: 210, pageHeightMm: 297, orientation: 'portrait', pageCount, pageIdentityRegion, sections: snapshotSections, questions };
}

export async function generateBubbleSheetPDF(config: BubbleSheetConfig): Promise<Blob> {
  const { examTitle, modelLabel, templateVersion = 1, studentName, studentCode, institutionName, includeStudentId, includeStudentName, includeQr } = config;
  const layout = config.layout ?? buildBubbleSheetLayout(config);

  const pdf = new jsPDF({ orientation: layout.orientation, unit: 'mm', format: 'a4' });
  const pageW = layout.pageWidthMm;
  const pageH = layout.pageHeightMm;
  const margin = 15;

  function drawArabicText(text: string, x: number, baselineY: number, fontSize: number, bold = false) {
    const scale = 4;
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) {
      pdf.text(text, x, baselineY);
      return;
    }
    context.font = `${bold ? '700' : '400'} ${fontSize * scale}px Arial, sans-serif`;
    const width = Math.ceil(context.measureText(text).width) + (8 * scale);
    canvas.width = width;
    canvas.height = Math.ceil((fontSize + 5) * scale);
    context.font = `${bold ? '700' : '400'} ${fontSize * scale}px Arial, sans-serif`;
    context.fillStyle = '#000000';
    context.direction = 'rtl';
    context.textAlign = 'right';
    context.textBaseline = 'alphabetic';
    context.fillText(text, width - (4 * scale), fontSize * scale);
    pdf.addImage(canvas.toDataURL('image/png'), 'PNG', x, baselineY - fontSize + 1, width / scale, (fontSize + 5) / scale);
  }

  function drawRegistrationMarks() {
    pdf.setFillColor(0, 0, 0);
    pdf.rect(7, 7, 6, 6, 'F');
    pdf.rect(pageW - 13, 7, 6, 6, 'F');
    pdf.rect(7, pageH - 13, 6, 6, 'F');
    pdf.rect(pageW - 13, pageH - 13, 6, 6, 'F');
    pdf.setDrawColor(0);
    pdf.setLineWidth(0.4);
    pdf.rect(margin - 3, 14, pageW - (margin * 2) + 6, pageH - 28, 'S');
  }

  const aptitudeLayout = isAptitudeBubbleSheetLayout(layout);

  // Header
  drawRegistrationMarks();
  if (aptitudeLayout) {
    pdf.setFontSize(12);
    pdf.setFont('helvetica', 'bold');
    if (/[\u0600-\u06FF]/.test(examTitle)) drawArabicText(examTitle, margin, 20, 10, true);
    else pdf.text(examTitle, margin, 20);
    pdf.setFontSize(8);
    pdf.setFont('helvetica', 'normal');
    pdf.text(institutionName ?? 'Examify AI', margin, 25);

    pdf.setDrawColor(70);
    pdf.setLineWidth(0.35);
    pdf.rect(margin, 30, 92, 35, 'S');
    pdf.line(margin, 41, margin + 92, 41);
    pdf.line(margin, 52, margin + 92, 52);
    drawArabicText('اسم الطالب', margin + 88, 38, 7, true);
    drawArabicText('رقم الطالب', margin + 88, 49, 7, true);
    drawArabicText('نموذج', margin + 88, 60, 7, true);
    if (studentName) pdf.text(studentName, margin + 4, 38);
    if (studentCode) pdf.text(studentCode, margin + 4, 49);
    pdf.text(modelLabel, margin + 4, 60);

    pdf.rect(111, 30, 53, 35, 'S');
    drawArabicText('احفظ الإجابة الصحيحة من ورقة الأسئلة', 160, 39, 5.5, true);
    drawArabicText('ثم ظلل دائرة واحدة لكل سؤال', 160, 48, 5.5, true);
    drawArabicText('استخدم قلمًا داكنًا وواضحًا', 160, 57, 5.5, true);
    pdf.setFontSize(6);
    pdf.text(`Template v${templateVersion}`, 113, 62);
  } else {
    pdf.setFontSize(14);
    pdf.setFont('helvetica', 'bold');
    pdf.text(institutionName ?? 'Examify AI', margin, 18);
    pdf.setFontSize(11);
    pdf.setFont('helvetica', 'normal');
    if (/[\u0600-\u06FF]/.test(examTitle)) drawArabicText(examTitle, margin, 25, 11);
    else pdf.text(examTitle, margin, 25);
    pdf.setFontSize(9);
    pdf.text(`Model: ${modelLabel}`, pageW - margin - 28, 18);
    pdf.setFontSize(7);
    pdf.text(`Template v${templateVersion}`, pageW - margin - 28, 23);

    // Student info fields
    let standardY = 35;
    if (includeStudentName) {
      pdf.setFontSize(10);
      pdf.setFont('helvetica', 'bold');
      pdf.text('Name:', margin, standardY);
      pdf.setFont('helvetica', 'normal');
      pdf.line(margin + 18, standardY, pageW - margin, standardY);
      if (studentName) pdf.text(studentName, margin + 20, standardY - 1);
      standardY += 8;
    }
    if (includeStudentId) {
      pdf.setFont('helvetica', 'bold');
      pdf.text('ID:', margin, standardY);
      pdf.setFont('helvetica', 'normal');
      pdf.line(margin + 12, standardY, pageW - margin, standardY);
      if (studentCode) pdf.text(studentCode, margin + 14, standardY - 1);
      standardY += 8;
    }
  }

  let y = aptitudeLayout ? 72 : 35;
  if (!aptitudeLayout) {
    if (includeStudentName) y += 8;
    if (includeStudentId) y += 8;
    y += 4;
  }

  const isSnapshotV2 = layout.layoutSchemaVersion === 2 && Boolean(layout.snapshotId);
  const qrY = aptitudeLayout ? 18 : y - 5;
  if (!aptitudeLayout && includeQr) y += 28;

  // Bubble grid. When sections are provided, render a compact multi-section
  // layout similar to a composite aptitude sheet while keeping one global
  // question sequence for the OMR engine.
  const bubbleRadius = 2.8;
  for (let pageIndex = 0; pageIndex < layout.pageCount; pageIndex++) {
    if (pageIndex > 0) {
      pdf.addPage();
      drawRegistrationMarks();
    }
    if (includeQr && (pageIndex === 0 || isSnapshotV2)) {
      const qrRegion = layout.pageIdentityRegion ?? { x: (pageW - margin - 25) / pageW, y: qrY / pageH, width: 25 / pageW, height: 25 / pageH };
      const pageIdentity = layout.pageIdentities?.find((page) => page.pageIndex === pageIndex + 1);
      if (isSnapshotV2 && !pageIdentity) throw new Error('OMR v2 page identity is missing');
      const qrData = isSnapshotV2 ? `v2:${pageIdentity?.pageToken}` : JSON.stringify({ v: templateVersion, t: config.qrToken ?? crypto.randomUUID() });
      const qrDataUrl = await QRCode.toDataURL(qrData, { width: 120, margin: 1 });
      pdf.addImage(qrDataUrl, 'PNG', qrRegion.x * pageW, qrRegion.y * pageH, qrRegion.width * pageW, qrRegion.height * pageH);
    }
    layout.sections.forEach((section) => {
      const panelX = section.rect.x * pageW;
      const panelY = pageIndex === 0 ? section.rect.y * pageH : 26;
      const panelW = section.rect.width * pageW;
      const panelH = section.rect.height * pageH;
      pdf.setDrawColor(45);
      pdf.setLineWidth(0.35);
      pdf.rect(panelX, panelY, panelW, panelH, 'S');
      if (/^[\u0600-\u06FF]/.test(section.title)) drawArabicText(section.title, panelX + panelW - 3, panelY + 8, 9, true);
      else { pdf.setFontSize(9); pdf.setFont('helvetica', 'bold'); pdf.text(section.title, panelX + 3, panelY + 8); }
      layout.questions.filter((question) => question.pageNumber === pageIndex + 1 && question.sectionVisualIndex === section.visualIndex).forEach((question) => {
        const qNum = question.globalQuestionNumber;
        const yRow = question.rect.y * pageH + 4;
        pdf.setFontSize(7);
        pdf.setFont('helvetica', 'bold');
        if (aptitudeLayout) pdf.text(String(qNum).padStart(2, '0'), panelX + panelW - 2, yRow, { align: 'right' });
        else pdf.text(String(qNum).padStart(2, '0'), panelX + 3, yRow);
        for (const option of question.options) {
          const cx = option.rect.x * pageW + bubbleRadius;
          const cy = option.rect.y * pageH + bubbleRadius;
          pdf.setDrawColor(120);
          pdf.setLineWidth(0.3);
          pdf.circle(cx, cy, bubbleRadius, 'S');
          pdf.setFontSize(5.5);
          pdf.setFont('helvetica', 'normal');
          pdf.text(option.label, cx - 1.3, aptitudeLayout ? cy + 1.8 : cy + 5);
        }
      });
    });
  }

  // Footer
  const pageCount = pdf.getNumberOfPages();
  for (let p = 1; p <= pageCount; p++) {
    pdf.setPage(p);
    pdf.setFontSize(7);
    pdf.setTextColor(150);
    pdf.text(`Examify AI - OMR Template v${templateVersion} - Model ${modelLabel} - Page ${p}/${pageCount}`, margin, pageH - 8);
    pdf.text(`Exam: ${config.examId}`, pageW - margin - 48, pageH - 8);
    pdf.setTextColor(0);
  }

  return pdf.output('blob');
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
