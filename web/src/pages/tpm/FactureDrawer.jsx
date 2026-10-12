import React, { useEffect, useRef, useState } from 'react';
import { Coins, AlertCircle, FileText, Wand2, Printer, FileSpreadsheet, Send, Info } from 'lucide-react';
import { api } from '../../api/client.js';
import { Alert, Button, Field, Skeleton } from '../../components/ui.jsx';
import Modal from '../../components/Modal.jsx';
import MoneyInput from '../../components/MoneyInput.jsx';
import { useToast } from '../../components/Toast.jsx';
import { formatAr } from '../../lib/format.js';
import { useI18n } from '../../lib/i18n.jsx';
import { richText } from '../../lib/contracts.js';
import { openFacturePrint } from '../../lib/facturePrint.js';
import { SECTIONS } from '../../lib/budgetCatalog.js';
import PostesEditor, { newPoste, rowsFromItems, itemsFromRows, posteFunder } from './PostesEditor.jsx';

/**
 * Facture fidèle — éditeur/visualiseur de l'état des dépenses TPM.
 * Postes quantité × coût unitaire, à la charge du bailleur ou de l'ONG,
 * groupés par section FLA I–V. Le « Réalisé » comptabilisé est la part
 * bailleur. Peut être pré-rempli depuis le plan de collecte du mois.
 */
export default function FactureDrawer({ reportId, kind: kindProp = 'financier', initial, autoPrefill = false, context, month, onClose, onSaved }) {
  const { tr } = useI18n();
  const toast = useToast();
  const editing = Boolean(reportId);
  const [loading, setLoading] = useState(editing);
  const [saving, setSaving] = useState(false);
  const [prefilling, setPrefilling] = useState(false);
  const [readOnly, setReadOnly] = useState(false);
  const [status, setStatus] = useState(null);   // statut du rapport ouvert
  const [comment, setComment] = useState('');   // motif du dernier rejet
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

  useEffect(() => {
    if (!editing) return;
    let alive = true;
    api.getReport(reportId).then((r) => {
      if (!alive) return;
      setReadOnly(r.status === 'valide');
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

  // Une facture « attendue » ou « rejetée » ne part en validation que par
  // l'action explicite « Soumettre » : l'enregistrement ne change pas le statut.
  const canSubmit = editing && isFin && !readOnly && ['attendu', 'rejete'].includes(status);

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
      ? tr('{partner} · {contract} · validé (lecture seule)', { partner: head.partnerName || '', contract: head.contractNumero || '' })
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
        <div style={{ display: 'grid', gap: 18 }}>
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
                <Field label={tr('Prestataire TPM')} required error={touched && !head.partnerId ? tr('Requis.') : undefined}>
                  <select className={`select ${head.partnerId ? '' : 'is-empty'}`} value={head.partnerId} onChange={(e) => setHead({ ...head, partnerId: e.target.value })}>
                    <option value="">{tr('Choisir…')}</option>{partners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </Field>
                <Field label={tr('Contrat suivi')} required error={touched && !head.contractId ? tr('Requis.') : undefined}>
                  <select className={`select ${head.contractId ? '' : 'is-empty'}`} value={head.contractId} onChange={(e) => setHead({ ...head, contractId: e.target.value })}>
                    <option value="">{tr('Choisir…')}</option>{contracts.map((c) => <option key={c.id} value={c.id}>{c.partnerName} · {c.numero}</option>)}
                  </select>
                </Field>
              </>
            )}
            {isFin && <>
              <Field label={tr('N° de facture')}><input className="input mono" value={head.invoiceNo} disabled={readOnly} onChange={(e) => setHead({ ...head, invoiceNo: e.target.value })} placeholder="FAC-2025-11" /></Field>
              <Field label={tr('Fin de période')} hint={tr('Facture pluri-mensuelle (optionnel).')}><input className="input" type="month" value={head.periodEnd} disabled={readOnly} onChange={(e) => setHead({ ...head, periodEnd: e.target.value })} /></Field>
              <Field label={tr('Avance déduite (Ar)')}><MoneyInput value={head.advanceDeducted} onChange={(v) => setHead({ ...head, advanceDeducted: v })} /></Field>
            </>}
          </div>

          {contract && <div className="note"><Coins size={18} aria-hidden="true" /><span>{richText(tr('Budget Suivi/TPM du contrat : <strong>{budget}</strong> · barème mensuel <strong>{ceiling}</strong>', { budget: formatAr(contract.monitoringBudget), ceiling: formatAr(contract.monthlyCeiling) }))}</span></div>}

          {isFin && status === 'rejete' && comment && <Alert tone="warn">{tr('Facture rejetée — motif : {reason}. Corrigez-la puis soumettez-la de nouveau.', { reason: comment })}</Alert>}
          {isFin && status === 'attendu' && !readOnly && <div className="note"><Info size={18} aria-hidden="true" /><span>{tr("Remplissez l'état des dépenses puis « Enregistrer et soumettre » pour l'envoyer en validation.")}</span></div>}
          {isFin && status === 'soumis' && !readOnly && <div className="note"><Info size={18} aria-hidden="true" /><span>{tr('Facture déjà soumise : si vous la modifiez, vous en devenez le soumetteur et ne pourrez pas la valider.')}</span></div>}

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
                <MoneyInput value={head.plannedAmount} onChange={(v) => setHead({ ...head, plannedAmount: v })} />
              </Field>
              <Field label={tr('Nom du document')} hint={tr("Métadonnée (fichier non stocké pour l'instant).")}>
                <input className="input" value={head.documentName} onChange={(e) => setHead({ ...head, documentName: e.target.value })} placeholder={tr('Rapport_technique_AINA_2026-06.pdf')} />
              </Field>
              <Field label={tr('Référence')}><input className="input mono" value={head.reference} onChange={(e) => setHead({ ...head, reference: e.target.value })} /></Field>
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
