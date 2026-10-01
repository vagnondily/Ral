-- MMR — capacité « faisable » calculée à partir des ressources : personnes à
-- déployer × suivis par jour (par activité) × jours ouvrés par mois. Quand ces
-- trois valeurs sont fournies, la capacité calculée prime sur la valeur saisie
-- (voir mmrMath.deriveMmr).
ALTER TABLE mmr_parameters ADD COLUMN IF NOT EXISTS persons_to_deploy int          CHECK (persons_to_deploy IS NULL OR persons_to_deploy >= 0);
ALTER TABLE mmr_parameters ADD COLUMN IF NOT EXISTS visits_per_day     numeric(6,2) CHECK (visits_per_day IS NULL OR visits_per_day >= 0);
ALTER TABLE mmr_parameters ADD COLUMN IF NOT EXISTS working_days       int          CHECK (working_days IS NULL OR working_days >= 0);
