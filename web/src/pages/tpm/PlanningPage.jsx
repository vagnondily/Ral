import React, { useEffect, useMemo, useState } from 'react';
import {
  Plus, Wallet, Info, Search, SlidersHorizontal, Columns3, Save, Clock, RotateCcw,
  Download, Printer, Trash2, ChevronLeft, ChevronRight, ExternalLink,
} from 'lucide-react';
import { api } from '../../api/client.js';
import { Alert, Badge, Button, Card, EmptyState, IconButton, Skeleton, Stats } from '../../components/ui.jsx';
import MonthPicker from '../../components/MonthPicker.jsx';
import PlanBudgetDrawer from './PlanBudgetDrawer.jsx';
import { usePopover, SortTh, makeViewStore } from '../../components/listView.jsx';
import { useToast } from '../../components/Toast.jsx';
import { currentMonth, formatAr, formatInt } from '../../lib/format.js';
import { formatUsdFor } from '../../lib/currency.js';

const PLAN_STATUS = { brouillon: { label: 'Brouillon', tone: 'yellow' }, valide: { label: 'Validé', tone: 'green' } };
const STATUSES = [{ id: '', label: 'Tous les statuts' }, { id: 'brouillon', label: 'Brouillon' }, { id: 'valide', label: 'Validé' }];
const PAGE_SIZE = 12;
const viewStore = makeViewStore('mems.planning.view');

const FILTERS = {
  q:        { label: 'Recherche', type: 'search', ph: 'Prestataire, contrat, intitulé…' },
  partnerId: { label: 'Prestataire', type: 'select' },
  contractId: { label: 'Contrat', type: 'select' },
  status:   { label: 'Statut', type: 'select' },
};
const ALL_FILTERS = ['q', 'partnerId', 'contractId', 'status'];
const DEFAULT_FILTERS = ['q', 'partnerId', 'status'];

const COLUMNS = {
  partner:  { label: 'Prestataire TPM', sort: 'partner' },
  contract: { label: 'Contrat', sort: 'contract' },
  title:    { label: 'Intitulé' },
  funder:   { label: 'Planifié (bailleur)', num: true, sort: 'funder' },
  total:    { label: 'Total prévu', num: true, sort: 'total' },
  status:   { label: 'Statut', sort: 'status' },
};
const ALL_COLUMNS = Object.keys(COLUMNS);
const DEFAULT_COLUMNS = ['partner', 'contract', 'title', 'funder', 'total', 'status'];

/**
 * Planification & budget — budgets prévisionnels des vagues de collecte, façon
 * COMET (filtres, colonnes, tri, pagination, vue Ar/USD). La part bailleur
 * alimente le « Planifié » de la consolidation et pré-remplit la facture.
 */
