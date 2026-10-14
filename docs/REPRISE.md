# Reprise du travail — passation entre sessions Claude

_Mis à jour : 14/10/2026, 13:55 UTC, par la session principale (branche `claude/practical-meitner-2c1560`, identique à `main`).
Tenu à jour à chaque étape ; détail heure par heure dans [`JOURNAL.md`](JOURNAL.md)._

**À qui s'adresse ce fichier ?** À toute session Claude qui reprend le projet, en particulier pendant une limite d'usage de la session principale. Il dit :
- ce qui est publié ;
- ce qui est en cours et qui le fait ;
- ce qui reste, et dans quel ordre ;
- comment travailler à deux sans se marcher dessus.

## 0. À lire, dans cet ordre

1. `CLAUDE.md` : règles du projet.
2. Ce fichier, puis le tableau « État courant » de [`JOURNAL.md`](JOURNAL.md).
3. [`RETOURS_UTILISATEUR.md`](RETOURS_UTILISATEUR.md) : chaque retour (n° 1 à 94) et son état. [`ETAT_DU_PROJET.md`](ETAT_DU_PROJET.md) : la synthèse.
4. [`PLAN_RETOURS_15_37.md`](PLAN_RETOURS_15_37.md) : **définitions communes**, qui s'imposent à tous.
5. Spécifications :
   - [`SPEC_LOT_1B.md`](SPEC_LOT_1B.md) et [`SPEC_LOT_6A.md`](SPEC_LOT_6A.md) (publiés) ;
   - [`SPEC_LOT_7A.md`](SPEC_LOT_7A.md) (en cours) ;
   - [`SPEC_LOT_5.md`](SPEC_LOT_5.md) (v1 et sa critique).
6. [`reprise/AGENTS_EN_COURS.md`](reprise/AGENTS_EN_COURS.md) : la consigne exacte des agents.

## 1. Publié sur `main` (14/10, 12:40)

- **Lots 0 et 1.** Fiabilité des imports, mois de collecte = date d'enquête, mapping validé, indicateurs, règles des tableaux de bord, RBM expliqué.
- **Lot 1b.** Période « du … au … » partout. Sites comptés une fois sur la période. Couverture (sites) séparée de l'Exécution du plan (visites). Budget de la période en centimes entiers.
- **Lot 6a.** Carte exploitable : contours des districts, thèmes, légende, points, export image / A4, section carte du Dashboard décisionnel. Un site n'est jamais rangé, ni dessiné, dans le district d'une autre région.
- **Retour 56 (autre session).** Suppression des documents et journal des suppressions (migration 065). Menu et anglais corrigés par la session principale.
- **Retour 57, socle (autre session).** Point dans polygone, lecture des contours `.shp`, localisation GPS.
- **Registre des sites.**
  - Onglet **Localités › Sites** (page d'origine de l'autre session, migration 066, reprise par la session principale).
  - Sélection multiple et actions groupées ; suppression protégée et expliquée ; dernière collecte par site.
  - Codes saisis jamais repris ; option d'affichage des codes Adm (migration 067).
- **Fiches de suivi.** Renommer, changer l'activité, voir la liste des choix (retours 59, 66).
- **Outil de contrôle des écrans.** `node web/scripts/sweep-ecrans.cjs` : 33 écrans en FR et EN.

- **Revue du retour 56** (`31e015b`) : refus qui nomme les données reliées, justificatif ≥ 10 caractères (migration `068`), document validé réservé à l'administrateur. **Retour 79** : zones d'intervention du contrat en tableau.
- **Retours 89 et 90** (`ac6eccf`) : suppression groupée de sites avec aperçu ; sites et activités par unité du répertoire.

**Santé de `main`** (13:54) : 1 019 tests (1 018 réussis, 1 ignoré), lint propre, build OK, balayage 33 écrans × FR / EN sans erreur. Migrations `001` → `068`.

**Ancienne mesure (12:40)** : 937 tests (936 réussis, 1 ignoré), lint propre, build OK, balayage de 33 écrans × FR / EN sans erreur ni phrase anglaise manquante. Migrations `001` → `067`, essayées sur une base neuve et sur une copie de la base existante.

## 2. Où est le code

