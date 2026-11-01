# Sécurité de MEMS 2.0

Référence de sécurité du projet : ce qui protège l'application, les constats d'audit et leur suivi.
Dernière revue : **01/11/2026** (sur `main`), analyse statique + vérifications en direct sur une
instance d'audit isolée (API/UI en `NODE_ENV=production`, rôle restreint `mems2_app`, base jetable,
deux tenants, les 5 rôles).

## Pile
100 % JavaScript : Node.js/Express (API + worker), React 18/Vite (SPA), PostgreSQL 16 (RLS).
**Aucune dépendance PHP, Python, Ruby, Go ni Java.** Toutes les dépendances npm viennent du registre
officiel (aucune source git/http/file).

## Ce qui protège l'application (vérifié)
- **Multitenant par RLS.** Chaque table métier porte `tenant_id` + Row-Level Security ; l'API tourne
  via le rôle `mems2_app` (`NOSUPERUSER NOBYPASSRLS`) et chaque requête pose le GUC `app.tenant_id`
  dans `withTenantTransaction`. Le `tenant_id` vient **uniquement** de `req.auth` (jamais du corps).
  *Vérifié* : tenant B voit 0 contrat de A (liste), 404 sur un `GET`/`DELETE` par id d'un objet de A.
- **Contrôle d'accès par rôle.** Cinq rôles (viewer < editor < validator < admin < superuser),
  gardes `requireRole`/`WRITE`/`ADMIN` sur les routes. *Vérifié* : un lecteur reçoit 403 sur création
  de type de partenaire et d'utilisateur ; séparation des tâches (`validatorId === userId`) sur
  l'approbation des contrats.
- **Jetons.** JWT signé (HS256), vérifié à chaque requête ; `alg:none` et jeton sans signature
  refusés (401). Secret validé au démarrage (`validateEnv` : obligatoire et long en production).
- **SSRF.** Les connecteurs de données (`monitoring/remoteFetch.js`) : http(s) seulement, blocage des
  plages privées/locales/métadonnées (IPv4 **et** IPv6, mappées/NAT64/6to4), épinglage DNS
  (anti-rebinding), revalidation de chaque redirection, retrait des en-têtes d'auth sur redirection
  cross-origin, taille et délai plafonnés, liste blanche optionnelle.
- **Injection.** SQL : interpolations limitées à des identifiants issus du code ; valeurs toujours en
  paramètres liés. CSV : neutralisation des formules (`= + - @` préfixés). Validation zod à l'entrée
  **et** contraintes `CHECK`/`UNIQUE`/`FK` en base.
- **Images/téléversements.** Images d'en-tête servies avec `Content-Type` déduit des octets,
  `nosniff` et `Content-Security-Policy: default-src 'none'`. Imports via `xlsxGuard`/`zipGuard`/
  `fileSniff` (format reconnu par les octets, plafonds de décompression).
- **Gestion d'erreurs.** Un 500 ne renvoie qu'un message générique (ni pile ni exception) ; codes
  PostgreSQL mappés (23505→409, CHECK/FK→400, verrou/interblocage/délai→503).
- **Journaux.** `pino` masque mot de passe, jeton, `authorization`, `cookie` jusqu'à 3 niveaux.
- **En-têtes.** helmet (nosniff, HSTS, frameguard) ; `x-powered-by` désactivé ; `trust proxy` configuré.
- **Secrets.** Aucun secret commité (`.env` non suivi).

## Intégration continue

> Validée localement en rejouant chaque job (01/11). Le job « serveur base » a surfacé 2 tests
> pré-existants cassés (hors périmètre sécurité, présents sur `7a1825b`) : un test aux rôles obsolètes
> (`'admin'/'manager'` au lieu du modèle à 5 rôles, migration 119) et un test à précondition temporelle
> (site à 3 mois de couverture contrat-TPM) — corrigés (le 2ᵉ saute explicitement hors fenêtre). `test:db` :
> 49 réussis, 0 échec, 1 sauté.

`.github/workflows/ci.yml` : à chaque push / pull request — serveur (lint + tests unitaires + `npm
audit` bloquant sur « critical »), serveur sur base PostgreSQL jetable (migrate + seed + `test:db`),
build web. `.github/dependabot.yml` : montées de dépendances hebdomadaires (serveur, web, actions).

