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
 * Saved views, persistent in localStorage and temporary in sessionStorage,
 * under one storage key per page. A view is an opaque payload (filters +
 * columns + sort) plus { id, name, temp }.
 */
export function makeViewStore(storageKey) {
  const parse = (store) => { try { return JSON.parse(store.getItem(storageKey) || '[]'); } catch { return []; } };
  function readViews() {
    try {
      const perm = parse(window.localStorage).map((v) => ({ ...v, temp: false }));
      const temp = parse(window.sessionStorage).map((v) => ({ ...v, temp: true }));
      return [...perm, ...temp];
    } catch { return []; }
  }
  function writeViews(views) {
    const perm = views.filter((v) => !v.temp).map(({ temp, ...v }) => v);
    const temp = views.filter((v) => v.temp).map(({ temp, ...v }) => v);
    try { window.localStorage.setItem(storageKey, JSON.stringify(perm)); } catch { /* ignore */ }
    try { window.sessionStorage.setItem(storageKey, JSON.stringify(temp)); } catch { /* ignore */ }
  }
  return { readViews, writeViews };
}
