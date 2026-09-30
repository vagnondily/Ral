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
  contract × month (metadata + planned/reported amounts, submit → validate/
  reject workflow). Faithful line-item invoices (`contract_report_items`) are
  the next step (see open items).
- **Dashboard décisionnel › Suivi budgétaire consolidé** (`web/src/pages/
  dashboard/ConsolidationPage.jsx`, `server/src/modules/tpm/consolidation*.js`):
  faithful reproduction of `Suivi_Budget_TPM_BT.xlsx` and the **interliaison
  layer** — for every active monitoring contract it puts side by side the
  **Budget** (ligne « IV.suivi » du contrat), the **Planifié** and the
  **Réalisé** (rapports), and derives taux de consommation, écart plan/réel,
  mois restants, restant and projection de fin. Overview table + monthly
  matrix (Réalisé/Planifié/Écart) + CSV export. Everything is recomputed live
  from contracts + reports (nothing stored). Pure logic in `consolidation.js`
  is unit-tested (`server/test/consolidation.test.js`).
- **Shell**: left sidebar, collapsible (rail mode), header with notifications +
  user menu (FR/EN language, light/dark theme), no office filter.

## Known / open items
- **Rapportage fidèle à la facture** is NOT rebuilt yet — the user flagged « le
  rapportage est fausse » and wants financial reports matching the real invoices
  (e.g. the YPA facture). The `contract_report_items` table exists (migration
  008) but the UI/service are not built. This is the main pending feature.
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
