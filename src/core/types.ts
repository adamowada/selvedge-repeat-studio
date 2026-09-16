export type Mode = 'straight' | 'half-drop' | 'brick';

export interface Asset {
  id: string;
  image: HTMLImageElement;
  nativeW: number;
  nativeH: number;
  contentBounds?: { x: number; y: number; width: number; height: number };
}
export interface NamedAsset extends Asset { name: string; dispose?: () => void }
export interface Placement {
  id: string;
  assetId: string;
  x: number;
  y: number;
  s: number;
  deg: number;
  flipX: boolean;
  flipY: boolean;
}
export interface RepeatDocument {
  // Session visibility is undoable; project files use their assets list instead.
  sourceIds?: string[];
  W: number;
  H: number;
  mode: Mode;
  background: string | null;
  placements: Placement[];
}
export type DocumentSettings = Pick<RepeatDocument, 'W' | 'H' | 'mode' | 'background'>;
export interface Point { x: number; y: number }
export interface Camera extends Point { z: number }
export interface Bounds { left: number; top: number; right: number; bottom: number }
export interface CopyKey { id: string; i: number; j: number }
export interface Copy extends CopyKey { tx: number; ty: number }
export type AssetMap = ReadonlyMap<string, Asset>;
export const MAX_SIDE = 4096;
export const MAX_COPIES = 2000;
export const INITIAL_DOCUMENT: RepeatDocument = {
  W: 1000, H: 1000, mode: 'straight', background: '#ffffff', placements: [],
};
export const copyKey = (c: CopyKey) => `${c.id}:${c.i}:${c.j}`;
export const sameCopy = (a: CopyKey, b: CopyKey) => a.id === b.id && a.i === b.i && a.j === b.j;
