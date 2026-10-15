# Multi-pays — Siège, bureaux régionaux, bureaux pays (retour 91)

> « Vu que ce sera multi-pays et qu'il y a des headquarter > bureau régional (combinaison de plusieurs pays) > bureau pays (pays). »
> Capture jointe : Paramétrage › Localités › Pays & découpage (un seul pays : MADAGASCAR, ISO MDG, devise MGA, niveaux Région / District / Commune / Fokontany).

- **Statut** : conception seulement. Rien n'est implémenté. Aucune base n'a été modifiée.
- **Date** : 14/10/2026. Base de travail : `main` (`9e9e018`).
- **Migrations réservées** : `082` à `085`. La session principale les inscrit dans `docs/REPRISE.md` § 4.
- **Décision demandée** : valider l'option A (§ 2.3) et répondre aux 5 questions du § 10.

---

## 0. La décision en dix lignes

1. **Un bureau pays reste un tenant.** Son découpage adm1–adm4, sa devise, son MMR, ses contrats et ses données ne bougent pas.
2. **Un arbre d'organisation s'ajoute au-dessus des tenants** : Siège → bureaux régionaux → bureaux pays. Les bureaux de terrain et antennes (`field_offices`) restent dans le pays.
3. **Chaque nœud de l'arbre est un espace de travail (un tenant).** Le Siège et chaque bureau régional ont donc leurs utilisateurs, leurs modèles de rapport et leur journal, protégés par la même RLS.
4. **Une personne = une identité** (e-mail + mot de passe), membre d'un ou plusieurs espaces, avec un rôle par espace.
5. **Lire plusieurs pays ne change pas la RLS.** Chaque lecture d'un pays reste une transaction de ce seul pays. Elle est ouverte en **lecture seule** (`BEGIN READ ONLY`). La base vérifie elle-même que la personne a le droit de lire ce pays.
6. **Écrire dans un pays exige d'en être membre.** Un bureau régional ou le Siège ne fait que lire.
7. **Consolidation en USD.** Chaque montant est converti au taux de son mois et de son pays, puis les centimes sont additionnés. Un pays sans taux rend le total « partiel », jamais faux.
8. **Les calculs existants sont réutilisés pays par pays.** Des règles d'agrégation pures et testées les combinent.
9. **Un sélecteur d'espace dans l'en-tête** permet de changer de pays ou de consulter un pays en lecture seule.
10. **Livraison en 9 étapes**, chacune vérifiable, sans rupture pour l'installation actuelle à un seul pays.

---

## 1. Modèle actuel et ses limites

### 1.1 Un tenant = un bureau pays

| Élément | Où | Portée |
|---|---|---|
| `tenants (id, name, created_at)` | migration 001 | Aucune hiérarchie. Pas de RLS (noms seulement). |
| `users` : `UNIQUE (tenant_id, email)`, rôle `admin` / `manager` / `viewer` | 001, 026 | Un compte appartient à un seul tenant. |
| `country_profiles` (nom, ISO3, devise, centre, option des codes Adm) | 041, 067 | Un profil par tenant. ISO3 et devise **facultatifs** (NULL dans la base de démo). |
| `admin_levels`, `admin_areas` (adm1–adm4, P-codes, lignée) | 008, 041, 042 | Découpage par tenant. P-code unique par tenant. |
| `exchange_rates (usd_rate = « ariary pour 1 USD »)` | 023 | Taux par tenant et par mois. |
| `field_offices` (`nature` `pays` / `terrain`, antennes) | 024 | Bureaux de terrain **dans** le pays. |
| Contrats, TPM, plans, factures, sites, visites, RBM, MMR, suivi de processus, PDD, carte, concepteur | toutes les autres tables | Tout est par tenant. |

### 1.2 L'isolation aujourd'hui

- **55 tables sur 57** ont la RLS. Les deux autres sont `tenants` et `schema_migrations`.
- Une seule politique, `tenant_isolation`, `FOR ALL` : `tenant_id::text = current_setting('app.tenant_id', true)`. Sans `WITH CHECK`, elle vaut aussi pour les écritures.
- `withTenantTransaction` (`server/src/config/db.js`) pose `app.tenant_id` pour la transaction. Chaque requête filtre aussi `tenant_id = $1`. On compte 183 appels dans 19 fichiers et environ 535 filtres `tenant_id = $1`.
- `trg_same_tenant` (migration 049) est posé sur 39 tables. Il refuse une référence vers un autre tenant.
- L'API se connecte en `mems2_app` (`NOSUPERUSER NOBYPASSRLS`). Le rôle `mems_app` n'est jamais touché.
- Trois fonctions `SECURITY DEFINER` seulement : `auth_lookup_user`, `outbox_claim`, `outbox_mark_published`.
- Le tenant vient **seulement** du jeton (`middleware/auth.js` : `req.auth.tenantId`).

### 1.3 Ce qui casse avec plusieurs pays

| Problème | Où | Effet |
|---|---|---|
| Connexion par e-mail seul, première ligne prise | `auth.routes.js:34-35` (`rows[0]`) | Même e-mail dans deux pays : le pays ouvert est pris au hasard. |
| Un jeton = un seul tenant | `middleware/auth.js:11` | Impossible de lire deux pays, ni de changer de pays sans se reconnecter. |
| Pas de hiérarchie | `tenants` | Ni Siège, ni bureau régional, ni périmètre. |
| Pas de rôle régional | `users.role` | Pas de « lecture des pays de ma région ». |
| Devise codée en dur | au moins 34 « Ar » dans 10 fichiers web ; formats `"Ar"` de `factureXlsx.js:17`, `budgetXlsx.js:13`, `postesXlsx.js:17` ; `currencyMath.js` parle d'ariary | Un 2ᵉ pays afficherait ses montants en « Ar ». |
| ISO3 et devise facultatifs | `country_profiles` | Consolidation impossible tant qu'ils manquent. |
| Un seul jeu de contours | `map.service.js:5`, `map.repository.js:20` (`mdg-adm2.v1`), `web/public/geo/` | Carte vide pour un autre pays. |
| Référentiels par défaut posés une seule fois | boucle de la migration 005, `seed.js` | Un pays créé plus tard n'a ni activités ni types de partenaire. |
| Tableaux de bord, alertes, concepteur | `req.auth.tenantId` partout | Aucune vue multi-pays. |
| « Aujourd'hui » en UTC | `alerts.service.js:23` | Acceptable (calcul au mois). À revoir si un pays est loin de l'UTC. |

