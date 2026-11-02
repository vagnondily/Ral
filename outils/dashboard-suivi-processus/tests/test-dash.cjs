// Usage : node test-dash.cjs <fichier.html> [--shots <dossier>] [--tabs overview,map,...] [--eval <fichier.js>]
// Ouvre le dashboard dans Chromium headless, clique chaque onglet, relève les erreurs (console, page, CSP).
// --eval : script exécuté dans la page après chargement (doit renvoyer une valeur sérialisable ; peut être async).
const { chromium } = require('playwright');
const path = require('path'), fs = require('fs');
(async () => {
  const args = process.argv.slice(2); const file = path.resolve(args[0]);
  const opt = k => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
  const shots = opt('--shots'), only = opt('--tabs'), evalFile = opt('--eval');
  if (shots) fs.mkdirSync(shots, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errs = [];
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errs.push('[console.' + m.type() + '] ' + m.text()); });
  page.on('pageerror', e => errs.push('[pageerror] ' + (e.stack || e.message)));
  await page.goto('file://' + file + (args.includes('--debug') ? '#debug' : ''), { waitUntil: 'load', timeout: 120000 });
  await page.waitForSelector('#tabs button', { timeout: 60000 });
  const tabs = await page.$$eval('#tabs button', bs => bs.map(b => b.textContent));
  const res = [];
  for (let i = 0; i < tabs.length; i++) {
    if (only && !only.split(',').some(t => tabs[i].toLowerCase().includes(t.toLowerCase()))) continue;
    const before = errs.length; const t0 = Date.now();
    await page.click('#tabs button:nth-child(' + (i + 1) + ')');
    await page.waitForTimeout(400);
    const info = await page.evaluate(() => ({ cards: document.querySelectorAll('#main .card').length, txt: document.getElementById('main').innerText.length }));
    res.push({ tab: tabs[i], ms: Date.now() - t0, cards: info.cards, chars: info.txt, newErrors: errs.length - before });
    if (shots) await page.screenshot({ path: path.join(shots, String(i).padStart(2, '0') + '-' + tabs[i].replace(/[^a-z0-9]+/gi, '_') + '.png'), fullPage: false });
  }
  let evalOut = null;
  if (evalFile) { const code = fs.readFileSync(evalFile, 'utf8'); evalOut = await page.evaluate(code); }
  console.log(JSON.stringify({ tabs: res, errors: errs.slice(0, 40), errorCount: errs.length, eval: evalOut }, null, 1));
  await browser.close();
  process.exit(errs.length ? 1 : 0);
})().catch(e => { console.error('HARNESS FAIL', e); process.exit(2); });
