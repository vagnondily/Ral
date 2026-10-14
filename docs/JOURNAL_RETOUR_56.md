# Journal — Retour 56 (suppression des documents + journal des suppressions)

> Journal **dédié** à ce chantier, tenu sur la branche isolée
> `claude/zealous-bardeen-p9ozcr` par une seconde session Claude, **distincte**
> de la session principale (`claude/practical-meitner-2c1560`). Fichier séparé
> de `docs/JOURNAL.md` pour **ne jamais entrer en conflit** avec le journal
> principal. Heures en UTC.
>
> Statuts : ⏳ à faire · 🔄 en cours · ✅ fait · ⛔ bloqué · ⏸️ en pause

## Contexte

- **Demande (retour 56).** Pouvoir supprimer les documents **non validés**
  (brouillon, soumis, rejeté) après confirmation ; un document **validé** n'est
  supprimable que **sans donnée reliée, avec un justificatif obligatoire**.
  Chaque suppression de document est inscrite dans un **journal des suppressions**
  (qui, quand, pourquoi, résumé). Les **référentiels** (sites, agents,
  partenaires…) qui portent des données **se désactivent** (inchangé).
- **Branche isolée.** Pour ne pas interférer avec la session principale qui
  construit les lots 1b / 6a / 7a, tout est développé et poussé uniquement sur
  `claude/zealous-bardeen-p9ozcr`.
- **Périmètre retenu.** Rapports / factures TPM, plans de collecte,
  contrats / avenants. **Le concepteur de rapport est exclu** : le journal
  principal indique qu'il est aligné avec le lot 7a (session principale) —
  on évite ainsi le doublon.

## Décisions

- **« Validé » par type de document** (source unique, `deletionPolicy.js`) :
  - rapport TPM : `valide` (les autres : `attendu`, `soumis`, `rejete`,
    `non_applicable` = non validé) ;
  - plan de collecte : `valide` (`brouillon` = non validé) ;
  - contrat : `actif`, `resilie` (`brouillon`, `en_validation`, `rejete` = non validé) ;
  - avenant : `approuve` (`en_validation`, `rejete` = non validé).
