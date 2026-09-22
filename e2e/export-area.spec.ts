import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

for (const [mode, columns, rows] of [['Straight', 1, 1], ['Half-drop', 2, 1], ['Brick', 1, 2]] as const) {
  test(`${mode}: dashed preview matches downloaded PNG bounds through resize, pan and zoom`, async ({ page }, testInfo) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Add demo', exact: true }).click();
    await expect(page.getByTestId('placement-item')).toHaveCount(3);
    await page.getByRole('button', { name: mode, exact: true }).click();
    const area = () => page.evaluate(() => window.__studio!.exportArea());
    await expect.poll(area).toMatchObject({ x: 0, y: 0, width: 1000 * columns, height: 1000 * rows, listening: false });
    await page.screenshot({ path: testInfo.outputPath('export-area.png') });

    // Unequal, odd dimensions catch accidentally hard-coded square/half-cell bounds.
    await page.getByLabel('Cell width', { exact: true }).fill('401');
    await page.getByLabel('Cell width', { exact: true }).press('Enter');
    await page.getByLabel('Cell height', { exact: true }).fill('307');
    await page.getByLabel('Cell height', { exact: true }).press('Enter');
    const width = 401 * columns, height = 307 * rows;
    await expect.poll(area).toMatchObject({ x: 0, y: 0, width, height });
    const before = await page.evaluate(() => window.__studio!.state());
    await page.evaluate(() => window.__studio!.setCamera({ x: 73, y: 91, z: .5 }));
    await expect.poll(area).toMatchObject({ x: 0, y: 0, width, height,
      screen: { x: 73, y: 91, width: width * .5, height: height * .5 } });

    const downloading = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export PNG', exact: true }).click();
    const file = await (await downloading).path();
    const dimensions = await page.evaluate(async bytes => {
      const bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: 'image/png' }));
      const size = { width: bitmap.width, height: bitmap.height };
      bitmap.close(); return size;
    }, Array.from(readFileSync(file!)));
    expect(dimensions).toEqual({ width, height });
    // Inspect still hides guides without affecting document/history or export bounds.
    await page.getByRole('button', { name: 'Inspect', exact: true }).click();
    expect(await area()).toBeNull();
    await page.getByRole('button', { name: 'Inspect', exact: true }).click();
    expect(await area()).toMatchObject(dimensions);
    const after = await page.evaluate(() => window.__studio!.state());
    expect(after.doc).toEqual(before.doc); expect(after.past).toBe(before.past);
  });
}
