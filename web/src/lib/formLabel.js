// Libellé court d'une fiche de suivi, pour les onglets et les mentions en ligne :
// « Suivi de processus — Résilience SAMS (données réelles) » → « Résilience SAMS ».
export function shortFormLabel(s) {
  if (!s) return '';
  let t = String(s).replace(/^Suivi de processus\s*[—-]\s*/i, '');
  t = t.replace(/\s*\((données réelles|démo|demo)\)\s*$/i, '');
  return t.trim() || String(s);
}
