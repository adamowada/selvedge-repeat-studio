import { test, expect, type Page } from '@playwright/test';

const state = (page: Page) => page.evaluate(() => window.__studio!.state());
const row = (page: Page, name: string) => page.getByTestId('placement-item').filter({ hasText: name });
const names = (page: Page) => page.getByTestId('placement-item').locator('strong').allTextContents();
async function demo(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Add demo', exact: true }).click();
  await expect(page.getByTestId('placement-item')).toHaveCount(3);
}

test('drag layers changes canvas/export order and is one undo step without changing transforms', async ({ page }) => {
  await demo(page);
  // Overlap the motifs so a stacking change must affect exported pixels.
  await page.evaluate(() => {
    const doc = window.__studio!.state().doc;
    window.__studio!.setDocument({ ...doc, placements: doc.placements.map(p => ({ ...p, x: 500, y: 500, s: 1, deg: 0 })) });
  });
  await row(page, 'sage-sprig').click();
  const before = await state(page), [coral, sage, ochre] = before.doc.placements;
  const pixels = await page.evaluate(() => window.__studio!.reference(1000, 1000));
  await row(page, 'coral-stem').dragTo(row(page, 'ochre-petal'), { targetPosition: { x: 25, y: 4 } });
  expect(await names(page)).toEqual(['coral-stem', 'ochre-petal', 'sage-sprig']);
  const after = await state(page);
  expect(after.doc).toEqual({ ...before.doc, placements: [sage, ochre, coral] });
  expect(after.past).toBe(before.past + 1); expect(after.selection).toEqual(before.selection);
  expect(await page.evaluate(() => [...new Set(window.__studio!.copies().map(c => c.id))])).toEqual([sage.id, ochre.id, coral.id]);
  expect(await page.evaluate(() => window.__studio!.reference(1000, 1000))).not.toEqual(pixels);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  expect((await state(page)).doc).toEqual(before.doc);
  expect(await page.evaluate(() => window.__studio!.reference(1000, 1000))).toEqual(pixels);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  expect((await state(page)).doc).toEqual(after.doc);
  await row(page, 'coral-stem').dragTo(row(page, 'sage-sprig'), { targetPosition: { x: 25, y: 50 } });
  expect((await state(page)).doc).toEqual(before.doc);
});

test('narrow sidebar supports keyboard reorder, no-op drops, and canceled drags', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 800 });
  await demo(page);
  const before = await state(page);
  // Above an already-adjacent row is a no-op, not a new history entry.
  await row(page, 'ochre-petal').dragTo(row(page, 'sage-sprig'), { targetPosition: { x: 25, y: 4 } });
  expect(await state(page)).toEqual(before);
  await row(page, 'coral-stem').dragTo(page.getByTestId('workspace'));
  expect(await state(page)).toEqual(before);
  await expect(page.locator('.dragging, .drop-above, .drop-below')).toHaveCount(0);
  const coral = row(page, 'coral-stem');
  await coral.focus(); await coral.press('Alt+ArrowUp');
  expect(await names(page)).toEqual(['ochre-petal', 'coral-stem', 'sage-sprig']);
  await expect(coral).toBeFocused();
  await coral.press('Alt+ArrowUp');
  expect(await names(page)).toEqual(['coral-stem', 'ochre-petal', 'sage-sprig']);
  await coral.press('Alt+ArrowUp'); // Already topmost.
  expect((await state(page)).past).toBe(before.past + 2);
  await coral.press('Alt+ArrowDown');
  expect(await names(page)).toEqual(['ochre-petal', 'coral-stem', 'sage-sprig']);
  await expect(coral).toBeFocused();
  expect(await page.getByTestId('placement-list').evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
});
