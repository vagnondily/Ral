import React, { useMemo, useState } from 'react';
import { Search, Columns3, Download, Rows3, Rows4, X, TrendingUp, TrendingDown, Layers } from 'lucide-react';
import { Button, EmptyState, IconButton, StatusBadge } from '../../components/ui.jsx';
import Modal from '../../components/Modal.jsx';
import { usePopover } from '../../components/listView.jsx';
import { useI18n } from '../../lib/i18n.jsx';
import { downloadCsv } from '../../lib/csv.js';

/**
 * Liste d'indicateurs « riche » (façon maquette design/liste-drawer) : table
 * aérée, barres de progression en ligne (Réalisé / Cible · %), statut
 * couleur+icône+libellé, sélection multiple + barre d'actions, densité réglable,
 * colonnes configurables (mémorisées), et clic sur une ligne → drawer de détail.
 * Câblée aux vrais indicateurs (monDashboard) : aucun champ inventé.
 */
// Classes d'indicateur : la même règle partout (serveur monitoringMath.classify), même vocabulaire que les tableaux de bord.
const STAT = {
  exc: { label: 'Excellent', tone: 'green', icon: 'check', fill: 'var(--green)' },
  sat: { label: 'Satisfaisant', tone: 'blue', icon: 'clock', fill: 'var(--blue-600)' },
  imp: { label: 'À améliorer', tone: 'orange', icon: 'warn', fill: 'var(--orange)' },
  urg: { label: 'Action urgente', tone: 'red', icon: 'x', fill: 'var(--red)' },
  na: { label: 'Non évalué', tone: undefined, icon: 'na', fill: 'var(--text-faint)' },
};
const AGG = { percent_yes: '% de « oui »', percent_value: '% = valeur', mean: 'Moyenne', sum: 'Somme', count: 'Nombre' };
const RATING_ORDER = { exc: 4, sat: 3, imp: 2, urg: 1, na: 0 };

const ALL_COLS = {
  module: { label: 'Module' },
  prog: { label: 'Réalisé / Cible' },
  statut: { label: 'Statut' },
  base: { label: 'Base (n)' },
  agg: { label: 'Agrégation' },
  sens: { label: 'Sens' },
  source: { label: 'Champ source' },
};
const DEFAULT_COLS = ['module', 'prog', 'statut', 'base'];
const STORE = 'mems.indicators.view.v1';

const isPct = (i) => i.agg === 'percent_yes' || i.agg === 'percent_value';
function progress(i) {
  if (i.value == null) return { has: false };
  if (isPct(i)) return { has: true, text: `${i.value} %`, rate: Math.min(Math.max(i.value / 100, 0), 1), pct: Math.round(i.value) };
  if (i.target != null && Number(i.target) > 0) {
    const r = i.value / i.target;
    return { has: true, text: `${i.value} / ${i.target}`, rate: Math.min(Math.max(r, 0), 1), pct: Math.round(r * 100) };
  }
  return { has: true, text: String(i.value), rate: null, pct: null };
}

function loadView() {
  try { return JSON.parse(localStorage.getItem(STORE)) || {}; } catch { return {}; }
}
function saveView(v) { try { localStorage.setItem(STORE, JSON.stringify(v)); } catch { /* ignore */ } }

// Phrase traduite contenant des éléments JSX : « {nom} » → nodes[nom].
function fillNodes(text, nodes) {
  return text.split(/\{(\w+)\}/).map((part, i) => (i % 2 ? <React.Fragment key={i}>{nodes[part]}</React.Fragment> : part));
}

