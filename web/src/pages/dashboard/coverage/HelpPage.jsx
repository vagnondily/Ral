import React from 'react';
import { BAND_RULES, VERDICTS, VERDICT_THRESHOLDS } from '../../../lib/coverageView.js';
import { useI18n } from '../../../lib/i18n.jsx';
import { ClassBadge, Section } from './parts.jsx';
import { PAGES } from './activityMeta.js';

/**
 * Page « Aide » (maquette « Tous ») : seuils des classes et décision attendue, pages et publics,
 * et les définitions de MEMS derrière chaque chiffre — les mêmes que « Comment les calculs sont
 * faits » (Suivi de processus).
 */
export default function HelpPage({ onNavigate }) {
  const { tr } = useI18n();
  const T = VERDICT_THRESHOLDS;
  const defs = [
    [tr('Couverture'), tr('Sites actifs suivis ÷ sites actifs, chaque site compté une fois sur la période (suivi = visite déclarée réalisée ou données rattachées au site, pendant un de ses mois actifs) — la même valeur sur la Synthèse, la carte et le rapport de synthèse.')],
    [tr('Visites'), tr('Formulaires de suivi reçus sur la période (soumissions non écartées au nettoyage).')],
    [tr('Score d\'une visite'), tr('Moyenne des scores orientés des indicateurs en % notés auxquels la visite a répondu ; classe : bandes 80 / 65 / 50 (même règle que les indicateurs).')],
    [tr('Indice'), tr('Indice de conformité : moyenne des modules à poids égaux, chaque module étant la moyenne des scores orientés de ses indicateurs en % — le même que dans les Résultats d\'une fiche.')],
    [tr('Indice pondéré'), tr('Vue d\'ensemble : moyenne des indices d\'activité pondérée par leurs visites notées.')],
    [tr('Action urgente'), tr('Visites notées dont le score est sous 50, rapportées aux visites notées.')],
    [tr('Taux de remplissage'), tr('Réponses exploitables ÷ réponses attendues aux indicateurs notés (vides et codes « hors base » non comptés).')],
    [tr('Décision'), tr('Critique si couverture < {c1} % ou indice < {i1} ; Vigilance si indice < {i2} ou couverture < {c2} % ; sinon Satisfaisant.', {
      c1: T.critical.coverage * 100, i1: T.critical.index, i2: T.watch.index, c2: T.watch.coverage * 100,
    })],
  ];
  return (
    <>
      <div className="cvt-row cvt-row-2">
        <Section id="cvt-help-bands" title={tr('Seuils et décisions')} sub={tr('Classe d\'un indicateur, d\'un module, d\'une visite ou d\'un indice — une seule règle partout')}>
          <table className="table cvt-table">
            <thead><tr><th>{tr('Classe')}</th><th>{tr('Seuil (sans cible)')}</th><th>{tr('Décision')}</th></tr></thead>
            <tbody>
              {BAND_RULES.map((r) => (
                <tr key={r.k}><td><ClassBadge band={r.k} /></td><td className="tabular">{r.range}</td><td>{tr(r.decision)}</td></tr>
              ))}
              <tr><td><ClassBadge band="na" /></td><td>—</td><td>{tr('Aucune réponse comptée : la raison est dite à côté (variable absente, codes « hors base » seulement…)')}</td></tr>
            </tbody>
          </table>
          <p className="cvt-narr">{tr('Avec une cible, la classe vient de l\'écart à la cible : atteinte → Excellent ; écart ≤ 10 % → Satisfaisant ; ≤ 30 % → À améliorer ; au-delà → Action urgente.')}</p>
        </Section>
        <Section fill id="cvt-help-pages" title={tr('Pages et publics')} sub={tr('Une page par usage, comme la maquette')}>
          <table className="table cvt-table">
            <tbody>
              {PAGES.map((p) => <tr key={p.id}><td><p.icon size={15} aria-hidden="true" className="cvt-help-ic" /> {tr(p.label)}</td><td className="muted">{tr(p.audience)}</td></tr>)}
            </tbody>
          </table>
        </Section>
      </div>
      <Section id="cvt-help-defs" title={tr('Définitions')} sub={tr('Ce que mesure chaque chiffre du tableau de bord')}>
        <dl className="cvt-defs">
          {defs.map(([k, d]) => <React.Fragment key={k}><dt>{k}</dt><dd>{d}</dd></React.Fragment>)}
        </dl>
        <p className="cvt-narr">
          {tr('Verdicts : {list}.', { list: ['critique', 'vigilance', 'satisfaisant'].map((k) => `${tr(VERDICTS[k].label)} (${tr(VERDICTS[k].action)})`).join(' · ') })}{' '}
          {onNavigate && <button type="button" className="inline-link" onClick={() => onNavigate('processus', 'calculs')}>{tr('Comment les calculs sont faits')}</button>}
        </p>
      </Section>
    </>
  );
}
