import type { Asset, Camera, Copy, Placement, Point, RepeatDocument, Bounds } from './types';
import type Konva from 'konva';

export const MIN_ZOOM = 0.02;
export const MAX_ZOOM = 8;
export const screenToModel = (point: Point, camera: Camera): Point => ({ x: (point.x - camera.x) / camera.z, y: (point.y - camera.y) / camera.z });
export const modelToScreen = (point: Point, camera: Camera): Point => ({ x: point.x * camera.z + camera.x, y: point.y * camera.z + camera.y });
export function viewportBounds(camera: Camera, width: number, height: number): Bounds {
  const a = screenToModel({ x: 0, y: 0 }, camera);
  const b = screenToModel({ x: width, y: height }, camera);
  return { left: a.x, top: a.y, right: b.x, bottom: b.y };
}
export function zoomAt(camera: Camera, pointer: Point, factor: number): Camera {
  const model = screenToModel(pointer, camera);
  const z = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, camera.z * factor));
  return { z, x: pointer.x - model.x * z, y: pointer.y - model.y * z };
}
export function fitCamera(doc: Pick<RepeatDocument, 'W' | 'H'>, width: number, height: number): Camera {
  const z = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, width / (doc.W * 3.1), height / (doc.H * 3.1)));
  return { z, x: width / 2 - doc.W * z / 2, y: height / 2 - doc.H * z / 2 };
}
// These props are used without alteration by both React-Konva and isolated export.
export function imageProps(p: Placement, asset: Asset, copy: Pick<Copy, 'tx' | 'ty'>) {
  return {
    image: asset.image, width: asset.nativeW, height: asset.nativeH,
    offsetX: asset.nativeW / 2, offsetY: asset.nativeH / 2,
    x: p.x + copy.tx, y: p.y + copy.ty, rotation: p.deg,
    scaleX: p.s * (p.flipX ? -1 : 1), scaleY: p.s * (p.flipY ? -1 : 1),
    perfectDrawEnabled: false,
    sceneFunc: asset.contentBounds ? (context: Konva.Context, shape: Konva.Shape) => {
      const { x, y, width, height } = asset.contentBounds!;
      if (!width || !height) return;
      // Downsampling filters can reach beyond a one-pixel transparent margin.
      // Preserve native-image sampling there; crop only when drawing at >=1:1.
      const scale = shape.getAbsoluteScale();
      if (Math.min(Math.abs(scale.x), Math.abs(scale.y)) < 1) context.drawImage(asset.image, 0, 0, asset.nativeW, asset.nativeH);
      else context.drawImage(asset.image, x, y, width, height, x, y, width, height);
    } : undefined,
  };
}
export interface NodeTransform { x: number; y: number; scaleX: number; scaleY: number; rotation: number }
export function placementFromNode(p: Placement, copy: Pick<Copy, 'tx' | 'ty'>, node: NodeTransform): Placement {
  // node.x/y already live in the model parent. DO NOT invert the camera here.
  return { ...p, x: node.x - copy.tx, y: node.y - copy.ty, s: Math.abs(node.scaleX), deg: node.rotation, flipX: node.scaleX < 0, flipY: node.scaleY < 0 };
}
