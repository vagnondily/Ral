import React, { memo, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Search, X } from 'lucide-react';
import { useI18n } from '../lib/i18n.jsx';
import { placePopover, scrollClosesPopover } from '../lib/popoverPlacement.js';
import {
  filterOptions, flatOptions, groupOptions, limitGroups, moveActive, searchIndex, showSearch, typeAheadIndex,
} from '../lib/entityPicker.js';

/** Hauteur maximale de la liste (la même que la feuille de style : .picker-pop). */
const MAX_HEIGHT = 420;
/** Valeur par défaut STABLE : un nouveau tableau à chaque rendu recalculerait la liste à chaque survol. */
const NO_ORDER = [];

/** Une ligne de la liste — mémorisée : survoler une option ne redessine pas les 300 autres. */
const OptionRow = memo(function OptionRow({ id, option, rank, active, selected, onPick, onHover }) {
  return (
    <div
      id={id} role="option" aria-selected={selected} aria-disabled={option.disabled || undefined}
      className={`picker-option${active ? ' is-active' : ''}${selected ? ' is-selected' : ''}${option.disabled ? ' is-disabled' : ''}`}
      onMouseDown={(e) => e.preventDefault()} onMouseEnter={() => { if (rank >= 0) onHover(rank); }} onClick={() => onPick(option)}
    >
      <span className="picker-option-text">
        <span className="picker-option-label">{option.label}</span>
        {option.sub && <span className="picker-option-sub">{option.sub}</span>}
      </span>
      {selected && <Check size={15} aria-hidden="true" className="picker-check" />}
    </div>
  );
});

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
 * liste role="listbox" nommée comme le champ (aria-labelledby), groupes role="group" titrés, options
 * role="option" aria-selected ; la recherche (role="combobox") pilote l'option active
 * (aria-activedescendant). Clavier : ↓ / Entrée / Espace ouvrent ; ↑ ↓ Début Fin déplacent ; une lettre
 * saute à l'option suivante qui commence par elle (listes courtes, comme une liste native) ; Entrée
 * choisit ; Échap ferme sans fermer le tiroir parent ; Tab / Maj+Tab ferment et passent au champ voisin.
 */
