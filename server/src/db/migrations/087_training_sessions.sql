-- MEMS 2.0 — Lot 8 (retour 28.2) : formations en SESSIONS. Migration 087.
--
-- Avant : une ligne « formation suivie » par agent (tpm_agent_formations : thématique, date,
-- jours) — impossible de voir une formation, ses thèmes, ses participants par prestataire.
-- Maintenant :
--   training_themes            référentiel des thèmes (par compte, sans doublon de graphie) ;
--   training_sessions          la formation : titre, objectif, dates, lieu, formateur,
--                              organisateur, statut, barème des tests et seuil de réussite,
--                              synthèse de l'évaluation de la formation ;
--   training_session_themes    thèmes couverts (durée facultative) ;
--   training_participants      un agent par ligne, avec son prestataire AU MOMENT de la
--                              session, sa présence, ses notes de pré-test / post-test et
--                              son avis (satisfaction 1–5, commentaire).
-- « Note ≤ barème » est imposée PAR LA BASE : clé étrangère composite (session, barème) avec
-- ON UPDATE CASCADE — baisser le barème sous une note déjà saisie est refusé.
-- Reprise NON destructive : chaque (thème, date) de tpm_agent_formations devient une session
-- « réalisée » d'origine « reprise » (clé legacy_key, ON CONFLICT DO NOTHING : rejouable), ses
-- agents deviennent participants présents. La table d'origine est conservée telle quelle.

CREATE TABLE IF NOT EXISTS training_themes (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  label      text NOT NULL CHECK (length(btrim(label)) BETWEEN 2 AND 160),
  -- Clé de doublon : casse et espaces ignorés (« Collecte  ODK » = « collecte odk »).
  label_key  text GENERATED ALWAYS AS (lower(btrim(regexp_replace(label, '\s+', ' ', 'g')))) STORED,
  active     boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, label_key)
);

CREATE TABLE IF NOT EXISTS training_sessions (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  title                text NOT NULL CHECK (length(btrim(title)) BETWEEN 2 AND 200),
  objective            text CHECK (objective IS NULL OR length(objective) <= 2000),
  start_date           date NOT NULL,
  end_date             date NOT NULL,
  place                text CHECK (place IS NULL OR length(place) <= 200),
  trainer              text CHECK (trainer IS NULL OR length(trainer) <= 200),
  organiser_partner_id uuid REFERENCES partners(id) ON DELETE SET NULL,          -- NULL = formation interne
  status               text NOT NULL DEFAULT 'planifiee' CHECK (status IN ('planifiee', 'realisee', 'annulee')),
  score_max            numeric(6,2) NOT NULL DEFAULT 100 CHECK (score_max > 0 AND score_max <= 1000),
  pass_mark            numeric(5,2) NOT NULL DEFAULT 70 CHECK (pass_mark BETWEEN 0 AND 100),  -- % du barème
  feedback_summary     text CHECK (feedback_summary IS NULL OR length(feedback_summary) <= 4000),
  origin               text NOT NULL DEFAULT 'saisie' CHECK (origin IN ('saisie', 'reprise')),
  legacy_key           text,
  created_by           uuid REFERENCES users(id),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT training_sessions_dates_chk CHECK (end_date >= start_date AND end_date < start_date + 366),
  UNIQUE (tenant_id, legacy_key),
  UNIQUE (id, score_max)
);
CREATE INDEX IF NOT EXISTS idx_training_sessions_date ON training_sessions (tenant_id, start_date DESC);

CREATE TABLE IF NOT EXISTS training_session_themes (
  tenant_id  uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES training_sessions(id) ON DELETE CASCADE,
  theme_id   uuid NOT NULL REFERENCES training_themes(id) ON DELETE RESTRICT,
  hours      numeric(5,1) CHECK (hours IS NULL OR (hours > 0 AND hours <= 500)),
  sort_order int NOT NULL DEFAULT 0,
  PRIMARY KEY (session_id, theme_id)
);
CREATE INDEX IF NOT EXISTS idx_training_session_themes_theme ON training_session_themes (tenant_id, theme_id);

CREATE TABLE IF NOT EXISTS training_participants (
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  session_id   uuid NOT NULL REFERENCES training_sessions(id) ON DELETE CASCADE,
  score_max    numeric(6,2) NOT NULL,
  -- Un agent qui a suivi une formation garde son historique : il se désactive, il ne se supprime pas.
  agent_id     uuid NOT NULL REFERENCES tpm_agents(id) ON DELETE RESTRICT,
  provider_id  uuid REFERENCES partners(id) ON DELETE SET NULL,                 -- prestataire au moment de la session
  attendance   text CHECK (attendance IS NULL OR attendance IN ('present', 'partiel', 'absent')),
  days_present numeric(4,1) CHECK (days_present IS NULL OR (days_present >= 0 AND days_present <= 366)),
  pre_score    numeric(6,2) CHECK (pre_score IS NULL OR (pre_score >= 0 AND pre_score <= score_max)),
  post_score   numeric(6,2) CHECK (post_score IS NULL OR (post_score >= 0 AND post_score <= score_max)),
  satisfaction smallint CHECK (satisfaction IS NULL OR satisfaction BETWEEN 1 AND 5),
  feedback     text CHECK (feedback IS NULL OR length(feedback) <= 1000),
  added_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, agent_id),
  -- Barème de la session recopié et tenu à jour : une note au-dessus du barème est impossible.
  CONSTRAINT training_participants_scale_fk FOREIGN KEY (session_id, score_max)
    REFERENCES training_sessions (id, score_max) ON UPDATE CASCADE ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_training_participants_agent ON training_participants (tenant_id, agent_id);
