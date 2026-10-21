/**
 * Rôles d'accès et capacités — SOURCE UNIQUE (jumelle web : web/src/lib/accessRoles.js).
 *
 * Cinq rôles, du moins au plus étendu :
 *   viewer      — lecteur : consultation seule.
 *   editor      — éditeur : crée et modifie (brouillons, rapports…), NE valide PAS.
 *   validator   — validateur : éditeur + valide / décide (contrats, rapports, plans, mapping).
 *   admin       — administrateur : tout dans son pays, sauf les réglages réservés au super-utilisateur.
 *   superuser   — super-utilisateur : tout, y compris gérer les administrateurs, les réglages de
 *                 sécurité du compte (ex. « modifier à volonté ») et, à terme, le niveau Siège (multi-pays).
 *
 * Compatibilité : l'ancien rôle `manager` (le « validateur » d'avant) est lu comme `validator`
 * — les jetons déjà émis (8 h) le portent encore ; `normalizeRole` le convertit à la volée.
 */
const ROLES = ['viewer', 'editor', 'validator', 'admin', 'superuser'];
const RANK = { viewer: 1, editor: 2, validator: 3, admin: 4, superuser: 5 };
const LEGACY = { manager: 'validator' };

function normalizeRole(role) { return LEGACY[role] || role; }
function rankOf(role) { return RANK[normalizeRole(role)] || 0; }

// Capacités (un rôle supérieur a toujours les capacités des inférieurs).
const canWrite = (role) => rankOf(role) >= RANK.editor;        // editor+
const canValidate = (role) => rankOf(role) >= RANK.validator;  // validator+
const isAdmin = (role) => rankOf(role) >= RANK.admin;          // admin+
const isSuper = (role) => rankOf(role) >= RANK.superuser;      // superuser

// Ensembles de noms de rôle, pour requireRole(...) et les requêtes SQL (IN (...)).
const WRITE_ROLES = ROLES.filter(canWrite);        // editor, validator, admin, superuser
const VALIDATE_ROLES = ROLES.filter(canValidate);  // validator, admin, superuser
const ADMIN_ROLES = ROLES.filter(isAdmin);         // admin, superuser
const SUPER_ROLES = ROLES.filter(isSuper);         // superuser

module.exports = {
  ROLES, RANK, LEGACY,
  normalizeRole, rankOf,
  canWrite, canValidate, isAdmin, isSuper,
  WRITE_ROLES, VALIDATE_ROLES, ADMIN_ROLES, SUPER_ROLES,
};
