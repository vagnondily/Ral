import React, { useState } from 'react';
import { Table2 } from 'lucide-react';
import { useI18n } from '../../../lib/i18n.jsx';
import { formatInt, monthLabel, shortMonthYear } from '../../../lib/format.js';
import { figureFoot, dataScope } from '../../../lib/reportViz.js';

/**
 * Figure (guide de visualisation) : numéro (« Figure 2 », « Tableau 1 », « Annexe A »), titre,
 * PÉRIODE DES DONNÉES quand elle diffère de celle du rapport (« 12 mois jusqu'à sept. 2026 »,
 * retour 87), sous-titre, corps, pied « source · n = … · au … », note, et la bascule « Voir les
 * données » (tableau) pour un graphique — jamais imprimée.
 * `number` = { kind: 'figure'|'table', n } ou { kind: 'annex', letter } ; `bare` : pas de légende
 * de titre (1er morceau d'une annexe : la page d'annexe porte déjà « Annexe A · titre »).
 */
export default function Figure({ figure, number, title, subtitle, meta, note, children, table, continued = false, noFoot = false, bare = false, showData: shown, onToggleData }) {
  const { tr } = useI18n();
  // « Voir les données » : piloté par l'éditeur quand il le fournit (la page et le calque de mesure
  // de la pagination montrent alors la MÊME vue), sinon état local.
  const [local, setLocal] = useState(false);
  const showData = shown != null ? shown : local;
  const toggle = onToggleData || (() => setLocal((x) => !x));
  const f = figure || {};
  const foot = figureFoot(meta, { showN: f.showN !== false, source: f.source || null });
  // Une année seule (« 2026 ») est dite par la période des données (« Année 2026 »), pas par « au 2026 ».
  const asOf = foot.asOf && !/^\d{4}$/.test(foot.asOf) ? (/^\d{4}-\d{2}$/.test(foot.asOf) ? monthLabel(foot.asOf) : foot.asOf) : null;
  const scope = dataScope(meta);
  const scopeText = !scope ? null
    : scope.kind === 'months' ? tr('{n} mois jusqu\'à {m}', { n: scope.n, m: shortMonthYear(scope.to) })
      : scope.kind === 'year' ? tr('Année {y}', { y: scope.year })
        : `${shortMonthYear(scope.from)} – ${shortMonthYear(scope.to)}`;
  const label = !number ? null
    : number.kind === 'annex' ? tr('Annexe {l}', { l: number.letter })
      : tr(number.kind === 'table' ? 'Tableau {n}' : 'Figure {n}', { n: number.n });
  const sourceLine = (foot.source || foot.n != null || asOf) && (
    <p className="rb-source">
      {[foot.source, foot.n != null ? `n = ${formatInt(foot.n)}${foot.nLabel ? ` ${tr(foot.nLabel)}` : ''}` : null, asOf ? tr('au {d}', { d: asOf }) : null].filter(Boolean).join(' · ')}
    </p>
  );
  const scopeEl = scopeText ? <span className="rb-fig-scope"> — {scopeText}</span> : null;
  const toggleBtn = table && !continued ? (
    <button type="button" className="rb-showdata" onClick={(e) => { e.stopPropagation(); toggle(); }} aria-pressed={showData}>
      <Table2 size={12} aria-hidden="true" /> {tr(showData ? 'Voir le graphique' : 'Voir les données')}
    </button>
  ) : null;
  // Suite d'un tableau coupé entre deux pages : « Tableau 2 (suite) », sans sous-titre ; le pied
  // (source, n, note) n'est imprimé que sous le dernier morceau.
  const caption = continued
    ? <figcaption className="rb-title">{label ? <span className="rb-fig-no">{label}</span> : null}{label ? ' · ' : ''}{title} <span className="rb-cont">{tr('(suite)')}</span></figcaption>
    : bare
      ? (toggleBtn || scopeText ? <figcaption className="rb-title rb-title-bare">{scopeText ? <span className="rb-fig-scope">{scopeText}</span> : null}{toggleBtn}</figcaption> : null)
      : (title || label) && (
        <figcaption className="rb-title">
          {toggleBtn}
          {label && <span className="rb-fig-no">{label}</span>}
          {label && title ? ' · ' : ''}{title}{scopeEl}
        </figcaption>
      );
  return (
    <figure className="rb-figure">
      {caption}
      {!continued && subtitle && <p className="rb-subtitle">{subtitle}</p>}
      {showData && table ? table : children}
      {!noFoot && sourceLine}
      {!noFoot && note && <p className="rb-fig-note">{note}</p>}
    </figure>
  );
}
