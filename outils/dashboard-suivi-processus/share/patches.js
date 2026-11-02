'use strict';
// Lot share (« Version à partager ») — correctifs sur le texte ASSEMBLÉ.
// Un seul : la mise en forme du fichier HTML exporté (échappement JSON + coquille SHELL) est sortie de exportHtml
// dans serializeHtml(P), pour que l'export complet et la version à partager utilisent exactement le même code.
module.exports = [
  { label: 'export : sérialisation commune serializeHtml(P) (même échappement, même coquille)',
    start: String.raw`    const json = JSON.stringify(CUR).replace(`,
    end: String.raw`'\n</body>\n</html>\n';`,
    replace: String.raw`    const html = serializeHtml(CUR);` },
  { label: 'export : définition de serializeHtml avant exportHtml',
    find: '  function exportHtml() {\n    let applied = false;',
    replace: String.raw`  // Fichier HTML autonome d'un jeu de données P : même échappement et même coquille pour tous les exports
  function serializeHtml(P) {
    const json = JSON.stringify(P).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
    const S = '<' + '/script>';
    return '<!DOCTYPE html>\n<html lang="fr">\n' + SHELL.head + '\n<body>\n' + SHELL.body + '\n<script type="application/json" id="data">' + json + S + '\n<script id="app-js">' + SHELL.js + S + '\n</body>\n</html>\n';
  }
` + '  function exportHtml() {\n    let applied = false;' },
];
