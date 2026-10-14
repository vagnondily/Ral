/**
 * Position GPS d'une soumission (lot 6a) — règle PURE, jumelle de la fonction SQL
 * mems_submission_gps (migration 061), qui remplit gps_lat / gps_lng / gps_accuracy_m
 * à l'écriture. Mêmes motifs (test mapMigration061 : constantes identiques), même
 * ordre de choix : source (paire Kobo, chaîne geopoint, _geolocation), puis longueur
 * de clé, puis clé (la clé sans suffixe « _ca6b » passe avant sa variante).
 * Sert aussi à masquer les coordonnées des ménages pour les lecteurs (stripGps).
 */

/** Clé de latitude d'une paire Kobo : « …_latitude » ou « …_latitude_ca6b ». */
const LAT_KEY_RE = /_latitude(_[0-9a-f]{4})?$/i;
/** Chaîne geopoint « lat lng [altitude [précision]] », au moins 3 décimales en lat ET lng. */
const GEOPOINT_RE = /^(-?\d{1,2}\.\d{3,})\s+(-?\d{1,3}\.\d{3,})(?:\s+(-?\d+(?:\.\d+)?))?(?:\s+(\d+(?:\.\d+)?))?$/;
const NUM_RE = /^\s*-?\d+(\.\d+)?\s*$/;
const ACC_RE = /^\s*\d+(\.\d+)?\s*$/;
/** Clés GPS d'une paire Kobo (latitude, longitude, précision, altitude), suffixe compris. */
const GPS_KEY_RE = /_(latitude|longitude|precision|altitude)(_[0-9a-f]{4})?$/i;
/** Précision maximale d'un point exploitable (mètres). */
const MAX_ACCURACY_M = 100;

/** Texte d'une valeur JSON comme `#>> '{}'` en SQL (null pour null/absent). */
function asText(v) {
  if (v === undefined || v === null) return null;
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}
const num = (s, re = NUM_RE) => (s != null && re.test(s) ? Number(s) : null);
const inRange = (c) => c.lat != null && c.lng != null && c.lat >= -90 && c.lat <= 90 && c.lng >= -180 && c.lng <= 180 && !(c.lat === 0 && c.lng === 0);
const byOrder = (a, b) => a.src - b.src || a.key.length - b.key.length || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
const SOURCE = { 1: 'paire', 2: 'geopoint', 3: 'geolocation' };

/**
 * Position GPS lue dans les réponses brutes.
 * @param {object} data réponses (clé → valeur)
 * @returns {{ lat:number, lng:number, accuracyM:number|null, key:string, source:'paire'|'geopoint'|'geolocation' }|null}
 */
function extractGps(data) {
  if (!data || typeof data !== 'object') return null;
  const cands = [];
  for (const [key, value] of Object.entries(data)) {
    if (/atitude/i.test(key) && LAT_KEY_RE.test(key)) {
      cands.push({
        src: 1, key,
        lat: num(asText(value)),
        lng: num(asText(data[key.replace(/_latitude((_[0-9a-f]{4})?)$/i, '_longitude$1')])),
        acc: num(asText(data[key.replace(/_latitude((_[0-9a-f]{4})?)$/i, '_precision$1')]), ACC_RE),
      });
    }
    if (typeof value === 'string' && value.includes(' ') && value.includes('.')) {
      const m = value.replace(/^ +| +$/g, '').match(GEOPOINT_RE); // btrim SQL : espaces seulement
      if (m) cands.push({ src: 2, key, lat: Number(m[1]), lng: Number(m[2]), acc: m[4] != null ? Number(m[4]) : null });
    }
  }
  const g = data._geolocation;
  if (Array.isArray(g)) cands.push({ src: 3, key: '_geolocation', lat: num(asText(g[0])), lng: num(asText(g[1])), acc: null });
  const best = cands.filter(inRange).sort(byOrder)[0];
  return best ? { lat: best.lat, lng: best.lng, accuracyM: best.acc, key: best.key, source: SOURCE[best.src] } : null;
}

/** Point exploitable : précision connue ≤ maxAccuracyM (précision inconnue acceptée). */
function usable(gps, { maxAccuracyM = MAX_ACCURACY_M } = {}) {
  return !!gps && (gps.accuracyM == null || gps.accuracyM <= maxAccuracyM);
}

/**
 * Réponses sans coordonnées (vie privée : la position d'un ménage enquêté) :
 * retire les clés de paire GPS (latitude / longitude / précision / altitude, suffixes
 * compris), les chaînes geopoint et _geolocation. Rend une copie ; l'entrée est intacte.
 */
function stripGps(data) {
  if (!data || typeof data !== 'object') return data;
  const out = {};
  for (const [k, v] of Object.entries(data)) {
    if (k === '_geolocation' || GPS_KEY_RE.test(k)) continue;
    if (typeof v === 'string' && GEOPOINT_RE.test(v.trim())) continue;
    out[k] = v;
  }
  return out;
}

module.exports = { LAT_KEY_RE, GEOPOINT_RE, GPS_KEY_RE, MAX_ACCURACY_M, extractGps, usable, stripGps };
