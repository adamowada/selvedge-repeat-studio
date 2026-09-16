import { describe, expect, it } from 'vitest';
import { historyReducer as reduce, initialHistory } from '../src/core/history';
import { document } from './fixtures';

describe('50-entry snapshot history', () => {
  it('makes one history entry for 100 gesture frames', () => {
    let state = reduce(initialHistory(0), { type: 'begin' });
    for (let value = 1; value <= 100; value++) state = reduce(state, { type: 'preview', value });
    expect(state.past).toEqual([]);
    state = reduce(state, { type: 'end' });
    expect(state.past).toEqual([0]); expect(state.present).toBe(100);
    state = reduce(state, { type: 'undo' });
    expect(state.present).toBe(0); expect(state.future).toEqual([100]);
    state = reduce(state, { type: 'redo' });
    expect(state.present).toBe(100); expect(state.past).toEqual([0]);
  });
  it('keeps exactly the last 50 snapshots', () => {
    let state = initialHistory(0);
    for (let value = 1; value <= 60; value++) state = reduce(state, { type: 'commit', value });
    expect(state.past).toHaveLength(50); expect(state.past[0]).toBe(10); expect(state.past[49]).toBe(59);
    for (let i = 0; i < 60; i++) state = reduce(state, { type: 'undo' });
    expect(state.present).toBe(10); expect(state.future).toHaveLength(50);
  });
  it('new committed edit clears redo, selection/camera never enter document snapshots', () => {
    const doc = document();
    let state = reduce(initialHistory(doc), { type: 'commit', value: { ...doc, W: 200 } });
    state = reduce(state, { type: 'undo' });
    expect(state.future).toHaveLength(1);
    state = reduce(state, { type: 'commit', value: { ...doc, H: 300 } });
    expect(state.future).toEqual([]);
    expect(Object.keys(state.present).sort()).toEqual(['H', 'W', 'background', 'mode', 'placements']);
  });
  it('no-op commits/gestures preserve redo', () => {
    let state = reduce(initialHistory(0), { type: 'commit', value: 1 });
    state = reduce(state, { type: 'undo' });
    state = reduce(state, { type: 'commit', value: 0 });
    state = reduce(state, { type: 'begin' });
    state = reduce(state, { type: 'preview', value: 99 });
    state = reduce(state, { type: 'preview', value: 0 });
    state = reduce(state, { type: 'end' });
    expect(state.past).toEqual([]); expect(state.future).toEqual([1]);
  });
  it('cancel restores the baseline without recording or clearing redo', () => {
    let state = reduce(initialHistory(0), { type: 'commit', value: 1 });
    state = reduce(state, { type: 'undo' });
    state = reduce(state, { type: 'begin' });
    state = reduce(state, { type: 'preview', value: 99 });
    state = reduce(state, { type: 'cancel' });
    expect(state.present).toBe(0); expect(state.future).toEqual([1]); expect(state.past).toEqual([]);
  });
  it('does not record a preview outside a transaction or alias mutable history', () => {
    const before = initialHistory(0);
    expect(reduce(before, { type: 'preview', value: 1 })).toBe(before);
    const after = reduce(before, { type: 'commit', value: 2 });
    expect(before.past).toEqual([]); expect(before.present).toBe(0); expect(after.past).toEqual([0]);
  });
});
