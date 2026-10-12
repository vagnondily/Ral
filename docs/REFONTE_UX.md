# Spécification finale : refonte de la navigation, des liaisons entre pages et du module Partenaires & TPM (MEMS 2.0)

> **Base retenue.** Proposition 3, « le site au centre ». Elle obtient la meilleure note des deux jurys : 87/100 sur l'usage, 76/100 sur la fiabilité et la migration.
> **Idées reprises des autres propositions :**
> - de la proposition 1 (« parcours ») : les alertes et la boîte « à valider » sont calculées côté serveur, chaque donnée a une page propriétaire (`owns`), une valeur affichée en lecture porte son origine (`SourceTag`), les indicateurs de qualité sont calculés sur chaque formulaire, la méthode de notation est versionnée, simulable et figée à la validation, la fréquence selon le risque devient réglable, les formations sont détaillées (présence par jour, plusieurs épreuves) ;
> - de la proposition 2 (« profils ») : les filtres passent dans l'adresse, un test des redirections tourne sans dépendance, Plan de suivi et Affectation deviennent une seule page Visites (vues Année et Mois), les agents se créent depuis la file de rapprochement, les droits sur les agents passent à « écriture » pour le responsable S&E, les tâches sont filtrées selon le rôle existant.
>
> **Corrections demandées par les jurys :**
> - le calcul des alertes ne reste pas dans le navigateur ;
> - la version de la méthode de notation est conservée pour l'audit ;
> - aucune fonction n'est retirée avant que sa remplaçante soit livrée ;
> - un nom de collecte n'est unique qu'à l'intérieur d'un même prestataire ;
> - la fréquence selon le risque a sa table ;
> - le double-clic actuel des contrats est conservé.
>
> **État du dépôt pris en compte (12/10/2026).** Les lots 0, 1 et 2 de `docs/ANALYSE_LIAISONS.md` sont livrés : `cf0c46b` (lot 0, en relecture adverse), `afe463e` (lot 1) et `4c22775` (`placeMatch.js`). La constante du « Réalisé » existe : `REALISED_STATUS` dans `server/src/modules/tpm/realised.js`. La dernière migration est 047, et les numéros 048 à 052 sont réservés par l'analyse.
>
> **Conventions de nommage.** Les lots de ce document s'appellent **A à M**, pour ne pas les confondre avec les lots 0 à 10 de l'analyse des liaisons (notés **AL-n**) ni avec la feuille de route R0 à R13 de `docs/ANALYSE_REFERENCES.md` (notée **AR-Rn**).

---

## 0. En bref, pour le responsable S&E

1. **Le menu suit les objets du métier**, et non plus les modules techniques. Il compte 6 groupes et 24 entrées, contre 31 sous-menus aujourd'hui. Le groupe central est **« Sites & localités »**.
2. **Chaque site, chaque localité, chaque partenaire, chaque agent, chaque fiche de suivi et chaque contrat a sa fiche.** Une fiche réunit tout ce qui le concerne. Partout dans l'application, un nom cliquable ouvre la fiche correspondante.
3. **Une donnée se saisit à un seul endroit.** Ailleurs, elle s'affiche en lecture avec un lien « Modifier dans … ». Il n'y a donc plus de double saisie ni d'écran en double.
4. **Aucun réglage n'est invisible.** Un bandeau « D'où viennent ces informations ? » en haut de chaque page indique quels réglages elle utilise, s'ils sont prêts ou à compléter, et ouvre directement le bon écran. La page Réglages › Vue d'ensemble affiche un tableau « prêt / à compléter » de toute la configuration.
5. **Une page d'Accueil compréhensible en 5 secondes** : 4 chiffres du mois, 5 choses à faire au plus, les 5 étapes du mois (Planifier, Affecter, Collecter, Contrôler, Payer) et une recherche.
6. **Partenaires & TPM :**
   - la fiche prestataire montre son vrai parcours : contrats, missions, sites, formulaires, factures, équipe, formations, performance ;
   - les formations s'organisent en sessions, avec participants, présence, pré-test et post-test ;
   - chaque agent reçoit une **note automatique** calculée d'après ses formulaires, selon une méthode que vous réglez, puis une **appréciation qualitative** de son superviseur. Les deux donnent la note finale.
7. **Livraison en 13 lots indépendants**, du moins risqué au plus lourd. Les anciennes adresses restent valides : elles sont redirigées.
8. **Les décisions qui vous reviennent** sont listées en section 8, chacune avec une valeur recommandée par défaut.

---

## 1. Principes retenus

1. **Le lieu est la base.** Visites, formulaires reçus, distributions et zones de contrat se rattachent à un site, ou à une localité par son code officiel. La fiche site et la fiche localité rassemblent tout.
2. **Une fiche par objet métier**, toutes sur le même gabarit. Tout nom d'objet affiché est un lien (`ObjectLink`) produit par une seule fonction, `routeFor(kind, id)`.
3. **Une donnée, une page propriétaire.** La page propriétaire est déclarée dans le registre `routes.js` (`owns`) et elle est la seule à écrire. Ailleurs, la donnée est en lecture, avec sa source (`SourceTag`) et un lien « Modifier dans … ». Une liste affichée dans une fiche est **le même composant** avec un filtre verrouillé, jamais une seconde implémentation.
4. **Aucun paramètre invisible.** Chaque page déclare ses prérequis (`deps`) et affiche leur état, calculé par `/api/settings/health`. Un prérequis manquant ne s'affiche jamais comme une cellule vide, un « — » ou un « 0 » : il s'affiche « Non réglé · Régler → ». Chaque réglage affiche en retour « Utilisé par ».
5. **L'essentiel d'abord.** Une page répond à une seule question. Elle montre au plus 4 chiffres et un seul bouton principal. Le détail est à la demande : onglets, bouton « Voir », « Plus de filtres », « Plus d'options ». Les codes techniques (pcode, variables, valeurs brutes) sont toujours dans le dernier onglet.
6. **Des mots simples.** Priorité (au lieu de RBM), Exigences de suivi (MMR), Prestataire de suivi (TPM), Formulaires reçus (soumissions), Code officiel (pcode). Le sigle reste disponible en infobulle. Aucun « WFP » ni « PAM » n'apparaît.
7. **Un chiffre, une définition, côté serveur.** Réalisé (`realised.js`), couverture (`fieldMath`), « à suivre » (`rbmMath` avec les exigences de suivi et la fréquence selon le risque), tâches et alertes (`tasks.domain.js`), état de la configuration (`healthRules.js`) : chacun est calculé une seule fois sur le serveur et lu par toutes les pages. Aucune page ne recalcule un statut dans le navigateur.
8. **Rien n'est perdu ni cassé.**
   - Chaque ancienne adresse est redirigée, les redirections étant conservées sans limite de durée.
   - Aucune fonction n'est retirée avant que son écran de remplacement soit livré et vérifié.
   - Aucune migration n'est destructive : les anciennes tables restent en lecture.
9. **Une liaison n'est déclarée « OK » que si elle repose sur un code ou un identifiant.** Une liaison par nom, approximative ou absente est signalée avec le nombre de lignes concernées et un lien vers « Qualité des données ».
10. **Les règles du projet s'appliquent à chaque lot :**
    - toute écriture de plus d'une instruction passe par `withTenantTransaction` ;
    - la validation se fait avec zod à l'entrée et par des contraintes `CHECK`, `UNIQUE` et `FK` en base ;
    - la logique métier est dans des modules purs et testés ;
    - l'agrégation se fait en SQL, et les écritures en lot en une seule instruction multi-lignes ;
    - les recalculs lourds passent par l'outbox et le worker ;
    - toute nouvelle table a `tenant_id`, la RLS `tenant_isolation` et un `GRANT` au rôle `mems2_app`. On ne touche jamais au rôle `mems_app` ;
    - le tenant vient uniquement de `req.auth`.

---

## 2. Menu cible et redirections

### 2.1 Grammaire des adresses

