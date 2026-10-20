const crypto = require('node:crypto');

/**
 * Indisponibilités des TPM (retour 114 : « même avec un contrat, si cette entité n'est pas
 * disponible, on doit le faire ») — règle PURE, sans I/O, testée (test/tpmUnavailability.test.js).
 *
 * Modèle (migration 107, table tpm_unavailability) : UNE ligne par TPM × mois, motif obligatoire
 * (10 à 500 caractères), lot de la décision. Une ligne mensuelle (comme tpm_zone_overrides) : un
 * UNIQUE simple suffit, sans logique de chevauchement de plages ; une « période » à l'écran est une
 * suite de mois consécutifs du même TPM, même lot et même motif (periodsOf).
 *
 * Effet (tpmAttribution.availableDefault / resolveCell, jumelle SQL mems_tpm_cells) : le TPM
 * indisponible est retiré des candidats de ses zones ces mois-là ; s'il n'en reste aucun, la zone est
 * suivie en interne (« indisponible ») ; une modification qui le désignait est suspendue. Y mettre
 * fin rend les visites prévues ré-estampillables à leur TPM. Les visites réalisées, annulées, figées,
 * facturées ou motivées ne changent jamais (filtre AUTO_RESTAMPABLE_SQL de restampVisitsTx).
 *
 * Journal (tpm_attribution_log, inscription seule) : un lot (TPM · période, motif, visites
 * changées) et une ligne par TPM × mois (scope 'tpm') — avant → après (disponible / indisponible et
 * motif), auteur et date.
 */

const MODES = ['poser', 'retirer'];
/** États d'un TPM pour un mois, au journal (old_state / new_state). */
const AVAILABILITY_STATES = ['disponible', 'indisponible'];
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const stampTime = (v) => (v instanceof Date ? v.toISOString() : (v ? String(v) : ''));

/** Mois suivant (« AAAA-MM »). */
function nextMonth(m) {
  let [y, mm] = String(m).slice(0, 7).split('-').map(Number);
  mm += 1; if (mm > 12) { mm = 1; y += 1; }
  return `${y}-${String(mm).padStart(2, '0')}`;
}

/**
 * Périodes d'indisponibilité : mois CONSÉCUTIFS d'un même TPM, même lot et même motif.
 * @param {{ id, providerId, providerName?, month, reason, batchId?, updatedAt?, updatedByName? }[]} rows
 * @returns {{ providerId, providerName, from, to, months, reason, batchId, updatedAt, updatedByName, ids }[]}
 */
function periodsOf(rows) {
  const sorted = [...(rows || [])].sort((a, b) => cmp(String(a.providerName || ''), String(b.providerName || ''))
    || cmp(a.providerId, b.providerId) || cmp(a.month, b.month));
  const out = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && last.providerId === r.providerId && nextMonth(last.to) === r.month
      && (last.batchId || '') === (r.batchId || '') && last.reason === r.reason) {
      last.to = r.month; last.months += 1; last.ids.push(r.id);
      if (stampTime(r.updatedAt) > stampTime(last.updatedAt)) { last.updatedAt = r.updatedAt; last.updatedByName = r.updatedByName || last.updatedByName; }
      continue;
    }
    out.push({ providerId: r.providerId, providerName: r.providerName || null, from: r.month, to: r.month, months: 1, reason: r.reason,
      batchId: r.batchId || null, updatedAt: r.updatedAt || null, updatedByName: r.updatedByName || null, ids: [r.id] });
  }
  return out;
}

/**
 * Empreinte (verrou optimiste) de ce qu'a vu l'aperçu : TPM, mois visés et indisponibilités
 * existantes de ce TPM sur ces mois — indépendante de l'ordre.
 */
function stampOf(providerId, months, existing) {
  const lines = (existing || []).map((r) => [r.id, r.month, r.reason, stampTime(r.updatedAt)].join('|')).sort();
  return crypto.createHash('sha1').update([providerId, [...months].sort().join(','), ...lines].join('\n')).digest('hex');
}

