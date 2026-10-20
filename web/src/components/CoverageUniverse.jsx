import React from 'react';
import { Info } from 'lucide-react';
import { useI18n } from '../lib/i18n.jsx';
import { formatInt } from '../lib/format.js';
import { periodLabel } from '../lib/period.js';
import { universeOf } from '../lib/coverageDefs.js';

/**
 * Univers des mesures de couverture, énoncé UNE fois par page (retour 110) : les sites actifs de la
 * période (règle unique : grille des sites actifs, zones interdites exclues), ce qui n'est pas
 * compté, et le lien pour renseigner la grille (RBM › Sites actifs / inactifs) ; dessous, ce qui
 * n'est jamais compté : visites ou données pendant un mois sans « Oui » de la grille, ou sur un site en
 * zone interdite (dits séparément : sans grille, aucun mois n'est « sans Oui »), visites annulées.
 * `cov` = réponse de GET /api/dashboards/coverage.
 */
export default function CoverageUniverse({ cov, period, onNavigate }) {
  const { tr, lang } = useI18n();
  const u = universeOf(cov);
  if (!u) return null;
  const vars = { n: formatInt(u.sites), p: period ? periodLabel(period, lang) : '', k: formatInt(u.inactive) };
  let text;
  if (u.kind === 'grid') {
    text = u.inactive > 0
      ? tr('Univers : {n} sites actifs sur {p} (grille des sites actifs) ; {k} sites du registre sans « Oui » ne sont pas comptés', vars)
      : tr('Univers : {n} sites actifs sur {p} (grille des sites actifs)', vars);
  } else if (u.kind === 'partial') {
    text = tr('Univers : {n} sites actifs sur {p} — tout le registre : une année de la période n\'a pas de grille des sites actifs', vars);
  } else {
    text = tr('Univers : {n} sites actifs sur {p} — tout le registre (aucune grille des sites actifs)', vars);
  }
  return (
    <p className="period-session-note coverage-universe" role="note">
      <Info size={14} aria-hidden="true" />
      <span>
        {text}
        {u.forbidden > 0 && <>{' ; '}{tr('{f} en zone interdite', { f: formatInt(u.forbidden) })}</>}
        {onNavigate && (u.kind !== 'grid' || u.inactive > 0) && (
          <>{' — '}<button type="button" className="inline-link" onClick={() => onNavigate('processus', 'rbm', 'sites')}>
            {u.kind === 'grid' ? tr('Renseigner') : tr('Renseigner la grille')}
          </button></>
        )}
        {(u.outside > 0 || u.cancelled > 0) && (
          <span className="coverage-universe-more">
            {[
              u.outsideGrid > 0 && tr('{n} site(s) ont une visite déclarée ou des données pendant un mois sans « Oui » : non comptées.', { n: formatInt(u.outsideGrid) }),
              u.outsideForbidden > 0 && tr('{n} site(s) en zone interdite ont une visite déclarée ou des données : non comptées.', { n: formatInt(u.outsideForbidden) }),
              // Unité des visites des tableaux de bord : un site × un mois (toutes ses visites annulées).
              u.cancelled > 0 && tr('{n} visite(s) annulée(s) (site × mois) : hors de l\'exécution du plan.', { n: formatInt(u.cancelled) }),
            ].filter(Boolean).join(' ')}
          </span>
        )}
      </span>
    </p>
  );
}
