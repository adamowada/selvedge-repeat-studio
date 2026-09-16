import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const state = (page: Page) => page.evaluate(() => window.__studio!.state());
const source = path.resolve('public/demo/coral-stem.png');
async function onePlacement(page: Page) {
  await page.goto('/');
  await page.getByTestId('png-input').setInputFiles(source);
  await page.getByTestId('asset-card').click();
  await expect(page.getByTestId('placement-item')).toHaveCount(1);
}
async function emitColor(page: Page, color: string, accept: boolean) {
  await page.getByLabel('Background color', { exact: true }).evaluate((input: HTMLInputElement, { color, accept }) => {
    // Bypass React's value tracker exactly as a native input edit does.
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, color);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    if (accept) input.dispatchEvent(new Event('change', { bubbles: true }));
  }, { color, accept });
}

for (const gesture of ['nudge', 'drag'] as const) {
  test(`P2-01: delayed demo cannot consume a ${gesture} transaction; retry reuses assets`, async ({ page }) => {
    await onePlacement(page);
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let requested = 0;
    await page.route('**/demo/*.png', async route => {
      requested++;
      await gate;
      await route.fulfill({ path: path.resolve('public/demo', path.basename(new URL(route.request().url()).pathname)) });
    });
    await page.getByRole('button', { name: 'Add demo', exact: true }).click();
    await expect.poll(() => requested).toBe(3);
    const before = await state(page);
    await page.getByTestId('workspace').focus();
    if (gesture === 'nudge') await page.keyboard.down('ArrowRight');
    else {
      const host = (await page.getByTestId('canvas-host').boundingBox())!;
      const copy = await page.evaluate(() => {
        const s = window.__studio!.state();
        const selected = s.selection;
        if (!selected) throw new Error('Fixture placement is not selected.');
        return window.__studio!.copies().find(c => c.id === selected.id && c.i === selected.i && c.j === selected.j)!;
      });
      await page.mouse.move(host.x + copy.grab.x, host.y + copy.grab.y);
      await page.mouse.down();
      await page.mouse.move(host.x + copy.grab.x + 16, host.y + copy.grab.y + 12, { steps: 4 });
    }
    await expect.poll(async () => (await state(page)).gesturing).toBe(true);
    const during = await state(page);
    release();
    await expect(page.getByTestId('asset-card')).toHaveCount(4);
    await expect(page.getByRole('alert')).toContainText('Demo images are ready');
    const loaded = await state(page);
    expect(loaded.doc).toEqual({ ...during.doc, sourceIds: loaded.assets.map(asset => asset.id) });
    expect((await state(page)).gesturing).toBe(true);
    if (gesture === 'nudge') await page.keyboard.up('ArrowRight'); else await page.mouse.up();
    await expect.poll(async () => (await state(page)).gesturing).toBe(false);
    expect((await state(page)).past).toBe(before.past + 1);
    await page.getByRole('button', { name: 'Add demo', exact: true }).click();
    await expect(page.getByTestId('placement-item')).toHaveCount(4);
    expect((await state(page)).assets).toHaveLength(4);
    expect(requested).toBe(3);
  });
}

test('P2-02: wheel during held Space-pan preserves zoom and applies only the next screen delta', async ({ page }) => {
  await onePlacement(page);
  const before = await state(page);
  const host = (await page.getByTestId('canvas-host').boundingBox())!;
  await page.getByTestId('workspace').focus();
  await page.keyboard.down('Space');
  const x = host.x + host.width / 2, y = host.y + host.height / 2;
  await page.mouse.move(x, y); await page.mouse.down();
  await page.mouse.move(x + 20, y + 10);
  const beforeWheel = (await state(page)).camera;
  await page.mouse.wheel(0, -100);
  await expect.poll(async () => (await state(page)).camera.z).toBeGreaterThan(beforeWheel.z);
  const zoomed = (await state(page)).camera;
  await page.mouse.move(x + 33, y + 17);
  const moved = await state(page);
  expect(moved.camera.z).toBe(zoomed.z);
  expect(moved.camera.x).toBeCloseTo(zoomed.x + 13, 5);
  expect(moved.camera.y).toBeCloseTo(zoomed.y + 7, 5);
  expect(moved.doc).toEqual(before.doc); expect(moved.past).toBe(before.past);
  await page.mouse.up(); await page.keyboard.up('Space');
});

test('P2-02: resize cancels the active pan instead of restoring its old camera on the next move', async ({ page }) => {
  await onePlacement(page);
  const host = (await page.getByTestId('canvas-host').boundingBox())!;
  await page.getByTestId('workspace').focus(); await page.keyboard.down('Space');
  await page.mouse.move(host.x + 100, host.y + 100); await page.mouse.down();
  await page.mouse.move(host.x + 110, host.y + 110);
  await page.setViewportSize({ width: 1280, height: 850 });
  await expect.poll(async () => (await state(page)).size.width).not.toBe(Math.floor(host.width));
  const resized = await state(page);
  await page.mouse.move(host.x + 130, host.y + 120);
  expect((await state(page)).camera).toEqual(resized.camera);
  await page.mouse.up(); await page.keyboard.up('Space');
});

