import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Mode } from '../src/core/types';

const demo = (name: string) => path.resolve('public/demo', name);
const state = (page: Page) => page.evaluate(() => window.__studio!.state());
const frame = (page: Page) => page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
async function loadDemo(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Add demo', exact: true }).click();
  await expect(page.getByTestId('asset-card')).toHaveCount(3);
  await expect(page.getByTestId('placement-item')).toHaveCount(3);
  await frame(page);
}
async function hostOrigin(page: Page) {
  const box = await page.getByTestId('canvas-host').boundingBox();
  if (!box) throw new Error('Canvas is not visible.');
  return { x: box.x, y: box.y };
}
async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  const host = await hostOrigin(page);
  await page.mouse.move(host.x + from.x, host.y + from.y);
  await page.mouse.down();
  await page.mouse.move(host.x + to.x, host.y + to.y, { steps: 12 });
  await page.mouse.up();
  await frame(page);
}
async function downloadAndDecode(page: Page, width: number, height: number) {
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export PNG', exact: true }).click();
  const download = await downloadPromise;
  const file = await download.path();
  if (!file) throw new Error('No download path.');
  const bytes = Array.from(readFileSync(file));
  const decoded = await page.evaluate(async bytes => {
    const bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: 'image/png' }));
    const result = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return result;
  }, bytes);
  expect(decoded).toEqual({ width, height });
  // Proof and download must refer to the very same encoded bytes.
  expect(await page.evaluate(() => window.__studio!.exportBytes())).toEqual(bytes);
  await expect(page.getByTestId('proof-status')).toHaveText('Decoded PNG · dimensions verified');
  expect(await page.getByTestId('export-proof').evaluate((node: HTMLCanvasElement) => [node.width, node.height])).toEqual([576, 432]);
  return bytes;
}

test('demo, batch import/drop, validation, placement operations and workspace-only keys', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await loadDemo(page);
  // One bad file does not discard valid files in the same batch.
  await page.getByTestId('png-input').setInputFiles([
    { name: 'not-a-png.png', mimeType: 'image/png', buffer: Buffer.from('not a PNG') },
    { name: 'imported.png', mimeType: 'image/png', buffer: readFileSync(demo('ochre-petal.png')) },
  ]);
  await expect(page.getByTestId('asset-card')).toHaveCount(4);
  await expect(page.getByRole('alert')).toContainText('not-a-png.png');
  await page.getByRole('button', { name: 'Dismiss import errors' }).click();
  const bytes = Array.from(readFileSync(demo('sage-sprig.png')));
  await page.evaluate(bytes => {
    const data = new DataTransfer();
    data.items.add(new File([new Uint8Array(bytes)], 'dropped.png', { type: 'image/png' }));
    document.querySelector('.upload-zone')!.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: data }));
  }, bytes);
  await expect(page.getByTestId('asset-card')).toHaveCount(5);
  await page.getByTestId('asset-card').last().click();
  let s = await state(page);
  const p = s.doc.placements.at(-1)!;
  expect(p.assetId).toBe(s.assets.at(-1)!.id);
  expect(p.x).toBeCloseTo((s.size.width / 2 - s.camera.x) / s.camera.z, 6);
  expect(p.y).toBeCloseTo((s.size.height / 2 - s.camera.y) / s.camera.z, 6);
  expect(p.s).toBeGreaterThan(0); expect(p.s).toBeLessThanOrEqual(1);
  await page.keyboard.press('Control+d');
  s = await state(page);
  expect(s.doc.placements.at(-1)).toMatchObject({ assetId: p.assetId, x: p.x + 24, y: p.y + 24 });
  expect(s.selection!.id).toBe(s.doc.placements.at(-1)!.id);
  const duplicateId = s.selection!.id;
  const beforeArrow = s.doc.placements.at(-1)!;
  await page.keyboard.press('ArrowRight'); await page.keyboard.press('Shift+ArrowDown');
  s = await state(page);
  expect(s.doc.placements.at(-1)).toMatchObject({ x: beforeArrow.x + 1, y: beforeArrow.y + 10 });
  await page.getByRole('button', { name: 'Send to back', exact: true }).click();
  expect((await state(page)).doc.placements[0].id).toBe(duplicateId);
  await page.getByRole('button', { name: 'Bring to front', exact: true }).click();
  expect((await state(page)).doc.placements.at(-1)!.id).toBe(duplicateId);
  const docBeforeInput = (await state(page)).doc;
  await page.getByLabel('Cell width', { exact: true }).focus();
  await page.keyboard.press('ArrowRight'); await page.keyboard.press('Delete'); await page.keyboard.press('Control+d');
  expect((await state(page)).doc.placements).toEqual(docBeforeInput.placements);
  // Restore its draft without committing and test an invalid integer commit.
  await page.getByLabel('Cell width', { exact: true }).fill('0');
  await page.getByLabel('Cell width', { exact: true }).press('Enter');
  expect((await state(page)).doc.W).toBe(1000);
  await expect(page.getByRole('alert')).toContainText('whole pixels');
  await page.getByRole('button', { name: 'Dismiss workspace message' }).click();
  await page.getByTestId('workspace').focus();
  await page.keyboard.press('Delete');
  expect((await state(page)).selection).toBeNull();
  const count = (await state(page)).doc.placements.length;
  await page.keyboard.press('Control+z');
  expect((await state(page)).doc.placements).toHaveLength(count + 1);
  expect((await state(page)).assets).toHaveLength(5); // Assets never enter history.
  await page.keyboard.press('Control+Shift+z');
  expect((await state(page)).doc.placements).toHaveLength(count);
  expect(errors).toEqual([]);
});

