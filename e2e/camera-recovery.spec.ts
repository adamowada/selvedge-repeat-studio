import { test, expect, type Page } from '@playwright/test';
import type { Mode } from '../src/core/types';

const state = (page: Page) => page.evaluate(() => window.__studio!.state());
const frame = (page: Page) => page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));

async function resizeCanvas(page: Page, width: number, height: number) {
  await page.getByTestId('canvas-host').evaluate((element, size) => {
    element.style.flex = 'none'; element.style.width = `${size.width}px`; element.style.height = `${size.height}px`;
  }, { width, height });
  await expect.poll(async () => (await state(page)).size).toEqual({ width, height });
  await frame(page);
}

async function setup(page: Page, mode: Mode, W = 100, H = 100, cx = 50, cy = 50) {
  await page.setViewportSize({ width: 2200, height: 1100 });
  await page.goto('/');
  await expect.poll(() => page.evaluate(() => !!window.__studio)).toBe(true);
  await resizeCanvas(page, 1000, 500);
  // A tiny generated alpha source, enlarged to the same 4096 × 4096 model
  // bounds as the native-size unit fixture. No large source bitmap is needed.
  await page.evaluate(async () => {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 32;
    const context = canvas.getContext('2d')!;
    context.fillStyle = 'rgba(190,70,90,.5)'; context.fillRect(7, 11, 1, 2);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('PNG fixture encoding failed')), 'image/png'));
    const data = new DataTransfer(); data.items.add(new File([blob], 'recovery.png', { type: 'image/png' }));
    document.querySelector('.upload-zone')!.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: data }));
    canvas.width = canvas.height = 0;
  });
  await expect(page.getByTestId('asset-card')).toHaveCount(1);
  expect(await page.evaluate(({ mode, W, H, cx, cy }) => {
    const bridge = window.__studio!;
    const { doc, assets } = bridge.state();
    if (!bridge.setCamera({ x: 500 - cx * 8, y: 250 - cy * 8, z: 8 })) return false;
    return bridge.setDocument({ ...doc, W, H, mode, background: null,
      placements: [{ id: 'recovery-motif', assetId: assets[0].id, x: 50, y: 50, s: 128, deg: 0, flipX: false, flipY: false }] });
  }, { mode, W, H, cx, cy })).toBe(true);
  await frame(page);
}

for (const mode of ['straight', 'half-drop', 'brick'] as const) {
  test(`${mode}: Undo/Redo and Fit recover the dense-cell counterexample without editing transforms`, async ({ page }) => {
    test.setTimeout(120_000);
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await setup(page, mode);
    const initial = await state(page);
    await page.getByLabel('Cell width', { exact: true }).fill('1000');
    await page.getByLabel('Cell width', { exact: true }).press('Enter');
    expect(await page.evaluate(() => window.__studio!.setCamera({ x: 490, y: 240, z: .2 }))).toBe(true);
    await frame(page);
    const enlarged = await state(page);
    expect(enlarged.doc.W).toBe(1000);
    expect(enlarged.doc.placements).toEqual(initial.doc.placements);
    await page.getByTestId('workspace').focus();
    await page.keyboard.press('Control+z');
    await frame(page);
    const restored = await state(page);
    expect(restored.doc).toEqual(initial.doc);
    expect(restored.camera).toEqual({ x: 340, y: 90, z: 3.2 });
    expect(restored.past).toBe(initial.past); expect(restored.future).toBe(1);
    const copyCount = mode === 'straight' ? 1935 : 1913;
    expect(await page.evaluate(() => window.__studio!.copies().length)).toBe(copyCount);
    await expect(page.locator('.canvas-error')).toHaveCount(0);
    // Redo uses the recovered camera rather than restoring camera history.
    await page.keyboard.press('Control+Shift+z'); await frame(page);
    expect((await state(page)).doc).toEqual(enlarged.doc);
    expect((await state(page)).camera).toEqual(restored.camera);
    await page.keyboard.press('Control+z'); await frame(page);
    expect((await state(page)).doc).toEqual(initial.doc);
    // Normal Fit is over budget in this scene; fallback must be count-aware.
    const beforeFit = await state(page);
    await page.getByRole('button', { name: 'Fit', exact: true }).click(); await frame(page);
    const fitted = await state(page);
    expect(fitted.camera.z).toBeCloseTo(100 / 31);
    expect((500 - fitted.camera.x) / fitted.camera.z).toBeCloseTo(50);
    expect((250 - fitted.camera.y) / fitted.camera.z).toBeCloseTo(50);
    expect(fitted.doc).toEqual(beforeFit.doc);
    expect(fitted.past).toBe(beforeFit.past); expect(fitted.future).toBe(beforeFit.future);
    expect(await page.evaluate(() => window.__studio!.copies().length)).toBe(copyCount);
    // Editing the restored placement remains possible and records one edit.
    await page.getByTestId('placement-item').click();
    await page.keyboard.press('ArrowRight'); await frame(page);
    const edited = await state(page);
    expect(edited.doc.placements[0]).toEqual({ ...initial.doc.placements[0], x: 51 });
    expect(edited.past).toBe(beforeFit.past + 1); expect(edited.future).toBe(0);
    expect(await page.evaluate(() => window.__studio!.copies().length)).toBeLessThanOrEqual(2000);
    expect(errors).toEqual([]);
  });
}

