import React from 'react';
import { useI18n } from '../../../lib/i18n.jsx';
import { categoryColumn, chartSeries, groupOthers, labelWidth, legendNeeded, seriesColors, MAX_CATEGORIES } from '../../../lib/reportViz.js';
import { shortMonthLabel } from '../../../lib/format.js';
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

/** Légende des séries (dès 2), AU-DESSUS du tracé : on sait quelle couleur est quoi avant de lire. */
export function Legend({ items, line = false }) {
  if (!legendNeeded(items.length)) return null;
  return (
    <figcaption className={`rb-legend ${line ? 'is-line' : ''}`}>
      {items.map((it) => <span key={it.key}><i style={{ background: it.color }} aria-hidden="true" />{it.label}</span>)}
    </figcaption>
  );
}

/**
 * Étiquettes de l'axe des catégories placées par reportViz.axisLabelLayout : toutes droites,
 * toutes inclinées (−40°) ou une sur k (ancrées sur la dernière). Le libellé complet reste au survol.
 * @param {{ layout, xs: number[], y: number, labels: string[], full: string[] }} props
 */
export function XLabels({ layout, xs, y, labels, full, width }) {
  const shown = new Set(layout.show);
  // Droites : centrées, sauf près d'un bord où elles s'alignent sur lui (jamais coupées par le cadre).
  const anchor = (i) => {
    if (layout.rotate) return 'end';
    const half = labelWidth(labels[i]) / 2;
    if (xs[i] - half < 0) return 'start';
    if (width && xs[i] + half > width) return 'end';
    return 'middle';
  };
  return labels.map((l, i) => (shown.has(i) ? (
    <text key={i} x={xs[i]} y={y} className="rb-axis" textAnchor={anchor(i)}
      transform={layout.rotate ? `rotate(${layout.rotate} ${xs[i]} ${y - 4})` : undefined}>
      <title>{full[i]}</title>{l}
    </text>
  ) : null));
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
  // Axe : mois abrégés (« oct. 25 ») ; autres catégories coupées à 16 caractères (libellé complet au survol).
  const axisLabel = (r) => (!x ? '' : x.type === 'month' && /^\d{4}-\d{2}$/.test(String(r[x.key])) ? shortMonthLabel(String(r[x.key])) : clip(label(r), 16));
  const legend = series.map((s) => ({ key: s.key, label: colLabel(s, tr), color: colors[s.key] }));
  return { x, series, rows, colors, label, axisLabel, legend, tr, timeSeries: !!x && x.type === 'month' };
}

/** Texte tronqué (axes) avec la valeur complète au survol. */
export const clip = (s, n) => (String(s).length > n ? `${String(s).slice(0, n - 1)}…` : String(s));
