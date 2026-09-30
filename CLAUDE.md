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

## Design system (current direction: "Cockpit")
Chosen by the user after comparing three directions. Do NOT revert to indigo.
- **Dark navy sidebar** (`#0e1a2b`) in both light and dark themes; light content.
- Accent **electric blue** `#2f6bff` (hover `#1f4fd6`).
- Typography **IBM Plex Sans** (UI) + **IBM Plex Mono** (all figures: amounts,
  KPI values, FLA/contract numbers). Bundled via `@fontsource`, no CDN.
- Flat surfaces, soft shadows. KPI tiles have a left accent tick + mono value
  (no sparklines — the user explicitly declined them).
- Tokens live in `web/src/styles.css` `:root` (light) + `:root[data-theme="dark"]`
  (dark) + a "Cockpit direction (v5)" block near the end (the permanent dark
  rail). The MEMS logo is inline SVG in `web/src/components/Logo.jsx` (swap the
  SVG for an `<img>` to use an official logo file — every placement follows).

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
  Avenants / Historique). **Avenants tab is a table**; click a row to expand a
  full **before→after diff** (dates, commission, total, zones, postes).
- **Avenant = same full process as a new contract**; stored as
  `{ before, after }` snapshot (backward-compatible with the old flat format).
- **Excel**: import a real FLA `.xlsx` to auto-fill postes
  (`server/src/modules/contracts/budgetImport.js`), and export the budget with
  live formulas (`budgetXlsx.js`).
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
