# MEMS 2.0 — Module Partenaires & TPM

Ceci est le premier module réel de **MEMS 2.0**, l'application web de gestion
des contrats et de planification du suivi-évaluation. Il correspond
au module « Partenaires & TPM » de la maquette : affectation d'un site à un
prestataire TPM puis à l'un de ses agents, calendrier de mission, et calcul
du budget associé.

Ce n'est pas une maquette : c'est une application complète, avec une vraie
base de données, une vraie authentification et un vrai calcul de dépenses en
arrière-plan — construite pour être le socle sur lequel les 11 autres
modules viendront s'ajouter, module par module, sans jamais remettre en
cause l'architecture ni la fiabilité de celui-ci.

## Pourquoi cette architecture (fiabilité et maintenabilité d'abord)

C'est la priorité explicitement demandée pour cette application « niveau
entreprise » ; chaque choix ci-dessous en découle.

- **Multitenant** : chaque table métier porte une colonne `tenant_id`, et
  Postgres **Row-Level Security (RLS)** applique l'isolation au niveau base
  de données — pas seulement dans le code applicatif. Même si une requête
  oublie un `WHERE tenant_id = ...`, la base refuse de renvoyer les lignes
  d'un autre tenant. L'API et le worker se connectent avec un rôle Postgres
  restreint (`mems2_app`, `NOSUPERUSER NOBYPASSRLS`) — un superutilisateur ou
  le propriétaire des tables contourne toujours RLS, donc faire tourner
  l'application avec ce rôle-là annulerait silencieusement la protection.
- **Fiabilité / traitement intensif** : le recalcul des dépenses de mission
  (potentiellement des milliers de jours de mission par tenant) tourne dans
  un **worker en arrière-plan** (BullMQ + Redis), jamais dans le cycle
  requête/réponse de l'API. Une requête API répond immédiatement ; le calcul
  se fait de façon asynchrone, avec re-tentatives automatiques en cas
  d'échec.
- **« Multithreading »** : Node.js est mono-thread par processus. Le vrai
  parallélisme ici vient de plusieurs **processus worker** (2 réplicas dans
  `docker-compose.yml`, chacun avec plusieurs jobs concurrents) plutôt que
  de `worker_threads` — le travail est limité par la base de données, pas
  par le CPU, donc la parallélisation au niveau processus est le choix le
  plus fiable et le plus simple à faire évoluer (ajouter des réplicas =
  plus de capacité, sans changer une ligne de code).
- **Maintenabilité** : architecture en couches strictes —
  `routes → controller → service → repository`. Le service porte toutes les
  règles métier (ex. un plan ne peut être modifié qu'au statut
  « Brouillon » ; l'affectation d'un agent nécessite d'abord un
  prestataire) ; le repository est la seule couche à écrire du SQL ; les
  contrôleurs ne font que traduire HTTP ↔ service.
- **Migrations** : un exécuteur de migrations minimal et sans dépendance
  externe (`src/db/migrate.js`), qui applique chaque fichier `.sql` une
  seule fois et garde la trace dans `schema_migrations`. Simple à lire,
  simple à auditer.

## Interface (design moderne)

Interface « cockpit » : barre latérale sombre + contenu clair, dense et
lisible, pensée comme un outil de pilotage.

- **Typographie** : **IBM Plex Sans** (interface) + **IBM Plex Mono** (chiffres :
  montants, KPI, numéros), **auto-hébergées** dans le bundle (`@fontsource`) —
  aucun appel CDN, rendu identique hors ligne ou sur réseau restreint.
- **Couleurs** : accent **bleu électrique** (`#2f6bff`, survol `#1f4fd6`),
  neutres slate/navy (texte `#2b3a52`, titres `#0f1b2d`, fonds `#eef1f6` /
  `#ffffff`, bordures `#e2e8f1`), statuts rouge `#e0364f` / ambre `#e0982a` /
  vert `#17a34a` (variantes texte plus foncées pour le contraste AA).