export default function EntityPicker({
  value, onChange, options, groupOrder = NO_ORDER, placeholder, clearable = false, invalid = false, disabled = false,
  id, emptyText, ariaLabel, searchPlaceholder, limit = 300,
}) {
  const { tr } = useI18n();
  const uid = useId().replace(/:/g, '');
  const triggerId = id || `picker-${uid}`;
  const listId = `picker-list-${uid}`;
  const triggerRef = useRef(null);
  const popRef = useRef(null);
  const searchRef = useRef(null);
  const listRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(-1);
  const [pos, setPos] = useState(null);

  const all = options || NO_ORDER;
  const selected = all.find((o) => o.value === value) || null;
  const index = useMemo(() => searchIndex(all), [all]);
  // Identifiant d'option par RANG dans `options` (jamais deux options avec le même identifiant).
  const rankOf = useMemo(() => new Map(all.map((o, i) => [o.value, i])), [all]);
  const optId = useCallback((o) => `picker-${uid}-o${rankOf.get(o.value)}`, [uid, rankOf]);
  const { groups, hidden } = useMemo(
    () => limitGroups(groupOptions(filterOptions(all, query, index), groupOrder), limit),
    [all, query, index, groupOrder, limit],
  );
  const flat = useMemo(() => flatOptions(groups), [groups]);
  const withSearch = showSearch(all);

  const close = (focusTrigger = true) => {
    setOpen(false);
    setQuery('');
    if (focusTrigger && triggerRef.current) triggerRef.current.focus({ preventScroll: true });
  };
  const openList = () => {
    if (disabled) return;
    setOpen(true);
    // Option choisie active à l'ouverture ; si elle n'est pas affichée (au-delà de `limit`), AUCUNE option
    // active : Entrée ne remplace jamais le choix par une autre option par accident.
    const shown = flatOptions(limitGroups(groupOptions(all, groupOrder), limit).groups);
    const at = shown.findIndex((o) => o.value === value);
    setActive(at >= 0 ? at : (selected ? -1 : 0));
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
    // Hauteur bornée AVANT le placement : sinon une liste haute placée au-dessus du champ, ramenée
    // ensuite à 420 px par la feuille de style, flotterait détachée du champ.
    const natural = list ? pop.offsetHeight - list.clientHeight + list.scrollHeight : pop.scrollHeight;
    const next = placePopover({
      anchor: { top: r.top, bottom: r.bottom, left: r.left, right: r.right },
      size: { width: Math.max(r.width, pop.offsetWidth), height: Math.min(natural, MAX_HEIGHT) },
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

  // Clic dehors : ferme (un clic sur l'étiquette du champ ne ferme pas : elle rouvrirait aussitôt).
  // Défilement d'un conteneur du champ (tiroir, page) : la liste suit son champ, et ne se ferme que si le
  // champ sort de la zone VISIBLE de ce conteneur (au téléphone, toucher le champ fait défiler le tiroir :
  // fermer à chaque défilement refermait la liste aussitôt ouverte). En fermant, le focus revient au
  // champ s'il était dans la liste. Redimensionnement : replace.
  useEffect(() => {
    if (!open) return undefined;
    const inside = (t) => (triggerRef.current && triggerRef.current.contains(t)) || (popRef.current && popRef.current.contains(t));
    const onLabel = (t) => Boolean(t && t.closest && t.closest(`label[for="${triggerId}"]`));
    const onDown = (e) => { if (!inside(e.target) && !onLabel(e.target)) close(false); };
    const onScroll = (e) => {
      if (!scrollClosesPopover(e.target, triggerRef.current, popRef.current) || !triggerRef.current) return;
      const r = triggerRef.current.getBoundingClientRect();
      const box = e.target && e.target.nodeType === 1 ? e.target.getBoundingClientRect() : { top: 0, bottom: window.innerHeight };
      const top = Math.max(0, box.top); const bottom = Math.min(window.innerHeight, box.bottom);
      if (r.bottom <= top || r.top >= bottom) {
        const focusInside = popRef.current && popRef.current.contains(document.activeElement);
        close(focusInside);
      } else place();
    };
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
  }, [open, place, triggerId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Une fois placée : focus sur la recherche (ou la liste).
  useEffect(() => {
    if (!open || !pos) return;
    const el = withSearch ? searchRef.current : listRef.current;
    if (el && document.activeElement !== el) el.focus({ preventScroll: true });
  }, [open, pos, withSearch]);
  useEffect(() => { if (open) setActive((a) => (flat.length ? Math.min(a, flat.length - 1) : -1)); }, [flat.length, open]);
  // Option active visible : on fait défiler la LISTE seule (scrollIntoView ferait aussi défiler le tiroir
  // ou la page, et ce défilement fermerait la liste aussitôt ouverte — vu au téléphone).
  useEffect(() => {
    const list = listRef.current;
    if (!open || !list || active < 0 || !flat[active]) return;
    const el = document.getElementById(optId(flat[active]));
    if (!el) return;
    const top = el.offsetTop - list.offsetTop;
    if (top < list.scrollTop) list.scrollTop = top;
    else if (top + el.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = top + el.offsetHeight - list.clientHeight;
  }, [active, open, flat, optId]);

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
      if (active >= 0) pick(flat[active]);
    } else if (e.key === 'Escape') {
      e.preventDefault(); e.stopPropagation();
      close(true);
    } else if (e.key === 'Tab') {
      // Le focus revient au champ AVANT le déplacement par défaut : Tab / Maj+Tab mènent au champ voisin,
      // jamais derrière la fenêtre (la liste, en portail, est en fin de page).
      close(true);
    } else if (!withSearch && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const i = typeAheadIndex(flat, e.key, active);
      if (i >= 0) { e.preventDefault(); setActive(i); }
    }
  };
  // Rappels STABLES pour les lignes mémorisées (la dernière version de `pick` est lue par référence).
  const pickRef = useRef(pick);
  pickRef.current = pick;
  const onPickRow = useCallback((o) => pickRef.current(o), []);
  const onHoverRow = useCallback((i) => setActive(i), []);

  const activeId = open && active >= 0 && flat[active] ? optId(flat[active]) : undefined;
  let rank = -1;
  return (
    <div className={`picker${open ? ' is-open' : ''}`}>
      <button
        type="button" id={triggerId} ref={triggerRef} disabled={disabled}
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
          onClick={() => { onChange('', null); if (triggerRef.current) triggerRef.current.focus({ preventScroll: true }); }}>
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
                role="combobox" aria-expanded="true" aria-autocomplete="list"
                placeholder={searchPlaceholder || tr('Rechercher…')} aria-label={searchPlaceholder || tr('Rechercher…')}
                aria-controls={listId} aria-activedescendant={activeId}
                onChange={(e) => { setQuery(e.target.value); setActive(0); }} onKeyDown={onListKeyDown}
              />
            </div>
          )}
          <div ref={listRef} id={listId} className="picker-list" role="listbox" tabIndex={withSearch ? -1 : 0}
            aria-label={ariaLabel} aria-labelledby={ariaLabel ? undefined : triggerId}
            aria-activedescendant={withSearch ? undefined : activeId} onKeyDown={withSearch ? undefined : onListKeyDown}>
            {groups.map((g) => (
              <div key={g.group || '_'} role="group" aria-label={g.group || undefined} className="picker-group">
                {g.group && <div className="picker-group-title" aria-hidden="true">{g.group}</div>}
                {g.items.map((o) => {
                  if (!o.disabled) rank += 1;
                  const i = o.disabled ? -1 : rank;
                  return (
                    <OptionRow key={o.value} id={optId(o)} option={o} rank={i} active={i >= 0 && i === active} selected={o.value === value}
                      onPick={onPickRow} onHover={onHoverRow} />
                  );
                })}
              </div>
            ))}
          </div>
          {/* Messages hors de la liste : ce ne sont pas des options. */}
          {flat.length === 0 && <div className="picker-empty" role="status">{emptyText || tr('Aucun résultat.')}</div>}
          {hidden > 0 && <div className="picker-more" role="status">{tr('{n} autre(s) : affinez la recherche.', { n: hidden })}</div>}
        </div>,
        document.body,
      )}
    </div>
  );
}
