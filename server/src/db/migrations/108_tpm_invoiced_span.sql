-- MEMS 2.0 — Visites « déjà facturées » : une facture couvre CHACUN de ses mois (migration 108).
--
-- Une facture (rapport financier) soumise ou validée porte une période [period_month, period_end] ;
-- les rapports attendus (reportExpectation, reportExpectationSql) et la liste des rapports (spanOverlaps)
-- la comptent déjà pour chacun de ses mois (retour 114, U9). La protection des visites facturées ne
-- regardait que son PREMIER mois (r.period_month = v.period_month) : effacer le plan généré, déclarer
-- le TPM indisponible ou changer son rôle réécrivait ou supprimait les visites prévues des mois suivants
-- qu'une facture pluri-mensuelle soumise couvre (relecture croisée, point 20).
--
-- Ici, la jumelle en base du filtre (défense en profondeur) : mems_tpm_stamp ne ré-estampille jamais une
-- visite demandée (p_ids) d'un mois que couvre une facture soumise ou validée de son TPM — même prédicat
-- que tpmAttribution.repository.INVOICED_SQL (et donc AUTO_RESTAMPABLE_SQL, planAuto CLEARABLE_SQL).
-- Rien d'autre ne change (corps identique à la migration 070). Rejouable : CREATE OR REPLACE.

CREATE OR REPLACE FUNCTION mems_tpm_stamp(p_tenant uuid, p_ids uuid[])
RETURNS TABLE (o_id uuid, o_old_provider uuid, o_new_provider uuid, o_state text, o_dated boolean)
LANGUAGE plpgsql AS $fn$
BEGIN
  SET LOCAL lock_timeout = '20s';
  PERFORM pg_advisory_xact_lock(hashtext('tpm-attribution:' || p_tenant::text));
  SET LOCAL lock_timeout = DEFAULT;
  PERFORM set_config('mems.tpm_stamping', 'on', true);
  RETURN QUERY
  WITH tv AS MATERIALIZED (
    SELECT v.id, v.site_id, v.period_month AS m, v.provider_id AS old_p, v.provider_zone_state AS old_st,
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
       FOR UPDATE OF v),
  cells AS (
    SELECT * FROM mems_tpm_cells(p_tenant, ARRAY(SELECT tv.site_id FROM tv ORDER BY tv.id), ARRAY(SELECT tv.m FROM tv ORDER BY tv.id))),
  upd AS (
    UPDATE site_visits v
       SET provider_id = c.c_provider_id, provider_zone_state = c.c_state, contract_id = c.c_contract_id, updated_at = now()
      FROM tv JOIN cells c ON c.c_site_id = tv.site_id AND c.c_month = tv.m
     WHERE v.tenant_id = p_tenant AND v.id = tv.id
       AND (tv.old_st IS DISTINCT FROM c.c_state OR tv.old_p IS DISTINCT FROM c.c_provider_id OR tv.old_k IS DISTINCT FROM c.c_contract_id)
    RETURNING v.id, tv.old_p, c.c_provider_id, c.c_state, tv.dated)
  SELECT * FROM upd;
  PERFORM set_config('mems.tpm_stamping', 'off', true);
END $fn$;
