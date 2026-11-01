-- MEMS 2.0 — Statistiques de l'expression `tenant_id::text` (migration 120, relecture r2stamp, points 1 et 5).
--
-- Les politiques de sécurité par ligne filtrent `tenant_id::text = current_setting('app.tenant_id', true)`.
-- Sans statistique sur cette EXPRESSION, le planificateur lui donne la sélectivité par défaut (0,5 %) : sous
-- le rôle applicatif (mems2_app), chaque table lue par mems_tpm_cells est estimée à quelques lignes, les
-- jointures deviennent des boucles imbriquées, et mems_tpm_stamp coûte ~1 à 1,5 s pour 4 000 visites dès
-- que les tables sont analysées (toujours en production, avec l'autovacuum) — contre ~80 ms avec une
-- estimation juste. Mesuré (4 000 visites couvertes, 7 appels dans une session mems2_app, base analysée) :
-- sans ces statistiques 1,0 à 1,15 s par appel, avec elles 75 à 150 ms ; ré-estampille des 4 000 (lignes
-- écrites) 2,3 s → 1,0 à 1,7 s (le reste : déclencheurs des lignes écrites).
-- Une statistique d'expression (PostgreSQL 14+) donne le nombre de valeurs distinctes de `tenant_id::text` :
-- la sélectivité juste, sans rien changer aux politiques, aux fonctions ni aux données. Rejouable :
-- IF NOT EXISTS ; ANALYZE des seules tables concernées qui ont des lignes (rapide), pour un effet immédiat.

CREATE STATISTICS IF NOT EXISTS sites_tenant_text_stx ON (tenant_id::text) FROM sites;
CREATE STATISTICS IF NOT EXISTS site_visits_tenant_text_stx ON (tenant_id::text) FROM site_visits;
CREATE STATISTICS IF NOT EXISTS contracts_tenant_text_stx ON (tenant_id::text) FROM contracts;
CREATE STATISTICS IF NOT EXISTS contract_budget_items_tenant_text_stx ON (tenant_id::text) FROM contract_budget_items;
CREATE STATISTICS IF NOT EXISTS contract_areas_tenant_text_stx ON (tenant_id::text) FROM contract_areas;
CREATE STATISTICS IF NOT EXISTS admin_areas_tenant_text_stx ON (tenant_id::text) FROM admin_areas;
CREATE STATISTICS IF NOT EXISTS partners_tenant_text_stx ON (tenant_id::text) FROM partners;
CREATE STATISTICS IF NOT EXISTS partner_types_tenant_text_stx ON (tenant_id::text) FROM partner_types;
CREATE STATISTICS IF NOT EXISTS tpm_collection_plans_tenant_text_stx ON (tenant_id::text) FROM tpm_collection_plans;
CREATE STATISTICS IF NOT EXISTS tpm_reports_tenant_text_stx ON (tenant_id::text) FROM tpm_reports;
CREATE STATISTICS IF NOT EXISTS tpm_zone_overrides_tenant_text_stx ON (tenant_id::text) FROM tpm_zone_overrides;
CREATE STATISTICS IF NOT EXISTS tpm_unavailability_tenant_text_stx ON (tenant_id::text) FROM tpm_unavailability;

-- ANALYZE des seules tables NON VIDES : une base existante en profite tout de suite ; une base neuve garde
-- des tables jamais analysées (l'autovacuum les analysera une fois remplies) — analyser une table vide
-- enregistrerait 0 ligne, et une base remplie aussitôt après (seed, import) serait estimée vide jusqu'au
-- passage de l'autovacuum (mesuré : 11 à 15 s par appel de l'estampille dans cet état).
DO $$
DECLARE t text; has_rows boolean;
BEGIN
  FOREACH t IN ARRAY ARRAY['sites', 'site_visits', 'contracts', 'contract_budget_items', 'contract_areas', 'admin_areas',
                           'partners', 'partner_types', 'tpm_collection_plans', 'tpm_reports', 'tpm_zone_overrides',
                           'tpm_unavailability'] LOOP
    EXECUTE format('SELECT EXISTS (SELECT 1 FROM %I)', t) INTO has_rows;
    IF has_rows THEN EXECUTE format('ANALYZE %I', t); END IF;
  END LOOP;
END $$;
