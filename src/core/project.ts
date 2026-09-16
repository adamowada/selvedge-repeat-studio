import { strToU8, unzipSync, zipSync } from 'fflate';
import { validateDocument } from './geometry';
import { activeAssets } from './document';
import { createImportBudget, importPng, MAX_ASSETS, MAX_IMPORT_BYTES, MAX_IMPORT_PIXELS, readPngSize, releaseAssets } from './png';
import type { NamedAsset, Placement, RepeatDocument } from './types';

const MAX_MANIFEST_BYTES = 1024 * 1024;
export const MAX_PROJECT_BYTES = MAX_IMPORT_BYTES + MAX_MANIFEST_BYTES + 64 * 1024;
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const id = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 128;
const invalid = () => new Error('Invalid Selvedge project.');

// Version 1 uses standard ZIP STORE entries: PNGs are already compressed.
// Reject other methods before extraction, so hostile archives cannot inflate
// beyond the import budget (even if their advertised sizes are dishonest).
export function readProject(bytes: Uint8Array) {
  if (bytes.length < 22 || bytes.length > MAX_PROJECT_BYTES) throw new Error('Project file is empty or exceeds the size limit.');
  const sizes = new Map<string, number>();
  let total = 0;
  const files = unzipSync(bytes, { filter: entry => {
    const manifest = entry.name === 'project.json';
    if ((!manifest && !/^assets\/[0-9]+\.png$/.test(entry.name)) || sizes.has(entry.name) || sizes.size >= MAX_ASSETS + 1) throw invalid();
    if (entry.compression !== 0 || entry.size !== entry.originalSize) throw new Error('Unsupported project archive. Open a .selvedge file saved by Selvedge.');
    if (manifest ? entry.size > MAX_MANIFEST_BYTES : (total += entry.size) > MAX_IMPORT_BYTES) throw new Error('Project exceeds the source size limit.');
    sizes.set(entry.name, entry.size);
    return true;
  } });
  for (const [name, size] of sizes) if (files[name]?.length !== size) throw invalid();
  if (!files['project.json']) throw invalid();
  const data: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(files['project.json']));
  if (!record(data) || data.format !== 'selvedge-repeat') throw invalid();
  if (data.version !== 1) throw new Error('Unsupported project version. This editor opens version 1 projects.');
  if (!Array.isArray(data.assets) || data.assets.length > MAX_ASSETS || !record(data.document)) throw invalid();
  const ids = new Set<string>(), paths = new Set<string>();
  let pixels = 0;
  const sources = data.assets.map(source => {
    if (!record(source) || !id(source.id) || ids.has(source.id) || typeof source.name !== 'string' || source.name.length > 1024 ||
      typeof source.path !== 'string' || !/^assets\/[0-9]+\.png$/.test(source.path) || paths.has(source.path) || !files[source.path]) throw invalid();
    ids.add(source.id); paths.add(source.path);
    const bytes = files[source.path], { width, height } = readPngSize(bytes);
    pixels += width * height;
    if (pixels > MAX_IMPORT_PIXELS) throw new Error('Project exceeds the decoded image pixel limit.');
    return { id: source.id, name: source.name, bytes, nativeW: width, nativeH: height };
  });
  if (sizes.size !== sources.length + 1) throw invalid();
  const raw = data.document;
  if (!Array.isArray(raw.placements) || (raw.background !== null && typeof raw.background !== 'string')) throw invalid();
  const placements = raw.placements.map((p: unknown): Placement => {
    if (!record(p) || !id(p.id) || !id(p.assetId) || typeof p.flipX !== 'boolean' || typeof p.flipY !== 'boolean' ||
      ![p.x, p.y, p.s, p.deg].every(v => typeof v === 'number' && Number.isFinite(v))) throw invalid();
    return { id: p.id, assetId: p.assetId, x: p.x, y: p.y, s: p.s, deg: p.deg, flipX: p.flipX, flipY: p.flipY } as Placement;
  });
  const doc = { W: raw.W, H: raw.H, mode: raw.mode, background: raw.background, placements } as RepeatDocument;
  validateDocument(doc, new Map(sources.map(source => [source.id, source])));
  return { doc, sources };
}

export async function encodeProject(doc: RepeatDocument, assets: NamedAsset[]): Promise<Blob> {
  assets = activeAssets(doc, assets);
  validateDocument(doc, new Map(assets.map(asset => [asset.id, asset])));
  const entries: Record<string, Uint8Array> = {};
  const sources = assets.map((asset, i) => ({ id: asset.id, name: asset.name, path: `assets/${i}.png` }));
  entries['project.json'] = strToU8(JSON.stringify({ format: 'selvedge-repeat', version: 1, document: { ...doc, sourceIds: undefined }, assets: sources }));
  if (entries['project.json'].length > MAX_MANIFEST_BYTES) throw new Error('Project metadata exceeds the size limit.');
  for (let i = 0; i < assets.length; i++) {
    const response = await fetch(assets[i].image.src);
    if (!response.ok) throw new Error(`Could not read source ${assets[i].name}.`);
    entries[sources[i].path] = new Uint8Array(await response.arrayBuffer());
  }
  return new Blob([zipSync(entries, { level: 0 })], { type: 'application/zip' });
}

export async function decodeProject(file: File) {
  if (file.size > MAX_PROJECT_BYTES) throw new Error('Project file exceeds the size limit.');
  const { doc, sources } = readProject(new Uint8Array(await file.arrayBuffer()));
  const budget = createImportBudget(), assets: NamedAsset[] = [];
  try {
    for (const source of sources) {
      const asset = await importPng(new File([new Uint8Array(source.bytes)], `${source.name}.png`, { type: 'image/png' }), budget);
      assets.push({ ...asset, id: source.id, name: source.name });
    }
    return { doc, assets, budget };
  } catch (error) { releaseAssets(assets); throw error; }
}

export const projectFingerprint = (doc: RepeatDocument, assets: NamedAsset[]) =>
  JSON.stringify([{ ...doc, sourceIds: undefined }, activeAssets(doc, assets).map(({ id, name }) => ({ id, name }))]);
