import { useCallback, useReducer, useRef } from 'react';
import { historyReducer, initialHistory, type HistoryAction } from '../core/history';
import type { RepeatDocument } from '../core/types';

export function useHistory(initial: RepeatDocument) {
  const [history, dispatch] = useReducer(historyReducer<RepeatDocument>, initial, initialHistory);
  const ref = useRef(history);
  // Native Konva events can arrive before React commits the previous render.
  const send = useCallback((action: HistoryAction<RepeatDocument>) => {
    ref.current = historyReducer(ref.current, action);
    dispatch(action);
  }, []);
  return { history, ref, send };
}
