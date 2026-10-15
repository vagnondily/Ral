# Programmes & projets, Output et carte décisionnelle (retours 65, 69, 73, 92, 93)

> « Une page où je pourrais gérer les programmes, projets (conception, suivi etc.) » (65) · « relié aux Output ; pour les ciblages et autres, mettre la date d'ajout » (69) · « beaucoup trop de cartes » (73) · « activités > sous-activité (activity_tag) > information » (92) · « chaînes du cycle de projet, logframe / line of sight… bailleurs avec noms, numéros de grant, award numbers… zones concernées, pour avoir une vue sur le reste » (93).

- **Statut** : conception seulement. Rien n'est implémenté. Aucune base n'a été modifiée.
- **Date** : 14/10/2026. Base : `main` (`e449d49`).
- **Migrations réservées** : `090` à `095` (`REPRISE.md` § 4). Elles ne dépendent que des migrations publiées (001–068).
- **Compatible** avec `SPEC_MULTIPAYS.md` (082–085) : voir § 12.
- **Décision demandée** : valider le § 0 et répondre aux 6 questions du § 15.

---

## 0. La décision en douze lignes

1. **Un référentiel unique des activités**, à trois niveaux : Activité › Sous-activité (= Activity_tag) › Information. Il devient le pivot de MEMS : sites, MMR, fiches, visites, PDD, contrats, projets, Output.
2. **Trois niveaux de pilotage** : Plan stratégique (facultatif) › Programme › Projet. Tout reste dans le bureau pays (tenant).
3. **Le projet suit un cycle de 7 étapes datées**, de l'identification à la clôture. Chaque étape a ses pièces exigées et une « porte » contrôlée par le serveur.
4. **Une seule chaîne de résultats** : impact → effets → produits → activités. Le cadre du projet « contribue à » un résultat du programme : c'est la ligne de visée.
5. **Chaque indicateur** a une référence, des cibles par période, un moyen de vérification et une source : saisie (validée par une autre personne), suivi de processus, Output, couverture, budget ou ratio. Son statut suit la règle unique `monitoringMath.classify`.
6. **Bailleurs et financements** : n° de grant, n° d'award, montant en devise et contre-valeur USD figée, fin, TOD, TDD, conditions, affectations (programme, projet, résultat, WBS) et zones.
7. **Ce qui appartient à un projet est déduit**, jamais saisi deux fois : le code WBS ou le n° de grant d'abord ; sinon zones du projet × sous-activités de son cadre logique × période.
8. **Module Output** : population → ciblage → plan (le PDD, sans 2ᵉ saisie) → expédié → remis → distribué. Chaque ligne garde sa date d'ajout, son auteur et ses révisions.
9. **Un modèle Excel généré depuis le découpage du pays.** Import en deux temps : vérification sans écriture, puis import.
10. **Connecteur DOTS (Palantir) en lecture seule** : contrat de données minimal, correspondance de champs configurable, secret chiffré côté serveur, synchronisation incrémentale idempotente. En attendant le lien : import des exports DOTS par fichier.
11. **Une seule carte** : la page « Carte décisionnelle », avec filtres (programme, projet, bailleur, financement, activité, période, bureau) et panneau latéral. Les autres cartes deviennent des aperçus qui l'ouvrent.
12. **Livraison en 8 étapes vérifiables.** La première est sans migration : vue d'ensemble du PDD, tableau des mois, date d'ajout.

---

## 1. Constat (code au 14/10)

| Élément | Où | Limite |
|---|---|---|
| Activités | `activities` (code, libellé) pour les contrats FLA ; texte libre ailleurs : `sites.activity` (Activity_tag) et `sites.tag_code`, `mmr_parameters.activity_category`, `monitoring_forms.activity_category`, `site_visits.activity`, `pdd_distributions.activity` | Deux mondes sans lien ; pas de sous-activité ; rapprochement par `lower(btrim())` |
| Programmes, projets, bailleurs, financements | — | N'existent pas. Le PDD porte un `wbs` texte ; la facture parle de « bailleur » sans référentiel |
| Zones choisies | `contract_areas` : unité + chemin conservé, réattachée au réimport du découpage (`replaceBreakdown`) | Seul modèle de zone ; à réutiliser tel quel |
| Distribution | PDD : plan d'urgence par mois, remplacé à chaque import ; denrées, stock | Ni ciblage, ni réalisé, ni logistique ; date d'ajout stockée mais pas montrée |
| Indicateurs | `monitoring_indicators` + `monitoringMath` (classe unique) | Aucun indicateur de résultat, ni référence, ni cible par période |
| Budget | Contrats FLA ; `consolidation` (budget, planifié, réalisé du suivi) | Rien au niveau du financement ou du projet |
| Cartes | `MapExplorer` dans Vue d'ensemble, Couverture & performance › Carte, Suivi de processus › Carte des sites | Trois entrées, aucune page décisionnelle |
| Connecteurs | `remoteFetch` (anti-SSRF, `DATA_SOURCE_ALLOWED_HOSTS`) ; liens Ona / Kobo par fiche | Aucun secret stocké ; pas de synchronisation planifiée |

---

## 2. Modèle métier (regard S&E et gestion de projet)

### 2.1 Vocabulaire

| Terme | Définition | Exemple |
|---|---|---|
| Plan stratégique | Cadre pluriannuel du bureau pays. Facultatif. | « Plan stratégique pays 2024–2028 » |
| Programme | Ensemble de projets au service d'un résultat stratégique | « RS1 — Réponse aux crises » |
| Projet | Intervention datée, financée, avec un cadre logique | « Repas scolaires Androy 2026–2027 » |
| Chaîne de résultats | Impact → effet → produit → activité | — |
| Ligne de visée | Trace continue d'un financement jusqu'aux sites et aux données, et retour | Grant → projet → effet → produit → activité → zones → sites |
| Théorie du changement | Énoncé « si… alors… parce que… » et hypothèses de chaque passage de niveau | — |
| Financement (grant) | Accord géré par le bureau pays : n° de grant (interne), n° d'award (du bailleur), montant, devise, dates | — |
| Affectation | Part d'un financement réservée à un programme, un projet ou un résultat, avec un code WBS facultatif | — |
| TOD / TDD | Date limite d'engagement / de décaissement | — |
| Output | Ce qui est livré : ciblés, atteints, denrées, cash | — |

### 2.2 Programme

- Deux natures dans une même table : `plan` (sans parent) et `programme` (parent = un plan, facultatif).
- Le programme porte son **cadre de résultats** (impact, effets stratégiques, et si besoin produits et activités du plan) et l'énoncé de sa théorie du changement.
- Statut : en préparation · actif · clos. Un programme qui a des projets ne se supprime jamais : il se clôt.
- Ses zones et ses chiffres sont ceux de ses projets (calculés, jamais saisis).

### 2.3 Projet et cycle de projet

| # | Étape | Question tranchée | Pièces exigées par défaut (✱ = calculée par MEMS) | Porte pour clore l'étape |
|---|---|---|---|---|
| 1 | Identification | Faut-il agir, où, pour qui ? | Analyse des besoins et du contexte · Analyse des parties prenantes · Note conceptuelle | Programme choisi, ≥ 1 zone, pièces fournies ou « sans objet » motivé |
| 2 | Formulation | Comment, avec quels résultats ? | Théorie du changement ✱ · Cadre logique ✱ (soumis) · Plan de S&E ✱ (chaque indicateur : moyen de vérification, fréquence, source, référence ou date prévue) · Registre des risques ✱ (≥ 1) · Budget prévisionnel ✱ · Stratégie de ciblage | Toutes les pièces ; cadre logique soumis |
| 3 | Approbation & financement | Est-ce validé et financé ? | Cadre logique validé ✱ · Financement confirmé et affecté ✱ (ou « fonds propres » motivé) · Proposition au bailleur | Cadre logique validé ; ≥ 1 affectation confirmée |
| 4 | Mise en œuvre | Livre-t-on ce qui est prévu ? | Plan de travail · Rapport de démarrage · Accords partenaires ✱ (≥ 1 contrat relié, ou « sans objet ») | Démarrage : étape 3 terminée. Clôture : date de fin réelle |
| 5 | Suivi (en parallèle de 4 à 6) | Où en est-on ? | Valeurs des indicateurs ✱ (chaque période échue) · Rapports au bailleur ✱ (échéances des financements) · Rapports d'avancement | Pas de porte propre ; contrôlée à la clôture |
| 6 | Évaluation | Les effets sont-ils atteints ? | Termes de référence · Rapport d'évaluation · Réponse de la direction | Pièces fournies ou « sans objet » motivé |
| 7 | Clôture | Est-ce fini proprement ? | Rapport final · Leçons apprises · Clôture financière · Stratégie de sortie | Étapes 1–6 terminées ou sans objet ; chaque indicateur a une valeur finale ou « non mesuré » motivé ; affectations closes ou réaffectées |

- Chaque étape a un statut (à venir · en cours · terminée · sans objet), des dates prévues et réelles, et la trace de qui l'a close et quand.
- **Phase courante** (calculée, jamais stockée) : la dernière étape « en cours » hors Suivi ; sinon la première « à venir ».
- **Statut du projet**, séparé de la phase : en cours · suspendu · abandonné. Suspendre ou abandonner exige un motif d'au moins 10 caractères, journalisé.
- « Clore l'étape » appelle la porte du serveur. Un refus (409) liste ce qui manque ; chaque élément ouvre l'endroit où le régler.
- Rouvrir une étape terminée : administrateur seulement, avec motif.
- Une pièce est une **référence** : nom, lien, date (hypothèse H2). « Sans objet » exige un motif. Les pièces ✱ ne se saisissent jamais : MEMS les lit dans ses propres données.

### 2.4 Chaîne de résultats, ligne de visée, théorie du changement

- **Rangs** : impact (1) · effet (2) · produit (3) · activité (4).
- Le **programme** porte l'impact et les effets stratégiques. Le **projet** porte ses effets, produits et activités ; il n'a pas d'impact propre.
- Dans un même cadre, le parent est exactement au rang du dessus.
- Le sommet d'un cadre de projet **contribue à** un résultat du programme : de rang supérieur, ou d'effet à effet stratégique. C'est la ligne de visée. Un sommet sans contribution est signalé « hors ligne de visée » en brouillon, et refusé à la soumission.
- Une **activité** du cadre désigne une activité ou une sous-activité du référentiel (§ 2.8). C'est elle qui relie le projet aux sites, aux fiches, au PDD et à l'Output.
- Chaque nœud porte un résumé narratif, des **hypothèses** (conditions pour passer au niveau du dessus) et des risques en texte. Les risques suivis vont au **registre** : vraisemblance × impact de 1 à 5 ; élevé ≥ 15, moyen 8 à 14, faible ≤ 7.
- **Théorie du changement** = énoncé du projet (et du programme) + la chaîne + les hypothèses. Le schéma est dessiné à partir de ces données, jamais saisi à part.
- **Validation** : brouillon → soumis → validé, le valideur n'est pas l'auteur. Validé = figé et archivé (version n). « Réviser » (motif) rouvre en brouillon. La dernière version validée reste la référence des rapports jusqu'à la suivante.

### 2.5 Indicateurs

