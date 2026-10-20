import React, { useEffect, useMemo, useState } from 'react';
import {
  Plus, FileText, ShieldCheck, X, Info, Search, SlidersHorizontal, Columns3,
  Save, Clock, RotateCcw, Download, Printer, Trash2, ChevronLeft, ChevronRight, ExternalLink, CalendarClock, Ban,
  Wallet, TrendingUp, ChevronRight as FlowArrow, Send,
} from 'lucide-react';
import { api } from '../../api/client.js';
import { Alert, Badge, Button, Card, EmptyState, Field, IconButton, Skeleton, StatusBadge, Stats } from '../../components/ui.jsx';
import Modal from '../../components/Modal.jsx';
import DeleteDialog from '../../components/DeleteDialog.jsx';
import FactureDrawer from './FactureDrawer.jsx';
import ProviderSelect from '../../components/ProviderSelect.jsx';
import { usePopover, SortTh, makeViewStore } from '../../components/listView.jsx';
import { useToast } from '../../components/Toast.jsx';
import { currentMonth, formatAr, formatInt, monthLabel } from '../../lib/format.js';
import { formatUsdCents, formatUsdFor, sumUsdCents } from '../../lib/currency.js';
import { REPORT_KIND, REPORT_STATUS, richText } from '../../lib/contracts.js';
import { useI18n } from '../../lib/i18n.jsx';
import { ROLE_LABELS, contractIdentity, contractNo } from '../../lib/roles.js';
import { downloadCsv } from '../../lib/csv.js';
import { overlaps, periodFromSaved, periodLabel, single } from '../../lib/period.js';
import PeriodSelect from '../../components/PeriodSelect.jsx';

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
// La « Période » (lot 1b : plage de mois { from, to }, '' = toutes) vit dans la barre de
// filtres COMET : un rapport est montré si sa période [mois, fin] CHEVAUCHE la plage
// (facture pluri-mensuelle comprise) ; le « Réalisé validé » ne somme que les factures dont
// le mois de début tombe dans la plage — la règle de la consolidation, jamais un double compte.
const FILTERS = {
  q:        { label: 'Recherche', type: 'search', ph: 'TPM, contrat…' },
  period:   { label: 'Période', type: 'period' },
  partnerId: { label: ROLE_LABELS.tpm, type: 'select' },
  contractId: { label: 'Contrat', type: 'select' },
  kind:     { label: 'Type', type: 'select' },
  status:   { label: 'Statut', type: 'select' },
};
const ALL_FILTERS = ['q', 'period', 'partnerId', 'contractId', 'kind', 'status'];
const DEFAULT_FILTERS = ['period', 'q', 'partnerId', 'kind', 'status'];

// Colonnes disponibles (choisies via le sélecteur de colonnes).
const COLUMNS = {
  partner:   { label: ROLE_LABELS.tpm, sort: 'partner' },
  contract:  { label: 'Contrat', sort: 'contract' },
  period:    { label: 'Période', sort: 'period' },
  kind:      { label: 'Type', sort: 'kind' },
  invoiceNo: { label: 'N° facture' },
  planned:   { label: 'Prévu', num: true, sort: 'planned' },
  reported:  { label: 'Réalisé (bailleur)', num: true, sort: 'reported' },
  document:  { label: 'Document' },
  reference: { label: 'Référence' },
  status:    { label: 'Statut', sort: 'status' },
  createdBy: { label: 'Créé par' },
  decidedBy: { label: 'Décidé par' },
  decidedAt: { label: 'Date décision' },
};
const ALL_COLUMNS = Object.keys(COLUMNS);
const DEFAULT_COLUMNS = ['partner', 'contract', 'period', 'kind', 'invoiceNo', 'planned', 'reported', 'status'];

const emptyValues = () => ({ q: '', period: single(currentMonth()), partnerId: '', contractId: '', kind: '', status: '' });
// Vue enregistrée : une ancienne période « AAAA-MM » est relue comme { from: v, to: v }, jamais rejetée.
const readSaved = (values) => ({ ...values, period: periodFromSaved(values.period) });
const inPeriod = (p, month) => !p || (!!month && String(month).slice(0, 7) >= p.from && String(month).slice(0, 7) <= p.to);

