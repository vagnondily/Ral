# MEMS 2.0 — État du projet (fait / reste à faire)

_Mise à jour : 12 octobre 2026 — branche `main` (commit `34be945`)._

## Santé du code au moment de la reprise

| Contrôle | Résultat |
|---|---|
| Tests serveur (`cd server && npm test`) | **136 / 136 OK** |
| Lint serveur (`npm run lint`) | **propre** |
| Build web (`cd web && npm run build`) | **OK** (avertissement de taille de bundle uniquement) |
| Migrations | `001` → `040` |

---

## Ce qui a été fait (1er → 9 octobre, 77 commits)

### Contrats, rapports et budget TPM
- **Rapports** : liste façon COMET, rapport et facture combinés, suppression, vue en USD.
- **Rapports** : gabarits mensuels générés automatiquement selon la durée du contrat, avec un statut « non applicable ».
- **Rapports** : période placée dans la barre de filtres, colonnes Période et N° facture ajoutées.
- **Planification & budget** : liste COMET, déplacée dans le groupe TPM.
- **Fil guidé du rapportage** : Plan validé → Facture (pré-remplie depuis le plan) → Validation → Consolidation.
- **Contrats** : prévision de dépense jusqu'à la fin du contrat ou sur une période donnée.
- **Paramétrage › Taux de change** : la conversion en USD fonctionne de bout en bout.

### Suivi terrain, RBM et Plan de suivi (MMR)
- **RBM** : scoring multicritère (FINAL SCORE + Priorité) fidèle au Plan de suivi, colonnes fidèles au classeur, filtre par bureau.
- **RBM** : import complet du Plan de suivi (critères, score, GPS, activité), page alignée sur le patron COMET.
- **MMR** : paramètres généraux du classeur repris tels quels (Overarching parameters).
- **MMR** : capacité faisable calculée (personnes × suivis par jour et par activité × jours ouvrés).
- **MMR** : un seul plan général, que chaque bureau peut ajuster (dérogation).
- **Affectation & visites** : écran unique, l'ancien écran nominatif a été retiré du menu.
- **Affectation & visites** : navigation par **tableau des mois** puis plan du mois, avec la situation du workflow.
- **Données réelles → site** : rattachement par pcode de commune (migration 036). On voit la colonne « Dernière collecte (données) » et un onglet « Données réelles ».
- **Carte des sites** : Leaflet sur fond OpenStreetMap, avec une couche choroplèthe par district.

### Suivi de processus (données Kobo / ONA)
- Import de **définition XLSForm**, parseur **SPSS `.sav`** natif et import **`.zip` Kobo**.
- **Connecteur « lien de données » ONA / MoDA** (export web, sans API), qui suit la pagination.
- Fiches présentées en tableau, avec un détail en 5 onglets : Variables, Données importées, Résultats, Mapping MEMS, Configuration.
- **Données importées** :
  - en-têtes figés et libellés issus du XLSForm ou du `.sav` ;
  - sélecteur de colonnes et sélection multiple ;
  - filtres par bureau, zone administrative et date.
- **Mapping MEMS** éditable : on peut corriger à la main ce que l'auto-détection propose.
- **Nettoyage des données** : champs calculés (comme dans Tableau) et exclusion ou curation de soumissions.
- **Indicateurs** : liste riche avec drawer de détail (implémente la maquette de la PR #2), écran guidé, regroupement.

### Tableaux de bord
- **Suivi de processus › Tableau de bord** relié aux données réelles.
- **Dashboard › Couverture & performance du suivi** (nouveau) :
  - KPI, bande de conformité en 5 niveaux, Plan vs Réalisé ;
  - un onglet par activité ;
  - noms de région en clair ;
  - vues **Salle de contrôle**, **Bulletin** (texte généré automatiquement) et **Carte SVG de Madagascar**, sans dépendance externe.
  - La logique est pure et testée (`coverageDashboard.js`, 9 tests).

### Distribution d'urgence (PDD)
- Nouveau module : distributions, synthèse et pipeline (besoin vs stock), import de la feuille « PDD base », navigation par mois.

### Paramétrage et sécurité
- Vue d'ensemble en cartes, page **Utilisateurs & accès**.
- **Bureaux & antennes** : périmètre défini en communes, sites rattachés automatiquement, hiérarchie du Grand Sud corrigée.
- **Sélecteur de périmètre** en cascade Région › District › Commune.
- **Durcissement** :
  - validation de la configuration au démarrage ;
  - limitation des tentatives de login (Redis, avec repli en mémoire) ;
  - CORS restreint.
- **Correctif** : le login ne bloque plus quand `REDIS_URL` est défini mais que Redis est absent.

### UI et design system
- Modernisation des tokens et composants (look web-app 2025), mode sombre plus lisible.
- Statuts affichés avec couleur, icône et libellé (accessibilité).
- Composant de liste réutilisable `DataList` (format COMET).
- Défilement horizontal propre sur les tableaux.
- Interrupteurs icône seule (FR|EN, jour/nuit, Aides) et bascule globale des **Aides**.

### Données de démonstration
- `npm run seed:test` : jeu de données varié.
- Seed avec les **vraies données** du Plan de suivi et d'un export Kobo.

---

## Ce qui reste à faire (liste de tâches de la session précédente)

| # | Tâche | Contenu prévu |
|---|---|---|
| 1b | **PDD : bouton « Modèle PDD »** | Télécharger un classeur `.xlsx` vierge au format exact attendu par l'import « PDD base », avec une note expliquant le format |
| 2 | **MMR : édition enrichie et plus simple** | Éditer les paramètres du Plan de suivi plus confortablement (grille en ligne, validations, aperçu de la capacité) |
| 3 | **Localités : édition / CRUD** | Créer, modifier et supprimer les localités adm1 à adm4 dans Paramétrage, en plus de l'import |
| 4 | **i18n FR/EN** | Traduire les pages, en commençant par les plus utilisées (menu, tableaux de bord, listes) |
| 6 | **Concepteur de rapport** | Bulletin éditable (le texte généré sert de point de départ) + modèles de rapport réutilisables |
| 7 | **Plan de suivi « type Excel »** | Grille éditable + import/export `.xlsx` en aller-retour |

### Points techniques mineurs
- `web/` n'a toujours ni lint ni tests automatisés. On contrôle avec le build et un balayage Playwright.
- Le bundle web dépasse 500 kB : on pourrait découper le code (`import()` dynamique par page).
- `web/src/pages/AssignmentPage.jsx` n'est plus utilisé et pourra être supprimé.
- `CLAUDE.md` est à rafraîchir : nombre de tests, liste des migrations, nouveaux modules.

---

_Ce document est mis à jour au fil des livraisons ; chaque tâche terminée y est cochée avec son commit._
