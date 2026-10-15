# Revue du Plan de suivi (lecture seule)

_Revue indépendante par la session `claude/zealous-bardeen-p9ozcr`, 15/10/2026.
Aucun code modifié — document d'aide au lot 4 (réalisé issu des données) et aux
branches en cours (`wip/lot5-gen`, `wip/r58`, `wip/perf`). Chaque constat cite le
fichier et la ligne vérifiés sur `main` @ `1e7eba4`._

## 1. Périmètre revu

- Écran : `web/src/pages/monitoring/PlanBoardPage.jsx` (classeur « type Excel », 4 vues
  plan · standard · visités · carte) + `web/src/lib/planBoard.js` (calculs d'affichage).
- Logique pure serveur : `server/src/modules/tpm/planBoard.js`, `fieldMath.js`,
  `rbmMath.js`, `rbmScore.js`.
- Alimentation : `server/src/modules/tpm/field.repository.js` (requêtes du plan).

Principe d'architecture confirmé et sain : **le serveur fait foi** (il recalcule à
l'enregistrement) ; le client ne fait que refléter en direct les coches en attente.

## 2. Points vérifiés — sains (avec preuve)

1. **Les visites annulées sont exclues à la source.** Les mois d'un site sont bâtis
   avec `status IN ('realise','planifie')` (`field.repository.js:182`) et le tableau
   `planned` ne prend que `status = 'planifie'` (`:180`). Conséquence : le pied de
   grille client qui compte toutes les cellules de mois (`lib/planBoard.js:78`) **ne
   surcompte pas** les annulées — elles n'y figurent jamais. ✅
   _Remarque : cette correction repose sur un invariant implicite (voir §3.3)._

2. **KPI client = KPI serveur.** `boardKpis` est dupliqué à l'identique
   (`lib/planBoard.js:40-59` ↔ `server/.../planBoard.js:73-91`) : mêmes champs, mêmes
   règles (`active` = ni interdit ni inactif, `mmrRate` = min(done, required)/required,
   `withoutPlan`, `neverVisited`, `unparametered`). ✅

3. **Scoring RBM cohérent (retour 48).** Dans `rbmScore.js` :
   - la somme des points des `reasons` est exactement `riskPoints`
     (`:79-91` vs `:151`) — la justification « colle » au score ;
   - `due = overdue` **ignore** la priorité (`:171`) : un site urgent mais visité le
     mois dernier n'est pas « à suivre » ce mois — conforme à la résolution du
     retour 48 (« à jour · dernière visite il y a 0 mois » ne doit pas être dû) ;
   - `urgentFlags` (`:148`) et `forbidden` (`:134`, sécurité ≥ 99) pilotent bien
     `finalScore = 2` et le retrait de la planification. ✅

4. **`rbmMath` robuste.** `lastVisitOf` prend le mois max avec priorité
   visite > données > registre à égalité (`:69-76`) ; `isDue` se garde d'une
   « dernière visite dans le futur » (`diff < 0 → false`, `:56`) ;
   `needsPlanning` exclut annulé-ce-mois et inactif-ce-mois (`:123-129`) ;
   `planningCounts` compte `due` hors zones interdites (`:136-146`). ✅

## 3. Observations / risques (non bloquants)

### 3.1 `addMonths` — modulo sur index potentiellement négatif
`rbmMath.js:37-43` calcule `idx = y*12 + (mo-1) + n` puis `idx % 12`. En JavaScript,
`%` d'un nombre négatif rend un reste négatif → un mois invalide. Pour des années
réelles (2026…) `idx` est largement positif : **aucun impact en pratique**, mais une
entrée aberrante (année 0, `n` très négatif) produirait `-1` au lieu d'un mois.
_Suggestion : `((idx % 12) + 12) % 12` pour être robuste. Trivial, à faire par la
branche qui possède déjà `rbmMath.js` si elle le touche._

### 3.2 `boardKpis` dupliqué client/serveur — risque de dérive
Les deux copies sont identiques aujourd'hui, mais rien ne garantit qu'elles le
restent : une branche qui change une règle d'un seul côté créerait un écart
silencieux entre l'affichage en direct et le recalcul à l'enregistrement.
_Suggestion : un test de parité (le serveur expose les règles, le client les
importe), ou au minimum un commentaire croisé « miroir de … » dans les deux fichiers
(déjà présent côté client `:2-5`, à ajouter côté serveur)._

### 3.3 Pied de grille (`monthTotals`) — invariant implicite
`lib/planBoard.js:78` compte toutes les cellules de `s.months` sans filtrer le statut.
C'est correct **uniquement parce que** la requête exclut déjà les annulées (§2.1). Si
une évolution de `field.repository.js` ajoutait un jour les annulées dans `months`
(pour, par exemple, les afficher barrées dans la grille), le footer les compterait à
tort. _Suggestion : filtrer explicitement `m.status === 'planifie' || m.status ===
'realise'` dans `monthTotals`, pour rendre l'invariant local et sûr._

## 4. Lien avec les chantiers en cours — aide concrète

- **Lot 4 (réalisé issu des données, retours 15/21/22/26).** La logique pure
  nécessaire existe déjà en grande partie : `fieldMath.factsOf` + `common/siteActivity.ratesOf`
  donnent sites actifs / prévus / réalisés distincts et les trois taux
  (couverture, planification, exécution) sur une période ; `shapeCoverageFacts`
  produit déjà un `byActivity`. Le **tableau « par sous-activité » du retour 26**
  (Sub-Activity · Description · sites actifs/prévus/réalisés · MMR %) a désormais une
  source de libellé propre : le référentiel **sous-activités** livré au retour 92
  (`sub_activities`, `code` = `sites.tag_code`). Grouper les faits de couverture par
  `tag_code` puis joindre `sub_activities.label`/`info` donne directement les colonnes
  Sub-Activity / Description sans texte libre.

- **`wip/r58` (affectation TPM) et `wip/lot5-gen` (génération auto).** Aucun conflit
  détecté avec les modules purs ci-dessus : ils touchent `field.repository`,
  `plan.*`, `tpmAttribution.*` mais pas `rbmMath`/`rbmScore`/`planBoard.js`. Les
  invariants §3 valent quelle que soit la branche qui gagne la fusion.

## 5. Conclusion

Le plan de suivi est **fonctionnellement sain** : calculs serveur qui font foi, miroir
client fidèle, scoring RBM expliqué et cohérent, annulées correctement exclues. Les
trois observations du §3 sont des durcissements préventifs, pas des bugs actuels. Le
cœur étant en cours de réécriture par quatre branches, ces durcissements et le tableau
par sous-activité (retour 26) sont à intégrer par les chantiers qui possèdent déjà ces
fichiers, pour éviter tout conflit de fusion.
