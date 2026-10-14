# Reprise du travail — passation entre sessions Claude

_Mis à jour : 14/10/2026, 11:31 UTC, par la session principale (branche `claude/practical-meitner-2c1560`).
Ce fichier est tenu à jour à chaque étape. Le détail heure par heure est dans [`JOURNAL.md`](JOURNAL.md)._

**À qui s'adresse ce fichier ?** À toute session Claude qui reprend le projet, en particulier pendant une limite d'usage de la session principale. Il dit :
- ce qui est fait et publié ;
- ce qui est en cours, avec ce que fait chaque agent et où se trouve son code ;
- ce qui reste à faire ;
- comment travailler à deux sans se marcher dessus.

## 0. À lire, dans cet ordre

1. `CLAUDE.md`, pour les règles du projet (fiabilité, couches, isolation par compte, centimes entiers, FR + EN…).
2. Ce fichier, puis le tableau « État courant » en tête de [`JOURNAL.md`](JOURNAL.md).
3. [`ETAT_DU_PROJET.md`](ETAT_DU_PROJET.md) (fait / en cours / reste) et [`RETOURS_UTILISATEUR.md`](RETOURS_UTILISATEUR.md) (chaque retour et son état, n° 1 à 58).
4. [`PLAN_RETOURS_15_37.md`](PLAN_RETOURS_15_37.md), pour les **définitions communes** qui s'imposent à tous : visite, réalisée, site actif, couverture, période, suppression…
5. Les spécifications des lots en cours : [`SPEC_LOT_1B.md`](SPEC_LOT_1B.md), [`SPEC_LOT_6A.md`](SPEC_LOT_6A.md), [`SPEC_LOT_7A.md`](SPEC_LOT_7A.md).
6. [`reprise/AGENTS_EN_COURS.md`](reprise/AGENTS_EN_COURS.md), la consigne exacte de chaque agent en cours, et les constats ouverts des vérificateurs : [`reprise/CONSTATS_1B.md`](reprise/CONSTATS_1B.md), [`reprise/CONSTATS_6A.md`](reprise/CONSTATS_6A.md).

## 1. Ce qui est fait et publié sur `main`

`main` contient tout jusqu'au **lot 1** (dernier commit de code `45493c7`), plus les documents de suivi. Le détail est dans [`ETAT_DU_PROJET.md`](ETAT_DU_PROJET.md) § « Fait et publié ». Contrôles sur `main` :
- 669 tests serveur ;
- lint propre ;
- build web OK ;
- balayage de 31 écrans FR + EN : 0 erreur, 0 phrase anglaise manquante (`node web/scripts/sweep-ecrans.cjs`, relancé le 14/10 à 11:25).

## 2. Où est le code (branches)

Les branches `wip/…` sont les branches de travail des agents de la session principale. Elles sont poussées sur GitHub pour la passation et avancent à chaque commit d'agent.

