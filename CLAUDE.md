# CLAUDE.md — MEMS 2.0 (Partenaires & TPM)

Context for continuing this project in Claude Code. Read this first.

## Reprise entre sessions (à lire d'abord)
Plusieurs sessions Claude peuvent travailler en parallèle sur ce dépôt, par exemple pendant une limite
d'usage. Avant toute action, lire **`docs/REPRISE.md`**. Il donne :
- ce qui est publié ;
- ce qui est en cours : branche `wip/…`, avancement et consigne exacte de chaque agent
  (`docs/reprise/AGENTS_EN_COURS.md`) ;
- les constats ouverts des vérificateurs ;
- les numéros de migration réservés et les règles pour travailler à deux.

Ne jamais pousser sur une branche `wip/…` ni sur la branche d'une autre session ; publier sur `main`
seulement après tests, lint, build, balayage `node web/scripts/sweep-ecrans.cjs` et vérification
indépendante.

## What this is
MEMS 2.0 is an enterprise contract-management + third-party monitoring (TPM /
« tierce partie de suivi ») web app. First delivered module: **Contrats** +
**Partenaires & TPM**. Stack: Node.js/Express + PostgreSQL (multitenant with
Row-Level Security) backend, React 18 + Vite frontend. Reliability and
maintainability are the explicit priorities.

- `server/` — API + background worker (Node/Express/pg/BullMQ)
- `web/`    — React SPA (Vite, hash routing)

## Journal de bord (obligatoire)
Le propriétaire veut connaître l'état des choses à tout moment. **Chaque action**
(démarrée, en cours, terminée, bloquée) est consignée dans `docs/JOURNAL.md` :
heure UTC, statut (⏳ à faire · 🔄 en cours · ✅ fait · ⛔ bloqué · ⏸️ en pause),
commit et résultat des vérifications ; le tableau « État courant » en tête est
tenu à jour. Le journal est commité et poussé **à chaque mise à jour**, pas en
fin de session. `docs/ETAT_DU_PROJET.md` reste la synthèse fait / reste à faire.

## Engineering priorities (ranked — enforce on every change)
The owner has stated these are the most critical properties of the app. When a
trade-off arises, decide in this order:

1. **Reliability first.** Correctness over features. No partial writes: any
   change spanning >1 statement runs inside `withTenantTransaction`
   (BEGIN/COMMIT/ROLLBACK). Money is integer-cent maths, never float sums
   (see `contracts.domain.js`, `reportMath.js`, `consolidation.js`). Derived
   figures are recomputed from their inputs, never trusted from the client
   (e.g. a facture's « Réalisé » = PAM share computed server-side; monitoring
   spend recomputed by the worker). Validate every input at the edge (zod in
   routes) AND enforce it in the DB (CHECK / UNIQUE / FK) — the central error
   handler maps 23505→409, 23514/23503/22P02/22007/22008→400, an oversized
   body (`entity.too.large`)→413, malformed JSON→400, everything else→500 with
   no leak. AppErrors carry `statusCode` (not `status`). Never weaken a
   constraint to make a test pass.
2. **Maintainability.** Keep the layering `routes → controller → service →
   repository`; only the repository writes SQL. Put business rules in **pure,
   unit-tested** modules with no I/O (the `*.domain.js` / `*Math.js` /
   `consolidation.js` pattern) — that is what keeps the CPU-heavy logic
   testable and, if ever needed, movable to a worker thread. Small functions,
   names matching the surrounding code, a test for every rule.
3. **Multitenant isolation is non-negotiable.** Every business table has
   `tenant_id` + RLS; every query filters `tenant_id = $1` **and** runs inside
   `withTenantTransaction` (which sets the `app.tenant_id` GUC so RLS is the
   safety net). Never read/​write across tenants; never take a tenant id from
   the request body — only from `req.auth`. A foreign key does NOT go through
   RLS: every reference between two tenant tables is also checked on write by
   the `trg_same_tenant` trigger (migration 049). A migration that adds such a
   reference ends with `SELECT mems_install_same_tenant('the_table');`.
4. **CPU-intensive / concurrency.** Node is single-threaded per process:
   - Do aggregation in SQL (`GROUP BY`, `SUM … FILTER`), not JS loops over big
     row sets; the JS layer only shapes bounded results.
   - Batch writes into a single multi-row statement — never N queries in a loop
     (see `insertItems`).
   - Anything genuinely heavy or long-running goes through the **BullMQ worker
     + transactional outbox** (at-least-once), never inline in a request. Keep
     handlers making heavy compute **pure** so they can run in a worker.
   - Guard concurrent edits with row locks (`SELECT … FOR UPDATE`) + the
     unique constraint as the real backstop; make writes idempotent where a
     retry could double-apply.
   - One shared pg `Pool` (never per-request); size it with `PG_POOL_MAX`.
   - Queries on ONE transaction client run one after another (`await` each) —
     never `Promise.all` over the same `client` (pg serialises them anyway and
     the next pg major refuses it).
   - Every Excel import loads its workbook through `common/xlsxGuard.loadWorkbook`
     (zip guard + merged-cell cap + no data-validation expansion) — never
     `new ExcelJS.Workbook().xlsx.load()` directly: a 6 KB file with a huge
     merged range or a whole-column validation exhausts the API's memory.
     The guard also caps, per workbook, the sum of each row's last occupied
     column (`MAX_CELL_SLOTS`, 10 M).
   - Read sheet rows through `common/sheetRows` (`existingRows`, `rowValues`,
     `sheetTable`, `filledWidth`): bounds computed ONCE, existing cells only via
     `findRow`/`findCell`. Never `row.values`, `actualRowCount`/`columnCount` in a
     loop condition, nor `getRow`/`getCell` over a range (they rescan or create the
     sheet); a table read stops at the LAST row, never at a row count.
   - Tenant-wide re-application of submission links (`applySubmissionsGeoTx`,
     `applySubmissionPartiesTx`, `applySubmissionSitesTx`, `afterSitesChangedTx`)
     is serialised by a per-tenant advisory lock. Any write to submissions, value
     links, partners/agents, offices, sites or admin areas that then re-applies
     runs in `places.withSubmissionLinks(tenantId, fn)` instead of
     `withTenantTransaction`: it takes the lock FIRST with a non-blocking try and,
     when busy, rolls back, gives the connection back to the pool and retries
     (jittered 100→500 ms; 503 « réessayez » after 20 s) — so waiting writers never
     starve the pool. Inside it, `lockSubmissionLinksTx` is a no-op; elsewhere it
     blocks (lock_timeout 20 s → 503).
   - Index the columns you filter/group on for the queries that run hot.

