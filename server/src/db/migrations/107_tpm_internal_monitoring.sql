-- MEMS 2.0 — Suivi interne et indisponibilités des TPM (retours 114 et 115, décision D1 du 20/10).
-- Migration 107. Règles pures : modules/tpm/tpmAttribution.js (contractTpms, defaultFor,
-- availableDefault, resolveCell, monitoredByOf) et modules/tpm/tpmUnavailability.js ; parité de la
-- jumelle SQL mems_tpm_cells vérifiée par scripts/tpmParity.js et test/tpmInternalDb.test.js.
--
-- « Sans contrat, on devra le faire nous-mêmes ; même avec un contrat, si cette entité n'est pas
-- disponible, on doit le faire. » (retour 114)
--
-- (1) D1 dans l'estampille : le titulaire d'un contrat n'en est le TPM que s'il est LUI-MÊME un
--     partenaire actif de type « tpm » (la règle des écrans et des listes de choix,
--     activeProvider.contractTpmOf) ; sinon, sans TPM rattaché, le contrat n'a pas de TPM et ses zones
--     sont suivies en interne (état « sans_tpm »).
-- (2) Suivi INTERNE explicite : une visite sans TPM d'une zone sans contrat (« sans_contrat »), d'un
--     contrat sans TPM (« sans_tpm »), d'un TPM indisponible (« indisponible »), d'une zone décidée
--     « aucun TPM » (« aucun_tpm »), d'un site sans district reconnu (« district_inconnu »), ou une
--     visite à qui l'on a retiré son TPM avec une raison (origine « visite ») est suivie par l'équipe
--     S&E : colonne GÉNÉRÉE site_visits.monitored_by = 'interne' (jamais saisie, jamais incohérente).
--     'tpm' quand la visite porte un TPM ; 'non_affecte' seulement pour une visite antérieure à la
--     règle sans TPM connu, ou en cours d'estampille dans une transaction.
-- (3) Indisponibilités d'un TPM par mois (tpm_unavailability), motif obligatoire, journal inaltérable
--     (tpm_attribution_log, portée 'tpm', actions indispo_*, avant → après).
-- (4) Ré-estampille des SEULES visites prévues ré-estampillables (prévues, origine « zone », non
--     figées « antérieur », non facturées) : jamais une visite réalisée, annulée, figée, facturée ou
--     au TPM motivé. Chaque changement est inscrit au journal (un lot par compte + une ligne par visite
--     dont le TPM change).

-- (a) États : « contrat sans TPM » et « TPM indisponible » (suivi interne). La forme des visites
-- (site_visits_zone_shape_ck, migration 070) impose déjà : état hors contrat / modifié / à arbitrer ⇒
-- aucun TPM ; et site_visits_contract_derived_ck : aucun contrat sur une visite sans TPM de zone.
ALTER TABLE site_visits DROP CONSTRAINT IF EXISTS site_visits_zone_state_ck;
ALTER TABLE site_visits ADD CONSTRAINT site_visits_zone_state_ck CHECK (provider_zone_state IS NULL OR provider_zone_state IN
    ('contrat', 'modifie', 'aucun_tpm', 'a_arbitrer', 'sans_contrat', 'sans_tpm', 'indisponible', 'district_inconnu', 'anterieur'));

-- Ce que disait le contrat au moment d'une modification : « contrat sans TPM » en plus ; « aucun TPM »
-- là où la zone est déjà en suivi interne (aucun contrat, contrat sans TPM) n'est pas une modification.
ALTER TABLE tpm_zone_overrides DROP CONSTRAINT IF EXISTS tpm_zone_overrides_expected_state_check;
ALTER TABLE tpm_zone_overrides ADD CONSTRAINT tpm_zone_overrides_expected_state_check
  CHECK (expected_state IN ('contrat', 'sans_contrat', 'a_arbitrer', 'sans_tpm'));
ALTER TABLE tpm_zone_overrides DROP CONSTRAINT IF EXISTS tpm_zone_overrides_useful_ck;
ALTER TABLE tpm_zone_overrides ADD CONSTRAINT tpm_zone_overrides_useful_ck
  CHECK (expected_state NOT IN ('sans_contrat', 'sans_tpm') OR provider_id IS NOT NULL);

-- (b) Qui suit la visite — colonne générée, jumelle de tpmAttribution.monitoredByOf.
ALTER TABLE site_visits ADD COLUMN IF NOT EXISTS monitored_by text GENERATED ALWAYS AS (
  CASE WHEN provider_id IS NOT NULL THEN 'tpm'
       WHEN provider_source = 'visite' THEN 'interne'
       WHEN provider_source = 'zone' AND provider_zone_state IN ('sans_contrat', 'sans_tpm', 'indisponible', 'aucun_tpm', 'district_inconnu') THEN 'interne'
       ELSE 'non_affecte' END) STORED;