/**
 * Plan d'écriture d'une décision sur un TPM et des mois :
 *  - 'poser'   : le TPM est indisponible ces mois-là avec ce motif — création, ou nouveau motif ;
 *               un mois déjà indisponible avec le MÊME motif ne change pas ;
 *  - 'retirer' : mettre fin à l'indisponibilité de ces mois (les mois disponibles ne changent pas).
 * @param {{ mode: 'poser'|'retirer', months: string[], existing: object[], reason: string|null }} p
 *   existing = lignes du TPM sur ces mois (unavailabilityTx)
 * @returns {{ upserts: string[], deletes: string[], log: object[], counts: object, action: string|null }}
 */
function planUnavailability({ mode, months, existing, reason }) {
  if (!MODES.includes(mode)) throw new Error(`mode inconnu : ${mode}`);
  const byMonth = new Map((existing || []).map((r) => [r.month, r]));
  const upserts = []; const deletes = []; const log = [];
  const counts = { created: 0, updated: 0, unchanged: 0, deleted: 0, nothing: 0 };
  for (const m of [...new Set(months)].sort()) {
    const ex = byMonth.get(m) || null;
    if (mode === 'poser') {
      if (!ex) {
        upserts.push(m); counts.created += 1;
        log.push({ action: 'indispo_poser', month: m, oldState: 'disponible', oldReason: null, newState: 'indisponible', newReason: reason });
      } else if (ex.reason === reason) {
        counts.unchanged += 1;
      } else {
        upserts.push(m); counts.updated += 1;
        log.push({ action: 'indispo_modifier', month: m, oldState: 'indisponible', oldReason: ex.reason, newState: 'indisponible', newReason: reason });
      }
    } else if (ex) {
      deletes.push(ex.id); counts.deleted += 1;
      log.push({ action: 'indispo_retirer', month: m, oldState: 'indisponible', oldReason: ex.reason, newState: 'disponible', newReason: null });
    } else {
      counts.nothing += 1;
    }
  }
  let action = null;
  if (mode === 'retirer') action = deletes.length ? 'indispo_retirer' : null;
  else if (counts.created) action = 'indispo_poser';
  else if (counts.updated) action = 'indispo_modifier';
  return { upserts, deletes, log, counts, action };
}

/**
 * Indisponibilités APRÈS un plan (simulation de l'aperçu, mêmes règles que l'écriture) : celles du
 * compte sur la période, moins les supprimées, plus les posées (nouveau motif compris).
 * @param {object[]} all  indisponibilités du compte sur la période (loadInputsTx)
 */
function simulate(all, plan, { providerId, reason }) {
  const removed = new Set(plan.deletes);
  const replaced = new Set(plan.upserts.map((m) => `${providerId}|${m}`));
  return [
    ...(all || []).filter((u) => !removed.has(u.id) && !replaced.has(`${u.providerId}|${u.month}`)),
    ...plan.upserts.map((m, i) => ({ id: `sim-${i}`, providerId, month: m, reason, batchId: 'sim' })),
  ];
}

/**
 * Zones × mois où le TPM était le TPM retenu et ne l'est plus (ou l'inverse), d'une table de zones
 * à l'autre (tpmAttribution.buildZoneTable) : { toInternal, toOther, back, list } — `list` : jusqu'à
 * 12 zones (nom, mois). Une commune sans ligne propre suit son district (non comptée).
 */
function zoneMoves(before, after, providerId, areasById = new Map()) {
  const out = { toInternal: 0, toOther: 0, back: 0, list: [] };
  for (const [k, b] of before.cells) {
    const a = after.cells.get(k);
    if (!a || !b.own) continue;
    const was = b.providerId === providerId;
    const is = a.providerId === providerId;
    if (was === is) continue;
    if (was) { if (a.providerId) out.toOther += 1; else out.toInternal += 1; } else out.back += 1;
    if (out.list.length < 12) out.list.push({ areaId: b.areaId, name: (areasById.get(b.areaId) || {}).name || null, month: b.month, to: a.providerId ? 'tpm' : 'interne' });
  }
  return out;
}

module.exports = { MODES, AVAILABILITY_STATES, periodsOf, stampOf, planUnavailability, simulate, zoneMoves, nextMonth };