CREATE INDEX IF NOT EXISTS idx_training_participants_provider ON training_participants (tenant_id, provider_id);

ALTER TABLE training_themes ENABLE ROW LEVEL SECURITY;
ALTER TABLE training_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE training_session_themes ENABLE ROW LEVEL SECURITY;
ALTER TABLE training_participants ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON training_themes;
CREATE POLICY tenant_isolation ON training_themes
  USING (tenant_id::text = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));
DROP POLICY IF EXISTS tenant_isolation ON training_sessions;
CREATE POLICY tenant_isolation ON training_sessions
  USING (tenant_id::text = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));
DROP POLICY IF EXISTS tenant_isolation ON training_session_themes;
CREATE POLICY tenant_isolation ON training_session_themes
  USING (tenant_id::text = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));
DROP POLICY IF EXISTS tenant_isolation ON training_participants;
CREATE POLICY tenant_isolation ON training_participants
  USING (tenant_id::text = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mems2_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON training_themes, training_sessions, training_session_themes,
      training_participants TO mems2_app;
  END IF;
END $$;

-- ---- Reprise des formations saisies par agent (non destructive, rejouable) --------------
-- Thèmes : graphies distinctes (espaces fusionnés), la plus ancienne gardée.
INSERT INTO training_themes (tenant_id, label)
SELECT DISTINCT ON (f.tenant_id, lower(btrim(regexp_replace(f.thematique, '\s+', ' ', 'g'))))
       f.tenant_id, btrim(regexp_replace(f.thematique, '\s+', ' ', 'g'))
  FROM tpm_agent_formations f
 WHERE length(btrim(f.thematique)) >= 2
 ORDER BY f.tenant_id, lower(btrim(regexp_replace(f.thematique, '\s+', ' ', 'g'))), f.created_at
ON CONFLICT (tenant_id, label_key) DO NOTHING;

-- Une session par (thème, date) ; date absente → date de saisie ; durée = jours max (≥ 1).
INSERT INTO training_sessions (tenant_id, title, start_date, end_date, status, origin, legacy_key)
SELECT g.tenant_id, g.label, g.d, g.d + (least(greatest(ceil(g.jours), 1), 366)::int - 1), 'realisee', 'reprise', g.k || '|' || g.d::text
  FROM (SELECT f.tenant_id, lower(btrim(regexp_replace(f.thematique, '\s+', ' ', 'g'))) AS k,
               min(btrim(regexp_replace(f.thematique, '\s+', ' ', 'g'))) AS label,
               COALESCE(f.date_formation, f.created_at::date) AS d, max(f.jours) AS jours
          FROM tpm_agent_formations f
         WHERE length(btrim(f.thematique)) >= 2
         GROUP BY 1, 2, 4) g
ON CONFLICT (tenant_id, legacy_key) DO NOTHING;

INSERT INTO training_session_themes (tenant_id, session_id, theme_id)
SELECT s.tenant_id, s.id, t.id
  FROM training_sessions s
  JOIN training_themes t ON t.tenant_id = s.tenant_id AND t.label_key = left(s.legacy_key, length(s.legacy_key) - 11)
 WHERE s.origin = 'reprise'
ON CONFLICT DO NOTHING;

INSERT INTO training_participants (tenant_id, session_id, score_max, agent_id, provider_id, attendance, days_present)
SELECT f.tenant_id, s.id, s.score_max, f.agent_id, a.tpm_provider_id, 'present', least(f.jours, 366)
  FROM tpm_agent_formations f
  JOIN tpm_agents a ON a.id = f.agent_id AND a.tenant_id = f.tenant_id
  JOIN training_sessions s ON s.tenant_id = f.tenant_id
   AND s.legacy_key = lower(btrim(regexp_replace(f.thematique, '\s+', ' ', 'g'))) || '|' || COALESCE(f.date_formation, f.created_at::date)::text
 WHERE length(btrim(f.thematique)) >= 2
ON CONFLICT (session_id, agent_id) DO NOTHING;

-- Références entre tables d'un compte : contrôle « même compte » (migration 049).
SELECT mems_install_same_tenant('training_themes');
SELECT mems_install_same_tenant('training_sessions');
SELECT mems_install_same_tenant('training_session_themes');
SELECT mems_install_same_tenant('training_participants');
