-- MEMS 2.0 — Retour 113 : un seul glossaire des rôles d'un partenaire. Migration 089.
--
-- Le type « prestataire » désigne les TITULAIRES des contrats FLA, qui mettent le programme en
-- œuvre sur les sites : il s'appelle désormais « Partenaire de mise en œuvre ». Le type « tpm »
-- (tierces parties de suivi, payées sur la ligne IV.suivi du contrat qu'elles suivent ou par leur
-- propre contrat) s'écrit « TPM — tierce partie de suivi ». « Partenaire » reste le mot générique.
-- Les codes ne changent pas (toutes les règles s'appuient sur eux) ; seuls les libellés d'ORIGINE
-- sont remplacés — un libellé déjà personnalisé par un compte est gardé.

UPDATE partner_types SET label = 'Partenaire de mise en œuvre'
 WHERE code = 'prestataire' AND label = 'Prestataire';
UPDATE partner_types SET label = 'TPM — tierce partie de suivi'
 WHERE code = 'tpm' AND label = 'TPM (Tierce partie de suivi)';

-- Un plan de collecte ou une facture / un rapport se rattache à une TIERCE PARTIE DE SUIVI : le
-- partenaire d'un tpm_collection_plans ou d'un tpm_reports est de type « tpm » (décision D1 du
-- 20/10 : un partenaire de mise en œuvre n'est jamais le TPM d'un contrat). Contrôlé à l'écriture
-- du partenaire seulement (création, changement) : un TPM désactivé ou retypé plus tard garde ses
-- documents. L'application refuse aussi (400, « fiche active » comprise) avant d'écrire.
CREATE OR REPLACE FUNCTION mems_tpm_document_partner() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.partner_id IS NOT DISTINCT FROM OLD.partner_id THEN RETURN NEW; END IF;
  IF NOT EXISTS (SELECT 1 FROM partners p JOIN partner_types t ON t.id = p.partner_type_id AND t.tenant_id = p.tenant_id
                  WHERE p.id = NEW.partner_id AND p.tenant_id = NEW.tenant_id AND t.code = 'tpm') THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      MESSAGE = 'Le partenaire d''un plan de collecte ou d''une facture doit être un TPM (tierce partie de suivi).';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_tpm_document_partner ON tpm_reports;
CREATE TRIGGER trg_tpm_document_partner BEFORE INSERT OR UPDATE OF partner_id ON tpm_reports
  FOR EACH ROW EXECUTE FUNCTION mems_tpm_document_partner();
DROP TRIGGER IF EXISTS trg_tpm_document_partner ON tpm_collection_plans;
CREATE TRIGGER trg_tpm_document_partner BEFORE INSERT OR UPDATE OF partner_id ON tpm_collection_plans
  FOR EACH ROW EXECUTE FUNCTION mems_tpm_document_partner();