---

## 2. Modèle d'organisation cible et options

### 2.1 Organisation cible

```
Siège (hq)                               un seul
├── Bureau régional A (regional)         regroupe plusieurs pays
│   ├── Bureau pays Madagascar (country) = tenant d'aujourd'hui : découpage, devise, MMR, contrats, données
│   │   ├── Bureau de terrain Toliara    field_offices (nature 'terrain'), inchangé
│   │   │   └── Antenne …                field_offices.parent_id, inchangé
│   └── Bureau pays …
└── Bureau régional B
    └── …
```

- Un pays appartient à **un seul** bureau régional (hypothèse H1, § 10).
- Un pays peut être rattaché directement au Siège, ou rester **autonome** (sans parent). L'installation actuelle devient un pays autonome. Rien ne change pour elle.
- `field_offices.nature = 'pays'` désigne le périmètre national **à l'intérieur** du pays. Ce n'est pas le nœud de l'arbre. Le nom reste.

### 2.2 Trois options comparées

| Critère | **A. Tenant = bureau pays, arbre au-dessus** | **B. Tenant = organisation, `country_id` partout** | **C. Hybride : A + entrepôt d'agrégats** |
|---|---|---|---|
| Isolation (la RLS reste le filet) | Intacte. Une transaction = un pays. La lecture d'un autre pays est vérifiée par la base. | À refaire. Il faut un 2ᵉ réglage « pays » et 55 politiques réécrites. Un filtre pays oublié n'est plus rattrapé. | Intacte. Seuls des agrégats sortent d'un pays. |
| Coût de migration | 4 migrations additives. Aucune table métier modifiée. Cœur touché : `db.js`, `auth`, `errors`. | 55 tables, ~535 filtres, 183 transactions. Les `UNIQUE (tenant_id, code)` sont à refaire (sites, n° de contrat, P-codes). Bascule en une fois. | Coût de A, plus une table de faits et des tâches du worker. |
| Performance multi-pays | N transactions en parallèle limité (4), avec cache. | Une requête SQL par écran. | Lecture immédiate, mais données en retard. |
| Reporting | Réutilise les calculs de chaque écran, pays par pays. Agrégation par règles pures. | Toutes les requêtes sont à réécrire avec `GROUP BY pays`. | Deux chemins de calcul à garder identiques. |
| Découpage, devise, MMR par pays | Inchangés. | Doivent porter `country_id`. | Inchangés. |
| Réversibilité | Totale. Sans arbre, on revient à l'existant. | Faible. | Moyenne. |

### 2.3 Recommandation : option A

- **La sécurité ne baisse pas.** La politique `tenant_isolation` reste la seule politique des tables métier. On ajoute des contrôles. On n'en retire aucun.
- **Le coût est faible et progressif.** Aucune des 55 tables métier ne change. Chaque étape se livre seule.
- **Les chiffres restent justes.** Les tableaux multi-pays appellent les mêmes calculs que les tableaux pays. Il n'y a pas de 2ᵉ définition de la couverture ou du réalisé.
- **Un pays reste maître de son référentiel.** Découpage, devise, taux, MMR, bureaux de terrain.
- **La partie « entrepôt » de C est gardée en réserve.** On ne la construit que si la mesure du § 3.13 dépasse la cible.

---

## 3. Conception détaillée (option A)

### 3.1 Principe

- Chaque nœud de l'arbre (`org_units`) est lié à **un** tenant (`tenant_id UNIQUE`). Le nœud dit ce qu'est l'espace : `hq`, `regional` ou `country`.
- Les espaces `hq` et `regional` n'ont pas de données opérationnelles. Ils ont des utilisateurs, des modèles de rapport, des documents de rapport et leur journal.
- Les modules opérationnels (Contrats, TPM, PDD, Suivi de processus, Localités) ne répondent que dans un espace `country`.

### 3.2 Tables (vue d'ensemble ; SQL exact au § 4)

| Table | Portée | Rôle |
|---|---|---|
| `org_units` | globale | L'arbre : `kind`, `parent_id`, `code`, `name`, `tenant_id`, `iso3` et `currency` (pays), `lineage`, `active`. |
| `user_identities` | globale | Une personne : e-mail unique, mot de passe, actif. |
| `users` (+ `identity_id`) | par tenant | **L'appartenance** d'une identité à un espace, avec son rôle. Reste la cible des clés étrangères (`created_by`, `validator_id`…). |
| `org_access_log` | globale, append-only | Journal : connexions, changements d'espace, consultations, lectures multi-pays, changements de l'arbre. |
| `country_profiles` (+ `shape_set`) | par tenant | Identité locale du pays. ISO3 et devise passent dans `org_units`. |

Les tables globales n'ont pas de `tenant_id`. Elles ont quand même la RLS, avec des politiques propres (§ 4). `trg_same_tenant` ne les concerne pas.

### 3.3 Rôles par périmètre

Le rôle reste `admin` / `manager` / `viewer`. Ce qu'il permet dépend du type d'espace.

| Espace | Rôle | Dans son espace | Sur les pays de son périmètre |
|---|---|---|---|
| Bureau pays | admin / manager / viewer | Comme aujourd'hui | — |
| Bureau régional | admin | Utilisateurs de l'espace régional, modèles de rapport | Lecture : tableaux multi-pays et consultation (§ 3.5) |
| Bureau régional | manager | Modèles et documents de rapport régionaux | Idem |
| Bureau régional | viewer | Lecture | Idem |
| Siège | admin | Arbre de l'organisation, création des espaces, identités présentes dans plusieurs espaces, journal complet | Lecture de tous les pays |
| Siège | manager / viewer | Rapports / lecture | Lecture de tous les pays |

- **Périmètre** d'un espace régional ou du Siège = les pays actifs de son sous-arbre (`lineage`).
- **Aucune écriture dans un pays sans en être membre.** Une personne du bureau régional qui valide des contrats d'un pays reçoit une appartenance explicite à ce pays. Elle est visible et journalisée.
- Positions GPS des ménages : jamais hors du pays. En consultation, le rôle effectif est `viewer`, donc `seesPreciseGps` les retire déjà.

### 3.4 Lire plusieurs pays sans affaiblir la RLS

Trois mécanismes ont été évalués.

