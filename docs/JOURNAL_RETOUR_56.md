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
