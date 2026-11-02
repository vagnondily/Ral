// Export du fichier (exportHtml) puis réouverture de l'export : 0 erreur, même nombre de visites, CSP valide.
const { chromium } = require('playwright'); const path = require('path'), fs = require('fs');
(async () => {
  const file = path.resolve(process.argv[2]); const out = path.resolve(process.argv[3] || 'export-roundtrip.html');
  const browser = await chromium.launch(); const ctx = await browser.newContext({ acceptDownloads: true }); const page = await ctx.newPage();
  const errs = []; page.on('pageerror', e => errs.push('[pageerror] ' + e.message)); page.on('console', m => { if (m.type() === 'error') errs.push('[console] ' + m.text()); });
  await page.goto('file://' + file + '#debug', { waitUntil: 'load', timeout: 120000 }); await page.waitForSelector('#tabs button');
  const n1 = await page.evaluate(() => window.__dash.CUR.visits.length);
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), page.evaluate(() => window.__dash.exportHtml())]);
  await dl.saveAs(out);
  const p2 = await ctx.newPage(); const errs2 = []; p2.on('pageerror', e => errs2.push('[pageerror] ' + e.message)); p2.on('console', m => { if (m.type() === 'error') errs2.push('[console] ' + m.text()); });
  await p2.goto('file://' + out + '#debug', { waitUntil: 'load', timeout: 120000 }); await p2.waitForSelector('#tabs button', { timeout: 60000 });
  const tabs = await p2.$$eval('#tabs button', bs => bs.length);
  for (let i = 1; i <= tabs; i++) { await p2.click('#tabs button:nth-child(' + i + ')'); await p2.waitForTimeout(300); }
  const n2 = await p2.evaluate(() => window.__dash.CUR.visits.length);
  console.log(JSON.stringify({ exportSizeMo: +(fs.statSync(out).size / 1048576).toFixed(2), visitsBefore: n1, visitsAfter: n2, errorsSource: errs, errorsExport: errs2.slice(0, 10) }, null, 1));
  await browser.close(); process.exit(errs.length || errs2.length || n1 !== n2 ? 1 : 0);
})().catch(e => { console.error('HARNESS FAIL', e); process.exit(2); });
