export interface OmrDetectionResult {
  questionNumber: number;
  detectedAnswer: string | null;
  confidence: number;
  needsManualReview: boolean;
  reviewReason: 'empty' | 'ambiguous' | 'multiple_marks' | 'low_confidence' | null;
  fillRatios: Record<string, number>;
}

export interface OmrScanResult {
  answers: OmrDetectionResult[];
  overallConfidence: number;
  studentName: string | null;
  studentCode: string | null;
  engine?: string;
  engineVersion?: string | null;
  jobId?: string | null;
  documentConfidence?: number;
  warnings?: string[];
  annotatedStoragePath?: string | null;
  processingStatus?: string;
}

const CHOICE_LABELS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

export interface OmrConfig {
  questionsCount: number;
  choicesCount: number;
  columns: number;
  sections?: { title: string; questionsCount: number }[];
}

export async function scanBubbleSheet(
  imageFile: File,
  config: OmrConfig
): Promise<OmrScanResult> {
  const imageData = await loadImage(imageFile);
  const canvas = document.createElement('canvas');
  canvas.width = imageData.width;
  canvas.height = imageData.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas not supported');
  ctx.putImageData(imageData, 0, 0);

  const grayscale = toGrayscale(ctx, canvas.width, canvas.height);
  const threshold = otsuThreshold(grayscale);
  const binary = binarize(grayscale, threshold);

  const { rowsPerCol, gridTop, gridBottom, gridLeft, gridRight } = detectGridBounds(binary, canvas.width, canvas.height, config);

  const answers: OmrDetectionResult[] = [];
  let totalConfidence = 0;

  for (let q = 0; q < config.questionsCount; q++) {
    let col = Math.floor(q / rowsPerCol);
    let row = q % rowsPerCol;
    if (config.sections?.length) {
      let offset = 0;
      for (let sectionIndex = 0; sectionIndex < config.sections.length; sectionIndex++) {
        const sectionCount = config.sections[sectionIndex].questionsCount;
        if (q < offset + sectionCount) {
          col = sectionIndex;
          row = q - offset;
          break;
        }
        offset += sectionCount;
      }
    }

    const colWidth = (gridRight - gridLeft) / config.columns;
    const colStart = gridLeft + col * colWidth;
    const rowHeight = (gridBottom - gridTop) / rowsPerCol;
    const rowY = gridTop + row * rowHeight;

    const questionLabelW = colWidth * 0.15;
    const choicesAreaW = colWidth - questionLabelW;
    const bubbleSpacing = choicesAreaW / config.choicesCount;

    let maxFill = 0;
    let secondMax = 0;
    let detectedIdx = -1;
    const fillRatios: Record<string, number> = {};

    for (let c = 0; c < config.choicesCount; c++) {
      const cx = Math.floor(colStart + questionLabelW + c * bubbleSpacing + bubbleSpacing / 2);
      const cy = Math.floor(rowY + rowHeight / 2);
      const fillRatio = measureBubbleFill(binary, canvas.width, cx, cy, Math.floor(bubbleSpacing * 0.35));
      const label = CHOICE_LABELS[c] ?? String(c + 1);
      fillRatios[label] = Math.round(fillRatio * 100) / 100;

      if (fillRatio > maxFill) {
        secondMax = maxFill;
        maxFill = fillRatio;
        detectedIdx = c;
      } else if (fillRatio > secondMax) {
        secondMax = fillRatio;
      }
    }

    const margin = maxFill - secondMax;
    const markThreshold = 0.18;
    const strongMarkThreshold = 0.35;
    const closeMarkThreshold = 0.12;
    const multipleMarks = Object.values(fillRatios).filter((fill) => fill >= markThreshold && maxFill - fill <= closeMarkThreshold).length > 1;
    const detectedAnswer = maxFill < markThreshold ? null : CHOICE_LABELS[detectedIdx] ?? null;
    const fillConfidence = clamp((maxFill - markThreshold) / (strongMarkThreshold - markThreshold));
    const marginConfidence = clamp(margin / 0.25);
    const confidence = detectedAnswer ? (fillConfidence * 0.55) + (marginConfidence * 0.45) : 0;
    const reviewReason =
      !detectedAnswer ? 'empty' :
      multipleMarks ? 'multiple_marks' :
      margin < closeMarkThreshold ? 'ambiguous' :
      maxFill < strongMarkThreshold ? 'low_confidence' :
      null;

    answers.push({
      questionNumber: q + 1,
      detectedAnswer,
      confidence: Math.round(confidence * 100) / 100,
      needsManualReview: reviewReason !== null,
      reviewReason,
      fillRatios,
    });
    totalConfidence += confidence;
  }

  return {
    answers,
    overallConfidence: Math.round((totalConfidence / config.questionsCount) * 100) / 100,
    studentName: null,
    studentCode: null,
  };
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function loadImage(file: File): Promise<ImageData> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const maxDim = 2000;
      let w = img.width;
      let h = img.height;
      if (w > maxDim || h > maxDim) {
        const ratio = maxDim / Math.max(w, h);
        w = Math.floor(w * ratio);
        h = Math.floor(h * ratio);
      }
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) { reject(new Error('Canvas not supported')); return; }
      ctx.drawImage(img, 0, 0, w, h);
      resolve(ctx.getImageData(0, 0, w, h));
    };
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = URL.createObjectURL(file);
  });
}

