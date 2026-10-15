# Mesures de performance (branche `wip/perf`)

Retours 61 / 84 (« MEMS est lent ») puis « MEMS est très lent s'il y a beaucoup de
choses à faire en tâche de fond ». Ce fichier garde les mesures avant / après de
chaque lot, la méthode pour les refaire et ce qui reste lent.

**Banc** : 4 cœurs, 16 Go, PostgreSQL local, base `perf_db` (copie de la base de
démonstration : 2 560 sites, 19 370 localités, 15 378 visites, 3 fiches dont la
fiche GD à 480 colonnes, 4 496 soumissions). API sur :9723 (rôle `mems2_app`,
RLS active), Chromium piloté par Playwright. Les scripts de mesure sont hors dépôt
(dossier de travail de l'agent) ; la méthode est décrite pour pouvoir les refaire.

## 1. Lot 1 — écrans (publié sur `main`, 08a0b76)

### 1.1 Mode développeur ou version construite

Chaque route du balayage (`web/scripts/sweep-ecrans.cjs`) et les onglets d'une
fiche, médiane de deux passes : « calme » = plus de requête ni de tâche longue
pendant 500 ms ; tâches longues = somme des tâches > 50 ms.

| Mesure | `npm run dev` | version construite (`npm run serve`) |
|---|---:|---:|
| Premier chargement (F5) : écran calme | 1 505 ms | 484 ms |
| Premier chargement : octets reçus | 13,7 Mo | 635 Ko |
| Fiche GD › Données : calme / tâches longues | 8 242 ms / 5 959 ms | 1 390 ms / 31 ms |
| Fiche GD › Configuration | 1 807 ms | 1 036 ms |
| RBM › Plan de suivi | 2 616 ms | 1 464 ms |
| Paramétrage › Bureaux | 585 ms | 346 ms |
| Tas JS d'un écran ordinaire | 18–20 Mo | 6–8 Mo |

En mode développeur, React rend chaque écran deux fois (`StrictMode`) et chaque
requête part deux fois : la colonne « API » double. **Pour l'usage quotidien :
`cd web && npm run serve`** (nouveau script : construit puis sert la version
optimisée sur :5173 ; README › « Démarrer l'interface »).

### 1.2 Corrections (mode développeur, avant → après)

| Écran / geste | calme | tâches longues | données reçues |
|---|---:|---:|---:|
| Suivi de processus › Synthèse | 1 055 → 543 ms | 257 → 249 ms | 3,2 Mo → 32 Ko |
| Suivi de processus › Affectation & visites | 1 205 → 245 ms | 237 → 154 ms | 7,4 Mo → 10 Ko |
| Dashboard › Couverture | 824 → 271 ms | 79 → 0 ms | 3,2 Mo → 50 Ko |
| Carte : survol de 20 districts | 1 305 → 0 ms | 513 → 0 ms | — |
| RBM : saisie « amb » dans la recherche (INP~) | 208 → 80 ms | 376 → 117 ms | — |
| RBM : sélection d'une ligne (INP~) | 128 → 96 ms | 106 → 77 ms | — |

Les totaux RBM (« à suivre », « à jour », par risque) se lisent par
`GET /api/tpm/field/rbm/counts` au lieu de télécharger la liste des 2 560 sites ;
listes triées / filtrées mémorisées (`lib/dataList.js`) ; une visite modifiée est
remplacée sur place (`lib/fieldVisits.js`) ; couches de la carte mémorisées.

Serveur (médiane d'appels répétés, même base) : carte des districts 439 → 134 ms (1 mois) et
618 → 193 ms (12 mois) ; récapitulatif de couverture « sans période » 727 → 272 ms,
12 mois 631 → 203 ms ; synthèse terrain 123 → 64 ms ; `rbm/sites` 367 → ~140 ms.
Préflight CORS mis en cache 10 min (`maxAge: 600`).

### 1.3 Parité

30 réponses JSON complètes (RBM, visites, synthèses, carte, alertes, PDD,
couverture) capturées avant et après : **identiques** le même jour ; 6 cas de
`/rbm/counts` = décompte de l'écran. Une capture le lendemain ne diffère que par
le nombre de jours avant échéance des alertes (calendrier).

## 2. Lot 2 — réactivité pendant un travail lourd

### 2.1 Méthode

Pendant un travail lourd, trois requêtes légères (`/health`,
`/api/tpm/field/months`, `/api/settings/offices`) partent toutes les 200 ms ; on
relève leur durée (p50 / p95 / max), les échecs, et le retard de la boucle
d'événements de l'API (`perf_hooks.monitorEventLoopDelay`, lu sur
`GET /api/system/runtime`, réservé à l'administrateur). Fichier lourd : XLSX de
5 000 soumissions × 480 colonnes (10 Mo), importé dans une fiche neuve.

### 2.2 Ce qui bloquait (base)

- Lecture du classeur : **12,4 s sur le fil principal** (~1 Go de tas) — toute
  autre requête attend.
- Écriture : 5 000 insertions une par une (13,6 s).
- Réapplication des rattachements : l'index des lieux (19 370 localités) était
  reconstruit à chaque fois (~1 s bloquant).
- Effet visible : requêtes légères jusqu'à **8,7 s**, et des requêtes en échec
  (connexion coupée, 503) pendant l'import.

### 2.3 Étape A — lectures de fichiers hors du fil principal

`common/cpuPool.js` : pool de `worker_threads` (taille `min(2, cœurs − 1)`,
`CPU_POOL_SIZE`), file bornée (32, sinon 503 « réessayez »), délai maximal par
tâche (`CPU_TASK_TIMEOUT_MS`, 5 min ; le fil est remplacé), tampon transféré sans
copie, plantage ou mémoire dépassée → fil remplacé (413 si mémoire). Y passent :
lecture des soumissions (CSV, XLSX, `.sav`, `.zip` Kobo) pour la vérification et
l'import, définition XLSForm, découpage administratif (`.csv` / `.dbf` / `.zip`
shapefile). Mêmes règles et mêmes refus (les erreurs gardent leur code HTTP).

Moyennes des passes (nombre entre parenthèses) :

| Scénario | Étape | Durée du travail | Requête légère p50 | p95 | max | Échecs | Retard de boucle max |
|---|---|---:|---:|---:|---:|---:|---:|
| Import XLSX 5 000 × 480 | base (2) | 34,6 s | 199 ms | 6,8 s | 8,7 s | 37 | 5,9 s |
| Import XLSX 5 000 × 480 | A (2) | 29,9 s | 22 ms | 89 ms | 941 ms | 0 | 960 ms |
| Vérification XLSX 5 000 × 480 | base (1) | 13,2 s | 2,3 s | 5,3 s | 6,3 s | 0 | 4,6 s |
| Vérification XLSX 5 000 × 480 | A (1) | 15,0 s | 24 ms | 62 ms | 118 ms | 0 | 127 ms |
| Réapplication du mapping (fiche GD) | base (1) | 2,5 s | 31 ms | 861 ms | 937 ms | 0 | 894 ms |
| Réapplication du mapping (fiche GD) | A (1) | 2,2 s | 69 ms | 934 ms | 963 ms | 0 | 844 ms |
| Au repos | base (1) | — | 17 ms | 65 ms | 91 ms | 0 | 50 ms |
| Au repos | A (1) | — | 16 ms | 51 ms | 57 ms | 0 | 21 ms |

Parité : même résultat d'import (5 000 reçues, 5 000 créées, 480 champs) ; test
`cpuPool.test.js` : lecture par le pool = lecture directe.

Reste après A : l'écriture des 5 000 lignes et la réapplication des rattachements
tiennent encore la requête 30 s et bloquent la boucle ~1 s (index des lieux).

### 2.4 Étape B — tâches de fond (en cours)

Import des soumissions en tâche (`app_jobs`, migration 081) : la requête répond
202 avec l'identifiant de la tâche, le travail tourne dans l'API (sans Redis),
une tâche à la fois par compte, deux au plus ; les tâches n'occupent pas plus
d'un tiers des connexions PostgreSQL (`JOBS_DB_SLOTS`) ; écriture groupée par
500 lignes ; index des lieux mémorisé tant que les localités ne changent pas.
Prototype : réponse en 169 ms, tâche 20,4 s, requête légère p50 15 ms / p95
134 ms, retard de boucle max 851 ms (avant le cache de l'index des lieux). Mesures
définitives à reporter ici.

## 3. Ce qui reste lent

- Fiche GD › Données : `submissions?limit=1000` renvoie 6,3 Mo (25 400 nœuds DOM) —
  tableau retravaillé par une autre session.
- RBM › Plan de suivi : 3,2 Mo (`plan-board`) — retravaillé par la session principale.
- Paramétrage › Localités › Sites : 82 000 nœuds DOM — retravaillé par la session principale.
- Fiche GD › Configuration : `/variables` 485 ms et `/template` 428 ms.
- `offices/communes` : 246 ms.
