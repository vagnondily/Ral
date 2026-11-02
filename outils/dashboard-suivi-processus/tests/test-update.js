// Simule une mise à jour des données et vérifie que chiffres ET commentaires suivent (ouvrir avec #debug).
(async () => {
  const d = window.__dash, sleep = ms => new Promise(r => setTimeout(r, ms));
  const tab = async name => { const b = Array.from(document.querySelectorAll('#tabs button')).find(x => x.textContent.includes(name)); b.click(); await sleep(600); return document.getElementById('main').innerText; };
  const grab = async () => {
    const o = {};
    o.overview = await tab('Vue d'); o.quality = await tab('Qualité'); o.method = await tab('Méthodo'); o.agents = await tab('Agents');
    o.partners = await tab('Partenaires'); o.report = await tab('Rapport'); o.map = await tab('Carte'); o.planif = await tab('Planification'); o.sites = await tab('Sites');
    o.subtitle = document.getElementById('subtitle').textContent; return o;
  };
  // texte saisi à la main dans le rapport AVANT la mise à jour (si le rapport le permet)
  await tab('Rapport');
  const eds = Array.from(document.querySelectorAll('#main .ed[data-id]'));
  const editable = eds.find(e => /^msg\.SMP/.test(e.dataset.id)) || eds.find(e => /^msg\./.test(e.dataset.id)) || eds[0];
  let edited = null;
  if (editable) { editable.focus(); editable.textContent = editable.textContent + ' [note manuelle de test]'; editable.dispatchEvent(new Event('input', { bubbles: true })); editable.blur(); edited = editable.textContent.slice(0, 80); await sleep(200); }
  const before = await grab();
  // Mutation 1 : toutes les visites et fiches d'octobre 2026 deviennent non exploitables
  const P = JSON.parse(JSON.stringify(d.CUR));
  let nv = 0; P.visits.forEach(rw => { if (String(rw[1]) >= '2026-10-01' && rw[11] === 1) { rw[11] = 0; nv++; } });
  const SC = P.subs.cols, iv = SC.indexOf('valid'), id = SC.indexOf('day');
  let ns = 0; P.subs.rows.forEach(r => { if (String(r[id]) >= '2026-10-01' && r[iv] === 1) { r[iv] = 0; ns++; } });
  // Mutation 2 : 300 sites SMP du plan désactivés
  const PF = P.planFull, ia = PF.cols.indexOf('act'), ic = PF.cols.indexOf('actif');
  let np = 0; PF.rows.forEach(r => { if (r[ia] === 'SMP' && r[ic] === 1 && np < 300) { r[ic] = 0; np++; } });
  const t0 = performance.now(); const P2 = d.ENGINE.refreshPlanTables(P); const ms = Math.round(performance.now() - t0);
  d.reboot(P2, 'overview'); await sleep(800);
  const after = await grab();
  const diff = {}; Object.keys(before).forEach(k => { diff[k] = before[k] === after[k] ? 'IDENTIQUE' : 'change'; });
  const pick = (t, re) => { const m = t.match(re); return m ? m[0] : null; };
  return { mutated: { visits: nv, subs: ns, planSites: np }, recomputeMs: ms, diff, editedBefore: edited,
    reportStale: /avant la mise à jour|à revoir/i.test(after.report),
    sample: { exploitBefore: pick(before.overview, /[\d  ]+ visites sont exploitables[^.]*/), exploitAfter: pick(after.overview, /[\d  ]+ visites sont exploitables[^.]*/),
      covBefore: pick(before.overview, /Couverture du plan de suivi[^\n]{0,160}/), covAfter: pick(after.overview, /Couverture du plan de suivi[^\n]{0,160}/) } };
})()
