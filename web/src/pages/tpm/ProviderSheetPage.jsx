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
import { formatDate, periodLabel, REPORT_STATUS } from '../../lib/contracts.js';
import { formatAr, formatInt, monthLabel } from '../../lib/format.js';
import { BANDS, formatScore } from '../../lib/evaluation.js';
import { PROVIDER_STATUS } from '../../lib/partners.js';
import { useI18n } from '../../lib/i18n.jsx';
import ProviderContractsTab from './provider/ProviderContractsTab.jsx';
import ProviderReportsTab from './provider/ProviderReportsTab.jsx';
import ProviderFollowupsTab from './provider/ProviderFollowupsTab.jsx';
import ProviderAgentsTab from './provider/ProviderAgentsTab.jsx';
import ProviderEvaluationTab from './provider/ProviderEvaluationTab.jsx';

/**
 * Fiche prestataire 360° (lot 8, retour 28.1) — page complète #/tpm/prestataires/<id>/<onglet> :
 * en-tête (statut « actif selon contrat » et période), 4 chiffres clés, puis 7 onglets
 * (Vue d'ensemble, Contrats, Rapports & factures, Suivis effectués, Agents, Formations,
 * Évaluation du TPM). Tous les chiffres viennent du serveur (aucun recalcul ici).
 */
const TABS = [
  { id: 'apercu', label: "Vue d'ensemble" },
  { id: 'contrats', label: 'Contrats', count: 'contracts' },
  { id: 'rapports', label: 'Rapports & factures', count: 'reports' },
  { id: 'suivis', label: 'Suivis effectués' },
  { id: 'agents', label: 'Agents', count: 'agents' },
  { id: 'evaluation', label: 'Évaluation du TPM', count: 'evaluations' },
];

