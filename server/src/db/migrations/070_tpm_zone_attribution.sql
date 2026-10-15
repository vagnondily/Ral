-- MEMS 2.0 — Affectation des TPM par zone, valeurs par défaut tirées des contrats (retour 58).
-- Migration 070. Spécification : docs/SPEC_RETOUR_58.md. Règle pure : modules/tpm/tpmAttribution.js.
--
-- « Pour l'attribution des TPM dans le plan de suivi, on l'a déjà fait dans les contrats ; s'il y a
-- modifications on doit donner la raison. » Le TPM d'une zone (district, ou commune quand un
-- contrat ou une modification descend à la commune) pour un mois est celui des contrats de suivi
-- qui couvrent ce mois (recalculé, jamais stocké) ; seules les MODIFICATIONS sont stockées (une
-- ligne par zone × mois, raison obligatoire, instantané du contrat) et chaque décision est
-- inscrite dans un journal inaltérable. Les visites portent le TPM retenu de leur zone :
-- site_visits.provider_id reste la seule vérité lue par les tableaux de bord.
--
-- Filet de sécurité en base (aucun chemin ne peut l'oublier) : toute visite « zone » insérée,
-- re-planifiée, déplacée ou dont le TPM est écrit directement passe « à estampiller » (déclencheur
-- AVANT) ; un déclencheur de contrainte DIFFÉRÉ l'estampille au COMMIT avec la jumelle SQL de la
-- règle (mems_tpm_cells) — y compris pour un écrivain qui ne connaît pas cette règle (générateur
-- automatique du plan, seeds).

-- (1) Zone d'un site : district (règle commune des tableaux de bord, lot 1b — siteDistrictCtes,
-- rapportée à l'identifiant du district officiel de même nom dans la région du site) et commune
-- (localité reconnue du site, si elle est dans ce district). Valeurs DÉRIVÉES par le serveur à la
-- fin de chaque rattachement des sites (placeMatch.applySitesGeoTx → tpmAttribution.repository
-- .refreshSiteZonesTx) ; jamais saisies. NULL = district inconnu (aucun TPM hérité).
ALTER TABLE sites
  ADD COLUMN IF NOT EXISTS zone_district_id uuid REFERENCES admin_areas(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS zone_commune_id  uuid REFERENCES admin_areas(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_sites_zone_district ON sites (tenant_id, zone_district_id);
CREATE INDEX IF NOT EXISTS idx_sites_zone_commune ON sites (tenant_id, zone_commune_id) WHERE zone_commune_id IS NOT NULL;

-- (2) Modifications par zone × mois. Une ligne mensuelle (comme site_visits.period_month) : un
-- UNIQUE simple suffit, sans logique de chevauchement de plages.
CREATE TABLE IF NOT EXISTS tpm_zone_overrides (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  admin_area_id        uuid REFERENCES admin_areas(id) ON DELETE SET NULL,   -- NULL = détachée par un réimport : sans effet, signalée
  area_path            text NOT NULL,                                        -- lu dans admin_areas par le serveur, jamais du client
  area_depth           smallint NOT NULL CHECK (area_depth IN (2, 3)),      -- district ou commune
  period_month         date NOT NULL CHECK (extract(day FROM period_month) = 1),
  provider_id          uuid REFERENCES partners(id) ON DELETE RESTRICT,      -- NULL = « aucun TPM » décidé
  expected_state       text NOT NULL CHECK (expected_state IN ('contrat', 'sans_contrat', 'a_arbitrer')),
  expected_provider_id uuid REFERENCES partners(id) ON DELETE RESTRICT,
  expected_label       text CHECK (expected_label IS NULL OR char_length(expected_label) <= 300),
  reason               text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 10 AND 500),
  batch_id             uuid NOT NULL,
  created_by           uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_by           uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at           timestamptz NOT NULL DEFAULT now(),
  -- « selon contrat » et « plusieurs contrats » portent un TPM (le titulaire ; le TPM par défaut) :
  CONSTRAINT tpm_zone_overrides_expected_ck CHECK ((expected_state IN ('contrat', 'a_arbitrer')) = (expected_provider_id IS NOT NULL)),
  -- une modification DIFFÈRE de ce que disait le contrat au moment de la décision :
  CONSTRAINT tpm_zone_overrides_differs_ck  CHECK (expected_state <> 'contrat' OR provider_id IS DISTINCT FROM expected_provider_id),
  -- « aucun TPM » là où aucun contrat ne couvre n'est pas une modification :
  CONSTRAINT tpm_zone_overrides_useful_ck   CHECK (expected_state <> 'sans_contrat' OR provider_id IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_tpm_zone_override
  ON tpm_zone_overrides (tenant_id, admin_area_id, period_month) WHERE admin_area_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tpm_zone_override_month ON tpm_zone_overrides (tenant_id, period_month);
ALTER TABLE tpm_zone_overrides ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON tpm_zone_overrides;
CREATE POLICY tenant_isolation ON tpm_zone_overrides
  USING (tenant_id::text = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));
GRANT SELECT, INSERT, UPDATE, DELETE ON tpm_zone_overrides TO mems2_app;

-- (3) Journal inaltérable : une ligne d'en-tête « lot » (comptes, période, raison) plus une ligne
-- par zone × mois ou par visite. Noms en instantané, aucune clé étrangère.
CREATE TABLE IF NOT EXISTS tpm_attribution_log (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  batch_id          uuid NOT NULL,
  scope             text NOT NULL CHECK (scope IN ('lot', 'zone', 'visite')),
  action            text NOT NULL CHECK (action IN ('modifier', 'confirmer', 'revenir_contrat', 'reappliquer',
                                                    'visite_modifier', 'visite_garder', 'visite_zone')),
  label             text NOT NULL CHECK (char_length(label) BETWEEN 1 AND 300),
  admin_area_id     uuid, period_month date, visit_id uuid,
  month_from        date, month_to date,
  old_state         text, old_provider_id uuid, old_provider_name text,
  new_state         text, new_provider_id uuid, new_provider_name text,
  contract_label    text CHECK (contract_label IS NULL OR char_length(contract_label) <= 300),
  zones_changed     integer CHECK (zones_changed >= 0),
  visits_updated    integer CHECK (visits_updated >= 0),
  reason            text CHECK (reason IS NULL OR char_length(btrim(reason)) BETWEEN 10 AND 500),
  changed_by        uuid, changed_by_name text,
  changed_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tpm_log_reason_ck CHECK (action IN ('revenir_contrat', 'reappliquer', 'visite_zone') OR reason IS NOT NULL),
  CONSTRAINT tpm_log_lot_ck    CHECK (scope <> 'lot'    OR (month_from IS NOT NULL AND month_to IS NOT NULL AND month_to >= month_from)),
  CONSTRAINT tpm_log_zone_ck   CHECK (scope <> 'zone'   OR period_month IS NOT NULL),
  CONSTRAINT tpm_log_visit_ck  CHECK (scope <> 'visite' OR visit_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_tpm_log_when  ON tpm_attribution_log (tenant_id, changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_tpm_log_batch ON tpm_attribution_log (tenant_id, batch_id);
CREATE INDEX IF NOT EXISTS idx_tpm_log_zone  ON tpm_attribution_log (tenant_id, admin_area_id, period_month) WHERE scope = 'zone';
CREATE INDEX IF NOT EXISTS idx_tpm_log_visit ON tpm_attribution_log (tenant_id, visit_id) WHERE visit_id IS NOT NULL;
ALTER TABLE tpm_attribution_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON tpm_attribution_log;
CREATE POLICY tenant_isolation ON tpm_attribution_log
  USING (tenant_id::text = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));
GRANT SELECT, INSERT ON tpm_attribution_log TO mems2_app;
-- Indispensable : ALTER DEFAULT PRIVILEGES (migrations 002, 012) accorde aussi UPDATE et DELETE.
REVOKE UPDATE, DELETE, TRUNCATE ON tpm_attribution_log FROM mems2_app;

-- (4) Origine du TPM d'une visite : 'zone' (le TPM retenu de sa zone, état recopié dans
-- provider_zone_state ; NULL = à estampiller), 'visite' (écart motivé pour cette visite),
-- 'reprise' (TPM saisi avant cette règle : gardé, à vérifier).
ALTER TABLE site_visits
  ADD COLUMN IF NOT EXISTS provider_source     text NOT NULL DEFAULT 'zone',
  ADD COLUMN IF NOT EXISTS provider_zone_state text,
  ADD COLUMN IF NOT EXISTS provider_reason     text,
  ADD COLUMN IF NOT EXISTS provider_set_by     uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS provider_set_at     timestamptz;

-- Reprise de l'existant — rien n'est perdu :
--  a) visites qui portent déjà un TPM (ou un contrat), saisi à la main SANS raison : gardées telles
--     quelles ici (« reprise ») ; au démarrage de l'API, la réparation r58_tpm_zones leur applique le
--     TPM des contrats de leur zone (applyContractsTx) et inscrit chaque changement au journal
--     (avant → après). Seul un TPM choisi à la main AVEC une raison (origine « visite ») est gardé ;
UPDATE site_visits SET provider_source = 'reprise', provider_set_at = now(),
       provider_reason = 'Reprise : TPM saisi avant l''affectation par zone (retour 58).'
 WHERE provider_id IS NOT NULL OR contract_id IS NOT NULL;
--  b) sans TPM, réalisées, annulées ou d'un mois passé : figées (« antérieur à la règle ») ;
UPDATE site_visits SET provider_zone_state = 'anterieur'
 WHERE provider_source = 'zone' AND (status <> 'planifie' OR period_month < date_trunc('month', now())::date);
--  c) sans TPM, prévues pour le mois courant ou après : restent « à estampiller » — la réparation
--     r58_tpm_zones (démarrage de l'API) calcule la zone des sites puis les estampille.

ALTER TABLE site_visits
  ADD CONSTRAINT site_visits_provider_source_ck CHECK (provider_source IN ('zone', 'visite', 'reprise')),
  ADD CONSTRAINT site_visits_zone_state_ck CHECK (provider_zone_state IS NULL OR provider_zone_state IN
      ('contrat', 'modifie', 'aucun_tpm', 'a_arbitrer', 'sans_contrat', 'district_inconnu', 'anterieur')),
  -- « selon contrat », « modifié » ou « plusieurs contrats » (TPM par défaut) ⇒ un TPM ; tout autre
  -- état ⇒ aucun TPM ; un écart (visite, reprise) ⇒ une raison de 10 à 500 caractères.
  ADD CONSTRAINT site_visits_zone_shape_ck CHECK (CASE
      WHEN provider_source = 'zone' THEN provider_reason IS NULL
           AND (provider_zone_state IS NULL
                OR (provider_zone_state IN ('contrat', 'modifie', 'a_arbitrer')) = (provider_id IS NOT NULL))
      ELSE provider_zone_state IS NULL AND char_length(btrim(COALESCE(provider_reason, ''))) BETWEEN 10 AND 500 END),
  -- Le contrat d'une visite est DÉRIVÉ de sa zone (jamais posé à la main), sauf reprise.
  ADD CONSTRAINT site_visits_contract_derived_ck CHECK (contract_id IS NULL OR provider_source = 'reprise'
      OR (provider_source = 'zone' AND (provider_zone_state IS NULL OR provider_zone_state IN ('contrat', 'modifie', 'a_arbitrer'))));

CREATE INDEX IF NOT EXISTS idx_site_visits_tpm_zone ON site_visits (tenant_id, period_month)
  WHERE status = 'planifie' AND provider_source = 'zone';
CREATE INDEX IF NOT EXISTS idx_site_visits_tpm_pending ON site_visits (tenant_id)
  WHERE provider_source = 'zone' AND provider_zone_state IS NULL;

-- (5) Jumelle SQL de la règle (tpmAttribution.contractTpms / defaultFor / resolveCell / cellForSite) : la cellule
-- (aire, état, TPM, contrat) de chaque couple site × mois demandé. Parité avec la règle pure
-- vérifiée par server/scripts/tpmParity.js. Ligne de suivi = budgetCatalog.MONITORING_LINE.
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
  -- TPM d'un contrat (D1, jumelle de tpmAttribution.contractTpms) : partenaires ACTIFS de type TPM
  -- rattachés au contrat par un plan de collecte ou une facture / un rapport ; à défaut, le titulaire.
  tl AS (
    SELECT DISTINCT x.contract_id, x.partner_id, p.name
      FROM (SELECT contract_id, partner_id FROM tpm_collection_plans WHERE tenant_id = p_tenant
            UNION SELECT contract_id, partner_id FROM tpm_reports WHERE tenant_id = p_tenant) x
      JOIN partners p ON p.tenant_id = p_tenant AND p.id = x.partner_id AND p.active
      JOIN partner_types t ON t.tenant_id = p_tenant AND t.id = p.partner_type_id AND t.code = 'tpm'
     WHERE x.contract_id IN (SELECT id FROM cc0)),
  cc AS (
    SELECT cc0.id, cc0.numero, cc0.date_debut, cc0.m, tl.partner_id, tl.name AS pname
      FROM cc0 JOIN tl ON tl.contract_id = cc0.id
    UNION ALL
    SELECT cc0.id, cc0.numero, cc0.date_debut, cc0.m, cc0.partner_id, COALESCE(hp.name, cc0.partner_name)
      FROM cc0 LEFT JOIN partners hp ON hp.tenant_id = p_tenant AND hp.id = cc0.partner_id
     WHERE cc0.partner_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM tl WHERE tl.contract_id = cc0.id)),
  -- Leurs zones LIÉES (une zone détachée ne donne rien ; un fokontany est trop fin).
  cz AS (
    SELECT cc.id, cc.numero, cc.partner_id, cc.pname, cc.date_debut, cc.m, a.id AS zid, a.depth AS zdepth
      FROM cc
      JOIN contract_areas z ON z.tenant_id = p_tenant AND z.contract_id = cc.id
      JOIN admin_areas a ON a.tenant_id = p_tenant AND a.id = z.admin_area_id AND a.depth <= 3),
  -- Aire du site ce mois : sa commune si elle a sa propre ligne (zone de contrat exactement sur
  -- elle, ou modification posée sur elle), sinon son district ; NULL = district inconnu.
  tg AS (
    SELECT t.site_id, t.m,
           CASE WHEN t.did IS NULL THEN NULL
                WHEN t.cid IS NOT NULL AND (
                     EXISTS (SELECT 1 FROM cz WHERE cz.m = t.m AND cz.zid = t.cid)
                  OR EXISTS (SELECT 1 FROM tpm_zone_overrides o
                              WHERE o.tenant_id = p_tenant AND o.admin_area_id = t.cid AND o.period_month = t.m))
                THEN t.cid ELSE t.did END AS aid
      FROM t),
  -- Zones de contrat qui contiennent l'aire (exacte ou ancêtre) ; la plus précise l'emporte.
  hits AS (
    SELECT tg.site_id, tg.m, cz.partner_id, cz.pname, cz.id AS contract_id, cz.numero, cz.date_debut, cz.zdepth,
           max(cz.zdepth) OVER (PARTITION BY tg.site_id, tg.m) AS best
      FROM tg
      JOIN admin_areas ar ON ar.tenant_id = p_tenant AND ar.id = tg.aid
      JOIN cz ON cz.m = tg.m AND (cz.zid = tg.aid OR cz.zid = ANY (ar.lineage))),
  besthits AS (SELECT * FROM hits WHERE zdepth = best),
  -- TPM retenu (un seul, ou TPM par défaut de plusieurs) : contrat au début le plus récent, puis plus
  -- petit numéro, puis TPM (nom, identifiant) en ordre binaire — jumelle de tpmAttribution.byDefault.
  dflt AS (
    SELECT site_id, m, count(DISTINCT partner_id) AS holders,
           (array_agg(partner_id ORDER BY date_debut DESC, numero COLLATE "C", pname COLLATE "C", partner_id::text COLLATE "C"))[1] AS p,
           (array_agg(contract_id ORDER BY date_debut DESC, numero COLLATE "C", pname COLLATE "C", partner_id::text COLLATE "C"))[1] AS k
      FROM besthits GROUP BY site_id, m)
  SELECT tg.site_id, tg.m, tg.aid,
         CASE WHEN tg.aid IS NULL THEN 'district_inconnu'
              WHEN o.id IS NOT NULL AND o.provider_id IS NOT NULL THEN 'modifie'
              WHEN o.id IS NOT NULL THEN 'aucun_tpm'
              WHEN d.holders = 1 THEN 'contrat'
              WHEN d.holders > 1 THEN 'a_arbitrer'
              ELSE 'sans_contrat' END,
         CASE WHEN tg.aid IS NULL THEN NULL
              WHEN o.id IS NOT NULL THEN o.provider_id
              WHEN d.holders >= 1 THEN d.p END,
         CASE WHEN tg.aid IS NULL THEN NULL
              WHEN o.id IS NOT NULL THEN (SELECT (array_agg(x.contract_id ORDER BY x.date_debut DESC, x.numero COLLATE "C"))[1]
                                            FROM besthits x
                                           WHERE x.site_id = tg.site_id AND x.m = tg.m AND x.partner_id = o.provider_id)
              WHEN d.holders >= 1 THEN d.k END
    FROM tg
    LEFT JOIN dflt d ON d.site_id = tg.site_id AND d.m = tg.m
    LEFT JOIN tpm_zone_overrides o ON o.tenant_id = p_tenant AND o.admin_area_id = tg.aid AND o.period_month = tg.m
$fn$;

-- Estampille : visites « zone » demandées (p_ids) + toutes celles « à estampiller » du compte ;
-- n'écrit que les lignes qui changent (idempotent) et rend ce qui a changé. Sous le verrou
-- d'attribution du compte (le même que tpmAttribution.repository.lockAttributionTx : attente
-- bornée à 20 s, puis 55P03 → 503 « réessayez »).
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
       AND (v.provider_zone_state IS NULL OR v.id = ANY (COALESCE(p_ids, '{}'::uuid[])))
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

