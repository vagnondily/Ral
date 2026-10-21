# Consignes des agents en cours (texte exact)

> Ce fichier reprend **mot pour mot** la tâche confiée à chaque agent de la session principale.
> Une autre session peut ainsi reprendre un chantier interrompu sans rien réinventer.
> Les consignes sont en anglais, comme elles ont été données aux agents.
> L'état de chaque chantier (fait / en cours / reste) est dans [`../REPRISE.md`](../REPRISE.md).
> Règles communes à tous les agents : `CLAUDE.md` ; travail sur une branche `wip/<clé>`, à partir de `wip/1b-rest` (lot 1b complet) sauf mention ; commits en français ; aucun arrêt de l'API :9000 ni de l'interface :5173 ; une base jetable par agent ; avant de finir, `npm test`, `npm run lint`, `npm run build` (web) et le balayage FR + EN (`node web/scripts/sweep-ecrans.cjs`) au vert.
> Chaque construction est suivie d'une **vérification adverse indépendante** : refaire le problème d'origine, montrer qu'il a disparu, chercher les régressions, l'isolation par compte, les transactions, les centimes entiers et la protection des données, et mesurer les performances annoncées.

## 1. Tour de corrections 1b / 6a + retours 54 et 56 (workflow `fix-1b-6a-plus-54-56`)

Base commune : `wip/1b-rest`. Chaque agent travaille sur sa branche `wip/<clé>`.

### Agent `build:fix-6a` → branche `wip/fix-6a`

```text
(1) MERGE branch wip/6a (the map, built on the 1b core) into your branch (which starts at wip/1b-rest = lot 1b complete): git merge --no-ff wip/6a. Resolve conflicts with this rule: the 1b period model WINS everywhere (usePeriod / PeriodSelect / from-to, Couverture (sites) vs Exécution du plan (visites), « — aucun plan »), and the 6a map uses THE PAGE'S PERIOD (Couverture & performance › Carte and the Vue d'ensemble « Carte du suivi » section read the same period as the rest of the page; « Ouvrir la carte » hands over the period to the page's usePeriod; the old « Couverture terrain — mois courant » card is replaced by the map section as 6a decided; the Couverture tile and the map read the same service so the page never shows two coverage values). (2) Then fix ALL findings in docs/reprise/CONSTATS_6A.md (high first: viewers must never get exact household GPS — also via calc-fields preview and indicator preview/explain; snap derived/commune positions to the 2 km grid for non-precise roles; GPS trigger must not run on conflicting re-imports; /points per-commune counts over the full perimeter with visible truncation; perf at 10k sites; cache invalidation after shape-link changes; neverVisited form↔site compatibility; office filter tree; 390 px scroll; loading vs zero states).
```

### Agent `build:fix-1b` → branche `wip/fix-1b`

```text
Fix ALL findings in docs/reprise/CONSTATS_1B.md on lot 1b (socle + screens), EXCEPT anything in web/src/pages/dashboard/DashboardBIPage.jsx and DashboardCoveragePage.jsx (another worker integrates the map there; the BI « Couverture terrain » card is being replaced by the map section) and EXCEPT the report-designer coverage item (lot 7a owns it — mention it in left_undone). Key items: HIGH — field coverage by district must group on the site's own district text (lower(COALESCE(adm2, district))), using the official admin_areas name only when the pcode agrees with the site (same region lineage), never moving visits into another region; RBM: /rbm/sites and « Générer » must use ONE rule for a past month (pass asOf: target in generateFromRbmTx and test toPlan === created); client period caps = server caps (usePeriod/PeriodSelect/lib/period get the screen's maxSpan from one shared module or from /monitoring/periods; an over-long URL/session period falls back to the screen default with a notice); performance: cap visitSpanTx at the facts max span or require a period, keep /field/visits under 1 MB (slim columns or paginate), lower ANALYSIS_MAX_SPAN to what the bench supports and say so in the UI; PDD KPIs from the SQL aggregate (never from the bounded rows) + paging; Planning list filter = PeriodSelect range (convert saved views); rename visit-rate « couverture » to « Exécution du plan (visites) » on CoverageRecapPage and CalcDocs (+ add the Couverture (sites) definition to CalcDocs); alerts wording (« ce mois » only without period); USD conversion per report month in integer cents; PeriodSelect unit label prop; group tables reconcile with totals (« autres (sans visite) » row); compact wide tables; PeriodSelect on phones (no clipping at 360/390 px); extend the perf bench to consolidation/reports/planning/PDD/alerts.
```

