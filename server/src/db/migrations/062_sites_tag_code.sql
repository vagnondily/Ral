-- MEMS 2.0 — Registre des sites : étiquette d'activité codée (page de gestion
-- des sites, colonnes « Activity_tag » + « Tag_code »).
--
-- La table `sites` porte déjà toutes les autres colonnes de la page : code
-- (Identifiant), name (Localité), location_id (Code POI), field_office_id,
-- adm1–adm4 (Region/District/Commune/Fokontany) et leurs adm1_pcode…adm4_pcode,
-- activity (Activity_tag), gps_lat/gps_lng (Lat/Long), admin_area_id, geo_status.
-- Il ne manque que le CODE de l'étiquette d'activité.

ALTER TABLE sites ADD COLUMN IF NOT EXISTS tag_code text;
