import React, { useDeferredValue, useEffect, useMemo, useState } from 'react';
import {
  Search, SlidersHorizontal, Columns3, Save, Clock, RotateCcw, Download,
  ChevronLeft, ChevronRight,
} from 'lucide-react';
import { Alert, Button, Card, EmptyState, IconButton, Skeleton } from './ui.jsx';
import { usePopover, SortTh, makeViewStore } from './listView.jsx';
import { useToast } from './Toast.jsx';
import { useI18n } from '../lib/i18n.jsx';
import { downloadCsv } from '../lib/csv.js';
import { overlaps, periodFromSaved } from '../lib/period.js';
import { sortRows } from '../lib/dataList.js';
import PeriodSelect from './PeriodSelect.jsx';

/**
 * Liste réutilisable « façon COMET » (comme la liste des contrats) : barre de
 * filtres (seuls les filtres cochés s'affichent), sélecteur de colonnes, vues
 * mémorisées (temporaire = session / permanente = user), en-têtes triables,
 * export CSV et pagination. Toute page à tableau branche ses `columns` et
 * `filters` déclaratifs ici au lieu de ré-implémenter les mêmes contrôles.
 *
 * columns: { key: { label, num?, sortable?, sortVal?(row), render(row), csv?(row), width? } }
 * filters: { key: { label, type:'search'|'select'|'period', placeholder?, options?, match(row,val) } }
 *   type 'period' (lot 1b) : bouton compact + PeriodSelect (« Toutes les périodes » = '') ;
 *   valeur { from, to }. Sans `match`, une ligne passe si son intervalle [start(row), end(row)]
 *   (mois ou dates ; end facultatif) chevauche la période. Propriétés facultatives : start, end,
 *   counts, today, latest, presets. Une vue enregistrée avec l'ancienne valeur « AAAA-MM » est
 *   relue comme { from: v, to: v } (jamais rejetée).
 */