export default function PlanningPage({ canEdit }) {
  const toast = useToast();
  const [month, setMonth] = useState(currentMonth);
  const [context, setContext] = useState(null);
  const [plans, setPlans] = useState(null);
  const [rates, setRates] = useState([]);
  const [error, setError] = useState(null);
  const [drawer, setDrawer] = useState(null);

  const saved = viewStore.initial();
  const [values, setValues] = useState(() => (saved?.values || { q: '', partnerId: '', contractId: '', status: '' }));
  const [shownFilters, setShownFilters] = useState(() => saved?.shownFilters || DEFAULT_FILTERS);
  const [columns, setColumns] = useState(() => saved?.columns || DEFAULT_COLUMNS);
  const [sort, setSort] = useState(() => saved?.sort || { key: 'partner', dir: 'asc' });
  const [currency, setCurrency] = useState('Ar');
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState(null);

  const filterMenu = usePopover();
  const colMenu = usePopover();

  async function reload() {
    setError(null);
    try {
      const [ctx, list] = await Promise.all([api.reportsContext(), api.listPlans({ month })]);
      setContext(ctx); setPlans(list);
    } catch (err) { setError(err.message); setPlans((p) => p || []); }
  }
  useEffect(() => { reload(); /* eslint-disable-next-line */ }, [month]);
  useEffect(() => { api.listExchangeRates().then(setRates).catch(() => setRates([])); }, []);

  const stats = useMemo(() => {
    const list = plans || [];
    return {
      count: list.length,
      planned: list.reduce((n, p) => n + (p.plannedFunder || 0), 0),
      total: list.reduce((n, p) => n + (p.plannedTotal || 0), 0),
      valides: list.filter((p) => p.status === 'valide').length,
    };
  }, [plans]);

  const shown = ALL_FILTERS.filter((k) => shownFilters.includes(k));
  const cols = ALL_COLUMNS.filter((k) => columns.includes(k));
  const monthStart = `${month}-01`;

  const filtered = useMemo(() => {
    let list = plans || [];
    list = list.filter((p) => shown.every((k) => {
      const v = values[k];
      if (!v) return true;
      switch (k) {
        case 'q': { const q = v.toLowerCase(); return [p.partnerName, p.contractPartner, p.contractNumero, p.title].some((x) => x && String(x).toLowerCase().includes(q)); }
        case 'partnerId': return p.partnerId === v;
        case 'contractId': return p.contractId === v;
        case 'status': return p.status === v;
        default: return true;
      }
    }));
    const val = (p) => ({
      partner: p.partnerName || '', contract: p.contractPartner || '',
      funder: p.plannedFunder || 0, total: p.plannedTotal || 0,
      status: ['brouillon', 'valide'].indexOf(p.status),
    }[sort.key]);
    return [...list].sort((a, b) => {
      const va = val(a); const vb = val(b);
      const cmp = typeof va === 'number' ? va - vb : String(va).localeCompare(String(vb));
      return sort.dir === 'asc' ? cmp : -cmp;
    });
  }, [plans, values, shown, sort]);

  const sig = JSON.stringify({ values, shownFilters, sort, month });
  useEffect(() => { setPage(1); /* eslint-disable-next-line */ }, [sig]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageClamped = Math.min(page, totalPages);
  const pageRows = filtered.slice((pageClamped - 1) * PAGE_SIZE, pageClamped * PAGE_SIZE);
  const selected = (plans || []).find((p) => p.id === selectedId) || null;

  function onSort(k) { if (!k) return; setSort((s) => (s.key === k ? { key: k, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key: k, dir: 'asc' })); }
  function setVal(k, v) { setValues((s) => ({ ...s, [k]: v })); }
  function toggleFilter(k) { setShownFilters((ks) => (ks.includes(k) ? ks.filter((x) => x !== k) : [...ks, k])); }
  function toggleColumn(k) { setColumns((ks) => (ks.includes(k) ? ks.filter((x) => x !== k) : [...ks, k])); }
  function currentPayload() { return { values, shownFilters, columns, sort }; }
  function resetView() { setValues({ q: '', partnerId: '', contractId: '', status: '' }); viewStore.clear(); toast.info('Filtres réinitialisés.'); }

  function optionsFor(k) {
    switch (k) {
      case 'partnerId': return [{ id: '', label: 'Tous les prestataires' }, ...(context?.partners || []).map((p) => ({ id: p.id, label: p.name }))];
      case 'contractId': return [{ id: '', label: 'Tous les contrats' }, ...(context?.contracts || []).map((c) => ({ id: c.id, label: `${c.partnerName} · ${c.numero}` }))];
      case 'status': return STATUSES;
      default: return [];
    }
  }

  const money = (ar) => (currency === 'USD' ? formatUsdFor(ar, rates, monthStart) : formatAr(ar));
  const hasRates = rates.length > 0;

  async function remove(p) {
    if (!window.confirm(`Supprimer le plan de « ${p.partnerName} » ? Cette action est définitive.`)) return;
    try { await api.deletePlan(p.id); toast.success('Plan supprimé.'); setSelectedId(null); reload(); }
    catch (e) { toast.error(e.message); }
  }

  function exportCsv() {
    const head = cols.map((k) => COLUMNS[k].label);
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const cell = (p, k) => ({
      partner: p.partnerName, contract: `${p.contractPartner} (${p.contractNumero})`, title: p.title || '',
      funder: currency === 'USD' ? money(p.plannedFunder) : Math.round(p.plannedFunder || 0),
      total: currency === 'USD' ? money(p.plannedTotal) : Math.round(p.plannedTotal || 0),
      status: PLAN_STATUS[p.status]?.label || p.status,
    }[k]);
    const lines = filtered.map((p) => cols.map((k) => cell(p, k)).map(esc).join(';'));
    const blob = new Blob(['﻿' + [head.map(esc).join(';'), ...lines].join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const el = document.createElement('a'); el.href = url; el.download = `plans_${month}.csv`; document.body.appendChild(el); el.click(); el.remove(); URL.revokeObjectURL(url);
  }

  function renderCell(p, k) {
    switch (k) {
      case 'partner': return <strong>{p.partnerName}</strong>;
      case 'contract': return <>{p.contractPartner}<div className="site-meta mono">{p.contractNumero}</div></>;
      case 'title': return p.title || <span className="cell-empty">—</span>;
      case 'funder': return money(p.plannedFunder);
      case 'total': return money(p.plannedTotal);
      case 'status': return <Badge tone={PLAN_STATUS[p.status]?.tone} dot>{PLAN_STATUS[p.status]?.label || p.status}</Badge>;
      default: return null;
    }
  }

  function renderFilter(k) {
    const f = FILTERS[k];
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
          <h1 className="page-title">Planification &amp; budget</h1>
          <p className="page-desc">Budget prévisionnel des vagues de collecte : postes prévus par prestataire et contrat. La part bailleur alimente le « Planifié » de la consolidation et sert de base à la facture.</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <MonthPicker value={month} onChange={setMonth} />
          {canEdit && <Button icon={Plus} onClick={() => setDrawer({})}>Nouveau plan</Button>}
        </div>
      </div>

      <Stats items={[
        { label: 'Plans du mois', value: plans ? stats.count : '—', foot: `${stats.valides} validé(s)` },
        { label: 'Planifié (part bailleur)', value: plans ? (currency === 'USD' ? formatUsdFor(stats.planned, rates, monthStart) : formatInt(stats.planned)) : '—', suffix: currency === 'USD' ? '' : 'Ar', foot: 'Alimente la consolidation' },
        { label: 'Budget total prévu', value: plans ? (currency === 'USD' ? formatUsdFor(stats.total, rates, monthStart) : formatInt(stats.total)) : '—', suffix: currency === 'USD' ? '' : 'Ar', foot: 'Bailleur + ONG' },
        { label: 'Contrats couverts', value: context ? context.contracts.length : '—', foot: 'Avec budget Suivi/TPM' },
      ]} />

      <Card>
        <div className="filters-bar comet-filters">
          <span className="filters-label">Filtres&nbsp;:</span>
          <div className="comet-fields">
            {shown.map(renderFilter)}
            {shown.length === 0 && <span className="filters-empty">Aucun filtre actif — ajoutez-en avec l'icône filtres.</span>}
          </div>
          <div className="comet-icons">
            <div className="seg" role="group" aria-label="Devise d'affichage">
              <button type="button" className={currency === 'Ar' ? 'is-active' : ''} onClick={() => setCurrency('Ar')}>Ar</button>
              <button type="button" className={currency === 'USD' ? 'is-active' : ''} onClick={() => setCurrency('USD')} title={hasRates ? 'Valeurs en dollars selon la période' : 'Aucun taux de change — à saisir dans Paramétrage'}>USD</button>
            </div>
            <div className="pop-anchor" ref={filterMenu.ref}>
              <IconButton icon={SlidersHorizontal} label="Filtres à afficher" variant="secondary" size="sm" onClick={() => filterMenu.setOpen((o) => !o)} />
              {filterMenu.open && (
                <div className="pop-menu filter-menu" role="menu">
                  <div className="pop-menu-label">Filtres à afficher</div>
                  {ALL_FILTERS.map((k) => (
                    <label key={k} className="filter-pick"><input type="checkbox" checked={shownFilters.includes(k)} onChange={() => toggleFilter(k)} /><span>{FILTERS[k].label}</span></label>
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
                    <label key={k} className="filter-pick"><input type="checkbox" checked={columns.includes(k)} onChange={() => toggleColumn(k)} /><span>{COLUMNS[k].label}</span></label>
                  ))}
                </div>
              )}
            </div>
            <IconButton icon={Clock} label="Mémoriser le filtre (temporaire)" variant="secondary" size="sm" onClick={() => { viewStore.saveTemp(currentPayload()); toast.success('Filtre mémorisé pour cette session.'); }} />
            <IconButton icon={Save} label="Mémoriser le filtre (permanent)" variant="secondary" size="sm" onClick={() => { viewStore.savePerm(currentPayload()); toast.success('Filtre enregistré comme vue par défaut.'); }} />
            <IconButton icon={RotateCcw} label="Réinitialiser" variant="secondary" size="sm" onClick={resetView} />
          </div>
        </div>

        <div className="data-toolbar">
          <div className="data-toolbar-left">
            {selected && <Button size="sm" variant="secondary" icon={ExternalLink} onClick={() => setDrawer({ planId: selected.id })}>Ouvrir / éditer</Button>}
            {canEdit && selected && <Button size="sm" variant="ghost" icon={Trash2} onClick={() => remove(selected)}>Supprimer</Button>}
            {selected && <Button size="sm" variant="ghost" icon={ExternalLink} onClick={() => setSelectedId(null)} style={{ display: 'none' }} />}
          </div>
          <div className="data-toolbar-right">
            <Button size="sm" variant="secondary" icon={Printer} onClick={() => window.print()} disabled={!(plans && plans.length)}>Imprimer</Button>
            <Button size="sm" variant="secondary" icon={Download} onClick={exportCsv} disabled={!(plans && plans.length)}>Exporter (CSV)</Button>
          </div>
        </div>

        {error && <div style={{ padding: '12px 20px 0' }}><Alert tone="error">{error}</Alert></div>}
        {currency === 'USD' && !hasRates && <div style={{ padding: '12px 20px 0' }}><Alert tone="warn">Aucun taux de change saisi — renseignez-les dans Paramétrage › Taux de change pour afficher les valeurs en dollars.</Alert></div>}

        <div className="table-wrap">
          <table className="table grid">
            <thead><tr>
              <th scope="col" style={{ width: 36 }}><span className="sr-only">Sélection</span></th>
              {cols.map((k) => (COLUMNS[k].sort
                ? <SortTh key={k} label={COLUMNS[k].label} k={COLUMNS[k].sort} sort={sort} onSort={onSort} className={COLUMNS[k].num ? 'num' : ''} />
                : <th key={k} scope="col" className={COLUMNS[k].num ? 'num' : ''}>{COLUMNS[k].label}</th>))}
            </tr></thead>
            <tbody>
              {plans === null
                ? [0, 1, 2].map((i) => <tr key={i} aria-hidden="true"><td /><td colSpan={cols.length}><Skeleton height={18} /></td></tr>)
                : pageRows.map((p) => {
                    const isSel = selectedId === p.id;
                    return (
                      <tr key={p.id} className={`clickable ${isSel ? 'is-selected' : ''}`} onClick={() => setSelectedId(p.id)} onDoubleClick={() => setDrawer({ planId: p.id })}>
                        <td onClick={(e) => e.stopPropagation()}>
                          <input type="radio" name="plan-select" checked={isSel} onChange={() => setSelectedId(isSel ? null : p.id)} aria-label={`Sélectionner ${p.partnerName}`} />
                        </td>
                        {cols.map((k) => <td key={k} className={COLUMNS[k].num ? 'num tabular' : ''}>{renderCell(p, k)}</td>)}
                      </tr>
                    );
                  })}
            </tbody>
          </table>
          {plans && filtered.length === 0 && (
            <EmptyState icon={Wallet} title={plans.length ? 'Aucun plan ne correspond' : 'Aucun plan ce mois-ci'}
              action={canEdit && (plans.length === 0
                ? <Button icon={Plus} onClick={() => setDrawer({})}>Nouveau plan</Button>
                : <Button variant="secondary" icon={RotateCcw} onClick={resetView}>Réinitialiser les filtres</Button>)}>
              {plans.length ? 'Ajustez les filtres.' : "Créez le budget prévisionnel d'une vague de collecte pour pré-remplir la facture ensuite."}
            </EmptyState>
          )}
        </div>

        {plans && filtered.length > 0 && (
          <div className="list-foot">
            <span className="list-count">{(pageClamped - 1) * PAGE_SIZE + 1}–{Math.min(pageClamped * PAGE_SIZE, filtered.length)} sur {filtered.length} plan{filtered.length > 1 ? 's' : ''}</span>
            <div className="pager">
              <button type="button" className="pager-btn" disabled={pageClamped <= 1} onClick={() => setPage(pageClamped - 1)} aria-label="Page précédente"><ChevronLeft size={16} /></button>
              <span className="pager-info">Page {pageClamped} / {totalPages}</span>
              <button type="button" className="pager-btn" disabled={pageClamped >= totalPages} onClick={() => setPage(pageClamped + 1)} aria-label="Page suivante"><ChevronRight size={16} /></button>
            </div>
          </div>
        )}
      </Card>

      <div className="note"><Info size={18} aria-hidden="true" /><span>La <strong>part bailleur</strong> des postes prévus est le « Planifié » comparé au budget de suivi. Depuis une facture, « Pré-remplir depuis le plan » reprend ces postes. Bascule <strong>Ar/USD</strong> selon les taux de Paramétrage.</span></div>

      {drawer && <PlanBudgetDrawer planId={drawer.planId} context={context} month={month} onClose={() => setDrawer(null)} onSaved={() => { setDrawer(null); reload(); }} />}
    </div>
  );
}
