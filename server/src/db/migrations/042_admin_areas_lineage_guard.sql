-- Garde-fou : la lignée (ids des ancêtres) d'une unité administrative est
-- calculée par la BASE à l'insertion quand l'appelant ne la fournit pas
-- (seed, imports, futurs écrivains) — le répertoire filtre par lignée, une
-- lignée vide rendrait l'unité invisible sous son ancêtre. Rattrapage des
-- lignes existantes incomplètes.
CREATE OR REPLACE FUNCTION admin_areas_fill_lineage() RETURNS trigger AS $$
BEGIN
  IF NEW.parent_id IS NOT NULL AND (NEW.lineage IS NULL OR cardinality(NEW.lineage) = 0) THEN
    SELECT p.lineage || p.id INTO NEW.lineage FROM admin_areas p WHERE p.id = NEW.parent_id;
  END IF;
  IF NEW.lineage IS NULL THEN NEW.lineage := '{}'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_admin_areas_lineage ON admin_areas;
CREATE TRIGGER trg_admin_areas_lineage BEFORE INSERT ON admin_areas
  FOR EACH ROW EXECUTE FUNCTION admin_areas_fill_lineage();

WITH RECURSIVE t AS (
  SELECT id, ARRAY[]::uuid[] AS lineage FROM admin_areas WHERE parent_id IS NULL
  UNION ALL
  SELECT a.id, t.lineage || a.parent_id FROM admin_areas a JOIN t ON a.parent_id = t.id
)
UPDATE admin_areas a SET lineage = t.lineage FROM t
 WHERE a.id = t.id AND a.parent_id IS NOT NULL AND cardinality(a.lineage) = 0;

UPDATE admin_levels SET code = 'adm' || depth WHERE code IS NULL AND depth BETWEEN 0 AND 9;
UPDATE admin_levels SET label_plural = CASE WHEN label ~ '[sxz]$' THEN label ELSE label || 's' END WHERE label_plural IS NULL;
