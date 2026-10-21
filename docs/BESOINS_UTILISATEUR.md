# Besoins utilisateur — file de travail (session 21/10/2026)

> Besoins exprimés par le propriétaire pendant la mise en production / configuration
> (base vierge `seed:blank`). Tenu à jour à chaque livraison. Ordre de traitement =
> recommandation de l'agent, validé par l'utilisateur (« selon tes recommandations »).
> Statuts : ⏳ à faire · 🔄 en cours · ✅ fait

## Déploiement & base (✅ livré)
- ✅ **Base vierge** `npm run seed:blank` (tenant + comptes seulement) — pour une mise en production propre.
- ✅ **Enregistrer l'identité du pays** avec centre (lat/lng) vide (400 corrigé).
- ✅ **Niveaux administratifs configurables depuis MEMS** (pré-remplis Région/District/Commune/Fokontany, + ajouter/retirer).
- ✅ Aide Windows : service NSSM unique, PATH PostgreSQL, `.env`, import du découpage (CSV/zip/dbf).

## Sites, bureaux & GPS (✅ en partie)
- ✅ **Bureau d'un site = périmètre Bureaux** (autorité sur le fichier importé ; ré-attribution à l'import et à l'enregistrement d'un périmètre).
- ✅ **GPS d'un site éditable** au registre (champs Latitude/Longitude).
- ✅ **GPS depuis les collectes** : remplir le GPS manquant d'un site par la médiane de ses soumissions (≥ 3 relevés).

## Carte & géolocalisation (🔄 en cours — chantier prioritaire)
- ✅ **Toujours afficher les sites visités**, même sans plan et même sans GPS précis :
  couche **« Centre du district (visités sans GPS) »** (activée par défaut) — chaque site visité sans
  position est compté au **centre de son district** (centroïde des contours fournis `mdg-adm2.v1.json`).
- ✅ **Un seul point par site** (GPS / collectes = un marqueur par site) ; le repli district agrège par
  district (un marqueur, nombre de sites) faute de coordonnées fines.
- ✅ **Popup** : **nombre de visites réalisées** sur un site (GPS/collectes) ; sur le marqueur district,
  la liste des sites visités avec leur nombre de visites.
- ⏳ **Rattachement soumissions → site** par **code de site** ou **GPS** (aujourd'hui : par commune / P-code seulement).

## Pouvoirs de l'admin (⏳ à cadrer)
- ⏳ **Modifier des paramètres déjà VALIDÉS** (ex. le budget d'un contrat actif, aujourd'hui modifiable
  seulement via avenant « par conception, pour l'audit »).
- ⏳ **Modifier/planifier sur des dates ANTÉRIEURES** (aujourd'hui : plans et visites des mois échus
  verrouillés — règles lot 1b).
- ⚠️ Conflit avec la priorité n° 1 (fiabilité / audit / immuabilité). Approche recommandée : **surpouvoir
  admin JOURNALISÉ** (modification autorisée MAIS inscrite dans un journal inaltérable : qui, quand,
  avant → après, motif) — le pouvoir sans perdre la traçabilité. À confirmer avant mise en œuvre.

## Organisation
- ✅ **Hiérarchie des bureaux à 6 niveaux** : Siège › Bureau régional › Bureau pays › Area Office › Sous-bureau › Antenne.
  Champ **« Niveau »** dans le formulaire Bureau (remplace « Nature »), colonne `office_level` (migration 117),
  `nature` dérivée pour compat, périmètre/arbre/RBM inchangés. (Premier pas du multi-pays.)
- 🗓️ **Multi-pays** (socle siège › pays ; `docs/SPEC_MULTIPAYS.md`) — **Option A validée** (un pays = un
  tenant isolé + arbre Siège → Régional → Pays ; Siège = totaux + consultation lecture seule). **Démarre
  APRÈS les petits restes**, en session dédiée, en 9 étapes sans rupture pour le mono-pays actuel.

## Ordre de traitement retenu
1. **Carte : tout voir** (repli district + dédup + nombre de visites en popup). ← en cours
2. Rattachement soumissions → site (code / GPS).
3. Hiérarchie des bureaux à 6 niveaux.
4. Multi-pays (création d'un pays avant configuration).
