# Lot 1b — « Période = plage de mois » (retour n° 47)

> Spécification d'implémentation, établie en lecture seule sur `claude/practical-meitner-2c1560` (commit `b419324`, lot 1 fusionné). Les définitions communes de `docs/PLAN_RETOURS_15_37.md` (visite, réalisée, couverture, planification, exécution, « — aucun plan », période par défaut, bureau via `codeLabel`) s'appliquent telles quelles. **Aucune migration** n'est nécessaire (le 061 reste au lot 6a, le 062 et les suivants au lot 7a).

## 0. En bref

1. **Un seul modèle de période** : `{ from: 'AAAA-MM', to: 'AAAA-MM' }`, bornes incluses ; un mois seul s'écrit `from = to`. Côté serveur : `common/period.js` (pur, zod), `middleware/period.js` (`readPeriod`), `common/periodSql.js` (prédicats). Côté écran : `lib/period.js` (pur), `components/PeriodSelect.jsx`, `usePeriod()`.
2. **Rétrocompatible** : `?month=AAAA-MM` reste accepté partout et vaut `from = to = month`. Nouveau : `?from=…&to=…`. Toute période mal formée renvoie un 400 explicite avec `details.code`. Aujourd'hui, `?month=abc` est ignoré en silence et renvoie… toutes les périodes.
3. **Trois natures de chiffres sur une plage** :
   - les **flux** (soumissions, visites, montants, tonnages) se **somment** sur les mois ;
   - les **effectifs** (sites, agents, bureaux, communes) se comptent **distincts sur la plage** ;
   - les **états** (RBM « à jour », stock, reste du budget, projection) se lisent **au dernier mois `to`**, ou à date.

   Les séries mensuelles restent mois par mois.
4. **Site actif sur une plage = actif au moins un mois de la plage.**
   - Le statut d'un mois est le dernier statut renseigné à ce mois ou avant ; sans statut, le site est actif. Un site en zone interdite n'est jamais actif.
   - Un « réalisé » ne compte que pendant un mois où le site est actif. Une visite sur un site inactif est comptée à part, jamais perdue.
5. **Taux** :
   - **Couverture** = sites distincts réalisés ÷ sites actifs ;
   - **Planification** = sites distincts prévus ÷ sites actifs ;
   - **Exécution du plan** = visites réalisées ÷ visites prévues (une visite = site × mois, les visites se somment).

   Sans plan, on affiche « — aucun plan », jamais 0 %.
6. **Indicateurs** : un seul calcul sur toutes les soumissions de la plage (agrégation poolée), jamais une moyenne de moyennes mensuelles.
7. **Budget** :
   - planifié et réalisé = sommes des mois de la plage ;
   - **budget de la période** = part mensuelle du contrat, en centimes entiers avec le reste réparti sur les premiers mois, sommée sur les mois communs au contrat et à la plage.
8. **Écrans** : 13 écrans passent à la plage. 8 restent par nature sur « un mois » (plan du mois, RBM du mois, imports, facture…) ou sur « un exercice » (plan de suivi annuel) ; chaque cas est justifié plus bas.
9. **Performance — préalable obligatoire** : la plage multiplie les lignes lues. La requête « régions » coûte aujourd'hui **4,4 à 6 s pour 562 soumissions sous RLS** : la ligne « 3,4 s » du retour 52 vient de là. Réécrite sur des clés distinctes, elle passe à **3,3 ms avec une sortie identique**. Toutes les mesures se font sous le rôle `mems2_app` (RLS active), jamais en superutilisateur.

## 1. Inventaire

### 1.1 Endpoints qui prennent un mois ou une période

