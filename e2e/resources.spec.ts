import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

test('source confirmation stays fully visible at the minimum window size', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 540 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Add demo', exact: true }).click();
  await expect(page.getByTestId('asset-card')).toHaveCount(3);
  const remove = page.getByRole('button', { name: 'Remove source coral-stem', exact: true });
  await remove.click();
  const confirmation = page.getByRole('group', { name: 'Confirm removal of coral-stem', exact: true });
  const bounds = (await confirmation.boundingBox())!;
  const scrollArea = (await page.locator('.source-content').boundingBox())!;
  expect(bounds.y).toBeGreaterThanOrEqual(scrollArea.y);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(scrollArea.y + scrollArea.height);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(scrollArea.x + scrollArea.width);
  await expect(confirmation.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(remove).toBeFocused();
});

test('inline source removal supports cancellation and undo; history expiry restores import capacity', async ({ page }) => {
  await page.goto('/');
  const buffer = readFileSync('public/demo/ochre-petal.png');
  await page.getByTestId('png-input').setInputFiles(Array.from({ length: 64 }, (_, i) => ({ name: `${i}.png`, mimeType: 'image/png', buffer })));
  await expect(page.getByTestId('asset-card')).toHaveCount(64);
  await page.getByTestId('png-input').setInputFiles({ name: 'overflow.png', mimeType: 'image/png', buffer });
  await expect(page.getByRole('alert')).toContainText('Source limit reached');
  await expect(page.getByTestId('asset-card')).toHaveCount(64);
  const sourceUrl = (await page.getByRole('button', { name: 'Place 0', exact: true }).locator('img').getAttribute('src'))!;
  const sourceReadable = () => page.evaluate(async url => {
    try { return (await fetch(url)).ok; } catch { return false; }
  }, sourceUrl);
  const remove = page.getByRole('button', { name: 'Remove source 0', exact: true });
  await expect(remove).toHaveText('');
  await remove.click();
  const confirmation = page.getByRole('group', { name: 'Confirm removal of 0', exact: true });
  await expect(confirmation).toContainText('You can undo this');
  await expect(confirmation.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(confirmation).toHaveCount(0); await expect(remove).toBeFocused();
  await expect(page.getByTestId('asset-card')).toHaveCount(64);
  await remove.press('Enter');
  await confirmation.getByRole('button', { name: 'Cancel', exact: true }).click();
  await remove.click();
  await confirmation.getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(page.getByTestId('asset-card')).toHaveCount(63);
  await page.keyboard.press('Control+z');
  await expect(page.getByTestId('asset-card')).toHaveCount(64);
  await page.keyboard.press('Control+Shift+z');
  await expect(page.getByTestId('asset-card')).toHaveCount(63);
  // Bytes still support undo; removal must not evade the session memory budget.
  await page.getByTestId('png-input').setInputFiles({ name: 'too-soon.png', mimeType: 'image/png', buffer });
  await expect(page.getByTestId('asset-card')).toHaveCount(63);
  await expect(page.getByRole('alert')).toContainText('Removed sources still needed for undo');
  await page.evaluate(() => { for (let i = 0; i < 49; i++) window.__studio!.setDocument({ ...window.__studio!.state().doc, W: 1001 + i }); });
  expect(await sourceReadable()).toBe(true);
  await page.getByTestId('png-input').setInputFiles({ name: 'still-too-soon.png', mimeType: 'image/png', buffer });
  await expect(page.getByRole('alert')).toContainText('still-too-soon.png: Source limit reached');
  await expect(page.getByTestId('asset-card')).toHaveCount(63);
  await page.evaluate(() => window.__studio!.setDocument({ ...window.__studio!.state().doc, W: 1050 }));
  // This exercises real disposal, not just thumbnail removal or a mocked callback.
  await expect.poll(sourceReadable).toBe(false);
  await page.getByTestId('png-input').setInputFiles({ name: 'replacement.png', mimeType: 'image/png', buffer });
  await expect(page.getByTestId('asset-card')).toHaveCount(64);
  await page.getByRole('button', { name: 'Place replacement', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Remove source replacement', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Remove source replacement', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByTestId('placement-item')).toHaveCount(1);
});

test('scale and rotation work from the keyboard with validation, cancellation and undo', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Add demo', exact: true }).click();
  await page.getByTestId('placement-item').first().click();
  const scale = page.getByLabel('Scale (%)', { exact: true });
  const rotation = page.getByLabel('Rotation (°)', { exact: true });
  await scale.fill('75'); await scale.press('Enter');
  await rotation.fill('-32.5'); await rotation.press('Enter');
  const selected = () => page.evaluate(() => { const s = window.__studio!.state(); return s.doc.placements.find(p => p.id === s.selection?.id)!; });
  expect(await selected()).toMatchObject({ s: .75, deg: -32.5 });
  await scale.fill('0'); await scale.press('Enter');
  expect((await selected()).s).toBe(.75);
  await expect(scale).toHaveValue('75');
  await rotation.fill('90'); await rotation.press('Escape');
  expect((await selected()).deg).toBe(-32.5);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  expect((await selected()).deg).not.toBe(-32.5);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  expect((await selected()).deg).toBe(-32.5);
});

test('alpha-bound optimization preserves pixels against untrimmed native-image rendering', async ({ page }) => {
  await page.goto('/');
  const differences = await page.evaluate(async () => {
    const pngModule = '/src/core/png.ts', exportModule = '/src/core/export.ts';
    const { importPng, releaseAssets } = await import(/* @vite-ignore */ pngModule) as typeof import('../src/core/png');
    const { renderPixels } = await import(/* @vite-ignore */ exportModule) as typeof import('../src/core/export');
    const source = document.createElement('canvas'); source.width = source.height = 64;
    const ctx = source.getContext('2d')!;
    ctx.fillStyle = '#ff805080'; ctx.fillRect(29, 18, 5, 23);
    ctx.fillStyle = '#308010'; ctx.fillRect(24, 22, 13, 9);
    const blob = await new Promise<Blob>(resolve => source.toBlob(blob => resolve(blob!)));
    const asset = await importPng(new File([blob], 'sparse.png'));
    async function pixels(blob: Blob) {
      const bitmap = await createImageBitmap(blob);
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 256;
      const context = canvas.getContext('2d')!; context.drawImage(bitmap, 0, 0); bitmap.close();
      return context.getImageData(0, 0, 256, 256).data;
    }
    try {
      const deltas: number[] = [];
      for (const s of [.03, .17, .5, 1, 1.37, 3]) for (const deg of [0, 31, 90]) {
        const doc = { W: 256, H: 256, mode: 'straight' as const, background: null, placements: [
          { id: 'p', assetId: asset.id, x: 123.7, y: 78.2, s, deg, flipX: true, flipY: false },
        ] };
        const trimmed = await pixels(await renderPixels(doc, new Map([[asset.id, asset]]), 256, 256));
        const native = await pixels(await renderPixels(doc, new Map([[asset.id, { ...asset, contentBounds: undefined }]]), 256, 256));
        let delta = 0;
        for (let i = 0; i < trimmed.length; i++) delta = Math.max(delta, Math.abs(trimmed[i] - native[i]));
        deltas.push(delta);
      }
      return deltas;
    } finally { releaseAssets([asset]); }
  });
  expect(differences).toEqual(Array(18).fill(0));
});
