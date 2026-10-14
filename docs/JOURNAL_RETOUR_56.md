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
