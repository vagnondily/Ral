import React, { useCallback, useEffect, useState } from 'react';
import {
  ArrowLeft, AlertTriangle, ClipboardCheck, Pencil, Wallet, MapPin, FileText, Users, Info, ChevronRight,
} from 'lucide-react';
import { api } from '../../api/client.js';
import {
  Alert, Avatar, Badge, Button, Card, CardHeader, Field, Progress, Skeleton, Stats, StatusBadge, Usage,
} from '../../components/ui.jsx';
import Modal from '../../components/Modal.jsx';
import { useToast } from '../../components/Toast.jsx';
import { CONTRACT_STATUS, formatDate, periodLabel, REPORT_STATUS } from '../../lib/contracts.js';
import { formatAr, formatInt, monthLabel } from '../../lib/format.js';
import { BANDS, formatScore } from '../../lib/evaluation.js';
import { PROVIDER_STATUS } from '../../lib/partners.js';
import { ROLE_LABELS, contractNo, joinParts } from '../../lib/roles.js';
import { useI18n } from '../../lib/i18n.jsx';
import RoleBadge from '../../components/RoleBadge.jsx';
import TpmUnavailabilityBadge from '../../components/TpmUnavailabilityBadge.jsx';
import { unavailabilityOf } from '../../lib/tpmAttribution.js';
import useTpmUnavailability from '../../lib/useTpmUnavailability.js';
import './partners.css';
import ProviderContractsTab from './provider/ProviderContractsTab.jsx';
import ProviderReportsTab from './provider/ProviderReportsTab.jsx';
import ProviderFollowupsTab from './provider/ProviderFollowupsTab.jsx';
import ProviderAgentsTab from './provider/ProviderAgentsTab.jsx';
import ProviderTrainingsTab from './provider/ProviderTrainingsTab.jsx';
import ProviderEvaluationTab from './provider/ProviderEvaluationTab.jsx';

/**
 * Fiche 360° d'un partenaire (lot 8, retours 28.1 et 113) — page complète
 * #/tpm/prestataires/<id>/<onglet>, selon son RÔLE :
 *  - TPM : contrats qu'il suit (n° · titulaire), plans, factures et rapports, suivis effectués,
 *    agents (noms ici seulement), formations, évaluation ;
 *  - partenaire de mise en œuvre : ses contrats et le TPM de chacun, zones, plans et factures de
 *    ses TPM, suivis effectués sur ses contrats.
 * Tous les chiffres viennent du serveur (aucun recalcul ici).
 */
const TPM_TABS = [
  { id: 'apercu', label: "Vue d'ensemble" },
  { id: 'contrats', label: 'Contrats suivis', count: 'contracts' },
  { id: 'rapports', label: 'Plans, factures et rapports', count: 'reports' },
  { id: 'suivis', label: 'Suivis effectués' },
  { id: 'agents', label: 'Agents', count: 'agents' },
  { id: 'formations', label: 'Formations', count: 'trainings' },
  { id: 'evaluation', label: 'Évaluation', count: 'evaluations' },
];
const HOLDER_TABS = [
  { id: 'apercu', label: "Vue d'ensemble" },
  { id: 'contrats', label: 'Contrats et TPM', count: 'contracts' },
  { id: 'rapports', label: 'Plans, factures et rapports', count: 'reports' },
  { id: 'suivis', label: 'Suivis effectués' },
];