| # | Endpoint | Code | Aujourd'hui | Lot 1b |
|---|---|---|---|---|
| E1 | GET /api/monitoring/overview | monitoring.routes.js:424-426 → monitoring.repository.js:1418 `processOverview` | `month` ou `from`/`to` ; regex lâche `/^\d{4}-\d{2}/` qui accepte `2026-13` ; `from` seul accepté | `readPeriod` strict ; `period` dans la réponse ; tendance = `trendWindow` |
| E2 | GET /api/monitoring/coverage-dashboard | :438-440 → :1493 `coverageDashboard` | idem | idem, plus la requête régions réécrite (§4.4.2) |
| E3 | GET /api/monitoring/periods | :428-436 → periods.service.js:14 | mois par défaut | ajoute `default.from` et `default.to` (= le mois par défaut) |
| E4 | GET /api/monitoring/forms/:id/values | :261-264 → :1227 `computeValues` | `month` seul | plage |
| E5 | GET /api/monitoring/forms/:id/dashboard (Résultats) | :267-270 → :1247 `dashboard` | `month` seul | plage |
| E6 | POST /api/monitoring/forms/:id/indicators/preview | :124-140 (`monthParam`) → :377 `indicatorPreview` | `month`/`from`/`to`, sans contrôle d'ordre ni de durée | `periodSchema` |
| E7 | GET /api/monitoring/forms/:id/submissions | :373-377 → :592 `formSubmissions` | `month` ; comptage via `where.slice(0, month ? 3 : 2)` (:624) | plage ; paramètres du comptage reconstruits explicitement |
| E8 | GET /api/monitoring/submissions | :444-448 → :1667 `listSubmissions` | `month` | plage |
| E9 | GET /api/tpm/field/summary | field.routes.js:244 → field.repository.js:480 `summary` | `month` ; comptage des visites en JS (`fieldMath.summarizeVisits`) | plage ; faits site × mois en SQL ; sites distincts |
| E10 | GET /api/tpm/field/visits | :241-243 → :367 `listVisits` | `month` | plage (liste, 12 mois au plus) |
| E11 | GET /api/tpm/field/rbm/sites | :69-71 → :159 `rbmSites` | mois de référence | inchangé ; si `from`/`to` est fourni, le mois de référence est `to` (c'est un état) |
| E12 | GET /api/tpm/field/coverage-recap | :261-268 → :504 | aucune période : toutes les visites, 12 mois d'opération fixes | plage ; sites actifs sur la plage ; `operationMonths` = durée de la plage par défaut |
| E13 | GET /api/tpm/field/coverage-matrix | :270-273 → :533 | `year` | `year` ou plage (colonnes = mois de la plage) |
| E14 | GET /api/tpm/consolidation | consolidation.routes.js:13-19 → consolidation.repository.js:21 | `today` seulement (cumul du contrat) | ajoute la plage : budget, planifié et réalisé de la période |
| E15 | GET /api/alerts | alerts.routes.js:13 → alerts.service.js:23 | mois courant figé (`today.slice(0, 7)`) | plage facultative pour le terrain et les rapports ; la cloche reste inchangée |
| E16 | GET /api/tpm/reports | tpm/reports.routes.js:34-37 → reports.repository.js:108 | `month` non validé (`month.slice`) | plage, par chevauchement de `period_month`…`period_end` |
| E17 | GET /api/tpm/planning | planning.routes.js:40-47 → planning.repository.js:80 | `month` | plage |
| E18 | GET /api/pdd/distributions et /summary | pdd.routes.js:33-48 → pdd.repository.js:18 `distFilter` | `month` | plage ; la synthèse ajoute un « pic mensuel » |
| E19 | GET /api/pdd/pipeline | :51 → pdd.repository.js:64 | `month` (besoin et stock du même mois) | plage : besoin = somme ; stock = dernier stock ≤ `to` |
| E20 | Concepteur : render, export, documents | reportModel.js:116-125 | `{from,to}` sans plafond de durée | même `periodSchema` (60 mois au plus), coordonné avec 7a |

**Restent sur un mois, par nature :**

| Endpoint | Raison |
|---|---|
| POST /tpm/field/rbm/generate (field.routes.js:180-184) | génère le plan d'un mois |
| POST /tpm/field/import (:318) | feuille « Planning » d'un mois |
| PUT /tpm/field/months/status (:251-258) | cycle de vie du plan mensuel |
| GET/PUT /tpm/field/collection-days (:276-286) | jours budgétés d'un mois |
| POST/PATCH /tpm/field/visits | une visite = site × mois |
| GET /tpm/planning/prefill (planning.routes.js:50-55) | facture d'un mois |
| POST /tpm/reports | une facture couvre un mois |
| PUT /pdd/stock | stock saisi d'un mois |
| Paramétrage › taux de change (settings.routes.js:227) | taux d'un mois |

**Restent sur un exercice (année), par nature :** /tpm/field/months (:247, navigation par année) et /tpm/field/plan-board* (:73-122, grille P/R de 12 mois du classeur).

### 1.2 Écrans

| Écran | Fichier:ligne | Aujourd'hui | Lot 1b |
|---|---|---|---|
| Suivi de processus › Tableau de bord (Synthèse) | ProcessDashboardPage.jsx:29 `useDefaultMonth`, :37 appels, :80 `MonthSelect`, :83 bandeau, :96-104 KPI | un mois | **plage** |
| Dashboard › Couverture & performance (Synthèse, Activité, Salle de contrôle, Carte, Bulletin) | DashboardCoveragePage.jsx:49, :62, :86, :88 ; `ActivityView` :223 ; `Bulletin` :613 | un mois | **plage** ; la Carte reçoit la période (lot 6a) |
| Dashboard › Vue d'ensemble | DashboardBIPage.jsx:189-190 ; carte « mois courant » :270-288 | cumul, plus le mois courant | **plage** |
| Dashboard › Suivi budgétaire consolidé | ConsolidationPage.jsx:36 ; colonnes des mois :186 | aucune période | **plage** |
| Reporting › Rapport de synthèse | ReportingPage.jsx:20, :28, :56 | un mois, consolidation non filtrée | **plage** |
| Alertes › Centre d'alertes | AlertsPage.jsx:25 | mois courant implicite | **plage** (terrain et rapports) |
| Reporting › Concepteur | ReportDesignerPage.jsx:77 ; `PeriodPicker` :207-224 et :414 | deux `<input type=month>` | `PeriodSelect`, avec 7a |
| Fiche › Résultats, détail et éditeur d'indicateur | ProcessMonitoringPage.jsx:800-861 ; IndicatorsList.jsx:68, :245 ; IndicatorEditor.jsx:72, :105, :256 ; IndicatorExplain.jsx:131 | un mois ou « Toutes les périodes » | **plage**, « Toutes les périodes » conservé |
| Partenaires & TPM › Rapports & dépenses | ReportsPage.jsx:62, :91, :139, :185-192 | filtre sur un mois | **plage** pour le filtre ; le fil guidé reste sur un mois, celui de `to` |
| Distribution d'urgence › Distributions, Synthèse, Pipeline | PddPage.jsx:66-171, :420, :584-593 | tableau des mois + filtre mois / aucune période / un mois | **plage** |
| Suivi de processus › Couverture (récapitulatif et matrice) | CoverageRecapPage.jsx:59-69, :150-155 | aucune période / année | **plage** |
| Affectation & visites | FieldVisitsPage.jsx:48-127 | tableau des mois → plan du mois | **inchangé** : l'unité de travail est le mois (planifier, affecter, importer, soumettre, valider) |
| RBM & plan de suivi › RBM | RbmPage.jsx:43, :190 | mois de référence | **inchangé** : « à suivre » s'évalue à une date ; correctifs du lot 1 en cours sur ce fichier |
| RBM & plan de suivi › Plan de suivi | PlanBoardPage.jsx:39, :139-141 | exercice | **inchangé** : grille P/R annuelle, comme le classeur |
| Planification & budget (tiroir) | PlanBudgetDrawer.jsx:37 | un mois | **inchangé** (budget d'un mois) |

## 2. Modèle de période (contrat unique)

**Forme et lecture**
- **Forme** : `{ from: 'AAAA-MM', to: 'AAAA-MM' }`. `null` veut dire « toutes les périodes », seulement là où l'écran le propose (Résultats, Synthèse PDD, budget cumulé).
- **Lecture** (`parsePeriod`, zod), dans cet ordre :
  1. tout absent ou vide → `null`, ou `period_required` si la période est requise ;
  2. valeur qui n'est pas une chaîne (`?month=a&month=b`) → `period_format` ;
  3. `month` avec `from` ou `to` → `period_ambiguous` ;
  4. `from` sans `to`, ou l'inverse → `period_partial` ;
  5. format `AAAA-MM`, ou `AAAA-MM-JJ` tronqué au mois (l'ancien `?month=2026-07-15` passait) → sinon `period_format` avec le champ fautif ;
  6. année entre 2000 et 2100 → sinon `period_year` ;
  7. `from ≤ to` → sinon `period_order` ;
  8. durée de 60 mois au plus (`MAX_SPAN`, le même plafond que `consolidation.monthRange`) → sinon `period_span`.

**Bornes SQL : intervalle semi-ouvert** `col >= 'from-01' AND col < 'to+1-01'`.
- `monitoring_submissions.period_month`, `pdd_distributions.period_month` et `pdd_stock.period_month` n'ont pas de contrainte « jour = 1 » (seuls `site_visits`, `tpm_reports`, `tpm_collection_plans` et `tpm_collection_days` en ont une).
- Un `BETWEEN 'from-01' AND 'to-01'` perdrait donc une date du 15. Les données actuelles sont toutes au 1er du mois (vérifié), mais la borne semi-ouverte est sûre par construction.

**Fenêtre des tendances** : `trendWindow(period, todayMonth)` donne `{ from: min(period.from, to − 11), to }`.
- On garde le contexte de 12 mois du lot 1, étendu vers le passé quand la plage est plus longue. La plage choisie est surlignée dans le graphique.
- Sans période : 12 mois qui finissent au mois courant (comportement actuel).

**Libellés** (`periodLabel`), avec une parité testée entre le serveur et le web :
- forme longue, pour les rapports et les bandeaux : « Juillet 2026 », « Janvier à juin 2026 », « Année 2026 », « Octobre 2025 à mars 2026 » ; en anglais « January to June 2026 » ;
- forme courte, pour le bouton : « Janv. – juin 2026 », « Nov. 2025 – oct. 2026 ».

**Période par défaut** : inchangée, `common/period.defaultPeriod`. C'est le dernier mois substantiel qui a des données, sous forme de plage d'un mois (`from = to`), avec un bandeau qui le dit.

**Ordre de priorité à l'ouverture d'un écran** :
1. la période de l'URL (lien partagé) ;
2. la période de travail de la session (`sessionStorage['mems.period.v1']`) ;
3. la règle par défaut de l'écran.

Choix de persistance :
- Pas de `localStorage` pour les tableaux de bord : une période figée d'un mois sur l'autre contredirait la règle « dernier mois avec des données » du retour 16.
- Les listes qui ont déjà des vues enregistrées (Rapports, PDD) mettent la période dans la vue, en `localStorage` ou `sessionStorage` comme aujourd'hui.

## 3. Sémantique des chiffres sur une plage

| Chiffre | Règle sur `[from, to]` | Écrans |
|---|---|---|
| Soumissions, visites (total), montants, tonnages | **somme** des mois | tous |
| Sites suivis (données), agents, partenaires, bureaux, communes | `count(DISTINCT …)` sur toutes les lignes de la plage : **une fois chacun**. C'est déjà la forme des requêtes `processOverview` et `dashboard` ; la plage n'ajoute que le filtre | Synthèse, Résultats, Couverture & performance |
| **Sites actifs** | sites actifs **au moins un mois** de la plage (§3.1) | couverture partout |
| **Sites prévus** | sites distincts qui ont au moins une visite prévue (statut ≠ annulé) **pendant un mois actif** | terrain, récapitulatif, concepteur |
| **Sites réalisés** | sites distincts qui ont au moins une visite réalisée **pendant un mois actif**. Point d'extension du lot 4 : « réalisé » vaudra « données rattachées au site » ou « déclaré avec motif » | idem |
| Réalisé sur site inactif | sites distincts réalisés un mois où ils étaient inactifs : **affiché à part** (« hors périmètre actif »), jamais dans la couverture | idem |
| Couverture | sites réalisés ÷ sites actifs ; `null` (« — ») si aucun site actif | idem |
| Planification | sites prévus ÷ sites actifs ; `null` (« — aucun plan ») si aucun site prévu | idem |
| Exécution du plan | Σ visites réalisées ÷ Σ (prévues + réalisées) ; `null` (« — aucun plan ») si aucune visite. C'est le `rate` actuel, sommé sur les mois | idem, alertes |
| Indicateurs (% oui, % valeur, moyenne, somme, compte) | **un seul calcul** sur toutes les soumissions de la plage (`computeAll`), sans moyenne de taux mensuels : un mois maigre ne pèse pas autant qu'un mois plein. Classe = `classify`, inchangée. Les motifs « Non évalué » sont calculés sur l'effectif de la plage | Résultats, Synthèse, Couverture & performance, concepteur |
| Séries mensuelles (tendances, plan et réalisé par mois, complétude) | une valeur par mois, dans `trendWindow` ou dans la plage exacte (concepteur, consolidation) | partout |
| RBM « à jour » / « à suivre » | **état au mois `to`** : `rbmSites(month = to)`. Pied du KPI : « état au {to} » | Synthèse, Couverture & performance |
| Budget du contrat, restant, projection, mois restants | **cumul du contrat à date**, inchangé | consolidation, Vue d'ensemble |
| Budget de la période | part mensuelle × mois communs (§3.3) | consolidation, Vue d'ensemble, rapport de synthèse |
| Planifié, réalisé, en attente de validation | somme des mois de la plage | idem |
| Taux de consommation de la période | réalisé ÷ budget de la période ; `null` si le budget de la période est nul (plage hors contrat) | idem |
| PDD : bénéficiaires, ménages | **cumul sur la période** (somme des distributions) **et pic mensuel**. Il n'existe pas d'identifiant de personne : la somme compte des « bénéficiaires-distributions » ; le pic est la borne basse honnête des personnes atteintes. Les deux sont libellés | PDD Synthèse |
| PDD : stock disponible | niveau, **dernier stock saisi ≤ `to`**, jamais additionné ; besoin = somme | Pipeline |
| Rapports TPM | rapport retenu si `[period_month, COALESCE(period_end, period_month)]` **chevauche** la plage | Rapports & dépenses, alertes |

### 3.1 « Actif sur une plage » : choix retenu et alternatives

**Règle mensuelle**
- `actif(site, M)` = `NOT zone_interdite(site)` ET `COALESCE(dernier statut renseigné ≤ M, true)`.
- La grille `site_month_status` (migration 045 : « vide = non renseigné ; statut courant = dernier mois renseigné ») est remplie par le lot 3 (classeur d'activation). La zone interdite est `security_situation >= 99`.

**Règle sur la plage (option A, retenue)** : `actif(site, [from, to])` = il existe un mois M de la plage tel que `actif(site, M)`. Pourquoi :
1. C'est exactement « Unique sites Active » du rapport MMR de l'utilisateur (GD : 208 actifs sur janvier–juin ; 183 prévus, 170 réalisés, soit 88 % et 82 %).
2. Le numérateur est inclus dans le dénominateur par construction, puisqu'un réalisé ne compte que pendant un mois actif : plus jamais de « 407,7 % » (retour 18).
3. Sur un seul mois, on retrouve la définition mensuelle.
4. Le chiffre est monotone : élargir la plage n'enlève jamais un site.

**Alternatives écartées**

| Option | Règle | Pourquoi elle est écartée |
|---|---|---|
| B | actif tous les mois (intersection) | exclut les sites ouverts ou fermés en cours de plage ; leurs visites sortent du numérateur, le travail fait est sous-évalué |
| C | actif au dernier mois `to` (instantané) | un site fermé en mars mais visité en février disparaît ; un site ouvert en juin compterait sur six mois |
| D | sites-mois : Σ sites-mois réalisés ÷ Σ sites-mois actifs | répond à une autre question (l'intensité du suivi, une couverture mensuelle moyenne) |

L'option D reste visible sans nouveau chiffre : la série mensuelle de la couverture (`monthly[].sitesActive`, `sitesRealised`) donne chaque couverture mensuelle.

**Limite connue de A** : sur une très longue plage, un site actif un seul mois pèse autant qu'un site actif douze mois. La conformité MMR (nombre de visites dues selon le risque) reste portée par le récapitulatif de couverture, qui calcule désormais `operationMonths` sur la plage (§4.4.5), et sera affinée au lot 4/5 en mois actifs par site.

**Sémantique vérifiée sur des statuts simulés** (`scratchpad/prof/active_semantics.sql`) :

| Site | Statuts simulés | Janvier–juin 2026 |
|---|---|---|
| A | inactif dès mars | `OO....` |
| B | inactif depuis novembre 2025, réactivé en mai | `....OO` |
| C | inactif toute la plage | `......` |
| D | zone interdite | `......` |
| E | statut renseigné après la plage (ignoré) | `OOOOOO` |

### 3.2 Exemple de référence (tests)

Fixture « GD janvier–juin » : 208 sites actifs au moins un mois, 183 prévus pendant un mois actif, 170 réalisés pendant un mois actif, plus 2 visites sur des sites inactifs.

Attendu : `sites = { active: 208, planned: 183, realised: 170, realisedInactive: 2 }`, `planning = 0,880`, `coverage = 0,817`. L'affichage arrondi donne 88 % et 82 %.

### 3.3 Budget d'une période (pur, en centimes entiers)

`monthlyBudgetCents(totalCents, contractMonths)` :
- `base = floor(total / n)`, `reste = total − base·n` ;
- le mois d'indice `i` (de 0 à n−1) reçoit `base + (i < reste ? 1 : 0)` ;
- la somme sur tout le contrat vaut exactement le budget. Exemple : 1 000,00 Ar sur 3 mois → 333,34 + 333,33 + 333,33.

Les mois du contrat sont `monthRange(dateDebut, dateFin)`, mois partiels compris (la même règle que `contracts.domain.monthsBetween`). Le budget de la période est la somme des parts des mois communs ; sans dates, `null`, signalé « période du contrat inconnue ».

## 4. Serveur

### 4.1 Modules purs (sans I/O, testés)

**`server/src/modules/common/period.js`** (extension ; `defaultPeriod`, `isMonth`, `addMonths` et `median` sont gardés tels quels) :

```js
const MAX_SPAN = 60;
const monthIndex = (m) => /* y*12 + mm-1 */;
const spanMonths = ({ from, to }) => monthIndex(to) - monthIndex(from) + 1;
function monthsOf(p) {}                    // ['2026-01', …, '2026-06'] (plafond MAX_SPAN)
const single = (m) => ({ from: m, to: m });
function periodBounds(p) {}                // { lo: '2026-01-01', hiExcl: '2026-07-01', hi: '2026-06-01' }
function trendWindow(p, todayMonth, min = 12) {}
function overlaps(p, start, end) {}        // jumeau pur de spanOverlaps (filtres côté JS)
const periodQuerySchema = z.object({ month, from, to }).passthrough().superRefine(...) // issues { params: { code } }
function parsePeriod(src, { required = false, maxSpan = MAX_SPAN } = {}) {}
  // → { ok: true, period: { from, to } | null } | { ok: false, code, message, details }
function toPeriod(legacy) {}               // { month } | { from, to } | null → { from, to } | null (appels internes)
function periodLabel(p, lang = 'fr', { short = false } = {}) {} // déplacé de reportModel.js:150 (réexporté là-bas)
const periodSchema = z.object({ from: monthStr, to: monthStr }).superRefine(/* ordre, années, durée */);
```

Messages, en français, avec un code dans `details.code` :

| Code | Message |
|---|---|
| `period_format` | « Période invalide : mois attendu au format AAAA-MM (ex. 2026-01). » |
| `period_partial` | « Période incomplète : précisez le début (from) et la fin (to). » |
| `period_ambiguous` | « Période ambiguë : utilisez soit month, soit from et to. » |
| `period_order` | « Période invalide : le début (2026-06) est après la fin (2026-01). » |
| `period_span` | « Période trop longue : 60 mois au plus (demandé : 72). » |
| `period_year` | « Période hors limites : années 2000 à 2100. » |
| `period_required` | « Période requise. » |

**`server/src/modules/common/siteActivity.js`** (nouveau ; jumeau pur de la requête SQL, pour figer la sémantique) :
- `activeAt(statuses, month, { forbidden })` ;
- `siteRangeFacts({ statuses, forbidden, visits }, period)` → `{ active, planned, realised, realisedInactive, planifie, realise, annule }` ;
- `ratesOf({ sitesActive, sitesPlanned, sitesRealised, planifie, realise })` → `{ coverage, planning, execution }`, avec `null` quand le dénominateur vaut 0.

`ratesOf` est **l'unique endroit** de la règle « — aucun plan ». Le dépôt l'applique aux comptes SQL.

**`server/src/modules/tpm/fieldMath.js`** : ajoute `shapeRangeSummary(groupRows, providerRows)` (forme décrite en §4.5). `summarizeVisits` est gardé : tests existants, et parité sur un mois.

**`server/src/modules/tpm/consolidation.js`** : `monthlyBudgetCents` (§3.3). `buildConsolidation(contracts, monthly, { today, period })` :
- **sans `period`, sortie identique à aujourd'hui** (les tests existants le verrouillent) ;
- avec `period` :
  - `months` = mois de la plage ;
  - `monthlyTotals` limité à la plage ;
  - `row.period = { months, budget, planned, actual, pending, plannedRate, actualRate, planVsActual }`, avec des taux à `null` quand la base est nulle ;
  - `totals.period` avec les taux recalculés sur les sommes en centimes.

**`server/src/modules/pdd/pddMath.js`** : `peakMonth(byMonth)` → `{ month, beneficiaries, households }`. `latestStock` est inchangé ; le dépôt lui passe les stocks ≤ `to`.

**`server/src/modules/monitoring/indicatorKeys.js`** (nouveau) : `indicatorKeys(indicators, calcDefs)` → clés en minuscules = `sourceField` des indicateurs actifs, plus `calcReferences(defs)` si une source est un champ calculé. C'est la même règle que l'aperçu (monitoring.repository.js:383-389).

### 4.2 Bord HTTP

`server/src/middleware/period.js` (nouveau) :

```js
const { parsePeriod } = require('../modules/common/period');
const { badRequest } = require('./errors');
function readPeriod(src, opts) {
  const r = parsePeriod(src, opts);
  if (!r.ok) throw badRequest(r.message, { code: r.code, ...r.details });
  return r.period;
}
```

On n'importe pas `errors.js` dans le module pur, parce que `errors.js` charge `db/schemaStatus`.

Les helpers lâches sont remplacés par `readPeriod(req.query)` : `ym` et `periodQuery` (monitoring.routes.js:424-425), `monthQ` (field.routes.js:31, pdd.routes.js:33), `monthParam` (monitoring.routes.js:124). E6 passe `readPeriod(req.valid)` sur le corps.

### 4.3 Prédicats SQL (`server/src/modules/common/periodSql.js`, nouveau)

C'est un constructeur de fragments, comme `tpm/sitePatch.js` et `db/batch.js`. Seuls les dépôts l'utilisent.

```js
function monthWithin(col, period, params) {        // 'TRUE' sans période
  if (!period) return 'TRUE';
  const { lo, hiExcl } = periodBounds(period);
  params.push(lo, hiExcl);
  return `${col} >= $${params.length - 1}::date AND ${col} < $${params.length}::date`;
}
function spanOverlaps(startCol, endCol, period, params) {
  // `${startCol} < $hiExcl::date AND COALESCE(${endCol}, ${startCol}) >= $lo::date`
}
function monthSeries(period, params) {}           // generate_series($lo::date, $hi::date, interval '1 month')
```

`server/src/modules/common/siteActivitySql.js` (nouveau) : `siteMonthFactsCtes({ t, lo, hi, office: 'site' | 'bureau', district })` renvoie la liste de CTE du §4.4.3. Le même fragment sert à `summary`, `reportFieldData`, `coverageRecapSummary` et au lot 6a (carte).

### 4.4 Requêtes modifiées

Toutes restent dans un seul `withTenantTransaction`, avec des `await` successifs, et filtrent `tenant_id = $1` dans **chaque** CTE (`sites`, `site_month_status`, `site_visits`, `field_offices`, `admin_areas`).

#### 4.4.1 Soumissions (monitoring.repository.js)

- **`submissionFilter`** (:1294-1304) : signature gardée, `periodLike` normalisé par `toPeriod`. Les appelants actuels (rapports, `{ from, to }`) restent compatibles.

  ```js
  function submissionFilter(alias, periodLike = {}, params) {
    const a = alias ? `${alias}.` : '';
    const parts = [`NOT ${a}excluded`];
    if (periodLike.bureau) { /* inchangé */ }
    const p = toPeriod(periodLike);
    if (p) parts.push(monthWithin(`${a}period_month`, p, params));
    return ` AND ${parts.join(' AND ')}`;
  }
  ```

- **`monthlyTrend`** (:1403-1416) : `$2` et `$3` = `trendWindow(period, moisCourantUTC)`. Le regroupement se fait par `date_trunc('month', s.period_month)::date`, on joint ensuite `generate_series($2::date, $3::date, interval '1 month')`, et le filtre du sous-select est `monthWithin`.
- **`computeValues`** (:1227) et **`dashboard`** (:1247) : `{ period }`, filtre via `submissionFilter`, `period` ajouté à la réponse.
- **`formSubmissions`** (:592-627) et **`listSubmissions`** (:1667) : `monthWithin`. La requête de comptage (:620-626) reçoit ses propres paramètres (`[tenantId, formId]` + le filtre) au lieu du `slice` positionnel, qui casserait avec les 2 paramètres de la plage.
- **`processOverview`** (:1418) et **`coverageDashboard`** (:1493) : réponse `period: { from, to, months } | null`. Champs hérités gardés : `month` vaut `from` si la plage fait un mois, sinon `null` ; `from` et `to` restent.

#### 4.4.2 Régions — préalable de performance (C2)

**Remplace** `REGION_CTE`, `REGION_JOIN` et `REGION_OF` (monitoring.repository.js:573-584), utilisés par `coverageDashboard` (:1508-1517) et `reportMonitoringData` (:1647-1653).

**Cause mesurée** :
- sous RLS, le prédicat `current_setting()` rend les estimations fausses d'un facteur environ 200 (3 lignes estimées pour 562 réelles) ;
- le planificateur choisit alors une « Nested Loop Left Join » sur `CTE Scan pcode_region` : 19 370 lignes × 562 boucles, deux fois ;
- résultat : 6 043 ms sous `mems2_app`, contre 59 ms en superutilisateur pour la même requête.

**Nouvelle requête** (builder `regionRowsSql(filterSql)`) : on agrège d'abord, puis on résout chaque clé distincte par un index (`uq_admin_areas_pcode (tenant_id, pcode)`, `admin_areas_pkey`, `idx_sites_adm3_pcode`) :

```sql
WITH g AS MATERIALIZED (
  SELECT COALESCE(s.adm3_pcode, s.admin3) AS pc, upper(btrim(s.admin1)) AS a1,
         NULLIF(s.admin1, '') AS raw1, NULLIF(s.admin3, '') AS commune, count(*)::int AS n
    FROM monitoring_submissions s
   WHERE s.tenant_id = $1 ${filtre}
   GROUP BY 1, 2, 3, 4),
k AS MATERIALIZED (SELECT pc AS key FROM g WHERE pc IS NOT NULL UNION SELECT a1 FROM g WHERE a1 IS NOT NULL),
pr AS MATERIALIZED (
  SELECT k.key AS pcode, COALESCE(
    (SELECT r.name FROM admin_areas c JOIN admin_areas r ON r.id = c.lineage[1] AND r.tenant_id = c.tenant_id
      WHERE c.tenant_id = $1 AND c.pcode = k.key AND cardinality(c.lineage) >= 1 LIMIT 1),
    (SELECT r.name FROM admin_areas r WHERE r.tenant_id = $1 AND r.depth = 1 AND r.pcode = k.key LIMIT 1),
    (SELECT st.adm1 FROM sites st WHERE st.tenant_id = $1 AND st.adm3_pcode = k.key
        AND NULLIF(st.adm1, '') IS NOT NULL ORDER BY st.adm1 LIMIT 1)) AS region
    FROM k)
SELECT COALESCE(p3.region, p1.region, g.raw1, '(non renseigné)') AS region,
       sum(g.n)::int AS submissions, count(DISTINCT g.commune)::int AS communes
  FROM g LEFT JOIN pr p3 ON p3.pcode = g.pc LEFT JOIN pr p1 ON p1.pcode = g.a1
 GROUP BY 1 ORDER BY submissions DESC, 1;
```

**Résultats** : 3,3 ms sous RLS, sortie identique sur la base de démonstration (7 régions : Atsimo Andrefana 227/24, Androy 202/17, (non renseigné) 46/1, Vatovavy 38/9, Atsimo Atsinanana 30/13, Anosy 18/6, Fitovinany 1/1).

**Précédence identique à l'ancienne requête** :
1. zone du découpage ;
2. région de niveau 1 ;
3. sinon `sites.adm1`, désormais déterministe (`ORDER BY adm1`) alors que l'ancien `DISTINCT ON` choisissait arbitrairement.

#### 4.4.3 Faits site × mois — terrain (C5)

`siteMonthFactsCtes`, puis l'agrégat de `summary` (field.repository.js:480), en une seule requête :

```sql
WITH months AS (SELECT m::date AS m FROM generate_series($2::date, $3::date, interval '1 month') AS m),
reg AS MATERIALIZED (            -- une ligne par site, dimensions + historique d'activation (UNE lecture d'index par site)
  SELECT s.id, COALESCE(fo.name, '—') AS office,
         COALESCE(NULLIF(btrim(s.adm2), ''), NULLIF(btrim(s.district), ''), '—') AS district,
         COALESCE(NULLIF(btrim(s.activity), ''), '—') AS activity, s.risk_level AS risk,
         COALESCE(s.security_situation, 0) >= 99 AS forbidden, h.ms IS NOT NULL AS has_status, h.ms, h.av
    FROM sites s
    LEFT JOIN field_offices fo ON fo.id = s.field_office_id AND fo.tenant_id = s.tenant_id
    LEFT JOIN LATERAL (
      SELECT array_agg(make_date(x.year, x.month, 1) ORDER BY x.year, x.month) AS ms,
             array_agg(x.active ORDER BY x.year, x.month) AS av
        FROM site_month_status x                       -- PK (site_id, year, month)
       WHERE x.tenant_id = $1 AND x.site_id = s.id AND make_date(x.year, x.month, 1) <= $3::date) h ON true
   WHERE s.tenant_id = $1),
act AS (                         -- statut en vigueur : dernier renseigné ≤ M, sinon actif ; zone interdite jamais active
  SELECT r.id AS site_id, r.office, r.district, r.activity, r.risk, r.has_status, mm.m,
         NOT r.forbidden AND COALESCE((SELECT r.av[k] FROM generate_subscripts(r.ms, 1) AS k
                                        WHERE r.ms[k] <= mm.m ORDER BY k DESC LIMIT 1), true) AS active
    FROM reg r CROSS JOIN months mm),
vis AS (                         -- ⚑ point d'extension du lot 4 (réalisé = données au site ou déclaré avec motif)
  SELECT v.site_id, date_trunc('month', v.period_month)::date AS m,
         count(*) FILTER (WHERE v.status = 'planifie')::int AS planifie,
         count(*) FILTER (WHERE v.status = 'realise')::int AS realise,
         count(*) FILTER (WHERE v.status = 'annule')::int AS annule
    FROM site_visits v
   WHERE v.tenant_id = $1 AND v.period_month >= $2::date AND v.period_month < ($3::date + interval '1 month')
   GROUP BY 1, 2),
fact AS (
  SELECT a.*, COALESCE(v.planifie, 0) AS planifie, COALESCE(v.realise, 0) AS realise, COALESCE(v.annule, 0) AS annule
    FROM act a LEFT JOIN vis v ON v.site_id = a.site_id AND v.m = a.m),
per_site AS (
  SELECT site_id, min(office) AS office, min(district) AS district, min(activity) AS activity, min(risk) AS risk,
         bool_or(has_status) AS has_status, bool_or(active) AS active,
         bool_or(active AND planifie + realise > 0) AS planned, bool_or(active AND realise > 0) AS realised,
         bool_or(NOT active AND realise > 0) AS realised_inactive,
         sum(planifie)::int AS planifie, sum(realise)::int AS realise, sum(annule)::int AS annule,
         (sum(realise) FILTER (WHERE active))::int AS realise_active
    FROM fact GROUP BY site_id)
SELECT CASE WHEN GROUPING(office) = 0 THEN 'office' WHEN GROUPING(district) = 0 THEN 'district'
            WHEN GROUPING(activity) = 0 THEN 'activity' ELSE 'overall' END AS dim,
       COALESCE(office, district, activity) AS key,
       count(*) FILTER (WHERE active)::int AS "sitesActive", count(*) FILTER (WHERE planned)::int AS "sitesPlanned",
       count(*) FILTER (WHERE realised)::int AS "sitesRealised",
       count(*) FILTER (WHERE realised_inactive)::int AS "sitesRealisedInactive",
       count(*) FILTER (WHERE has_status)::int AS "sitesWithStatus",
       sum(planifie)::int AS planifie, sum(realise)::int AS realise, sum(annule)::int AS annule
  FROM per_site GROUP BY GROUPING SETS ((), (office), (district), (activity))
UNION ALL
SELECT 'month', to_char(m, 'YYYY-MM'), count(*) FILTER (WHERE active)::int,
       count(*) FILTER (WHERE active AND planifie + realise > 0)::int, count(*) FILTER (WHERE active AND realise > 0)::int,
       count(*) FILTER (WHERE NOT active AND realise > 0)::int, NULL, sum(planifie)::int, sum(realise)::int, sum(annule)::int
  FROM fact GROUP BY m;
```

Seconde requête, pour les prestataires (une visite porte le prestataire, pas le site) :

```sql
SELECT COALESCE(v.provider_id::text, 'non_affecte') AS key, min(p.name) AS label,
       count(*) FILTER (WHERE v.status = 'planifie')::int AS planifie, count(*) FILTER (WHERE v.status = 'realise')::int AS realise,
       count(*) FILTER (WHERE v.status = 'annule')::int AS annule,
       count(DISTINCT v.site_id) FILTER (WHERE v.status <> 'annule')::int AS "sitesPlanned",
       count(DISTINCT v.site_id) FILTER (WHERE v.status = 'realise')::int AS "sitesRealised"
  FROM site_visits v LEFT JOIN partners p ON p.id = v.provider_id AND p.tenant_id = v.tenant_id
 WHERE v.tenant_id = $1 AND v.period_month >= $2::date AND v.period_month < $3::date
 GROUP BY 1;
```

**Garde-fous de plan** (estimations faussées par la RLS) :
- `reg` est matérialisé et porte ses dimensions, si bien qu'on ne joint jamais deux gros CTE en retour ;
- l'historique d'activation est lu par **une** lecture d'index par site, puis consulté en mémoire (tableaux) ;
- une seule jointure entre deux CTE : `act ⋈ vis` sur une égalité.

Le prototype tourne en 42 à 65 ms sous RLS (1 280 sites × 12 mois) ; le plan utilise un Merge Left Join pour `act ⋈ vis`. Si la garde EXPLAIN (§7) voit une boucle imbriquée sur `vis` à volume de référence, `vis` devient une lecture LATERAL sur l'index unique `site_visits (tenant_id, site_id, period_month, activity)`.

**Changements visibles, voulus et documentés** :
- `byActivity` prend l'**activité du site**, pas celle de la visite : sur la base de démonstration, 108 visites sur 156 n'ont pas d'activité alors que leur site en a une ;
- `byDistrict` prend `COALESCE(adm2, district)` normalisé : les doublons de casse du retour 15 disparaissent ;
- `byOffice` garde l'antenne ou le bureau propre du site (`fo.name`, comme aujourd'hui).

`reportFieldData` (:699-726) utilise le même fragment avec `office: 'bureau'` (`COALESCE(par.name, fo.name, '(non rattaché)')`). Il garde ses noms de colonnes, lus par `reportData.js` (`bureau_coverage`, `plan_vs_actual`) :
- `sitesActive` = actifs sur la plage, et non plus tout le registre ;
- `sitesVisited` = réalisés pendant un mois actif.

Coordonné avec 7a.

#### 4.4.4 Visites et matrice

- `listVisits` (:367) : `monthWithin('v.period_month')` ; la route refuse une plage de plus de 12 mois (`maxSpan: 12`), car il s'agit d'une liste.
- `coverageMatrix` (:533) : `?year=` garde son comportement, `?from&to` prend les mois de la plage. `buildCoverageMatrix(rows, yearOrMonths)` accepte un tableau de mois (rétrocompatible avec une année).

#### 4.4.5 Récapitulatif de couverture (:504-530)

- Même fragment, filtre district dans `reg`. On envoie à `coverageRecap` (pur, inchangé) les lignes `SELECT risk AS "riskLevel", realise_active AS "visitCount" FROM per_site WHERE active`.
- `operationMonths` = `spanMonths(period)` si une plage est donnée, sinon 12 (comportement actuel). Sans période, toutes les visites comptent, comme aujourd'hui.
- La réponse ajoute `period`.

#### 4.4.6 Consolidation

Le SQL est inchangé : les flux sont déjà groupés par mois, et le cumul du contrat a besoin de tous les mois. La plage est appliquée en pur dans `buildConsolidation` ; les montants en attente de la période sont sommés depuis `actualRows`. La route lit `readPeriod(req.query)` (facultatif) et garde `today`.

#### 4.4.7 Rapports TPM, planification, PDD

| Fonction | Changement |
|---|---|
| `listReports` (reports.repository.js:108) | `spanOverlaps('r.period_month', 'r.period_end', period, params)` |
| `listPlans` (planning.repository.js:80) | `monthWithin('p.period_month', …)` ; `listQuery` (planning.routes.js:41) remplacé par `readPeriod` + `contractId` |
| `distFilter` (pdd.repository.js:18) | `monthWithin('d.period_month', …)` |
| `summaryData` | ajoute `peak` |
| `pipelineData` (:64) | besoin filtré par `monthWithin` ; stock filtré par `period_month < hiExcl` puis `latestStock` → « stock au {stockMonth} » |

#### 4.4.8 Alertes (après la fusion des correctifs du lot 1)

`alerts(auth, { today, period })` :
- `period` par défaut = le mois de `today`, donc la cloche reste identique ;
- terrain = `summary({ period })` ;
- rapports à valider filtrés par `overlaps` **seulement si une période est passée** (sans paramètre : tous, comme aujourd'hui) ;
- budget et contrats « à date », avec le marqueur `scope: 'a_date'` ;
- titres : « Couverture terrain faible sur la période » quand la plage dépasse un mois.

### 4.5 Contrats d'API (ajouts ; les anciens champs sont conservés)

`GET /api/tpm/field/summary?from=2026-01&to=2026-06` (ou `?month=2026-07`) :

```json
{ "period": { "from": "2026-01", "to": "2026-06", "months": 6 }, "activationKnown": true,
  "overall": { "planifie": 40, "realise": 412, "annule": 6, "total": 458, "active": 452, "rate": 0.9115,
    "sites": { "active": 208, "planned": 183, "realised": 170, "realisedInactive": 2 },
    "coverage": 0.817, "planning": 0.88, "execution": 0.9115 },
  "byOffice": [{ "key": "Bureau Fort Dauphin", "label": "Bureau Fort Dauphin", "...": "même forme" }],
  "byDistrict": [], "byActivity": [],
  "byProvider": [{ "key": "…", "label": "…", "planifie": 0, "realise": 0, "annule": 0, "rate": 0, "sites": { "planned": 0, "realised": 0 } }],
  "monthly": [{ "month": "2026-01", "sitesActive": 205, "sitesPlanned": 60, "sitesRealised": 51, "planifie": 9, "realise": 58, "annule": 1 }] }
```

- `total`, `active` (visites prévues + réalisées) et `rate` gardent leur sens actuel, et `alertsMath.fieldAlerts` continue de les lire.
- `execution` = `rate`, sauf qu'il vaut `null` sans plan.
- `activationKnown` = `sitesWithStatus > 0`. S'il est faux, les sites actifs sont « tout le registre ».

`GET /api/monitoring/overview|coverage-dashboard|forms/:id/dashboard` : ajoutent `period: { from, to, months } | null` ; `trend` couvre `trendWindow`.

`POST …/indicators/preview` : le corps accepte `{ from, to }` ou `{ month }` ; la réponse renvoie `period: { from, to, month }`, `month` étant hérité et égal à `from` si la plage fait un mois.

`GET /api/monitoring/periods` : `default` gagne `from` et `to`.

`GET /api/tpm/consolidation?from=2026-01&to=2026-06[&today=2026-10]` :
- `rows[].period = { months: 6, budget, planned, actual, pending, plannedRate, actualRate, planVsActual }` ;
- `totals.period` ;
- `months` = mois de la plage ;
- écho `period`.

`GET /api/alerts?from&to` : `period`, et `items[].scope` vaut `'periode'` ou `'a_date'`.

`GET /api/pdd/summary?from&to&hazard&region&district` : ajoute `peak` et `period`. `GET /api/pdd/pipeline?from&to` : `stockMonth` par denrée.

`GET /api/tpm/field/rbm/sites?from&to` : mois de référence = `to` ; la réponse est inchangée.

### 4.6 Index

Aucun index nouveau n'est requis pour le lot :
- `site_visits (tenant_id, period_month)`, `pdd_distributions (tenant_id, period_month)`, `tpm_reports (tenant_id, contract_id, period_month)` et `(tenant_id, partner_id, period_month)` existent ;
- `monitoring_submissions (tenant_id, form_id, period_month)` sert les requêtes par fiche ;
- `site_month_status` a sa PK `(site_id, year, month)` ; `admin_areas` a `(tenant_id, pcode)`.

Seul candidat, conditionné à la mesure : `monitoring_submissions (tenant_id, period_month) WHERE NOT excluded`, pour les agrégats tous formulaires confondus (totaux, régions, tendance), si le banc (§7) montre un parcours séquentiel au-delà du budget à 30 000 soumissions. Il faudrait alors un numéro de migration négocié avec 6a et 7a (après le dernier de 7a). Il n'est pas créé d'avance.

## 5. Web

### 5.1 `web/src/lib/period.js` (ESM pur, testé depuis `server/test/webPeriod.test.js` comme `webCharts.test.js`)

`MAX_SPAN`, `isMonth`, `addMonths`, `monthIndex`, `spanMonths`, `monthsOf`, `normalize` (inverse si `from > to`), `periodLabel(p, lang, { short })` (forme longue en parité avec le serveur), `presets(today, latest)`, `presetOf(period, list)`, `readHashPeriod(hash)`, `writeHashPeriod(hash, p)`, `periodQuery(p)`, `readSessionPeriod(storage)` et `writeSessionPeriod(storage, p)` (avec `try/catch`), `summarizeCounts(p, counts)` → `{ months, submissions, emptyMonths }`.

**Préréglages**, calculés avec T = mois courant et L = dernier mois avec des données ; aucun ne dépasse T :

| Identifiant | Libellé | Plage |
|---|---|---|
| `latest` | « Dernier mois avec des données » | {L, L}, montré si L ≠ T |
| `this_month` | « Ce mois-ci » | {T, T} |
| `last_month` | « Mois dernier » | {T−1, T−1} |
| `this_quarter` | « Trimestre en cours » (indication « T4 2026 ») | du début du trimestre à T |
| `this_half` | « Semestre en cours » (« S2 2026 ») | du début du semestre à T |
| `jan_jun` | « Janvier – juin {Y} » | {Y-01, Y-06}, avec Y = l'année de T si T ≥ juillet, sinon l'année précédente |
| `ytd` | « Année en cours » | {janvier de T, T} |
| `last_12` | « 12 derniers mois » | {T−11, T} |

### 5.2 `web/src/components/PeriodSelect.jsx`

Maquette : `scratchpad/design/1b/period-select-mock.png` (bureau) ; l'existant est dans `processus_synthese.png` et `dashboard_couverture.png`.

**Propriétés**
- `value` : `{from,to} | null` ; `onChange(period | null, { preset })` ;
- `counts` : `{ 'AAAA-MM': n }` ; `today` ; `latest` ;
- `allowAll` ; `presets` (liste d'identifiants) ; `maxSpan = 60` ; `forward = 3` ;
- `align` ; `ariaLabel` ; `compact` (barre de filtres).

**Anatomie**
- **Bouton** `.btn.btn-secondary.period-trigger` : 38 px de haut, rayon 9.
  - icône lucide `CalendarRange` 16 px, puis le libellé court (Inter tabulaire) ;
  - suffixe atténué « · 6 mois » pour une plage, puis `ChevronDown`.
- **Fenêtre** `.pop-menu.period-pop` : largeur 580, rayon 14, `--shadow-lg`, deux colonnes.
  - **Préréglages** : boutons-pilules `aria-pressed`. L'actif est en `--blue-50` avec texte `--blue-600` (le style « pill » de la navigation). L'indication est à droite, en `--text-faint` tabulaire. Un clic applique la période et ferme la fenêtre.
  - **Personnalisée** : deux `.select` natifs « Du » / « Au ». Les mois vont du plus récent au plus ancien, avec le volume (« Juillet 2026 · 74 ») ; les mois vides sont en `month-empty`, avec « — ».
  - **Mini-histogramme** de 12 barres (`counts`) qui finit à `to` : les barres de la plage sont en `--blue-600`, les autres en `--border`. Un mois vide de la plage est hachuré orange **et** compté en texte, pour ne pas reposer sur la seule couleur.
  - **Ligne de synthèse** : « 6 mois · 224 formulaires reçus · 1 mois sans données ».
  - **Pied** en `--surface-2` : « Annuler » (ghost) et « Appliquer » (primary, désactivé au-delà de 60 mois, avec un `field-error` « 60 mois au plus »). Si « Du » dépasse « Au », l'autre borne suit : l'état n'est jamais invalide.

**Accessibilité**
- Bouton : `aria-haspopup="dialog"` et `aria-expanded`. Fenêtre : `role="dialog"`, `aria-label="Choisir la période"`.
- À l'ouverture, le focus va sur le préréglage actif ; Échap ferme (`usePopover`) et rend le focus au bouton.

**Écran étroit** (640 px et moins) : fenêtre fixe sur toute la largeur (marges de 16 px), colonnes empilées, préréglages en grille de deux pilules.

**Thème** : uniquement des jetons, donc le thème sombre suit.

**CSS** : ajoutée **à la fin** du bloc v6 de `web/src/styles.css`, avec `.period-trigger`, `.period-pop`, `.period-presets`, `.period-preset`, `.period-custom`, `.period-strip`, `.period-sum`.

### 5.3 `usePeriod()` (dans `components/PeriodBanner.jsx`)

`usePeriod({ scope = 'analysis', defaultRule = 'data' | 'current' | 'all', urlSync = true })` renvoie `{ period, auto, periods, counts, latest, source, setPeriod }`.

- Ordre de priorité : URL, puis session (portée `analysis`), puis règle par défaut (`data` = `GET /monitoring/periods` → `default`).
- `setPeriod` met à jour l'état, l'URL (`history.replaceState` sur `#/…?from=…&to=…`, sans `hashchange`) et la session.
- `auto` (le bandeau) n'est rempli que si `source === 'default'` et que le défaut diffère du mois courant.
- Quand la période vient de la session, une petite mention « période conservée de la session » propose « Revenir au dernier mois avec des données ».
- `useDefaultMonth` reste disponible pendant la migration, puis est retiré en C10.

`App.jsx` :
- `parseHash` (:47-52) lit `window.location.hash.split('?')[0]` avant `split('/')`. Aujourd'hui, `#/dashboard/couverture?from=…` retomberait sur `DEFAULT_ROUTE`.
- `navigate` (:73-78) laisse tomber la requête.
- `handleLogout` (:90-93) efface `mems.period.v1`.

### 5.4 Client, listes et écrans

**`api/client.js`** : helper `pq(p)` — un objet donne `{ from, to }`, une chaîne donne `{ month }` (anciens appelants). Il s'applique à `monOverview`, `monCoverageDashboard`, `monDashboard`, `monValues`, `monFormSubmissions`, `monSubmissions`, `fieldSummary`, `fieldVisits`, `fieldCoverageRecap`, `fieldCoverageMatrix`, `consolidation({ today, period })` (l'ancienne chaîne `today` reste acceptée), `alerts(period)`, `listReports`, `listPlans`, `pddSummary`, `pddDistributions` et `pddPipeline` (:304-320, :387-407, :462-467, :512-514). `monIndicatorPreview` envoie `{ from, to }`.

**`components/DataList.jsx`** : nouveau filtre `type: 'period'` (bouton compact + `PeriodSelect`, `match` par chevauchement). La période est stockée dans la vue enregistrée comme les autres filtres. À la lecture, une ancienne valeur `'AAAA-MM'` devient `{ from: v, to: v }`.

**Écrans :**

| Écran | Défaut | Changements |
|---|---|---|
| Synthèse (ProcessDashboardPage) | `data` | `usePeriod` ; appels `monOverview(p)`, `fieldSummary(p)`, `rbmSites(p.to)`. KPI « **Couverture (sites)** » = `coverage`, pied « {r} / {a} sites actifs · distincts sur la période », et si `!activationKnown`, la mention « sites actifs : tout le registre (aucune grille d'activation) ». KPI « **Exécution du plan** » = `execution` ou « — aucun plan », pied « {done} / {planned} visites prévues ». « Sites à jour » : pied « état au {to} ». « Données reçues » : « … · {n} mois ». Bandeau « Aucune donnée reçue sur la période ({p}). Dernières données : {last}. [Voir {last}] ». `TrendChart selected={period}` (bande surlignée, après les correctifs du lot 1) |
| Couverture & performance | `data` | idem ; `ActivityView` et `Bulletin` reçoivent `period` ; la Carte reçoit `period` (lot 6a) |
| Vue d'ensemble (DashboardBIPage) | session, sinon `all` (cumul actuel) | KPI de la période (« Budget de la période », planifié, réalisé, taux), restant et projection « à date » ; tendance = mois de la plage ; carte « Couverture terrain — {période} » |
| Suivi budgétaire consolidé | session, sinon `all` | colonnes « Période » (budget, planifié, réalisé, taux) à côté du cumul ; matrice limitée aux mois de la plage ; noms de CSV `…_{from}_{to}.csv` |
| Rapport de synthèse (ReportingPage) | `data` | consolidation et terrain sur la plage ; CSV nommés par plage (après les correctifs du lot 1) |
| Centre d'alertes | `current`, URL seulement, sans la période de session | `PeriodSelect` « Période (terrain et rapports) » ; mention « Les alertes budgétaires et d'échéance sont calculées à date. » ; la cloche (HeaderMenus.jsx:44) est inchangée |
| Fiche › Résultats | URL, session, puis dernier mois de la fiche, avec `allowAll` | `PeriodSelect allowAll counts={formMonths}` ; `monDashboard(id, p)` ; `IndicatorsList`, `IndicatorEditor` et `IndicatorExplain` reçoivent un objet de période (le libellé vient de `periodLabel`) |
| Rapports & dépenses | `{T, T}` | filtre `period` par chevauchement ; « Réalisé validé » sur la plage ; `GuidedFlow` reste sur le mois `to`, avec le libellé « Fil du mois de {to} » |
| PDD | `all` | Distributions : tableau des mois gardé pour naviguer, plus un filtre `period` dans la liste. Synthèse : `PeriodSelect`, avec « cumul sur la période » et « pic mensuel ({m}) ». Pipeline : `PeriodSelect`, « stock au {m} » |
| Couverture du suivi (CoverageRecapPage) | `all` (comportement actuel) | `PeriodSelect` ; `operationMonths` est proposé égal à la durée de la plage ; la matrice accepte la plage |
| Concepteur | période du document | `PeriodPicker` → `PeriodSelect`, avec 7a |

## 6. i18n

Nouveau dictionnaire `web/src/locales/en/period.js`, importé dans `locales/en.js`. On n'ajoute rien à `dashboards.js`, qu'édite le cycle de correctifs du lot 1.

**Composant**

| Français | Anglais |
|---|---|
| Choisir la période | Choose the period |
| Préréglages | Presets |
| Personnalisée | Custom |
| Du | From |
| Au | To |
| Appliquer | Apply |
| Dernier mois avec des données | Latest month with data |
| Ce mois-ci | This month |
| Mois dernier | Last month |
| Trimestre en cours | Current quarter |
| Semestre en cours | Current half-year |
| Janvier – juin {y} | January – June {y} |
| Année en cours | Year to date |
| 12 derniers mois | Last 12 months |
| T{q} {y} | Q{q} {y} |
| S{h} {y} | H{h} {y} |
| {n} mois | {n} month(s) |
| {n} formulaire(s) reçu(s) sur la période | {n} form(s) received over the period |
| chaque mois a des données | every month has data |
| {n} mois sans données | {n} month(s) without data |
| 60 mois au plus | 60 months at most |
| période conservée de la session | period kept from this session |

**Écrans**

| Français | Anglais |
|---|---|
| Aucune donnée reçue sur la période ({p}). | No data received over the period ({p}). |
| Couverture (sites) | Coverage (sites) |
| {r} / {a} sites actifs · distincts sur la période | {r} / {a} active sites · distinct over the period |
| sites actifs : tout le registre (aucune grille d'activation) | active sites: whole register (no activation grid) |
| Exécution du plan | Plan execution |
| {done} / {planned} visites prévues | {done} / {planned} planned visits |
| — aucun plan | — no plan |
| état au {m} | as of {m} |
| à date | to date |
| Budget de la période | Budget for the period |
| cumul sur la période | cumulative over the period |
| pic mensuel ({m}) | monthly peak ({m}) |
| Période (terrain et rapports) | Period (field and reports) |
| Les alertes budgétaires et d'échéance sont calculées à date. | Budget and deadline alerts are computed as of today. |
| Fil du mois de {m} | Flow for {m} |
| hors périmètre actif | outside the active scope |

**Erreurs du serveur** : chaque `details.code` (`period_format`, `period_partial`, `period_ambiguous`, `period_order`, `period_span`, `period_year`, `period_required`) est associé à une phrase française dans `lib/period.js`, traduite par `tr`. Les messages du serveur restent en français. Les mois s'affichent via `MONTH_SHORT` de `format.js`.

## 7. Performance

**Point de départ mesuré** (base de démonstration : 562 soumissions, 1 280 sites, 156 visites, 19 370 zones, rôle `mems2_app`, RLS active) :

| Mesure | Durée |
|---|---|
| `GET /monitoring/coverage-dashboard`, 1 mois | 1,2 à 1,4 s |
| `GET /monitoring/coverage-dashboard`, 6 mois | 1,8 à 2,1 s |
| `GET /monitoring/coverage-dashboard`, 12 mois | 4,4 à 4,6 s |
| `reportMonitoringData` (concepteur), 6 mois | 2,4 s |
| `reportMonitoringData` (concepteur), 12 mois | 4,7 s |
| `processOverview`, 12 mois | 0,09 à 0,13 s |
| field summary | 9 ms |
| consolidation | 17 ms |
| alerts | 31 ms |
| pdd summary | 26 ms |
| `rbm/sites` | 49 ms (réponse de **1,39 Mo** lue juste pour compter les sites à suivre — suite proposée, hors lot) |

97 à 98 % du temps se passe dans la requête des régions. Le prototype réécrit tourne en 3,3 ms. Les faits site × mois sur 12 mois prennent 42 à 65 ms. La projection des clés réduit le JSON de la fiche GD de 1,95 Mo à 285 ko (−85 %).

**Budget p95** (base de référence, plage de 12 mois ; pour un mois seul, la moitié au plus) :

| Endpoint | Budget p95 |
|---|---|
| overview | 600 ms |
| coverage-dashboard | 1 200 ms |
| forms/:id/dashboard | 500 ms |
| indicators/preview | 300 ms |
| field/summary | 250 ms |
| coverage-recap | 250 ms |
| consolidation | 150 ms |
| reports et planning | 150 ms |
| pdd summary et pipeline | 200 ms |
| alerts (plage) | 400 ms |
| `reportMonitoringData` | 1 500 ms |

Mémoire : au plus 64 Mo de tas retenu par requête ; réponses de 1 Mo au plus.

**Banc** : `server/scripts/perfPeriod.js`, lancé par `npm run perf:period -- --db <url>`.
- Il refuse `mems2_tpm` et toute base égale à la `DATABASE_URL` de développement.
- Il fait `createdb`, lance les migrations et charge un jeu synthétique déterministe (graine fixe) :
  - 19 370 zones (24 / 120 / 1 702 / 17 524) ;
  - 3 000 sites (10 % sans `adm3_pcode`, 3 % en zone interdite) ;
  - une grille d'activation 2026 complète (36 000 lignes, 8 % de « Non ») ;
  - 3 fiches × 60 indicateurs ;
  - **30 000 soumissions sur 12 mois** (environ 1,7 ko de JSON chacune) ;
  - 10 000 visites, 40 contrats actifs avec plans et factures, 6 000 lignes PDD.
- Il appelle les fonctions des dépôts via `withTenantTransaction` connecté en **`mems2_app`**. En superutilisateur, la même requête prend 59 ms au lieu de 6 s : il masquerait le défaut.
- Pour chaque endpoint et chaque plage de 1, 6 et 12 mois : 3 chauffes puis 20 mesures ; p50, p95, max ; tas avant et après (`--expose-gc`) ; taille de la réponse.
- **Garde EXPLAIN** : chaque requête capturée est rejouée en `EXPLAIN (ANALYZE, FORMAT JSON)` sous RLS. Le banc échoue si un `Nested Loop` a un enfant `CTE Scan` ou `Function Scan` avec plus de 1 000 `Actual Loops`, ou si un p95 dépasse son budget (code de sortie 1).
- Le tableau des résultats est consigné dans `docs/JOURNAL.md` à chaque commit qui touche une requête.

**Écran** : balayage Playwright (`/opt/pw-browsers/chromium`) des routes en français et en anglais.
- Marques `performance.mark('period:apply')` → `period:rendered` : 1,5 s au plus pour 12 mois sur la base de démonstration.
- 0 erreur en console ; `window.__memsMissingTr` vide pour les nouvelles clés.
- L'URL `?from&to` survit à un rechargement ; captures dans le scratchpad.

## 8. Tests (`node --test`, sans base sauf le banc)

| Fichier | Ce qu'il vérifie |
|---|---|
| `test/period.test.js` (étendu) | `parsePeriod` : `month` hérité, `from`/`to`, `AAAA-MM-JJ` tronqué, valeurs vides → `null`, tableau → `format`, `partial`, `ambiguous`, `order`, `span` (60 passe, 61 échoue), `year` (1999, 2101). `periodBounds` semi-ouvert (déc. 2026 → `hiExcl` 2027-01-01). `monthsOf`, `spanMonths`, `trendWindow` (1 mois → 12 mois finissant à `to` ; 18 mois → 18 mois). `periodLabel` en français et en anglais, formes longue et courte |
| `test/periodSql.test.js` | `monthWithin` (2 paramètres poussés, texte exact, `'TRUE'` sans période) ; `spanOverlaps` |
| `test/siteActivity.test.js` | `activeAt` (sans statut → actif ; statut reporté ; statut d'une autre année ; zone interdite ; statut postérieur ignoré) ; `siteRangeFacts` (règle de l'union ; réalisé pendant un mois inactif → `realisedInactive`) ; `ratesOf` (`null` sans plan ou sans site actif) ; fixture GD : 208 / 183 / 170 → 0,880 et 0,817 |
| `test/fieldSummaryRepo.test.js` | faux client : une requête de faits (GROUPING SETS + UNION mensuel) et une requête prestataires, paramètres `[T, lo, hi]`, `tenant_id` filtré dans chaque CTE. Mise en forme `shapeRangeSummary` : sur un mois, `planifie`/`realise`/`annule`/`rate` égaux à `summarizeVisits` sur la même fixture ; `execution` à `null` sans visite |
| `test/regionSql.test.js` | faux client : `coverageDashboard` et `reportMonitoringData` émettent `WITH g AS MATERIALIZED` (agrégat d'abord) et des lectures par clé, sans `DISTINCT ON (pcode)` sur tout le découpage ; même chaîne de repli |
| `test/indicatorKeys.test.js` | `computeAll(projeté)` est profondément égal à `computeAll(complet)` sur des fixtures avec variantes de casse, valeurs NA, options « X.1 » et champs calculés imbriqués |
| `test/periodRoutes.test.js` (supertest + dépôts espions, comme `monitoringIndicatorRoute.test.js`) | pour E1–E19 : `?month=2026-07` ≡ `?from=2026-07&to=2026-07` (mêmes arguments au dépôt) ; `?from=2026-01&to=2026-06` → `{from,to}` ; 400 avec `details.code` pour chaque erreur ; aucun paramètre → `null` là où c'est facultatif ; `rbm/sites?from&to` → `month = to` ; `visits` au-delà de 12 mois → `period_span` |
| `test/consolidation.test.js` (étendu) | somme des `monthlyBudgetCents` = budget ; chevauchement partiel ; plage hors contrat → budget 0 et taux `null` ; sans `period`, sortie profondément égale à l'actuelle ; `monthlyTotals` limités à la plage |
| `test/pddMath.test.js` (étendu) | `peakMonth` ; `latestStock` sur des stocks ≤ `to` |
| `test/pddRepository.test.js` (étendu) | `distFilter` avec la plage |
| `test/alertsMath.test.js` (étendu, C8) | titres selon la plage ; rapports filtrés seulement si une période est fournie |
| `test/reportModel.test.js` | `periodLabel` réexporté (les assertions existantes restent vertes) ; 61 mois refusés |
| `test/webPeriod.test.js` | `presets` pour T en janvier, juin, juillet, octobre et décembre (bornées à T, `jan_jun` de l'année précédente avant juillet) ; parité de `periodLabel` web/serveur sur 20 cas en français et en anglais ; aller-retour `readHashPeriod`/`writeHashPeriod` ; `normalize` ; `summarizeCounts` |
| Commandes à chaque commit | `cd server && npm test && npm run lint` ; `cd web && npm run build` ; balayage Playwright (§7) |

## 9. Risques et coordination

1. **Correctifs du lot 1 en parallèle** (TrendChart, alerts, cloche, reporting, rbmScore et RbmPage, éditeur d'indicateur, collectionDate et submissionsImport).
   - Les commits C1–C7 et C9 ne touchent aucun de ces fichiers, sauf `monitoring.repository.js` (parties distinctes : `submissionFilter`, régions, `formResults` ; `indicatorPreview` n'est pas touché) et le schéma de l'aperçu dans `monitoring.routes.js`.
   - C8, C10 (prop de TrendChart), C11 (ReportingPage) et C12 (écrans d'indicateur) passent **après** la fusion des correctifs, rebasés.
   - RbmPage et rbmScore ne sont jamais modifiés.
2. **Lot 6a** : la carte lit la même période. Ses endpoints appellent `readPeriod` et `siteMonthFactsCtes` (actifs, visités, couverture par district). C1 et C5 sont donc à fusionner avant ses requêtes. Sa migration 061 n'est pas affectée.
3. **Lot 7a** :
   - C2 réécrit la requête régions de `reportMonitoringData` (le plus gros gain pour le concepteur) ;
   - C5 garde les noms de champs de `reportFieldData` ;
   - `reportModel.periodSchema` ajoute le plafond de 60 mois ;
   - le remplacement de `PeriodPicker` est fait par celui des deux lots qui touche le dernier `ReportDesignerPage.jsx`.

   Le « 407,7 % » (retour 18) vient de `sitesVisited` (clé site, nom ou commune) rapporté à `sitesActive` (tout le registre de l'activité). Recommandation : 7a ou le lot 4 adoptent les faits site × mois, qui garantissent un numérateur inclus dans le dénominateur.
4. **Chiffre de tête de la couverture** : avec la définition commune, septembre 2026 sur la base de démonstration donne **16 / 1 280 = 1,3 %** au lieu de « 73 % — 16 / 22 visites » (qui est en réalité l'exécution du plan). Tant que le lot 3 n'a pas importé la grille d'activation, tout le registre compte comme actif. On atténue en affichant les deux KPI et le dénominateur. Voir la question 1.
5. **Estimations faussées par la RLS** : toute nouvelle requête est vérifiée par la garde EXPLAIN sous `mems2_app`. Pas de jointure entre deux gros CTE ; agrégation d'abord ; lectures par index.
6. **Mémoire du calcul des indicateurs** sur une longue plage : projection des clés (C4), plafond de 60 mois, budget mémoire. Le calcul reste pur (`computeAll`) et peut passer dans un worker si le banc le demande.
7. **Changements visibles** : district normalisé, activité du site pour `byActivity`, `?month=abc` désormais en 400. Ils sont documentés dans le journal et dans ETAT_DU_PROJET.
8. **Période de session** : une plage ancienne peut surprendre à l'ouverture d'un tableau de bord. La mention « période conservée de la session » propose le retour au défaut ; le bouton affiche toujours la période.
9. **Vues enregistrées** (Rapports, PDD) : une ancienne valeur de filtre `'AAAA-MM'` est convertie à la lecture, jamais rejetée.
10. **Regroupement par bureau** : `summary` regroupe par antenne ou bureau du site, `reportFieldData` par bureau parent. On garde cette différence (la Synthèse rapproche par nom avec `ov.byBureau`) ; l'unification est renvoyée au lot 4 (question 6).
11. **Journal** : chaque commit met à jour `docs/JOURNAL.md`, avec l'heure UTC, le statut, le résultat des tests et le tableau du banc. Le journal est poussé à chaque mise à jour.

## 10. Commits, chacun livrable seul

| # | Commit | Livrable seul parce que… |
|---|---|---|
| C1 | `feat(période): modèle unique côté serveur` | modules purs + middleware + prédicats ; aucun endpoint modifié |
| C2 | `chore(mesure): banc de période sous RLS` | script + `npm run perf:period` ; consigne le point de départ |
| C3 | `perf(régions): résolution par clés distinctes` | 4,4 s → < 0,3 s sur `coverage-dashboard` 12 mois ; sortie identique |
| C4 | `feat(api suivi de processus): période du … au …` | E1–E8, rétrocompatible |
| C5 | `perf(résultats): lecture des seules réponses utiles` | projection des clés, résultats identiques |
| C6 | `feat(terrain): faits site × mois et sites distincts sur la plage` | E9–E13, `reportFieldData` |
| C7 | `feat(budget): consolidation sur une plage` | E14 |
| C8 | `feat(listes): rapports TPM, planification, PDD` | E16–E19 |
| C9 | `feat(alertes): période des alertes terrain et rapports` | E15, après les correctifs du lot 1 |
| C10 | `feat(web): PeriodSelect, usePeriod, lib/period` | composant + hook + client + filtre DataList ; aucun écran migré |
| C11 | `feat(tableaux de bord): Synthèse et Couverture & performance` | |
| C12 | `feat(décisionnel): Vue d'ensemble, Suivi budgétaire consolidé, Rapport de synthèse` | |
| C13 | `feat(fiche): Résultats et calcul d'un indicateur` | |
| C14 | `feat(listes web): Rapports & dépenses, PDD, Couverture du suivi` | |
| C15 | `feat(alertes, concepteur): période du Centre d'alertes et du concepteur` | |
| C16 | `docs: convention « Période »` | CLAUDE.md, ETAT_DU_PROJET, retour 47 ✅, plan 1b ✅ |

## 11. Questions ouvertes

Voir la liste structurée.

---

## Décisions prises (13/10/2026)

Questions ouvertes de la conception, tranchées pour avancer (modifiables) :

- Couverture = définition commune (sites actifs réalisés ÷ sites actifs, sites distincts). **Site actif** : si le tenant a des lignes de grille d'activation pour l'année du mois, seul un « Oui » explicite rend le site actif (comme le classeur) ; sans aucune ligne cette année-là, tout le registre est actif **et** la réponse porte `activationKnown: false` par mois et au total — l'écran l'écrit (« grille d'activation non importée : taux calculé sur tout le registre »). L'ancien ratio visites réalisées ÷ prévues est renommé « Exécution du plan (visites) ».
- Période de travail partagée dans la session (sessionStorage) entre Synthèse, Couverture & performance, Vue d'ensemble, Suivi budgétaire consolidé, Rapport de synthèse et Résultats : oui.
- Écrans budgétaires : défaut = toute la durée des contrats (comportement actuel), la plage reste un filtre.
- Centre d'alertes : défaut = mois courant (comme la cloche).
- Préréglages : ce mois, mois dernier, trimestre en cours, trimestre précédent, semestre en cours, janvier–juin (dernier semestre complet), année en cours, année précédente, 12 derniers mois.
- Bureau parent ou antenne : inchangé ici, traité au lot 4.
- PDD sur une plage : cumul des distributions + pic mensuel.
- Coordination : 1b remplace le sélecteur de période du concepteur et pose le plafond de 60 mois ; 1b fournit le **service unique des faits site × mois** (sites distincts actifs / prévus / réalisés, visites) et la **requête des régions par clés distinctes** sous des noms stables, que 6a et 7a consomment (aucun calcul en double).
- Index `monitoring_submissions (tenant_id, period_month) WHERE NOT excluded` : seulement si le banc le justifie, migration 065.
- Plafonds : 60 mois par période, 12 mois pour la liste des visites.
- JIT PostgreSQL désactivé sur le pool de l'API (`-c jit=off`), mesuré avant / après.
- Banc de performance : JAMAIS de création de base ni de migration sur le serveur PostgreSQL de l'application (rôle commun) — base de banc dans un serveur jetable (`initdb` + `pg_ctl` sur un port libre, dans le scratchpad), arrêté après.

## Corrections exigées par la critique de complétude

À appliquer pendant la réalisation (elles priment sur le texte ci-dessus en cas de contradiction) :

- **[high]** The spec's own SQL makes byProvider unusable in two ways. (1) The provider query filters `v.period_month >= $2::date AND v.period_month < $3::date`, but the facts query passes `$3` = hi (inclusive, 'to-01'); the test says params are `[T, lo, hi]`. On the same parameters, `?month=2026-09` gives `>= '2026-09-01' AND < '2026-09-01'`, i.e. 0 provider rows. (2) The documented byProvider shape `{key,label,planifie,realise,annule,rate,sites}` has no `active` or `total`. alertsMath.fieldAlerts (alertsMath.js:107-118) reads `p.active >= 3` and `naf.total > 0`, and FieldVisitsPage.jsx:241 CoverageCard renders the same rows. Result: the provider_late and visits_unassigned alerts disappear silently, and the bell is no longer unchanged as the spec promises.
  - *Correction* : Use one bound convention: siteActivitySql gets `{lo, hiExcl}` and both queries use `< hiExcl`, or the provider query uses `< $3::date + interval '1 month'`. shapeRangeSummary must give every legacy row (overall, byOffice, byDistrict, byActivity, byProvider) `total`, `active = planifie + realise` and `rate`. Add tests: on one month, byProvider deep-equals summarizeVisits(...).byProvider on the same fixture; alertsMath.fieldAlerts gives identical output from the old and new summary of September 2026.
- **[high]** The 'site actif' rule contradicts the shared definition and the user's reference figure. PLAN_RETOURS_15_37 says « Site actif = Actif ce mois dans la grille d'activation ». The MMR « Unique sites Active » (208) counts sites with an explicit Active cell in Jan–Jun. The spec instead (§3.1) counts a site with no status as active, and carries the last status forward, across years. site_month_status stores only explicit cells: blanks are never stored (monthStatusesTx deletes them, locationsXlsx.js:253). So these sites all count as active: blank all of Jan–Jun with an earlier Active, added in August, or never graded. The count goes above 208, and the claim « C'est exactement Unique sites Active » is false. Test case E (status only after the range → active OOOOOO) locks in the wrong behaviour.
  - *Correction* : Per month M: if the tenant has any grid row for year(M), actif = an explicit `active = true` cell at M, and a blank cell is not active (as in the workbook). If the tenant has no grid row for year(M), fall back to the whole register, and return `activationKnown` per month in `monthly[]` and overall. Keep carry-forward only as a documented option. Rebuild the GD fixture with blank cells (before the opening month, after closing, never graded) and assert 208. Change case E to 'not active'.
- **[high]** The activation-history read is a per-site LATERAL that is unmeasured and mis-planned. The demo DB has 0 rows in site_month_status, so the 42-65 ms figure says nothing about it. Under RLS on the demo, EXPLAIN of the spec's query shows `BitmapAnd(idx_site_month_status_tenant (tenant_id, year), pkey)` running 1 280 times: once the table is filled, each site loop scans every status row of the tenant (3 000 sites × 36 000 rows). The in-memory lookup `generate_subscripts … ORDER BY k DESC LIMIT 1`, measured with synthetic arrays, costs on its own: ~0.4 s for 3 000 sites × 12 months with 12-entry grids (above the 250 ms field/summary budget), 1.3 s with 72-month histories, 3.6 s at 60 months. The bench only loads a 2026 grid and measures 1, 6 and 12 months, while MAX_SPAN allows 60.
  - *Correction* : Read statuses set-based, once per request: `SELECT site_id, year, month, active FROM site_month_status WHERE tenant_id=$1 AND make_date(year,month,1) BETWEEN $prior AND $hi`, plus `DISTINCT ON (site_id)` for the last status before `from` if carry-forward is kept. Hash-join to the months×sites grid, or use the explicit-cell rule above, which needs no carry-forward lookup. Bench a 3-year grid and 24- and 60-month ranges. Otherwise cap field/summary, coverage-recap and reportFieldData at `maxSpan: 24`.
- **[high]** Running the perf bench resets the live app's role. It runs `createdb` plus all migrations on the same PostgreSQL cluster as the dev/production DB. Roles are cluster-wide: migration 012 runs `ALTER ROLE mems2_app WITH LOGIN PASSWORD 'mems2_app_change_me'`, which puts the default password back on the role the real API uses (the README tells owners to change it). Migrations 002 and 012 also hard-code `GRANT CONNECT ON DATABASE mems2_tpm`, so they fail on a cluster without that DB. Refusing `mems2_tpm` as the target name does not prevent either problem.
  - *Correction* : Run the bench on its own throwaway cluster: `initdb` in the scratchpad plus `pg_ctl` on a free port, torn down afterwards. Alternatively, create a dedicated `mems2_perf_app NOSUPERUSER NOBYPASSRLS` role and apply the migrations with 002 and 012 substituted. Refuse to run when the target cluster contains the `mems2_tpm` database or a `mems_app` role. Write this in §7.
- **[medium]** RBM « état au {to} » is not the state at `to`. RBM_SELECT (field.repository.js:114-150) takes `lastVisitMonth = GREATEST(max(site_visits.period_month WHERE status<>'annule'), max(submission month), last_visit_date)` with no upper bound. For Jan–Jun viewed in October, July–September visits and data already make the sites 'à jour', so the KPI footer « état au juin » is wrong for any past range. That is the main use case (« janvier à juin »).
  - *Correction* : Either bound RBM_SELECT by an `asOf` parameter (`period_month <= $asOf` in the pv/dv LATERALs and in last_visit_date). This is in field.repository.js, not rbmScore, so the « RbmPage/rbmScore jamais modifiés » constraint still holds. Or label the KPI « état actuel » and call rbmSites with the current month whenever `to` < current month. Test: a visit after `to` does not make a site à jour at `to`.
- **[medium]** The EXPLAIN guard fails on the spec's own facts query. EXPLAIN ANALYZE of §4.4.3 on the demo shows `Nested Loop → Function Scan on generate_series m (loops=1280)` (reg CROSS JOIN months) and `SubPlan → Function Scan on generate_subscripts (loops=15360)`. The rule « Nested Loop avec enfant CTE Scan ou Function Scan > 1 000 Actual Loops = échec » therefore fails C6 at demo volume, and the guard as written cannot separate the harmful pattern (a big CTE re-scanned per row) from a harmless one (a 12-row series).
  - *Correction* : Define the guard on work rather than node type: fail when the inner side of a Nested Loop reads more than N rows in total (actual rows × loops on a Seq, Bitmap or Index Scan of a table, or a CTE Scan of more than 1 000 rows), or when a table scan runs more than 1 000 times with more than 10 rows per loop. Exempt Function Scans returning ≤ 60 rows. Add a regression case with the old REGION_CTE plan, which must fail.
- **[medium]** Execution and visit counts break the shared definition « Visite = Site × mois, comptée une fois ». site_visits is unique on (tenant, site, period_month, activity), and NULL activity is not unique, so one site-month can hold several rows (activity NULL and 'X', or two NULLs; 108 of 156 demo visits have a NULL activity). The `vis` CTE sums rows, so « Σ visites réalisées ÷ Σ prévues » counts site × month × activity. Also, a row created directly as `realise` (visitSchema allows it) is unplanned (« hors plan ») but still enters the numerator, whereas the shared rule is « réalisées parmi les prévues ÷ prévues ».
  - *Correction* : In `vis`, collapse to one status per (site_id, month), with precedence realise > planifie > annule, before summing. State that execution = site-months realised that were planned ÷ site-months planned; until lot 4 tracks « hors plan », every non-cancelled row counts as planned, and say so in the API doc. Add a fixture with two rows for the same site-month.
- **[medium]** The claim « byDistrict prend COALESCE(adm2, district) normalisé : les doublons de casse du retour 15 disparaissent » is false for the SQL given. `COALESCE(NULLIF(btrim(s.adm2),''), NULLIF(btrim(s.district),''),'—')` does not fold case. On the demo DB it gives 26 district keys instead of 20, with 5 duplicate groups (AMBOASARY SUD | Amboasary Sud | Amboasary sud, BEKILY | Bekily, BETROKA | Betroka, MOROMBE | Morombe, Antanimora Sud | Antanimora sud).
  - *Correction* : Group on `lower(...)`, or better on the district from admin_areas via `adm2_pcode`. Display `min(name)` or the official name. Add a test with mixed case. The same key should be used in coverageRecapSummary's district filter and its district list.
- **[medium]** « Sites distincts » from data uses three incompatible keys. processOverview, coverageDashboard and dashboard count `DISTINCT NULLIF(s.site,'')` (a raw code shared across forms: 190 on the demo). reportMonitoringData uses `COALESCE(site_id, site, admin3)` (226), which counts a commune as a site; the shared definition says « une donnée rattachée seulement à la commune n'est jamais une visite ». site_id gives 3. Over a range, Synthèse, Couverture & performance and the designer will show different « sites distincts », which defeats the point of the lot.
  - *Correction* : Define one SQL expression in common (e.g. `SUBMISSION_SITE_KEY = COALESCE('id:'||site_id, 'code:'||form_id||':'||NULLIF(btrim(site),''))`, never admin3). Use it in all four queries. Label the KPI « sites (données) » to keep it apart from the field-visit coverage. Test that the same fixture gives the same count on overview, coverage-dashboard and reportMonitoringData.
- **[medium]** The spec does not deliver the user's acceptance figure. The 170/208 = 82 % example needs « réalisé = données rattachées au site », but 1b counts a site as realised only when `site_visits.status='realise'` (lot 4 point d'extension). On real imports, visits are not marked by hand, so Couverture (sites) over Jan–Jun will be near 0 %. On the demo it is 16/1 280 = 1.3 %, which the spec itself notes in §9.4. Retour 47 is marked ✅ in C16 even though the example cannot be reproduced.
  - *Correction* : Either add submissions with a resolved `site_id` (and same activity) as realised in the `vis` CTE now; SUBMISSION_OF_SITE without the commune fallback already exists. Or state explicitly in the spec and in RETOURS that retour 47's numeric example is accepted only with lot 4, and keep retour 47 at « 1b fait, chiffre MMR au lot 4 » instead of ✅.
- **[medium]** Multi-month factures are handled two ways. The spec's « POST /tpm/reports : une facture couvre un mois » is wrong: tpm_reports.period_end exists (migration 008), reports.routes.js:86/121 accept `periodEnd`, and FactureDrawer.jsx:220 offers « Fin de période — facture pluri-mensuelle ». The spec lists reports by overlap (E16), yet the consolidation books a facture's full amount in its first month (consolidation.repository.js groups on `r.period_month`). For Feb–Jun, a Jan–Mar facture is listed in Rapports & dépenses (« Réalisé validé sur la plage ») but is absent from the consolidation's Réalisé for the same range.
  - *Correction* : Pick one rule and use it on both screens. Either book at `period_month` everywhere (the Rapports « Réalisé validé » KPI sums only reports whose period_month is in the range; the list still shows overlaps, with a marker), or spread the amount across [period_month, period_end] in integer cents with the same largest-remainder splitter as monthlyBudgetCents. Correct the « Restent sur un mois » table.
- **[medium]** Several « couverture » numbers are not mapped to the new rates. The spec defines three rates (coverage = sites, planning, execution = visits), but existing labels keep showing the visit rate as « couverture ». alertsMath 'Couverture terrain faible' uses `rate` (execution); so do the Vue d'ensemble « Couverture terrain » card, Reporting's district table and CSV (`d.rate`), the Synthèse « zones à surveiller (<80 %) » (office `rate`), FieldVisitsPage CoverageCards and monthsOverview `coverage = done/base`. After 1b, the Synthèse KPI « Couverture (sites) » will disagree with the same word elsewhere.
  - *Correction* : Add a table to §3 mapping every existing display to coverage, planning or execution, with its new label. For example: the alert becomes « Exécution du plan faible » (or switches to coverage), the Reporting district table gets both columns, and « zones à surveiller » states which rate it uses. Check the wording in the Playwright sweep.
- **[medium]** The designer (part of lot 1b per PLAN) keeps the old semantics. computeKpis (reportData.js:129-135) takes sites_active from `reportMonitoringData.sitesActive` (whole register for the activity, no activation) and sites_visited as a sum of per-form submission keys with a commune fallback: this is the 407.7 % source. loadSources asks for the budget with `consolidation(tenantId, { today: period.to })`, a cumulative figure, not the period. C6 only changes reportFieldData, so designer coverage and budget KPIs do not follow the new range rules.
  - *Correction* : In 1b, compute reportMonitoringData.sitesActive and sitesVisited per activity with siteMonthFactsCtes (active over the range, realised during an active month), and pass `{ period }` to consolidation in loadSources (`budget_*` = period budget, with « cumul à date » kept as a separate KPI). Or explicitly exclude designer coverage and budget from 1b acceptance and hand them to 7a with the rule written down.
- **[medium]** Two 'site actif' rules will coexist. Plan de suivi (planBoard.currentStatus, planBoard.js:65-70; boardKpis.active) uses the last status of the exercise, including months after today, with no carry-over between years. Synthèse and Couverture & performance would use the new per-month rule. With the « Année en cours » preset, the same year shows different « sites actifs » on Plan de suivi and on Synthèse. The spec keeps PlanBoard unchanged without mentioning the discrepancy.
  - *Correction* : Export the single per-month rule (siteActivity.activeAt) and either make boardKpis.active use 'active in ≥1 month of the exercise up to today', or show on Plan de suivi which rule it uses (« statut de fin d'exercice ») and record the alignment as a lot 4 task in the plan.
- **[medium]** The coordination claim in §9.1 is wrong. The pending lot-1 fix commit 889f531 changes `reportFieldData(tenantId, {from,to}, {lang})` (bureau label now `$4 = unattachedText(lang)`), `reportMonitoringData(..., {lang})` and reports.routes.js (REPORT_WRITE_ROLES). C6 rewrites reportFieldData with a hard-coded `'(non rattaché)'`, and C8 edits reports.routes.js. So C6 and C8 do touch files changed by the lot-1 fixes, against « C1–C7 et C9 ne touchent aucun de ces fichiers ». a7b94f4 and eb026c5 also edit monitoring.routes.js and indicatorPreview.
  - *Correction* : Move C6 and C8 after the lot-1 fixes are merged (as C8/C10-C12 already are), or rebase them explicitly. siteMonthFactsCtes must take the bureau fallback label as a parameter (`unattachedText(lang)`), not a literal. Update §9.1 with the real list of overlapping files.
- **[medium]** Over a range, the PDD pipeline compares mismatched quantities. Need = sum over all months of the range, while stock = one stock level at the latest month ≤ `to`. A 6-month need against one month's stock shows a stockout for almost every multi-month range. Stock entry (PddPage.jsx:598, PUT /pdd/stock) is per month, and with a range it is not defined which month an edit writes to.
  - *Correction* : For a range, show the pipeline month by month (need_m vs stock_m, stockouts counted per month) with a total row. Or define need = remaining months from `to` against stock at `to`. Allow stock entry only when from = to, or name the target month explicitly (`to`).
- **[medium]** The bench and the budgets cover 1, 6 and 12 months, but parsePeriod lets every analysis endpoint (overview, coverage-dashboard, forms/:id/dashboard, preview) take 60 months. Those endpoints load every submission's JSON of the range into Node and run computeAll per form. At the bench volume (30 000 per 12 months), 60 months means about 150 000 rows: neither the 64 MB heap budget nor the p95 is measured. PDD summary also aggregates in JS over listDistributions with no limit, and PDD defaults to `all` (CLAUDE.md: aggregate in SQL, bounded reads).
  - *Correction* : Either bench 24 and 60 months, or give `readPeriod` a `maxSpan` of 24 on the submission-analysis endpoints and of 12 on lists (as for visits), keeping 60 for consolidation and the designer. Add a limit with pagination to /pdd/distributions, and move the PDD summary totals, per-month figures and peak to SQL GROUP BY.
- **[medium]** Endpoint by endpoint, the spec does not say whether a period is required or what null means. The facts query needs bounded months, but `GET /field/summary` with no parameter returns all visits today, and the spec only says « aucun paramètre → null là où c'est facultatif ». coverage-recap null keeps « toutes les visites », with no say on the activation rule across an unbounded span. Which period a null maps to for consolidation (cumulative) and alerts (current month) is only spelled out piecemeal.
  - *Correction* : Add a column to the §1.1 table, `period: required | optional(null = …)`. For example: field/summary null = current month (as alerts) or `period_required`; coverage-recap null = the visits' own span capped at 60 months; consolidation null = no `row.period` block. Test each null case in periodRoutes.test.js.
- **[medium]** The designer's existing presets regress. PeriodPicker (ReportDesignerPage.jsx:207-224) offers « Année {y} » (Jan–Dec), « 2e semestre {y} » and « Année {y-1} ». The new presets are bounded at T and anchored on T, so a past year and a full calendar year disappear. Also, in October « Trimestre en cours » covers October only, usually with no data yet, while the default period is the latest month with data (L).
  - *Correction* : Add `prev_quarter`, `prev_half` and `last_year` (Y-1 Jan–Dec). In the designer (a document period), also allow `this_year` (full year). Consider anchoring quarter and half-year on L when T has no data. Add these cases to webPeriod.test.js.
- **[low]** Commit order breaks « chaque commit livrable seul »: §5.3 removes useDefaultMonth in C10, but its only two consumers (ProcessDashboardPage.jsx:8 and DashboardCoveragePage.jsx:8) migrate in C11, so `npm run build` fails at C10. Also: ReportsPage does not use DataList (its filters, saved views and period match are inline, ReportsPage.jsx:34/78/139/184-192), so the DataList `type:'period'` filter and the 'AAAA-MM' → {from,to} conversion of saved views do not reach Rapports & dépenses. web/src/lib/indicatorView.js `previewBody` (sends `{month}`) is missing from C13's files.
  - *Correction* : Remove useDefaultMonth in C11. In C14, give ReportsPage its own conversion of saved views, or move it onto DataList. Add lib/indicatorView.js and server/test/indicatorView.test.js to C13.
- **[low]** Smaller incorrect claims and inventory gaps: field.routes.js rbm/generate is at :190-194 (not 180-184) and import at :323 (not :318). « Aujourd'hui ?month=abc … renvoie toutes les périodes » is true for monitoring and field, not for /tpm/reports (`month.slice` → PG 22007 → 400). The inventory misses GET /tpm/field/map (SitesMapPage, Carte), legacy GET /tpm/plans?month (tpm.validation monthQuerySchema), fixed windows in the partner 360 view (partners.repository.js:46-68: current month and last 12 months), contract forecast `?until` and the Évaluation `periode` input. usePopover (listView.jsx:12-24) does not return focus to the trigger on Escape, contrary to §5.2. MONTH_SHORT in format.js is not exported.
  - *Correction* : Correct the line references. Add the missing endpoints and screens to the « restent / hors lot (6a, 8) » tables with a reason. Have PeriodSelect manage focus itself (focus on open, return on close and Escape). Export MONTH_SHORT or use monthLabel.
- **[low]** Smaller semantic edges not covered: (a) The zone-interdite flag (`security_situation >= 99`) is the current value, not a dated one, so marking a site forbidden today removes it from past ranges (coverage history changes). (b) In a range that runs past T (the custom picker allows forward = 3, and the designer full year), not-yet-due planned visits lower execution. (c) monthlyBudgetCents uses `monthRange(dateDebut, dateFin)`, which is capped at 60 and can differ from `periodMonths`, the base of the contract's « barème mensuel » (contracts.service.js:103). (d) A body field sent as null in the preview (`month: null`, which the current zod schema allows) would become `period_format` under the « non-chaîne » rule.
  - *Correction* : (a) Document it as a known limit until lot 5 (risk by period). (b) Count execution only for months ≤ T, or show « dont n visites à venir ». (c) Compute n with `periodMonths || monthsBetween` (uncapped) and only materialise the intersection. (d) Treat null like absent in parsePeriod.
- **[low]** Over-engineering: siteActivity.siteRangeFacts is a JS twin of the SQL « pour figer la sémantique », but no test ties the SQL to it. fieldSummaryRepo.test only checks SQL text against a fake client, so the twin can drift while its tests stay green, which locks nothing. The legacy byOffice, byDistrict and byActivity arrays now also list every register group with zero visits, so FieldVisitsPage cards and the Reporting district table/CSV list all districts at 0/0; this change is not listed among the visible changes.
  - *Correction* : Either drop siteRangeFacts and keep only `ratesOf` and `activeAt`, or add a DB parity check to the bench harness (perf DB): SQL facts == siteRangeFacts on the synthetic rows. Filter `total = 0` groups from the legacy arrays, or list this among the visible changes.

## Commits prévus

1. **feat(période): modèle unique côté serveur (parsePeriod, readPeriod, prédicats SQL)** — fichiers : server/src/modules/common/period.js, server/src/middleware/period.js, server/src/modules/common/periodSql.js, server/src/modules/reports/reportModel.js, server/test/period.test.js, server/test/periodSql.test.js, server/test/reportModel.test.js, docs/JOURNAL.md — tests : cd server && npm test (period: parsePeriod month/from-to/AAAA-MM-JJ/vides/partial/ambiguous/order/span 60-61/year, periodBounds semi-ouvert, monthsOf, trendWindow, periodLabel fr/en long et court ; periodSql: monthWithin/spanOverlaps texte et paramètres ; reportModel: periodLabel réexporté inchangé, 61 mois refusés) && npm run lint
2. **chore(mesure): banc de période sous RLS (perf:period, garde EXPLAIN)** — fichiers : server/scripts/perfPeriod.js, server/package.json, docs/JOURNAL.md — tests : npm run perf:period -- --db postgres://…/mems2_perf sur une base jetable (refuse mems2_tpm) ; consigne p50/p95 des endpoints E1-E19 pour 1, 6 et 12 mois en mems2_app ; garde EXPLAIN (Nested Loop sur CTE Scan > 1000 boucles = échec) ; point de départ attendu : coverage-dashboard 12 mois en échec (régions)
3. **perf(régions): résolution par clés distinctes, 6 s → 3 ms sous RLS, sortie identique** — fichiers : server/src/modules/monitoring/monitoring.repository.js, server/test/regionSql.test.js, docs/JOURNAL.md — tests : npm test (regionSql: agrégat MATERIALIZED d'abord, lectures par clé, même chaîne de repli) ; parité sur la base de démonstration : 7 régions identiques à la sortie actuelle de GET /coverage-dashboard?from=2025-11&to=2026-10 ; banc : coverage-dashboard 12 mois sous 0,3 s, reportMonitoringData 12 mois sous 0,3 s, garde EXPLAIN verte
4. **feat(api suivi de processus): période du … au … sur overview, coverage-dashboard, résultats, valeurs, aperçu et soumissions** — fichiers : server/src/modules/monitoring/monitoring.routes.js, server/src/modules/monitoring/monitoring.repository.js, server/src/modules/monitoring/periods.service.js, server/test/periodRoutes.test.js, server/test/monitoringIndicatorRoute.test.js, docs/JOURNAL.md — tests : npm test (periodRoutes, partie monitoring : ?month ≡ from=to, from/to transmis, 400 avec details.code pour chaque erreur, sans paramètre → null ; aperçu : ordre et durée contrôlés ; comptage de formSubmissions juste avec 2 paramètres de plage) ; curl sur la base de démonstration : mêmes chiffres qu'avant pour ?month=2026-09
5. **perf(résultats): lecture des seules réponses utiles des soumissions** — fichiers : server/src/modules/monitoring/indicatorKeys.js, server/src/modules/monitoring/monitoring.repository.js, server/test/indicatorKeys.test.js, docs/JOURNAL.md — tests : npm test (computeAll projeté profondément égal au complet : casse, NA, options X.1, champs calculés imbriqués) ; JSON de la fiche GD 1,95 Mo → environ 0,3 Mo ; banc : tas retenu sous 64 Mo à 12 mois
6. **feat(terrain): faits site × mois, sites distincts et actifs sur la plage (summary, visites, récap, matrice, données du concepteur)** — fichiers : server/src/modules/common/siteActivity.js, server/src/modules/common/siteActivitySql.js, server/src/modules/tpm/fieldMath.js, server/src/modules/tpm/field.repository.js, server/src/modules/tpm/field.routes.js, server/test/siteActivity.test.js, server/test/fieldSummaryRepo.test.js, server/test/fieldMath.test.js, server/test/periodRoutes.test.js, docs/JOURNAL.md — tests : npm test (siteActivity : activeAt sans statut, statut reporté, autre année, zone interdite, statut postérieur ignoré ; union sur la plage ; réalisé sur site inactif à part ; ratesOf null sans plan ; fixture GD 208/183/170 → 0,880 et 0,817 ; fieldSummaryRepo : une requête de faits + une requête prestataires, tenant_id dans chaque CTE, parité sur un mois avec summarizeVisits) ; base de démonstration septembre 2026 : 16 réalisées sur 22 visites inchangé, sites 22 prévus et 16 réalisés ; banc summary 12 mois sous 250 ms
7. **feat(budget): consolidation sur une plage (budget de la période en centimes entiers)** — fichiers : server/src/modules/tpm/consolidation.js, server/src/modules/tpm/consolidation.repository.js, server/src/modules/tpm/consolidation.routes.js, server/test/consolidation.test.js, server/test/periodRoutes.test.js, docs/JOURNAL.md — tests : npm test (somme des monthlyBudgetCents = budget exact ; chevauchement partiel ; plage hors contrat → budget 0 et taux null ; sans period, sortie profondément égale à l'actuelle ; monthlyTotals limités à la plage) ; banc consolidation sous 150 ms
8. **feat(listes): rapports TPM, planification et PDD sur une plage (chevauchement, pic mensuel, stock au dernier mois)** — fichiers : server/src/modules/tpm/reports.routes.js, server/src/modules/tpm/reports.repository.js, server/src/modules/tpm/planning.routes.js, server/src/modules/tpm/planning.repository.js, server/src/modules/pdd/pdd.routes.js, server/src/modules/pdd/pdd.repository.js, server/src/modules/pdd/pddMath.js, server/test/pddMath.test.js, server/test/pddRepository.test.js, server/test/periodRoutes.test.js, docs/JOURNAL.md — tests : npm test (spanOverlaps pour les rapports avec period_end ; peakMonth ; latestStock sur stock ≤ to ; distFilter avec plage ; ?month toujours accepté ; ?month=abc → 400 period_format)
9. **feat(alertes): période facultative des alertes terrain et rapports, budget et échéances à date (après les correctifs du lot 1)** — fichiers : server/src/modules/dashboards/alerts.controller.js, server/src/modules/dashboards/alerts.service.js, server/src/modules/dashboards/alertsMath.js, server/test/alertsMath.test.js, server/test/periodRoutes.test.js, docs/JOURNAL.md — tests : npm test (sans paramètre : sortie identique, la cloche est inchangée ; avec plage : titres « sur la période », rapports filtrés par chevauchement, scope a_date sur budget et contrats) ; banc alerts sous 400 ms
10. **feat(web): PeriodSelect (du … au … + préréglages), usePeriod (URL > session > défaut), lib/period, client API, filtre période de DataList** — fichiers : web/src/lib/period.js, web/src/components/PeriodSelect.jsx, web/src/components/PeriodBanner.jsx, web/src/components/DataList.jsx, web/src/App.jsx, web/src/api/client.js, web/src/styles.css, web/src/locales/en/period.js, web/src/locales/en.js, server/test/webPeriod.test.js, docs/JOURNAL.md — tests : cd server && npm test (webPeriod : préréglages pour T = janvier, juin, juillet, octobre, décembre bornés à T ; parité periodLabel web/serveur sur 20 cas fr/en ; aller-retour hash ; normalize ; summarizeCounts) ; cd web && npm run build ; Playwright : #/dashboard/couverture?from=2026-01&to=2026-06 ne retombe plus sur la route par défaut
11. **feat(tableaux de bord): Synthèse et Couverture & performance sur une plage (Couverture (sites) + Exécution du plan, état RBM au dernier mois)** — fichiers : web/src/pages/monitoring/ProcessDashboardPage.jsx, web/src/pages/dashboard/DashboardCoveragePage.jsx, web/src/components/charts/TrendChart.jsx, web/src/locales/en/period.js, docs/JOURNAL.md — tests : cd web && npm run build ; Playwright FR/EN : préréglage Janvier – juin appliqué, URL mise à jour et conservée au rechargement, bandeau par défaut inchangé, mention de session, 0 erreur console, aucune traduction manquante ; marque period:apply → period:rendered sous 1,5 s ; captures dans le scratchpad
12. **feat(décisionnel): Vue d'ensemble, Suivi budgétaire consolidé et Rapport de synthèse sur une plage** — fichiers : web/src/pages/dashboard/DashboardBIPage.jsx, web/src/pages/dashboard/ConsolidationPage.jsx, web/src/pages/dashboard/ReportingPage.jsx, web/src/locales/en/period.js, docs/JOURNAL.md — tests : cd web && npm run build ; Playwright : sans période, chiffres identiques au cumul actuel ; avec Janvier – juin, colonnes de la période et matrice limitée à 6 mois ; CSV nommés par plage ; 0 erreur console
13. **feat(fiche): Résultats, détail « Comment c'est calculé » et éditeur d'indicateur sur une plage (après les correctifs du lot 1)** — fichiers : web/src/pages/monitoring/ProcessMonitoringPage.jsx, web/src/pages/monitoring/IndicatorsList.jsx, web/src/pages/monitoring/IndicatorEditor.jsx, web/src/pages/monitoring/IndicatorExplain.jsx, docs/JOURNAL.md — tests : cd web && npm run build ; Playwright : plage janvier–juin sur la fiche GD, valeur d'un indicateur = aperçu « Comment c'est calculé » (0 écart), Toutes les périodes toujours proposé ; npm test côté serveur vert
14. **feat(listes web): filtre période dans Rapports & dépenses, Distribution d'urgence et Couverture du suivi** — fichiers : web/src/pages/tpm/ReportsPage.jsx, web/src/pages/pdd/PddPage.jsx, web/src/pages/monitoring/CoverageRecapPage.jsx, docs/JOURNAL.md — tests : cd web && npm run build ; Playwright : une vue enregistrée avec l'ancien filtre AAAA-MM se recharge en plage d'un mois ; synthèse PDD avec cumul et pic mensuel ; pipeline avec stock au dernier mois ≤ to ; récapitulatif avec operationMonths = durée de la plage
15. **feat(alertes, concepteur): période du Centre d'alertes et du concepteur de rapport (coordonné avec le lot 7a)** — fichiers : web/src/pages/dashboard/AlertsPage.jsx, web/src/pages/reports/ReportDesignerPage.jsx, docs/JOURNAL.md — tests : cd web && npm run build ; Playwright : cloche inchangée, page Alertes filtrable par plage avec la mention « calculées à date » ; concepteur : la période du document s'édite avec PeriodSelect et 61 mois sont refusés
16. **docs: convention « Période » (CLAUDE.md), état du projet, retour 47 et lot 1b terminés** — fichiers : CLAUDE.md, docs/ETAT_DU_PROJET.md, docs/RETOURS_UTILISATEUR.md, docs/PLAN_RETOURS_15_37.md, docs/JOURNAL.md — tests : relecture ; npm test et npm run build verts sur la branche

## Mesures (base de démonstration)

Mesures faites en lecture seule le 13/10/2026 sur la base de démonstration (562 soumissions, 1 280 sites, 156 visites, 19 370 zones, grille d'activation vide). Toutes les durées sont mesurées sous mems2_app, donc avec la RLS active, sauf mention contraire.

Point de départ (HTTP, à chaud) :
- GET /api/monitoring/coverage-dashboard : 1,21 à 1,41 s sur 1 mois, 1,81 à 2,06 s sur 6 mois, 4,37 à 4,64 s sur 12 mois.
- GET /api/monitoring/overview sur 12 mois : 0,09 à 0,11 s.
- Autres endpoints :

| Endpoint | Durée | Réponse |
|---|---|---|
| /tpm/field/summary | 9 ms | — |
| /tpm/field/rbm/sites | 49 ms | 1,39 Mo |
| /tpm/consolidation | 17 ms | — |
| /alerts | 31 ms | — |
| /tpm/field/coverage-recap | 9 ms | — |
| /pdd/summary | 26 ms | — |
| /monitoring/periods | 18 ms | — |

Profil par requête (pg.Client.query instrumenté, appels directs aux dépôts) :
- coverageDashboard : 1 071 ms sur 1 mois, dont 1 014 ms pour la requête régions (REGION_CTE) ; 4 827 ms sur 12 mois, dont 4 712 ms pour cette même requête.
- reportMonitoringData (concepteur) : 2 389 ms sur 6 mois, dont 2 281 ms de régions ; 4 657 ms sur 12 mois, dont 4 520 ms de régions.
- processOverview sur 12 mois : 132 ms.

Cause des lenteurs :
- EXPLAIN ANALYZE de la requête régions : 6 043 ms en mems2_app contre 59 ms en superutilisateur.
- Sous RLS, le planificateur estime 3 lignes là où il y en a 562. Il choisit donc une Nested Loop Left Join sur un CTE Scan de 19 370 lignes, exécutée 562 fois et deux fois de suite.

Prototype réécrit (agrégat sur les clés distinctes, puis lecture par index) :
- 3,3 ms sous RLS.
- Sortie identique : 7 régions, mêmes soumissions et mêmes communes (Atsimo Andrefana 227/24, Androy 202/17, non renseigné 46/1, Vatovavy 38/9, Atsimo Atsinanana 30/13, Anosy 18/6, Fitovinany 1/1).

Prototype des faits site × mois (1 280 sites × 12 mois, sous RLS) :
- 42 à 65 ms ; le plan joint act et vis par un Merge Left Join.
- Septembre 2026 donne 22 visites, dont 16 réalisées : identique au « 16 / 22 visites » affiché aujourd'hui.
- Sites : 22 prévus, 16 réalisés, 1 280 actifs. La couverture au sens de la définition commune vaut donc 1,25 %, contre 73 % pour l'exécution du plan.

Règle d'activation vérifiée sur des statuts simulés : statut reporté, actif par défaut, zone interdite exclue, statut postérieur à la plage ignoré.

Projection des clés JSON : la fiche GD passe de 1 946 ko à 285 ko (−85 %), la fiche SAMS de 36 ko à 26 ko.

Données :
- 108 visites sur 156 n'ont pas d'activité alors que leur site en a une.
- Toutes les colonnes period_month sont au 1er du mois, mais monitoring_submissions, pdd_distributions et pdd_stock n'ont pas de contrainte CHECK qui l'impose.

Fichiers produits : captures et maquette dans /tmp/claude-0/-home-user-Ral/f0740469-7fce-53af-b9a1-735e58767e7d/scratchpad/design/1b/ (processus_synthese.png, dashboard_couverture.png, dashboard_apercu.png, reporting_synthese.png, reporting_concepteur.png, period-select-mock.png, period-select-mock.html). Les scripts et le SQL des prototypes sont dans scratchpad/prof/ (cov.js, rep.js, region_new.sql, facts.sql, active_semantics.sql).
