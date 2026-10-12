/**
 * Échappement HTML partagé — pour tout texte injecté dans une chaîne HTML
 * (popups / infobulles Leaflet, vues d'impression). Les données (noms de sites,
 * communes, libellés importés) ne doivent jamais être interprétées comme du HTML.
 * Testé par server/test/webSafety.test.js.
 */
const ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ENTITIES[c]);
}
