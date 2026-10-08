import React, { useCallback, useEffect, useState } from 'react';
import {
  ArrowLeft, Pencil, Send, ShieldCheck, X, FilePlus2, RefreshCw, Ban, Info, AlertCircle, ExternalLink,
  Download, MapPin, ChevronDown, ChevronRight,
} from 'lucide-react';
import { api } from '../../api/client.js';
import { Alert, Badge, Button, Card, CardHeader, EmptyState, Skeleton, Usage } from '../../components/ui.jsx';
import { BudgetItemsView } from '../../components/BudgetItems.jsx';
import { useToast } from '../../components/Toast.jsx';
import { formatAr, formatDateTime, initials } from '../../lib/format.js';
import {
  AMENDMENT_STATUS, CONTRACT_STATUS, HISTORY_LABELS, amendmentCode, contractFlags, formatDate, periodLabel,
} from '../../lib/contracts.js';
import { SubmitDialog, DecisionDialog, RenewDialog, TerminateDialog } from './ContractDialogs.jsx';

const TABS = [
  { id: 'budget', label: 'Détail budgétaire' },
  { id: 'forecast', label: 'Prévision de dépense' },
  { id: 'amendments', label: 'Avenants' },
  { id: 'history', label: 'Historique' },
];

export default function ContractDetailPage({ contractId, onBack, onOpen, onEdit, onAmend }) {
  const toast = useToast();
  const [detail, setDetail] = useState(null);
  const [history, setHistory] = useState(null);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState('budget');
  const [dialog, setDialog] = useState(null);
  const [downloading, setDownloading] = useState(false);

  async function downloadXlsx() {
    setDownloading(true);
    try { await api.downloadBudgetXlsx(contractId); }
    catch (e) { toast.error(e.message); }
    finally { setDownloading(false); }
  }

  const load = useCallback(async () => {
    setError(null);
    try { setDetail(await api.getContract(contractId)); }
    catch (err) { setError(err.message); }
  }, [contractId]);

  useEffect(() => { setDetail(null); setHistory(null); setTab('budget'); load(); }, [contractId, load]);
  useEffect(() => {
    if (tab === 'history' && !history) api.getContractHistory(contractId).then(setHistory).catch((e) => toast.error(e.message));
  }, [tab, history, contractId, toast]);

  function afterAction() { setDialog(null); setHistory(null); load(); }

  if (error) {
    return (
      <div className="section-gap">
        <Button variant="ghost" size="sm" icon={ArrowLeft} onClick={onBack} className="back-link">Retour aux contrats</Button>
        <Card><EmptyState icon={AlertCircle} title="Contrat introuvable" action={<Button variant="secondary" onClick={load}>Réessayer</Button>}>{error}</EmptyState></Card>
      </div>
    );
  }
  if (!detail) {
    return (
      <div className="section-gap">
        <Skeleton width={180} height={16} />
        <Card><div className="card-body"><Skeleton width="40%" height={28} /><Skeleton width="60%" height={16} style={{ marginTop: 12 }} /></div></Card>
        <Card><div className="card-body"><Skeleton height={200} /></div></Card>
      </div>
    );
  }

  const c = detail.contract;
  const a = detail.actions;
  const st = CONTRACT_STATUS[c.status];
  const flags = contractFlags(c);
  const mon = detail.budget.monitoring;
  const pending = detail.amendments.find((x) => x.status === 'en_validation');

  return (
    <div className="section-gap">
      <div>
        <Button variant="ghost" size="sm" icon={ArrowLeft} onClick={onBack} className="back-link">Retour aux contrats</Button>
        <div className="detail-head">
          <div>
            <h1 className="page-title">{c.partnerName}</h1>
            <div className="detail-meta">
              <span className="mono">{c.reference || c.numero}</span>
              <Badge tone={st.tone} dot>{st.label}</Badge>
              {flags.map((f) => <Badge key={f.key} tone={f.tone}>{f.label}</Badge>)}
              <span className="muted">{detail.activities.map((x) => x.label).join(', ') || 'Aucune activité'}</span>
            </div>
          </div>
          <div className="toolbar">
            {a.edit && <Button variant="secondary" icon={Pencil} onClick={() => onEdit(contractId)}>Modifier</Button>}
            {a.submit && <Button icon={Send} onClick={() => setDialog({ type: 'submit' })}>Soumettre</Button>}
            {a.decide && <>
              <Button variant="secondary" icon={X} onClick={() => setDialog({ type: 'decide', approve: false })}>Rejeter</Button>
              <Button icon={ShieldCheck} onClick={() => setDialog({ type: 'decide', approve: true })}>Approuver</Button>
            </>}
            {a.amend && <Button variant="secondary" icon={FilePlus2} onClick={() => onAmend(contractId)}>Avenant</Button>}
            {a.renew && <Button variant="secondary" icon={RefreshCw} onClick={() => setDialog({ type: 'renew' })}>Renouveler</Button>}
            {a.terminate && <Button variant="secondary" icon={Ban} onClick={() => setDialog({ type: 'terminate' })}>Résilier</Button>}
          </div>
        </div>
      </div>

      {c.status === 'resilie' && <Alert tone="warn" icon={Info}>Contrat résilié le {formatDate(c.terminationDate)} — {c.terminationReason}</Alert>}
      {a.decideAmendment && pending && (
        <Alert tone="info" icon={Info}>L'avenant {amendmentCode(pending.number)} attend votre validation.{' '}
          <button type="button" className="inline-link" onClick={() => setTab('amendments')}>Voir l'avenant</button></Alert>
      )}
      {detail.renewedFrom && <div className="note"><Info size={18} aria-hidden="true" /><span>Renouvellement de <button type="button" className="inline-link" onClick={() => onOpen(detail.renewedFrom.id)}>{detail.renewedFrom.numero}</button>.</span></div>}
      {detail.renewal && <div className="note"><Info size={18} aria-hidden="true" /><span>Renouvelé par <button type="button" className="inline-link" onClick={() => onOpen(detail.renewal.id)}>{detail.renewal.numero}</button>.</span></div>}

      {/* Identification */}
      <Card>
        <div className="kv-grid">
          <table className="kv"><tbody>
            <tr><th>N° interne</th><td className="mono">{c.numero}</td></tr>
            <tr><th>N° FLA</th><td className="mono">{c.numeroFla || '—'}</td></tr>
            <tr><th>N° PO</th><td className="mono">{c.numeroPo || '—'}</td></tr>
            <tr><th>N° Vendor</th><td className="mono">{c.numeroVendor || '—'}</td></tr>
          </tbody></table>
          <table className="kv"><tbody>
            <tr><th>Période</th><td>{periodLabel(c.dateDebut, c.dateFin)} <span className="muted">({formatDate(c.dateDebut)} – {formatDate(c.dateFin)})</span></td></tr>
            <tr><th>Valideur</th><td>{c.validatorEmail || '—'}</td></tr>
            <tr><th>Avenants</th><td>{c.amendmentCount}</td></tr>
            <tr><th>Échéance</th><td>{c.status === 'actif' ? (c.daysToEnd >= 0 ? `Dans ${c.daysToEnd} jour${c.daysToEnd > 1 ? 's' : ''}` : `Dépassée de ${-c.daysToEnd} jour(s)`) : '—'}</td></tr>
          </tbody></table>
        </div>
      </Card>

      {/* Total de l'accord (barème) + barème mensuel + consommation Suivi */}
      <Card>
        <div className="card-body" style={{ display: 'flex', gap: 24, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ minWidth: 200 }}>
            <div className="stat-label">Total de l'accord (plafond)</div>
            <div className="stat-value">{formatAr(detail.budget.total.grand)}</div>
            <div className="field-hint">dont commission {Math.round(detail.budget.managementFee.pct * 1000) / 10} % = {formatAr(detail.budget.managementFee.amount)}</div>
          </div>
          <div style={{ minWidth: 180 }}>
            <div className="stat-label">Barème mensuel</div>
            <div className="stat-value">{formatAr(c.monthlyCeiling)}</div>
            <div className="field-hint">total ÷ {c.periodMonths} mois</div>
          </div>
          <div style={{ minWidth: 160 }}>
            <div className="stat-label">Budget Suivi/TPM</div>
            <div className="stat-value">{formatAr(mon.budget)}</div>
          </div>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div className="stat-label" style={{ marginBottom: 6 }}>Consommation du budget Suivi ({formatAr(mon.spent)} justifié)</div>
            <Usage rate={mon.rate} />
            <div className="field-hint" style={{ marginTop: 4 }}>
              Alimentée par les rapports financiers validés dans <ExternalLink size={12} style={{ verticalAlign: -1 }} aria-hidden="true" /> Partenaires &amp; TPM › Rapports.
            </div>
          </div>
        </div>
      </Card>

      {/* Zones d'intervention affectées au prestataire */}
      {(detail.areas || []).length > 0 && (
        <Card>
          <CardHeader title="Zones d'intervention" subtitle="Districts / communes affectés au prestataire." />
          <div className="card-body">
            <div className="chips areas-chips">
              {detail.areas.map((z) => (
                <span key={z.adminAreaId || z.path} className="chip is-static"><MapPin size={14} aria-hidden="true" /> {z.path}</span>
              ))}
            </div>
          </div>
        </Card>
      )}

      <Card>
        <div className="tabs-bar">
          <div className="tabs" role="tablist">
            {TABS.map((t) => (
              <button key={t.id} role="tab" aria-selected={tab === t.id} className="tab" onClick={() => setTab(t.id)}>
                {t.label}{t.id === 'amendments' && detail.amendments.length > 0 && <span className="count"> {detail.amendments.length}</span>}
              </button>
            ))}
          </div>
          {tab === 'budget' && (
            <Button size="sm" variant="secondary" icon={Download} loading={downloading} onClick={downloadXlsx} className="tabs-action">
              Télécharger Excel
            </Button>
          )}
        </div>
        {tab === 'budget' && <BudgetItemsView budget={detail.budget} monthlyCeiling={c.monthlyCeiling} />}
        {tab === 'forecast' && <ForecastTab contractId={contractId} dateFin={c.dateFin} />}
        {tab === 'amendments' && <AmendmentsTab detail={detail} canDecide={a.decideAmendment} onDecide={(am, approve) => setDialog({ type: 'decideAmendment', amendment: am, approve })} onAdd={a.amend ? () => onAmend(contractId) : null} />}
        {tab === 'history' && <HistoryTab history={history} />}
      </Card>

      {dialog?.type === 'submit' && <SubmitDialog open onClose={() => setDialog(null)} detail={detail} onDone={afterAction} />}
      {dialog?.type === 'decide' && <DecisionDialog open onClose={() => setDialog(null)} detail={detail} approve={dialog.approve} onDone={afterAction} />}
      {dialog?.type === 'decideAmendment' && <DecisionDialog open onClose={() => setDialog(null)} detail={detail} amendment={dialog.amendment} approve={dialog.approve} onDone={afterAction} />}
      {dialog?.type === 'renew' && <RenewDialog open onClose={() => setDialog(null)} detail={detail} onDone={(id) => { setDialog(null); onOpen(id); }} />}
      {dialog?.type === 'terminate' && <TerminateDialog open onClose={() => setDialog(null)} detail={detail} onDone={afterAction} />}
    </div>
  );
}

