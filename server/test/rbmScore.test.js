const test = require('node:test');
const assert = require('node:assert/strict');
const { scoreSite, monthsSinceVisit } = require('../src/modules/tpm/rbmScore');
const { withFrozenClock } = require('./helpers/frozenClock');

test('site sans problème ni retard ⇒ score faible, priorité basse', () => {
  const r = scoreSite({ lastVisitMonth: '2026-09' }, { targetMonth: '2026-10', mmrInterval: 3 });
  assert.equal(r.finalScore, 0);
  assert.equal(r.finalLabel, 'Faible');
  assert.equal(r.priority, 0);
  assert.equal(r.due, false);           // 1 mois < intervalle 3
});

test('problème urgent (CFM=2) ⇒ score et priorité élevés, drapeau urgent', () => {
  const r = scoreSite({ issuesCFM: 2, lastVisitMonth: '2026-09' }, { targetMonth: '2026-10', mmrInterval: 3 });
  assert.equal(r.urgentFlags, true);
  assert.equal(r.finalScore, 2);
  assert.equal(r.priority, 2);
  assert.equal(r.priorityLabel, 'Haute');
});

test('fraude suspectée ⇒ urgent même sans autre critère', () => {
  const r = scoreSite({ fraud: 1 }, { targetMonth: '2026-10', mmrInterval: 6 });
  assert.equal(r.urgentFlags, true);
  assert.equal(r.finalScore, 2);
});

test('jamais visité ⇒ en retard (due) et priorité au moins moyenne', () => {
  const r = scoreSite({ lastVisitMonth: null }, { targetMonth: '2026-10', mmrInterval: 3 });
  assert.equal(r.neverVisited, true);
  assert.equal(r.overdue, true);
  assert.equal(r.due, true);
  assert.ok(r.priority >= 1);
});

test('retard vs intervalle MMR : due dès que le délai est atteint', () => {
  assert.equal(scoreSite({ lastVisitMonth: '2026-08' }, { targetMonth: '2026-10', mmrInterval: 2 }).due, true);  // 2 ≥ 2
  assert.equal(scoreSite({ lastVisitMonth: '2026-09' }, { targetMonth: '2026-10', mmrInterval: 2 }).due, false); // 1 < 2
});

test('cumul de critères moyens ⇒ score moyen', () => {
  const r = scoreSite({ synergies: 1, beneficiaryOver200: 1 }, { targetMonth: '2026-10', mmrInterval: 3 });
  assert.equal(r.urgentFlags, false);
  assert.equal(r.riskPoints, 2);
  assert.equal(r.finalScore, 1);
});

test('monthsSinceVisit calcule l\'écart en mois', () => {
  assert.equal(monthsSinceVisit('2026-07', '2026-10'), 3);
  assert.equal(monthsSinceVisit('2025-12', '2026-02'), 2);
  assert.equal(monthsSinceVisit(null, '2026-10'), null);
});

test('échelles du classeur RBM : sécurité 3 (stricte) urgente, 99 = zone interdite', () => {
  const strict = scoreSite({ security: 3, lastVisitMonth: '2026-09' }, { targetMonth: '2026-10', mmrInterval: 3 });
  assert.equal(strict.urgentFlags, true); assert.equal(strict.forbidden, false);
  const forbidden = scoreSite({ security: 99 }, { targetMonth: '2026-10', mmrInterval: 3 });
  assert.equal(forbidden.forbidden, true);
  // Ancienne échelle MEMS (2 = élevée) toujours lue comme stricte.
  assert.equal(scoreSite({ security: 2 }, { targetMonth: '2026-10' }).urgentFlags, true);
  assert.equal(scoreSite({ security: 1, lastVisitMonth: '2026-09' }, { targetMonth: '2026-10', mmrInterval: 3 }).urgentFlags, false);
});

test('fraude 2 (partenaire impliqué) pèse plus que 1 ; expérience du partenaire et nombre de bénéficiaires comptent', () => {
  const f1 = scoreSite({ fraud: 1 }, { targetMonth: '2026-10' });
  const f2 = scoreSite({ fraud: 2 }, { targetMonth: '2026-10' });
  assert.ok(f2.riskPoints > f1.riskPoints); assert.equal(f2.urgentFlags, true);
  assert.equal(scoreSite({ experiencedPartner: 2 }, { targetMonth: '2026-10' }).riskPoints, 2);
  assert.equal(scoreSite({ beneficiaryNumber: 450 }, { targetMonth: '2026-10' }).riskPoints, 1);
  assert.equal(scoreSite({ beneficiaryNumber: 150, beneficiaryOver200: 1 }, { targetMonth: '2026-10' }).riskPoints, 0); // le nombre réel prime
});