## Constats ouverts et suivi
| # | Gravité | Constat | État |
|---|---|---|---|
| 1 | Faible–Moyen | **Pas de révocation de session** : un compte désactivé / rôle abaissé garde son JWT valable jusqu'à expiration (8 h). | ✅ Fait (01/11 : contrôle `active`+rôle dans `requireAuth`, cache court, opt-in `SESSION_ACTIVE_CHECK=1`) |
| 2 | Faible | Gardes de rôle manquantes au niveau route sur approve/reject des contrats (défense en profondeur ; **non exploitable**, le service impose `validatorId === userId`). | ✅ Fait (01/11 : garde `VALIDATE` + test) |
| 3 | Faible | Énumération de l'état d'un compte au login (pending/désactivé distingués avant la vérification du mot de passe). | À traiter (message générique) |
| 4 | Faible | Avis `npm audit` serveur : body-parser (DoS), zod v3 (mémoire) — **DoS bornés par la limite 1 Mo** ; zod sans correctif en v3 (migration v4 cassante à planifier). Web : vite/esbuild = **dev uniquement**, absents de la production. | Suivi (CI + Dependabot) |
| 5 | Durcissement | CSP globale désactivée. | ✅ Fait (01/11 : CSP stricte `script-src 'self'`, vérifiée sur 46 écrans × FR/EN) |
| 6 | Durcissement | `jwt.verify` sans `algorithms:['HS256']` explicite ; limiteur de débit seulement sur `/login`. | ✅ Fait (01/11 : algorithme épinglé ; limiteur sur `/register` et `/activate`) |

## Fait le 01/11/2026
- Intégration continue (`ci.yml`) + suivi des dépendances (`dependabot.yml`).
- `docker-compose.yml` marqué « développement uniquement » ; ports PostgreSQL/Redis liés à `127.0.0.1`
  (plus exposés au réseau).
- Ce document.

## Fait le 01/11/2026 (2e envoi — correctifs de code)
- Gardes de rôle `VALIDATE` (valideur+) sur approuver/rejeter contrat et avenant, avec test de routes (`contractDecisionRoutes.test.js`) — défense en profondeur (le service impose déjà `validatorId === userId`).
- `jwt.verify` épingle l'algorithme `HS256` (jamais `none` ni asymétrique accepté par erreur).
- Limiteur de débit par IP sur `/api/auth/register` et `/api/auth/activate` (`SIGNUP_RATE_MAX`, 20/15 min par défaut).

## Fait le 01/11/2026 (3e envoi — révocation de session)
- **Révocation de session** (`modules/auth/sessionCheck.js`) : `requireAuth` revérifie en base, avec cache
  court par utilisateur (`SESSION_ACTIVE_TTL_MS`, 30 s par défaut), que le compte est toujours actif et
  rafraîchit son rôle — un compte désactivé, supprimé ou rétrogradé perd l'accès dans la fenêtre du cache
  sans attendre l'expiration du jeton. Activable par `SESSION_ACTIVE_CHECK=1` (recommandé en production ;
  désactivé par défaut pour ne rien changer sans configuration). Base injoignable → repli sur le jeton
  signé (disponibilité). Invalidation immédiate du cache à la désactivation / changement de rôle /
  suppression (`users.routes`). Tests : `sessionRevocation.test.js` (unitaire + routes) + vérification en
  direct (désactivation → 401 dans la fenêtre, réactivation → 200).
  **Levier complémentaire sans code** : réduire `JWT_EXPIRES_IN` (ex. `1h`) borne aussi la fenêtre.

## Fait le 01/11/2026 (4e envoi — CSP)
- **Content-Security-Policy** activée (`server/src/app.js`) : `script-src 'self'` STRICT (le build Vite ne produit aucun script en ligne), `object-src 'none'`, `base-uri`/`frame-ancestors`/`form-action 'self'` ; assouplissements ciblés `style-src 'unsafe-inline'` (styles React/Leaflet), `img-src 'self' data: blob: https:` (favicon, tuiles de carte, exports), `font-src 'self' data:`. **Pas** d'`upgrade-insecure-requests` (déploiement documenté en `http://SERVEUR:9000`). Escape hatch `CSP_DISABLED=1`. Vérifiée par le balayage : **46 écrans × FR/EN, 0 erreur console** (une violation CSP s'y afficherait). La route des images d'en-tête garde sa CSP `default-src 'none'` (plus stricte).

> **Les 6 constats de l'audit sont désormais traités.** Il ne reste que des montées de dépendances (suivies par Dependabot/CI) et, à terme, la migration zod v4 (cassante).

> Aucun constat n'est une exécution de code à distance ni une fuite de données : ce sont des écarts de
> durcissement et des DoS déjà bornés par les limites de taille en place.