export default function ProviderSheetPage({ providerId, tab: tabProp, canEdit, user, onNavigate, onOpenContract }) {
  const { tr } = useI18n();
  const [newEval, setNewEval] = useState(false); // « Évaluer le prestataire » ouvre directement une nouvelle grille
  const [sheet, setSheet] = useState(null);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(false);
  const tab = TABS.some((t) => t.id === tabProp) ? tabProp : 'apercu';
  const setTab = (id) => onNavigate('tpm', 'prestataires', providerId, id === 'apercu' ? undefined : id);

  const reload = useCallback(() => {
    api.partnerSheet(providerId).then((s) => { setSheet(s); setError(null); }).catch((e) => setError(e.message));
  }, [providerId]);
  useEffect(() => { setSheet(null); reload(); }, [reload]);

  const back = () => onNavigate('tpm', 'prestataires');
  if (error) {
    return (
      <div className="section-gap">
        <Button variant="ghost" size="sm" icon={ArrowLeft} onClick={back} className="back-link">{tr('Retour aux prestataires')}</Button>
        <Alert tone="error">{error}</Alert>
      </div>
    );
  }
  if (!sheet) {
    return (
      <div className="section-gap">
        <Button variant="ghost" size="sm" icon={ArrowLeft} onClick={back} className="back-link">{tr('Retour aux prestataires')}</Button>
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
        <Button variant="ghost" size="sm" icon={ArrowLeft} onClick={back} className="back-link">{tr('Retour aux prestataires')}</Button>
        <div className="detail-head">
          <div className="pv-head">
            <Avatar name={p.name} size="lg" />
            <div>
              <h1 className="page-title">{p.name}{p.shortName && <span className="pv-short"> · {p.shortName}</span>}</h1>
              <div className="detail-meta">
                <span className="muted">{tr(p.typeLabel)}</span>
                {p.legalId && <span className="mono">{p.legalId}</span>}
                <StatusBadge map={PROVIDER_STATUS} value={st.state} />
                {st.from && (
                  <span className="muted">
                    {periodLabel(st.from, st.to, tr)} · {st.contracts.map((c) => c.numero).join(', ')}
                  </span>
                )}
                {st.state === 'actif' && st.endingSoon && (
                  <Badge tone="orange" icon={AlertTriangle}>{tr(st.daysLeft > 1 ? 'Fin du contrat dans {n} jours' : 'Fin du contrat dans {n} jour', { n: st.daysLeft })}</Badge>
                )}
                {!p.active && <Badge>{tr('Fiche inactive')}</Badge>}
              </div>
            </div>
          </div>
          <div className="toolbar">
            {canEdit && <Button variant="secondary" icon={Pencil} onClick={() => setEditing(true)}>{tr('Modifier le prestataire')}</Button>}
            {canEdit && <Button icon={ClipboardCheck} onClick={() => { setNewEval(true); setTab('evaluation'); }}>{tr('Évaluer le prestataire')}</Button>}
          </div>
        </div>
      </div>

      <Stats items={[
        { label: tr('Budget suivi des contrats'), value: formatAr(b.monitoringBudget),
          foot: b.contracts ? tr('Total des accords : {amount}', { amount: formatAr(b.total) }) : tr('Aucun contrat rattaché') },
        { label: tr('Réalisé validé (ce prestataire)'), value: formatAr(b.providerActual),
          foot: b.providerShare == null ? tr('En attente de validation : {amount}', { amount: formatAr(b.providerPending) })
            : tr('{p} % du budget suivi · en attente : {amount}', { p: b.providerShare, amount: formatAr(b.providerPending) }) },
        { label: tr('Visites réalisées (12 mois)'), value: formatInt(v.realised12),
          foot: v.assigned ? tr('Ce mois : {r} sur {a} ({p} %)', { r: v.realised, a: v.assigned, p: v.rate }) : tr('Ce mois : aucune visite affectée') },
        { label: tr('Note du prestataire'), value: ev ? formatScore(ev.score) : '—',
          children: ev ? <span style={{ marginTop: 4 }}><StatusBadge map={BANDS} value={ev.band} /></span> : null,
          foot: ev ? tr('Évaluation {period}', { period: periodLabel(`${ev.from}-01`, `${ev.to}-01`, tr) }) : tr('Pas encore évalué') },
      ]} />

      <Card>
        <div className="tabs-bar">
          <div className="tabs" role="tablist" aria-label={tr('Sections du prestataire')}>
            {TABS.map((t) => (
              <button key={t.id} role="tab" aria-selected={tab === t.id} className="tab" onClick={() => setTab(t.id)}>
                {tr(t.label)}{t.count && counts[t.count] > 0 && <span className="count"> {counts[t.count]}</span>}
              </button>
            ))}
          </div>
        </div>
        {tab === 'apercu' && <Overview sheet={sheet} onTab={setTab} canEdit={canEdit} onEdit={() => setEditing(true)} />}
        {tab === 'contrats' && <ProviderContractsTab providerId={providerId} onOpenContract={onOpenContract} />}
        {tab === 'rapports' && <ProviderReportsTab providerId={providerId} onNavigate={onNavigate} onChanged={reload} />}
        {tab === 'suivis' && <ProviderFollowupsTab providerId={providerId} onNavigate={onNavigate} />}
        {tab === 'agents' && <ProviderAgentsTab providerId={providerId} canEdit={canEdit} onChanged={reload} />}
        {tab === 'evaluation' && <ProviderEvaluationTab providerId={providerId} provider={p} canEdit={canEdit} user={user} onChanged={reload}
          startNew={newEval} onStarted={() => setNewEval(false)} />}
      </Card>

      {editing && <ProfileModal partner={p} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); reload(); }} />}
    </div>
  );
}

