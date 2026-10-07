import React, { useEffect, useRef, useState } from 'react';
import { Coins, AlertCircle, FileText, Wand2, Printer, FileSpreadsheet } from 'lucide-react';
import { api } from '../../api/client.js';
import { Alert, Button, Field, Skeleton } from '../../components/ui.jsx';
import Modal from '../../components/Modal.jsx';
import MoneyInput from '../../components/MoneyInput.jsx';
import { useToast } from '../../components/Toast.jsx';
import { formatAr } from '../../lib/format.js';
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
  const toast = useToast();
  const editing = Boolean(reportId);
  const [loading, setLoading] = useState(editing);
  const [saving, setSaving] = useState(false);
  const [prefilling, setPrefilling] = useState(false);
  const [readOnly, setReadOnly] = useState(false);
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
    if (!head.contractId) { toast.info('Choisissez d\'abord le contrat.'); return; }
    setPrefilling(true);
    try {
      const { items } = await api.planningPrefill(head.contractId, month);
      if (!items.length) { toast.info('Aucun plan de collecte pour ce contrat et ce mois.'); return; }
      setRows(rowsFromItems(items));
      toast.success(`${items.length} poste(s) repris du plan de collecte.`);
    } catch (e) { toast.error(e.message); } finally { setPrefilling(false); }
  }

  const errors = [];
  if (!editing && !head.partnerId) errors.push('Choisissez un prestataire.');
  if (!editing && !head.contractId) errors.push('Choisissez un contrat.');
  if (isFin && itemsFromRows(rows).length === 0) errors.push('Ajoutez au moins un poste (désignation, quantité, coût).');

  async function save() {
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
      toast.success(isFin ? 'Facture enregistrée.' : 'Rapport technique enregistré.');
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
    ? (editing ? 'État des dépenses (facture)' : 'Rapport financier — facture')
    : (editing ? 'Rapport technique' : 'Nouveau rapport technique');
  const subtitle = editing
    ? `${head.partnerName || ''} · ${head.contractNumero || ''}${readOnly ? ' · validé (lecture seule)' : ''}`
    : (isFin
      ? 'Postes quantité × coût unitaire, à la charge du bailleur ou de l\'ONG, groupés par section FLA.'
      : 'Rapport technique du mois (document + référence), rattaché au contrat suivi.');

  return (
    <Modal
      open variant="drawer" size="xl" title={title} subtitle={subtitle}
      onClose={() => !saving && onClose()}
      footer={readOnly
        ? <><Button variant="secondary" onClick={onClose}>Fermer</Button>
          {isFin && <><Button variant="secondary" icon={Printer} onClick={printPdf}>PDF</Button>
            <Button icon={FileSpreadsheet} onClick={() => api.downloadReportXlsx(reportId)}>Exporter (Excel)</Button></>}</>
        : <><Button variant="secondary" onClick={onClose} disabled={saving}>Annuler</Button>
          {isFin && <Button variant="secondary" icon={Printer} onClick={printPdf}>PDF</Button>}
          {isFin && editing && <Button variant="secondary" icon={FileSpreadsheet} onClick={() => api.downloadReportXlsx(reportId)}>Excel</Button>}
          <Button onClick={save} loading={saving} icon={FileText}>Enregistrer</Button></>}
    >
      {loading ? <Skeleton height={240} /> : (
        <div style={{ display: 'grid', gap: 18 }}>
          {/* Choix du type à la création : financier (facture) ou technique. */}
          {!editing && (
            <div className="field">
              <span className="field-label">Type de rapport</span>
              <div className="seg" role="group" aria-label="Type de rapport">
                <button type="button" className={isFin ? 'is-active' : ''} onClick={() => setKind('financier')}>Financier (facture)</button>
                <button type="button" className={!isFin ? 'is-active' : ''} onClick={() => setKind('technique')}>Technique</button>
              </div>
            </div>
          )}

          <div className="form-grid">
            {!editing && (
              <>
                <Field label="Prestataire TPM" required error={touched && !head.partnerId ? 'Requis.' : undefined}>
                  <select className={`select ${head.partnerId ? '' : 'is-empty'}`} value={head.partnerId} onChange={(e) => setHead({ ...head, partnerId: e.target.value })}>
                    <option value="">Choisir…</option>{partners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </Field>
                <Field label="Contrat suivi" required error={touched && !head.contractId ? 'Requis.' : undefined}>
                  <select className={`select ${head.contractId ? '' : 'is-empty'}`} value={head.contractId} onChange={(e) => setHead({ ...head, contractId: e.target.value })}>
                    <option value="">Choisir…</option>{contracts.map((c) => <option key={c.id} value={c.id}>{c.partnerName} · {c.numero}</option>)}
                  </select>
                </Field>
              </>
            )}
            {isFin && <>
              <Field label="N° de facture"><input className="input mono" value={head.invoiceNo} disabled={readOnly} onChange={(e) => setHead({ ...head, invoiceNo: e.target.value })} placeholder="FAC-2025-11" /></Field>
              <Field label="Fin de période" hint="Facture pluri-mensuelle (optionnel)."><input className="input" type="month" value={head.periodEnd} disabled={readOnly} onChange={(e) => setHead({ ...head, periodEnd: e.target.value })} /></Field>
              <Field label="Avance déduite (Ar)"><MoneyInput value={head.advanceDeducted} onChange={(v) => setHead({ ...head, advanceDeducted: v })} /></Field>
            </>}
          </div>

          {contract && <div className="note"><Coins size={18} aria-hidden="true" /><span>Budget Suivi/TPM du contrat : <strong>{formatAr(contract.monitoringBudget)}</strong> · barème mensuel <strong>{formatAr(contract.monthlyCeiling)}</strong></span></div>}

          {touched && errors.length > 0 && <Alert tone="error" icon={AlertCircle}>{errors[0]}</Alert>}

          {isFin ? (
            <>
              {!readOnly && !editing && (
                <div><Button variant="secondary" size="sm" icon={Wand2} loading={prefilling} onClick={prefillFromPlan}>Pré-remplir depuis le plan de collecte</Button></div>
              )}
              <PostesEditor
                rows={rows}
                onChange={setRows}
                readOnly={readOnly}
                funderLabel="À la charge du bailleur (Réalisé)"
                advance={head.advanceDeducted !== '' ? Number(head.advanceDeducted) : 0}
                activities={context?.activities || []}
              />
              {invoice && <InvoiceBudgetTable invoice={invoice} rows={rows} />}
            </>
          ) : (
            <div className="form-grid">
              <Field label="Budget prévu du mois (Ar)" hint={contract ? `Barème mensuel : ${formatAr(contract.monthlyCeiling)}` : 'Total ÷ nombre de mois.'}>
                <MoneyInput value={head.plannedAmount} onChange={(v) => setHead({ ...head, plannedAmount: v })} />
              </Field>
              <Field label="Nom du document" hint="Métadonnée (fichier non stocké pour l'instant).">
                <input className="input" value={head.documentName} onChange={(e) => setHead({ ...head, documentName: e.target.value })} placeholder="Rapport_technique_AINA_2026-06.pdf" />
              </Field>
              <Field label="Référence"><input className="input mono" value={head.reference} onChange={(e) => setHead({ ...head, reference: e.target.value })} /></Field>
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
      <div className="card-header"><div className="card-title">Suivi budgétaire (cumulé)</div>
        <div className="card-sub">Budget contribution bailleur · dépenses du mois · cumulé · restant, par section FLA.</div></div>
      <div className="table-wrap">
        <table className="table">
          <thead><tr>
            <th scope="col">Section</th>
            <th scope="col" className="num">Budget</th>
            <th scope="col" className="num">Dépenses du mois</th>
            <th scope="col" className="num">Cumulé</th>
            <th scope="col" className="num">Restant</th>
          </tr></thead>
          <tbody>
            {secs.map((s) => (
              <tr key={s.code}>
                <td><strong>{s.code}</strong> — {s.label}</td>
                <td className="num tabular">{formatAr(s.budget)}</td>
                <td className="num tabular">{formatAr(s.month)}</td>
                <td className="num tabular">{formatAr(s.cumul)}</td>
                <td className="num tabular" style={s.restant < 0 ? { color: 'var(--red)' } : undefined}>{formatAr(s.restant)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot><tr>
            <td style={{ textAlign: 'right' }}><strong>Total</strong></td>
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
