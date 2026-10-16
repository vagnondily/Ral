import React, { useEffect, useRef, useState } from 'react';
import { Coins, AlertCircle, FileText, Wand2, Printer, FileSpreadsheet, Send, Info, Lock } from 'lucide-react';
import { api } from '../../api/client.js';
import { Alert, Button, Field, Skeleton } from '../../components/ui.jsx';
import Modal from '../../components/Modal.jsx';
import MoneyInput from '../../components/MoneyInput.jsx';
import { useToast } from '../../components/Toast.jsx';
import { formatAr, monthLabel } from '../../lib/format.js';
import { periodLabel } from '../../lib/period.js';
import EntityPicker from '../../components/EntityPicker.jsx';
import { contractOptions, tpmOptions, withContract, withPartner } from '../../lib/tpmPickers.js';
import useContractTpms from '../../lib/useContractTpms.js';
import { useI18n } from '../../lib/i18n.jsx';
import { richText } from '../../lib/contracts.js';
import { openFacturePrint } from '../../lib/facturePrint.js';
import { SECTIONS } from '../../lib/budgetCatalog.js';
import PostesEditor, { newPoste, rowsFromItems, itemsFromRows, posteFunder } from './PostesEditor.jsx';
import { invalidPctRows } from '../../lib/postesMath.js';

/**
 * Facture fidèle — éditeur/visualiseur de l'état des dépenses TPM.
 * Postes quantité × coût unitaire, à la charge du bailleur ou de l'ONG,
 * groupés par section FLA I–V. Le « Réalisé » comptabilisé est la part
 * bailleur. Peut être pré-rempli depuis le plan de collecte du mois.
 */