/** Vue d'ensemble : budget, activité de terrain, rapports, équipe, identité et zones. */
function Overview({ sheet, onTab, canEdit, onEdit }) {
  const { tr } = useI18n();
  const { partner: p, facts, zones } = sheet;
  const b = facts.budget; const v = facts.visits; const s = facts.submissions; const r = facts.reports; const ev = facts.evaluation;
  const reportCell = (kind, status) => (r[kind][status] ? r[kind][status] : <span className="cell-empty">0</span>);
  const more = (id, label) => <button type="button" className="inline-link pv-more" onClick={() => onTab(id)}>{label} <ChevronRight size={14} aria-hidden="true" /></button>;

  return (
    <div className="card-body pv-grid">
      <section className="pv-panel" aria-labelledby="pv-budget">
        <h2 className="pv-panel-title" id="pv-budget"><Wallet size={16} aria-hidden="true" />{tr('Budget et consommation')}</h2>
        {b.contracts === 0 ? <p className="muted">{tr('Aucun contrat rattaché à ce prestataire (titulaire, plan de collecte, rapport ou visite).')}</p> : (
          <>
            <table className="kv pv-kv"><tbody>
              <tr><th>{tr('Contrats rattachés')}</th><td>{b.contracts}{b.monitoringContracts !== b.contracts && <span className="muted"> · {tr('{n} de suivi', { n: b.monitoringContracts })}</span>}</td></tr>
              <tr><th>{tr('Total des accords')}</th><td className="tabular">{formatAr(b.total)}</td></tr>
              <tr><th>{tr('Budget suivi (ligne IV)')}</th><td className="tabular">{formatAr(b.monitoringBudget)}</td></tr>
              <tr><th>{tr('Planifié (plans de collecte)')}</th><td className="tabular">{formatAr(b.providerPlanned)}</td></tr>
              <tr><th>{tr('Réalisé validé (ce prestataire)')}</th><td className="tabular"><strong>{formatAr(b.providerActual)}</strong></td></tr>
              <tr><th>{tr('En attente de validation')}</th><td className="tabular">{formatAr(b.providerPending)}</td></tr>
            </tbody></table>
            {b.consumption != null && (
              <div className="pv-usage">
                <span className="stat-label">{tr('Consommation du budget suivi (tous prestataires)')}</span>
                <Usage rate={b.consumption / 100} />
              </div>
            )}
          </>
        )}
        {more('contrats', tr('Voir les contrats'))}
      </section>

      <section className="pv-panel" aria-labelledby="pv-field">
        <h2 className="pv-panel-title" id="pv-field"><MapPin size={16} aria-hidden="true" />{tr('Suivis effectués')}</h2>
        <div className="pv-month">
          <span className="stat-label">{tr('Visites de {month}', { month: monthLabel(v.month) })}</span>
          {v.assigned ? (
            <><Progress value={v.rate || 0} label={tr('Visites réalisées sur affectées')} />
              <span className="tabular">{tr('{r} réalisées sur {a} affectées ({p} %)', { r: v.realised, a: v.assigned, p: v.rate })}</span></>
          ) : <span className="muted">{tr('— aucune visite affectée ce mois')}</span>}
        </div>
        <table className="kv pv-kv"><tbody>
          <tr><th>{tr('Visites réalisées (12 mois)')}</th><td className="tabular">{formatInt(v.realised12)}</td></tr>
          <tr><th>{tr('Sites suivis (12 mois)')}</th><td className="tabular">{formatInt(v.sitesFollowed)}</td></tr>
          <tr><th>{tr('Formulaires reçus (12 mois)')}</th><td className="tabular">{formatInt(s.valid12)}</td></tr>
          <tr><th>{tr('Part écartée au nettoyage')}</th><td className="tabular">{s.excludedRate == null ? '—' : tr('{p} %', { p: s.excludedRate })}</td></tr>
        </tbody></table>
        {more('suivis', tr('Voir les suivis'))}
      </section>

      <section className="pv-panel" aria-labelledby="pv-reports">
        <h2 className="pv-panel-title" id="pv-reports"><FileText size={16} aria-hidden="true" />{tr('Rapports et factures')}</h2>
        {r.total === 0 ? <p className="muted">{tr('Aucun rapport enregistré pour ce prestataire.')}</p> : (
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

      <section className="pv-panel" aria-labelledby="pv-team">
        <h2 className="pv-panel-title" id="pv-team"><Users size={16} aria-hidden="true" />{tr('Équipe et évaluation')}</h2>
        <table className="kv pv-kv"><tbody>
          <tr><th>{tr('Agents actifs')}</th><td className="tabular">{facts.team.active} <span className="muted">/ {facts.team.total}</span></td></tr>
          <tr><th>{tr('Formations suivies')}</th><td className="tabular">{facts.trainings}</td></tr>
          <tr><th>{tr('Dernière évaluation')}</th><td>{ev
            ? <span className="pv-score-cell"><strong className="tabular">{formatScore(ev.score)}</strong><StatusBadge map={BANDS} value={ev.band} /></span>
            : <span className="muted">{tr('Pas encore évalué')}</span>}</td></tr>
        </tbody></table>
        <div className="pv-links">{more('agents', tr('Voir les agents'))}{more('evaluation', tr("Voir l'évaluation"))}</div>
      </section>

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
            <tr><th>{tr('Taux journalier')}</th><td className="tabular">{p.dailyRate == null ? '—' : formatAr(p.dailyRate)}</td></tr>
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
      toast.success(tr('Prestataire mis à jour.'));
      onSaved();
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  }
  return (
    <Modal open size="lg" onClose={() => !busy && onClose()} title={tr('Modifier le prestataire — {name}', { name: partner.name })}
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
