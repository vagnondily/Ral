# PROMPT À COPIER — Reproduire : Planification automatique + RBM + Gestion des sites actifs

> Copie tout ce qui suit (à partir de « Tu dois reproduire… ») dans une nouvelle session.
> C'est une spécification complète et fidèle de trois fonctionnalités de MEMS 2.0 et de leur
> socle commun. Les règles, seuils, arrondis et ordres sont EXACTS — ne les paraphrase pas.

---

Tu dois reproduire, à l'identique de leur comportement, **trois fonctionnalités liées** d'une
application de suivi-évaluation (TPM / tierce partie de suivi) :

- **A. Gestion des sites actifs / inactifs** (grille Oui/Non par mois).
- **B. RBM — Risk-Based Monitoring** (quels sites suivre ce mois selon le risque).
- **C. Planification automatique** des visites de terrain (moteur qui génère le plan du mois/période).

Les trois partagent un **socle commun** (registre des sites, visites, MMR, bureaux, horloge, période,
attribution TPM). Reproduis d'ABORD le socle, puis A, puis B, puis C — dans cet ordre de dépendance.

## 0. Stack et architecture imposées

- Backend **Node.js/Express + PostgreSQL** multitenant avec **Row-Level Security (RLS)**. Front **React 18 + Vite** (routage par hash).
- Couches strictes : `routes → controller → service → repository`. **Seul le repository écrit du SQL.**
- **Toute la logique métier lourde est dans des modules PURS, sans I/O, testés unitairement**
  (`*Math.js`, `*.domain.js`). C'est ce qui rend le calcul testable et déterministe. Chaque règle a son test.
- Les jumeaux **SQL ↔ JS** (une règle écrite deux fois, en SQL ensembliste et en JS pur) doivent rendre
  **exactement** le même résultat — vérifie la parité par un banc de test.

## 1. Conventions non négociables (socle)

1. **Multitenant + RLS.** Chaque table métier porte `tenant_id` + une policy RLS. Toute requête filtre
   `tenant_id = $1` **et** tourne dans un helper `withTenantTransaction(tenantId, fn)` qui pose un GUC
   `app.tenant_id` (BEGIN ; `SET LOCAL app.tenant_id` ; … ; COMMIT/ROLLBACK). Le `tenant_id` vient
   **toujours de `req.auth`, jamais du corps de requête**.
2. **Rôle applicatif restreint.** L'API tourne sous un rôle `NOSUPERUSER NOBYPASSRLS` (la RLS est donc
   réellement appliquée). Les migrations/seed tournent en superutilisateur.
3. **Une FK ne passe PAS la RLS.** Installe un déclencheur `trg_same_tenant` (fonction
   `mems_install_same_tenant('la_table')`) : BEFORE INSERT/UPDATE, pour chaque FK vers une table à
   `tenant_id`, vérifie explicitement (hors RLS) que la ligne référencée est du même tenant, sinon
   RAISE `23503` → 400. La RLS protège les LECTURES ; ce déclencheur protège les ÉCRITURES.
4. **Pas d'écriture partielle.** Tout chemin à > 1 instruction tourne dans une transaction
   (BEGIN/COMMIT/ROLLBACK). Les montants/valeurs dérivées sont **recalculés serveur**, jamais pris du client.