for (const mode of ['straight', 'half-drop', 'brick'] as Mode[]) {
  test(`${mode}: noncentral-copy corner drag under zoom/pan, transform, flip, history, export`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    await loadDemo(page);
    await page.getByRole('button', { name: mode === 'straight' ? 'Straight' : mode === 'half-drop' ? 'Half-drop' : 'Brick', exact: true }).click();
    // Leave one motif to make an off-center corner hit unambiguous. All actual
    // gestures below are real mouse/keyboard input, not document injection.
    await page.getByTestId('placement-item').first().click();
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    await page.getByTestId('placement-item').first().click();
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    const first = (await state(page)).doc.placements[0];
    const original = { ...first };
    const host = await hostOrigin(page);
    const size = (await state(page)).size;
    const pointer = { x: Math.floor(size.width * .65), y: Math.floor(size.height * .48) };
    const preZoom = (await state(page)).camera;
    const modelUnderPointer = { x: (pointer.x - preZoom.x) / preZoom.z, y: (pointer.y - preZoom.y) / preZoom.z };
    await page.mouse.move(host.x + pointer.x, host.y + pointer.y);
    await page.mouse.wheel(0, -170);
    await frame(page);
    const postZoom = (await state(page)).camera;
    expect((pointer.x - postZoom.x) / postZoom.z).toBeCloseTo(modelUnderPointer.x, 6);
    expect((pointer.y - postZoom.y) / postZoom.z).toBeCloseTo(modelUnderPointer.y, 6);
    await page.getByTestId('workspace').focus();
    await page.keyboard.down('Space');
    await drag(page, { x: size.width / 2, y: size.height / 2 }, { x: size.width / 2 + 31, y: size.height / 2 - 23 });
    await page.keyboard.up('Space');
    const afterPan = await state(page);
    expect(afterPan.doc.placements[0]).toEqual(original);
    expect(afterPan.camera.x).toBeCloseTo(postZoom.x + 31, 4);
    expect(afterPan.camera.y).toBeCloseTo(postZoom.y - 23, 4);
    const copies = await page.evaluate(() => window.__studio!.copies());
    const copy = copies.find(c => (c.i !== 0 || c.j !== 0) && c.grab.x > 75 && c.grab.y > 75 && c.grab.x < size.width - 90 && c.grab.y < size.height - 90);
    expect(copy, 'There must be a visible noncentral copy').toBeTruthy();
    const before = await state(page);
    await drag(page, copy!.grab, { x: copy!.grab.x + 37, y: copy!.grab.y + 29 });
    const after = await state(page);
    expect(after.doc.placements[0].x).toBeCloseTo(original.x + 37 / before.camera.z, 3);
    expect(after.doc.placements[0].y).toBeCloseTo(original.y + 29 / before.camera.z, 3);
    expect(after.selection).toMatchObject({ id: first.id, i: copy!.i, j: copy!.j });
    expect(after.past).toBe(before.past + 1);
    expect(after.gesturing).toBe(false);
    // All copies must be derived from the updated source, with no jump or modulo.
    const live = await page.evaluate(() => window.__studio!.copies());
    for (const c of live) {
      const tx = c.i * 1000 + (mode === 'brick' ? c.j * 500 : 0);
      const ty = c.j * 1000 + (mode === 'half-drop' ? c.i * 500 : 0);
      expect(c.x).toBeCloseTo(after.doc.placements[0].x + tx, 5);
      expect(c.y).toBeCloseTo(after.doc.placements[0].y + ty, 5);
    }
    await page.keyboard.press('Control+z');
    expect((await state(page)).doc.placements[0]).toEqual(original);
    await page.keyboard.press('Control+Shift+z');
    expect((await state(page)).doc.placements[0]).toEqual(after.doc.placements[0]);
    const anchor = await page.evaluate(() => window.__studio!.anchor('bottom-right'));
    expect(anchor).toBeTruthy();
    const center = (await page.evaluate(() => window.__studio!.copies())).find(c => c.id === first.id && c.i === copy!.i && c.j === copy!.j)!.center;
    await drag(page, anchor!, { x: center.x + (anchor!.x - center.x) * 1.35, y: center.y + (anchor!.y - center.y) * 1.35 });
    const resized = await state(page);
    expect(resized.doc.placements[0].s).toBeGreaterThan(after.doc.placements[0].s);
    expect(resized.doc.placements[0].flipX).toBe(false); expect(resized.doc.placements[0].flipY).toBe(false);
    const selectedCopy = (await page.evaluate(() => window.__studio!.copies())).find(c => c.id === first.id && c.i === copy!.i && c.j === copy!.j)!;
    expect(Math.abs(selectedCopy.scaleX)).toBeCloseTo(Math.abs(selectedCopy.scaleY), 6);
    const rotater = await page.evaluate(() => window.__studio!.anchor('rotater'));
    expect(rotater).toBeTruthy();
    const angle = .4;
    const dx = rotater!.x - selectedCopy.center.x, dy = rotater!.y - selectedCopy.center.y;
    await drag(page, rotater!, { x: selectedCopy.center.x + dx * Math.cos(angle) - dy * Math.sin(angle), y: selectedCopy.center.y + dx * Math.sin(angle) + dy * Math.cos(angle) });
    expect(Math.abs((await state(page)).doc.placements[0].deg - resized.doc.placements[0].deg)).toBeGreaterThan(5);
    await page.getByRole('button', { name: 'Flip horizontal', exact: true }).click();
    await page.getByRole('button', { name: 'Flip vertical', exact: true }).click();
    expect((await state(page)).doc.placements[0]).toMatchObject({ flipX: true, flipY: true });
    const transformsBeforeCell = (await state(page)).doc.placements;
    await page.getByLabel('Cell width', { exact: true }).fill('501'); await page.getByLabel('Cell width', { exact: true }).press('Enter');
    await page.getByLabel('Cell height', { exact: true }).fill('403'); await page.getByLabel('Cell height', { exact: true }).press('Enter');
    expect((await state(page)).doc.placements).toEqual(transformsBeforeCell);
    await page.getByRole('button', { name: 'Inspect', exact: true }).click();
    expect(await page.evaluate(() => window.__studio!.anchor('bottom-right'))).toBeDefined();
    await downloadAndDecode(page, mode === 'half-drop' ? 1002 : 501, mode === 'brick' ? 806 : 403);
    expect(errors).toEqual([]);
  });
}

