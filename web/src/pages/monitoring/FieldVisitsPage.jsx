import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Upload, Plus, MapPin, CheckCircle2, CalendarClock, Ban, UserPlus, Trash2, Wand2, ChevronLeft, ChevronRight, ChevronRight as GoIcon, Filter, CircleDashed, Clock, MinusCircle, RefreshCw } from 'lucide-react';
import { api } from '../../api/client.js';
import { Alert, Button, PageHeader, Skeleton } from '../../components/ui.jsx';
import DataList from '../../components/DataList.jsx';
import Modal from '../../components/Modal.jsx';
import { useToast } from '../../components/Toast.jsx';
import { currentMonth, formatInt, monthLabel } from '../../lib/format.js';
import { richText } from '../../lib/contracts.js';
import { useI18n } from '../../lib/i18n.jsx';
import { REASON_MIN, TPM_VISIT, applyResultMessage, visitTpmKey, visitToAssign } from '../../lib/tpmAttribution.js';
import { applyVisitPatch } from '../../lib/fieldVisits.js';
import { NONE, ProviderSelect, ReasonField, VisitTpmCell } from './TpmFields.jsx';
import TpmVisitDialog from './TpmVisitDialog.jsx';

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
  const { tr } = useI18n();
  const s = PLAN_STATUS[status] || PLAN_STATUS.vide;
  const I = s.Icon;
  return <span className="badge" style={{ background: s.bg, color: s.text }}>{I && <I size={13} aria-hidden="true" className="badge-ic" />}{tr(s.label)}</span>;
};
// Rôles génériques (non nominatifs) : le bureau affecte un créneau (Agent 1,
// Superviseur 1…) ; le prestataire TPM y met ensuite une personne en interne.
const ROLES = ['Agent 1', 'Agent 2', 'Agent 3', 'Agent 4', 'Superviseur 1', 'Superviseur 2', 'Coordinateur'];

/**
 * Suivi terrain — outil du responsable S&E. Deux temps :
 *  1) Planification générale : le bureau recense les sites à visiter dans le
 *     mois (district › commune › établissement › activité).
 *  2) Affectation : le prestataire TPM de chaque visite vient du CONTRAT de suivi qui
 *     couvre la zone du site ce mois-là (retour 58 — rien à saisir) ; un autre TPM est
 *     un écart motivé (raison obligatoire). Le bureau donne un rôle générique (Agent 1 /
 *     Superviseur 1, non nominatif).
 * La réalisation alimente l'exécution du plan (réalisées / planifiées) ; la « couverture »
 * désigne les sites (sites actifs réalisés ÷ sites actifs, tableaux de bord — lot 1b).
 */