ALTER TABLE site_visits DROP CONSTRAINT IF EXISTS site_visits_monitored_by_ck;
ALTER TABLE site_visits ADD CONSTRAINT site_visits_monitored_by_ck CHECK (monitored_by IN ('tpm', 'interne', 'non_affecte'));
CREATE INDEX IF NOT EXISTS idx_site_visits_internal ON site_visits (tenant_id, period_month) WHERE monitored_by = 'interne';

-- (c) Indisponibilités : une ligne par TPM × mois (un UNIQUE simple, aucune logique de chevauchement).
CREATE TABLE IF NOT EXISTS tpm_unavailability (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  provider_id  uuid NOT NULL REFERENCES partners(id) ON DELETE RESTRICT,
  period_month date NOT NULL CHECK (extract(day FROM period_month) = 1),
  reason       text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 10 AND 500),
  batch_id     uuid NOT NULL,
  created_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_tpm_unavailability UNIQUE (tenant_id, provider_id, period_month)
);
CREATE INDEX IF NOT EXISTS idx_tpm_unavailability_month ON tpm_unavailability (tenant_id, period_month);
ALTER TABLE tpm_unavailability ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON tpm_unavailability;
CREATE POLICY tenant_isolation ON tpm_unavailability
  USING (tenant_id::text = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));
GRANT SELECT, INSERT, UPDATE, DELETE ON tpm_unavailability TO mems2_app;

-- (d) Journal : portée « tpm » (une ligne par TPM × mois), actions des indisponibilités, motif d'avant.
ALTER TABLE tpm_attribution_log ADD COLUMN IF NOT EXISTS old_reason text;
ALTER TABLE tpm_attribution_log DROP CONSTRAINT IF EXISTS tpm_log_old_reason_ck;
ALTER TABLE tpm_attribution_log ADD CONSTRAINT tpm_log_old_reason_ck CHECK (old_reason IS NULL OR char_length(old_reason) <= 500);
ALTER TABLE tpm_attribution_log DROP CONSTRAINT IF EXISTS tpm_attribution_log_scope_check;
ALTER TABLE tpm_attribution_log ADD CONSTRAINT tpm_attribution_log_scope_check CHECK (scope IN ('lot', 'zone', 'visite', 'tpm'));
ALTER TABLE tpm_attribution_log DROP CONSTRAINT IF EXISTS tpm_attribution_log_action_check;
ALTER TABLE tpm_attribution_log ADD CONSTRAINT tpm_attribution_log_action_check CHECK (action IN ('modifier', 'confirmer', 'revenir_contrat', 'reappliquer',
    'visite_modifier', 'visite_garder', 'visite_zone', 'indispo_poser', 'indispo_modifier', 'indispo_retirer'));
ALTER TABLE tpm_attribution_log DROP CONSTRAINT IF EXISTS tpm_log_reason_ck;
ALTER TABLE tpm_attribution_log ADD CONSTRAINT tpm_log_reason_ck
  CHECK (action IN ('revenir_contrat', 'reappliquer', 'visite_zone', 'indispo_retirer') OR reason IS NOT NULL);
ALTER TABLE tpm_attribution_log DROP CONSTRAINT IF EXISTS tpm_log_tpm_ck;
ALTER TABLE tpm_attribution_log ADD CONSTRAINT tpm_log_tpm_ck
  CHECK (scope <> 'tpm' OR (period_month IS NOT NULL AND new_provider_id IS NOT NULL AND old_state IN ('disponible', 'indisponible')
                            AND new_state IN ('disponible', 'indisponible')));
-- Inscription seule (le REVOKE de la migration 070 tient toujours) ; rappelé pour une base qui l'aurait perdu.
REVOKE UPDATE, DELETE, TRUNCATE ON tpm_attribution_log FROM mems2_app;

