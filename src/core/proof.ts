import { MAX_SIDE } from './types';

export async function drawProof(blob: Blob, canvas: HTMLCanvasElement, signal?: AbortSignal): Promise<void> {
  const image = await createImageBitmap(blob); // The exact download Blob, never the live scene.
  try {
    if (signal?.aborted) return;
    if (image.width > MAX_SIDE || image.height > MAX_SIDE) throw new Error('Proof image exceeds the pixel limit.');
    canvas.width = 576;
    canvas.height = 432;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('A canvas context is unavailable.');
    const pattern = context.createPattern(image, 'repeat');
    if (!pattern) throw new Error('The decoded PNG could not be tiled.');
    const scale = Math.min(canvas.width / (image.width * 3), canvas.height / (image.height * 3));
    pattern.setTransform(new DOMMatrix().scale(scale));
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = pattern;
    context.fillRect(0, 0, canvas.width, canvas.height);
  } finally { image.close(); }
}
