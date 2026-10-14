import React from 'react';
import { useI18n } from '../../../lib/i18n.jsx';
import { Cell, Empty, STATUS, TONE_ICON, colLabel, formatCell, isNumeric } from './common.jsx';

/**
 * Liste (signaux, points forts / faibles, alertes, parcours) : le 1er texte ou message de la
 * ligne en titre, les autres colonnes en détail ; le ton de la ligne (`tone`, statut ou classe)
 * donne l'icône et la couleur, toujours avec un libellé.
 */
export default function ListView({ data, columns: pick }) {
  const { tr } = useI18n();
  if (!data || !data.rows.length) return <Empty note={data && data.meta && data.meta.note} />;
  const cols = pick && pick.length ? data.columns.filter((c) => pick.includes(c.key)) : data.columns;
  const main = cols.find((c) => c.type === 'message') || cols.find((c) => c.type === 'text') || cols[0];
  const status = cols.find((c) => c.type === 'status' || c.type === 'band');
  const rest = cols.filter((c) => c !== main && c !== status);
  return (
    <ul className="rb-list">
      {data.rows.map((r, i) => {
        const tone = r.tone || (status ? (status.type === 'band' ? r[status.key] : (STATUS[r[status.key]] || [])[1]) : null) || 'na';
        const Icon = TONE_ICON[tone] || TONE_ICON.na;
        return (
          <li key={r._key || i} className={`rb-list-item rb-tone-${tone}`}>
            <Icon size={15} aria-hidden="true" className="rb-list-ico" />
            <div className="rb-list-body">
              <span className="rb-list-main">{formatCell(main.type, r[main.key], tr)}</span>
              <span className="rb-list-detail">
                {status && <Cell col={status} value={r[status.key]} tr={tr} />}
                {rest.filter((c) => r[c.key] != null && r[c.key] !== '').map((c) => (
                  <span key={c.key}><em>{colLabel(c, tr)}</em> {isNumeric(c) ? formatCell(c.type, r[c.key], tr) : formatCell(c.type, r[c.key], tr)}</span>
                ))}
              </span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
