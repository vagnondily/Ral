/**
 * Période par défaut des écrans d'analyse (Synthèse, Couverture & performance…)
 * — logique PURE, sans I/O, testée (server/test/period.test.js).
 *
 * Règle unique (retour n° 16) : l'écran s'ouvre sur le DERNIER MOIS « SUBSTANTIEL »
 * ayant des données et qui n'est pas dans le futur, et il dit où et pourquoi :
 *   - les mois futurs sont ignorés (date de tablette aberrante, pas des données du jour) ;
 *   - un mois est substantiel quand son volume atteint `minShare` (25 %) de la
 *     médiane des `lookback` (6) mois avec données qui le précèdent — un mois de
 *     queue à 2 formulaires après 73 n'est pas « le dernier mois avec des données » ;
 *   - à défaut, le dernier mois avec des données ; sans aucune donnée, le mois courant.
 * Raisons renvoyées : 'current' (le mois courant convient), 'latest' (dernier
 * mois avec des données, le mois courant étant vide), 'latest_substantial'
 * (le mois courant ou les derniers mois n'ont que quelques données), 'none'.
 */

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Vrai pour un mois « AAAA-MM » valide. */
const isMonth = (m) => typeof m === 'string' && MONTH_RE.test(m);

/** « AAAA-MM » décalé de `delta` mois. */
function addMonths(month, delta) {
  const [y, m] = month.split('-').map(Number);
  const idx = y * 12 + (m - 1) + delta;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`;
}

function median(values) {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * Mois par défaut.
 * @param {{month:string, n:number}[]} monthCounts volume de données par mois (ordre quelconque)
 * @param {string} todayMonth mois courant « AAAA-MM »
 * @param {{minShare?:number, lookback?:number}} [opts]
 * @returns {{ month:string, reason:'current'|'latest'|'latest_substantial'|'none',
 *             today:string, latestMonth:string|null, n:number, todayCount:number }}
 */
function defaultPeriod(monthCounts, todayMonth, { minShare = 0.25, lookback = 6 } = {}) {
  if (!isMonth(todayMonth)) throw new Error(`Mois courant invalide : ${todayMonth}`);
  const byMonth = new Map();
  for (const r of monthCounts || []) {
    const n = Math.max(0, Math.round(Number(r && r.n) || 0));
    if (!r || !isMonth(r.month) || r.month > todayMonth || n === 0) continue; // futurs et vides ignorés
    byMonth.set(r.month, (byMonth.get(r.month) || 0) + n);
  }
  const months = [...byMonth.keys()].sort();
  const todayCount = byMonth.get(todayMonth) || 0;
  const latestMonth = months.length ? months[months.length - 1] : null;
  if (!latestMonth) return { month: todayMonth, reason: 'none', today: todayMonth, latestMonth: null, n: 0, todayCount: 0 };

  // Du plus récent au plus ancien : premier mois dont le volume est substantiel.
  for (let i = months.length - 1; i >= 0; i -= 1) {
    const prev = months.slice(Math.max(0, i - lookback), i).map((m) => byMonth.get(m));
    const n = byMonth.get(months[i]);
    if (!prev.length || n >= minShare * median(prev)) {
      const month = months[i];
      const reason = month === todayMonth ? 'current' : (month === latestMonth && todayCount === 0 ? 'latest' : 'latest_substantial');
      return { month, reason, today: todayMonth, latestMonth, n, todayCount };
    }
  }
  // Inatteignable (le plus ancien mois n'a pas de prédécesseur) — repli sûr.
  return { month: latestMonth, reason: 'latest', today: todayMonth, latestMonth, n: byMonth.get(latestMonth), todayCount };
}

module.exports = { defaultPeriod, isMonth, addMonths, median };