-- Garde AVANT écriture : une visite « zone » insérée, re-planifiée, déplacée (site, mois), rendue à
-- sa zone, ou dont le TPM / le contrat est écrit directement, repasse « à estampiller » — seule
-- mems_tpm_stamp écrit le TPM d'une visite « zone ».
CREATE OR REPLACE FUNCTION mems_site_visit_tpm_guard() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF current_setting('mems.tpm_stamping', true) = 'on' OR NEW.provider_source <> 'zone' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT'
     OR OLD.provider_source <> 'zone'
     OR NEW.provider_id IS DISTINCT FROM OLD.provider_id
     OR NEW.contract_id IS DISTINCT FROM OLD.contract_id
     OR NEW.site_id IS DISTINCT FROM OLD.site_id
     OR NEW.period_month IS DISTINCT FROM OLD.period_month
     OR (NEW.status = 'planifie' AND OLD.status <> 'planifie') THEN
    NEW.provider_zone_state := NULL;
  END IF;
  RETURN NEW;
END $fn$;
DROP TRIGGER IF EXISTS trg_site_visits_tpm_guard ON site_visits;
CREATE TRIGGER trg_site_visits_tpm_guard BEFORE INSERT OR UPDATE ON site_visits
  FOR EACH ROW EXECUTE FUNCTION mems_site_visit_tpm_guard();

