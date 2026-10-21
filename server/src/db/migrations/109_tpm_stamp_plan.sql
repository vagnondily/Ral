-- MEMS 2.0 — Estampille des visites (mems_tpm_stamp) : coût linéaire et délai d'attente de l'appelant
-- rétabli (migration 109, relecture r114c points 2 et 13).
--
-- (1) Coût. mems_tpm_cells était appelée avec des sous-requêtes en arguments (ARRAY(SELECT … FROM tv)) :
--     la fonction SQL n'était plus « inlinée », s'exécutait avec un plan générique et, sous la sécurité
--     par ligne (RLS, rôle applicatif), recalculait ses CTE pour chaque ligne — coût quadratique
--     (4 000 visites : plusieurs secondes sous le verrou d'attribution du compte, que tous les écrivains
--     d'attribution attendent ; 20 s → 503). Ici les visites sont d'abord verrouillées (FOR UPDATE, ordre
--     des identifiants) et leurs sites et mois rangés dans des variables, puis mems_tpm_cells est appelée
--     avec ces tableaux. `plan_cache_mode = force_custom_plan` : chaque appel est planifié avec ses
--     valeurs — jamais le plan générique que PL/pgSQL adopterait au 6ᵉ appel d'une session (mesuré, 4 000
--     visites : de 13 s à plusieurs minutes par appel). Garde-fou : test/tpmStampDb.test.js (7 appels).
-- (2) Délai d'attente. Après le verrou d'attribution, la fonction remettait lock_timeout à DEFAULT (0 :
--     sans limite), effaçant celui de l'appelant ('20s' des écrivains de plan) : elle rétablit désormais la
--     valeur de l'appelant (comme tpmAttribution.repository.lockAttributionTx et visitLocks.lockKeysTx).
--     Avec la clause SET de la fonction, les réglages LOCAUX faits à l'intérieur (lock_timeout,
--     mems.tpm_stamping) sont de toute façon rendus à leur valeur d'avant l'appel en sortie.
-- Règle inchangée : visites « à estampiller », et visites demandées (p_ids) prévues, non figées, non
-- facturées (une facture soumise ou validée couvre CHACUN de ses mois, migration 108). Rejouable.

CREATE OR REPLACE FUNCTION mems_tpm_stamp(p_tenant uuid, p_ids uuid[])
RETURNS TABLE (o_id uuid, o_old_provider uuid, o_new_provider uuid, o_state text, o_dated boolean)
LANGUAGE plpgsql
SET plan_cache_mode = force_custom_plan
AS $fn$
DECLARE
  v_prior text := current_setting('lock_timeout');
  v_ids uuid[]; v_sites uuid[]; v_months date[];
  v_old_p uuid[]; v_old_st text[]; v_old_k uuid[]; v_dated boolean[];
BEGIN
  PERFORM set_config('lock_timeout', '20s', true);
  PERFORM pg_advisory_xact_lock(hashtext('tpm-attribution:' || p_tenant::text));
  PERFORM set_config('lock_timeout', v_prior, true);
  PERFORM set_config('mems.tpm_stamping', 'on', true);
  -- Visites à estampiller, verrouillées dans l'ordre des identifiants (aucun interblocage entre estampilles).
  SELECT array_agg(t.id ORDER BY t.id), array_agg(t.site_id ORDER BY t.id), array_agg(t.m ORDER BY t.id),
         array_agg(t.old_p ORDER BY t.id), array_agg(t.old_st ORDER BY t.id), array_agg(t.old_k ORDER BY t.id),
         array_agg(t.dated ORDER BY t.id)
    INTO v_ids, v_sites, v_months, v_old_p, v_old_st, v_old_k, v_dated
    FROM (SELECT v.id, v.site_id, v.period_month AS m, v.provider_id AS old_p, v.provider_zone_state AS old_st,
                 v.contract_id AS old_k, (v.visit_date IS NOT NULL AND v.status <> 'annule') AS dated
            FROM site_visits v
           WHERE v.tenant_id = p_tenant AND v.provider_source = 'zone'
             AND (v.provider_zone_state IS NULL
                  OR (v.id = ANY (COALESCE(p_ids, '{}'::uuid[]))
                      AND v.status = 'planifie' AND v.provider_zone_state <> 'anterieur'
                      AND NOT EXISTS (SELECT 1 FROM tpm_reports r
                                       WHERE r.tenant_id = p_tenant AND r.partner_id = v.provider_id
                                         AND v.period_month BETWEEN r.period_month AND COALESCE(r.period_end, r.period_month)
                                         AND r.kind = 'financier' AND r.status IN ('soumis', 'valide'))))
           ORDER BY v.id
             FOR UPDATE OF v) t;
  IF v_ids IS NOT NULL THEN
    RETURN QUERY
    WITH tv AS (
      SELECT * FROM unnest(v_ids, v_sites, v_months, v_old_p, v_old_st, v_old_k, v_dated) AS u(id, site_id, m, old_p, old_st, old_k, dated)),
    cells AS (
      SELECT * FROM mems_tpm_cells(p_tenant, v_sites, v_months)),
    upd AS (
      UPDATE site_visits v
         SET provider_id = c.c_provider_id, provider_zone_state = c.c_state, contract_id = c.c_contract_id, updated_at = now()
        FROM tv JOIN cells c ON c.c_site_id = tv.site_id AND c.c_month = tv.m
       WHERE v.tenant_id = p_tenant AND v.id = tv.id
         AND (tv.old_st IS DISTINCT FROM c.c_state OR tv.old_p IS DISTINCT FROM c.c_provider_id OR tv.old_k IS DISTINCT FROM c.c_contract_id)
      RETURNING v.id, tv.old_p, c.c_provider_id, c.c_state, tv.dated)
    SELECT * FROM upd;
  END IF;
  PERFORM set_config('mems.tpm_stamping', 'off', true);
END $fn$;
