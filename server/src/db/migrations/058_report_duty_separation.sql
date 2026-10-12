-- MEMS 2.0 — Rapports TPM : séparation des tâches imposée EN BASE.
--
-- Mêmes règles que le module pur server/src/modules/tpm/reportWorkflow.js
-- (le service les applique d'abord ; la base est le filet de sécurité, y
-- compris pour un script ou une requête qui contournerait l'API) :
--
--  (1) Auteur du contenu : tpm_reports.edited_by / edited_at = la personne qui
--      a rempli l'état des dépenses (dernier éditeur). Seul l'auteur modifie
--      et soumet ; un gabarit mensuel vierge (edited_by NULL) est pris en
--      charge par la première personne qui le remplit.
--  (2) Machine d'états : seules les transitions de reportWorkflow.TRANSITIONS
--      sont acceptées (un rapport validé est définitif).
--  (3) Contenu figé hors brouillon : postes (contract_report_items) et
--      montants / n° de facture / avance d'un rapport ne changent qu'au statut
--      « attendu » ou « rejeté ». Un rapport soumis attend la décision sur
--      exactement ce qui a été soumis.
--  (4) Décision (valide / rejete) : decided_by renseigné, différent du
--      soumetteur ET de l'auteur du contenu (à défaut : du créateur).
--  (5) Un rapport soumis, validé ou rejeté a un soumetteur (CHECK).
--
-- Violations → SQLSTATE 23514 → 400 par le gestionnaire central (l'API a déjà
-- répondu 403/409 avec un message clair avant d'en arriver là).
--
-- NB : une future migration de reprise qui doit corriger le contenu d'un
-- rapport soumis ou validé désactive explicitement ces déclencheurs le temps
-- de la correction (ALTER TABLE … DISABLE TRIGGER trg_tpm_report_guard /
-- trg_report_items_guard) — jamais en silence.

-- ---------------------------------------------------------------------------
-- (1) Auteur du contenu
-- ---------------------------------------------------------------------------
ALTER TABLE tpm_reports ADD COLUMN IF NOT EXISTS edited_by uuid REFERENCES users(id);
ALTER TABLE tpm_reports ADD COLUMN IF NOT EXISTS edited_at timestamptz;

-- Reprise : un rapport déjà sorti du gabarit a été rempli par son créateur
-- (seul auteur connu). Un gabarit « attendu » reste sans auteur : la
-- première personne qui le remplit le prend en charge.
UPDATE tpm_reports
   SET edited_by = created_by, edited_at = COALESCE(submitted_at, created_at)
 WHERE edited_by IS NULL AND status <> 'attendu';

-- La référence edited_by → users passe aussi le contrôle « même compte » (049).
SELECT mems_install_same_tenant('tpm_reports');

-- ---------------------------------------------------------------------------
-- (5) Soumetteur obligatoire dès la soumission (048 a repris l'existant).
-- ---------------------------------------------------------------------------
UPDATE tpm_reports SET submitted_by = created_by
 WHERE submitted_by IS NULL AND status IN ('soumis', 'valide', 'rejete');
ALTER TABLE tpm_reports DROP CONSTRAINT IF EXISTS tpm_reports_submitted_by_check;
ALTER TABLE tpm_reports ADD CONSTRAINT tpm_reports_submitted_by_check
  CHECK (status NOT IN ('soumis', 'valide', 'rejete') OR submitted_by IS NOT NULL);

-- ---------------------------------------------------------------------------
-- (2) (3) (4) Garde du rapport
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION mems_tpm_report_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
    -- transitions: reportWorkflow.TRANSITIONS (vérifié par test/reportWorkflow.test.js)
    IF (OLD.status, NEW.status) NOT IN (
         ('attendu', 'soumis'), ('attendu', 'non_applicable'),
         ('soumis', 'valide'), ('soumis', 'rejete'), ('soumis', 'non_applicable'),
         ('rejete', 'soumis'), ('rejete', 'non_applicable')
       ) THEN
      RAISE EXCEPTION USING ERRCODE = '23514',
        MESSAGE = format('Transition de statut interdite pour un rapport : %s → %s.', OLD.status, NEW.status);
    END IF;
  END IF;

  -- editable: reportWorkflow.EDITABLE
  IF TG_OP = 'UPDATE' AND OLD.status NOT IN ('attendu', 'rejete')
     AND ROW(NEW.reported_amount, NEW.planned_amount, NEW.invoice_no, NEW.period_end, NEW.advance_deducted,
             NEW.reference, NEW.document_name, NEW.edited_by, NEW.kind, NEW.partner_id, NEW.contract_id, NEW.period_month)
         IS DISTINCT FROM
         ROW(OLD.reported_amount, OLD.planned_amount, OLD.invoice_no, OLD.period_end, OLD.advance_deducted,
             OLD.reference, OLD.document_name, OLD.edited_by, OLD.kind, OLD.partner_id, OLD.contract_id, OLD.period_month) THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      MESSAGE = format('Rapport %s : son contenu ne peut plus être modifié.',
                       CASE OLD.status WHEN 'valide' THEN 'validé' WHEN 'non_applicable' THEN 'non applicable' ELSE OLD.status END);
  END IF;

  IF NEW.status IN ('valide', 'rejete')
     AND (TG_OP = 'INSERT' OR NEW.status IS DISTINCT FROM OLD.status) THEN
    IF NEW.decided_by IS NULL
       OR NEW.decided_by = COALESCE(NEW.submitted_by, NEW.created_by)
       OR NEW.decided_by = COALESCE(NEW.edited_by, NEW.created_by) THEN
      RAISE EXCEPTION USING ERRCODE = '23514',
        MESSAGE = 'Séparation des tâches : un rapport est validé ou rejeté par une autre personne que celle qui l''a soumis ou rempli.';
    END IF;
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_tpm_report_guard ON tpm_reports;
CREATE TRIGGER trg_tpm_report_guard BEFORE INSERT OR UPDATE ON tpm_reports
  FOR EACH ROW EXECUTE FUNCTION mems_tpm_report_guard();

-- ---------------------------------------------------------------------------
-- (3) Postes figés hors brouillon
-- ---------------------------------------------------------------------------
-- Le rapport parent est relu (clé primaire). Absent lors d'un DELETE : c'est la
-- suppression en cascade du rapport lui-même (ou de son contrat), permise.
CREATE OR REPLACE FUNCTION mems_report_items_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  rid uuid;
  st text;
BEGIN
  FOREACH rid IN ARRAY CASE TG_OP
      WHEN 'INSERT' THEN ARRAY[NEW.report_id]
      WHEN 'DELETE' THEN ARRAY[OLD.report_id]
      ELSE ARRAY[OLD.report_id, NEW.report_id] END
  LOOP
    SELECT status INTO st FROM tpm_reports WHERE id = rid;
    IF NOT FOUND THEN
      IF TG_OP = 'DELETE' THEN CONTINUE; END IF;
      RAISE EXCEPTION USING ERRCODE = '23503', MESSAGE = 'Rapport introuvable pour ce poste de l''état des dépenses.';
    END IF;
    -- editable: reportWorkflow.EDITABLE
    IF st NOT IN ('attendu', 'rejete') THEN
      RAISE EXCEPTION USING ERRCODE = '23514',
        MESSAGE = format('État des dépenses figé : le rapport est %s (modifiable seulement attendu ou rejeté).',
                         CASE st WHEN 'valide' THEN 'validé' WHEN 'non_applicable' THEN 'non applicable' ELSE st END);
    END IF;
  END LOOP;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_report_items_guard ON contract_report_items;
CREATE TRIGGER trg_report_items_guard BEFORE INSERT OR UPDATE OR DELETE ON contract_report_items
  FOR EACH ROW EXECUTE FUNCTION mems_report_items_guard();
