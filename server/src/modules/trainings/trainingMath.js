/**
 * Formations en sessions (lot 8, retour 28.2) — calculs PURS (sans I/O), testés
 * (test/trainingMath.test.js). Une seule définition de chaque chiffre, reprise par la liste,
 * la fiche d'une session et l'onglet Formations d'un prestataire.
 *
 *  - Durée = jours calendaires de la session, début et fin compris.
 *  - Présence d'un participant : présent / partiel / absent (ou non renseignée).
 *    Taux de présence = (présents + partiels) ÷ participants dont la présence est renseignée ;
 *    « — » si aucune n'est renseignée (jamais 0 %).
 *  - Notes : pré-test et post-test sur le barème de la session ; en % = note ÷ barème × 100.
 *    Progression d'un participant = post % − pré % (points), quand les deux existent.
 *    Gain normalisé = (post % − pré %) ÷ (100 − pré %), indéfini si le pré-test vaut 100 %.
 *  - Réussite = post % ≥ seuil de la session (70 % par défaut), parmi les participants qui ont
 *    un post-test.
 *  - Satisfaction : moyenne des avis de 1 à 5 et répartition.
 * Arithmétique entière (centièmes, dixièmes) ; arrondi au dixième demi vers le haut, à la fin.
 */

const ATTENDANCE = ['present', 'partiel', 'absent'];
const roundDiv = (n, d) => Math.floor((2 * n + d) / (2 * d));
const hundredths = (x) => (x == null || x === '' || !Number.isFinite(Number(x)) ? null : Math.round(Number(x) * 100));
const tenthsToNum = (t) => (t == null ? null : t / 10);
const ratioTenths = (n, d) => (d ? roundDiv(n * 1000, d) : null); // n / d en %, au dixième (dixièmes entiers)
const signedRoundDiv = (n, d) => (n < 0 ? -roundDiv(-n, d) : roundDiv(n, d));

/** Jours calendaires d'une session (début et fin compris). */
function sessionDays(start, end) {
  const [y1, m1, d1] = String(start).split('-').map(Number);
  const [y2, m2, d2] = String(end).split('-').map(Number);
  const n = Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000) + 1;
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Note en % du barème (dixièmes entiers) ; null sans note. */
function pctTenths(score, scoreMax) {
  const s = hundredths(score); const m = hundredths(scoreMax);
  if (s == null || !m) return null;
  return roundDiv(s * 1000, m);
}

/**
 * Résultat d'un participant : pré %, post %, progression (points), gain normalisé, réussite.
 * @param {{ preScore, postScore }} p
 * @param {{ scoreMax: number, passMark: number }} session
 */
function participantResult(p, session) {
  const pre = pctTenths(p.preScore, session.scoreMax);
  const post = pctTenths(p.postScore, session.scoreMax);
  const progress = pre != null && post != null ? post - pre : null;
  const gain = pre != null && post != null && pre < 1000 ? signedRoundDiv((post - pre) * 1000, 1000 - pre) : null;
  // Réussite comparée SANS arrondi (13,99 / 20 = 69,95 % n'atteint pas 70 %) : 10 000 × note ≥ seuil × barème.
  const s = hundredths(p.postScore); const m = hundredths(session.scoreMax); const pm = hundredths(session.passMark);
  const pass = post == null ? null : 10000 * s >= pm * m;
  return { prePct: tenthsToNum(pre), postPct: tenthsToNum(post), progress: tenthsToNum(progress), gain: tenthsToNum(gain), pass };
}

/** Moyenne de dixièmes entiers → dixième (demi vers le haut, en valeur absolue). */
function meanTenths(list) {
  const v = list.filter((x) => x != null);
  if (!v.length) return null;
  return tenthsToNum(signedRoundDiv(v.reduce((s, x) => s + x, 0), v.length));
}

/**
 * Bilan d'une session : participants, prestataires, présence, moyennes des tests, progression,
 * réussite, satisfaction, et les participants à revoir (post-test sous le seuil).
 * @param {{ scoreMax, passMark, startDate, endDate }} session
 * @param {Array<{ agentId, agentName?, providerId?, attendance, preScore, postScore, satisfaction, feedback? }>} participants
 */
