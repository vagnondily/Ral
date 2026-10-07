import React, { useEffect, useMemo, useState } from 'react';
import {
  Plus, FileText, ShieldCheck, X, Info, Search, SlidersHorizontal, Columns3,
  Save, Clock, RotateCcw, Download, Printer, Trash2, ChevronLeft, ChevronRight, ExternalLink, CalendarClock, Ban,
  Wallet, TrendingUp, ChevronRight as FlowArrow,
} from 'lucide-react';
import { api } from '../../api/client.js';
import { Alert, Badge, Button, Card, EmptyState, Field, IconButton, Skeleton, Stats } from '../../components/ui.jsx';
import Modal from '../../components/Modal.jsx';
import MonthPicker from '../../components/MonthPicker.jsx';
import FactureDrawer from './FactureDrawer.jsx';
import { usePopover, SortTh, makeViewStore } from '../../components/listView.jsx';
import { useToast } from '../../components/Toast.jsx';
import { currentMonth, formatAr, formatInt, monthLabel } from '../../lib/format.js';
import { formatUsdFor } from '../../lib/currency.js';
import { REPORT_KIND, REPORT_STATUS } from '../../lib/contracts.js';

const STATUSES = [
  { id: '', label: 'Tous les statuts' },
  { id: 'attendu', label: 'Attendu' }, { id: 'soumis', label: 'Soumis' },
  { id: 'valide', label: 'Validé' }, { id: 'rejete', label: 'Rejeté' },
  { id: 'non_applicable', label: 'Non applicable' },
];
const KINDS = [{ id: '', label: 'Tous les types' }, { id: 'financier', label: 'Financier' }, { id: 'technique', label: 'Technique' }];
const PAGE_SIZE = 12;
const viewStore = makeViewStore('mems.reports.view');

// Filtres disponibles (seuls les filtres cochés s'affichent et s'appliquent).
const FILTERS = {
  q:        { label: 'Recherche', type: 'search', ph: 'Prestataire, contrat, facture, réf…' },
  partnerId: { label: 'Prestataire', type: 'select' },
  contractId: { label: 'Contrat', type: 'select' },
  kind:     { label: 'Type', type: 'select' },
  status:   { label: 'Statut', type: 'select' },
};
const ALL_FILTERS = ['q', 'partnerId', 'contractId', 'kind', 'status'];
const DEFAULT_FILTERS = ['q', 'partnerId', 'kind', 'status'];

// Colonnes disponibles (choisies via le sélecteur de colonnes).
const COLUMNS = {
  partner:   { label: 'Prestataire TPM', sort: 'partner' },
  contract:  { label: 'Contrat', sort: 'contract' },
  kind:      { label: 'Type', sort: 'kind' },
  planned:   { label: 'Prévu', num: true, sort: 'planned' },
  reported:  { label: 'Réalisé (bailleur)', num: true, sort: 'reported' },
  document:  { label: 'Document' },
  reference: { label: 'Référence' },
  invoiceNo: { label: 'N° facture' },
  status:    { label: 'Statut', sort: 'status' },
  createdBy: { label: 'Créé par' },
  decidedBy: { label: 'Décidé par' },
  decidedAt: { label: 'Date décision' },
};
const ALL_COLUMNS = Object.keys(COLUMNS);
const DEFAULT_COLUMNS = ['partner', 'contract', 'kind', 'planned', 'reported', 'document', 'status'];

