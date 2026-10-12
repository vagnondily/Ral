-- MEMS 2.0 — Isolation multitenant des RÉFÉRENCES.
--
-- Une clé étrangère ne passe pas par la RLS : un identifiant appartenant à un
-- AUTRE compte (prestataire, contrat, site, fiche…) était accepté tant qu'il
-- existait quelque part dans la table référencée. La RLS ne protège que les
-- LECTURES ; il faut donc aussi vérifier les ÉCRITURES.
--
-- Pour chaque table qui porte tenant_id et référence une autre table qui porte
-- tenant_id, un déclencheur BEFORE INSERT OR UPDATE vérifie que chaque ligne
-- référencée appartient au MÊME tenant (filtre explicite, indépendant de la RLS).
-- Les clés étrangères existantes et leurs actions (CASCADE, SET NULL) restent
-- inchangées. Erreur levée avec le code 23503 → 400 par le gestionnaire central.
--
-- Fonctions générées par table (SQL statique : plans mis en cache, coût d'une
-- recherche par clé primaire par référence modifiée). Une future migration qui
-- ajoute une telle référence appelle : SELECT mems_install_same_tenant('ma_table');

CREATE OR REPLACE FUNCTION mems_install_same_tenant(child regclass) RETURNS integer
LANGUAGE plpgsql AS $gen$
DECLARE
  r record;
  checks text := '';
  n integer := 0;
  tbl text := (SELECT relname FROM pg_class WHERE oid = child);
  fn text := format('mems_same_tenant_%s', tbl);
BEGIN
  FOR r IN
    SELECT a.attname AS col, c.confrelid::regclass AS parent
      FROM pg_constraint c
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
     WHERE c.contype = 'f' AND c.conrelid = child AND array_length(c.conkey, 1) = 1
       AND c.confrelid <> 'tenants'::regclass
       AND EXISTS (SELECT 1 FROM pg_attribute x WHERE x.attrelid = c.confrelid AND x.attname = 'tenant_id' AND NOT x.attisdropped)
     ORDER BY a.attname
  LOOP
    checks := checks || format($chk$
  IF NEW.%1$I IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.%1$I IS DISTINCT FROM OLD.%1$I OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id)
     AND NOT EXISTS (SELECT 1 FROM %2$s p WHERE p.id = NEW.%1$I AND p.tenant_id = NEW.tenant_id) THEN
    RAISE EXCEPTION USING ERRCODE = '23503',
      MESSAGE = format('Référence hors du compte refusée (%%s.%%s).', %3$L, %1$L);
  END IF;$chk$, r.col, r.parent, tbl);
    n := n + 1;
  END LOOP;

  EXECUTE format('DROP TRIGGER IF EXISTS trg_same_tenant ON %s', child);
  IF n = 0 THEN
    EXECUTE format('DROP FUNCTION IF EXISTS %I()', fn);
    RETURN 0;
  END IF;
  EXECUTE format($fn$CREATE OR REPLACE FUNCTION %I() RETURNS trigger LANGUAGE plpgsql AS $body$
BEGIN%s
  RETURN NEW;
END $body$$fn$, fn, checks);
  EXECUTE format('CREATE TRIGGER trg_same_tenant BEFORE INSERT OR UPDATE ON %s FOR EACH ROW EXECUTE FUNCTION %I()', child, fn);
  RETURN n;
END $gen$;

DO $$
DECLARE
  t regclass;
  bad record;
  installed integer := 0;
BEGIN
  -- Données existantes : signalées (jamais modifiées ici) ; le contrôle vaut pour toute écriture à venir.
  FOR bad IN
    SELECT c.conrelid::regclass AS child, a.attname AS col, c.confrelid::regclass AS parent
      FROM pg_constraint c JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
     WHERE c.contype = 'f' AND c.connamespace = 'public'::regnamespace AND array_length(c.conkey, 1) = 1
       AND c.confrelid <> 'tenants'::regclass
       AND EXISTS (SELECT 1 FROM pg_attribute x WHERE x.attrelid = c.conrelid AND x.attname = 'tenant_id' AND NOT x.attisdropped)
       AND EXISTS (SELECT 1 FROM pg_attribute x WHERE x.attrelid = c.confrelid AND x.attname = 'tenant_id' AND NOT x.attisdropped)
  LOOP
    DECLARE k bigint;
    BEGIN
      EXECUTE format('SELECT count(*) FROM %s ch JOIN %s p ON p.id = ch.%I WHERE p.tenant_id <> ch.tenant_id',
                     bad.child, bad.parent, bad.col) INTO k;
      IF k > 0 THEN
        RAISE WARNING '% ligne(s) de %.% référencent un autre compte (%) : à corriger.', k, bad.child, bad.col, bad.parent;
      END IF;
    END;
  END LOOP;

  FOR t IN
    SELECT DISTINCT c.conrelid::regclass
      FROM pg_constraint c
     WHERE c.contype = 'f' AND c.connamespace = 'public'::regnamespace
       AND EXISTS (SELECT 1 FROM pg_attribute x WHERE x.attrelid = c.conrelid AND x.attname = 'tenant_id' AND NOT x.attisdropped)
  LOOP
    IF mems_install_same_tenant(t) > 0 THEN installed := installed + 1; END IF;
  END LOOP;
  RAISE NOTICE 'Contrôle « même compte » installé sur % table(s).', installed;
END $$;
