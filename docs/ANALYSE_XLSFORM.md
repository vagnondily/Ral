# Analyse des 5 XLSForm de suivi de processus — indicateurs, groupes répétés, « Autre (préciser) »

*Analyse du 14/10/2026 (retours 81 et 85). Fichiers lus en lecture seule (`openpyxl`, valeurs seulement, aucune macro, aucun lien externe ; aucun `vbaProject.bin` dans les cinq classeurs). Aucun fichier du dépôt modifié.*

## 0. Résumé

| Fiche (tableau de bord) | form_id (settings) | Données | Groupes répétés | Modèle du dépôt | Variables du modèle trouvées par nom |
|---|---|---|---|---|---|
| MG03 - ProcessMDG GD/PREVMA_v2 | `MDG_Process_Monitoring_GD_PREVMA_v2` | 218 q. (101 Oui/Non) | 3 | **GD** (« Unconditional resource transfers… ») | **57/59** (0 en sous-table) |
| Suivi SMP *(titre XLSForm : « MDG SMP 2025 - 2026 »)* | `MDG_SMP_2025_2026` | 289 q. (101 Oui/Non) | 4 | **SMP** (« School meal activities ») | **65/65** (4 en sous-table) |
| MG03 - MDG PECMAM - V3 | `MDG_Process_Monitoring_NutritionAIM` | 241 q. (114 Oui/Non) | 2 | **MAM** (« Nutrition treatment activities ») | **35/35** (1 en sous-table) |
| MG03 - PM MIARO *(titre : « … (v 12_07_2026) »)* | `MDG_Process_Monitoring_MIARO_PROD_Janv2026` | 374 q. (129 Oui/Non) | 9 (dont le module magasin entier) | **STUNT** (« Malnutrition prevention activities ») | **28/28** (2 en sous-table) |
| MDG PM RESILIENCE - v4 | `MDG_PROCESS_MONITORING_RESILIENCE_SAMS_V2_1` | 480 q. (202 Oui/Non) | 4 | **aucun** | GD : 22/59 par recouvrement du bloc distribution, aucun modèle propre |

**Pourquoi « 0 indicateur noté » alors que les modèles correspondent presque à 100 %.** Les noms de variables des modèles (`indicatorTemplates.json`) sont ceux de ces formulaires : le problème n'est pas l'appariement des noms, c'est que **rien ne crée les indicateurs tout seul**. Dans le code actuel :

1. **Le modèle n'est proposé que si la fiche a une `activity_category`** (`monitoring.repository.formTemplate` → `indicatorTemplates.templateForActivity`), et cette catégorie doit être **égale, casse ignorée, au `mmrCategory` anglais du catalogue** (`lower(t.mmrCategory) === lower(activityCategory)`, sans normalisation des espaces). Ni l'import de la définition (`POST /import-definition` → `repository.importDefinition`), ni l'import des soumissions ne rattachent la fiche : l'écran propose l'activité (`web/src/lib/activitySuggest.js`, suggestion plausible pour les 5 fiches) mais il faut la confirmer. `formHints` (GD, PREVMA, SMP, MIARO, PECMAM…) existe dans le JSON mais **n'est lu nulle part**.
2. **Même rattachée, la fiche n'a aucun indicateur tant que l'utilisateur n'a pas cliqué « Créer N indicateur(s) »** dans la carte du modèle (`TemplateBindingCard.jsx` → `POST /forms/:id/template/apply`). Les variables « Trouvée » / « Probable » sont pré-cochées, mais rien n'est écrit sans ce clic. Sans indicateur, `coverageDashboard.classDistribution` renvoie `scored = 0` et toutes les cartes sont vides.
3. **RÉSILIENCE n'a pas de modèle** : le catalogue ne contient que GD, SMP, MAM, STUNT. La suggestion d'activité donne « Smallholder agricultural market support activities » (mot-clé SAMS) ; `templateForActivity` renvoie alors `null`, **et la carte du modèle ne s'affiche pas du tout** (`if (!data.template) return form.activityCategory ? null : <Alert…>`) — échec silencieux, `apply` répondrait 400. Le formulaire couvre en plus 3 catégories du MMR (petits producteurs/SAMS, création d'actifs/FFA, adaptation climatique/assurance), alors qu'une fiche n'a qu'une catégorie.
4. **Une catégorie MMR libellée autrement** que le catalogue (traduction, espace double, suffixe) donne le même silence : la fiche est « rattachée » mais aucun modèle ne s'affiche.
5. **Les indicateurs pré-cochés dont la variable est dans un groupe répété sont créés quand même** (le catalogue XLSForm les contient, `parseXlsformRows` ne distingue pas `begin_repeat` de `begin_group`) puis restent « Non évalué / variable absente » : l'import ne lit que la 1ʳᵉ feuille d'un `.xlsx` (`submissionsImport.parseXlsx` : `wb.worksheets[0]`), seulement `data.sav` d'un zip, et `submissionsFromObjects` (API Kobo) écarte les valeurs objet/tableau — donc les répétitions. L'avertissement « Sous-table non importée » de la carte (`warnings: ['groupe']`) ne bloque pas la création.
6. **Quelques liaisons du modèle sont fausses pour ces formulaires** (détail par fiche) : `MIARO_NO_DELAY` lié à `risk_delay` (vaut 1 aussi quand la question n'est pas posée et quand il n'y a « pas de délai »), `MIARO_SBCC_SATISF` / `MIARO_DIGNITY` liés à des ratios 0–1 alors que le formulaire fournit `r_*_pct` (0–100), libellés qui ne décrivent pas la question liée (`GD_DPMC_TRAINED` → présence des membres, `GD_WH_PALLETS` → empilage, `SMP_KITCHEN_CLEAN` → zone de stockage séparée, `MAM_CHILD_MUAC` → bande MUAC disponible…), deux éléments GD sans aucune option correspondante (`GD_DIGN_BREASTFEED`, `GD_DIGN_HEALTH`).

**Ce qu'il faut faire pour voir des chiffres tout de suite (sans code)** : pour chaque fiche, Configuration › Rattacher à l'activité proposée, puis « Créer N indicateur(s) » dans la carte du modèle (en décochant les éléments marqués SOUS-TABLE ci-dessous), puis lier à la main `r_no_delay`, `r_sbcc_satisf_pct`, `r_dign_prop_pct` pour MIARO. RÉSILIENCE demande un modèle « RES » (proposé au § 5) ou des indicateurs créés à la main.

**Groupes répétés** : 22 répétitions sur les 5 formulaires, dont 2 imbriquées (MIARO). Dans un export Kobo `.xlsx` (« XML values and headers »), chaque répétition est **une feuille séparée** nommée d'après le `name` du `begin_repeat` (tous ≤ 28 caractères ici, donc pas de troncature à 31), une ligne par occurrence, avec les colonnes de la répétition + `_index` (n° de la ligne dans la feuille), `_parent_table_name` (feuille parente : la feuille principale ou la répétition englobante), `_parent_index` (= `_index` de la ligne parente), `_submission__id`, `_submission__uuid` (= `_uuid` de la soumission), `_submission__submission_time`, `_submission__validation_status`, etc. La feuille principale ne contient de la répétition que les champs calculés qui l'agrègent (`sum(...)`, `count-selected(...)`) et la variable qui fixe le nombre de lignes (`nb_teacher`, `CPHHToSurvey`…). Dans l'API Kobo v2 (JSON), une répétition est un tableau d'objets sous la clé `chemin/du/groupe`, chaque objet ayant des clés `chemin/du/groupe/champ`.

**« Autre (préciser) »** : 244 couples (question à choix, choix « Autre » — code 999, parfois 9999, 99, 5 ou `other`) sur les 5 formulaires ; 186 sont liés à une question texte « préciser » par son `relevant`, 58 n'ont aucune précision. 41 liaisons utilisent l'égalité `${X}='999'` au lieu de `selected(${X},'999')` — sur 7 questions à choix **multiples**, la précision n'est alors demandée que si « Autre » est le **seul** choix coché. Aujourd'hui, MEMS compte le code 999 comme une réponse ordinaire (non positive) et n'exploite la précision que pour les dimensions du Mapping MEMS (`memsMapping.OTHER_VALUES` / `OTHER_SUFFIXES`), jamais dans les indicateurs ni dans l'explication. Le code 9999 signifie « Autre (préciser) » dans `EnuList` mais « Sans objet » dans `Yesnona` : les codes hors base doivent se lire **par liste**, jamais globalement.

## 1. Méthode et fichiers produits

Scripts (dans `xlsform_analysis/`, lancés avec `python3 -I`, chemins passés en argument) :

- `inspect_zip.py` (inventaire des parties du zip), `headers.py`, `parse_xlsform.py` → `json/<form_id>.json` (settings, lignes survey avec chemin de groupes/répétitions, listes de choix) ;
- `structure.py`, `lists.py` (`lists.txt`), `candidates.py` → `csv/<form_id>.candidates.csv` (**toutes** les questions select / numériques / calculées avec liste, code « Oui », codes hors base, répétition, `relevant` propre et chaîne des `relevant` des groupes, proposition heuristique) ;
- `template_match.py` → `template_match.json` (rejoue `suggestBindings` : nom exact casse ignorée, « X/k » = « X.k », repli sur le libellé Jaro-Winkler ≥ 0,86 ; options éclatées simulées) ;
- `other_specify.py` → `csv/<form_id>.other_specify.csv` ; `spec_additions.py` + `gen_parts.py` → `parts/*.md` (tableaux ci-dessous, chaque variable et chaque code positif / hors base **vérifié** contre la définition : 0 erreur).