## Run it (Windows, PostgreSQL already installed, no Docker)
The API runs on **port 9000** (4000 was taken on the target machine). Use `copy`
(not `cp`). Full step-by-step is in `README.md` → « Démarrer sur Windows ».

```cmd
createdb -U postgres mems2_tpm
cd server
copy .env.example .env         REM then set DATABASE_URL to your postgres superuser
npm install
npm run migrate
npm run seed
npm run seed:test              REM (optionnel) données de test variées, inspectables
npm start                      REM API on http://localhost:9000
```
In another terminal: `cd web && npm install && npm run dev` (UI on :5173,
points at :9000 by default). Redis is **optional** — API + UI work without it;
only the background expense-recalc worker (`npm run worker`) needs it.

Demo login: `admin@mems.mg` / `changeme123` (validator: `validateur@mems.mg`).

**Serving model: the API serves the built web.** When `web/dist` exists,
`app.js` serves it (static + hash-routing fallback to `index.html`) on the SAME
port as the API (9000) — so **one process serves API + UI**, no separate web
server, no CORS. In dev, `dist` doesn't exist so nothing is served there and
vite runs on :5173. The web client picks its API base automatically: DEV →
`http://localhost:9000`; PROD → `window.location.origin` (same origin as the
page), so remote access via `http://SERVER:9000` works with no `VITE_API_URL`
and no `CORS_ORIGIN`. Helmet CSP is disabled (the UI was always served without
CSP by vite). `npm run serve`/`build` exist **only in `web/`** (not root/server).

**Production (Windows): ONE service via NSSM** — build the web once
(`cd web && npm run build`), then run a single `MEMS-API` service
(`node src/server.js` in `server/`) that serves everything on :9000 (+ optional
`MEMS-WORKER`). No `MEMS-WEB` service anymore. Full steps in `README.md` →
« Lancer MEMS 2.0 comme service Windows avec NSSM ». Update: `git pull` →
`npm run migrate` → web `npm run build` → `nssm restart MEMS-API`, then
hard-refresh. **Three seed levels** — `seed` is a FULL DEMO (tenant, partners,
sites, contracts, amendments, reports, visits…), `seed:test` adds even more
varied data on top, and **`seed:blank`** provisions ONLY the tenant + the
admin/validator login — no registries, no operational data — so the app opens
empty and everything (partner types, activities, Région→District breakdown,
offices, MMR, partners…) is created from inside MEMS (Paramétrage, as admin).
**For a clean production start:** `createdb mems2_tpm && npm run migrate &&
npm run seed:blank`. To wipe a DB and restart blank, recreate it
(`dropdb mems2_tpm && createdb mems2_tpm && npm run migrate && npm run seed:blank`).

## Hard constraints (do not break)
- **Never touch the `mems_app` Postgres role.** It belongs to the user's OLD
  MEMS system running on the same server. This app uses a **dedicated
  `mems2_app`** role (created idempotently by migrations 002 + 012,
  `NOSUPERUSER NOBYPASSRLS`). The API/worker connect as `mems2_app` so RLS is
  actually enforced; migrations/seed connect as the superuser (`DATABASE_URL`).
- **No visible "WFP" text.** Branding is neutral (« MEMS 2.0 · Suivi &
  évaluation »); demo data uses `FLA-2025-…` numbers and `@mems.mg` emails.
  Keep it that way.

## Architecture & conventions
- Layered backend: `routes → controller → service → repository`. All business
  rules live in the service; only the repository writes SQL; controllers just
  translate HTTP ↔ service.
- Multitenant: every business table has `tenant_id` + Postgres RLS. Queries run
  inside `withTenantTransaction` which sets the tenant GUC.
- Migrations: dependency-free runner (`server/src/db/migrate.js`), tracked by
  **filename** in `schema_migrations` (no checksum). Files `001`…`012` in
  `server/src/db/migrations/`. New migrations run on existing DBs; editing an
  already-applied migration only affects fresh DBs.
- Events between modules use a **transactional outbox** (written in the same tx
  as the change, published async by the worker) — at-least-once delivery.
- **FLA budget model** (faithful to the real WFP FLA workbook): budget is
  item-level — each poste = `unitCount × unitCost = montant`, allocated per
  activity, grouped in sections I–V. `commission de gestion` = % of direct
  total. **Total de l'accord** = direct + commission (the ceiling, never typed
  by hand). Monthly ceiling = total ÷ period_months. See
  `server/src/modules/contracts/contracts.domain.js`.

## Design system (current direction: "Enterprise sobre — Fiori/Fluent")
Sober, institutional enterprise look (SAP Fiori / Microsoft Fluent): **light
rail**, cool greys, restrained blue accent, crisp corners, dense legible tables.
This supersedes the earlier near-black-rail "v6" and the older "Cockpit"
directions. The authoritative layer is still the **"REFONTE PROFESSIONNELLE
(v6)"** block at the END of `web/src/styles.css` (it comes last, so it overrides
the older Cockpit/polish layers) — its tokens have been re-tuned to this
direction. Edit the tokens/components **there**; do not resurrect the near-black
or navy rail.
- **Typography: Inter** (UI, all text) + **IBM Plex Mono** (codes/IDs only).
  Figures use Inter with `font-variant-numeric: tabular-nums`, NOT mono.
  Bundled via `@fontsource` (see `web/src/main.jsx`), no CDN. Headings carry
  negative tracking (`letter-spacing: -0.018em`).
- **Neutrals: cool institutional grey (modernisé).** Canvas `#f5f6f9`, surface
  `#fff`, surface-2 `#f6f8fb`, hairline border `#e7e9ef`, strong border `#ccd2dc`,
  text-strong `#14181f`, text `#3a4150`, muted `#616a7a`, faint `#8b93a1`.
- **Accent: enterprise blue** `#0f6cbd` (hover `#0b5394`); `--blue-50 #eff6fc`
  for tints. Used sparingly (primary buttons, active nav, links, bars).
