import React from 'react';
import { Plus, Trash2 } from 'lucide-react';
import MoneyInput from './MoneyInput.jsx';
import { Button } from './ui.jsx';
import { formatAr } from '../lib/format.js';
import { SECTIONS, MONITORING_LINE } from '../lib/budgetCatalog.js';

// Flattened line options for the "ligne budgétaire" selector.
export const LINE_OPTIONS = SECTIONS.flatMap((s) =>
  s.lines.map(([line, label]) => ({ value: `${s.code}.${line}`, section: s.code, group: `${s.code} — ${s.short}`, label }))
);
const LINE_LABEL = Object.fromEntries(LINE_OPTIONS.map((o) => [o.value, o.label]));

const itemAmount = (it) => (Number(it.unitCount) || 0) * (Number(it.unitCost) || 0);

/** Sum of item amounts (direct costs). */
export function itemsDirect(items) {
  return items.reduce((n, it) => n + itemAmount(it), 0);
}
export function itemsGrand(items, feePct) {
  const direct = itemsDirect(items);
  return direct + Math.round(direct * (Number(feePct) || 0) * 100) / 100;
}

/** Convert editor rows → API payload items (allocations 100% to the chosen activity). */
export function itemsToPayload(items) {
  return items
    .filter((it) => String(it.description || '').trim() && it.activityId)
    .map((it) => ({
      lineCode: it.lineCode,
      description: String(it.description).trim(),
      unitCount: Number(it.unitCount) || 0,
      unitCost: Number(it.unitCost) || 0,
      allocations: { [it.activityId]: 1 },
    }));
}

/** Rebuild editor rows from a server budget view. */
export function itemsFromBudget(budget) {
  const rows = [];
  for (const sec of budget.sections) {
    for (const line of sec.lines) {
      for (const it of line.items) {
        const activityId = Object.keys(it.allocations || {})[0] || (budget.activities[0] && budget.activities[0].id);
        rows.push({
          lineCode: line.lineCode, description: it.description,
          unitCount: it.unitCount, unitCost: it.unitCost, activityId,
        });
      }
    }
  }
  return rows;
}

let _seq = 0;
const emptyRow = (activityId) => ({ _k: ++_seq, lineCode: MONITORING_LINE, description: '', unitCount: '', unitCost: '', activityId });

/**
 * Editable FLA budget: a list of postes (qté × coût unitaire), each on a cost
 * line and one activity. Below: commission de gestion (%) and the computed
 * "Total de l'accord" (the contract ceiling — never typed).
 */