- **Barre latérale sombre** (bleu nuit `#0e1a2b`) dans les deux thèmes, avec
  état actif en pastille + accent, **repliable** (mode rail d'icônes).
- **KPI** avec liseré d'accent et **chiffres en mono** ; tableaux à chiffres
  mono tabulaires. Rendu **flat** (aplats, ombres douces).
- **Thème clair / sombre** complet (jetons CSS redéfinis, tout le système suit).
- **Structure** : modules › sous-modules, fil d'Ariane, liens profonds
  (`#/tpm/affectation`). Logo MEMS en SVG.
- **Connexion** : page centrée sur une seule carte (sans panneau latéral).
- **Accessibilité** : focus visible, dialogues avec piège de focus et Échap,
  libellés ARIA sur les listes déroulantes et le calendrier, respect de
  `prefers-reduced-motion`, affichage mobile sans défilement horizontal.
- **Retour utilisateur** : mises à jour optimistes (annulées en cas
  d'erreur), notifications, états de chargement et vides, confirmation
  avant toute étape irréversible du workflow.

## Démarrer avec Docker (optionnel)

> Sur Windows avec PostgreSQL déjà installé, préférez la section **« Démarrer
> sur Windows »** plus bas. Docker n'est utile que si vous voulez tout
> (PostgreSQL + Redis + API + worker + interface) en une commande.

```bash
docker compose up --build
```

Cela lance, dans l'ordre (grâce aux `healthcheck` / `depends_on`) :

1. **postgres** (16-alpine) et **redis** (7-alpine)
2. **api** — applique les migrations, insère les données de démonstration,
   puis démarre le serveur HTTP sur `http://localhost:9000`
3. **worker** — 2 réplicas, consomment la file `tpm-expense-recalc`
4. **web** — l'interface React sur `http://localhost:5173`

### Identifiants de démonstration

| Email                     | Mot de passe | Rôle  |
|---------------------------|--------------|-------|
| admin@mems.mg           | changeme123  | admin (rédacteur)   |
| validateur@mems.mg      | changeme123  | manager (valideur)  |

Le compte validateur sert à démontrer la séparation des tâches : un
contrat créé par l'admin est approuvé en se connectant comme validateur.

**⚠️ Avant tout déploiement réel**, changez impérativement :

- `JWT_SECRET` (dans `server/.env`)
- le mot de passe du rôle `mems2_app` (actuellement `mems2_app_change_me`,
  défini dans `server/src/db/migrations/012_app_role_password.sql` — à adapter
  puis à reporter dans `APP_DATABASE_URL`)
- le mot de passe `changeme123` du compte admin de démonstration (ou
  supprimez ce compte et créez les vrais comptes)

Tous ces éléments sont des valeurs de développement, volontairement
identifiées comme telles dans le code — aucune n'est destinée à un usage en
production telle quelle.

## Démarrer sur Windows (PostgreSQL déjà installé, sans Docker)

> Guide pas-à-pas pour un poste **Windows** avec **PostgreSQL déjà installé**
> et **Node.js 18+**. Aucune installation de Docker ni de Redis n'est
> nécessaire : l'API et l'interface fonctionnent sans Redis (seul le recalcul
> des dépenses en tâche de fond a besoin de Redis — voir la note plus bas).
> Les commandes ci-dessous sont écrites pour l'**invite de commandes
> Windows (`cmd`)** : on y utilise `copy` (et non `cp`).

**1. Créer la base de données** (une seule fois). Ouvrez `cmd` ; adaptez
`postgres` si votre superutilisateur PostgreSQL porte un autre nom. Le mot de
passe vous sera demandé.

```cmd
createdb -U postgres mems2_tpm
```

> Si `createdb` n'est pas reconnu, ajoutez le dossier `bin` de PostgreSQL au
> `PATH` (ex. `C:\Program Files\PostgreSQL\16\bin`) ou lancez-le avec son
> chemin complet. Alternative en SQL :
> `psql -U postgres -c "CREATE DATABASE mems2_tpm;"`

**2. Configurer le serveur.** Depuis le dossier du projet :

```cmd
cd server
copy .env.example .env
```

Ouvrez `server\.env` et ajustez **deux** lignes selon votre PostgreSQL local
(remplacez `postgres:VOTRE_MDP` par votre superutilisateur et son mot de
passe) :

```
PORT=9000
DATABASE_URL=postgres://postgres:VOTRE_MDP@localhost:5432/mems2_tpm
APP_DATABASE_URL=postgres://mems2_app:mems2_app_change_me@localhost:5432/mems2_tpm
```

- `DATABASE_URL` = votre **superutilisateur** (sert uniquement à `migrate` et
  `seed`, qui créent les tables **et** le rôle applicatif restreint).
- `APP_DATABASE_URL` = le rôle **`mems2_app`** que la migration crée
  automatiquement (mot de passe `mems2_app_change_me`). L'API et le worker
  s'y connectent pour que la sécurité RLS soit réellement appliquée. **Ce rôle
  est dédié à MEMS 2.0** : il ne touche jamais au rôle `mems_app` d'un autre
  système éventuellement présent sur le même serveur PostgreSQL.

**3. Installer, migrer, insérer les données de démonstration :**

```cmd
npm install
npm run migrate
npm run seed
```

**4. Démarrer l'API** (laissez cette fenêtre ouverte) :

```cmd
npm start
```

L'API écoute sur `http://localhost:9000`.

**5. Démarrer l'interface** (nouvelle fenêtre `cmd`, depuis la racine du
projet) :

```cmd
cd web
npm install
npm run dev
```

L'interface s'ouvre sur `http://localhost:5173` et pointe par défaut sur l'API
`http://localhost:9000` — aucune configuration supplémentaire n'est requise.
Connectez-vous avec `admin@mems.mg` / `changeme123`.

**6. (Optionnel) Recalcul des dépenses en tâche de fond.** Ce calcul tourne
dans un worker qui a besoin de **Redis**. Sans Redis, toute l'application
reste utilisable ; seul le recalcul asynchrone des jours de mission est en
pause. Si vous avez Redis en local, ouvrez une 3ᵉ fenêtre :

```cmd
cd server
npm run worker
```

> **Le port 9000** est utilisé car le port 4000 était déjà pris sur le poste
> cible. Pour en changer, modifiez `PORT` dans `server\.env` (l'interface suit
> automatiquement si vous démarrez l'API sur ce nouveau port et lancez le web
> avec `set VITE_API_URL=http://localhost:VOTRE_PORT`).

### Mettre à jour une installation existante (base PostgreSQL déjà remplie)

Vous avez **déjà la base `mems2_tpm` avec vos données** ? La mise à jour est
sûre et ne perd aucune donnée : les migrations sont **suivies par nom de
fichier** dans la table `schema_migrations` et **seules les nouvelles**
s'appliquent ; elles sont **additives et idempotentes** (`ADD COLUMN IF NOT
EXISTS`, `CREATE … IF NOT EXISTS`, conversions rejouables).

```cmd
REM 1) Récupérer le nouveau code
git pull