- **Rail: LIGHT (white `#fff`)** with a hairline right border; dark-text nav,
  active route = blue-50 tint + blue text + 2px blue left marker. Driven by
  **semantic tokens** (`--rail`, `--rail-line` = `--border`, `--rail-text` =
  `--text`, …) so the dark theme follows the same rail rules from its own
  token values — no hardcoded rail colours. The collapse toggle lives **on the
  rail** (brand row), not the header.
- **Header:** solid white, hairline bottom + `--shadow-sm` (no glass blur).
- **Corners: modern-soft scale** — radii 6/9/14 (`--radius-sm`/`--radius`/
  `--radius-lg`) : arrondi contemporain (SaaS/dashboards 2025) mais pro, jamais
  bubbly. Buttons/inputs 38px tall, radius 9 ; cartes radius 14.
- **Elevation: modern soft** — ombres diffuses et superposées (`--shadow-sm`
  = deux couches douces), cartes légèrement surélevées, jamais criardes.
- **Nav active = pill plein arrondi** (blue-50 + texte bleu), sans barre
  latérale — look moderne épuré.
- KPI/stat tiles are clean (no accent tick, tabular Inter value, muted
  label/foot). Tables: light-grey (`--canvas`) uppercase header band, hairline
  separators, `surface-2` row hover, tabular numerics.
- **Statuts = couleur + icône + libellé** (jamais la couleur seule — a11y).
  Chaque table de statut (`REPORT_STATUS`, `CONTRACT_STATUS`, `AMENDMENT_STATUS`
  dans `lib/contracts.js`, et les maps inline `PLAN_STATUS`/visite) porte une
  clé `icon` → `STATUS_ICONS` (`ui.jsx`). Rendu via `<StatusBadge def={…} />`
  (ou `map`+`value`). `Badge` accepte une prop `icon`.
- Base font-size 14.5px; header height 52px, sidebar 256px.
- The MEMS logo is inline SVG in `web/src/components/Logo.jsx`.

## What's implemented
- **Contrats**: full lifecycle (brouillon → en validation → actif → résilié +
  reject/correct), FLA/PO/Vendor ids, separation of duties (submitter ≠
  validator), item-level FLA budget, cumulative Suivi/TPM consumption, renewal
  (90-day window), termination, immutable history.
- **List page** (`web/src/pages/contracts/ContractsListPage.jsx`): KPI row,
  sortable dense table, pagination, CSV export. **Single click** selects,
  **double-click** opens the détail. Filter bar with a **single "Filtres"
  icon** (a checkbox chooser — only checked filters are shown/applied; there is
  intentionally NO active-count badge) + a disk icon for **saved views**
  (permanent in localStorage / temporary in sessionStorage).
- **Détail** (`ContractDetailPage.jsx`): overview + tabs (Détail budgétaire /
  Avenants / Historique). The **Détail budgétaire** tab reproduces the FLA
  workbook layout: a **« Vue d'ensemble »** synthesis sheet (one row per section
  I–V + direct total, commission, total de l'accord, barème mensuel) plus **one
  page per section**, navigated by a tab bar — read section by section like the
  Excel sheets (`BudgetItemsView` in `web/src/components/BudgetItems.jsx`).
  **Avenants tab is a table**; click a row to expand a full **before→after
  diff** (dates, commission, total, zones, postes).
- **Avenant = same full process as a new contract**; stored as
  `{ before, after }` snapshot (backward-compatible with the old flat format).
- **Excel (round-trip)**: import a real FLA `.xlsx` to auto-fill postes AND
  re-import the workbook the app itself exports — so the offline loop
  *download → edit in Excel → re-upload* works for create / edit / amend
  (`server/src/modules/contracts/budgetImport.js`: `parseFlaBudget` reads the
  real « Détails Section … » template and falls back to `parseBudgetAccord` for
  our own « Budget de l'accord » sheet; column positions are detected from the
  header row; locked by `server/test/budgetRoundtrip.test.js`). Export with live
  formulas is `budgetXlsx.js`. Note: an **active** contract's budget is updated
  through an **avenant** (same form, same import), not edited in place — by
  design for audit.
- **Zones**: cascading Région → District selectors (no free text); admin
  breakdown (adm1–adm4) is per-tenant, importable from `.csv`/`.dbf`/`.zip`
  shapefile in Paramétrage › Localités.
- **Partenaires & TPM**: providers + agents (count-only, modal for detail),
  Formations and Évaluation as separate pages.
- **Rapports & dépenses**: monthly financial/technical reports per partner ×
  contract × month (submit → validate/reject workflow). Financial reports carry
  a **faithful facture** — an « état des dépenses » of line items
  (`contract_report_items`) faithful to the real template: each poste =
  quantité × coût unitaire = montant, with a per-line **« % bailleur »**
  (part à la charge du bailleur = montant × %, défaut 100 %) and an optional
  split across **two activités** (`activity_id`/`activity2_id`/`activity1_pct`),
  grouped in FLA sections I–V with sub-totals. The « Réalisé » booked against the
  budget is the bailleur share (`summarize().funder`), computed server-side
  (never typed). The facture also exports the exact **« Facture (INVOICE) »**
  layout + a « Suivi budgétaire (cumulé) » (Budget · dépenses du mois · cumulé ·
  restant). Editor: `web/src/pages/tpm/FactureDrawer.jsx` + shared
  `PostesEditor.jsx`; pure math in `server/src/modules/tpm/reportMath.js`
  (migration 019 adds the columns).
