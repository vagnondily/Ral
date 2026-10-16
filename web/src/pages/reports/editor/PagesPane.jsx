import React from 'react';
import { FileText } from 'lucide-react';
import { useI18n } from '../../../lib/i18n.jsx';

/**
 * Volet « Pages » : une entrée par page de l'aperçu (n°, orientation, premier titre) quand la
 * pagination est connue, sinon une par section ; un clic fait défiler la page ET la sélectionne :
 * le volet droit montre alors la mise en page de CETTE page (orientation, format), retour 88.
 * @param {{ pages?: {n, orientation, size, title}[], sections?: object[] }} props
 */
export default function PagesPane({ pages, sections, selected, onGo }) {
  const { tr } = useI18n();
  const list = pages && pages.length ? pages : (sections || []).map((s, i) => ({ n: i + 1, orientation: s.orientation, size: s.size, title: s.title || null, section: true }));
  if (!list.length) return <p className="hint rd-pane-body">{tr('Aucune page.')}</p>;
  return (
    <div className="rd-pane-body">
      <ol className="rd-pages">
        {list.map((p) => (
          <li key={p.n}>
            <button type="button" className={selected === p.n ? 'is-selected' : ''} aria-current={selected === p.n ? 'page' : undefined} onClick={() => onGo(p)}>
              <span className={`rd-page-thumb ${p.orientation === 'landscape' ? 'is-landscape' : ''}`}><FileText size={12} aria-hidden="true" /></span>
              <span className="rd-pages-l">
                <strong>{p.section ? tr('Section {n}', { n: p.n }) : tr('Page {n}', { n: p.n })}</strong>
                <span>{p.size || 'A4'} · {tr(p.orientation === 'landscape' ? 'paysage' : 'portrait')}{p.title ? ` · ${p.title}` : ''}</span>
              </span>
              {p.annex ? <span className="rd-pages-tag">{tr('Annexe {l}', { l: p.annex })}</span> : p.own ? <span className="rd-pages-tag is-own">{tr('mise en page propre')}</span> : null}
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}