const pct = (v) => `${Math.round((Number(v) || 0) * 1000) / 10} %`;
const itemKey = (it) => `${it.lineCode}|${String(it.description).trim().toLowerCase()}`;

function ScalarRow({ label, before, after }) {
  if (String(before) === String(after)) return null;
  return (
    <tr className="diff-changed">
      <td className="diff-label">{label}</td>
      <td className="diff-before">{before}</td>
      <td className="diff-arrow" aria-hidden="true">→</td>
      <td className="diff-after">{after}</td>
    </tr>
  );
}

function AmendmentDiff({ before, after }) {
  // Listes (activités, zones)
  const listDiff = (b = [], a = []) => {
    const bs = new Set(b); const as = new Set(a);
    return { added: a.filter((x) => !bs.has(x)), removed: b.filter((x) => !as.has(x)) };
  };
  const acts = listDiff(before.activityLabels, after.activityLabels);
  const zones = listDiff(before.areaPaths, after.areaPaths);
  // Postes
  const bm = new Map((before.items || []).map((it) => [itemKey(it), it]));
  const am = new Map((after.items || []).map((it) => [itemKey(it), it]));
  const addedItems = []; const removedItems = []; const changedItems = [];
  for (const [k, it] of am) if (!bm.has(k)) addedItems.push(it);
  for (const [k, it] of bm) if (!am.has(k)) removedItems.push(it);
  for (const [k, it] of am) { const o = bm.get(k); if (o && (Number(o.unitCount) !== Number(it.unitCount) || Number(o.unitCost) !== Number(it.unitCost))) changedItems.push({ o, n: it }); }

  const scalarChanged = before.dateDebut !== after.dateDebut || before.dateFin !== after.dateFin
    || Number(before.feePct) !== Number(after.feePct) || Number(before.grandTotal) !== Number(after.grandTotal);
  const nothing = !scalarChanged && !acts.added.length && !acts.removed.length && !zones.added.length && !zones.removed.length
    && !addedItems.length && !removedItems.length && !changedItems.length;

  if (nothing) return <p className="muted" style={{ fontSize: 14, marginTop: 8 }}>Aucun changement détecté par rapport à l'état précédent.</p>;

  return (
    <div className="amend-diff">
      {scalarChanged && (
        <div className="table-wrap">
          <table className="diff-table">
            <thead><tr><th>Champ</th><th>Avant</th><th aria-hidden="true" /><th>Après</th></tr></thead>
            <tbody>
              <ScalarRow label="Date de début" before={formatDate(before.dateDebut)} after={formatDate(after.dateDebut)} />
              <ScalarRow label="Date de fin" before={formatDate(before.dateFin)} after={formatDate(after.dateFin)} />
              <ScalarRow label="Commission de gestion" before={pct(before.feePct)} after={pct(after.feePct)} />
              <ScalarRow label="Total de l'accord" before={formatAr(before.grandTotal)} after={formatAr(after.grandTotal)} />
            </tbody>
          </table>
        </div>
      )}

      {(acts.added.length > 0 || acts.removed.length > 0) && (
        <div className="diff-chips-row"><span className="diff-label">Activités</span>
          {acts.added.map((x) => <span key={`a${x}`} className="chip chip-add">+ {x}</span>)}
          {acts.removed.map((x) => <span key={`r${x}`} className="chip chip-del">− {x}</span>)}
        </div>
      )}
      {(zones.added.length > 0 || zones.removed.length > 0) && (
        <div className="diff-chips-row"><span className="diff-label">Zones</span>
          {zones.added.map((x) => <span key={`a${x}`} className="chip chip-add">+ {x}</span>)}
          {zones.removed.map((x) => <span key={`r${x}`} className="chip chip-del">− {x}</span>)}
        </div>
      )}

      {(addedItems.length > 0 || removedItems.length > 0 || changedItems.length > 0) && (
        <div className="table-wrap" style={{ marginTop: 4 }}>
          <table className="table"><thead><tr><th>Poste</th><th className="num">Avant</th><th className="num">Après</th></tr></thead>
            <tbody>
              {changedItems.map(({ o, n }) => (
                <tr key={`c${itemKey(n)}`}>
                  <td>{n.description}</td>
                  <td className="num">{o.unitCount} × {formatAr(o.unitCost)} = {formatAr(o.unitCount * o.unitCost)}</td>
                  <td className="num"><strong>{n.unitCount} × {formatAr(n.unitCost)} = {formatAr(n.unitCount * n.unitCost)}</strong></td>
                </tr>
              ))}
              {addedItems.map((it) => (
                <tr key={`a${itemKey(it)}`} className="diff-row-add"><td>+ {it.description}</td><td className="num cell-empty">—</td><td className="num">{it.unitCount} × {formatAr(it.unitCost)} = {formatAr(it.unitCount * it.unitCost)}</td></tr>
              ))}
              {removedItems.map((it) => (
                <tr key={`d${itemKey(it)}`} className="diff-row-del"><td>− {it.description}</td><td className="num">{it.unitCount} × {formatAr(it.unitCost)} = {formatAr(it.unitCount * it.unitCost)}</td><td className="num cell-empty">retiré</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// Résumé compact des changements d'un avenant, pour la colonne « Ce qui a changé ».
function amendmentSummary(am) {
  const ch = am.budgetChanges || {};
  if (ch.before && ch.after) {
    const b = ch.before; const a = ch.after;
    const parts = [];
    if (b.dateFin !== a.dateFin) parts.push('échéance');
    if (Number(b.feePct) !== Number(a.feePct)) parts.push('commission');
    if (Number(b.grandTotal) !== Number(a.grandTotal)) parts.push('montant');
    const zAdd = (a.areaPaths || []).filter((x) => !(b.areaPaths || []).includes(x)).length;
    const zDel = (b.areaPaths || []).filter((x) => !(a.areaPaths || []).includes(x)).length;
    if (zAdd + zDel) parts.push(`${zAdd + zDel} zone${zAdd + zDel > 1 ? 's' : ''}`);
    const bk = new Set((b.items || []).map(itemKey)); const ak = new Set((a.items || []).map(itemKey));
    const changed = (a.items || []).filter((it) => { const o = (b.items || []).find((x) => itemKey(x) === itemKey(it)); return o && (Number(o.unitCount) !== Number(it.unitCount) || Number(o.unitCost) !== Number(it.unitCost)); }).length;
    const added = (a.items || []).filter((it) => !bk.has(itemKey(it))).length;
    const removed = (b.items || []).filter((it) => !ak.has(itemKey(it))).length;
    const nItems = changed + added + removed;
    if (nItems) parts.push(`${nItems} poste${nItems > 1 ? 's' : ''}`);
    return parts.length ? parts.join(' · ') : 'Aucun changement';
  }
  if (am.newDateFin) return `Échéance → ${formatDate(am.newDateFin)}`;
  if (ch.newFeePct != null) return `Commission → ${pct(ch.newFeePct)}`;
  return 'Détail non enregistré';
}

function AmendmentsTab({ detail, canDecide, onDecide, onAdd }) {
  const { amendments } = detail;
  const [openId, setOpenId] = useState(null);
  if (amendments.length === 0) {
    return <EmptyState icon={FilePlus2} title="Aucun avenant" action={onAdd && <Button icon={FilePlus2} onClick={onAdd}>Créer un avenant</Button>}>Un avenant reprend le processus complet du contrat ; chaque avenant apparaîtra ici avec le détail de ce qui a changé.</EmptyState>;
  }
  // Ordre chronologique (AM01, AM02, …) pour lire l'évolution.
  const ordered = [...amendments].sort((a, b) => a.number - b.number);
  return (
    <div className="amend-wrap">
      {onAdd && <div className="amend-toolbar"><Button size="sm" icon={FilePlus2} onClick={onAdd}>Créer un avenant</Button></div>}
      <div className="table-wrap">
        <table className="table grid amend-table">
          <thead>
            <tr>
              <th scope="col" style={{ width: 32 }}><span className="sr-only">Détail</span></th>
              <th scope="col" style={{ width: 90 }}>Avenant</th>
              <th scope="col">Date</th>
              <th scope="col">Statut</th>
              <th scope="col">Ce qui a changé</th>
              <th scope="col">Justification</th>
            </tr>
          </thead>
          <tbody>
            {ordered.map((am) => {
              const stat = AMENDMENT_STATUS[am.status];
              const ch = am.budgetChanges || {};
              const hasDiff = ch.before && ch.after;
              const isOpen = openId === am.id;
              return (
                <React.Fragment key={am.id}>
                  <tr className={`clickable ${isOpen ? 'is-selected' : ''}`} onClick={() => setOpenId(isOpen ? null : am.id)}
                    aria-expanded={isOpen} title="Cliquez pour voir le détail">
                    <td className="amend-caret">{isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</td>
                    <td><strong className="amend-code">{amendmentCode(am.number)}</strong></td>
                    <td className="nowrap">{formatDate(am.createdAt)}</td>
                    <td><Badge tone={stat.tone} dot>{stat.label}</Badge></td>
                    <td className="amend-sum">{amendmentSummary(am)}</td>
                    <td className="amend-just-cell">{am.justification}</td>
                  </tr>
                  {isOpen && (
                    <tr className="amend-detail-row">
                      <td colSpan={6}>
                        <div className="amend-detail">
                          <div className="amend-detail-head">
                            <div>
                              <strong className="amend-code">{amendmentCode(am.number)}</strong>
                              <span className="muted" style={{ fontSize: 14, marginLeft: 8 }}>Demandé le {formatDateTime(am.createdAt)} · {am.createdByEmail}</span>
                            </div>
                            {canDecide && am.status === 'en_validation' && (
                              <div className="toolbar">
                                <Button size="sm" variant="secondary" icon={X} onClick={(e) => { e.stopPropagation(); onDecide(am, false); }}>Rejeter</Button>
                                <Button size="sm" icon={ShieldCheck} onClick={(e) => { e.stopPropagation(); onDecide(am, true); }}>Approuver</Button>
                              </div>
                            )}
                          </div>
                          <p className="amend-just">« {am.justification} »</p>
                          <div className="amend-diff-title">Ce qui a changé</div>
                          {hasDiff
                            ? <AmendmentDiff before={ch.before} after={ch.after} />
                            : (
                              <div className="muted" style={{ fontSize: 14 }}>
                                {am.newDateFin ? <>Nouvelle échéance : <strong>{formatDate(am.newDateFin)}</strong>. </> : null}
                                {ch.newFeePct != null ? <>Commission de gestion : <strong>{pct(ch.newFeePct)}</strong>.</> : null}
                                {!am.newDateFin && ch.newFeePct == null && 'Détail du changement non enregistré (avenant ancien format).'}
                              </div>
                            )}
                          {am.decidedAt && <div className="muted" style={{ fontSize: 14, marginTop: 10 }}>Décision : {formatDateTime(am.decidedAt)} · {am.decidedByEmail}{am.decisionComment ? ` — ${am.decisionComment}` : ''}</div>}
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function HistoryTab({ history }) {
  if (!history) return <div style={{ padding: 20 }}><Skeleton height={120} /></div>;
  if (history.length === 0) return <EmptyState icon={Info} title="Aucun évènement" />;
  return (
    <ol style={{ listStyle: 'none', margin: 0, padding: 20, display: 'grid', gap: 0 }}>
      {history.map((h, i) => (
        <li key={h.id} style={{ display: 'flex', gap: 12, paddingBottom: i === history.length - 1 ? 0 : 16 }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <span className="avatar" aria-hidden="true">{initials(h.actorEmail)}</span>
            {i < history.length - 1 && <span style={{ flex: 1, width: 2, background: 'var(--border)', marginTop: 4 }} />}
          </div>
          <div style={{ paddingTop: 4 }}>
            <div><strong>{HISTORY_LABELS[h.action] || h.action}</strong></div>
            <div className="muted" style={{ fontSize: 14 }}>{formatDateTime(h.createdAt)} · {h.actorEmail}</div>
            {h.comment && <div style={{ marginTop: 4 }}>« {h.comment} »</div>}
          </div>
        </li>
      ))}
    </ol>
  );
}

/**
 * Prévision de dépense — projette, mois par mois, le réalisé Suivi/TPM jusqu'à
 * la fin du contrat (ou jusqu'à un mois cible) au rythme moyen observé.
 * Lecture seule, recalculée côté serveur (forecast.js).
 */
function ForecastTab({ contractId, dateFin }) {
  const toast = useToast();
  const [until, setUntil] = useState('');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true; setLoading(true);
    api.contractForecast(contractId, until || undefined)
      .then((d) => { if (alive) { setData(d); setLoading(false); } })
      .catch((e) => { if (alive) { toast.error(e.message); setLoading(false); } });
    return () => { alive = false; };
  }, [contractId, until, toast]);

  if (loading && !data) return <div style={{ padding: 20 }}><Skeleton height={160} /></div>;
  if (!data) return <EmptyState icon={Info} title="Prévision indisponible" />;

  const pct = data.budget > 0 ? Math.min(1.2, data.projectedTotal / data.budget) : 0;
  return (
    <div style={{ padding: 20, display: 'grid', gap: 18 }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <label className="field" style={{ margin: 0 }}>
          <span className="field-label">Projeter jusqu'au mois</span>
          <input className="input" type="month" value={until} max={dateFin ? String(dateFin).slice(0, 7) : undefined}
            onChange={(e) => setUntil(e.target.value)} style={{ width: 180 }} />
        </label>
        {until && <Button size="sm" variant="ghost" onClick={() => setUntil('')}>Jusqu'à la fin du contrat</Button>}
        <span className="hint">Rythme moyen : {formatAr(data.avgMonthlyBurn)} / mois · {data.elapsedMonths} mois écoulé(s) · cible {data.until}</span>
      </div>

      <div className="stats">
        <div className="stat"><div className="stat-label">Budget Suivi/TPM</div><div className="stat-value">{formatAr(data.budget)}</div></div>
        <div className="stat"><div className="stat-label">Réalisé à ce jour</div><div className="stat-value">{formatAr(data.realizedToDate)}</div></div>
        <div className="stat"><div className="stat-label">Projeté ({data.until})</div><div className="stat-value" style={data.willOverspend ? { color: 'var(--red)' } : undefined}>{formatAr(data.projectedTotal)}</div></div>
        <div className="stat"><div className="stat-label">{data.willOverspend ? 'Dépassement projeté' : 'Restant projeté'}</div><div className="stat-value" style={data.willOverspend ? { color: 'var(--red)' } : { color: 'var(--green)' }}>{formatAr(data.willOverspend ? data.projectedOverrun : data.projectedRemaining)}</div></div>
      </div>

      <div className="progress" style={{ height: 10 }} aria-label="Taux de consommation projeté">
        <span className={pct >= 1 ? 'is-over' : (pct >= 0.85 ? 'is-high' : '')} style={{ width: `${Math.min(100, pct * 100)}%` }} />
      </div>

      {data.willOverspend
        ? <Alert tone="warn" icon={AlertCircle}>Au rythme actuel, le budget Suivi/TPM serait dépassé de <strong>{formatAr(data.projectedOverrun)}</strong> d'ici {data.until}.</Alert>
        : <Alert tone="info" icon={Info}>Au rythme actuel, il resterait <strong>{formatAr(data.projectedRemaining)}</strong> sur le budget Suivi/TPM à {data.until}.</Alert>}

      <div className="table-wrap"><table className="table">
        <thead><tr><th scope="col">Mois</th><th scope="col">Nature</th><th scope="col" className="num">Dépense du mois</th><th scope="col" className="num">Cumulé</th><th scope="col" className="num">Restant</th></tr></thead>
        <tbody>
          {data.series.map((s) => (
            <tr key={s.month}>
              <td className="tabular"><strong>{s.month}</strong></td>
              <td>{s.isFuture ? <Badge tone="blue">Projeté</Badge> : <Badge tone="green">Réalisé</Badge>}</td>
              <td className="num tabular">{formatAr(s.amount)}</td>
              <td className="num tabular">{formatAr(s.cumulative)}</td>
              <td className="num tabular" style={s.remaining < 0 ? { color: 'var(--red)' } : undefined}>{formatAr(s.remaining)}</td>
            </tr>
          ))}
        </tbody>
      </table></div>
    </div>
  );
}
