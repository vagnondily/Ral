import React from 'react';
import MoneyInput from './MoneyInput.jsx';
import { formatAr } from '../lib/format.js';
import { SECTIONS, MONITORING_LINE } from '../lib/budgetCatalog.js';

const key = (lineCode, activityId) => `${lineCode}::${activityId}`;

/** Sum helper over a cells object { "line::act": amount }. */
export function cellsTotal(cells) {
  return Object.values(cells).reduce((n, v) => n + (Number(v) || 0), 0);
}

export function cellsToArray(cells) {
  return Object.entries(cells)
    .filter(([, v]) => Number(v) > 0)
    .map(([k, v]) => {
      const [lineCode, activityId] = k.split('::');
      return { lineCode, activityId, amount: Number(v) };
    });
}

/**
 * Editable FLA budget matrix: sections → cost lines (rows) × activities
 * (columns). `cells` is { "lineCode::activityId": amount }; onCell(key, value)
 * updates one cell.
 */
export function BudgetMatrixEditor({ activities, cells, onCell }) {
  if (activities.length === 0) {
    return <p className="muted" style={{ fontSize: 14 }}>Sélectionnez d'abord au moins une activité pour saisir le budget.</p>;
  }
  const colTotal = (activityId) =>
    SECTIONS.reduce((n, sec) => n + sec.lines.reduce((m, [line]) => m + (Number(cells[key(`${sec.code}.${line}`, activityId)]) || 0), 0), 0);
  const grand = cellsTotal(cells);

  return (
    <div className="table-wrap">
      <table className="table matrix">
        <thead>
          <tr>
            <th scope="col" style={{ minWidth: 260 }}>Ligne budgétaire</th>
            {activities.map((a) => <th key={a.id} scope="col" className="num">{a.label}</th>)}
            <th scope="col" className="num">Total ligne</th>
          </tr>
        </thead>
        {SECTIONS.map((sec) => {
          const sectionTotal = sec.lines.reduce(
            (n, [line]) => n + activities.reduce((m, a) => m + (Number(cells[key(`${sec.code}.${line}`, a.id)]) || 0), 0), 0);
          return (
            <tbody key={sec.code}>
              <tr className="subrow-head">
                <td>{sec.code} — {sec.label}</td>
                {activities.map((a) => <td key={a.id} />)}
                <td className="num">{formatAr(sectionTotal)}</td>
              </tr>
              {sec.lines.map(([line, label]) => {
                const lineCode = `${sec.code}.${line}`;
                const lineTotal = activities.reduce((m, a) => m + (Number(cells[key(lineCode, a.id)]) || 0), 0);
                const isMonitoring = lineCode === MONITORING_LINE;
                return (
                  <tr key={lineCode} className={isMonitoring ? 'row-highlight' : ''}>
                    <td className="indent">{label}{isMonitoring && <span className="tag" style={{ marginLeft: 8 }}>TPM</span>}</td>
                    {activities.map((a) => (
                      <td key={a.id}>
                        <MoneyInput
                          value={cells[key(lineCode, a.id)] ?? ''}
                          onChange={(v) => onCell(key(lineCode, a.id), v)}
                          ariaLabel={`${label} — ${a.label}`}
                        />
                      </td>
                    ))}
                    <td className="num">{lineTotal > 0 ? formatAr(lineTotal) : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          );
        })}
        <tfoot>
          <tr>
            <td>VI — Total général</td>
            {activities.map((a) => <td key={a.id} className="num">{formatAr(colTotal(a.id))}</td>)}
            <td className="num">{formatAr(grand)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

/** Read-only view built from the server's computed budget (sections with byActivity + totals). */
export function BudgetMatrixView({ budget }) {
  const { activities, sections, total } = budget;
  return (
    <div className="table-wrap">
      <table className="table matrix">
        <thead>
          <tr>
            <th scope="col" style={{ minWidth: 260 }}>Ligne budgétaire</th>
            {activities.map((a) => <th key={a.id} scope="col" className="num">{a.label}</th>)}
            <th scope="col" className="num">Total</th>
          </tr>
        </thead>
        {sections.map((sec) => (
          <tbody key={sec.code}>
            <tr className="subrow-head">
              <td>{sec.code} — {sec.label}</td>
              {activities.map((a) => <td key={a.id} className="num">{sec.byActivity[a.id] > 0 ? formatAr(sec.byActivity[a.id]) : ''}</td>)}
              <td className="num">{formatAr(sec.total)}</td>
            </tr>
            {sec.lines.filter((l) => l.total > 0).map((l) => (
              <tr key={l.lineCode} className={l.lineCode === MONITORING_LINE ? 'row-highlight' : ''}>
                <td className="indent">{l.label}{l.lineCode === MONITORING_LINE && <span className="tag" style={{ marginLeft: 8 }}>TPM</span>}</td>
                {activities.map((a) => <td key={a.id} className="num">{l.byActivity[a.id] > 0 ? formatAr(l.byActivity[a.id]) : '—'}</td>)}
                <td className="num">{formatAr(l.total)}</td>
              </tr>
            ))}
          </tbody>
        ))}
        <tfoot>
          <tr>
            <td>VI — Total général</td>
            {activities.map((a) => <td key={a.id} className="num">{formatAr(total.byActivity[a.id])}</td>)}
            <td className="num">{formatAr(total.grand)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
