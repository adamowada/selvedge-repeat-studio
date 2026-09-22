import type Konva from 'konva';
import type { Studio } from './hooks/useStudio';
import type { Camera, RepeatDocument } from './core/types';
import { renderPixels } from './core/export';

export function makeSmokeBridge(read: () => Studio) {
  return {
    state: () => {
      const s = read();
      return { doc: s.historyRef.current.present, camera: s.camera, size: s.size, selection: s.selection,
        assets: s.assets.map(a => ({ id: a.id, name: a.name, nativeW: a.nativeW, nativeH: a.nativeH })),
        past: s.historyRef.current.past.length, future: s.historyRef.current.future.length, gesturing: s.historyRef.current.baseline !== null };
    },
    setDocument: (doc: RepeatDocument) => read().tryDocument(doc),
    setCamera: (camera: Camera) => read().tryCamera(camera),
    copies: () => (read().stageRef.current?.find('.motif-copy') ?? []).map(node => {
      const t = node.getAbsoluteTransform();
      const w = node.width(), h = node.height();
      return { id: node.getAttr('copyId') as string, i: node.getAttr('copyI') as number, j: node.getAttr('copyJ') as number,
        x: node.x(), y: node.y(), scaleX: node.scaleX(), scaleY: node.scaleY(), deg: node.rotation(),
        center: t.point({ x: w / 2, y: h / 2 }), grab: t.point({ x: w * .15, y: h * .15 }),
        rect: node.getClientRect(),
      };
    }),
    anchor: (name: string) => read().stageRef.current?.findOne<Konva.Transformer>('Transformer')?.findOne(`.${name}`)?.getAbsolutePosition(),
    exportArea: () => {
      const rect = read().stageRef.current?.findOne<Konva.Rect>('.export-area');
      return rect ? { x: rect.x(), y: rect.y(), width: rect.width(), height: rect.height(),
        screen: rect.getClientRect({ skipStroke: true }), listening: rect.listening() } : null;
    },
    exportBytes: async () => {
      const result = read().result;
      if (!result) throw new Error('No exported PNG.');
      return Array.from(new Uint8Array(await result.blob.arrayBuffer()));
    },
    reference: async (width: number, height: number) => {
      const s = read();
      const blob = await renderPixels(s.historyRef.current.present, s.assetMap, width, height);
      return Array.from(new Uint8Array(await blob.arrayBuffer()));
    },
  };
}
export type SmokeBridge = ReturnType<typeof makeSmokeBridge>;
declare global { interface Window { __studio?: SmokeBridge } }
