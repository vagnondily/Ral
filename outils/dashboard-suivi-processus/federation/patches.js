'use strict';
// Lot « federation » (post) : correctifs sur le texte ASSEMBLÉ. Les ancres restent intactes (insertion après).
module.exports = [
  { label: 'onglet Données : cartes de fédération (identité, export de bureau, consolidation) après l’import',
    find: '    plImportCard(main);\n',
    replace: '    plImportCard(main);\n    if (typeof fedCards === \'function\') fedCards(main);   // lot federation\n' },
  { label: 'en-tête : badge discret de l’identité du fichier (bureau / national)',
    find: '  buildTabs(); buildFilters(); render();',
    replace: '  buildTabs(); buildFilters(); render(); if (typeof fedHeaderBadge === \'function\') fedHeaderBadge();   /* lot federation */' },
];