test('normalisation de la sécurité vers l\'échelle du classeur (0, 1, 3, 99)', () => {
  const { normalizeSecurity } = require('../src/modules/tpm/rbmScore');
  assert.deepEqual([0, 1, 2, 3, 5, 99, 120, null, 'x'].map(normalizeSecurity), [0, 1, 3, 3, 3, 99, 99, 0, 0]);
});

// ---- Retour n° 48 : pourquoi ce drapeau, quelle conséquence, que faire ----------
const OPTS = { targetMonth: '2026-10', mmrInterval: 1 };
const codes = (list) => list.map((x) => x.code);

test('raisons : sécurité stricte (3) = drapeau urgent avec la valeur du site et ses points', () => {
  const r = scoreSite({ security: 3 }, OPTS);
  assert.deepEqual(r.reasons, [{ code: 'security', label: 'Situation sécuritaire', value: 3, valueLabel: 'Restriction stricte', points: 2, urgent: true }]);
  assert.equal(r.consequence.basis, 'urgent');
  assert.equal(r.consequence.finalLabel, 'Élevé');
  assert.equal(r.consequence.priorityLabel, 'Haute');
  assert.equal(r.consequence.priorityBasis, 'urgent');
  assert.equal(r.consequence.frequencyMonths, 1);
  // Jamais visité ⇒ vérifier la sécurité AVANT de planifier, puis planifier ce mois.
  assert.deepEqual(codes(r.actions), ['security', 'planVisit']);
  assert.equal(r.actions[0].label, "Vérifier les conditions de sécurité et l'autorisation d'accès avant de planifier");
  assert.equal(r.actions[1].label, 'Planifier une visite ce mois');
  assert.equal(r.actions[1].month, '2026-10');
  // L'ancienne valeur MEMS 2 se lit comme stricte (3).
  assert.equal(scoreSite({ security: 2 }, OPTS).reasons[0].value, 3);
});

test('raisons : zone interdite (99) ⇒ suivi à distance uniquement, aucune visite proposée', () => {
  const r = scoreSite({ security: 99, issuesCFM: 1 }, OPTS);
  assert.deepEqual(r.reasons[0], { code: 'security', label: 'Situation sécuritaire', value: 99, valueLabel: 'Zone interdite', points: 2, urgent: true });
  assert.deepEqual(codes(r.actions), ['remote', 'issues']);
  assert.equal(r.actions[0].label, 'Zone interdite : suivi à distance uniquement');
  assert.equal(r.actions[1].month, null, 'pas de « prochaine visite » dans une zone interdite');
  assert.ok(!codes(r.actions).includes('planVisit'));
});

test('raisons : problèmes urgents (processus / rapport / CFM) et fraude, urgents d\'abord', () => {
  const r = scoreSite({ synergies: 1, issuesProcess: 2, issuesPartnerReport: 1, issuesCFM: 2, fraud: 1, lastVisitMonth: '2026-09' }, OPTS);
  assert.deepEqual(r.reasons.map((x) => [x.code, x.urgent, x.points]), [
    ['issuesProcess', true, 2], ['issuesCFM', true, 2], ['fraud', true, 2], ['issuesPartnerReport', false, 1], ['synergies', false, 1],
  ]);
  assert.equal(r.reasons[0].label, 'Problème de processus (suivi interne)');
  assert.equal(r.reasons[1].label, 'Problème signalé par le mécanisme de plainte (CFM)');
  assert.equal(r.reasons[2].valueLabel, 'Fraude suspectée');
  assert.equal(r.reasons[3].valueLabel, 'Important');
  assert.deepEqual(codes(r.actions), ['fraud', 'issues', 'planVisit']);
  assert.equal(r.actions[0].label, 'Signaler et planifier une vérification ciblée');
  assert.deepEqual(r.actions[1].refs, ['issuesProcess', 'issuesPartnerReport', 'issuesCFM']);
  assert.equal(r.actions[1].label, 'Vérifier le problème signalé (processus / rapport / CFM) lors de la prochaine visite');
  // Fraude « partenaire impliqué » : 4 points, libellé distinct.
  const f2 = scoreSite({ fraud: 2 }, OPTS).reasons[0];
  assert.deepEqual([f2.value, f2.valueLabel, f2.points, f2.urgent], [2, 'Partenaire impliqué', 4, true]);
});

