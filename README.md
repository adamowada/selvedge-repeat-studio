# Selvedge Repeat

A local desktop-browser compositor for PNG repeat patterns, built with React, TypeScript and Konva. No backend, account or external runtime service. **Save a project file before closing the tab to keep your work.**

## Run

Use Node.js 22.12 or newer and npm:

```sh
npm ci
npm run dev
```

Open http://127.0.0.1:5173. The server binds to loopback and requires port 5173. Installation needs registry access; the app runs locally without internet. `npm run build` produces the static site in `dist/`.

## Use

- Import PNGs through the picker or by dropping files anywhere in the app. Invalid files report individual errors without discarding valid imports. Demo adds three reusable sources.
- Click a source to place it at the current view center. Select repeats directly or through the front-to-back Placements list.
- Drag to move, use corner handles to resize uniformly, or use the rotation handle. Scale (%) and Rotation (°) in the Inspector provide keyboard alternatives: Enter/blur commits; Escape cancels. Flip, duplicate, delete and stacking controls act on the selected placement.
- Set cell dimensions, Straight/Half-drop/Brick mode and an opaque or transparent background. Invalid changes leave the document intact.
- Scroll to zoom around the pointer; Space-drag pans. Fit recovers a valid view. Inspect hides editing guides.
- Export PNG downloads a rectangular tile. Verification tiles that exact downloaded Blob and marks it out of date after edits. Use Basic/Straight repeat in other software: staggered layouts are already baked into the PNG.

Shortcuts apply only inside the workspace, not form fields. Mod means Ctrl on Windows/Linux or Cmd on macOS.

| Shortcut | Action |
| --- | --- |
| Mod+Z / Mod+Shift+Z | Undo / redo |
| Mod+D | Duplicate |
| Arrow / Shift+Arrow | Move 1 / 10 model pixels |
| Delete | Delete placement |
| Space + drag | Pan |

Each continuous gesture records one undo step. History retains 50 snapshots; new edits clear redo. Camera, selection and source images are separate from document history.

## Save and resume

**Save project** downloads an editable `.selvedge` file containing the pattern settings, exact placement transforms and stacking order, and every original PNG (including unused sources). **Open project** restores it without needing the original files. Saving downloads a new copy; it does not overwrite the file you opened. Export PNG remains the separate, flattened output.

The header marks unsaved changes, and opening another project asks before discarding them. Files are fully validated and decoded before replacing the current session; a failed open leaves your pattern intact. Opening fits the view and starts fresh undo history with no selection or export proof. There is no autosave; keep the downloaded file to resume later.

The version-1 format is a standard ZIP with `project.json` and `assets/<index>.png`, using STORE entries (no extra compression of already-compressed PNGs). Metadata is limited to 1 MiB; the existing source-count, byte and pixel limits also apply. Unknown versions, unexpected entries, compressed entries and invalid image/document data are rejected. Archive handling uses fflate, not a custom ZIP implementation.

## Limits and resource handling

PNG sources and output sides are limited to 4096 pixels. A session can retain at most 64 sources, 32 × 1024² decoded pixels (128 MiB of raw RGBA pixels), and 64 MiB of source PNG bytes. Browser overhead and temporary export surfaces use additional memory. Concurrent imports share the same budget; failed decodes release their reservation.

Each source has a labeled **Remove** button beneath its thumbnail. Confirm the prompt to remove an unused PNG from this session; the original file on disk is never deleted. Sources labeled **In use** or **Kept for undo / redo** cannot be removed until those references expire. Removal releases the image URL and budget. Session teardown releases remaining sources.

Each render allows at most 2000 motif copies, checked before allocation; excess is rejected, never silently truncated. Dense views attempt center-preserving camera recovery. Export independently validates its full rectangle. Sparse upscaled images skip transparent margins while retaining their full selection bounds; downscaled images retain native sampling.

Straight exports W × H; Half-drop exports 2W × H; Brick exports W × 2H. Export uses pixel ratio 1 and excludes camera transforms and editor guides. Output is browser-canvas PNG, with no DPI/CMYK or production-color guarantees.

The desktop layout requires at least 900 × 540 pixels. Mobile and cross-browser/accessibility conformance are not claimed.

## Verify

```sh
npm audit --audit-level=low
npm run typecheck
npm run test:coverage
npm run build
npx playwright install chromium
npm run test:browser
```

Stop any existing server on port 5173 before browser tests. Playwright starts its own smoke-mode server and runs real Chromium interactions and pixel comparisons. Set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to use a system Chromium. Linux CI installs browser system dependencies with `npx playwright install --with-deps chromium`.

Vitest covers model logic, resource cleanup, React hooks and components; HTML coverage is written to `coverage/index.html`. The report includes all production source except the entry-point bootstrap and smoke-only bridge. Canvas rendering is tested in Playwright, not simulated by jsdom; browser coverage is not included in the Vitest percentage. Coverage thresholds prevent regressions. GitHub Actions runs audit, typecheck, coverage, build and browser tests for pushes and pull requests.

`src/core/` owns geometry, transforms, camera recovery, history, import/export and proof. `src/hooks/useStudio.ts` coordinates the editor, and `src/components/` contains its UI. Older `verification/` artifacts are historical supplemental checks, not substitutes for the current test suite.

MIT licensed; see [LICENSE](LICENSE).
