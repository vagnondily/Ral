import React, { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Search, X } from 'lucide-react';
import { useI18n } from '../lib/i18n.jsx';
import { placePopover, scrollClosesPopover } from '../lib/popoverPlacement.js';
import { filterOptions, flatOptions, groupOptions, limitGroups, moveActive, showSearch } from '../lib/entityPicker.js';

/**
 * Choix d'un objet métier (prestataire TPM, contrat, site, bureau…) — remplace la liste déroulante
 * du navigateur, illisible et sans recherche sur les longues listes (retour du 16/10). Même hauteur,
 * même bordure et même chevron qu'un champ `.select` ; la liste s'ouvre dans un PORTAIL en position
 * fixe (lib/popoverPlacement), jamais coupée par un tiroir ou une fenêtre modale.
 *
 *   value       valeur choisie ('' = aucune) ; onChange(value, option)
 *   options     [{ value, label, sub?, group?, keywords?, disabled? }] (lib/entityPicker)
 *   groupOrder  ordre des titres de groupe (ex. « TPM de ce contrat » avant « Autres prestataires TPM »)
 *   placeholder texte sans choix ; clearable (bouton « effacer ») ; invalid ; disabled ; id (pour <Field htmlFor>)
 *   emptyText   texte quand la recherche ne trouve rien
 *   limit       options affichées au plus (300) ; les autres sont comptées (« affinez la recherche »)
 *
 * Accessibilité : bouton role="combobox" aria-haspopup="listbox" / aria-expanded / aria-controls ;
 * liste role="listbox", groupes role="group" titrés, options role="option" aria-selected ; la recherche
 * pilote l'option active (aria-activedescendant). Clavier : ↓ / Entrée / Espace ouvrent ; ↑ ↓ Début Fin
 * déplacent ; Entrée choisit ; Échap ferme sans fermer le tiroir parent ; Tab ferme.
 */
