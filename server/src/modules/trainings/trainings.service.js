const repo = require('./trainings.repository');
const { summarize, listSummary, participantResult, checkParticipant, sessionDays } = require('./trainingMath');
const { badRequest, conflict, notFound } = require('../../middleware/errors');

/**
 * Formations en sessions (lot 8, retour 28.2) — règles de gestion. Les routes appellent ce
 * service ; le dépôt lit et écrit ; trainingMath décide des chiffres et des contrôles.
 */

const ERROR_TEXT = {
  attendance: 'présence inconnue',
  daysPresent: 'jours de présence au-delà de la durée de la session',
  preScore: 'pré-test hors du barème',
  postScore: 'post-test hors du barème',
  absentWithScore: 'un participant absent n\'a pas de post-test',
};

function checkDates(s) {
  const days = sessionDays(s.startDate, s.endDate);
  if (days == null) throw badRequest('La fin de la formation précède son début.');
  if (days > 366) throw badRequest('Une formation dure au plus un an.');
  return days;
}

async function list(tenantId, filters) {
  const rows = await repo.listSessions(tenantId, filters);
  return rows.map(({ recorded, attended, withPre, sumPre, withPost, sumPost, passed, withSat, sumSat, ...r }) => ({
    ...r, days: sessionDays(r.startDate, r.endDate),
    ...listSummary({ recorded, attended, withPre, sumPre, withPost, sumPost, passed, withSat, sumSat }),
  }));
}

/** Une session avec, pour chaque participant, ses résultats, et le bilan de la formation. */
async function get(tenantId, id) {
  const s = await repo.getSession(tenantId, id);
  if (!s) throw notFound('Formation introuvable');
  return {
    ...s,
    participants: s.participants.map((p) => ({ ...p, ...participantResult(p, s) })),
    summary: summarize(s, s.participants),
  };
}

async function create(tenantId, input, userId) {
  checkDates(input);
  const id = await repo.createSession(tenantId, input, userId);
  return get(tenantId, id);
}

async function update(tenantId, id, patch) {
  const ok = await repo.updateSession(tenantId, id, patch, (current, next, participants) => {
    const days = checkDates(next);
    const tooLong = participants.filter((p) => p.daysPresent != null && Number(p.daysPresent) > days);
    if (tooLong.length) {
      throw badRequest(`Durée trop courte : ${tooLong.length} participant(s) ont plus de jours de présence (${days} jour(s)).`, { code: 'days_present' });
    }
    // Barème abaissé sous une note déjà saisie : refusé ici avec un message clair (la base le refuse aussi).
    const top = Math.max(0, ...participants.flatMap((p) => [p.preScore, p.postScore]).filter((x) => x != null).map(Number));
    if (Number(next.scoreMax) < top) {
      throw badRequest(`Barème trop bas : une note saisie vaut ${top}. Corrigez d'abord les notes.`, { code: 'score_max' });
    }
  });
  if (!ok) throw notFound('Formation introuvable');
  return get(tenantId, id);
}

async function addParticipants(tenantId, id, input) {
  const r = await repo.addParticipants(tenantId, id, input);
  if (!r) throw notFound('Formation introuvable');
  return r;
}

/** Présences, notes et avis : tout est contrôlé avant d'écrire ; une seule ligne fautive refuse tout (400). */
async function updateParticipants(tenantId, id, rows) {
  const r = await repo.updateParticipants(tenantId, id, rows, (session, list) => {
    const errors = [];
    for (const p of list) {
      const e = checkParticipant(p, session);
      if (e.length) errors.push({ agentId: p.agentId, errors: e });
    }
    if (errors.length) {
      const first = errors[0].errors.map((k) => ERROR_TEXT[k]).join(', ');
      throw badRequest(`Saisie refusée : ${first}${errors.length > 1 ? ` (et ${errors.length - 1} autre(s) ligne(s))` : ''}.`, { code: 'participants', errors });
    }
  });
  if (!r) throw notFound('Formation introuvable');
  return r;
}

async function removeParticipant(tenantId, id, agentId) {
  const r = await repo.removeParticipant(tenantId, id, agentId);
  if (r === 'not_found') throw notFound('Participant introuvable');
  if (r === 'has_data') throw conflict('Ce participant a une présence, des notes ou un avis saisis : effacez-les d\'abord.');
}

async function remove(tenantId, id) {
  const r = await repo.deleteSession(tenantId, id);
  if (r.status === 'not_found') throw notFound('Formation introuvable');
  if (r.status === 'linked') {
    throw conflict(r.origin === 'reprise'
      ? 'Formation reprise de l\'historique des agents : elle ne se supprime pas.'
      : `Cette formation porte des présences ou des notes (${r.recorded} participant(s)) : passez-la au statut « annulée » plutôt.`,
    { code: 'training_linked', recorded: r.recorded });
  }
}

/**
 * Formations suivies par les agents d'un prestataire : une entrée par session, ses agents et
 * leurs résultats (mêmes définitions que la fiche d'une session).
 */
async function byProvider(tenantId, providerId) {
  const rows = await repo.providerParticipations(tenantId, providerId);
  const sessions = new Map();
  for (const r of rows) {
    if (!sessions.has(r.sessionId)) {
      sessions.set(r.sessionId, {
        id: r.sessionId, title: r.title, startDate: r.startDate, endDate: r.endDate, status: r.status, place: r.place,
        themes: r.themes, days: sessionDays(r.startDate, r.endDate), agents: [],
      });
    }
    sessions.get(r.sessionId).agents.push({
      agentId: r.agentId, agentName: r.agentName, attendance: r.attendance, satisfaction: r.satisfaction,
      ...participantResult(r, r),
    });
  }
  return [...sessions.values()];
}

module.exports = {
  list, get, create, update, addParticipants, updateParticipants, removeParticipant, remove, byProvider,
  themes: repo.listThemes,
};