export default function FactureDrawer({ reportId, kind: kindProp = 'financier', initial, autoPrefill = false, context, month, onClose, onSaved }) {
  const { tr, lang } = useI18n();
  const toast = useToast();
  const editing = Boolean(reportId);
  const [loading, setLoading] = useState(editing);
  const [saving, setSaving] = useState(false);
  const [prefilling, setPrefilling] = useState(false);
  const [readOnly, setReadOnly] = useState(false);
  const [status, setStatus] = useState(null);   // statut du rapport ouvert
  const [comment, setComment] = useState('');   // motif du dernier rejet
  // Actions permises à l'utilisateur sur ce rapport, calculées par le serveur
  // avec les règles qui s'appliquent à l'écriture (reportWorkflow) : figé une
  // fois soumis, modifiable et soumis par son seul auteur.
  const [actions, setActions] = useState(null);
  const [author, setAuthor] = useState('');
  const [touched, setTouched] = useState(false);
  // Rapport financier = facture (postes) ; rapport technique = métadonnées
  // seules. Un même tiroir gère les deux (combinaison rapport + facture).
  const [kind, setKind] = useState(kindProp);
  const isFin = kind === 'financier';

  const [head, setHead] = useState({
    partnerId: initial?.partnerId || '', contractId: initial?.contractId || '',
    invoiceNo: '', periodEnd: '', advanceDeducted: '', partnerName: '', contractNumero: '',
    documentName: '', reference: '', plannedAmount: '',
  });
  const [rows, setRows] = useState(editing ? [] : [newPoste()]);
  const [invoice, setInvoice] = useState(null); // { budgetByLine, cumulByLine }

  const partners = context?.partners || [];
  const contracts = context?.contracts || [];
  const contract = contracts.find((c) => c.id === head.contractId);
  // Retour 58 — même règle que la planification : le contrat propose son TPM, le TPM son contrat.
  const tpmsOf = useContractTpms(month, !editing);
  const choosePartner = (partnerId) => setHead((h) => withPartner(h, partnerId, contracts, tpmsOf));
  const chooseContract = (contractId) => setHead((h) => withContract(h, contractId, tpmsOf));
  const headTpms = tpmsOf(head.contractId);
  const otherTpm = Boolean(head.contractId && head.partnerId && headTpms.length && !headTpms.some((p) => p.id === head.partnerId));
  const pickContracts = contractOptions(contracts, {
    month, tpmsOf, fmtPeriod: (from, to) => periodLabel({ from, to }, lang, { short: true }),
    labels: { covering: tr('Couvrent {month}', { month: month ? monthLabel(String(month).slice(0, 7)) : '' }), others: tr('Autres contrats actifs'), tpm: tr('TPM') },
  });
  const pickTpms = tpmOptions(partners, {
    contracts, contractId: head.contractId, tpmsOf,
    labels: { ofContract: tr('TPM de ce contrat'), others: tr('Autres prestataires TPM'), noContract: tr('Aucun contrat de suivi rattaché') },
  });

  useEffect(() => {
    if (!editing) return;
    let alive = true;
    api.getReport(reportId).then((r) => {
      if (!alive) return;
      setReadOnly(!r.actions?.edit);
      setActions(r.actions || null);
      setAuthor(r.editedByEmail || '');
      setStatus(r.status);
      setComment(r.comment || '');
      setKind(r.kind);
      setHead((h) => ({
        ...h,
        partnerId: r.partnerId, contractId: r.contractId, partnerName: r.partnerName, contractNumero: r.contractNumero,
        invoiceNo: r.invoiceNo || '', periodEnd: r.periodEnd ? r.periodEnd.slice(0, 7) : '',
        advanceDeducted: r.advanceDeducted || '', documentName: r.documentName || '', reference: r.reference || '',
        plannedAmount: r.plannedAmount || '',
      }));
      setRows(rowsFromItems(r.items));
      setLoading(false);
    }).catch((e) => { if (alive) { toast.error(e.message); setLoading(false); } });
    api.reportInvoice(reportId).then((inv) => { if (alive) setInvoice(inv); }).catch(() => {});
    return () => { alive = false; };
  }, [editing, reportId, toast]);

  // Fil guidé : à l'ouverture depuis un plan (contrat présélectionné), on
  // reprend automatiquement les postes du plan du mois — une fois.
  const autoPrefilled = useRef(false);
  useEffect(() => {
    if (editing || !autoPrefill || autoPrefilled.current) return;
    if (!head.contractId || !isFin) return;
    autoPrefilled.current = true;
    prefillFromPlan();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoPrefill, head.contractId, isFin, editing]);

  async function prefillFromPlan() {
    if (!head.partnerId || !head.contractId) { toast.info(tr("Choisissez d'abord le prestataire et le contrat.")); return; }
    setPrefilling(true);
    try {
      const { items } = await api.planningPrefill(head.partnerId, head.contractId, month);
      if (!items.length) { toast.info(tr('Aucun plan de collecte de ce prestataire pour ce contrat et ce mois.')); return; }
      setRows(rowsFromItems(items));
      toast.success(tr('{n} poste(s) repris du plan de collecte.', { n: items.length }));
    } catch (e) { toast.error(e.message); } finally { setPrefilling(false); }
  }

  const errors = [];
  if (!editing && !head.partnerId) errors.push(tr('Choisissez un prestataire.'));
  if (!editing && !head.contractId) errors.push(tr('Choisissez un contrat.'));
  if (isFin && itemsFromRows(rows).length === 0) errors.push(tr('Ajoutez au moins un poste (désignation, quantité, coût).'));
  // Un % bailleur illisible ou hors 0–100 est refusé, jamais ramené en silence à 0 ou 100 %.
  if (isFin && !readOnly && invalidPctRows(rows).length > 0) errors.push(tr('% bailleur invalide : saisissez un nombre entre 0 et 100 (vide = 100 %).'));

  // Une facture « attendue » ou « rejetée » ne part en validation que par
  // l'action explicite « Soumettre » (par son auteur) : l'enregistrement ne
  // change pas le statut.
  const canSubmit = editing && isFin && !readOnly && Boolean(actions?.submit);

  async function save({ submit = false } = {}) {
    setTouched(true);
    if (errors.length) return;
    setSaving(true);
    try {
      if (editing) {
        // Édition : seules les factures (financier) ont un état des dépenses éditable ici.
        await api.saveReportItems(reportId, {
          items: itemsFromRows(rows),
          invoiceNo: head.invoiceNo.trim() || undefined,
          periodEnd: head.periodEnd || undefined,
          advanceDeducted: head.advanceDeducted !== '' ? Number(head.advanceDeducted) : undefined,
        });
        if (submit) {
          try { await api.submitReport(reportId); } catch (e) {
            toast.error(tr('Facture enregistrée, mais non soumise : {reason}', { reason: e.message }));
            onSaved();
            return;
          }
          toast.success(tr('Facture enregistrée et soumise à la validation.'));
          onSaved();
          return;
        }
      } else if (isFin) {
        await api.createReport({
          partnerId: head.partnerId, contractId: head.contractId, periodMonth: month, kind: 'financier',
          invoiceNo: head.invoiceNo.trim() || undefined, periodEnd: head.periodEnd || undefined,
          advanceDeducted: head.advanceDeducted !== '' ? Number(head.advanceDeducted) : undefined,
          items: itemsFromRows(rows),
        });
      } else {
        await api.createReport({
          partnerId: head.partnerId, contractId: head.contractId, periodMonth: month, kind: 'technique',
          plannedAmount: head.plannedAmount !== '' ? Number(head.plannedAmount) : undefined,
          documentName: head.documentName.trim() || undefined, reference: head.reference.trim() || undefined,
        });
      }
      toast.success(isFin ? tr('Facture enregistrée.') : tr('Rapport technique enregistré.'));
      onSaved();
    } catch (e) { toast.error(e.message); } finally { setSaving(false); }
  }

  function printPdf() {
    const partnerName = head.partnerName || partners.find((p) => p.id === head.partnerId)?.name || '';
    const contractNumero = head.contractNumero || contract?.numero || '';
    openFacturePrint({
      head: { ...head, partnerName, contractNumero, periodMonth: month, advanceDeducted: Number(head.advanceDeducted) || 0 },
      rows, contract,
    });
  }

  const title = isFin
    ? (editing ? tr('État des dépenses (facture)') : tr('Rapport financier — facture'))
    : (editing ? tr('Rapport technique') : tr('Nouveau rapport technique'));
  const subtitle = editing
    ? (readOnly
      ? tr(status === 'valide' ? '{partner} · {contract} · validé (lecture seule)' : '{partner} · {contract} · lecture seule', { partner: head.partnerName || '', contract: head.contractNumero || '' })
      : `${head.partnerName || ''} · ${head.contractNumero || ''}`)
    : (isFin
      ? tr("Postes quantité × coût unitaire, à la charge du bailleur ou de l'ONG, groupés par section FLA.")
      : tr('Rapport technique du mois (document + référence), rattaché au contrat suivi.'));

  return (
    <Modal
      open variant="drawer" size="xl" title={title} subtitle={subtitle}
      onClose={() => !saving && onClose()}
      footer={readOnly
        ? <><Button variant="secondary" onClick={onClose}>{tr('Fermer')}</Button>
          {isFin && <><Button variant="secondary" icon={Printer} onClick={printPdf}>PDF</Button>
            <Button icon={FileSpreadsheet} onClick={() => api.downloadReportXlsx(reportId)}>{tr('Exporter (Excel)')}</Button></>}</>
        : <><Button variant="secondary" onClick={onClose} disabled={saving}>{tr('Annuler')}</Button>
          {isFin && <Button variant="secondary" icon={Printer} onClick={printPdf}>PDF</Button>}
          {isFin && editing && <Button variant="secondary" icon={FileSpreadsheet} onClick={() => api.downloadReportXlsx(reportId)}>Excel</Button>}
          <Button variant={canSubmit ? 'secondary' : undefined} onClick={() => save()} loading={saving} icon={FileText}>{tr('Enregistrer')}</Button>
          {canSubmit && <Button onClick={() => save({ submit: true })} loading={saving} icon={Send}>{tr('Enregistrer et soumettre')}</Button>}</>}
    >
      {loading ? <Skeleton height={240} /> : (
        <div style={{ display: 'grid', gap: 18, gridTemplateColumns: 'minmax(0, 1fr)' }}>
          {/* Choix du type à la création : financier (facture) ou technique. */}
          {!editing && (
            <div className="field">
              <span className="field-label">{tr('Type de rapport')}</span>
              <div className="seg" role="group" aria-label={tr('Type de rapport')}>
                <button type="button" className={isFin ? 'is-active' : ''} onClick={() => setKind('financier')}>{tr('Financier (facture)')}</button>
                <button type="button" className={!isFin ? 'is-active' : ''} onClick={() => setKind('technique')}>{tr('Technique')}</button>
              </div>
            </div>
          )}

          <div className="form-grid">
            {!editing && (
              <>
                {/* Le contrat d'abord : il donne le TPM (retour 58 — TPM rattaché, sinon titulaire). */}
                <Field label={tr('Contrat suivi')} htmlFor="fd-contract" required error={touched && !head.contractId ? tr('Requis.') : undefined}>
                  <EntityPicker id="fd-contract" value={head.contractId} onChange={chooseContract} invalid={touched && !head.contractId}
                    options={pickContracts.options} groupOrder={pickContracts.order} placeholder={tr('Choisir un contrat…')}
                    searchPlaceholder={tr('Rechercher un n° de contrat, un partenaire, un TPM…')} emptyText={tr('Aucun contrat actif avec un budget Suivi/TPM ne correspond.')} />
                </Field>
                <Field label={tr('Prestataire TPM')} htmlFor="fd-tpm" required error={touched && !head.partnerId ? tr('Requis.') : undefined}
                  hint={headTpms.length ? tr('TPM du contrat : {p}', { p: headTpms.map((p) => p.name).join(', ') }) : undefined}>
                  <EntityPicker id="fd-tpm" value={head.partnerId} onChange={choosePartner} invalid={touched && !head.partnerId}
                    options={pickTpms.options} groupOrder={pickTpms.order} placeholder={tr('Choisir un prestataire TPM…')}
                    searchPlaceholder={tr('Rechercher un prestataire TPM…')} />
                </Field>
              </>
            )}
            {isFin && <>
              <Field label={tr('N° de facture')}><input className="input mono" value={head.invoiceNo} disabled={readOnly} onChange={(e) => setHead({ ...head, invoiceNo: e.target.value })} placeholder="FAC-2025-11" /></Field>
              <Field label={tr('Fin de période')} hint={tr('Facture pluri-mensuelle (optionnel).')}><input className="input" type="month" value={head.periodEnd} disabled={readOnly} onChange={(e) => setHead({ ...head, periodEnd: e.target.value })} /></Field>
              <Field label={tr('Avance déduite (Ar)')}><MoneyInput value={head.advanceDeducted} disabled={readOnly} onChange={(v) => setHead({ ...head, advanceDeducted: v })} /></Field>
            </>}
          </div>

          {otherTpm && (
            <Alert tone="warn">{tr('Ce prestataire n\'est pas le TPM de ce contrat ({p}) : vérifiez le couple prestataire × contrat.', { p: headTpms.map((p) => p.name).join(', ') })}</Alert>
          )}
          {contract && <div className="note"><Coins size={18} aria-hidden="true" /><span>{richText(tr('Budget Suivi/TPM du contrat : <strong>{budget}</strong> · barème mensuel <strong>{ceiling}</strong>', { budget: formatAr(contract.monitoringBudget), ceiling: formatAr(contract.monthlyCeiling) }))}</span></div>}

          {isFin && status === 'rejete' && comment && <Alert tone="warn">{readOnly
            ? tr('Facture rejetée — motif : {reason}.', { reason: comment })
            : tr('Facture rejetée — motif : {reason}. Corrigez-la puis soumettez-la de nouveau.', { reason: comment })}</Alert>}
          {isFin && status === 'attendu' && !readOnly && <div className="note"><Info size={18} aria-hidden="true" /><span>{tr("Remplissez l'état des dépenses puis « Enregistrer et soumettre » pour l'envoyer en validation.")}</span></div>}
          {/* État du circuit (pas une astuce masquable) : toujours affiché. */}
          {isFin && status === 'soumis' && <Alert tone="info" icon={Lock}>{tr('Facture soumise : elle est figée pendant la décision du validateur. Pour la corriger, le validateur la rejette avec un motif, puis son auteur la reprend.')}</Alert>}
          {isFin && readOnly && ['attendu', 'rejete'].includes(status) && actions?.editReason && <Alert tone="info" icon={Lock}>{author
            ? tr("Seul l'auteur de cette facture ({author}) peut la modifier ou la soumettre.", { author })
            : tr("Seul l'auteur de cette facture peut la modifier ou la soumettre.")}</Alert>}

          {touched && errors.length > 0 && <Alert tone="error" icon={AlertCircle}>{errors[0]}</Alert>}

          {isFin ? (
            <>
              {!readOnly && !editing && (
                <div><Button variant="secondary" size="sm" icon={Wand2} loading={prefilling} onClick={prefillFromPlan}>{tr('Pré-remplir depuis le plan de collecte')}</Button></div>
              )}
              <PostesEditor
                rows={rows}
                onChange={setRows}
                readOnly={readOnly}
                funderLabel={tr('À la charge du bailleur (Réalisé)')}
                advance={head.advanceDeducted !== '' ? Number(head.advanceDeducted) : 0}
                activities={context?.activities || []}
              />
              {invoice && <InvoiceBudgetTable invoice={invoice} rows={rows} />}
            </>
          ) : (
            <div className="form-grid">
              <Field label={tr('Budget prévu du mois (Ar)')} hint={contract ? tr('Barème mensuel : {amount}', { amount: formatAr(contract.monthlyCeiling) }) : tr('Total ÷ nombre de mois.')}>
                <MoneyInput value={head.plannedAmount} disabled={readOnly} onChange={(v) => setHead({ ...head, plannedAmount: v })} />
              </Field>
              <Field label={tr('Nom du document')} hint={tr("Métadonnée (fichier non stocké pour l'instant).")}>
                <input className="input" value={head.documentName} disabled={readOnly} onChange={(e) => setHead({ ...head, documentName: e.target.value })} placeholder={tr('Rapport_technique_AINA_2026-06.pdf')} />
              </Field>
              <Field label={tr('Référence')}><input className="input mono" value={head.reference} disabled={readOnly} onChange={(e) => setHead({ ...head, reference: e.target.value })} /></Field>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

/**
 * « Suivi budgétaire (cumulé) » — like the INVOICE tab: per FLA section the
 * Budget (contribution bailleur), les dépenses du mois (part bailleur), le
 * cumulé et le restant (budget − cumulé). Everything read from the server
 * (budget + cumulé) and the current postes (mois).
 */
function InvoiceBudgetTable({ invoice, rows }) {
  const { tr } = useI18n();
  const monthByLine = {};
  for (const r of rows) monthByLine[r.lineCode] = (monthByLine[r.lineCode] || 0) + posteFunder(r);

  const sum = (obj, lines) => lines.reduce((n, lc) => n + (obj[lc] || 0), 0);
  const secs = SECTIONS.map((sec) => {
    const lines = sec.lines.map(([code]) => `${sec.code}.${code}`);
    const budget = sum(invoice.budgetByLine, lines);
    const cumul = sum(invoice.cumulByLine, lines);
    const month = sum(monthByLine, lines);
    return { code: sec.code, label: sec.label, budget, month, cumul, restant: budget - cumul };
  }).filter((s) => s.budget || s.month || s.cumul);
  if (secs.length === 0) return null;

  const tot = secs.reduce((a, s) => ({
    budget: a.budget + s.budget, month: a.month + s.month, cumul: a.cumul + s.cumul, restant: a.restant + s.restant,
  }), { budget: 0, month: 0, cumul: 0, restant: 0 });

  return (
    <div className="card" style={{ marginTop: 4 }}>
      <div className="card-header"><div className="card-title">{tr('Suivi budgétaire (cumulé)')}</div>
        <div className="card-sub">{tr('Budget contribution bailleur · dépenses du mois · cumulé · restant, par section FLA.')}</div></div>
      <div className="table-wrap">
        <table className="table">
          <thead><tr>
            <th scope="col">{tr('Section')}</th>
            <th scope="col" className="num">{tr('Budget')}</th>
            <th scope="col" className="num">{tr('Dépenses du mois')}</th>
            <th scope="col" className="num">{tr('Cumulé')}</th>
            <th scope="col" className="num">{tr('Restant')}</th>
          </tr></thead>
          <tbody>
            {secs.map((s) => (
              <tr key={s.code}>
                <td><strong>{s.code}</strong> — {tr(s.label)}</td>
                <td className="num tabular">{formatAr(s.budget)}</td>
                <td className="num tabular">{formatAr(s.month)}</td>
                <td className="num tabular">{formatAr(s.cumul)}</td>
                <td className="num tabular" style={s.restant < 0 ? { color: 'var(--red)' } : undefined}>{formatAr(s.restant)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot><tr>
            <td style={{ textAlign: 'right' }}><strong>{tr('Total')}</strong></td>
            <td className="num tabular"><strong>{formatAr(tot.budget)}</strong></td>
            <td className="num tabular"><strong>{formatAr(tot.month)}</strong></td>
            <td className="num tabular"><strong>{formatAr(tot.cumul)}</strong></td>
            <td className="num tabular" style={tot.restant < 0 ? { color: 'var(--red)' } : undefined}><strong>{formatAr(tot.restant)}</strong></td>
          </tr></tfoot>
        </table>
      </div>
    </div>
  );
}
