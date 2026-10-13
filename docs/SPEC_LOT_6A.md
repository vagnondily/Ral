# Lot 6a — « Carte exploitable » et carte dans le Dashboard décisionnel

Retours couverts : **49** et **50** (entièrement), **17** et **27** (carte : fond, sites planifiés / réalisés, choroplèthe par district, panneau latéral), **44** (présentation interactive façon HungerMap : chiffre clé, classement à pastilles, couches par thème, fiche au survol, légende graduée, recherche, zoom, export) et **41** pour sa partie réalisable sans nouveaux contours (nord, échelle, légende, pied de page, carte de situation, export image / impression). Restent au **lot 6** : contours des communes et fokontany importés du shapefile, surcouches hachurées importables par catégorie de commune, bloc carte du concepteur (avec 7a), tableau de bord par activité.

Branche : `claude/practical-meitner-2c1560`. Prototype navigable et captures : `scratchpad/design/6a/` (`proto2.html`, `v2_*.png`, `now-*.png`, SQL de mesure `map_districts_final.sql`, `pts3.sql`, `gps_rule.sql`, `verify_fn.sql`, `bench_x8.sql`, build `build_geo.js`). Copie de cette spécification : `scratchpad/design/6a/SPEC_6a.md`.

---

## 1. Constat (code actuel)

