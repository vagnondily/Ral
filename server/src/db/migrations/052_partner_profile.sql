-- MEMS 2.0 — Fiche partenaire 360° et équipe (lot E de docs/REFONTE_UX.md ; « 053 »
-- dans la spécification, renuméroté au premier numéro libre).
--
-- Partenaire : identité complète (sigle, NIF/STAT, contact, date de début).
-- Agent : code d'enquêteur (unique DANS un prestataire : deux homonymes de
-- prestataires différents restent possibles), contact, actif, dates. Un agent
-- avec un historique se DÉSACTIVE, il ne se supprime pas (contrôlé par le service).
-- Colonnes nullables / avec défaut : aucune donnée existante n'est modifiée.

ALTER TABLE partners
  ADD COLUMN IF NOT EXISTS short_name    text CHECK (short_name IS NULL OR length(short_name) <= 40),
  ADD COLUMN IF NOT EXISTS legal_id      text CHECK (legal_id IS NULL OR length(legal_id) <= 80),
  ADD COLUMN IF NOT EXISTS address       text CHECK (address IS NULL OR length(address) <= 300),
  ADD COLUMN IF NOT EXISTS contact_name  text CHECK (contact_name IS NULL OR length(contact_name) <= 120),
  ADD COLUMN IF NOT EXISTS contact_phone text CHECK (contact_phone IS NULL OR length(contact_phone) <= 40),
  ADD COLUMN IF NOT EXISTS contact_email citext CHECK (contact_email IS NULL OR contact_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  ADD COLUMN IF NOT EXISTS started_on    date,
  ADD COLUMN IF NOT EXISTS notes         text CHECK (notes IS NULL OR length(notes) <= 2000),
  ADD COLUMN IF NOT EXISTS updated_at    timestamptz NOT NULL DEFAULT now();

ALTER TABLE tpm_agents
  ADD COLUMN IF NOT EXISTS code       text CHECK (code IS NULL OR length(btrim(code)) BETWEEN 1 AND 60),
  ADD COLUMN IF NOT EXISTS phone      text CHECK (phone IS NULL OR length(phone) <= 40),
  ADD COLUMN IF NOT EXISTS email      citext CHECK (email IS NULL OR email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  ADD COLUMN IF NOT EXISTS sex        text CHECK (sex IS NULL OR sex IN ('F', 'M')),
  ADD COLUMN IF NOT EXISTS active     boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS started_on date,
  ADD COLUMN IF NOT EXISTS ended_on   date,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE tpm_agents DROP CONSTRAINT IF EXISTS tpm_agents_dates_chk;
ALTER TABLE tpm_agents ADD CONSTRAINT tpm_agents_dates_chk CHECK (ended_on IS NULL OR started_on IS NULL OR ended_on >= started_on);

CREATE UNIQUE INDEX IF NOT EXISTS uq_tpm_agents_code ON tpm_agents (tenant_id, tpm_provider_id, lower(btrim(code))) WHERE code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_contracts_partner ON contracts (tenant_id, partner_id);
CREATE INDEX IF NOT EXISTS idx_site_visits_provider ON site_visits (tenant_id, provider_id, period_month);
CREATE INDEX IF NOT EXISTS idx_tpm_reports_partner ON tpm_reports (tenant_id, partner_id, period_month);
