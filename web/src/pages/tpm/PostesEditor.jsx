import React, { useMemo, useRef, useState } from 'react';
import { Plus, Trash2, Upload, Download } from 'lucide-react';
import { api } from '../../api/client.js';
import { Button } from '../../components/ui.jsx';
import MoneyInput from '../../components/MoneyInput.jsx';
import { useToast } from '../../components/Toast.jsx';
import { SECTIONS, SECTION_OF } from '../../lib/budgetCatalog.js';
import { formatAr } from '../../lib/format.js';

let seq = 0;
export const newPoste = (lineCode = 'IV.suivi') => ({
  key: `p${seq++}`, lineCode, designation: '', unit: '', unitCount: '', unitCost: '', payBy: 'bailleur', observation: '',
});

export const posteAmount = (r) => {
  const q = Number(r.unitCount); const c = Number(r.unitCost);
  return Number.isFinite(q) && Number.isFinite(c) ? Math.round(q * c * 100) / 100 : 0;
};

/** Cent-safe totals of a list of postes: by section + bailleur/ONG split. */
export function postesTotals(rows) {
  const bySec = {};
  let total = 0; let funder = 0; let ong = 0;
  for (const r of rows) {
    const amt = posteAmount(r);
    const sec = SECTION_OF[r.lineCode] || '?';
    bySec[sec] = (bySec[sec] || 0) + amt;
    total += amt;
    if (r.payBy === 'ong') ong += amt; else funder += amt;
  }
  return { bySec, total, funder, ong };
}

/** Turn stored items (from the API) into editor rows. */
export function rowsFromItems(items) {
  return (items || []).map((it) => ({
    key: `p${seq++}`, lineCode: it.lineCode, designation: it.designation, unit: it.unit || '',
    unitCount: it.unitCount ?? '', unitCost: it.unitCost ?? '', payBy: it.payBy || 'bailleur', observation: it.observation || '',
  }));
}

/** Editor rows → API item payload (drops incomplete rows). */
export function itemsFromRows(rows) {
  return rows
    .filter((r) => r.designation.trim().length >= 2)
    .map((r) => ({
      lineCode: r.lineCode, designation: r.designation.trim(), unit: r.unit.trim() || undefined,
      unitCount: Number(r.unitCount) || 0, unitCost: Number(r.unitCost) || 0, payBy: r.payBy,
      observation: r.observation.trim() || undefined,
    }));
}

/**
 * Shared editor for an « état des dépenses » — the postes grid grouped by FLA
 * section, with live section + bailleur/ONG totals. Controlled: the parent owns
 * the `rows` array. Used by the facture (réalisé) and the plan de collecte
 * (prévu) so both stay identical in shape and maintenance.
 */
export default function PostesEditor({ rows, onChange, readOnly = false, funderLabel = 'À la charge du bailleur', advance = 0 }) {
  const totals = useMemo(() => postesTotals(rows), [rows]);
  const toast = useToast();
  const fileRef = useRef(null);
  const [importing, setImporting] = useState(false);

  async function handleImport(e) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setImporting(true);
    try {
      const { items, skipped } = await api.importPostes(f);
      onChange(rowsFromItems(items));
      toast.success(`${items.length} poste(s) importé(s)${skipped?.length ? ` · ${skipped.length} ligne(s) ignorée(s)` : ''}.`);
    } catch (err) { toast.error(err.message); } finally { setImporting(false); }
  }

  const setRow = (key, patch) => onChange(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const removeRow = (key) => onChange(rows.filter((r) => r.key !== key));
  const addRow = (sectionCode) => {
    const sec = SECTIONS.find((s) => s.code === sectionCode);
    onChange([...rows, newPoste(sec ? `${sec.code}.${sec.lines[0][0]}` : 'IV.suivi')]);
  };

  return (
    <>
      {!readOnly && (
        <div className="postes-toolbar">
          <input ref={fileRef} type="file" accept=".xlsx" hidden onChange={handleImport} />
          <Button size="sm" variant="secondary" icon={Upload} loading={importing} onClick={() => fileRef.current?.click()}>Importer Excel</Button>
          <Button size="sm" variant="ghost" icon={Download} onClick={() => api.downloadPostesTemplate().catch((e) => toast.error(e.message))}>Modèle</Button>
          <span className="hint">Remplissez le modèle hors ligne puis importez — les règles du système sont appliquées (lignes valides, montants ≥ 0, bailleur/ONG).</span>
        </div>
      )}
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
                    <th scope="col">À la charge de</th>
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
                        <td className="num mono">{formatAr(posteAmount(r))}</td>
                        <td>
                          <select className="select" style={{ minWidth: 110 }} value={r.payBy} disabled={readOnly} onChange={(e) => setRow(r.key, { payBy: e.target.value })} aria-label="À la charge de">
                            <option value="bailleur">Bailleur</option><option value="ong">ONG</option>
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

      <div className="facture-totals">
        <div><span className="stat-label">Total</span><span className="stat-value">{formatAr(totals.total)}</span></div>
        <div><span className="stat-label">{funderLabel}</span><span className="stat-value">{formatAr(totals.funder)}</span></div>
        <div><span className="stat-label">À la charge de l'ONG</span><span className="stat-value">{formatAr(totals.ong)}</span></div>
        {advance > 0 && (
          <div><span className="stat-label">Net après avance déduite</span><span className="stat-value">{formatAr(totals.funder - advance)}</span></div>
        )}
      </div>
    </>
  );
}
