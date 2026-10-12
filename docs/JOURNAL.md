# Journal de bord — MEMS 2.0

> **But** : savoir à tout moment où en sont les choses. Chaque action est
> consignée ici **au moment où elle démarre, avance ou se termine**, avec
> l'heure (UTC), le commit et le résultat des vérifications. Le fichier est
> commité et poussé à chaque mise à jour (branche
> `claude/practical-meitner-2c1560`).
>
> Statuts : ⏳ à faire · 🔄 en cours · ✅ fait · ⛔ bloqué · ⏸️ en pause

---

## État courant

_Dernière mise à jour : 12/10/2026 06:36 UTC_

| # | Tâche | Statut | Détail / prochaine étape |
|---|---|---|---|
| 1a | Bureau : périmètre en cascade Région › District › Commune | ✅ | Livré le 09/10 (`34be945`) |
| 1b | PDD : bouton « Modèle PDD » + note de format | ✅ | `675b304` — à compléter avec les 47 en-têtes réels (voir PDD-config) |
| 2 | MMR : édition enrichie et plus simple | ✅ | API `4a481eb` + écran `4dd6f77` |
| 3 | Localités : pays & découpage, répertoire, CRUD | 🔄 | Phase 1 en cours : correctif import (nom vs P-code), profil pays & vocabulaire, répertoire paginé + filtres + export, CRUD. Phase 2 : contours cartographiques |
| 4 | Langue FR/EN : traduire le contenu des pages | ⏳ | Aujourd'hui seul le menu change de langue |
| 6 | Concepteur de rapport professionnel (bulletin éditable, modèles) | ⏳ | Références : rapport de suivi de performances (HTML), couverture par partenaire (.docx), dashboard (HTML) |
| 7 | Plan de suivi « type Excel » + carte détaillée | ⏳ | Référence : classeur RBM + captures (KPI, modes, grille des mois, carte) |
| PDD-config | PDD : rations, planification par commune, stock par donateur (TDD/BDD), calcul serveur des tonnages | ⏳ | Découvert dans le PDD réel `PDD_Urgence_Oct-Nov_04082025.xlsx` |
| Import | Import facile multi-sources + lien Tableau WDC (MoDA/Ona, Kobo) | ⏳ | Faisabilité **confirmée** (voir 06:20) |
| Facture | Fidélité de la facture au gabarit de mai + Invoice 09 | ⏳ | |
| Analyse | Analyse multi-agents des documents de référence → feuille de route | 🔄 | 3e lancement à 06:31 (8 familles : RBM, XLSForm, Kobo suivi, Kobo distribution, finance, rapports, PDD, import/WDC) |

---

## Historique

### Lundi 12 octobre 2026

- **05:59** 🔄 Reprise du travail de la session précédente (autre compte). Les 77 commits du 1er au 9/10 sont bien sur `main`.
- **06:00** ✅ Vérification de l'état : 136 tests serveur OK, lint OK, build web OK.
- **06:01** ✅ Document de synthèse `docs/ETAT_DU_PROJET.md` (fait / reste à faire) — `69a5ee5`.
- **06:02** 🔄 Tâche 1b — modèle PDD.
- **06:04** ✅ Bug corrigé au passage : l'aléa « Sécheresse » (accentué) était classé « autre » à l'import PDD.
- **06:05** ✅ Tâche 1b livrée — `675b304` : `GET /api/pdd/template.xlsx`, bouton « Modèle PDD », état vide guidé, feuille « Lisez-moi », lignes vides plus comptées « ignorées ». 138 tests OK, vérifié dans le navigateur.
- **06:06** 🔄 Tâche 2 — MMR.
- **06:08** 📥 Réception des documents de référence (classeur RBM, XLSForms, exports Kobo, contrat FLA, factures, planning, rapports HTML/DOCX).
- **06:10** ✅ Découverte dans le classeur RBM : valeurs « CO adjusted » (fréquence et intervalle ajustés à la capacité) absentes de MEMS → ajoutées à `mmrMath` (calcul sur valeurs exactes, comme Excel).
- **06:13** ✅ API MMR — `4a481eb` : enregistrement groupé transactionnel, référentiel de sites, export/import Excel (lit **directement la feuille « Overreaching Parameters » du classeur RBM réel**). 146 tests OK.
- **06:15** 🔄 Lancement de l'analyse multi-agents des références (interrompue à 06:18 par une interruption de la conversation).
- **06:17** 📥 PDD réel reçu (`PDD_Urgence_Oct-Nov_04082025.xlsx`) : notre import le lit (491 distributions, 5 mois) ; il révèle la « configuration » manquante (rations, planification, stock par donateur) → nouvelle tâche **PDD-config**.
- **06:20** ✅ **Lien Tableau WDC : faisabilité confirmée.** Le lien MoDA `…/tableau-web-data-connector/<uuid>` repose sur l'API Ona `GET /api/v2/open-data/<uuid>/schema` et `/data` (publique, l'uuid sert de clé ; pagination ; filtre `gt_id` pour le rafraîchissement incrémental ; groupes répétés en tables liées par `__parent_id`). MEMS peut la lire sans exécuter le JavaScript du WDC. Limite : `moda.wfp.org` n'est pas joignable depuis Internet public (réseau interne) — le test réel devra se faire depuis votre serveur. `kobo-wdc` (GitHub) = simple relais vers l'API Kobo avec token (il journalise le token : à ne pas reproduire).
- **06:26** ✅ Tâche 2 livrée — `4dd6f77` : grille MMR éditable type tableur (héritage plan général → dérogation bureau, modification groupée, nb sites ↔ référentiel, import du classeur RBM, enregistrement en un lot). Vérifié dans le navigateur : 0 erreur console/API.
- **06:27** 🔄 Relance de l'analyse multi-agents (ajout du PDD réel et des faits WDC) — de nouveau interrompue par une interruption de la conversation.
- **06:28** 🔄 Tâche 3 — Localités : étude de l'existant.
- **06:30** ✅ Création de ce journal (`docs/JOURNAL.md`) + règle ajoutée dans `CLAUDE.md`.
- **06:31** 🔄 3e lancement de l'analyse multi-agents (en arrière-plan).
- **06:34** ✅ Cause du problème « Localités » identifiée : l'import d'un shapefile prend la colonne `ADMn_PCODE` comme nom de niveau et comme nom de localité (d'où « ADM0_PCODE… » et des localités nommées par leur code). Le modèle ne stocke ni P-code, ni GPS, ni pluriel, ni profil pays.
- **06:36** 🔄 Tâche 3 phase 1 : migration 041 (P-code, GPS, lignée, profil pays, libellés pluriels), correctif d'import, répertoire + CRUD.

> ℹ️ **Astuce** : une interruption (bouton « stop ») arrête aussi les analyses qui tournent en arrière-plan. Pour ajouter une information sans les arrêter, envoyez simplement un message — il est pris en compte sans interrompre.
