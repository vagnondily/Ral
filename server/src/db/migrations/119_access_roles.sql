-- Rôles d'accès : passage de 3 à 5 rôles (retour « contrôle total des accès »).
--   viewer (lecteur) · editor (éditeur) · validator (validateur) · admin (administrateur) · superuser (super-utilisateur)
-- L'ancien rôle `manager` (le validateur d'avant) devient `validator` : même pouvoir
-- (écrire ET valider). `editor` est nouveau (écrit sans valider) ; `superuser` est nouveau
-- (gère les administrateurs, les réglages de sécurité et, à terme, le niveau Siège).
-- Capacités et compat dans server/src/modules/common/accessRoles.js (les jetons déjà émis
-- portent encore `manager` → normalisé à la volée côté API).

-- 1) La contrainte CHECK en ligne (migration 001) s'appelle users_role_check.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;

-- 2) Reprise des données : l'ancien validateur devient `validator`.
UPDATE users SET role = 'validator' WHERE role = 'manager';

-- 3) Nouvelle contrainte : les cinq rôles courants (plus `manager` toléré par sécurité
--    si un ancien enregistrement subsiste, sans jamais en créer de nouveau).
ALTER TABLE users ADD CONSTRAINT users_role_check
  CHECK (role IN ('viewer', 'editor', 'validator', 'admin', 'superuser', 'manager'));
