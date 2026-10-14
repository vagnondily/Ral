import React, { useCallback, useEffect, useState } from 'react';
import {
  ArrowLeft, Pencil, Send, ShieldCheck, X, FilePlus2, RefreshCw, Ban, Info, AlertCircle, ExternalLink,
  Download, ChevronDown, ChevronRight, Trash2, CheckCircle2, AlertTriangle,
} from 'lucide-react';
import { api } from '../../api/client.js';
import { Alert, Badge, Button, Card, CardHeader, EmptyState, Skeleton, Usage } from '../../components/ui.jsx';
import { BudgetItemsView } from '../../components/BudgetItems.jsx';
import { useToast } from '../../components/Toast.jsx';
import { useI18n } from '../../lib/i18n.jsx';
import { formatAr, formatDateTime, initials } from '../../lib/format.js';
import {
  AMENDMENT_STATUS, CONTRACT_STATUS, HISTORY_LABELS, amendmentCode, contractFlags, formatDate, periodLabel, richText,
} from '../../lib/contracts.js';
import { SubmitDialog, DecisionDialog, RenewDialog, TerminateDialog } from './ContractDialogs.jsx';
import DeleteDialog from '../../components/DeleteDialog.jsx';

const TABS = [
  { id: 'budget', label: 'Détail budgétaire' },
  { id: 'forecast', label: 'Prévision de dépense' },
  { id: 'amendments', label: 'Avenants' },
  { id: 'history', label: 'Historique' },
];

