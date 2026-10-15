-- MEMS 2.0 — Concepteur de rapport (lot 7a, C8, retours 51 et 88) : images des en-têtes et
-- pieds de page (logos) et « mes en-têtes » enregistrés. Migration 062.
--
-- Une image est téléversée UNE fois par compte (empreinte SHA-256 unique par compte) et citée par
-- son identifiant dans les documents et modèles (élément « image » d'une bande). Le format est
-- reconnu par les OCTETS (common/imageInfo.js : PNG ou JPEG seulement — SVG, GIF, WebP, PDF, HTML
-- refusés en nommant le format), largeur et hauteur lues dans l'en-tête de l'image ; l'API la sert
-- avec « X-Content-Type-Options: nosniff » et « Content-Security-Policy: default-src 'none' ».
--
-- La base est le filet de sécurité des mêmes règles : format, dimensions (1 à 4 000 px), taille
-- (512 Ko au plus, égale à la longueur des octets), empreinte au bon format, nom borné.
-- Quota par compte (200 images, 50 Mo) : vérifié dans la transaction d'insertion, sous verrou
-- consultatif par compte (reportAssets.repository) — deux envois simultanés ne le dépassent pas.
--
-- IMMUABLE : mems2_app n'a que SELECT et INSERT (une image citée par un rapport validé ne doit
-- jamais changer sous lui). Isolation : RLS + contrôle « même compte » de created_by (049).

CREATE TABLE IF NOT EXISTS report_assets (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  sha256      text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  mime        text NOT NULL CHECK (mime IN ('image/png', 'image/jpeg')),
  width       integer NOT NULL CHECK (width BETWEEN 1 AND 4000),
  height      integer NOT NULL CHECK (height BETWEEN 1 AND 4000),
  bytes       integer NOT NULL CHECK (bytes BETWEEN 1 AND 524288),
  data        bytea NOT NULL CHECK (octet_length(data) = bytes),
  name        text CHECK (name IS NULL OR length(name) <= 120),
  created_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_report_assets_sha UNIQUE (tenant_id, sha256)
);
CREATE INDEX IF NOT EXISTS idx_report_assets_tenant ON report_assets (tenant_id, created_at DESC);

ALTER TABLE report_assets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON report_assets;
CREATE POLICY tenant_isolation ON report_assets USING (tenant_id::text = current_setting('app.tenant_id', true));

-- Immuables : lecture et insertion seulement (les privilèges par défaut des migrations 002/012
-- donnent aussi UPDATE et DELETE : on les retire).
GRANT SELECT, INSERT ON report_assets TO mems2_app;
REVOKE UPDATE, DELETE ON report_assets FROM mems2_app;

SELECT mems_install_same_tenant('report_assets');

-- « Mes en-têtes » (retour 88) : en-têtes et pieds de page dessinés, enregistrés par le compte et
-- réutilisables dans tout rapport (galerie du concepteur d'en-tête, à côté des modèles prédéfinis).
-- Contenu { header, footer } validé par le schéma zod des bandes (reportSchema) ; les logos cités
-- sont contrôlés dans le compte ; nom unique par compte (sans casse).
CREATE TABLE IF NOT EXISTS report_band_templates (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  content     jsonb NOT NULL CHECK (jsonb_typeof(content) = 'object' AND octet_length(content::text) <= 200000),
  created_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_report_band_templates_name ON report_band_templates (tenant_id, lower(name));

ALTER TABLE report_band_templates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON report_band_templates;
CREATE POLICY tenant_isolation ON report_band_templates USING (tenant_id::text = current_setting('app.tenant_id', true));
GRANT SELECT, INSERT, UPDATE, DELETE ON report_band_templates TO mems2_app;

SELECT mems_install_same_tenant('report_band_templates');
