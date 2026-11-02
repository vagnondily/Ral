# Dashboard « Suivi de processus » — code de construction (archive)

Ce dossier archive le **code** qui transforme le dashboard HTML hors ligne de suivi de processus (fichier autonome, ouvert dans un navigateur) en sa version 3. **Il ne contient aucune donnée** : le fichier d'origine, qui embarque les fiches, les visites, les noms des agents et les positions GPS, reste chez son propriétaire et n'est jamais versionné (le dépôt est public).

## Reconstruire le fichier

```bash
node build3.js --src /chemin/vers/Dashboard_d_origine.html --out Dashboard.html            # version de test (#debug possible)
node build3.js --src /chemin/vers/Dashboard_d_origine.html --out Dashboard.html --release  # version à diffuser
```

`build3.js` lit le script `#app-js` du fichier d'origine, applique les correctifs de chaque lot dans un ordre fixe, injecte les modules et le CSS, puis recalcule les empreintes de la politique de sécurité (CSP). Chaque correctif cherche un texte exact : s'il ne le trouve pas exactement le nombre de fois attendu, la construction s'arrête (jamais de remplacement silencieux).

| Lot | Contenu |
|---|---|
| `engine/` | fenêtre de dates dynamique, constats et méthodologie recalculés à chaque ouverture, barèmes et seuils uniques |
| `core/` | barre de filtres unique (district, filtres conservés après mise à jour), tiroir de détail, couverture unique (`covCalc`), règle des petits effectifs, design |
| `agents/` | notation des agents, organisations de suivi et partenaires de mise en œuvre (une seule fonction, critères non mesurés neutralisés), onglets Agents / Partenaires / Qualité |
| `map/` | carte : recadrage selon les filtres, synthèse de la sélection, fiches site / région, couleur par activité |
| `planning/` | planification RBM unique (intervalle minimal entre deux suivis = fréquence RBM, MMR = plancher), grille, capacité, exports, import Kobo / ONA / MoDA |
| `overview/` | vue d'ensemble, activités, alertes par gravité, registre des cas, rapport versionné, méthodologie |
| `pilotage/` | page de synthèse pour la direction (si présente) |
| `share/` | « Version à partager » : agents pseudonymisés, positions ramenées au site, réponses libres retirées, lecture seule |
| `security/` | mot de passe renforcé et à changer, verrouillage automatique, stockage local cloisonné, Trusted Types, exports sensibles réservés à l'administrateur |

## Tester

```bash
node tests/test-dash.cjs Dashboard.html                                   # tous les onglets, 0 erreur console / page / CSP attendue
node tests/test-dash.cjs Dashboard.html --tabs Vue --debug --eval tests/test-update.js   # mise à jour simulée : chiffres et textes doivent changer
node tests/test-export.cjs Dashboard.html export.html                     # export puis réouverture
```

Les tests utilisent Playwright (Chromium). `--debug` n'existe que dans la version de test : la version `--release` retire toute accroche de test.

## Règles d'écriture

`STYLE.md` : écrans légers, titres courts, explications dans les infobulles « i » et les tiroirs de détail.
