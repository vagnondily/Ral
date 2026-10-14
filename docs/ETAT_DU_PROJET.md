# MEMS 2.0 — État du projet (fait / en cours / reste à faire)

_Mise à jour : 14 octobre 2026. `main` contient le lot 1 et tous les correctifs de fiabilité (dernier commit de code : `45493c7`). Le travail en cours avance sur la branche `claude/practical-meitner-2c1560` et sur des branches de reprise `wip/…`._

Documents de suivi, à lire dans cet ordre :

| Document | Contenu |
|---|---|
| [`JOURNAL.md`](JOURNAL.md) | Chaque action, avec son heure (UTC), son statut, son commit et ses vérifications. Le tableau « État courant » est en tête. |
| [`RETOURS_UTILISATEUR.md`](RETOURS_UTILISATEUR.md) | Chacun de vos retours (n° 1 à 57) : ce qu'il faut, la réponse prévue et son **état**. |
| [`PLAN_RETOURS_15_37.md`](PLAN_RETOURS_15_37.md) | Les définitions communes (visite, réalisée, site actif, couverture, période…) et l'ordre des lots. |
| [`SPEC_LOT_1B.md`](SPEC_LOT_1B.md), [`SPEC_LOT_6A.md`](SPEC_LOT_6A.md), [`SPEC_LOT_7A.md`](SPEC_LOT_7A.md) | Spécifications des lots en cours, avec les décisions prises et les corrections exigées par la critique. |
| [`ANALYSE_REFERENCES.md`](ANALYSE_REFERENCES.md), [`ANALYSE_LIAISONS.md`](ANALYSE_LIAISONS.md), [`REFONTE_UX.md`](REFONTE_UX.md) | Analyses de fond (vos fichiers réels, liaisons entre pages, refonte UX). |

## Santé du code sur `main`

