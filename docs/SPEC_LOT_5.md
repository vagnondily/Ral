# Lot 5 élargi — Calendrier d'activité, plan MMR réaliste, priorités configurables, risque daté (retours 24, 25, 48, 55)

> **État : version 1 (14/10/2026), en révision.** Conception en lecture seule rendue à 11:35 UTC. Une critique de complétude a relevé **7 points graves, 15 moyens et 6 mineurs** (§ « Critique » à la fin). Ils seront intégrés dans une version 2, avec le retour 58 (TPM tiré des contrats), avant toute réalisation. Décisions provisoires sur les questions ouvertes : § « Décisions ». Réalisation : après la publication des lots 1b et 6a, car le lot 5 s'appuie sur le service « sites × mois » du lot 1b.



> Spécification d'implémentation, établie en **lecture seule** sur `claude/practical-meitner-2c1560` (commit `8389e32`, lot 1 publié) avec lecture des branches `wip/1b-rest` (faits site × mois), `wip/6a` (061_map_geo) et du travail du retour 56 (061_document_deletions). Les définitions communes de `docs/PLAN_RETOURS_15_37.md` s'appliquent telles quelles (visite = site × mois ; réalisée ; site actif ; dernière visite = réalisée ≤ M, une visite planifiée ne compte jamais ; prestataire actif ; suppression protégée). Migrations **065 à 068**. Toutes les mesures sont faites sous `mems2_app` (RLS active) sur la base de démonstration, sans aucune écriture ; prototypes et bancs dans `scratchpad/design5/proto2/`.

## 0. En bref