| Branche | Sur GitHub | Contenu | État |
|---|---|---|---|
| `main` = `claude/practical-meitner-2c1560` | oui | Tout ce qui est publié | ✅ |
| `wip/1b-core`, `wip/1b-rest`, `wip/6a`, `wip/fix-1b`, `wip/fix-6a` | oui | Lots 1b et 6a et leurs corrections | ✅ **fusionnées dans `main`** — ne plus y travailler |
| `wip/7a` | oui | Concepteur riche, partie 1 (C1 à C7) | ✅ **fusionnée dans `main`** (`e6e07f1`) ; la partie 2 (C8 à C13) part de `main` |
| `wip/r57-core` | oui | Réconciliation du socle GPS (un seul lecteur `.shp`), interrompue | ⏸️ le socle est déjà sur `main` (autre session) ; reste à fusionner `settings/shpReader.js` et `common/shpGeometry.js` (lot 3) |
| `claude/zealous-bardeen-p9ozcr` | oui | Autre session : retours 56 et 57, page Sites | ✅ fusionnée dans `main` par l'autre session (`e8624e0`) |
| `claude/friendly-carson-ze6mtp` | oui | Ancienne (09/10), déjà dans `main` | à ignorer |
| `wip/7a-p2` | oui (au fil de l'eau) | Agent : concepteur partie 2 — en-tête libre et modèles, annexes, orientation par page, figures (retours 87, 88) | 🔄 depuis 13:42 |
| `wip/ui-polish` | oui | Agent : sélecteur de période dans les fenêtres, onglet « Données », tableau de bord des fiches, carte (zoom bureau, activités, légende) (retours 80, 83, 85, 86, 94) | 🔄 depuis 13:42 |
| `wip/perf` | oui | Agent : lenteur mesurée puis corrigée, hors plan de suivi et hors Localités (retours 61, 84) | 🔄 depuis 13:42 |
| `wip/lot8` | oui | Agent : Partenaires & TPM — fiche 360°, formations, notation des agents, règle « prestataire actif » (retours 28.1–28.3, 30) | 🔄 depuis 13:47 |
| `wip/r58` | oui | Agent : TPM tiré des contrats, motif si modifié, onglet d'affectation (retour 58, migration 070) | 🔄 depuis 13:53 |
| `wip/lot5-gen` | oui | Agent : planification automatique d'après le RBM + paramètres (retour 82, lot 5 § 6–7, migrations 077–078) | 🔄 depuis 13:53 |

## 3. Chantiers : en cours et à venir

Les agents fonctionnent de nouveau depuis 13:37 : la vague prévue à 15:30 est lancée (voir § 2). La session principale intègre leurs branches sur `main` après contrôle, et réalise elle-même l'onglet « Sites (actifs / inactifs) » (retour 64).

| | Chantier | Retours | Qui | État |
|---|---|---|---|---|
| A | Vérification adverse de `main` (1b + 6a intégrés, sites, suppression) | — | session principale, 15:30 | ⏳ |
| B | Tableau trimestriel par activité → carte « Couverture par activité » de la Synthèse | 54, 76 | session principale | ✅ `18cbcd3` |
| C | Lots 3 et 4 : **sites actifs / inactifs** (grille Oui / Non par mois, classeur `mems_activation_2026_1.xlsx`), **révision du plan de suivi** (P / R, réalisé issu des données), identifiants `S-XXXX-XXXX`, plusieurs sites par site déclaré, GPS par contours | 21, 22, 23, 33, 46, 57, 64 | session principale : onglet « Sites (actifs / inactifs) » distinct (en cours) ; le reste ensuite | 🔄 |
| D | Lot 5 v2 : plan MMR réaliste, dispatch automatique selon la configuration, calendrier, priorités, risque daté, avec le retour 58 | 24, 25, 55, 58, 82 | agents `wip/lot5-gen` (§ 6–7) et `wip/r58` | 🔄 ; calendrier, risque daté, règles de priorité : ensuite |
| E | Lot 7a partie 2 + concepteur universel (calculs personnalisés, tableaux croisés, en-tête libre) d'après les maquettes | 18, 39, 40, 51–53, 67, 72, 74, 87, 88 | agent `wip/7a-p2` | partie 1 publiée (`e6e07f1`) ; partie 2 🔄 |
| F | Tableaux de bord riches d'après les 5 XLSForm et les 4 maquettes | 40, 66, 67 | session principale | ⏳ conception |
| G | Sélection multiple de mois dans tous les filtres de date | 68 | — | ⏳ conception |
| H | Annuler une suppression depuis le journal | 60 | — | ⏳ conception |
| I | Performance avec beaucoup de données ou de calculs | 61, 84 | agent `wip/perf` | 🔄 (API < 250 ms partout ; lenteur à l'affichage) |
| J | Carte décisionnelle dédiée, modules **Output** (population, ciblage, plan de distribution, réalisé, logistique, connecteur DOTS / Palantir), **Programmes & projets** | 65 | — | ⏳ conception |
| K | PDD : vue d'ensemble, tableau des mois, lien avec l'Output, date d'ajout | 69 | — | ⏳ avec J |
| L | Reste de la revue du retour 56 : refus qui nomme la donnée reliée, avenants validés, rôle du valideur, justificatif ≥ 10 caractères, tests des routes | 56 | session principale | ✅ `31e015b` |
| M | Multi-pays : siège › bureau régional › bureau pays | 91 | agent (conception) | 🔄 `docs/SPEC_MULTIPAYS.md` |
| N | Programmes & projets, cycle de projet, cadre logique, bailleurs et financements, Output, carte décisionnelle, référentiel des activités | 65, 69, 73, 92, 93 | agent (conception) | 🔄 `docs/SPEC_PROGRAMMES.md` |
| O | Partenaires & TPM (lot 8) | 28, 30 | agent `wip/lot8` | 🔄 |
| P | Sous-tables (groupes répétés) à l'import, « Autre, précisez », indicateurs proposés pour vos fiches | 66, 77, 81, 85 | agent (analyse des 5 XLSForm) | 🔄 |

Fichiers fournis par l'utilisateur (non commités ; à demander s'ils manquent) :
- `mems_activation_2026_1.xlsx` (sites actifs, plan de suivi) ;
- 5 XLSForm : GD / PREVMA v2, MIARO PROD janv. 2026, Nutrition AIM, Résilience SAMS v2.1, SMP 2025-2026 ;
- 4 maquettes HTML : 2-pager SAMS, tableau de bord du suivi de processus, rapport de performances janvier–mai 2026, infographie SMP.

## 4. Travailler à deux sessions sans se marcher dessus

- **Branches.** Ne jamais pousser sur une branche `wip/…` ni sur la branche d'une autre session. Travailler sur sa propre branche partie de `main`, la noter ici (§ 3, colonne « Qui ») et dans le journal.
- **Réserver avant de commencer.** Un chantier déjà nommé dans la colonne « Qui » n'est pas repris sans le dire.
- **Numéros de migration** (ne jamais réutiliser un numéro, même sur une autre branche) :

  | N° | Usage | État |
  |---|---|---|
  | `061` | carte | ✅ |
  | `062`–`064` | lot 7a | ⏳ |
  | `065` | journal des suppressions | ✅ |
  | `066` | `sites.tag_code` | ✅ |
  | `067` | option des codes Adm | ✅ |
  | `068` | justificatif ≥ 10 caractères (retour 56) | ✅ |
  | `069` | agent `wip/ui-polish` (si besoin) | 🔄 |
  | `070`–`071` | retour 58 (agent `wip/r58`) | 🔄 |
  | `072`–`073` | lot 3 | ⏳ |
  | `074`–`076` | lot 4 | ⏳ |
  | `077`–`078` | lot 5 § 6–7 (agent `wip/lot5-gen`) | 🔄 |
  | `079`–`080` | lot 5, suite (calendrier, risque daté, règles) | ⏳ |
  | `081` | agent `wip/perf` (index, si besoin) | 🔄 |
  | `082`–`085` | multi-pays (conception) | ⏳ |
  | `086`–`089` | lot 8 (agent `wip/lot8`) | 🔄 |
  | `090`–`095` | programmes, projets, bailleurs, Output (conception) | ⏳ |
  | `096` et suivants | libres | — |

- **Publier sur `main`** seulement après :
  - `cd server && npm test && npm run lint` ;
  - `cd web && npm run build` ;
  - `node web/scripts/sweep-ecrans.cjs` (0 erreur, 0 phrase manquante) ;
  - les migrations essayées sur une base neuve **et** sur une copie de la base existante.

  Toujours en avance rapide de `main`, jamais en réécriture d'historique.
- **Contrôler ses ajouts.** Vérifier que chaque nouvelle page est déclarée dans le menu (`web/src/components/AppShell.jsx`, sinon l'adresse renvoie vers Contrats) et que ses textes ont leur traduction anglaise (`web/src/locales/en/*.js`).
- **Documents.** Le journal à chaque action (heure UTC réelle) ; l'état de chaque retour ; `ETAT_DU_PROJET.md` à chaque publication ; `CLAUDE.md` pour les règles durables ; **ce fichier** à chaque changement de chantier.

## 5. Environnement (conteneur cloud)

```sh
service postgresql start                       # base de démonstration mems2_tpm (migrations jusqu'à 067)
cd server && npm run migrate && npm run seed && npm run seed:test   # si base neuve
cd server && DATA_SOURCE_ALLOWED_HOSTS=localhost setsid nohup node src/server.js > /tmp/api.log 2>&1 < /dev/null &   # API :9000 (sans DATABASE_URL / APP_DATABASE_URL hérités : utiliser server/.env)
cd web && setsid nohup npx vite --port 5173 --strictPort > /tmp/vite.log 2>&1 < /dev/null &                          # interface :5173
node web/scripts/sweep-ecrans.cjs              # 33 écrans FR + EN (Playwright + Chromium préinstallés)
```

- Comptes de démonstration : `admin@mems.mg` / `changeme123` ; valideur `validateur@mems.mg`.
- Les agents travaillent chacun sur une base jetable et sur leurs propres ports. Ils n'arrêtent jamais :9000 ni :5173.

## 6. À confirmer par l'utilisateur, risques connus

- **156 soumissions Nutrition** sont datées d'août 2024 à décembre 2025 d'après leur seule SvyDate : ces dates sont-elles fiables ?
- **Connecteur DOTS / Palantir** (retour 65) : il faut l'adresse et les accès.
- **Classeur d'activation** : la colonne « Code POI » est décalée par rapport aux lignes.
- **Performance sur 12 à 24 mois** : 1,6 à 2 s sur le banc. C'est le chantier I.
