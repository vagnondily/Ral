import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Plus, Search, FileSignature, AlertCircle, Info, ExternalLink, Pencil, Send, ShieldCheck,
  X, FilePlus2, RefreshCw, Ban, Download, ArrowUp, ArrowDown, RotateCcw, ChevronLeft, ChevronRight,
  SlidersHorizontal, Save, Trash2, Check,
} from 'lucide-react';
import { api } from '../../api/client.js';
import { Alert, Badge, Button, Card, EmptyState, IconButton, Skeleton, StatusBadge, Stats, Usage } from '../../components/ui.jsx';
import { useToast } from '../../components/Toast.jsx';
import { formatAr, formatInt } from '../../lib/format.js';
import { CONTRACT_STATUS, contractFlags, periodLabel } from '../../lib/contracts.js';
import { SubmitDialog, DecisionDialog, RenewDialog, TerminateDialog } from './ContractDialogs.jsx';

const STATUSES = [
  { id: '', label: 'Tous les statuts' },
  { id: 'brouillon', label: 'Brouillon' },
  { id: 'en_validation', label: 'En validation' },
  { id: 'actif', label: 'Actif' },
  { id: 'rejete', label: 'Rejeté' },
  { id: 'resilie', label: 'Résilié' },
];
const PAGE_SIZE = 12;

// ---- Filter catalogue --------------------------------------------------
// A single control (the "Filtres" icon) picks which filters are active: only
// the checked ones appear in the bar and narrow the list. Values are kept in
// state, so re-activating a filter restores its previous value.
const FILTERS = {
  q:         { label: 'Recherche', type: 'search', empty: '', ph: 'Partenaire, FLA, PO, Vendor…' },
  status:    { label: 'Statut', type: 'select', empty: '' },
  activity:  { label: 'Activité', type: 'select', empty: '' },
  type:      { label: 'Type de partenaire', type: 'select', empty: '' },
  year:      { label: 'Année (début)', type: 'select', empty: '' },
  attention: { label: 'À traiter uniquement', type: 'check', empty: false },
  overspent: { label: 'Suivi/TPM dépassé', type: 'check', empty: false },
  hasAmend:  { label: 'Avec avenant(s)', type: 'check', empty: false },
};
const ALL_KEYS = ['q', 'status', 'activity', 'type', 'year', 'attention', 'overspent', 'hasAmend'];
const DEFAULT_KEYS = ['q', 'status', 'activity', 'type', 'year', 'attention'];
const emptyValues = () => Object.fromEntries(ALL_KEYS.map((k) => [k, FILTERS[k].empty]));

function matchOne(key, c, v) {
  switch (key) {
    case 'q': {
      const q = String(v || '').trim().toLowerCase();
      return !q || [c.partnerName, c.numero, c.numeroFla, c.numeroPo, c.numeroVendor].some((x) => x && x.toLowerCase().includes(q));
    }
    case 'status': return !v || c.status === v;
    case 'activity': return !v || (c.activities || []).includes(v);
    case 'type': return !v || c.partnerTypeLabel === v;
    case 'year': return !v || (c.dateDebut || '').startsWith(v);
    case 'attention': return !v || c.amendmentRequired || c.status === 'en_validation';
    case 'overspent': return !v || (c.monitoringBudget > 0 && c.spentTotal > c.monitoringBudget);
    case 'hasAmend': return !v || (c.amendmentCount || 0) > 0;
    default: return true;
  }
}

// ---- Saved views (persistent in localStorage, temporary in sessionStorage) --
const VIEW_KEY = 'mems.contracts.filterViews';
function readViews() {
  const parse = (store) => { try { return JSON.parse(store.getItem(VIEW_KEY) || '[]'); } catch { return []; } };
  try {
    const perm = parse(window.localStorage).map((v) => ({ ...v, temp: false }));
    const temp = parse(window.sessionStorage).map((v) => ({ ...v, temp: true }));
    return [...perm, ...temp];
  } catch { return []; }
}
function writeViews(views) {
  const perm = views.filter((v) => !v.temp).map(({ temp, ...v }) => v);
  const temp = views.filter((v) => v.temp).map(({ temp, ...v }) => v);
  try { window.localStorage.setItem(VIEW_KEY, JSON.stringify(perm)); } catch { /* ignore */ }
  try { window.sessionStorage.setItem(VIEW_KEY, JSON.stringify(temp)); } catch { /* ignore */ }
}