export default function ProviderSheetPage({ providerId, tab: tabProp, canEdit, user, onNavigate, onOpenContract }) {
  const { tr } = useI18n();
  const [newEval, setNewEval] = useState(false); // « Évaluer le prestataire » ouvre directement une nouvelle grille
  const [sheet, setSheet] = useState(null);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(false);
  const isTpm = Boolean(sheet && sheet.role === 'tpm');
  const unavailability = useTpmUnavailability(isTpm); // retour 114 : indisponibilité actuelle ou prochaine du TPM
  const TABS = isTpm ? TPM_TABS : HOLDER_TABS;
  const tab = TABS.some((t) => t.id === tabProp) ? tabProp : 'apercu';
  const setTab = (id) => onNavigate('tpm', 'prestataires', providerId, id === 'apercu' ? undefined : id);

  const reload = useCallback(() => {
    api.partnerSheet(providerId).then((s) => { setSheet(s); setError(null); }).catch((e) => setError(e.message));
  }, [providerId]);
  useEffect(() => { setSheet(null); reload(); }, [reload]);

  const back = () => onNavigate('tpm', 'prestataires');
  const openPartner = (id) => onNavigate('tpm', 'prestataires', id);
  if (error) {
    return (
      <div className="section-gap">
        <Button variant="ghost" size="sm" icon={ArrowLeft} onClick={back} className="back-link">{tr('Retour aux partenaires')}</Button>
        <Alert tone="error">{error}</Alert>
      </div>
    );
  }
  if (!sheet) {
    return (
      <div className="section-gap">
        <Button variant="ghost" size="sm" icon={ArrowLeft} onClick={back} className="back-link">{tr('Retour aux partenaires')}</Button>
        <Skeleton height={40} width="40%" /><Skeleton height={90} /><Skeleton height={280} />
      </div>
    );
  }

  const { partner: p, status: st, facts, counts } = sheet;
  const b = facts.budget;
  const v = facts.visits;
  const ev = facts.evaluation;

  return (
    <div className="section-gap">
      <div>
        <Button variant="ghost" size="sm" icon={ArrowLeft} onClick={back} className="back-link">{tr('Retour aux partenaires')}</Button>
        <div className="detail-head">
          <div className="pv-head">
            <Avatar name={p.name} size="lg" />
            <div>
              <h1 className="page-title">{p.name}{p.shortName && <span className="pv-short"> · {p.shortName}</span>}</h1>
              <div className="detail-meta">
                <RoleBadge role={sheet.role} />
                {p.legalId && <span className="mono">{p.legalId}</span>}
                <StatusBadge map={PROVIDER_STATUS} value={st.state} />
                {st.from && (
                  <span className="muted">
                    {joinParts(periodLabel(st.from, st.to, tr), st.contracts.map((c) => contractNo(sheet.contracts.find((x) => x.id === c.id) || c)).join(', '))}
                  </span>
                )}
                {st.state === 'actif' && st.endingSoon && (
                  <Badge tone="orange" icon={AlertTriangle}>{tr(st.daysLeft > 1 ? 'Fin du contrat dans {n} jours' : 'Fin du contrat dans {n} jour', { n: st.daysLeft })}</Badge>
                )}
                {isTpm && <TpmUnavailabilityBadge u={unavailabilityOf(unavailability, p.id)} />}
                {!p.active && <Badge>{tr('Fiche inactive')}</Badge>}
              </div>
            </div>
          </div>
          <div className="toolbar">
            {canEdit && <Button variant="secondary" icon={Pencil} onClick={() => setEditing(true)}>{tr('Modifier le partenaire')}</Button>}
            {canEdit && isTpm && <Button icon={ClipboardCheck} onClick={() => { setNewEval(true); setTab('evaluation'); }}>{tr('Évaluer le TPM')}</Button>}
          </div>
        </div>
      </div>

      <Stats items={isTpm ? [
        { label: tr('Budget suivi des contrats suivis'), value: formatAr(b.monitoringBudget),
          foot: b.contracts ? tr('{n} contrat(s) suivi(s)', { n: b.contracts }) : tr('Aucun contrat rattaché') },
        { label: tr('Réalisé validé (ce TPM)'), value: formatAr(b.providerActual),
          foot: b.providerShare == null ? tr('En attente de validation : {amount}', { amount: formatAr(b.providerPending) })
            : tr('{p} % du budget suivi · en attente : {amount}', { p: b.providerShare, amount: formatAr(b.providerPending) }) },
        { label: tr('Visites réalisées (12 mois)'), value: formatInt(v.realised12),
          foot: v.assigned ? tr('Ce mois : {r} sur {a} ({p} %)', { r: v.realised, a: v.assigned, p: v.rate }) : tr('Ce mois : aucune visite affectée') },
        { label: tr('Note du TPM'), value: ev ? formatScore(ev.score) : '—',
          children: ev ? <span style={{ marginTop: 4 }}><StatusBadge map={BANDS} value={ev.band} /></span> : null,
          foot: ev ? tr('Évaluation {period}', { period: periodLabel(`${ev.from}-01`, `${ev.to}-01`, tr) }) : tr('Pas encore évalué') },
      ] : [
        { label: tr('Total des accords'), value: formatAr(b.total),
          foot: b.contracts ? tr('{n} contrat(s) comme titulaire', { n: b.contracts }) : tr('Aucun contrat rattaché') },
        { label: tr('Budget suivi (ligne IV)'), value: formatAr(b.monitoringBudget), foot: tr('Payé au TPM sur facture validée') },
        { label: tr('Réalisé validé (TPM)'), value: formatAr(b.contractActual),
          foot: b.consumption == null ? tr('— pas de ligne de suivi') : tr('{p} % du budget suivi', { p: b.consumption }) },
        { label: tr(ROLE_LABELS.tpm), value: sheet.tpms.length || '—',
          foot: sheet.tpms.length ? sheet.tpms.map((t) => t.name).join(', ') : tr(ROLE_LABELS.noTpm) },
      ]} />

      <Card>
        <div className="tabs-bar">
          <div className="tabs" role="tablist" aria-label={tr('Sections du partenaire')}>
            {TABS.map((t) => (
              <button key={t.id} role="tab" aria-selected={tab === t.id} className="tab" onClick={() => setTab(t.id)}>
                {tr(t.label)}{t.count && counts[t.count] > 0 && <span className="count"> {counts[t.count]}</span>}
              </button>
            ))}
          </div>
        </div>
        {tab === 'apercu' && <Overview sheet={sheet} onTab={setTab} canEdit={canEdit} onEdit={() => setEditing(true)}
          onOpenContract={onOpenContract} onOpenPartner={openPartner} />}
        {tab === 'contrats' && <ProviderContractsTab providerId={providerId} role={sheet.role} onOpenContract={onOpenContract} onOpenPartner={openPartner} />}
        {tab === 'rapports' && <ProviderReportsTab providerId={providerId} role={sheet.role} onNavigate={onNavigate} onChanged={reload} />}
        {tab === 'suivis' && <ProviderFollowupsTab providerId={providerId} onNavigate={onNavigate} />}
        {tab === 'agents' && <ProviderAgentsTab providerId={providerId} canEdit={canEdit} onChanged={reload} />}
        {tab === 'formations' && <ProviderTrainingsTab providerId={providerId} canEdit={canEdit} onNavigate={onNavigate} />}
        {tab === 'evaluation' && <ProviderEvaluationTab providerId={providerId} provider={p} canEdit={canEdit} user={user} onChanged={reload}
          startNew={newEval} onStarted={() => setNewEval(false)} />}
      </Card>

      {editing && <ProfileModal partner={p} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); reload(); }} />}
    </div>
  );
}

