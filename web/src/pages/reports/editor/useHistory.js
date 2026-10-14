import { useCallback, useRef, useState } from 'react';

/**
 * Historique d'annulation de l'éditeur (lot 7a) : 50 états au plus. Des changements rapprochés
 * (frappe dans un titre ou un texte, < 700 ms) forment UN pas d'annulation.
 * @returns {{ value, set(fn|value), undo(), redo(), canUndo, canRedo, reset(value) }}
 */
const LIMIT = 50;
const COALESCE_MS = 700;

export function useHistory(initial) {
  const [state, setState] = useState({ past: [], present: initial, future: [] });
  const last = useRef(0);
  const set = useCallback((next) => {
    setState((s) => {
      const value = typeof next === 'function' ? next(s.present) : next;
      if (value === s.present) return s;
      const now = Date.now();
      const merge = now - last.current < COALESCE_MS && s.past.length > 0;
      last.current = now;
      return { past: merge ? s.past : [...s.past, s.present].slice(-LIMIT), present: value, future: [] };
    });
  }, []);
  const undo = useCallback(() => setState((s) => {
    if (!s.past.length) return s;
    last.current = 0;
    return { past: s.past.slice(0, -1), present: s.past[s.past.length - 1], future: [s.present, ...s.future].slice(0, LIMIT) };
  }), []);
  const redo = useCallback(() => setState((s) => {
    if (!s.future.length) return s;
    last.current = 0;
    return { past: [...s.past, s.present].slice(-LIMIT), present: s.future[0], future: s.future.slice(1) };
  }), []);
  const reset = useCallback((value) => { last.current = 0; setState({ past: [], present: value, future: [] }); }, []);
  return { value: state.present, set, undo, redo, reset, canUndo: state.past.length > 0, canRedo: state.future.length > 0 };
}
