import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Upload, Plus, MapPin, CheckCircle2, CalendarClock, Ban, UserPlus, Trash2, Wand2, ChevronLeft, ChevronRight, ChevronRight as GoIcon, Filter, CircleDashed, Clock, MinusCircle } from 'lucide-react';
import { api } from '../../api/client.js';
import { Alert, Button, PageHeader, Skeleton } from '../../components/ui.jsx';
import DataList from '../../components/DataList.jsx';
import Modal from '../../components/Modal.jsx';
import { useToast } from '../../components/Toast.jsx';
import { currentMonth, formatInt, monthLabel } from '../../lib/format.js';

const STATUS = {
  planifie: { label: 'Planifiée', color: 'var(--blue-600)', Icon: CalendarClock },
  realise: { label: 'Réalisée', color: 'var(--green)', Icon: CheckCircle2 },
  annule: { label: 'Annulée', color: 'var(--text-faint)', Icon: Ban },
};
// Situation (workflow) du plan mensuel.
const PLAN_STATUS = {
  vide: { label: 'Aucun plan', bg: 'var(--surface-2)', text: 'var(--text-faint)', Icon: CircleDashed },
  draft: { label: 'Brouillon', bg: 'var(--surface-2)', text: 'var(--text-muted)', Icon: CircleDashed },
  soumis: { label: 'Soumis', bg: 'var(--orange-bg)', text: 'var(--orange-text)', Icon: Clock },
  valide: { label: 'Validé', bg: 'var(--green-bg)', text: 'var(--green-text)', Icon: CheckCircle2 },
  annule: { label: 'Annulé', bg: 'var(--red-bg)', text: 'var(--red-text)', Icon: Ban },
  non_applicable: { label: 'Non applicable', bg: 'var(--surface-2)', text: 'var(--text-muted)', Icon: MinusCircle },
};
const PlanBadge = ({ status }) => {
  const s = PLAN_STATUS[status] || PLAN_STATUS.vide;
  const I = s.Icon;
  return <span className="badge" style={{ background: s.bg, color: s.text }}>{I && <I size={13} aria-hidden="true" className="badge-ic" />}{s.label}</span>;
};
// Rôles génériques (non nominatifs) : le bureau affecte un créneau (Agent 1,
// Superviseur 1…) ; le prestataire TPM y met ensuite une personne en interne.
const ROLES = ['Agent 1', 'Agent 2', 'Agent 3', 'Agent 4', 'Superviseur 1', 'Superviseur 2', 'Coordinateur'];

/**
 * Suivi terrain — outil du responsable S&E. Deux temps :
 *  1) Planification générale : le bureau recense les sites à visiter dans le
 *     mois (district › commune › établissement › activité).
 *  2) Affectation : chaque visite est confiée à un prestataire TPM et à un
 *     rôle générique (Agent 1 / Superviseur 1, non nominatif) — l'assignation
 *     se fait donc APRÈS la planification.
 * La réalisation alimente la couverture (réalisées / planifiées).
 */