- **Planification & budget** (`web/src/pages/tpm/PlanningPage.jsx` +
  `PlanBudgetDrawer.jsx`, `server/src/modules/tpm/planning.*`): the provisional
  collection budget (planning workbook's « Budget » sheet) — planned postes per
  prestataire × contrat × mois, same shape as the facture. Its funder
  (bailleur) share is the **Planifié** of the consolidation. Tables
  `tpm_collection_plans` + `tpm_collection_plan_items` (migration 016).
- **Liaison pré-remplissage** : a facture can be pre-filled from the month's
  collection plan (`GET /api/tpm/planning/prefill`), copying its postes into the
  état des dépenses. Plan (prévu) → Facture (réalisé) → Consolidation.
- **Fil guidé du rapportage TPM** : la page Rapports affiche un **stepper**
  « Plan validé → Facture → Validation → Consolidation » (composant `GuidedFlow`
  dans `ReportsPage.jsx`) montrant l'état du mois, chaque étape menant à l'écran
  concerné. Depuis **Planification & budget**, un plan sélectionné offre
  **« Créer la facture »** : via `sessionStorage['mems.tpm.newFacture']` +
  `onNavigate`, Rapports ouvre une facture avec prestataire/contrat
  présélectionnés et **auto-pré-remplie** depuis le plan (`FactureDrawer`
  `autoPrefill`). Une facture validée propose **« Voir dans la consolidation »**.
- **Export facture** : real `.xlsx` with live formulas
  (`server/src/modules/tpm/factureXlsx.js`, `GET …/reports/:id/facture.xlsx`)
  and a dependency-free **PDF** via a print-optimized view
  (`web/src/lib/facturePrint.js`).
- **Import/export Excel des postes** (`server/src/modules/tpm/postesXlsx.js`,
  routes `/api/tpm/postes/template.xlsx` + `/api/tpm/postes/import`): a fillable
  template with Excel data-validation dropdowns (valid budget lines, bailleur/
  ONG, amounts ≥ 0) — so restrictions apply at fill time — and an import that
  re-runs the SAME `reportMath.normalizeItems` rules and returns the parsed
  items for review (nothing persisted until the normal save). Shared by the
  facture and the plan via the toolbar in `PostesEditor.jsx`. Round-trip
  locked by `server/test/postesXlsx.test.js`.
- **Terminologie neutre** : aucun « PAM »/« WFP » ; le payeur est « bailleur »
  (funder) vs « ONG ». `pay_by` ∈ (bailleur, ong).
- The shared postes grid is `web/src/pages/tpm/PostesEditor.jsx` (used by both
  the facture and the plan — one editor, one place to maintain).
- **Dashboard décisionnel › Suivi budgétaire consolidé** (`web/src/pages/
  dashboard/ConsolidationPage.jsx`, `server/src/modules/tpm/consolidation*.js`):
  faithful reproduction of `Suivi_Budget_TPM_BT.xlsx` and the **interliaison
  layer** — for every active monitoring contract it puts side by side the
  **Budget** (ligne « IV.suivi » du contrat), the **Planifié** (collection
  plans) and the **Réalisé** (factures), and derives taux de consommation,
  écart plan/réel, mois restants, restant and projection de fin. Overview table
  + monthly matrix (Réalisé/Planifié/Écart) + CSV export. Everything is
  recomputed live from contracts + plans + factures (nothing stored). Pure
  logic in `consolidation.js` is unit-tested (`server/test/consolidation.test.js`).
- **Suivi de processus** (`server/src/modules/monitoring/*`, `web/src/pages/
  monitoring/ProcessMonitoringPage.jsx`): import of real monitoring data and a
  **configurable indicator mapping**. Model (migration 018): monitoring_forms,
  monitoring_indicators (each indicator = a form field + an aggregation
  percent_yes/percent_value/mean/sum/count + optional target/direction —
  the « mapping paramétrable »), monitoring_submissions (raw answers in JSONB,
  deduped by Kobo _uuid). Import sources: CSV + XLSX, **SPSS `.sav`** et **`.zip`
  Kobo** (le zip contient data.sav) — parseur `.sav` pur et testé
  (`savParser.js` : little-endian, compression bytecode, chaînes multi-segments,
  étiquettes de valeurs, noms longs ext.13, encodage ext.20 ; dé-duplication par
  _uuid ou hash stable du contenu), plus Kobo v2 API pull. **Import de définition
  XLSForm** (`POST /import-definition`, `xlsformImport.js`) crée la fiche + son
  catalogue de champs/choix (migration 025) pour configurer les indicateurs avant
  toute soumission. Values are computed live by the pure, unit-tested
  `monitoringMath.js`. Nav: « Suivi de processus › Données & indicateurs ».
  **Imports sûrs** : le format est reconnu par les OCTETS, jamais par le nom
  (`server/src/modules/common/fileSniff.js`) ; HTML, PDF, Word, `.zsav`, `.xls`
  et XLSForm déposés comme données sont refusés (400, format nommé, rien
  d'écrit). Tout zip (export SPSS, `.xlsx`) passe d'abord la garde de
  décompression (`common/zipGuard.js` : tailles déclarées lues avant
  décompression, plafond `IMPORT_MAX_UNZIPPED_MB` = 150 Mo et taux
  `IMPORT_MAX_ZIP_RATIO` = 100 → 413/400). Les dates de collecte sont lues
  strictement (`monitoring/collectionDate.js` : ISO, secondes SPSS, série
  Excel ; `30/01/2026` refusé) → 400 avec ligne et colonne, jamais 500.
  **Mois de collecte = date d'enquête** (retour 35, `collectionDate.js`) : le
  mois d'une soumission (`period_month`) est celui de la PREMIÈRE date d'enquête
  LISIBLE (SvyDate → today → start → end, chaque alias nom complet puis feuille
  de groupe) quand elle précède la réception serveur (`_submission_time`) de 0
  à `MAX_SURVEY_LAG_DAYS` = 730 jours (tolérance 1 jour) ; au-delà, ou après la
  réception, mois de réception (compté « à vérifier »). Un envoi > 92 jours après
  l'enquête reste au mois de l'enquête (« envoi tardif », information).
  `upload_month` garde le mois de réception. Vérification avant import =
  import (`prepareImport`, même résolution du Mapping) ; réparations
  `r3_mois_de_collecte` / `r4_mois_de_collecte_2ans` (dataRepairs.js).
  **Mapping MEMS** : colonne de date modifiable (colonne, « Aucune », Automatique)
  et cycle brouillon → soumis → validé (migration 060, `mappingWorkflow.js` pur ;
  modification refusée hors brouillon, valideur ≠ soumetteur, mêmes règles en
  base par contraintes et déclencheurs ; « Réinitialiser » ramène au brouillon).
  **Liste d'indicateurs « riche »** (`web/src/pages/monitoring/IndicatorsList.jsx`,
  onglet « Résultats ») : implémente la maquette design (branche
  `design/liste-drawer-mockup`, PR #2 ; HTML de réf. dans `web/public/mockups/`) —
  table aérée, **barres de progression en ligne** (Réalisé/Cible·% colorées par
  statut), statut couleur+icône+libellé, **sélection multiple + barre d'actions**,
  **densité réglable**, colonnes configurables (mémorisées localStorage), tri par
  en-tête, et **clic ligne → drawer de détail** (hero métrique + barre + liste
  clé-valeur + onglets Détails/Méthode). Câblée aux vrais champs d'indicateur
  (label/code/module/agg/value/target/direction/rating) — aucun champ inventé.
- **Affectation & visites de terrain** (ex-« Sites & visites » ;
  `server/src/modules/tpm/field.*`, `web/src/pages/monitoring/FieldVisitsPage.jsx`,
  migration 020). **Écran unique d'affectation TPM** : l'ancien
  « Affectation & calendrier » (`AssignmentPage.jsx`, modèle `tpm_assignments` +
  `tpm_mission_days`, nominatif) a été **retiré du menu** au profit de cet écran
  piloté par le RBM (rôles génériques, conforme au design). L'entrée de nav est
  « Suivi de processus › Affectation & visites » ; l'ancienne route
  `#/tpm/affectation` **redirige** vers `#/processus/sites` (table `REDIRECTS`
  dans `App.jsx`). `AssignmentPage.jsx` reste dans le dépôt mais n'est plus
  importé (données `tpm_assignments` conservées, aucune migration destructive).
  The S&E officer's field-monitoring tool. Two-stage workflow — (1) **planification
  générale** : the bureau lists the sites to visit in the month, reusing the
  **shared `sites` registry** (migration 001, also used by RBM/assignments — no
  duplicate table; migration 020 only adds `sites.fokontany` + the `site_visits`
  table, unique per site+month+activity); (2) **affectation** (done AFTER planning): each visit is
  assigned to a prestataire TPM and a **generic role** (Agent 1 / Superviseur 1
  — never nominative). Status planifie→realise→annule; coverage =
  réalisées / (planifiées+réalisées), cancelled excluded. Pure math in
  `fieldMath.js` (`server/test/fieldMath.test.js`). Excel import of the real
  « Planning » sheet (District | PDF | Commune | Établissement | Activité |
  agents) creates sites + plans visits idempotently. Nav: « Suivi de processus ›
  Sites & visites ».
  **Jours de collecte → budget** (migration 021, `tpm_collection_days`) : chaque
  visite porte une **date de visite** ; par prestataire, `jours de visite =
  nombre de visites datées (non annulées)` + `jours de déplacement` (majoration
  manuelle) = **total des jours à budgéter**. Calcul pur `fieldMath.collectionDays`
  (testé) ; endpoints `GET/PUT /api/tpm/field/collection-days` ; carte « Jours de
  collecte (pour le budget) » sur la page terrain.
  **Plan de suivi groupé par mois + données réelles** : la page s'ouvre sur un
  **tableau des mois** (clic → plan du mois, édition en ligne type Excel). La
  grille de planification affiche une colonne **« Dernière collecte (données) »**
  (`listVisits` renvoie `dataVisitMonth` via le pcode de commune du site), et un
  onglet **« Données réelles »** liste les soumissions réellement versées le mois
  (`GET /api/monitoring/submissions?month=`, `monitoring.repository.listSubmissions`
  — résout le nom de commune depuis le référentiel de sites via le pcode).
- **Risk-Based Monitoring (RBM)** (`web/src/pages/monitoring/RbmPage.jsx`,
  `server/src/modules/tpm/rbmMath.js` + `field.*`, migration 022) : le niveau de
  risque de chaque site (`sites.risk_level` ∈ faible/moyenne/elevee, défaut
  moyenne) pilote la **fréquence de suivi** (élevé = tous les mois, moyen = 2,
  faible = 3). Un site est « à suivre » (due) s'il n'a jamais été visité ou si
  l'échéance est atteinte (`rbmMath.isDue`, testé). La **planification des visites
  du mois se génère depuis le RBM** (`POST /api/tpm/field/rbm/generate` → une
  visite planifiée par site due) ; le référentiel de sites s'importe du **Master
  Data** (`POST …/rbm/import` : Région | District | Commune | Site name | Code).
  La génération RBM est aussi offerte **directement sur la page de planification
  des visites** (bouton « Générer depuis le RBM (N) » + compteur de sites à
  suivre dans l'état vide) pour partir du RBM sans quitter la planification.
  Nav : « Suivi de processus › Risk-Based Monitoring ».
  **Liaison données réelles → site (migration 036)** : les soumissions de suivi
  (`monitoring_submissions`) sont géocodées par **pcode** de commune (`admin3`),
  sans identifiant de site. On stocke donc le pcode de commune sur chaque site
  (`sites.adm3_pcode`, capturé à l'import Master Data, colonne « Code » après
  Communes) et la **dernière collecte réelle** d'un site = la soumission la plus
  récente de même pcode de commune (granularité commune — ce que la donnée
  permet). Le RBM expose `dataVisitMonth`/`dataVisitCount` (colonne « Dernière
  collecte (données) ») et la **dernière visite effective** = la plus récente
  entre une visite RÉALISÉE (`status = 'realise'`), une collecte réelle et
  `sites.last_visit_date` (`rbmMath.visitState` / `lastVisitOf`) : une visite
  seulement PLANIFIÉE ne compte jamais et ne rend jamais un site « à jour » (elle
  s'affiche à part : « prévue AAAA-MM »). **Drapeaux expliqués** (retour 48) :
  `rbmScore.scoreSite` rend `reasons` (règles appliquées et valeurs du site),
  `consequence` (niveau, priorité, fréquence) et `actions` (que faire) ; le
  niveau et « ⚑ urgent » ouvrent « Pourquoi ? / Conséquence / Que faire ? ».
- **Dashboard Suivi de processus — Synthèse** (`web/src/pages/monitoring/
  ProcessDashboardPage.jsx`, endpoint `GET /api/monitoring/overview`,
  `monitoring.repository.processOverview`) : synthèse transversale recalculée en
  direct — KPIs (couverture terrain, sites à jour/à suivre via RBM, données
  versées, indice de conformité global via `overallIndex`, visites planifiées,
  fiches·indicateurs), tendance mensuelle des soumissions, couverture par
  district, répartition des sites par risque, conformité par fiche, zones à
  surveiller (<80 %). Nav : « Suivi de processus › Tableau de bord ».
  **Règles communes des tableaux de bord** (lot 1) : période par défaut = dernier
  mois qui a vraiment des données (bandeau qui le dit), jamais un mois vide ; un
  code de bureau non relié s'affiche via `common/codeLabel` (« Code 6 (non relié) »
  + lien vers les correspondances), jamais un chiffre seul ; « — aucun plan »,
  jamais « 0 % » quand rien n'est planifié ; chaque « Non évalué » porte sa raison
  (`monitoringMath.naReason` : no_data, variable_absent, only_na, no_answer,
  not_numeric, no_target, not_scored) ; la cloche affiche le Centre d'alertes
  (`dashboards/alerts.service.js`, mêmes règles et niveaux).
- **Champs calculés & « Aide aux calculs »** (retour n° 4) : moteur de formule
  sûr (`monitoring/calcFields.js`, sans `eval`) dont le catalogue `FUNCTIONS`
  est la source unique pour le calcul, la vérification (position de l'erreur,
  fonction inconnue avec suggestion, nombre d'arguments, variable inconnue), l'éditeur
  (`web/src/pages/monitoring/FormulaEditor.jsx` : complétion Tab, fonctions par
  catégorie, variables de la fiche, aperçu sur les 300 dernières soumissions via
  `POST /forms/:id/calc-fields/preview`) et la page « Comment les calculs sont
  faits » (`CalcDocsPage.jsx`, route `#/processus/calculs`). Syntaxe Tableau
  tolérée (`=`, `<>`, AND/OR/NOT, null) ; fonctions du suivi (`selected`,
  `count_selected`, `in`, `between`, `sum`, `avg`, `isnull`…). **Classe d'un
  indicateur = `monitoringMath.classify`, la même partout** (liste des résultats,
  Synthèse, Couverture & performance) : avec cible écart ≤ 10 / 30 % ; sans cible
  bandes 80 / 65 / 50 sur le score orienté — ne pas réintroduire une 2ᵉ règle.
  `classify = classifyDetail().rating` (classifyDetail rend aussi la règle appliquée).
- **Éditeur d'indicateur + « Comment c'est calculé »** (retour n° 20) : UN éditeur
  (`web/src/pages/monitoring/IndicatorEditor.jsx`) ouvert depuis les Résultats
  (barre d'outils, ligne, détail) et la Configuration (carte des indicateurs en
  tête, colonne d'actions figée). Choix de la variable `VariablePicker.jsx` sur
  `GET /forms/:id/variables` (`variableCatalog.describeVariables` pur : questions,
  options éclatées « X.1 » / « X/1 » libellées « question — choix », colonnes des
  seules données, champs calculés, remplissage sur les 1 000 dernières soumissions).
  Explication `IndicatorExplain.jsx` via `POST /forms/:id/indicators/preview`
  (lecture, période, seules les clés utiles lues) = `monitoringMath.explainIndicator`,
  qui dérive du MÊME décompte que `computeIndicator` (`tallyIndicator`) : jamais
  d'écart avec les résultats. `PATCH /indicators/:id` est PARTIEL (`col = CASE WHEN
  $drapeau …`, null efface, absent = inchangé, code modifiable → 409 si pris) ; la
  variable est contrôlée contre la fiche (`variableCatalog.resolveVariable` : exact,
  puis casse, sinon 400 « vouliez-vous dire ») ; règles croisées dans
  `indicatorRules.js` (« % = valeur » exige la valeur comptée). Réappliquer le
  modèle d'activité ne crée que les manquants (`ON CONFLICT DO NOTHING`), jamais
  de réécriture d'un indicateur existant. Résultats : période par défaut = dernier
  mois avec données (`GET /forms/:id/months`), « Toutes les périodes » proposé.
- **Import des soumissions = assistant** (`web/src/pages/monitoring/ImportWizard.jsx`,
  onglet « Importation » d'une fiche, distinct de « Données ») : source → fichier
  ou connexion → **vérification sans écriture** (`POST /forms/:id/import/preview`,
  `submissionsImport.analyzeSubmissions` pur + `repository.importPreview`) →
  compte rendu (`importSubmissions` renvoie `created` / `updated` / `months` et
  l'état de la fiche `form`). Même lecture du fichier pour la vérification et
  l'import (`readSubmissionsFile` dans les routes).
- **Correspondances des valeurs codées** (retour n° 3 ; migration 059,
  `common/partyMatch.js` pur, `placeMatch.repository.applySubmissionPartiesTx`,
  `web/src/pages/monitoring/Correspondences.jsx` dans l'onglet « Mapping MEMS ») :
  bureau / partenaire / agent d'un formulaire reçu → objet MEMS. Correction par
  FICHE dans `monitoring_value_links` (une colonne cible par dimension, toutes
  vides = « ne pas relier »), prioritaire sur l'automatique dans
  `applySubmissionsGeoTx` ; `monitoring_submissions.partner_id` / `agent_id`.
  Automatique seulement si exact ; un nom proche est proposé, jamais appliqué.
- **Dashboard « façon Power BI »** (`web/src/pages/dashboard/DashboardBIPage.jsx`,
  nav « Dashboard décisionnel › Vue d'ensemble ») : KPI tiles, grouped
  Budget/Planifié/Réalisé bars, réalisé-by-partner donut, monthly trend line,
  consumption gauges and alerts — dependency-free inline SVG with hover
  tooltips, legends and direct labels; series colours validated with the dataviz
  palette checker. Fed live from the consolidation API.
- **Reporting — rapport de synthèse** (`web/src/pages/dashboard/ReportingPage.jsx`,
  nav « Reporting › Rapport de synthèse ») : pour une période, situation
  budgétaire par contrat (consolidation) + couverture terrain par district
  (visites), avec exports CSV et impression/PDF (navigateur). Lecture seule,
  recalculé en direct, rien stocké.
- The Power BI dashboard also shows a **« Couverture terrain — mois courant »**
  card (visites réalisées/planifiées par district), fed by the field summary API.
- **Centre d'alertes** (`web/src/pages/dashboard/AlertsPage.jsx`, nav
  « Alertes › Centre d'alertes ») : agrège en direct (aucun stockage) ce qui
  demande attention pour le responsable S&E — dépassements/​projections
  budgétaires (consolidation), rapports à valider, avenants/contrats en
  validation, contrats à échéance ≤ 90 j, couverture terrain faible et visites
  non affectées. Trois niveaux (critique/à surveiller/à traiter), chaque ligne
  navigue vers le module concerné.
- **Distribution d'urgence (PDD)** (`web/src/pages/pdd/PddPage.jsx`,
  `server/src/modules/pdd/*`, migration 035) : reproduit le classeur de plan de
  distribution d'urgence (vivres & cash). **Réutilise les référentiels existants**
  (zones région/district/commune, bureaux antenne/sous-bureau, partenaires) en
  stockant leurs libellés — pas de référentiel dupliqué. Tables
  `pdd_commodities` / `pdd_distributions` / `pdd_distribution_items` / `pdd_stock`.
  Logique pure testée `pddMath.js` (summarize par aléa/mois/zone/denrée +
  pipeline besoin vs stock). Import de la feuille « PDD base » (`pddImport.js`,
  `POST /api/pdd/import`, réimport idempotent par mois). 3 vues COMET, nav
  « Suivi & évaluation › Distribution d'urgence » : **Distributions** (ouvre sur
  un **tableau des mois** façon plan de suivi — clic → distributions du mois —
  table fidèle filtrable + CSV, colonne par denrée), **Synthèse** (par aléa /
  mois / arbre zone / denrée) et **Pipeline** (besoin planifié vs stock éditable,
  écart, couverture, ruptures). seed des denrées + seed-test (491 distributions).
- **Shell**: left sidebar, collapsible (rail mode), header with notifications +
  user menu (FR/EN language, light/dark theme), no office filter.

- **Période = plage de mois (lot 1b, publié)** : `common/period.js` (`parsePeriod`, `periodBounds`,
  plafonds partagés `common/periodCaps`), `middleware/period.readPeriod` (`?from=&to=`, l'ancien
  `?month=` reste lu) ; côté web `PeriodSelect` + `usePeriod` (URL > session > défaut). Sur une plage, les
  sites se comptent UNE fois : service unique `common/siteActivitySql.siteMonthFactsCtes` — ne pas
  ré-implémenter actif / prévu / réalisé ailleurs. Couverture (sites) ≠ Exécution du plan (visites).
- **District d'un site** : `siteDistrictCtes` / `common/siteDistrict` — la graphie du site dans SA région ;
  le P-code `adm2_pcode` n'est cru que s'il concorde avec la région. La carte (lot 6a, `modules/map/*`)
  suit la même règle (`geo: true`). Positions GPS de ménages : jamais pour un rôle hors admin / manager
  (`map/submissionGps.seesPreciseGps`, retirées AVANT les champs calculés).
- **Registre des sites** = onglet « Sites » de Paramétrage › Localités (`SitesSection.jsx`,
  `settings/sitesAdmin.*`, `/api/site-registry`) : actions groupées en une transaction
  (`withSubmissionLinks`), un site qui porte des données (visites, soumissions, grille des sites actifs,
  affectations) ne se supprime jamais (`linkedDataTx`, refus détaillé) ; un identifiant saisi n'est jamais
  adopté. Toute nouvelle page doit être déclarée dans `AppShell.jsx` (sinon l'adresse renvoie à Contrats).
- **Suppression des documents** (retour 56) : `common/deletionPolicy.js` + journal `document_deletions`
  (migration 065, inscription seule) — non validé → supprimable ; validé → seulement sans donnée reliée,
  avec justificatif.

- **Sites (actifs / inactifs)** (retour 64 ; `server/src/modules/tpm/activation*.js`,
  `web/src/pages/monitoring/SitesActivationPage.jsx`, migration 072) : onglet DISTINCT du plan de
  suivi (« divise bien » : ici on dit SI un site est actif chaque mois, le plan dit QUAND le visiter).
  Fidèle à la feuille « Site Actif » du classeur d'activation : Oui / Non / vide par mois, Identifiant
  = Code POI & Tag_code (sinon code MEMS), « Motif du changement ». État courant = `site_month_status` ;
  chaque changement est journalisé (`site_activation_changes`, append-only, avant → après, motif, source
  écran / import). Import : rapprochement par identifiant, aperçu sans écriture, une case VIDE laisse le
  mois inchangé, un site inconnu n'est jamais créé (il vient du registre). Règles pures `activationMath`.
  **Forme du Plan de suivi** (retour 98) : mêmes classes `pb-*` (planBoard.css), `activation.css` ne porte
  que le propre à la grille (tout préfixé `act-`). **Règle UNIQUE « site actif au mois M »** = celle des
  tableaux de bord (`common/siteActivitySql`) : dès que l'exercice a une grille, seul « Oui » est actif
  (case vide = inactive, badge « À renseigner ») ; sans aucune grille, tous les sites comptent actifs
  (`web/src/lib/activation.isActiveMonth`). « Renseigner les cases vides » = `POST …/activation/fill`
  (`activationMath.blankFill`, sous verrou, une transaction ; un Oui / Non saisi ne change jamais).
- **Identifiant des sites** (retour 64, migration 073, `common/publicId.js`) : chaque site porte un
  identifiant affiché `S-XXXX-XXXX` (8 symboles Crockford base 32 sans I, L, O, U, tirés au hasard par
  la base `mems_site_public_id()`, uniques par compte, IMMUABLES — déclencheur). L'UUID interne reste la
  clé technique, jamais montré ; les anciens codes (`code` PLAN-0001, `location_id` L001) restent dans
  leurs colonnes et sont reconnus à l'import. Saisie tolérante (casse, tirets, O→0, I/L→1) partout où un
  identifiant est cherché ou importé (`normalizePublicId`).
- **Espace RBM** : onglets Priorités du mois · Plan de suivi (plan, déjà visités, carte) · Sites
  (actifs / inactifs) · Configuration RBM (critères de risque des sites = ancienne « vue standard »,
  exigences MMR, planification automatique). Ne pas remettre la vue standard dans le Plan de suivi.
- **Publié le 15/10** :
  - sélecteur de période en surcouche (portail, `web/src/lib/popoverPlacement.js`) : jamais coupé par
    une fenêtre ; onglet « Données » d'une fiche par pages de 1 000 dans un ordre stable, le compteur dit
    « chargée(s) sur N » (jamais de limite silencieuse), lieux par leur nom (P-code puis liste de choix) ;
  - carte : couleur des points par activité (`web/src/lib/mapPoints.activitySlots`, rang dans le registre :
    un filtre ne recolore jamais) ou par statut ; légende en groupes titrés ; un bureau choisi recadre ;
  - concepteur : images d'en-tête PNG / JPEG reconnues par les octets, IMMUABLES (`report_assets`, 062,
    quotas sous verrou) ; bandes d'en-tête / pied validées (couleurs `#RRGGBB`, polices d'une liste,
    20 éléments au plus, positions bornées) ; annexes ; orientation et format par page ;
  - écrans qui n'affichent que des totaux RBM : `GET /api/tpm/field/rbm/counts` (mêmes lignes que
    `/rbm/sites`), jamais la liste complète.
- **Couverture : une seule source** (retour 110) : `GET /api/dashboards/coverage` (`dashboards/coverage.*`, mise en forme pure `coverageDefinitions.js`), lu par la Synthèse ET « Couverture & performance » ; univers = sites actifs de la période ; « suivi » = visite déclarée OU données reçues rattachées au site ; chaque découpage (activité, bureau, district) se somme aux tuiles. Ne pas recalculer une couverture ailleurs ; « Sites prévus → suivis » (sites) ≠ « Exécution du plan » (visites).
- **Publié le 20/10** :
  - **Listes de choix** : `components/EntityPicker.jsx` (logique pure `lib/entityPicker.js`, testée) remplace la liste du
    navigateur sur les longues listes (recherche sans accents au-delà de 7 choix, groupes, précision, 300 options au plus,
    le reste compté) ; contrat d'abord puis son TPM (`lib/tpmPickers.js`, `useContractTpms`), TPM actifs du mois en tête,
    un TPM choisi à la main n'est jamais écrasé.
  - **Clé d'activité** : `siteActivitySql.activityKeySql` et `coverageDefinitions.activityKey` sont des jumelles STRICTES
    (classe d'espaces explicite `ACTIVITY_SPACE_CLASS`, jamais `\s` ni `btrim` en SQL) ; une seule expression pour regrouper
    et filtrer. Limite : `lower()` suit la locale de la base.
  - **Constats des rapports** : clés de ligne re-clées UNE fois (`rowKeys: 2` dans le contenu) ; règle `rekeyOnRead` —
    brouillon et rapport finalisé avec `snapshot.rowKeys = 2` (posé par finalize) : re-clés ; finalisé avant : jamais
    (« Dupliquer » part de `copyContent`). Les lignes figées ne sont jamais réécrites.
  - **Plafond d'une période** : chaque écran propose au plus le plafond du plus restrictif de ses endpoints ; un lien
    (alerte, « Ouvrir la carte ») n'envoie jamais une période que l'écran d'arrivée écarterait.
  - **Tests sur base jetable** : `npm run test:db` (fichiers en série : ils écrivent dans la même base).
- **Effacer des visites prévues** : seulement les « libres » (`planAuto.repository.CLEARABLE_SQL` : TPM de zone, ni figées ni facturées, sans date ni agent, mois en cours ou à venir) — jamais une visite réalisée, annulée, motivée, d'un mois échu.
- **TPM d'une visite = contrat de la zone** (retour 58, migration 070, `tpm/tpmAttribution.js` + jumelle SQL
  `mems_tpm_cells`) : TPM du contrat de suivi actif qui couvre la zone (commune sinon district) du site ce
  mois-là ; seules les MODIFICATIONS sont stockées (`tpm_zone_overrides`, raison 10–500) et journalisées
  (`tpm_attribution_log`, inscription seule). La base estampille au COMMIT toute visite « zone » sans TPM
  (déclencheur différé `mems_tpm_stamp`) : un écrivain n'a pas à choisir le TPM. Seules les visites
  PRÉVUES sont réattribuées — réalisées, annulées, figées (« antérieur »), facturées ou motivées jamais.
  TPM d'un contrat = TPM rattaché par plan / facture, sinon titulaire (règle commune du lot 8
  `activeProvider`) ; tout écrivain de visites appelle `restampVisitsTx` (test `visitWritersGuard`) ;
  filtre des réattributions automatiques `AUTO_RESTAMPABLE_SQL` (même filtre dans `mems_tpm_stamp`).
  Onglet « Affectation des TPM » (`TpmAttributionTab`, espace RBM) : zones région › district, changement
  motivé avec aperçu, retour au contrat, journal ; autre TPM pour une visite = écart motivé (`provider_source = 'visite'`).

## Known / open items
- **Rapportage fidèle à la facture** — DONE. Financial reports now hold a
  line-item « état des dépenses » (facture) faithful to the real YPA invoice
  (see the Rapports bullet above). Possible follow-ups: an .xlsx/PDF export of
  the facture in the invoice's exact layout, and real file upload of the signed
  invoice (currently metadata only: `document_name`).
- `web/` has no lint setup; `server/` lint works (`cd server && npm run lint`,
  flat config in `server/eslint.config.js`).
- A few harmless dead CSS rules remain inside grouped selectors in
  `web/src/styles.css` (e.g. `.add-menu`, `.add-row`, a dark `.brand-mark`
  ref) — safe to drop with the app open to verify.
- The demo tenant record is still named « Bureau de Toliara » in
  `server/src/db/seed.js` (not shown in the UI).

## Testing
`cd server && npm test` (640+ unit tests on the pure business logic: budget/expense
math incl. the per-line **% bailleur** split and 2-activity allocation,
plan-month normalization, workflow state machine, the consolidation engine, the
budget Excel round-trip, the INVOICE workbook, and the field-visit coverage math
`fieldMath`). `cd server && npm run lint` is clean. Frontend has no test suite
yet, but `cd web && npm run build` type-checks imports/JSX, and a Playwright
smoke-sweep of every route (login → each module) is used to confirm 0 console/API
errors before pushing.
- **Données de test end-user** : `cd server && npm run seed:test` (après `npm run
  seed`) peuple des données variées et inspectables — taux de change, bureaux &
  antennes (périmètre communes), plans de collecte, rapports (facture validée +
  soumis + technique), un contrat en brouillon (test suppression/prévision),
  visites du mois (couverture + jours de collecte), et une fiche de suivi de
  processus + indicateurs + ~40 soumissions (alimente le tableau de bord).
  Idempotent (supprime d'abord ses lignes marquées). `server/src/db/seed-test.js`.