| Mécanisme | Principe | Pour | Contre | Verdict |
|---|---|---|---|---|
| **(1) Tableau de tenants dans un réglage + politique `= ANY`** | `app.read_tenants` + une politique `FOR SELECT … tenant_id = ANY(…)` sur chaque table | Une seule requête SQL agrège tous les pays | 55 politiques en plus. Toutes les requêtes passent de `tenant_id = $1` à `= ANY($1)`. Un oubli de filtre fuit vers tous les pays du périmètre. | **Plan B** si la mesure l'exige |
| **(2) Parcours pays par pays dans le service** | Pour chaque pays du périmètre, le dépôt existant est appelé dans **sa** transaction (un seul tenant), en lecture seule. Des fonctions pures fusionnent les résultats. | RLS inchangée. Calculs réutilisés tels quels. Isolation facile à prouver. Devise et découpage traités pays par pays. | N transactions. Il faut du parallélisme borné et un cache. | **Retenu** |
| **(3) Fonctions `SECURITY DEFINER` de lecture** | Une fonction par tableau, propriété du superutilisateur | Rapide | Contourne **toute** la RLS : un bogue fait fuiter tout. SQL dupliqué hors des dépôts. Une migration à chaque changement d'écran. | **Refusé** (sauf connexion et contrôle de droits, § 4) |

**Le mécanisme retenu (2), en détail**

1. `config/db.js` enrichit le contexte de requête existant (`queryContext`, déjà utilisé par `withQueryTimeout`) :
   - `readOnly: true` → `withTransaction` ouvre `BEGIN READ ONLY`. PostgreSQL refuse alors toute écriture (code `25006`).
   - `consultIdentity: <id>` → `withTenantTransaction`, juste après `set_config('app.tenant_id', …)`, exécute `SELECT mems_assert_read_scope($identité, $tenant)`. La fonction lève `42501` si la personne n'est ni membre de ce pays, ni membre d'un espace régional ou Siège au-dessus.
   - Nouvelle fonction `withConsult(identityId, fn)`. Elle **fusionne** avec le contexte courant. `withQueryTimeout` est corrigé pour fusionner aussi.
2. `modules/org/fanout.js` : `forCountries(auth, tenantIds, fn, { concurrency: 4, timeout: '15s' })`.
   - Chaque pays : `withConsult` + `withQueryTimeout` + appel du dépôt existant.
   - Un pays en échec rend `{ ok: false, raison }`. Il est affiché « pays indisponible ». Le total est marqué partiel.
3. Le périmètre est calculé **en base** à chaque requête (`mems_consult_targets`), jamais lu dans le jeton. Un retrait de droit vaut donc tout de suite.
4. Le gestionnaire d'erreurs central ajoute deux codes : `42501` → 403 « Accès refusé à ce pays » ; `25006` → 403 « Consultation en lecture seule ».
5. La politique `tenant_isolation` n'est pas modifiée. Chaque transaction ne voit qu'un pays, et la base a vérifié qu'elle en a le droit.

**Plan B (non construit)** — si un écran multi-pays dépasse la cible du § 3.13 malgré le cache :

```sql
CREATE POLICY scope_read ON <table> FOR SELECT
  USING (current_setting('transaction_read_only') = 'on'
         AND tenant_id = ANY (mems_read_tenants()));   -- réglage validé en base contre mems_consult_targets
```

Une politique `FOR SELECT` permissive s'ajoute (OU) aux lectures seulement. `INSERT`, `UPDATE`, `DELETE` et `SELECT … FOR UPDATE` restent soumis à `tenant_isolation`. La condition `transaction_read_only` la rend inopérante dans une transaction d'écriture. Ce plan prendrait un nouveau numéro de migration (086 ou plus).

### 3.5 Consulter un pays (lecture seule)

- Depuis l'en-tête, une personne d'un espace régional ou du Siège choisit « Consulter Madagascar ».
- Le serveur vérifie le droit en base (`mems_consult_targets`). Il émet un jeton : `tenantId` = le pays, `role = 'viewer'`, `mode = 'consult'`, `home` = l'espace d'origine.
- Tous les écrans pays existants fonctionnent **sans modification**.
  - Middleware `consultGuard` : toute méthode autre que GET est refusée (403), sauf une liste blanche de lectures en POST (`…/preview`, rendu du concepteur).
  - Toute la requête tourne dans `withConsult` : transactions `READ ONLY` et contrôle de droit en base.
- Un bandeau permanent s'affiche : « Consultation en lecture seule — Madagascar (MDG), depuis Bureau régional A · Revenir à mon espace ».
- Chaque requête de consultation est inscrite au journal (§ 3.11). L'inscription se fait **avant** la lecture, dans une courte transaction de l'espace d'origine. Si elle échoue, la requête est refusée.

### 3.6 Consolidation des devises

- **Devise de consolidation : USD** (question Q2).
- La devise d'un pays est `org_units.currency`. Elle est fixée par le Siège, et par le pays lui-même tant qu'il est autonome.
- **La devise ne change plus** dès que le pays a un montant enregistré (contrat, plan ou facture). Un déclencheur le garantit (§ 4, 082).
- `exchange_rates.usd_rate` = unités de la devise du pays pour 1 USD. Le sens est inchangé. Seul le commentaire change.
- Un pays dont la devise est `USD` a un taux implicite de 1.
- **Règle de conversion** (déjà testée : `currencyMath.sumUsdCents`) :
  - chaque montant mensuel est converti au taux de **son** mois et de **son** pays (`pickRate` reporte le dernier taux connu, jamais vers le passé) ;
  - il est arrondi au cent ;
  - les centimes sont additionnés : d'abord par pays, puis entre pays.
- **Taux manquant** : le total USD du pays vaut `null`. Le total multi-pays rend `{ totalUsdCents: null, convertedUsdCents, partial: true, missing: [{ iso3, months }] }`. L'écran affiche « Total partiel — 1 pays sans taux (XDM : mars–avr.) ». Jamais de total silencieusement incomplet.
- La conversion multi-pays se fait **côté serveur**, jamais dans le navigateur. `web/src/lib/currency.js` reste pour l'écran d'un seul pays.
- Les montants PDD « Cash (USD) » sont déjà en USD. Ils ne sont pas convertis.
- Écrans pays : la devise vient du profil (`useCurrency()`). Le « Ar » codé en dur disparaît. Exports Excel : format `#,##0 "<devise>"`.

### 3.7 Tableaux de bord multi-pays

**Règles d'agrégation** (module pur `org/multiCountry.js`, testé) :

