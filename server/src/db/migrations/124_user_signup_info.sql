-- 124 — Informations de base de l'auto-inscription (vues par l'admin avant validation).
-- Un compte « pending » (demande d'accès) porte, en plus de son nom et de son email, un téléphone,
-- une fonction (poste) et un motif libre saisis au moment de l'inscription. Facultatifs, bornés.
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS job_title text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS signup_note text;
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_signup_lengths;
ALTER TABLE users ADD CONSTRAINT users_signup_lengths CHECK (
  (phone IS NULL OR length(phone) <= 40)
  AND (job_title IS NULL OR length(job_title) <= 120)
  AND (signup_note IS NULL OR length(signup_note) <= 500));