function summarize(session, participants) {
  const list = participants || [];
  const res = list.map((p) => ({ p, r: participantResult(p, session) }));
  const recorded = list.filter((p) => ATTENDANCE.includes(p.attendance));
  const attended = recorded.filter((p) => p.attendance !== 'absent').length;
  const pre = res.map(({ r }) => (r.prePct == null ? null : Math.round(r.prePct * 10)));
  const post = res.map(({ r }) => (r.postPct == null ? null : Math.round(r.postPct * 10)));
  const prog = res.map(({ r }) => (r.progress == null ? null : Math.round(r.progress * 10)));
  const withPost = res.filter(({ r }) => r.pass != null);
  const sat = list.map((p) => Number(p.satisfaction)).filter((x) => Number.isInteger(x) && x >= 1 && x <= 5);
  const distribution = [1, 2, 3, 4, 5].map((v) => ({ value: v, n: sat.filter((x) => x === v).length }));
  return {
    days: sessionDays(session.startDate, session.endDate),
    participants: list.length,
    providers: new Set(list.map((p) => p.providerId).filter(Boolean)).size,
    attendance: {
      present: list.filter((p) => p.attendance === 'present').length,
      partial: list.filter((p) => p.attendance === 'partiel').length,
      absent: list.filter((p) => p.attendance === 'absent').length,
      notRecorded: list.length - recorded.length,
      rate: tenthsToNum(ratioTenths(attended, recorded.length)),
    },
    tests: {
      withPre: pre.filter((x) => x != null).length, withPost: post.filter((x) => x != null).length,
      avgPre: meanTenths(pre), avgPost: meanTenths(post), avgProgress: meanTenths(prog),
      passRate: tenthsToNum(ratioTenths(withPost.filter(({ r }) => r.pass).length, withPost.length)),
      passMark: Number(session.passMark),
    },
    satisfaction: {
      n: sat.length,
      avg: sat.length ? tenthsToNum(roundDiv(sat.reduce((s, x) => s + x, 0) * 10, sat.length)) : null,
      distribution,
    },
    toReview: res.filter(({ r }) => r.pass === false).map(({ p, r }) => ({ agentId: p.agentId, agentName: p.agentName || null, postPct: r.postPct })),
  };
}

/**
 * Chiffres d'une ligne de la LISTE des sessions, à partir des agrégats SQL
 * (trainings.repository.listSessions : notes en dixièmes de % arrondies par participant,
 * réussites comparées exactement) — mêmes définitions que summarize (parité testée).
 * @param {{ recorded, attended, withPre, sumPre, withPost, sumPost, passed, withSat, sumSat }} a
 */
function listSummary(a) {
  const mean = (sum, n) => (n ? tenthsToNum(signedRoundDiv(Math.round(Number(sum)), n)) : null);
  return {
    attendanceRate: tenthsToNum(ratioTenths(a.attended, a.recorded)),
    avgPre: mean(a.sumPre, a.withPre),
    avgPost: mean(a.sumPost, a.withPost),
    passRate: tenthsToNum(ratioTenths(a.passed, a.withPost)),
    satisfactionAvg: a.withSat ? tenthsToNum(roundDiv(Number(a.sumSat) * 10, a.withSat)) : null,
  };
}

/** Règles d'une saisie de participant (service + zod) : présence connue, jours ≤ durée, notes ≤ barème. */
function checkParticipant(p, session) {
  const errors = [];
  const days = sessionDays(session.startDate, session.endDate);
  if (p.attendance != null && !ATTENDANCE.includes(p.attendance)) errors.push('attendance');
  if (p.daysPresent != null && (Number(p.daysPresent) < 0 || (days != null && Number(p.daysPresent) > days))) errors.push('daysPresent');
  for (const k of ['preScore', 'postScore']) {
    if (p[k] != null && (Number(p[k]) < 0 || Number(p[k]) > Number(session.scoreMax))) errors.push(k);
  }
  if (p.attendance === 'absent' && p.postScore != null) errors.push('absentWithScore');
  return errors;
}

module.exports = { ATTENDANCE, sessionDays, pctTenths, participantResult, summarize, listSummary, checkParticipant };
