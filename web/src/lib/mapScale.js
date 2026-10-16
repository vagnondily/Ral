/**
 * Échelles et couleurs de la carte du suivi (lot 6a) — module PUR, testé par
 * server/test/webMap.test.js. Les rampes ordinales sont celles validées par le
 * validateur dataviz (--ordinal : une teinte, luminosité monotone, pas visibles,
 * extrémité claire lisible sur la surface) en clair (#fff) et en sombre (#1b212c).
 * Les alertes sont une rampe ordinale à 3 pas + icône + libellé (jamais la couleur seule).
 */

export const RAMPS = {
  blue: {
    light: ['#86b6ef', '#5598e7', '#2a78d6', '#1c5cab', '#0d366b'],
    dark: ['#1c5cab', '#2a78d6', '#5598e7', '#86b6ef', '#cde2fb'],
  },
  orange: {
    light: ['#f2a074', '#ec7a45', '#d95926', '#ad3f14', '#7a2a0b'],
    dark: ['#ad3f14', '#d95926', '#ec7a45', '#f2a074', '#f8c9ad'],
  },
  alert: {
    light: ['#f2a074', '#d95926', '#7a2a0b'],
    dark: ['#d95926', '#f2a074', '#f8c9ad'],
  },
};

/** Classes de pourcentage (décision du lot) : 0 · 1–24 · 25–49 · 50–79 · ≥ 80 % (cible 80 %). */
export const PCT_BREAKS = [0, 0.0000001, 0.25, 0.5, 0.8];
export const PCT_TICKS = ['0', '1', '25', '50', '80'];
/** Niveaux d'alerte : à traiter · à surveiller · critique. */
export const ALERT_LEVELS = [
  { label: 'À traiter', icon: '◷' },
  { label: 'À surveiller', icon: '⚠' },
  { label: 'Critique', icon: '✕' },
];

/** Série 1-2-5 (palier « rond » le plus proche). */
export function nice125(v) {
  if (!(v > 1)) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const m = v / p;
  return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p;
}

/**
 * Seuils d'une rampe de comptes : 1 puis les quantiles 20 / 40 / 60 / 80 % arrondis à
 * la série 1-2-5, dédoublonnés (≤ 5 classes). 0 n'a pas de classe (« aucun »).
 */
export function countBreaks(values) {
  const s = (values || []).filter((v) => typeof v === 'number' && v > 0).sort((a, b) => a - b);
  if (!s.length) return [1];
  const q = [0.2, 0.4, 0.6, 0.8].map((p) => nice125(s[Math.min(s.length - 1, Math.floor(p * s.length))]));
  return [1, ...[...new Set(q)].filter((x) => x > 1)].slice(0, 5);
}

/** Classe d'une valeur (indice du dernier seuil atteint), null hors échelle. */
export function classOf(value, breaks) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < breaks[0]) return null;
  let i = 0;
  for (let k = 0; k < breaks.length; k += 1) if (value >= breaks[k]) i = k;
  return i;
}

