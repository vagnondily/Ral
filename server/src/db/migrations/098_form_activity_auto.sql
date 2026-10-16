-- MEMS 2.0 — Activité d'une fiche rattachée AUTOMATIQUEMENT (retours 66 et 85).
--
-- À l'import d'une définition XLSForm, la fiche sans activité est rattachée à
-- l'activité du modèle d'indicateurs qui couvre le mieux ses variables
-- (monitoring/indicatorProposals.decideAutoAttach : couverture ≥ 60 %, modèle
-- non ambigu, activité présente dans le MMR du compte, Mapping MEMS en brouillon).
-- activity_auto_at dit QUAND ce rattachement a été fait sans l'utilisateur :
-- l'écran l'affiche « proposée automatiquement » jusqu'à ce que l'utilisateur la
-- confirme ou la change (toute modification de l'activité par l'utilisateur
-- remet la colonne à NULL). Une activité choisie par l'utilisateur n'est jamais
-- remplacée par un rattachement automatique.
ALTER TABLE monitoring_forms ADD COLUMN IF NOT EXISTS activity_auto_at timestamptz;

-- Rattachement automatique ⇒ une activité est rattachée.
ALTER TABLE monitoring_forms DROP CONSTRAINT IF EXISTS monitoring_forms_activity_auto_check;
ALTER TABLE monitoring_forms ADD CONSTRAINT monitoring_forms_activity_auto_check
  CHECK (activity_auto_at IS NULL OR activity_category IS NOT NULL);
