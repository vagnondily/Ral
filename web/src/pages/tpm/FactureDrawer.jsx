import React, { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2, Coins, AlertCircle, FileText } from 'lucide-react';
import { api } from '../../api/client.js';
import { Alert, Button, Field, Skeleton } from '../../components/ui.jsx';
import Modal from '../../components/Modal.jsx';
import MoneyInput from '../../components/MoneyInput.jsx';
import { useToast } from '../../components/Toast.jsx';
import { SECTIONS, SECTION_OF } from '../../lib/budgetCatalog.js';
import { formatAr } from '../../lib/format.js';

let seq = 0;
const newRow = (lineCode = 'IV.suivi') => ({
  key: `r${seq++}`, lineCode, designation: '', unit: '', unitCount: '', unitCost: '', payBy: 'PAM', observation: '',
});

const rowAmount = (r) => {
  const q = Number(r.unitCount); const c = Number(r.unitCost);
  return Number.isFinite(q) && Number.isFinite(c) ? Math.round(q * c * 100) / 100 : 0;
};

/**
 * Facture fidèle — éditeur/visualiseur de l'état des dépenses TPM.
 * Reproduit la facture réelle : postes (quantité × coût unitaire = montant),
 * payés par le PAM ou l'ONG, groupés par section FLA I–V. Le « Réalisé »
 * comptabilisé est la part PAM.
 */
