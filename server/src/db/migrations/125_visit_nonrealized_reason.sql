-- 125 — Raison de non-réalisation d'une visite planifiée.
-- Une visite PLANIFIÉE non réalisée (le mois passe sans visite déclarée ni données) reçoit, depuis
-- les rapports TPM ou l'écran dédié, une raison (par site, plusieurs sites, ou district — saisie
-- groupée côté application). Facultative, bornée. Elle sert à l'info-bulle du site et à la
-- compréhension ; la replanification reste pilotée par le RBM (le site non visité resurface).
ALTER TABLE site_visits ADD COLUMN IF NOT EXISTS nonrealized_reason text;
ALTER TABLE site_visits DROP CONSTRAINT IF EXISTS site_visits_nonrealized_reason_len;
ALTER TABLE site_visits ADD CONSTRAINT site_visits_nonrealized_reason_len
  CHECK (nonrealized_reason IS NULL OR length(nonrealized_reason) <= 500);