| Écran / code | Problème mesuré |
|---|---|
| `web/src/pages/dashboard/DashboardCoveragePage.jsx:572-603` (`MapView`), données `:68-69` (`api.fieldMap()`), import `:10` (`lib/madagascarMap.js`) | Silhouette « Sud Madagascar » dessinée à la main (`madagascarMap.js:21`), 26 points GPS, aucune donnée de la période ; la carte ignore le mois choisi. « Données versées par région » = `RegionsCard`. |
| `web/src/pages/monitoring/SitesMapPage.jsx:68-69` | Tuiles OSM obligatoires : hors ligne, **60 requêtes en échec et 30 erreurs console** (mesuré, `now.js`). |
| `SitesMapPage.jsx:19-24` | Jointure district par **nom bricolé** (suppression de « atsimo », « androy », « ouest »…) : deux districts différents peuvent se confondre. |
| `server/src/modules/tpm/field.repository.js:436-464` (`mapData`, route `field.routes.js:249`) | Groupement par **texte** (`adm1/adm2/district`) : **32 « districts »** pour 18 réels (« BEKILY »/« Bekily », « Atsimo-Andrefana »/« Atsimo Andrefana », retour 15) ; `count(*)` après `LEFT JOIN site_visits` réalisées compte un site par visite : **1 294 sites affichés pour 1 280**. Aucune période. |
| `field.repository.js:108-112` (`SUBMISSION_OF_SITE`) | Repli « même commune » : une donnée de commune vaut collecte du site. Contraire à la définition commune « Réalisée » (une donnée rattachée seulement à la commune n'est jamais une visite). La carte ne l'utilise pas. |
| `DashboardBIPage.jsx:190, 270-287` | Carte « Couverture terrain — mois courant » : mois courant (pas la période par défaut), taux = visites réalisées ÷ planifiées (ancienne règle). |
| `admin_areas.lat/lng` | 0 / 19 370 renseignés : le repli « centroïde de commune » de `planBoardTx` (`field.repository.js:739-760`) ne place rien. |

## 2. Mesures sur la base de dev (13/10/2026, tenant de démo)

**Registre et découpage**
- 1 280 sites ; **26 avec GPS** ; 1 278 avec `admin_area_id` ; **1 081 rattachés à un district** (via `admin_areas.lineage[2]`), **197 à la région seulement** (`geo_status` à valider / introuvable : « Amboasary », « Ampanihy », « Fort dauphin », « Betioky »…), 2 sans localité. 18 districts portent des sites.
- `admin_areas` profondeur 2 : 120 districts avec P-code ; contours embarqués (`web/public/mdg-adm2.geojson`, geoBoundaries ADM2, propriété `name` seule) : 119.
- **Correspondance nom → contour : 119/120 exacts** (même après normalisation) ; seul **Antanimora Sud (MG52516a, 58 sites)** n'a pas de contour : district scindé d'Ambovombe-Androy (MG52516) après 2018 → règle « P-code parent » (suffixe lettre retiré) = 120/120 placés, contour partagé signalé.
- **Contrôle croisé** : 315 des 317 points GPS de soumissions ayant un district déclaré tombent dans le contour de ce district (**99,4 %** ; 2 points Farafangana → Vangaindrano).

**Soumissions et GPS**
- 562 soumissions (529 non écartées janv.–oct. 2026), seulement **13 rattachées à un site** (`site_id`), 513 avec P-code de commune.
- Clés GPS : `@_HHCoord_latitude/_longitude/_precision/_altitude` (324), variantes suffixées `_ca6b` (102) et `_4a58` (53) **dans les mêmes soumissions** (2ᵉ question GPS, valeurs différentes) → ~480 occurrences de clés, **324 soumissions distinctes avec GPS**, toutes dans l'emprise de Madagascar, aucune à (0,0). Précision : p50 4,8 m, p90 8,4 m, p99 909 m → **315 exploitables** (≤ 100 m), 9 écartées. Aucune n'a la forme « geopoint » seule.
- GPS présent jusqu'en **juillet 2026** seulement (0 point en août–octobre).
- Extraction en ligne (`jsonb_each` sur `data`) : **260 ms pour 562 lignes** → inutilisable à l'échelle ; d'où la colonne générée (§4).
- Règle de la migration vérifiée en lecture seule sur la base : **324 soumissions, toutes dans l'emprise de Madagascar, clé sans suffixe retenue 324 fois sur 324**. Piège mesuré : un motif « geopoint » laxiste prend les réponses à choix multiples (« 1 2 », « 3 9 10 11 ») pour des coordonnées (7 faux positifs, lat = 1, lng = 2) → le geopoint exige au moins 3 décimales en latitude et en longitude.
- Positions déduites (médiane des collectes, précision ≤ 100 m, tout l'historique) : **2 sites** ont des collectes GPS rattachées (1 déjà GPS) → **1 site placé par ses propres collectes** ; **43 communes** ont un centre de collectes (32 avec n ≥ 3 ; dispersion médiane ≤ 2 km : 16, 2–5 km : 13, > 5 km : 14) couvrant **186 sites sans GPS** (118 dans des communes à dispersion ≤ 5 km).

**Ce que la nouvelle carte colore (requête §5, période par défaut = sept. 2026 ; plage janv.–oct. 2026)**

| Thème | sept. 2026 | janv.–oct. 2026 |
|---|---|---|
| Contours colorés — registre (sites actifs, risque) | 17 contours (18 districts, Antanimora Sud partagé) | 17 |
| Couverture (sites actifs réalisés ÷ actifs) | 17 mesurables, 4 > 0 ; total **17 / 1 280 = 1,3 %** (dont 1 par les données, 16 déclarées) | 5 > 0 ; total 21 / 1 280 = 1,6 % |
| Planification / Exécution | 4 mesurables, **13 « — aucun plan »** ; exécution 16 / 22 visites | 4 / 13 ; exécution 32 / 44 = 73 % ; 4 hors plan |
| Données versées | 9 contours ; 64 / 77 soumissions localisées (13 sans site ni commune) | 14 contours ; 491 / 529 |
| Sites de communes avec données mais non visités (indication) | 193 | 445 |
| Alertes | 16 contours avec ≥ 1 signal, 13 critiques (risque élevé ni prévu ni visité) | — |
| Points | 26 GPS + 1 par ses collectes + 43 centres de commune (186 sites) ; **0 point de collecte** (dernier : juil. 2026) | idem + 286 points de collecte |

Pour mémoire, l'ancienne règle « même commune » aurait compté **457 sites visités** en janv.–oct. contre **3** par des données rattachées au site : la carte montre les deux, sans jamais les confondre.

**Performance mesurée** : requête districts 16 ms (1 mois), 25 ms (10 mois), 40 ms (24 mois) sur la base de dev ; synthétique ×8 (10 240 sites) **2,4–2,6 s avec JIT, 164 ms (12 mois) / 250 ms (24 mois) sans JIT** → `SET LOCAL jit = off` obligatoire. Contours allégés à frontières partagées : **88 Ko gzip** (contre 275 Ko), 119 étiquettes dans leur polygone, 0 sommet partagé rompu. Prototype : analyse + rendu 65 ms (CPU ×1), 270 ms (CPU ×4), 511 nœuds SVG.

---

## 3. Définitions appliquées (contraignantes, `docs/PLAN_RETOURS_15_37.md`)

| Notion | Traduction SQL / code dans 6a |
|---|---|
| **Période** | Plage `from`–`to` (mois « AAAA-MM »), `month` accepté comme raccourci (= plage d'un mois) ; **sites distincts** sur la plage. Défaut = `useDefaultMonth` (`PeriodBanner.jsx:18`, règle `common/period.js:110`) puis le sélecteur de plage du lot 1b. |
| **Site actif (mois m)** | Dernier statut de `site_month_status` ≤ m (défaut : actif, même règle que le lot 1b) **et** `security_situation < 99`. Actif sur la plage = actif au moins un mois. |
| **Visite** | Site × mois, comptée une fois. |
| **Réalisée** | Au moins une soumission **rattachée au site** (`ms.site_id`) ce mois-là, fiche compatible avec l'activité du site (même test que `field.repository.js:111-112`), **ou** `site_visits.status = 'realise'` ce mois (« déclarée » ; le motif obligatoire arrive au lot 4 dans le même fragment). Jamais par la seule commune. |
| **Prévue / Hors plan** | Prévue = `site_visits.status <> 'annule'` ce mois. Hors plan = réalisée sans être prévue. |
| **Taux** | Couverture = sites actifs réalisés ÷ actifs · Planification = sites actifs prévus ÷ actifs (**« — aucun plan »** si 0 prévu) · Exécution = visites réalisées parmi les prévues ÷ visites prévues (« — aucun plan » si 0). |
| **Bureau** | Filtre = bureau choisi **et ses antennes** (récursif sur `field_offices.parent_id`). Site : `sites.field_office_id` ; soumission : bureau du site, sinon bureau reconnu de la soumission (`ms.field_office_id`). Noms via `codeLabel` dans le sélecteur (jamais un code nu). |
| **District d'un site** | `admin_areas.lineage[2]` de `sites.admin_area_id` (P-code), jamais le texte `adm2/district`. |
| **District d'une soumission** | District du site rattaché, sinon `adm3_pcode` → `admin_areas.lineage[2]`. |

Une seule implémentation de ces règles : le fragment `server/src/modules/common/siteMonthSql.js` (§5.1), partagé avec le lot 1b (si 1b l'a déjà créé sous un autre nom, 6a l'importe ; il ne doit jamais exister deux copies).

---

## 4. Modèle de données — migration `061_map_geo.sql`

Une seule migration (6a = 061 ; 7a commence à 062 ; 1b n'en utilise pas). Elle arrive dans le **commit 2** et contient les deux parties, pour ne jamais modifier une migration déjà appliquée.

```sql
-- MEMS 2.0 — Lot 6a « Carte exploitable » (retours 17, 49, 50).
-- 1. Position GPS de chaque soumission, lue UNE fois dans les réponses brutes (data),
--    en colonnes GÉNÉRÉES (PostgreSQL >= 12) : aucun chemin d'écriture ne peut l'oublier
--    (imports CSV / XLSX / SAV / Kobo / Ona, ré-import ON CONFLICT DO UPDATE) et le code
--    d'import n'est pas touché. Référence lisible et testée : modules/map/submissionGps.js
--    (test de parité sur CE fichier). Si la règle change : CREATE OR REPLACE la fonction,
--    puis UPDATE monitoring_submissions SET data = data (une colonne générée ne se
--    recalcule qu'à l'écriture de sa ligne).
-- 2. map_shape_links : correction manuelle district (P-code) -> contour de la carte.

CREATE OR REPLACE FUNCTION mems_submission_gps(d jsonb) RETURNS numeric[]
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT ARRAY[c.lat, c.lng, c.acc] FROM (
    -- a) paire <préfixe>_latitude[_xxxx] / _longitude[_xxxx] (+ _precision) : exports Kobo
    SELECT 1 AS src, length(e.key) AS kl, e.key,
           CASE WHEN (e.value #>> '{}') ~ '^\s*-?\d+(\.\d+)?\s*$' THEN (e.value #>> '{}')::numeric END AS lat,
           CASE WHEN (d #>> ARRAY[regexp_replace(e.key, '_latitude((_[0-9a-f]{4})?)$', '_longitude\1', 'i')]) ~ '^\s*-?\d+(\.\d+)?\s*$'
                THEN (d #>> ARRAY[regexp_replace(e.key, '_latitude((_[0-9a-f]{4})?)$', '_longitude\1', 'i')])::numeric END AS lng,
           CASE WHEN (d #>> ARRAY[regexp_replace(e.key, '_latitude((_[0-9a-f]{4})?)$', '_precision\1', 'i')]) ~ '^\s*\d+(\.\d+)?\s*$'
                THEN (d #>> ARRAY[regexp_replace(e.key, '_latitude((_[0-9a-f]{4})?)$', '_precision\1', 'i')])::numeric END AS acc
      FROM jsonb_each(d) e WHERE e.key ~* '_latitude(_[0-9a-f]{4})?$'
    UNION ALL
    -- b) chaîne geopoint « lat lng [altitude [précision]] » (API Kobo : HHCoord) ; >= 3 décimales
    --    obligatoires : « 1 2 » (réponse à choix multiples) n'est pas un point
    SELECT 2, length(e.key), e.key, m[1]::numeric, m[2]::numeric, m[4]::numeric
      FROM jsonb_each(d) e
     CROSS JOIN LATERAL regexp_match(btrim(e.value #>> '{}'),
       '^(-?\d{1,2}\.\d{3,})\s+(-?\d{1,3}\.\d{3,})(?:\s+(-?\d+(?:\.\d+)?))?(?:\s+(\d+(?:\.\d+)?))?$') m
     WHERE jsonb_typeof(e.value) = 'string' AND m IS NOT NULL
    UNION ALL
    -- c) _geolocation [lat, lng] (API Kobo JSON)
    SELECT 3, 12, '_geolocation',
           CASE WHEN (d -> '_geolocation' ->> 0) ~ '^\s*-?\d+(\.\d+)?\s*$' THEN (d -> '_geolocation' ->> 0)::numeric END,
           CASE WHEN (d -> '_geolocation' ->> 1) ~ '^\s*-?\d+(\.\d+)?\s*$' THEN (d -> '_geolocation' ->> 1)::numeric END, NULL
     WHERE jsonb_typeof(d -> '_geolocation') = 'array'
  ) c
  WHERE c.lat BETWEEN -90 AND 90 AND c.lng BETWEEN -180 AND 180 AND NOT (c.lat = 0 AND c.lng = 0)
  ORDER BY c.src, c.kl, c.key COLLATE "C"   -- clé sans suffixe d'abord ; ordre identique au JS
  LIMIT 1
$$;

ALTER TABLE monitoring_submissions
  ADD COLUMN IF NOT EXISTS gps_lat numeric(9,6) GENERATED ALWAYS AS (round((mems_submission_gps(data))[1], 6)) STORED,
  ADD COLUMN IF NOT EXISTS gps_lng numeric(9,6) GENERATED ALWAYS AS (round((mems_submission_gps(data))[2], 6)) STORED,
  ADD COLUMN IF NOT EXISTS gps_accuracy_m numeric(10,1)
    GENERATED ALWAYS AS (round(LEAST((mems_submission_gps(data))[3], 999999999), 1)) STORED;

CREATE INDEX IF NOT EXISTS idx_mon_sub_period    ON monitoring_submissions (tenant_id, period_month) WHERE NOT excluded;
CREATE INDEX IF NOT EXISTS idx_mon_sub_gps_month ON monitoring_submissions (tenant_id, period_month) WHERE gps_lat IS NOT NULL AND NOT excluded;
CREATE INDEX IF NOT EXISTS idx_mon_sub_gps_site  ON monitoring_submissions (tenant_id, site_id) WHERE gps_lat IS NOT NULL AND site_id IS NOT NULL AND NOT excluded;
CREATE INDEX IF NOT EXISTS idx_mon_sub_gps_com   ON monitoring_submissions (tenant_id, adm3_pcode) WHERE gps_lat IS NOT NULL AND NOT excluded;

-- 2. Corrections district -> contour. Clé = P-code (stable au ré-import du découpage),
--    jeu de contours versionné (lot 6 : contours importés par compte).
CREATE TABLE IF NOT EXISTS map_shape_links (
  tenant_id  uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  shape_set  text NOT NULL DEFAULT 'mdg-adm2.v1' CHECK (shape_set ~ '^[a-z0-9.-]{1,40}$'),
  area_pcode text NOT NULL CHECK (length(area_pcode) BETWEEN 2 AND 40),
  shape_key  text CHECK (shape_key IS NULL OR length(shape_key) BETWEEN 1 AND 120), -- NULL = « ne pas dessiner »
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, shape_set, area_pcode)
);
ALTER TABLE map_shape_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE map_shape_links FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON map_shape_links;
CREATE POLICY tenant_isolation ON map_shape_links
  USING (tenant_id::text = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mems2_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON map_shape_links TO mems2_app;
  END IF;
END $$;
SELECT mems_install_same_tenant('map_shape_links');
```

Notes : `CASE` protège chaque conversion (l'ordre d'évaluation d'un `AND` n'est pas garanti) ; `COLLATE "C"` aligne l'ordre des clés sur JavaScript ; la fonction est exécutable par `mems2_app` (EXECUTE à PUBLIC par défaut, comme les autres `mems_*`). L'ajout des colonnes réécrit la table une fois (562 lignes : instantané ; 50 000 : quelques secondes). Le rôle `mems_app` n'est jamais touché. Le corps de la fonction a été exécuté en lecture seule (sous-requête latérale, `scratchpad/design/6a/verify_fn.sql`) : 324 points, emprise -25,30 → -20,85 / 44,02 → 48,38.

---

## 5. Serveur

### 5.1 Modules purs (sans I/O, testés)

**`server/src/modules/map/submissionGps.js`** — référence de la règle SQL : `LAT_KEY_RE = /_latitude(_[0-9a-f]{4})?$/i`, `GEOPOINT_RE = /^(-?\d{1,2}\.\d{3,})\s+(-?\d{1,3}\.\d{3,})(?:\s+(-?\d+(?:\.\d+)?))?(?:\s+(\d+(?:\.\d+)?))?$/` (au moins 3 décimales : « 1 2 » d'un choix multiple n'est pas un point), `MAX_ACCURACY_M = 100`, `extractGps(data) → { lat, lng, accuracyM, key, source: 'paire'|'geopoint'|'geolocation' } | null`, `usable(gps, { maxAccuracyM })`. Même ordre de choix que le SQL (source, longueur de clé, clé).

**`server/src/modules/map/geoMatch.js`** — district ↔ contour :
- `normKey(name)` : NFD, accents retirés, minuscules, apostrophes supprimées, tout non-alphanumérique → espace, espaces réduits (« Anosibe-An'ala » → `anosibe anala`).
- `matchDistricts({ districts:[{pcode,name}], shapes:[{key,name}], links: Map<pcode, shapeKey|null> })`, dans l'ordre : (1) **manuel** (`map_shape_links`, `null` = « ne pas dessiner ») ; (2) **exact** ; (3) **normalisé** ; (4) **alias** (table figée et courte : Fort-Dauphin→Taolagnaro, Toliara→Toliary, Amboasary Sud→Amboasary-Atsimo, Betioky Sud→Betioky Atsimo, Ampanihy→Ampanihy Ouest ; proposé « à confirmer ») ; (5) **contour parent** : P-code à suffixe lettre (`MG52516a`) → contour de `MG52516` (contour partagé, signalé) ; (6) **aucun**. Un contour revendiqué par deux districts hors (1)/(5) = `conflit`, dessiné partagé et listé, jamais écarté en silence.
- Retour : `{ byPcode: { pcode: { shapeKey, how, sharedWith } }, byShape: { key: [pcode] }, unmatched: [pcode], conflicts: [] }`. Base de dev : 119 exacts + 1 contour parent = 120/120.

**`server/src/modules/map/mapThemes.js`** — une seule définition des thèmes, taux et signaux :

| id | Groupe | Libellé | Valeur | Gris (pas de valeur) | « — aucun plan » | Rampe |
|---|---|---|---|---|---|---|
| `active` | Registre | Sites actifs | `active` | active = 0 | — | bleu, comptes |
| `riskHigh` | Registre | Risque élevé | `riskHigh ÷ active` | active = 0 | — | orange, % |
| `realised` | Suivi | Sites visités | `realised` | active = 0 | — | bleu, comptes |
| `coverage` | Suivi | Couverture | `realised ÷ active` | active = 0 | non (0 % est une vraie valeur) | bleu, % |
| `planning` | Suivi | Planification | `planned ÷ active` | active = 0 | planned = 0 (hachures) | bleu, % |
| `execution` | Suivi | Exécution du plan | `visitsPlannedRealised ÷ visitsPlanned` | active = 0 | visitsPlanned = 0 | bleu, % |
| `submissions` | Données | Données versées | `submissions` | 0 | — | bleu, comptes |
| `alerts` | Alertes | Alertes | gravité max (0..2) + nombre | aucun signal | — | orange ordinale 3 pas + icône |

- `rate(num, den, { needsPlan })` → `{ value|null, num, den, reason: null|'aucun_site_actif'|'aucun_plan' }`.
- `signalsOf(counts)` → `[{ sev: 'critical'|'warning'|'info', kind, title, params, go }]` (même forme que `alertsMath`) : `high_risk_untouched` (critique, `highUntouched ≥ 1` : sites à risque élevé ni prévus ni visités), `plan_exec_low` (à surveiller, exécution < **0,5** = seuil de `alertsMath.js:103`), `no_plan` (à traiter), `visits_unassigned` (à traiter, comme `alertsMath`), `data_unlinked` (à traiter, `submissions − submissionsSite ≥ 1`, lien « À rapprocher »), `off_plan` (à traiter, visites hors plan). Seuils exportés en constantes.
- `aggregateShapes(rows, match)` : somme des comptes des districts d'un même contour puis **recalcule** taux et signaux (jamais une moyenne de taux) ; région = celle des membres ; `totalsOf(totals)` pour le chiffre clé.

**`server/src/modules/map/geoStats.js`** — `positionQuality({ n, spreadKm })` : **fiable** si n ≥ 3 et dispersion médiane ≤ 2 km, **indicative** si dispersion ≤ 5 km, **dispersée** au-delà (non placée comme site, signalée) ; `distanceKm(a, b)` équirectangulaire (même formule que le SQL, écart < 0,5 % à moins de 20 km).

**`server/src/modules/common/siteMonthSql.js`** — fragments SQL nommés (`SITE_MONTHS`, `REALISED_MONTHS`) avec les CTE `site_month`, `vis`, `dat`, `flags` ci-dessous ; seul endroit où vivent « actif / prévue / réalisée ».

### 5.2 Repository `server/src/modules/map/map.repository.js`

Chaque fonction : `withTenantTransaction`, premier ordre `SET LOCAL jit = off` (mesuré : ×15 sur 10 000 sites), `tenant_id = $1` sur chaque table, requêtes d'un même client l'une après l'autre (jamais `Promise.all`).

**`districtCounts(tenantId, { from, to, officeId, activity })`** — une requête (testée, 16–40 ms) :

```sql
WITH RECURSIVE offices AS (
  SELECT id FROM field_offices WHERE tenant_id = $1 AND id = $4
  UNION ALL SELECT f.id FROM field_offices f JOIN offices o ON f.parent_id = o.id WHERE f.tenant_id = $1),
months AS (SELECT generate_series($2::date, $3::date, interval '1 month')::date AS m),
site_d AS MATERIALIZED (
  SELECT s.id, s.risk_level, s.activity, s.adm3_pcode, s.security_situation >= 99 AS forbidden, s.gps_lat IS NOT NULL AS has_gps,
         CASE WHEN a.depth = 2 THEN a.id WHEN a.depth > 2 THEN a.lineage[2] END AS district_id,
         CASE WHEN a.depth = 1 THEN a.id WHEN a.depth > 1 THEN a.lineage[1] END AS region_id
    FROM sites s LEFT JOIN admin_areas a ON a.id = s.admin_area_id AND a.tenant_id = s.tenant_id
   WHERE s.tenant_id = $1
     AND ($4::uuid IS NULL OR s.field_office_id IN (SELECT id FROM offices))
     AND ($5::text IS NULL OR lower(btrim(s.activity)) = lower(btrim($5)))),
st AS (SELECT site_id, year * 12 + month - 1 AS k,
              lead(year * 12 + month - 1) OVER (PARTITION BY site_id ORDER BY year, month) AS k_next, active
         FROM site_month_status WHERE tenant_id = $1),
site_month AS MATERIALIZED (
  SELECT sd.id AS site_id, mo.m, NOT sd.forbidden AND COALESCE(st.active, true) AS active
    FROM site_d sd CROSS JOIN months mo
    LEFT JOIN st ON st.site_id = sd.id
     AND st.k <= extract(year FROM mo.m)::int * 12 + extract(month FROM mo.m)::int - 1
     AND (st.k_next IS NULL OR st.k_next > extract(year FROM mo.m)::int * 12 + extract(month FROM mo.m)::int - 1)),
vis AS (SELECT site_id, period_month AS m, bool_or(status <> 'annule') AS planned, bool_or(status = 'realise') AS declared,
               bool_or(status <> 'annule' AND provider_id IS NULL) AS unassigned
          FROM site_visits WHERE tenant_id = $1 AND period_month BETWEEN $2 AND $3 GROUP BY 1, 2),
dat AS (SELECT ms.site_id, ms.period_month AS m
          FROM monitoring_submissions ms
          JOIN monitoring_forms mf ON mf.id = ms.form_id AND mf.tenant_id = ms.tenant_id
          JOIN site_d sd ON sd.id = ms.site_id
         WHERE ms.tenant_id = $1 AND NOT ms.excluded AND ms.period_month BETWEEN $2 AND $3
           AND (mf.activity_category IS NULL OR sd.activity IS NULL OR lower(btrim(mf.activity_category)) = lower(btrim(sd.activity)))
         GROUP BY 1, 2),
cdat AS (SELECT DISTINCT adm3_pcode FROM monitoring_submissions
          WHERE tenant_id = $1 AND NOT excluded AND site_id IS NULL AND adm3_pcode IS NOT NULL AND period_month BETWEEN $2 AND $3),
sm AS (SELECT sm.site_id, sm.active, COALESCE(v.planned, false) AS planned, d.site_id IS NOT NULL AS with_data,
              COALESCE(v.declared, false) AS declared, COALESCE(v.unassigned, false) AS unassigned
         FROM site_month sm LEFT JOIN vis v ON v.site_id = sm.site_id AND v.m = sm.m
         LEFT JOIN dat d ON d.site_id = sm.site_id AND d.m = sm.m),
flags AS (SELECT site_id, bool_or(active) AS active, bool_or(active AND planned) AS planned,
                 bool_or(active AND (with_data OR declared)) AS realised, bool_or(active AND with_data) AS realised_data,
                 count(*) FILTER (WHERE active AND planned) AS v_planned,
                 count(*) FILTER (WHERE active AND planned AND (with_data OR declared)) AS v_planned_realised,
                 count(*) FILTER (WHERE active AND NOT planned AND (with_data OR declared)) AS v_off_plan,
                 count(*) FILTER (WHERE active AND planned AND unassigned) AS v_unassigned
            FROM sm GROUP BY 1),
agg AS (SELECT sd.district_id, sd.region_id, GROUPING(sd.district_id, sd.region_id) AS g,
               count(*)::int AS sites, count(*) FILTER (WHERE f.active)::int AS active,
               count(*) FILTER (WHERE f.realised)::int AS realised, count(*) FILTER (WHERE f.realised_data)::int AS realised_data,
               count(*) FILTER (WHERE f.planned)::int AS planned,
               sum(f.v_planned)::int AS visits_planned, sum(f.v_planned_realised)::int AS visits_planned_realised,
               sum(f.v_off_plan)::int AS visits_off_plan, sum(f.v_unassigned)::int AS visits_unassigned,
               count(*) FILTER (WHERE f.active AND sd.risk_level = 'elevee')::int AS risk_high,
               count(*) FILTER (WHERE f.active AND sd.risk_level = 'moyenne')::int AS risk_mid,
               count(*) FILTER (WHERE f.active AND sd.risk_level = 'faible')::int AS risk_low,
               count(*) FILTER (WHERE f.active AND sd.risk_level = 'elevee' AND NOT f.realised AND NOT f.planned)::int AS high_untouched,
               count(*) FILTER (WHERE f.active AND NOT f.realised AND sd.adm3_pcode IN (SELECT adm3_pcode FROM cdat))::int AS commune_data_only,
               count(*) FILTER (WHERE sd.has_gps)::int AS gps
          FROM site_d sd JOIN flags f ON f.site_id = sd.id
         GROUP BY GROUPING SETS ((sd.district_id, sd.region_id), ())),
subs AS (SELECT COALESCE(sd.district_id, CASE WHEN c.depth = 2 THEN c.id WHEN c.depth > 2 THEN c.lineage[2] END) AS district_id,
                count(*)::int AS n, count(*) FILTER (WHERE ms.site_id IS NOT NULL)::int AS n_site
           FROM monitoring_submissions ms
           JOIN monitoring_forms mf ON mf.id = ms.form_id AND mf.tenant_id = ms.tenant_id
           LEFT JOIN site_d sd ON sd.id = ms.site_id
           LEFT JOIN sites s0 ON s0.id = ms.site_id AND s0.tenant_id = ms.tenant_id
           LEFT JOIN admin_areas c ON c.tenant_id = ms.tenant_id AND c.pcode = ms.adm3_pcode
          WHERE ms.tenant_id = $1 AND NOT ms.excluded AND ms.period_month BETWEEN $2 AND $3
            AND ($4::uuid IS NULL OR COALESCE(s0.field_office_id, ms.field_office_id) IN (SELECT id FROM offices))
            AND ($5::text IS NULL OR lower(btrim(mf.activity_category)) = lower(btrim($5)))
          GROUP BY 1)
SELECT d.pcode, d.name, r.name AS region, a.*, s.n AS submissions, s.n_site AS submissions_site
  FROM admin_areas d LEFT JOIN admin_areas r ON r.id = d.parent_id
  LEFT JOIN agg a ON a.district_id = d.id AND a.g = 0 LEFT JOIN subs s ON s.district_id = d.id
 WHERE d.tenant_id = $1 AND d.depth = 2 AND (a.sites IS NOT NULL OR s.n IS NOT NULL)
-- + mêmes CTE : lignes « région seulement » (agg g = 0, district NULL), « sans localité », total (g = 3),
--   soumissions non localisées (subs district NULL) — une requête, plusieurs ensembles (json_build_object
--   comme dans scratchpad/design/6a/map_districts_final.sql, ou UNION ALL typé).
```

Autres lectures (même transaction, l'une après l'autre) : `shapeLinks(tenantId, shapeSet)` ; `districtIndex(tenantId)` (120 lignes pcode/nom/région, pour colorer les limites de régions sur tous les contours) ; `filtersAvailable(tenantId)` (bureaux avec parent, activités distinctes des sites avec effectifs).

**`points(tenantId, { from, to, officeId, activity, layers, limit, precise, maxAccuracyM })`** :
- `sites` (couche GPS) : sites du périmètre avec `gps_lat`, statut de période tiré des mêmes `flags` (`realise` | `prevu` | `hors_plan` | `non_prevu` | `inactif`).
- `derived` : par site sans GPS, médiane `percentile_cont(0.5)` des `gps_lat/gps_lng` de ses soumissions (`site_id`, non écartées, précision ≤ 100 m, **tout l'historique** : une position est une propriété du site, pas de la période), `n`, dispersion médiane et p90 (km) ; qualité par `positionQuality`.
- `communes` : même calcul par `adm3_pcode`, + nombre de sites du périmètre sans GPS ni position propre dans la commune et jusqu'à 10 noms (`(array_agg(name ORDER BY name))[1:10]`).
- `collect` : points de la **période** (index `idx_mon_sub_gps_month`), `ORDER BY period_month DESC, id LIMIT $limit + 1` ; au-delà de `limit` (défaut 2 000, max 5 000) ou si `precise = false` : **carroyage** `round(gps_lat / 0.02) * 0.02` (≈ 2 km) avec effectifs. `lastMonth` = dernier mois ayant des points.

**`search(tenantId, q)`** : districts et communes par préfixe (`lower(name) LIKE lower($2) || '%'`, index `idx_admin_areas_name`) ou P-code, sites par nom / code / `location_id` ; 20 résultats max.

### 5.3 Service, contrôleur, routes — `server/src/modules/map/*`, monté `app.use('/api/map', mapRoutes)` dans `server/src/app.js` (après `:101`)

Couche `routes → controller → service → repository` (comme `dashboards/alerts.*`). Le service appelle `matchDistricts` (index des formes `server/src/modules/map/shapes/mdg-adm2.v1.json` + liens manuels), `aggregateShapes`, `signalsOf`, `positionQuality`.

| Route | Rôle | Validation (zod, 400 sinon) |
|---|---|---|
| `GET /api/map/districts?from&to&month&office&activity` | tout utilisateur authentifié | mois `^\d{4}-(0[1-9]\|1[0-2])$`, `from ≤ to`, ≤ 36 mois, `office` uuid, `activity` ≤ 200 car. ; sans période → 400 (l'écran envoie toujours la sienne) |
| `GET /api/map/points?…&layers=gps,derived,communes,collect&limit` | idem ; points précis seulement pour `admin`/`manager`, carroyage pour `viewer` | `limit` 1..5000 |
| `GET /api/map/search?q` | idem | 2..80 car. |
| `GET /api/map/shape-links` · `PUT /api/map/shape-links/:pcode {shapeKey\|null}` · `DELETE …/:pcode` | `requireRole('admin')` | P-code district du compte (404 sinon), `shapeKey` ∈ index (400 « contour inconnu ») |

Réponse `GET /api/map/districts` :

```json
{
  "period": { "from": "2026-09", "to": "2026-09", "months": 1 },
  "filters": { "officeId": null, "activity": null },
  "geometry": { "asset": "geo/mdg-adm2.v1.json", "shapeSet": "mdg-adm2.v1", "source": "geoBoundaries ADM2 (CC BY 4.0)" },
  "themes": [{ "id": "coverage", "group": "suivi", "label": "Couverture", "kind": "pct" }],
  "shapes": [{
    "key": "betioky atsimo", "name": "Betioky Atsimo", "region": "Atsimo Andrefana",
    "districts": [{ "pcode": "MG51506", "name": "Betioky Atsimo", "how": "exact" }],
    "counts": { "sites": 322, "active": 322, "realised": 2, "realisedData": 1, "planned": 1, "visitsPlanned": 1,
                "visitsPlannedRealised": 1, "visitsOffPlan": 1, "visitsUnassigned": 0, "riskHigh": 236, "riskMid": 11,
                "riskLow": 75, "highUntouched": 233, "communeDataOnly": 40, "gps": 21, "submissions": 13, "submissionsSite": 1 },
    "rates": { "coverage": { "value": 0.0062, "num": 2, "den": 322, "reason": null },
               "planning": { "value": 0.0031, "num": 1, "den": 322, "reason": null },
               "execution": { "value": 1, "num": 1, "den": 1, "reason": null } },
    "signals": [{ "sev": "critical", "kind": "high_risk_untouched", "title": "{n} site(s) à risque élevé ni prévus ni visités", "params": { "n": 233 } }]
  }],
  "shapeRegions": { "betioky atsimo": "Atsimo Andrefana" },
  "unmatched": [], "conflicts": [],
  "regionOnly": [{ "pcode": "MG52", "name": "Androy", "counts": { "sites": 33, "active": 33, "realised": 0 } }],
  "unplaced": { "sites": 2 }, "submissionsUnlocated": 13,
  "totals": { "counts": {}, "rates": {} },
  "filtersAvailable": { "offices": [{ "id": "…", "name": "Antenne Ambovombe", "parentId": "…" }], "activities": [{ "value": "School meal activities", "sites": 824 }] },
  "computedAt": "2026-10-13T16:30:00Z"
}
```

Réponse `GET /api/map/points` : `{ sites:[{id,name,code,lat,lng,kind:'gps'|'collectes',n?,spreadKm?,quality?,status,risk,districtPcode}], communes:[{pcode,name,lat,lng,n,spreadKm,quality,sitesWithoutPosition,sites:[{id,name}]}], collect:{ mode:'points'|'bins', points|bins, total, lastMonth }, rejected:{ accuracy: 9 }, limits:{ collect: 2000, maxAccuracyM: 100 } }`.

---

## 6. Géométrie embarquée (hors ligne)

- **Build reproductible** `web/scripts/build-geo.mjs` (fonctions pures dans `web/scripts/geoBuild.js`) : lit la source geoBoundaries, simplifie **en conservant les frontières partagées** (sommets de jonction fixes, Douglas-Peucker 0,005° par arc en sens canonique : les deux voisins gardent exactement la même frontière ; 23 816 des 31 328 sommets sont partagés, à 4 décimales exactes), coordonnées à 4 décimales, point d'étiquette = pôle d'inaccessibilité du plus grand anneau, bbox et aire. Sorties : `web/public/geo/mdg-adm2.v1.json` (contours, `properties: { key, name, label, bbox, area }`, 88 Ko gzip, nom versionné → cache long) et `server/src/modules/map/shapes/mdg-adm2.v1.json` (index : key, name, bbox — ~10 Ko).
- Source déplacée (commit 7) : `web/public/mdg-adm2.geojson` (1 Mo, servi aujourd'hui) → `web/geo-src/mdg-adm2.geoboundaries.geojson` (non servi).
- **Limites de régions sans donnée supplémentaire** : dessin région par région (trait épais puis remplissage), seule la limite extérieure de chaque région reste visible ; région de chaque contour = `shapeRegions` de l'API. (Les arcs frontières en fichier séparé coûteraient 45 Ko gzip de plus : écarté.)
- **Fond en ligne optionnel** (commit 10) : tuiles XYZ sous le SVG (même projection Web Mercator), désactivé par défaut, URL `VITE_MAP_TILES_URL` (défaut OSM, attribution « © OpenStreetMap ») ; activation = sonde d'une tuile, échec → couche coupée + message « Fond en ligne indisponible (hors connexion) : la carte reste complète sans fond ». Jamais d'erreur console tant qu'il est éteint ; jamais dans l'export.

---

## 7. Interface

### 7.1 Composant partagé `web/src/components/map/`

`<MapExplorer variant="full|compact" period={{from,to}} officeId activity initialTheme initialLayers onNavigate storageKey title />` = `useMapData` (appels `mapDistricts` + `mapPoints` en parallèle, contours chargés une fois par promesse de module, abandon des réponses périmées) + :

- **`DistrictMap.jsx`** — SVG, sans Leaflet. Projection Web Mercator (`lib/mapProjection.js`), chemins mémorisés par géométrie et taille, changement de thème = seuls les `fill` changent. Zoom / déplacement : boutons + / − / ⌂ (cadrer les données), double-clic, glisser, pincer, molette avec Ctrl (la page défile normalement) ; pendant le geste, `transform` CSS sur le groupe, puis recalcul des points (taille écran constante) et des étiquettes (≤ 120 ms après le geste). `vector-effect: non-scaling-stroke`. Survol par délégation (`data-key`, rAF) ; toucher = fiche épinglée. « Zoom sur la région » et recherche → cadrage sur la bbox. Mini-carte de situation (silhouette + rectangle de l'emprise) quand le zoom > 1,5.
- **Couches de points** : sites GPS (disque 9 px, couleur du **statut de la période** : réalisé `--green`, prévu `--orange`, non prévu encre, inactif creux gris — libellés dans la légende et la fiche) ; site placé par ses collectes (anneau plein = fiable, pointillé = indicatif) ; centre des collectes de commune (anneau pointillé de rayon √sites, nombre de sites dedans dès 2) ; points de collecte (violet `#6250d6`, 5 px ; carroyage pour `viewer` et dans l'export).
- **`MapPanel.jsx`** (gauche, 292 px) : chiffre clé du thème sur **tout le périmètre** (y compris région seulement), pied explicite (« 17 sites réalisés / 1 280 actifs (sites distincts) · dont 1 par les données ») ; recherche (district, commune, site ; 2 car., 200 ms) ; bascule « Plus élevés / Plus faibles » ; classement (district + région, pastille couleur de la classe, texte encre ou blanc selon la classe ; « — aucun plan » en pastille contour) ; section « Sans district reconnu » (régions seulement, lien « À rapprocher ») ; « Voir en tableau » (tableau complet accessible + CSV via `lib/csv.js`).
- **`MapLayers.jsx`** (droite, 236 px) : pastilles de thèmes par groupe (Registre · Suivi · Données & alertes), cases des points avec effectifs (« Points de collecte 0 · derniers : juil. 2026 » + « étendre à 12 mois » une fois la plage 1b disponible), fond (noms des districts, limites des régions, OSM en ligne), notes (contour partagé, districts sans contour, points écartés, sites sans district) avec liens vers Paramétrage.
- **`MapLegend.jsx`** (bas gauche, repliable ; repliée en compact et sur téléphone ; la marge basse du cadrage tient compte de sa hauteur) : barre graduée + seuils, « Aucun site actif » / « Aucune donnée », hachures « — aucun plan », symboles de points.
- **`MapHoverCard.jsx`** : district (+ « + Antanimora Sud » si partagé), région · période · « sites distincts » ; grande valeur + libellé du thème ; lignes Sites actifs · Réalisés (n · %) dont données / déclarées · Prévus (n · % ou « — aucun plan ») · Exécution (visites n / N · %) · Hors plan · Risque élevé · moyen · faible · Données versées (dont au site) · Sites de communes avec données, non comptés comme visites · Sites GPS · placés ; jusqu'à 3 signaux (icône + libellé) ; source. Clic = zoom + fiche épinglée + « Voir les sites ».

Variante **compact** (Vue d'ensemble) : en-tête de carte « Carte du suivi » + onglets Couverture · Sites actifs · Données versées · Alertes + « Ouvrir la carte » ; corps = carte (2/3) + colonne chiffre clé et 8 premiers du classement ; pas de panneau de couches. **Téléphone** (≤ 760 px) : chiffre clé, carte 420 px, classement, couches dans un volet repliable ; pas de défilement horizontal. Captures du prototype : `v2_page_coverage_sep_hover.png`, `v2_page_alerts_sep.png`, `v2_page_subs_janoct.png`, `v2_page_exec_janoct.png`, `v2_dash_coverage_sep.png`, `v2_mobile_coverage_sep.png`, `v2_dark_active_sep.png`.

### 7.2 Échelles et couleurs — `web/src/lib/mapScale.js` (pure)

Rampes ordinales **validées** (`dataviz/scripts/validate_palette.js --ordinal`, PASS) :

| Rampe | Clair (surface #fff) | Sombre (surface #1b212c) |
|---|---|---|
| bleu (magnitude) | `#86b6ef #5598e7 #2a78d6 #1c5cab #0d366b` (2,06:1) | `#1c5cab #2a78d6 #5598e7 #86b6ef #cde2fb` (2,44:1) |
| orange (risque) | `#f2a074 #ec7a45 #d95926 #ad3f14 #7a2a0b` (2,09:1) | `#ad3f14 #d95926 #ec7a45 #f2a074 #f8c9ad` (2,69:1) |
| alertes (3 pas) | `#f2a074 #d95926 #7a2a0b` + icônes ◷ / ⚠ / ✕ | `#d95926 #f2a074 #f8c9ad` |

(La rampe sombre partant de `#184f95` échoue de peu : 1,99:1 → départ à `#1c5cab`.) La palette de statut en aplat **échoue** au contrôle toutes-paires (normal 13,6, CVD 4,1) : les alertes sont donc une rampe ordinale + icône + libellé (« Statuts = couleur + icône + libellé »). Seuils : pourcentages fixes `0 · >0 · 25 · 50 · 75 · 100 %` (0 % distinct d'« un peu » ; comparables d'une période à l'autre) ; comptes = quantiles 20/40/60/80 % arrondis à la série 1-2-5, dédoublonnés (≤ 5 classes). `formatRate` : 0 → « 0 % », < 10 → une décimale (« 1,3 % »), sinon entier ; locale via `lib/format.js`.

Jetons ajoutés dans le bloc « REFONTE PROFESSIONNELLE (v6) » (`web/src/styles.css:1403+`) et redéfinis sous `:root[data-theme="dark"]` (`:1636`) : `--map-bg`, `--map-empty`, `--map-line`, `--map-ink`, `--map-halo`, `--map-hatch-a`, `--map-hatch-b`, `--map-seq-blue-1..5`, `--map-seq-orange-1..5`, `--map-warn-bg/-text`. Classes `.mapx-*` ; cartes radius 14, contrôles 38 px, Inter + `tabular-nums`.

### 7.3 Écrans

1. **Couverture & performance › Carte** (`DashboardCoveragePage.jsx`) : `MapView` (`:572-603`), le chargement `api.fieldMap()` (`:68-69`) et l'import `madagascarMap` (`:10`) remplacés par `<MapExplorer variant="full" period={{from: month, to: month}} />` (la plage du lot 1b ensuite). `RegionsCard` reste pour la vue d'ensemble (`:215`).
2. **Dashboard décisionnel › Vue d'ensemble** (`DashboardBIPage.jsx`) : section « Carte du suivi » pleine largeur sous les tuiles KPI (après `:219`), avec sa barre de filtres (période par défaut + bandeau `PeriodBanner`, bureau, activité). Elle **remplace** « Couverture terrain — mois courant » (`:270-287`, appel `:190`). « Ouvrir la carte » : `sessionStorage['mems.map.open'] = { view: 'carte', theme, period, officeId, activity }` + `onNavigate('dashboard', 'couverture')` (`App.jsx:114` passe `onNavigate`).
3. **Suivi de processus › Carte des sites** (`SitesMapPage.jsx`, route `App.jsx:130`, nav `AppShell.jsx:47`) : `MapExplorer` (thème « Sites actifs », toutes les couches de points) + « Registre géographique » : région → district depuis `/api/map/districts` (sites, actifs, réalisés, couverture, mix de risque, GPS / placés), plus « Sans district reconnu ». Fin des 1 294 / 32 districts.
4. **Paramétrage › Localités › « Contours de la carte »** (nouvel onglet de `LocalitiesSection.jsx`, à côté de « À rapprocher ») : tableau P-code · district · région · sites · correspondance (badge icône + libellé : exact, normalisé, alias à confirmer, contour parent, manuel, aucun, conflit) · liste des 119 contours + « Ne pas dessiner » ; filtre « à vérifier » par défaut.

États vides : aucun site dans le périmètre (« Aucun site pour ce bureau / cette activité » + réinitialiser) ; contours indisponibles (classement et tableau restent exacts) ; thème sans valeur (légende « Aucune valeur sur la période », chiffre « — ») ; aucun point de collecte sur la période (case grisée + dernier mois).

### 7.4 Accessibilité

SVG `role="img"` + `aria-label` résumant thème, période et chiffre clé ; le classement est l'alternative clavier (flèches, Entrée = zoom, Échap = vue d'ensemble) ; tableau complet ; hachures pour « — aucun plan » (impression, CVD) ; pastilles et légende jamais en couleur seule ; contraste du texte des pastilles vérifié ; cibles ≥ 34 px.

---

## 8. Export image et impression (commit 8)

`web/src/lib/mapExport.js` : `buildExportSvg(model)` **pur** (chaîne SVG 1 600 × 1 100 : titre « Couverture du suivi — {thème} par district », période et filtres en clair, carte de l'emprise affichée ou du pays, légende graduée, flèche du nord, échelle calculée à la latitude du centre, carte de situation, pied « Source : registre des sites, visites et soumissions MEMS · contours geoBoundaries ADM2 (CC BY 4.0) · calculé le … · MEMS 2.0 · Suivi & évaluation » ; textes échappés ; aucune URL externe ; police Inter intégrée en base64 depuis `@fontsource` via import `?url`, repli sans-serif) ; `downloadPng(svg, nom, { scale: 2 })` via `Image` + `canvas` (aucune dépendance) → `carte-{theme}-{from}_{to}.png`. **Imprimer** : même SVG dans un conteneur réservé à l'impression, `@page { size: A4 landscape; margin: 10mm }`. Points de collecte toujours en carroyage dans l'export. Le lot 7a réutilise `buildExportSvg` + `/api/map/districts` pour son bloc « carte ».

---

## 9. i18n

Dictionnaire `web/src/locales/en/map.js`, enregistré dans `web/src/locales/en.js` ; clés = phrases françaises exactes ; libellés de thèmes, signaux et légendes traduits à l'affichage (`tr(def.label)`). Phrases principales : « Carte du suivi » → Monitoring map · « Sites actifs » → Active sites · « Sites visités » → Visited sites · « Couverture » → Coverage · « Planification » → Planning · « Exécution du plan » → Plan execution · « Risque élevé » → High risk · « Données versées » → Data received · « Alertes » → Alerts · « — aucun plan » → — no plan · « Aucun site actif » → No active site · « Plus élevés » / « Plus faibles » → Highest / Lowest · « Rechercher un district, une commune, un site… » → Search a district, commune or site… · « Sans district reconnu » → No recognised district · « Sites GPS » → GPS sites · « Placé par ses collectes » → Placed from its data collections · « Centre des collectes de la commune » → Commune data-collection centre · « Points de collecte » → Collection points · « Fond OpenStreetMap (en ligne) » → OpenStreetMap background (online) · « Noms des districts » → District names · « Limites des régions » → Region boundaries · « Contour commun : {a} + {b} (contour 2018 non scindé) » → Shared outline: {a} + {b} (2018 outline not split) · « {n} site(s) à risque élevé ni prévus ni visités » → {n} high-risk site(s) neither planned nor visited · « Exécution du plan {p} (< 50 %) » → Plan execution {p} (< 50%) · « Aucun site prévu sur la période » → No site planned in the period · « {n} soumission(s) non rattachée(s) à un site » → {n} submission(s) not linked to a site · « Sites de communes avec données, non comptés comme visites » → Sites in communes with data, not counted as visits · « Image PNG » → PNG image · « Imprimer » → Print · « Ouvrir la carte » → Open the map · « Voir en tableau » → View as table · « Contours de la carte » → Map outlines · « Ne pas dessiner » → Do not draw · « Fond en ligne indisponible (hors connexion) : la carte reste complète sans fond » → Online background unavailable (offline): the map stays complete without it. Le balayage EN (`window.__memsMissingTr`) doit rester vide.

---

## 10. Budget de performance et mesure

| Mesure | Budget | Mesuré | Comment mesurer |
|---|---|---|---|
| `GET /api/map/districts` (dev, 1–24 mois, avec ou sans filtres) | p95 ≤ 150 ms | SQL 16 / 25 / 40 ms ; filtre bureau 18 ms, activité 14 ms | `server/scripts/bench-map.js` : 20 appels du repository par cas, p50 / p95, `EXPLAIN (ANALYZE, SUMMARY)` |
| Idem, 10 000 sites × 12 mois | ≤ 400 ms | 164 ms sans JIT (2,4 s avec) | variante synthétique ×8 en lecture seule (`scratchpad/design/6a/bench_x8.sql`) ; test : `SET LOCAL jit = off` en premier ordre |
| `GET /api/map/points` | ≤ 100 ms, ≤ 300 Ko | 24 ms (calcul en ligne sur jsonb ; plus rapide avec les colonnes générées et index partiels) | même script ; plafond 2 000 points puis carroyage |
| Contours | ≤ 100 Ko gzip, analyse + projection ≤ 50 ms | 88 Ko ; 65 ms analyse + rendu complet | `server/test/mapAssets.test.js` (taille) ; marques `performance.mark('mapx:data')` / `('mapx:painted')` |
| Premier rendu après données | ≤ 300 ms à CPU ×4 | 270 ms (prototype, 511 nœuds) | balayage Playwright (`Emulation.setCPUThrottlingRate`) lisant `performance.measure` |
| Changement de thème · survol | ≤ 50 ms · ≤ 16 ms | — | même balayage (marques `mapx:theme`) |
| Erreurs console hors ligne | 0 | 30 aujourd'hui (Carte des sites) | balayage Playwright de toutes les routes, réseau externe coupé |

Piège corrigé pendant la mesure : la première écriture (statut d'activité par sous-requête corrélée, CTE inlinée dans chaque agrégat) prenait 2,4–4,7 s même sur la base de dev ; la version à intervalles (`lead()`) + CTE `MATERIALIZED` ci-dessus en prend 16–40.

---

## 11. Sécurité, multitenant, vie privée

- Tenant uniquement depuis `req.auth` ; `tenant_id = $1` sur chaque table + `withTenantTransaction` (RLS en filet) ; `map_shape_links` en RLS forcée + `trg_same_tenant` (migration 049) ; corrections validées contre le découpage du compte et l'index des contours.
- Entrées bornées (zod) : mois valides, plage ≤ 36 mois, `limit` ≤ 5 000, recherche ≤ 80 car. ; erreurs via le gestionnaire central (400 / 404 / 409).
- **Vie privée** : `HHCoord` est vraisemblablement la position d'un **ménage enquêté**. Points précis réservés à `admin` / `manager` ; `viewer` et tout export reçoivent un carroyage de 2 km ; aucune donnée individuelle dans la fiche d'un point (mois, fiche, site rattaché seulement).
- Textes de district, commune et site échappés dans le SVG exporté et les infobulles (`lib/html.js`).

---

## 12. Risques

1. **Données de dev clairsemées** : 13 soumissions rattachées à un site → couverture 1,3 %. C'est la vérité ; la carte l'explique (pied du chiffre clé, ligne « sites de communes avec données, non comptés », signal « non rattachées », lien « À rapprocher ») et le thème « Données versées » est riche (9 à 14 districts). Le vrai remède est le rattachement aux sites (lots 3 et 4).
2. **Risque saturé** : 1 151 / 1 280 sites « élevé » → thèmes Risque et Alertes presque uniformes (13 contours critiques). Seuils en constantes ; à revoir avec les priorités configurables (lot 5, `rbmScore` en reprise : 6a n'y touche pas et n'a pas de thème « à suivre (RBM) »).
3. **Contours 2018 vs découpage 2023** (Antanimora Sud) : contour partagé signalé, correction manuelle ; contours importés au lot 6.
4. **JIT PostgreSQL** : ×15 à l'échelle ; `SET LOCAL jit = off` testé. (Constat annexe : `coverage-dashboard` met 587 ms sur la base de dev — même cause probable, hors lot.)
5. **Colonnes générées** : PostgreSQL ≥ 12 requis (README : 16) ; changer la règle impose un recalcul (`UPDATE … SET data = data`), écrit dans la migration.
6. **Conflits de fusion** avec 1b (filtres de période dans `DashboardCoveragePage.jsx` et `DashboardBIPage.jsx`) : changements de 6a localisés (remplacement de `MapView`, une section ajoutée) ; rebase après 1b.
7. **Étiquettes** : à l'échelle du pays, une partie est masquée (collision) ; visibles au zoom, au survol et dans le classement.
8. **Fond OSM** : politique d'usage et absence de réseau → désactivé par défaut. `PlanBoardPage.jsx:459` reste sur Leaflet + OSM (hors lot ; à migrer au lot 6) : Leaflet reste une dépendance.
9. **Export** : la police dans l'image dépend de l'intégration base64 ; repli sans-serif accepté.

## 13. Coordination

- **1b** : mêmes noms `from` / `to` (+ `month`), même règle d'activité (dernier statut ≤ m, défaut actif) dans `common/siteMonthSql.js` ; 6a adopte le sélecteur de plage et l'analyseur de période de 1b dès leur fusion (changement d'une ligne par écran).
- **7a** : migrations 062+ ; bloc « carte » = `buildExportSvg` + `/api/map/districts`.
- **Correctifs du lot 1 en cours** (`collectionDate`/`submissionsImport`, éditeur d'indicateurs, `TrendChart`/alertes/cloche/reporting, `rbmScore`/`RbmPage`) : 6a ne modifie aucun de ces fichiers (colonne générée = import intact ; signaux de carte locaux à `mapThemes` ; seuil 0,5 aligné sur `alertsMath.js:103`, à mutualiser après la fusion des correctifs).
- **Lot 4** : le motif obligatoire des visites déclarées s'ajoute dans `siteMonthSql.js` (une seule place).

## 14. Documentation

À chaque commit : `docs/JOURNAL.md` (heure UTC, statut, commit, vérifications). En fin de lot : `CLAUDE.md` (« Carte du suivi » dans *What's implemented*), `docs/ETAT_DU_PROJET.md`, `docs/RETOURS_UTILISATEUR.md` (49, 50 ✅ ; 17, 27 ✅ pour la carte ; 41, 44 partiels → lot 6).

## 15. Commits, dans l'ordre (chacun livrable seul ; détail des fichiers et tests dans la liste structurée)

1. Contours allégés à frontières partagées + index des formes (script de build, aucun écran touché).
2. Migration 061 (GPS en colonnes générées, `map_shape_links`) + modules purs `submissionGps`, `geoMatch`.
3. `GET /api/map/districts` (`siteMonthSql`, `mapThemes`, repository / service / contrôleur / routes, banc d'essai).
4. `GET /api/map/points` et `/api/map/search` (`geoStats`, carroyage selon le rôle).
5. Composant partagé `MapExplorer` branché dans Couverture & performance › Carte (remplace `MapView`).
6. Section « Carte du suivi » dans Dashboard décisionnel › Vue d'ensemble (remplace « Couverture terrain — mois courant »).
7. Carte des sites sur le composant partagé + registre géographique ; retrait de `/api/tpm/field/map`, `madagascarMap.js`, `geo.js` (inutilisé), GeoJSON source sorti de `public/`.
8. Export PNG et impression A4 paysage.
9. Paramétrage › Localités › « Contours de la carte » (correction manuelle).
10. Fond OpenStreetMap optionnel, éteint par défaut, coupé hors connexion.
11. Documentation de fin de lot (CLAUDE.md, ETAT_DU_PROJET, RETOURS_UTILISATEUR).

Vérification de chaque commit : `cd server && npm test && npm run lint`, `cd web && npm run build`, balayage Playwright des routes touchées (FR et EN, 1 440 et 390 px, clair et sombre, 0 erreur console, `__memsMissingTr` vide), journal mis à jour et poussé.

---

## Décisions prises (13/10/2026)

Questions ouvertes de la conception, tranchées pour avancer (modifiables) :

- Exécution du plan mesurée en visites (site × mois), comme 1b.
- Visites « déclarées réalisées » sans donnée : comptées, montrées à part (« dont N déclarées sans donnée ») jusqu'au motif obligatoire du lot 4.
- Antanimora Sud (sans contour 2018) : dessiné avec le contour du district parent, signalé « contour partagé ».
- Points GPS des ménages : position d'un site déduite seulement avec au moins 3 relevés (sinon « position insuffisante », compté dans les notes) ; points précis pour admin et gestionnaire, carroyage de 2 km pour les lecteurs et dans tout export ; les clés GPS des ménages sont retirées des listes de soumissions pour les lecteurs.
- La section carte remplace la carte « Couverture terrain — mois courant » de la Vue d'ensemble (une seule règle).
- Signal « sites à risque élevé ni prévus ni visités » : district « critique » seulement si la part atteint 50 % (sinon « à surveiller ») jusqu'au lot 5.
- Fond OpenStreetMap : couche facultative (interrupteur), le fond vectoriel hors ligne (contours des districts, noms) est toujours dessiné ; URL de tuiles configurable (`VITE_MAP_TILES_URL`, OSM par défaut, vide = désactivé).
- Site actif sans grille : même règle que 1b (`activationKnown`).
- Classes de % : 0 · 1–24 · 25–49 · 50–79 · ≥ 80 % (cible 80 %).
- La tuile « Couverture » de Couverture & performance et la carte lisent le MÊME service (faits site × mois de 1b) : jamais deux couvertures différentes sur une page.
- GPS des soumissions : un déclencheur BEFORE INSERT/UPDATE OF data calcule une seule fois par ligne `gps_lat` / `gps_lng` / `gps_accuracy_m` (colonnes simples, index partiels) — pas trois colonnes générées ; coût mesuré sur 50 000 lignes.

## Corrections exigées par la critique de complétude

À appliquer pendant la réalisation (elles priment sur le texte ci-dessus en cas de contradiction) :

- **[high]** §4 says the GPS function is cheap and that rewriting 50,000 rows takes "quelques secondes". It does not, and the three generated columns run the function three times per row. I measured it on the dev DB inside a rolled-back transaction, using a temp copy of the §4 function (critic6a/gencost.sql). One evaluation costs about 0.54 ms per row (562 rows in 272 ms; 11,240 rows in 6.0 s). Inserting 28,100 rows into a table with the three GENERATED columns took 44.7 s, against 0.23 s for the same rows without them, so about 1.6 ms per row. That puts the 50k rewrite at about 80 s under ACCESS EXCLUSIVE, and every Kobo/SAV/XLSX import (monitoring.repository.js:1057, inside the import transaction) gets about 1.6 s slower per 1,000 rows. Pre-filtering the geopoint branch gave only about 5%. Good news from the same test: an UPDATE of other columns does not recompute the columns on PG 16 (28k rows in 35 ms), so the place-link re-applications in placeMatch.repository.js:366/447/540 are not affected.
  - *Correction* : Evaluate the rule once per row. Either use one BEFORE INSERT OR UPDATE OF data trigger that calls mems_submission_gps(data) once and fills plain gps_lat/gps_lng/gps_accuracy_m columns (keeps typed columns and partial indexes), or use a single generated numeric[] column. In the function, only scan keys with LIKE '%atitude%' and only try the geopoint regex on string values containing a space and a '.'. Fix the §4 note to say about 0.5 ms/row, about 25 s per 50k rows. Add an import-cost case to bench-map.js (10k synthetic submissions, budget about 6 s) and log it in the journal.
- **[high]** The privacy rule (precise points for admin/manager only, a 2 km grid for viewers and exports) does not hold. (a) Derived positions are medians of household HHCoord points, and many rest on one or two households. On the dev DB, 11 of the 43 commune centres have n<3 (6 have n=1), and the only site 'placé par ses collectes' rests on 1–2 points. The spec's positionQuality makes n=1 with spread 0 'indicative', so it gets placed. The median of one point is that household's exact position, and the communes/derived layers go to every role. (b) GET /api/monitoring/forms/:id/submissions (monitoring.routes.js:373, no requireRole) returns ms.data (monitoring.repository.js:601) to any authenticated user, raw @_HHCoord_latitude/longitude included. A viewer therefore already gets precise household GPS.
  - *Correction* : In geoStats.positionQuality, require n ≥ 3 for any placement. Below that, return 'insuffisant': not drawn, counted in the notes. For viewers and in buildExportSvg, snap derived and commune centres with n < 5 to the same 2 km grid. In formSubmissions/listSubmissions, strip keys matching submissionGps.LAT_KEY_RE (and the _longitude/_precision/_altitude siblings, the HHCoord geopoint strings and _geolocation) from data for role 'viewer'. Add route tests: a viewer never receives a coordinate with more than 2 decimals.
- **[high]** Couverture & performance would show two different 'Couverture' figures for the same month on the same page. The Synthèse tile (DashboardCoveragePage.jsx:143/174) uses fieldSummary (field.repository.js:480, summarizeVisits): realised ÷ (realised + planned) visits = 16/22 = 73% in Sept 2026. The new Carte tab of the same page shows sites actifs réalisés ÷ actifs = 17/1,280 = 1.3%. 1b may fix the tile, but 6a runs in parallel and can merge first. The spec never mentions this clash, and contradictory numbers are exactly what retour 49 complains about.
  - *Correction* : Have 6a give /api/map/districts totals (counts + rates) as the source for the Synthèse 'Couverture' tile on DashboardCoveragePage, with the PLAN definition and the pied 'sites actifs réalisés / actifs (sites distincts)'. Relabel the old visit ratio 'Exécution du plan (visites)'. If 1b owns that change, make 6a's commit 5 depend on it explicitly in §13, plus a Playwright assertion that the tile and the map key figure are equal for the same month.
- **[medium]** Retour 50 asks for the same filters (période, bureau, activité) in both Vue d'ensemble and Couverture & performance. The Couverture page has only a MonthSelect (DashboardCoveragePage.jsx:86), and §7.3.1 passes only period={{from: month, to: month}}. Bureau and activité controls exist only on the Vue d'ensemble section. 'Ouvrir la carte' then hands officeId/activity over through sessionStorage to a page with nothing to show or change them.
  - *Correction* : Put the bureau + activité filter bar (codeLabel names, office subtree) inside MapExplorer in both variants, seeded from props and from sessionStorage['mems.map.open']. Show the active filters as removable chips in the panel header. Test in commit 6: a filter set on Vue d'ensemble is visible and editable after 'Ouvrir la carte'.
- **[medium]** Several asks from retour 17 and the retour 27 references (design_refs/7.png, 8.png) are missing. Ref 7's side panel has 'Performance par activité' (SMP / STUNT / MAM / PREV: sites, plan, 'aucun plan') and '… site(s) jamais visité(s)'. Ref 8 has an 'État du suivi par région' map (Normal / Attention / Alerte / Sans site) and 'Régions à surveiller'. Retour 17 asks for the map 'par commune / district / bureau'. The spec only aggregates by district: bureau is just a filter, communes are just centre points, and there is no per-activity breakdown.
  - *Correction* : Add GROUPING SETS ((district_id, region_id), (region_id), (activity), ()) to districtCounts, plus a bureau grouping through the field_offices tree (one query). Give the ranking a 'Niveau : District · Région · Bureau · Commune' toggle. Commune ranking is a table only: group by adm3_pcode, no outlines. Add a 'Par activité' block to MapPanel (actifs / prévus / réalisés / taux, or '— aucun plan'). Add a 'jamais visités' line (no realised month in the whole history) to the key-figure footer.
- **[medium]** Some of the spec's code references are wrong. App.jsx:114 does not pass onNavigate: it renders <DashboardBIPage onOpenContract={openContract} />, and the component signature is ({ onOpenContract }) at DashboardBIPage.jsx:182. App.jsx:130 renders <SitesMapPage /> with no props, but MapExplorer's links ('Voir les sites', 'À rapprocher', Paramétrage notes) need onNavigate, and commit 7 does not list App.jsx. 'règle common/period.js:110' does not exist: the file has 71 lines and defaultPeriod is at :44.
  - *Correction* : Correct §7.3.2 to 'add onNavigate={navigate} at App.jsx:114 and accept it in DashboardBIPage'. Add App.jsx to commit 7's files (onNavigate for SitesMapPage). Cite server/src/modules/common/period.js:44 (defaultPeriod).
- **[medium]** The site × month SQL is the core of 6a, but its tricky branches are never exercised. The dev DB has 0 rows in site_month_status, 0 sites with security_situation = 99 and only 13 site-linked submissions. So carry-forward of inactive months, the forbidden-zone rule, off-plan, unassigned and activity-compatibility are invisible in every §2 measurement. mapRepository.test.js uses a fake client, which only checks SQL strings. server/test has no DB-backed test at all.
  - *Correction* : Add an idempotent, marked fixture to seed-test.js covering: a site inactive from March onward; a site with security_situation 99; a site realised by data without a plan (hors plan); a planned visit with provider_id NULL; a form whose activity_category differs from the site's activity; a site with 3 or more GPS-linked submissions. Give bench-map.js a --verify mode that asserts the expected counts per district. Optionally add a pure JS reference fold (siteMonth.js) over the same rows and compare it with the SQL output.
- **[medium]** Two inconsistencies inside one /api/map/districts response. (1) Activity filter: the 'dat' CTE counts forms with NULL activity_category as compatible with every site (same as field.repository.js:111-112), but 'subs' filters on lower(btrim(mf.activity_category)) = $5, which drops them. On dev, 231 of 562 submissions come from NULL-category forms, so with activity = 'School meal activities' a district can show réalisés by data > 0 while Données versées = 0. (2) 'cdat' (communeDataOnly) ignores the office and activity filters. Also, sites.activity mixes full names and codes (SMP, GD, RES, PECMAM, RRP alongside 'School meal activities'), so the activity selector will list both styles.
  - *Correction* : Put one compatibility predicate (form ↔ site activity, NULL = compatible) in siteMonthSql.js and use it in dat, subs and cdat. For a submission without a site, define the rule under an activity filter explicitly: either 'NULL category counts' or 'excluded, with a note'. Apply the office filter to cdat. Note in §13 that the activity vocabulary is normalised in lot 2, and group code aliases in filtersAvailable until then.
- **[medium]** Reads in the points endpoint are only partly bounded, and its performance at scale is unmeasured. Only 'collect' has a LIMIT (2,000 + grid). The 'sites', 'derived' and 'communes' layers return every row. Lot 3 imports registry GPS (1,280 sites today), which would give one SVG circle each, while the render budget was measured with 511 nodes. The derived and commune medians are recomputed over the whole history on every call (percentile_cont plus a second pass for spread), and were measured only on 562 rows (24 ms). The ×8 district benchmark stops at 24 months (250 ms), but the API allows 36 months against a 400 ms budget.
  - *Correction* : Cap the sites layer (for example 3,000 rows) and switch to per-district count bubbles or the 2 km grid beyond that. Render more than about 1,000 points on a <canvas> layer under the SVG. Benchmark derived and commune medians at ×50 GPS submissions in bench-map.js; if over 100 ms, restrict them to the last 24 months or cache them per tenant keyed on max(created_at). Add a 36-month ×8 case to the benchmark.
- **[medium]** The offline goal contradicts the lot's own scope. §10 budgets '0 console errors offline across all routes', but PlanBoardPage.jsx:459-463 keeps Leaflet with OSM tiles always on. It removes the layer only after 4 tileerror events, so a disconnected sweep of the RBM plan-board tab still logs at least 4 failed tile requests. The spec leaves that page out of scope (risk 8), so its own Playwright check will fail.
  - *Correction* : In commit 10, reuse TileUnderlay's single probe on PlanBoardPage: probe one tile with an Image before calling addTo, and never add the layer when the probe fails. Alternatively, explicitly exclude #/processus/rbm (plan tab) from the offline sweep and record that in risk 8.
- **[low]** Some of the design is over-engineered. (1) The geoMatch alias step (Fort-Dauphin→Taolagnaro…) would match nothing: I measured 119 of 120 district names exact and 0 needing normalisation, and the aliases are site free-text names, which are never compared with admin_areas. (2) The shape_set versioning column with its regex CHECK serves a single shape set. (3) submissionGps.js is a second implementation of the SQL rule that is only used in tests, and its 'parity' test compares regex strings, not behaviour (ordering, CASE guards, bounds). (4) The OSM underlay (commit 10) duplicates tile maths for an optional feature.
  - *Correction* : Drop the alias step; the manual map_shape_links correction plus the parent-P-code rule cover the real cases. Keep shape_set only as a fixed default with no API surface until lot 6. Either use submissionGps.extractGps at runtime (for example to mask GPS for viewers, see the privacy finding) or drop it and verify the SQL function through bench-map --verify on the dev DB. Make commit 10 optional, after commit 11.
- **[low]** Tenant and SQL hygiene in the shown SQL. The final SELECT does 'LEFT JOIN admin_areas r ON r.id = d.parent_id' with no tenant predicate, so the spec's own mapRepository test ('tenant_id = $1 sur chaque table') would fail. search() uses lower(name) LIKE lower($2) || '%' without escaping % and _, and without the depth predicate needed to hit idx_admin_areas_name (tenant_id, depth, lower(name) text_pattern_ops).
  - *Correction* : Add AND r.tenant_id = $1. Escape LIKE metacharacters (replace /[\\%_]/g with a backslash prefix, ESCAPE '\'). Query depth IN (2,3) separately, or use depth = ANY, so the index is used. Test both cases in mapRepository.test.js.
- **[low]** Point encoding and the design reference. On a multi-month range, the precedence of a GPS site's status (realised in one month, planned-not-realised in another) is undefined. Ref 7 colours points by '% des visites prévues réalisées' (≥80 / 40–79 / <40 / aucune visite prévue). Points are colour-only, and green vs orange is weak for colour-vision deficiency, against CLAUDE.md's 'Statuts = couleur + icône + libellé'.
  - *Correction* : Define the precedence (realise > hors_plan > prevu > non_prevu > inactif) for a single month. For ranges longer than one month, colour by the site's execution % using ref 7's classes. Add shape coding (filled disk = réalisé, ring = prévu, square = non prévu, hollow = inactif) and repeat it in the legend and the hover card.
- **[low]** 'Prévue' is defined as site_visits.status <> 'annule', so any 'realise' row counts as planned. The dev history has 108 'realise' visits (2022–2024) with no 'planifie' rows, so execution is trivially 100% on those ranges, and a declared visit can never be 'hors plan'. Map 'Alertes' signals (high_risk_untouched, data_unlinked, off_plan) do not exist in the Centre d'alertes, so the two screens will disagree.
  - *Correction* : Document the limitation in §3 and in the hover card ('visites déclarées comptées comme prévues'), and hand a 'planned' flag or motif to lot 4 in siteMonthSql.js. Rename the theme 'Signaux de la carte', or register the same signal kinds in alertsMath once the lot-1 fixes merge (§13 already plans to share the threshold).
- **[low]** Asset and licensing claims. Every export footer would print 'geoBoundaries ADM2 (CC BY 4.0)', but geoBoundaries licences are per boundary set (MDG ADM2 comes from an OCHA COD source, often CC BY-IGO), and the embedded GeoJSON carries no metadata. '88 Ko gzip' assumes compression, but the user runs Vite dev and the Express API has no compression middleware: the asset is about 338 KB raw and points JSON is uncompressed. Commit 1's mapAssets.test checks keys = normKey(name), but normKey arrives with geoMatch.js in commit 2, and the build script and the server each need the same normKey.
  - *Correction* : Read boundaryLicense and boundarySource from the geoBoundaries metadata for MDG ADM2, store them in the asset's properties and print those values. Budget raw sizes too, or add compression to the API. Put normKey in commit 1 (geoBuild.js), import it in server geoMatch.js (or copy it with an equality test), and keep the mapAssets key check passing in commit 1.
- **[low]** A cheap win is left out. admin_areas.lat/lng are empty for all 19,370 rows, so planBoardTx's district-centroid fallback (field.repository.js:745-747, 'districts' CTE) places nothing on the plan-board map. The build script already computes a label point (pole of inaccessibility) for each of the 119 outlines.
  - *Correction* : Have the service, or a one-off admin action, fill depth-2 admin_areas.lat/lng from the outline label points, matched through geoMatch with null-only updates, inside withTenantTransaction. The plan board then places its 1,081 district-attached sites approximately. Flag these positions 'district' and give them their own legend entry.

## Commits prévus

1. **feat(carte): contours des districts allégés à frontières partagées (88 Ko gz) + index des formes, construits par script reproductible** — fichiers : web/scripts/geoBuild.js, web/scripts/build-geo.mjs, web/public/geo/mdg-adm2.v1.json, server/src/modules/map/shapes/mdg-adm2.v1.json, server/test/geoBuild.test.js, server/test/mapAssets.test.js, docs/JOURNAL.md — tests : geoBuild.test.js (import dynamique de web/scripts/geoBuild.js comme webCharts.test.js, skip si web/ absent) : deux carrés partageant une arête + jonction triple → frontière identique chez les deux voisins après simplification ; Douglas-Peucker canonique indépendant du sens de parcours ; pôle d'inaccessibilité à l'intérieur d'un U concave ; arrondi à 4 décimales ; sortie déterministe (octets identiques sur deux exécutions). mapAssets.test.js : 119 contours, clés uniques = normKey(nom), étiquette dans son polygone, bbox dans l'emprise de Madagascar, clés de l'index serveur = clés de l'asset web, gzip ≤ 100 Ko, attribution geoBoundaries présente. npm test + npm run lint ; aucun écran modifié.
2. **feat(carte): migration 061 — position GPS des soumissions en colonnes générées et corrections district ↔ contour ; modules purs submissionGps et geoMatch** — fichiers : server/src/db/migrations/061_map_geo.sql, server/src/modules/map/submissionGps.js, server/src/modules/map/geoMatch.js, server/test/submissionGps.test.js, server/test/geoMatch.test.js, server/test/mapMigration061.test.js, docs/JOURNAL.md — tests : submissionGps.test.js : paire de base préférée à la variante suffixée (_ca6b) ; nombres en chaîne acceptés ; précision lue (_precision) ; geopoint « -21.1794143 48.2943889 46.2 4.98 » ; réponses à choix multiples « 1 2 » et « 3 9 10 11 » refusées (faux positifs mesurés) ; (0,0) et hors plage refusés ; _geolocation ; usable() ≤ 100 m. geoMatch.test.js : exact, normalisé (accents, apostrophes, tirets), alias marqué « à confirmer », contour parent MG52516a → MG52516 partagé, manuel prioritaire, manuel null = masqué, conflit listé et jamais écarté, cas de la base de dev 120/120. mapMigration061.test.js (lecture du fichier SQL, comme pddMigration057.test.js) : motifs de clé et de geopoint identiques aux constantes JS, CASE autour de chaque conversion, ORDER BY … COLLATE "C", RLS ENABLE + FORCE + policy + GRANT mems2_app + mems_install_same_tenant('map_shape_links'), aucun « mems_app ». Vérification base de dev après npm run migrate : count(gps_lat) = 324, gps_accuracy_m ≤ 100 = 315, ré-exécution de la migration sans erreur.
3. **feat(carte): GET /api/map/districts — tous les thèmes par district sur une période (une requête SQL, définitions communes)** — fichiers : server/src/modules/common/siteMonthSql.js, server/src/modules/map/mapThemes.js, server/src/modules/map/map.repository.js, server/src/modules/map/map.service.js, server/src/modules/map/map.controller.js, server/src/modules/map/map.routes.js, server/src/app.js, web/src/api/client.js, server/scripts/bench-map.js, server/test/mapThemes.test.js, server/test/mapRepository.test.js, server/test/mapRoutes.test.js … — tests : mapThemes.test.js : couverture 0 % ≠ « aucun site actif » ; planification et exécution → reason 'aucun_plan' (jamais 0 %) ; contour partagé = somme des comptes puis taux recalculé (jamais une moyenne de taux) ; signaux et seuils (exécution < 0,5 comme alertsMath.js:103, high_risk_untouched, no_plan, data_unlinked, off_plan, visits_unassigned) ; totaux. mapRepository.test.js (faux client, modèle pddRepository.test.js) : SET LOCAL jit = off en premier ordre, $1 = tenant et tenant_id = $1 sur chaque table, requêtes séquentielles (pas de Promise.all), sous-arbre de bureaux récursif, « réalisée » sans repli commune. mapRoutes.test.js (supertest + dépôt espion, modèle monitoringIndicatorRoute.test.js) : 400 sur mois invalide, from > to, plage > 36 mois, office non uuid, période absente ; 200 avec la forme documentée ; tenant tiré du jeton. Vérification base de dev : sept. 2026 → 17 contours, 17/1 280 réalisés (1,3 %), 13 « aucun plan » ; bench-map p95 ≤ 150 ms.
4. **feat(carte): GET /api/map/points et /api/map/search — sites GPS, positions déduites des collectes, centres de commune, points de collecte (carroyage hors admin/manager)** — fichiers : server/src/modules/map/geoStats.js, server/src/modules/map/map.repository.js, server/src/modules/map/map.service.js, server/src/modules/map/map.controller.js, server/src/modules/map/map.routes.js, web/src/api/client.js, server/test/geoStats.test.js, server/test/mapRepository.test.js, server/test/mapRoutes.test.js, docs/JOURNAL.md — tests : geoStats.test.js : fiable / indicative / dispersée aux bornes (n = 3, 2 km, 5 km) ; distanceKm vs haversine < 0,5 % sous 20 km. mapRepository.test.js : LIMIT limit+1 → bascule en carroyage, précision maximale passée en paramètre, positions déduites sur tout l'historique, points de collecte bornés à la période, tenant $1 partout. mapRoutes.test.js : viewer → carroyage même avec limit, admin/manager → points précis ; limit > 5000 → 400 ; q < 2 car. → 400. Vérification base de dev : 26 sites GPS, 1 site placé par ses collectes, 43 centres de commune (186 sites sans GPS), 0 point en sept. 2026 avec lastMonth = 2026-07, 286 points en janv.–oct. 2026, 9 points écartés (précision > 100 m).
5. **feat(carte): composant partagé MapExplorer (choroplèthe, thèmes, légende graduée, fiche au survol, classement, recherche) — Couverture & performance › Carte** — fichiers : web/src/lib/mapScale.js, web/src/lib/mapProjection.js, web/src/lib/mapLabels.js, web/src/components/map/DistrictMap.jsx, web/src/components/map/MapPanel.jsx, web/src/components/map/MapLayers.jsx, web/src/components/map/MapLegend.jsx, web/src/components/map/MapHoverCard.jsx, web/src/components/map/MapExplorer.jsx, web/src/components/map/useMapData.js, web/src/styles.css, web/src/locales/en/map.js … — tests : webMap.test.js (libs web pures importées dynamiquement) : seuils % fixes 0 · >0 · 25 · 50 · 75 et comptes en série 1-2-5 dédoublonnés, classOf, formatRate (« 0 % », « 1,3 % », « 44 % »), encre des pastilles selon la classe (clair et sombre), rampes = valeurs validées, fitTransform (bbox → fenêtre), barre d'échelle à la latitude du centre, layoutLabels sans chevauchement et priorité aux grandes aires. cd web && npm run build. Balayage Playwright #/dashboard/couverture vue Carte en FR et EN, 1 440 et 390 px, clair et sombre : 0 erreur console, __memsMissingTr vide, performance.measure mapx:painted ≤ 300 ms à CPU ×4 ; MapView, madagascarMap et l'appel fieldMap ne sont plus utilisés par cette page.
6. **feat(dashboard): section « Carte du suivi » dans Dashboard décisionnel › Vue d'ensemble (filtres période, bureau, activité)** — fichiers : web/src/pages/dashboard/DashboardBIPage.jsx, web/src/App.jsx, web/src/pages/dashboard/DashboardCoveragePage.jsx, web/src/locales/en/map.js, docs/JOURNAL.md — tests : cd web && npm run build. Balayage Playwright #/dashboard/apercu : carte compacte rendue sous les tuiles KPI avec bandeau de période par défaut ; changement de bureau / activité recharge la carte ; « Ouvrir la carte » ouvre Couverture & performance › Carte avec le même thème, la même période et les mêmes filtres (sessionStorage mems.map.open) ; l'ancienne carte « Couverture terrain — mois courant » a disparu ; 0 erreur console FR/EN, 1 440 et 390 px.
7. **feat(carte): Carte des sites sur le composant partagé + registre géographique par district ; retrait de /api/tpm/field/map (1 294 sites, 32 « districts »)** — fichiers : web/src/pages/monitoring/SitesMapPage.jsx, web/src/api/client.js, server/src/modules/tpm/field.repository.js, server/src/modules/tpm/field.routes.js, web/src/lib/madagascarMap.js, web/src/lib/geo.js, web/public/mdg-adm2.geojson, web/geo-src/mdg-adm2.geoboundaries.geojson, web/scripts/build-geo.mjs, web/src/locales/en/map.js, docs/JOURNAL.md — tests : npm test + npm run lint (plus aucune référence à mapData / fieldMap / madagascarMap / lib/geo.js : grep) ; npm run build ; build-geo relancé depuis web/geo-src produit des fichiers identiques. Balayage Playwright #/processus/carte réseau externe coupé : 0 requête de tuile, 0 erreur console (30 aujourd'hui) ; registre géographique : somme des sites = 1 280 (et non 1 294), 18 districts + 3 régions seulement + 2 sans localité ; PlanBoardPage (Leaflet) inchangé.
8. **feat(carte): export image PNG et impression A4 paysage (titre, légende, nord, échelle, carte de situation, pied de page)** — fichiers : web/src/lib/mapExport.js, web/src/components/map/MapExplorer.jsx, web/src/styles.css, web/src/locales/en/map.js, server/test/webMap.test.js, docs/JOURNAL.md — tests : webMap.test.js / buildExportSvg : titre, période, filtres, légende graduée, flèche du nord, échelle, carte de situation et pied (source, date, « MEMS 2.0 · Suivi & évaluation », aucun « WFP ») présents ; aucune URL http(s) (pas de tuile) ; noms échappés (« <script> » neutralisé) ; points de collecte en carroyage. Playwright : téléchargement d'un PNG non vide de 3 200 × 2 200 px ; aperçu d'impression sans le chrome de l'application, A4 paysage.
9. **feat(localités): onglet « Contours de la carte » — correspondance district ↔ contour corrigeable** — fichiers : server/src/modules/map/map.repository.js, server/src/modules/map/map.service.js, server/src/modules/map/map.controller.js, server/src/modules/map/map.routes.js, web/src/pages/settings/MapShapesTab.jsx, web/src/pages/settings/LocalitiesSection.jsx, web/src/api/client.js, web/src/locales/en/localities.js, server/test/mapRoutes.test.js, server/test/mapRepository.test.js, docs/JOURNAL.md — tests : mapRoutes.test.js : PUT/DELETE réservés à admin (403 manager et viewer), 404 P-code hors du découpage du compte, 400 contour inconnu de l'index, shapeKey null = « ne pas dessiner », DELETE = retour à l'automatique. mapRepository.test.js : upsert ON CONFLICT (tenant_id, shape_set, area_pcode), tenant $1, updated_by renseigné. Vérification : Antanimora Sud affiché « contour parent » ; une correction manuelle est visible aussitôt sur la carte et dans la fiche au survol ; balayage #/parametrage localités FR/EN sans erreur.
10. **feat(carte): fond OpenStreetMap optionnel (en ligne), éteint par défaut et coupé automatiquement hors connexion** — fichiers : web/src/components/map/TileUnderlay.jsx, web/src/components/map/DistrictMap.jsx, web/src/components/map/MapLayers.jsx, web/src/lib/mapProjection.js, web/.env.example, web/src/locales/en/map.js, server/test/webMap.test.js, docs/JOURNAL.md — tests : webMap.test.js / tilesFor(vue) : tuiles XYZ couvrant exactement l'emprise, zoom borné, aucune tuile quand l'URL est vide. Playwright réseau coupé : case activée → message « Fond en ligne indisponible… », couche coupée, au plus une requête sonde, aucune erreur console répétée ; en ligne (si disponible) : capture montrant les tuiles alignées sur les contours ; export toujours sans tuile.
11. **docs: lot 6a — CLAUDE.md (Carte du suivi), ETAT_DU_PROJET, RETOURS_UTILISATEUR (17, 27, 49, 50 ; 41 et 44 partiels)** — fichiers : CLAUDE.md, docs/ETAT_DU_PROJET.md, docs/RETOURS_UTILISATEUR.md, docs/JOURNAL.md — tests : Relecture : chemins, routes et numéros de migration cités existent ; aucune mention « WFP » ; état des retours cohérent avec le journal.

## Mesures (base de démonstration)

Base de dev (tenant de démo, 13/10/2026, lecture seule). Registre : 1 280 sites, 26 GPS, 1 081 rattachés à un district par admin_areas.lineage, 197 à la région seulement, 2 sans localité ; 18 districts portent des sites. Contours : 119 polygones geoBoundaries vs 120 districts admin_areas → 119/120 par nom exact (même score après normalisation), Antanimora Sud (MG52516a, 58 sites) sans contour → règle P-code parent → 120/120 ; 315/317 points GPS tombent dans le contour de leur district déclaré (99,4 %). Soumissions : 562 (529 non écartées en janv.–oct. 2026), 13 rattachées à un site, 513 avec P-code de commune ; 324 avec GPS (clés @_HHCoord_*, + variantes suffixées _ca6b 102 et _4a58 53 dans les mêmes soumissions ≈ 480 occurrences), 315 de précision ≤ 100 m, 9 écartées, GPS jusqu'en juillet 2026 seulement ; la règle SQL de la migration retrouve exactement ces 324 (clé sans suffixe 324/324) ; un motif geopoint laxiste ajoutait 7 faux positifs (réponses à choix multiples « 1 2 »). Positions : 1 site placé par ses propres collectes (2 sites ont des collectes GPS rattachées, 1 déjà GPS), 43 centres de collectes de commune couvrant 186 sites sans GPS (dispersion médiane ≤ 2 km : 16 communes, 2–5 km : 13, > 5 km : 14). Coloré par la nouvelle requête : sept. 2026 (période par défaut) → 17 contours pour les thèmes du registre et la couverture (17/1 280 = 1,3 %, dont 1 par les données), 4 contours avec plan et 13 « — aucun plan », 9 contours de données versées (64/77 soumissions localisées), 16 contours avec alerte dont 13 critiques, 0 point de collecte ; janv.–oct. 2026 → 21/1 280 réalisés, exécution 32/44 visites (73 %), 14 contours de données versées (491/529), 286 points de collecte ; règle ancienne « même commune » : 457 sites contre 3 par données rattachées au site. Écran actuel : 1 294 sites affichés pour 1 280 (double comptage par jointure) et 32 « districts » textuels ; Carte des sites hors ligne = 60 requêtes de tuiles en échec, 30 erreurs console. Performance : requête districts 16 ms (1 mois), 25 ms (10 mois), 40 ms (24 mois), 18 ms avec filtre bureau, 14 ms avec filtre activité ; synthétique ×8 (10 240 sites) 2,4–2,6 s avec JIT contre 164 ms (12 mois) / 250 ms (24 mois) sans JIT ; première écriture (sous-requête corrélée) 2,4–4,7 s corrigée par intervalles lead() + CTE MATERIALIZED ; extraction GPS en ligne 260 ms / 562 lignes (→ colonnes générées) ; positions et centres 24 ms ; endpoints existants : field/map 16 ms, coverage-dashboard 587 ms. Géométrie : 1 054 858 o (275 Ko gz) → 338 Ko (88 Ko gz) à 0,005° avec frontières partagées (0 sommet partagé rompu, 119 étiquettes dans leur polygone) ; arcs de frontières séparés +45 Ko gz (écartés). Prototype (scratchpad/design/6a/proto2.html) : analyse + rendu 65 ms (CPU ×1), 270 ms (CPU ×4), 511 nœuds SVG, 0 erreur. Rampes validées par le validateur dataviz (--ordinal) : bleu clair 2,06:1, orange clair 2,09:1, bleu sombre 2,44:1, orange sombre 2,69:1 ; palette de statut en aplat refusée (toutes-paires : normal 13,6, CVD 4,1).
