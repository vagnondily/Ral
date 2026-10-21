// Rôles d'accès et capacités — jumelle de server/src/modules/common/accessRoles.js.
// viewer · editor · validator · admin · superuser (du moins au plus étendu).
// L'ancien rôle `manager` (validateur d'avant) est lu comme `validator`.
export const ROLES = ['viewer', 'editor', 'validator', 'admin', 'superuser'];
export const RANK = { viewer: 1, editor: 2, validator: 3, admin: 4, superuser: 5 };
const LEGACY = { manager: 'validator' };

export const normalizeRole = (role) => LEGACY[role] || role;
const rankOf = (role) => RANK[normalizeRole(role)] || 0;

export const canWrite = (role) => rankOf(role) >= RANK.editor;        // editor+
export const canValidate = (role) => rankOf(role) >= RANK.validator;  // validator+
export const isAdminRole = (role) => rankOf(role) >= RANK.admin;      // admin+
export const isSuperRole = (role) => rankOf(role) >= RANK.superuser;  // superuser

// Libellés français des rôles (pour les menus et l'affichage).
export const ROLE_LABELS = {
  viewer: 'Lecteur',
  editor: 'Éditeur',
  validator: 'Validateur',
  admin: 'Administrateur',
  superuser: 'Super-utilisateur',
};
export const roleLabel = (role) => ROLE_LABELS[normalizeRole(role)] || role;
