import React from 'react';
import { useI18n } from '../../../lib/i18n.jsx';
import { categoryColumn, chartSeries, groupOthers, legendNeeded, seriesColors, MAX_CATEGORIES } from '../../../lib/reportViz.js';
import { colLabel, formatCell } from './common.jsx';

/**
 * Pièces communes des graphiques du concepteur (lot 7a) : SVG accessible (role="img",
 * <title>, <desc>), légende dès 2 séries, préparation des séries (mesures déclarées par le jeu,
 * couleurs dans l'ordre fixe, « Autres » au-delà de 7 catégories).
 */
export function ChartSvg({ width, height, title, desc, children }) {
  return (
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={title}>
      <title>{title}</title>
      {desc && <desc>{desc}</desc>}
      {children}
    </svg>
  );
}

export function Legend({ items }) {
  if (!legendNeeded(items.length)) return null;
  return (
    <figcaption className="rb-legend">
      {items.map((it) => <span key={it.key}><i style={{ background: it.color }} aria-hidden="true" />{it.label}</span>)}
    </figcaption>
  );
}

/**
 * Données d'un graphique : catégories (1re colonne texte ou mois), séries (≤ 3) et couleurs.
 * Plus de 7 catégories en barres : les 6 plus grandes et « Autres ».
 */
export function useChartData(def, data, measure, { others = true } = {}) {
  const { tr } = useI18n();
  const x = categoryColumn(data);
  const series = chartSeries(def, data, { measure });
  const keys = series.map((s) => s.key);
  const base = ((data && data.rows) || []).filter((r) => !r._total);
  const rows = others && x && keys.length && base.length > MAX_CATEGORIES
    ? groupOthers(base, { valueKeys: keys, labelKey: x.key, othersLabel: tr('Autres') })
    : base;
  const colors = seriesColors(keys);
  const label = (r) => (x ? formatCell(x.type, r[x.key], tr) : '');
  const legend = series.map((s) => ({ key: s.key, label: colLabel(s, tr), color: colors[s.key] }));
  return { x, series, rows, colors, label, legend, tr };
}

/** Texte tronqué (axes) avec la valeur complète au survol. */
export const clip = (s, n) => (String(s).length > n ? `${String(s).slice(0, n - 1)}…` : String(s));