Conventions des tableaux : **Sens** ↑ = plus haut = mieux (`higher_better`), ↓ = plus bas = mieux (`lower_better`), info = non noté. **Méthode · pos. · hors base** = `agg` · `positiveValue` (« 1|2 » = plusieurs codes positifs) · `naValues`. La **base** (dénominateur) d'un indicateur est, comme dans `monitoringMath.tallyIndicator`, l'ensemble des soumissions où la variable est **présente et non vide** et hors codes hors base : la condition `relevant` de la question **et celle de tous ses groupes** définissent donc la population (ex. un indicateur du module « Entretien avec les mères » ne porte que sur les visites où ce module a été coché). Exception à surveiller : une question **obligatoire sans condition** (`required=yes`, groupe sans `relevant`) est répondue à chaque visite, sa base = toutes les visites. SOUS-TABLE = la variable est dans un groupe répété (absente des données importées aujourd'hui).

## 2. MG03 - ProcessMDG GD/PREVMA_v2 (`MDG_Process_Monitoring_GD_PREVMA_v2`)

**En bref.** Un formulaire pour deux activités du MMR : `DTPAsstActivityCRF` (choix multiple) 1 = GD (transferts inconditionnels), 6 = PREVMA (prévention de la malnutrition). Sélecteurs de module : `process_monitoring` (choix multiple : 1 suivi de distribution, 2 magasin, 3 MDM, 4 FGD bénéficiaires) et `DTPAsstMode` (1 vivres…). Le modèle **GD** couvre presque tout (57/59). Points à connaître :

- **Bases (dénominateurs)** : `ObservationMonitoring_module` (27 questions) et `TechnicalWarehouse_submodule` (52) n'ont **aucune condition** sur `process_monitoring` ; dans le magasin, `MOFoodStored`, `MOWhStackPall`, `MOWhBagsCloseProp` sont obligatoires → répondues à **chaque** visite, y compris les FGD : leurs pourcentages portent sur toutes les visites, pas sur les visites de magasin. Le module PREVMA (`ObservationMonitoring_module_nut`) ne s'ouvre que si `DTPAsstActivityCRF` contient 6 ; les entretiens ménages exigent `RESPConsent_DM = 1`, posé seulement si `process_monitoring` contient 4. Seul le choix 4 de `process_monitoring` est utilisé dans les `relevant` : les choix 1, 2 et 3 n'ouvrent ni ne ferment aucun module (le choix 1 ne sert qu'aux scores calculés).
- **Défauts du formulaire** qui faussent un indicateur : `HHAsstPayEntHow1`, `HHDistDiv1`, `HHDistDiv11`, `FraudNature1`, `FraudNature11` (« avez-vous signalé… ») **n'ont pas de `relevant`** → posées à tous, même sans paiement/détournement ; à n'exploiter qu'à travers un champ calculé MEMS du type `if(HHAsstPayEnt = 1, HHAsstPayEntHow1, null)`. `MOWhOffLoadWayBill/Counted/PropCheck` ne dépendent pas de `MOWhOffLoadYN` (alors que c'est le cas dans PECMAM). `MOAsstCBTRed` est une question Oui/Non libellée « Si oui, expliquez ».
- **Scores calculés dans le formulaire** (`ScoreEff_norm`, `ScoreQual_norm`, `ScorePAP_norm`, `ScoreRisk_norm`, `SitePerformanceIndex`, `SiteRiskFlag`) : tout est enveloppé dans `if(selected(${process_monitoring},'1'), …, 0)` et une réponse absente compte 0 (pas « sans objet ») → une visite sans le choix 1 obtient `SitePerformanceIndex` = 25 (la seule part « risques », pleine par défaut). À afficher comme information, pas comme indicateur noté.
- La feuille « Sheet1 » du classeur (« Variables clés par dimension » : Efficacité, Qualité, Protection_AAP, Risques) cite 7 variables absentes du modèle GD (`MOBenSizePlnAct`, `MOAsstIKTotal`, `HHDTPDelay`, `HHDTPTimeWalk`, `MODPMCRepres`, `MOAsstIKRed`, `MOAsstCBTRed`) : les 6 utilisables sont ajoutées ci-dessous.
- Cause probable de « 0 indicateur » pour cette fiche : activité non rattachée et/ou modèle non appliqué (le nom de la fiche est exactement le titre de l'XLSForm : la définition a vraisemblablement été importée sur cette fiche).

#### Structure

- **form_id** : `MDG_Process_Monitoring_GD_PREVMA_v2` · **titre** : « MG03 - ProcessMDG GD/PREVMA_v2 » · **version** : `v1` · langue par défaut : French (fr) · fichier : `7ef40f87-MDG_Process_Monitoring_GD_PREVMA_v2_17.xlsx`
- **Questions par type** : select_one 121, select_multiple 35, integer 3, decimal 8, text 43, calculate 21, note 19, date 1, geopoint 2, image 5, begin_group 33, begin_repeat 3 — soit **218 questions de données** (hors notes, calculs, métadonnées).
- Feuille(s) supplémentaire(s) : Sheet1.

**Modules (groupes de 1er et 2e niveau)** — q = questions de données incluses ; condition = `relevant` du groupe (base de tous ses indicateurs) :

- `Technical_module` « Technique » (q=7)
  - `TechnicalBasic_submodule` « Technique (De base) » (q=7)
- `Technical_module_DP` « Technique » (q=10)
  - `TechnicalDP_submodule` « Technique (point de distribution) » (q=10)
- `Distribution_monitoring` « Suivi de distribution » (q=68)
  - RÉPÉTITION `FGD_Benef` « Qui sont les participants : » (q=2) — condition `selected(${process_monitoring},'4')`
  - `ConsentMon_submodule` « Consentement (suivi) » (q=1) — condition `selected(${process_monitoring},'4')`
  - `Assistance_module` « Assistance : Dû, utilisation et qualité, disponibilité, com… » (q=33)
  - `ProtectionAAP_module` « Protection et responsabilité à l'égard des populations affe… » (q=32)
- `ObservationMonitoring_module_nut` « Suivi Observation » (q=16) — condition `selected(${DTPAsstActivityCRF}, '6')`
  - `NutritionMgm_submodule` « Gestion du programme » (q=15)
  - `NUTBeneficiaryVerif_submodule` « Vérification des bénéficiaires (Nutrition) » (q=1)
- `ObservationMonitoring_module` « Suivi Observation (GD) » (q=35)
  - `DistributionCond_submodule` « Conditions de distribution » (q=23)
  - `DistributionElements_submodule` « Éléments de distribution - Qualité » (q=12)
- `FoodDistribution_module` « Distribution de denrées alimentaires » (q=11)
  - `MCEnumerator_submodule` « Comité de gestion » (q=11) — condition `selected(${DTPAsstMode}, '1')`
- `TechnicalWarehouse_submodule` « Contrôle du magasin » (q=70)
  - `warehouse_hr` « Ressources humaines » (q=8)
  - `MOWhInventory` « Inventaire et suivi des stocks » (q=10)
  - `WhDocuments_submodule` « Documentation et traçabilité » (q=14)
  - `WhOffLoading_submodule` « Déchargement de l'entrepôt » (q=4)
  - `WhObservation_submodule` « Conditions de stockage et qualite des vivres » (q=33)
- `score` « Perfomance du Sites » (q=0)

#### Groupes répétés

| Répétition | Libellé | Parent | Nombre de lignes (`repeat_count`) | Condition | Questions (hors notes) |
|---|---|---|---|---|---|
| `FGD_Benef` | Qui sont les participants : | table principale | `libre` | `selected(${process_monitoring},'4')` | `FGDPartName`, `FGDPartSexe` |
| `MOAsstIKRecRepeat` | *Répétition des questions pour chaque produit sél… | table principale | `count-selected(${MOAsstIKRec})` | `selected(${DTPAsstMode}, '1')` | `MOAsstIKRecCode`ᶜ, `MOAsstIKRecName`ᶜ, `MOAsstIKRecAmt`, `MOAsstIKRecUM`, `MOAsstIKRecUM_oth`, `MOAsstIKRecCond`, `MOAsstIKRecCond_oth` |
| `RepeatSmpCommodity` | Répètez les questions pour chaque type de vivre d… | table principale | `count-selected(${MOWhWhatComm})` | `count-selected(${MOWhWhatComm})>=1` | `CommodityName`ᶜ, `CommodityLabel`ᶜ, `MOComOpeningBalance`, `MOComReceived`, `MOFoodReceivedMatch`, `MOComDamaged`, `MOComDistributed`, `MOCloseBalance`ᶜ, `MOActualBalance`, `MOFoodBalanceFin`ᶜ, `MOFoodBalanceDiff`ᶜ, `MOFoodBalanceDiff_note`, `MOFoodDifferenceinfo` |

ᶜ = champ calculé (exporté aussi).

#### Indicateurs du modèle d'activité existant, vérifiés sur ce formulaire

Modèle **GD** : 57/59 indicateurs trouvés par nom (0 dans une sous-table) ; 39 notés.

| Code modèle | Variable trouvée | Méthode · pos. · hors base | Sens | Dom. | Remarque |
|---|---|---|---|---|---|
| `GD_DIST_LIST_NUT` | `MODistrList_nut` | percent_yes · 1 | ↑ | D1 | OK |
| `GD_LIST_MATCH` | `MOActBenListMATCHBenDisList` | percent_yes · 1 | ↑ | D1 | OK |
| `GD_LIST_COMPLETE` | `MODisListComplete` | percent_yes · 1 | ↑ | D1 | question = registre complet (noms, ID, signature) ; « sans doublon » non mesuré |
| `GD_BEN_CHECK_NUT` | `MOBenCheck_nut` | percent_yes · 1 | ↑ | D1 | OK |
| `GD_SCOPE_USE` | `Scope_use` | percent_yes · 1 | ↑ | D1 | OK |
| `GD_ENT_MARKED_NUT` | `MOEntMarked_nut` | percent_yes · 1 | ↑ | D1 | OK |
| `GD_ENT_CALC` | `MOCorrectEntDisCalculation` | percent_yes · 1 | ↑ | D1 | OK |
| `GD_DUPLICATION` | `MODuplicationBenef` | percent_yes · 1 | ↑ | M4 (non noté) | la question demande si les noms SONT dans la liste (Oui = bien) ; libellé « absence de doublons » trompeur |
| `GD_SIGNED_LIST` | `MOSignedDisList` | percent_yes · 1 | ↑ | M4 (non noté) | OK |
| `GD_BENEF_OTHER` | `MOBenefOther` | percent_yes · 1 | ↓ | M4 (non noté) | OK |
| `GD_BENEF_OTHER_ASSISTED` | `MOBenefOtherWhatAss` | percent_yes · 1 | ↑ | M4 (non noté) | sens à décider : Oui = assistance obtenue avec la carte d'un autre (souplesse ou fraude) |
| `GD_DIST_DIV_OBS` | `MODistDiv` | percent_yes · 1 | ↓ | M1 (non noté) | OK |
| `GD_FRAUD_OBS` | `MOFraudConcerns` | percent_yes · 1 | ↓ | M1 (non noté) | OK |
| `GD_BEN_CHECK` | `MOBenCheck` | percent_yes · 1 | ↑ | M1 (non noté) | OK |
| `GD_BEN_CHECK_BIO` | `MOBenCheckBio` | percent_yes · 1 | ↑ | M1 (non noté) | OK |
| `GD_DIST_LIST` | `MODistrList` | percent_yes · 1 | ↑ | M1 (non noté) | OK |
| `GD_DIGN_QUEUE` | `MODistPtsDign` (option éclatée) | percent_yes · 1 | ↑ | D2 | option 1 = contrôle des foules / files (pas « séparation H/F ») |
| `GD_DIGN_SHADE` | `MODistPtsDign` (option éclatée) | percent_yes · 1 | ↑ | D2 | OK |
| `GD_DIGN_SEATS` | `MODistPtsDign` (option éclatée) | percent_yes · 1 | ↑ | D2 | OK |
| `GD_DIGN_LATRINES` | `MODistPtsDign` (option éclatée) | percent_yes · 1 | ↑ | D2 | OK |
| `GD_DIGN_CHILDREN` | `MODistPtsDign` (option éclatée) | percent_yes · 1 | ↑ | D2 | OK |
| `GD_DIGN_WATER` | `MODistPtsDign` (option éclatée) | percent_yes · 1 | ↑ | D2 | OK |
| `GD_DIGN_BREASTFEED` | — *(aucune)* | percent_yes · 1 | ↑ | D2 | aucune option correspondante dans DistPtElementsDignity (11 options) : retirer ou remplacer par /5, /6, /9, /10, /11 |
| `GD_DIGN_HEALTH` | — *(aucune)* | percent_yes · 1 | ↑ | D2 | idem : pas d'option « personnel de santé » |
| `GD_INFO_SESSION` | `MOInfoSession` | percent_yes · 1 · 9999 | ↑ | D4 | OK |
| `GD_HOTLINE_DISPLAYED` | `HHAsstRecInfoLe` | percent_yes · 1 | ↑ | D4 | liste YesnoNoInfo : 2 « jamais reçu d'info » compté négatif |
| `GD_CFM_VISIBLE` | `MODistPtsCFM` | percent_yes · 1 | ↑ | D4 | OK |
| `GD_STAFF_VISIBLE` | `MOStaffVisibility` | percent_yes · 1 · 9999 | ↑ | D4 | OK |
| `GD_STAFF_MIXED` | `MOStaffMixGender` | percent_yes · 1 · 9999 | ↑ | D4 | OK |
| `GD_PRIOR_VULN` | `MOPriorVuln` | percent_yes · 1 · 9999 | ↑ | D4 | OK |
| `GD_HELPDESK` | `MOHelpDesk` | percent_yes · 1 · 9999 | ↑ | D4 | OK |
| `GD_VISIBILITY` | `MOVisibDisplayed` | percent_yes · 1 · 9999 | ↑ | M5 (non noté) | OK |
| `GD_KNOW_FREQ` | `HHAsstKnowFreq` | percent_yes · 1 | ↑ | D3 | OK |
| `GD_INFO_RECEIVED` | `HHAsstRecInfo` | percent_yes · 1 | ↑ | D3 | idem (YesnoNoInfo) |
| `GD_MC_KNOW` | `HHAsstMCKnow` | percent_yes · 1 · 9999 | ↑ | D3 | question = connaît le comité de gestion (pas le mécanisme de plainte) |
| `GD_RESPECT` | `HHAsstRespect` | percent_yes · 1 | ↑ | D3 | OK |
| `GD_NOT_PAID` | `HHAsstPayEnt` | percent_value · 0 | ↑ | D3 | OK |
| `GD_PAY_TRANSPORT` | `HHAsstPayTrsp` | percent_yes · 1 | ↓ | M2 (non noté) | OK |
| `GD_TRAVEL_DAY` | `HHAsstTrvlDay` | percent_yes · 1 · 888 | ↑ | M2 (non noté) | question = « temps de rentrer avant la nuit » : renommer |
| `GD_CFM_USED` | `HHAsstUseCFM` | percent_yes · 1 | ↑ | M3 (non noté) | OK |
| `GD_CFM_KNOW` | `HHInfoCFMKnowAcc` | percent_yes · 1 | ↑ | M3 (non noté) | OK |
| `GD_CFM_SUPPORT` | `HHInfoCFMSupport` | percent_yes · 1 | ↑ | M3 (non noté) | OK |
| `GD_MC_REPORTS` | `HHAsstMCRepo` | percent_yes · 1 | ↑ | M7 (non noté) | OK |
| `GD_NO_SECURITY_INCIDENT` | `HHAsstSecurity` | percent_value · 0 | ↑ | M9 (non noté) | OK |
| `GD_WAIT_2H` | `HHAsstTime` | percent_value · 4 · 888 | ↓ | KPI (non noté) | OK |
| `GD_ARMED` | `MOAsstArmed` | percent_yes · 1 | ↓ | D7 | OK |
| `GD_DIVERSION_HH` | `HHDistDiv` | percent_yes · 1 | ↓ | D7 | OK |
| `GD_FRAUD_HH` | `HHFraudConcerns` | percent_yes · 1 | ↓ | D7 | OK |
| `GD_SAFE_ACCESS` | `HHAsstSafeLevel` | percent_value · 1\|2 | ↑ | D7 | OK |
| `GD_DPMC_PRESENT_DIST` | `MODPMCPresenctYN` | percent_yes · 1 | ↑ | D5 | OK |
| `GD_DPMC_EXISTS` | `MODPMC` | percent_yes · 1 | ↑ | D5 | question = existence du PV de nomination (pas présence sur site) |
| `GD_DPMC_TRAINED` | `MODPMCMemb` | percent_yes · 1 · 888 | ↑ | D5 | MODPMCMemb = membres PRÉSENTS lors de la visite, pas « formés » : renommer |
| `GD_DPMC_ROLES` | `MODPMCRoles` | percent_yes · 1 | ↑ | D5 | OK |
| `GD_DPMC_REPORT` | `MODPMCReport` | percent_yes · 1 · 888 | ↑ | D5 | OK |
| `GD_WH_CONDITION` | `MOStorageCondition` | percent_yes · 1 | ↑ | D6 | OK |
| `GD_WH_PALLETS` | `MOWhStackProp` | percent_yes · 1 | ↑ | D6 | MOWhStackProp = sacs correctement empilés ; « sur palettes » = MOWhStackPall/1 |
| `GD_WH_STOCK_RECORD` | `MOWhReceipt` (option éclatée) | percent_yes · 1 | ↑ | D6 | sans colonnes éclatées dans les données, retombe sur MOWhStockCard (probable) |
| `GD_WH_DELIVERY` | `MODeliveryOnTime` | percent_yes · 1 | ↑ | D6 | OK |
| `GD_WH_DAMAGED_ISOL` | `MOWHBadCommodIsol` | percent_yes · 1 | ↑ | D6 | OK |

#### Indicateurs supplémentaires proposés

| Code proposé | Libellé FR | Variable (`name`) | Type · liste (Oui=) | Méthode · pos. · hors base | Sens | Module / dimension | Condition propre (`relevant`) | Remarque |
|---|---|---|---|---|---|---|---|---|
| `GD_PART_RATE_80` | Taux de participation ≥ 80 % du prévu | `MOBenSizePlnAct` | select_one `BeneficiaryRate` | percent_value · 5 | ↑ | KPI · Chiffres clés | — | échelle BeneficiaryRate |
| `GD_IK_TOTAL` | Quantité totale reçue par le partenaire | `MOAsstIKTotal` | decimal | sum · — | info | KPI · Chiffres clés | `selected(${DTPAsstMode}, '1')` | vivres seulement |
| `GD_START_LT30` | Démarrage avec moins de 30 min de retard | `HHDTPDelay` | select_one `DistLateTime` | percent_value · 1 · 888 | ↑ | M2 · Accès & transport | — | liste sans code 0 dans ce formulaire |
| `GD_WALK_LT1H` | Trajet aller ≤ 1 h | `HHDTPTimeWalk` | select_one `DistMinCl` | percent_value · 100\|201 · 888 | ↑ | M2 · Accès & transport | — |  |
| `GD_RATION_CUT` | Réduction / substitution de ration | `MOAsstIKRed` | select_one `Yesnodk` (Oui=1) | percent_yes · 1 · 888 | ↓ | D7 · Sécurité / intégrité | `selected(${DTPAsstMode},'1')` |  |
| `GD_ENT_AS_ANNOUNCED` | Dû reçu = dû annoncé | `HHAsstEntRcCm` | select_one `Yesnodk` (Oui=1) | percent_yes · 1 · 888 | ↑ | D3 · AAP / redevabilité | — | CBT seulement |
| `GD_ACCESS_DIFF` | Difficultés d'accès à l'assistance | `HHAsstAccessLast` | select_one `Yesnodk` (Oui=1) | percent_yes · 1 · 888 | ↓ | D7 · Sécurité / intégrité | — |  |
| `GD_HELPDESK_HH` | Help desk présent (ménages) | `HHAsstRecInfoYa` | select_one `YesnoNoInfo` (Oui=1) | percent_yes · 1 | ↑ | D4 · AAP / redevabilité | — | 2 = « jamais reçu d'info » compté négatif |
| `GD_COMPLAINT_CMTE` | Comité de plainte existant (ménages) | `HHAsstRecInfoEx` | select_one `YesnoNoInfo` (Oui=1) | percent_yes · 1 | ↑ | D4 · AAP / redevabilité | — | idem |
| `GD_PSEA_POSTERS` | Affiches PSEA / fraude visibles | `HHAsstRecInfo_Le` | select_one `YesnoNoInfo` (Oui=1) | percent_yes · 1 | ↑ | D4 · AAP / redevabilité | — | idem |
| `GD_PAY_REPORTED` | Paiement / faveur signalé au CFM | `HHAsstPayEntHow1` | select_one `Yesno` (Oui=1) | percent_yes · 1 | ↑ | D3 · AAP / redevabilité | — | SANS relevance : à filtrer HHAsstPayEnt=1 (champ calculé) |
| `GD_DIV_REPORTED` | Détournement signalé au CFM | `HHDistDiv1` | select_one `Yesno` (Oui=1) | percent_yes · 1 | ↑ | D3 · AAP / redevabilité | — | idem, filtrer HHDistDiv=1 |
| `GD_DPMC_REPRES` | Comité représentatif des communautés | `MODPMCRepres` | select_one `Yesnodk` (Oui=1) | percent_yes · 1 · 888 | ↑ | D5 · Gouvernance du comité de gestion (DPMC) | `selected(${MODPMCMemb}, '1')` |  |
| `GD_DPMC_PV_ONSITE` | PV de nomination consultable sur place | `MODPMCNomination` | select_one `Yesno` (Oui=1) | percent_yes · 1 | ↑ | D5 · Gouvernance du comité de gestion (DPMC) | `${MODPMC} = '1'` |  |
| `GD_DPMC_BRIEFED` | Membres du comité informés (briefing) | `MODPMDistMtg` | select_one `Yesnodk` (Oui=1) | percent_yes · 1 · 888 | ↑ | D5 · Gouvernance du comité de gestion (DPMC) | `selected(${MODPMCMemb}, '1')` |  |
| `GD_GROUP_SHARING` | Rations combinées à partager (distribution par groupe) | `MOAsstIKRecStandMethod` | select_one `Yesno` (Oui=1) | percent_yes · 1 | ↓ | M1 · Conditions de distribution | `selected(${DTPAsstMode}, '1')` | sens à confirmer |
| `GD_DIGN_HANDWASH` | Dispositif de lavage des mains | `MODistPtsDign/5` | option de select_multiple `DistPtElementsDignity` | percent_yes · 1 | ↑ | D2 · Dignité et conditions site distribution | — | option éclatée |
| `GD_DIGN_DISTANCE` | Distance du personnel respectée | `MODistPtsDign/6` | option de select_multiple `DistPtElementsDignity` | percent_yes · 1 | ↑ | D2 · Dignité et conditions site distribution | — | option éclatée |
| `GD_DIGN_PWD` | Accessibilité personnes handicapées | `MODistPtsDign/9` | option de select_multiple `DistPtElementsDignity` | percent_yes · 1 | ↑ | D2 · Dignité et conditions site distribution | — | option éclatée |
| `GD_DIGN_HELPDESK` | Point d'assistance (dignité) | `MODistPtsDign/10` | option de select_multiple `DistPtElementsDignity` | percent_yes · 1 | ↑ | D2 · Dignité et conditions site distribution | — | option éclatée |
| `GD_DIGN_BOX` | Boîte de doléance | `MODistPtsDign/11` | option de select_multiple `DistPtElementsDignity` | percent_yes · 1 | ↑ | D2 · Dignité et conditions site distribution | — | option éclatée |
| `GD_WH_STAFF` | Personnel dédié au magasin | `MOWhHrdisp` | select_one `Yesno` (Oui=1) | percent_yes · 1 | ↑ | D6 · Entrepôt / stock | — |  |
| `GD_WH_STAFF_TRAINED` | Personnel du magasin formé | `MOWhHrtrain` | select_one `Yesno` (Oui=1) | percent_yes · 1 | ↑ | D6 · Entrepôt / stock | — |  |
| `GD_WH_SAFETY_PROC` | Procédures sécurité / urgence connues | `MOWhHrknowproc` | select_one `Yesno` (Oui=1) | percent_yes · 1 | ↑ | D6 · Entrepôt / stock | — |  |
| `GD_WH_TOOLS` | Outils de suivi maîtrisés | `MOWhHrknowtrack` | select_one `Yesno` (Oui=1) | percent_yes · 1 | ↑ | D6 · Entrepôt / stock | — |  |
| `GD_WH_DOCS_SIGNED` | Documents signés / cachetés | `MOWhDocsSigned` | select_one `Yesno` (Oui=1) | percent_yes · 1 | ↑ | D6 · Entrepôt / stock | — |  |
| `GD_WH_DOCS_GOOD` | Documents en bon état | `MOWhDocsGoodCond` | select_one `Yesno` (Oui=1) | percent_yes · 1 | ↑ | D6 · Entrepôt / stock | — |  |
| `GD_WH_LOSS_REPORTED` | Pertes / dommages signalés | `MOWhAllDamageRep` | select_one `Yesno` (Oui=1) | percent_yes · 1 | ↑ | D6 · Entrepôt / stock | — |  |
| `GD_WH_WAYBILL_ACCURATE` | Lettres de voiture exactes | `MOWhWayBillRep` | select_one `Yesno` (Oui=1) | percent_yes · 1 | ↑ | D6 · Entrepôt / stock | — |  |
| `GD_WH_LESS` | LESS Last Mile utilisé | `MOWhLESSLastMile` | select_one `YesnoPartially` (Oui=1) | percent_value · 1 | ↑ | D6 · Entrepôt / stock | — | 2 = partiel (négatif) |
| `GD_WH_PORTERS` | Manutention correcte | `MOWhPorterCarry` | select_one `YesnoPartially` (Oui=1) | percent_value · 1 | ↑ | D6 · Entrepôt / stock | — | 2 = partiel |
| `GD_WH_OFFLOAD_WAYBILL` | Déchargement : lettre de voiture remplie | `MOWhOffLoadWayBill` | select_one `Yesno` (Oui=1) | percent_yes · 1 | ↑ | D6 · Entrepôt / stock | — | SANS relevance (devrait être MOWhOffLoadYN=1) |
| `GD_WH_OFFLOAD_COUNTED` | Déchargement : sacs comptés | `MOWhOffLoadCounted` | select_one `Yesno` (Oui=1) | percent_yes · 1 | ↑ | D6 · Entrepôt / stock | — | idem |
| `GD_WH_OFFLOAD_CHECKED` | Déchargement : état vérifié | `MOWhOffLoadPropCheck` | select_one `Yesno` (Oui=1) | percent_yes · 1 | ↑ | D6 · Entrepôt / stock | — | idem |
| `GD_WH_PALLETS_REAL` | Vivres sur palettes | `MOWhStackPall/1` | option de select_multiple `whstacked` | percent_yes · 1 | ↑ | D6 · Entrepôt / stock | — | remplace la variable de GD_WH_PALLETS |
| `GD_WH_SIZE` | Taille adéquate | `MOAdeqSize` | select_one `Yesno` (Oui=1) | percent_yes · 1 | ↑ | D6 · Entrepôt / stock | — |  |
| `GD_WH_INPUTS_SEP` | Intrants séparés par activité | `MOInputsSeparated` | select_one `Yesno` (Oui=1) | percent_yes · 1 | ↑ | D6 · Entrepôt / stock | — |  |
| `GD_WH_FEFO` | Piles séparées par date de péremption | `MOWhBatchBBD` | select_one `Yesno` (Oui=1) | percent_yes · 1 | ↑ | D6 · Entrepôt / stock | — |  |
| `GD_WH_DAMAGED` | Vivres détériorés / infestés | `MOWHBadCommodoui` | select_one `Yesno` (Oui=1) | percent_yes · 1 | ↓ | D6 · Entrepôt / stock | — |  |
| `GD_WH_LOCKED` | Magasin fermé à clé | `MOStorageLocked` | select_one `Yesno` (Oui=1) | percent_yes · 1 | ↑ | D6 · Entrepôt / stock | — |  |
| `GD_WH_DRAIN` | Drainage adéquat | `MOWhStorageDrain` | select_one `Yesno` (Oui=1) | percent_yes · 1 | ↑ | D6 · Entrepôt / stock | — |  |
| `GD_WH_VENT` | Ventilation adéquate | `MOWhStorageVent` | select_one `Yesno` (Oui=1) | percent_yes · 1 | ↑ | D6 · Entrepôt / stock | — |  |
| `GD_WH_SPILL` | Traces de déversement | `MOWhDisposeEvidSpill` | select_one `Yesno` (Oui=1) | percent_yes · 1 | ↓ | D6 · Entrepôt / stock | — |  |
| `GD_WH_NFI_MIXED` | Non-vivres stockés avec les vivres | `MONFIwithFood` | select_one `Yesno` (Oui=1) | percent_yes · 1 | ↓ | D6 · Entrepôt / stock | — |  |
| `GD_WH_INSPECTIONS` | Inspections régulières du stock | `MOWhRegInsp` | select_one `Yesno` (Oui=1) | percent_yes · 1 | ↑ | D6 · Entrepôt / stock | — |  |
| `GD_WH_EXCLUSIVE` | Magasin réservé aux articles du programme | `MOWhOtherUse` | select_one `Yesno` (Oui=1) | percent_yes · 1 | ↑ | D6 · Entrepôt / stock | — |  |
| `GD_WH_PREV_DELIVERY` | Livraison du mois précédent reçue | `MOPrevDelivery` | select_one `Yesno` (Oui=1) | percent_yes · 1 | ↑ | D6 · Entrepôt / stock | — |  |
| `GD_WH_RECEIPT_MATCH` | Réception conforme à la lettre de voiture (par denrée) | `MOFoodReceivedMatch` | select_one `Yesno` (Oui=1) | percent_yes · 1 | ↑ | D6 · Entrepôt / stock | — | SOUS-TABLE `RepeatSmpCommodity` |
| `GD_IK_COND_OK` | Denrée distribuée sans problème de qualité (par denrée) | `MOAsstIKRecCond/0` | option de select_multiple `Conditions` | percent_yes · 1 | ↑ | M5 · Éléments de distribution | `selected(${DTPAsstMode}, '1')` | SOUS-TABLE `MOAsstIKRecRepeat` |
| `GD_FGD_WOMEN` | Participantes femmes aux FGD | `FGDPartSexe` | select_one `Sex` | percent_value · 0 | info | M3 · Information & CFM | — | SOUS-TABLE `FGD_Benef` |
| `GD_SPI` | Indice de performance du site (formulaire) | `SitePerformanceIndex` | calculate | mean · — | ↑ | KPI · Chiffres clés | — | module absent = 0 dans le calcul du formulaire |
| `GD_SITE_RISK` | Site à risque (formulaire) | `SiteRiskFlag` | calculate | percent_value · Oui | ↓ | KPI · Chiffres clés | — | valeur texte Oui/Non |

#### « Autre (préciser) »

37 couples (question à choix, choix « Autre ») ; **26** ont une question « préciser » liée, **11** n'en ont pas.

- Liaison par `= (égalité)` : `EnuName`→`EnuName_Other` (9999) ; `EnuName`→`EnuName_Other` (999) ; `EnuSupervisorName`→`EnuSupervisorName_Other` (9999) ; `EnuSupervisorName`→`EnuSupervisorName_Other` (999) ; `DPName`→`DPName_Other` (999) ; `Adm4Code`→`DPName_Other` (999) ; `MOAsstIKRecUM`→`MOAsstIKRecUM_oth` (999) [sous-table `MOAsstIKRecRepeat`] ; `HHAsstAccessWhat`→`HHAsstAccessWhat_oth` (999) **(égalité sur choix multiple : la précision n'est demandée que si « Autre » est le SEUL choix)**
- Liaison par `selected(…)` : `MOAsstIKRecCond`→`MOAsstIKRecCond_oth` (999) [sous-table `MOAsstIKRecRepeat`] ; `HHDTPTranspHow`→`HHDTPTranspHow_oth` (999) ; `HHAsstPayTrspHow`→`HHAsstPayTrspHow_oth` (999) ; `HHAsstPayEntHow`→`HHAsstPayEntHow_oth` (999) ; `HHAsstAccessCBTPrb`→`HHAsstAccessCBTPrb_oth` (999) ; `HHAsstRespectPrb`→`HHAsstRespectPrb_oth` (999) ; `HHAsstRecInfoNotEasy`→`HHAsstRecInfoNotEasy_oth` (999) ; `HHAsstNoUseCFMWhy`→`HHAsstNoUseCFMWhy_oth` (999) ; `HHAsstUseCFMWhich`→`HHAsstUseCFMWhich_oth` (999) ; `MOBenCheckNonBio_nut`→`MOBenCheckNonBio_nut_oth` (999) ; `MOBenCheckNonBio`→`MOBenCheckNonBio_oth` (999) ; `MOAsstIKLosses`→`MOAsstIKLosses_oth` (999) ; `MOAsstIKShortages`→`MOAsstIKShortages_oth` (999) ; `MOAsstIKSurplus`→`MOAsstIKSurplus_oth` (999) ; `MOHelpDeskWho`→`MOHelpDeskWho_oth` (999) ; `MODPMCSelect`→`MODPMCSelect_oth` (999) ; `MOWhWhatComm`→`MOWhWhatComm_oth` (999) ; `MOWhStorageType`→`MOWhStorageType_oth` (999)
- **Sans question « préciser »** : `CPList` (999=Autres), `Adm3Code_gd` (999=Autres), `ImpPrtName` (999=Autres), `reason_diff` (999=Autre (préciser)), `MOAsstIKRec` (999=Autres), `FraudNature` (999=Autre (préciser)), `HHAsstSecurityRisk` (999=Autre (préciser)), `MOBenefOtherWhat` (999=Autre (préciser)), `MOBenefOtherWhatAssHow` (999=Autre (préciser)), `MOWhStackPall` (999=autres), `MOWhBagsCloseProp` (999=Autre)

## 3. Suivi SMP — XLSForm « MDG SMP 2025 - 2026 » (`MDG_SMP_2025_2026`)

**En bref.** Sélecteur `SBPSiteSvyType` (choix multiple) : 1 entretien directeur, 2 élèves, 3 enseignants, 4 cuisiniers, 5 observation. Le modèle **SMP** trouve ses 65 variables. Points à connaître :

- **Le nom de la fiche du tableau de bord (« Suivi SMP ») n'est pas le titre de l'XLSForm** : l'import de définition crée/met à jour la fiche dont le `code` = `form_id` (`MDG_SMP_2025_2026`). Si « Suivi SMP » a été créée par un import de données avec un autre code, sa définition (libellés, listes, `relevant`) n'y est pas : la carte du modèle s'appuie alors seulement sur les colonnes des données (les noms concordent, mais sans liste de choix ni libellé). À vérifier dans Configuration (« catalogue du formulaire »).
- **Entretiens élèves et enseignants = groupes répétés** (`student_survey` × `nb_student`, `teacher_survey` × `nb_teacher`) : une ligne par répondant. Aujourd'hui ces réponses n'arrivent pas dans MEMS : `SMP_TEACHER_SATISF` et `SMP_TEACHER_INVOLVED` (notés, domaine D7) resteront « Non évalué ». Les deux contrôles par denrée (`SMP_STOCK_BALANCE`, `SMP_RECEIPT_MATCH`) sont dans `RepeatSmpCommodity`.
- **Repli disponible tout de suite** : le formulaire calcule dans la table principale `any_received_match` et `any_balance_match` (= 1 si **au moins une** denrée est conforme, via `sum(${…_num}) > 0`). C'est la règle « au moins une », pas « toutes conformes » : utilisable en attendant l'import des sous-tables, à signaler comme tel.
- **Défauts** : `MOStockMovRecCom` (« pour quels produits y avait-il des écarts ? ») s'ouvre quand `MOStockMovRec = 1` (= les registres **correspondent**) : condition inversée. `HHDistDiv` est posé dans « Observation du stockage » (entretien directeur) avec un libellé anglais qui est en fait l'indice. `MOStorage_submodule` dépend de `SBPSiteSvyType = 1` (directeur) bien que ce soit une observation.
- **Scores du formulaire** (`PERF_OVERALL`, piliers `P_SERV`, `P_QUALITY`, `P_FSQ`, `P_STORAGE`, `P_STOCKS_DOC`, `P_GOV_AAP`, `P_HR`, `P_ATT_INTEGRITY`, `perf_tier`) : un module absent vaut 0 ; information seulement.
- Cause probable de « 0 indicateur noté » sur 1 159 soumissions : modèle jamais appliqué (et activité peut-être non rattachée). Une fois appliqué, 31 des 33 éléments notés se calculent (2 en sous-table).

#### Structure

- **form_id** : `MDG_SMP_2025_2026` · **titre** : « MDG SMP 2025 - 2026 » · **version** : `v1` · langue par défaut : French (fr) · fichier : `20f56a00-MDG_SMP_2025_2026_8.xlsx`
- **Questions par type** : select_one 139, select_multiple 46, integer 22, decimal 5, text 73, calculate 40, note 11, date 2, geopoint 1, image 1, begin_group 18, begin_repeat 4, deviceid 1, end 1, start 1, today 1 — soit **289 questions de données** (hors notes, calculs, métadonnées).

**Modules (groupes de 1er et 2e niveau)** — q = questions de données incluses ; condition = `relevant` du groupe (base de tous ses indicateurs) :

- `Technical_module` « Technique » (q=18)
  - `TechnicalBasic_submodule` « Technique (De base) » (q=7)
  - `TechnicalSBPSite_submodule` « Technique (Programme scolaire - Site) » (q=11)
- `SBPProcessM_module` « Programme basé sur l’école » (q=118)
  - `SchoolDirectorFeedbackSBP_submodule` « Retour d’information du directeur/de la direction » (q=91) — condition `selected(${SBPSiteSvyType}, '1')`
  - `headcounting` « head counting par niveau et par sexe » (q=11)
  - `MOSchoolCmte_submodule` « Observation du comité de gestion (PTA) » (q=10) — condition `selected(${SBPSiteSvyType}, '1')`
  - `AccessibleInfoSBP_submodule` « Information accessible (site SBP) » (q=6) — condition `(${SBPSchoolDirConsent} = '1' and selected(${SBPSiteSvyType}, '1'))`
- RÉPÉTITION `teacher_survey` « Répéter les questions pour chaque ensegnaint » (q=4) — condition `${nb_teacher} >0`
  - `TeacherFeedback_submodule` « Retour des enseignants » (q=4) — condition `selected(${SBPSiteSvyType}, '3')`
- `CookFeedback_submodule` « Retour des cuisiniers - Entretien en focus group » (q=25) — condition `selected(${SBPSiteSvyType}, '4')`
- RÉPÉTITION `student_survey` « Répéter les questions pour chaque élève » (q=13) — condition `${nb_student}>0`
  - `StudentFeedback_submodule` « Retour des élèves » (q=13) — condition `selected(${SBPSiteSvyType}, '2')`
- `MO` « Observation Direct » (q=68) — condition `selected(${SBPSiteSvyType}, '5')`
  - `MOKitchen_submodule` « Observation de la cuisine » (q=21) — condition `selected(${SBPSiteSvyType}, '5')`
  - `MODistribution_submodule` « Observation de la distribution » (q=16) — condition `selected(${SBPSiteSvyType}, '5')`
  - `MOWaste_submodule` « Observation de la gestion des déchets » (q=15) — condition `selected(${SBPSiteSvyType}, '5')`
  - `MOHygiene_submodule` « Observation de l’hygiène » (q=16) — condition `selected(${SBPSiteSvyType}, '5')`
- `MOStorage_submodule` « Observation du stockage des aliments » (q=35) — condition `selected(${SBPSiteSvyType}, '1')`
  - RÉPÉTITION `RepeatSmpCommodity` « Répètez les questions pour chaque produit disponible dans l… » (q=9) — condition `${MOFoodStored}='1' and count-selected(${SmpCommodity})>=1`
- `PerformancePack_site` « Pack Performance – Site Cantine (Calculs automatiques) » (q=0)
- RÉPÉTITION `Probidentified` « PRINCIPAUX PROBLEMES IDENTIFIES ET ACTIONS PRISES OU ENTREP… » (q=5)

#### Groupes répétés

| Répétition | Libellé | Parent | Nombre de lignes (`repeat_count`) | Condition | Questions (hors notes) |
|---|---|---|---|---|---|
| `teacher_survey` | Répéter les questions pour chaque ensegnaint | table principale | `${nb_teacher}` | `${nb_teacher} >0` | `SBPTEAConsent`, `TEALvlInvolvement`, `TEASatisfaction`, `TEASuggestions` |
| `student_survey` | Répéter les questions pour chaque élève | table principale | `${nb_student}` | `${nb_student}>0` | `SBPSTUConsent`, `STUMenuRece`, `STUEatMeal`, `STULocationConsumed`, `STUComeSchool`, `STUNbEatMeal`, `STULikeFoodSchool`, `STUFeelHungryAfter`, `STUConsumeOtherFoods`, `STUSuggestion`, `STUSuggestionText`, `STUKeepSBP`, `STUMenuAvail` |
| `RepeatSmpCommodity` | Répètez les questions pour chaque produit disponi… | table principale | `count-selected(${SmpCommodity})` | `${MOFoodStored}='1' and count-selected(${SmpCommo…` | `CommodityName`ᶜ, `CommodityLabel`ᶜ, `MOComOpeningBalance`, `MOComReceived`, `MOFoodReceivedMatch`, `MOComDamaged`, `MOComDistributed`, `MOComDistributedYN`, `MOCloseBalance`ᶜ, `MOFoodBalanceDiff`, `MOActualBalance`, `MOFoodDifferenceinfo`, `MOFoodReceivedMatch_num`ᶜ, `MOFoodBalanceDiff_num`ᶜ |
| `Probidentified` | PRINCIPAUX PROBLEMES IDENTIFIES ET ACTIONS PRISES… | table principale | `libre` | — | `Q7_1`, `Q7_2`, `Q7_3`, `Q7_4`, `scorecat` |

ᶜ = champ calculé (exporté aussi).

#### Indicateurs du modèle d'activité existant, vérifiés sur ce formulaire

Modèle **SMP** : 65/65 indicateurs trouvés par nom (4 dans une sous-table) ; 33 notés.

| Code modèle | Variable trouvée | Méthode · pos. · hors base | Sens | Dom. | Remarque |
|---|---|---|---|---|---|
| `SMP_CFM_USED` | `HHAsstUseCFM` | percent_yes · 1 | ↑ | M1 (non noté) | OK |
| `SMP_CFM_KNOW` | `HHInfoCFMKnowAcc` | percent_yes · 1 | ↑ | M1 (non noté) | OK |
| `SMP_CFM_SUPPORT` | `HHInfoCFMSupport` | percent_yes · 1 | ↑ | M1 (non noté) | OK |
| `SMP_COOKS_INCENTIVE` | `CooksRecInc` | percent_yes · 1 | ↑ | M2 (non noté) | OK |
| `SMP_COOKS_CHALLENGE` | `CooksChlgaHand` | percent_yes · 1 | ↓ | M2 (non noté) | OK |
| `SMP_COOKS_SUGGEST` | `CooksSug` | percent_yes · 1 | ↑ | M2 (non noté) | OK |
| `SMP_COOKS_TRAINED_FGD` | `CooksRecTrain` | percent_yes · 1 | ↑ | M2 (non noté) | OK |
| `SMP_COOKS_RATION` | `CooksRation` | percent_yes · 1 | ↑ | M2 (non noté) | OK |
| `SMP_COOKS_CONSENT` | `SBPCooksConsent` | percent_yes · 1 | ↑ | M2 (non noté) | consentement : pas un indicateur de performance (non noté, à retirer) |
| `SMP_MGMT_COMMITTEE` | `MOPTAMgmt` | percent_yes · 1 | ↑ | D6 | OK |
| `SMP_KITCHEN_ONSITE` | `MOFoodPrepOnsite` | percent_yes · 1 | ↑ | D1 | OK |
| `SMP_UTENSILS` | `MOKitchenUtFunct` | percent_yes · 1 | ↑ | D1 | OK |
| `SMP_KITCHEN_VENT` | `MOKitchenVent` | percent_yes · 1 | ↑ | D1 | OK |
| `SMP_KITCHEN_CLEAN` | `MOCleanKitchen` | percent_yes · 1 | ↑ | D1 | MOCleanKitchen = « zone séparée dédiée au stockage » : renommer |
| `SMP_INF_FREE` | `MOInfFree` | percent_yes · 1 | ↑ | D1 | OK |
| `SMP_HIGH_RISK_FOODS` | `MOHighRiskFoods` | percent_value · 0 | ↑ | D1 | OK |
| `SMP_NO_PESTS` | `MOKitchenNoPests` | percent_yes · 1 | ↑ | M4 (non noté) | OK |
| `SMP_COOK_WATER` | `MOPotWaterAvailable` | percent_yes · 1 | ↑ | M4 (non noté) | OK |
| `SMP_FRIDGE_TEMP` | `MOTempAppropriate` | percent_yes · 1 | ↑ | M4 (non noté) | OK |
| `SMP_FREEZER` | `MOFreezerWorking` | percent_yes · 1 | ↑ | M4 (non noté) | OK |
| `SMP_STORED_OPT_TEMP` | `MOStoredOptTemp` | percent_yes · 1 | ↑ | M4 (non noté) | OK |
| `SMP_COOKED_OBS` | `MOCookedOnsiteVisit` | percent_yes · 1 | ↑ | M4 (non noté) | OK |
| `SMP_FOOD_STORED_APPROP` | `MOFoodStoredAppropriate` | percent_yes · 1 | ↑ | M4 (non noté) | OK |
| `SMP_CLEAN_AGENT_LAB` | `MOCleanAgentLab` | percent_yes · 1 | ↑ | M5 (non noté) | OK |
| `SMP_CLEAN_AGENT_USED` | `MOCleanAgentUsed` | percent_yes · 1 | ↑ | M5 (non noté) | OK |
| `SMP_CLEAN_AGENT_STORED` | `MOCleanAgentStored` | percent_yes · 1 | ↑ | M5 (non noté) | OK |
| `SMP_EQUIP_CLEAN` | `MOEquipClean` | percent_yes · 1 | ↑ | M5 (non noté) | OK |
| `SMP_WASH_COOK_WATER` | `MOWaterCook` | percent_value · 3 | ↑ | D3 | OK |
| `SMP_WASH_COOK_AREA` | `MOCookArea` | percent_value · 3 | ↑ | D3 | OK |
| `SMP_WASH_EAT_AREA` | `MOEatArea` | percent_value · 3 | ↑ | D3 | OK |
| `SMP_WASH_HANDWASH` | `MOHandwashing` | percent_value · 3 | ↑ | D3 | OK |
| `SMP_WASH_LATRINES` | `MOLatrines` | percent_value · 3 | ↑ | D3 | OK |
| `SMP_FOOD_STORED` | `MOFoodStored` | percent_yes · 1 | ↑ | D4 | OK |
| `SMP_ON_PALLETS` | `MOWhStackPall` | percent_yes · 1 | ↑ | D4 | OK |
| `SMP_STORE_SECURE` | `MOStoreWellSec` | percent_yes · 1 | ↑ | D4 | OK |
| `SMP_ADEQ_SIZE` | `MOAdeqSize` | percent_yes · 1 | ↑ | D4 | OK |
| `SMP_WH_DRAIN` | `MOWhStoreDrain` | percent_yes · 1 | ↑ | D4 | OK |
| `SMP_NO_EXPIRED` | `MOExpItem` | percent_value · 0 | ↑ | D4 | OK |
| `SMP_WH_VENT` | `MOWhStoreVent` | percent_yes · 1 | ↑ | M6 (non noté) | OK |
| `SMP_WH_STACK_PROP` | `MOWhStackProp` | percent_yes · 1 | ↑ | M6 (non noté) | OK |
| `SMP_STACK_CARDS` | `MOStackCards` | percent_yes · 1 | ↑ | M6 (non noté) | OK |
| `SMP_WH_GRAIN_PRIOR` | `MOWhGrainPrior` | percent_yes · 1 | ↑ | M6 (non noté) | OK |
| `SMP_WH_TARPS` | `MOWhTarps` | percent_yes · 1 | ↑ | M6 (non noté) | OK |
| `SMP_WH_BAD_COM` | `MOWhBadCom` | percent_yes · 1 | ↓ | M6 (non noté) | OK |
| `SMP_WH_BAD_COM_ISOL` | `MOWhBadComIsol` | percent_yes · 1 | ↑ | M6 (non noté) | OK |
| `SMP_DISPOSAL` | `MOPropDispMsr` | percent_yes · 1 | ↑ | M6 (non noté) | OK |
| `SMP_STOCK_BALANCE` | `MOFoodBalanceDiff` | percent_yes · 1 | ↑ | M6 (non noté) | SOUS-TABLE `RepeatSmpCommodity` ; repli possible : any_balance_match (règle « au moins une ») |
| `SMP_RECEIPT_MATCH` | `MOFoodReceivedMatch` | percent_yes · 1 | ↑ | M6 (non noté) | SOUS-TABLE `RepeatSmpCommodity` ; repli possible : any_received_match |
| `SMP_FOOD_DISTR_OBS` | `MOFoodDistrObs` | percent_yes · 1 | ↑ | M7 (non noté) | OK |
| `SMP_FOOD_PREP_AGR` | `MOFoodPrepAgr` | percent_yes · 1 | ↑ | M7 (non noté) | OK |
| `SMP_DOC_WAYBILL` | `DIRTranspWaybills` | percent_value · 1 · 777 | ↑ | D5 | OK |
| `SMP_DOC_CONSUMPTION` | `DIRSchFeedingRecord` | percent_value · 1 · 777 | ↑ | D5 | OK |
| `SMP_DOC_ATTENDANCE` | `DIRSchAttendanceRecord` | percent_value · 1 · 777 | ↑ | D5 | OK |
| `SMP_DOC_STOCK` | `DIRFoodStockMovementRecord` | percent_value · 1 · 777 | ↑ | D5 | OK |
| `SMP_DOC_CASHBOOK` | `DIRCashReceivedRecord` | percent_value · 1 · 777 | ↑ | D5 | OK |
| `SMP_DOC_NFI` | `DIRNFIRecRecords` | percent_value · 1 · 777 | ↑ | D5 | OK |
| `SMP_DOC_CONTRIB` | `DIRComContributors` | percent_value · 1 · 777 | ↑ | D5 | OK |
| `SMP_DOC_SUPPLIERS` | `DIRListSupplRecord` | percent_value · 1 · 777 | ↑ | D5 | OK |
| `SMP_MENU_DISPLAYED` | `DIRNBSchMealMenu` | percent_yes · 1 | ↑ | D6 | OK |
| `SMP_COOKS_TRAINED` | `DIRCooksRecTraining` | percent_yes · 1 | ↑ | D6 | OK |
| `SMP_DEDICATED_STORAGE` | `DIRDedicStorage` | percent_yes · 1 | ↑ | D6 | DIRDedicStorage = « gardien dédié au stockage » : renommer |
| `SMP_COMPL_ACT` | `DIRComplActYN` | percent_yes · 1 · 888 | ↑ | D6 | OK |
| `SMP_TEACHER_SATISF` | `TEASatisfaction` | percent_yes · 1 | ↑ | D7 | SOUS-TABLE `teacher_survey` |
| `SMP_TEACHER_INVOLVED` | `TEALvlInvolvement` | percent_value · 2 | ↑ | D7 | SOUS-TABLE `teacher_survey` |
| `SMP_DIVERSION` | `HHDistDiv` | percent_yes · 1 | ↓ | D7 | question posée dans l'observation du stockage (directeur), libellé anglais = indice ; pas « ménages » |

#### Indicateurs supplémentaires proposés

| Code proposé | Libellé FR | Variable (`name`) | Type · liste (Oui=) | Méthode · pos. · hors base | Sens | Module / dimension | Condition propre (`relevant`) | Remarque |
|---|---|---|---|---|---|---|---|---|
| `SMP_STU_ATE` | Élèves ayant mangé à l'école le jour de la visite | `STUEatMeal` | select_one `Yesno` (Oui=1) | percent_yes · 1 | ↑ | D7 · Perception programme | `${SBPSTUConsent} = '1'` | SOUS-TABLE `student_survey` |
| `SMP_STU_MENU` | Élèves ayant reçu le menu prévu | `STUMenuRece` | select_one `Yesno` (Oui=1) | percent_yes · 1 | ↑ | M7 · Service & distribution | `${SBPSTUConsent} = '1'` | SOUS-TABLE `student_survey` |
| `SMP_STU_LIKE` | Élèves aimant les repas | `STULikeFoodSchool` | select_one `Yesnodk` (Oui=1) | percent_yes · 1 · 888 | ↑ | D7 · Perception programme | `${SBPSTUConsent} = '1'` | SOUS-TABLE `student_survey` |
| `SMP_STU_HUNGRY` | Élèves ayant encore faim après le repas | `STUFeelHungryAfter` | select_one `Yesno` (Oui=1) | percent_yes · 1 | ↓ | D7 · Perception programme | `${SBPSTUConsent} = '1'` | SOUS-TABLE `student_survey` |
| `SMP_STU_TAKE_HOME` | Élèves rapportant des vivres à la maison | `STUKeepSBP` | select_one `Yesno` (Oui=1) | percent_yes · 1 | ↓ | M5 · Pertes & gaspillage | `${SBPSTUConsent} = '1'` | SOUS-TABLE `student_survey` ; sens à confirmer |
| `SMP_STU_MEAL_DAYS` | Jours avec repas / jours de présence (élèves) | `STUNbEatMeal` | integer | mean · — | ↑ | M7 · Service & distribution | `${SBPSTUConsent} = '1'` | SOUS-TABLE `student_survey` ; ratio STUNbEatMeal/STUComeSchool |
| `SMP_DAYS_SERVED` | Jours de repas servis sur 20 jours d'école | `DIRNBSchMealsProvided` | integer | mean · — · 888 | ↑ | D6 · Gouvernance et organisation scolaire | `${SBPSchoolDirConsent}='1'` | cible 20 |
| `SMP_REC_ATTEND_OK` | Cahier de présence rempli et à jour | `DIRSchAttendanceRecord2` | select_one `Yesno` (Oui=1) | percent_yes · 1 | ↑ | D5 · Registres administratifs | `selected(${DIRSchAttendanceRecord}, '1') or …` |  |
| `SMP_REC_CASH_OK` | Journal de caisse rempli et à jour | `DIRCashReceivedRecord2` | select_one `Yesno` (Oui=1) | percent_yes · 1 | ↑ | D5 · Registres administratifs | `selected(${DIRCashReceivedRecord}, '1') or s…` |  |
| `SMP_REC_WAYBILL_OK` | Lettres de voiture correctes | `DIRTranspWaybills2` | select_one `Yesno` (Oui=1) | percent_yes · 1 | ↑ | D5 · Registres administratifs | `selected(${DIRTranspWaybills}, '1') or selec…` |  |
| `SMP_REC_FEEDING_OK` | Registre des jours d'alimentation à jour | `DIRSchFeedingRecord2` | select_one `Yesno` (Oui=1) | percent_yes · 1 | ↑ | D5 · Registres administratifs | `selected(${DIRSchFeedingRecord}, '1') or sel…` |  |
| `SMP_REC_STOCK_OK` | Registre des mouvements de stock à jour | `DIRFoodStockMovementRecord2` | select_one `Yesno` (Oui=1) | percent_yes · 1 | ↑ | D5 · Registres administratifs | `selected(${DIRFoodStockMovementRecord}, '1')…` |  |
| `SMP_COOKS_INC_DIR` | Cuisiniers rémunérés (directeur) | `DIRCooksRecIncentives` | select_one `Yesnodk` (Oui=1) | percent_yes · 1 · 888 | ↑ | D6 · Gouvernance et organisation scolaire | `${SBPSchoolDirConsent}='1'` |  |
| `SMP_ATT_DISCREP` | Écart présence numérique / registre | `DIRDiscRec` | select_one `Yesno` (Oui=1) | percent_yes · 1 | ↓ | D5 · Registres administratifs | `${DIRSchConnect}='1' or ${DIRSchConnAlt}='1'` |  |
| `SMP_ATT_DISCREP_DAY` | Écart registre / décompte du jour | `DIRDiscDailyRec` | select_one `Yesno` (Oui=1) | percent_yes · 1 | ↓ | D5 · Registres administratifs | `${DIRSchConnect}='1' or ${DIRSchConnAlt}='1'` | doublon DIRDiscDailyRec2 |
| `SMP_ABSENT_RATE` | Taux d'absentéisme (3 mois) | `DIRAttendTrends` | calculate | mean · — | ↓ | D6 · Gouvernance et organisation scolaire | — | champ calculé du formulaire |
| `SMP_COOKS_FOOD_ENOUGH` | Nourriture suffisante (cuisinières) | `CooksFoodEnough` | select_one `Yesnona` (Oui=1) | percent_yes · 1 · 9999 | ↑ | M2 · Retour cuisinières | `${SBPCooksConsent}='1'` |  |
| `SMP_COOKS_RATION_SERVED` | Ration / menu respectés (cuisinières) | `CooksFoodPrep` | select_one `Yesnona` (Oui=1) | percent_yes · 1 · 9999 | ↑ | M2 · Retour cuisinières | `${SBPCooksConsent}='1'` |  |
| `SMP_COOKS_INC_ADEQ` | Incitation adéquate | `CooksAdeqInc` | select_one `Yesno` (Oui=1) | percent_yes · 1 | ↑ | M2 · Retour cuisinières | `${CooksRecInc}='1'` |  |
| `SMP_COOKS_INC_TIMELY` | Incitation versée à temps | `CooksTimelyIncentive` | select_one `Yesno` (Oui=1) | percent_yes · 1 | ↑ | M2 · Retour cuisinières | `${CooksRecInc}='1'` |  |
| `SMP_HYG_COOKS` | Hygiène personnelle des cuisiniers | `MOCooksGoodHyg` | select_one `Yesnodk` (Oui=1) | percent_yes · 1 · 888 | ↑ | D1 · Cuisine et préparation des repas | `${MOCookedOnsiteVisit}='1'` |  |
| `SMP_HYG_UTENSILS` | Ustensiles lavés avant usage | `MOCookingUtensilsWashed` | select_one `Yesnodk` (Oui=1) | percent_yes · 1 · 888 | ↑ | D1 · Cuisine et préparation des repas | `${MOCookedOnsiteVisit}='1'` |  |
| `SMP_HANDWASH_CHILD` | Élèves se lavant les mains avant le repas | `MOChildWashHands` | select_one `Yesnodk` (Oui=1) | percent_yes · 1 · 888 | ↑ | D3 · Infrastructure WASH | `${MOFoodDistrObs}='1'` |  |
| `SMP_HYG_SERVING` | Hygiène au service (cuisiniers / enseignants) | `MOCooksGoodHygienePractice` | select_one `Yesnodk` (Oui=1) | percent_yes · 1 · 888 | ↑ | M7 · Service & distribution | `${MOFoodDistrObs}='1'` |  |
| `SMP_FOOD_ENOUGH_OBS` | Nourriture suffisante (observation) | `MOFoodEnough` | select_one `Yesnodk` (Oui=1) | percent_yes · 1 · 888 | ↑ | M7 · Service & distribution | `${MOFoodDistrObs}='1'` |  |
| `SMP_FINISHED_MEAL` | Plus de la moitié des enfants finissent leur repas | `MOPercRecSM` | select_one `ProportionChildren` | percent_value · 1\|2 | ↑ | M5 · Pertes & gaspillage | `${MOFoodDistrObs}='1'` |  |
| `SMP_WASH_STATION` | Station de lavage équipée | `MOWashStation` | select_one `Yesnona` (Oui=1) | percent_yes · 1 · 9999 | ↑ | D3 · Infrastructure WASH | — |  |
| `SMP_STOCK_RECORDS_MATCH` | Registres de stock = inventaire physique | `MOStockMovRec` | select_one `Yesnona` (Oui=1) | percent_yes · 1 · 9999 | ↑ | M6 · Stockage & documentation | `${MOFoodStored}='1'` | MOStockMovRecCom relevant inversé |
| `SMP_PTA_PARITY` | Comité PTA paritaire | `MOPTAMgmtGender` | select_one `GenderBalance` | percent_value · 3 | ↑ | D6 · Gouvernance et organisation scolaire | `${MOPTAMgmt}='1'` | vérifier le code « parité » |
| `SMP_CFM_RESOLVED` | Problème résolu après recours au CFM | `HHAsstUseCFMSol` | select_one `Yesnodk` (Oui=1) | percent_yes · 1 · 888 | ↑ | M1 · Information & AAP | `${HHAsstUseCFM} = '1'` |  |
| `SMP_RECEIPT_ANY` | Au moins une denrée reçue conforme (formulaire) | `any_received_match` | calculate | percent_yes · 1 | ↑ | M6 · Stockage & documentation | — | calcul « au moins une » : préférer « toutes » |
| `SMP_BALANCE_ANY` | Au moins un solde conforme (formulaire) | `any_balance_match` | calculate | percent_yes · 1 | ↑ | M6 · Stockage & documentation | — | idem |
| `SMP_PERF` | Score global de performance du site | `PERF_OVERALL` | calculate | mean · — | ↑ | KPI | — | module absent = 0 dans le calcul |
| `SMP_PERF_GREEN` | Sites au niveau Vert | `perf_tier` | calculate | percent_value · 3 | ↑ | KPI | — |  |
| `SMP_P_FSQ` | Pilier hygiène & sécurité | `P_FSQ` | calculate | mean · — | ↑ | KPI | — |  |
| `SMP_P_STORAGE` | Pilier entreposage | `P_STORAGE` | calculate | mean · — | ↑ | KPI | — |  |
| `SMP_DOC_SCORE` | Qualité des documents | `DOC_score` | calculate | mean · — | ↑ | D5 · Registres administratifs | — |  |
| `SMP_ISSUES_CRIT` | Problèmes critiques ou très critiques | `scorecat` | select_one `cat` | percent_value · 0\|1 | ↓ | KPI | — | SOUS-TABLE `Probidentified` |

#### « Autre (préciser) »

51 couples (question à choix, choix « Autre ») ; **39** ont une question « préciser » liée, **12** n'en ont pas.

- Liaison par `= (égalité)` : `CPList`→`CPList_Other` (999) ; `EnuName`→`EnuName_oth` (999) ; `MOPTAMgmtSupport`→`MOPTAMgmtSupport_oth` (999) **(égalité sur choix multiple : la précision n'est demandée que si « Autre » est le SEUL choix)** ; `MOWhBagsCloseProp`→`MOWhBagsCloseProp_oth` (999) **(égalité sur choix multiple : la précision n'est demandée que si « Autre » est le SEUL choix)**
- Liaison par `selected(…)` : `SBPAsstModeSpec`→`SBPAsstModeSpec_oth` (999) ; `DIRSchAttendanceRecord3`→`DIRSchAttendanceRecord4` (999) ; `DIRCashReceivedRecord3`→`DIRCashReceivedRecord4` (999) ; `DIRTranspWaybills3`→`DIRTranspWaybills4` (999) ; `DIRSchFeedingRecord3`→`DIRSchFeedingRecord4` (999) ; `DIRListSupplRecord3`→`DIRListSupplRecord4` (999) ; `DIRNFIRecRecords3`→`DIRNFIRecRecords4` (999) ; `DIRFoodStockMovementRecord3`→`DIRFoodStockMovementRecord4` (999) ; `DIRComContributors3`→`DIRComContributors4` (999) ; `DIRMealsNotProvided`→`DIRMealsNotProvided_oth` (999) ; `DIRFoodQltyProblem`→`DIRFoodQltyProblem_oth` (999) ; `DIRCooksAbsent`→`DIRCooksAbsent_oth` (999) ; `DIRCooksRecIncentWhat`→`DIRCooksRecIncentWhat_oth` (999) ; `DIRCooksRecIncentSrc`→`DIRCooksRecIncentSrc_oth` (999) ; `DIRFoodSrcType`→`DIRFoodSrcType_oth` (999) ; `DIRPartnerProv`→`DIRPartnerProv_oth` (999) ; `DIRComplActWhat`→`DIRComplActWhat_oth` (999) ; `MOPTAMgmtSelected`→`MOPTAMgmtSelected_oth` (999) ; `MOPTAMgmtRole`→`MOPTAMgmtRole_oth` (999) ; `MOPTAMgmtRoleFdbk`→`MOPTAMgmtRoleFdbk_oth` (999) ; `HHAsstUseCFMWhich`→`HHAsstUseCFMWhich_oth` (999) ; `CooksFoodNotEn`→`CooksFoodNotEn_oth` (999) ; `CooksIncDetail`→`CooksIncDetail_oth` (999) ; `CooksRecIncSrc`→`CooksReceiveIncentivesSource_oth` (999) ; `MOFoodNoOnsite`→`MOFoodPrepOnsite_oth` (999) ; `MORsnCookedOnsiteVisit`→`MORsnCookedOnsiteVisit_oth` (999) ; `MOFoodDistrNoObs`→`MOFoodDistrNoObs_oth` (999) ; `MOFoodQltyProb`→`MOFoodQltyProb_oth` (999) ; `MOCooksAbs`→`MOCooksAbs_oth` (999) ; `MealFoodGroups`→`MealFoodGroups_oth` (999) ; `MOLeftoversFood`→`MOLeftoversFood_oth` (999) ; `MOWasteDispMeth`→`MOWasteDisposalMeth_oth` (999) ; `MONoWashStation`→`MONoWashStation_oth` (999) ; `MOComCondition`→`MOComCondition_oth` (999) ; `SmpCommodity`→`SmpCommodity_oth` (999)
- **Sans question « préciser »** : `Adm2Code_SMP` (999=Autre), `Adm3Code_SMP` (999=Autre), `Adm4Code_SMP` (999=Autre), `DIRFoodSrc` (999=Autre), `DIRFoodSrcWhere` (999=Autre), `DIRComplActWhat2` (999=Autres), `DIRChllng` (999=Autre), `MOLeftOverFood` (999=Autre), `MOWasteDisposal` (999=Autre), `MOContainersKind` (999=Autre), `MOStockMovRecCom` (999=Autres), `MOCom` (999=Autres)

## 4. MG03 - MDG PECMAM - V3 (`MDG_Process_Monitoring_NutritionAIM`)

**En bref.** Le plus propre des cinq : `SvyModules` (choix multiple : registre, distribution, rh, pec, sbcc, ac, meres, farne, magasin) conditionne **chaque** module, et les questions de module sont presque toutes obligatoires → la base de chaque indicateur = visites où le module a été coché. Le modèle **MAM** trouve ses 35 variables. Points à connaître :

- **Entretien des mères : FGD *ou* entretiens individuels** (`MMQesttype` 1 = FGD, 2 = KII). Les KII sont dans la répétition `MMKIIbeg` (× `MMKIInb`) ; le modèle lie la version FGD (`MMFGD…`) : une visite menée en KII n'apporte aujourd'hui aucune réponse. Il faudra un indicateur qui réunit les deux (FGD : 1 réponse par visite ; KII : 1 par mère) — voir § 7.
- **Noms KII décalés par rapport aux libellés** : `MMKIIUsehome` = « un technicien est-il venu ? », `MMKIIWhoCons` = « l'appui a-t-il été utile ? », `MMKIITechVisUse` = « appliquez-vous les recommandations ? », `MMKIITechlastvisit` = texte « pourquoi pas utile ». En FGD, `MMFGDUsehome` = « comment utilisez-vous les produits ». Ne jamais apparier FGD/KII par le nom.
- **Même nom, autre question selon le formulaire** : `MOWHBadCommod` est ici un Oui/Non (« preuves de vivres endommagés ? ») alors que dans GD et RÉSILIENCE c'est le choix multiple des types de dommages. Un modèle partagé entre formulaires doit vérifier le type et la liste, pas seulement le nom.
- **FARNE absent du modèle MAM** (21 questions `FARNE_*`, score `score_farne`) : ajouté ci-dessous comme domaine « D6 · FARNE ».
- **Stock** : l'écart par denrée est en sous-table, mais `score_stock` et `recap_stock` (table principale) l'agrègent par `sum(${MOAbsDiff})`.
- Cause probable de « 0 indicateur » : modèle non appliqué (titre de fiche = titre XLSForm).

#### Structure

- **form_id** : `MDG_Process_Monitoring_NutritionAIM` · **titre** : « MG03 - MDG PECMAM - V3 » · **version** : `v3` · langue par défaut : French (fr) · fichier : `ce9369df-MDG_Process_Monitoring_NutritionAIM_15.xlsx`
- **Questions par type** : select_one 132, select_multiple 27, integer 20, decimal 6, text 49, calculate 31, note 28, date 2, geopoint 2, image 3, begin_group 29, begin_repeat 2, audit 1, end 1, start 1 — soit **241 questions de données** (hors notes, calculs, métadonnées).

**Modules (groupes de 1er et 2e niveau)** — q = questions de données incluses ; condition = `relevant` du groupe (base de tous ses indicateurs) :

- `Technical_module` « Technique » (q=17)
  - `TechnicalBasic_submodule` « Technique (de base) » (q=7)
  - `TechnicalDP_submodule` « Technique (point de distribution) » (q=10)
- `modules_group` « Volets de suivi à réaliser » (q=1)
- `DcoumentatioMonitoring_module` « Suivi du registre » (q=7) — condition `selected(${SvyModules},'registre')`
- `DataCheck` « Vérification des données » (q=9) — condition `selected(${SvyModules},'registre')`
- `ObservationMonitoring_module` « Suivi par observation » (q=13) — condition `selected(${SvyModules},'distribution')`
  - `NutritionMgm_submodule` « Gestion de la distribution » (q=10) — condition `${MOPlannedDistObser}='1'`
- `human_material` « Moyens humains et matériels » (q=10) — condition `selected(${SvyModules},'rh')`
- `AcuteMalnMon` « Prise en charge de la malnutrition aiguë » (q=2) — condition `selected(${SvyModules},'pec')`
- `MesurAntr` « Prise de mesures anthropométriques » (q=4) — condition `selected(${SvyModules},'pec')`
- `ProtNational` « Application du protocole national de prise en charge » (q=22) — condition `selected(${SvyModules},'pec')`
  - `IdentBenf` « Identification » (q=3)
  - `Entre` « Entrée » (q=5)
  - `Sortie` « Sortie » (q=7)
  - `NnRepo` « Non-répondants » (q=2)
  - `RatCheck` « Vérification du ratio » (q=5)
- `NutritionEdu_submodule` « Communication pour le changement social et comportemental (… » (q=16) — condition `selected(${SvyModules},'sbcc')`
- `AC_monitoring` « Entretien avec l'agent communautaire » (q=8) — condition `selected(${SvyModules},'ac')`
- `Mothers_monitoring` « Entretien avec les mères des enfants » (q=29) — condition `selected(${SvyModules},'meres')`
  - RÉPÉTITION `MMKIIbeg` « Questions d'entretien — mères des enfants » (q=13) — condition `${MMQesttype}='2'`
  - `MMFGD` « Discussion de groupe (FGD) avec les mères » (q=14) — condition `${MMQesttype}='1'`
- `FARNE_module` « Suivi FARNE (Foyer d’Apprentissage, de Réhabilitation Nutri… » (q=25) — condition `selected(${SvyModules},'farne')`
- `TechnicalWarehouse_submodule` « Contrôle du magasin » (q=70) — condition `selected(${SvyModules},'magasin')`
  - `warehouse_hr` « Ressources humaines (magasin) » (q=8)
  - `MOWhInventory` « Inventaire et suivi des stocks » (q=10)
  - `WhDocuments_submodule` « Documentation et traçabilité » (q=14)
  - `WhOffLoading_submodule` « Déchargement de l'entrepôt » (q=4)
  - `WhObservation_submodule` « Conditions de stockage et qualité des vivres » (q=33)
- `recap_group` « Récapitulatif du site et recommandations » (q=8)

#### Groupes répétés

| Répétition | Libellé | Parent | Nombre de lignes (`repeat_count`) | Condition | Questions (hors notes) |
|---|---|---|---|---|---|
| `MMKIIbeg` | Questions d'entretien — mères des enfants | table principale | `${MMKIInb}` | `${MMQesttype}='2'` | `MMKIIInfo`, `MMKIIRecWht`, `MMKIIAccDif`, `MMKIIKnowUse`, `MMKIIAClastvisit`, `MMKIIlastsens`, `MMKIIRecAdop`, `MMKIIRecAdop_NoWhy`, `MMKIIUsehome`, `MMKIIWhoCons`, `MMKIITechlastvisit`, `MMKIITechVisUse`, `MMKIITechVisUseNoWhy` |
| `RepeatSmpCommodity` | Répétez les questions pour chaque type de vivre d… | table principale | `count-selected(${MOWhWhatComm})` | `count-selected(${MOWhWhatComm})>=1` | `CommodityName`ᶜ, `CommodityLabel`ᶜ, `MOComOpeningBalance`, `MOComReceived`, `MOFoodReceivedMatch`, `MOComDamaged`, `MOComDistributed`, `MOCloseBalance`ᶜ, `MOActualBalance`, `MOFoodBalanceFin`ᶜ, `MOFoodBalanceDiff`ᶜ, `MOAbsDiff`ᶜ, `MOFoodBalanceDiff_note`, `MOFoodDifferenceinfo` |

ᶜ = champ calculé (exporté aussi).

#### Indicateurs du modèle d'activité existant, vérifiés sur ce formulaire

Modèle **MAM** : 35/35 indicateurs trouvés par nom (1 dans une sous-table) ; 26 notés.

| Code modèle | Variable trouvée | Méthode · pos. · hors base | Sens | Dom. | Remarque |
|---|---|---|---|---|---|
| `MAM_ACCESS_DIFF` | `MMFGDAccDif` | percent_yes · 1 | ↓ | M1 (non noté) | FGD seulement ; la version KII (MMKIIAccDif) est dans la sous-table MMKIIbeg |
| `MAM_TECH_LAST_VISIT` | `MMFGDTechlastvisit` | percent_yes · 1 | ↑ | M1 (non noté) | OK |
| `MAM_SENSITIZED` | `MMFGDlastsens` | percent_yes · 1 | ↑ | M1 (non noté) | FGD seulement (KII en sous-table) |
| `MAM_INFO` | `MMFGDInfo` | percent_yes · 1 | ↑ | M1 (non noté) | FGD seulement (KII en sous-table) |
| `MAM_KNOW_USE` | `MMFGDKnowUse` | percent_yes · 1 | ↑ | M1 (non noté) | FGD seulement (KII en sous-table) |
| `MAM_REC_ADOPT` | `MMFGDRecAdop` | percent_yes · 1 | ↑ | M1 (non noté) | OK |
| `MAM_TECH_USEFUL` | `MMFGDTechVisUse` | percent_yes · 1 | ↑ | M1 (non noté) | OK |
| `MAM_TECH_VISIT` | `ACTechVis` | percent_yes · 1 | ↑ | M2 (non noté) | OK |
| `MAM_REG_VISITS` | `ACRegvist` | percent_yes · 1 | ↑ | D4 | OK |
| `MAM_CAPACITY` | `ACCapsStrengh` | percent_yes · 1 | ↑ | M2 (non noté) | OK |
| `MAM_AC_TRAINED` | `ACJobAidTrained` | percent_yes · 1 | ↑ | D4 | OK |
| `MAM_REG_UPTODATE` | `MOUpdBenefList` | percent_value · 1 | ↑ | D1 | OK |
| `MAM_REG_EXITS` | `MODRegSort` | percent_yes · 1 | ↑ | D1 | OK |
| `MAM_DIST_LIST` | `MODistrList` | percent_yes · 1 | ↑ | D1 | OK |
| `MAM_LIST_COMPLETE` | `MODisListComplete` | percent_yes · 1 | ↑ | D1 | OK |
| `MAM_REGISTER` | `MOBeneficiaryRegister` | percent_yes · 1 | ↑ | D1 | OK |
| `MAM_ON_TIME` | `MOTimelyDistribution` | percent_yes · 1 | ↑ | D3 | OK |
| `MAM_SITE_ORG` | `MOSiteOrganized` | percent_yes · 1 | ↑ | D3 | OK |
| `MAM_SCREENING` | `MODep` | percent_yes · 1 | ↑ | D3 | OK |
| `MAM_RATION` | `MORation` | percent_yes · 1 | ↑ | D3 | OK |
| `MAM_SCREEN_CORRECT` | `MODepDoneCorrectly` | percent_yes · 1 | ↑ | D3 | OK |
| `MAM_HEAD_TRAINED` | `MOHeadTrained` | percent_yes · 1 | ↑ | D2 | OK |
| `MAM_ADM_CRIT` | `MOAdmCritAdhered` | percent_yes · 1 | ↑ | D2 | OK |
| `MAM_CHILD_MUAC` | `MOChildMUAC` | percent_yes · 1 | ↑ | D2 | question = bande MUAC disponible (équipement), pas « MUAC réalisé » |
| `MAM_PROTOCOL` | `MOProtocolAvailable` | percent_yes · 1 | ↑ | D2 | OK |
| `MAM_SCALE` | `MOScaleFunctional` | percent_yes · 1 | ↑ | D2 | OK |
| `MAM_ADM_DISPLAYED` | `MOAdminAff` | percent_yes · 1 | ↑ | D2 | question = critères d'admission affichés |
| `MAM_EXIT_DISPLAYED` | `MOSortAff` | percent_yes · 1 | ↑ | D2 | question = critères de sortie affichés |
| `MAM_WOMEN_MUAC` | `MOWomenMUAC` | percent_yes · 1 | ↑ | D2 | OK |
| `MAM_HEIGHT_BOARD` | `MOHeightBoardAvailable` | percent_yes · 1 | ↑ | D2 | OK |
| `MAM_AGENT_MASTERY` | `SBAgenMast` | percent_value · 1 | ↑ | D4 | OK |
| `MAM_MOTHERS_PARTICIPATE` | `SBBenPart` | percent_yes · 1 | ↑ | D4 | OK |
| `MAM_SBCC_LOCAL_LANG` | `SBSBCLocalLang` | percent_yes · 1 | ↑ | D4 | OK |
| `MAM_SBCC_SESSION` | `SBNutEduPres` | percent_yes · 1 | ↑ | D4 | OK |
| `MAM_STOCK_MATCH` | `MOFoodReceivedMatch` | percent_yes · 1 | ↑ | D5 | SOUS-TABLE `RepeatSmpCommodity` ; pas d'agrégat de la réception dans la table principale (score_stock agrège seulement l'écart) |

#### Indicateurs supplémentaires proposés

| Code proposé | Libellé FR | Variable (`name`) | Type · liste (Oui=) | Méthode · pos. · hors base | Sens | Module / dimension | Condition propre (`relevant`) | Remarque |
|---|---|---|---|---|---|---|---|---|
| `MAM_WEIGHT_OK` | Pesée correcte (enfant nu) | `MOWeiMeas` | select_one `Yesno` (Oui=1) | percent_yes · 1 | ↑ | D2 · Protocole clinique / formation | — |  |
| `MAM_MUAC_TECH` | Technique PB respectée | `MOMUACMeas` | select_one `Yesno` (Oui=1) | percent_yes · 1 | ↑ | D2 · Protocole clinique / formation | — |  |
| `MAM_MUAC_RECORDED` | PB reporté fiche + registre | `MUACReg` | select_one `Yesno` (Oui=1) | percent_yes · 1 | ↑ | D1 · Documentation / traçabilité | — |  |
| `MAM_OEDEMA` | Contrôle des œdèmes | `MOOedamaCheck` | select_one `Yesno` (Oui=1) | percent_yes · 1 | ↑ | D2 · Protocole clinique / formation | — | critique |
| `MAM_ID_AT_ADMISSION` | Identification à l'admission | `MOVerifAdm` | select_one `Yesno` (Oui=1) | percent_yes · 1 | ↑ | D1 · Documentation / traçabilité | — |  |
| `MAM_SAM_REFERRED` | MAS orientés vers le CRENAS | `MOMalArrRef` | select_one `Yesno` (Oui=1) | percent_yes · 1 | ↑ | D2 · Protocole clinique / formation | — | critique |
| `MAM_EXIT_CRIT` | Critères de sortie respectés | `MODischCrit` | select_one `Yesno` (Oui=1) | percent_yes · 1 | ↑ | D2 · Protocole clinique / formation | — |  |
| `MAM_ADM_NONCONF` | % admissions hors critères (échantillon) | `MOAdmPerc` | calculate | mean · — | ↓ | D2 · Protocole clinique / formation | — | calculé ; vide si MOAdmCritAdhered=1 |
| `MAM_EXIT_NONCONF` | % sorties hors critères (échantillon) | `MODischCritCalc` | calculate | mean · — | ↓ | D2 · Protocole clinique / formation | — | idem |
| `MAM_NONRESP_FOLLOW` | Suivi des non-répondants | `MONonrespFollowup` | select_one `Yesnona` (Oui=1) | percent_yes · 1 · 9999 | ↑ | D2 · Protocole clinique / formation | `${MODefaultRec}='1'` |  |
| `MAM_REG_ABSENCES` | Absences / abandons notés | `MODRegAba` | select_one `Yesno` (Oui=1) | percent_yes · 1 | ↑ | D1 · Documentation / traçabilité | `${MOBeneficiaryRegister}='1'` |  |
| `MAM_REG_RECENT` | Registre rempli depuis < 1 semaine | `MOUpdBenefList` | select_one `UpdBenefList` | percent_value · 1\|2 | ↑ | D1 · Documentation / traçabilité | `${MOBeneficiaryRegister}='1'` | variante de MAM_REG_UPTODATE |
| `MAM_SBCC_EVIDENCE` | Preuves de SBCC (sans séance observée) | `SBNutEduProv` | select_one `Yesno` (Oui=1) | percent_yes · 1 | ↑ | D4 · SBCC / sensibilisation | `${SBNutEduPres}='0'` |  |
| `MAM_SBCC_MATERIAL` | Matériel SBCC présent | `SBSBCMatPres` | select_one `Yesno` (Oui=1) | percent_yes · 1 | ↑ | D4 · SBCC / sensibilisation | `${SBNutEduProv}='1' or ${SBNutEduPres}='1'` |  |
| `MAM_NEW_BEN_INFORMED` | Nouveaux bénéficiaires informés | `SBNewBenPrep` | select_one `Yesnona` (Oui=1) | percent_yes · 1 · 9999 | ↑ | D4 · SBCC / sensibilisation | `${SBNutEduProv}='1'` |  |
| `MAM_PLUMPY_EXPLAINED` | Raison du Plumpy Sup expliquée (FGD) | `MMFGDWhy` | select_one `Yesno` (Oui=1) | percent_yes · 1 | ↑ | M1 · Mères (FGD/KII) | — |  |
| `MAM_KII_INFO` | Mères informées de leurs droits (KII) | `MMKIIInfo` | select_one `Yesno` (Oui=1) | percent_yes · 1 | ↑ | M1 · Mères (FGD/KII) | — | SOUS-TABLE `MMKIIbeg` |
| `MAM_KII_ACCESS_DIFF` | Difficultés d'accès (KII) | `MMKIIAccDif` | select_one `Yesno` (Oui=1) | percent_yes · 1 | ↓ | M1 · Mères (FGD/KII) | — | SOUS-TABLE `MMKIIbeg` |
| `MAM_KII_KNOW_USE` | Savent utiliser les produits (KII) | `MMKIIKnowUse` | select_one `Yesno` (Oui=1) | percent_yes · 1 | ↑ | M1 · Mères (FGD/KII) | — | SOUS-TABLE `MMKIIbeg` |
| `MAM_KII_SENSITIZED` | Sensibilisées 3 derniers mois (KII) | `MMKIIlastsens` | select_one `Yesno` (Oui=1) | percent_yes · 1 | ↑ | M1 · Mères (FGD/KII) | — | SOUS-TABLE `MMKIIbeg` |
| `MAM_KII_TECH_VISIT` | Technicien venu le mois dernier (KII) | `MMKIIUsehome` | select_one `Yesno` (Oui=1) | percent_yes · 1 | ↑ | M1 · Mères (FGD/KII) | — | SOUS-TABLE `MMKIIbeg` ; NOM TROMPEUR (≠ MMFGDUsehome) |
| `MAM_KII_TECH_USEFUL` | Appui du technicien utile (KII) | `MMKIIWhoCons` | select_one `Yesno` (Oui=1) | percent_yes · 1 | ↑ | M1 · Mères (FGD/KII) | `${MMKIIUsehome}='1'` | SOUS-TABLE `MMKIIbeg` ; NOM TROMPEUR |
| `MAM_KII_REC_APPLIED` | Recommandations appliquées (KII) | `MMKIITechVisUse` | select_one `Yesno` (Oui=1) | percent_yes · 1 | ↑ | M1 · Mères (FGD/KII) | `${MMKIIUsehome}='1'` | SOUS-TABLE `MMKIIbeg` ; NOM TROMPEUR |
| `MAM_FARNE_EXISTS` | Site doté d'un FARNE | `FARNE_Exists` | select_one `FARNEyn` (Oui=1) | percent_yes · 1 | info | D6 · FARNE (nouveau) | — | filtre |
| `MAM_FARNE_FUNCTIONAL` | FARNE fonctionnel | `FARNE_Site` | select_one `FARNEyn` (Oui=1) | percent_yes · 1 | ↑ | D6 · FARNE (nouveau) | `${FARNE_Exists}='1'` |  |
| `MAM_FARNE_MEAL` | Repas chaud préparé | `FARNE_Meal` | select_one `FARNEyn` (Oui=1) | percent_yes · 1 | ↑ | D6 · FARNE (nouveau) | `${FARNE_Site}='1'` |  |
| `MAM_FARNE_LOCAL` | Recettes / produits locaux | `FARNE_LocalRecipe` | select_one `FARNEyn` (Oui=1) | percent_yes · 1 | ↑ | D6 · FARNE (nouveau) | `${FARNE_Site}='1'` |  |
| `MAM_FARNE_MOTHERS_COOK` | Mères participant à la préparation | `FARNE_MotherCook` | select_one `FARNEyn` (Oui=1) | percent_yes · 1 | ↑ | D6 · FARNE (nouveau) | `${FARNE_Site}='1'` |  |
| `MAM_FARNE_HYGIENE` | Hygiène respectée (entièrement) | `FARNE_Hygiene` | select_one `FARNEynp` (Oui=1) | percent_value · 1 | ↑ | D6 · FARNE (nouveau) | `${FARNE_Site}='1'` | 2 = partiel |
| `MAM_FARNE_EVEIL` | Activités d'éveil | `FARNE_Eveil` | select_one `FARNEyn` (Oui=1) | percent_yes · 1 | ↑ | D6 · FARNE (nouveau) | `${FARNE_Site}='1'` |  |
| `MAM_FARNE_ANIMATOR` | Maman Lumière / AC anime | `FARNE_MamanLumiere` | select_one `FARNEyn` (Oui=1) | percent_yes · 1 | ↑ | D6 · FARNE (nouveau) | `${FARNE_Site}='1'` |  |
| `MAM_FARNE_EDUC` | Séance d'éducation nutritionnelle | `FARNE_EducSession` | select_one `FARNEyn` (Oui=1) | percent_yes · 1 | ↑ | D6 · FARNE (nouveau) | `${FARNE_Site}='1'` |  |
| `MAM_FARNE_SCREEN` | Dépistage PB et référencement | `FARNE_ScreeningLink` | select_one `FARNEyn` (Oui=1) | percent_yes · 1 | ↑ | D6 · FARNE (nouveau) | `${FARNE_Site}='1'` |  |
| `MAM_FARNE_HOME` | Pratiques reproduites à la maison | `FARNE_HomeAdoption` | select_one `FARNEynp` (Oui=1) | percent_value · 1 | ↑ | D6 · FARNE (nouveau) | `${FARNE_Site}='1'` | 2 = partiel |
| `MAM_FARNE_REGISTER` | Registre FARNE à jour | `FARNE_Register` | select_one `FARNEyn` (Oui=1) | percent_yes · 1 | ↑ | D6 · FARNE (nouveau) | `${FARNE_Site}='1'` |  |
| `MAM_FARNE_CRITERIA` | Sélection selon critères clairs | `FARNE_SelectCrit` | select_one `FARNEyn` (Oui=1) | percent_yes · 1 | ↑ | D6 · FARNE (nouveau) | `${FARNE_Site}='1'` |  |
| `MAM_FARNE_REFERRAL_IN` | Enfants issus du dépistage / CRENAS | `FARNE_ReferralIn` | select_one `FARNEyn` (Oui=1) | percent_yes · 1 | ↑ | D6 · FARNE (nouveau) | `${FARNE_Site}='1'` |  |
| `MAM_FARNE_DEMO` | Démonstration culinaire | `FARNE_CookingDemo` | select_one `FARNEynp` (Oui=1) | percent_value · 1 | ↑ | D6 · FARNE (nouveau) | `${FARNE_Site}='1'` | 2 = partiel |
| `MAM_FARNE_MATERIAL` | Matériel de cuisine disponible | `FARNE_Materials` | select_one `FARNEyn` (Oui=1) | percent_yes · 1 | ↑ | D6 · FARNE (nouveau) | `${FARNE_Site}='1'` |  |
| `MAM_FARNE_CONTRIB` | Contribution des mères en ingrédients | `FARNE_MotherContrib` | select_one `FARNEynp` (Oui=1) | percent_value · 1 | ↑ | D6 · FARNE (nouveau) | `${FARNE_Site}='1'` | 2 = partiel |
| `MAM_FARNE_WEIGHT` | Poids suivi pendant le cycle | `FARNE_WeightMonitored` | select_one `FARNEyn` (Oui=1) | percent_yes · 1 | ↑ | D6 · FARNE (nouveau) | `${FARNE_Site}='1'` |  |
| `MAM_FARNE_COMPLETION` | Cycle généralement terminé | `FARNE_Completion` | select_one `FARNEynp` (Oui=1) | percent_value · 1 | ↑ | D6 · FARNE (nouveau) | `${FARNE_Site}='1'` | 2 = partiel |
| `MAM_FARNE_SUPERVISED` | Supervision CSB / agent de santé | `FARNE_Supervision` | select_one `FARNEyn` (Oui=1) | percent_yes · 1 | ↑ | D6 · FARNE (nouveau) | `${FARNE_Site}='1'` |  |
| `MAM_FARNE_HOMEVISIT` | Suivi à domicile après le cycle | `FARNE_HomeVisitAfter` | select_one `FARNEyn` (Oui=1) | percent_yes · 1 | ↑ | D6 · FARNE (nouveau) | `${FARNE_Site}='1'` |  |
| `MAM_FARNE_DROPOUTS` | Abandons dans le cycle en cours | `FARNE_Dropouts` | integer | sum · — | ↓ | D6 · FARNE (nouveau) | `${FARNE_Site}='1'` |  |
| `MAM_FARNE_SCORE` | Score FARNE (formulaire) | `score_farne` | calculate | mean · — | ↑ | D6 · FARNE (nouveau) | — |  |
| `MAM_SCORE_TOTAL` | Score total du site (formulaire) | `score_total` | calculate | mean · — | ↑ | KPI | — |  |
| `MAM_WH_STOCKCARD` | Fiches de lot à jour | `MOWhStockCard` | select_one `Yesno` (Oui=1) | percent_yes · 1 | ↑ | D5 · Entrepôt / stock | `selected(${MOWhReceipt}, '1')` | bloc magasin = GD |
| `MAM_WH_PREV_DELIVERY` | Livraison du mois précédent reçue | `MOPrevDelivery` | select_one `Yesno` (Oui=1) | percent_yes · 1 | ↑ | D5 · Entrepôt / stock | — |  |
| `MAM_WH_ON_TIME` | Livraisons dans les délais | `MODeliveryOnTime` | select_one `Yesno` (Oui=1) | percent_yes · 1 | ↑ | D5 · Entrepôt / stock | — |  |
| `MAM_WH_INPUTS_SEP` | Intrants séparés par activité | `MOInputsSeparated` | select_one `Yesno` (Oui=1) | percent_yes · 1 | ↑ | D5 · Entrepôt / stock | `${MOFoodStored}='1'` |  |
| `MAM_WH_DAMAGED` | Vivres endommagés / infestés | `MOWHBadCommod` | select_one `Yesno` (Oui=1) | percent_yes · 1 | ↓ | D5 · Entrepôt / stock | `${MOFoodStored}='1'` | ici select_one (≠ GD) |

#### « Autre (préciser) »

21 couples (question à choix, choix « Autre ») ; **17** ont une question « préciser » liée, **4** n'en ont pas.

- Liaison par `= (égalité)` : `EnuName`→`EnuName_Other` (999) ; `EnuSupervisorName`→`EnuSupervisorName_Other` (999) ; `DPName`→`DPName_Other` (999) ; `Adm4Code_MAM`→`DPName_Other` (999) ; `SBMesCov`→`SBMesoth` (999) **(égalité sur choix multiple : la précision n'est demandée que si « Autre » est le SEUL choix)** ; `SBMat`→`SBMatOth` (999) **(égalité sur choix multiple : la précision n'est demandée que si « Autre » est le SEUL choix)** ; `SBMet`→`SBMetoth` (999) **(égalité sur choix multiple : la précision n'est demandée que si « Autre » est le SEUL choix)**
- Liaison par `selected(…)` : `DTPAsstMode`→`DTPAsstMode_oth` (999) ; `MOPlannedDistObserved`→`MOPlannedDistObserved_oth` (999) ; `MODepWhy`→`MODepWhyOth` (999) ; `MODepDonCorrWhy`→`MODepDonCorrWhyOth` (999) ; `MOAdmCritWh`→`MOAdmCritWhat_oth` (999) ; `MOVerifIdent`→`MOVerifIdent_oth` (999) ; `MOSiteServices`→`MOSiteServices_oth` (999) ; `SBLocNutEdu`→`SBLocNutEdu_oth` (999) ; `MOWhWhatComm`→`MOWhWhatComm_oth` (999) ; `MOWhStorageType`→`MOWhStorageType_oth` (999)
- **Sans question « préciser »** : `CPList` (999=Autres), `Adm3Code_MAM` (999=Autres), `MOWhStackPall` (999=autres), `MOWhBagsCloseProp` (999=Autre)

## 5. MG03 - PM MIARO (`MDG_Process_Monitoring_MIARO_PROD_Janv2026`)

**En bref.** Titre XLSForm « MG03 - PM MIARO (v 12_07_2026) », version `v5`. Sélecteurs : `process_monitoring` (5 mise en œuvre, 4 FGD bénéficiaires, 2 magasin), `MODMSvyMode` (0 distribution, 1 SBCC, 2 agents communautaires, 3 jardins, 4 élevage, 5 FARNE), `HHDMSvyMode` (1 distribution, 2 SBCC). 205 champs calculés, dont une batterie `p_*` (applicabilité), `r_*` (résultat 0/1 ou ratio, **vide si non applicable** — exactement la sémantique de base de MEMS), `r_*_pct` (0–100), `score_d1_100` … `score_d9_100`, `site_score_w`, `SitePerformanceIndex`. Le modèle **STUNT** a été construit sur ces champs (28/28 trouvés). Points à connaître :

- **9 répétitions, dont deux modules entiers** : le magasin (`TechnicalWarehouse_submodule`, répétition libre, avec deux répétitions imbriquées `MOWhHrlist` et `RepeatSmpCommodity`) et l'observation SBCC (`MOSbcSensibilisation`, répétition libre) : aucune de leurs questions n'est dans la table principale. Seuls `r_stock_eq0(_pct)`, `r_nut_recmatch`, `risk_storage`, `p_MOFoodBalanceDiff` les résument (agrégats `sum()` sur la sous-table). Idem élevage (`Livestock_farming_repeat` → `r_lv_*`), SBCC ménages (`HHSbcMessagesRecall_rep` → `r_sbcc_msg2`, `r_sbcc_apply(_pct)`), problèmes (`issues`).
- **À corriger dans le modèle** : `MIARO_NO_DELAY` → `risk_delay` = `if(not(${HHDTPDelay}='1'),1,0)` vaut 1 quand la question n'est pas posée **et** quand la réponse est « 0 = pas de délai » ; utiliser `r_no_delay` (positif 1). `MIARO_SBCC_SATISF` et `MIARO_DIGNITY` sont des moyennes de ratios 0–1 (d'où l'avertissement « Moyenne × 100 ») : les variables `r_sbcc_satisf_pct` / `r_dign_prop_pct` existent déjà en 0–100. `MIARO_SBCC_APPLY` lié à la question de la sous-table alors que `r_sbcc_apply_pct` est dans la table principale.
- 19 des 28 éléments du modèle sont « non notés » (domaines M*/KPI) : même appliqué, le tableau de bord n'aura que 9 indicateurs notés tant que les domaines M1–M6 ne sont pas notés ; les ajouts proposés ci-dessous (D1, D3, D5 notés) comblent ce manque.
- Cause probable de « 0 indicateur » : modèle non appliqué. Le nom de la fiche (« MG03 - PM MIARO ») diffère du titre XLSForm : vérifier, comme pour SMP, que la définition a été importée sur la même fiche (code = `form_id`).

#### Structure

- **form_id** : `MDG_Process_Monitoring_MIARO_PROD_Janv2026` · **titre** : « MG03 - PM MIARO (v 12_07_2026) » · **version** : `v5` · langue par défaut : French (fr) · fichier : `6aad17a9-MDG_Process_Monitoring_MIARO_PROD_Janv2026_11.xlsx`
- **Questions par type** : select_one 169, select_multiple 60, integer 27, decimal 6, text 104, calculate 205, note 33, date 3, geopoint 3, image 1, photo 1, begin_group 41, begin_repeat 9 — soit **374 questions de données** (hors notes, calculs, métadonnées).

**Modules (groupes de 1er et 2e niveau)** — q = questions de données incluses ; condition = `relevant` du groupe (base de tous ses indicateurs) :

- `TechnicalBasic_submodule` « Information de base » (q=16)
  - `TechnicalDP_submodule` « Information sur le lieu » (q=9)
- `process_note` « Suivi de Processus » (q=1)
- `AIM_monitoring` « Suivi de la mise en oeuvre de l'Activites » (q=4) — condition `selected(${process_monitoring},'5')`
  - `TechnicalNut_submodule` « Technique (Site de nutrition) » (q=4)
- `ObservationMonitoring_module_nut` « Suivi Observation » (q=69) — condition `selected(${MODMSvyMode}, '0')`
  - `Scope` « Utilisation de scope » (q=14)
  - `NutritionMgm_submodule` « Gestion du programme de nutrition » (q=20)
  - `DistrElementsNut_submodule` « Qualité de la distribution (Nutrition) » (q=10)
  - `NutritionDistCond_submodule` « Conditions de distribution (Nutrition) » (q=6)
  - `NUTBeneficiaryVerif_submodule` « Vérification des bénéficiaires (Nutrition) » (q=19)
- RÉPÉTITION `MOSbcSensibilisation` « Sensibilisation (IEC/SCB) » (q=22) — condition `selected(${MODMSvyMode}, '1')`
- `MOSbcSensibilisationAC` « Enquêtes auprès des agents communautaires » (q=11) — condition `selected(${MODMSvyMode}, '2')`
- `Jardins_potagers` « Jardins potagers » (q=49) — condition `selected(${MODMSvyMode}, '3')`
  - RÉPÉTITION `crop_production` « Répétez ces questions pour chaque production » (q=5) — condition `count-selected(${GDCropsPlanted}) > 0 or string-length(normalize-spac…`
  - `Water` « Eau » (q=23)
  - `Garden_technicians` « Suivi par les techniciens des jardins potagers » (q=9)
- `Livestock_farming` « Elevage » (q=21) — condition `selected(${MODMSvyMode}, '4')`
  - RÉPÉTITION `Livestock_farming_repeat` « Répétez ces questions pour chaque production » (q=18) — condition `${CPHHToSurvey} > 0`
- `FARNE_monitoring` « Suivi des FARNE » (q=15) — condition `selected(${MODMSvyMode}, '5')`
- `FGD` « Focus Group Beneficiares » (q=73) — condition `selected(${process_monitoring},'4')`
  - `ConsentMon_submodule` « Consentement (suivi) » (q=1)
  - RÉPÉTITION `FGD_Benef` « Focus Group Beneficiares : Qui sont les participants : » (q=2) — condition `${RESPConsent_DM}= '1'`
  - `DM_Survey` « Enquête de suivi de distribution auprès des bénéficiaires » (q=56) — condition `${RESPConsent_DM} = '1' and selected(${HHDMSvyMode}, '1')`
  - `Sbcc_survey` « Changement de comportement » (q=12) — condition `${RESPConsent_DM} = '1' and selected(${HHDMSvyMode}, '2')`
- RÉPÉTITION `TechnicalWarehouse_submodule` « Contrôle du magasin » (q=71) — condition `selected(${process_monitoring},'2')`
  - `warehouse_hr` « Ressources humaines » (q=8)
  - `MOWhInventory` « Inventaire et suivi des stocks » (q=11)
  - `WhDocuments_submodule` « Documentation et traçabilité » (q=14)
  - `Warehouse_Offloading` « Déchargement de l'entrepôt » (q=4)
  - `WhObservation_submodule` « Conditions de stockage et qualite des vivres » (q=32)
- `issues_tracking` « Module de suivi des problèmes » (q=17)
  - RÉPÉTITION `issues` « Répéter les questions pour chaque problème identifié » (q=13) — condition `count-selected(${summary_issues}) >0`
- `FinalTechnical_module` « Technique finale » (q=4)
  - `EnuFeedback_submodule` « Retour de l’énumérateur » (q=4)
- `SitePerf_all_group` « Perfomance du Sites » (q=0)

#### Groupes répétés

| Répétition | Libellé | Parent | Nombre de lignes (`repeat_count`) | Condition | Questions (hors notes) |
|---|---|---|---|---|---|
| `MOSbcSensibilisation` | Sensibilisation (IEC/SCB) | table principale | `libre` | `selected(${MODMSvyMode}, '1')` | `MOSbcSession`, `MOSbcSessionType`, `MOSbcSessionType_oth`, `MOSbcTiming`, `MOSbcMethods`, `MOSbcMethods_oth`, `MOSbcMessages`, `MOSbcMessages_oth`, `MOSbcMaterials`, `MOSbcMaterial_oth`, `MOSbcPartTot`, `MOSbcRegistersAvailable`, `MOSbcRegistersCount1`, `MOSbcRegistersCount2`, `MOSbcContextConstraints`, `MOSbcContextConstraints_exp`, `MOSbcStaffKnow`, `MOSbcNotKnowWhy`, `MOSbcNotKnowWhy_oth`, `MOSbcBenParticip`, `MOSbcBenParticip_oth`, `MOSbcStaffApprec` |
| `crop_production` | Répétez ces questions pour chaque production | table principale | `count-selected(${GDCropsPlanted})` | `count-selected(${GDCropsPlanted}) > 0 or string-l…` | `current_food`ᶜ, `current_food_name`ᶜ, `food_unit`, `food_unit_oth`, `current_food_unit_name`ᶜ, `final_food_unit_name`ᶜ, `GDProd2M`, `GDPreserved2M`, `GDConserved2M` |
| `Livestock_farming_repeat` | Répétez ces questions pour chaque production | table principale | `${CPHHToSurvey}` | `${CPHHToSurvey} > 0` | `HHHeadName`, `HHAnimalsReceived`, `HHMaleCount`, `HHFemaleCount`, `HHAnimalDecrease`, `HHDecreaseWhy`, `HHDecreaseWhy_oth`, `HHDecreaseReason`, `HHDecreaseReason_oth`, `HHVaccUpToDate`, `HHNoVaccWhy`, `HHNoVaccWhy_oth`, `HHHasEnclosure`, `HHNoEnclWhy`, `HHDiffLivestock`, `HHDiffSpecify`, `HHDiffSpecify_oth`, `HHSolutionSuggest`, `lv_ok_nodecr`ᶜ, `lv_ap_nodecr`ᶜ, `lv_ok_vacc`ᶜ, `lv_ap_vacc`ᶜ, `lv_ok_encl`ᶜ, `lv_ap_encl`ᶜ |
| `FGD_Benef` | Focus Group Beneficiares : Qui sont les participa… | table principale | `${FGDPartNb}` | `${RESPConsent_DM}= '1'` | `FGDPartName`, `FGDPartSexe` |
| `HHSbcMessagesRecall_rep` | Messages retenus (ajouter une occurrence par mess… | table principale | `libre` | `${HHSbcPartic} = '1'` | `HHSbcMessagesRecall`, `HHSbcMessagesRecall_oth`, `HHSbcPracticeApplied`, `HHSbcPracticeYes`, `HHSbcPracticeReasonNo`, `sbc_msg_ok`ᶜ, `sbc_ap_apply`ᶜ, `sbc_ok_apply`ᶜ |
| `TechnicalWarehouse_submodule` | Contrôle du magasin | table principale | `libre` | `selected(${process_monitoring},'2')` | `Adm4Code_wh`, `HHCoord_wh`, `MOWhHrdisp`, `MOWhWhatComm`, `MOWhWhatComm_oth`, `MOWhReceipt`, `MOWhStockCard`, `MOWhDocsSigned`, `MOWhDocsSignedText`, `MOWhDocsGoodCond`, `MOWhDocsGoodCondText`, `MOWhAllDamageRep`, `MOWhWayBillRep`, `MOWhLESSLastMile`, `MOWhLESSLastMileWhy`, `MOWhPorterCarry`, `MOWhPorterCarryWhy`, `MOWhBasicEq`, `MOWhBasicEqWhy`, `MOWhOffLoadYN`, `MOWhOffLoadWayBill`, `MOWhOffLoadCounted`, `MOWhOffLoadPropCheck`, `MOFoodStored`, `MOWhStorageType`, `MOWhStorageType_oth`, `MOWhStorageType_outside`, `MOAdeqSize`, `MOStorageCondition`, `MOWhStackPall`, `MOWhStackProp`, `MOWhStackPropText`, `MOInputsSeparated`, `MOWhBatchBBD`, `MOWhBatchBBDWhy`, `MOWHBadCommodouinon`, `MOWHBadCommod`, `MOWHBadCommodIsol`, `MOWhSecMechanism`, `MOWellSecured`, `MOStorageLocked`, `MOWhStorageDrain`, `MOWhStorageVent`, `MOWhDisposeEvidSpill`, `MOWHrecond`, `MOWHrecondmaterials`, `MOWhBagsCloseProp`, `MONFIwithFood`, `MOStockMovementRecord`, `MOWhRegInsp`, `MOWhRegInspWhy`, `MOWhOtherUse`, `MOWhOtherUseText`, `MOPrevDelivery`, `MODeliveryOnTime` |
| `MOWhHrlist` | Liste des personnes au magasin | TechnicalWarehouse_submodule | `libre` | `${MOWhHrdisp}='1'` | `MOWhHrdispName`, `MOWhHrCount`, `MOWhHrtrain`, `MOWhHrtraintype`, `MOWhHrtrainfreq`, `MOWhHrknowproc`, `MOWhHrknowtrack` |
| `RepeatSmpCommodity` | Répètez les questions pour chaque type de vivre d… | TechnicalWarehouse_submodule | `count-selected(${MOWhWhatComm})` | `count-selected(${MOWhWhatComm})>=1` | `CommodityName`ᶜ, `CommodityLabel`ᶜ, `MOComOpeningBalance`, `MOComReceived`, `MOFoodReceivedMatch`, `MOComDamaged`, `MOComDistributed`, `MOComDistributedYN`, `MOCloseBalance`ᶜ, `MOActualBalance`, `MOFoodBalanceFin`ᶜ, `MOFoodBalanceDiff`ᶜ, `MOFoodBalanceDiff_note`, `MOFoodDifferenceinfo`, `wh_ap_bal`ᶜ, `wh_ok_bal`ᶜ, `wh_ecart_bal`ᶜ, `wh_ap_recmatch`ᶜ, `wh_ok_recmatch`ᶜ |
| `issues` | Répéter les questions pour chaque problème identi… | table principale | `count-selected(${summary_issues})` | `count-selected(${summary_issues}) >0` | `getissues`ᶜ, `getComissues`ᶜ, `details`, `risk`, `mitigation`, `suggest`, `risk_response`, `photo`, `risk_owner`, `responsible_unit`, `notify_who`, `reso_status`, `reso_details`, `resolution_date`, `closure_date` |

ᶜ = champ calculé (exporté aussi).

#### Indicateurs du modèle d'activité existant, vérifiés sur ce formulaire

Modèle **STUNT** : 28/28 indicateurs trouvés par nom (2 dans une sous-table) ; 9 notés.

| Code modèle | Variable trouvée | Méthode · pos. · hors base | Sens | Dom. | Remarque |
|---|---|---|---|---|---|
| `MIARO_SBCC_MSG` | `r_sbcc_msg2` | percent_yes · 1 | ↑ | M1 (non noté) | OK |
| `MIARO_SBCC_SATISF` | `r_sbcc_satisf` | mean · — | ↑ | M1 (non noté) | r_sbcc_satisf vaut 0–1 : utiliser r_sbcc_satisf_pct (0–100) |
| `MIARO_SBCC_PARTIC` | `HHSbcPartic` | percent_yes · 1 | ↑ | M1 (non noté) | OK |
| `MIARO_SBCC_APPLY` | `HHSbcPracticeApplied` | percent_yes · 1 | ↑ | M1 (non noté) | SOUS-TABLE `HHSbcMessagesRecall_rep` ; utiliser r_sbcc_apply_pct (table principale, mean) |
| `MIARO_NO_DELAY` | `risk_delay` | percent_value · 0 | ↑ | M2 (non noté) | risk_delay = 1 si HHDTPDelay ≠ 1, y compris VIDE et « 0 = pas de délai » : biaisé ; utiliser r_no_delay (pos. 1) |
| `MIARO_CFM_USED` | `HHAsstUseCFM` | percent_yes · 1 | ↑ | M2 (non noté) | OK |
| `MIARO_KNOW_RIGHTS` | `HHAsstKnowEnt` | percent_yes · 1 | ↑ | M2 (non noté) | OK |
| `MIARO_HELP_CFM` | `r_help_cfm` | percent_yes · 1 | ↑ | M2 (non noté) | OK |
| `MIARO_MC_FUNC` | `r_mc_func` | percent_yes · 1 | ↑ | M2 (non noté) | OK |
| `MIARO_GARDEN_FENCED` | `GDIsFenced` | percent_yes · 1 | ↑ | D3 | OK |
| `MIARO_GARDEN_IRRIG` | `GDIrrigRegular` | percent_yes · 1 | ↑ | D3 | OK |
| `MIARO_GARDEN_SEED` | `GDSeedAvail` | percent_yes · 1 | ↑ | D3 | OK |
| `MIARO_DIGNITY` | `r_dign_prop` | mean · — | ↑ | M4 (non noté) | r_dign_prop vaut 0–1 : utiliser r_dign_prop_pct |
| `MIARO_SCOPE_OK` | `r_scope_ok` | percent_yes · 1 | ↑ | M4 (non noté) | OK |
| `MIARO_ON_TIME` | `MOTimelyDistribution` | percent_yes · 1 | ↑ | D1 | OK |
| `MIARO_NO_DIV_OBS` | `MODistDiv` | percent_value · 0 | ↑ | M4 (non noté) | OK |
| `MIARO_LIST_MATCH` | `MOActBenListMATCHBenDisList` | percent_yes · 1 | ↑ | M4 (non noté) | OK |
| `MIARO_FARNE_LOCAL` | `FRUseLocalFoods` | percent_yes · 1 | ↑ | M5 (non noté) | OK |
| `MIARO_FARNE_MUAC` | `FRScreeningMUAC` | percent_yes · 1 | ↑ | M5 (non noté) | OK |
| `MIARO_FARNE_REFCSB` | `FRRefCSB` | percent_yes · 1 | ↑ | M5 (non noté) | OK |
| `MIARO_NO_SEC_INC` | `HHAsstSecurity` | percent_value · 0 | ↑ | M6 (non noté) | OK |
| `MIARO_DIST_LIST` | `MODistrList` | percent_yes · 1 | ↑ | D1 | OK |
| `MIARO_LIST_SIGNED` | `MOSignedDisList` | percent_yes · 1 | ↑ | D1 | OK |
| `MIARO_REGISTER` | `MOBeneficiaryRegister` | percent_yes · 1 | ↑ | D1 | OK |
| `MIARO_ENT_CALC` | `MOCorrectEntDisCalculation` | percent_yes · 1 | ↑ | D1 | OK |
| `MIARO_BEN_CHECK` | `MOBenCheck` | percent_yes · 1 | ↑ | D1 | OK |
| `MIARO_SPI` | `SitePerformanceIndex` | mean · — | ↑ | KPI (non noté) | OK |
| `MIARO_ISSUES_OPEN` | `reso_status` | count · 4 | ↓ | KPI (non noté) | SOUS-TABLE `issues` |

#### Indicateurs supplémentaires proposés

| Code proposé | Libellé FR | Variable (`name`) | Type · liste (Oui=) | Méthode · pos. · hors base | Sens | Module / dimension | Condition propre (`relevant`) | Remarque |
|---|---|---|---|---|---|---|---|---|
| `MIARO_SCOPE_USED` | SCOPE utilisé sur le site | `MOScopeUsed` | select_one `Yesno` (Oui=1) | percent_yes · 1 | ↑ | M4 · Distribution & SCOPE | — |  |
| `MIARO_SCOPE_FUNC` | Matériel SCOPE fonctionnel | `MOScopeFunc` | select_one `Yesno` (Oui=1) | percent_yes · 1 | ↑ | M4 · Distribution & SCOPE | `${MOScopeUsed} = '1'` |  |
| `MIARO_SCOPE_HANDLING` | Matériel SCOPE bien manipulé | `MOScopeHandling` | select_one `Yesno` (Oui=1) | percent_yes · 1 | ↑ | M4 · Distribution & SCOPE | `${MOScopeFunc} = '1'` |  |
| `MIARO_SCOPE_GEN` | Groupe électrogène fonctionnel | `MOScopeGen` | select_one `Yesno` (Oui=1) | percent_yes · 1 | ↑ | M4 · Distribution & SCOPE | `${MOScopeUsed} = '1'` |  |
| `MIARO_INFO_SESSION` | Séance d'information | `MOInfoSession` | select_one `Yesnona` (Oui=1) | percent_yes · 1 · 9999 | ↑ | D1 · Distribution / conformité | — |  |
| `MIARO_STAFF_VISIBLE` | Personnel visible | `MOStaffVisibility` | select_one `Yesnona` (Oui=1) | percent_yes · 1 · 9999 | ↑ | D1 · Distribution / conformité | — |  |
| `MIARO_STAFF_MIXED` | Personnel mixte | `MOStaffMixGender` | select_one `Yesnona` (Oui=1) | percent_yes · 1 · 9999 | ↑ | D1 · Distribution / conformité | — |  |
| `MIARO_RIGHTS_DISPLAYED` | Droits affichés | `MOPictDisplay` | select_one `Yesnona` (Oui=1) | percent_yes · 1 · 9999 | ↑ | D1 · Distribution / conformité | — |  |
| `MIARO_HELPDESK` | Help desk présent | `MOHelpDesk` | select_one `Yesnona` (Oui=1) | percent_yes · 1 · 9999 | ↑ | M2 · AAP & gouvernance | — |  |
| `MIARO_PRIOR_VULN` | Priorité aux vulnérables | `MOPriorVuln` | select_one `Yesnona` (Oui=1) | percent_yes · 1 · 9999 | ↑ | D1 · Distribution / conformité | — |  |
| `MIARO_ARMED` | Acteurs armés présents | `MOAsstArmed` | select_one `Yesno` (Oui=1) | percent_yes · 1 | ↓ | M6 · Sécurité | — |  |
| `MIARO_FRAUD_OBS` | Inquiétude de fraude (observation) | `MOFraudConcerns` | select_one `Yesno` (Oui=1) | percent_yes · 1 | ↓ | M6 · Sécurité | — |  |
| `MIARO_BENEF_OTHER` | Porteurs de la carte d'un autre | `MOBenefOther` | select_one `Yesno` (Oui=1) | percent_yes · 1 | ↓ | M4 · Distribution & SCOPE | — |  |
| `MIARO_RATION_CUT` | Réduction / substitution de ration | `MOAsstIKRedNut` | select_one `Yesnodk` (Oui=1) | percent_yes · 1 · 888 | ↓ | D1 · Distribution / conformité | `selected(${EntitlementType}, '1') or selecte…` |  |
| `MIARO_CFM_DISPLAYED` | Infos CFM visibles sur le site | `MODistPtsCFM` | select_one `Yesno` (Oui=1) | percent_yes · 1 | ↑ | M2 · AAP & gouvernance | — |  |
| `MIARO_DIGNITY_PCT` | Éléments de dignité en place (% des 11) | `r_dign_prop_pct` | calculate | mean · — | ↑ | M4 · Distribution & SCOPE | — | remplace r_dign_prop (0–1) |
| `MIARO_NO_DELAY_FIX` | Pas de retard au démarrage | `r_no_delay` | calculate | percent_yes · 1 | ↑ | M2 · AAP & gouvernance | — | remplace risk_delay |
| `MIARO_SBCC_SATISF_PCT` | Satisfaction SBCC (0–100) | `r_sbcc_satisf_pct` | calculate | mean · — | ↑ | M1 · SBCC & sensibilisation | — | remplace r_sbcc_satisf |
| `MIARO_SBCC_APPLY_PCT` | Pratiques appliquées (part des messages) | `r_sbcc_apply_pct` | calculate | mean · — | ↑ | M1 · SBCC & sensibilisation | — | agrégat de la sous-table, dans la table principale |
| `MIARO_SBCC_NO_BARRIER` | Aucun obstacle à la participation SBCC | `r_sbcc_nobar` | calculate | percent_yes · 1 | ↑ | M1 · SBCC & sensibilisation | — |  |
| `MIARO_SBCC_FREQ` | Participations SBCC (4 semaines) | `HHSbcFrequency` | integer | mean · — | ↑ | M1 · SBCC & sensibilisation | `${HHSbcPartic} = '1'` |  |
| `MIARO_SBCC_SESSION_OBS` | Séance SBCC en cours lors de la visite | `MOSbcSession` | select_one `Yesno` (Oui=1) | percent_yes · 1 | ↑ | M1 · SBCC & sensibilisation | — | SOUS-TABLE `MOSbcSensibilisation` |
| `MIARO_SBCC_REGISTERS` | Registres SBCC 3 mois disponibles | `MOSbcRegistersAvailable` | select_one `Yesno` (Oui=1) | percent_yes · 1 | ↑ | M1 · SBCC & sensibilisation | `${MOSbcSession} = '1'` | SOUS-TABLE `MOSbcSensibilisation` |
| `MIARO_SBCC_STAFF_KNOW` | Agents maîtrisant les thèmes | `MOSbcStaffKnow` | select_one `Yesno` (Oui=1) | percent_yes · 1 | ↑ | M1 · SBCC & sensibilisation | `${MOSbcSession} = '1'` | SOUS-TABLE `MOSbcSensibilisation` |
| `MIARO_SBCC_QUALITY` | Qualité SBCC bonne / très bonne | `MOSbcStaffApprec` | select_one `MOSbcApprec` | percent_value · 1\|2 | ↑ | M1 · SBCC & sensibilisation | `${MOSbcSession} = '1'` | SOUS-TABLE `MOSbcSensibilisation` |
| `MIARO_FP_VISITS` | Visites régulières du responsable SBCC | `FPVisitRegular` | select_one `Yesno` (Oui=1) | percent_yes · 1 | ↑ | M1 · SBCC & sensibilisation | — |  |
| `MIARO_GARDEN_HARVEST` | Récolte au cours des 2 derniers mois | `GDHarvest2M` | select_one `Yesno` (Oui=1) | percent_yes · 1 | ↑ | D3 · Jardins potagers | — |  |
| `MIARO_GARDEN_RECORD` | Cahier de gestion du jardin | `GDHasRecord` | select_one `Yesno` (Oui=1) | percent_yes · 1 | ↑ | D3 · Jardins potagers | — |  |
| `MIARO_GARDEN_AGROECO` | Techniques agroécologiques | `GDAgroEco` | select_one `Yesno` (Oui=1) | percent_yes · 1 | ↑ | D3 · Jardins potagers | — |  |
| `MIARO_GARDEN_GROUP` | Groupe organisé formé | `GDGroupTrained` | select_one `Yesno` (Oui=1) | percent_yes · 1 | ↑ | D3 · Jardins potagers | `${GDGroupExist} = '1'` |  |
| `MIARO_GARDEN_TECH` | Visites régulières du technicien | `TechVisitRegular` | select_one `Yesno` (Oui=1) | percent_yes · 1 | ↑ | D3 · Jardins potagers | — |  |
| `MIARO_GARDEN_RECO` | Recommandations du technicien appliquées | `TechRecoApplied` | select_one `Yesno` (Oui=1) | percent_yes · 1 | ↑ | D3 · Jardins potagers | `${TechVisitRegular} = '1'` |  |
| `MIARO_GARDEN_WATER_DIST` | Distance au point d'eau (m) | `GDWaterDistM` | integer | mean · — | ↓ | D3 · Jardins potagers | — |  |
| `MIARO_LV_NO_DECR` | Cheptel non diminué (% ménages) | `r_lv_no_decr_pct` | calculate | mean · — | ↑ | D4 · Élevage (nouveau) | — | agrégat de Livestock_farming_repeat |
| `MIARO_LV_VACC` | Animaux vaccinés à jour (% ménages) | `r_lv_vacc_pct` | calculate | mean · — | ↑ | D4 · Élevage (nouveau) | — | idem |
| `MIARO_LV_ENCL` | Enclos présent (% ménages) | `r_lv_encl_pct` | calculate | mean · — | ↑ | D4 · Élevage (nouveau) | — | idem |
| `MIARO_LV_DIFF` | Ménages en difficulté (élevage) | `HHDiffLivestock` | select_one `Yesno` (Oui=1) | percent_yes · 1 | ↓ | D4 · Élevage (nouveau) | — | SOUS-TABLE `Livestock_farming_repeat` |
| `MIARO_FARNE_OPERATIONAL` | FARNE opérationnel | `FROperational` | select_one `Yesno` (Oui=1) | percent_yes · 1 | ↑ | M5 · FARNE & nutrition | — |  |
| `MIARO_FARNE_EDUC` | Messages nutrition / hygiène | `FRNutriHygEd` | select_one `Yesno` (Oui=1) | percent_yes · 1 | ↑ | M5 · FARNE & nutrition | — |  |
| `MIARO_FARNE_HANDWASH` | Eau + lavage des mains | `FRWaterHWashOK` | select_one `Yesno` (Oui=1) | percent_yes · 1 | ↑ | M5 · FARNE & nutrition | — |  |
| `MIARO_FARNE_IEC` | Supports pédagogiques utilisés | `FRIECAvail` | select_one `Yesno` (Oui=1) | percent_yes · 1 | ↑ | M5 · FARNE & nutrition | — |  |
| `MIARO_FARNE_EVEIL` | Éveil / stimulation précoce | `FREarlyStim` | select_one `Yesno` (Oui=1) | percent_yes · 1 | ↑ | M5 · FARNE & nutrition | — |  |
| `MIARO_FARNE_SUPERV` | Supervision régulière | `FRTechSupVis` | select_one `Yesno` (Oui=1) | percent_yes · 1 | ↑ | M5 · FARNE & nutrition | — |  |
| `MIARO_FARNE_SESSIONS` | Sessions FARNE (4 semaines) | `FRSess4W` | integer | mean · — | ↑ | M5 · FARNE & nutrition | — |  |
| `MIARO_IK_RECEIVED` | Dû en nature reçu | `HHAsstEntIK` | select_one `Yesno` (Oui=1) | percent_yes · 1 | ↑ | D1 · Distribution / conformité | `selected(${HHAsstModeLast},'1')` |  |
| `MIARO_IK_AS_ANNOUNCED` | Dû reçu = dû annoncé | `HHAsstEntRcCm` | select_one `Yesnodk` (Oui=1) | percent_yes · 1 · 888 | ↑ | D1 · Distribution / conformité | `selected(${HHAsstEntIK}, '1')` |  |
| `MIARO_KNOW_TARGETING` | Connaît les critères de sélection | `HHAsstKnowPeople` | select_one `Yesno` (Oui=1) | percent_yes · 1 | ↑ | M2 · AAP & gouvernance | — |  |
| `MIARO_EXCLUSION` | Exclusion de personnes éligibles perçue | `HHAsstNeedExcl` | select_one `Yesnodk` (Oui=1) | percent_yes · 1 · 888 | ↓ | M2 · AAP & gouvernance | — |  |
| `MIARO_RESPECT` | Traité avec respect | `HHAsstRespect` | select_one `Yesno` (Oui=1) | percent_yes · 1 | ↑ | M2 · AAP & gouvernance | — |  |
| `MIARO_CFM_RESOLVED` | Problème résolu après CFM | `HHAsstUseCFMSol` | select_one `Yesnodk` (Oui=1) | percent_yes · 1 · 888 | ↑ | M2 · AAP & gouvernance | `${HHAsstUseCFM} = '1'` |  |
| `MIARO_PAY_TRANSPORT` | A payé le transport | `HHAsstPayTrsp` | select_one `Yesno` (Oui=1) | percent_yes · 1 | ↓ | M6 · Sécurité | `selected(${HHAsstModeLast}, '1') or selected…` |  |
| `MIARO_SAFE_ACCESS` | Accès sûr / très sûr | `HHAsstSafeLevel` | select_one `AsstSafeLevel` | percent_value · 1\|2 | ↑ | M6 · Sécurité | — |  |
| `MIARO_FAVOUR` | Faveur / paiement exigé | `HHAsstPayEnt` | select_one `Yesno` (Oui=1) | percent_yes · 1 | ↓ | M6 · Sécurité | — |  |
| `MIARO_DIV_HH` | Détournement rapporté (ménages) | `HHDistDiv` | select_one `Yesno` (Oui=1) | percent_yes · 1 | ↓ | M6 · Sécurité | — |  |
| `MIARO_STOCK_EQ` | Stocks sans écart (part des denrées) | `r_stock_eq0_pct` | calculate | mean · — | ↑ | D5 · Entrepôt / stock (nouveau) | — | agrégat de la sous-table |
| `MIARO_RECEIPT_MATCH` | Réception conforme (part des denrées) | `r_nut_recmatch` | calculate | mean · — | ↑ | D5 · Entrepôt / stock (nouveau) | — | 0–1 : ×100 ou ajouter un *_pct |
| `MIARO_WH_CONDITION` | Magasin propre et en bon état | `MOStorageCondition` | select_one `Yesno` (Oui=1) | percent_yes · 1 | ↑ | D5 · Entrepôt / stock (nouveau) | — | SOUS-TABLE `TechnicalWarehouse_submodule` |
| `MIARO_WH_SECURED` | Magasin bien sécurisé | `MOWellSecured` | select_one `Yesno` (Oui=1) | percent_yes · 1 | ↑ | D5 · Entrepôt / stock (nouveau) | — | SOUS-TABLE `TechnicalWarehouse_submodule` |
| `MIARO_WH_DAMAGED` | Vivres endommagés / infestés | `MOWHBadCommodouinon` | select_one `Yesno` (Oui=1) | percent_yes · 1 | ↓ | D5 · Entrepôt / stock (nouveau) | — | SOUS-TABLE `TechnicalWarehouse_submodule` |
| `MIARO_WH_STOCKCARD` | Fiches de lot à jour | `MOWhStockCard` | select_one `Yesno` (Oui=1) | percent_yes · 1 | ↑ | D5 · Entrepôt / stock (nouveau) | `selected(${MOWhReceipt}, '1')` | SOUS-TABLE `TechnicalWarehouse_submodule` |
| `MIARO_WH_ON_TIME` | Livraisons dans les délais | `MODeliveryOnTime` | select_one `Yesno` (Oui=1) | percent_yes · 1 | ↑ | D5 · Entrepôt / stock (nouveau) | — | SOUS-TABLE `TechnicalWarehouse_submodule` |
| `MIARO_D1` | Score domaine 1 — distribution | `score_d1_100` | calculate | mean · — | ↑ | KPI · Chiffres clés | — |  |
| `MIARO_SITE_SCORE_W` | Score pondéré du site | `site_score_w` | calculate | mean · — | ↑ | KPI · Chiffres clés | — |  |
| `MIARO_SITE_RISK` | Site à risque (automatique) | `SiteRiskAuto` | calculate | percent_value · Oui | ↓ | KPI · Chiffres clés | — | texte Oui/Non |
| `MIARO_ENUM_COMPLAINTS` | Plaintes reçues par l'enquêteur | `EnuFeedbackCompl` | select_one `Yesno` (Oui=1) | percent_yes · 1 | ↓ | M2 · AAP & gouvernance | — |  |

#### « Autre (préciser) »

68 couples (question à choix, choix « Autre ») ; **60** ont une question « préciser » liée, **8** n'en ont pas.

- Liaison par `= (égalité)` : `EnuName`→`EnuName_Other` (999) ; `EnuSupervisorName`→`EnuSupervisorName_Other` (999) ; `POIName`→`POIName_Other` (999) ; `Adm4Name`→`POIName_Other` (999) ; `ImpPrtName`→`ImpPrtName_oth` (999) ; `FPVisitFreq`→`FPVisitFreq_oth` (999) ; `FPVisitReasonNo`→`FPVisitReasonNo_oth` (999) ; `food_unit`→`food_unit_oth` (999) [sous-table `crop_production`] ; `GDIrrigNoWhy`→`GDIrrigNoWhy_oth` (999) ; `GDNoSeedWhy`→`GDNoSeedWhy_oth` (999) ; `TechVisitFreq`→`TechVisitFreq_oth` (999)
- Liaison par `selected(…)` : `NutritiousFood`→`NutritiousFood_oth` (999) ; `MOScopeNotUsedWhy`→`MOScopeNotUsedWhy_oth` (999) ; `MOScopeFuncWhy`→`MOScopeFuncWhy_oth` (999) ; `MOScopeHandlingWhy`→`MOScopeHandlingWhy_oth` (999) ; `MOScopeDiff`→`MOScopeDiff_oth` (999) ; `MOScopeGenWhy`→`MOScopeGenWhy_oth` (999) ; `MOPlannedDistObserved`→`MOPlannedDistObserved_oth` (999) ; `MOBenCheckNonBio`→`MOBenCheckNonBio_oth` (999) ; `MODiscrepancyPlanAct`→`MODiscrepancyPlanAct_oth` (999) ; `MOSbcSessionType`→`MOSbcSessionType_oth` (999) [sous-table `MOSbcSensibilisation`] ; `MOSbcMethods`→`MOSbcMethods_oth` (999) [sous-table `MOSbcSensibilisation`] ; `MOSbcMessages`→`MOSbcMessages_oth` (999) [sous-table `MOSbcSensibilisation`] ; `MOSbcMaterials`→`MOSbcMaterial_oth` (999) [sous-table `MOSbcSensibilisation`] ; `MOSbcNotKnowWhy`→`MOSbcNotKnowWhy_oth` (999) [sous-table `MOSbcSensibilisation`] ; `MOSbcBenParticip`→`MOSbcBenParticip_oth` (999) [sous-table `MOSbcSensibilisation`] ; `FPCapacityBuild`→`FPCapacityBuild_oth` (999) ; `FPTechniques`→`FPTechniques_oth` (999) ; `FPChallenges`→`FPChallenges_oth` (999) ; `GDNoFenceWhy`→`GDNoFenceWhy_oth` (999) ; `GDFenceMat`→`GDFenceMat_oth` (999) ; `GDCropsPlanted`→`GDCropsPlanted_oth` (999) ; `GDWaterSrc`→`GDWaterSrc_oth` (999) ; `GDWaterSrcDiff`→`GDWaterSrcDiff_oth` (999) ; `GDDiffSeason`→`GDDiffSeason_oth` (999) ; `GDPestCtrl`→`GDPestCtrl_oth` (999) ; `GDAgroEcoTech`→`GDAgroEcoTech_oth` (999) ; `TechFollowNoWhy`→`TechFollowNoWhy_oth` (999) ; `TechRecoNoWhy`→`TechRecoNoWhy_oth` (999) ; `HHDecreaseWhy`→`HHDecreaseWhy_oth` (999) [sous-table `Livestock_farming_repeat`] ; `HHDecreaseReason`→`HHDecreaseReason_oth` (999) [sous-table `Livestock_farming_repeat`] ; `HHNoVaccWhy`→`HHNoVaccWhy_oth` (999) [sous-table `Livestock_farming_repeat`] ; `HHDiffSpecify`→`HHDiffSpecify_oth` (999) [sous-table `Livestock_farming_repeat`] ; `HHDTPTranspHow`→`HHDTPTranspHow_oth` (999) ; `HHAsstPayTrspHow`→`HHAsstPayTrspHow_oth` (999) ; `HHDTPDelayRsn`→`HHDTPDelayRsn_oth` (999) ; `HHAsstPayEntHow`→`HHAsstPayEntHow_oth` (999) ; `HHAsstAccessWhat`→`HHAsstAccessWhat_oth` (999) ; `HHAsstAccessCBTPrb`→`HHAsstAccessCBTPrb_oth` (999) ; `HHAsstRespectPrb`→`HHAsstRespectPrb_oth` (999) ; `HHAsstRecInfoNotEasy`→`HHAsstRecInfoNotEasy_oth` (999) ; `HHAsstNoUseCFMWhy`→`HHAsstNoUseCFMWhy_oth` (999) ; `HHAsstUseCFMWhich`→`HHAsstUseCFMWhich_oth` (999) ; `HHSbcMessagesRecall`→`HHSbcMessagesRecall_oth` (999) [sous-table `HHSbcMessagesRecall_rep`] ; `HHSbcParticipBarriers`→`HHSbcParticipBarriers_oth` (999) ; `HHSbcPreferredChannels`→`HHSbcPreferredChannels_oth` (999) ; `MOWhWhatComm`→`MOWhWhatComm_oth` (999) [sous-table `TechnicalWarehouse_submodule`] ; `MOWhStorageType`→`MOWhStorageType_oth` (999) [sous-table `TechnicalWarehouse_submodule`] ; `issue_stage`→`issue_stage_oth` (999) ; `summary_issues`→`summary_issues_oth` (999)
- **Sans question « préciser »** : `CPList` (999=Autres), `Adm3Name` (999=Autres), `Adm4Code_FARNE` (999=Autres), `HHAsstSecurityRisk` (999=Autre (préciser)), `HHSbcPracticeYes` (999=Autre (préciser)), `Adm4Code_wh` (999=Autres), `MOWhStackPall` (999=autres), `MOWhBagsCloseProp` (999=Autre)

## 6. MDG PM RESILIENCE - v4 (`MDG_PROCESS_MONITORING_RESILIENCE_SAMS_V2_1`)

**En bref.** Le plus gros formulaire (480 questions de données, 202 Oui/Non). `process_monitoring` (choix multiple, 9 volets) : 1 post-distribution SAMS, 2 observation OP / CEP / post-récolte, 3 magasin, 4 détournement de marché (MDM), 5 FFA, 6 VSLA, 7 assurance agricole, 8 transformation, 9 hub RRT. **Aucun modèle n'existe** : c'est la cause directe des « 0 indicateur noté » sur 191 soumissions (cf. § 0, point 3). Un modèle « RES » de 13 domaines est proposé ci-dessous (139 éléments, dont 4 en sous-table) ; ses volets relèvent de 3 catégories MMR (« Smallholder agricultural market support activities », « Asset creation and livelihood support activities », « Climate adaptation and risk management activities »), d'où la recommandation du § 7 de déterminer l'activité **par soumission** (`process_monitoring`) plutôt que par fiche.

Défauts du formulaire relevés (à transmettre au concepteur Kobo) :

- **Post-récolte inaccessible seul** : `Post_Harvest_Losses` a `relevant = selected(${MODMSvyMode}, '2')` (CEP) alors que le choix 3 de `MODMSvyMode` est « Suivi des activités de gestion de post-récolte ».
- **MDM dépend du magasin** : `MktDiverSvyType` et `RESPConsent_DSM` sont dans le groupe magasin (`process_monitoring = 3`) mais conditionnent le module MDM (`process_monitoring = 4`) → MDM n'est rempli que si 3 **et** 4 sont cochés.
- **Noms ≠ libellés** dans la coopérative : `COOPMeetingParticipation` = « comité de gestion actif ? », `COOPMeetingCount` = « réunions régulières avec PV ? », `COOPManagementCommittee` = « taux de participation aux réunions » (liste `coverage`).
- `HHSAMSPayRsn` (« à quelle fin ce paiement… ») dépend de `HHSAMSPay` (appuis) et non de `HHSAMSTrainPay` (formation), alors qu'il est dans le module formation.
- `TrackingNotebooksStatus` a des libellés anglais (« None », « Less than 50 % … ») ; `MOWhOffLoadCounted` aussi.
- Les scores du formulaire (`FFA_score`, `VSLA_score`, `INS_score`, `PROC_score`, `RRT_score`) utilisent `coalesce(…, 0)` : une réponse manquante vaut 0.
- 23 choix « Autre » sans question « préciser » (essentiellement RRT, assurance, `conflict_type`, `training_type`).

#### Structure

- **form_id** : `MDG_PROCESS_MONITORING_RESILIENCE_SAMS_V2_1` · **titre** : « MDG PM RESILIENCE - v4 » · **version** : `4` · langue par défaut : Français (fr) · fichier : `710aa2ed-MDG_PROCESS_MONITORING_RESILIENCE_SAMS_V2_1_4.xlsx`
- **Questions par type** : select_one 278, select_multiple 59, integer 43, decimal 11, text 84, calculate 23, note 45, date 2, geopoint 3, begin_group 63, begin_repeat 4, deviceid 1, end 1, start 1, today 1 — soit **480 questions de données** (hors notes, calculs, métadonnées).

**Modules (groupes de 1er et 2e niveau)** — q = questions de données incluses ; condition = `relevant` du groupe (base de tous ses indicateurs) :

- `Technical_module` « Technique » (q=11)
  - `TechnicalBasic_submodule` « Technique (De base) » (q=11)
- `Technical_module_DP` « Technique » (q=15)
  - `TechnicalDP_submodule` « Technique (point de distribution) » (q=15)
- `SAMS_module` « Indicateurs SAMS » (q=119) — condition `selected(${process_monitoring}, '1')`
  - `ConsentPDM_submodule_SAMS` « Consentement (suivi post-distribution) » (q=1)
  - `Ben_Feedback_SAMS` « Appréciation des bénéficiaires SAMS sur l’assistance reçue » (q=58) — condition `selected(${HHDMSvyMode}, '1')`
  - `Ben_Feedback_distribution` « Appréciation des bénéficiaires SAMS sur la distribution et … » (q=60) — condition `selected(${HHDMSvyMode}, '2')`
- `Observation_SAMS_activities` « Observation des activités SAMS auprès des organisations pay… » (q=85) — condition `selected(${process_monitoring}, '2')`
  - `Monitoring_Farmer_Organization` « Suivi auprès des Organisations Paysannes » (q=34) — condition `selected(${MODMSvyMode}, '1')`
  - `Farmer_field_school` « Champ école paysant » (q=32) — condition `selected(${MODMSvyMode}, '2')`
  - `Post_Harvest_Losses` « Pertes Post-Récolte » (q=19) — condition `selected(${MODMSvyMode}, '2')`
- `TechnicalWarehouse_submodule` « Contrôle du magasin » (q=81) — condition `selected(${process_monitoring}, '3')`
  - `warehouse_hr` « Ressources humaines » (q=8)
  - `MOWhInventory` « Inventaire et suivi des stocks » (q=11)
  - `WhDocuments_submodule` « Documentation et traçabilité » (q=14)
  - `Warehouse_Offloading` « Déchargement de l'entrepôt » (q=4)
  - `WhObservation_submodule` « Conditions de stockage et qualite des vivres » (q=31)
  - `TechnicalDiversion_submodule` « Technique (risque de détournement) - Lieu du marché » (q=7)
  - `Coordinates_submodule_DSM` « Coordonnées géographiques » (q=3)
  - `ConsentDiversion_submodule` « Consentement (risque de déjudiciarisation) » (q=1)
- `MarketDiversionRiskMonitoring_module` « Surveillance des risques de détournement de marché » (q=36) — condition `selected(${process_monitoring}, '4')`
  - `DiversionRiskMO_submodule` « Observation du contrôleur » (q=8) — condition `selected(${MktDiverSvyType}, '1') and ${RESPConsent_DSM} = '1'`
  - RÉPÉTITION `DiversionRiskSH_submodule` « DiversionRiskSH_submodule » (q=16) — condition `${nb_shop_keeper}>0 and selected(${MktDiverSvyType}, '2') and ${RESPC…`
  - RÉPÉTITION `DiversionRiskP_submodule` « DiversionRiskSH_submodule » (q=10) — condition `${nb_customers}>0 and selected(${MktDiverSvyType}, '3') and ${RESPCon…`
- `FFA_module` « FFA — Création / réhabilitation d’actifs » (q=22) — condition `selected(${process_monitoring}, '5')`
- `VSLA_module` « Inclusion financière / VSLA (AVEC) » (q=18) — condition `selected(${process_monitoring}, '6')`
- `INS_module` « Assurance agricole » (q=13) — condition `selected(${process_monitoring}, '7')`
- `PROC_module` « Unité de transformation alimentaire » (q=18) — condition `selected(${process_monitoring}, '8')`
- `RRT_module` « Transformation rurale rapide (hub RRT) » (q=59) — condition `selected(${process_monitoring}, '9')`
  - `RRT_committee_group` « Fonctionnement du comité de gestion RRT » (q=11)
  - `security_group` « Sécurité autour du site RRT » (q=5)
  - `RRT_Awareness_group` « Sensibilisation et compréhension des bénéficiaires » (q=10)
  - `RRT_VSLA_group` « Processus VSLA » (q=9)
- `ResiliencePerformance` « Scoring de performance » (q=0)

#### Groupes répétés

| Répétition | Libellé | Parent | Nombre de lignes (`repeat_count`) | Condition | Questions (hors notes) |
|---|---|---|---|---|---|
| `RepeatSmpCommodity` | Répètez les questions pour chaque type de vivre d… | table principale | `count-selected(${MOWhWhatComm})` | `count-selected(${MOWhWhatComm})>=1` | `CommodityName`ᶜ, `CommodityLabel`ᶜ, `MOComOpeningBalance`, `MOComReceived`, `MOFoodReceivedMatch`, `MOComDamaged`, `MOComDistributed`, `MOComDistributedYN`, `MOCloseBalance`ᶜ, `MOActualBalance`, `MOFoodBalanceFin`ᶜ, `MOFoodBalanceDiff`ᶜ, `MOFoodBalanceDiff_note`, `MOFoodDifferenceinfo` |
| `MOMkDiverWFPItemsRepeat` | Répète les questions pour les produits sélectionn… | table principale | `${MOMkDiverWFPItemsCount}` | `selected(${MOMktDiverWFPItemsYN}, '1')` | `MOMkDiverWFPItemsName`ᶜ, `MOMktDiverWFPItemsUnit`, `MOMktDiverWFPItemsQuantity` |
| `DiversionRiskSH_submodule` | DiversionRiskSH_submodule | table principale | `${nb_shop_keeper}` | `${nb_shop_keeper}>0 and selected(${MktDiverSvyTyp…` | `nb_shop_keeper_position`ᶜ, `TrdMktDiverAbnIncrAvail`, `TrdMktDiverAbnIncrAvailComm`, `TrdMktDiverAbnIncrAvailComm_oth`, `TrdMktDiverSellYN`, `TrdMktDiverSellWhere`, `MktTraderNb`, `TrdMktDiverSellScale`, `TrdMktDiverSellComm`, `TrdMktDiverSellComm_oth`, `TrdMktDiverSellComment`, `TrdMktDiverBuyYN`, `TrdMktDiverBuyWho`, `TrdMktDiverBuyWho_oth`, `TrdMktDiverBuyComm`, `TrdMktDiverBuyComm_oth`, `TrdMktDiverBuyComment` |
| `DiversionRiskP_submodule` | DiversionRiskSH_submodule | table principale | `${nb_customers}` | `${nb_customers}>0 and selected(${MktDiverSvyType}…` | `nb_customers_position`ᶜ, `RESPMktDiverAbnIncrAvail`, `RESPMktDiverAbnIncrAvailComm`, `RESPMktDiverAbnIncrAvailComm_oth`, `RESPMktDiverSellYN`, `RESPMktDiverSellWhere`, `RESPMktDiverSellWho`, `RESPMktDiverSellWho_oth`, `RESPMktDiverWFPHumItemsList`, `RESPMktDiverWFPHumItemsList_oth`, `RESPMktDiverSellComment` |

ᶜ = champ calculé (exporté aussi).

#### Indicateurs supplémentaires proposés

| Code proposé | Libellé FR | Variable (`name`) | Type · liste (Oui=) | Méthode · pos. · hors base | Sens | Module / dimension | Condition propre (`relevant`) | Remarque |
|---|---|---|---|---|---|---|---|---|
| `RES_SAMS_TIMELY` | Intrants reçus au bon moment | `HHSAMSTimely` | select_one `SAMSTime` | percent_value · 2 | ↑ | R1 · SAMS — appuis agricoles | `selected(${HHSAMSMode},'1')` | 1 trop tôt, 3 trop tard |
| `RES_SAMS_QTY` | Quantité attendue reçue | `HHSAMSQuant` | select_one `Yesnodk` (Oui=1) | percent_yes · 1 · 888 | ↑ | R1 · SAMS — appuis agricoles | `${HHSAMSTarget}='1'` |  |
| `RES_SAMS_QUAL` | Qualité attendue reçue | `HHSAMSQual` | select_one `Yesnodk` (Oui=1) | percent_yes · 1 · 888 | ↑ | R1 · SAMS — appuis agricoles | `${HHSAMSTarget}='1'` |  |
| `RES_SAMS_EQ_FUNC` | Équipement / infrastructure fonctionnel | `HHSAMSEqFunc` | select_one `Yesnodk` (Oui=1) | percent_yes · 1 · 888 | ↑ | R1 · SAMS — appuis agricoles | `selected(${HHSAMSNFIType},'2') or selected($…` |  |
| `RES_SAMS_ACCESS` | Accès des membres aux appuis | `HHSAMSAggreg` | select_one `Yesno` (Oui=1) | percent_yes · 1 | ↑ | R1 · SAMS — appuis agricoles | `${HHSAMSTarget}='2'` |  |
| `RES_SAMS_PAY` | Paiements / frais exigés | `HHSAMSPay` | select_one `Yesno` (Oui=1) | percent_yes · 1 | ↓ | R1 · SAMS — appuis agricoles | — |  |
| `RES_SAMS_INPUT_USEFUL` | Intrants utiles (assez / très) | `HHSAMSInputHelp` | select_one `SAMSHelp` | percent_value · 3\|4 · 888 | ↑ | R1 · SAMS — appuis agricoles | `selected(${HHSAMSNFIType},'1') or selected($…` |  |
| `RES_SAMS_EQUIP_USEFUL` | Équipement utile (assez / très) | `HHSAMSEquipHelp` | select_one `SAMSHelp` | percent_value · 3\|4 · 888 | ↑ | R1 · SAMS — appuis agricoles | `selected(${HHSAMSNFIType},'3') or selected($…` |  |
| `RES_SAMS_INFO_TYPE` | Info claire sur les articles | `HHSAMSInfoType` | select_one `SAMSInfo` | percent_value · 2\|3 | ↑ | R1 · SAMS — appuis agricoles | `selected(${HHSAMSMode},'1')` |  |
| `RES_SAMS_INFO_USE` | Info claire sur l'usage attendu | `HHSAMSInfoUse` | select_one `SAMSInfo` | percent_value · 2\|3 | ↑ | R1 · SAMS — appuis agricoles | `selected(${HHSAMSMode},'1')` |  |
| `RES_SAMS_INFO_HOW` | Info claire sur l'entretien | `HHSAMSInfoHow` | select_one `SAMSInfo` | percent_value · 2\|3 | ↑ | R1 · SAMS — appuis agricoles | `selected(${HHSAMSMode},'1')` |  |
| `RES_SAMS_INFO_CFM` | Info claire sur le mécanisme de plainte | `HHSAMSInfoCFM` | select_one `SAMSInfo` | percent_value · 2\|3 | ↑ | R1 · SAMS — appuis agricoles | `selected(${HHSAMSMode},'1')` |  |
| `RES_TRAIN_TIMELY` | Formation reçue au bon moment | `HHSAMSTrainTimeliness` | select_one `SAMSTrainTime` | percent_value · 2 | ↑ | R2 · SAMS — formation | `selected(${HHSAMSMode},'2')` |  |
| `RES_TRAIN_ACCESS` | Lieu de formation accessible | `HHSAMSTrainAccess` | select_one `YesnoPartially` (Oui=1) | percent_value · 1 | ↑ | R2 · SAMS — formation | `selected(${HHSAMSMode},'2')` | YesnoPartially : 2 = partiel |
| `RES_TRAIN_SAFE` | Lieu sûr | `HHSAMSTrainSafe` | select_one `YesnoPartially` (Oui=1) | percent_value · 1 | ↑ | R2 · SAMS — formation | `selected(${HHSAMSMode},'2')` | idem (10 questions « conditions ») |
| `RES_TRAIN_SANIT` | Sanitaires séparés H/F | `HHSAMSTrainSanit` | select_one `YesnoPartially` (Oui=1) | percent_value · 1 | ↑ | R2 · SAMS — formation | `selected(${HHSAMSMode},'2')` |  |
| `RES_TRAIN_MOBILITY` | Accès mobilité réduite | `HHSAMSTrainMob` | select_one `YesnoPartially` (Oui=1) | percent_value · 1 | ↑ | R2 · SAMS — formation | `selected(${HHSAMSMode},'2')` |  |
| `RES_TRAIN_UNDERSTOOD` | Contenu compris | `HHSAMSTrainRelUnd` | select_one `YesnoPartially` (Oui=1) | percent_value · 1 | ↑ | R2 · SAMS — formation | `selected(${HHSAMSMode},'2')` |  |
| `RES_TRAIN_LANG` | Langue comprise | `HHSAMSTrainRelLang` | select_one `YesnoPartially` (Oui=1) | percent_value · 1 | ↑ | R2 · SAMS — formation | `selected(${HHSAMSMode},'2')` |  |
| `RES_TRAIN_SKILLS` | Compétences utiles (production) | `HHSAMSTrainRelCap` | select_one `YesnoPartially` (Oui=1) | percent_value · 1 | ↑ | R2 · SAMS — formation | `selected(${HHSAMSMode},'2')` |  |
| `RES_TRAIN_TRAINERS` | Formateurs compétents | `HHSAMSEvalKnow` | select_one `YesnoPartially` (Oui=1) | percent_value · 1 | ↑ | R2 · SAMS — formation | `selected(${HHSAMSMode},'2')` |  |
| `RES_TRAIN_SATISF` | Entièrement satisfait de la formation | `HHSAMSEvalDeliv` | select_one `YesnoPartially` (Oui=1) | percent_value · 1 | ↑ | R2 · SAMS — formation | `selected(${HHSAMSMode},'2')` |  |
| `RES_TRAIN_PAY` | Paiement exigé pour la formation | `HHSAMSTrainPay` | select_one `Yesno` (Oui=1) | percent_yes · 1 | ↓ | R2 · SAMS — formation | `selected(${HHSAMSMode},'2')` | HHSAMSPayRsn relevant pointe HHSAMSPay |
| `RES_ENT_CBT` | Droit CBT reçu | `HHAsstEntCBT` | select_one `Yesno` (Oui=1) | percent_yes · 1 | ↑ | R3 · Distribution & AAP | `selected(${DTPAsstMode}, '2') or selected(${…` |  |
| `RES_ENT_AS_ANNOUNCED` | Dû reçu = dû annoncé | `HHAsstEntRcCm` | select_one `Yesnodk` (Oui=1) | percent_yes · 1 · 888 | ↑ | R3 · Distribution & AAP | `selected(${HHAsstEntIK}, '1')` |  |
| `RES_START_ON_TIME` | Pas de retard ou < 30 min | `HHDTPDelay` | select_one `DistLateTime` | percent_value · 0\|1 · 888 | ↑ | R3 · Distribution & AAP | `selected(${DTPAsstMode}, '1') or selected(${…` |  |
| `RES_WAIT_2H` | Attente ≥ 2 h | `HHAsstTime` | select_one `DistLateTime` | percent_value · 4 · 888 | ↓ | R3 · Distribution & AAP | `selected(${DTPAsstMode}, '1') or selected(${…` |  |
| `RES_PAY_TRANSPORT` | A payé le transport | `HHAsstPayTrsp` | select_one `Yesno` (Oui=1) | percent_yes · 1 | ↓ | R3 · Distribution & AAP | `selected(${DTPAsstMode}, '1') or selected(${…` |  |
| `RES_DAYLIGHT` | Retour possible de jour | `HHAsstTrvlDay` | select_one `Yesnodk` (Oui=1) | percent_yes · 1 · 888 | ↑ | R3 · Distribution & AAP | `selected(${DTPAsstMode}, '1') or selected(${…` |  |
| `RES_FAVOUR` | Faveur / paiement exigé | `HHAsstPayEnt` | select_one `Yesno` (Oui=1) | percent_yes · 1 | ↓ | R3 · Distribution & AAP | — |  |
| `RES_DIVERSION` | Détournement rapporté | `HHDistDiv` | select_one `Yesno` (Oui=1) | percent_yes · 1 | ↓ | R3 · Distribution & AAP | — |  |
| `RES_FRAUD` | Fraude suspectée (ciblage) | `HHFraudConcerns` | select_one `Yesno` (Oui=1) | percent_yes · 1 | ↓ | R3 · Distribution & AAP | — |  |
| `RES_ACCESS_DIFF` | Difficultés d'accès | `HHAsstAccessLast` | select_one `Yesnodk` (Oui=1) | percent_yes · 1 · 888 | ↓ | R3 · Distribution & AAP | — |  |
| `RES_MC_KNOW` | Connaît le comité de gestion | `HHAsstMCKnow` | select_one `Yesnona` (Oui=1) | percent_yes · 1 · 9999 | ↑ | R3 · Distribution & AAP | — |  |
| `RES_MC_REPRESENTED` | Bien représenté par le comité | `HHAsstMCAdeq` | select_one `Yesno` (Oui=1) | percent_yes · 1 | ↑ | R3 · Distribution & AAP | `selected(${HHAsstMCKnow}, '1')` |  |
| `RES_MC_REPORTS` | Comité rend compte | `HHAsstMCRepo` | select_one `Yesno` (Oui=1) | percent_yes · 1 | ↑ | R3 · Distribution & AAP | `selected(${HHAsstMCKnow}, '1')` |  |
| `RES_RESPECT` | Traité avec respect | `HHAsstRespect` | select_one `Yesno` (Oui=1) | percent_yes · 1 | ↑ | R3 · Distribution & AAP | — |  |
| `RES_KNOW_ENT` | Connaît son dû | `HHAsstKnowEnt` | select_one `Yesno` (Oui=1) | percent_yes · 1 | ↑ | R3 · Distribution & AAP | — |  |
| `RES_KNOW_TARGETING` | Connaît les critères de sélection | `HHAsstKnowPeople` | select_one `Yesno` (Oui=1) | percent_yes · 1 | ↑ | R3 · Distribution & AAP | — |  |
| `RES_INFO_RECEIVED` | Informations reçues | `HHAsstRecInfo` | select_one `YesnoNoInfo` (Oui=1) | percent_yes · 1 | ↑ | R3 · Distribution & AAP | — | 2 = jamais reçu (négatif) |
| `RES_EXCLUSION` | Exclusion d'éligibles perçue | `HHAsstNeedExcl` | select_one `Yesnodk` (Oui=1) | percent_yes · 1 · 888 | ↓ | R3 · Distribution & AAP | — |  |
| `RES_CFM_USED` | CFM utilisé | `HHAsstUseCFM` | select_one `Yesno` (Oui=1) | percent_yes · 1 | ↑ | R3 · Distribution & AAP | — |  |
| `RES_CFM_KNOW` | Sait qui contacter (accès) | `HHInfoCFMKnowAcc` | select_one `Yesno` (Oui=1) | percent_yes · 1 | ↑ | R3 · Distribution & AAP | — |  |
| `RES_CFM_SUPPORT` | Sait qui contacter (plainte) | `HHInfoCFMSupport` | select_one `Yesno` (Oui=1) | percent_yes · 1 | ↑ | R3 · Distribution & AAP | — |  |
| `RES_CFM_RESOLVED` | Problème résolu après CFM | `HHAsstUseCFMSol` | select_one `Yesnodk` (Oui=1) | percent_yes · 1 · 888 | ↑ | R3 · Distribution & AAP | `${HHAsstUseCFM} = '1'` |  |
| `RES_SECURITY` | Incident de sécurité | `HHAsstSecurity` | select_one `Yesno` (Oui=1) | percent_yes · 1 | ↓ | R3 · Distribution & AAP | — |  |
| `RES_SAFE_ACCESS` | Accès sûr / très sûr | `HHAsstSafeLevel` | select_one `AsstSafeLevel` | percent_value · 1\|2 | ↑ | R3 · Distribution & AAP | — |  |
| `RES_OP_LEGAL` | Statuts, liste des membres, PV | `COOPLegalDocs` | select_one `Yesno` (Oui=1) | percent_yes · 1 | ↑ | R4 · Organisations paysannes | — |  |
| `RES_OP_BANK` | Compte bancaire actif | `COOPBankAccount` | select_one `Yesno` (Oui=1) | percent_yes · 1 | ↑ | R4 · Organisations paysannes | — |  |
| `RES_OP_COMMITTEE` | Comité de gestion actif | `COOPMeetingParticipation` | select_one `Yesno` (Oui=1) | percent_yes · 1 | ↑ | R4 · Organisations paysannes | — | NOM ≠ LIBELLÉ |
| `RES_OP_MEETINGS` | Réunions régulières avec PV | `COOPMeetingCount` | select_one `Yesno` (Oui=1) | percent_yes · 1 | ↑ | R4 · Organisations paysannes | — | NOM ≠ LIBELLÉ |
| `RES_OP_ATTENDANCE` | Participation aux réunions > 50 % | `COOPManagementCommittee` | select_one `coverage` | percent_value · 4\|5 | ↑ | R4 · Organisations paysannes | — | NOM ≠ LIBELLÉ ; liste coverage |
| `RES_OP_DUES` | Membres à jour de cotisation > 50 % | `COOPMemberContributionRate` | select_one `coverage` | percent_value · 4\|5 | ↑ | R4 · Organisations paysannes | — |  |
| `RES_OP_INPUT_REGISTER` | Distribution d'intrants documentée | `COOPInputRegistry` | select_one `Yesno` (Oui=1) | percent_yes · 1 | ↑ | R4 · Organisations paysannes | — |  |
| `RES_OP_ADVISORY_SAT` | Conseil agricole jugé satisfaisant | `COOPAdvisorySatisfaction` | select_one `YesnoPartially` (Oui=1) | percent_value · 1 | ↑ | R4 · Organisations paysannes | — | 2 = partiel |
| `RES_OP_TRAIN_RECORDS` | Fiches de présence signées | `COOPTrainingRecords` | select_one `Yesno` (Oui=1) | percent_yes · 1 | ↑ | R4 · Organisations paysannes | — |  |
| `RES_OP_SALES_EVIDENCE` | Preuves de vente disponibles | `COOPSalesEvidence` | select_one `Yesno` (Oui=1) | percent_yes · 1 | ↑ | R4 · Organisations paysannes | — |  |
| `RES_OP_CONTRACTS` | Contrats archivés | `COOPContractsArchived` | select_one `Yesno` (Oui=1) | percent_yes · 1 | ↑ | R4 · Organisations paysannes | — |  |
| `RES_OP_PRICE` | Prix supérieurs ou comparables | `COOPPriceComparison` | select_one `YesnoComp` (Oui=1) | percent_value · 1\|2 | ↑ | R4 · Organisations paysannes | — | YesnoComp |
| `RES_OP_INCOME_UP` | Revenu des producteurs en hausse | `COOPIncomeIncrease` | select_one `YesnoPartially` (Oui=1) | percent_value · 1 | ↑ | R4 · Organisations paysannes | — |  |
| `RES_OP_VOLUME_UP` | Volume commercialisé en hausse | `COOPVolumeIncrease` | select_one `YesnoPartially` (Oui=1) | percent_value · 1 | ↑ | R4 · Organisations paysannes | — |  |
| `RES_OP_PTA` | Plan de travail annuel | `COOPActionPlanExistence` | select_one `Yesno` (Oui=1) | percent_yes · 1 | ↑ | R4 · Organisations paysannes | — |  |
| `RES_OP_FEEDBACK` | Réunions de restitution | `COOPFeedbackMechanism` | select_one `Yesno` (Oui=1) | percent_yes · 1 | ↑ | R4 · Organisations paysannes | — |  |
| `RES_OP_ARCHIVES` | Documents clés archivés | `COOPArchiveVerification` | select_one `Yesno` (Oui=1) | percent_yes · 1 | ↑ | R4 · Organisations paysannes | — |  |
| `RES_CEP_LAYOUT` | Champ conforme aux critères | `FieldLayoutCriteria` | select_one `Yesno` (Oui=1) | percent_yes · 1 | ↑ | R5 · Champ école paysan | — |  |
| `RES_CEP_PLOTS` | Parcelles expérimentales de bonne qualité | `ExperimentalPlotQuality` | select_one `ExperimentalPlotQuality` | percent_value · 1 | ↑ | R5 · Champ école paysan | — |  |
| `RES_CEP_VISIBILITY` | Plaques de visibilité | `ExperimentalVisibility` | select_one `Yesno` (Oui=1) | percent_yes · 1 | ↑ | R5 · Champ école paysan | — |  |
| `RES_CEP_TOOLS` | Outils pédagogiques utilisés | `EducationalToolsAvailability` | select_one `Yesno` (Oui=1) | percent_yes · 1 | ↑ | R5 · Champ école paysan | — |  |
| `RES_CEP_ATTENDANCE` | Présence > 50 % aux sessions | `MemberAttendanceRate` | select_one `coverage` | percent_value · 4\|5 | ↑ | R5 · Champ école paysan | — |  |
| `RES_CEP_WOMEN_YOUTH` | Femmes et jeunes > 50 % | `WomenYouthParticipationRate` | select_one `coverage` | percent_value · 4\|5 | ↑ | R5 · Champ école paysan | — |  |
| `RES_CEP_SESSIONS` | Sessions réalisées > 75 % du plan | `TrackingNotebooksStatus` | select_one `TrackingNotebooksStatus` | percent_value · 4 | ↑ | R5 · Champ école paysan | — |  |
| `RES_CEP_PARTICIPATORY` | Méthodes participatives | `LessonsLearnedParticipYes` | select_one `Yesno` (Oui=1) | percent_yes · 1 | ↑ | R5 · Champ école paysan | `${MOSessions} = '1'` |  |
| `RES_CEP_ADOPTION` | Adoption des pratiques > 50 % | `PracticeAdoptionRate` | select_one `coverage` | percent_value · 4\|5 | ↑ | R5 · Champ école paysan | — |  |
| `RES_PH_SYSTEM` | Suivi post-récolte en place | `MOPostHarvestMonitoring` | select_one `Yesno` (Oui=1) | percent_yes · 1 | ↑ | R6 · Post-récolte | — | module relevant MODMSvyMode=2 au lieu de 3 |
| `RES_PH_DRYING` | Séchage correct | `MODrying` | select_one `Yesno` (Oui=1) | percent_yes · 1 | ↑ | R6 · Post-récolte | — |  |
| `RES_PH_PACKAGING` | Conditionnement adapté | `MOPackaging` | select_one `Yesno` (Oui=1) | percent_yes · 1 | ↑ | R6 · Post-récolte | — |  |
| `RES_PH_STORAGE` | Stockage approprié | `MOStorageQuality` | select_one `Yesno` (Oui=1) | percent_yes · 1 | ↑ | R6 · Post-récolte | — |  |
| `RES_PH_TRACEABILITY` | Fournisseurs identifiés | `MOSupplierTraceability` | select_one `Yesno` (Oui=1) | percent_yes · 1 | ↑ | R6 · Post-récolte | — |  |
| `RES_PH_QC` | Contrôle qualité à la réception | `MOQualityControl` | select_one `Yesno` (Oui=1) | percent_yes · 1 | ↑ | R6 · Post-récolte | — |  |
| `RES_PH_CONTRACT` | Livraisons conformes aux contrats | `MOContractCompliance` | select_one `Yesno` (Oui=1) | percent_yes · 1 | ↑ | R6 · Post-récolte | — |  |
| `RES_PH_ACCEPTED_90` | Quantité acceptée ≥ 90 % | `MOAcceptedQuantityRatio` | select_one `MOAcceptedQtyRatio` | percent_value · 4 | ↑ | R6 · Post-récolte | — |  |
| `RES_PH_LOSS_RATE` | Taux de pertes post-récolte (%) | `MOPostHarvestLossRate` | integer | mean · — | ↓ | R6 · Post-récolte | — |  |
| `RES_WH_CONDITION` | Magasin propre et en bon état | `MOStorageCondition` | select_one `Yesno` (Oui=1) | percent_yes · 1 | ↑ | R7 · Magasin | — | bloc magasin identique à GD |
| `RES_WH_STOCKCARD` | Fiches de lot à jour | `MOWhStockCard` | select_one `Yesno` (Oui=1) | percent_yes · 1 | ↑ | R7 · Magasin | `selected(${MOWhReceipt}, '1')` |  |
| `RES_WH_DAMAGED_ISOL` | Zone isolée pour vivres avariés | `MOWHBadCommodIsol` | select_one `Yesno` (Oui=1) | percent_yes · 1 | ↑ | R7 · Magasin | — |  |
| `RES_WH_ON_TIME` | Livraisons dans les délais | `MODeliveryOnTime` | select_one `Yesno` (Oui=1) | percent_yes · 1 | ↑ | R7 · Magasin | — |  |
| `RES_WH_RECEIPT_MATCH` | Réception conforme (par denrée) | `MOFoodReceivedMatch` | select_one `Yesno` (Oui=1) | percent_yes · 1 | ↑ | R7 · Magasin | — | SOUS-TABLE `RepeatSmpCommodity` |
| `RES_MDM_WFP_ITEMS` | Produits du programme vus en vente | `MOMktDiverWFPItemsYN` | select_one `Yesno` (Oui=1) | percent_yes · 1 | ↓ | R8 · Détournement de marché | — |  |
| `RES_MDM_TRADER_HEARD` | Commerçants ayant entendu parler de ventes | `TrdMktDiverSellYN` | select_one `Yesnodkref` (Oui=1) | percent_yes · 1 · 777\|888 | ↓ | R8 · Détournement de marché | — | SOUS-TABLE `DiversionRiskSH_submodule` |
| `RES_MDM_TRADER_OFFERED` | Commerçants sollicités pour acheter | `TrdMktDiverBuyYN` | select_one `Yesnodkref` (Oui=1) | percent_yes · 1 · 777\|888 | ↓ | R8 · Détournement de marché | — | SOUS-TABLE `DiversionRiskSH_submodule` |
| `RES_MDM_CLIENT_HEARD` | Clients ayant entendu parler de ventes | `RESPMktDiverSellYN` | select_one `Yesnodkref` (Oui=1) | percent_yes · 1 · 777\|888 | ↓ | R8 · Détournement de marché | — | SOUS-TABLE `DiversionRiskP_submodule` |
| `RES_FFA_PCP` | Ouvrage inscrit au PCP / 3PA | `FFA_PCPlinked` | select_one `Yesno` (Oui=1) | percent_yes · 1 | ↑ | R9 · FFA (actifs) | — |  |
| `RES_FFA_PROGRESS` | Avancement des travaux (%) | `FFA_Progress` | integer | mean · — | ↑ | R9 · FFA (actifs) | — |  |
| `RES_FFA_CONFORM` | Ouvrage conforme aux normes | `FFA_TechConform` | select_one `YesnoPartially` (Oui=1) | percent_value · 1 | ↑ | R9 · FFA (actifs) | — | 2 = partiel |
| `RES_FFA_SUPERVISED` | Supervision technique | `FFA_TechSupervised` | select_one `Yesno` (Oui=1) | percent_yes · 1 | ↑ | R9 · FFA (actifs) | — |  |
| `RES_FFA_MOU` | MOU de gestion signé | `FFA_MOUsigned` | select_one `Yesno` (Oui=1) | percent_yes · 1 | ↑ | R9 · FFA (actifs) | — |  |
| `RES_FFA_MAINT_DONE` | Entretien réalisé | `FFA_MaintDone` | select_one `Yesno` (Oui=1) | percent_yes · 1 | ↑ | R9 · FFA (actifs) | — |  |
| `RES_FFA_TARGETING` | Ciblage des vulnérables respecté | `FFA_Targeting` | select_one `Yesno` (Oui=1) | percent_yes · 1 | ↑ | R9 · FFA (actifs) | — |  |
| `RES_FFA_SAFETY` | Sécurité de chantier appliquée | `FFA_Safety` | select_one `YesnoPartially` (Oui=1) | percent_value · 1 | ↑ | R9 · FFA (actifs) | — |  |
| `RES_FFA_ENV` | Criblage environnemental réalisé | `FFA_EnvScreen` | select_one `Yesno` (Oui=1) | percent_yes · 1 | ↑ | R9 · FFA (actifs) | — |  |
| `RES_FFA_SURVIVAL` | Taux de survie des plants (%) | `FFA_NurserySurvival` | integer | mean · — | ↑ | R9 · FFA (actifs) | `${FFA_AssetType}='8'` | pépinière seulement |
| `RES_FFA_SCORE` | Score FFA (formulaire) | `FFA_score` | calculate | mean · — | ↑ | R9 · FFA (actifs) | — |  |
| `RES_VSLA_FUNCTIONAL` | Groupe VSLA fonctionnel | `VSLA_Exists` | select_one `Yesno` (Oui=1) | percent_yes · 1 | ↑ | R10 · VSLA / AVEC | — |  |
| `RES_VSLA_COMMITTEE` | Comité de 5 élu | `VSLA_Committee` | select_one `Yesno` (Oui=1) | percent_yes · 1 | ↑ | R10 · VSLA / AVEC | `${VSLA_Exists}='1'` |  |
| `RES_VSLA_CASHBOX` | Caisse à plusieurs clés | `VSLA_Cashbox` | select_one `Yesnodk` (Oui=1) | percent_yes · 1 · 888 | ↑ | R10 · VSLA / AVEC | `${VSLA_Exists}='1'` |  |
| `RES_VSLA_PASSBOOKS` | Carnets à jour | `VSLA_Passbooks` | select_one `Yesno` (Oui=1) | percent_yes · 1 | ↑ | R10 · VSLA / AVEC | `${VSLA_Exists}='1'` |  |
| `RES_VSLA_RULES` | Règlement intérieur écrit | `VSLA_Constitution` | select_one `Yesno` (Oui=1) | percent_yes · 1 | ↑ | R10 · VSLA / AVEC | `${VSLA_Exists}='1'` |  |
| `RES_VSLA_SOCIAL_FUND` | Fonds social en place | `VSLA_SocialFund` | select_one `Yesno` (Oui=1) | percent_yes · 1 | ↑ | R10 · VSLA / AVEC | `${VSLA_Exists}='1'` |  |
| `RES_VSLA_REPAY` | Taux de remboursement (%) | `VSLA_LoanRepayRate` | integer | mean · — | ↑ | R10 · VSLA / AVEC | `${VSLA_Exists}='1'` |  |
| `RES_VSLA_FEMALE_PRES` | Présidente femme | `VSLA_PresidentSex` | select_one `Sex` | percent_value · 0 | ↑ | R10 · VSLA / AVEC | `${VSLA_Committee}='1'` | Sex : 0 = Femme |
| `RES_VSLA_SCORE` | Score VSLA (formulaire) | `VSLA_score` | calculate | mean · — | ↑ | R10 · VSLA / AVEC | — |  |
| `RES_INS_UNDERSTAND` | Produit d'assurance compris | `INS_Understand` | select_one `YesnoPartially` (Oui=1) | percent_value · 1 | ↑ | R11 · Assurance agricole | `${INS_Enrolled}='1'` |  |
| `RES_INS_PREMIUM` | Prime payée | `INS_PremiumPaid` | select_one `Yesnona` (Oui=1) | percent_yes · 1 · 9999 | ↑ | R11 · Assurance agricole | `${INS_Enrolled}='1'` |  |
| `RES_INS_PAYOUT_RECEIVED` | Indemnisation reçue | `INS_PayoutReceived` | select_one `Yesno` (Oui=1) | percent_yes · 1 | ↑ | R11 · Assurance agricole | `${INS_PayoutTriggered}='1'` | si déclenchée |
| `RES_INS_PAYOUT_DELAY` | Délai d'indemnisation (jours) | `INS_PayoutDelayDays` | integer | mean · — | ↓ | R11 · Assurance agricole | `${INS_PayoutReceived}='1'` |  |
| `RES_INS_SATISF` | Satisfait / très satisfait | `INS_Satisfaction` | select_one `Satisfaction` | percent_value · 1\|2 · 888 | ↑ | R11 · Assurance agricole | `${INS_Enrolled}='1'` |  |
| `RES_INS_COMPLAINT` | Peut déposer une plainte | `INS_Complaint` | select_one `Yesnodk` (Oui=1) | percent_yes · 1 · 888 | ↑ | R11 · Assurance agricole | `${INS_Enrolled}='1'` |  |
| `RES_PROC_FUNCTIONAL` | Unité fonctionnelle | `PROC_Functional` | select_one `Yesno` (Oui=1) | percent_yes · 1 | ↑ | R12 · Transformation | — |  |
| `RES_PROC_HYGIENE` | Hygiène du personnel | `PROC_HygienePersonnel` | select_one `YesnoPartially` (Oui=1) | percent_value · 1 | ↑ | R12 · Transformation | `${PROC_Functional}='1'` |  |
| `RES_PROC_TEMP` | Maîtrise de la température | `PROC_TempControl` | select_one `YesnoPartially` (Oui=1) | percent_value · 1 | ↑ | R12 · Transformation | `${PROC_Functional}='1'` |  |
| `RES_PROC_WATER` | Eau potable | `PROC_WaterSafe` | select_one `Yesno` (Oui=1) | percent_yes · 1 | ↑ | R12 · Transformation | `${PROC_Functional}='1'` |  |
| `RES_PROC_TRACE` | Traçabilité des lots | `PROC_Traceability` | select_one `Yesno` (Oui=1) | percent_yes · 1 | ↑ | R12 · Transformation | `${PROC_Functional}='1'` |  |
| `RES_PROC_HACCP` | Points critiques documentés | `PROC_HACCP` | select_one `Yesnodk` (Oui=1) | percent_yes · 1 · 888 | ↑ | R12 · Transformation | `${PROC_Functional}='1'` |  |
| `RES_PROC_EQUIP_GOOD` | Équipements en bon état | `PROC_EquipCondition` | select_one `EquipCondition` | percent_value · 1 | ↑ | R12 · Transformation | `${PROC_Functional}='1'` |  |
| `RES_PROC_SCORE` | Score transformation (formulaire) | `PROC_score` | calculate | mean · — | ↑ | R12 · Transformation | — |  |
| `RES_RRT_OPERATIONAL` | Hub en place et opérationnel | `RRT_HubExists` | select_one `Yesno` (Oui=1) | percent_yes · 1 | ↑ | R13 · Hub RRT | — |  |
| `RES_RRT_SOLAR` | Solaire fonctionnel | `RRT_SolarFunctional` | select_one `Yesno` (Oui=1) | percent_yes · 1 | ↑ | R13 · Hub RRT | `${RRT_HubExists}='1'` |  |
| `RES_RRT_WATER` | Point d'eau fonctionnel | `RRT_WaterFunctional` | select_one `Yesnona` (Oui=1) | percent_yes · 1 · 9999 | ↑ | R13 · Hub RRT | `${RRT_HubExists}='1'` |  |
| `RES_RRT_MAINT` | Dispositif de maintenance | `RRT_Maintenance` | select_one `Yesno` (Oui=1) | percent_yes · 1 | ↑ | R13 · Hub RRT | `${RRT_HubExists}='1'` |  |
| `RES_RRT_INCLUSIVE` | Accès inclusif | `RRT_Inclusive` | select_one `YesnoPartially` (Oui=1) | percent_value · 1 | ↑ | R13 · Hub RRT | `${RRT_HubExists}='1'` |  |
| `RES_RRT_CONFLICT` | Conflit sur le site | `RRT_SiteConflict` | select_one `Yesno` (Oui=1) | percent_yes · 1 | ↓ | R13 · Hub RRT | — |  |
| `RES_RRT_EXCLUSION` | Ménages exclus | `RRT_HHExcluded` | select_one `Yesno` (Oui=1) | percent_yes · 1 | ↓ | R13 · Hub RRT | — |  |
| `RES_RRT_FUNDS` | Gestion des fonds transparente | `fund_management` | select_one `Yesno` (Oui=1) | percent_yes · 1 | ↑ | R13 · Hub RRT | — |  |
| `RES_RRT_SAFE` | Site sûr pour femmes et hommes | `safe_women_men` | select_one `Yesno` (Oui=1) | percent_yes · 1 | ↑ | R13 · Hub RRT | — |  |
| `RES_RRT_INCIDENT` | Incident de sécurité | `security_incident` | select_one `Yesno` (Oui=1) | percent_yes · 1 | ↓ | R13 · Hub RRT | — |  |
| `RES_RRT_KNOW_USE` | Sait utiliser les éléments RRT | `RRT_KnowUse` | select_one `Yesno` (Oui=1) | percent_yes · 1 | ↑ | R13 · Hub RRT | — |  |
| `RES_RRT_CMTE_EFFECTIVE` | Comité efficace (satisfait) | `RRT_CommitteeEffective` | select_one `Likert5` | percent_value · 1\|2 | ↑ | R13 · Hub RRT | — | Likert5 |
| `RES_RRT_VSLA_TRANSFER` | Part RRT versée au VSLA | `RRT_VSLARevenueTransfer` | select_one `Yesno` (Oui=1) | percent_yes · 1 | ↑ | R13 · Hub RRT | — |  |
| `RES_RRT_SCORE` | Score RRT (formulaire) | `RRT_score` | calculate | mean · — | ↑ | R13 · Hub RRT | — |  |

#### « Autre (préciser) »

67 couples (question à choix, choix « Autre ») ; **44** ont une question « préciser » liée, **23** n'en ont pas.

- Liaison par `= (égalité)` : `EnuName`→`EnuName_oth` (9999) ; `EnuName_cp`→`EnuName_oth` (9999) ; `EnuSupervisorName`→`EnuSupervisorName_oth` (9999) ; `EnuSupervisorName_cp`→`EnuSupervisorName_oth` (9999) ; `Adm3Code`→`Adm_3_autres` (999) ; `Adm4Code`→`Adm_4_autres` (999) ; `HHSAMSEvalDelivNo`→`HHSAMSEvalDelivNo_oth` (999) ; `HHSAMSPayRsn`→`HHSAMSPayRsn_oth` (999) ; `HHAsstAccessWhat`→`HHAsstAccessWhat_oth` (999) **(égalité sur choix multiple : la précision n'est demandée que si « Autre » est le SEUL choix)** ; `ParticipantEngagLevel`→`ParticipantEngagLevel_oth` (999) ; `FFA_AssetType`→`FFA_AssetType_oth` (99)
- Liaison par `selected(…)` : `DTPAsstMode`→`DTPAsstMode_oth` (999) ; `DTPAsstCashMode`→`DTPAsstCashMode_oth` (999) ; `HHSAMSNFIType`→`HHSAMSNFIType_oth` (999) ; `HHSAMSAgriInputs`→`HHSAMSAgriInputs_oth` (999) ; `HHSAMSPostHarvEq`→`HHSAMSPostHarvEq_oth` (999) ; `HHSAMSPostHarvInf`→`HHSAMSPostHarvInf_oth` (999) ; `HHSAMSAggregNoAcc`→`HHSAMSAggregNoAcc_oth` (999) ; `HHSAMSTasks`→`HHSAMSTasks_oth` (999) ; `HHDTPTranspHow`→`HHDTPTranspHow_oth` (999) ; `HHAsstPayTrspHow`→`HHAsstPayTrspHow_oth` (999) ; `HHDTPDelayRsn`→`HHDTPDelayRsn_oth` (999) ; `HHAsstPayEntHow`→`HHAsstPayEntHow_oth` (999) ; `HHAsstAccessCBTPrb`→`HHAsstAccessCBTPrb_oth` (999) ; `HHAsstRespectPrb`→`HHAsstRespectPrb_oth` (999) ; `HHAsstRecInfoNotEasy`→`HHAsstRecInfoNotEasy_oth` (999) ; `HHAsstNoUseCFMWhy`→`HHAsstNoUseCFMWhy_oth` (999) ; `HHAsstUseCFMWhich`→`HHAsstUseCFMWhich_oth` (999) ; `COOPPriceComparisonYes`→`COOPPriceComparisonYes_oth` (999) ; `COOPPriceComparisonNo`→`COOPPriceComparisonNo_oth` (999) ; `COOPIncomeDiversification`→`COOPIncomeDiversification_oth` (999) ; `MOActivitiesInProgres`→`MOActivitiesInProgres_oth` (999) ; `MaterialsAvailable`→`MaterialsAvailable_oth` (999) ; `MOWhWhatComm`→`MOWhWhatComm_oth` (999) ; `MOWhStorageType`→`MOWhStorageType_oth` (999) ; `MOMktDiverWFPItemsList`→`MOMktDiverWFPItemsList_oth` (999) ; `TrdMktDiverAbnIncrAvailComm`→`TrdMktDiverAbnIncrAvailComm_oth` (999) [sous-table `DiversionRiskSH_submodule`] ; `TrdMktDiverSellComm`→`TrdMktDiverSellComm_oth` (999) [sous-table `DiversionRiskSH_submodule`] ; `TrdMktDiverBuyWho`→`TrdMktDiverBuyWho_oth` (999) [sous-table `DiversionRiskSH_submodule`] ; `TrdMktDiverBuyComm`→`TrdMktDiverBuyComm_oth` (999) [sous-table `DiversionRiskSH_submodule`] ; `RESPMktDiverAbnIncrAvailComm`→`RESPMktDiverAbnIncrAvailComm_oth` (999) [sous-table `DiversionRiskP_submodule`] ; `RESPMktDiverSellWho`→`RESPMktDiverSellWho_oth` (999) [sous-table `DiversionRiskP_submodule`] ; `RESPMktDiverWFPHumItemsList`→`RESPMktDiverWFPHumItemsList_oth` (999) [sous-table `DiversionRiskP_submodule`]
- Liaison par `nom seulement` : `MOTechPromoted`→`MOTechPromoted_oth` (999)
- **Sans question « préciser »** : `HHAsstSecurityRisk` (999=Autre (préciser)), `Adm4Code_wh` (999=Autres), `MOWhStackPall` (999=autres), `MOWhBagsCloseProp` (999=Autre), `Adm3Code_DSM` (999=Autres), `Adm4Code_DSM` (999=Autres), `MOMktDiverWFPItemsUnit` (999=Autre unité (Merci …), `FFA_QualityIssues` (99=Autre), `INS_PayoutUse` (5=Autre), `INS_Channel` (99=Autre), `RRT_Services` (99=Autre), `RRT_Services` (other=Autre (préciser)), `RRT_Management` (99=Autre), `RRT_ServicesSold` (5=Autre), `RRT_IntegratedWith` (5=Autre), `RRT_ConflictType` (999=Autre (préciser)), `meeting_frequency` (999=Autre (préciser)), `training_type` (999=Autre (préciser)), `RRT_ProjectSource` (other=Autre (préciser)), `RRT_UsedServices14Days` (99=Autre), `RRT_UsedServices14Days` (other=Autre (préciser)), `RRT_VSLATraining` (other=Autre (préciser)), `RRT_VSLAConflictType` (999=Autre (préciser))

## 7. Synthèse transversale

### 7.1 Règle recommandée pour proposer les indicateurs à partir d'un XLSForm

À mettre dans un module pur testé (ex. `monitoring/indicatorProposals.js`, sans I/O), appelé à l'import de la définition et par la carte du modèle ; **rien n'est créé sans validation** (même principe que `suggestBindings`).

1. **Choisir le modèle sans attendre le rattachement.** Calculer, pour chaque activité du catalogue, la part de ses variables présentes dans le formulaire (ici le bon modèle obtient 97–100 % ; mais MIARO couvre aussi 85 % du modèle GD, car les blocs distribution et ménages sont communs : départager par le score le plus haut puis par `formHints`, aujourd'hui inutilisé, appliqué au `form_id` et au titre), et proposer « Rattacher à … et créer N indicateurs » en un geste. Comparer les catégories MMR avec la même normalisation que la route (`toLowerCase().replace(/\s+/g, ' ')`), et afficher un message — pas `null` — quand l'activité rattachée n'a pas de modèle.
2. **Lier par nom, puis vérifier type et liste.** Un nom identique ne suffit pas (`MOWHBadCommod` : Oui/Non dans PECMAM, choix multiple ailleurs ; `MODuplicationBenef` mesure l'inverse de son nom). Refuser la liaison « sûre » si le type diffère du type attendu par la méthode, et vérifier que chaque code positif / hors base existe dans la liste (déjà fait pour le positif par `positiveFor`).
3. **Questions restantes, par type :**
   - `select_one` dont la liste a un choix libellé « Oui »/« Yes » → `percent_yes`, positif = **code lu dans la liste** ; hors base = codes dont le libellé est « Sans objet », « Ne sait pas », « Préfère ne pas répondre », « N/A », « Non applicable » **dans cette liste** (9999, 888, 777 ici) ; listes à 3 modalités (« Partiellement », « Comparable », « Je n'ai jamais reçu d'informations ») → `percent_value` positif 1, la 3ᵉ modalité comptée négative, signalée.
   - Échelles ordonnées (Likert, `coverage`, `SanitaryLevel`, `DistLateTime`, `BeneficiaryRate`, `SAMSTime`…) → `percent_value` sur la ou les modalités du haut reconnues par libellé (« Très », « Bon », « Sanitaire », « au bon moment », « 80 % ou plus », « Plus de 75 % », « Complet »), confiance « à vérifier ».
   - `select_multiple` de type **liste d'éléments en place** (dignité, documents, sécurité, équipements) → une option éclatée `X/k` par élément (`percent_yes` 1) + un champ calculé `count_selected(X)` ; `select_multiple` de type **raisons** (posé si la question parente vaut 0, « pourquoi… ») → pas d'indicateur, distribution seulement.
   - `integer`/`decimal` → `mean` ; `sum` (information) pour les quantités et montants ; libellés « % » / « taux » → `mean` sur 0–100.
   - `calculate` → seulement ceux d'un groupe « score / performance » ou nommés `*_pct`, `score_*`, `*Index*`, `r_*` → `mean` ; un ratio 0–1 est signalé (préférer la variante `_pct` si elle existe).
   - **Exclus** : consentements (`*Consent*`), sélecteurs de module (choix multiple dont les choix apparaissent dans des `relevant` de groupes : `process_monitoring`, `SvyModules`, `SBPSiteSvyType`, `MODMSvyMode`, `HHDMSvyMode`, `DTPAsstMode`…), filtres « avez-vous pu observer… » (gardés en information « taux d'observation »), identification et lieux (listes > 40 choix, `Adm*`, `EnuName`, `CPList`, `DPName`, `POIName`, `ImpPrtName`, `Field_office`), textes, notes, médias, GPS, questions « préciser ».
4. **Sens** : ↑ par défaut ; ↓ proposé par un lexique sur le libellé FR (fraude, détournement, vol, armé, payer / faveur, difficulté, problème, incident, endommagé / gâté / infesté, déversement, retard, exclu, conflit, réduction, « encore faim », « rapportez à la maison ») — toujours « à vérifier » : le lexique se trompe (« Existe-t-il un comité de **plainte** ? » est positif) et un indicateur dont le sens n'est pas confirmé reste non noté.
5. **Module / dimension** = domaine du modèle, sinon libellé du groupe de 1er ou 2e niveau sous le sélecteur de module.
6. **Base** : rien à stocker (les blancs sortent de la base), mais l'explication doit afficher la chaîne des `relevant` (question + groupes) et deux alertes : « question obligatoire sans condition » (base = toutes les visites : magasin GD) et « suite sans condition sur la question parente » (`HHAsstPayEntHow1`…) avec un champ calculé proposé.
7. **Sous-tables** : une variable de répétition n'est **pas pré-cochée** tant que l'agrégation par ligne n'existe pas ; si la table principale contient un agrégat de cette répétition (`sum(${…})` dans un calcul : `any_received_match`, `r_stock_eq0_pct`, `r_sbcc_apply_pct`, `score_stock`), le proposer à la place.
8. **Écran vide** : sur Couverture & performance, une fiche sans indicateur affiche « Aucun indicateur configuré — Rattacher / Créer les N indicateurs proposés » au lieu de cartes vides (retour 85).

### 7.2 Import des groupes répétés — conception recommandée

**Lecture (une seule fonction, même résultat pour la vérification et l'import, comme `readSubmissionsFile`).**

- `.xlsx` Kobo : lire **toutes** les feuilles par `common/sheetRows` (bornes calculées une fois). Feuille principale = celle sans colonnes `_parent_index` / `_submission__uuid` ; chaque autre feuille est rattachée à une répétition du catalogue par son nom (= `name` du `begin_repeat`). Clé parent : `_submission__uuid` → `_uuid` de la soumission (stable d'un import à l'autre, même forme canonique que `canonicalExternalId`), repli `_parent_index` → `_index` de la feuille principale du même fichier ; répétition imbriquée (MIARO) : `_parent_table_name` + `_parent_index` → `_index` de la ligne de la répétition parente. Une feuille inconnue ou une ligne orpheline est comptée et signalée, jamais attachée au hasard.
- API Kobo v2 (JSON) : les répétitions sont des tableaux d'objets que `submissionsFromObjects` jette aujourd'hui (`typeof v === 'object'`) ; les parcourir récursivement en retirant les préfixes de groupe comme pour la table principale.
- Zip SPSS : les `.sav` autres que `data.sav` (un par répétition selon le commentaire de `savParser.js`) — dans un second temps. CSV : une seule table → message « exportez en .xlsx pour les sous-tables ».
- Plafonds : lignes par soumission et par fichier, comme les autres gardes d'import (413/400 explicites).
- Exiger l'export Kobo « XML values and headers » (la vérification avant import peut le détecter) : avec des en-têtes en libellés, aucun nom de variable ne correspond et les réponses arrivent en « Oui »/« Non », comptées négatives face à un positif « 1 ».

**Stockage.** Nouvelle table `monitoring_submission_rows` (`id`, `tenant_id`, `form_id`, `submission_id` → `monitoring_submissions` ON DELETE CASCADE, `repeat_path` text, `row_index` int, `parent_row_index` int NULL, `data` jsonb), `UNIQUE (submission_id, repeat_path, row_index)`, RLS, `SELECT mems_install_same_tenant('monitoring_submission_rows');`, index `(tenant_id, form_id, repeat_path)`. Écriture dans la **même transaction** que la soumission parente : suppression des lignes de la soumission puis **un** INSERT multi-lignes (`insertRows`) — ré-importer est idempotent, une soumission exclue exclut ses lignes. Les lignes héritent de la période, du site, du bureau et du partenaire de leur soumission (aucune dimension propre). Variante écartée : une colonne `repeats jsonb` sur `monitoring_submissions` (plus simple, mais alourdit chaque lecture des réponses — cf. retour 84 — et empêche d'agréger ou d'indexer en SQL).

**Catalogue.** `parseXlsformRows` doit marquer la répétition (aujourd'hui `begin_repeat` est traité comme `begin_group`) → colonne `monitoring_form_fields.repeat_path` ; le sélecteur de variable affiche « sous-table `RepeatSmpCommodity` (une ligne par denrée) ».

**Agrégation.** Nouvel attribut d'indicateur `row_agg` (NULL pour une variable de la table principale ; CHECK sur les valeurs) :

| `row_agg` | Unité de la base | Usage type (ces formulaires) |
|---|---|---|
| `all` | visite : 1 si **toutes** les lignes répondues sont positives | « Réception conforme / solde conforme pour toutes les denrées » (`MOFoodReceivedMatch`, `MOFoodBalanceDiff`, `MOComDistributedYN`), personnel du magasin formé (`MOWhHrtrain`) |
| `any` | visite : 1 si **au moins une** ligne est positive | équivalent de `any_received_match` (SMP), problèmes « en attente » (`reso_status` = 4) |
| `rows` | ligne (répondant, denrée…) — pourcentage poolé | élèves, enseignants, mères en KII, commerçants/clients MDM, ménages éleveurs, messages SBCC |
| `share` | visite : part des lignes positives, puis moyenne des visites (chaque visite pèse 1) | même règle que les ratios du formulaire MIARO (`r_stock_eq0 = sum(ok) / sum(applicable)`) |

Pour un numérique de ligne : somme par visite (quantités) ou moyenne des lignes. Le décompte reste **additif** (lot 7a) : `all`/`any`/`share` produisent une valeur par visite puis passent dans `tallyIndicator` tel quel ; `rows` décompte les lignes et se réunit par bureau/mois avec `mergeTallies`. Les `relevant` internes à la répétition jouent ligne par ligne (blanc = hors base). Nouvelle raison « Non évalué » `no_rows` (module fait, 0 ligne) distincte de `variable_absent`. L'explication affiche « n lignes sur m visites ». Dans le catalogue des modèles, l'avertissement `groupe` devient un `rowAgg` par défaut (+ une variable de repli de la table principale quand elle existe), et la carte cesse de pré-cocher ces éléments tant que la sous-table n'est pas importée.

**FGD + KII (PECMAM).** Garder deux indicateurs distincts (FGD : unité = visite ; KII : `rows`, unité = mère) dans le même domaine plutôt qu'une fusion de variables : les unités ne sont pas comparables.

### 7.3 « Autre, précisez » — règle de comptage

1. **La réponse est le code.** « Autre » (999, ou le code du libellé « Autre » de la liste) est une réponse valide : il entre dans la base et compte négatif pour un indicateur en % (sauf si le modèle l'inclut dans `positiveValue`). Il ne figure **jamais** dans `naValues` — et les codes hors base se déterminent par liste (9999 = « Autre » dans `EnuList`, « Sans objet » dans `Yesnona`).
2. **n(Autre)** = nombre de réponses contenant le code : égalité pour `select_one`, appartenance au jeu de jetons pour `select_multiple` (« 1 3 999 », ou colonne `X/999` = 1) — jamais le nombre de textes « préciser » non vides.
3. **La précision est un attribut de la réponse « Autre »**, lue dans la question liée : liaison détectée à l'import de la définition (le `relevant` d'une question texte cite `${X}` et le code « Autre » ; sinon les suffixes `_oth`, `_Other`, `Oth`, et les `…4` de SMP) et stockée dans le catalogue (`other_of`, `other_code`), réutilisée par `memsMapping` pour les dimensions.
4. **Affichage** : dans les distributions et l'explication, la ligne « Autre » se déplie en « principales précisions » (texte normalisé : espaces, casse, accents) avec leur nombre, plus deux contrôles qualité : « Autre sans précision » (attendu pour les 7 choix multiples liés par `=`) et « précision sans Autre » (doit être 0, sinon défaut de formulaire ou de données).
5. **Reclassement facultatif et traçable** : une table de correspondance par fiche « précision → code existant » (même principe que `monitoring_value_links`, exact seulement ; un texte proche est proposé, jamais appliqué) appliquée au calcul, sans toucher aux données brutes, visible dans l'explication.
6. Les « Autre » de lieu et d'acteur (`DPName`/`POIName` 999 → `*_Other`, `Adm3Code`/`Adm4Code` 999 → `Adm_3_autres`/`Adm_4_autres`) gardent la règle actuelle du Mapping MEMS.

## 8. Annexe — fichiers de l'analyse

Tous dans `xlsform_analysis/` (dossier de travail de la session, hors dépôt) :

- `json/<form_id>.json` — définition complète lue (settings, lignes survey avec chemin de groupes et de répétitions, `relevant`, `required`, `calculation`, listes de choix).
- `csv/<form_id>.candidates.csv` — toutes les questions select / numériques / calculées : liste, code Oui, codes hors base, choix « Autre », répétition, `relevant` propre, chaîne des `relevant` des groupes, proposition heuristique (méthode, positif, sens à vérifier).
- `csv/<form_id>.other_specify.csv` — chaque couple (question, choix « Autre ») avec sa question « préciser » et le `relevant` qui les lie.
- `template_match.json` — pour chaque formulaire × chaque modèle (GD, SMP, MAM, STUNT) : variable trouvée par élément, confiance (`sure` / `probable` / `a_verifier`), répétition, validité du code positif.
- `lists.txt` — listes de choix utilisées, avec leurs codes.
- `parts/*.md` — tableaux de ce rapport (générés par `gen_parts.py` depuis `spec_additions.py`).

Le catalogue des modèles (`server/src/modules/monitoring/indicatorTemplates.json`) n'a pas été modifié ; les corrections proposées (libellés, variables de remplacement, éléments sans option, nouveaux domaines FARNE / magasin MIARO / modèle RES) sont à reporter dans ce fichier et dans ses tests (`server/test/indicatorTemplates.test.js`, et `xlsformImport.test.js` pour le marquage des répétitions) par la session qui portera le chantier.
