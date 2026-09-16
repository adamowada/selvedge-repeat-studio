import type { Asset, Placement, RepeatDocument } from '../src/core/types';

export const asset = (nativeW = 20, nativeH = 20): Asset => ({ id: 'a', nativeW, nativeH, image: {} as HTMLImageElement });
export const placement = (patch: Partial<Placement> = {}): Placement => ({ id: 'p', assetId: 'a', x: 0, y: 0, s: 1, deg: 0, flipX: false, flipY: false, ...patch });
export const document = (patch: Partial<RepeatDocument> = {}): RepeatDocument => ({ W: 100, H: 100, mode: 'straight', background: null, placements: [placement()], ...patch });
