import { createWorker } from 'tesseract.js';

export interface OcrResult {
  text: string;
  confidence: number;
  language: string;
}

export async function extractTextFromImage(
  imageFile: File | Blob,
  languages: 'ara' | 'eng' | 'ara+eng' = 'ara+eng'
): Promise<OcrResult> {
  return extractTextWithProgress(imageFile, languages);
}

export interface OcrProgressCallback {
  (progress: number, status: string): void;
}

export async function extractTextWithProgress(
  imageFile: File | Blob,
  languages: 'ara' | 'eng' | 'ara+eng' = 'ara+eng',
  onProgress?: OcrProgressCallback
): Promise<OcrResult> {
  return enqueueOcr(async () => {
    let worker: Awaited<ReturnType<typeof createWorker>> | null = null;

    try {
      worker = await createWorker(languages, 1, {
        logger: (m) => {
          if (m.status === 'recognizing text' && onProgress) {
            onProgress(m.progress, m.status);
          }
        },
        errorHandler: (error) => {
          console.error('Tesseract OCR worker error:', error);
        },
      });

      const { data } = await worker.recognize(imageFile);

      return {
        text: data.text.trim(),
        confidence: data.confidence,
        language: languages,
      };
    } catch (error) {
      throw new Error(getOcrErrorMessage(error));
    } finally {
      if (worker) {
        await worker.terminate();
      }
    }
  });
}

let ocrQueue = Promise.resolve();

function enqueueOcr<T>(task: () => Promise<T>): Promise<T> {
  const run = ocrQueue.then(task, task);
  ocrQueue = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

function getOcrErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const lowerMessage = message.toLowerCase();

  if (
    lowerMessage.includes('failed to fetch') ||
    lowerMessage.includes('failed to load') ||
    lowerMessage.includes('tesseractcore') ||
    lowerMessage.includes('wasm') ||
    lowerMessage.includes('traineddata') ||
    lowerMessage.includes('language')
  ) {
    return `Failed to load OCR language data or WebAssembly assets for Tesseract (${message}). Check network access and that ara/eng traineddata files can be downloaded.`;
  }

  return `OCR failed: ${message}`;
}