`#/<groupe>/<page>[/<a>[/<b>]][?query]`
- `a` peut être :
  - un **uuid**, qui ouvre une fiche (et `b` est alors l'onglet de la fiche) ;
  - un **mot-clé** de création (`nouveau`, `nouvelle`) ;
  - un **onglet** de la page (`carte`, `tableau`…).
- La `query` porte les filtres et le contexte (`?mois=2026-10&prestataire=<id>`). `DataList` la reçoit comme valeurs initiales, si bien qu'un lien ouvre une liste **déjà filtrée**.
- Le mois de travail est partagé par toutes les pages (`MonthContext`, porté par `?mois=` et mémorisé en sessionStorage avec try/catch).
- Le module `contrats` garde son identifiant, donc toutes les adresses de contrats restent identiques.

### 2.2 Menu (6 groupes, 24 entrées, deux niveaux seulement)

La barre latérale reste claire. Chaque groupe a une icône lucide. L'entrée active est une pilule bleu-50. En barre repliée, l'icône de groupe ouvre un menu flottant.

**Pilotage** (icône `LayoutDashboard`)

| Entrée | Adresse | À quoi sert la page |
|---|---|---|
| Accueil | `#/pilotage/accueil` | Voir d'un coup d'œil où en est le mois et ce qu'il faut faire maintenant. |
| À traiter | `#/pilotage/a-traiter` (onglets `/valider`, `/alertes`, `/reglages`) | Tout ce qui attend une action : validations, risques, réglages incomplets. Chaque ligne a un bouton « Voir ». |
| Tableau de bord | `#/pilotage/tableau-de-bord` (`/synthese`, `/activite/:formId`, `/controle`) | Comprendre la situation du suivi : couverture, formulaires reçus, conformité par activité et par zone. |
| Rapports | `#/pilotage/rapports` (`/:docId`, `?modele=`) | Produire, imprimer et archiver les rapports à partir de modèles prêts (synthèse du mois, bulletin, budget, couverture, distributions). |

**Sites & localités** (icône `MapPin`)

| Entrée | Adresse | À quoi sert la page |
|---|---|---|
| Sites | `#/sites/liste` (`?vue=liste\|carte\|priorites` ; fiche `/:siteId/:onglet`) | Retrouver un site, voir sa priorité et sa dernière visite, puis l'ouvrir pour tout voir. |
| Localités | `#/sites/localites` (fiche `/:areaId/:onglet` ; `/decoupage` réservé à l'administrateur) | Parcourir régions, districts et communes, puis ouvrir une commune pour voir ses sites, visites, formulaires et distributions. |
| Visites | `#/sites/visites` (`/annee/:aaaa`, `/mois/:aaaa-mm`) | Planifier l'année, puis organiser le mois : affecter, dater, suivre la réalisation. |
| Couverture | `#/sites/couverture` (`?vue=mois\|sites\|activites\|prestataires`) | Vérifier que les sites ont été visités autant qu'exigé. |

**Données collectées** (icône `ClipboardCheck`)

| Entrée | Adresse | À quoi sert la page |
|---|---|---|
| Fiches de suivi | `#/donnees/fiches` (fiche `/:formId/:onglet`) | Les formulaires Kobo/ODK : résultats des indicateurs, formulaires reçus, sites, agents, réglages. |
| Formulaires reçus | `#/donnees/formulaires` (`?mois=&fiche=&commune=&prestataire=&agent=&etat=`) | Tous les formulaires arrivés, filtrables. On y importe aussi de nouvelles données. |
| Qualité des données | `#/donnees/qualite` (`/lieux`, `/agents`, `/ecartes`, `/correspondances`) | Corriger ce que les imports n'ont pas reconnu (lieux, bureaux, agents) et revoir les formulaires écartés. |
| Distributions d'urgence | `#/donnees/distributions` (`/synthese`, `/stock`) | Le plan de distribution (vivres et cash) par zone et par mois, comparé au stock. |

**Partenaires & TPM** (icône `Handshake`)

| Entrée | Adresse | À quoi sert la page |
|---|---|---|
| Partenaires | `#/partenaires/liste` (onglets `/tpm` par défaut, `/ong`, `/autres`, `/tous`, `/types` ; fiche `/:partnerId/:onglet`) | Tous les partenaires, avec pour chacun une fiche complète. Pour un prestataire de suivi : son parcours, son équipe et sa performance. |
| Agents & évaluation | `#/partenaires/agents` (`/methode`, `/historique` ; fiche `/:agentId/:onglet`) | Les agents de terrain, leur note automatique du mois, leurs évaluations et leurs formations. |
| Formations | `#/partenaires/formations` (`/themes` ; session `/:sessionId/:onglet`) | Organiser les sessions, noter la présence et mesurer les acquis (pré-test et post-test). |

**Contrats & budget** (icône `FileSignature`)

| Entrée | Adresse | À quoi sert la page |
|---|---|---|
| Contrats | `#/contrats/liste` (`/nouveau`, `/:id`, `/:id/edit`, `/:id/amend` : inchangés) | Les accords et leurs avenants. La fiche montre budget, zones, sites couverts, plans et factures. |
| Plans de collecte | `#/contrats/plans` (`/:planId`, `?mois=&prestataire=&statut=`) | Le budget prévu de la collecte par prestataire, contrat et mois. Il sert de base à la facture. |
| Factures & rapports | `#/contrats/factures` (`/nouvelle?prestataire=&contrat=&mois=`, `/:reportId`) | Recevoir, vérifier et valider les factures et les rapports techniques mensuels. |
| Suivi budgétaire | `#/contrats/budget` (`/tableau` par défaut, `/graphiques`, `/mois` ; `?du=&au=`) | Budget, prévu et réalisé par contrat : consommation, écarts, projection de fin. |

**Réglages** (icône `Settings`)

| Entrée | Adresse | À quoi sert la page |
|---|---|---|
| Vue d'ensemble | `#/reglages/apercu` | Le tableau « prêt / à compléter » de toute la configuration, avec un lien vers chaque réglage. |
| Activités & exigences | `#/reglages/activites` (`/exigences`, `/frequences`) | Activités des contrats, exigences minimales de suivi par bureau et activité, fréquence de suivi selon le niveau de risque. |
| Bureaux & antennes | `#/reglages/bureaux` (`/:officeId`) | Bureaux, antennes et communes qu'ils couvrent. Ce périmètre rattache automatiquement sites et données. |
| Pays & devises | `#/reglages/pays` (`/taux`) | Profil pays (devise, centre de la carte) et taux de change datés. |
| Utilisateurs & accès | `#/reglages/utilisateurs` | Comptes, rôles, activation. Réservé à l'administrateur. |

**Réglages logés ailleurs.** Certains réglages vivent près de leur usage tout en restant listés dans Réglages › Vue d'ensemble, avec lien et état :
- Découpage administratif → Localités › Découpage ;
- Types de partenaire → Partenaires › Types ;
- Méthode de notation → Agents & évaluation › Méthode ;
- Thèmes de formation → Formations › Thèmes ;
- Réglages d'une fiche (indicateurs, rattachement à l'activité, correspondances, champs calculés) → fiche de suivi › Réglages.

**Hors menu.**
- La recherche globale (Ctrl+K dans l'en-tête) porte sur les sites, localités, partenaires, agents, contrats et fiches.
- La cloche affiche le compteur de « À traiter ».
- Le menu du compte (langue, thème, Réglages, déconnexion) est inchangé, sauf que Réglages ouvre `#/reglages/apercu`.

### 2.3 Table des redirections

Mise en œuvre :
- table `REDIRECTS` de `web/src/lib/routes.js`, appliquée avec `history.replaceState` ;
- segments supplémentaires et `query` conservés ;
- couverture vérifiée par `web/src/lib/routes.test.mjs`.

**Les 31 entrées actuelles du menu**

| Adresse actuelle | Nouvelle adresse | Remarque |
|---|---|---|
| route par défaut (`DEFAULT_ROUTE` = contrats/liste) | `#/pilotage/accueil` | À partir du lot C. Jusque-là, la route par défaut ne change pas. |
| `#/contrats/liste` et `/nouveau`, `/:id`, `/:id/edit`, `/:id/amend` | identiques | La fiche contrat gagne les onglets « Plans & factures » (lot E) et « Zones & sites » (lot H). Le nom du partenaire devient un lien. |
| `#/tpm/prestataires` | `#/partenaires/liste/tpm` | Supprime le cas « `route.sub === 'prestataires'` quel que soit le module » (App.jsx). |
| `#/tpm/formations` | `#/partenaires/formations` | Les anciennes lignes par agent sont reprises en sessions (lot F). |
| `#/tpm/evaluation` | `#/partenaires/agents` | Ne lit plus l'ancien modèle `tpm_assignments`. |
| `#/tpm/budget` | `#/contrats/plans` | PlanningPage et PlanBudgetDrawer sont réutilisés. |
| `#/tpm/rapports` | `#/contrats/factures` | ReportsPage, FactureDrawer, GuidedFlow et les exports xlsx/PDF sont inchangés. |
| `#/tpm/affectation` (redirection existante) | `#/sites/visites/mois` | Cible mise à jour. |
| `#/processus/synthese` | `#/pilotage/tableau-de-bord/synthese` | |
| `#/processus/donnees` | `#/donnees/fiches` | |
| `#/processus/sites` | `#/sites/visites/mois` | FieldVisitsPage : tableau des mois, puis le mois choisi. |
| `#/processus/plan` | `#/sites/visites/annee` | PlanBoardPage (grille des mois, exercice). |
| `#/processus/rbm` | `#/sites/liste?vue=priorites` | Vue préréglée : risque, score, à suivre, dernière visite, dernière collecte. |
| `#/processus/couverture` | `#/sites/couverture?vue=sites` | CoverageRecapPage. |
| `#/processus/carte` | `#/sites/liste?vue=carte` | Carte unique (`SitesMap`). |
| `#/pdd/distributions` | `#/donnees/distributions` | PddPage, vue distributions. |
| `#/pdd/synthese` | `#/donnees/distributions/synthese` | |
| `#/pdd/pipeline` | `#/donnees/distributions/stock` | Libellé « Stock (pipeline) ». |
| `#/dashboard/apercu` | `#/contrats/budget/graphiques` | Graphiques de DashboardBIPage. La carte « Couverture terrain » passe dans Tableau de bord. |
| `#/dashboard/consolidation` | `#/contrats/budget/tableau` | ConsolidationPage, export CSV conservé. |
| `#/dashboard/couverture` | `#/pilotage/tableau-de-bord` | Voir les vues internes plus bas. |
| `#/reporting/synthese` | `#/pilotage/rapports?modele=synthese-mois` | Jusqu'au lot D, ReportingPage reste montée en onglet « Synthèse rapide ». |
| `#/reporting/concepteur` | `#/pilotage/rapports` | ReportDesignerPage. |
| `#/alertes/centre` | `#/pilotage/a-traiter/alertes` | |
| `#/parametrage/apercu` | `#/reglages/apercu` | |
| `#/parametrage/partenaires` | `#/partenaires/liste/tous` | Une seule liste de partenaires (voir section 3). |
| `#/parametrage/types` | `#/partenaires/liste/types` | Onglet réservé à l'administrateur. |
| `#/parametrage/activites` | `#/reglages/activites` | |
| `#/parametrage/taux` | `#/reglages/pays/taux` | |
| `#/parametrage/localites` | `#/sites/localites/decoupage` | Le profil pays part dans `#/reglages/pays`. |
| `#/parametrage/bureaux` | `#/reglages/bureaux` | |
| `#/parametrage/mmr` | `#/reglages/activites/exigences` | L'édition reste réservée à l'administrateur. |
| `#/parametrage/utilisateurs` | `#/reglages/utilisateurs` | |

**Vues internes, modales et transferts**

| Élément actuel | Nouvelle place | Remarque |
|---|---|---|
| PlanBoardPage › vues « Plan » et « Déjà visités » | `#/sites/visites/annee` (`?vue=plan\|visites`) | |
| PlanBoardPage › vue « Registre (standard) » | `#/sites/liste` | **Retirée au lot G seulement**, quand Sites a la sélection multiple et la modification groupée. |
| PlanBoardPage › vue « Carte » | `#/sites/liste?vue=carte` | Même règle : retirée au lot G. |
| PlanBoardPage › « Ajouter un site », « Modification groupée » | Sites (bouton « Ajouter un site », sélection puis « Modifier la sélection ») | Mêmes points d'accès (`/plan-board/sites`, `/plan-board/bulk`), regroupés derrière `SiteForm`. |
| PlanBoardPage › Gabarit, Export et Import « Locations » | Sites › menu Importer/Exporter (assistant unique) | L'import Locations écrit des sites **et** des visites : le compte rendu donne les deux nombres. Visites › Année affiche un lien vers cet assistant. |
| RbmPage › modale « Critères de risque » | fiche site › onglet **Priorité** | Même `PATCH /api/tpm/field/sites/:id` (mise à jour partielle corrigée au lot 0, H5). |
| RbmPage › imports « Master Data » et « Plan de suivi » | Sites › Importer (assistant unique, modèle reconnu par ses en-têtes) | Points d'accès `/rbm/import` et `/rbm/import-plan` conservés. |
| RbmPage › bouton « Générer » | Visites › Mois › « Planifier les sites à suivre de <mois> » | Une seule façon de planifier depuis les priorités. |
| FieldVisitsPage › modale « Nouveau site » | `SiteForm` (tiroir), ouvert par « Créer le site » | Plus aucune création de site hors du registre. |
| FieldVisitsPage › « Importer planning » | Visites › Mois › Importer (même assistant, filtré sur les modèles de visites) | Même composant que dans Sites, ce n'est pas un second écran. |
| FieldVisitsPage › onglet « Couverture & budget » | Couverture `?vue=mois` (chiffres et cartes) et Visites › Mois › panneau « Jours à budgéter » | |
| FieldVisitsPage › onglet « Données réelles » | `#/donnees/formulaires?mois=` | Même point d'accès (`GET /api/monitoring/submissions?month=`). |
| ProcessMonitoringPage › onglets Variables, Données importées, Résultats, Mapping, Configuration, Champs calculés | fiche de suivi `/:formId/` + `variables`, `formulaires`, `resultats`, `reglages` | « Mapping » devient la section « Lieux et référentiels » de l'onglet Réglages, avec le taux de reconnaissance. |
| DashboardCoveragePage › Synthèse, Par activité, Salle de contrôle | `#/pilotage/tableau-de-bord/{synthese,activite/:formId,controle}` | |
| DashboardCoveragePage › Carte | `#/sites/liste?vue=carte&couche=couverture` | |
| DashboardCoveragePage › Bulletin | `#/pilotage/rapports?modele=bulletin` | Retirée seulement après vérification de parité (lot D). |
| ProvidersPage › modale « Agents de terrain » | `#/partenaires/liste/:id/equipe` | |
| SettingsPage › modale « Nouvel agent » (SettingsPage.jsx:582) | supprimée, remplacée par fiche partenaire › Équipe | Il ne reste qu'un seul endroit de saisie des agents. |
| FormationsPage › modale « Formations — agent » | fiche agent › onglet Formations | |
| EvaluationPage › modale « Évaluation — agent » | fiche agent › onglet Évaluations | |
| `sessionStorage['mems.tpm.newFacture']` (PlanningPage.jsx:166, ReportsPage.jsx:110) | `#/contrats/factures/nouvelle?prestataire=&contrat=&mois=` | L'ancienne clé est encore lue pendant une version. |
| LocalitiesSection › profil pays | `#/reglages/pays` | Il prend enfin effet (B1) : devise des montants, centre de la carte. |
| Cloche de l'en-tête (toujours vide, HeaderMenus.jsx:40) | compteur de `#/pilotage/a-traiter` | Voir 5.2. |
| Menu du compte › Paramétrage | `#/reglages/apercu` | |
| `GET /api/tpm/agents-evaluation` (lit `tpm_assignments`) | `GET /api/evaluation/scores?mois=` | L'ancien point d'accès est conservé une version, puis retiré au lot M. |
| `AssignmentPage.jsx`, `MissionCalendarDrawer.jsx`, `contracts/ContractFormDrawer.jsx` (code mort, B13) | supprimés (lot A) | Tables `tpm_assignments` et `tpm_mission_days` conservées. |

---

## 3. Écrans fusionnés et pourquoi

| Écrans actuels | Écran cible | Pourquoi |
|---|---|---|
| Risk-Based Monitoring, Carte des sites, Plan de suivi (vues Registre et Carte), Couverture & performance (vue Carte) | **Sites** (liste ou carte), puis la fiche site | Cinq écrans montrent le même registre, avec trois cartes différentes (Leaflet, Leaflet, SVG) qui ne calculent pas les mêmes chiffres (M12, M17). On garde une liste, une carte à couches (Risque, Couverture du mois, Dernière collecte, Sites par district) et une fiche. |
| Modale « Critères de risque », modale « Nouveau site », « Ajouter un site », écritures de site à l'import | **Fiche site** (onglets Priorité et Identité) et formulaire unique `SiteForm` | Le registre est aujourd'hui écrit par 7 chemins avec 4 identités de site (AL §1.6, H7). Avec un seul propriétaire et une cascade Localités qui envoie des codes (et plus seulement des noms, PlanBoardPage.jsx:646-650), les écritures concurrentes disparaissent. |
| Plan de suivi (vues Plan et Déjà visités), Affectation & visites, bouton Générer du RBM | **Visites**, avec une vue Année et une vue Mois | Les deux écrans écrivent la même table `site_visits` (`planMonthsTx` et `generateFromRbm`) à deux échelles. Le bouton « Générer » n'existe plus qu'à un endroit. |
| Couverture du suivi, onglet « Couverture & budget » de Visites, section couverture du Rapport de synthèse | **Couverture** | La même couverture était calculée à trois endroits, avec des unités différentes. |
| Suivi de processus › Tableau de bord, Couverture & performance (Synthèse et Salle de contrôle), carte « Couverture terrain » du tableau BI | **Tableau de bord** | Mêmes sources (`fieldSummary`, `rbmSites`, `monOverview` ou `coverage-dashboard`) et mêmes indicateurs sous trois libellés différents. |
| Dashboard › Vue d'ensemble (graphiques), Suivi budgétaire consolidé, section budget du Rapport de synthèse | **Suivi budgétaire** (onglets Tableau, Graphiques, Par mois) | Une seule source (consolidation) et une seule définition du Réalisé (H11, livrée). Sa place est à côté des contrats et des factures. |
| Rapport de synthèse, Concepteur de rapport, Bulletin de Couverture & performance | **Rapports** (modèles prêts à l'emploi) | Les modèles `bulletin`, `budget`, `completude`, `pdd` et `performances` existent déjà dans `reportTemplates.js`. Le rapport de synthèse en est une copie figée et non bornée à la période (H10). |
| Centre d'alertes, cloche vide, lignes « à valider », santé de la configuration | **À traiter** (onglets À valider, Alertes, Réglages), avec un aperçu dans Accueil et dans la cloche | Une seule liste calculée côté serveur, présentée à trois niveaux de détail. La boîte « À valider » ne fait que naviguer : la décision reste dans l'écran propriétaire. |
| Données & indicateurs › Données importées, Visites › Données réelles | **Formulaires reçus**, et le même composant filtré dans la fiche de suivi | Les mêmes formulaires étaient affichés deux fois, avec des colonnes et des filtres différents. |
| File « À rapprocher » et « Alias » (prévues par AL-6 dans Paramétrage › Localités), exclusion de formulaires, enquêteurs non reconnus | **Qualité des données** | Ce sont des vérifications qui suivent un import. Une seule file de travail remplace les « non rattachée » et les « — » sans lien. |
| Prestataires TPM, Paramétrage › Partenaires, Paramétrage › Types, modale Agents, modale « Nouvel agent » | **Partenaires** (une liste à onglets par type, une fiche) | Même table `partners`. Les agents étaient saisis à deux endroits, et la fiche ne montrait que des agents. |
| Formations (une ligne par agent), Évaluation (lit `tpm_assignments`) | **Formations** (sessions) et **Agents & évaluation** (une liste, une fiche agent) | Une formation est un événement avec des participants. La note doit venir des formulaires réellement saisis, pas d'un modèle retiré du menu. |
| Planification & budget, Rapports & dépenses (dans Partenaires & TPM) | **Contrats & budget** › Plans de collecte et Factures & rapports | C'est la chaîne financière Contrat → Plan → Facture → Suivi budgétaire. La fiche prestataire les montre avec un filtre verrouillé. |
| Paramétrage › Activités et Paramètres MMR | **Activités & exigences** (onglets Activités, Exigences, Fréquences) | Les trois vocabulaires d'activité deviennent visibles côte à côte (M7). Cela prépare AL-9. |
| Paramétrage › Taux de change et profil pays | **Pays & devises** | Devise et taux vont ensemble, et le profil pays prend effet (B1). |
| Paramétrage › Localités (découpage) et explorateur des lieux (nouveau) | **Localités** (explorateur et fiche pour tous, Découpage pour l'administrateur) | Un seul arbre des lieux. |
| Visites › carte « Jours de collecte » | Visites › Mois › panneau « Jours à budgéter » | C'est là que les dates de visite sont saisies. Plans de collecte les lit avec un `SourceTag`. |

---

## 4. Mécanisme de liaisons

### 4.1 Registre unique `web/src/lib/routes.js`

C'est un module pur, sans React. Il est la source unique de `NAV`, `REDIRECTS`, du fil d'Ariane, des liens et des dépendances.

```js
// Extrait
export const PAGES = {
  'sites.liste': {
    group: 'sites', label: 'Sites', path: '/sites/liste',
    tabs: ['liste', 'carte', 'priorites'],
    deps: ['decoupage', 'sites_sans_code_commune', 'sites_sans_bureau',
           'activites_sans_exigence', 'frequences_risque', 'lieux_a_rapprocher'],
    owns: ['sites'],                          // seule page (avec sa fiche) qui écrit le registre
    next: 'sites.visites',                    // « Ensuite : Visites → »
  },
  // …
};
export function href(key, params, query) {}  // construit une adresse
export function parseHash(hash) {}           // → { key, params, query }, uuid / mot-clé / onglet
export function routeFor(kind, id) {}        // site | localite | bureau | partenaire | agent | fiche | contrat | session | facture
export const REDIRECTS = [/* section 2.3 */];
```

- **`NavProvider` et `useNav()`** (contexte React) exposent `{ route, go(key, params, query), href }`. Toute page peut ouvrir n'importe quelle autre. La prop `onNavigate`, que seules 8 pages sur 23 recevaient (M13), disparaît.
- **`App.jsx`** remplace la cascade de conditions par une table `clé → composant`.
- **Test** `web/src/lib/routes.test.mjs`, lancé avec `node --test` sans dépendance (`web/package.json` est déjà en `"type": "module"`). Il vérifie :
  - que chaque ancienne adresse de 2.3 aboutit à une clé existante et jamais à la route par défaut ;
  - qu'aucune page n'est orpheline ;
  - qu'aucun groupe ne dépasse 6 entrées ;
  - que l'aller-retour `href` / `parseHash` conserve la query ;
  - que chaque code de `deps` existe dans la liste des règles de santé (liste copiée de `healthRules.js` dans un fichier JSON partagé `shared/healthCodes.json`).

### 4.2 État de la configuration : `GET /api/settings/health`

- **Serveur.**
  - `server/src/modules/settings/health.repository.js` exécute 4 à 5 requêtes de comptage (`COUNT(*) FILTER (…)`, une par famille) dans **un seul** `withTenantTransaction`, filtrées par `tenant_id = $1`, sans boucle JS.
  - `healthRules.js` est un module pur et testé. Il transforme les comptages en `[{ code, status, count, total, message, fix: { key, params, query }, consumers: [pageKey] }]`.
- **Statuts** (toujours couleur, icône et libellé) :
  - `pret` (vert, « Prêt ») ;
  - `a_completer` (ambre, « À compléter ») ;
  - `bloquant` (rouge, « Bloquant ») ;
  - `non_mesurable` (gris, « Pas encore mesurable », quand la règle dépend d'un lot pas encore livré). On n'affiche jamais 0 à la place.
- **Côté navigateur**, un seul appel, mis en cache dans un contexte React (`useHealth()`), rechargé après toute écriture dans une page de réglage et au plus toutes les 5 minutes.
- **`GET /api/settings/usage`** donne la vue inverse : pour chaque réglage, les pages qui l'utilisent et des compteurs (« Exigences de suivi : 1 275 sites concernés, 4 fiches rattachées »).

**Tableau « prêt / à compléter »**, affiché dans Réglages › Vue d'ensemble avec les colonnes Configuration · État · Ce qui manque · Utilisé par · « Régler → » :

| Code | Ce qui est vérifié | État si manquant | Où régler | Pages qui en dépendent | Mesurable dès |
|---|---|---|---|---|---|
| `decoupage` | Découpage importé ; part des communes avec code officiel | Bloquant si vide ; à compléter si moins de 100 % | Localités › Découpage | Sites, Localités, Formulaires reçus, Distributions, Contrats | maintenant |
| `zones_contrat_detachees` | Zones de contrat qui ne pointent plus vers une localité (H1) | À compléter | fiche contrat › Modifier ou Avenant | Contrats, fiche localité | maintenant |
| `sites_sans_code_commune` | Sites actifs sans code officiel de commune | À compléter | Qualité des données › Lieux | Sites, fiche site, Visites (dernière collecte), Tableau de bord | maintenant |
| `sites_sans_bureau` | Sites actifs sans bureau | À compléter | Bureaux & antennes (périmètre) | Sites, Visites, Couverture, Rapports par bureau | maintenant |
| `bureaux_sans_perimetre` | Bureaux actifs sans aucune commune | À compléter | Bureaux & antennes | Sites, Formulaires reçus, Distributions | maintenant |
| `activites_sans_exigence` | Couples bureau × activité de sites actifs sans exigence de suivi | À compléter | Activités & exigences › Exigences | Visites › Année (exigées), Couverture, fiche site | maintenant |
| `frequences_risque` | Fréquences selon le risque encore aux valeurs par défaut, non confirmées | À compléter (information) | Activités & exigences › Fréquences | Sites (Priorités), Visites (planifier), fiche site | lot G |
| `fiches_sans_activite` | Fiches actives sans activité rattachée | À compléter | fiche de suivi › Réglages | Tableau de bord, fiche site › Données, Rapports | maintenant |
| `lieux_a_rapprocher` | Valeurs dans la file « À rapprocher » (lieux et bureaux) | À compléter ; bloquant si plus de 10 % des formulaires du mois | Qualité des données › Lieux | Formulaires reçus, Sites, Distributions, Tableau de bord | AL-3 (048) |
| `formulaires_sans_commune` | Part des formulaires du mois sans commune reconnue | À compléter au-delà de 10 % | Qualité des données › Lieux | fiche site › Données, Couverture, Tableau de bord | AL-4 |
| `formulaires_sans_bureau` | Formulaires sans bureau relié (H8) | À compléter | Qualité des données › Lieux | Rapports par bureau | AL-4 |
| `tpm_absent` | Aucun partenaire actif de type TPM | Bloquant | Partenaires › Nouveau partenaire | Visites (affecter), Plans, Factures, Agents | maintenant |
| `prestataires_sans_agent` | Prestataires TPM actifs sans agent actif | À compléter | fiche partenaire › Équipe | Formations, Agents & évaluation | maintenant |
| `prestataires_sans_contrat` | Prestataires TPM actifs sans contrat actif | À compléter | Contrats › Nouveau contrat | Plans, Factures, Suivi budgétaire | maintenant |
| `contrats_sans_ligne_suivi` | Contrats actifs de prestataires TPM sans poste IV.suivi | À compléter | fiche contrat › Avenant | Plans, Factures, Suivi budgétaire | maintenant |
| `plans_brouillon_echus` | Plans de collecte encore en brouillon pour un mois passé | À compléter | Plans de collecte | Suivi budgétaire (Planifié), Factures (pré-remplissage) | maintenant |
| `taux_manquant` | Mois d'un plan ou d'une facture sans taux de change | À compléter | Pays & devises › Taux | Plans, Factures, Suivi budgétaire (USD) | maintenant |
| `profil_pays` | Devise ou centre de carte non renseignés | À compléter | Pays & devises | Carte des sites, formats monétaires | maintenant |
| `valideurs` | Moins de 2 comptes actifs pouvant valider (administrateur ou gestionnaire) | Bloquant (la séparation des tâches devient impossible) | Utilisateurs & accès | Contrats, Factures, Évaluations | maintenant |
| `agents_sans_code` | Agents actifs sans code d'enquêteur | À compléter | fiche partenaire › Équipe | Agents & évaluation | lot E |
| `themes_formation` | Aucun thème de formation | À compléter (information) | Formations › Thèmes | Formations | lot F |
| `agents_a_reconnaitre` | Noms d'enquêteurs non reliés à un agent | À compléter | Qualité des données › Agents | Agents & évaluation, fiche partenaire | lot K |
| `methode_notation` | Aucune méthode de notation active | À compléter | Agents & évaluation › Méthode | Agents & évaluation, fiche agent, Performance | lot L |

### 4.3 Ce que l'utilisateur voit (`web/src/components/Links.jsx`)

| Composant | Rôle | Exemple affiché |
|---|---|---|
| `PageLinks` (dans `PageHeader`, via la prop `deps` du registre) | Bandeau replié sous le titre : « D'où viennent ces informations ? ». Déplié, il donne une ligne par prérequis avec son état et un bouton « Ouvrir ». | Replié : « Paramètres : tout est prêt ». Déplié : « Exigences de suivi · À compléter · 3 activités sans exigence · Régler → » |
| `ConfigLink` | Seule façon de citer un réglage dans un texte, un écran vide ou un message. | « Aucune exigence pour l'activité Cantines au bureau Ampanihy · Régler → » |
| `MissingConfig` | État vide explicatif : pourquoi la page est vide, quoi faire, avec un bouton. Remplace les « 0 », « — » et « non fait » muets. | « Colonne Exigées vide : 12 sites sans exigence de suivi → Activités & exigences » |
| `SourceTag` | Valeur affichée en lecture et venue d'ailleurs, avec un lien vers l'endroit où on la modifie. | « Bureau : Antenne Ampanihy · déduit du périmètre → Bureaux & antennes » |
| `ObjectLink` | Tout nom d'objet ouvre sa fiche (`routeFor`). | Un nom de site, de commune, de prestataire, d'agent, de fiche ou de contrat |
| `UsedBy` | Encart en tête de chaque page de réglage. | « Utilisé par : Visites (1 275 sites) · Couverture · Priorités » |
| `ImportMatchReport` (AL-2.2) | Compte rendu obligatoire à la fin de chaque import. | « 1 204 reconnus · 71 à rapprocher → Qualité des données » |
| `CycleBar` (léger) | Ligne « Ensuite : … → » en bas des pages du cycle, d'après `next`. | « Ensuite : Visites du mois → » |

### 4.4 Une donnée, un propriétaire

| Donnée | Seul écran qui l'écrit | Affichée en lecture (avec `SourceTag`) dans |
|---|---|---|
| Site (identité, lieu, activité, GPS, bureau choisi à la main) | fiche site › Identité (`SiteForm`) et Sites › Importer | Visites, Couverture, Formulaires reçus, fiches localité, partenaire et contrat |
| Critères de risque, priorité | fiche site › Priorité | Sites (vue Priorités), Visites (planifier) |
| Visites de l'année (coches des mois) | Visites › Année | fiche site, Couverture |
| Affectation, date et statut d'une visite ; statut du plan du mois | Visites › Mois | Accueil, À traiter, fiche site, fiche partenaire |
| Jours de déplacement (majoration) | Visites › Mois › Jours à budgéter | Plans de collecte |
| Découpage administratif | Localités › Découpage | partout |
| Correspondances apprises, décisions de rapprochement | Qualité des données | fiches site et localité (état de liaison) |
| Bureau et périmètre | Bureaux & antennes | Sites, fiche site (« déduit du périmètre ») |
| Exigences de suivi, fréquences selon le risque | Activités & exigences | Visites, Couverture, Sites, fiche site |
| Partenaire (identité) | `PartnerForm`, ouvert depuis la liste ou la fiche Partenaires | Contrats, Plans, Factures, Visites |
| Agent | fiche partenaire › Équipe, ou création depuis Qualité des données › Agents | Formations, Agents & évaluation |
| Session de formation, présence, notes de tests | Formations › fiche session | fiches agent et partenaire |
| Méthode de notation | Agents & évaluation › Méthode | fiche agent (« calculée selon … ») |
| Évaluation qualitative | fiche agent › Évaluations | Agents & évaluation, fiche partenaire |
| Fiche de suivi (indicateurs, activité, correspondances, champs calculés) | fiche de suivi › Réglages | Tableau de bord, fiche site, Rapports |
| Import et exclusion de formulaires | Formulaires reçus (même composant que l'onglet de la fiche et que Qualité › Écartés) | partout |
| Contrat ; plan de collecte ; facture | Contrats ; Plans de collecte ; Factures & rapports | fiche partenaire, Suivi budgétaire, Accueil |
| Taux de change, profil pays | Pays & devises | Plans, Factures, Suivi budgétaire, carte |

**Contrôle automatique** : `web/scripts/check-owners.mjs`.
- Il signale toute page non propriétaire qui appelle une fonction d'écriture de `api/client.js` liée à une donnée déclarée `owns` ailleurs.
- Il produit un **avertissement**, pas un refus de build : comme toutes les pages importent le même objet `api`, l'analyse se fait sur le texte et pourrait donner de faux positifs (remarque du jury de fiabilité).

### 4.5 Liaison des données elles-mêmes

Les liens d'écran ne suffisent pas : les données doivent aussi être reliées.

- **Lieux et bureaux.** Tout import ou saisie passe par `placeMatch` (livré), puis par `matchAndQueue` (AL-3). Une décision dans Qualité des données crée un alias et l'applique aux données déjà importées (`applyToSources`), dans la même transaction. Rien n'est jamais ressaisi.
- **Agents** (lot K). Même principe, avec un module pur `common/personMatch.js` et la file de rapprochement de type `agent` (voir 6.5).
- Une valeur rapprochée de façon **approximative** n'est jamais appliquée automatiquement : elle part dans la file.

### 4.6 Garde-fous de recette

- `web/scripts/check-links.mjs`, lancé en `prebuild` et **bloquant**, vérifie que chaque adresse citée dans `NAV`, `REDIRECTS`, `PAGES.deps.fix` et `PAGES.next` existe.
- `node --test web/src/lib` (redirections et registre).
- Le balayage Playwright, déjà en usage, s'étend à :
  - toutes les anciennes et nouvelles adresses, en FR et en EN, avec 0 erreur console ou API ;
  - un clic sur chaque `ConfigLink` visible, qui doit mener à une page existante ;
  - un échec dès qu'un texte « Paramétrage › » ou « configurez dans » apparaît hors d'un lien dans `.page-desc`, `.note` ou `.empty`.

---

## 5. Accueil, fiches Site et Localité, règles d'interface

### 5.1 Accueil (`#/pilotage/accueil`, page par défaut)

L'Accueil tient sur un écran de 1366×768 sans défilement. Il n'a aucun graphique.

```
Bonjour Hanta                                  [ octobre 2026 v ]   [ Trouver un site, une commune, un prestataire... ]

CE MOIS-CI
[ Sites à visiter ]   [ Visites réalisées ]   [ Formulaires reçus ]     [ À valider ]
  38 à suivre           54 / 80 · 68 %          412 · dont 23 sans lieu   3 factures · 1 plan
  -> Visites            -> Couverture           -> Formulaires reçus      -> À traiter

À FAIRE (5 au plus)                                                          Tout voir (14) ->
  ⛔ Valider la facture de <prestataire> — septembre                         [Voir]
  ⚠ Affecter 12 visites sans prestataire                                     [Voir]
  ⚠ Rapprocher 8 noms de communes                                            [Voir]
  ...

LE MOIS EN 5 ÉTAPES
  1 Planifier ✓ fait  ›  2 Affecter • en cours  ›  3 Collecter  ›  4 Contrôler  ›  5 Payer
```

- **Bloc « Ce mois-ci »** : 4 tuiles. Chacune donne un chiffre, son dénominateur et une phrase, et ouvre la liste déjà filtrée.
- **Bloc « À faire »** : au plus 5 lignes, triées bloquant > à surveiller > à traiter. Chaque ligne est une phrase avec un verbe et un bouton « Voir ».
- **Bloc « Le mois en 5 étapes »** : composant `Stepper` existant. L'étape en cours est mise en avant et chaque étape ouvre son écran. Règles (module pur `server/src/modules/home/monthFlow.js`, testé) :

  | Étape | Fait quand | En cours quand | Écran |
  |---|---|---|---|
  | Planifier | plan du mois (`field_month_plans`) `valide` ou `non_applicable` | `draft` ou `soumis` avec au moins une visite | Visites › Mois |
  | Affecter | aucune visite planifiée sans prestataire | n visites à affecter | Visites › Mois `?prestataire=non_affecte` |
  | Collecter | mois clos, et visites toutes réalisées ou annulées | réalisées / prévues, formulaires reçus | Couverture |
  | Contrôler | aucun formulaire du mois sans lieu ou sans agent reconnu, et rapports techniques du mois validés | n à rapprocher | Qualité des données |
  | Payer | facture du mois validée pour chaque prestataire ayant des visites réalisées | factures soumises | Factures & rapports |

  Une étape passe en « Bloqué » si un prérequis `bloquant` de la santé la concerne.
- **Première utilisation** (tenant vide, détecté par la santé) : le bloc « À faire » devient « Démarrer en 4 étapes », cochées automatiquement : importer le découpage, importer les sites, créer les prestataires et leurs agents, importer une fiche de suivi.
- **Selon le rôle** (rôles existants, aucun nouveau profil) :
  - un lecteur voit les tuiles et les étapes, sans bouton d'action ;
  - un administrateur voit en plus « Réglages incomplets (n) ».
- **Serveur** : module `server/src/modules/home/` (routes → controller → service → repository) :
  - `GET /api/home/summary?mois=` : comptages SQL dans une seule transaction, sans télécharger tous les sites comme le font aujourd'hui `ProcessDashboardPage:27` et `DashboardCoveragePage:49` ;
  - `GET /api/home/tasks?mois=&limit=` ;
  - `GET /api/home/count` (léger, pour la cloche) ;
  - `GET /api/search?q=` : 2 caractères minimum, 5 résultats par type, motifs ILIKE échappés, `tenant_id = $1`. Il n'y a pas de `pg_trgm` : la recherche reste bornée par `LIMIT`.

### 5.2 À traiter et cloche

- **Une seule source** : `tasks.domain.js`, pur et testé. Il reprend **à l'identique** les règles actuelles d'`AlertsPage` (dépassement et projection budgétaires, contrats à échéance de 90 jours ou moins, couverture faible, visites non affectées), vérifiées par des tests de parité. Il ajoute :
  - plan du mois en brouillon ;
  - sites à suivre non planifiés ;
  - lieux et agents à rapprocher ;
  - fiches sans activité ;
  - post-tests à saisir ;
  - agents à évaluer ;
  - réglages bloquants.
- **Onglet « À valider »** : rapports soumis par quelqu'un d'autre que moi, contrats et avenants en validation, plans du mois soumis, évaluations soumises. La requête est un `UNION ALL` dans `inbox.repository.js`. **La boîte ne fait que naviguer** : « Voir » ouvre l'objet dans son écran propriétaire, où la décision se prend.
- **Les tâches sont filtrées selon le rôle** : un lecteur ne voit pas les validations ; un gestionnaire voit les factures et les avenants ; un administrateur voit en plus les réglages.
- **Cloche** : compteur « critiques + à valider », les 5 premières lignes, puis « Tout voir ».
- **Performance** : `AlertsPage` appelait 4 API dans le navigateur (AlertsPage.jsx:30). Le calcul passe côté serveur, et la cloche n'appelle que `/api/home/count`.

### 5.3 Liste Sites (`#/sites/liste`) : le registre unique

- **Filtres libellés visibles** : Recherche (nom, L###, commune), District, Bureau, Priorité. « Plus de filtres » ajoute Région, Commune, Activité, État du mois, « À suivre », « Non rapproché ».
- **Colonnes par défaut (6 + action)** : Site (nom, puis `L###` en police mono discrète), Commune, Bureau, Priorité (pastille), Dernière visite ou collecte (date et source), État du mois (À jour / À suivre / Jamais visité / Inactif), bouton **Voir**.
- **Vues** : Liste · Carte · Priorités (colonnes risque, score et « à suivre »). Choix de 10, 25, 50 ou 100 lignes. Sélection multiple, puis « Modifier la sélection ».
- **Bouton principal** « Ajouter un site » (`SiteForm`). Menu **Importer** (Master Data, Plan de suivi, Locations, Planning, modèle reconnu par ses en-têtes, ce qui corrige M14 ; aperçu ; `ImportMatchReport`). Menu **Exporter / Gabarit**.
- **Données** : réutilise `/rbm/sites` et `/plan-board`, sans nouveau calcul.
- **Doublons** : un badge « doublon possible » s'affiche tant qu'AL-8 (identité unique des sites, H7) n'est pas livré.

### 5.4 Fiche site (`#/sites/liste/:siteId/:onglet`)

**En-tête**
- Nom du site et `L###` en police mono.
- Pastilles (couleur, icône et libellé) : Priorité (Élevée / Moyenne / Faible), « À visiter ce mois » ou « À jour jusqu'à <mois> », « Actif » ou « Inactif ce mois », et « Non rapproché » le cas échéant (lien vers Qualité des données).
- Fil des lieux cliquable : Région › District › Commune › Fokontany. Chaque niveau ouvre sa fiche localité. Il est lu dans `admin_areas` par code. À défaut, la valeur brute s'affiche avec « non vérifié ».
- Bureau (`SourceTag` « déduit du périmètre » ou « choix manuel ») et activité (lien vers la fiche de suivi rattachée).
- Actions selon le rôle : bouton principal **« Planifier une visite »** (ouvre Visites › Mois avec le site prérempli), menu « Plus » (Modifier, Désactiver ce mois).

**4 faits**

| Dernière visite | Dernière donnée reçue | Prochaine échéance | Visites de l'exercice |
|---|---|---|---|
| date, prestataire (lien), rôle | mois, nombre de formulaires, fiche (lien) | « avant fin novembre », fréquence et **sa source** (« exigence Bureau X × Cantines », « fréquence selon le risque » ou « valeur par défaut ») | faites / exigées |

**Onglets (5)**

1. **Résumé**
   - Chronologie des 10 derniers événements : visites, formulaires reçus, affectations.
   - « Qui intervient ici » : prestataires des visites, contrats dont une zone couvre la commune (B14, après AL-3), partenaire de distribution (après AL-5).
   - **Encart « Liaisons »**, une ligne par paramètre avec son état et un lien :

     | Paramètre | Si la liaison existe | Sinon |
     |---|---|---|
     | Commune | reconnue (code `MG51507090`) | « non reconnue → Qualité des données » |
     | Bureau | trouvé par le périmètre | « aucun bureau ne couvre cette commune → Bureaux » |
     | Exigence bureau × activité | présente | « absente → Activités & exigences » |
     | Fiche de suivi | rattachée à l'activité | « aucune → Fiches de suivi » |
     | Prestataire du mois | affecté | « non affecté → Visites » |
     | Contrat | couvre la zone | « aucun » |

     Une liaison n'est « OK » que si elle repose sur un code ou un identifiant (`geo_status`, migration 048).
2. **Visites** : bande des 12 mois de l'exercice (ligne `PlanTable`, cochable avec le droit d'écriture par le même `/plan-board/months`), puis la liste des visites (mois, activité, prestataire, rôle, date, statut).
3. **Données**
   - Formulaires reliés par code de commune, puis par site quand AL-4 aura posé `site_id` ou `adm4`. Sont exclus les formulaires écartés et ceux des fiches d'une autre activité (H4, livré).
   - Les formulaires sont regroupés par mois et par fiche. Les principaux indicateurs de la fiche sont calculés sur ce périmètre par `monitoringMath.computeAll` côté serveur, et affichés avec `IndicatorsList`.
   - Si la commune n'est pas reconnue, un message et un lien s'affichent, jamais un 0.
4. **Priorité** : les critères de risque (seul endroit où ils s'éditent), le score, le niveau et la fréquence qui en résulte, avec sa source. L'écriture est partielle (H5 livré).
5. **Identité** : tous les champs du registre, mini-carte GPS (composant `SitesMap`), codes, valeur brute importée et valeur rapprochée côte à côte. C'est ici que s'ouvre `SiteForm` (sections Identité, Lieu en cascade Localités qui envoie les identifiants et les codes, Rattachement, Risque).

**Serveur** : `GET /api/tpm/field/sites/:id/sheet`, dans un seul `withTenantTransaction`, avec 6 requêtes bornées :
1. le site et sa lignée ;
2. le bureau ;
3. l'exigence de suivi ;
4. les visites sur 24 mois ;
5. les formulaires groupés par mois et par fiche ;
6. les prestataires et contrats.

Index utilisés : `idx_site_visits_site` et `idx_sites_adm3_pcode` existants, plus `(tenant_id, adm3_pcode)` sur `monitoring_submissions` (048). Les règles (échéance avec `rbmMath`, exigence et fréquence, état du mois, liste des liaisons) sont dans le module pur `server/src/modules/tpm/placeSheet.js`, testé.

**Historique des modifications** (changements de risque, de bureau) : il demande la migration optionnelle `site_events`. Elle est hors de ce lot et listée en section 9.

### 5.5 Fiche localité (`#/sites/localites/:areaId/:onglet`)

- **Adresse par identifiant de zone**, et non par code : la fiche fonctionne donc même si le découpage n'a pas encore de codes officiels (B5).
- **En-tête** : nom, chemin Région › District › Commune, code officiel, bureau qui couvre la zone. **Taux de rattachement toujours affiché**, par exemple « 92 % des sites et 88 % des formulaires reliés par code ».
- **3 faits** : sites (actifs / total), couverture du mois, formulaires reçus.
- **Onglets** :
  - Résumé ;
  - Sites (la liste Sites, filtre verrouillé) ;
  - Visites & couverture ;
  - Formulaires reçus (même composant, filtre verrouillé) ;
  - Distributions (après AL-5) ;
  - Contrats & bureaux.
- **Serveur** : `GET /api/tpm/field/localities/:areaId/sheet`, agrégé par `admin_areas.lineage` (index GIN, 041) et par codes.

### 5.6 Règles d'interface pour des utilisateurs peu à l'aise avec l'informatique

1. **Une page, une question.** Titre court, une phrase d'explication au plus. Les explications longues vont dans une aide « ? » repliée (`lib/tips.js`, désactivée par défaut).
2. **Au plus 4 chiffres en haut de page**, chacun cliquable vers la liste filtrée. Un pourcentage montre toujours son dénominateur (« 54 / 80 · 68 % »). Les chiffres sont en Inter tabulaire, avec leur unité (Ar, USD, %, visites).
3. **Un seul bouton principal** : l'action suivante. Importer, exporter et gabarit vont dans un menu « Plus d'actions ». Par exemple, RbmPage et FieldVisitsPage passent de 4 boutons à 1 bouton plus un menu.
4. **Listes « façon portail »**, par extension de `DataList` (`labelledFilters`, `pageSizeOptions`, `rowAction`, `initialValues`, `serverMode`) :
   - 3 ou 4 filtres libellés visibles au-dessus du tableau, « Plus de filtres » pour les autres (le sélecteur à cases actuel), « Réinitialiser » dès qu'un filtre est actif, **sans badge de comptage** ;
   - statut toujours en pastille `StatusBadge` (couleur, icône et libellé), dans une colonne Statut placée au même endroit dans toutes les listes ;
   - 6 colonnes par défaut au plus, la dernière portant le bouton **« Voir »** ; « Colonnes », vues mémorisées et export CSV sont regroupés dans un menu « ⋯ » ;
   - 10, 25, 50 ou 100 lignes (25 par défaut), mémorisé (localStorage, avec try/catch), avec « 1–25 sur 340 » ;
   - **clic** : dans une liste sans action de sélection, un clic sur la ligne ouvre la fiche. Dans une liste avec sélection (Contrats, Sites), le clic sélectionne et le double-clic ouvre, comme le décrit CLAUDE.md. Le bouton « Voir » est toujours présent ;
   - les clés `storageKey` existantes sont conservées. Elles ne changent de version que si le format des vues mémorisées change, avec une lecture de l'ancienne sous try/catch.
5. **Fiches sur un même gabarit** :
   - en-tête : nom, code en police mono, pastilles, 1 à 3 actions ;
   - 3 ou 4 faits ;
   - onglets soulignés, 6 au plus, le premier étant **Résumé**, le technique en dernier ;
   - l'onglet actif est dans l'adresse, et le fil d'Ariane suit la forme Groupe › Page › Objet.
6. **Tiroir** pour modifier vite une ligne (visite, facture, plan). **Page** pour un objet métier (fiche) et pour les formulaires longs (contrat, facture, session).
7. **Formulaires** :
   - une colonne sur mobile, deux sur grand écran, champs obligatoires d'abord, « Plus d'options » replié ;
   - barre d'enregistrement fixe en bas ;
   - erreurs en phrase simple sous le champ (renvoyées par zod) ;
   - brouillon conservé en sessionStorage, avec try/catch.
8. **Jamais de texte libre pour un référentiel.** Lieu en cascade Région › District › Commune, bureau, activité, partenaire, agent et contrat se choisissent dans une liste, avec un lien « Créer… » vers la page propriétaire.
9. **Un écran vide dit pourquoi et quoi faire** (`MissingConfig`). Un paramètre manquant ne s'affiche jamais comme « — ».
10. **Toute action destructrice ou groupée annonce son effet chiffré** (« 42 sites seront détachés, 3 exigences supprimées ») et propose **« Désactiver »** par défaut (M4).
11. **Imports en 3 temps, toujours identiques** : choisir le fichier, voir l'aperçu (lus / à créer / à mettre à jour / rejetés / à rapprocher), valider. L'import se termine par `ImportMatchReport`.
12. **Selon le rôle**, les boutons d'écriture sont masqués pour un lecteur plutôt que grisés. Aucune entrée « bientôt » n'est visible.
13. **Design system de CLAUDE.md** : barre claire, Inter (IBM Plex Mono pour les codes seulement), arrondis 6/9/14, statut jamais par la couleur seule, densité confortable par défaut et mode compact sur les grands tableaux (Visites › Année, Formulaires reçus), comme dans `IndicatorsList`.
14. **Tous les libellés passent par `tr()`.** Les clés `nav.*` sont créées en FR et en EN (`web/src/locales/en/*.js`).

---

## 6. Partenaires & TPM

### 6.1 Liste Partenaires (`#/partenaires/liste`)

- **Onglets sobres avec compteur** : Prestataires TPM (par défaut) · ONG / mise en œuvre · Autres · Tous · Types (administrateur).
- **Filtres libellés** : Recherche, Statut, Région d'intervention.
- **Colonnes pour l'onglet TPM** : Prestataire (nom et sigle), Contrat (pastille Actif / À renouveler / Aucun), Sites suivis sur 12 mois, Visites du mois réalisées / affectées (%), Agents actifs, Note moyenne des agents (pastille de bande), Factures en attente, **Voir**.
- **Bouton principal** « Nouveau partenaire » : ouvre le formulaire unique `PartnerForm`, avec le type présélectionné selon l'onglet.

### 6.2 Fiche partenaire 360° (`#/partenaires/liste/:id/:onglet`)

**En-tête**
- Nom, sigle, type, statut, « partenaire depuis », contact principal (téléphone et courriel cliquables), NIF/STAT, taux journalier.
- Actions : Modifier (`PartnerForm`), « Créer un contrat ».

**4 faits**
- Contrat en cours (montant, % consommé selon `realised.js`, date de fin).
- Visites du mois (réalisées / affectées, avec `fieldMath`).
- Formulaires saisis sur 12 mois et part écartée.
- Note moyenne des agents (méthode en vigueur).

**Onglets d'un prestataire TPM (7)**

1. **Résumé & parcours**
   - Identité complète.
   - Zones d'intervention **calculées** : union des zones de ses contrats et des districts de ses visites, sans saisie.
   - **Parcours** : frise chronologique paginée par 50, assemblée en SQL par `UNION ALL` triée et bornée sur 24 mois. Elle reprend :
     - `contract_history` (signature, avenants, renouvellement, résiliation) ;
     - les premiers et derniers mois de visites par district (`site_visits` groupées) ;
     - `tpm_reports` (factures soumises, validées, rejetées) ;
     - les sessions de formation suivies par ses agents ;
     - les évaluations validées.
2. **Contrats** : la liste Contrats avec filtre verrouillé (statut, période, total, consommé), et lien vers la fiche contrat.
3. **Terrain**
   - Visites par mois (planifiées, réalisées, annulées, taux).
   - Sites et districts suivis (liens vers les fiches site).
   - Jours de collecte.
   - Formulaires saisis par fiche et par agent (après le lot K), avec un lien vers Formulaires reçus `?prestataire=`.
4. **Plans & factures** : les mêmes listes que Contrats & budget, filtre verrouillé. « Voir » ouvre `PlanBudgetDrawer` ou `FactureDrawer`. La ligne du prestataire dans la consolidation est affichée.
5. **Équipe** : agents (nom, fonction, code d'enquêteur, téléphone, sexe, actif, entrée, sortie), note du mois, nombre de formations. **Seul endroit où l'on crée ou désactive un agent.** « Voir » ouvre la fiche agent.
6. **Formations** : sessions suivies par ses agents, taux de présence, progression moyenne du pré-test au post-test.
7. **Performance** (à partir du lot L ; l'onglet n'apparaît pas avant) : même moteur de notation, portée « prestataire ». Critères : couverture des visites affectées, ponctualité des rapports, taux de rejet des factures, consommation par rapport au plan, moyenne des notes des agents. Historique sur 12 mois.

**Partenaire non TPM** : Résumé & parcours, Contrats, Distributions (après AL-5), Terrain (s'il est partenaire de mise en œuvre dans les données).

**Serveur** : nouveau module `server/src/modules/partners/` (routes → controller → service → repository), monté sur `/api/partners`.
- `GET /:id/sheet` et `GET /:id/timeline?before=&limit=50` : chaque sous-requête filtre `tenant_id = $1` sous `withTenantTransaction`.
- Assemblage dans le module pur `partnerSheet.js`, testé.
- Agents : `GET /api/partners/:id/agents`, `POST /api/partners/:id/agents` et `PATCH /api/partners/:id/agents/:agentId`, avec le droit **WRITE** (administrateur ou gestionnaire, à valider, point 8.6). Les anciennes routes `/api/settings/partners/:id/agents…` restent des alias pendant une version.
- **B4 corrigé** : le PATCH partenaire et bureau ne met à jour que les champs envoyés (`CASE WHEN $x::boolean THEN … ELSE colonne END`), avec un test de non-régression.

### 6.3 Agents & évaluation (`#/partenaires/agents`)

**Liste**
- Onglets : Notes du mois · Méthode · Historique.
- Filtres : Recherche, Prestataire, Mois, Bande.
- Colonnes : Agent, Prestataire (lien), Formulaires du mois, Note automatique (pastille ou « Données insuffisantes »), Appréciation qualitative, Note finale, Statut de l'évaluation (pastille), **Voir**.

**Fiche agent** (`/:agentId/:onglet`)
- En-tête : nom, fonction, prestataire (lien), code d'enquêteur (mono), actif.
- 4 faits : note du mois, note finale, formulaires saisis, dernière formation et son post-test.
- Onglets :
  - **Note** : « pourquoi cette note », critère par critère en phrases simples, par exemple « Formulaires complets : 92 % (objectif 98 %) → 13/20 du critère ». La méthode et sa version sont citées, avec un lien « Comment la note est calculée ».
  - **Évaluations** : grille qualitative et historique ; les anciennes évaluations sont marquées « ancienne évaluation ».
  - **Formations** : sessions, présence, pré-test, post-test, progression.
  - **Formulaires saisis** : lien vers Formulaires reçus `?agent=`.
  - **Identité**.

**Données personnelles** : téléphone, courriel et sexe ne sont visibles que des rôles en écriture. Point à valider avec AR-R4 et la question 10 de `ANALYSE_REFERENCES.md`.

### 6.4 Formations structurées (`#/partenaires/formations`)

**Liste des sessions**
- Filtres : Période, Thème, Prestataire, Statut.
- Colonnes : Session, Dates, Lieu, Participants (F/H), Présence %, Progression pré → post, Réussite %, Statut (pastille), **Voir**.
- Bouton principal « Nouvelle session ».

**Fiche session (4 onglets)**
1. **Programme** : titre, objectif, thèmes du référentiel avec durée en heures (facultative), formateur, organisateur (interne ou un prestataire), lieu choisi dans Localités, bureau, fiche de suivi concernée, seuil de réussite (70 % par défaut).
2. **Participants & présence**
   - Ajout en un clic de tous les agents actifs d'un prestataire, ou agent par agent depuis une liste (jamais en texte libre).
   - Grille agents × jours avec « Tous présents ».
   - Satisfaction de 1 à 5 et commentaire par participant.
3. **Évaluations**
   - Par défaut, deux épreuves : **pré-test** et **post-test**. « Ajouter une épreuve » propose aussi un quiz ou une épreuve pratique.
   - Chaque épreuve a un barème maximal. Les notes se saisissent en grille ou s'importent depuis Excel : modèle avec listes déroulantes et réimport qui renvoie un aperçu, sur le modèle de `postesXlsx`. Plus tard, elles pourront venir d'une fiche Kobo de test, avec le même résolveur d'agents.
4. **Bilan** : taux de présence, moyennes pré et post, progression, gain normalisé, taux de réussite, satisfaction moyenne, liste des agents à revoir.

**Calculs** : module pur `server/src/modules/trainings/trainingMath.js`, testé :
- présence = jours présents / (participants × jours de la session) ;
- score % = score / barème ;
- progression = post % − pré % ;
- gain normalisé = (post % − pré %) / (100 − pré %), indéfini si le pré-test vaut 100 % ;
- réussite = post % ≥ seuil ;
- synthèse de session et profil d'un agent (dernières sessions, dernier post-test).

**Lien avec la notation** : le dernier post-test peut servir de critère `post_test` dans la note des agents (option de la méthode).

### 6.5 Évaluation des agents : note automatique, appréciation qualitative, note finale

**a) Relier chaque formulaire à son agent** (prérequis absolu)

`site_visits.agent` est un **rôle générique** (« Agent 1 ») et ne désigne pas une personne. La personne est l'enquêteur saisi dans le formulaire Kobo (`monitoring_submissions.agent`, renseigné depuis le correctif H2). On le résout à l'import en `agent_id` grâce au module pur `server/src/modules/common/personMatch.js` :

| Étape | Règle | Appliqué automatiquement ? |
|---|---|---|
| 1 | Code d'enquêteur exact (`tpm_agents.code`, sans tenir compte de la casse) | Oui |
| 2 | Nom normalisé identique chez le prestataire connu. Normalisation : accents retirés, minuscules, ponctuation retirée, espaces fusionnés, **mots triés** (« RAKOTO Jean » = « Jean Rakoto ») | Oui |
| 3 | Correspondance apprise (`location_aliases`, kind `agent`, `parent_key` = identifiant du prestataire, ou vide) | Oui |
| 4 | Nom normalisé unique dans tout le tenant | Oui, avec un drapeau |
| 5 | Similarité Jaro-Winkler ≥ 0,92 (fonction exportée de `placeMatch.js`) | **Non** : la valeur part dans la file |
| 6 | Aucun candidat | File, avec l'action « Créer l'agent chez <prestataire> » |

- La file est **Qualité des données › Agents**. Une décision crée la correspondance et relie aussi les formulaires déjà importés (`applyToSources`), dans la même transaction.
- **Prestataire du formulaire** : il vient d'une colonne déclarée « Prestataire de suivi » dans les correspondances de la fiche, nouvelle dimension distincte de « partenaire de mise en œuvre » (xlsform-24) ; à défaut, il est déduit de l'agent reconnu. À valider : point 8.9.

**b) Qualité de chaque formulaire, calculée à l'import**

Le module pur `server/src/modules/monitoring/submissionQuality.js` calcule les valeurs suivantes et les stocke sur la ligne :

| Mesure | Définition | Si l'information manque |
|---|---|---|
| `completeness` | questions obligatoires renseignées / obligatoires applicables (`monitoring_form_fields.required`). Une question avec condition `relevant` ne compte que si le moteur des champs calculés (`calcFields.js`) sait l'évaluer. | null |
| `duration_min` | `end − start` en minutes (métadonnées du formulaire) | null |
| `has_gps` | position valide et dans le pays (B8) | null si la fiche n'a pas de question GPS |
| `upload_delay_days` | `submitted_at − date de collecte`, ramené à 0 si négatif | null |
| `dup_key`, puis `duplicate_of` | clé pure (fiche, agent, commune ou site, jour), puis identification du doublon en SQL par fonction de fenêtre dans la transaction d'import | — |

Pour les données déjà importées, le rattrapage se fait par lots via l'outbox et le worker (`quality-backfill`), conformément à la règle 4. En dessous d'un seuil, par exemple 20 000 lignes, il se fait en ligne.

**c) Méthode de notation paramétrable** (onglet Méthode)

- Elle se règle par **critères**. Chaque critère a :
  - une mesure, choisie dans un catalogue ;
  - une source de données ;
  - un poids ;
  - un **plancher** (sous lequel le critère vaut 0) et une **cible** (où il vaut 100 %) ;
  - un filtre de fiche facultatif.
- Le sens découle de l'ordre des seuils : cible > plancher, « plus c'est haut, mieux c'est » ; cible < plancher, « plus c'est bas, mieux c'est ». La base l'impose par un `CHECK`.
- **Versionnée** : une méthode active est **figée** (contrôlé par la base, voir 6.6). Toute modification crée une nouvelle version en brouillon.
- **« Simuler sur le mois dernier »** montre la répartition des notes et des bandes avant d'activer une version, sans rien enregistrer.
- Autres réglages :
  - période (mois ou trimestre) et échelle (20) ;
  - part automatique / part qualitative (60/40 par défaut) ;
  - nombre minimal de formulaires (10 par défaut) ;
  - couverture minimale du poids (60 %) ;
  - bandes d'appréciation, qui remplacent la saisie libre actuelle.

**Catalogue des mesures**

| Code | Mesure | Source | Sens habituel |
|---|---|---|---|
| `volume` | formulaires valides / objectif (fixe, ou visites réalisées du prestataire ÷ agents actifs) | `monitoring_submissions` non écartés, `site_visits` | ↑ |
| `ecartes` | part écartée au nettoyage | `excluded` | ↓ |
| `completude` | complétude moyenne | `completeness` | ↑ |
| `delai` | part versée en N jours au plus | `upload_delay_days` | ↑ |
| `duree` | part des entretiens de durée plausible (plage réglable) | `duration_min` | ↑ |
| `gps` | part avec position valide | `has_gps` | ↑ |
| `doublons` | part de doublons | `duplicate_of` | ↓ |
| `controle` | part des formulaires où un **champ calculé de contrôle** vaut la valeur attendue (exprime n'importe quelle règle de cohérence sans code) | champs calculés existants | ↑ |
| `indicateur` | valeur d'un indicateur de la fiche sur les seuls formulaires de l'agent | `monitoringMath.computeIndicator` | selon l'indicateur |
| `post_test` | résultat du dernier post-test | formations | ↑ |
| Portée prestataire seulement : `couverture`, `ponctualite_rapports`, `rejet_factures`, `consommation_plan`, `moyenne_agents` | | visites, `tpm_reports`, consolidation, notes des agents | |

**Méthode proposée par défaut** (à valider, point 8.7) :

| Critère | Plancher → cible | Poids |
|---|---|---|
| Volume de formulaires valides | 50 % → 100 % de l'objectif | 20 |
| Formulaires écartés | 20 % → 2 % | 20 |
| Complétude | 80 % → 98 % | 20 |
| Versés en 3 jours au plus | 50 % → 95 % | 15 |
| Durée plausible (10 à 90 min) | 60 % → 95 % | 10 |
| Position GPS | 70 % → 100 % | 10 |
| Doublons | 5 % → 0 % | 5 |

- Grille qualitative à poids égaux, notée de 1 à 4 avec descripteurs (1 Insuffisant, 2 À améliorer, 3 Satisfaisant, 4 Très bien) :
  - ponctualité et respect du calendrier ;
  - respect du protocole de collecte ;
  - comportement avec les bénéficiaires et les communautés ;
  - qualité des observations ;
  - communication avec le superviseur ;
  - éthique et sécurité (consentement).
- Bandes : 16 et plus Excellent, 12 et plus Bon, 10 et plus Moyen, en dessous Insuffisant.

**d) Calcul** : module pur `server/src/modules/evaluation/agentScore.js`, testé, sans accès à la base.

```
Pour chaque critère automatique c (poids w > 0, plancher f, cible t, f ≠ t) :
  v = valeur mesurée (null si aucune donnée)
  s = clamp((v − f) / (t − f), 0, 1)              // marche dans les deux sens
couverture = Σ w (v non null) / Σ w
si formulaires valides < min_submissions      → statut « Données insuffisantes », pas de note
sinon si couverture < min_coverage_pct        → statut « Non évaluable »
sinon note_auto = échelle × Σ w·s / Σ w        // sur les critères disposant de données
Qualitatif : r ∈ {1..4}, poids u → note_qual = échelle × Σ u·(r − 1)/3 / Σ u
Note finale = (p_auto · note_auto + p_qual · note_qual) / 100
  · sans grille qualitative → « automatique seulement » (provisoire, non validable)
  · sans note automatique → « qualitative seulement »
Bande = première bande dont le minimum est ≤ note finale
Arrondi au dixième, demi vers le haut, en fin de calcul uniquement.
```

Le module renvoie toujours le **détail** par critère : valeur brute, sous-score, poids et phrase explicative.

**e) Agrégation et recalcul**
- Agrégats SQL par agent et par période : `GROUP BY agent_id, period_month` avec `count(*) FILTER (WHERE excluded)`, `avg(completeness)` et `avg((upload_delay_days <= $n)::int)`. Aucune boucle JS sur les formulaires.
- `agent_scores` est une **donnée dérivée**, écrite uniquement par `evaluation.recompute(tenant, mois, méthode)`.
  - Elle est déclenchée par l'outbox : import, exclusion, rapprochement d'agent, activation d'une méthode. Le worker exécute le job `agent-scores`.
  - Sans Redis, un bouton « Recalculer ce mois » exécute le même code sur un seul mois, dans une transaction.
  - L'écran affiche « calculée le … » et « à recalculer » si un import a eu lieu depuis.

**f) Appréciation qualitative et validation**
- Le superviseur (droit d'écriture) remplit la grille et un commentaire, puis passe de brouillon à **soumise**.
- Un validateur (administrateur ou gestionnaire), **différent de l'évaluateur**, **valide**, sous `SELECT … FOR UPDATE`. À la validation, le serveur **recalcule** la note automatique de la période avec la méthode active, sans jamais la prendre du client. Il **fige** `method_id`, `auto_score`, `auto_detail`, `qual_score`, `final_score` et `band`. Il écrit aussi `note` (sur 20) pour la compatibilité avec les anciens écrans et exports.
- Une évaluation validée n'est plus modifiable. Seul un administrateur peut la rouvrir, avec un motif obligatoire ; l'auteur et la date de la réouverture sont conservés.

### 6.6 Modèle de données

Les numéros de migration sont **indicatifs**. On prend le numéro libre suivant au moment du commit, après les numéros 048 à 052 réservés par AL, et on met cette spécification à jour. Chaque table a `tenant_id uuid NOT NULL REFERENCES tenants ON DELETE CASCADE`, `ENABLE ROW LEVEL SECURITY`, `CREATE POLICY tenant_isolation … current_setting('app.tenant_id', true)` et `GRANT SELECT, INSERT, UPDATE, DELETE … TO mems2_app`. Aucune migration déjà appliquée n'est modifiée.

**053_partner_profile.sql** (lot E)
```sql
ALTER TABLE partners
  ADD COLUMN short_name    text CHECK (short_name IS NULL OR length(short_name) <= 40),
  ADD COLUMN legal_id      text CHECK (legal_id IS NULL OR length(legal_id) <= 80),        -- NIF / STAT
  ADD COLUMN address       text CHECK (address IS NULL OR length(address) <= 300),
  ADD COLUMN contact_name  text CHECK (contact_name IS NULL OR length(contact_name) <= 120),
  ADD COLUMN contact_phone text CHECK (contact_phone IS NULL OR length(contact_phone) <= 40),
  ADD COLUMN contact_email citext CHECK (contact_email IS NULL OR contact_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  ADD COLUMN started_on    date,
  ADD COLUMN notes         text CHECK (notes IS NULL OR length(notes) <= 2000),
  ADD COLUMN updated_at    timestamptz NOT NULL DEFAULT now();
ALTER TABLE tpm_agents
  ADD COLUMN code       text CHECK (code IS NULL OR length(btrim(code)) BETWEEN 1 AND 60),
  ADD COLUMN phone      text CHECK (phone IS NULL OR length(phone) <= 40),
  ADD COLUMN email      citext,
  ADD COLUMN sex        text CHECK (sex IS NULL OR sex IN ('F','M')),
  ADD COLUMN active     boolean NOT NULL DEFAULT true,
  ADD COLUMN started_on date,
  ADD COLUMN ended_on   date,
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now(),
  ADD CONSTRAINT tpm_agents_dates_chk CHECK (ended_on IS NULL OR started_on IS NULL OR ended_on >= started_on);
-- le code d'enquêteur est unique DANS un prestataire (deux homonymes de prestataires différents restent possibles)
CREATE UNIQUE INDEX uq_tpm_agents_code ON tpm_agents (tenant_id, tpm_provider_id, lower(code)) WHERE code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_contracts_partner ON contracts (tenant_id, partner_id);
```
(L'extension `citext` est déjà installée, migration 001.)

**054_trainings.sql** (lot F)
```sql
CREATE TABLE training_themes (id uuid PK, tenant_id …, code text NOT NULL, label text NOT NULL CHECK (length(label) BETWEEN 1 AND 160),
  active boolean NOT NULL DEFAULT true, UNIQUE (tenant_id, code));
CREATE TABLE training_sessions (id uuid PK, tenant_id …,
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 200), objective text,
  start_date date NOT NULL, end_date date NOT NULL, CHECK (end_date >= start_date),
  admin_area_id uuid REFERENCES admin_areas(id) ON DELETE SET NULL, place_label text,
  field_office_id uuid REFERENCES field_offices(id) ON DELETE SET NULL,
  trainer text, organiser_partner_id uuid REFERENCES partners(id) ON DELETE SET NULL,   -- NULL = interne
  form_id uuid REFERENCES monitoring_forms(id) ON DELETE SET NULL,                     -- fiche concernée
  status text NOT NULL DEFAULT 'planifiee' CHECK (status IN ('planifiee','en_cours','terminee','annulee')),
  pass_mark numeric(5,2) NOT NULL DEFAULT 70 CHECK (pass_mark BETWEEN 0 AND 100),
  origin text NOT NULL DEFAULT 'saisie' CHECK (origin IN ('saisie','reprise')),
  legacy_key text, UNIQUE (tenant_id, legacy_key),
  created_by uuid REFERENCES users(id), created_at …, updated_at …);
CREATE INDEX idx_training_sessions_date ON training_sessions (tenant_id, start_date);
CREATE TABLE training_session_themes (tenant_id …, session_id uuid REFERENCES training_sessions ON DELETE CASCADE,
  theme_id uuid REFERENCES training_themes ON DELETE RESTRICT, hours numeric(5,1) CHECK (hours IS NULL OR hours > 0),
  sort_order int NOT NULL DEFAULT 0, PRIMARY KEY (session_id, theme_id));
CREATE TABLE training_participants (tenant_id …, session_id uuid REFERENCES training_sessions ON DELETE CASCADE,
  agent_id uuid REFERENCES tpm_agents ON DELETE RESTRICT,          -- un agent avec historique se désactive, il ne se supprime pas
  provider_id uuid REFERENCES partners(id) ON DELETE SET NULL,     -- prestataire au moment de la session
  status text NOT NULL DEFAULT 'inscrit' CHECK (status IN ('inscrit','annule')),
  satisfaction smallint CHECK (satisfaction BETWEEN 1 AND 5), comment text CHECK (length(comment) <= 1000),
  PRIMARY KEY (session_id, agent_id));
CREATE TABLE training_attendance (tenant_id …, session_id uuid, agent_id uuid, day date NOT NULL, present boolean NOT NULL,
  PRIMARY KEY (session_id, agent_id, day),
  FOREIGN KEY (session_id, agent_id) REFERENCES training_participants (session_id, agent_id) ON DELETE CASCADE);
CREATE TABLE training_assessments (id uuid PK, tenant_id …, session_id uuid REFERENCES training_sessions ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('pre_test','post_test','quiz','pratique')), label text,
  max_score numeric(6,2) NOT NULL CHECK (max_score > 0), held_on date,
  form_id uuid REFERENCES monitoring_forms(id) ON DELETE SET NULL,
  UNIQUE (id, max_score));
CREATE UNIQUE INDEX uq_training_prepost ON training_assessments (session_id, kind) WHERE kind IN ('pre_test','post_test');
-- « note ≤ barème » imposée PAR LA BASE grâce à une clé étrangère composite
CREATE TABLE training_scores (tenant_id …, assessment_id uuid NOT NULL, max_score numeric(6,2) NOT NULL,
  agent_id uuid NOT NULL REFERENCES tpm_agents ON DELETE RESTRICT,
  score numeric(6,2) NOT NULL CHECK (score >= 0 AND score <= max_score),
  FOREIGN KEY (assessment_id, max_score) REFERENCES training_assessments (id, max_score) ON UPDATE CASCADE ON DELETE CASCADE,
  PRIMARY KEY (assessment_id, agent_id));
-- Reprise non destructive de tpm_agent_formations (table conservée) :
--   thèmes = valeurs distinctes de lower(btrim(regexp_replace(thematique,'\s+',' ','g')))  (pas d'unaccent en base)
--   une session « terminee », origin 'reprise', legacy_key = thème normalisé || '|' || date, ON CONFLICT DO NOTHING
--   end_date = start_date + greatest(ceil(jours),1) − 1 ; participants « inscrit » ; présence non renseignée (aucune ligne)
--   date absente → created_at::date, avec la mention « date inconnue (reprise) »
```
Les règles « jour de présence compris entre début et fin » et « participant inscrit pour avoir une note » sont contrôlées par zod et par le service, et testées.

**055_risk_frequency.sql** (lot G)
```sql
CREATE TABLE monitoring_risk_frequency (tenant_id …, risk_level text NOT NULL CHECK (risk_level IN ('faible','moyenne','elevee')),
  interval_months int NOT NULL CHECK (interval_months BETWEEN 1 AND 12),
  confirmed boolean NOT NULL DEFAULT false, updated_by uuid REFERENCES users(id), updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, risk_level));
INSERT INTO monitoring_risk_frequency (tenant_id, risk_level, interval_months)
  SELECT t.id, v.l, v.m FROM tenants t CROSS JOIN (VALUES ('elevee',1),('moyenne',2),('faible',3)) v(l,m)
  ON CONFLICT DO NOTHING;
```
Ordre de priorité, avec la source toujours renvoyée : exigence de suivi bureau × activité (AL-9, M6) > fréquence selon le risque > constante par défaut (`rbmMath.js:11`, conservée en repli pour un nouveau tenant).

**056_submissions_list_index.sql** (lot J)
`CREATE INDEX … ON monitoring_submissions (tenant_id, period_month, submitted_at DESC, id)`, pour la pagination keyset de Formulaires reçus, toutes fiches confondues.

**057_submission_quality.sql** (lot K, après 048)
```sql
ALTER TABLE monitoring_submissions
  ADD COLUMN agent_id          uuid REFERENCES tpm_agents(id) ON DELETE SET NULL,
  ADD COLUMN tpm_provider_id   uuid REFERENCES partners(id) ON DELETE SET NULL,      -- distinct du partenaire de mise en œuvre
  ADD COLUMN agent_status      text CHECK (agent_status IS NULL OR agent_status IN
                                 ('code','normalise','alias','unique','a_valider','ambigu','introuvable','absent')),
  ADD COLUMN completeness      numeric(5,4) CHECK (completeness BETWEEN 0 AND 1),
  ADD COLUMN duration_min      numeric(8,1) CHECK (duration_min >= 0),
  ADD COLUMN has_gps           boolean,
  ADD COLUMN upload_delay_days numeric(7,2) CHECK (upload_delay_days >= 0),
  ADD COLUMN dup_key           text,
  ADD COLUMN duplicate_of      uuid REFERENCES monitoring_submissions(id) ON DELETE SET NULL,
  ADD COLUMN quality_version   int;
CREATE INDEX idx_mon_sub_agent    ON monitoring_submissions (tenant_id, agent_id, period_month);
CREATE INDEX idx_mon_sub_provider ON monitoring_submissions (tenant_id, tpm_provider_id, period_month);
CREATE INDEX idx_mon_sub_dup      ON monitoring_submissions (tenant_id, form_id, dup_key) WHERE dup_key IS NOT NULL;
-- File et correspondances de type 'agent' : si 048 n'est pas encore écrite au moment d'AL-3, y inclure 'agent'
-- dans le CHECK de location_aliases.kind et location_match_queue.kind ; sinon, cette migration remplace la contrainte
-- (DROP CONSTRAINT … ; ADD CONSTRAINT … CHECK (kind IN ('zone','bureau','partenaire','mot','agent'))).
-- Pour 'agent' : parent_key = identifiant du prestataire (ou '') → les homonymes de prestataires différents restent distincts.
```

**058_agent_evaluation.sql** (lot L)
```sql
CREATE TABLE evaluation_methods (id uuid PK, tenant_id …, family_id uuid NOT NULL,          -- même valeur pour toutes les versions
  scope text NOT NULL CHECK (scope IN ('agent','prestataire')),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 120), version int NOT NULL CHECK (version >= 1),
  status text NOT NULL DEFAULT 'brouillon' CHECK (status IN ('brouillon','active','archivee')),
  period text NOT NULL DEFAULT 'mois' CHECK (period IN ('mois','trimestre')),
  scale_max int NOT NULL DEFAULT 20 CHECK (scale_max IN (20,100)),
  auto_weight int NOT NULL CHECK (auto_weight BETWEEN 0 AND 100),
  qual_weight int NOT NULL CHECK (qual_weight BETWEEN 0 AND 100), CHECK (auto_weight + qual_weight = 100),
  min_submissions int NOT NULL DEFAULT 10 CHECK (min_submissions >= 1),
  min_coverage_pct int NOT NULL DEFAULT 60 CHECK (min_coverage_pct BETWEEN 1 AND 100),
  bands jsonb NOT NULL CHECK (jsonb_typeof(bands) = 'array'),
  created_by uuid REFERENCES users(id), created_at …, activated_by uuid REFERENCES users(id), activated_at timestamptz,
  UNIQUE (tenant_id, family_id, version));
CREATE UNIQUE INDEX uq_eval_method_active ON evaluation_methods (tenant_id, scope) WHERE status = 'active';
CREATE TABLE evaluation_criteria (id uuid PK, tenant_id …, method_id uuid NOT NULL REFERENCES evaluation_methods ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('auto','qualitatif')), code text NOT NULL, label text NOT NULL, sort_order int NOT NULL DEFAULT 0,
  metric text CHECK (metric IS NULL OR metric IN ('volume','ecartes','completude','delai','duree','gps','doublons','controle',
                     'indicateur','post_test','couverture','ponctualite_rapports','rejet_factures','consommation_plan','moyenne_agents')),
  form_id uuid REFERENCES monitoring_forms(id) ON DELETE RESTRICT,
  indicator_id uuid REFERENCES monitoring_indicators(id) ON DELETE RESTRICT,
  weight numeric(6,2) NOT NULL CHECK (weight > 0), floor numeric, target numeric,
  CHECK (kind = 'qualitatif' OR (metric IS NOT NULL AND floor IS NOT NULL AND target IS NOT NULL AND floor <> target)),
  params jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(params) = 'object'),
  descriptors jsonb,                                                    -- qualitatif : libellés 1 à 4
  UNIQUE (method_id, code));
-- Trigger : tout INSERT/UPDATE/DELETE de evaluation_criteria, et tout UPDATE de evaluation_methods hors status,
-- est refusé si la méthode n'est pas 'brouillon' (RAISE … USING ERRCODE = 'check_violation' → 400).
CREATE TABLE agent_scores (tenant_id …, agent_id uuid REFERENCES tpm_agents ON DELETE CASCADE,
  period_month date NOT NULL CHECK (extract(day FROM period_month) = 1),
  method_id uuid NOT NULL REFERENCES evaluation_methods ON DELETE RESTRICT,     -- identifie une VERSION
  submissions int NOT NULL CHECK (submissions >= 0), coverage_pct numeric(5,2),
  status text NOT NULL CHECK (status IN ('note','donnees_insuffisantes','non_evaluable')),
  score numeric(5,1) CHECK (score IS NULL OR score BETWEEN 0 AND 100), CHECK ((status = 'note') = (score IS NOT NULL)),
  details jsonb NOT NULL, computed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (agent_id, period_month, method_id));
ALTER TABLE tpm_agent_evaluations
  ADD COLUMN method_id uuid REFERENCES evaluation_methods(id) ON DELETE RESTRICT,
  ADD COLUMN auto_score numeric(5,1), ADD COLUMN auto_detail jsonb,
  ADD COLUMN qual_score numeric(5,1), ADD COLUMN final_score numeric(5,1), ADD COLUMN band text,
  ADD COLUMN status text NOT NULL DEFAULT 'validee' CHECK (status IN ('brouillon','soumise','validee')),  -- lignes existantes
  ADD COLUMN submitted_at timestamptz, ADD COLUMN validated_by uuid REFERENCES users(id), ADD COLUMN validated_at timestamptz,
  ADD COLUMN reopened_by uuid REFERENCES users(id), ADD COLUMN reopened_at timestamptz, ADD COLUMN reopen_reason text,
  ADD CONSTRAINT eval_separation_des_taches CHECK (validated_by IS NULL OR evaluated_by IS NULL OR validated_by <> evaluated_by),
  ADD CONSTRAINT eval_validee_complete CHECK (status <> 'validee' OR method_id IS NULL
        OR (validated_by IS NOT NULL AND validated_at IS NOT NULL AND auto_detail IS NOT NULL));
ALTER TABLE tpm_agent_evaluations ALTER COLUMN status SET DEFAULT 'brouillon';
CREATE UNIQUE INDEX uq_agent_eval_period ON tpm_agent_evaluations (agent_id, periode, method_id) WHERE method_id IS NOT NULL;
CREATE TABLE tpm_agent_evaluation_answers (tenant_id …, evaluation_id uuid REFERENCES tpm_agent_evaluations ON DELETE CASCADE,
  criterion_id uuid REFERENCES evaluation_criteria ON DELETE RESTRICT,
  rating smallint NOT NULL CHECK (rating BETWEEN 1 AND 4), comment text CHECK (length(comment) <= 1000),
  PRIMARY KEY (evaluation_id, criterion_id));
```
Les anciennes lignes de `tpm_agent_evaluations` (note saisie, `method_id` NULL) restent lisibles dans Historique sous l'étiquette « ancienne évaluation ».

### 6.7 Modules purs et tests

| Module (sans I/O) | Ce qu'il décide | Tests (`server/test/`) |
|---|---|---|
| `settings/healthRules.js` | statut, message et lien de chaque règle de santé | seuils, `non_mesurable`, ordre de gravité |
| `home/tasks.domain.js` | tâches et alertes selon le rôle, gravité, liens | **parité** avec les règles actuelles d'AlertsPage, filtrage par rôle |
| `home/monthFlow.js` | état des 5 étapes du mois et action principale | chaque transition, mois clos, prérequis bloquant |
| `tpm/placeSheet.js` | échéance (exigence > fréquence risque > défaut, avec source), état du mois, liaisons d'un site ou d'une localité | priorité des sources, liaison par nom = « non vérifiée » |
| `tpm/rbmMath.js` (étendu) | `isDue` avec une table de fréquences en paramètre | MMR prioritaire, repli sur la table, puis sur la constante |
| `partners/partnerSheet.js` | 4 faits, zones calculées, assemblage de la frise | frise triée et bornée, prestataire sans contrat |
| `trainings/trainingMath.js` | présence, %, progression, gain normalisé, réussite, synthèses | pré-test à 100 %, absents, note au barème maximal |
| `common/personMatch.js` | normalisation des noms de personne, résolution d'agent | mots inversés, homonymes de deux prestataires, approximatif jamais appliqué |
| `monitoring/submissionQuality.js` | complétude (avec `relevant`), durée, GPS, délai, clé de doublon | champ `relevant` non évaluable, GPS hors pays, délai négatif |
| `evaluation/agentScore.js` | sous-scores, couverture du poids, seuils, bandes, note finale, détail | les deux sens, données insuffisantes, couverture < 60 %, sans qualitatif, arrondi |

**API des nouveaux modules.**
- Toutes les routes ont zod en entrée et le tenant pris de `req.auth`.
- Lecture pour tous les rôles authentifiés. Écritures avec `requireRole('admin','manager')`, sauf la méthode de notation (administrateur).
- Points d'accès :
  - `/api/trainings` : sessions, participants, présence, épreuves, notes, modèle et import Excel des notes ;
  - `/api/evaluation` :
    - `GET /scores?mois=` ;
    - `GET`, `POST` et `PATCH /methods` ; `POST /methods/:id/simulate?mois=` ; `POST /methods/:id/activate` ;
    - `POST /evaluations`, `PATCH /evaluations/:id`, `POST /evaluations/:id/submit`, `POST /evaluations/:id/validate`, `POST /evaluations/:id/reopen` ;
    - `POST /recompute?mois=`.
- Les écritures sur plusieurs tables (session et participants, présence, notes, évaluation et réponses, validation) passent par `withTenantTransaction`. Les grilles sont écrites en **une** instruction multi-lignes (`db/batch.js`).

---

## 7. Plan de mise en œuvre par lots

**Pour chaque lot :**
- il est consigné dans `docs/JOURNAL.md`, avec l'heure UTC, le statut, le commit et le résultat des vérifications, puis commité et poussé à chaque mise à jour ;
- **vérifications communes** : `cd server && npm test`, `npm run lint`, `cd web && npm run build` (avec `check-links`), `node --test web/src/lib`, et le balayage Playwright FR et EN (anciennes et nouvelles adresses, 0 erreur console ou API) ;
- CLAUDE.md est mis à jour dès qu'un lot change la navigation ou ajoute une règle.

**État des prérequis issus de l'analyse des liaisons**

| Lot AL | État | Utilisé par |
|---|---|---|
| AL-0 (correctifs de chiffres et de droits) | Livré, relecture adverse en cours | tous |
| AL-1 (découpage sans casse) | Livré | lots B, H |
| AL-2 (`placeMatch`) | Livré | lot K |
| AL-3 (048, sites et bureaux rattachés) | À faire | lots G et H, puis K |
| AL-4 (formulaires reliés) | À faire | lots H, J, K |
| AL-5 (PDD relié) | À faire | onglets Distributions |
| AL-6 (écrans « À rapprocher » et alias) | À faire | **absorbé par le lot H** (montés dans Qualité des données au lieu de Paramétrage › Localités) |
| AL-7 (liaisons visibles) | À faire | **absorbé par le lot B** |
| AL-8 (identité unique des sites, H6, H7) | À faire | lots G et I |
| AL-9 (exigences de suivi partout, M6, M7) | À faire | lots G et I |

**Vue d'ensemble des lots**

| Lot | Contenu | Migration | Risque | Dépend de |
|---|---|---|---|---|
| A | Navigation, adresses, redirections | aucune | faible | — |
| B | Liaisons visibles, état de la configuration | aucune | faible | A |
| C | Accueil, À traiter, cloche, recherche | aucune | faible | A, B |
| D | Pilotage : Tableau de bord, Suivi budgétaire, Rapports | aucune | faible à moyen | A |
| E | Partenaires : liste unique, fiche 360°, équipe | 053 | faible à moyen | A |
| F | Formations structurées | 054 | moyen | E |
| G | Sites : registre unique, fiche site, fréquences | 055 | moyen | AL-3 ; AL-8 souhaité |
| H | Localités et Qualité des données | aucune | moyen | AL-3, AL-6 (absorbé) ; AL-4 et AL-5 pour certains onglets |
| I | Visites (Année / Mois) et Couverture | aucune | moyen | G, AL-8 (H6), AL-9 |
| J | Fiches de suivi et Formulaires reçus | 056 | moyen | AL-4 |
| K | Formulaires reliés aux agents, qualité des formulaires | 057 | moyen à élevé | AL-3 (048), AL-4, J |
| L | Note automatique, appréciation qualitative, performance | 058 | élevé | K, F |
| M | Listes portail partout, nettoyage, documentation | aucune | faible | tous |

### Lot A : navigation, adresses et redirections (aucune migration, aucun changement serveur)

- **Fichiers**
  - Nouveaux : `web/src/lib/routes.js`, `web/src/lib/routes.test.mjs`, `web/src/lib/nav.jsx` (`NavProvider`, `useNav`, `MonthContext`), `web/scripts/check-links.mjs`.
  - Modifiés : `web/src/App.jsx` (table clé → composant, `parseHash` avec query, `REDIRECTS`), `web/src/components/AppShell.jsx` (deux niveaux, 6 groupes, fil d'Ariane Groupe › Page › Objet), `web/src/components/HeaderMenus.jsx` (menu du compte vers Réglages), `web/package.json` (scripts `test` et `prebuild`), `web/src/locales/en/*.js` (clés `nav.*`).
- **Montage des pages existantes sans toucher à leur logique**, par des conteneurs à onglets :
  - Suivi budgétaire = ConsolidationPage + graphiques de DashboardBIPage ;
  - Tableau de bord = ProcessDashboardPage + DashboardCoveragePage, toutes vues comprises ;
  - Rapports = ReportDesignerPage + ReportingPage (onglet provisoire) ;
  - Sites = RbmPage (vue Priorités) + SitesMapPage (vue Carte) ;
  - Visites = PlanBoardPage (Année, **toutes ses vues conservées**) + FieldVisitsPage (Mois) ;
  - Partenaires = ProvidersPage + PartnersSection (onglets) ;
  - Réglages = SettingsPage (onglets Activités/MMR, Taux/pays, Bureaux, Utilisateurs) ;
  - PddPage sous Distributions d'urgence.
  
  La route par défaut reste Contrats jusqu'au lot C.
- **Suppressions** : code mort (`AssignmentPage.jsx`, `MissionCalendarDrawer.jsx`, `contracts/ContractFormDrawer.jsx`).
- **Tests** : `routes.test.mjs` (chaque adresse de 2.3 redirigée, aucune orpheline, 6 entrées au plus par groupe, aller-retour avec query).
- **Critères de vérification**
  - Chaque adresse actuelle, y compris `#/contrats/liste/:id/amend`, arrive sur sa nouvelle page.
  - « Créer la facture » depuis un plan ouvre la facture préremplie, par l'adresse et par l'ancienne clé de sessionStorage.
  - 0 erreur Playwright en FR et en EN.
  - `grep` ne trouve plus aucun import des trois fichiers supprimés.

### Lot B : liaisons visibles et état de la configuration (AL-7, étendu)

- **Serveur** :
  - `server/src/modules/settings/health.repository.js`, `healthRules.js`, routes `GET /api/settings/health` et `GET /api/settings/usage` dans `settings.routes.js` ;
  - `shared/healthCodes.json` ;
  - les règles marquées « AL-3 », « AL-4 » ou « lot … » en 4.2 renvoient `non_mesurable`.
- **Web** :
  - `web/src/components/Links.jsx` (`PageLinks`, `ConfigLink`, `MissingConfig`, `SourceTag`, `ObjectLink`, `UsedBy`, `CycleBar`), `web/src/lib/health.jsx` (`useHealth`) ;
  - `deps` déclarés dans `routes.js` ;
  - page Réglages › Vue d'ensemble avec le tableau « prêt / à compléter » ;
  - encart « Utilisé par » sur chaque page de réglage ;
  - remplacement de tous les textes « Paramétrage › … » par `ConfigLink` ;
  - textes faux corrigés : PddPage.jsx:221, ConsolidationPage.jsx:230, LocalitiesSection.jsx:115-118 ;
  - `web/scripts/check-owners.mjs` (avertissement).
- **Tests** : `server/test/healthRules.test.js` (chaque règle, seuils, `non_mesurable`). Contrôle Playwright : aucun « Paramétrage › » hors d'un lien, et chaque `ConfigLink` mène à une page existante.
- **Critères de vérification**
  - `/api/settings/health` répond en moins de 150 ms sur `seed:test` (contrôle `EXPLAIN`, requêtes indexées).
  - Sur un tenant neuf, Réglages › Vue d'ensemble affiche « Bloquant » sur `decoupage`, `tpm_absent` et `valideurs`.
  - Aucune règle n'affiche 0 alors qu'elle n'est pas mesurable.

### Lot C : Accueil, À traiter, cloche et recherche

- **Serveur** : module `server/src/modules/home/` (`home.routes.js`, `home.controller.js`, `home.service.js`, `home.repository.js`, `inbox.repository.js`, `tasks.domain.js`, `monthFlow.js`, `search.repository.js`) ; montage dans `server/src/app.js` (`/api/home`, `/api/search`).
- **Web** :
  - pages `web/src/pages/home/HomePage.jsx` et `web/src/pages/home/TodoPage.jsx` (onglets À valider, Alertes, Réglages) ;
  - cloche reliée à `/api/home/count` ;
  - recherche globale (Ctrl+K) dans l'en-tête ;
  - `DEFAULT_ROUTE = pilotage/accueil` ;
  - AlertsPage remplacée par TodoPage (redirection).
- **Tests** :
  - `tasks.domain.test.js` (parité avec AlertsPage, filtrage par rôle) ;
  - `monthFlow.test.js` ;
  - test d'échappement des motifs de recherche (`%`, `_`, `\`).
- **Critères de vérification**
  - Mêmes alertes qu'avant sur `seed:test` (comparaison ligne à ligne).
  - L'Accueil n'émet qu'un appel `summary` et un appel `tasks`, sans télécharger la liste des sites.
  - Avec un compte lecteur : aucun bouton d'action.
  - Un rapport soumis par l'utilisateur lui-même n'apparaît pas dans « À valider ».

### Lot D : Pilotage (fusions sans nouveau calcul)

- **Fichiers** :
  - Tableau de bord unique : ProcessDashboardPage + DashboardCoveragePage, les unités de « Plan vs réalisé » étant corrigées (M17) ;
  - Suivi budgétaire avec `?du=&au=` ;
  - **H10** : `{from, to}` dans `consolidation.repository.js` et `reports.service.js` ;
  - modèle « Synthèse S&E du mois » dans `reportTemplates.js`, avec un nouveau jeu de données `district_coverage` (`reportModel.js`, `reportData.js`) ;
  - bouton « Éditer dans Rapports » depuis le Bulletin.
- **Retraits après parité vérifiée** :
  - onglet ReportingPage (exports CSV maintenus dans Suivi budgétaire et Couverture) ;
  - vue Bulletin de DashboardCoveragePage ;
  - vue Carte de DashboardCoveragePage, remplacée par la couche « couverture par district » de `SitesMap` (livrée au lot G ; d'ici là, la vue reste).
- **Tests** : `consolidation.test.js` (période bornée), `reportData.test.js` (`district_coverage`).
- **Critères de vérification** : liste de contrôle de parité ReportingPage → modèle (chaque chiffre et chaque export, consignée au journal) ; consolidation identique à l'ancienne quand la période couvre tout l'historique.

### Lot E : Partenaires, liste unique, fiche 360° et équipe (migration 053)

- **Fichiers**
  - Migration `053_partner_profile.sql`.
  - Module `server/src/modules/partners/` (routes, controller, service, repository, `partnerSheet.js`) ; montage `/api/partners`.
  - B4 corrigé dans `settings.repository.js`. Alias des anciennes routes d'agents.
  - Web : `web/src/pages/partners/PartnersListPage.jsx`, `PartnerSheetPage.jsx`, `PartnerForm.jsx`, `AgentDrawer.jsx`.
  - Fiche contrat : onglet « Plans & factures » et nom du partenaire en `ObjectLink`.
- **Retraits** : AgentsModal (ProvidersPage), modale « Nouvel agent » de SettingsPage, `contract_ref` qui n'est plus affiché.
- **Tests** :
  - `partnerSheet.test.js` (frise triée et bornée, faits) ;
  - test de non-régression du PATCH partiel ;
  - unicité du code d'enquêteur dans un même prestataire (deux homonymes dans deux prestataires sont acceptés) ;
  - suppression d'un agent ayant un historique refusée, avec « désactivez-le ».
- **Critères de vérification**
  - Un partenaire TPM de `seed:test` affiche ses contrats, ses visites, ses factures et ses agents avec les mêmes montants que Suivi budgétaire.
  - Test manuel avec deux tenants : aucune ligne croisée dans la frise.
  - Un gestionnaire peut ajouter un agent (si le point 8.6 est validé).

### Lot F : Formations structurées (migration 054)

- **Fichiers** :
  - migration `054_trainings.sql`, reprise comprise ;
  - module `server/src/modules/trainings/` (routes, controller, service, repository, `trainingMath.js`, `trainingScoresXlsx.js`) ;
  - web `web/src/pages/partners/TrainingsListPage.jsx` et `TrainingSessionPage.jsx` ;
  - onglets Formations des fiches agent et partenaire ;
  - onglet Thèmes.
- **Retrait** : FormationsPage (redirection).
- **Tests** :
  - `trainingMath.test.js` ;
  - aller-retour du modèle Excel des notes ;
  - note supérieure au barème refusée par la base (23514 → 400) ;
  - baisse d'un barème sous une note existante refusée.
- **Critères de vérification**
  - Rapport de reprise consigné au journal : nombre de lignes `tpm_agent_formations` = nombre de participants repris ; sessions créées par thème et date.
  - Saisie de la présence de 20 agents sur 3 jours en une seule écriture.
  - Bilan identique au calcul à la main sur un jeu d'exemple.

### Lot G : Sites, registre unique, fiche site et fréquences (migration 055)

- **Prérequis** : AL-3 livré (pcode et bureau posés par toutes les écritures de site). AL-8 de préférence ; à défaut, badge « doublon possible ».
- **Fichiers**
  - Migration `055_risk_frequency.sql`.
  - `rbmMath.js` étendu ; `placeSheet.js` ; `GET /api/tpm/field/sites/:id/sheet` (`field.routes.js`, `field.repository.js`) ; onglet Fréquences dans Activités & exigences.
  - Web : `web/src/pages/sites/SitesPage.jsx` (DataList portail, vues Liste, Carte et Priorités), `SiteSheetPage.jsx`, `SiteForm.jsx`.
  - Composant carte unique `web/src/components/SitesMap.jsx`, extrait de SitesMapPage, avec couches et centre lu dans le profil pays (B1).
  - Assistant `web/src/components/ImportWizard.jsx` : reconnaissance du modèle par les en-têtes (M14), aperçu, `ImportMatchReport`. C'est le même composant que le futur centre d'import d'AR-R6, sans doublon.
- **Retraits, une fois l'équivalent vérifié** : vues Registre et Carte de PlanBoardPage, modale de critères de RbmPage, modale « Nouveau site » de FieldVisitsPage.
- **Tests** : `placeSheet.test.js`, `rbmMath.test.js` (ordre des sources de fréquence).
- **Critères de vérification**
  - Liste de contrôle des fonctions déplacées, chacune testée par Playwright : ajout, modification groupée, gabarit, import et export Locations, critères, carte.
  - La fiche d'un site sans code de commune affiche « non reconnue → Qualité des données » et jamais une date de collecte inventée.
  - Changer le risque ne modifie ni l'activité ni le fokontany.

### Lot H : Localités et Qualité des données (absorbe les écrans d'AL-6)

- **Fichiers** :
  - `GET /api/tpm/field/localities/:areaId/sheet` ;
  - web `web/src/pages/sites/LocalitiesPage.jsx` (explorateur et compteurs), `LocalitySheetPage.jsx`, onglet Découpage (LocalitiesSection déplacée) ;
  - `web/src/pages/data/QualityPage.jsx`, avec les composants `MatchQueue` et `AliasList` d'AL-6 montés une seule fois (onglets Lieux, Correspondances ; Écartés = composant Formulaires reçus filtré) ;
  - onglet « Zones & sites » de la fiche contrat (B14, via `contract_areas.pcode` de 048).
- **Tests** : test de `decide` (transaction, verrou) livré par AL-6 ; `placeSheet.test.js` complété (taux de rattachement).
- **Critères de vérification**
  - Une décision dans la file met à jour le compteur de la fiche localité et l'état `lieux_a_rapprocher` sans rechargement manuel.
  - Les fiches localité s'ouvrent même sans codes officiels (démo B5).

### Lot I : Visites (Année et Mois) et Couverture

- **Prérequis** : AL-8 (index unique avec `COALESCE(activity, '')`, H6) et AL-9 (exigences lues par Générer, M6).
- **Fichiers**
  - Une seule page `web/src/pages/sites/VisitsPage.jsx` avec bascule Année (PlanBoardPage réduite à la planification) / Mois (FieldVisitsPage réduite à l'affectation, la réalisation et la situation du mois).
  - « Planifier les sites à suivre de <mois> » (`rbm/generate`) à cet endroit seulement.
  - Panneau « Jours à budgéter ». Dans PlanBudgetDrawer, `SourceTag` et proposition « taux journalier × jours », qui rend B1 effectif. La règle « jours-agent = dates distinctes par agent » relève d'AR-R2 et doit être validée (point 8.10).
  - Couverture : CoverageRecapPage + vue Mois (cartes par prestataire et par district reprises de FieldVisitsPage).
- **Retraits** : onglets « Couverture & budget » et « Données réelles » de FieldVisitsPage, bouton Générer de RbmPage.
- **Tests** : `fieldMath.test.js` (inchangé, sauf AR-R2) ; test « les deux points d'entrée de planification écrivent par le même service et ne dupliquent pas ».
- **Critères de vérification**
  - Planifier deux fois le même mois ne crée aucun doublon.
  - Les chiffres de Couverture sont identiques à ceux de l'ancien onglet sur `seed:test`.

### Lot J : Fiches de suivi et Formulaires reçus (migration 056)

- **Prérequis** : AL-4 (formulaires reliés par code).
- **Étape 1, commit séparé, comportement constant** : découpage de `ProcessMonitoringPage.jsx` (1 067 lignes) en `FormConfig`, `SubmissionsTable`, `SubmissionDrawer`, `ImportCard`, `IndicatorsList`.
- **Étape 2, déplacement** :
  - fiche de suivi `/:formId/` avec onglets Résultats, Formulaires reçus, Sites, Variables, Réglages ; l'onglet Agents arrive au lot K ;
  - page transversale Formulaires reçus avec `DataList` en mode serveur (keyset sur `submitted_at, id`) et `GET /api/monitoring/submissions` étendu (fiche, mois, code commune, prestataire, agent, état de liaison, écarté) ;
  - migration `056_submissions_list_index.sql`.
- **Tests** : `savParser` et `submissionsImport` inchangés ; test de pagination keyset (pas de doublon ni de saut entre pages).
- **Critères de vérification**
  - Import .sav, .zip Kobo, API Kobo et lien ONA/MoDA identiques avant et après (Playwright).
  - Page de 25 lignes en moins de 300 ms sur 100 000 formulaires (`EXPLAIN` utilisant l'index).

### Lot K : formulaires reliés aux agents et qualité des formulaires (migration 057)

- **Prérequis** : 048 (AL-3) avec le type `agent`, AL-4, lot J.
- **Fichiers**
  - Migration `057_submission_quality.sql`.
  - `server/src/modules/common/personMatch.js` (Jaro-Winkler réexporté de `placeMatch.js`).
  - `server/src/modules/monitoring/submissionQuality.js`, branché sur `importSubmissions`.
  - Dimension « Prestataire de suivi » dans `memsMapping.js`.
  - Job worker `quality-backfill` déclenché par l'outbox.
  - Onglet Qualité des données › Agents, avec « Lier à un agent » et « Créer l'agent chez <prestataire> ».
  - Onglet Agents de la fiche de suivi.
- **Tests** : `personMatch.test.js`, `submissionQuality.test.js`, et un test d'intégration de l'import, qui doit poser `agent_id`, les mesures et `duplicate_of` dans la même transaction.
- **Critères de vérification**
  - Sur un export réel anonymisé : taux d'agents reconnus affiché, aucun rapprochement approximatif appliqué sans décision.
  - Le rattrapage de 100 000 lignes se fait par le worker sans bloquer l'API (latence de la boucle d'événements inférieure à 200 ms, critère d'AR-R5).

### Lot L : note automatique, appréciation qualitative et performance (migration 058)

- **Fichiers**
  - Migration `058_agent_evaluation.sql`, trigger de gel compris.
  - Module `server/src/modules/evaluation/` (routes, controller, service, repository, `agentScore.js`) ; job worker `agent-scores`.
  - Méthode par défaut créée en **brouillon** pour chaque tenant : l'activation reste une décision humaine.
  - Web : `web/src/pages/partners/AgentsPage.jsx` (Notes du mois, Méthode avec simulation, Historique), `AgentSheetPage.jsx`, formulaire qualitatif, onglet Performance de la fiche partenaire (portée prestataire).
- **Retraits** : EvaluationPage, lecture de `tpm_assignments`, `GET /api/tpm/agents-evaluation` (au lot M).
- **Tests** :
  - `agentScore.test.js` : chaque critère dans les deux sens, poids, couverture minimale, minimum de formulaires, bandes, combinaison, arrondi ;
  - tests du service : séparation des tâches refusée par la base, validation sous verrou, gel du détail, méthode active non modifiable (400), réouverture avec motif.
- **Critères de vérification**
  - La simulation et le recalcul donnent la même note pour le même mois.
  - Une note validée reste identique après activation d'une nouvelle version.
  - Le détail « pourquoi cette note » se retrouve à la main à partir des agrégats affichés.

### Lot M : listes portail partout, nettoyage et documentation

- **Fichiers** :
  - `DataList` portail généralisée (ReportsPage, PlanningPage et ContractsListPage passent sur DataList ; le double-clic des contrats est conservé) ;
  - mode compact ;
  - suppression des composants remplacés (RbmPage et SitesMapPage autonomes, ancienne FormationsPage, EvaluationPage, AlertsPage, ReportingPage, ProcessDashboardPage, ancien point d'accès d'évaluation) ;
  - mise à jour de CLAUDE.md (navigation, conventions de fiche, nombre réel de tests), de `docs/ETAT_DU_PROJET.md` et du journal.
- **Règle** : chaque ligne de la table 2.3 est cochée au journal avant la suppression du code correspondant. Les `REDIRECTS` restent en place.
- **Critères de vérification** : `grep` ne trouve aucun import restant ; balayage Playwright complet en FR et en EN ; build, lint et tests au vert.

---

## 8. Points à faire valider par le responsable S&E

| # | Décision | Recommandation par défaut |
|---|---|---|
| 8.1 | Menu en 6 groupes et 24 entrées, organisé par objets (Pilotage, Sites & localités, Données collectées, Partenaires & TPM, Contrats & budget, Réglages) | Adopter. Les noms des groupes peuvent être ajustés sans impact technique. |
| 8.2 | Vocabulaire : Priorité (RBM), Exigences de suivi (MMR), Prestataire de suivi (TPM), Formulaires reçus, Code officiel, Réglages (au lieu de Paramétrage) | Adopter. Le sigle reste visible en infobulle. |
| 8.3 | Filtres libellés visibles au-dessus des listes (3 ou 4), alors que CLAUDE.md décrit un seul bouton « Filtres » | Adopter la forme « portail » de votre inspiration, toujours sans badge de comptage. |
| 8.4 | Ouverture d'une ligne : clic simple dans les listes sans sélection ; sélection puis double-clic dans Contrats et Sites ; bouton « Voir » partout | Adopter. |
| 8.5 | Plans de collecte et Factures quittent « Partenaires & TPM » pour « Contrats & budget », tout en restant visibles dans la fiche prestataire | Adopter. |
| 8.6 | Droits : le gestionnaire (responsable S&E) peut gérer les agents et les sessions de formation, aujourd'hui réservés à l'administrateur ; seul l'administrateur modifie la méthode de notation ; le validateur d'une évaluation est différent de l'évaluateur | Adopter. |
| 8.7 | Méthode de notation par défaut : critères, poids, planchers, cibles (6.5 c) ; part automatique/qualitative 60/40 ; 10 formulaires minimum ; couverture minimale 60 % ; bandes 16/12/10 | À ajuster, puis activer après une simulation sur le mois dernier. |
| 8.8 | Grille qualitative : 6 critères notés de 1 à 4, à poids égaux | À ajuster. |
| 8.9 | Dans vos formulaires Kobo : quelle colonne contient l'enquêteur et quelle colonne contient le **prestataire de suivi** ? La colonne « partner » est souvent le partenaire de mise en œuvre. | Déclarer une colonne « Prestataire de suivi » par fiche ; à défaut, la déduire de l'agent. |
| 8.10 | Jours à budgéter = dates distinctes par agent (13 jours-agent dans le planning AINA) plutôt que nombre de visites ; jours du superviseur saisis ou déduits | Dates distinctes (AR-R2) ; superviseur saisi. |
| 8.11 | Reprise des anciennes formations : une session par couple thème × date, présence « non renseignée » ; anciennes évaluations affichées « ancienne évaluation » | Adopter, avec un rapport de reprise à relire. |
| 8.12 | Fréquence de suivi selon le risque : élevé tous les mois, moyen tous les 2 mois, faible tous les 3 mois, sauf exigence de suivi plus précise | Confirmer ou ajuster. |
| 8.13 | Page d'arrivée de tous les utilisateurs = Accueil (les gestionnaires de contrats arrivaient sur Contrats) | Adopter : Contrats est à un clic et dans les tâches. |
| 8.14 | Le Rapport de synthèse devient un modèle de Rapports ; les exports CSV restent sur Suivi budgétaire et Couverture | Adopter après vérification de parité. |
| 8.15 | Formations : pré-test et post-test notés sur un barème libre, convertis en % ; seuil de réussite 70 % ; satisfaction de 1 à 5 ; participants limités aux agents des prestataires dans un premier temps | Adopter. Dites si le personnel des bureaux doit aussi pouvoir être inscrit. |
| 8.16 | Données personnelles des agents (téléphone, courriel, sexe) visibles seulement des rôles en écriture ; noms réels ou pseudonymes (question 10 d'ANALYSE_REFERENCES) | Visibles des rôles en écriture ; noms réels. |

---

## 9. Hors périmètre, à décider plus tard

- **Portail prestataire** (comptes pour les TPM, qui déposeraient eux-mêmes leurs factures et géreraient leurs agents). Il n'a pas été demandé. Il exigerait un nouveau rôle et un périmètre par partenaire, avec une double barrière : filtre applicatif et RLS restrictive. Une simple politique `coalesce(app.partner_id, '') = '' OR …` serait insuffisante, car elle laisse tout passer si la variable est oubliée. Il faudrait aussi une revue de sécurité dédiée. À envisager une fois les écrans stabilisés.
- **Profils métier par personne** (menus différents selon la personne). Écartés : le rôle existant suffit à filtrer les tâches et les boutons, et un menu identique pour tous facilite la formation et l'assistance.
- **Historique des modifications d'un site** (`site_events`, tenant_id, RLS, écrit dans la même transaction que chaque écriture de site). Il enrichirait la chronologie de la fiche site : changements de risque, de bureau, imports.
- **Performance prestataire étendue** : critères financiers fins par sous-poste, après AR-R8.
