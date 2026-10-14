// Balayage des écrans (contrôle avant publication) : chaque route en FR puis EN —
// titre, erreurs console / page / API, phrases tr() sans traduction EN.
// Usage : node web/scripts/sweep-ecrans.cjs  (API et interface lancées ; compte de démonstration)
// Variables : PLAYWRIGHT (module), CHROMIUM (exécutable), WEB_URL (défaut http://localhost:5173),
//             API_PORT (défaut 9000), SWEEP_USER / SWEEP_PASSWORD.
// À compléter quand un lot ajoute un écran (liste ROUTES).
const { chromium } = require(process.env.PLAYWRIGHT || '/opt/node-tools/node_modules/playwright');
const ROUTES = ['contrats/liste', 'tpm/prestataires', 'tpm/formations', 'tpm/evaluation', 'tpm/budget', 'tpm/rapports',
  'processus/synthese', 'processus/donnees', 'processus/sites', 'processus/rbm', 'processus/couverture', 'processus/carte', 'processus/calculs',
  'pdd/distributions', 'pdd/synthese', 'pdd/pipeline', 'dashboard/apercu', 'dashboard/consolidation', 'dashboard/couverture',
  'reporting/synthese', 'reporting/concepteur', 'alertes/centre', 'parametrage/apercu', 'parametrage/partenaires', 'parametrage/types',
  'parametrage/activites', 'parametrage/taux', 'parametrage/localites', 'parametrage/bureaux', 'parametrage/sites', 'parametrage/mmr', 'parametrage/utilisateurs', 'parametrage/suppressions'];
const WEB = process.env.WEB_URL || 'http://localhost:5173';
const API = `:${process.env.API_PORT || 9000}`;
const TILE = /ERR_TUNNEL_CONNECTION_FAILED|tile\.openstreetmap/;
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium' });
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  let errs = [];
  p.on('console', (m) => { if (m.type() === 'error' && !TILE.test(m.text())) errs.push(m.text().slice(0, 200)); });
  p.on('pageerror', (e) => errs.push('PAGEERROR ' + e.message.slice(0, 200)));
  p.on('response', (r) => { if (r.url().includes(API) && r.status() >= 400) errs.push(`HTTP ${r.status()} ${r.url().replace(/^.*:\d+(?=\/api)/, '')}`); });
  await p.goto(`${WEB}/`);
  await p.fill('input[type=email]', process.env.SWEEP_USER || 'admin@mems.mg'); await p.fill('input[type=password]', process.env.SWEEP_PASSWORD || 'changeme123');
  await p.click('button[type=submit]'); await p.waitForSelector('.page-title', { timeout: 20000 });
  const total = { fr: 0, en: 0 }; const missing = new Set(); const titles = new Map();
  for (const lang of ['fr', 'en']) {
    await p.evaluate((l) => { localStorage.setItem('mems.lang', l); window.__memsMissingTr = new Set(); }, lang);
    await p.goto(`${WEB}/#/contrats/liste`); await p.reload(); await p.waitForSelector('.page-title', { timeout: 20000 });
    for (const r of ROUTES) {
      errs = [];
      await p.evaluate((h) => { window.location.hash = h; }, `#/${r}`);
      await p.waitForTimeout(400);
      try { await p.waitForLoadState('networkidle', { timeout: 15000 }); } catch { /* long polling */ }
      await p.waitForTimeout(600);
      const title = await p.locator('.page-title').first().innerText().catch(() => '(sans titre)');
      const miss = await p.evaluate(() => [...(window.__memsMissingTr || [])]);
      if (lang === 'en') miss.forEach((m) => missing.add(m));
      titles.set(`${lang}:${r}`, title);
      total[lang] += errs.length;
      if (errs.length || (lang === 'en' && miss.length)) {
        console.log(`[${lang}] ${r} — ${title}`);
        if (errs.length) console.log('   ERR', errs.slice(0, 5).join(' | '));
      }
    }
  }
  const dupTitles = ROUTES.filter((r, i) => i > 0 && titles.get(`fr:${r}`) === titles.get(`fr:${ROUTES[0]}`));
  if (dupTitles.length) console.log('ATTENTION navigation : même titre que la 1re route pour', dupTitles.join(', '));
  if (missing.size) console.log('EN MANQUANT', JSON.stringify([...missing].slice(0, 40)));
  console.log(`Routes ${ROUTES.length} × 2 · FR erreurs: ${total.fr} · EN erreurs: ${total.en} · EN phrases manquantes: ${missing.size}`);
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