export default function FieldVisitsPage({ canEdit }) {
  const { tr } = useI18n();
  const toast = useToast();
  const [month, setMonth] = useState(currentMonth);
  const [visits, setVisits] = useState(null);
  const [summary, setSummary] = useState(null);
  const [collDays, setCollDays] = useState([]);
  // Nb de sites « à planifier » ce mois selon le RBM : à suivre, hors zone interdite, sans visite déjà
  // prévue ce mois (drapeau toPlan du serveur, même règle que « Générer ») — tombe à 0 après génération.
  const [rbmToPlan, setRbmToPlan] = useState(null);
  const [providers, setProviders] = useState([]);
  const [error, setError] = useState(null);
  const [importing, setImporting] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [tpmVisits, setTpmVisits] = useState(null); // visites dont on change le TPM (raison obligatoire)
  const [applying, setApplying] = useState(false);
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

  // Données du mois OUVERT (visites, résumé, jours, compteur RBM) : lues seulement quand un mois
  // est ouvert — le tableau des mois n'en a pas besoin. `quiet` : relecture après une
  // modification, sans vider la grille (pas de squelette, la page et les filtres restent) ;
  // seule la dernière relecture lancée est appliquée.
  const loadSeq = useRef(0);
  const loadMonth = useCallback(({ quiet = false } = {}) => {
    const id = loadSeq.current + 1; loadSeq.current = id;
    const live = () => loadSeq.current === id;
    if (!quiet) setVisits(null);
    Promise.all([api.fieldVisits({ month }), api.fieldSummary(month), api.fieldCollectionDays(month)])
      .then(([v, s, c]) => { if (live()) { setVisits(v); setSummary(s); setCollDays(c); } })
      .catch((e) => { if (live()) setError(e.message); });
    // Combien de sites restent « à planifier » ce mois d'après le RBM (indicatif, non bloquant) :
    // le compteur seul (GET /rbm/counts, même règle « toPlan » que « Générer »), pas la liste des sites.
    api.rbmCounts(month).then((r) => { if (live()) setRbmToPlan(r.toPlan); }).catch(() => { if (live()) setRbmToPlan(null); });
    // Rafraîchit les stats par mois (le tableau des mois).
    api.fieldMonths(month.slice(0, 4)).then(setMonthsData).catch(() => {});
  }, [month]);
  const reload = useCallback(() => loadMonth({ quiet: true }), [loadMonth]);

  useEffect(() => { if (!picking) loadMonth(); }, [picking, loadMonth]);
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
      toast.success(tr('{visits} visite(s) planifiée(s) · {sites} site(s).', { visits: r.visitsCreated, sites: r.sitesTotal }));
      reload();
    } catch (err) { toast.error(err.message); } finally { setImporting(false); }
  }

  // Modification d'une visite : la ligne change tout de suite (même règle que le serveur,
  // lib/fieldVisits.applyVisitPatch), puis une relecture silencieuse confirme et met à jour les
  // totaux ; en cas d'erreur, la relecture rétablit l'état du serveur.
  const patch = async (v, body) => {
    setVisits((list) => (list ? list.map((x) => (x.id === v.id ? applyVisitPatch(x, body, providers) : x)) : list));
    try { await api.fieldUpdateVisit(v.id, body); }
    catch (err) { toast.error(err.message); }
    reload();
  };
  const remove = async (v) => {
    if (!window.confirm(tr('Supprimer la visite de « {site} » ?', { site: v.siteName }))) return;
    try { await api.fieldDeleteVisit(v.id); setVisits((list) => (list ? list.filter((x) => x.id !== v.id) : list)); reload(); }
    catch (err) { toast.error(err.message); }
  };
  // Génère la planification du mois à partir du RBM : chaque site « à planifier »
  // (à suivre — jamais visité ou échéance atteinte —, hors zone interdite, sans
  // visite déjà prévue ce mois) devient une visite planifiée ; un 2ᵉ clic ne crée
  // rien. Même action que sur la page RBM — proposée ici pour partir du RBM sans
  // quitter la planification. L'affectation (prestataire + rôle) se fait ensuite.
  const generateFromRbm = async () => {
    setGenerating(true);
    try {
      const r = await api.rbmGenerate(month);
      if (r.created > 0) toast.success(tr('{created} visite(s) planifiée(s) sur {due} site(s) à suivre (RBM).', { created: r.created, due: r.due }));
      else if (r.due > 0) toast.info(tr('Aucune nouvelle visite : les {due} site(s) à suivre sont déjà planifiés.', { due: r.due }));
      else toast.info(tr('Aucun site à suivre ce mois (hors zones interdites).'));
      setRbmToPlan(Math.max(0, (r.toPlan || 0) - (r.created || 0))); // affiché tout de suite, confirmé par reload()
      reload();
    } catch (err) { toast.error(err.message); } finally { setGenerating(false); }
  };
  // « Appliquer les TPM des contrats » au mois : toute visite PRÉVUE sans TPM choisi avec une raison
  // reprend celui de sa zone (journalisé) ; une visite motivée, réalisée, annulée ou déjà facturée
  // n'est jamais touchée (le compte rendu les compte).
  const applyContracts = async () => {
    setApplying(true);
    try {
      const r = await api.tpmAttributionApply({ from: month, to: month });
      toast.success(applyResultMessage(tr, r.visits, 'Toutes les visites prévues du mois portent déjà le TPM de leur zone.'));
      reload();
    } catch (err) { toast.error(err.message); } finally { setApplying(false); }
  };
  const setTravel = async (providerId, travelDays) => {
    try { await api.fieldSetTravelDays({ providerId, month, travelDays: Math.max(0, Math.round(Number(travelDays) || 0)) }); reload(); }
    catch (err) { toast.error(err.message); }
  };
  const monthStart = `${month}-01`;
  const monthEnd = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).toISOString().slice(0, 10);

  const communeCount = useMemo(() => new Set((visits || []).map((v) => `${v.district} › ${v.commune}`)).size, [visits]);
  const ov = summary?.overall;
  const unassigned = (visits || []).filter(visitToAssign).length;

  // Colonnes & filtres de la grille de planification (liste façon COMET).
  const columns = useMemo(() => {
    const c = {
      site: { label: tr('Site (établissement)'), sortVal: (v) => v.siteName, csv: (v) => v.siteName,
        render: (v) => <><strong>{v.siteName}</strong>{v.fokontany && <div className="site-meta">{v.fokontany}</div>}</> },
      zone: { label: tr('District / Commune'), sortVal: (v) => `${v.district || ''} ${v.commune || ''}`, csv: (v) => `${v.district || ''} / ${v.commune || ''}`,
        render: (v) => <>{v.district || '—'} › {v.commune || '—'}</> },
      activity: { label: tr('Activité'), sortVal: (v) => v.activity || '', csv: (v) => v.activity || '',
        render: (v) => v.activity || '—' },
      // Retour 58 : TPM tiré du contrat qui couvre la zone ; changer = raison obligatoire.
      provider: { label: tr('Prestataire TPM'), sortVal: (v) => v.providerName || '', csv: (v) => v.providerName || '',
        render: (v) => <VisitTpmCell visit={v} canEdit={canEdit} onEdit={(x) => setTpmVisits([x])} /> },
      tpmOrigin: { label: tr('Origine du TPM'), sortVal: (v) => visitTpmKey(v), csv: (v) => tr((TPM_VISIT[visitTpmKey(v)] || TPM_VISIT['zone:']).label),
        render: (v) => tr((TPM_VISIT[visitTpmKey(v)] || TPM_VISIT['zone:']).label) },
      role: { label: tr('Rôle'), sortVal: (v) => v.agent || '', csv: (v) => v.agent || '',
        render: (v) => (canEdit
          ? <select className={`select ${v.agent ? '' : 'is-empty'}`} style={{ minWidth: 130 }} value={v.agent || ''} onChange={(e) => patch(v, { agent: e.target.value })} aria-label={tr('Rôle')}>
              <option value="">{tr('— Rôle —')}</option>{ROLES.map((r) => <option key={r} value={r}>{tr(r)}</option>)}{v.agent && !ROLES.includes(v.agent) && <option value={v.agent}>{v.agent}</option>}</select>
          : (ROLES.includes(v.agent) ? tr(v.agent) : (v.agent || '—'))) },
      visitDate: { label: tr('Date de visite'), sortVal: (v) => v.visitDate || '', csv: (v) => v.visitDate || '',
        render: (v) => (canEdit
          ? <input className="input" style={{ width: 150 }} type="date" min={monthStart} max={monthEnd} value={v.visitDate || ''} onChange={(e) => e.target.value && patch(v, { visitDate: e.target.value })} aria-label={tr('Date de visite')} />
          : (v.visitDate || '—')) },
      dataVisit: { label: tr('Dernière collecte (données)'), sortVal: (v) => v.dataVisitMonth || '', csv: (v) => v.dataVisitMonth || '',
        render: (v) => (v.dataVisitMonth
          ? <span className="tabular">{v.dataVisitMonth}</span>
          : <span className="muted" title={tr('Aucune donnée réelle rattachée à la commune de ce site (pcode).')}>—</span>) },
      status: { label: tr('Statut'), sortVal: (v) => v.status, csv: (v) => (STATUS[v.status] ? tr(STATUS[v.status].label) : v.status),
        render: (v) => (canEdit
          ? <div className="seg" role="group" aria-label={tr('Statut')}>{Object.entries(STATUS).map(([k, s]) => <button type="button" key={k} className={v.status === k ? 'is-active' : ''} onClick={() => patch(v, { status: k })} title={tr(s.label)}>{tr(s.label)}</button>)}</div>
          : (() => { const S = STATUS[v.status]; const I = S?.Icon; return <span className="badge">{I && <I size={13} aria-hidden="true" className="badge-ic" style={{ color: S.color }} />}{S && tr(S.label)}</span>; })()) },
    };
    if (canEdit) c.action = { label: '', width: 48, csv: () => '', render: (v) => <Button size="sm" variant="ghost" icon={Trash2} aria-label={tr('Supprimer')} onClick={() => remove(v)} /> };
    return c;
  }, [canEdit, providers, monthStart, monthEnd, tr]); // eslint-disable-line

  const filters = useMemo(() => ({
    q: { label: tr('Recherche'), type: 'search', placeholder: tr('Site, commune, district…'),
      match: (v, val) => [v.siteName, v.commune, v.district, v.activity].some((x) => x && String(x).toLowerCase().includes(val.toLowerCase())) },
    provider: { label: tr('Prestataire'), type: 'select',
      options: [{ id: '', label: tr('Tous les prestataires') }, { id: 'non_affecte', label: tr('— À affecter (aucun contrat) —') }, ...providers.map((p) => ({ id: p.id, label: p.name }))],
      match: (v, val) => (val === 'non_affecte' ? visitToAssign(v) : v.providerId === val) },
    tpmOrigin: { label: tr('Origine du TPM'), type: 'select',
      options: [{ id: '', label: tr('Toutes les origines') }, { id: 'contrat', label: tr('Selon contrat') }, { id: 'modifie', label: tr('Modifiés (zone ou visite)') },
        { id: 'a_affecter', label: tr('À affecter') }, { id: 'plusieurs', label: tr('Plusieurs contrats : choisir') }],
      match: (v, val) => {
        const src = v.providerSource || 'zone';
        if (val === 'contrat') return src === 'zone' && v.providerZoneState === 'contrat';
        if (val === 'modifie') return src !== 'zone' || v.providerZoneState === 'modifie' || v.providerZoneState === 'aucun_tpm';
        if (val === 'a_affecter') return visitToAssign(v);
        if (val === 'plusieurs') return src === 'zone' && v.providerZoneState === 'a_arbitrer';
        return true;
      } },
    status: { label: tr('Statut'), type: 'select',
      options: [{ id: '', label: tr('Tous les statuts') }, ...Object.entries(STATUS).map(([k, s]) => ({ id: k, label: tr(s.label) }))],
      match: (v, val) => v.status === val },
  }), [providers, tr]);

  const openMonth = (mm) => { setMonth(mm); setPicking(false); setView('plan'); };
  const setMonthStatus = async (status) => {
    try { await api.fieldSetMonthStatus(month, status); toast.success(tr('Situation : {status}.', { status: tr(PLAN_STATUS[status].label) })); reload(); }
    catch (e) { toast.error(e.message); }
  };
  const activeStatus = (monthsData?.months || []).find((m) => m.month === month)?.status || 'vide';

  return (
    <div className="page">
      <PageHeader title={tr('Affectation & visites de terrain')}
        description={picking
          ? tr("L'écran unique du suivi terrain : planifiez les visites du mois (depuis le RBM), affectez les prestataires TPM, suivez les jours/budget, la couverture et les données réelles. Choisissez un mois pour ouvrir son plan.")
          : tr("Les sites à visiter ce mois (district › commune › établissement › activité) : affectez le prestataire TPM et le rôle, datez les visites ; les onglets couvrent le budget-jours, la couverture et les données réelles.")}>
        {!picking && <Button variant="secondary" icon={ChevronLeft} onClick={() => setPicking(true)}>{tr('Tous les mois')}</Button>}
        {!picking && canEdit && <><input ref={fileRef} type="file" accept=".xlsx" hidden onChange={onImport} />
          <Button variant="secondary" icon={Wand2} loading={generating} onClick={generateFromRbm}
            title={tr("Planifie automatiquement les sites « à suivre » ce mois d'après leur niveau de risque (RBM). Le nombre indique ceux qui n'ont pas encore de visite ce mois (hors zones interdites).")}>
            {rbmToPlan ? tr('Générer depuis le RBM ({n})', { n: rbmToPlan }) : tr('Générer depuis le RBM')}</Button>
          <Button variant="secondary" icon={Upload} loading={importing} onClick={() => fileRef.current?.click()}>{tr('Importer planning')}</Button>
          <Button variant="secondary" icon={RefreshCw} loading={applying} onClick={applyContracts}
            title={tr('Chaque visite prévue du mois sans TPM choisi avec une raison reprend le TPM du contrat qui couvre sa zone (journalisé) ; une visite réalisée, annulée ou déjà facturée garde son TPM.')}>
            {tr('Appliquer les TPM des contrats')}</Button>
          <Button icon={Plus} onClick={() => setAddOpen(true)}>{tr('Ajouter une visite')}</Button></>}
      </PageHeader>

      {error && <Alert tone="error">{error}</Alert>}

      {picking && <MonthsTable data={monthsData} year={year} setYear={setYear} current={currentMonth()} onOpen={openMonth}
        statusFilter={statusFilter} setStatusFilter={setStatusFilter} />}

      {!picking && <>
      <div className="month-active-bar">
        <strong>{monthLabel(month)}</strong>
        <span className="muted">{tr('— plan de visites du mois')}</span>
        <PlanBadge status={activeStatus} />
        {canEdit && (
          <span className="month-status-actions">
            {['vide', 'draft', 'annule', 'non_applicable'].includes(activeStatus) && <Button size="sm" variant="secondary" onClick={() => setMonthStatus('soumis')}>{tr('Soumettre')}</Button>}
            {activeStatus === 'soumis' && <><Button size="sm" variant="secondary" icon={CheckCircle2} onClick={() => setMonthStatus('valide')}>{tr('Valider')}</Button><Button size="sm" variant="ghost" onClick={() => setMonthStatus('draft')}>{tr('Repasser en brouillon')}</Button></>}
            {activeStatus === 'valide' && <Button size="sm" variant="ghost" onClick={() => setMonthStatus('draft')}>{tr('Rouvrir')}</Button>}
            {!['non_applicable'].includes(activeStatus) && <Button size="sm" variant="ghost" icon={Ban} onClick={() => setMonthStatus('non_applicable')}>{tr('Non applicable')}</Button>}
            {!['annule', 'vide'].includes(activeStatus) && <Button size="sm" variant="ghost" onClick={() => setMonthStatus('annule')}>{tr('Annuler le plan')}</Button>}
          </span>
        )}
      </div>

      <p className="tpm-rule-note">
        {tr('Le TPM de chaque visite vient du contrat de suivi qui couvre la zone du site ce mois-là : rien à saisir. Un autre TPM se motive (crayon) ; une zone sans contrat s\'ajoute aux zones d\'intervention d\'un contrat de suivi.')}
      </p>

      {/* Deux vues : la grille de planification (simple, par défaut) et la couverture (analytique). */}
      <div className="seg" role="group" aria-label={tr('Vue')} style={{ marginBottom: 4 }}>
        <button type="button" className={view === 'plan' ? 'is-active' : ''} onClick={() => setView('plan')}>{tr('Planification')}</button>
        <button type="button" className={view === 'couverture' ? 'is-active' : ''} onClick={() => setView('couverture')}>{tr('Couverture & budget')}</button>
        <button type="button" className={view === 'donnees' ? 'is-active' : ''} onClick={() => setView('donnees')}>{tr('Données réelles')}</button>
      </div>

      {view === 'couverture' && <>
        {ov && (
          <div className="biz-kpis" style={{ gridTemplateColumns: 'repeat(5, minmax(0,1fr))' }}>
            <Kpi icon={MapPin} tone="blue" label={tr('Sites du mois')} value={formatInt(ov.total)} foot={tr('{n} commune(s)', { n: communeCount })} />
            <Kpi icon={UserPlus} tone={unassigned ? 'amber' : 'green'} label={tr('À affecter')} value={formatInt(unassigned)} foot={tr('Aucun contrat actif sur la zone')} />
            <Kpi icon={CalendarClock} tone="blue" label={tr('Planifiées')} value={formatInt(ov.planifie)} foot={tr('À réaliser')} />
            <Kpi icon={CheckCircle2} tone="green" label={tr('Réalisées')} value={formatInt(ov.realise)} foot={tr('{p} % d\'exécution du plan', { p: Math.round(ov.rate * 100) })} />
            <Kpi icon={Ban} tone="red" label={tr('Annulées')} value={formatInt(ov.annule)} foot={tr('Exclues du taux')} />
          </div>
        )}
        <div className="biz-grid" style={{ gridTemplateColumns: 'repeat(2, minmax(0,1fr))' }}>
          {summary?.byProvider?.length > 0 && <CoverageCard title={tr('Exécution du plan par prestataire')} rows={summary.byProvider} />}
          {summary?.byDistrict?.length > 0 && <CoverageCard title={tr('Exécution du plan par district')} rows={summary.byDistrict} />}
        </div>
        {collDays.length > 0 && (
          <div className="card biz-card" style={{ marginTop: 16 }}>
            <div className="card-header"><div className="card-title">{tr('Jours de collecte (pour le budget)')}</div>
              <div className="card-sub">{tr('Jours de visite = visites datées ; + jours de déplacement (saisie manuelle) = total des jours à budgéter par prestataire.')}</div></div>
            <div className="table-wrap"><table className="table">
              <thead><tr><th>{tr('Prestataire TPM')}</th><th className="num">{tr('Jours de visite')}</th><th className="num">{tr('Jours de déplacement')}</th><th className="num">{tr('Total jours')}</th></tr></thead>
              <tbody>
                {collDays.map((d) => (
                  <tr key={d.providerId}>
                    <td><strong>{d.label}</strong></td>
                    <td className="num tabular">{formatInt(d.visitDays)}</td>
                    <td className="num">
                      {canEdit ? (
                        <input className="input tabular" style={{ width: 70, textAlign: 'right' }} type="number" min="0" step="1"
                          defaultValue={d.travelDays} aria-label={tr('Jours de déplacement {provider}', { provider: d.label })}
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
          filters={filters} defaultFilters={['q', 'provider', 'tpmOrigin', 'status']}
          storageKey="mems.fieldvisits.view.v3" pageSize={15} defaultSort={{ key: 'zone', dir: 'asc' }}
          csvName={`visites_${month}.csv`} emptyIcon={MapPin} emptyTitle={tr('Aucune visite ce mois-ci')}
          emptyAction={canEdit && rbmToPlan > 0 && <Button icon={Wand2} loading={generating} onClick={generateFromRbm}>{tr('Générer {n} visite(s) depuis le RBM', { n: rbmToPlan })}</Button>}
          emptyChildren={rbmToPlan
            ? tr('Générez la planification depuis le RBM ({n} site(s) à planifier), importez le planning (.xlsx) ou ajoutez une visite.', { n: rbmToPlan })
            : tr('Générez la planification depuis le RBM, importez le planning (.xlsx) ou ajoutez une visite.')}
        />
      )}

      {view === 'donnees' && (
        <div className="card biz-card">
          <div className="card-header">
            <div className="card-title">{tr('Données réelles — {month}', { month: monthLabel(month) })}</div>
            <div className="card-sub">{tr("Soumissions de suivi réellement collectées ce mois (données uploadées). La commune est résolue depuis le référentiel de sites via le pcode : c'est cette liaison qui alimente la « dernière collecte » du plan et du RBM, sauf pour les soumissions écartées au nettoyage et celles d'une fiche rattachée à une autre activité que le site.")}</div>
          </div>
          {subs === null ? (
            <div className="card-body"><Skeleton height={200} /></div>
          ) : subs.length === 0 ? (
            <div className="card-body"><p className="muted" style={{ textAlign: 'center', padding: 20 }}>{tr('Aucune donnée réelle versée pour {month}. Importez des soumissions dans « Données & indicateurs ».', { month: monthLabel(month) })}</p></div>
          ) : (
            <div className="table-wrap"><table className="table">
              <thead><tr>
                <th>{tr('Fiche')}</th><th>{tr('Commune (résolue)')}</th><th>{tr('District (code)')}</th><th>{tr('Commune (code)')}</th>
                <th>{tr('Activité (MMR)')}</th><th>{tr('Partenaire')}</th><th>{tr('Source')}</th><th>{tr('Soumis le')}</th>
              </tr></thead>
              <tbody>
                {subs.map((s, i) => (
                  <tr key={s.externalId || i} className={s.excluded ? 'is-muted' : undefined}>
                    <td>{s.formLabel || '—'}{s.excluded && <> <span className="badge" title={tr('Écartée au nettoyage : ne compte pas dans la dernière collecte.')}>{tr('écartée')}</span></>}</td>
                    <td>{s.communeName ? <strong>{s.communeName}</strong> : <span className="muted" title={tr('Aucun site du référentiel ne porte ce pcode de commune.')}>{tr('non rattachée')}</span>}</td>
                    <td className="mono">{s.admin2 || '—'}</td>
                    <td className="mono">{s.admin3 || '—'}</td>
                    <td>{s.activityCategory || <span className="muted">{tr('toutes')}</span>}</td>
                    <td>{s.partner || '—'}</td>
                    <td><span className="badge">{s.source || '—'}</span></td>
                    <td className="tabular">{s.submittedAt ? String(s.submittedAt).slice(0, 10) : (s.periodMonth || '—')}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          )}
          <div className="note"><MapPin size={18} aria-hidden="true" /><span>{richText(tr("Liaison par <strong>pcode de commune</strong> : une soumission « non rattachée » signifie qu'aucun site du référentiel ne porte ce code — importez le Master Data (RBM) pour compléter les pcodes."))}</span></div>
        </div>
      )}
      </>}

      {addOpen && <AddVisitModal month={month} roles={ROLES} onClose={() => setAddOpen(false)} onSaved={() => { setAddOpen(false); reload(); }} />}
      {tpmVisits && <TpmVisitDialog visits={tpmVisits} onClose={() => setTpmVisits(null)} onSaved={() => { setTpmVisits(null); reload(); }} />}
    </div>
  );
}

// Tableau des mois : une ligne par mois avec ses stats + barre de couverture ;
// clic (ou bouton « Ouvrir / Planifier ») → plan du mois.
function MonthsTable({ data, year, setYear, current, onOpen, statusFilter, setStatusFilter }) {
  const { tr } = useI18n();
  const all = data?.months || [];
  const months = statusFilter ? all.filter((m) => m.status === statusFilter) : all;
  const pctClass = (c) => (c >= 0.8 ? 'green' : c >= 0.5 ? 'amber' : 'red');
  const tot = all.reduce((a, m) => ({ planifie: a.planifie + m.planifie, realise: a.realise + m.realise, annule: a.annule + m.annule, sites: a.sites + m.sites }), { planifie: 0, realise: 0, annule: 0, sites: 0 });
  const totCov = tot.planifie + tot.realise > 0 ? tot.realise / (tot.planifie + tot.realise) : 0;
  const activeMonths = all.filter((m) => m.total > 0).length;
  return (
    <div className="card biz-card months-card">
      <div className="months-head">
        <button type="button" className="btn btn-ghost btn-icon" onClick={() => setYear(year - 1)} aria-label={tr('Année précédente')}><ChevronLeft size={18} /></button>
        <span className="months-year">{year}</span>
        <button type="button" className="btn btn-ghost btn-icon" onClick={() => setYear(year + 1)} aria-label={tr('Année suivante')}><ChevronRight size={18} /></button>
        <div className="months-head-sum">
          <span><strong className="tabular">{formatInt(activeMonths)}</strong> {tr('mois actifs')}</span>
          <span><strong className="tabular">{formatInt(tot.realise)}</strong>/{formatInt(tot.planifie + tot.realise)} {tr('visites')}</span>
          <span className="months-head-cov"><span className="mini-bar"><span style={{ width: `${Math.round(totCov * 100)}%`, background: `var(--${pctClass(totCov)})` }} /></span><strong className="tabular">{tr('{p} %', { p: Math.round(totCov * 100) })}</strong></span>
          <label className="months-filter"><Filter size={15} aria-hidden="true" />
            <select className="select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label={tr('Filtrer par situation')}>
              <option value="">{tr('Toutes situations')}</option>
              {['vide', 'draft', 'soumis', 'valide', 'annule', 'non_applicable'].map((k) => <option key={k} value={k}>{tr(PLAN_STATUS[k].label)}</option>)}
            </select>
          </label>
        </div>
      </div>
      {data === null ? <div className="card-body"><Skeleton height={340} /></div> : (
        <div className="table-wrap"><table className="table grid months-grid">
          <thead><tr>
            <th>{tr('Mois')}</th><th>{tr('Situation')}</th><th className="num">{tr('Sites')}</th><th className="num">{tr('Planifiées')}</th>
            <th className="num">{tr('Réalisées')}</th><th className="num">{tr('Annulées')}</th><th className="num">{tr('Prestataires')}</th>
            <th>{tr('Exécution du plan')}</th><th aria-label={tr('Action')} />
          </tr></thead>
          <tbody>
            {months.map((m) => {
              const isCur = m.month === current;
              const empty = m.total === 0;
              const cov = Math.round(m.coverage * 100);
              return (
                <tr key={m.month} className={`clickable month-row ${isCur ? 'is-selected' : ''} ${empty ? 'is-empty' : ''}`} onClick={() => onOpen(m.month)}
                  onKeyDown={(e) => { if (e.key === 'Enter') onOpen(m.month); }} tabIndex={0} aria-label={tr('Ouvrir {month}', { month: monthLabel(m.month) })}>
                  <td><span className="month-name">{monthLabel(m.month)}</span>{isCur && <span className="tag-inline">{tr('en cours')}</span>}</td>
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
                        <span className="tabular" style={{ color: `var(--${pctClass(m.coverage)}-text)`, fontWeight: 650 }}>{tr('{p} %', { p: cov })}</span>
                      </span>
                    )}
                  </td>
                  <td className="num">
                    <button type="button" className={`btn btn-sm ${empty ? 'btn-ghost' : 'btn-secondary'} month-open`} onClick={(e) => { e.stopPropagation(); onOpen(m.month); }}>
                      {empty ? tr('Planifier') : tr('Ouvrir')}<GoIcon size={15} aria-hidden="true" />
                    </button>
                  </td>
                </tr>
              );
            })}
            {months.length === 0 && <tr><td colSpan={9} className="muted" style={{ textAlign: 'center', padding: 20 }}>{tr('Aucun mois pour cette situation.')}</td></tr>}
          </tbody>
        </table></div>
      )}
      <div className="note"><CalendarClock size={18} aria-hidden="true" /><span>{tr('Cliquez un mois (ou « Ouvrir / Planifier ») pour accéder à son plan de visites. Exécution du plan = réalisées ÷ (planifiées + réalisées), annulées exclues.')}</span></div>
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
  const { tr } = useI18n();
  return (
    <div className="card biz-card">
      <div className="card-header"><div className="card-title">{title}</div></div>
      <div className="card-body biz-gauges">
        {rows.map((r) => (
          <div className="biz-gauge" key={r.key}>
            <div className="biz-gauge-head"><span>{r.label}</span><span className="tabular">{r.realise}/{r.active} · {tr('{p} %', { p: Math.round(r.rate * 100) })}</span></div>
            <div className="biz-bar"><span style={{ width: `${Math.round(r.rate * 100)}%`, background: r.rate >= 0.8 ? 'var(--green)' : 'var(--blue-600)' }} /></div>
          </div>
        ))}
      </div>
    </div>
  );
}

function AddVisitModal({ month, roles, onClose, onSaved }) {
  const { tr } = useI18n();
  const toast = useToast();
  const [sites, setSites] = useState([]);
  const [form, setForm] = useState({ siteId: '', activity: '', agent: '' });
  const [newSite, setNewSite] = useState({ district: '', commune: '', name: '', activity: '' });
  const [mode, setMode] = useState('existing');
  const [saving, setSaving] = useState(false);
  // Retour 58 : le TPM de la visite est celui de la zone du site ; « autre TPM » exige une raison.
  const [zoneTpm, setZoneTpm] = useState(null);
  const [other, setOther] = useState(false);
  const [provider, setProvider] = useState('');
  const [reason, setReason] = useState('');

  useEffect(() => { api.fieldSites().then(setSites).catch(() => setSites([])); }, []);
  useEffect(() => {
    setZoneTpm(null);
    if (mode !== 'existing' || !form.siteId) return undefined;
    let live = true;
    api.tpmAttributionResolve(form.siteId, month).then((r) => { if (live) setZoneTpm(r); }).catch(() => { if (live) setZoneTpm(false); });
    return () => { live = false; };
  }, [form.siteId, mode, month]);

  async function save() {
    setSaving(true);
    try {
      let siteId = form.siteId;
      let activity = form.activity;
      if (mode === 'new') {
        if (!newSite.district || !newSite.commune || !newSite.name) { toast.error(tr('District, commune et nom du site sont requis.')); setSaving(false); return; }
        let created;
        try { created = await api.fieldCreateSite(newSite); } catch (e) {
          // Site déjà au registre (409) : jamais fusionné en silence — on le sélectionne et l'utilisateur confirme.
          if (e.status !== 409 || !e.details?.siteId) throw e;
          const existingId = e.details.siteId;
          if (!sites.some((s) => s.id === existingId)) api.fieldSites().then(setSites).catch(() => {});
          setMode('existing'); setForm((f) => ({ ...f, siteId: existingId }));
          toast.info(tr('Ce site existe déjà : il est sélectionné dans « Site existant ». Vérifiez puis planifiez.'));
          setSaving(false); return;
        }
        siteId = created.id; activity = activity || newSite.activity;
      }
      if (!siteId) { toast.error(tr('Choisissez un site.')); setSaving(false); return; }
      await api.fieldCreateVisit({
        siteId, periodMonth: month, activity: activity || undefined, agent: form.agent || undefined,
        ...(other && provider ? { providerId: provider === NONE ? null : provider, providerReason: reason.trim() } : {}),
      });
      toast.success(tr('Visite planifiée.'));
      onSaved();
    } catch (e) { toast.error(e.message); } finally { setSaving(false); }
  }

  const reasonMissing = Boolean(other && provider && [...reason.trim()].length < REASON_MIN);
  return (
    <Modal open size="md" title={tr('Ajouter une visite')} subtitle={tr('Mois : {month}', { month })} onClose={onClose}
      footer={<><Button variant="secondary" onClick={onClose} disabled={saving}>{tr('Annuler')}</Button><Button onClick={save} loading={saving} disabled={reasonMissing}>{tr('Planifier')}</Button></>}>
      <div style={{ display: 'grid', gap: 14 }}>
        <div className="seg" role="group" aria-label={tr('Type de site')}>
          <button type="button" className={mode === 'existing' ? 'is-active' : ''} onClick={() => setMode('existing')}>{tr('Site existant')}</button>
          <button type="button" className={mode === 'new' ? 'is-active' : ''} onClick={() => setMode('new')}>{tr('Nouveau site')}</button>
        </div>
        {mode === 'existing' ? (
          <label className="field"><span className="field-label">{tr('Site')}</span>
            <select className={`select ${form.siteId ? '' : 'is-empty'}`} value={form.siteId} onChange={(e) => setForm({ ...form, siteId: e.target.value })}>
              <option value="">{tr('Choisir un site…')}</option>
              {sites.map((s) => <option key={s.id} value={s.id}>{s.district} › {s.commune} › {s.name}</option>)}
            </select>
          </label>
        ) : (
          <div className="form-grid">
            <label className="field"><span className="field-label">{tr('District')}</span><input className="input" value={newSite.district} onChange={(e) => setNewSite({ ...newSite, district: e.target.value })} /></label>
            <label className="field"><span className="field-label">{tr('Commune')}</span><input className="input" value={newSite.commune} onChange={(e) => setNewSite({ ...newSite, commune: e.target.value })} /></label>
            <label className="field span-2"><span className="field-label">{tr('Établissement')}</span><input className="input" value={newSite.name} onChange={(e) => setNewSite({ ...newSite, name: e.target.value })} /></label>
          </div>
        )}
        <label className="field"><span className="field-label">{tr('Activité')}</span><input className="input" value={form.activity} placeholder={tr('Ex. Suivi cantines scolaires')} onChange={(e) => setForm({ ...form, activity: e.target.value })} /></label>
        <div className="field">
          <span className="field-label">{tr('Prestataire TPM')}</span>
          <ZoneTpmLine resolved={zoneTpm} mode={mode} />
          {mode === 'existing' && zoneTpm && (
            <label className="tpm-other">
              <input type="checkbox" checked={other} onChange={(e) => setOther(e.target.checked)} /> {tr('Choisir un autre TPM pour cette visite (raison obligatoire)')}
            </label>
          )}
        </div>
        {other && mode === 'existing' && (
          <>
            <div className="field">
              <label className="field-label" htmlFor="add-visit-provider">{tr('Autre TPM')}</label>
              <ProviderSelect id="add-visit-provider" selectable={zoneTpm && zoneTpm.selectable} value={provider} onChange={setProvider} noneLabel={tr('Aucun TPM (désaffecter)')} />
            </div>
            <ReasonField id="add-visit-reason" value={reason} onChange={setReason} required />
          </>
        )}
        <label className="field"><span className="field-label">{tr('Rôle (optionnel)')}</span>
          <select className="select" value={form.agent} onChange={(e) => setForm({ ...form, agent: e.target.value })}>
            <option value="">{tr('— Rôle —')}</option>
            {roles.map((r) => <option key={r} value={r}>{tr(r)}</option>)}
          </select>
        </label>
      </div>
    </Modal>
  );
}

/** TPM de la zone du site choisi (règle des contrats), en lecture. */
function ZoneTpmLine({ resolved, mode }) {
  const { tr } = useI18n();
  if (mode === 'new') return <p className="muted tpm-zone-line">{tr('Le TPM sera celui du contrat qui couvre la zone du nouveau site.')}</p>;
  if (resolved === null) return <p className="muted tpm-zone-line">{tr('Choisissez un site : son TPM vient du contrat qui couvre sa zone.')}</p>;
  if (resolved === false) return <p className="muted tpm-zone-line">{tr('TPM de la zone indisponible.')}</p>;
  const zone = resolved.area ? resolved.area.name : '—';
  const origin = resolved.state === 'modifie'
    ? tr('modifié : {r}', { r: (resolved.override && resolved.override.reason) || '' })
    : tr('contrat {n}', { n: resolved.contractLabel || resolved.numero || '' });
  const text = resolved.providerId
    ? tr('{p}, selon la zone {z} ({o})', { p: resolved.providerName, z: zone, o: origin })
    : tr('À affecter : aucun contrat actif sur la zone {z} ce mois. Pour toute la zone, utilisez l\'onglet Affectation des TPM.', { z: zone });
  return <p className={`tpm-zone-line ${resolved.providerId ? '' : 'is-none'}`}>{text}</p>;
}
