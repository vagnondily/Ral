import React, { useEffect, useMemo, useState } from 'react';
import {
  Plus, Wallet, Info, Search, SlidersHorizontal, Columns3, Save, Clock, RotateCcw,
  Download, Printer, Trash2, ChevronLeft, ChevronRight, ExternalLink, FileText,
} from 'lucide-react';
import { api } from '../../api/client.js';
import { Alert, Button, Card, EmptyState, IconButton, Skeleton, StatusBadge, Stats } from '../../components/ui.jsx';
import PlanBudgetDrawer from './PlanBudgetDrawer.jsx';
import DeleteDialog from '../../components/DeleteDialog.jsx';
import PeriodSelect from '../../components/PeriodSelect.jsx';
import { usePopover, SortTh, makeViewStore } from '../../components/listView.jsx';
import { useToast } from '../../components/Toast.jsx';
import { currentMonth, formatAr, formatInt, monthLabel } from '../../lib/format.js';
import { formatUsdCents, formatUsdFor, sumUsdCents } from '../../lib/currency.js';
import { richText } from '../../lib/contracts.js';
import { useI18n } from '../../lib/i18n.jsx';
import { downloadCsv } from '../../lib/csv.js';
import { overlaps, periodFromSaved, periodLabel, single } from '../../lib/period.js';

const PLAN_STATUS = { brouillon: { label: 'Brouillon', tone: 'yellow', icon: 'draft' }, valide: { label: 'Validé', tone: 'green', icon: 'check' } };
const STATUSES = [{ id: '', label: 'Tous les statuts' }, { id: 'brouillon', label: 'Brouillon' }, { id: 'valide', label: 'Validé' }];
const PAGE_SIZE = 12;
const viewStore = makeViewStore('mems.planning.view');

// La « Période » vit dans la barre de filtres : une plage « du … au … » (lot 1b, retour 47),
// comme Rapports & dépenses ; un plan (un mois) est retenu si son mois tombe dans la plage.
const FILTERS = {
  q:        { label: 'Recherche', type: 'search', ph: 'Prestataire, contrat, intitulé…' },
  period:   { label: 'Période', type: 'period' },
  partnerId: { label: 'Prestataire', type: 'select' },
  contractId: { label: 'Contrat', type: 'select' },
  status:   { label: 'Statut', type: 'select' },
};
const ALL_FILTERS = ['q', 'period', 'partnerId', 'contractId', 'status'];
const DEFAULT_FILTERS = ['period', 'q', 'partnerId', 'status'];

const COLUMNS = {
  partner:  { label: 'Prestataire TPM', sort: 'partner' },
  contract: { label: 'Contrat', sort: 'contract' },
  period:   { label: 'Période', sort: 'period' },
  title:    { label: 'Intitulé' },
  funder:   { label: 'Planifié (bailleur)', num: true, sort: 'funder' },
  total:    { label: 'Total prévu', num: true, sort: 'total' },
  status:   { label: 'Statut', sort: 'status' },
};
const ALL_COLUMNS = Object.keys(COLUMNS);
const DEFAULT_COLUMNS = ['partner', 'contract', 'period', 'title', 'funder', 'total', 'status'];
const emptyValues = () => ({ q: '', period: single(currentMonth()), partnerId: '', contractId: '', status: '' });
// Vue enregistrée : une ancienne période « AAAA-MM » est relue comme { from: v, to: v }, jamais rejetée.
const readSaved = (values) => ({ ...values, period: periodFromSaved(values.period) });

/**
 * Planification & budget — budgets prévisionnels des vagues de collecte, façon
 * COMET (filtres, colonnes, tri, pagination, vue Ar/USD). La part bailleur
 * alimente le « Planifié » de la consolidation et pré-remplit la facture.
 */