-- (e) Jumelle SQL de la règle (tpmAttribution.contractTpms / defaultFor / availableDefault /
-- resolveCell / cellForSite) : la cellule (aire, état, TPM, contrat) de chaque site × mois demandé.
CREATE OR REPLACE FUNCTION mems_tpm_cells(p_tenant uuid, p_sites uuid[], p_months date[])
RETURNS TABLE (c_site_id uuid, c_month date, c_area_id uuid, c_state text, c_provider_id uuid, c_contract_id uuid)
LANGUAGE sql STABLE AS $fn$
  WITH req AS (
    SELECT DISTINCT r.site_id, date_trunc('month', r.m)::date AS m
      FROM unnest(p_sites, p_months) AS r(site_id, m)
     WHERE r.site_id IS NOT NULL AND r.m IS NOT NULL),
  t AS (
    SELECT req.site_id, req.m, s.zone_district_id AS did, s.zone_commune_id AS cid
      FROM req JOIN sites s ON s.tenant_id = p_tenant AND s.id = req.site_id),
  mon AS (SELECT DISTINCT m FROM t),
  -- Contrats de suivi (IV.suivi > 0) qui couvrent chaque mois : « actif » de mois(début) à
  -- mois(fin), « résilié » jusqu'au mois de résiliation ; les dates décident (règle commune du lot 8).
  cc0 AS (
    SELECT c.id, c.numero, c.partner_id, c.partner_name, c.date_debut, mon.m
      FROM contracts c
      JOIN mon ON mon.m >= date_trunc('month', c.date_debut)::date
              AND mon.m <= date_trunc('month', CASE WHEN c.status = 'resilie' THEN c.termination_date ELSE c.date_fin END)::date
     WHERE c.tenant_id = p_tenant AND c.status IN ('actif', 'resilie')
       AND (SELECT COALESCE(sum(b.unit_count * b.unit_cost), 0) FROM contract_budget_items b
             WHERE b.tenant_id = p_tenant AND b.contract_id = c.id AND b.line_code = 'IV.suivi') > 0),
  -- TPM rattachés : partenaires ACTIFS de type TPM liés au contrat par un plan de collecte ou une facture.
  tl AS (
    SELECT DISTINCT x.contract_id, x.partner_id, p.name
      FROM (SELECT contract_id, partner_id FROM tpm_collection_plans WHERE tenant_id = p_tenant
            UNION SELECT contract_id, partner_id FROM tpm_reports WHERE tenant_id = p_tenant) x
      JOIN partners p ON p.tenant_id = p_tenant AND p.id = x.partner_id AND p.active
      JOIN partner_types t ON t.tenant_id = p_tenant AND t.id = p.partner_type_id AND t.code = 'tpm'
     WHERE x.contract_id IN (SELECT id FROM cc0)),
  -- TPM d'un contrat (D1, jumelle de tpmAttribution.contractTpms = activeProvider.contractTpmOf) : ses
  -- TPM rattachés ; à défaut son titulaire SEULEMENT s'il est un partenaire actif de type TPM ; sinon aucun.
  cc AS (
    SELECT cc0.id, cc0.numero, cc0.date_debut, cc0.m, tl.partner_id, tl.name AS pname
      FROM cc0 JOIN tl ON tl.contract_id = cc0.id
    UNION ALL
    SELECT cc0.id, cc0.numero, cc0.date_debut, cc0.m, cc0.partner_id, hp.name
      FROM cc0
      JOIN partners hp ON hp.tenant_id = p_tenant AND hp.id = cc0.partner_id AND hp.active
      JOIN partner_types ht ON ht.tenant_id = p_tenant AND ht.id = hp.partner_type_id AND ht.code = 'tpm'
     WHERE NOT EXISTS (SELECT 1 FROM tl WHERE tl.contract_id = cc0.id)),
  -- Zones LIÉES de tous les contrats de suivi du mois, avec ou sans TPM (une zone détachée ne donne
  -- rien ; un fokontany est trop fin) ; puis celles des seuls contrats qui ont un TPM.
  cz0 AS (
    SELECT cc0.id, cc0.m, a.id AS zid, a.depth AS zdepth
      FROM cc0
      JOIN contract_areas z ON z.tenant_id = p_tenant AND z.contract_id = cc0.id
      JOIN admin_areas a ON a.tenant_id = p_tenant AND a.id = z.admin_area_id AND a.depth <= 3),
  cz AS (
    SELECT cc.id, cc.numero, cc.partner_id, cc.pname, cc.date_debut, cc.m, cz0.zid, cz0.zdepth
      FROM cc JOIN cz0 ON cz0.id = cc.id AND cz0.m = cc.m),
  -- Aire du site ce mois : sa commune si elle a sa propre ligne (zone d'un contrat de suivi exactement
  -- sur elle, avec ou sans TPM, ou modification posée sur elle), sinon son district ; NULL = inconnu.
  tg AS (
    SELECT t.site_id, t.m,
           CASE WHEN t.did IS NULL THEN NULL
                WHEN t.cid IS NOT NULL AND (
                     EXISTS (SELECT 1 FROM cz0 WHERE cz0.m = t.m AND cz0.zid = t.cid)
                  OR EXISTS (SELECT 1 FROM tpm_zone_overrides o
                              WHERE o.tenant_id = p_tenant AND o.admin_area_id = t.cid AND o.period_month = t.m))
                THEN t.cid ELSE t.did END AS aid
      FROM t),
  -- Zones de contrat AVEC TPM qui contiennent l'aire (exacte ou ancêtre) ; la plus précise l'emporte.
  hits AS (
    SELECT tg.site_id, tg.m, cz.partner_id, cz.pname, cz.id AS contract_id, cz.numero, cz.date_debut, cz.zdepth,
           max(cz.zdepth) OVER (PARTITION BY tg.site_id, tg.m) AS best
      FROM tg
      JOIN admin_areas ar ON ar.tenant_id = p_tenant AND ar.id = tg.aid
      JOIN cz ON cz.m = tg.m AND (cz.zid = tg.aid OR cz.zid = ANY (ar.lineage))),
  besthits AS (SELECT * FROM hits WHERE zdepth = best),
  -- Indisponibilités (retour 114) : un TPM indisponible ce mois est retiré des candidats ; s'il en
  -- reste, ils décident (même ordre) — jumelle de tpmAttribution.availableDefault.
  avail AS (
    SELECT b.* FROM besthits b
     WHERE NOT EXISTS (SELECT 1 FROM tpm_unavailability u
                        WHERE u.tenant_id = p_tenant AND u.provider_id = b.partner_id AND u.period_month = b.m)),
  -- TPM retenu (un seul, ou TPM par défaut de plusieurs) : contrat au début le plus récent, puis plus
  -- petit numéro, puis TPM (nom, identifiant) en ordre binaire — jumelle de tpmAttribution.byDefault.
  dflt AS (
    SELECT site_id, m, count(DISTINCT partner_id) AS holders,
           (array_agg(partner_id ORDER BY date_debut DESC, numero COLLATE "C", pname COLLATE "C", partner_id::text COLLATE "C"))[1] AS p,
           (array_agg(contract_id ORDER BY date_debut DESC, numero COLLATE "C", pname COLLATE "C", partner_id::text COLLATE "C"))[1] AS k
      FROM avail GROUP BY site_id, m),
  anyhit AS (SELECT DISTINCT site_id, m FROM besthits),
  -- Un contrat de suivi (forcément SANS TPM quand aucun candidat n'existe) couvre-t-il l'aire ?
  bare AS (
    SELECT DISTINCT tg.site_id, tg.m
      FROM tg
      JOIN admin_areas ar ON ar.tenant_id = p_tenant AND ar.id = tg.aid
      JOIN cz0 ON cz0.m = tg.m AND (cz0.zid = tg.aid OR cz0.zid = ANY (ar.lineage)))
  SELECT tg.site_id, tg.m, tg.aid,
         CASE WHEN tg.aid IS NULL THEN 'district_inconnu'
              WHEN o.id IS NOT NULL AND o.provider_id IS NOT NULL AND uo.id IS NOT NULL THEN 'indisponible'
              WHEN o.id IS NOT NULL AND o.provider_id IS NOT NULL THEN 'modifie'
              WHEN o.id IS NOT NULL THEN 'aucun_tpm'
              WHEN d.holders = 1 THEN 'contrat'
              WHEN d.holders > 1 THEN 'a_arbitrer'
              WHEN ah.site_id IS NOT NULL THEN 'indisponible'
              WHEN bz.site_id IS NOT NULL THEN 'sans_tpm'
              ELSE 'sans_contrat' END,
         CASE WHEN tg.aid IS NULL THEN NULL
              WHEN o.id IS NOT NULL AND uo.id IS NOT NULL THEN NULL
              WHEN o.id IS NOT NULL THEN o.provider_id
              WHEN d.holders >= 1 THEN d.p END,
         CASE WHEN tg.aid IS NULL THEN NULL
              WHEN o.id IS NOT NULL AND uo.id IS NOT NULL THEN NULL
              WHEN o.id IS NOT NULL THEN (SELECT (array_agg(x.contract_id ORDER BY x.date_debut DESC, x.numero COLLATE "C"))[1]
                                            FROM besthits x
                                           WHERE x.site_id = tg.site_id AND x.m = tg.m AND x.partner_id = o.provider_id)
              WHEN d.holders >= 1 THEN d.k END
    FROM tg
    LEFT JOIN dflt d ON d.site_id = tg.site_id AND d.m = tg.m
    LEFT JOIN anyhit ah ON ah.site_id = tg.site_id AND ah.m = tg.m
    LEFT JOIN bare bz ON bz.site_id = tg.site_id AND bz.m = tg.m
    LEFT JOIN tpm_zone_overrides o ON o.tenant_id = p_tenant AND o.admin_area_id = tg.aid AND o.period_month = tg.m
    LEFT JOIN tpm_unavailability uo ON uo.tenant_id = p_tenant AND uo.provider_id = o.provider_id AND uo.period_month = tg.m
$fn$;

-- (f) Références « même compte » (migration 049) et cache du concepteur de rapport (lot 7a).
SELECT mems_install_same_tenant('tpm_unavailability');
DO $$ BEGIN
  IF to_regprocedure('mems_data_changed()') IS NOT NULL THEN
    EXECUTE 'DROP TRIGGER IF EXISTS trg_data_changed ON tpm_unavailability';
    EXECUTE 'CREATE TRIGGER trg_data_changed AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON tpm_unavailability
             FOR EACH STATEMENT EXECUTE FUNCTION mems_data_changed(''visits'')';
  END IF;
END $$;

-- (g) Ré-estampille D1 — SEULES les visites prévues ré-estampillables (jumelle du filtre
-- tpmAttribution.repository.AUTO_RESTAMPABLE_SQL et de celui des p_ids de mems_tpm_stamp) ; un lot au
-- journal par compte, une ligne par visite dont le TPM change (avant → après). Idempotent : rejoué,
-- n'écrit rien. Le test en base (test/tpmInternalDb.test.js) rejoue exactement le bloc ci-dessous.
-- [r107-restamp:debut]
DO $r107$
DECLARE
  t record; b uuid; n integer; lo date; hi date;
  ids uuid[]; olds uuid[]; news uuid[]; sts text[];
BEGIN
  FOR t IN SELECT id FROM tenants ORDER BY id LOOP
    SELECT array_agg(o_id), array_agg(o_old_provider), array_agg(o_new_provider), array_agg(o_state)
      INTO ids, olds, news, sts
      FROM mems_tpm_stamp(t.id, ARRAY(
        SELECT v.id FROM site_visits v
         WHERE v.tenant_id = t.id AND v.provider_source = 'zone' AND v.status = 'planifie'
           AND v.provider_zone_state IS DISTINCT FROM 'anterieur'
           AND NOT EXISTS (SELECT 1 FROM tpm_reports r
                            WHERE r.tenant_id = v.tenant_id AND r.partner_id = v.provider_id AND r.period_month = v.period_month
                              AND r.kind = 'financier' AND r.status IN ('soumis', 'valide'))));
    n := COALESCE(array_length(ids, 1), 0);
    CONTINUE WHEN n = 0;
    b := gen_random_uuid();
    SELECT min(v.period_month), max(v.period_month) INTO lo, hi FROM site_visits v WHERE v.id = ANY (ids);
    INSERT INTO tpm_attribution_log (tenant_id, batch_id, scope, action, label, month_from, month_to, visits_updated, changed_by_name)
    VALUES (t.id, b, 'lot', 'reappliquer',
            'Décision D1 (retours 114, 115) : TPM des contrats réappliqués aux visites prévues — titulaire non TPM : suivi interne',
            lo, hi, n, 'Migration 107');
    INSERT INTO tpm_attribution_log (tenant_id, batch_id, scope, action, label, period_month, visit_id,
                                     old_provider_id, old_provider_name, new_state, new_provider_id, new_provider_name, changed_by_name)
    SELECT t.id, b, 'visite', 'visite_zone',
           left(COALESCE(s.public_id, s.location_id, s.name, '—') || ' · ' || to_char(v.period_month, 'YYYY-MM'), 300),
           v.period_month, c.id, c.old_p, po.name, c.st, c.new_p, pn.name, 'Migration 107'
      FROM unnest(ids, olds, news, sts) AS c(id, old_p, new_p, st)
      JOIN site_visits v ON v.tenant_id = t.id AND v.id = c.id
      JOIN sites s ON s.tenant_id = t.id AND s.id = v.site_id
      LEFT JOIN partners po ON po.tenant_id = t.id AND po.id = c.old_p
      LEFT JOIN partners pn ON pn.tenant_id = t.id AND pn.id = c.new_p
     WHERE c.old_p IS DISTINCT FROM c.new_p;
  END LOOP;
END $r107$;
-- [r107-restamp:fin]