// --- Contraste (WCAG) : encre des pastilles selon la classe ------------------------
function lum(hex) {
  const h = hex.replace('#', '');
  const c = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
export function contrast(a, b) {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}
export const INK = '#14181f';
/** Texte lisible sur une pastille : blanc ou encre, le plus contrasté. */
export function inkOn(fill) {
  return contrast(fill, '#ffffff') >= contrast(fill, INK) ? '#ffffff' : INK;
}

/**
 * Valeur colorée d'une zone pour un thème : nombre, 'np' (« — aucun plan »), ou null
 * (gris : aucun site actif / aucune donnée). Les taux viennent du serveur.
 */
export function valueOf(theme, zone) {
  if (!zone) return null;
  const c = zone.counts || {};
  const r = zone.rates || {};
  const rate = (k) => {
    const x = r[k];
    if (!x) return null;
    if (x.reason === 'aucun_plan') return 'np';
    return x.value == null ? null : x.value;
  };
  switch (theme) {
    case 'active': return c.active > 0 ? c.active : null;
    case 'realised': return c.active > 0 ? c.realised : null;
    case 'submissions': return c.submissions > 0 ? c.submissions : null;
    case 'coverage': return rate('coverage');
    case 'planning': return rate('planning');
    case 'execution': return rate('execution');
    case 'riskHigh': return rate('riskHigh');
    case 'alerts': return zone.alertLevel == null ? null : zone.alertLevel;
    default: return null;
  }
}

/**
 * Échelle d'un thème sur un ensemble de zones.
 * @param {{id:string, kind:'count'|'pct'|'sev', ramp:'blue'|'orange'|'alert'}} theme
 * @param {object[]} zones
 * @param {{ dark?: boolean }} [opts]
 * @returns {{ kind, breaks:number[], colors:string[], ticks:string[], classOf:(v)=>number|null, fill:(v)=>string|null }}
 */
export function scaleFor(theme, zones, { dark = false } = {}) {
  const mode = dark ? 'dark' : 'light';
  if (theme.kind === 'sev') {
    const colors = RAMPS.alert[mode];
    return { kind: 'sev', breaks: [0, 1, 2], colors, ticks: ALERT_LEVELS.map((a) => a.label),
      classOf: (v) => (typeof v === 'number' ? Math.max(0, Math.min(2, v)) : null), fill: (v) => (typeof v === 'number' ? colors[Math.max(0, Math.min(2, v))] : null) };
  }
  const ramp = RAMPS[theme.ramp || 'blue'][mode];
  if (theme.kind === 'pct') {
    const cls = (v) => classOf(v, PCT_BREAKS);
    return { kind: 'pct', breaks: PCT_BREAKS, colors: ramp, ticks: PCT_TICKS, classOf: cls, fill: (v) => { const i = cls(v); return i == null ? null : ramp[i]; } };
  }
  const values = (zones || []).map((z) => valueOf(theme.id, z)).filter((v) => typeof v === 'number');
  const breaks = countBreaks(values);
  const colors = ramp.slice(ramp.length - breaks.length); // les classes les plus foncées pour peu de seuils
  const cls = (v) => classOf(v, breaks);
  return { kind: 'count', breaks, colors, ticks: breaks.map(String), classOf: cls, fill: (v) => { const i = cls(v); return i == null ? null : colors[i]; } };
}

const NF = new Map();
const nf = (loc, digits) => {
  const k = `${loc}|${digits}`;
  if (!NF.has(k)) NF.set(k, new Intl.NumberFormat(loc, { minimumFractionDigits: digits, maximumFractionDigits: digits }));
  return NF.get(k);
};

/** Taux affiché : 0 → « 0 % », < 10 % → une décimale (« 1,3 % »), sinon entier (« 44 % »). */
/**
 * État de la couverture des sites lue dans une réponse de /api/map/districts (tuile et Bulletin
 * de Couverture & performance) : 'loading' (réponse attendue : undefined), 'error' (échec : null
 * — jamais « aucun site actif »), 'ok' ; rate null seulement si la période n'a vraiment aucun
 * site actif (totals.counts.active === 0).
 */
export function coverageState(mapData) {
  if (mapData === undefined) return { state: 'loading', rate: null };
  if (!mapData || !mapData.totals) return { state: 'error', rate: null };
  const { counts, rates } = mapData.totals;
  return { state: 'ok', rate: rates.coverage.value, realised: counts.realised, active: counts.active, realisedData: counts.realisedData };
}

export function formatRate(v, lang = 'fr') {
  if (v == null || !Number.isFinite(v)) return '—';
  const pct = v * 100;
  const loc = lang === 'en' ? 'en-GB' : 'fr-FR';
  if (pct > 0 && pct < 0.05) { // jamais « 0,0 % » pour un taux non nul
    const tiny = nf(loc, 1).format(0.1);
    return lang === 'en' ? `< ${tiny}%` : `< ${tiny}\u00a0%`;
  }
  // Décimales choisies APRÈS l'arrondi à une décimale : 9,96 % s'écrit « 10 % », jamais « 10,0 % ».
  const digits = pct === 0 || Math.round(pct * 10) / 10 >= 10 ? 0 : 1;
  const n = nf(loc, digits).format(pct);
  return lang === 'en' ? `${n}%` : `${n} %`;
}

/**
 * Libellés des classes d'une échelle (légende) : pourcentages « 0 », « 1–24 »…
 * « ≥ 80 » ; comptes « 1 », « 2–4 »… « ≥ 20 » ; alertes : libellé du niveau
 * (à traduire par l'appelant). `fmt` met en forme un nombre (séparateurs locaux).
 */
export function classLabels(scale, fmt = String) {
  if (scale.kind === 'sev') return ALERT_LEVELS.map((a) => a.label);
  if (scale.kind === 'pct') return ['0', '1–24', '25–49', '50–79', '≥ 80'];
  const b = scale.breaks;
  return b.map((v, i) => {
    if (i === b.length - 1) return b.length === 1 ? `≥ ${fmt(v)}` : `≥ ${fmt(v)}`;
    const hi = b[i + 1] - 1;
    return hi <= v ? fmt(v) : `${fmt(v)}–${fmt(hi)}`;
  });
}