### Agent `build:quarterly` → branche `wip/quarterly`

```text
Build retour 54: a quarterly coverage report table in the decision dashboards, populated from MEMS data, faithful to the user's workbook ((capture du classeur trimestriel fournie par l'utilisateur, décrite au retour 54 de RETOURS_UTILISATEUR.md) — look at it): rows = activities (grouped under a country row, optional grouping by bureau), columns per quarter Q1–Q4 of a chosen year: Total Unique Active Sites, Total Planned Sites, Total Actual Sites, Coverage (Actual/Active), Execution Rate (Actual/Planned), plus a Total row and a year column; conditional colour scale red→green WITH the value shown (statuses never colour only); « — » instead of #DIV/0!; export Excel (.xlsx with the same layout, via exceljs) and CSV. Sites are counted DISTINCT per quarter, using ONLY the lot 1b site × month facts service (server/src/modules/common/siteActivitySql.js siteMonthFactsCtes — read it; do not re-implement active/planned/realised rules); « réalisé » = what that service counts today (realised visits; lot 4 will add site-attached data — say so in a small note under the table). Execution here = sites réalisés ÷ sites prévus (the workbook's MMR rule; name it « Taux d'exécution (réalisés ÷ prévus) » and explain it in a tooltip). Put it as a new entry « Rapport trimestriel » under Dashboard décisionnel (nav + route), NOT inside DashboardCoveragePage/DashboardBIPage (another worker edits those). Pure shaping module + tests; one SQL aggregation per request; FR+EN.
```

### Agent `build:deletion` → branche `wip/deletion`

```text
Retour 56 (user: « donne la possibilité de supprimer les documents non validés avec le reste etc, sinon ce sera complexe d'avoir des drafts partout ; et si document validé, on ne peut le supprimer que s'il n'y a pas de donnée reliée, avec justificatif »). Another Claude session ALREADY STARTED it on branch origin/claude/zealous-bardeen-p9ozcr: 3 commits 97f0835 (pure policy server/src/modules/common/deletionPolicy.js + 12 tests + migration 061_document_deletions.sql, append-only log with RLS/same-tenant), a76f20d (policy applied to TPM reports/factures, collection plans, contracts; GET /api/deletions admin), 3838254 (web DeleteDialog, Reports/Planning/Contract detail wiring, Paramétrage › Journal des suppressions). If your branch does not contain them yet: git cherry-pick 97f0835 a76f20d 3838254 (resolve conflicts; the lot 1b period model wins on shared screens). Then fix the main session's review of that work and complete the retour: (1) HIGH — migration number collides with lot 6a (061_map_geo.sql; 061–068 are reserved for 6a/7a/lot 5): git mv to 069_document_deletions.sql and update every comment that cites 061. (2) HIGH — no English: every new tr() phrase (DeleteDialog, the three dialogs, Journal des suppressions screen and its labels) must exist in web/src/locales/en/*.js; the FR+EN sweep must show 0 missing EN phrase. (3) Avenants are in DOCUMENT_TYPES but not implemented: a non-validated avenant (check the real statuses of contract_amendments) must be deletable after confirmation — DELETE /api/contracts/:id/amendments/:amendmentId, contract row locked FOR UPDATE, log row 'contract_amendment', and an entry in the contract's immutable history saying a pending avenant was withdrawn; button in the Avenants tab; an approved avenant is never deletable (it rewrote the contract) — say why in the UI. (4) « Donnée reliée » must be precise and SHOWN: a 409 lists what is linked with counts (e.g. « 3 rapports, 1 plan, 12 visites ») via a structured error detail that DeleteDialog renders. Define it per type in ONE place (repository count queries + a pure shaping function in deletionPolicy), with a comment and a test for each rule: contract → its reports, collection plans, avenants, site visits, assignments, and renewals (contracts.renewed_from_id = this id — today that is an FK failure with a generic 400); the contract's own children (budget postes, zones, history) are NOT linked data. Collection plan → its own postes are NOT linked data; linked = a facture (tpm_reports kind financier, any status) for the same partner × contract × month, or field visits of that month assigned to that partner/contract. Validated facture/report → keep the conservative rule (reportedAmount ≠ 0 or postes = counted in the contract consumption → linked) but say it in the message. (5) Validated documents must be reachable: the UI must OFFER « Supprimer » on validated contracts/reports/plans too (with the justification field) — server action flags expose delete + needsJustification; deleting a VALIDATED document requires the validator role or admin (separation of duties), enforced server-side (403) and hidden otherwise. (6) Justification ≥ 10 characters after trim (policy, zod at the route, DB CHECK in 069, dialog counter). (7) Tests beyond the pure policy: repository/route tests with fake clients per type — non-validated deleted + log row in the same transaction; validated without links + justification; validated with links → 409 with counts; missing/short justification → 400; tenant id only from req.auth; FOR UPDATE lock. (8) Journal screen: paging + type filter, FR+EN. (9) Report designer documents stay out (lot 7a rebuilds them) — put it in left_undone. Referentials (sites, agents, partners, offices) keep the « désactiver » rule. In your summary, give a short verdict on the quality of the other session's work (what was right, what you had to change).
```


