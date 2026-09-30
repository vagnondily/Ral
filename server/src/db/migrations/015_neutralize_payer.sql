-- MEMS 2.0 — terminologie neutre : le payeur « PAM » devient « bailleur »
-- (le partenaire reste « ong »). Migration de reprise idempotente pour toute
-- base ayant déjà appliqué l'ancienne version de 008 ; sans effet sur une base
-- fraîche (008 crée déjà les valeurs neutres).
ALTER TABLE contract_report_items ALTER COLUMN pay_by DROP DEFAULT;
UPDATE contract_report_items SET pay_by = 'bailleur' WHERE pay_by = 'PAM';
UPDATE contract_report_items SET pay_by = 'ong' WHERE pay_by = 'ONG';
ALTER TABLE contract_report_items DROP CONSTRAINT IF EXISTS contract_report_items_pay_by_check;
ALTER TABLE contract_report_items ADD CONSTRAINT contract_report_items_pay_by_check CHECK (pay_by IN ('bailleur', 'ong'));
ALTER TABLE contract_report_items ALTER COLUMN pay_by SET DEFAULT 'bailleur';
