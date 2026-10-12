# Liaisons entre les pages et rapprochement automatique des lieux (MEMS 2.0)

Ce rapport décrit l'état du dépôt au commit `473d7fa` du 12/10/2026. Je n'ai modifié aucun fichier. Les 197 tests serveur passent (`cd server && npm test`). CLAUDE.md en annonce 64, ce chiffre n'est plus à jour.

## À retenir (pour le responsable S&E)

1. **Un même paramètre est souvent réglé sur une autre page que celle qui l'utilise.** Seuls 8 écrans sur 23 peuvent ouvrir directement une autre page (ils reçoivent `onNavigate`, App.jsx:94-122). Partout ailleurs, les messages du type « configurez dans Paramétrage › … » sont du texte sans lien.
2. **Les noms de lieux importés ne sont rapprochés du référentiel Paramétrage › Localités par aucun import.** Chaque import garde les noms tels qu'ils sont écrits dans le fichier. Le seul code qui compare des noms au référentiel sert à placer sur la carte du Plan de suivi un site sans GPS (field.repository.js:683-709).
3. **Exemple sur les données de démonstration.** Le Plan de suivi (1 275 sites) contient la région « Atsimo-Andrefana » (163 sites) et la région « Atsimo Andrefana » (292 sites). L'outil les traite comme deux régions différentes. Sur 24 districts, 12 correspondent exactement au référentiel, 8 de plus correspondraient après une simple normalisation, et 4 resteraient à valider à la main (Amboasary, Betioky, Manja, Toliara I).
4. **Le lien entre les données collectées (Kobo) et les sites passe par le code de commune (pcode).** Seul l'import Master Data du RBM renseigne ce code. Un site créé par un autre moyen n'est donc jamais relié aux données collectées, et le RBM le déclare « à suivre » à tort.
5. **Défaut vérifié par exécution.** Un export Kobo qui contient à la fois les colonnes `admin3name` et `admin3` range le nom de commune là où le code est attendu. Aucune liaison n'est alors possible. Les colonnes accentuées « Niveau régional » et « Énumérateur » sont ignorées, alors que l'écran Mapping les affiche comme reconnues.
6. **Réimporter le découpage administratif détache toutes les zones des contrats.** Ensuite, enregistrer ou faire valider un avenant échoue.
7. **Plusieurs chiffres affichés aujourd'hui sont faux ou vides.** Le détail est en partie 3, repéré par les marqueurs [FAUX], [VIDE], [BLOQUANT] et [PERTE].
8. **Ce que je propose :**
   - un moteur unique de rapprochement des lieux (module pur, testé) ;
   - une file « À rapprocher » à valider dans Paramétrage › Localités, avec des alias qui s'enrichissent à chaque validation ;
   - une correction appliquée aussi aux données déjà importées ;
   - sur chaque page, un encart « Liaisons » avec des liens cliquables vers l'écran de configuration.

## 0. Contradictions entre les cartes, tranchées dans le code

| Point | Verdict |
|---|---|
| Une fiche de suivi peut-elle être rattachée à une activité du MMR ? | **Oui, depuis le commit 473d7fa** : monitoring.routes.js:53-64, ProcessMonitoringPage.jsx:172-183, avertissement :127-129. La carte « suivi-processus » est périmée sur ce point. Le contrôle serveur ne retire ni les accents ni les espaces internes en SQL (routes :60 ; monitoring.repository.js:740-742). Il n'y a pas de lien vers Paramétrage › MMR. |
| `canonicalActivity` retire-t-il les accents ? | **Non.** Elle utilise `planBoard.norm` (planBoard.js:16 : trim, minuscules, espaces). Seuls locationsXlsx.js:133, mmrXlsx.js:100 et postesXlsx.js:22 retirent les accents. |
| À quels niveaux correspondent admin1 à admin4 des soumissions ? | memsMapping.js:20-22 libelle admin2 « Province », admin3 « District » (alias `district`) et admin4 « Commune ». Les données réelles (fixtures/monitoringData.json) contiennent admin1 = `MG51` (région), admin2 = `MG51507` (district), admin3 = `MG51507090` (commune). **Ce sont les libellés et les alias qui sont faux**, pas les données. |
| « localities.domain.js:315-339 » | Ce fichier ne fait que 63 lignes. La logique est dans `planBreakdown`, localities.domain.js:15-41. |
| Clé primaire du périmètre des bureaux | 024_field_offices.sql:27 `PRIMARY KEY (office_id, commune)`. Le commentaire l.20-21 promet que le district lève l'ambiguïté des homonymes ; aucun code ne l'utilise. |
| Migration des Localités | 041_localities.sql. La migration 031 ajoute seulement les colonnes adm1 à adm4 aux sites. |
| « Aucun libellé d'antenne du PDD ne correspond à un bureau » | Vrai en comparaison exacte. Mais le résolveur existant `officeResolver` (mmrXlsx.js:136-147) reconnaît 6 des 7 libellés de la démo, soit 467 lignes sur 491. Seul « Taolaganaro » (24 lignes) échoue (vérifié par exécution). |
| Numéros de ligne de monitoring.repository.js | Ils sont décalés d'environ 27 lignes depuis 473d7fa. Positions actuelles : sitesActive 740-742, sitesVisited 757-760, régions 658-669 et 783-789, communeName 228 et 817. |

---

## 1. Carte des liaisons

« Lien » indique si la page peut aujourd'hui ouvrir directement l'écran de configuration.

### 1.1 Contrats

| Page | Utilise, et où cela se configure | Alimente | Lien |
|---|---|---|---|
| Liste des contrats | Partenaires (Paramétrage › Partenaires). Montant consommé = factures **validées** (Rapports & dépenses), contracts.repository.js:146-154 | Centre d'alertes : échéances et avenants | Non (App.jsx:100) |
| Formulaire contrat / avenant | Partenaires : la liste montre aussi les inactifs, que le serveur refuse ensuite. Activités actives (Paramétrage › Activités). Zones par identifiant (Paramétrage › Localités). Valideurs (Utilisateurs & accès). Catalogue FLA figé (budgetCatalog.js) | Budget de la ligne IV.suivi → Rapports, Planification, Consolidation, Dashboard, Reporting, Alertes, Concepteur. Les zones n'alimentent aucun autre module | Non : texte seul (ContractFormPage.jsx:163,180,192 ; AreasSelector.jsx:56) |
| Fiche contrat | Jauge = factures validées. Onglet Prévision = factures soumises **et** validées (contracts.repository.js:169) | — | Non : l'icône de lien n'est pas cliquable (ContractDetailPage.jsx:154) |

### 1.2 Partenaires & TPM

| Page | Utilise, et où cela se configure | Alimente | Lien |
|---|---|---|---|
| Prestataires TPM | Partenaires dont le type a le code exact `tpm` (Paramétrage › Types de partenaire + Partenaires) | Affectation & visites, Formations, Évaluation, Planification, Rapports | **Oui** (le seul exemple) |
| Formations / Évaluation | Prestataires et agents. L'Évaluation lit l'ancien modèle `tpm_assignments`, retiré du menu | — | Non |
| Planification & budget | Contrats actifs avec un poste IV.suivi (Contrats), prestataires TPM, taux de change, jours de collecte (Affectation & visites) | Colonne Planifié de la Consolidation ; pré-remplissage des factures | Partiel : onNavigate reçu, mais les messages sur les taux sont du texte (PlanningPage.jsx:290) |
| Rapports & dépenses | Comme Planification, plus les plans de collecte | Colonne Réalisé : Consolidation, Dashboard, Reporting, Alertes, fiche contrat | Partiel : le fil guidé a des liens, pas le tiroir de facture |

