import React, { useMemo, useRef, useState } from 'react';
import { Plus, Trash2, Upload, Download } from 'lucide-react';
import { api } from '../../api/client.js';
import { Button } from '../../components/ui.jsx';
import MoneyInput from '../../components/MoneyInput.jsx';
import { useToast } from '../../components/Toast.jsx';
import { SECTIONS, SECTION_OF } from '../../lib/budgetCatalog.js';
import { formatAr } from '../../lib/format.js';
import { useI18n } from '../../lib/i18n.jsx';
import { pctFraction, posteAmount, posteFunder, postesTotals } from '../../lib/postesMath.js';

let seq = 0;
export const newPoste = (lineCode = 'IV.suivi') => ({
  key: `p${seq++}`, lineCode, designation: '', unit: '', unitCount: '', unitCost: '',
  bailleurPct: 100, activityId: '', activity2Id: '', activity1Pct: '', observation: '',
});

// Montant, part bailleur (montant × % bailleur) et totaux en centimes entiers :
// module pur partagé avec l'impression de la facture (lib/facturePrint.js).
export { posteAmount, posteFunder, postesTotals };

/** Turn stored items (from the API) into editor rows. */
export function rowsFromItems(items) {
  return (items || []).map((it) => ({
    key: `p${seq++}`, lineCode: it.lineCode, designation: it.designation, unit: it.unit || '',
    unitCount: it.unitCount ?? '', unitCost: it.unitCost ?? '',
    bailleurPct: it.bailleurPct != null ? Math.round(Number(it.bailleurPct) * 100) : (it.payBy === 'ong' ? 0 : 100),
    activityId: it.activityId || '',
    activity2Id: it.activity2Id || '',
    activity1Pct: it.activity1Pct != null ? Math.round(Number(it.activity1Pct) * 100) : '',
    observation: it.observation || '',
  }));
}

/** Editor rows → API item payload (drops incomplete rows). */
export function itemsFromRows(rows) {
  return rows
    .filter((r) => r.designation.trim().length >= 2)
    .map((r) => ({
      lineCode: r.lineCode, designation: r.designation.trim(), unit: r.unit.trim() || undefined,
      unitCount: Number(r.unitCount) || 0, unitCost: Number(r.unitCost) || 0,
      bailleurPct: pctFraction(r),
      activityId: r.activityId || undefined,
      activity2Id: r.activity2Id || undefined,
      activity1Pct: r.activity2Id ? (r.activity1Pct === '' ? 1 : Math.min(1, Math.max(0, Number(r.activity1Pct) / 100))) : undefined,
      observation: r.observation.trim() || undefined,
    }));
}

/**
 * Shared editor for an « état des dépenses » — the postes grid grouped by FLA
 * section, with live section + bailleur/ONG totals. Controlled: the parent owns
 * the `rows` array. Used by the facture (réalisé) and the plan de collecte
 * (prévu) so both stay identical in shape and maintenance.
 */