1. **Calendrier d'activité** (retour 55-1) : par ligne MMR (catégorie × plan général ou bureau) et par année, 12 mois × « jours d'assistance » (0 … jours du mois), total. S'ouvre dans une **fenêtre** depuis le tableau MMR (bouton par ligne), onglets par année (par défaut année − 2 … année + 2, soit 2024–2028 aujourd'hui), comme le modèle fourni. **Durée réelle = nombre de mois avec au moins un jour d'assistance**, elle remplace la durée saisie dans le MMR pour l'année choisie ; une **durée manuelle** reste possible, avec **motif obligatoire**. Le calendrier dit aussi **quels mois** l'activité tourne : le générateur ne planifie jamais un mois à 0 jour.
2. **Risque daté** (retour 25) : le niveau de risque et la situation sécuritaire d'un site ont chacun une **frise** (points de changement « à partir de tel mois ») ; la valeur d'un mois M est la dernière ≤ M, sinon la valeur de référence. Un changement se fait sur un site **ou une zone** (commune, district, bureau, avec filtre d'activité), « du … au … » ou « sans fin ». **Journal immuable** (qui, quand, portée, avant → après par site, motif obligatoire), **imposé par la base** : aucune écriture du risque, même par import, ne passe sans motif. **Risque du mois** lu partout par un seul fragment SQL et son jumeau pur.
3. **Règles de priorité configurables** (retour 24) : table ordonnée « si … alors niveau + motif + que faire », la première vraie décide, une condition indéterminée (donnée manquante) passe à la suivante, « Sinon » en bas. Équivalent « cas » / `ifs()` affiché et utilisable en mode expert. Moteur **calcFields** (aucun `eval`) étendu de `ifs`, `case`, `months_between`. Versions (brouillon → active → archivée, note obligatoire), aperçu sur un mois, test sur un site. **Modèle par défaut = calcul actuel, à l'identique** : 0 écart sur 1 280 sites × 11 mois (14 080 site × mois).
4. **Garde-fous non configurables**, appliqués après les règles : zone interdite au mois M, site inactif à M (grille d'activation, règle 1b), visite annulée à M (décision respectée), visite déjà prévue ou réalisée à M, activité hors calendrier à M. Aucune règle utilisateur ne peut les contourner.
5. **« Pourquoi ? / Que faire ? »** (retour 48 prolongé) : le panneau du lot 1 garde les raisons du score et y ajoute la règle appliquée, la trace règle par règle (vrai / faux / indéterminé et valeurs lues), les garde-fous et l'action de la règle.
6. **Paramètres du plan** (retour 55-2) : objectif (auto / MMR complet / couverture), **80 %** des sites, niveaux à planifier, regroupement lieu → commune → district, journées multi-activités, marge de capacité, jours de déplacement, anticipation, suivis/jour par défaut, limite aux jours d'assistance. Chaque valeur initiale affiche **sa source exacte** (cellule ou colonne du classeur RBM, retour, ou choix MEMS) ; les paramètres par activité restent dans la grille MMR.
7. **Générateur de plan réaliste** : module **pur, déterministe, testé**. Mois par mois : engagements existants d'abord, candidats filtrés par les garde-fous et l'intervalle de revisite (intervalle MMR effectif), niveau par les règles, classement (recommandation urgente, niveau, couverture, retard), puis **placement en tournées** (district) → étapes (commune) → journées, en remplissant d'abord le même lieu (multi-activités), la même commune, puis le même district, **sans jamais dépasser** la capacité de visites ni les jours-personne de chaque activité. Chaque visite dit pourquoi elle a été choisie, chaque site non planifié dit pourquoi il est reporté, et une **projection de couverture** compare au 80 %.
8. **Aperçu puis enregistrement** : l'aperçu est stocké (exécution du générateur, empreinte des entrées) ; « Enregistrer » revérifie l'empreinte (409 si les données ont changé), prend les mêmes verrous que « Générer depuis le RBM » et insère par lots multi-lignes avec les règles de `site_visits` du lot 1 (jamais deux visites site × mois, annulations respectées, mois inactifs exclus), en gardant pour chaque visite son motif et sa version de règles.
9. **Exécution** : mesuré 108–264 ms (médiane) pour 3 000 sites × 12 mois, 450 ms au pire, tas ≤ 70 Mo ; 10 000 sites × 12 mois : 670 ms. Calcul **hors de la boucle d'événements** dans un fil de calcul (`worker_threads`) de l'API — aller-retour mesuré 253–416 ms, boucle libre pendant le calcul — sans dépendre de Redis (optionnel sur la cible). Le module étant pur, il peut passer tel quel dans le worker BullMQ si un jour le volume l'exige (question ouverte, non fait).
10. **Constat chiffré à montrer à l'écran** : avec les capacités de votre écran MMR (capture du 14/10), l'objectif de 80 % n'est atteignable que pour « Nutrition treatment » (243 visites possibles sur 9 mois pour 217 nécessaires). Il manque 140 visites pour les repas scolaires (520 possibles, 660 nécessaires), 20 pour la prévention de la malnutrition, 8 pour les transferts. Le générateur le dit avant d'enregistrer, avec l'équivalent en personnes.

## 1. Ce qui existe (vérifié dans le code)

| Sujet | Où | Aujourd'hui |
|---|---|---|
| MMR (formules) | `tpm/mmrMath.js:35-81` `deriveMmr` | intervalle = durée ÷ risque ; fréquence = durée ÷ intervalle (= risque) ; ciblé/mois = sites ÷ intervalle ; capacité = personnes × suivis/j × jours (sinon faisable saisi) ; couverture = capacité ÷ ciblé ; fréquence ajustée = fréquence × couverture ; intervalle ajusté = max(durée ÷ fréquence ajustée, 1) — qui vaut **nb sites ÷ faisable**, indépendant de la durée (824 ÷ 52 = 15,85 sur votre capture). |
| MMR (stockage, écran) | migrations 027, 030, 032 ; `settings.repository.js:390-535` (`listMmr`, `bulkSaveMmr`) ; `settings.routes.js:104-165` ; `web/src/pages/settings/MmrSection.jsx` (grille, plan général + dérogations bureau, import / export Excel) | la durée est **saisie** (0–12), sans année ; aucune notion de mois d'activité. |
| Plan de suivi | `tpm/planBoard.js` (`mmrLookup` bureau → parent → général, `requiredVisits`, `autoPlanMonths`) ; `field.repository.js:805-890` `planBoardTx` | visites exigées = fréquence MMR ; priorité affichée = `scoreSite` **sans intervalle** (retard seulement si jamais visité). |
| RBM du mois | `field.repository.js:113-160` `RBM_SELECT`, `:199-218` `rbmSitesTx`, `:363-399` `generateFromRbmTx` | « à suivre » = jamais visité ou mois depuis la dernière visite ≥ fréquence RBM (élevé 1, moyen 2, faible 3) ; « à planifier » = `rbmMath.needsPlanning` ; génération idempotente (verrou `rbm-generate:<tenant>:<mois>`, `NOT EXISTS` sur toute visite du site × mois, mois inactifs exclus). |
| Explication (lot 1) | `rbmScore.js` (`reasons`, `consequence`, `actions`) ; `web/src/pages/monitoring/RbmExplain.jsx` | raisons du score et actions codées en dur ; priorité codée en dur (`priorityBasisOf`). |
| Risque | `sites.risk_level` (faible/moyenne/elevee, défaut moyenne), `sites.security_situation` (0/1/3/99) | **une seule valeur**, sans date ni journal. Écrivains : `updateSite` (`sitePatch.js:11-12`), `importPlanSites` (`:261-357`, écrase risque et sécurité), `importLocations` (`:978-1042`, sécurité), `bulkUpdateSites` (`:1104-1150`, sécurité). Lecteurs : `RBM_SELECT`, `planBoardTx`, `mapData` (`:503-531`), `coverageRecapSummary` (`:571-598`), `tpm.repository.js:84,134`, et au lot 1b `siteActivitySql` (zone interdite = valeur actuelle, limite notée « lot 5 »). |
| Moteur de formules | `monitoring/calcFields.js` | parseur sûr, garde de profondeur (`MAX_NESTING` = 64) déjà en place ; **pas** de `ifs`, `case`, `months_between` ; `checkExpression` signale une variable inconnue en simple avertissement. |
| Faits site × mois (1b, `wip/1b-rest`) | `common/siteActivitySql.js` (`siteMonthFactsCtes` : `fact.active`, `fact.st`), `common/siteActivity.js` (`activeAt`) | site actif à M = hors zone interdite et, si le compte a une grille cette année-là, « Oui » explicite ; statut unique réalisé > prévu > annulé. |
| Exécution de fond | `jobs/queue.js`, `jobs/worker-entry.js`, `jobs/outbox.js` (BullMQ, Redis **optionnel**) | une seule file (recalcul des dépenses). |

Données de démonstration (lecture seule, 14/10) : 1 280 sites (risque élevé 1 151, faible 106, moyen 23 ; aucune zone interdite), 156 visites, 562 soumissions (13 rattachées à un site, 346 sites « vus » par la commune), grille d'activation vide, 18 lignes MMR (6 générales, 12 dérogations), **personnes / suivis par jour / jours ouvrés vides partout**.

## 2. Classeur RBM (`RBM_MDG_V2_2025.xlsm`) — tous les paramètres qu'il contient

Copie de travail ouverte avec openpyxl en mode isolé, macros jamais exécutées. Le projet VBA ne contient qu'un `UserForm1` vide : **aucune logique de score, de priorité ou de planification** n'est dans le classeur. Deux liens externes : [1] un classeur « … New Locations Request » (liste des sous-types de POI) et [2] un classeur « Plan de suivi … Nov 2024 » (feuilles *Resource allocation*, *Monitoring Coverage Plan*, *Site Coverage Recap*, *Overarching parameters*, *Co-Monitoring*…) **non fourni** ; seul le cache de *Co-Monitoring* (colonnes B = bureau, L = catégorie, 2 647 lignes) est embarqué.

### 2.1 Feuille « Overreaching Parameters » (A1:O10) — paramètres par bureau × catégorie

| Col. | En-tête (ligne 1) | Nature | Valeurs (lignes 2–10) | Usage MEMS |
|---|---|---|---|---|
| A | CSP Activity Number | saisie | 1 … 9 | — |
| B | Field Ofice | saisie | « RBJ Madagascar, Ampanihy Sub Office » | portée → bureau (`placeMatch.officeResolver`) |
| C | ID | `=+B&D` (colonne masquée) | — | — |
| D | Activity Category | saisie | 9 catégories (URT, Asset, Climate, School meal, Nutrition treatment, Malnutrition prevention, Smallholder, Emergency preparedness, Analysis) | `mmr_parameters.activity_category` |
| E | Operation duration a year (in months) | saisie | E2 6 · E3 3 · E4 12 · E5 9 · E6 12 · E7 6 · E8 3 · E9–E10 vides | `operation_duration` → **remplacée par le calendrier** quand il existe (§3) |
| F | Number of sites | `=IF(B<>0,COUNTIFS('[2]Co-Monitoring'!L:L,D,'[2]Co-Monitoring'!B:B,B),0)` ; F4 saisi | cache : F2 #VALUE!, F3 0, F4 1 220, F5 213, F6 310, F7 48, F8–F10 0 | `number_of_sites` ; formule sans résultat → nombre du référentiel (`numberOfSitesMissing`, déjà en place) ; **le générateur compte les sites éligibles du registre** (§6) |
| G | Risk level 1=Low 2=Medium 3=High | saisie | G2 2 · G3 1 · G4 2 · G5 2 · G6 2 · G7 1 · G8–G10 vides | `risk_level` MMR (1–3) |
| H | Minimum required interval to visit (in months) | `=IFERROR(E/G,"-")` (commentaire H1 « =Operational duration (in months)/Risk level ») | 3 · 3 · 6 · 4,5 · 6 · 6 | dérivé (`interval`) |
| I | Minimum required frequency of visits during the duration | `=IFERROR(E/H,0)` | 2 · 1 · 2 · 2 · 2 · 1 | dérivé (`frequency`) |
| J | Targeted number of sites to visit (per month) | `=IFERROR(F/H,"-")` (commentaire J1) | 203,3 (J4) · 47,3 · 51,7 · 8 | dérivé (`targetedPerMonth`) |
| K | Feasible number of sites to visit (per month) | saisie | K2 12 · K3 2 · K4 0 · K5 30 · K6 12 · K7 10 | `feasible` (remplacé par personnes × suivis/j × jours quand les trois sont saisis) |
| L | Column1 | `=IFERROR(K/J,0)` | 0,63 (L5) · 0,23 · 1,25 | dérivé (`coverageRatio`) |
| M | CO adjusted required frequency | `=I*L` | 1,27 · 0,46 · 1,25 | dérivé (`adjustedFrequency`) |
| N | CO adjusted required interval (in months) | `=IFERROR(IF(E/M>1,E/M,1),"-")` | 7,1 · 25,8 · 4,8 | dérivé (`adjustedInterval`) → **intervalle de revisite** du générateur (§7.3) |
| O | Feasible / Targeted | `=IFERROR(K/J,"-")` | — | affiché « Couverture » |

### 2.2 Feuille « Locations Management » (A3:AW15, 12 lignes modèles vides) — paramètres par site

| Col. | En-tête | Échelle (Sheet4, ligne 1) | Usage lot 5 |
|---|---|---|---|
| B | Status | `=IFERROR(LOOKUP(2,1/(AL:AW<>""),AL:AW),"")` (dernier mois renseigné) | actif/inactif par mois = grille d'activation (1b, lot 3) |
| D / E | POI Subtypes / Code | listes `pois` (Settings!A5:A21) et VLOOKUP | — |
| G | Sub Office | liste `offices` (Settings!G5:G12), Sub Office en Settings!I (Tsihombe, Fort Dauphin, Bekily → 2 Ambovombe) | hiérarchie antenne → bureau (recherche MMR bureau → parent → général) |
| N | Security situation | 0 pas de restriction · 1 modérée · 3 stricte · 99 zone interdite (Sheet4!A1) | **attribut daté** `security` (§4) ; 99 = garde-fou ; 3 = signal urgent |
| O | Programme synergies | 0 une activité dans la communauté · 1 plusieurs (B1) | variable `synergies` |
| P | Modality type | Cash, Voucher, Food, Capacity Strengthening, Mix (C1) | `modalite` |
| Q | Beneficiary number | nombre (D1) | `beneficiaires` (> 200 = caseload) |
| R | New Partner | 0 expérimenté · 1 nouveau (E1) | `nouveau_partenaire` |
| S | Experienced Partner | 0 bonne · 1 moyenne · 2 mauvaise expérience (F1) | `experience_partenaire` |
| T | Last visit date | date (G1) | dernière visite « registre » (lot 1 `lastVisitOf`) |
| U / V / W | Issues internal process / Partner report / CFM | 0 aucun · 1 important · **2 urgent** (H1–J1) | **recommandation urgente** = l'un d'eux à 2 |
| X | Fraud and corruption | 0 · 1 suspectée · 2 avérée (K1) | recommandation urgente dès 1 |
| Y | Score | vide, **sans formule** | MEMS calcule `rbmScore` (pondérations MEMS, « à valider ») |
| Z:AK | 1 … 12 (sans titre) | plan mensuel (MEMS lit P / X / 1) | visites prévues |
| AL:AW | 1 … 12, année en AL2 (= 2025) | liste `status` (Settings!D5:D6 : Active = 1, Inactive = 0) | grille d'activation |

### 2.3 Ce que le classeur ne contient **pas**

- **Personnes à déployer, suivis par jour, jours ouvrés** : aucune colonne. Ce sont des colonnes MEMS (migration 030). Votre écran du 14/10 montre **Suivis/j = 3** pour cinq catégories et **1** pour « Unconditional resource transfers », personnes et jours vides. La feuille *Resource allocation* du classeur lié [2] en est probablement la source (question ouverte).
- **Calendrier d'activité** : absent ; le modèle vient de votre capture (onglets 2024…2028, *Month* | *Number of assistance days*, *Total*).
- **Règles de priorité, objectif de 80 %, regroupement en tournées** : absents ; ils viennent des retours 24 et 55.
- **Fréquence RBM par niveau de risque** (élevé 1 mois, moyen 2, faible 3) : choix MEMS (`rbmMath.DEFAULT_FREQUENCY`), pas le classeur.

## 3. Calendrier d'activité (retour 55-1)

### 3.1 Modèle

Un calendrier **appartient à une ligne MMR** (plan général ou dérogation bureau) : il suit ses renommages, et les dérogations de vos bureaux ont déjà des durées différentes (9 contre 10 mois pour les repas scolaires). Pour une année Y, chaque mois porte un nombre de jours d'assistance entre 0 et le nombre de jours du mois (29 février contrôlé). Un mois absent = non renseigné ; une année sans aucun mois renseigné = « pas de calendrier Y ».

Résolution pour un site ou une ligne de bureau (pure, `resolveCalendar`) : calendrier propre de la ligne effective, sinon celui de la ligne du bureau parent, sinon celui de la ligne du plan général (même chaîne que `planBoard.mmrLookup`).

### 3.2 Règles pures — `server/src/modules/tpm/activityCalendar.js` (nouveau, testé)

- `daysInMonth(y, m)`.
- `calendarYear(entries, year)` → `{ year, known, durationMonths, totalDays, activeMonths: [1..12], first, last, gaps }`.
- `resolveCalendar(rowsByMmrId, mmrRow, { parentRow, generalRow })`.
- `effectiveMmr(row, calendar, year)` → la ligne avec `operationDuration` effective et `durationSource` :
  - `manuel` : `duration_mode = 'manuel'`, durée saisie, motif affiché ;
  - `calendrier` : l'année est renseignée, durée = mois à > 0 jour ;
  - `saisie` : pas de calendrier pour l'année, durée saisie (comportement actuel, marqué « pas de calendrier 2026 »).

  Elle renvoie aussi les dérivés `deriveMmr` inchangés, `activeMonths`, `assistanceDays[1..12]` et l'avertissement `duree_differente_du_calendrier` (durée manuelle ≠ mois du calendrier).
- Vérifié sur le prototype : repas scolaires 2026 avec janvier–juin et septembre–décembre → durée 10, intervalle 5, ciblé 164,8/mois, couverture 32 %, intervalle ajusté 15,85 (identiques à votre capture) ; sans septembre → durée 9, intervalle 4,5, ciblé 183,1, capacité de la période 468 au lieu de 520.

**Effets de la durée** :
- intervalle MMR ;
- ciblé par mois ;
- capacité totale de la période (faisable × mois actifs) ;
- **mois où le générateur peut placer des visites**.

La fréquence exigée (= risque MMR) et l'intervalle ajusté (= sites ÷ faisable) n'en dépendent pas. Une année à 0 mois actif donne 0 visite exigée.

### 3.3 Où la durée effective est utilisée

`settings.listMmr(year)` (grille), `planBoardTx(year)` (visites exigées et pied de capacité via `effectiveMmr` de l'exercice), règles de priorité (variables `duree_activite`, `activite_en_cours`, `intervalle_mmr`…), générateur (mois actifs, capacité, intervalles). **Une seule fonction** (`effectiveMmr`) ; `mmrMath.deriveMmr` reste inchangé.

### 3.4 API

| Méthode | Chemin | Droits | Corps / réponse |
|---|---|---|---|
| GET | `/api/settings/mmr?year=2026` | lecture | lignes actuelles + `effective: { durationMonths, durationSource, durationReason, activeMonths, totalDays, calendarOwner: 'ligne'\|'parent'\|'general'\|null }` (une requête bornée de plus : calendriers de l'année). Sans `year` : année courante. |
| GET | `/api/settings/mmr/:id/calendar?from=2024&to=2028` | lecture | `{ mmrId, activityCategory, scope:{officeId,officeName}, own:boolean, inheritedFrom:{mmrId,scope}\|null, years:[{ year, known, months:[{month,days}×12], totalDays, durationMonths, activeMonths, first, last, gaps }], updatedAt }` ; plage ≤ 10 ans. |
| PUT | `/api/settings/mmr/:id/calendar` | admin | `{ year, months:[{ month:1..12, days:int\|null }] (exactement 12), expectedUpdatedAt? }` → remplace l'année (DELETE de l'année + un INSERT multi-lignes) dans `withTenantTransaction` ; 400 si jours > jours du mois ; 409 si `expectedUpdatedAt` périmé ; réponse = l'année recalculée. |
| PUT | `/api/settings/mmr/bulk` | admin | ajoute `durationMode: 'auto'\|'manuel'` et `durationReason` (zod : `manuel` ⇒ motif de 5 à 300 caractères ; `auto` ⇒ motif effacé). |
| GET | `/api/settings/mmr/calendar.xlsx?from=2024&to=2028` | lecture | classeur : une feuille par année (« 2024 » … « 2028 ») ; ligne d'en-tête *Mois* \| une colonne par ligne MMR (« Catégorie — Plan général » / « Catégorie — Bureau X ») ; 12 lignes de mois et une ligne *Total* en formule ; validations 0 … jours du mois. |
| POST | `/api/settings/mmr/calendar/import` | admin | lecture seule par `xlsxGuard.loadWorkbook` + `sheetRows` ; renvoie `{ years:[…], errors:[{sheet,row,col,message}], unknownColumns:[…] }` pour revue ; rien n'est écrit avant « Enregistrer » (même schéma que PUT). |

Couches : `settings.routes.js` (zod) → `mmrCalendar.service.js` (règles, `activityCalendar.js`) → `mmrCalendar.repository.js` (seul SQL).

### 3.5 Écran — fenêtre « Calendrier d'activité » (depuis la grille MMR)

- **Grille MMR** :
  - nouvelle liste « Exercice » (année, défaut l'année courante) dans la barre d'outils ;
  - la cellule **Durée** affiche la durée effective et son badge de source : `calendrier 2026` (bleu, icône CalendarDays), `saisie` (gris, icône Pencil, info-bulle « pas de calendrier 2026 »), `manuelle` (orange, icône AlertTriangle, info-bulle = motif) ;
  - modifier la cellule ouvre une petite fenêtre « Durée manuelle » (valeur, motif obligatoire, « Revenir au calendrier ») ;
  - nouvelle colonne étroite **Calendrier** : bouton icône `CalendarDays` avec « 10 mois · 220 j » ou « — », qui ouvre la fenêtre.
- **Fenêtre** (`Modal`, dialogue large) :
  - titre « Calendrier d'activité — School meal activities », sous-titre « Plan général » ou le nom du bureau ;
  - onglets d'années (année courante sélectionnée ; années avec données en plus) ;
  - tableau *Mois* \| *Nombre de jours d'assistance* : champs numériques tabulaires, mois actifs teintés `--blue-50` ;
  - ligne *Total* ;
  - résumé « Durée réelle : 10 mois (janv.–juin, sept.–déc.) · 220 jours · 2 mois d'interruption ».
- **Aides** : « Copier l'année précédente », « Remplir les jours ouvrés (lun.–ven.) », « Tout le mois », « Vider l'année ».
- **Ligne d'un bureau sans calendrier propre** : calendrier hérité en lecture seule, bandeau « Hérité du plan général », bouton « Créer un calendrier propre à ce bureau ». Ce bouton crée la dérogation si elle n'existe pas, comme toute cellule modifiée sur un bureau.
- **Pied** : « Annuler » / « Enregistrer » (une année = une transaction). Fermer avec des modifications non enregistrées demande confirmation.
- Supprimer une dérogation (↺) ou une catégorie demande confirmation : « … et son calendrier (N mois renseignés) ».
- Lecture seule pour les non-administrateurs. Focus piégé, Échap, retour du focus au bouton (composant `Modal`).
- EN : `web/src/locales/en/settings.js` (« Activity calendar », « Assistance days », « Actual duration »…).

## 4. Risque daté et journal (retour 25)

### 4.1 Modèle

- **Deux attributs datés indépendants** :
  - `risk` : faible / moyenne / elevee ;
  - `security` : 0 / 1 / 3 / 99.

  Le banc de balayage du prototype a montré qu'une frise **commune** aux deux attributs perd la sécurité quand on change seulement le risque sur une plage qui contient un changement de sécurité. D'où une frise par attribut.
- **Frise** = points `(site, attribut, mois de début, valeur)`. La valeur au mois M = point de plus grand mois de début ≤ M, sinon la **valeur de référence** (`sites.risk_level` / `sites.security_situation`, qui gardent leur sens « valeur hors changement daté », affichée « depuis l'origine »).
- **Changement « du F au T »** (`applyRange`, pur) :
  1. pose un point à F ;
  2. supprime les points dans ]F, T] ;
  3. si T est donné, pose un point à T+1 qui rétablit la valeur qui était en vigueur à T+1 (sauf point déjà présent) ;
  4. « sans fin » = pas de point de fin.

  `compact` supprime ensuite les points qui répètent la valeur précédente. Propriété vérifiée par balayage (9 728 vérifications) : la valeur change exactement sur [F, T], nulle part ailleurs.
- **Zone** : site(s), commune (P-code ou nom), district (même clé que 1b `dkey`), bureau (antennes comprises), avec filtre facultatif d'activité. La zone est **matérialisée** en points par site (un lot de journal), pour qu'il n'y ait qu'une règle « risque du mois » (site seulement). Un site ajouté plus tard dans la zone garde sa valeur de référence ; l'écran le signale (question ouverte : réappliquer ?).
- **Imports** (classeur du plan de suivi : risque tiré du FINAL SCORE et sécurité ; registre *Locations* : sécurité) : pour un site **existant**, l'import pose un point au mois de l'import quand la valeur change (lot de journal source `import`, motif « Import <fichier> du <date> ») au lieu d'écraser la référence. Pour un site **créé**, la valeur importée devient sa référence.

### 4.2 Journal immuable, imposé par la base

- `risk_change_batches` : une action (qui, quand, source, portée, attribut, valeur, F, T, motif 5–500 caractères, sites touchés).
- `risk_change_log` : le détail par site (attribut, mois de début ou « référence », avant → après, opération ajout / modification / suppression de point), avec le code et le nom du site recopiés (le journal survit au site).
- Triggers :
  - `BEFORE INSERT/UPDATE/DELETE` sur `site_risk_points` et `BEFORE UPDATE OF risk_level, security_situation` sur `sites` : refusent (SQLSTATE 23514 → 400 « Le risque d'un site se modifie avec un motif ») toute écriture sans lot de journal dans la transaction (`current_setting('app.risk_batch', true)`), sauf suppression en cascade (site ou compte disparu) ;
  - `AFTER` : écrivent le détail du journal ;
  - `BEFORE UPDATE/DELETE` sur les deux tables du journal : refus, sauf cascade du compte.

  Rien ne contourne le journal : écran, import ou script.
- Le service pose `set_config('app.risk_batch', <id>, true)` et `set_config('app.user_id', <id>, true)` dans la transaction.

### 4.3 Module pur — `server/src/modules/tpm/riskTimeline.js`

`valueAt(points, reference, month)`, `riskAt(site, month)` → `{ risk, security, riskFrom, securityFrom, forbidden }`, `applyRange`, `applyResult`, `compact`, `planZoneChange(sites, change)` → `{ upserts, deletes, unchanged, affected, sample }`, `describeChange` (texte du journal). Jumeau SQL : `common/siteRiskSql.js`.

### 4.4 Lecture « risque du mois » partout — `server/src/modules/common/siteRiskSql.js`

- `riskAtJoin({ alias:'s', month: '$n' })` : deux `LEFT JOIN LATERAL (… ORDER BY from_month DESC LIMIT 1)` sur l'index `(tenant_id, site_id, attr, from_month DESC)` (une sonde par site) ; expressions `COALESCE(rr.value, s.risk_level)` et `COALESCE(rs.value::smallint, s.security_situation)`. Pour les lectures d'**un** mois.
- `riskSpansCte()` : `risk_spans AS MATERIALIZED (SELECT site_id, attr, from_month, lead(from_month) OVER (PARTITION BY site_id, attr ORDER BY from_month) AS next_month, value FROM site_risk_points WHERE tenant_id = $1)`. Pour les **plages** : faits 1b, générateur.
- Lecteurs basculés (même commit), chacun avec son mois :

| Lecteur | Mois |
|---|---|
| `RBM_SELECT`, `rbmRowsTx` (filtre `?risk=` sur la valeur du mois) | M (`rbmSitesTx`, explication, génération) |
| `planBoardTx` | mois de référence de l'exercice |
| `mapData` | mois courant ; dernier mois de la période au 6a |
| `coverageRecapSummary` | dernier mois de la plage |
| `tpm.repository.js:84,134` | mois courant |
| `siteActivitySql` (1b : `reg.forbidden` devient `forbidden` par mois dans `act`) | chaque mois de la plage |

La limite notée dans le 1b disparaît : marquer une zone interdite aujourd'hui ne réécrit plus le passé.

### 4.5 API — `server/src/modules/tpm/risk.routes.js` (monté `/api/tpm/risk`, avant `/api/tpm`)

| Méthode | Chemin | Droits | Contrat |
|---|---|---|---|
| GET | `/sites/:id?from=&to=` | lecture | `{ reference:{risk,security}, timeline:{ risk:[{from,value}], security:[…] }, months:[{month,risk,security}] (≤ 36), log:[…20 dernières] }` |
| POST | `/changes/preview` | admin, manager | corps = celui de `/changes` ; `{ affected, unchanged, sample:[{siteId,code,name,before,after}] (≤ 50), byValue }` ; rien n'est écrit |
| POST | `/changes` | admin, manager | `{ scope:{ kind:'sites'\|'commune'\|'district'\|'bureau', siteIds?:uuid[]≤5000, commune?, district?, officeId?, activity? }, attr:'risk'\|'security', value, from:'AAAA-MM'\|'origine', to:'AAAA-MM'\|null, reason:5..500 }` → `{ batchId, affected, unchanged }` ; > 5 000 sites → 400 « réduisez la zone » ; points écrits par lots multi-lignes (`chunkRows`) |
| GET | `/log?from=&to=&district=&siteId=&userId=&offset=&limit≤200` | lecture | lots paginés, détail à la demande (`/log/:batchId`) |
| GET | `/log.csv?…` | lecture | export (`common/csv`) |

`PATCH /api/tpm/field/sites/:id` avec `riskLevel` ou `security` exige désormais `riskReason` (400 `motif_requis` sinon) et passe par le même service (point « à partir du mois courant »). `bulkUpdateSites` (sécurité) et les deux imports aussi.

### 4.6 Écrans

- **Priorités du mois** :
  - la colonne Risque devient un badge (couleur + icône + libellé) de la valeur **du mois choisi**, avec « depuis 2026-03 » quand elle est datée ;
  - la liste déroulante en ligne (`setSiteRisk`) est remplacée par **« Modifier le risque… »**.
- **Fenêtre « Modifier le risque »** :
  - portée : ce site / sites de la commune X / du district Y / du bureau Z, et activité ;
  - attribut (niveau de risque, situation sécuritaire) et valeur ;
  - **du** (mois, ou « depuis l'origine ») **au** (mois ou « sans fin ») ;
  - motif obligatoire ;
  - aperçu « 142 sites · 37 déjà à cette valeur · exemples avant → après » ;
  - « Enregistrer ».
- **Panneau « Risque du site »** : frise des 24 derniers mois (une case par mois, couleur + icône + libellé au survol), changements datés, 20 dernières lignes du journal.
- **Nouvel onglet RBM « Journal des risques »** (icône History) : lots en tableau (date, auteur, portée, attribut, valeur, période, motif, sites), détail dépliable, filtres, CSV. Aucun bouton modifier / supprimer.

## 5. Règles de priorité configurables (retours 24 et 48)

### 5.1 Modèle — « ma réponse à : trouve une bonne façon de paramétrer »

Une table ordonnée par compte, évaluée pour chaque site et chaque mois M comme un `CASE WHEN` :

| # | Libellé | Si (condition) | Alors niveau | Pourquoi (motif) | Que faire (facultatif) |
|---|---|---|---|---|---|

- La **première** règle vraie décide. Faux ou **indéterminé** (donnée manquante) → règle suivante, compté « indéterminé » dans l'aperçu. **Sinon** en dernière ligne, toujours présent.
- **Niveaux** : `haute`, `moyenne`, `basse` (à suivre ce mois, sélectionnés), `non` (pas ce mois), `exclu` (jamais proposé ni généré). Couleur + icône + libellé (`web/src/lib/priority.js`) : Haute rouge AlertTriangle, Moyenne orange CircleDot, Basse verte ArrowDownCircle, Pas ce mois grise CheckCircle2, Exclu grise Ban.
- **Motif** et **action** : gabarits de 300 caractères au plus, avec `{variable}`. Ils sont rendus côté serveur, en texte seul : une énumération s'affiche par son libellé, un mois en AAAA-MM, une valeur vide par « — ».
- **Variables calculées** (20 au plus, ordonnées) : formules évaluées avant les règles, qui permettent un barème à points sans second mécanisme (ex. `points = 2*fraude + probleme_cfm`). Un nom ne peut ni masquer une variable du catalogue ni lire une variable définie plus bas.
- **Mode expert** (même stockage) : une expression de niveau `ifs(...)` ou `case(...)` et une expression de motif `concat(...)`. En mode table, la « formule équivalente » `ifs(...)` est toujours affichée en lecture seule.
- **Portée** par activité ou bureau dans la condition (`in(activite, …)`, `bureau_code = …`) ; une seule table par compte, sans héritage, pour que le « pourquoi » se lise à un seul endroit.
- **Limites** : 50 règles, condition ≤ 500 caractères, expression experte ≤ 2 000, profondeur ≤ 64 (déjà dans le parseur).

### 5.2 Garde-fous non configurables (appliqués après les règles)

Pour qu'un site soit « à planifier » à M, il faut : niveau sélectionné **et** aucun garde-fou. Les garde-fous sont :
- zone interdite à M (sécurité datée 99) ;
- inactif à M (`activeAt` du 1b) ;
- visite annulée à M ;
- visite prévue ou réalisée à M ;
- activité hors calendrier à M (calendrier connu et 0 jour) ;
- pour le générateur seulement, pas de ligne MMR.

Mêmes définitions que `rbmMath.needsPlanning` (étendu du calendrier), une seule fonction pure `planningGuards(site, M)` rendue dans l'explication.

### 5.3 Catalogue des variables (servi par l'API, affiché dans l'éditeur avec source et fiabilité)

| Groupe | Variables | Source | Fiabilité aujourd'hui |
|---|---|---|---|
| Contexte | `mois`, `mois_num`, `annee` | requête | fiable |
| Registre | `site_code`, `nom`, `region`, `district`, `commune`, `commune_pcode`, `bureau`, `bureau_code`, `bureau_parent_code`, `activite`, `type_poi`, `modalite`, `beneficiaires` | `sites`, `field_offices` | fiable ; activité non normalisée (13 valeurs) jusqu'au lot 2 |
| Risque daté (§4) | `risque`, `risque_depuis`, `securite`, `zone_interdite`, `risque_modifie_3m` | frises + référence | fiable (référence « moyenne » par défaut ≠ « évalué ») |
| Critères RBM (classeur N:X) | `synergies`, `beneficiaires_plus_200`, `nouveau_partenaire`, `experience_partenaire`, `probleme_suivi_interne`, `probleme_rapport_partenaire`, `probleme_cfm`, `fraude` | `sites` | partiel (0 = aussi « non évalué ») |
| Score (`rbmScore`) | `points_risque`, `score_final`, `score_final_libelle`, `urgent` (= **recommandation urgente** : problème à 2, fraude ≥ 1, sécurité 3), `signaux_urgents` | calculé | comme les critères |
| Visites (lot 1) | `derniere_visite`, `source_derniere_visite`, `mois_depuis_visite`, `jamais_visite`, `prevu_ce_mois`, `realise_ce_mois`, `annule_ce_mois`, `prochaine_visite_prevue`, `visite_prevue_en_retard` | `lastVisitOf` / `plannedVisits` | fiable (définition commune) |
| Données | `donnees_mois`, `donnees_3_mois`, `dernier_mois_donnees`, `mois_depuis_donnees` | soumissions (site, sinon commune) | partiel (lot 4) |
| Activation | `actif`, `grille_connue` | 1b `activeAt` | à venir (lot 3) |
| Calendrier (§3) | `activite_en_cours`, `jours_assistance_mois`, `duree_activite`, `source_duree` | `effectiveMmr` | à venir (saisie) |
| MMR | `mmr_parametre`, `intervalle_rbm`, `intervalle_mmr`, `intervalle_mmr_ajuste`, `intervalle_effectif`, `visites_exigees_annee`, `cible_mois`, `capacite_mois` | `effectiveMmr` + objectif (§6) | fiable si paramétré |
| Année | `visites_faites_annee`, `visites_prevues_annee`, `reste_a_faire` | `planBoard.siteCounters` | partiel |
| Projection (générateur seul) | `couvert_periode` | état projeté | — |

`intervalle_effectif` est l'intervalle de revisite du plan (§7.3). Il est défini une seule fois (`planSettings.effectiveInterval`) et sert aux règles comme au générateur.

### 5.4 Modèles fournis (dans le code, versionnés par nom)

**`mems-defaut-1` — identique au calcul actuel** (actif tant que le compte n'a pas activé de version) :

| # | Libellé | Condition | Niveau | Motif |
|---|---|---|---|---|
| 1 | Zone interdite | `securite = 99` | exclu | Zone interdite (sécurité 99) : suivi à distance uniquement |
| 2 | À suivre — signal urgent ou score élevé | `(jamais_visite = 1 OR mois_depuis_visite >= intervalle_rbm) AND (urgent = 1 OR score_final = 2)` | haute | Dernière visite {derniere_visite} (il y a {mois_depuis_visite} mois, intervalle {intervalle_rbm}) ; score {score_final_libelle}{signaux_urgents} |
| 3 | À suivre — échéance atteinte ou jamais visité | `jamais_visite = 1 OR mois_depuis_visite >= intervalle_rbm` | moyenne | Dernière visite {derniere_visite} : intervalle de {intervalle_rbm} mois atteint (risque {risque}) |
| — | Sinon | — | non | À jour : dernière visite {derniere_visite} (intervalle {intervalle_rbm} mois) |

**Preuve** : on a fait tourner le vrai `field.repository.rbmSites` (sous `mems2_app`, en lecture seule) pour 11 mois, de 2025-11 à 2027-03, et on l'a comparé à la table ci-dessus suivie des garde-fous.
- Sur 14 080 site × mois, on trouve **0 écart** sur « à suivre », 0 sur « à planifier » et 0 sur la priorité des sites sélectionnés.
- Octobre 2026 : 20 haute, 1 238 moyenne, 22 pas ce mois.
- Les tests reprennent cette preuve sur une grille exhaustive (risque × retard × critères).

**`mems-mmr-1` — proposition pour le plan réaliste** (brouillon proposé, jamais activé d'office). Variable calculée `intervalle = coalesce(intervalle_effectif, intervalle_rbm)`, puis les règles :

| # | Libellé | Condition | Niveau |
|---|---|---|---|
| 1 | Zone interdite | `securite = 99` | exclu |
| 2 | Recommandation urgente | `urgent = 1 AND (jamais_visite = 1 OR mois_depuis_visite >= 1)` | haute (motif : `{signaux_urgents}`) |
| 3 | Jamais suivi | `jamais_visite = 1` | haute |
| 4 | Échéance MMR + score élevé | `mois_depuis_visite >= intervalle AND score_final = 2` | haute |
| 5 | Échéance MMR | `mois_depuis_visite >= intervalle` | moyenne |
| 6 | Pas encore suivi sur la période | `couvert_periode = 0` | basse (« objectif {objectif_couverture} % ») |
| — | Sinon | — | non |

### 5.5 Moteur — ajouts à `monitoring/calcFields.js` (catalogue unique, donc éditeur et page « Comment les calculs sont faits » à jour d'office)

- `ifs(c1, v1, c2, v2, …, [sinon])` : première condition vraie ; condition vide ignorée (comme `CASE WHEN NULL`) ; argument final impair = sinon ; 2 à 51 arguments.
- `case(valeur, v1, r1, …, [sinon])` : comparaison `sameValue` (nombres, ou textes sans tenir compte de la casse) ; une valeur vide ne correspond à rien.
- `months_between(debut, fin)` : sur AAAA-MM ou AAAA-MM-JJ, renvoie fin − début (peut être négatif) ; vide si un côté l'est ; nouvelle catégorie « Dates ».
- `checkExpression(expr, { fields, strict, subject:'site' })` : avec `strict`, une variable inconnue est une **erreur** (« inconnue des variables du site — vouliez-vous dire … ») ; sans `strict`, le comportement actuel reste inchangé (non-régression).
- Passe de types dans `priorityRules.js` (sur l'AST) : littéral hors des choix d'une énumération (`risque = "Elevee"`, `securite = 2`), comparaison d'un nombre à un texte, `{x}` inconnu dans un motif, référence avant. Utile parce que `=` sur du texte respecte la casse, alors que `in()` et `case()` l'ignorent.

### 5.6 Versions et stockage (migration 067)

- **Tables** :
  - `priority_rule_sets` : version, statut `brouillon | active | archivee`, mode `table | expression`, expressions expertes, sinon (niveau + motif + action), modèle d'origine, note de changement (obligatoire pour activer), révision (verrou optimiste), auteurs et dates ;
  - `priority_rule_vars` ;
  - `priority_rules` : position, libellé, condition, niveau, motif, action, activée.
- **Contraintes** :
  - CHECK sur les niveaux, recopiés de `priorityRules.LEVELS` (un test statique compare) ;
  - index uniques partiels : une seule `active` et un seul `brouillon` par compte.
- **Triggers** :
  - contenu figé hors brouillon (23514) ;
  - transitions permises : brouillon → active → archivée ;
  - suppression réservée aux brouillons.
- `site_visits` gagne l'**instantané** de la décision : `priority_level`, `priority_reason`, `priority_rule_set_id`, `priority_rule_label` (CHECK : niveau et motif tous deux nuls ou tous deux renseignés). Une visite garde à jamais pourquoi elle a été planifiée.
- Un mois passé s'évalue avec la version **active** du moment, affichée « simulation ».

### 5.7 Chargeur des variables — `field.repository.siteVariablesTx(client, tenantId, month)`

- Les lignes RBM (`rbmRowsTx` étendu du risque du mois) sont complétées par trois requêtes bornées `GROUP BY` : visites du mois et de l'exercice, données du mois et des 3 mois, grille de l'année. L'assemblage par identifiant de site se fait en JS (`priorityCatalog.assembleSiteVariables`, pur).
- On évite volontairement une seule grosse requête. Sous RLS, le planificateur estime 1 à 6 lignes là où il y en a 1 280, choisit des boucles imbriquées et rejoue des sous-plans hachés 1 280 fois. Mesuré : 2,3 à 3,1 s, et plus de 20 s sur 12 mois, contre 28–45 ms en requêtes séparées.
- Le banc garde la règle du 1b : pas de `Nested Loop` à plus de 1 000 boucles sur un `CTE Scan`.

### 5.8 API — `server/src/modules/tpm/priority.routes.js` (monté `/api/tpm/priority`)

Lecture : tous ; écriture : admin et manager ; compte tiré de `req.auth` uniquement.
- `GET /variables` : le catalogue.
- `GET /templates` : `mems-defaut-1`, `mems-mmr-1`.
- `GET /rule-sets` : versions, plus `effective {source, version}`.
- `GET /rule-sets/current`, `GET /rule-sets/:id`.
- `POST /rule-sets/draft {from:'active'|'mems-defaut-1'|'mems-mmr-1'|uuid}` → 201 ; 409 si un brouillon existe (`details.id`).
- `PUT /rule-sets/:id` (brouillon seulement, `revision` exigée) : 400 `{errors:[{where,index,field,message,at}]}` sans aucune écriture ; 409 si la révision est périmée ; remplacement par deux INSERT multi-lignes.
- `POST /rule-sets/:id/activate {changeNote:1..1000}` : verrou `FOR UPDATE` sur les versions du compte, l'active passe archivée, la contrainte unique sert de filet (23505 → 409).
- `DELETE /rule-sets/:id` : brouillon seulement.
- `POST /preview {month, set?|ruleSetId?, compare:'active'|'none'}` : niveaux, par règle (retenus, indéterminés), matrice ancien → nouveau, 20 exemples, sélection par ligne MMR comparée à la capacité. Rien n'est écrit.
- `POST /check {kind:'condition'|'var'|'reason'|'action', text, vars?, month?}` : `{check, matched}` (« 412 sites vérifient cette condition en oct. 2026 »).
- `GET /explain?siteId&month&ruleSetId?` : la trace.

**Endpoints existants modifiés** :
- `GET /api/tpm/field/rbm/sites` ajoute `level`, `levelLabel`, `reason`, `action`, `ruleLabel`, `rulePosition`, `ruleSet{id,version,source}`. On garde `due` = niveau sélectionné, `toPlan` = sélectionné et sans garde-fou, et les champs du score à l'identique.
- `POST /api/tpm/field/rbm/generate?month&levels=haute,moyenne,basse&risk=` (zod) : mêmes verrous et même `INSERT … NOT EXISTS` qu'aujourd'hui, avec l'instantané de la décision ; réponse enrichie de `byLevel` et `ruleSet`. Il reste **sans capacité** : le plan réaliste (§7) est le seul endroit où la capacité est calculée, et la fenêtre « Générer » y renvoie (« Plan réaliste pour ce mois → »).

### 5.9 « Pourquoi ? / Que faire ? » (retour 48)

`GET /api/tpm/field/rbm/sites/:id` ajoute :

```json
"priority": {
  "level": "haute",
  "ruleLabel": "À suivre — signal urgent ou score élevé",
  "rulePosition": 2,
  "reason": "Dernière visite 2026-03 (il y a 7 mois, intervalle 1) ; score Élevé ; fraude suspectée",
  "action": null,
  "ruleSet": { "id": "…", "version": 3, "source": "tenant" },
  "trace": [
    { "position": 1, "label": "Zone interdite", "condition": "securite = 99", "result": "faux", "inputs": { "securite": 0 } }
  ],
  "guards": [ { "code": "inactif", "ok": true, "label": "Actif en 2026-10" } ],
  "toPlan": true
}
```

- `RbmExplain.jsx` gagne une 4ᵉ partie, « Règle appliquée » : la règle, le motif, la version (avec un lien vers l'éditeur), la trace dépliable et les garde-fous.
- « Que faire ? » commence par l'action de la règle, puis les actions du lot 1 (fraude, sécurité, problèmes, visite prévue en retard).
- `recommendedActions` reçoit « à suivre » de la décision des règles (une seule définition) au lieu de `scoreSite.due`.

### 5.10 Éditeur — onglet RBM « Règles de priorité » (`PriorityRulesPage.jsx`)

- **Barre de versions** : « Actives : v3 — par … le … — note », historique avec comparaison et « Repartir de cette version », bouton « Modifier » (crée ou ouvre le brouillon).
- **Variables calculées** : section repliable.
- **Table de règles** :
  - poignée de glisser et boutons ↑/↓ (clavier) ;
  - interrupteur activée, libellé, condition en code, niveau (badge), motif, action ;
  - ligne Sinon figée en bas.
- **Fenêtre d'une condition** : `FormulaEditor` généralisé (props `variables`, `usePreview`, `PreviewPanel`), avec :
  - les variables du site et leurs choix (« 0 = Pas de restriction · … ») ;
  - les fonctions, dont `ifs`, `case`, `months_between` ;
  - la vérification en direct ;
  - la ligne « 412 sites en oct. 2026, dont 380 déjà retenus plus haut ; 0 indéterminé ».
- **Motif / action** : puces `{variable}` à insérer, rendu en direct sur un site exemple.
- **Panneau « Simulation »** (mois, `MonthSelect`) : barres par niveau, comptes par règle, matrice ancien → nouveau, sites qui changent, sélection par activité comparée à la capacité MMR.
- **Autres actions** :
  - « Tester sur un site » : recherche, puis la trace ;
  - « Formule équivalente » (`ifs`) ;
  - « Activer » : note obligatoire.
- Lecture seule sans droit d'écriture.
- Page `CalcDocsPage` : nouvelle section « Priorités du mois : règles » (ordre, indéterminé, niveaux, tables servies par l'API, si/sinon et `ifs`/`case`, casse de `=`).

### 5.11 Changements visibles (à annoncer au journal)

- **Plan de suivi** : la colonne Priorité passe aux règles, au mois de référence de l'exercice. Sur la démonstration, 235 sites sur 1 280 changent : Basse → Moyenne 207, Basse → Pas ce mois 11, Moyenne → Pas ce mois 11, Moyenne → Haute 6. C'est voulu : le tableau ignorait l'intervalle, et cela supprime une deuxième définition de la priorité.
- **Priorités du mois** :
  - colonnes Priorité, Motif et Règle (masquée par défaut) ;
  - tuiles Haute / Moyenne / Basse / Pas ce mois / Exclus ;
  - libellés de sécurité 3/99 corrigés (affichés vides aujourd'hui) et fenêtre des critères proposant 0/1/3/99.

## 6. Paramètres du plan (retour 55-2)

### 6.1 Valeurs initiales et leur source

Par activité, les paramètres restent dans la grille MMR (une seule saisie). Les paramètres globaux sont dans `plan_settings` ; s'il n'y a pas de ligne, les défauts du code s'appliquent (`planSettings.DEFAULTS`, recopiés par la migration, comparés par un test statique).

| Paramètre | Où | Valeur initiale | Source affichée (puce + info-bulle) |
|---|---|---|---|
| Catégorie d'activité, portée bureau | grille MMR | import | classeur RBM, Overreaching Parameters!D2:D10 et B2:B10 |
| Durée d'opération (mois) | grille MMR / calendrier | calendrier de l'année, sinon E | calendrier ; sinon Overreaching Parameters!E (E5 = 9 pour les repas scolaires d'Ampanihy) |
| Nombre de sites | grille MMR (info) ; **générateur : sites éligibles du registre** | registre | Overreaching Parameters!F = COUNTIFS sur le classeur lié [2] *Co-Monitoring* (L = catégorie, B = bureau), résultat absent → référentiel ; un écart > 10 % entre MMR et registre est signalé |
| Risque MMR (1–3) | grille MMR | G | Overreaching Parameters!G (« 1=Low 2=Medium 3=High ») |
| Intervalle, fréquence, ciblé | dérivés | — | H = E/G, I = E/H, J = F/H (commentaires H1, J1) |
| Faisable / mois | grille MMR | K | Overreaching Parameters!K (K5 = 30, K6 = 12, K7 = 10) |
| Couverture, fréquence et intervalle ajustés | dérivés | — | L/O = K/J, M = I × L, N = MAX(E/M, 1) |
| Personnes, suivis/jour/personne, jours ouvrés | grille MMR | vides ; suivis/j = 3 (1 pour les transferts) sur votre écran | **absents du classeur** ; colonnes MEMS (migration 030) ; capture MMR du 14/10 |
| Suivis/jour par défaut (si non renseigné) | plan_settings | 1 | choix MEMS (prudent) |
| Objectif | plan_settings | `auto` | retour 55 (« tous les sites selon le MMR … ou un minimum de 80 % ») + logique K/J du classeur |
| Part minimale de sites couverts sur la période | plan_settings | 80 % | retour 55 |
| Niveaux à planifier | plan_settings | haute, moyenne, basse | règles de priorité (§5) |
| Rattrapage de couverture (sites non dus mais jamais couverts) | plan_settings | oui | retour 55 (80 %) |
| Journée = même lieu / même commune / même district | plan_settings | commune | retour 55 (« même commune, même district ») |
| Compléter la tournée dans le district | plan_settings | oui | retour 55 |
| Journées multi-activités | plan_settings | oui | retours 55, 57 (un lieu = plusieurs sites, un par activité) |
| Limiter aux jours d'assistance du mois | plan_settings | oui | calendrier (retour 55) |
| Marge de capacité | plan_settings | 100 % | choix MEMS |
| Jours de déplacement par tournée | plan_settings | 0 | choix MEMS (même notion que `tpm_collection_days.travel_days`) |
| Écart minimal entre deux visites d'un site urgent | plan_settings | 1 mois | choix MEMS |
| Anticipation (combler une journée avec un site dû d'ici N mois) | plan_settings | 0 (désactivée) | choix MEMS |
| Fréquence RBM par risque (élevé, moyen, faible) | code (`rbmMath`) | 1, 2, 3 mois | choix MEMS, lecture seule ici |
| Champs du site (sécurité, problèmes, fraude, dernière visite, statut mensuel) | registre | classeur | Locations Management!N:X, T, AL:AW (§2.2) |

**Objectif** (par activité et par année, fonction pure `effectiveInterval`) :
- `mmr_complet` : intervalle de revisite = intervalle MMR (E/G) ;
- `couverture` : une visite par site et par période d'activité (sauf site urgent) ;
- `auto` : `mmr_complet` si la capacité couvre le ciblé (couverture K/J ≥ 1), sinon max(intervalle MMR, intervalle ajusté N) ; l'aperçu affiche le mode retenu et sa raison.

### 6.2 Stockage (migration 068)

`plan_settings(tenant_id PK, …)` : colonnes typées avec CHECK (bornes ci-dessus), `revision`, `updated_by`, `updated_at`. Chaque exécution du générateur garde une **copie** des paramètres utilisés (§7.9).

### 6.3 API et écran

- `GET /api/tpm/plan/settings` → `{ settings, defaults, sources:{clé:{label, cell?}}, revision }`.
- `PUT /api/tpm/plan/settings` (admin) `{…, revision}` → 409 si la révision est périmée.
- Carte « Paramètres du générateur de plan » sous la grille MMR (onglet Exigences) :
  - deux colonnes ; chaque champ avec sa puce de source (icône FileSpreadsheet + « Overreaching Parameters!N » / MessageSquare + « retour 55 » / Cpu + « MEMS ») ;
  - marque « modifié » quand le champ diffère du défaut ;
  - « Rétablir les valeurs initiales » ;
  - lecture seule pour les non-administrateurs.

## 7. Générateur de plan réaliste (retour 55-2)

### 7.1 Contrat du module pur — `server/src/modules/tpm/planGenerator.js`

```
generatePlan({ horizon:{from,to}, firstMonth, sites, pools, rules, evaluate, params }) →
  { months:[{ month, tours:[{ district, travelDays, stops:[{ commune, days:[{ used, visits:[{siteId, pool, why, level, rule, reason}] }] }] }],
              capacity:{ pool:{ visits, usedVisits, existing, days, usedDays, over } } }],
    sites:[{ siteId, planned:[{month, why, level, rule, reason}], codes:'…' (un code par mois), main:{code, month, detail} }],
    projection:{ pool:{ eligible, coveredExisting, covered, generatedNewSites, generatedVisits, share, target, meetsTarget,
                        requiredMmrVisits, capacityVisits, missingVisits, extraPersons } },
    warnings:[…] }
```

**Entrées** (préparées par `planInputs.js`, pur, depuis le chargeur §7.7) :
- **site** :
  - identité : `id`, `code` (clé de tri unique) ;
  - clés de regroupement : `placeKey` (code de lieu du lot 3 s'il existe, sinon P-code du fokontany, sinon commune + nom normalisé), `communeKey`, `districtKey` (mêmes clés que 1b) ;
  - `poolKey` = ligne MMR effective (bureau → parent → général) ;
  - `lastReal` (lot 1 `lastVisitOf`, avant l'horizon) et `urgent` ;
  - `scopeBase` : variables indépendantes du mois ;
  - `months[M] = { active, forbidden, risk, security, visit: null|planifie|realise|annule }`.
- **pool** (activité × portée MMR, pour l'année de chaque mois) :
  - `vpd` = suivis/jour (sinon le défaut) ;
  - `visitsCap[M]` = ⌊faisable effectif(M) × marge⌋, où faisable effectif = personnes × vpd × jours(M), avec jours(M) = min(jours ouvrés, jours d'assistance(M)) si la limite est active, sinon le faisable saisi ;
  - `dayCap[M]` = personnes × jours(M) × marge, ou `null` quand personnes ou jours sont inconnus (alors seule la capacité de visites borne) ;
  - `running` = mois actifs du calendrier (`null` = inconnu = tous) ;
  - `gate[M]` = intervalle de revisite (§7.3).

### 7.2 Algorithme (déterministe : sites triés par code, ordre total partout, aucune horloge ni hasard)

Pour chaque mois M de l'horizon, dans l'ordre :

1. **Capacité du mois** par pool : 0 si l'activité ne tourne pas à M. Capacité de visites et jours-personne en **unités entières** : 1 jour = 252 000 unités, divisible pour 0,5 / 1 / 1,5 / 2 / 2,5 / 3 … 10 suivis par jour ; coût d'une visite = ⌈252 000 ÷ vpd⌉. Jamais de flottant.
2. **Engagements existants** (prévue ou réalisée à M) : ils sont placés d'abord, consomment la capacité et ouvrent leurs journées. Un dépassement par des engagements existants est **signalé** (`over`), jamais corrigé en silence. Ils mettent à jour la dernière visite **projetée** et la couverture.
3. **Candidats** : pour chaque site, dans l'ordre des garde-fous (§5.2), puis l'intervalle de revisite (`intervalle` si mois depuis la dernière visite projetée < `gate`, sauf urgent avec l'écart minimal urgent). Puis les **règles** sur le scope du mois, avec la dernière visite projetée (une visite planifiée par le générateur compte comme faite pour les mois suivants de la projection — et seulement là, c'est écrit dans l'aperçu) :
   - `exclu` → code `exclu_regle` ;
   - niveau sélectionné → candidat ;
   - sinon, s'il n'est pas couvert sur la période et que le rattrapage est actif → candidat **couverture** ;
   - sinon `non_du`.
4. **Classement** (clé totale) : recommandation urgente d'abord, niveau décroissant, sélectionné par règle avant couverture, pas encore couvert, mois depuis la dernière visite décroissant (jamais visité en tête), puis district, commune, lieu, code.
5. **Quota de couverture** par pool : ⌈max(0, ⌈80 % × éligibles⌉ − couverts) ÷ mois actifs restants⌉. Il est lissé sur les mois restants, pour ne pas tout consommer au premier mois.
6. **Placement par paliers**, chaque placement réussi tirant aussitôt ses voisins :
   - les paliers :
     - palier 0 : urgents et Haute ;
     - palier 1 : Moyenne ;
     - palier 2 : Basse ;
     - palier 3 : couverture (dans la limite du quota) ;
   - pour chaque candidat du palier, dans l'ordre : placer (ancre), puis remplir :
     1. **même lieu** : toutes activités sélectionnées, l'équipe y est déjà ;
     2. **même commune** : candidats des paliers ≤ courant ;
     3. **même district** : communes les plus fournies d'abord, paliers ≤ courant ;
   - un candidat moins prioritaire ailleurs ne passe jamais avant un candidat plus prioritaire : les paliers sont traités dans l'ordre ;
   - **placer** :
     - si la capacité de visites du pool est épuisée → `capacite_visites` ;
     - sinon, la visite va dans une **journée ouverte** de la même étape (commune) qui a la place. Si les journées multi-activités sont désactivées, seulement une journée ouverte par le même pool ;
     - sinon on ouvre une journée : 1 jour-personne imputé au pool de la visite, plus les jours de déplacement à l'ouverture d'une tournée. Si le pool n'a plus assez de jours-personne → `capacite_jours`.
7. **Anticipation** (option, désactivée par défaut) : un site dû d'ici N mois n'est ajouté **que dans la place restante** d'une journée déjà ouverte, sans en ouvrir de nouvelle, et seulement après tous les paliers.

**Invariants**, testés et vérifiés sur le banc (0 violation) :
- au plus une visite par site × mois ;
- jamais de visite sur un site × mois soumis à un garde-fou ;
- jamais plus de visites générées que la capacité ;
- jamais de journée remplie au-delà de 100 % ;
- intervalle de revisite respecté (sauf écart urgent) ;
- résultat identique d'une exécution à l'autre et quel que soit l'ordre d'entrée des sites (empreinte SHA-256 du résultat).

### 7.3 Capacité, journées et intervalle — règles choisies

- « Nombre de suivis par jour par activité » = `visitsPerDay` de la ligne MMR. Une visite de repas scolaire (3/jour) coûte 1/3 de journée, une visite de traitement (2/jour) 1/2. Une journée peut porter 1 repas scolaire + 1 traitement (5/6), pas un 3ᵉ site de prévention (1/3 de plus).
- **Jours-personne** : chaque journée ouverte coûte 1 jour-personne à l'activité qui l'ouvre ; les visites d'autres activités qui s'y ajoutent consomment leur propre capacité de visites. Un site isolé coûte donc une journée entière, et regrouper libère de la capacité : c'est l'incitation à regrouper.
- **Intervalle de revisite** = `intervalle_effectif` (§6.1), défini une fois et partagé avec les règles.
- **Pools** = ligne MMR effective : une ligne du plan général héritée par plusieurs bureaux est **une** capacité commune, comme le pied du Plan de suivi aujourd'hui (`planBoard.mmrCapacity`). Question ouverte : capacité par bureau ?

### 7.4 Tournées

- **Tournée** = district × mois.
- **Étape** = commune (ou lieu, ou district, selon le paramètre « journée = »).
- **Journée** = une équipe-jour dans une étape.

L'aperçu les numérote (« Tournée 3 — Ambovombe-Androy : 4 communes, 7 journées, 18 visites »). Le prestataire TPM n'est **pas** choisi par le générateur : à l'enregistrement, chaque visite reprend le TPM de sa zone (retour 58, « valeurs par défaut des contrats ») si ce lot est livré, sinon aucun.

### 7.5 Projection de couverture (par activité, puis totale)

- éligibles = sites actifs au moins un mois d'activité de l'horizon et hors zone interdite tout l'horizon ;
- déjà couverts = visite réalisée ou prévue pendant un mois d'activité de l'horizon ;
- générés = nouveaux sites couverts par le plan ;
- part et objectif (⌈80 % × éligibles⌉), atteint ou non ;
- visites exigées par le MMR sur la période et visites planifiées ;
- capacité de la période (visites, jours-personne) et capacité utilisée ;
- **manque** = visites nécessaires − capacité restante, et son équivalent « ≈ +N personne(s) » = ⌈manque ÷ (vpd × jours × mois actifs restants)⌉ (affiché seulement si vpd et jours sont connus) ;
- courbe de couverture cumulée mois par mois.

**Exemple avec les valeurs de votre écran MMR** (capture du 14/10, faisable saisi, 80 %) :

| Catégorie | Durée | Sites | Risque | Faisable/mois | Interv. | Ciblé/mois | Couverture | Interv. ajusté | Capacité période | Sites couverts au mieux | 80 % = | Manque |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Asset creation | 3 | 9 | 1 | 1 | 3 | 3 | 33 % | 9 | 3 | 33 % | 8 | 5 |
| Malnutrition prevention | 6 | 54 | 1 | 4 | 6 | 9 | 44 % | 13,5 | 24 | 44 % | 44 | 20 |
| Nutrition treatment | 9 | 271 | 2 | 27 | 4,5 | 60,2 | 45 % | 10,04 | 243 | 90 % | 217 | atteint |
| School meal | 10 | 824 | 2 | 52 | 5 | 164,8 | 32 % | 15,85 | 520 | 63 % | 660 | 140 |
| Smallholder | 3 | 16 | 1 | 2 | 3 | 5,3 | 38 % | 8 | 6 | 38 % | 13 | 7 |
| Unconditional transfers | 6 | 39 | 2 | 4 | 3 | 13 | 31 % | 9,75 | 24 | 62 % | 32 | 8 |

Sur la structure réelle du registre d'activation (2 872 sites, 328 communes, 31 districts), complétée à 3 000 sites (1 325 repas scolaires éligibles), avec ces capacités et un calendrier d'année scolaire :
- le générateur place exactement la capacité (520 visites de repas scolaires sur 10 mois) ;
- il projette 39 % de couverture pour cette activité (520 sur 1 325) ;
- regrouper fait passer de 1,1 à **2,7 visites par journée** quand les jours-personne bornent (766 visites contre 317 sans regroupement, pour les mêmes jours-personne).

### 7.6 Explications (codes, libellés FR/EN, icône + libellé)

| Choisi pourquoi (`why`) | Libellé |
|---|---|
| `urgent` | Recommandation urgente : {signaux} |
| `regle` | Règle « {libellé} » : {motif} |
| `meme_lieu` | Même lieu qu'une visite planifiée (multi-activités) |
| `meme_commune` | Même commune qu'une visite planifiée |
| `meme_district` | Même district (tournée) |
| `couverture` | Objectif de couverture : pas encore suivi sur la période |
| `anticipee` | Anticipée : dû le mois prochain, place libre dans la journée |

| Reporté pourquoi (code par mois) | Libellé |
|---|---|
| `capacite_visites` | Capacité de visites de l'activité atteinte ce mois (52/52) |
| `capacite_jours` | Jours-personne de l'activité épuisés ce mois (18/18) |
| `quota_couverture` | Quota de couverture du mois atteint (réparti sur les mois restants) |
| `intervalle` | Dernière visite (projetée) {m} : intervalle de revisite {g} mois non atteint |
| `hors_calendrier` | L'activité ne tourne pas ce mois (0 jour d'assistance) |
| `inactif` | Site inactif ce mois (grille d'activation) |
| `zone_interdite` | Zone interdite ce mois (sécurité 99) |
| `annulee` | Visite annulée ce mois : décision respectée |
| `deja_prevue` | Visite déjà prévue ou réalisée ce mois |
| `exclu_regle` | Exclu par la règle « {libellé} » |
| `non_du` | Pas prioritaire ce mois : règle « {libellé} » ({motif}) |
| `sans_mmr` | Activité sans paramètre MMR |

**Raison principale** d'un site non planifié = le code le plus « actionnable » de l'horizon. L'ordre de préférence est : capacité, quota, intervalle, non dû, exclu, calendrier, inactif, zone, annulée, sans MMR. Le détail mois par mois est toujours disponible.

### 7.7 Chargeur — `plan.repository.loadPlanInputsTx(client, tenantId, { period, officeId?, activities? })`

Cinq requêtes bornées, **séquentielles sur le même client** (jamais `Promise.all`), assemblées en JS par `planInputs.assemble` (pur) :

1. registre (une ligne par site, bureau et parent) ;
2. faits 1b `siteMonthFactsCtes` réduits aux cases non triviales (`st` non nul ou inactif) ;
3. dernière visite réalisée avant l'horizon (`GROUP BY site_id`) ;
4. mois de données par site ;
5. mois de données par commune × activité de fiche (règle du lot 1, pré-agrégée).

Puis, petites : points de risque du compte, lignes MMR, calendriers des années de l'horizon, paramètres, version de règles.

Mesures :
- **28–45 ms** sur 1 280 sites, de 1 à 24 mois.
- Parité avec `RBM_SELECT` : dernier mois de données **0 écart sur 1 280 sites** (346 avec données) ; dernière visite effective 0 écart.

Ces requêtes portent la règle de « réalisé » du lot 1 sous forme pré-agrégée. Le lot 4 la remplacera **ici et dans `RBM_SELECT` dans le même commit**, avec ce test de parité (§12).

### 7.8 Exécution

- Le chargeur tourne dans la requête (SQL asynchrone). Le calcul part dans un **fil de calcul** de l'API (`server/src/jobs/planThread.js`, entrée `worker_threads`) :
  - réserve de 1 à 2 fils, créés à la demande ;
  - délai de 30 s, au-delà → 503 « réessayez » ;
  - données passées par clonage structuré ;
  - le fil n'ouvre **aucune** connexion : un seul pool pg.
- Mesuré (3 000 sites × 12 mois) : calcul 172–274 ms, aller-retour 253–416 ms, boucle d'événements libre (21 à 37 tops de 10 ms pendant le calcul).
- Pourquoi pas BullMQ par défaut : Redis est optionnel sur la cible Windows, et le calcul tient sous la seconde. Le gestionnaire est pur (`planJob.run(input)`), donc branchable sur une file « tpm-plan » sans changement si le volume l'exige (question ouverte).
- Garde de volume : sites × mois > 240 000 (≈ 10 000 × 24) → 422 « horizon trop large ».

### 7.9 Aperçu, empreinte, enregistrement

- **Aperçu** :
  - crée une ligne `plan_generation_runs` (statut `apercu`) avec le résultat compact, le résumé, les paramètres, la version de règles et l'**empreinte** des entrées ;
  - l'empreinte est un SHA-256 du JSON canonique trié, calculé **par section** (registre, visites, données, activation, risque, MMR et calendrier, paramètres, règles) pour dire ce qui a changé ;
  - plafond du résultat : 8 Mo (mesuré : 1,0 à 1,6 Mo pour 3 000 × 12) ;
  - les aperçus de plus de 7 jours sont purgés à l'aperçu suivant (DELETE borné au compte).
- **Enregistrer** (`apply`), dans une transaction :
  1. `SELECT … FOR UPDATE` sur l'exécution. Statut ≠ `apercu` → 409 `deja_appliquee`. Plus de 24 h → 409 `apercu_expire`.
  2. Rechargement des entrées et nouvelle empreinte. Si elle diffère : 409 `plan_inputs_changed`, avec `details.sections` (ex. `["visites","donnees"]`).
  3. Verrous consultatifs `rbm-generate:<tenant>:<mois>`, mois croissants : on sérialise ainsi avec « Générer depuis le RBM », sans interblocage.
  4. Retrait des visites exclues par l'utilisateur (sites × mois, ou une tournée entière).
  5. INSERT multi-lignes par lots de 500 (`unnest`), avec `NOT EXISTS` sur toute visite du site × mois (annulée comprise) et `NOT EXISTS` sur un statut inactif du mois. On ajoute `ON CONFLICT DO NOTHING`, et on estampille `plan_run_id`, `plan_why`, l'instantané de priorité, l'activité du site et `provider_id` (TPM de la zone, retour 58, si disponible).
  6. L'exécution passe `applique`. Les autres aperçus du compte dont l'horizon chevauche passent `perime`.
  - Réponse : `{ created, skippedExisting, skippedInactive, excluded }`.
- **Retirer les visites encore prévues d'un plan enregistré** : supprime les seules visites `planifie` de ce `plan_run_id` (jamais une réalisée ni une annulée) et inscrit le nombre et l'auteur sur l'exécution. Ce n'est pas un document du retour 56 : c'est une trace technique, jamais supprimée une fois appliquée.

### 7.10 API — `server/src/modules/tpm/plan.routes.js` (monté `/api/tpm/plan`)

| Méthode | Chemin | Droits | Contrat |
|---|---|---|---|
| GET/PUT | `/settings` | lecture / admin | §6.3 |
| POST | `/runs` | admin, manager | `{ from, to, officeId?, activities?:string[]≤50, params?:{…surcharges non enregistrées}, ruleSetId? }`. Plage ≤ 24 mois (`parsePeriod` du 1b) ; premier mois planifiable = max(from, mois courant) → 201 `{ id, status:'apercu', summary:{ visits, days, tours, visitsPerDay, sites:{eligible, covered, generated}, byMonth:[…], byPool:[…], warnings, objectiveByPool }, timings:{ loadMs, computeMs, storeMs } }` |
| GET | `/runs?limit≤50` | lecture | historique (date, auteur, horizon, statut, visites créées, résumé) |
| GET | `/runs/:id/months/:month` | lecture | tournées du mois, sites résolus (nom, code, activité, commune, dernière visite, niveau, motif, why) |
| GET | `/runs/:id/sites?status=planifie\|reporte\|exclu\|non_planifiable&code=&district=&activity=&q=&offset=&limit≤200` | lecture | décisions paginées |
| GET | `/runs/:id/sites/:siteId` | lecture | explication mois par mois + trace des règles au mois de la décision |
| GET | `/runs/:id/projection` | lecture | §7.5 |
| GET | `/runs/:id/export.csv` | lecture | visites du plan (mois, district, commune, jour, site, activité, niveau, pourquoi) |
| POST | `/runs/:id/apply` | admin, manager | `{ exclude?:[{siteId,month}]≤5000, excludeTours?:[{month,district}]≤500 }` → §7.9 |
| POST | `/runs/:id/withdraw` | admin, manager | `{ reason:5..300 }` → `{ deleted }` |

Couches : routes (zod) → `plan.controller` → `plan.service` (purs : `planInputs`, `planGenerator`, `planFingerprint`, `planResult` ; fil de calcul) → `plan.repository` (seul SQL).

### 7.11 Écran — onglet RBM « Plan réaliste » (`PlanGeneratorPage.jsx`)

1. **Préparer** (carte) :
   - période `PeriodSelect` du 1b (« du … au … », défaut mois courant → décembre, 24 mois au plus) ;
   - bureau (antennes comprises) et activités ;
   - ligne de paramètres résumés (« auto · 80 % · commune puis district · multi-activités · marge 100 % ») avec « Ajuster pour cet aperçu » (tiroir, non enregistré) et lien vers les paramètres ;
   - « Règles de priorité v3 (actives) » ;
   - bouton **Aperçu**.
2. **Aperçu** :
   - tuiles : visites générées, journées, tournées, visites par journée, couverture projetée, objectif 80 % ;
   - par activité qui n'atteint pas l'objectif, une `Alert` chiffrée (« Repas scolaires : 63 % au mieux ; il manque 140 visites sur la période ≈ +1 personne à 3 suivis/jour × 18 jours ») ;
   - avertissements : activité sans MMR, sans calendrier, nombre de sites MMR ≠ registre, engagements existants au-delà de la capacité.
3. **Onglets de l'aperçu** :
   - **Par mois et tournée** : accordéon des mois (visites, journées, mini-barres capacité utilisée / disponible par activité) → tournées (district, communes, journées, visites, case « exclure la tournée ») → étapes → « Jour 1 » avec des puces de visites. Chaque puce porte site, activité, priorité (badge), pourquoi (icône + libellé), dernière visite et case d'exclusion. Un clic ouvre le tiroir « Pourquoi ce site ? ».
   - **Sites reportés** : `DataList` (site, activité, commune, raison principale en badge, mois, dernière visite, niveau), filtre par raison, CSV.
   - **Projection** : tableau §7.5 + courbe de couverture cumulée (SVG en ligne, palette dataviz validée).
   - **Capacité** : grille mois × activité (visites et jours-personne, utilisé / disponible ; dépassement d'engagements signalé).
4. **Barre d'enregistrement** (collée en bas) : « 612 visites retenues sur 640 · Enregistrer le plan ». La confirmation donne les comptes par mois et rappelle : « les visites annulées ou déjà prévues ne sont jamais modifiées ».
   - Sur 409 `plan_inputs_changed` : `Alert` « Les données ont changé depuis l'aperçu (visites, données reçues…) : relancez l'aperçu » avec le bouton.
   - Succès : notification avec lien « Voir dans le Plan de suivi ».
5. **Historique** : liste des exécutions, avec « Retirer les visites encore prévues » (motif).

Accessibilité : accordéons `aria-expanded`, cases étiquetées, statuts couleur + icône + libellé, navigation clavier. Jetons du bloc « REFONTE v6 » seulement.

## 8. Modèle de données (migrations)

### 065_activity_calendar.sql

```sql
CREATE OR REPLACE FUNCTION mems_days_in_month(y int, m int) RETURNS int LANGUAGE sql IMMUTABLE AS
$$ SELECT extract(day FROM (make_date(y, m, 1) + interval '1 month' - interval '1 day'))::int $$;  -- 4 fonctions immuables (vérifié)
CREATE TABLE IF NOT EXISTS activity_calendar_months (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  mmr_parameter_id uuid NOT NULL REFERENCES mmr_parameters(id) ON DELETE CASCADE,
  year int NOT NULL CHECK (year BETWEEN 2000 AND 2100),
  month smallint NOT NULL CHECK (month BETWEEN 1 AND 12),
  assistance_days smallint NOT NULL CHECK (assistance_days >= 0 AND assistance_days <= mems_days_in_month(year, month)),
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (mmr_parameter_id, year, month));
CREATE INDEX IF NOT EXISTS idx_activity_calendar_tenant_year ON activity_calendar_months (tenant_id, year);
ALTER TABLE mmr_parameters
  ADD COLUMN IF NOT EXISTS duration_mode text NOT NULL DEFAULT 'auto',
  ADD COLUMN IF NOT EXISTS duration_reason text;
ALTER TABLE mmr_parameters ADD CONSTRAINT mmr_parameters_duration_mode_check CHECK (duration_mode IN ('auto','manuel'));
ALTER TABLE mmr_parameters ADD CONSTRAINT mmr_parameters_duration_reason_check
  CHECK (duration_mode = 'auto' OR length(btrim(coalesce(duration_reason, ''))) BETWEEN 5 AND 300);
-- RLS ENABLE + FORCE, politique tenant_isolation (USING + WITH CHECK), GRANT à mems2_app (jamais mems_app)
SELECT mems_install_same_tenant('activity_calendar_months');
```

### 066_site_risk_history.sql

- `risk_change_batches` :
  - colonnes : `id`, `tenant_id`, `created_at`, `created_by → users ON DELETE SET NULL`, `source`, `scope_kind`, `scope_label`, `scope_filter jsonb`, `attr`, `new_value`, `from_month date NULL` (NULL = référence), `to_month date NULL`, `reason`, `affected int`, `unchanged int` ;
  - CHECK : `source IN ('saisie','zone','import','api')`, `scope_kind IN ('sites','commune','district','bureau','import')`, `attr IN ('risk','security')`, `length(btrim(reason)) BETWEEN 5 AND 500`, `to_month IS NULL OR from_month IS NOT NULL AND to_month >= from_month`, mois au 1er.
- `site_risk_points` :
  - colonnes : `tenant_id`, `site_id → sites ON DELETE CASCADE`, `attr`, `from_month`, `value`, `batch_id → risk_change_batches` ;
  - clé primaire `(site_id, attr, from_month)` ;
  - CHECK de valeur par attribut : risque ∈ {faible, moyenne, elevee}, sécurité ∈ {0, 1, 3, 99} ;
  - index `(tenant_id, site_id, attr, from_month DESC)`.
- `risk_change_log` : `id bigint identity`, `tenant_id`, `batch_id`, `site_id uuid` (sans clé étrangère, voulu), `site_code`, `site_name`, `attr`, `from_month NULL`, `before_value`, `after_value`, `op`, `created_at`, `created_by` ; index `(tenant_id, site_id, created_at DESC)` et `(tenant_id, batch_id)`.
- Triggers : `mems_risk_points_guard` / `_log`, `mems_sites_risk_guard` / `_log`, `mems_risk_log_immutable` (§4.2).
- RLS + FORCE sur les trois tables, droits pour `mems2_app`, `mems_install_same_tenant` sur `risk_change_batches`, `site_risk_points` et `risk_change_log`.

### 067_priority_rules.sql

Tables `priority_rule_sets`, `priority_rule_vars`, `priority_rules`, contraintes et triggers du §5.6. Puis :

```sql
ALTER TABLE site_visits
  ADD COLUMN IF NOT EXISTS priority_level text,
  ADD COLUMN IF NOT EXISTS priority_reason text,
  ADD COLUMN IF NOT EXISTS priority_rule_set_id uuid REFERENCES priority_rule_sets(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS priority_rule_label text;
-- CHECK (priority_level IS NULL OR priority_level IN ('haute','moyenne','basse')),
--       ((priority_level IS NULL) = (priority_reason IS NULL)), length(priority_reason) <= 400, length(priority_rule_label) <= 120
```

RLS, droits, `mems_install_same_tenant` sur les trois tables et sur `site_visits` (nouvelle clé étrangère).

### 068_plan_generator.sql

- `plan_settings` (§6.2).
- `plan_generation_runs` :
  - colonnes : `id`, `tenant_id`, `status`, `period_from`, `period_to`, `first_month`, `scope jsonb` (≤ 4 Ko), `params jsonb`, `rule_set_id → priority_rule_sets ON DELETE SET NULL`, `rule_edition`, `fingerprint`, `fingerprint_sections jsonb`, `summary jsonb`, `result jsonb`, `created_by`, `created_at`, `applied_by`, `applied_at`, `created_visits`, `withdrawn_by`, `withdrawn_at`, `withdrawn_count`, `withdraw_reason` ;
  - CHECK : `status IN ('apercu','applique','perime')`, `fingerprint ~ '^[0-9a-f]{64}$'`, `period_to >= period_from`, `(status = 'applique') = (applied_at IS NOT NULL)` ;
  - trigger : transitions apercu → applique | perime seulement, contenu figé après l'aperçu.
- `site_visits` : `plan_run_id → plan_generation_runs ON DELETE SET NULL`, `plan_why text CHECK (plan_why IS NULL OR plan_why IN ('urgent','regle','meme_lieu','meme_commune','meme_district','couverture','anticipee'))`, index `(tenant_id, plan_run_id)`.
- RLS, droits, `mems_install_same_tenant('plan_settings')`, `('plan_generation_runs')`, `('site_visits')`.

## 9. Couches et fichiers

| Couche | Nouveaux fichiers serveur |
|---|---|
| Purs (testés) | `tpm/activityCalendar.js`, `tpm/calendarXlsx.js`, `tpm/riskTimeline.js`, `tpm/priorityRules.js`, `tpm/priorityCatalog.js`, `tpm/planSettings.js`, `tpm/planInputs.js`, `tpm/planGenerator.js`, `tpm/planFingerprint.js`, `tpm/planResult.js` |
| SQL partagé | `common/siteRiskSql.js` |
| Dépôts | `settings/mmrCalendar.repository.js`, `tpm/risk.repository.js`, `tpm/priority.repository.js`, `tpm/plan.repository.js` (+ `field.repository.js` : `siteVariablesTx`, lecteurs du risque, génération RBM) |
| Services | `settings/mmrCalendar.service.js`, `tpm/risk.service.js`, `tpm/priority.service.js`, `tpm/plan.service.js` |
| Routes | `settings.routes.js` (calendrier), `tpm/risk.routes.js`, `tpm/priority.routes.js`, `tpm/plan.routes.js`, montage dans `app.js` avant `/api/tpm` |
| Fond | `jobs/planThread.js` (entrée du fil), `jobs/planRunner.js` (réserve de fils) |
| Banc | `scripts/perfPlan.js` (`npm run perf:plan`) |

Web : `pages/settings/ActivityCalendarModal.jsx`, `MmrSection.jsx` (exercice, durée, colonne calendrier, carte des paramètres `PlanSettingsCard.jsx`), `lib/activityCalendar.js` (miroir), `pages/monitoring/RiskDialog.jsx`, `RiskPanel.jsx`, `RiskJournalPage.jsx`, `lib/priority.js`, `PriorityRulesPage.jsx`, `PriorityTrace.jsx`, `FormulaEditor.jsx` (généralisé), `RbmPage.jsx`, `RbmExplain.jsx`, `PlanBoardPage.jsx`, `PlanGeneratorPage.jsx`, `PlanTours.jsx`, `PlanProjection.jsx`, `lib/planView.js`, `RbmSpacePage.jsx` (onglets « Plan réaliste », « Règles de priorité », « Journal des risques »), `api/client.js`, styles dans le bloc « REFONTE v6 » (jetons seulement).

i18n EN : `locales/en/settings.js` (calendrier, paramètres du plan), nouveaux `locales/en/plan.js`, `priority.js`, `risk.js`, `calc.js` (fonctions et catégorie « Dates »). Les libellés et motifs des règles saisis par l'utilisateur ne sont pas traduits. Les modèles fournis existent en FR et en EN au moment de créer un brouillon.

## 10. Tests (`node --test`, sans base, sauf le banc)

- **calcFields** :
  - `ifs` : première vraie, vide ignorée, sinon, sans sinon → vide, arité 2–51 ;
  - `case` : casse et nombre/texte, vide, sinon ;
  - `months_between` : mois et dates, négatif, vide, catégorie « Dates » au catalogue ;
  - `strict` : erreur et suggestion ; sans `strict`, non-régression.
- **activityCalendar** :
  - `daysInMonth` (2026-02 = 28, 2028-02 = 29) ;
  - `calendarYear` : durée, interruptions, total, refus au-delà des jours du mois ;
  - `resolveCalendar` : bureau, parent, général, aucun ;
  - `effectiveMmr` : trois sources, avertissement, valeurs de la capture (15,85 ; 164,8) ;
  - année à 0 mois → 0 visite exigée.
- **calendarXlsx** : aller-retour export → import identique ; colonne inconnue signalée ; jours invalides avec feuille, ligne et colonne ; garde `xlsxGuard`.
- **riskTimeline** :
  - `valueAt` ;
  - `applyRange` par balayage (F × T × valeur × mois : la valeur change exactement sur [F, T]) ;
  - indépendance des deux attributs ;
  - `compact` sans effet sur les valeurs ;
  - `planZoneChange` : inchangés, plafond, exemple.
- **siteRiskSql** : `tenant_id` dans chaque sous-requête ; sonde LATERAL `LIMIT 1` ; `risk_spans` MATERIALIZED.
- **risk066Migration** (statique) : triggers présents ; garde du motif sur `sites` ; immuabilité ; RLS FORCE ; droits pour `mems2_app` et jamais `mems_app` ; `mems_install_same_tenant`.
- **riskRoutes** (supertest, dépôt espionné) :
  - motif manquant → 400 ;
  - plus de 5 000 sites → 400 ;
  - l'aperçu n'écrit rien ;
  - 403 en lecture seule ;
  - le compte vient du jeton.
- **priorityRules** :
  - grille exhaustive de parité `mems-defaut-1` ≡ `rbmMath.isDue` + `scoreSite` priorité ;
  - première correspondance, désactivée, indéterminée, sinon ;
  - `validateRuleSet` : chaque erreur avec index et position ;
  - `renderReason` ;
  - `simulate` + matrice ;
  - `equivalentIfs` ≡ table ;
  - garde-fous (`planningGuards`) ≡ `needsPlanning`.
- **priority067Migration** (statique) : niveaux SQL = `LEVELS`, RLS, `site_visits`.
- **priorityRoutes** : 400 sans écriture, 409 révision, 409 brouillon existant, activation sans note → 400, 403.
- **planSettings** :
  - défauts du code = défauts SQL (lecture de 068) ;
  - chaque paramètre a une source ;
  - `effectiveInterval` pour auto, mmr_complet et couverture.
- **planInputs** :
  - dernière visite avant l'horizon (`lastVisitOf`), mois de données, activation 1b, risque du mois ;
  - pool bureau → parent → général ;
  - capacité depuis personnes × vpd × min(jours ouvrés, jours d'assistance), avec la marge en entiers.
- **planGenerator** :
  - déterminisme (deux exécutions identiques) et indépendance de l'ordre d'entrée (sites mélangés) ;
  - invariants (§7.2) sur un jeu synthétique aléatoire à graine fixe ;
  - regroupement : 3 sites de même commune et même activité à 3/j → 1 journée, le 4ᵉ → 2ᵉ journée ;
  - multi-activités : 1/3 + 1/2 tient, + 1/3 refusé ;
  - multi-activités désactivées → journées séparées ;
  - remplissage district (commune la plus fournie d'abord) ;
  - paliers : une Basse voisine ne passe pas avant une Moyenne ailleurs ;
  - quota lissé ; projection et manque ; « ≈ +N personnes » ;
  - chaque code de report ;
  - anticipation seulement dans une journée ouverte ;
  - engagement existant au-delà de la capacité signalé, pas supprimé ;
  - unités exactes pour vpd 0,5 / 1,5 / 2,5 ;
  - entrée vide ; sites sans pool.
- **planFingerprint** : indépendance de l'ordre ; chaque section sensible à un seul champ.
- **planRoutes** (supertest) :
  - période > 24 mois → 400 ;
  - l'aperçu enregistre une exécution ;
  - apply → 409 si l'empreinte change, 409 si déjà appliqué ;
  - exclusions ; `withdraw` ne touche que les visites prévues ;
  - 403.
- **Web** (depuis `server/test`, comme `webCharts.test.js`) : `lib/priority.js`, `lib/planView.js` (regroupement, totaux, exclusions), `lib/activityCalendar.js` ≡ serveur sur 50 cas.
- **Base jetable** (banc, jamais `mems2_tpm`) :
  - migrations 065–068 appliquées ;
  - écrire le risque sans motif → 23514 ;
  - un journal ne s'efface pas ;
  - deux activations simultanées → une seule (409) ;
  - apply deux fois → 0 doublon, y compris pour une activité NULL ;
  - visite annulée jamais recréée ;
  - parité chargeur ↔ `RBM_SELECT` sur la démonstration.
- **Balayage Playwright** des onglets RBM (FR et EN), de la fenêtre calendrier et de l'aperçu : 0 erreur console ou API ; `npm test`, `npm run lint` et `cd web && npm run build` verts.

## 11. Performance — budget et mesures

| Opération | Budget p95 | Mesuré (démonstration, `mems2_app`, RLS) |
|---|---|---|
| Chargeur du générateur, 3 000 sites × 12 mois | ≤ 150 ms | 28–45 ms pour 1 280 sites, de 1 à 24 mois (5 requêtes) ; requête unique sans précaution : 2,3–3,1 s, et > 20 s sur 12 mois (rejetée) |
| Générateur pur, 3 000 × 12 | ≤ 450 ms | médiane 108–264 ms, maximum 449 ms selon le scénario ; tas 19–70 Mo ; résultat 1,0–1,6 Mo |
| Fil de calcul, aller-retour | ≤ 600 ms | 253–416 ms, boucle d'événements libre |
| 6 000 / 10 000 sites × 12 | info | médianes 547 / 666 ms |
| Aperçu de bout en bout (chargement + calcul + écriture de l'exécution) | ≤ 1,5 s | — (à mesurer au commit, banc `perf:plan`) |
| Enregistrement (≤ 3 000 visites, lots de 500) | ≤ 1 s | — |
| Pages d'une exécution (mois, sites, projection) | ≤ 100 ms | — (lecture `jsonb` + découpe) |
| Règles sur tout le registre pour un mois (RBM, aperçu des règles) | ≤ +30 ms | 8–41 ms pour 1 280 sites avec `scoreSite` ; `rbmSites` actuel 47–154 ms |
| Risque du mois (sonde LATERAL par site) | ≤ +10 ms sur `RBM_SELECT` | — |
| Changement de risque de zone, 1 000 sites | ≤ 300 ms | — |
| Fenêtre calendrier (GET / PUT d'une année) | ≤ 50 ms | — |

Le banc `npm run perf:plan` comprend :
- la partie pure : jeu synthétique à graine fixe sur la structure réelle du registre d'activation, 3 000 × 12 ; échec si p95 > 450 ms ou en cas de violation d'invariant ;
- la partie base : une base passée en argument, **refuse `mems2_tpm`** en écriture ; garde EXPLAIN « pas de Nested Loop > 1 000 boucles sur un CTE Scan », comme au 1b.

## 12. Coordination

- **1b** (faits site × mois, période) : le générateur lit `fact.active` et `fact.st` via `siteMonthFactsCtes` et la période via `parsePeriod`. Lot 5 rend la zone interdite **datée** dans `act` (`riskSpansCte`), en levant la limite notée au 1b : c'est fait au commit 4 si le 1b est déjà fusionné, sinon par le 1b lui-même au moment de sa fusion (une ligne). Le commit 10 dépend du 1b (dépendance dure) : s'il n'est pas fusionné, on attend.
- **Lot 3** (grille d'activation importée, code de lieu) : rien à changer ici. `activeAt` lit la grille, et `placeKey` prend le code de lieu dès qu'il existe (retour 57 : un lieu, plusieurs activités → journées multi-activités naturelles).
- **Lot 4** (réalisé issu des données) : le « réalisé » du générateur et des règles passe par trois points :
  - `lastVisitOf` ;
  - `fact.st` ;
  - les requêtes pré-agrégées du chargeur (§7.7) ; le lot 4 les remplace en même temps que `RBM_SELECT`, avec le test de parité.

  Aucune règle de réalisé n'est dupliquée dans le générateur.
- **Retour 56** (suppression des documents) : les versions de règles archivées et les exécutions appliquées ne se suppriment pas (traces). Les brouillons de règles et les aperçus, eux, se suppriment ou se purgent.
- **Retour 58** (TPM par zone) : à l'enregistrement, `provider_id` = TPM par défaut de la zone et du mois (fonction de ce lot), jamais un choix du générateur.
- **6a / 7** : la projection et les tournées deviennent des blocs du concepteur (7b) et une couche de carte (6). Contrats d'API stables.
- **Migrations** : 061 est pris deux fois en parallèle (`061_map_geo` au 6a, `061_document_deletions` au retour 56) — à renuméroter à la fusion. Lot 5 prend **065 à 068** ; les migrations sont suivies par nom de fichier.

## 13. Risques

- **Données minces** :
  - les critères valent 0 (« non évalué » ressemble à « aucun problème ») ;
  - le risque vaut « moyenne » par défaut ;
  - le registre réel n'a ni risque ni critères ;
  - personnes et jours sont vides partout.

  Parade : l'aperçu montre les « indéterminés » par règle ; le catalogue affiche la fiabilité de chaque variable ; le générateur signale toute capacité calculée sur un faisable saisi.
- **Deux échelles de fréquence** (RBM élevé = tous les mois ; MMR = durée ÷ risque, 15,85 mois ajustés pour les repas scolaires) : rendues explicites (`intervalle_rbm`, `intervalle_effectif`). Le modèle par défaut reste celui du lot 1 ; le plan réaliste utilise l'intervalle effectif.
- **Sur-sélection** : avec `mems-mmr-1`, presque tous les sites jamais suivis sont « haute ». La capacité et les paliers bornent le plan, et l'aperçu dit pourquoi les autres sont reportés.
- **Projection ≠ réalité** : une visite planifiée compte comme faite **dans la projection seulement**. C'est écrit dans l'aperçu ; la définition commune (une visite planifiée ne rend jamais un site « à jour ») est intacte partout ailleurs.
- **Plans d'exécution sous RLS** : estimations fausses (1 à 6 lignes pour 1 280) ; d'où les requêtes bornées séparées et la garde EXPLAIN au banc.
- **Changement visible au Plan de suivi** : 235 priorités sur 1 280 changent. Journal et note de version.
- **Calendrier rattaché à la ligne MMR** : supprimer une dérogation supprime son calendrier, après une confirmation qui le dit.
- **Imports et motif imposé par la base** : tout chemin d'écriture du risque oublié échouera en 400 (et non en silence). Les quatre chemins connus sont migrés dans le même commit, et un test statique liste les `UPDATE sites SET … risk_level|security_situation` du code.
- **Taille des résultats stockés** : plafond de 8 Mo, purge des aperçus à 7 jours, détail paginé.

## 14. Commits ordonnés (chacun livrable seul)

1. **feat(calculs): ifs(), case(), months_between() et vérification stricte des variables** — pas de migration.
2. **feat(mmr): calendrier d'activité par catégorie et par année (migration 065), durée réelle dans le MMR et le Plan de suivi, durée manuelle motivée, fenêtre depuis la grille.**
3. **feat(mmr): calendrier ⇄ Excel (une feuille par année, revue avant enregistrement).**
4. **feat(rbm): risque et sécurité datés par site, journal immuable et motif imposés par la base (migration 066), « risque du mois » lu partout.**
5. **feat(rbm): changement de risque par zone (commune, district, bureau, activité) avec aperçu, et onglet « Journal des risques ».**
6. **feat(priorités): règles de priorité configurables — moteur, versions, modèles, Priorités du mois et « Générer » (migration 067).** La table par défaut garde les résultats d'aujourd'hui (0 écart).
7. **feat(priorités): éditeur de règles (si / sinon / cas), simulation, test sur un site, documentation des calculs.**
8. **feat(rbm): « Pourquoi ? / Que faire ? » par la règle (trace, garde-fous, action) et priorité du Plan de suivi selon les règles.**
9. **feat(plan): paramètres du générateur et leurs sources (migration 068 : paramètres, exécutions, traçabilité des visites).**
10. **feat(plan): générateur de plan réaliste — moteur pur, chargeur, fil de calcul, aperçu par tournée, reports expliqués, projection.**
11. **feat(plan): enregistrement du plan aperçu (empreinte, verrous, sans doublon, annulations respectées), historique et retrait des visites encore prévues.**
12. **docs: lot 5 — CLAUDE.md, état du projet, retours 24, 25, 48, 55, journal.**

## 15. Questions ouvertes

1. Capacité d'une ligne du **plan général** héritée par plusieurs bureaux : commune (comportement actuel du Plan de suivi, retenu) ou une par bureau ?
2. Source des **personnes / suivis par jour / jours ouvrés** : la feuille *Resource allocation* du classeur lié « Plan de suivi … » peut-elle être fournie, pour initialiser ces colonnes et montrer leur cellule d'origine ?
3. **Risque de zone** : un site ajouté plus tard dans une zone doit-il hériter automatiquement d'un changement de zone encore en cours (règle de zone), ou garder sa valeur de référence (retenu, plus simple) ?
4. Faut-il **dater aussi le risque MMR** (1–3 par activité) et les critères « problèmes / fraude » (recommandations urgentes), ou seulement le risque et la sécurité du site (retenu) ?
5. **Recommandation urgente** : aujourd'hui = critères du classeur (problème à 2, fraude, sécurité stricte). Faut-il y ajouter, au lot 4, une recommandation urgente issue des soumissions (une action « urgente » d'un formulaire) ?
6. Objectif par défaut **auto** (MMR complet si la capacité suffit, sinon intervalle ajusté et 80 %) : cela convient-il, ou préférez-vous imposer « au moins une visite par site sur la période » ?
7. Le générateur doit-il, plus tard, répartir les tournées par **TPM** (capacité par prestataire, retour 58) plutôt que par activité ?
8. Au-delà de 10 000 sites × 24 mois : brancher le même gestionnaire sur une file BullMQ « tpm-plan » (exige Redis et le worker) ou garder le fil de calcul ?

## Commits prévus (v1)

1. feat(calculs): ifs(), case(), months_between() et vérification stricte des variables
   - Fichiers : `server/src/modules/monitoring/calcFields.js`, `server/test/calcFields.test.js`, `web/src/pages/monitoring/FormulaEditor.jsx`, `web/src/pages/monitoring/CalcDocsPage.jsx`, `web/src/locales/en/calc.js`, `docs/JOURNAL.md`
   - Tests : cd server && npm test (calcFields : ifs première vraie, condition vide ignorée, sinon, sans sinon → vide, arité 2–51 refusée hors bornes ; case sans tenir compte de la casse, nombre/texte, valeur vide, sinon ; months_between AAAA-MM et AAAA-MM-JJ, négatif, vide, catégorie « Dates » au catalogue ; checkExpression strict → erreur + « vouliez-vous dire », sans strict comportement inchangé) && npm run lint ; cd web && npm run build ; page « Comment les calculs sont faits » liste les trois fonctions en FR et EN
2. feat(mmr): calendrier d'activité par catégorie et par année (migration 065), durée réelle dans le MMR et le Plan de suivi, durée manuelle motivée, fenêtre depuis la grille
   - Fichiers : `server/src/db/migrations/065_activity_calendar.sql`, `server/src/modules/tpm/activityCalendar.js`, `server/src/modules/settings/mmrCalendar.repository.js`, `server/src/modules/settings/mmrCalendar.service.js`, `server/src/modules/settings/settings.routes.js`, `server/src/modules/settings/settings.repository.js`, `server/src/modules/tpm/planBoard.js`, `server/src/modules/tpm/field.repository.js`, `server/test/activityCalendar.test.js`, `server/test/calendarMigration065.test.js`, `server/test/mmrCalendarRoutes.test.js`, `server/test/planBoard.test.js`, `server/test/webActivityCalendar.test.js`, `web/src/lib/activityCalendar.js`, `web/src/lib/mmr.js`, `web/src/pages/settings/ActivityCalendarModal.jsx`, `web/src/pages/settings/MmrSection.jsx`, `web/src/api/client.js`, `web/src/locales/en/settings.js`, `web/src/styles.css`, `docs/JOURNAL.md`
   - Tests : cd server && npm test (activityCalendar : jours du mois 2026-02 = 28 et 2028-02 = 29, calendarYear durée/interruptions/total, refus au-delà des jours du mois, resolveCalendar bureau → parent → général, effectiveMmr sources manuel/calendrier/saisie, avertissement durée ≠ calendrier, capture : 10 mois → intervalle 5, ciblé 164,8, ajusté 15,85 ; 9 mois → 4,5 et 183,11 ; année à 0 mois → 0 visite exigée ; migration 065 statique : CHECK jours, RLS FORCE, droits mems2_app jamais mems_app, mems_install_same_tenant ; routes : 400 jours invalides, 409 révision périmée, 403 non-admin ; planBoard : visites exigées de l'exercice avec la durée du calendrier ; parité lib web ↔ serveur sur 50 cas) && npm run lint ; cd web && npm run build ; Playwright FR/EN : fenêtre ouverte depuis la grille, onglets 2024–2028, total et durée réelle, Échap et retour du focus, 0 erreur console
3. feat(mmr): calendrier ⇄ Excel (une feuille par année, revue avant enregistrement)
   - Fichiers : `server/src/modules/tpm/calendarXlsx.js`, `server/src/modules/settings/mmrCalendar.service.js`, `server/src/modules/settings/settings.routes.js`, `server/test/calendarXlsx.test.js`, `web/src/pages/settings/MmrSection.jsx`, `web/src/pages/settings/ActivityCalendarModal.jsx`, `web/src/api/client.js`, `web/src/locales/en/settings.js`, `docs/JOURNAL.md`
   - Tests : cd server && npm test (calendarXlsx : export puis import identiques, feuilles 2024–2028, ligne Total en formule, colonne inconnue signalée, jours invalides avec feuille/ligne/colonne, chargement par xlsxGuard.loadWorkbook et lecture par sheetRows, rien écrit avant enregistrement) && npm run lint ; cd web && npm run build ; aller-retour manuel du classeur sur la démonstration
4. feat(rbm): risque et sécurité datés par site, journal immuable et motif imposés par la base (migration 066), « risque du mois » lu partout
   - Fichiers : `server/src/db/migrations/066_site_risk_history.sql`, `server/src/modules/tpm/riskTimeline.js`, `server/src/modules/common/siteRiskSql.js`, `server/src/modules/tpm/risk.repository.js`, `server/src/modules/tpm/risk.service.js`, `server/src/modules/tpm/risk.routes.js`, `server/src/app.js`, `server/src/modules/tpm/field.repository.js`, `server/src/modules/tpm/field.routes.js`, `server/src/modules/tpm/sitePatch.js`, `server/src/modules/tpm/tpm.repository.js`, `server/src/modules/common/siteActivitySql.js`, `server/test/riskTimeline.test.js`, `server/test/siteRiskSql.test.js`, `server/test/riskMigration066.test.js`, `server/test/riskRoutes.test.js`, `server/test/riskWriters.test.js`, `web/src/pages/monitoring/RiskDialog.jsx`, `web/src/pages/monitoring/RiskPanel.jsx`, `web/src/pages/monitoring/RbmPage.jsx`, `web/src/api/client.js`, `web/src/locales/en/risk.js`, `web/src/locales/en.js`, `web/src/styles.css`, `docs/JOURNAL.md`
   - Tests : cd server && npm test (riskTimeline : valueAt, applyRange par balayage F × T × valeur × mois → la valeur change exactement sur [F, T] et nulle part ailleurs, indépendance risque / sécurité, compact sans effet sur les valeurs ; siteRiskSql : tenant_id partout, LATERAL LIMIT 1, risk_spans MATERIALIZED ; migration 066 statique : gardes du motif sur site_risk_points et sites, immuabilité du journal, RLS FORCE, mems2_app ; routes : motif manquant → 400, PATCH riskLevel sans riskReason → 400, 403 lecture seule, compte tiré du jeton ; riskWriters : aucun UPDATE de risk_level / security_situation hors du service) && npm run lint ; base jetable : écriture sans motif → 23514, journal non effaçable, import du plan de suivi → point au mois de l'import ; RBM du mois et Plan de suivi lisent le risque du mois ; cd web && npm run build
5. feat(rbm): changement de risque par zone (commune, district, bureau, activité) avec aperçu, et onglet « Journal des risques »
   - Fichiers : `server/src/modules/tpm/riskTimeline.js`, `server/src/modules/tpm/risk.service.js`, `server/src/modules/tpm/risk.repository.js`, `server/src/modules/tpm/risk.routes.js`, `server/test/riskTimeline.test.js`, `server/test/riskRoutes.test.js`, `web/src/pages/monitoring/RiskDialog.jsx`, `web/src/pages/monitoring/RiskJournalPage.jsx`, `web/src/pages/monitoring/RbmSpacePage.jsx`, `web/src/api/client.js`, `web/src/locales/en/risk.js`, `docs/JOURNAL.md`
   - Tests : cd server && npm test (planZoneChange : sites inchangés comptés, plafond 5 000 → 400, exemples avant → après ; aperçu sans écriture ; un lot de journal par action avec détail par site ; CSV du journal) && npm run lint ; base jetable : district de 1 000 sites changé en moins de 300 ms en lots multi-lignes ; cd web && npm run build ; Playwright : fenêtre de zone, aperçu, enregistrement, journal filtré, aucun bouton modifier/supprimer
6. feat(priorités): règles de priorité configurables — moteur, versions, modèles, Priorités du mois et « Générer » (migration 067)
   - Fichiers : `server/src/db/migrations/067_priority_rules.sql`, `server/src/modules/tpm/priorityRules.js`, `server/src/modules/tpm/priorityCatalog.js`, `server/src/modules/tpm/priority.repository.js`, `server/src/modules/tpm/priority.service.js`, `server/src/modules/tpm/priority.routes.js`, `server/src/app.js`, `server/src/modules/tpm/field.repository.js`, `server/src/modules/tpm/field.routes.js`, `server/src/modules/tpm/rbmMath.js`, `server/test/priorityRules.test.js`, `server/test/priorityMigration067.test.js`, `server/test/priorityRoutes.test.js`, `server/test/rbmMath.test.js`, `server/test/webPriority.test.js`, `web/src/lib/priority.js`, `web/src/lib/rbmCriteria.js`, `web/src/pages/monitoring/RbmPage.jsx`, `web/src/api/client.js`, `web/src/locales/en/priority.js`, `docs/JOURNAL.md`
   - Tests : cd server && npm test (priorityRules : grille exhaustive mems-defaut-1 ≡ rbmMath.isDue + priorité scoreSite, première correspondance, règle désactivée, indéterminée comptée et sautée, Sinon, validateRuleSet avec index et position pour chaque erreur, enum hors choix, nombre vs texte, motif inconnu, référence avant, limites 50 / 20 / 500, renderReason, simulate et matrice, equivalentIfs ≡ table ; planningGuards ≡ needsPlanning ; migration 067 : niveaux SQL = LEVELS, figé hors brouillon, une active et un brouillon ; routes : 400 sans écriture, 409 révision, 409 brouillon existant, activation sans note → 400, 403) && npm run lint ; parité sur la démonstration (lecture seule, mems2_app) : rbmSites avec règles = lot 1 sur 11 mois, 0 écart sur due / toPlan / priorité ; « Générer » deux fois → 0 doublon ; cd web && npm run build
7. feat(priorités): éditeur de règles (si / sinon / cas), simulation, test sur un site, documentation des calculs
   - Fichiers : `web/src/pages/monitoring/PriorityRulesPage.jsx`, `web/src/pages/monitoring/PriorityTrace.jsx`, `web/src/pages/monitoring/FormulaEditor.jsx`, `web/src/pages/monitoring/RbmSpacePage.jsx`, `web/src/pages/monitoring/CalcDocsPage.jsx`, `web/src/api/client.js`, `web/src/locales/en/priority.js`, `web/src/locales/en/calc.js`, `web/src/styles.css`, `docs/JOURNAL.md`
   - Tests : cd web && npm run build ; cd server && npm test (FormulaEditor reste identique pour les champs calculés : tests web existants) ; Playwright FR/EN : créer un brouillon depuis mems-mmr-1, modifier une condition avec vérification en direct et ligne « N sites vérifient », réordonner au clavier, simulation sur un mois, tester sur un site, formule équivalente, activer avec note, 0 erreur console ; lecture seule sans droit d'écriture
8. feat(rbm): « Pourquoi ? / Que faire ? » par la règle (trace, garde-fous, action) et priorité du Plan de suivi selon les règles
   - Fichiers : `server/src/modules/tpm/rbmScore.js`, `server/src/modules/tpm/field.repository.js`, `server/src/modules/tpm/priority.service.js`, `server/src/modules/tpm/planBoard.js`, `server/test/rbmScore.test.js`, `server/test/planBoard.test.js`, `server/test/rbmExplainRoute.test.js`, `web/src/pages/monitoring/RbmExplain.jsx`, `web/src/pages/monitoring/PlanBoardPage.jsx`, `web/src/lib/planBoard.js`, `docs/JOURNAL.md`
   - Tests : cd server && npm test (explication : priority.level / trace / guards / action, actions « à suivre » tirées de la décision des règles ; rankSites sur 5 niveaux ; route GET /rbm/sites/:id) && npm run lint ; démonstration : 235 priorités sur 1 280 changent au Plan de suivi (Basse → Moyenne 207, Basse → Pas ce mois 11, Moyenne → Pas ce mois 11, Moyenne → Haute 6), consigné au journal ; cd web && npm run build ; Playwright : panneau en 4 parties, focus et Échap
9. feat(plan): paramètres du générateur et leurs sources (migration 068 : paramètres, exécutions, traçabilité des visites)
   - Fichiers : `server/src/db/migrations/068_plan_generator.sql`, `server/src/modules/tpm/planSettings.js`, `server/src/modules/tpm/plan.repository.js`, `server/src/modules/tpm/plan.service.js`, `server/src/modules/tpm/plan.controller.js`, `server/src/modules/tpm/plan.routes.js`, `server/src/app.js`, `server/test/planSettings.test.js`, `server/test/planMigration068.test.js`, `server/test/planRoutes.test.js`, `web/src/pages/settings/PlanSettingsCard.jsx`, `web/src/pages/settings/MmrSection.jsx`, `web/src/api/client.js`, `web/src/locales/en/plan.js`, `docs/JOURNAL.md`
   - Tests : cd server && npm test (planSettings : défauts du code = défauts SQL de 068, chaque paramètre a une source (cellule du classeur, retour ou MEMS), effectiveInterval auto / mmr_complet / couverture ; migration 068 : CHECK, transitions apercu → applique | perime, RLS, mems2_app ; routes settings : 409 révision, 403 non-admin) && npm run lint ; cd web && npm run build ; Playwright : carte des paramètres avec puces de source, Rétablir les valeurs initiales
10. feat(plan): générateur de plan réaliste — moteur pur, chargeur, fil de calcul, aperçu par tournée, reports expliqués, projection
   - Fichiers : `server/src/modules/tpm/planInputs.js`, `server/src/modules/tpm/planGenerator.js`, `server/src/modules/tpm/planFingerprint.js`, `server/src/modules/tpm/planResult.js`, `server/src/modules/tpm/plan.repository.js`, `server/src/modules/tpm/plan.service.js`, `server/src/modules/tpm/plan.controller.js`, `server/src/modules/tpm/plan.routes.js`, `server/src/jobs/planThread.js`, `server/src/jobs/planRunner.js`, `server/scripts/perfPlan.js`, `server/package.json`, `server/test/planInputs.test.js`, `server/test/planGenerator.test.js`, `server/test/planFingerprint.test.js`, `server/test/planResult.test.js`, `server/test/planRoutes.test.js`, `server/test/webPlanView.test.js`, `web/src/pages/monitoring/PlanGeneratorPage.jsx`, `web/src/pages/monitoring/PlanTours.jsx`, `web/src/pages/monitoring/PlanProjection.jsx`, `web/src/pages/monitoring/RbmSpacePage.jsx`, `web/src/lib/planView.js`, `web/src/api/client.js`, `web/src/locales/en/plan.js`, `web/src/styles.css`, `docs/JOURNAL.md`
   - Tests : cd server && npm test (planGenerator : déterminisme, indépendance de l'ordre d'entrée, invariants capacité / garde-fous / une visite par site × mois / journée ≤ 100 % / intervalle, regroupement commune et district, journées multi-activités 1/3 + 1/2 tient et + 1/3 refusé, paliers, quota lissé, projection et manque, chaque code de report, anticipation dans une journée ouverte seulement, engagements existants signalés, unités exactes vpd 0,5 / 1,5 / 2,5 ; planInputs : lastVisitOf, faits 1b, risque du mois, pool bureau → parent → général, capacité personnes × vpd × min(jours ouvrés, jours d'assistance) ; planFingerprint par section ; routes : période > 24 mois → 400, l'aperçu stocke une exécution, pages paginées) && npm run lint && npm run perf:plan (3 000 × 12 : p95 ≤ 450 ms, 0 violation ; partie base sur base jetable, refuse mems2_tpm, garde EXPLAIN) ; parité chargeur ↔ RBM_SELECT sur la démonstration (dernier mois de données et dernière visite, 0 écart) ; cd web && npm run build ; Playwright FR/EN : aperçu 12 mois, tournées dépliées, tiroir « Pourquoi ce site ? », sites reportés filtrés, projection avec alerte chiffrée, 0 erreur console
11. feat(plan): enregistrement du plan aperçu (empreinte, verrous, sans doublon, annulations respectées), historique et retrait des visites encore prévues
   - Fichiers : `server/src/modules/tpm/plan.repository.js`, `server/src/modules/tpm/plan.service.js`, `server/src/modules/tpm/plan.controller.js`, `server/src/modules/tpm/plan.routes.js`, `server/test/planRoutes.test.js`, `server/test/planApply.test.js`, `web/src/pages/monitoring/PlanGeneratorPage.jsx`, `web/src/api/client.js`, `web/src/locales/en/plan.js`, `docs/JOURNAL.md`
   - Tests : cd server && npm test (apply : 409 plan_inputs_changed avec sections, 409 deja_appliquee, 409 apercu_expire, exclusions de sites et de tournées, INSERT par lots avec NOT EXISTS sur toute visite du site × mois et sur un mois inactif, instantané de priorité et plan_why ; withdraw : seules les visites planifiées du plan, motif obligatoire ; 403) && npm run lint ; base jetable : apply deux fois → 0 doublon y compris activité NULL, visite annulée jamais recréée, apply et « Générer depuis le RBM » simultanés sérialisés par le verrou du mois ; cd web && npm run build ; Playwright : enregistrer, lien vers le Plan de suivi, historique, retrait
12. docs: lot 5 — CLAUDE.md, état du projet, retours 24, 25, 48, 55, journal
   - Fichiers : `CLAUDE.md`, `docs/SPEC_LOT_5.md`, `docs/ETAT_DU_PROJET.md`, `docs/RETOURS_UTILISATEUR.md`, `docs/PLAN_RETOURS_15_37.md`, `docs/JOURNAL.md`
   - Tests : relecture ; cd server && npm test && npm run lint ; cd web && npm run build ; balayage Playwright de toutes les routes RBM (FR/EN) à 0 erreur console ou API

## Mesures (v1)

Mesures en lecture seule le 14/10/2026 sur la base de démonstration (1 280 sites, 156 visites, 562 soumissions, grille d'activation vide). Toutes sous mems2_app (RLS active), sans aucune écriture. Scripts dans scratchpad/design5/proto2/.

(1) Parité « mems-defaut-1 + garde-fous » avec field.repository.rbmSites :
- 11 mois, de 2025-11 à 2027-03, soit 14 080 site × mois ;
- 0 écart sur « à suivre », 0 sur « à planifier », 0 sur la priorité des sites sélectionnés ;
- octobre 2026 : 20 haute, 1 238 moyenne, 22 pas ce mois.

(2) Coût des règles : l'évaluation de 3 règles avec scoreSite sur 1 280 sites prend 8–41 ms par mois. rbmSites actuel : 47–154 ms.

(3) Plan de suivi passé aux règles au mois de référence : 235 priorités sur 1 280 changent (Basse → Moyenne 207, Basse → Pas ce mois 11, Moyenne → Pas ce mois 11, Moyenne → Haute 6).

(4) Chargeur du générateur :
- en 5 requêtes bornées séparées : 28–45 ms (médianes 27,7 / 37,1 / 44,7 ms pour 1, 12 et 24 mois) ;
- la même chose en requête unique : 2,3–3,1 s sur 1 mois et plus de 20 s sur 12 mois (expiration). Sous RLS, le planificateur estime 1 à 6 lignes au lieu de 1 280 et rejoue des boucles imbriquées 1 280 fois ;
- avec enable_nestloop = off : 30–183 ms (option non retenue) ;
- parité du dernier mois de données et de la dernière visite effective avec RBM_SELECT : 0 écart sur 1 280 sites (346 avec données), en 16 ms.

(5) Générateur pur, sur la structure réelle du registre d'activation (2 872 sites, 328 communes, 31 districts) complétée à 3 000 sites × 12 mois :
- médiane 108–264 ms selon le scénario, maximum 449 ms ;
- tas 19–70 Mo ; résultat 1,0–1,6 Mo ;
- déterministe et indépendant de l'ordre d'entrée (empreinte SHA-256 identique) ;
- 0 violation d'invariant.

(6) Montée en charge du générateur :
- 6 000 sites × 12 : médiane 547 ms ;
- 10 000 sites × 12 : médiane 666 ms, tas 145 Mo.

(7) Fil de calcul (worker_threads), 3 000 × 12 :
- aller-retour 253–416 ms, dont 172–274 ms de calcul ;
- la boucle d'événements reste libre (21 à 37 tops de 10 ms pendant le calcul).

(8) Effet du regroupement quand les jours-personne bornent la capacité :
- 766 visites pour 282 journées (2,72 visites par journée) ;
- contre 317 visites (1,11 par journée) sans regroupement par commune ;
- couverture des repas scolaires : 34,9 % contre 14 %.

(9) Valeurs de la capture MMR du 14/10, objectif 80 % :
- 80 % atteignable seulement pour « Nutrition treatment » (243 visites possibles pour 217 nécessaires) ;
- manques : repas scolaires 140 (520 possibles, 660 nécessaires), prévention de la malnutrition 20, Asset 5, Smallholder 7, transferts 8 ;
- intervalle ajusté = nb sites ÷ faisable (824 ÷ 52 = 15,85), indépendant de la durée.

(10) Calendrier : 10 mois donnent les valeurs de la capture (intervalle 5, ciblé 164,8, ajusté 15,85) ; 9 mois donnent intervalle 4,5, ciblé 183,11 et une capacité de période de 468.

(11) Risque daté :
- le balayage applyRange passe 9 728 vérifications ;
- une frise commune aux deux attributs perdait la sécurité (défaut trouvé par le balayage) ; on retient donc une frise par attribut.

(12) Classeur RBM : le VBA ne contient qu'un UserForm vide. Les colonnes personnes, suivis/jour et jours ouvrés n'y figurent pas. Overreaching Parameters!F dépend d'un classeur lié non fourni (cache F5 213, F6 310, F7 48 ; F2 #VALUE!).

## Questions ouvertes et décisions provisoires

L'utilisateur a demandé de décider (« fait selon tes choix ») ; chaque décision reste révisable.

1. **Question** : Capacité d'une ligne du plan général héritée par plusieurs bureaux : une capacité commune (comportement actuel du pied du Plan de suivi, retenu dans la spec) ou une capacité par bureau ?
   **Décision** : Capacité par **bureau** : une ligne du plan général sert de modèle à chaque bureau, et chaque bureau a ses équipes (le classeur RBM paramètre par bureau × activité).
2. **Question** : Source des personnes / suivis par jour / jours ouvrés : la feuille « Resource allocation » du classeur lié « Plan de suivi … Nov 2024 » (référencé par le classeur RBM, non fourni) peut-elle être fournie pour initialiser ces colonnes et afficher leur cellule d'origine ?
   **Décision** : **Demandé à l'utilisateur** (non bloquant) : la feuille « Resource allocation » du classeur « Plan de suivi … Nov 2024 ». En attendant, personnes et jours ouvrés restent saisis dans le MMR, avec une valeur par défaut visible.
3. **Question** : Risque de zone : un site ajouté plus tard dans une zone doit-il hériter automatiquement d'un changement de zone en cours (règle de zone) ou garder sa valeur de référence (retenu, une seule règle « risque du mois » par site) ?
   **Décision** : Zone interdite (sécurité 99) : elle **suit la zone**, donc un site ajouté ou déplacé plus tard dans la zone est interdit aussi. Niveau de risque : changement de zone appliqué aux sites présents, avec journal ; un nouveau site part de la valeur de référence.
4. **Question** : Faut-il aussi dater le risque MMR (1–3 par activité) et les critères problèmes / fraude, ou seulement le risque et la situation sécuritaire du site (retenu) ?
   **Décision** : Le **risque MMR** (bureau × activité) et la durée sont aussi **datés et journalisés** (retour 25 complet).
5. **Question** : Recommandation urgente : aujourd'hui = critères du classeur (problème à 2, fraude ≥ 1, sécurité stricte) ; faut-il y ajouter au lot 4 une recommandation urgente issue des soumissions ?
   **Décision** : Recommandation urgente issue des soumissions : au **lot 4**, qui rattache les données aux sites.
6. **Question** : Objectif par défaut « auto » (MMR complet si la capacité suffit, sinon intervalle ajusté et au moins 80 % des sites) : convient-il, ou faut-il imposer « au moins une visite par site sur la période » ?
   **Décision** : Objectif par défaut « auto ». Les 80 % se mesurent sur **la période de l'activité** (calendrier), pas seulement sur l'horizon de l'aperçu ; les visites déjà réalisées dans l'année comptent.
7. **Question** : Le générateur doit-il plus tard répartir les tournées par prestataire TPM (capacité par prestataire, retour 58) plutôt que par activité ?
   **Décision** : Tournées réparties **par prestataire TPM** d'après l'affectation par zone du retour 58, puis par district et par commune ; la capacité est celle du prestataire.
8. **Question** : Au-delà d'environ 10 000 sites × 24 mois : brancher le même gestionnaire pur sur une file BullMQ « tpm-plan » (exige Redis et le worker, optionnels sur la cible Windows) ou garder le fil de calcul de l'API ?
   **Décision** : Exécution : calcul pur dans la requête, avec un plafond de taille mesuré (refus clair au-delà). Ni fil de calcul ni file BullMQ tant que les mesures ne l'exigent pas (≤ 0,5 s pour 3 000 sites × 12 mois). Le module reste pur, donc déplaçable dans le worker.
9. **Question** : Le 061 est pris deux fois en parallèle (061_map_geo au 6a, 061_document_deletions au retour 56) : qui renumérote à la fusion ? Le lot 5 réserve 065–068.
   **Décision** : Migrations réservées : lot 5 = `065`–`068` ; l'index éventuel du lot 1b (SPEC_LOT_1B) prend un numéro ≥ `071`. Le doublon `061` est réglé : journal des suppressions = `069`.


---

## Critique de complétude (v1) — à intégrer dans la v2

> Rédigée par un critique indépendant qui a confronté la v1 au code réel, au classeur RBM et aux mots de l'utilisateur. Texte d'origine (anglais).

- **[grave]** The visit snapshot rule contradicts the generator. Migration 067 only allows site_visits.priority_level in (haute, moyenne, basse) and requires the level and the reason to be both set or both null. But §7.2 step 3 and §7.6 select 'couverture' candidates (rule level 'non', picked by catch-up) and 'anticipee' candidates (the prototype proto2/generator.js gives them level 'non'). §7.9 step 5 still says every inserted visit is stamped with its priority snapshot. Taken literally, the all-or-nothing apply fails with 23514 → 400 as soon as the plan holds one coverage or anticipated visit. Otherwise those visits are stored with NULL/NULL and lose their 'why'.
  - _Correction proposée_ : Store the rule outcome apart from plan_why. Either allow level 'non' in the snapshot when plan_why is 'couverture' or 'anticipee' (CHECK: level in LEVELS-selected, or plan_why in those two), or add the columns rule_level and rule_reason. Add planApply tests that apply a plan containing a couverture visit and an anticipee visit.
- **[grave]** The 80 % objective is measured over the preview horizon, not over the activity period. §7.5 counts 'déjà couverts' only from visits inside the horizon. The §7.11 default horizon is the current month → December, i.e. Oct–Dec 2026 today. Visits made earlier in the same activity year are ignored. The coverage quota then re-plans sites already covered in Jan–Sep, and spreads ⌈80 % × eligible⌉ over 3 months. The alerts ('il manque 140 visites…') become wrong. The user asked for 80 % of sites « pendant la période », i.e. the MMR operation period.
  - _Correction proposée_ : Define the coverage period as the activity period of the exercise (the calendar's active months of year Y, or 'Operation duration' months). Count realised visits from the period start up to the first plannable month as already covered, and compute the quota over the remaining active months of that period. Keep the preview horizon only for placement. Test: a site realised in March is not a coverage candidate in October.
- **[grave]** The 'last visit / réalisé' rule used by the generator and the rules contradicts docs/PLAN_RETOURS_15_37.md, which the spec says it applies « telles quelles ». The shared rule is: Réalisée = data attached to the SITE, « une donnée rattachée seulement à la commune n'est jamais une visite », and last visit = réalisée ≤ M. Instead, §7.1 lastReal and §7.7 queries 4–5 reuse lot 1 lastVisitOf, i.e. RBM_SELECT SUBMISSION_OF_SITE (field.repository.js:112, commune pcode fallback) plus sites.last_visit_date, with no ≤ M bound. On the demo, 13 submissions are attached to a site while 346 sites are 'seen' through their commune. With auto mode the gate is up to 15.85 months, so about 333 sites never truly visited get blocked as 'intervalle' for the whole horizon. Simulations and explanations of past months also read visits made after M.
  - _Correction proposée_ : In the new generator inputs, which have no parity constraint, use only realised site_visits and site-attached data ≤ M. Expose commune-level data as a separate rule variable (donnees_commune). Keep the lot 1 definition only inside mems-defaut-1 on the Priorités du mois page until lot 4. Bound derniere_visite to ≤ M for past-month evaluation. Add a test where commune-only data never blocks the gate.
- **[grave]** The 'realistic' capacity collapses on real data. dayCap is null whenever persons or working days are unknown (§7.1). Both are empty in all 18 demo MMR rows and on the user's 14/10 screen, which only has Suivis/j (3, or 1 for URT). So only the typed 'faisable' limits the plan. Journées and grouping then never change how many visits are placed, and the claimed gain (1.1 → 2.7 visits per day) cannot happen. The '≈ +N personnes' figure also assumes vpd visits per person-day, which the generator's own day model (an isolated site costs a full day) contradicts.
  - _Correction proposée_ : When vpd is known but persons or days are not, derive person-day capacity as ⌈faisable ÷ vpd⌉ per month, so that grouping matters. Show which capacity mode is in force on each pool. Compute '+N personnes' from the generator's achieved visits per day, not from vpd. Add a test showing that isolated sites reduce placed visits when only faisable and vpd are set.
- **[grave]** The tours and days are thrown away when the plan is saved. Apply stores only plan_run_id and plan_why: no day, no visit_date, no generic role (Agent N), no tour id. Field teams therefore cannot execute « prioriser les sites proches … en même temps ». The real TPM planning the user uploaded (Planning_et_budget_AINA_Sept_collect, sheet 'Planning': DISTRICT | PDF | COMMUNES | ETABLISSEMENT | ACTIVITE | date columns holding 'Agent 1/2', about 3 schools per agent per day in one commune) is exactly this output. MEMS already imports that format (importPlanning: visit_date + agent). It also already derives budgeted collection days from dated visits (tpm_collection_days, travel_days). The generator neither writes visit_date/agent nor feeds travel days.
  - _Correction proposée_ : Persist the proposed day (visit_date or day index within the month), a generic role per team-day and a tour key on site_visits. Export the saved plan in the 'Planning' layout (dates × Agent N). Push tour travel days into tpm_collection_days, with confirmation, so that 'jours de collecte → budget' stays linked.
- **[grave]** The generator applies hidden rules that contradict the configurable rules (retour 24) and the « une seule règle » principle. The revisit gate (intervalle_effectif, up to 15.85 months in auto mode) runs BEFORE the rules (§7.2 step 3). Urgent sites always rank first with a 1-month gate, whatever level the user's rules give them. The spec says intervalle_effectif « sert aux règles comme au générateur », but mems-defaut-1 (the active default) uses intervalle_rbm (1 month for 1,151 'elevee' sites). For the same month, Priorités du mois therefore says 1,250 sites to plan while Plan réaliste reports most of them as 'intervalle'. Neither the gate nor urgent-first appears in the rule table or in the trace.
  - _Correction proposée_ : Make the gate and urgent-first explicit. Either show them as visible guard rows with their parameters in the trace and in the rule editor, or let the generator use only the active rule levels plus capacity, with mems-mmr-1 carrying the interval. Show a banner when the active rule set and the generator's gate disagree, and count the sites concerned.
- **[grave]** A registry Excel round-trip can silently lift a dated forbidden zone. locationsExportData (field.repository.js:945–968) exports the reference sites.security_situation, not the value in force, and §4.4 does not list it among the readers to switch. locationsXlsx.js:239–240 imports a blank security cell as 0. Under §4.1 ('the import posts a point when the value changes'), re-importing an unchanged export posts 0 from the import month on top of a dated 99. The same applies to importPlanSites, which takes the risk from FINAL SCORE.
  - _Correction proposée_ : Export the value in force at the export month (with its 'depuis' month). Treat a blank cell as unchanged. Compare against the value in force at the import month. List every risk or security change in the import preview with its before → after. Add locationsExportData and the Plan de suivi export to the 'risque du mois' reader table, with a round-trip test where export → import changes nothing.
- **[moyen]** Two incompatible definitions of 'inactive in M'. The 1b activeAt (wip/1b-rest common/siteActivity.js) says: in a year where the tenant has any grid cell, a missing cell means inactive. Lot 1 needsPlanning, monthBlocksTx (field.repository.js:185–197), planMonthsTx and the generate/apply INSERT guard treat only an explicit 'Non' as inactive. The spec claims both 'planningGuards ≡ needsPlanning' and 'inactif à M = activeAt du 1b', and its apply INSERT uses the explicit-Non test. The 0-écart proof ran on an empty grid (0 rows), so it never exercised the difference. It will appear as soon as lot 3 imports a partial grid.
  - _Correction proposée_ : Adopt activeAt everywhere: monthBlocksTx, needsPlanning inputs, planMonthsTx, the generate and apply INSERT guards, and the 'Site actif' shared definition. Rewrite the parity test with partial grids, covering a known year with a missing cell and an unknown year.
- **[moyen]** 'One visit per site × month' has no database backstop, and apply checks before it locks. site_visits is UNIQUE on (tenant, site, month, activity), and 108 of the 156 demo visits have activity NULL. The month advisory lock only serialises apply with 'Générer'. planMonthsTx (Plan de suivi grid), bulkUpdateSites auto-plan, createVisit and importPlanning never take it. §7.9 also takes the locks at step 3, after the fingerprint re-check at step 2, so a 'Générer' that commits in between goes undetected.
  - _Correction proposée_ : Add a partial unique index on site_visits (tenant_id, site_id, period_month) WHERE status <> 'annule', after a duplicate check on existing data. That is CLAUDE.md's 'unique constraint as the real backstop'. Take the month locks before reloading and fingerprinting, and make every visit writer take the same lock.
- **[moyen]** Risk-timeline writes can lose updates. Zone changes, PATCH, bulk edits and imports read the existing points, compute applyRange/compact in JS, then write. §4 specifies no row lock and no advisory lock, so two overlapping changes (two districts sharing sites, or a PATCH during a zone change) overwrite each other's points. That contradicts CLAUDE.md (« Guard concurrent edits with row locks »).
  - _Correction proposée_ : Before reading points, take SELECT … FROM sites WHERE id = ANY(…) ORDER BY id FOR UPDATE, or a per-tenant advisory lock risk:<tenant> taken non-blocking with retry like withSubmissionLinks. Add a disposable-database test with two concurrent overlapping zone changes.
- **[moyen]** The immutability triggers will block user deletion. risk_change_batches and risk_change_log reference created_by → users ON DELETE SET NULL. That cascade is an UPDATE, which the « BEFORE UPDATE/DELETE refus, sauf cascade du compte » trigger refuses. users.repository.deleteUser exists (DELETE FROM users), so deleting any user who ever changed a risk fails. The same applies to priority_rule_sets (content frozen outside draft) and plan_generation_runs (frozen after preview, created_by/applied_by/withdrawn_by). The withdraw columns written onto an 'applique' run must also pass the freeze trigger.
  - _Correction proposée_ : Exempt FK cascade actions (pg_trigger_depth() > 0), or allow only *_by → NULL transitions. Whitelist the withdraw columns. Add disposable-database tests: delete a user who authored a risk batch, an active rule set and an applied run.
- **[moyen]** Security 99 does not follow later sites into a zone. Under open question 3 ('retenu: garder la référence'), a site created in, or moved into, a district or commune already declared forbidden 'sans fin' keeps its reference security. It is then active and plannable, and the generator can schedule visits into a forbidden zone. The zone is also keyed on 1b dkey/ckey, so correcting adm2 or adm3 moves a site out of a declared zone without any log.
  - _Correction proposée_ : For security at least, store zone-level timelines (commune or district × period) and evaluate them at read time, combined with site points. Alternatively, re-materialise the zone in afterSitesChangedTx when a site is created or moved, with a log batch 'héritage de zone'. Test: a site created in a forbidden district is never generated.
- **[moyen]** Without a calendar the activity is treated as running every month, which contradicts the typed duration and the spec's own example. §7.1 sets running = null, meaning all months, whenever no calendar exists, which is the case for every row today. Capacity per period then becomes faisable × horizon months (school meal 52 × 12 = 624), not the 520 = 52 × 10 used in §7.5. The duration also stops limiting when visits can be placed (Asset 3 months, TLR Climate 0 months). With duration 0, mmrMath gives interval 0, not null, so coalesce(intervalle_effectif, …) returns 0 and every visited site becomes due.
  - _Correction proposée_ : Without a calendar, either exclude the pool from Plan réaliste with a warning ('pas de calendrier 2026'), or derive the running months from the duration with an explicit, shown convention. Treat duration 0 or interval 0 as 'not running' or null in effectiveMmr and effectiveInterval. Add tests for duration 0 and for a missing calendar.
- **[moyen]** The semantics of the general MMR row are undecided, so capacity can be counted twice or too low. The pool is the effective MMR row, and a general row inherited by several offices is ONE shared capacity (§7.3). Migration 032 says the general plan « vaut pour tous les bureaux », i.e. a per-office template. Demo data: general school meal 717 sites / 52 feasible, while AMP (213 / 30) and TLR (154 / 18) overrides have their own pools. If the general row is a national total, override offices are counted twice. If it is a per-office template, sharing one capacity under-plans. The §7.5 table treats the general row as one pool of 824 sites, which the generator would not do, since override offices' sites go to their own pools.
  - _Correction proposée_ : Decide before commit 10, and record the decision in CLAUDE.md, whether a general row is a template or an aggregate. If it is a template, use one pool per (inheriting office × row). Recompute the §7.5 example with the actual pool split, and add a generator test with general + override pools.
- **[moyen]** Calendar precedence silently overrides office overrides. resolveCalendar falls back to the parent or general calendar BEFORE the override's own typed duration. AMP school meal (override, typed 9) becomes 10 months as soon as a general calendar exists, with no warning: duree_differente_du_calendrier is only raised in manual mode. 'Créer un calendrier propre à ce bureau' also creates a full override, which silently stops the office inheriting later general-row edits.
  - _Correction proposée_ : Use this precedence: own calendar > own typed duration (override) > parent/general calendar. Warn whenever a typed duration differs from an inherited calendar. Say in the dialog that creating an office calendar freezes that office's other MMR values, or store calendars per (category × office) without creating an override.
- **[moyen]** Changing what due means silently changes three dashboards and how forbidden sites are shown. ProcessDashboardPage (:48, :102), DashboardCoveragePage (:73, :144 'Sites à jour = total − due') and FieldVisitsPage compute their KPIs from rbmSites.due. With due = selected level, any user rule set redefines 'Sites à jour'. Rule 1 (exclu) also turns forbidden sites into due=false, so they get a green « À jour » badge on the RBM page and count as up to date. Today scoreSite/isDue can return due=true for forbidden sites. The demo has 0 forbidden sites, so the '0 écart' proof never covered this, and §5.11 does not announce it.
  - _Correction proposée_ : Return the level and count exclu separately. Update the three dashboards to use 'selected' versus 'exclu' versus 'non'. Show Exclu (not À jour) on the RBM page. Add forbidden and inactive cases to the exhaustive parity grid, and list the dashboards in §5.11.
- **[moyen]** Retour 25 is only partly covered: the MMR risk is neither dated nor logged. The only 'Risk level' in the RBM workbook is per office × activity (Overreaching Parameters!G, B = Field Office), and it drives the MMR interval, the adjusted interval and therefore the generator. Changes to it, and to duration and faisable, have no history, no reason and no date. A mid-year change rewrites how past plans read. The spec dates only the site risk and security (open question 4, 'retenu: non'). Yet the site risk is not in the RBM workbook at all: it defaults to 'moyenne' or comes from the Plan de suivi FINAL SCORE.
  - _Correction proposée_ : At minimum, journal MMR parameter changes (who, when, before → after, mandatory reason), and stamp the MMR values used on each plan run. Offer dated MMR risk as an option, and reword open question 4 with this evidence.
- **[moyen]** Cross-lot migration and cache conflicts. SPEC_LOT_1B.md:810 already reserves 'migration 065' (submissions index, if the bench justifies it). SPEC_LOT_7A uses 062–064, and 064_data_changes installs per-table write triggers for its report cache, with a test that every domain table has one. Lot 5's new tables (site_risk_points, activity_calendar_months, priority_rule_*, plan_generation_runs) and the new site_visits columns change what report blocks read (risk of the month, priority, map). If they are not in the 7a domain map, cached report blocks will show stale risk and priorities.
  - _Correction proposée_ : Agree on migration numbers with 1b and 7a, for example renumber lot 5 to 066–069 or later. Add lot 5's tables to the 7a domain map and its dataChangesMigration test, and state this in §12.
- **[moyen]** Day-capacity accounting is wrong in some cases. With vpd < 1 (visits_per_day is numeric(6,2), so 0.5 is allowed), one visit costs 2 person-days. §7.2 'ouvre une journée : 1 jour-personne' and the prototype (Math.min(cost, U), need = U) charge only one, so dayCap is exceeded while the 'journée ≤ 100 %' invariant still passes. Travel days are charged once per district × month whatever the number of teams or journées, which understates the cost of real tours.
  - _Correction proposée_ : Charge ⌈cost ÷ U⌉ person-days for a visit whose cost exceeds one day, or reject vpd < 1 at the edge and in the database. Charge travel per team tour. Add the invariant usedDays ≤ dayCap with vpd 0.5 and with several teams in one district.
- **[moyen]** The MMR Excel round-trip resets manual durations. The bulk zod rule says 'auto ⇒ motif effacé', and mmrXlsx.js (export/import, not in the commit 2 files) does not carry durationMode or durationReason. Re-importing the MMR workbook therefore silently turns every manual duration back to auto and deletes its reason.
  - _Correction proposée_ : Add the mode and reason columns to mmrXlsx, or make both fields 'absent = unchanged' in /mmr/bulk. Add mmrXlsx to commit 2 with a round-trip test.
- **[moyen]** Several performance claims are unmeasured or were measured on unrepresentative data. The loader was measured on 1,280 sites with an EMPTY activation grid, not on 3,000 sites with a full grid (about 34,000 'Oui' cells). The rest is not measured at all:
- the dated-forbidden range join added to the 1b act CTE over up to 60 months;
- the RBM_SELECT LATERAL risk probe, which now also feeds three dashboards;
- a zone change on 1,000 sites, where each point fires a guard, a log and trg_same_tenant;
- apply with 3,000 visits through 5 same-tenant-checked foreign keys;
- the fingerprint recomputed on the main thread inside the apply transaction;
- run pages that parse a 1–8 MB jsonb on every request;
- the live /check, which reloads site variables on each keystroke;
- memory of the worker threads (2 × about 70 MB plus structured-clone copies) on the Windows target.
  - _Correction proposée_ : Add each item to perf:plan with a budget, including a filled grid and 3,000 sites, run under mems2_app. Cache the site scope per (tenant, month) for /check, with debounce. Store run pages in a side table or slice them in SQL. Hash the fingerprint in the worker thread.
- **[moyen]** Expert mode breaks the explainability required by retour 48. A single ifs()/case() expression produces no rule label, no position, no per-rule trace and no count of indeterminate results. The spec does not say what happens when the expression returns a value outside the allowed levels. The default snapshot and the 'Pourquoi ?' panel both depend on a rule label.
  - _Correction proposée_ : Either derive a branch-by-branch trace from the ifs/case AST (branch i = rule i), or keep table mode only in lot 5 and move expert mode to a later phase. Define the behaviour: an invalid value counts as 'non' and is flagged in the preview.
- **[mineur]** Smaller correctness gaps:
- The month can roll over between preview and apply. firstMonth = max(from, current month) depends on the clock and is not in the fingerprint, so an aperçu made on Oct 31 and applied on Nov 1 (24 h window) inserts 'planifie' visits in a past month.
- urgent and score_final sit in the month-independent scopeBase, yet both depend on security, which is now dated.
- The Plan de suivi « mois de référence de l'exercice » is undefined (today it is December of Y), and the '235 changes' figure depends on it.
- The interval is not defined across calendar breaks (calendar months or active months). The fractional gate (15.85) is not explained.
  - _Correction proposée_ : Reject apply with 409 apercu_expire when the current month is later than first_month, or include firstMonth in the fingerprint. Compute urgent and score per month. Define the reference month (current month for the running year, December for past years, January for future years) and recompute the figure. State that intervals count calendar months and that the gate is ⌈interval⌉.
- **[mineur]** Some claims in the spec do not match the code or the workbook:
- The central error handler maps 23514 to the generic « Données invalides. » (middleware/errors.js:31), so the trigger message « Le risque d'un site se modifie avec un motif » never reaches the client. The 422 'horizon trop large' is outside CLAUDE.md's error mapping.
- §0 item 10 lists the shortfalls for school meals, prevention and transfers but omits Asset creation (5) and Smallholder (7), both of which miss 80 % in §7.5.
- §2.2 omits workbook columns C (Point of Interest), F (Activity Tag, the key that assigns a site to its MMR pool), K (Urban Area) and H–M (admin levels and GPS), although the task asked for every parameter.
  - _Correction proposée_ : Check the reason in the service and throw an AppError 400 'motif_requis', keeping the trigger as a backstop. Use 400 for the volume guard. Correct §0. Complete the §2.2 table, including Activity Tag → sites.activity → MMR pool.
- **[mineur]** FR/EN gaps:
- Commits 6 and 9 add web/src/locales/en/priority.js and plan.js, but only commit 4 touches web/src/locales/en.js, which aggregates the modules. The new strings would silently fall back to French.
- The motifs of mems-defaut-1 and the plan explanations are rendered on the server in French, with French enum labels, and no lang parameter.
- site_visits.priority_reason freezes French text.
  - _Correction proposée_ : Add en.js to every commit that adds a locale module. Render code-template reasons with {lang}, like codeLabelText. Store the snapshot as rule code + parameters (or as FR + EN text). Add Playwright EN checks of the reasons.
- **[mineur]** Deviations from the shared definitions and CLAUDE.md that are not acknowledged:
- PLAN_RETOURS lists 'plan' among the documents covered by the retour 56 deletion policy (validated → justification + deletion journal). 'Retirer les visites encore prévues' deletes visits of an applied plan, writes the reason only on the run, and declares the run « pas un document ».
- New status tables (rule sets brouillon/active/archivée, runs apercu/applique/perime, why and report codes) do not get the CLAUDE.md `icon` → STATUS_ICONS mapping or StatusBadge.
  - _Correction proposée_ : Route withdrawals through the retour 56 deletion journal, or get an explicit owner decision recorded in the spec. Register every new status table with icon keys and use StatusBadge.
- **[mineur]** Some parts go beyond what was asked:
- A calendar ⇄ Excel round-trip (commit 3), although the user said « un popup suffit ».
- Expert mode, 20 calculated variables, a type pass, a version diff matrix and two templates, all in the first delivery.
- A worker_threads pool: a third way to run work, which departs from CLAUDE.md (« heavy → BullMQ worker »), for a pure compute of ≤ 450 ms.
- Full 1–8 MB results stored with per-section fingerprints, when the generator is deterministic and could simply be re-run at apply.
- Three more RBM tabs (seven in total).
  - _Correction proposée_ : Defer commit 3 and expert mode. Decide worker_threads versus BullMQ explicitly and record the choice in CLAUDE.md. Consider re-running the generator at apply and comparing a summary hash instead of storing full results. Group Règles / Journal / Plan réaliste under fewer tabs.
- **[mineur]** The urgent gap can monopolise capacity in the projection. Urgent flags are static over the horizon (criteria are not dated) and the urgent gap is 1 month. In the projection, each urgent site (9 sites with security 3 on the demo) is therefore re-planned every month for up to 24 months, which takes capacity from coverage, although after a visit the issue would normally be re-assessed.
  - _Correction proposée_ : Apply the urgent gap only until the first planned visit in the horizon, or until the criteria are updated. Make the cap a parameter (for example at most N urgent revisits per horizon) and show it in the explanation.