## 2. Concepteur de rapport riche, partie 2 (workflow `build-1b-6a-7a`, agent `build:7a-2`) → branche `wip/7a`

```text
TASK (part 2 of 2): lot 7a from docs/SPEC_LOT_7A.md commits C8 to C13 (migrations 062–064), continuing after part 1 (wip/7a already points to its HEAD). The user: « rajoute configuration de l'en-tête où on peut le formater à volonté, déplacer chaque chose où l'on veut, insérer des logos, image, texte, etc. comme dans mes templates », « mettre la possibilité de l'orientation de page spécifique », plus a validation workflow for reports.
```
La partie 1 (C1 à C7) est faite : voir `REPRISE.md`. Elle sera vérifiée avec la partie 2.

## 3. Conception du lot 5 élargi (workflow `design-lot5`, lecture seule)

Retours couverts : 24, 25, 48 (prolongé) et 55 — texte des retours dans `RETOURS_UTILISATEUR.md`.

```text
TASK: write the implementable spec for LOT 5 ÉLARGI (migration numbers from 065 on): (1) activity calendar per activity category and year (months × assistance days, popup from the MMR table; derived real duration feeds the MMR instead of a typed duration; keep manual override with reason); (2) configurable plan parameters with initial values seeded from the MMR and the RBM workbook (show exactly which workbook cell/column each default comes from); (3) a pure, unit-tested, deterministic plan generator: inputs = sites (activity, commune/district, risk by period, last real visit, urgent recommendation flags, active per month, forbidden), MMR per activity (capacity per day × persons × working days, adjusted interval, target ≥ 80 % of sites over the activity period), outputs = monthly plan of visits grouped into tournées (same commune first, then same district, multi-activity on the same day when capacity allows), never exceeding capacity, explaining why each site was chosen or postponed, with a coverage projection; preview before saving, saving through the existing site_visits rules (no duplicates, cancellations respected), runnable in the BullMQ worker if heavy (measure on 3 000 sites × 12 months); (4) configurable priority rules (retour 24): a safe rule table (si / sinon / cas) over available site fields with preview, versions and explanation reused by « Pourquoi ? » — no eval, reuse the calcFields safe engine if suitable; (5) risk level by period with an immutable history log (who, when, before→after, reason) and risk-as-of-month used everywhere. Include UI (popup calendar, parameters screen, generator preview with map-free list grouped by tournée, rule editor), API contracts, data model, tests, performance budget, ordered commits each shippable alone.
```
Puis un critique de complétude confronte la spécification au code réel, au classeur RBM et aux mots de l'utilisateur. Résultat attendu : `docs/SPEC_LOT_5.md`, à écrire par la session principale.

## 4. Conception du retour 58 (workflow `design-retour58-tpm-contrat`, lecture seule)

Demande : le TPM du plan de suivi vient des contrats. Précision de l'utilisateur : un **onglet dédié « Affectation des TPM »** par région › district, toujours pré-rempli d'après les contrats, avec une **raison obligatoire** pour toute modification.

Étapes :
1. Trois lectures en parallèle :
   - où un prestataire est attribué aujourd'hui ;
   - ce que les zones des contrats permettent de déduire, avec les cas 0 ou ≥ 2 contrats par zone ;
   - le contexte et les conflits avec les chantiers en cours.
2. Deux conceptions indépendantes :
   - fiabilité d'abord : table par zone dérivée des contrats à la lecture, seules les modifications sont stockées ;
   - usage d'abord : l'onglet par région › district.
3. Une synthèse, puis une critique adverse.

Résultat attendu : `docs/SPEC_RETOUR_58.md`. Migration proposée : `070`.