test('raisons : critères non urgents avec leurs points (barème du score)', () => {
  const r = scoreSite({ security: 1, beneficiaryNumber: 450, newPartner: 1, experiencedPartner: 2, lastVisitMonth: '2026-10' }, { targetMonth: '2026-10', mmrInterval: 2 });
  assert.equal(r.urgentFlags, false);
  assert.deepEqual(r.reasons.map((x) => [x.code, x.value, x.valueLabel, x.points]), [
    ['experiencedPartner', 2, 'Mauvaise expérience', 2],
    ['security', 1, 'Restriction modérée', 1],
    ['caseload', 450, 'Plus de 200 bénéficiaires', 1],
    ['newPartner', 1, 'Nouveau partenaire', 1],
  ]);
  assert.equal(r.consequence.basis, 'points');
  assert.equal(r.consequence.riskPoints, 5);
  assert.equal(r.finalScore, 2);
  assert.equal(r.consequence.priorityBasis, 'high'); // élevé mais visité ce mois ⇒ priorité moyenne
  assert.equal(r.priority, 1);
  // À jour : aucune visite ce mois, prochain suivi dû = dernière visite + fréquence.
  assert.equal(r.due, false);
  assert.equal(r.consequence.nextDueMonth, '2026-12');
  assert.deepEqual(r.actions, [{ code: 'notDue', label: 'Aucune visite requise ce mois — prochain suivi dû', month: '2026-12' }]);
});

test('aucun critère : pas de raison, niveau faible, conséquence et action seules', () => {
  const r = scoreSite({ lastVisitMonth: '2026-09' }, { targetMonth: '2026-10', mmrInterval: 3 });
  assert.deepEqual(r.reasons, []);
  assert.deepEqual([r.consequence.finalLabel, r.consequence.priorityLabel, r.consequence.priorityBasis], ['Faible', 'Basse', 'low']);
  assert.deepEqual(codes(r.actions), ['notDue']);
  assert.equal(r.actions[0].month, '2026-12');
});

test('la somme des points des raisons est exactement riskPoints (grille de critères)', () => {
  for (const security of [0, 1, 3, 99]) for (const issue of [0, 1, 2]) for (const fraud of [0, 1, 2]) for (const ben of [null, 150, 450]) {
    const site = { security, issuesProcess: issue, issuesCFM: 2 - issue, fraud, beneficiaryNumber: ben, synergies: issue % 2, newPartner: fraud % 2, experiencedPartner: issue };
    const r = scoreSite(site, OPTS);
    assert.equal(r.reasons.reduce((a, x) => a + x.points, 0), r.riskPoints, JSON.stringify(site));
    assert.equal(r.reasons.some((x) => x.urgent), r.urgentFlags, `drapeau urgent ⇔ au moins une raison urgente : ${JSON.stringify(site)}`);
    // Urgentes d'abord.
    const firstNonUrgent = r.reasons.findIndex((x) => !x.urgent);
    assert.ok(firstNonUrgent === -1 || r.reasons.slice(firstNonUrgent).every((x) => !x.urgent));
  }
});

