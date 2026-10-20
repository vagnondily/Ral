// Contrôle d'écrans du lot 8 (revue du 20/10) — scénarios réels dans le navigateur, sur une base de
// TEST (il écrit : une évaluation de TPM validée, une formation annulée en fin de parcours).
//   C5  valider l'évaluation d'un TPM recharge le panneau (plus de « Valider » qui tourne) ; une
//       version périmée (409) recharge la grille, puis la validation passe ;
//   C9  « Créer la formation » ouvre la fiche en LECTURE (bouton « Modifier »), pas en modification ;
//   C6  une saisie de notes en cours survit à un rechargement (enregistrement de la synthèse) ;
//   C7  une note illisible (« abc ») est refusée, la valeur en base n'est pas effacée ;
//   C8  seuls les champs modifiés partent (les autres participants et champs restent intacts).
// Usage : WEB_URL=http://localhost:5881 API_PORT=9881 node web/scripts/check-lot8-ui.cjs
// Variables : PLAYWRIGHT (module), CHROMIUM (exécutable). Deux connexions (administrateur, valideur).
const { chromium } = require(process.env.PLAYWRIGHT || '/opt/node-tools/node_modules/playwright');
const WEB = process.env.WEB_URL || 'http://localhost:5173';
const API = `http://localhost:${process.env.API_PORT || 9000}`;
const failures = [];
const check = (ok, label) => { console.log(`${ok ? 'OK ' : 'ÉCHEC'} ${label}`); if (!ok) failures.push(label); };

