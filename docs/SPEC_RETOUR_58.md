# Retour 58 — Affectation des TPM par zone, valeurs par défaut tirées des contrats

> **État : réalisé sur `wip/r58` (15/10/2026)** — voir « Réalisation » ci-dessous (décisions prises par défaut, écarts avec la conception, ce qui est livré, points ouverts). La conception d'origine suit, inchangée ; là où la réalisation s'en écarte, c'est la section « Réalisation » qui fait foi.
> **Numéro de migration** : 070 (réservé au retour 58, `REPRISE.md` § 4).
> **Demande de l'utilisateur** (retour 58 et précision) : le TPM du plan de suivi vient des contrats ; « un onglet spécifique par région, district où on affecte les TPM, mais toujours mettre les valeurs par défaut émanant des contrats » ; toute modification exige une raison. Puis (15/10) : le TPM tiré des contrats doit être le même sur TOUTES les pages qui montrent ou demandent un TPM pour une zone et un mois.

## Réalisation (wip/r58, 15/10/2026)

### Décisions prises par défaut (à confirmer par l'utilisateur)

- **D1 — « le TPM d'un contrat ».** Décidé par défaut le 14/10 : (A) le titulaire. **Révisé le 15/10** pour ne faire qu'UNE règle avec le lot 8 (« prestataire actif au mois M », `tpm/activeProvider.js`) : le TPM d'un contrat de suivi est le ou les partenaires **actifs de type TPM rattachés au contrat par un plan de collecte ou une facture / un rapport** ; à défaut, son **titulaire** (`tpmAttribution.contractTpms`, jumelle SQL dans `mems_tpm_cells`). Aucune colonne ajoutée au contrat. **À confirmer.**
- **Plusieurs contrats couvrent la même zone** : la zone reçoit un **TPM par défaut** (contrat au début le plus récent, puis plus petit numéro, puis nom du TPM) signalé « Plusieurs contrats : choisir » ; la conception initiale ne tranchait pas. **À confirmer.**
- **Zones de contrat détachées par un réimport du découpage** (« Androy > Ambovombe », « Atsimo Andrefana > Ampanihy » → « Ampanihy Ouest ») : **question ouverte**. Rien n'est deviné : ces zones restent « Aucun contrat (à affecter) » et portent l'indice « zone à resélectionner (avenant) : contrat … » (même région, même nom normalisé ou l'un préfixe de l'autre, 5 caractères au moins), avec le lien vers le contrat dans la bannière de l'onglet.

### Écarts avec la conception (et pourquoi)