export default function FieldVisitsPage({ canEdit }) {
  const toast = useToast();
  const [month, setMonth] = useState(currentMonth);
  const [visits, setVisits] = useState(null);
  const [summary, setSummary] = useState(null);
  const [collDays, setCollDays] = useState([]);
  const [rbmDue, setRbmDue] = useState(null); // nb de sites « à suivre » ce mois selon le RBM
  const [providers, setProviders] = useState([]);
  const [error, setError] = useState(null);
  const [importing, setImporting] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [view, setView] = useState('plan');          // 'plan' | 'couverture' | 'donnees'
  const [subs, setSubs] = useState(null);             // données réelles (soumissions) du mois
  // Navigation par TABLEAU des mois : on choisit l'année, on voit un mois par
  // ligne avec ses stats, on clique un mois pour ouvrir son plan.
  const [year, setYear] = useState(() => Number(currentMonth().slice(0, 4)));
  const [monthsData, setMonthsData] = useState(null);
  const [picking, setPicking] = useState(true);      // true = tableau des mois ; false = plan d'un mois
  const [statusFilter, setStatusFilter] = useState(''); // filtre « situation » du tableau des mois
  const fileRef = useRef(null);

  useEffect(() => { setMonthsData(null); api.fieldMonths(year).then(setMonthsData).catch(() => setMonthsData({ year, months: [] })); }, [year]);

  const reload = useCallback(() => {
    setVisits(null);
    Promise.all([api.fieldVisits({ month }), api.fieldSummary(month), api.fieldCollectionDays(month)])
      .then(([v, s, c]) => { setVisits(v); setSummary(s); setCollDays(c); })
      .catch((e) => setError(e.message));
    // Combien de sites sont « à suivre » ce mois d'après le RBM (indicatif, non bloquant).
    api.rbmSites(month).then((rows) => setRbmDue(rows.filter((r) => r.due).length)).catch(() => setRbmDue(null));
    // Rafraîchit les stats par mois (le tableau des mois).
    api.fieldMonths(month.slice(0, 4)).then(setMonthsData).catch(() => {});
  }, [month]);

  useEffect(() => { reload(); }, [reload]);
  useEffect(() => { api.listProviders().then((p) => setProviders(p.map((x) => ({ id: x.id, name: x.name })))).catch(() => setProviders([])); }, []);
  // Données réelles du mois (chargées à l'ouverture de l'onglet).
  useEffect(() => {
    if (picking || view !== 'donnees') return;
    setSubs(null);
    api.monSubmissions(month).then(setSubs).catch(() => setSubs([]));
  }, [picking, view, month]);

  async function onImport(e) {
    const f = e.target.files?.[0]; e.target.value = '';
    if (!f) return;
    setImporting(true);
    try {
      const r = await api.fieldImportPlanning(f, month);
      toast.success(`${r.visitsCreated} visite(s) planifiée(s) · ${r.sitesTotal} site(s).`);
      reload();
    } catch (err) { toast.error(err.message); } finally { setImporting(false); }
  }

  const patch = async (v, body) => {
    try { await api.fieldUpdateVisit(v.id, body); reload(); }
    catch (err) { toast.error(err.message); }
  };
  const remove = async (v) => {
    if (!window.confirm(`Supprimer la visite de « ${v.siteName} » ?`)) return;
    try { await api.fieldDeleteVisit(v.id); reload(); } catch (err) { toast.error(err.message); }
  };
  // Génère la planification du mois à partir du RBM : chaque site « à suivre »
  // (jamais visité ou échéance atteinte) devient une visite planifiée. Même
  // action que sur la page RBM — proposée ici pour partir du RBM sans quitter
  // la planification. L'affectation (prestataire + rôle) se fait ensuite.
  const generateFromRbm = async () => {
    setGenerating(true);
    try {
      const r = await api.rbmGenerate(month);
      if (r.created > 0) toast.success(`${r.created} visite(s) planifiée(s) sur ${r.due} site(s) à suivre (RBM).`);
      else toast.info(`Aucune nouvelle visite : les ${r.due} site(s) à suivre sont déjà planifiés.`);
      reload();
    } catch (err) { toast.error(err.message); } finally { setGenerating(false); }
  };
  const setTravel = async (providerId, travelDays) => {
    try { await api.fieldSetTravelDays({ providerId, month, travelDays: Math.max(0, Math.round(Number(travelDays) || 0)) }); reload(); }
    catch (err) { toast.error(err.message); }
  };
  const monthStart = `${month}-01`;
  const monthEnd = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).toISOString().slice(0, 10);

  const communeCount = useMemo(() => new Set((visits || []).map((v) => `${v.district} › ${v.commune}`)).size, [visits]);
  const ov = summary?.overall;
  const unassigned = (visits || []).filter((v) => !v.providerId).length;

  // Colonnes & filtres de la grille de planification (liste façon COMET).
  const columns = useMemo(() => {
    const c = {
      site: { label: 'Site (établissement)', sortVal: (v) => v.siteName, csv: (v) => v.siteName,
        render: (v) => <><strong>{v.siteName}</strong>{v.fokontany && <div className="site-meta">{v.fokontany}</div>}</> },
      zone: { label: 'District / Commune', sortVal: (v) => `${v.district || ''} ${v.commune || ''}`, csv: (v) => `${v.district || ''} / ${v.commune || ''}`,
        render: (v) => <>{v.district || '—'} › {v.commune || '—'}</> },
      activity: { label: 'Activité', sortVal: (v) => v.activity || '', csv: (v) => v.activity || '',
        render: (v) => v.activity || '—' },
      provider: { label: 'Prestataire TPM', sortVal: (v) => v.providerName || '', csv: (v) => v.providerName || '',
        render: (v) => (canEdit
          ? <select className={`select ${v.providerId ? '' : 'is-empty'}`} style={{ minWidth: 150 }} value={v.providerId || ''} onChange={(e) => patch(v, { providerId: e.target.value || '' })} aria-label="Prestataire">
              <option value="">— Non affecté —</option>{providers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
          : (v.providerName || '—')) },
      role: { label: 'Rôle', sortVal: (v) => v.agent || '', csv: (v) => v.agent || '',
        render: (v) => (canEdit
          ? <select className={`select ${v.agent ? '' : 'is-empty'}`} style={{ minWidth: 130 }} value={v.agent || ''} onChange={(e) => patch(v, { agent: e.target.value })} aria-label="Rôle">
              <option value="">— Rôle —</option>{ROLES.map((r) => <option key={r} value={r}>{r}</option>)}{v.agent && !ROLES.includes(v.agent) && <option value={v.agent}>{v.agent}</option>}</select>
          : (v.agent || '—')) },
      visitDate: { label: 'Date de visite', sortVal: (v) => v.visitDate || '', csv: (v) => v.visitDate || '',
        render: (v) => (canEdit
          ? <input className="input" style={{ width: 150 }} type="date" min={monthStart} max={monthEnd} value={v.visitDate || ''} onChange={(e) => e.target.value && patch(v, { visitDate: e.target.value })} aria-label="Date de visite" />
          : (v.visitDate || '—')) },
      dataVisit: { label: 'Dernière collecte (données)', sortVal: (v) => v.dataVisitMonth || '', csv: (v) => v.dataVisitMonth || '',
        render: (v) => (v.dataVisitMonth
          ? <span className="tabular">{v.dataVisitMonth}</span>
          : <span className="muted" title="Aucune donnée réelle rattachée à la commune de ce site (pcode).">—</span>) },
      status: { label: 'Statut', sortVal: (v) => v.status, csv: (v) => STATUS[v.status]?.label || v.status,
        render: (v) => (canEdit
          ? <div className="seg" role="group" aria-label="Statut">{Object.entries(STATUS).map(([k, s]) => <button type="button" key={k} className={v.status === k ? 'is-active' : ''} onClick={() => patch(v, { status: k })} title={s.label}>{s.label}</button>)}</div>
          : (() => { const S = STATUS[v.status]; const I = S?.Icon; return <span className="badge">{I && <I size={13} aria-hidden="true" className="badge-ic" style={{ color: S.color }} />}{S?.label}</span>; })()) },
    };
    if (canEdit) c.action = { label: '', width: 48, csv: () => '', render: (v) => <Button size="sm" variant="ghost" icon={Trash2} aria-label="Supprimer" onClick={() => remove(v)} /> };
    return c;
  }, [canEdit, providers, monthStart, monthEnd]); // eslint-disable-line

  const filters = useMemo(() => ({
    q: { label: 'Recherche', type: 'search', placeholder: 'Site, commune, district…',
      match: (v, val) => [v.siteName, v.commune, v.district, v.activity].some((x) => x && String(x).toLowerCase().includes(val.toLowerCase())) },
    provider: { label: 'Prestataire', type: 'select',
      options: [{ id: '', label: 'Tous les prestataires' }, { id: 'non_affecte', label: '— Non affectés —' }, ...providers.map((p) => ({ id: p.id, label: p.name }))],
      match: (v, val) => (val === 'non_affecte' ? !v.providerId : v.providerId === val) },
    status: { label: 'Statut', type: 'select',
      options: [{ id: '', label: 'Tous les statuts' }, ...Object.entries(STATUS).map(([k, s]) => ({ id: k, label: s.label }))],
      match: (v, val) => v.status === val },
  }), [providers]);

  const openMonth = (mm) => { setMonth(mm); setPicking(false); setView('plan'); };
  const setMonthStatus = async (status) => {
    try { await api.fieldSetMonthStatus(month, status); toast.success(`Situation : ${PLAN_STATUS[status].label}.`); reload(); }
    catch (e) { toast.error(e.message); }
  };
  const activeStatus = (monthsData?.months || []).find((m) => m.month === month)?.status || 'vide';

  return (
    <div className="page">
      <PageHeader title="Affectation & visites de terrain"
        description={picking
          ? "L'écran unique du suivi terrain : planifiez les visites du mois (depuis le RBM), affectez les prestataires TPM, suivez les jours/budget, la couverture et les données réelles. Choisissez un mois pour ouvrir son plan."
          : "Les sites à visiter ce mois (district › commune › établissement › activité) : affectez le prestataire TPM et le rôle, datez les visites ; les onglets couvrent le budget-jours, la couverture et les données réelles."}>
        {!picking && <Button variant="secondary" icon={ChevronLeft} onClick={() => setPicking(true)}>Tous les mois</Button>}
        {!picking && canEdit && <><input ref={fileRef} type="file" accept=".xlsx" hidden onChange={onImport} />
          <Button variant="secondary" icon={Wand2} loading={generating} onClick={generateFromRbm}
            title="Planifie automatiquement les sites « à suivre » ce mois d'après leur niveau de risque (RBM).">
            Générer depuis le RBM{rbmDue ? ` (${rbmDue})` : ''}</Button>
          <Button variant="secondary" icon={Upload} loading={importing} onClick={() => fileRef.current?.click()}>Importer planning</Button>
          <Button icon={Plus} onClick={() => setAddOpen(true)}>Ajouter une visite</Button></>}
      </PageHeader>

      {error && <Alert tone="error">{error}</Alert>}

      {picking && <MonthsTable data={monthsData} year={year} setYear={setYear} current={currentMonth()} onOpen={openMonth}
        statusFilter={statusFilter} setStatusFilter={setStatusFilter} />}

      {!picking && <>
      <div className="month-active-bar">
        <strong>{monthLabel(month)}</strong>
        <span className="muted">— plan de visites du mois</span>
        <PlanBadge status={activeStatus} />
        {canEdit && (
          <span className="month-status-actions">
            {['vide', 'draft', 'annule', 'non_applicable'].includes(activeStatus) && <Button size="sm" variant="secondary" onClick={() => setMonthStatus('soumis')}>Soumettre</Button>}
            {activeStatus === 'soumis' && <><Button size="sm" variant="secondary" icon={CheckCircle2} onClick={() => setMonthStatus('valide')}>Valider</Button><Button size="sm" variant="ghost" onClick={() => setMonthStatus('draft')}>Repasser en brouillon</Button></>}
            {activeStatus === 'valide' && <Button size="sm" variant="ghost" onClick={() => setMonthStatus('draft')}>Rouvrir</Button>}
            {!['non_applicable'].includes(activeStatus) && <Button size="sm" variant="ghost" icon={Ban} onClick={() => setMonthStatus('non_applicable')}>Non applicable</Button>}
            {!['annule', 'vide'].includes(activeStatus) && <Button size="sm" variant="ghost" onClick={() => setMonthStatus('annule')}>Annuler le plan</Button>}
          </span>
        )}
      </div>

      {/* Deux vues : la grille de planification (simple, par défaut) et la couverture (analytique). */}
      <div className="seg" role="group" aria-label="Vue" style={{ marginBottom: 4 }}>
        <button type="button" className={view === 'plan' ? 'is-active' : ''} onClick={() => setView('plan')}>Planification</button>
        <button type="button" className={view === 'couverture' ? 'is-active' : ''} onClick={() => setView('couverture')}>Couverture &amp; budget</button>
        <button type="button" className={view === 'donnees' ? 'is-active' : ''} onClick={() => setView('donnees')}>Données réelles</button>
      </div>

      {view === 'couverture' && <>
        {ov && (
          <div className="biz-kpis" style={{ gridTemplateColumns: 'repeat(5, minmax(0,1fr))' }}>
            <Kpi icon={MapPin} tone="blue" label="Sites du mois" value={formatInt(ov.total)} foot={`${communeCount} commune(s)`} />
            <Kpi icon={UserPlus} tone={unassigned ? 'amber' : 'green'} label="À affecter" value={formatInt(unassigned)} foot="Sans prestataire" />
            <Kpi icon={CalendarClock} tone="blue" label="Planifiées" value={formatInt(ov.planifie)} foot="À réaliser" />
            <Kpi icon={CheckCircle2} tone="green" label="Réalisées" value={formatInt(ov.realise)} foot={`${Math.round(ov.rate * 100)} % de couverture`} />
            <Kpi icon={Ban} tone="red" label="Annulées" value={formatInt(ov.annule)} foot="Exclues du taux" />
          </div>
        )}
        <div className="biz-grid" style={{ gridTemplateColumns: 'repeat(2, minmax(0,1fr))' }}>
          {summary?.byProvider?.length > 0 && <CoverageCard title="Couverture par prestataire" rows={summary.byProvider} />}
          {summary?.byDistrict?.length > 0 && <CoverageCard title="Couverture par district" rows={summary.byDistrict} />}
        </div>
        {collDays.length > 0 && (
          <div className="card biz-card" style={{ marginTop: 16 }}>
            <div className="card-header"><div className="card-title">Jours de collecte (pour le budget)</div>
              <div className="card-sub">Jours de visite = visites datées ; + jours de déplacement (saisie manuelle) = total des jours à budgéter par prestataire.</div></div>
            <div className="table-wrap"><table className="table">
              <thead><tr><th>Prestataire TPM</th><th className="num">Jours de visite</th><th className="num">Jours de déplacement</th><th className="num">Total jours</th></tr></thead>
              <tbody>
                {collDays.map((d) => (
                  <tr key={d.providerId}>
                    <td><strong>{d.label}</strong></td>
                    <td className="num tabular">{formatInt(d.visitDays)}</td>
                    <td className="num">
                      {canEdit ? (
                        <input className="input tabular" style={{ width: 70, textAlign: 'right' }} type="number" min="0" step="1"
                          defaultValue={d.travelDays} aria-label={`Jours de déplacement ${d.label}`}
                          onBlur={(e) => { if (Number(e.target.value) !== d.travelDays) setTravel(d.providerId, e.target.value); }} />
                      ) : formatInt(d.travelDays)}
                    </td>
                    <td className="num tabular"><strong>{formatInt(d.totalDays)}</strong></td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          </div>
        )}
      </>}

      {view === 'plan' && (
        <DataList
          rows={visits} columns={columns} defaultColumns={['site', 'zone', 'activity', 'provider', 'role', 'visitDate', 'dataVisit', 'status', ...(canEdit ? ['action'] : [])]}
          filters={filters} defaultFilters={['q', 'provider', 'status']}
          storageKey="mems.fieldvisits.view.v2" pageSize={15} defaultSort={{ key: 'zone', dir: 'asc' }}
          csvName={`visites_${month}.csv`} emptyIcon={MapPin} emptyTitle="Aucune visite ce mois-ci"
          emptyAction={canEdit && rbmDue > 0 && <Button icon={Wand2} loading={generating} onClick={generateFromRbm}>Générer {rbmDue} visite(s) depuis le RBM</Button>}
          emptyChildren={`Générez la planification depuis le RBM${rbmDue ? ` (${rbmDue} site(s) à suivre)` : ''}, importez le planning (.xlsx) ou ajoutez une visite.`}
        />
      )}

      {view === 'donnees' && (
        <div className="card biz-card">
          <div className="card-header">
            <div className="card-title">Données réelles — {monthLabel(month)}</div>
            <div className="card-sub">Soumissions de suivi réellement collectées ce mois (données uploadées). La commune est résolue depuis le référentiel de sites via le pcode — c'est cette liaison qui alimente la « dernière collecte » du plan et du RBM.</div>
          </div>
          {subs === null ? (
            <div className="card-body"><Skeleton height={200} /></div>
          ) : subs.length === 0 ? (
            <div className="card-body"><p className="muted" style={{ textAlign: 'center', padding: 20 }}>Aucune donnée réelle versée pour {monthLabel(month)}. Importez des soumissions dans « Données &amp; indicateurs ».</p></div>
          ) : (
            <div className="table-wrap"><table className="table">
              <thead><tr>
                <th>Fiche</th><th>Commune (résolue)</th><th>District (code)</th><th>Commune (code)</th>
                <th>Partenaire</th><th>Source</th><th>Soumis le</th>
              </tr></thead>
              <tbody>
                {subs.map((s, i) => (
                  <tr key={s.externalId || i}>
                    <td>{s.formLabel || '—'}</td>
                    <td>{s.communeName ? <strong>{s.communeName}</strong> : <span className="muted" title="Aucun site du référentiel ne porte ce pcode de commune.">non rattachée</span>}</td>
                    <td className="mono">{s.admin2 || '—'}</td>
                    <td className="mono">{s.admin3 || '—'}</td>
                    <td>{s.partner || '—'}</td>
                    <td><span className="badge">{s.source || '—'}</span></td>
                    <td className="tabular">{s.submittedAt ? String(s.submittedAt).slice(0, 10) : (s.periodMonth || '—')}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          )}
          <div className="note"><MapPin size={18} aria-hidden="true" /><span>Liaison par <strong>pcode de commune</strong> : une soumission « non rattachée » signifie qu'aucun site du référentiel ne porte ce code — importez le Master Data (RBM) pour compléter les pcodes.</span></div>
        </div>
      )}
      </>}

      {addOpen && <AddVisitModal month={month} providers={providers} roles={ROLES} onClose={() => setAddOpen(false)} onSaved={() => { setAddOpen(false); reload(); }} />}
    </div>
  );
}

// Tableau des mois : une ligne par mois avec ses stats + barre de couverture ;
// clic (ou bouton « Ouvrir / Planifier ») → plan du mois.
function MonthsTable({ data, year, setYear, current, onOpen, statusFilter, setStatusFilter }) {
  const all = data?.months || [];
  const months = statusFilter ? all.filter((m) => m.status === statusFilter) : all;
  const pctClass = (c) => (c >= 0.8 ? 'green' : c >= 0.5 ? 'amber' : 'red');
  const tot = all.reduce((a, m) => ({ planifie: a.planifie + m.planifie, realise: a.realise + m.realise, annule: a.annule + m.annule, sites: a.sites + m.sites }), { planifie: 0, realise: 0, annule: 0, sites: 0 });
  const totCov = tot.planifie + tot.realise > 0 ? tot.realise / (tot.planifie + tot.realise) : 0;
  const activeMonths = all.filter((m) => m.total > 0).length;
  return (
    <div className="card biz-card months-card">
      <div className="months-head">
        <button type="button" className="btn btn-ghost btn-icon" onClick={() => setYear(year - 1)} aria-label="Année précédente"><ChevronLeft size={18} /></button>
        <span className="months-year">{year}</span>
        <button type="button" className="btn btn-ghost btn-icon" onClick={() => setYear(year + 1)} aria-label="Année suivante"><ChevronRight size={18} /></button>
        <div className="months-head-sum">
          <span><strong className="tabular">{formatInt(activeMonths)}</strong> mois actifs</span>
          <span><strong className="tabular">{formatInt(tot.realise)}</strong>/{formatInt(tot.planifie + tot.realise)} visites</span>
          <span className="months-head-cov"><span className="mini-bar"><span style={{ width: `${Math.round(totCov * 100)}%`, background: `var(--${pctClass(totCov)})` }} /></span><strong className="tabular">{Math.round(totCov * 100)} %</strong></span>
          <label className="months-filter"><Filter size={15} aria-hidden="true" />
            <select className="select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Filtrer par situation">
              <option value="">Toutes situations</option>
              {['vide', 'draft', 'soumis', 'valide', 'annule', 'non_applicable'].map((k) => <option key={k} value={k}>{PLAN_STATUS[k].label}</option>)}
            </select>
          </label>
        </div>
      </div>
      {data === null ? <div className="card-body"><Skeleton height={340} /></div> : (
        <div className="table-wrap"><table className="table grid months-grid">
          <thead><tr>
            <th>Mois</th><th>Situation</th><th className="num">Sites</th><th className="num">Planifiées</th>
            <th className="num">Réalisées</th><th className="num">Annulées</th><th className="num">Prestataires</th>
            <th>Couverture</th><th aria-label="Action" />
          </tr></thead>
          <tbody>
            {months.map((m) => {
              const isCur = m.month === current;
              const empty = m.total === 0;
              const cov = Math.round(m.coverage * 100);
              return (
                <tr key={m.month} className={`clickable month-row ${isCur ? 'is-selected' : ''} ${empty ? 'is-empty' : ''}`} onClick={() => onOpen(m.month)}
                  onKeyDown={(e) => { if (e.key === 'Enter') onOpen(m.month); }} tabIndex={0} aria-label={`Ouvrir ${monthLabel(m.month)}`}>
                  <td><span className="month-name">{monthLabel(m.month)}</span>{isCur && <span className="tag-inline">en cours</span>}</td>
                  <td><PlanBadge status={m.status} /></td>
                  <td className="num tabular">{empty ? <span className="cell-empty">—</span> : formatInt(m.sites)}</td>
                  <td className="num tabular">{empty ? <span className="cell-empty">—</span> : formatInt(m.planifie)}</td>
                  <td className="num tabular">{empty ? <span className="cell-empty">—</span> : <strong>{formatInt(m.realise)}</strong>}</td>
                  <td className="num tabular">{empty ? <span className="cell-empty">—</span> : (m.annule ? <span style={{ color: 'var(--text-muted)' }}>{formatInt(m.annule)}</span> : '0')}</td>
                  <td className="num tabular">{empty ? <span className="cell-empty">—</span> : formatInt(m.providers)}</td>
                  <td>
                    {m.planifie + m.realise === 0 ? <span className="cell-empty">—</span> : (
                      <span className="month-cov">
                        <span className="mini-bar"><span style={{ width: `${cov}%`, background: `var(--${pctClass(m.coverage)})` }} /></span>
                        <span className="tabular" style={{ color: `var(--${pctClass(m.coverage)}-text)`, fontWeight: 650 }}>{cov} %</span>
                      </span>
                    )}
                  </td>
                  <td className="num">
                    <button type="button" className={`btn btn-sm ${empty ? 'btn-ghost' : 'btn-secondary'} month-open`} onClick={(e) => { e.stopPropagation(); onOpen(m.month); }}>
                      {empty ? 'Planifier' : 'Ouvrir'}<GoIcon size={15} aria-hidden="true" />
                    </button>
                  </td>
                </tr>
              );
            })}
            {months.length === 0 && <tr><td colSpan={9} className="muted" style={{ textAlign: 'center', padding: 20 }}>Aucun mois pour cette situation.</td></tr>}
          </tbody>
        </table></div>
      )}
      <div className="note"><CalendarClock size={18} aria-hidden="true" /><span>Cliquez un mois (ou « Ouvrir / Planifier ») pour accéder à son plan de visites. Couverture = réalisées ÷ (planifiées + réalisées), annulées exclues.</span></div>
    </div>
  );
}

function Kpi({ icon: Icon, label, value, foot, tone }) {
  return (
    <div className="biz-kpi">
      <div className={`biz-kpi-ic ${tone || ''}`}><Icon size={18} aria-hidden="true" /></div>
      <div className="biz-kpi-body">
        <div className="biz-kpi-label">{label}</div>
        <div className="biz-kpi-value tabular">{value}</div>
        {foot && <div className="biz-kpi-foot">{foot}</div>}
      </div>
    </div>
  );
}

function CoverageCard({ title, rows }) {
  return (
    <div className="card biz-card">
      <div className="card-header"><div className="card-title">{title}</div></div>
      <div className="card-body biz-gauges">
        {rows.map((r) => (
          <div className="biz-gauge" key={r.key}>
            <div className="biz-gauge-head"><span>{r.label}</span><span className="tabular">{r.realise}/{r.active} · {Math.round(r.rate * 100)} %</span></div>
            <div className="biz-bar"><span style={{ width: `${Math.round(r.rate * 100)}%`, background: r.rate >= 0.8 ? 'var(--green)' : 'var(--blue-600)' }} /></div>
          </div>
        ))}
      </div>
    </div>
  );
}

function AddVisitModal({ month, providers, roles, onClose, onSaved }) {
  const toast = useToast();
  const [sites, setSites] = useState([]);
  const [form, setForm] = useState({ siteId: '', activity: '', providerId: '', agent: '' });
  const [newSite, setNewSite] = useState({ district: '', commune: '', name: '', activity: '' });
  const [mode, setMode] = useState('existing');
  const [saving, setSaving] = useState(false);

  useEffect(() => { api.fieldSites().then(setSites).catch(() => setSites([])); }, []);

  async function save() {
    setSaving(true);
    try {
      let siteId = form.siteId;
      let activity = form.activity;
      if (mode === 'new') {
        if (!newSite.district || !newSite.commune || !newSite.name) { toast.error('District, commune et nom du site sont requis.'); setSaving(false); return; }
        const { id } = await api.fieldCreateSite(newSite);
        siteId = id; activity = activity || newSite.activity;
      }
      if (!siteId) { toast.error('Choisissez un site.'); setSaving(false); return; }
      await api.fieldCreateVisit({ siteId, periodMonth: month, activity: activity || undefined, providerId: form.providerId || undefined, agent: form.agent || undefined });
      toast.success('Visite planifiée.');
      onSaved();
    } catch (e) { toast.error(e.message); } finally { setSaving(false); }
  }

  return (
    <Modal open size="md" title="Ajouter une visite" subtitle={`Mois : ${month}`} onClose={onClose}
      footer={<><Button variant="secondary" onClick={onClose} disabled={saving}>Annuler</Button><Button onClick={save} loading={saving}>Planifier</Button></>}>
      <div style={{ display: 'grid', gap: 14 }}>
        <div className="seg" role="group" aria-label="Type de site">
          <button type="button" className={mode === 'existing' ? 'is-active' : ''} onClick={() => setMode('existing')}>Site existant</button>
          <button type="button" className={mode === 'new' ? 'is-active' : ''} onClick={() => setMode('new')}>Nouveau site</button>
        </div>
        {mode === 'existing' ? (
          <label className="field"><span className="field-label">Site</span>
            <select className={`select ${form.siteId ? '' : 'is-empty'}`} value={form.siteId} onChange={(e) => setForm({ ...form, siteId: e.target.value })}>
              <option value="">Choisir un site…</option>
              {sites.map((s) => <option key={s.id} value={s.id}>{s.district} › {s.commune} › {s.name}</option>)}
            </select>
          </label>
        ) : (
          <div className="form-grid">
            <label className="field"><span className="field-label">District</span><input className="input" value={newSite.district} onChange={(e) => setNewSite({ ...newSite, district: e.target.value })} /></label>
            <label className="field"><span className="field-label">Commune</span><input className="input" value={newSite.commune} onChange={(e) => setNewSite({ ...newSite, commune: e.target.value })} /></label>
            <label className="field span-2"><span className="field-label">Établissement</span><input className="input" value={newSite.name} onChange={(e) => setNewSite({ ...newSite, name: e.target.value })} /></label>
          </div>
        )}
        <label className="field"><span className="field-label">Activité</span><input className="input" value={form.activity} placeholder="Ex. Suivi cantines scolaires" onChange={(e) => setForm({ ...form, activity: e.target.value })} /></label>
        <div className="form-grid">
          <label className="field"><span className="field-label">Prestataire TPM (optionnel)</span>
            <select className="select" value={form.providerId} onChange={(e) => setForm({ ...form, providerId: e.target.value })}>
              <option value="">— Non affecté —</option>
              {providers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          <label className="field"><span className="field-label">Rôle (optionnel)</span>
            <select className="select" value={form.agent} onChange={(e) => setForm({ ...form, agent: e.target.value })}>
              <option value="">— Rôle —</option>
              {roles.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </label>
        </div>
      </div>
    </Modal>
  );
}
