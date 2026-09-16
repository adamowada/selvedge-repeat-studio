import { CopyLimitError, padBounds, preflightCopies } from './geometry';
import { MAX_ZOOM, MIN_ZOOM, viewportBounds, zoomAt } from './transforms';
import { MAX_COPIES, type AssetMap, type Camera, type CopyKey, type RepeatDocument } from './types';

export interface ViewSize { width: number; height: number }

// Rendering and all camera checks must use the same one-screen-pixel margin.
export function renderViewBounds(camera: Camera, size: ViewSize) {
  if (![camera.x, camera.y, camera.z].every(Number.isFinite) || camera.z < MIN_ZOOM || camera.z > MAX_ZOOM) {
    throw new Error('Zoom is outside its supported range.');
  }
  if (![size.width, size.height].every(n => Number.isFinite(n) && n > 0)) throw new Error('Invalid viewport size.');
  return padBounds(viewportBounds(camera, size.width, size.height), 1 / camera.z);
}

export function preflightCamera(doc: RepeatDocument, assets: AssetMap, camera: Camera, size: ViewSize, pin?: CopyKey | null) {
  return preflightCopies(doc, assets, renderViewBounds(camera, size), pin);
}

// Try nested views about the requested center, including MAX_ZOOM. At most
// ten analytic preflights across the entire zoom range; no copies/nodes allocated.
// A safe request is returned unchanged. Only density failures are recoverable.
export function recoverCamera(doc: RepeatDocument, assets: AssetMap, requested: Camera, size: ViewSize, pin?: CopyKey | null): Camera {
  let candidate = requested;
  const center = { x: size.width / 2, y: size.height / 2 };
  for (;;) {
    try {
      preflightCamera(doc, assets, candidate, size, pin);
      return candidate;
    } catch (error) {
      if (!(error instanceof CopyLimitError)) throw error;
      if (candidate.z === MAX_ZOOM) {
        throw new CopyLimitError(`No view at this center fits the ${MAX_COPIES.toLocaleString()}-copy limit up to ${MAX_ZOOM * 100}% zoom. Pan to a less dense area, enlarge the cell, or reduce motif size/count.`);
      }
    }
    candidate = zoomAt(candidate, center, 2);
  }
}

// Preserve a safe view when navigation would exceed the budget. But once a
// resize/history change has made the CURRENT view too dense, camera navigation
// must remain possible: intermediate rejected scenes still allocate zero copies.
export function navigateCamera(doc: RepeatDocument, assets: AssetMap, current: Camera, requested: Camera, size: ViewSize, pin?: CopyKey | null): { camera: Camera; error: string | null } {
  try {
    preflightCamera(doc, assets, requested, size, pin);
    return { camera: requested, error: null };
  } catch (error) {
    if (!(error instanceof CopyLimitError)) throw error;
    try {
      preflightCamera(doc, assets, current, size, pin);
    } catch (currentError) {
      if (currentError instanceof CopyLimitError) return { camera: requested, error: error.message };
    }
    throw error;
  }
}
