import React, { useEffect, useRef, useState } from 'react';
import { ArrowUp, ArrowDown } from 'lucide-react';

/**
 * Reusable pieces for COMET-style list pages (dense, filterable tables with a
 * filter chooser, a column chooser, saved views, sortable headers and
 * pagination). Extracted so « les rapports » and other list pages share one
 * implementation instead of each re-growing the same controls.
 */

/** Close a popover on outside click or Escape. */
export function usePopover() {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);
  return { open, setOpen, ref };
}

/** Sortable table header cell. */
export function SortTh({ label, k, sort, onSort, className }) {
  const active = sort.key === k;
  return (
    <th scope="col" className={`sortable ${className || ''} ${active ? 'is-sorted' : ''}`} onClick={() => onSort(k)}>
      <span className="th-inner">{label}{active && (sort.dir === 'asc' ? <ArrowUp size={13} /> : <ArrowDown size={13} />)}</span>
    </th>
  );
}

/**
 * Remembered filter/view for a list page — ONE slot per scope, no names:
 *  • temporaire  → sessionStorage (this session only)
 *  • permanent   → localStorage (persists for the user)
 * The payload is opaque (filters + chosen columns + sort). At load the
 * temporary slot wins over the permanent one, so a quick ad-hoc filter does
 * not overwrite the user's saved default.
 */
export function makeViewStore(storageKey) {
  const read = (store) => { try { const v = store.getItem(storageKey); return v ? JSON.parse(v) : null; } catch { return null; } };
  return {
    initial() {
      const temp = read(window.sessionStorage);
      if (temp) return { ...temp, scope: 'temp' };
      const perm = read(window.localStorage);
      if (perm) return { ...perm, scope: 'perm' };
      return null;
    },
    saveTemp(payload) { try { window.sessionStorage.setItem(storageKey, JSON.stringify(payload)); } catch { /* ignore */ } },
    savePerm(payload) { try { window.localStorage.setItem(storageKey, JSON.stringify(payload)); } catch { /* ignore */ } },
    clear() {
      try { window.sessionStorage.removeItem(storageKey); } catch { /* ignore */ }
      try { window.localStorage.removeItem(storageKey); } catch { /* ignore */ }
    },
  };
}