for (const mode of ['straight', 'half-drop', 'brick'] as Mode[]) {
  test(`${mode}: tiled decoded translucent PNG matches a larger reference region`, async ({ page }) => {
    await loadDemo(page);
    const initial = await state(page);
    const ok = await page.evaluate(({ doc, assets, mode }) => {
      // Hand-chosen overlapping placements cross both axes, include negative
      // centers, rotation, flips and images larger than the 101×83 cell.
      return window.__studio!.setDocument({ ...doc, W: 101, H: 83, mode, background: null, placements: [
        { id: 'alpha-a', assetId: assets[2].id, x: -14, y: 6, s: .75, deg: 27, flipX: false, flipY: true },
        { id: 'alpha-b', assetId: assets[2].id, x: 63, y: 67, s: .56, deg: -19, flipX: true, flipY: false },
        { id: 'stem', assetId: assets[0].id, x: 49, y: 21, s: .31, deg: 63, flipX: false, flipY: false },
      ] });
    }, { doc: initial.doc, assets: initial.assets, mode });
    // The old wide camera could exceed the copy limit for a dense fixture.
    // Zoom first, then retry the fixture, still through the same validation.
    if (!ok) {
      await page.evaluate(() => window.__studio!.setCamera({ x: 100, y: 100, z: 2 }));
      expect(await page.evaluate(({ doc, assets, mode }) => window.__studio!.setDocument({ ...doc, W: 101, H: 83, mode, background: null, placements: [
        { id: 'alpha-a', assetId: assets[2].id, x: -14, y: 6, s: .75, deg: 27, flipX: false, flipY: true },
        { id: 'alpha-b', assetId: assets[2].id, x: 63, y: 67, s: .56, deg: -19, flipX: true, flipY: false },
        { id: 'stem', assetId: assets[0].id, x: 49, y: 21, s: .31, deg: 63, flipX: false, flipY: false },
      ] }), { doc: initial.doc, assets: initial.assets, mode })).toBe(true);
    }
    const width = mode === 'half-drop' ? 202 : 101;
    const height = mode === 'brick' ? 166 : 83;
    const tileBytes = await downloadAndDecode(page, width, height);
    const referenceBytes = await page.evaluate(({ width, height }) => window.__studio!.reference(width * 3, height * 3), { width, height });
    const comparison = await page.evaluate(async ({ tileBytes, referenceBytes, width, height }) => {
      const tile = await createImageBitmap(new Blob([new Uint8Array(tileBytes)], { type: 'image/png' }));
      const reference = await createImageBitmap(new Blob([new Uint8Array(referenceBytes)], { type: 'image/png' }));
      try {
        const tiled = document.createElement('canvas'), expected = document.createElement('canvas');
        tiled.width = expected.width = width * 3; tiled.height = expected.height = height * 3;
        const a = tiled.getContext('2d')!, b = expected.getContext('2d')!;
        for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) a.drawImage(tile, i * width, j * height);
        b.drawImage(reference, 0, 0);
        const av = a.getImageData(0, 0, tiled.width, tiled.height).data;
        const bv = b.getImageData(0, 0, tiled.width, tiled.height).data;
        let total = 0, max = 0, badPixels = 0, translucent = 0;
        for (let i = 0; i < av.length; i += 4) {
          let pixelMax = Math.abs(av[i + 3] - bv[i + 3]);
          // Compare premultiplied RGB to avoid meaningless unassociated color
          // noise at near-zero alpha. Both images are rendered at native 1×.
          for (let c = 0; c < 3; c++) pixelMax = Math.max(pixelMax, Math.abs(av[i + c] * av[i + 3] / 255 - bv[i + c] * bv[i + 3] / 255));
          total += pixelMax; max = Math.max(max, pixelMax);
          if (pixelMax > 8) badPixels++;
          if (bv[i + 3] > 20 && bv[i + 3] < 245) translucent++;
        }
        return { mean: total / (av.length / 4), max, badFraction: badPixels / (av.length / 4), translucent };
      } finally { tile.close(); reference.close(); }
    }, { tileBytes, referenceBytes, width, height });
    expect(comparison.translucent).toBeGreaterThan(1000);
    expect(comparison.mean).toBeLessThan(.7);
    expect(comparison.badFraction).toBeLessThan(.012);
    expect(comparison.max).toBeLessThan(65);
    // This is whole-image comparison against a larger render, not opposite-edge
    // equality (which is neither necessary nor sufficient for a valid repeat).
  });
}

