-- MEMS 2.0 — Tâches de fond SANS Redis (performance, retours 61, 84 et 95). Migration 081.
--
-- Les travaux longs (import de soumissions, réapplication des rattachements…) ne
-- s'exécutent plus dans la requête HTTP : la requête enregistre une TÂCHE et répond
-- aussitôt (202 + identifiant) ; un exécuteur intégré à l'API (modules/jobs) la prend,
-- l'exécute et publie son avancement. Fonctionne sans Redis (poste Windows de l'utilisateur).
--
--   app_jobs        : une ligne par tâche — type, statut, avancement, résultat ou erreur ;
--   app_job_inputs  : le fichier envoyé (import), supprimé dès que la tâche se termine.
--
-- Règles en base (filet de sécurité des règles pures de modules/jobs/jobMachine.js) :
--   - statuts queued → running → done | failed (queued → failed si la tâche ne peut pas
--     démarrer) ; une tâche terminée ne change plus (déclencheur) ;
--   - au plus UNE tâche en cours par compte (index unique partiel) : l'exécuteur ne
--     travaille jamais deux fois en même temps sur les données d'un même compte ;
--   - une tâche coalescée (dedupe_key) n'est en file qu'une fois par compte ;
--   - RLS par compte ; la prise d'une tâche, toutes comptes confondus, passe par des
--     fonctions SECURITY DEFINER (comme outbox_claim, migration 004).

CREATE TABLE IF NOT EXISTS app_jobs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  kind          text NOT NULL CHECK (kind ~ '^[a-z][a-z0-9_.-]{1,60}$'),
  status        text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'done', 'failed')),
  -- Paramètres (petits : identifiant de fiche, nom du fichier…) ; le fichier est à part.
  payload       jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (octet_length(payload::text) <= 16384),
  progress      jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (octet_length(progress::text) <= 4096),
  result        jsonb CHECK (result IS NULL OR octet_length(result::text) <= 1048576),
  error         jsonb CHECK (error IS NULL OR octet_length(error::text) <= 65536),
  dedupe_key    text CHECK (dedupe_key IS NULL OR length(dedupe_key) BETWEEN 1 AND 200),
  attempts      integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  runner        text CHECK (runner IS NULL OR length(runner) <= 200),
  created_by    uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  started_at    timestamptz,
  heartbeat_at  timestamptz,
  finished_at   timestamptz,
  CONSTRAINT app_jobs_finished CHECK ((status IN ('done', 'failed')) = (finished_at IS NOT NULL)),
  CONSTRAINT app_jobs_started CHECK (status IN ('queued', 'failed') OR started_at IS NOT NULL),
  CONSTRAINT app_jobs_result CHECK (status = 'done' OR result IS NULL),
  CONSTRAINT app_jobs_error CHECK ((status = 'failed') = (error IS NOT NULL))
);

-- Une seule tâche en cours par compte (la vraie garde de la concurrence « 1 par compte »).
CREATE UNIQUE INDEX IF NOT EXISTS uq_app_jobs_running_tenant ON app_jobs (tenant_id) WHERE status = 'running';
-- Une tâche coalescée n'est en file qu'une fois (ex. réapplication des rattachements).
CREATE UNIQUE INDEX IF NOT EXISTS uq_app_jobs_queued_dedupe ON app_jobs (tenant_id, kind, dedupe_key)
  WHERE status = 'queued' AND dedupe_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_app_jobs_queue ON app_jobs (created_at, id) WHERE status = 'queued';
CREATE INDEX IF NOT EXISTS idx_app_jobs_tenant_recent ON app_jobs (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_app_jobs_running ON app_jobs (heartbeat_at) WHERE status = 'running';

CREATE TABLE IF NOT EXISTS app_job_inputs (
  job_id      uuid PRIMARY KEY REFERENCES app_jobs(id) ON DELETE CASCADE,
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  data        bytea NOT NULL CHECK (octet_length(data) BETWEEN 1 AND 104857600),
  created_at  timestamptz NOT NULL DEFAULT now()
);
-- Un .xlsx ou un .zip est déjà compressé : pas de seconde compression TOAST.
ALTER TABLE app_job_inputs ALTER COLUMN data SET STORAGE EXTERNAL;

ALTER TABLE app_jobs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON app_jobs;
CREATE POLICY tenant_isolation ON app_jobs USING (tenant_id::text = current_setting('app.tenant_id', true));
ALTER TABLE app_job_inputs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON app_job_inputs;
CREATE POLICY tenant_isolation ON app_job_inputs USING (tenant_id::text = current_setting('app.tenant_id', true));

GRANT SELECT, INSERT, UPDATE ON app_jobs TO mems2_app;
GRANT SELECT, INSERT, DELETE ON app_job_inputs TO mems2_app;

-- Cycle de vie : passages permis seulement ; compte, type et date de création immuables ;
-- une tâche terminée ne change plus. Code 23514 → 400 par le gestionnaire central.
CREATE OR REPLACE FUNCTION app_jobs_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.kind IS DISTINCT FROM OLD.kind
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Tâche : compte, type et date de création immuables.';
  END IF;
  IF OLD.status IN ('done', 'failed') THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = format('Tâche terminée (%s) : plus aucune modification.', OLD.status);
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
       (OLD.status = 'queued' AND NEW.status IN ('running', 'failed'))
    OR (OLD.status = 'running' AND NEW.status IN ('done', 'failed'))) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = format('Tâche : passage %s → %s refusé.', OLD.status, NEW.status);
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_app_jobs_guard ON app_jobs;
CREATE TRIGGER trg_app_jobs_guard BEFORE UPDATE ON app_jobs FOR EACH ROW EXECUTE FUNCTION app_jobs_guard();

