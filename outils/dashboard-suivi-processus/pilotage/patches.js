'use strict';
// Lot « pilotage » (post) : correctifs sur le texte ASSEMBLÉ. Les ancres restent intactes (insertion avant / après).
module.exports = [
  { label: 'onglet « Pilotage » en tête des onglets (le fichier s’ouvre toujours sur la Vue d’ensemble)',
    find: '  function buildTabs() {',
    replace: "  if (!TABS.some(t => t[0] === 'pilot')) TABS.unshift(['pilot', 'Pilotage']);   // lot pilotage\n  function buildTabs() {" },
  { label: 'render : onglet « Pilotage » (page A4, hors mise en colonnes automatique)',
    find: '    const fn = ({ overview: renderOverview,',
    replace: "    document.body.classList.toggle('is-pilot', TAB === 'pilot');\n    if (TAB === 'pilot') { document.body.classList.remove('is-report'); piRender(main); return; }   // lot pilotage : pas de masonize\n    const fn = ({ overview: renderOverview," }
];