5. **Une seule horloge** (`common/localDay`). Le « mois courant » et « aujourd'hui » se lisent via un
   fuseau applicatif `APP_TIMEZONE` (défaut `Indian/Antananarivo`). **Jamais** `toISOString().slice`,
   `getFullYear()`, ni `now()/current_date` pour le mois courant. `currentMonth() = localDay().slice(0,7)`.
   Fuseau invalide → repli UTC silencieux (jamais d'exception). Entre minuit et ~3 h à Madagascar, le jour
   UTC est encore la veille : « jamais une date passée » se juge sur le jour **local**.
6. **Période = plage de mois** `{from:'AAAA-MM', to:'AAAA-MM'}` bornes incluses (`null` = toutes périodes).
   Traduite en SQL par un **intervalle semi-ouvert** : `period_month >= from-01 AND period_month < (to+1)-01`.
   **Jamais** `BETWEEN lo AND hi`. L'ancien `?month=AAAA-MM` reste lu (rétrocompat). Erreurs ordonnées :
   absent → null|required ; non-chaîne → `period_format` ; `month`+`from/to` → `period_ambiguous` ;
   `from` sans `to` → `period_partial` ; format → `period_format` ; années 2000-2100 → `period_year` ;
   `from ≤ to` → `period_order` ; span ≤ plafond → `period_span`. Période par défaut = **dernier mois
   substantiel** (volume ≥ 25 % de la médiane des 6 mois précédents), jamais un mois vide ni futur.
7. **Périmètre « bureau » = sous-arbre RÉCURSIF.** « bureau » veut TOUJOURS dire le bureau **ET toutes ses
   antennes à n'importe quel niveau** (`field_offices.parent_id`). En JS `officeScopeIds(offices, officeId)`
   (itératif, un cycle ne boucle jamais) ; en SQL `WITH RECURSIVE office_tree … UNION` (jamais `UNION ALL`).
   Un bureau **national** (`national=true`) = tout le registre, aucun filtre. Jamais un seul niveau de `parent_id`.

## 2. Modèle de données commun

### 2.1 `sites` — registre unique des sites (socle de A, B, C, couverture, carte). JAMAIS dupliqué.
- `id` uuid PK (clé technique, jamais montrée) ; `tenant_id` ; `code` text (ancien identifiant, ex. `PLAN-0001`) ;
  `name` text (Localité).
- `public_id` text NOT NULL **DEFAULT** `mems_site_public_id()` : identifiant affiché **`S-XXXX-XXXX`**,
  **immuable**. Génération : 8 octets de `uuid_send(gen_random_uuid())`, chaque octet `% 32` indexe l'alphabet
  **Crockford base 32 sans I, L, O, U** = `0123456789ABCDEFGHJKMNPQRSTVWXYZ`, format `'S-'+4+'-'+4`.
  Unique par tenant (re-tirage en boucle sur collision). CHECK `public_id ~ '^S-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$'`.
  Déclencheur BEFORE UPDATE OF `public_id` → lève `check_violation` si on tente de le changer.
- `location_id` text (Code POI, CHECK `~ '^L[0-9]{3,6}$'`) ; `tag_code` text (code d'étiquette d'activité) ;
  `activity` text (Activity_tag, libellé libre).
- `risk_level` text IN (`faible`,`moyenne`,`elevee`) **DEFAULT `'moyenne'`** (niveau RBM).
- `security_situation` smallint IN **(0,1,3,99)** DEFAULT 0 (0 pas de restriction, 1 modérée, 3 stricte,
  **99 = zone interdite**). ⚠️ l'ancienne valeur 2 (« élevée ») a été convertie en 3 ; **seul `>= 99` = `forbidden`**.
- `adm1..adm4` text (Région/District/Commune/Fokontany) ; `adm2_pcode`, `adm3_pcode` text (codes district/commune) ;
  `admin_area_id` uuid → `admin_areas` ; `field_office_id` uuid → `field_offices`.
- `gps_lat`/`gps_lng` numeric(9,6) ; `last_visit_date` date (historique antérieur au système) ;
  `zone_district_id`/`zone_commune_id` uuid → `admin_areas` (**DÉRIVÉS** serveur à chaque rattachement, jamais saisis).
- Contraintes : UNIQUE `(tenant_id, code)` ; UNIQUE `(tenant_id, public_id)` ; UNIQUE partiel `(tenant_id, location_id)` ;
  RLS ; `mems_install_same_tenant('sites')`.

### 2.2 `site_visits` — visites de terrain par site × mois × activité. SEULE vérité du TPM (`provider_id`).
- `id`, `tenant_id`, `site_id` → sites ; `period_month` date CHECK (jour = 1) ; `activity` text ;
  `status` text IN (`planifie`,`realise`,`annule`) DEFAULT `'planifie'` ; `visit_date` date ;
  `agent` text (**rôle générique** « Agent 1 », jamais nominatif).
- `provider_id` uuid → partners (TPM affecté) ; `contract_id` uuid → contracts (**DÉRIVÉ** de la zone,
  jamais posé à la main sauf reprise) ; `provider_source` IN (`zone`,`visite`,`reprise`) DEFAULT `'zone'` ;
  `provider_zone_state` text (état recopié de la cellule TPM ; **NULL = « à estampiller »**) ;
  `provider_reason` text 10–500 (écart motivé) ; `nonrealized_reason` text ≤ 500.
- `monitored_by` text **GENERATED STORED** IN (`tpm`,`interne`,`non_affecte`) : `tpm` si `provider_id` présent ;
  `interne` si `provider_source='visite'` OU état ∈ (sans_contrat, sans_tpm, indisponible, aucun_tpm, district_inconnu) ;
  sinon `non_affecte`. **Ne jamais l'écrire** ; elle se recalcule.
- Contraintes : **UNIQUE `(tenant_id, site_id, period_month, activity)`** ; CHECKs de forme sur la cohérence
  zone/état/contrat ; index (month, provider, site, `monitored_by='interne'`, visites zone planifiées,
  `provider_zone_state IS NULL`) ; RLS ; 3 déclencheurs (voir §7).

### 2.3 `site_month_status` — grille d'activation (état COURANT). Table pivot de la règle « actif au mois M ».
- `tenant_id`, `site_id` → sites ON DELETE CASCADE, `year` int (2000-2100), `month` smallint (1-12),
  `active` boolean NOT NULL (**true = Oui / false = Non ; ligne ABSENTE = non renseigné/vide**), `updated_at`.
- **PRIMARY KEY `(site_id, year, month)`** ; index `(tenant_id, year)` ; RLS ; GRANT SELECT/INSERT/UPDATE/DELETE
  (effacer un mois = **DELETE** de la ligne ; il n'existe pas de 3ᵉ valeur stockée).

### 2.4 `site_activation_changes` — journal **APPEND-ONLY** des changements d'activation.
- `id`, `tenant_id`, `site_id`, `year`, `month`, `before` boolean (null|true|false), `after` boolean,
  `reason` text ≤ 500, `source` text IN (`ecran`,`import`), `changed_by` uuid → users, `changed_at`.
- **CHECK `before IS DISTINCT FROM after`** (un changement change quelque chose) ; `mems2_app` n'a que
  **SELECT + INSERT** (REVOKE UPDATE/DELETE) ; RLS ; `mems_install_same_tenant`.

### 2.5 `field_offices` — arbre bureaux & antennes.
- `code` (UNIQUE tenant+code), `name`, `nature` IN (`pays`,`terrain`), `parent_id` → field_offices (antenne),
  `national` boolean DEFAULT false, `active`, `office_level` IN (hq, regional, country, area, sub, antenna).
- `field_office_communes` : périmètre = liste de communes ; UNIQUE sur `(office_id, lower(btrim(district)), lower(btrim(commune)))`.

### 2.6 `mmr_parameters` — Minimum Monitoring Requirements par **bureau × catégorie d'activité**.
- `field_office_id` → field_offices **NULLABLE** (NULL = **plan général** valant pour tous ; non-NULL =
  **dérogation** qui prime pour ce bureau) ; `activity_category` text ; `operation_duration` int DEFAULT 12 (0-12) ;
  `number_of_sites` int DEFAULT 0 ; `risk_level` int DEFAULT 2 (**1=faible, 2=moyen, 3=élevé**) ;
  `feasible` int (capacité saisie) ; `persons_to_deploy`, `visits_per_day` numeric(6,2), `working_days` int
  (capacité **calculée**).
- Deux index uniques **partiels** : `uq_mmr_general` `(tenant, activity_category) WHERE office IS NULL` ;
  `uq_mmr_office` `(tenant, office, activity_category) WHERE office IS NOT NULL`.
- **Tout le reste est dérivé** (jamais stocké) par `deriveMmr` (§6.1).

### 2.7 Attribution TPM (dépendance de B et C) — voir §7 pour les règles.
- `tpm_zone_overrides` : modifications d'attribution par zone (district/commune) × mois ; `admin_area_id`,
  `area_depth` IN (2,3), `period_month` (jour=1), `provider_id` (NULL = « aucun TPM » décidé), `reason` 10-500
  **obligatoire**, `expected_state`, `batch_id` ; UNIQUE partiel `(tenant, admin_area_id, period_month)`.
- `tpm_unavailability` : indisponibilités d'un TPM par mois ; `provider_id`, `period_month`, `reason` 10-500 ;
  UNIQUE `(tenant, provider, month)`.
- `tpm_attribution_log` : journal **INALTÉRABLE** (REVOKE UPDATE/DELETE/TRUNCATE) des décisions.

## 3. LA RÈGLE UNIQUE « site actif au mois M » (pivot des trois fonctionnalités)

Écris-la **une seule fois** et réutilise-la partout (serveur JS, serveur SQL, client web). Ne jamais
introduire une 2ᵉ règle.

```
isActiveMonth(value, yearHasGrid) = yearHasGrid ? (value === true) : (value !== false)
```

- **Couche métier :** un site en **zone interdite** (`security_situation >= 99`, valeur ACTUELLE) **n'est jamais
  actif**, même avec un « Oui ».
- Si le tenant a **au moins une case** de grille (`site_month_status`) pour **l'année** du mois, alors seul un
  **« Oui » explicite** rend le site actif et une **case vide compte INACTIVE**.
- S'il n'y a **aucune** case cette année-là, **tout le registre est actif** (par défaut).
- Attention : `yearHasGrid` se juge au niveau **TENANT × ANNÉE** (EXISTS une ligne pour l'année), pas par site :
  dès qu'UN statut est saisi pour l'année, toute l'année bascule en « grille ouverte » et toutes les cases
  vides comptent inactives — d'où un bandeau d'avertissement et un bouton « Renseigner les cases vides ».
- Le jumeau SQL (`siteMonthFactsCtes`) ajoute la couche `forbidden` que le client n'a pas : l'écran peut
  afficher « Oui » alors qu'un tableau de bord compte le site inactif (zone interdite). Ce n'est pas une incohérence.

### Source unique des faits site × mois
Une seule fonction SQL `siteMonthFactsCtes(...)` produit les CTE « actif / prévu / réalisé » sur une plage,
réutilisée par la couverture, A, B et C. Un **site × mois compte UNE fois** (plusieurs lignes du même
site×mois pour des activités différentes → un seul statut, **réalisé > planifié > annulé**). Les trois taux :
- **Couverture** = sites réalisés / sites actifs (null sans site actif).
- **Planification** = sites prévus / sites actifs — **NULL (jamais 0 %) quand rien n'est planifié** (affiche « — aucun plan »).
- **Exécution du plan** = site×mois réalisés / site×mois prévus (planifié+réalisé) **sur les mois échus**
  (m ≤ mois courant local) — une visite à venir ne fait jamais baisser le taux.
- Perf sous RLS : CTE `MATERIALIZED`, appartenances en sous-requêtes `IN` non corrélées (ensembles hachés
  construits une fois), `FULL JOIN` — ne pas « simplifier », la RLS fausse les estimations et déclenche des
  boucles imbriquées (10 s à 10 000 sites).

---

## 4. Fonctionnalité A — SITES ACTIFS / INACTIFS

**But.** Dire, pour chaque site du registre et chaque mois d'un **exercice (année)**, s'il est actif (Oui),
inactif (Non) ou non renseigné (vide). Fidèle à une feuille « Site Actif » d'un classeur. **L'activation ne
crée JAMAIS de site** — les sites viennent du registre. Elle ne fait que poser un statut par site × mois et
journalise **chaque** changement.

### 4.1 Module pur `activationMath`
- `MONTHS = [1..12]`, `MONTH_HEADERS = ['Jan','Fév','Mar','Avr','Mai','Juin','Juil','Août','Sep','Oct','Nov','Déc']`.
- `fold(v)` : NFD, retire les diacritiques, trim, minuscule.
- `parseYesNo(v)` : `fold` puis `'' → {ok:true, value:null}` ; `YES = {oui,o,yes,y,1,active,actif,true,vrai,x} → true` ;
  `NO = {non,n,no,0,inactive,inactif,false,faux} → false` ; sinon `{ok:false}` (non reconnu).
- `identKey(s)` : `fold(s)` puis supprime **tous** les espaces (casse, espaces, accents ignorés).
- `identifierOf({locationId, tagCode, code})` : si Code POI non vide → `locationId.trim() + tagCode.trim()` ;
  sinon `code.trim()`.
- `buildSiteIndex(sites)` : indexe chaque site par `identKey(publicId)`, `identKey(identifierOf(s))`, `identKey(code)`.
  **Une clé portée par > 1 site devient AMBIGUË et est retirée** (jamais rapprochée). `resolve(ident, {locationId,
  tagCode, publicId})` ordre de priorité = **(1) public_id normalisé (immuable), (2) Code POI+Tag_code, (3) code MEMS** ;
  1ʳᵉ clé ambiguë → `{siteId:null, ambiguous:true}` ; 1ʳᵉ clé connue → `{siteId, ambiguous:false}` ; sinon `{siteId:null}`.
- `diffActivation(current, wanted)` : pour chaque site voulu, mois 1..12 : `after = months[m]` ;
  **`undefined` = mois INCHANGÉ (skip)** ; dédup par **première occurrence** de `siteId|month` ; `before = current[site][m] ?? null` ;
  si `before === after` skip ; sinon pousse `{siteId, month, before, after, reason: cleanReason}`.
- `cleanReason(r)` : non-string → null ; sinon trim, **coupe à 500 points de code**, null si vide.
- `blankFill(current, siteIds, {from, to, value, reason})` : `value` non-booléen → **TypeError** ;
  `lo = max(1, min(from,to))`, `hi = min(12, max(from,to))` ; pour chaque siteId **distinct**, pour `m ∈ [lo..hi]`
  **seulement si `current[m]` est absent** → pose `value`. **Un Oui/Non déjà saisi n'est JAMAIS modifié.**
- `summarizeChanges(changes)` : `{changes, sites(distincts), activated(after===true), deactivated(after===false), cleared(after===null)}`.
- `activeInYear(months)` = au moins un mois à `true` ; « Inactif toute l'année » = 12 mois à `false`.

### 4.2 Règles métier
1. **Case VIDE à l'import = mois INCHANGÉ** (jamais d'effacement involontaire) ; seuls Oui/Non écrivent un statut.
   `null` explicite efface (DELETE de la ligne).
2. **Clic sur une case (écran)** : cycle **Oui → Non → vide → Oui**. Effacer = DELETE.
3. **« Renseigner les cases vides »** (`blankFill`) : sur `[from..to]` des sites affichés, seules les cases sans
   statut prennent la valeur choisie ; calculé **serveur, sous verrou, en une transaction**, journalisé avec motif.
4. **Chaque changement est inscrit, DANS LA MÊME TRANSACTION**, au journal append-only avec `before`, `after`,
   `source` (`ecran`/`import`), motif, `changed_by`, `changed_at`.
5. **Un site en double** dans un fichier d'import ne change qu'**une fois** (première ligne).
6. Année par défaut des endpoints = **année courante au jour local**.

### 4.3 Import du classeur d'activation
- Parseur **pur** (ne verrouille rien). Chemin **PREVIEW** (`?commit=0`) = lit sans `FOR UPDATE`, **rien écrit**,
  renvoie `matched / unknown / ambiguous / duplicates / changes` pour revue. Chemin **COMMIT** (`?commit=1`) =
  verrouille les sites par id croissant (`ORDER BY id FOR UPDATE`), applique en une transaction, source `'import'`.
- Rapprochement ligne → site par la priorité §4.1. **Ligne sans correspondance = ignorée et listée** (`unknown`),
  aucun site créé. Une seule année par fichier (sinon erreur bloquante). Valeur de mois non reconnue → erreur
  ligne+colonne (jamais un 500).

### 4.4 API (préfixe `/api/tpm/field`)
- `GET /activation?year=` → `{year, rows:[{id, ident, publicId, name, activity, bureau, region, district, commune,
  m:'OON-...' (12 car.: O=Oui, N=Non, -=vide), reason, reasonAt}]}`.
- `PUT /activation` (WRITE) → body `{year, changes:[{siteId, month, active:bool|null}] (1..60000), reason?}` ;
  renvoie `summarizeChanges` ; **UNKNOWN_SITE → 400** (aucune écriture) si un siteId est inconnu du tenant.
- `POST /activation/fill` (WRITE) → body `{year, from, to (from≤to), value:bool, siteIds:[uuid] (1..20000), reason?}`.
- `GET /activation/history?siteId=&year=` → journal (plus récent d'abord, LIMIT 300).
- `GET /activation.xlsx?year=` → export (formules vivantes, listes Oui/Non, volets figés).
- `POST /activation/import?commit=0|1&year=` → body brut .xlsx (passe une garde de décompression).

### 4.5 Invariants A
- `site_month_status` : au plus une ligne par `(site_id, year, month)` ; aucune ligne = non renseigné (jamais une 3ᵉ valeur).
- Journal append-only (SELECT+INSERT seulement) ; `before IS DISTINCT FROM after` toujours vrai.
- `public_id` : une valeur par site, conforme au format, unique par tenant, **constante toute la vie du site**.
- État + journal écrits **dans la même transaction** (tout ou rien).
- La règle « actif au mois M » du client et celle du serveur donnent le **même** résultat (une seule règle).

---

## 5. Fonctionnalité B — RBM (Risk-Based Monitoring)

**But.** Décider, mois par mois, **quels sites doivent être suivis** selon leur niveau de risque, et
**générer** le plan du mois (une visite planifiée par site dû). Toute la logique est pure (`rbmMath`, `rbmScore`).

### 5.1 Module pur `rbmMath`
- `DEFAULT_FREQUENCY = {elevee:1, moyenne:2, faible:3}` = **mois entre deux visites** (plus le risque est élevé,
  plus on visite). `frequencyFor(risk) = freq[risk] || 3` (inconnu → 3).
- `currentMonth() = localDay().slice(0,7)`.
- `isDue(riskLevel, lastVisitMonth, targetMonth)` : pas de dernière visite → **true** ;
  `diff = monthsBetween(last, target)` ; `diff < 0` → false (visite dans le futur du mois cible) ;
  `diff >= frequence` → true.
- `lastVisitOf({fieldVisitMonth, dataVisitMonth, lastVisitDate})` = **dernière visite EFFECTIVE** = le mois le
  plus RÉCENT parmi : (1) visite **RÉALISÉE** (`status='realise'`), (2) **collecte réelle** (soumission de données
  reçue, rattachée au site, sinon à sa commune par `adm3_pcode`), (3) `sites.last_visit_date` (registre).
  **À égalité de mois : visite > données > registre.** ⚠️ **Une visite seulement PLANIFIÉE n'entre JAMAIS**
  et ne rend jamais un site « à jour » (montrée à part : « prévue AAAA-MM »).
- `needsPlanning({due, forbidden, nextPlannedMonth, cancelledThisMonth, inactiveThisMonth}, target)` =
  `due && !forbidden && !cancelledThisMonth && !inactiveThisMonth && toMonth(nextPlannedMonth) !== target`.
- `planningCounts → {due, toPlan, cancelled, inactive}`.

### 5.2 Scoring et drapeaux (`rbmScore.scoreSite`) — « Pourquoi / Conséquence / Que faire »
- `riskPoints = security(0/1/2) + synergies(0/1) + caseload(0/1) + newPartner(0/1) + experienced(0/1/2)
  + issuesProcess(0/1/2) + issuesPartnerReport(0/1/2) + issuesCFM(0/1/2) + 2*fraud(0..2)`.
  La somme des points des `reasons` rendues **égale exactement `riskPoints`** (fraude pondérée ×2).
- `caseload` = 1 si `beneficiary_number` renseigné et > 200, sinon 0 ; si vide, repli sur `beneficiary_over_200`.
- **Sécurité** : échelle {0, 1, 3, 99} ; l'ancien 2 est lu/converti en 3 ; `security >= 99 ⇒ forbidden`
  (ni proposé ni planifié) ; 3 ou 99 ⇒ `security` normalisé à 2 (stricte) ⇒ drapeau urgent.
- **Drapeaux urgents** = problème process/rapport/CFM « urgent » (=2) OU fraude (≥1) OU sécurité stricte/zone interdite.
- **FINAL SCORE** : urgentFlags → **2 (Élevé)** quel que soit le total ; sinon `riskPoints ≥ 4` → 2 ;
  `≥ 2` → 1 (Moyen) ; `< 2` → 0 (Faible).
- **Priorité** (0 Basse / 1 Moyenne / 2 Haute), branche unique : urgent → Haute ; Élevé+en retard → Haute ;
  Élevé (à jour) → Moyenne ; en retard/jamais visité → Moyenne ; Moyen → Moyenne ; Faible+à jour → Basse.

### 5.3 Règles de génération
1. **« À suivre » (due)** = `target && (overdue || isDue(risk, lastVisitMonth, target))`. `overdue` et `isDue`
   utilisent la **même** fréquence `frequencyFor(risk)` (1/2/3) — **pas** l'intervalle MMR. La colonne affichée
   « Intervalle requis (CO) » = cette fréquence.
2. **« À planifier » (toPlan)** = `due && !forbidden && pas de visite déjà prévue ce mois && pas de visite
   ANNULÉE ce mois && site actif ce mois (grille §3)`.
3. **« Générer depuis le RBM »** crée **une** visite `planifie` par site toPlan, **idempotent** : `NOT EXISTS`
   de **toute** visite (quel que soit le statut) sur site+mois ⇒ une visite annulée ou réalisée ce mois bloque
   la (re)création ; `ON CONFLICT (tenant, site, month, activity) DO NOTHING`. État lu **`asOf = mois cible`**
   (visites/données postérieures ignorées ; les visites planifiées futures restent visibles, non bornées par asOf).
4. **Import Master Data** (référentiel sites) : colonnes `Région | ? | District | pcode | Commune | pcode |
   Site name | Code`. Upsert par `code` (sinon slug `district--commune--nom`), `ON CONFLICT (tenant, code)` ;
   `risk_level` défaut `moyenne` ; rattachement au bureau le plus spécifique par commune ; capture `adm2/adm3_pcode`.
5. **Liaison données réelles → site** : les soumissions sont géocodées par **pcode de commune (`adm3`)** sans id
   de site ; `sites.adm3_pcode` relie la dernière collecte réelle au site (granularité commune).

### 5.4 API (préfixe `/api/tpm/field`)
- `GET /rbm/sites?month= (ou from&to) &risk=` → lignes site enrichies (risque, dernière visite effective, due,
  toPlan, score, **TPM de zone** via attribution §7). Le filtre `?risk=` restreint **avant** calcul.
- `GET /rbm/counts?...` → `{month, total, due, dueOpen, upToDate, toPlan, byRisk}` (écrans de totaux seuls).
- `GET /rbm/sites/:id?month=` → `{ligne, reasons, consequence, actions}` (Pourquoi/Conséquence/Que faire).
- `POST /rbm/generate?month=(requis)&risk=` (WRITE) → `{created, due, toPlan, cancelled, inactive, tpm:{byState}}`.
- `POST /rbm/import` (WRITE) → body .xlsx Master Data → `{total, inserted}`.
- `POST /rbm/import-plan` (WRITE) → classeur complet (critères + FINAL SCORE + GPS + dernières visites converties
  en visites `realise` datées, idempotent).

### 5.5 Invariants B
- Une visite seulement planifiée ne rend **jamais** un site « à jour » (exclue de la dernière visite effective).
- La somme des points des `reasons` = `riskPoints` exactement (cohérence de l'explication).
- Zone interdite (`>= 99`) → jamais « à planifier » ni planifié (comptée dans `due` total, pas dans `dueOpen`).
- Chaque site a toujours un `risk_level` non-NULL (contrainte + défaut `moyenne`).
- « Générer » est idempotent (2ᵉ clic = 0 visite). Horloge locale partout. Périmètre bureau = sous-arbre récursif.
- Toute écriture de visites finit par **ré-estamper le TPM de zone** (§7), après verrou du mois puis des sites.

### 5.6 Pièges B
- **Deux `risk_level` distincts** : `sites.risk_level` (texte, RBM) vs `mmr_parameters.risk_level` (int 1-3, MMR). Ne pas confondre.
- L'intervalle « en retard » de la page RBM est `frequencyFor(risk)` (1/2/3), **pas** l'intervalle MMR.
- `asOf` borne les visites réalisées / données / registre, **jamais** les visites planifiées futures.
- « Générer » bloque aussi sur une visite **annulée** du mois (décision jamais ressuscitée) et sur un site
  **inactif** ce mois ; comptés séparément (`cancelled`/`inactive`), expliqués dans le toast, pas des erreurs.

---

## 6. Fonctionnalité C — PLANIFICATION AUTOMATIQUE

**But.** Un **moteur pur, déterministe, sans I/O** produit, pour un exercice (une seule année), un **plan
maximal** de visites site × mois respectant, par site, le **nombre de visites exigées** et l'**écart minimal**
entre visites, groupées **commune par commune** dans l'ordre de priorité RBM, **réparties par mois**, **jamais
sur un mois échu**. Un module de **ressources** convertit ensuite le plan en journées-agent, agents et véhicules,
en **entiers exacts**. Un **oracle d'invariants INDÉPENDANT** re-dérive chaque règle et doit renvoyer 0 violation.

### 6.1 Entrées MMR dérivées (`mmrMath.deriveMmr`) — calcul sur valeurs EXACTES (comme Excel), `round2` à l'affichage seulement
```
interval          = round2(duration / risk)                 // risk ∈ {1,2,3}
frequency         = round2(duration / interval)             // = risk
targetedPerMonth  = round2(sites / interval)                // plancher sites/mois
computedCapacity  = (persons>0 && perDay>0 && days>0) ? round2(persons*perDay*days) : null
feasible          = computedCapacity ?? manualFeasible      // la capacité CALCULÉE PRIME sur la saisie
coverageRatio     = (feasible!=null && targetedPerMonth>0) ? round2(feasible/targetedPerMonth) : null
adjFreqExact      = (duration/(duration/risk)) * (feasible/(sites/(duration/risk)))   // sur valeurs NON arrondies
adjustedFrequency = round2(adjFreqExact)
adjustedInterval  = round2(max(duration / adjFreqExact, 1))
```
- Plan général (office NULL) hérité par tous ; une ligne avec bureau est une **dérogation** qui prime.

### 6.2 Règles du moteur (`planAuto.generatePlan`) — formules EXACTES
1. **Visites exigées** par site. Site piloté MMR (`required > 0`) : `req = max(0, round(required))` ;
   en stratégie « capacité » en plus `req = min(req, max(1, round(frequency)))`. Site en repli **RBM**
   (pas de ligne MMR, ou durée 0) : `required = 0`, son « besoin » = le **maximum** de visites que sa
   fréquence de risque autorise sur ses mois libres actifs (élevé mensuel, moyen tous les 2, faible tous les 3).
2. **Écart (`step`, mois entre visites).** MMR : `base = interval>0 ? interval : frequencyFor(risk)` ;
   `step = max(1, ceil(base − 1e-9))` ; en « capacité » aussi `step = max(step, ceil(adjustedInterval − 1e-9))` ;
   **puis contrainte de durée** : si `operationDuration>1 && req>1`, `step = max(1, min(step, floor((duration−1)/(req−1))))`
   pour que les visites exigées **tiennent** dans la durée (`1+(req−1)*step ≤ duration`). Repli RBM :
   `step = max(1, ceil(frequencyFor(risk) − 1e-9))` = 1/2/3. Écart arrondi **au supérieur** depuis l'intervalle
   MMR (4,5 → 5), puis réduit seulement par la contrainte de durée.
3. **Capacité déclarée** (MMR feasible) en visites/mois = `floor(feasible + 1e-9)` (arrondi **bas**, 2,5→2) ;
   null/'' = pas de limite ; 0 = aucune capacité (rien placé en « capacité »). En **« besoins » la capacité
   est seulement COMPARÉE** (drapeaux `monthsOverCapacity`/`belowTarget`), jamais un plafond silencieux.
4. **Jamais un mois échu.** `period` = mois demandés (1..12 de l'année) filtrés à `m >= firstPlannableMonth(year, fromMonth)` ;
   les mois antérieurs demandés vont dans `pastMonths` (jamais planifiés). **« Échu » se mesure contre le mois
   COURANT**, pas le début de la période (replanifier le 2ᵉ semestre ne replanifie pas le 1ᵉʳ).
5. **Ancrages de l'intervalle** (index de mois ABSOLUS `year*12+m-1`, **exercices voisins compris**) : chaque
   visite **réalisée**, chaque visite **planifiée d'index ≥ maintenant**, chaque visite d'un exercice voisin
   (avant OU après), et `last_visit_date` si ≤ décembre de l'année. **Une visite planifiée d'un mois passé jamais
   réalisée n'est PAS un ancrage** (replanifiable, comptée `latePlanned`). Un écart est respecté ssi
   `|monthIdx(m) − ancre| >= step` pour **chaque** ancrage ET entre visites générées. Seule la visite de **renfort
   urgent** est exemptée.
6. **Univers.** `considered = inScope !== false`. Exclus et comptés à part : `forbidden` (zone interdite),
   `noActivity` (`!activity && !parametered` → jamais planifié), `access` (communes exclues), `inactiveAll`
   (inactif tous les mois de la période). `activeAt(s,m) = isActiveMonth(monthStatus[m], yearHasGrid)` (§3).
7. **Domaines par site.** `liveBusy` = mois à visite vivante (planifié|réalisé) ; `cancelled` = mois annulés
   (jamais réutilisés — une annulation est une décision) ; `free` = mois de la période non liveBusy ;
   `allowed` (domaine de placement) = `free ∩ non cancelled ∩ actif`.
8. **Regroupement par commune.** Un cluster = une commune de son district (insensible casse/espaces), sinon
   cellule GPS 0,1° si commune manquante, sinon le site seul. Chaque mois une commune est visitée **en entier** :
   tous ses sites dus **dont l'écart propre est satisfait** vont dans la même tournée. Une tournée est déclenchée
   par le site le plus exigeant (plus petit `step` = `leadStep`), par un site à son dernier mois possible
   (« échéance »), ou par un renfort.
9. **Répartition équilibrée par mois.** Pour le mois `m` : `monthsLeft` = nb de mois de période `≥ m`.
   `monthTarget = max(0, ceil((placeableAll + existingLeftAll)/monthsLeft) − existingMonth[m])`, et par clé
   (activité) `target = max(0, ceil((n + existingLeft)/monthsLeft) − existingHere)`. Une commune est voulue si
   forcée (échéance/renfort) OU (`generatedAll < monthTarget` ET une de ses activités sous sa cible). Le plancher
   MMR `targetedPerMonth` est atteint dès que les visites dues le permettent ; un manque est **signalé**
   (`monthsBelowTarget`), **jamais** comblé en avançant des visites et en vidant les mois suivants.
10. **Ordre des communes (RBM)**, clé décroissante = `[échéance(must), renfort(ren), urgent, finalScore,
    neverVisited, overdue(absence≥step), maxAbsence]`, départage `clusterKey` asc. En « capacité », `firstPassage`
    (site sans aucune visite dans la période) est préfixé (couvrir d'abord un max de sites distincts).
11. **Complément = plan maximal.** Après la boucle des mois, les sites à besoin restant, triés par `urgent desc,
    finalScore desc, neverVisited desc, RISK_RANK desc, id asc`, prennent **tout** mois encore permis respectant
    l'écart (et la capacité en « capacité ») : **aucune visite plaçable n'est laissée** ; un 2ᵉ passage n'ajoute
    rien (**idempotent**).
12. **Renfort** (option `reinforceUrgent`) : un site RBM urgent reçoit **une** visite supplémentaire au premier
    mois de période actif et non annulé, **seulement** si aucune visite vivante de la période ne tombe avant/sur
    ce mois ; cette visite est **exemptée de l'intervalle** (source `renfort`).
13. **Départages globaux.** Sites triés par `id` avant tout (ordre d'entrée sans effet). Affectations finales
    triées par `monthNum asc, RISK_RANK desc, siteId asc`. Toutes les itérations de map sur clés triées → sortie déterministe.

### 6.3 Ressources (`planResources`) — entiers exacts
- **`U = 252000` = une journée-agent** (choisi pour diviser proprement 1..10, 12 et les moitiés → `ceil(U/v)` reste exact).
- Une visite d'activité à `suivis/jour = v` coûte `ceil(U/v)` unités (`v` vide ⇒ coût `U` = une visite/jour,
  drapeau « à paramétrer »). Journées-agent d'une activité = `ceil(Σunités / U)`. Une visite > U prend
  `span = ceil(coût/U)` **jours consécutifs** du même agent.
- **Jours de terrain** d'un mois = lun–ven, ou lun–sam quand les jours voulus dépassent les jours ouvrés ; le
  **mois courant ne compte que les jours restants** (à partir d'aujourd'hui local). `workingDays` par unité×mois =
  min des `workingDays` MMR de ses visites, sinon `fieldDaysPerMonth` du plan (défaut 20).
- **Agents par unité×mois** = plus petit effectif couvrant tous les jours (tas « premier libre puis plus petit
  numéro »). **Véhicules/jour** = `Σ sur district de ceil(agents_du_district_ce_jour / agentsPerVehicle)` (défaut 4).
  Un créneau **déjà écrit** (« Agent N » daté) est **réservé** sur toute sa durée et jamais réutilisé ; un
  « Agent N » réalisé réserve mais n'est ni un à-faire ni un agent compté.

### 6.4 Unité de suivi (TPM) d'une visite
- Une **nouvelle** visite appartient au **TPM de la zone** du site ce mois-là (`tpmAt` : le segment de contrat
  couvrant, sinon le **bureau RACINE** du site en suivi interne — jamais un seul bureau pour tout le compte).
- Une visite **existante** appartient au TPM qu'elle porte (`provider_id`), ou à l'équipe interne de son bureau
  racine quand `monitored_by='interne'`, sinon à sa zone.

### 6.5 Oracle d'invariants INDÉPENDANT (`planAutoInvariants.checkInvariants`)
N'importe **rien** du moteur ; re-code chaque règle depuis la spécification et doit émettre **0 violation**.
Codes : `doublon, site_inconnu, hors_exercice, deja_une_visite, hors_perimetre, zone_interdite, sans_activite,
commune_inaccessible, inactif, mois_echu, hors_periode, sans_creneau, creneau_invalide, date_passee, renfort,
intervalle, au_dela_exigence, besoin_non_place, capacite_mmr, non_maximal, creneau_deja_ecrit, agent_deux_tournees,
unite_visites, compte_resume, compte_mois, compte_activite, compte_unite, compte_planifiables, compte_couverture,
raison_inconnue, compte_couverts`. **Si tu changes une règle dans le moteur, change-la AUSSI dans l'oracle.**

### 6.6 Stratégies
- **« besoins »** (défaut) : place **toutes** les visites exigées (repli RBM par risque pour les sites sans MMR) ;
  la capacité et le plancher `targetedPerMonth` sont des **comparaisons** (drapeaux), jamais des limites.
- **« capacité »** : garde le plan dans le `feasible` MMR (intervalle ajusté) et **rapporte ce qui n'a pas tenu**,
  avec sa **raison** (précédence contrefactuelle : `capacity → inactive → cancelled → gap → period`).

### 6.7 Application (service / verrous / empreinte / API)
- **Flux aperçu → application.** « Aperçu » lit sans écrire. « Appliquer » : (1) calcule le plan **hors verrous**
  dans une transaction de lecture ; si l'empreinte envoyée par le client ≠ empreinte fraîchement calculée →
  **409 `plan_inputs_changed`** (nomme les sections changées). (2) Dans la transaction d'écriture, prend toute la
  **chaîne de verrous sous UNE échéance de 20 s**, **relit** les entrées sur le même client et **recompare**
  l'empreinte (409 si changé), puis écrit. Le plan étant une fonction pure des entrées, une empreinte égale
  **garantit** que le plan écrit = le plan prévisualisé.
- **Empreinte** (`planFingerprint`) = **SHA-256** des entrées, par sections (`registre`, MMR, visites existantes,
  activation, réglages `writeSchedule`…). `writeSchedule` fait partie de l'empreinte : le basculer force un nouvel aperçu.
- **Écriture** = un **seul INSERT multi-lignes idempotent** de visites `planifie` : saute un site déjà visité ce
  mois, une zone interdite (`security_situation ≥ 99`), un mois inactif ; `ON CONFLICT (tenant, site, period_month,
  activity) DO NOTHING`. Avec « Écrire les dates et les agents », `visit_date` écrite seulement si son mois =
  `period_month`, `agent = 'Agent N'`.
- **« Effacer »** supprime **seulement les visites planifiées libres** : `provider_source='zone' AND
  status='planifie' AND provider_zone_state IS DISTINCT FROM 'anterieur' AND NOT facturée AND visit_date IS NULL
  AND agent IS NULL AND period_month >= mois courant local`. Jamais une visite réalisée/annulée/figée/facturée/
  datée/affectée/motivée ni d'un mois échu. Suppression par `id IN (SELECT … ORDER BY v.id FOR UPDATE OF v)`
  (anti-deadlock avec l'estampille). « Effacer » ne prend **pas** le verrou d'attribution (il ne change aucun TPM).
- **API** (préfixe `/api/tpm/plan-auto`) :
  - `GET /clock` → `{now:'AAAA-MM', today:'AAAA-MM-JJ', timeZone}`.
  - `POST /preview` (lecture, tout utilisateur) → body `{from, to (même année, from≤to), risk?, scope?{fieldOfficeId,
    activity, district}, settings?{strategy:'besoins'|'capacite', reinforceUrgent, excludedCommunes[≤500],
    agentsPerVehicle:1-10, fieldDaysPerMonth:1-26, writeSchedule}}` (zod `.strict`) → `{summary, byActivity, byTpm,
    resources, perMonth, period{from,to,pastMonths}, sample(≤200), sampleTotal, uncovered(≤50), uncoveredTotal,
    writeSchedule, rules, fingerprint(hex64), sections}`.
  - `POST /apply` (WRITE) → body d'aperçu + `{fingerprint(requis), sections?}` → `{created, planned, skipped{existing,
    inactive, forbidden}, …}`. **409** `plan_inputs_changed` ; **503** sur timeout de verrou (55P03) ; **400** `period_past`.
  - `POST /clear` (WRITE) → `{from, to, risk?, scope?}` → `{deleted, kept}`.

### 6.8 Invariants C
- Le plan écrit = le plan prévisualisé (double vérification d'empreinte).
- Pas d'écriture partielle ; verrous relâchés au COMMIT/ROLLBACK ; idempotence (relancer « Appliquer » n'ajoute rien).
- Les totaux se réconcilient : `summary.planned = #assignments = Σ perMonth.count = Σ byActivity.planned = Σ byTpm.planned` ;
  `sitesCovered + uncovered = sitesActivePlannable` ; chaque non-couvert porte une raison ∈ `{capacity, inactive,
  cancelled, gap, period}`.
- Ressources en **entiers** (U=252000), aucune somme flottante.
- Jamais un mois passé, jamais un mois annulé réutilisé, l'écart MMR respecté contre chaque visite réalisée et
  planifiée à venir (exercices voisins compris).

---

## 7. Attribution TPM & estampille (dépendance commune de B et C)

Le TPM (tierce partie de suivi) d'une visite **n'est pas choisi par l'écrivain** : il est **estampillé** à partir
de la zone du site et du contrat de suivi qui la couvre.

- **Cellule TPM** (`mems_tpm_cells`, fonction SQL + jumeau JS `resolveCell`, parité vérifiée) pour un
  site × mois : contrat de suivi `status ∈ (actif, résilié)` couvrant le mois `[mois(date_debut)..mois(date_fin|
  termination_date)]` ET dont la ligne budgétaire `IV.suivi` (`Σ unit_count*unit_cost`) **> 0**. Son TPM =
  partenaire **actif de type `tpm`** rattaché par un plan de collecte ou une facture ; à défaut le **titulaire
  SEULEMENT s'il est lui-même un partenaire actif de type `tpm`** ; sinon **aucun → suivi interne** par le bureau
  **RACINE** du site. Plusieurs contrats → état `a_arbitrer`, TPM par défaut = `ORDER BY date_debut DESC, numero
  COLLATE 'C', nom COLLATE 'C', id::text COLLATE 'C' → [1]`. Un TPM **indisponible** ce mois est retiré des candidats.
  Aire du site = sa **commune** si elle « possède une ligne » (override/zone de contrat exactement dessus) sinon
  son **district** ; NULL → `district_inconnu`. États : `district_inconnu, indisponible, modifie, aucun_tpm,
  contrat(1 titulaire), a_arbitrer(>1), sans_tpm (contrat sans TPM), sans_contrat`.
- **Qui estampille.** (1) En ligne via `restampVisitsTx` (sous un verrou d'avis `tpm-attribution:<tenant>`,
  lock_timeout 20 s puis restauré). (2) **Filet de sécurité** : un **déclencheur de contrainte DIFFÉRÉ**
  (`AFTER INSERT/UPDATE`, `INITIALLY DEFERRED`, `WHEN provider_source='zone' AND provider_zone_state IS NULL`)
  qui, **au COMMIT**, estampille toutes les visites « zone » « à estampiller » du tenant en un seul appel
  ensembliste `mems_tpm_stamp` — **même un écrivain ignorant la règle (seed, SQL générique) est correct au commit**.
- Un déclencheur **BEFORE** remet `provider_zone_state := NULL` (« à estampiller ») dès qu'une visite zone est
  insérée, replanifiée (`status→planifie`), déplacée (site/period_month) ou dont on écrit `provider_id/contract_id` ;
  no-op quand `mems.tpm_stamping='on'`.
- `mems_tpm_stamp` ne recalcule **que** les visites planifiées, non figées (`anterieur`) et non **facturées**
  (facture financière soumise/validée couvrant le mois via `period_month BETWEEN r.period_month AND
  COALESCE(r.period_end, r.period_month)`). Réalisé/annulé/facturé gardent leur TPM. Idempotent (n'écrit que les
  lignes qui changent). **Appelé avec des variables tableaux** (jamais `ARRAY(SELECT…)`) + `SET plan_cache_mode=
  force_custom_plan` → reste linéaire sous RLS (~0,2 s pour 4000 visites).
- `site_visits.provider_id` est la **seule vérité** du TPM lue par les tableaux de bord ; jamais écrit à la main
  pour une visite « zone ».

## 8. Ordre des verrous (anti-deadlock) — à respecter PARTOUT

Tout écrivain prend les verrous dans **cet ordre**, croissant, jamais à l'envers :

1. Verrou d'avis du plan automatique (`plan-auto:<tenant>`).
2. **Mois des visites** par ordre **croissant** — pour le plan auto, la fenêtre **Y-1, Y, Y+1** × 12 mois
   (36 verrous de mois, car l'intervalle MMR franchit les années). « Effacer » ne verrouille que les mois de sa période.
3. `SET LOCAL lock_timeout = '20s'` (échéance partagée), puis relecture + comparaison d'empreinte.
4. **Lignes de sites/localités** par `id` croissant (`FOR KEY SHARE` pour qui y attache une visite ; `FOR UPDATE`
   pour qui les modifie).
5. **Ligne de contrat**, puis **verrou d'attribution T** (`tpm-attribution:<tenant>`) **en dernier**.
6. Documents, visites (**toujours par id**), journal.

Jamais une ligne de site/localité/contrat **après** le verrou d'attribution. Verrou non bloquant d'abord
(`pg_try_advisory_xact_lock`) ; si contendu, attendre seulement le temps **restant** à l'échéance partagée ;
épuisement → `55P03` → **503 « réessayez »** (la connexion repart au pool, les écrivains ne meurent pas de faim).
`lockAttributionTx`/`mems_tpm_stamp` **restaurent** le `lock_timeout` de l'appelant (jamais DEFAULT/0).

## 9. Critères d'acceptation (écris ces tests)

**Socle / activation (A).**
1. Année sans aucune grille → tous les sites actifs ; dès une case saisie → cases vides inactives.
2. Case vide à l'import = mois inchangé ; `blankFill` ne touche que les cases vides ; un Oui/Non saisi jamais écrasé.
3. Zone interdite (99) → jamais active côté serveur, même « Oui ». `public_id` immuable (UPDATE rejeté). Journal append-only.
4. État + journal dans la même transaction ; `UNKNOWN_SITE → 400` sans écriture.

**RBM (B).**
5. Fréquence : élevé=1, moyen=2, faible=3 ; `isDue` vraie si jamais visité ou absence ≥ fréquence.
6. Dernière visite effective = max(réalisée, données, registre) ; une visite **planifiée** ne rend jamais à jour.
7. `scoreSite` : urgent ⇒ FINAL 2 ; Σ points des raisons = `riskPoints` (fraude ×2).
8. « Générer » idempotent (2ᵉ clic = 0) ; ne planifie pas un site inactif/annulé/déjà prévu/zone interdite.

**Planification (C).**
9. `deriveMmr` reproduit `interval/frequency/targetedPerMonth/adjustedInterval` (sur valeurs exactes, round2 à l'affichage).
10. Écart = `ceil(intervalle)` réduit par la contrainte de durée ; visites exigées ≤ remaining (= required − réalisé − planifié à venir).
11. Jamais un mois échu (mesuré au mois courant) ; replanifier le 2ᵉ semestre ne replanifie pas le 1ᵉʳ.
12. Ressources en entiers (U=252000) ; coût visite = `ceil(U/v)` ; `ceil(Σunités/U)` journées-agent ; créneau « Agent N » réservé sur toute sa durée.
13. **L'oracle `checkInvariants` renvoie 0 violation** sur des jeux variés (le test le plus important).
14. `apply` : empreinte changée → 409 ; relancer `apply` n'ajoute rien ; totaux réconciliés ; 503 sur timeout de verrou.

**TPM (transverse B+C).**
15. Toute visite zone insérée sort du COMMIT avec un TPM (déclencheur différé) ; `provider_id` = seule vérité ;
    facturé/réalisé/annulé/figé jamais ré-estampillés ; parité SQL ↔ JS de la cellule.

---

### Notes de fidélité
- Reproduis les **modules purs d'abord** (`activationMath`, `rbmMath`, `rbmScore`, `mmrMath`, `planAuto`,
  `planResources`, `planAutoInvariants`, `siteActivity`, `officeScope`, `localDay`, `period`) avec leurs tests ;
  le repository/SQL vient ensuite. La fonction `generatePlan` doit être **pure et déterministe** (mêmes entrées →
  même plan) — c'est ce qui autorise la double vérification d'empreinte.
- Garde les jumeaux SQL ↔ JS **strictement** équivalents (règle d'activité, cellule TPM, clé d'activité,
  sous-arbre bureau) et prouve la parité par un banc.
- N'invente aucun champ : chaque valeur a une source (MMR, RBM, registre, visites). En cas de doute entre deux
  définitions, la plus **concrète/contrefactuelle** gagne (raison de non-couverture, dernière visite effective).
