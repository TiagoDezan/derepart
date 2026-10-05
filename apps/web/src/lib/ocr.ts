import type { Worker } from 'tesseract.js';

/**
 * On-device OCR (Tesseract.js, Spanish model). The photo never leaves the phone for this step.
 * The engine and language data are downloaded once and then cached by the service worker.
 */
let workerPromise: Promise<Worker> | null = null;

export function warmUpOcr() {
  workerPromise ??= import('tesseract.js').then(({ createWorker }) => createWorker('spa'));
  return workerPromise;
}

export interface OcrResult {
  text: string;
  /** 0–100 */
  confidence: number;
}

export async function recognizeLabel(image: HTMLCanvasElement): Promise<OcrResult> {
  const worker = await warmUpOcr();
  const { data } = await worker.recognize(image);
  return { text: data.text, confidence: data.confidence };
}

/** Loads a photo, downsizes it and boosts contrast — cheaper and more accurate OCR. */
export async function preprocess(blob: Blob, maxSide = 1800): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(blob);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const px = img.data;
  // grayscale + contrast stretch between the 2nd and 98th percentile
  const hist = new Uint32Array(256);
  for (let i = 0; i < px.length; i += 4) {
    const g = (px[i] * 299 + px[i + 1] * 587 + px[i + 2] * 114) / 1000;
    px[i] = g;
    hist[g | 0]++;
  }
  const total = px.length / 4;
  let lo = 0;
  let hi = 255;
  for (let acc = 0; lo < 255 && (acc += hist[lo]) < total * 0.02; lo++);
  for (let acc = 0; hi > 0 && (acc += hist[hi]) < total * 0.02; hi--);
  const range = Math.max(1, hi - lo);
  for (let i = 0; i < px.length; i += 4) {
    const v = Math.max(0, Math.min(255, ((px[i] - lo) * 255) / range));
    px[i] = px[i + 1] = px[i + 2] = v;
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

/** JPEG base64 (no data: prefix) of a canvas, for the optional AI vision step. */
export function canvasToBase64(canvas: HTMLCanvasElement, maxSide = 1400, quality = 0.82): string {
  const scale = Math.min(1, maxSide / Math.max(canvas.width, canvas.height));
  let source = canvas;
  if (scale < 1) {
    source = document.createElement('canvas');
    source.width = Math.round(canvas.width * scale);
    source.height = Math.round(canvas.height * scale);
    source.getContext('2d')!.drawImage(canvas, 0, 0, source.width, source.height);
  }
  return source.toDataURL('image/jpeg', quality).split(',')[1];
}
