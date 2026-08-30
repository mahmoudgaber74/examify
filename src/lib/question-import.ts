import mammoth from 'mammoth/mammoth.browser';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import pdfWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.mjs?url';

// Let Vite copy the worker into the final assets folder. Using a package URL
// directly leaves `/node_modules/...` in development and causes PDF.js to fall
// back to a fake worker that fails in the browser.
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export interface ImportedQuestion {
  prompt: string;
  options: { label: string; is_correct: boolean; sort_order: number }[];
}

export async function extractQuestionFile(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  if (file.name.toLowerCase().endsWith('.docx')) {
    const result = await mammoth.extractRawText({ arrayBuffer: buffer });
    return result.value.trim();
  }
  if (file.name.toLowerCase().endsWith('.pdf')) {
    const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
    const pages: string[] = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      pages.push(content.items.map((item) => ('str' in item ? item.str : '')).join(' '));
    }
    return pages.join('\n\n').trim();
  }
  throw new Error('صيغة الملف غير مدعومة. استخدم PDF أو Word بصيغة DOCX.');
}

function cleanLine(line: string) {
  return line.replace(/^\s+|\s+$/g, '').replace(/[\uFEFF\u200B]/g, '');
}

export function parseImportedQuestions(text: string): ImportedQuestion[] {
  const lines = text.split(/\r?\n/).map(cleanLine).filter(Boolean);
  const blocks: string[][] = [];
  let current: string[] = [];
  const startsQuestion = (line: string) => /^(?:سؤال\s*)?\d+\s*[.)-]\s*/i.test(line);
  for (const line of lines) {
    if (startsQuestion(line) && current.length) {
      blocks.push(current);
      current = [];
    }
    current.push(line);
  }
  if (current.length) blocks.push(current);

  return blocks.map((block) => {
    const first = block[0].replace(/^(?:سؤال\s*)?\d+\s*[.)-]\s*/i, '');
    const optionLines = block.slice(1).filter((line) => /^(?:[A-H]|[أ-ي])[.)؟:-]\s*/i.test(line));
    const options = optionLines.map((line, index) => ({
      label: line.replace(/^(?:[A-H]|[أ-ي])[.)؟:-]\s*/i, '').replace(/\s*(?:\(|\[)?(?:الإجابة الصحيحة|correct)\s*(?:\)|\])?\s*$/i, '').trim(),
      is_correct: /(?:الإجابة الصحيحة|correct|صح|✓|\*)/i.test(line),
      sort_order: index,
    })).filter((option) => option.label);
    const prompt = [first, ...block.slice(1).filter((line) => !/^(?:[A-H]|[أ-ي])[.)؟:-]\s*/i.test(line) && !/^(?:الإجابة|answer)\s*[:：-]/i.test(line))].join(' ').trim();
    const answer = block.find((line) => /^(?:الإجابة|answer)\s*[:：-]/i.test(line));
    if (answer && options.length) {
      const answerLabel = answer.split(/[:：-]/)[1]?.trim().toLowerCase();
      options.forEach((option, index) => { option.is_correct = answerLabel === String.fromCharCode(65 + index).toLowerCase() || option.label.toLowerCase() === answerLabel; });
    }
    return { prompt, options };
  }).filter((question) => question.prompt.length > 2);
}