test('les explications ne changent pas les valeurs du score (référence = règle d\'origine)', () => {
  // Règle d'origine, recopiée telle quelle : niveau, priorité, points, drapeau, retard.
  const legacy = (s, interval) => {
    const n = (v) => Math.max(0, Number(v) || 0);
    const sec = n(s.security) >= 2 ? 2 : n(s.security);
    const cl = s.beneficiaryNumber != null ? (Number(s.beneficiaryNumber) > 200 ? 1 : 0) : Math.min(1, n(s.beneficiaryOver200));
    const iP = Math.min(2, n(s.issuesProcess)); const fr = Math.min(2, n(s.fraud)); const ex = Math.min(2, n(s.experiencedPartner));
    const urgent = iP === 2 || fr >= 1 || sec === 2;
    const pts = sec + Math.min(1, n(s.synergies)) + cl + Math.min(1, n(s.newPartner)) + ex + iP + 2 * fr;
    const fs = urgent || pts >= 4 ? 2 : pts >= 2 ? 1 : 0;
    const since = s.lastVisitMonth ? (2026 * 12 + 9) - (Number(s.lastVisitMonth.slice(0, 4)) * 12 + Number(s.lastVisitMonth.slice(5)) - 1) : null;
    const overdue = since == null || (interval != null && since >= interval);
    const prio = urgent || (fs === 2 && overdue) ? 2 : (fs === 2 || overdue || fs === 1) ? 1 : 0;
    return { finalScore: fs, priority: prio, riskPoints: pts, urgentFlags: urgent, due: overdue };
  };
  for (const security of [0, 1, 3]) for (const issuesProcess of [0, 1, 2]) for (const fraud of [0, 1]) for (const experiencedPartner of [0, 1, 2])
    for (const lastVisitMonth of [null, '2026-10', '2026-09', '2026-07']) for (const interval of [null, 1, 3]) {
      const site = { security, issuesProcess, fraud, experiencedPartner, synergies: 1, lastVisitMonth };
      const r = scoreSite(site, { targetMonth: '2026-10', mmrInterval: interval });
      const exp = legacy(site, interval);
      assert.deepEqual({ finalScore: r.finalScore, priority: r.priority, riskPoints: r.riskPoints, urgentFlags: r.urgentFlags, due: r.due }, exp, JSON.stringify({ site, interval }));
      assert.equal(r.consequence.priority, r.priority); assert.equal(r.consequence.finalScore, r.finalScore);
    }
});

test('visite déjà prévue ce mois ⇒ « la réaliser », visite prévue passée non réalisée ⇒ à régulariser', () => {
  const planned = scoreSite({ nextPlannedMonth: '2026-10' }, OPTS);
  assert.equal(planned.due, true, 'une visite prévue ne rend pas le site à jour');
  assert.deepEqual(codes(planned.actions), ['doPlannedVisit']);
  assert.equal(planned.actions[0].month, '2026-10');
  assert.equal(planned.consequence.nextPlannedMonth, '2026-10');
  const late = scoreSite({ lastVisitMonth: '2026-06', latePlannedMonth: '2026-08' }, OPTS);
  assert.deepEqual(codes(late.actions), ['latePlanned', 'planVisit']);
  assert.equal(late.actions[0].month, '2026-08');
  // Visite prévue plus tard : le site reste à suivre ce mois, la prochaine visite prévue est rendue.
  const later = scoreSite({ lastVisitMonth: '2026-08', nextPlannedMonth: '2026-12' }, OPTS);
  assert.deepEqual(codes(later.actions), ['planVisit']);
  assert.equal(later.consequence.nextPlannedMonth, '2026-12');
});

test('conséquence : retard, mois depuis la dernière visite, échéance et fréquence inconnue', () => {
  const r = scoreSite({ lastVisitMonth: '2026-07' }, OPTS);
  assert.deepEqual([r.consequence.monthsSinceVisit, r.consequence.overdue, r.consequence.nextDueMonth, r.consequence.priorityBasis], [3, true, '2026-08', 'overdue']);
  const never = scoreSite({}, { targetMonth: '2026-10' });
  assert.deepEqual([never.consequence.neverVisited, never.consequence.frequencyMonths, never.consequence.nextDueMonth], [true, null, null]);
  // Problème « urgent » et site élevé en retard : deux justifications distinctes de la priorité haute.
  assert.equal(scoreSite({ issuesProcess: 2 }, OPTS).consequence.priorityBasis, 'urgent');
  assert.equal(scoreSite({ experiencedPartner: 2, synergies: 1, newPartner: 1 }, OPTS).consequence.priorityBasis, 'highOverdue');
  assert.equal(scoreSite({ synergies: 1, newPartner: 1, lastVisitMonth: '2026-10' }, OPTS).consequence.priorityBasis, 'medium');
});

// ---- Relecture du lot 1 (RBM) -------------------------------------------------
test('zone interdite + fraude : vérification À DISTANCE (aucune visite ne sera planifiée)', () => {
  const remote = scoreSite({ security: 99, fraud: 1 }, OPTS);
  assert.deepEqual(codes(remote.actions), ['remote', 'fraud']);
  assert.equal(remote.actions[1].label, 'Signaler et organiser une vérification à distance');
  assert.ok(!remote.actions.some((a) => /planifi/i.test(a.label)), 'aucune action ne propose de planifier une visite');
  // Hors zone interdite : vérification ciblée lors d'une visite planifiée (inchangé).
  assert.equal(scoreSite({ fraud: 1 }, OPTS).actions[0].label, 'Signaler et planifier une vérification ciblée');
  assert.equal(scoreSite({ security: 3, fraud: 2 }, OPTS).actions.find((a) => a.code === 'fraud').label, 'Signaler et planifier une vérification ciblée');
});

