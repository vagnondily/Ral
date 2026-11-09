'use strict';
// Lot « rapport » (post) : correctifs sur le texte ASSEMBLÉ (lots + modules). Ancres gardées intactes ou remplacées à l'identique.
module.exports = [
  { label: 'render : l’onglet « Rapport » affiche le nouveau rapport (l’ancien reste accessible par le menu « … »)',
    find: 'report: renderReport, method: renderMethod',
    replace: 'report: rpRenderTab, method: renderMethod' },
  { label: 'render : classe d’impression du nouveau rapport (is-rp) ; is-report reste celle de l’ancien',
    find: "    document.body.classList.toggle('is-report', TAB === 'report');",
    replace: "    document.body.classList.toggle('is-report', TAB === 'report' && !rpIsNew());\n    document.body.classList.toggle('is-rp', TAB === 'report' && rpIsNew());\n    rpAfterRender();" }
];