export default function ReportsPage({ canEdit, onOpenContract, onNavigate }) {
  const { tr, lang } = useI18n();
  const toast = useToast();
  const [context, setContext] = useState(null);
  const [reports, setReports] = useState(null);
  const [plans, setPlans] = useState([]);
  const [rates, setRates] = useState([]);
  const [error, setError] = useState(null);

  const [facture, setFacture] = useState(null); // {reportId?} | {kind} | null
  const [decide, setDecide] = useState(null);    // {report, approve}
  const [del, setDel] = useState(null);          // rapport à supprimer (retour 56)
  const [genOpen, setGenOpen] = useState(false); // modale génération mensuelle

  const saved = viewStore.initial();
  const [values, setValues] = useState(() => readSaved({ ...emptyValues(), ...(saved?.values || {}) }));
  const [shownFilters, setShownFilters] = useState(() => saved?.shownFilters || DEFAULT_FILTERS);
  const [columns, setColumns] = useState(() => saved?.columns || DEFAULT_COLUMNS);
  const [sort, setSort] = useState(() => saved?.sort || { key: 'partner', dir: 'asc' });
  const [currency, setCurrency] = useState('Ar');
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState(null);

  const filterMenu = usePopover();
  const colMenu = usePopover();

  // Mois de référence (fil guidé, conversion en USD) = le DERNIER mois de la période
  // choisie dans la barre de filtres (« Fil du mois de {to} »), sinon le mois courant.
  const period = values.period && values.period.from ? values.period : null;
  const month = period ? period.to : currentMonth();

  async function reload() {
    setError(null);
    try {
      // On charge TOUS les rapports (toutes périodes) : la période se filtre
      // dans le tableau (colonne + filtre), plus de sélecteur de date en haut.
      const [ctx, list] = await Promise.all([api.reportsContext(), api.listReports({})]);
      setContext(ctx); setReports(list);
    } catch (err) { setError(err.message); setReports((r) => r || []); }
  }
  useEffect(() => { reload(); /* eslint-disable-next-line */ }, []);
  useEffect(() => { api.listExchangeRates().then(setRates).catch(() => setRates([])); }, []);
  // Plans du mois de référence — pour le fil guidé (compteur « plans validés »).
  useEffect(() => { api.listPlans({ month }).then(setPlans).catch(() => setPlans([])); }, [month]);

  // Fil guidé : arrivée depuis « Créer la facture » d'un plan (Planification &
  // budget). On ouvre l'éditeur de facture pré-rempli, sur la bonne période.
  useEffect(() => {
    let intent = null;
    try { const raw = sessionStorage.getItem('mems.tpm.newFacture'); if (raw) { intent = JSON.parse(raw); sessionStorage.removeItem('mems.tpm.newFacture'); } } catch { /* ignore */ }
    if (!intent) return;
    if (intent.month) setValues((s) => ({ ...s, period: single(String(intent.month).slice(0, 7)) }));
    setFacture({ kind: 'financier', initial: { partnerId: intent.partnerId, contractId: intent.contractId }, autoPrefill: true });
  }, []);

  // Fil guidé plan → facture → validation → consolidation (état du mois de réf.).
  const flow = useMemo(() => {
    const fin = (reports || []).filter((r) => r.kind === 'financier' && (r.periodMonth || '').slice(0, 7) === month);
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
        case 'q': { const q = v.toLowerCase(); return [r.partnerName, r.contractPartner, r.contractNumero, r.contractFla, r.reference, r.invoiceNo].some((x) => x && String(x).toLowerCase().includes(q)); }
        case 'period': return overlaps(v, r.periodMonth, r.periodEnd);
        case 'partnerId': return r.partnerId === v;
        case 'contractId': return r.contractId === v;
        case 'kind': return r.kind === v;
        case 'status': return r.status === v;
        default: return true;
      }
    }));
    const val = (r) => ({
      partner: r.partnerName || '', contract: contractNo(r) || '', kind: r.kind,
      period: r.periodMonth || '', planned: r.plannedAmount || 0, reported: r.reportedAmount || 0,
      status: ['attendu', 'soumis', 'valide', 'rejete'].indexOf(r.status),
    }[sort.key]);
    return [...list].sort((a, a2) => {
      const va = val(a); const vb = val(a2);
      const cmp = typeof va === 'number' ? va - vb : String(va).localeCompare(String(vb));
      return sort.dir === 'asc' ? cmp : -cmp;
    });
  }, [reports, values, shown, sort]);

  // Stats = reflet des lignes affichées (filtres actifs, période comprise). « Réalisé validé » :
  // factures validées comptées au mois de leur début (period_month), comme la consolidation.
  const periodShown = shown.includes('period') ? period : null;
  const stats = useMemo(() => {
    const fin = filtered.filter((r) => r.kind === 'financier');
    const validated = fin.filter((r) => r.status === 'valide' && inPeriod(periodShown, r.periodMonth));
    return {
      total: filtered.length, tech: filtered.filter((r) => r.kind === 'technique').length,
      justified: validated.reduce((n, r) => n + (r.reportedAmount || 0), 0),
      // En dollars : chaque facture au taux de SON mois, en cents entiers (= somme des cellules
      // du tableau) — jamais le total de plusieurs mois au taux du dernier.
      justifiedUsdCents: sumUsdCents(validated.map((r) => ({ amountAr: r.reportedAmount || 0, period: r.periodMonth })), rates),
      pending: filtered.filter((r) => r.status === 'soumis').length,
    };
  }, [filtered, periodShown, rates]);

  const sig = JSON.stringify({ values, shownFilters, sort });
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
  function resetView() { setValues(emptyValues()); viewStore.clear(); toast.info(tr('Filtres réinitialisés.')); }

  // Rapports par mois (sélecteur de période : volume par mois, dernier mois avec des rapports).
  const reportCounts = useMemo(() => {
    const out = {};
    for (const r of reports || []) if (r.periodMonth) { const m = String(r.periodMonth).slice(0, 7); out[m] = (out[m] || 0) + 1; }
    return out;
  }, [reports]);
  const latestReport = useMemo(() => {
    const ms = Object.keys(reportCounts).filter((m) => m <= currentMonth()).sort();
    return ms.length ? ms[ms.length - 1] : null;
  }, [reportCounts]);

  function optionsFor(k) {
    switch (k) {
      case 'partnerId': return [{ id: '', label: tr(ROLE_LABELS.allTpm) }, ...(context?.partners || []).map((p) => ({ id: p.id, label: p.name }))];
      case 'contractId': return [{ id: '', label: tr('Tous les contrats') }, ...(context?.contracts || []).map((c) => ({ id: c.id, label: contractIdentity(c) }))];
      case 'kind': return KINDS.map((o) => ({ ...o, label: tr(o.label) }));
      case 'status': return STATUSES.map((o) => ({ ...o, label: tr(o.label) }));
      default: return [];
    }
  }

  const money = (ar, period) => (currency === 'USD' ? formatUsdFor(ar, rates, period) : formatAr(ar));
  const hasRates = rates.length > 0;

  async function runDecision(report, approve, comment) {
    try {
      if (approve) await api.approveReport(report.id, { comment }); else await api.rejectReport(report.id, { comment });
      toast.success(approve ? tr('Rapport validé.') : tr('Rapport rejeté.')); setDecide(null); reload();
    } catch (err) { toast.error(err.message); }
  }
  // Suppression (retour 56) : le dialogue commun gère la confirmation et, pour
  // un rapport validé, le justificatif obligatoire.
  function removeReport(r) { setDel(r); }
  // Soumettre un rapport « attendu » ou « rejeté » : le serveur vérifie la
  // transition et qu'une facture porte au moins un poste (message clair sinon).
  async function submitReport(r) {
    if (!window.confirm(tr('Soumettre le rapport de « {name} » à la validation ? Vous ne pourrez pas le valider vous-même.', { name: r.partnerName }))) return;
    try { await api.submitReport(r.id); toast.success(tr('Rapport soumis à la validation.')); reload(); }
    catch (err) { toast.error(err.message); }
  }
  async function markNotApplicable(r) {
    if (!window.confirm(tr('Marquer « non applicable » le rapport de « {name} » pour ce mois (aucun suivi réalisé) ?', { name: r.partnerName }))) return;
    try { await api.reportNotApplicable(r.id); toast.success(tr('Rapport marqué non applicable.')); reload(); }
    catch (err) { toast.error(err.message); }
  }

  function exportCsv() {
    const head = cols.map((k) => tr(COLUMNS[k].label));
    const cell = (r, k) => {
      switch (k) {
        case 'partner': return r.partnerName;
        case 'contract': return contractIdentity(r);
        case 'kind': return tr(REPORT_KIND[r.kind].label);
        case 'planned': return currency === 'USD' ? money(r.plannedAmount, r.periodMonth) : Math.round(r.plannedAmount || 0);
        case 'reported': return r.kind === 'financier' ? (currency === 'USD' ? money(r.reportedAmount, r.periodMonth) : Math.round(r.reportedAmount || 0)) : '';
        case 'document': return r.documentName || '';
        case 'reference': return r.reference || '';
        case 'invoiceNo': return r.invoiceNo || '';
        case 'status': return REPORT_STATUS[r.status] ? tr(REPORT_STATUS[r.status].label) : r.status;
        case 'createdBy': return r.createdByEmail || '';
        case 'decidedBy': return r.decidedByEmail || '';
        case 'decidedAt': return r.decidedAt ? String(r.decidedAt).slice(0, 10) : '';
        default: return '';
      }
    };
    downloadCsv(`rapports_${periodShown ? `${periodShown.from}_${periodShown.to}` : 'toutes-periodes'}.csv`, [head, ...filtered.map((r) => cols.map((k) => cell(r, k)))]);
  }

  function renderCell(r, k) {
    switch (k) {
      case 'partner': return <strong className="nowrap">{r.partnerName}</strong>;
      // Identité du contrat (retour 113) : n° FLA puis titulaire, comme partout.
      case 'contract': return <><button type="button" className="link-cell mono nowrap" onClick={(e) => { e.stopPropagation(); onOpenContract(r.contractId); }}>{contractNo(r)}</button><div className="site-meta">{r.contractPartner}</div></>;
      case 'period': return (
        <span className="tabular">{r.periodMonth ? monthLabel(String(r.periodMonth).slice(0, 7)) : '—'}
          {r.periodEnd ? <div className="site-meta">→ {monthLabel(String(r.periodEnd).slice(0, 7))}</div> : null}
          {/* Facture pluri-mensuelle qui commence avant la période : montrée, comptée au mois de son début. */}
          {periodShown && r.periodMonth && !inPeriod(periodShown, r.periodMonth) && (
            <div className="site-meta text-warn">{tr('comptée en {m}', { m: monthLabel(String(r.periodMonth).slice(0, 7)) })}</div>
          )}
        </span>
      );
      case 'kind': return <Badge tone={REPORT_KIND[r.kind].tone}>{tr(REPORT_KIND[r.kind].label)}</Badge>;
      case 'planned': return r.plannedAmount != null ? money(r.plannedAmount, r.periodMonth) : <span className="cell-empty">—</span>;
      case 'reported': return r.kind === 'financier' ? money(r.reportedAmount || 0, r.periodMonth) : <span className="cell-empty">—</span>;
      case 'document': return r.documentName || <span className="cell-empty">—</span>;
      case 'reference': return r.reference ? <span className="mono">{r.reference}</span> : <span className="cell-empty">—</span>;
      case 'invoiceNo': return r.invoiceNo ? <span className="mono">{r.invoiceNo}</span> : <span className="cell-empty">—</span>;
      case 'status': return <StatusBadge def={REPORT_STATUS[r.status]} />;
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
        <span className="cfilter-label">{tr(f.label)}</span>
        {f.type === 'period' ? (
          <PeriodSelect compact allowAll value={values.period || null} onChange={(p) => setVal('period', p || '')}
            counts={reportCounts} countLabel="{n} rapport(s) sur la période" latest={latestReport} ariaLabel={tr(f.label)} />
        ) : f.type === 'search' ? (
          <span className="input-wrap"><Search size={16} aria-hidden="true" />
            <input className="input" type="search" placeholder={tr(f.ph)} value={values[k]} onChange={(e) => setVal(k, e.target.value)} />
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
          <h1 className="page-title">{tr('Rapports & dépenses')}</h1>
          <p className="page-desc">{tr('Rapports financiers (facture / état des dépenses) et techniques des TPM, rattachés au budget mensuel du suivi. Le « Réalisé » validé alimente la consommation du contrat.')}</p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {canEdit && <Button variant="secondary" icon={CalendarClock} onClick={() => setGenOpen(true)}>{tr('Générer les rapports mensuels')}</Button>}
          {canEdit && <Button variant="secondary" icon={Plus} onClick={() => setFacture({ kind: 'technique' })}>{tr('Rapport technique')}</Button>}
          {canEdit && <Button icon={FileText} onClick={() => setFacture({ kind: 'financier' })}>{tr('Rapport financier (facture)')}</Button>}
        </div>
      </div>

      <GuidedFlow flow={flow} month={month} ready={reports !== null} onNavigate={onNavigate}
        onNewFacture={canEdit ? () => setFacture({ kind: 'financier' }) : undefined} />

      <Stats items={[
        { label: periodShown ? tr('Rapports de la période') : tr('Rapports'), value: reports ? stats.total : '—',
          foot: periodShown ? `${periodLabel(periodShown, lang)} · ${tr('{n} technique(s)', { n: stats.tech })}` : tr('{n} technique(s)', { n: stats.tech }) },
        { label: tr('Réalisé validé'), value: reports ? (currency === 'USD' ? formatUsdCents(stats.justifiedUsdCents) : formatInt(stats.justified)) : '—', suffix: currency === 'USD' ? '' : 'Ar',
          foot: periodShown ? tr('Financiers validés, comptés au mois de début') : tr('Financiers validés') },
        { label: tr('En attente'), value: reports ? stats.pending : '—', foot: tr('Statut « soumis »') },
        { label: tr('Contrats suivis'), value: context ? context.contracts.length : '—', foot: tr('Avec budget Suivi/TPM') },
      ]} />

      <Card>
        {/* Barre de filtres (façon COMET) */}
        <div className="filters-bar comet-filters">
          <span className="filters-label">{tr('Filtres\u00a0:')}</span>
          <div className="comet-fields">
            {shown.map(renderFilter)}
            {shown.length === 0 && <span className="filters-empty">{tr("Aucun filtre actif — ajoutez-en avec l'icône filtres.")}</span>}
          </div>
          <div className="comet-icons">
            <div className="seg" role="group" aria-label={tr("Devise d'affichage")}>
              <button type="button" className={currency === 'Ar' ? 'is-active' : ''} onClick={() => setCurrency('Ar')}>Ar</button>
              <button type="button" className={currency === 'USD' ? 'is-active' : ''} onClick={() => setCurrency('USD')} title={hasRates ? tr('Valeurs en dollars selon la période') : tr('Aucun taux de change — à saisir dans Paramétrage')}>USD</button>
            </div>
            <div className="pop-anchor" ref={filterMenu.ref}>
              <IconButton icon={SlidersHorizontal} label={tr('Filtres à afficher')} variant="secondary" size="sm" onClick={() => filterMenu.setOpen((o) => !o)} />
              {filterMenu.open && (
                <div className="pop-menu filter-menu" role="menu">
                  <div className="pop-menu-label">{tr('Filtres à afficher')}</div>
                  {ALL_FILTERS.map((k) => (
                    <label key={k} className="filter-pick"><input type="checkbox" checked={shownFilters.includes(k)} onChange={() => toggleFilter(k)} /><span>{tr(FILTERS[k].label)}</span></label>
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
                    <label key={k} className="filter-pick"><input type="checkbox" checked={columns.includes(k)} onChange={() => toggleColumn(k)} /><span>{tr(COLUMNS[k].label)}</span></label>
                  ))}
                </div>
              )}
            </div>
            {/* Mémoriser le filtre : gauche = temporaire (session), droite = permanent (user) */}
            <IconButton icon={Clock} label={tr('Mémoriser le filtre (temporaire)')} variant="secondary" size="sm" onClick={() => { viewStore.saveTemp(currentPayload()); toast.success(tr('Filtre mémorisé pour cette session.')); }} />
            <IconButton icon={Save} label={tr('Mémoriser le filtre (permanent)')} variant="secondary" size="sm" onClick={() => { viewStore.savePerm(currentPayload()); toast.success(tr('Filtre enregistré comme vue par défaut.')); }} />
            <IconButton icon={RotateCcw} label={tr('Réinitialiser')} variant="secondary" size="sm" onClick={resetView} />
          </div>
        </div>

        {/* Barre d'actions */}
        <div className="data-toolbar">
          <div className="data-toolbar-left">
            {selected?.kind === 'financier' && <Button size="sm" variant="secondary" icon={ExternalLink} onClick={() => setFacture({ reportId: selected.id })}>{tr('Ouvrir la facture')}</Button>}
            {selected?.kind === 'financier' && selected?.status === 'valide' && onNavigate && <Button size="sm" variant="secondary" icon={TrendingUp} onClick={() => onNavigate('dashboard', 'consolidation')}>{tr('Voir dans la consolidation')}</Button>}
            {/* Actions calculées par le serveur pour l'utilisateur courant (mêmes règles qu'à l'écriture) :
                seul l'auteur soumet ; ni le soumetteur ni l'auteur ne valident ou ne rejettent. */}
            {canEdit && selected?.actions?.submit && <Button size="sm" variant="secondary" icon={Send} onClick={() => submitReport(selected)}>{tr('Soumettre')}</Button>}
            {canEdit && selected?.actions?.decide && <>
              <Button size="sm" variant="secondary" icon={ShieldCheck} onClick={() => setDecide({ report: selected, approve: true })}>{tr('Valider')}</Button>
              <Button size="sm" variant="secondary" icon={X} onClick={() => setDecide({ report: selected, approve: false })}>{tr('Rejeter')}</Button>
            </>}
            {canEdit && selected?.status === 'soumis' && selected?.actions?.decideReason && (
              <span className="muted" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
                <ShieldCheck size={15} aria-hidden="true" />{tr('Séparation des tâches : vous avez rempli ou soumis ce rapport, un autre gestionnaire le valide.')}
              </span>
            )}
            {canEdit && selected?.actions?.notApplicable && selected.status !== 'non_applicable' && <Button size="sm" variant="secondary" icon={Ban} onClick={() => markNotApplicable(selected)}>{tr('Non applicable')}</Button>}
            {canEdit && selected?.actions?.remove && <Button size="sm" variant="ghost" icon={Trash2} onClick={() => removeReport(selected)}>{tr('Supprimer')}</Button>}
            {selected && <Button size="sm" variant="ghost" icon={X} onClick={() => setSelectedId(null)}>{tr('Désélectionner')}</Button>}
          </div>
          <div className="data-toolbar-right">
            <Button size="sm" variant="secondary" icon={Printer} onClick={() => window.print()} disabled={!(reports && reports.length)}>{tr('Imprimer')}</Button>
            <Button size="sm" variant="secondary" icon={Download} onClick={exportCsv} disabled={!(reports && reports.length)}>{tr('Exporter (CSV)')}</Button>
          </div>
        </div>

        {error && <div style={{ padding: '12px 20px 0' }}><Alert tone="error">{error}</Alert></div>}
        {currency === 'USD' && !hasRates && <div style={{ padding: '12px 20px 0' }}><Alert tone="warn">{tr('Aucun taux de change saisi — renseignez-les dans Paramétrage › Taux de change pour afficher les valeurs en dollars.')}</Alert></div>}

        <div className="table-wrap">
          <table className="table grid">
            <thead><tr>
              <th scope="col" style={{ width: 36 }}><span className="sr-only">{tr('Sélection')}</span></th>
              {cols.map((k) => (COLUMNS[k].sort
                ? <SortTh key={k} label={tr(COLUMNS[k].label)} k={COLUMNS[k].sort} sort={sort} onSort={onSort} className={COLUMNS[k].num ? 'num' : ''} />
                : <th key={k} scope="col" className={COLUMNS[k].num ? 'num' : ''}>{tr(COLUMNS[k].label)}</th>))}
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
                          <input type="radio" name="report-select" checked={isSel} onChange={() => setSelectedId(isSel ? null : r.id)} aria-label={tr('Sélectionner {name}', { name: r.partnerName })} />
                        </td>
                        {cols.map((k) => <td key={k} className={COLUMNS[k].num ? 'num tabular' : ''}>{renderCell(r, k)}</td>)}
                      </tr>
                    );
                  })}
            </tbody>
          </table>
          {reports && filtered.length === 0 && (
            <EmptyState icon={FileText} title={reports.length ? tr('Aucun rapport ne correspond') : tr('Aucun rapport ce mois-ci')}
              action={canEdit && (reports.length === 0
                ? <Button icon={FileText} onClick={() => setFacture({ kind: 'financier' })}>{tr('Rapport financier')}</Button>
                : <Button variant="secondary" icon={RotateCcw} onClick={resetView}>{tr('Réinitialiser les filtres')}</Button>)}>
              {reports.length ? tr('Ajustez les filtres.') : tr('Enregistrez les rapports financiers (facture) et techniques des TPM pour ce mois.')}
            </EmptyState>
          )}
        </div>

        {reports && filtered.length > 0 && (
          <div className="list-foot">
            <span className="list-count">{tr(filtered.length > 1 ? '{a}–{b} sur {n} rapports' : '{a}–{b} sur {n} rapport', { a: (pageClamped - 1) * PAGE_SIZE + 1, b: Math.min(pageClamped * PAGE_SIZE, filtered.length), n: filtered.length })}</span>
            <div className="pager">
              <button type="button" className="pager-btn" disabled={pageClamped <= 1} onClick={() => setPage(pageClamped - 1)} aria-label={tr('Page précédente')}><ChevronLeft size={16} /></button>
              <span className="pager-info">{tr('Page {p} / {t}', { p: pageClamped, t: totalPages })}</span>
              <button type="button" className="pager-btn" disabled={pageClamped >= totalPages} onClick={() => setPage(pageClamped + 1)} aria-label={tr('Page suivante')}><ChevronRight size={16} /></button>
            </div>
          </div>
        )}
      </Card>

      <div className="note"><Info size={18} aria-hidden="true" /><span>{richText(tr("Un rapport <strong>financier</strong> est une <strong>facture</strong> (état des dépenses poste par poste) : créez-le ci-dessus, il s'ouvre dans l'éditeur de facture."))}{' '}
        {tr('Les icônes à droite de la barre de filtres mémorisent votre filtre ({clock} temporaire, {save} permanent) ; {cols} choisit les colonnes. Un rapport non validé peut être supprimé.')
          .split(/\{(clock|save|cols)\}/).map((part, i) => (i % 2 ? { clock: <Clock key={i} size={12} />, save: <Save key={i} size={12} />, cols: <Columns3 key={i} size={12} /> }[part] : part))}</span></div>

      {facture && <FactureDrawer reportId={facture.reportId} kind={facture.kind} initial={facture.initial} autoPrefill={facture.autoPrefill} context={context} month={month} onClose={() => setFacture(null)} onSaved={() => { setFacture(null); reload(); }} />}
      {decide && <DecideModal decide={decide} onClose={() => setDecide(null)} onConfirm={runDecision} />}
      {del && (
        <DeleteDialog
          open
          validated={del.status === 'valide'}
          title={tr('Supprimer ce rapport ?')}
          description={`${tr(REPORT_KIND[del.kind].label)} · ${del.partnerName} · ${contractNo(del) || ''}`}
          onClose={() => setDel(null)}
          onConfirm={(justification) => api.deleteReport(del.id, justification)}
          onDone={() => { toast.success(tr('Rapport supprimé.')); setDel(null); setSelectedId(null); reload(); }}
        />
      )}
      {genOpen && <GenerateModal context={context} onClose={() => setGenOpen(false)} onDone={() => { setGenOpen(false); reload(); }} />}
    </div>
  );
}