function toGrayscale(ctx: CanvasRenderingContext2D, w: number, h: number): Uint8Array {
  const data = ctx.getImageData(0, 0, w, h).data;
  const gray = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    gray[i] = Math.round(data[i * 4] * 0.299 + data[i * 4 + 1] * 0.587 + data[i * 4 + 2] * 0.114);
  }
  return gray;
}

function otsuThreshold(gray: Uint8Array): number {
  const hist = new Array(256).fill(0);
  for (let i = 0; i < gray.length; i++) hist[gray[i]]++;
  const total = gray.length;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0, wB = 0, maxVar = 0, threshold = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const v = wB * wF * (mB - mF) * (mB - mF);
    if (v > maxVar) { maxVar = v; threshold = t; }
  }
  return threshold;
}

function binarize(gray: Uint8Array, threshold: number): Uint8Array {
  const bin = new Uint8Array(gray.length);
  for (let i = 0; i < gray.length; i++) {
    bin[i] = gray[i] < threshold ? 1 : 0; // 1 = dark (filled)
  }
  return bin;
}

interface GridBounds {
  rowsPerCol: number;
  gridTop: number;
  gridBottom: number;
  gridLeft: number;
  gridRight: number;
}

function detectGridBounds(binary: Uint8Array, w: number, h: number, config: OmrConfig): GridBounds {
  const rowsPerCol = config.sections?.length
    ? Math.max(...config.sections.map((section) => section.questionsCount), 1)
    : Math.ceil(config.questionsCount / config.columns);

  // Horizontal projection to find top and bottom of bubble area
  const rowSums = new Float32Array(h);
  for (let y = 0; y < h; y++) {
    let sum = 0;
    for (let x = 0; x < w; x++) sum += binary[y * w + x];
    rowSums[y] = sum;
  }

  // Find the densest region (the bubble grid)
  const avgRow = rowSums.reduce((a, b) => a + b, 0) / h;
  let gridTop = 0, gridBottom = h - 1;
  for (let y = 0; y < h; y++) {
    if (rowSums[y] > avgRow * 1.5) { gridTop = y; break; }
  }
  for (let y = h - 1; y >= 0; y--) {
    if (rowSums[y] > avgRow * 1.5) { gridBottom = y; break; }
  }

  // Vertical projection for left/right
  const colSums = new Float32Array(w);
  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let y = 0; y < h; y++) sum += binary[y * w + x];
    colSums[x] = sum;
  }
  const avgCol = colSums.reduce((a, b) => a + b, 0) / w;
  let gridLeft = 0, gridRight = w - 1;
  for (let x = 0; x < w; x++) {
    if (colSums[x] > avgCol * 1.2) { gridLeft = x; break; }
  }
  for (let x = w - 1; x >= 0; x--) {
    if (colSums[x] > avgCol * 1.2) { gridRight = x; break; }
  }

  // Fallback to reasonable defaults if detection fails
  if (gridBottom <= gridTop) { gridTop = Math.floor(h * 0.15); gridBottom = Math.floor(h * 0.85); }
  if (gridRight <= gridLeft) { gridLeft = Math.floor(w * 0.05); gridRight = Math.floor(w * 0.95); }

  return { rowsPerCol, gridTop, gridBottom, gridLeft, gridRight };
}

function measureBubbleFill(binary: Uint8Array, w: number, cx: number, cy: number, radius: number): number {
  let dark = 0, total = 0;
  const r2 = radius * radius;
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dy * dy > r2) continue;
      const px = cx + dx;
      const py = cy + dy;
      if (px < 0 || px >= w || py < 0 || py * w + px >= binary.length) continue;
      total++;
      if (binary[py * w + px] === 1) dark++;
    }
  }
  return total > 0 ? dark / total : 0;
}