export default function ContractDetailPage({ contractId, onBack, onOpen, onEdit, onAmend }) {
  const { tr } = useI18n();
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
        <Button variant="ghost" size="sm" icon={ArrowLeft} onClick={onBack} className="back-link">{tr('Retour aux contrats')}</Button>
        <Card><EmptyState icon={AlertCircle} title={tr('Contrat introuvable')} action={<Button variant="secondary" onClick={load}>{tr('Réessayer')}</Button>}>{error}</EmptyState></Card>
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
        <Button variant="ghost" size="sm" icon={ArrowLeft} onClick={onBack} className="back-link">{tr('Retour aux contrats')}</Button>
        <div className="detail-head">
          <div>
            <h1 className="page-title">{c.partnerName}</h1>
            <div className="detail-meta">
              <span className="mono">{c.reference || c.numero}</span>
              <Badge tone={st.tone} dot>{tr(st.label)}</Badge>
              {flags.map((f) => <Badge key={f.key} tone={f.tone}>{tr(f.label)}</Badge>)}
              <span className="muted">{detail.activities.map((x) => x.label).join(', ') || tr('Aucune activité')}</span>
            </div>
          </div>
          <div className="toolbar">
            {a.edit && <Button variant="secondary" icon={Pencil} onClick={() => onEdit(contractId)}>{tr('Modifier')}</Button>}
            {a.submit && <Button icon={Send} onClick={() => setDialog({ type: 'submit' })}>{tr('Soumettre')}</Button>}
            {a.decide && <>
              <Button variant="secondary" icon={X} onClick={() => setDialog({ type: 'decide', approve: false })}>{tr('Rejeter')}</Button>
              <Button icon={ShieldCheck} onClick={() => setDialog({ type: 'decide', approve: true })}>{tr('Approuver')}</Button>
            </>}
            {a.amend && <Button variant="secondary" icon={FilePlus2} onClick={() => onAmend(contractId)}>{tr('Avenant')}</Button>}
            {a.renew && <Button variant="secondary" icon={RefreshCw} onClick={() => setDialog({ type: 'renew' })}>{tr('Renouveler')}</Button>}
            {a.terminate && <Button variant="secondary" icon={Ban} onClick={() => setDialog({ type: 'terminate' })}>{tr('Résilier')}</Button>}
            {a.delete && <Button variant="secondary" icon={Trash2} onClick={() => setDialog({ type: 'delete' })}>{tr('Supprimer')}</Button>}
          </div>
        </div>
      </div>

      {c.status === 'resilie' && <Alert tone="warn" icon={Info}>{tr('Contrat résilié le {date} — {reason}', { date: formatDate(c.terminationDate), reason: c.terminationReason || '' })}</Alert>}
      {a.decideAmendment && pending && (
        <Alert tone="info" icon={Info}>{tr("L'avenant {code} attend votre validation.", { code: amendmentCode(pending.number) })}{' '}
          <button type="button" className="inline-link" onClick={() => setTab('amendments')}>{tr("Voir l'avenant")}</button></Alert>
      )}
      {detail.renewedFrom && <div className="note"><Info size={18} aria-hidden="true" /><span>{tr('Renouvellement de')} <button type="button" className="inline-link" onClick={() => onOpen(detail.renewedFrom.id)}>{detail.renewedFrom.numero}</button>.</span></div>}
      {detail.renewal && <div className="note"><Info size={18} aria-hidden="true" /><span>{tr('Renouvelé par')} <button type="button" className="inline-link" onClick={() => onOpen(detail.renewal.id)}>{detail.renewal.numero}</button>.</span></div>}

      {/* Identification */}
      <Card>
        <div className="kv-grid">
          <table className="kv"><tbody>
            <tr><th>{tr('N° interne')}</th><td className="mono">{c.numero}</td></tr>
            <tr><th>{tr('N° FLA')}</th><td className="mono">{c.numeroFla || '—'}</td></tr>
            <tr><th>{tr('N° PO')}</th><td className="mono">{c.numeroPo || '—'}</td></tr>
            <tr><th>{tr('N° Vendor')}</th><td className="mono">{c.numeroVendor || '—'}</td></tr>
          </tbody></table>
          <table className="kv"><tbody>
            <tr><th>{tr('Période')}</th><td>{periodLabel(c.dateDebut, c.dateFin, tr)} <span className="muted">({formatDate(c.dateDebut)} – {formatDate(c.dateFin)})</span></td></tr>
            <tr><th>{tr('Valideur')}</th><td>{c.validatorEmail || '—'}</td></tr>
            <tr><th>{tr('Avenants')}</th><td>{c.amendmentCount}</td></tr>
            <tr><th>{tr('Échéance')}</th><td>{c.status === 'actif' ? (c.daysToEnd >= 0 ? tr(c.daysToEnd > 1 ? 'Dans {n} jours' : 'Dans {n} jour', { n: c.daysToEnd }) : tr('Dépassée de {n} jour(s)', { n: -c.daysToEnd })) : '—'}</td></tr>
          </tbody></table>
        </div>
      </Card>

      {/* Total de l'accord (barème) + barème mensuel + consommation Suivi */}
      <Card>
        <div className="card-body" style={{ display: 'flex', gap: 24, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ minWidth: 200 }}>
            <div className="stat-label">{tr("Total de l'accord (plafond)")}</div>
            <div className="stat-value">{formatAr(detail.budget.total.grand)}</div>
            <div className="field-hint">{tr('dont commission {pct} % = {amount}', { pct: Math.round(detail.budget.managementFee.pct * 1000) / 10, amount: formatAr(detail.budget.managementFee.amount) })}</div>
          </div>
          <div style={{ minWidth: 180 }}>
            <div className="stat-label">{tr('Barème mensuel')}</div>
            <div className="stat-value">{formatAr(c.monthlyCeiling)}</div>
            <div className="field-hint">{tr('total ÷ {n} mois', { n: c.periodMonths })}</div>
          </div>
          <div style={{ minWidth: 160 }}>
            <div className="stat-label">{tr('Budget Suivi/TPM')}</div>
            <div className="stat-value">{formatAr(mon.budget)}</div>
          </div>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div className="stat-label" style={{ marginBottom: 6 }}>{tr('Consommation du budget Suivi ({amount} justifié)', { amount: formatAr(mon.spent) })}</div>
            <Usage rate={mon.rate} />
            <div className="field-hint" style={{ marginTop: 4 }}>
              {tr('Alimentée par les rapports financiers validés dans')} <ExternalLink size={12} style={{ verticalAlign: -1 }} aria-hidden="true" /> {tr('Partenaires & TPM › Rapports.')}
            </div>
          </div>
        </div>
      </Card>

      {/* Zones d'intervention affectées au prestataire (retour 79 : en tableau) */}
      {(detail.areas || []).length > 0 && <AreasCard areas={detail.areas} />}

      <Card>
        <div className="tabs-bar">
          <div className="tabs" role="tablist">
            {TABS.map((t) => (
              <button key={t.id} role="tab" aria-selected={tab === t.id} className="tab" onClick={() => setTab(t.id)}>
                {tr(t.label)}{t.id === 'amendments' && detail.amendments.length > 0 && <span className="count"> {detail.amendments.length}</span>}
              </button>
            ))}
          </div>
          {tab === 'budget' && (
            <Button size="sm" variant="secondary" icon={Download} loading={downloading} onClick={downloadXlsx} className="tabs-action">
              {tr('Télécharger Excel')}
            </Button>
          )}
        </div>
        {tab === 'budget' && <BudgetItemsView budget={detail.budget} monthlyCeiling={c.monthlyCeiling} />}
        {tab === 'forecast' && <ForecastTab contractId={contractId} dateFin={c.dateFin} />}
        {tab === 'amendments' && <AmendmentsTab detail={detail} canDecide={a.decideAmendment} canWrite={a.canWrite} onDelete={(am) => setDialog({ type: 'deleteAmendment', amendment: am })} onDecide={(am, approve) => setDialog({ type: 'decideAmendment', amendment: am, approve })} onAdd={a.amend ? () => onAmend(contractId) : null} />}
        {tab === 'history' && <HistoryTab history={history} />}
      </Card>

      {dialog?.type === 'submit' && <SubmitDialog open onClose={() => setDialog(null)} detail={detail} onDone={afterAction} />}
      {dialog?.type === 'decide' && <DecisionDialog open onClose={() => setDialog(null)} detail={detail} approve={dialog.approve} onDone={afterAction} />}
      {dialog?.type === 'decideAmendment' && <DecisionDialog open onClose={() => setDialog(null)} detail={detail} amendment={dialog.amendment} approve={dialog.approve} onDone={afterAction} />}
      {dialog?.type === 'renew' && <RenewDialog open onClose={() => setDialog(null)} detail={detail} onDone={(id) => { setDialog(null); onOpen(id); }} />}
      {dialog?.type === 'terminate' && <TerminateDialog open onClose={() => setDialog(null)} detail={detail} onDone={afterAction} />}
      {dialog?.type === 'delete' && (
        <DeleteDialog
          open
          validated={c.status === 'actif' || c.status === 'resilie'}
          blockers={a.deleteBlockers || []}
          blockedHint={c.status === 'actif' || c.status === 'resilie' ? tr('Résiliez-le plutôt que de le supprimer.') : null}
          title={tr('Supprimer ce contrat ?')}
          description={`${c.numero} · ${c.partnerName}`}
          onClose={() => setDialog(null)}
          onConfirm={(justification) => api.deleteContract(contractId, justification)}
          onDone={() => { toast.success(tr('Contrat supprimé.')); setDialog(null); onBack(); }}
        />
      )}
      {dialog?.type === 'deleteAmendment' && (
        <DeleteDialog
          open
          validated={dialog.amendment.status === 'approuve'}
          title={tr('Supprimer cet avenant ?')}
          description={`${amendmentCode(dialog.amendment.number)} · ${c.numero}`}
          onClose={() => setDialog(null)}
          onConfirm={(justification) => api.deleteAmendment(contractId, dialog.amendment.id, justification)}
          onDone={() => { toast.success(tr('Avenant supprimé.')); afterAction(); }}
        />
      )}
    </div>
  );
}