REM 2) Appliquer UNIQUEMENT les nouvelles migrations (ne touche pas aux données)
cd server
npm install
npm run migrate

REM 3) NE PAS relancer « npm run seed » sur une base de production :
REM    le seed n'insère que le jeu de démonstration. Ne l'exécutez que sur
REM    une base vierge.

REM 4) Redémarrer l'API
npm start

REM 5) Reconstruire / relancer l'interface (nouvelle fenêtre, à la racine)
cd web
npm install
npm run dev          REM ou « npm run build » pour un livrable statique
```

> **Ce que la mise à jour ajoute côté base** (rien à faire manuellement, tout
> passe par `npm run migrate`) : colonnes de la facture fidèle (`013`),
> index de consolidation (`014`), terminologie neutre bailleur/ONG (`015`),
> plans de collecte (`016`), et l'**activité par poste** rattachée au
> référentiel « Paramétrage › Activités » (`017`). Aucune migration ne
> supprime ni ne réécrit vos lignes existantes.

> **Vérifier l'état des migrations** à tout moment :
> `psql -U postgres -d mems2_tpm -c "SELECT filename, applied_at FROM schema_migrations ORDER BY filename;"`

## Démarrer sur macOS / Linux (sans Docker)

Identique, en remplaçant `copy` par `cp` :

```bash
createdb mems2_tpm
cd server && cp .env.example .env      # ajustez DATABASE_URL / APP_DATABASE_URL
npm install && npm run migrate && npm run seed
npm start                               # API sur :9000
# autre terminal : cd web && npm install && npm run dev   # UI sur :5173
# optionnel (Redis requis) : cd server && npm run worker
```

## Tests

```bash
cd server
npm test
```

Couvre la logique métier pure qui mérite le plus d'être garantie par un test
(le calcul des dépenses, la normalisation du mois du plan, la machine à
états du workflow brouillon → soumis → validé). Les tests d'intégration
contre une vraie base de données sont un développement futur volontairement
laissé de côté pour ce premier module — la structure en couches
(`repository` isolé) est faite pour les accueillir facilement plus tard.

## Paramétrage (référentiels configurables)

Tout ce qui était codé en dur est désormais géré depuis **Paramétrage** et
alimente les autres modules :

- **Types de partenaire** — catégorisation configurable (TPM, prestataire,
  cabinet…).
- **Partenaires** — registre unifié : partenaires de mise en œuvre,
  prestataires, cabinets et TPM, décrits uniquement par leur **nom** et leur
  **type** (plus de barème journalier — il n'existe pas dans le FLA). Cette
  liste sert ensuite aux sélections dans Contrats et Rapports. Un partenaire
  de type TPM peut porter des agents de terrain. *La création d'un partenaire
  ou d'un TPM se fait ici*, plus dans les modules opérationnels.
- **Activités** — liste configurable (suivi, ciblage, PDM, distribution,
  évaluation…), en **multi-sélection** sur les contrats.

Choix technique : `tpm_providers` a été fusionné dans un registre `partners`
unique (mêmes UUID → aucune clé étrangère cassée), un TPM n'étant qu'un
partenaire de type « TPM ».

## Budget FLA fidèle (par postes)

Le budget du contrat reproduit **exactement** le vrai fichier FLA
(`Contrat-budget-WFP-MDG-2025-AIN-MULTI-003-AM02-V1.xlsx`), au niveau du
**poste** et non plus d'un montant forfaitaire :

- Chaque ligne de coût contient des **postes** saisis comme dans l'Excel :
  `nb unités × coût unitaire = montant` (ex. *COLLECTE Indemnité des agents*,
  `200 × 60 000 = 12 000 000 Ar`).
- Chaque poste est rattaché à une **activité** (répartition en % ; le fichier
  source affecte 100 % à une seule activité).
- Les postes se rangent dans les **5 sections officielles** :
  - **I.** Transferts de produits alimentaires
  - **II.** Transferts monétaires (CBT)
  - **III.** Renforcement de capacités
  - **IV.** Services techniques et spécialisés — dont la ligne **Suivi (TPM)**
  - **V.** Coûts directs d'appui du partenaire
- **Commission de gestion** : un pourcentage (7 % dans le fichier) appliqué au
  total des coûts directs.
- **Total de l'accord** = coûts directs + commission de gestion. C'est le
  **plafond du contrat** (le « barème » à ne pas dépasser) ; il n'est jamais
  saisi à la main, il est **calculé** à partir des postes.
- **Barème mensuel** = Total de l'accord ÷ nombre de mois de la période. Il
  sert de plafond mensuel aux plans et aux rapports.

Pour le contrat de démonstration AINA, les 15 postes de la section IV donnent
un total direct de **41 164 000 Ar**, une commission de **2 881 480 Ar** (7 %)
et un **Total de l'accord de 44 045 480 Ar**, identiques au fichier source.
La ligne « Suivi (TPM) » de la section IV est le budget de suivi tiers, mesuré
par le module Rapports & dépenses.

## Zones d'intervention & découpage administratif (multitenant)

Chaque contrat affecte des **zones géographiques** au prestataire, choisies dans
des **listes déroulantes en cascade** (Région → District → …) — jamais en saisie
libre.

- Le **découpage administratif** suit la convention **adm1–adm4** (comme MEMS :
  Région › District › Commune › Fokontany) et est un référentiel **par tenant /
  par pays** : chaque pays importe son propre fichier dans **Paramétrage ›
  Localités** (`.csv`, `.dbf`, ou `.zip` shapefile — la table attributaire
  `.dbf` est lue ; colonnes ADM1–ADM4 / Région / District / Commune / Fokontany
  détectées). Un **modèle CSV** est téléchargeable, et l'import est **par lots**
  pour tenir l'échelle nationale (≈ 18 000 fokontany).
- Les tables `admin_levels` et `admin_areas` sont **tenant-scoped** (RLS) : un
  bureau ne voit que le découpage de son pays.
- Le contrat stocke les nœuds retenus (`contract_areas`), avec leur chemin
  dénormalisé pour l'affichage et l'export.
- En amorce, le tenant Madagascar est peuplé Région → District depuis le
  référentiel fourni ; l'import le remplace.

## Contrats — page complète, avenant, export Excel

- **Création / édition en pleine page** (plus de tiroir) : identité, activités,
  zones, budget par postes sur une seule page.
- **Activité par ligne budgétaire** (liste déroulante) → **totaux par activité**
  (combien pour le suivi, le ciblage, etc.) en plus du total de l'accord.
- **Avenant = même processus qu'un nouveau contrat** : la page complète est
  préremplie avec le détail courant (partenaire, activités, zones, postes,
  dates, commission) ; on révise le tout, on ajoute une justification et un
  valideur, et l'avenant s'applique **intégralement** à l'approbation.
- **Export Excel** du budget au format du template FLA, **formules incrustées**
  (`= nb × coût`, sous-totaux `SUM`, commission `= direct × %`, Total de
  l'accord `= direct + commission`, barème mensuel `= total ÷ mois`).

## Interface — navigation, entête, thème, langue

- **Barre latérale gauche repliable** : navigation modules › sous-modules
  (groupés par domaine : Contractualisation, Suivi & planification, Pilotage,
  Administration). Le module actif ouvre ses sous-entrées ; les modules à venir
  sont grisés. Le bouton de l'entête **réduit / agrandit** la barre (mode rail
  icônes seules), état **mémorisé** par navigateur. Fil d'Ariane en entête,
  liens profonds (`#/tpm/affectation`).