export default function IndicatorsList({ indicators, moduleLabel, toolbarExtra }) {
  const { tr } = useI18n();
  const saved = loadView();
  const [q, setQ] = useState('');
  const [cols, setCols] = useState(() => saved.cols || DEFAULT_COLS);
  const [dense, setDense] = useState(() => saved.dense || false);
  const [group, setGroup] = useState(() => saved.group || false);
  const [sort, setSort] = useState(() => saved.sort || { key: 'statut', dir: 'asc' });
  const [sel, setSel] = useState(() => new Set());
  const [open, setOpen] = useState(null); // indicateur ouvert dans le drawer
  const colMenu = usePopover();

  const persist = (patch) => saveView({ cols, dense, group, sort, ...patch });
  const toggleCol = (k) => setCols((cs) => { const next = cs.includes(k) ? cs.filter((x) => x !== k) : [...cs, k]; persist({ cols: next }); return next; });
  const setDensity = (d) => { setDense(d); persist({ dense: d }); };
  const toggleGroup = () => setGroup((g) => { persist({ group: !g }); return !g; });
  const onSort = (key) => setSort((s) => { const next = s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }; persist({ sort: next }); return next; });
  const resetView = () => { setCols(DEFAULT_COLS); setDense(false); setGroup(false); setSort({ key: 'statut', dir: 'asc' }); setQ(''); saveView({}); };

  const rows = useMemo(() => {
    let list = (indicators || []).filter((i) => {
      if (!q) return true;
      const s = q.toLowerCase();
      return [i.label, i.code, i.module, i.sourceField].some((x) => x && String(x).toLowerCase().includes(s));
    });
    const val = (i) => ({
      indicateur: i.label || '', module: i.module || '', prog: progress(i).rate ?? (i.value ?? -1),
      statut: RATING_ORDER[i.rating] ?? 0, base: i.base ?? -1, agg: AGG[i.agg] || '', source: i.sourceField || '',
    }[sort.key] ?? '');
    return [...list].sort((a, b) => {
      const va = val(a); const vb = val(b);
      const c = typeof va === 'number' ? va - vb : String(va).localeCompare(String(vb));
      return sort.dir === 'asc' ? c : -c;
    });
  }, [indicators, q, sort]);

  const groups = useMemo(() => {
    const g = new Map();
    for (const i of rows) { const k = i.module || tr('Sans module'); if (!g.has(k)) g.set(k, []); g.get(k).push(i); }
    return [...g.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [rows, tr]);

  const shown = Object.keys(ALL_COLS).filter((k) => cols.includes(k));
  const allSel = rows.length > 0 && rows.every((i) => sel.has(i.id));
  const toggleAll = () => setSel(allSel ? new Set() : new Set(rows.map((i) => i.id)));
  const toggleOne = (id) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const exportCsv = (which) => {
    const list = which === 'sel' ? rows.filter((i) => sel.has(i.id)) : rows;
    const head = ['Indicateur', 'Code', 'Module', 'Réalisé', 'Cible', 'Base (n)', 'Statut', 'Agrégation', 'Sens', 'Champ source'].map((h) => tr(h));
    const lines = list.map((i) => [i.label, i.code, i.module, i.value, i.target, i.base, STAT[i.rating] && tr(STAT[i.rating].label), AGG[i.agg] && tr(AGG[i.agg]), i.direction === 'lower_better' ? tr('plus bas = mieux') : tr('plus haut = mieux'), i.sourceField]);
    downloadCsv('indicateurs.csv', [head, ...lines]);
  };

  const Caret = ({ k }) => (sort.key === k ? <span className="ind-caret">{sort.dir === 'asc' ? '▲' : '▼'}</span> : null);

  function renderRow(i) {
    const st = STAT[i.rating] || STAT.na;
    const p = progress(i);
    const isSel = sel.has(i.id);
    return (
      <tr key={i.id} className={`clickable ${isSel ? 'is-selected' : ''}`} onClick={() => setOpen(i)}>
        <td className="ind-cb" onClick={(e) => e.stopPropagation()}>
          <input type="checkbox" checked={isSel} onChange={() => toggleOne(i.id)} aria-label={tr('Sélectionner {label}', { label: i.label })} />
        </td>
        <td><span className="ind-name">{i.label}</span>{i.code && <div className="ind-sub mono">{i.code}</div>}</td>
        {shown.map((k) => {
          if (k === 'module') return <td key={k} className="muted">{i.module || '—'}</td>;
          if (k === 'prog') return <td key={k}>{p.has
            ? <div className="ind-prog"><div className="ind-nums"><b className="mono">{p.text}</b>{p.pct != null && <span className="mono">{p.pct} %</span>}</div>{p.rate != null && <div className="ind-bar"><i style={{ width: `${Math.round(p.rate * 100)}%`, background: st.fill }} /></div>}</div>
            : <span className="cell-empty">—</span>}</td>;
          if (k === 'statut') return <td key={k}><StatusBadge def={st} /></td>;
          if (k === 'base') return <td key={k} className="num mono">{i.base ?? <span className="cell-empty">—</span>}</td>;
          if (k === 'agg') return <td key={k} className="muted">{AGG[i.agg] ? tr(AGG[i.agg]) : i.agg}</td>;
          if (k === 'sens') return <td key={k}>{i.direction === 'lower_better' ? <span className="ind-sens"><TrendingDown size={14} /> {tr('plus bas')}</span> : <span className="ind-sens"><TrendingUp size={14} /> {tr('plus haut')}</span>}</td>;
          if (k === 'source') return <td key={k}><span className="mono ind-sub">{i.sourceField || '—'}</span></td>;
          return <td key={k} />;
        })}
      </tr>
    );
  }

  return (
    <div className="ind-wrap">
      {/* Toolbar */}
      <div className="ind-toolbar">
        <span className="input-wrap ind-search"><Search size={16} aria-hidden="true" />
          <input className="input" type="search" placeholder={tr('Filtrer les indicateurs…')} value={q} onChange={(e) => setQ(e.target.value)} />
        </span>
        {toolbarExtra}
        <span className="ind-hint">{tr('Clic sur une ligne pour le détail')}</span>
        <span className="ind-tsp" />
        <div className="seg" role="group" aria-label={tr('Densité')}>
          <button type="button" className={!dense ? 'is-active' : ''} onClick={() => setDensity(false)} title={tr('Confort')} aria-label={tr('Confort')}><Rows3 size={16} /></button>
          <button type="button" className={dense ? 'is-active' : ''} onClick={() => setDensity(true)} title={tr('Compact')} aria-label={tr('Compact')}><Rows4 size={16} /></button>
        </div>
        <IconButton icon={Layers} label={tr('Grouper par module')} variant={group ? 'primary' : 'secondary'} size="sm" aria-pressed={group} onClick={toggleGroup} />
        <div className="pop-anchor" ref={colMenu.ref}>
          <IconButton icon={Columns3} label={tr('Colonnes')} variant="secondary" size="sm" onClick={() => colMenu.setOpen((o) => !o)} />
          {colMenu.open && (
            <div className="pop-menu filter-menu" role="menu">
              <div className="pop-menu-label">{tr('Colonnes à afficher')}</div>
              {Object.entries(ALL_COLS).map(([k, c]) => (
                <label key={k} className="filter-pick"><input type="checkbox" checked={cols.includes(k)} onChange={() => toggleCol(k)} /><span>{tr(c.label)}</span></label>
              ))}
              <button type="button" className="pop-reset" onClick={resetView}>{tr("Réinitialiser l'affichage")}</button>
            </div>
          )}
        </div>
        <IconButton icon={Download} label={tr('Exporter (CSV)')} variant="secondary" size="sm" onClick={() => exportCsv('all')} />
      </div>

      {/* Barre d'actions groupées */}
      {sel.size > 0 && (
        <div className="ind-batch">
          <span className="ind-batch-n">{tr('{n} sélectionné(s)', { n: sel.size })}</span>
          <Button size="sm" variant="ghost" icon={Download} onClick={() => exportCsv('sel')}>{tr('Exporter la sélection')}</Button>
          <Button size="sm" variant="ghost" icon={X} onClick={() => setSel(new Set())}>{tr('Désélectionner')}</Button>
        </div>
      )}

      <div className="ind-tablewrap">
        <div className="table-wrap">
          <table className={`table ind-table ${dense ? 'is-dense' : ''}`}>
            <thead><tr>
              <th className="ind-cb"><input type="checkbox" checked={allSel} onChange={toggleAll} aria-label={tr('Tout sélectionner')} /></th>
              <th className="ind-sortable" onClick={() => onSort('indicateur')}>{tr('Indicateur')} <Caret k="indicateur" /></th>
              {shown.map((k) => {
                const sortable = ['module', 'statut', 'prog', 'base'].includes(k);
                return (
                  <th key={k} className={`${sortable ? 'ind-sortable' : ''} ${['prog', 'base'].includes(k) ? 'num' : ''}`}
                    onClick={sortable ? () => onSort(k) : undefined}>
                    {tr(ALL_COLS[k].label)} {sortable && <Caret k={k} />}
                  </th>
                );
              })}
            </tr></thead>
            <tbody>
              {rows.length === 0 && <tr className="ind-empty"><td colSpan={shown.length + 2}><EmptyState icon={TrendingUp} title={tr('Aucun indicateur')}>{tr('Définissez des indicateurs et importez des données réelles.')}</EmptyState></td></tr>}
              {group
                ? groups.map(([mod, list]) => (
                  <React.Fragment key={mod}>
                    <tr className="subrow-head"><td colSpan={shown.length + 2}>{tr('{module} · {n} indicateur(s)', { module: mod, n: list.length })}</td></tr>
                    {list.map((i) => renderRow(i))}
                  </React.Fragment>
                ))
                : rows.map((i) => renderRow(i))}
            </tbody>
          </table>
        </div>
      </div>

      {open && <IndicatorDrawer ind={open} moduleLabel={moduleLabel} onClose={() => setOpen(null)} />}
    </div>
  );
}

function IndicatorDrawer({ ind, moduleLabel, onClose }) {
  const { tr } = useI18n();
  const [tab, setTab] = useState('details');
  const st = STAT[ind.rating] || STAT.na;
  const p = progress(ind);
  const kv = [
    [tr('Statut'), <StatusBadge def={st} />],
    [tr('Module'), ind.module || '—'],
    [tr('Agrégation'), AGG[ind.agg] ? tr(AGG[ind.agg]) : ind.agg],
    [tr('Champ source'), <span className="mono">{ind.sourceField || '—'}</span>],
    [tr('Cible'), ind.target ?? '—'],
    [tr('Sens'), ind.direction === 'lower_better' ? tr('↓ plus bas = mieux') : tr('↑ plus haut = mieux')],
    ...(ind.base != null ? [[tr('Base de calcul'), ind.base]] : []),
  ];
  return (
    <Modal open variant="drawer" size="md" title={ind.label}
      subtitle={ind.code ? `${ind.code}${moduleLabel ? ` · ${moduleLabel}` : ''}` : moduleLabel}
      onClose={onClose}
      footer={<><Button variant="secondary" onClick={onClose}>{tr('Fermer')}</Button></>}>
      <div className="ind-dtabs">
        <button type="button" className={tab === 'details' ? 'on' : ''} onClick={() => setTab('details')}>{tr('Détails')}</button>
        <button type="button" className={tab === 'method' ? 'on' : ''} onClick={() => setTab('method')}>{tr('Méthode')}</button>
      </div>

      {tab === 'details' ? (
        <>
          <div className="ind-hero">
            <div className="ind-hero-big mono">{p.has ? p.text : '—'}{p.pct != null && <small> · {p.pct} %</small>}</div>
            {p.rate != null && <div className="ind-bar lg"><i style={{ width: `${Math.round(p.rate * 100)}%`, background: st.fill }} /></div>}
          </div>
          <dl className="ind-kv">
            {kv.map(([k, v], idx) => (<React.Fragment key={idx}><dt>{k}</dt><dd>{v}</dd></React.Fragment>))}
          </dl>
        </>
      ) : (
        <div className="ind-method">
          <p>{fillNodes(ind.agg === 'percent_value' && ind.positiveValue
            ? tr('Cet indicateur agrège le champ {field} des soumissions par {method} (valeur « positive » = {value}).')
            : tr('Cet indicateur agrège le champ {field} des soumissions par {method}.'), {
            field: <strong className="mono">{ind.sourceField || '—'}</strong>,
            method: <strong>{(AGG[ind.agg] ? tr(AGG[ind.agg]) : ind.agg).toLowerCase()}</strong>,
            value: <strong className="mono">{ind.positiveValue}</strong>,
          })}</p>
          <p>{fillNodes(tr('La cible est {target}, avec la convention {direction}.'), {
            target: ind.target != null ? <strong>{ind.target}</strong> : <em>{tr('non définie')}</em>,
            direction: <strong>{ind.direction === 'lower_better' ? tr('plus bas = mieux') : tr('plus haut = mieux')}</strong>,
          })}</p>
          <p className="muted">{tr('Tout est recalculé en direct depuis les données réelles (aucune valeur saisie à la main).')}</p>
        </div>
      )}
    </Modal>
  );
}