export function BudgetItemsEditor({ activities, items, onItems, feePct, onFee }) {
  if (activities.length === 0) {
    return <p className="muted" style={{ fontSize: 14 }}>Sélectionnez d'abord au moins une activité pour saisir le budget.</p>;
  }
  const rows = items.map((it) => ({ ...it, _k: it._k ?? ++_seq }));
  const setRow = (k, patch) => onItems(rows.map((r) => (r._k === k ? { ...r, ...patch } : r)));
  const addRow = () => onItems([...rows, emptyRow(activities[0].id)]);
  const delRow = (k) => onItems(rows.filter((r) => r._k !== k));

  const direct = itemsDirect(rows);
  const fee = Number(feePct) || 0;
  const feeAmount = Math.round(direct * fee * 100) / 100;
  const grand = direct + feeAmount;

  // Totaux par activité (combien pour le suivi, le ciblage, etc.).
  const perActivity = activities.map((a) => ({
    ...a,
    total: rows.reduce((n, r) => n + (r.activityId === a.id ? itemAmount(r) : 0), 0),
  }));

  return (
    <div>
      <div className="table-wrap">
        <table className="table budget-editor">
          <thead>
            <tr>
              <th scope="col" style={{ minWidth: 200 }}>Ligne budgétaire</th>
              <th scope="col" style={{ minWidth: 220 }}>Poste (description)</th>
              <th scope="col" className="num">Nb unités</th>
              <th scope="col" className="num">Coût/unité</th>
              <th scope="col" style={{ minWidth: 150 }}>Activité</th>
              <th scope="col" className="num">Montant</th>
              <th scope="col" />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={7} className="muted" style={{ textAlign: 'center', padding: 20 }}>
                Aucun poste. Ajoutez les postes de dépense (indemnités, transport, matériel…).
              </td></tr>
            )}
            {rows.map((r) => {
              const isMon = r.lineCode === MONITORING_LINE;
              return (
                <tr key={r._k} className={isMon ? 'row-highlight' : ''}>
                  <td>
                    <select className="select" value={r.lineCode} onChange={(e) => setRow(r._k, { lineCode: e.target.value })} aria-label="Ligne budgétaire">
                      {SECTIONS.map((s) => (
                        <optgroup key={s.code} label={`${s.code} — ${s.short}`}>
                          {s.lines.map(([line, label]) => <option key={line} value={`${s.code}.${line}`}>{label}</option>)}
                        </optgroup>
                      ))}
                    </select>
                  </td>
                  <td><input className="input" value={r.description} onChange={(e) => setRow(r._k, { description: e.target.value })} placeholder="Ex. COLLECTE Indemnité des agents" aria-label="Description du poste" /></td>
                  <td><input className="input tabular" type="number" min="0" step="1" value={r.unitCount} onChange={(e) => setRow(r._k, { unitCount: e.target.value })} aria-label="Nombre d'unités" style={{ textAlign: 'right', minWidth: 90 }} /></td>
                  <td><MoneyInput value={r.unitCost} onChange={(v) => setRow(r._k, { unitCost: v })} ariaLabel="Coût unitaire" /></td>
                  <td>
                    <select className="select" value={r.activityId} onChange={(e) => setRow(r._k, { activityId: e.target.value })} aria-label="Activité de la ligne">
                      {activities.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
                    </select>
                  </td>
                  <td className="num tabular">{formatAr(itemAmount(r))}</td>
                  <td style={{ textAlign: 'right' }}>
                    <Button size="sm" variant="ghost" icon={Trash2} onClick={() => delRow(r._k)} aria-label="Supprimer le poste" />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div style={{ padding: '12px 0' }}>
        <Button size="sm" variant="secondary" icon={Plus} onClick={addRow}>Ajouter un poste</Button>
      </div>

      <div className="budget-totals">
        {perActivity.length > 1 && perActivity.map((a) => (
          <div className="row" key={a.id}><span>Total {a.label}</span><span className="tabular">{formatAr(a.total)}</span></div>
        ))}
        <div className="row"><span>Total des coûts directs (sections I–V)</span><strong className="tabular">{formatAr(direct)}</strong></div>
        <div className="row">
          <span>
            Commission de gestion
            <input className="input fee-input tabular" type="number" min="0" max="100" step="0.5"
              value={Math.round(fee * 1000) / 10} onChange={(e) => onFee((Number(e.target.value) || 0) / 100)} aria-label="Commission de gestion en %" /> %
          </span>
          <strong className="tabular">{formatAr(feeAmount)}</strong>
        </div>
        <div className="row grand"><span>Total de l'accord (plafond du contrat)</span><strong className="tabular">{formatAr(grand)}</strong></div>
      </div>
    </div>
  );
}

/** One section's detail table (lines → postes → sous-totaux), like a section
 * sheet of the FLA workbook. */
function SectionSheet({ sec, activities, single }) {
  const cols = single ? 4 : 5;
  const hasItems = sec.lines.some((l) => l.items.length > 0);
  return (
    <div className="table-wrap">
      <table className="table matrix">
        <thead>
          <tr>
            <th scope="col" style={{ minWidth: 260 }}>Poste</th>
            <th scope="col" className="num">Nb unités</th>
            <th scope="col" className="num">Coût/unité</th>
            {!single && <th scope="col">Activité</th>}
            <th scope="col" className="num">Montant</th>
          </tr>
        </thead>
        <tbody>
          {!hasItems && (
            <tr><td colSpan={cols} className="muted" style={{ textAlign: 'center', padding: 22 }}>
              Aucun poste budgétisé dans cette section.
            </td></tr>
          )}
          {sec.lines.filter((l) => l.items.length > 0).map((line) => (
            <React.Fragment key={line.lineCode}>
              {line.items.length > 1 && (
                <tr className="subrow"><td className="indent" colSpan={cols}><strong>{line.label}</strong>{line.lineCode === MONITORING_LINE && <span className="tag" style={{ marginLeft: 8 }}>TPM</span>}</td></tr>
              )}
              {line.items.map((it) => {
                const actId = Object.keys(it.byActivity).find((k) => it.byActivity[k] > 0);
                const act = activities.find((a) => a.id === actId);
                return (
                  <tr key={it.id} className={line.lineCode === MONITORING_LINE ? 'row-highlight' : ''}>
                    <td className="indent">{it.description}{line.items.length === 1 && line.lineCode === MONITORING_LINE && <span className="tag" style={{ marginLeft: 8 }}>TPM</span>}</td>
                    <td className="num tabular">{it.unitCount}</td>
                    <td className="num tabular">{formatAr(it.unitCost)}</td>
                    {!single && <td>{act ? act.label : '—'}</td>}
                    <td className="num tabular">{formatAr(it.amount)}</td>
                  </tr>
                );
              })}
              <tr className="subrow-foot">
                <td className="indent" colSpan={cols - 1} style={{ textAlign: 'right' }}>Sous-total {line.label}</td>
                <td className="num tabular"><strong>{formatAr(line.total)}</strong></td>
              </tr>
            </React.Fragment>
          ))}
        </tbody>
        <tfoot>
          {!single && activities.map((a) => (
            <tr key={a.id}><td colSpan={cols - 1} style={{ textAlign: 'right' }} className="muted">Total {a.label}</td><td className="num tabular">{formatAr(sec.byActivity[a.id] || 0)}</td></tr>
          ))}
          <tr className="grand-row"><td colSpan={cols - 1} style={{ textAlign: 'right' }}><strong>Total section {sec.code}</strong></td><td className="num tabular"><strong>{formatAr(sec.total)}</strong></td></tr>
        </tfoot>
      </table>
    </div>
  );
}

/** Synthesis sheet: one row per section + the agreement totals, like the FLA
 * workbook's overview tab. */
function OverviewSheet({ budget, monthlyCeiling }) {
  const { sections, activities, direct, managementFee, total } = budget;
  const single = activities.length <= 1;
  const cols = single ? 2 : 2 + activities.length;
  return (
    <div className="table-wrap">
      <table className="table matrix">
        <thead>
          <tr>
            <th scope="col" style={{ minWidth: 300 }}>Section</th>
            {!single && activities.map((a) => <th key={a.id} scope="col" className="num">{a.label}</th>)}
            <th scope="col" className="num">Total</th>
          </tr>
        </thead>
        <tbody>
          {sections.map((sec) => (
            <tr key={sec.code} className={sec.total > 0 ? '' : 'muted'}>
              <td><strong>{sec.code}</strong> — {sec.label}</td>
              {!single && activities.map((a) => <td key={a.id} className="num tabular">{formatAr(sec.byActivity[a.id] || 0)}</td>)}
              <td className="num tabular">{formatAr(sec.total)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr><td style={{ textAlign: 'right' }}>Total des coûts directs (I–V)</td>{!single && activities.map((a) => <td key={a.id} className="num tabular">{formatAr(direct.byActivity[a.id] || 0)}</td>)}<td className="num tabular"><strong>{formatAr(direct.total)}</strong></td></tr>
          <tr><td colSpan={cols - 1} style={{ textAlign: 'right' }}>Commission de gestion ({Math.round(managementFee.pct * 1000) / 10} %)</td><td className="num tabular">{formatAr(managementFee.amount)}</td></tr>
          <tr className="grand-row"><td colSpan={cols - 1} style={{ textAlign: 'right' }}><strong>Total de l'accord</strong></td><td className="num tabular"><strong>{formatAr(total.grand)}</strong></td></tr>
          {monthlyCeiling != null && (
            <tr><td colSpan={cols - 1} style={{ textAlign: 'right' }}>Barème mensuel (total ÷ mois)</td><td className="num tabular">{formatAr(monthlyCeiling)}</td></tr>
          )}
        </tfoot>
      </table>
    </div>
  );
}

/**
 * Read-only FLA budget, laid out like the workbook: a « Vue d'ensemble »
 * synthesis sheet plus one page per section (I–V), navigated with a tab bar —
 * so each section is read page by page, exactly as in the Excel.
 */
export function BudgetItemsView({ budget, monthlyCeiling }) {
  const { sections, activities } = budget;
  const single = activities.length <= 1;
  const [view, setView] = React.useState('overview');
  const activeSec = sections.find((s) => s.code === view);

  return (
    <div className="budget-sheets">
      <div className="seg budget-nav" role="tablist" aria-label="Sections du budget" style={{ marginBottom: 14 }}>
        <button type="button" role="tab" aria-selected={view === 'overview'} className={view === 'overview' ? 'is-active' : ''} onClick={() => setView('overview')}>
          Vue d'ensemble
        </button>
        {sections.map((s) => (
          <button
            key={s.code} type="button" role="tab" aria-selected={view === s.code}
            className={view === s.code ? 'is-active' : ''}
            title={`${s.code} — ${s.label}`}
            onClick={() => setView(s.code)}
          >
            {s.code}{s.total > 0 ? '' : ' ·'}
          </button>
        ))}
      </div>

      {view === 'overview' ? (
        <OverviewSheet budget={budget} monthlyCeiling={monthlyCeiling} />
      ) : activeSec ? (
        <>
          <div className="sheet-title" style={{ margin: '2px 0 10px' }}>
            <span className="sheet-code">{activeSec.code}</span>
            <span className="sheet-label">{activeSec.label}</span>
          </div>
          <SectionSheet sec={activeSec} activities={activities} single={single} />
        </>
      ) : null}
    </div>
  );
}
