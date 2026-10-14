import React from 'react';
import { useI18n } from '../../../lib/i18n.jsx';
import { Empty, num } from './common.jsx';

const ROLE = { positive: 'Comptée positive', negative: 'Comptée non positive', counted: 'Comptée', ignored: 'Ignorée (non numérique)' };
const METHOD = {
  percent_yes: 'Part des réponses positives', percent_value: 'Part des réponses égales à la valeur attendue',
  mean: 'Moyenne des réponses numériques', sum: 'Somme des réponses numériques', count: 'Nombre de réponses',
};

/**
 * « Comment c'est calculé » pour UN indicateur (monitoringMath.explainIndicator, même décompte que
 * le résultat) : méthode, numérateur ÷ dénominateur, réponses exclues (vides, absentes, hors
 * base), distribution des réponses avec leur rôle.
 */
export default function ExplainView({ data }) {
  const { tr } = useI18n();
  const x = data && data.meta && data.meta.explain;
  if (!x) return <Empty note={data && data.meta && data.meta.note} />;
  const max = Math.max(1, ...x.distribution.map((d) => d.n));
  const pct = x.agg === 'percent_yes' || x.agg === 'percent_value';
  return (
    <div className="rb-explain">
      <p className="rb-explain-head"><strong>{x.label}</strong> · {tr(METHOD[x.agg] || x.agg)}</p>
      <dl className="rb-explain-kv">
        <div><dt>{tr('Soumissions examinées')}</dt><dd>{num(x.total)}</dd></div>
        <div><dt>{tr('Variable absente')}</dt><dd>{num(x.absent)}</dd></div>
        <div><dt>{tr('Réponses vides')}</dt><dd>{num(x.blank)}</dd></div>
        <div><dt>{tr('Codes « hors base » écartés')}</dt><dd>{num(x.naCount)}</dd></div>
        <div><dt>{tr('Réponses comptées')}</dt><dd>{num(x.answered)}</dd></div>
        {x.numerator != null && <div><dt>{tr('Calcul')}</dt><dd>{x.denominator != null ? `${num(x.numerator, 2)} ÷ ${num(x.denominator)}` : num(x.numerator, 2)} = <b>{x.value == null ? '—' : `${num(x.value, 1)}${pct ? ' %' : ''}`}</b></dd></div>}
      </dl>
      {x.distribution.length > 0 && (
        <table className="rb-table rb-explain-dist">
          <thead><tr><th>{tr('Réponse')}</th><th className="num">{tr('Effectif')}</th><th>{tr('Rôle')}</th></tr></thead>
          <tbody>
            {x.distribution.map((d) => (
              <tr key={String(d.value)}>
                <td>{d.label ? `${d.label} (${d.value})` : String(d.value)}</td>
                <td className="num"><span className="rb-mini" style={{ width: `${Math.round((d.n / max) * 60)}px` }} aria-hidden="true" />{num(d.n)}</td>
                <td>{tr(ROLE[d.role] || d.role)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {x.others && x.others.n > 0 && <p className="rb-note">{tr('{n} autre(s) réponse(s) non détaillée(s).', { n: num(x.others.n) })}</p>}
    </div>
  );
}
