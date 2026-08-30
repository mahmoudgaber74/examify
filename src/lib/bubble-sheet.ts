import jsPDF from 'jspdf';
import QRCode from 'qrcode';

export interface BubbleSheetConfig {
  examId: string;
  examTitle: string;
  modelLabel: string;
  questionsCount: number;
  choicesCount: number;
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
}

export interface BubbleSheetSection {
  title: string;
  questionsCount: number;
}

const CHOICE_LABELS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

export async function generateBubbleSheetPDF(config: BubbleSheetConfig): Promise<Blob> {
  const { examTitle, modelLabel, questionsCount, choicesCount, templateVersion = 1, studentName, studentCode, institutionName, includeStudentId, includeStudentName, includeQr } = config;

  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageW = 210;
  const pageH = 297;
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

  // Header
  drawRegistrationMarks();
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
  let y = 35;
  if (includeStudentName) {
    pdf.setFontSize(10);
    pdf.setFont('helvetica', 'bold');
    pdf.text('Name:', margin, y);
    pdf.setFont('helvetica', 'normal');
    pdf.line(margin + 18, y, pageW - margin, y);
    if (studentName) pdf.text(studentName, margin + 20, y - 1);
    y += 8;
  }
  if (includeStudentId) {
    pdf.setFont('helvetica', 'bold');
    pdf.text('ID:', margin, y);
    pdf.setFont('helvetica', 'normal');
    pdf.line(margin + 12, y, pageW - margin, y);
    if (studentCode) pdf.text(studentCode, margin + 14, y - 1);
    y += 8;
  }
  y += 4;

  // QR code
  if (includeQr) {
    const qrData = JSON.stringify({ v: templateVersion, t: config.qrToken ?? crypto.randomUUID() });
    const qrDataUrl = await QRCode.toDataURL(qrData, { width: 120, margin: 1 });
    pdf.addImage(qrDataUrl, 'PNG', pageW - margin - 25, y - 5, 25, 25);
    y += 28;
  }

  // Bubble grid. When sections are provided, render a compact multi-section
  // layout similar to a composite aptitude sheet while keeping one global
  // question sequence for the OMR engine.
  const bubbleRadius = 2.8;
  const rowSpacing = 8;
  const questionLabelW = 8;
  const panelGap = 4;
  const sections = config.sections?.filter((section) => section.title.trim() && section.questionsCount > 0) ?? [];
  const layoutSections = sections.length > 0 ? sections : [{ title: examTitle, questionsCount }];
  const layoutColumnCount = Math.min(Math.max(layoutSections.length, 1), 4);
  const colSpacing = layoutColumnCount === 4 ? 6.4 : 9;
  const panelW = (pageW - (margin * 2) - (panelGap * (layoutColumnCount - 1))) / layoutColumnCount;
  const maxRowsPerPanel = Math.max(1, Math.floor((pageH - y - 48) / rowSpacing));
  const panelPages = Math.max(...layoutSections.map((section) => Math.ceil(section.questionsCount / maxRowsPerPanel)), 1);
  for (let pageIndex = 0; pageIndex < panelPages; pageIndex++) {
    if (pageIndex > 0) {
      pdf.addPage();
      drawRegistrationMarks();
    }
    const panelY = pageIndex === 0 ? y + 2 : 26;
    const panelRows = layoutSections.map((section) => Math.min(maxRowsPerPanel, Math.max(0, section.questionsCount - (pageIndex * maxRowsPerPanel))));
    const panelH = 14 + Math.max(...panelRows, 1) * rowSpacing;

    layoutSections.slice(0, 4).forEach((section, sectionIndex) => {
      const visibleRows = panelRows[sectionIndex] ?? 0;
      const panelX = margin + sectionIndex * (panelW + panelGap);
      pdf.setDrawColor(45);
      pdf.setLineWidth(0.35);
      pdf.rect(panelX, panelY, panelW, panelH, 'S');
      if (/^[\u0600-\u06FF]/.test(section.title)) drawArabicText(section.title, panelX + panelW - 3, panelY + 8, 9, true);
      else { pdf.setFontSize(9); pdf.setFont('helvetica', 'bold'); pdf.text(section.title, panelX + 3, panelY + 8); }
      for (let row = 0; row < visibleRows; row++) {
        const qNum = layoutSections.slice(0, sectionIndex).reduce((sum, item) => sum + item.questionsCount, 0) + (pageIndex * maxRowsPerPanel) + row + 1;
        const yRow = panelY + 16 + row * rowSpacing;
        pdf.setFontSize(7);
        pdf.setFont('helvetica', 'bold');
        pdf.text(String(qNum).padStart(2, '0'), panelX + 3, yRow);
        for (let c = 0; c < choicesCount; c++) {
          const cx = panelX + questionLabelW + 3 + c * colSpacing;
          const cy = yRow - 1.5;
          pdf.setDrawColor(120);
          pdf.setLineWidth(0.3);
          pdf.circle(cx, cy, bubbleRadius, 'S');
          pdf.setFontSize(5.5);
          pdf.setFont('helvetica', 'normal');
          pdf.text(CHOICE_LABELS[c] ?? String(c), cx - 1.3, cy + 5);
        }
      }
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