export default function PostesEditor({ rows, onChange, readOnly = false, funderLabel, advance = 0, activities = [] }) {
  const { tr } = useI18n();
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
      toast.success(skipped?.length
        ? tr('{n} poste(s) importé(s) · {s} ligne(s) ignorée(s).', { n: items.length, s: skipped.length })
        : tr('{n} poste(s) importé(s).', { n: items.length }));
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
          <Button size="sm" variant="secondary" icon={Upload} loading={importing} onClick={() => fileRef.current?.click()}>{tr('Importer Excel')}</Button>
          <Button size="sm" variant="ghost" icon={Download} onClick={() => api.downloadPostesTemplate().catch((e) => toast.error(e.message))}>{tr('Modèle')}</Button>
          <span className="hint">{tr('Remplissez le modèle hors ligne puis importez — les règles du système sont appliquées (lignes valides, montants ≥ 0). Le « % bailleur » fixe la part à payer par le bailleur (100 % par défaut).')}</span>
        </div>
      )}
      {SECTIONS.map((sec) => {
        const secRows = rows.filter((r) => (SECTION_OF[r.lineCode] || '?') === sec.code);
        if (readOnly && secRows.length === 0) return null;
        return (
          <div key={sec.code} className="facture-sec">
            <div className="facture-sec-head">
              <h3 className="facture-sec-title">{sec.code}. {tr(sec.label)}</h3>
              <span className="mono muted">{formatAr(totals.bySec[sec.code] || 0)}</span>
            </div>
            {secRows.length > 0 && (
              <div className="table-wrap">
                <table className="table facture-table">
                  <thead><tr>
                    <th scope="col">{tr('Ligne / Désignation')}</th>
                    <th scope="col">{tr('Unité')}</th>
                    <th scope="col" className="num">{tr('Qté')}</th>
                    <th scope="col" className="num">{tr('Coût unit.')}</th>
                    <th scope="col" className="num">{tr('Montant')}</th>
                    <th scope="col">{tr('Activité(s)')}</th>
                    <th scope="col" className="num">{tr('% bailleur')}</th>
                    <th scope="col" className="num">{tr('À payer bailleur')}</th>
                    <th scope="col">{tr('Observation')}</th>
                    {!readOnly && <th scope="col" aria-label={tr('Actions')} />}
                  </tr></thead>
                  <tbody>
                    {secRows.map((r) => (
                      <tr key={r.key}>
                        <td>
                          <select className="select" value={r.lineCode} disabled={readOnly} onChange={(e) => setRow(r.key, { lineCode: e.target.value })} aria-label={tr('Ligne budgétaire')}>
                            {sec.lines.map(([code, label]) => <option key={code} value={`${sec.code}.${code}`}>{tr(label)}</option>)}
                          </select>
                          <input className="input" style={{ marginTop: 6 }} value={r.designation} disabled={readOnly} placeholder={tr('Désignation du poste')} onChange={(e) => setRow(r.key, { designation: e.target.value })} />
                        </td>
                        <td><input className="input" style={{ width: 90 }} value={r.unit} disabled={readOnly} placeholder={tr('jour')} onChange={(e) => setRow(r.key, { unit: e.target.value })} /></td>
                        <td className="num"><input className="input tabular" style={{ width: 72, textAlign: 'right' }} inputMode="decimal" value={r.unitCount} disabled={readOnly} onChange={(e) => setRow(r.key, { unitCount: e.target.value })} /></td>
                        <td className="num" style={{ minWidth: 130 }}><MoneyInput value={r.unitCost === '' ? '' : Number(r.unitCost)} onChange={(v) => setRow(r.key, { unitCost: v })} /></td>
                        <td className="num mono">{formatAr(posteAmount(r))}</td>
                        <td>
                          <select className={`select ${r.activityId ? '' : 'is-empty'}`} style={{ minWidth: 130 }} value={r.activityId} disabled={readOnly} onChange={(e) => setRow(r.key, { activityId: e.target.value })} aria-label={tr('Activité 1')}>
                            <option value="">{tr('— Activité —')}</option>
                            {activities.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
                          </select>
                          {(r.activity2Id || (!readOnly && r.activityId)) && (
                            <div style={{ display: 'flex', gap: 4, marginTop: 4, alignItems: 'center' }}>
                              <select className="select" style={{ minWidth: 110, flex: 1 }} value={r.activity2Id} disabled={readOnly} onChange={(e) => setRow(r.key, { activity2Id: e.target.value })} aria-label={tr('Activité 2')}>
                                <option value="">{tr('— 2ᵉ activité —')}</option>
                                {activities.filter((a) => a.id !== r.activityId).map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
                              </select>
                              {r.activity2Id && (
                                <span className="hint" style={{ whiteSpace: 'nowrap' }} title={tr("Part du montant sur l'activité 1 (le reste sur la 2ᵉ)")}>
                                  <input className="input tabular" style={{ width: 52, textAlign: 'right' }} inputMode="decimal" value={r.activity1Pct} placeholder="100" disabled={readOnly} onChange={(e) => setRow(r.key, { activity1Pct: e.target.value })} aria-label={tr('% sur activité 1')} /> %
                                </span>
                              )}
                            </div>
                          )}
                        </td>
                        <td className="num">
                          <input className="input tabular" style={{ width: 64, textAlign: 'right' }} inputMode="decimal" value={r.bailleurPct} placeholder="100" disabled={readOnly} onChange={(e) => setRow(r.key, { bailleurPct: e.target.value })} aria-label={tr('Pourcentage à la charge du bailleur')} />
                        </td>
                        <td className="num mono">{formatAr(posteFunder(r))}</td>
                        <td><input className="input" value={r.observation} disabled={readOnly} onChange={(e) => setRow(r.key, { observation: e.target.value })} /></td>
                        {!readOnly && <td><Button size="sm" variant="ghost" icon={Trash2} aria-label={tr('Supprimer le poste')} onClick={() => removeRow(r.key)} /></td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {!readOnly && <Button size="sm" variant="ghost" icon={Plus} onClick={() => addRow(sec.code)}>{tr('Ajouter un poste — {section}', { section: tr(sec.short) })}</Button>}
          </div>
        );
      })}

      <div className="facture-totals">
        <div><span className="stat-label">{tr('Total')}</span><span className="stat-value">{formatAr(totals.total)}</span></div>
        <div><span className="stat-label">{funderLabel ?? tr('À la charge du bailleur')}</span><span className="stat-value">{formatAr(totals.funder)}</span></div>
        <div><span className="stat-label">{tr("À la charge de l'ONG")}</span><span className="stat-value">{formatAr(totals.ong)}</span></div>
        {advance > 0 && (
          <div><span className="stat-label">{tr('Net après avance déduite')}</span><span className="stat-value">{formatAr(totals.funder - advance)}</span></div>
        )}
      </div>
    </>
  );
}
