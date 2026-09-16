import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';

const state = (page: Page) => page.evaluate(() => window.__studio!.state());
async function save(page: Page) {
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save project', exact: true }).click();
  const download = await pending;
  expect(download.suggestedFilename()).toMatch(/\.selvedge$/);
  return { name: download.suggestedFilename(), mimeType: 'application/zip', buffer: readFileSync((await download.path())!) };
}

test('downloaded project reopens after refresh with identical pattern pixels and all original sources', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Add demo', exact: true }).click();
  await expect(page.getByTestId('placement-item')).toHaveCount(3);
  await page.getByTestId('png-input').setInputFiles('public/demo/ochre-petal.png');
  await expect(page.getByTestId('asset-card')).toHaveCount(4);
  await page.getByLabel('Cell width', { exact: true }).fill('240');
  await page.getByLabel('Cell width', { exact: true }).press('Enter');
  await page.getByLabel('Cell height', { exact: true }).fill('180');
  await page.getByLabel('Cell height', { exact: true }).press('Enter');
  await page.getByRole('button', { name: 'Half-drop', exact: true }).click();
  await page.getByLabel('Transparent background', { exact: true }).check();
  await page.getByTestId('placement-item').first().click();
  await page.getByLabel('Scale (%)', { exact: true }).fill('47.25');
  await page.getByLabel('Scale (%)', { exact: true }).press('Enter');
  await page.getByLabel('Rotation (°)', { exact: true }).fill('-32.5');
  await page.getByLabel('Rotation (°)', { exact: true }).press('Enter');
  const before = await state(page);
  const pngBefore = await page.evaluate(() => window.__studio!.reference(480, 180));
  const file = await save(page);
  await expect(page.locator('.session-note')).toContainText('No unsaved changes');
  await page.reload();
  await expect(page.getByTestId('asset-card')).toHaveCount(0);
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Open project', exact: true }).click();
  await (await chooser).setFiles(file);
  await expect(page.getByTestId('asset-card')).toHaveCount(4);
  const after = await state(page);
  expect(after.doc).toEqual(before.doc); expect(after.assets).toEqual(before.assets);
  expect(after.selection).toBeNull(); expect(after.past).toBe(0); expect(after.future).toBe(0);
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
  await expect(page.getByTestId('export-proof')).toBeHidden();
  expect(await page.evaluate(() => window.__studio!.reference(480, 180))).toEqual(pngBefore);
  // Loaded projects remain editable and can be saved again.
  await page.getByTestId('asset-card').last().click();
  await expect(page.getByTestId('placement-item')).toHaveCount(4);
  await expect(page.locator('.session-note')).toContainText('Unsaved changes');
  const resaved = await save(page);
  expect(JSON.parse(strFromU8(unzipSync(resaved.buffer)['project.json'])).document.placements).toHaveLength(4);
});

test('canceling replacement or opening a corrupt project preserves current work, history and export proof', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Add demo', exact: true }).click();
  await expect(page.getByTestId('asset-card')).toHaveCount(3);
  const file = await save(page);
  await page.getByTestId('placement-item').first().click();
  await page.keyboard.press('ArrowRight');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export PNG', exact: true }).click();
  await download;
  await expect(page.getByTestId('proof-status')).toContainText('dimensions verified');
  const before = await state(page);
  const proof = await page.evaluate(() => window.__studio!.exportBytes());
  page.once('dialog', async dialog => {
    expect(dialog.message()).toContain('discard unsaved changes'); await dialog.dismiss();
  });
  await page.getByTestId('project-input').setInputFiles(file);
  expect(await state(page)).toEqual(before);
  const versionFiles = unzipSync(file.buffer);
  const metadata = JSON.parse(strFromU8(versionFiles['project.json'])); metadata.version = 99;
  versionFiles['project.json'] = strToU8(JSON.stringify(metadata));
  const corruptFiles = unzipSync(file.buffer);
  corruptFiles['assets/1.png'] = corruptFiles['assets/1.png'].slice(0, 24); // Valid header, failed browser decode.
  for (const entries of [versionFiles, corruptFiles]) {
    page.once('dialog', dialog => dialog.accept());
    await page.getByTestId('project-input').setInputFiles({ ...file, buffer: Buffer.from(zipSync(entries, { level: 0 })) });
    await expect(page.locator('.canvas-error')).toContainText('Could not open project');
    await expect(page.getByRole('button', { name: 'Open project', exact: true })).toBeEnabled();
    expect(await state(page)).toEqual(before);
    expect(await page.evaluate(() => window.__studio!.exportBytes())).toEqual(proof);
    await expect(page.getByTestId('proof-status')).toContainText('dimensions verified');
  }
});