-- Filet de sécurité au COMMIT : aucune transaction ne laisse une visite « à estampiller ». La
-- première ligne en attente estampille d'un coup toutes celles du compte (une requête
-- ensembliste) ; les suivantes, déjà estampillées, ne coûtent qu'une lecture par clé primaire.
CREATE OR REPLACE FUNCTION mems_site_visit_tpm_stamp() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF EXISTS (SELECT 1 FROM site_visits v WHERE v.id = NEW.id AND v.provider_source = 'zone' AND v.provider_zone_state IS NULL) THEN
    PERFORM * FROM mems_tpm_stamp(NEW.tenant_id, '{}'::uuid[]);
  END IF;
  RETURN NULL;
END $fn$;
DROP TRIGGER IF EXISTS trg_site_visits_tpm_stamp ON site_visits;
CREATE CONSTRAINT TRIGGER trg_site_visits_tpm_stamp
  AFTER INSERT OR UPDATE ON site_visits DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW WHEN (NEW.provider_source = 'zone' AND NEW.provider_zone_state IS NULL)
  EXECUTE FUNCTION mems_site_visit_tpm_stamp();

-- (6) Références « même compte » (migration 049) : nouvelles clés étrangères contrôlées à l'écriture.
SELECT mems_install_same_tenant('tpm_zone_overrides');
SELECT mems_install_same_tenant('site_visits');   -- provider_set_by
SELECT mems_install_same_tenant('sites');         -- zone_district_id, zone_commune_id

-- (7) Cache du concepteur de rapport (lot 7a) : s'il est déjà installé, une modification de zone
-- change les visites. Sinon, le lot 7a inscrit tpm_zone_overrides dans sa propre liste.
DO $$ BEGIN
  IF to_regprocedure('mems_data_changed()') IS NOT NULL THEN
    EXECUTE 'DROP TRIGGER IF EXISTS trg_data_changed ON tpm_zone_overrides';
    EXECUTE 'CREATE TRIGGER trg_data_changed AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON tpm_zone_overrides
             FOR EACH STATEMENT EXECUTE FUNCTION mems_data_changed(''visits'')';
  END IF;
END $$;