## 5. Réconciliation du socle GPS du retour 57 (workflow `reconcile-retour57-core`) → branche `wip/r57-core`

```text
Bring in the code of commit 76544a1 (other session: common/pointInPolygon.js, shpGeometry.js, gpsLocate.js + tests) on top of origin/main without its docs change, crediting it. RECONCILE with the existing server/src/modules/settings/shpReader.js: ONE .shp parser (shpReader derives its points from shpGeometry's rings, identical output, unchanged API). HARDEN the parser for untrusted uploads (bounded loops, counts checked against the buffer before allocating, truncated file → clear error, cap on total points, a test per malformed case). CHECK on the real district contours of lot 6a (mdg-adm2.v1.json on wip/fix-6a): locate every dev-DB site with GPS and report agreement with the site's own district and time per 1 000 points (measurement only). npm test, lint, web build green.
```
Ensuite :
- deux vérificateurs : robustesse sur fichiers piégés, et parité / non-régression de l'import du découpage ;
- un tour de correction si besoin, puis une revérification.

## 6. Vendredi 16/10 — reprise après l'analyse des mises à jour (session principale)

Base commune : `main` à jour (fusionner `origin/main` avant chaque envoi). Contrôles avant chaque envoi : `npm test`, `npm run lint`, `npx vite build`, migrations sur base neuve et copie, balayage FR + EN sur ses propres ports ; jamais d'arrêt de :9000 / :5173 ni de processus non lancés par soi ; jamais `pkill`. Pied de commit habituel, aucun identifiant de modèle.

### Agent ex-`lot5-gen` → branche `wip/planauto-port`

```text
New direction for lot 5 (16/10): do NOT merge or keep developing wip/lot5-gen as a second planner — port its strengths onto main's planner instead (planAuto.js, planAuto.repository.js, planAuto.routes.js, PlanAutoDrawer.jsx; the user has used it, it is the base). Branch wip/planauto-port from integ/16a (79a6d35, clear fix). 077/078 abandoned; no new migration in P1/P2 (106 reserved for traceability).
P1 — reliability: (a) single « site actif au mois M » rule everywhere main still counts blank as active (monthBlocksTx, generateFromRbmTx guard, planBoardTx yearHasGrid, planMonthsTx, bulkUpdateSites, planAuto.js:233, applyPlan guard with activeMonthSql + security_situation < 99, PlanBoardPage cell + badge « Non renseigné (non planifiable) ») ; (b) engine: gap anchors = every existing visit both directions + prior-year lastVisitMonth; RBM-fallback idempotent; capacity counters seeded with existing visits; cancelled month unavailable; duration-0 line uses each site's risk; coverage counts already-met sites with a reason per uncovered site; never a past month; (c) apply in ONE transaction (lock_timeout 20 s → shared month locks ascending → board + MMR on the same client → generate → insert → restampVisitsTx), month locks always BEFORE lockAttributionTx, inputs fingerprint → 409 plan_inputs_changed (« Les données ont changé : relancez l'aperçu ») ; (d) planAuto.service.js ; (e) drawer period from the board year, strict month regex, /preview returns totals + sample, « N créées sur M prévues » ; (f) MmrSection « Compléter depuis le référentiel » never invents duration / risk (« à vérifier ») ; (g) real-DB test planAutoDb.test.js (MEMS_TEST_DATABASE_URL / MEMS_TEST_APP_DATABASE_URL) + invariants oracle.
P2 — retours 107/108: needs-driven by default; clusters across ALL activities at district + commune level (GPS second), whole clusters, ordered by RBM priority; targetedPerMonth as a floor; pure planResources.js (agent-days per commune, agents peak + average, vehicles per day and district = ⌈agents ÷ agents per vehicle⌉, defaults 4 and 20 field days) per TPM unit (« Bureau (suivi interne) » without TPM), compared with MMR declared persons; visit_date + « Agent N » on apply; MMR / RBM values read-only with their source; choices = période, périmètre, stratégie + folded M&E options (communes inaccessibles, renfort); vehicles column in the CSV « base de budget ».
```

### Agent `lot8` → branche `wip/lot8`

