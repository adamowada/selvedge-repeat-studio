import { MAX_SIDE, type NamedAsset } from './types';

const signature = [137, 80, 78, 71, 13, 10, 26, 10];
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
export async function importPng(file: File): Promise<NamedAsset> {
  // Read dimensions before asking the browser to allocate/decode the image.
  const size = readPngSize(new Uint8Array(await file.slice(0, 24).arrayBuffer()));
  const url = URL.createObjectURL(file);
  const image = new Image();
  try {
    image.src = url;
    await image.decode();
    if (image.naturalWidth !== size.width || image.naturalHeight !== size.height) throw new Error('Decoded PNG dimensions do not match its header.');
    return { id: crypto.randomUUID(), name: file.name.replace(/\.png$/i, ''), image, nativeW: size.width, nativeH: size.height };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error instanceof Error ? error : new Error('PNG could not be decoded.');
  }
}
export async function importBatch(files: File[]) {
  const assets: NamedAsset[] = [], errors: string[] = [];
  for (const file of files) {
    try { assets.push(await importPng(file)); }
    catch (error) { errors.push(`${file.name}: ${error instanceof Error ? error.message : 'Import failed.'}`); }
  }
  return { assets, errors };
}
export const DEMO_FILES = ['coral-stem.png', 'sage-sprig.png', 'ochre-petal.png'] as const;
export async function demoFiles(): Promise<File[]> {
  return Promise.all(DEMO_FILES.map(async name => {
    const response = await fetch(`${import.meta.env.BASE_URL}demo/${name}`);
    if (!response.ok) throw new Error(`Could not load ${name}.`);
    return new File([await response.blob()], name, { type: 'image/png' });
  }));
}
export function releaseAssets(assets: NamedAsset[]) {
  for (const asset of assets) URL.revokeObjectURL(asset.image.src);
}
