# CLAUDE.md — MEMS 2.0 (Partenaires & TPM)

Context for continuing this project in Claude Code. Read this first.

## What this is
MEMS 2.0 is an enterprise contract-management + third-party monitoring (TPM /
« tierce partie de suivi ») web app. First delivered module: **Contrats** +
**Partenaires & TPM**. Stack: Node.js/Express + PostgreSQL (multitenant with
Row-Level Security) backend, React 18 + Vite frontend. Reliability and
maintainability are the explicit priorities.

- `server/` — API + background worker (Node/Express/pg/BullMQ)
- `web/`    — React SPA (Vite, hash routing)

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
   handler maps 23505→409, 23514/23503/22P02→400, everything else→500 with no
   leak. Never weaken a constraint to make a test pass.
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
   the request body — only from `req.auth`.
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
npm start                      REM API on http://localhost:9000
```
In another terminal: `cd web && npm install && npm run dev` (UI on :5173,
points at :9000 by default). Redis is **optional** — API + UI work without it;
only the background expense-recalc worker (`npm run worker`) needs it.

Demo login: `admin@mems.mg` / `changeme123` (validator: `validateur@mems.mg`).

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
- **Neutrals: cool institutional grey.** Canvas `#f2f3f5`, surface `#fff`,
  surface-2 `#f7f8fa`, hairline border `#e3e5ea`, strong border `#cbd0d9`,
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
- **Corners: crisp Fluent scale** — radii 4/6/8 (`--radius-sm`/`--radius`/
  `--radius-lg`). Buttons/inputs 36px tall, radius 6.
- **Elevation: restrained** — hairline + a shallow `--shadow-sm`, never floaty.
- KPI/stat tiles are clean (no accent tick, tabular Inter value, muted
  label/foot). Tables: light-grey (`--canvas`) uppercase header band, hairline
  separators, `surface-2` row hover, tabular numerics.
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
  (`contract_report_items`) reproducing the real YPA invoice: each poste =
  quantité × coût unitaire = montant, flagged PAM / ONG, grouped in FLA
  sections I–V, with sub-totals and PAM/ONG split. The « Réalisé » booked
  against the budget is the PAM share, computed from the postes (never typed).
  Editor: `web/src/pages/tpm/FactureDrawer.jsx`; pure math (unit-tested against
  the real 5 600 800 Ar Bekily invoice) in `server/src/modules/tpm/reportMath.js`.
- **Planification & budget** (`web/src/pages/tpm/PlanningPage.jsx` +
  `PlanBudgetDrawer.jsx`, `server/src/modules/tpm/planning.*`): the provisional
  collection budget (planning workbook's « Budget » sheet) — planned postes per
  prestataire × contrat × mois, same shape as the facture. Its funder
  (bailleur) share is the **Planifié** of the consolidation. Tables
  `tpm_collection_plans` + `tpm_collection_plan_items` (migration 016).
- **Liaison pré-remplissage** : a facture can be pre-filled from the month's
  collection plan (`GET /api/tpm/planning/prefill`), copying its postes into the
  état des dépenses. Plan (prévu) → Facture (réalisé) → Consolidation.
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
  deduped by Kobo _uuid). Import sources: CSV + XLSX (parsed, tested), Kobo v2
  API pull (implemented); SPSS .sav → export to CSV for now. Values are computed
  live by the pure, unit-tested `monitoringMath.js`. Nav: « Suivi de processus ›
  Données & indicateurs ».
- **Suivi terrain — sites & visites** (`server/src/modules/tpm/field.*`,
  `web/src/pages/monitoring/FieldVisitsPage.jsx`, migration 020): the S&E
  officer's field-monitoring tool. Two-stage workflow — (1) **planification
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
- **Shell**: left sidebar, collapsible (rail mode), header with notifications +
  user menu (FR/EN language, light/dark theme), no office filter.

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
`cd server && npm test` (29 unit tests on the pure business logic: budget/expense
math, plan-month normalization, workflow state machine, and the consolidation
engine — month maths, per-partner/grand-total roll-ups, month matrix,
projection). Frontend has no test suite yet, but `cd web && npm run build`
type-checks imports/JSX.