| Branche | Sur GitHub | Contenu | Tête (14/10 11:27) | État |
|---|---|---|---|---|
| `main` | oui | Publié et vérifié (jusqu'au lot 1 + docs) | voir GitHub | ✅ |
| `claude/practical-meitner-2c1560` | oui | Branche de la session principale, identique à `main` (docs) | idem | ✅ |
| `wip/1b-core` | oui | Lot 1b, socle (8 commits) : modèle de période, régions 19 s → 10 ms, faits site × mois, sélecteur « du … au … ». Part de `7140ae9`. | `0d68d9b` | construit, vérifié → constats dans `reprise/CONSTATS_1B.md` |
| `wip/1b-rest` | oui | Lot 1b, écrans (9 commits) par-dessus `wip/1b-core` | `bb7eb0b` | construit, vérifié → constats dans `reprise/CONSTATS_1B.md` |
| `wip/6a` | oui | Lot 6a, carte (12 commits, migration `061_map_geo.sql`) par-dessus `wip/1b-core` | `523aed3` | construit, vérifié → constats dans `reprise/CONSTATS_6A.md` |
| `wip/fix-1b` | oui | Corrections des constats 1b, par-dessus `wip/1b-rest` (11 commits à 11:27) | `ac5bb3d` | 🔄 agent `build:fix-1b` en cours, puis vérification |
| `wip/fix-6a` | oui | Fusion de `wip/6a` dans les écrans 1b (la carte suit la période de la page) + corrections des constats 6a (23 commits à 11:27) | `4aba96e` | 🔄 agent `build:fix-6a` en cours, puis vérification |
| `wip/quarterly` | quand créée | Retour 54 : tableau trimestriel par activité | — | 🔄 agent `build:quarterly`, rien de commité à 11:27 |
| `wip/deletion` | quand créée | Retour 56 : suppression des documents (repart des commits de l'autre session, voir § 3-D) | — | 🔄 agent `build:deletion`, rien de commité à 11:27 |
| `wip/7a` | oui | Lot 7a, concepteur riche, par-dessus `wip/1b-core` : C1 à C7 faits (7 commits) | `c86188f` | 🔄 partie 2 (C8 à C13) en cours |
| `wip/r57-core` | oui | Retour 57 : socle GPS de l'autre session, réconcilié avec `shpReader.js`, par-dessus `main` | `d9c25d2` | 🔄 réconciliation + vérification en cours → `main` dès que vérifié |
| `claude/zealous-bardeen-p9ozcr` | oui | **Autre session Claude.** Retour 56 (4 commits : `97f0835`, `a76f20d`, `3838254`, `4dcad08`) et retour 57, socle pur (`76544a1`). Part de `9d90076`. | `76544a1` | relu (§ 4) ; repris par `wip/deletion` et `wip/r57-core` |
| `claude/friendly-carson-ze6mtp` | oui | Ancienne branche du 09/10, déjà entièrement dans `main` | `34be945` | à ignorer |

Graphe :

```
main (lot 1) ──► wip/r57-core
7140ae9 ──► wip/1b-core ──► wip/1b-rest ──► wip/fix-1b, wip/quarterly, wip/deletion
                  │                      └──► wip/fix-6a (= fusion de wip/6a + corrections)
                  ├──► wip/6a
                  └──► wip/7a
```

## 3. Chantiers en cours — ce que fait chaque agent

La consigne exacte de chaque agent est dans [`reprise/AGENTS_EN_COURS.md`](reprise/AGENTS_EN_COURS.md).

| | Chantier | Qui | Branche | Fait | Reste |
|---|---|---|---|---|---|
| A | **Corrections 1b** (16 constats, dont le grave : district du site jamais déplacé dans une autre région) | session principale, agent `build:fix-1b` | `wip/fix-1b` | district vérifié par P-code ; RBM passé = même règle ; perf analyse ; plafonds de période partagés serveur / écrans ; PDD par l'agrégat SQL ; sélecteur sur téléphone ; filtre « du … au … » de Planification, dollars au taux de chaque mois ; libellés « Exécution du plan (visites) » ; alertes « ce mois » | ce qui manque de la liste, puis vérification indépendante |
| B | **Carte 6a dans les écrans 1b + corrections** (11 constats, dont le grave : coordonnées GPS des ménages lisibles par un lecteur) | session principale, agent `build:fix-6a` | `wip/fix-6a` | fusion 6a → 1b ; vie privée GPS (aperçus) ; maille 2 km hors admin / gestionnaire ; migration 061 AFTER INSERT ; perf ≤ 400 ms à 10 240 sites ; cache des contours ; « jamais visités » ; filtre bureau ; 390 px | fin de la liste, puis vérification indépendante |
| C | **Retour 54** : tableau trimestriel par activité, nouvelle entrée « Rapport trimestriel » du Dashboard décisionnel, export Excel | session principale, agent `build:quarterly` | `wip/quarterly` | — | tout, puis vérification |
| D | **Retour 56** : suppression des documents | session principale, agent `build:deletion` | `wip/deletion` | repart des 3 premiers commits de l'autre session | migration renumérotée `069` ; anglais ; avenants (⚠ l'autre session a aussi fait `4dcad08` après le lancement de l'agent : à la fusion, garder la meilleure des deux versions) ; données reliées listées dans le refus ; documents validés supprimables à l'écran par le valideur ou l'admin ; justificatif ≥ 10 caractères ; tests du dépôt et des routes ; puis vérification |
| E | **Lot 7a partie 2** : en-tête et pied libres (062), fil de validation (063), cache (064), Word, PowerPoint | session principale, agent `build:7a-2` | `wip/7a` | partie 1 : C1 indicateurs rapides, C2 rendu progressif (fini la page blanche « Calcul… »), C3 modèle v2, C4 et C5 catalogue de toutes les données de MEMS, C6 éditeur à 3 volets, C7 pagination exacte et orientation par section | C8 à C13, puis vérification de tout le lot |
| F | **Conception du lot 5 élargi** (retours 24, 25, 55) | session principale | — | **v1 rendue** → [`SPEC_LOT_5.md`](SPEC_LOT_5.md) (critique et décisions provisoires incluses) | v2 : intégrer la critique (7 graves) et le retour 58, puis réalisation après la publication de 1b et 6a |
| G | **Conception du retour 58** (onglet « Affectation des TPM » par région › district, défauts des contrats, raison obligatoire) | session principale, workflow `design-retour58-tpm-contrat` (lecture seule) | — | — | spécification à écrire dans `docs/SPEC_RETOUR_58.md` |
| H | **Retour 57, socle** (point dans polygone, lecture des contours .shp, localisation GPS) | autre session (`76544a1`), réconcilié par la session principale | `wip/r57-core` | code de l'autre session repris ; un seul lecteur .shp | durcissement contre les fichiers piégés, mesure sur les vrais contours, vérification, puis `main` |

### Ensuite, dans l'ordre (demande de l'utilisateur : « publie sur main ce qui a été fait par tous, en vérifiant que rien ne bug »)

1. **`wip/r57-core` → `main`** dès sa vérification : il n'ajoute que des modules purs et leurs tests, l'application ne change pas.
2. **Intégration** sur une branche partie de `main`, dans cet ordre, quand A à D sont rendus avec leur vérification :
   - `wip/fix-1b`, puis `wip/fix-6a`, puis `wip/quarterly`, puis `wip/deletion` (réconcilié avec `4dcad08`) ;
   - puis `wip/7a` (C1 à C7, et la suite si elle est vérifiée).

   Ensuite :
   - **migrations** : vérifier sur une base neuve (001 → fin) et sur une copie de la base de démonstration existante ;
   - **contrôles** : tests, lint, build et balayage FR + EN, puis une vérification indépendante de l'ensemble ;
   - **publication** : `main` en avance rapide, puis mise à jour du journal, de `RETOURS_UTILISATEUR.md`, de `ETAT_DU_PROJET.md` et de `CLAUDE.md`.
3. Le lot 5 élargi, d'après sa spécification, avec le retour 58.
4. Les lots 2–3 (référentiels, registre ; retours 46 et 57 : code de localité, plusieurs sites par site déclaré ou commune, rapprochement GPS par contours importés, sur le socle `wip/r57-core`), puis le lot 4 (réalisé issu des données), le lot 7b et le lot 8.

## 4. Revue du travail de l'autre session (`claude/zealous-bardeen-p9ozcr`)

- **Retour 56** (`97f0835`, `a76f20d`, `3838254`, `4dcad08`). Base saine : règle pure testée, journal en inscription seule, isolé par compte, dialogue commun, écran du journal. Points corrigés par le chantier D avant publication :
  - ⛔ la migration `061` est déjà prise par la carte → `069` ;
  - aucune traduction anglaise ;
  - le refus « donnée reliée » ne dit pas laquelle ;
  - les propres postes d'un plan comptent à tort comme donnée reliée ;
  - le renouvellement d'un contrat n'est pas vérifié (erreur technique) ;
  - la suppression d'un document validé n'est jamais proposée à l'écran et n'exige pas le valideur ;
  - le justificatif peut faire 1 caractère ;
  - seuls les tests de la règle pure existent.
- **Retour 57** (`76544a1`). Socle pur et testé : point dans polygone (trous, archipels), lecture des anneaux d'un `.shp`, localisation d'un point GPS dans ses contours. Il n'est encore relié ni aux écrans, ni à `admin_areas`, ni au modèle « un site par activité » (lot 3). Il **doublait** le lecteur `.shp` existant (`settings/shpReader.js`) : la réconciliation H n'en garde qu'un.

## 5. Travailler à deux sessions sans se marcher dessus

- **Ne jamais pousser** sur une branche `wip/…` ni sur la branche de l'autre session. Pour continuer un chantier, créer sa propre branche à partir de la branche `wip/…` concernée, et le noter dans le journal (« État courant ») et ici (§ 3, colonne « Qui »).
- **Réserver avant de commencer.** Un chantier dont la colonne « Qui » nomme déjà une session n'est pas repris sans le dire dans le journal. La session principale fait de même.
- **Numéros de migration réservés :**

  | N° | Usage |
  |---|---|
  | `061` | carte 6a (`061_map_geo.sql`) |
  | `062` à `064` | lot 7a |
  | `065` à `068` | lot 5 (l'index éventuel du lot 1b prend un numéro ≥ `071`) |
  | `069` | journal des suppressions (retour 56) |
  | `070` | retour 58 (proposé) |
  | `071` et suivants | libres |

  Ne jamais réutiliser un numéro, même sur une autre branche.
- **Publier sur `main`** seulement après :
  - `cd server && npm test && npm run lint` ;
  - `cd web && npm run build` ;
  - `node web/scripts/sweep-ecrans.cjs` (0 erreur, 0 phrase anglaise manquante) ;
  - une vérification indépendante ;
  - les migrations essayées sur une base neuve **et** sur une base existante.

  Publication en avance rapide de `main` uniquement, jamais en réécriture d'historique.
- **Documents.** Le journal est mis à jour à chaque action, avec l'heure UTC réelle. Mettre aussi à jour l'état de chaque retour, `ETAT_DU_PROJET.md` à chaque publication, `CLAUDE.md` pour les règles durables, et **ce fichier** à chaque changement de chantier.

## 6. Environnement (conteneur cloud)

```sh
service postgresql start                       # PostgreSQL 16, base de démonstration mems2_tpm
cd server && npm run migrate && npm run seed && npm run seed:test   # si base neuve
cd server && DATA_SOURCE_ALLOWED_HOSTS=localhost setsid nohup node src/server.js > /tmp/api.log 2>&1 < /dev/null &   # API :9000 (sans DATABASE_URL / APP_DATABASE_URL hérités de l'environnement : utiliser server/.env)
cd web && setsid nohup npx vite --port 5173 --strictPort > /tmp/vite.log 2>&1 < /dev/null &                          # interface :5173
node web/scripts/sweep-ecrans.cjs              # balayage FR + EN de 31 écrans (Playwright + Chromium préinstallés)
```

- Compte de démonstration : `admin@mems.mg` / `changeme123` ; valideur : `validateur@mems.mg`.
- Les agents utilisent chacun une base jetable (préfixe à leur nom) et leurs propres ports (9601… / 5601…).
- Ils n'arrêtent jamais l'API :9000 ni l'interface :5173, et ne lancent jamais `pkill`.

## 7. Points à confirmer par l'utilisateur, risques connus

- **156 soumissions Nutrition** reçues en avril 2026 sont rangées d'août 2024 à décembre 2025 d'après leur seule date SvyDate. Ces dates sont-elles fiables ?
- **Classeur d'activation** : la colonne « Code POI » est décalée par rapport aux lignes. Le rattachement se fait par le nom dans le district.
- **Performance sur 12 à 24 mois** : 1,8 à 3 s sur le banc de 58 727 soumissions. Les pistes sont dans `SPEC_LOT_1B.md` ; le chantier A abaisse les plafonds.
- **Pas de tests automatiques de l'interface** : le balayage Playwright en tient lieu.
