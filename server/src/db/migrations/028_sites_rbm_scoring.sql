-- RBM — critères de scoring par site (bloc « RBM » du Plan de suivi) + GPS.
-- Chaque critère alimente le FINAL SCORE et la Priorité (rbmScore.scoreSite).
-- Tous à 0 par défaut (pas de risque particulier) ; GPS pour le rattachement
-- automatique au bureau (adm1-4).
ALTER TABLE sites ADD COLUMN IF NOT EXISTS security_situation    smallint NOT NULL DEFAULT 0 CHECK (security_situation BETWEEN 0 AND 2);
ALTER TABLE sites ADD COLUMN IF NOT EXISTS programme_synergies   smallint NOT NULL DEFAULT 0 CHECK (programme_synergies BETWEEN 0 AND 1);
ALTER TABLE sites ADD COLUMN IF NOT EXISTS beneficiary_over_200  smallint NOT NULL DEFAULT 0 CHECK (beneficiary_over_200 BETWEEN 0 AND 1);
ALTER TABLE sites ADD COLUMN IF NOT EXISTS new_partner           smallint NOT NULL DEFAULT 0 CHECK (new_partner BETWEEN 0 AND 1);
ALTER TABLE sites ADD COLUMN IF NOT EXISTS issues_process        smallint NOT NULL DEFAULT 0 CHECK (issues_process BETWEEN 0 AND 2);
ALTER TABLE sites ADD COLUMN IF NOT EXISTS issues_partner_report smallint NOT NULL DEFAULT 0 CHECK (issues_partner_report BETWEEN 0 AND 2);
ALTER TABLE sites ADD COLUMN IF NOT EXISTS issues_cfm            smallint NOT NULL DEFAULT 0 CHECK (issues_cfm BETWEEN 0 AND 2);
ALTER TABLE sites ADD COLUMN IF NOT EXISTS fraud_suspected       smallint NOT NULL DEFAULT 0 CHECK (fraud_suspected BETWEEN 0 AND 1);
ALTER TABLE sites ADD COLUMN IF NOT EXISTS gps_lat numeric(9,6);
ALTER TABLE sites ADD COLUMN IF NOT EXISTS gps_lng numeric(9,6);
