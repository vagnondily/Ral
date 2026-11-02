    function findings(P, ALL, VV, AG, ORG, IMP) {
      // Tous les textes sont reconstruits depuis les données à chaque recalcul : aucun constat figé.
      const f = (x, d = 0) => (x === null || x === undefined || !isFinite(x)) ? '–' : Number(x).toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d }).replace(/ /g, ' ');
      const dFr = s => s ? s.slice(8, 10) + '/' + s.slice(5, 7) + '/' + s.slice(0, 4) : '–';
      const ok = VV.filter(v => v.valid); const act = a => ok.filter(v => v.act === a);
      const rr = (a, k) => { const v = act(a); return v.length ? v.filter(x => x.risks.includes(k)).length / v.length * 100 : NaN; };
      const cov = {}; P.coverage.filter(x => x[1] === 'TOTAL').forEach(x => { cov[x[0]] = { p: x[2] ? x[3] / x[2] * 100 : NaN, v: x[3], n: x[2] }; });
      const S = P.acts.reduce((o, a) => { o[a.code] = a.short; return o; }, {});
      const rl = (a, k) => P.riskLabelAct[a + '|' + k] || (P.risks.find(x => x.code === k) || {}).label || k;
      const nSites = new Set(ok.map(v => v.act + '|' + v.code)).size;
      const PY = P.planYear || '';
      const A5 = ['GD', 'MIARO', 'PECMAM', 'SMP', 'RES'];
      const okIdx = new Set(); VV.forEach((v, i) => { if (v.valid) okIdx.add(i); });
      // part des visites exploitables où chaque norme est respectée (« Oui » / conforme)
      const normStats = a => { const it = P.items && P.items[a]; if (!it) return []; return it.meta.map((m, j) => { const vals = (it.vals[j] || []).filter(p => okIdx.has(p[0])); const n = vals.length, yes = vals.filter(p => p[1] >= 50).length; return { m, n, yes, p: n ? yes / n * 100 : NaN }; }).filter(x => x.n >= 5); };
      const F = [
        `${f(ALL.length)} fiches correspondent à ${f(VV.length)} visites (site × jour) ; ${f(ok.length)} visites sont exploitables (${f(VV.length ? ok.length / VV.length * 100 : NaN)} %) sur ${f(nSites)} sites, du ${dFr(P.period[0])} au ${dFr(P.period[1])}.`,
        `Score de conformité recalculé (/100, cible ${THR.good}) : ` + A5.filter(a => act(a).length).map(a => `${S[a]} ${f(meanN(act(a).map(v => v.score)), 1)} (${f(act(a).length)} visites)`).join(', ') + '.',
        `Couverture du plan de suivi ${PY} (sites actifs visités au moins une fois en ${PY}) : ` + A5.filter(a => cov[a] && cov[a].n).map(a => `${S[a]} ${f(cov[a].p)} % (${f(cov[a].v)}/${f(cov[a].n)})`).join(', ') + '.'
      ];
      A5.forEach(a => {
        const v = act(a); if (!v.length) return;
        const cnt = new Map(); v.forEach(x => x.risks.forEach(k => cnt.set(k, (cnt.get(k) || 0) + 1)));
        const top = Array.from(cnt.entries()).sort((x, y) => y[1] - x[1]).slice(0, 3).map(([k, n]) => `${rl(a, k)} ${f(n / v.length * 100)} % (${f(n)}/${f(v.length)})`);
        const nAl = v.filter(x => x.risks.length).length;
        F.push(`${S[a]} : ${f(nAl / v.length * 100)} % des visites avec au moins une alerte critique (${f(nAl)}/${f(v.length)})` + (top.length ? ` – principales : ${top.join(' ; ')}` : '') + '.');
        const doms = (P.domains[a] || []).map((d, j) => [d, meanN(v.map(x => (x.doms[j] === null || x.doms[j] === undefined) ? NaN : x.doms[j]))]).filter(x => isNum(x[1])).sort((x, y) => x[1] - y[1]);
        const weak = normStats(a).sort((x, y) => x.p - y.p).slice(0, 3);
        const byReg = new Map(); v.forEach(x => { if (!x.region) return; if (!byReg.has(x.region)) byReg.set(x.region, []); byReg.get(x.region).push(x.score); });
        const regs = Array.from(byReg.entries()).filter(e => e[1].length >= 5).map(e => [e[0], meanN(e[1]), e[1].length]).sort((x, y) => x[1] - y[1]);
        const parts = [];
        if (doms.length) parts.push(`domaine le plus faible : ${doms[0][0]} (${f(doms[0][1])}/100)` + (doms[1] ? `, puis ${doms[1][0]} (${f(doms[1][1])}/100)` : ''));
        if (weak.length) parts.push('normes les moins respectées : ' + weak.map(w => `« ${w.m.label} » ${f(w.p)} % des visites (${f(w.yes)}/${f(w.n)})`).join(' ; '));
        if (regs.length > 1) parts.push(`région la plus faible : ${regs[0][0]} (${f(regs[0][1], 1)}/100 sur ${f(regs[0][2])} visites)`);
        if (parts.length) F.push(`${S[a]} – ${parts.join(' ; ')}.`);
      });
      const M = P.smpMeals; if (M && act('SMP').length) F.push(`SMP : ${f(M.p_supply)} % des écoles signalent une rupture, un retard de livraison ou une catastrophe ayant empêché les repas ; ${f(M.p_cal_only)} % des écoles sous 20 jours de repas l’expliquent uniquement par des jours sans école (question probablement mal comprise)` + (isNum(M.cooks_noinc) ? ` ; ${f(M.cooks_noinc)} % des groupes de cuisiniers ne reçoivent aucune incitation` : '') + '.');
      const g = k => AG.filter(a => a.grade === k).length;
      const wkCnt = new Map(); AG.filter(a => a.grade !== 'N/N').forEach(a => String(a.weak || '').split('; ').filter(w => w && w !== '—').forEach(w => wkCnt.set(w, (wkCnt.get(w) || 0) + 1)));
      const wkTop = Array.from(wkCnt.entries()).sort((x, y) => y[1] - x[1]).slice(0, 3).map(([w, n]) => `${w} (${f(n)} agents)`);
      F.push(`Agents : ${g('A')} notés A, ${g('B')} B, ${g('C')} C, ${g('D')} D, ${g('N/N')} non notés (moins de ${GRADE_SCALES.agent.minN} fiches)` + (wkTop.length ? ` ; points faibles les plus fréquents : ${wkTop.join(', ')}` : '') + '.');
      const og = ORG.filter(o => o.grade !== 'N/N' && isNum(o.global));
      if (og.length > 1) { const best = og[0], worst = og[og.length - 1]; F.push(`Partenaires de suivi (qualité de la collecte) : meilleur ${best.org} (${f(best.global)}/100 sur ${f(best.n)} fiches), plus faible ${worst.org} (${f(worst.global)}/100 sur ${f(worst.n)} fiches ; fiches exploitables ${f(worst.p_valid)} %, GPS conforme ${f(worst.p_gps)} %).`); }
      const big = IMP.filter(o => o.act === 'GD' && o.visits > 50).sort((x, y) => y.p_risk - x.p_risk);
      if (big.length) F.push('Partenaires de mise en œuvre GD à fort volume (plus de 50 visites) : ' + big.map(o => `${o.imp} ${f(o.p_risk)} % de visites avec alerte sur ${f(o.visits)} visites (note ${o.grade}${o.top_risks && o.top_risks !== '—' ? ' ; ' + o.top_risks : ''})`).join(' ; ') + '.');
      P.findings = F;
      // ---- qualité des données : entièrement recalculée
      const dqa = {}; P.dq.forEach(x => { dqa[x.act] = x; }); const z = a => dqa[a] || {};
      const DQ = [];
      if (z('PECMAM').sysEmpty) DQ.push(`PECMAM : ${f(z('PECMAM').sysEmpty)} fiches antérieures au ${dFr(SYS_EMPTY_BEFORE.PECMAM)} ne contiennent que l’en-tête (ancienne version du formulaire) ; elles sont exclues des indicateurs et de l’évaluation des agents.`);
      if (z('SMP').subs) DQ.push(`SMP : ${f(z('SMP').empty)} fiches sans contenu exploitable, dont ${f(z('SMP').sysEmpty)} antérieures au ${dFr(SYS_EMPTY_BEFORE.SMP)} (même problème de version). Une visite SMP est saisie en plusieurs fiches : les indicateurs sont calculés par visite (école × jour).`);
      const durA = ALL.filter(s => isNum(s.dur));
      if (durA.length) { const op = durA.filter(s => s.dur > 1440).length, neg = durA.filter(s => s.dur < 0).length, plaus = durA.filter(s => s.dur >= 3 && s.dur <= 600); const mesur = A5.filter(a => durA.some(s => s.act === a)).map(a => S[a]).join(', '); DQ.push(`Durée des fiches (mesurée seulement quand le formulaire enregistre l’heure d’ouverture et de fin : ${mesur}) : ${f(op)} fiches sur ${f(durA.length)} (${f(op / durA.length * 100)} %) sont finalisées plus de 24 h après ouverture – leur durée ne mesure pas l’entretien et l’heure réelle de collecte devient incertaine` + (neg ? ` ; ${f(neg)} durée(s) négative(s) (horloge de tablette)` : '') + ` ; durée médiane d’un entretien (fiches entre 3 min et 10 h) : ${f(medianN(plaus.map(s => s.dur)))} min sur ${f(plaus.length)} fiches.`); }
      const nOther = ALL.filter(s => s.enu_other).length;
      // Formulaire sans liste d'agents (toutes ses fiches en « Autre ») : non imputable aux agents, compté à part
      const noList = (P.dq || []).filter(x => x.nameNoList).map(x => x.act);
      P.acts.map(a => a.code).forEach(a => { const g = ALL.filter(s => s.act === a); if (!noList.includes(a) && g.length >= 20 && g.every(s => s.enu_other)) noList.push(a); });
      const withList = ALL.filter(s => !noList.includes(s.act)), nOtherL = withList.filter(s => s.enu_other).length;
      DQ.push(`Identification : ${f(withList.length ? nOtherL / withList.length * 100 : NaN)} % des fiches des formulaires qui ont une liste d’agents (${f(nOtherL)}/${f(withList.length)}) utilisent « Autre » pour le nom de l’agent` + (noList.length ? ` ; ${noList.map(a => S[a]).join(', ')} : le formulaire n’a pas de liste d’agents (${f(ALL.length - withList.length)} fiches, non imputable aux agents)` : '') + ` – ${f(new Set(ALL.map(s => s.enu_raw).filter(Boolean)).size)} graphies rapprochées en ${f(new Set(ALL.map(s => s.enu)).size)} agents. Mettre à jour les listes d’agents des formulaires.`);
      DQ.push(`Dates hors période de validité (avant le ${dFr(WIN0)} ou après le ${dFr(WIN1)}, ex. horloge de tablette) : ` + A5.map(a => `${S[a]} ${f(z(a).dateBad || 0)}`).join(', ') + ' fiches.');
      DQ.push('Sites saisis en « Autre » (hors liste du plan) : ' + A5.map(a => `${S[a]} ${f(z(a).offList || 0)}`).join(', ') + ' fiches.');
      const resPlan = cov.RES ? cov.RES.n : 0, resSeen = new Set(act('RES').map(v => v.code)).size;
      if (resSeen && resPlan < resSeen / 2) DQ.push(`Résilience : le plan de suivi ${PY} ne liste que ${f(resPlan)} site(s) actif(s) alors que ${f(resSeen)} sites ont été suivis – la couverture Résilience n’est pas calculable tant que le plan n’est pas complété.`);
      const smpDiv = rr('SMP', 'HHDistDiv');
      if (isNum(smpDiv) && act('SMP').length) DQ.push(`SMP : « ${rl('SMP', 'HHDistDiv')} » est signalé dans ${f(smpDiv)} % des visites SMP exploitables. La question n’a pas de libellé français dans le formulaire (seule la consigne anglaise s’affiche) : un taux élevé peut venir d’une mauvaise compréhension, à confirmer sur le terrain.`);
      if (P.formCmp && P.formCmp.GD) { const c = P.formCmp.GD, ac = Math.abs(c.corr); DQ.push(`GD/PREVMA : l’indice de performance calculé par le formulaire (${f(c.form, 1)}/100) est ${ac >= 0.7 ? 'fortement' : ac >= 0.4 ? 'modérément' : 'faiblement'} corrélé au score recalculé (${f(c.recalc, 1)}/100, r = ${f(c.corr, 2)} sur ${f(c.n)} visites)` + (P.formRisk && P.formRisk.ScoreRisk_raw_max === 0 ? ` ; sa composante « risques » n’est jamais déduite (toujours au maximum) alors que ${f(P.formRisk.visitsWithRisk)} % des visites GD présentent au moins une alerte.` : '.')); }
      DQ.push('GD/PREVMA (conception du formulaire) : les questions de signalement au comité de plainte / ligne verte n’ont pas de condition d’affichage – elles sont posées à tous, y compris quand aucun problème n’est signalé ; seules les réponses des visites ayant signalé un problème sont à lire.');
      P.dqFindings = DQ;
      methodTexts(P, S, f, dFr);
    }
    function methodTexts(P, S, f, dFr) {
      const M = Array.isArray(P.method) ? P.method.slice() : [];
      const PF = P.planFull || { cols: [], rows: [] }, pc = k => PF.cols.indexOf(k);
      const U = P.updated || {}, acts = P.acts.map(a => a.code).filter(a => U[a]);
      const geo = PF.rows.filter(x => x[pc('lat')] !== null && x[pc('lat')] !== undefined).length;
      const src = `Sources : ${f(acts.length)} extractions (` + acts.map(a => `${S[a]} : ${f(U[a].rows)} lignes, mise à jour du ${dFr(U[a].date)}`).join(' ; ') + `), le plan de suivi ${P.planYear || ''} (${f(geo)} sites géolocalisés sur ${f(PF.rows.length)})` + (U.PLAN ? `, mis à jour le ${dFr(U.PLAN.date)}` : '') + ` et les ${f(P.acts.length)} formulaires XLSForm (libellés, listes de choix, logique).`;
      const dqG = (P.dq || []).find(x => x.act === 'GD');
      const join = U.GD && dqG ? `Les jointures des extractions multiplient les lignes (ex. GD : ${f(U.GD.rows)} lignes pour ${f(dqG.subs)} fiches, à cause des répétitions participants FGD / produits / stocks). Chaque niveau est dédoublonné par son identifiant avant calcul.` : null;
      const win = `Période de validité des fiches : du ${dFr(P.window && P.window.from)} au ${dFr(P.window && P.window.to)} (fin = date du dernier recalcul) ; une fiche datée hors de cette période (horloge de tablette, test) est exclue de tous les indicateurs.`;
      const grades = `Notes : agents et organisations de suivi A ≥ ${GRADE_SCALES.agent.A}, B ≥ ${GRADE_SCALES.agent.B}, C ≥ ${GRADE_SCALES.agent.C}, D en dessous (non noté sous ${GRADE_SCALES.agent.minN} fiches pour un agent, ${GRADE_SCALES.org.minN} pour une organisation) ; partenaires de mise en œuvre A ≥ ${GRADE_SCALES.imp.A}, B ≥ ${GRADE_SCALES.imp.B}, C ≥ ${GRADE_SCALES.imp.C} (non noté sous ${GRADE_SCALES.imp.minN} visites). Score de conformité : bon ≥ ${THR.good}, à améliorer ${THR.mid}–${THR.good}, faible < ${THR.mid} ; part de visites avec alerte : peu fréquentes ≤ ${THR.rLow} %, fréquentes ${THR.rLow}–${THR.rHigh} %, très fréquentes > ${THR.rHigh} % (repères internes provisoires, aucune cible officielle).`;
      const agentsTxt = `Agents : rapprochement des graphies de noms (accents, ordre nom/prénom, fautes de frappe). Score global = 80 % qualité des données + 20 % volume (productivité) ; un critère non mesurable pour un agent est retiré et son poids réparti sur les autres ; barème dans « Notes ».`;
      const rbmTxt = `Planification RBM : score de risque 0–100 par site actif du plan, calculé à partir des visites réelles du site (conformité récente, alertes critiques de la dernière visite, jamais visité, délai depuis la dernière visite, note du partenaire de mise en œuvre) ; pondérations, seuils, fréquences par niveau et par activité et capacités sont réglables dans l’onglet Planification, où chaque site montre le détail de son calcul.`;
      const act = PF.rows.filter(x => x[pc('actif')] === 1).length;
      const VVv = (P.visits || []).filter(rw => rw[11] === 1), days = VVv.map(rw => rw[1]).filter(Boolean).sort();
      const scope = `Données couvertes par ce fichier : ${f(VVv.length)} visites exploitables sur ${f((P.visits || []).length)}, du ${dFr(days[0])} au ${dFr(days[days.length - 1])} ; plan de suivi : ${f(act)} sites actifs sur ${f(PF.rows.length)}. Tous les chiffres, constats et textes automatiques sont recalculés à partir de ces données à chaque ouverture du fichier et à chaque import.`;
      const put = (re, txt, at) => { if (!txt) return; const i = M.findIndex(t => re.test(t)); if (i >= 0) M[i] = txt; else M.splice(at === undefined ? M.length : Math.min(at, M.length), 0, txt); };
      put(/^Sources :/, src, 0); put(/^Données couvertes par ce fichier/, scope, 1); put(/jointures/, join, 1); put(/^Période de validité/, win, 4); put(/^Notes : agents/, grades); put(/^Fichier sécurisé/, `Fichier sécurisé : aucune ressource externe ni connexion réseau ; scripts autorisés uniquement par empreinte (CSP) et aucune injection de HTML possible (Trusted Types) ; mot de passe d’administration stocké sous forme d’empreinte renforcée. Données personnelles présentes : noms des agents et leurs notes, positions GPS des fiches (lieu de l’entretien), réponses libres « Autre » ; aucun nom, téléphone ni photo de bénéficiaire. Le mot de passe ne protège pas la lecture : partagez le fichier complet uniquement avec des personnes autorisées, sinon utilisez la « Version à partager ».`); put(/^Agents : rapprochement/, agentsTxt); put(/^Planification RBM/, rbmTxt);
      P.method = M;
    }