test('translucent overlap preserves source-over alpha in the PNG', async ({ page }) => {
  await loadDemo(page);
  await page.evaluate(() => window.__studio!.setCamera({ x: 100, y: 100, z: 1 }));
  expect(await page.evaluate(() => {
    const { doc, assets } = window.__studio!.state();
    const p = { id: 'one', assetId: assets[2].id, x: 110, y: 100, s: 1, deg: 0, flipX: false, flipY: false };
    return window.__studio!.setDocument({ ...doc, W: 512, H: 512, mode: 'straight', background: null, placements: [p, { ...p, id: 'two' }] });
  })).toBe(true);
  const bytes = await downloadAndDecode(page, 512, 512);
  const alpha = await page.evaluate(async bytes => {
    const bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: 'image/png' }));
    try {
      const c = document.createElement('canvas'); c.width = c.height = 512;
      const ctx = c.getContext('2d')!; ctx.drawImage(bitmap, 0, 0);
      return ctx.getImageData(80, 100, 1, 1).data[3];
    } finally { bitmap.close(); }
  }, bytes);
  // Fixture alpha at (80,100) is 184. Source-over twice gives
  // 184 + 184 × (1 - 184/255) = 235.231... (8-bit rounding tolerance).
  expect(Math.abs(alpha - 235)).toBeLessThanOrEqual(1);
});
