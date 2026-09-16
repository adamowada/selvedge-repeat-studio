import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const state = (page: Page) => page.evaluate(() => window.__studio!.state());
async function demo(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Start with demo', exact: true }).click();
  await expect(page.getByTestId('placement-item')).toHaveCount(3);
  await page.getByTestId('placement-item').last().click();
}

for (const width of [900, 960, 1280, 1480]) {
  test(`utility layout at ${width}px: no clipped controls, visible groups and selection identity`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await demo(page);
    await expect(page.locator('.selection-context')).toContainText('coral-stem');
    await expect(page.locator('.upload-zone')).toHaveClass(/compact/);
    await expect(page.getByRole('heading', { name: 'Inspector', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Bring to front', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Send to back', exact: true })).toBeVisible();
    const metrics = await page.evaluate(() => {
      const el = (s: string) => document.querySelector<HTMLElement>(s)!;
      const groups = ['.app-header', '.document-toolbar', '.canvas-toolbar', '.canvas-footer', '.output-summary'];
      return {
        pageOverflow: document.documentElement.scrollWidth > innerWidth,
        groupOverflow: groups.filter(s => el(s).scrollWidth > el(s).clientWidth + 1),
        canvasWidth: el('.canvas-host').clientWidth,
        headerHeight: el('.app-header').offsetHeight,
        inspectorFirst: el('.output-sidebar').firstElementChild?.classList.contains('selection-section'),
        tinyText: [...document.querySelectorAll<HTMLElement>('button, p, small, dt, dd')]
          .filter(e => e.checkVisibility() && parseFloat(getComputedStyle(e).fontSize) < 10).length,
      };
    });
    expect(metrics.pageOverflow).toBe(false);
    expect(metrics.groupOverflow).toEqual([]);
    expect(metrics.canvasWidth).toBeGreaterThanOrEqual(400);
    expect(metrics.headerHeight).toBe(48);
    expect(metrics.inspectorFirst).toBe(true);
    expect(metrics.tinyText).toBe(0);
  });
}

test('empty controls, compact batch import and selection transform feedback', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'No placements yet' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Delete', exact: true })).toHaveCount(0);
  await page.getByTestId('png-input').setInputFiles([
    { name: 'broken.png', mimeType: 'image/png', buffer: Buffer.from('not png') },
    { name: 'source.png', mimeType: 'image/png', buffer: readFileSync(path.resolve('public/demo/coral-stem.png')) },
  ]);
  await expect(page.getByTestId('asset-card')).toHaveCount(1);
  await expect(page.getByRole('alert')).toContainText('broken.png');
  await expect(page.locator('.upload-zone')).toContainText('Add PNGs');
  await page.getByTestId('asset-card').click();
  await page.getByRole('button', { name: 'Flip horizontal', exact: true }).click();
  await expect(page.getByTestId('selected-flips')).toHaveText('H flipped');
  await page.getByRole('button', { name: 'Flip vertical', exact: true }).click();
  await expect(page.getByTestId('selected-flips')).toHaveText('H + V flipped');
  await page.keyboard.press('Control+z');
  await expect(page.getByTestId('selected-flips')).toHaveText('H flipped');
  await page.keyboard.press('Control+Shift+z');
  await expect(page.getByTestId('selected-flips')).toHaveText('H + V flipped');
});

test('background is one control, remembers last color and validates on commit', async ({ page }) => {
  await demo(page);
  const before = (await state(page)).doc.placements;
  const color = page.getByLabel('Background color', { exact: true });
  await color.fill('#345678');
  await page.getByLabel('Cell width', { exact: true }).focus();
  expect((await state(page)).doc.background).toBe('#345678');
  await page.getByLabel('Transparent background', { exact: true }).check();
  expect((await state(page)).doc.background).toBeNull();
  await expect(color).toBeDisabled();
  await page.getByLabel('Transparent background', { exact: true }).uncheck();
  expect((await state(page)).doc.background).toBe('#345678');
  await expect(color).toBeEnabled();
  const field = page.getByLabel('Cell width', { exact: true });
  await field.fill('1.5'); await field.press('Enter');
  await expect(field).toHaveValue('1000');
  await expect(page.getByRole('alert')).toContainText('whole pixels');
  expect((await state(page)).doc.placements).toEqual(before);
});

test('Fit/Inspect focus, Space mode and gesture lock do not masquerade as exporting', async ({ page }) => {
  await demo(page);
  await page.getByRole('button', { name: 'Inspect', exact: true }).click();
  await expect(page.getByTestId('workspace')).toBeFocused();
  await expect(page.getByRole('button', { name: 'Inspect', exact: true })).toHaveAttribute('aria-pressed', 'true');
  const before = await state(page);
  await page.keyboard.down('Space');
  await expect(page.getByTestId('workspace-hint')).toContainText('Panning');
  await page.keyboard.up('Space');
  await expect(page.getByTestId('pan-surface')).toHaveCount(0);
  await page.keyboard.down('ArrowRight');
  await expect(page.getByRole('button', { name: 'Export PNG', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Export PNG', exact: true })).toHaveAttribute('aria-busy', 'false');
  await expect(page.getByText('Rendering PNG…', { exact: true })).toHaveCount(0);
  await page.keyboard.up('ArrowRight');
  await expect(page.getByRole('button', { name: 'Export PNG', exact: true })).toBeEnabled();
  expect((await state(page)).past).toBe(before.past + 1);
  await page.getByLabel('Cell width', { exact: true }).focus();
  const after = await state(page);
  await page.keyboard.press('Control+d');
  expect((await state(page)).doc.placements).toEqual(after.doc.placements);
});

test('PNG verification marks edited output stale and only resets after a new verified export', async ({ page }) => {
  await demo(page);
  for (const name of ['Cell width', 'Cell height']) {
    const field = page.getByLabel(name, { exact: true });
    await field.fill('501'); await field.press('Enter');
  }
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export PNG', exact: true }).click();
  await downloaded;
  await expect(page.getByTestId('proof-status')).toHaveText('Decoded PNG · dimensions verified');
  await expect(page.getByTestId('proof-stale')).toHaveCount(0);
  await page.getByTestId('workspace').focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByTestId('proof-stale')).toHaveText('Out of date');
  await expect(page.getByTestId('proof-status')).toHaveText('Previous export · edits not included');
  await expect(page.getByTestId('export-proof')).toBeVisible();
  const second = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export PNG', exact: true }).click();
  await second;
  await expect(page.getByTestId('proof-status')).toHaveText('Decoded PNG · dimensions verified');
  await expect(page.getByTestId('proof-stale')).toHaveCount(0);
  expect(await page.getByTestId('export-proof').evaluate((canvas: HTMLCanvasElement) => [canvas.width, canvas.height])).toEqual([576, 432]);
});

test('proof decode failure is explicit and never displays a success indicator', async ({ page }) => {
  await demo(page);
  await page.evaluate(() => {
    const decode = window.createImageBitmap.bind(window);
    let calls = 0;
    // First decode is export's dimension check; second is the proof's same-Blob decode.
    window.createImageBitmap = ((...args: Parameters<typeof createImageBitmap>) => {
      if (++calls === 2) return Promise.reject(new Error('Deliberate proof decode failure'));
      return Reflect.apply(decode, window, args);
    }) as typeof createImageBitmap;
  });
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export PNG', exact: true }).click();
  await downloaded;
  await expect(page.getByTestId('proof-status')).toHaveText('PNG verification failed');
  await expect(page.getByRole('alert')).toContainText('Deliberate proof decode failure');
  await expect(page.getByTestId('export-proof')).toBeHidden();
});
