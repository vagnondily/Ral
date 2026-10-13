# Lot 7a — Concepteur de rapport riche

Retours 18, 39, 40, 43, 45, 51, 52, 53 · branche `claude/practical-meitner-2c1560` · migrations **062, 063, 064** · conçu le 13/10/2026 en lecture seule (aucun fichier du dépôt modifié, aucune écriture en base).

Pièces jointes (scratchpad `design/7a/`) : captures de l'état actuel `now-library.png`, `now-bulletin-t1s.png` (page grise pendant « Calcul… »), `now-bulletin-loaded.png`, `now-performances-loaded.png`, `now-performances-full.png` ; maquette `mock-designer.html` et ses captures `mock-editor-desktop.png`, `mock-editor-mobile.png`, `mock-header-desktop.png` ; scripts de mesure `scripts/prof_render.js`, `bench50k*.js`, `proto_c1.js`, `shots_now.js`.

---

## 0. En bref

1. **Le rapport reste vide 5 s à cause d'UNE requête** : la résolution « pcode → région » (`REGION_CTE`, `monitoring.repository.js:573`) prend 5,0 s sur 5,2 s. Le reste du calcul prend 0,1 s. On la corrige (même SQL que le prototype du lot 1b, 2 à 4 ms).
2. **Les gros volumes passent par un histogramme exact** : au lieu de charger chaque soumission (12 s et 674 Mo par fiche à 50 000 soumissions), le SQL compte « variable × valeur », et la **même boucle** `tallyIndicator` fait le décompte avec un poids. Résultat : 1,2 s à 50 000 soumissions et **0 écart** sur 57 puis 69 indicateurs.
3. **La page n'est plus jamais blanche** : le contenu fixe (titres, textes, en-tête) s'affiche tout de suite ; chaque bloc de données a son squelette nommé, son chronomètre, son erreur et son bouton « Réessayer ». Les blocs se calculent par lots, ceux de la page visible en premier, et le résultat est mis en cache avec une invalidation par version des données.
4. **Le catalogue couvre tout ce que MEMS calcule** : 64 jeux de données et 38 chiffres clés, chacun branché sur la fonction de service qui calcule déjà ce chiffre (aucun calcul en double). Les blocs se filtrent par période (plage), bureau, activité et partenaire, au niveau du rapport ou du bloc.
5. **Mise en page exacte** : la pagination est calculée une seule fois et sert à l'aperçu, au PDF et au PowerPoint. On peut changer d'orientation par section, et on dessine librement l'en-tête et le pied de page (logos téléversés, textes avec variables, numéro de page). Le circuit de validation **brouillon → soumis → validé / rejeté** fige une version immuable (contenu + données) et impose la séparation des tâches, en base comme dans l'API.

---

## 1. Constat mesuré (base de dev, lecture seule)

| Mesure | Valeur | Source |
|---|---|---|
| `POST /api/report-designer/render`, période janv.–oct. 2026, 562 soumissions | bulletin 4,50 / 4,71 / 4,51 s ; performances 4,61 / 4,12 / 4,65 s ; complétude 4,32 / 4,44 / 4,28 s ; budget 6–10 ms ; PDD 15–24 ms | `curl -w %{time_total}` |
| Navigateur : temps avant le premier contenu | bulletin **5 055 ms**, performances **5 218 ms**. Jusque-là, la page n'affiche qu'un squelette gris (`ReportDesignerPage.jsx:445`, `data === null`) | `scripts/shots_now.js`, `now-bulletin-t1s.png` |
| Point chaud | requête des régions = **5 040 ms sur 5 177 ms** (97 %) : `REGION_CTE` reconstruit pcode → région pour 19 370 zones et 1 280 sites à chaque appel (`monitoring.repository.js:573`, utilisée à `:1510` et `:1649`). Les 24 autres requêtes de `reportMonitoringData` prennent environ 100 ms au total, le calcul JS 65 ms | `scripts/prof_render.js` (chronométrage de chaque requête) |
| Régions par clés distinctes (prototype du lot 1b, `prof/region_new.sql`) | 1,9 / 4,1 / 2,5 ms, mêmes 7 lignes | `scripts/region_bench.sql` |
| 50 312 soumissions simulées (lecture seule, `generate_series` × 152 sur la fiche GD, 57 indicateurs) | chemin actuel : lecture JSONB 4,6 s + `computeAll` 3,7 s + par bureau 3,7 s ≈ **12 s et 674 Mo de tas par fiche** | `scripts/bench50k.js` |
| Projections JSONB côté SQL (`jsonb_object_agg`, `data->'k'`, `jsonb_build_object`) | 3,5 à 33 s : le JSONB est compressé (2,9 Ko stockés, 6 Ko en texte) et chaque extraction le décompresse. Expédier les lignes est toujours le plus lent | `bench50k.js`, `bench50k_cols.js`, `bench50k_obj.js`, `bench50k_lat.js` |
| Histogramme SQL « variable × valeur » | `jsonb_each` filtré : **0,9 s** ; un `CASE` par indicateur (priorité du nom exact) : **1,2 s** ; découverte des variantes de nom : 0,3 s ; regroupé bureau × mois : 2,3 s ; `DISTINCT ON` : 7,4 s (rejeté) ; comptages seuls : 78 ms | `bench50k.js`, `bench50k_c2.js`, `bench50k_c2m.js`, `bench50k_gs.js`, `bench50k_keys.js` |
| Exactitude de l'histogramme comparé au calcul ligne à ligne | **0 écart** sur 57 indicateurs (GD) et sur les 69 indicateurs des 3 fiches de la base de dev. Prototype complet : 319 ms, contrôle ligne à ligne compris | `bench50k_c2.js`, `proto_c1.js` |
| Chiffre faux du retour 18 | « Couverture des sites **435,9 %** » = 170 « clés » distinctes ÷ 39 sites actifs. Les clés viennent de `COALESCE(site_id, site, admin3)` : seulement 2 vrais sites, le reste sont des noms bruts et des communes (`reportData.js:118-154`, `monitoring.repository.js:1620`). Contraire à la définition commune (sites **actifs réalisés** ÷ actifs) | API `render` + SQL |
| Tableaux qui débordent | « Scores par domaine » : **1 754 px et 1 654 px** dans une page de 502 px ; bulletin : 562 et 510 px | `shots_now.js` |
| Pauvreté du catalogue | 10 jeux de données (`reportModel.js:35`), 15 chiffres clés (`:84`), en-tête et pied = une ligne de texte (`:117`), orientation unique pour tout le document, statuts `draft`/`final` seulement (migration 044). La palette utilise le rouge comme 5ᵉ couleur de série (`ReportBlocks.jsx:14`) | lecture du code |

---

## 2. Principes (les règles de `CLAUDE.md` et du plan, appliquées au concepteur)

1. **Un calcul, une source.** Chaque bloc de données appelle la fonction de service qui calcule déjà ce chiffre ailleurs dans MEMS (tableau du § 4). Le concepteur n'ajoute qu'une **mise en forme pure** (`shape`, sans I/O, testée). Le navigateur ne recalcule rien : il formate.
2. **Définitions communes obligatoires** (`docs/PLAN_RETOURS_15_37.md`) :
   - couverture = sites actifs réalisés ÷ sites actifs ; planification = prévus ÷ actifs ; exécution = réalisées parmi les prévues ÷ prévues ;
   - sites **distincts** sur la plage ; « — aucun plan », jamais « 0 % » ;
   - période = plage `{from, to}` ;
   - un bureau s'affiche toujours par son nom (`codeLabelText`), jamais par un code seul ;
   - visite = site × mois de collecte.

   Le concepteur **lit** ces chiffres dans le service du lot 1b, puis du lot 4. Il ne les redéfinit jamais.
3. **Jamais de page blanche.** Le contenu fixe s'affiche sans attendre le serveur ; chaque bloc de données vit sa propre vie (attente, calcul, résultat, vide, erreur).
4. **Ce qui s'affiche est ce qui s'imprime.** La pagination est calculée une fois, puis réutilisée telle quelle par l'aperçu, le PDF (feuilles pré-découpées) et le PowerPoint (une diapositive par page). Word re-pagine lui-même mais garde les sections et leurs orientations.
5. **Validé = figé.** Une version soumise ou validée enregistre son contenu, ses données calculées et l'état des données à la capture. Rien ne peut plus la modifier, ni l'API, ni l'application, ni un script : la base l'interdit.
6. **Fiabilité.**
   - Validation zod à l'entrée, contraintes CHECK / UNIQUE / FK et déclencheurs en base.
   - Écritures en plusieurs requêtes dans `withTenantTransaction`.
   - Verrou de ligne (`FOR UPDATE`) et verrou optimiste (`version`).
   - Montants en centimes entiers : les sources budgétaires existantes le font déjà, les `shape` ne refont aucune somme flottante.
   - Requêtes sur un même client toujours l'une après l'autre (`await`).
   - Agrégation en SQL ; aucune requête dans une boucle sur des lignes.

---

## 3. Modèle de document v2

### 3.1 Structure (zod, `server/src/modules/reports/reportSchema.js`, nouveau)

```js
const mm = z.number().min(0).max(400);           // millimètres
const pct = z.number().min(0).max(100);          // % de la largeur imprimable
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const FONTS = ['Inter', 'IBM Plex Sans', 'Arial', 'Georgia'];   // Inter et Plex sont livrées par @fontsource
const textStyle = z.object({
  font: z.enum(FONTS).default('Inter'), size: z.number().min(6).max(36).default(9),
  bold: z.boolean().default(false), italic: z.boolean().default(false),
  color: color.default('#616a7a'), align: z.enum(['left', 'center', 'right']).default('left'),
}).default({});
const el = { id, x: pct, y: mm, w: pct.min(1), h: mm.min(2) };
const bandElement = z.discriminatedUnion('kind', [
  z.object({ ...el, kind: z.literal('text'), text: z.string().max(300), style: textStyle }),  // texte + {variables}
  z.object({ ...el, kind: z.literal('image'), assetId: z.string().uuid() }),               // ajusté (contain)
  z.object({ ...el, kind: z.literal('pageNumber'), format: z.enum(['n', 'n / N', 'Page n', 'Page n / N']).default('Page n / N'), style: textStyle }),
  z.object({ ...el, kind: z.literal('line'), thickness: z.number().min(0.25).max(3).default(0.5), color: color.default('#e7e9ef') }),
]);
const band = z.object({ height: z.number().min(0).max(60).default(14), elements: z.array(bandElement).max(20).default([]) })
  .superRefine((b, ctx) => b.elements.forEach((e, i) => {
    if (e.x + e.w > 100.001) ctx.addIssue({ code: 'custom', path: ['elements', i, 'w'], message: 'Élément hors de la largeur' });
    if (e.y + e.h > b.height + 0.001) ctx.addIssue({ code: 'custom', path: ['elements', i, 'h'], message: 'Élément hors de la hauteur' });
  }));
const margins = z.object({ top: mm.min(5).max(40).default(16), right: mm.min(5).max(40).default(14), bottom: mm.min(5).max(40).default(16), left: mm.min(5).max(40).default(14) }).default({});
const pageSetup = z.object({
  size: z.enum(['A4', '16:9']).default('A4'), orientation: z.enum(['portrait', 'landscape']).default('portrait'),
  margins, header: band, footer: band,
  firstPage: z.enum(['same', 'none', 'own']).default('same'), firstHeader: band.optional(), firstFooter: band.optional(),
  draftWatermark: z.boolean().default(true),     // « BROUILLON — non validé » sur les exports non validés
}).default({});
const officeRef = z.union([z.string().uuid(), z.literal('unlinked'), z.literal('all')]);  // 'all' = ignorer le filtre du rapport
const reportFilters = z.object({
  officeId: z.union([z.string().uuid(), z.literal('unlinked')]).optional(),
  activity: z.string().trim().min(1).max(160).optional(),       // catégorie d'activité (sites.activity / fiche.activity_category)
  formId: z.string().uuid().optional(), partnerId: z.string().uuid().optional(),
}).default({});
const blockFilters = z.object({
  period: z.object({ from: monthStr, to: monthStr }).refine((p) => p.from <= p.to).optional(),
  officeId: officeRef.optional(), activity: z.union([z.string().max(160), z.literal('all')]).optional(),
  formId: z.union([z.string().uuid(), z.literal('all')]).optional(), partnerId: z.union([z.string().uuid(), z.literal('all')]).optional(),
  module: z.string().max(120).optional(),
}).default({});
const figure = z.object({
  title: z.string().max(200).optional(), subtitle: z.string().max(300).optional(),
  source: z.string().max(300).optional(),        // vide = source automatique du jeu de données
  note: z.string().max(500).optional(),
  numbered: z.boolean().default(true), showN: z.boolean().default(true), labels: z.boolean().default(true),
}).default({});
```

### 3.2 Blocs (racine, colonnes ou section répétée)

| Type | Paramètres | Nouveau ? |
|---|---|---|
| `heading` | `text` (≤ 300, variables), `level` 1–3 | existant |
| `text`, `callout` (`tone` : info / success / warning / critical), `bulletin` | `doc` (texte riche structuré, jamais de HTML) | existant |
| `kpis` | `metrics` 1–8 du catalogue des chiffres clés (§ 4.3), `filters` | étendu (38 chiffres au lieu de 15) |
| **`data`** | `dataset` (clé du registre), `view` ∈ table / bar / column / line / donut / stacked / heat / kpi / list / card / explain / map, `measure`, `columns`, `sort {key, dir}`, `limit` 1–500, `args` (ex. `indicatorId`, `contractId`, `partnerId`, `threshold`), `filters` (blockFilters), `figure`, `palette` ∈ sober / status / categorical | **nouveau** : remplace `table` et `chart` |
| **`section`** | `orientation`, `size` (A4 / 16:9), `header` et `footer` ∈ inherit / none, `title` (pour le plan). Commence une nouvelle page | **nouveau** (retour 53) |
| **`columns`** | `ratio` ∈ 1:1 / 2:1 / 1:2 / 1:1:1, `cols`. Chaque colonne contient ≤ 10 blocs feuilles : ni colonnes, ni section, ni section répétée | **nouveau** (fiches 2 pages, infographie) |
| **`image`** | `assetId`, `width` 10–100 %, `align`, `caption` | **nouveau** |
| **`toc`** | `depth` 1 / 2 (titres + numéros de page de la pagination) | **nouveau** |
| **`approval`** | aucun paramètre : cartouche « Préparé / Soumis / Validé par … le … · version n », vide en brouillon | **nouveau** |
| `spacer` | `height` mm | **nouveau** |
| `pagebreak`, `divider` | aucun | existant |
| `repeat` | `over` ∈ activity / bureau / **partner**, `blocks` (feuilles + `section` + `columns`). Au plus 30 éléments dépliés, sinon 400 « filtrez » | étendu |

```js
const reportDocV2 = z.object({
  schemaVersion: z.literal(2), title, period: { from, to },
  filters: reportFilters, page: pageSetup, blocks: z.array(block).max(200), lang: z.enum(['fr', 'en']).optional(),
}).superRefine(/* identifiants uniques (repeat + columns compris), ≤ 200 blocs au total, ≤ 12 images, JSON ≤ 1 Mo */);
```

Les paramètres propres à un jeu de données sont vérifiés par la fonction pure `validateBlockParams(def, params)` du registre : vue autorisée, `args` requis, mesure et colonnes connues. Une erreur renvoie **400** avec le chemin du bloc.

### 3.3 Filtres et héritage