async function login(browser, email) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.goto(`${WEB}/`);
  await page.fill('input[type=email]', email); await page.fill('input[type=password]', process.env.SWEEP_PASSWORD || 'changeme123');
  await page.click('button[type=submit]'); await page.waitForSelector('.page-title', { timeout: 20000 });
  const call = (method, path, body) => page.evaluate(async ([base, m, p, b]) => {
    const r = await fetch(base + p, { method: m, headers: { 'content-type': 'application/json', Authorization: `Bearer ${localStorage.getItem('mems2_tpm_token')}` }, body: b ? JSON.stringify(b) : undefined });
    return { status: r.status, body: await r.json().catch(() => null) };
  }, [API, method, path, body]);
  const go = async (hash) => { await page.evaluate((h) => { window.location.hash = h; }, hash); await page.waitForTimeout(400); try { await page.waitForLoadState('networkidle', { timeout: 10000 }); } catch { /* */ } };
  return { page, call, go };
}

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium' });
  const admin = await login(browser, 'admin@mems.mg');
  const validator = await login(browser, 'validateur@mems.mg');
  const ypa = (await admin.call('GET', '/api/partners/providers')).body.find((p) => p.name === 'YPA');

  // ---- C5 : validation d'une évaluation de TPM -----------------------------------------
  const criteria = (await admin.call('GET', '/api/evaluation/criteria?scope=prestataire')).body.filter((c) => c.active);
  const draft = await admin.call('POST', `/api/evaluation/providers/${ypa.id}`, { periodFrom: '2019-01', periodTo: '2019-03', evaluatedOn: '2019-04-01',
    comment: 'Contrôle C5', ratings: criteria.map((c) => ({ code: c.code, rating: 3 })) });
  check(draft.status === 201, 'C5 brouillon créé par l\'administrateur');
  await validator.go(`#/tpm/prestataires/${ypa.id}/evaluation`);
  await validator.page.locator('tr', { hasText: 'Contrôle C5' }).or(validator.page.locator('tr', { hasText: '2019' })).filter({ hasText: 'Brouillon' })
    .first().getByRole('button', { name: /Ouvrir/ }).click();
  await validator.page.getByRole('button', { name: 'Valider', exact: true }).waitFor({ timeout: 10000 });
  // L'évaluateur modifie le brouillon pendant que le valideur le lit → 409 « rechargez », grille rechargée.
  await admin.call('PATCH', `/api/evaluation/providers/${ypa.id}/${draft.body.id}`, { comment: 'Contrôle C5 — modifié' });
  await validator.page.getByRole('button', { name: 'Valider', exact: true }).click();
  await validator.page.waitForTimeout(2500);
  const btn = validator.page.getByRole('button', { name: 'Valider', exact: true });
  check(await btn.count() === 1 && (await btn.getAttribute('aria-busy')) !== 'true' && await btn.isEnabled(), 'C5 après le 409 : panneau rechargé, « Valider » utilisable');
  check(await validator.page.locator('textarea#ev-comment').inputValue() === 'Contrôle C5 — modifié', 'C5 la version à jour est affichée');
  await btn.click();
  await validator.page.getByText(/validée par/).waitFor({ timeout: 10000 }).catch(() => {});
  check(await validator.page.getByText(/validée par/).count() > 0, 'C5 validée : le panneau montre l\'évaluation figée');
  check(await validator.page.getByRole('button', { name: 'Valider', exact: true }).count() === 0, 'C5 plus de bouton « Valider » (ni de chargement sans fin)');

  // ---- C9 : création d'une formation ----------------------------------------------------
  await admin.go('#/tpm/formations/nouvelle');
  await admin.page.fill('#tr-title', `Contrôle C9 ${Date.now()}`);
  await admin.page.fill('#tr-start', '2026-02-02'); await admin.page.fill('#tr-end', '2026-02-03');
  await admin.page.getByRole('button', { name: 'Créer la formation' }).click();
  await admin.page.waitForFunction(() => /#\/tpm\/formations\/[0-9a-f-]{36}/.test(window.location.hash), null, { timeout: 15000 });
  await admin.page.getByRole('button', { name: 'Modifier', exact: true }).waitFor({ timeout: 10000 }).catch(() => {});
  check(await admin.page.getByRole('button', { name: 'Modifier', exact: true }).count() === 1 && await admin.page.locator('#tr-title').count() === 0,
    'C9 la nouvelle formation s\'ouvre en lecture (« Modifier » visible, pas de formulaire)');
  const sessionId = (await admin.page.evaluate(() => window.location.hash)).split('/').pop();

  // ---- C6 / C7 / C8 : grille des participants ------------------------------------------
  await admin.page.locator('.tr-add select').first().selectOption(ypa.id);
  await admin.page.getByRole('button', { name: 'Ajouter tous ses agents actifs' }).click();
  await admin.page.locator('table.tr-grid input[aria-label^="Pré-test"]').first().waitFor({ timeout: 10000 });
  const pre = admin.page.locator('table.tr-grid input[aria-label^="Pré-test"]');
  const n = await pre.count();
  check(n >= 2, `C6 participants ajoutés (${n})`);
  // Un autre écrivain renseigne la présence du 2ᵉ participant pendant la saisie (C8).
  const before = (await admin.call('GET', `/api/trainings/${sessionId}`)).body.participants;
  await admin.call('PATCH', `/api/trainings/${sessionId}/participants`, { rows: [{ agentId: before[1].agentId, attendance: 'present' }] });
  await pre.nth(0).fill('12');
  await admin.page.fill('textarea[aria-label="Synthèse de la formation"]', 'Synthèse du contrôle C6');
  await admin.page.getByRole('button', { name: 'Enregistrer la synthèse' }).click();
  await admin.page.waitForTimeout(1500);
  check(await pre.nth(0).inputValue() === '12', 'C6 après un rechargement (synthèse), la note saisie est toujours là');
  check(await admin.page.getByText('Modifications non enregistrées.').count() === 1, 'C6 « Modifications non enregistrées » toujours affiché');
  const post = admin.page.locator('table.tr-grid input[aria-label^="Post-test"]');
  await post.nth(0).fill('abc');
  await admin.page.getByRole('button', { name: 'Enregistrer les présences et notes' }).click();
  await admin.page.waitForTimeout(800);
  check(await admin.page.getByText(/Valeur illisible/).count() > 0, 'C7 note illisible : refus affiché (agent et colonne)');
  let saved = (await admin.call('GET', `/api/trainings/${sessionId}`)).body.participants;
  check(saved[0].preScore == null, 'C7 rien n\'a été envoyé');
  await post.nth(0).fill('');
  await admin.page.getByRole('button', { name: 'Enregistrer les présences et notes' }).click();
  await admin.page.waitForTimeout(1500);
  saved = (await admin.call('GET', `/api/trainings/${sessionId}`)).body.participants;
  const byAgent = new Map(saved.map((p) => [p.agentId, p]));
  check(byAgent.get(before[0].agentId).preScore === 12, 'C8 la note saisie est enregistrée');
  check(byAgent.get(before[1].agentId).attendance === 'present', 'C8 la présence saisie par l\'autre écrivain n\'est pas écrasée');

  await admin.call('PATCH', `/api/trainings/${sessionId}`, { status: 'annulee' }); // ne compte nulle part
  await browser.close();
  console.log(failures.length ? `${failures.length} échec(s)` : 'Tous les contrôles du lot 8 passent.');
  process.exit(failures.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
