# Plan de réalisation — retours n° 15 à 55 (13/10/2026)

Ce plan découle des analyses multi-agents de vos retours (le détail de chaque retour
est dans [`RETOURS_UTILISATEUR.md`](RETOURS_UTILISATEUR.md), l'avancement dans
[`JOURNAL.md`](JOURNAL.md)). Chaque lot est livrable seul : code + tests + vérification
à l'écran + relecture adverse, puis publication sur `main`.

## Définitions communes (une seule règle, utilisée partout)

| Notion | Règle |
|---|---|
| **Mois de collecte** | Mois de la **date d'enquête** (SvyDate) quand elle précède l'envoi au serveur de 0 à 92 jours ; sinon mois de l'envoi. (Aujourd'hui MEMS prend le mois d'envoi : 503 soumissions SMP sur 1 290 sont au mauvais mois.) |
| **Site** | Une ligne du registre (lieu × activité), avec une **clé système immuable** (ex. `S-000123`), un **code de localité** tiré du découpage (P-code du fokontany, sinon de la commune, + numéro d'ordre : `MG11101001001-001`, groupable par préfixe) et le Code POI de vos fichiers. |
| **Visite** | Site × mois de collecte, comptée une fois quel que soit le nombre de soumissions. |
| **Réalisée** | Au moins une soumission rattachée **au site** ce mois-là (« données »), ou une visite déclarée réalisée **avec motif obligatoire** (« déclarée sans donnée », signalée). Une donnée rattachée seulement à la commune n'est jamais une visite. |
| **Prévue / Hors plan** | Prévue = visite planifiée ce mois ; Hors plan = réalisée sans être prévue (mois sans plan : « Données sans plan »). |
| **Site actif** | Actif ce mois dans la grille d'activation (Oui/Non par mois) et hors zone interdite. |
| **Taux** | **Couverture** = sites actifs réalisés ÷ sites actifs (« MMR Actual % ») · **Planification** = sites actifs prévus ÷ sites actifs (« MMR Planned % ») · **Exécution du plan** = réalisées parmi les prévues ÷ prévues. Jamais « 0 % » quand il n'y a pas de plan : « — aucun plan ». |
| **Dernière visite (RBM)** | Dernier mois réalisé ≤ mois M (données ou déclaré). Une visite seulement planifiée ne compte jamais. |
| **Bureau** | Bureau du site pour une visite ; sinon bureau reconnu de la soumission ; un code non relié s'affiche « Code 6 (non relié) » avec un lien vers les correspondances, jamais un chiffre seul. |
| **Période** | Une plage de mois « du … au … » (un seul mois = plage d'un mois), la même partout ; sur une plage, les sites se comptent **une fois** (sites distincts). Par défaut : dernier mois qui a vraiment des données (avec un bandeau qui le dit), jamais un mois vide. |
| **Prestataire actif** | Un contrat actif couvrant le mois rend son TPM sélectionnable partout (plan de suivi, planification, rapports, évaluations). |
| **Suppression** | Un élément qui porte des données ne se supprime jamais : il se désactive. |

## Lots, dans l'ordre

| Lot | Contenu | Retours |
|---|---|---|
| **0** | Correctifs de la relecture (imports Excel, formules, correspondances, import) + zone centrale élargie | contre-vérif., 31 |
| **1** | Mois de collecte = date d'enquête + mapping modifiable et validé (brouillon → soumis → validé) · indicateurs : modification sans perte, « Nouvel indicateur » / « Modifier » partout, méthode de calcul visible · tableaux de bord : période par défaut, axe lisible, noms de bureau au lieu des codes, Synthèse dense, cloche = Centre d'alertes | 35, 20, 16, 19, 34 |
| **1b** | Période = plage de mois partout : sélecteur « du … au … » avec préréglages (mois, trimestre, semestre, janvier–juin, année), API `from` / `to`, sites distincts sur la plage, filtres des tableaux de bord, des résultats, de la couverture, des alertes et du concepteur | 47 |
| **54** | Tableau trimestriel par activité (sites actifs / prévus / réalisés, couverture, exécution) dans les tableaux de bord — juste après les correctifs 1b | 54 |
| **6a** | **Carte exploitable, remontée en priorité** (retours 49, 50) : contours des 119 districts déjà embarqués, couleur par district (sites actifs, visités, couverture, risque, données versées), sites par GPS ou par la position de leurs collectes, points de collecte, légende graduée, fiche au survol, classement ; section « Carte » dans le Dashboard décisionnel. Le reste du lot 6 (communes, surcouches, export imprimable) suit | 49, 50 |
| **2** | Référentiels : clés système immuables, suppression protégée partout, activités et sous-activités, codes de bureau des formulaires (1 Bekily … 10 Tulear), code de localité tiré du découpage (retour 46), libellés et réponses « Autre » dans les correspondances · zones du contrat en tableau (niveau, bureau, sites du registre et sites actifs par sous-activité, état ; P-code facultatif, colonne masquée par défaut) | 32, 33, 37, 38 |
| **3** | Registre réel : import du classeur d'activation (grille Sites actifs par mois + motif, aller-retour Excel), contrôle du fichier (colonne Code POI décalée), code proposé fokontany + 00n, rattachement GPS → découpage (contours importés), garde sur les codes et règles nom + GPS | 23, 33, 36, 14 |
| **4** | Réalisé issu des données (site × mois) : tableau des mois avec « Données sans plan », plan de suivi P/R (R = données, déclaré avec motif), RBM « à suivre » juste, Couverture du suivi (filtre bureau, visites totales, tableau par sous-activité et par bureau en sites uniques actifs / prévus / réalisés) | 15, 21, 22, 26 |
| **5** | RBM et plan réaliste : règles de priorité configurables (table si / sinon, aperçu, versions), chaque drapeau avec « Pourquoi ? » et « Que faire ? », risque par période avec journal ; **calendrier d'activité** (mois × jours d'assistance → durée réelle) ; **générateur de plan MMR réaliste** (sites à suivre, regroupement commune / district en tournées multi-activités, capacité par jour et intervalle ajusté, objectif ≥ 80 % des sites, dernière visite réelle, recommandations urgentes), paramètres modifiables initialisés du MMR / RBM | 24, 25, 48, 55 |
| **6** | Carte du suivi : fond vectoriel hors ligne, sites planifiés / réalisés, choroplèthe par commune (contours importés), couches de classification et surcouches hachurées importables, étiquettes, carte de situation, nord, échelle, légende, pied de page, export image / PDF, panneau latéral (vos captures) ; présentation interactive façon « HungerMap » (chiffre clé, classement des zones, couches par thème, fiche au survol, légende graduée, recherche) ; tableau de bord par activité (maquette) | 17, 27, 40, 41, 44 |
| **7** | Concepteur de rapport : éditeur large à 3 volets, blocs = graphiques et tableaux des tableaux de bord, tableaux qui tiennent dans la page, chiffres justes ; filtres par bureau, période, activité (rapport et bloc) ; **fil de validation** (brouillon → soumis → validé / rejeté) ; modèle « Rapport de suivi des performances » fidèle à votre exemple PowerPoint (synthèse + une page par activité) ; **catalogue de blocs = tout ce que MEMS saisit ou calcule** (tableaux de bord, plan, RBM, budget, PDD, partenaires, alertes, carte) ; quatre mises en page de vos références : rapport A4 portrait, présentation 16:9 de direction, fiche 2 pages, fiche infographique (chiffres clés + sections par module) ; règles du guide de visualisation par défaut (titre, source, n, axe à zéro, palette sobre) ; en-tête et pied de page libres (logos, images, textes placés où l'on veut), orientation par page, calcul rapide même sur de gros volumes ; export PowerPoint | 18, 39, 40, 43, 45, 51, 52, 53 |
| **8** | Partenaires & TPM : fiche 360° + évaluation du TPM, formations, évaluation des agents, Planification & budget (Excel Gantt + budget), rapports attendus créés à l'approbation du plan (financier / technique, pièces jointes), TPM actif selon le contrat | 28, 29, 30 |

Les lots 1 à 3 posent les fondations (dates, référentiels, registre) dont dépendent les
chiffres des lots 4 à 8.

**Ordre révisé le 13/10 (retours 47 à 53)** : après la publication du lot 1, trois chantiers en parallèle — **1b** (période = plage de mois), **6a** (carte exploitable + carte dans le Dashboard décisionnel) et **7a** (concepteur de rapport riche : catalogue de toutes les données de MEMS, en-tête et pied libres, orientation par page, calcul rapide et progressif, fil de validation) ; puis lots 2–3, 4, 5, 7b (modèles fidèles et blocs des lots 4–5) et 8.

Documents de référence fournis (retour 42) : rapport d'atelier PECMAM, stratégie SMP, stratégie résilience, note sur l'alimentation scolaire — consultés pour les descriptions d'activités (lot 2) et les modèles de rapport (lot 7).