- **Logo MEMS** (emblème + « MEMS 2.0 ») affiché sur la barre latérale et la
  page de connexion, dessiné en **SVG** (net à toute taille, thème clair/sombre,
  sans fichier externe). Il est centralisé dans `web/src/components/Logo.jsx` :
  pour utiliser le logo officiel, remplacez le SVG par une balise `<img>`
  pointant votre fichier — tous les emplacements suivent automatiquement.
- Entête épurée : **cloche de notifications** + **avatar** uniquement (le filtre
  « bureau » a été retiré).
- **Menu utilisateur** (clic sur l'avatar) : bascule **langue FR/EN**, bascule
  **thème clair/sombre**, accès Paramétrage, déconnexion.
- **Thème sombre** complet (jetons CSS redéfinis, tout le système suit),
  persistant par navigateur.
- **i18n** FR/EN de l'ossature (navigation, entête, menu) ; les pages se
  traduisent progressivement, module par module.

## Agents de terrain (hors Paramétrage)

La saisie des **agents** d'un TPM se fait dans **Partenaires & TPM ›
Prestataires TPM** (vue opérationnelle), pas dans Paramétrage. Paramétrage ne
sert qu'à créer les partenaires (nom + type).

## Rapports & dépenses TPM (assignation des dépenses)

L'assignation des dépenses ne se fait plus dans le module Contrats mais dans
**Partenaires & TPM › Rapports & dépenses** : chaque mois, un prestataire TPM
produit des rapports **financiers** (montant justifié) et **techniques**,
rattachés au budget mensuel planifié de la ligne « Suivi » du contrat, à
faire **avant le rapportage**. Les rapports financiers **validés** alimentent
la consommation du budget Suivi/TPM du contrat. Les fichiers ne sont pas
encore stockés (métadonnées d'abord : nom du document + référence) ; l'upload
réel viendra ensuite.

Ces événements passent par le **transactional outbox** déjà en place, donc
un rapport validé ne peut jamais être perdu ni comptabilisé deux fois.

## Contrats — interaction liste

Dans la **liste des contrats**, sélectionner une ligne (bouton radio ou clic)
fait apparaître une **barre d'actions** — Ouvrir / Éditer / Soumettre /
Valider / Rejeter / Amender / Renouveler / Résilier — filtrée selon le statut
et le rôle. Cliquer sur le **nom** du partenaire ouvre la **fiche détaillée**.

## Contrats — liste professionnelle, import Excel, comparatif d'avenants

Trois améliorations pensées pour un usage quotidien, même par un profil
novice, en s'inspirant (sans les copier) des écrans COMET / WFP :

- **Liste repensée** : bandeau d'indicateurs (contrats actifs, budget engagé,
  Suivi/TPM justifié, contrats à traiter), **barre d'actions** contextuelle,
  **tableau dense triable** (clic sur l'en-tête de colonne) avec barre de
  progression Suivi/TPM et statut coloré, **pagination** et **export CSV** de
  la sélection courante. On sélectionne une ligne d'un simple clic et on
  **double-clique** pour ouvrir la fiche.
- **Barre de filtres compacte, une seule icône** : une barre en ligne
  (Recherche, Statut, Activité…) avec, à droite, **deux icônes**. La première
  (curseurs, avec un compteur des filtres actifs) ouvre **« Filtres à
  afficher »** : une liste à cocher qui **active ou désactive** chaque filtre
  d'un seul geste — **seuls les filtres cochés sont visibles** dans la barre et
  s'appliquent ; les autres sont masqués (leur valeur est conservée si on les
  réactive). La seconde (disquette) **enregistre / rappelle les vues** — un jeu
  de filtres nommé, **permanent** (conservé d'une session à l'autre) ou
  **temporaire** (cette session uniquement).
- **Import du budget FLA (Excel)** : dans le formulaire de contrat (ou
  d'avenant), le bouton **« Importer depuis Excel »** lit votre fichier FLA
  (`.xlsx`) et **remplit automatiquement les postes** (description, nb unités,
  coût unitaire) et la commission de gestion, en lisant les feuilles
  « Détails Section … ». Vous ajustez ensuite à l'écran. *(Vérifié sur le
  fichier AINA : 15 postes, commission 7 %, total direct 41 164 000 Ar,
  identiques à la source.)*
- **Vue d'ensemble + comparatif avenant par avenant** : la fiche contrat
  ouvre sur une **synthèse** (identité, période, plafond, barème mensuel,
  budget Suivi/TPM, zones, consommation). L'onglet **Avenants** liste les
  avenants dans un **tableau** (n°, date, statut, résumé de ce qui a changé,
  justification) ; on **clique une ligne** pour la déplier et voir le détail
  complet **« Ce qui a changé »** (avant → après) sur les dates, la commission,
  le total de l'accord, les **zones** ajoutées / retirées et les **postes**
  modifiés / ajoutés / retirés — pour contrôler précisément l'évolution depuis
  le contrat initial. Les avenants à l'ancien format restent lisibles
  (rétro-compatibilité).

## Design — interface moderne, claire, thème clair/sombre

Direction **« Cockpit »** : barre latérale sombre bleu nuit + contenu clair,
accent **bleu électrique**, typographie **IBM Plex** (Sans + Mono pour les
chiffres), rendu **flat**. KPI à liseré d'accent et chiffres mono, tableaux
denses à chiffres tabulaires. Survols et micro-interactions discrets, entête
translucide, **barre latérale repliable**, page de **connexion centrée** sur
une seule carte, et **parité complète en thème sombre**. Le tout respecte
`prefers-reduced-motion`.

## Module Contrats (cœur transactionnel)

Deuxième module livré, conforme à la spécification et à la maquette.
Toute donnée de contrat naît ici ; les autres modules réagissent à ses
événements sans jamais modifier ses données.

- **Cycle de vie** : brouillon → en validation → actif → (résilié), plus
  rejet/correction. Numérotation interne automatique par bureau et par
  année (`CTR-2026-0001`), et identifiants réels FLA / PO / Vendor.
- **Séparation des tâches** : la soumission désigne un valideur, qui doit
  être une autre personne ; seul ce valideur peut approuver ou rejeter.
- **Budget par postes** (5 sections officielles + commission de gestion →
  Total de l'accord). Le suivi TPM est **cumulatif** : budget Suivi −
  rapports financiers validés. Un budget dépassé fait passer le contrat en
  « Avenant requis ».
- **Consommation** : alimentée par les rapports financiers **validés** du
  module Rapports & dépenses, jamais saisie directement — impossible qu'elle
  diverge de ses sources.
- **Avenants** : modifient la date de fin et/ou le taux de commission de
  gestion (donc le plafond), avec le même circuit de validation ; un seul
  avenant en cours à la fois.
- **Renouvellement** : uniquement dans les 90 jours avant l'échéance ; crée
  un contrat lié, en brouillon.
- **Résiliation** : motif obligatoire, verrouille le contrat.
- **Historique immuable** : qui / quand / quoi / pourquoi, en append-only
  (droits SQL retirés au rôle applicatif).
- **Fiabilité inter-modules** : les événements (`ContratActivé`,
  `ContratModifié`, `ContratRésilié`) sont écrits dans la **même
  transaction** que le changement (pattern *transactional outbox*), puis
  publiés de façon asynchrone par le worker — un événement ne peut être
  ni perdu, ni émis pour un changement annulé. Livraison « au moins une
  fois » ; les consommateurs (Planning, Reporting, Alertes) se brancheront
  au fur et à mesure.
- **Concurrence** : verrouillage optimiste par `version` — deux
  utilisateurs ne peuvent pas s'écraser mutuellement.

L'interface privilégie des **tableaux à plat** (les postes budgétaires et les
agents s'affichent directement, sans accordéon à déplier), avec une fiche
détaillée à onglets (détail budgétaire, avenants, historique).

## Ce que couvre ce module

- **Partenaires & TPM** : les partenaires (nom + type) et leurs agents sont
  gérés depuis Paramétrage ; ce module opérationnel affiche la liste des TPM
  et leurs agents rattachés.
- **Rapports & dépenses** : chaque mois, un prestataire TPM produit des
  rapports financiers (montant justifié) et techniques, rattachés au budget
  mensuel planifié de la ligne Suivi.
- **Consommation du budget Suivi** : recalculée à partir des rapports
  financiers **validés**, jamais écrite directement par l'API — impossible
  qu'elle diverge de ses données sources.

## Ce que ce module ne couvre pas (volontairement)

- Aucune fonctionnalité de MEMS n'a été copiée telle quelle : l'architecture
  ci-dessus s'en inspire (isolation multitenant, rôles, workflow en étapes)
  mais le domaine, les écrans et les règles métier sont ceux de notre
  cahier des charges, pas ceux de MEMS.
- Les 11 autres modules de la maquette (Contrats, Planification & budget,
  Carte des sites, Risk-Based Monitoring, etc.) restent à construire de la
  même façon, module par module, sur ce même socle.

## Arborescence

```
mems2-tpm/
├── docker-compose.yml
├── server/                    # API + worker (Node/Express/PostgreSQL/BullMQ)
│   ├── src/
│   │   ├── config/            # db (pool + RLS), redis, logger
│   │   ├── db/
│   │   │   ├── migrations/    # 001 schéma+RLS … 007 budget par postes, 008 découpage admin+zones, 010 formations, 011 évaluations, 012 rôle applicatif mems2_app
│   │   │   ├── migrate.js
│   │   │   └── seed.js
│   │   ├── jobs/               # file BullMQ + worker + processor
│   │   ├── middleware/         # auth, erreurs, asyncHandler
│   │   ├── modules/
│   │   │   ├── auth/
│   │   │   ├── contracts/      # contrats + budget par postes (domain, service, repo)
│   │   │   ├── settings/       # types de partenaire, activités, partenaires
│   │   │   └── tpm/            # affectation + rapports & dépenses
│   │   ├── app.js
│   │   └── server.js
│   └── test/
└── web/                        # interface React (Vite)
    └── src/
        ├── api/client.js
        └── pages/
```