-- Tâche terminée : son fichier est supprimé dans la MÊME transaction (pas de fichiers orphelins).
CREATE OR REPLACE FUNCTION app_jobs_drop_input() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM app_job_inputs WHERE job_id = NEW.id;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS trg_app_jobs_drop_input ON app_jobs;
CREATE TRIGGER trg_app_jobs_drop_input AFTER UPDATE OF status ON app_jobs
  FOR EACH ROW WHEN (NEW.status IN ('done', 'failed')) EXECUTE FUNCTION app_jobs_drop_input();

-- ---- Fonctions de l'exécuteur (tous comptes confondus) -------------------------------

-- Prend la plus ancienne tâche en file d'un compte qui n'a aucune tâche en cours.
-- Deux exécuteurs : SKIP LOCKED ; course sur le même compte : l'index unique tranche,
-- le perdant ne prend rien ce tour-ci.
CREATE OR REPLACE FUNCTION app_jobs_claim(p_runner text)
RETURNS SETOF app_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH claimed AS (
    UPDATE app_jobs j
       SET status = 'running', started_at = now(), heartbeat_at = now(), runner = p_runner, attempts = j.attempts + 1
     WHERE j.id = (
       SELECT q.id FROM app_jobs q
        WHERE q.status = 'queued'
          AND NOT EXISTS (SELECT 1 FROM app_jobs r WHERE r.tenant_id = q.tenant_id AND r.status = 'running')
        ORDER BY q.created_at, q.id
        LIMIT 1
        FOR UPDATE SKIP LOCKED)
    RETURNING j.*)
  SELECT * FROM claimed;
EXCEPTION WHEN unique_violation THEN
  RETURN;
END $$;

-- Battement de cœur des tâches en cours d'un exécuteur.
CREATE OR REPLACE FUNCTION app_jobs_heartbeat(p_runner text, p_ids uuid[])
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH t AS (
    UPDATE app_jobs SET heartbeat_at = now()
     WHERE id = ANY (p_ids) AND runner = p_runner AND status = 'running' RETURNING 1)
  SELECT count(*)::integer FROM t;
$$;

-- Tâches « en cours » qui ne tournent plus : celles de CET exécuteur au démarrage (le
-- processus précédent s'est arrêté pendant leur exécution), et celles dont le battement
-- de cœur s'est tu (exécuteur arrêté ailleurs). Marquées en échec avec un message clair.
CREATE OR REPLACE FUNCTION app_jobs_fail_stale(p_runner text, p_stale_seconds integer)
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH t AS (
    UPDATE app_jobs
       SET status = 'failed', finished_at = now(),
           error = jsonb_build_object('statusCode', 503, 'code', 'interrupted',
             'message', 'Tâche interrompue : le serveur s''est arrêté pendant son exécution. Relancez-la.')
     WHERE status = 'running'
       AND ((p_runner IS NOT NULL AND runner = p_runner)
            OR heartbeat_at < now() - make_interval(secs => GREATEST(p_stale_seconds, 30)))
    RETURNING 1)
  SELECT count(*)::integer FROM t;
$$;

-- Ménage : tâches terminées depuis plus de p_days jours.
CREATE OR REPLACE FUNCTION app_jobs_purge(p_days integer)
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH t AS (
    DELETE FROM app_jobs WHERE status IN ('done', 'failed') AND finished_at < now() - make_interval(days => GREATEST(p_days, 1))
    RETURNING 1)
  SELECT count(*)::integer FROM t;
$$;

GRANT EXECUTE ON FUNCTION app_jobs_claim(text) TO mems2_app;
GRANT EXECUTE ON FUNCTION app_jobs_heartbeat(text, uuid[]) TO mems2_app;
GRANT EXECUTE ON FUNCTION app_jobs_fail_stale(text, integer) TO mems2_app;
GRANT EXECUTE ON FUNCTION app_jobs_purge(integer) TO mems2_app;

-- Références vers d'autres tables d'un compte (created_by → users, job_id → app_jobs) :
-- contrôle « même compte » à l'écriture (migration 049).
SELECT mems_install_same_tenant('app_jobs');
SELECT mems_install_same_tenant('app_job_inputs');
