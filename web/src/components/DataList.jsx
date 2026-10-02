import React, { useEffect, useMemo, useState } from 'react';
import {
  Search, SlidersHorizontal, Columns3, Save, Clock, RotateCcw, Download,
  ChevronLeft, ChevronRight,
} from 'lucide-react';
import { Alert, Button, Card, EmptyState, IconButton, Skeleton } from './ui.jsx';
import { usePopover, SortTh, makeViewStore } from './listView.jsx';
import { useToast } from './Toast.jsx';

/**
 * Liste réutilisable « façon COMET » (comme la liste des contrats) : barre de
 * filtres (seuls les filtres cochés s'affichent), sélecteur de colonnes, vues
 * mémorisées (temporaire = session / permanente = user), en-têtes triables,
 * export CSV et pagination. Toute page à tableau branche ses `columns` et
 * `filters` déclaratifs ici au lieu de ré-implémenter les mêmes contrôles.
 *
 * columns: { key: { label, num?, sortable?, sortVal?(row), render(row), csv?(row), width? } }
 * filters: { key: { label, type:'search'|'select', placeholder?, options?, match(row,val) } }
 */
export default function DataList({
  rows, columns, defaultColumns, filters = {}, defaultFilters = [],
  storageKey, pageSize = 12, getId = (r) => r.id, defaultSort,
  selectable = false, selectedId = null, onSelect, onRowDoubleClick,
  csvName = 'export.csv', extraIcons = null, toolbar = null, rightToolbar = null,
  error = null, emptyIcon, emptyTitle = 'Aucun élément', emptyAction, emptyChildren,
  rowClassName,
}) {
  const toast = useToast();
  const viewStore = useMemo(() => makeViewStore(storageKey), [storageKey]);
  const ALL_FILTERS = Object.keys(filters);
  const ALL_COLUMNS = Object.keys(columns);

  const saved = useMemo(() => viewStore.initial(), [viewStore]);
  const emptyValues = useMemo(() => Object.fromEntries(ALL_FILTERS.map((k) => [k, ''])), [storageKey]); // eslint-disable-line
  const [values, setValues] = useState(() => ({ ...emptyValues, ...(saved?.values || {}) }));
  const [shownFilters, setShownFilters] = useState(() => saved?.shownFilters || (defaultFilters.length ? defaultFilters : ALL_FILTERS));
  const [cols, setCols] = useState(() => saved?.columns || defaultColumns || ALL_COLUMNS);
  const [sort, setSort] = useState(() => saved?.sort || defaultSort || { key: null, dir: 'asc' });
  const [page, setPage] = useState(1);

  const filterMenu = usePopover();
  const colMenu = usePopover();

  const shown = ALL_FILTERS.filter((k) => shownFilters.includes(k));
  const shownCols = ALL_COLUMNS.filter((k) => cols.includes(k));

  const filtered = useMemo(() => {
    let list = rows || [];
    list = list.filter((r) => shown.every((k) => {
      const v = values[k]; if (v === '' || v == null) return true;
      return filters[k].match ? filters[k].match(r, v) : true;
    }));
    if (sort.key && columns[sort.key]?.sortVal) {
      const sv = columns[sort.key].sortVal;
      list = [...list].sort((a, b) => {
        const va = sv(a); const vb = sv(b);
        const cmp = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va ?? '').localeCompare(String(vb ?? ''));
        return sort.dir === 'asc' ? cmp : -cmp;
      });
    }
    return list;
  }, [rows, values, shown, sort]); // eslint-disable-line

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
  function resetView() { setValues(emptyValues); viewStore.clear(); toast.info('Filtres réinitialisés.'); }

  function optionsFor(k) {
    const f = filters[k];
    return typeof f.options === 'function' ? f.options(rows || [], values) : (f.options || []);
  }

  function exportCsv() {
    const head = shownCols.map((k) => columns[k].label);
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const cell = (r, k) => (columns[k].csv ? columns[k].csv(r) : '');
    const lines = filtered.map((r) => shownCols.map((k) => cell(r, k)).map(esc).join(';'));
    const blob = new Blob(['﻿' + [head.map(esc).join(';'), ...lines].join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const el = document.createElement('a'); el.href = url; el.download = csvName; document.body.appendChild(el); el.click(); el.remove(); URL.revokeObjectURL(url);
  }

  function renderFilter(k) {
    const f = filters[k];
    return (
      <div key={k} className="cfilter">
        <span className="cfilter-label">{f.label}</span>
        {f.type === 'search' ? (
          <span className="input-wrap"><Search size={16} aria-hidden="true" />
            <input className="input" type="search" placeholder={f.placeholder || 'Rechercher…'} value={values[k]} onChange={(e) => setVal(k, e.target.value)} />
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
        <span className="filters-label">Filtres&nbsp;:</span>
        <div className="comet-fields">
          {shown.map(renderFilter)}
          {shown.length === 0 && <span className="filters-empty">Aucun filtre actif — ajoutez-en avec l'icône filtres.</span>}
        </div>
        <div className="comet-icons">
          {extraIcons}
          <div className="pop-anchor" ref={filterMenu.ref}>
            <IconButton icon={SlidersHorizontal} label="Filtres à afficher" variant="secondary" size="sm" onClick={() => filterMenu.setOpen((o) => !o)} />
            {filterMenu.open && (
              <div className="pop-menu filter-menu" role="menu">
                <div className="pop-menu-label">Filtres à afficher</div>
                {ALL_FILTERS.map((k) => (
                  <label key={k} className="filter-pick"><input type="checkbox" checked={shownFilters.includes(k)} onChange={() => toggleFilter(k)} /><span>{filters[k].label}</span></label>
                ))}
              </div>
            )}
          </div>
          <div className="pop-anchor" ref={colMenu.ref}>
            <IconButton icon={Columns3} label="Colonnes à afficher" variant="secondary" size="sm" onClick={() => colMenu.setOpen((o) => !o)} />
            {colMenu.open && (
              <div className="pop-menu filter-menu" role="menu">
                <div className="pop-menu-label">Colonnes à afficher</div>
                {ALL_COLUMNS.map((k) => (
                  <label key={k} className="filter-pick"><input type="checkbox" checked={cols.includes(k)} onChange={() => toggleColumn(k)} /><span>{columns[k].label}</span></label>
                ))}
              </div>
            )}
          </div>
          <IconButton icon={Clock} label="Mémoriser le filtre (temporaire)" variant="secondary" size="sm" onClick={() => { viewStore.saveTemp(payload()); toast.success('Filtre mémorisé pour cette session.'); }} />
          <IconButton icon={Save} label="Mémoriser le filtre (permanent)" variant="secondary" size="sm" onClick={() => { viewStore.savePerm(payload()); toast.success('Filtre enregistré comme vue par défaut.'); }} />
          <IconButton icon={RotateCcw} label="Réinitialiser" variant="secondary" size="sm" onClick={resetView} />
        </div>
      </div>

      {(toolbar || rightToolbar) && (
        <div className="data-toolbar">
          <div className="data-toolbar-left">{toolbar && toolbar(selected)}</div>
          <div className="data-toolbar-right">
            {rightToolbar}
            <Button size="sm" variant="secondary" icon={Download} onClick={exportCsv} disabled={!(rows && rows.length)}>Exporter (CSV)</Button>
          </div>
        </div>
      )}
      {!toolbar && !rightToolbar && (
        <div className="data-toolbar"><div className="data-toolbar-left" /><div className="data-toolbar-right">
          <Button size="sm" variant="secondary" icon={Download} onClick={exportCsv} disabled={!(rows && rows.length)}>Exporter (CSV)</Button>
        </div></div>
      )}

      {error && <div style={{ padding: '12px 20px 0' }}><Alert tone="error">{error}</Alert></div>}

      <div className="table-wrap">
        <table className="table grid">
          <thead><tr>
            {selectable && <th scope="col" style={{ width: 36 }}><span className="sr-only">Sélection</span></th>}
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
                          <input type="radio" name={`sel-${storageKey}`} checked={isSel} onChange={() => onSelect && onSelect(isSel ? null : id)} aria-label="Sélectionner" />
                        </td>
                      )}
                      {shownCols.map((k) => <td key={k} className={columns[k].num ? 'num tabular' : ''}>{columns[k].render(r)}</td>)}
                    </tr>
                  );
                })}
          </tbody>
        </table>
        {rows && filtered.length === 0 && (
          <EmptyState icon={emptyIcon} title={rows.length ? 'Aucun élément ne correspond' : emptyTitle}
            action={rows.length ? <Button variant="secondary" icon={RotateCcw} onClick={resetView}>Réinitialiser les filtres</Button> : emptyAction}>
            {rows.length ? 'Ajustez les filtres.' : emptyChildren}
          </EmptyState>
        )}
      </div>

      {rows && filtered.length > 0 && (
        <div className="list-foot">
          <span className="list-count">{(pageClamped - 1) * pageSize + 1}–{Math.min(pageClamped * pageSize, filtered.length)} sur {filtered.length}</span>
          <div className="pager">
            <button type="button" className="pager-btn" disabled={pageClamped <= 1} onClick={() => setPage(pageClamped - 1)} aria-label="Page précédente"><ChevronLeft size={16} /></button>
            <span className="pager-info">Page {pageClamped} / {totalPages}</span>
            <button type="button" className="pager-btn" disabled={pageClamped >= totalPages} onClick={() => setPage(pageClamped + 1)} aria-label="Page suivante"><ChevronRight size={16} /></button>
          </div>
        </div>
      )}
    </Card>
  );
}