### 1.3 Suivi de processus

| Page | Utilise, et où cela se configure | Alimente | Lien |
|---|---|---|---|
| Tableau de bord | Visites, RBM, soumissions, indicateurs | — | Oui (vers Affectation & visites) |
| Données & indicateurs | Activité MMR de la fiche (Paramètres MMR). Bureaux et Localités sont déclarés dans l'onglet Mapping mais jamais consultés | Dernière collecte des sites (RBM, Plan, Visites) via le pcode de commune ; Concepteur ; dashboards | Non (App.jsx:113) |
| Affectation & visites | Registre de sites, prestataires TPM, génération RBM, soumissions (onglet Données réelles) | Couverture → BI, Reporting, Alertes, Concepteur. Jours de collecte → Planification | Non |
| Plan de suivi | Paramètres MMR (visites exigées, dérogations par bureau), Bureaux, Localités (« Ajouter un site » en cascade, position sur la carte), soumissions | Registre de sites partagé ; visites planifiées | Non |
| Risk-Based Monitoring | Risque et critères des sites. Fréquence **codée en dur** (rbmMath.js:11), pas le MMR. Soumissions via le pcode | « À suivre », génération des visites, dashboards | Non |
| Couverture / Carte | Visites réalisées ; fréquence codée en dur. Carte : contours de Madagascar figés, profil pays non lu | — | Non |

### 1.4 Distribution d'urgence, Dashboard, Reporting, Alertes

| Page | Utilise, et où cela se configure | Alimente | Lien |
|---|---|---|---|
| PDD (Distributions, Synthèse, Pipeline) | Aucun référentiel : zones, antennes et partenaires restent en texte. Denrées seedées uniquement. Stock saisi dans le Pipeline | Concepteur (`pdd_by_month`, chiffres clés PDD) | Liens seulement entre vues PDD. La phrase « mêmes référentiels que le reste de MEMS » est **fausse** (PddPage.jsx:221) |
| Dashboard › Vue d'ensemble | Consolidation, visites | — | Non |
| Suivi budgétaire consolidé | Contrats actifs avec IV.suivi ; plans de collecte (**brouillons compris**) ; factures soumises et validées | BI, Reporting, Alertes, Concepteur | Non. L'aide indique la mauvaise source (ConsolidationPage.jsx:230 ; consolidation.repository.js:11) |
| Couverture & performance | RBM, visites ; région des soumissions déduite via les sites | — | Oui |
| Rapport de synthèse | Consolidation **non bornée au mois choisi** (ReportingPage.jsx:34), visites | Exports | Non |
| Concepteur de rapport | Fiches (activité MMR), sites, visites, bureaux (comparés par nom), consolidation, PDD | Documents figés | Non |
| Centre d'alertes | Consolidation, rapports, contrats, visites | Navigation vers les modules | Oui |

### 1.5 Vue inverse : rubrique de Paramétrage → pages qui l'utilisent

| Rubrique | Réellement utilisée par | Ce qui manque |
|---|---|---|
| Partenaires / Types | Contrats ; TPM uniquement via le code `tpm` | Le PDD et les soumissions gardent le partenaire en texte |
| Activités | Contrats, postes des factures et des plans | Aucun lien avec `sites.activity` ni avec les catégories MMR (trois vocabulaires distincts) |
| Taux de change | Planification, Rapports (bascule en USD) | Les dashboards affichent « Ar » en dur |
| Localités | Zones de contrat (par identifiant), cascade « Ajouter un site » (seuls les noms sont envoyés), position de repli sur la carte, liste du périmètre des bureaux | **Aucun import ne s'y rapproche.** Profil pays (devise, centre de carte) sans effet |
| Bureaux & antennes | Rattachement des sites (par nom de commune seul), filtres RBM, Plan et Concepteur, dérogations MMR, import Locations | Soumissions et PDD jamais reliés |
| Paramètres MMR | Plan de suivi, vocabulaire « Activity Tag » des sites, fiches de suivi | RBM, Couverture et Générer ne le lisent pas |
| Utilisateurs & accès | Valideurs des contrats, droits d'écriture | La validation des factures n'est pas protégée (voir H12) |

### 1.6 Données saisies depuis plusieurs écrans : la cause de « un paramètre configuré depuis une autre page »

