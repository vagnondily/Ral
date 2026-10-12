/**
 * La base est-elle à jour pour ce code ? Compare les fichiers de
 * db/migrations à la table schema_migrations (lue par le rôle applicatif).
 *
 * Sert à DIRE la cause quand un `npm run migrate` a été oublié après une mise
 * à jour : au démarrage (journal), dans le gestionnaire d'erreurs (une colonne
 * ou une table manquante devient un 503 qui donne la marche à suivre au lieu
 * d'un 500 muet) et dans l'écran (bandeau pour l'administrateur).
 */
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, 'migrations');
// Dernier état connu : null tant qu'aucune vérification n'a abouti.
let lastPending = null;

/** Fichiers de migration présents dans le code mais pas encore appliqués (liste triée). */
function pendingFrom(files, applied) {
  const done = new Set(applied);
  return files.filter((f) => f.endsWith('.sql') && !done.has(f)).sort();
}

async function checkSchema(db) {
  // Pool chargé à la demande : le gestionnaire d'erreurs lit knownPending() sans ouvrir de connexion.
  const client = db || require('../config/db').pool;
  const files = fs.readdirSync(DIR);
  const { rows } = await client.query('SELECT filename FROM schema_migrations');
  lastPending = pendingFrom(files, rows.map((r) => r.filename));
  return lastPending;
}

/** Migrations en attente d'après la dernière vérification (null si inconnue). */
const knownPending = () => lastPending;

module.exports = { checkSchema, knownPending, pendingFrom };
