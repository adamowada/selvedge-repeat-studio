import { MAX_SIDE, type NamedAsset } from './types';

export const MAX_ASSETS = 64;
export const MAX_IMPORT_PIXELS = 32 * 1024 * 1024;
export const MAX_IMPORT_BYTES = 64 * 1024 * 1024;
export const createImportBudget = () => ({ count: 0, pixels: 0, bytes: 0 });

const signature = [137, 80, 78, 71, 13, 10, 26, 10];
// Find the nontransparent pixels once at import, retaining a transparent pixel
// of padding for interpolation. Full native bounds still control hit testing.
function contentBounds(image: HTMLImageElement) {
  const canvas = document.createElement('canvas');
  const w = canvas.width = image.naturalWidth, h = canvas.height = image.naturalHeight;
  try {
    const context = canvas.getContext('2d', { willReadFrequently: true })!;
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, w, h).data;
    let left = w, top = h, right = -1, bottom = -1;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (!pixels[(y * w + x) * 4 + 3]) continue;
      left = Math.min(left, x); right = Math.max(right, x);
      top = Math.min(top, y); bottom = y;
    }
    if (right < 0) return { x: 0, y: 0, width: 0, height: 0 };
    left = Math.max(0, left - 1); top = Math.max(0, top - 1);
    return { x: left, y: top, width: Math.min(w, right + 2) - left, height: Math.min(h, bottom + 2) - top };
  } finally { canvas.width = canvas.height = 0; }
}
export function readPngSize(bytes: Uint8Array) {
  if (bytes.length < 24 || !signature.every((n, i) => bytes[i] === n) || String.fromCharCode(...bytes.slice(12, 16)) !== 'IHDR') {
    throw new Error('Not a valid PNG file.');
  }
  const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (data.getUint32(8) !== 13) throw new Error('Invalid PNG header.');
  const width = data.getUint32(16), height = data.getUint32(20);
  if (width < 1 || height < 1 || width > MAX_SIDE || height > MAX_SIDE) throw new Error(`PNG dimensions must be 1–${MAX_SIDE} px per side (received ${width} × ${height}).`);
  return { width, height };
}
export async function importPng(file: File, budget = createImportBudget()): Promise<NamedAsset> {
  // Read dimensions before asking the browser to allocate/decode the image.
  const size = readPngSize(new Uint8Array(await file.slice(0, 24).arrayBuffer()));
  const pixels = size.width * size.height;
  if (budget.count >= MAX_ASSETS || budget.pixels + pixels > MAX_IMPORT_PIXELS || budget.bytes + file.size > MAX_IMPORT_BYTES) {
    throw new Error('Source limit reached (64 images, 32 megapixels or 64 MiB of PNGs). Remove unused sources before importing more.');
  }
  // Reserve synchronously before decode so concurrent imports share the limit.
  budget.count++; budget.pixels += pixels; budget.bytes += file.size;
  let url: string | undefined;
  const image = new Image();
  let released = false;
  const dispose = () => {
    if (released) return;
    released = true;
    if (url) URL.revokeObjectURL(url);
    image.src = '';
    budget.count--; budget.pixels -= pixels; budget.bytes -= file.size;
  };
  try {
    url = URL.createObjectURL(file);
    image.src = url;
    await image.decode();
    if (image.naturalWidth !== size.width || image.naturalHeight !== size.height) throw new Error('Decoded PNG dimensions do not match its header.');
    return { id: crypto.randomUUID(), name: file.name.replace(/\.png$/i, ''), image, nativeW: size.width, nativeH: size.height, contentBounds: contentBounds(image), dispose };
  } catch (error) {
    dispose();
    throw error instanceof Error ? error : new Error('PNG could not be decoded.');
  }
}
export async function importBatch(files: File[], budget = createImportBudget()) {
  const assets: NamedAsset[] = [], errors: string[] = [];
  for (const file of files) {
    try { assets.push(await importPng(file, budget)); }
    catch (error) { errors.push(`${file.name}: ${error instanceof Error ? error.message : 'Import failed.'}`); }
  }
  return { assets, errors };
}
export const DEMO_FILES = ['coral-stem.png', 'sage-sprig.png', 'ochre-petal.png'] as const;
export async function demoFiles(names: readonly string[] = DEMO_FILES): Promise<File[]> {
  return Promise.all(names.map(async name => {
    const response = await fetch(`${import.meta.env.BASE_URL}demo/${name}`);
    if (!response.ok) throw new Error(`Could not load ${name}.`);
    return new File([await response.blob()], name, { type: 'image/png' });
  }));
}
export function releaseAssets(assets: NamedAsset[]) {
  for (const asset of assets) {
    if (asset.dispose) asset.dispose();
    else URL.revokeObjectURL(asset.image.src);
  }
}
