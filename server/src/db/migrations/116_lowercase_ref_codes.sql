-- Codes de référence en minuscules — les rôles de l'app (TPM, partenaire de mise en œuvre…)
-- sont reconnus par le CODE littéral en minuscules ('tpm', 'prestataire'). Le formulaire
-- « Nouveau type de partenaire / activité » laissait saisir le code tel quel : un code « TPM »
-- (majuscules) n'était alors JAMAIS reconnu comme TPM (classé « Autres partenaires », contrats
-- affichés « Interne »). On normalise les codes existants en minuscules, sans créer de collision
-- avec la contrainte UNIQUE(tenant_id, code) : on ne met en minuscules que là où la forme
-- minuscule n'existe pas déjà pour le même compte.

UPDATE partner_types p SET code = lower(code)
 WHERE code <> lower(code)
   AND NOT EXISTS (
     SELECT 1 FROM partner_types q
      WHERE q.tenant_id = p.tenant_id AND q.id <> p.id AND q.code = lower(p.code));

UPDATE activities a SET code = lower(code)
 WHERE code <> lower(code)
   AND NOT EXISTS (
     SELECT 1 FROM activities b
      WHERE b.tenant_id = a.tenant_id AND b.id <> a.id AND b.code = lower(a.code));