- **Filtres effectifs d'un bloc** : `période = bloc.period ?? rapport.period` ; pour chaque clé, `bloc.x === 'all'` → aucun filtre ; sinon `bloc.x ?? élément répété.x ?? rapport.filters.x`. La fonction pure `effectiveFilters(doc, block, repeatItem)` est testée.
- **Bureau** : par **identifiant** (`field_offices.id`), plus jamais par nom (`reportModel.js:96` filtre aujourd'hui sur un nom libre). Le choix spécial `unlinked` désigne les soumissions dont le bureau n'est relié à aucun bureau MEMS ; elles s'affichent « Bureau non relié (code 6) » grâce à `officeLabelSql` (`monitoring.repository.js:1351`) et `codeLabelText` (`common/codeLabel.js:54`).
- **Filtre non pris en charge** : un jeu de données qui ne sait pas filtrer par une dimension renvoie `{ rows: [], note: 'Non disponible par bureau.' }`. C'est la règle actuelle de `notByBureau` (`reportData.js:100`), généralisée : jamais un total national présenté comme celui d'un bureau.
- **Mode de période** de chaque jeu de données, affiché dans la ligne de source :
  - `range` : la plage ;
  - `asOf` : situation au dernier mois de la plage ;
  - `year` : année du dernier mois ;
  - `now` : aujourd'hui (alertes).

### 3.4 Variables

- `{titre} {periode} {date_edition} {bureau} {activite} {partenaire} {statut} {version} {valide_par} {valide_le} {section}` : substituées par le serveur, qui renvoie avec le plan les textes d'en-tête et de pied déjà remplis.
- `{page} {pages}` : posées par la pagination (aperçu, PDF, PPTX) ou par un champ Word `PAGE` / `NUMPAGES`.
- **Chiffres clés** (§ 4.3) dans les textes : calculés comme des blocs de données, donc affichés « … » puis remplis à l'arrivée.
- **Variable inconnue** : laissée telle quelle et signalée dans l'éditeur (soulignement ondulé avec « Variable inconnue »).

### 3.5 Mise à niveau v1 → v2 (pure, à la lecture ; aucune migration de données)

`reportUpgrade.js` : `upgradeDoc(v1, { officeIdByName }) → { doc, warnings }`.

| Avant (v1) | Après (v2) |
|---|---|
| `page.header` (chaîne) | élément `text` (x 0, w 100, 8 pt, gris) ; `{periode}` conservé |
| `page.footer` | élément `text` à gauche |
| `showPageNumbers` | élément `pageNumber` à droite |
| `table` | `data` avec vue `table` |
| `chart` `bar` / `line` / `matrix` | `data` avec vue `bar` / `line` / `heat` |
| `activity_coverage` | `cov.by_activity` |
| `activity_domains` | `mon.domains_by_activity` |
| `bureau_domains` | `mon.domains_by_bureau` |
| `indicator_list` | `mon.indicators` |
| `bureau_coverage` | `cov.by_office` |
| `plan_vs_actual` | `cov.monthly` |
| `completeness_monthly` | `cov.completeness_monthly` |
| `region_submissions` | `mon.by_region` |
| `budget_contracts` | `bud.by_contract` |
| `pdd_by_month` | `pdd.by_month` |
| chiffre `sites_visited` | `sites_realised` |
| chiffre `visits_done` | `visits_realised` |
| chiffre `sites_visited_all` | `sites_with_data` |
| `filters.bureau` (nom) | `officeId`, via la table des bureaux du client. Nom introuvable : filtre retiré et avertissement sur le bloc |

- **Où s'applique la mise à niveau** : à la lecture (`GET /documents/:id`, `GET /templates`) et à la validation de toute entrée v1 (anciens onglets ouverts).
- **Enregistrement** : il écrit du v2, avec `schemaVersion: 2`.
- **Garanties** : la mise à niveau est idempotente sur un document v2, et les documents déjà finalisés (devenus « validés ») gardent leurs données figées.
- **Bandeau sur un brouillon v1 rouvert** : « Les chiffres de couverture suivent désormais la définition commune (sites actifs réalisés ÷ sites actifs) : ils peuvent différer de l'ancienne version. »

---

## 4. Catalogue de blocs = tout ce que MEMS saisit ou calcule

### 4.1 Architecture du registre (`server/src/modules/reports/catalog/` et `sources/`)

- **Jeu de données** (`catalog/<domaine>.js`, déclaration pure) : `{ key, label, group, origin: { page, route }, source, args, filters: ['period','office','activity','partner','form','module'], periodMode, views, defaultView, columns, measures, shape(raw, effFilters, ctx) → { columns, rows, meta } }`.
  - `origin` alimente la mention « Même calcul que : Couverture & performance » dans le catalogue.
  - `meta` = `{ n, nLabel, source, asOf, note, definition, warnings }`.
- **Source** (`sources/<domaine>.js`) : `{ key, domains, load(tenantId, params) }`. **Seule cette couche appelle les dépôts ou services existants** ; elle n'écrit jamais de SQL elle-même. Une source est l'unité de cache : plusieurs jeux de données partagent la même source et un seul calcul.
- **Registre** (`catalog/index.js`) : réunit les jeux de données, vérifie au démarrage qu'aucune clé n'est en double et que toute source citée existe, puis expose `catalog()` au client (libellés en français ; le client les traduit avec `tr()`).

### 4.2 Le catalogue (64 jeux de données)

Tous les jeux de données acceptent le filtre **période**. La colonne « Filtres » liste les filtres en plus de la période.

#### Suivi de processus (`mon.*`)

Ces jeux de données reposent sur la source `monitoringForms` (§ 5.1), qui réutilise :
- les calculs purs de `monitoringMath.js` : `tallyIndicator` (:60), le décompte pondéré, `overallIndex` (:293), `classify` (:161), `naReason` (:326) ;
- les mises en forme de `coverageDashboard.js` : `classDistribution` (:18), `naReasonCounts` (:30), `dimGroups` (:54), `topFlop` (:76).

| Clé | Bloc | Vues | Réutilise | Filtres | Dépend |
|---|---|---|---|---|---|
| `mon.kpis_data` | Données versées (soumissions, sites du registre avec données, communes, agents, partenaires, bureaux) | kpi, table | comptages de `coverageDashboard` (`monitoring.repository.js:1493`) ; « sites » = `count(DISTINCT site_id)`, et non les noms bruts | bureau, activité, partenaire, fiche | — |
| `mon.trend_submissions` | Tendance mensuelle des soumissions (12 mois jusqu'à la fin de période) | line, column, table | `monthlyTrend` (:1403), axes `chartAxis.tickIndexes/yScale` | activité, fiche | — |
| `mon.by_bureau` | Données versées par bureau | bar, table | `processOverview.byBureau` (:1418) + `officeLabelSql` (:1351) + `codeLabelText` | activité, fiche | — |
| `mon.by_region` | Données versées par région | bar, table | requête des régions par clés distinctes | bureau, activité | lot 1b ou C1 |
| `mon.forms_index` | Conformité par activité (indice, soumissions, nombre d'indicateurs) | bar, table | `perForm` de `processOverview` → `formResults` (:1307) | bureau, partenaire | C1 |
| `mon.conformity_classes` | Répartition des indicateurs en 5 classes (global, par activité) | stacked, donut, table | `classDistribution` | bureau, activité, fiche | C1 |
| `mon.domains` | Profil par module (score moyen par domaine) | bar, table | `dimGroups` | bureau, fiche, partenaire | C1 |
| `mon.domains_by_activity` | Scores par domaine × activité | heat, table | `dimGroups` par fiche (ex-`activity_domains`) | bureau, partenaire | C1 |
| `mon.domains_by_bureau` | Scores par domaine × bureau (une fiche) | heat, table | regroupement par bureau de l'histogramme + `dimGroups` (ex-`bureau_domains`) | fiche (requise hors répétition), partenaire | C1 |
| `mon.indicators` | Liste des indicateurs (valeur, n, cible, classe, raison si non évalué) | table, bar | résultats + `classify` + `naReason` (ex-`indicator_list`) | fiche, module, bureau, partenaire | C1 |
| `mon.indicator_bars` | Barres d'indicateurs par thème (libellé, barre, %, n), comme la page 2 du rapport PowerPoint | bar (groupé par module) | mêmes résultats | fiche, module, bureau | C1 |
| `mon.top_flop` | Points forts et points faibles | list | `topFlop` | fiche, bureau | C1 |
| `mon.weak_modules` | Modules à renforcer en priorité (score < seuil, `args.threshold`, 65 par défaut) | list, bar | `dimGroups`, trié | fiche, bureau | C1 |
| `mon.index_trend` | Tendance de l'indice de conformité par mois | line, table | histogramme par mois + `overallIndex` | fiche, bureau, partenaire | C1 |
| `mon.bureau_compare` | Performance et comparaison des bureaux (indice par bureau) | bar, table | histogramme par bureau + `overallIndex` | fiche, partenaire | C1 |
| `mon.indicator_card` | Carte de résultat infographique : anneau du %, n, phrase d'interprétation, encadré d'alerte sous le seuil (retour 45) | card | `computeIndicator` + `classify` ; phrase pure `interpretIndicator(result, lang)` (fr / en) | fiche, bureau ; `args.indicatorId` requis | C1 |
| `mon.indicator_explain` | Comment c'est calculé : méthode, numérateur ÷ dénominateur, distribution, exclusions | explain | `indicatorPreview` (:377) → `explainIndicator` (`monitoringMath.js:230`), sans modification (correctifs du lot 1 en cours) | fiche ; `args.indicatorId` | — |
| `mon.na_reasons` | Pourquoi « Non évalué » | table, bar | `naReasonCounts` | fiche | C1 |
| `mon.agent_quality` | Qualité de saisie par agent : soumissions, sites, % de réponses vides ou hors base sur les indicateurs notés | table, bar | histogramme par `agent_id` (migration 059) ; décompte `blank + naExcluded ÷ total` de `tallyIndicator`. **Nouvelle mesure** (§ 19, Q1) | fiche, bureau, partenaire | C1 |
| `mon.submissions_list` | Données réelles de la période (liste bornée) | table | `listSubmissions` (:1667), à étendre à `from/to` par le lot 1b | activité, bureau | lot 1b |

#### Couverture et plan (`cov.*`, `plan.*`)

La source est le **service des faits site × mois du lot 1b**, prototypé dans `prof/facts.sql` : sites actifs, prévus, réalisés et hors plan par bureau, district ou activité, sur une plage, en sites distincts. Le lot 4 y branchera « réalisée = données rattachées au site ».

| Clé | Bloc | Vues | Réutilise | Filtres | Dépend |
|---|---|---|---|---|---|
| `cov.kpis` | Sites actifs, prévus, réalisés, couverture, planification, exécution, visites, hors plan | kpi | faits du lot 1b | bureau, activité, partenaire | lot 1b |
| `cov.by_activity` | Couverture par activité, avec statut (Bon / Moyen / Faible / Critique) et constat éditable par ligne (tableau du rapport PowerPoint, p. 1) | bar, table | faits du lot 1b, `GROUP BY activité` | bureau | lot 1b |
| `cov.by_office` | Couverture par bureau (sites actifs, prévus, réalisés, taux) | bar, table | faits du lot 1b, `GROUP BY bureau` (remplace `reportFieldData`, `field.repository.js:699`) | activité | lot 1b |
| `cov.by_district` | Couverture par district | bar, table, map | faits du lot 1b, `GROUP BY district` | bureau, activité | lot 1b (6a pour la carte) |
| `cov.monthly` | Plan et réalisé par mois | column, line, table | faits du lot 1b par mois (`reportFieldData.monthly` jusque-là) | bureau, activité, partenaire | lot 1b |
| `cov.completeness_monthly` | Complétude mensuelle par activité (sites réalisés ÷ actifs, par mois) | heat, line, table | faits du lot 1b par mois × activité (remplace `reportData.js:72`, dont la base était fausse) | bureau | lot 1b |
| `cov.matrix` | Matrice mensuelle programme × prestataire (planifiées, réalisées, taux) | heat, table | `coverageMatrix` (:533) + `buildCoverageMatrix` (`fieldMath.js:94`) ; mode `year` | partenaire | — |
| `cov.recap_risk` | Récapitulatif par niveau de risque (visites requises MMR / réalisées) | table, bar | `coverageRecapSummary` (:504) + `coverageRecap` | district | — |
| `cov.visits_by_provider` | Visites par prestataire (planifiées, réalisées, annulées) | bar, table | `summary` (:480) + `summarizeVisits` (`fieldMath.js:24`) ; mode `asOf` | bureau, activité | — |
| `cov.collection_days` | Jours de collecte par prestataire (visite + déplacement) | table | `collectionDaysSummary` (:571) + `collectionDays` (`fieldMath.js:61`) ; mode `asOf` | partenaire | — |
| `cov.months` | Tableau des mois (statut du plan, planifiées, réalisées) | table | `monthsOverview` (:392) ; mode `year` | — | — |
| `plan.kpis` | Plan de suivi : sites, exigées, faites, prévues, reste | kpi | `planBoard` (:729) + `boardKpis` (`planBoard.js:73`) ; mode `year` | bureau, activité | — |
| `plan.priorities` | Sites à planifier par priorité | table (bornée) | lignes de `planBoard` + `rankSites` (`planBoard.js:56`) | bureau, activité | — |

#### Risk-Based Monitoring et sites (`rbm.*`, `sites.*`)

| Clé | Bloc | Vues | Réutilise | Filtres | Dépend |
|---|---|---|---|---|---|
| `rbm.kpis` | Sites suivis, à suivre, par niveau de risque | kpi | `rbmSites` (`field.repository.js:159`) + **`tpm/rbmSummary.js`** (nouveau, pur : le calcul que `DashboardCoveragePage.jsx:70` fait aujourd'hui dans le navigateur) ; mode `asOf` | bureau, activité | — |
| `rbm.by_risk` | Répartition des sites par risque | donut, bar | idem | bureau, activité | — |
| `rbm.due_sites` | Sites à suivre (priorité, dernière visite, raisons) | table (bornée) | lignes de `rbmSites` (`scoreSite`, `rbmScore.js:49`), sans modification (correctifs du lot 1 en cours) | bureau, activité | — |
| `rbm.flags` | Signaux de risque (nombre de sites par drapeau) | bar, table | champs de `scoreSite` déjà renvoyés ; libellés `FINAL_LABEL` / `PRIORITY_LABEL` | bureau | lot 5 pour « Pourquoi ? » |
| `sites.registry` | Registre : sites par bureau, district et activité (total, actifs) | table, bar | `listSites` (:29) + `registryCounts` (`mmrMath.js:137`) | bureau, activité | — |
| `sites.mmr` | Paramètres MMR (visites requises, capacité) | table | `summarizePlan` (`mmrMath.js:114`) | bureau | — |

#### Carte (`map.*`)

| Clé | Bloc | Vues | Réutilise | Filtres | Dépend |
|---|---|---|---|---|---|
| `map.districts` | Choroplèthe des districts (sites actifs, visités, couverture, risque, données versées), légende graduée, source | map | source de la carte du **lot 6a** (contours des 119 districts) | bureau, activité | **lot 6a** |
| `map.points` | Sites et points de collecte | map | source du lot 6a ; repli `mapData` (`field.repository.js:436`) | bureau | lot 6a |

#### Budget et contrats (`bud.*`, `ctr.*`)

| Clé | Bloc | Vues | Réutilise | Filtres | Dépend |
|---|---|---|---|---|---|
| `bud.kpis` | Budget, planifié, réalisé, consommation, restant, projection | kpi | `consolidation` (`consolidation.repository.js:21`) + `buildConsolidation` (`consolidation.js:74`), en centimes ; mode `asOf` | partenaire | — |
| `bud.by_contract` | Situation par contrat (budget, planifié, réalisé, taux, restant, projection) | table, bar | idem (ex-`budget_contracts`) | partenaire | — |
| `bud.monthly` | Matrice mensuelle Réalisé / Planifié / Écart | heat, table, line | `monthly` de la consolidation | partenaire | — |
| `bud.by_partner` | Réalisé par prestataire (anneau du Dashboard décisionnel) | donut, bar | lignes de la consolidation | — | — |
| `ctr.list` | Contrats (statut avec icône, partenaire, dates, total de l'accord) | table | `contracts.service.listContracts` (:99) | partenaire | — |
| `ctr.expiring` | Contrats à échéance dans 90 jours ou moins | table, list | `contractAlerts` (`alertsMath.js:71`) | partenaire | — |
| `ctr.forecast` | Prévision de consommation d'un contrat | line, table | `contracts.service.forecast` (:451) + `buildForecast` (`forecast.js:35`) | `args.contractId` | — |
| `ctr.budget_items` | Budget détaillé d'un contrat par section I à V | table | `getContractDetail` (:140), postes | `args.contractId` | — |

#### Partenaires et TPM (`tpm.*`)

| Clé | Bloc | Vues | Réutilise | Filtres | Dépend |
|---|---|---|---|---|---|
| `tpm.reports_status` | Rapports TPM attendus, soumis, validés et rejetés par prestataire × mois | heat, table | `listReports` (`tpm/reports.repository.js:108`) | partenaire | — |
| `tpm.plans` | Plans de collecte (planifié bailleur par mois) | table, column | `listPlans` (`planning.repository.js:80`) | partenaire | — |
| `tpm.providers` | Prestataires, agents actifs, formations | table | `listProviders` (`tpm.repository.js:14`) | partenaire | lot 8 enrichit |
| `tpm.agent_evaluations` | Évaluations des agents (note, appréciation) | table, bar | `listAgentsEvaluation` (:49) | partenaire | lot 8 enrichit |
| `tpm.partner_sheet` | Fiche 360° (budget, réalisé, visites assignées et réalisées, agents, factures en attente) | kpi, table | `partners.repository.sheet` (:27) + `buildFacts` (`partnerSheet.js:15`) | `args.partnerId` ou répétition par partenaire | — |
| `tpm.partner_timeline` | Parcours du partenaire (24 mois) | list (bornée) | `timeline` (:83) | `args.partnerId` | — |
| `tpm.invoice` | État des dépenses d'une facture par section | table | `invoiceData` (:153) | `args.reportId` | — |

#### Distribution d'urgence (`pdd.*`)

| Clé | Bloc | Vues | Réutilise | Filtres | Dépend |
|---|---|---|---|---|---|
| `pdd.kpis` | Bénéficiaires, ménages, vivres (t), cash (USD), distributions | kpi | `reportPddByMonth` (`pdd.repository.js:149`) | — (non disponible par bureau) | — |
| `pdd.by_month` | Distributions par mois | column, table | idem | — | — |
| `pdd.by_hazard` / `pdd.by_zone` / `pdd.by_commodity` | Par type de choc, par zone (région → district → commune), par denrée | bar, table | `summaryData` (:50) + `summarize` (`pddMath.js:22`) | région, district (arguments) | — |
| `pdd.pipeline` | Pipeline besoin / stock par denrée (écart, couverture, ruptures) | table, bar | `pipelineData` (:64) + `pipeline` (`pddMath.js:61`) ; mode `asOf` | — | — |

#### Alertes (`alerts.*`)

| Clé | Bloc | Vues | Réutilise | Filtres | Dépend |
|---|---|---|---|---|---|
| `alerts.list` | Alertes (niveau avec icône et libellé, module, message) | list, table | `alerts.service.alerts(auth)` (`alerts.service.js:23`) + `buildAlerts` (`alertsMath.js:128`) : **même source que la cloche et le Centre d'alertes**, lue sans modification ; mode `now` | — | correctifs du lot 1 |
| `alerts.counts` | Nombre d'alertes critiques, à surveiller, à traiter | kpi | `countAlerts` (:139) | — | — |

**Total : 64 jeux de données** (20 suivi de processus, 13 couverture et plan, 6 RBM et sites, 2 carte, 8 budget et contrats, 7 TPM, 6 PDD, 2 alertes), plus 14 types de blocs de composition.

Les jeux qui dépendent d'un lot non publié sont renvoyés avec `available: false` et une raison (« Disponible avec le lot 1b »). Le catalogue les montre grisés : ils ne sont jamais calculés sur une ancienne base.

### 4.3 Chiffres clés (bloc `kpis` et variables de texte) : 38

Chaque chiffre est déclaré une fois : `{ key, label, unit: int|pct|money|mt, source, pick(raw) → { value, base?, note? } }`. Une valeur sans base s'affiche « — » avec sa raison (« — aucun plan »).

| Groupe | Chiffres |
|---|---|
| Couverture (lot 1b) | `sites_active`, `sites_realised`, `coverage`, `sites_planned`, `planning_rate`, `execution_rate`, `visits_realised`, `visits_planned`, `visits_unplanned` |
| Données | `submissions`, `sites_with_data`, `communes_with_data`, `agents_with_data`, `forms_active` |
| Conformité | `conformity`, `indicators_scored`, `indicators_urgent`, `indicators_excellent` |
| RBM | `rbm_sites`, `rbm_due`, `rbm_high_risk` |
| Budget | `budget_total`, `budget_planned`, `budget_actual`, `consumption`, `budget_remaining`, `contracts_active`, `contracts_expiring` |
| TPM | `reports_to_validate`, `reports_validated`, `agents_active`, `trainings` |
| PDD | `pdd_beneficiaries`, `pdd_households`, `pdd_food`, `pdd_cash` |
| Alertes | `alerts_critical`, `alerts_watch` |

`computeKpis` (`reportData.js:118`) est supprimé : son calcul de couverture est la cause du 435,9 %.

### 4.4 Hors de 7a (prévu ailleurs)

- **Lot 7b** : bouton « Ajouter au rapport » sur chaque carte des tableaux de bord (la clé du jeu de données est déjà commune), modèles fidèles (rapport A4 de 5 pages, présentation 16:9 du CCO, fiche 2 pages, fiche infographique) et blocs issus des lots 4 et 5.
- **Lot 6** : carte imprimable complète (surcouches, carte de situation).

---

## 5. Moteur de rendu progressif et cache

### 5.1 Indicateurs : histogramme exact (même décompte)

**Changement minimal de `monitoringMath.js`** :

```js
// tallyIndicator (:60) — un poids par ligne (1 par défaut) : la MÊME boucle sert aux soumissions et aux histogrammes.
for (const s of submissions || []) {
  const w = s.w == null ? 1 : s.w;
  t.total += w; … t.absent += w … t.blank += w … bumpBy(t.naExcluded, valueKey(v), w) … t.answered += w; bumpBy(t.values, …, w);
  if (pct) { if (isYes(v, indicator.positiveValue) === 1) t.positives += w; } else if (numericAgg) { const n = toNumber(v); if (n != null) { t.numeric += w; t.sum += n * w; } }
}
```

On extrait aussi `indicatorMeta(ind)` de `computeAll` (:192) et on exporte `resultFromTally` (:87). `computeAll` et le chemin par histogramme partagent ainsi la construction de l'objet résultat.

**Nouveau dépôt `monitoring/indicatorFacts.repository.js`**. Toutes les requêtes passent par `withTenantTransaction` avec `tenant_id = $1` et `SET LOCAL statement_timeout = '15s'`, l'une après l'autre.

1. **`keyVariantsTx(client, tenantId, formId, neededLower)`**
   - Requête : `SELECT DISTINCT k FROM monitoring_submissions s CROSS JOIN LATERAL jsonb_object_keys(s.data) k WHERE s.tenant_id=$1 AND s.form_id=$2 AND lower(k) = ANY($3)`.
   - Coût mesuré : 0,3 s à 50 000 soumissions ; mis en cache (§ 5.3).
   - Donne, pour chaque variable, ses noms réels dans les données. C'est l'équivalent de `keyIndex`, calculé sur **toutes** les soumissions de la fiche, ce qui est exact pour `namesFor`.
2. **`histogramTx(client, tenantId, formId, period, filters, groupBy)`** (`groupBy` ∈ ∅ / bureau / mois / agent) :
   - **variable à un seul nom réel** (cas courant : 57 noms pour 57 variables) : `jsonb_each` filtré, puis `GROUP BY g, e.key, v`, avec `v = CASE jsonb_typeof(e.value) WHEN 'number' THEN (e.value::text)::float8::text WHEN 'null' THEN NULL ELSE e.value #>> '{}' END`. Le passage par `float8::text` reproduit `String(nombre)` de JavaScript (« 1.50 » → « 1.5 »). Coût mesuré : 0,9 s ;
   - **variable à plusieurs noms** (casse différente) : un `CASE WHEN data ? nom1 THEN … WHEN data ? nom2 …` par indicateur dans un `LATERAL (VALUES …)`, qui respecte la priorité du nom exact. Coût mesuré : 1,2 s. Au-delà de 60 indicateurs, ils sont traités en lots de 60, l'un après l'autre ;
   - **repli ligne à ligne**, seulement pour les indicateurs dont la variable est un **champ calculé** (formule JavaScript) ou dont une valeur est un tableau ou un objet JSON (détecté par `jsonb_typeof` dans la même requête). Le repli lit les soumissions par pages de 5 000 (clé `id`) et ne garde que les décomptes, jamais toutes les lignes. Aujourd'hui, 0 indicateur sur 69 dans ce cas ;
   - les bureaux sont regroupés par `officeLabelSql(...).key`, donc nommés par `codeLabelText`.
3. **`countsTx(...)`** : soumissions, `count(DISTINCT site_id)` (sites du registre avec données), communes, agents par groupe. Coût mesuré : 78 ms.

**Fonction pure `monitoring/histogram.js`** : `computeAllFromHistogram(indicators, hist, totals, variants)` construit, pour chaque indicateur, ses lignes pondérées `{ data: { [sourceField]: v }, w: n }` plus une ligne `{ data: {}, w: total − présentes }` (les absents), puis appelle `computeIndicator`. Le décompte par bureau est sommable : le total se déduit des groupes (`mergeTallies`) sans relire les données.

**Ce qui est branché sur ce chemin** : `formResults` (`monitoring.repository.js:1307`) et `reportMonitoringData` (:1588) délèguent à `indicatorFacts`. Synthèse, Couverture & performance et concepteur utilisent donc **un seul** calcul, désormais rapide. `indicatorPreview` (:377) garde son chemin ligne à ligne : une seule variable, explication détaillée.

### 5.2 Plan puis blocs (jamais de page blanche)

**Ouverture d'un rapport**, dans l'ordre :

1. `GET /documents/:id`, document mis à niveau. Le client affiche **immédiatement** :
   - titres, textes, encadrés et images ;
   - en-tête et pied, avec les variables simples remplies côté client à partir du document (titre, période) ;
   - pour chaque bloc de données, un squelette avec son titre ou le libellé du catalogue.
2. `POST /render/plan` (budget p95 < 300 ms, sans calcul lourd). Le serveur :
   - valide le document ;
   - déplie les sections répétées (fiches avec données, bureaux, partenaires) avec des requêtes de comptage indexées ;
   - attribue les identifiants d'instance (`iid` = `blocId` ou `repeatId~cléÉlément~blocId`) ;
   - numérote les figures et les tableaux dans l'ordre du document (`Figure 1`, `Tableau 1`) ;
   - liste les besoins (source + paramètres) ;
   - remplit les variables simples, ainsi que l'en-tête et le pied de chaque section ;
   - renvoie les versions des données.
3. Le client met les `iid` en file : **3 requêtes en parallèle au plus**, 8 blocs par requête, ceux de la page visible en premier (`IntersectionObserver`), puis le reste du document.
   - Chaque `POST /render/blocks` calcule ses blocs **l'un après l'autre**, sur un client du pool à chaque fois.
   - Une source déjà en cours de calcul est partagée (vol unique) ; une source en cache est servie directement.
4. **États d'un bloc** :
   - en attente ;
   - en calcul (squelette nommé + « calcul en cours · 0,8 s ») ;
   - prêt ;
   - vide (« Aucune donnée sur la période », « — aucun plan », « Non disponible par bureau ») ;
   - erreur (message lisible + « Réessayer »).

   Une erreur ne bloque jamais les autres blocs.
5. **Cache côté client** : le résultat est gardé par **signature de données** du bloc (`dataset`, filtres effectifs, `args`, période, versions des données). Modifier un texte, déplacer un bloc ou changer un titre ne relance aucun calcul ; changer un filtre ne recalcule que les blocs concernés. Un bouton « Actualiser les données » vide ce cache.

### 5.3 Cache serveur invalidé par les écritures

- **`reports/cache.js`** (pur, testé) : LRU borné à 500 entrées et 64 Mo (taille estimée du JSON), durée de vie de 30 min (hygiène mémoire, pas exactitude), plus le vol unique (une seule promesse en vol par clé ; une erreur n'est jamais mise en cache).
- **Clé** : `tenantId | source | hash stable des paramètres | versions des domaines de la source`.
- **Versions** (migration 064) : chaque instruction qui écrit dans une table métier insère une ligne `(tenant, domaine, xid)` dans `data_changes`, avec `ON CONFLICT DO NOTHING`. C'est une **insertion seule** : aucun verrou de ligne, aucun interblocage entre transactions.
- **Lecture des versions** : `count(*)` et `max(seq)` par domaine, plus l'époque de purge, en une requête d'environ 1 ms.
  - Une transaction non validée est invisible ; à sa validation, le compte change, donc la clé aussi.
  - Une entrée calculée avec des données plus récentes que sa clé n'est jamais servie après un changement.
  - Une purge (lignes de transactions terminées) incrémente l'époque dans la même transaction : aucune clé ancienne ne peut revenir.
- **Domaines** :
  - `submissions` : `monitoring_submissions`, `monitoring_value_links` ;
  - `monitoring_def` : `monitoring_forms`, `monitoring_indicators`, `monitoring_calc_fields`, `monitoring_form_fields`, `monitoring_choices`, `monitoring_field_map` ;
  - `sites` : `sites`, `site_month_status`, `field_offices`, `field_office_communes`, `admin_areas`, `location_aliases`, `mmr_parameters`, `activities` ;
  - `visits` : `site_visits`, `field_month_plans`, `tpm_collection_days` ;
  - `budget` : `contracts`, `contract_budget_items`, `contract_activities`, `contract_areas`, `contract_amendments`, `tpm_reports`, `contract_report_items`, `tpm_collection_plans`, `tpm_collection_plan_items`, `exchange_rates` ;
  - `partners` : `partners`, `partner_types`, `tpm_agents`, `tpm_agent_evaluations`, `tpm_agent_formations`, `tpm_assignments`, `tpm_mission_days` ;
  - `pdd` : `pdd_distributions`, `pdd_distribution_items`, `pdd_stock`, `pdd_commodities`.
- **Plusieurs processus API** : chacun a son LRU ; l'exactitude vient des versions lues en base.

### 5.4 Concurrence, délais, erreurs

- **Sémaphore par client** : au plus 4 calculs lourds simultanés par processus. Au-delà, attente ; après 20 s, **503** « Calcul en file d'attente : réessayez ».
- **Délai par requête** : `statement_timeout` de 15 s sur les requêtes des sources. Un dépassement (57014) devient une erreur **du bloc** (« Calcul trop long : réduisez la période ou ajoutez un filtre »). Hors rendu par blocs, 57014 est traduit en **503** par le gestionnaire central (une ligne dans `middleware/errors.js`, à côté de la règle de `lock_timeout`).
- **Mesure** : en-tête `Server-Timing: plan;dur=12, blk_perf-cov;dur=410;desc="miss", src_monitoringForms;dur=380` et journal pino `report.blocks` (clé, ms, cache, lignes).

---

## 6. API (`/api/report-designer`, `requireAuth` ; écriture et décision : `admin` ou `manager`)

| Méthode et route | Corps / requête | Réponse | Erreurs |
|---|---|---|---|
| `GET /catalog` | — | `{ catalogVersion, groups:[{ key, label, items:[datasetKey] }], datasets:{ [key]:{ label, group, origin, views, defaultView, filters, periodMode, args, columns, measures, available, reason } }, kpis, variables, templates, palette, pageSizes }` | — |
| `POST /render/plan?lang=fr` | `{ doc }` (v1 ou v2) | `{ periodLabel, vars, sections:[{ id, size, orientation, headerText:{ [elId]: string }, footerText }], instances:[{ iid, blockId, repeatKey?, needsData, figure:{ kind:'figure'|'table', n }?, title }], expansions:{ [repeatId]:[{ key, label, filters }] }, versions, computedAt }` | 400 (document invalide, avec chemin), 400 (> 30 éléments répétés) |
| `POST /render/blocks?lang=fr` | `{ doc, iids:[≤ 8] }` | `{ blocks:{ [iid]: { ok:true, data, meta:{ ms, cache, n, nLabel, source, asOf, warnings } } \| { ok:false, error:{ code, message } } } }` + `Server-Timing` | 400 (plus de 8 `iid`, `iid` inconnu), 503 (file d'attente) |
| `POST /render` | `{ doc }` | réponse complète (compatibilité, exports Excel et HTML) | idem |
| `GET /documents?status=` | — | liste avec `status`, `lastVersionNo`, `archivedAt`, `submittedBy`, `validatedBy` | — |
| `GET /documents/:id` | — | `{ …, content (v2), status, version, lastVersionNo, actions:{ edit, submit, withdraw, validate, reject, revise, archive, validateReason }, dataChangedSinceCapture }` | 404 |
| `POST /documents` / `PUT /documents/:id` | `{ content, version? }` | document | 400, 409 (version obsolète ou statut figé) |
| `POST /documents/:id/submit` | `{ version, comment? }` | document `soumis` + `versionNo`. Le serveur calcule **tous** les blocs (cache réutilisé) et enregistre la version figée | 409 (statut, version, modifications non enregistrées), 403 (rôle) |
| `POST /documents/:id/withdraw` | `{ version }` | `brouillon` (soumetteur seulement) | 403, 409 |
| `POST /documents/:id/validate` | `{ version, versionNo, comment? }` | `valide` | 403 (même personne que le soumetteur ou l'auteur), 409 (statut, `versionNo` différent) |
| `POST /documents/:id/reject` | `{ version, versionNo, comment (≥ 5 caractères), blockId? }` | `rejete` | 400 (commentaire manquant), 403, 409 |
| `POST /documents/:id/revise` | — | 201 : nouveau brouillon (`revisionOf`) copié depuis la dernière version | 409 si le document n'est pas validé |
| `POST /documents/:id/archive` | — | `archivedAt` (admin) | 403 |
| `DELETE /documents/:id` | — | supprime un brouillon **sans version figée** | 409 « Archivez-le » si une version existe |
| `GET /documents/:id/events` | — | historique (action, statuts, version, commentaire, bloc, auteur, date) | 404 |
| `GET /documents/:id/versions/:no` | — | `{ content, data, lang, capturedAt, capturedBy, dataVersions }` (immuable) | 404 |
| `POST /assets` | octets bruts (`express.raw`, 600 Ko au plus) + `?name=` | 201 `{ id, mime, width, height, bytes }` (déjà connu : 200, même id) | 400 (format nommé : « image SVG refusée », « document PDF »), 413 (> 512 Ko), 403 |
| `GET /assets/:id` | — | octets, `Content-Type` déduit des octets, `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none'`, `Cache-Control: private, max-age=31536000, immutable` | 404 (y compris un autre client) |
| `GET /assets` | — | liste pour le sélecteur | — |
| `POST /export.docx`, `POST /export.pptx` | `Content-Type: application/vnd.mems.report-export+json` (contourne la limite globale de 1 Mo ; limite de 15 Mo sur ces routes seulement) : `{ doc, layout, mapImages?:{ [iid]: dataUrlPng } }` | fichier | 400 (image non PNG), 413 |
| `GET /documents/:id/versions/:no/export.(docx\|pptx\|xlsx)` | — | export de la version **figée** (données de la version, jamais recalculées) | 404 |
| `POST /export.xlsx` | inchangé, plus une feuille « Lisez-moi » (période, filtres, sources, statut) | | |
| `POST /documents/:id/finalize` | **supprimée**, remplacée par `submit` puis `validate` | | |

`layout` (aperçu paginé) ne transporte **que** le découpage (quel bloc sur quelle page, lignes de tableau), jamais de chiffres. Le serveur recalcule les données, ou les lit dans la version figée.

---

## 7. Base de données

### 062_report_assets.sql (en-têtes, logos, images)

```sql
CREATE TABLE IF NOT EXISTS report_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  mime text NOT NULL CHECK (mime IN ('image/png', 'image/jpeg')),
  width integer NOT NULL CHECK (width BETWEEN 1 AND 4000),
  height integer NOT NULL CHECK (height BETWEEN 1 AND 4000),
  bytes integer NOT NULL CHECK (bytes BETWEEN 1 AND 524288),
  data bytea NOT NULL CHECK (octet_length(data) = bytes),
  name text CHECK (name IS NULL OR length(name) <= 120),
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, sha256)
);
ALTER TABLE report_assets ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON report_assets USING (tenant_id::text = current_setting('app.tenant_id', true));
GRANT SELECT, INSERT ON report_assets TO mems2_app;      -- immuables : ni UPDATE ni DELETE
SELECT mems_install_same_tenant('report_assets');
```

### 063_report_workflow.sql (fil de validation, versions figées, historique)

- **`report_documents`** :
  - on retire l'ancienne contrainte `CHECK ((status = 'final') = …)` (retrouvée par sa définition dans `pg_constraint`, bloc `DO`) ;
  - reprise des statuts `draft` → `brouillon` et `final` → `valide` ;
  - nouvelles colonnes `authored_by`, `submitted_by/at`, `validated_by/at`, `rejected_by/at`, `last_version_no int NOT NULL DEFAULT 0`, `revision_of uuid REFERENCES report_documents(id) ON DELETE SET NULL`, `archived_at`, `archived_by` ;
  - colonnes `snapshot` et `finalized_at` **conservées** (aucune migration destructive), plus écrites.
- **Contraintes** :
  - `status IN ('brouillon','soumis','valide','rejete')` ;
  - cohérence des dates avec le statut ;
  - **séparation des tâches** : `validated_by IS NULL OR ((submitted_by IS NULL OR validated_by <> submitted_by) AND (authored_by IS NULL OR validated_by <> authored_by))` ;
  - même règle pour `rejected_by` face à `submitted_by`.
- **Déclencheur `mems_report_doc_guard`** (BEFORE INSERT / UPDATE) :
  - création en `brouillon` uniquement ;
  - transitions permises : brouillon → soumis, rejete → soumis, soumis → valide / rejete / brouillon (retirer), ou statut inchangé ;
  - `content`, `title` et la période ne changent qu'en `brouillon` ou `rejete` ;
  - un document validé ne change plus, sauf `archived_*`.

  Violation : 23514, donc 400 ; l'API a déjà répondu 403 ou 409 avec un message clair.
- **`report_document_versions`** :
  - colonnes `id`, `tenant_id`, `document_id REFERENCES report_documents(id) ON DELETE RESTRICT`, `version_no ≥ 1`, `content jsonb ≤ 1 Mo`, `data jsonb ≤ 8 Mo`, `content_sha256`, `data_sha256`, `data_versions jsonb`, `lang`, `captured_by`, `captured_at`, `UNIQUE (document_id, version_no)` ;
  - `GRANT SELECT, INSERT` seulement, plus un déclencheur qui refuse UPDATE et DELETE : **append-only, même pour un script** ;
  - reprise : une version 1 pour chaque ancien document `final`, à partir de `snapshot` et `finalized_at`.
- **`report_document_events`** :
  - `action ∈ (creer, soumettre, retirer, valider, rejeter, reviser, archiver, commenter)`, statuts avant et après, `version_no`, `comment ≤ 2000` (≥ 5 caractères pour rejeter), `block_id`, `actor`, `at` ;
  - `GRANT SELECT, INSERT` ; suppression en cascade avec un brouillon supprimé.
- **Index** : `(tenant_id, status, updated_at DESC)`, `(tenant_id, document_id, version_no)`, `(tenant_id, document_id, at)`.
- **Sécurité** : RLS et politiques sur les deux tables, `SELECT mems_install_same_tenant('report_documents' | 'report_document_versions' | 'report_document_events')`.

### 064_data_changes.sql (versions des données pour le cache)

```sql
CREATE TABLE IF NOT EXISTS data_changes (
  seq bigserial PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  domain text NOT NULL CHECK (domain IN ('submissions','monitoring_def','sites','visits','budget','partners','pdd')),
  xid xid8 NOT NULL DEFAULT pg_current_xact_id(),
  at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, domain, xid)
);
CREATE INDEX IF NOT EXISTS idx_data_changes_tenant ON data_changes (tenant_id, domain, seq);
CREATE TABLE IF NOT EXISTS data_change_epochs (tenant_id uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE, epoch bigint NOT NULL DEFAULT 0);
CREATE OR REPLACE FUNCTION mems_data_changed() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE t text := NULLIF(current_setting('app.tenant_id', true), '');
BEGIN
  IF t IS NOT NULL THEN
    INSERT INTO data_changes (tenant_id, domain) VALUES (t::uuid, TG_ARGV[0]) ON CONFLICT (tenant_id, domain, xid) DO NOTHING;
  ELSE  -- maintenance (migration, seed) : tous les clients, par prudence
    INSERT INTO data_changes (tenant_id, domain) SELECT id, TG_ARGV[0] FROM tenants ON CONFLICT DO NOTHING;
  END IF;
  RETURN NULL;
END $$;
-- Bloc DO : pour chaque (table, domaine) de la liste du § 5.3 :
--   CREATE TRIGGER trg_data_changed AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON <table>
--   FOR EACH STATEMENT EXECUTE FUNCTION mems_data_changed('<domaine>');
-- RLS + politique tenant sur data_changes et data_change_epochs ;
-- GRANT SELECT, INSERT, DELETE ON data_changes ; GRANT USAGE ON SEQUENCE data_changes_seq_seq ;
-- GRANT SELECT, INSERT, UPDATE ON data_change_epochs TO mems2_app.
```

**Purge** (au plus une fois par heure et par client, après un rendu, sans bloquer la réponse), en une transaction :
1. incrémenter l'époque ;
2. supprimer les lignes de transactions terminées : `xid < pg_snapshot_xmin(pg_current_snapshot())`.

---

## 8. Fil de validation (retour 39)

**Règles pures** dans `server/src/modules/reports/reportDocWorkflow.js`, sur le modèle de `monitoring/mappingWorkflow.js` et de `tpm/reportWorkflow.js`.

```
brouillon ──Soumettre──▶ soumis ──Valider──▶ valide (définitif, lecture seule)
rejete    ──Soumettre──▶ soumis ──Rejeter (commentaire obligatoire)──▶ rejete
soumis    ──Retirer (le soumetteur)──▶ brouillon
valide    ──Nouvelle version──▶ nouveau brouillon (revision_of), la version validée reste intacte
```

- **Contenu modifiable** en `brouillon` et en `rejete` seulement.
- **Soumission** : elle exige un document enregistré (aucune modification en attente) et la bonne `version`. Elle enregistre `authored_by` (dernier éditeur), `submitted_by` et la **version figée n** (contenu + données de tous les blocs + versions des données + langue + empreintes SHA-256). Elle efface `rejected_by/at`.
- **Séparation des tâches** : la personne qui valide ou rejette n'est ni le soumetteur ni l'auteur du contenu (contrainte en base, 403 dans l'API). L'écran n'affiche que les actions que le serveur acceptera : `actions(state, actor)`, avec la raison (« Séparation des tâches : … »).
- **Ce que voit le validateur** : **exactement** la version soumise (`GET /versions/:no`). Si les données ont changé depuis la capture (versions différentes), un bandeau le dit : « Les données ont changé depuis la soumission (import du 14/10). Cette version reste celle soumise ; rejetez-la pour la faire recalculer. »
- **Commentaires** :
  - de décision (obligatoire pour un rejet) ;
  - ancrés sur un bloc (`blockId`, marqueur dans le plan et sur le bloc) ;
  - historique complet dans l'onglet « Validation ».
- **Suppression** : un document avec une version figée ne se supprime plus ; il s'archive (règle commune « un élément qui porte des données ne se supprime jamais »). L'ancienne suppression d'un « finalisé » par l'administrateur disparaît.
- **Exports** :
  - non validés : filigrane « BROUILLON — non validé » (réglable) et `{statut}` dans le pied ;
  - validés : depuis la version figée, chiffres identiques pour toujours.
- **Statuts à l'écran** : couleur + icône + libellé (`DESIGNER_STATUS` dans `web/src/lib/reportStatus.js`, icônes dans `STATUS_ICONS`, rendu par `<StatusBadge>`). Les badges remplacent ceux de la bibliothèque (`ReportDesignerPage.jsx:141`).

---

## 9. En-tête et pied de page libres (retour 51)

**Concepteur** (`HeaderDesigner.jsx`, panneau large ouvert depuis l'onglet « Page » ou d'un double-clic sur l'en-tête de l'aperçu) :

- **Bande** à l'échelle 3 px/mm avec une **grille de 2 mm**. Onglets « En-tête », « Pied de page » et « 1re page » (si `firstPage = own`). Aperçu commutable Portrait / Paysage / 16:9 : les positions horizontales sont en % de la largeur imprimable, l'en-tête suit donc l'orientation de chaque section.
- **Ajouter** : Texte, Image / logo, Variable (insère `{periode}` …), N° de page, Trait.
- **Déplacer** :
  - glisser (`pointerdown`, `pointermove`, `pointerup`, avec capture), aimantation à la grille et aux bords et centres des autres éléments (repères bleus) ;
  - 8 poignées de redimensionnement (minimum 4 mm × 3 mm) ;
  - **clavier** : Tab pour changer d'élément, flèches pour déplacer de 1 mm ou 0,5 % (Maj = × 5), Alt + flèches pour redimensionner, Suppr ;
  - champs numériques x / y / l / h pour une saisie exacte (accessibilité).
- **Mettre en forme** : police (Inter, IBM Plex Sans, Arial, Georgia), taille de 6 à 36 pt, gras, italique, couleur (jetons du système plus un code `#RRGGBB` validé), alignement. Liste des éléments avec ordre d'empilement.
- **Images** :
  - formats et limites : PNG ou JPEG, 512 Ko et 4 000 × 4 000 px au plus, 12 par document ;
  - contrôle : format **reconnu par les octets** (`common/imageInfo.js`, nouveau : signature et dimensions lues dans IHDR ou SOFn) ; SVG refusé (scripts), GIF, WebP, PDF et HTML refusés en nommant le format ;
  - stockage : une fois par client (SHA-256) ;
  - affichage : le client charge l'image par `fetch` authentifié, en garde l'URL `blob:` (aperçu, impression) et la convertit en `data:` pour l'export HTML. Word et PowerPoint la lisent en base.
- **Modèles** : l'en-tête et le pied font partie du contenu d'un modèle (« Enregistrer comme modèle »). « Appliquer l'en-tête d'un modèle » copie `page.header`, `page.footer` et `firstPage` d'un modèle choisi. Dans l'éditeur, la mise à niveau v1 → v2 transforme la ligne de texte d'avant en élément.
- **Rendu par sortie** :

  | Sortie | Rendu |
  |---|---|
  | Aperçu, PDF, HTML | positions exactes en mm |
  | PowerPoint | formes positionnées exactement (EMU = mm × 36 000) |
  | Word | tableau à 3 zones (gauche < 33 %, centre, droite > 67 %) empilées selon y ; champs `PAGE` et `NUMPAGES` ; trait = bordure de paragraphe. Approximation annoncée dans l'export : « Word : en-tête placé en trois zones » |
  | Excel | texte seul dans `headerFooter.oddHeader` (`&L` / `&C` / `&R`) |

---

## 10. Pagination, orientation par section, exports (retour 53)

- **Unités et formats** : millimètres ; A4 portrait 210 × 297, A4 paysage 297 × 210, 16:9 = 338,67 × 190,5 (taille par défaut de PowerPoint). Zone utile = page − marges − hauteur de l'en-tête et du pied (selon la section et la première page).
- **Mesure** : chaque bloc est rendu une fois dans un calque invisible (`MeasureLayer.jsx`) à la largeur utile de sa section. Les hauteurs viennent de `ResizeObserver`, avec un re-calcul différé de 150 ms après un changement.
- **`web/src/lib/reportPaginate.js`** (pur, testé depuis `server/test` comme `webCharts.test.js`) :
  - entrée : `sections[{ props, items[{ iid, h, keepWithNext, atomic, split? }] }]`, où `split` vaut `{ kind:'rows', headH, rows:[h] }` pour un tableau ou `{ kind:'nodes', nodes:[h] }` pour un texte ;
  - sortie : `pages[{ section, size, orientation, items:[{ iid, rows?:[i, j] }] }]` et la numérotation des pages ;
  - règles :
    - saut de section = nouvelle page avec la nouvelle géométrie ;
    - un titre reste avec le bloc suivant ;
    - un tableau se coupe entre deux lignes et **répète son en-tête** ;
    - un texte se coupe entre deux paragraphes ;
    - un bloc insécable plus haut qu'une page : réduit à l'échelle (graphiques, cartes) ou signalé (« Bloc plus haut qu'une page ») ;
    - `pagebreak` force une page.
- **`web/src/lib/reportFit.js`** (pur) : `fitTable(columns, widthMm)` renvoie une échelle de police (0,8 au minimum) et les largeurs de colonnes, ou « trop large ».
  - Tableau trop large : puce d'alerte sur le bloc et action en un clic « **Mettre ce bloc sur une page paysage** », qui insère une section paysage avant le bloc et une section de l'orientation précédente après.
  - Colonnes dynamiques (domaines, mois) : en-têtes sur deux lignes, abréviations avec légende.
- **Aperçu** : pages de taille fixe, zoom (ajusté, 75 %, 100 %, 125 %), séparateur de section avec puce d'orientation (« Section 2 · A4 paysage · 1 page »), numéros « Page n / N » exacts. Sur téléphone, la page est **mise à l'échelle comme un PDF**, jamais recomposée (`mock-editor-mobile.png`).
- **PDF** (impression du navigateur) :
  - feuilles **pré-découpées**, chacune avec ses marges, son en-tête et son pied en DOM, `break-after: page` ;
  - pages nommées `@page a4p { size: A4 portrait; margin: 0 }`, `@page a4l { size: A4 landscape; margin: 0 }`, `@page s169 { size: 338.67mm 190.5mm; margin: 0 }` et `.rd-sheet { page: a4l }`.

  On abandonne les marges `@page` actuelles (`ReportDesignerPage.jsx:368`). Si le navigateur ne connaît pas `page` (`CSS.supports('page','a')` faux), un avertissement s'affiche avant l'impression : « Ce navigateur imprime toutes les pages dans la même orientation : utilisez Chrome ou Edge, ou l'export Word ».
- **Word (.docx, nouveau, côté serveur)** :
  - `w:sectPr` par section (`w:pgSz` largeur et hauteur échangées, `w:orient="landscape"`, marges) ;
  - en-têtes et pieds par section (`w:titlePg` si la 1re page diffère) ;
  - titres en styles Titre 1 à 3 ;
  - tableaux natifs avec ligne d'en-tête répétée (`w:tblHeader`) ;
  - **graphiques natifs** (barres, colonnes, courbes, anneau, empilés) dont les valeurs viennent du serveur ;
  - logos en images ; carte : PNG produit par le navigateur ; sommaire = champ `TOC`.

  Word re-pagine lui-même ; les sections et orientations sont respectées.
- **PowerPoint (.pptx, nouveau, côté serveur)** : une diapositive par page de la pagination, éléments à leur position exacte (zones de texte, tableaux natifs, graphiques natifs, images).
  - Contrainte du format : **une seule taille de diapositive par fichier**. On prend la taille de la première section ; les pages d'une autre taille y sont réduites et centrées, avec un avertissement à l'export (§ 19, Q4).
  - Pour une présentation 16:9 de direction, toutes les sections sont en 16:9.
- **Infrastructure** : `server/src/modules/reports/export/` contient `ooxml.js` (parties, relations, types de contenu, zip via `adm-zip`, déjà dépendance directe), `layoutModel.js` (pur : document + données + découpage → modèle neutre), `chartXml.js` (DrawingML `c:chart`), `docx.js` et `pptx.js` (purs : modèle → parties). **Aucune nouvelle dépendance.**
- **HTML** : les feuilles paginées avec la CSS en ligne (approche actuelle). **Excel** : une feuille par bloc de données, plus « Lisez-moi ».

---

## 11. Éditeur à 3 volets (retour 18 : « l'étirer pour plus de place »)

Maquette : `mock-designer.html` (`mock-editor-desktop.png`, `mock-header-desktop.png`).

- **Largeur** : à l'ouverture de l'éditeur, le menu latéral de l'application passe en mode rail, puis revient à la fermeture. À 1 440 px : volet gauche 300 px, toile flexible (environ 760 px, page ajustée), volet droit 340 px.
- **Barre d'outils**, une seule ligne à partir de 1 280 px :
  - à gauche : ← Rapports, titre, statut (badge icône + libellé, « Brouillon · v3 »), **période** (sélecteur « du … au … » du lot 1b) et filtres du rapport (puces Bureau, Activité, Partenaire, regroupées sous « Filtres ▾ » en dessous de 1 600 px) ;
  - à droite : « 9 blocs sur 11 calculés », annuler et rétablir, Exporter ▾ (PDF, Word, PowerPoint, Excel, HTML), Enregistrer, et l'action du circuit (Soumettre, ou Valider / Rejeter selon `actions`).
- **Volet gauche**, onglets :
  - **Catalogue** : recherche (« couverture, budget, PDD… », sur les libellés, les groupes et les synonymes) ; groupes repliables avec leur nombre ; chaque entrée a une icône, un libellé, sa page d'origine (« Même calcul que : Couverture & performance ») et l'état « disponible avec le lot 1b » le cas échéant. On insère un bloc par clic (après la sélection) ou par glisser sur la toile (ligne d'insertion) ;
  - **Plan** : arbre avec les sections (puce d'orientation), sections répétées et colonnes ; glisser pour réordonner, Alt + ↑ / ↓, dupliquer, supprimer, marqueur de commentaire ;
  - **Pages** : liste des pages (n°, orientation, premier titre) ; un clic fait défiler la toile.
- **Toile** :
  - aperçu paginé (§ 10) et bloc sélectionné entouré de bleu ;
  - mini-barre sur le bloc : monter, descendre, dupliquer, supprimer, « page paysage », options ;
  - un « + » au survol entre deux blocs ouvre le catalogue en petit ;
  - états des blocs du § 5.2 ; double-clic sur l'en-tête pour ouvrir son concepteur.
- **Volet droit**, onglets :
  - **Bloc** : données (jeu de données, en groupes), présentation (vues permises, en boutons segmentés), mesure, colonnes, tri, lignes au plus, figure (titre, sous-titre, source automatique modifiable, note, numéro, n), couleurs (sobre / par classe), « Calculé en 0,42 s · cache valable jusqu'à la prochaine donnée importée » ;
  - **Filtres** : chaque filtre dit « hérite (Tous) » ou « Modifier » (choix `all` explicite) ; filtres non pris en charge grisés avec leur raison ;
  - **Page** : section (orientation, format, en-tête et pied oui / non), document (marges, première page, filigrane), « Concevoir l'en-tête et le pied » ;
  - **Validation** : statut, chronologie, commentaires, actions.
- **Raccourcis** : Ctrl + S enregistrer, Ctrl + Z / Ctrl + Y annuler / rétablir (historique de 50 états), Suppr, Ctrl + D dupliquer, « / » recherche du catalogue, Échap désélectionner.
- **Brouillon local** : `localStorage` par identifiant de rapport (récupération après une fermeture accidentelle), lu et écrit dans un `try/catch`. Il ne remplace jamais l'enregistrement serveur.
- **Écrans étroits** : sous 1 180 px, le volet droit devient un tiroir et le volet gauche se replie ; sous 640 px, **lecture seule** (aperçu à l'échelle) et actions du circuit seulement, avec « Ouvrez-le sur un écran plus large pour le modifier ».
- **Système de design** (`CLAUDE.md`) :
  - jetons du bloc « REFONTE PROFESSIONNELLE (v6) » de `styles.css` ;
  - Inter et chiffres tabulaires ; rayons 6, 9 et 14 ;
  - statuts couleur + icône + libellé ; boutons de 38 px (34 px dans la barre dense de l'éditeur) ;
  - la page « papier » garde ses jetons clairs (`reports.css:114`) dans les thèmes clair et sombre.
- **Découpage du code** : `ReportDesignerPage.jsx` (610 lignes) devient `pages/reports/editor/{ReportEditor, Topbar, CatalogPane, OutlinePane, PagesPane, PropertiesPane, FiltersPane, PagePane, ValidationPane, HeaderDesigner, BandView, PagedPreview, MeasureLayer, BlockFrame}.jsx`, `pages/reports/views/{Figure, DataTable, BarChart, ColumnChart, LineChart, DonutChart, StackedBar, HeatTable, KpiStrip, IndicatorCard, ExplainView, ListView, MapView}.jsx` et les hooks `useBlockData.js` et `useAssets.js`. La bibliothèque des rapports reste dans `ReportDesignerPage.jsx`.

---

## 12. Règles de visualisation par défaut (retour 45, guide de visualisation)

- **Chaque bloc de données est une figure** : numéro automatique (« Figure n » pour un graphique ou une carte, « Tableau n » pour un tableau, ordre du document, sections répétées comprises, calculé par le plan serveur), titre, sous-titre, source automatique (`meta.source` : « MEMS — soumissions non exclues de la fiche « X » · registre des sites ») avec **n**, période ou date (« au 31/10/2026 ») et note facultative.
- **Axe à zéro** toujours pour les barres et les colonnes ; jamais d'échelle brisée ni de double axe ; pourcentages sur 0–100 ; graduations par `chartAxis.yScale` (`web/src/lib/chartAxis.js:42`) ; étiquettes de mois par `tickIndexes` (:15), ancrées sur le dernier mois.
- **Palette sobre, validée** (`validate_palette.js`, mode clair, fond papier) :
  - **série unique** : bleu `#0f6cbd` (accent du système) ;
  - **catégories, ordre fixe, 7 au plus** : `#0f6cbd #eb6834 #1baf7a #eda100 #e87ba4 #008300 #6250d6`. Tous les contrôles passent : séparation daltonisme la plus faible 9,1, vision normale 19,6. Avertissement contraste < 3:1 pour 3 couleurs, donc **étiquettes directes ou tableau toujours disponibles**. Au-delà de 7 catégories : regroupement « Autres » ou petits multiples ;
  - **séries à paires toutes visibles** (nuage, carte) : 3 couleurs au plus (séparation 9,2 et 24,9) ;
  - **prévu / réalisé** : `#c77700` et `#0f6cbd` (comme les tableaux de bord ; séparation 25,4 et 31,5, contraste ≥ 3:1) ;
  - **intensité** (cartes, matrices) : rampe bleue unique de `#cde2fb` à `#0d366b` ;
  - **classes** (Excellent, Satisfaisant, À améliorer, Action urgente, Non évalué) : jetons `--cd-*`, toujours avec icône et libellé ;
  - **le rouge sert uniquement à « Action urgente » et au ton « critique »**. La couleur `#d13438` disparaît de la palette des séries (`ReportBlocks.jsx:14`).
- **Marques** fines ; légende dès 2 séries ; étiquettes de valeur sélectives ; texte en encre de texte, jamais de la couleur de la série ; bulle et repère au survol dans l'éditeur.
- **Choix de la forme selon le but**, avec un conseil dans le volet « Présentation » :
  - comparaison : barres horizontales ;
  - évolution : courbe ou colonnes ;
  - part d'un tout : anneau, 5 parts au plus, sinon barres empilées à 100 % ;
  - un seul chiffre : tuile ;
  - répartition géographique : carte.
- **Accessibilité** : SVG avec `role="img"`, `<title>` et `<desc>` ; bascule « Voir les données » (tableau) ; motif hachuré optionnel pour l'impression en noir et blanc.
- **Code** : règles pures dans `web/src/lib/reportViz.js` (échelle à zéro, couleurs dans l'ordre fixe, regroupement « Autres », légende obligatoire, légende de figure).

---

## 13. i18n

- **Interface** : toutes les nouvelles phrases sont dans `web/src/locales/en/reports.js`. Le dictionnaire reçoit aussi les libellés du catalogue (groupes, jeux de données, colonnes, chiffres clés, variables), traduits côté client par `tr()` comme aujourd'hui (`ReportDesignerPage.jsx:535`).
- **Phrases du serveur** (bulletin, phrase d'interprétation d'une carte de résultat, ligne de source, « — aucun plan », « Non disponible par bureau », alertes de dépassement) : dans la langue de la requête `?lang=`, avec des tables `fr` / `en` à côté de `BULLETIN_TEXT` (`reportData.js:172`).
- **Nombres et dates** : `fr-FR` ou `en-GB` ; libellé de période par `periodLabel` (`reportModel.js:150`).
- **Version figée** : elle garde sa langue de capture. Ses exports se font dans cette langue pour les textes générés (§ 19, Q7). Les textes saisis par l'utilisateur ne sont jamais traduits.
- **Test** `server/test/reportsI18n.test.js` : chaque libellé du registre (groupes, jeux de données, colonnes, chiffres clés, variables, vues) a une entrée anglaise, contrôlée par import du dictionnaire web comme `webCharts.test.js`.

---

## 14. Budget de performance et méthode de mesure

| Étape | Budget | Aujourd'hui | Mesure |
|---|---|---|---|
| Premier contenu (titres, textes, en-tête, squelettes nommés) après ouverture | **< 1 s, quel que soit le volume** (aucune dépendance aux données) | 5,1 à 5,2 s, page vide | Playwright : `performance.measure('rd:first-content', 'rd:open')` |
| `POST /render/plan` | p95 < 300 ms à 50 000 soumissions | — | `Server-Timing: plan` |
| Chaque bloc de données, cache froid | **p95 < 2 s à 50 000 soumissions** ; < 300 ms sur la base de dev | rapport entier 4,1 à 4,7 s (dev) ; 12 s par fiche à 50 000 | `Server-Timing: blk_*` ; `bench:report --cold` |
| Chaque bloc, cache chaud | < 50 ms | — | `bench:report --warm` |
| Rapport complet, base de dev (bulletin janv.–oct.) | < 1 s | 4,5 s | bench + Playwright |
| Mémoire par requête | < 50 Mo de lignes en JS | 674 Mo (50 000) | `process.memoryUsage().heapUsed` crête dans le bench |
| Soumission (version figée, 11 blocs) | < 2 s à chaud ; < 20 s à froid à 50 000 | — | `bench:report --submit` |
| Export Word ou PowerPoint (11 blocs, cache chaud) | < 3 s | — | `bench:report --export` |
| Surcoût des déclencheurs de 064 sur un import de 50 000 soumissions | < 2 % | — | import chronométré avant / après sur la base `_perf` |

**Méthode** :

1. **`npm run bench:report -- --period 2026-01:2026-10 [--cold|--warm|--submit|--export] [--check] [--json]`** (`server/scripts/bench-report.js`, **lecture seule**) :
   - rejoue les modèles système par la couche service (sans HTTP) ;
   - donne pour chaque bloc le minimum, la médiane et le p95 sur 5 passes, les hits de cache et la mémoire en crête ;
   - `--check` compare l'histogramme au calcul ligne à ligne sur **toutes** les fiches : 0 écart exigé, sinon code de sortie 1.
2. **Base de volume** :
   - commandes : `createdb mems2_perf`, `npm run migrate`, `npm run seed`, puis `npm run seed:perf -- --target 50000` (`server/src/db/seed-perf.js`) ;
   - garde-fou : le script **refuse** toute base dont le nom ne finit pas par `_perf` ;
   - contenu : il réplique les soumissions existantes avec un `external_id` `perf-<n>`, réparties sur 12 mois et entre les bureaux ;
   - idempotent : il supprime d'abord ses lignes `perf-%` ;
   - la base de dev n'est jamais touchée.
3. **Navigateur** : `node server/scripts/perf/designer-perf.cjs --base http://localhost:5173 --budget`.
   - Il ouvre chaque modèle système sur la période et lit les marques `rd:open`, `rd:first-content`, `rd:block:<iid>:start|end` posées par l'éditeur. Il échoue si un budget est dépassé.
   - À lancer sur la base de dev et la base `_perf` avant chaque fusion ; résultats consignés dans `docs/JOURNAL.md`.
4. **En service** : journal pino `report.blocks` (clé, ms, cache, lignes) et `Server-Timing` visible dans les outils du navigateur ; `?debug=perf` affiche le chronomètre de chaque bloc dans l'éditeur.

---

## 15. Sécurité et fiabilité

- **Isolation** :
  - client lu dans `req.auth` uniquement ; toute requête dans `withTenantTransaction` avec `tenant_id = $1` ;
  - RLS sur les 5 nouvelles tables et `mems_install_same_tenant` ;
  - les `assetId`, `indicatorId`, `contractId` et `partnerId` cités dans un document sont vérifiés dans le client du demandeur au rendu (404 du bloc sinon), jamais pris pour vrais.
- **Aucune injection** : texte riche structuré (`reportModel.js:16-29`), éléments d'en-tête en texte brut, couleurs et polices sur liste blanche, SVG refusé, images servies avec `nosniff` et `default-src 'none'`.
- **Limites** :
  - document : 1 Mo, 200 blocs, 30 éléments répétés, 12 images ;
  - requêtes : 8 blocs par appel, 3 appels en parallèle côté client ;
  - stockage : 8 Mo de données par version figée ; images de 512 Ko ;
  - exports : 15 Mo, sur leurs routes seulement.
- **Erreurs** : 23514 / 23503 / 22P02 → 400 et 23505 → 409 par le gestionnaire central ; 57014 → 503 (nouvelle règle) ; corps trop gros → 413. `AppError` utilise `statusCode`.

---

## 16. Risques et parades

| Risque | Parade |
|---|---|
| L'histogramme diverge du calcul ligne à ligne (nombres « 1.50 », booléens, tableaux JSON, variantes de casse, champs calculés) | Test de propriété (500 jeux tirés avec une graine) ; `bench --check` à 0 écart sur les vraies données ; repli ligne à ligne pour les champs calculés et les valeurs tableau ou objet ; priorité du nom exact (`CASE`) pour les variables à plusieurs noms |
| Conflits avec le lot 1b et les correctifs du lot 1 (`monitoring.repository.js`, `reportData.js`, sélecteur de période) | Code neuf dans des fichiers neufs ; fichiers existants touchés au minimum (exports, délégation de `formResults` et `reportMonitoringData`) ; C1 se rebase après 1b ; jeux de couverture marqués « disponible avec le lot 1b » tant que 1b n'est pas fusionné |
| Cache périmé | Versions par insertion seule et époque (§ 5.3) ; test qui vérifie que chaque table de la carte des domaines a son déclencheur dans 064 ; durée de vie de 30 min en filet ; bouton « Actualiser les données » |
| Déclencheurs plus lents sur les gros imports | Un seul `INSERT … ON CONFLICT DO NOTHING` par instruction ; mesuré (< 2 %) |
| Le navigateur n'imprime pas les orientations mélangées | Détection et avertissement ; exports Word et PowerPoint en alternative |
| Word place l'en-tête en 3 zones ; PowerPoint n'a qu'une taille de diapositive par fichier | Annoncé à l'export (§ 19, Q4–Q5) |
| Graphiques natifs Office mal relus | Types simples seulement (barres, colonnes, courbes, anneau, empilés) ; contrôle manuel dans Word, PowerPoint et LibreOffice consigné au journal |
| Soumission longue sur un cache froid à 50 000 | Réutilisation du cache des blocs déjà affichés ; fenêtre de progression (« Préparation de la version figée… 6/11 ») ; passage au worker (outbox) si le budget de 20 s n'est pas tenu |
| Les chiffres d'un brouillon rouvert changent (couverture juste) | Bandeau explicatif (§ 3.5) ; les rapports validés restent figés |
| Pression sur le pool PostgreSQL | 3 requêtes par onglet, une connexion chacune ; sémaphore de 4 calculs lourds par processus ; vol unique |
| Accessibilité du glisser-déposer | Clavier complet et champs numériques (§ 9) |

---

## 17. Coordination avec les autres lots

- **Correctifs du lot 1** (en cours) : 7a ne modifie ni `collectionDate.js`, ni `submissionsImport.js`, ni `IndicatorEditor` / `IndicatorExplain`, ni `TrendChart.jsx`, ni la cloche et les alertes, ni `ReportingPage.jsx`, ni `rbmScore.js` / `RbmPage.jsx`. Il **lit** `alerts.service.alerts`, `rbmSites` / `scoreSite` et `indicatorPreview` tels quels.
- **Lot 1b** : il fournit le sélecteur « du … au … », le contrat `{from, to}`, le service des faits site × mois (sites distincts, couverture, planification, exécution) et la requête des régions par clés distinctes. 7a réutilise tout cela. Si 1b n'a pas encore fusionné la requête des régions, C1 l'apporte, au même endroit (`REGION_CTE`) et avec le même SQL que `prof/region_new.sql`.
- **Lot 6a** (migration 061) : jeux `map.*` branchés sur sa source et ses contours. Aucun chevauchement de migration (7a = 062–064).
- **Lot 4** : il change la définition de « réalisée » **dans** le service des faits. 7a en hérite sans modification.
- **Lot 5** : « Pourquoi ? » et « Que faire ? » des drapeaux RBM s'ajouteront à `rbm.flags`.
- **Lot 7b** : modèles fidèles (rapport de 5 pages, présentation 16:9 du CCO, fiche 2 pages, infographie avec sections par module), « Ajouter au rapport » depuis les tableaux de bord, blocs des lots 4 et 5.
- **Journal** : chaque commit met à jour `docs/JOURNAL.md` (heure UTC, statut, commit, vérifications) ; `docs/ETAT_DU_PROJET.md` et `CLAUDE.md` sont mis à jour au dernier commit.

---

## 18. Commits ordonnés (chacun livrable seul : `npm test`, `npm run lint`, `npm run build` du web, contrôle à l'écran FR/EN à 1 440 et 390 px, journal mis à jour)

| # | Commit | Dépend de |
|---|---|---|
| C1 | `perf(concepteur)` indicateurs par histogramme exact et régions par clés distinctes. Rendu 4,5 s → < 0,3 s ; outils de mesure (`bench:report`, `seed:perf`) | — (se rebase après 1b) |
| C2 | `feat(concepteur)` rendu progressif bloc par bloc (plan + blocs), jamais de page blanche, marques de performance | — |
| C3 | `feat(concepteur)` modèle v2 (sections, en-tête et pied en éléments, bloc « données », filtres par identifiant) et mise à niveau des rapports existants | — |
| C4 | `feat(concepteur)` catalogue : suivi de processus, couverture et plan, RBM et sites (même calcul que les tableaux de bord) | C3 ; lot 1b pour `cov.*` |
| C5 | `feat(concepteur)` catalogue : budget, contrats, TPM, partenaires, PDD, alertes, carte | C3 ; lot 6a pour `map.*` |
| C6 | `feat(concepteur)` éditeur à 3 volets, catalogue cherchable, filtres hérités, règles du guide de visualisation | C2, C3 |
| C7 | `feat(concepteur)` pagination exacte et orientation par section (aperçu = PDF) | C3 |
| C8 | `feat(concepteur)` en-tête et pied libres (texte, variables, logos, n° de page sur une grille) ; migration 062 | C3, C7 |
| C9 | `feat(concepteur)` fil de validation, versions figées, séparation des tâches ; migration 063 | C2 |
| C10 | `perf(concepteur)` cache des calculs invalidé par les écritures ; migration 064 | C2 |
| C11 | `feat(concepteur)` export Word (.docx) : sections portrait / paysage, en-tête et pied, tableaux et graphiques natifs | C7, C8 |
| C12 | `feat(concepteur)` export PowerPoint (.pptx) : une diapositive par page, positions exactes | C7, C8 |
| C13 | `chore(concepteur)` mesure navigateur des budgets, documentation (journal, état du projet, `CLAUDE.md`, retours) | tous |

Fichiers et tests de chaque commit : liste structurée jointe.

---

## 19. Questions ouvertes

1. **Qualité de saisie par agent** (maquette du retour 40) : définition proposée = part des réponses vides ou « hors base » parmi les indicateurs notés, par agent (même décompte que les indicateurs). La validez-vous, ou faut-il d'autres critères (doublons, délai d'envoi, durée d'enquête) ?
2. **Validation** : tout administrateur ou gestionnaire autre que le soumetteur et l'auteur peut valider, comme pour le mapping. Faut-il plutôt nommer un validateur à la soumission, comme pour les contrats ?
3. **Suppression** : un rapport validé ne se supprime plus, il s'archive, même par un administrateur. D'accord ?
4. **PowerPoint** : une seule taille de diapositive par fichier ; les pages d'une autre orientation sont réduites et centrées. Acceptable, ou un fichier par orientation ?
5. **Word** : en-tête libre rendu en trois zones. Le placement exact au millimètre (ancres DrawingML) coûte environ un commit de plus. Nécessaire ?
6. **Filigrane** « BROUILLON — non validé » sur les exports non validés : activé par défaut ?
7. **Langue** : une version validée garde sa langue de capture. Faut-il pouvoir l'exporter dans l'autre langue (ce serait une nouvelle version) ?
8. **Jeux « état »** (budget, RBM, contrats, pipeline PDD) : situation au dernier mois de la période choisie. Confirmez-vous cette convention ?
9. **Logos** : PNG ou JPEG, 512 Ko et 4 000 px au plus, SVG refusé (sécurité). Suffisant ?
10. **Polices** des exports Word et PowerPoint : Inter peut manquer chez le destinataire (repli Arial déclaré). Préférez-vous Arial par défaut dans les modèles ?
11. **Lot 1b** : expose-t-il la requête des régions par clés distinctes et le service des faits site × mois sous un nom stable, pour brancher C1 et C4 sans doublon ?

---

## Décisions prises (13/10/2026)

Questions ouvertes de la conception, tranchées pour avancer (modifiables) :

- Qualité de saisie par agent : part des réponses vides ou « hors base » parmi les indicateurs notés (même décompte que les indicateurs) ; doublons et délais plus tard.
- Validation : tout administrateur ou gestionnaire autre que le soumetteur et l'auteur peut valider (comme le Mapping).
- Un rapport validé ne se supprime pas : il s'archive.
- PowerPoint : une taille de diapositive par fichier, les pages d'une autre orientation sont réduites et centrées.
- Word : en-tête libre rendu en trois zones (gauche / centre / droite) en 7a ; placement au millimètre plus tard.
- Filigrane « BROUILLON — non validé » sur les exports non validés : activé par défaut.
- Une version validée garde sa langue ; l'exporter dans l'autre langue crée une nouvelle version.
- Jeux « état » (budget, RBM, contrats, pipeline PDD) = situation au dernier mois de la période ; la consolidation reçoit un paramètre `until` (filtre `period_month <= until`, statut du contrat à cette date) — le tableau de bord continue sans `until` (un seul calcul).
- Logos : PNG ou JPEG, 512 Ko et 4 000 px au plus, reconnus par les octets ; SVG refusé.
- Polices des exports Word / PowerPoint : Arial (présente partout).
- Le score par VISITE de la maquette (sites urgents, classes, indice pondéré, signaux de risque) : `monitoringMath.visitScore` pur = moyenne des scores orientés des indicateurs % notés auxquels la visite a répondu, classée par les mêmes bandes (classify) — aucune 2ᵉ règle ; calcul en SQL.
- Histogrammes : `jsonb_typeof` renvoyé avec la valeur, nombres JSON reconstruits par Number() (1e15, 1e-5…) ; somme / moyenne / nombre des valeurs numériques agrégés en SQL ; banc sur une distribution réaliste (valeurs continues).
- `indicator_explain` passe par l'histogramme pondéré ; champs calculés lus par pages de 5 000 sur les seules clés référencées ; banc dédié.
- Clé de cache = tenant | source | paramètres | versions | **langue** | **lecteur** (ou lecteur neutre documenté pour les alertes figées).

## Corrections exigées par la critique de complétude

À appliquer pendant la réalisation (elles priment sur le texte ci-dessus en cas de contradiction) :

- **[high]** Retour 40 (dashboard mockup) is only half covered: its 'Sites urgents', 5-class breakdown, 'Indice pondéré' and 'Signaux de risque' are scored per visit, not per indicator. In the mockup data the class counts add up to the number of visits (35+96+100+35+0 = 266 = visits; 163+194+184+611+137 = 1289), and urgentPct = urg ÷ scored (35/266 = 13 %, 611/1152 = 53 %). Its risk signals are '{urg} sites en action urgente — à auditer', '{naPct}% de visites non évaluées' and the weakest indicator; they are not RBM flags. The spec has only indicator-level classes (mon.conformity_classes, KPI indicators_urgent) and maps 'signaux de risque' to rbm.flags. The 'variable × valeur' histogram cannot produce per-visit scores, because that needs each submission's answers taken together.
  - *Correction* : Add a pure visitScore(indicators, submission) in monitoringMath: the mean oriented score of the scored % indicators the visit answered, classified with the existing BANDS 80/65/50 through classify, so no second rule is introduced. Compute it in SQL: per row, sum and count CASE expressions over the scored indicators' variables, then GROUP BY class, bureau or agent, so no rows are shipped. Add datasets mon.visit_classes, mon.urgent_visits (bounded list) and mon.risk_signals, plus KPIs visits_urgent and visits_na_pct. Bench at 50k and add the per-visit definition to § 19 for the user to confirm.
- **[high]** The histogram SQL turns JSON numbers into text with (e.value::text)::float8::text, then hands strings to tallyIndicator. PostgreSQL writes exponent forms that toNumber cannot read; measured on the dev DB: 1e15 → '1e+15', 0.00001 → '1e-05', 1e21 → '1e+21'. toNumber (monitoringMath.js:11) strips everything except digits, '.' and '-', so '1e+15' → 115, '1e+21' → 121 and '1e-05' → null. The row-by-row path receives a JS number and returns it unchanged, so sum and mean diverge, and value keys differ ('1000000000000000' vs '1e+15'). The 1e21 case in the spec's own C1 property test would fail.
  - *Correction* : Return jsonb_typeof alongside v, and in computeAllFromHistogram rebuild Number(v) when the type is 'number', so tally sees exactly the value JSON.parse would give. Add property-test cases for 1e15, 1e-5, 123456789012345678 and -0.
- **[high]** The 50k performance numbers under-state the real cost. (a) The volume was simulated with generate_series × 152 over 331 GD rows, so each variable still has only about 331 distinct values. A real 50k base has about one distinct value per row for continuous numerics: on dev, the mean indicator benef_count already has 42 distinct values in 42 rows. The histogram for such a variable is then about the size of the data, and grows further with bureau × month grouping, so the < 50 MB claim is unproven. (b) The spec's own figure for bureau × month grouping is 2.3 s, above the 2 s per-block budget (mon.index_trend, mon.bureau_compare, mon.domains_by_bureau). (c) All-forms blocks (conformity, forms_index, conformity_classes) multiply 1.2 s by the number of forms; the real data has 4 activities.
  - *Correction* : For JSON-number values of sum/mean/count indicators, aggregate count, sum and blank counts in SQL (jsonb_typeof = 'number'), and build the value histogram only from string-typed values, which toNumber still parses in JS. Run one histogram pass per form grouped by (bureau, month), reuse it for every block through mergeTallies, and run forms concurrently within the semaphore. Make seed:perf perturb numeric and free-text values to keep realistic cardinality, and state whether the budget means 50k per tenant or per form.
- **[high]** Two paths are unmeasured and exceed the budget by the spec's own numbers. (1) mon.indicator_explain uses indicatorPreview unchanged (monitoring.repository.js:382 after the lot 1 merge). It runs jsonb_object_agg over jsonb_each for every submission, which the spec itself timed at 3.5–33 s at 50k. (2) Indicators bound to calculated fields (a retour 4 feature; 0 in the dev DB, so never benchmarked) fall back to reading full rows. A formula can read any key, so that is the 4.6 s JSONB read plus formula evaluation per form.
  - *Correction* : Route explainIndicator through the weighted histogram for non-calculated variables; explainIndicator already shares tallyIndicator, so weights are enough. For calculated fields, read only the keys found by calcReferences(defs) (monitoring.repository.js:293) in pages of 5,000, and bench a form that has one calculated-field indicator at 50k. If it misses 2 s, cache the per-form calculated-field histogram under the submissions and monitoring_def versions.
- **[high]** The cache key 'tenantId | source | params | versions' leaves out the viewer and the language. alerts.service.alerts(auth) depends on the viewer: 'à valider' is built from reportActions(r, {userId, canWrite: canWriteReports(role)}), so user A's cached alerts would be served to user B. Since the lot 1 merge (commit 3717912, today 17:24 UTC), reportMonitoringData(tenantId, period, {lang}) and reportFieldData(..., {lang}) build language-dependent labels ('Code 7 (not linked)'), so a French entry could be served to an English request. A frozen version would also store the submitter's personal alert view.
  - *Correction* : Each source declares the context it varies by (actor, lang, today) and these values go into the key. For report blocks, call alerts with a neutral viewer (canWrite true, userId null) so a frozen report shows every pending item, and document this choice. Add a test that two viewers or two languages never share an entry.
- **[high]** The budget blocks claim periodMode 'asOf' (the situation at the last month of the period), but the consolidation source cannot provide it. buildConsolidation sums every month's planned and actual (consolidation.js:99-106) and uses today only for the projection. The contract query keeps only c.status = 'actif' at the current date (consolidation.repository.js:39). A January–June 2026 report generated in October would include July–October actuals and drop contracts closed since. The 'partenaire' filter on bud.* is also impossible: rows carry partnerId: null (consolidation.repository.js:93) even though contracts.partner_id exists (3 of 4 rows populated on dev).
  - *Correction* : Add an optional `until` month to consolidation(): SQL filters period_month <= until on both tpm_reports and plans, and the contract-status predicate becomes as-of where history allows. The dashboard keeps calling it without until, so there is still one computation. Select c.partner_id. Otherwise declare bud.* as mode 'now' and say so in the source line.
- **[medium]** The per-bureau monitoring figures contradict the shared Bureau definition ('Bureau du site pour une visite ; sinon bureau reconnu de la soumission'). The histogram groups by officeLabelSql on s.field_office_id, which applySubmissionsGeoTx (placeMatch.repository.js:350-366) derives from the submission's own office label or commune, never from the linked site. So cov.by_office (site office) and mon.bureau_compare (submission office) split the same report differently. Also, officeRef accepts only a uuid, 'unlinked' or 'all', while the tables show 'lib:…' and 'code:<form>:<code>' groups. A repeat-by-bureau item or a block filter therefore cannot target the very bureaus the tables display.
  - *Correction* : Use one office key everywhere: COALESCE(office of the site linked through s.site_id, s.field_office_id), then fall back to the label or code. Put it in a shared SQL helper next to officeLabelSql and coordinate with lot 1b/4. Extend officeRef to accept the codeLabel key ('id:…', 'lib:…', 'code:…') and validate it against the tenant's keys when the plan is built.
- **[medium]** 'Un calcul, une source' is broken for site counts. mon.kpis_data redefines 'sites' as count(DISTINCT site_id) in the report only, while processOverview and coverageDashboard keep counting raw names: count(DISTINCT NULLIF(s.site, '')) at monitoring.repository.js:1438, 1458, 1512 and 1553. The Synthèse page and the report would show different 'sites' figures for the same period. mon.by_bureau reuses processOverview.byBureau and would carry the raw-name count into the same report as kpis_data.
  - *Correction* : Change the source queries themselves (or have lot 1b do it) to count sites as count(DISTINCT site_id), with raw names shown separately as 'lieux non rattachés'. The report then reads the same fields as the dashboards, and C4 adds no new count.
- **[medium]** The header designer cannot reproduce the user's own templates (retour 51: « comme dans mes templates »). cco.dump.txt has 308 AUTO_SHAPEs: the cover header is a full-width filled band (0,0 → 33.9 × 5.8 cm), and labels such as 'INTERNE' or 'MESSAGE CLÉ AU CCO' are filled pill shapes behind text. The band element types are only text, image, pageNumber and line, and text has no background, border or padding.
  - *Correction* : Add a 'rect' element (fill colour token, border, radius 0–6 mm, opacity) and optional background, padding and radius on text elements, all validated by zod against the colour allow-list. Render as DOM in the preview and PDF, a:prstGeom roundRect in PPTX, and paragraph shading in Word with the approximation announced.
- **[medium]** cov.by_activity shows a 'statut (Bon / Moyen / Faible / Critique)' column, but no coverage bands are defined anywhere in the spec or docs/PLAN_RETOURS_15_37.md. The reference pptx implies them: 82 % → Bon, 65 % → Moyen, 38 % → Faible, 25 % → Critique; the CCO deck calls < 40 % 'sous le seuil de représentativité'. Without a rule each implementer will invent thresholds, and there is a risk of a second classification rule beside monitoringMath.classify.
  - *Correction* : Add a pure coverageStatus(rate) with explicit thresholds (proposed ≥ 80 Bon, ≥ 60 Moyen, ≥ 30 Faible, otherwise Critique; null → « — aucun plan ») in a shared module used by the dashboards and the designer. Test it and add it to § 19 for the user to confirm. Keep it separate from indicator classes and document why.
- **[medium]** The spec's file:line references are out of date. The lot 1 fixes were merged into this branch while the spec was being reviewed (1a3cf09…3717912). Current lines: monitoringMath classify 161→188, computeAll 192→219, explainIndicator 230→257, overallIndex 293→320, naReason 326→353. monitoring.repository indicatorPreview 377→382, REGION_CTE 573→579, formResults 1307→1320, officeLabelSql 1351→1364, reportMonitoringData 1588→1606 (now takes {lang}), listSubmissions 1667→1687. field.repository rbmSites 159→172 (now opts with explain), reportFieldData 699→724 ({lang}). rbmScore.scoreSite 49→126. Retour 48 'Pourquoi ?' already shipped (rbmSiteExplain, RbmExplain.jsx), so rbm.flags no longer depends on lot 5. codeLabelText now takes {lang}.
  - *Correction* : Rebase the spec on HEAD 3717912. Rewire rbm.flags and rbm.due_sites to rbmSitesTx({explain: true}), adding reasons, consequence and actions. Pass lang through every source. Re-run prof_render.js after the merge before stating C1's gain.
- **[medium]** The 064 domain map misses tables that the planned sources read. tpm.partner_timeline reads contract_history (partners.repository.js:89). tpm.reports_status and the evaluations join users for names (tpm/reports.repository.js:37-40; tpm.repository.js:69). Lot 6a's migration 061 adds map_shape_links and generated GPS columns that map.* will read. These blocks would serve stale data until the 30-minute TTL expires. The planned test only checks that the listed tables have a trigger, so it cannot catch a missing table.
  - *Correction* : Each source declares the tables it reads. Add a test that lists every public table with a tenant_id column (information_schema) and requires it to be either in the domain map or in an explicit 'not read by reports' list. Add contract_history and map_shape_links to 'budget' and 'sites', and users to 'partners'.
- **[medium]** Submitting renders every block (up to 20 s cold at 50k) inside the HTTP request, which goes against CLAUDE.md: 'anything heavy or long-running goes through the BullMQ worker + transactional outbox, never inline'. The spec does not say whether the render happens inside the FOR UPDATE transaction. If it does, the request holds one pool client while the sources take others, which can starve the pool of 20 (PG_POOL_MAX default) when several users submit at once.
  - *Correction* : Read the doc and its version, read the data versions, then compute the blocks outside any transaction, using the cache. Then open a short withTenantTransaction: SELECT … FOR UPDATE, re-check version and status, INSERT the frozen version and an event, UPDATE the status. When Redis is available, enqueue large submissions through the outbox and show progress; keep the inline path only for warm caches or when Redis is absent, with a hard cap.
- **[medium]** Progressive loading conflicts with 'pagination calculée une fois'. Each arriving block changes heights, so pages reflow. {pages}, the TOC page numbers and the 'visible page first' priority all shift while loading. Nothing stops Print/PDF or the layout sent to /export.docx and /export.pptx while some instances are still skeletons.
  - *Correction* : Size skeletons from the last measured height of the same iid (cached per data signature), or from limit × row height. Recompute pagination on a 150 ms debounce. Disable Imprimer/Exporter and the Submit capture until every iid is ready or failed, and fonts are loaded (document.fonts.ready). Show '9 blocs sur 11 calculés' on the button.
- **[medium]** The purge raises the epoch about once an hour. dataChangedSinceCapture compares the stored versions (count and max per domain plus the epoch), so after any purge every submitted or validated version will show 'Les données ont changé depuis la soumission' even when nothing changed. The banner becomes noise and validators learn to ignore it.
  - *Correction* : Store the per-domain max(seq) at capture time. The banner then checks EXISTS (data_changes where domain ∈ the source's domains and seq > captured_max). This is unaffected by the epoch and by purging older rows. Keep the epoch only for cache keys.
- **[medium]** The commit order and the test migration are inconsistent. C2 (no dependency listed) tests 'héritage des filtres avec all' and figure numbering across 'colonnes', but the 'all' filters and the columns block only arrive in C3, so C2 cannot ship alone. C4 deletes computeKpis and BUILDERS, but server/test/reportData.test.js (which imports buildDataset, computeKpis and repeatItems) and reportBureauLabels.test.js (bureau labels in English) are neither ported nor listed. C1 even says reportData.test.js stays 'inchangé et vert'.
  - *Correction* : Move C3 before C2, or limit C2's tests to v1 constructs. In C4, port each guarantee of reportData.test.js and reportBureauLabels.test.js (not national when filtered by bureau, the code-7 label per language, one-form tables without the form name) to reportShapesMonitoring.test.js before deleting them.
- **[medium]** The size limits do not line up. zod measures the 1 MB limit as JSON.stringify length in characters. The DB CHECK measures octet_length(content::text) on jsonb text, which adds spaces after ':' and ','; measured: 32 bytes vs 25 characters. The global express.json({limit: '1mb'}) at app.js:42 also applies to {doc, iids} and {content, version}. A document that passes zod can therefore get a 413, or a generic 23514 → 400. Expanded instances are not capped either (30 repeat items × 40 children = 1,200 iids, 150 blocks requests), and the frozen data has an 8 MB DB cap.
  - *Correction* : Validate on Buffer.byteLength of the JSON with a 900 KB document limit, so wrapper and jsonb expansion fit under 1 MB. Map a content CHECK failure to a readable 413. Cap the expanded iids from the plan (e.g. 300) with 400 « filtrez ». Check the frozen data size before INSERT and return 413 with the heaviest blocks named.
- **[medium]** Money is not kept in integer cents everywhere the spec says it is. pddMath.summarize adds cash as floats (pddMath.js:15: agg.cashUsd += Number(d.cashUsd)). reportPddByMonth returns float8 per month, so pdd.kpis would add floats in its shape, as computeKpis does today. partners.repository.sheet returns ::float8 budget and actual. The spec states that 'les sources budgétaires existantes le font déjà'.
  - *Correction* : Fix pddMath.summarize to add integer cents (one change, which also fixes the PDD page). Read pdd.kpis totals from a SQL SUM over the period instead of adding months in JS. Add a test with 0.1 + 0.2-style amounts.
- **[medium]** The 15 s statement_timeout is set only in the new indicatorFacts repository. The other sources (rbmSites, planBoard, consolidation, coverageMatrix, lot 1b facts, partners.sheet) open their own withTenantTransaction, so they run without a timeout. A slow one will not become a per-block 57014 error.
  - *Correction* : Add an AsyncLocalStorage context in config/db.withTransaction that runs SET LOCAL statement_timeout when the request is a report render (set by the /render/blocks handler). Existing repositories then inherit it without signature changes. Test that a 57014 from any source becomes a block error.
- **[low]** The C1 diagnosis misses the root cause. REGION_CTE is slow because of row-level security, not because of volume: run read-only on dev, it takes 59 ms as superuser and 4,191 ms as mems2_app with app.tenant_id set (7 rows either way). Other admin_areas self-joins that run under RLS may hide the same trap. Any bench or EXPLAIN run as DATABASE_URL (superuser) will look fine.
  - *Correction* : State in § 1 that the cost comes from the RLS plan. Require bench:report, seed:perf checks and every EXPLAIN to run as mems2_app with SET app.tenant_id, and add an assertion in bench-report that current_user = 'mems2_app'.
- **[low]** Smaller catalogue gaps against 'tout capter'. Missing: data quality and configuration health (settings/health.repository.healthCounts: submissions without office or commune, location_match_queue, offices without perimeter); contract amendments and history; the Formations list (only a count); 'zones à surveiller (< 80 %)' from the Synthèse page; a gauge view (consumption gauges on DashboardBIPage). The 'constat éditable par ligne' in cov.by_activity has no storage defined in the data block schema. mon.agent_quality groups only by agent_id, while the mockup lists unlinked raw agent names ('Autre', full names) with fill, naPct and index.
  - *Correction* : Add quality.health, quality.linking, ctr.amendments and tpm.formations datasets reusing the existing repositories. Add a 'gauge' view and a threshold arg on cov.by_district. Add annotations: {[rowKey]: richDoc} to data block params, keyed by a stable row id, with orphan notes kept. Group agents by codeLabel key (id or raw label), and present the mockup's own fields (fill, naPct, index) in Q1.
- **[low]** Over-engineering in C11/C12: hand-written DrawingML for 5 native chart types in both DOCX and PPTX, plus a 3-zone Word header. This is the riskiest part of 7a (the spec lists 'graphiques natifs mal relus' as a risk) and the references do not require it: the user's own pptx draws bars as grouped shapes.
  - *Correction* : In 7a, export charts as PNG rasterised from the same SVG (svgRaster.js is already planned for maps), with native tables, text and headers. Defer native charts to a later commit triggered by an explicit request for 'données modifiables dans PowerPoint'.
- **[low]** The image check duplicates format detection. The new common/imageInfo.js re-implements signatures that common/fileSniff.js already identifies and names in French (PNG and JPEG at :67-68, PDF, HTML, XML/SVG). There is also no per-tenant quota on report_assets: the table is immutable with no DELETE, so storage grows without limit.
  - *Correction* : Have imageInfo read only dimensions (IHDR/SOFn) and call fileSniff for rejection and naming, so there is one list of formats. Add a per-tenant quota (e.g. 200 images or 50 MB → 413) checked in the same transaction as the INSERT.
- **[low]** The spec says 'Inter et Plex sont livrées par @fontsource', but main.jsx imports only Inter 400–700 (normal style) and IBM Plex Mono. IBM Plex Sans is installed but never loaded, and Inter italic is not bundled, so the header designer's 'IBM Plex Sans' and italic options render as browser fallbacks or faux italics. The user's dataviz guide (deck.dump.txt:242) asks for Open Sans.
  - *Correction* : Import @fontsource/ibm-plex-sans 400/600 and Inter italic only in the designer chunk, or drop Plex Sans from FONTS. Mention Open Sans in Q10 with the Arial fallback for exports.
- **[low]** Several smaller statements in the spec are inaccurate. § 3.3 says an unlinked office renders « Bureau non relié (code 6) »; codeLabelText actually produces « Code 6 (non relié) » / « Code 6 (not linked) ». tpm.invoice cites invoiceData (:153) right after partners.repository rows; it lives in tpm/reports.repository.js:153. 'Append-only, même pour un script' is overstated: a row trigger does not stop TRUNCATE, and a superuser can disable triggers. New reports get no default period, although the shared definition (and common/period.defaultPeriod) says the default is the last month that has data. Lot 6a's spec uses an orange ramp for risk maps, which contradicts § 12's « rampe bleue unique » for maps.
  - *Correction* : Correct these statements. Add a BEFORE TRUNCATE statement trigger on report_document_versions and report_document_events, and say that a superuser can still bypass it (as migration 058 does). Initialise new reports with defaultPeriod(monthCounts). State that map blocks inherit the 6a theme palettes.
- **[low]** A submitted designer report only gets a status badge: nothing notifies a validator, unlike TPM reports ('rapports à valider' in alertsMath), so it can wait unnoticed.
  - *Correction* : Now that the lot 1 alert fixes are merged, add a report_submitted item to buildAlerts. It is visible only to admin/manager users who are neither the submitter nor the author (the same actions() rule) and links to #/reports/:id.

## Commits prévus

1. **C1 perf(concepteur): indicateurs par histogramme exact (même décompte pondéré) et régions par clés distinctes — rendu 4,5 s → < 0,3 s ; outils de mesure** — fichiers : server/src/modules/monitoring/monitoringMath.js (tallyIndicator : poids w ; indicatorMeta extrait de computeAll ; export resultFromTally), server/src/modules/monitoring/histogram.js (nouveau, pur : computeAllFromHistogram, weightedRows, mergeTallies), server/src/modules/monitoring/indicatorFacts.repository.js (nouveau : keyVariantsTx, histogramTx — jsonb_each / CASE par variante / repli ligne à ligne par pages de 5 000 —, countsTx, formResultsFast), server/src/modules/monitoring/monitoring.repository.js (formResults:1307 et reportMonitoringData:1588 délèguent ; REGION_CTE:573 remplacé par la lecture par clés distinctes si le lot 1b ne l'a pas fait ; exports officeLabelsTx, submissionFilter), server/scripts/bench-report.js (nouveau, lecture seule, --cold/--warm/--check), server/src/db/seed-perf.js (nouveau, refuse toute base qui ne finit pas par _perf, idempotent perf-%), server/package.json (scripts bench:report, seed:perf), docs/JOURNAL.md — tests : server/test/monitoringHistogram.test.js : propriété sur 500 jeux à graine fixe (percent_yes, percent_value, count, sum, mean ; NA, vides, absents, variantes de casse, nombres 1.50 et 1e21, positiveValue « 1|2 ») — décompte pondéré = ligne à ligne, mergeTallies(bureaux) = global ; monitoringMath.test.js, coverageDashboard.test.js, reportData.test.js inchangés et verts ; bench:report --check = 0 écart sur la base de dev ; bulletin janv.–oct. < 300 ms (Server-Timing).
2. **C2 feat(concepteur): rendu progressif bloc par bloc (plan puis blocs), jamais de page blanche** — fichiers : server/src/modules/reports/renderPlan.js (nouveau, pur : dépliage des répétitions, iid stables, numéros Figure/Tableau, besoins dédoublonnés, effectiveFilters), server/src/modules/reports/reports.service.js (renderPlan, renderBlocks, erreur par bloc, sémaphore, Server-Timing), server/src/modules/reports/reports.routes.js (POST /render/plan, POST /render/blocks ; /render conservé), server/src/middleware/errors.js (57014 → 503), web/src/api/client.js (reportPlan, reportBlocks), web/src/pages/reports/useBlockData.js (nouveau : file, 3 requêtes, priorité au visible, cache par signature, Réessayer), web/src/pages/reports/BlockFrame.jsx (nouveau : squelette nommé + chrono, vide, erreur), web/src/pages/reports/ReportDesignerPage.jsx (contenu statique immédiat, marques rd:open / rd:first-content / rd:block), web/src/locales/en/reports.js, docs/JOURNAL.md — tests : server/test/reportRenderPlan.test.js (ordre des répétitions, iid stables, numérotation à travers répétitions et colonnes, besoins dédoublonnés, héritage des filtres avec 'all') ; server/test/reportsRenderRoute.test.js (supertest + sources espionnes : un bloc en erreur n'empêche pas les autres, > 8 iid → 400, Server-Timing présent, 57014 → erreur du bloc) ; Playwright : premier contenu < 1 s sur la base de dev.
3. **C3 feat(concepteur): modèle de document v2 (sections, en-tête/pied en éléments, bloc « données », filtres par identifiant) et mise à niveau des rapports existants** — fichiers : server/src/modules/reports/reportSchema.js (nouveau, zod v2), server/src/modules/reports/reportUpgrade.js (nouveau, pur v1 → v2), server/src/modules/reports/reportModel.js (façade, KPIS renommés), server/src/modules/reports/reportTemplates.js (modèles système réécrits en v2), server/src/modules/reports/reports.service.js (mise à niveau à la lecture et à la validation, bureaux nom → id), server/src/modules/reports/reports.repository.js (lecture des bureaux du client), web/src/pages/reports/ReportDesignerPage.jsx et ReportBlocks.jsx (lecture v2 : data, section, éléments d'en-tête positionnés), web/src/locales/en/reports.js, docs/JOURNAL.md — tests : server/test/reportSchemaV2.test.js (éléments hors bande refusés, colonnes sans imbrication, section, filtres 'all', 1 Mo, 200 blocs, 12 images, ids uniques) ; server/test/reportUpgrade.test.js (en-tête/pied/numéros → éléments, table/chart/kpis → data, clés renommées, bureau nom → id, nom inconnu → avertissement, idempotence sur v2) ; server/test/reportModel.test.js adapté.
4. **C4 feat(concepteur): catalogue — suivi de processus, couverture et plan, RBM et sites (même calcul que les tableaux de bord)** — fichiers : server/src/modules/reports/catalog/index.js (registre, contrôles au démarrage), server/src/modules/reports/catalog/monitoring.js, coverage.js, rbm.js, kpis.js, server/src/modules/reports/sources/index.js, monitoring.js, coverage.js (service des faits du lot 1b), field.js, rbm.js, server/src/modules/tpm/rbmSummary.js (nouveau, pur), server/src/modules/reports/reportData.js (computeKpis et BUILDERS remplacés par le registre ; bulletinDoc conservé), server/src/modules/reports/reports.service.js, web/src/pages/reports/ReportDesignerPage.jsx (liste des jeux groupée, jeux indisponibles grisés), web/src/locales/en/reports.js, docs/JOURNAL.md — tests : server/test/reportCatalog.test.js (clés uniques, sources existantes, vues/filtres/periodMode déclarés, available:false avec raison) ; server/test/reportShapesMonitoring.test.js (couverture = actifs réalisés ÷ actifs, « — aucun plan » jamais 0 %, bureau non relié nommé via codeLabel, n et source dans meta, filtre non pris en charge → note) ; server/test/rbmSummary.test.js ; server/test/reportsI18n.test.js (toute étiquette du registre a son anglais).
5. **C5 feat(concepteur): catalogue — budget, contrats, TPM, partenaires, PDD, alertes, carte** — fichiers : server/src/modules/reports/catalog/budget.js, contracts.js, tpm.js, partners.js, pdd.js, alerts.js, map.js, server/src/modules/reports/sources/budget.js, contracts.js, tpm.js, partners.js, pdd.js, alerts.js, map.js, web/src/locales/en/reports.js, docs/JOURNAL.md — tests : server/test/reportShapesOther.test.js (montants issus des centimes sans re-somme flottante, « Non disponible par bureau » pour budget/PDD, alertes = mêmes niveaux que le Centre d'alertes, carte indisponible sans le lot 6a, args requis absents → 400) ; reportCatalog.test.js et reportsI18n.test.js étendus.
6. **C6 feat(concepteur): éditeur à 3 volets, catalogue cherchable, filtres hérités et règles du guide de visualisation** — fichiers : web/src/pages/reports/editor/ReportEditor.jsx, Topbar.jsx, CatalogPane.jsx, OutlinePane.jsx, PagesPane.jsx, PropertiesPane.jsx, FiltersPane.jsx (nouveaux), web/src/pages/reports/views/Figure.jsx, DataTable.jsx, BarChart.jsx, ColumnChart.jsx, LineChart.jsx, DonutChart.jsx, StackedBar.jsx, HeatTable.jsx, KpiStrip.jsx, IndicatorCard.jsx, ExplainView.jsx, ListView.jsx (nouveaux), web/src/lib/reportViz.js (nouveau, pur : échelles à zéro, palette validée en ordre fixe, « Autres », légende, légende de figure), web/src/pages/reports/reports.css (palette, jetons papier), web/src/pages/reports/ReportDesignerPage.jsx (bibliothèque seulement), web/src/locales/en/reports.js, docs/JOURNAL.md — tests : server/test/reportViz.test.js (import du module web : axe à zéro pour barres et colonnes, ordre fixe des couleurs, rouge jamais attribué à une série, > 7 catégories → « Autres », légende dès 2 séries, numéro + titre + source + n dans la légende de figure) ; balayage Playwright FR et EN à 1 440 et 390 px : 0 erreur console, aucun débordement horizontal.
7. **C7 feat(concepteur): pagination exacte et orientation par section (aperçu = PDF)** — fichiers : web/src/lib/reportPaginate.js (nouveau, pur), web/src/lib/reportFit.js (nouveau, pur), web/src/pages/reports/editor/PagedPreview.jsx, MeasureLayer.jsx, PagePane.jsx (nouveaux), web/src/pages/reports/reports.css (@page nommées a4p / a4l / s169, feuilles pré-découpées, impression), web/src/locales/en/reports.js, docs/JOURNAL.md — tests : server/test/reportPaginate.test.js (titre gardé avec le suivant, tableau coupé avec en-tête répété, texte coupé par paragraphes, bloc trop haut réduit ou signalé, saut de section = nouvelle géométrie, numéros n / N exacts) ; server/test/reportFit.test.js (échelle ≥ 0,8, « trop large » → suggestion paysage) ; impression Chrome d'un rapport portrait + paysage contrôlée et consignée.
8. **C8 feat(concepteur): en-tête et pied libres — texte, variables, logos et n° de page placés sur une grille (migration 062)** — fichiers : server/src/db/migrations/062_report_assets.sql, server/src/modules/common/imageInfo.js (nouveau, pur : PNG/JPEG + dimensions), server/src/modules/reports/reportAssets.repository.js (nouveau), server/src/modules/reports/reports.routes.js (POST /assets, GET /assets, GET /assets/:id), web/src/pages/reports/editor/HeaderDesigner.jsx, BandView.jsx (nouveaux), PagePane.jsx, web/src/pages/reports/useAssets.js (nouveau : fetch authentifié → blob/data), web/src/locales/en/reports.js, docs/JOURNAL.md — tests : server/test/imageInfo.test.js (PNG et JPEG avec dimensions ; SVG, GIF, WebP, PDF, HTML, tronqué, 0 px, > 4 000 px refusés en nommant le format) ; server/test/reportAssetsRoute.test.js (201 puis 200 dédoublonné, 400 format nommé, 413 au-delà de 512 Ko, 404 pour un autre client, en-têtes nosniff et CSP) ; reportSchemaV2.test.js (éléments hors bande) ; contrôle visuel de l'en-tête en portrait, paysage et 16:9.
9. **C9 feat(concepteur): fil de validation brouillon → soumis → validé / rejeté, versions figées, séparation des tâches (migration 063)** — fichiers : server/src/db/migrations/063_report_workflow.sql, server/src/modules/reports/reportDocWorkflow.js (nouveau, pur), server/src/modules/reports/reports.repository.js (transitions sous FOR UPDATE, versions, événements, archivage), server/src/modules/reports/reports.service.js (soumission = rendu complet figé + empreintes), server/src/modules/reports/reports.routes.js (submit, withdraw, validate, reject, revise, archive, events, versions ; finalize supprimée), web/src/pages/reports/editor/ValidationPane.jsx (nouveau), web/src/lib/reportStatus.js (nouveau : DESIGNER_STATUS avec icônes), web/src/pages/reports/ReportDesignerPage.jsx (badges, archivés), web/src/locales/en/reports.js, docs/JOURNAL.md — tests : server/test/reportDocWorkflow.test.js (transitions, séparation soumetteur/auteur/validateur, rejet sans commentaire, retrait par le soumetteur seulement, actions() = mêmes règles que l'écriture) ; server/test/reportsWorkflowRoute.test.js (403 même personne, 409 statut/version/versionNo, 400 rejet sans commentaire, suppression d'un document versionné → 409, /finalize → 404) ; base jetable : UPDATE ou DELETE d'une version figée → 23514.
10. **C10 perf(concepteur): cache des calculs invalidé par les écritures (versions des données, migration 064)** — fichiers : server/src/db/migrations/064_data_changes.sql, server/src/modules/reports/cache.js (nouveau, pur : LRU + vol unique), server/src/modules/reports/dataVersions.repository.js (nouveau : lecture des versions, purge avec époque), server/src/modules/reports/sources/index.js (passage par le cache), server/src/modules/reports/reports.service.js (Server-Timing hit/miss), docs/JOURNAL.md — tests : server/test/reportCache.test.js (éviction par nombre et par octets, durée de vie avec horloge injectée, vol unique, erreur jamais mise en cache, clé avec versions et époque) ; server/test/dataChangesMigration.test.js (chaque table de la carte des domaines a son déclencheur dans 064) ; bench:report --warm < 50 ms par bloc ; import de 50 000 soumissions avec surcoût < 2 % sur la base _perf.
11. **C11 feat(concepteur): export Word (.docx) — sections portrait/paysage, en-tête et pied, tableaux et graphiques natifs** — fichiers : server/src/modules/reports/export/ooxml.js, layoutModel.js, chartXml.js, docx.js (nouveaux, purs), server/src/modules/reports/reports.routes.js (POST /export.docx en application/vnd.mems.report-export+json limité à 15 Mo ; GET /documents/:id/versions/:no/export.docx), web/src/lib/svgRaster.js (nouveau : carte → PNG seulement), web/src/pages/reports/editor/Topbar.jsx (menu Exporter), web/src/locales/en/reports.js, docs/JOURNAL.md — tests : server/test/docxWriter.test.js (w:sectPr paysage avec pgSz échangé, en-tête/pied par section avec champs PAGE/NUMPAGES, w:tblHeader, parties de graphiques et relations, médias, [Content_Types].xml, XML bien formé, zip relu par adm-zip) ; ouverture manuelle dans Word et LibreOffice consignée au journal.
12. **C12 feat(concepteur): export PowerPoint (.pptx) — une diapositive par page, positions exactes** — fichiers : server/src/modules/reports/export/pptx.js (nouveau, pur), server/src/modules/reports/reports.routes.js (POST /export.pptx ; GET /documents/:id/versions/:no/export.pptx), web/src/pages/reports/editor/Topbar.jsx, web/src/locales/en/reports.js, docs/JOURNAL.md — tests : server/test/pptxWriter.test.js (nombre de diapositives = nombre de pages, sldSz 16:9 et A4, positions EMU = mm × 36 000, tableaux et graphiques natifs, avertissement quand les tailles de page diffèrent) ; ouverture manuelle dans PowerPoint et LibreOffice consignée.
13. **C13 chore(concepteur): mesure navigateur des budgets et documentation** — fichiers : server/scripts/perf/designer-perf.cjs (nouveau : Playwright, marques rd:*, --budget), docs/JOURNAL.md, docs/ETAT_DU_PROJET.md, docs/RETOURS_UTILISATEUR.md (retours 18, 39, 40, 43, 45, 51, 52, 53), CLAUDE.md (section Concepteur de rapport) — tests : designer-perf --budget vert sur la base de dev et sur la base _perf (premier contenu < 1 s, bloc p95 < 2 s à 50 000) ; npm test, npm run lint, npm run build du web verts.

## Mesures (base de démonstration)

Base de dev (13/10/2026, lecture seule, 562 soumissions, période janv.–oct. 2026) :
- POST /api/report-designer/render : bulletin 4,50 / 4,71 / 4,51 s ; performances 4,61 / 4,12 / 4,65 s ; complétude 4,32 / 4,44 / 4,28 s ; budget 6–10 ms ; PDD 15–24 ms.
- Navigateur : premier contenu après 5 055 ms (bulletin) et 5 218 ms (performances) ; d'ici là, la page reste un squelette gris (now-bulletin-t1s.png).
- Point chaud : la requête des régions (REGION_CTE, monitoring.repository.js:573) prend 5 040 ms sur 5 177 ms de reportMonitoringData ; les 24 autres requêtes environ 100 ms, le JS 65 ms.
- Prototype « régions par clés distinctes » (lot 1b) : 2 à 4 ms.
- Prototype C1 (histogramme pour les 3 fiches + contrôle ligne à ligne) : 319 ms au total, 0 écart sur 69 indicateurs.

50 312 soumissions simulées en lecture seule (generate_series × 152 sur la fiche GD, 57 indicateurs) :
- Chemin actuel : 4,6 s de lecture JSONB + 3,7 s de computeAll + 3,7 s par bureau ≈ 12 s par fiche, 674 Mo de tas.
- Projections JSONB côté SQL : 3,5 à 33 s (JSONB compressé : 2,9 Ko stockés, 6 Ko en texte).
- Histogramme : 0,9 s (jsonb_each filtré), 1,2 s (CASE par indicateur), 0,3 s (variantes de nom), 2,3 s (bureau × mois) ; DISTINCT ON 7,4 s (rejeté) ; comptages 78 ms.
- Égalité histogramme / ligne à ligne : 0 écart sur 57 indicateurs.

Chiffres faux :
- « Couverture 435,9 % » = 170 clés COALESCE(site_id, site, admin3) (dont 2 vrais sites) ÷ 39 sites actifs.
- Tableaux de 1 754 et 1 654 px dans une page de 502 px.

Palette des rapports validée (validate_palette.js, mode clair) :
- 7 catégories : séparation daltonisme la plus faible 9,1, vision normale 19,6 ; contraste insuffisant pour 3 couleurs, donc étiquettes directes ou tableau toujours disponibles.
- Prévu #c77700 / réalisé #0f6cbd : 25,4 et 31,5, contraste ≥ 3:1.

Budgets cibles et méthode (spec § 14) :
- Premier contenu < 1 s quel que soit le volume ; plan p95 < 300 ms ; bloc à froid p95 < 2 s à 50 000 soumissions (< 300 ms en dev) ; bloc à chaud < 50 ms ; < 50 Mo de lignes par requête.
- Soumission < 2 s à chaud, < 20 s à froid ; export < 3 s ; surcoût des déclencheurs < 2 %.
- Mesure : Server-Timing, bench:report (--cold / --warm / --check), seed:perf sur une base _perf, Playwright designer-perf --budget.

Scripts et captures : scratchpad design/7a/ (scripts/*.js, now-*.png, mock-*.png, mock-designer.html).
