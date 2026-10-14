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
export default function Figure({ figure, number, title, subtitle, meta, note, children, table }) {
  const { tr } = useI18n();
  const [showData, setShowData] = useState(false);
  const f = figure || {};
  const foot = figureFoot(meta, { showN: f.showN !== false, source: f.source || null });
  const asOf = foot.asOf ? (/^\d{4}-\d{2}$/.test(foot.asOf) ? monthLabel(foot.asOf) : foot.asOf) : null;
  return (
    <figure className="rb-figure">
      {(title || number) && (
        <figcaption className="rb-title">
          {number && <span className="rb-fig-no">{tr(number.kind === 'table' ? 'Tableau {n}' : 'Figure {n}', { n: number.n })}</span>}
          {number && title ? ' · ' : ''}{title}
          {table && (
            <button type="button" className="rb-showdata" onClick={(e) => { e.stopPropagation(); setShowData((x) => !x); }} aria-pressed={showData}>
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
