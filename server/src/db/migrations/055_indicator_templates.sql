-- MEMS 2.0 — Modèles d'indicateurs par activité (retour n° 12).
--
-- Les indicateurs créés depuis un modèle (monitoring/indicatorTemplates.json,
-- repris des tableaux de bord et rapports de référence) gardent :
--   - na_values : réponses « hors base » (Sans objet 9999, Ne sait pas 888,
--     N/A 777) exclues du calcul au lieu d'être comptées comme « non » ;
--   - scored : compte dans l'indice d'activité (faux pour un chiffre clé ou un
--     module complémentaire du seul tableau de bord) ;
--   - template_code : l'élément du modèle d'origine (réapplication idempotente).
-- Colonnes avec défaut : les indicateurs existants gardent leur calcul.
ALTER TABLE monitoring_indicators
  ADD COLUMN IF NOT EXISTS na_values text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS scored boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS template_code text;
ALTER TABLE monitoring_indicators DROP CONSTRAINT IF EXISTS monitoring_indicators_na_values_check;
ALTER TABLE monitoring_indicators ADD CONSTRAINT monitoring_indicators_na_values_check
  CHECK (cardinality(na_values) <= 20 AND (template_code IS NULL OR length(template_code) BETWEEN 1 AND 80));