test('« visite prévue non réalisée » : seulement si elle est postérieure à la dernière visite réelle', () => {
  // Prévue en juin, mais une visite réelle a eu lieu en août : plus rien à régulariser.
  const visited = scoreSite({ lastVisitMonth: '2026-08', latePlannedMonth: '2026-06' }, OPTS);
  assert.equal(visited.consequence.latePlannedMonth, null);
  assert.ok(!codes(visited.actions).includes('latePlanned'));
  // Même mois que la dernière visite réelle : la visite a eu lieu.
  assert.equal(scoreSite({ lastVisitMonth: '2026-08', latePlannedMonth: '2026-08' }, OPTS).consequence.latePlannedMonth, null);
  // Prévue APRÈS la dernière visite réelle et jamais réalisée : toujours signalée.
  const late = scoreSite({ lastVisitMonth: '2026-06', latePlannedMonth: '2026-08' }, OPTS);
  assert.equal(late.consequence.latePlannedMonth, '2026-08');
  assert.deepEqual(codes(late.actions), ['latePlanned', 'planVisit']);
  // Jamais visité : la visite prévue passée reste à régulariser.
  assert.equal(scoreSite({ latePlannedMonth: '2026-08' }, OPTS).consequence.latePlannedMonth, '2026-08');
});

test('taille (caseload) rendue avec le score : le nombre de bénéficiaires prime sur « > 200 »', () => {
  const T = { targetMonth: '2026-10' };
  assert.equal(scoreSite({ beneficiaryNumber: 150, beneficiaryOver200: 1 }, T).caseload, 0);
  assert.equal(scoreSite({ beneficiaryNumber: 350, beneficiaryOver200: 0 }, T).caseload, 1);
  assert.equal(scoreSite({ beneficiaryNumber: 200 }, T).caseload, 0);
  assert.equal(scoreSite({ beneficiaryNumber: null, beneficiaryOver200: 1 }, T).caseload, 1);
  assert.equal(scoreSite({ beneficiaryNumber: '', beneficiaryOver200: 1 }, T).caseload, 1);
  assert.equal(scoreSite({}, T).caseload, 0);
  // La colonne et la raison « Taille » lisent la même valeur que les points du score.
  const r = scoreSite({ beneficiaryNumber: 350 }, T);
  assert.equal(r.reasons.find((x) => x.code === 'caseload').points, r.caseload);
});

test('zone interdite : aucune action ne parle de visite (problème signalé vérifié à distance)', () => {
  const { scoreSite: score } = require('../src/modules/tpm/rbmScore');
  const r = score({ security: 99, issuesCFM: 2, fraud: 1 }, { targetMonth: '2026-10', mmrInterval: 1 });
  const issues = r.actions.find((a) => a.code === 'issues');
  assert.match(issues.label, /à distance/);
  assert.equal(issues.month, null);
  assert.ok(r.actions.every((a) => !/visite|planifi/i.test(a.label)), JSON.stringify(r.actions.map((a) => a.label)));
});

test('mois courant par défaut : le même (jour local) pour le délai et la conséquence — jamais deux horloges', async () => {
  // 31 octobre 22 h 30 UTC = 1ᵉʳ novembre 1 h 30 à Madagascar.
  await withFrozenClock('2026-10-31T22:30:00Z', () => {
    const r = scoreSite({ lastVisitMonth: '2026-08' }, { mmrInterval: 3 });
    assert.equal(r.consequence.targetMonth, '2026-11');
    assert.equal(r.consequence.nextDueMonth, '2026-11');
    assert.equal(r.consequence.monthsSinceVisit, 3);
    assert.equal(r.consequence.overdue, true);
    assert.equal(r.due, true);
    assert.equal(monthsSinceVisit('2026-08'), 3);
  });
  // Fuseau UTC : encore octobre, partout.
  await withFrozenClock('2026-10-31T22:30:00Z', () => {
    const r = scoreSite({ lastVisitMonth: '2026-08' }, { mmrInterval: 3 });
    assert.deepEqual([r.consequence.targetMonth, r.consequence.monthsSinceVisit, r.consequence.overdue], ['2026-10', 2, false]);
  }, { timeZone: 'UTC' });
});