test('ResizeObserver expansion recovers the view without adding a history entry', async ({ page }) => {
  test.setTimeout(120_000);
  await setup(page, 'straight');
  expect(await page.evaluate(() => window.__studio!.setCamera({ x: 340, y: 90, z: 3.2 }))).toBe(true);
  await frame(page);
  const before = await state(page);
  await resizeCanvas(page, 1600, 1000);
  const after = await state(page);
  expect(after.camera).toEqual({ x: 480, y: 180, z: 6.4 });
  expect(after.doc).toEqual(before.doc);
  expect(after.past).toBe(before.past); expect(after.future).toBe(before.future);
  expect(await page.evaluate(() => window.__studio!.copies().length)).toBe(1849); // 43 × 43
  await expect(page.locator('.canvas-error')).toHaveCount(0);
});

test('At maximum zoom, an unrecoverable center does not lock out Space-pan to a safe center', async ({ page }) => {
  test.setTimeout(120_000);
  await setup(page, 'straight', 95, 94, 97.5, 97);
  const before = await state(page);
  expect(await page.evaluate(() => window.__studio!.copies().length)).toBe(1936); // 44 × 44
  await resizeCanvas(page, 1500, 500);
  // Same center now needs 46 × 44 = 2024 copies, even at 800%.
  await expect(page.locator('.canvas-error')).toContainText('800%');
  expect(await page.evaluate(() => window.__studio!.copies().length)).toBe(0);
  const host = await page.getByTestId('canvas-host').boundingBox();
  expect(host).toBeTruthy();
  await page.getByTestId('workspace').focus();
  await page.keyboard.down('Space');
  await page.mouse.move(host!.x + 750, host!.y + 250); await page.mouse.down();
  await page.mouse.move(host!.x + 1130, host!.y + 250, { steps: 12 }); await page.mouse.up();
  await page.keyboard.up('Space'); await frame(page);
  const after = await state(page);
  expect(after.camera.z).toBe(8);
  expect((750 - after.camera.x) / 8).toBeCloseTo(50);
  expect((250 - after.camera.y) / 8).toBeCloseTo(97);
  expect(await page.evaluate(() => window.__studio!.copies().length)).toBe(1980); // 45 × 44
  expect(after.doc).toEqual(before.doc);
  expect(after.past).toBe(before.past); expect(after.future).toBe(before.future);
  await expect(page.locator('.canvas-error')).toHaveCount(0);
});

test('Redo itself can restore the dense document and must recover against that document', async ({ page }) => {
  test.setTimeout(120_000);
  await setup(page, 'straight', 1000, 100);
  await page.getByLabel('Cell width', { exact: true }).fill('100');
  await page.getByLabel('Cell width', { exact: true }).press('Enter');
  const dense = await state(page);
  await page.getByTestId('workspace').focus();
  await page.keyboard.press('Control+z');
  expect((await state(page)).doc.W).toBe(1000);
  expect(await page.evaluate(() => window.__studio!.setCamera({ x: 490, y: 240, z: .2 }))).toBe(true);
  await frame(page);
  await page.keyboard.press('Control+Shift+z'); await frame(page);
  const after = await state(page);
  expect(after.doc).toEqual(dense.doc);
  expect(after.camera).toEqual({ x: 340, y: 90, z: 3.2 });
  expect(after.past).toBe(dense.past); expect(after.future).toBe(0);
  expect(await page.evaluate(() => window.__studio!.copies().length)).toBe(1935);
  await expect(page.locator('.canvas-error')).toHaveCount(0);
});