export default function EntityPicker({
  value, onChange, options, groupOrder = [], placeholder, clearable = false, invalid = false, disabled = false,
  id, emptyText, ariaLabel, searchPlaceholder, limit = 300,
}) {
  const { tr } = useI18n();
  const uid = useId().replace(/:/g, '');
  const listId = `picker-list-${uid}`;
  const triggerRef = useRef(null);
  const popRef = useRef(null);
  const searchRef = useRef(null);
  const listRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(-1);
  const [pos, setPos] = useState(null);

  const all = options || [];
  const selected = all.find((o) => o.value === value) || null;
  const { groups, hidden } = useMemo(() => limitGroups(groupOptions(filterOptions(all, query), groupOrder), limit), [all, query, groupOrder, limit]);
  const flat = useMemo(() => flatOptions(groups), [groups]);
  const withSearch = showSearch(all);
  const optId = (o) => `picker-${uid}-${String(o.value).replace(/[^\w-]/g, '_')}`;

  const close = (focusTrigger = true) => {
    setOpen(false);
    setQuery('');
    if (focusTrigger && triggerRef.current) triggerRef.current.focus();
  };
  const openList = () => {
    if (disabled) return;
    setOpen(true);
    setActive(Math.max(0, flatOptions(limitGroups(groupOptions(all, groupOrder), limit).groups).findIndex((o) => o.value === value)));
  };
  const pick = (o) => {
    if (!o || o.disabled) return;
    onChange(o.value, o);
    close(true);
  };

  const place = useCallback(() => {
    const trig = triggerRef.current; const pop = popRef.current;
    if (!trig || !pop) return;
    const r = trig.getBoundingClientRect();
    const list = listRef.current;
    const height = list ? pop.offsetHeight - list.clientHeight + list.scrollHeight : pop.scrollHeight;
    const next = placePopover({
      anchor: { top: r.top, bottom: r.bottom, left: r.left, right: r.right },
      size: { width: Math.max(r.width, pop.offsetWidth), height },
      viewport: { width: document.documentElement.clientWidth || window.innerWidth, height: window.innerHeight },
    });
    next.minWidth = Math.round(r.width);
    setPos((p) => (p && p.top === next.top && p.left === next.left && p.maxHeight === next.maxHeight && p.minWidth === next.minWidth ? p : next));
  }, []);
  useLayoutEffect(() => {
    if (!open) { setPos(null); return undefined; }
    place();
    const pop = popRef.current;
    if (!pop || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(() => place());
    ro.observe(pop);
    return () => ro.disconnect();
  }, [open, place]);

  // Clic dehors : ferme ; défilement d'un conteneur du bouton : ferme ; redimensionnement : replace.
  useEffect(() => {
    if (!open) return undefined;
    const inside = (t) => (triggerRef.current && triggerRef.current.contains(t)) || (popRef.current && popRef.current.contains(t));
    const onDown = (e) => { if (!inside(e.target)) close(false); };
    const onScroll = (e) => { if (scrollClosesPopover(e.target, triggerRef.current, popRef.current)) close(false); };
    const onResize = () => place();
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown, { passive: true });
    document.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
      document.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
    };
  }, [open, place]); // eslint-disable-line react-hooks/exhaustive-deps

  // Une fois placée : focus sur la recherche (ou la liste), option active visible.
  useEffect(() => {
    if (!open || !pos) return;
    const el = withSearch ? searchRef.current : listRef.current;
    if (el && document.activeElement !== el) el.focus({ preventScroll: true });
  }, [open, pos, withSearch]);
  useEffect(() => { if (open) setActive((a) => (flat.length ? Math.min(Math.max(a, 0), flat.length - 1) : -1)); }, [flat.length, open]);
  useEffect(() => {
    if (!open || active < 0 || !flat[active]) return;
    const el = document.getElementById(optId(flat[active]));
    if (el) el.scrollIntoView({ block: 'nearest' });
  }, [active, open, flat]); // eslint-disable-line react-hooks/exhaustive-deps

  const onTriggerKeyDown = (e) => {
    if (!open && ['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) { e.preventDefault(); openList(); }
  };
  const onListKeyDown = (e) => {
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
      if ((e.key === 'Home' || e.key === 'End') && e.currentTarget.tagName === 'INPUT' && query) return; // curseur dans la recherche
      e.preventDefault();
      setActive((a) => moveActive(a, flat.length, e.key));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      pick(flat[active]);
    } else if (e.key === 'Escape') {
      e.preventDefault(); e.stopPropagation();
      close(true);
    } else if (e.key === 'Tab') {
      close(false);
    }
  };

  const activeId = open && active >= 0 && flat[active] ? optId(flat[active]) : undefined;
  let index = -1;
  return (
    <div className={`picker${open ? ' is-open' : ''}`}>
      <button
        type="button" id={id} ref={triggerRef} disabled={disabled}
        className={`picker-trigger${selected ? '' : ' is-empty'}`}
        role="combobox" aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? listId : undefined}
        aria-invalid={invalid || undefined} aria-label={ariaLabel}
        onClick={() => (open ? close(false) : openList())} onKeyDown={onTriggerKeyDown}
      >
        <span className="picker-value">
          <span className="picker-label">{selected ? selected.label : (placeholder || tr('Choisir…'))}</span>
          {selected && selected.sub && <span className="picker-sub">{selected.sub}</span>}
        </span>
        <ChevronDown size={16} aria-hidden="true" className="picker-chevron" />
      </button>
      {clearable && selected && !disabled && (
        <button type="button" className="picker-clear" aria-label={tr('Effacer le choix')} title={tr('Effacer le choix')}
          onClick={() => { onChange('', null); if (triggerRef.current) triggerRef.current.focus(); }}>
          <X size={14} aria-hidden="true" />
        </button>
      )}
      {open && createPortal(
        <div ref={popRef} className={`picker-pop${pos ? ` is-${pos.placement}` : ''}`}
          style={pos
            ? { top: pos.top, left: pos.left, minWidth: pos.minWidth, maxHeight: pos.maxHeight == null ? undefined : pos.maxHeight }
            : { top: 0, left: 0, visibility: 'hidden' }}>
          {withSearch && (
            <div className="picker-search">
              <Search size={15} aria-hidden="true" />
              <input
                ref={searchRef} className="picker-search-input" type="search" value={query} autoComplete="off" spellCheck={false}
                placeholder={searchPlaceholder || tr('Rechercher…')} aria-label={searchPlaceholder || tr('Rechercher…')}
                aria-controls={listId} aria-activedescendant={activeId}
                onChange={(e) => { setQuery(e.target.value); setActive(0); }} onKeyDown={onListKeyDown}
              />
            </div>
          )}
          <div ref={listRef} id={listId} className="picker-list" role="listbox" tabIndex={withSearch ? -1 : 0}
            aria-label={ariaLabel} aria-activedescendant={withSearch ? undefined : activeId} onKeyDown={withSearch ? undefined : onListKeyDown}>
            {flat.length === 0 && <div className="picker-empty">{emptyText || tr('Aucun résultat.')}</div>}
            {groups.map((g) => (
              <div key={g.group || '_'} role="group" aria-label={g.group || undefined} className="picker-group">
                {g.group && <div className="picker-group-title" aria-hidden="true">{g.group}</div>}
                {g.items.map((o) => {
                  if (!o.disabled) index += 1;
                  const i = o.disabled ? -1 : index;
                  const isSel = o.value === value;
                  return (
                    <div
                      key={o.value} id={optId(o)} role="option" aria-selected={isSel} aria-disabled={o.disabled || undefined}
                      className={`picker-option${i === active ? ' is-active' : ''}${isSel ? ' is-selected' : ''}${o.disabled ? ' is-disabled' : ''}`}
                      onMouseDown={(e) => e.preventDefault()} onMouseEnter={() => { if (i >= 0) setActive(i); }} onClick={() => pick(o)}
                    >
                      <span className="picker-option-text">
                        <span className="picker-option-label">{o.label}</span>
                        {o.sub && <span className="picker-option-sub">{o.sub}</span>}
                      </span>
                      {isSel && <Check size={15} aria-hidden="true" className="picker-check" />}
                    </div>
                  );
                })}
              </div>
            ))}
            {hidden > 0 && <div className="picker-more">{tr('{n} autre(s) : affinez la recherche.', { n: hidden })}</div>}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
