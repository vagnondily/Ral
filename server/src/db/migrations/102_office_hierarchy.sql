-- MEMS 2.0 — Hiérarchie des bureaux d'un pays (demande du 15/10) : type de bureau.
--
-- Dans un compte (= un pays, docs/SPEC_MULTIPAYS.md option A) : Bureau pays › Bureau de zone ›
-- Sous-bureau › Antenne. Le Siège et les bureaux régionaux sont des unités AU-DESSUS des comptes
-- (module multi-pays, migrations 082–085). Un niveau peut manquer, mais le parent d'un bureau est
-- TOUJOURS d'un niveau strictement supérieur : une boucle de parenté est donc impossible. Mêmes
-- règles, avec des messages, dans server/src/modules/settings/officeTree.js (checkOffice).
--
-- Reprise des bureaux existants (même règle que officeTree.legacyTypes) :
--   périmètre national ou nature « pays » → bureau pays ;
--   bureau sans parent → bureau de zone ;
--   « antenne de … » sans enfant → antenne ;
--   enfant qui a lui-même des enfants → bureau de zone sous le bureau pays, sinon sous-bureau.
-- Les périmètres (field_office_communes) et le rattachement des sites ne sont pas touchés ici.
-- `nature` (pays / terrain) devient DÉDUITE du type (colonne conservée pour les lecteurs anciens).

CREATE OR REPLACE FUNCTION mems_office_rank(t text) RETURNS integer
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE t WHEN 'country' THEN 1 WHEN 'area' THEN 2 WHEN 'sub' THEN 3 WHEN 'antenna' THEN 4 END
$$;

ALTER TABLE field_offices ADD COLUMN IF NOT EXISTS office_type text;

-- 1. Parentés impossibles dans le nouveau modèle, corrigées AVANT la reprise (signalées) :
--    un bureau parent de lui-même, une boucle (A → B → A), un bureau pays qui a un parent.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT code FROM field_offices WHERE parent_id = id LOOP
    RAISE NOTICE 'Bureau « % » : était son propre parent → sans parent.', r.code;
  END LOOP;
  UPDATE field_offices SET parent_id = NULL WHERE parent_id = id;

  FOR r IN
    WITH RECURSIVE walk AS (
      SELECT id AS start, parent_id AS cur, 1 AS n FROM field_offices WHERE parent_id IS NOT NULL
      UNION ALL
      SELECT w.start, f.parent_id, w.n + 1 FROM walk w JOIN field_offices f ON f.id = w.cur
       WHERE w.cur IS NOT NULL AND w.cur <> w.start AND w.n < 64)
    SELECT DISTINCT o.id, o.code FROM walk w JOIN field_offices o ON o.id = w.start WHERE w.cur = w.start
  LOOP
    RAISE NOTICE 'Bureau « % » : boucle de parenté → sans parent.', r.code;
    UPDATE field_offices SET parent_id = NULL WHERE id = r.id;
  END LOOP;

  FOR r IN SELECT code FROM field_offices WHERE (national OR nature = 'pays') AND parent_id IS NOT NULL LOOP
    RAISE NOTICE 'Bureau pays « % » : le bureau pays est le plus haut niveau du compte → sans parent.', r.code;
  END LOOP;
  UPDATE field_offices SET parent_id = NULL WHERE (national OR nature = 'pays') AND parent_id IS NOT NULL;
END $$;

-- 2. Reprise du type (lignes encore sans type).
UPDATE field_offices o SET office_type = CASE
         WHEN o.national OR o.nature = 'pays' THEN 'country'
         WHEN o.parent_id IS NULL THEN 'area'
         WHEN NOT EXISTS (SELECT 1 FROM field_offices k WHERE k.parent_id = o.id) THEN 'antenna'
         WHEN (SELECT p.national OR p.nature = 'pays' FROM field_offices p WHERE p.id = o.parent_id) THEN 'area'
         ELSE 'sub' END
 WHERE o.office_type IS NULL;

-- 3. Chaînes plus profondes que les niveaux disponibles (sous-bureau sous un sous-bureau) : le
--    bureau trop bas est rattaché au parent de son parent, jusqu'à un parent de niveau supérieur
--    (signalé ; aucun cas dans les données connues).
DO $$
DECLARE r record; moved integer;
BEGIN
  LOOP
    moved := 0;
    FOR r IN
      SELECT c.id, c.code AS child, p.code AS parent, p.parent_id AS grand
        FROM field_offices c JOIN field_offices p ON p.id = c.parent_id
       WHERE mems_office_rank(p.office_type) >= mems_office_rank(c.office_type)
    LOOP
      UPDATE field_offices SET parent_id = r.grand WHERE id = r.id;
      RAISE NOTICE 'Bureau « % » : rattaché au-dessus de « % » (la hiérarchie n''a que 4 niveaux).', r.child, r.parent;
      moved := moved + 1;
    END LOOP;
    EXIT WHEN moved = 0;
  END LOOP;