```text
0. BLOCKER: merge e114610 left `=======` at styles.css:3144 and an unclosed comment at :3290 — fix, merge origin/main, push. (Done: 4f66a46.)
1. Retour 113 — one glossary everywhere: « Titulaire » / partenaire de mise en œuvre (contract holder) vs « TPM » (tierce partie de suivi), constants in web/src/lib/roles.js (+ EN); contract identity « n° FLA · titulaire »; Consolidation / Reporting / BI → « Titulaire » (+ « TPM » where known); Planning / Rapports / Plan de suivi → « TPM »; filters « Tous les TPM »; one « Partenaires & TPM » area with the 360° sheet; a guard against bare tr('Prestataire'); no trailing « · » when the partner type is empty. New commits AFTER 4f66a46 (which ships alone). Merge origin/main before touching the files of the design lot; allowed to change tpmPickers.contractOptions (label = numeroFla || numero, sub = titulaire · période · TPM, numero in keywords) and the drawer labels, with tests and EN.
```

### Agent `7a-p2` → branche `wip/7a-p2`

```text
1. Finish the uncommitted header work (retour 112): header / footer PAIRS (première page ≠ pages suivantes, each optional), professional templates modelled on the user's reference reports, sober v6 tokens; merge origin/main first; the report block « Couverture par activité » / reports/catalog/coverage.js must read the SAME definitions as the dashboards (/api/dashboards/coverage). (Pairs done: 5bcdfb7.) 2. Then retour 102: reporting filters that actually work — a test per filter (période incl. non-consecutive months, bureau + antennes, activité, TPM / titulaire, district) on the report catalog queries. New commits after 5bcdfb7.
```

### Agent `dash-template` → branche `wip/dash-template`

```text
Retour 110 fix published (2bb2167 + 0edb8e3 sticky total + fbadbdf « Sites prévus → suivis »). Follow-ups on origin/main: (a) coveredInactive + cancelled count under the universe note; (b) « À venir » visits on unfilled future months counted or explained; (c) « Sites à jour » tile states its rule; (d) bell / Centre d'alertes and Rapport de synthèse read /api/dashboards/coverage (reports/catalog/coverage.js is 7a-p2's); (e) nits: cdat office filter, commune key with district, min(activity) collation, « n (x %) » on both pages, formatRate rounding, coverage API failure must not blank the map; (f) DashboardCoveragePage / ProcessDashboardPage nested « .page » → section-gap, gauge vs icon tiles, empty card bottoms, « 31,5/100 » with a FR decimal. Then the uncommitted mockup UI (retour 101) as a separate lot.
```

### Session principale → branche `wip/ui-pickers`

Listes de choix professionnelles (`EntityPicker`, logique pure `lib/entityPicker.js`, `lib/tpmPickers.js`) ; Planification & budget et facture : contrat d'abord, puis son TPM ; « Ajouter une visite » cherchable ; corrections de l'audit design (chevron des listes, barres, sombre, marges, chiffres, téléphone). Suites prévues : `DataList` (filtres), `MonthSelect`, risque par ligne du RBM, puis tableaux / statuts / tuiles (passes 2 et 3 du plan du 16/10).


## 7. Mercredi 21/10 — relecture croisée des quatre branches (session principale)

