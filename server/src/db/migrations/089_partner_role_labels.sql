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