- Champs : code, libellé, unité (nombre, %, ratio, montant, indice, oui/non), sens, **référence** (valeur, date, source ; « à établir » toléré jusqu'au démarrage), **moyen de vérification** (obligatoire), fréquence, responsable, ventilation, code commun facultatif (comparaison entre pays).
- **Cibles par période** : plage de mois (règle du lot 1b), par ventilation (total, femmes, hommes, filles, garçons — Q5). Une année et ses trimestres peuvent coexister.
- **Cumulatif** : le réalisé d'une période court du début du projet à la fin de la période.
- **Règle de période** : somme, dernière valeur, moyenne ou plus grand mois.

| Source | Réalisé d'une période | Exemple |
|---|---|---|
| Saisie | valeur saisie avec sa note de vérification, validée par une autre personne | « % de comités de gestion fonctionnels » |
| Suivi de processus | l'indicateur de fiche (`computeIndicator`), sur les seules soumissions du périmètre du projet | « % de distributions avec liste affichée » |
| Output | une mesure de la chaîne (§ 3) sur le périmètre | « Élèves recevant un repas » |
| Couverture | couverture (sites) des sites du projet, sites distincts | « % de sites suivis » |
| Budget | consommation des contrats reliés (`consolidation`) | « Exécution du budget partenaire » |
| Ratio | numérateur ÷ dénominateur, deux indicateurs du même cadre | « Taux d'atteinte » |

- **Statut** : `monitoringMath.classify({ value, target, direction })`, la règle unique (écart ≤ 10 % / 30 % ; sans cible, bandes 80 / 65 / 50 pour un pourcentage seulement). Libellés de `INDICATOR_STATUS` : Excellent · Satisfaisant · À améliorer · Action urgente · Non évalué.
- Pas de cible pour la période : « Non évalué · pas de cible ». **Période inachevée** (elle finit après le dernier mois échu) : « En cours », avec l'avancement en % et sans classe.
- Données partielles d'une source calculée : la raison de `naReason` s'affiche, jamais un « 0 ».
- La matrice des indicateurs tient lieu de **plan de S&E** (cadre de mesure du rendement) : c'est elle qu'on exporte.

### 2.6 Bailleurs et financements

- **Bailleur** : référentiel (code commun, nom, sigle, type, pays). Il se désactive ; il ne se supprime pas s'il a des financements.
- **Statut d'un financement** : pipeline → confirmé → clos ; pipeline ou confirmé → annulé. « À venir · actif · échu » se lit dans les dates.
- **Montant** dans la devise du financement, en centimes entiers. À la confirmation : taux « unités de devise pour 1 USD » saisi ; la **contre-valeur USD est calculée en SQL et figée** (USD : taux 1). Réviser le montant exige un motif ; le journal garde l'avant et l'après.
- Montant **géré par le bureau pays**. Le montant total d'un accord multi-pays est une information.
- **Dates** : début, fin, TOD, TDD (début ≤ TOD ≤ TDD). Alertes : TOD ou TDD à 90 jours ou moins (à surveiller), à 30 jours ou moins (critique).
- **Affectations** : lignes (programme | projet | résultat) avec montant et WBS facultatif. Σ affectations ≤ montant, vérifié par le service sous verrou et par la base à la fin de la transaction. Le reste à affecter est affiché.
- Un même **WBS** peut être financé par plusieurs grants, mais il pointe toujours vers la même cible. MEMS ne répartit jamais une ligne entre grants au prorata.
- **Zones du financement** = restrictions géographiques. Une affectation à un projet dont les zones en sortent est signalée.
- **Obligations de rapport** : liste datée (40 au plus), avec alertes « rapport dû ». **Conditions** : texte libre (restrictions, visibilité, denrées exclues).

### 2.7 Zones d'intervention

- Zones d'un projet et d'un financement : unités du découpage, à tout niveau, choisies en cascade. Affichage en tableau Région · District · Commune · État (même présentation que le retour 79).
- Même stockage que `contract_areas` : unité, chemin conservé, P-code, `ON DELETE SET NULL`. Le réimport du découpage les compte dans sa confirmation et les réattache par P-code puis par chemin.
- Zones d'un programme = union de celles de ses projets. Bureaux d'un projet = bureau pilote + bureaux dont le périmètre recoupe ses zones (calculés).

### 2.8 Référentiel des activités (retour 92) et ce qui s'y rattache

- **Activité** : la table `activities` existante, enrichie (n° d'ordre du plan, description). Les contrats FLA continuent d'y pointer.
- **Sous-activité** = Activity_tag : Tag_code, libellé, description, modalité, unité de bénéficiaires, groupe cible.
- **Information** = la fiche de la sous-activité : ses champs, plus « Utilisé par » (sites, exigences MMR, fiches de suivi, visites, lignes du PDD, projets, contrats).
- **Les textes libres existants ne sont pas réécrits.** Ils sont lus à travers `activity_tag_aliases` (clé normalisée → sous-activité). Un renommage garde l'ancien libellé comme alias : rien ne se détache.
- **Reprise** : chaque libellé existant devient une sous-activité sous « À classer » (code = le Tag_code des sites quand il est unique). L'administrateur range, complète, fusionne les doublons (« GD » et « General distribution »). La santé du paramétrage compte ce qui reste « À classer ».
- Nouvelles saisies : listes du référentiel ; la valeur écrite reste le libellé de la sous-activité.

| Donnée | Lien | Sert à |
|---|---|---|
| Site (`activity`, `tag_code`) | alias → sous-activité | sites d'un projet ; couverture par sous-activité |
| Exigences MMR, fiche de suivi, visite | alias | fréquence de suivi ; indicateurs de suivi du projet ; couverture |
| Plan PDD (`activity`, `wbs`) | alias ; WBS → affectation | plan de distribution du projet |
| Contrat FLA | activité (niveau 1, inchangé) | contrats proposés pour un projet |
| Output, cadre logique | clé étrangère | chaîne de l'output ; ligne de visée |

### 2.9 Règle d'attribution (une seule)

SQL : `programmes/projectScopeSql.projectScopeCtes`. Jumelle pure : `programmes/attribution.js` (parité testée).

1. **Explicite** : la ligne porte un n° de grant ou un WBS connu des affectations → le projet de l'affectation (ou celui du résultat).
2. **Déduite** : l'unité de la ligne est dans une zone du projet (l'unité ou une descendante par la lignée, sinon le P-code du même niveau : règle du répertoire des localités, retour 90) **et** sa sous-activité est une activité du cadre logique **et** son mois est dans la période du projet.
3. Sinon : **hors projet**.

- Une ligne qui tombe dans plusieurs projets apparaît dans chacun, marquée « partagée (n projets) ». Elle compte **une fois** dans les totaux du programme, du financement et du portefeuille (identifiants distincts).
- **Sites d'un projet** = la règle 2 appliquée au registre, sites actifs sur la période. **Données de suivi d'un projet** = soumissions des fiches de ses sous-activités, dans ses zones (P-code de commune).

### 2.10 Définitions communes ajoutées (à reporter dans `PLAN_RETOURS_15_37.md`)

| Notion | Règle |
|---|---|
| Ciblés | Bénéficiaires de la version en vigueur du ciblage, pour la zone, la sous-activité et la période |
| Atteints | Bénéficiaires des distributions confirmées. Jamais ceux du plan |
| Assistances | Somme des bénéficiaires mensuels (une personne aidée 3 mois compte 3 fois) |
| Bénéficiaires d'une sous-activité sur une période | Pour chaque zone, le plus grand mois ; puis somme des zones (Q3) |
| Estimation sans double compte | Pour chaque zone, la plus grande valeur parmi les sous-activités et les mois ; somme des zones. Nommée « estimation basse » |
| Taux de ciblage | Ciblés ÷ population de la zone (même année). « — » sans population |
| Taux d'atteinte | Atteints ÷ ciblés, même zone, sous-activité et période. « — aucun ciblage » |
| Exécution du plan de distribution | Tonnage distribué ÷ tonnage planifié (PDD). « — aucun plan » |
| Taux de remise | Tonnage remis ÷ tonnage expédié. Pertes affichées à part |
| Population d'une unité | Sa propre ligne de l'année ; sinon la somme de ses sous-unités ; jamais les deux |
| Gap de financement | Budget du projet (USD) − Σ affectations confirmées (USD) |
| Coût planifié par bénéficiaire ciblé | Affectations confirmées au projet (USD) ÷ ciblés du projet sur sa durée |
| Coût partenaire par bénéficiaire atteint | Réalisé des contrats reliés (factures validées, en USD mois par mois) ÷ atteints de la même période. « — non calculable » sinon (taux manquant, aucun atteint, aucun contrat). Jamais présenté comme un coût total : MEMS ne voit pas toutes les dépenses |

---

## 3. Module Output (retours 65, 69)

### 3.1 La chaîne

| Maillon | Contenu | Clé | Sources |
|---|---|---|---|
| Population | personnes, ménages, femmes / hommes / filles / garçons, source | unité × année | modèle Excel |
| Ciblage | ciblés par sous-activité (projet facultatif), période, modalité | unité × sous-activité × projet × période | modèle, saisie |
| Plan de distribution | **le PDD existant** (vivres et cash par mois, zone, partenaire, modalité) | ligne PDD | modèle PDD, feuille « Plan » du modèle Output |
| Expédié, remis, pertes | mouvements logistiques par denrée | identifiant du mouvement | DOTS, export DOTS, modèle |
| Distribué (réalisé) | bénéficiaires, ménages, ventilation, denrées, cash | identifiant de la distribution | DOTS, export DOTS, modèle |

### 3.2 Historique et date d'ajout (retour 69)

- **Population et ciblage sont versionnés.** Une modification n'écrase jamais : l'ancienne version reçoit `superseded_at`, son auteur et un motif (≥ 10 caractères) ; la nouvelle pointe vers elle. « Retirer » clôt une version sans successeur, avec motif.
- **Réalisé et logistique sont des événements**, mis à jour en place par leur identifiant. « Ajouté le » = premier lot ; « mis à jour le » = dernier lot.
- **Plan PDD** : le mois reste remplacé à l'import (comportement actuel). Le lot garde les totaux avant → après de chaque mois remplacé.
- Chaque ligne affiche « Ajouté le … par … » (ou « par le lien DOTS »), avec un filtre « ajoutés depuis ». Le **journal des ajouts** liste les lots : qui, quand, fichier et empreinte, comptes, motif.
- **Annuler un lot** (règle du retour 56 : justificatif ≥ 10 caractères, journal des suppressions) : seulement si aucun lot plus récent n'a touché les mêmes lignes. Les versions précédentes redeviennent en vigueur. Un lot qui a modifié des événements, ou un lot PDD, ne s'annule pas : le refus le dit et propose de réimporter le fichier précédent.

### 3.3 Modèle Excel généré depuis le découpage

- `GET /api/output/template.xlsx?niveau=commune&zone=<id>&annee=2026&feuilles=…` : construit à partir des unités du compte, jamais un fichier figé.
- Feuilles : Lisez-moi (règles, découpage et millésime, date, niveau, périmètre) · Population · Ciblage · Plan de distribution (disposition exacte du modèle PDD) · Réalisé · Logistique · Listes (masquée).
- Une ligne par unité du niveau choisi dans le périmètre : P-code et noms en cellules verrouillées. Population et Ciblage arrivent **pré-remplis** des valeurs en vigueur : le même fichier sert d'export et d'import.
- Listes déroulantes (sous-activités, projets, partenaires, denrées, modalités) limitées aux lignes remplies + 500, jamais sur une colonne entière (`xlsxGuard` le refuserait).
- Tonnages en tonnes à 3 décimales, comme le PDD, convertis en kilogrammes entiers. Cash à 2 décimales, converti en centimes.
- Niveau commune par défaut (1 702 lignes). Fokontany (17 524) seulement avec un périmètre (région ou bureau).

### 3.4 Import

- Deux temps, même lecture : `POST /api/output/import/preview` (rien n'est écrit), puis `POST /api/output/import` (même fichier, motif si des versions changent).
- Format reconnu par les octets (`fileSniff`), garde zip, `xlsxGuard.loadWorkbook`, lignes lues par `sheetRows` (bornes calculées une fois), colonnes repérées par leur en-tête.
- Compte rendu par feuille : lues, nouvelles, modifiées, inchangées, écartées (ligne, colonne, code du motif traduit), lieux à rapprocher, période couverte, totaux avant → après.
- Règles :
  - P-code d'abord ; sinon les noms par `placeMatch`. Un lieu non résolu va dans « À rapprocher » (occurrence `output`).
  - Sous-activité, denrée ou partenaire inconnus : ligne écartée avec une suggestion. Rien n'est créé en silence.
  - Si les 4 ventilations sont données, leur somme égale le total.
  - Mois valides de 2000 à 2100 ; nombres sans ambiguïté (mêmes règles que `pddImport`).
  - Un ciblage qui recouvre, pour la même sous-activité, le même projet et la même période, une unité parente ou fille déjà ciblée est refusé : pas de double compte.
- Écriture : une transaction pour tout le classeur, sous le verrou `output:<tenant>` ; insertions multi-lignes par 1 000 ; un lot par feuille ; 20 000 lignes au plus par feuille.
- **Source maîtresse** : dès qu'un lien DOTS est validé pour une nature (réalisé ou logistique), l'import par fichier de cette nature est refusé pour les mois couverts par le lien.

### 3.5 Le PDD relié à l'Output (retour 69)

- Le PDD devient le maillon « Plan de distribution ». Il n'y a pas de 2ᵉ saisie du plan.
- L'entrée « Distribution d'urgence » devient « Distributions & Output » (Q6), en 4 onglets : Vue d'ensemble · Ciblage & population · Distributions · Pipeline (stock).
- **Vue d'ensemble** :
  - 4 tuiles : Ciblés · Atteints · Tonnage remis / planifié · Cash distribué ;
  - la chaîne en barres : population → ciblés → planifiés → atteints ; tonnage planifié → expédié → remis → distribué, avec les taux ;
  - le **tableau des mois**, comme celui du plan de suivi : Mois · Situation · Lignes du plan · Bénéficiaires planifiés · Atteints · Tonnage planifié / expédié / remis / distribué · Cash · Dernier ajout (date, auteur). Un clic ouvre les distributions du mois ;
  - l'ancienne « Synthèse » (par aléa, zone, denrée) devient la section « Détail du plan d'urgence » ; son adresse redirige.
- **Distributions** (un mois) : onglets Plan · Réalisé · Logistique · Comparaison. La comparaison croise zone × sous-activité × denrée : planifié, expédié, remis, distribué, écarts, statut en couleur + icône + libellé.
- **Étape 1, sans migration** : Vue d'ensemble tirée du seul PDD, et colonnes « Ajouté le / par » (`pdd_distributions.created_at`, `created_by` existent déjà).

---

## 4. Connecteur DOTS (Palantir)

### 4.1 Principe

- Lecture seule : MEMS tire des **agrégats**. La forme de l'API DOTS n'est pas supposée : tout passe par une configuration, pas par du code.
- Un seul chemin d'entrée : enregistrement source → correspondance → contrat MEMS (`output/dotsContract.js`, zod) → mêmes règles que l'import de fichier → écriture.

### 4.2 Contrat de données minimal

| Champ MEMS | Réalisé | Logistique | Règle |
|---|---|---|---|
| `external_id` | obligatoire | obligatoire | Identifiant stable dans DOTS (clé d'idempotence) |
| `updated_at` | obligatoire (lien) | obligatoire (lien) | Curseur incrémental, date-heure ISO |
| `date` | obligatoire | obligatoire | Date ISO (ou mois `AAAA-MM`) ; jamais dans le futur |
| `area_pcode` ou `region` / `district` / `commune` | obligatoire | obligatoire (destination) | P-code du découpage, sinon noms rapprochés |
| `site_ref` | facultatif | facultatif | Identifiant de site MEMS, Code POI ou code de localité |
| `activity` | obligatoire | facultatif | Tag_code ou libellé de sous-activité |
| `partner` | facultatif | facultatif | Partenaire MEMS (nom ou code) |
| `modality` | facultatif | — | Inkind / CBT / Mixte (synonymes du PDD) |
| `beneficiaries`, `households`, `women`, `men`, `girls`, `boys` | `beneficiaries` obligatoire | — | Entiers ≥ 0 ; somme des 4 = total si les 4 sont donnés |
| `movement_type` | — | obligatoire | Expédition / remise / perte |
| `origin` | — | facultatif | Entrepôt ou dépôt d'origine |
| `commodity` + `quantity_mt` | facultatif | obligatoire | Denrée connue (code ou alias) ; tonnes ≥ 0, 3 décimales |
| `cash_amount` + `currency` | facultatif | — | Décimal ≥ 0, ISO 4217 |
| `waybill` | — | facultatif | N° de lettre de transport |
| `grant_ref`, `wbs` | facultatif | facultatif | Rattachement au financement et au projet (§ 2.9) |
| `status` | facultatif | facultatif | Valeurs « annulé » déclarées dans la correspondance |

- Une distribution à plusieurs denrées arrive en plusieurs enregistrements de même `external_id`. Ils sont regroupés ; leurs champs d'en-tête doivent être identiques, sinon l'enregistrement est écarté.
- Aucune donnée individuelle (hypothèse H6). Un champ dont le nom évoque un nom, un téléphone, une pièce d'identité ou la position d'un ménage ne peut pas être mis en correspondance.

### 4.3 Correspondance, aperçu, validation

- Par nature : chemin du jeu de données, format (JSON ou CSV), chemin des enregistrements, champ curseur, pagination (page, décalage ou jeton), taille de page (5 000 au plus), correspondance « champ MEMS ← champ source » (chemin pointé, 3 niveaux au plus), tables de valeurs (modalité, statut).
- Un champ non mis en correspondance n'est ni lu plus loin ni stocké. MEMS ne garde jamais l'enregistrement brut : seulement les champs du contrat et une empreinte.
- Parcours : « Tester l'accès » (authentification et première page, champs vus, rien d'écrit) → « Aperçu » (50 enregistrements traduits et contrôlés, rien d'écrit) → « Valider la correspondance » (administrateur ; l'empreinte de la correspondance est gardée ; tout changement exige une nouvelle validation) → « Activer ».

### 4.4 Synchronisation incrémentale

- Curseur par nature, recouvrement de 24 h, première synchronisation à partir de `sync_from`.
- Pages lues dans l'ordre du curseur. **Une transaction par page** : insertion des nouveaux, mise à jour des modifiés (empreinte différente), rien pour les identiques ; le curseur avance dans la même transaction. Livraison au moins une fois, sans trou ni doublon.
- Source non ordonnée (déclarée ainsi) : une seule transaction par passage, 50 000 enregistrements au plus.
- Annulations : statut « annulé » mis en correspondance. « Resynchroniser un mois » relit tout le mois et marque annulés les absents (comptés, journalisés).
- Plafonds : 200 000 enregistrements par passage, 50 Mo par page, 10 min dans le worker. Le bouton « Synchroniser maintenant » de l'API s'arrête à 60 s et propose de finir dans le worker.
- Fréquence : manuelle (défaut), quotidienne ou horaire, par tâche BullMQ répétée `connector-sync`. Sans Redis : manuelle seulement, et l'écran le dit.
- Chaque passage est un lot (`source = 'dots'`) du journal des ajouts. Un échec crée l'alerte « Lien DOTS en échec » avec sa raison, sans secret.

### 4.5 Sécurité

- `https` seulement. Hôte contrôlé par `remoteFetch.assertAllowedUrl` : liste `DATA_SOURCE_ALLOWED_HOSTS`, sinon adresses publiques seulement ; DNS épinglé ; redirections revalidées ; délais et tailles plafonnés. L'adresse du jeton OAuth suit les mêmes règles.
- Secret (jeton, ou secret du client OAuth) chiffré en AES-256-GCM avec `CONNECTOR_SECRET_KEY` (32 octets, dans l'environnement, jamais en base). L'identifiant de clé est stocké pour la rotation (`npm run connectors:rekey`).
- Le secret est **en écriture seule** : l'API ne le renvoie jamais (« Défini le … par … · Remplacer »). Un test vérifie qu'aucune réponse ne contient de colonne `secret_`. Le jeton d'accès OAuth reste en mémoire jusqu'à expiration. Les journaux masquent `token`, `clientSecret`, `authorization`.
- Requêtes GET seulement (et POST vers l'adresse du jeton). Aucune écriture vers DOTS.
- Administrateur seulement : créer, définir le secret, valider, activer, synchroniser. Le gestionnaire voit le journal des passages.

### 4.6 Repli tant que le lien n'est pas fourni

- « Importer un export DOTS » (CSV ou Excel) avec la même correspondance (`source = 'fichier_dots'`), ou les feuilles Réalisé et Logistique du modèle Output.
- Le jour où le lien arrive : configuration, aperçu, validation, activation. Aucun changement de code ni de données.

---

## 5. Ligne de visée et tableaux

### 5.1 Vue « Ligne de visée »

- Tableau arborescent (déplier / replier) dans Portefeuille, dans la fiche d'un financement et dans la vue d'ensemble d'un projet.
- Niveaux : Bailleur › Financement › Projet › Effet › Produit › Activité (sous-activité) › Zone.
- Colonnes : Affecté (USD) · Contrats (accord, consommé) · Ciblés · Atteints · Tonnage (planifié, remis) · Sites (actifs, suivis, couverture) · Indicateurs (pastilles par classe) · Signaux.
- Chaque chiffre est calculé sur le périmètre du nœud (§ 2.9) et sur la période de la page, avec « Comment c'est calculé ».

### 5.2 Budget, output, résultats

- **Budget** : affectations (USD), budget du projet, gap ; contrats reliés : total de l'accord et consommé, lus dans `consolidation` (aucun 2ᵉ calcul).
- **Output** : la chaîne du § 3. **Résultats** : statut et avancement des indicateurs.
- **Coût par bénéficiaire** : les deux mesures du § 2.10, seulement quand les données le permettent ; sinon « — non calculable » et la raison.
- Jamais de somme de devises différentes. Financements en USD figés ; contrats en devise locale convertis mois par mois (`currencyMath.sumUsdCents`). Taux manquant → « partiel », jamais un total faux.

---

## 6. Carte décisionnelle (retours 65, 73, 94)

### 6.1 Une seule carte

- Page **Dashboard décisionnel › Carte décisionnelle** (`#/dashboard/carte`), bâtie sur `MapExplorer` (lot 6a) et sur le travail de `wip/ui-polish` (zoom sur le bureau, couleur par activité, légende simple : retours 83 et 94).
- Aperçus (`variant="compact"`) qui ouvrent la page avec leurs filtres : Vue d'ensemble, fiche projet › Zones & sites, Distributions & Output › Vue d'ensemble.
- « Suivi de processus › Carte des sites » et l'onglet « Carte » de Couverture & performance redirigent vers la page. « Localités › Contours » reste un réglage (un tableau, pas une carte).

### 6.2 Filtres

- Barre du haut, état dans l'adresse (comme `usePeriod`) : Période · Bureau (avec antennes ; recadre la carte) · Programme › Projet · Bailleur › Financement · Activité › Sous-activité · Niveau (district ; commune quand ses contours existent, sinon centres des communes avec la raison).
- Le périmètre est calculé par le serveur (§ 2.9), jamais dans le navigateur.

### 6.3 Thèmes et couches

| Groupe | Thèmes de zone (un à la fois) | Règle |
|---|---|---|
| Registre | Sites actifs · Risque élevé | lot 6a |
| Suivi | Couverture · Planification · Exécution du plan · Données versées · Signaux | lot 6a |
| Output | Population · Ciblés · Taux de ciblage · Atteints · Taux d'atteinte · Tonnage planifié · Tonnage remis · Taux de remise · Cash distribué | § 2.10 ; taux recalculés depuis les comptes, jamais une moyenne de taux |
| Programmes | Projets actifs · Financements actifs | règle d'attribution |

- Couches de points : Sites (couleur = statut de visite **ou** activité, au choix) · Points de collecte (règles de confidentialité du lot 6a) · Points de distribution (taille = atteints) · Destinations logistiques (taille = tonnage remis).
- Légende en mots simples : « Couleur des zones = … », « Couleur des points = … », « Taille = … ».

### 6.4 Panneau latéral (gauche, 300 px)

1. **Vue d'ensemble du périmètre** : sites actifs (présence par district), population, ciblés, atteints, lignes de distribution, tonnage prévu et reçu (remis), cash.
2. **Suivi de processus** : couverture (sites), exécution du plan, données versées, indice de conformité.
3. **Performance par activité** : sous-activité · sites actifs · couverture · ciblés · atteints · taux d'atteinte.
4. **Classement des zones** pour le thème (lot 6a).

- Un clic sur une zone ou un site : le panneau devient « Unité sélectionnée » ou « Site sélectionné ». Mêmes sections, restreintes, plus les projets présents (code, phase), les financements (n°, bailleur) et des liens : Voir les sites · Distributions du mois · Ouvrir le projet. Échap revient à l'ensemble.
- Export PNG et A4 avec les filtres écrits en clair (`mapExport`).

### 6.5 Performance

- Un appel `GET /api/map/decision` (tous les thèmes par unité, comptes additifs) + `/api/map/points`.
- Budget : ≤ 400 ms pour 10 000 sites × 12 mois et 100 000 lignes d'Output ; réponse ≤ 300 Ko ; premier rendu ≤ 300 ms à CPU ×4 (budgets du lot 6a).

---

## 7. Modèle de données exact (migrations 090 à 095)

**Conventions**, valables pour chaque nouvelle table :
- `[T]` = `tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE` ; `id uuid PRIMARY KEY DEFAULT gen_random_uuid()` quand la table a un `id`.
- `[AUD]` = `created_by uuid REFERENCES users(id) ON DELETE SET NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()`.
- `[ZONE]` = `admin_area_id uuid REFERENCES admin_areas(id) ON DELETE SET NULL, area_key text NOT NULL, area_pcode text, area_path text NOT NULL, area_depth int NOT NULL` (`area_key` = P-code, sinon chemin normalisé).
- `[VENT]` = `women int, men int, girls int, boys int` (≥ 0) + `CHECK (num_nulls(women, men, girls, boys) IN (0, 4))` + `CHECK (women IS NULL OR women + men + girls + boys = <total>)`.
- `ALTER TABLE … ENABLE ROW LEVEL SECURITY` ; `CREATE POLICY tenant_isolation … USING (tenant_id::text = current_setting('app.tenant_id', true))` ; `GRANT SELECT, INSERT, UPDATE, DELETE … TO mems2_app` sauf mention.
- Chaque migration finit par `SELECT mems_install_same_tenant('<table>')` pour chaque table qui référence une autre table à `tenant_id`.
- Erreurs des déclencheurs : `23514` (→ 400). Rôle `mems_app` jamais touché.

### 090_activity_referential.sql

```sql
CREATE OR REPLACE FUNCTION mems_activity_key(s text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT regexp_replace(lower(translate(coalesce(s, ''),
    'ÀÁÂÃÄÅàáâãäåÇçÈÉÊËèéêëÌÍÎÏìíîïÑñÒÓÔÕÖòóôõöÙÚÛÜùúûüÝýÿ',
    'AAAAAAaaaaaaCcEEEEeeeeIIIIiiiiNnOOOOOoooooUUUUuuuuYyy')), '[^a-z0-9]+', '', 'g') $$;
-- jumelle JS : programmes/activityKey.js (parité testée)
ALTER TABLE activities
  ADD COLUMN IF NOT EXISTS ref_no int CHECK (ref_no IS NULL OR ref_no BETWEEN 1 AND 999),
  ADD COLUMN IF NOT EXISTS description text CHECK (description IS NULL OR length(description) <= 2000),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
CREATE TABLE activity_tags (id …, [T],
  activity_id uuid NOT NULL REFERENCES activities(id) ON DELETE RESTRICT,
  code text NOT NULL CHECK (code ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,29}$'),            -- Tag_code
  label text NOT NULL CHECK (length(btrim(label)) BETWEEN 1 AND 160),              -- Activity_tag
  description text CHECK (description IS NULL OR length(description) <= 2000),
  modality text CHECK (modality IS NULL OR modality IN ('Cash','Voucher','Food','Capacity Strengthening','Mix')),
  beneficiary_unit text NOT NULL DEFAULT 'personnes' CHECK (beneficiary_unit IN
    ('personnes','menages','eleves','enfants_6_59_mois','femmes_enceintes_allaitantes','autre')),
  target_group text CHECK (target_group IS NULL OR length(target_group) <= 200),
  sort_order int NOT NULL DEFAULT 0, active boolean NOT NULL DEFAULT true, [AUD],
  UNIQUE (tenant_id, code));
CREATE UNIQUE INDEX uq_activity_tags_key ON activity_tags (tenant_id, mems_activity_key(label));
CREATE TABLE activity_tag_aliases ([T],
  alias_key text NOT NULL CHECK (alias_key ~ '^[a-z0-9]{1,160}$'),
  activity_tag_id uuid NOT NULL REFERENCES activity_tags(id) ON DELETE CASCADE,
  source text NOT NULL CHECK (source IN ('libelle','code','manuel')),
  created_by uuid REFERENCES users(id) ON DELETE SET NULL, created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, alias_key));
CREATE INDEX idx_activity_tag_aliases_tag ON activity_tag_aliases (tenant_id, activity_tag_id);
```
- **Reprise** (idempotente) : par tenant, activité `a-classer` « À classer » ; une sous-activité par clé distincte des 5 colonnes de texte (libellé le plus fréquent ; code = Tag_code unique des sites, sinon libellé assaini en majuscules, suffixe `-2`, `-3` en cas de collision) ; alias du libellé et du code. `RAISE NOTICE` avec les comptes.

### 091_donors_grants.sql

```sql
CREATE TABLE donors (id …, [T],
  code text NOT NULL CHECK (code ~ '^[A-Z0-9][A-Z0-9_-]{1,19}$'),                  -- code commun
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 200),
  short_name text CHECK (short_name IS NULL OR length(short_name) <= 40),
  kind text NOT NULL CHECK (kind IN ('gouvernement','multilateral','fonds_commun','fondation','prive','interne','autre')),
  country_iso3 text CHECK (country_iso3 IS NULL OR country_iso3 ~ '^[A-Z]{3}$'),
  note text CHECK (note IS NULL OR length(note) <= 1000), active boolean NOT NULL DEFAULT true, [AUD],
  UNIQUE (tenant_id, code));
CREATE UNIQUE INDEX uq_donors_name ON donors (tenant_id, lower(btrim(name)));
CREATE TABLE grants (id …, [T],
  donor_id uuid NOT NULL REFERENCES donors(id) ON DELETE RESTRICT,
  grant_number text NOT NULL CHECK (grant_number ~ '^[A-Za-z0-9][A-Za-z0-9 ./_-]{0,49}$'),
  award_number text CHECK (award_number IS NULL OR length(btrim(award_number)) BETWEEN 1 AND 80),
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 3 AND 300),
  status text NOT NULL DEFAULT 'pipeline' CHECK (status IN ('pipeline','confirme','clos','annule')),
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  amount_cents bigint NOT NULL CHECK (amount_cents >= 0),                          -- géré par le bureau pays
  usd_rate numeric(18,8) CHECK (usd_rate IS NULL OR usd_rate > 0),                 -- devise pour 1 USD
  amount_usd_cents bigint CHECK (amount_usd_cents IS NULL OR amount_usd_cents >= 0), -- calculé en SQL à l'écriture
  total_award_cents bigint CHECK (total_award_cents IS NULL OR total_award_cents >= amount_cents),
  start_date date NOT NULL, end_date date NOT NULL, tod date, tdd date,
  earmarking text NOT NULL DEFAULT 'projet' CHECK (earmarking IN ('flexible','programme','projet','activite')),
  conditions text CHECK (conditions IS NULL OR length(conditions) <= 4000),
  reporting_due jsonb NOT NULL DEFAULT '[]'
    CHECK (jsonb_typeof(reporting_due) = 'array' AND jsonb_array_length(reporting_due) <= 40),
  confirmed_at timestamptz, confirmed_by uuid REFERENCES users(id) ON DELETE SET NULL, closed_at timestamptz,
  version int NOT NULL DEFAULT 1, [AUD],
  UNIQUE (tenant_id, grant_number),
  CHECK (end_date >= start_date), CHECK (tod IS NULL OR tod >= start_date), CHECK (tdd IS NULL OR tod IS NULL OR tdd >= tod),
  CHECK ((usd_rate IS NULL) = (amount_usd_cents IS NULL)),
  CHECK (usd_rate IS NULL OR amount_usd_cents = round(amount_cents / usd_rate)::bigint),
  CHECK (currency <> 'USD' OR usd_rate IS NULL OR usd_rate = 1),
  CHECK (status IN ('pipeline','annule') OR (usd_rate IS NOT NULL AND confirmed_at IS NOT NULL)),
  CHECK (status <> 'clos' OR closed_at IS NOT NULL));
CREATE TABLE grant_zones (id …, [T], grant_id uuid NOT NULL REFERENCES grants(id) ON DELETE CASCADE,
  admin_area_id uuid REFERENCES admin_areas(id) ON DELETE SET NULL, path text NOT NULL, depth int NOT NULL, pcode text,
  created_at timestamptz NOT NULL DEFAULT now());
CREATE UNIQUE INDEX uq_grant_zone ON grant_zones (grant_id, admin_area_id) WHERE admin_area_id IS NOT NULL;
```
- Déclencheur `grants_status_guard` : transitions du § 2.6 seulement ; un statut final ne change plus.

### 092_programmes_projects.sql

```sql
CREATE TABLE programmes (id …, [T],
  kind text NOT NULL CHECK (kind IN ('plan','programme')),
  parent_id uuid REFERENCES programmes(id) ON DELETE RESTRICT,
  code text NOT NULL CHECK (code ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,29}$'),
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 3 AND 300),
  description text CHECK (description IS NULL OR length(description) <= 4000),
  toc_statement text CHECK (toc_statement IS NULL OR length(toc_statement) <= 4000),
  start_date date, end_date date,
  status text NOT NULL DEFAULT 'actif' CHECK (status IN ('preparation','actif','clos')),
  version int NOT NULL DEFAULT 1, [AUD],
  UNIQUE (tenant_id, code), CHECK (kind = 'programme' OR parent_id IS NULL),
  CHECK (end_date IS NULL OR start_date IS NULL OR end_date >= start_date));
CREATE TABLE projects (id …, [T],
  programme_id uuid NOT NULL REFERENCES programmes(id) ON DELETE RESTRICT,
  code text NOT NULL CHECK (code ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,29}$'),
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 3 AND 300),
  summary text CHECK (summary IS NULL OR length(summary) <= 4000),
  toc_statement text CHECK (toc_statement IS NULL OR length(toc_statement) <= 4000),
  status text NOT NULL DEFAULT 'en_cours' CHECK (status IN ('en_cours','suspendu','abandonne')),
  status_reason text CHECK (status_reason IS NULL OR length(btrim(status_reason)) BETWEEN 10 AND 1000),
  start_date date, end_date date, budget_usd_cents bigint CHECK (budget_usd_cents IS NULL OR budget_usd_cents >= 0),
  manager_id uuid REFERENCES users(id) ON DELETE SET NULL,
  lead_office_id uuid REFERENCES field_offices(id) ON DELETE SET NULL,
  logframe_status text NOT NULL DEFAULT 'brouillon' CHECK (logframe_status IN ('brouillon','soumis','valide')),
  logframe_version int NOT NULL DEFAULT 0 CHECK (logframe_version >= 0),       -- dernière version validée
  logframe_submitted_by uuid REFERENCES users(id) ON DELETE SET NULL, logframe_submitted_at timestamptz,
  logframe_validated_by uuid REFERENCES users(id) ON DELETE SET NULL, logframe_validated_at timestamptz,
  version int NOT NULL DEFAULT 1, [AUD],
  UNIQUE (tenant_id, code),
  CHECK (end_date IS NULL OR start_date IS NULL OR end_date >= start_date),
  CHECK (status = 'en_cours' OR status_reason IS NOT NULL),
  CHECK ((logframe_status = 'brouillon' AND logframe_submitted_at IS NULL AND logframe_validated_at IS NULL)
      OR (logframe_status = 'soumis' AND logframe_submitted_at IS NOT NULL AND logframe_validated_at IS NULL)
      OR (logframe_status = 'valide' AND logframe_submitted_at IS NOT NULL AND logframe_validated_at IS NOT NULL)),
  CHECK (logframe_validated_by IS NULL OR logframe_submitted_by IS NULL OR logframe_validated_by <> logframe_submitted_by));
CREATE TABLE project_stages ([T], project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  stage text NOT NULL CHECK (stage IN ('identification','formulation','approbation','mise_en_oeuvre','suivi','evaluation','cloture')),
  status text NOT NULL DEFAULT 'a_venir' CHECK (status IN ('a_venir','en_cours','termine','sans_objet')),
  planned_start date, planned_end date, actual_start date, actual_end date,
  decided_by uuid REFERENCES users(id) ON DELETE SET NULL, decided_at timestamptz,
  note text CHECK (note IS NULL OR length(note) <= 2000), updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, stage),
  CHECK (status <> 'en_cours' OR actual_start IS NOT NULL),
  CHECK (status <> 'termine' OR (actual_start IS NOT NULL AND actual_end IS NOT NULL AND decided_at IS NOT NULL)),
  CHECK (status <> 'sans_objet' OR length(btrim(coalesce(note, ''))) >= 10),
  CHECK (planned_end IS NULL OR planned_start IS NULL OR planned_end >= planned_start),
  CHECK (actual_end IS NULL OR actual_start IS NULL OR actual_end >= actual_start));
CREATE TABLE project_artefacts (id …, [T], project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  stage text NOT NULL CHECK (stage IN ('identification','formulation','approbation','mise_en_oeuvre','suivi','evaluation','cloture')),
  kind text NOT NULL CHECK (kind ~ '^[a-z_]{2,40}$'),           -- clé du catalogue projectCycle.ARTEFACTS, ou 'autre'
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 2 AND 200), required boolean NOT NULL DEFAULT true,
  status text NOT NULL DEFAULT 'manquant' CHECK (status IN ('manquant','en_cours','fourni','valide','sans_objet')),
  doc_ref text CHECK (doc_ref IS NULL OR length(doc_ref) <= 500), doc_date date,
  note text CHECK (note IS NULL OR length(note) <= 1000),
  validated_by uuid REFERENCES users(id) ON DELETE SET NULL, validated_at timestamptz, [AUD],
  CHECK (status <> 'sans_objet' OR length(btrim(coalesce(note, ''))) >= 10),
  CHECK (status NOT IN ('fourni','valide') OR doc_ref IS NOT NULL),
  CHECK (status <> 'valide' OR validated_by IS NOT NULL));
CREATE TABLE project_zones (id …, [T], project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  admin_area_id uuid REFERENCES admin_areas(id) ON DELETE SET NULL, path text NOT NULL, depth int NOT NULL, pcode text,
  sort_order int NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now());
CREATE UNIQUE INDEX uq_project_zone ON project_zones (project_id, admin_area_id) WHERE admin_area_id IS NOT NULL;
CREATE TABLE project_contracts ([T], project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  contract_id uuid NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL, created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, contract_id));
CREATE TABLE project_risks (id …, [T], project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 3 AND 300),
  category text NOT NULL CHECK (category IN ('securite','contexte','operationnel','financier','partenaire','protection','fraude','autre')),
  likelihood smallint NOT NULL CHECK (likelihood BETWEEN 1 AND 5), impact smallint NOT NULL CHECK (impact BETWEEN 1 AND 5),
  mitigation text CHECK (mitigation IS NULL OR length(mitigation) <= 2000), owner text CHECK (owner IS NULL OR length(owner) <= 160),
  status text NOT NULL DEFAULT 'ouvert' CHECK (status IN ('ouvert','surveille','clos')), review_date date, [AUD]);
CREATE TABLE grant_allocations (id …, [T], grant_id uuid NOT NULL REFERENCES grants(id) ON DELETE CASCADE,
  programme_id uuid REFERENCES programmes(id) ON DELETE RESTRICT,
  project_id uuid REFERENCES projects(id) ON DELETE RESTRICT,
  wbs_code text CHECK (wbs_code IS NULL OR wbs_code ~ '^[A-Za-z0-9][A-Za-z0-9./_-]{0,59}$'),
  amount_cents bigint NOT NULL CHECK (amount_cents >= 0),                  -- devise du financement
  note text CHECK (note IS NULL OR length(note) <= 1000), [AUD],
  CONSTRAINT grant_allocations_target CHECK (num_nonnulls(programme_id, project_id) = 1));
CREATE INDEX idx_grant_alloc_wbs ON grant_allocations (tenant_id, wbs_code) WHERE wbs_code IS NOT NULL;
CREATE TABLE programme_journal (id …, [T],
  object_type text NOT NULL CHECK (object_type IN ('activite','sous_activite','bailleur','financement','programme',
    'projet','cadre_logique','indicateur','output_lot','connecteur')),
  object_id uuid NOT NULL, project_id uuid,                     -- sans clé étrangère : le journal survit à l'objet
  action text NOT NULL CHECK (action ~ '^[a-z_]{3,40}$'),
  actor_id uuid REFERENCES users(id) ON DELETE SET NULL,          -- NULL = synchronisation planifiée
  reason text CHECK (reason IS NULL OR length(reason) <= 1000),
  details jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(details) = 'object' AND pg_column_size(details) <= 8192),
  created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX idx_programme_journal_obj ON programme_journal (tenant_id, object_type, object_id, created_at DESC);
GRANT SELECT, INSERT ON programme_journal TO mems2_app; REVOKE UPDATE, DELETE ON programme_journal FROM mems2_app;
```
- Déclencheurs : `programmes_guard` (le parent est un `plan`) ; `grant_alloc_sum`, **contrainte différée** (`DEFERRABLE INITIALLY DEFERRED`) sur `grant_allocations` et sur `grants` (`UPDATE OF amount_cents`) : Σ ≤ montant ; `grant_alloc_wbs` : un WBS pointe toujours vers la même cible.
- `document_deletions.doc_type` : liste existante + `'project'`, `'grant'` (même liste que `deletionPolicy.DOCUMENT_TYPES`).

### 093_logframe.sql

```sql
CREATE TABLE results (id …, [T],
  programme_id uuid NOT NULL REFERENCES programmes(id) ON DELETE CASCADE,
  project_id uuid REFERENCES projects(id) ON DELETE CASCADE,                 -- NULL = cadre du programme
  parent_id uuid REFERENCES results(id) ON DELETE RESTRICT,
  contributes_to_id uuid REFERENCES results(id) ON DELETE RESTRICT,          -- ligne de visée
  level text NOT NULL CHECK (level IN ('impact','effet','produit','activite')),
  code text NOT NULL CHECK (code ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,19}$'),
  statement text NOT NULL CHECK (length(btrim(statement)) BETWEEN 3 AND 1000),
  activity_id uuid REFERENCES activities(id) ON DELETE RESTRICT,
  activity_tag_id uuid REFERENCES activity_tags(id) ON DELETE RESTRICT,
  assumptions text CHECK (assumptions IS NULL OR length(assumptions) <= 2000),
  risks text CHECK (risks IS NULL OR length(risks) <= 2000), sort_order int NOT NULL DEFAULT 0, [AUD],
  CHECK (level = 'activite' OR (activity_id IS NULL AND activity_tag_id IS NULL)),
  CHECK (num_nonnulls(activity_id, activity_tag_id) <= 1),
  CHECK (parent_id IS NULL OR contributes_to_id IS NULL), CHECK (project_id IS NOT NULL OR contributes_to_id IS NULL),
  CHECK (project_id IS NULL OR level <> 'impact'));
CREATE UNIQUE INDEX uq_results_code ON results (tenant_id, programme_id, COALESCE(project_id, programme_id), code);
CREATE TABLE result_indicators (id …, [T], result_id uuid NOT NULL REFERENCES results(id) ON DELETE CASCADE,
  code text NOT NULL CHECK (code ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,29}$'),
  label text NOT NULL CHECK (length(btrim(label)) BETWEEN 3 AND 300),
  standard_code text CHECK (standard_code IS NULL OR standard_code ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$'),
  unit text NOT NULL CHECK (unit IN ('nombre','pourcentage','ratio','montant','indice','oui_non')),
  direction text NOT NULL DEFAULT 'higher_better' CHECK (direction IN ('higher_better','lower_better')),
  disaggregated boolean NOT NULL DEFAULT false, cumulative boolean NOT NULL DEFAULT false,
  baseline_value numeric(18,4), baseline_date date,
  baseline_source text CHECK (baseline_source IS NULL OR length(baseline_source) <= 300),
  means_of_verification text NOT NULL CHECK (length(btrim(means_of_verification)) BETWEEN 3 AND 1000),
  frequency text NOT NULL DEFAULT 'trimestrielle'
    CHECK (frequency IN ('mensuelle','trimestrielle','semestrielle','annuelle','ponctuelle')),
  responsible text CHECK (responsible IS NULL OR length(responsible) <= 200),
  source_kind text NOT NULL DEFAULT 'saisie' CHECK (source_kind IN ('saisie','suivi','output','couverture','budget','ratio')),
  monitoring_indicator_id uuid REFERENCES monitoring_indicators(id) ON DELETE RESTRICT,
  output_measure text CHECK (output_measure IS NULL OR output_measure IN ('cibles','atteints','assistances',
    'menages_atteints','tonnage_planifie','tonnage_expedie','tonnage_remis','tonnage_distribue','cash_distribue','lignes_plan')),
  numerator_id uuid REFERENCES result_indicators(id) ON DELETE RESTRICT,
  denominator_id uuid REFERENCES result_indicators(id) ON DELETE RESTRICT,
  period_rule text NOT NULL DEFAULT 'somme' CHECK (period_rule IN ('somme','dernier','moyenne','max_mensuel')),
  sort_order int NOT NULL DEFAULT 0, active boolean NOT NULL DEFAULT true, [AUD],
  UNIQUE (result_id, code),
  CHECK ((source_kind = 'suivi') = (monitoring_indicator_id IS NOT NULL)),
  CHECK ((source_kind = 'output') = (output_measure IS NOT NULL)),
  CHECK ((source_kind = 'ratio') = (numerator_id IS NOT NULL AND denominator_id IS NOT NULL)));
CREATE TABLE indicator_periods (id …, [T], indicator_id uuid NOT NULL REFERENCES result_indicators(id) ON DELETE CASCADE,
  period_from date NOT NULL, period_to date NOT NULL,
  disagg text NOT NULL DEFAULT 'total' CHECK (disagg IN ('total','femmes','hommes','filles','garcons')),
  target numeric(18,4), value numeric(18,4),                              -- value : réalisé SAISI seulement
  value_note text CHECK (value_note IS NULL OR length(value_note) <= 1000),
  value_status text CHECK (value_status IS NULL OR value_status IN ('saisi','valide')),
  value_by uuid REFERENCES users(id) ON DELETE SET NULL, value_at timestamptz,
  value_validated_by uuid REFERENCES users(id) ON DELETE SET NULL, value_validated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (indicator_id, period_from, period_to, disagg),
  CHECK (date_trunc('month', period_from)::date = period_from AND date_trunc('month', period_to)::date = period_to
         AND period_to >= period_from),
  CHECK ((value IS NULL) = (value_status IS NULL)), CHECK (value IS NULL OR length(btrim(coalesce(value_note, ''))) >= 3),
  CHECK (value_status IS DISTINCT FROM 'valide' OR (value_validated_by IS NOT NULL AND value_validated_by IS DISTINCT FROM value_by)));
CREATE TABLE logframe_versions (id …, [T], project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  version int NOT NULL CHECK (version >= 1),
  snapshot jsonb NOT NULL CHECK (jsonb_typeof(snapshot) = 'object' AND pg_column_size(snapshot) <= 1048576),
  submitted_by uuid REFERENCES users(id) ON DELETE SET NULL, submitted_at timestamptz NOT NULL,
  validated_by uuid REFERENCES users(id) ON DELETE SET NULL, validated_at timestamptz NOT NULL DEFAULT now(),
  comment text CHECK (comment IS NULL OR length(comment) <= 1000),
  UNIQUE (project_id, version), CHECK (validated_by IS NULL OR submitted_by IS NULL OR validated_by <> submitted_by));
GRANT SELECT, INSERT ON logframe_versions TO mems2_app; REVOKE UPDATE, DELETE ON logframe_versions FROM mems2_app;
ALTER TABLE grant_allocations ADD COLUMN result_id uuid REFERENCES results(id) ON DELETE RESTRICT,
  DROP CONSTRAINT grant_allocations_target,
  ADD CONSTRAINT grant_allocations_target CHECK (num_nonnulls(programme_id, project_id, result_id) = 1);
ALTER TABLE project_risks ADD COLUMN result_id uuid REFERENCES results(id) ON DELETE SET NULL;
```
- `results_guard` : le projet appartient au programme ; parent du même cadre et au rang juste au-dessus ; `contributes_to_id` vise un nœud du programme (même `programme_id`, `project_id` NULL) de rang inférieur, ou effet → effet.
- `logframe_freeze` sur `results`, `result_indicators`, et `indicator_periods` (insertion, suppression, mise à jour de `target`, des dates, de `disagg`) : refus si le cadre du projet n'est pas en brouillon. Les colonnes `value*` restent modifiables : le suivi continue.
- `indicator_value_guard` : `value` seulement si `source_kind = 'saisie'`.

### 094_output.sql

```sql
CREATE TABLE output_batches (id …, [T],
  kind text NOT NULL CHECK (kind IN ('population','ciblage','plan','realise','logistique')),
  source text NOT NULL CHECK (source IN ('modele','fichier_dots','dots','saisie')),
  connector_id uuid,                                                    -- clé étrangère posée par 095
  file_name text CHECK (file_name IS NULL OR length(file_name) <= 255),
  file_sha256 text CHECK (file_sha256 IS NULL OR file_sha256 ~ '^[0-9a-f]{64}$'),
  period_from date, period_to date,
  counts jsonb NOT NULL CHECK (jsonb_typeof(counts) = 'object' AND pg_column_size(counts) <= 4096),
  totals jsonb CHECK (totals IS NULL OR (jsonb_typeof(totals) = 'object' AND pg_column_size(totals) <= 16384)), -- avant → après
  reason text CHECK (reason IS NULL OR length(reason) <= 1000),
  created_by uuid REFERENCES users(id) ON DELETE SET NULL, created_at timestamptz NOT NULL DEFAULT now(),
  cancelled_at timestamptz, cancelled_by uuid REFERENCES users(id) ON DELETE SET NULL,
  cancel_reason text CHECK (cancel_reason IS NULL OR length(btrim(cancel_reason)) BETWEEN 10 AND 1000));
GRANT SELECT, INSERT, UPDATE (cancelled_at, cancelled_by, cancel_reason) ON output_batches TO mems2_app;
CREATE TABLE output_population (id …, [T], [ZONE], ref_year int NOT NULL CHECK (ref_year BETWEEN 2000 AND 2100),
  population int NOT NULL CHECK (population >= 0), households int CHECK (households >= 0), [VENT],
  source text NOT NULL CHECK (length(btrim(source)) BETWEEN 2 AND 200),
  batch_id uuid REFERENCES output_batches(id) ON DELETE RESTRICT,
  supersedes_id uuid REFERENCES output_population(id) ON DELETE RESTRICT,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL, created_at timestamptz NOT NULL DEFAULT now(),
  superseded_at timestamptz, superseded_by uuid REFERENCES users(id) ON DELETE SET NULL, superseded_reason text,
  CHECK (superseded_at IS NULL OR length(btrim(coalesce(superseded_reason, ''))) >= 10));
CREATE UNIQUE INDEX uq_output_population_current ON output_population (tenant_id, area_key, ref_year) WHERE superseded_at IS NULL;
CREATE TABLE output_targets (id …, [T], [ZONE],
  activity_tag_id uuid NOT NULL REFERENCES activity_tags(id) ON DELETE RESTRICT,
  project_id uuid REFERENCES projects(id) ON DELETE RESTRICT,
  period_from date NOT NULL, period_to date NOT NULL,
  beneficiaries int NOT NULL CHECK (beneficiaries >= 0), households int CHECK (households >= 0), [VENT],
  modality text CHECK (modality IS NULL OR modality IN ('Inkind','CBT','Mixte')),
  batch_id uuid REFERENCES output_batches(id) ON DELETE RESTRICT,
  supersedes_id uuid REFERENCES output_targets(id) ON DELETE RESTRICT,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL, created_at timestamptz NOT NULL DEFAULT now(),
  superseded_at timestamptz, superseded_by uuid REFERENCES users(id) ON DELETE SET NULL, superseded_reason text,
  CHECK (date_trunc('month', period_from)::date = period_from AND date_trunc('month', period_to)::date = period_to
         AND period_to >= period_from),
  CHECK (superseded_at IS NULL OR length(btrim(coalesce(superseded_reason, ''))) >= 10));
CREATE UNIQUE INDEX uq_output_targets_current ON output_targets
  (tenant_id, area_key, activity_tag_id, COALESCE(project_id, tenant_id), period_from, period_to) WHERE superseded_at IS NULL;
CREATE TABLE output_distributions (id …, [T],
  source text NOT NULL CHECK (source IN ('modele','fichier_dots','dots','saisie')), connector_id uuid,
  external_id text NOT NULL CHECK (length(external_id) BETWEEN 1 AND 160),   -- id source, ou « k: » + empreinte de la clé naturelle
  record_hash text NOT NULL CHECK (record_hash ~ '^[0-9a-f]{64}$'),
  first_batch_id uuid NOT NULL REFERENCES output_batches(id) ON DELETE RESTRICT,
  batch_id uuid NOT NULL REFERENCES output_batches(id) ON DELETE RESTRICT,
  dist_date date NOT NULL, period_month date NOT NULL, [ZONE],
  geo_status text CHECK (mems_geo_status_ok(geo_status)), site_id uuid REFERENCES sites(id) ON DELETE SET NULL,
  activity_tag_id uuid REFERENCES activity_tags(id) ON DELETE RESTRICT,     -- NULL = à rapprocher (lien seulement)
  raw_activity text NOT NULL CHECK (length(raw_activity) <= 160),
  partner_id uuid REFERENCES partners(id) ON DELETE SET NULL, raw_partner text CHECK (raw_partner IS NULL OR length(raw_partner) <= 200),
  modality text CHECK (modality IS NULL OR modality IN ('Inkind','CBT','Mixte')),
  beneficiaries int NOT NULL CHECK (beneficiaries >= 0), households int CHECK (households >= 0), [VENT],
  cash_cents bigint NOT NULL DEFAULT 0 CHECK (cash_cents >= 0), cash_currency text CHECK (cash_currency ~ '^[A-Z]{3}$'),
  grant_ref text CHECK (length(grant_ref) <= 50), wbs text CHECK (length(wbs) <= 60),
  status text NOT NULL DEFAULT 'confirme' CHECK (status IN ('confirme','annule')),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (period_month = date_trunc('month', dist_date)::date), CHECK (cash_cents = 0 OR cash_currency IS NOT NULL));
CREATE UNIQUE INDEX uq_output_dist_ext ON output_distributions (tenant_id, external_id);
CREATE INDEX idx_output_dist_month ON output_distributions (tenant_id, period_month, activity_tag_id);
CREATE INDEX idx_output_dist_area ON output_distributions (tenant_id, area_key, period_month);
CREATE TABLE output_distribution_items ([T],
  distribution_id uuid NOT NULL REFERENCES output_distributions(id) ON DELETE CASCADE,
  commodity_id uuid NOT NULL REFERENCES pdd_commodities(id) ON DELETE RESTRICT,
  qty_kg bigint NOT NULL CHECK (qty_kg >= 0), PRIMARY KEY (distribution_id, commodity_id));
CREATE TABLE output_movements (id …, [T], source text NOT NULL CHECK (source IN ('modele','fichier_dots','dots','saisie')),
  connector_id uuid, external_id text NOT NULL CHECK (length(external_id) BETWEEN 1 AND 160),
  record_hash text NOT NULL CHECK (record_hash ~ '^[0-9a-f]{64}$'),
  first_batch_id uuid NOT NULL REFERENCES output_batches(id) ON DELETE RESTRICT,
  batch_id uuid NOT NULL REFERENCES output_batches(id) ON DELETE RESTRICT,
  kind text NOT NULL CHECK (kind IN ('expedition','remise','perte')),
  move_date date NOT NULL, period_month date NOT NULL, origin text CHECK (origin IS NULL OR length(origin) <= 160), [ZONE],
  geo_status text CHECK (mems_geo_status_ok(geo_status)), site_id uuid REFERENCES sites(id) ON DELETE SET NULL,
  partner_id uuid REFERENCES partners(id) ON DELETE SET NULL, raw_partner text CHECK (raw_partner IS NULL OR length(raw_partner) <= 200),
  activity_tag_id uuid REFERENCES activity_tags(id) ON DELETE RESTRICT, raw_activity text CHECK (raw_activity IS NULL OR length(raw_activity) <= 160),
  commodity_id uuid NOT NULL REFERENCES pdd_commodities(id) ON DELETE RESTRICT, qty_kg bigint NOT NULL CHECK (qty_kg >= 0),
  waybill text CHECK (length(waybill) <= 60), grant_ref text CHECK (length(grant_ref) <= 50), wbs text CHECK (length(wbs) <= 60),
  status text NOT NULL DEFAULT 'confirme' CHECK (status IN ('confirme','annule')),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (period_month = date_trunc('month', move_date)::date));
CREATE UNIQUE INDEX uq_output_moves_ext ON output_movements (tenant_id, external_id);
CREATE INDEX idx_output_moves_month ON output_movements (tenant_id, period_month, kind);
ALTER TABLE pdd_distributions ADD COLUMN IF NOT EXISTS batch_id uuid REFERENCES output_batches(id) ON DELETE SET NULL;
ALTER TABLE pdd_commodities ADD COLUMN IF NOT EXISTS aliases text[] NOT NULL DEFAULT '{}' CHECK (cardinality(aliases) <= 20);
```
- Les ventilations `[VENT]` vérifient la somme contre `population` ou `beneficiaries`.
- `document_deletions.doc_type` : + `'output_batch'`. Index `uq_*_current` : une seule version en vigueur par clé.
- Le réimport du découpage réattache `admin_area_id` des tables `output_*` par `area_pcode`, puis par chemin (§ 8).

### 095_data_connectors.sql

```sql
CREATE TABLE data_connectors (id …, [T], kind text NOT NULL CHECK (kind IN ('dots')),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 2 AND 120),
  base_url text NOT NULL CHECK (base_url ~ '^https://' AND length(base_url) <= 500),
  auth_mode text NOT NULL CHECK (auth_mode IN ('jeton','client_oauth')),
  token_url text CHECK (token_url IS NULL OR (token_url ~ '^https://' AND length(token_url) <= 500)),
  client_id text CHECK (client_id IS NULL OR length(client_id) <= 200),
  secret_enc bytea, secret_iv bytea, secret_tag bytea, secret_key_id text,       -- AES-256-GCM, jamais renvoyé
  secret_set_at timestamptz, secret_set_by uuid REFERENCES users(id) ON DELETE SET NULL,
  datasets jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(datasets) = 'object' AND pg_column_size(datasets) <= 16384),
  sync_from date NOT NULL, ordered boolean NOT NULL DEFAULT true,
  schedule text NOT NULL DEFAULT 'manuel' CHECK (schedule IN ('manuel','quotidien','horaire')),
  state jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(state) = 'object' AND pg_column_size(state) <= 8192),
  mapping_sha256 text CHECK (mapping_sha256 IS NULL OR mapping_sha256 ~ '^[0-9a-f]{64}$'),
  validated_by uuid REFERENCES users(id) ON DELETE SET NULL, validated_at timestamptz,
  active boolean NOT NULL DEFAULT false, [AUD],
  UNIQUE (tenant_id, name),
  CHECK (auth_mode <> 'client_oauth' OR (token_url IS NOT NULL AND client_id IS NOT NULL)),
  CHECK (num_nulls(secret_enc, secret_iv, secret_tag, secret_key_id) IN (0, 4)),
  CHECK (NOT active OR (secret_enc IS NOT NULL AND validated_at IS NOT NULL AND mapping_sha256 IS NOT NULL)));
ALTER TABLE output_batches ADD CONSTRAINT fk_output_batches_connector
  FOREIGN KEY (connector_id) REFERENCES data_connectors(id) ON DELETE RESTRICT;
-- même clé étrangère sur output_distributions et output_movements ; un connecteur se désactive, il ne se supprime pas
```
- Le dépôt ne lit les colonnes `secret_*` que dans `connectors.repository.loadSecretTx` (synchronisation). Toutes les autres requêtes ont des listes de colonnes explicites.

---

## 8. Serveur : modules, couches, verrous

Couches habituelles : routes (zod) → contrôleur → service → dépôt (seul à écrire du SQL). Deux dossiers : `server/src/modules/programmes/` et `server/src/modules/output/`.

| Fichier | Rôle | Pur |
|---|---|---|
| `programmes/activityKey.js` | Clé normalisée, jumelle de `mems_activity_key` | oui |
| `programmes/projectCycle.js` | Étapes, pièces (`ARTEFACTS`), pièces calculées, portes, phase courante | oui |
| `programmes/logframe.js` | Rangs, parents, contributions, codes, instantané, différence entre versions, données du schéma | oui |
| `programmes/indicatorMath.js` | Règles de période, cumul, ratio, période inachevée, statut via `classify` | oui |
| `programmes/grantMath.js` | Contre-valeur USD, Σ affectations, reste, gap, échéances TOD / TDD / rapports | oui |
| `programmes/attribution.js` + `projectScopeSql.js` | Règle du § 2.9 (pure) et ses CTE SQL (`MATERIALIZED`) | oui / SQL |
| `programmes/lineOfSight.js` | Arbre de la ligne de visée, totaux sans double compte, coûts par bénéficiaire | oui |
| `output/outputMath.js` | Mesures du § 2.10, kilogrammes et centimes entiers | oui |
| `output/outputTemplate.js`, `outputImport.js` | Modèle généré ; lecture et contrôle des feuilles (motifs codés, comme `pddImport`) | oui |
| `output/dotsContract.js`, `connectorCrypto.js` | Contrat zod et correspondance ; chiffrement AES-256-GCM | oui |
| `output/dotsClient.js` | Pages, jeton OAuth, curseur, via `remoteFetch` | non (E/S) |
| `map/decisionThemes.js` | Thèmes Output et Programmes, mêmes règles de taux que `mapThemes` | oui |
| `common/areaScopeSql.js` | « Unité ou descendante, sinon P-code du niveau », partagé avec le répertoire des localités | SQL |

- Toute écriture de plus d'une instruction passe par `withTenantTransaction`. Le tenant vient de `req.auth` seulement.
- **Verrous** : projet `FOR UPDATE` + `version` optimiste (cadre logique, étapes, zones) ; financement `FOR UPDATE` avant les affectations ; import Output sous `pg_advisory_xact_lock(hashtext('output:' || tenant))` ; connecteur `FOR UPDATE` + verrou `connector:<id>` pendant une synchronisation.
- Le cadre logique s'enregistre en un seul `PUT` (arbre entier : 500 nœuds, 2 000 cibles au plus) : contrôle pur d'abord, puis insertions et mises à jour multi-lignes.
- Les lectures sur un même client s'enchaînent (`await`), jamais `Promise.all`. Agrégats en SQL (`GROUP BY`, `SUM … FILTER`).
- **Un GET n'écrit jamais**, condition de la consultation multi-pays.
- `replaceBreakdown` traite une liste unique de tables à zones : `contract_areas`, `project_zones`, `grant_zones` (comptées dans la confirmation, réattachées par chemin), `output_*` (réattachées par P-code puis chemin).
- Nouvelles alertes (`alertsMath`, pures) : TOD / TDD proches, rapport bailleur dû ou en retard, financement confirmé non affecté après 30 jours, étape en retard, indicateur « Action urgente » sur la dernière période close, référence manquante après le démarrage, remis < 80 % du planifié pour un mois clos, lignes Output à rapprocher, lien DOTS en échec.
- Santé du paramétrage (`healthRules`) : sous-activités « À classer », projets sans zone, projets en mise en œuvre sans cadre validé, financements confirmés non affectés, lien DOTS non validé.

---

## 9. API

| Route | Qui | Rôle |
|---|---|---|
| `GET /api/settings/activities` | tous | Arbre activités › sous-activités, avec « Utilisé par » |
| `POST/PATCH /api/settings/activities[/:id]` ; `POST/PATCH /api/settings/activity-tags[/:id]` ; `POST …/activity-tags/:id/merge` | admin | Créer, renommer (alias gardé), déplacer, informer, fusionner, désactiver |
| `GET /api/settings/activity-labels` ; `POST …/activity-labels/link` | admin | Libellés libres non reconnus (avec nombres d'emplois) ; les relier |
| `GET/POST/PATCH /api/donors[/:id]` | lecture tous ; écriture admin, manager | Bailleurs |
| `GET /api/grants` (`?bailleur&statut&from&to&projet`) ; `GET /api/grants/:id` | tous | Liste et fiche |
| `POST /api/grants` ; `PATCH /api/grants/:id` (`version`) ; `POST /:id/confirm`, `/close`, `/cancel` | admin, manager | Cycle ; révision du montant avec motif |
| `PUT /api/grants/:id/allocations` ; `PUT /api/grants/:id/zones` | admin, manager | Remplacement en une transaction, Σ contrôlée |
| `GET /api/grants/:id/line-of-sight?from&to` | tous | Ligne de visée du financement |
| `GET /api/programmes` ; `POST/PATCH /api/programmes[/:id]` ; `PUT /api/programmes/:id/results` | lecture tous ; écriture admin | Plans, programmes, cadre de résultats |
| `GET /api/projects` (`?programme&phase&bureau&bailleur&financement&q`) ; `POST /api/projects` | tous ; admin, manager | Liste (phase, financement, statuts d'indicateurs) ; création avec ses 7 étapes et ses pièces |
| `GET/PATCH /api/projects/:id` | tous ; admin, manager | Fiche (`version` optimiste) |
| `PUT /api/projects/:id/stages/:stage` | admin, manager | Statut et dates ; porte → 409 `{ missing: [...] }` |
| `POST/PATCH/DELETE /api/projects/:id/artefacts[/:artefactId]` | admin, manager | Pièces (une pièce exigée ne se supprime pas : « sans objet ») |
| `PUT /api/projects/:id/zones` ; `PUT /api/projects/:id/contracts` ; `GET …/contract-candidates` | admin, manager ; tous | Zones ; contrats reliés ; contrats proposés (activités, zones, période) |
| `GET/POST/PATCH /api/projects/:id/risks[/:riskId]` | tous ; admin, manager | Registre des risques |
| `GET/PUT /api/projects/:id/logframe` ; `POST …/logframe/submit`, `/validate`, `/revise` ; `GET …/logframe/versions[/:n]` ; `GET …/logframe.xlsx` | tous ; admin, manager | Cadre logique, validation, versions, export de la matrice |
| `GET /api/projects/:id/performance?from&to` ; `PUT …/indicator-values` ; `POST …/indicator-values/validate` | tous ; admin, manager | Réalisé et statut ; saisie ; validation par une autre personne |
| `GET /api/projects/:id/line-of-sight?from&to` ; `GET …/sites?from&to` ; `GET …/journal` | tous | Ligne de visée ; sites déduits ; journal |
| `DELETE /api/projects/:id` ; `DELETE /api/grants/:id` | admin, manager (validé : admin + justificatif) | Politique du retour 56 |
| `GET /api/output/overview` ; `GET /api/output/months` | tous | Chaîne, tableau des mois, par sous-activité (`?from&to&bureau&programme&projet&financement&activite&sous_activite`) |
| `GET /api/output/population` ; `GET /api/output/targets` ; `GET /api/output/targets/:id/history` | tous | Listes paginées ; versions |
| `POST /api/output/targets` ; `PUT /api/output/targets/:id` ; `POST /api/output/targets/:id/retire` | admin, manager | Saisie ; révision et retrait avec motif |
| `GET /api/output/distributions?month=` | tous | Plan, réalisé, logistique, comparaison du mois (paginé) |
| `GET /api/output/template.xlsx` ; `POST /api/output/import/preview` ; `POST /api/output/import` | tous ; admin, manager | Modèle ; vérification ; import |
| `GET /api/output/batches` ; `POST /api/output/batches/:id/cancel` | tous ; admin, manager | Journal des ajouts ; annulation (justificatif) |
| `GET/POST/PATCH /api/connectors[/:id]` ; `PUT /:id/secret` ; `POST /:id/test`, `/preview`, `/validate`, `/sync`, `/resync-month` ; `GET /:id/runs` | admin (runs : manager) | Lien DOTS |
| `GET /api/map/decision` ; `GET /api/map/decision/unit/:areaId` ; `GET /api/map/decision/site/:siteId` ; `GET /api/map/points` (+ `couleur=activite`, filtres) | tous | Carte décisionnelle |

- Validation zod partout ; tailles bornées ; périodes par `readPeriod` (`PERIOD_CAPS.facts` pour la carte et l'Output, `document` pour la ligne de visée).
- Erreurs par le gestionnaire central : 409 pour les portes, versions et sommes ; 400 pour les contraintes ; 413 pour un fichier trop gros.

---

## 10. Écrans et navigation

**Menu** (déclaré dans `AppShell.jsx`, redirections dans `App.jsx`) :

```
Programmes                         (nouveau groupe, en tête ; icône Target)
  Programmes & projets  › Portefeuille · Bailleurs & financements
Contractualisation                 (inchangé)
Suivi & évaluation
  Partenaires & TPM                (inchangé)
  Suivi de processus               « Carte des sites » retirée → #/dashboard/carte
  Distributions & Output           › Vue d'ensemble · Ciblage & population · Distributions · Pipeline (stock)
Pilotage
  Dashboard décisionnel            › Vue d'ensemble · Carte décisionnelle · Suivi budgétaire consolidé · Couverture & performance
Administration
  Paramétrage                      › Activités (3 niveaux) · … · Données › Connecteurs (admin)
```

- Redirections : `pdd/synthese` → `pdd/apercu` ; `processus/carte` → `dashboard/carte` ; vue « Carte » de Couverture & performance → `dashboard/carte` (passage des filtres par `mems.map.open`).
- Bilan : 3 entrées de carte deviennent 1 page + des aperçus ; la Synthèse PDD se fond dans la Vue d'ensemble.

| Écran | Adresse | Contenu |
|---|---|---|
| Portefeuille | `#/programmes/portefeuille` | Période, filtres (programme, bailleur, bureau, phase). 4 tuiles : projets en cours · financements actifs (USD) · atteints / ciblés · indicateurs « Action urgente ». Bascule Tableau · Ligne de visée. Tableau groupé par programme : projet, phase (mini-étapes), période, zones, financement, ciblés / atteints, pastilles d'indicateurs, signaux. Tiroir « Fiche programme » (`?programme=<id>`) : cadre de résultats, projets, financements |
| Fiche projet | `#/programmes/portefeuille/<id>/<onglet>` | En-tête : code, titre, programme, phase, statut, période, chef de projet ; actions Modifier · Historique · Supprimer. Onglets : **Vue d'ensemble** (chaîne grant → sites, tuiles, « ce qui demande attention ») · **Cycle & documents** (7 étapes, Suivi en bande parallèle, pièces, « Clore l'étape ») · **Cadre logique** (Matrice ou Schéma, versions, Soumettre / Valider / Réviser, registre des risques, export) · **Performance** (indicateurs : source, référence, cible, réalisé, avancement, statut, « Comment c'est calculé », saisie et validation, ventilation) · **Zones & sites** (tableau des zones, sites déduits avec la règle, aperçu de carte) · **Financements & contrats** (affectations, gap, contrats reliés et proposés, coûts par bénéficiaire) |
| Bailleurs & financements | `#/programmes/financements` (`/<id>`) | Onglets Financements · Bailleurs. Tableau : n° de grant, n° d'award, bailleur, intitulé, montant (devise et USD), dates, TOD, TDD, statut, part affectée, projets, zones. Tiroir : conditions, affectations (somme contrôlée), zones, obligations de rapport, ligne de visée, historique |
| Distributions & Output | `#/pdd/apercu`, `/ciblage`, `/distributions`, `/pipeline` | § 3.5. Barre commune : période, bureau, activité › sous-activité, projet ; boutons Modèle Excel · Importer · Journal des ajouts |
| Carte décisionnelle | `#/dashboard/carte` | § 6 |
| Paramétrage › Activités | `#/parametrage/activites` | Arbre Activité › Sous-activités ; panneau « Information » ; onglet « Libellés à rapprocher » ; fusion |
| Paramétrage › Connecteurs | `#/parametrage/connecteurs` | Étapes : Adresse & accès → Jeux de données & correspondance → Aperçu → Validation → Synchronisation ; journal des passages |

**Design « Enterprise sobre — Fiori/Fluent »** : jetons du bloc v6 seulement ; tuiles KPI sobres (4 au plus) ; tableaux denses à en-tête gris ; codes en IBM Plex Mono, chiffres en Inter `tabular-nums` ; niveaux du cadre logique en pastilles neutres ; **statuts = couleur + icône + libellé** via `StatusBadge` (nouvelles tables `PROJECT_STAGE`, `STAGE_STATUS`, `GRANT_STATUS`, `LOGFRAME_STATUS`, `ARTEFACT_STATUS` dans `web/src/lib/programmes.js`, classes d'indicateur = `INDICATOR_STATUS`) ; étapes du cycle sur le modèle du fil guidé des rapports ; tiroirs à droite comme la liste des indicateurs ; rayons 6 / 9 / 14 ; aucun débordement à 1 440 et 390 px ; couleurs de séries validées par l'outil de palette. Aucune mention « WFP » / « PAM ».

**Français / anglais** : dictionnaires `web/src/locales/en/programmes.js` et `en/output.js`. Ex. : Portefeuille → Portfolio · Bailleurs & financements → Donors & grants · Cadre logique → Logframe · Ligne de visée → Line of sight · Théorie du changement → Theory of change · Cycle & documents → Cycle & documents · Distributions & Output → Distributions & Output · Ciblage & population → Targeting & population · Carte décisionnelle → Decision map · Estimation basse → Low estimate.

---

## 11. Livraison par étapes

Chaque commit se publie seul, après `npm test`, `npm run lint`, `npm run build` (web), le balayage `node web/scripts/sweep-ecrans.cjs` (FR et EN), les migrations essayées sur une base neuve **et** sur une copie, puis une vérification indépendante. Journal tenu à chaque commit.

| Étape | Commits | Vérification |
|---|---|---|
| **1. PDD relié** (sans migration) | 1a `GET /api/pdd/overview` + mise en forme pure testée ; 1b Vue d'ensemble (tuiles, tableau des mois, Synthèse fondue, redirection) ; 1c « Ajouté le / par », filtre « ajoutés depuis » | Tableau des mois = sommes SQL ; aucun mois vide par défaut ; balayage |
| **2. Carte décisionnelle v1** (sans migration, après `wip/ui-polish`) | 2a `/api/map/decision` (thèmes 6a + tonnage planifié du PDD) ; 2b page, panneau latéral, filtres période, bureau, activité ; 2c redirections, aperçus | Une seule page de carte ; mêmes chiffres que la Couverture ; budgets du § 6.5 |
| **3. Référentiel des activités** (090) | 3a migration + reprise + `activityKey` (parité JS / SQL) ; 3b API ; 3c Paramétrage › Activités (3 niveaux) ; 3d listes du référentiel sur les sites, le MMR, les fiches (avec les agents du plan de suivi) | Aucun lien perdu : chaque libellé existant se résout ; renommer ne détache rien |
| **4. Bailleurs & financements** (091) | 4a migration + `grantMath` ; 4b API, alertes TOD / TDD / rapports ; 4c écran | Contre-valeur USD identique au calcul SQL ; transitions refusées en base |
| **5. Programmes & projets** (092) | 5a migration + `projectCycle` ; 5b API (étapes, pièces, zones, contrats, risques, affectations, journal, suppression) ; 5c Portefeuille et fiche (Vue d'ensemble simple, Cycle & documents, Zones & sites, Financements & contrats) ; 5d réimport du découpage | Σ affectations > montant refusée même en écriture concurrente ; portes testées |
| **6. Cadre logique & performance** (093) | 6a migration + `logframe` ; 6b API, gel, versions ; 6c `indicatorMath` et sources saisie, suivi, couverture, budget, ratio ; 6d onglets Cadre logique (matrice, schéma) et Performance, export Excel | Un cadre validé ne se modifie pas en base ; statut = `classify` |
| **7. Output** (094) | 7a migration + `outputMath` ; 7b modèle généré + import (vérification, import, lots, annulation) ; 7c Ciblage & population, Distributions (4 onglets), chaîne complète ; 7d source « Output » des indicateurs, ligne de visée, thèmes Output de la carte | Aller-retour modèle → import sans écart ; réimport identique = 0 modifiée ; 20 000 lignes ≤ 10 s |
| **8. Connecteur DOTS** (095) | 8a migration + chiffrement + contrat + correspondance (tests sans réseau) ; 8b client, test, aperçu, synchronisation manuelle, tâche du worker ; 8c Paramétrage › Connecteurs ; 8d concepteur (§ 12) | Faux serveur DOTS local : reprise après coupure sans doublon ni trou ; secret absent de toute réponse |

L'étape 8 se teste sur un faux serveur tant que l'adresse et les accès DOTS manquent (Q4) ; l'import des exports DOTS (`fichier_dots`) est livré dès l'étape 7.

---

## 12. Compatibilité multi-pays et coordination

**Multi-pays (`SPEC_MULTIPAYS.md`, option A)** :
- Toutes les tables sont par bureau pays, sous la même RLS. Aucune table globale. Les modules répondent dans un espace `country` seulement.
- **Un GET n'écrit jamais** : la consultation en lecture seule (`BEGIN READ ONLY`) fonctionne sans changement.
- **Codes communs** pour comparer les pays (Q5 du multi-pays) : `donors.code`, `grants.grant_number`, `programmes.code`, `activities.code` et `activity_tags.code`, `result_indicators.standard_code`. Un grant multi-pays existe dans chaque pays sous le même numéro, avec la part du pays ; le montant total de l'accord est une information.
- **Devises** : financements et budgets de projet en USD figés (aucun taux nécessaire pour consolider) ; contrats convertis par `currencyMath.sumUsdCents`, total « partiel » si un taux manque.
- Comptes de l'Output additifs entre pays ; taux recalculés (Σ numérateurs ÷ Σ dénominateurs) ; indicateurs comparés seulement à `standard_code` égal.
- Concepteur : nouveau groupe « Programmes et Output » (portefeuille, cadre logique, performance, financements, ligne de visée, chaîne, mois, ciblage, logistique), marqué `scope: 'country'` ; les chiffres clés ratio exposent numérateur et dénominateur (`scope: 'both'`). Filtres ajoutés à `FILTER_KEYS` : `programme`, `project`, `grant`.
- Carte : contours lus dans `country_profiles.shape_set` (085), jamais une constante. Connecteurs DOTS : un par pays.

**Coordination avec les chantiers en cours** :
- **Lot 2** : le référentiel des activités est livré ici (090) ; le lot 2 ne le refait pas et s'appuie dessus (codes de bureau, libellés « Autre »).
- **Lots 3 et 4** (`S-XXXX-XXXX`, sites actifs, réalisé issu des données) : la règle d'attribution lit le registre et le service `siteMonthFactsCtes` ; elle suit leurs changements sans double travail.
- **Lot 5 / `wip/lot5-gen`** et **`wip/r58`** : le MMR et le plan de suivi passent aux listes du référentiel à l'étape 3d, après leur fusion.
- **`wip/ui-polish`** (carte : zoom bureau, couleurs par activité, légende) : l'étape 2 part de leur fusion.
- **Lot 8 / `wip/lot8`** : partenaires inchangés ; le dépôt de fichiers (retour 29) remplacera les références de pièces (H2).
- **`wip/perf`** : budgets et banc du § 6.5 ajoutés à `npm run perf:*`.
- **Refonte UX** (menu cible) : « Programmes » reste en tête ; « Distributions & Output » rejoint « Données collectées » ; la carte reste dans le Pilotage.

---

## 13. Tests

**Tests purs** (`npm test`) :
- `activityKey` : parité JS / SQL sur 200 libellés (accents, espaces, casse, ponctuation).
- `projectCycle` : chaque porte ; « sans objet » sans motif refusé ; Suivi parallèle ; phase courante ; abandon ; pièces calculées.
- `logframe` : rangs ; parent d'un autre cadre refusé ; contributions permises et refusées ; codes uniques ; instantané et différence ; schéma.
- `indicatorMath` : somme, dernière, moyenne, plus grand mois ; cumul ; ratio à dénominateur nul → « — » et raison ; période inachevée sans classe ; statut identique à `classify`.
- `grantMath` : USD au cent ; Σ affectations ; gap ; TOD / TDD et rapports à 90 et 30 jours.
- `attribution` : WBS et grant d'abord ; zone descendante ; P-code de secours ; hors période ; ligne partagée comptée une fois.
- `lineOfSight` : totaux sans double compte ; coûts par bénéficiaire seulement si calculables ; devises jamais mélangées.
- `outputMath` : assistances, plus grand mois, estimation basse ; taux sans dénominateur ; tonnes ↔ kilogrammes, centimes.
- `outputTemplate` / `outputImport` : aller-retour ; P-code et noms ; ventilation ; recouvrement parent / fille refusé ; erreurs Excel ; plafonds ; réimport identique = 0 modifiée ; motif exigé pour une révision ; source maîtresse.
- `dotsContract` : champs hors contrat ignorés ; champ personnel refusé ; regroupement par identifiant ; statut « annulé » ; page malformée.
- `connectorCrypto` : aller-retour ; mauvaise clé ou contenu altéré → erreur ; rien dans les journaux.
- `decisionThemes` : taux recalculés depuis les comptes ; « — aucun plan » ; « aucune population ».
- Fichiers SQL 090–095 (méthode de `mapMigration061.test.js`) : RLS et `tenant_isolation` sur chaque table ; `mems_install_same_tenant` appelé ; `REVOKE` des journaux ; aucune colonne `secret_` dans un `GRANT SELECT` de vue ou de fonction.

**Tests de dépôt et de routes** (faux clients) : tenant pris dans `req.auth` seulement ; 409 des portes, versions et sommes ; `FOR UPDATE` ; la vérification d'import n'écrit rien ; annulation d'un lot ; suppression selon le retour 56 ; aucune réponse ne contient de secret ; GET sans écriture.

**Tests d'isolation en base** (`npm run test:db` du multi-pays, s'il existe) : les nouvelles tables sont couvertes d'office ; une référence vers un autre compte est refusée (`trg_same_tenant`).

**Balayage** : les nouveaux écrans dans `sweep-ecrans.cjs`, FR et EN, 1 440 et 390 px : 0 erreur, 0 phrase manquante. **Banc** : `/api/map/decision`, `/api/output/overview`, Portefeuille et fiche projet sur la base ×8.

---

## 14. Risques

| Risque | Parade |
|---|---|
| Double compte entre projets (zones et sous-activités qui se recouvrent) | Lignes « partagées » visibles ; totaux par identifiants distincts ; jamais de prorata inventé |
| Double compte entre lien DOTS et fichiers | Source maîtresse par nature et par mois ; identifiants stables |
| Libellés d'activités désordonnés | Reprise sous « À classer », alias, fusion guidée, santé du paramétrage |
| Réimport du découpage qui détache des zones | Même mécanisme que les contrats : confirmation chiffrée, réattachement par P-code puis chemin |
| API DOTS inconnue | Configuration au lieu de code ; faux serveur pour les tests ; repli par fichier |
| Données personnelles via DOTS | Contrat d'agrégats ; champs personnels refusés ; aucun enregistrement brut gardé |
| Fuite de secret | AES-256-GCM, clé hors base, écriture seule, rotation, journaux masqués, test des réponses |
| Gros imports ou synchronisations | Plafonds, insertions multi-lignes, transaction par page, worker |
| Écarts de chiffres entre écrans | Une règle par mesure (§ 2.9, § 2.10), en SQL, jumelle pure testée ; `classify` et `consolidation` réutilisés |
| MEMS pris pour un outil financier | Pas de dépenses par financement ; coûts limités aux deux mesures nommées (H5) |
| Collision avec les chantiers en cours | Numéros 090–095 ; dépendance aux seules migrations publiées ; § 12 |

---

## 15. Questions pour l'utilisateur

Hypothèses retenues sans question (le dire si l'une est fausse) :
- **H1** : un financement est saisi dans sa devise ; sa contre-valeur USD est figée à la confirmation ; consolidation en USD.
- **H2** : les pièces du cycle sont des références (nom, lien, date) tant que MEMS n'a pas de dépôt de fichiers (lot 8).
- **H3** : un cadre logique validé est figé ; toute modification passe par une révision motivée et versionnée.
- **H4** : une valeur saisie d'indicateur est validée par une autre personne que son auteur.
- **H5** : MEMS ne remplace pas le système financier ; pas de dépenses par financement.
- **H6** : aucune donnée individuelle de bénéficiaire n'entre dans MEMS par l'Output ou DOTS.

| # | Question | Défaut recommandé |
|---|---|---|
| **Q1** | Les niveaux « Plan stratégique › Programme (résultat stratégique) › Projet » correspondent-ils à votre organisation ? | Oui. Le niveau « Plan » est facultatif ; le programme porte l'impact et les effets stratégiques. |
| **Q2** | Ce qui appartient à un projet (sites, plan, distributions, données) est-il déduit, ou tenu en liste à la main ? | Déduit : WBS ou n° de grant d'abord, sinon zones × sous-activités × période ; les lignes partagées sont signalées. |
| **Q3** | Sur plusieurs mois, comment compter les bénéficiaires dans les tuiles et rapports ? | Le plus grand mois par zone et sous-activité ; la somme affichée à côté sous le nom « assistances » ; la donnée « uniques » de DOTS quand elle existe. |
| **Q4** | DOTS : quelle adresse, quel accès (jeton ou client OAuth), quels jeux (distributions, expéditions, remises, pertes) et quelle fréquence ? | En attendant : import des exports DOTS par fichier avec la même correspondance ; lien activé dès réception, synchronisation quotidienne. |
| **Q5** | Quelle ventilation des bénéficiaires : femmes / hommes / filles / garçons, ou des tranches d'âge plus fines ? | Femmes, hommes, filles, garçons (facultatif, somme égale au total). Tranches plus fines plus tard, par configuration. |
| **Q6** | « Distribution d'urgence » peut-elle devenir « Distributions & Output » (même entrée, 4 onglets), avec un groupe « Programmes » en tête du menu ? | Oui ; les anciennes adresses redirigent. |
