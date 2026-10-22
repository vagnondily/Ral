-- 123 — « Interne » dans les correspondances de valeurs (dimension partenaire).
-- Un code reçu dans la colonne « partenaire » d'un formulaire peut désigner le SUIVI INTERNE
-- (l'équipe S&E elle-même) plutôt qu'un partenaire externe. On le stocke comme un lien RÉSOLU
-- sans partenaire (partner_id reste NULL) mais marqué `internal` — distinct de « ne pas relier »
-- (non résolu / à ignorer) et de « non reliée » (à traiter). Le comportement d'application reste
-- identique à un lien sans cible (partner_id NULL, pas de rapprochement automatique) ; seule la
-- correspondance affichée change (« Interne » au lieu de « non reliée »).
ALTER TABLE monitoring_value_links
  ADD COLUMN IF NOT EXISTS internal boolean NOT NULL DEFAULT false;
