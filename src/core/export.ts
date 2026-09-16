import Konva from 'konva';
import { enumerateCopies, outputSize, padBounds, validateDocument } from './geometry';
import { imageProps } from './transforms';
import { MAX_SIDE, type AssetMap, type RepeatDocument } from './types';

export interface ExportResult { blob: Blob; width: number; height: number; fingerprint: string }
export const documentFingerprint = (doc: RepeatDocument) => JSON.stringify(doc);
function canvasBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('The browser could not encode a PNG.')), 'image/png');
  });
}

// Also used by the browser test's larger independent-region reference render.
// The exported rectangle itself always starts at (0, 0), with no camera.
export async function renderPixels(doc: RepeatDocument, assets: AssetMap, width: number, height: number): Promise<Blob> {
  validateDocument(doc, assets);
  if (![width, height].every(n => Number.isInteger(n) && n > 0 && n <= MAX_SIDE)) throw new Error(`Output sides must be whole pixels from 1 to ${MAX_SIDE}.`);
  const copies = enumerateCopies(doc, assets, padBounds({ left: 0, top: 0, right: width, bottom: height }, 1));
  const byId = new Map(doc.placements.map(p => [p.id, p]));
  // Preflight above is complete before any surface or node allocation.
  const container = document.createElement('div');
  let stage: Konva.Stage | undefined;
  let canvas: HTMLCanvasElement | undefined;
  const ratio = Konva.pixelRatio;
  try {
    // Konva reads the global only when constructing its backing canvases.
    // Restore synchronously: the live scene never inherits this setting.
    Konva.pixelRatio = 1;
    stage = new Konva.Stage({ container, width, height });
    const layer = new Konva.Layer({ listening: false });
    stage.add(layer);
    Konva.pixelRatio = ratio;
    if (doc.background) layer.add(new Konva.Rect({ width, height, fill: doc.background, listening: false }));
    for (const copy of copies) {
      const p = byId.get(copy.id)!;
      layer.add(new Konva.Image({ ...imageProps(p, assets.get(p.assetId)!, copy), listening: false }));
    }
    layer.draw();
    canvas = stage.toCanvas({ x: 0, y: 0, width, height, pixelRatio: 1 });
    return await canvasBlob(canvas);
  } finally {
    Konva.pixelRatio = ratio;
    stage?.destroy();
    container.remove();
    if (canvas) { canvas.width = 0; canvas.height = 0; }
  }
}
export async function exportPng(doc: RepeatDocument, assets: AssetMap): Promise<ExportResult> {
  const { width, height } = outputSize(doc);
  const blob = await renderPixels(doc, assets, width, height);
  const decoded = await createImageBitmap(blob);
  try {
    if (decoded.width !== width || decoded.height !== height) throw new Error('Decoded PNG dimensions do not match the requested rectangle.');
  } finally { decoded.close(); }
  return { blob, width, height, fingerprint: documentFingerprint(doc) };
}

export function downloadPng(result: ExportResult) {
  const url = URL.createObjectURL(result.blob);
  const a = document.createElement('a');
  try {
    a.href = url;
    a.download = `selvedge-${result.width}x${result.height}.png`;
    document.body.append(a);
    a.click();
  } finally {
    a.remove();
    // Give the browser's download task time to consume the URL, then release it.
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