/**
 * Contrats de la fiche avec l'autre rôle (retour 113) : pour un TPM, les contrats qu'il suit et leur
 * titulaire ; pour un titulaire, ses contrats et le TPM de chacun. N° FLA · titulaire, toujours.
 */
function ContractsPanel({ sheet, onOpenContract, onOpenPartner, onTab }) {
  const { tr } = useI18n();
  const isTpm = sheet.role === 'tpm';
  const list = isTpm ? sheet.contracts : sheet.contracts.filter((c) => c.isHolder);
  const VIA = { plan: 'plan de collecte', rapport: 'factures et rapports', titulaire: 'son propre contrat' };
  return (
    <section className="pv-panel span-2" aria-labelledby="pv-contracts">
      <h2 className="pv-panel-title" id="pv-contracts"><FileText size={16} aria-hidden="true" />{tr(isTpm ? 'Contrats suivis' : 'Contrats et TPM')}</h2>
      {list.length === 0 ? <p className="muted">{tr(isTpm ? 'Ce TPM ne suit encore aucun contrat : il y est rattaché dès son premier plan de collecte ou sa première facture.' : 'Aucun contrat comme titulaire.')}</p> : (
        <div className="pr-tpm-list">
          {list.map((c) => {
            const mine = c.tpm.tpms.find((t) => t.id === sheet.partner.id);
            return (
              <div key={c.id} className="pr-tpm-row">
                <div>
                  <div className="pr-role-line">
                    <button type="button" className="inline-link mono" onClick={() => onOpenContract(c.id)}>{contractNo(c)}</button>
                    {isTpm && (c.isHolder ? <span className="muted">{tr('son propre contrat')}</span>
                      : <span>· <button type="button" className="inline-link" onClick={() => c.holderId && onOpenPartner(c.holderId)}>{c.holderName}</button></span>)}
                    <StatusBadge map={CONTRACT_STATUS} value={c.status} />
                  </div>
                  <span className="pv-sub">{joinParts(periodLabel(c.dateDebut, c.status === 'resilie' && c.terminationDate ? c.terminationDate : c.dateFin, tr),
                    isTpm && mine && mine.via.length ? tr('rattaché par : {v}', { v: mine.via.map((x) => tr(VIA[x] || x)).join(', ') }) : null)}</span>
                </div>
                {!isTpm && (
                  <div className="pv-right">
                    <span className="stat-label">{tr(ROLE_LABELS.tpm)}</span>
                    {c.tpm.tpms.length
                      ? <span>{c.tpm.tpms.map((t, i) => <span key={t.id}>{i > 0 && ', '}<button type="button" className="inline-link" onClick={() => onOpenPartner(t.id)}>{t.name}</button></span>)}</span>
                      : <span className="muted" title={tr(ROLE_LABELS.noTpmHint)}>{tr(ROLE_LABELS.noTpm)}</span>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      <button type="button" className="inline-link pv-more" onClick={() => onTab('contrats')}>{tr('Voir le détail des contrats')} <ChevronRight size={14} aria-hidden="true" /></button>
    </section>
  );
}

/** Vue d'ensemble : contrats (avec l'autre rôle), budget, activité de terrain, rapports, équipe, identité et zones. */
function Overview({ sheet, onTab, canEdit, onEdit, onOpenContract, onOpenPartner }) {
  const { tr } = useI18n();
  const { partner: p, facts, zones } = sheet;
  const isTpm = sheet.role === 'tpm';
  const b = facts.budget; const v = facts.visits; const s = facts.submissions; const r = facts.reports; const ev = facts.evaluation;
  const reportCell = (kind, status) => (r[kind][status] ? r[kind][status] : <span className="cell-empty">0</span>);
  const more = (id, label) => <button type="button" className="inline-link pv-more" onClick={() => onTab(id)}>{label} <ChevronRight size={14} aria-hidden="true" /></button>;

  return (
    <div className="card-body pv-grid">
      <ContractsPanel sheet={sheet} onOpenContract={onOpenContract} onOpenPartner={onOpenPartner} onTab={onTab} />
      <section className="pv-panel" aria-labelledby="pv-budget">
        <h2 className="pv-panel-title" id="pv-budget"><Wallet size={16} aria-hidden="true" />{tr('Budget et consommation')}</h2>
        {b.contracts === 0 ? <p className="muted">{tr('Aucun contrat rattaché à ce partenaire (titulaire, plan de collecte, rapport ou visite).')}</p> : (
          <>
            <table className="kv pv-kv"><tbody>
              <tr><th>{tr('Contrats rattachés')}</th><td>{b.contracts}{b.monitoringContracts !== b.contracts && <span className="muted"> · {tr('{n} de suivi', { n: b.monitoringContracts })}</span>}</td></tr>
              <tr><th>{tr('Total des accords')}</th><td className="tabular">{formatAr(b.total)}</td></tr>
              <tr><th>{tr('Budget suivi (ligne IV)')}</th><td className="tabular">{formatAr(b.monitoringBudget)}</td></tr>
              {isTpm ? <>
                <tr><th>{tr('Planifié (plans de collecte)')}</th><td className="tabular">{formatAr(b.providerPlanned)}</td></tr>
                <tr><th>{tr('Réalisé validé (ce TPM)')}</th><td className="tabular"><strong>{formatAr(b.providerActual)}</strong></td></tr>
                <tr><th>{tr('En attente de validation')}</th><td className="tabular">{formatAr(b.providerPending)}</td></tr>
              </> : (
                <tr><th>{tr('Réalisé validé (TPM)')}</th><td className="tabular"><strong>{formatAr(b.contractActual)}</strong></td></tr>
              )}
            </tbody></table>
            {b.consumption != null && (
              <div className="pv-usage">
                <span className="stat-label">{tr('Consommation du budget suivi (tous TPM)')}</span>
                <Usage rate={b.consumption / 100} />
              </div>
            )}
          </>
        )}
      </section>

      <section className="pv-panel" aria-labelledby="pv-field">
        <h2 className="pv-panel-title" id="pv-field"><MapPin size={16} aria-hidden="true" />{tr('Suivis effectués')}</h2>
        <div className="pv-month">
          <span className="stat-label">{tr('Visites de {month}', { month: monthLabel(v.month) })}</span>
          {v.assigned ? (
            <><Progress value={v.rate || 0} label={tr('Visites réalisées sur affectées')} />
              <span className="tabular">{tr('{r} réalisées sur {a} affectées ({p} %)', { r: v.realised, a: v.assigned, p: v.rate })}</span></>
          ) : <span className="muted">{tr(v.internal ? '— aucune visite affectée à un TPM ce mois' : '— aucune visite affectée ce mois')}</span>}
          {v.internal > 0 && (
            <span className="muted" title={tr(ROLE_LABELS.noTpmHint)}>
              {tr('{n} visite(s) en suivi interne (équipe S&E) dans les zones de ses contrats · {r} réalisée(s)', { n: v.internal, r: v.internalRealised })}
            </span>
          )}
        </div>
        <table className="kv pv-kv"><tbody>
          <tr><th>{tr('Visites réalisées (12 mois)')}</th><td className="tabular">{formatInt(v.realised12)}</td></tr>
          <tr><th>{tr('Sites suivis (12 mois)')}</th><td className="tabular">{formatInt(v.sitesFollowed)}</td></tr>
          <tr><th>{tr('Formulaires reçus (12 mois)')}</th><td className="tabular">{formatInt(s.valid12)}</td></tr>
          <tr><th>{tr('Part écartée au nettoyage')}</th><td className="tabular">{s.excludedRate == null ? '—' : tr('{p} %', { p: s.excludedRate })}</td></tr>
        </tbody></table>
        {more('suivis', tr('Voir les suivis'))}
      </section>

      <section className={isTpm ? "pv-panel" : "pv-panel span-2"} aria-labelledby="pv-reports">
        <h2 className="pv-panel-title" id="pv-reports"><FileText size={16} aria-hidden="true" />{tr('Rapports et factures')}</h2>
        {r.total === 0 ? <p className="muted">{tr(isTpm ? 'Aucun rapport enregistré pour ce TPM.' : 'Aucun rapport sur les contrats de ce partenaire.')}</p> : (
          <div className="table-wrap"><table className="table pv-mini">
            <thead><tr><th scope="col">{tr('Type')}</th>{['attendu', 'soumis', 'valide', 'rejete'].map((k) => <th key={k} scope="col" className="num">{tr(REPORT_STATUS[k].label)}</th>)}</tr></thead>
            <tbody>
              {[['financier', 'Factures'], ['technique', 'Rapports techniques']].map(([k, label]) => (
                <tr key={k}><td>{tr(label)}</td>{['attendu', 'soumis', 'valide', 'rejete'].map((st) => <td key={st} className="num tabular">{reportCell(k, st)}</td>)}</tr>
              ))}
            </tbody>
          </table></div>
        )}
        {r.toValidate > 0 && <p className="pv-callout"><Info size={15} aria-hidden="true" />{tr('{n} rapport(s) soumis attendent une décision.', { n: r.toValidate })}</p>}
        {more('rapports', tr('Voir les rapports'))}
      </section>

      {isTpm && <section className="pv-panel" aria-labelledby="pv-team">
        <h2 className="pv-panel-title" id="pv-team"><Users size={16} aria-hidden="true" />{tr('Équipe et évaluation')}</h2>
        <table className="kv pv-kv"><tbody>
          <tr><th>{tr('Agents actifs')}</th><td className="tabular">{facts.team.active} <span className="muted">/ {facts.team.total}</span></td></tr>
          <tr><th>{tr('Formations suivies')}</th><td className="tabular">{facts.trainings}</td></tr>
          <tr><th>{tr('Dernière évaluation')}</th><td>{ev
            ? <span className="pv-score-cell"><strong className="tabular">{formatScore(ev.score)}</strong><StatusBadge map={BANDS} value={ev.band} /></span>
            : <span className="muted">{tr('Pas encore évalué')}</span>}</td></tr>
        </tbody></table>
        <div className="pv-links">{more('agents', tr('Voir les agents'))}{more('evaluation', tr("Voir l'évaluation"))}</div>
      </section>}

      <section className="pv-panel span-2" aria-labelledby="pv-id">
        <div className="pv-panel-head">
          <h2 className="pv-panel-title" id="pv-id"><Info size={16} aria-hidden="true" />{tr('Identité et zones d\'intervention')}</h2>
          {canEdit && <Button size="sm" variant="ghost" icon={Pencil} onClick={onEdit}>{tr('Modifier')}</Button>}
        </div>
        <div className="kv-grid">
          <table className="kv pv-kv"><tbody>
            <tr><th>{tr('Sigle')}</th><td>{p.shortName || '—'}</td></tr>
            <tr><th>{tr('NIF / STAT')}</th><td className="mono">{p.legalId || '—'}</td></tr>
            <tr><th>{tr('Adresse')}</th><td>{p.address || '—'}</td></tr>
            <tr><th>{tr('Partenaire depuis')}</th><td>{p.startedOn ? formatDate(p.startedOn) : '—'}</td></tr>
          </tbody></table>
          <table className="kv pv-kv"><tbody>
            <tr><th>{tr('Contact principal')}</th><td>{p.contactName || '—'}</td></tr>
            <tr><th>{tr('Téléphone')}</th><td>{p.contactPhone ? <a href={`tel:${p.contactPhone}`}>{p.contactPhone}</a> : '—'}</td></tr>
            <tr><th>{tr('Courriel')}</th><td>{p.contactEmail ? <a href={`mailto:${p.contactEmail}`}>{p.contactEmail}</a> : '—'}</td></tr>
            {isTpm && <tr><th>{tr('Taux journalier')}</th><td className="tabular">{p.dailyRate == null ? '—' : formatAr(p.dailyRate)}</td></tr>}
          </tbody></table>
        </div>
        <div className="pv-zones">
          <span className="stat-label">{tr('Zones d\'intervention (contrats et visites)')}</span>
          {zones.length ? (
            <div className="chips">{zones.map((z) => (
              <span key={z.path} className="chip" title={tr(z.source === 'contrat' ? 'Zone d\'un contrat' : 'District de ses visites')}>
                {z.path}<span className="muted"> · {tr(z.source === 'contrat' ? 'contrat' : 'visites')}</span>
              </span>
            ))}</div>
          ) : <span className="muted">{tr('Aucune zone connue.')}</span>}
        </div>
      </section>
    </div>
  );
}

/** Identité du partenaire (mise à jour PARTIELLE, PATCH /api/partners/:id). */
function ProfileModal({ partner, onClose, onSaved }) {
  const { tr } = useI18n();
  const toast = useToast();
  const [f, setF] = useState({
    shortName: partner.shortName || '', legalId: partner.legalId || '', address: partner.address || '',
    contactName: partner.contactName || '', contactPhone: partner.contactPhone || '', contactEmail: partner.contactEmail || '',
    startedOn: partner.startedOn || '', dailyRate: partner.dailyRate == null ? '' : String(partner.dailyRate), notes: partner.notes || '',
  });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));
  async function save() {
    setBusy(true);
    try {
      const rate = f.dailyRate.trim() === '' ? null : Number(f.dailyRate.replace(/\s/g, '').replace(',', '.'));
      if (rate != null && !(rate >= 0)) throw new Error(tr('Taux journalier invalide.'));
      await api.updatePartnerProfile(partner.id, { ...f, dailyRate: rate });
      toast.success(tr('Partenaire mis à jour.'));
      onSaved();
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  }
  return (
    <Modal open size="lg" onClose={() => !busy && onClose()} title={tr('Modifier le partenaire — {name}', { name: partner.name })}
      footer={<><Button variant="secondary" onClick={onClose} disabled={busy}>{tr('Annuler')}</Button><Button onClick={save} loading={busy}>{tr('Enregistrer')}</Button></>}>
      <div className="form-grid">
        <Field label={tr('Sigle')} htmlFor="pf-short"><input id="pf-short" className="input" maxLength={40} value={f.shortName} onChange={set('shortName')} /></Field>
        <Field label={tr('NIF / STAT')} htmlFor="pf-legal"><input id="pf-legal" className="input" maxLength={80} value={f.legalId} onChange={set('legalId')} /></Field>
        <div className="span-2"><Field label={tr('Adresse')} htmlFor="pf-addr"><input id="pf-addr" className="input" maxLength={300} value={f.address} onChange={set('address')} /></Field></div>
        <Field label={tr('Contact principal')} htmlFor="pf-cname"><input id="pf-cname" className="input" maxLength={120} value={f.contactName} onChange={set('contactName')} /></Field>
        <Field label={tr('Téléphone')} htmlFor="pf-phone"><input id="pf-phone" className="input" maxLength={40} value={f.contactPhone} onChange={set('contactPhone')} /></Field>
        <Field label={tr('Courriel')} htmlFor="pf-mail"><input id="pf-mail" type="email" className="input" maxLength={160} value={f.contactEmail} onChange={set('contactEmail')} /></Field>
        <Field label={tr('Partenaire depuis')} htmlFor="pf-since"><input id="pf-since" type="date" className="input" value={f.startedOn} onChange={set('startedOn')} /></Field>
        <Field label={tr('Taux journalier (Ar)')} htmlFor="pf-rate"><input id="pf-rate" className="input tabular" inputMode="decimal" value={f.dailyRate} onChange={set('dailyRate')} /></Field>
        <div className="span-2"><Field label={tr('Notes')} htmlFor="pf-notes"><textarea id="pf-notes" className="input" rows={3} maxLength={2000} value={f.notes} onChange={set('notes')} /></Field></div>
      </div>
    </Modal>
  );
}
