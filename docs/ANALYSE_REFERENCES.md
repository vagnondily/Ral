# Analyse des références et feuille de route de MEMS 2.0

> **Mise à jour du 12/10/2026 (après l'audit).** Les lots de cette feuille de route sont notés **R0 à R13** pour ne pas les confondre avec les lots 0 à 10 de [`ANALYSE_LIAISONS.md`](ANALYSE_LIAISONS.md), que suit le journal. Depuis l'état audité (`473d7fa`), sont déjà corrigés :
> - validation d'une facture réservée au rôle validateur, sur un rapport soumis, par une autre personne (`cf0c46b`) ;
> - modification partielle d'un site sans effacer activité ni fokontany ; niveaux admin réalignés (admin3 = Commune) et alias accentués reconnus ; une seule définition du Réalisé (factures validées) ; pré-remplissage depuis le plan du bon prestataire ; pipeline PDD « tous les mois » ; filtrage par bureau du concepteur (`cf0c46b`) ;
> - moteur de rapprochement des lieux (`4c22775`) ; réimport du découpage sans détacher les contrats (lot 1 des liaisons).
>
> Restent ouverts et vérifiés : `factureXlsx.js` lit encore `report.reference` ; un rapport « attendu » ne peut toujours pas être soumis (`replaceReportItems` ne fait passer que « rejeté → soumis »).


**Périmètre.** Ce document s'appuie sur les classeurs, exports, formulaires, factures et rapports que vous avez partagés comme références. Il couvre huit domaines et **395 comportements attendus**. Chacun a été confronté au code et vérifié deux fois, dont une fois en revue contradictoire, sur l'état du dépôt au 12 octobre 2026. Les commits postérieurs à l'audit sont pris en compte : 3b45556 pour le Plan de suivi, 041742a, 473d7fa et 9ac50ea pour les XLSForm, ainsi que la migration 047.

**Légende.**
- **Statut** : *En place* (conforme, avec parfois des réserves mineures), *Partiel* (le comportement existe mais il reste un écart vérifié), *Absent*.
- **Effort**, en ordre de grandeur indicatif : S ≤ 1 j, M ≈ 2–4 j, L ≈ 1–2 sem., XL > 2 sem.

| Domaine | Comportements | En place | Partiel | Absent |
|---|---|---|---|---|
| Plan de suivi, RBM, MMR | 45 | 14 | 28 | 3 |
| Formulaires XLSForm | 52 | 2 | 19 | 31 |
| Exports Kobo/Ona du suivi de processus | 49 | 0 | 18 | 31 |
| Exports Kobo de distribution SMP et enquête CP | 35 | 0 | 8 | 27 |
| Contrat FLA, facture, planning | 55 | 2 | 20 | 33 |
| Rapports et tableaux de bord | 73 | 0 | 56 | 17 |
| Plan de distribution d'urgence (PDD) | 38 | 0 | 11 | 27 |
| Import multi-sources et lien WDC | 48 | 2 | 24 | 22 |
| **Total** | **395** | **20** | **184** | **191** |

---

## Ce que vous attendez de MEMS

1. **Remplacer vos classeurs sans rien perdre.** Les classeurs RBM V2, budget FLA, facture et état des dépenses, PDD et planning de collecte doivent être reproduits avec leurs formules et leurs mises en page. Les calculs sont refaits côté serveur et les bogues des gabarits sont corrigés : `S9 = $E9*F9`, chaînage cassé des factures M5 à M9, huile et dattes vidées à la main, `ecart_stock = X − X`.
2. **Aller-retour Excel sans perte** pour chaque objet métier (référentiel de sites, MMR, budget, facture, PDD, planning) : télécharger, modifier hors ligne, réimporter, avec un aperçu avant écriture.
3. **Ingérer les données de terrain telles qu'elles sortent de Kobo et de MoDA** : zip SPSS avec ses répétitions, XLSX à plusieurs feuilles, XLSForm .xls ou .xlsx, lien Tableau WDC, API Kobo. Aucune retouche préalable ne doit être nécessaire, aucun doublon ne doit apparaître au réimport, et les volumes réels (216 Mo décompressés, 32 717 variables) ne doivent pas faire tomber l'application.
4. **Une seule chaîne de pilotage RBM** : risque, puis intervalle MMR (`durée ÷ risque`), visites exigées, plan mensuel, réalisé, couverture. La même règle doit s'appliquer partout.
5. **Une couverture comptée en sites distincts sur les sites actifs de la période**, par programme, prestataire TPM, partenaire, bureau et commune, avec le dénominateur toujours affiché.
6. **Des scores recalculés à partir des variables brutes**, jamais repris des scores pré-calculés des formulaires. La méthode est explicite, le sens des indicateurs est respecté, les réponses « sans objet » sont exclues et les petits effectifs sont signalés.
7. **Une chaîne financière exacte** : Budget FLA, puis Planifié, puis facture au niveau du sous-poste, puis cumul, restant et consolidation. Les calculs se font en centimes, avec la commission de 7 %, le montant en toutes lettres, les visas et le montant payable validé.
8. **Un PDD calculé** (`bénéficiaires × ration × jours`), confronté au stock par lot et à la date limite de subvention, puis imprimé et signé.
9. **Des rapports institutionnels** en A4 paysage, éditables, dont les textes générés restent liés aux chiffres. Les modèles sont réutilisables et s'exportent en PDF, Word, Excel et HTML.
10. **Des alertes actionnables** : dépassement d'un sous-poste, date de subvention ou de péremption, risque critique à traiter sous 24 h, site en alerte, donnée à vérifier, capacité MMR insuffisante.
11. **Une application d'entreprise** : marque neutre (« bailleur »), interface FR/EN réelle, statuts en couleur + icône + libellé, journal et historique de chaque import, rapports finalisés figés.
12. **Une maintenance simple** : un seul endroit par règle (modules purs testés sur vos fichiers réels), des couches respectées, un import unique au lieu de treize voies dispersées.

---

## Domaine 1 — Plan de suivi, RBM et MMR (`RBM_MDG_V2_2025.xlsm`)

### Ce que montrent les références
- **Quatre feuilles et aucune macro active.** Le VBA, décodé, ne contient que des attributs : tout le comportement vient des formules. Deux liens externes pointent vers une demande de localités et un ancien plan de suivi, dont le cache contient 2 646 lignes « Co-Monitoring ».
- **Settings** :
  - 17 sous-types de POI avec leur code, dont 4 libellés portant le nom du bailleur, à neutraliser ;
  - statut `Active = 1`, `Inactive = 0` ;
  - 8 bureaux avec un code parent : Tsihombe, Fort Dauphin et Bekily dépendent d'Ambovombe (code 2).
- **Locations Management** :
  - colonnes A3:Y3 : ID `L###`, Status, Point of Interest, POI Subtypes/Code, Activity Tag, Sub Office, Admin level 1–3, Urban Area, GPS, 11 critères, Score ;
  - grille Z:AK des mois 1 à 12, grille AL:AW du statut mensuel sous l'année inscrite en AL2 ; gabarit de 12 lignes ;
  - `Status = IFERROR(LOOKUP(2, 1/(AL:AW<>""), AL:AW), "")` donne le dernier mois renseigné ;
  - `Code POI = VLOOKUP(D, Settings!A4:B21, 2, 0)` ;
  - le **Score Y n'a ni formule ni pondération**. Le GPS est au format comptable à 0 décimale, alors que l'application doit en conserver 6.
- **Sheet4, échelles exactes des critères** :
  - sécurité ∈ {0, 1, 3, 99}, sans valeur 2 ; 99 = zone interdite ;
  - synergies {0, 1} ; modalité {Cash, Voucher, Food, Capacity Strengthening, Mix} ; bénéficiaires : entier ≥ 0 ;
  - nouveau partenaire {0, 1} ; partenaire expérimenté {0, 1, 2} ;
  - problèmes PM, rapport partenaire et CFM {0, 1, 2} ; fraude {0, 1, 2}.
- **Overreaching Parameters (MMR)**, par bureau × catégorie CSP (9 catégories) :
  - `C = B & D` sert de clé d'unicité ;
  - `F = COUNTIFS(plan; catégorie; bureau)` peut être écrasé à la main (F4 = 1 220 saisi) ;
  - `H = E / G` : intervalle minimal en mois ;
  - `I = E / H` (vaut G) ;
  - `J = F / H` : sites ciblés par mois ;
  - `K` : capacité faisable par mois, saisie ;
  - `L = K / J` ; `M = I × L` ; `N = max(E / M ; 1)` ;
  - `O = K / J`, avec des icônes : rouge < 50 %, jaune de 50 à 90 %, vert ≥ 90 %.
  - Sur 12 mois, l'intervalle vaut 12, 6 ou 4 mois pour un risque faible, moyen ou élevé, soit 1, 2 ou 3 visites exigées.
  - Contrôle : `(E, F, G, K) = (9, 213, 2, 30)` donne H = 4,5, J = 47,33, O = 63 % et N = 7,1. En revanche `(12, 310, 2, 12)` donne N = 25,83 mois, soit plus que la durée de 12 mois, et **le classeur ne le signale pas**.

### Ce que MEMS fait aujourd'hui
- **Écran « Suivi de processus › Plan de suivi » (`#/processus/plan`)** :
  - import en deux temps, aperçu puis enregistrement, en .xlsx ou .xlsm ;
  - quatre vues : sites proposés classés, vue standard, déjà visités, carte ;
  - sélecteur d'exercice, compteurs Exigées / Faites / Prévues / Reste ;
  - pied de grille comparé à la cible J et à la capacité K ;
  - modification groupée avec récapitulatif, ajout de site complet, gabarit d'activité.
- **Export Locations fidèle** : formules B et E, validations, année en AL2. Un aller-retour sur 1 300 sites ne produit aucune erreur. L'identifiant `L###` est attribué par trigger, et les critères sont contrôlés aux échelles exactes en base (migration 045).
- **MMR** : `mmrMath.deriveMmr` reproduit au centième les lignes 4 à 7 du classeur.
- **Restes de l'ancien modèle** : l'écran RBM utilise encore les échelles 0/1/2 et ses boutons d'import renvoient 400 sur le V2. `DEFAULT_FREQUENCY` (1, 2 ou 3 mois) cohabite avec la règle MMR.

### Écarts vérifiés
| Comportement | Statut | Écart | Effort |
|---|---|---|---|
| rbm-1 · Import « Locations Management » comme référentiel | En place | Les lignes non vides sans nom sont sautées sans être comptées : le gabarit V2 renvoie « 0 lue » sans explication. Les anciens boutons « Master Data » et « Plan de suivi » renvoient 400 sur le V2 | S |
| rbm-2 · Identifiant `L###` stable | En place | L'import attribue les ID en JS (max + 1) : deux imports concurrents produisent un 409 global. Un ID de fichier inconnu peut renommer un site rapproché par code | S |
| rbm-3 · Sous-type POI en liste fermée, code dérivé côté serveur | Partiel | PATCH accepte du texte libre, la base ne contrôle que la longueur, le code POI n'est exposé par aucune API | S |
| rbm-4 · Bureau choisi parmi les bureaux déclarés | En place | Un Sub Office vide à l'import remet le bureau à NULL. Le contrôle ne vérifie pas que le bureau est actif | S |
| rbm-5 · Import de la hiérarchie des bureaux (Settings G:I) | Partiel | Bureaux et parents saisis à la main, Settings ignorée à l'import | M |
| rbm-6 · Admin 1–3, zone urbaine, GPS à 6 décimales | Partiel | Aucune emprise pays. Au-delà de 6 décimales, la valeur est arrondie sans avertissement. PATCH ne modifie ni l'admin, ni le GPS, ni la zone urbaine | S |
| rbm-7 · Statut mensuel Active/Inactive par exercice | Partiel | L'import est additif : vider un mois dans Excel n'efface pas le statut en base. Pas de grille 12 mois à 3 états. Démo : 0 statut saisi | M |
| rbm-8 · Status courant = dernier statut renseigné | Partiel | Un statut vide compte comme actif (démo : 1 280 « actifs » sans aucun statut saisi). Pas de filtre par statut | S |
| rbm-9 · Grille des mois pour planifier | Partiel | L'unicité porte sur une activité nullable : doublons possibles (5 sites, 108 visites sans activité). Les zones interdites restent planifiables. Décocher efface toutes les activités du mois | M |
| rbm-10 · Sélecteur d'exercice | En place | Années codées en dur (N+1 à N−2). Le KPI « alimentés » n'est pas borné à l'exercice | S |
| rbm-11 · Critères aux échelles exactes de Sheet4 | Partiel | Base et import conformes. L'ancien écran propose 0/1/2, sans 99 ni fraude 2, et omet 4 critères. L'ancien import borne les valeurs sans le dire. L'API accepte encore la valeur 2 | M |
| rbm-12 · Zone interdite (99) et restriction stricte (3) | Partiel | Exclues des KPI du plan, mais pas de la planification manuelle, de l'import, de la génération RBM ni du statut « à suivre ». 3 et 99 sont confondus dans le score | S |
| rbm-13 · Score de risque calculé côté serveur, règle visible et paramétrable | Partiel | Pondérations et seuils codés en dur et non affichés. Le commentaire « calculé par macro » est faux pour le V2 | M |
| rbm-14 · Priorité dérivée et filtrable | Partiel | Calculée sans l'intervalle MMR (« en retard » se réduit à « jamais visité »). Pas de filtre. Badge sans icône | S |
| rbm-15 · Dernière visite = max(historique, réalisées, données reçues) | Partiel | Les visites seulement planifiées comptent, même futures, ce qui fausse « Jamais visités » et le tri | S |
| rbm-16 · MMR ordonné par n° d'activité CSP | Partiel | Colonne A non stockée, donc tri alphabétique. Unicité sur le texte brut. Les 9 catégories ne sont pas semées | S |
| rbm-17 · Saisies MMR limitées à durée, risque et capacité | Partiel | Nombre de sites saisi au lieu d'être calculé. L'aide au calcul de capacité n'est pas présentée comme une extension MEMS | M |
| rbm-18 · Dérivés identiques aux formules | Partiel | L'intervalle est arrondi puis réutilisé : `(7, 1000, 3, 50)` donne J = 429,18 au lieu de 428,57. Même dérive dans le miroir `web/src/lib/mmr.js` | S |
| rbm-19 · Cas indéfinis affichés comme dans le classeur | Partiel | Une ligne sans risque ni durée est impossible (NOT NULL). L'écran affiche « — » au lieu de « - ». L n'est pas affiché | S |
| rbm-20 · Nombre de sites calculé, remplacement tracé | Partiel | Le comptage inclut les sites inactifs. Aucun drapeau « saisi ». Un vrai 0 en cache (F3) est traité comme manquant. F4 = 1 220 saisi n'est pas signalé | M |
| rbm-21 · Faisabilité colorée aux seuils 50 % et 90 % | Partiel | Le vert démarre à 100 % au lieu de 90 %. Le total n'a que 2 couleurs. Pas d'icône | S |
| rbm-22 · Alerte quand la capacité ne couvre pas la durée (N > E, K = 0) | Absent | Aucune alerte, ni sur l'écran ni dans le Centre d'alertes | S |
| rbm-23 · Conserver les catégories non paramétrées | Absent | Les lignes 8 à 10 du classeur sont écartées à l'import | S |
| rbm-24 · Aide contextuelle sur les formules | En place | Les info-bulles ne sont pas accessibles au clavier. Le libellé d'origine n'est pas repris | S |
| rbm-25 · Rapprochement des libellés bureau et catégorie | En place | Les rejets MMR n'indiquent pas le n° de ligne. Normalisations différentes entre le front et le serveur | S |
| rbm-26 · Visites exigées = exigence MMR | Partiel | Trois règles visibles en même temps (MMR, `DEFAULT_FREQUENCY` à 12/6/4 visites par an, texte de la page Couverture). K = 0 exempte un site sans le dire | M |
| rbm-27 · Compteurs Faites / Prévues / Reste | En place | Les visites exigées ne sont pas proratisées pour les mois inactifs ni les zones interdites | S |
| rbm-28 · Premier bandeau de KPI | Partiel | « Actifs » compte les statuts vides. « Alimentés » n'est pas borné à l'exercice. Les KPI ne suivent aucun filtre serveur | M |
| rbm-29 · Second bandeau (reste à faire, MMR) | Partiel | `mmrRate = min(Σ faites, Σ exigées) / Σ exigées` : un site sur-visité compense les autres. Les sites interdits et inactifs sont inclus | S |
| rbm-30 · Tableau des sites proposés, classé | En place | Hérite des défauts de rbm-14 et rbm-15 | S |
| rbm-31 · Planifier depuis les sites proposés | Partiel | Un mois inactif est écarté sans le dire. Les zones interdites ne sont pas bloquées. Pas de liste des refus | M |
| rbm-32 · Total mensuel comparé à la cible et à la capacité | Partiel | Juste par bureau × activité seulement si l'on filtre. Le dépassement de K n'est signalé que par la couleur. Logique web non testée | M |
| rbm-33 · Trois modes d'affichage | En place | Rien à signaler : quatre vues sont livrées | L |
| rbm-34 · Filtres combinables | Partiel | Pas de filtre par prestataire, activité, statut ni priorité. Les KPI ne sont pas recalculés sur la sélection | M |
| rbm-35 · Export Excel fidèle et réimportable | Partiel | Pas de feuille « Overreaching Parameters » (A..O, icônes en O). Grilles additives au réimport. Score figé | M |
| rbm-36 · Gabarit d'activité | En place | 200 lignes libres fixes | S |
| rbm-37 · Modification groupée | En place | Pas de simulation (dry-run) côté serveur, pas de test en base. Les zones interdites restent planifiables | M |
| rbm-38 · Ajouter un site | En place | L'ancien `POST /sites` (page Visites) fusionne sans prévenir et remet `fokontany` à NULL | M |
| rbm-39 · Activity Tag limité aux catégories MMR | Partiel | PATCH, POST et la modale de visite acceptent du texte libre. Aucune contrainte en base. Démo : 14 sites non paramétrés, dont « RRP » | S |
| rbm-40 · Sites inactifs exclus des exigences | Partiel | Le comptage MMR et Σ reste incluent les inactifs. L'import planifie des mois inactifs | M |
| rbm-41 · Carte détaillée sans clé d'API | En place | Pas de contours locaux en repli. L'ancienne carte `#/processus/carte` a des popups non échappées | M |
| rbm-42 · Panneau de couverture et de performance sur la carte | Absent | Ni population couverte, ni tonnage PDD, ni performance par activité | L |
| rbm-43 · Import avec revue et rapport par ligne | Partiel | Des codes en double dans le fichier provoquent un 409 global sans n° de ligne. Les lignes ignorées ne sont pas comptées. L'action par ligne n'est pas annoncée | S |
| rbm-44 · `.xlsm` accepté, sans macro ni lien externe | Partiel | Un vrai 0 en cache est lu comme manquant. Les imports « Master Data » et Planning n'acceptent que `.xlsx` | S |
| rbm-45 · Planification et statut sur plusieurs exercices | En place | Liste d'années fixe. « Jamais visités » faussé (rbm-15) | S |

---

## Domaine 2 — Formulaires XLSForm (Kobo/ODK)

### Ce que montrent les références
- **Cinq définitions :**
  - GD : bilingue, 379 champs, 136 listes, 2 868 choix ;
  - SMP : fichier `.xls` Excel 97-2003, syntaxe héritée `begin group` / `end repeat` / `select one yn`, sans `form_id`, `pulldata` ;
  - Résilience SAMS et SMP ménage : libellé FR vide pour 53 champs sur 87 et 133 sur 209 ;
  - MIARO : trilingue EN/FR/MG, 565 champs dont 191 calculés, 231 listes, 20 961 choix, libellés obtenus par VLOOKUP sur un classeur externe.
- Un **export de données SAMS** accompagne ces définitions : 189 soumissions, 942 colonnes, 4 feuilles de répétition.
- **Règles de score MIARO, à recalculer et non à reprendre :**
  - `score_Dk = Σ ratios applicables ÷ nb applicables × 100` ;
  - `site_score_w = round(Σ wk·sk ÷ Σ wk des domaines applicables)`, avec w = 14/6/10/14/10/6/12/22/6 pour D1 à D9 ;
  - classes : ≥ 80 « Bon », ≥ 60 « À surveiller », sinon « Critique » ; bandes A ≥ 85, B ≥ 70, C sinon.
- **Risque MIARO** : `critique = détournement + sécurité + paiement` et `autres = stock + SCOPE + retard + gouvernance`. Le site est signalé si critique ≥ 1 ou autres ≥ 2.
- **Stock** : `clôture = ouverture + reçu − endommagé − distribué` et `écart = solde fin − solde physique`. Exemple SAMS : 3,6 + 3,6 − 0 − 1 = 6,2, écart 5,2.
- **SMP** :
  - écart d'effectif `= 100 × (cahier − présence) ÷ cahier` ;
  - stock de riz : `Q1 + Q2 − Q3`, puis on retire pertes et retours, puis `diff = physique − théorique` ;
  - seuils de 5 % et 10 %, rendus inopérants par un arrondi à l'entier ;
  - période = mois du suivi + année scolaire (sept.–déc. sur la 1re année) ;
  - section 10 : suivi des recommandations, clé `ID05 & 2 & école & mois & reco_id`.
- **GD** : 1 à 5 problèmes par visite, filtrés selon le type de suivi (DM/AM ou WM). Un risque élevé impose un débriefing sous 24 h.
- **Codes spéciaux** : 9999 « Sans objet », 888 « Ne sait pas », 2 « Partiellement ».
- **Bogues des formulaires à ne pas reproduire :**
  - `ecart_stock = X − X` dans GD, toujours égal à 0 ;
  - `diffleg` sans les pertes dans SMP ;
  - guillemets typographiques `’0’` ;
  - `risk_delay = 1` quand il n'y a pas de délai ;
  - `count-selected` appliqué à un `select_one` ;
  - `r_nut_distconf = 1` en constante ;
  - libellés D8/D9 décalés ou en `#N/A`.

### Ce que MEMS fait aujourd'hui
- **Import de définition `.xlsx` et `.xls`** via un lecteur BIFF8 pur. L'insertion est découpée sous 60 000 paramètres, ce qui rend MIARO importable. Le réimport ne renvoie plus de 500 depuis la migration 047. Le code de fiche est le slug du titre quand `form_id` manque, et l'activité de la fiche se rattache au MMR.
- **Catalogue** : nom, type, libellé (une seule langue), groupe, liste, `relevant`, `required`.
- **Indicateurs** : `percent_yes`, `percent_value`, `mean`, `sum`, `count`, plus des champs calculés. Il manque `count-selected`, `selected()` et `regex`.
- **Détection automatique des dimensions** : GD 8/9, Résilience 7/9, SMP ménage 7/9, MIARO 3/9, SMP 0/9.

### Écarts vérifiés
| Comportement | Statut | Écart | Effort |
|---|---|---|---|
| xlsform-1 · Import des `.xls` (Excel 97-2003) | En place | `X-Filename` non transmis, sans effet puisque le format est détecté par la signature | M |
| xlsform-2 · Insertion des choix par lots (< 65 535 paramètres) | En place | Pas de test d'intégration à 21 000 choix. Les soumissions sont encore insérées ligne à ligne (xlsform-21) | S |
| xlsform-3 · Syntaxe héritée (`begin group`, `end repeat`, `select one yn`) | Absent | « begin » est importé comme un champ. `end repeat` ne referme pas le groupe, donc tous les champs suivants sont mal rattachés. Les listes sont perdues (SMP, GD, MIARO) | S |
| xlsform-4 · Code de fiche stable | Partiel | Sans `form_id` ni titre, le réimport crée un doublon. Impossible de cibler une fiche existante. Le slug n'est pas testé | S |
| xlsform-5 · Repli FR → EN → MG et stockage par langue | Partiel | Le repli se fait par colonne et non par cellule : des noms techniques s'affichent. Le malgache est ignoré | M |
| xlsform-6 · Cellules formule et erreurs Excel | Partiel | Un `#N/A` est stocké sous la forme « [object Object] ». Aucun avertissement possible | S |
| xlsform-7 · Toutes les colonnes XLSForm conservées | Partiel | `calculation`, `constraint`, `choice_filter`, `appearance`, `default`, `repeat_count`, `hint` perdus | M |
| xlsform-8 · Colonnes de filtre des choix | Absent | ADM1CODE…, CPList, Field_office, cisco et zap perdus. `external_choices` n'est pas lu. Pas d'unicité des choix | M |
| xlsform-9 · Libellés nettoyés (HTML, markdown) | Absent | Les `<span style…>`, `**` et `${champ}` s'affichent tels quels | S |
| xlsform-10 · Noms de champ en double signalés | Absent | Le second `Q3_2_1` est supprimé sans message, et le compteur affiché est faux | S |
| xlsform-11 · Méta-champs et données personnelles exclus | Partiel | `subscriberid`, `simserial` et `phonenumber` sont stockés. Les médias sont proposés comme indicateurs | S |
| xlsform-12 · Aperçu de validation avant import | Absent | Écriture immédiate, sans rapport (listes manquantes, groupes non refermés, médias requis) | M |
| xlsform-13 · Versions de définition, indicateurs orphelins | Absent | Le catalogue est supprimé puis recréé. Un indicateur dont le champ disparaît calcule sur une base de 0 | L |
| xlsform-14 · En-têtes d'export avec chemin de groupe | Partiel | CSV et XLSX gardent `Groupe/…/champ` : `VSLA_score` a une base de 0, alors que le chemin complet donne 42,1 | M |
| xlsform-15 · `select_multiple` sans collision | Partiel | « 2 6 » ≠ « 2 » donne 50 % au lieu de 100 %. L'aplatissement perd des colonnes homonymes | M |
| xlsform-16 · Feuilles de répétition rattachées | Absent | Les répétitions sont perdues quelle que soit la source | L |
| xlsform-17 · Période = date de collecte | Absent | La période vient de la date d'envoi. Non modifiable | S |
| xlsform-18 · Période SMP (mois + année scolaire) | Absent | Aucune règle d'année scolaire | S |
| xlsform-19 · Identifiant stable pour toutes les sources | Partiel | Préfixe « uuid: » conservé. CSV ou XLSX sans `_uuid` : identifiant NULL, d'où un doublon à chaque réimport | S |
| xlsform-20 · Refuser un XLSForm ou un `.xls` dans l'import de données | Absent | GD produit 512 « soumissions », MIARO 698. Un binaire OLE2 est lu comme un CSV, et rien ne permet de les supprimer | S |
| xlsform-21 · Soumissions insérées par lots | Absent | Une requête par soumission, jusqu'à 30 000 | S |
| xlsform-22 · Codes traduits en libellés selon la version | Partiel | Les agrégats serveur restent en codes (bureaux « 7 », « 6 », « 5 ») | M |
| xlsform-23 · Alias des dimensions complétés | Partiel | MIARO 3/9, SAMS 1/9. Les alias accentués ne sont jamais appliqués à l'import | S |
| xlsform-24 · Prestataire TPM distinct du partenaire de mise en œuvre | Absent | Une seule dimension « partenaire » | M |
| xlsform-25 · Niveaux administratifs corrects | Partiel | admin3 est libellé « District » alors que le RBM le lit comme pcode de commune | M |
| xlsform-26 · Correspondance des codes de bureau par fiche | Absent | Codes bruts mêlés aux noms dans les synthèses | M |
| xlsform-27 · Soumission rattachée à un site | Partiel | Rattachement à la commune seulement. Ni `site_id` ni écran de rapprochement | L |
| xlsform-28 · Localités et sites alimentés depuis les listes | Absent | Aucune synchronisation | L |
| xlsform-29 · Listes de choix générées depuis MEMS | Absent | Aucun export de la feuille `choices` | M |
| xlsform-30 · Noms d'agents normalisés | Absent | Les variantes (espace final) comptent comme des agents différents. Aucun lien avec les agents TPM | M |
| xlsform-31 · Activité et type de suivi par soumission | Partiel | Activité par fiche en place (473d7fa). Rien au niveau de la soumission | M |
| xlsform-32 · « Sans objet » et « Ne sait pas » hors dénominateur | Absent | 9999, 888 et 2 sont comptés comme « non » | S |
| xlsform-33 · Indicateurs pré-configurés depuis les questions oui/non | Absent | Création une par une | M |
| xlsform-34 · Score MIARO recalculé (module pur) | Absent | Le moteur n'a ni `count-selected`, ni `selected()`, ni `regex` | L |
| xlsform-35 · Drapeau de risque transmis au RBM | Absent | Les critères RBM restent saisis à la main | L |
| xlsform-36 · Règles défectueuses corrigées et documentées | Absent | Aucune trace | M |
| xlsform-37 · Résilience : « non applicable » ≠ 0 | Absent | `FFA_score = 0` pour 188 visites, `INS_score = 20` pour 189 : tous entrent dans les moyennes | M |
| xlsform-38 · Rapprochement des stocks côté serveur | Absent | Répétitions non importées | L |
| xlsform-39 · Écarts d'effectif et de présence | Partiel | Faisable en champ calculé, mais pas de modèle ni d'agrégat par site | M |
| xlsform-40 · Montants monétaires en entiers | Partiel | Calcul en virgule flottante | S |
| xlsform-41 · Indicateurs au niveau des répétitions | Absent | — | L |
| xlsform-42 · Score de diversité alimentaire | Absent | Ni `count-selected` ni répétition enfants | M |
| xlsform-43 · Part d'options cochées | Absent | Agrégation inexistante | S |
| xlsform-44 · Dimensions pondérées | Absent | Moyennes simples seulement | M |
| xlsform-45 · Registre des problèmes | Absent | — | L |
| xlsform-46 · Alerte d'escalade à 24 h | Absent | — | M |
| xlsform-47 · Recommandations SMP suivies d'une visite à l'autre | Absent | — | L |
| xlsform-48 · Note de conclusion GD | Partiel | Configurable à la main, sans vue par site | S |
| xlsform-49 · Contrôles qualité des données importées | Partiel | Exclusion manuelle seulement : GPS, codes 999, durée et hors période ne sont pas détectés | M |
| xlsform-50 · Recodage des oui/non saisis en texte | Partiel | Les paires se saisissent à la main, sans suggestion | S |
| xlsform-51 · Libellés multilingues dans l'interface | Absent | Une seule langue par libellé | M |
| xlsform-52 · Tests de non-régression sur les vrais formulaires | Partiel | Aucun cas réel couvert | M |

---

## Domaine 3 — Exports Kobo/Ona du suivi de processus (zip SPSS)

### Ce que montrent les références
- **Huit exports** : GD/PREVMA juin et août, MIARO, NutritionAIM juin et août, Résilience SAMS, SMP juin et août. Chaque zip contient `data.sav` et un fichier par répétition (jusqu'à 9, avec imbrication possible), de 21 à 1 290 cas et de 365 à 942 variables.
- **Format** :
  - fichiers système `$FL2`, compression bytecode, UTF-8 (ext. 20), noms longs (ext. 13) ;
  - étiquettes de chaînes longues en ext. 21, jusqu'à 17 466 fokontany ;
  - métadonnées préfixées « @ » : `@_uuid`, `@_index`, `@_parent_index`, `@_parent_table_name`, `@_submission_time` ;
  - `instanceID = "uuid:" + @_uuid`.
- **Rattachement des répétitions** : `enfant.@_parent_index = parent.@_index`. `@_parent_table_name` vaut « data » ou le nom d'un autre groupe (répétition imbriquée MIARO).
- **Dates SPSS** : secondes depuis le 14/10/1582, d'où `epoch_ms = (v − 12 219 379 200) × 1000`.
- **Exports cumulatifs** : juin est contenu dans août (GD 225 → 331, Nutrition 485 → 871, SMP 1 161 → 1 290), avec les mêmes `@_uuid`. D'un export à l'autre, une colonne GPS est renommée (`HHCoord@4a58` → `@ca6b`), l'ordre des colonnes change et une pièce jointe passe du nom de fichier à une URL.
- **Codage des bureaux incompatible** : le code `6` vaut Toliara dans la fiche Résilience et Ambovombe dans les autres fiches.
- **Scores des formulaires :**
  - GD : `Index = Eff + Qual + PAP + Risk`, chacun sur 25 ; `Eff = min(25, max(0, raw × 25/8))` ; `Qual = min(25, raw × 25/14)` ; `PAP = min(25, raw × 25/7)` ; `Risk = max(0, 25 + raw × 25/11)`. Le drapeau de risque est levé si et seulement si `Risk_raw < 0`. Classes < 50, 50–74,99, ≥ 75 (vérifié sur 331/331).
  - SMP : `P_HR = HR_train + HR_incent + HR_align` ; `DOC_score = num ÷ den × 100` ; niveaux < 60, 60–79, ≥ 80. La pondération de `PERF_OVERALL` ne se déduit pas des données.
  - NutritionAIM : `score_total` est la somme de 8 scores et monte jusqu'à 104, au-delà de 100.
  - Stock : `clôture = ouverture + reçu − endommagé − distribué` (470/470).
- **Délai de saisie** : le mois de la date d'enquête diffère du mois d'envoi pour 82 visites sur 225 en GD et 349 sur 485 en Nutrition (chargements en masse de dates 2024–2025).

### Ce que MEMS fait aujourd'hui
- `savParser` décode les 39 fichiers `.sav` exactement comme un lecteur indépendant. Le pipeline traite chaque export en 0,4 à 3,2 s.
- **Seul `data.sav` est lu.** `@_uuid` n'est pas reconnu : 100 % des lignes sont identifiées par une empreinte du contenu. Les dates ne sont pas converties, si bien que la période est vide (100 % en GD). Les étiquettes de chaînes sont ignorées. admin1 à 4 et site sont vides à 100 %. Les tableaux de bord affichent des codes.
- **Charge** : à 20 fois le volume SMP (25 800 cas), l'import prend 60 s et 1,97 Go. À 30 fois, le processus de l'API s'arrête faute de mémoire.

### Écarts vérifiés
| Comportement | Statut | Écart | Effort |
|---|---|---|---|
| kobo-pm-1 · Lire toutes les tables du zip | Partiel | `data.sav` seul : 2 652 à 8 815 lignes perdues par export, sans message | M |
| kobo-pm-2 · Répétitions liées à la soumission parente | Absent | Aucun modèle. L'API Kobo et le lien Ona perdent aussi les tableaux | L |
| kobo-pm-3 · Réimport idempotent des répétitions | Absent | — | M |
| kobo-pm-4 · Tables de répétition vides acceptées | Absent | Une table à 0 cas fait échouer l'import (400) | S |
| kobo-pm-5 · Dédoublonnage sur `@_uuid` | Absent | 100 % des soumissions SPSS sont hachées, sans avertissement | S |
| kobo-pm-6 · Pas de doublon au réimport d'un export cumulatif | Partiel | Réimport juin puis août : 53 doublons en GD, 152 en Nutrition, 12 en SMP | M |
| kobo-pm-7 · Dates SPSS converties | Absent | `13989110400` devient le 11/06/1970. Les formats d'impression sont ignorés | M |
| kobo-pm-8 · Période paramétrable, jamais vide | Partiel | Vide pour 100 % des exports SPSS, sauf la Résilience (datée par `end`) | M |
| kobo-pm-9 · Contrôle qualité des dates | Partiel | Dates de 2022 et chargements en masse non signalés | M |
| kobo-pm-10 · Étiquettes de chaînes (ext. 21) | Absent | Aucune étiquette de chaîne : pcodes, sites et types de suivi sans libellé. Les étiquettes de chaînes courtes sont lues comme des nombres | M |
| kobo-pm-11 · Libellés affichés, codes conservés | Partiel | Bureau, agent, partenaire et agrégats SQL restent en codes | L |
| kobo-pm-12 · `select_multiple` (chaîne et indicatrices) | Partiel | Les indicatrices `VAR.code` ne sont pas regroupées sous leur question | M |
| kobo-pm-13 · Versions de formulaire | Absent | Catalogue figé au premier import : les 60 variables ajoutées en août n'y entrent jamais | L |
| kobo-pm-14 · Indicateurs robustes aux renommages | Absent | `HHCoord@4a58` et `@ca6b` sont traités comme deux champs. Aucune alerte quand un champ disparaît | M |
| kobo-pm-15 · Mapping des dimensions par défaut | Partiel | admin1 à 4 et site vides à 100 %. Pas de repli de 999 vers la saisie « Autre » | S |
| kobo-pm-16 · Deux dimensions partenaire | Absent | Un test fige `partner = EnuPartner`, qui désigne en réalité le prestataire | M |
| kobo-pm-17 · Niveaux administratifs corrects | Partiel | Libellés décalés d'un niveau. Pas de niveau village | S |
| kobo-pm-18 · Pcodes suffixés et « Autres » | Absent | — | M |
| kobo-pm-19 · SMP rattaché par code école | Absent | — | L |
| kobo-pm-20 · Correspondance des bureaux par fiche | Absent | Le code « 6 » désigne deux bureaux selon la fiche, et les agrégats les additionnent | M |
| kobo-pm-21 · Codes de non-réponse exclus | Absent | 888, 9999 et 999 sont comptés comme « non » | M |
| kobo-pm-22 · Scores du formulaire exploités et recontrôlés | Partiel | Pas de type numérique, pas de répartition par classe, aucun recontrôle | L |
| kobo-pm-23 · Incohérences de score signalées | Absent | `score_total = 104` passe sans alerte | M |
| kobo-pm-24 · Rapprochement des stocks | Absent | — | M |
| kobo-pm-25 · Vue « Suivi de magasin » commune | Absent | — | M |
| kobo-pm-26 · Panier distribué comparé à la ration | Absent | — | L |
| kobo-pm-27 · FGD : participants et part de femmes | Absent | — | S |
| kobo-pm-28 · Indicateurs au niveau du répondant | Absent | — | L |
| kobo-pm-29 · Problèmes et plans d'action | Absent | — | L |
| kobo-pm-30 · Import hors requête, en flux, par lots | Absent | 3 s de blocage pour SMP. À 30 fois le volume, le processus API s'arrête | XL |
| kobo-pm-31 · Rapport d'import détaillé | Partiel | « inserted » compte aussi les mises à jour | M |
| kobo-pm-32 · Fichier déjà importé détecté | Absent | — | S |
| kobo-pm-33 · Textes tronqués à 255 octets signalés | Absent | 21 à 57 valeurs tronquées par fichier | S |
| kobo-pm-34 · Mojibake repéré et réparé | Absent | 103 cellules en SMP | M |
| kobo-pm-35 · Coordonnées GPS des visites | Absent | — | L |
| kobo-pm-36 · Pièces jointes | Absent | URL brute affichée. Le passage du nom de fichier à l'URL crée un doublon | S |
| kobo-pm-37 · Connecteur Ona v1 par identifiant de formulaire | Partiel | `/api/v1/data/<id>` est traité comme un fichier simple, sans incrémental | M |
| kobo-pm-38 · Couverture par module de suivi | Absent | — | L |
| kobo-pm-39 · Dimension « activité » | Partiel | Au niveau de la fiche seulement | M |
| kobo-pm-40 · Métadonnées d'audit conservées | Partiel | La mise à jour écrase les valeurs sans trace | M |
| kobo-pm-41 · Sélections depuis fichier cassées signalées | Absent | Agent vide pour les 156 visites Résilience | S |
| kobo-pm-42 · Libellés de questions nettoyés | Partiel | `${…}` et `jr:choice-name(…)` affichés bruts | S |
| kobo-pm-43 · Fiches en langues différentes | Partiel | Pas de libellé MEMS de remplacement | M |
| kobo-pm-44 · Historique des libellés par version | Absent | — | M |
| kobo-pm-45 · Changement de type entre versions | Partiel | Non détecté (`Adm4Code_MAM` passe du texte libre à une liste codée) | L |
| kobo-pm-46 · Catalogue par lots, référentiel géographique partagé | Partiel | Le découpage est en place (9ac50ea). Les 17 466 fokontany sont recopiés par fiche au lieu d'être reliés aux Localités | M |
| kobo-pm-47 · Soumissions supprimées côté source | Absent | — | M |
| kobo-pm-48 · Choix du fichier principal du zip | Partiel | Sans `data.sav`, une répétition est prise à sa place. Un zip sans nom de fichier n'est pas reconnu | S |
| kobo-pm-49 · Tenue à 10 fois les volumes actuels | Absent | Les tableaux de bord chargent tout le JSONB, soit environ 76 Mo par appel à ce volume | L |

---

## Domaine 4 — Distribution mensuelle SMP et enquête CP (gros volumes)

### Ce que montrent les références
- **Trois exports :**
  - rapport mensuel SMP v1 : 2 049 rapports, 7 fichiers `.sav` ;
  - rapport mensuel SMP v2 : 7 722 rapports, 8 fichiers dont les dattes ;
  - enquête CP de formation : 5 470 cas, 32 717 variables dont 32 504 indicatrices de producteurs, et 617 Mo décompressés pour un zip de 9,6 Mo.
- **Règles SMP vérifiées sur 100 % des lignes :**
  - `identifiant = "Rapport-" + école + "-" + mois + "-" + année`, qui sert de clé métier ;
  - `total{niveau}_{mesure} = filles + garçons` ;
  - `gr_total = élèves + enseignants + cuisiniers` ;
  - présences et repas sont comptés en personnes-jours : `présents ≤ inscrits × jours` ;
  - `stock_final = ouverture + reçu − distribué − perte − retour` ;
  - `reception_all = Σ reception_xN`, et la lettre de voiture est renseignée si et seulement si `reception_all > 0` ;
  - `solde = précédent + crédit − débit − perte − remise`.
- **Écarts dans les données :**
  - `débit = Σ coûts d'achat` ne se vérifie que pour 363 rapports sur 630 (v1) et 2 255 sur 3 955 (v2) ;
  - rapports école × mois en double : 64 groupes en v1, 204 en v2, et 29 rapports saisis dans les deux versions ;
  - stocks négatifs ;
  - valeurs aberrantes, par exemple 2 761 000 kg de dattes reçus.
- **Rations implicites** par repas : céréales 0,14 kg, légumineuses 0,03 kg, huile 0,01 kg.
- **Période** : `mois + année`. La saisie se fait surtout le mois suivant.
- **Réalisé de référence pour mars 2026**, dédoublonné : 1 011 écoles dont 541 validées par la CISCO, 372 310 inscrits, 6 021 671 repas, céréales reçues 313,3 t et distribuées 845,8 t, 545 écoles en argent pour un débit de 1 075 075 576 Ar.
- **Enquête CP :**
  - modules choisis par `which_form` : présence aux formations, vente, intrants, champ intégré, OPB, suivi de champ, visite de membre ;
  - `vente = quantité × prix` (798/798) ;
  - `membres OPB = hommes + femmes`, avec 4 incohérences sur 177 ;
  - unités hétérogènes (g, sachet, « Chasse »/« Chasser ») ;
  - noms et téléphones des producteurs présents dans les données.

### Ce que MEMS fait aujourd'hui
- **Durées d'import** : SMP v1 en 2 s, SMP v2 en 7,1 s de calcul qui bloque l'API, enquête CP arrêtée par manque de mémoire au bout de 36 s (2,55 Go).
- **Faisabilité démontrée** : un prototype de lecture en flux, avec une représentation creuse qui écarte les indicatrices à 0, traite les 6 fichiers CP en 111 s, 373 Mo de mémoire et 12,9 Mo de NDJSON.
- **Pertes** : 100 % des tonnages, stocks, contrôles qualité et achats sont perdus, car les répétitions sont ignorées. La période est vide et la commune est rangée en admin4.

### Écarts vérifiés
| Comportement | Statut | Écart | Effort |
|---|---|---|---|
| kobo-dist-1 · Importer toutes les tables du zip | Absent | Céréales, légumineuses, huile, dattes, achats et caisse sont perdus | L |
| kobo-dist-2 · Métadonnées « @_ » reconnues | Absent | Identifiant, date d'envoi, version et compte de saisie sont ignorés | S |
| kobo-dist-3 · Dates SPSS converties selon le format | Absent | `today = 14004662400` est enregistré au 12/06/1970 | S |
| kobo-dist-4 · Période = mois + année du rapport | Absent | Période vide pour 2 049 rapports sur 2 049 et 7 722 sur 7 722 | M |
| kobo-dist-5 · Dédoublonnage par la clé « identifiant » | Absent | Les rapports soumis plusieurs fois sont comptés dans le Réalisé | M |
| kobo-dist-6 · Étiquettes des chaînes (ext. 21) | Absent | 527 communes, 27 CISCO et les raisons d'écart restent sans libellé | M |
| kobo-dist-7 · Libellés décodés en UTF-8 | Absent | « NumÃ©ro lettre de voiture » enregistré dans le catalogue | S |
| kobo-dist-8 · Géographie SMP aux bons niveaux | Partiel | La commune est rangée en admin4. `dren` et `cisco` ne sont pas reconnus. Le RBM ne fait jamais le lien | M |
| kobo-dist-9 · École identifiée par son code officiel | Absent | Site vide pour 7 722 rapports. 687 libellés d'école sont partagés par plusieurs codes | L |
| kobo-dist-10 · Champs calculés typés en nombres | Partiel | Stockés en chaînes. `toNumber('1,234,567')` renvoie 1,234567 | S |
| kobo-dist-11 · Formules SMP recontrôlées (module pur) | Absent | — | M |
| kobo-dist-12 · Réalisé des cantines (mois × zone × école × denrée) | Absent | — | L |
| kobo-dist-13 · Réalisé des cantines relié au PDD | Absent | — | L |
| kobo-dist-14 · Caisse et achats locaux | Absent | — | L |
| kobo-dist-15 · Contrôles qualité et alertes | Absent | Valeurs négatives, stocks négatifs, jours incohérents et lettres de voiture factices non signalés | L |
| kobo-dist-16 · Rations paramétrables, besoin théorique comparé au distribué | Absent | — | M |
| kobo-dist-17 · Qualité des denrées, pertes, validation CISCO | Partiel | Le % de rapports validés est calculable. Pas de statut CISCO ni de filtre « validés uniquement » | M |
| kobo-dist-18 · Versions et formulaires regroupés en famille | Partiel | Catalogue figé. Les versions v1 et v2 n'ont aucun `uuid` commun | M |
| kobo-dist-19 · Libellés lisibles pour « Vavy: / Lahy: » | Absent | 54 champs d'effectifs illisibles | S |
| kobo-dist-20 · Photo du rapport papier | Absent | L'URL brute, qui porte l'hôte de fichiers du bailleur, est affichée et exportée | S |
| kobo-dist-21 · Représentation creuse des indicatrices | Absent | Enquête CP : environ 2,2 Go de JSONB pour `data.sav` | M |
| kobo-dist-22 · Lecture `.sav` en flux dans un worker | Absent | SMP v2 bloque 7,1 s. L'enquête CP fait tomber le processus | XL |
| kobo-dist-23 · Garde-fous mémoire avant décompression | Absent | Un zip de 9,6 Mo donne 216 Mo en mémoire, puis l'arrêt du processus | M |
| kobo-dist-24 · Envoi par morceaux, erreur 413 explicite | Absent | Un fichier trop gros renvoie 500 au lieu de 413 | M |
| kobo-dist-25 · Insertion par lots bornés | Partiel | Catalogue découpé (9ac50ea). Soumissions encore insérées ligne à ligne. Les indicatrices sont cataloguées | M |
| kobo-dist-26 · Identifiant stable, répétitions comprises | Partiel | Une soumission éditée crée une nouvelle ligne. CSV et liens sans identifiant | M |
| kobo-dist-27 · Enquête CP : chaque module vers ses indicateurs | Absent | — | M |
| kobo-dist-28 · Référentiel producteurs et OPB | Absent | Téléphones visibles par tout utilisateur connecté | L |
| kobo-dist-29 · Indicateurs des formations agricoles (CP) | Absent | — | L |
| kobo-dist-30 · Distribution d'intrants CP, unités normalisées | Absent | — | L |
| kobo-dist-31 · Ventes des producteurs reliées aux achats des cantines | Absent | — | L |
| kobo-dist-32 · Enquête CP rattachée aux partenaires et à la géographie | Partiel | `cp_name` n'est pas détecté. Un nom de district est rangé en admin3 | M |
| kobo-dist-33 · OPB, champs intégrés, visites de membres | Absent | — | L |
| kobo-dist-34 · Rapport d'import détaillé et journalisé | Partiel | Seuls `{received, inserted}` sont renvoyés | M |
| kobo-dist-35 · Durée de saisie et saisie différée | Absent | — | S |

---

## Domaine 5 — Contrat FLA, facture TPM, planning et budget de collecte

### Ce que montrent les références
- **Budget FLA** (`Contrat-budget-…-MDG-2025-AIN-MULTI-003-AM02-V1.xlsx`), 13 feuilles :
  - `poste = nb unités × coût unitaire` ; répartition en % sur les activités 1 à 7, `TOTAL % = 100 %` ; `montant par activité = poste × %` ;
  - total par section (`I = Σ lignes 15–23`, …), `total partiel I–IV`, `coûts directs = I + II + III + IV + V = 41 164 000` ;
  - **commission de 7 % des coûts directs, par activité** : 2 881 480 ; **total de l'accord = coûts directs + commission = 44 045 480**, jamais saisi ;
  - `durée = ROUND(DAYS360(début, fin) / 30 ; 1)` ; `taux par tonne = Σ coûts basés MT ÷ tonnes` ;
  - salaires : `coût mensuel × effectif × mois`, ventilés par activité, rattachés à une section par `SUMIF` sur la catégorie de dépense ;
  - budget narratif : `contribution bailleur = budget × % bailleur`, `contribution partenaire = budget − contribution bailleur` ;
  - consolidation : `budget « Suivi » chargé = Suivi + (commission + section V) × part du Suivi dans I–IV`, soit 44 045 480.
  - **Bogues du gabarit à ne pas reproduire :** `S9 = $E9*F9` (367 cellules), `Q6 = $E6*E6`, `T17 → AD66`, `J21 → S66`, activités 6 et 7 non reliées en sections III à V, commission codée en dur à 7 % sans lire F73.
- **Facture Lalana, gabarit de mai** : 9 factures chaînées, M1 à M9.
  - Colonnes `Budget | Tonnage | Taux | TOTAL du mois | Cumul | Restant`.
  - Section IV détaillée en **10 sous-postes**, pour un budget de 123 013 000.
  - Lignes de fin : `VI = Σ coûts directs`, `VII = 7 % × VI`, `TOTAL = VI + VII`, `à payer = TOTAL du mois − avance`, montant en toutes lettres.
  - Chaînage : `Cumul(n) = Cumul(n−1) + Mois(n)` et `Restant = Budget − Cumul`, affiché même s'il est négatif.
  - Mai 2026 : 5 625 200 de dépenses, commission 393 764,00, **à payer 6 018 964,00**.
- **État des dépenses** : `montant = quantité × coût` ; `part bailleur = montant × %` (100 %, 90 % ou 80 %) ; `part ONG = montant − part bailleur`. Le Total IV de l'état, 5 625 200, est égal au TOTAL IV de la facture.
- **Incohérences des sources à signaler, sans les reproduire :**
  - `775 200` est saisi alors que `174 × 5 100 = 887 400` ;
  - cumuls cassés de M5 à M9 : sur le PDF signé, coordinateur et location de salle sont à 0 alors que 1 000 000 et 1 050 000 ont été facturés ;
  - le total de l'état omet la section II ;
  - le carburant cumule 8 896 727 pour un budget de 5 733 000, soit un restant de −3 163 727.
- **Facture YPA sur plusieurs mois** (novembre 2025 à janvier 2026) :
  - 6 états par zone × mois, `Σ = 21 128 550` ;
  - commission 1 478 998,50 et TOTAL 22 607 548,50, avec centimes ;
  - **montant payable validé : 22 265 470**, soit 342 078,50 retenus à la revue ;
  - visas à plusieurs niveaux : préparé, certifié, « OK pour paiement », validé par le programme, reçu par la finance.
- **Planning AINA** :
  - 37 sites sur 6 dates, avec des rôles génériques Agent 1, 2 et 3 (18, 15 et 4 visites) ;
  - **jours-agent = dates distinctes par agent = 6 + 5 + 2 = 13**, et non le nombre de visites ;
  - budget `= jours × quantité × coût`, total 2 330 000 ;
  - coûts unitaires repris du FLA (60 000, 70 000, 10 000), sauf la location de moto à 100 000, qui n'existe pas dans le FLA.

### Ce que MEMS fait aujourd'hui
- **Contrat** :
  - `parseFlaBudget` est exact sur le FLA AINA : 15 postes IV.suivi, 41 164 000, soit 44 045 480 après ajout de 7 % ;
  - l'export Excel garde des formules vivantes ;
  - un avenant suit le même processus qu'un nouveau contrat.
- **Facture** :
  - état des dépenses avec `% bailleur` et deux activités ; le Réalisé est la part bailleur calculée côté serveur, en centimes ;
  - export Excel avec les onglets « Facture » et « État » ; impression en PDF ;
  - pré-remplissage depuis le plan de collecte.
- **Planning** : l'import crée les sites et les agents mais perd les dates de visite. Les jours de collecte sont comptés en nombre de visites.

### Écarts vérifiés
| Comportement | Statut | Écart | Effort |
|---|---|---|---|
| finance-1 · Import du FLA réel (postes de la section IV, commission) | En place | Aucun test sur le gabarit réel : il faut une copie anonymisée comme jeu de test | S |
| finance-2 · Sections II et III, dont les colonnes sont décalées | Absent | Les postes II et III sont perdus sans avertissement, car la lecture se fait toujours en colonnes A/B/C | M |
| finance-3 · Chaque bloc rattaché à la bonne ligne budgétaire | Partiel | « Mi-parcours » est classé en IV.evaluation et « non basées sur la MT » en MT. Le titre fusionné A18:B18 est classé en V.depenses au lieu de V.locaux | M |
| finance-4 · Répartition par activité (%) | Absent | Une répartition 30/70 est importée en 100/0. L'éditeur ne permet qu'une activité par poste | L |
| finance-5 · Contrôle par rapport aux totaux du classeur | Absent | Un poste perdu passe inaperçu : aucun écart n'est affiché | M |
| finance-6 · Recalcul, jamais de reprise des montants du gabarit | En place | Le reliquat d'arrondi par activité n'est pas réparti (un centime d'écart possible) | S |
| finance-7 · En-tête du contrat pré-rempli depuis « Budget de l'accord » | Absent | Partenaire, dates, nombre de mois, devise et libellés d'activité ne sont pas extraits | M |
| finance-8 · Durée DAYS360 ÷ 30, au dixième | Absent | Mois entiers seulement : le barème mensuel diverge quand le contrat commence en milieu de mois | M |
| finance-9 · Commission de 7 % calculée par activité | Partiel | Calcul global seulement. Un taux différent de 7 % passe sans alerte | S |
| finance-10 · Justification et unité de chaque poste | Absent | Ni stockées ni exportées | M |
| finance-11 · Contribution du partenaire et % bailleur au niveau du budget | Absent | Le « budget bailleur » est en réalité le budget total | M |
| finance-12 · Salaires importés depuis « Répartition du personnel » | Absent | Feuille ignorée | L |
| finance-13 · Export « Budget de l'accord » fidèle | Partiel | Une seule feuille (colonnes A à F) et une seule activité par poste. Pas de colonnes H à Y ni de feuilles Détails | L |
| finance-14 · Ratios par section et par ligne IV | Absent | — | S |
| finance-15 · Budget « Suivi » chargé (Suivi + (VI + V) × part) | Absent | Seul le budget direct de la ligne IV est disponible | M |
| finance-16 · Valeurs de transfert et taux par tonne | Absent | — | L |
| finance-17 · En-tête de facture complet et exact | Partiel | **Le numéro de facture sort vide** : l'export lit `reference` au lieu de `invoiceNo`, et un test fige ce bug. Manquent WBS, n° d'activité, facture finale et période « De … à ». L'avance reçue est confondue avec l'avance déduite | M |
| finance-18 · Tableau de facture à 6 colonnes de données | Partiel | 5 colonnes seulement, sans tonnage, sans taux et sans l'en-tête « mois : Mai » | M |
| finance-19 · Sections I à V toujours affichées, même à zéro | Absent | Les lignes à zéro sont masquées et les bandeaux de section manquent | M |
| finance-20 · Section I basée sur la MT : tonnage × taux | Absent | — | M |
| finance-21 · Facture au niveau du sous-poste | Absent | Agrégation par ligne seulement. Les identifiants des postes changent à chaque avenant (suppression puis réinsertion) | L |
| finance-22 · Poste de l'état rattaché à un sous-poste du budget | Absent | Impossible d'imputer « Location moto » sur « Location voiture » | M |
| finance-23 · Cumul chaîné juste, restant signé | Partiel | La facture courante est parfois exclue de son propre cumul. Démo : cumul de 1 420 000 contre 7 900 000 dans la consolidation | M |
| finance-24 · Alerte de dépassement par sous-poste | Partiel | Le dépassement n'est vu qu'au niveau du contrat ou de la section : le −3 163 727 du carburant reste invisible | M |
| finance-25 · Lignes de totaux identiques au gabarit | Partiel | VI, VII et TOTAL sont des valeurs figées calculées en virgule flottante. Pas de sous-total I–IV ni de ratio IV | M |
| finance-26 · Montant à payer en toutes lettres | Absent | — | M |
| finance-27 · Blocs de signature et visas | Partiel | Blocs vides alors que l'auteur et le validateur sont connus | M |
| finance-28 · Format à 2 décimales, zéro affiché « - » | Absent | 1 478 998,50 s'affiche 1 478 999 | S |
| finance-29 · Colonnes de l'état identiques au gabarit | Partiel | Ni montant bailleur et ONG par ligne, ni colonnes Activité 1 et 2 dans l'export | M |
| finance-30 · % bailleur respecté à l'impression et à l'export | Partiel | Une ligne à 90 %, ou même à 0 %, est imprimée à 100 % bailleur | S |
| finance-31 · Sous-totaux par rubrique | Partiel | Sous-totaux par section seulement | M |
| finance-32 · Montant saisi incohérent avec quantité × coût | Absent | 775 200 déclaré contre 887 400 calculé : rien n'est signalé | S |
| finance-33 · Import de l'état des dépenses réel | Absent | Une feuille « Postes » est exigée : les trois fichiers réels échouent (`NO_SHEET`) | L |
| finance-34 · Modèle de postes avec % bailleur et activités | Absent | L'aller-retour Excel perd le % (90 % devient « Bailleur ») | M |
| finance-35 · Facture sur plusieurs mois répartie sur ses mois | Partiel | Toute la facture est consolidée sur le premier mois. Pas de période « De … à » | L |
| finance-36 · Plusieurs factures pour le même mois | Absent | La contrainte d'unicité renvoie 409 (cas janvier 2026 : M4 et M5) | M |
| finance-37 · Plusieurs états par zone et par mois | Absent | — | L |
| finance-38 · Montant facturé distinct du montant payable validé | Absent | — | M |
| finance-39 · Dépense directe et montant à payer commission comprise | Partiel | La consolidation ne suit pas le montant payé commission comprise | M |
| finance-40 · Numérotation des factures | Absent | Texte libre, sans unicité | M |
| finance-41 · Terminologie paramétrable | Partiel | Nom du bailleur et destinataire « Unité Finance » codés en dur | S |
| finance-42 · N'imprimer que les sections utilisées | Partiel | Pas d'option « toutes les sections » | S |
| finance-43 · Date de visite lue dans les colonnes de dates du Planning | Absent | Les 6 dates sont perdues et une seule affectation est lue par ligne | M |
| finance-44 · Mois du planning déduit de ses dates | Absent | `?month=` obligatoire, aucun contrôle de période | S |
| finance-45 · Jours de collecte = dates distinctes par agent | Absent | 37 « jours » au lieu de 13 jours-agent. Un test fige la mauvaise règle | S |
| finance-46 · Budget à trois facteurs (jours × quantité × coût) | Partiel | Deux facteurs seulement | M |
| finance-47 · Budget planifié généré depuis le planning et le FLA | Absent | — | L |
| finance-48 · Contrôle des coûts unitaires et des postes hors FLA | Absent | Moto à 100 000 ou 150 000 et essence à 6 500 passent sans signalement | M |
| finance-49 · En-tête du fichier Planning contrôlé avant import | Absent | Importer un classeur de facture crée 27 sites parasites | S |
| finance-50 · Import du planning en écriture groupée | Absent | Une requête par site et par visite | S |
| finance-51 · Zones du planning et du budget rapprochées via le référentiel | Absent | TOLAGNARO / Toalagnaro et BETSOKA / Betroka ne sont pas reliés | M |
| finance-52 · Fichiers au XML non standard | Partiel | Lus correctement, mais sans test | S |
| finance-53 · Facture pré-remplie depuis le plan | Partiel | Le plan est choisi sans filtre de prestataire ni de statut | M |
| finance-54 · Import du budget d'un avenant | Partiel | Le code AMxx du fichier n'est pas comparé. Les `.xls` sont proposés alors qu'ils sont illisibles | S |
| finance-55 · Champs du contrat « N° d'activité » et « WBS » | Absent | — | S |

---

## Domaine 6 — Rapports et tableaux de bord

### Ce que montrent les références
- **`Couverture_par_partenaire.docx`** : 17 captures d'écran d'un ancien outil interne.
  - Complétude mensuelle : `sites distincts inspectés ÷ sites cibles × 100`, à 1 décimale.
  - Calendrier par site à 4 états : planifiée et faite, réalisée hors plan, visite avec alerte critique, aucune visite.
  - Tuiles : cibles, inspectés, `non inspectés = cibles − inspectés`, sites en alerte.
  - Alertes critiques par règle : rupture de repas, `Hygiène/FSQ < 50`, `Stock/Docs < 60`.
  - Matrice commune × mix de programmes.
  - Activation des sites : `actifs + inactifs = référentiel` (983 + 236 = 1 219).
  - État de synchronisation : `en attente = total source − total local`.
- **Rapport Janvier–Mai 2026 (HTML, 5 pages A4 paysage)** :
  - couverture = sites distincts visités ÷ sites actifs, arrondie à l'entier (753/1 278 → 59 % ; 103/208 → 50 % ; 20/162 → 12 % ; 129/1 457 → 9 %) ;
  - score d'une activité = moyenne des domaines, à poids égaux ;
  - moyenne d'un bureau = moyenne des domaines disponibles (Tuléar 93, Fort Dauphin 62) ;
  - indicateurs négatifs inversés (détournement, fraude, personnel armé) ;
  - base calculée sur les réponses applicables ; `n=` affiché sur chaque bloc ; petits effectifs signalés ;
  - lignes exclues de la notation mais comptées dans les visites ;
  - scores du formulaire recalculés, et l'écart est commenté (64 % contre 82 %) ;
  - recommandations classées par horizon.
- **Tableau de bord HTML** :
  - classes : `exc ≥ 80`, `sat ≥ 65`, `imp ≥ 50`, `urg` en dessous ;
  - `couverture = suivis ÷ actifs` ;
  - classes = répartition des **visites** ; `urgentPct = urg ÷ visites notées` ; `naPct = na ÷ visites` ;
  - indice = moyenne des scores par visite notée ;
  - verdict : « Critique » si couverture < 40 ou indice < 50, « Vigilance » si indice < 65 ou couverture < 65 ;
  - textes générés et pages par audience.
  - **Défaut à ne pas copier** : les indicateurs négatifs n'y sont pas inversés.

### Ce que MEMS fait aujourd'hui
- **Concepteur de rapport** : 5 modèles, période Du/Au, blocs (titres, KPI, tableaux, graphiques, encadrés, bulletin, sections répétées), finalisation figée. Exports en HTML autonome, en PDF par impression, en Excel côté serveur, et en Word (HTML servi sous l'extension .doc).
- **Tableau de bord « Couverture & performance »** : vue d'ensemble, salle de contrôle, carte, bulletin. Il existe aussi un récapitulatif de couverture et une synthèse du suivi de processus.

### Écarts vérifiés
| Comportement | Statut | Écart | Effort |
|---|---|---|---|
| reporting-1 · Une barre Période pilote tout le rapport | Partiel | Pas de T1 à T4 ni de mois isolé. Le bloc budget n'est pas borné à la période | M |
| reporting-2 · Deux formats de période et une date d'édition | Partiel | `{date_edition}` est au format ISO. Pas de forme courte « Janvier–Mai » | S |
| reporting-3 · A4 paysage, bandeaux d'en-tête et de pied en 3 zones | Partiel | L'en-tête et le pied sont une simple chaîne, sans logo. La pagination est perdue hors impression | M |
| reporting-4 · Bloc « Section de page » | Absent | — | M |
| reporting-5 · Marque neutre garantie dans tous les exports | Partiel | Les libellés importés ne sont pas contrôlés. Organisation et logo ne sont pas paramétrables | M |
| reporting-6 · Référentiel des activités | Partiel | Les catégories MMR sont rattachables depuis 473d7fa. Manquent code, libellés, couleur, icône et synonymes | L |
| reporting-7 · Couverture = sites distincts ÷ sites actifs de la période | Partiel | Le statut actif est ignoré et sites et communes sont mélangés. En pratique, la couverture est toujours nulle | L |
| reporting-8 · Visites, sites, visites notées, lignes exclues | Partiel | Ni visites notées ni lignes exclues. Une exclusion retire la ligne de tout | M |
| reporting-9 · Méthode de score explicite et paramétrable | Partiel | Seule la moyenne des indicateurs existe | M |
| reporting-10 · Sens des indicateurs respecté partout | Partiel | `direction` se perd dans `computeAll` : un indicateur « plus bas = mieux » est classé et moyenné à l'envers | S |
| reporting-11 · Seuils paramétrables et légende générée | Partiel | Seuils codés en dur et différents selon les écrans (90/50, 80/50, écart relatif à la cible) | M |
| reporting-12 · Base « n » affichée, petit échantillon signalé | Partiel | Pas d'étiquette `n=` ni d'alerte | S |
| reporting-13 · Réponses « non concerné » hors base | Partiel | « non concerné », « NA » et 99 sont comptés comme 0 | S |
| reporting-14 · Compteurs par activité | Partiel | Pas de carte avec couleur, unité et « sur N actifs » | M |
| reporting-15 · Boîtes de score | Partiel | Sans couleur de classe ni légende de méthode | S |
| reporting-16 · Synthèse par activité sur des familles de domaines | Partiel | Les colonnes ne s'alignent pas d'une activité à l'autre. Pas de constat éditable | L |
| reporting-17 · Priorités transversales | Partiel | Un seul encadré au lieu de 1 à 4 | S |
| reporting-18 · Bandeau d'activité | Absent | — | M |
| reporting-19 · Scores par domaine et par bureau | Partiel | La moyenne n'est pas celle des domaines disponibles. Domaines non ordonnés | M |
| reporting-20 · Codification des domaines (D1 à D7) | Absent | — | M |
| reporting-21 · Barres d'indicateurs par domaine | Partiel | Tableau seulement. Filtre par domaine non exposé. Sens de l'indicateur ignoré | M |
| reporting-22 · Encadrés à tonalité | Partiel | Pas de ton « note ». Variables limitées | S |
| reporting-23 · Texte généré puis éditable, lié aux chiffres | Partiel | Bulletin global seulement. « Régénérer » écrase le texte sans confirmation | M |
| reporting-24 · Bloc « Perception » | Partiel | Le % d'une modalité est disponible, mais pas la répartition ni le classement des bureaux | M |
| reporting-25 · Score par bureau et bureaux non couverts | Partiel | Pas de barres de score ni de liste des bureaux sans données | M |
| reporting-26 · Registre d'incidents | Absent | — | L |
| reporting-27 · Recommandations et plan d'action par horizon | Absent | — | L |
| reporting-28 · Note méthodologique générée | Absent | — | S |
| reporting-29 · Courbe de complétude multi-séries | Partiel | Les mois futurs sont tracés à 0. L'axe n'est pas fixé de 0 à 100 | S |
| reporting-30 · Matrice de complétude mensuelle | Partiel | Seuils 90/50. Un mois sans visite est rouge au lieu de gris | S |
| reporting-31 · Calendrier annuel par site | Partiel | États « hors plan » et « alerte » absents. Bloc absent du concepteur | M |
| reporting-32 · Tuiles du mois | Partiel | Manquent les non inspectés, le % restant et les sites en alerte | S |
| reporting-33 · Cartes de couverture des programmes | Partiel | Couverture calculée en visites et non en sites. Absentes du concepteur | S |
| reporting-34 · Règles d'alerte critique par site | Absent | — | XL |
| reporting-35 · Matrice commune × mix de programmes | Absent | — | M |
| reporting-36 · Annexe « Référentiel des sites » | Partiel | Tableaux plafonnés à 500 lignes pour environ 1 200 sites | S |
| reporting-37 · Couverture par partenaire et par prestataire TPM | Partiel | Calculée en visites. Aucun partenaire de mise en œuvre sur les sites | M |
| reporting-38 · Couverture par programme | Partiel | Sites actifs pris hors période, et nuls faute de rattachement | M |
| reporting-39 · Activation des sites par période | Partiel | Pas de KPI actifs ou inactifs | S |
| reporting-40 · Fraîcheur des données et état des sources | Absent | La date de synchronisation n'est jamais affichée | M |
| reporting-41 · Modèle « Vue d'ensemble » | Partiel | Pas de jauge face à la cible de 80 %, pas d'écart, pas de texte, et ce n'est pas un modèle du concepteur | L |
| reporting-42 · Bandeau « Décision » et flèche de tendance | Partiel | Couverture en visites, seuils figés, pas de flèche | S |
| reporting-43 · Répartition des visites par classe | Absent | Les « classes » comptent 12 indicateurs au lieu de 231 visites | L |
| reporting-44 · Radar des domaines | Absent | — | S |
| reporting-45 · Constats mis en avant | Partiel | Pas de trio bon, moyen et mauvais | S |
| reporting-46 · Tendance mensuelle de l'indice | Absent | Les tendances portent sur le nombre de soumissions | M |
| reporting-47 · Salle de contrôle des indicateurs | Partiel | Ni compteurs ni regroupement par domaine | S |
| reporting-48 · Carte des sites colorée par classe | Partiel | Colorée par risque et non par score. Non imprimable | M |
| reporting-49 · Classement des bureaux, noms résolus | Partiel | Codes « FO 1 » non résolus | M |
| reporting-50 · En-tête de performance (écart avec N-1) | Absent | — | S |
| reporting-51 · Panneaux par domaine | Partiel | Score du domaine sans ses indicateurs | S |
| reporting-52 · Liste « Qualité » triée | Partiel | Les données existent, mais aucun bloc ne les affiche | S |
| reporting-53 · Signaux de risque générés | Partiel | Aucune règle | S |
| reporting-54 · Qualité de saisie par agent | Absent | — | L |
| reporting-55 · Bulletin éditable par activité | Partiel | Un bulletin d'activité affiche les visites et constats de toutes les activités | M |
| reporting-56 · Modèles préconfigurés | Partiel | Le rapport de performances est en portrait et ne suit pas la structure de la référence. Pas de modèles par audience | L |
| reporting-57 · Section répétée adaptable par activité | Partiel | Mêmes blocs pour chaque activité. Les textes utilisent les variables globales | L |
| reporting-58 · Colonnes et contrôle du débordement de page | Absent | — | M |
| reporting-59 · Exports PDF, Word, Excel et HTML fidèles | Partiel | Le Word est un HTML en .doc. L'Excel n'indique ni période ni méthode et reste en français | L |
| reporting-60 · Rapport finalisé figé | Partiel | L'export Excel recalcule les données en direct, même pour un rapport finalisé | M |
| reporting-61 · Modèles gérés dans Paramètres | Partiel | Gestion dans le concepteur seulement, via `window.prompt`. Ni renommage ni modèle par défaut | M |
| reporting-62 · Génération rapide | Partiel | 5 requêtes par fiche et JSONB entier chargé en JS. Ni cache ni worker | L |
| reporting-63 · Garde-fous sur la qualité des données | Partiel | Lignes hors période et mois vides écartées sans le dire. Libellés techniques acceptés | M |
| reporting-64 · Catalogue de champs dynamiques | Partiel | Peu de variables. `{ind:CODE}` est impossible. L'en-tête ne remplace que `{periode}` | M |
| reporting-65 · Indicateurs clés de l'écran d'exemple | Partiel | Manquent l'exigence MMR, les bénéficiaires, les sites planifiés distincts, les alertes et les sites inactifs | M |
| reporting-66 · Couverture par bureau comptée en sites | Partiel | Planifiés et réalisés comptés en visites | S |
| reporting-67 · Planifié et réalisé par activité | Partiel | Comparaison mensuelle sans ventilation par activité | S |
| reporting-68 · Formats numériques | Partiel | Séparateurs incohérents, pourcentages à 1 décimale | S |
| reporting-69 · Contact et classification tirés des paramètres | Absent | — | S |
| reporting-70 · Annexes de distribution (argent et vivres) | Partiel | Seulement le PDD par mois | M |
| reporting-71 · Navigation dans l'export HTML | Partiel | Aucun lien ni ancre | S |
| reporting-72 · Refus des fichiers non tabulaires à l'import | Absent | Un HTML est accepté et produit 621 et 257 lignes parasites | S |
| reporting-73 · Palette et icônes communes | Partiel | La couleur d'une activité dépend de l'ordre des lignes | S |

---

## Domaine 7 — Plan de distribution d'urgence (PDD)

### Ce que montrent les références
- **Classeur `PDD_Urgence_Oct-Nov_04082025.xlsx`.** La chaîne de calcul va de la planification par commune (70 communes) à la table `Oct_Nov` (492 lignes, 47 colonnes), puis aux tableaux croisés (sécheresse, cyclone, version imprimable signée) et enfin à `TTD&BDD` (stock comparé au besoin).
- **Bénéficiaires :**
  - GD : `ménages × 5` ;
  - PrevMa enfants : `U2 = population × 6 %` ;
  - PrevMa femmes enceintes et allaitantes : `PLW = population × 5 %` ;
  - 11 communes ne sont pas ciblées en nutrition et apparaissent en lignes vides.
- **Tonnage = bénéficiaires × ration × jours.**
  - Rations en tonnes par personne et par jour : riz 0,0004 ; légumineuses 6e-05 ; huile 3,5e-05 en GD et 2e-05 pour les femmes enceintes et allaitantes ; CSB+ 0,0002 ; Plumpy Doz 5e-05.
  - Dattes : 8,16e-05 par distribution, sans multiplier par les jours et quelle que soit la modalité.
  - 15 jours en GD, 30 jours en nutrition.
- **Argent** : `ménages × 120 000 MGA`, converti en USD par `MGA ÷ 4 432`. Seules 6 lignes sont en transfert monétaire.
- **Totaux** : 13 235,427 t, 1 883 528,85 bénéficiaires et 317 895,85 USD. Un recalcul indépendant reproduit 100 % des valeurs, **sauf 89 cellules d'huile et de dattes vidées à la main en novembre** (+279,19 t et +45,79 t si on les recalcule).
- **`TTD&BDD`** : `écart = stock − besoin`, avec une observation « Tout sera consommé » ou « À voir d'autres plans » et une alerte quand l'écart est positif.
  - Stock 2 150,416 t, besoin 8 779,295 t, écart −6 628,879 t.
  - Deux lots de sorgho du même bailleur ont des dates limites différentes.
  - Le riz a une date limite de subvention au 13/10/2024, déjà dépassée.
  - Seul le besoin sécheresse en GD est confronté au stock.

### Ce que MEMS fait aujourd'hui
- **Module PDD (migration 035)** : vues Distributions, Synthèse et Pipeline, import de la feuille « PDD base », modèle d'import (tâche 1b).
- **Sur le fichier réel** :
  - l'import bloque l'API pendant **46 s** et perd la ligne 497 ;
  - la nutrition n'est pas distinguée de la GD, et 44 lignes sont importées à 0 ;
  - les « ménages » mélangent des ménages et des individus (365 968 contre 224 459,80 ménages GD).

### Écarts vérifiés
| Comportement | Statut | Écart | Effort |
|---|---|---|---|
| pdd-1 · Référentiel de rations paramétrable | Absent | Les tonnages sont lus dans le cache Excel et aucune ration n'est stockée | L |
| pdd-2 · Ration propre à chaque céréale de la GD | Absent | Le type de denrée n'est pas lu | M |
| pdd-3 · Planification par commune, importable et éditable | Absent | Feuille ignorée, aucun lien par pcode | L |
| pdd-4 · Ménages et bénéficiaires calculés côté serveur | Absent | Arrondis par ligne. Les individus nutrition sont stockés comme des ménages | M |
| pdd-5 · Tonnages calculés par un module pur testé | Absent | Copie des valeurs du cache | L |
| pdd-6 · Argent : valeur de transfert et taux paramétrés | Absent | MGA et taux 4 432 ignorés. La démo affiche 317 898 USD au lieu de 317 895,85 | M |
| pdd-7 · Corrections manuelles tracées | Absent | Les 89 cellules vidées passent sans aucune trace | M |
| pdd-8 · Ciblage nutrition sans lignes à zéro | Absent | 44 lignes à 0 importées | S |
| pdd-9 · Dupliquer un mois | Absent | — | S |
| pdd-10 · Listes de valeurs contrôlées | Partiel | Le modèle propose Vivres, Cash et Mixte alors que les données utilisent Inkind et CBT. Un mois inconnu est supprimé sans le dire. Une année absente devient l'année courante | M |
| pdd-11 · Toutes les colonnes réelles conservées | Partiel | Les colonnes D, E, F, H, I et d'autres sont perdues. La PrevMa est indiscernable de la GD | M |
| pdd-12 · Aléa tiré d'un champ structuré | Partiel | Déduit d'une expression régulière sur le libellé | S |
| pdd-13 · Import fiable, complet et non bloquant | Partiel | 46 s de blocage, perte de la dernière ligne, lignes ignorées non détaillées | M |
| pdd-14 · Import avec recalcul et aperçu | Absent | — | L |
| pdd-15 · Paramétrage importé depuis le même classeur | Absent | Rations, planification, stock et taux ignorés | L |
| pdd-16 · Stock par lot (denrée × bailleur × subvention × dates) | Absent | Un seul stock par mois et par denrée : les deux lots de sorgho ne peuvent pas être saisis | M |
| pdd-17 · Besoin comparé au stock lot par lot | Partiel | Comparaison par denrée seulement. Ni observation ni consommation des lots dans l'ordre de leurs dates limites | M |
| pdd-18 · Alertes sur les dates limites de subvention et de péremption | Absent | — | S |
| pdd-19 · Besoin filtrable sur toutes les activités | Partiel | Seul le mois est filtrable. Pas de besoins hors PDD. L'argent n'est pas dans le pipeline | M |
| pdd-20 · Libellés de denrées rapprochés | Partiel | « LNS - MQ » et « P Doz » ne sont pas reliés | M |
| pdd-21 · Pipeline monétaire par subvention | Absent | — | M |
| pdd-22 · Synthèses façon tableau croisé, avec filtres | Partiel | Agrégation en JS. Pas de hiérarchie Mois › Act › Sous-bureau. Pas de vues prédéfinies | L |
| pdd-23 · Version imprimable signée | Absent | — | M |
| pdd-24 · Circuit de validation du PDD | Absent | Le plan reste modifiable sans limite | L |
| pdd-25 · Ménages, individus et bénéficiaires uniques distingués | Absent | — | S |
| pdd-26 · Géographie rapprochée par pcode | Absent | 13 communes dont la région diffère ne sont pas signalées | M |
| pdd-27 · Correspondance des bureaux | Absent | « BT Manakara » et « Manakara » ne sont pas reliés | S |
| pdd-28 · Partenaires affectés après la planification | Absent | — | M |
| pdd-29 · Précision et arrondis explicites | Partiel | Les décimales sont perdues avant l'agrégation : 1 883 067 au lieu de 1 883 528,85 | S |
| pdd-30 · Colonnes dérivées OIL, CSB et LNS | Absent | Le doublement (× 2) n'est pas documenté | S |
| pdd-31 · Ration par jour ou par distribution, selon la modalité | Absent | — | S |
| pdd-32 · Contrôle de cohérence des rations | Absent | 6 incohérences du classeur passent sans signalement | S |
| pdd-33 · Contrôle de chaque ligne | Absent | Doublons acceptés, aucune contrainte d'unicité | M |
| pdd-34 · Aller-retour Excel du PDD | Absent | Seul un modèle vierge existe | L |
| pdd-35 · Modèle d'import aligné sur le format réel | Partiel | Vocabulaire et listes différents du réel. Colonnes utiles grisées | M |
| pdd-36 · En-tête de plan couvrant plusieurs périodes | Absent | Réimporter un mois du cyclone efface la sécheresse du même mois | M |
| pdd-37 · Filtres Excel enregistrés signalés | Partiel | Les lignes sont lues correctement, mais le filtre n'est pas signalé | S |
| pdd-38 · Erreurs Excel détectées à l'import | Absent | `#REF!` et `#N/A` deviennent 0 | S |

---

## Domaine 8 — Import multi-sources : état des lieux

### Ce que montrent les références et le code
- **13 voies d'import serveur**, chacune avec sa limite de taille (20 à 200 Mo) et son comportement :
  - suivi de processus (CSV, XLSX, .sav, .zip) ;
  - lien de données ;
  - définition XLSForm ;
  - Master Data RBM, plan RBM et référentiel Locations ;
  - planning ;
  - postes, budget FLA, PDD, MMR ;
  - découpage administratif.
- **Une seule voie a un aperçu réel** (Locations). Le PDD et le découpage remplacent des données sans aperçu.
- **Exports** : 8 côté serveur (budget, facture, modèles, MMR, Locations, localités, rapport) et 7 exports CSV côté navigateur, chacun écrit différemment.
- **Écran actuel** :
  - « Importer un fichier » ;
  - « Lien ONA / MoDA » (appelle l'ancienne route `url-pull`) ;
  - « API Kobo v2 ».
  - Le seul retour est un message « a/b soumission(s) importée(s) ». Pas d'aperçu, pas d'historique, pas de réimport complet.
- **Contrats externes**, établis à partir du code source de référence :
  - Ona open-data : `GET /api/v2/open-data/<uuid>/data`, pagination `page` et `page_size` (1 000 par défaut, 10 000 au maximum), `gt_id`, `count` ;
  - Kobo v2 : `start` et `limit` (100 par défaut, 1 000 au maximum), filtre `query` en JSON, export synchrone CSV ou XLSX (cache de 300 s, réponse 503 avec `Retry-After`).

### Écarts vérifiés
| Comportement | Statut | Écart | Effort |
|---|---|---|---|
| import-1 · Centre d'import unique et guidé | Absent | 13 routes dispersées, sans historique | L |
| import-2 · Dépôt de fichier unique, détection automatique | Partiel | Détection par le nom du fichier. Un `.zsav` est lu comme un CSV. Pas de glisser-déposer | M |
| import-3 · Champ « Coller un lien » qui reconnaît le type | Partiel | Le type reconnu n'est pas affiché. Le lien WDC n'est cité nulle part. Le jeton est toujours demandé. Deux panneaux séparés | S |
| import-4 · Écran branché sur `link-pull` | Partiel | L'écran appelle `url-pull`. Ni réimport complet, ni curseur, ni date de synchronisation | S |
| import-5 · Aperçu avant import pour toutes les voies | Partiel | Suivi, liens, PDD, RBM, planning et découpage écrivent sans aperçu | XL |
| import-6 · Rapport exact (nouvelles, mises à jour, inchangées) | Absent | Insertions et mises à jour confondues | S |
| import-7 · Journal des imports | Absent | — | L |
| import-8 · Annuler un import | Absent | — | M |
| import-9 · Lecteur CSV robuste | Partiel | Un champ sur plusieurs lignes crée une soumission fantôme. Les fichiers TSV et latin1 ne sont pas lus | M |
| import-10 · Toutes les feuilles d'un XLSX | Absent | Seule la première feuille est lue | M |
| import-11 · Nom de champ canonique quelle que soit la source | Partiel | Les clés diffèrent selon la source (zip, XLSX, CSV, Kobo, WDC). Collisions silencieuses | M |
| import-12 · `select_multiple` canonique | Absent | — | M |
| import-13 · Coordonnées GPS canoniques | Absent | `_geolocation` est supprimé | M |
| import-14 · Identifiant unifié entre sources | Partiel | Selon la source : `uuid`, `uuid:…`, `_id` ou empreinte | S |
| import-15 · Jamais d'identifiant externe vide | Partiel | CSV, XLSX et liens donnent NULL, d'où des doublons | S |
| import-16 · Période et date de collecte correctes | Absent | Dates SPSS illisibles. `05/03/2026` est lu comme le 3 mai. Colonne de période non choisissable | M |
| import-17 · Alias des formulaires réels, suggestion à l'aperçu | Partiel | `Adm*Name`, `Adm*Code_*` et `POIName` ne sont pas reconnus | M |
| import-18 · Import des répétitions | Absent | — | XL |
| import-19 · Gros fichiers lus en flux, hors requête | Absent | Le zip de l'enquête CP sature la mémoire et fait tomber l'API | XL |
| import-20 · Garde contre la décompression excessive | Absent | — | S |
| import-21 · Insertion par lots | Absent | 7 722 requêtes pour un seul fichier | M |
| import-22 · Traitement par worker avec progression | Absent | — | L |
| import-23 · XLSForm `.xls` accepté ou message clair | En place | Un `.xls` de données est encore lu comme un CSV | S |
| import-24 · Connecteur Kobo v2 complet et incrémental | Partiel | Tout est relu à chaque fois. Répétitions perdues. Le serveur européen n'est pas proposé | M |
| import-25 · Lien d'export synchrone Kobo | Partiel | Traité comme un fichier quelconque. 503 et `Retry-After` ne sont pas gérés | M |
| import-26 · Lien WDC / open-data fiabilisé | Partiel | Ni `?count` ni `/schema`. Échec probable quand le total est un multiple de 1 000 | M |
| import-27 · Limites du flux Tableau signalées à l'aperçu | Absent | — | S |
| import-28 · Incrémental et réconciliation complète | Partiel | Les modifications et suppressions faites à la source ne remontent jamais | M |
| import-29 · Bouton « Tester le lien » avec diagnostic | Partiel | Seule la dernière tentative est rapportée. Les codes HTTP restent bruts | M |
| import-30 · Prérequis réseau visibles | Partiel | La liste des hôtes autorisés n'apparaît pas dans Paramétrage. Aucune solution de repli proposée | S |
| import-31 · La page WDC n'est jamais exécutée | En place | L'aide à l'écran manque (voir import-3 et import-44) | S |
| import-32 · Rafraîchissement planifié | Absent | — | L |
| import-33 · Secrets chiffrés | Absent | — | M |
| import-34 · Plusieurs sources par fiche | Absent | — | L |
| import-35 · Un seul import à la fois par fiche | Absent | — | S |
| import-36 · Protection SSRF renforcée | Partiel | Les adresses `[::ffff:127.0.0.1]`, `[::ffff:169.254.169.254]` et `64:ff9b::…` sont acceptées. Une redirection DNS (rebinding) reste possible | M |
| import-37 · Lecture d'un lien hors requête | Absent | — | M |
| import-38 · Écriture page par page avec reprise | Absent | — | M |
| import-39 · Export complet des soumissions côté serveur | Partiel | « Exporter tout » ne contient que les 1 000 lignes chargées | L |
| import-40 · Export des résultats d'indicateurs | Partiel | Pas de tableau fiche × mois × bureau | M |
| import-41 · Lien de flux pour Excel et Power BI | Absent | — | L |
| import-42 · Menu « Télécharger » uniforme | Partiel | Code CSV dupliqué dans 7 pages, noms de fichiers hétérogènes | M |
| import-43 · Modèle téléchargeable pour chaque import | Partiel | Pas de modèle pour le suivi, le Master Data RBM ni le planning | M |
| import-44 · Aide contextuelle par connecteur | Partiel | Une seule phrase d'aide | S |
| import-45 · Contrôles qualité après import | Absent | — | M |
| import-46 · Confirmation des imports qui remplacent des données | Partiel | Le PDD remplace des mois sans prévenir | M |
| import-47 · Formats SPSS non couverts | Partiel | Le message ZSAV n'est jamais atteint. Les chaînes très longues (ext. 14) sont dégradées sans le dire | S |
| import-48 · Provenance précise en base | Partiel | Tout JSON lu par lien est étiqueté « kobo » | S |

---

## Lien Tableau Web Data Connector : faisabilité

**Réponse : oui.** MEMS peut lire ce lien, et la lecture est déjà codée (commit ecdbe2f, route `POST /api/monitoring/forms/:id/link-pull`). Elle n'est fiable en production qu'à **trois conditions** et après **cinq corrections**.

### Ce qu'est le lien
`https://<hôte MoDA>/tableau-web-data-connector/fb8e29158ebc45a9be122fa8caae6d0a` ne contient pas les données. C'est une page HTML et JavaScript (WDC 2.0) qui, une fois ouverte dans Tableau, appelle l'API JSON d'Ona (onadata) :
- `GET <api>/api/v2/open-data/<uuid>/schema` donne les tables : `data`, puis une table par répétition ;
- `GET <api>/api/v2/open-data/<uuid>/data?page=N&page_size=1000[&gt_id=<dernier _id>]` donne les lignes.

**L'uuid de 32 caractères sert de clé d'accès** : aucun jeton n'est demandé, et toute personne qui possède le lien lit les données. Un lien désactivé répond 404. Les soumissions supprimées sont exclues.

### Comment MEMS le lit
1. `classifyLink` reconnaît le motif et en extrait l'origine et l'uuid. Ce comportement est testé.
2. MEMS appelle d'abord l'API sur le même hôte, puis sur `api.<hôte>`. La route `/tableau-web-data-connector/` n'existe pas dans onadata : elle est servie par une application front séparée, donc l'hôte de l'API ne peut pas être déduit du code.
3. Il pagine par 1 000 lignes. Hors réimport complet, il reprend après le dernier `_id` connu (`gt_id`) et enregistre ce curseur.
4. **La page WDC n'est jamais exécutée.** MEMS ne dépend donc ni de WDC 2.0, remplacé par WDC 3.0 depuis Tableau 2022.3 et déprécié depuis 2023.1, ni de WDC 3.0, dont le dépôt `tableau/wdc3` annonce le retrait à la version 26.3.

### Conditions
| Condition | Pourquoi | Vérification |
|---|---|---|
| Le **serveur** MEMS joint l'hôte MoDA | L'hôte ne se résout pas publiquement : il faut le réseau interne ou un VPN. C'est le serveur qui lit, pas le navigateur, car CORS est limité à une liste blanche côté onadata | Depuis la machine de l'API (port 9000), appeler `/api/v2/open-data/<uuid>/data?count=1` sur les deux hôtes candidats. Depuis l'environnement d'audit, tous les hôtes Ona, MoDA et Kobo répondent 403 au niveau du proxy, donc **aucun test réel n'a été fait** |
| L'hôte est autorisé | S'il se résout en adresse privée, il faut l'ajouter à `DATA_SOURCE_ALLOWED_HOSTS`. Les sous-domaines sont couverts | `.env` |
| Le lien est actif et traité comme un secret | Il donne accès aux données. Il est aujourd'hui stocké en clair dans la fiche et visible par tous les utilisateurs du tenant | Masquer le lien pour les non-administrateurs (lot 4) |

### Corrections nécessaires avant usage
1. **Brancher l'écran sur `link-pull`**, afficher le type reconnu (« Lien Tableau Web Data Connector — uuid fb8e…6d0a »), le curseur et la date de synchronisation, et proposer « Actualiser » et « Réimport complet » (import-3, import-4).
2. **Appeler `?count=1` avant de paginer.** En v2, demander une page au-delà de la dernière lève une `EmptyPage` non interceptée, donc probablement une erreur 500. MEMS ne tolère que la 404, si bien que **l'import échouera entièrement dès que le total de lignes nouvelles est un multiple exact de 1 000** (import-26).
3. **Identifiant** : le flux n'a ni `_uuid` ni `_submission_time`. L'identifiant doit être `meta_instanceID` sans le préfixe « uuid: », et non `_id`, sinon la même soumission importée par zip et par lien est stockée deux fois. Une date de collecte (`end`, `SvyDate`, `today`) doit être exigée à l'aperçu (import-14, import-27).
4. **Noms canoniques** : les colonnes sont préfixées par les groupes joints par « _ ». Les `select_multiple` sont éclatés en colonnes `<groupes>_<liste>_<choix>` valant TRUE ou FALSE, et le GPS en 4 colonnes. **Les répétitions arrivent sous forme de tableaux, aujourd'hui supprimés par MEMS** (import-11 à 13, import-18).
5. **Robustesse et sécurité** : lecture hors requête avec reprise page par page, diagnostic « Tester le lien » qui nomme les deux hôtes essayés, protection SSRF renforcée pour l'IPv6 (import-29, import-36 à 38).

**Solution de repli** si l'hôte reste injoignable : déposer l'export zip SPSS ou XLSX téléchargé depuis MoDA. Il contient les mêmes données, avec `_uuid` et les répétitions dans des fichiers ou feuilles séparés. L'API Ona v1 avec jeton est une autre option (kobo-pm-37).

**Sources** : code onadata, branche `main` (`onadata/apps/api/viewsets/v2/tableau_viewset.py`, `open_data_viewset.py`, `onadata/libs/pagination.py`, `apps/api/urls/v1_urls.py` et `v2_urls.py`, `apps/api/permissions.py`, `libs/utils/common_tags.py`, `settings/common.py`, `docs/onadata-tableau.rst`) ; `github.com/tableau/wdc3` ; `help.tableau.com/current/pro/desktop/en-us/examples_web_data_connector.htm` ; code kpi de KoboToolbox (`kpi/paginators.py`, `kobo/settings/base.py`, `kpi/views/v2/asset_export_settings.py`).

---

## Import de données : la cible

### Un seul pipeline pour toutes les sources
**Réception → détection → lecture en flux → canonisation → aperçu → validation → écriture atomique par lots → rapport et journal.**

1. **Réception.** Dépôt unique (glisser-déposer) ou lien collé. Les gros fichiers sont envoyés par morceaux de 8 Mio avec reprise, et l'erreur 413 est explicite. Le fichier est stocké hors requête et identifié par son `sha256`, ce qui signale un fichier déjà importé.
2. **Détection** (`detectSource`, module pur).
   - Conteneur : xlsx, zip, sav, zsav, ole, texte.
   - Structure : XLSForm, export Ona `data`, zip SPSS, PDD, Locations, MMR, CSV de données.
   - Fiche probable : `form_id` ou motif du nom de fichier.
   - Garde de décompression : refus au-delà de 300 Mo décompressés ou d'un ratio de 100, **avant** la décompression.
3. **Lecture en flux.** `readSavCases` lit le dictionnaire puis les cas un à un. Les feuilles XLSX sont lues en flux. Le CSV suit la RFC 4180, détecte l'encodage (UTF-8, UTF-16, Windows-1252) et le séparateur (`,` `;` tabulation). Les indicatrices de `select_multiple` à 0 sont écartées (représentation creuse).
4. **Canonisation** (modules purs et testés).
   - `externalIdOf` : `_uuid`, `@_uuid`, `instanceID` sans « uuid: », sinon `ona:<hôte>:<_id>`, sinon une empreinte du contenu aux clés triées. L'identifiant devient obligatoire en base.
   - `parseCollectionDate` : dates SPSS selon leur format, séries Excel, ISO, `jj/mm/aaaa` explicite. Bornes 2000–2100.
   - `pickPeriod` : règle par fiche (date d'enquête, `today`, `start`, `end`, envoi), couple mois + année, année scolaire.
   - `canonicalKeys` : le nom XLSForm, quelle que soit la forme de la colonne (`a/b/c`, `a_b_c`, `@_x`, suffixe `@4a58`). Les collisions sont remontées.
   - Reconstitution des `select_multiple`, GPS canonique.
   - Dimensions alignées sur les Localités (Région, District, Commune, Fokontany, Village) et tables de correspondance par fiche (bureaux, activités, partenaires, agents, sites).
5. **Aperçu, sans écriture.** Mapping détecté et modifiable, colonnes inconnues, périodes, lignes sans période, répétitions, rejets motivés avec leur n° de ligne. Comptes nouvelles / mises à jour / inchangées calculés en SQL contre l'existant. Liste de ce qui sera remplacé (PDD, découpage).
6. **Écriture.** Un seul `withTenantTransaction`. Insertion par lots de 500 avec `ON CONFLICT … DO UPDATE … WHERE … IS DISTINCT FROM`. Les répétitions sont supprimées puis réinsérées par parent. Le curseur avance dans la même transaction. Un verrou consultatif par fiche empêche deux imports simultanés (409 « import en cours »).
7. **Rapport et journal (`import_runs`).** Le run est créé **avant** le travail, pour tracer aussi les échecs. On y trouve les compteurs, les contrôles qualité, l'URL sans jeton et les curseurs avant et après. Un import peut être annulé tant qu'aucun import ultérieur n'a touché ses lignes.

### Connecteurs
| Source | Aujourd'hui | Cible |
|---|---|---|
| CSV / TSV | Une seule ligne par enregistrement, UTF-8 seulement | RFC 4180, encodages, tabulation, neutralisation des formules à l'export |
| XLSX (export Ona/Kobo) | Première feuille, en-têtes avec chemin de groupe | Feuille `data` et feuilles de répétition (`_parent_index`), noms canoniques |
| XLS | Définition seulement | Données lues avec le lecteur BIFF8, ou refus avec un message clair |
| Zip SPSS | `data.sav` seul, en mémoire, dans la requête | Toutes les tables, en flux, dans un worker, avec ext. 21, formats de date et UTF-8 |
| ZSAV | Lu comme un CSV | Message explicite (signature `$FL3`) |
| XLSForm | Une langue, syntaxe moderne seulement | Syntaxe héritée, libellés multilingues, toutes les colonnes, versions, aperçu |
| Lien WDC / open-data | Codé, écran non branché | `?count`, `/schema`, incrémental, répétitions, test du lien |
| API Kobo v2 | Paginée, sans incrémental | `query _id > curseur`, choix du serveur, répétitions |
| Export synchrone Kobo | Fichier générique | Type reconnu, nouvel essai sur 503 / `Retry-After`, avertissement sur le cache de 5 min |
| Ona v1 (`/api/v1/data/<id>`) | Fichier simple | Pagination, jeton, incrémental |
| Sources planifiées | Aucune | Tâches BullMQ par source, secrets chiffrés (AES-256-GCM, clé dérivée par tenant), statut affiché. Sans Redis : planification désactivée avec un message |

### Gros volumes
- **Mesures réelles :**
  - le zip CP de 9,6 Mo contient 216 Mo de `data.sav` (5 470 cas × 36 127 emplacements) et fait tomber le processus après environ 36 à 38 s (2,5 Go) ;
  - SMP v2 bloque l'API 7,1 s ;
  - le PDD réel bloque l'API 46 s, parce que la feuille déclare 1 048 167 lignes.
- **Cible :**
  - aucun traitement de fichier dans le processus de l'API au-delà d'un seuil (`IMPORT_INLINE_MAX_MB` / `_ROWS`) ;
  - worker BullMQ `data-import` avec une limite mémoire explicite et une progression lisible par `GET /api/imports/:id` ;
  - plafond configurable (cas × variables) lu dans l'en-tête avant les données.
- **Repère** : le prototype en flux traite l'enquête CP en 111 s, 373 Mo et 12,9 Mo de données utiles.

### Groupes répétés
Quatre propositions de tables de répétition coexistent dans l'analyse. Il faut **un seul modèle** : `monitoring_submission_repeats`, avec les colonnes `tenant_id`, `form_id`, `submission_id` (supprimée en cascade), `table_name`, `parent_table`, `parent_repeat_id` (pour l'imbrication), `idx` et `data jsonb`. Unicité sur `(submission_id, table_name, idx)`, avec RLS.
- **Rattachement selon la source :**
  - SPSS : `@_parent_index → @_index` ;
  - XLSX : `_parent_index` ;
  - JSON Kobo : tableaux imbriqués ;
  - flux Tableau : `__parent_id`.
- Les orphelines sont comptées et les tables vides sont cataloguées.
- **Usages :** indicateurs au niveau de la répétition (calcul en deux temps, agrégés en SQL), stock (magasin, cantines), problèmes, recommandations, participants FGD, élèves et enseignants, intrants et ventes CP.

### Versions de formulaire
- `monitoring_form_versions` : version, signature `sha256` des triplets (nom, type, libellé), date d'import. Chaque soumission porte sa `form_version`.
- **Le catalogue est fusionné et non figé** : les nouvelles variables sont ajoutées par upsert, les codes de choix obsolètes sont conservés, et l'unicité porte sur `(form_id, list_name, value)`.
- `catalogDiff` liste les variables ajoutées ou retirées et les changements de libellé ou de type. Un type qui change (texte devenu liste) donne lieu à une **proposition de recodage**.
- Les indicateurs orphelins sont signalés dans la fiche et dans le Centre d'alertes. Les libellés sont stockés par langue (`labels {fr, en, mg}`) avec un repli cellule par cellule.

---

## Problèmes transverses

Depuis l'audit, cinq points ont **déjà été corrigés** : la limite de 65 535 paramètres pour le catalogue (9ac50ea), l'erreur 500 au réimport d'un XLSForm (migration 047), les XLSForm `.xls` (041742a, 473d7fa), l'activité de fiche réglable (473d7fa) et l'écran Plan de suivi (3b45556).

### Gravité haute
| Problème | Preuve | Effet | Lot |
|---|---|---|---|
| Un seul import peut arrêter l'API pour tous les tenants | `monitoring.routes.js` (corps de 80 Mo, `AdmZip.getData`, `parseSav` synchrone), `pddImport.js:50` | Zip CP : arrêt du processus. 30 fois le volume SMP : arrêt du processus. PDD : 46 s de blocage | 0, 5 |
| Validation des factures sans contrôle de rôle, sans machine d'états, sans séparation des tâches | `reports.routes.js:166-175`, `reports.repository.js:345-354` | Un utilisateur en lecture seule peut valider sa propre facture, ou un rapport « attendu » | 0 |
| Un rapport « attendu » rempli ne peut jamais être soumis | `reports.repository.js:291`, `ReportsPage.jsx:354` | La facture n'entre jamais dans la consolidation | 0 |
| Deux sources de vérité pour le Réalisé | `consolidation.repository.js:48-58` contre `reports.repository.js:172-181` | Même contrat et même prestataire : cumul de 1 420 000 dans la facture contre 7 900 000 dans la consolidation | 2 |
| Pertes de données silencieuses | `field.repository.js:62-63` (un PATCH partiel efface activité et fokontany), `BudgetItems.jsx:27-52` (répartition multi-activités écrasée), import PDD (dernière ligne), import Locations (une cellule vide efface la valeur), répétitions ignorées partout | Sites sortis du MMR, budgets faussés, tonnages perdus | 0, 2, 5, 8 |
| Sens des indicateurs perdu | `monitoringMath.computeAll`, `coverageDashboard.classify` | Un « détournement à 3 % » fait baisser le score du domaine | 1 |
| Niveaux administratifs décalés, codes de bureau mélangés entre fiches | `memsMapping.js:20-22` (admin3 = « District ») contre la jointure RBM sur le pcode de commune ; synthèse par bureau mêlant « 7 », « 6 » et des noms | Liaison RBM inopérante, agrégats par bureau faux | 1 |
| Détection des colonnes différente entre l'écran et l'import | `submissionsImport.js:22` (alias non normalisé) | L'écran annonce « Niveau régional » détecté, l'import laisse le champ vide | 1 |
| Un fichier non tabulaire est accepté comme CSV ; une date invalide provoque un 500 | `submissionsImport.js:128-146` et `:49`, `errors.js:35` (22007 non traduit) | Lignes parasites ingérables, import entier annulé | 0 |
| `pay_by` et `bailleur_pct` peuvent diverger | Migration 019, données de test | Une ligne affichée « ONG » est comptée côté bailleur | 0 |
| Agrégations faites en JS sur tout le JSONB, requêtes N+1 par fiche | `monitoring.repository.js` (rapports, synthèse, couverture, tableau de bord) | Ne tient pas 10 fois les volumes : environ 76 Mo par appel | 5 |

### Gravité moyenne
| Problème | Preuve | Effet | Lot |
|---|---|---|---|
| Écritures liées réparties sur deux transactions | `monitoring.routes.js:148-151` (soumissions puis catalogue), `dataLinks.service.js:128-130` (données puis curseur) | États partiels possibles | 1 |
| Concurrence | PDD : suppression puis insertion sans verrou ; Locations : identifiants calculés en JS ; imports de suivi concurrents | Doublons ou 409 global | 2, 6, 12 |
| Protection SSRF incomplète | `remoteFetch.js:30` (IPv6 mappée, préfixe `64:ff9b::`), `:54` (deux résolutions DNS distinctes) | Accès possible au réseau interne ou aux métadonnées cloud | 0 |
| Jeton JWT écrit dans les journaux | `app.js:38`, logger sans masquage | Sessions rejouables par quiconque lit les journaux | 0 |
| XSS stocké dans les popups de la carte | `SitesMapPage.jsx:89,109` | Exécution de code via un nom de site importé | 0 |
| Injection de formules dans 7 exports CSV | `DataList`, `ProcessMonitoringPage`, `IndicatorsList`, `PlanningPage`, `ReportsPage`, `ContractsListPage`, `ConsolidationPage` | Formules exécutées à l'ouverture dans Excel | 0 |
| Données personnelles exposées | `subscriberid`, `simserial`, `phonenumber` stockés ; téléphones des producteurs ; `requireAuth` seul sur les soumissions | Exposition à tous les rôles | 4 |
| URL de pièce jointe portant l'hôte du bailleur affichée et exportée | Tiroir de soumission, export CSV | Marque visible | 4 |
| Couches court-circuitées | Routes `monitoring`, `field`, `tpm`, `pdd`, `reports` qui appellent directement les repositories ; règles métier dans les repositories | Maintenance difficile, règles dupliquées | 3 |
| `INSERT` dans des boucles | Monitoring, `field` (sites, planning, génération RBM), `contracts.replaceBudget`, gabarits mensuels | Requêtes en N allers-retours, identifiants de postes instables | 5, 8 |
| Montants en virgule flottante hors des modules purs, centimes masqués | `facturePrint.js`, `factureXlsx.js`, `BudgetItems.jsx`, `format.js` | Montants imprimés faux | 2, 8 |
| Trois règles contradictoires de visites exigées | `rbmMath.js:11`, `field.repository.js:144-148`, `coverageRecap.js`, `planBoard.js:33` | Chiffres contradictoires d'un écran à l'autre | 2 |
| Seuils de couleur différents selon les écrans | `ReportBlocks.jsx:37`, `DashboardCoveragePage`, `coverageDashboard.js`, `PlanBoardPage`, `MmrSection` | Un même pourcentage change de couleur | 7, 9 |
| Unicité calculée sur des colonnes nullables | Visites (`activity`), `external_id`, choix sans unicité | Doublons | 1, 2 |
| `err.status` testé au lieu de `statusCode` ; 413 renvoyé en 500 | `monitoring.routes.js:144`, `dataLinks.service.js:123`, `errors.js` | Messages d'erreur faux | 0 |
| Grille de données plafonnée à 1 000 lignes sans avertissement | `ProcessMonitoringPage.jsx:399` | Filtres, compteurs et export faux | 6 |
| Concepteur de rapport | Export Excel recalculé même finalisé, budget non borné à la période, variables globales dans les sections répétées | Rapport figé incohérent | 9 |
| Le PDD n'utilise pas les référentiels existants | Migration 035 (zones, bureaux, partenaires en texte libre), taux de change non utilisés | Doublons de référentiels | 12 |

### Gravité basse
| Problème | Preuve | Lot |
|---|---|---|
| Sous-requêtes sans filtre `tenant_id`, protégées par la RLS seule (non conforme à la règle 3) | `reports.repository.js:178, 202-205`, `consolidation.repository.js:32-36` | 4 |
| i18n : messages serveur, exports et formats numériques en français seulement ; libellés français utilisés comme clés de tri | `field.routes.js`, `factureXlsx.js`, `PddPage.jsx:29-31`, `planBoard.js:40` | 11 |
| Statuts affichés en couleur seule, sans icône | `MmrSection.jsx:334,359`, `RbmPage.jsx:133,149`, `PddPage.jsx:37,570` | 7, 12 |
| Tests qui figent un bug ou n'utilisent que des données synthétiques | `factureInvoice.test.js:15`, `fieldMath.test.js:35`, `memsMapping.test.js:11`, tests SPSS sans `@_uuid` ni dates | 3 |
| Comptes renvoyés en chaînes par l'API | `dataCount`, `dataVisitCount` | 3 |
| Tuiles cartographiques publiques sans solution de repli | `SitesMapPage.jsx:68` | 7 |
| CLAUDE.md surestime la couverture du parseur `.sav` (ext. 21, `@_uuid`) | CLAUDE.md, section « Suivi de processus » | 3 |
| Code mort : `api.linkPull` jamais appelé, alias de routes | `client.js:259`, `monitoring.routes.js:172-185` | 6 |

---

## Feuille de route

**Règle de conduite.** Chaque tâche est consignée dans `docs/JOURNAL.md` avec l'heure UTC, son statut (à faire, en cours, fait, bloqué, en pause), le commit et le résultat des vérifications. Le tableau « État courant » est tenu à jour, et le journal est commité et poussé **à chaque mise à jour**. Aucune contrainte n'est affaiblie pour faire passer un test. Chaque migration nouvelle prend le numéro suivant (047 est déjà utilisé).

Les lots 0 à 2 portent sur la fiabilité, le lot 3 sur la maintenabilité, le lot 4 sur l'isolation multi-tenant et le lot 5 sur la performance. Les lots 6 à 13 livrent vos tâches, chacun en s'appuyant sur ces fondations.

| Lot | Axe | Tâches servies | Effort | Prérequis |
|---|---|---|---|---|
| 0. Mise en sûreté | Fiabilité | Import, facture, 7, 1b | L | — |
| 1. Données de suivi exactes | Fiabilité | Import, 6, 7 | XL | 0 |
| 2. Règles métier uniques et justes | Fiabilité | 2, 7, facture | L | 0 |
| 3. Couches, modules purs, tests sur fichiers réels | Maintenabilité | Toutes | L | 0 (en parallèle de 1–2) |
| 4. Isolation et données sensibles | Multi-tenant | Import, 6, enquête CP | M–L | 3 |
| 5. Volumes et répétitions | Performance | Import | XL | 1, 3 |
| 6. Centre d'import et connecteurs (dont WDC) | Fonctionnel | Import, WDC | XL | 1, 5 |
| 7. Plan de suivi type Excel et écran MMR | Fonctionnel | 2, 7 | L | 2 |
| 8. Facture fidèle et chaîne FLA → plan → facture | Fonctionnel | Facture | XL | 2, 3 |
| 9. Concepteur de rapport professionnel | Fonctionnel | 6 | XL | 1, 2 |
| 10. Localités : CRUD, pays, découpage | Fonctionnel | 3 | M–L | 0 |
| 11. i18n FR/EN réel | Transverse | 4 | M | 3 |
| 12. PDD v2 | Fonctionnel | 1b et suite | XL | 0, 3 |
| 13. Indicateurs métier avancés | Fonctionnel | 6, import | XL | 5 |

### R0 — Mise en sûreté (fiabilité, effort L)
**Contenu**
- **Imports :**
  - refus des fichiers non tabulaires (HTML, docx, PDF, OLE, `$FL3`) et des XLSForm déposés dans l'import de données (reporting-72, xlsform-20, import-2, import-47) ;
  - garde de décompression (import-20, kobo-dist-23) ;
  - 413 et 22007 traduits en messages clairs ;
  - correction `err.status` → `statusCode` ;
  - validation des dates en entrée avec le n° de ligne.
- **PDD :** lignes bornées par la plage du tableau structuré, `columnCount` calculé une seule fois, lignes ignorées détaillées, erreurs Excel détectées (pdd-13, pdd-38, et pdd-10 pour le mois inconnu).
- **Sites :** un PATCH partiel ne doit plus effacer de colonne ; plus de fusion silencieuse dans `POST /sites` (rbm-38, problème transverse).
- **Factures :**
  - contrôle de rôle, transitions autorisées et séparation des tâches (soumetteur ≠ validateur) ;
  - action « Soumettre » pour un rapport « attendu » ;
  - numéro de facture lu dans `invoiceNo` (finance-17) ;
  - impression respectant le % bailleur, calculée en centimes (finance-30) ;
  - contrainte liant `pay_by` et `bailleur_pct`, avec reprise des données existantes.
- **Sécurité :** IPv6 et rebinding dans `isPrivateIp` et `safeFetch` (import-36) ; masquage `Authorization` dans pino ; échappement des popups de la carte ; neutralisation des formules dans les CSV.

**Critères d'acceptation**
- [ ] Importer un `.html`, un `.docx`, un `.xls` de données ou un `.zsav` renvoie 400 avec le format nommé, et aucune ligne n'est écrite (tests).
- [ ] Le zip CP est refusé **avant** décompression, avec un message qui cite la taille, et l'API reste disponible.
- [ ] Une date « 30/01/2026 » mal placée renvoie 400 avec le n° de ligne. Aucun 500 n'est possible sur un import.
- [ ] Le PDD réel s'importe en moins de 2 s, avec 492 lignes dont la ligne 497 (Mars, PBW, Antokonala). Les lignes ignorées sont listées avec leur motif.
- [ ] Un `PATCH {riskLevel}` conserve `activity` et `fokontany` (test d'intégration).
- [ ] Un utilisateur en lecture seule reçoit 403 lorsqu'il tente une validation. Valider sa propre facture renvoie 403. Le passage « attendu → validé » est refusé.
- [ ] La cellule B4 de `facture.xlsx` contient le numéro de facture. Une ligne à 90 % s'imprime à 90 % côté bailleur et 10 % côté ONG.
- [ ] `isPrivateIp('::ffff:7f00:1')`, `('::ffff:a9fe:a9fe')` et `('64:ff9b::7f00:1')` renvoient vrai. Aucun en-tête `Authorization` n'apparaît dans les journaux. Une cellule « =1+1 » exportée commence par une apostrophe.

### R1 — Données de suivi exactes (fiabilité, effort XL)
**Contenu**
- **Identité :** identifiant canonique et obligatoire (kobo-pm-5, import-14, import-15, xlsform-19, kobo-dist-2).
- **Dates et périodes :** dates SPSS et formats (kobo-pm-7, kobo-dist-3, import-16) ; période paramétrable (kobo-pm-8, xlsform-17, xlsform-18, kobo-dist-4).
- **Libellés :** ext. 21 et libellés en UTF-8 (kobo-pm-10, kobo-dist-6, kobo-dist-7).
- **Noms :** noms canoniques, `select_multiple` et GPS (import-11 à 13, xlsform-14, xlsform-15).
- **Dimensions :** niveaux administratifs réalignés, avec migration des données existantes (xlsform-25, kobo-pm-17, kobo-dist-8) ; alias normalisés et complétés (xlsform-23, kobo-pm-15, import-17).
- **XLSForm :** syntaxe héritée, repli de langue, `#N/A`, doublons (xlsform-3, 5, 6, 10).
- **Indicateurs :** sens propagé (reporting-10) ; non-réponses exclues (xlsform-32, kobo-pm-21, reporting-13).
- **Lecture :** CSV RFC 4180 (import-9).
- **Transactions :** soumissions et catalogue écrits dans une seule transaction, curseur avancé dans la même transaction que les données.

**Critères d'acceptation**
- [ ] Sur les 10 zips réels, `external_id = @_uuid` pour 100 % des lignes.
- [ ] La période est renseignée pour toute ligne qui porte une date d'enquête (GD : 225/225 puis 331/331). Plus aucune date en 1970.
- [ ] Réimporter juin puis août crée **0 doublon** (GD 331, Nutrition 871, SMP 1 290 lignes au total).
- [ ] Export SAMS XLSX : le bureau est détecté sur 189 lignes sur 189, et un indicateur défini sur `VSLA_score` donne une moyenne de 42,1.
- [ ] Un indicateur « plus bas = mieux » à 3 % est orienté à 97 dans les domaines et dans l'indice. `isYes('9999')` et `isYes('888')` renvoient `null`.
- [ ] XLSForm SMP : `section_10` est un groupe, aucun champ n'a le type « begin », et les champs qui suivent `end repeat` sont dans le bon groupe. MIARO : aucun libellé « [object Object] ».
- [ ] Un CSV dont un champ entre guillemets tient sur 2 lignes donne 2 soumissions. Un CSV Windows-1252 conserve « région ».

### R2 — Règles métier uniques et justes (fiabilité, effort L)
**Contenu**
- **RBM et MMR :**
  - une seule règle pour les visites exigées, `DEFAULT_FREQUENCY` étant déprécié (rbm-26) ;
  - dérivés calculés sans arrondi intermédiaire, et suppression du miroir web (rbm-18) ;
  - seuils de faisabilité 50/90 avec icône (rbm-21) ;
  - site actif seulement si son statut vaut « Active » (rbm-8) ;
  - dernière visite fondée sur les visites réalisées (rbm-15) ;
  - prédicat `isPlannable` pour les zones interdites et les mois inactifs (rbm-12) ;
  - taux MMR = somme des minimums par site (rbm-29) ;
  - unicité `NULLS NOT DISTINCT` sur les visites, après dédoublonnage (rbm-9) ;
  - un vrai 0 en cache reste un 0 (rbm-44).
- **Finance :**
  - source unique du Réalisé (problème transverse) ;
  - cumul chaîné qui inclut la facture courante (finance-23) ;
  - jours-agent = dates distinctes (finance-45) ;
  - totaux de facture calculés en centimes (finance-25).

**Critères d'acceptation**
- [ ] `deriveMmr(7, 1000, 3, 50).J = 428,57` et `deriveMmr(10, 100, 3).J = 30`. Les lignes 4 à 7 du classeur sont toujours reproduites.
- [ ] Une recherche de `DEFAULT_FREQUENCY` ne trouve aucun usage. RBM, génération, page Visites et Couverture renvoient les mêmes visites exigées pour un même site.
- [ ] Démo : « Actifs » = nombre de sites au statut « Active ». Un site seulement planifié reste « jamais visité ».
- [ ] La ligne 6 du MMR (`N = 25,83 > 12`) est signalée. La faisabilité est verte à partir de 90 %, avec une icône.
- [ ] Planning AINA : 6, 5 et 2 jours, soit 13 jours-agent.
- [ ] Pour le contrat CTR-2026-0001 et le prestataire RANO, le cumul de la facture est égal au Réalisé de la consolidation.
- [ ] Facture de mai recalculée : commission 393 764,00 et montant à payer 6 018 964,00.

### R3 — Couches, modules purs, tests sur fichiers réels (maintenabilité, effort L)
**Contenu**
- Ajout des couches service et contrôleur pour `monitoring`, `field`, `pdd`, `reports`, `tpm/reports`, `postes` et `planning`.
- Règles métier sorties des repositories vers des modules purs : `assertOffice`, `canonicalActivity`, application des surcharges, pipeline PDD.
- Une seule fonction de normalisation des libellés, partagée par le serveur et le front (rbm-25).
- Jeux de test **réels et anonymisés** :
  - FLA AINA, état de mai, planning AINA ;
  - extrait du PDD, Locations V2 ;
  - extraits `.sav` (ext. 21, formats de date, `@_uuid`) ;
  - XLSForm SMP `.xls` ;
  - export SAMS XLSX.
- Correction des tests qui figent des bugs. Ajout de tests d'intégration sur une base de test : double import de définition, 21 000 choix, PATCH partiel, imports concurrents.
- Mise à jour de CLAUDE.md, et typage des comptes renvoyés par l'API.

**Critères d'acceptation**
- [ ] Aucun fichier `*.routes.js` des modules cités n'importe un repository (vérification par recherche ou règle de lint).
- [ ] `npm test` inclut au moins 8 jeux de test réels. `npm run lint` est propre.
- [ ] `web/src/lib/mmr.js` est supprimé : les dérivés MMR sont renvoyés par l'API.
- [ ] `factureInvoice.test.js` vérifie le numéro de facture en B4, `fieldMath.test.js` les jours-agent, `memsMapping.test.js` que admin3 correspond à « Commune ».

### R4 — Isolation multi-tenant et données sensibles (effort M–L)
**Contenu**
- Filtre `tenant_id` explicite dans toutes les sous-requêtes signalées.
- Retrait de `subscriberid`, `simserial` et `phonenumber` à l'import (xlsform-11).
- Téléphones des producteurs et noms d'agents masqués selon le rôle (kobo-dist-28).
- Lien WDC et URL de source masqués pour les non-administrateurs. Pièces jointes rendues sous forme de lien neutre (kobo-dist-20, kobo-pm-36).
- `brandGuard` sur les imports et les rendus de rapport (reporting-5).
- Socle des secrets chiffrés (import-33) et des jetons de flux, avec un tenant toujours résolu depuis le hash du jeton et jamais depuis l'URL (import-41).

**Critères d'acceptation**
- [ ] Un test RLS montre qu'une requête exécutée sans contexte tenant ne renvoie aucune ligne. La revue ne trouve plus aucune sous-requête sans filtre `tenant_id`.
- [ ] Après import du XLSForm SMP et de ses données, `subscriberid` est absent du JSONB.
- [ ] Un utilisateur en lecture seule ne voit aucun numéro `HHHSvyNumb*` (test d'API).
- [ ] L'API ne renvoie jamais un jeton, seulement `hasSecret` et les 4 derniers caractères.
- [ ] Un libellé importé qui contient le sigle du bailleur produit un avertissement à l'aperçu.

### R5 — Volumes et répétitions (performance, effort XL)
**Contenu**
- **Imports :** worker `data-import` avec progression (import-19, import-22, kobo-pm-30, kobo-dist-22) ; lecteur `.sav` en flux et lignes creuses (kobo-dist-21) ; insertion par lots (import-21, xlsform-21, kobo-dist-25).
- **Répétitions :** table unique et rattachements (kobo-pm-1 à 4, kobo-dist-1, xlsform-16, import-10, import-18).
- **Agrégation SQL :** pour les rapports, les synthèses et le PDD (reporting-62, kobo-pm-49, pdd-22).
- **Pagination :** sur le plan de suivi et la grille de données.

**Critères d'acceptation**
- [ ] Le zip CP s'importe par le worker sans arrêter l'API. Pendant l'import, la latence de la boucle d'événements de l'API reste sous 200 ms, et le worker sous 1 Go.
- [ ] SMP v2 : 7 722 rapports et toutes les lignes de répétition (céréales 7 918, légumineuses 7 942, huile 7 831, dattes 1 377…) sont rattachés, sans orpheline. Le réimport donne des comptes identiques.
- [ ] Une synthèse sur 12 900 soumissions répond en moins de 3 s. La revue ne trouve aucun `INSERT` dans une boucle.
- [ ] `GET /plan-board` est paginé (moins de 200 Ko par page).

### R6 — Centre d'import et connecteurs, dont le WDC (effort XL)
**Contenu**
- Centre d'import, dépôt unique, aperçu pour toutes les voies, rapport exact, journal et annulation (import-1, 2, 5 à 8, 45, 46).
- Lien typé et écran branché sur `link-pull` ; corrections WDC (import-3, 4, 26, 27, 29, 31, 44).
- Kobo incrémental et export synchrone (import-24, import-25).
- Sources multiples planifiées avec secrets chiffrés (import-32 à 35).
- Lecture des liens hors requête avec reprise (import-37, import-38).
- Exports complets côté serveur et menu « Télécharger » commun (import-39 à 43).
- Fichier déjà importé détecté, soumissions supprimées à la source repérées (kobo-pm-32, kobo-pm-47, kobo-pm-48, import-48).

**Critères d'acceptation**
- [ ] Déposer chacun des 10 zips, l'export SAMS et les 5 XLSForm propose la bonne destination. L'aperçu s'affiche avant toute écriture.
- [ ] Réimporter un fichier identique donne 0 nouvelle ligne, 0 mise à jour et N inchangées. Le journal liste le run, y compris quand il échoue.
- [ ] Coller le lien WDC affiche son type et son uuid. « Tester le lien » nomme les deux hôtes essayés.
- [ ] Avec un serveur simulé où `count = 1 000`, une seule page est demandée. Un second import ne lit que les nouvelles lignes.
- [ ] Deux imports simultanés sur la même fiche : le second reçoit 409 « import en cours ».
- [ ] « Exporter tout » contient 7 722 lignes pour SMP v2.

### R7 — Plan de suivi type Excel et écran MMR, tâches 7 et 2 (effort L)
**Contenu**
- **Plan de suivi :** retrait ou redirection des anciens imports RBM (rbm-1, rbm-44) ; liste fermée des POI (rbm-3) ; import de la hiérarchie des bureaux (rbm-5) ; emprise GPS (rbm-6) ; grille de statut et réimport « remplacer » (rbm-7) ; écran des critères aux échelles exactes (rbm-11) ; règle de score visible et paramétrable (rbm-13) ; priorité (rbm-14) ; filtres serveur et KPI (rbm-28, rbm-34) ; refus renvoyés (rbm-31) ; total par bureau × activité (rbm-32) ; feuille « Overreaching Parameters » à l'export (rbm-35) ; Activity Tag contrôlé (rbm-39) ; sites inactifs (rbm-40) ; panneau de la carte (rbm-41, rbm-42) ; import ligne par ligne (rbm-43).
- **Écran MMR :** n° CSP et catégories semées (rbm-16), nombre de sites calculé et surcharge tracée (rbm-17, rbm-20), catégories non paramétrées (rbm-23), cas indéfinis (rbm-19), alertes (rbm-22), aide accessible (rbm-24).

**Critères d'acceptation**
- [ ] Le classeur V2 s'importe sans 400. Les 12 lignes gabarit sans nom sont signalées comme ignorées, avec leur n° de ligne.
- [ ] L'écran des critères ne propose que sécurité {0, 1, 3, 99} et fraude {0, 1, 2}, avec les 11 critères. Une zone 99 n'est pas planifiable, et le refus est renvoyé.
- [ ] L'export contient la feuille MMR A..O, avec `C = B & D`, les formules H à O et les icônes 0 / 0,5 / 0,9. Le réimport combiné Locations + MMR passe par un seul aperçu.
- [ ] MMR : le nombre de sites est calculé sur les sites actifs, avec une puce « saisi » quand il est surchargé. Les lignes 8 à 10 sont conservées et marquées « non paramétrée ». Le tri suit le n° CSP.
- [ ] Vider un mois de statut dans Excel puis réimporter en mode « remplacer » efface ce statut.

### R8 — Facture fidèle au gabarit de mai et chaîne FLA → plan → facture (effort XL)
**Contenu**
- **FLA :** colonnes décalées et titres de blocs (finance-2, finance-3) ; % par activité dans l'import et l'éditeur (finance-4) ; écarts par rapport aux totaux (finance-5) ; en-tête et durée (finance-7, finance-8) ; commission par activité (finance-9) ; unité et justification (finance-10) ; part bailleur (finance-11) ; salaires (finance-12) ; export fidèle (finance-13) ; ratios et budget chargé (finance-14, finance-15).
- **Facture :** en-tête complet et 6 colonnes (finance-17, finance-18) ; mise en page I à V (finance-19, finance-20) ; sous-postes avec identifiants stables (finance-21, finance-22) ; alertes de sous-poste (finance-24) ; montant en lettres (finance-26) ; visas (finance-27) ; format (finance-28) ; état conforme au gabarit (finance-29, finance-31) ; montants déclarés comparés (finance-32) ; import de l'état réel (finance-33) ; modèle de postes (finance-34) ; facture sur plusieurs mois, plusieurs factures par mois, états par zone, montant validé (finance-35 à 39) ; numérotation, libellés et sections (finance-40 à 42) ; WBS et n° d'activité (finance-55) ; avenant (finance-54).
- **Planning :** dates de visite, mois, budget à trois facteurs, génération, contrôles, en-tête, écriture groupée, zones (finance-43, 44, 46 à 51, 53).

**Critères d'acceptation**
- [ ] FLA de test : un poste en section II (colonne B) est importé. « Mi-parcours » est rangé en `IV.evaluation_mi`, le titre fusionné en `V.locaux`, et une répartition 30/70 est conservée. Sur le FLA AINA, l'écart par rapport aux totaux est nul. Un taux de commission différent de 0,07 déclenche une alerte.
- [ ] L'export de la facture de mai reproduit M9 : 7 colonnes, 10 sous-postes IV, budget 123 013 000, mois 5 625 200, commission 393 764,00, à payer 6 018 964,00 et « Arrêté à la somme de : SIX MILLIONS DIX HUIT MILLE NEUF CENT SOIXANTE QUATRE ARIARY ».
- [ ] Le cumul recalculé vaut 1 000 000 pour le coordinateur et 1 050 000 pour la location de salle. L'écart avec le PDF signé est expliqué. Le restant du carburant (−3 163 727) est affiché en rouge et produit une alerte de sous-poste.
- [ ] Import de l'état de mai : Total IV = 5 625 200. L'écart 775 200 contre 887 400 doit être corrigé ou accepté explicitement.
- [ ] Facture YPA : 6 états pour un total de 21 128 550, commission 1 478 998,50 et montant en lettres avec centimes. Le montant validé 22 265 470 est enregistré avec son motif. Deux factures sont acceptées pour janvier 2026.
- [ ] Planning AINA : 37 visites datées, mois 2026-09 déduit, budget généré de 2 330 000, location de moto signalée comme poste hors FLA.

### R9 — Concepteur de rapport professionnel, tâche 6 (effort XL)
**Contenu**
- **Fondations :** période (reporting-1, reporting-2) ; mise en page et sections (reporting-3, reporting-4, reporting-58) ; référentiel d'activités et palette (reporting-6, reporting-73) ; couverture et comptages (reporting-7, 8, 38, 39, 65 à 67) ; méthodes de score, seuils, base « n » (reporting-9, 11, 12) ; scores par visite (reporting-43).
- **Nouveaux blocs :** reporting-14 à 35, 40 à 54 et 69 à 71.
- **Textes générés et variables :** reporting-23, 28, 55, 57, 64.
- **Exports et finalisation :** `.docx` réel, Excel avec période et méthode, rapport finalisé tiré de son instantané (reporting-59, reporting-60).
- **Modèles :** dans Paramètres (reporting-61) ; modèles « Rapport de performances » (5 pages A4 paysage), « Vue d'ensemble », « Couverture par partenaire et programme » et modèles par audience (reporting-41, reporting-56).
- **Qualité et performance :** reporting-62, reporting-63.

**Critères d'acceptation**
- [ ] Sur un jeu synthétique calqué sur la référence : 753/1 278 donne 59 %, la moyenne de Tuléar vaut 93, celle de Fort Dauphin 62, et un détournement à 3 % est orienté à 97.
- [ ] Avec les données du tableau de bord HTML en entrée : couverture 64, 75, 30, 15 et 52 ; `urgentPct` SMP 53 ; `naPct` 11 ; verdicts identiques.
- [ ] Le modèle de performances s'imprime sur 5 pages A4 paysage, avec des bandeaux à 3 zones et « Page n/N ». Le `.docx` s'ouvre dans Word sans avertissement.
- [ ] L'export Excel d'un rapport finalisé est identique à son instantané. « Régénérer » demande une confirmation et permet d'annuler.
- [ ] Un rapport sur 12 900 soumissions est généré en moins de 3 s.

### R10 — Localités : CRUD, pays et découpage, tâche 3 (effort M–L)
L'écran Localités n'a pas été audité en détail. Ce lot s'appuie sur les besoins tirés des références : quatre niveaux plus le village, pcodes suffixés « a » (`MG52516a`), 1 703 communes et 17 466 fokontany, variantes de libellés.
- **Contenu :**
  - CRUD par niveau avec parent obligatoire et pcode unique par tenant ;
  - renommage sans casser les liens (sites, PDD, soumissions par pcode) ;
  - import du découpage avec aperçu (ajouts et suppressions) et garde de décompression ;
  - alias de libellés (TOLAGNARO / Toalagnaro, BETSOKA / Betroka) ;
  - pays du tenant et emprise géographique utilisée pour valider le GPS (rbm-6) ;
  - alimentation facultative depuis les listes XLSForm (xlsform-28) ;
  - listes Adm1 à 4 reliées au référentiel au lieu d'être recopiées (kobo-pm-46).
- **Critères :**
  - [ ] un pcode en double renvoie 409 ;
  - [ ] la suppression d'une commune utilisée est refusée, avec la liste des usages ;
  - [ ] l'aperçu d'import du découpage indique les comptes ajoutés et supprimés avant d'écrire ;
  - [ ] un GPS hors de l'emprise du pays est rejeté à l'import et à la saisie ;
  - [ ] `MG52516a` est accepté et rapproché.

### R11 — i18n FR/EN réel, tâche 4 (effort M)
- **Contenu :**
  - erreurs serveur renvoyées sous forme de code et de paramètres, traduites par le front ;
  - paramètre `lang` pour tous les exports (feuilles, en-têtes) ;
  - mois et dates localisés (`date_edition`, « mois : Mai ») ;
  - formats numériques selon la langue (fin du `fr-FR` codé en dur) ;
  - libellés du catalogue par langue avec repli FR → EN → MG → nom (xlsform-51) ;
  - clés de tri indépendantes des libellés (priorités).
- **Critères :**
  - [ ] un parcours Playwright de toutes les routes en anglais ne trouve aucune chaîne française hors données ;
  - [ ] les exports facture, budget, PDD et rapport en `lang=en` ont leurs feuilles et en-têtes en anglais (pour les documents officiels, voir la question ouverte n° 13) ;
  - [ ] les tests i18n passent.

### R12 — PDD v2, après la tâche 1b (effort XL)
- **Contenu :**
  - rations, planification et moteur de calcul pur (pdd-1 à 6, pdd-29 à 32) ;
  - corrections tracées et ciblage (pdd-7, pdd-8) ;
  - duplication de mois, en-tête de plan, circuit de validation (pdd-9, pdd-24, pdd-36) ;
  - colonnes réelles, listes contrôlées et modèle aligné (pdd-10 à 12, pdd-35) ;
  - import avec recalcul et aperçu, paramétrage tiré du classeur (pdd-14, pdd-15, pdd-37) ;
  - stock par lot, allocation dans l'ordre des dates limites, alertes, pipeline monétaire (pdd-16 à 21) ;
  - tableaux croisés et impression signée (pdd-22, pdd-23) ;
  - référentiels réutilisés (pdd-20, pdd-26 à 28) ;
  - contrôle par ligne et aller-retour Excel (pdd-33, pdd-34) ;
  - indicateurs corrects (pdd-25).
- **Critères :**
  - [ ] `pddCompute` reproduit 100 % des valeurs en cache des 492 lignes, sauf les 89 cellules corrigées à la main, qui apparaissent comme des corrections tracées. Totaux : 13 235,427 t, 1 883 528,85 bénéficiaires, 317 895,85 USD ;
  - [ ] le stock par lot reproduit `TTD&BDD` (2 150,416, 8 779,295, −6 628,879). Les deux lots de sorgho coexistent. Une alerte est levée sur la date limite du riz (13/10/2024) ;
  - [ ] la synthèse distingue les ménages GD (224 459,80) des individus nutrition ;
  - [ ] le modèle utilise Inkind et CBT ;
  - [ ] un plan approuvé refuse tout réimport (409).

### R13 — Indicateurs métier avancés (effort XL)
- **Contenu :**
  - scores recalculés avec corrections documentées : MIARO, GD, SMP, Résilience, avec les non-applicables (xlsform-34, 36, 37 ; kobo-pm-22, 23) ;
  - drapeau de risque transmis au RBM et alertes à 24 h (xlsform-35, xlsform-46) ;
  - stocks et magasin (xlsform-38, kobo-pm-24, 25) ;
  - registre des problèmes et recommandations (xlsform-45, 47 ; kobo-pm-29 ; reporting-26, 27) ;
  - Réalisé des cantines, caisse, qualité, rations, lien avec le PDD (kobo-dist-11 à 17) ;
  - modules CP (kobo-dist-27 à 33) ;
  - autres indicateurs : répétitions, diversité alimentaire, parts d'options cochées, pondérations, rattachement aux sites, correspondances (xlsform-24, 26, 27, 30, 33, 39 à 44, 48 à 50 ; kobo-pm-16, 18 à 20, 26 à 28, 33 à 35, 38 à 45 ; kobo-dist-5, 9, 18 à 20, 34, 35).
- **Critères :**
  - [ ] l'indice GD recalculé est identique au formulaire sur 331 visites sur 331. Les écarts MIARO sont listés avec la règle corrigée ;
  - [ ] rapprochement de stock SAMS : 6,2 et un écart de 5,2 ;
  - [ ] Réalisé des cantines de mars 2026, dédoublonné : 1 011 écoles, 6 021 671 repas, 845,8 t de céréales distribuées ;
  - [ ] registre MIARO : 11 problèmes importés ;
  - [ ] un risque « élevé » crée une alerte critique avec une échéance de 24 h.

---

## Questions ouvertes

Ces points ne peuvent pas être tranchés à partir des documents.

1. **RBM, grille Z:AK (mois 1–12)** : est-ce la planification des visites ou leur marquage une fois réalisées ? Le classeur ne la documente pas.
2. **Site au statut non renseigné** : faut-il le compter comme actif ou non dans les KPI et dans le dénominateur de la couverture ?
3. **Score de risque (colonne Y)** : le V2 ne contient ni formule ni pondération. Faut-il valider la règle par défaut actuelle de MEMS, ou en avez-vous une de référence ?
4. **MMR** :
   - nombre de sites : tous les sites, ou seulement les sites « Active », et à quelle date ?
   - faut-il proratiser les visites exigées pour les mois inactifs ?
   - comment arrondir la fréquence « ajustée » ?
   - un bureau dont la capacité faisable vaut 0 est-il exempté ou signalé ?
5. **PDD** :
   - quel est le sens des colonnes OIL, CSB et LNS (× 2) ?
   - l'huile et les dattes vidées en novembre relèvent-elles d'une règle permanente ou d'une exception ?
   - quelles rations faut-il retenir pour le maïs concassé, les légumineuses avec le sorgho (3e-05 ou 6e-05), le cyclone (ligne propre ou ligne sécheresse), le CSB++ et le LNS-sq ?
6. **Niveau de facturation par défaut** : sous-poste (gabarit Lalana) ou ligne du catalogue (facture YPA) ? Imputer un poste hors FLA (location de moto sur « location voiture ») est-il permis avec un visa, ou refusé ?
7. **Réalisé** : faut-il le compter dès la soumission ou seulement après validation ? Sur le montant facturé ou sur le montant payable validé ?
8. **Budget de la consolidation** : faut-il afficher par défaut le budget « Suivi » direct (41 164 000) ou chargé (44 045 480) ?
9. **Scores officiels** : quelle méthode par défaut, la moyenne des domaines (rapport) ou la moyenne par visite notée (tableau de bord) ? Quand le score corrigé par MEMS diffère de celui du formulaire (SPI 64 % contre 82 %), lequel fait foi ?
10. **Données personnelles** : faut-il afficher les noms réels des agents ou des pseudonymes ? Quels rôles peuvent voir les noms et téléphones des producteurs de l'enquête CP ?
11. **Réseau MoDA** : depuis le serveur MEMS, quel hôte est joignable (le même hôte ou `api.<hôte>`), et par quel réseau ? Le lien WDC, qui est une clé d'accès, doit-il rester visible par tous les utilisateurs du tenant ?
12. **Pays** : un tenant correspond-il à un seul pays, ou peut-il en couvrir plusieurs (découpage, emprise GPS) ?
13. **Documents officiels en anglais** : la facture, le PDD imprimé et le budget FLA doivent-ils être traduits, ou garder leur gabarit français quelle que soit la langue de l'interface ?
14. **Jours du superviseur** : dans le budget de collecte, faut-il les saisir (3 jours dans le planning AINA) ou les déduire du planning ?