/**
 * Fil guidé du rapportage TPM : Plan validé → Facture → Validation →
 * Consolidation. Chaque étape montre l'état du mois et mène à l'écran concerné.
 */
function GuidedFlow({ flow, month, ready, onNavigate, onNewFacture }) {
  const { tr } = useI18n();
  const title = tr('Fil du mois de {m}', { m: monthLabel(month) });
  const steps = [
    {
      key: 'plan', n: 1, icon: Wallet, label: tr('Plan validé'),
      state: flow.plansValides > 0 ? 'done' : (flow.plansTotal > 0 ? 'wip' : 'todo'),
      detail: ready ? tr('{a}/{b} plan(s)', { a: flow.plansValides, b: flow.plansTotal }) : '—',
      onClick: onNavigate ? () => onNavigate('tpm', 'budget') : undefined,
      cta: tr('Planification & budget'),
    },
    {
      key: 'facture', n: 2, icon: FileText, label: tr('Facture (état des dépenses)'),
      state: flow.facturesCreees > 0 ? 'done' : 'todo',
      detail: ready ? tr('{n} facture(s)', { n: flow.facturesCreees }) : '—',
      onClick: onNewFacture,
      cta: onNewFacture ? tr('Créer une facture') : undefined,
    },
    {
      key: 'valide', n: 3, icon: ShieldCheck, label: tr('Validation'),
      state: flow.facturesValidees > 0 ? 'done' : (flow.facturesSoumises > 0 ? 'wip' : 'todo'),
      detail: ready ? (flow.facturesSoumises
        ? tr('{v} validée(s) · {s} à valider', { v: flow.facturesValidees, s: flow.facturesSoumises })
        : tr('{v} validée(s)', { v: flow.facturesValidees })) : '—',
    },
    {
      key: 'conso', n: 4, icon: TrendingUp, label: tr('Consolidation'),
      state: flow.facturesValidees > 0 ? 'done' : 'todo',
      detail: tr('Budget ↔ Planifié ↔ Réalisé'),
      onClick: onNavigate ? () => onNavigate('dashboard', 'consolidation') : undefined,
      cta: tr('Voir la consolidation'),
    },
  ];
  return (
    <>
    <div className="flow-title">{title}</div>
    <div className="flow" aria-label={tr('Fil guidé du rapportage — {month}', { month: monthLabel(month) })}>
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
    </>
  );
}

