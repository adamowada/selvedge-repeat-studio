export const HISTORY_LIMIT = 50;
export interface History<T> { past: T[]; present: T; future: T[]; baseline: T | null }
export type HistoryAction<T> =
  | { type: 'commit'; value: T } | { type: 'preview'; value: T } | { type: 'reset'; value: T }
  | { type: 'map'; update: (value: T) => T }
  | { type: 'begin' | 'end' | 'cancel' | 'undo' | 'redo' };
export const initialHistory = <T,>(value: T): History<T> => ({ past: [], present: value, future: [], baseline: null });
const equal = <T,>(a: T, b: T) => JSON.stringify(a) === JSON.stringify(b);
function committed<T>(state: History<T>, before: T, after: T): History<T> {
  if (equal(before, after)) return { ...state, present: before, baseline: null };
  return { past: [...state.past, before].slice(-HISTORY_LIMIT), present: after, future: [], baseline: null };
}
export function historyReducer<T>(state: History<T>, action: HistoryAction<T>): History<T> {
  switch (action.type) {
    case 'map': return { past: state.past.map(action.update), present: action.update(state.present), future: state.future.map(action.update),
      baseline: state.baseline === null ? null : action.update(state.baseline) };
    case 'reset': return initialHistory(action.value);
    case 'begin': return state.baseline === null ? { ...state, baseline: state.present } : state;
    case 'preview': return state.baseline === null ? state : { ...state, present: action.value };
    case 'end': return state.baseline === null ? state : committed(state, state.baseline, state.present);
    case 'cancel': return state.baseline === null ? state : { ...state, present: state.baseline, baseline: null };
    case 'commit': return committed(state, state.baseline ?? state.present, action.value);
    case 'undo': {
      const base = state.baseline === null ? state : { ...state, present: state.baseline, baseline: null };
      if (!base.past.length) return base;
      return { past: base.past.slice(0, -1), present: base.past.at(-1)!, future: [base.present, ...base.future], baseline: null };
    }
    case 'redo': {
      if (state.baseline !== null || !state.future.length) return state;
      return { past: [...state.past, state.present].slice(-HISTORY_LIMIT), present: state.future[0], future: state.future.slice(1), baseline: null };
    }
  }
}
