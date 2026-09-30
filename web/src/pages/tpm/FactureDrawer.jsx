import React, { useEffect, useState } from 'react';
import { Coins, AlertCircle, FileText, Wand2, Printer, FileSpreadsheet } from 'lucide-react';
import { api } from '../../api/client.js';
import { Alert, Button, Field, Skeleton } from '../../components/ui.jsx';
import Modal from '../../components/Modal.jsx';
import MoneyInput from '../../components/MoneyInput.jsx';
import { useToast } from '../../components/Toast.jsx';
import { formatAr } from '../../lib/format.js';
import { openFacturePrint } from '../../lib/facturePrint.js';
import PostesEditor, { newPoste, rowsFromItems, itemsFromRows } from './PostesEditor.jsx';

/**
 * Facture fidèle — éditeur/visualiseur de l'état des dépenses TPM.
 * Postes quantité × coût unitaire, à la charge du bailleur ou de l'ONG,
 * groupés par section FLA I–V. Le « Réalisé » comptabilisé est la part
 * bailleur. Peut être pré-rempli depuis le plan de collecte du mois.
 */
export default function FactureDrawer({ reportId, initial, context, month, onClose, onSaved }) {
  const toast = useToast();
  const editing = Boolean(reportId);
  const [loading, setLoading] = useState(editing);
  const [saving, setSaving] = useState(false);
  const [prefilling, setPrefilling] = useState(false);
  const [readOnly, setReadOnly] = useState(false);
  const [touched, setTouched] = useState(false);

  const [head, setHead] = useState({
    partnerId: initial?.partnerId || '', contractId: initial?.contractId || '',
    invoiceNo: '', periodEnd: '', advanceDeducted: '', partnerName: '', contractNumero: '',
  });
  const [rows, setRows] = useState(editing ? [] : [newPoste()]);

  const partners = context?.partners || [];
  const contracts = context?.contracts || [];
  const contract = contracts.find((c) => c.id === head.contractId);

  useEffect(() => {
    if (!editing) return;
    let alive = true;
    api.getReport(reportId).then((r) => {
      if (!alive) return;
      setReadOnly(r.status === 'valide');
      setHead((h) => ({
        ...h,
        partnerId: r.partnerId, contractId: r.contractId, partnerName: r.partnerName, contractNumero: r.contractNumero,
        invoiceNo: r.invoiceNo || '', periodEnd: r.periodEnd ? r.periodEnd.slice(0, 7) : '',
        advanceDeducted: r.advanceDeducted || '',
      }));
      setRows(rowsFromItems(r.items));
      setLoading(false);
    }).catch((e) => { if (alive) { toast.error(e.message); setLoading(false); } });
    return () => { alive = false; };
  }, [editing, reportId, toast]);

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
  if (itemsFromRows(rows).length === 0) errors.push('Ajoutez au moins un poste (désignation, quantité, coût).');

  async function save() {
    setTouched(true);
    if (errors.length) return;
    const items = itemsFromRows(rows);
    setSaving(true);
    try {
      if (editing) {
        await api.saveReportItems(reportId, {
          items,
          invoiceNo: head.invoiceNo.trim() || undefined,
          periodEnd: head.periodEnd || undefined,
          advanceDeducted: head.advanceDeducted !== '' ? Number(head.advanceDeducted) : undefined,
        });
      } else {
        await api.createReport({
          partnerId: head.partnerId, contractId: head.contractId, periodMonth: month, kind: 'financier',
          invoiceNo: head.invoiceNo.trim() || undefined, periodEnd: head.periodEnd || undefined,
          advanceDeducted: head.advanceDeducted !== '' ? Number(head.advanceDeducted) : undefined,
          items,
        });
      }
      toast.success('Facture enregistrée.');
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

  const title = editing ? 'État des dépenses (facture)' : 'Nouvelle facture — état des dépenses';
  const subtitle = editing
    ? `${head.partnerName || ''} · ${head.contractNumero || ''}${readOnly ? ' · validée (lecture seule)' : ''}`
    : 'Postes quantité × coût unitaire, à la charge du bailleur ou de l\'ONG, groupés par section FLA.';

  return (
    <Modal
      open variant="drawer" size="xl" title={title} subtitle={subtitle}
      onClose={() => !saving && onClose()}
      footer={readOnly
        ? <><Button variant="secondary" onClick={onClose}>Fermer</Button>
          <Button variant="secondary" icon={Printer} onClick={printPdf}>PDF</Button>
          <Button icon={FileSpreadsheet} onClick={() => api.downloadReportXlsx(reportId)}>Exporter (Excel)</Button></>
        : <><Button variant="secondary" onClick={onClose} disabled={saving}>Annuler</Button>
          <Button variant="secondary" icon={Printer} onClick={printPdf}>PDF</Button>
          {editing && <Button variant="secondary" icon={FileSpreadsheet} onClick={() => api.downloadReportXlsx(reportId)}>Excel</Button>}
          <Button onClick={save} loading={saving} icon={FileText}>Enregistrer</Button></>}
    >
      {loading ? <Skeleton height={240} /> : (
        <div style={{ display: 'grid', gap: 18 }}>
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
            <Field label="N° de facture"><input className="input mono" value={head.invoiceNo} disabled={readOnly} onChange={(e) => setHead({ ...head, invoiceNo: e.target.value })} placeholder="FAC-2025-11" /></Field>
            <Field label="Fin de période" hint="Facture pluri-mensuelle (optionnel)."><input className="input" type="month" value={head.periodEnd} disabled={readOnly} onChange={(e) => setHead({ ...head, periodEnd: e.target.value })} /></Field>
            <Field label="Avance déduite (Ar)"><MoneyInput value={head.advanceDeducted} onChange={(v) => setHead({ ...head, advanceDeducted: v })} /></Field>
          </div>

          {contract && <div className="note"><Coins size={18} aria-hidden="true" /><span>Budget Suivi/TPM du contrat : <strong>{formatAr(contract.monitoringBudget)}</strong> · barème mensuel <strong>{formatAr(contract.monthlyCeiling)}</strong></span></div>}

          {!readOnly && !editing && (
            <div><Button variant="secondary" size="sm" icon={Wand2} loading={prefilling} onClick={prefillFromPlan}>Pré-remplir depuis le plan de collecte</Button></div>
          )}

          {touched && errors.length > 0 && <Alert tone="error" icon={AlertCircle}>{errors[0]}</Alert>}

          <PostesEditor
            rows={rows}
            onChange={setRows}
            readOnly={readOnly}
            funderLabel="À la charge du bailleur (Réalisé)"
            advance={head.advanceDeducted !== '' ? Number(head.advanceDeducted) : 0}
          />
        </div>
      )}
    </Modal>
  );
}