export default function DataList({
  rows, columns, defaultColumns, filters = {}, defaultFilters = [],
  storageKey, pageSize = 12, getId = (r) => r.id, defaultSort,
  selectable = false, selectedId = null, onSelect, onRowDoubleClick,
  csvName = 'export.csv', extraIcons = null, toolbar = null, rightToolbar = null,
  error = null, emptyIcon, emptyTitle, emptyAction, emptyChildren,
  rowClassName,
}) {
  const { tr } = useI18n();
  const toast = useToast();
  const viewStore = useMemo(() => makeViewStore(storageKey), [storageKey]);
  const ALL_FILTERS = Object.keys(filters);
  const ALL_COLUMNS = Object.keys(columns);

  const saved = useMemo(() => viewStore.initial(), [viewStore]);
  const emptyValues = useMemo(() => Object.fromEntries(ALL_FILTERS.map((k) => [k, ''])), [storageKey]); // eslint-disable-line
  const [values, setValues] = useState(() => readSavedValues(filters, { ...emptyValues, ...(saved?.values || {}) }));
  const [shownFilters, setShownFilters] = useState(() => saved?.shownFilters || (defaultFilters.length ? defaultFilters : ALL_FILTERS));
  const [cols, setCols] = useState(() => saved?.columns || defaultColumns || ALL_COLUMNS);
  const [sort, setSort] = useState(() => saved?.sort || defaultSort || { key: null, dir: 'asc' });
  const [page, setPage] = useState(1);

  const filterMenu = usePopover();
  const colMenu = usePopover();

  // Mémorisés : une sélection de ligne, un survol ou une saisie ne refiltrent ni ne retrient
  // les milliers de lignes ; seul un changement de données, de filtre ou de tri le fait.
  const shown = useMemo(() => ALL_FILTERS.filter((k) => shownFilters.includes(k)), [filters, shownFilters]); // eslint-disable-line react-hooks/exhaustive-deps
  const shownCols = ALL_COLUMNS.filter((k) => cols.includes(k));
  // Filtrage différé (React 18) : la saisie s'affiche tout de suite, le tableau suit dès que
  // le navigateur est libre (la frappe suivante interrompt un filtrage en cours).
  const deferredValues = useDeferredValue(values);

  const filtered = useMemo(() => {
    let list = rows || [];
    const active = shown.filter((k) => { const v = deferredValues[k]; return !(v === '' || v == null); });
    if (active.length) {
      list = list.filter((r) => active.every((k) => {
        const v = deferredValues[k];
        if (filters[k].match) return filters[k].match(r, v);
        if (filters[k].type === 'period') return overlaps(v, filters[k].start?.(r), filters[k].end?.(r));
        return true;
      }));
    }
    // Tri stable, même ordre qu'avant (lib/dataList : clé lue une fois par ligne, un seul Intl.Collator).
    if (sort.key && columns[sort.key]?.sortVal) list = sortRows(list, columns[sort.key].sortVal, sort.dir);
    return list;
  }, [rows, deferredValues, shown, sort, columns]); // eslint-disable-line react-hooks/exhaustive-deps

  const sig = JSON.stringify({ values, shownFilters, sort });
  useEffect(() => { setPage(1); }, [sig]); // eslint-disable-line
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pageClamped = Math.min(page, totalPages);
  const pageRows = filtered.slice((pageClamped - 1) * pageSize, pageClamped * pageSize);

  function onSort(k) { if (!k) return; setSort((s) => (s.key === k ? { key: k, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key: k, dir: 'asc' })); }
  function setVal(k, v) { setValues((s) => ({ ...s, [k]: v })); }
  function toggleFilter(k) { setShownFilters((ks) => (ks.includes(k) ? ks.filter((x) => x !== k) : [...ks, k])); }
  function toggleColumn(k) { setCols((ks) => (ks.includes(k) ? ks.filter((x) => x !== k) : [...ks, k])); }
  const payload = () => ({ values, shownFilters, columns: cols, sort });
  function resetView() { setValues(emptyValues); viewStore.clear(); toast.info(tr('Filtres réinitialisés.')); }

  // Listes des filtres « select » (souvent dérivées des lignes : régions, districts…) : une fois
  // par changement de données ou de valeurs, pas à chaque rendu.
  const optionLists = useMemo(() => {
    const out = {};
    for (const k of shown) {
      const f = filters[k];
      if (f.type === 'search' || f.type === 'period') continue;
      out[k] = typeof f.options === 'function' ? f.options(rows || [], values) : (f.options || []);
    }
    return out;
  }, [rows, values, shown]); // eslint-disable-line react-hooks/exhaustive-deps
  const optionsFor = (k) => optionLists[k] || [];

  function exportCsv() {
    const head = shownCols.map((k) => columns[k].label);
    const cell = (r, k) => (columns[k].csv ? columns[k].csv(r) : '');
    downloadCsv(csvName, [head, ...filtered.map((r) => shownCols.map((k) => cell(r, k)))]);
  }

  function renderFilter(k) {
    const f = filters[k];
    return (
      <div key={k} className="cfilter">
        <span className="cfilter-label">{f.label}</span>
        {f.type === 'period' ? (
          <PeriodSelect
            compact allowAll value={values[k] || null} onChange={(p) => setVal(k, p || '')}
            counts={f.counts || null} countLabel={f.countLabel} today={f.today} latest={f.latest || null} presets={f.presets} ariaLabel={f.label}
          />
        ) : f.type === 'search' ? (
          <span className="input-wrap"><Search size={16} aria-hidden="true" />
            <input className="input" type="search" placeholder={f.placeholder || tr('Rechercher…')} value={values[k]} onChange={(e) => setVal(k, e.target.value)} />
          </span>
        ) : (
          <select className="select" value={values[k]} onChange={(e) => setVal(k, e.target.value)}>
            {optionsFor(k).map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
        )}
      </div>
    );
  }

  const selected = selectable && selectedId != null ? (rows || []).find((r) => getId(r) === selectedId) : null;

  return (
    <Card>
      <div className="filters-bar comet-filters">
        <span className="filters-label">{tr('Filtres :')}</span>
        <div className="comet-fields">
          {shown.map(renderFilter)}
          {shown.length === 0 && <span className="filters-empty">{tr('Aucun filtre actif — ajoutez-en avec l\'icône filtres.')}</span>}
        </div>
        <div className="comet-icons">
          {extraIcons}
          <div className="pop-anchor" ref={filterMenu.ref}>
            <IconButton icon={SlidersHorizontal} label={tr('Filtres à afficher')} variant="secondary" size="sm" onClick={() => filterMenu.setOpen((o) => !o)} />
            {filterMenu.open && (
              <div className="pop-menu filter-menu" role="menu">
                <div className="pop-menu-label">{tr('Filtres à afficher')}</div>
                {ALL_FILTERS.map((k) => (
                  <label key={k} className="filter-pick"><input type="checkbox" checked={shownFilters.includes(k)} onChange={() => toggleFilter(k)} /><span>{filters[k].label}</span></label>
                ))}
              </div>
            )}
          </div>
          <div className="pop-anchor" ref={colMenu.ref}>
            <IconButton icon={Columns3} label={tr('Colonnes à afficher')} variant="secondary" size="sm" onClick={() => colMenu.setOpen((o) => !o)} />
            {colMenu.open && (
              <div className="pop-menu filter-menu" role="menu">
                <div className="pop-menu-label">{tr('Colonnes à afficher')}</div>
                {ALL_COLUMNS.map((k) => (
                  <label key={k} className="filter-pick"><input type="checkbox" checked={cols.includes(k)} onChange={() => toggleColumn(k)} /><span>{columns[k].label}</span></label>
                ))}
              </div>
            )}
          </div>
          <IconButton icon={Clock} label={tr('Mémoriser le filtre (temporaire)')} variant="secondary" size="sm" onClick={() => { viewStore.saveTemp(payload()); toast.success(tr('Filtre mémorisé pour cette session.')); }} />
          <IconButton icon={Save} label={tr('Mémoriser le filtre (permanent)')} variant="secondary" size="sm" onClick={() => { viewStore.savePerm(payload()); toast.success(tr('Filtre enregistré comme vue par défaut.')); }} />
          <IconButton icon={RotateCcw} label={tr('Réinitialiser')} variant="secondary" size="sm" onClick={resetView} />
        </div>
      </div>

      {(toolbar || rightToolbar) && (
        <div className="data-toolbar">
          <div className="data-toolbar-left">{toolbar && toolbar(selected)}</div>
          <div className="data-toolbar-right">
            {rightToolbar}
            <Button size="sm" variant="secondary" icon={Download} onClick={exportCsv} disabled={!(rows && rows.length)}>{tr('Exporter (CSV)')}</Button>
          </div>
        </div>
      )}
      {!toolbar && !rightToolbar && (
        <div className="data-toolbar"><div className="data-toolbar-left" /><div className="data-toolbar-right">
          <Button size="sm" variant="secondary" icon={Download} onClick={exportCsv} disabled={!(rows && rows.length)}>{tr('Exporter (CSV)')}</Button>
        </div></div>
      )}

      {error && <div style={{ padding: '12px 20px 0' }}><Alert tone="error">{error}</Alert></div>}

      <div className="table-wrap">
        <table className="table grid">
          <thead><tr>
            {selectable && <th scope="col" style={{ width: 36 }}><span className="sr-only">{tr('Sélection')}</span></th>}
            {shownCols.map((k) => (columns[k].sortVal
              ? <SortTh key={k} label={columns[k].label} k={k} sort={sort} onSort={onSort} className={columns[k].num ? 'num' : ''} />
              : <th key={k} scope="col" className={columns[k].num ? 'num' : ''} style={columns[k].width ? { width: columns[k].width } : undefined}>{columns[k].label}</th>))}
          </tr></thead>
          <tbody>
            {rows === null
              ? [0, 1, 2].map((i) => <tr key={i} aria-hidden="true">{selectable && <td />}<td colSpan={shownCols.length}><Skeleton height={18} /></td></tr>)
              : pageRows.map((r) => {
                  const id = getId(r);
                  const isSel = selectable && selectedId === id;
                  const extra = rowClassName ? rowClassName(r) : '';
                  return (
                    <tr key={id} className={`${selectable || onRowDoubleClick ? 'clickable' : ''} ${isSel ? 'is-selected' : ''} ${extra}`}
                      onClick={selectable ? () => onSelect && onSelect(id) : undefined}
                      onDoubleClick={onRowDoubleClick ? () => onRowDoubleClick(r) : undefined}>
                      {selectable && (
                        <td onClick={(e) => e.stopPropagation()}>
                          <input type="radio" name={`sel-${storageKey}`} checked={isSel} onChange={() => onSelect && onSelect(isSel ? null : id)} aria-label={tr('Sélectionner')} />
                        </td>
                      )}
                      {shownCols.map((k) => <td key={k} className={columns[k].num ? 'num tabular' : ''}>{columns[k].render(r)}</td>)}
                    </tr>
                  );
                })}
          </tbody>
        </table>
        {rows && filtered.length === 0 && (
          <EmptyState icon={emptyIcon} title={rows.length ? tr('Aucun élément ne correspond') : (emptyTitle ?? tr('Aucun élément'))}
            action={rows.length ? <Button variant="secondary" icon={RotateCcw} onClick={resetView}>{tr('Réinitialiser les filtres')}</Button> : emptyAction}>
            {rows.length ? tr('Ajustez les filtres.') : emptyChildren}
          </EmptyState>
        )}
      </div>

      {rows && filtered.length > 0 && (
        <div className="list-foot">
          <span className="list-count">{tr('{a}–{b} sur {n}', { a: (pageClamped - 1) * pageSize + 1, b: Math.min(pageClamped * pageSize, filtered.length), n: filtered.length })}</span>
          <div className="pager">
            <button type="button" className="pager-btn" disabled={pageClamped <= 1} onClick={() => setPage(pageClamped - 1)} aria-label={tr('Page précédente')}><ChevronLeft size={16} /></button>
            <span className="pager-info">{tr('Page {p} / {t}', { p: pageClamped, t: totalPages })}</span>
            <button type="button" className="pager-btn" disabled={pageClamped >= totalPages} onClick={() => setPage(pageClamped + 1)} aria-label={tr('Page suivante')}><ChevronRight size={16} /></button>
          </div>
        </div>
      )}
    </Card>
  );
}

/** Valeurs d'une vue enregistrée relues selon le type de filtre (période : ancien « AAAA-MM » converti). */
function readSavedValues(filters, values) {
  const out = { ...values };
  for (const [k, f] of Object.entries(filters)) {
    if (f.type === 'period') out[k] = periodFromSaved(out[k]);
  }
  return out;
}