| Objet | Écrans qui l'écrivent | Règles appliquées |
|---|---|---|
| Registre des sites | Nouveau site (modale de visite), Ajouter un site (Plan de suivi), modification groupée (Plan), critères et risque (RBM), imports Master Data, Plan, Locations et Planning | 4 identités de site (code du fichier, slug, L###, refus d'un doublon) ; pcode posé par un seul de ces chemins |
| Bureau d'un site | Périmètre (Paramétrage), modification groupée, Sub Office de l'import Locations, périmètre à l'import Plan | Un import peut écraser ou effacer un bureau choisi à la main |
| Activité d'un site | MMR canonique (Ajouter un site, modification groupée), texte brut (imports), saisie libre (visite) | 4 normalisations différentes |
| Rattachement fiche ↔ activité | Données & indicateurs (depuis 473d7fa) | Valeurs proposées tirées du MMR, sans lien vers celui-ci |

---

## 2. Rapprochement des lieux

### 2.1 État actuel, point d'entrée par point d'entrée

| Point d'entrée | Méthode actuelle | Valeurs non reconnues | Conséquence |
|---|---|---|---|
| Import du découpage (localities.repository.js:87-145) | Suppression puis réinsertion complète (DELETE l.90). Nœuds dédoublonnés sur le chemin de noms exact, sensible à la casse et aux accents (localities.domain.js:21-31) | Homonymes d'un même parent fusionnés, second P-code perdu sans avertissement | Tous les identifiants changent : `contract_areas.admin_area_id` passe à NULL (008:40) |
| Renommage d'une localité (updateArea, 246-280) | Met à jour le chemin et la lignée des descendants | Les sites, périmètres et `contract_areas.path` gardent l'ancien nom (aide LocalitiesSection.jsx:444) | Compteurs à 0, doublons dans le catalogue des communes |
| Périmètre d'un bureau (writePerimeter, settings.repository.js:333-349) | Communes cochées par nom (SettingsPage.jsx:25, :344) ; `ON CONFLICT (office_id, commune) DO NOTHING` (l.345) | Seconde commune homonyme perdue | District stocké mais jamais utilisé |
| Rattachement site → bureau (5 copies : field.repository.js:42-45, 165-169, 198-207, 302-305 ; settings.repository.js:357-368) | `lower(btrim(commune))` exact, sans district ni accents ni tirets | Site sans bureau (« (non rattaché) ») | Mauvais bureau pour les homonymes. Les 4 résolveurs d'import ignorent `o.active`, contrairement à attachUnassignedSites (l.362) |
| Import Master Data (field.routes.js:195-222 → field.repository.js:156-188) | Colonnes lues **par position** (1 à 8). Pcodes stockés sans vérification. Identité = code du fichier, sinon slug | Tout est accepté ; réponse `{total, inserted}` seulement | Seul chemin qui pose `adm3_pcode` (l.171-182). Une requête par ligne |
| Import Plan de suivi (field.repository.js:196-270) | Identité par slug, l'« ID Sites » du fichier est ignoré. Bureau par commune. Activité brute | Commune inconnue : aucun bureau, sans avertissement | Écrase un bureau existant (l.236) ; aucun pcode posé |
| Import Locations (field.repository.js:838-900 ; locationsXlsx.js) | L###, puis slug. Bureau via `officeResolver`. Activité normalisée contre le MMR. Aperçu avant écriture | Sub Office inconnu : ligne rejetée. Sub Office vide : simple avertissement | Une mise à jour remplace toutes les colonnes : Sub Office vide met le bureau à NULL (SITE_UPD_COLS l.800-803). Aucun pcode posé |
| Import Planning (field.routes.js:319-351 → field.repository.js:297-320, 617+) | Par position ; slug | Toute variante d'écriture crée un nouveau site, sans retour | Fokontany écrasé par une valeur vide (l.310) |
| Nouveau site, modale de visite (createSite, 40-58) | Slug ; fusion silencieuse avec un site existant (ON CONFLICT … DO UPDATE) | Accepté | Activité saisie librement (FieldVisitsPage.jsx:480) |
| Ajouter un site, Plan de suivi (addSite, 1010-1034) | Cascade Localités, mais **seuls les noms sont envoyés** (PlanBoardPage.jsx:646-650) alors que `listAdminAreas` renvoie le pcode (localities.repository.js:29) | Saisie libre si le découpage est vide | Ni pcode ni bureau déduit du périmètre |
| Import des soumissions (CSV, XLSX, SAV, Kobo, liens) (submissionsImport.js:17-25, 37-61) | Alias de colonnes. `byNorm.has(a)` sans normaliser l'alias (l.22) ; nom pris avant code ; « district » rangé dans admin3 | Valeurs stockées brutes, aucun compteur | admin1 et agent à NULL, admin3 = nom au lieu du code (vérifié par exécution) |
| Lecture données → site (field.repository.js:125-132, 322-329) | `ms.admin3 = s.adm3_pcode` exact | « — » ou « non rattachée » | Soumissions **exclues** comptées ; toutes les fiches comptées, quelle que soit l'activité |
| Région et commune des soumissions (monitoring.repository.js:228, 658-669, 783-789, 817) | Via `sites.adm3_pcode`, **jamais via admin_areas** | Pcode brut (« MG51 ») ou « (non renseigné) » | Une même région apparaît sous plusieurs libellés |
| Bureau des soumissions (monitoring.repository.js:548 ; reportData.js:114-143) | Texte brut (« 7 », « 6 » dans la fixture réelle) | Chaque variante devient un « bureau » | Filtre bureau du Concepteur vide, sections par bureau en double |
| Import PDD (pddImport.js:52-66 → pdd.repository.js:102-140) | `trim` seul ; région, district, commune, antenne, partenaire en texte | Tout est accepté | 22 communes sur 70 (132 lignes sur 491) connues du registre de sites, même après normalisation ; « Atsimo Antsinanana » (87 lignes) au lieu d'« Atsimo Atsinanana » |
| Zones d'un contrat (contracts.service.js:65-70) | Par identifiant exact, sans saisie libre : **le seul point d'entrée sain** | 400 « zone inconnue » | Fragile à chaque réimport du découpage |
| Portée MMR (mmrXlsx.js:136-147, 172-176) | Accents retirés, égalité exacte, puis nom « cœur » du bureau | Ligne rejetée | Les bureaux inactifs sont acceptés (officeRefs, settings.repository.js:287-291) |

On compte au moins 9 fonctions de normalisation côté serveur, avec 4 comportements différents : memsMapping, submissionsImport, field.repository (slug), planBoard, mmrXlsx, postesXlsx, locationsXlsx, activityRefs et budgetImport.

**Prérequis côté données.** Le découpage de démonstration n'a que 2 niveaux et aucun P-code (seed.js:48-56). Il contient déjà des doublons de graphie : « Amboasary Sud » et « Amboasary-Atsimo », « Toliara II » et « Toliary-II ». seed-test.js:373-386 attribue des pcodes arbitraires pour que la démo relie les données. Le rapprochement par code ne fonctionnera qu'après import du découpage officiel avec P-codes dans Localités. Sans lui, seul le rapprochement par nom est possible, et les soumissions, qui sont codées, ne recevront pas de nom.

### 2.2 Conception d'un mécanisme unique et partagé

**Principes**
- Résoudre une seule fois, au moment de l'écriture, puis faire les jointures sur le code à la lecture.
- Toujours conserver la valeur brute.
- Ne jamais rejeter une ligne parce qu'un lieu est inconnu : la signaler et la mettre en file.
- Ne jamais appliquer automatiquement une correspondance approximative.

**Module pur** `server/src/modules/common/placeMatch.js`, sans accès à la base, testé. Il remplace les copies existantes ; `officeResolver` y est déplacé et mmrXlsx.js le réexporte.

```js
normPlace(label, { synonyms }) -> { key, guards }   // guards = jetons discriminants (nombres, points cardinaux)
looksLikePcode(s) -> boolean                         // /^[A-Z]{2,3}\d{1,12}$/ après trim/upper
buildPlaceIndex({ areas, aliases, synonyms }) -> index
resolvePlace(index, { depth, label, pcode, parent }) -> { status, area, candidates[] }
resolvePath(index, { adm1, adm2, adm3, adm4, pcodes }) -> { levels[], finest, pcodes, status }
resolveOffice(officeIndex, { label, commune }) -> { status, office }
groupUnmatched(results) -> [{ kind, depth, parentKey, parentLabel, rawKey, rawLabel, count, candidates }]
```

**Règles de normalisation**, appliquées dans cet ordre et de façon identique des deux côtés de la comparaison :
1. Décomposition NFD et suppression des accents, minuscules.
2. Apostrophes, tirets, soulignés, points et barres obliques remplacés par une espace ; espaces multiples fusionnées ; trim.
3. Préfixes retirés en tête, seulement s'il reste quelque chose ensuite : « commune urbaine de », « commune rurale de », « commune de », « commune », « cu », « cr », « district de », « district », « région », « region », « fokontany », « fkt », « ville de ».
4. Chiffres romains isolés I à X remplacés par des chiffres arabes (« Toliara II » devient « toliara 2 »).
5. Synonymes de mots, réglables par pays et préréglés quand `country_profiles.iso3 = 'MDG'` : sud = atsimo, nord = avaratra, ouest = andrefana, est = atsinanana.
6. Jetons discriminants : les nombres et les points cardinaux doivent être identiques pour qu'une proposition approximative soit faite.

| Valeur brute | Résultat |
|---|---|
| « Atsimo-Andrefana » / « Atsimo Andrefana » | Même clé `atsimo andrefana` : rapprochement automatique |
| « Betioky Sud » / « Betioky Atsimo » | Même clé grâce aux synonymes |
| « CR d'Ampanihy Ouest » | `ampanihy andrefana` |
| « Toliary-II » face à « Toliara II » | Proposition approximative à valider (une lettre d'écart) |
| « Toliara I » face à « Toliara II » | **Jamais proposé** : le numéral diffère |
| « Atsimo Antsinanana » face à « Atsimo Atsinanana » | Proposition approximative à valider |
| « Fort Dauphin » face à « Taolagnaro » | Aucune règle ne suffit : il faut un alias |
| « MG51507090 » | Reconnu comme un pcode, résolution directe |

**Ordre de résolution**, appliqué du niveau le plus haut au plus bas (région, puis district, puis commune, puis fokontany), chaque niveau étant cherché dans le parent déjà résolu :

| Étape | Règle | Statut obtenu | Appliqué automatiquement ? |
|---|---|---|---|
| 1 | Pcode exact (colonne pcode, ou valeur qui en a la forme) | `code` | Oui |
| 2 | Nom normalisé identique dans le parent | `normalise` (ou `exact` si la graphie est identique) | Oui |
| 3 | Alias appris, d'abord dans le parent, puis sur tout le niveau | `alias` | Oui |
| 4 | Parent inconnu, mais nom normalisé **unique** sur tout le niveau | `unique_niveau` | Oui, avec un drapeau |
| 5 | Similarité Jaro-Winkler ≥ 0,90 dans le parent, avec jetons discriminants identiques ; jusqu'à 3 candidats | `a_valider` | **Non** : va dans la file |
| 6 | Plusieurs candidats aux étapes 2 à 4 | `ambigu` | Non : va dans la file |
| 7 | Aucun candidat | `introuvable` | Non : va dans la file (créer la localité, ou ignorer) |

**Bureaux.** Ordre : code exact, nom normalisé, alias, nom « cœur » du bureau (`officeResolver`), puis commune résolue (pcode) cherchée dans le périmètre, du bureau le plus spécifique au plus général, **bureaux actifs uniquement**. Si plusieurs bureaux sont candidats, la valeur part dans la file. Les partenaires suivent la même logique (nom normalisé, puis alias).

**Migration 048 `048_location_matching.sql`** (RLS et `GRANT … TO mems2_app` comme ailleurs).

```sql
CREATE TABLE location_aliases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('zone','bureau','partenaire','mot')),
  depth int CHECK (depth IS NULL OR depth BETWEEN 1 AND 6),
  parent_key text NOT NULL DEFAULT '',          -- pcode du parent, sinon sa clé normalisée ; '' = tout le niveau
  alias_key text NOT NULL CHECK (length(alias_key) BETWEEN 1 AND 200),
  alias_label text NOT NULL,                    -- graphie d'origine
  target_pcode text, target_path text, target_id uuid,  -- zone : pcode (stable) sinon chemin ; bureau/partenaire : id
  source text NOT NULL CHECK (source IN ('valide','renommage','xlsform','preset')),
  created_by uuid REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (target_pcode IS NOT NULL OR target_path IS NOT NULL OR target_id IS NOT NULL));
CREATE UNIQUE INDEX uq_location_alias ON location_aliases (tenant_id, kind, COALESCE(depth,0), parent_key, alias_key);

CREATE TABLE location_match_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  kind text NOT NULL, depth int, parent_key text NOT NULL DEFAULT '', parent_label text,
  raw_key text NOT NULL, raw_label text NOT NULL,
  occurrences jsonb NOT NULL DEFAULT '{}',      -- {"sites":12,"soumissions":340,"pdd":5}
  candidates jsonb NOT NULL DEFAULT '[]',       -- [{pcode,path,score}]
  status text NOT NULL DEFAULT 'a_valider' CHECK (status IN ('a_valider','ambigu','introuvable','ignore','resolu')),
  alias_id uuid REFERENCES location_aliases(id) ON DELETE SET NULL,
  last_seen_at timestamptz NOT NULL DEFAULT now(), decided_by uuid REFERENCES users(id), decided_at timestamptz);
CREATE UNIQUE INDEX uq_location_queue ON location_match_queue (tenant_id, kind, COALESCE(depth,0), parent_key, raw_key);

-- Résultats canoniques à côté des valeurs brutes (aucune donnée supprimée)
ALTER TABLE sites ADD COLUMN adm1_pcode text, ADD COLUMN adm4_pcode text, ADD COLUMN geo_status text;
ALTER TABLE monitoring_submissions ADD COLUMN adm3_pcode text, ADD COLUMN field_office_id uuid REFERENCES field_offices(id) ON DELETE SET NULL, ADD COLUMN geo_status text;
ALTER TABLE pdd_distributions ADD COLUMN adm1_pcode text, ADD COLUMN adm2_pcode text, ADD COLUMN adm3_pcode text,
  ADD COLUMN field_office_id uuid REFERENCES field_offices(id) ON DELETE SET NULL,
  ADD COLUMN partner_id uuid REFERENCES partners(id) ON DELETE SET NULL, ADD COLUMN geo_status text;
ALTER TABLE field_office_communes ADD COLUMN adm3_pcode text;
ALTER TABLE contract_areas ADD COLUMN pcode text;
CREATE INDEX ON monitoring_submissions (tenant_id, adm3_pcode);
CREATE INDEX ON pdd_distributions (tenant_id, adm3_pcode);
```

Les colonnes `geo_status` doivent recevoir le CHECK de la liste des statuts. La base n'a pas l'extension `unaccent` (seules pgcrypto et citext sont installées, 001:7-8), et le lanceur de migrations n'accepte que des fichiers `.sql` (migrate.js:33). **La normalisation se fait donc en JS**, et le SQL ne compare plus que des codes ou des identifiants.

**Repository** `server/src/modules/settings/placeMatch.repository.js` (le seul fichier de ce chantier qui écrit du SQL) :
- `loadIndex(client, tenantId)` : une requête sur admin_areas (environ 19 000 lignes au maximum), plus les alias, les bureaux et leurs périmètres.
- `matchAndQueue(client, tenantId, source, tuples)` : résout un lot de lignes, puis met à jour la file en une seule instruction multi-lignes (`ON CONFLICT … DO UPDATE occurrences`).
- `applyToSources(client, tenantId, { sources, ids })` : application aux données déjà importées.
  1. `SELECT raw…, count(*) … GROUP BY raw…` par table source. Le volume reste borné par le nombre de graphies distinctes.
  2. Résolution en JS.
  3. `UPDATE … FROM (VALUES …)` par lots (`chunkRows`, db/batch.js).
  4. Le tout dans la transaction de l'appelant.
- `decide(tenantId, queueId, { action, pcode | areaId | officeId })`. Dans un seul `withTenantTransaction` : création de l'alias, `applyToSources` sur toutes les sources, ligne de file marquée `resolu`. Une ligne est verrouillée par `SELECT … FOR UPDATE` pour éviter une double validation.

**Application aux données déjà importées.** Elle est déclenchée :
- en fin de chaque import, dans la même transaction ;
- après la validation d'un alias ;
- après un réimport ou un renommage dans Localités ;
- par un bouton « Rapprocher maintenant » (admin).

Comme le nombre de graphies distinctes est borné, le traitement reste en ligne. Si une source dépasse un seuil (par exemple 100 000 soumissions à mettre à jour), passer par l'outbox et le worker BullMQ, conformément à la règle n° 4 de CLAUDE.md.

**Deux améliorations structurantes**
- **Renommer une localité crée automatiquement un alias de l'ancien nom** (source `renommage`). Les données qui portent l'ancienne graphie restent ainsi rapprochées sans être réécrites.
- **Le réimport du découpage devient une mise à jour qui conserve les identifiants.**
  - Rapprochement des nœuds existants par pcode, sinon par chemin normalisé.
  - Mise à jour des nœuds retrouvés, insertion des nouveaux.
  - Suppression des seuls nœuds absents, après confirmation qui indique le nombre de zones de contrat et d'alias touchés.
  - Les zones de contrat ne sont alors plus détachées.

**Routes** (settings.routes.js, zod, rôle admin ou manager) :
- `GET /api/settings/place-matches?status=&kind=`
- `POST /api/settings/place-matches/:id/decide` avec `{action:'lier'|'creer'|'ignorer', pcode?, areaId?, officeId?}`
- `POST /api/settings/place-matches/apply`
- `GET` et `DELETE /api/settings/place-aliases/:id`

**Code qui appellerait le moteur**

| Fichier | Fonction (lignes) | Appel |
|---|---|---|
| server/src/modules/tpm/field.repository.js | createSite 40-58, updateSite 60-90 (si district ou commune changent), importMasterData 156-188, importPlanSites 196-270, upsertSites 297-320 (Planning), importLocations 838-900, addSite 1010-1034 | `applyToSources(['sites'], ids)` puis résolution unique du bureau. Les 4 sous-requêtes `resolveOffice` sont supprimées |
| server/src/modules/settings/settings.repository.js | listCommunes 227-257 (renvoyer le pcode), writePerimeter 333-349 (stocker `adm3_pcode`), attachUnassignedSites 357-368 (jointure par pcode, puis (district, commune)), officesWithCounts 264-283, deleteOffice 370-375 | Index des bureaux |
| server/src/modules/settings/localities.repository.js | replaceBreakdown 87-145 (mise à jour conservant les identifiants, puis réapplication), updateArea 246-280 (alias `renommage` et propagation), deleteArea 283-296 | `applyToSources(toutes)` |
| server/src/modules/monitoring/monitoring.repository.js | importSubmissions 436-480, applyMappingToSubmissions 369-395 ; lectures 199-228, 641-670, 737-790, 803-820 (jointures sur `adm3_pcode` et `admin_areas`) | `matchAndQueue('soumissions')` |
| server/src/modules/monitoring/submissionsImport.js:17-25 et memsMapping.js:16-26 | `buildLookup` (normaliser l'alias), DIMENSIONS (adm2 = District, adm3 = Commune, adm4 = Fokontany ; pcode avant nom) | — |
| server/src/modules/tpm/field.repository.js:125-132, 322-329 | Jointure sur `ms.adm3_pcode` avec `NOT ms.excluded` | — |
| server/src/modules/pdd/pdd.repository.js | insertDistributions 102-140, reportPddByMonth 143-155 (filtre bureau) | `matchAndQueue('pdd')`, résolution des bureaux et partenaires |
| server/src/modules/contracts/contracts.service.js / contracts.repository.js | resolveInputs 65-70, décision d'avenant 331-348, getContractAreas 114-122 (chemin courant et indicateur « détachée ») | Relier par pcode ou chemin |
| web/src/pages/settings/LocalitiesSection.jsx | Nouveaux onglets « À rapprocher » (valeur, parent, nombre de lignes par source, candidats avec score, boutons Lier / Choisir / Créer / Ignorer) et « Alias » | — |
| web : RbmPage.jsx (toast d'import l.87), FieldVisitsPage.jsx (l.96), PlanBoardPage.jsx (aperçu Locations ; addSite qui envoie `regionId/districtId/communeId` ou pcode, l.646-650), ProcessMonitoringPage.jsx (toast et onglet Mapping), PddPage.jsx | Nouveau composant `web/src/components/ImportMatchReport.jsx` : « N reconnus · M à rapprocher → Paramétrage › Localités » | — |

---

## 3. Écarts classés par priorité

Marqueurs : **[FAUX]** chiffres faux aujourd'hui · **[VIDE]** chiffres vides · **[BLOQUANT]** une action devient impossible · **[PERTE]** perte de données · **[SÉC]** contrôle d'accès manquant.

### Priorité haute

- **H1 [BLOQUANT] Le réimport du découpage détache les zones de contrat.**
  - Preuve : DELETE à localities.repository.js:90 ; `ON DELETE SET NULL` à 008:40 ; zod `adminAreaId: uuid` à contracts.validation.js:21-24.
  - Effet : enregistrer un contrat ou demander un avenant renvoie 400 « Données invalides ». Un avenant demandé avant le réimport ne peut plus être approuvé (violation de clé étrangère 23503 sur les identifiants du snapshot, contracts.service.js:331-348) et bloque tout nouvel avenant.
  - Correction : réimport par mise à jour conservant les identifiants (2.2). À défaut, en fin de `replaceBreakdown` : `UPDATE contract_areas … FROM admin_areas` par pcode puis `lower(path)`, et retour `{zonesReliees, zonesOrphelines}`. Revalider le snapshot dans la décision d'avenant (409 explicite si une zone a disparu). Dans le formulaire, afficher les zones détachées « à resélectionner ».
- **H2 [VIDE] L'import des soumissions casse la liaison données ↔ sites.**
  - Preuve : niveaux faux (memsMapping.js:20-22) ; alias non normalisé (submissionsImport.js:22) ; nom pris avant le code. Vérifié par exécution : admin1 = null, admin3 = « Ampanihy Ouest » au lieu de `MG51507090`, agent = null.
  - Effet : dernière collecte vide, RBM « à suivre » à tort, régions et communes illisibles.
  - Correction : `byNorm.has(norm(a))` ; DIMENSIONS alignées sur Localités ; pour admin1 à admin3, préférer une colonne qui a la forme d'un pcode ; mettre à jour memsMapping.test.js:11-12 et :21.
- **H3 [FAUX] Le pcode de commune n'est posé que par l'import Master Data** (field.repository.js:171-182).
  - Effet : les sites créés par les imports Plan, Locations ou Planning, ou à la main, ne sont jamais reliés aux données collectées. Le RBM les déclare « à suivre » et les replanifie.
  - Correction : le moteur de 2.2. En attendant, une action « Rapprocher les pcodes » (UPDATE par nom de commune dans son district, depuis admin_areas).
- **H4 [FAUX] La « dernière collecte » compte les soumissions exclues et toutes les fiches.**
  - Preuve : field.repository.js:125-132 et 322-329, ni `NOT ms.excluded` ni filtre de fiche.
  - Effet : une soumission écartée au nettoyage, ou venant d'une autre activité, marque tous les sites de la commune comme visités. La génération RBM saute alors ces sites.
  - Correction : ajouter `AND NOT ms.excluded` et la condition d'activité de la fiche (`f.activity_category` nulle ou égale à `s.activity`).
- **H5 [PERTE] Changer le risque ou les critères d'un site au RBM efface son activité et son fokontany.**
  - Preuve : `fokontany = $5, activity = $7` sans COALESCE (field.repository.js:64), appelé avec `{riskLevel}` seul (RbmPage.jsx:75) ou avec les seuls critères (RbmPage.jsx:251).
  - Effet : le site devient « Sans paramètre MMR » ; ses visites exigées et sa couverture deviennent fausses.
  - Correction : `CASE WHEN $x::boolean THEN … ELSE colonne END`, comme pour les autres colonnes, et un test de non-régression.
- **H6 [FAUX] Les visites sans activité se dupliquent à chaque réimport.**
  - Preuve : `UNIQUE (tenant_id, site_id, period_month, activity)` avec une activité nullable (020:28).
  - Effet : réalisées, MMR de l'exercice et couverture gonflés.
  - Correction : dédoublonner, puis créer un index unique sur `(tenant_id, site_id, period_month, COALESCE(activity,''))`. Cette forme marche sur toutes les versions de PostgreSQL ; `NULLS NOT DISTINCT` exigerait PG ≥ 15. Adapter ensuite les cibles `ON CONFLICT` explicites (field.repository.js:285-288, 627-631, 785-787, 893-894).
- **H7 [FAUX] Deux identités de site concurrentes.**
  - Preuve : code du fichier (field.repository.js:161) face au slug (209-218, 301, 845-846) ; seule contrainte `UNIQUE (tenant_id, code)` (001:36).
  - Effet : importer le Master Data puis le Plan de suivi crée des doublons. L'un porte le pcode, l'autre le score.
  - Correction : colonnes `geo_key` (le slug) et `external_code`, avec un index unique partiel sur `geo_key`, et une seule fonction d'upsert : L###, puis external_code, puis geo_key.
- **H8 [VIDE/FAUX] Le bureau des soumissions n'est jamais relié à Bureaux & antennes.**
  - Preuve : monitoring.repository.js:548 ; reportData.js:114-143.
  - Effet : un rapport filtré par bureau ne trouve aucune donnée de suivi ; les sections par bureau existent en double (nom officiel d'un côté, « 7 » de l'autre).
  - Correction : `field_office_id` résolu à l'import (2.2) et regroupement sur l'identifiant. Le filtre du Concepteur ne doit proposer que les bureaux parents.
- **H9 [FAUX] Chiffres clés du Concepteur.**
  - Preuve : reportData.js:114-133. `sitesVisited` est sommé sur toutes les fiches alors que `sitesActive` ne porte que sur les fiches rattachées. En filtre « bureau », visites et sites restent globaux. Le PDD donne à chaque bureau le total national.
  - Correction : même sous-ensemble de fiches pour le numérateur et le dénominateur ; comptages par bureau dans `reportMonitoringData` ; masquer les blocs PDD par bureau tant que H8 et le lot 5 ne sont pas livrés. Ajouter des tests dans reportData.test.js.
- **H10 [FAUX] Le budget du Concepteur et du Rapport de synthèse n'est pas borné à la période.**
  - Preuve : reports.service.js:69 ne transmet que `today` ; ReportingPage.jsx:34 appelle `api.consolidation()` sans mois.
  - Correction : paramètres `{from, to}` dans la consolidation (filtre sur `period_month`), libellé « cumul au … », test dans consolidation.test.js.
- **H11 [FAUX] Trois définitions du « Réalisé ».**
  - Preuve : factures validées seulement (contracts.repository.js:146-154 ; liste des contrats) ; soumises et validées (forecastData l.169 ; consolidation.repository.js:53).
  - Effet : la fiche contrat, son onglet Prévision, la consolidation et les alertes affichent des montants différents.
  - Correction : une constante partagée `REALISE_STATUSES` (dans budgetCatalog.js), ou des libellés qui distinguent explicitement les deux notions.
- **H12 [SÉC/FAUX] Valider ou rejeter une facture ne demande ni rôle ni statut.**
  - Preuve : pas de WRITE sur les routes reports.routes.js:166-175 ; `setStatus` sans condition de statut (reports.repository.js:345-354).
  - Effet : un lecteur peut valider une facture, un rapport « attendu » peut être validé, une facture validée peut être rejetée puis rééditée.
  - Correction : `requireRole('admin','manager')`, `WHERE status = 'soumis'` avec 409 si aucune ligne n'est modifiée, et séparation des tâches (celui qui soumet ne valide pas).
- **H13 [FAUX] Pipeline PDD, vue « Tous les mois ».**
  - Preuve : sans mois, plusieurs lignes de stock par denrée et la dernière lue l'emporte (pdd.repository.js:74-83).
  - Effet : couverture et ruptures calculées sur un mois de stock choisi au hasard face au besoin cumulé.
  - Correction : `DISTINCT ON (commodity) … ORDER BY period_month DESC` et libellé « stock au <mois> », avec un test.
- **H14 [VIDE/FAUX] Aucun rapprochement des noms de lieux, pour tous les points d'entrée de 2.1.**
  - Effet : régions coupées en deux (« Atsimo-Andrefana » et « Atsimo Andrefana »), zones PDD éclatées, sites en double.
  - Correction : le moteur de 2.2.

### Priorité moyenne

- **M1. Périmètre des bureaux sans district.**
  - Preuve : clé primaire (office_id, commune) à 024:27 ; 5 copies du résolveur ; bureaux inactifs acceptés par 4 d'entre eux.
  - Correction : migration avec `adm3_pcode` et un index unique `(office_id, lower(coalesce(district,'')), lower(commune))` ; une seule résolution (pcode, puis district et commune) ; clé d'interface `district|commune` (SettingsPage.jsx:344).
- **M2. Le rattachement automatique au bureau n'est pas rejoué.** Après un import, `addSite` ou la suppression d'un bureau, rien ne se refait. L'import Locations met le bureau à NULL quand Sub Office est vide (SITE_UPD_COLS). L'import Plan écrase un bureau existant (field.repository.js:236).
  - Correction : exporter `attachUnassignedSites` et l'appeler en fin de chaque écriture de site ; `COALESCE(v.field_office_id, s.field_office_id)` ; à l'import Plan, conserver le bureau existant et lire les colonnes Sub-Office et Antenne (détectées à planImport.js:28-29, jamais lues).
- **M3 [FAUX] La colonne « Sites » des bureaux compte par nom de commune** (settings.repository.js:270-275), alors que les autres écrans comptent par `field_office_id`.
  - Correction : `count(*) FILTER (WHERE s.field_office_id = o.id)`, plus « dans le périmètre mais non rattachés ».
- **M4. Supprimer un bureau a des effets en cascade silencieux** : dérogations MMR supprimées (027:8), sites détachés, antennes orphelines ; confirmation simple (SettingsPage.jsx:274).
  - Correction : 409 avec les compteurs sauf `?confirm=1` ; proposer « Désactiver » par défaut.
- **M5. Renommer une localité ne se propage pas.** C'est réglé par l'alias `renommage` décrit en 2.2. Il faut aussi faire lire le chemin courant par `getContractAreas` (`COALESCE(a.path, ca.path)`) pour supprimer les faux changements de zone dans le diff d'avenant.
- **M6 [FAUX] RBM, Couverture et Générer ignorent le MMR** (rbmMath.js:11 ; rbmSites 136-153 ; generateFromRbm 274-294).
  - Correction : utiliser `mmrLookup` et `deriveMmr().interval`, avec repli sur la fréquence par défaut, et indiquer la source (MMR ou défaut).
- **M7. Activités : trois vocabulaires et quatre normalisations.**
  - Preuve : planBoard.js:16, mmr.js:34, mmrXlsx.js:100, monitoring.repository.js:742. Renommer une catégorie MMR ne met rien à jour (bulkSaveMmr, settings.repository.js:486-492).
  - Correction : `normLabel` partagée ; libellé canonique appliqué à toutes les écritures de `sites.activity` ; cascade dans la même transaction lors d'un renommage MMR.
- **M8 [BLOQUANT] Désactiver une activité bloque les contrats qui l'utilisent.**
  - Preuve : ContractFormPage.jsx:57 masque l'activité mais garde son identifiant (l.23) ; `validActivityIds` exige `active = true` (contracts.repository.js:248-255).
  - Correction : accepter les identifiants déjà liés au contrat et afficher une puce « inactive » que l'on peut retirer.
- **M9 [FAUX] La consolidation compte les plans en brouillon et exclut les contrats résiliés** (consolidation.repository.js:38 et 62-70). Ses commentaires sont erronés (l.11).
- **M10 [FAUX] Le pré-remplissage d'une facture depuis un plan ignore le prestataire.**
  - Preuve : `planItemsFor` cherche par (contrat, mois) et prend la première ligne trouvée (planning.repository.js:110-121).
  - Correction : ajouter le paramètre `partnerId`.
- **M11 [FAUX] La région des soumissions est déduite via les sites**, avec repli sur `admin1` brut (monitoring.repository.js:658-669, 783-789).
  - Correction : jointure sur `admin_areas` par pcode et lignée.
- **M12 [FAUX] Le district n'a pas la même clé selon l'écran** : `s.district` dans `summary` (field.repository.js:450) contre `COALESCE(adm2, district)` sur la carte. `updateSite` ne met pas à jour adm2 et adm3.
- **M13. 15 écrans sur 23 ne peuvent pas renvoyer vers la configuration** (App.jsx:96-122).
  - Correction : composant `ConfigLink` et `onNavigate` passé partout (voir le lot 7).
- **M14 [FAUX] Imports Master Data et Planning lus par position de colonne** (field.routes.js:211-217, 338-345).
  - Correction : détection des colonnes par en-tête, comme pour planImport et locationsXlsx.
- **M15 [FAUX] Une visite ne peut pas être désaffectée** : « Non affecté » ne fait rien (COALESCE, field.repository.js:593).
- **M16 [FAUX] PDD.** Le total des vivres est lu dans une cellule calculée par formule plutôt que recalculé. Les lignes dont le mois est invalide sont perdues sans être comptées (pddImport.js:56-69).
- **M17 [FAUX] Dashboard Couverture & performance : le « Plan vs réalisé » mélange les unités** (DashboardCoveragePage.jsx:126-133 : visites contre sites, communes contre sites).
- **M18 [FAUX] Import du budget FLA.** « Suivi et évaluation » est classé en IV.evaluation (budgetImport.js:43-57 ; première ligne du catalogue « Évaluation », budgetCatalog.js:62). Le contrat disparaît alors de toute la consolidation. La colonne Activité est ignorée.
- **M19. Le serveur ne contrôle ni le prestataire (type TPM, actif), ni le contrat (statut, ligne IV.suivi), ni le mois des factures et des plans.**

### Priorité basse

- **B1. Paramètres sans effet** : devise et centre de carte du profil pays (LocalitiesSection.jsx:115, 118 ; seul lecteur de `getCountry`, client.js:170 ; carte sur `MG_CENTER`, SitesMapPage.jsx:16) ; taux journalier des partenaires ; currencyMath.js jamais importé.
- **B2.** Unicité des catégories MMR sensible à la casse (032:10-15).
- **B3.** Import du découpage : homonymes d'un même parent fusionnés, casse distinguée (localities.domain.js:21-31).
- **B4.** Les PATCH bureau et partenaire écrasent les champs non fournis.
- **B5.** Seed : démo à 2 niveaux sans P-code, pcodes arbitraires (seed-test.js:373-386).
- **B6.** Critères RBM affichés sur une échelle obsolète (contrainte 0/1/3/99, 045:8).
- **B7.** Imports et génération RBM faits ligne par ligne (field.repository.js:160-185, 282-291, 300-318 ; monitoring.repository.js:461-477).
- **B8.** Cartes figées sur Madagascar ; GPS hors des bornes effacé sans avertissement.
- **B9.** Champ « site » des postes perdu à la réédition ; le modèle Excel des postes n'a ni activité ni % bailleur.
- **B10.** Nom du partenaire recopié dans le contrat et non propagé ; partenaires inactifs proposés.
- **B11.** Matrice mensuelle de la consolidation : factures hors période comptées dans le total mais absentes des cellules.
- **B12.** Denrées PDD sans écran ; vocabulaire de modalité divergent (Inkind/CBT contre Vivres/Cash).
- **B13.** `ContractFormDrawer.jsx` est du code mort (importé nulle part).
- **B14.** Les zones d'un contrat ne sont croisées avec aucun site ni aucune visite.
- **B15.** Les événements outbox des contrats n'ont aucun abonné (outbox.js:23-25).

---

## 4. Plan de mise en œuvre par lots livrables indépendamment

Chaque lot est consigné dans `docs/JOURNAL.md`, commité et poussé à chaque mise à jour (règle du projet). Les nouvelles migrations commencent à **048** ; aucune migration déjà appliquée n'est modifiée. Chaque lot se vérifie par `npm test`, `npm run lint`, `web: npm run build` et un balayage Playwright.

| Lot | Contenu | Fichiers | Migration | Tests |
|---|---|---|---|---|
| **0. Correctifs rapides qui corrigent des chiffres faux** | H5, H4, H2 (partie `buildLookup` et alias), H12, M10, M15, H13, H9 (masquer PDD par bureau, aligner le dénominateur), H11 (constante) | field.repository.js (updateSite, RBM_SELECT, VISIT_COLS, updateVisit), submissionsImport.js, memsMapping.js, reports.routes.js, reports.repository.js, planning.*, pdd.repository.js, reportData.js, contracts.repository.js, consolidation.repository.js, FactureDrawer.jsx | Aucune | memsMapping.test.js et submissionsImport.test.js (alias accentués, code avant nom), reportData.test.js (fiche non rattachée avec visites), pddMath (stock sur plusieurs mois), test unitaire de la mise à jour partielle d'un site |
| **1. Localités sans casse** | H1, M5 (chemin courant) : réimport conservant les identifiants, revalidation des avenants, zones détachées visibles | localities.repository.js, localities.domain.js (plan de mise à jour), contracts.service.js, contracts.repository.js, ContractFormPage.jsx, AreasSelector.jsx, LocalitiesSection.jsx (confirmation avec compteurs) | 048a `contract_areas.pcode` (ou intégrée à 048) | localities.test.js : rapprochement par pcode, par chemin, nœuds supprimés |
| **2. Moteur pur `placeMatch`** | Normalisation, ordre de résolution, jetons discriminants, bureaux ; déplacement d'`officeResolver` | server/src/modules/common/placeMatch.js ; mmrXlsx.js (réexport) | Aucune | **placeMatch.test.js** : toutes les lignes du tableau de 2.2, ambiguïté, priorité des alias, cas « Toliara I » à ne jamais proposer, cas tirés de fixtures (plan et PDD) |
| **3. Sites et bureaux rattachés** | Tables d'alias et file d'attente, colonnes ; branchement des 7 écritures de sites ; résolution unique des bureaux ; périmètre par pcode et district ; M1, M2, M3, M4 | placeMatch.repository.js, field.repository.js, settings.repository.js, settings.routes.js, SettingsPage.jsx | **048** (tables et colonnes), **049** (clé du périmètre) | Tests unitaires du plan de mise à jour ; test d'intégration manuel sur seed-test |
| **4. Soumissions reliées** | Résolution des niveaux admin et du bureau à l'import ; application aux données déjà importées ; jointures sur `adm3_pcode` ; régions via admin_areas (M11) ; rapport « reconnu / à rapprocher » dans l'onglet Mapping ; H8 | monitoring.repository.js, monitoring.routes.js, dataLinks.service.js, field.repository.js (jointures), reportData.js, ProcessMonitoringPage.jsx | Colonnes de 048 | submissionsImport.test.js, reportData.test.js (bureau par identifiant) |
| **5. PDD relié** | Zones, antennes et partenaires résolus ; « Taolaganaro » traité par alias ; résumé d'import ; Concepteur par bureau ; M16 | pdd.repository.js, pdd.routes.js, pddImport.js, reportData.js, PddPage.jsx | Colonnes de 048 | pddTemplate.test.js (total des vivres recalculé, lignes ignorées comptées) |
| **6. Écrans « À rapprocher » et « Alias »** | File d'attente, validation, création de localité, « Rapprocher maintenant », alias automatique au renommage | LocalitiesSection.jsx, ImportMatchReport.jsx, settings.routes.js | — | Test de `decide` (transaction, verrou) ; balayage Playwright |
| **7. Liaisons visibles** | `ConfigLink` ; `onNavigate` passé aux 15 écrans ; encart « Utilisé par » avec compteurs (`GET /api/settings/usage`, comptages SQL) ; `GET /api/settings/health` (fiches non rattachées, sites sans bureau ni pcode, contrats sans IV.suivi, plans en brouillon) ; catégorie « Paramétrage » dans les Alertes ; textes corrigés (PddPage.jsx:221, ConsolidationPage.jsx:230, LocalitiesSection.jsx:115-118) | App.jsx, components/ConfigLink.jsx, pages concernées, AlertsPage.jsx, settings.* | Aucune | Balayage Playwright : tous les liens mènent à la bonne rubrique |
| **8. Identité de site unique et visites** | H7, H6 : `geo_key`/`external_code`, dédoublonnage contrôlé, index sur l'activité avec COALESCE | field.repository.js | **050**, **051** (rapport de dédoublonnage avant suppression) | Tests du choix de la ligne conservée |
| **9. MMR partout et activités** | M6, M7, M8, B2 | rbmMath.js, coverageRecap.js, field.repository.js, settings.repository.js, contracts.*, `normLabel` partagée | **052** (unicité MMR insensible à la casse, après contrôle des doublons) | rbmMath et planBoard (MMR prioritaire sur le défaut) |
| **10. Priorité basse** | B1 à B15, M9, M12, M14, M17, M18, M19 | Selon l'écart | Selon l'écart | Selon l'écart |

**Dépendances entre lots**
- Le lot 0 se livre seul et doit passer en premier : il corrige les chiffres faux les plus visibles.
- Les lots 1 et 2 sont parallélisables.
- Les lots 3, 4 et 5 dépendent du lot 2 et de la migration 048.
- Le lot 6 dépend du lot 3.
- Le lot 7 est indépendant ; ses compteurs sont plus utiles après les lots 3 et 4.
- Le lot 8 modifie des données existantes : il doit suivre une sauvegarde et un aperçu du dédoublonnage.

---

## Affirmations que je n'ai pas pu vérifier

- Comportements qui demandent une base en marche, déduits du code et des contraintes sans être exécutés : le 400 au premier enregistrement d'un contrat après réimport, le 23503 à l'approbation d'un avenant, l'échec complet (23505) d'un import Locations contenant deux lignes au même slug, la duplication effective des visites sans activité.
- La version de PostgreSQL installée sur la machine Windows cible. C'est pourquoi l'index sur l'activité avec COALESCE est préconisé plutôt que `NULLS NOT DISTINCT`.
- Lignes citées par les cartes et non relues :
  - tiroirs Facture et Plan qui afficheraient des listes vides sans message (FactureDrawer.jsx:176-184, PlanBudgetDrawer.jsx:92-101) ;
  - perte du champ « site » dans PostesEditor.jsx:48-75 ;
  - clés React dupliquées dans AreasSelector.jsx:86 ;
  - affichage des zones détachées (ContractDetailPage.jsx:167) ;
  - mois des jours de collecte (PlanBudgetDrawer.jsx:36) ;
  - taux USD de PlanningPage.jsx:155 ;
  - échelle des critères dans RbmPage.jsx:22-31 ;
  - table d'alias de SitesMapPage.jsx:18-23 ;
  - textes de CoverageRecapPage ;
  - ancien modèle lu par EvaluationPage et listAgentsEvaluation ;
  - visibilité du bouton « Appliquer » de l'onglet Mapping (ProcessMonitoringPage.jsx:645).
- PDD : les 39 lignes dont le total des vivres diffère, les modalités de pddTemplate.js et les builders PDD de reportData.js n'ont pas été relus. La cascade MMR à la suppression d'un bureau est en revanche vérifiée (027:8).
- Import par lien : la correspondance par suffixe de dataLinks et la duplication des CSV sans `_uuid` n'ont pas été relues ; je n'ai pas non plus vérifié que `importFromLink` passe bien par `importSubmissions`.
- `consolidation.js:101-111` (mois hors période) et le contenu exact de reportData.test.js.
- PATCH partenaire qui effacerait `daily_rate` et `contract_ref` (settings.repository.js:98-108).
- Le fait que l'interface ne renseigne jamais `site_visits.contract_id`, et le message « Contrats suivis : 0 » (ReportsPage.jsx:304).
- Les seuils proposés (Jaro-Winkler ≥ 0,90) et l'estimation d'environ 19 000 unités chargées par import sont des choix de conception, pas des mesures. Les comptages de rapprochement (12 + 8 districts sur 24 ; 22 communes PDD sur 70 ; 467 lignes PDD sur 491 rattachables à un bureau) ont été calculés sur les fixtures de démonstration, pas sur des données de production.