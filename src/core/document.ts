import type { CopyKey, NamedAsset, Placement, RepeatDocument } from './types';

export function activeAssets(doc: RepeatDocument, assets: NamedAsset[]) {
  if (!doc.sourceIds) return assets;
  const byId = new Map(assets.map(asset => [asset.id, asset]));
  return doc.sourceIds.flatMap(id => { const asset = byId.get(id); return asset ? [asset] : []; });
}

export function changePlacement(doc: RepeatDocument, id: string, update: Partial<Placement>): RepeatDocument {
  return { ...doc, placements: doc.placements.map(p => p.id === id ? { ...p, ...update, id: p.id, assetId: p.assetId } : p) };
}
export function reorderPlacement(doc: RepeatDocument, id: string, direction: 'front' | 'back'): RepeatDocument {
  const p = doc.placements.find(p => p.id === id);
  if (!p) return doc;
  const rest = doc.placements.filter(p => p.id !== id);
  return { ...doc, placements: direction === 'front' ? [...rest, p] : [p, ...rest] };
}
export function cleanSelection(doc: RepeatDocument, selection: CopyKey | null): CopyKey | null {
  return selection && doc.placements.some(p => p.id === selection.id) ? selection : null;
}
