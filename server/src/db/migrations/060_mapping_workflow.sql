-- MEMS 2.0 — Mapping MEMS d'une fiche : cycle de vie, et mois de RÉCEPTION des
-- soumissions (retour n° 35, « mois de collecte »).
--
-- 1. monitoring_forms.mapping_* : le mapping « colonne du formulaire → dimension
--    MEMS » d'une fiche suit un cycle explicite (mêmes règles que le module pur
--    server/src/modules/monitoring/mappingWorkflow.js ; le service les applique
--    d'abord avec un message clair, la base est le filet de sécurité) :
--
--      brouillon ──Soumettre──▶ soumis ──Valider──▶ valide
--      soumis / valide ──Réinitialiser──▶ brouillon
--
--    Séparation des tâches : la personne qui valide n'est pas celle qui a soumis.
--    Un mapping soumis ou validé est figé : monitoring_field_map ne se modifie
--    qu'au statut « brouillon ». Appliquer le mapping aux soumissions reste
--    possible à tout statut (ce n'est pas une modification du mapping).
--    Violations → SQLSTATE 23514 → 400 (l'API a déjà répondu 409 / 403).
--
-- 2. monitoring_submissions.upload_month : mois de réception par le serveur Kobo
--    (_submission_time), à côté du mois de collecte (period_month = mois de la
--    date d'enquête quand elle est plausible, collectionDate.collectionMonth).
--    Sert à montrer, dans « Mapping MEMS », pour combien de soumissions le mois
--    de collecte diffère du mois de réception. Rempli à l'import, et pour les
--    soumissions déjà reçues par la réparation r3_mois_de_collecte (dataRepairs.js),
--    qui relit leurs réponses brutes : le SQL ne sait pas lire les dates SPSS.

-- ---------------------------------------------------------------------------
-- 1. Cycle de vie du mapping
-- ---------------------------------------------------------------------------
ALTER TABLE monitoring_forms
  ADD COLUMN IF NOT EXISTS mapping_status text NOT NULL DEFAULT 'brouillon',
  ADD COLUMN IF NOT EXISTS mapping_submitted_by uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS mapping_submitted_at timestamptz,
  ADD COLUMN IF NOT EXISTS mapping_validated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS mapping_validated_at timestamptz;

ALTER TABLE monitoring_forms DROP CONSTRAINT IF EXISTS monitoring_forms_mapping_status_check;
ALTER TABLE monitoring_forms ADD CONSTRAINT monitoring_forms_mapping_status_check
  CHECK (mapping_status IN ('brouillon', 'soumis', 'valide'));

-- Horodatages cohérents avec le statut (les auteurs, eux, deviennent NULL si leur compte est supprimé).
ALTER TABLE monitoring_forms DROP CONSTRAINT IF EXISTS monitoring_forms_mapping_dates_check;
ALTER TABLE monitoring_forms ADD CONSTRAINT monitoring_forms_mapping_dates_check CHECK (
  (mapping_status = 'brouillon' AND mapping_submitted_at IS NULL AND mapping_validated_at IS NULL)
  OR (mapping_status = 'soumis' AND mapping_submitted_at IS NOT NULL AND mapping_validated_at IS NULL)
  OR (mapping_status = 'valide' AND mapping_submitted_at IS NOT NULL AND mapping_validated_at IS NOT NULL));

-- Séparation des tâches, toujours vraie (même après coup).
ALTER TABLE monitoring_forms DROP CONSTRAINT IF EXISTS monitoring_forms_mapping_duty_check;
ALTER TABLE monitoring_forms ADD CONSTRAINT monitoring_forms_mapping_duty_check
  CHECK (mapping_validated_by IS NULL OR mapping_submitted_by IS NULL OR mapping_validated_by <> mapping_submitted_by);

CREATE OR REPLACE FUNCTION mems_mapping_status_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.mapping_status <> 'brouillon' THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Une nouvelle fiche commence avec un mapping en brouillon.';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.mapping_status IS DISTINCT FROM OLD.mapping_status THEN
    -- transitions: mappingWorkflow.TRANSITIONS (vérifié par test/mappingWorkflow.test.js)
    IF (OLD.mapping_status, NEW.mapping_status) NOT IN (
         ('brouillon', 'soumis'), ('soumis', 'valide'), ('soumis', 'brouillon'), ('valide', 'brouillon')
       ) THEN
      RAISE EXCEPTION USING ERRCODE = '23514',
        MESSAGE = format('Transition interdite pour le mapping : %s → %s.', OLD.mapping_status, NEW.mapping_status);
    END IF;
    IF NEW.mapping_status = 'soumis' AND NEW.mapping_submitted_by IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Un mapping soumis a un soumetteur.';
    END IF;
    IF NEW.mapping_status = 'valide'
       AND (NEW.mapping_validated_by IS NULL OR NEW.mapping_validated_by IS NOT DISTINCT FROM NEW.mapping_submitted_by) THEN
      RAISE EXCEPTION USING ERRCODE = '23514',
        MESSAGE = 'Séparation des tâches : le mapping est validé par une autre personne que celle qui l''a soumis.';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_mapping_status_guard ON monitoring_forms;
CREATE TRIGGER trg_mapping_status_guard BEFORE INSERT OR UPDATE OF mapping_status ON monitoring_forms
  FOR EACH ROW EXECUTE FUNCTION mems_mapping_status_guard();

-- Mapping figé hors brouillon. La fiche parent est relue (clé primaire) ; absente lors
-- d'un DELETE : c'est la suppression en cascade de la fiche elle-même, permise.
CREATE OR REPLACE FUNCTION mems_field_map_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  st text;
BEGIN
  SELECT mapping_status INTO st FROM monitoring_forms
   WHERE id = CASE TG_OP WHEN 'DELETE' THEN OLD.form_id ELSE NEW.form_id END;
  -- editable: mappingWorkflow.EDITABLE
  IF FOUND AND st NOT IN ('brouillon') THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      MESSAGE = format('Mapping %s : réinitialisez-le (retour en brouillon) avant de le modifier.',
                       CASE st WHEN 'valide' THEN 'validé' ELSE st END);
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_field_map_guard ON monitoring_field_map;
CREATE TRIGGER trg_field_map_guard BEFORE INSERT OR UPDATE OR DELETE ON monitoring_field_map
  FOR EACH ROW EXECUTE FUNCTION mems_field_map_guard();

-- Les références vers users passent aussi le contrôle « même compte » (migration 049).
SELECT mems_install_same_tenant('monitoring_forms');

-- ---------------------------------------------------------------------------
-- 2. Mois de réception des soumissions
-- ---------------------------------------------------------------------------
ALTER TABLE monitoring_submissions ADD COLUMN IF NOT EXISTS upload_month date;
ALTER TABLE monitoring_submissions DROP CONSTRAINT IF EXISTS monitoring_submissions_upload_month_check;
ALTER TABLE monitoring_submissions ADD CONSTRAINT monitoring_submissions_upload_month_check
  CHECK (upload_month IS NULL OR upload_month = date_trunc('month', upload_month)::date);