| Contrôle | Résultat |
|---|---|
| Tests serveur (`cd server && npm test`) | **669** (668 réussis, 1 ignoré : il ne tourne qu'avec les exports réels) |
| Lint serveur (`npm run lint`) | propre |
| Build web (`cd web && npm run build`) | OK |
| Balayage navigateur (31 écrans, FR et EN) | 0 erreur console ou API, 0 phrase anglaise manquante |
| Migrations | `001` → `060` (061 à 064 arrivent avec les lots 6a et 7a) |

---

## ✅ Fait et publié sur `main`

### Jusqu'au 12 octobre (base de l'application)
- **Contrats** : cycle de vie complet, budget FLA par poste, avenants, aller-retour Excel.
- **Rapports TPM** : facture fidèle au modèle réel, avec export Excel et PDF.
- **Planification & budget** et **consolidation budgétaire**.
- **Suivi de processus** :
  - imports Kobo, ONA, SPSS, Excel et liens ;
  - XLSForm ;
  - indicateurs paramétrables ;
  - champs calculés et aide aux calculs ;
  - assistant d'import ;
  - correspondances bureau / partenaire / agent.
- **RBM et Plan de suivi (MMR)** ; **Affectation & visites**.
- **Tableaux de bord** : Synthèse, Couverture & performance, Vue d'ensemble, Centre d'alertes.
- **Distribution d'urgence (PDD)**.
- **Concepteur de rapport**, première version.
- **Paramétrage** : localités, bureaux, MMR, utilisateurs.
- Interface en **français et en anglais**.

### 12 et 13 octobre — fiabilité (relectures indépendantes, 4 tours)
- **Imports Excel sûrs.** Une garde lit chaque classeur en une passe, en temps linéaire. Elle refuse les fichiers piégés : fusions géantes, DOCTYPE, ouvertures non fermées. Les 14 classeurs réels donnent exactement les mêmes résultats qu'avant.
- **Écritures concurrentes sans blocage.** Un verrou des rattachements empêche les pertes de mises à jour, sans immobiliser les autres utilisateurs. Après 20 s d'attente, le message est « réessayez ».
- **Formules.** NOT, valeurs vides, `in()`, imbrication limitée.
- **Rien ne s'efface quand des données existent.** Un agent qui porte des données ne se supprime plus : il se désactive.
- **Exploitation.** Créer et migrer une autre base ne remet plus le mot de passe de `mems2_app` à sa valeur par défaut.

### 13 octobre — lot 1 (`45493c7`), retours 16, 19, 20, 31, 34, 35, 48
- **Mois de collecte = date d'enquête.**
  - Une soumission est rangée au mois de la première date d'enquête lisible.
  - Les envois groupés tardifs restent au mois réel de l'enquête (règle des 2 ans).
  - La vérification avant import annonce exactement ce que l'import écrira.
  - Le **Mapping MEMS** se modifie et suit un cycle brouillon → soumis → validé. La personne qui valide doit être différente de celle qui a soumis.
- **Indicateurs** :
  - un seul éditeur pour créer et modifier, sans perte ;
  - choix de la variable avec recherche et logique de saut ;
  - « Comment c'est calculé » en direct ;
  - écart à la cible cohérent avec la classe.
- **Tableaux de bord** :
  - période par défaut = dernier mois qui a des données ;
  - étiquettes de mois lisibles ;
  - bureaux nommés ;
  - « — aucun plan » au lieu de « 0 % » ;
  - raison de chaque « Non évalué » ;
  - cloche = Centre d'alertes.
- **RBM (retour 48)** :
  - « Pourquoi ? / Conséquence / Que faire ? » sur chaque drapeau ;
  - une visite seulement planifiée ne rend jamais un site « à jour » ;
  - « Générer » ne crée plus de doublons et respecte les annulations et les mois inactifs.
- **Zone centrale élargie** (retour 31).

---

## 🔄 En cours de réalisation (branches `wip/…`)

| Lot | Contenu | Où en est-on (14/10) |
|---|---|---|
| **1b** — période = plage de mois (retour 47) | Sélecteur « du … au … » avec préréglages (janvier–juin, 12 derniers mois…). Sites comptés une fois sur la période. Couverture (sites) et exécution du plan (visites) séparées. Budget de la période en centimes entiers. Tous les écrans concernés. | Socle (8 commits) et écrans (9 commits) **construits**. La requête des régions passe de **19 s à 10 ms**. La contre-vérification du socle a relevé 1 point grave (environ 200 sites dont le P-code de district contredit le district : regrouper par le district du site) et 4 moyens ; ils sont corrigés dans un seul tour avec les constats des écrans, puis le lot est publié. |
| **6a** — carte exploitable (retours 17, 27, 41, 44, 49, 50) | Contours des 120 districts, couleur par thème (sites actifs, visités, couverture, risque, données versées), sites placés par GPS ou par leurs collectes, points de collecte, légende, fiche au survol, classement, section Carte dans le Dashboard décisionnel, export image / A4. | Construit (12 commits), **en vérification**. |
| **7a** — concepteur de rapport riche (retours 18, 39, 40, 43, 45, 51–53) | Rendu rapide et progressif (fini la page blanche « Calcul… »). Catalogue de toutes les données de MEMS. En-tête et pied libres (logos, images, textes). Orientation par page. Fil de validation. Exports Word et PowerPoint. | En construction : rendu progressif fait, catalogue en cours. |
| **54** — tableau trimestriel par activité | Sites actifs / prévus / réalisés, couverture, taux d'exécution, couleurs, total, export. | Réalisé juste après les correctifs 1b (même service « sites × mois »). |
| **56** — suppression des documents | Non validé → supprimable après confirmation ; validé → seulement sans donnée reliée, avec justificatif ; journal des suppressions. | Une autre session Claude avait commencé ce retour : son travail est repris et corrigé, puis vérifié (voir le journal, 14/10 10:37). |
| **5 élargi** — plan MMR réaliste (retours 24, 25, 55) | Calendrier d'activités (durée réelle). Générateur de plan : au moins 80 % des sites, tournées par commune et district multi-activités, capacité par jour, intervalle ajusté, dernière visite, recommandations urgentes. Règles de priorité configurables. Risque par période avec historique. | **Conception** lancée le 14/10. |

## ⏳ Reste à faire (ordre décidé)

1. **Lots 2–3**, référentiels et registre des sites (retours 12, 14, 23, 32, 33, 36, 37, 38, 46, 57) :
   - activités et sous-activités ;
   - clés système immuables et suppression protégée partout ;
   - codes de bureau des formulaires ;
   - libellés et réponses « Autre » ;
   - zones du contrat en tableau ;
   - import du classeur d'activation (grille Oui / Non par mois) ;
   - import des sites avec GPS → rattachement au découpage ;
   - code de localité tiré du découpage (groupable par préfixe) ;
   - un site déclaré ou une commune rattaché à plusieurs sites (un par activité), et rapprochement par GPS dans les contours importés (retour 57) ;
   - Code POI proposé (fokontany + 00n).
2. **Lot 4**, réalisé issu des données (retours 15, 21, 22, 26) :
   - une soumission rattachée au site = visite réalisée, partout ;
   - mois « données sans plan » ;
   - plan P/R avec motif obligatoire quand on déclare une visite à la main ;
   - couverture par sous-activité et par bureau (sites uniques).

   C'est ce lot qui reproduira votre chiffre de référence de janvier à juin (170 sites distincts sur 208 actifs = 82 %).
3. **Lot 5 élargi** (voir ci-dessus).
4. **Lot 7b** : modèles fidèles à vos rapports de référence, et blocs issus des lots 4 et 5.
5. **Lot 8**, Partenaires & TPM (retours 28 à 30) :
   - fiche prestataire 360° et évaluation du TPM ;
   - formations en sessions ;
   - évaluation des agents (note tirée des données, plus une appréciation) ;
   - planification et budget en Excel ;
   - rapports attendus créés à l'approbation du plan (financier / technique, pièces jointes) ;
   - TPM actif selon le contrat.

   Constats déjà faits : un rapport technique ne s'ouvre pas ; créer un rapport le soumet d'office ; un rapport soumis peut être supprimé.
6. **Autres** :
   - PDD : rations, planification par commune, stock par donateur ;
   - fidélité de la facture au gabarit de mai ;
   - centre d'import multi-sources (écran).

## Points d'attention

- **À confirmer de votre côté.** Avec la règle « date d'enquête », 156 soumissions Nutrition reçues en avril 2026 sont rangées d'août 2024 à décembre 2025, d'après leur seule date SvyDate. Ces dates sont-elles fiables ?
- **Classeur d'activation.** La colonne « Code POI » y est décalée par rapport aux lignes. Le rattachement se fait par le nom dans le district ; un export corrigé améliorerait les liens.
- **Performance sur de longues périodes.** Sur un banc de 58 727 soumissions, certaines vues sur 12 à 24 mois dépassent leur budget (1,8 à 3 s). Les pistes sont dans [`SPEC_LOT_1B.md`](SPEC_LOT_1B.md) : décomptes additifs en cache, calcul dans le worker.
- **Fonds de carte en ligne.** Les fonds OpenStreetMap sont optionnels : la carte vectorielle hors ligne est toujours dessinée.
- **Travail d'une autre session.** Une autre session Claude a travaillé sur la branche `claude/zealous-bardeen-p9ozcr` pendant une limite d'usage. Son code (retour 56) est repris après revue ; on ne publie jamais une branche parallèle sans vérification.
- **Reprise après une limite d'usage.** Le travail est enregistré au fil de l'eau sur `wip/1b-core`, `wip/1b-rest`, `wip/6a` et `wip/7a`. Un point de contrôle automatique relance ce qui s'est interrompu.

---

_Ce document est mis à jour à chaque publication sur `main` et à chaque changement de plan ; le détail heure par heure est dans le journal._