export default function FactureDrawer({ reportId, initial, context, month, onClose, onSaved }) {
  const toast = useToast();
  const editing = Boolean(reportId);
  const [loading, setLoading] = useState(editing);
  const [saving, setSaving] = useState(false);
  const [readOnly, setReadOnly] = useState(false);
  const [touched, setTouched] = useState(false);

  const [head, setHead] = useState({
    partnerId: initial?.partnerId || '', contractId: initial?.contractId || '',
    invoiceNo: '', periodEnd: '', advanceDeducted: '', plannedAmount: '',
    partnerName: '', contractNumero: '',
  });
  const [rows, setRows] = useState(editing ? [] : [newRow()]);

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
        advanceDeducted: r.advanceDeducted || '', plannedAmount: r.plannedAmount || '',
      }));
      setRows((r.items || []).map((it) => ({
        key: `r${seq++}`, lineCode: it.lineCode, designation: it.designation, unit: it.unit || '',
        unitCount: it.unitCount ?? '', unitCost: it.unitCost ?? '', payBy: it.payBy || 'PAM', observation: it.observation || '',
      })));
      setLoading(false);
    }).catch((e) => { if (alive) { toast.error(e.message); setLoading(false); } });
    return () => { alive = false; };
  }, [editing, reportId, toast]);

  const totals = useMemo(() => {
    const bySec = {};
    let total = 0; let pam = 0; let ong = 0;
    for (const r of rows) {
      const amt = rowAmount(r);
      const sec = SECTION_OF[r.lineCode] || '?';
      bySec[sec] = (bySec[sec] || 0) + amt;
      total += amt;
      if (r.payBy === 'ONG') ong += amt; else pam += amt;
    }
    return { bySec, total, pam, ong };
  }, [rows]);

  function setRow(key, patch) { setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r))); }
  function addRow(sectionCode) {
    const sec = SECTIONS.find((s) => s.code === sectionCode);
    setRows((rs) => [...rs, newRow(sec ? `${sec.code}.${sec.lines[0][0]}` : 'IV.suivi')]);
  }
  function removeRow(key) { setRows((rs) => rs.filter((r) => r.key !== key)); }

  const errors = [];
  if (!editing && !head.partnerId) errors.push('Choisissez un prestataire.');
  if (!editing && !head.contractId) errors.push('Choisissez un contrat.');
  const validRows = rows.filter((r) => r.designation.trim().length >= 2 && Number(r.unitCount) >= 0 && Number(r.unitCost) >= 0);
  if (validRows.length === 0) errors.push('Ajoutez au moins un poste (désignation, quantité, coût).');

  async function save() {
    setTouched(true);
    if (errors.length) return;
    const items = rows
      .filter((r) => r.designation.trim().length >= 2)
      .map((r) => ({
        lineCode: r.lineCode, designation: r.designation.trim(), unit: r.unit.trim() || undefined,
        unitCount: Number(r.unitCount) || 0, unitCost: Number(r.unitCost) || 0, payBy: r.payBy,
        observation: r.observation.trim() || undefined,
      }));
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
          plannedAmount: head.plannedAmount !== '' ? Number(head.plannedAmount) : undefined,
          items,
        });
      }
      toast.success('Facture enregistrée.');
      onSaved();
    } catch (e) { toast.error(e.message); } finally { setSaving(false); }
  }

  const title = editing ? 'État des dépenses (facture)' : 'Nouvelle facture — état des dépenses';
  const subtitle = editing
    ? `${head.partnerName || ''} · ${head.contractNumero || ''}${readOnly ? ' · validée (lecture seule)' : ''}`
    : 'Postes quantité × coût unitaire, payés par le PAM ou l\'ONG, groupés par section FLA.';

  return (
    <Modal
      open variant="drawer" size="xl" title={title} subtitle={subtitle}
      onClose={() => !saving && onClose()}
      footer={readOnly
        ? <Button variant="secondary" onClick={onClose}>Fermer</Button>
        : <><Button variant="secondary" onClick={onClose} disabled={saving}>Annuler</Button>
          <Button onClick={save} loading={saving} icon={FileText}>Enregistrer la facture</Button></>}
    >
      {loading ? <Skeleton height={240} /> : (
        <div style={{ display: 'grid', gap: 18 }}>
          {/* En-tête de la facture */}
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
            <Field label="N° de facture"><input className="input mono" value={head.invoiceNo} disabled={readOnly} onChange={(e) => setHead({ ...head, invoiceNo: e.target.value })} placeholder="FAC-YPA-2025-11" /></Field>
            <Field label="Fin de période" hint="Facture pluri-mensuelle (optionnel)."><input className="input" type="month" value={head.periodEnd} disabled={readOnly} onChange={(e) => setHead({ ...head, periodEnd: e.target.value })} /></Field>
            <Field label="Avance déduite (Ar)"><MoneyInput value={head.advanceDeducted} onChange={(v) => setHead({ ...head, advanceDeducted: v })} /></Field>
            {!editing && <Field label="Budget prévu du mois (Ar)" hint={contract ? `Barème mensuel ${formatAr(contract.monthlyCeiling)}` : undefined}><MoneyInput value={head.plannedAmount} onChange={(v) => setHead({ ...head, plannedAmount: v })} /></Field>}
          </div>

          {contract && <div className="note"><Coins size={18} aria-hidden="true" /><span>Budget Suivi/TPM du contrat : <strong>{formatAr(contract.monitoringBudget)}</strong> · barème mensuel <strong>{formatAr(contract.monthlyCeiling)}</strong></span></div>}

          {touched && errors.length > 0 && <Alert tone="error" icon={AlertCircle}>{errors[0]}</Alert>}

          {/* Sections FLA */}
          {SECTIONS.map((sec) => {
            const secRows = rows.filter((r) => (SECTION_OF[r.lineCode] || '?') === sec.code);
            if (readOnly && secRows.length === 0) return null;
            return (
              <div key={sec.code} className="facture-sec">
                <div className="facture-sec-head">
                  <h3 className="facture-sec-title">{sec.code}. {sec.label}</h3>
                  <span className="mono muted">{formatAr(totals.bySec[sec.code] || 0)}</span>
                </div>
                {secRows.length > 0 && (
                  <div className="table-wrap">
                    <table className="table facture-table">
                      <thead><tr>
                        <th scope="col">Ligne / Désignation</th>
                        <th scope="col">Unité</th>
                        <th scope="col" className="num">Qté</th>
                        <th scope="col" className="num">Coût unit.</th>
                        <th scope="col" className="num">Montant</th>
                        <th scope="col">Payé par</th>
                        <th scope="col">Observation</th>
                        {!readOnly && <th scope="col" aria-label="Actions" />}
                      </tr></thead>
                      <tbody>
                        {secRows.map((r) => (
                          <tr key={r.key}>
                            <td>
                              <select className="select" value={r.lineCode} disabled={readOnly} onChange={(e) => setRow(r.key, { lineCode: e.target.value })} aria-label="Ligne budgétaire">
                                {sec.lines.map(([code, label]) => <option key={code} value={`${sec.code}.${code}`}>{label}</option>)}
                              </select>
                              <input className="input" style={{ marginTop: 6 }} value={r.designation} disabled={readOnly} placeholder="Désignation du poste" onChange={(e) => setRow(r.key, { designation: e.target.value })} />
                            </td>
                            <td><input className="input" style={{ width: 90 }} value={r.unit} disabled={readOnly} placeholder="jour" onChange={(e) => setRow(r.key, { unit: e.target.value })} /></td>
                            <td className="num"><input className="input tabular" style={{ width: 72, textAlign: 'right' }} inputMode="decimal" value={r.unitCount} disabled={readOnly} onChange={(e) => setRow(r.key, { unitCount: e.target.value })} /></td>
                            <td className="num" style={{ minWidth: 130 }}><MoneyInput value={r.unitCost === '' ? '' : Number(r.unitCost)} onChange={(v) => setRow(r.key, { unitCost: v })} /></td>
                            <td className="num mono">{formatAr(rowAmount(r))}</td>
                            <td>
                              <select className="select" style={{ minWidth: 84 }} value={r.payBy} disabled={readOnly} onChange={(e) => setRow(r.key, { payBy: e.target.value })} aria-label="Payé par">
                                <option value="PAM">PAM</option><option value="ONG">ONG</option>
                              </select>
                            </td>
                            <td><input className="input" value={r.observation} disabled={readOnly} onChange={(e) => setRow(r.key, { observation: e.target.value })} /></td>
                            {!readOnly && <td><Button size="sm" variant="ghost" icon={Trash2} aria-label="Supprimer le poste" onClick={() => removeRow(r.key)} /></td>}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {!readOnly && <Button size="sm" variant="ghost" icon={Plus} onClick={() => addRow(sec.code)}>Ajouter un poste — {sec.short}</Button>}
              </div>
            );
          })}

          {/* Totaux */}
          <div className="facture-totals">
            <div><span className="stat-label">Total des dépenses</span><span className="stat-value">{formatAr(totals.total)}</span></div>
            <div><span className="stat-label">À payer par le PAM (Réalisé)</span><span className="stat-value">{formatAr(totals.pam)}</span></div>
            <div><span className="stat-label">À payer par l'ONG</span><span className="stat-value">{formatAr(totals.ong)}</span></div>
            {head.advanceDeducted !== '' && Number(head.advanceDeducted) > 0 && (
              <div><span className="stat-label">Net après avance déduite</span><span className="stat-value">{formatAr(totals.pam - Number(head.advanceDeducted))}</span></div>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
