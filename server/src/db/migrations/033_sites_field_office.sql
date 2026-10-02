-- Rattachement d'un site à son bureau/antenne (comme les colonnes « Sub-Office
-- name » + « Antenne » de la feuille « Risk-based site selection » du Plan de
-- suivi). Permet de voir, depuis un bureau, ses sites — et depuis le bureau
-- pays, tous les sites du pays.
ALTER TABLE sites ADD COLUMN IF NOT EXISTS field_office_id uuid REFERENCES field_offices(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_sites_field_office ON sites (tenant_id, field_office_id);
