  // ================================================================== LOT « RAPPORT » (préfixe rp) : rapport décisionnel en vraies pages A4
  // Trois modèles (Note de direction, Revue mensuelle, Revue partenaires), composés de blocs infographiques.
  // Une seule source par notion : piModel (Pilotage), covCalc, ovDomRows, ovImpRows, agXScored().R.ORG, plExecution, plDemand.
  // Aucun seuil écrit ici : THR, PILOT, SMALL_N, GRADE_SCALES, ENGINE.AG_CRIT. Les dimensions en millimètres sont dans RP_SZ.
  // L'ancien rapport (renderReport) reste intact : menu « … › Rapport détaillé (ancien) ».

  // nouvelle entrée provisoire de la table des seuils de pilotage (fiche activité : normes en baisse)
  if (PILOT.normDrop === undefined) {
    PILOT.normDrop = 10;
    PILOT_DEF.push(['normDrop', 'Baisse d’une norme signalée dans la fiche activité', 'points', 'au moins normN visites de chaque côté']);
  }
  if (PILOT.rupture === undefined) {   // écart d'une fenêtre à l'autre à vérifier avant de conclure (signaux)
    PILOT.rupture = 40;
    PILOT_DEF.push(['rupture', 'Écart d’un signal à vérifier avant de conclure', 'points', 'd’une fenêtre à l’autre']);
  }
  const RP_TPL = {
    pilotage: { name: 'Rapport de suivi-évaluation (pilotage des activités)', reader: 'Chef de programme et gestionnaires d’activités', short: 'Pilotage', group: 'Pilotage', tag: 'le plus complet' },
    synthese: { name: 'Synthèse', reader: 'Une page pour la direction', short: 'Synthèse', group: 'Direction', tag: '1 page' },
    direction: { name: 'Note de direction', reader: 'Pour le comité et la direction', short: 'Note', group: 'Direction' },
    trimestre: { name: 'Revue trimestrielle', reader: 'Pour la revue de trimestre', short: 'Trimestre', group: 'Direction' },
    mensuelle: { name: 'Revue mensuelle', reader: 'Pour le comité mensuel et chaque activité', short: 'Revue', group: 'Activités' },
    activite: { name: 'Fiche activité', reader: 'Pour l’équipe d’une activité', short: 'Activité', group: 'Activités', tag: '1 page' },
    partenaires: { name: 'Revue partenaires', reader: 'Pour les réunions de contrat', short: 'Partenaires', group: 'Partenaires' },
    bailleur: { name: 'Rapport bailleur', reader: 'Pour le bailleur, diffusable', short: 'Bailleur', group: 'Partenaires', tag: 'diffusable' }
  };
  const RP_TPL_IDS = ['pilotage', 'synthese', 'direction', 'trimestre', 'mensuelle', 'activite', 'partenaires', 'bailleur'];
  const RP_TPL_GROUPS = ['Pilotage', 'Direction', 'Activités', 'Partenaires'];
  // Modèles « partenaires » : fenêtre = période des filtres (et non la fenêtre de 1 ou 3 mois), blocs orientés contrat.
  const RP_PARTNER_TPL = { partenaires: 1, bailleur: 1 };
  function rpPartnerTpl(t) { return !!RP_PARTNER_TPL[t]; }
  // Dimensions (mm) : grille A4 portrait, 12 colonnes de 11,83 mm, gouttières de 4 mm
  const RP_SZ = { pageW: 210, pageH: 297, padTop: 12, padSide: 12, footFromBottom: 8, bottomReserve: 20, usable: 186, col: 11.83, gut: 4, fontPt: 9 };
  const RP_PT = 0.3528;                     // 1 pt en mm
  const RP_PX = 96 / 25.4;                  // 1 mm en pixels CSS
  const RP_C = { ink: '#1b2430', sub: '#5b6775', line: '#dde3ea', track: '#eef1f4', blue: '#0a6ebd', prev: '#9aa5b1', vol: '#c9d1da', shade: '#f3f5f8', red: '#c23b2a',
    orange: '#d08a00', none: '#f1f3f5', cov: ['#e8f1fa', '#b9d5ee', '#6fa8dc', '#1f63a8'], seg: ['#dfe7f0', '#b9cadb', '#8fa8c2', '#5f7f9f'],
    st: { good: { c: '#1f8a4c', bg: '#e1f2e7', tx: '#1b6b3c', ic: '✓' }, mid: { c: '#d08a00', bg: '#fdf0d5', tx: '#7d5200', ic: '!' }, bad: { c: '#c23b2a', bg: '#fbe3df', tx: '#8f2a1d', ic: '✗' }, na: { c: '#7a8795', bg: '#eceff2', tx: '#46525f', ic: '?' } },
    tier: { 1: '#f3c7bf', 2: '#f8dfae', 3: '#dfe3e8' }, gradeC: '#f8dfae', gradeD: '#f3c7bf' };
  const RP_COV_BREAKS = [10, 25, 50];       // classes fixes de la carte (% des sites actifs vus), demandées par la spécification
  const RP_CAT = [['high', 'élevé'], ['med', 'moyen'], ['low', 'faible'], ['never', 'jamais visité']];
  const RP_GRADES = ['A', 'B', 'C', 'D', 'N/N'];
  const RP_ST_WORD = { good: 'bon', mid: 'à améliorer', bad: 'faible', na: 'non calculé' };
  const RP_LS = typeof secLsKey === 'function' ? secLsKey('pm-report-cfg-v3') : 'pm-report-cfg-v3';
  const RP_CACHE = { key: null, M: null, X: {} };
  const RP_STATE = { pages: [], hidden: [], moved: [], ms: 0, fit: {}, paintN: 0, doc: null, sel: null, built: null, tplBuilt: null };

  const rpNum = x => typeof x === 'number' && isFinite(x);
  const rpMode = () => SESSION.rpMode === 'int' ? 'int' : 'diff';
  const rpDiff = () => rpMode() === 'diff';
  const rpK = () => SESSION.piK === 1 ? 1 : PILOT.k;
  // Petits effectifs : une seule règle (SMALL_N)
  function rpN(n) { return !n || n < SMALL_N.min ? 'none' : n < SMALL_N.low ? 'low' : 'ok'; }
  // Version diffusable : 1 à 4 s'écrit « moins de 5 » (même règle que piMask, lue sur SESSION.rpMode)
  function rpMask(n) { return rpDiff() && rpNum(n) && n > 0 && n < PILOT.mask ? 'moins de ' + PILOT.mask : fmt(n); }
  function rpNN(n, N) { return rpMask(n) + ' / ' + rpMask(N); }
  function rpPct(n, N, d) { return N ? pct(n / N * 100, d === undefined ? 0 : d) : '–'; }
  const rpCap = s => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
  const rpLow = s => s ? s.charAt(0).toLowerCase() + s.slice(1) : s;
  function rpCut(s, max) {   // coupe sur un mot, jamais au milieu d'un nombre
    s = String(s || '').replace(/\s+/g, ' ').trim(); if (s.length <= max) return s;
    let t = s.slice(0, max - 1); const sp = t.lastIndexOf(' '); if (sp > max * 0.5) t = t.slice(0, sp);
    t = t.replace(/[\s,;:.(–-]+$/, '').replace(/\s\d[\d\s.,]*$/, '');
    return t + '…';
  }
  function rpShortQ(label, max) { return rpCut(String(label || '').replace(/^\*+|\*+$/g, '').replace(/\s*\?\s*$/, '').replace(/\s*\(.*$/, ''), max || 60); }
  function rpDomLabel(d) { return String(d || '').replace(/\s*\(.*$/, '').replace(/&/g, 'et').trim(); }
  function rpWin(W) { return piWin(W); }
  function rpMonthsOf(a, b) { return piMonths(a, b); }
  function rpStat(k) { return RP_C.st[k] || RP_C.st.na; }
  function rpCls(v) { return v === null || v === undefined || isNaN(v) ? 'na' : cls(v); }
  function rpBtn(text, fn, extra, tip) { const b = el('button', { class: 'btn' + (extra ? ' ' + extra : ''), type: 'button', text }); b.addEventListener('click', fn); if (tip) b.setAttribute('title', tip); return b; }
  function rpSeg(cur, opts, on, label, disabled) {
    return el('div', { class: 'rp-seg', role: 'group', 'aria-label': label || '' }, opts.map(([v, l]) => {
      const b = rpBtn(l, () => { if (!disabled) on(v); }, String(cur) === String(v) ? 'on' : '');
      b.setAttribute('aria-pressed', String(String(cur) === String(v))); if (disabled) b.disabled = true; return b;
    }));
  }
  // identifiants des organisations et partenaires en version diffusable : codes stables (ordre des visites puis du nom)
  function rpCoder(list, prefix) {
    const m = new Map(); list.slice().sort((a, b) => (b.n - a.n) || String(a.name).localeCompare(String(b.name), 'fr')).forEach((o, i) => m.set(o.name, prefix + ' ' + (i + 1)));
    return name => rpDiff() ? (m.get(name) || prefix) : name;
  }
  // ---------------------------------------------------------------- RP_DEF : une table pour l'infobulle, le panneau, les notes et l'annexe Méthode
  // Textes de seuil construits depuis THR, PILOT, SMALL_N, GRADE_SCALES et ovALERT_TIERS (jamais de valeur écrite à la main).
  function rpDefs() {
    const k = PILOT.k, mn = PILOT.minN, sm = SMALL_N.min, sl = SMALL_N.low;
    return {
      visites: { label: 'Visites exploitables', def: 'Visites dont au moins une fiche est exploitable (activité, site, jour), dans la fenêtre du rapport.',
        formula: 'Nombre de visites exploitables de la fenêtre, filtres appliqués sans la période.', ref: 'Avant = la fenêtre précédente de même durée.',
        limits: 'Une visite réunit les fiches d’une même activité, même site, même jour.', short: 'Visites exploitables de la fenêtre, contre la fenêtre précédente.' },
      couverture: { label: 'Sites vus', def: 'Sites actifs du plan qui ont reçu au moins une visite exploitable pendant la fenêtre.',
        formula: 'Sites actifs vus ÷ sites actifs du plan au moins un mois de la fenêtre (même calcul que la carte et la planification).', ref: 'Aucune cible de couverture validée.',
        limits: 'La grille d’activation est presque partout à « Oui » : le nombre de sites actifs est sans doute surestimé.', short: 'Sites actifs vus pendant la fenêtre, sur les sites actifs du plan.' },
      graves: { label: 'Cas graves sans suite', def: 'Visites avec une atteinte grave (famille « ' + PI_FAM[0].label + ' ») sans statut enregistré dans le registre des cas.',
        formula: 'Visites de la période choisie portant un code de la famille, sans statut au registre.', ref: 'Rouge dès qu’un cas dépasse ' + PILOT.caseAge + ' jours sans suite.',
        limits: 'Un signalement est une observation non vérifiée.', short: 'Atteintes graves sans statut au registre ; ancien au-delà de ' + PILOT.oldDays + ' jours.' },
      charge: { label: 'Charge du plan', def: 'Visites dues chaque mois selon le risque des sites, rapportées aux visites réellement faites par mois.',
        formula: 'Somme sur les sites actifs de 1 ÷ intervalle de visite, en moyenne sur l’horizon du plan, divisée par les visites faites par mois dans la fenêtre.',
        ref: 'Au-delà de ' + fmt(PILOT.cap, 1) + ' fois la capacité : le plan ne peut pas être tenu.', limits: 'Les sites jamais visités ont tous le même risque théorique.', short: 'Visites dues par mois ÷ visites faites par mois (au-delà de ' + fmt(PILOT.cap, 1) + ' : rouge).' },
      verdict: { label: 'Statut d’une activité', def: 'Première règle vraie : hors contrôle, non concluant, à surveiller, sous contrôle.',
        formula: '✗ score sous ' + THR.mid + ' ou baisse d’au moins ' + PILOT.drop + ' points avec ' + mn + ' visites de chaque côté, ou suivi interrompu ; ? moins de ' + mn + ' visites ; ! sous ' + THR.good + ' ; ✓ sinon.',
        ref: 'Cible ' + THR.good + ', seuil faible ' + THR.mid + ', provisoires.', limits: 'Les formulaires diffèrent : on ne compare jamais deux activités entre elles.', short: 'Statut contre la référence de l’activité ; ' + mn + ' visites au moins pour conclure.' },
      score: { label: 'Score de conformité', def: 'Moyenne des scores des visites exploitables de la fenêtre de l’activité.',
        formula: 'Score d’une visite = moyenne des questions répondues (conforme 100, partiel 50, non conforme 0).', ref: 'Cible ' + THR.good + ', seuil faible ' + THR.mid + '.',
        limits: 'Hachuré sous ' + mn + ' visites. Une activité qui n’a pas assez de visites sur la fenêtre prend la dernière fenêtre exploitable (marque †).', short: 'Score moyen sur 100 et écart à la fenêtre précédente ; † fenêtre de repli.' },
      courbe: { label: 'Six derniers mois', def: 'Score moyen de chaque mois, sur une échelle fixe.',
        formula: 'Point plein dès ' + sl + ' visites, point creux de ' + sm + ' à ' + (sl - 1) + ', aucun point sous ' + sm + '. Un trait relie deux mois consécutifs ayant un point.',
        ref: 'Ligne pointillée à ' + THR.good + '. Barres grises : nombre de visites du mois.', limits: 'Les mois de la fenêtre sont ombrés.', short: 'Point plein dès ' + sl + ' visites, creux de ' + sm + ' à ' + (sl - 1) + ', rien sous ' + sm + '.' },
      sitesAct: { label: 'Sites vus par activité', def: 'Sites actifs de l’activité vus pendant sa fenêtre.', formula: 'Même calcul que la couverture.', ref: 'Aucune cible validée.',
        limits: '« Pas de plan » quand le plan liste trop peu de sites pour les sites visités.', short: 'Sites actifs vus dans la fenêtre de l’activité.' },
      decider: { label: 'Sujets à décider', def: 'Sujets créés par des règles à partir des données du jour : personnes d’abord, puis activité, signaux hors S&E, ressources, mesure.',
        formula: 'Au plus ' + PILOT.maxSubjects + ' sujets ; les autres restent « à l’étude ».', ref: 'Qui et échéance : propositions à valider.',
        limits: 'Un sujet disparaît dès que sa condition n’est plus vraie ; son statut reste enregistré.', short: 'Règles de décision du Pilotage ; qui et échéance proposés.' },
      carte: { label: 'Couverture par région', def: 'Part des sites actifs vus pendant la période, par région.',
        formula: 'Même calcul que la couverture ; Vatovavy et Fitovinany sont additionnés.', ref: 'Classes fixes : ' + RP_COV_BREAKS.map(x => x + ' %').join(', ') + '.',
        limits: 'Cercle rouge : visites avec alerte grave de la période.', short: 'Sites actifs vus par région ; classes fixes, cercle rouge = alertes graves.' },
      aveugles: { label: 'Zones sans visite', def: 'Activité × district avec au moins ' + PILOT.blindSites + ' sites actifs et aucune visite pendant ' + PILOT.blindMonths + ' mois.',
        formula: 'Sites actifs au moins un mois des ' + PILOT.blindMonths + ' derniers mois complets, et visites exploitables de toute organisation.', ref: 'Zone aveugle dès ' + PILOT.blindSites + ' sites actifs.',
        limits: 'Une zone peut être sans visite parce que l’activité n’a pas eu lieu.', short: PILOT.blindSites + ' sites actifs au moins et aucune visite depuis ' + PILOT.blindMonths + ' mois.' },
      domaines: { label: 'Points faibles par domaine', def: 'Score moyen de chaque domaine du formulaire, par activité, sur sa fenêtre.',
        formula: 'Moyenne des visites où au moins une question du domaine est répondue.', ref: scoreRefText(), limits: 'Hachuré de ' + sm + ' à ' + (sl - 1) + ' visites, « – » sous ' + sm + '.', short: 'Score du domaine sur la fenêtre ; ' + scoreRefText() + '.' },
      normes: { label: 'Normes à revoir', def: 'Normes sous ' + THR.mid + ' % au total et dans au moins ' + PILOT.normShare + ' % des groupes (partenaires, ou districts pour SMP et Résilience).',
        formula: '% conforme = moyenne des visites (partiel = ½). Norme observée dès ' + PILOT.normN + ' visites, groupe dès ' + PILOT.normGroupN + '.', ref: 'Repère ' + THR.mid + '.',
        limits: 'Une norme basse partout vient souvent d’une question mal posée : vérifier le formulaire.', short: 'Sous ' + THR.mid + ' % presque partout : décision de programme.' },
      cas: { label: 'Cas graves', def: 'Visites des trois familles d’alertes de niveau 1, chacune pour un destinataire.',
        formula: 'Carré plein : sans suite. Carré blanc : suite enregistrée. Rouge barré : plus de ' + PILOT.oldDays + ' jours. Contour orange : ' + (PILOT.caseAge + 1) + ' à ' + PILOT.oldDays + ' jours.',
        ref: 'Revu à temps : site revisité dans les ' + PILOT.revisitDays + ' jours.', limits: 'Familles proposées, à valider par la protection et la sécurité.', short: 'Un carré par visite ; plein = sans suite, rouge = plus de ' + PILOT.oldDays + ' jours.' },
      signaux: { label: 'Signaux', def: 'Signaux à transmettre hors S&E, chacun à son destinataire.',
        formula: 'Part des visites de la fenêtre où l’alerte est relevée, avec son intervalle à 95 % (Wilson).', ref: 'Point creux : fenêtre précédente.',
        limits: 'Un écart de plus de ' + PILOT.rupture + ' points d’une fenêtre à l’autre est d’abord à vérifier.', short: 'Part des visites, intervalle à 95 % ; point creux = avant.' },
      repas: { label: 'Repas scolaires', def: 'Écoles dont le dernier relevé compte moins de ' + PILOT.mealDays + ' jours de repas sur 20.',
        formula: 'Dernier relevé de chaque école sur la période choisie, avec jours de repas et effectif.', ref: 'Seuil ' + PILOT.mealShare + ' % des écoles.',
        limits: 'Les 20 jours comptent aussi des jours sans école : l’indicateur sous-estime la continuité.', short: 'Écoles sous ' + PILOT.mealDays + ' jours de repas sur 20, seuil ' + PILOT.mealShare + ' %.' },
      participation: { label: 'Participation', def: 'Ce que les visites montrent de la participation, avec l’intervalle à 95 %.',
        formula: 'Présents ÷ attendus, sur les visites qui renseignent les deux.', ref: 'Montré seulement à partir de ' + mn + ' visites.', limits: 'Tonnage et bénéficiaires : MEMS.', short: 'Présents ÷ attendus, à partir de ' + mn + ' visites.' },
      capacite: { label: 'Capacité', def: 'Visites dues par mois selon le niveau de risque des sites, contre visites faites.',
        formula: 'Demande d’un niveau = somme de 1 ÷ intervalle de ses sites actifs, moyenne de l’horizon du plan.', ref: 'Au-delà de ' + fmt(PILOT.cap, 1) + ' fois la capacité : choisir un levier.',
        limits: 'Les jamais visités ont un risque théorique.', short: 'Demande par niveau de risque contre visites faites par mois.' },
      execution: { label: 'Exécution', def: 'Échéances du calendrier de risque tenues, par bureau.',
        formula: 'Échéance tenue si une visite a lieu le mois dû, ou le suivant pour une fréquence de 2 mois ou plus.', ref: 'Repère : taux de tous les bureaux.',
        limits: 'Le niveau de risque d’aujourd’hui est appliqué aux mois passés.', short: 'Échéances tenues ÷ échéances, par bureau.' },
      ajour: { label: 'Sites à jour selon le risque', def: 'Sites actifs dont la dernière visite date de moins que leur intervalle, au dernier mois de la période.',
        formula: 'Sites à jour ÷ sites actifs du niveau.', ref: 'Intervalles de la planification.', limits: 'Un site jamais visité n’est jamais à jour.', short: 'Dernière visite plus récente que l’intervalle du niveau de risque.' },
      orgs: { label: 'Organisations de suivi', def: 'Visites, productivité, positions GPS et notes des agents de chaque organisation.',
        formula: 'Visites par agent et par mois ; GPS à ' + PILOT.gpsKm + ' km au plus ; notes des agents A à D.', ref: 'Barème agent : A dès ' + GRADE_SCALES.agent.A + ', B dès ' + GRADE_SCALES.agent.B + ', C dès ' + GRADE_SCALES.agent.C + '.',
        limits: 'Notes des agents sur toute la période ; aucun agent n’est nommé.', short: 'Visites, GPS proche du site et notes des agents (sans nom).' },
      fiabilite: { label: 'Fiabilité', def: 'Ce qui peut être cité tel quel, et ce qui ne doit pas l’être.',
        formula: 'Citable : chiffres avec leur base. À ne pas citer : mélanges d’activités, questions non fiables.', ref: 'Avis de l’unité S&E.',
        limits: 'Liste à revoir à chaque nouvelle extraction.', short: 'Citable avec sa base ; à ne pas citer : mélanges et questions non fiables.' },
      fScore: { label: 'Score et tendance', def: 'Score moyen de la fenêtre de l’activité, contre sa cible et la fenêtre précédente.',
        formula: 'Moyenne des scores de visite ; part des visites avec alerte grave par mois.', ref: 'Zones : ' + scoreRefText() + '.', limits: 'Non concluant sous ' + mn + ' visites.', short: 'Score de la fenêtre contre la cible ' + THR.good + ' et la fenêtre précédente.' },
      fDom: { label: 'Domaines', def: 'Score de chaque domaine sur la fenêtre de l’activité.', formula: 'Moyenne des visites où le domaine est répondu.', ref: 'Repère ' + THR.good + '.',
        limits: '« – » sous ' + sm + ' visites.', short: 'Score des domaines, du plus faible au plus fort.' },
      fNorm: { label: 'Normes', def: 'Normes qui ont le plus baissé d’une fenêtre à l’autre.', formula: 'Au moins ' + PILOT.normN + ' visites de chaque côté et une baisse d’au moins ' + PILOT.normDrop + ' points.',
        ref: '« partout » : norme basse dans presque tous les groupes.', limits: 'Sans baisse mesurable : les normes les plus basses.', short: 'Baisse d’au moins ' + PILOT.normDrop + ' points, ' + PILOT.normN + ' visites de chaque côté.' },
      fAlert: { label: 'Alertes', def: 'Visites avec au moins une alerte de chaque niveau.', formula: 'Visites avec alerte du niveau ÷ visites de la fenêtre.', ref: ovALERT_TIERS.source + '.',
        limits: 'Les signaux « à confirmer » sont exclus des niveaux.', short: 'Visites avec alerte grave, à vérifier ou de gestion.' },
      fCouv: { label: 'Couverture et partenaires', def: 'Sites actifs vus pendant la fenêtre ; notes des partenaires de mise en œuvre.',
        formula: 'Note = score − pénalité d’alertes, barème A dès ' + GRADE_SCALES.imp.A + ', B dès ' + GRADE_SCALES.imp.B + ', C dès ' + GRADE_SCALES.imp.C + '.', ref: 'Pas de note sous ' + GRADE_SCALES.imp.minN + ' visites.',
        limits: 'Notes calculées sur toute la période du fichier.', short: 'Sites vus dans la fenêtre ; notes des partenaires sur tout le fichier.' },
      retenir: { label: 'À retenir', def: 'Texte calculé, modifiable sur place.', formula: 'Pourquoi le statut, puis la première action proposée.', ref: '', limits: 'Après une mise à jour, un texte modifié est signalé « à revoir ».', short: 'Texte calculé, modifiable ; signalé après une mise à jour.' },
      pmeo: { label: 'Conformité par partenaire', def: 'Score moyen des visites de chaque partenaire, avec son intervalle à 95 %.',
        formula: 'Moyenne ± 1,96 × écart type ÷ √n.', ref: 'Écart démontré seulement si l’intervalle exclut la moyenne de l’activité.', limits: 'Pas de point sous ' + GRADE_SCALES.imp.minN + ' visites.', short: 'Moyenne et intervalle à 95 % ; écart démontré si l’intervalle exclut la moyenne.' },
      resp: { label: 'Ce qui relève du partenaire', def: 'Visites classées par l’alerte la plus imputable : au partenaire, partagée, de contexte.',
        formula: 'Visite « partenaire » dès une alerte qui relève de lui, sinon « partagée », sinon « contexte ».', ref: 'Classement proposé, à valider avec le programme.', limits: 'N’entre pas dans la note.', short: 'Alertes du partenaire, partagées ou de contexte, par visite.' },
      districts: { label: 'Districts', def: 'Score moyen par district, pour les activités sans partenaire renseigné.', formula: 'Un point par district d’au moins ' + sl + ' visites, aire selon le nombre de visites.',
        ref: 'Nommé seulement si l’intervalle exclut la moyenne.', limits: 'Version diffusable : aucun nom.', short: 'Score par district ; nommé si l’intervalle exclut la moyenne.' },
      orgQual: { label: 'Qualité de la collecte', def: 'Trois critères des organisations de suivi, avec leur intervalle à 95 %.',
        formula: 'Fiches exploitables, GPS à ' + PILOT.gpsKm + ' km au plus du site, nom choisi dans la liste.', ref: 'Bandes : seuils des critères des agents.', limits: 'Intervalle de Wilson.', short: 'Taux et intervalle à 95 % ; bandes = seuils des critères agents.' },
      duree: { label: 'Durée des fiches', def: 'Durée médiane entre l’ouverture et la finalisation des fiches de durée normale.',
        formula: 'Médiane des fiches de 3 min à 10 h ; part des fiches finalisées en 24 h.', ref: 'Aucune référence validée.', limits: 'Certaines activités ne donnent pas l’heure de début et de fin.', short: 'Médiane des fiches de durée normale ; aucune référence validée.' },
      agentsNotes: { label: 'Agents par note', def: 'Nombre d’agents par note, par organisation, sans aucun nom.', formula: 'Barème agent A dès ' + GRADE_SCALES.agent.A + ', B dès ' + GRADE_SCALES.agent.B + ', C dès ' + GRADE_SCALES.agent.C + '.',
        ref: 'Pas de note sous ' + GRADE_SCALES.agent.minN + ' ' + GRADE_SCALES.agent.unit + '.', limits: 'Les agents ne sont jamais nommés dans le rapport.', short: 'Agents par note, sans nom ; non noté sous ' + GRADE_SCALES.agent.minN + ' fiches.' },
      partSuivi: { label: 'Part du suivi', def: 'Répartition des fiches entre organisations de suivi.', formula: 'Fiches de l’organisation ÷ fiches de la période.', ref: '', limits: '', short: 'Part des fiches de la période par organisation.' },
      suites: { label: 'Après la revisite', def: 'Cas graves, sites revisités ensuite, et même alerte au passage suivant.', formula: 'Revisite = première visite exploitable du même site à une date postérieure.',
        ref: 'Délai médian entre le cas et la revisite.', limits: 'La revisite est la seule preuve de suite dans le fichier.', short: 'Cas, revisités, même alerte ensuite ; délai médian.' },
      casListe: { label: 'Cas à traiter', def: 'Visites avec alerte grave, les plus anciennes d’abord.', formula: 'Une ligne par visite et par alerte de niveau 1.', ref: 'Statut : registre des cas.',
        limits: 'Aucune donnée de bénéficiaire ; usage interne.', short: 'Alertes graves les plus anciennes, statut du registre.' },
      plans: { label: 'Plans d’action', def: 'Partenaires avec un écart démontré et une part d’alertes qui relève d’eux d’au moins ' + THR.rLow + ' %.',
        formula: 'Constat, action, qui et échéance, modifiables.', ref: 'Échéance proposée : ' + (PILOT_ROUTE.act.days || '') + ' jours.', limits: 'Proposition à discuter avec le partenaire.', short: 'Écart démontré et alertes imputables d’au moins ' + THR.rLow + ' %.' },
      prio: { label: 'Visites prioritaires', def: 'Visites avec alerte grave ou à vérifier, ou score sous ' + THR.mid + '.', formula: 'Graves d’abord, puis à vérifier, puis score le plus bas.', ref: '',
        limits: 'Usage interne.', short: 'Alerte grave ou à vérifier, ou score sous ' + THR.mid + '.' },
      precedent: { label: 'Décisions précédentes', def: 'Sujets de la dernière revue figée, avec leur statut actuel.', formula: 'Le signal persiste si le sujet est encore proposé aujourd’hui.', ref: '',
        limits: 'Rien n’apparaît avant la première revue figée.', short: 'Sujets de la dernière revue figée et statut actuel.' },
      validation: { label: 'Validation', def: 'Noms, fonctions et dates, modifiables.', formula: '', ref: '', limits: '', short: 'Préparé, revu et validé.' },
      methode: { label: 'Méthode et notes', def: 'Définitions de tous les chiffres du rapport.', formula: '', ref: 'Seuils provisoires, à valider.', limits: '', short: 'Définitions des chiffres du rapport.' },
      libre: { label: 'Page libre', def: 'Titre et texte libres.', formula: '', ref: '', limits: '', short: 'Texte libre.' }
    };
  }
  let RP_DEF = rpDefs();
  function rpDefText(key) {
    const d = RP_DEF[key]; if (!d) return '';
    return [d.label, d.def, d.formula ? 'Calcul : ' + d.formula : '', d.ref ? 'Référence : ' + d.ref : '', d.limits ? 'Limites : ' + d.limits : ''].filter(Boolean).join('\n');
  }
  // clé d'explication : infobulle à l'écran, exposant numéroté à l'impression (rpNumber)
  function rpKey(node, key) { if (!node || !RP_DEF[key]) return node; node.setAttribute('data-rp', key); bindTip(node, () => rpDefText(key)); return node; }
  // ---------------------------------------------------------------- modèle : piModel (même calcul que le Pilotage), en cache
  function rpCasesSig() { const c = D.cases && typeof D.cases === 'object' ? D.cases : {}; let s = 0; Object.keys(c).forEach(k => { s += k.length + (+((c[k] || {}).s) || 0); }); return Object.keys(c).length + ':' + s; }
  function rpPlanSig() { const p = CUR.rbmPlan || D.rbmPlan; return p ? String(p.version || 0) + ':' + JSON.stringify(p).length : '0'; }
  function rpKeyNow() {
    return JSON.stringify([piHashKey(), piFiltKey(), F.m0, F.m1, rpK(), rpMode(), JSON.stringify(SESSION.rbm || {}), JSON.stringify(D.rbm || {}).length, rpCasesSig(), SESSION.planPending || 0, rpPlanSig()]);
  }
  // Les textes des sujets contiennent piMask : le mode du rapport est posé pendant le calcul, puis rétabli
  function rpModel() {
    const k = rpKeyNow(); if (RP_CACHE.key === k && RP_CACHE.M) return RP_CACHE.M;
    const prev = SESSION.piMode; let M;
    try { SESSION.piMode = rpMode(); M = piModel(); } finally { SESSION.piMode = prev; }
    RP_CACHE.key = k; RP_CACHE.M = M; RP_CACHE.X = {};
    return M;
  }
  // compléments calculés une fois par modèle
  function rpX(name, fn) { if (!(name in RP_CACHE.X)) RP_CACHE.X[name] = fn(); return RP_CACHE.X[name]; }
  function rpOkBy(M) {
    return rpX('okBy', () => { const m = new Map(); M.ok.forEach(v => { const k = v.act + '|' + v.month; let l = m.get(k); if (!l) m.set(k, l = []); l.push(v); }); return m; });
  }
  // six mois finissant au mois de fin : n, score moyen, part des visites avec alerte grave
  function rpSeries(M, a) {
    return rpX('ser|' + a, () => {
      const by = rpOkBy(M);
      return rpMonthsOf(addMonths(M.T.E, -5), M.T.E).map(m => {
        const all = by.get(a + '|' + m) || [], x = all.filter(v => rpNum(v.score)), g = all.filter(v => ovVT(v)[1].length).length;
        return { m, n: x.length, score: x.length ? mean(x.map(v => v.score)) : null, nAll: all.length, grave: g, gravePct: all.length ? g / all.length * 100 : null };
      });
    });
  }
  function rpWinVisits(M, a, W) { const by = rpOkBy(M); return [].concat.apply([], (W || []).map(m => by.get(a + '|' + m) || [])); }
  // Intervalle de Wilson (proportion) et intervalle d'une moyenne
  function rpWilson(n, N, z) {
    z = z || 1.96; if (!N) return [null, null];
    const p = n / N, z2 = z * z, den = 1 + z2 / N, c = (p + z2 / (2 * N)) / den, h = z * Math.sqrt(p * (1 - p) / N + z2 / (4 * N * N)) / den;
    return [Math.max(0, c - h) * 100, Math.min(1, c + h) * 100];
  }
  function rpMeanCI(values) {
    const x = (values || []).filter(rpNum), n = x.length; if (!n) return { m: null, sd: null, n: 0, lo: null, hi: null };
    const m = x.reduce((s, y) => s + y, 0) / n, sd = n > 1 ? Math.sqrt(x.reduce((s, y) => s + (y - m) * (y - m), 0) / (n - 1)) : 0, se = n ? sd / Math.sqrt(n) : 0;
    return { m, sd, n, lo: m - 1.96 * se, hi: m + 1.96 * se };
  }
  // couverture par région : covCalc par région de site, Vatovavy et Fitovinany additionnés (clé de la carte)
  function rpRegions(M, W, vis) {
    const by = new Map(), names = new Set();
    piSites().forEach(s => { if (s.region) names.add(s.region); });
    const fName = F.region >= 0 ? covNorm(ENGINE.canonRegion(DICT.region[F.region]) || DICT.region[F.region]) : null;
    const m0 = F.m0, m1 = F.m1;
    try {
      if (W && W.length) { F.m0 = W[0]; F.m1 = W[W.length - 1]; }
      names.forEach(nm => {
        if (fName && covNorm(nm) !== fName) return;
        const c = covCalc({ act: F.act, regionName: nm }); if (c.outOfYear || !c.planned) return;
        const k = mapRegKey(nm); let o = by.get(k); if (!o) by.set(k, o = { k, names: [], planned: 0, visited: 0, graves: 0, vis: 0 });
        o.names.push(nm); o.planned += c.planned; o.visited += c.visited;
      });
    } finally { F.m0 = m0; F.m1 = m1; }
    (vis || []).forEach(v => { const o = by.get(mapRegKey(DICT.region[v.region] || '')); if (!o) return; o.vis++; if (ovVT(v)[1].length) o.graves++; });
    const geo = D.geo || [];
    return Array.from(by.values()).map(o => {
      const g = geo.find(f => mapRegKey(f.name) === o.k) || null;
      return Object.assign(o, { geo: g, label: g ? (/-/.test(g.name) && o.names.length > 1 ? g.name : g.name.replace(/-/g, ' ')) : o.names[0], p: o.planned ? o.visited / o.planned * 100 : null });
    }).sort((a, b) => b.planned - a.planned);
  }
  // normes qui ont le plus baissé (fiche activité)
  function rpNormDelta(a, xR, xP) {
    const it = D.items && D.items[a]; if (!it) return [];
    const sR = new Set(xR.map(v => v.i)), sP = new Set(xP.map(v => v.i));
    return it.meta.map((m, j) => {
      let nR = 0, tR = 0, nP = 0, tP = 0;
      (it.vals[j] || []).forEach(p => { if (sR.has(p[0])) { nR++; tR += p[1]; } else if (sP.has(p[0])) { nP++; tP += p[1]; } });
      if (nR < PILOT.normN || nP < PILOT.normN) return null;
      return { m, j, nR, nP, pR: tR / nR, pP: tP / nP, d: tR / nR - tP / nP };
    }).filter(o => o && o.d <= -PILOT.normDrop).sort((x, y) => x.d - y.d);
  }
  // demande mensuelle par niveau de risque (somme = M.load.demand)
  function rpDemandByCat() {
    return rpX('demand', () => {
      let R = null; try { R = rbmCompute(); } catch (e) { R = null; }
      if (!R || !R.scored || !R.months) return null;
      const list = siteFiltered(R.scored), months = R.months;
      return RP_CAT.map(([k, l]) => { const sub = list.filter(s => s.cat === k); return { k, l, v: plDemand(sub, months).avg, n: sub.filter(s => months.some(m => eligible(s, m))).length }; });
    });
  }
  function rpExec(M, W) {
    return rpX('exec|' + (W ? W.join(',') : 'F'), () => { try { return W ? plExecution({ m0: W[0], m1: W[W.length - 1] }) : plExecution(); } catch (e) { return null; } });
  }
  function rpValidated() { return rpX('valid', () => { try { const R = rbmCompute(); return typeof plValidatedExec === 'function' ? plValidatedExec(siteFiltered(R.scored)) : []; } catch (e) { return []; } }); }
  // notes des agents par organisation (sans nom) : D.agents (toute la période) ou fiches filtrées (agXScored)
  function rpAgentGrades(source) {
    return rpX('agGr|' + source, () => {
      const out = new Map(), addG = (org, g) => { let o = out.get(org); if (!o) out.set(org, o = { A: 0, B: 0, C: 0, D: 0, 'N/N': 0 }); o[RP_GRADES.indexOf(g) >= 0 ? g : 'N/N']++; };
      if (source === 'file') { const io = D.agents.cols.indexOf('org'), ig = D.agents.cols.indexOf('grade'); D.agents.rows.forEach(r => addG(String(r[io]), r[ig])); }
      else if (typeof agXScored === 'function') agXScored().R.AG.forEach(a => addG(String(a.org), a.grade));
      return out;
    });
  }
  function rpOrgScored() { return rpX('orgSc', () => { try { return agXScored().R; } catch (e) { return { AG: [], ORG: [] }; } }); }
  // ligne « pourquoi » construite à partir des champs (8 mots au plus)
  function rpWhyShort(r, M) {
    const mE = PI_ML[+M.T.E.slice(5) - 1], parts = [];
    if (r.verdict === 'out') {
      if (r.drop) parts.push('Baisse de ' + fmt(-r.diff, 1) + ' points');
      if (r.low) parts.push((parts.length ? 'sous ' : 'Sous ') + THR.mid);
      if (r.interrupted) parts.push((parts.length ? 'rien en ' : 'Rien en ') + mE);
    } else if (r.verdict === 'inc') {
      if (r.r.n < PILOT.minN) parts.push(r.r.n ? 'Moins de ' + PILOT.minN + ' visites' : 'Aucune visite');
      else parts.push('Moins de ' + PILOT.covFloor + ' % des sites vus');
    } else if (r.verdict === 'watch') {
      parts.push(r.r.mean < THR.good ? 'Sous ' + THR.good : 'Baisse de ' + fmt(-r.diff, 1) + ' points');
      if (r.win.fallback) parts.push('données d’' + rpWin(r.win.R));
      else if (!r.p.n && r.r.n) parts.push('pas de période d’avant');
    } else { parts.push('Au-dessus de la cible'); if (r.win.fallback) parts.push('données d’' + rpWin(r.win.R)); }
    let t = parts.join(', '); const w = t.split(/\s+/); if (w.length > 8) t = w.slice(0, 8).join(' ');
    return t;
  }
  // constat court d'un sujet (90 caractères au plus), à partir des chiffres
  function rpShortFact(s, M) {
    const f = id => M.fams.find(x => x.fam.id === id), mE = PI_ML[+M.T.E.slice(5) - 1];
    if (s.key === 'A1|grave') { const g = f('grave'); if (g) { const open = g.vis.filter(o => !(o.st >= 1)).length; return rpMask(open) + ' visites sans suite, ' + rpMask(g.old) + ' depuis plus de ' + PILOT.oldDays + ' jours'; } }
    if (s.key === 'A2|securite' && s.extra) return rpMask(s.extra.unknown.length) + ' sites sans niveau de sécurité saisi';
    if (s.cat === 'B' && s.row) { const r = s.row; return (r.r.n ? fmt(r.r.mean, 1) + (r.p.n ? ' contre ' + fmt(r.p.mean, 1) : ' sur ' + rpMask(r.r.n) + ' visites') : 'Aucune visite') + (r.interrupted ? ', rien en ' + mE : ''); }
    if (s.key === 'C|repas') return rpMask(M.meals.low) + ' écoles sur ' + rpMask(M.meals.schools) + ' sous ' + PILOT.mealDays + ' jours de repas';
    if (s.key === 'D|capacite') { const L = M.load; if (!L.na && L.ratio !== null) return fmt(L.demand) + ' visites dues par mois pour ' + fmt(L.cap) + ' faites'; return rpMask(M.blind.blind.length) + ' zones sans visite depuis ' + PILOT.blindMonths + ' mois'; }
    const first = String(s.fact || '').split(/(?<=[a-zé%)])\.\s|\s;\s/)[0];
    return rpCut(first.replace(/\.$/, ''), 90);
  }
  function rpDecision(s) { return rpCut(String(s.decision || '').split(';')[0].replace(/\.$/, ''), 90); }
  function rpWinOf(M, tpl) { return rpPartnerTpl(tpl) ? rpMonthsOf(F.m0, F.m1) : M.T.R; }
  // ---------------------------------------------------------------- SVG : 1 unité du viewBox = 1 mm ; un seul SVG par bloc ; jamais innerHTML
  function rpSvg(w, h, aria) {
    const s = sv('svg', { viewBox: '0 0 ' + rpR(w) + ' ' + rpR(h), role: 'img', 'aria-label': aria || '', class: 'rp-svg' });
    s.style.width = rpR(w) + 'mm'; s.style.height = rpR(h) + 'mm'; return s;
  }
  const rpR = x => Math.round(x * 100) / 100;
  function rpE(p, tag, attrs) { const a = {}; Object.keys(attrs || {}).forEach(k => { const v = attrs[k]; if (v === null || v === undefined || v === false) return; a[k] = typeof v === 'number' ? rpR(v) : v; }); const e = sv(tag, a); p.appendChild(e); return e; }
  function rpTxt(p, x, y, s, o) {
    o = o || {}; const a = { x, y, 'font-size': rpR((o.pt || 7.5) * RP_PT), fill: o.fill || RP_C.ink };
    if (o.anchor) a['text-anchor'] = o.anchor; if (o.fw) a['font-weight'] = o.fw; if (o.cls) a.class = o.cls; if (o.base) a['dominant-baseline'] = o.base;
    if (o.halo) { a.stroke = o.haloColor || '#fff'; a['stroke-width'] = 0.7; a['paint-order'] = 'stroke'; a['stroke-linejoin'] = 'round'; }
    const t = rpE(p, 'text', a); t.textContent = String(s); t.style.fontSize = a['font-size'] + 'px'; t.style.fill = a.fill; return t;   // style en ligne : la feuille commune fixe « svg text » à 11 px
  }
  // largeur estimée d'un texte (mm) : sert au retour à la ligne et à éviter les chevauchements
  function rpTW(s, pt, fw) { return String(s).length * (pt || 7.5) * RP_PT * (fw ? 0.56 : 0.52); }
  function rpWrap(s, wmm, pt, max) {
    const words = String(s || '').split(/\s+/).filter(Boolean), lines = []; let cur = '';
    words.forEach(w => { const t = cur ? cur + ' ' + w : w; if (rpTW(t, pt) <= wmm || !cur) cur = t; else { lines.push(cur); cur = w; } });
    if (cur) lines.push(cur);
    if (max && lines.length > max) { const keep = lines.slice(0, max); let l = keep[max - 1]; while (l.length > 1 && rpTW(l + '…', pt) > wmm) l = l.slice(0, -1); keep[max - 1] = l.replace(/[\s,;:]+$/, '') + '…'; return keep; }
    return lines;
  }
  function rpTxtLines(p, x, y, lines, o) { const lh = (o.pt || 7.5) * RP_PT * 1.22; lines.forEach((l, i) => rpTxt(p, x, y + i * lh, l, o)); return lines.length * lh; }
  // définitions communes : motif de hachure (un seul <svg id="rp-defs"> par document, jamais en display:none)
  function rpDefsSvg() {
    const s = sv('svg', { id: 'rp-defs', 'aria-hidden': 'true', class: 'rp-defs', width: '0', height: '0' });
    const d = rpE(s, 'defs', {});
    const p = rpE(d, 'pattern', { id: 'rp-hatch', patternUnits: 'userSpaceOnUse', width: 1.2, height: 1.2, patternTransform: 'rotate(45)' });
    rpE(p, 'rect', { x: 0, y: 0, width: 1.2, height: 1.2, fill: RP_C.none });
    rpE(p, 'line', { x1: 0, y1: 0, x2: 0, y2: 1.2, stroke: RP_C.prev, 'stroke-width': 0.3 });
    return s;
  }
  const RP_HATCH = 'url(#rp-hatch)';
  // pastille de statut dans un SVG : rond, icône blanche, mot à côté (facultatif)
  function rpStDot(p, x, y, k, r, word) {
    const S = rpStat(k); rpE(p, 'circle', { cx: x, cy: y, r: r || 1.3, fill: S.c });
    rpTxt(p, x, y + (r || 1.3) * 0.45, S.ic, { pt: 6, anchor: 'middle', fill: '#fff', fw: 600 });
    if (word) rpTxt(p, x + (r || 1.3) + 1, y + 0.9, word, { pt: 7, fill: S.tx });
  }
  // rpGauge : barre-jauge horizontale, échelle fixe 0 → max
  function rpGaugeG(p, x, y, w, h, v, max, o) {
    o = o || {}; const g = rpE(p, 'g', {}), st = o.n !== undefined ? rpN(o.n) : 'ok';
    if (st === 'none' || v === null || v === undefined || isNaN(v)) { rpE(g, 'rect', { x, y, width: w, height: h, rx: 0.6, fill: RP_C.track }); rpTxt(g, x + w / 2, y + h * 0.8, '–', { pt: 7, anchor: 'middle', fill: RP_C.sub }); return g; }
    rpE(g, 'rect', { x, y, width: w, height: h, rx: 0.6, fill: RP_C.track });
    if (o.zones) [[0, THR.mid, 'bad'], [THR.mid, THR.good, 'mid'], [THR.good, max, 'good']].forEach(([a, b, k]) => rpE(g, 'rect', { x: x + w * a / max, y, width: w * (b - a) / max, height: h, fill: rpStat(k).c, 'fill-opacity': 0.12 }));
    const vw = Math.max(0, Math.min(1, v / max)) * w;
    const col = st === 'low' ? RP_HATCH : o.color || (o.thr ? rpStat(rpCls(v)).c : RP_C.blue);
    const bh = o.zones ? h * 0.5 : h, by = o.zones ? y + h * 0.25 : y;
    if (vw > 0) rpE(g, 'rect', { x, y: by, width: Math.max(vw, 0.6), height: bh, rx: 0.6, fill: o.zones && st !== 'low' ? RP_C.ink : col });
    if (o.prev !== undefined && o.prev !== null && !isNaN(o.prev)) {
      const px = x + Math.max(0, Math.min(1, o.prev / max)) * w; rpE(g, 'line', { x1: px, x2: px, y1: y - 0.8, y2: y + h + 0.8, stroke: RP_C.prev, 'stroke-width': 0.3 });
      if (o.prevLabel) rpTxt(g, px, y + h + 2.6, o.prevLabel, { pt: 6.5, anchor: px > x + w * 0.8 ? 'end' : 'middle', fill: RP_C.sub });
    }
    if (o.ref !== undefined && o.ref !== null) {
      const rx = x + Math.max(0, Math.min(1, o.ref / max)) * w; rpE(g, 'line', { x1: rx, x2: rx, y1: y - 1, y2: y + h + 1, stroke: RP_C.ink, 'stroke-width': 0.5 });
      if (o.refLabel) rpTxt(g, rx, y - 1.5, o.refLabel, { pt: 6.5, anchor: rx > x + w * 0.85 ? 'end' : rx < x + w * 0.15 ? 'start' : 'middle', fill: RP_C.ink });
    }
    return g;
  }
  // rpSpark : courbe sur 6 mois, échelle fixe ; plein ≥ SMALL_N.low, creux de SMALL_N.min à low − 1, rien dessous
  function rpSparkG(p, x, y, w, h, series, o) {
    o = o || {}; const g = rpE(p, 'g', { class: 'rp-spark' }), pct_ = o.kind === 'pct', lo = pct_ ? 0 : 50, hi = 100;
    const volH = o.vol === false ? 0 : Math.min(2.5, h * 0.22), ph = h - volH - (o.vol === false ? 0 : 0.8), n = series.length;
    const X = i => x + (n <= 1 ? w / 2 : 1.2 + i * (w - 2.4 - (o.lastLabel === false ? 0 : 0)) / (n - 1)), Y = s => y + ph - (Math.max(lo, Math.min(hi, s)) - lo) / (hi - lo) * ph;
    const win = new Set(o.win || []);
    series.forEach((s, i) => { if (win.has(s.m)) { const cw = n > 1 ? (w - 2.4) / (n - 1) : w; rpE(g, 'rect', { x: X(i) - cw / 2, y, width: cw, height: ph, fill: RP_C.shade }); } });
    if (!pct_) { const ry = Y(THR.good); rpE(g, 'line', { x1: x, x2: x + w, y1: ry, y2: ry, stroke: RP_C.prev, 'stroke-width': 0.25, 'stroke-dasharray': '0.8 0.6' }); if (o.refLabel) rpTxt(g, x + w + 0.6, ry + 0.8, String(THR.good), { pt: 6, fill: RP_C.sub }); }
    const val = s => pct_ ? s.gravePct : s.score, nn = s => pct_ ? s.nAll : s.n;
    let d = '';
    series.forEach((s, i) => { const prev = series[i - 1]; const ok = rpN(nn(s)) !== 'none' && rpNum(val(s)); if (!ok) return; const pOk = prev && rpN(nn(prev)) !== 'none' && rpNum(val(prev)); d += (pOk ? 'L' : 'M') + rpR(X(i)) + ' ' + rpR(Y(val(s))); });
    if (d) rpE(g, 'path', { d, fill: 'none', stroke: RP_C.ink, 'stroke-width': 0.35, 'stroke-linejoin': 'round' });
    let lastI = -1;
    series.forEach((s, i) => {
      const st = rpN(nn(s)); if (st === 'none' || !rpNum(val(s))) return; lastI = i;
      const c = rpE(g, 'circle', { cx: X(i), cy: Y(val(s)), r: 0.9, fill: st === 'low' ? '#fff' : RP_C.ink, stroke: st === 'low' ? RP_C.sub : RP_C.ink, 'stroke-width': 0.3, 'data-n': nn(s), 'data-m': s.m, class: 'rp-pt' + (st === 'low' ? ' rp-pt-low' : '') });
      bindTip(c, () => piWin([s.m]) + ' : ' + (pct_ ? rpPct(s.grave, s.nAll, 1) + ' des visites avec alerte grave (' + rpNN(s.grave, s.nAll) + ')' : 'score ' + fmt(s.score, 1) + ' sur ' + rpMask(s.n) + ' visites') + (st === 'low' ? ', indicatif' : ''));
    });
    if (lastI >= 0 && o.lastLabel !== false) { const s = series[lastI]; rpTxt(g, X(lastI) + (lastI === n - 1 ? -0.4 : 1.3), Y(val(s)) - 1.3, pct_ ? pct(val(s), 0) : fmt(val(s), 0), { pt: 6.5, anchor: lastI === n - 1 ? 'end' : 'start', fill: RP_C.ink, halo: true }); }
    if (volH) {
      const vm = o.volMax || Math.max(1, ...series.map(nn));
      series.forEach((s, i) => { const bw = Math.min(2.4, (w - 2.4) / Math.max(1, n - 1) * 0.55), bh = nn(s) ? Math.max(0.3, nn(s) / vm * volH) : 0; if (bh) rpE(g, 'rect', { x: X(i) - bw / 2, y: y + h - bh, width: bw, height: bh, fill: RP_C.vol }); });
      if (o.volLabel) rpTxt(g, x + w + 0.6, y + h, fmt(vm), { pt: 5.5, fill: RP_C.sub });
    }
    return g;
  }
  // rpDotRow : point plein (valeur), moustache (intervalle), point creux gris (avant) et flèche
  function rpDotRowG(p, ax, y, aw, lo, hi, r, o) {
    o = o || {}; const g = rpE(p, 'g', {}), X = v => ax + (Math.max(lo, Math.min(hi, v)) - lo) / (hi - lo) * aw;
    rpE(g, 'line', { x1: ax, x2: ax + aw, y1: y, y2: y, stroke: RP_C.track, 'stroke-width': 0.3 });
    if (r.none) { rpTxt(g, ax + 1, y + 0.9, 'moins de ' + SMALL_N.min + ' visites', { pt: 6.5, fill: RP_C.sub }); return g; }
    if (rpNum(r.lo) && rpNum(r.hi)) rpE(g, 'line', { x1: X(r.lo), x2: X(r.hi), y1: y, y2: y, stroke: RP_C.ink, 'stroke-width': 0.3 });
    if (rpNum(r.prev) && !o.noPrev) {
      rpE(g, 'circle', { cx: X(r.prev), cy: y, r: 0.9, fill: '#fff', stroke: RP_C.prev, 'stroke-width': 0.3 });
      if (o.arrow && Math.abs(X(r.v) - X(r.prev)) > 2.6) { const dir = X(r.v) > X(r.prev) ? 1 : -1, x1 = X(r.prev) + dir * 1.1, x2 = X(r.v) - dir * 1.4; rpE(g, 'line', { x1, x2, y1: y - 1.6, y2: y - 1.6, stroke: RP_C.sub, 'stroke-width': 0.2 }); rpE(g, 'path', { d: 'M' + rpR(x2) + ' ' + rpR(y - 1.6) + 'l' + rpR(-dir * 0.7) + ' -0.45 v0.9 z', fill: RP_C.sub }); }
    }
    rpE(g, 'circle', { cx: X(r.v), cy: y, r: 1.1, fill: r.low ? '#fff' : (r.color || RP_C.ink), stroke: r.color || RP_C.ink, 'stroke-width': 0.3 });
    return g;
  }
  function rpAxisG(p, ax, y, aw, lo, hi, ticks, unit) {
    const g = rpE(p, 'g', {}); ticks.forEach(t => { const x = ax + (t - lo) / (hi - lo) * aw; rpTxt(g, x, y, fmt(t) + (unit || ''), { pt: 6, anchor: t === lo ? 'start' : t === hi ? 'end' : 'middle', fill: RP_C.sub }); }); return g;
  }
  function rpRefLineG(p, x, y0, y1, label, o) {
    o = o || {}; const g = rpE(p, 'g', {});
    rpE(g, 'line', { x1: x, x2: x, y1: y0, y2: y1, stroke: o.color || RP_C.ink, 'stroke-width': o.dash ? 0.3 : 0.4, 'stroke-dasharray': o.dash ? '0.9 0.7' : null });
    if (label) rpTxt(g, x, y0 - 0.8, label, { pt: 6.5, anchor: o.anchor || 'middle', fill: o.color || RP_C.ink });
    return g;
  }
  // rpStackH : barre empilée en comptes ; étiquette dans le segment s'il fait au moins 7 mm
  function rpStackHG(p, x, y, w, h, segs, o) {
    o = o || {}; const g = rpE(p, 'g', {}), tot = o.max || sum(segs.map(s => s.n)) || 1; let cx = x; const out = [], labs = [];
    segs.forEach((s, i) => {
      const sw = s.n / tot * w; if (sw <= 0) return;
      const col = s.color || RP_C.seg[i % RP_C.seg.length];
      rpE(g, 'rect', { x: cx, y, width: sw, height: h, fill: col, stroke: '#fff', 'stroke-width': 0.2 });
      const lab = (s.label ? s.label + ' ' : '') + (s.txt !== undefined ? s.txt : rpMask(s.n));
      if (sw >= Math.max(7, rpTW(lab, 6.5) + 1.2)) labs.push([cx + sw / 2, lab, s.dark ? '#fff' : RP_C.ink, col]);
      else out.push(lab);
      cx += sw;
    });
    // le repère passe sous les étiquettes (halo de la couleur du segment) : il ne barre jamais un chiffre
    if (o.tick) { const tx = x + Math.min(1, o.tick.v / tot) * w; rpE(g, 'line', { x1: tx, x2: tx, y1: y - 1.2, y2: y + h + 1.2, stroke: RP_C.ink, 'stroke-width': 0.5 }); if (o.tick.label) rpTxt(g, tx, y - 1.8, o.tick.label, { pt: 6.5, anchor: tx > x + w * 0.7 ? 'end' : 'start', fill: RP_C.ink }); }
    labs.forEach(([lx, lab, fill, col]) => rpTxt(g, lx, y + h / 2 + 0.85, lab, { pt: 6.5, anchor: 'middle', fill, halo: !!o.tick, haloColor: col }));
    if (out.length && o.under !== false) rpTxt(g, x, y + h + 2.8, out.join(', '), { pt: 6.5, fill: RP_C.sub });
    return { g, out };
  }
  // rpBar100 : part à 100 %, pourcentage et n / N à droite
  function rpBar100G(p, x, y, w, h, parts, o) {
    o = o || {}; const g = rpE(p, 'g', {}), N = o.N || sum(parts.map(s => s.n)); let cx = x;
    rpE(g, 'rect', { x, y, width: w, height: h, fill: RP_C.track });
    parts.forEach((s, i) => { const sw = N ? s.n / N * w : 0; if (sw > 0) rpE(g, 'rect', { x: cx, y, width: sw, height: h, fill: s.color || RP_C.seg[(i + 1) % RP_C.seg.length] }); cx += sw; });
    if (o.label) rpTxt(g, x + w + 1.5, y + h - 0.6, o.label, { pt: 7, fill: RP_C.ink });
    return g;
  }
  // rpRing : anneau (donut). frac ∈ [0,1] borné ; piste grise + arc coloré depuis le haut, sens horaire.
  // o.center (gros texte centre), o.sub (petit texte sous le centre), o.color, o.track, o.aria. Jamais de fraction > 1 (couverture plafonnée).
  function rpRingG(p, cx, cy, r, thick, frac, o) {
    o = o || {}; const g = rpE(p, 'g', {}), C = 2 * Math.PI * r, f = Math.max(0, Math.min(1, rpNum(frac) ? frac : 0));
    rpE(g, 'circle', { cx, cy, r, fill: 'none', stroke: o.track || RP_C.track, 'stroke-width': thick });
    if (f > 0) { const c = rpE(g, 'circle', { cx, cy, r, fill: 'none', stroke: o.color || RP_C.blue, 'stroke-width': thick, 'stroke-dasharray': rpR(C * f) + ' ' + rpR(C * (1 - f) + 0.001), 'stroke-linecap': f < 1 ? 'round' : 'butt' }); c.setAttribute('transform', 'rotate(-90 ' + rpR(cx) + ' ' + rpR(cy) + ')'); }
    if (o.center !== undefined) rpTxt(g, cx, cy + (o.sub ? -0.1 : 1.3), String(o.center), { pt: o.centerPt || 9, anchor: 'middle', fw: 600, fill: o.centerFill || RP_C.ink, cls: 'rp-val' });
    if (o.sub) rpTxt(g, cx, cy + 3.2, String(o.sub), { pt: 5.6, anchor: 'middle', fill: RP_C.sub });
    return g;
  }
  // ---------------------------------------------------------------- éléments communs des pages
  // Contexte d'un bloc : C = { M, tpl, o (réglages du bloc), a (activité), xs (lignes de l'export .xlsx), page }
  function rpX_(C, label, value, base) { C.xs.push([C.blockTitle || '', label, value === null || value === undefined ? '' : String(value), base || '']); }
  function rpInfo(key) { const b = infoBtn(rpDefText(key)); b.classList.add('rp-scr'); return b; }
  function rpBase(text, key) { const n = el('div', { class: 'rp-base', text }); if (key) rpKey(n, key); return n; }
  function rpVerdict(k) { const d = PI_VD[k]; return el('span', { class: 'pi-vd rp-st pi-' + d[2], text: d[0] + ' ' + d[1] }); }
  function rpStPill(k, word) { const S = rpStat(k); return el('span', { class: 'rp-st rp-pill rp-pill-' + k, text: S.ic + ' ' + word }); }
  function rpWithMode(fn) { const prev = SESSION.piMode; try { SESSION.piMode = rpMode(); return fn(); } finally { SESSION.piMode = prev; } }
  function rpCtxPilot(M) {
    PI_LAST = M;
    PI_CTX = { win: piWin(M.T.R) + ' comparée à ' + piWin(M.T.P), ver: 'données du ' + dFrUI((D.period || [])[0]) + ' au ' + dFrUI(M.T.dataEnd) + ', version ' + piHashTxt(piHashNow()) };
  }
  function rpOpen(M, fn) { return () => { rpCtxPilot(M); rpWithMode(fn); }; }
  function rpClickable(node, fn, label) {
    node.classList.add('rp-clk'); node.setAttribute('tabindex', '0'); node.setAttribute('role', 'button'); if (label) node.setAttribute('aria-label', label + ' : ouvrir le détail');
    node.addEventListener('click', ev => { if (ev.target.closest('.ed,button,a,input')) return; ev.stopPropagation(); fn(); });
    node.addEventListener('keydown', ev => { if (ev.target === node && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); fn(); } });
    return node;
  }
  function rpSvgClick(g, fn, label) {
    g.setAttribute('class', ((g.getAttribute('class') || '') + ' rp-clk').trim()); g.setAttribute('tabindex', '0'); g.setAttribute('role', 'button'); if (label) g.setAttribute('aria-label', label + ' : ouvrir le détail');
    g.addEventListener('click', ev => { ev.stopPropagation(); fn(); });
    g.addEventListener('keydown', ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); fn(); } });
    return g;
  }
  // rpTile : tuile DOM (3 colonnes) — valeur, libellé, base ; jauge facultative
  function rpTile(value, label, base, opt) {
    opt = opt || {};
    const tv = el('div', { class: 'rp-tv rp-val', text: value }); if (opt.status) tv.style.color = rpStat(opt.status.k).c;
    const tl = el('div', { class: 'rp-tl' }, [el('span', { text: label }), opt.status ? rpStPill(opt.status.k, opt.status.w) : null]);
    const t = el('div', { class: 'rp-tile' }, [tv, tl, rpBase(base), opt.gauge || null]);   // la jauge vient en dernier : valeur, libellé et base restent alignés d'une tuile à l'autre
    if (opt.rp) { rpKey(tl, opt.rp); tl.appendChild(rpInfo(opt.rp)); }
    if (opt.open) rpClickable(t, opt.open, label);
    return t;
  }
  function rpGaugeSvg(v, max, o, size) {
    const S = { mini: [18, 2.6], std: [36, 3], large: [80, 6] }[size || 'std'], top = o && (o.refLabel || o.prevLabel) ? 3.4 : 1.2, bot = o && o.prevLabel ? 3.4 : 1.2;
    const s = rpSvg(S[0] + 2, S[1] + top + bot, (o && o.aria) || ''); rpGaugeG(s, 1, top, S[0], S[1], v, max, o); return s;
  }

  // ---------------------------------------------------------------- en-tête et pied
  function rpTitleDefault(M, tpl) {
    if (tpl === 'bailleur') return 'Rapport bailleur, ' + rpWin(rpMonthsOf(F.m0, F.m1));
    if (tpl === 'partenaires') return 'Revue partenaires, ' + rpWin(rpMonthsOf(F.m0, F.m1));
    if (tpl === 'pilotage') return 'Suivi des performances des activités, ' + piWin(M.T.R);
    if (tpl === 'synthese') return 'Synthèse du suivi, ' + piWin(M.T.R);
    if (tpl === 'trimestre') return 'Revue trimestrielle, ' + piWin(M.T.R);
    if (tpl === 'activite') { const a = rpActSel(M); return 'Fiche activité — ' + (a && ACT[a] ? ACT[a].label : a || '') + ', ' + piWin(M.T.R); }
    if (tpl === 'mensuelle') return M.T.k === 1 ? 'Revue de ' + piWin(M.T.R) : 'Revue ' + piWin(M.T.R);
    return 'Suivi de processus, ' + piWin(M.T.R);
  }
  function rpTitleEd(M, tpl, tag, cls_) { const n = ovEd(tag, 'rp-title-' + tpl, rpTitleDefault(M, tpl), cls_); n.addEventListener('input', () => { if (n.textContent.length > 120) n.textContent = n.textContent.slice(0, 120); }); n.addEventListener('blur', () => rpSoon()); return n; }
  function rpHead(C) {
    const M = C.M, tpl = C.tpl, mode = rpMode(), Cm = M.complete, part = rpPartnerTpl(tpl);
    const period = part ? 'Période ' + rpWin(rpMonthsOf(F.m0, F.m1)) + ', celle des filtres. ' : 'Comparé à ' + piWin(M.T.P) + '. ';
    const reader = (RP_TPL[tpl] || {}).reader || '';
    const meta = el('p', { class: 'rp-meta' }, [period + 'Données au ' + dFrUI(M.T.dataEnd) + '. ' + (filtersAny() ? rpCap(filtersActiveText()) : 'Aucun filtre') + '. Version ', el('span', { class: 'rp-hashv', text: piHashTxt(piHashNow()) }), '.']);
    const hd = el('header', { class: 'rp-head' }, [
      el('div', { class: 'rp-hl1' }, [rpTitleEd(M, tpl, 'h1', 'rp-title'), el('span', { class: 'pi-diff pi-diff-' + mode, text: mode === 'diff' ? 'Diffusable' : 'Usage interne' })]),
      reader ? el('p', { class: 'rp-sublead', text: reader }) : null,
      meta,
      !part && Cm.incomplete ? el('p', { class: 'rp-alert' }, rpCap(piWin([Cm.Ml])) + ' incomplet, non compté (' + rpMask(Cm.n) + ' visites)') : null]);
    rpX_(C, 'Titre', rpTitleDefault(M, tpl), ''); rpX_(C, 'Période', tpl === 'partenaires' ? rpWin(rpMonthsOf(F.m0, F.m1)) : piWin(M.T.R) + ' contre ' + piWin(M.T.P), ''); rpX_(C, 'Filtres', filtersActiveText(), '');
    return hd;
  }
  function rpPageHead(title, C, sub) { return el('header', { class: 'rp-ph' }, [el('h2', { class: 'rp-ptitle', text: title }), sub ? el('span', { class: 'rp-psub', text: sub }) : null]); }
  function rpFoot(C) {
    return el('footer', { class: 'rp-foot' }, [el('span', null, ['Suivi de processus · PAM Madagascar · version ', el('span', { class: 'rp-hashv', text: piHashTxt(piHashNow()) })]),
      el('span', { class: 'rp-fc', text: rpDiff() ? 'Agrégé, cases de moins de ' + PILOT.mask + ' masquées' : 'Usage interne, ne pas transférer' }), el('span', { class: 'rp-pn', text: '' })]);
  }
  // en-tête de bloc : titre (1 à 3 mots), clé d'explication, « i » à l'écran
  function rpBlockEl(C, def, kids) {
    const h = el('h3', { class: 'rp-bh' }, [el('span', { class: 'rp-bt', text: def.title })]);
    if (def.rp) { rpKey(h, def.rp); h.appendChild(rpInfo(def.rp)); }
    const b = el('section', { class: 'rp-block rp-c' + (def.span || 12), 'data-blk': def.id, 'data-type': def.type, 'data-prio': String(def.prio || 1) }, [h].concat(kids.filter(Boolean)));
    if (def.movable) b.classList.add('rp-mov');
    return b;
  }

  // ---------------------------------------------------------------- PAGE PARTAGÉE « Situation »
  function rpBlkFigures(C) {
    const M = C.M, rel = M.rel, cov = M.cov.R, covP = M.cov.P, g = M.fams.find(x => x.fam.id === 'grave'), L = M.load;
    const covOk = cov && !cov.outOfYear && cov.planned > 0, pR = covOk ? cov.visited / cov.planned * 100 : null, pP = covP && covP.planned ? covP.visited / covP.planned * 100 : null;
    const tiles = [
      rpTile(rpMask(M.okR.length), 'Visites', 'sur ' + rpMask(rel.validR[1]) + ' reçues, avant ' + rpMask(M.okP.length), { rp: 'visites', open: rpOpen(M, () => piBannerDrawer(M)) }),
      rpTile(covOk ? pct(pR, 1) : 'Pas de plan', 'Sites vus', covOk ? rpNN(cov.visited, cov.planned) + ' sites actifs' : 'aucun site actif au plan',
        { rp: 'couverture', open: rpOpen(M, () => piCovDrawer(M)), gauge: covOk ? rpGaugeSvg(pR, 100, { prev: pP, prevLabel: pP !== null ? 'avant ' + pct(pP, 1) : '', aria: 'Sites vus ' + pct(pR, 1) + ', ' + rpNN(cov.visited, cov.planned) }, 'std') : null })
    ];
    if (!covOk) tiles[1].querySelector('.rp-tv').classList.add('rp-mutedv');
    if (g) {
      const open = g.vis.filter(o => !(o.st >= 1)), late = open.filter(o => piAge(o.v.date) > PILOT.caseAge).length;
      tiles.push(rpTile(rpMask(g.noSt), 'Cas graves sans suite', 'sur ' + rpMask(g.n) + ' visites, ' + rpMask(g.old) + ' depuis plus de ' + PILOT.oldDays + ' jours',
        { rp: 'graves', status: late ? { k: 'bad', w: 'en retard' } : null, open: rpOpen(M, () => piFamDrawer(M, g)) }));
      rpX_(C, 'Cas graves sans suite', rpMask(g.noSt), 'sur ' + rpMask(g.n) + ' visites');
    }
    const lOk = !L.na && L.ratio !== null;
    tiles.push(rpTile(lOk ? '× ' + fmt(L.ratio, 1) : 'n.c.', 'Charge du plan', lOk ? fmt(L.demand) + ' dues par mois, ' + fmt(L.cap) + ' faites' : 'planification indisponible',
      { rp: 'charge', status: lOk && L.ratio > PILOT.cap ? { k: 'bad', w: 'au-delà de la capacité' } : null, open: rpOpen(M, () => piLoadDrawer(M)) }));
    rpX_(C, 'Visites', rpMask(M.okR.length), 'sur ' + rpMask(rel.validR[1]) + ' reçues, avant ' + rpMask(M.okP.length));
    rpX_(C, 'Sites vus', covOk ? pct(pR, 1) : 'Pas de plan', covOk ? rpNN(cov.visited, cov.planned) : '');
    rpX_(C, 'Charge du plan', lOk ? fmt(L.ratio, 1) : 'n.c.', lOk ? fmt(L.demand) + ' dues, ' + fmt(L.cap) + ' faites' : '');
    return el('div', { class: 'rp-tiles' }, tiles);
  }
  // S3 : matrice des activités (un seul SVG), ordre fixe ACTS
  function rpBlkActs(C) {
    const M = C.M, rows = M.rows; if (!rows.length) return null;
    const why = C.o.why !== 'no', curve = C.o.curve || 'score';
    const W = { act: 28, st: 24, sc: 18, sp: why ? 36 : 74, cov: 26, gr: 16, why: why ? 38 : 0 }, RH = 11, HH = 5;
    const xs = []; let acc = 0; ['act', 'st', 'sc', 'sp', 'cov', 'gr', 'why'].forEach(k => { xs[k] = acc; acc += W[k]; });
    const H = HH + rows.length * RH + 1, s = rpSvg(RP_SZ.usable, H, 'Activités : statut, score, six derniers mois, sites vus et cas graves pour ' + rows.length + ' activités');
    const hd = [['act', 'Activité'], ['st', 'Statut'], ['sc', 'Score'], ['sp', curve === 'score' ? 'Six mois' : 'Visites par mois'], ['cov', 'Sites vus'], ['gr', 'Graves']].concat(why ? [['why', 'Pourquoi']] : []);
    hd.forEach(([k, t]) => rpTxt(s, xs[k] + (k === 'sc' || k === 'gr' ? W[k] - 1 : 1), HH - 1.4, t, { pt: 7, fill: RP_C.sub, anchor: k === 'sc' || k === 'gr' ? 'end' : 'start' }));
    if (curve === 'score') { const lx = xs.sp + W.sp - 3; rpE(s, 'line', { x1: lx - 9, x2: lx - 5, y1: HH - 2.2, y2: HH - 2.2, stroke: RP_C.prev, 'stroke-width': 0.25, 'stroke-dasharray': '0.8 0.6' }); rpTxt(s, lx - 4.3, HH - 1.4, String(THR.good), { pt: 6, fill: RP_C.sub }); }
    rpE(s, 'line', { x1: 0, x2: RP_SZ.usable, y1: HH, y2: HH, stroke: RP_C.line, 'stroke-width': 0.25 });
    const volMax = Math.max(1, ...rows.map(r => Math.max(...rpSeries(M, r.a).map(p => p.n))));
    rows.forEach((r, i) => {
      const y = HH + i * RH, g = rpE(s, 'g', { class: 'rp-row', 'data-act': r.a }), cy = y + RH / 2 + 0.9, d = PI_VD[r.verdict], S = rpStat(d[2]);
      if (i) rpE(g, 'line', { x1: 0, x2: RP_SZ.usable, y1: y, y2: y, stroke: RP_C.line, 'stroke-width': 0.2 });
      rpE(g, 'rect', { x: 0, y: y + 0.2, width: RP_SZ.usable, height: RH - 0.4, fill: '#fff', 'fill-opacity': 0, class: 'rp-hit' });
      rpTxt(g, xs.act + 1, cy, ACT[r.a].short, { pt: 8, fw: 600 });
      const pw = Math.min(W.st - 1, rpTW(d[0] + ' ' + d[1], 7) + 3);
      rpE(g, 'rect', { x: xs.st + 0.5, y: cy - 3.1, width: pw, height: 4.2, rx: 2.1, fill: S.bg });
      rpTxt(g, xs.st + 2, cy - 0.2, d[0] + ' ' + d[1], { pt: 7, fill: S.tx, fw: 600, cls: 'rp-st' });
      if (r.r.n) {
        const low = r.r.n < PILOT.minN;
        if (low) rpE(g, 'rect', { x: xs.sc + 1, y: cy - 3.4, width: W.sc - 1.5, height: 4.6, fill: RP_HATCH, 'fill-opacity': 0.7 });
        rpTxt(g, xs.sc + W.sc - 1, cy - 0.6, fmt(r.r.mean, 1) + (r.win.fallback ? '†' : ''), { pt: 8.5, fw: 600, anchor: 'end', fill: low ? RP_C.sub : RP_C.ink, cls: 'rp-val' });
        if (r.diff !== null) rpTxt(g, xs.sc + W.sc - 1, cy + 2.6, (r.diff < 0 ? '↓' : r.diff > 0 ? '↑' : '') + fmt(Math.abs(r.diff), 1), { pt: 6.5, anchor: 'end', fill: r.bothN && Math.abs(r.diff) >= PILOT.drop ? (r.diff < 0 ? RP_C.st.bad.tx : RP_C.st.good.tx) : RP_C.sub, cls: 'rp-base' });
      } else rpTxt(g, xs.sc + W.sc - 1, cy, '–', { pt: 8, anchor: 'end', fill: RP_C.sub });
      const ser = rpSeries(M, r.a);
      if (curve === 'score') rpSparkG(g, xs.sp + 1, y + 1.2, W.sp - 4, RH - 2.4, ser, { win: r.win.R, volMax, volLabel: i === rows.length - 1 });
      else { const vm = volMax; ser.forEach((p, j) => { const bw = (W.sp - 6) / ser.length, bh = p.n / vm * (RH - 4); rpE(g, 'rect', { x: xs.sp + 1 + j * bw + bw * 0.2, y: y + RH - 1.5 - bh, width: bw * 0.6, height: Math.max(bh, p.n ? 0.3 : 0), fill: (r.win.R.indexOf(p.m) >= 0 ? RP_C.blue : RP_C.vol), 'data-n': p.n }); }); rpTxt(g, xs.sp + W.sp - 2, y + 3, rpMask(ser[ser.length - 1].n), { pt: 6.5, anchor: 'end', fill: RP_C.sub }); }
      if (r.covOk) {
        rpTxt(g, xs.cov + 1, cy - 1.6, rpNN(r.cov.visited, r.cov.planned), { pt: 7, fill: RP_C.ink, cls: 'rp-base' });
        rpGaugeG(g, xs.cov + 1, cy + 0.2, 18, 2.6, r.covP100, 100, {});
      } else rpTxt(g, xs.cov + 1, cy, 'Pas de plan', { pt: 7, fill: RP_C.sub });
      const gv = r.detect ? rpMask(r.graves.length) : 'n.d.'; rpTxt(g, xs.gr + W.gr - 1, cy, gv, { pt: gv.length > 4 ? 6.5 : 8, anchor: 'end', fill: r.detect && r.graves.length ? RP_C.ink : RP_C.sub });
      if (why) rpTxtLines(g, xs.why + 1, cy - (rpWrap(rpWhyShort(r, M), W.why - 2, 7, 2).length > 1 ? 1.4 : 0), rpWrap(rpWhyShort(r, M), W.why - 2, 7, 2), { pt: 7, fill: RP_C.sub, cls: 'rp-auto' });
      rpSvgClick(g, rpOpen(M, () => piActDrawer(M, r)), ACT[r.a].short);
      bindTip(g, () => ACT[r.a].label + '\n' + d[0] + ' ' + d[1] + ' : ' + r.why.join(', ') + '\nScore ' + (r.r.n ? fmt(r.r.mean, 1) + ' sur ' + fmt(r.r.n) + ' visites, ' + piWin(r.win.R) : '–') + (r.p.n ? '\nAvant ' + fmt(r.p.mean, 1) + ' sur ' + fmt(r.p.n) + ' visites, ' + piWin(r.win.P) : '') + (r.covOk ? '\nSites vus ' + nOf(r.cov.visited, r.cov.planned, 'sites actifs') : ''));
      rpX_(C, ACT[r.a].short + ' statut', d[1], ''); rpX_(C, ACT[r.a].short + ' score', r.r.n ? fmt(r.r.mean, 1) : '', r.r.n ? rpMask(r.r.n) + ' visites, ' + piWin(r.win.R) + (r.p.n ? ', avant ' + fmt(r.p.mean, 1) : '') : '');
      rpX_(C, ACT[r.a].short + ' sites vus', r.covOk ? rpNN(r.cov.visited, r.cov.planned) : 'Pas de plan', ''); rpX_(C, ACT[r.a].short + ' graves', r.detect ? rpMask(r.graves.length) : 'n.d.', '');
    });
    const fb = rows.filter(r => r.win.fallback);
    const foot = fb.length ? rpBase('† Fenêtre ' + fb.map(r => ACT[r.a].short + ' ' + rpWin(r.win.R)).join(', ') + ', la dernière exploitable.') : null;
    const small = M.acts.filter(a => !rows.some(r => r.a === a));
    return [s, foot, small.length ? rpBase(small.map(a => ACT[a].short).join(', ') + ' : aucune visite ni site actif.') : null];
  }
  // S4 : à décider (tableau sans fond coloré) ; chaque cellule tient sur 2 lignes, le texte complet est dans l'infobulle et le tiroir
  function rpRoleShort(role) { const p = String(role || '').split(', '); let t = p[0]; for (let i = 1; i < p.length; i++) { if ((t + ', ' + p[i]).length > 30) return t + '…'; t += ', ' + p[i]; } return t; }
  function rpDueShort(route) { if (route.days) return piDue(route); if (route === PILOT_ROUTE.secu) return 'missions de ' + PI_ML[+currentMonth().slice(5) - 1]; if (route === PILOT_ROUTE.cap) return 'prochain comité'; return rpCut(piDue(route), 24); }
  function rpBlkDecide(C) {
    const M = C.M, n = +(C.o.n || PILOT.maxSubjects), list = M.subjects.top.slice(0, n), showSt = C.o.st !== 'no';
    if (!list.length) return [el('p', { class: 'rp-empty', text: 'Aucun sujet ne remplit une règle de décision.' })];
    const cols = [['N°', 5], ['Sujet', 24], ['Constat', 44], ['Décision', 46], ['Qui', 27], ['Pour quand', 23]].concat(showSt ? [['Statut', 17]] : []);
    const tot = sum(cols.map(c => c[1])), t = el('table', { class: 'rp-t rp-dec' });
    const cg = el('colgroup', null, cols.map(c => { const e = el('col'); e.style.width = (c[1] / tot * 100).toFixed(2) + '%'; return e; }));
    t.appendChild(cg); t.appendChild(el('thead', null, el('tr', null, cols.map(c => el('th', { scope: 'col', text: c[0] })))));
    const tb = el('tbody');
    list.forEach((s, i) => {
      const o = piStore()[s.key], st = o ? o.s || 0 : 0;
      const stEl = el('span', { class: 'rp-box rp-st rp-st' + st, text: piStatusText(s.key) });
      if (showSt) {
        stEl.setAttribute('role', 'button'); stEl.setAttribute('tabindex', '0'); stEl.setAttribute('aria-label', 'Statut ' + PI_ST[st] + ' : passer au suivant');
        const next = ev => { ev.stopPropagation(); piSetDecision(s.key, (st + 1) % PI_ST.length, o ? o.ref : '', null); };
        stEl.addEventListener('click', next); stEl.addEventListener('keydown', ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); next(ev); } });
        bindTip(stEl, () => 'Clic : Ouvert → Décidé → Clos (mode administrateur). Même statut que l’onglet Pilotage.');
      }
      const fact = rpCut(rpShortFact(s, M), 58), dec = rpCut(rpDecision(s), 62);
      const tr = el('tr', null, [el('td', { class: 'rp-no', text: String(i + 1) }), el('td', { class: 'rp-subj', text: s.title }), el('td', { class: 'rp-auto', text: fact }), el('td', { class: 'rp-auto', text: dec }),
        el('td', { text: rpRoleShort(s.route.role) }), el('td', { class: 'rp-due', text: rpDueShort(s.route) })].concat(showSt ? [el('td', null, stEl)] : []));
      bindTip(tr.children[2], () => s.fact); bindTip(tr.children[3], () => s.decision); bindTip(tr.children[4], () => s.route.role); bindTip(tr.children[5], () => piDue(s.route) + '\n' + piDueTip(s.route));
      rpClickable(tr, rpOpen(M, () => piSubjectDrawer(M, s)), s.title);
      tb.appendChild(tr);
      rpX_(C, (i + 1) + '. ' + s.title, fact, dec + ' ; ' + s.route.role + ' ; ' + piDue(s.route) + ' ; ' + PI_ST[st]);
    });
    t.appendChild(tb);
    const others = M.subjects.others.concat(M.subjects.top.slice(n));
    return [t, others.length ? el('p', { class: 'rp-base rp-also' }, ['Aussi à l’étude : ' + others.map(s => s.title).join(', ') + '.']) : null];
  }
  // ---------------------------------------------------------------- blocs infographiques partagés (couverture : anneaux, bulles, indicateurs clés, faits marquants)
  // Couverture totale : fenêtre pour les modèles usuels, période des filtres pour les modèles partenaires (somme des régions). Rien d'inventé : covCalc.
  function rpCovAgg(M, part) {
    if (!part) { const c = M.cov.R; return c && !c.outOfYear && c.planned > 0 ? { planned: c.planned, visited: c.visited } : null; }
    let pl = 0, vi = 0; rpRegions(M, null, M.sel).forEach(o => { pl += o.planned; vi += o.visited; });
    return pl > 0 ? { planned: pl, visited: vi } : null;
  }
  // activité choisie pour la Fiche activité : la sélection de l'utilisateur si elle a assez de visites, sinon la première exploitable, sinon la première
  function rpActSel(M) {
    const ok = M.acts.filter(a => rpFicheOk(M, a)), sel = SESSION.rpActSel;
    if (sel && M.acts.indexOf(sel) >= 0) return sel;
    return ok[0] || M.acts[0] || null;
  }
  // Anneaux « prévu → suivi » : sites actifs au plan vs sites vus (covCalc). Couverture plafonnée à 100 % (jamais d'artefact > 100).
  function rpBlkRings(C) {
    const M = C.M, part = rpPartnerTpl(C.tpl), cov = rpCovAgg(M, part);
    if (!cov || cov.planned < SMALL_N.min) return null;
    const pRaw = cov.visited / cov.planned * 100, over = pRaw > 100, frac = cov.visited / cov.planned, k = rpCls(Math.min(100, pRaw));
    const W = 91, s = rpSvg(W, 30, 'Sites prévus ' + rpMask(cov.planned) + ', sites suivis ' + rpMask(cov.visited) + ', couverture ' + pct(Math.min(100, pRaw), 1)), r = 10.5, th = 2.8, cy = 12.5;
    rpRingG(s, 19, cy, r, th, 1, { color: RP_C.seg[3], center: rpMask(cov.planned), centerPt: 10 });
    rpTxt(s, 19, 26.5, 'Sites prévus', { pt: 6.5, anchor: 'middle', fill: RP_C.sub });
    rpTxt(s, 45.5, cy + 1.3, '→', { pt: 12, anchor: 'middle', fill: RP_C.sub });
    rpRingG(s, 72, cy, r, th, frac, { color: rpStat(k).c, center: over ? '≥ 100' : pct(pRaw, 0), centerPt: 10, centerFill: rpStat(k).c });
    rpTxt(s, 72, 26.5, 'Sites suivis ' + rpNN(cov.visited, cov.planned), { pt: 6.5, anchor: 'middle', fill: RP_C.sub });
    rpKey(s, 'couverture'); bindTip(s, () => 'Sites actifs au plan vus pendant ' + (part ? 'la période des filtres' : 'la fenêtre') + ' : ' + rpNN(cov.visited, cov.planned) + ' (' + pct(Math.min(100, pRaw), 1) + ')' + (over ? ', suivis au-delà des prévus : base à vérifier' : ''));
    rpX_(C, 'Sites prévus', rpMask(cov.planned), ''); rpX_(C, 'Couverture du plan', pct(Math.min(100, pRaw), 1), rpNN(cov.visited, cov.planned));
    return [s, over ? rpBase('Sites suivis au-delà des prévus : base du plan à vérifier.') : null];
  }
  // Bulles proportionnelles par activité : aire ∝ sites (prévu derrière, suivi devant), couleur de l'activité. Fenêtre seulement.
  function rpBlkBubbles(C) {
    const M = C.M; if (rpPartnerTpl(C.tpl)) return null;
    const rows = M.rows.filter(r => r.covOk && r.cov.planned > 0); if (!rows.length) return null;
    const W = 91, n = rows.length, colW = W / n, maxV = Math.max(...rows.map(r => r.cov.planned));
    const rMax = Math.min(6.4, colW * 0.42), rOf = v => Math.max(1, rMax * Math.sqrt(Math.max(0, v) / maxV)), baseY = 22;
    const s = rpSvg(W, 28, 'Couverture par activité : ' + rows.map(r => ACT[r.a].short + ' ' + rpNN(r.cov.visited, r.cov.planned)).join(', '));
    rows.forEach((r, i) => {
      const cx = colW * (i + 0.5), rp = rOf(r.cov.planned), rr = rOf(r.cov.visited), col = ACT_COLOR[r.a] || RP_C.blue, g = rpE(s, 'g', {});
      rpTxt(g, cx, 4.2, pct(Math.min(100, r.covP100), 0), { pt: 7, anchor: 'middle', fw: 600, fill: rpStat(rpCls(Math.min(100, r.covP100))).c, cls: 'rp-val' });
      rpE(g, 'circle', { cx, cy: baseY - rp, r: rp, fill: RP_C.seg[2], 'fill-opacity': 0.55, stroke: RP_C.seg[3], 'stroke-width': 0.25 });
      rpE(g, 'circle', { cx, cy: baseY - rr, r: rr, fill: col, 'fill-opacity': 0.85 });
      rpTxt(g, cx, baseY + 4, ACT[r.a].short, { pt: 6.5, anchor: 'middle', fw: 600 });
      bindTip(g, () => ACT[r.a].label + ' : ' + rpNN(r.cov.visited, r.cov.planned) + ' sites actifs vus (' + pct(Math.min(100, r.covP100), 1) + ')');
      rpX_(C, ACT[r.a].short + ' couverture', pct(Math.min(100, r.covP100), 1), rpNN(r.cov.visited, r.cov.planned));
    });
    return [s, rpBase('Aire selon le nombre de sites. Clair : prévus ; couleur : suivis. % sous le libellé en infobulle.')];
  }
  // Barres d'indicateurs clés : couverture, fiches exploitables, cas graves avec suite (clôture), partenaire renseigné — chaque barre colorée par classify.
  function rpBlkKpis(C) {
    const M = C.M, part = rpPartnerTpl(C.tpl), cov = rpCovAgg(M, part), g = M.fams.find(x => x.fam.id === 'grave'), items = [];
    if (cov && cov.planned >= SMALL_N.min) items.push({ lab: 'Couverture du plan', n: cov.visited, N: cov.planned, ref: true });
    if (M.rel && M.rel.validR[1]) items.push({ lab: 'Fiches exploitables', n: M.rel.validR[0], N: M.rel.validR[1] });
    if (g && g.n) items.push({ lab: 'Cas graves avec suite', n: g.n - g.noSt, N: g.n });
    if (M.rel && M.rel.imp[1]) items.push({ lab: 'Partenaire renseigné', n: M.rel.imp[0], N: M.rel.imp[1] });
    if (!items.length) return null;
    const W = 91, barX = 0, barW = 60, RH = 9.2, top = 2, s = rpSvg(W, top + items.length * RH, 'Indicateurs clés : ' + items.map(it => it.lab + ' ' + pct(Math.min(100, it.n / it.N * 100), 0)).join(', '));
    items.forEach((it, i) => {
      const y = top + i * RH, pRaw = it.n / it.N * 100, p = Math.min(100, pRaw), k = rpCls(pRaw), g2 = rpE(s, 'g', {});
      rpE(g2, 'rect', { x: barX, y: y + 1, width: barW, height: 3, rx: 0.6, fill: RP_C.track });
      rpE(g2, 'rect', { x: barX, y: y + 1, width: Math.max(p ? 0.6 : 0, p / 100 * barW), height: 3, rx: 0.6, fill: rpStat(k).c });
      if (it.ref) { const rx = barX + THR.good / 100 * barW; rpE(g2, 'line', { x1: rx, x2: rx, y1: y + 0.2, y2: y + 4.8, stroke: RP_C.ink, 'stroke-width': 0.4 }); rpTxt(g2, rx, y - 0.1, 'cible ' + THR.good, { pt: 5.4, anchor: 'middle', fill: RP_C.sub }); }
      rpTxt(g2, barX + barW + 1.5, y + 3.4, (pRaw > 100 ? '≥ 100 %' : pct(pRaw, 0)) + ' (' + rpNN(it.n, it.N) + ')', { pt: 6.8, cls: 'rp-base' });
      rpTxt(g2, barX, y + 7.6, it.lab, { pt: 7, fw: 600 });
      bindTip(g2, () => it.lab + ' : ' + rpNN(it.n, it.N) + ' (' + pct(Math.min(100, pRaw), 1) + ')');
      rpX_(C, it.lab, pct(Math.min(100, pRaw), 1), rpNN(it.n, it.N));
    });
    return [s];
  }
  // Faits marquants : grille icône (statut) + chiffre + phrase courte. Uniquement des valeurs réelles du modèle.
  function rpBlkHilite(C) {
    const M = C.M, g = M.fams.find(x => x.fam.id === 'grave'), L = M.load, items = [];
    const out = M.rows.filter(r => r.verdict === 'out').length;
    items.push({ v: rpMask(out), lab: 'activité' + (out > 1 ? 's' : '') + ' hors contrôle', k: out ? 'bad' : 'good' });
    if (M.blind) items.push({ v: rpMask(M.blind.blind.length), lab: 'zones sans visite depuis ' + PILOT.blindMonths + ' mois', k: M.blind.blind.length ? 'bad' : 'good' });
    if (g) items.push({ v: rpMask(g.noSt), lab: 'cas graves sans suite', k: g.noSt ? 'mid' : 'good' });
    if (L && !L.na && L.ratio !== null) items.push({ v: '× ' + fmt(L.ratio, 1), lab: 'charge du plan par mois', k: L.ratio > PILOT.cap ? 'bad' : 'good' });
    if (!items.length) return null;
    const W = 91, colW = W / 2, RH = 13, nr = Math.ceil(items.length / 2), s = rpSvg(W, nr * RH, 'Faits marquants : ' + items.map(it => it.v + ' ' + it.lab).join(', '));
    items.forEach((it, i) => {
      const x = (i % 2) * colW, y = Math.floor(i / 2) * RH + 1, S = rpStat(it.k), gg = rpE(s, 'g', {});
      rpStDot(gg, x + 2, y + 3.6, it.k, 1.7);
      rpTxt(gg, x + 6.5, y + 5.2, it.v, { pt: 13, fw: 600, fill: S.c, cls: 'rp-val' });
      rpTxtLines(gg, x + 6.5, y + 9.2, rpWrap(it.lab, colW - 7, 6.4, 2), { pt: 6.4, fill: RP_C.sub });
      rpX_(C, it.lab, it.v, '');
    });
    return [s];
  }
  // ---------------------------------------------------------------- composants « carte », « matrice », « barres », « pictogrammes »
  function rpFromTo(W) {
    if (!W || !W.length) return '';
    const a = W[0], b = W[W.length - 1], ma = PI_MS[+a.slice(5) - 1], mb = PI_MS[+b.slice(5) - 1];
    const de = /^[aeiouéèh]/i.test(ma) ? 'd’' : 'de ';
    return de + ma + (a.slice(0, 4) !== b.slice(0, 4) ? ' ' + a.slice(0, 4) : '') + ' à ' + mb + ' ' + b.slice(0, 4);
  }
  function rpCovClass(p) { if (p === null || p === undefined) return -2; if (p <= 0) return -1; let k = 0; RP_COV_BREAKS.forEach(b => { if (p >= b) k++; }); return k; }
  function rpGeoPath(f, T) {
    let d = ''; (f.type === 'Polygon' ? [f.coords] : f.coords).forEach(poly => poly.forEach(ring => { ring.forEach((p, i) => { const q = project(p[0], p[1]), x = T(q); d += (i ? 'L' : 'M') + rpR(x[0]) + ' ' + rpR(x[1]); }); d += 'Z'; })); return d;
  }
  // rpChoro : carte des régions (couverture), cercles des alertes graves, anneaux des zones sans visite (interne)
  function rpChoro(C, regs, opt) {
    opt = opt || {}; const W = opt.w || 106.8, Hmax = opt.h || 110, legH = opt.mode === 'graves' ? 5 : 8.4, geo = D.geo || [];
    const boxes = regs.map(o => mapGeoBox(o.k)).filter(Boolean); if (!boxes.length) return null;
    let x0 = Math.min(...boxes.map(b => b.x)), y0 = Math.min(...boxes.map(b => b.y)), x1 = Math.max(...boxes.map(b => b.x + b.w)), y1 = Math.max(...boxes.map(b => b.y + b.h));
    const mx = (x1 - x0) * 0.08, my = (y1 - y0) * 0.08; x0 -= mx; x1 += mx; y0 -= my; y1 += my;
    const sc = Math.min(W / (x1 - x0), (Hmax - legH) / (y1 - y0)), mh = (y1 - y0) * sc, ox = (W - (x1 - x0) * sc) / 2;
    const T = q => [(q[0] - x0) * sc + ox, (q[1] - y0) * sc], H = mh + legH;
    // un seul <svg> par bloc : la carte est coupée par overflow:hidden du SVG lui-même, la bande de légende est masquée par un fond blanc
    const s = rpSvg(W, H, 'Carte de la couverture par région : ' + regs.map(o => o.label + ' ' + rpNN(o.visited, o.planned)).join(', ')); s.style.overflow = 'hidden';
    const clip = rpE(s, 'g', { class: 'rp-map' });
    const byK = new Map(regs.map(o => [o.k, o])), gMax = Math.max(1, ...regs.map(o => o.graves || 0)), mode = opt.mode === 'graves' ? 'graves' : 'cov';
    const fillOf = o => {
      if (!o) return { fill: RP_HATCH, stroke: '#fff', sw: 0.3 };
      if (mode === 'graves') { const g = o.graves || 0; return g ? { fill: RP_C.cov[Math.min(3, Math.floor(g / gMax * 3.999))], stroke: '#fff', sw: 0.3, dark: g / gMax > 0.5 } : { fill: '#fff', stroke: RP_C.line, sw: 0.3 }; }
      const k = rpCovClass(o.p); return k === -1 ? { fill: '#fff', stroke: RP_C.red, sw: 0.4, dash: '0.8 0.6' } : { fill: RP_C.cov[Math.max(0, k)], stroke: '#fff', sw: 0.3, dark: k >= 2 };
    };
    geo.forEach(f => { const o = byK.get(mapRegKey(f.name)), st = fillOf(o); rpE(clip, 'path', { d: rpGeoPath(f, T), fill: st.fill, stroke: st.dash ? 'none' : st.stroke, 'stroke-width': st.sw }); });
    geo.forEach(f => { const o = byK.get(mapRegKey(f.name)), st = fillOf(o); if (st.dash) rpE(clip, 'path', { d: rpGeoPath(f, T), fill: 'none', stroke: st.stroke, 'stroke-width': st.sw, 'stroke-dasharray': st.dash }); });
    // anneaux : zones sans visite (interne seulement)
    (opt.rings || []).forEach(r => { const q = T(project(r.lon, r.lat)); rpE(clip, 'circle', { cx: q[0], cy: q[1], r: 1.6, fill: 'none', stroke: RP_C.red, 'stroke-width': 0.35, 'stroke-dasharray': '0.7 0.45' }); if (r.label) rpTxt(clip, q[0] + 2.3, q[1] + 0.9, r.label, { pt: 6, fill: RP_C.red, halo: true }); });
    // petite carte de l'île (dessinée AVANT les étiquettes, qui l'évitent), cadre de la zone affichée
    const iw = 18, ib = { x: -2.2, y: -0.2, w: 12.6, h: 15 }, is = iw / ib.w, ih = ib.h * is, ix = W - iw - 0.5, iy = 0.5;
    const ig = rpE(clip, 'g', { class: 'rp-inset' }); rpE(ig, 'rect', { x: ix - 0.4, y: iy - 0.4, width: iw + 0.8, height: ih + 0.8, fill: '#fff', 'fill-opacity': 0.9 });
    geo.forEach(f => rpE(ig, 'path', { d: rpGeoPath(f, q => [(q[0] - ib.x) * is + ix, (q[1] - ib.y) * is + iy]), fill: RP_C.line, stroke: 'none' }));
    rpE(ig, 'rect', { x: (x0 - ib.x) * is + ix, y: (y0 - ib.y) * is + iy, width: (x1 - x0) * is, height: (y1 - y0) * is, fill: 'none', stroke: RP_C.ink, 'stroke-width': 0.3 });
    // étiquettes posées sur les régions, chevauchements évités (entre elles et avec la petite carte)
    const placed = [[ix - 1, iy - 1, iw + 2, ih + 2]];
    regs.slice().sort((a, b) => b.planned - a.planned).forEach(o => {
      if (!o.geo) return; const c = mapCentroid(o.geo); if (!c) return; const q = T(c), st = fillOf(o);
      // région sans visite : deux lignes seulement (nom, « aucune visite ») ; le n / N est dans la ligne de base du bloc
      const none = mode === 'cov' && !o.visited;
      const l1 = o.label, l2 = mode === 'graves' ? rpMask(o.graves) + ' visites graves' : (o.visited ? pct(o.p, 1) : 'aucune visite'), l3 = none ? '' : rpNN(o.visited, o.planned);
      const bw = Math.max(rpTW(l1, none ? 6.5 : 7, true), rpTW(l2, none ? 6.5 : 7), rpTW(l3, 6.5)) + 1, bh = none ? 5.4 : 8.2; let bx = q[0] - bw / 2, by = q[1] - bh / 2;
      bx = Math.max(0.5, Math.min(W - bw - 0.5, bx)); by = Math.max(0.5, Math.min(mh - bh - 0.5, by));
      for (let t = 0; t < 8 && placed.some(p => bx < p[0] + p[2] && bx + bw > p[0] && by < p[1] + p[3] && by + bh > p[1]); t++) by = Math.max(0.5, Math.min(mh - bh - 0.5, by + (bh + 0.4) * (t % 2 ? -(t + 1) / 2 : (t + 2) / 2)));
      placed.push([bx, by, bw, bh]);
      // texte blanc sur les bleus foncés, avec un halo de la couleur de la région : lisible même quand l'étiquette déborde sur une zone claire
      const fill = st.dark ? '#fff' : RP_C.ink, halo = true, haloColor = st.dark ? st.fill : '#fff', cx = bx + bw / 2;
      const gl = rpE(clip, 'g', { class: 'rp-reg' });
      rpTxt(gl, cx, by + 2.5, l1, { pt: none ? 6.5 : 7, fw: 600, anchor: 'middle', fill: none ? RP_C.red : fill, halo, haloColor });
      rpTxt(gl, cx, by + (none ? 5 : 5.3), l2, { pt: none ? 6.5 : 7, anchor: 'middle', fill: o.visited || mode === 'graves' ? fill : RP_C.red, halo, haloColor });
      if (l3) rpTxt(gl, cx, by + 7.9, l3, { pt: 6.5, anchor: 'middle', fill, halo, haloColor, cls: 'rp-base' });
      bindTip(gl, () => o.label + ' : ' + nOf(o.visited, o.planned, 'sites actifs vus') + '\nVisites avec alerte grave : ' + fmt(o.graves));
      if (mode === 'cov' && o.graves && !(rpDiff() && o.graves < PILOT.mask)) {
        const r = Math.max(1.4, 3.2 * Math.sqrt(o.graves / gMax)), gx = Math.min(W - r - 0.5, bx + bw + r + 0.4), gy = by + bh / 2;
        rpE(clip, 'circle', { cx: gx, cy: gy, r, fill: '#fff', 'fill-opacity': 0.85, stroke: RP_C.red, 'stroke-width': 0.4 });
        rpTxt(clip, gx, gy + 0.85, rpMask(o.graves), { pt: 6, anchor: 'middle', fill: RP_C.red, fw: 600 });
      }
      rpX_(C, 'Région ' + o.label, o.visited ? pct(o.p, 1) : 'aucune visite', rpNN(o.visited, o.planned) + ' sites actifs ; ' + rpMask(o.graves) + ' visites graves');
    });
    // légende (sur fond blanc : aucun polygone ne déborde dessous) ; elle passe à la ligne si elle dépasse la largeur de la carte
    rpE(s, 'rect', { x: -1, y: mh, width: W + 2, height: legH + 1, fill: '#fff' });
    let lx = 0, ly = mh + 2.2;
    const need = w => { if (lx + w > W && lx > 0) { lx = 0; ly += 3.2; } };
    const sw = (fill, lab, o) => { o = o || {}; need(4.6 + rpTW(lab, 6) * 1.1); rpE(s, 'rect', { x: lx, y: ly, width: 3, height: 2.4, fill, stroke: o.stroke || RP_C.line, 'stroke-width': o.sw || 0.15, 'stroke-dasharray': o.dash || null }); rpTxt(s, lx + 3.6, ly + 2, lab, { pt: 6, fill: RP_C.sub }); lx += 4.6 + rpTW(lab, 6) * 1.1; };
    const ci = (lab, o) => { need(4.6 + rpTW(lab, 6) * 1.1); rpE(s, 'circle', { cx: lx + 1.2, cy: ly + 1.2, r: 1.1, fill: o.fill, stroke: RP_C.red, 'stroke-width': o.sw, 'stroke-dasharray': o.dash || null }); rpTxt(s, lx + 3, ly + 2, lab, { pt: 6, fill: RP_C.sub }); lx += 4.6 + rpTW(lab, 6) * 1.1; };
    if (mode === 'cov') {
      sw(RP_HATCH, 'sans site actif'); sw('#fff', 'aucune visite', { stroke: RP_C.red, sw: 0.3, dash: '0.6 0.5' });
      const b = RP_COV_BREAKS; sw(RP_C.cov[0], '< ' + b[0] + ' %'); sw(RP_C.cov[1], b[0] + '–' + b[1]); sw(RP_C.cov[2], b[1] + '–' + b[2]); sw(RP_C.cov[3], '≥ ' + b[2] + ' %');
      ci('alertes graves', { fill: '#fff', sw: 0.35 });
      if ((opt.rings || []).length) ci('zone sans visite', { fill: 'none', sw: 0.3, dash: '0.6 0.4' });
    } else { sw('#fff', 'aucune'); [0, 1, 2, 3].forEach(i => sw(RP_C.cov[i], i === 3 ? 'le plus' : i === 0 ? 'peu' : '')); }
    return s;
  }
  // rpMatrix : matrice de feux (lignes dans l'ordre ACTS, jamais triées)
  function rpMatrix(rows, cols, cellOf, opt) {
    opt = opt || {}; const LW = 28, CW = opt.cw || 18, RH = 7, HH = 7.5, lastW = opt.lastW || 0, W = LW + cols.length * CW + lastW;
    const s = rpSvg(Math.min(RP_SZ.usable, W), HH + rows.length * RH + 0.5, opt.aria || 'Matrice');
    cols.forEach((c, j) => { const lines = rpWrap(c.label, CW - 1, 7, 2); lines.forEach((l, k) => rpTxt(s, LW + j * CW + CW / 2, HH - 1.2 - (lines.length - 1 - k) * 2.7, l, { pt: 7, anchor: 'middle', fill: RP_C.sub })); const ttl = rpE(s, 'title', {}); ttl.textContent = c.full || c.label; });
    if (lastW) rpWrap(opt.lastLabel || '', lastW - 1, 7, 2).forEach((l, k, a) => rpTxt(s, LW + cols.length * CW + 1, HH - 1.2 - (a.length - 1 - k) * 2.7, l, { pt: 7, fill: RP_C.sub }));
    rpE(s, 'line', { x1: 0, x2: W, y1: HH, y2: HH, stroke: RP_C.line, 'stroke-width': 0.25 });
    rows.forEach((r, i) => {
      const y = HH + i * RH, cy = y + RH / 2;
      if (i) rpE(s, 'line', { x1: 0, x2: W, y1: y, y2: y, stroke: RP_C.line, 'stroke-width': 0.15 });
      rpTxt(s, 1, cy + 1, r.label, { pt: 8, fw: 600 });
      cols.concat(lastW ? [{ last: true }] : []).forEach((c, j) => {
        const v = cellOf(r, c), x = LW + j * CW, cw = c.last ? lastW : CW;
        if (!v || v.n === undefined || rpN(v.n) === 'none' || !rpNum(v.v)) { rpTxt(s, x + (c.last ? 2 : cw / 2), cy + 1, '–', { pt: 8, anchor: c.last ? 'start' : 'middle', fill: RP_C.prev }); return; }
        const low = rpN(v.n) === 'low', k = low ? 'na' : rpCls(v.v), g = rpE(s, 'g', { class: 'rp-cell' });
        if (low) rpE(g, 'rect', { x: x + 0.8, y: y + 0.8, width: cw - 1.6, height: RH - 1.6, fill: RP_HATCH });
        const dx = c.last ? x + 2.4 : x + cw / 2 - 4.2;
        rpE(g, 'circle', { cx: dx, cy, r: 1.3, fill: rpStat(k).c, 'aria-label': RP_ST_WORD[k] });
        rpTxt(g, dx, cy + 0.75, rpStat(k).ic, { pt: 6, anchor: 'middle', fill: '#fff', fw: 600 });
        rpTxt(g, dx + 2, cy + 1, fmt(v.v, 1), { pt: 8, fill: low ? RP_C.sub : RP_C.ink, fw: c.last ? 600 : null });
        if (c.last && v.name) { const room = cw - 2.4 - 2 - rpTW(fmt(v.v, 1), 8, true) - 1.5; rpTxt(g, dx + 2 + rpTW(fmt(v.v, 1), 8, true) + 1.2, cy + 1, rpCut(v.name, Math.max(6, Math.floor(room / (7 * RP_PT * 0.52)))), { pt: 7, fill: RP_C.sub }); }
        bindTip(g, () => r.label + ', ' + (v.full || c.full || c.label || '') + ' : ' + fmt(v.v, 1) + ' sur 100, ' + fmt(v.n) + ' visites (' + RP_ST_WORD[k] + (low ? ', indicatif' : '') + ')');
      });
    });
    return s;
  }
  // rpBars : barres horizontales libellées (0–100), statut THR, repère libellé
  function rpBars(list, opt) {
    opt = opt || {}; const W = opt.w || 91, RH = 5, LW = opt.lw || Math.min(42, W * 0.46), BW = opt.bw || (W - LW - 16), top = 3.2;
    const s = rpSvg(W, top + list.length * RH + 0.5, opt.aria || '');
    const X = v => LW + Math.max(0, Math.min(100, v)) / 100 * BW;
    if (opt.ref !== undefined) { rpE(s, 'line', { x1: X(opt.ref), x2: X(opt.ref), y1: top - 0.4, y2: top + list.length * RH, stroke: RP_C.ink, 'stroke-width': 0.3 }); rpTxt(s, X(opt.ref), top - 0.9, String(opt.ref), { pt: 6, anchor: 'middle', fill: RP_C.ink }); }
    list.forEach((it, i) => {
      const y = top + i * RH, g = rpE(s, 'g', {}), st = rpN(it.n);
      rpTxt(g, 0, y + 3.4, rpCut(it.label, Math.floor(LW / (7 * RP_PT * 0.52)) - 1), { pt: 7, fill: st === 'none' ? RP_C.sub : RP_C.ink });
      rpE(g, 'rect', { x: LW, y: y + 1.1, width: BW, height: 2.8, rx: 0.6, fill: RP_C.track });
      if (st === 'none' || !rpNum(it.v)) { rpTxt(g, LW + BW + 1.5, y + 3.4, '–', { pt: 7, fill: RP_C.sub }); }
      else {
        const k = st === 'low' ? 'na' : rpCls(it.v);
        rpE(g, 'rect', { x: LW, y: y + 1.1, width: Math.max(0.6, X(it.v) - LW), height: 2.8, rx: 0.6, fill: st === 'low' ? RP_HATCH : opt.plain || rpStat(k).c, 'fill-opacity': st === 'low' || opt.plain ? 1 : 0.85 });
        rpTxt(g, LW + BW + 1.2, y + 3.4, (opt.noIcon ? '' : rpStat(k).ic + ' ') + (it.vtxt || fmt(it.v, 0)), { pt: 7, fill: st === 'low' ? RP_C.sub : opt.plain ? RP_C.ink : rpStat(k).tx, fw: 600 });
      }
      if (it.ntxt !== undefined) rpTxt(g, W, y + 3.4, it.ntxt, { pt: 6, anchor: 'end', fill: RP_C.sub });
      if (it.tip) bindTip(g, () => it.tip);
    });
    return s;
  }
  // rpPictos : un carré par visite (ou par 5 visites), une rangée par famille
  function rpPictos(C, fams, opt) {
    opt = opt || {}; const M = C.M, SQ = 2.6, GAP = 0.6, PER = 20, LW = 30, PW = PER * (SQ + GAP), RX = LW + PW + 3, W = RP_SZ.usable;
    const grp = opt.group === 'yes' || (opt.group !== 'no' && Math.max(...fams.map(f => f.n)) > 100) ? 5 : 1;
    const rowsOf = f => Math.max(1, Math.ceil(Math.ceil(f.n / grp) / PER));
    const show = fams.filter(f => !(rpDiff() && f.n > 0 && f.n < PILOT.mask));
    let H = 1; fams.forEach(f => { H += Math.max(rowsOf(f) * (SQ + GAP), 8.6) + 2.4; }); H += grp > 1 ? 3.5 : 0.5;
    const s = rpSvg(W, H, 'Cas graves : ' + fams.map(f => f.fam.label + ' ' + rpMask(f.n) + ' visites, ' + rpMask(f.noSt) + ' sans suite').join(' ; '));
    let y = 1;
    fams.forEach(f => {
      const g = rpE(s, 'g', { class: 'rp-fam' }), rh = Math.max(rowsOf(f) * (SQ + GAP), 8.6);
      rpTxt(g, 0, y + 2.6, f.fam.label, { pt: 7.5, fw: 600 });
      rpTxt(g, 0, y + 5.6, rpCut('pour ' + rpLow(f.fam.to), Math.floor((LW - 1.5) / (6.5 * RP_PT * 0.53))), { pt: 6.5, fill: RP_C.sub });
      if (show.indexOf(f) < 0) { rpTxt(g, LW, y + 2.6, 'moins de ' + PILOT.mask, { pt: 7, fill: RP_C.sub }); }
      else if (!f.n) rpTxt(g, LW, y + 2.6, 'aucune visite', { pt: 7, fill: RP_C.sub });
      else {
        const items = f.vis.slice().sort((a, b) => String(a.v.date).localeCompare(String(b.v.date))), units = [];
        for (let i = 0; i < items.length; i += grp) { const ch = items.slice(i, i + grp); units.push({ st: ch.every(o => o.st >= 1) ? 1 : 0, age: Math.max(...ch.map(o => piAge(o.v.date) || 0)) }); }
        units.forEach((u, i) => {
          const cx = LW + (i % PER) * (SQ + GAP), cy = y + Math.floor(i / PER) * (SQ + GAP), old = u.age > PILOT.oldDays, mid = !old && u.age > PILOT.caseAge;
          if (old && !u.st) { rpE(g, 'rect', { x: cx, y: cy, width: SQ, height: SQ, fill: RP_C.red }); rpE(g, 'line', { x1: cx + 0.4, y1: cy + SQ - 0.4, x2: cx + SQ - 0.4, y2: cy + 0.4, stroke: '#fff', 'stroke-width': 0.35 }); }
          else if (u.st) rpE(g, 'rect', { x: cx + 0.12, y: cy + 0.12, width: SQ - 0.25, height: SQ - 0.25, fill: '#fff', stroke: mid ? RP_C.orange : RP_C.ink, 'stroke-width': mid ? 0.4 : 0.25 });
          else rpE(g, 'rect', { x: cx + (mid ? 0.2 : 0), y: cy + (mid ? 0.2 : 0), width: SQ - (mid ? 0.4 : 0), height: SQ - (mid ? 0.4 : 0), fill: RP_C.ink, stroke: mid ? RP_C.orange : 'none', 'stroke-width': mid ? 0.4 : 0 });
        });
      }
      // en revue partenaires, la chaîne « revisités → même alerte » est dans le bloc « Après la revisite » : 3 chiffres suffisent ici
      const sui = f.n - f.noSt, facts = opt.suites ? [[rpNN(sui, f.n), 'suivis'], [rpMask(f.old), 'plus de ' + PILOT.oldDays + ' jours'], [f.med !== null ? fmt(f.med, 1) + ' j' : '–', 'délai médian']]
        : [[rpNN(sui, f.n), 'suivis'], [rpMask(f.old), 'plus de ' + PILOT.oldDays + ' jours'], [rpNN(f.revOk, f.rev), 'revus à temps'], [f.med !== null ? fmt(f.med, 1) + ' j' : '–', 'délai médian']];
      const cw = (W - RX) / facts.length;
      facts.forEach(([v, l], j) => { rpTxt(g, RX + j * cw, y + 2.8, v, { pt: 8.5, fw: 600, fill: (j === 0 && f.n && !sui) ? RP_C.st.bad.tx : RP_C.ink, cls: 'rp-val' }); rpTxt(g, RX + j * cw, y + 5.8, l, { pt: 6.5, fill: RP_C.sub, cls: 'rp-base' }); });
      if (opt.suites) bindTip(g, () => f.fam.label + ' : ' + fmt(f.n) + ' visites, ' + fmt(f.rev) + ' sites revisités ensuite, ' + fmt(f.recur) + ' avec la même alerte ; délai médian ' + (f.med !== null ? fmt(f.med, 1) + ' jours' : '–') + '\n' + fmt(f.inR) + ' visites en ' + piWin(M.T.R) + ' contre ' + fmt(f.inP) + ' en ' + piWin(M.T.P));
      rpSvgClick(g, rpOpen(M, () => piFamDrawer(M, f)), f.fam.label);
      rpX_(C, f.fam.label, rpMask(f.n) + ' visites', rpNN(sui, f.n) + ' suivis ; ' + rpMask(f.old) + ' de plus de ' + PILOT.oldDays + ' jours ; revus à temps ' + rpNN(f.revOk, f.rev) + ' ; délai médian ' + (f.med !== null ? fmt(f.med, 1) : '–'));
      y += rh + 2.4;
    });
    if (grp > 1) rpTxt(s, LW, y + 1.2, '1 carré = ' + grp + ' visites', { pt: 6.5, fill: RP_C.sub });
    return s;
  }
  // rpDotCI : graphique à points avec intervalle (lignes de 5,5 mm)
  function rpDotCI(rows, opt) {
    opt = opt || {}; const W = opt.w || RP_SZ.usable, LW = opt.lw || 40, AW = opt.aw || 90, RH = opt.rh || 5.5, top = opt.top === undefined ? 4.5 : opt.top, lo = opt.lo || 0, hi = opt.hi || 100;
    const s = rpSvg(W, top + rows.length * RH + 1, opt.aria || '');
    const X = v => LW + (Math.max(lo, Math.min(hi, v)) - lo) / (hi - lo) * AW;
    (opt.refs || []).forEach(r => { rpE(s, 'line', { x1: X(r.v), x2: X(r.v), y1: top - 0.6, y2: top + rows.length * RH, stroke: RP_C.ink, 'stroke-width': r.dash ? 0.25 : 0.35, 'stroke-dasharray': r.dash ? '0.8 0.6' : null }); rpTxt(s, X(r.v), top - 1.2, r.label, { pt: 6, anchor: r.anchor || 'middle', fill: RP_C.ink }); });
    if (opt.axis !== false) { rpTxt(s, LW, top - 1.2, fmt(lo) + (opt.unit || ''), { pt: 6, fill: RP_C.sub, anchor: 'start' }); if (!(opt.refs || []).some(r => Math.abs(X(r.v) - (LW + AW)) < 8)) rpTxt(s, LW + AW, top - 1.2, fmt(hi) + (opt.unit || ''), { pt: 6, fill: RP_C.sub, anchor: 'end' }); }
    rows.forEach((r, i) => {
      const y = top + i * RH + RH / 2, g = rpE(s, 'g', {});
      if (r.band) rpE(g, 'rect', { x: 0, y: y - RH / 2, width: W, height: RH, fill: RP_C.shade });
      rpTxtLines(g, 0, y + (r.label2 ? -0.4 : 0.9), [rpCut(r.label, Math.floor(LW / (7 * RP_PT * 0.52)))], { pt: 7, fw: r.bold ? 600 : null });
      if (r.label2) rpTxt(g, 0, y + 2.1, r.label2, { pt: 5.8, fill: RP_C.sub });
      rpDotRowG(g, LW, y, AW, lo, hi, r, { arrow: opt.arrow && !r.rupture, noPrev: opt.noPrev });
      let rx = LW + AW + 3; if (r.mark) { rpTxt(g, rx, y + 0.9, r.mark.t, { pt: 7, fill: rpStat(r.mark.k).tx, fw: 600, cls: 'rp-st' }); rx += rpTW(r.mark.t, 7, true) + 1.5; }
      if (r.right) rpTxt(g, rx, y + 0.9, r.right, { pt: 7, fill: RP_C.ink, cls: 'rp-base' });
      if (r.right2) rpTxt(g, W, y + 0.9, r.right2, { pt: 6.5, fill: RP_C.sub, anchor: 'end' });
      if (r.tip) bindTip(g, () => r.tip); if (r.open) rpSvgClick(g, r.open, r.label);
    });
    return s;
  }

  // ---------------------------------------------------------------- NOTE DE DIRECTION : blocs des pages 2 à 4
  function rpBlindRings(C, B) {
    if (rpDiff()) return [];
    const by = new Map(); piSites().forEach(s => { const k = s.act + '|' + s.district; if (!rpNum(+s.lat) || !rpNum(+s.lon) || s.lat === null || s.lon === null || s.lat === '') return; let o = by.get(k); if (!o) by.set(k, o = { n: 0, lat: 0, lon: 0 }); o.n++; o.lat += +s.lat; o.lon += +s.lon; });
    return B.blind.map(z => { const o = by.get(z.act + '|' + z.district); return o && o.n ? { lat: o.lat / o.n, lon: o.lon / o.n, label: C.o.names === 'yes' ? z.district : '' } : null; }).filter(Boolean);
  }
  function rpBlkChoro(C) {
    const M = C.M, part = rpPartnerTpl(C.tpl), regs = rpX('regs|' + (part ? 'F' : 'R'), () => rpRegions(M, part ? null : M.T.R, part ? M.sel : M.okR));
    if (!regs.length) return null;
    const map = rpChoro(C, regs, { mode: C.o.color === 'graves' ? 'graves' : 'cov', rings: rpBlindRings(C, M.blind) });
    if (!map) return null;
    const none = regs.filter(o => !o.visited);
    return [map, rpBase((part ? rpWin(rpMonthsOf(F.m0, F.m1)) : piWin(M.T.R)) + ', ' + regs.length + ' région' + (regs.length > 1 ? 's' : '') + ' avec sites actifs' + (none.length ? ', ' + none.length + ' sans aucune visite : ' + none.map(o => o.label + ' 0 / ' + rpMask(o.planned)).join(', ') : '') + '.')];
  }
  function rpBlkBlind(C) {
    const M = C.M, B = M.blind, n = +(C.o.n || 6); if (!B.blind.length) return [el('p', { class: 'rp-empty', text: 'Aucune zone sans visite depuis ' + PILOT.blindMonths + ' mois.' }), rpBase(fmt(B.zones) + ' zones activité × district suivies.')];
    const list = B.blind.slice(0, n), mx = Math.max(...list.map(z => z.N));
    const items = list.map(z => ({ label: ACT[z.act].short + ', ' + (rpDiff() ? z.region : z.district), v: z.N / mx * 100, vtxt: rpMask(z.N), n: SMALL_N.low, tip: ACT[z.act].label + ' : ' + fmt(z.N) + ' sites actifs, aucune visite ' + rpFromTo(B.W) }));
    const s = rpBars(items, { w: 75, lw: 40, bw: 26, noIcon: true, plain: RP_C.seg[3], aria: 'Zones sans visite : ' + items.map(i => i.label + ' ' + i.vtxt + ' sites').join(', ') });
    list.forEach(z => rpX_(C, ACT[z.act].short + ', ' + (rpDiff() ? z.region : z.district), rpMask(z.N) + ' sites actifs', 'aucune visite ' + rpFromTo(B.W)));
    return [s, rpBase(rpMask(B.blind.length) + ' zones, ' + rpMask(B.sites) + ' sites actifs, sans visite ' + rpFromTo(B.W) + '.')];
  }
  function rpBlkWeak(C) {
    const M = C.M, rows = M.rows.filter(r => r.r.n || r.xa.length); if (!rows.length) return null;
    const cnt = new Map(); rows.forEach(r => (D.domains[r.a] || []).forEach(d => cnt.set(d, (cnt.get(d) || 0) + 1)));
    let cols = rows.length === 1 ? (D.domains[rows[0].a] || []).slice(0, 7) : Array.from(cnt.keys()).filter(d => cnt.get(d) >= 2).sort((a, b) => (cnt.get(b) - cnt.get(a)) || a.localeCompare(b, 'fr')).slice(0, 7);
    const own = C.o.own !== 'no' && rows.length > 1;
    const data = new Map(rows.map(r => [r.a, ovDomRows(r.a, rpWinVisits(M, r.a, r.win.R))]));
    cols = cols.map(d => ({ d, label: rpDomLabel(d), full: d }));
    const lastW = own ? Math.max(24, RP_SZ.usable - 28 - cols.length * 18) : 0;
    const s = rpMatrix(rows.map(r => ({ a: r.a, label: ACT[r.a].short })), cols, (r, c) => {
      const L = data.get(r.a) || [];
      if (c.last) { const ownD = L.filter(x => (cnt.get(x.d) || 0) < 2 && rpN(x.n) !== 'none').sort((p, q) => p.v - q.v)[0]; return ownD ? { v: ownD.v, n: ownD.n, name: rpDomLabel(ownD.d), full: ownD.d } : null; }
      const x = L.find(z => z.d === c.d); return x ? { v: x.v, n: x.n } : null;
    }, { lastW, lastLabel: 'Domaine propre le plus faible', aria: 'Score par domaine et par activité' });
    rows.forEach(r => (data.get(r.a) || []).forEach(x => rpX_(C, ACT[r.a].short + ', ' + x.d, rpN(x.n) === 'none' ? '–' : fmt(x.v, 1), rpMask(x.n) + ' visites')));
    return [s];
  }
  function rpBlkNorms(C) {
    const M = C.M, n = +(C.o.n || 5), all = [];
    M.norms.forEach(o => o.sys.forEach(q => all.push({ a: o.a, q, gk: o.gk })));
    if (!all.length) return null;
    const list = all.sort((x, y) => x.q.p - y.q.p).slice(0, n), W = RP_SZ.usable, LW = 82, BW = 60, RH = 6, top = 3.5;
    const s = rpSvg(W, top + list.length * RH, 'Normes à revoir : ' + list.map(o => ACT[o.a].short + ' ' + pct(o.q.p, 0)).join(', '));
    const X = v => LW + v / 100 * BW;
    rpE(s, 'line', { x1: X(THR.mid), x2: X(THR.mid), y1: top - 0.5, y2: top + list.length * RH, stroke: RP_C.ink, 'stroke-width': 0.4 }); rpTxt(s, X(THR.mid), top - 1, String(THR.mid), { pt: 6, anchor: 'middle' });
    list.forEach((o, i) => {
      const y = top + i * RH, g = rpE(s, 'g', {});
      rpTxt(g, 0, y + 3.8, ACT[o.a].short, { pt: 7, fw: 600 }); rpTxt(g, 17, y + 3.8, rpShortQ(o.q.m.label, Math.floor((LW - 19) / (7 * RP_PT * 0.53))), { pt: 7 });
      rpE(g, 'rect', { x: LW, y: y + 1.6, width: BW, height: 2.8, rx: 0.6, fill: RP_C.track });
      rpE(g, 'rect', { x: LW, y: y + 1.6, width: Math.max(0.6, X(o.q.p) - LW), height: 2.8, rx: 0.6, fill: rpStat(rpCls(o.q.p)).c, 'fill-opacity': 0.85 });
      rpTxt(g, LW + BW + 1.5, y + 3.8, rpStat(rpCls(o.q.p)).ic + ' ' + pct(o.q.p, 0), { pt: 7, fw: 600, fill: rpStat(rpCls(o.q.p)).tx });
      rpTxt(g, W, y + 3.8, rpMask(o.q.n) + ' visites, ' + o.q.below.length + ' ' + (o.gk === 'imp' ? 'partenaires' : 'districts') + ' sur ' + o.q.groups.length, { pt: 6.5, anchor: 'end', fill: RP_C.sub, cls: 'rp-base' });
      bindTip(g, () => o.q.m.label + '\n' + pct(o.q.p, 1) + ' conforme sur ' + fmt(o.q.n) + ' visites ; sous ' + THR.mid + ' dans ' + o.q.below.length + ' ' + (o.gk === 'imp' ? 'partenaires' : 'districts') + ' sur ' + o.q.groups.length);
      rpSvgClick(g, rpOpen(M, () => piNormsDrawer(M)), rpShortQ(o.q.m.label, 40));
      rpX_(C, ACT[o.a].short + ', ' + rpShortQ(o.q.m.label, 60), pct(o.q.p, 1), rpMask(o.q.n) + ' visites, ' + o.q.below.length + ' groupes sur ' + o.q.groups.length);
    });
    return [s];
  }
  function rpBlkCases(C) {
    const M = C.M; if (!M.fams.some(f => f.n) && !M.fams.length) return null;
    const s = rpPictos(C, M.fams, { group: C.o.group || 'auto', suites: rpPartnerTpl(C.tpl) });
    const noReg = !(D.cases && Object.keys(D.cases).length);
    return [s, rpBase('Depuis ' + piWin([F.m0]) + (noReg ? '. Aucune suite enregistrée dans le fichier.' : '.'))];
  }
  function rpBlkSignals(C) {
    const M = C.M, S = rpWithMode(() => piSignals(M)).filter(sg => sg.R && sg.R.N), cmp = C.o.cmp !== 'no';
    if (!S.length) return null;
    const rows = S.slice(0, 6).map(sg => {
      const p = sg.R.n / sg.R.N * 100, ci = rpWilson(sg.R.n, sg.R.N), pp = sg.P && sg.P.N ? sg.P.n / sg.P.N * 100 : null, rup = cmp && pp !== null && Math.abs(p - pp) > PILOT.rupture;
      rpX_(C, sg.label, pct(p, 0), rpNN(sg.R.n, sg.R.N) + (pp !== null ? ' ; avant ' + rpNN(sg.P.n, sg.P.N) : '') + ' ; ' + sg.to);
      return { label: sg.label, v: p, lo: ci[0], hi: ci[1], prev: cmp ? pp : null, rupture: rup, low: rpN(sg.R.N) === 'low', none: rpN(sg.R.N) === 'none' || sg.silent,
        mark: rup ? { t: '! rupture à vérifier', k: 'mid' } : null, right: pct(p, 0) + ' (' + rpNN(sg.R.n, sg.R.N) + ')', right2: sg.to,
        tip: sg.label + ' : ' + rpNN(sg.R.n, sg.R.N) + ', ' + pct(p, 1) + ' [' + fmt(ci[0], 0) + '–' + fmt(ci[1], 0) + ']' + (pp !== null ? '\nAvant : ' + rpNN(sg.P.n, sg.P.N) + ', ' + pct(pp, 1) : ''), open: rpOpen(M, () => piSignalDrawer(M, sg)) };
    });
    return [rpDotCI(rows, { lw: 44, aw: 72, unit: ' %', arrow: true, noPrev: !cmp, aria: 'Signaux : ' + rows.map(r => r.label + ' ' + r.right).join(' ; ') }), rpBase(piWin(M.T.R) + (cmp ? ', point creux : ' + piWin(M.T.P) : '') + '. Intervalle à 95 %.')];
  }
  function rpBlkMeals(C) {
    const M = C.M, ml = M.meals, on = M.subjects.top.concat(M.subjects.others).some(s => s.key === 'C|repas') || ml.schools >= PILOT.mealSchools;
    if (!on || !ml.schools || M.acts.indexOf('SMP') < 0) return null;
    const share = ml.low / ml.schools * 100;
    rpX_(C, 'Élèves des écoles sous le seuil', fmt(ml.pupilsLow), rpNN(ml.low, ml.schools) + ' écoles ; moyenne ' + fmt(ml.mean, 1) + ' jours');
    return [el('div', { class: 'rp-big rp-val', text: fmt(ml.pupilsLow) + ' élèves' }),
      el('p', { class: 'rp-line' }, 'dans ' + rpMask(ml.low) + ' écoles sur ' + rpMask(ml.schools) + ' sous ' + PILOT.mealDays + ' jours de repas sur 20'),
      rpGaugeSvg(share, 100, { ref: PILOT.mealShare, refLabel: 'seuil ' + PILOT.mealShare + ' %', color: share >= PILOT.mealShare ? RP_C.red : RP_C.blue, aria: pct(share, 0) + ' des écoles sous le seuil' }, 'std'),
      rpBase(pct(share, 0) + ' des écoles. Moyenne ' + fmt(ml.mean, 1) + ' jours, ' + rpMask(ml.n) + ' relevés.')];
  }
  function rpBlkPartic(C) {
    const M = C.M, R = piResults(M).filter(o => o.visits >= PILOT.minN && o.N);
    if (!R.length) return null;
    const rows = R.map(o => { const p = o.n / o.N * 100, ci = rpWilson(o.n, o.N); rpX_(C, o.label, pct(p, 1), fmt(o.n) + ' / ' + fmt(o.N) + ', ' + rpMask(o.visits) + ' visites'); return { label: o.label, v: p, lo: ci[0], hi: ci[1], right: pct(p, 0), right2: rpMask(o.visits) + ' visites', tip: o.label + ' : ' + fmt(o.n) + ' sur ' + fmt(o.N) + ', ' + rpMask(o.visits) + ' visites' }; });
    return [rpDotCI(rows, { w: 91, lw: 34, aw: 34, rh: 6, unit: ' %', aria: 'Participation' }), rpBase('Période choisie, intervalle à 95 %.')];
  }
  function rpBlkCapacity(C) {
    const M = C.M, L = M.load, dem = rpDemandByCat(); if (L.na || L.ratio === null || !dem) return null;
    const W = RP_SZ.usable, s = rpSvg(W, 17, 'Capacité : ' + fmt(L.demand) + ' visites dues par mois pour ' + fmt(L.cap) + ' faites, ' + fmt(L.ratio, 1) + ' fois la capacité');
    rpTxt(s, 0, 11, '× ' + fmt(L.ratio, 1), { pt: 28, fw: 600, fill: L.ratio > PILOT.cap ? RP_C.st.bad.c : RP_C.ink, cls: 'rp-val' });
    rpTxt(s, 0, 15.6, L.ratio > PILOT.cap ? '✗ au-delà de la capacité' : 'dans la capacité', { pt: 7, fill: L.ratio > PILOT.cap ? RP_C.st.bad.tx : RP_C.sub, cls: 'rp-st' });
    const segs = dem.map((d, i) => ({ n: d.v, label: d.l, txt: fmt(d.v), color: RP_C.seg[3 - i], dark: i < 2 }));
    rpStackHG(s, 42, 6, W - 44, 5, segs, { tick: { v: L.cap, label: 'faites : ' + fmt(L.cap) + ' par mois' }, max: sum(dem.map(d => d.v)) });
    rpTxt(s, W - 2, 15, fmt(L.demand) + ' visites dues par mois', { pt: 6.5, anchor: 'end', fill: RP_C.sub, cls: 'rp-base' });
    dem.forEach(d => rpX_(C, 'Demande ' + d.l, fmt(d.v, 1), fmt(d.n) + ' sites')); rpX_(C, 'Charge', fmt(L.ratio, 2), fmt(L.demand) + ' dues ; ' + fmt(L.cap) + ' faites');
    return [s, el('p', { class: 'rp-checks rp-prt' }, ['Levier à choisir : ', el('span', { class: 'rp-cb', text: 'fréquences' }), el('span', { class: 'rp-cb', text: 'périmètre' }), el('span', { class: 'rp-cb', text: 'budget du suivi' })])];
  }
  function rpBlkExec(C) {
    const M = C.M, part = rpPartnerTpl(C.tpl), W = part ? null : M.T.R, E = rpExec(M, W); if (!E || !E.months.length) return null;
    const val = rpValidated().filter(o => E.months.indexOf(o.m) >= 0), useVal = val.length > 0;
    let rows;
    if (useVal) { const by = new Map(); val.forEach(o => { const a = by.get(o.fo) || { fo: o.fo, n: 0, N: 0 }; a.n += o.n; a.N += o.N; by.set(o.fo, a); }); rows = Array.from(by.values()); }
    else rows = Object.keys(E.byFo).map(fo => ({ fo, n: E.byFo[fo].done, N: E.byFo[fo].dues }));
    rows = rows.filter(r => r.N > 0).sort((a, b) => b.N - a.N);
    const code = rpCoder(rows.map(r => ({ name: r.fo, n: r.N })), 'Bureau'), tn = sum(rows.map(r => r.n)), tN = sum(rows.map(r => r.N)), rate = tN ? tn / tN * 100 : 0;
    const LW = 26, BW = 56, RH = 5.2, top = 7, H = Math.max(top + rows.length * RH + 1, 34), s = rpSvg(RP_SZ.usable, H, 'Exécution par bureau, taux global ' + pct(rate, 0));
    rpTxt(s, 0, 3, useVal ? 'Plan validé, faites / prévues' : 'Échéances tenues / dues', { pt: 7, fw: 600 });
    const X = v => LW + v / 100 * BW;
    rpE(s, 'line', { x1: X(rate), x2: X(rate), y1: top - 0.8, y2: top + rows.length * RH, stroke: RP_C.ink, 'stroke-width': 0.35 }); rpTxt(s, X(rate), top - 1.3, 'ensemble ' + pct(rate, 0), { pt: 6, anchor: 'middle' });
    rows.forEach((r, i) => {
      const y = top + i * RH, p = r.n / r.N * 100;
      rpTxt(s, 0, y + 3.6, code(r.fo), { pt: 7 }); rpE(s, 'rect', { x: LW, y: y + 1.3, width: BW, height: 2.8, rx: 0.6, fill: RP_C.track });
      rpE(s, 'rect', { x: LW, y: y + 1.3, width: Math.max(p ? 0.6 : 0, X(p) - LW), height: 2.8, rx: 0.6, fill: RP_C.blue });
      rpTxt(s, LW + BW + 1.5, y + 3.6, rpNN(r.n, r.N), { pt: 7, cls: 'rp-base' });
      rpX_(C, code(r.fo), pct(p, 1), rpNN(r.n, r.N));
    });
    // à droite : sites à jour selon le risque
    const bx = 112, cw = (RP_SZ.usable - bx) / 2; rpTxt(s, bx, 3, 'Sites à jour selon le risque', { pt: 7, fw: 600 });
    RP_CAT.forEach(([k, l], i) => {
      const o = (E.inFreq.byCat || {})[k] || { n: 0, N: 0 }, x = bx + (i % 2) * cw, y = top + Math.floor(i / 2) * 12;
      rpTxt(s, x, y + 2.4, l, { pt: 7, fill: RP_C.sub }); rpTxt(s, x + cw - 3, y + 2.4, rpNN(o.n, o.N), { pt: 7.5, fw: 600, anchor: 'end', cls: 'rp-val' });
      rpGaugeG(s, x, y + 3.8, cw - 3, 2.6, o.N ? o.n / o.N * 100 : null, 100, { n: o.N ? SMALL_N.low : 0 });
      rpX_(C, 'À jour, risque ' + l, rpNN(o.n, o.N), E.inFreq.ref ? piWin([E.inFreq.ref]) : '');
    });
    const nv = (E.inFreq.byCat || {}).never;
    return [s, rpBase(useVal ? 'Plans validés de ' + rpWin(E.months) + '.' : 'Aucun plan validé ; calendrier du risque, ' + rpWin(E.months) + (nv ? ', dont ' + rpMask(nv.N) + ' sites jamais visités.' : '.'))];
  }
  function rpBlkOrgs(C) {
    const M = C.M, O = M.orgs, rows = O.rows; if (!rows.length) return null;
    const notes = C.o.notes !== 'no', gr = rpAgentGrades('file'), code = rpCoder(rows.filter(o => !o.internal), 'Organisation');
    const W = RP_SZ.usable, RH = 7, top = 5.5, cols = { name: 0, vis: 26, pa: notes ? 72 : 88, gps: notes ? 104 : 134, gr: 136 };
    const s = rpSvg(W, top + rows.length * RH + 1, 'Organisations de suivi : ' + rows.map(o => (o.internal ? 'suivi interne' : code(o.name)) + ' ' + rpMask(o.n) + ' visites').join(', '));
    [['vis', 'Visites, part'], ['pa', 'Par agent et par mois'], ['gps', 'GPS à ' + PILOT.gpsKm + ' km au plus']].concat(notes ? [['gr', 'Agents par note (toute la période)']] : []).forEach(([k, t]) => rpTxt(s, cols[k], 3, t, { pt: 6.5, fill: RP_C.sub }));
    const mxN = Math.max(...rows.map(o => o.n)), mxA = Math.max(1, ...rows.map(o => o.perAgent || 0)) * 1.25;
    rows.forEach((o, i) => {
      const y = top + i * RH, cy = y + RH / 2 + 0.9, g = rpE(s, 'g', {}), nm = o.internal ? 'Suivi interne' : code(o.name);
      if (i) rpE(g, 'line', { x1: 0, x2: W, y1: y, y2: y, stroke: RP_C.line, 'stroke-width': 0.15 });
      rpTxt(g, 0, cy, nm, { pt: 7.5, fw: 600 });
      const bw = 26 * o.n / mxN; rpE(g, 'rect', { x: cols.vis, y: cy - 2.4, width: Math.max(0.6, bw), height: 2.8, rx: 0.6, fill: RP_C.blue });
      rpTxt(g, cols.vis + bw + 1.2, cy - 0.2, rpMask(o.n) + ', ' + pct(o.share, 0), { pt: 7, cls: 'rp-base' });
      const aw = (notes ? 26 : 40); rpE(g, 'line', { x1: cols.pa, x2: cols.pa + aw, y1: cy - 1, y2: cy - 1, stroke: RP_C.track, 'stroke-width': 0.3 });
      if (o.perAgent !== null) { rpE(g, 'circle', { cx: cols.pa + aw * o.perAgent / mxA, cy: cy - 1, r: 1, fill: RP_C.ink }); rpTxt(g, cols.pa + aw + 1.2, cy, fmt(o.perAgent, 1), { pt: 7 }); }
      const gp = o.gN ? o.gn / o.gN * 100 : null; rpGaugeG(g, cols.gps, cy - 2.4, 18, 2.6, gp, 100, { n: o.gN }); rpTxt(g, cols.gps + 19.5, cy - 0.3, gp === null ? '–' : pct(gp, 0), { pt: 7 });
      if (notes) { const G = gr.get(o.name) || gr.get(o.internal ? 'PAM' : o.name) || { A: 0, B: 0, C: 0, D: 0, 'N/N': 0 }; rpStackHG(g, cols.gr, cy - 3, W - cols.gr, 4, RP_GRADES.map((k, j) => ({ n: G[k], label: k === 'N/N' ? 'n.n.' : k, txt: rpMask(G[k]), color: k === 'C' ? RP_C.gradeC : k === 'D' ? RP_C.gradeD : k === 'N/N' ? RP_C.track : RP_C.seg[j + 1] })), { under: false }); }
      bindTip(g, () => nm + ' : ' + fmt(o.n) + ' visites (' + pct(o.share, 1) + '), ' + fmt(o.agents) + ' agents, ' + (o.perAgent === null ? '–' : fmt(o.perAgent, 1)) + ' visites par agent et par mois ; GPS ' + (o.gN ? nOf(o.gn, o.gN, 'fiches') : '–'));
      rpX_(C, nm, rpMask(o.n) + ' visites', pct(o.share, 1) + ' ; ' + (o.perAgent === null ? '–' : fmt(o.perAgent, 1)) + ' par agent et par mois ; GPS ' + (gp === null ? '–' : pct(gp, 0)));
    });
    return [s, rpBase(piWin(M.T.R) + ', ' + rpMask(O.N) + ' visites. Aucun agent nommé.')];
  }
  function rpBlkRel(C) {
    const M = C.M, R = M.rel;
    const yes = [['Visites exploitables', rpNN(R.validR[0], R.validR[1])], ['Partenaire renseigné', rpNN(R.imp[0], R.imp[1])], ['Sites vus deux fois ou plus', rpNN(R.twice[0], R.twice[1])]];
    const no = [['Score toutes activités ' + fmt(R.gScore, 1), 'suit le mélange des activités'], ['Part des visites avec alerte', 'mélange des niveaux différents']];
    if (M.acts.indexOf('SMP') >= 0) no.push(['Détournement SMP ' + rpNN(R.smpDiv[0], R.smpDiv[1]), 'question non traduite, non fiable']);
    yes.forEach(x => rpX_(C, 'Citable : ' + x[0], x[1], '')); no.forEach(x => rpX_(C, 'À ne pas citer : ' + x[0], '', x[1]));
    const li = (ic, k, a, b) => el('li', null, [el('span', { class: 'rp-ic rp-ic-' + k, text: ic }), el('span', { class: 'rp-lt', text: a }), el('span', { class: 'rp-lb rp-base', text: b })]);
    return [el('div', { class: 'rp-two' }, [el('div', null, [el('p', { class: 'rp-sub', text: 'Chiffres citables' }), el('ul', { class: 'rp-ul' }, yes.map(x => li('✓', 'good', x[0], x[1])))]),
      el('div', null, [el('p', { class: 'rp-sub', text: 'À ne pas citer' }), el('ul', { class: 'rp-ul' }, no.map(x => li('✗', 'bad', x[0], x[1])))])])];
  }
  // ---------------------------------------------------------------- FICHE ACTIVITÉ (Revue mensuelle et annexe de la Note)
  function rpActRow(M, a) { return M.rows.find(r => r.a === a) || null; }
  function rpFicheOk(M, a) { const r = rpActRow(M, a); return !!r && r.r.n >= SMALL_N.min; }
  function rpBlkFBand(C) {
    const M = C.M, r = rpActRow(M, C.a); if (!r) return null;
    const band = el('div', { class: 'rp-act-band' }); band.style.borderTopColor = ACT_COLOR[C.a] || RP_C.ink;
    const sites = r.r.sites;
    rpX_(C, 'Statut', PI_VD[r.verdict][1], rpWhyShort(r, M)); rpX_(C, 'Visites', rpMask(r.r.n), rpMask(sites) + ' sites, ' + rpWin(r.win.R));
    return [band, el('div', { class: 'rp-fh' }, [el('h2', { class: 'rp-ftitle', text: ACT[C.a].label }), rpVerdict(r.verdict)]),
      el('p', { class: 'rp-meta' }, [rpMask(r.r.n) + ' visites, ' + rpMask(sites) + ' sites, ' + rpWin(r.win.R) + '. ', el('span', { class: 'rp-auto', text: rpWhyShort(r, M) + '.' })])];
  }
  function rpBlkFScore(C) {
    const M = C.M, r = rpActRow(M, C.a); if (!r || !r.r.n) return null;
    const W = RP_SZ.usable, H = 40, s = rpSvg(W, H, ACT[C.a].short + ' : score ' + fmt(r.r.mean, 1) + ' sur ' + rpMask(r.r.n) + ' visites' + (r.p.n ? ', avant ' + fmt(r.p.mean, 1) : ''));
    const low = r.r.n < PILOT.minN;
    rpTxt(s, 0, 12, fmt(r.r.mean, 1), { pt: 28, fw: 600, fill: low ? RP_C.sub : rpStat(rpCls(r.r.mean)).c, cls: 'rp-val' });
    rpTxt(s, rpTW(fmt(r.r.mean, 1), 28, true) + 2, 12, 'sur 100', { pt: 7.5, fill: RP_C.sub });
    rpTxt(s, 0, 17.5, rpMask(r.r.n) + ' visites' + (low ? ', non concluant' : '') + (r.p.n ? ', avant ' + fmt(r.p.mean, 1) + ' sur ' + rpMask(r.p.n) : ''), { pt: 7.5, fill: RP_C.sub, cls: 'rp-base' });
    const gg = rpGaugeG(s, 0, 24, 72, 6, r.r.mean, 100, { zones: true, n: low ? SMALL_N.min : SMALL_N.low, ref: THR.good, refLabel: 'cible ' + THR.good, prev: r.p.n ? r.p.mean : null, prevLabel: r.p.n ? 'avant ' + fmt(r.p.mean, 1) : '' });
    void gg;
    const ser = rpSeries(M, C.a), sx = 88, sw = 82;
    rpTxt(s, sx, 3, 'Score par mois', { pt: 7, fw: 600 }); rpSparkG(s, sx, 5, sw, 15, ser, { win: r.win.R, refLabel: true, volLabel: true });
    rpTxt(s, sx, 25, 'Visites avec alerte grave', { pt: 7, fw: 600 }); rpSparkG(s, sx, 27, sw, 11, ser, { kind: 'pct', win: r.win.R, vol: false });
    ser.forEach((p, i) => { if (i % 2 === 0 || i === ser.length - 1) rpTxt(s, sx + 1.2 + i * (sw - 2.4) / (ser.length - 1), H - 0.2, PI_MS[+p.m.slice(5) - 1], { pt: 5.5, anchor: 'middle', fill: RP_C.sub }); });
    ser.forEach(p => rpX_(C, 'Score ' + piWin([p.m]), rpN(p.n) === 'none' ? '–' : fmt(p.score, 1), rpMask(p.n) + ' visites ; graves ' + rpMask(p.grave)));
    return [s];
  }
  function rpBlkFDom(C) {
    const M = C.M, r = rpActRow(M, C.a); if (!r) return null;
    const L = ovDomRows(C.a, rpWinVisits(M, C.a, r.win.R)).sort((p, q) => p.v - q.v).slice(0, 10); if (!L.length) return null;
    L.forEach(x => rpX_(C, x.d, rpN(x.n) === 'none' ? '–' : fmt(x.v, 1), rpMask(x.n) + ' visites'));
    return [rpBars(L.map(x => ({ label: rpDomLabel(x.d), v: x.v, n: x.n, ntxt: rpMask(x.n), tip: x.d + ' : ' + fmt(x.v, 1) + ' sur 100, ' + fmt(x.n) + ' visites' })), { w: 91, lw: 40, bw: 30, ref: THR.good, aria: 'Domaines de ' + ACT[C.a].short })];
  }
  function rpBlkFNorm(C) {
    const M = C.M, r = rpActRow(M, C.a); if (!r || !D.items[C.a]) return null;
    const n = +(C.o.n || 5), xR = rpWinVisits(M, C.a, r.win.R), xP = rpWinVisits(M, C.a, r.win.P);
    const sys = new Set(((M.norms.find(o => o.a === C.a) || {}).sys || []).map(q => q.j));
    const drops = C.o.mode === 'low' || !xP.length ? [] : rpNormDelta(C.a, xR, xP).slice(0, n);
    if (drops.length) {
      const W = 91, LW = 40, AW = 34, RH = 5.5, top = 3.4, s = rpSvg(W, top + drops.length * RH + 0.5, 'Normes en baisse : ' + drops.map(o => rpShortQ(o.m.label, 30) + ' ' + fmt(o.d, 1)).join(', '));
      const X = v => LW + v / 100 * AW; rpTxt(s, LW, top - 1, '0', { pt: 6, fill: RP_C.sub }); rpTxt(s, LW + AW, top - 1, '100', { pt: 6, fill: RP_C.sub, anchor: 'end' });
      drops.forEach((o, i) => {
        const y = top + i * RH + RH / 2, g = rpE(s, 'g', {});
        rpTxt(g, 0, y + 0.9, rpShortQ(o.m.label, 30), { pt: 7 }); rpE(g, 'line', { x1: LW, x2: LW + AW, y1: y, y2: y, stroke: RP_C.track, 'stroke-width': 0.3 });
        rpE(g, 'line', { x1: X(o.pR), x2: X(o.pP), y1: y, y2: y, stroke: RP_C.ink, 'stroke-width': 0.4 });
        rpE(g, 'circle', { cx: X(o.pP), cy: y, r: 0.9, fill: '#fff', stroke: RP_C.prev, 'stroke-width': 0.3 }); rpE(g, 'circle', { cx: X(o.pR), cy: y, r: 1.1, fill: RP_C.ink });
        rpTxt(g, LW + AW + 1.5, y + 0.9, '−' + fmt(-o.d, 1), { pt: 7, fw: 600, fill: RP_C.st.bad.tx, cls: 'rp-val' });
        if (sys.has(o.j)) rpTxt(g, W, y + 0.9, 'partout', { pt: 6.5, anchor: 'end', fill: RP_C.sub });
        bindTip(g, () => o.m.label + '\n' + pct(o.pR, 1) + ' sur ' + fmt(o.nR) + ' visites contre ' + pct(o.pP, 1) + ' sur ' + fmt(o.nP));
        rpX_(C, rpShortQ(o.m.label, 60), pct(o.pR, 1), 'avant ' + pct(o.pP, 1) + ' ; ' + rpMask(o.nR) + ' et ' + rpMask(o.nP) + ' visites');
      });
      return { title: 'Normes en baisse', kids: [s, rpBase(rpWin(r.win.R) + ' contre ' + rpWin(r.win.P) + '.')] };
    }
    const okSet = new Set(xR.map(v => v.i)), low = D.items[C.a].meta.map((m, j) => ovItemCounts(C.a, j, okSet)).filter(z => nStatus(z.n) === 'ok').sort((p, q) => p.p - q.p).slice(0, n);
    if (!low.length) return null;
    low.forEach(z => rpX_(C, rpShortQ(z.m.label, 60), pct(z.p, 1), rpMask(z.n) + ' visites'));
    return { title: 'Normes les plus basses', kids: [rpBars(low.map(z => ({ label: rpShortQ(z.m.label, 40), v: z.p, n: z.n, ntxt: rpMask(z.n) + (sys.has(z.j) ? ', partout' : ''), tip: z.m.label + ' : ' + pct(z.p, 1) + ' sur ' + fmt(z.n) + ' visites' })), { w: 91, lw: 40, bw: 26, ref: THR.mid, aria: 'Normes les plus basses' })] };
  }
  function rpBlkFAlert(C) {
    const M = C.M, r = rpActRow(M, C.a); if (!r) return null;
    const x = rpWinVisits(M, C.a, r.win.R); if (!x.length) return null;
    const T = ovTierCounts(x), rows = ovAlertRows(x, C.a).filter(z => z.n).sort(ovAlertSort), W = 91, s = rpSvg(W, 3 * 9 + 1, 'Alertes : grave ' + rpNN(T.t1, T.N) + ', à vérifier ' + rpNN(T.t2, T.N) + ', gestion ' + rpNN(T.t3, T.N));
    [[1, 't1'], [2, 't2'], [3, 't3']].forEach(([t, k], i) => {
      const y = i * 9, d = ovTierDef(t), top = rows.find(z => z.tier === t);
      rpTxt(s, 0, y + 3.4, d.short, { pt: 7, fw: 600 });
      rpBar100G(s, 18, y + 0.9, 36, 3.4, [{ n: T[k], color: RP_C.tier[t] }], { N: T.N });
      rpTxt(s, 56, y + 3.4, rpPct(T[k], T.N) + ' (' + rpNN(T[k], T.N) + ')', { pt: 7, cls: 'rp-base' });
      rpTxt(s, 18, y + 7.4, top ? rpCut(top.label, 44) + ' ' + rpMask(top.n) : 'aucune', { pt: 6.5, fill: RP_C.sub });
      rpX_(C, 'Alertes ' + d.short, rpPct(T[k], T.N), rpNN(T[k], T.N) + (top ? ' ; surtout ' + top.label : ''));
    });
    const cz = ovAlertRows(x, C.a).filter(z => z.n && z.tier === 'c');
    return [s, cz.length ? rpBase('À confirmer : ' + cz.map(z => rpCut(z.label.replace(/\s*\(.*\)\s*$/, ''), 40) + ' ' + rpMask(z.n)).join(', ') + ', question non traduite.') : null];
  }
  function rpBlkFCouv(C) {
    const M = C.M, r = rpActRow(M, C.a); if (!r) return null;
    const W = 91, ips = D.imps.rows.filter(x => x[0] === C.a), hasImp = ips.length > 0, gi = D.imps.cols.indexOf('grade');
    const blind = M.blind.blind.filter(z => z.act === C.a).length, H = hasImp ? 26 : 16, s = rpSvg(W, H, 'Couverture et partenaires de ' + ACT[C.a].short);
    rpTxt(s, 0, 3, 'Sites actifs vus', { pt: 7, fw: 600 });
    if (r.covOk) { rpBar100G(s, 0, 5, 56, 4, [{ n: r.cov.visited, color: RP_C.blue }], { N: r.cov.planned }); rpTxt(s, 58, 8, pct(r.covP100, 0) + ' (' + rpNN(r.cov.visited, r.cov.planned) + ')', { pt: 7, cls: 'rp-base' }); rpX_(C, 'Sites vus', pct(r.covP100, 1), rpNN(r.cov.visited, r.cov.planned)); }
    else rpTxt(s, 0, 8, 'Pas de plan pour cette activité', { pt: 7, fill: RP_C.sub });
    rpTxt(s, 0, 13.5, blind ? rpMask(blind) + ' zone' + (blind > 1 ? 's' : '') + ' sans visite depuis ' + PILOT.blindMonths + ' mois' : 'Aucune zone sans visite', { pt: 7, fill: blind ? RP_C.st.bad.tx : RP_C.sub });
    if (hasImp) {
      const G = { A: 0, B: 0, C: 0, D: 0, 'N/N': 0 }; ips.forEach(x => { G[RP_GRADES.indexOf(x[gi]) >= 0 ? x[gi] : 'N/N']++; });
      rpTxt(s, 0, 18.5, 'Partenaires par note', { pt: 7, fw: 600 });
      rpStackHG(s, 0, 20, 60, 4, RP_GRADES.map((k, j) => ({ n: G[k], label: k === 'N/N' ? 'n.n.' : k, txt: rpMask(G[k]), color: k === 'C' ? RP_C.gradeC : k === 'D' ? RP_C.gradeD : k === 'N/N' ? RP_C.track : RP_C.seg[j + 1] })), { under: false });
      rpTxt(s, 62, 23.2, rpMask(ips.length) + ' partenaires', { pt: 6.5, fill: RP_C.sub });
      RP_GRADES.forEach(k => rpX_(C, 'Partenaires note ' + k, rpMask(G[k]), ''));
    }
    const cd = hasImp && !rpDiff() ? ips.filter(x => x[gi] === 'C' || x[gi] === 'D').map(x => x[1]) : [];
    return [s, hasImp ? rpBase('Notes sur toute la période du fichier' + (cd.length ? '. Notés C ou D : ' + cd.join(', ') + '.' : '.')) : rpBase('Partenaire non renseigné dans les formulaires.')];
  }
  function rpBlkFKeep(C) {
    const M = C.M, r = rpActRow(M, C.a); if (!r) return null;
    const x = rpWinVisits(M, C.a, r.win.R), how = x.length ? (ovWhyHow(C.a, x).how[0] || null) : null;
    const def = rpWhyShort(r, M) + '.' + (how ? ' ' + rpCap(String(how[1]).replace(/^[^:]*:\s*/, '')) : '');
    const ed1 = ovEd('p', 'rp-act-' + C.a, rpCut(def, 300), 'rp-keep rp-auto'), ed2 = ovEd('p', 'rp-com-' + C.a, '', 'rp-com');
    ed2.setAttribute('data-ph', 'Ajouter un commentaire du bureau');
    [ed1, ed2].forEach(n => n.addEventListener('input', () => { if (n.textContent.length > 300) n.textContent = n.textContent.slice(0, 300); }));
    rpX_(C, 'À retenir', ed1.textContent, '');
    return [ed1, ed2];
  }
  // ---------------------------------------------------------------- page « Décisions et suivi »
  function rpBlkDec1(C) {
    const M = C.M, list = M.subjects.top.concat(M.subjects.others); if (!list.length) return [el('p', { class: 'rp-empty', text: 'Aucun sujet ne remplit une règle de décision.' })];
    const t = el('table', { class: 'rp-t rp-dec2' }); t.appendChild(el('thead', null, el('tr', null, ['N°', 'Sujet', 'Constat', 'Qui', 'Statut'].map(h => el('th', { scope: 'col', text: h })))));
    const tb = el('tbody');
    list.forEach((s, i) => {
      const o = piStore()[s.key], st = o ? o.s || 0 : 0, fact = rpCut(String(s.fact).replace(/\.$/, ''), 104);   // deux lignes au plus ; le texte complet est dans l'infobulle et le tiroir
      const tr = el('tr', { class: i >= M.subjects.top.length ? 'rp-other' : '' }, [el('td', { class: 'rp-no', text: String(i + 1) }), el('td', { class: 'rp-subj', text: s.title }), el('td', { class: 'rp-auto rp-2l', text: fact }), el('td', { text: rpRoleShort(s.route.role) }), el('td', null, el('span', { class: 'rp-box rp-st rp-st' + st, text: piStatusText(s.key) }))]);
      bindTip(tr.children[2], () => s.fact); bindTip(tr.children[3], () => s.route.role);
      rpClickable(tr, rpOpen(M, () => piSubjectDrawer(M, s)), s.title); tb.appendChild(tr);
      rpX_(C, s.title, fact, s.route.role + ' ; ' + piStatusText(s.key));
    });
    t.appendChild(tb); return [t];
  }
  function rpBlkDec2(C) {
    const M = C.M, fk = piFiltKey(), sn = piSnaps().filter(x => x && x.fk === fk && x.k === M.T.k && x.E < M.T.E).slice(-1)[0];
    if (!sn) return [el('p', { class: 'rp-empty', text: 'Aucune revue figée : le suivi commencera après « Figer cette revue ».' })];
    const now = new Set(M.subjects.top.concat(M.subjects.others).map(s => s.key)), title = k => { const s = M.subjects.top.concat(M.subjects.others).find(x => x.key === k); return s ? s.title : k.replace(/^[A-E]\d?\|/, ''); };
    const t = el('table', { class: 'rp-t' }); t.appendChild(el('thead', null, el('tr', null, ['Sujet', 'Statut', 'Aujourd’hui'].map(h => el('th', { scope: 'col', text: h })))));
    t.appendChild(el('tbody', null, (sn.subjects || []).map(k => { rpX_(C, title(k), piStatusText(k), now.has(k) ? 'le signal persiste' : 'le signal a disparu'); return el('tr', null, [el('td', { text: title(k) }), el('td', { text: piStatusText(k) }), el('td', null, el('span', { class: 'rp-st ' + (now.has(k) ? 'rp-tx-bad' : 'rp-tx-good'), text: now.has(k) ? '! le signal persiste' : '✓ le signal a disparu' }))]); })));
    return [rpBase('Revue figée le ' + dFrUI(sn.at) + ', fenêtre finissant en ' + piWin([sn.E]) + '.'), t];
  }
  function rpBlkSign(C) {
    const roles = [['Préparé par', 'p'], ['Revu par', 'r'], ['Validé par', 'v']];
    return [el('div', { class: 'rp-sign' }, roles.map(([l, k]) => el('div', { class: 'rp-sig' }, [el('div', { class: 'rp-sub', text: l }), ovEd('div', 'sig-n-' + k, '…', 'rp-sigl'), ovEd('div', 'sig-f-' + k, '…', 'rp-sigl rp-base'), ovEd('div', 'sig-d-' + k, '…', 'rp-sigl rp-base'), el('div', { class: 'rp-sigbox' })])))];
  }
  // ---------------------------------------------------------------- REVUE PARTENAIRES (période des filtres)
  function rpPartners(M) {
    return rpX('partners', () => {
      const cnt = new Map(); M.sel.forEach(v => { const nm = DICT.imp[v.imp]; if (nm) cnt.set(nm, (cnt.get(nm) || 0) + 1); });
      const code = rpCoder(Array.from(cnt.entries()).map(([name, n]) => ({ name, n })), 'Partenaire');
      const acts = [], noImp = [];
      M.acts.forEach(a => {
        const x = M.sel.filter(v => v.act === a); if (!x.length) return;
        const rows = ovImpRows(a, x).sort((p, q) => (q.n - p.n) || p.imp.localeCompare(q.imp, 'fr'));
        const withImp = sum(rows.map(r => r.n));
        if (!rows.length) { noImp.push({ a, n: x.length - withImp, N: x.length, x }); return; }
        const all = rpMeanCI(x.map(v => v.score));
        acts.push({ a, mean: all.m, N: x.length, rows: rows.map(r => {
          const ci = rpMeanCI(r.x.map(v => v.score)), none = r.n < GRADE_SCALES.imp.minN;
          const resp = { imp: 0, sh: 0, ctx: 0, none: 0 }; r.x.forEach(v => { const cs = (v.risks || []).map(k => ENGINE.alertResp(RISK[k].code)); resp[cs.indexOf('imp') >= 0 ? 'imp' : cs.indexOf('sh') >= 0 ? 'sh' : cs.indexOf('ctx') >= 0 ? 'ctx' : 'none']++; });
          const mark = none || ci.n < 2 ? null : ci.hi < all.m ? 'bad' : ci.lo > all.m ? 'good' : null;
          return { name: r.imp, code: code(r.imp), n: r.n, ci, none, grade: r.eng ? r.eng[7] : 'N/N', resp, t1: r.T.t1, mark, x: r.x };
        }) });
        if (x.length > withImp) noImp.push({ a, n: x.length - withImp, N: x.length, x, partial: true });
      });
      return { acts, noImp, code };
    });
  }
  function rpGradeChip(p, x, y, g) {
    const k = g === 'A' || g === 'B' ? 'good' : g === 'C' ? 'mid' : g === 'D' ? 'bad' : 'na', S = rpStat(k);
    rpE(p, 'rect', { x, y: y - 2.6, width: 5, height: 3.4, rx: 1, fill: S.bg }); rpTxt(p, x + 2.5, y - 0.2, g === 'N/N' ? 'n.n.' : g, { pt: 6.5, anchor: 'middle', fill: S.tx, fw: 600 });
  }
  function rpBlkPmeo(C) {
    const M = C.M, P = rpPartners(M), ci = C.o.ci !== 'no', resp = C.o.resp !== 'no'; if (!P.acts.length) return null;
    const W = RP_SZ.usable, LW = 34, AX = LW, AW = resp ? 62 : 96, NX = AX + AW + 3, RX = NX + 16, RW = 38, GX = W, RH = 5.5, HH = 8;
    let H = 4; P.acts.forEach(o => { H += HH + o.rows.length * RH + 2; });
    const s = rpSvg(W, H, 'Conformité par partenaire : ' + P.acts.map(o => ACT[o.a].short + ' ' + o.rows.length + ' partenaires').join(', '));
    const X = v => AX + (Math.max(50, Math.min(100, v)) - 50) / 50 * AW;
    rpTxt(s, AX, 3, '50', { pt: 6, fill: RP_C.sub }); rpTxt(s, AX + AW, 3, '100', { pt: 6, anchor: 'end', fill: RP_C.sub }); rpTxt(s, NX, 3, 'Visites, note', { pt: 6, fill: RP_C.sub });
    if (resp) { let lx = RX; [['partenaire', RP_C.st.bad.bg], ['partagées', RP_C.st.mid.bg], ['contexte', '#dfe3e8']].forEach(([l, c]) => { rpE(s, 'rect', { x: lx, y: 0.9, width: 2.4, height: 2.4, fill: c }); rpTxt(s, lx + 3, 3, l, { pt: 6, fill: RP_C.sub }); lx += 4 + rpTW(l, 6); }); rpTxt(s, GX, 3, 'Graves', { pt: 6, anchor: 'end', fill: RP_C.sub }); }
    let y = 4;
    P.acts.forEach(o => {
      rpTxt(s, 0, y + 5, ACT[o.a].short, { pt: 8, fw: 600 }); rpTxt(s, Math.max(22, rpTW(ACT[o.a].short, 8, true) * 1.2 + 2), y + 5, rpMask(o.N) + ' visites', { pt: 6.5, fill: RP_C.sub });
      const y0 = y + HH - 1.6, y1 = y + HH + o.rows.length * RH;
      rpE(s, 'line', { x1: X(THR.good), x2: X(THR.good), y1: y0, y2: y1, stroke: RP_C.ink, 'stroke-width': 0.3 }); rpTxt(s, X(THR.good), y0 - 0.6, 'cible ' + THR.good, { pt: 6, anchor: 'middle' });
      if (rpNum(o.mean)) { rpE(s, 'line', { x1: X(o.mean), x2: X(o.mean), y1: y0, y2: y1, stroke: RP_C.ink, 'stroke-width': 0.25, 'stroke-dasharray': '0.8 0.6' }); rpTxt(s, X(o.mean), y0 - 3.2, 'moyenne ' + fmt(o.mean, 1), { pt: 6, anchor: Math.abs(X(o.mean) - X(THR.good)) < 14 ? (o.mean > THR.good ? 'start' : 'end') : 'middle', fill: RP_C.sub }); }
      y += HH;
      o.rows.forEach((r, i) => {
        const cy = y + RH / 2, g = rpE(s, 'g', {});
        if (i % 2) rpE(g, 'rect', { x: 0, y, width: W, height: RH, fill: RP_C.shade });
        rpTxt(g, 0, cy + 0.9, rpCut(r.code, 24), { pt: 7 });
        rpDotRowG(g, AX, cy, AW, 50, 100, r.none ? { none: true } : { v: r.ci.m, lo: ci ? r.ci.lo : null, hi: ci ? r.ci.hi : null }, {});
        if (r.mark) rpTxt(g, r.none ? AX + 30 : Math.min(AX + AW - 1, X(Math.max(r.ci.hi, r.ci.m)) + 2), cy + 0.9, rpStat(r.mark).ic, { pt: 7.5, fw: 600, fill: rpStat(r.mark).c, cls: 'rp-st' });
        rpTxt(g, NX + 7, cy + 0.9, rpMask(r.n), { pt: 7, anchor: 'end', cls: 'rp-base' }); rpGradeChip(g, NX + 8.5, cy + 1.6, r.grade);
        if (resp) {
          const tot = r.n; let cx = RX; [['imp', RP_C.st.bad.bg], ['sh', RP_C.st.mid.bg], ['ctx', '#dfe3e8'], ['none', RP_C.track]].forEach(([k, col]) => { const w = tot ? r.resp[k] / tot * RW : 0; if (w > 0) rpE(g, 'rect', { x: cx, y: cy - 1.6, width: w, height: 3.2, fill: col, stroke: '#fff', 'stroke-width': 0.15 }); cx += w; });
          rpTxt(g, RX + RW + 1.2, cy + 0.9, rpPct(r.resp.imp, r.n), { pt: 6.5, fill: r.resp.imp / Math.max(1, r.n) * 100 >= THR.rLow ? RP_C.st.bad.tx : RP_C.sub });
          rpTxt(g, GX, cy + 0.9, rpNN(r.t1, r.n), { pt: 6.5, anchor: 'end', fill: r.t1 ? RP_C.ink : RP_C.sub });
        }
        bindTip(g, () => r.code + ' (' + ACT[o.a].short + ') : ' + (r.none ? 'moins de ' + GRADE_SCALES.imp.minN + ' visites' : 'score ' + fmt(r.ci.m, 1) + ' [' + fmt(r.ci.lo, 1) + '–' + fmt(r.ci.hi, 1) + '] sur ' + fmt(r.n) + ' visites, moyenne de l’activité ' + fmt(o.mean, 1)) + (r.mark ? '\n' + (r.mark === 'bad' ? '✗ écart démontré, sous la moyenne' : '✓ au-dessus de la moyenne') : '') + '\nAlertes qui relèvent du partenaire : ' + rpNN(r.resp.imp, r.n) + ', partagées ' + fmt(r.resp.sh) + ', contexte ' + fmt(r.resp.ctx) + '\nNote (toute la période) : ' + (r.grade === 'N/N' ? 'non noté' : r.grade));
        rpX_(C, ACT[o.a].short + ', ' + r.code, r.none ? 'moins de ' + GRADE_SCALES.imp.minN + ' visites' : fmt(r.ci.m, 1), rpMask(r.n) + ' visites ; IC ' + (r.none ? '–' : fmt(r.ci.lo, 1) + '–' + fmt(r.ci.hi, 1)) + ' ; note ' + r.grade + ' ; alertes du partenaire ' + rpNN(r.resp.imp, r.n) + ' ; graves ' + rpNN(r.t1, r.n) + (r.mark === 'bad' ? ' ; écart démontré' : ''));
        y += RH;
      });
      y += 2;
    });
    const nb = sum(P.acts.map(o => o.rows.filter(r => r.mark === 'bad').length));
    return [s, rpBase('✗ écart démontré : intervalle à 95 % sous la moyenne de l’activité (' + rpMask(nb) + ' partenaire' + (nb > 1 ? 's' : '') + '). Note : toute la période.')];
  }
  function rpBlkDistricts(C) {
    const M = C.M, P = rpPartners(M), list = P.noImp.filter(o => !o.partial); if (!list.length) return null;
    const W = RP_SZ.usable, LW = 30, AW = 124, RH = rpDiff() ? 13 : 19, s = rpSvg(W, list.length * RH + 4, 'Districts des activités sans partenaire renseigné');
    const X = v => LW + (Math.max(50, Math.min(100, v)) - 50) / 50 * AW;
    rpTxt(s, LW, 3, '50', { pt: 6, fill: RP_C.sub }); rpTxt(s, LW + AW, 3, '100', { pt: 6, anchor: 'end', fill: RP_C.sub });
    list.forEach((o, i) => {
      const y = 4 + i * RH + RH / 2, by = new Map(); o.x.forEach(v => { let l = by.get(v.district); if (!l) by.set(v.district, l = []); l.push(v.score); });
      const all = rpMeanCI(o.x.map(v => v.score)), pts = Array.from(by.entries()).map(([d, sc]) => ({ d, ci: rpMeanCI(sc) })).filter(p => p.ci.n >= SMALL_N.low), mx = Math.max(1, ...pts.map(p => p.ci.n));
      rpTxt(s, 0, y + 0.9, ACT[o.a].short, { pt: 8, fw: 600 });
      rpE(s, 'line', { x1: LW, x2: LW + AW, y1: y, y2: y, stroke: RP_C.track, 'stroke-width': 0.3 });
      const boxes = [];
      if (rpNum(all.m)) { rpE(s, 'line', { x1: X(all.m), x2: X(all.m), y1: y - 4.5, y2: y + 4.5, stroke: RP_C.ink, 'stroke-width': 0.25, 'stroke-dasharray': '0.8 0.6' }); const ml = 'moyenne ' + fmt(all.m, 1); rpTxt(s, X(all.m), y - 5, ml, { pt: 6, anchor: 'middle', fill: RP_C.sub }); boxes.push([X(all.m) - rpTW(ml, 6) / 2 - 1, y - 5, rpTW(ml, 6) + 2]); }
      rpE(s, 'line', { x1: X(THR.good), x2: X(THR.good), y1: y - 3, y2: y + 3, stroke: RP_C.ink, 'stroke-width': 0.35 });
      pts.forEach(p => {
        const out = p.ci.hi < all.m ? 'bad' : p.ci.lo > all.m ? 'good' : null, r = 0.8 + 2 * Math.sqrt(p.ci.n / mx);
        const c = rpE(s, 'circle', { cx: X(p.ci.m), cy: y, r, fill: out ? rpStat(out).c : RP_C.prev, 'fill-opacity': 0.5, stroke: out ? rpStat(out).c : RP_C.sub, 'stroke-width': 0.2 });
        if (!rpDiff()) bindTip(c, () => (DICT.district[p.d] || '–') + ' : ' + fmt(p.ci.m, 1) + ' sur ' + fmt(p.ci.n) + ' visites, intervalle ' + fmt(p.ci.lo, 1) + '–' + fmt(p.ci.hi, 1));
        p.out = out; p.r = r;
      });
      // noms des districts dont l'intervalle exclut la moyenne (interne) : rangées alternées sous et sur la ligne, sans chevauchement, trait de rappel
      if (!rpDiff()) pts.filter(p => p.out).sort((a, b) => Math.abs(b.ci.m - all.m) - Math.abs(a.ci.m - all.m)).slice(0, 8).forEach(p => {
        const t = rpCut(DICT.district[p.d] || '', 18), w = rpTW(t, 6) * 1.15 + 3, cx = Math.max(LW + w / 2, Math.min(LW + AW - w / 2, X(p.ci.m))), x0 = cx - w / 2;
        const tries = [[y + 6.2, 1], [y - 4.6, -1], [y + 8.8, 1], [y - 7.2, -1]];
        const hit = tries.find(([ty]) => !boxes.some(b => x0 < b[0] + b[2] && x0 + w > b[0] && Math.abs(ty - b[1]) < 2.5));
        if (!hit) return; const [ty, dir] = hit; boxes.push([x0, ty, w]);
        rpE(s, 'line', { x1: X(p.ci.m), x2: X(p.ci.m), y1: y + dir * p.r, y2: dir > 0 ? ty - 2.2 : ty + 0.6, stroke: RP_C.prev, 'stroke-width': 0.2 });
        rpTxt(s, cx, ty, t, { pt: 6, anchor: 'middle', fill: rpStat(p.out).tx, halo: true });
      });
      rpTxt(s, LW + AW + 3, y + 0.9, rpMask(pts.length) + ' districts', { pt: 6.5, fill: RP_C.sub, cls: 'rp-base' });
      rpX_(C, ACT[o.a].short + ' districts', rpMask(pts.length), 'moyenne ' + fmt(all.m, 1));
    });
    return [el('p', { class: 'rp-alertl' }, 'Partenaire non renseigné : ' + list.map(o => ACT[o.a].short + ' ' + rpMask(o.n) + ' visites sur ' + rpMask(o.N)).join(', ')), s, rpBase('Un point par district d’au moins ' + SMALL_N.low + ' visites ; nommé si son intervalle exclut la moyenne' + (rpDiff() ? ' (version interne seulement).' : '.'))];
  }
  function rpOrgName(o, code) { return /^PAM$/i.test(o) ? 'Suivi interne' : code(o); }
  function rpOrgList() { const R = rpOrgScored(); return (R.ORG || []).filter(o => o.org && o.org !== '(Non renseigné)').sort((a, b) => (/^PAM$/i.test(a.org) - /^PAM$/i.test(b.org)) || (b.n - a.n)); }
  function rpBlkOrgQual(C) {
    const L = rpOrgList(); if (!L.length) return null;
    const code = rpCoder(L.filter(o => !/^PAM$/i.test(o.org)).map(o => ({ name: o.org, n: o.n })), 'Organisation'), crit = ENGINE.AG_CRIT;
    const defs = [['valid', 'Fiches exploitables', o => [o.valid_n, o.n]], ['gps', 'GPS à ' + PILOT.gpsKm + ' km au plus', o => [o.gps_near, o.gps_base]], ['listname', 'Nom pris dans la liste', o => [o.list_ok, o.list_base]]];
    const W = RP_SZ.usable, LW = 28, MW = (W - LW) / 3, AW = MW - 14, RH = 5.5, top = 8, s = rpSvg(W, top + L.length * RH + 1, 'Qualité de la collecte des organisations de suivi');
    L.forEach((o, i) => { const y = top + i * RH + RH / 2; if (i % 2) rpE(s, 'rect', { x: 0, y: y - RH / 2, width: W, height: RH, fill: RP_C.shade }); rpTxt(s, 0, y + 0.9, rpOrgName(o.org, code), { pt: 7, fw: 600 }); });
    defs.forEach(([k, lab, f], j) => {
      const c = crit.find(x => x.k === k), ax = LW + j * MW, X = v => ax + Math.max(0, Math.min(100, v)) / 100 * AW;
      rpTxt(s, ax, 3, lab, { pt: 7, fw: 600 });
      if (c) [[0, c.warn, 'bad'], [c.warn, c.thr, 'mid'], [c.thr, 100, 'good']].forEach(([a, b, kk]) => rpE(s, 'rect', { x: X(a), y: top - 1, width: X(b) - X(a), height: L.length * RH + 1, fill: rpStat(kk).c, 'fill-opacity': 0.08 }));
      rpTxt(s, ax, top - 1.6, '0', { pt: 5.5, fill: RP_C.sub }); if (c) rpTxt(s, X(c.thr), top - 1.6, 'seuil ' + c.thr, { pt: 5.5, anchor: X(c.thr) > ax + AW - 8 ? 'end' : 'middle', fill: RP_C.sub }); if (!c || X(c.thr) < ax + AW - 12) rpTxt(s, ax + AW, top - 1.6, '100', { pt: 5.5, anchor: 'end', fill: RP_C.sub });
      L.forEach((o, i) => {
        const [n, N] = f(o), y = top + i * RH + RH / 2, g = rpE(s, 'g', {});
        if (!N || N < SMALL_N.min) { rpTxt(g, ax + 1, y + 0.9, '–', { pt: 7, fill: RP_C.sub }); return; }
        const p = n / N * 100, w = rpWilson(n, N); rpDotRowG(g, ax, y, AW, 0, 100, { v: p, lo: w[0], hi: w[1], low: rpN(N) === 'low' }, {});
        rpTxt(g, ax + AW + 1.2, y + 0.9, pct(p, 0), { pt: 6.5, cls: 'rp-base' });
        bindTip(g, () => rpOrgName(o.org, code) + ', ' + lab + ' : ' + rpNN(n, N) + ' (' + pct(p, 1) + ', intervalle ' + fmt(w[0], 0) + '–' + fmt(w[1], 0) + ')' + (c ? '\nSeuil ' + c.thr + ', vigilance ' + c.warn : ''));
        rpX_(C, rpOrgName(o.org, code) + ', ' + lab, pct(p, 1), rpNN(n, N));
      });
    });
    return [s];
  }
  function rpDurTxt(m) { if (!rpNum(m)) return '–'; if (m < 60) return fmt(m, 0) + ' min'; const h = Math.floor(m / 60), mm = Math.round(m - h * 60); return h + ' h ' + String(mm).padStart(2, '0'); }
  function rpBlkDur(C) {
    const L = rpOrgList().filter(o => o.dur_n > 0); if (!L.length) return null;
    const code = rpCoder(rpOrgList().filter(o => !/^PAM$/i.test(o.org)).map(o => ({ name: o.org, n: o.n })), 'Organisation');
    const AG = rpOrgScored().AG || [], q = (a, p) => { const b = a.filter(rpNum).sort((x, y) => x - y); if (!b.length) return null; const i = (b.length - 1) * p, lo = Math.floor(i), up = Math.ceil(i); return b[lo] + (b[up] - b[lo]) * (i - lo); };
    const band = new Map(L.map(o => { const v = AG.filter(a => a.org === o.org && a.n >= GRADE_SCALES.agent.minN).map(a => a.dur_med_ok); return [o.org, v.filter(rpNum).length >= 2 ? [q(v, 0.25), q(v, 0.75)] : null]; }));
    const meds = L.map(o => o.dur_med_ok).filter(rpNum).concat([].concat.apply([], Array.from(band.values()).filter(Boolean))), hi = Math.max(60, Math.ceil(Math.max(...meds) / 60) * 60), W = 91, LW = 26, AW = 34, RH = 5.5, top = 5.5;
    const s = rpSvg(W, top + L.length * RH + 1, 'Durée médiane des fiches par organisation'), X = v => LW + Math.max(0, Math.min(hi, v)) / hi * AW;
    rpTxt(s, LW, top - 1.4, '0', { pt: 5.5, fill: RP_C.sub }); rpTxt(s, LW + AW, top - 1.4, rpDurTxt(hi), { pt: 5.5, anchor: 'end', fill: RP_C.sub }); rpTxt(s, LW + AW + 3, top - 1.4, 'finalisées en 24 h', { pt: 6, fill: RP_C.sub });
    L.forEach((o, i) => {
      const y = top + i * RH + RH / 2, g = rpE(s, 'g', {});
      rpTxt(g, 0, y + 0.9, rpOrgName(o.org, code), { pt: 7 });
      const bd = band.get(o.org); if (bd) rpE(g, 'rect', { x: X(bd[0]), y: y - 1.3, width: Math.max(0.5, X(bd[1]) - X(bd[0])), height: 2.6, rx: 1.3, fill: RP_C.vol, 'fill-opacity': 0.7 });
      rpE(g, 'line', { x1: LW, x2: LW + AW, y1: y, y2: y, stroke: RP_C.track, 'stroke-width': 0.2 });
      if (rpNum(o.dur_med_ok)) { rpE(g, 'circle', { cx: X(o.dur_med_ok), cy: y, r: 1, fill: RP_C.ink }); const rt = X(o.dur_med_ok) > LW + AW - 10; rpTxt(g, X(o.dur_med_ok) + (rt ? -1.6 : 1.6), y - 1.2, rpDurTxt(o.dur_med_ok), { pt: 6, fill: RP_C.ink, anchor: rt ? 'end' : 'start', halo: true }); }
      rpTxt(g, LW + AW + 3, y + 0.9, rpNN(o.dur_le24, o.dur_n), { pt: 7, cls: 'rp-base' });
      bindTip(g, () => rpOrgName(o.org, code) + ' : médiane ' + rpDurTxt(o.dur_med_ok) + ' (fiches de 3 min à 10 h), finalisées en 24 h ' + rpNN(o.dur_le24, o.dur_n));
      rpX_(C, rpOrgName(o.org, code) + ' durée médiane', rpDurTxt(o.dur_med_ok), 'en 24 h ' + rpNN(o.dur_le24, o.dur_n));
    });
    return [s, rpBase('Point : médiane des fiches de 3 min à 10 h. Bande grise : moitié centrale des agents. Aucune référence validée.')];
  }
  function rpBlkAgents(C) {
    const L = rpOrgList(), G = rpAgentGrades('filters'); if (!L.length) return null;
    const code = rpCoder(L.filter(o => !/^PAM$/i.test(o.org)).map(o => ({ name: o.org, n: o.n })), 'Organisation');
    const W = 91, LW = 26, RH = 5.5, top = 1, mx = Math.max(1, ...L.map(o => { const g = G.get(o.org) || {}; return sum(RP_GRADES.map(k => g[k] || 0)); }));
    const s = rpSvg(W, top + L.length * RH + 1, 'Agents par note, sans nom');
    L.forEach((o, i) => {
      const y = top + i * RH, g = G.get(o.org) || { A: 0, B: 0, C: 0, D: 0, 'N/N': 0 }, tot = sum(RP_GRADES.map(k => g[k]));
      rpTxt(s, 0, y + 3.5, rpOrgName(o.org, code), { pt: 7 });
      rpStackHG(s, LW, y + 1, (W - LW - 8) * tot / mx, 3.6, RP_GRADES.map((k, j) => ({ n: g[k], label: k === 'N/N' ? '' : k, txt: rpMask(g[k]), color: k === 'C' ? RP_C.gradeC : k === 'D' ? RP_C.gradeD : k === 'N/N' ? RP_C.track : RP_C.seg[j + 1] })), { under: false });
      rpTxt(s, W, y + 3.5, rpMask(tot), { pt: 6.5, anchor: 'end', fill: RP_C.sub });
      RP_GRADES.forEach(k => rpX_(C, rpOrgName(o.org, code) + ' agents ' + k, rpMask(g[k]), ''));
    });
    return [s, rpBase('A, B, C, D puis non notés (gris). Aucun nom.')];
  }
  function rpBlkShare(C) {
    const L = rpOrgList(); if (!L.length) return null;
    const code = rpCoder(L.filter(o => !/^PAM$/i.test(o.org)).map(o => ({ name: o.org, n: o.n })), 'Organisation'), N = sum(L.map(o => o.n)), W = RP_SZ.usable, s = rpSvg(W, 8, 'Part du suivi par organisation');
    let x = 0; const small = []; L.forEach((o, i) => { const w = o.n / N * W, lab = rpOrgName(o.org, code) + ' ' + pct(o.n / N * 100, 0); rpE(s, 'rect', { x, y: 0.5, width: w, height: 5, fill: RP_C.seg[(i % 3) + 1], stroke: '#fff', 'stroke-width': 0.3 }); if (w > rpTW(lab, 6.5) + 1.5) rpTxt(s, x + w / 2, 3.9, lab, { pt: 6.5, anchor: 'middle', fill: i % 3 === 2 ? '#fff' : RP_C.ink }); else small.push(lab); x += w; rpX_(C, rpOrgName(o.org, code), pct(o.n / N * 100, 1), rpMask(o.n) + ' fiches'); });
    return [s, rpBase((small.length ? 'À droite : ' + small.join(', ') + '. ' : '') + rpMask(N) + ' fiches de la période.')];
  }
  function rpBlkSuites(C) {
    const M = C.M; if (!M.fams.length) return null;
    const W = RP_SZ.usable, RH = 7, s = rpSvg(W, 4 + M.fams.length * RH, 'Après la revisite');
    [['Cas', 32], ['Revisités', 62], ['Même alerte', 92], ['Délai médian', 124], [piWin(M.T.R) + ' contre ' + piWin(M.T.P), 152]].forEach(([t, x]) => rpTxt(s, x, 3, t, { pt: 6, fill: RP_C.sub }));
    M.fams.forEach((f, i) => {
      const y = 4 + i * RH + RH / 2 + 0.9;
      rpTxt(s, 0, y, f.fam.label, { pt: 7.5, fw: 600 });
      rpTxt(s, 32, y, rpMask(f.n), { pt: 8.5, fw: 600, cls: 'rp-val' }); rpTxt(s, 52, y, '→', { pt: 8, fill: RP_C.sub });
      rpTxt(s, 62, y, rpMask(f.rev), { pt: 8.5, fw: 600 }); rpTxt(s, 82, y, '→', { pt: 8, fill: RP_C.sub });
      rpTxt(s, 92, y, rpMask(f.recur), { pt: 8.5, fw: 600, fill: f.recur ? RP_C.st.bad.tx : RP_C.ink });
      rpTxt(s, 124, y, f.med !== null ? fmt(f.med, 1) + ' jours' : '–', { pt: 7.5 });
      rpTxt(s, 152, y, rpMask(f.inR) + ' contre ' + rpMask(f.inP), { pt: 7.5, cls: 'rp-base' });
      rpX_(C, f.fam.label, rpMask(f.n) + ' cas', 'revisités ' + rpMask(f.rev) + ' ; même alerte ' + rpMask(f.recur) + ' ; délai médian ' + (f.med !== null ? fmt(f.med, 1) : '–'));
    });
    return [s];
  }
  function rpInterneOnly() { return el('p', { class: 'rp-empty', text: 'Version interne seulement.' }); }
  function rpBlkCaseList(C) {
    if (rpDiff()) return [rpInterneOnly()];
    const M = C.M, n = +(C.o.n || 10), S = ovCaseStore(), fl = id => (PI_FAM.find(f => f.id === id) || {}).label || 'Autre alerte grave';
    const L = ovCaseList(M.sel).filter(c => c.tier === 1).sort((a, b) => String(a.v.date).localeCompare(String(b.v.date)));
    if (!L.length) return [el('p', { class: 'rp-empty', text: 'Aucune alerte grave sur la période.' })];
    const rows = L.slice(0, n), t = el('table', { class: 'rp-t rp-cases' });
    t.appendChild(el('thead', null, el('tr', null, ['Famille', 'Code du site', 'District', 'Date', 'Ancienneté', 'Statut'].map(h => el('th', { scope: 'col', text: h })))));
    t.appendChild(el('tbody', { 'data-split': '1' }, rows.map(c => { const st = S[c.key], f = piFamOf(c.v.act, c.code); const cells = [fl(f), ovSiteOf(c.v).code || '–', DICT.district[c.v.district] || '–', dFrUI(c.v.date), fmt(piAge(c.v.date)) + ' j', OV_CASE_ST[st ? st.s || 0 : 0]]; rpX_(C, cells[0] + ' ' + cells[1], cells[3], cells.slice(4).join(' ; ')); return el('tr', null, cells.map(x => el('td', { text: x }))); })));
    return [t, rpBase(rpMask(rows.length) + ' sur ' + rpMask(L.length) + ', les plus anciens d’abord. Usage interne.')];
  }
  function rpBlkPlans(C) {
    const M = C.M, P = rpPartners(M), list = [];
    P.acts.forEach(o => o.rows.forEach(r => { if (r.mark === 'bad' && r.resp.imp / Math.max(1, r.n) * 100 >= THR.rLow) list.push({ o, r }); }));
    if (!list.length) return [el('p', { class: 'rp-empty', text: 'Aucun partenaire avec un écart démontré et des alertes qui relèvent de lui.' })];
    const t = el('table', { class: 'rp-t rp-plans' }); t.appendChild(el('thead', null, el('tr', null, ['Partenaire', 'Constat', 'Action', 'Qui', 'Échéance'].map(h => el('th', { scope: 'col', text: h })))));
    const tb = el('tbody');
    list.forEach(({ o, r }) => {
      const key = o.a + '-' + ovHash(r.name), wk = (ovWeakDomains(o.a, r.x)[0] || null);
      const cst = fmt(r.ci.m, 1) + ' contre ' + fmt(o.mean, 1) + ', ' + rpPct(r.resp.imp, r.n) + ' d’alertes imputables';
      const act = wk ? 'Plan d’action sur ' + rpLow(rpDomLabel(wk.d)) : 'Plan d’action sur les normes les plus basses';
      tb.appendChild(el('tr', null, [el('td', { text: ACT[o.a].short + ', ' + r.code }), el('td', null, ovEd('div', 'rp-plan-' + key + '-c', cst, 'rp-auto')), el('td', null, ovEd('div', 'rp-plan-' + key + '-a', act)),
        el('td', null, ovEd('div', 'rp-plan-' + key + '-q', PILOT_ROUTE.act.role)), el('td', null, ovEd('div', 'rp-plan-' + key + '-e', piDue(PILOT_ROUTE.act)))]));
      rpX_(C, ACT[o.a].short + ', ' + r.code, cst, act);
    });
    t.appendChild(tb); return [t];
  }
  // annexes
  function rpBlkPrio(C) {
    if (rpDiff()) return [rpInterneOnly()];
    const M = C.M, ok = rpPartnerTpl(C.tpl) ? M.sel : M.okR, Pr = ovPrio(ok, 'both'), rows = Pr.all.slice(0, 15);
    if (!rows.length) return [el('p', { class: 'rp-empty', text: 'Aucune visite prioritaire.' })];
    const t = el('table', { class: 'rp-t rp-prio' }); t.appendChild(el('thead', null, el('tr', null, ['Visite', 'Score', 'Pourquoi', 'Que faire'].map(h => el('th', { scope: 'col', text: h })))));
    t.appendChild(el('tbody', { 'data-split': '1' }, rows.map(v => { rpX_(C, (ovSiteOf(v).code || '–') + ' ' + dFrUI(v.date), rpNum(v.score) ? fmt(v.score, 1) : '–', ACT[v.act].short); return el('tr', null, [el('td', null, [el('b', { text: DICT.site[v.site] || '–' }), el('div', { class: 'rp-base', text: (DICT.district[v.district] || '') + ', ' + dFrUI(v.date) + ', ' + ACT[v.act].short })]), el('td', { class: 'num', text: rpNum(v.score) ? fmt(v.score, 1) : '–' }), el('td', null, ovWhyNode(v)), el('td', null, ovHowNode(v))]); })));
    return [rpBase(rpMask(Pr.all.length) + ' visites sur ' + rpMask(Pr.N) + ' demandent un suivi ; les ' + rows.length + ' premières.'), t];
  }
  function rpBlkMethod() {
    const keys = Object.keys(RP_DEF).filter(k => !['methode', 'libre', 'validation'].includes(k));
    return [el('p', { class: 'rp-base' }, 'Seuils provisoires, à valider : cible ' + THR.good + ', seuil faible ' + THR.mid + ', effectif minimal ' + PILOT.minN + ' visites, petits effectifs sous ' + SMALL_N.min + ' et ' + SMALL_N.low + '.'),
      el('div', { class: 'rp-meth', 'data-split': '1' }, keys.map(k => { const d = RP_DEF[k]; return el('div', { class: 'rp-mi' }, [el('b', { text: d.label + '. ' }), d.def + ' ' + (d.formula ? d.formula + ' ' : '') + (d.ref ? d.ref + ' ' : '') + (d.limits || '')]); }))];
  }
  function rpBlkFree(C) {
    const id = C.pageId;
    const t = ovEd('h2', 'rp-free-t-' + id, 'Page libre', 'rp-ptitle'), b = ovEd('div', 'rp-free-' + id, '', 'rp-free'); b.setAttribute('data-ph', 'Écrire ici');
    return [t, b];
  }
  // ---------------------------------------------------------------- MODÈLE « PILOTAGE » : blocs du rapport de suivi-évaluation (pilotage des activités)
  // Structure décisionnelle (deck CCO) + richesse graphique (bulletin), branchés sur NOS indicateurs réels.
  // Tout chiffre vient du modèle (piModel) ; aucun nombre écrit à la main ; narratifs amorcés depuis les données puis éditables.

  // performance par bureau : couverture (covCalc avec le bureau en filtre), visites, score et cas graves de la fenêtre
  function rpOffices(M) {
    return rpX('offices', () => {
      if (typeof covCalc !== 'function') return [];
      const W = M.T.R, winVis = M.okR;
      const idxs = Array.from(new Set(winVis.map(v => v.fo).concat(M.sel.map(v => v.fo)))).filter(i => i >= 0 && DICT.fo && DICT.fo[i]);
      if (!idxs.length) return [];
      const by = new Map(idxs.map(i => [i, { i, name: DICT.fo[i], planned: 0, visited: 0, n: 0, scored: [], graves: 0 }]));
      winVis.forEach(v => { const o = by.get(v.fo); if (!o) return; o.n++; if (rpNum(v.score)) o.scored.push(v.score); if (ovVT(v)[1].length) o.graves++; });
      const m0 = F.m0, m1 = F.m1, fo0 = F.fo;
      try {
        F.m0 = W[0]; F.m1 = W[W.length - 1];
        idxs.forEach(i => { F.fo = i; let c; try { c = covCalc({ act: F.act }); } catch (e) { c = null; } if (!c || c.outOfYear) return; const o = by.get(i); o.planned = c.planned; o.visited = c.visited; });
      } finally { F.m0 = m0; F.m1 = m1; F.fo = fo0; }
      return Array.from(by.values()).filter(o => o.n > 0 || o.planned > 0).map(o => {
        o.mean = o.scored.length ? mean(o.scored) : null;
        o.cov = o.planned ? o.visited / o.planned * 100 : null;
        o.status = rpOfficeStatus(o);
        return o;
      }).sort((a, b) => (b.planned - a.planned) || (b.n - a.n));
    });
  }
  // statut d'un bureau dérivé des seuils (jamais saisi) : conformité + présence de cas graves
  function rpOfficeStatus(o) {
    if (o.scored.length < SMALL_N.min) return { k: 'na', w: 'Non concluant' };
    const m = o.mean;
    if (m < THR.mid) return o.graves ? { k: 'bad', w: 'Priorité 1', prio: true } : { k: 'bad', w: 'Alerte' };
    if (m < THR.good || o.graves) return { k: 'mid', w: 'Vigilance' };
    return { k: 'good', w: 'Capitaliser' };
  }

  // ---------------------------------------------------------------- Message clé (NOUVEAU bloc rpBlkKeyMsg)
  // Un titre d'arbitrage + 3-4 messages courts titrés, amorcés depuis les règles (verdicts, représentativité, flags, écarts bureaux), éditables.
  function rpKeySeeds(M) {
    const seeds = [], rows = M.rows;
    const outs = rows.filter(r => r.verdict === 'out'), watch = rows.filter(r => r.verdict === 'watch'), oks = rows.filter(r => r.verdict === 'ok');
    // 1 — mise en œuvre (verdicts)
    if (outs.length) seeds.push({ t: 'Mise en œuvre à redresser', b: rpMask(outs.length) + ' activité' + (outs.length > 1 ? 's' : '') + ' hors contrôle (' + outs.map(r => ACT[r.a].short).join(', ') + ')' + (oks.length ? ', ' + rpMask(oks.length) + ' sous contrôle' : '') + '.' });
    else if (oks.length && oks.length >= rows.filter(r => r.verdict !== 'inc').length) seeds.push({ t: 'Mise en œuvre maîtrisée', b: rpMask(oks.length) + ' activité' + (oks.length > 1 ? 's' : '') + ' sous contrôle sur ' + rpMask(rows.length) + (watch.length ? ', ' + rpMask(watch.length) + ' à surveiller' : '') + '.' });
    else seeds.push({ t: 'Mise en œuvre à surveiller', b: rpMask(watch.length) + ' activité' + (watch.length > 1 ? 's' : '') + ' à surveiller, ' + rpMask(oks.length) + ' sous contrôle.' });
    // 2 — fiabilité / représentativité (toujours présent)
    const weak = rows.filter(r => r.r.n < PILOT.minN || (r.covOk && r.covP100 < PILOT.covFloor)), cov = M.cov.R, covOk = cov && !cov.outOfYear && cov.planned > 0;
    if (weak.length) seeds.push({ t: 'Lecture à consolider', b: rpMask(weak.length) + ' activité' + (weak.length > 1 ? 's' : '') + ' sous le seuil de représentativité (' + weak.map(r => ACT[r.a].short).join(', ') + ') : chiffres à interpréter avec prudence.' });
    else seeds.push({ t: 'Lecture fiable', b: 'Couverture ' + (covOk ? pct(Math.min(100, cov.visited / cov.planned * 100), 0) + ' (' + rpNN(cov.visited, cov.planned) + ' sites actifs)' : '–') + ', ' + rpMask(M.okR.length) + ' visites exploitables : base suffisante pour conclure.' });
    // 3 — alerte dominante
    const g = M.fams.find(x => x.fam.id === 'grave'), L = M.load;
    if (g && g.noSt) seeds.push({ t: 'Cas graves à suivre', b: rpMask(g.noSt) + ' cas graves sans suite' + (g.old ? ', dont ' + rpMask(g.old) + ' depuis plus de ' + PILOT.oldDays + ' jours' : '') + ' : à escalader vers la protection et la sécurité.' });
    else if (L && !L.na && L.ratio !== null && L.ratio > PILOT.cap) seeds.push({ t: 'Charge du plan intenable', b: fmt(L.demand) + ' visites dues par mois pour ' + fmt(L.cap) + ' faites (× ' + fmt(L.ratio, 1) + ') : arbitrer fréquences ou périmètre.' });
    else if (M.blind && M.blind.blind.length) seeds.push({ t: 'Zones sans visite', b: rpMask(M.blind.blind.length) + ' zones sans visite depuis ' + PILOT.blindMonths + ' mois : relancer le suivi de terrain.' });
    // 4 — écarts géographiques (bureaux)
    const offs = rpOffices(M).filter(o => o.cov !== null);
    if (offs.length >= 2) {
      const code = rpCoder(rpOffices(M).map(o => ({ name: o.name, n: o.planned || o.n })), 'Bureau'), srt = offs.slice().sort((a, b) => a.cov - b.cov), lo = srt[0], hi = srt[srt.length - 1];
      if (Math.min(100, hi.cov) - Math.min(100, lo.cov) >= 1) seeds.push({ t: 'Écarts géographiques', b: 'Couverture de ' + pct(Math.min(100, lo.cov), 0) + ' (' + code(lo.name) + ') à ' + pct(Math.min(100, hi.cov), 0) + ' (' + code(hi.name) + ') : cibler les bureaux en retard.' });
    }
    return seeds.slice(0, 4);
  }
  function rpBlkKeyMsg(C) {
    const M = C.M, seeds = rpKeySeeds(M); if (!seeds.length) return null;
    const enj = M.rows.filter(r => r.verdict === 'out' || r.verdict === 'watch').length;
    const headDef = (M.rows.some(r => r.verdict === 'out') ? 'Une base à consolider' : 'Une base solide') + ', ' + rpMask(Math.max(1, enj)) + ' enjeu' + (enj > 1 ? 'x' : '') + ' à arbitrer';
    const head = ovEd('div', 'rp-km-head', headDef, 'rp-km-head rp-auto');
    head.addEventListener('input', () => { if (head.textContent.length > 120) head.textContent = head.textContent.slice(0, 120); });
    rpX_(C, 'Titre d’arbitrage', head.textContent, '');
    const items = seeds.map((s, i) => {
      const t = ovEd('div', 'rp-km-t-' + i, s.t, 'rp-km-t rp-auto'), b = ovEd('div', 'rp-km-b-' + i, s.b, 'rp-km-b rp-auto');
      [t, b].forEach(n => n.addEventListener('input', () => { if (n.textContent.length > 240) n.textContent = n.textContent.slice(0, 240); }));
      rpX_(C, (i + 1) + '. ' + s.t, s.b, '');
      return el('div', { class: 'rp-km-item' }, [el('span', { class: 'rp-km-dot', 'aria-hidden': 'true', text: String(i + 1) }), el('div', { class: 'rp-km-txt' }, [t, b])]);
    });
    return [head, el('div', { class: 'rp-km-list' }, items)];
  }

  // ---------------------------------------------------------------- Aperçu des couvertures : une carte par activité (NOUVEAU bloc rpBlkCovCards)
  // Grand % de couverture + sites suivis + étiquette de statut (BON/MOYEN/FAIBLE/CRITIQUE, dérivée du verdict) + score de qualité ; drapeau de représentativité ; Résilience/score ≤ 100, « n.d. » si base faible.
  function rpBlkCovCards(C) {
    const M = C.M, rows = M.rows; if (!rows.length) return null;
    const lab = { ok: 'BON', watch: 'MOYEN', out: 'CRITIQUE', inc: 'NON CONCLUANT' };
    const cards = rows.map(r => {
      const d = PI_VD[r.verdict], S = rpStat(d[2]);
      const covTxt = r.covOk ? pct(Math.min(100, r.covP100), 0) : 'Pas de plan';
      const scoreTxt = r.r.n >= SMALL_N.min ? fmt(r.r.mean, 1) : 'n.d.';
      const unreliable = r.r.n < PILOT.minN ? 'base faible : lecture non fiable' : (r.covOk && r.covP100 < PILOT.covFloor ? 'couverture sous ' + PILOT.covFloor + ' %' : null);
      const big = el('div', { class: 'rp-cc-big rp-val', text: covTxt });
      if (r.covOk) big.style.color = rpStat(rpCls(Math.min(100, r.covP100))).c; else big.classList.add('rp-cc-np');
      const card = el('div', { class: 'rp-cc-card' }, [
        el('div', { class: 'rp-cc-top' }, [el('div', { class: 'rp-cc-act', text: ACT[r.a].short }), rpStPill(d[2], lab[r.verdict] || d[1])]),
        big,
        el('div', { class: 'rp-cc-sub', text: r.covOk ? rpNN(r.cov.visited, r.cov.planned) + ' sites suivis' : 'aucun site actif au plan' }),
        el('div', { class: 'rp-cc-q' }, [el('span', { class: 'rp-cc-ql', text: 'Qualité de mise en œuvre' }), el('span', { class: 'rp-cc-qv rp-val', text: scoreTxt === 'n.d.' ? 'n.d.' : scoreTxt + ' / 100' })]),
        unreliable ? el('div', { class: 'rp-cc-flag', text: '⚑ ' + unreliable }) : null]);
      card.style.setProperty('--cc', S.c);
      rpClickable(card, rpOpen(M, () => piActDrawer(M, r)), ACT[r.a].short);
      bindTip(card, () => ACT[r.a].label + ' — ' + d[1] + '\nCouverture : ' + (r.covOk ? rpNN(r.cov.visited, r.cov.planned) + ' (' + pct(Math.min(100, r.covP100), 1) + ')' : 'pas de plan') + '\nScore : ' + (r.r.n ? fmt(r.r.mean, 1) + ' sur ' + rpMask(r.r.n) + ' visites' : '–') + (unreliable ? '\n' + unreliable : ''));
      rpX_(C, ACT[r.a].short + ' couverture', covTxt, r.covOk ? rpNN(r.cov.visited, r.cov.planned) : '');
      rpX_(C, ACT[r.a].short + ' statut', lab[r.verdict] || d[1], unreliable || '');
      rpX_(C, ACT[r.a].short + ' qualité', scoreTxt, r.r.n ? rpMask(r.r.n) + ' visites' : '');
      return card;
    });
    return [el('div', { class: 'rp-cc' }, cards), rpBase('Grand chiffre : sites suivis sur sites actifs (plafonné à 100 %). Étiquette = verdict de l’activité ; « n.d. » si la base est trop faible pour conclure.')];
  }

  // ---------------------------------------------------------------- Performance par bureau de terrain (NOUVEAU bloc rpBlkByOffice)
  // Statut (Capitaliser / Vigilance / Alerte / Priorité 1) + métriques clés par bureau, sur un filigrane de silhouette Madagascar.
  function rpBlkByOffice(C) {
    const M = C.M, offs = rpOffices(M); if (!offs.length) return null;
    const code = rpCoder(offs.map(o => ({ name: o.name, n: o.planned || o.n })), 'Bureau');
    const W = RP_SZ.usable, RH = 6.6, top = 8, H = top + offs.length * RH + 1;
    const xBur = 0, xStat = 30, xCov = 60, covW = 26, xVis = 112, xScore = 128, scW = 20, xGrav = W;
    const s = rpSvg(W, H, 'Performance par bureau de terrain : ' + offs.map(o => code(o.name) + ' ' + o.status.w).join(', '));
    // filigrane : silhouette de Madagascar (décor, très pâle, derrière le tableau)
    const geo = D.geo || [];
    if (geo.length) {
      const ib = { x: -2.2, y: -0.2, w: 12.6, h: 15 }, ht = H * 0.74, is = ht / ib.h, iw = ib.w * is, ix = (W - iw) / 2, iy = (H - ht) / 2, ig = rpE(s, 'g', { 'aria-hidden': 'true', opacity: 0.13 });
      geo.forEach(f => rpE(ig, 'path', { d: rpGeoPath(f, q => [(q[0] - ib.x) * is + ix, (q[1] - ib.y) * is + iy]), fill: RP_C.seg[2], stroke: 'none' }));
    }
    [['Bureau', xBur, 'start'], ['Statut', xStat, 'start'], ['Couverture', xCov, 'start'], ['Visites', xVis, 'start'], ['Score', xScore, 'start'], ['Graves', xGrav, 'end']].forEach(([t, x, a]) => rpTxt(s, x, 3.6, t, { pt: 6.5, fill: RP_C.sub, anchor: a }));
    rpE(s, 'line', { x1: 0, x2: W, y1: top - 2, y2: top - 2, stroke: RP_C.line, 'stroke-width': 0.25 });
    offs.forEach((o, i) => {
      const y = top + i * RH, cy = y + RH / 2, g = rpE(s, 'g', { class: 'rp-row' }), St = rpStat(o.status.k);
      if (i) rpE(g, 'line', { x1: 0, x2: W, y1: y - 0.6, y2: y - 0.6, stroke: RP_C.line, 'stroke-width': 0.15 });
      rpE(g, 'rect', { x: 0, y: y - 0.4, width: W, height: RH, fill: '#fff', 'fill-opacity': 0, class: 'rp-hit' });
      rpTxt(g, xBur, cy + 0.9, rpCut(code(o.name), 18), { pt: 7.5, fw: 600 });
      const pw = Math.min(xCov - xStat - 2, rpTW(St.ic + ' ' + o.status.w, 7) + 3);
      rpE(g, 'rect', { x: xStat, y: cy - 2.6, width: pw, height: 4, rx: 2, fill: St.bg });
      rpTxt(g, xStat + 1.6, cy + 0.3, St.ic + ' ' + o.status.w, { pt: 6.8, fill: St.tx, fw: 600, cls: 'rp-st' });
      if (o.cov !== null) {
        const p = Math.min(100, o.cov); rpE(g, 'rect', { x: xCov, y: cy - 1.4, width: covW, height: 2.6, rx: 0.6, fill: RP_C.track });
        rpE(g, 'rect', { x: xCov, y: cy - 1.4, width: Math.max(0.6, p / 100 * covW), height: 2.6, rx: 0.6, fill: rpStat(rpCls(p)).c });
        rpTxt(g, xCov + covW + 1.2, cy + 0.9, pct(p, 0), { pt: 6.8, cls: 'rp-base' });
      } else rpTxt(g, xCov, cy + 0.9, 'pas de plan', { pt: 6.8, fill: RP_C.sub });
      rpTxt(g, xVis, cy + 0.9, rpMask(o.n), { pt: 7.5, fw: 600 });
      if (o.mean !== null && o.scored.length >= SMALL_N.min) { rpGaugeG(g, xScore, cy - 1.3, scW, 2.6, o.mean, 100, { thr: true }); rpTxt(g, xScore + scW + 1.2, cy + 0.9, fmt(o.mean, 1), { pt: 7, cls: 'rp-val' }); }
      else rpTxt(g, xScore, cy + 0.9, 'n.d.', { pt: 6.8, fill: RP_C.sub });
      rpTxt(g, xGrav, cy + 0.9, o.graves ? rpMask(o.graves) : '0', { pt: 7.5, fw: 600, anchor: 'end', fill: o.graves ? RP_C.st.bad.tx : RP_C.sub });
      bindTip(g, () => (rpDiff() ? code(o.name) : o.name) + ' — ' + o.status.w + '\nCouverture : ' + (o.cov !== null ? rpNN(o.visited, o.planned) + ' (' + pct(Math.min(100, o.cov), 1) + ')' : 'pas de plan') + '\nScore : ' + (o.mean !== null ? fmt(o.mean, 1) + ' sur ' + rpMask(o.scored.length) + ' visites' : '–') + '\nVisites : ' + rpMask(o.n) + ', cas graves : ' + rpMask(o.graves));
      rpX_(C, code(o.name), o.status.w, 'couverture ' + (o.cov !== null ? pct(Math.min(100, o.cov), 1) : '–') + ' ; score ' + (o.mean !== null ? fmt(o.mean, 1) : '–') + ' ; ' + rpMask(o.n) + ' visites ; ' + rpMask(o.graves) + ' graves');
    });
    return [s, rpBase(piWin(M.T.R) + ', ' + offs.length + ' bureau' + (offs.length > 1 ? 'x' : '') + '. Statut dérivé du score de conformité et des cas graves : Capitaliser · Vigilance · Alerte · Priorité 1. Aucun agent nommé.')];
  }

  // ---------------------------------------------------------------- Feuille de route (NOUVEAU bloc rpBlkRoadmap) : Qui · Quand · Comment, éditable, amorcé des décisions
  function rpBlkRoadmap(C) {
    const M = C.M, subs = M.subjects.top.slice(0, 6);
    let seeds;
    if (subs.length) seeds = subs.map(s => ({ chantier: s.title, qui: rpRoleShort(s.route.role), comment: rpCut(rpDecision(s), 90), quand: rpDueShort(s.route) }));
    else {
      const rws = M.rows.filter(r => r.verdict === 'out' || r.verdict === 'watch').slice(0, 4);
      seeds = rws.length ? rws.map(r => ({ chantier: ACT[r.a].short + ' — ' + rpLow(PI_VD[r.verdict][1]), qui: 'Gestionnaire d’activité', comment: rpCap(rpWhyShort(r, M)), quand: 'Prochain comité' }))
        : [{ chantier: '', qui: '', comment: '', quand: '' }, { chantier: '', qui: '', comment: '', quand: '' }, { chantier: '', qui: '', comment: '', quand: '' }];
    }
    const t = el('table', { class: 'rp-t rp-rm' });
    t.appendChild(el('thead', null, el('tr', null, ['Chantier', 'Qui', 'Comment', 'Quand'].map(h => el('th', { scope: 'col', text: h })))));
    const tb = el('tbody', { 'data-split': '1' });
    seeds.forEach((r, i) => {
      const mk = (f, cls_) => { const e = ovEd('div', 'rp-rm-' + i + '-' + f, r[f] || '', cls_ || ''); e.setAttribute('data-ph', '…'); e.addEventListener('input', () => { if (e.textContent.length > 200) e.textContent = e.textContent.slice(0, 200); }); return e; };
      tb.appendChild(el('tr', null, [el('td', null, mk('chantier', 'rp-subj')), el('td', null, mk('qui')), el('td', null, mk('comment', 'rp-auto')), el('td', null, mk('quand', 'rp-due'))]));
      rpX_(C, r.chantier || ('Chantier ' + (i + 1)), r.comment || '', (r.qui || '') + (r.quand ? ' ; ' + r.quand : ''));
    });
    t.appendChild(tb);
    return [t, rpBase('Qui · Quand · Comment, amorcé depuis les décisions du mois ; à compléter et dater avant diffusion.')];
  }

  // ---------------------------------------------------------------- Suite / bilatéraux (NOUVEAU bloc rpBlkBilat) : jalons par binôme d'unités + demande au CCO, éditable
  function rpBlkBilat(C) {
    const M = C.M, rws = M.rows.filter(r => r.verdict === 'out' || r.verdict === 'watch').slice(0, 4);
    let seeds = rws.map(r => {
      const sys = (M.norms.find(o => o.a === r.a) || {}).sys || [], j = sys[0] ? rpShortQ(sys[0].m.label, 40) : rpDomLabel((D.domains[r.a] || [])[0] || '');
      return { binome: 'S&E ↔ ' + ACT[r.a].short, jalon: j ? 'Revoir : ' + rpLow(j) : 'Cadrer un point de suivi conjoint', quand: 'Bilatéral à programmer' };
    });
    if (!seeds.length) seeds = [{ binome: 'S&E ↔ ', jalon: '', quand: '' }, { binome: 'S&E ↔ ', jalon: '', quand: '' }];
    const t = el('table', { class: 'rp-t rp-bl' });
    t.appendChild(el('thead', null, el('tr', null, ['Binôme d’unités', 'Jalon à arrêter', 'Échéance'].map(h => el('th', { scope: 'col', text: h })))));
    const tb = el('tbody', { 'data-split': '1' });
    seeds.forEach((r, i) => {
      const mk = (f, cls_) => { const e = ovEd('div', 'rp-bl-' + i + '-' + f, r[f] || '', cls_ || ''); e.setAttribute('data-ph', '…'); e.addEventListener('input', () => { if (e.textContent.length > 200) e.textContent = e.textContent.slice(0, 200); }); return e; };
      tb.appendChild(el('tr', null, [el('td', null, mk('binome', 'rp-subj')), el('td', null, mk('jalon', 'rp-auto')), el('td', null, mk('quand', 'rp-due'))]));
      rpX_(C, r.binome, r.jalon, r.quand);
    });
    t.appendChild(tb);
    const dem = ovEd('p', 'rp-bl-demande', 'Demande au chef de programme : arbitrer les priorités ci-dessus et confirmer les ressources de suivi.', 'rp-com rp-auto');
    dem.addEventListener('input', () => { if (dem.textContent.length > 300) dem.textContent = dem.textContent.slice(0, 300); });
    rpX_(C, 'Demande au chef de programme', dem.textContent, '');
    return [t, dem, rpBase('Jalons amorcés depuis les activités à enjeu ; à arrêter en bilatéral puis à présenter au CCO.')];
  }
  // ---------------------------------------------------------------- blocs : registre (titre, clé d'explication, largeur, priorité, 3 réglages au plus)
  const YN = [['yes', 'Oui'], ['no', 'Non']];
  const RP_B = {
    figures: { title: 'Chiffres', notitle: true, span: 12, prio: 1, render: rpBlkFigures },
    rings: { title: 'Prévu et suivi', rp: 'couverture', span: 6, prio: 2, movable: true, render: rpBlkRings },
    bubbles: { title: 'Couverture par activité', rp: 'couverture', span: 6, prio: 2, movable: true, render: rpBlkBubbles },
    kpis: { title: 'Indicateurs clés', span: 6, prio: 2, movable: true, render: rpBlkKpis },
    hilite: { title: 'Faits marquants', span: 6, prio: 2, movable: true, render: rpBlkHilite },
    acts: { title: 'Activités', rp: 'verdict', span: 12, prio: 1, opts: [['curve', 'Courbe', [['score', 'Score'], ['visits', 'Visites']], 'score'], ['why', 'Pourquoi', YN, 'yes']], render: rpBlkActs },
    decide: { title: 'À décider', rp: 'decider', span: 12, prio: 1, opts: [['n', 'Sujets', [['3', '3'], ['4', '4'], ['5', '5']], () => String(PILOT.maxSubjects)], ['st', 'Statut', YN, 'yes']], render: rpBlkDecide },
    choro: { title: 'Couverture par région', rp: 'carte', span: 7, prio: 1, movable: true, opts: [['color', 'Couleur', [['cov', 'Couverture'], ['graves', 'Cas graves']], 'cov'], ['names', 'Noms de district', YN, 'no', () => rpDiff() ? 'Jamais en version diffusable' : null]], render: rpBlkChoro },
    blind: { title: 'Zones sans visite', rp: 'aveugles', span: 5, prio: 2, movable: true, opts: [['n', 'Lignes', [['4', '4'], ['6', '6']], '6']], render: rpBlkBlind },
    weak: { title: 'Points faibles', rp: 'domaines', span: 12, prio: 2, movable: true, opts: [['own', 'Domaine propre', YN, 'yes']], render: rpBlkWeak },
    norms: { title: 'Normes à revoir', rp: 'normes', span: 12, prio: 3, movable: true, opts: [['n', 'Normes', [['3', '3'], ['5', '5']], '5']], render: rpBlkNorms },
    cases: { title: 'Cas graves', rp: 'cas', span: 12, prio: 1, movable: true, opts: [['group', 'Regrouper par 5', [['auto', 'Auto'], ['yes', 'Oui'], ['no', 'Non']], 'auto']], render: rpBlkCases },
    signals: { title: 'Signaux', rp: 'signaux', span: 12, prio: 1, movable: true, opts: [['cmp', 'Comparer à avant', YN, 'yes']], render: rpBlkSignals },
    meals: { title: 'Repas scolaires', rp: 'repas', span: 6, prio: 2, movable: true, render: rpBlkMeals },
    partic: { title: 'Participation', rp: 'participation', span: 6, prio: 4, movable: true, render: rpBlkPartic },
    capacity: { title: 'Capacité', rp: 'capacite', span: 12, prio: 1, movable: true, render: rpBlkCapacity },
    exec: { title: 'Exécution', rp: 'execution', span: 12, prio: 2, movable: true, render: rpBlkExec },
    orgs: { title: 'Organisations de suivi', rp: 'orgs', span: 12, prio: 2, movable: true, opts: [['notes', 'Notes des agents', YN, 'yes']], render: rpBlkOrgs },
    rel: { title: 'Fiabilité', rp: 'fiabilite', span: 12, prio: 3, movable: true, render: rpBlkRel },
    fband: { title: 'Bandeau', notitle: true, span: 12, prio: 1, render: rpBlkFBand },
    fscore: { title: 'Score et tendance', rp: 'fScore', span: 12, prio: 1, render: rpBlkFScore },
    fdom: { title: 'Domaines', rp: 'fDom', span: 6, prio: 2, movable: true, render: rpBlkFDom },
    fnorm: { title: 'Normes', rp: 'fNorm', span: 6, prio: 2, movable: true, opts: [['mode', 'Normes', [['drop', 'En baisse'], ['low', 'Les plus basses']], 'drop'], ['n', 'Nombre', [['5', '5'], ['8', '8']], '5']], render: rpBlkFNorm },
    falert: { title: 'Alertes', rp: 'fAlert', span: 6, prio: 2, movable: true, render: rpBlkFAlert },
    fcouv: { title: 'Couverture et partenaires', rp: 'fCouv', span: 6, prio: 3, movable: true, render: rpBlkFCouv },
    fkeep: { title: 'À retenir', rp: 'retenir', span: 12, prio: 1, render: rpBlkFKeep },
    dec1: { title: 'Décisions du mois', rp: 'decider', span: 12, prio: 1, render: rpBlkDec1 },
    dec2: { title: 'Décisions précédentes', rp: 'precedent', span: 12, prio: 2, movable: true, render: rpBlkDec2 },
    sign: { title: 'Validation', rp: 'validation', span: 12, prio: 1, render: rpBlkSign },
    pmeo: { title: 'Conformité par partenaire', rp: 'pmeo', span: 12, prio: 1, opts: [['ci', 'Intervalle', YN, 'yes'], ['resp', 'Ce qui relève du partenaire', YN, 'yes']], render: rpBlkPmeo },
    districts: { title: 'Districts', rp: 'districts', span: 12, prio: 2, movable: true, render: rpBlkDistricts },
    orgqual: { title: 'Qualité de la collecte', rp: 'orgQual', span: 12, prio: 1, render: rpBlkOrgQual },
    dur: { title: 'Durée des fiches', rp: 'duree', span: 6, prio: 2, movable: true, render: rpBlkDur },
    agents: { title: 'Agents par note', rp: 'agentsNotes', span: 6, prio: 2, movable: true, render: rpBlkAgents },
    share: { title: 'Part du suivi', rp: 'partSuivi', span: 12, prio: 3, movable: true, render: rpBlkShare },
    suites: { title: 'Après la revisite', rp: 'suites', span: 12, prio: 2, movable: true, render: rpBlkSuites },
    caselist: { title: 'Cas à traiter', rp: 'casListe', span: 12, prio: 3, movable: true, opts: [['n', 'Lignes', [['10', '10'], ['15', '15']], '10']], render: rpBlkCaseList },
    plans: { title: 'Plans d’action', rp: 'plans', span: 12, prio: 2, movable: true, render: rpBlkPlans },
    prio: { title: 'Visites prioritaires', rp: 'prio', span: 12, prio: 1, render: rpBlkPrio },
    method: { title: 'Méthode et notes', rp: 'methode', span: 12, prio: 1, render: rpBlkMethod },
    free: { title: 'Page libre', notitle: true, span: 12, prio: 1, render: rpBlkFree },
    // blocs du modèle « pilotage » (réutilisables)
    keymsg: { title: 'Message clé', span: 12, prio: 1, render: rpBlkKeyMsg },
    covcards: { title: 'Aperçu des couvertures', rp: 'couverture', span: 12, prio: 1, render: rpBlkCovCards },
    byoffice: { title: 'Performance par bureau', span: 12, prio: 1, movable: true, render: rpBlkByOffice },
    roadmap: { title: 'Feuille de route', span: 12, prio: 1, render: rpBlkRoadmap },
    bilat: { title: 'Suite et bilatéraux', span: 12, prio: 1, render: rpBlkBilat }
  };
  // ---------------------------------------------------------------- pages de chaque modèle
  function rpFichePage(a, kind) { return { id: 'fiche:' + a, title: ACT[a] ? ACT[a].short : a, kind, a, blocks: ['fband', 'fscore', 'fdom', 'fnorm', 'falert', 'fcouv', 'fkeep'] }; }
  function rpBasePages(tpl, M) {
    const acts = M.acts.filter(a => M.rows.some(r => r.a === a));
    const prioPage = { id: 'prio', title: 'Visites prioritaires', kind: 'annex', blocks: ['prio'], interne: true };
    const methodPage = { id: 'methode', title: 'Méthode et notes', kind: 'annex', blocks: ['method'] };
    // Pilotage : rapport complet pour le chef de programme et les gestionnaires (structure décisionnelle du deck CCO)
    if (tpl === 'pilotage') {
      const base = [
        { id: 'pl1', title: 'Couverture', kind: 'first', blocks: ['figures', 'rings', 'bubbles'] },
        { id: 'pl2', title: 'Message clé', kind: 'body', blocks: ['keymsg', 'hilite'] },
        { id: 'pl3', title: 'Aperçu des couvertures', kind: 'body', blocks: ['covcards', 'acts'] },
        { id: 'pl4', title: 'Aperçu géographique', kind: 'body', blocks: ['choro', 'byoffice'] },
        { id: 'pl5', title: 'Priorités par bureau', kind: 'body', blocks: ['exec', 'blind'] }];
      const actPages = acts.map(a => rpFicheOk(M, a)
        ? { id: 'fiche:' + a, title: ACT[a] ? ACT[a].short : a, kind: 'body', a, blocks: ['fband', 'fscore', 'fnorm', 'falert', 'fdom', 'fcouv', 'fkeep'] }
        : Object.assign(rpFichePage(a, 'stub'), { stub: ACT[a].short + ' : ' + rpMask((rpActRow(M, a) || { r: { n: 0 } }).r.n) + ' visites, moins de ' + SMALL_N.min }));
      return base.concat(actPages, [
        { id: 'plroad', title: 'Feuille de route', kind: 'body', blocks: ['roadmap'] },
        { id: 'plbilat', title: 'Suite et bilatéraux', kind: 'body', blocks: ['bilat'] },
        prioPage, methodPage]);
    }
    // Synthèse exécutive : une seule page infographique (chiffres, couverture, indicateurs, faits marquants)
    if (tpl === 'synthese') return [
      { id: 's1', title: 'Synthèse', kind: 'first', blocks: ['figures', 'rings', 'bubbles', 'kpis', 'hilite', 'decide'] },
      methodPage];
    // Fiche activité : la fiche complète d'une activité choisie, en rapport autonome
    if (tpl === 'activite') { const a = rpActSel(M); return [
      { id: 'fa', title: a && ACT[a] ? ACT[a].short : 'Activité', kind: 'first', a, blocks: ['fband', 'fscore', 'fdom', 'fnorm', 'falert', 'fcouv', 'fkeep'] }, methodPage]; }
    // Rapport bailleur : diffusable, couverture + conformité par partenaire + suites des cas (période des filtres)
    if (tpl === 'bailleur') return [
      { id: 'b1', title: 'Couverture et conformité', kind: 'first', blocks: ['rings', 'pmeo'] },
      { id: 'b2', title: 'Terrain et suites', kind: 'body', blocks: ['choro', 'suites'] },
      methodPage];
    if (tpl === 'partenaires') return [
      { id: 'pp1', title: 'Partenaires de mise en œuvre', kind: 'first', blocks: ['pmeo', 'districts'] },
      { id: 'pp2', title: 'Organisations de suivi', kind: 'body', blocks: ['orgqual', 'dur', 'agents', 'share'] },
      { id: 'pp3', title: 'Terrain et plan', kind: 'body', blocks: ['choro', 'blind', 'exec'] },
      { id: 'pp4', title: 'Cas graves et suites', kind: 'body', blocks: ['cases', 'caselist', 'plans', 'sign'] },
      prioPage, methodPage];
    const first = { id: 'p1', title: 'Situation', kind: 'first', blocks: ['figures', 'acts', 'decide'] };
    // Revue trimestrielle : fenêtre de 3 mois, situation + terrain + fiches d'activité + décisions
    if (tpl === 'trimestre') return [
      { id: 't1', title: 'Situation', kind: 'first', blocks: ['figures', 'rings', 'acts', 'decide'] },
      { id: 't2', title: 'Terrain et couverture', kind: 'body', blocks: ['bubbles', 'choro', 'blind', 'exec'] }]
      .concat(acts.filter(a => rpFicheOk(M, a)).map(a => rpFichePage(a, 'body')),
        [{ id: 'dec', title: 'Décisions et suivi', kind: 'body', blocks: ['dec1', 'dec2', 'sign'] }, prioPage, methodPage]);
    if (tpl === 'mensuelle') return [first].concat(acts.map(a => rpFicheOk(M, a) ? rpFichePage(a, 'body') : Object.assign(rpFichePage(a, 'stub'), { stub: ACT[a].short + ' : ' + rpMask((rpActRow(M, a) || { r: { n: 0 } }).r.n) + ' visites, moins de ' + SMALL_N.min })),
      [{ id: 'dec', title: 'Décisions et suivi', kind: 'body', blocks: ['dec1', 'dec2', 'sign'] }, prioPage, methodPage]);
    return [first,
      { id: 'n2', title: 'Où agir', kind: 'body', blocks: ['choro', 'blind', 'weak', 'norms'] },
      { id: 'n3', title: 'Alertes et cas', kind: 'body', blocks: ['cases', 'signals', 'meals', 'partic'] },
      { id: 'n4', title: 'Moyens du suivi', kind: 'body', blocks: ['capacity', 'exec', 'orgs', 'rel'] }]
      .concat(acts.filter(a => rpFicheOk(M, a)).map(a => rpFichePage(a, 'annex')), [{ id: 'prio', title: 'Visites prioritaires', kind: 'annex', blocks: ['prio'], interne: true }, { id: 'methode', title: 'Méthode et notes', kind: 'annex', blocks: ['method'] }]);
  }
  // ---------------------------------------------------------------- composition (localStorage, clé v3 ; la v2 reste celle de l'ancien rapport)
  function rpTcfgDefault() { return { order: [], hidden: {}, shown: {}, blk: {}, bord: {}, bhid: {}, free: [], notes: 'yes' }; }
  function rpCfgClean(c) {
    const o = { tpl: null, perTpl: {} }; if (!c || typeof c !== 'object') return o;
    if (RP_TPL_IDS.indexOf(c.tpl) >= 0) o.tpl = c.tpl;
    const P = c.perTpl && typeof c.perTpl === 'object' ? c.perTpl : {};
    const ids = a => Array.isArray(a) ? a.filter(x => typeof x === 'string' && x.length < 60).slice(0, 60) : [];
    const flags = m => { const r = {}; if (m && typeof m === 'object') Object.keys(m).slice(0, 200).forEach(k => { if (k.length < 80 && m[k]) r[k] = true; }); return r; };
    RP_TPL_IDS.forEach(t => {
      const s = P[t]; if (!s || typeof s !== 'object') return; const d = rpTcfgDefault();
      d.order = ids(s.order); d.hidden = flags(s.hidden); d.shown = flags(s.shown); d.bhid = flags(s.bhid); d.notes = s.notes === 'no' ? 'no' : 'yes';
      if (s.blk && typeof s.blk === 'object') Object.keys(s.blk).forEach(k => { if (!RP_B[k] || !s.blk[k] || typeof s.blk[k] !== 'object') return; d.blk[k] = {}; Object.keys(s.blk[k]).slice(0, 3).forEach(q => { const v = s.blk[k][q]; if (typeof v === 'string' && v.length < 20) d.blk[k][q] = v; }); });
      if (s.bord && typeof s.bord === 'object') Object.keys(s.bord).slice(0, 60).forEach(k => { d.bord[k] = ids(s.bord[k]); });
      d.free = Array.isArray(s.free) ? s.free.filter(x => typeof x === 'string' && /^f[0-9a-z]{1,12}$/.test(x)).slice(0, 10) : [];
      o.perTpl[t] = d;
    });
    return o;
  }
  function rpCfgLoad() { let c = null; try { c = JSON.parse(window.localStorage.getItem(RP_LS) || 'null'); } catch (e) { c = null; } return rpCfgClean(c); }
  function rpCfgSave() { try { window.localStorage.setItem(RP_LS, JSON.stringify(RP_CFG)); } catch (e) { /* stockage indisponible */ } }
  let RP_CFG = rpCfgLoad();
  const rpTpl = () => RP_CFG.tpl || 'direction';
  function rpTcfg(t) { t = t || rpTpl(); return RP_CFG.perTpl[t] || (RP_CFG.perTpl[t] = rpTcfgDefault()); }
  function rpOptVal(type, key) {
    const def = (RP_B[type].opts || []).find(o => o[0] === key); if (!def) return null;
    const v = (rpTcfg().blk[type] || {})[key], dv = typeof def[3] === 'function' ? def[3]() : def[3];
    if (def[4] && def[4]()) return dv;
    return def[2].some(x => x[0] === v) ? v : dv;
  }
  // pages dans l'ordre affiché : la première est fixe ; les annexes sont exclues par défaut
  function rpPagesFor(tpl, M) {
    const T = rpTcfg(tpl), base = rpBasePages(tpl, M).concat(T.free.map(id => ({ id, title: 'Page libre', kind: 'annex', blocks: ['free'], free: true })));
    const first = base[0], rest = base.slice(1), pos = id => { const i = T.order.indexOf(id); return i < 0 ? 1000 + rest.findIndex(p => p.id === id) : i; };
    rest.sort((a, b) => pos(a.id) - pos(b.id));
    const annexOn = SESSION.rpPrintAnnex === true;
    return [first].concat(rest).map(p => {
      const off = p.kind === 'annex' ? !(T.shown[p.id] || annexOn) : !!T.hidden[p.id];
      return Object.assign(p, { excluded: p.kind !== 'stub' && (off || (p.interne && rpDiff())), blocked: p.interne && rpDiff() });
    });
  }
  function rpBlocksOf(pg) {
    const T = rpTcfg(), ids = pg.blocks.map(t => ({ type: t, id: pg.id + '.' + t })), mov = ids.filter(b => RP_B[b.type].movable), ord = T.bord[pg.id] || [];
    const sorted = mov.slice().sort((a, b) => { const ia = ord.indexOf(a.type), ib = ord.indexOf(b.type); return (ia < 0 ? 100 + mov.indexOf(a) : ia) - (ib < 0 ? 100 + mov.indexOf(b) : ib); });
    let k = 0; return ids.map(b => RP_B[b.type].movable ? sorted[k++] : b);
  }
  // ---------------------------------------------------------------- construction d'une page
  function rpBuildPage(pg, M, tpl, opt) {
    opt = opt || {}; const xs = [], T = rpTcfg(tpl);
    const page = el('section', { class: 'rp-page' + (pg.excluded ? ' rp-excl' : '') + (pg.kind === 'annex' ? ' rp-annex' : ''), 'data-pg': pg.id, 'aria-label': pg.title });
    const pin = el('div', { class: 'rp-pin' }), body = el('div', { class: 'rp-body' });
    const C0 = { M, tpl, xs, pageId: pg.id, a: pg.a };
    if (pg.kind === 'first') pin.appendChild(rpHead(Object.assign({ blockTitle: 'En-tête' }, C0)));
    if (pg.kind === 'first' && rpPartnerTpl(tpl)) body.appendChild(el('h2', { class: 'rp-ptitle rp-ptitle-in', text: pg.title }));
    if (pg.kind !== 'first' && !pg.a && !pg.free) pin.appendChild(rpPageHead(pg.title, C0, pg.kind === 'annex' ? 'Annexe' : (rpPartnerTpl(tpl) ? rpWin(rpMonthsOf(F.m0, F.m1)) : piWin(M.T.R))));
    const missing = [];
    rpBlocksOf(pg).forEach(b => {
      const def = Object.assign({ type: b.type, id: b.id }, RP_B[b.type]);
      if (T.bhid[b.id] && !opt.all) { (RP_STATE.userHidden = RP_STATE.userHidden || []).push({ id: b.id, title: def.title, page: pg.title }); return; }
      const o = {}; (def.opts || []).forEach(q => { o[q[0]] = rpOptVal(b.type, q[0]); });
      const C = Object.assign({}, C0, { o, blockTitle: def.title });
      let out = null; try { out = def.render(C); } catch (e) { if (window.console) console.warn('Bloc ' + b.id + ' :', e); out = [el('p', { class: 'rp-empty', text: 'Bloc indisponible pour cette sélection.' })]; }
      if (out && !Array.isArray(out) && out.kids) { def.title = out.title || def.title; out = out.kids; }
      if (out && !Array.isArray(out)) out = [out];
      if (!out || !out.filter(Boolean).length) { missing.push(def.title); return; }
      const blk = def.notitle ? el('section', { class: 'rp-block rp-c' + def.span + ' rp-notitle', 'data-blk': def.id, 'data-type': def.type, 'data-prio': String(def.prio || 1) }, out.filter(Boolean)) : rpBlockEl(C, def, out);
      if (def.movable) blk.classList.add('rp-mov');
      body.appendChild(blk);
    });
    if (!pg.free) { const pc = ovEd('p', 'rp-pcom-' + tpl + '-' + pg.id, '', 'rp-pcom'); pc.setAttribute('data-ph', 'Ajouter un commentaire'); pc.addEventListener('input', () => { if (pc.textContent.length > 300) pc.textContent = pc.textContent.slice(0, 300); }); body.appendChild(pc); }
    pin.appendChild(body); pin.appendChild(el('div', { class: 'rp-notes' }));
    page.appendChild(pin); page.appendChild(rpFoot(C0));
    if (pg.excluded) page.appendChild(el('div', { class: 'rp-exclab rp-scr', text: pg.blocked ? 'Usage interne seulement' : 'Exclue de l’impression' }));
    page._rp = { pg, xs, missing };
    return page;
  }
  // annexe non imprimée : page allégée (titre seul) pour la vignette ; la page complète est construite dès qu'elle est incluse
  function rpStubPage(pg, M, tpl) {
    const page = el('section', { class: 'rp-page rp-excl rp-annex rp-stubpage', 'data-pg': pg.id, 'aria-label': pg.title });
    const pin = el('div', { class: 'rp-pin' }, [rpPageHead(pg.title, { M, tpl }, 'Annexe'),
      el('p', { class: 'rp-empty', text: pg.blocked ? 'Version interne seulement.' : 'Annexe non imprimée. Incluez-la pour l’afficher.' }), el('div', { class: 'rp-notes' })]);
    page.appendChild(pin); page.appendChild(rpFoot({ M, tpl }));
    page.appendChild(el('div', { class: 'rp-exclab rp-scr', text: pg.blocked ? 'Usage interne seulement' : 'Exclue de l’impression' }));
    page._rp = { pg, xs: [], missing: [] };
    return page;
  }
  // ---------------------------------------------------------------- notes numérotées (impression) et ajustement de la police
  function rpNumber(page) {
    page.querySelectorAll('.rp-sup').forEach(n => n.remove());
    const notes = page.querySelector('.rp-notes'); clear(notes);
    if (rpTcfg().notes === 'no') return;
    const seen = new Map(), max = 10; let num = 0;
    page.querySelectorAll('[data-rp]').forEach(n => {
      if (n.closest('.rp-notes')) return;
      const k = n.getAttribute('data-rp'); if (seen.has(k) || !RP_DEF[k]) return;
      if (num >= max) { seen.set(k, 0); return; }
      seen.set(k, ++num);
      const sup = el('sup', { class: 'rp-sup', text: String(num) }); const info = n.querySelector('.info'); if (info) n.insertBefore(sup, info); else n.appendChild(sup);
    });
    const list = Array.from(seen.entries()).filter(e => e[1]);
    if (!list.length) return;
    list.forEach(([k, i]) => notes.appendChild(el('div', { class: 'rp-note' }, [el('b', { text: String(i) }), ' ' + RP_DEF[k].short])));
    if (seen.size > list.length) notes.appendChild(el('div', { class: 'rp-note', text: 'Autres notes en annexe Méthode.' }));
  }
  function rpFitPage(page) {
    const pin = page.querySelector('.rp-pin'); if (!pin) return { f: PILOT.fontMax, over: false };
    let f = PILOT.fontMax; pin.style.fontSize = f + 'pt';
    const over = () => pin.scrollHeight > pin.clientHeight + 1;
    while (over() && f > PILOT.fontMin) { f = Math.round((f - 0.25) * 100) / 100; pin.style.fontSize = f + 'pt'; }
    page.setAttribute('data-fit', String(f));
    return { f, over: over() };
  }
  // Une page qui déborde encore à la police minimale et dont le dernier bloc porte une liste découpable ([data-split] :
  // lignes d'un tableau, entrées de la méthode) continue sur une page « (suite) » : rien n'est jamais coupé.
  function rpSplitPage(src, M, tpl, built) {
    let k = 0, out = [];
    for (let guard = 0; guard < 12; guard++) {
      const r0 = rpFitPage(src); if (!r0.over) break;
      const body = src.querySelector('.rp-body'), blocks = Array.from(body.querySelectorAll('.rp-block')), last = blocks[blocks.length - 1];
      const cont = last && last.querySelector('[data-split]'); if (!cont || cont.children.length < 2) break;
      const pg0 = src._rp.pg, pg = { id: pg0.id + '~' + (++k), title: pg0.title + ' (suite)', kind: pg0.kind === 'first' ? 'body' : pg0.kind, cont: true, root: pg0.root || pg0.id, excluded: pg0.excluded, blocked: pg0.blocked, blocks: [], a: pg0.a };
      const np = rpBuildPage(pg, M, tpl); src.after(np); built.splice(built.indexOf(src) + 1, 0, np); out.push(np);
      const nb = last.cloneNode(true); nb.querySelectorAll('.info,.rp-ctl').forEach(n => n.remove()); nb.classList.remove('rp-sel');
      const nc = nb.querySelector('[data-split]'); clear(nc);
      const nbody = np.querySelector('.rp-body'); nbody.insertBefore(nb, nbody.querySelector('.rp-pcom'));
      const pin = src.querySelector('.rp-pin'); pin.style.fontSize = PILOT.fontMin + 'pt';
      while (cont.children.length > 1 && pin.scrollHeight > pin.clientHeight + 1) nc.insertBefore(cont.lastElementChild, nc.firstChild);
      rpNumber(src); RP_STATE.fit[pg0.id] = rpFitPage(src);
      rpNumber(np); RP_STATE.fit[pg.id] = rpFitPage(np);
      src = np;
    }
    return out;
  }
  // ---------------------------------------------------------------- onglet « Rapport » : concepteur (barre, pages, aperçu, panneau du bloc)
  function rpIsNew() { return !SESSION.rpLegacy; }
  function rpAfterRender() {
    document.querySelectorAll('.rp-legacy-back').forEach(n => n.remove());
    if (TAB !== 'report') { document.querySelectorAll('.rp-gal,.rp-menu').forEach(n => n.remove()); return; }
    if (SESSION.rpLegacy) {
      const b = rpBtn('Retour au nouveau rapport', () => { SESSION.rpLegacy = false; render(); }, 'on rp-legacy-back');
      document.body.appendChild(b);
    }
  }
  function rpRenderTab(main) {
    rpGalleryClose(); rpCloseMenu();
    if (SESSION.rpLegacy) { renderReport(main); return; }
    if (!MONTHS.length) { main.appendChild(el('p', { class: 'note warn', text: 'Aucune visite datée dans les données.' })); return; }
    if (SESSION.rpMode === undefined) SESSION.rpMode = 'diff';
    RP_CFG = rpCfgLoad();
    const U = { app: el('div', { class: 'rp-app' }), bar: el('div', { class: 'rp-bar', role: 'toolbar', 'aria-label': 'Rapport' }), stale: el('div', { class: 'rp-stale' }),
      left: el('aside', { class: 'rp-left', 'aria-label': 'Pages du rapport' }), center: el('div', { class: 'rp-center' }), right: el('aside', { class: 'rp-right', 'aria-label': 'Réglages' }) };
    if (SESSION.rpPanel) U.app.classList.add('rp-panel-open');
    U.app.appendChild(U.bar); U.app.appendChild(U.stale); U.app.appendChild(el('div', { class: 'rp-cols' }, [U.left, U.center, U.right]));
    main.appendChild(U.app); RP_STATE.ui = U; RP_STATE.sel = null; RP_STATE.edSel = null;
    U.center.addEventListener('click', rpOnDocClick); U.center.addEventListener('focusin', ev => { const e = ev.target.closest && ev.target.closest('.ed'); RP_STATE.edSel = e || null; if (e) rpPanel(); });
    rpPaint();
    if (!RP_CFG.tpl && !SESSION.rpGalSeen) { SESSION.rpGalSeen = true; rpGallery(); }
  }
  let RP_SOON = 0;
  function rpSoon() { clearTimeout(RP_SOON); RP_SOON = setTimeout(() => { if (TAB === 'report' && !SESSION.rpLegacy) rpPaint(); }, 30); }
  // repeint depuis le cache : jamais render() (qui ferme les tiroirs et relit tout)
  function rpPaint() {
    const U = RP_STATE.ui; if (!U || !document.body.contains(U.app)) return;
    const t0 = performance.now(), tpl = rpTpl();
    if (tpl === 'trimestre' && SESSION.piK !== 3) SESSION.piK = 3;   // la revue trimestrielle regarde toujours 3 mois
    const M = rpModel(); RP_DEF = rpDefs();
    OV_STALE.length = 0; OV_OLDVER.length = 0; RP_STATE.userHidden = []; RP_STATE.fit = {}; RP_STATE.moved = [];
    const pages = rpPagesFor(tpl, M); RP_STATE.pages = pages;
    rpBarFill(M, tpl);
    const doc = el('div', { class: 'rp-doc rp-m-' + rpMode() }); doc.appendChild(rpDefsSvg());
    const built = []; pages.forEach(pg => { if (pg.kind === 'stub') return; const p = pg.excluded && pg.kind === 'annex' ? rpStubPage(pg, M, tpl) : rpBuildPage(pg, M, tpl); doc.appendChild(p); built.push(p); });
    const zoom = el('div', { class: 'rp-zoom' }, doc), zs = rpSeg(SESSION.rpZoom === '100' ? '100' : 'fit', [['fit', 'Ajusté'], ['100', '100 %']], v => { SESSION.rpZoom = v; rpZoomApply(); clear(zs.parentNode ? zs.parentNode : zs); rpPaintZoomSeg(); }, 'Zoom');
    clear(U.center); U.center.appendChild(el('div', { class: 'rp-zseg' }, zs)); U.center.appendChild(zoom); RP_STATE.doc = doc; RP_STATE.zoom = zoom;
    rpLayout(M, tpl, doc, built);
    // dédoublonne les textes « à revoir » (le titre apparaît dans la barre et sur la page 1)
    const sk = new Set(); for (let i = 0; i < OV_STALE.length; i++) { if (sk.has(OV_STALE[i].k)) { OV_STALE.splice(i, 1); i--; } else sk.add(OV_STALE[i].k); }
    rpStaleLine();
    rpZoomApply();
    piHash(h => { document.querySelectorAll('.rp-hashv').forEach(n => { n.textContent = piHashTxt(h); }); });
    RP_STATE.built = built; RP_STATE.tplBuilt = tpl; RP_STATE.paintN++;
    if (RP_STATE.sel && !doc.querySelector('[data-blk="' + RP_STATE.sel + '"]')) RP_STATE.sel = null;
    if (RP_STATE.sel) rpSelect(RP_STATE.sel, true);
    rpPanel();
    RP_STATE.ms = Math.round(performance.now() - t0);
    requestAnimationFrame(() => rpThumbs());
  }
  function rpPaintZoomSeg() { rpPaint(); }
  // ajustement par page, blocs de plus faible priorité déplacés en « Compléments », numéros de page
  function rpLayout(M, tpl, doc, built) {
    document.body.classList.add('rp-measure');
    const moved = [];
    try {
      built.slice().forEach(p => {
        rpNumber(p); let r = rpFitPage(p);
        while (r.over && !p._rp.pg.excluded) {
          const cand = Array.from(p.querySelectorAll('.rp-block.rp-mov')).sort((a, b) => (+b.getAttribute('data-prio') - +a.getAttribute('data-prio')) || 0);
          const mv = cand.filter(b => +b.getAttribute('data-prio') === +(cand[0] || b).getAttribute('data-prio')).pop(); if (!mv) break;
          moved.push({ from: p._rp.pg, node: mv }); mv.remove(); rpNumber(p); r = rpFitPage(p);
        }
        RP_STATE.fit[p._rp.pg.id] = r;
        if (r.over) rpSplitPage(p, M, tpl, built);   // annexes et listes longues : pages « (suite) »
      });
      if (moved.length) {
        RP_STATE.moved = moved.map(x => ({ from: x.from.id, title: x.node.querySelector('.rp-bt') ? x.node.querySelector('.rp-bt').textContent : '' }));
        const lastBody = built.filter(p => p._rp.pg.kind !== 'annex').pop(); let anchor = lastBody, cur = null, k = 0;
        const newPage = () => { const pg = { id: 'compl' + (++k), title: 'Compléments', kind: 'compl', blocks: [] }, p = rpBuildPage(pg, M, tpl); anchor.after(p); anchor = p; built.splice(built.indexOf(lastBody) + k, 0, p); return p; };
        moved.forEach(x => {
          if (!cur) cur = newPage(); const body = cur.querySelector('.rp-body'), pc = body.querySelector('.rp-pcom');
          body.insertBefore(x.node, pc); rpNumber(cur); let r = rpFitPage(cur);
          if (r.over && body.querySelectorAll('.rp-block').length > 1) { cur = newPage(); const b2 = cur.querySelector('.rp-body'); b2.insertBefore(x.node, b2.querySelector('.rp-pcom')); rpNumber(cur); r = rpFitPage(cur); }
          RP_STATE.fit[cur._rp.pg.id] = r;
          if (r.over) { const s = rpSplitPage(cur, M, tpl, built); if (s.length) { anchor = s[s.length - 1]; k += s.length; } }
        });
      }
    } finally { document.body.classList.remove('rp-measure'); }
    const vis = built.filter(p => !p._rp.pg.excluded); RP_STATE.visible = vis.length;
    vis.forEach((p, i) => { const n = p.querySelector('.rp-pn'); if (n) n.textContent = (i + 1) + ' / ' + vis.length; });
    RP_STATE.xs = built.filter(p => !p._rp.pg.excluded).map(p => ({ title: p._rp.pg.title, rows: p._rp.xs }));
    RP_STATE.missing = [].concat.apply([], built.map(p => p._rp.missing.map(t => t + ' (' + p._rp.pg.title + ')')));
  }
  function rpRefit() {
    if (!RP_STATE.doc) return; document.body.classList.add('rp-measure');
    try { RP_STATE.doc.querySelectorAll('.rp-page').forEach(p => { RP_STATE.fit[p.getAttribute('data-pg')] = rpFitPage(p); }); } finally { document.body.classList.remove('rp-measure'); }
  }
  function rpZoomApply() {
    const z = RP_STATE.zoom, doc = RP_STATE.doc, U = RP_STATE.ui; if (!z || !doc || !U) return;
    const pw = RP_SZ.pageW * RP_PX, avail = U.center.clientWidth - 8, s = SESSION.rpZoom === '100' ? 1 : Math.max(0.3, Math.min(1, avail / pw));
    doc.style.transform = s < 1 ? 'scale(' + s.toFixed(4) + ')' : ''; z.style.width = (pw * s) + 'px'; z.style.height = (doc.offsetHeight * s) + 'px';
  }
  // ---------------------------------------------------------------- barre du haut
  function rpBarFill(M, tpl) {
    const U = RP_STATE.ui, b = clear(U.bar), mode = rpMode();
    const title = rpTitleEd(M, tpl, 'span', 'rp-bartitle');
    b.appendChild(rpBtn('Modèle : ' + RP_TPL[tpl].name + ' ▾', rpGallery, 'rp-tplbtn', 'Choisir un modèle'));
    b.appendChild(title);
    if (!rpPartnerTpl(tpl) && tpl !== 'trimestre') b.appendChild(rpSeg(rpK(), [[3, '3 mois'], [1, '1 mois']], v => { SESSION.piK = +v; rpPaint(); }, 'Fenêtre'));
    if (tpl === 'activite') { const sel = rpActSel(M), opts = M.acts.map(a => [a, ACT[a] ? ACT[a].short : a]); if (opts.length > 1) b.appendChild(rpSeg(sel, opts, v => { SESSION.rpActSel = v; rpPaint(); }, 'Activité')); }
    b.appendChild(rpSeg(mode, [['diff', 'Diffusable'], ['int', 'Interne']], v => { SESSION.rpMode = v; rpPaint(); }, 'Version'));
    b.appendChild(rpBtn('Imprimer A4', () => rpPrint(false), 'on rp-print'));
    b.appendChild(rpBtn(RP_PPTX_LABEL, () => rpExportPptx(), 'rp-pptx', 'Exporter le modèle courant en PowerPoint (une slide par page)'));
    b.appendChild(rpBtn('Réglages', () => { SESSION.rpPanel = !SESSION.rpPanel; U.app.classList.toggle('rp-panel-open', !!SESSION.rpPanel); }, 'rp-panbtn'));
    const more = rpBtn('…', ev => { ev.stopPropagation(); rpMenu(more, M); }, 'rp-more', 'Autres actions'); more.setAttribute('aria-haspopup', 'menu'); more.setAttribute('aria-label', 'Autres actions');
    b.appendChild(more);
    const top = document.querySelector('.top'); U.bar.style.top = (top ? top.offsetHeight : 0) + 'px';
  }
  function rpCloseMenu() { document.querySelectorAll('.rp-menu').forEach(n => n.remove()); document.removeEventListener('click', rpCloseMenu); document.removeEventListener('keydown', rpMenuEsc); }
  function rpMenuEsc(e) { if (e.key === 'Escape') rpCloseMenu(); }
  function rpMenu(anchor, M) {
    if (document.querySelector('.rp-menu')) { rpCloseMenu(); return; }
    const it = (t, fn, dis) => { const x = rpBtn(t, () => { rpCloseMenu(); fn(); }, 'rp-mi'); x.setAttribute('role', 'menuitem'); if (dis) x.disabled = true; return x; };
    const fi = el('input', { type: 'file', 'aria-label': 'Importer un brouillon', class: 'rp-file' }); fi.accept = '.json,application/json';
    fi.addEventListener('change', () => { rpCloseMenu(); rpImportDraft(fi.files && fi.files[0]); });
    const imp = el('label', { class: 'btn rp-mi', role: 'menuitem' }, ['Importer un brouillon', fi]);
    const m = el('div', { class: 'rp-menu', role: 'menu' }, [it('Imprimer avec annexes', () => rpPrint(true)), it('Exporter les chiffres (.xlsx)', rpExportXlsx), it('Figer cette revue', () => piFreeze(M)),
      it('Exporter le brouillon (.json)', rpExportDraft), imp, it('Rétablir les textes calculés', rpResetTexts), it('Composition par défaut', () => { RP_CFG.perTpl[rpTpl()] = rpTcfgDefault(); rpCfgSave(); rpPaint(); }),
      it('Rapport détaillé (ancien)', () => { SESSION.rpLegacy = true; render(); })]);
    m.addEventListener('click', ev => ev.stopPropagation());
    const r = anchor.getBoundingClientRect(); m.style.top = (r.bottom + 4) + 'px'; m.style.right = Math.max(8, window.innerWidth - r.right) + 'px';
    document.body.appendChild(m); setTimeout(() => { document.addEventListener('click', rpCloseMenu); document.addEventListener('keydown', rpMenuEsc); }, 0);
    const f = m.querySelector('button'); if (f) f.focus();
  }
  // ---------------------------------------------------------------- bandeau « à revoir » (une ligne, qui déplie celui du rapport existant)
  function rpStaleLine() {
    const box = clear(RP_STATE.ui.stale), n = OV_STALE.length + OV_OLDVER.length; if (!n) return;
    const anchor = el('div', { class: 'rp-staleh' }, [el('span', { text: fmt(n) + ' texte' + (n > 1 ? 's' : '') + ' saisi' + (n > 1 ? 's' : '') + ' avant la mise à jour du ' + dFrUI(D.generated) + ' : ' }),
      rpBtn('Revoir', () => { if (box.querySelector('.ov-banner')) { box.querySelector('.ov-banner').remove(); return; } ovStaleBanner(box, anchor); }, 'sm')]);
    box.appendChild(anchor);
  }
  // ---------------------------------------------------------------- sélection d'un bloc dans l'aperçu
  function rpOnDocClick(ev) {
    const b = ev.target.closest('.rp-block'); if (!b || ev.target.closest('.rp-ctl')) return;
    rpSelect(b.getAttribute('data-blk'));
  }
  function rpSelect(id, keep) {
    const doc = RP_STATE.doc; if (!doc) return;
    doc.querySelectorAll('.rp-block.rp-sel').forEach(n => { n.classList.remove('rp-sel'); const c = n.querySelector('.rp-ctl'); if (c) c.remove(); });
    if (!keep && RP_STATE.sel === id) { RP_STATE.sel = null; rpPanel(); return; }
    const b = doc.querySelector('[data-blk="' + id + '"]'); RP_STATE.sel = b ? id : null; if (!b) { rpPanel(); return; }
    b.classList.add('rp-sel');
    const pgId = id.slice(0, id.lastIndexOf('.')), type = id.slice(id.lastIndexOf('.') + 1), pg = RP_STATE.pages.find(p => p.id === pgId);
    const ctl = el('div', { class: 'rp-ctl rp-scr' });
    if (RP_B[type] && RP_B[type].movable && pg) { ctl.appendChild(rpBtn('↑', () => rpMoveBlock(pg, type, -1), 'sm', 'Monter le bloc')); ctl.appendChild(rpBtn('↓', () => rpMoveBlock(pg, type, 1), 'sm', 'Descendre le bloc')); }
    ctl.appendChild(rpBtn('Masquer', () => { rpTcfg().bhid[id] = true; RP_STATE.sel = null; rpCfgSave(); rpPaint(); }, 'sm', 'Masquer ce bloc'));
    b.appendChild(ctl); if (!keep) rpPanel();
  }
  function rpMoveBlock(pg, type, d) {
    const mov = rpBlocksOf(pg).filter(b => RP_B[b.type].movable).map(b => b.type), i = mov.indexOf(type), j = i + d; if (i < 0 || j < 0 || j >= mov.length) return;
    [mov[i], mov[j]] = [mov[j], mov[i]]; rpTcfg().bord[pg.id] = mov; rpCfgSave(); rpPaint();
  }
  // ---------------------------------------------------------------- panneau de droite : réglages du bloc, ou résumé
  function rpPanel() {
    const U = RP_STATE.ui; if (!U) return; const R = clear(U.right), M = RP_CACHE.M, tpl = rpTpl();
    const id = RP_STATE.sel, type = id ? id.slice(id.lastIndexOf('.') + 1) : null, def = type ? RP_B[type] : null;
    if (def) {
      R.appendChild(el('div', { class: 'rp-rh' }, [el('h3', { text: def.title }), rpBtn('Fermer', () => { rpSelect(id); }, 'sm')]));
      (def.opts || []).slice(0, 3).forEach(o => {
        const dis = o[4] ? o[4]() : null, cur = rpOptVal(type, o[0]);
        R.appendChild(el('div', { class: 'rp-opt' + (dis ? ' rp-dis' : '') }, [el('div', { class: 'rp-ol', text: o[1] }), rpSeg(cur, o[2], v => { const T = rpTcfg(); (T.blk[type] = T.blk[type] || {})[o[0]] = v; rpCfgSave(); rpPaint(); }, o[1], !!dis), dis ? el('div', { class: 'rp-oh', text: dis }) : null]));
      });
      if (!(def.opts || []).length) R.appendChild(el('p', { class: 'rp-oh', text: 'Pas de réglage pour ce bloc.' }));
      const d = RP_DEF[def.rp];
      if (d) {
        const pgEl = RP_STATE.doc && RP_STATE.doc.querySelector('[data-blk="' + id + '"]'), page = pgEl ? pgEl.closest('.rp-page') : null;
        const rows = page && page._rp ? page._rp.xs.filter(x => x[0] === def.title).slice(0, 4) : [];
        R.appendChild(el('details', { class: 'rp-how', open: 'open' }, [el('summary', { text: 'Comment c’est calculé' }),
          rows.length ? kvList(rows.map(x => [x[1], x[2] + (x[3] ? ' (' + x[3] + ')' : '')])) : null,
          el('p', { text: d.def }), d.formula ? el('p', { class: 'rp-oh', text: 'Calcul : ' + d.formula }) : null, d.ref ? el('p', { class: 'rp-oh', text: 'Référence : ' + d.ref }) : null, d.limits ? el('p', { class: 'rp-oh', text: 'Limites : ' + d.limits }) : null]));
      }
    } else {
      const pages = RP_STATE.pages.filter(p => p.kind !== 'stub' && !p.excluded), per = rpPartnerTpl(tpl) ? rpWin(rpMonthsOf(F.m0, F.m1)) + ', période des filtres' : piWin(M.T.R) + ', comparé à ' + piWin(M.T.P);
      R.appendChild(el('div', { class: 'rp-rh' }, [el('h3', { text: RP_TPL[tpl].name })]));
      R.appendChild(kvList([['Pages', fmt(RP_STATE.visible || pages.length)], ['Période', per], ['Filtres', el('span', null, [filtersActiveText() + ' ', rpBtn('modifier', () => { const f = document.getElementById('filters'); if (f) { f.scrollIntoView({ block: 'start' }); const s = f.querySelector('select'); if (s) s.focus(); } }, 'rp-link')])]]));
      if (RP_STATE.missing && RP_STATE.missing.length) R.appendChild(el('p', { class: 'rp-oh', text: 'Masqués faute de données : ' + RP_STATE.missing.join(', ') + '.' }));
      if (RP_STATE.moved && RP_STATE.moved.length) R.appendChild(el('p', { class: 'rp-oh', text: 'Passés en Compléments : ' + RP_STATE.moved.map(x => x.title).join(', ') + '.' }));
      (RP_STATE.userHidden || []).forEach(h => R.appendChild(el('div', { class: 'rp-hid' }, [el('span', { text: 'Masqué : ' + h.title + ' (' + h.page + ')' }), rpBtn('Rétablir', () => { delete rpTcfg().bhid[h.id]; rpCfgSave(); rpPaint(); }, 'sm')])));
      R.appendChild(el('p', { class: 'rp-oh', text: 'Cliquez un bloc de l’aperçu pour ses réglages.' }));
    }
    if (RP_STATE.edSel && RP_STATE.edSel.classList.contains('edited') && document.body.contains(RP_STATE.edSel)) {
      const e = RP_STATE.edSel; R.appendChild(rpBtn('Revenir au texte calculé', () => { const id2 = e.getAttribute('data-id'), g = OV_GLOBAL_RE.test(id2), k = (g ? 'G' : scopeKey()) + '#' + id2, s = lsLoad(); delete s[k]; lsSave(s); RP_STATE.edSel = null; rpPaint(); }, 'rp-revert'));
    }
    // options avancées (fermées par défaut)
    const T = rpTcfg(), annex = RP_STATE.pages.filter(p => p.kind === 'annex');
    R.appendChild(el('details', { class: 'rp-adv' }, [el('summary', { text: 'Options avancées' }),
      el('div', { class: 'rp-ol', text: 'Annexes à imprimer' }),
      el('div', null, annex.map(p => { const c = el('input', { type: 'checkbox' }); c.checked = !!T.shown[p.id]; c.disabled = !!p.blocked; c.addEventListener('change', () => { if (c.checked) T.shown[p.id] = true; else delete T.shown[p.id]; rpCfgSave(); rpPaint(); }); return el('label', { class: 'rp-chk' }, [c, p.title + (p.blocked ? ' (interne)' : '')]); })),
      el('div', { class: 'rp-ol', text: 'Notes de bas de page imprimées' }), rpSeg(T.notes, YN, v => { T.notes = v; rpCfgSave(); rpPaint(); }, 'Notes'),
      el('label', { class: 'rp-chk' }, [(() => { const c = el('input', { type: 'checkbox' }); c.checked = true; c.disabled = true; return c; })(), 'Agents jamais nommés'])]));
  }
  // ---------------------------------------------------------------- colonne des pages : vignettes (clones du DOM ajusté)
  function rpStripClone(n) {
    [n].concat(Array.from(n.querySelectorAll('*'))).forEach(x => { x.removeAttribute('id'); x.removeAttribute('contenteditable'); x.removeAttribute('tabindex'); if (x.getAttribute('role') === 'button') x.removeAttribute('role'); });
    n.setAttribute('aria-hidden', 'true'); n.inert = true; return n;
  }
  function rpThumbs() {
    const U = RP_STATE.ui; if (!U || !RP_STATE.doc) return; const L = clear(U.left), T = rpTcfg(), pages = RP_STATE.pages;
    L.appendChild(el('div', { class: 'rp-lh', text: 'Pages' }));
    const doc = RP_STATE.doc, vis = []; doc.querySelectorAll('.rp-page').forEach(p => vis.push(p));
    const list = el('div', { class: 'rp-plist', role: 'list' });
    const order = vis.map(p => p.getAttribute('data-pg'));
    pages.filter(p => p.kind === 'stub').forEach(p => order.splice(order.indexOf('dec') >= 0 ? order.indexOf('dec') : order.length, 0, p.id));
    let num = 0;
    order.forEach(pid => {
      const pe = vis.find(p => p.getAttribute('data-pg') === pid), pg = pages.find(p => p.id === pid) || (pe && pe._rp ? pe._rp.pg : { id: pid, kind: 'compl', title: 'Compléments' });
      const item = el('div', { class: 'rp-pitem' + (pg.excluded ? ' rp-poff' : '') + (pg.kind === 'stub' ? ' rp-pstub' : ''), role: 'listitem', 'data-pid': pid, tabindex: '0', 'aria-label': pg.title });
      const head = el('div', { class: 'rp-phd' }, [el('span', { class: 'rp-pnum', text: pg.kind === 'stub' || pg.excluded ? '–' : String(++num) }), el('span', { class: 'rp-pname', text: pg.kind === 'annex' ? 'Annexe : ' + pg.title : pg.title })]);
      item.appendChild(head);
      if (pg.kind === 'stub') { const g = el('div', { class: 'rp-thumb rp-thumbstub' }, [el('span', { text: pg.stub || '' })]); bindTip(g, () => pg.stub || ''); item.appendChild(g); list.appendChild(item); return; }
      const th = el('div', { class: 'rp-thumb' }); if (pe) th.appendChild(rpStripClone(pe.cloneNode(true)));
      th.addEventListener('click', () => { if (pe) pe.scrollIntoView({ block: 'start', behavior: 'smooth' }); });
      item.appendChild(th);
      const marks = el('div', { class: 'rp-marks' });
      const st = pe ? pe.querySelectorAll('.ov-stale').length : 0; if (st) marks.appendChild(el('span', { class: 'rp-mk rp-mk-st', text: '● ' + st + ' à revoir' }));
      if (RP_STATE.fit[pid] && RP_STATE.fit[pid].over) marks.appendChild(el('span', { class: 'rp-mk rp-mk-ov', text: '▲ déborde' }));
      if ((RP_STATE.moved || []).some(x => x.from === pid)) marks.appendChild(el('span', { class: 'rp-mk', text: 'bloc déplacé' }));
      if (marks.children.length) item.appendChild(marks);
      if (pg.kind !== 'first' && pg.kind !== 'compl' && !pg.cont) {
        const ctl = el('div', { class: 'rp-pctl' });
        const eye = rpBtn(pg.excluded ? 'Inclure' : 'Exclure', () => { if (pg.kind === 'annex') { if (T.shown[pid]) delete T.shown[pid]; else T.shown[pid] = true; } else { if (T.hidden[pid]) delete T.hidden[pid]; else T.hidden[pid] = true; } rpCfgSave(); rpPaint(); }, 'sm', pg.excluded ? 'Imprimer cette page' : 'Ne pas imprimer cette page');
        if (pg.blocked) eye.disabled = true;
        ctl.appendChild(eye); ctl.appendChild(rpBtn('↑', () => rpMovePage(pid, -1), 'sm rp-arw', 'Monter la page')); ctl.appendChild(rpBtn('↓', () => rpMovePage(pid, 1), 'sm rp-arw', 'Descendre la page'));
        if (pg.free) ctl.appendChild(rpBtn('Supprimer', () => { T.free = T.free.filter(x => x !== pid); rpCfgSave(); rpPaint(); }, 'sm'));
        const grip = el('span', { class: 'rp-grip', 'aria-hidden': 'true', text: '⋮⋮' }); head.insertBefore(grip, head.firstChild);
        item.appendChild(ctl); item.draggable = true;
        item.addEventListener('dragstart', ev => { ev.dataTransfer.setData('text/plain', pid); ev.dataTransfer.effectAllowed = 'move'; });
        item.addEventListener('keydown', ev => { if (ev.altKey && (ev.key === 'ArrowUp' || ev.key === 'ArrowDown')) { ev.preventDefault(); rpMovePage(pid, ev.key === 'ArrowUp' ? -1 : 1); } });
      }
      item.addEventListener('dragover', ev => { ev.preventDefault(); item.classList.add('rp-drop'); });
      item.addEventListener('dragleave', () => item.classList.remove('rp-drop'));
      item.addEventListener('drop', ev => { ev.preventDefault(); item.classList.remove('rp-drop'); const src = ev.dataTransfer.getData('text/plain'); if (src && src !== pid) rpMovePageTo(src, pid); });
      list.appendChild(item);
    });
    L.appendChild(list);
    const add = rpBtn('+ Annexe', ev => { ev.stopPropagation(); rpAnnexMenu(add); }, 'rp-addannex');
    L.appendChild(add);
    if (RP_STATE.focusPage) { const f = L.querySelector('[data-pid="' + RP_STATE.focusPage + '"]'); if (f) f.focus(); RP_STATE.focusPage = null; }
  }
  function rpOrderNow() { return RP_STATE.pages.filter(p => p.kind !== 'first' && p.kind !== 'compl').map(p => p.id); }
  function rpMovePage(pid, d) {
    const o = rpOrderNow(), i = o.indexOf(pid), j = i + d; if (i < 0 || j < 0 || j >= o.length) return;
    [o[i], o[j]] = [o[j], o[i]]; rpTcfg().order = o; rpCfgSave(); RP_STATE.focusPage = pid; rpPaint();
  }
  function rpMovePageTo(src, dst) {
    const o = rpOrderNow(), i = o.indexOf(src); if (i < 0) return; o.splice(i, 1); const j = o.indexOf(dst); if (j < 0) return;
    o.splice(j, 0, src); rpTcfg().order = o; rpCfgSave(); rpPaint();
  }
  function rpAnnexMenu(anchor) {
    if (document.querySelector('.rp-menu')) { rpCloseMenu(); return; }
    const T = rpTcfg(), annex = RP_STATE.pages.filter(p => p.kind === 'annex' && !p.free);
    const items = annex.map(p => { const b = rpBtn(p.title, () => { rpCloseMenu(); T.shown[p.id] = true; rpCfgSave(); rpPaint(); }, 'rp-mi'); if (p.blocked || T.shown[p.id]) b.disabled = true; return b; });
    items.push(rpBtn('Page libre', () => { rpCloseMenu(); if (T.free.length < 10) { T.free.push('f' + Date.now().toString(36).slice(-8)); T.shown[T.free[T.free.length - 1]] = true; rpCfgSave(); rpPaint(); } }, 'rp-mi'));
    const m = el('div', { class: 'rp-menu', role: 'menu' }, items); m.addEventListener('click', ev => ev.stopPropagation());
    const r = anchor.getBoundingClientRect(); m.style.top = Math.min(window.innerHeight - 240, r.bottom + 4) + 'px'; m.style.left = r.left + 'px';
    document.body.appendChild(m); setTimeout(() => { document.addEventListener('click', rpCloseMenu); document.addEventListener('keydown', rpMenuEsc); }, 0);
  }
  // ---------------------------------------------------------------- galerie des modèles
  // nombre de pages imprimées (hors annexes et pages « interne » en mode diffusable) : lu depuis la composition réelle
  function rpPageCount(t, M) { return rpBasePages(t, M).filter(p => p.kind !== 'annex' && p.kind !== 'stub' && !(p.interne && rpDiff())).length; }
  // fenêtre surgissante (non modale : elle ne couvre jamais les onglets ni la barre de filtres ; un clic ailleurs la ferme)
  function rpGalleryClose() { document.querySelectorAll('.rp-gal').forEach(n => n.remove()); document.removeEventListener('click', rpGalleryClose); document.removeEventListener('keydown', rpGalleryEsc); }
  function rpGalleryEsc(e) { if (e.key === 'Escape') rpGalleryClose(); }
  function rpGalCard(t, M, cur) {
    const pg = rpBasePages(t, M)[0], p = rpBuildPage(Object.assign({}, pg, { excluded: false }), M, t);
    rpNumber(p); const prev = el('div', { class: 'rp-galthumb' }, rpStripClone(p)), n = rpPageCount(t, M), tag = RP_TPL[t].tag;
    const choose = rpBtn(cur === t ? 'Modèle actuel ✓' : 'Choisir', () => { RP_CFG.tpl = t; if (t === 'bailleur' && SESSION.rpMode === undefined) SESSION.rpMode = 'diff'; rpCfgSave(); rpGalleryClose(); rpPaint(); }, cur === t ? '' : 'on');
    return el('div', { class: 'rp-galcard' + (cur === t ? ' rp-cur' : '') }, [
      el('div', { class: 'rp-galth-wrap' }, [prev, tag ? el('span', { class: 'rp-galtag', text: tag }) : null]),
      el('h3', { text: RP_TPL[t].name }), el('p', { class: 'rp-oh', text: RP_TPL[t].reader + ' · ' + n + (n > 1 ? ' pages' : ' page') }), choose]);
  }
  function rpGallery() {
    if (document.querySelector('.rp-gal')) { rpGalleryClose(); return; }
    const M = rpModel(), cur = RP_CFG.tpl, n0 = OV_STALE.length, n1 = OV_OLDVER.length;
    const groups = RP_TPL_GROUPS.map(gr => {
      const ids = RP_TPL_IDS.filter(t => (RP_TPL[t].group || 'Direction') === gr); if (!ids.length) return null;
      return el('div', { class: 'rp-galgroup' }, [el('div', { class: 'rp-galh', text: gr }), el('div', { class: 'rp-galrow' }, ids.map(t => rpGalCard(t, M, cur)))]);
    }).filter(Boolean);
    OV_STALE.length = n0; OV_OLDVER.length = n1;
    const g = el('div', { class: 'rp-gal', role: 'dialog', 'aria-label': 'Choisir un modèle de rapport' }, [
      el('div', { class: 'rp-rh' }, [el('h2', { text: 'Choisir un modèle' }), rpBtn('Fermer', rpGalleryClose, 'sm')])].concat(groups));
    g.addEventListener('click', e => e.stopPropagation());
    const U = RP_STATE.ui, bar = U && U.bar, r = bar ? bar.getBoundingClientRect() : { bottom: 120, left: 20 };
    g.style.top = (r.bottom + 6) + 'px'; g.style.left = Math.max(8, r.left) + 'px';
    document.body.appendChild(g);
    setTimeout(() => { document.addEventListener('click', rpGalleryClose); document.addEventListener('keydown', rpGalleryEsc); }, 0);
    const f = g.querySelector('.rp-galcard .btn.on, .rp-galcard .btn'); if (f) f.focus({ preventScroll: true });
  }
  // ---------------------------------------------------------------- impression, exports, brouillon
  function rpPrint(withAnnex) {
    if (withAnnex) { SESSION.rpPrintAnnex = true; rpPaint(); }
    let done = false;
    const back = () => { if (done) return; done = true; window.removeEventListener('afterprint', back); if (withAnnex) { SESSION.rpPrintAnnex = false; if (TAB === 'report' && !SESSION.rpLegacy) rpPaint(); } };
    window.addEventListener('afterprint', back);
    window.print();
  }
  if (!SESSION.rpHooks) {
    SESSION.rpHooks = true;
    window.addEventListener('beforeprint', () => { if (document.body.classList.contains('is-rp')) rpRefit(); });
    window.addEventListener('resize', () => { if (TAB === 'report' && !SESSION.rpLegacy) rpZoomApply(); });
  }
  function rpSheetName(t, used) { let s = String(t).replace(/[\\/?*[\]:]/g, ' ').slice(0, 28).trim() || 'Page'; let n = s, i = 2; while (used.has(n)) n = s.slice(0, 25) + ' ' + (i++); used.add(n); return n; }
  function rpExportXlsx() {
    const used = new Set(), sheets = (RP_STATE.xs || []).filter(p => p.rows.length).map(p => ({ name: rpSheetName(p.title, used), header: ['Bloc', 'Libellé', 'Valeur', 'Base ou référence'], rows: p.rows }));
    if (!sheets.length) return;
    downloadBlob(xlsxBlob(sheets), 'rapport_' + rpTpl() + '_' + (rpDiff() ? 'diffusable' : 'interne') + '_' + localDay() + '.xlsx');
  }
  function rpDraftObj() { return { kind: 'pm-report', version: 4, dataVer: OV_VER, dataLabel: OV_VERLAB, cfg3: RP_CFG, texts: lsLoad() }; }
  function rpExportDraft() { downloadBlob(new Blob([JSON.stringify(rpDraftObj(), null, 1)], { type: 'application/json' }), 'rapport_suivi_processus_brouillon.json'); }
  // brouillon version 4 (composition v3 + textes) ; la version 3 (ancien rapport : cfg v2 + textes) reste acceptée
  function rpImportDraftObj(j) {
    if (!j || j.kind !== 'pm-report' || (j.version !== 3 && j.version !== 4)) throw new Error('format');
    lsSave(Object.assign(lsLoad(), ovImportTexts(j)));
    if (j.version === 4 && j.cfg3 && typeof j.cfg3 === 'object') { RP_CFG = rpCfgClean(j.cfg3); rpCfgSave(); }
    if (j.version === 3 && j.cfg && typeof j.cfg === 'object') { try { window.localStorage.setItem(CFG_KEY, JSON.stringify(j.cfg)); } catch (e) { /* stockage indisponible */ } RCFG = cfgLoad(); }
    return !!(j.dataVer && j.dataVer !== OV_VER);
  }
  function rpImportDraft(f) {
    if (!f || f.size > 2e6) { if (f) window.alert('Fichier trop volumineux (2 Mo au plus).'); return; }
    const rd = new FileReader();
    rd.onload = () => {
      try {
        const j = JSON.parse(String(rd.result)), other = rpImportDraftObj(j);
        if (other) window.alert('Brouillon rédigé sur d’autres données (' + String(j.dataLabel || j.dataVer).slice(0, 200) + ') : les textes dont le calcul a changé seront signalés « à revoir ».');
        render();
      } catch (e) { window.alert('Fichier non reconnu.'); }
    };
    rd.readAsText(f);
  }
  function rpResetTexts() { const st = lsLoad(), pre = scopeKey() + '#rp-'; Object.keys(st).forEach(k => { if (k.startsWith(pre)) delete st[k]; }); lsSave(st); rpPaint(); }
  if (/debug/.test(location.hash)) window.__dashReport = { model: () => RP_CACHE.M, pages: () => RP_STATE.pages.map(p => ({ id: p.id, kind: p.kind, excluded: !!p.excluded, title: p.title })), fit: () => RP_STATE.fit, setTpl: t => { RP_CFG.tpl = t; rpCfgSave(); rpPaint(); }, setMode: m => { SESSION.rpMode = m; rpPaint(); }, setK: k => { SESSION.piK = k; rpPaint(); }, cfg: () => RP_CFG, ms: () => RP_STATE.ms, paint: rpPaint, state: RP_STATE, defs: () => RP_DEF, wilson: rpWilson, meanCI: rpMeanCI, renderN: () => RENDER_N, xs: () => RP_STATE.xs, moved: () => RP_STATE.moved, missing: () => RP_STATE.missing, print: rpPrint, setOpt: (type, key, v) => { const T = rpTcfg(); (T.blk[type] = T.blk[type] || {})[key] = v; rpCfgSave(); rpPaint(); }, movePage: rpMovePage, draft: rpDraftObj, importDraft: rpImportDraftObj, gallery: rpGallery, closeGallery: rpGalleryClose, series: rpSeries, regions: rpRegions, F: () => F, fitAll: rpRefit }; /*DEBUG*/
  // ---------------------------------------------------------------- export .pptx (PowerPoint) : ZIP OOXML pur-JS, sur le modèle de xlsxBlob
  // Une slide 16:9 par page imprimée du rapport (page rendue en PNG haute résolution), plus une slide de titre en texte natif.
  // Aucune bibliothèque, aucun réseau, aucun innerHTML. Le PNG se fait côté navigateur (SVG foreignObject → data: → canvas → PNG),
  // compatible CSP (img-src data:, styles embarqués dans la chaîne SVG — jamais d'attribut style posé sur le DOM vivant).
  const RP_SVGNS = 'http://www.w3.org/2000/svg', RP_XHTMLNS = 'http://www.w3.org/1999/xhtml';
  const RP_PPTX_LABEL = 'Exporter en PowerPoint (.pptx)';

  // ZIP « stored » (méthode 0) : mêmes en-têtes que xlsxBlob, mais une entrée peut être binaire (Uint8Array) ou texte (chaîne).
  function rpZipBlob(files, mime) {
    const enc = new TextEncoder();
    const crcT = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; crcT[n] = c >>> 0; }
    const crc = b => { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = crcT[(c ^ b[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
    const parts = [], central = []; let off = 0;
    const u16 = v => [v & 0xFF, (v >> 8) & 0xFF], u32 = v => [v & 0xFF, (v >>> 8) & 0xFF, (v >>> 16) & 0xFF, (v >>> 24) & 0xFF];
    files.forEach(([name, data]) => {
      const nb = enc.encode(name), db = data instanceof Uint8Array ? data : enc.encode(String(data)), c = crc(db);
      const lh = new Uint8Array([0x50, 0x4b, 0x03, 0x04, ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(c), ...u32(db.length), ...u32(db.length), ...u16(nb.length), ...u16(0)]);
      parts.push(lh, nb, db);
      central.push(new Uint8Array([0x50, 0x4b, 0x01, 0x02, ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(c), ...u32(db.length), ...u32(db.length), ...u16(nb.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(off)]), nb);
      off += lh.length + nb.length + db.length;
    });
    const csz = central.reduce((s, b) => s + b.length, 0);
    const end = new Uint8Array([0x50, 0x4b, 0x05, 0x06, ...u16(0), ...u16(0), ...u16(files.length), ...u16(files.length), ...u32(csz), ...u32(off), ...u16(0)]);
    return new Blob(parts.concat(central, [end]), { type: mime || 'application/zip' });
  }

  // Constructeur du .pptx. slides = tableau ordonné d'objets :
  //   { kind:'title', title, reader, meta, diff }                  → slide de titre (texte natif PPTX)
  //   { kind:'image', png:Uint8Array, w, h, name }                 → page rendue en image (PNG), placée à l'échelle, centrée
  // opts.scale16x9 ignoré ; taille fixe 16:9 (12192000 × 6858000 EMU).
  function rpPptxBlob(slides, opts) {
    opts = opts || {};
    const SW = 12192000, SH = 6858000;                 // 16:9 en EMU (1 pouce = 914400 EMU)
    const RELNS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
    const ANS = 'http://schemas.openxmlformats.org/drawingml/2006/main';
    const PNS = 'http://schemas.openxmlformats.org/presentationml/2006/main';
    const CTNS = 'http://schemas.openxmlformats.org/package/2006/content-types';
    const PRNS = 'http://schemas.openxmlformats.org/package/2006/relationships';
    const DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
    const xe = s => String(s === null || s === undefined ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const files = [];

    // placement d'une image en respectant son rapport, centrée, avec une petite marge
    function place(iw, ih) {
      const mX = Math.round(SW * 0.02), mY = Math.round(SH * 0.03);
      const availW = SW - 2 * mX, availH = SH - 2 * mY, ar = (iw > 0 && ih > 0) ? iw / ih : 1;
      let h = availH, w = Math.round(h * ar);
      if (w > availW) { w = availW; h = Math.round(w / ar); }
      return { ox: Math.round((SW - w) / 2), oy: Math.round((SH - h) / 2), w, h };
    }
    function txtSp(id, name, x, y, cx, cy, runs, anchor) {
      const body = '<a:p>' + runs.map(r => '<a:r><a:rPr lang="fr-FR" dirty="0" sz="' + r.sz + '"' + (r.b ? ' b="1"' : '') + '><a:solidFill><a:srgbClr val="' + (r.color || '000000') + '"/></a:solidFill></a:rPr><a:t>' + xe(r.t) + '</a:t></a:r>').join('') + '</a:p>';
      return '<p:sp><p:nvSpPr><p:cNvPr id="' + id + '" name="' + xe(name) + '"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr/></p:nvSpPr>' +
        '<p:spPr><a:xfrm><a:off x="' + x + '" y="' + y + '"/><a:ext cx="' + cx + '" cy="' + cy + '"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr>' +
        '<p:txBody><a:bodyPr wrap="square" anchor="' + (anchor || 't') + '"/><a:lstStyle/>' + body + '</p:txBody></p:sp>';
    }
    function titleTree(s) {
      const pad = 838200;                               // 0,92 pouce
      const badgeFill = s.diff ? '1F8A4C' : 'B4541B', badgeTxt = s.diff ? 'DIFFUSABLE' : 'USAGE INTERNE';
      let inner = '<p:sp><p:nvSpPr><p:cNvPr id="2" name="Pastille"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>' +
        '<p:spPr><a:xfrm><a:off x="' + pad + '" y="1200150"/><a:ext cx="2743200" cy="609600"/></a:xfrm>' +
        '<a:prstGeom prst="roundRect"><a:avLst><a:gd name="adj" fmla="val 28000"/></a:avLst></a:prstGeom>' +
        '<a:solidFill><a:srgbClr val="' + badgeFill + '"/></a:solidFill></p:spPr>' +
        '<p:txBody><a:bodyPr wrap="square" anchor="ctr"/><a:lstStyle/><a:p><a:pPr algn="ctr"/>' +
        '<a:r><a:rPr lang="fr-FR" sz="1400" b="1" dirty="0"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:rPr><a:t>' + xe(badgeTxt) + '</a:t></a:r></a:p></p:txBody></p:sp>';
      inner += txtSp(3, 'Titre', pad, 2057400, SW - 2 * pad, 1828800, [{ t: s.title, sz: 4000, b: 1, color: '1B2430' }], 't');
      if (s.reader) inner += txtSp(4, 'Sous-titre', pad, 4038600, SW - 2 * pad, 700000, [{ t: s.reader, sz: 2000, color: '0A6EBD' }], 't');
      if (s.meta) inner += txtSp(5, 'Contexte', pad, 4724400, SW - 2 * pad, 1000000, [{ t: s.meta, sz: 1300, color: '5D6B7A' }], 't');
      inner += txtSp(6, 'Pied', pad, SH - 762000, SW - 2 * pad, 457200, [{ t: s.issuer || 'PAM Madagascar · Suivi & évaluation', sz: 1100, color: '8B93A1' }], 't');
      return inner;
    }
    function picTree(name, img, hasImg) {
      const p = place(img.w || 794, img.h || 1123);
      return '<p:pic><p:nvPicPr><p:cNvPr id="2" name="' + xe(name || 'Page') + '"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr>' +
        '<p:blipFill><a:blip r:embed="rId2"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>' +
        '<p:spPr><a:xfrm><a:off x="' + p.ox + '" y="' + p.oy + '"/><a:ext cx="' + p.w + '" cy="' + p.h + '"/></a:xfrm>' +
        '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>';
    }
    function slideXml(inner) {
      return DECL + '<p:sld xmlns:a="' + ANS + '" xmlns:r="' + RELNS + '" xmlns:p="' + PNS + '"><p:cSld><p:spTree>' +
        '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>' +
        '<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>' +
        inner + '</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>';
    }

    // slides + leur .rels + media
    let img = 0;
    slides.forEach((s, i) => {
      const k = i + 1; let inner, rels;
      if (s.kind === 'image' && s.png instanceof Uint8Array) {
        img++;
        files.push(['ppt/media/image' + img + '.png', s.png]);
        inner = picTree(s.name, s, true);
        rels = DECL + '<Relationships xmlns="' + PRNS + '">' +
          '<Relationship Id="rId1" Type="' + RELNS + '/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>' +
          '<Relationship Id="rId2" Type="' + RELNS + '/image" Target="../media/image' + img + '.png"/></Relationships>';
      } else {
        inner = titleTree(s);
        rels = DECL + '<Relationships xmlns="' + PRNS + '">' +
          '<Relationship Id="rId1" Type="' + RELNS + '/slideLayout" Target="../slideLayouts/slideLayout1.xml"/></Relationships>';
      }
      files.push(['ppt/slides/slide' + k + '.xml', slideXml(inner)]);
      files.push(['ppt/slides/_rels/slide' + k + '.xml.rels', rels]);
    });

    // présentation + .rels (rId1 = master ; rId2.. = slides)
    const sldIds = slides.map((s, i) => '<p:sldId id="' + (256 + i) + '" r:id="rId' + (i + 2) + '"/>').join('');
    files.push(['ppt/presentation.xml', DECL +
      '<p:presentation xmlns:a="' + ANS + '" xmlns:r="' + RELNS + '" xmlns:p="' + PNS + '" saveSubsetFonts="1">' +
      '<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>' +
      '<p:sldIdLst>' + sldIds + '</p:sldIdLst>' +
      '<p:sldSz cx="' + SW + '" cy="' + SH + '" type="screen16x9"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>']);
    const presRels = ['<Relationship Id="rId1" Type="' + RELNS + '/slideMaster" Target="slideMasters/slideMaster1.xml"/>']
      .concat(slides.map((s, i) => '<Relationship Id="rId' + (i + 2) + '" Type="' + RELNS + '/slide" Target="slides/slide' + (i + 1) + '.xml"/>'))
      .concat('<Relationship Id="rId' + (slides.length + 2) + '" Type="' + RELNS + '/theme" Target="theme/theme1.xml"/>');
    files.push(['ppt/_rels/presentation.xml.rels', DECL + '<Relationships xmlns="' + PRNS + '">' + presRels.join('') + '</Relationships>']);

    // slide master (+ rels) — spTree minimal, clrMap, layout, txStyles de base
    files.push(['ppt/slideMasters/slideMaster1.xml', DECL +
      '<p:sldMaster xmlns:a="' + ANS + '" xmlns:r="' + RELNS + '" xmlns:p="' + PNS + '"><p:cSld>' +
      '<p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg>' +
      '<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>' +
      '<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld>' +
      '<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>' +
      '<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst>' +
      '<p:txStyles>' +
      '<p:titleStyle><a:lvl1pPr algn="l"><a:defRPr sz="4400"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mj-lt"/></a:defRPr></a:lvl1pPr></p:titleStyle>' +
      '<p:bodyStyle><a:lvl1pPr><a:defRPr sz="1800"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/></a:defRPr></a:lvl1pPr></p:bodyStyle>' +
      '<p:otherStyle><a:defPPr><a:defRPr lang="fr-FR"/></a:defPPr><a:lvl1pPr><a:defRPr sz="1800"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill></a:defRPr></a:lvl1pPr></p:otherStyle>' +
      '</p:txStyles></p:sldMaster>']);
    files.push(['ppt/slideMasters/_rels/slideMaster1.xml.rels', DECL + '<Relationships xmlns="' + PRNS + '">' +
      '<Relationship Id="rId1" Type="' + RELNS + '/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>' +
      '<Relationship Id="rId2" Type="' + RELNS + '/theme" Target="../theme/theme1.xml"/></Relationships>']);

    // slide layout « vierge » (+ rels → master)
    files.push(['ppt/slideLayouts/slideLayout1.xml', DECL +
      '<p:sldLayout xmlns:a="' + ANS + '" xmlns:r="' + RELNS + '" xmlns:p="' + PNS + '" type="blank" preserve="1"><p:cSld name="Vierge">' +
      '<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>' +
      '<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld>' +
      '<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>']);
    files.push(['ppt/slideLayouts/_rels/slideLayout1.xml.rels', DECL + '<Relationships xmlns="' + PRNS + '">' +
      '<Relationship Id="rId1" Type="' + RELNS + '/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>']);

    // thème (Office) complet : clrScheme, fontScheme, fmtScheme (3 remplissages, 3 lignes, 3 effets, 3 fonds)
    files.push(['ppt/theme/theme1.xml', rpThemeXml(ANS)]);

    // [Content_Types].xml
    const overrides = slides.map((s, i) => '<Override PartName="/ppt/slides/slide' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>').join('');
    files.push(['[Content_Types].xml', DECL + '<Types xmlns="' + CTNS + '">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Default Extension="png" ContentType="image/png"/>' +
      '<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>' +
      '<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>' +
      '<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>' +
      '<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>' +
      overrides + '</Types>']);

    // _rels/.rels (paquet → présentation)
    files.push(['_rels/.rels', DECL + '<Relationships xmlns="' + PRNS + '">' +
      '<Relationship Id="rId1" Type="' + RELNS + '/officeDocument" Target="ppt/presentation.xml"/></Relationships>']);

    return rpZipBlob(files, 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
  }

  function rpThemeXml(ANS) {
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<a:theme xmlns:a="' + ANS + '" name="MEMS">' +
      '<a:themeElements><a:clrScheme name="MEMS">' +
      '<a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>' +
      '<a:dk2><a:srgbClr val="1B2430"/></a:dk2><a:lt2><a:srgbClr val="F3F5F8"/></a:lt2>' +
      '<a:accent1><a:srgbClr val="0A6EBD"/></a:accent1><a:accent2><a:srgbClr val="1F8A4C"/></a:accent2>' +
      '<a:accent3><a:srgbClr val="D08A00"/></a:accent3><a:accent4><a:srgbClr val="C23B2A"/></a:accent4>' +
      '<a:accent5><a:srgbClr val="5F7F9F"/></a:accent5><a:accent6><a:srgbClr val="8FA8C2"/></a:accent6>' +
      '<a:hlink><a:srgbClr val="0A6EBD"/></a:hlink><a:folHlink><a:srgbClr val="954F72"/></a:folHlink></a:clrScheme>' +
      '<a:fontScheme name="MEMS"><a:majorFont><a:latin typeface="Calibri Light"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont>' +
      '<a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme>' +
      '<a:fmtScheme name="Office"><a:fillStyleLst>' +
      '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>' +
      '<a:gradFill rotWithShape="1"><a:gsLst><a:gs pos="0"><a:schemeClr val="phClr"><a:lumMod val="110000"/><a:satMod val="105000"/><a:tint val="67000"/></a:schemeClr></a:gs><a:gs pos="50000"><a:schemeClr val="phClr"><a:lumMod val="105000"/><a:satMod val="103000"/><a:tint val="73000"/></a:schemeClr></a:gs><a:gs pos="100000"><a:schemeClr val="phClr"><a:lumMod val="105000"/><a:satMod val="109000"/><a:tint val="81000"/></a:schemeClr></a:gs></a:gsLst><a:lin ang="5400000" scaled="0"/></a:gradFill>' +
      '<a:gradFill rotWithShape="1"><a:gsLst><a:gs pos="0"><a:schemeClr val="phClr"><a:satMod val="103000"/><a:lumMod val="102000"/><a:tint val="94000"/></a:schemeClr></a:gs><a:gs pos="50000"><a:schemeClr val="phClr"><a:satMod val="110000"/><a:lumMod val="100000"/><a:shade val="100000"/></a:schemeClr></a:gs><a:gs pos="100000"><a:schemeClr val="phClr"><a:lumMod val="99000"/><a:satMod val="120000"/><a:shade val="78000"/></a:schemeClr></a:gs></a:gsLst><a:lin ang="5400000" scaled="0"/></a:gradFill>' +
      '</a:fillStyleLst><a:lnStyleLst>' +
      '<a:ln w="6350" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/><a:miter lim="800000"/></a:ln>' +
      '<a:ln w="12700" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/><a:miter lim="800000"/></a:ln>' +
      '<a:ln w="19050" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/><a:miter lim="800000"/></a:ln>' +
      '</a:lnStyleLst><a:effectStyleLst>' +
      '<a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle>' +
      '<a:effectStyle><a:effectLst><a:outerShdw blurRad="57150" dist="19050" dir="5400000" rotWithShape="0"><a:srgbClr val="000000"><a:alpha val="63000"/></a:srgbClr></a:outerShdw></a:effectLst></a:effectStyle>' +
      '</a:effectStyleLst><a:bgFillStyleLst>' +
      '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>' +
      '<a:solidFill><a:schemeClr val="phClr"><a:tint val="95000"/><a:satMod val="170000"/></a:schemeClr></a:solidFill>' +
      '<a:gradFill rotWithShape="1"><a:gsLst><a:gs pos="0"><a:schemeClr val="phClr"><a:tint val="93000"/><a:satMod val="150000"/><a:shade val="98000"/><a:lumMod val="102000"/></a:schemeClr></a:gs><a:gs pos="50000"><a:schemeClr val="phClr"><a:tint val="98000"/><a:satMod val="130000"/><a:shade val="90000"/><a:lumMod val="103000"/></a:schemeClr></a:gs><a:gs pos="100000"><a:schemeClr val="phClr"><a:shade val="63000"/><a:satMod val="120000"/></a:schemeClr></a:gs></a:gsLst><a:lin ang="5400000" scaled="0"/></a:gradFill>' +
      '</a:bgFillStyleLst></a:fmtScheme></a:themeElements><a:objectDefaults/><a:extraClrSchemeLst/></a:theme>';
  }

  // UTF-8 → base64 (par tranches, sans dépassement de pile)
  function rpUtf8B64(s) { const by = new TextEncoder().encode(s); let bin = ''; const CH = 0x8000; for (let i = 0; i < by.length; i += CH) bin += String.fromCharCode.apply(null, by.subarray(i, i + CH)); return btoa(bin); }

  // feuille de styles embarquée dans la chaîne SVG : CSS de l'app + bascule « impression » (jamais d'attribut style sur le DOM vivant → pas de violation CSP style-src)
  function rpExportCss() {
    const app = Array.prototype.map.call(document.querySelectorAll('style'), s => s.textContent).join('\n');
    const prt = '.rp-scr,.rp-ctl,.rp-page .info,.rp-exclab{display:none!important}.rp-page .ed:empty{display:none!important}' +
      '.rp-page .ed,.rp-page .ed.ov-stale{border:0!important;background:none!important}.rp-notes:not(:empty){display:block}' +
      '.rp-sup{display:inline}.rp-prt{display:block}.rp-block{outline:none!important}' +
      '.rp-page{box-shadow:none!important;margin:0!important;opacity:1!important}.rp-box::before{content:"□ "}';
    return (app + '\n' + prt).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  }

  // Rend une page (.rp-page) en PNG : clone → SVG foreignObject (CSS embarqué) → data: → canvas (×scale) → PNG (Uint8Array)
  function rpPageToPng(pageEl, scale, css, cb) {
    let W, H, svg;
    try {
      W = pageEl.offsetWidth || 794; H = pageEl.offsetHeight || 1123;
      const doc = RP_STATE.doc, mm = doc && String(doc.className).match(/rp-m-\w+/);
      const clone = pageEl.cloneNode(true);
      clone.classList.remove('rp-sel');
      Array.prototype.forEach.call(clone.querySelectorAll('.rp-ctl,.rp-exclab'), n => n.remove());
      const xhtml = new XMLSerializer().serializeToString(clone);
      svg = '<svg xmlns="' + RP_SVGNS + '" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '">' +
        '<foreignObject x="0" y="0" width="' + W + '" height="' + H + '">' +
        '<div xmlns="' + RP_XHTMLNS + '" class="rp-doc ' + (mm ? mm[0] : 'rp-m-' + rpMode()) + '"><style>' + css + '</style>' + xhtml +
        '</div></foreignObject></svg>';
    } catch (e) { cb(e); return; }
    const s = Math.max(1, scale || 2.5);
    const img = new Image();
    img.onload = function () {
      try {
        const cv = document.createElement('canvas'); cv.width = Math.round(W * s); cv.height = Math.round(H * s);
        const ctx = cv.getContext('2d'); ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, cv.width, cv.height);
        ctx.drawImage(img, 0, 0, cv.width, cv.height);
        const give = bytes => cb(null, { bytes, w: W, h: H });
        if (cv.toBlob) cv.toBlob(function (b) {
          if (!b) { cb(new Error('toBlob')); return; }
          const fr = new FileReader(); fr.onload = () => give(new Uint8Array(fr.result)); fr.onerror = () => cb(new Error('read')); fr.readAsArrayBuffer(b);
        }, 'image/png');
        else { const du = cv.toDataURL('image/png'); give(rpDataUriBytes(du)); }
      } catch (e) { cb(e); }
    };
    img.onerror = function () { cb(new Error('image SVG')); };
    img.src = 'data:image/svg+xml;base64,' + rpUtf8B64(svg);
  }
  function rpDataUriBytes(du) { const b = atob(du.slice(du.indexOf(',') + 1)), a = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) a[i] = b.charCodeAt(i); return a; }

  // Slide de titre (texte natif) à partir du modèle courant
  function rpTitleSlide(M, tpl) {
    const titleEl = RP_STATE.doc && RP_STATE.doc.querySelector('.rp-title');
    const title = (titleEl && titleEl.textContent.trim()) || rpTitleDefault(M, tpl);
    const reader = (RP_TPL[tpl] || {}).reader || '';
    const part = rpPartnerTpl(tpl);
    const period = part ? ('Période ' + rpWin(rpMonthsOf(F.m0, F.m1)) + ', celle des filtres')
      : ('Comparé à ' + piWin(M.T.P));
    const dataEnd = M.T && M.T.dataEnd ? dFrUI(M.T.dataEnd) : localDay();
    const meta = period + ' · Données au ' + dataEnd + ' · ' + (filtersAny() ? rpCap(filtersActiveText()) : 'Aucun filtre');
    const issuer = 'PAM Madagascar · Suivi & évaluation · émis le ' + dFrUI(localDay());
    return { kind: 'title', title, reader, meta, issuer, diff: rpDiff() };
  }

  // Export : une slide de titre + une slide par page imprimée (non exclue), rendue en PNG, puis téléchargement du .pptx
  function rpExportPptx() {
    const doc = RP_STATE.doc; if (!doc) return;
    const pages = Array.prototype.filter.call(doc.querySelectorAll('.rp-page'), p => !p.classList.contains('rp-excl'));
    if (!pages.length) { if (window.alert) window.alert('Aucune page à exporter.'); return; }
    const tpl = rpTpl(), M = RP_CACHE.M;
    const css = rpExportCss(), scale = 2.5;
    const btn = RP_STATE.ui && RP_STATE.ui.bar ? RP_STATE.ui.bar.querySelector('.rp-pptx') : null;
    const orig = btn ? btn.textContent : null;
    if (btn) { btn.disabled = true; btn.textContent = 'PowerPoint…'; }
    const imgs = [];
    const done = () => { if (btn) { btn.disabled = false; btn.textContent = orig; } };
    const step = i => {
      if (i >= pages.length) {
        try {
          const slides = [rpTitleSlide(M, tpl)].concat(imgs.map((im, k) => ({ kind: 'image', png: im.bytes, w: im.w, h: im.h, name: 'Page ' + (k + 1) })));
          downloadBlob(rpPptxBlob(slides, {}), 'rapport_' + tpl + '_' + (rpDiff() ? 'diffusable' : 'interne') + '_' + localDay() + '.pptx');
        } catch (e) { if (window.console) console.warn('pptx', e); if (window.alert) window.alert('Export PowerPoint impossible.'); }
        done(); return;
      }
      rpPageToPng(pages[i], scale, css, (err, out) => {
        if (!err && out) imgs.push(out); else if (window.console) console.warn('page', i, err && err.message);
        step(i + 1);
      });
    };
    step(0);
  }
  if (/debug/.test(location.hash) && window.__dashReport) { window.__dashReport.pptxBlob = rpPptxBlob; window.__dashReport.zipBlob = rpZipBlob; window.__dashReport.pageToPng = rpPageToPng; window.__dashReport.exportPptx = rpExportPptx; } /*DEBUG*/