- **Filet de sécurité en base : estampille, pas refus.** Au lieu de refuser au COMMIT une visite « à estampiller », la base l'**estampille** elle-même : garde AVANT écriture (`mems_site_visit_tpm_guard` : toute visite « zone » insérée, déplacée, re-planifiée ou dont le TPM est écrit directement repasse « à estampiller ») et déclencheur de contrainte DIFFÉRÉ (`trg_site_visits_tpm_stamp` → `mems_tpm_stamp`). Un écrivain qui ignore la règle (générateur du lot 5, seeds, import) obtient donc le TPM des contrats sans rien faire.
- **L'histoire n'est jamais réécrite** (revue du 15/10). Toute re-dérivation automatique — réparation de démarrage, « Appliquer les TPM des contrats », changement de contrat, de zone ou de géographie — ne touche que les visites **prévues**, **non figées** (« antérieur à la règle ») et **pas encore facturées** (facture soumise ou validée de leur TPM ce mois-là) : `AUTO_RESTAMPABLE_SQL` dans le dépôt, et le même filtre dans `mems_tpm_stamp` pour toute visite demandée (défense en profondeur). Une visite réalisée ou annulée garde le TPM qui l'a faite (jours de collecte, base de facture) ; une « reprise » réalisée reste « TPM saisi avant la règle ». Seule une visite **nouvelle** (« à estampiller ») est estampillée une fois quel que soit son statut. Un TPM choisi avec une raison (visite ou zone) n'est jamais touché.
- **Reprise de l'existant au démarrage** (`dataRepairs` `r58_tpm_zones`) : zones des sites calculées (règle du lot 1b), puis TPM des contrats appliqué aux visites prévues ; une transaction par compte, sous verrou consultatif (deux API lancées ensemble : une seule exécution), idempotente, marquée seulement en cas de succès ; un échec est journalisé et l'API reste démarrée. Compte rendu `kept` (motivées, réalisées ou annulées, antérieures, facturées).
- **« Appliquer les TPM des contrats »** (Affectation & visites, onglet) : même fonction que la reprise, sur une période, journalisée visite par visite.
- **Segments d'affichage** : une modification compte par DÉCISION (même lot, même raison) — six mois modifiés d'un coup forment un seul segment.
- **Écarts comptés** sur les seules visites prévues (une visite réalisée n'est pas un écart à traiter).

### Ce qui est livré

- **Règle pure** `server/src/modules/tpm/tpmAttribution.js` (+ `common/reasonText.js`) ; règle commune du lot 8 reprise telle quelle (`activeProvider*.js`, commit 4185750). Parité JS ↔ SQL : `server/scripts/tpmParity.js` (19 200 cellules, 0 écart sur la base de dev).
- **Migration 070** : `sites.zone_district_id/zone_commune_id`, `tpm_zone_overrides` (raison 10–500, instantané du contrat, CHECK « diffère du contrat », RLS USING + WITH CHECK), `tpm_attribution_log` (inscription seule : REVOKE UPDATE/DELETE/TRUNCATE), colonnes d'origine du TPM sur `site_visits` + CHECK de forme, `mems_tpm_cells` / `mems_tpm_stamp`, garde et estampille différée, `mems_install_same_tenant`.
- **API** `/api/tpm/attribution` : `GET /` (onglet), `GET /providers` (sélectionnables du mois + `contractTpms`), `GET /resolve` (TPM d'un site pour un mois), `GET /log`, `POST /preview`, `PUT /overrides` (empreinte → 409 si périmée), `POST /revert`, `POST /apply`, `POST /visits`. `GET /api/tpm/field/rbm/sites` porte `tpm` (TPM de la zone de chaque site).
- **Écrans** :
  - Plan de suivi : colonne « Prestataire (TPM) » (`TpmZoneCell.jsx`) — TPM de la zone + origine (« contrat FLA-… », « aucun contrat actif sur cette zone ce mois », « 2 contrats : choisir », « zone à resélectionner »), infobulle avec la règle et les segments de l'exercice ;
  - Affectation & visites : TPM de chaque visite + origine, crayon → changement motivé (`TpmVisitDialog.jsx`), filtre « Origine du TPM », « Appliquer les TPM des contrats », nouvelle visite = TPM de la zone ;
  - onglet **« Affectation des TPM »** (`TpmAttributionTab.jsx`, props `{ canEdit }`, adresse `#/processus/rbm/tpm`) avec `TpmChangeDialog.jsx` (aperçu sans écriture, raison obligatoire, retour au contrat) et `TpmAttributionLog.jsx` (journal) — composant autonome, monté dans l'espace RBM par la session principale ;
  - Priorités du mois : colonne « TPM de la zone » ; Planification & budget : le contrat propose son TPM (et inversement), un autre couple est signalé.
- **Tests** : règle pure, migration (texte), dépôt et service (faux client), routes, gardes des écrivains de visites, démarrage (`dataRepairsRunner.test.js`) et, en base réelle sur demande, `tpmRepairDb.test.js` (deux démarrages simultanés, rejouée = 0 changement, visites motivées / réalisées / annulées / antérieures / facturées inchangées par la reprise ET par l'action, `mems_tpm_stamp` qui refuse en base).

### Points de choix d'un prestataire (avant → après)

| Écran / chemin | Avant | Après |
|---|---|---|
| Plan de suivi, colonne TPM | Noms des prestataires saisis sur les visites | TPM de la zone selon contrat (ou modification motivée), origine affichée |
| Affectation & visites, visite | Liste de tous les prestataires, sans raison | TPM de la zone ; autre TPM = écart motivé (raison obligatoire, journal) |
| Nouvelle visite, import « Planning », génération RBM | Aucun TPM | TPM de la zone estampillé au COMMIT (l'import « Planning » ne lit aucune colonne TPM : rien à contredire) |
| Priorités du mois (RBM) | Aucun TPM | Colonne « TPM de la zone » |
| Planification & budget (plan) | Prestataire et contrat choisis séparément | Le contrat propose son TPM, le TPM propose son contrat ; autre couple signalé |
| Factures, rapports attendus, évaluations, formations | Listes complètes | Règle commune du lot 8 (`ProviderSelect` du lot 8, branche `wip/lot8`) |
| Jours de collecte | Visites datées par prestataire | Inchangé : suit le TPM estampillé des visites |

## Règle « Attribution des TPM »

**Attribution des TPM (retour 58)**

1. **Zone d'un site.**
   - Son **district** suit la règle commune des tableaux de bord (lot 1b, `siteDistrict`), puis se rattache à son identifiant dans le découpage.
   - Sa **commune** est celle de sa localité reconnue, seulement si cette commune appartient à ce district.
   - Un site sans district reconnu est en état « district inconnu » : il ne reçoit aucun TPM.

2. **TPM selon contrat** d'une zone pour un mois M. Il est recalculé à chaque lecture et n'est jamais stocké.
   - On retient les **contrats de suivi** (ligne IV.suivi > 0) qui **couvrent M** :
     - contrat « actif » : mois(début) ≤ M ≤ mois(fin) ;
     - contrat « résilié » : mois(début) ≤ M ≤ mois(résiliation).
   - Les dates décident seules : un contrat échu mais encore marqué « actif » ne couvre plus le mois.
   - Il faut aussi qu'une zone du contrat, liée par identifiant, contienne la zone. La zone de contrat la plus précise l'emporte.
   - Selon le nombre de titulaires :
     - un seul titulaire : « Selon contrat » ;
     - aucun : « Sans contrat » ;
     - plusieurs : « À arbitrer ». Ce cas n'est jamais tranché automatiquement.

3. **TPM retenu.**
   - C'est la modification enregistrée pour cette zone et ce mois. Sans modification, c'est le TPM selon contrat.
   - Toute valeur différente de l'unique valeur du contrat est une modification : un autre TPM, un choix entre deux contrats, ou « aucun TPM ».
   - Une modification porte :
     - une zone et un mois ;
     - une raison obligatoire, de 10 à 500 caractères, qui doit être une vraie phrase ;
     - un instantané de ce que disait le contrat ;
     - une entrée dans un journal inaltérable.
   - On peut modifier une région entière avec une seule raison.
   - « Revenir au contrat » efface la modification.
   - Si le contrat change ensuite, la modification reste appliquée mais passe « à confirmer ».

4. **TPM d'une visite.**
   - C'est le TPM retenu de sa commune si la commune a sa propre ligne, sinon celui de son district, au mois de la visite.
   - Il est écrit sur la visite, quel que soit le chemin de création.
   - Une visite prévue suit sa zone :
     - après une modification de zone : sur les mois modifiés ;
     - après un changement de contrat ou de géographie : à partir du mois courant.
   - Une visite réalisée ou annulée garde son TPM.
   - Pour qu'une visite s'écarte de sa zone, il faut sa propre raison.

5. **Prestataire actif au mois M** : titulaire d'un contrat de suivi qui couvre M, avec une fiche active.
   - **Sélectionnables** : d'abord les prestataires actifs, puis les autres partenaires actifs de type TPM, dans un groupe à part.

## Spécification

# Retour 58 : affectation des TPM par zone (spécification de réalisation)

> **Ce que l'utilisateur a dit, mot pour mot.** « Pour l'attribution des TPM dans le plan de suivi, note qu'on l'a déjà fait dans les contrats donc ça devrait aller dans ce sens, mais s'il y a modifications on doit donner la raison. » Puis, une minute après : « Ou pour l'attribution / affectation tu fais un onglet spécifique par région, district où on affecte les TPM, mais toujours mettre les valeurs par défaut émanant des contrats. »
>
> **Statut.** Cette spécification est unique et peut être construite telle quelle. Elle fusionne deux conceptions indépendantes :
> - **C1** : dérogations avec instantané du contrat, re-dérivation `restampVisitsTx`, invariants ;
> - **C2** : onglet région › district, règle de district du lot 1b, fenêtre partagée, aperçu d'impact, empreinte optimiste.
>
> **Base retenue.** C1 fournit le modèle de données, les invariants et la re-dérivation. C2 fournit la règle de district, les écrans, l'empreinte et l'aperçu. Le § 1 tranche chaque désaccord.
>
> **Sources lues, en lecture seule.**
> - Branches : `origin/main` 8389e32, `wip/fix-1b` 2683679, `wip/fix-6a` ecfad8f, `wip/7a` a1ac74f, `origin/claude/zealous-bardeen-p9ozcr` 3838254.
> - Base de dev en `BEGIN READ ONLY … ROLLBACK`. Les requêtes sont dans `scratchpad/r58/syn/q1.sql` à `q4.sql`.
>
> **Une seule question bloque, et elle ne touche que les valeurs affichées** : qui est « le TPM d'un contrat » (D1, § 17). La règle lit ce choix à un seul endroit, `contractTpm`. On peut donc commencer à construire.
>
> **Emplacement.** Le constructeur copie ce texte dans `docs/SPEC_LOT_58.md`.

---

## 0. En bref

1. **Un 5ᵉ onglet « Affectation des TPM »** dans l'espace RBM, à l'adresse `#/processus/rbm/tpm`, juste après « Plan de suivi ». Aucune route ni entrée de menu à ajouter.
   - Les lignes sont rangées par **région › district**. Une ligne **commune** n'apparaît que si un contrat descend à la commune ou si une modification y est posée.
   - Chaque ligne montre deux valeurs :
     - le **TPM selon contrat**, recalculé en direct et jamais saisi ;
     - le **TPM retenu**.
2. **Changer un TPM** ouvre une fenêtre qui contient :
   - le nouveau TPM ;
   - la période « du … au … » ;
   - la **raison obligatoire** ;
   - l'**aperçu de l'impact** : visites prévues qui changent de TPM, visites datées déplacées, c'est-à-dire les jours de collecte.

   On peut changer **une région entière** en une seule fois, avec une seule raison. « Revenir au contrat » efface la modification.
3. **Ce qui est stocké.**
   - Seules les **modifications** sont stockées, une ligne par zone × mois. Chacune garde l'**instantané de ce que disait le contrat** au moment de la décision. Si le contrat change ensuite, la modification reste appliquée mais elle est signalée « à confirmer ».
   - Chaque décision humaine écrit une entrée dans un **journal inaltérable** (qui, quand, avant → après, raison).
4. **Les visites héritent du TPM de leur zone.** Il est écrit sur la visite (`site_visits.provider_id` et son origine) quel que soit le chemin :
   - saisie ;
   - « Générer » du RBM ;
   - cases du plan de suivi ;
   - les trois imports ;
   - le futur générateur du lot 5.

   Une seule fonction tient cette valeur à jour : `restampVisitsTx`. Un déclencheur différé en base refuse toute transaction qui laisserait une visite sans TPM estampillé.

   Une visite peut encore s'écarter de sa zone, mais **avec sa propre raison**.
5. **Les tableaux de bord restent justes sans modification.** Couverture par prestataire, alertes, jours de collecte, carte 6a et blocs 7a lisent toujours `provider_id`, qui est désormais rempli selon la règle.

---

## 1. Arbitrages entre les deux conceptions

| # | Sujet | C1 | C2 | **Retenu** | Pourquoi |
|---|---|---|---|---|---|
| 1 | District d'un site | `admin_area_id` + lignée ; site « à vérifier » (sans TPM) si le district déclaré le contredit | Règle `siteDistrict` du lot 1b (graphie, P-code cru seulement dans la bonne région), rapportée à un id de district | **C2** (§ 5) | Une seule règle de district avec les tableaux de bord : la ligne « Amboasary-Atsimo » de l'onglet couvre exactement les sites que les tableaux de bord y rangent. Mesuré en dev : 1 272 sites sur 1 280 ont un district sûr avec la règle 1b. Avec la lignée seule, 199 sites restent sans district et 324 se contredisent. Les zones de contrat restent comparées **par identifiant**. |
| 2 | Origine du TPM d'une visite | 5 sources (contrat / dérogation / exception / reprise / à affecter) + `provider_stamped_at` | 3 origines (zone / visite / reprise) | **Les deux** : `provider_source` ∈ zone / visite / reprise (C2), plus `provider_zone_state` qui garde l'état de la cellule (C1). `NULL` veut dire « à estampiller » et remplace `provider_stamped_at`. | L'origine dit qui décide ; l'état dit pourquoi (« à affecter : sans contrat ») sans recalcul à la lecture. Cela fait une colonne de moins que C1. |
| 3 | Portée des recalculs | Toutes les visites prévues, y compris les mois passés | Mois courant et suivants pour un changement de contrat | **Mixte** (§ 7.2). Changement implicite (contrat, géographie) : mois ≥ mois courant. Changement explicite d'une zone : les mois choisis, passés compris. Bouton « Réappliquer » : une plage. Visites réalisées et annulées : jamais. | Pas de réécriture silencieuse du passé, car un avenant n'a pas de date d'effet. Une décision humaine motivée s'applique à ce qu'elle vise. |
| 4 | Garantir que tout écrivain estampille | Visites jamais estampillées rattrapées + garde de test statique | `RETURNING id` puis `applyZoneProviderTx({visitIds})` | **C1, renforcé** : rattrapage de l'état `NULL` + garde statique + **déclencheur de contrainte différé** en base (§ 6.4) | Fiabilité d'abord : un écrivain oublié, par exemple le lot 5, échoue au COMMIT au lieu de corrompre les chiffres. |
| 5 | Journal | Une ligne par zone × mois ou par visite, sans clé étrangère | Une ligne par lot, avec tableaux d'ids et `before` en jsonb | **Une table**, `tpm_attribution_log` : une ligne d'en-tête `lot` (comptes, période, raison) plus une ligne par zone × mois ou par visite. Aucune clé étrangère : noms en instantané. | Interrogeable par zone et par visite (C1), lisible par lot (C2). |
| 6 | Inaltérabilité du journal | `GRANT SELECT, INSERT` | `GRANT` + `REVOKE UPDATE, DELETE, TRUNCATE` | **C2** | Les migrations 002 et 012 posent `ALTER DEFAULT PRIVILEGES … GRANT SELECT, INSERT, UPDATE, DELETE` à `mems2_app`. Un simple GRANT laisserait donc UPDATE et DELETE. **Le REVOKE est indispensable.** |
| 7 | Instantané du contrat dans la modification | Oui (`expected_*` + CHECK « diffère du contrat ») | Non | **C1** | Permet l'état « à confirmer » et un garde-fou en base contre une modification redondante. |
| 8 | Concurrence entre l'aperçu et l'enregistrement | Instantané calculé dans la transaction | Empreinte `stamp` → 409 | **Les deux** | Le serveur recalcule toujours l'instantané. L'empreinte évite d'enregistrer sur un aperçu périmé. |
| 9 | Durée maximale d'une écriture | 24 mois | 60 mois | **24 mois** (`PERIOD_CAPS.facts`), 300 zones, 2 400 cellules | Écriture bornée, même plafond que la lecture. Aucune nouvelle clé de plafond, donc pas de modification du test de parité du lot 1b. |
| 10 | Présentation de l'onglet | Matrice zones × mois avec sélection de cellules | Liste par mois + vue « Période » en segments | **C2**, plus le bloc « Selon les contrats » de C1 dans la fenêtre | La période « du … au … » de la fenêtre remplace la sélection de cellules. La vue liste montre côte à côte « selon contrat » et « retenu », ce que demande l'utilisateur. |
| 11 | Colonne TPM du Plan de suivi | Toujours tirée des visites | TPM de la zone du site | **C2** (+ marque « ≠ » sur les visites qui s'écartent) | C'est la réponse directe au premier message : le plan montre le TPM avant même qu'une visite existe. |
| 12 | `contract_id` sur la visite | Seulement « selon contrat » | Aussi pour un arbitrage | **C2** | Quand une modification choisit l'un des contrats en concurrence, la visite porte ce contrat. |
| 13 | Zone de contrat au fokontany | Ignorée et signalée | Rend la commune « partielle » | **C1** | Une zone au fokontany ne prouve pas que toute la commune est couverte. Aucun cas dans les données. |
| 14 | « Prestataire actif » / listes de choix | « type TPM ou titulaire » | « titulaire » | **Deux notions** (§ 3) : *actif* = titulaire ; *sélectionnable* = actifs, puis les autres TPM actifs, en groupe à part. La règle est vérifiée **pour chaque mois** de la plage. | Fidèle à la définition commune, sans fermer la porte aux TPM sans contrat, qui restent toujours une modification motivée. |
| 15 | Où exposer la liste des prestataires | Nouvel endpoint | `listProviders?month` dans `tpm.repository` | **C1** : `GET /api/tpm/attribution/providers` | On ne touche pas le fichier du lot 8, qui s'y branchera. |
| 16 | Option « TPM de ce planning » à l'import | Hors périmètre | Incluse | **Hors périmètre** | Le changement groupé de visites avec une seule raison (§ 8.3) couvre le besoin, sans toucher la route d'import multipart. |
| 17 | Règle de la raison | ≥ 10 caractères, ≥ 5 lettres | ≥ 10 caractères, ≥ 3 caractères distincts, dans `common/reasonText.js` | **Les deux règles**, dans `common/reasonText.js` | Refuse « .......... » et « aaaaaaaaaa ». Réutilisable par le retour 56. |
| 18 | Point d'accroche « géographie des sites » | `applySitesGeoTx` seulement si des sites ont changé | `addSite`, `bulkUpdateSites`, `replaceBreakdown` | **Fin de `applySitesGeoTx`, sans condition** | Seul point par lequel passent `afterSitesChangedTx` (toute écriture de sites) et toutes les écritures de Localités. Le district du lot 1b dépend aussi du texte `adm1/adm2`, donc l'appel doit être inconditionnel. |
| 19 | Reprise de l'existant | Visites avec TPM → reprise ; sans TPM → à affecter | Visites avec TPM → reprise ; réparation au démarrage | **Mixte** (§ 6.3). Avec TPM : `reprise` + raison système. Sans TPM, réalisées, annulées ou de mois passés : état `anterieur` (rien n'est réécrit). Sans TPM, prévues pour le mois courant ou après : estampillées par la réparation `r5_tpm_selon_zone`. | On ne réécrit pas l'historique : les 108 visites réalisées sans TPM ne reçoivent pas un TPM qu'on ne connaît pas. |
| 20 | Fiche partenaire 360° (« zones par affectation ») | — | Incluse | **Hors périmètre** | Évite un conflit avec 7a (catalogue TPM) et le lot 8. |
| 21 | Alertes | Une alerte | Deux alertes | **Trois codes** (§ 8.6) : conflit, à confirmer, fin de contrat | Chaque code mène à son filtre dans l'onglet. |

**Deux constats nouveaux** que les deux conceptions avaient manqués :
- **(a) Interblocage possible.** `replaceBreakdown` doit prendre le verrou d'attribution **avant** de toucher `tpm_zone_overrides`, sinon il peut se bloquer mutuellement avec une écriture de modification (§ 7.3).
- **(b) Seeds.** `seed.js` (l. ~300) et `seed-test.js` (l. ~108, ~275) insèrent des visites. Ils doivent appeler `restampVisitsTx`, sinon le déclencheur différé les refuse.

---

## 2. Constat utile (base de dev, 14/10/2026)

### Contrats de suivi

Tous ont IV.suivi > 0.

| Contrat | Statut | Période | Titulaire (type) | Zones (toutes des districts) |
|---|---|---|---|---|
| CTR-2026-0001 | actif | 2025-10-01 → **2026-09-30 (échu)** | ASSOCIATION AINA (prestataire) | Beloha, Bekily, Ambovombe (**détachée**) |
| CTR-2026-0002 | actif | 2026-03-01 → 2026-11-30 | TOHANA (prestataire) | Amboasary-Atsimo, Betroka |
| CTR-2026-0003 | actif | 2026-02-01 → 2026-12-31 | MIARO (prestataire) | Betioky Atsimo, Ampanihy (**détachée**) |

Les TPM RANO Control, SAHY Monitoring et YPA (type `tpm`) n'ont **aucun contrat** : c'est la question D1.

### Sites par district, selon la règle du lot 1b

Il y a 1 280 sites au total.

| Région | Districts (nombre de sites) |
|---|---|
| Androy | Ambovombe-Androy 166 · Antanimora Sud 82 · Bekily 134 · Beloha 115 · Tsihombe 104 |
| Anosy | Amboasary-Atsimo 97 · Betroka 12 · Taolagnaro 108 |
| Atsimo Andrefana | Ampanihy Ouest 51 · Benenitra 8 · Betioky Atsimo 288 · Morombe 29 · Sakaraha 6 · Toliary-II 68 |
| Menabe | Manja 4 |

- **8 sites** ont un district inconnu. Aucun site n'a de district ambigu.
- **Zones de contrat liées** : 646 sites y tombent (Bekily 134, Beloha 115, Amboasary-Atsimo 97, Betroka 12, Betioky Atsimo 288).
- **Zones détachées** : leurs districts actuels (Ambovombe-Androy, Antanimora Sud, Ampanihy Ouest) regroupent 299 sites, qui n'ont pas de valeur par défaut.

### Visites

Il y a 156 visites.
- **48 portent un TPM.** Parmi elles, les **12 visites prévues** (6 en septembre, 6 en octobre 2026) sont **toutes à Amboasary-Atsimo** (zone de CTR-0002) et portent RANO, SAHY et YPA mélangés.
- **108 visites réalisées n'ont pas de TPM.**
- Aucune visite ne porte de `contract_id`.

### Chemins de création des visites

| Chemin | Fonction (lignes `main`) | TPM aujourd'hui |
|---|---|---|
| Génération RBM | `generateFromRbmTx` (~363-391) | jamais posé |
| Cases du plan de suivi | `planMonthsTx` (~896-938) | jamais posé |
| Import Locations Management | `importLocations` (~1029) | jamais posé |
| Import feuille « Planning » | `importPlanning` (~739-765) | jamais posé |
| Import « Risk-based site selection » | `importPlanSites` (~261-334) | jamais posé |
| Saisie manuelle | `createVisit` / `updateVisit` (~688-724) | choix libre |

Seule la saisie manuelle pose un TPM, sans aucun contrôle de cohérence.

---

## 3. Définitions communes (à reporter dans `docs/PLAN_RETOURS_15_37.md`)

Remplacer la ligne « Prestataire actif » par ces quatre lignes :

| Notion | Règle |
|---|---|
| **Contrat de suivi couvrant le mois** | Contrat dont la ligne IV.suivi est > 0 (même expression que la Consolidation, `MONITORING_LINE`) et qui couvre le mois M. Il couvre M dans deux cas :<br>• « actif » et mois(début) ≤ M ≤ mois(fin) ;<br>• « résilié » et mois(début) ≤ M ≤ mois(résiliation).<br>Un mois entamé compte. Les dates décident : un contrat échu mais encore « actif » ne couvre plus le mois. Brouillon, en validation et rejeté ne couvrent jamais. Un avenant ne compte qu'une fois approuvé. |
| **Prestataire actif** | Titulaire (fiche active) d'un contrat de suivi couvrant M. Il est **sélectionnable** pour M partout : plan de suivi, planification, rapports, évaluations. Les autres partenaires actifs de type TPM restent sélectionnables, dans un groupe à part ; les choisir est une modification motivée. |
| **Zone d'un site** | Le **district** suit la règle commune des tableaux de bord (lot 1b, `siteDistrict`), rapportée à l'identifiant du district officiel de même nom dans la région du site. La **commune** est celle de la localité reconnue du site, si elle est dans ce district. Sans district reconnu : « district inconnu », aucun TPM hérité. |
| **Attribution TPM** | **TPM selon contrat** d'une zone pour M : titulaire des contrats de suivi couvrant M dont une zone, liée par identifiant, contient la zone. La zone de contrat la plus précise l'emporte.<br>• Un seul titulaire : « Selon contrat ».<br>• Aucun : « Sans contrat ».<br>• Plusieurs : « À arbitrer », jamais tranché automatiquement.<br>Il est recalculé à chaque lecture, jamais recopié.<br>**TPM retenu** : la modification de la zone pour ce mois (raison obligatoire, journalisée), sinon le TPM selon contrat.<br>**TPM d'une visite** : le TPM retenu de sa commune si elle a une ligne, sinon de son district, au mois de la visite. Il est écrit sur la visite. Une visite prévue suit sa zone ; une visite réalisée ou annulée garde son TPM. S'écarter de la zone demande une raison. (retour 58) |

Ligne à ajouter au tableau des lots, entre 54 et 6a :

| Lot | Contenu | Retours couverts |
|---|---|---|
| **58** | Onglet « Affectation des TPM » (région › district, commune si besoin) :<br>• TPM par défaut calculé depuis les contrats ;<br>• modification par zone × mois avec raison obligatoire, instantané et journal ;<br>• une région en une fois ;<br>• visites qui héritent du TPM de leur zone sur tous les chemins.<br>Fournit la règle « Prestataire actif » au lot 8. | 58, 28.4, 30 (règle) |

---

## 4. Règles pures

### 4.1 `server/src/modules/common/reasonText.js` (nouveau)

Module sans I/O, réutilisable par le retour 56.

`cleanReason(raw, { required = true, min = 10, max = 500 } = {})` :

1. Fusionner les espaces, rogner.
2. Vide :
   - si `required` → `reason_required` ;
   - sinon → `null`.
3. Moins de `min` caractères → `reason_short`.
4. Plus de `max` caractères → `reason_long`.
5. Moins de 5 lettres (`/\p{L}/gu`), **ou** moins de 3 caractères alphanumériques distincts → `reason_meaningless`.
6. Sinon, rendre le texte nettoyé.

Chaque erreur est levée avec `badRequest(message, { code })`. Messages :

| Code | Message |
|---|---|
| `reason_required` | « Indiquez la raison du changement (10 caractères au moins). » |
| `reason_short` | « La raison doit compter 10 caractères au moins. » |
| `reason_long` | « La raison ne doit pas dépasser 500 caractères. » |
| `reason_meaningless` | « La raison doit expliquer le changement : quelques mots suffisent. » |

### 4.2 `server/src/modules/tpm/tpmAttribution.js` (nouveau)

Module sans I/O, sur le modèle de `consolidation.js` et `fieldMath.js`. Toute la logique d'attribution vit ici. Le SQL lit les entrées et applique les résultats.

**Constantes exportées**

```js
const MAX_SPAN_MONTHS = PERIOD_CAPS.facts;   // 24, lot 1b (common/periodCaps)
const MAX_AREAS = 300, MAX_REGIONS = 30, MAX_CELLS = 2400, MAX_VISITS = 500;
const ZONE_STATES = ['contrat', 'modifie', 'aucun_tpm', 'a_arbitrer', 'sans_contrat'];          // cellule de l'onglet
const VISIT_ZONE_STATES = [...ZONE_STATES, 'district_inconnu', 'anterieur'];                    // site_visits.provider_zone_state
const WITH_PROVIDER = ['contrat', 'modifie'];        // provider_id NOT NULL
const VISIT_SOURCES = ['zone', 'visite', 'reprise'];
```

Les CHECK de la migration sont recopiés de ces listes. Un test (§ 12) vérifie leur égalité en lisant le fichier SQL.

**Entrées.** Elles sont chargées par le dépôt et bornées.

```
Contract = { id, numero, status, partnerId|null, partnerName, partnerType, partnerActive,
             dateDebut, dateFin, terminationDate|null, hasMonitoringBudget: boolean,
             zones: [{ adminAreaId|null, depth, path }] }        // adminAreaId null = zone détachée
Area     = { id, depth: 2|3, name, path, regionId, lineage: uuid[] }  // lineage = ancêtres, région d'abord (migration 041)
Override = { id, adminAreaId, month:'AAAA-MM', providerId|null, expectedState, expectedProviderId|null,
             expectedLabel, reason, createdBy, createdByName, updatedAt }
Partner  = { id, name, typeCode, active }
```

`hasMonitoringBudget` est un booléen calculé en SQL : `COALESCE(SUM(unit_count*unit_cost),0) > 0` sur `MONITORING_LINE`. Aucune somme n'est faite en JS.

**Fonctions**

| Fonction | Rôle |
|---|---|
| `contractTpm(c)` | Rend `c.partnerId \|\| null`. **Seul endroit qui dépend de D1** (§ 17). |
| `isMonitoringContract(c)` | Rend `c.hasMonitoringBudget === true`. |
| `contractCoversMonth(c, m)` | Règle du § 3. Mois comparés comme chaînes `AAAA-MM`. Réutilise `consolidation.monthRange` et `contracts.domain.monthsBetween`. |
| `activeProviders({ contracts, partners, month })` | Titulaires actifs couvrant `month`. |
| `selectableProviders({ contracts, partners, months })` | Groupe `contrat` : titulaires de chaque mois, avec leurs contrats. Groupe `tpm` : autres partenaires actifs `typeCode='tpm'`. Dédoublonné, ordre stable (titulaires, puis nom en ordre binaire). Pour chaque prestataire, `months` = les mois où il est sélectionnable. |
| `coverOf(area, zone)` | Rend :<br>• `'detachee'` si `zone.adminAreaId` est null ;<br>• `'exact'` si les ids sont égaux ;<br>• `'ancetre'` si `area.lineage` contient la zone ;<br>• `'descendant'` si la zone est une commune (profondeur 3) sous l'area district ;<br>• `'trop_fine'` pour une zone de profondeur 4 ;<br>• sinon `null`. |
| `defaultFor(area, month, contracts)` | § 4.3. |
| `resolveCell(def, override, partners)` | § 4.4. |
| `buildZoneTable({ areas, months, contracts, overrides, partners })` | Rend `{ cells: Map('areaId\|AAAA-MM' → Cell), counts, quality }`. `quality` contient `detachedContractZones`, `tooFineZones`, `contractsWithoutHolder`, `holdersNotTpm`, `expiredStillActive`, `detachedOverrides`. Taille ≤ (120 districts + communes portées) × 24. |
| `cellForSite({ districtId, communeId }, month, table)` | Cellule de la commune si la commune est une ligne de la table, sinon cellule du district. Sans district : `{ state: 'district_inconnu', providerId: null }`. |
| `segments(cellsOfArea)` | Regroupe les mois consécutifs identiques (même état, TPM, contrat et modification) en `{ from, to, … }`. |
| `stampOf(cells)` | sha1 hexadécimal des lignes `areaId\|mois\|état\|providerId\|overrideUpdatedAt` triées. Sert de verrou optimiste. |
| `planOverrides({ cells, existing, providerId, reason })` | § 4.5. |
| `planRevert({ existing, reason })` | Supprime les modifications visées. Journal `revenir_contrat`. |
| `restampPlan(visits, table)` | Pour chaque visite `{ id, districtId, communeId, month, providerId, zoneState, contractId }`, calcule la cellule. Rend **seulement** les lignes qui changent : `{ id, providerId, zoneState, contractId }`. |
| `visitDecision({ visit, cell, request, selectable })` | § 4.6. |
| `districtAreaFor(official, regionKey, districtAreas)` | Jumelle pure du CTE `sdarea` (§ 5). Rend un id seulement s'il est unique, sinon `null`. |

### 4.3 TPM selon contrat : `defaultFor(area, M, contracts)`

**Étapes**

1. `pool` = contrats de suivi qui couvrent M et dont `contractTpm(c)` n'est pas nul. Un contrat de suivi sans titulaire est remonté dans `quality.contractsWithoutHolder`.
2. `hits` = couples (contrat, zone) avec `coverOf ∈ {exact, ancetre}`. Les zones `detachee` et `trop_fine` sont remontées, jamais utilisées.
3. **Zone la plus précise** : on ne garde que les hits de profondeur de zone maximale. Une commune bat un district, qui bat une région.
4. On regroupe par titulaire.

**Résultat**

| Cas | Résultat |
|---|---|
| Un seul titulaire | `{ state:'contrat', providerId, contractId, zonePath, via:'exact'\|'region' }`. Si ce titulaire a plusieurs contrats sur la zone (mois de chevauchement d'un renouvellement), `contractId` = celui dont `dateDebut` est la plus récente, puis le plus petit `numero` en ordre binaire. |
| Aucun hit | `{ state:'sans_contrat' }`. Drapeau `partiel` si un contrat couvrant M a une zone `descendant`, c'est-à-dire une commune de ce district. Cette commune devient une ligne fille. |
| ≥ 2 titulaires | `{ state:'a_arbitrer', providerId:null, candidates:[{ providerId, providerName, contractId, numero, zonePath }] }`, triés par nom puis numéro. **Aucun choix automatique.** |

### 4.4 Cellule retenue : `resolveCell(def, override, partners)`

| Situation | Cellule |
|---|---|
| Modification liée, avec un TPM | `{ state:'modifie', providerId: o.providerId, contractId, override, default: def }`. `contractId` = celui du candidat choisi si `def.state='a_arbitrer'` et que `o.providerId` est l'un des candidats. Sinon `null`. |
| Modification liée, sans TPM | `{ state:'aucun_tpm', providerId:null, override, default: def }` |
| Pas de modification | La valeur par défaut. |

**Drapeaux**

| Drapeau | Condition |
|---|---|
| `a_confirmer` | `(o.expectedState, o.expectedProviderId)` ≠ `(def.state, def.providerId)` : le contrat a changé depuis la décision. |
| `redondante` | `def.state='contrat'` et `def.providerId === o.providerId`. |
| `partiel` | Voir § 4.3. |
| `titulaire_non_tpm` | Le TPM retenu n'est pas de type `tpm`. |
| `prestataire_inactif` | La fiche du TPM retenu est désactivée. |
| `hors_contrat` | TPM modifié qui n'est titulaire d'aucun contrat de suivi couvrant M. |

**Une modification n'est jamais écrasée ni supprimée par un changement de contrat.** Elle reste appliquée et passe « à confirmer » jusqu'à ce qu'on la confirme avec une nouvelle raison, ou qu'on revienne au contrat.

### 4.5 `planOverrides({ cells, existing, providerId, reason })`

Pour chaque cellule (zone, mois) de la sélection :

| Cas | Effet |
|---|---|
| `def.state='contrat'` et `providerId === def.providerId` | Pas de modification (compteur `sameAsContract`). Une modification existante est **supprimée**, journal `revenir_contrat`. |
| `def.state='sans_contrat'` et `providerId === null` | Rien à modifier (compteur `nothingToChange`). Une modification existante est supprimée, journal `revenir_contrat`. |
| Modification existante, même TPM | Mise à jour de la raison et de l'instantané. Journal `confirmer` si elle était `a_confirmer`, sinon `modifier`. |
| Modification existante, autre TPM | Mise à jour du TPM, de la raison et de l'instantané. Journal `modifier` (ancien → nouveau). |
| Pas de modification | Insertion avec l'instantané (`expected_state`, `expected_provider_id`, `expected_label` comme « CTR-2026-0001 · ASSOCIATION AINA · Androy > Beloha »). Journal `modifier`. |

- Retour : `{ upserts, deletes, unchanged, log, counts }`.
- La raison est **obligatoire** dès qu'il y a au moins un upsert. Elle est facultative si la sélection ne fait que revenir au contrat.

### 4.6 Décision pour une visite : `visitDecision`

`request` est l'un de :
- `{ action:'zone' }`
- `{ action:'set', providerId|null, reason }`
- `{ action:'keep', reason }`

| Demande | Résultat |
|---|---|
| `zone`, ou `set` avec `providerId === cell.providerId` alors que `cell.state ∉ {a_arbitrer, district_inconnu}` | `{ source:'zone', zoneState:null }` : la visite sera estampillée par `restampVisitsTx`. Aucune raison demandée. |
| `set` avec une autre valeur, y compris `null` (désaffecter) ou un choix sur une zone sans TPM | Raison obligatoire. Résultat `{ source:'visite', providerId, reason }`. Le TPM doit être sélectionnable au mois de la visite, sinon 400 `provider_not_selectable`. |
| `keep`, pour une visite `reprise` | `{ source:'visite', providerId: visit.providerId, reason }`, raison obligatoire. |

**Visites réalisées.** Une visite réalisée peut être corrigée à la main de la même façon (raison obligatoire). Elle n'est jamais recalculée automatiquement.

### 4.7 Ce que la règle ne fait pas

- **Pas d'attribution par activité.** Les vocabulaires des contrats et des sites ne se recoupent pas ; il faut d'abord le référentiel du lot 2.
- **Pas de rapprochement par nom** entre une zone de contrat et un site.
- **Pas de capacité par TPM.**

---

## 5. District et commune d'un site (une seule règle avec le lot 1b)

On réutilise `siteDistrictCtes()` de `common/siteActivitySql.js` (branche `wip/fix-1b`) **sans le modifier**, car ce fichier est partagé par 1b, 6a et 7a. Le lot 58 y ajoute, dans son propre dépôt, deux CTE :

```sql
sdcand AS (SELECT sd.site_id, d.id AS district_id
             FROM sdist sd
             JOIN sites s       ON s.tenant_id = $1 AND s.id = sd.site_id
             JOIN admin_areas d ON d.tenant_id = $1 AND d.depth = 2 AND d.name = sd.official
             JOIN admin_areas r ON r.tenant_id = $1 AND r.id = d.lineage[1]
            WHERE ${keySql('s.adm1')} IN ('', ${keySql('r.name')})),
sdarea AS MATERIALIZED (SELECT site_id, CASE WHEN count(*) = 1 THEN min(district_id::text)::uuid END AS district_id
                          FROM sdcand GROUP BY site_id)
```

**Commune**

```sql
CASE WHEN a.depth = 3 AND a.lineage[2] = sa.district_id THEN a.id
     WHEN a.depth = 4 AND a.lineage[2] = sa.district_id THEN a.lineage[3] END
```

avec `a = admin_areas` de `sites.admin_area_id`. Sinon la commune est inconnue et c'est la ligne du district qui s'applique.

**Règles**

- Un site absent de `sdarea`, ou dont `district_id` est NULL, est en état `district_inconnu`. Il n'hérite d'aucun TPM et n'est jamais rattaché par devinette au TPM d'une région.
- **Parité.** `districtAreaFor` (pur) et `sdarea` (SQL) sont vérifiés par un cas ajouté au banc du lot 1b (`perfPeriod.js`).
- **Mesure en dev** : 1 272 sites ont un district unique, 8 sont inconnus, 0 sont ambigus.
- Les 324 sites dont le code de lieu contredit le district déclaré suivent le district déclaré, comme les tableaux de bord. L'onglet les **compte** dans une tuile informative, avec un lien vers Paramétrage › Localités › À rapprocher. Ils ne sont **pas** bloqués : c'est la règle décidée au lot 1b, qu'on ne rediscute pas ici.

---

## 6. Migration `server/src/db/migrations/070_tpm_zone_attribution.sql`

### 6.0 Choix du numéro

| Numéro | Occupé par |
|---|---|
| 061 | `wip/fix-6a` (`061_map_geo`) |
| 062–064 | Réservés au lot 7a |
| 065–068 | Réservés au lot 5 |
| 069 | Suppressions (retour 56) |

**070** est donc le premier libre. Il faut l'inscrire dans la liste de réservation (`ETAT_DU_PROJET.md` et le journal).

- Le lanceur applique, dans l'ordre des noms, tout fichier absent de `schema_migrations`.
- Sur une base neuve, 070 passe **après** 065–068 : les migrations du lot 5 **ne doivent pas référencer** ces tables. Le lot 5 les lit à l'exécution.
- L'index conditionnel « 065 » de `SPEC_LOT_1B` chevauche la plage du lot 5 : à signaler.

### 6.1 Modifications par zone × mois

```sql
CREATE TABLE IF NOT EXISTS tpm_zone_overrides (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  admin_area_id        uuid REFERENCES admin_areas(id) ON DELETE SET NULL,   -- NULL = détachée par un réimport : sans effet, signalée
  area_path            text NOT NULL,                                        -- lu dans admin_areas par le serveur, jamais du client
  area_depth           smallint NOT NULL CHECK (area_depth IN (2, 3)),      -- district ou commune
  period_month         date NOT NULL CHECK (extract(day FROM period_month) = 1),
  provider_id          uuid REFERENCES partners(id) ON DELETE RESTRICT,      -- NULL = « aucun TPM » décidé
  expected_state       text NOT NULL CHECK (expected_state IN ('contrat', 'sans_contrat', 'a_arbitrer')),
  expected_provider_id uuid REFERENCES partners(id) ON DELETE RESTRICT,
  expected_label       text,
  reason               text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 10 AND 500),
  batch_id             uuid NOT NULL,
  created_by           uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_by           uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tpm_zone_overrides_expected_ck CHECK ((expected_state = 'contrat') = (expected_provider_id IS NOT NULL)),
  -- une modification DIFFÈRE de ce que disait le contrat au moment de la décision :
  CONSTRAINT tpm_zone_overrides_differs_ck  CHECK (expected_state <> 'contrat' OR provider_id IS DISTINCT FROM expected_provider_id),
  -- « aucun TPM » là où aucun contrat ne couvre n'est pas une modification :
  CONSTRAINT tpm_zone_overrides_useful_ck   CHECK (expected_state <> 'sans_contrat' OR provider_id IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_tpm_zone_override
  ON tpm_zone_overrides (tenant_id, admin_area_id, period_month) WHERE admin_area_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tpm_zone_override_month ON tpm_zone_overrides (tenant_id, period_month);
ALTER TABLE tpm_zone_overrides ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tpm_zone_overrides
  USING (tenant_id::text = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));
GRANT SELECT, INSERT, UPDATE, DELETE ON tpm_zone_overrides TO mems2_app;
```

Des lignes **mensuelles** plutôt que des plages : un `UNIQUE` simple suffit comme garde-fou, sans `btree_gist` ni logique de chevauchement. C'est le même modèle que `site_visits.period_month`. Le volume reste inférieur à 3 000 lignes par compte.

### 6.2 Journal inaltérable

```sql
CREATE TABLE IF NOT EXISTS tpm_attribution_log (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  batch_id          uuid NOT NULL,
  scope             text NOT NULL CHECK (scope IN ('lot', 'zone', 'visite')),
  action            text NOT NULL CHECK (action IN ('modifier', 'confirmer', 'revenir_contrat', 'reappliquer',
                                                    'visite_modifier', 'visite_garder', 'visite_zone')),
  label             text NOT NULL CHECK (char_length(label) BETWEEN 1 AND 300),  -- « Région Androy (4 districts) · oct.–déc. 2026 », « Androy > Beloha », « MDG-0421 · 2026-10 »
  admin_area_id     uuid, period_month date, visit_id uuid,                        -- instantanés, sans clé étrangère
  month_from        date, month_to date,
  old_state         text, old_provider_id uuid, old_provider_name text,
  new_state         text, new_provider_id uuid, new_provider_name text,
  contract_label    text,                                                          -- ce que disait le contrat à ce moment
  zones_changed     integer CHECK (zones_changed >= 0),
  visits_updated    integer CHECK (visits_updated >= 0),
  reason            text CHECK (reason IS NULL OR char_length(btrim(reason)) BETWEEN 10 AND 500),
  changed_by        uuid, changed_by_name text,
  changed_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tpm_log_reason_ck CHECK (action IN ('revenir_contrat', 'reappliquer', 'visite_zone') OR reason IS NOT NULL),
  CONSTRAINT tpm_log_lot_ck    CHECK (scope <> 'lot'    OR (month_from IS NOT NULL AND month_to IS NOT NULL AND month_to >= month_from)),
  CONSTRAINT tpm_log_zone_ck   CHECK (scope <> 'zone'   OR period_month IS NOT NULL),
  CONSTRAINT tpm_log_visit_ck  CHECK (scope <> 'visite' OR visit_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_tpm_log_when  ON tpm_attribution_log (tenant_id, changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_tpm_log_batch ON tpm_attribution_log (tenant_id, batch_id);
CREATE INDEX IF NOT EXISTS idx_tpm_log_zone  ON tpm_attribution_log (tenant_id, admin_area_id, period_month) WHERE scope = 'zone';
CREATE INDEX IF NOT EXISTS idx_tpm_log_visit ON tpm_attribution_log (tenant_id, visit_id) WHERE visit_id IS NOT NULL;
ALTER TABLE tpm_attribution_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tpm_attribution_log
  USING (tenant_id::text = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));
GRANT SELECT, INSERT ON tpm_attribution_log TO mems2_app;
REVOKE UPDATE, DELETE, TRUNCATE ON tpm_attribution_log FROM mems2_app;   -- annule ALTER DEFAULT PRIVILEGES (002, 012)
```

### 6.3 Origine du TPM d'une visite, et reprise de l'existant

```sql
ALTER TABLE site_visits
  ADD COLUMN IF NOT EXISTS provider_source     text NOT NULL DEFAULT 'zone',
  ADD COLUMN IF NOT EXISTS provider_zone_state text,          -- NULL = à estampiller (nouvelle visite, re-planifiée…)
  ADD COLUMN IF NOT EXISTS provider_reason     text,
  ADD COLUMN IF NOT EXISTS provider_set_by     uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS provider_set_at     timestamptz;

-- 1) Visites qui portent déjà un TPM : rien n'est perdu, rien n'est réécrit en silence.
UPDATE site_visits SET provider_source = 'reprise',
       provider_reason = 'Reprise : TPM saisi avant l''affectation par zone (retour 58).', provider_set_at = now()
 WHERE provider_id IS NOT NULL;
-- 2) Sans TPM, réalisées, annulées ou d'un mois passé : figées telles quelles.
UPDATE site_visits SET provider_zone_state = 'anterieur'
 WHERE provider_id IS NULL AND (status <> 'planifie' OR period_month < date_trunc('month', now())::date);
-- 3) Sans TPM, prévues pour le mois courant ou après : restent à estampiller (réparation r5_tpm_selon_zone au démarrage).

ALTER TABLE site_visits
  ADD CONSTRAINT site_visits_provider_source_ck CHECK (provider_source IN ('zone', 'visite', 'reprise')),
  ADD CONSTRAINT site_visits_zone_state_ck CHECK (provider_zone_state IS NULL OR provider_zone_state IN
      ('contrat', 'modifie', 'aucun_tpm', 'a_arbitrer', 'sans_contrat', 'district_inconnu', 'anterieur')),
  ADD CONSTRAINT site_visits_zone_shape_ck CHECK (CASE
      WHEN provider_source = 'zone' THEN provider_reason IS NULL
           AND (provider_zone_state IS NULL
                OR (provider_zone_state IN ('contrat', 'modifie')) = (provider_id IS NOT NULL))
      ELSE provider_zone_state IS NULL AND char_length(btrim(COALESCE(provider_reason, ''))) BETWEEN 10 AND 500 END),
  ADD CONSTRAINT site_visits_contract_derived_ck CHECK (contract_id IS NULL OR provider_source = 'reprise'
      OR (provider_source = 'zone' AND provider_zone_state IN ('contrat', 'modifie')));

CREATE INDEX IF NOT EXISTS idx_site_visits_tpm_zone ON site_visits (tenant_id, period_month)
  WHERE status = 'planifie' AND provider_source = 'zone';
CREATE INDEX IF NOT EXISTS idx_site_visits_tpm_pending ON site_visits (tenant_id)
  WHERE provider_source = 'zone' AND provider_zone_state IS NULL;
```

### 6.4 Filet de sécurité : aucune transaction ne laisse une visite non estampillée

```sql
CREATE OR REPLACE FUNCTION mems_site_visit_tpm_stamped() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM site_visits v WHERE v.id = NEW.id
              AND v.provider_source = 'zone' AND v.provider_zone_state IS NULL) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'Visite sans TPM estampillé : toute écriture de visites finit par restampVisitsTx (retour 58).';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER trg_site_visits_tpm_stamped
  AFTER INSERT OR UPDATE ON site_visits DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW WHEN (NEW.provider_source = 'zone' AND NEW.provider_zone_state IS NULL)
  EXECUTE FUNCTION mems_site_visit_tpm_stamped();
```

- **Quand il agit.** Seules les lignes laissées « à estampiller » déclenchent un contrôle, au COMMIT. Une ligne estampillée dans la même transaction passe.
- **Si on l'oublie.** Un écrivain sans `restampVisitsTx` échoue en 500, sans fuite d'information. Le test de garde du § 12 l'attrape avant.
- **Pourquoi il est créé à la fin.** Les lignes de l'étape 3 de la reprise ne le déclenchent pas.

### 6.5 Références et cache

```sql
SELECT mems_install_same_tenant('tpm_zone_overrides');
SELECT mems_install_same_tenant('site_visits');   -- régénère son déclencheur : provider_set_by s'ajoute aux contrôles
DO $$ BEGIN
  IF to_regprocedure('mems_data_changed()') IS NOT NULL THEN   -- lot 7a (064) déjà passé
    EXECUTE 'CREATE TRIGGER trg_data_changed AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON tpm_zone_overrides
             FOR EACH STATEMENT EXECUTE FUNCTION mems_data_changed(''visits'')';
  END IF;
END $$;
```

- **Coordination avec le lot 7a.** S'il est publié **après** le lot 58, sa migration 064 ajoute `tpm_zone_overrides → 'visits'` à sa liste fixe, avec une garde `to_regclass`.
- **Journal sans clé étrangère.** Il ne contient que des instantanés, donc aucun `mems_install_same_tenant` pour lui.

### 6.6 Ce que la base garantit seule

| Garantie | Mécanisme |
|---|---|
| Pas de modification sans raison de 10 caractères au moins. | CHECK sur `reason`. |
| Pas de modification qui répète le contrat du moment. | `differs_ck`, avec un instantané calculé par le serveur. |
| Pas de « aucun TPM » là où rien n'est couvert. | `useful_ck`. |
| Une seule modification par zone × mois. | Index unique partiel. |
| Visite « selon contrat » ou « modifié » ⇒ un TPM ; « à affecter » ⇒ aucun TPM. | `site_visits_zone_shape_ck`. |
| Visite `visite` ou `reprise` ⇒ une raison. | `site_visits_zone_shape_ck`. |
| `contract_id` jamais posé à la main sur une visite dérivée. | `site_visits_contract_derived_ck`. |
| Aucune visite laissée « à estampiller » au COMMIT. | Déclencheur différé du § 6.4. |
| Journal non modifiable par l'application. | REVOKE. |
| Un prestataire référencé ne se supprime pas (il se désactive). | `ON DELETE RESTRICT`. |

À noter : sur `site_visits`, l'ancien `ON DELETE SET NULL` de `provider_id` combiné au CHECK fait **échouer** une suppression brutale de partenaire (23514 → 400), au lieu de corrompre la visite.

---

## 7. Re-dérivation, invariants, verrous

### 7.1 Invariants

| # | Invariant |
|---|---|
| I1 | Toute visite `provider_source='zone'` qui est « à estampiller », ou `planifie` avec un mois ≥ mois courant, vérifie `(provider_id, provider_zone_state, contract_id) = cellForSite(site, mois)` à la fin de chaque transaction. La règle de santé `tpm_attribution_derive` doit valoir 0. |
| I2 | Une visite `realise` ou `annule` déjà estampillée, une visite `visite` ou `reprise`, et une visite `anterieur` hors « Réappliquer » ne sont **jamais** recalculées automatiquement. |
| I3 | Toute décision humaine écrit son journal **dans la même transaction**. Cela couvre : modifier, confirmer, revenir au contrat, réappliquer, et tout changement d'une visite. |

### 7.2 `restampVisitsTx(client, tenantId, scope = {}, { dryRun = false, simulate = null } = {})`

Fonction du dépôt `tpmAttribution.repository.js`.

**Portées.** Elles incluent **toujours** les visites « à estampiller » (`provider_source='zone' AND provider_zone_state IS NULL`, quels que soient le statut et le mois). Elles ajoutent ensuite :

| Portée | Ajoute | Appelée par |
|---|---|---|
| `{}` | rien de plus | écrivains de visites (§ 9), réparation r5 |
| `{ fromMonth }` | les visites `zone` + `planifie` de mois ≥ `fromMonth` | contrats (approbation, avenant approuvé, résiliation), fin de `applySitesGeoTx`, santé (`dryRun`) |
| `{ areaIds, months }` | les visites `zone` + `planifie` dont le district **ou** la commune est dans `areaIds`, pour ces mois (passés compris) | écriture ou retour d'une modification de zone |
| `{ from, to }` | les visites `zone` + `planifie` de la plage, y compris les `anterieur` | bouton « Réappliquer aux visites prévues » |

**Déroulé**

1. **Verrou d'attribution** : `SET LOCAL lock_timeout = '20s'`, puis `SELECT pg_advisory_xact_lock(hashtext('tpm-attribution:' || $1))`, puis `SET LOCAL lock_timeout = DEFAULT`.
   - Un 55P03 donne 503 « réessayez », déjà géré par `middleware/errors.js`.
   - Le verrou est réentrant dans la même transaction.
   - En `dryRun`, le verrou n'est pas pris.
2. **Lecture des visites concernées**, une requête. CTE `siteDistrictCtes()` + `sdcand` + `sdarea` (§ 5), puis :
   ```sql
   SELECT v.id, to_char(v.period_month,'YYYY-MM') AS month, v.provider_id, v.provider_zone_state, v.contract_id,
          sa.district_id, <commune_id du § 5>
     FROM site_visits v JOIN sites s ON s.tenant_id = $1 AND s.id = v.site_id
     LEFT JOIN sdarea sa ON sa.site_id = v.site_id
     LEFT JOIN admin_areas a ON a.tenant_id = $1 AND a.id = s.admin_area_id
    WHERE v.tenant_id = $1 AND v.provider_source = 'zone'
      AND (v.provider_zone_state IS NULL OR (v.status = 'planifie' AND <portée>))
   FOR UPDATE OF v      -- omis en dryRun
   ```
3. **Chargement des entrées** (`loadInputsTx`) pour les mois et les aires rencontrés : contrats `actif` ou `resilie` qui chevauchent ces mois, avec leurs zones ; modifications liées de ces mois ; aires (id, profondeur, lignée) ; prestataires. Les requêtes s'enchaînent sur le même client avec `await`, **jamais** avec `Promise.all`.
4. **Calcul pur.**
   - `buildZoneTable(...)`. Si `simulate` est fourni (aperçu), on applique d'abord en mémoire ses `upserts` et `deletes` aux modifications.
   - Puis `restampPlan(visits, table)`.
5. **Écriture** : **une seule** instruction.
   ```sql
   UPDATE site_visits v SET provider_id = u.provider_id, provider_zone_state = u.zone_state,
          contract_id = u.contract_id, updated_at = now()
     FROM unnest($2::uuid[], $3::uuid[], $4::text[], $5::uuid[]) AS u(id, provider_id, zone_state, contract_id)
    WHERE v.tenant_id = $1 AND v.id = u.id
   ```
   En `dryRun`, on n'écrit pas et on rend les comptes.

**Résultat** : `{ changed, byState: { contrat, modifie, aucun_tpm, a_arbitrer, sans_contrat, district_inconnu }, moves: [{ fromProviderId, toProviderId, visits, datedVisits }] }`. `moves` sert à l'aperçu des jours de collecte.

**Propriétés**

- **Idempotent.** `restampPlan` ne rend que les lignes qui changent : un deuxième appel n'écrit rien.
- **Déterministe.** La couverture se juge au **mois de la visite**. Le temps qui passe ne change donc rien par lui-même : un contrat qui arrive à échéance ne modifie pas une visite déjà estampillée de son dernier mois.
- **Performance visée.** Moins de 300 ms pour 5 000 sites × 12 mois de visites prévues (`siteDistrictCtes` est déjà mesuré à environ 0,3 s sur 24 mois). À mesurer avec un cas ajouté à `perfPeriod.js`.

### 7.3 Ordre des verrous (aucun interblocage)

Partout, dans cet ordre :

1. verrou des rattachements (`withSubmissionLinks` ou `lockSubmissionLinksTx`, s'il est pris) ;
2. verrou `rbm-generate` (génération) ;
3. ligne de contrat `FOR UPDATE` (`loadForUpdate`) ;
4. **verrou `tpm-attribution`, toujours en dernier** ;
5. lignes `tpm_zone_overrides` et `site_visits` `FOR UPDATE`.

Conséquences :

- **Écritures de modifications et de visites (onglet, fenêtre).** Elles prennent le verrou d'attribution **avant toute lecture**. En READ COMMITTED, chaque instruction lancée après l'obtention du verrou voit ce qui a été validé avant. Elles ne prennent ni le verrou des rattachements, ni de ligne de contrat.
- **`replaceBreakdown`** (constat nouveau). Il appelle `lockAttributionTx` **avant** de mettre à jour ou de rattacher les `tpm_zone_overrides`. Sinon il tiendrait les lignes de modifications puis attendrait le verrou d'attribution, pendant qu'une écriture de modification tiendrait le verrou et attendrait ces lignes.
- **Contrats.** `decide`, `decideAmendment` et `terminate` tiennent la ligne du contrat, puis prennent le verrou d'attribution dans `restampVisitsTx`. L'ordre est respecté.

---

## 8. Serveur

**Couches** : routes (zod) → contrôleur → service (règles, transaction) → dépôt (seul à écrire le SQL).

- Chaque requête filtre `tenant_id = $1` et s'exécute dans `withTenantTransaction`. Le tenant vient de `req.auth`, jamais du corps.
- Les écritures du lot ne touchent ni sites, ni partenaires, ni soumissions, ni bureaux : **`withTenantTransaction` suffit**.
- Les chemins déjà enveloppés dans `withSubmissionLinks` appellent les fonctions `…Tx` avec leur propre client.

### 8.1 Nouveaux fichiers

| Fichier | Contenu |
|---|---|
| `server/src/modules/common/reasonText.js` | § 4.1 |
| `server/src/modules/tpm/tpmAttribution.js` | § 4.2 à 4.7 |
| `server/src/modules/tpm/tpmAttribution.repository.js` | Ne requiert ni `field.repository` ni `placeMatch.repository` (pas de cycle). Requiert `common/siteActivitySql` (`siteDistrictCtes`, `keySql`). Fonctions ci-dessous. |
| `server/src/modules/tpm/tpmAttribution.service.js` | Règles et transactions. Fonctions ci-dessous. |
| `server/src/modules/tpm/tpmAttribution.controller.js` | Traduction HTTP ↔ service. |
| `server/src/modules/tpm/tpmAttribution.routes.js` | Validation zod. Lecture : utilisateur connecté. Écriture : `requireRole('admin', 'manager')`, comme `field.routes`. |

**Fonctions du dépôt `tpmAttribution.repository.js`**

| Fonction | Rôle |
|---|---|
| `lockAttributionTx(client, tenantId)` | Verrou du § 7.2, étape 1. |
| `loadInputsTx(client, tenantId, { months, areaIds })` | Entrées du § 7.2, étape 3. |
| `zoneRowsTx(client, tenantId, { from, to, regionId, all })` | Lignes de l'onglet : districts qui ont au moins un site (`sdarea`), districts couverts sur la période par une zone de contrat liée (un district sous une zone de région n'est listé que s'il a des sites ou si `all`), aires des modifications ; communes portées (zone de contrat de profondeur 3 ou modification) ; régions en en-tête. **Comptes en SQL** (GROUP BY) : sites du registre par district ou commune, et visites par (zone, mois, statut, `provider_id`, `provider_source`). |
| `expandRegionsTx` | Développe des régions en leurs districts. |
| `assertAreasTx` | Contrôle des aires : profondeur 2 ou 3, appartenance au tenant ; rend chemin et profondeur. |
| `existingOverridesForUpdateTx(areaIds, months)` | `SELECT … FOR UPDATE`, une requête. |
| `upsertOverridesTx` | Un seul `INSERT … SELECT … FROM unnest(...) JOIN admin_areas a ON a.tenant_id = $1 AND a.id = u.area_id AND a.depth IN (2,3) ON CONFLICT (tenant_id, admin_area_id, period_month) WHERE admin_area_id IS NOT NULL DO UPDATE SET provider_id, expected_*, reason, batch_id, updated_by, updated_at`. Chemin et profondeur viennent **de la base**. |
| `deleteOverridesTx` | Un `DELETE … WHERE tenant_id = $1 AND id = ANY($2)`. |
| `insertLogTx` | Un `INSERT … SELECT FROM unnest(...)`. Noms des prestataires et de l'auteur résolus en SQL dans la même instruction. |
| `restampVisitsTx` | § 7.2. |
| `resolveSitesTx(client, tenantId, [{ siteId, month }])` | Lecture seule, même CTE et même table. Sert au formulaire de visite et à l'aperçu du lot 5. |
| `applyVisitRequestTx(client, tenantId, actorId, visitIds, request)` | `FOR UPDATE` des visites (≤ 500), cellules par `resolveSitesTx`, `visitDecision`, un UPDATE via `unnest`, journal `lot` + `visite`, puis `restampVisitsTx({})` pour les visites rendues à la zone. |
| `listLogTx(client, tenantId, { batchId, areaId, visitId, from, to, action, limit ≤ 500, offset })` | Journal paginé. |
| `healthCountsTx` | Compteurs pour la santé, dont `derive = restampVisitsTx({ fromMonth: courant }, { dryRun: true }).changed`. |

**Fonctions du service `tpmAttribution.service.js`**

| Fonction | Rôle |
|---|---|
| `getTable(tenantId, { from, to, regionId, all })` | Une transaction de lecture. `zoneRowsTx`, `loadInputsTx`, `buildZoneTable`, `segments`, `selectableProviders`, puis mise en forme. Rend les lignes, segments, comptes, `quality` et l'empreinte par ligne. |
| `providers(tenantId, { from, to })` | « Prestataire actif » et « sélectionnable ». |
| `resolve(tenantId, { siteId, month })` | Rend `{ providerId, providerName, state, contract, override, candidates, selectable }`. |
| `preview(tenantId, target)` | Mêmes étapes que `setOverrides` (a–g ci-dessous), **sans verrou ni écriture**. `restampVisitsTx(scope, { dryRun: true, simulate: plan })`. Rend `{ stamp, counts, visits: { changed, byState, moves }, warnings }`. Les avertissements couvrent, par exemple, un mois dont le plan est « validé » ou un TPM hors contrat. |
| `setOverrides(tenantId, actor, { target, providerId, reason, stamp })` | Déroulé ci-dessous. |
| `revert(tenantId, actor, { target, reason?, stamp })` | Même schéma avec `planRevert`. |
| `reapply(tenantId, actor, { from, to })` | `restampVisitsTx({ from, to })` + journal `lot` action `reappliquer`. |
| `setVisitsProvider(tenantId, actor, { visitIds, action, providerId, reason })` | Délègue à `applyVisitRequestTx`. |
| `listLog(tenantId, filters)` | Journal. |

**Déroulé de `setOverrides`**, tout dans **une** transaction :

- a. `cleanReason` (obligatoire) ;
- b. `lockAttributionTx` ;
- c. `expandRegionsTx`, puis `assertAreasTx`. Si plus de 2 400 cellules : 400 `too_many_cells` ;
- d. `loadInputsTx`, puis `buildZoneTable` sur la sélection, puis `stampOf`. Si l'empreinte diffère de `stamp` : **409** « L'affectation a changé entre-temps : rechargez. » ;
- e. si `providerId` n'est pas null, il doit être sélectionnable **pour chaque mois** de la plage, sinon 400 `provider_not_selectable` avec la liste des mois ;
- f. `existingOverridesForUpdateTx` ;
- g. `planOverrides`. Si rien ne change, retourner `{ unchanged }` sans écrire ;
- h. `deleteOverridesTx`, puis `upsertOverridesTx` ;
- i. `restampVisitsTx({ areaIds, months })` ;
- j. `insertLogTx` : une ligne `lot` (libellé, période, `zones_changed`, `visits_updated`, raison) et une ligne `zone` par cellule ;
- k. COMMIT.

Retour : `{ batchId, created, updated, deleted, sameAsContract, nothingToChange, visits: { changed, byState } }`.

### 8.2 API

Montage dans `server/src/app.js` : `app.use('/api/tpm/attribution', tpmAttributionRoutes)`, **avant** `app.use('/api/tpm', tpmRoutes)`. C'est un ajout d'une ligne, comme ceux de 6a et 56.

```js
const month  = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const target = z.object({
  areaIds:   z.array(z.string().uuid()).max(300).default([]),
  regionIds: z.array(z.string().uuid()).max(30).default([]),
  from: month, to: month,
}).refine((b) => b.areaIds.length + b.regionIds.length > 0, { message: 'Choisissez au moins une zone.' });
// plage : readPeriod(…, { maxSpan: PERIOD_CAPS.facts }) du lot 1b (middleware/period.js) → period_format / order / span
const reason = z.string().max(2000);   // nettoyé et borné 10..500 par cleanReason (service)
```

| Méthode et chemin | Entrée | Rôle |
|---|---|---|
| `GET /api/tpm/attribution` | `?from&to&regionId&all` (≤ 24 mois) | Table des zones. |
| `GET /api/tpm/attribution/providers` | `?from&to` | Prestataires actifs et sélectionnables, par groupe, avec leurs mois et contrats. |
| `GET /api/tpm/attribution/resolve` | `?siteId&month` | TPM d'un site pour un mois. |
| `GET /api/tpm/attribution/log` | `?batchId&areaId&visitId&from&to&action&limit&offset` | Journal. |
| `POST /api/tpm/attribution/preview` | `target + { mode: 'modifier'\|'revenir', providerId?: uuid\|null }` | Aperçu, sans écriture. |
| `PUT /api/tpm/attribution/overrides` | `target + { providerId: uuid\|null, reason, stamp: string(≤64) }` | Enregistrer une modification. |
| `POST /api/tpm/attribution/revert` | `target + { reason?: string, stamp }` | Revenir au contrat. |
| `POST /api/tpm/attribution/apply` | `{ from, to }` | « Réappliquer aux visites prévues ». |
| `POST /api/tpm/attribution/visits` | `{ visitIds: uuid[1..500], action: 'zone'\|'set'\|'keep', providerId?: uuid\|null, reason? }` | Changer le TPM de visites. |

Les deux routes de visites existantes changent ainsi :

| Route | Changement |
|---|---|
| `POST /api/tpm/field/visits` | `contractId` **retiré** (zod ignore les clés inconnues : un ancien client ne casse pas). Nouveau `providerReason`. |
| `PATCH /api/tpm/field/visits/:id` | `contractId` retiré. Nouveaux `providerReason?` et `followZone?: true` (exclusif avec `providerId`). La route passe désormais `uid(req)`. |

**Codes d'erreur** : 400 avec `details.code` parmi :
- `reason_required`, `reason_short`, `reason_long`, `reason_meaningless` ;
- `period_format`, `period_order`, `period_span` ;
- `too_many_cells` ;
- `provider_not_selectable` ;
- `area_depth`.

Puis 409 en cas d'empreinte changée, 503 en cas de verrou.

### 8.3 Fichiers existants modifiés (ajouts localisés)

**`server/src/modules/tpm/field.repository.js`**

- **`createVisit`**
  - Retirer `contract_id` et `provider_id` de l'INSERT : la visite démarre en `zone`, à estampiller.
  - Si `providerId` (ou `null` explicite) est fourni : `applyVisitRequestTx(..., { action: 'set', providerId, reason: providerReason })`.
  - Puis `restampVisitsTx({})`.
- **`updateVisit`**
  - Le TPM ne s'écrit plus par l'UPDATE : `providerId` ou `followZone` passent par `applyVisitRequestTx`.
  - Si `status` devient `planifie`, ajouter `provider_zone_state = CASE WHEN provider_source = 'zone' THEN NULL ELSE provider_zone_state END`.
  - Puis `restampVisitsTx({})`.
  - `assertVisitRefs` ne contrôle plus `contractId`.
- **`planMonthsTx`** (l. ~920) : l'`ON CONFLICT … DO UPDATE SET status = 'planifie', updated_at = now()` reçoit en plus `provider_zone_state = NULL`. Pour une visite `visite` ou `reprise`, la valeur est déjà NULL et la visite est conservée. Pour une visite `zone`, elle est recalculée.
- **`generateFromRbmTx`, `planMonthsTx`, `importPlanning`, `importLocations` (validation), `importPlanSites`** : `const tpm = await restampVisitsTx(client, tenantId)` **juste avant le `return`**. Le résultat gagne `tpm: { byState }`. Les INSERT ne changent pas.
- **`generateFromRbmTx`** : à rebaser sur `wip/fix-1b` (`asOf`, l. ~402).
- **Lecteurs**
  - `listVisits` : ajoute `providerSource`, `providerZoneState`, `providerReason`. À faire **après** la publication du lot 1b, qui réécrit cette fonction.
  - `planBoardTx` : ajoute `districtAreaId` et `communeAreaId` par site, et `'src', v.provider_source` dans le JSON des mois.
  - Le service du Plan de suivi y joint `tpmByArea` (segments de l'année par zone, avec `buildZoneTable` sur ≤ 120 × 12 cellules).

**`server/src/modules/settings/placeMatch.repository.js`**
- En fin de `applySitesGeoTx`, avant le `return` (l. ~134) :
  ```js
  const tpm = await require('../tpm/tpmAttribution.repository').restampVisitsTx(client, tenantId, { fromMonth: currentMonth() });
  ```
  Le `require` est paresseux, pour éviter tout cycle.
- C'est sans condition (§ 1, n° 18). Fichier aussi modifié par fix-1b (6 lignes) : l'ajout est d'une ligne, ailleurs.

**`server/src/modules/settings/localities.repository.js`**
- Dans `replaceBreakdown`, juste après le bloc « Zones de contrat » (l. ~203-215) :
  - `lockAttributionTx` ;
  - même rafraîchissement `path` / `depth` pour `tpm_zone_overrides` ;
  - rattachement des modifications détachées par `relinkByPath`. En cas de collision `UNIQUE` (zone, mois), la modification vivante est gardée et l'ancienne reste détachée et comptée.
- Le résultat gagne `tpmOverridesRelinked` et `tpmOverridesStillDetached`.
- `deleteArea` rend aussi `tpmOverridesDetached`.
- Le restamp suit par `applySitesGeoTx`.

**`server/src/modules/contracts/contracts.service.js`**
- Dans `decide` (si `approve`), `decideAmendment` (si `approve`) et `terminate` : `await restampVisitsTx(client, tenantId, { fromMonth: monthOf(today()) })`, juste avant la fin de la transaction.
- **`renew`** : copier les zones liées du contrat source dans le nouveau brouillon :
  ```js
  await repo.replaceAreas(client, tenantId, newId, await revalidateAreas(client, tenantId, sourceAreas))
  ```
  Aujourd'hui, un renouvellement perd toutes ses zones, donc tous les TPM par défaut.
- Ajouts courts, dans des fonctions **que ne touchent ni 56 (`deleteDraft`, `allowedActions`) ni 7a (ajouts en fin de fichier)**.

**`server/src/db/dataRepairs.js`** : ajouter en fin de tableau
```js
{ key: 'r5_tpm_selon_zone', run: (client, t) => require('../modules/tpm/tpmAttribution.repository').restampVisitsTx(client, t) }
```
Il estampille les visites prévues, laissées « à estampiller » par la migration. Il est idempotent.

**`server/src/db/seed.js`** (l. ~300) **et `seed-test.js`** (l. ~108, ~275)
- Ne plus insérer de `provider_id`.
- Appeler `restampVisitsTx` en fin de transaction.
- Pour montrer une exception dans `seed-test.js`, l'insérer en `provider_source='visite'` avec une raison explicite de démonstration.
- Faute de quoi, le déclencheur du § 6.4 refuse le seed.

**`server/src/modules/settings/healthRules.js` + `health.repository.js`** : nouvelles règles, en ajout seulement (fichier aussi modifié par 7a).

| Règle | Niveau |
|---|---|
| `tpm_conflits` | à compléter |
| `tpm_modifications_a_confirmer` | — |
| `tpm_visites_a_regulariser` | visites `reprise` prévues |
| `tpm_titulaire_non_tpm` | tant que D1 n'est pas tranchée |
| `tpm_modifications_detachees` | — |
| `tpm_attribution_derive` | doit valoir 0, sinon « à corriger » avec bouton « Recalculer » vers `/apply` |

**`server/src/modules/dashboards/alertsMath.js` + `alerts.service.js`** — **après publication de fix-1b**, qui modifie les alertes (2683679) :

| Alerte | Niveau | Message ou effet |
|---|---|---|
| `tpm_conflit` | à traiter | « 2 districts couverts par deux contrats en novembre 2026 : choisir le TPM » |
| `tpm_a_confirmer` | à traiter | Modifications dont le contrat a changé. |
| `tpm_fin_contrat` | à surveiller | Districts qui passent de « selon contrat » à « sans contrat » dans les deux prochains mois, ou depuis ce mois, sans modification. Exemple : « Bekily, Beloha : CTR-2026-0001 échu le 30/09/2026, aucun TPM depuis octobre ». |
| `visits_unassigned` (existante) | — | Donne la répartition des causes (sans contrat, à arbitrer, district inconnu) et pointe vers `#/processus/rbm/tpm`. |

**Inchangés** : `tpm.repository.listProviders` (lot 8), consolidation, `tpm_assignments` (lot 8).

---

## 9. Tous les points d'entrée qui posent un TPM

| # | Point d'entrée | Aujourd'hui | Avec le lot 58 |
|---|---|---|---|
| 1 | **Onglet « Affectation des TPM »** (nouveau) | — | Modification zone × mois, région entière, raison, journal, restamp des visites prévues de la sélection. |
| 2 | TPM d'une visite (`FieldVisitsPage`, ligne ou sélection → `PATCH /visits/:id`, `POST /attribution/visits`) | Choix libre, sans contrôle | Par défaut, la zone. Une autre valeur exige une raison (source `visite`). « Revenir à la zone ». TPM sélectionnable au mois. |
| 3 | « Ajouter une visite » (`AddVisitModal` → `POST /visits`) | Libre | TPM de la zone affiché via `GET /attribution/resolve`. Le changer exige une raison. |
| 4 | Génération RBM (`generateFromRbmTx`) | NULL | Restamp : TPM de la zone. Le compte rendu donne les comptes par état. |
| 5 | Plan de suivi : cases, « plan » groupé, « auto » (`planMonthsTx`, `bulkUpdateSites`) | NULL ; une visite annulée re-cochée gardait l'ancien TPM | Restamp. Une visite annulée re-cochée reprend la zone, sauf si elle est `visite` ou `reprise`. |
| 6 | Import Locations Management (`importLocations`) | NULL | Restamp. |
| 7 | Import feuille « Planning » (`importPlanning`) | NULL (seul l'agent est lu) | Restamp. L'agent ne change pas. |
| 8 | Import « Risk-based site selection » (`importPlanSites`, visites réalisées) | NULL | Estampillé **une fois** avec le TPM de la zone pour ce mois, puis figé. |
| 9 | Futur générateur du lot 5 | — | **Contrat d'interface** : il écrit par les règles de `site_visits`, puis appelle `restampVisitsTx` (garde de test et déclencheur). Il peut afficher le TPM d'une tournée par district via `resolveSitesTx`. Il groupe ses tournées par `siteDistrictCtes`, pas par `lower(dName)`. Sa capacité reste par activité. |
| 10 | Contrats : approbation, avenant, résiliation | Sans effet | Restamp des mois ≥ mois courant. Les modifications concernées passent « à confirmer ». |
| 11 | Renouvellement | Zones perdues | Zones copiées. |
| 12 | Découpage et géographie des sites (`applySitesGeoTx`, `replaceBreakdown`, `createArea`, `updateArea`, `deleteArea`) | Sans effet | Restamp des mois ≥ mois courant. Modifications rattachées par chemin, ou signalées détachées. |
| 13 | `contractId` envoyé sur une visite | Accepté | Ignoré : `contract_id` est dérivé. |
| 14 | Ancien modèle `tpm_assignments` (AssignmentPage hors menu, routes `tpm.routes.js` encore montées) | Libre, verrouillé une fois le plan soumis | **Inchangé** : aucun écran ne l'appelle et l'évaluation des agents le lit encore. Son sort relève du lot 8. |

---

## 10. Écrans

### 10.1 Onglet « Affectation des TPM » (`web/src/pages/monitoring/TpmAttributionTab.jsx`, nouveau)

**Branchement dans `RbmSpacePage.jsx`.** `TABS` reçoit `{ id: 'tpm', label: 'Affectation des TPM', icon: UserCheck }` après « Plan de suivi ». Texte d'aide `TAB_HELP.tpm` :

> « Qui suit quelle zone, mois par mois. Par défaut, le TPM des contrats ; tout changement exige une raison et reste au journal. Les visites du plan reprennent le TPM de leur zone. »

Le texte d'aide de `plan` devient : « … avec le prestataire de suivi (TPM) de sa zone ». Aucun fichier en cours ne touche `RbmSpacePage.jsx`.

**Barre d'outils**

- **Vue** « Mois » (par défaut) ou « Période ».
- **Période** :
  - en vue Mois : un mois, par défaut le mois courant ;
  - en vue Période : `PeriodSelect` du lot 1b avec `maxSpan={24}` et `forward={12}`, par défaut du mois courant à +5 mois.
- **Filtres** : Région, TPM retenu, recherche par district, case « Tous les districts du découpage ».
- **Pastilles** (une à la fois, avec compteur) : Toutes · Modifiées · À confirmer · Sans contrat · À arbitrer · Écarts avec les visites · Zones détachées.
- **Actions** :
  - « Réappliquer aux visites prévues… » (si la dérive est > 0, ou pour une plage) ;
  - « Journal » ;
  - « Exporter (CSV) » via `lib/csv.js`.

**Bannières**, chacune avec son lien :

- **Zones de contrat détachées**, avec un lien vers le contrat (avenant). Exemple : « 2 zones de contrat détachées par le réimport du découpage ne donnent aucun TPM : CTR-2026-0001 Androy > Ambovombe ; CTR-2026-0003 Atsimo Andrefana > Ampanihy. Re-sélectionnez-les par avenant. »
- **Contrat échu encore « actif »**, avec ses districts.
- **Titulaires qui ne sont pas de type TPM** (tant que D1 n'est pas tranchée).
- **Contrats de suivi sans titulaire.**
- **Sites sans district reconnu** (« N sites n'héritent d'aucun TPM »), avec un lien vers Localités › À rapprocher.
- **Visites saisies avant cette règle** : « N visites prévues portent un TPM saisi avant cette règle », avec les liens « Voir » et « Aligner sur la zone ».
- **Tuile informative** : sites dont le code de lieu contredit le district déclaré.

**Tableau groupé (vue Mois)**

- **Ligne de région**, repliable. Elle montre le nombre de districts, le nombre de sites, les TPM présents et le nombre de lignes modifiées. Actions : « Modifier toute la région… » et « Revenir au contrat (région) ».
- **Ligne de district** avec une case à cocher. La sélection multiple ouvre une barre collante « Modifier la sélection (N zones)… » / « Revenir au contrat ».
- **Lignes de commune** en retrait, seulement quand elles existent (§ 4.3).

| Colonne | Contenu |
|---|---|
| Zone | Nom. Commune en retrait. |
| Sites | Nombre au registre, avec un lien vers l'onglet Sites filtré. Infobulle : « dont N au code de lieu contradictoire ». |
| Contrat(s) | Pastilles « CTR-2026-0001 · AINA · jusqu'au 30/09/2026 » ; « via région Androy » si la zone du contrat est une région. |
| TPM selon contrat | Nom, ou « — sans contrat », ou « 2 contrats : MIARO, TOHANA ». |
| TPM retenu | Nom + `<StatusBadge>` d'état + drapeaux (à confirmer, hors contrat, non TPM, inactif). |
| Raison | Tronquée. L'infobulle donne la raison complète, son auteur et sa date. |
| Visites du mois | « 12 prévues · 3 réalisées · 2 écarts », avec un lien vers Affectation & visites filtré. |
| Actions | Menu : « Changer le TPM… », « Revenir au contrat » (si modifiée), « Confirmer… » (si à confirmer), « Ajouter une exception de commune… », « Historique ». |

Les colonnes Zone et Sites restent figées au défilement, selon la règle des en-têtes figés.

**Vue Période.** Mêmes lignes, mais « TPM retenu » liste les **segments**. Exemple : « mai–sept. 2026 : AINA (selon contrat CTR-2026-0001) · oct.–déc. 2026 : sans contrat ». Chaque segment est cliquable et ouvre la fenêtre sur sa période. Les mois passés sont marqués « mois passé : les visites gardent le TPM qu'elles avaient ; modifier ce mois les met à jour ».

**État vide** : « Aucun site ni contrat dans cette région. »

**Rôles** : sans `canEdit`, le tableau est en lecture seule et aucun menu d'action n'est affiché.

### 10.2 Fenêtre « Changer le TPM » (`web/src/pages/monitoring/TpmChangeDialog.jsx`, partagée zones et visites)

- **Portée** (lecture seule) : « Bekily » ; « Région Androy : 5 districts », avec une case par district, toutes cochées ; ou « 12 visites ».
- **Bloc « Selon les contrats »** (lecture seule, apport de C1), par plages de mois. Exemple : « Beloha : ASSOCIATION AINA (CTR-2026-0001) janv.–sept. ; sans contrat oct.–déc. »
- **Période** (zones seulement) : du … au …. Préréglages « Ce mois », « Jusqu'à la fin du contrat », « Jusqu'à fin d'année ». 24 mois au plus.
- **Nouveau TPM** : liste groupée depuis `GET /attribution/providers`.
  - « Sous contrat de suivi sur la période » (avec numéros de contrat) ;
  - « Autres TPM actifs » ;
  - « Aucun TPM (zone non suivie) » ;
  - en mode visite, « Revenir au TPM de la zone ».
- **Raison** : zone de texte avec compteur 10–500. Suggestions qui insèrent un texte modifiable : « Contrat en cours de renouvellement », « Capacité insuffisante du prestataire », « Accès / sécurité », « Arbitrage entre deux contrats ». Si la valeur choisie est celle du contrat : « Revient à la valeur des contrats », raison facultative.
- **Aperçu** (`POST /preview`, relancé 300 ms après chaque changement). Exemple :
  > « 5 districts × 3 mois : 12 modifications créées, 3 mois déjà selon contrat (ignorés). 27 visites prévues passeront de AINA à YPA ; 5 visites réalisées ne changent pas ; 2 visites gardent leur propre TPM. Visites datées : AINA −18, YPA +18 (jours de collecte à reporter dans Planification & budget). »
  
  Avertissements possibles : « Le plan d'octobre est validé », « YPA n'est sous aucun contrat sur cette période ».
- **Boutons** : Annuler / Enregistrer. L'empreinte de l'aperçu est envoyée. Sur 409 : « L'affectation a changé entre-temps » + bouton « Recharger ».
- **Modification à confirmer** : la fenêtre s'ouvre pré-remplie avec l'ancienne raison, qu'il faut ressaisir ou modifier.

### 10.3 Journal (`TpmAttributionLog.jsx`)

Segment « Journal » de l'onglet ; même tableau dans le tiroir « Historique » d'une ligne, filtré.

- **Une ligne par lot**, dépliable en détail par zone et par mois, ou par visite.
- **Colonnes** : Date · Par · Action (badge) · Portée · Période · Avant → Après · Selon contrat (au moment) · Raison · Visites mises à jour.
- **Filtres** : période, région ou district, TPM, action.
- **Export** CSV.

### 10.4 Plan de suivi (`PlanBoardPage.jsx`, colonne « Prestataire (TPM) », l. ~293-350)

- **Valeur affichée** : le **TPM de la zone du site** pour le mois courant s'il tombe dans l'année affichée, sinon pour janvier. Nom + icône d'état ; l'infobulle donne les segments de l'année.
- **Zone sans TPM** : « à affecter (sans contrat / à arbitrer / district inconnu) », avec un lien vers l'onglet filtré sur le district.
- **Cellules de mois** : l'infobulle garde le TPM de la visite. Une marque « ≠ » signale une visite `visite` ou `reprise` dont le TPM diffère de sa zone.
- Seule cette colonne change. 6a ne modifie que la section carte de ce fichier.

### 10.5 Affectation & visites (`FieldVisitsPage.jsx`, à rebaser après 1b)

- La liste déroulante libre de chaque visite (l. ~147-151) est remplacée par **le nom du TPM + badge de source**, avec un bouton « Changer… » qui ouvre la fenêtre du § 10.2 en mode visite.
- La sélection multiple offre « Changer le TPM de la sélection… » (une seule raison) et « Revenir à la zone ».
- Les visites `reprise` affichent la puce « Saisi avant (à vérifier) », avec deux actions groupées : « Aligner sur la zone » et « Garder comme exception » (raison).
- **`AddVisitModal`** (l. ~436-505) affiche le TPM de la zone en lecture, par exemple « TOHANA, selon la zone (contrat CTR-2026-0002) ».
  - « Choisir un autre TPM… » révèle la liste et la raison obligatoire.
  - Si la zone n'a pas de TPM, une note dit : « Préférez l'affecter dans l'onglet Affectation des TPM : toutes les visites de la zone en profiteront. »
  - Le champ contrat disparaît.
- **Filtres** : TPM, pastilles « Modifiés » et « À affecter ».
- La carte « Couverture par prestataire » renomme « Non affecté » en « À affecter », avec la répartition des causes en infobulle.
- En-tête : lien « Les TPM se règlent par zone : Affectation des TPM → ».
- La liste des prestataires vient de `GET /attribution/providers` sur le mois affiché.

### 10.6 Priorités du mois et imports

- **`RbmPage.jsx`, après « Générer »** : « 42 visites planifiées : 30 selon contrat, 0 modifiées, 12 à affecter (8 sans contrat, 4 district inconnu). Voir l'affectation des TPM. »
- **Comptes rendus des trois imports** : la même ligne « TPM : … ».

### 10.7 Statuts : couleur + icône + libellé (`web/src/lib/tpmAttribution.js`, nouveau)

Ajout dans `ui.jsx`, `STATUS_ICONS` : `edit: PencilLine`. C'est un ajout d'une clé ; aucun fichier en cours ne touche `ui.jsx`.

```js
export const TPM_ZONE_STATE = {
  contrat:      { label: 'Selon contrat',              tone: 'green',  icon: 'check' },
  modifie:      { label: 'Modifié',                    tone: 'orange', icon: 'edit'  },
  aucun_tpm:    { label: 'Aucun TPM (décidé)',         tone: null,     icon: 'ban'   },
  a_arbitrer:   { label: 'Deux contrats — à arbitrer', tone: 'red',    icon: 'warn'  },
  sans_contrat: { label: 'Sans contrat',               tone: null,     icon: 'na'    },
};
export const TPM_FLAGS = {
  a_confirmer: { label: 'À confirmer (contrat changé)', tone: 'orange', icon: 'clock' },
  partiel:     { label: 'Partiel (par commune)',        tone: 'blue',   icon: 'dot'   },
  hors_contrat:{ label: 'Hors contrat ce mois',         tone: 'orange', icon: 'warn'  },
};
export const TPM_VISIT = {   // provider_source + provider_zone_state
  'zone:contrat':          { label: 'Selon contrat',             tone: 'green',  icon: 'check' },
  'zone:modifie':          { label: 'Modifié (zone)',            tone: 'orange', icon: 'edit'  },
  'zone:aucun_tpm':        { label: 'Aucun TPM (zone)',          tone: null,     icon: 'ban'   },
  'zone:a_arbitrer':       { label: 'À affecter — deux contrats', tone: 'red',   icon: 'warn'  },
  'zone:sans_contrat':     { label: 'À affecter — sans contrat', tone: 'orange', icon: 'clock' },
  'zone:district_inconnu': { label: 'À affecter — district inconnu', tone: 'orange', icon: 'warn' },
  'zone:anterieur':        { label: 'Antérieur à la règle',      tone: null,     icon: 'na'    },
  visite:                  { label: 'Modifié pour cette visite', tone: 'orange', icon: 'edit'  },
  reprise:                 { label: 'Saisi avant (à vérifier)',  tone: 'blue',   icon: 'draft' },
};
```

Rendu par `<StatusBadge def={…} />`. La couleur n'est jamais seule à porter l'information.

### 10.8 Français / anglais

- Toutes les chaînes passent par `tr()`.
- Nouveau dictionnaire `web/src/locales/en/tpmAttribution.js`, plus une ligne d'import ajoutée **en fin** de `web/src/locales/en.js` (fichier modifié par toutes les branches).
- Exemples :

| Français | Anglais |
|---|---|
| Affectation des TPM | TPM assignment |
| Selon contrat | Per contract |
| Modifié | Changed |
| Deux contrats — à arbitrer | Two contracts — to resolve |
| Sans contrat | No contract |
| Aucun TPM (décidé) | No TPM (decided) |
| À confirmer | To confirm |
| Revenir au contrat | Revert to contract |
| Raison du changement | Reason for change |
| Modifier toute la région | Change whole region |
| Journal des modifications | Change log |
| Modifié pour cette visite | Changed for this visit |
| Saisi avant (à vérifier) | Entered earlier (to check) |
| À affecter | To assign |

- Le balayage FR/EN doit trouver 0 phrase manquante.

### 10.9 Client API (`web/src/api/client.js`)

Ajouts **en fin de fichier** seulement : `tpmAttribution`, `tpmAttributionProviders`, `tpmAttributionResolve`, `tpmAttributionPreview`, `tpmAttributionSave`, `tpmAttributionRevert`, `tpmAttributionApply`, `tpmAttributionVisits`, `tpmAttributionLog`.

---

## 11. Effets en aval

`provider_id` reste stocké : il n'y a qu'une seule vérité, et tous les lecteurs actuels et ceux des branches restent justes.

| Lecteur | Effet |
|---|---|
| **Couverture par prestataire** (`fieldMath.summarizeVisits`), KPI « À affecter », alertes `provider_late` et `visits_unassigned` | « Non affecté » ne compte plus que les vrais « à affecter » (sans contrat, à arbitrer, district inconnu) et les visites `anterieur`. |
| **Matrice par TPM** (onglet « Partenaire / TPM » de Couverture du suivi), nombre de prestataires du tableau des mois, carte 6a « visites sans prestataire », blocs 7a (`visits_by_provider`, `collection_days`, fiche TPM) | Effet automatique. |
| **Jours de collecte** (`collectionDaysSummary` → `PlanBudgetDrawer` « Sites affectés ») | Suivent le TPM retenu. Le **Planifié** de la consolidation ne bouge que lorsqu'un utilisateur reporte les jours dans les postes : aucun montant n'est réécrit en silence. L'aperçu (§ 10.2) annonce le déplacement. |
| **Consolidation** | Inchangée : elle ne lit pas les visites. |
| **Suppression des contrats (retour 56)** | `site_visits.contract_id` est désormais rempli pour les visites « selon contrat ». Un contrat validé qui porte des visites estampillées devient « relié », donc non supprimable, ce qui est cohérent avec la politique. Les modifications n'ont **aucune** clé vers un contrat (instantané texte), donc aucun lien nouveau. À signaler à l'équipe 56. |
| **Évaluation des agents** | Inchangée (elle lit `tpm_assignments`). |

---

## 12. Tests

### `server/test/reasonText.test.js`

- Espaces rognés et fusionnés.
- Vide → `reason_required` si requis, `null` sinon.
- 9 caractères → `reason_short` ; 501 caractères → `reason_long`.
- « .......... », « aaaaaaaaaa », « 1234567890 » → `reason_meaningless`.
- « Contrat AINA échu » → accepté.

### `server/test/tpmAttribution.test.js` (pur, `node:test`)

1. **Couverture.**
   - « actif » à l'intérieur et aux bornes ; mois entamé (début le 15).
   - CTR-0001 (fin le 2026-09-30, encore « actif ») **ne couvre pas** 2026-10.
   - « résilié » couvre jusqu'au mois de résiliation inclus.
   - Brouillon, en validation et rejeté : jamais.
   - IV.suivi = 0 : exclu.
   - Contrat sans titulaire : exclu et signalé.
2. **Zones.**
   - District exact.
   - Zone de région qui couvre ses districts (`via:'region'`).
   - Commune de contrat : le district est `sans_contrat` + `partiel`, la ligne commune est `contrat`.
   - Zone détachée : jamais utilisée, listée.
   - Fokontany : `trop_fine`, signalée.
3. **Précision.** Une région RANO et un district SAHY sur le même district donnent SAHY.
4. **0, 1, ≥ 2 titulaires.**
   - Deux titulaires de même profondeur : `a_arbitrer`, candidats triés, aucun choix.
   - Même titulaire sur deux contrats : `contrat`, `contractId` = date de début la plus récente, puis plus petit numéro.
5. **Cellule.**
   - Une modification l'emporte ; « aucun TPM » l'emporte aussi.
   - `a_confirmer` quand l'attendu change : contrat → contrat autre, contrat → sans_contrat, a_arbitrer → contrat.
   - `redondante` quand l'attendu rejoint la modification.
   - Une modification périmée **reste appliquée**.
   - `contractId` d'un arbitrage = celui du candidat choisi.
6. **`planOverrides`.**
   - Région de 3 districts × 12 mois, dont 1 district déjà RANO par contrat : 24 insertions et 12 `sameAsContract`.
   - Même TPM avec une nouvelle raison : `modifier` ou `confirmer`, sans doublon.
   - Choisir la valeur du contrat supprime la modification.
   - `null` sur `sans_contrat` : `nothingToChange`.
   - Plus de 2 400 cellules : refusé.
7. **`visitDecision`.**
   - La valeur de la zone renvoie à la zone.
   - Une autre valeur sans raison : erreur.
   - `null` avec raison : `visite`.
   - `keep` d'une reprise : `visite` avec la même valeur.
   - TPM non sélectionnable : erreur.
8. **`selectableProviders` / `activeProviders`.**
   - Titulaires plus TPM actifs.
   - Partenaire inactif exclu.
   - Dédoublonnage, ordre stable, `months` par prestataire.
9. **`restampPlan`.**
   - Ne rend que les lignes qui changent.
   - Commune portée avant district.
   - Sans district : `district_inconnu`.
   - Deuxième passage : vide.
10. **`segments` et `stampOf`.**
    - Fusion des mois identiques.
    - Empreinte stable quel que soit l'ordre ; elle change si une cellule change.
11. **`districtAreaFor`.** Unique, absent, ou ambigu → `null`.
12. **Constantes.** `VISIT_ZONE_STATES`, `VISIT_SOURCES` et les `expected_state` sont égaux aux listes des CHECK de `070_tpm_zone_attribution.sql`, lu comme texte.

### `server/test/tpmAttributionRepo.test.js` (faux client, comme `monitoringIndicatorRepo.test.js`)

- Chaque requête filtre `tenant_id = $1`.
- `setOverrides` exécute, dans l'ordre : verrou, lecture, `FOR UPDATE`, **un** DELETE, **un** upsert multi-lignes, **un** UPDATE de restamp, **un** INSERT de journal. Jamais N requêtes.
- Le chemin et la profondeur viennent d'`admin_areas`, pas des paramètres.
- Le restamp ne vise que `zone` + (à estampiller, ou `planifie` dans la portée).
- `dryRun` et l'aperçu n'écrivent rien et ne prennent pas le verrou.
- Empreinte différente → 409.
- Aucun `Promise.all` sur un client.
- 23505 → 409, 23514 → 400, 55P03 → 503.

### `server/test/visitWritersGuard.test.js` (garde statique)

Tout fichier de `server/src` qui contient `INSERT INTO site_visits`, ou `UPDATE site_visits` avec `status`, `site_id` ou `period_month`, contient aussi `restampVisitsTx`. Les seeds sont inclus.

### Autres tests à adapter ou ajouter

- `server/test/rbmLastVisit.test.js` : le faux client accepte les requêtes du restamp.
- Routes (zod) :
  - raison absente ou courte → 400 avec `code` ;
  - plage de plus de 24 mois → 400 `period_span` ;
  - `areaIds` et `regionIds` vides → 400 ;
  - `providerId: ''` → null ;
  - `contractId` sur une visite → ignoré.
- Banc `perfPeriod.js` (lot 1b) :
  - parité `sdarea` ↔ `districtAreaFor` ;
  - durée du restamp pour 5 000 sites × 12 mois (< 300 ms).

### Base (vérification manuelle en dev, dans une transaction ROLLBACK)

- Modification sans raison → 23514.
- Modification égale à l'attendu `contrat` → 23514.
- Visite `zone:contrat` sans TPM → 23514.
- `INSERT` d'une visite sans restamp → échec au COMMIT (P0001).
- `mems2_app` ne peut ni UPDATE, ni DELETE, ni TRUNCATE sur `tpm_attribution_log`.

### Contrôles

`npm test` et `npm run lint` (serveur), `npm run build` (web), balayage Playwright de toutes les routes en ajoutant `#/processus/rbm/tpm` (0 erreur console ou API), balayage FR/EN.

---

## 13. Vérification à l'écran (dev, hypothèse A de D1)

**Androy**
- Bekily (134 sites) et Beloha (115) : ASSOCIATION AINA, « Selon contrat » d'oct. 2025 à sept. 2026. À partir d'**oct. 2026 : « Sans contrat »**. Alerte `tpm_fin_contrat` et bannière « contrat échu encore actif ».
- Ambovombe-Androy (166) et Antanimora Sud (82) : « Sans contrat », avec la bannière de zone détachée.
- Tsihombe (104) : « Sans contrat ».

**Anosy**
- Amboasary-Atsimo (97) et Betroka (12) : TOHANA, de mars à nov. 2026.
- Taolagnaro (108) : « Sans contrat ».

**Atsimo Andrefana**
- Betioky Atsimo (288) : MIARO, de févr. à déc. 2026.
- Ampanihy Ouest (51) : « Sans contrat » + bannière de zone détachée.
- Toliary-II, Morombe, Benenitra, Sakaraha : « Sans contrat ».

**Menabe**
- Manja (4) : « Sans contrat ».

**Ensemble**
- 0 « à arbitrer ».
- Bannière « 3 titulaires ne sont pas de type TPM ».
- 8 sites sans district.
- Les 48 visites avec un TPM passent en `reprise`. Les **12 visites prévues** d'Amboasary-Atsimo apparaissent « à régulariser » face au TPM de zone TOHANA. Les 108 visites réalisées sans TPM sont en `anterieur`. `r5` n'estampille rien (aucune visite prévue sans TPM).

**Essai de modification** : Betioky Atsimo, oct.–déc. 2026 → YPA, raison « Collecte confiée à YPA par le bureau de Toliara ».
- Résultat attendu : 3 lignes `tpm_zone_overrides`, 1 ligne `lot` + 3 lignes `zone` au journal.
- Les visites prévues `zone` de Betioky sur ces mois passent à YPA (`modifie`). Pour en avoir à observer, générer d'abord le RBM de novembre.
- « Revenir au contrat » rétablit MIARO.

**Essai d'avenant** : un avenant approuvé qui retire Betioky de CTR-0003. La modification YPA reste appliquée et passe « À confirmer ». Les visites prévues non modifiées de Betioky, du mois courant et après, passent « sans contrat ».

**Santé** : `GET /api/settings/health` donne `tpm_attribution_derive = 0` après chaque opération.

**Hypothèse B** (TPM désigné, CTR-0002 ↔ SAHY par les rapports) : 4 des 12 visites prévues concordent déjà.

---

## 14. Intégration avec les chantiers en cours

| Chantier | Fichiers communs | Conduite |
|---|---|---|
| **1b / fix-1b** (`wip/fix-1b` 2683679) | `field.repository.js` (`generateFromRbmTx` `asOf`, lecteurs), `placeMatch.repository.js` (6 lignes), `common/siteActivitySql.js`, `middleware/period.js`, `PeriodSelect`, `FieldVisitsPage.jsx` (13 lignes), alertes | **Partir de `main` après la publication de fix-1b.** Le lot 58 réutilise `siteDistrictCtes` et `keySql` sans les modifier, ainsi que `readPeriod`, `PERIOD_CAPS.facts` et `PeriodSelect`. Les écrivains de visites ne sont modifiés par aucune branche : on n'y ajoute qu'un appel final. |
| **6a / fix-6a** | `PlanBoardPage.jsx` (section carte), `app.js` (+2), `FieldVisitsPage.jsx`, `en.js` | Aucun chevauchement de lignes : la colonne TPM n'est pas touchée par 6a. `app.js` et `en.js` en ajout seulement. 061 n'est pas touché. |
| **7a** | Migration 064 (`trg_data_changed`), `contracts.service.js` (ajouts en fin), `health.repository.js` (+7), `client.js`, `en.js` | 070 crée son déclencheur si `mems_data_changed()` existe. **Demander au lot 7a** d'ajouter `tpm_zone_overrides → 'visits'` dans 064, avec une garde `to_regclass`. Ajouts en fin de fichier uniquement. |
| **56, suppressions** (`zealous-bardeen`, 069) | `contracts.service.js` (`deleteDraft`, `allowedActions`), `app.js` | Nos ajouts sont dans `decide`, `decideAmendment`, `terminate` et `renew`. Le remplissage de `site_visits.contract_id` est déjà dans sa liste de liens. `cleanReason` est disponible pour son justificatif. |
| **54, trimestriel** | — | Aucun. |
| **Lot 5** (065–068) | Enregistrement du plan, générateur | Contrat d'interface du § 9 n° 9. Ses migrations ne référencent pas les tables de 070. Le journal (zone × mois × valeur × raison × auteur) est le même motif que le risque daté du retour 25 : réutiliser le motif « valeurs mensuelles + journal inaltérable + `cleanReason` », dans des tables distinctes. |
| **Lot 8** | `tpm.repository.listProviders`, Planification & budget, rapports, évaluations, `tpm_assignments` | Le lot 58 livre `contractCoversMonth`, `contractTpm`, `activeProviders`, `selectableProviders` et `GET /attribution/providers`. Le lot 8 les branche sur ses listes et décide du sort de `tpm_assignments`. |

---

## 15. Découpage en commits

À chaque commit, le journal est mis à jour, commité et poussé, conformément à CLAUDE.md.

1. `common/reasonText.js`, `tpm/tpmAttribution.js` et leurs tests.
2. Migration 070, `tpmAttribution.repository.js` (dont `restampVisitsTx`), appels dans tous les écrivains de visites et dans `applySitesGeoTx`, `localities` (verrou + rattachement), contrats (restamp + `renew` qui copie les zones), réparation `r5_tpm_selon_zone`, seeds, garde de test, tests du dépôt.
3. Service, contrôleur, routes `/api/tpm/attribution` ; schémas de visites (`contractId` retiré, `providerReason`, `followZone`) ; tests zod.
4. Onglet, fenêtre, journal, `lib/tpmAttribution.js`, `STATUS_ICONS.edit`, dictionnaire anglais, `client.js`.
5. Affectation & visites, colonne du Plan de suivi, comptes rendus RBM et imports.
6. Santé, puis alertes (après fix-1b).
7. Documentation :
   - `PLAN_RETOURS_15_37.md` (§ 3) ;
   - `RETOURS_UTILISATEUR.md` (retour 58 ✅ et renvois depuis 28.4 et 30) ;
   - `CLAUDE.md` : puce « Affectation des TPM » et règle « toute écriture de `site_visits` finit par `restampVisitsTx` ; déclencheur différé » ;
   - `ETAT_DU_PROJET.md` (réservation 070) ;
   - `JOURNAL.md`.

**Relecture adverse avant publication**, sur six points : invariants I1 à I3 ; ordre des verrous (y compris `replaceBreakdown`) ; garde et déclencheur ; aucune valeur dérivée acceptée du client ; REVOKE du journal ; aucun `Promise.all` sur un client.

---

## 16. Hors périmètre (suites proposées)

- **Attribution par activité** (un TPM par zone × activité) : attend le référentiel du lot 2. Ajout futur possible de `activity_code` (NULL = toutes) sans casse.
- **Capacité par TPM** dans le générateur du lot 5. Avec un TPM par district, une tournée correspond à un TPM.
- **Verrouillage par l'état du plan mensuel** (`field_month_plans` soumis ou validé) : aujourd'hui, seulement un avertissement dans l'aperçu.
- **Date d'effet des avenants** : sans elle, l'onglet recalcule en direct les mois passés, tandis que les visites de ces mois gardent leur TPM.
- **« TPM réel »** issu des données (`monitoring_submissions.partner_id`, EnuPartner), affiché à côté du TPM retenu, avec écart et alerte. Candidat aux lots 4 et 8.
- **Option « TPM de ce planning » à l'import** de la feuille Planning. Correction de la lecture `getCell`/`eachRow` des routes `/import` et `/rbm/import` selon `sheetRows`. À faire quand on retravaillera cet import.
- **Zones « par affectation » sur la fiche partenaire 360°** (lot 8 ou 15).
- **Gel ou migration de `tpm_assignments`** (lot 8).

---

## 17. Question bloquante D1 (valeurs par défaut seulement)

**Qui est « le TPM d'un contrat » ?**

Dans la base de démonstration, les 3 contrats de suivi sont signés avec des partenaires de type « prestataire » (AINA, TOHANA, MIARO). Les TPM (RANO, SAHY, YPA) n'ont aucun contrat : ils facturent et planifient contre ces contrats.

- **(A) Recommandé : le titulaire du contrat est le TPM des zones du contrat.**
  - C'est ce que disent les retours 30 et 58 (« on l'a déjà fait dans les contrats »), le libellé du formulaire (« zones affectées au prestataire ») et la Consolidation (« Prestataire TPM »).
  - **Aucun changement de modèle.** On corrige les contrats de démonstration (`seed.js`) pour que RANO, SAHY et YPA en soient titulaires.
- **(B) Le contrat est signé avec un partenaire de mise en œuvre et désigne un TPM distinct.**
  - Ajouter une colonne nullable `contracts.tpm_partner_id` (type `tpm`) dans 070, ou dans 071 si D1 est tranchée après la publication.
  - Ajouter un sélecteur dans le formulaire et dans l'avenant.
  - Ajouter une réparation qui la remplit quand `tpm_reports` / `tpm_collection_plans` ne relient qu'**un** TPM au contrat (cas du dev : CTR-0001 ↔ RANO, CTR-0002 ↔ SAHY, CTR-0003 ↔ YPA).
  - Seule `contractTpm` change.
  - Une liste de plusieurs TPM par contrat est écartée : elle mettrait chaque zone du contrat « à arbitrer ».

La construction peut commencer avec A. En cas de B, l'écart se limite à ces ajouts.

## Migration

**Fichier** : `server/src/db/migrations/070_tpm_zone_attribution.sql`.

**Numéro.** 070 est le premier libre après les réservations :
- 061 carte (fix-6a) ;
- 062 à 064 lot 7a ;
- 065 à 068 lot 5 ;
- 069 suppressions (retour 56).

À inscrire dans la liste de réservation. Les migrations du lot 5 ne doivent pas référencer ces tables.

**1. Table `tpm_zone_overrides`** (modifications zone × mois)
- Colonnes :
  - `admin_area_id`, ON DELETE SET NULL, avec `area_path` conservé ;
  - `area_depth`, 2 ou 3 ;
  - `period_month`, toujours le 1er du mois ;
  - `provider_id` : NULL veut dire « aucun TPM », ON DELETE RESTRICT ;
  - instantané du contrat au moment de la décision : `expected_state` (contrat, sans_contrat ou a_arbitrer), `expected_provider_id`, `expected_label`.
- Contraintes :
  - `reason` NOT NULL, de 10 à 500 caractères ;
  - CHECK de cohérence de l'instantané ;
  - CHECK « diffère du contrat » ;
  - CHECK « pas de “aucun TPM” là où rien n'est couvert » ;
  - index UNIQUE partiel sur (tenant, zone, mois).
- Sécurité : RLS avec USING et WITH CHECK, GRANT à mems2_app, `mems_install_same_tenant`.

**2. Table `tpm_attribution_log`** (journal inaltérable)
- Une ligne d'en-tête `lot`, plus une ligne par zone × mois ou par visite.
- Noms en instantané, aucune clé étrangère.
- RLS.
- `GRANT SELECT, INSERT`, **puis `REVOKE UPDATE, DELETE, TRUNCATE`** : ce REVOKE est indispensable, car les migrations 002 et 012 accordent ces droits par défaut.

**3. Table `site_visits`**
- Nouvelles colonnes :
  - `provider_source` : zone, visite ou reprise ; NOT NULL, défaut zone ;
  - `provider_zone_state` : NULL veut dire « à estampiller », sinon l'état de la cellule de zone ;
  - `provider_reason`, `provider_set_by`, `provider_set_at`.
- Reprise de l'existant :
  - visites avec un TPM → `reprise`, avec une raison système ;
  - visites sans TPM, réalisées, annulées ou d'un mois passé → `anterieur`, figées ;
  - visites sans TPM prévues pour le mois courant ou après → à estampiller par la réparation `r5_tpm_selon_zone`.
- CHECK de forme :
  - « contrat » ou « modifié » ⇒ un TPM ; tout autre état ⇒ aucun TPM ;
  - `visite` ou `reprise` ⇒ une raison de 10 à 500 caractères ;
  - `contract_id` seulement s'il est dérivé de la zone ou repris.
- Deux index partiels.
- **Déclencheur de contrainte différé** `trg_site_visits_tpm_stamped` : il refuse au COMMIT toute visite laissée « à estampiller ».
- `mems_install_same_tenant('site_visits')` relancé, pour couvrir `provider_set_by`.

**4. Déclencheur `trg_data_changed('visits')`**
- Posé sur `tpm_zone_overrides`, seulement si `mems_data_changed()` existe déjà (lot 7a).
- Sinon, le lot 7a l'ajoute à sa migration 064.

## Lot et ordre

**Lot 58 « Affectation des TPM par zone »** : lot autonome, inséré comme les lots 56 et 54.

**Ordre de passage**
- **Après** la publication de `wip/fix-1b` (lot 1b). Le lot 58 réutilise sans les modifier :
  - `siteDistrictCtes` et `keySql` ;
  - `readPeriod` et `PERIOD_CAPS.facts` ;
  - `PeriodSelect`.

  Il s'appuie aussi sur les lecteurs `listVisits` et les alertes, que fix-1b réécrit.
- **Avant** que le lot 5 n'écrive l'enregistrement de son plan. Le générateur du lot 5 doit appeler `restampVisitsTx` ; la garde de test et le déclencheur différé l'imposent.

**Autres chantiers.** Le lot est indépendant de 6a, 7a, 56 et 54. Il n'y ajoute que des lignes, en fin de fichier ou dans des fonctions qu'ils ne touchent pas. Une seule demande est faite au lot 7a : inscrire `tpm_zone_overrides` dans sa migration 064.

**Ce que le lot fournit au lot 8.** La règle « Prestataire actif » : `contractCoversMonth`, `contractTpm`, `activeProviders`, `selectableProviders` et `GET /api/tpm/attribution/providers`. Le lot 8 la branchera sur Planification & budget, les rapports attendus et les évaluations, et y décidera du sort de `tpm_assignments`.

**Découpage** : 7 commits (§ 15), avec le journal poussé à chaque étape.

**Relecture adverse avant publication**, sur six points :
- les invariants I1 à I3 ;
- l'ordre des verrous, y compris dans `replaceBreakdown` ;
- la garde de test et le déclencheur ;
- l'absence de toute valeur dérivée acceptée du client ;
- le REVOKE du journal ;
- l'absence de `Promise.all` sur un client.

## Risques

- D1 n'est pas tranchée : tant qu'elle ne l'est pas, les valeurs par défaut en dev désignent AINA, TOHANA et MIARO (type « prestataire »), et non RANO, SAHY et YPA. La bannière « titulaire non TPM » s'affiche partout, et les données de démonstration (seed) ou le modèle (colonne tpm_partner_id, hypothèse B) doivent être corrigés.
- Zones de contrat détachées : 2 zones de contrat sont détachées (Androy > Ambovombe, découpé depuis en Ambovombe-Androy et Antanimora Sud ; Atsimo Andrefana > Ampanihy, devenu Ampanihy Ouest). Leurs 299 sites restent « Sans contrat » tant qu'un avenant ne les a pas re-sélectionnées.
- Contrat échu mais encore « actif » : CTR-2026-0001 est échu depuis le 30/09/2026. Bekily et Beloha (249 sites) n'ont donc aucun TPM par défaut à partir d'octobre 2026. C'est voulu et signalé (alerte tpm_fin_contrat), mais l'utilisateur le découvrira à la livraison.
- Règle de district : elle suit celle du lot 1b (graphie déclarée, P-code cru seulement dans la bonne région). Les 324 sites dont le code de lieu contredit le district déclaré héritent du TPM du district déclaré. C'est cohérent avec les tableaux de bord, mais une erreur de saisie du district dans le registre donne un mauvais TPM, ce que la tuile « code contradictoire » ne fait que signaler.
- Coût du recalcul : il est appelé sans condition à la fin de applySitesGeoTx, ce qui ajoute un coût à chaque écriture de sites. La cible est moins de 300 ms pour 5 000 sites × 12 mois, à mesurer avec le banc du lot 1b. Le verrou d'attribution par compte sérialise ces écritures ; il est borné à 20 s puis renvoie 503.
- Déclencheur de contrainte différé : il fait échouer au COMMIT (500) tout écrivain de visites qui oublierait restampVisitsTx, y compris les seeds, les tests d'intégration et le futur générateur du lot 5. C'est voulu, mais toute insertion directe de visites doit être adaptée dans le même lot. Son coût est d'une relecture par clé primaire et par visite insérée.
- Avenants sans date d'effet : l'onglet recalcule en direct les mois passés selon les contrats actuels, alors que les visites de ces mois gardent leur TPM (recalcul seulement à partir du mois courant). Un écart peut donc apparaître sur les mois passés ; il est signalé « mois passé » et se corrige par « Réappliquer » ou par une modification explicite.
- Risque d'interblocage : replaceBreakdown doit prendre le verrou d'attribution avant de toucher tpm_zone_overrides. Si on l'oublie, deux écritures concurrentes se bloquent mutuellement : PostgreSQL détecte l'interblocage, l'une reçoit 40P01, ce qui donne 503.
- Ordre des migrations avec le lot 7a : si 064 est appliquée après 070 sur une base existante sans inscrire tpm_zone_overrides dans sa liste, les blocs du concepteur servent un cache périmé après une modification de zone.
- Suppression des contrats (retour 56) plus stricte : site_visits.contract_id est désormais rempli, donc un contrat validé qui porte des visites estampillées devient « relié » et n'est plus supprimable. C'est cohérent avec la politique, mais l'équipe 56 doit le savoir.
- Fichiers partagés : le lot touche contracts.service.js (aussi modifié par 56 et 7a), placeMatch.repository.js (fix-1b), FieldVisitsPage.jsx (1b et 6a), app.js, en.js et client.js (toutes les branches). Les ajouts sont courts et en fin de fichier, mais la fusion doit être faite après fix-1b, et avec soin pour contracts.service.js.
- Renouvellement : un contrat renouvelé copiera désormais ses zones. C'est un petit changement de comportement du module Contrats ; un renouvellement voulu sans certaines zones devra passer par un avenant.

## Questions pour l'utilisateur

1. *(Décidé par défaut le 14/10 : A ; révisé le 15/10 pour ne faire qu'une règle avec le lot 8 : TPM rattaché au contrat par un plan de collecte ou une facture, sinon titulaire — à confirmer.)* Qui est « le TPM d'un contrat » ? Deux possibilités. (A) Le titulaire du contrat lui-même : c'est ce que supposent vos retours 30 et 58, le formulaire du contrat et la Consolidation. On corrige alors les contrats de démonstration pour que RANO, SAHY et YPA en soient titulaires. (B) Le contrat est signé avec un partenaire de mise en œuvre (AINA, TOHANA, MIARO) et désigne un TPM distinct : on ajoute alors un champ « TPM désigné » au contrat et à l'avenant, pré-rempli quand un seul TPM facture déjà le contrat. Je recommande A. Ce choix ne bloque que les valeurs par défaut affichées, pas la construction.
2. *(Question ouverte ; en attendant, ces zones portent l'indice « zone à resélectionner (avenant) », aucun TPM deviné.)* Deux zones de contrat ne correspondent plus au découpage actuel. L'ancien district « Ambovombe » (CTR-2026-0001) a été découpé en Ambovombe-Androy et Antanimora Sud : le contrat doit-il couvrir les deux, ou seulement Ambovombe-Androy ? Et « Ampanihy » (CTR-2026-0003) correspond-il bien à Ampanihy Ouest ? Tant que ces zones ne sont pas re-sélectionnées par avenant, leurs 299 sites restent « Sans contrat » dans l'onglet.
