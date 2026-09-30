-- Rôle applicatif DÉDIÉ à MEMS 2.0 : mems2_app. Les rôles PostgreSQL sont
-- globaux au serveur : on n'utilise donc PAS un rôle partagé (comme un ancien
-- « mems_app » d'un autre déploiement MEMS), pour ne jamais changer son mot de
-- passe ni le casser.
--
-- Idempotent : crée mems2_app s'il manque, (re)force son mot de passe et ses
-- attributs, et lui accorde les droits sur toutes les tables — utile aussi pour
-- une base déjà migrée précédemment avec un autre rôle. Ne touche jamais
-- mems_app.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mems2_app') THEN
    ALTER ROLE mems2_app WITH LOGIN PASSWORD 'mems2_app_change_me' NOSUPERUSER NOBYPASSRLS;
  ELSE
    CREATE ROLE mems2_app LOGIN PASSWORD 'mems2_app_change_me' NOSUPERUSER NOBYPASSRLS;
  END IF;
END $$;

GRANT CONNECT ON DATABASE mems2_tpm TO mems2_app;
GRANT USAGE ON SCHEMA public TO mems2_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO mems2_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO mems2_app;