test('P2-03: native color accept commits while focused; input drafts and later blur add no extra entries', async ({ page }) => {
  await onePlacement(page); const before = await state(page);
  const color = page.getByLabel('Background color', { exact: true }); await color.focus();
  await emitColor(page, '#345678', false);
  expect((await state(page)).doc.background).toBe('#ffffff');
  await color.dispatchEvent('change');
  await expect(color).toBeFocused();
  expect((await state(page)).doc.background).toBe('#345678');
  expect((await state(page)).past).toBe(before.past + 1);
  await page.getByTestId('workspace').focus();
  expect((await state(page)).past).toBe(before.past + 1);
  await page.keyboard.press('Control+z');
  expect((await state(page)).doc.background).toBe('#ffffff');
});

test('P2-03: a busy accept cannot change the document or leave a misleading draft', async ({ page }) => {
  await onePlacement(page); await page.getByTestId('workspace').focus();
  await page.keyboard.down('ArrowRight');
  await expect(page.getByLabel('Background color', { exact: true })).toBeDisabled();
  await emitColor(page, '#123456', true);
  expect((await state(page)).doc.background).toBe('#ffffff');
  await expect(page.getByLabel('Background color', { exact: true })).toHaveValue('#ffffff');
  await page.keyboard.up('ArrowRight');
});

test('P2-03: same-task settings accept cannot overwrite a newer placement transform', async ({ page }) => {
  await onePlacement(page); const before = await state(page);
  await page.getByLabel('Background color', { exact: true }).focus();
  await page.evaluate(() => {
    const doc = window.__studio!.state().doc;
    const ok = window.__studio!.setDocument({ ...doc, placements: doc.placements.map(p => ({ ...p, x: p.x + 21 })) });
    if (!ok) throw new Error('Fixture transform was rejected.');
    const input = document.querySelector<HTMLInputElement>('input[type=color]')!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '#123456');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  const after = await state(page);
  expect(after.doc.placements[0].x).toBe(before.doc.placements[0].x + 21);
  expect(after.doc.background).toBe('#123456');
});

test('P2-04: source thumbnails are not native drag sources and non-file drops are canceled throughout the app', async ({ page }) => {
  await onePlacement(page); const before = await state(page);
  expect(await page.locator('.asset-sidebar img').evaluateAll(images => images.every(img => !(img as HTMLImageElement).draggable))).toBe(true);
  for (const selector of ['.canvas-host', '.app-header', 'input[aria-label="Cell width"]']) {
    const canceled = await page.locator(selector).evaluate(el => {
      const data = new DataTransfer(); data.setData('text/uri-list', 'https://example.invalid/unused.png');
      const over = new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: data });
      const drop = new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: data });
      el.dispatchEvent(over); el.dispatchEvent(drop);
      return over.defaultPrevented && drop.defaultPrevented;
    });
    expect(canceled).toBe(true);
  }
  expect((await state(page)).doc).toEqual(before.doc);
  expect((await state(page)).assets).toEqual(before.assets);
});

test('P2-04: canvas file drop still imports each valid file exactly once', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('canvas-host').evaluate((el, bytes) => {
    const data = new DataTransfer();
    data.items.add(new File([new Uint8Array(bytes)], 'dropped.png', { type: 'image/png' }));
    data.items.add(new File(['bad'], 'bad.png', { type: 'image/png' }));
    el.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: data }));
  }, Array.from(readFileSync(source)));
  await expect(page.getByTestId('asset-card')).toHaveCount(1);
  await expect(page.getByRole('alert')).toContainText('bad.png');
  expect((await state(page)).doc.placements).toHaveLength(0);
});

test('P2-05: download-initiation failure retains the old stale proof and permits retry', async ({ page }) => {
  await onePlacement(page);
  let downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export PNG', exact: true }).click(); await downloaded;
  await expect(page.getByTestId('proof-status')).toContainText('dimensions verified');
  const previous = await page.evaluate(() => window.__studio!.exportBytes());
  await page.getByTestId('workspace').focus(); await page.keyboard.press('ArrowRight');
  await page.evaluate(() => {
    const original = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      if (this.download.startsWith('selvedge-')) {
        HTMLAnchorElement.prototype.click = original;
        throw new Error('Deliberate download-initiation failure');
      }
      original.call(this);
    };
  });
  await page.getByRole('button', { name: 'Export PNG', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Deliberate download-initiation failure');
  expect(await page.evaluate(() => window.__studio!.exportBytes())).toEqual(previous);
  await expect(page.getByTestId('proof-stale')).toHaveText('Out of date');
  await expect(page.getByRole('button', { name: 'Export PNG', exact: true })).toBeEnabled();
  downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export PNG', exact: true }).click(); await downloaded;
  await expect(page.getByTestId('proof-stale')).toHaveCount(0);
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('P2-06: arrow chord is one snapshot, including repeated movement after the first key release', async ({ page }) => {
  await onePlacement(page); const before = await state(page);
  await page.keyboard.down('ArrowRight'); await page.keyboard.down('ArrowDown');
  await page.keyboard.up('ArrowRight');
  expect((await state(page)).gesturing).toBe(true);
  await page.keyboard.down('ArrowDown'); await page.keyboard.up('ArrowDown');
  const after = await state(page);
  expect(after.gesturing).toBe(false); expect(after.past).toBe(before.past + 1);
  expect(after.doc.placements[0]).toMatchObject({ x: before.doc.placements[0].x + 1, y: before.doc.placements[0].y + 2 });
  await page.keyboard.press('Control+z'); expect((await state(page)).doc).toEqual(before.doc);
  await page.keyboard.press('Control+Shift+z'); expect((await state(page)).doc).toEqual(after.doc);
});