Base commune : `integ/full` `a1e998a` (sauvegardée `origin/snap/integ-full-1020`) = `main` + lot 8 + indicateurs +
planification + retour 114. La relecture croisée (labels, chiffres, parcours) a confirmé 26 points ; le texte complet de
chaque point (scénario, correction, verdict du vérificateur) est dans le bloc-notes de la session principale :
`review_xbranch_findings.txt`. Quatre agents, une branche chacun, sans fusion entre eux ; la session principale fusionne,
contrôle, fait vérifier, puis publie. Décisions prises par la session principale (application de « fais selon tes
recommandations ») :
- **D-a** — l'équipe interne d'un site est celle du bureau RACINE (`officeScope.rootOfficeOf`, règle de la planification).
- **D-b** — un partenaire qui n'est plus de type TPM n'est plus attendu (rapports « non applicable », motif
  `partner_not_tpm`, pas d'alerte de retard) ; un TPM INACTIF reste attendu pour les mois servis et peut encore remettre
  une facture de mois passés (le type suffit, comme le déclencheur 089) ; un plan exige toujours un TPM actif ; ses
  visites prévues « visite » reviennent à la zone quand il perd le rôle.
- **D-c** — un plan de collecte pour un TPM indisponible tous les mois du plan est refusé (400) ; une facture reste
  acceptée avec un avertissement dans le formulaire ; les deux listes de choix lisent la même source (mois
  d'indisponibilité).

### Agent retour 114 → branche `wip/xb-tpm` (ports 9884 / 5884, migration 108)

Points 4, 6/18/23, 14, 15, 16, 20, 21 (rapports attendus, alerte, facture d'un TPM inactif), 25. Texte envoyé (extrait
fidèle des consignes) : « #20 INVOICED_SQL : couverture de la période (`v.period_month BETWEEN r.period_month AND
COALESCE(r.period_end, r.period_month)`) partout où « facturé » est testé, migration 108 qui recrée `mems_tpm_stamp` ;
#6/18/23 D-a dans expectedReports (même aide que la planification) ; `siteActivitySql office:'bureau'` inchangé, signalé à
part ; #14 alertes et `partners.repository.sheet` à l'heure locale, test horloge figée 22:30Z ; #15 jumelle SQL de
l'échéance (`stubLateSql`) pour la liste, la fiche 360° et ses compteurs ; #4 compteurs « Attendu / En retard » de la fiche
360° depuis expectedReports ; #16 étapes « Facture » et « Validation » du fil guidé depuis la même règle que la carte ;
#21 partie a (D-b) ; #25 (D-c). Ne pas toucher `partnerRole.js`. Contrôles : npm test, lint, build, migrations neuve et
copie, base de test neuve + `npm run test:db`, balayage. »

### Agent lot 8 → branche `wip/xb-partners` (ports 9881 / 5881)

Points 1/24, 5, 8, 12, 21 (partie b), 26. Texte envoyé (extrait fidèle) : « #1/#24 liste des contrats : « Interne » au
lieu de « Aucun TPM », CSV renseigné, « — » pour un brouillon ou un contrat rejeté, hors filtre « Interne » ; #5
indisponibilité d'un TPM affichée (badge couleur + icône + libellé) sur la fiche 360°, la liste des partenaires et la ligne
TPM du détail de contrat, une seule source ; #8 fiche d'un titulaire : visites en suivi interne de ses zones comptées à
part (`mems_tpm_cells` / tpmAttribution, aucune nouvelle règle) ; #12 « Contrats actifs » selon les dates
(`activeProvider.coverageOf`), indicateur d'accord ; #21 partie b : quand un partenaire perd le rôle TPM, ses visites
PRÉVUES d'origine « visite » (non facturées, non figées) reviennent à leur zone, lot journalisé ; #26 une seule horloge
(`rbmMath.currentMonth` / `localDay`) dans `partnerRole.js` et `partners.routes.js`. Ne pas toucher reportSummary, les
compteurs de rapports de la fiche, le mois de `partners.repository.sheet`, `assertActiveTpmTx` / `selectableProviders`. »

### Agent planification → branche `wip/xb-plan` (ports 9883 / 5883)

Points 17/22. Texte envoyé (extrait fidèle) : « la planification compte une visite EXISTANTE sous le TPM qu'elle porte
(`site_visits.provider_id` / `monitored_by`, cf. `monitorKeySql`) : `loadInputsTx` charge providerId, providerName,
monitoredBy ; `pushVisit` (isNew=false) : prestataire → `id:<prestataire>`, interne → `bureau:<bureau racine>` ; `tpmAt`
seulement pour les nouvelles visites et « non_affecte » ; champs dans `planFingerprint` ; vérifier l'oracle et les
ressources ; test avec une visite « visite » et une visite au TPM retiré ; ne pas toucher la note de `PlanAutoDrawer.jsx`. »

### Nouvel agent libellés → branche `wip/xb-ui` (ports 9886 / 5886)

Points 2, 3, 7, 9, 10, 11, 13, 19. Texte envoyé (extrait fidèle) : « #2 onglet Affectation des TPM : contrats sans TPM
dans la colonne des contrats (marqués « sans TPM ») et dans le CSV ; #3 alertes budget et échéance : numéro affiché du
contrat (FLA, sinon MEMS) ; #7 note de la planification automatique selon la règle du retour 114 ; #9 un seul nom pour
l'état « non affectée (ni TPM ni suivi interne) » (alerte, carte, matrice, cellule de visite, CSV) ; #10 en-tête anglais
« Due by » ; #11 journal des indisponibilités : libellé = nom du TPM, période rendue par l'écran ; #13 colonne « Période »
du CSV des rapports ; #19 indicateur « Suivi interne » sans les visites annulées. Ne pas toucher alerts.service.js,
reportExpectation*, reports.repository.js, partners.*, activeProvider*, planAuto*.js (serveur), ContractsListPage.jsx. »