export default function ReportsPage({ canEdit, onOpenContract, onNavigate }) {
  const toast = useToast();
  const [month, setMonth] = useState(currentMonth);
  const [context, setContext] = useState(null);
  const [reports, setReports] = useState(null);
  const [plans, setPlans] = useState([]);
  const [rates, setRates] = useState([]);
  const [error, setError] = useState(null);

  const [facture, setFacture] = useState(null); // {reportId?} | {kind} | null
  const [decide, setDecide] = useState(null);    // {report, approve}
  const [genOpen, setGenOpen] = useState(false); // modale génération mensuelle

  const saved = viewStore.initial();
  const [values, setValues] = useState(() => (saved?.values || { q: '', partnerId: '', contractId: '', kind: '', status: '' }));
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
      const [ctx, list, pl] = await Promise.all([api.reportsContext(), api.listReports({ month }), api.listPlans({ month }).catch(() => [])]);
      setContext(ctx); setReports(list); setPlans(pl || []);
    } catch (err) { setError(err.message); setReports((r) => r || []); }
  }
  useEffect(() => { reload(); /* eslint-disable-next-line */ }, [month]);
  useEffect(() => { api.listExchangeRates().then(setRates).catch(() => setRates([])); }, []);

  // Fil guidé : arrivée depuis « Créer la facture » d'un plan (Planification &
  // budget). On ouvre l'éditeur de facture pré-rempli, sur le bon mois.
  useEffect(() => {
    let intent = null;
    try { const raw = sessionStorage.getItem('mems.tpm.newFacture'); if (raw) { intent = JSON.parse(raw); sessionStorage.removeItem('mems.tpm.newFacture'); } } catch { /* ignore */ }
    if (!intent) return;
    if (intent.month) setMonth(intent.month);
    setFacture({ kind: 'financier', initial: { partnerId: intent.partnerId, contractId: intent.contractId }, autoPrefill: true });
  }, []);

  const stats = useMemo(() => {
    const list = reports || [];
    const fin = list.filter((r) => r.kind === 'financier');
    return {
      total: list.length, tech: list.filter((r) => r.kind === 'technique').length,
      justified: fin.filter((r) => r.status === 'valide').reduce((n, r) => n + (r.reportedAmount || 0), 0),
      pending: list.filter((r) => r.status === 'soumis').length,
    };
  }, [reports]);

  // Fil guidé plan → facture → validation → consolidation (état du mois).
  const flow = useMemo(() => {
    const fin = (reports || []).filter((r) => r.kind === 'financier');
    return {
      plansValides: plans.filter((p) => p.status === 'valide').length,
      plansTotal: plans.length,
      facturesCreees: fin.length,
      facturesSoumises: fin.filter((r) => r.status === 'soumis').length,
      facturesValidees: fin.filter((r) => r.status === 'valide').length,
    };
  }, [reports, plans]);

  const shown = ALL_FILTERS.filter((k) => shownFilters.includes(k));
  const cols = ALL_COLUMNS.filter((k) => columns.includes(k));

  const filtered = useMemo(() => {
    let list = reports || [];
    list = list.filter((r) => shown.every((k) => {
      const v = values[k];
      if (!v) return true;
      switch (k) {
        case 'q': { const q = v.toLowerCase(); return [r.partnerName, r.contractPartner, r.contractNumero, r.reference, r.invoiceNo].some((x) => x && String(x).toLowerCase().includes(q)); }
        case 'partnerId': return r.partnerId === v;
        case 'contractId': return r.contractId === v;
        case 'kind': return r.kind === v;
        case 'status': return r.status === v;
        default: return true;
      }
    }));
    const val = (r) => ({
      partner: r.partnerName || '', contract: r.contractPartner || '', kind: r.kind,
      planned: r.plannedAmount || 0, reported: r.reportedAmount || 0,
      status: ['attendu', 'soumis', 'valide', 'rejete'].indexOf(r.status),
    }[sort.key]);
    return [...list].sort((a, a2) => {
      const va = val(a); const vb = val(a2);
      const cmp = typeof va === 'number' ? va - vb : String(va).localeCompare(String(vb));
      return sort.dir === 'asc' ? cmp : -cmp;
    });
  }, [reports, values, shown, sort]);

  const sig = JSON.stringify({ values, shownFilters, sort, month });
  useEffect(() => { setPage(1); /* eslint-disable-next-line */ }, [sig]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageClamped = Math.min(page, totalPages);
  const pageRows = filtered.slice((pageClamped - 1) * PAGE_SIZE, pageClamped * PAGE_SIZE);
  const selected = (reports || []).find((r) => r.id === selectedId) || null;

  function onSort(k) { if (!k) return; setSort((s) => (s.key === k ? { key: k, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key: k, dir: 'asc' })); }
  function setVal(k, v) { setValues((s) => ({ ...s, [k]: v })); }
  function toggleFilter(k) { setShownFilters((ks) => (ks.includes(k) ? ks.filter((x) => x !== k) : [...ks, k])); }
  function toggleColumn(k) { setColumns((ks) => (ks.includes(k) ? ks.filter((x) => x !== k) : [...ks, k])); }
  function currentPayload() { return { values, shownFilters, columns, sort }; }
  function resetView() { setValues({ q: '', partnerId: '', contractId: '', kind: '', status: '' }); viewStore.clear(); toast.info('Filtres réinitialisés.'); }

  function optionsFor(k) {
    switch (k) {
      case 'partnerId': return [{ id: '', label: 'Tous les prestataires' }, ...(context?.partners || []).map((p) => ({ id: p.id, label: p.name }))];
      case 'contractId': return [{ id: '', label: 'Tous les contrats' }, ...(context?.contracts || []).map((c) => ({ id: c.id, label: `${c.partnerName} · ${c.numero}` }))];
      case 'kind': return KINDS;
      case 'status': return STATUSES;
      default: return [];
    }
  }

  const money = (ar, period) => (currency === 'USD' ? formatUsdFor(ar, rates, period) : formatAr(ar));
  const hasRates = rates.length > 0;

  async function runDecision(report, approve, comment) {
    try {
      if (approve) await api.approveReport(report.id, { comment }); else await api.rejectReport(report.id, { comment });
      toast.success(approve ? 'Rapport validé.' : 'Rapport rejeté.'); setDecide(null); reload();
    } catch (err) { toast.error(err.message); }
  }
  async function removeReport(r) {
    if (!window.confirm(`Supprimer le rapport ${REPORT_KIND[r.kind].label.toLowerCase()} de « ${r.partnerName} » ? Cette action est définitive.`)) return;
    try { await api.deleteReport(r.id); toast.success('Rapport supprimé.'); setSelectedId(null); reload(); }
    catch (err) { toast.error(err.message); }
  }
  async function markNotApplicable(r) {
    if (!window.confirm(`Marquer « non applicable » le rapport de « ${r.partnerName} » pour ce mois (aucun suivi réalisé) ?`)) return;
    try { await api.reportNotApplicable(r.id); toast.success('Rapport marqué non applicable.'); reload(); }
    catch (err) { toast.error(err.message); }
  }

  function exportCsv() {
    const head = cols.map((k) => COLUMNS[k].label);
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const cell = (r, k) => {
      switch (k) {
        case 'partner': return r.partnerName;
        case 'contract': return `${r.contractPartner} (${r.contractNumero})`;
        case 'kind': return REPORT_KIND[r.kind].label;
        case 'planned': return currency === 'USD' ? money(r.plannedAmount, r.periodMonth) : Math.round(r.plannedAmount || 0);
        case 'reported': return r.kind === 'financier' ? (currency === 'USD' ? money(r.reportedAmount, r.periodMonth) : Math.round(r.reportedAmount || 0)) : '';
        case 'document': return r.documentName || '';
        case 'reference': return r.reference || '';
        case 'invoiceNo': return r.invoiceNo || '';
        case 'status': return REPORT_STATUS[r.status]?.label || r.status;
        case 'createdBy': return r.createdByEmail || '';
        case 'decidedBy': return r.decidedByEmail || '';
        case 'decidedAt': return r.decidedAt ? String(r.decidedAt).slice(0, 10) : '';
        default: return '';
      }
    };
    const lines = filtered.map((r) => cols.map((k) => cell(r, k)).map(esc).join(';'));
    const blob = new Blob(['﻿' + [head.map(esc).join(';'), ...lines].join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const el = document.createElement('a'); el.href = url; el.download = `rapports_${month}.csv`; document.body.appendChild(el); el.click(); el.remove(); URL.revokeObjectURL(url);
  }

  function renderCell(r, k) {
    switch (k) {
      case 'partner': return <strong>{r.partnerName}</strong>;
      case 'contract': return <><button type="button" className="link-cell" onClick={(e) => { e.stopPropagation(); onOpenContract(r.contractId); }}>{r.contractPartner}</button><div className="site-meta mono">{r.contractNumero}</div></>;
      case 'kind': return <Badge tone={REPORT_KIND[r.kind].tone}>{REPORT_KIND[r.kind].label}</Badge>;
      case 'planned': return r.plannedAmount != null ? money(r.plannedAmount, r.periodMonth) : <span className="cell-empty">—</span>;
      case 'reported': return r.kind === 'financier' ? money(r.reportedAmount || 0, r.periodMonth) : <span className="cell-empty">—</span>;
      case 'document': return r.documentName || <span className="cell-empty">—</span>;
      case 'reference': return r.reference ? <span className="mono">{r.reference}</span> : <span className="cell-empty">—</span>;
      case 'invoiceNo': return r.invoiceNo ? <span className="mono">{r.invoiceNo}</span> : <span className="cell-empty">—</span>;
      case 'status': return <Badge tone={REPORT_STATUS[r.status]?.tone} dot>{REPORT_STATUS[r.status]?.label}</Badge>;
      case 'createdBy': return <span className="site-meta">{r.createdByEmail || '—'}</span>;
      case 'decidedBy': return <span className="site-meta">{r.decidedByEmail || '—'}</span>;
      case 'decidedAt': return <span className="tabular">{r.decidedAt ? String(r.decidedAt).slice(0, 10) : '—'}</span>;
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
          <h1 className="page-title">Rapports &amp; dépenses</h1>
          <p className="page-desc">Rapports financiers (facture / état des dépenses) et techniques des prestataires TPM, rattachés au budget mensuel du suivi. Le « Réalisé » validé alimente la consommation du contrat.</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <MonthPicker value={month} onChange={setMonth} />
          {canEdit && <Button variant="secondary" icon={CalendarClock} onClick={() => setGenOpen(true)}>Générer les rapports mensuels</Button>}
          {canEdit && <Button variant="secondary" icon={Plus} onClick={() => setFacture({ kind: 'technique' })}>Rapport technique</Button>}
          {canEdit && <Button icon={FileText} onClick={() => setFacture({ kind: 'financier' })}>Rapport financier (facture)</Button>}
        </div>
      </div>

      <GuidedFlow flow={flow} month={month} ready={reports !== null} onNavigate={onNavigate}
        onNewFacture={canEdit ? () => setFacture({ kind: 'financier' }) : undefined} />

      <Stats items={[
        { label: 'Rapports du mois', value: reports ? stats.total : '—', foot: `${stats.tech} technique(s)` },
        { label: 'Réalisé validé', value: reports ? (currency === 'USD' ? formatUsdFor(stats.justified, rates, `${month}-01`) : formatInt(stats.justified)) : '—', suffix: currency === 'USD' ? '' : 'Ar', foot: 'Financiers validés' },
        { label: 'En attente', value: reports ? stats.pending : '—', foot: 'Statut « soumis »' },
        { label: 'Contrats suivis', value: context ? context.contracts.length : '—', foot: 'Avec budget Suivi/TPM' },
      ]} />

      <Card>
        {/* Barre de filtres (façon COMET) */}
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
            {/* Mémoriser le filtre : gauche = temporaire (session), droite = permanent (user) */}
            <IconButton icon={Clock} label="Mémoriser le filtre (temporaire)" variant="secondary" size="sm" onClick={() => { viewStore.saveTemp(currentPayload()); toast.success('Filtre mémorisé pour cette session.'); }} />
            <IconButton icon={Save} label="Mémoriser le filtre (permanent)" variant="secondary" size="sm" onClick={() => { viewStore.savePerm(currentPayload()); toast.success('Filtre enregistré comme vue par défaut.'); }} />
            <IconButton icon={RotateCcw} label="Réinitialiser" variant="secondary" size="sm" onClick={resetView} />
          </div>
        </div>

        {/* Barre d'actions */}
        <div className="data-toolbar">
          <div className="data-toolbar-left">
            {selected?.kind === 'financier' && <Button size="sm" variant="secondary" icon={ExternalLink} onClick={() => setFacture({ reportId: selected.id })}>Ouvrir la facture</Button>}
            {selected?.kind === 'financier' && selected?.status === 'valide' && onNavigate && <Button size="sm" variant="secondary" icon={TrendingUp} onClick={() => onNavigate('dashboard', 'consolidation')}>Voir dans la consolidation</Button>}
            {canEdit && selected?.status === 'soumis' && <>
              <Button size="sm" variant="secondary" icon={ShieldCheck} onClick={() => setDecide({ report: selected, approve: true })}>Valider</Button>
              <Button size="sm" variant="secondary" icon={X} onClick={() => setDecide({ report: selected, approve: false })}>Rejeter</Button>
            </>}
            {canEdit && selected && !['valide', 'non_applicable'].includes(selected.status) && <Button size="sm" variant="secondary" icon={Ban} onClick={() => markNotApplicable(selected)}>Non applicable</Button>}
            {canEdit && selected && selected.status !== 'valide' && <Button size="sm" variant="ghost" icon={Trash2} onClick={() => removeReport(selected)}>Supprimer</Button>}
            {selected && <Button size="sm" variant="ghost" icon={X} onClick={() => setSelectedId(null)}>Désélectionner</Button>}
          </div>
          <div className="data-toolbar-right">
            <Button size="sm" variant="secondary" icon={Printer} onClick={() => window.print()} disabled={!(reports && reports.length)}>Imprimer</Button>
            <Button size="sm" variant="secondary" icon={Download} onClick={exportCsv} disabled={!(reports && reports.length)}>Exporter (CSV)</Button>
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
              {reports === null
                ? [0, 1, 2].map((i) => <tr key={i} aria-hidden="true"><td /><td colSpan={cols.length}><Skeleton height={18} /></td></tr>)
                : pageRows.map((r) => {
                    const isSel = selectedId === r.id;
                    return (
                      <tr key={r.id} className={`clickable ${isSel ? 'is-selected' : ''}`} onClick={() => setSelectedId(r.id)}
                        onDoubleClick={() => r.kind === 'financier' && setFacture({ reportId: r.id })}>
                        <td onClick={(e) => e.stopPropagation()}>
                          <input type="radio" name="report-select" checked={isSel} onChange={() => setSelectedId(isSel ? null : r.id)} aria-label={`Sélectionner ${r.partnerName}`} />
                        </td>
                        {cols.map((k) => <td key={k} className={COLUMNS[k].num ? 'num tabular' : ''}>{renderCell(r, k)}</td>)}
                      </tr>
                    );
                  })}
            </tbody>
          </table>
          {reports && filtered.length === 0 && (
            <EmptyState icon={FileText} title={reports.length ? 'Aucun rapport ne correspond' : 'Aucun rapport ce mois-ci'}
              action={canEdit && (reports.length === 0
                ? <Button icon={FileText} onClick={() => setFacture({ kind: 'financier' })}>Rapport financier</Button>
                : <Button variant="secondary" icon={RotateCcw} onClick={resetView}>Réinitialiser les filtres</Button>)}>
              {reports.length ? 'Ajustez les filtres.' : 'Enregistrez les rapports financiers (facture) et techniques des prestataires TPM pour ce mois.'}
            </EmptyState>
          )}
        </div>

        {reports && filtered.length > 0 && (
          <div className="list-foot">
            <span className="list-count">{(pageClamped - 1) * PAGE_SIZE + 1}–{Math.min(pageClamped * PAGE_SIZE, filtered.length)} sur {filtered.length} rapport{filtered.length > 1 ? 's' : ''}</span>
            <div className="pager">
              <button type="button" className="pager-btn" disabled={pageClamped <= 1} onClick={() => setPage(pageClamped - 1)} aria-label="Page précédente"><ChevronLeft size={16} /></button>
              <span className="pager-info">Page {pageClamped} / {totalPages}</span>
              <button type="button" className="pager-btn" disabled={pageClamped >= totalPages} onClick={() => setPage(pageClamped + 1)} aria-label="Page suivante"><ChevronRight size={16} /></button>
            </div>
          </div>
        )}
      </Card>

      <div className="note"><Info size={18} aria-hidden="true" /><span>Un rapport <strong>financier</strong> est une <strong>facture</strong> (état des dépenses poste par poste) : créez-le ci-dessus, il s'ouvre dans l'éditeur de facture. Les icônes à droite de la barre de filtres mémorisent votre filtre (<Clock size={12} /> temporaire, <Save size={12} /> permanent) ; <Columns3 size={12} /> choisit les colonnes. Un rapport non validé peut être supprimé.</span></div>

      {facture && <FactureDrawer reportId={facture.reportId} kind={facture.kind} initial={facture.initial} autoPrefill={facture.autoPrefill} context={context} month={month} onClose={() => setFacture(null)} onSaved={() => { setFacture(null); reload(); }} />}
      {decide && <DecideModal decide={decide} onClose={() => setDecide(null)} onConfirm={runDecision} />}
      {genOpen && <GenerateModal context={context} onClose={() => setGenOpen(false)} onDone={() => { setGenOpen(false); reload(); }} />}
    </div>
  );
}

/**
 * Fil guidé du rapportage TPM : Plan validé → Facture → Validation →
 * Consolidation. Chaque étape montre l'état du mois et mène à l'écran concerné.
 */
function GuidedFlow({ flow, month, ready, onNavigate, onNewFacture }) {
  const steps = [
    {
      key: 'plan', n: 1, icon: Wallet, label: 'Plan validé',
      state: flow.plansValides > 0 ? 'done' : (flow.plansTotal > 0 ? 'wip' : 'todo'),
      detail: ready ? `${flow.plansValides}/${flow.plansTotal} plan(s)` : '—',
      onClick: onNavigate ? () => onNavigate('tpm', 'budget') : undefined,
      cta: 'Planification & budget',
    },
    {
      key: 'facture', n: 2, icon: FileText, label: 'Facture (état des dépenses)',
      state: flow.facturesCreees > 0 ? 'done' : 'todo',
      detail: ready ? `${flow.facturesCreees} facture(s)` : '—',
      onClick: onNewFacture,
      cta: onNewFacture ? 'Créer une facture' : undefined,
    },
    {
      key: 'valide', n: 3, icon: ShieldCheck, label: 'Validation',
      state: flow.facturesValidees > 0 ? 'done' : (flow.facturesSoumises > 0 ? 'wip' : 'todo'),
      detail: ready ? `${flow.facturesValidees} validée(s)${flow.facturesSoumises ? ` · ${flow.facturesSoumises} à valider` : ''}` : '—',
    },
    {
      key: 'conso', n: 4, icon: TrendingUp, label: 'Consolidation',
      state: flow.facturesValidees > 0 ? 'done' : 'todo',
      detail: 'Budget ↔ Planifié ↔ Réalisé',
      onClick: onNavigate ? () => onNavigate('dashboard', 'consolidation') : undefined,
      cta: 'Voir la consolidation',
    },
  ];
  return (
    <div className="flow" aria-label={`Fil guidé du rapportage — ${monthLabel(month)}`}>
      {steps.map((s, i) => {
        const Icon = s.icon;
        const Tag = s.onClick ? 'button' : 'div';
        return (
          <React.Fragment key={s.key}>
            <Tag type={s.onClick ? 'button' : undefined} className={`flow-step is-${s.state}${s.onClick ? ' is-clickable' : ''}`} onClick={s.onClick} title={s.cta || s.label}>
              <span className="flow-num"><Icon size={16} aria-hidden="true" /></span>
              <span className="flow-body">
                <span className="flow-label">{s.label}</span>
                <span className="flow-detail">{s.detail}</span>
                {s.cta && s.onClick && <span className="flow-cta">{s.cta}</span>}
              </span>
            </Tag>
            {i < steps.length - 1 && <FlowArrow className="flow-arrow" size={18} aria-hidden="true" />}
          </React.Fragment>
        );
      })}
    </div>
  );
}

function GenerateModal({ context, onClose, onDone }) {
  const toast = useToast();
  const partners = context?.partners || [];
  const contracts = context?.contracts || [];
  const [form, setForm] = useState({ contractId: '', partnerId: '' });
  const [busy, setBusy] = useState(false);
  const contract = contracts.find((c) => c.id === form.contractId);

  async function go() {
    if (!form.contractId || !form.partnerId) { toast.error('Choisissez le contrat et le prestataire TPM.'); return; }
    setBusy(true);
    try {
      const r = await api.generateMonthlyReports({ contractId: form.contractId, partnerId: form.partnerId });
      toast.success(r.created > 0 ? `${r.created} rapport(s) mensuel(s) créé(s).` : 'Les rapports mensuels existaient déjà.');
      onDone();
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  }
  return (
    <Modal open title="Générer les rapports mensuels" subtitle="Un gabarit « attendu » par mois de la durée du contrat, à remplir ou à marquer non applicable."
      onClose={() => !busy && onClose()}
      footer={<><Button variant="secondary" onClick={onClose} disabled={busy}>Annuler</Button><Button onClick={go} loading={busy} icon={CalendarClock}>Générer</Button></>}>
      <div style={{ display: 'grid', gap: 14 }}>
        <Field label="Contrat suivi">
          <select className={`select ${form.contractId ? '' : 'is-empty'}`} value={form.contractId} onChange={(e) => setForm({ ...form, contractId: e.target.value })}>
            <option value="">Choisir…</option>{contracts.map((c) => <option key={c.id} value={c.id}>{c.partnerName} · {c.numero}</option>)}
          </select>
        </Field>
        <Field label="Prestataire TPM">
          <select className={`select ${form.partnerId ? '' : 'is-empty'}`} value={form.partnerId} onChange={(e) => setForm({ ...form, partnerId: e.target.value })}>
            <option value="">Choisir…</option>{partners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Field>
        {contract && <div className="note"><CalendarClock size={18} aria-hidden="true" /><span>Un rapport financier « attendu » sera créé pour chaque mois de la période du contrat ({contract.periodMonths} mois). Les mois déjà présents ne sont pas dupliqués.</span></div>}
      </div>
    </Modal>
  );
}

function DecideModal({ decide, onClose, onConfirm }) {
  const { report, approve } = decide;
  const [comment, setComment] = useState('');
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  async function go() {
    setTouched(true);
    if (!approve && comment.trim().length === 0) return;
    setBusy(true);
    await onConfirm(report, approve, comment.trim() || undefined);
    setBusy(false);
  }
  return (
    <Modal open onClose={() => !busy && onClose()} title={approve ? 'Valider le rapport ?' : 'Rejeter le rapport ?'}
      subtitle={`${report.partnerName} · ${report.contractNumero} · ${REPORT_KIND[report.kind].label}`}
      footer={<><Button variant="secondary" onClick={onClose} disabled={busy}>Annuler</Button><Button loading={busy} onClick={go}>{approve ? 'Valider' : 'Rejeter'}</Button></>}>
      {approve
        ? <p>{report.kind === 'financier' ? `Le montant réalisé (${formatAr(report.reportedAmount || 0)}) sera comptabilisé dans la consommation du budget Suivi/TPM du contrat.` : 'Le rapport technique sera marqué comme validé.'}</p>
        : <p>Le rapport repassera à corriger côté prestataire.</p>}
      <Field label={approve ? 'Commentaire' : 'Motif du rejet'} htmlFor="dc-comment" required={!approve} error={touched && !approve && !comment.trim() ? 'Motif obligatoire.' : undefined}>
        <textarea id="dc-comment" className="input" value={comment} onChange={(e) => setComment(e.target.value)} />
      </Field>
    </Modal>
  );
}