// Close a popover on outside click or Escape.
function usePopover() {
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

function SortTh({ label, k, sort, onSort, className }) {
  const active = sort.key === k;
  return (
    <th scope="col" className={`sortable ${className || ''} ${active ? 'is-sorted' : ''}`} onClick={() => onSort(k)}>
      <span className="th-inner">{label}{active && (sort.dir === 'asc' ? <ArrowUp size={13} /> : <ArrowDown size={13} />)}</span>
    </th>
  );
}

export default function ContractsListPage({ canEdit, onOpen, onNew, onEdit, onAmend }) {
  const toast = useToast();
  const [contracts, setContracts] = useState(null);
  const [activityMap, setActivityMap] = useState({});
  const [error, setError] = useState(null);
  const [values, setValues] = useState(emptyValues);
  const [shownKeys, setShownKeys] = useState(DEFAULT_KEYS);
  const [views, setViews] = useState(readViews);
  const [currentView, setCurrentView] = useState('');
  const [sort, setSort] = useState({ key: 'status', dir: 'asc' });
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState(null);
  const [selected, setSelected] = useState(null);
  const [dialog, setDialog] = useState(null);

  const filterMenu = usePopover();
  const viewMenu = usePopover();
  const [saveName, setSaveName] = useState('');
  const [saveTemp, setSaveTemp] = useState(false);

  async function reload() {
    setError(null);
    try { setContracts(await api.listContracts()); }
    catch (err) { setError(err.message); setContracts((c) => c || []); }
  }
  useEffect(() => {
    reload();
    api.listActivities().then((a) => setActivityMap(Object.fromEntries(a.map((x) => [x.code, x.label])))).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selectedId) { setSelected(null); return; }
    let alive = true; setSelected(null);
    api.getContract(selectedId).then((d) => { if (alive) setSelected(d); }).catch((e) => toast.error(e.message));
    return () => { alive = false; };
  }, [selectedId, toast]);

  const stats = useMemo(() => {
    if (!contracts) return null;
    const active = contracts.filter((c) => c.status === 'actif');
    return {
      total: contracts.length, active: active.length,
      budget: active.reduce((n, c) => n + c.budgetTotal, 0),
      monSpent: active.reduce((n, c) => n + c.spentTotal, 0),
      monBudget: active.reduce((n, c) => n + (c.monitoringBudget || 0), 0),
      attention: contracts.filter((c) => c.amendmentRequired || c.status === 'en_validation').length,
    };
  }, [contracts]);

  const years = useMemo(() => [...new Set((contracts || []).map((c) => (c.dateDebut || '').slice(0, 4)).filter(Boolean))].sort().reverse(), [contracts]);
  const types = useMemo(() => [...new Set((contracts || []).map((c) => c.partnerTypeLabel).filter(Boolean))].sort(), [contracts]);

  function optionsFor(key) {
    switch (key) {
      case 'status': return STATUSES;
      case 'activity': return [{ id: '', label: 'Toutes' }, ...Object.entries(activityMap).map(([id, label]) => ({ id, label }))];
      case 'type': return [{ id: '', label: 'Tous' }, ...types.map((t) => ({ id: t, label: t }))];
      case 'year': return [{ id: '', label: 'Toutes' }, ...years.map((y) => ({ id: y, label: y }))];
      default: return [];
    }
  }

  // Only the active (shown) filters narrow the list, in a stable order.
  const orderedShown = ALL_KEYS.filter((k) => shownKeys.includes(k));
  const sig = JSON.stringify({ v: values, k: orderedShown, s: sort });
  const filtered = useMemo(() => {
    let list = contracts || [];
    list = list.filter((c) => orderedShown.every((k) => matchOne(k, c, values[k])));
    const STORDER = { en_validation: 0, brouillon: 1, rejete: 2, actif: 3, resilie: 4 };
    const val = (c) => ({
      partner: c.partnerName || '', fla: c.reference || c.numeroFla || '', period: c.dateDebut || '',
      total: c.budgetTotal || 0, suivi: c.monitoringBudget ? c.spentTotal / c.monitoringBudget : -1, status: STORDER[c.status] ?? 9,
    }[sort.key]);
    return [...list].sort((a, b) => {
      const va = val(a); const vb = val(b);
      const cmp = typeof va === 'number' ? va - vb : String(va).localeCompare(String(vb));
      return sort.dir === 'asc' ? cmp : -cmp;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contracts, sig]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageClamped = Math.min(page, totalPages);
  const pageRows = filtered.slice((pageClamped - 1) * PAGE_SIZE, pageClamped * PAGE_SIZE);
  useEffect(() => { setPage(1); }, [sig]);

  function onSort(k) { setSort((s) => (s.key === k ? { key: k, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key: k, dir: 'asc' })); }
  function setVal(k, v) { setValues((s) => ({ ...s, [k]: v })); setCurrentView(''); }
  function toggleShown(k) {
    setShownKeys((ks) => (ks.includes(k) ? ks.filter((x) => x !== k) : [...ks, k]));
    setCurrentView('');
  }
  function resetFilters() { setValues(emptyValues()); setCurrentView(''); }

  const filtersActive = orderedShown.some((k) => values[k] !== FILTERS[k].empty);

  function applyView(v) {
    const keys = (v.keys || []).filter((k) => FILTERS[k]);
    setShownKeys(keys.length ? keys : DEFAULT_KEYS);
    setValues({ ...emptyValues(), ...(v.values || {}) });
    setCurrentView(v.id);
    viewMenu.setOpen(false);
  }
  function saveView() {
    const name = saveName.trim();
    if (!name) return;
    const v = { id: `v${Date.now()}`, name, temp: saveTemp, keys: [...orderedShown], values: { ...values } };
    const next = [...views.filter((x) => !(x.name === name && x.temp === saveTemp)), v];
    setViews(next); writeViews(next); setCurrentView(v.id);
    setSaveName(''); setSaveTemp(false);
    toast.success(`Vue « ${name} » enregistrée${saveTemp ? ' (temporaire)' : ''}.`);
  }
  function deleteView(id) {
    const next = views.filter((v) => v.id !== id);
    setViews(next); writeViews(next);
    if (currentView === id) setCurrentView('');
  }

  function afterAction() { setDialog(null); reload(); if (selectedId) api.getContract(selectedId).then(setSelected).catch(() => {}); }

  function exportCsv() {
    const head = ['N°', 'Partenaire', 'Type', 'N° FLA', 'Activités', 'Début', 'Fin', 'Total accord (Ar)', 'Budget Suivi (Ar)', 'Suivi justifié (Ar)', 'Statut'];
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = filtered.map((c) => [
      c.numero, c.partnerName, c.partnerTypeLabel || '', c.reference || c.numeroFla || '',
      (c.activities || []).map((x) => activityMap[x] || x).join(' / '), c.dateDebut, c.dateFin,
      Math.round(c.budgetTotal), Math.round(c.monitoringBudget || 0), Math.round(c.spentTotal || 0), CONTRACT_STATUS[c.status]?.label || c.status,
    ].map(esc).join(';'));
    const blob = new Blob(['﻿' + [head.map(esc).join(';'), ...lines].join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const el = document.createElement('a'); el.href = url; el.download = 'contrats.csv'; document.body.appendChild(el); el.click(); el.remove(); URL.revokeObjectURL(url);
  }

  const a = selected?.actions;
  const hasSel = Boolean(selectedId);
  const currentViewName = views.find((v) => v.id === currentView)?.name;

  function renderField(k) {
    const f = FILTERS[k];
    if (f.type === 'check') {
      return (
        <div key={k} className="cfilter cfilter-check">
          <label className="filter-check">
            <input type="checkbox" checked={!!values[k]} onChange={(e) => setVal(k, e.target.checked)} />
            <span>{f.label}</span>
          </label>
        </div>
      );
    }
    return (
      <div key={k} className="cfilter">
        <span className="cfilter-label">{f.label}</span>
        {f.type === 'search' ? (
          <span className="input-wrap"><Search size={16} aria-hidden="true" />
            <input className="input" type="search" placeholder={f.ph} value={values[k]} onChange={(e) => setVal(k, e.target.value)} />
          </span>
        ) : (
          <select className="select" value={values[k]} onChange={(e) => setVal(k, e.target.value)}>
            {optionsFor(k).map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
        )}
      </div>
    );
  }

  return (
    <div className="section-gap">
      <div className="page-header">
        <div>
          <h1 className="page-title">Contrats</h1>
          <p className="page-desc">Portefeuille des contrats et FLA des partenaires. Filtrez, cliquez une ligne pour la sélectionner, <strong>double-cliquez</strong> pour ouvrir la fiche.</p>
        </div>
        {canEdit && <Button icon={Plus} onClick={onNew}>Nouveau contrat</Button>}
      </div>

      <Stats items={[
        { label: 'Contrats actifs', value: stats ? stats.active : '—', suffix: stats ? `/ ${stats.total}` : null, foot: 'Sur le portefeuille' },
        { label: 'Budget engagé (actifs)', value: stats ? formatInt(stats.budget) : '—', suffix: 'Ar', foot: 'Somme des totaux d\'accord' },
        { label: 'Suivi/TPM justifié', value: stats ? formatInt(stats.monSpent) : '—', suffix: 'Ar', foot: stats && stats.monBudget ? `sur ${formatInt(stats.monBudget)} Ar` : '' },
        { label: 'À traiter', value: stats ? stats.attention : '—', foot: 'Avenants requis + en validation' },
      ]} />

      <Card>
        {/* Barre de filtres compacte (façon COMET) */}
        <div className="filters-bar comet-filters">
          <span className="filters-label">Filtres&nbsp;:</span>
          {currentViewName && <span className="filters-view-chip"><Save size={12} /> {currentViewName}</span>}
          <div className="comet-fields">
            {orderedShown.map(renderField)}
            {orderedShown.length === 0 && <span className="filters-empty">Aucun filtre actif — ajoutez-en avec l'icône filtres.</span>}
          </div>
          <div className="comet-icons">
            {/* Une seule icône : choisir les filtres actifs (afficher / masquer) */}
            <div className="pop-anchor" ref={filterMenu.ref}>
              <IconButton icon={SlidersHorizontal} label="Filtres à afficher" variant="secondary" size="sm"
                onClick={() => filterMenu.setOpen((o) => !o)} />
              {filterMenu.open && (
                <div className="pop-menu filter-menu" role="menu">
                  <div className="pop-menu-label">Filtres à afficher</div>
                  {ALL_KEYS.map((k) => (
                    <label key={k} className="filter-pick">
                      <input type="checkbox" checked={shownKeys.includes(k)} onChange={() => toggleShown(k)} />
                      <span>{FILTERS[k].label}</span>
                    </label>
                  ))}
                  <div className="manage-foot">
                    <Button size="sm" variant="ghost" icon={RotateCcw} onClick={resetFilters} disabled={!filtersActive}>Réinitialiser les valeurs</Button>
                  </div>
                </div>
              )}
            </div>
            {/* Disquette : vues enregistrées */}
            <div className="pop-anchor" ref={viewMenu.ref}>
              <IconButton icon={Save} label="Filtres enregistrés" variant="secondary" size="sm" onClick={() => viewMenu.setOpen((o) => !o)} />
              {viewMenu.open && (
                <div className="pop-menu view-menu" role="dialog" aria-label="Filtres enregistrés">
                  <div className="pop-menu-label">Enregistrer la vue courante</div>
                  <div className="save-row">
                    <input className="input" type="text" placeholder="Nom de la vue" value={saveName}
                      onChange={(e) => setSaveName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && saveView()} />
                    <Button size="sm" icon={Save} disabled={!saveName.trim()} onClick={saveView}>Enregistrer</Button>
                  </div>
                  <label className="save-temp">
                    <input type="checkbox" checked={saveTemp} onChange={(e) => setSaveTemp(e.target.checked)} />
                    <span>Temporaire (cette session uniquement)</span>
                  </label>
                  <div className="pop-menu-sep" />
                  <div className="pop-menu-label">Vues enregistrées</div>
                  {views.length === 0 && <div className="pop-menu-empty">Aucune vue enregistrée pour le moment.</div>}
                  {views.map((v) => (
                    <div key={v.id} className={`view-row ${currentView === v.id ? 'is-active' : ''}`}>
                      <button type="button" className="view-row-main" onClick={() => applyView(v)}>
                        {currentView === v.id ? <Check size={14} /> : <span className="view-dot" />}
                        <span className="view-name">{v.name}</span>
                        {v.temp && <span className="view-tag">temporaire</span>}
                      </button>
                      <button type="button" className="view-row-del" title="Supprimer la vue" onClick={() => deleteView(v.id)}><Trash2 size={14} /></button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Barre d'actions */}
        <div className="data-toolbar">
          <div className="data-toolbar-left">
            <Button size="sm" variant="secondary" icon={ExternalLink} disabled={!hasSel} onClick={() => onOpen(selectedId)}>Ouvrir</Button>
            {a?.edit && <Button size="sm" variant="secondary" icon={Pencil} onClick={() => onEdit(selectedId)}>Éditer</Button>}
            {a?.submit && <Button size="sm" variant="secondary" icon={Send} onClick={() => setDialog({ type: 'submit' })}>Soumettre</Button>}
            {a?.decide && <>
              <Button size="sm" variant="secondary" icon={ShieldCheck} onClick={() => setDialog({ type: 'decide', approve: true })}>Valider</Button>
              <Button size="sm" variant="secondary" icon={X} onClick={() => setDialog({ type: 'decide', approve: false })}>Rejeter</Button>
            </>}
            {a?.amend && <Button size="sm" variant="secondary" icon={FilePlus2} onClick={() => onAmend(selectedId)}>Amender</Button>}
            {a?.renew && <Button size="sm" variant="secondary" icon={RefreshCw} onClick={() => setDialog({ type: 'renew' })}>Renouveler</Button>}
            {a?.terminate && <Button size="sm" variant="secondary" icon={Ban} onClick={() => setDialog({ type: 'terminate' })}>Résilier</Button>}
            {hasSel && <Button size="sm" variant="ghost" icon={X} onClick={() => setSelectedId(null)}>Désélectionner</Button>}
          </div>
          <div className="data-toolbar-right">
            <Button size="sm" variant="secondary" icon={Download} onClick={exportCsv} disabled={!(contracts && contracts.length)}>Exporter (CSV)</Button>
          </div>
        </div>

        {error && <div style={{ padding: '12px 20px 0' }}><Alert tone="error" icon={AlertCircle}>{error}</Alert></div>}

        <div className="table-wrap">
          <table className="table grid">
            <thead>
              <tr>
                <th scope="col" style={{ width: 36 }}><span className="sr-only">Sélection</span></th>
                <SortTh label="Partenaire" k="partner" sort={sort} onSort={onSort} />
                <SortTh label="N° FLA" k="fla" sort={sort} onSort={onSort} />
                <th scope="col">Activités</th>
                <SortTh label="Période" k="period" sort={sort} onSort={onSort} />
                <SortTh label="Total accord" k="total" sort={sort} onSort={onSort} className="num" />
                <SortTh label="Suivi/TPM" k="suivi" sort={sort} onSort={onSort} className="num" />
                <SortTh label="Statut" k="status" sort={sort} onSort={onSort} />
              </tr>
            </thead>
            <tbody>
              {contracts === null
                ? [0, 1, 2].map((i) => <tr key={i} aria-hidden="true">{[20, 200, 150, 120, 120, 120, 120, 90].map((w, j) => <td key={j}><Skeleton width={w} height={18} /></td>)}</tr>)
                : pageRows.map((c) => {
                    const st = CONTRACT_STATUS[c.status];
                    const flags = contractFlags(c);
                    const isSel = selectedId === c.id;
                    const monRate = c.monitoringBudget ? c.spentTotal / c.monitoringBudget : 0;
                    return (
                      <tr key={c.id} className={`clickable ${isSel ? 'is-selected' : ''}`}
                        onClick={() => setSelectedId(c.id)}
                        onDoubleClick={() => onOpen(c.id)}
                        title="Double-cliquez pour ouvrir la fiche">
                        <td onClick={(e) => e.stopPropagation()}>
                          <input type="radio" name="contract-select" checked={isSel} onChange={() => setSelectedId(isSel ? null : c.id)} aria-label={`Sélectionner ${c.partnerName}`} />
                        </td>
                        <td>
                          <button type="button" className="link-cell" onClick={(e) => { e.stopPropagation(); onOpen(c.id); }}>{c.partnerName}</button>
                          <div className="site-meta"><span className="mono">{c.numero}</span> · {c.partnerTypeLabel || ''}</div>
                        </td>
                        <td><span className="mono">{c.reference || c.numeroFla || '—'}</span></td>
                        <td>
                          <div className="tag-row">
                            {(c.activities || []).slice(0, 3).map((code) => <span key={code} className="tag">{activityMap[code] || code}</span>)}
                            {(c.activities || []).length > 3 && <span className="tag">+{c.activities.length - 3}</span>}
                            {(c.activities || []).length === 0 && <span className="cell-empty">—</span>}
                          </div>
                        </td>
                        <td className="nowrap">{periodLabel(c.dateDebut, c.dateFin)}</td>
                        <td className="num nowrap">{formatAr(c.budgetTotal)}</td>
                        <td className="num">{c.monitoringBudget ? <Usage rate={monRate} /> : <span className="cell-empty">—</span>}</td>
                        <td>
                          <div className="tag-row">
                            <StatusBadge def={st} />
                            {flags.map((f) => <Badge key={f.key} tone={f.tone}>{f.label}</Badge>)}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
            </tbody>
          </table>
          {contracts && filtered.length === 0 && (
            <EmptyState icon={FileSignature} title={contracts.length ? 'Aucun contrat ne correspond' : 'Aucun contrat'}
              action={canEdit && (contracts.length === 0 ? <Button icon={Plus} onClick={onNew}>Nouveau contrat</Button> : <Button variant="secondary" icon={RotateCcw} onClick={resetFilters}>Réinitialiser les filtres</Button>)}>
              {contracts.length ? 'Ajustez les filtres ou la recherche.' : 'Créez un premier contrat pour démarrer le portefeuille.'}
            </EmptyState>
          )}
        </div>

        {/* Pagination */}
        {contracts && filtered.length > 0 && (
          <div className="list-foot">
            <span className="list-count">
              {(pageClamped - 1) * PAGE_SIZE + 1}–{Math.min(pageClamped * PAGE_SIZE, filtered.length)} sur {filtered.length} contrat{filtered.length > 1 ? 's' : ''}
            </span>
            <div className="pager">
              <button type="button" className="pager-btn" disabled={pageClamped <= 1} onClick={() => setPage(pageClamped - 1)} aria-label="Page précédente"><ChevronLeft size={16} /></button>
              <span className="pager-info">Page {pageClamped} / {totalPages}</span>
              <button type="button" className="pager-btn" disabled={pageClamped >= totalPages} onClick={() => setPage(pageClamped + 1)} aria-label="Page suivante"><ChevronRight size={16} /></button>
            </div>
          </div>
        )}
      </Card>

      <div className="note">
        <Info size={18} aria-hidden="true" />
        <span>L'icône <strong>filtres</strong> choisit les filtres actifs (seuls les filtres cochés s'affichent) ; la <strong>disquette</strong> enregistre vos vues (permanentes ou temporaires). Double-cliquez une ligne pour ouvrir la fiche.</span>
      </div>

      {selected && dialog?.type === 'submit' && <SubmitDialog open onClose={() => setDialog(null)} detail={selected} onDone={afterAction} />}
      {selected && dialog?.type === 'decide' && <DecisionDialog open onClose={() => setDialog(null)} detail={selected} approve={dialog.approve} onDone={afterAction} />}
      {selected && dialog?.type === 'renew' && <RenewDialog open onClose={() => setDialog(null)} detail={selected} onDone={(id) => { setDialog(null); onOpen(id); }} />}
      {selected && dialog?.type === 'terminate' && <TerminateDialog open onClose={() => setDialog(null)} detail={selected} onDone={afterAction} />}
    </div>
  );
}