/** Niveaux par défaut du découpage quand le pays n'en déclare pas (profondeur 1 = région). */
const DEFAULT_LEVELS = { 1: 'Région', 2: 'District', 3: 'Commune', 4: 'Fokontany' };

/**
 * Zones d'intervention du contrat en tableau (retour 79) : une colonne par
 * niveau du découpage, et l'état de chaque zone — reliée au découpage, ou à
 * resélectionner (elle n'y existe plus) avec ce qu'il faut faire.
 */
function AreasCard({ areas }) {
  const { tr } = useI18n();
  const [levels, setLevels] = useState(DEFAULT_LEVELS);
  useEffect(() => {
    let live = true;
    api.listAdminLevels()
      .then((rows) => {
        if (!live || !Array.isArray(rows) || !rows.length) return;
        setLevels({ ...DEFAULT_LEVELS, ...Object.fromEntries(rows.map((l) => [l.depth, l.label])) });
      })
      .catch(() => { /* libellés par défaut */ });
    return () => { live = false; };
  }, []);

  const rows = areas.map((z) => ({ ...z, parts: String(z.path || '').split('>').map((x) => x.trim()).filter(Boolean) }));
  const width = Math.max(1, ...rows.map((r) => r.parts.length));
  const detached = rows.filter((r) => !r.adminAreaId).length;

  return (
    <Card>
      <CardHeader title={tr("Zones d'intervention")}>
        <span className="areas-count">
          {detached
            ? tr('{n} zone(s) · {d} à resélectionner', { n: rows.length, d: detached })
            : tr('{n} zone(s) affectée(s) au prestataire', { n: rows.length })}
        </span>
      </CardHeader>
      {detached > 0 && (
        <div className="card-body areas-note">
          <Alert tone="warn">
            {tr('Les zones « à resélectionner » n\'existent plus dans le découpage (Paramétrage › Localités), par exemple après un réimport. Modifiez le contrat (ou passez par un avenant s\'il est actif) pour les retirer puis les resélectionner.')}
          </Alert>
        </div>
      )}
      <div className="table-wrap">
        <table className="table grid areas-table">
          <thead>
            <tr>
              {Array.from({ length: width }, (_, i) => <th key={i} scope="col">{tr(levels[i + 1] || DEFAULT_LEVELS[i + 1] || `Niveau ${i + 1}`)}</th>)}
              <th scope="col" className="areas-state-col">{tr('État')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.adminAreaId || r.path}>
                {Array.from({ length: width }, (_, i) => (
                  <td key={i} className={i === r.parts.length - 1 ? 'areas-leaf' : undefined}>
                    {r.parts[i] || (i >= r.parts.length ? <span className="muted">{tr('Toute la zone')}</span> : null)}
                  </td>
                ))}
                <td className="areas-state-col">
                  {r.adminAreaId
                    ? <Badge tone="green" icon={CheckCircle2}>{tr('Reliée au découpage')}</Badge>
                    : <Badge tone="orange" icon={AlertTriangle}>{tr('À resélectionner')}</Badge>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
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
  const { tr } = useI18n();
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

  if (nothing) return <p className="muted" style={{ fontSize: 14, marginTop: 8 }}>{tr("Aucun changement détecté par rapport à l'état précédent.")}</p>;

  return (
    <div className="amend-diff">
      {scalarChanged && (
        <div className="table-wrap">
          <table className="diff-table">
            <thead><tr><th>{tr('Champ')}</th><th>{tr('Avant')}</th><th aria-hidden="true" /><th>{tr('Après')}</th></tr></thead>
            <tbody>
              <ScalarRow label={tr('Date de début')} before={formatDate(before.dateDebut)} after={formatDate(after.dateDebut)} />
              <ScalarRow label={tr('Date de fin')} before={formatDate(before.dateFin)} after={formatDate(after.dateFin)} />
              <ScalarRow label={tr('Commission de gestion')} before={pct(before.feePct)} after={pct(after.feePct)} />
              <ScalarRow label={tr("Total de l'accord")} before={formatAr(before.grandTotal)} after={formatAr(after.grandTotal)} />
            </tbody>
          </table>
        </div>
      )}

      {(acts.added.length > 0 || acts.removed.length > 0) && (
        <div className="diff-chips-row"><span className="diff-label">{tr('Activités')}</span>
          {acts.added.map((x) => <span key={`a${x}`} className="chip chip-add">+ {x}</span>)}
          {acts.removed.map((x) => <span key={`r${x}`} className="chip chip-del">− {x}</span>)}
        </div>
      )}
      {(zones.added.length > 0 || zones.removed.length > 0) && (
        <div className="diff-chips-row"><span className="diff-label">{tr('Zones')}</span>
          {zones.added.map((x) => <span key={`a${x}`} className="chip chip-add">+ {x}</span>)}
          {zones.removed.map((x) => <span key={`r${x}`} className="chip chip-del">− {x}</span>)}
        </div>
      )}

      {(addedItems.length > 0 || removedItems.length > 0 || changedItems.length > 0) && (
        <div className="table-wrap" style={{ marginTop: 4 }}>
          <table className="table"><thead><tr><th>{tr('Poste')}</th><th className="num">{tr('Avant')}</th><th className="num">{tr('Après')}</th></tr></thead>
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
                <tr key={`d${itemKey(it)}`} className="diff-row-del"><td>− {it.description}</td><td className="num">{it.unitCount} × {formatAr(it.unitCost)} = {formatAr(it.unitCount * it.unitCost)}</td><td className="num cell-empty">{tr('retiré')}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// Résumé compact des changements d'un avenant, pour la colonne « Ce qui a changé ».
function amendmentSummary(am, tr) {
  const ch = am.budgetChanges || {};
  if (ch.before && ch.after) {
    const b = ch.before; const a = ch.after;
    const parts = [];
    if (b.dateFin !== a.dateFin) parts.push(tr('échéance'));
    if (Number(b.feePct) !== Number(a.feePct)) parts.push(tr('commission'));
    if (Number(b.grandTotal) !== Number(a.grandTotal)) parts.push(tr('montant'));
    const zAdd = (a.areaPaths || []).filter((x) => !(b.areaPaths || []).includes(x)).length;
    const zDel = (b.areaPaths || []).filter((x) => !(a.areaPaths || []).includes(x)).length;
    if (zAdd + zDel) parts.push(tr(zAdd + zDel > 1 ? '{n} zones' : '{n} zone', { n: zAdd + zDel }));
    const bk = new Set((b.items || []).map(itemKey)); const ak = new Set((a.items || []).map(itemKey));
    const changed = (a.items || []).filter((it) => { const o = (b.items || []).find((x) => itemKey(x) === itemKey(it)); return o && (Number(o.unitCount) !== Number(it.unitCount) || Number(o.unitCost) !== Number(it.unitCost)); }).length;
    const added = (a.items || []).filter((it) => !bk.has(itemKey(it))).length;
    const removed = (b.items || []).filter((it) => !ak.has(itemKey(it))).length;
    const nItems = changed + added + removed;
    if (nItems) parts.push(tr(nItems > 1 ? '{n} postes' : '{n} poste', { n: nItems }));
    return parts.length ? parts.join(' · ') : tr('Aucun changement');
  }
  if (am.newDateFin) return tr('Échéance → {date}', { date: formatDate(am.newDateFin) });
  if (ch.newFeePct != null) return tr('Commission → {pct}', { pct: pct(ch.newFeePct) });
  return tr('Détail non enregistré');
}

function AmendmentsTab({ detail, canDecide, canWrite, onDelete, onDecide, onAdd }) {
  const { tr } = useI18n();
  const { amendments } = detail;
  const [openId, setOpenId] = useState(null);
  if (amendments.length === 0) {
    return <EmptyState icon={FilePlus2} title={tr('Aucun avenant')} action={onAdd && <Button icon={FilePlus2} onClick={onAdd}>{tr('Créer un avenant')}</Button>}>{tr('Un avenant reprend le processus complet du contrat ; chaque avenant apparaîtra ici avec le détail de ce qui a changé.')}</EmptyState>;
  }
  // Ordre chronologique (AM01, AM02, …) pour lire l'évolution.
  const ordered = [...amendments].sort((a, b) => a.number - b.number);
  return (
    <div className="amend-wrap">
      {onAdd && <div className="amend-toolbar"><Button size="sm" icon={FilePlus2} onClick={onAdd}>{tr('Créer un avenant')}</Button></div>}
      <div className="table-wrap">
        <table className="table grid amend-table">
          <thead>
            <tr>
              <th scope="col" style={{ width: 32 }}><span className="sr-only">{tr('Détail')}</span></th>
              <th scope="col" style={{ width: 90 }}>{tr('Avenant')}</th>
              <th scope="col">{tr('Date')}</th>
              <th scope="col">{tr('Statut')}</th>
              <th scope="col">{tr('Ce qui a changé')}</th>
              <th scope="col">{tr('Justification')}</th>
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
                    aria-expanded={isOpen} title={tr('Cliquez pour voir le détail')}>
                    <td className="amend-caret">{isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</td>
                    <td><strong className="amend-code">{amendmentCode(am.number)}</strong></td>
                    <td className="nowrap">{formatDate(am.createdAt)}</td>
                    <td><Badge tone={stat.tone} dot>{tr(stat.label)}</Badge></td>
                    <td className="amend-sum">{amendmentSummary(am, tr)}</td>
                    <td className="amend-just-cell">{am.justification}</td>
                  </tr>
                  {isOpen && (
                    <tr className="amend-detail-row">
                      <td colSpan={6}>
                        <div className="amend-detail">
                          <div className="amend-detail-head">
                            <div>
                              <strong className="amend-code">{amendmentCode(am.number)}</strong>
                              <span className="muted" style={{ fontSize: 14, marginLeft: 8 }}>{tr('Demandé le {date} · {email}', { date: formatDateTime(am.createdAt), email: am.createdByEmail || '' })}</span>
                            </div>
                            <div className="toolbar">
                              {canDecide && am.status === 'en_validation' && (
                                <>
                                  <Button size="sm" variant="secondary" icon={X} onClick={(e) => { e.stopPropagation(); onDecide(am, false); }}>{tr('Rejeter')}</Button>
                                  <Button size="sm" icon={ShieldCheck} onClick={(e) => { e.stopPropagation(); onDecide(am, true); }}>{tr('Approuver')}</Button>
                                </>
                              )}
                              {canWrite && onDelete && am.status !== 'approuve' && (
                                <Button size="sm" variant="ghost" icon={Trash2} onClick={(e) => { e.stopPropagation(); onDelete(am); }}>{tr('Supprimer')}</Button>
                              )}
                            </div>
                          </div>
                          <p className="amend-just">{tr('« {text} »', { text: am.justification || '' })}</p>
                          <div className="amend-diff-title">{tr('Ce qui a changé')}</div>
                          {hasDiff
                            ? <AmendmentDiff before={ch.before} after={ch.after} />
                            : (
                              <div className="muted" style={{ fontSize: 14 }}>
                                {am.newDateFin ? <>{richText(tr('Nouvelle échéance : <strong>{date}</strong>.', { date: formatDate(am.newDateFin) }))} </> : null}
                                {ch.newFeePct != null ? <>{richText(tr('Commission de gestion : <strong>{pct}</strong>.', { pct: pct(ch.newFeePct) }))}</> : null}
                                {!am.newDateFin && ch.newFeePct == null && tr('Détail du changement non enregistré (avenant ancien format).')}
                              </div>
                            )}
                          {am.decidedAt && <div className="muted" style={{ fontSize: 14, marginTop: 10 }}>{tr('Décision : {date} · {email}', { date: formatDateTime(am.decidedAt), email: am.decidedByEmail || '' })}{am.decisionComment ? ` — ${am.decisionComment}` : ''}</div>}
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
  const { tr } = useI18n();
  if (!history) return <div style={{ padding: 20 }}><Skeleton height={120} /></div>;
  if (history.length === 0) return <EmptyState icon={Info} title={tr('Aucun évènement')} />;
  return (
    <ol style={{ listStyle: 'none', margin: 0, padding: 20, display: 'grid', gap: 0 }}>
      {history.map((h, i) => (
        <li key={h.id} style={{ display: 'flex', gap: 12, paddingBottom: i === history.length - 1 ? 0 : 16 }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <span className="avatar" aria-hidden="true">{initials(h.actorEmail)}</span>
            {i < history.length - 1 && <span style={{ flex: 1, width: 2, background: 'var(--border)', marginTop: 4 }} />}
          </div>
          <div style={{ paddingTop: 4 }}>
            <div><strong>{HISTORY_LABELS[h.action] ? tr(HISTORY_LABELS[h.action]) : h.action}</strong></div>
            <div className="muted" style={{ fontSize: 14 }}>{formatDateTime(h.createdAt)} · {h.actorEmail}</div>
            {h.comment && <div style={{ marginTop: 4 }}>{tr('« {text} »', { text: h.comment })}</div>}
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
  const { tr } = useI18n();
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
  if (!data) return <EmptyState icon={Info} title={tr('Prévision indisponible')} />;

  const pct = data.budget > 0 ? Math.min(1.2, data.projectedTotal / data.budget) : 0;
  return (
    <div style={{ padding: 20, display: 'grid', gap: 18 }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <label className="field" style={{ margin: 0 }}>
          <span className="field-label">{tr("Projeter jusqu'au mois")}</span>
          <input className="input" type="month" value={until} max={dateFin ? String(dateFin).slice(0, 7) : undefined}
            onChange={(e) => setUntil(e.target.value)} style={{ width: 180 }} />
        </label>
        {until && <Button size="sm" variant="ghost" onClick={() => setUntil('')}>{tr("Jusqu'à la fin du contrat")}</Button>}
        <span className="hint">{tr('Rythme moyen : {avg} / mois · {n} mois écoulé(s) · cible {until}', { avg: formatAr(data.avgMonthlyBurn), n: data.elapsedMonths, until: data.until })}</span>
      </div>

      <div className="stats">
        <div className="stat"><div className="stat-label">{tr('Budget Suivi/TPM')}</div><div className="stat-value">{formatAr(data.budget)}</div></div>
        <div className="stat"><div className="stat-label">{tr('Réalisé à ce jour')}</div><div className="stat-value">{formatAr(data.realizedToDate)}</div></div>
        <div className="stat"><div className="stat-label">{tr('Projeté ({until})', { until: data.until })}</div><div className="stat-value" style={data.willOverspend ? { color: 'var(--red)' } : undefined}>{formatAr(data.projectedTotal)}</div></div>
        <div className="stat"><div className="stat-label">{data.willOverspend ? tr('Dépassement projeté') : tr('Restant projeté')}</div><div className="stat-value" style={data.willOverspend ? { color: 'var(--red)' } : { color: 'var(--green)' }}>{formatAr(data.willOverspend ? data.projectedOverrun : data.projectedRemaining)}</div></div>
      </div>

      <div className="progress" style={{ height: 10 }} aria-label={tr('Taux de consommation projeté')}>
        <span className={pct >= 1 ? 'is-over' : (pct >= 0.85 ? 'is-high' : '')} style={{ width: `${Math.min(100, pct * 100)}%` }} />
      </div>

      {data.willOverspend
        ? <Alert tone="warn" icon={AlertCircle}>{richText(tr("Au rythme actuel, le budget Suivi/TPM serait dépassé de <strong>{amount}</strong> d'ici {until}.", { amount: formatAr(data.projectedOverrun), until: data.until }))}</Alert>
        : <Alert tone="info" icon={Info}>{richText(tr('Au rythme actuel, il resterait <strong>{amount}</strong> sur le budget Suivi/TPM à {until}.', { amount: formatAr(data.projectedRemaining), until: data.until }))}</Alert>}

      <div className="table-wrap"><table className="table">
        <thead><tr><th scope="col">{tr('Mois')}</th><th scope="col">{tr('Nature')}</th><th scope="col" className="num">{tr('Dépense du mois')}</th><th scope="col" className="num">{tr('Cumulé')}</th><th scope="col" className="num">{tr('Restant')}</th></tr></thead>
        <tbody>
          {data.series.map((s) => (
            <tr key={s.month}>
              <td className="tabular"><strong>{s.month}</strong></td>
              <td>{s.isFuture ? <Badge tone="blue">{tr('Projeté')}</Badge> : <Badge tone="green">{tr('Réalisé')}</Badge>}</td>
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
