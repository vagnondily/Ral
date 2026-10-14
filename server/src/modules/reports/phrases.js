/**
 * Phrases construites par le SERVEUR pour un rapport (lot 7a), dans la langue de la
 * requête (`?lang=`) : notes des blocs, lignes de source, éléments répétés. Les textes
 * saisis par l'utilisateur ne sont jamais traduits. Parité fr / en testée
 * (test/reportsI18n.test.js).
 */
const PHRASES = {
  fr: {
    notByOffice: 'Non disponible par bureau.',
    notByActivity: 'Non disponible par activité.',
    notByPartner: 'Non disponible par partenaire.',
    notByForm: 'Non disponible par fiche.',
    notByModule: 'Non disponible par domaine.',
    notByUnlinkedOffice: 'Non disponible pour ce bureau (bureau non relié).',
    chooseForm: 'Choisissez une activité (fiche).',
    unknownDataset: 'Jeu de données inconnu.',
    unlinkedOffice: 'Soumissions sans bureau MEMS relié',
    tooLong: 'Calcul trop long : réduisez la période ou ajoutez un filtre.',
    failed: 'Calcul impossible pour ce bloc.',
    source: (label) => `MEMS — ${label}`,
    asOf: (d) => `au ${d}`,
  },
  en: {
    notByOffice: 'Not available by office.',
    notByActivity: 'Not available by activity.',
    notByPartner: 'Not available by partner.',
    notByForm: 'Not available by form.',
    notByModule: 'Not available by domain.',
    notByUnlinkedOffice: 'Not available for this office (office not linked).',
    chooseForm: 'Choose an activity (form).',
    unknownDataset: 'Unknown dataset.',
    unlinkedOffice: 'Submissions without a linked MEMS office',
    tooLong: 'Computation took too long: shorten the period or add a filter.',
    failed: 'This block could not be computed.',
    source: (label) => `MEMS — ${label}`,
    asOf: (d) => `as of ${d}`,
  },
};

/** Phrases d'une langue (français par défaut). */
const phrases = (lang) => PHRASES[lang === 'en' ? 'en' : 'fr'];

module.exports = { PHRASES, phrases };