function GenerateModal({ context, onClose, onDone }) {
  const { tr } = useI18n();
  const toast = useToast();
  const contracts = context?.contracts || [];
  const [form, setForm] = useState({ contractId: '', partnerId: '' });
  const [busy, setBusy] = useState(false);
  const contract = contracts.find((c) => c.id === form.contractId);

  async function go() {
    if (!form.contractId || !form.partnerId) { toast.error(tr('Choisissez le contrat et le TPM.')); return; }
    setBusy(true);
    try {
      const r = await api.generateMonthlyReports({ contractId: form.contractId, partnerId: form.partnerId });
      toast.success(r.created > 0 ? tr('{n} rapport(s) mensuel(s) créé(s).', { n: r.created }) : tr('Les rapports mensuels existaient déjà.'));
      onDone();
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  }
  return (
    <Modal open title={tr('Générer les rapports mensuels')} subtitle={tr('Un gabarit « attendu » par mois de la durée du contrat, à remplir ou à marquer non applicable.')}
      onClose={() => !busy && onClose()}
      footer={<><Button variant="secondary" onClick={onClose} disabled={busy}>{tr('Annuler')}</Button><Button onClick={go} loading={busy} icon={CalendarClock}>{tr('Générer')}</Button></>}>
      <div style={{ display: 'grid', gap: 14 }}>
        <Field label={tr('Contrat suivi')}>
          <select className={`select ${form.contractId ? '' : 'is-empty'}`} value={form.contractId} onChange={(e) => setForm({ ...form, contractId: e.target.value })}>
            <option value="">{tr('Choisir…')}</option>{contracts.map((c) => <option key={c.id} value={c.id}>{contractIdentity(c)}</option>)}
          </select>
        </Field>
        <Field label={tr(ROLE_LABELS.tpm)}>
          {/* Rapports attendus : prestataires actifs selon contrat sur la période du contrat choisi (retour 30). */}
          <ProviderSelect period={contract ? { from: String(contract.dateDebut).slice(0, 7), to: String(contract.dateFin).slice(0, 7) } : null}
            value={form.partnerId} onChange={(id) => setForm({ ...form, partnerId: id })} ariaLabel={tr(ROLE_LABELS.tpm)} />
        </Field>
        {contract && <div className="note"><CalendarClock size={18} aria-hidden="true" /><span>{tr('Un rapport financier « attendu » sera créé pour chaque mois de la période du contrat ({n} mois). Les mois déjà présents ne sont pas dupliqués.', { n: contract.periodMonths })}</span></div>}
      </div>
    </Modal>
  );
}

function DecideModal({ decide, onClose, onConfirm }) {
  const { tr } = useI18n();
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
    <Modal open onClose={() => !busy && onClose()} title={approve ? tr('Valider le rapport ?') : tr('Rejeter le rapport ?')}
      subtitle={`${report.partnerName} · ${contractNo(report)} · ${tr(REPORT_KIND[report.kind].label)}`}
      footer={<><Button variant="secondary" onClick={onClose} disabled={busy}>{tr('Annuler')}</Button><Button loading={busy} onClick={go}>{approve ? tr('Valider') : tr('Rejeter')}</Button></>}>
      {approve
        ? <p>{report.kind === 'financier' ? tr('Le montant réalisé ({amount}) sera comptabilisé dans la consommation du budget Suivi/TPM du contrat.', { amount: formatAr(report.reportedAmount || 0) }) : tr('Le rapport technique sera marqué comme validé.')}</p>
        : <p>{tr('Le rapport repassera à corriger côté TPM.')}</p>}
      <Field label={approve ? tr('Commentaire') : tr('Motif du rejet')} htmlFor="dc-comment" required={!approve} error={touched && !approve && !comment.trim() ? tr('Motif obligatoire.') : undefined}>
        <textarea id="dc-comment" className="input" value={comment} onChange={(e) => setComment(e.target.value)} />
      </Field>
    </Modal>
  );
}
