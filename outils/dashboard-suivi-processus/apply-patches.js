'use strict';
// Applique une liste de correctifs à un texte. Échoue bruyamment si une ancre ne correspond pas
// exactement le nombre de fois attendu (jamais de remplacement silencieux ou partiel).
function countOf(s, f) { let n = 0, i = 0; while ((i = s.indexOf(f, i)) >= 0) { n++; i += f.length; } return n; }
function applyPatches(text, patches, tag) {
  const log = [];
  for (const p of patches) {
    if (p.start) {
      const n = countOf(text, p.start);
      if (n !== 1) throw new Error('[' + tag + '] ' + p.label + ' : début trouvé ' + n + ' fois');
      const i = text.indexOf(p.start), j = text.indexOf(p.end, i + p.start.length);
      if (j < 0) throw new Error('[' + tag + '] ' + p.label + ' : fin introuvable');
      text = text.slice(0, i) + p.replace + text.slice(j + p.end.length);
    } else {
      const want = p.count || 1, n = countOf(text, p.find);
      if (n !== want) throw new Error('[' + tag + '] ' + p.label + ' : trouvé ' + n + ' fois (attendu ' + want + ')');
      text = text.split(p.find).join(p.replace);
    }
    log.push(p.label);
  }
  return { text, log };
}
module.exports = { applyPatches, countOf };