| Mesure | Règle entre pays |
|---|---|
| Montants | USD, § 3.6 |
| Comptes (sites, visites, soumissions, alertes) | Somme |
| Taux (couverture des sites, exécution du plan, consommation du budget) | Σ numérateurs ÷ Σ dénominateurs. **Jamais** la moyenne des taux. |
| Indices et scores (conformité, indice d'activité) | Par pays, avec médiane et min–max. **Pas** d'indice global. |
| Indicateurs | Comparés seulement s'ils ont le même `template_code` (migration 055). Les autres sont « non comparables ». |
| Activités | Regroupées par code d'activité commun. Les autres vont dans « Autres ». |
| Période | Même plage pour tous les pays. Par défaut : le dernier mois où au moins un pays a des données. Le bandeau nomme les pays sans données. |
| Niveaux du découpage | Chaque pays garde ses libellés (Région / Province…). En multi-pays, la ventilation est **par pays**. |

**Écrans de l'espace régional ou Siège**, avec un **sélecteur de périmètre** (bureau régional, pays, choix multiple) à côté du sélecteur de période :

| Nouvel écran | Reprend | Source pays par pays | Comparaison |
|---|---|---|---|
| Vue d'ensemble multi-pays | `DashboardBIPage` | `consolidation.repository.consolidation` | Tuiles USD ; barres Budget / Planifié / Réalisé par pays ; consommation par pays ; tendance mensuelle USD ; alertes par pays |
| Budget consolidé | `ConsolidationPage` | idem | Tableau pays → contrats ; USD et devise locale ; matrice mensuelle par pays |
| Suivi de processus | `ProcessDashboardPage` + `DashboardCoveragePage` | `monitoring.repository.processOverview`, `coverageDashboard` | Couverture (sites), exécution du plan (visites), données versées, sites à suivre (RBM), conformité par pays |
| Alertes | `AlertsPage` | `alerts.service.alerts` | Nombre par niveau et par pays ; un clic ouvre le pays en consultation |
| Carte multi-pays | § 3.9 | `map.repository.districtData` | Contours des pays colorés |

Écrans **pays seulement**, accessibles en consultation : Contrats, Partenaires & TPM, PDD, Données & indicateurs, Affectation & visites, RBM, Couverture par bureau de terrain, Paramétrage du pays.

### 3.8 Concepteur de rapport

- Les modèles et documents d'un espace régional ou Siège sont rangés dans **son** tenant (`report_templates`, `report_documents`). Ils sont donc protégés par la RLS.
- Le catalogue marque chaque jeu de données `scope: 'country' | 'org' | 'both'`. Dans un espace régional, seuls `org` et `both` sont proposés.
- Une source multi-pays enveloppe une source existante (`reports/sources`). Elle appelle `load(tenantPays, …)` via `forCountries`, ajoute les colonnes `pays` et `iso3`, convertit les colonnes `money` en USD et applique les règles du § 3.7.
- Un chiffre clé de type ratio n'est proposé en multi-pays que s'il expose numérateur et dénominateur.
- La clé de cache (`memo`) inclut la liste triée des pays du périmètre.

### 3.9 Carte

- **Dans un pays** : la carte actuelle ne change pas. Le jeu de contours vient de `country_profiles.shape_set` (migration 085), plus d'une constante.
  - Registre `server/src/modules/map/shapes/index.js` : `shape_set` → fichier.
  - Fichiers `web/public/geo/<iso3>-adm2.vN.json`. Même source (geoBoundaries, CC BY 4.0) et même allègement que `mdg-adm2.v1`.
  - Pays sans contours : points et centres seulement, avec un message.
- **Multi-pays** : un fichier allégé des frontières de pays, `web/public/geo/adm0.v1.json`, clé ISO3. Chaque pays est coloré par un thème : couverture, consommation ou alertes. Un clic ouvre la carte du pays en consultation.
- Pas de contours de districts de plusieurs pays sur une même carte au départ. Le volume serait trop lourd et les niveaux ne se comparent pas.

### 3.10 Connexion et changement d'espace

1. `POST /api/auth/login` (e-mail, mot de passe) → `auth_lookup_identity` → bcrypt → `auth_workspaces`.
   - **Un seul espace** : jeton direct. C'est le comportement d'aujourd'hui.
   - **Plusieurs** : réponse `{ needsWorkspace: true, pickToken, workspaces }`. Le `pickToken` vaut 5 minutes et ne sert qu'à choisir.
2. `POST /api/auth/workspace { tenantId }` avec le `pickToken` → jeton de l'espace. Le navigateur retient le dernier espace (`localStorage`, confort seulement).
3. En-tête : `GET /api/auth/workspaces` → `{ current, memberships, consult: [{ regional, countries }] }`.
4. `POST /api/auth/switch { tenantId, mode: 'member' | 'consult' }` → nouveau jeton. Le droit est revérifié en base. 403 sinon. L'opération est journalisée.
5. **Jeton v2** : `{ sub, idn, tenantId, role, kind, mode, home?, v: 2 }`.
   - En mode `member`, `sub` est la ligne `users` du tenant.
   - En consultation, `sub` est celle de l'espace d'origine. Aucune écriture n'est possible, et `trg_same_tenant` refuserait de toute façon.
   - Les jetons v1 restent acceptés jusqu'à leur expiration (8 h), comme membres d'un pays.

### 3.11 Journal des accès

- `org_access_log`, append-only : `mems2_app` n'a que `SELECT` et `INSERT`. Même méthode que `document_deletions` (065).
- Une ligne par connexion, changement d'espace, requête de consultation, lecture multi-pays (avec la liste des pays) et changement de l'arbre ou d'une identité.
- Qui lit quoi (RLS) :
  - un pays voit les lignes qui le visent : « qui a consulté ce pays » ;
  - un espace voit ses propres lignes ;
  - le Siège voit tout.
- Écran : Paramétrage › Journal des accès, dans chaque espace.

### 3.12 Paramétrage : Localités par pays, Organisation au Siège

- **Localités › Pays & découpage reste par pays.** Le nom affiché, le centre, la note, les niveaux adm1–adm4, l'import du découpage, l'option des codes Adm, les sites, les rapprochements et les contours ne changent pas.
- **ISO3 et devise** passent en lecture seule quand le pays est rattaché à un Siège, avec la mention « Géré par le Siège ». Une ligne « Rattachement : Bureau régional A · Siège » s'ajoute. Un pays autonome les modifie comme aujourd'hui.
- **Paramétrage › Organisation** (espace Siège, admin) :
  - arbre Siège → régions → pays ;
  - créer un bureau régional ;
  - créer un bureau pays : nom, ISO3, devise, bureau régional, premier administrateur ;
  - déplacer un pays ;
  - désactiver un espace (jamais de suppression) ;
  - **état de chaque pays** : devise renseignée, taux du mois présent, découpage importé, contours, date des dernières données.
- **Créer un bureau pays** se fait en une transaction (`org.repository.createWorkspace`) :
  1. sous l'espace Siège : `tenants` + `org_units` ;
  2. puis `set_config('app.tenant_id', <nouveau>)` : profil pays, niveaux par défaut, **référentiels par défaut** (`seedTenantDefaults`, extrait de la migration 005 et de `seed.js`, partagé), appartenance du premier admin.
  - Chaque écriture passe donc la politique de **son** tenant. C'est la seule écriture multi-tenant autorisée. Elle est réservée à l'admin du Siège et journalisée.
- **Créer le Siège** ne passe jamais par l'API. On utilise le script `npm run org:init -- --name "Siège" --admin <e-mail>`, lancé en superutilisateur.

### 3.13 Performance

- **Mesure de référence** : 1,6 à 2 s par pays pour 12 à 24 mois (`REPRISE.md` § 6, chantier I).
- **Parallélisme** : 4 pays à la fois, sur des clients différents (jamais `Promise.all` sur un même client). Un sémaphore (`reports/semaphore.js`) limite à 2 lectures multi-pays par processus, donc 8 connexions au plus sur `PG_POOL_MAX` = 20.
- **Cache** par processus : clé (écran, pays, paramètres), durée de vie 120 s, 500 entrées. « Actualiser » le contourne. L'écran affiche « Données à HH:MM ».
- **Cibles** : 10 pays × 12 mois en moins de 3 s sans cache et en moins de 300 ms avec cache. Au-delà de 3 s mesurées : partie C (table de faits mensuels par pays, calculée par le worker via l'outbox), puis plan B.
- `statement_timeout` de 15 s par pays (`withQueryTimeout`). Un pays lent n'empêche pas les autres.

---

## 4. Migrations exactes

Toutes sont additives et idempotentes quand c'est possible. Elles sont essayées sur une base neuve **et** sur une copie de la base existante. Code d'erreur des déclencheurs : `23514` → 400. Fonctions `SECURITY DEFINER` : `SET search_path = public`, sorties minimales, `GRANT EXECUTE … TO mems2_app`. Aucune nouvelle référence entre deux tables à `tenant_id` : pas d'appel à `mems_install_same_tenant`.

### 082_org_units.sql — l'arbre

```sql
CREATE TABLE org_units (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL UNIQUE REFERENCES tenants(id) ON DELETE RESTRICT,
  kind       text NOT NULL CHECK (kind IN ('hq', 'regional', 'country')),
  parent_id  uuid REFERENCES org_units(id) ON DELETE RESTRICT,
  code       text NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9][A-Z0-9-]{1,19}$'),
  name       text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  iso3       text UNIQUE CHECK (iso3 IS NULL OR iso3 ~ '^[A-Z]{3}$'),
  currency   text CHECK (currency IS NULL OR currency ~ '^[A-Z]{3}$'),
  lineage    uuid[] NOT NULL DEFAULT '{}',
  active     boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (kind = 'country' OR (iso3 IS NULL AND currency IS NULL)),
  CHECK (kind <> 'hq' OR parent_id IS NULL)
);
CREATE UNIQUE INDEX uq_org_units_one_hq ON org_units (kind) WHERE kind = 'hq';
CREATE INDEX idx_org_units_parent  ON org_units (parent_id);
CREATE INDEX idx_org_units_lineage ON org_units USING gin (lineage);
```

- **Déclencheur `org_units_guard`** (BEFORE INSERT OR UPDATE) :
  - `kind` ne change jamais ;
  - un `regional` a pour parent le `hq` ;
  - un `country` a pour parent un `regional`, le `hq` ou personne (autonome) ;
  - pas de cycle : le parent ne peut pas être le nœud ni un de ses descendants ;
  - `lineage` = lignée du parent + parent ;
  - la devise ne change pas si `mems_tenant_has_amounts(tenant_id)` est vrai (fonction `SECURITY DEFINER` : existence d'un contrat, plan ou facture).
- **AFTER UPDATE OF parent_id** : recalcul de la lignée des descendants (CTE récursive, une requête).
- **Reprise** (exécutée en superutilisateur) : chaque tenant existant devient un `country` **autonome**. Valeurs reprises :
  - `name` = `COALESCE(country_profiles.name, tenants.name)` ;
  - `iso3` et `currency` = ceux du profil (NULL possibles : la base de démo les a vides) ;
  - `code` = ISO3, sinon `'P' || 8 premiers caractères hexadécimaux de l'id`.
- **RLS** sur `org_units` :
  - `org_read FOR SELECT USING (true)` : l'arbre (noms, codes) n'est pas secret dans l'organisation ;
  - `org_insert FOR INSERT WITH CHECK (mems_is_hq_session())` ;
  - `org_update FOR UPDATE USING / WITH CHECK (mems_is_hq_session() OR mems_is_autonomous_self(tenant_id))` ;
  - `REVOKE DELETE ON org_units FROM mems2_app`.
- **Fonctions** (`SECURITY DEFINER`, `STABLE`) :
  - `mems_is_hq_session()` : `app.tenant_id` est le tenant du `hq` actif ;
  - `mems_is_autonomous_self(t)` : `t` est le tenant courant **et** aucun `hq` n'existe. C'est le mode d'aujourd'hui, sans Siège.
- `country_profiles.iso3` et `currency` ne sont plus lus ni écrits par le code. Ils seront supprimés par une migration de nettoyage (étape 9).

### 083_user_identities.sql — une personne, plusieurs espaces

```sql
CREATE TABLE user_identities (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         citext NOT NULL UNIQUE CHECK (length(email) BETWEEN 3 AND 160),
  password_hash text NOT NULL,
  full_name     text CHECK (full_name IS NULL OR length(full_name) <= 160),
  active        boolean NOT NULL DEFAULT true,
  password_changed_at timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
```

- **Garde de reprise** : si un même e-mail a deux mots de passe différents dans deux tenants, la migration **s'arrête** et nomme les e-mails. Elle ne choisit jamais seule.
- **Reprise** : une identité par e-mail (`GROUP BY email`). Ensuite :
  - `users.identity_id uuid NOT NULL REFERENCES user_identities ON DELETE RESTRICT` ;
  - `UNIQUE (identity_id, tenant_id)` ;
  - `users.password_hash` est supprimée, une fois copiée. Le mot de passe n'existe plus qu'à un endroit.
- `users.email` reste une copie d'affichage. Un déclencheur `SECURITY DEFINER` la tient égale à l'e-mail de l'identité.
- **RLS et droits** sur `user_identities` :
  - `identity_read FOR SELECT USING (EXISTS (SELECT 1 FROM users u WHERE u.identity_id = user_identities.id))`. `users` est sous RLS : un pays ne voit que **ses** membres ;
  - `identity_update FOR UPDATE USING / WITH CHECK (mems_identity_editable(id))` : vrai si la session est le Siège, ou si **toutes** les appartenances de l'identité sont dans le tenant courant. Un admin pays ne peut donc pas changer le mot de passe d'une personne du Siège ;
  - `REVOKE ALL`, puis `GRANT SELECT (id, email, full_name, active, password_changed_at, created_at, updated_at)` et `GRANT UPDATE (full_name, active, password_hash, password_changed_at, updated_at)`. **L'application ne peut jamais lire un mot de passe chiffré.**
- **Fonctions** (`SECURITY DEFINER`) :
  - `auth_lookup_identity(email)` → `id, password_hash, active, full_name` (connexion seulement) ;
  - `auth_workspaces(identity)` → `tenant_id, user_id, role, kind, name, code, iso3` (appartenances actives, espaces actifs) ;
  - `mems_consult_targets(identity)` → `tenant_id, name, iso3, via_tenant_id` : pays actifs dont la lignée contient un espace `hq` ou `regional` où l'identité est membre active ;
  - `mems_assert_read_scope(identity, tenant)` → rien, ou `RAISE … ERRCODE '42501'` ;
  - `mems_identity_attach(email, full_name, hash)` → id. Crée l'identité si elle manque. Sinon, rend l'existante **sans toucher** à son mot de passe ;
  - `DROP FUNCTION auth_lookup_user(citext)`.

### 084_org_access_log.sql — journal des accès

```sql
CREATE TABLE org_access_log (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  at             timestamptz NOT NULL DEFAULT now(),
  identity_id    uuid NOT NULL REFERENCES user_identities(id),
  home_tenant_id uuid NOT NULL REFERENCES tenants(id),
  target_tenants uuid[] NOT NULL CHECK (cardinality(target_tenants) BETWEEN 1 AND 500),
  action         text NOT NULL CHECK (action IN ('login','switch','consult','fanout','org_change','identity_change')),
  route          text CHECK (route IS NULL OR length(route) <= 200),
  detail         jsonb CHECK (detail IS NULL OR pg_column_size(detail) <= 4096)
);
CREATE INDEX idx_org_access_home    ON org_access_log (home_tenant_id, at DESC);
CREATE INDEX idx_org_access_targets ON org_access_log USING gin (target_tenants);
```

- **RLS** :
  - `SELECT USING` : la ligne est lisible si `home_tenant_id` est le tenant courant, si le tenant courant figure dans `target_tenants` (comparaison en texte : un réglage vide ne provoque pas d'erreur de conversion), ou si la session est le Siège ;
  - `INSERT WITH CHECK (home_tenant_id::text = current_setting('app.tenant_id', true))`.
- `REVOKE UPDATE, DELETE ON org_access_log FROM mems2_app`.
- `COMMENT ON COLUMN exchange_rates.usd_rate IS 'Unités de la devise du pays pour 1 USD'`.

### 085_country_shape_sets.sql — contours par pays

```sql
ALTER TABLE country_profiles ADD COLUMN IF NOT EXISTS shape_set text
  CHECK (shape_set IS NULL OR shape_set ~ '^[a-z0-9-]{3,30}\.v[0-9]{1,3}$');
-- Comportement actuel conservé : tous les comptes existants dessinaient mdg-adm2.v1.
UPDATE country_profiles SET shape_set = 'mdg-adm2.v1' WHERE shape_set IS NULL;
```

- Les pays créés ensuite ont `shape_set` NULL, tant qu'un jeu du registre n'est pas choisi.
- `map_shape_links.shape_set` existe déjà (061). Rien à changer.

---

## 5. API

| Méthode et route | Qui | Nouveau ou changé |
|---|---|---|
| `POST /api/auth/login` | tous | Changé : identités ; `needsWorkspace` si plusieurs espaces |
| `POST /api/auth/workspace` | jeton de choix | Nouveau |
| `GET /api/auth/workspaces` | connecté | Nouveau : appartenances et pays consultables |
| `POST /api/auth/switch` | connecté | Nouveau : `member` ou `consult`, droit revérifié en base, journalisé |
| `GET /api/org/tree` | espace `hq` / `regional` | Nouveau : arbre ; état de chaque pays pour l'admin du Siège |
| `POST /api/org/units`, `PATCH /api/org/units/:id` | admin du Siège | Nouveau : créer, renommer, déplacer, désactiver ; devise figée dès qu'un montant existe (409) |
| `GET /api/org/scope` | `hq` / `regional` | Nouveau : pays du périmètre, pour le sélecteur |
| `GET /api/org/overview`, `/consolidation`, `/process`, `/alerts`, `/map` | `hq` / `regional` | Nouveau : `?from&to&scope=<orgUnitId>&countries=MDG,XDM` ; réponse `{ countries: [{ iso3, name, currency, status, … }], totals: { …, partial, missing }, generatedAt }` ; 403 hors périmètre |
| `GET /api/org/access-log` | admin de chaque espace | Nouveau : filtré par la RLS |
| `GET /api/settings/country` | pays | Changé : ISO3 et devise lus dans `org_units` ; ajout `org: { regionalName, hqName, managedByHq }` |
| `PUT /api/settings/country` | admin pays | Changé : ISO3 et devise refusés (400) si le pays est géré par un Siège |
| `POST /api/users` | admin | Changé : rattache une identité existante (`existing: true`) ou en crée une |
| `PATCH /api/users/:id` (mot de passe, actif) | admin | Changé : 403 pour une identité présente dans plusieurs espaces, sauf au Siège |
| Routes opérationnelles | — | Middleware `countryWorkspaceOnly` (403 dans un espace `hq` / `regional`) ; `consultGuard` en consultation |
| Gestionnaire d'erreurs | — | `42501` → 403 ; `25006` → 403 « lecture seule » |

Validation zod sur toutes les entrées. Le périmètre ne vient jamais du corps de la requête sans être recoupé en base.

---

## 6. Interface

| Écran ou composant | Changement |
|---|---|
| `LoginPage.jsx` | Étape « Choisir un espace » quand il y en a plusieurs : cartes groupées Siège / Bureaux régionaux / Bureaux pays ; dernier espace proposé d'abord. |
| `HeaderMenus.jsx` → `WorkspaceSwitcher` | À gauche de la cloche : « Madagascar · MDG », avec une icône par type. Menu : *Mes espaces* ; *Consulter un pays* (groupé par bureau régional, recherche) ; *Revenir à mon espace*. Caché si la personne n'a qu'un espace et rien à consulter. Accessible au clavier, FR et EN. |
| `AppShell.jsx` | Menu selon le type d'espace. Pays : inchangé. Régional ou Siège : *Vue multi-pays* (Vue d'ensemble, Budget consolidé, Suivi de processus, Carte, Alertes), *Reporting* (Concepteur), *Paramétrage* (Organisation [Siège], Utilisateurs, Journal des accès). Bandeau de consultation. Chaque nouvelle page est déclarée ici. |
| `components/ScopeSelect.jsx` | Sélecteur de périmètre (bureau régional, pays en choix multiple), état dans l'adresse comme `usePeriod`. |
| `pages/org/OrgOverviewPage.jsx`, `OrgConsolidationPage.jsx`, `OrgProcessPage.jsx`, `OrgAlertsPage.jsx`, `OrgMapPage.jsx` | Nouveaux (§ 3.7). Tableau par pays d'abord, puis graphiques. Mêmes couleurs de séries que les tableaux pays, vérifiées par l'outil de palette. « Total partiel » visible. Ligne « pays indisponible ». |
| `pages/settings/OrganisationSection.jsx`, `AccessLogSection.jsx` | Nouveaux (§ 3.11, § 3.12). |
| `LocalitiesSection.jsx` | ISO3 et devise en lecture seule si le pays est géré par le Siège ; ligne de rattachement. |
| Écrans pays (`ContractsListPage`, `DashboardBIPage`, `ConsolidationPage`, `PlanningPage`, `ReportsPage`…) | `useCurrency()` à la place de « Ar ». Bascule « devise locale / USD » libellée avec le vrai code. |
| `web/src/locales/en/*.js` | Tous les nouveaux textes en anglais. |

Marque neutre : « Siège », « Bureau régional », « Bureau pays ». Aucune mention « WFP » / « PAM ».

---

## 7. Livraison par étapes

Chaque commit se publie seul après tests, lint, build, balayage `node web/scripts/sweep-ecrans.cjs` et vérification indépendante. Le journal (`docs/JOURNAL.md`) est tenu à chaque commit.

| Étape | Commits | Vérification |
|---|---|---|
| **0. Décisions** | Réponses aux Q1–Q5 ; numéros 082–085 inscrits dans `REPRISE.md` | — |
| **1. Devise du pays** (sans migration) | 1a `useCurrency()` + suppression des « Ar » côté web ; 1b format des exports Excel selon la devise ; 1c `seed.js` pose MDG / MGA ; contrôle « devise non renseignée » dans la santé du paramétrage | Balayage : la démo affiche « Ar » via MGA ; un profil sans devise n'affiche plus de suffixe et la santé le signale |
| **2. Arbre** (082) | 2a migration + module pur `org/orgTree.js` (types, parents, cycles, lignée) ; 2b tests du fichier SQL | Base neuve et copie ; aucun changement visible |
| **3. Identités et connexion** (083) | 3a migration + `auth.routes` v2 (un seul espace = comme avant) ; 3b `users.repository` via les identités ; 3c étape de choix d'espace sur `LoginPage` | Les comptes de démo se connectent comme avant ; tests d'isolation des identités (§ 8) |
| **4. Consultation et journal** (084) | 4a `db.js` (`readOnly`, `consultIdentity`, fusion des contextes) + codes d'erreur ; 4b `/auth/workspaces`, `/auth/switch`, `consultGuard`, journal ; 4c `WorkspaceSwitcher` + bandeau ; 4d Journal des accès | Tests d'isolation ; balayage **en consultation** sans aucune erreur `25006` ; un utilisateur pays qui demande un autre pays reçoit 403, journalisé |
| **5. Organisation** | 5a `seedTenantDefaults` partagé (migration 005 et `seed.js`) ; 5b `org.routes` + `createWorkspace` ; 5c `OrganisationSection` + Localités en lecture seule ; 5d script `org:init` + démo : Siège, 1 bureau régional, Madagascar + « Pays démo » (codes ISO réservés `XDM` / `XTS`) | Création d'un pays de bout en bout : son admin se connecte et trouve ses référentiels par défaut ; balayage des 3 espaces |
| **6. Tableaux multi-pays** | 6a `org/fanout.js` + `org/multiCountry.js` (purs, testés) ; 6b routes `/api/org/*` ; 6c `ScopeSelect` + 4 pages ; 6d banc `npm run bench:org` (10 pays, 12 mois) | Tests ; banc conforme au § 3.13 ; la somme des pays égale le total ; balayage |
| **7. Carte multi-pays** (085) | 7a registre des contours + `shape_set` ; 7b `adm0.v1.json` + `OrgMapPage` | Carte de Madagascar identique (capture avant / après) ; carte régionale avec 2 pays |
| **8. Concepteur multi-pays** | 8a sources multi-pays + marquage du catalogue ; 8b clé de cache avec périmètre | Un modèle régional se calcule ; le cache ne mélange jamais deux périmètres |
| **9. Nettoyage** | Suppression de `country_profiles.iso3` / `currency` et de la lecture des jetons v1 (nouveau numéro de migration) | Base neuve et copie |

Les étapes 1 à 4 n'apportent rien de visible à une installation à un seul pays, sauf la devise. Elles peuvent être livrées sans attendre les réponses aux questions Q2, Q4 et Q5.

---

## 8. Tests

**Tests purs** (`npm test`) :
- `orgTree` : parent autorisé selon le type, cycle refusé, lignée, descendants, pays autonome.
- `orgScope` : pays lisibles à partir des appartenances et de l'arbre ; espace inactif exclu.
- `multiCountry` :
  - conversion pays par pays et mois par mois ;
  - taux manquant → `partial` et `missing` ;
  - USD à taux 1 ;
  - ratios recalculés (Σ num ÷ Σ dén) ;
  - aucun indice moyenné entre pays ;
  - indicateurs comparés par `template_code` seulement ;
  - somme des pays = total, au centime.
- Jeton : lecture v1 et v2 ; `consultGuard` (méthodes, liste blanche).
- Fichiers SQL 082–085 (même méthode que `mapMigration061.test.js`) :
  - RLS activée sur chaque nouvelle table ;
  - `REVOKE DELETE` / `UPDATE` présents ;
  - aucune colonne `password_hash` dans les droits accordés ;
  - chaque `SECURITY DEFINER` a `SET search_path`.

**Tests d'isolation en base** (nouveau `npm run test:db` : base jetable créée, migrée, connexion en `mems2_app`) :
1. Session du pays A : 0 ligne du pays B sur **chacune** des tables à `tenant_id`. La liste vient de `information_schema`, donc une table ajoutée plus tard est couverte d'office.
2. Session A : écrire une ligne de B est refusé (RLS) ; référencer une ligne de B est refusé (`trg_same_tenant`).
3. `mems_assert_read_scope` :
   - utilisateur du seul pays A vers B → `42501` ;
   - utilisateur régional de la région de B → accepté ;
   - même utilisateur vers C, hors de sa région → `42501` ;
   - espace désactivé → `42501`.
4. Transaction de consultation : `UPDATE` → `25006` ; `SELECT … FOR UPDATE` → refusé.
5. `user_identities` :
   - A ne voit pas une identité membre de B seulement ;
   - lire `password_hash` → `42501` (droit de colonne) ;
   - A ne peut pas changer le mot de passe d'une identité aussi membre du Siège ; le Siège le peut.
6. `org_units` :
   - écriture depuis un pays (avec un Siège existant) → refusée ;
   - depuis le Siège → acceptée ;
   - cycle → refusé ;
   - régional sous un pays → refusé ;
   - devise modifiée avec des montants → refusée ;
   - `DELETE` → refusé.
7. `org_access_log` : `UPDATE` / `DELETE` refusés ; A ne voit que les lignes qui le visent ou qui viennent de lui.
8. Contrôle global : toute table à `tenant_id` a la RLS et `tenant_isolation`. Aucune politique `FOR SELECT` supplémentaire n'existe tant que le plan B n'est pas décidé.

**Tests d'API** :
- changer vers un pays non autorisé → 403, et une ligne au journal ;
- POST en consultation → 403 ;
- `scope` hors du sous-arbre → 403 ;
- espace régional sur une route opérationnelle → 403.

**Balayage** : `sweep-ecrans.cjs` dans trois modes : admin pays, lecteur régional (écrans multi-pays), consultation d'un pays. Attendu : 0 erreur console ou API, 0 phrase anglaise manquante.

---

## 9. Risques

| Risque | Parade |
|---|---|
| Une lecture en GET écrit en cachette (réparation, cache…) : elle casse en consultation | Balayage en consultation ; `25006` → 403 lisible ; correction de chaque cas (la lecture ne doit pas écrire) |
| Restes « Madagascar » codés en dur (« Ar », contours, « Fokontany », fuseau) | Inventaire `grep` à l'étape 1 ; balayage avec « Pays démo » |
| Lenteur des tableaux multi-pays | Parallélisme borné, cache, délai par pays, banc à l'étape 6 ; partie C puis plan B si la mesure l'exige |
| Pool de connexions épuisé | Sémaphore : 2 lectures multi-pays × 4 pays par processus ; `PG_POOL_MAX` documenté |
| Reprise des identités (même e-mail, mots de passe différents) | La migration 083 s'arrête et nomme les e-mails |
| Total multi-pays faux faute de taux | `partial` + `missing` ; jamais de total silencieux ; état des taux dans Organisation |
| Indicateurs ou activités non comparables | Comparaison seulement sur les codes communs ; le reste est marqué « non comparable » |
| Fonctions `SECURITY DEFINER` (contournent la RLS) | Une dizaine de fonctions étroites, toutes listées au § 4 : sans SQL dynamique, `search_path` fixé, sorties minimales, tests dédiés |
| Retrait de droits | Le droit de consultation est revérifié en base à chaque transaction. Une appartenance pays garde son jeton jusqu'à 8 h, comme aujourd'hui. |
| Conflit avec les lots en cours (071–080) | Numéros 082–085 réservés ; les écrans multi-pays appellent les dépôts : ils suivent les changements des lots 3, 4 et 5 sans double travail |
| Accès d'un pays aux données d'un autre (droit local, protection des données) | Lecture seule, agrégats, GPS des ménages jamais hors du pays, journal visible par le pays consulté ; Q1 et Q4 |

---

## 10. Questions pour l'utilisateur

Hypothèses retenues sans question :
- **H1** : un seul Siège ; un pays dépend d'un seul bureau régional ; pas de niveau entre région et pays.
- **H2** : interface en français et en anglais seulement.
- **H3** : quand un pays change de région, les rapports passés suivent l'arbre **actuel**.

Le dire si l'une est fausse.

| # | Question | Défaut recommandé |
|---|---|---|
| **Q1** | Que voient le bureau régional et le Siège d'un pays : les **agrégats** seulement, ou aussi une **consultation détaillée en lecture seule** de ses écrans (contrats, factures, indicateurs) ? | Les deux, pour tous les rôles régionaux et Siège. Aucune écriture sans appartenance au pays. Positions GPS des ménages jamais hors du pays. |
| **Q2** | Taux de change : chaque pays saisit-il ses taux (comme aujourd'hui), ou le Siège publie-t-il une table centrale unique ? La devise de consolidation est-elle l'USD ? | Taux par pays. Le Siège voit les taux manquants dans Organisation. Consolidation en USD. |
| **Q3** | Une personne présente dans plusieurs espaces a-t-elle **un seul compte** (un e-mail, un mot de passe) ? Qui gère alors ce mot de passe ? | Oui, un seul compte. Le mot de passe est géré par la personne ou par l'admin du Siège. Un admin pays ne gère que les comptes de son seul pays. |
| **Q4** | Tous les pays sont-ils sur **une seule base et un seul serveur** ? Un pays impose-t-il que ses données restent chez lui ? | Une seule base, condition de la consolidation en direct. Un pays soumis à une obligation de résidence garde son instance (hors de cette spécification). |
| **Q5** | Le Siège impose-t-il des **codes communs** (activités, modèles d'indicateurs, lignes budgétaires) pour comparer les pays ? | Comparaison seulement sur les codes communs existants (`template_code`, code d'activité, ligne « IV.suivi »). Le reste est affiché « non comparable ». Une harmonisation plus poussée sera un chantier à part. |