export default function PlanningPage({ canEdit, isAdmin = false, onNavigate }) {
  const { tr, lang } = useI18n();
  const toast = useToast();
  const [context, setContext] = useState(null);
  const [plans, setPlans] = useState(null);
  const [rates, setRates] = useState([]);
  const [error, setError] = useState(null);
  const [drawer, setDrawer] = useState(null);

  const saved = viewStore.initial();
  const [values, setValues] = useState(() => readSaved({ ...emptyValues(), ...(saved?.values || {}) }));
  const [shownFilters, setShownFilters] = useState(() => saved?.shownFilters || DEFAULT_FILTERS);
  const [columns, setColumns] = useState(() => saved?.columns || DEFAULT_COLUMNS);
  const [sort, setSort] = useState(() => saved?.sort || { key: 'partner', dir: 'asc' });
  const [currency, setCurrency] = useState('Ar');
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState(null);
  const [del, setDel] = useState(null); // plan à supprimer (retour 56)

  const filterMenu = usePopover();
  const colMenu = usePopover();

  // Mois de référence (nouveau plan) = le DERNIER mois de la période choisie, sinon le mois courant.
  const period = values.period && values.period.from ? values.period : null;
  const month = period ? period.to : currentMonth();

  async function reload() {
    setError(null);
    try {
      // Tous les plans (toutes périodes) ; la période se filtre dans le tableau.
      const [ctx, list] = await Promise.all([api.reportsContext(), api.listPlans({})]);
      setContext(ctx); setPlans(list);
    } catch (err) { setError(err.message); setPlans((p) => p || []); }
  }
  useEffect(() => { reload(); /* eslint-disable-next-line */ }, []);
  useEffect(() => { api.listExchangeRates().then(setRates).catch(() => setRates([])); }, []);

  const shown = ALL_FILTERS.filter((k) => shownFilters.includes(k));
  const cols = ALL_COLUMNS.filter((k) => columns.includes(k));
  // Chiffres clés : plans de la période choisie (toutes les périodes si le filtre est masqué ou vide).
  const periodShown = shown.includes('period') ? period : null;
  const stats = useMemo(() => {
    const list = (plans || []).filter((p) => overlaps(periodShown, p.periodMonth));
    // En dollars : chaque plan au taux de SON mois, en cents entiers (= somme des cellules).
    const usd = (key) => sumUsdCents(list.map((p) => ({ amountAr: p[key] || 0, period: p.periodMonth })), rates);
    return {
      count: list.length,
      planned: list.reduce((n, p) => n + (p.plannedFunder || 0), 0),
      total: list.reduce((n, p) => n + (p.plannedTotal || 0), 0),
      plannedUsdCents: usd('plannedFunder'),
      totalUsdCents: usd('plannedTotal'),
      valides: list.filter((p) => p.status === 'valide').length,
    };
  }, [plans, periodShown, rates]);

  const filtered = useMemo(() => {
    let list = plans || [];
    list = list.filter((p) => shown.every((k) => {
      const v = values[k];
      if (!v) return true;
      switch (k) {
        case 'q': { const q = v.toLowerCase(); return [p.partnerName, p.contractPartner, p.contractNumero, p.title].some((x) => x && String(x).toLowerCase().includes(q)); }
        case 'period': return overlaps(v, p.periodMonth);
        case 'partnerId': return p.partnerId === v;
        case 'contractId': return p.contractId === v;
        case 'status': return p.status === v;
        default: return true;
      }
    }));
    const val = (p) => ({
      partner: p.partnerName || '', contract: p.contractPartner || '', period: p.periodMonth || '',
      funder: p.plannedFunder || 0, total: p.plannedTotal || 0,
      status: ['brouillon', 'valide'].indexOf(p.status),
    }[sort.key]);
    return [...list].sort((a, b) => {
      const va = val(a); const vb = val(b);
      const cmp = typeof va === 'number' ? va - vb : String(va).localeCompare(String(vb));
      return sort.dir === 'asc' ? cmp : -cmp;
    });
  }, [plans, values, shown, sort]);

  const sig = JSON.stringify({ values, shownFilters, sort });
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
  function resetView() { setValues(emptyValues()); viewStore.clear(); toast.info(tr('Filtres réinitialisés.')); }

  // Plans par mois (sélecteur de période : volume par mois, dernier mois avec des plans).
  const planCounts = useMemo(() => {
    const out = {};
    for (const p of plans || []) if (p.periodMonth) { const m = String(p.periodMonth).slice(0, 7); out[m] = (out[m] || 0) + 1; }
    return out;
  }, [plans]);
  const latestPlan = useMemo(() => {
    const ms = Object.keys(planCounts).filter((m) => m <= currentMonth()).sort();
    return ms.length ? ms[ms.length - 1] : null;
  }, [planCounts]);

  function optionsFor(k) {
    switch (k) {
      case 'partnerId': return [{ id: '', label: tr('Tous les prestataires') }, ...(context?.partners || []).map((p) => ({ id: p.id, label: p.name }))];
      case 'contractId': return [{ id: '', label: tr('Tous les contrats') }, ...(context?.contracts || []).map((c) => ({ id: c.id, label: `${c.partnerName} · ${c.numero}` }))];
      case 'status': return STATUSES.map((s) => ({ ...s, label: tr(s.label) }));
      default: return [];
    }
  }

  // Une cellule en dollars : au taux du mois de SON plan.
  const money = (ar, planMonth) => (currency === 'USD' ? formatUsdFor(ar, rates, planMonth) : formatAr(ar));
  const hasRates = rates.length > 0;

  // Suppression (retour 56) : dialogue commun (justificatif si plan validé).
  function remove(p) { setDel(p); }
  // Fil guidé : passe le relais à « Rapports & dépenses » qui ouvrira une
  // facture pré-remplie depuis ce plan (même contrat + mois).
  function createFacture(p) {
    // Le mois de la facture est celui du PLAN (la période filtrée peut couvrir plusieurs mois).
    const planMonth = p.periodMonth ? String(p.periodMonth).slice(0, 7) : month;
    try { sessionStorage.setItem('mems.tpm.newFacture', JSON.stringify({ contractId: p.contractId, partnerId: p.partnerId, month: planMonth })); } catch { /* ignore */ }
    if (onNavigate) onNavigate('tpm', 'rapports'); else toast.info(tr('Ouvrez « Rapports & dépenses » pour créer la facture.'));
  }

  function exportCsv() {
    const head = cols.map((k) => tr(COLUMNS[k].label));
    const cell = (p, k) => ({
      partner: p.partnerName, contract: `${p.contractPartner} (${p.contractNumero})`, title: p.title || '',
      period: p.periodMonth ? String(p.periodMonth).slice(0, 7) : '',
      funder: currency === 'USD' ? money(p.plannedFunder, p.periodMonth) : Math.round(p.plannedFunder || 0),
      total: currency === 'USD' ? money(p.plannedTotal, p.periodMonth) : Math.round(p.plannedTotal || 0),
      status: PLAN_STATUS[p.status] ? tr(PLAN_STATUS[p.status].label) : p.status,
    }[k]);
    const scope = periodShown ? `${periodShown.from}_${periodShown.to}` : 'toutes';
    downloadCsv(`plans_${scope}.csv`, [head, ...filtered.map((p) => cols.map((k) => cell(p, k)))]);
  }

  function renderCell(p, k) {
    switch (k) {
      case 'partner': return <strong>{p.partnerName}</strong>;
      case 'contract': return <>{p.contractPartner}<div className="site-meta mono">{p.contractNumero}</div></>;
      case 'period': return <span className="tabular">{p.periodMonth ? monthLabel(String(p.periodMonth).slice(0, 7)) : '—'}</span>;
      case 'title': return p.title || <span className="cell-empty">—</span>;
      case 'funder': return money(p.plannedFunder, p.periodMonth);
      case 'total': return money(p.plannedTotal, p.periodMonth);
      case 'status': return <StatusBadge def={PLAN_STATUS[p.status]} />;
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
            counts={planCounts} countLabel="{n} plan(s) sur la période" latest={latestPlan} ariaLabel={tr(f.label)} />
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
          <h1 className="page-title">{tr('Planification & budget')}</h1>
          <p className="page-desc">{tr('Budget prévisionnel des vagues de collecte : postes prévus par prestataire et contrat. La part bailleur alimente le « Planifié » de la consolidation et sert de base à la facture.')}</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {canEdit && <Button icon={Plus} onClick={() => setDrawer({})}>{tr('Nouveau plan')}</Button>}
        </div>
      </div>

      <Stats items={[
        { label: periodShown ? tr('Plans de la période') : tr('Plans'), value: plans ? stats.count : '—',
          foot: periodShown ? `${periodLabel(periodShown, lang)} · ${tr('{n} validé(s)', { n: stats.valides })}` : tr('{n} validé(s)', { n: stats.valides }) },
        { label: tr('Planifié (part bailleur)'), value: plans ? (currency === 'USD' ? formatUsdCents(stats.plannedUsdCents) : formatInt(stats.planned)) : '—', suffix: currency === 'USD' ? '' : 'Ar', foot: tr('Alimente la consolidation') },
        { label: tr('Budget total prévu'), value: plans ? (currency === 'USD' ? formatUsdCents(stats.totalUsdCents) : formatInt(stats.total)) : '—', suffix: currency === 'USD' ? '' : 'Ar', foot: tr('Bailleur + ONG') },
        { label: tr('Contrats couverts'), value: context ? context.contracts.length : '—', foot: tr('Avec budget Suivi/TPM') },
      ]} />

      <Card>
        <div className="filters-bar comet-filters">
          <span className="filters-label">{tr('Filtres\u00a0:')}</span>
          <div className="comet-fields">
            {shown.map(renderFilter)}
            {shown.length === 0 && <span className="filters-empty">{tr('Aucun filtre actif — ajoutez-en avec l\'icône filtres.')}</span>}
          </div>
          <div className="comet-icons">
            <div className="seg" role="group" aria-label={tr('Devise d\'affichage')}>
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
            <IconButton icon={Clock} label={tr('Mémoriser le filtre (temporaire)')} variant="secondary" size="sm" onClick={() => { viewStore.saveTemp(currentPayload()); toast.success(tr('Filtre mémorisé pour cette session.')); }} />
            <IconButton icon={Save} label={tr('Mémoriser le filtre (permanent)')} variant="secondary" size="sm" onClick={() => { viewStore.savePerm(currentPayload()); toast.success(tr('Filtre enregistré comme vue par défaut.')); }} />
            <IconButton icon={RotateCcw} label={tr('Réinitialiser')} variant="secondary" size="sm" onClick={resetView} />
          </div>
        </div>

        <div className="data-toolbar">
          <div className="data-toolbar-left">
            {selected && <Button size="sm" variant="secondary" icon={ExternalLink} onClick={() => setDrawer({ planId: selected.id })}>{tr('Ouvrir / éditer')}</Button>}
            {canEdit && selected && <Button size="sm" variant="secondary" icon={FileText} onClick={() => createFacture(selected)}
              title={tr('Ouvre une facture pré-remplie depuis ce plan (Rapports & dépenses).')}>{tr('Créer la facture')}</Button>}
            {canEdit && selected && (selected.status !== 'valide' || isAdmin) && <Button size="sm" variant="ghost" icon={Trash2} onClick={() => remove(selected)}>{tr('Supprimer')}</Button>}
            {selected && <Button size="sm" variant="ghost" icon={ExternalLink} onClick={() => setSelectedId(null)} style={{ display: 'none' }} />}
          </div>
          <div className="data-toolbar-right">
            <Button size="sm" variant="secondary" icon={Printer} onClick={() => window.print()} disabled={!(plans && plans.length)}>{tr('Imprimer')}</Button>
            <Button size="sm" variant="secondary" icon={Download} onClick={exportCsv} disabled={!(plans && plans.length)}>{tr('Exporter (CSV)')}</Button>
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
              {plans === null
                ? [0, 1, 2].map((i) => <tr key={i} aria-hidden="true"><td /><td colSpan={cols.length}><Skeleton height={18} /></td></tr>)
                : pageRows.map((p) => {
                    const isSel = selectedId === p.id;
                    return (
                      <tr key={p.id} className={`clickable ${isSel ? 'is-selected' : ''}`} onClick={() => setSelectedId(p.id)} onDoubleClick={() => setDrawer({ planId: p.id })}>
                        <td onClick={(e) => e.stopPropagation()}>
                          <input type="radio" name="plan-select" checked={isSel} onChange={() => setSelectedId(isSel ? null : p.id)} aria-label={tr('Sélectionner {name}', { name: p.partnerName })} />
                        </td>
                        {cols.map((k) => <td key={k} className={COLUMNS[k].num ? 'num tabular' : ''}>{renderCell(p, k)}</td>)}
                      </tr>
                    );
                  })}
            </tbody>
          </table>
          {plans && filtered.length === 0 && (
            <EmptyState icon={Wallet} title={plans.length ? tr('Aucun plan ne correspond') : tr('Aucun plan ce mois-ci')}
              action={canEdit && (plans.length === 0
                ? <Button icon={Plus} onClick={() => setDrawer({})}>{tr('Nouveau plan')}</Button>
                : <Button variant="secondary" icon={RotateCcw} onClick={resetView}>{tr('Réinitialiser les filtres')}</Button>)}>
              {plans.length ? tr('Ajustez les filtres.') : tr("Créez le budget prévisionnel d'une vague de collecte pour pré-remplir la facture ensuite.")}
            </EmptyState>
          )}
        </div>

        {plans && filtered.length > 0 && (
          <div className="list-foot">
            <span className="list-count">{tr(filtered.length > 1 ? '{a}–{b} sur {n} plans' : '{a}–{b} sur {n} plan', { a: (pageClamped - 1) * PAGE_SIZE + 1, b: Math.min(pageClamped * PAGE_SIZE, filtered.length), n: filtered.length })}</span>
            <div className="pager">
              <button type="button" className="pager-btn" disabled={pageClamped <= 1} onClick={() => setPage(pageClamped - 1)} aria-label={tr('Page précédente')}><ChevronLeft size={16} /></button>
              <span className="pager-info">{tr('Page {p} / {t}', { p: pageClamped, t: totalPages })}</span>
              <button type="button" className="pager-btn" disabled={pageClamped >= totalPages} onClick={() => setPage(pageClamped + 1)} aria-label={tr('Page suivante')}><ChevronRight size={16} /></button>
            </div>
          </div>
        )}
      </Card>

      <div className="note"><Info size={18} aria-hidden="true" /><span>{richText(tr('La <strong>part bailleur</strong> des postes prévus est le « Planifié » comparé au budget de suivi. Depuis une facture, « Pré-remplir depuis le plan » reprend ces postes. Bascule <strong>Ar/USD</strong> selon les taux de Paramétrage.'))}</span></div>

      {drawer && <PlanBudgetDrawer planId={drawer.planId} context={context} month={month} onClose={() => setDrawer(null)} onSaved={() => { setDrawer(null); reload(); }} />}
      {del && (
        <DeleteDialog
          open
          validated={del.status === 'valide'}
          title={tr('Supprimer ce plan de collecte ?')}
          description={`${del.partnerName} · ${del.contractNumero || ''} · ${monthLabel((del.periodMonth || '').slice(0, 7))}`}
          onClose={() => setDel(null)}
          onConfirm={(justification) => api.deletePlan(del.id, justification)}
          onDone={() => { toast.success(tr('Plan supprimé.')); setDel(null); setSelectedId(null); reload(); }}
        />
      )}
    </div>
  );
}