- **« Donnée reliée »** (calculée par le dépôt, par type) : un document **validé**
  porte une donnée reliée si sa suppression effacerait des chiffres déjà
  comptés ailleurs :
  - rapport TPM validé : montant déclaré ≠ 0 **ou** au moins un poste
    (`contract_report_items`) — un rapport non applicable / vide n'a pas de donnée ;
  - plan validé : au moins un poste planifié ;
  - contrat validé : au moins un rapport, plan, visite ou avenant qui le référence.
  Un document **non validé** n'a jamais de « donnée reliée » au sens de la règle
  (il n'alimente aucun cumul) : il est supprimable après confirmation.
- **Journal append-only** : la table `document_deletions` n'accorde que
  `SELECT, INSERT` à `mems2_app` (aucune modification ni suppression d'une
  ligne de journal). Contrainte base : justificatif non vide si `validated`.

## Historique

### 14 octobre 2026

- **~10:00** 🔄 Analyse : retour 56 **non implémenté** dans le code (`main`).
  4 suppressions de documents repérées : rapports TPM (`reports.repository.deleteReport`),
  plans (`planning.repository.deletePlan`), contrats (`contracts.service.deleteDraft`),
  concepteur (`reports.repository.deleteDocument`). Statuts relevés :
  rapports `attendu/soumis/valide/rejete/non_applicable` ; plans `brouillon/valide` ;
  contrats `brouillon/en_validation/actif/rejete/resilie`.
- **~10:10** ✅ Module pur `common/deletionPolicy.js` + `test/deletionPolicy.test.js`
  (12 tests, verts). Règle commune, « validé » par type, justificatif nettoyé/borné.
- **~10:15** ✅ Migration `061_document_deletions.sql` : table-journal, RLS,
  `same_tenant` (deleted_by → users), **append-only** (REVOKE UPDATE/DELETE —
  un `ALTER DEFAULT PRIVILEGES` 002/012 accordait tout, d'où la révocation),
  CHECK justificatif-si-validé + CHECK doc_type.
- **~10:16** ✅ Vérification **en base réelle** (cluster PostgreSQL 16 jetable) :
  migrations 001→061 appliquées ; grants = `INSERT, SELECT` ; RLS active ;
  trigger `trg_same_tenant` présent ; 5 insertions test → CHECK OK
  (validé sans justif refusé, justif vide refusé, non validé OK, doc_type inconnu refusé).
- **~10:30** ✅ Module partagé `deletions/deletions.repository.js`
  (`recordDeletion` dans la tx appelante, `listDeletions`) + câblage des 3 suppressions :
  - rapports TPM (`reports.repository.deleteReport` + route : 409 donnée reliée, 400 justificatif) ;
  - plans (`planning.repository.deletePlan` + route) ;
  - contrats (`contracts.service.deleteDraft` généralisé : non validé supprimable,
    validé seulement sans rapport/plan/avenant/visite + justificatif).
  Endpoint `GET /api/deletions` (admin, filtre docType), monté dans `app.js`.
- **~10:45** ✅ Lint propre ; suite serveur **680/681** (0 échec, 1 ignoré ;
  +12 tests de la politique). Aucune régression.
- **~10:55** ✅ **Intégration de bout en bout** contre la base réelle, connecté
  comme `mems2_app` (RLS + append-only réellement exercés) : rapports / plans /
  contrats aux 4 cas (non validé → ok ; validé+donnée → 409 ; validé vide sans
  justif → 400 ; validé vide + justif → ok) ; journal = 5 entrées exactes ;
  `UPDATE`/`DELETE` du journal refusés à `mems2_app` (append-only confirmé).
- **~11:20** ✅ **Frontend** : composant commun `components/DeleteDialog.jsx`
  (confirmation ; justificatif obligatoire si validé ; affiche le refus serveur
  409/400 sans fermer). Branché sur **Rapports** (`ReportsPage`), **Planification**
  (`PlanningPage`) et **Contrats** (`ContractDetailPage`, bouton « Supprimer »
  nouveau — le flag serveur `actions.delete` passe de « brouillon seul » à
  « tout non validé », conforme à la politique). Client API `deleteReport/
  deletePlan/deleteContract` acceptent un justificatif ; `listDeletions` ajouté.
- **~11:25** ✅ Écran **« Paramétrage › Journal des suppressions »** (admin,
  `DeletionsSection`) : table date / type / document / statut / justificatif /
  auteur, filtre par type. Endpoint `GET /api/deletions` vérifié en base
  (5 entrées, filtre par type = 2 plans).
- **~11:30** ✅ Vérifications finales : `web build` OK ; serveur lint propre ;
  **680/681 tests** (0 échec). Prêt à pousser sur `claude/zealous-bardeen-p9ozcr`.

### 14 octobre 2026 (suite) — avenants

- **~11:50** ✅ **Suppression des avenants** (type `contract_amendment`) :
  `repo.deleteAmendment`, `service.deleteAmendment` (non validé → supprimable ;
  approuvé → appliqué au contrat = donnée reliée → refus 409), route
  `DELETE /api/contracts/:id/amendments/:amendmentId`, flag serveur
  `actions.canWrite`, client `api.deleteAmendment`, bouton « Supprimer » sur
  l'onglet Avenants (masqué pour un avenant approuvé), dialogue commun.
- **~11:55** ✅ Vérifs : serveur lint propre, **680/681 tests**, `web build` OK ;
  **intégration en base réelle** : avenant rejeté supprimé + journalisé,
  avenant approuvé refusé (« approuvé et appliqué »).

## État : ✅ terminé

Fait : politique pure testée · migration 061 (journal append-only) · câblage
rapports / plans / contrats / **avenants** + journal · endpoint et écran admin ·
dialogue frontend sur les 4 types. Hors périmètre (assumé) : concepteur de
rapport (aligné avec le lot 7a de la session principale).

---

# Retour 57 — plusieurs sites par site déclaré / commune (un par activité) + rapprochement GPS par shapefile

> Demandé par l'utilisateur le 14/10 (figurait dans la liste de tâches de la
> session principale). Analysé ici avant toute écriture.

## Constat d'entanglement (⚠️ différent du retour 56)

- Table `sites` : **une seule `activity`** (colonne texte), `gps_lat/lng`,
  `adm1–adm4`, `adm2_pcode/adm3_pcode`, `UNIQUE (tenant_id, code)`.
- Rapprochement des lieux = **par nom** (`common/placeMatch.js`, migrations
  045/050). **Aucun** PostGIS / géométrie / point-dans-polygone dans le dépôt.
- Les **contours/polygones** sont construits par le **lot 6a** (carte) de la
  session principale — en cours, non poussé.

Le retour 57 touche donc le **cœur du registre des sites** et recoupe les
**lots 2-3** (registre + import des sites) et **6a** (polygones) de la session
principale → **risque de conflit élevé** s'il est fait en parallèle sur une
autre branche. Décision demandée à l'utilisateur avant implémentation.

## Décision de l'utilisateur : « seulement la partie sûre »

Je livre uniquement le **socle PUR** du rapprochement GPS par shapefile, 100 %
additif (nouveaux fichiers dans `common/`, aucun changement de schéma `sites`,
rien touché dans `settings/` ni dans `shpReader.js` de la session principale).
La liaison aux contours (lot 6a), à `admin_areas` et le modèle « un site par
activité » sont **laissés à une réconciliation ultérieure**.

### Fait (14/10, ~12:30)

- `common/pointInPolygon.js` — point-dans-polygone pur (ray casting pair/impair,
  gère trous et archipels, indépendant du sens ESRI) + bbox. **9 tests.**
- `common/shpGeometry.js` — parseur `.shp` renvoyant les **anneaux complets**
  (polygone/polyligne), les points et multipoints, par enregistrement (ordre
  `.dbf`), variantes Z/M lues. Distinct de `settings/shpReader.js` (centroïdes)
  pour ne pas toucher au fichier de la session principale. **6 tests.**
- `common/gpsLocate.js` — `buildFeatures` / `locate` / `locateRef` / `locateAll`
  avec pré-filtre bbox ; rattache un point à son contour (commune / district),
  renvoie une `ref` opaque (pcode, index `.dbf`…). **7 tests.**
- Vérifs : lint propre, suite serveur **702/703** (+22), 0 échec.

### Reste (réconciliation avec la session principale, non fait ici)

- Stockage des contours (géométrie) — dépend du modèle du lot 6a.
- Branchement à l'import des sites / `admin_areas` (lots 2-3).
- Modèle « plusieurs sites par commune, un par activité » (schéma `sites`).
  → à faire quand les lots 2-3/6a seront poussés, pour éviter les conflits.

---

# Page de gestion des sites (Paramétrage › Sites) + attribution GPS

> Demande utilisateur (14/10) : page dédiée de gestion des sites (insertion,
> intégration…), liée ensuite à la planification. Colonnes : Identifiant,
> Localité, Code POI, Field_office(+code), Region/Adm1Code, District/Adm2Code,
> Commune/Adm3Code, Fokontany/Adm4Code, Activity_tag, Tag_code, Lat, Long —
> avec **attribution automatique de la zone depuis le GPS**.

## Décision d'architecture (clé de liaison) — demandée par l'utilisateur

Les **pcodes ne servent PAS de clé de liaison** (ils changent lors d'un
remaniement administratif). Clés retenues :
- **site ↔ découpage = `admin_area_id` (UUID stable)** ; les pcodes
  (`adm1..adm4_pcode`) sont des **attributs dérivés/affichés**, jamais la jointure ;
- **identité du site = UUID `id` + Code POI `location_id` (compteur stable L###,
  auto-généré)** ; jamais le `code` dérivé du nom ; la **planification se liera
  au site par son UUID**.
- Recommandation (réconciliation, non faite ici car cœur de l'autre session) :
  faire passer le rapprochement **soumissions ↔ sites de `adm3_pcode` à
  `admin_area_id`** pour survivre aux changements de pcode.

## Fait (backend, additif — fichiers neufs, invariant respecté)

- Migration `062_sites_tag_code.sql` : seule colonne manquante (`tag_code`).
  Toutes les autres colonnes existent déjà sur `sites`.
- `settings/sitesAdmin.repository.js` : liste complète (colonnes de la page,
  jointure `field_offices`), `createSite`/`updateSite`/`deleteSite`,
  `autoAttribute` (GPS → `admin_area_id` stable + noms adm1–4 ; les pcodes sont
  déduits par le pipeline par nom). **Écritures via `withSubmissionLinks` +
  `afterSitesChangedTx`** (réutilisés depuis `placeMatch.repository`, sans
  toucher au fichier) → invariant de concurrence respecté, pas de doublon.
- `settings/sitesAdmin.routes.js` monté sur `/api/site-registry` (chemin
  distinct, aucun risque d'ordre). GET/POST/PATCH/DELETE + POST /auto-attribute.
- Vérifs : lint propre, **711/712** tests ; **intégration en base réelle**
  (création → Code POI auto `L###` ; auto-attribution → commune depuis le GPS,
  `admin_area_id` stable posé, pcode `MG7101` seulement dérivé ; update ; delete).

## Fait (frontend)

- `web/src/pages/settings/SitesSection.jsx` (fichier neuf) : tableau avec toutes
  les colonnes (Identifiant, Localité, Code POI, Field office + code, Région /
  Adm1, District / Adm2, Commune / Adm3, Fokontany / Adm4, Activité, Code tag,
  Lat, Long), recherche, **« Nouveau site »** (modal), édition, suppression, et
  **« Attribuer depuis le GPS »** (appelle `/api/site-registry/auto-attribute`).
- Client API : `listSiteRegistry` / `createSiteRegistry` / `updateSiteRegistry` /
  `deleteSiteRegistry` / `autoAttributeSites`.
- Nav : nouvelle rubrique **« Paramétrage › Sites »** (groupe Géographie, admin).
- Vérifs : `web build` OK ; **couche HTTP testée** (supertest, base réelle) :
  POST 201 (Code POI `L002`), GET 200, auto-attribute 200 (commune depuis GPS),
  PATCH 204, DELETE 204, sans auth 401.

## Reste (suite possible, non bloquant)

- Import / export Excel au format exact des colonnes (gabarit téléchargeable) —
  à ajouter sur la même page.
- Attribution GPS en **point-dans-polygone** quand les contours (lot 6a) seront
  disponibles : il suffira de passer `features` à `geoAttribution` (déjà prévu).
- Modèle « un site par activité » et liaison planification par UUID du site.

