import React from 'react';
import { useI18n } from '../../../lib/i18n.jsx';
import { rampColor } from '../../../lib/reportViz.js';
import { RichTextView } from '../RichText.jsx';
import { Cell, Empty, colLabel, isNumeric } from './common.jsx';

/**
 * Tableau d'un jeu de données : colonnes choisies, en-tête répété à l'impression, lignes de
 * total en gras, classes et statuts avec icône + libellé. `annotate` (cov.by_activity) ajoute
 * la colonne « Constat » éditée par ligne (texte riche du document, clé de ligne stable).
 */
export function DataTable({ data, columns: pick, annotate, annotations }) {
  const { tr } = useI18n();
  if (!data) return null;
  const cols = pick && pick.length ? data.columns.filter((c) => pick.includes(c.key)) : data.columns;
  if (!data.rows.length) return <Empty note={data.meta && data.meta.note} />;
  const notes = annotations || {};
  return (
    <div className="rb-table-wrap">
      <table className="rb-table">
        <thead><tr>
          {cols.map((c) => <th key={c.key} className={isNumeric(c) ? 'num' : ''}>{colLabel(c, tr)}</th>)}
          {annotate && <th>{tr(annotate.label)}</th>}
        </tr></thead>
        <tbody>
          {data.rows.map((r, i) => (
            <tr key={r._key || i} className={r._total ? 'rb-total' : undefined}>
              {cols.map((c) => <td key={c.key} className={isNumeric(c) ? 'num' : ''}><Cell col={c} value={r[c.key]} tr={tr} /></td>)}
              {annotate && <td className="rb-annot">{r._key && notes[r._key] ? <RichTextView doc={notes[r._key]} vars={{}} /> : null}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Matrice colorée : intensité sur la rampe bleue unique (guide de visualisation), valeur
 * toujours écrite ; texte clair sur les cases foncées.
 */
export function HeatTable({ data, columns: pick }) {
  const { tr } = useI18n();
  if (!data) return null;
  const cols = pick && pick.length ? data.columns.filter((c) => pick.includes(c.key)) : data.columns;
  if (!data.rows.length) return <Empty note={data.meta && data.meta.note} />;
  const heat = cols.filter((c) => c.type === 'pct' || c.key.startsWith('m:') || c.key.startsWith('d:'));
  const max = heat.some((c) => c.type === 'pct') ? 100 : Math.max(1, ...data.rows.flatMap((r) => heat.map((c) => Number(r[c.key]) || 0)));
  return (
    <div className="rb-table-wrap">
      <table className="rb-table rb-matrix">
        <thead><tr>{cols.map((c) => <th key={c.key} className={isNumeric(c) ? 'num' : ''}>{colLabel(c, tr)}</th>)}</tr></thead>
        <tbody>
          {data.rows.map((r, i) => (
            <tr key={r._key || i} className={r._total ? 'rb-total' : undefined}>
              {cols.map((c) => {
                const v = r[c.key];
                if (!heat.includes(c)) return <td key={c.key} className={isNumeric(c) ? 'num' : ''}><Cell col={c} value={v} tr={tr} /></td>;
                const bg = rampColor(v, max);
                const dark = bg && ['#2a71c8', '#16539f', '#0d366b', '#4d8fe0'].includes(bg);
                return <td key={c.key} className="num rb-heat" style={bg ? { background: bg, color: dark ? '#fff' : '#14181f' } : undefined}><Cell col={c} value={v} tr={tr} /></td>;
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
