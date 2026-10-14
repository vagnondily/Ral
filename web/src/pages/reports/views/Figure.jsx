import React, { useState } from 'react';
import { Table2 } from 'lucide-react';
import { useI18n } from '../../../lib/i18n.jsx';
import { formatInt, monthLabel } from '../../../lib/format.js';
import { figureFoot } from '../../../lib/reportViz.js';

/**
 * Figure (guide de visualisation) : numéro (« Figure 2 », « Tableau 1 »), titre, sous-titre,
 * corps, pied « source · n = … · au … », note, et la bascule « Voir les données » (tableau)
 * pour un graphique — jamais imprimée.
 */
export default function Figure({ figure, number, title, subtitle, meta, note, children, table, continued = false, noFoot = false, showData: shown, onToggleData }) {
  const { tr } = useI18n();
  // « Voir les données » : piloté par l'éditeur quand il le fournit (la page et le calque de mesure
  // de la pagination montrent alors la MÊME vue), sinon état local.
  const [local, setLocal] = useState(false);
  const showData = shown != null ? shown : local;
  const toggle = onToggleData || (() => setLocal((x) => !x));
  const f = figure || {};
  const foot = figureFoot(meta, { showN: f.showN !== false, source: f.source || null });
  const asOf = foot.asOf ? (/^\d{4}-\d{2}$/.test(foot.asOf) ? monthLabel(foot.asOf) : foot.asOf) : null;
  // Suite d'un tableau coupé entre deux pages : « Tableau 2 (suite) », sans sous-titre ; le pied
  // (source, n, note) n'est imprimé que sous le dernier morceau.
  if (continued || noFoot) {
    return (
      <figure className="rb-figure">
        {continued
          ? <figcaption className="rb-title">{number ? <span className="rb-fig-no">{tr(number.kind === 'table' ? 'Tableau {n}' : 'Figure {n}', { n: number.n })}</span> : null}{number ? ' · ' : ''}{title} <span className="rb-cont">{tr('(suite)')}</span></figcaption>
          : (title || number) && <figcaption className="rb-title">{number && <span className="rb-fig-no">{tr(number.kind === 'table' ? 'Tableau {n}' : 'Figure {n}', { n: number.n })}</span>}{number && title ? ' · ' : ''}{title}</figcaption>}
        {!continued && subtitle && <p className="rb-subtitle">{subtitle}</p>}
        {children}
        {!noFoot && (foot.source || foot.n != null || asOf) && (
          <p className="rb-source">{[foot.source, foot.n != null ? `n = ${formatInt(foot.n)}${foot.nLabel ? ` ${tr(foot.nLabel)}` : ''}` : null, asOf ? tr('au {d}', { d: asOf }) : null].filter(Boolean).join(' · ')}</p>
        )}
        {!noFoot && note && <p className="rb-fig-note">{note}</p>}
      </figure>
    );
  }
  return (
    <figure className="rb-figure">
      {(title || number) && (
        <figcaption className="rb-title">
          {number && <span className="rb-fig-no">{tr(number.kind === 'table' ? 'Tableau {n}' : 'Figure {n}', { n: number.n })}</span>}
          {number && title ? ' · ' : ''}{title}
          {table && (
            <button type="button" className="rb-showdata" onClick={(e) => { e.stopPropagation(); toggle(); }} aria-pressed={showData}>
              <Table2 size={12} aria-hidden="true" /> {tr(showData ? 'Voir le graphique' : 'Voir les données')}
            </button>
          )}
        </figcaption>
      )}
      {subtitle && <p className="rb-subtitle">{subtitle}</p>}
      {showData && table ? table : children}
      {(foot.source || foot.n != null || asOf) && (
        <p className="rb-source">
          {[foot.source, foot.n != null ? `n = ${formatInt(foot.n)}${foot.nLabel ? ` ${tr(foot.nLabel)}` : ''}` : null, asOf ? tr('au {d}', { d: asOf }) : null].filter(Boolean).join(' · ')}
        </p>
      )}
      {note && <p className="rb-fig-note">{note}</p>}
    </figure>
  );
}