END $$;

-- 4. Contraintes (le déclencheur ci-dessous complète : rang du parent, enfants, bureau pays unique).
ALTER TABLE field_offices ALTER COLUMN office_type SET NOT NULL;
ALTER TABLE field_offices DROP CONSTRAINT IF EXISTS field_offices_type_check;
ALTER TABLE field_offices ADD CONSTRAINT field_offices_type_check
  CHECK (office_type IN ('country', 'area', 'sub', 'antenna'));
ALTER TABLE field_offices DROP CONSTRAINT IF EXISTS field_offices_national_country;
ALTER TABLE field_offices ADD CONSTRAINT field_offices_national_country
  CHECK (NOT national OR office_type = 'country');
ALTER TABLE field_offices DROP CONSTRAINT IF EXISTS field_offices_not_own_parent;
ALTER TABLE field_offices ADD CONSTRAINT field_offices_not_own_parent
  CHECK (parent_id IS NULL OR parent_id <> id);
UPDATE field_offices SET nature = CASE WHEN office_type = 'country' THEN 'pays' ELSE 'terrain' END
 WHERE nature IS DISTINCT FROM CASE WHEN office_type = 'country' THEN 'pays' ELSE 'terrain' END;

CREATE INDEX IF NOT EXISTS idx_field_offices_parent ON field_offices (tenant_id, parent_id);

-- 5. Règles d'arbre à chaque écriture. Erreurs : 23514 (contrainte « field_offices_tree ») ou
--    23505 (« field_offices_one_country ») — les routes les traduisent en message clair.
--    Le parent est lu FOR SHARE : un changement de type concurrent du parent attend la fin de
--    cette transaction puis voit le nouvel enfant (et inversement).
CREATE OR REPLACE FUNCTION mems_field_office_tree() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  p record;
  bad text;
BEGIN
  IF NEW.office_type IS NULL THEN
    -- Écrivain d'avant la hiérarchie (sans type) : même déduction que la reprise.
    NEW.office_type := CASE WHEN NEW.national OR NEW.nature = 'pays' THEN 'country'
                            WHEN NEW.parent_id IS NULL THEN 'area' ELSE 'antenna' END;
  END IF;
  NEW.nature := CASE WHEN NEW.office_type = 'country' THEN 'pays' ELSE 'terrain' END;

  IF NEW.parent_id IS NOT NULL THEN
    SELECT o.office_type, o.name INTO p FROM field_offices o
     WHERE o.id = NEW.parent_id AND o.tenant_id = NEW.tenant_id FOR SHARE;
    IF FOUND AND (mems_office_rank(p.office_type) >= mems_office_rank(NEW.office_type)) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', CONSTRAINT = 'field_offices_tree',
        MESSAGE = format('« %s » n''est pas d''un niveau supérieur à ce bureau : choisissez un parent plus général.', p.name);
    END IF;
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.office_type IS DISTINCT FROM OLD.office_type THEN
    SELECT string_agg(format('« %s »', k.name), ', ' ORDER BY k.name) INTO bad
      FROM field_offices k
     WHERE k.parent_id = NEW.id AND k.tenant_id = NEW.tenant_id
       AND mems_office_rank(k.office_type) <= mems_office_rank(NEW.office_type);
    IF bad IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE = '23514', CONSTRAINT = 'field_offices_tree',
        MESSAGE = format('Ce type ne peut pas avoir sous lui : %s. Changez d''abord leur parent ou leur type.', bad);
    END IF;
  END IF;

  IF NEW.office_type = 'country' AND (TG_OP = 'INSERT' OR OLD.office_type IS DISTINCT FROM 'country') THEN
    PERFORM pg_advisory_xact_lock(hashtext('mems:office-country:' || NEW.tenant_id::text));
    IF EXISTS (SELECT 1 FROM field_offices o
                WHERE o.tenant_id = NEW.tenant_id AND o.office_type = 'country' AND o.id <> NEW.id) THEN
      RAISE EXCEPTION USING ERRCODE = '23505', CONSTRAINT = 'field_offices_one_country',
        MESSAGE = 'Ce compte a déjà un bureau pays : un seul bureau pays par pays.';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_field_office_tree ON field_offices;
CREATE TRIGGER trg_field_office_tree BEFORE INSERT OR UPDATE ON field_offices
  FOR EACH ROW EXECUTE FUNCTION mems_field_office_tree();
