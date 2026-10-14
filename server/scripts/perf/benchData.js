/**
 * Jeu synthétique DÉTERMINISTE du banc de période (lot 1b) — tout est dérivé
 * d'index (md5 / hashtext), aucun aléa : deux chargements donnent les mêmes
 * lignes. Chargé en superutilisateur (insertion en masse), mesuré ensuite sous
 * le rôle mems2_app (RLS active).
 *
 * Volume (tenant A) :
 *  - découpage 19 370 zones (24 régions / 120 districts / 1 702 communes / 17 524 fokontany) ;
 *  - 3 000 sites (10 % sans pcode de commune, 3 % en zone interdite, district à casse variable,
 *    2,4 % avec un P-code de district d'une autre région) ;
 *  - grille d'activation 2024-2026 (36 mois), 8 % de « Non », cases vides réalistes :
 *    5 % de sites jamais renseignés, 5 % ouverts en juillet 2025, 5 % fermés après mars 2026 ;
 *  - 3 fiches × 60 indicateurs (+ 1 champ calculé par fiche) ;
 *  - 60 000 soumissions sur 24 mois (nov. 2024 → oct. 2026 : 30 000 par 12 mois),
 *    ~1,7 ko de JSON chacune, avril 2026 presque vide ;
 *  - 10 000 visites sur 36 mois (nov. 2023 → oct. 2026), dont des doublons site × mois.
 * Tenant B : un petit jeu (sites, soumissions, visites) qui ne doit JAMAIS apparaître
 * dans les mesures du tenant A.
 */

const T1 = 'b0000000-0000-4000-8000-0000000000a1';
const T2 = 'b0000000-0000-4000-8000-0000000000b2';
/** Identifiant déterministe (uuid) d'une clé. */
const uid = (key) => {
  const h = require('crypto').createHash('md5').update(key).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
};
const FORMS = [1, 2, 3].map((f) => uid(`form${f}`));
/** Dernier mois des données (les plages mesurées finissent là). */
const DATA_END = '2026-10';

const ACTIVITIES = "ARRAY['GD','SAMS','Cantine','FFA']";

// Étapes du chargement : [libellé, SQL, tenants] — $1 = tenant A (défaut) ou B ('B') ; 'AB' : $1 = A, $2 = B.
const STEPS = [
  ['tenants', `INSERT INTO tenants (id, name) VALUES ($1, 'Banc période A'), ($2, 'Banc période B')`, 'AB'],
  ['régions', `INSERT INTO admin_areas (id, tenant_id, depth, name, path, pcode)
     SELECT md5('r'||r)::uuid, $1, 1, 'Région '||lpad(r::text,2,'0'), 'Région '||lpad(r::text,2,'0'), 'MG'||lpad(r::text,2,'0')
       FROM generate_series(1,24) r`],
  ['districts', `INSERT INTO admin_areas (id, tenant_id, depth, name, parent_id, path, pcode)
     SELECT md5('d'||d)::uuid, $1, 2, 'District '||lpad(d::text,3,'0'), md5('r'||(1+(d-1)/5))::uuid,
            'R'||(1+(d-1)/5)||'/D'||d, 'MG'||lpad((1+(d-1)/5)::text,2,'0')||lpad((1+(d-1)%5)::text,2,'0')
       FROM generate_series(1,120) d`],
  ['communes', `INSERT INTO admin_areas (id, tenant_id, depth, name, parent_id, path, pcode)
     SELECT md5('c'||c)::uuid, $1, 3, 'Commune '||lpad(c::text,4,'0'), d.id, d.path||'/C'||c, d.pcode||lpad((1+(c-1)/120)::text,2,'0')
       FROM generate_series(1,1702) c JOIN admin_areas d ON d.id = md5('d'||(1+(c-1)%120))::uuid`],
  ['fokontany', `INSERT INTO admin_areas (id, tenant_id, depth, name, parent_id, path, pcode)
     SELECT md5('f'||f)::uuid, $1, 4, 'Fokontany '||f, c.id, c.path||'/F'||f, c.pcode||lpad((1+(f-1)/1702)::text,2,'0')
       FROM generate_series(1,17524) f JOIN admin_areas c ON c.id = md5('c'||(1+(f-1)%1702))::uuid`],
  ['bureaux', `INSERT INTO field_offices (id, tenant_id, code, name, nature)
     SELECT md5('o'||o)::uuid, $1, 'B'||o, 'Bureau '||o, 'terrain' FROM generate_series(1,4) o`],
  ['antennes', `INSERT INTO field_offices (id, tenant_id, code, name, nature, parent_id)
     SELECT md5('a'||a)::uuid, $1, 'A'||a, 'Antenne '||a, 'terrain', md5('o'||(1+(a-1)%4))::uuid FROM generate_series(1,8) a`],
  ['sites', `INSERT INTO sites (id, tenant_id, code, name, district, commune, activity, risk_level, adm1, adm2, adm3,
                              adm1_pcode, adm2_pcode, adm3_pcode, security_situation, field_office_id)
     SELECT md5('s'||i)::uuid, $1, 'S'||lpad(i::text,5,'0'), 'Site '||i,
            CASE WHEN i % 5 = 0 THEN upper(d.name) WHEN i % 7 = 0 THEN lower(d.name) ELSE d.name END,
            c.name, (${ACTIVITIES})[1 + i % 4], (ARRAY['faible','moyenne','elevee'])[1 + (i/3) % 3],
            r.name, CASE WHEN i % 5 = 0 THEN upper(d.name) WHEN i % 7 = 0 THEN lower(d.name) ELSE d.name END, c.name,
            r.pcode, d.pcode, CASE WHEN i % 10 = 0 THEN NULL ELSE c.pcode END,
            CASE WHEN i % 33 = 0 THEN 99 ELSE 0 END,
            CASE WHEN i % 9 = 0 THEN NULL WHEN i % 2 = 0 THEN md5('a'||(1+i%8))::uuid ELSE md5('o'||(1+i%4))::uuid END
       FROM generate_series(1,3000) i
       JOIN admin_areas c ON c.id = md5('c'||(1 + (i*37) % 1702))::uuid
       JOIN admin_areas d ON d.id = c.parent_id
       JOIN admin_areas r ON r.id = d.parent_id`],
  // P-code de district d'une AUTRE région (≈ 2,4 % des sites ; 205 / 1 081 sur la base de
  // démonstration) : le site reste dans le district de sa graphie (common/siteDistrict).
  ['sites (P-code d\'une autre région)', `UPDATE sites s SET adm2_pcode = d.pcode
     FROM admin_areas d
    WHERE s.tenant_id = $1 AND substr(s.code, 2)::int % 41 = 0
      AND d.id = md5('d'||(1 + (substr(s.code, 2)::int * 7 + 17) % 120))::uuid
      AND d.parent_id IS DISTINCT FROM (SELECT x.parent_id FROM admin_areas x WHERE x.tenant_id = $1 AND x.pcode = s.adm2_pcode)`],
  ['sites (tenant B)', `INSERT INTO sites (id, tenant_id, code, name, district, commune, activity)
     SELECT md5('s2-'||i)::uuid, $1, 'T'||i, 'Autre site '||i, 'District 001', 'Commune 0001', (${ACTIVITIES})[1 + i % 4]
       FROM generate_series(1,100) i`, 'B'],
  ['grille d\'activation', `INSERT INTO site_month_status (tenant_id, site_id, year, month, active)
     SELECT $1, s.id, y, m, NOT (abs(hashtext(s.code||'-'||y||'-'||m)) % 100 < 8)
       FROM sites s CROSS JOIN generate_series(2024,2026) y CROSS JOIN generate_series(1,12) m
      WHERE s.tenant_id = $1
        AND substr(s.code,2)::int % 20 <> 1
        AND NOT (substr(s.code,2)::int % 20 = 2 AND make_date(y,m,1) < date '2025-07-01')
        AND NOT (substr(s.code,2)::int % 20 = 3 AND make_date(y,m,1) > date '2026-03-01')`],
  ['grille (tenant B)', `INSERT INTO site_month_status (tenant_id, site_id, year, month, active)
     SELECT $1, s.id, 2026, m, true FROM sites s CROSS JOIN generate_series(1,12) m WHERE s.tenant_id = $1`, 'B'],
  ['prestataires', `INSERT INTO partner_types (id, tenant_id, code, label) VALUES (md5('pt')::uuid, $1, 'tpm_banc', 'TPM')`],
  ['prestataires (suite)', `INSERT INTO partners (id, tenant_id, partner_type_id, name)
     SELECT md5('p'||p)::uuid, $1, md5('pt')::uuid, 'Prestataire '||p FROM generate_series(1,8) p`],
  ['fiches', `INSERT INTO monitoring_forms (id, tenant_id, code, label, activity_category)
     SELECT md5('form'||f)::uuid, $1, 'F'||f, (ARRAY['Suivi GD','Suivi SAMS','Suivi cantine'])[f], (ARRAY['GD','SAMS','Cantine'])[f]
       FROM generate_series(1,3) f`],
  ['fiche (tenant B)', `INSERT INTO monitoring_forms (id, tenant_id, code, label, activity_category)
     VALUES (md5('form-b')::uuid, $1, 'FB', 'Fiche B', 'GD')`, 'B'],
  ['indicateurs', `INSERT INTO monitoring_indicators (tenant_id, form_id, code, label, module, source_field, agg, positive_value, target, sort_order)
     SELECT $1, md5('form'||f)::uuid, 'I'||k, 'Indicateur '||k, 'Domaine '||(1+k%6),
            CASE WHEN k = 60 THEN 'calc_ok' WHEN k % 5 IN (3,4) THEN 'q'||(31 + k%10) ELSE 'q'||(1 + k%30) END,
            CASE k % 5 WHEN 3 THEN 'mean' WHEN 4 THEN 'percent_value' ELSE 'percent_yes' END,
            CASE k % 5 WHEN 4 THEN '2' END, CASE WHEN k % 3 = 0 THEN 80 END, k
       FROM generate_series(1,3) f CROSS JOIN generate_series(1,60) k`],
  ['champs calculés', `INSERT INTO monitoring_calc_fields (tenant_id, form_id, name, label, kind, expression, sort_order)
     SELECT $1, md5('form'||f)::uuid, 'calc_ok', 'Conforme', 'expression', 'IF(q31 > 5 AND q1 = "Oui", "Oui", "Non")', 0
       FROM generate_series(1,3) f`],
  // 60 000 soumissions : 2 500 par mois, avril 2026 presque vide (1 sur 11 gardée).
  ['soumissions', `INSERT INTO monitoring_submissions (tenant_id, form_id, external_id, period_month, submitted_at, field_office,
                     field_office_id, admin1, admin2, admin3, adm3_pcode, site, site_id, partner, agent, source, data, excluded)
     SELECT $1, md5('form'||(1 + abs(hashtext('f'||i)) % 3))::uuid, 'X'||i, m.mo, m.mo + ((i % 27) || ' days')::interval, (1 + i % 8)::text,
            CASE WHEN i % 3 = 0 THEN md5('a'||(1+i%8))::uuid END,
            CASE i % 4 WHEN 0 THEN NULL WHEN 1 THEN upper(st.adm1) ELSE st.adm1_pcode END,
            st.adm2_pcode,
            CASE WHEN i % 10 = 9 THEN 'MG999999' ELSE st.adm3_pcode END,
            CASE WHEN i % 10 = 9 THEN NULL ELSE st.adm3_pcode END,
            st.code, CASE WHEN i % 10 < 3 THEN st.id END, 'P'||(1 + i % 8), 'AG'||(1 + i % 60), 'kobo',
            (SELECT jsonb_object_agg('q'||k, CASE WHEN k <= 30 THEN to_jsonb((ARRAY['Oui','Non','Oui','NA'])[1 + abs(hashtext(i||'.'||k)) % 4])
                                               WHEN k <= 40 THEN to_jsonb(abs(hashtext(i||'.'||k)) % 11)
                                               ELSE to_jsonb('texte '||substr(md5(i||'.'||k), 1, 4)) END)
               FROM generate_series(1,100) k) || jsonb_build_object('_uuid', md5('u'||i)),
            i % 97 = 0
       FROM generate_series(1,60000) i
       CROSS JOIN LATERAL (SELECT (date '2024-11-01' + (((i*13) % 24) * interval '1 month'))::date AS mo) m
       JOIN sites st ON st.id = md5('s'||(1 + abs(hashtext('s'||i)) % 3000))::uuid
      WHERE m.mo <> date '2026-04-01' OR i % 11 = 0`],
  ['soumissions (tenant B)', `INSERT INTO monitoring_submissions (tenant_id, form_id, external_id, period_month, admin1, admin3, site, source, data)
     SELECT $1, md5('form-b')::uuid, 'B'||i, (date '2025-11-01' + ((i % 12) * interval '1 month'))::date, 'MG01', 'MG010101', 'T'||(1+i%100), 'kobo',
            jsonb_build_object('q1', 'Oui', 'q31', 7)
       FROM generate_series(1,1000) i`, 'B'],
  ['visites', `INSERT INTO site_visits (tenant_id, site_id, period_month, activity, provider_id, status)
     SELECT $1, md5('s'||(1 + abs(hashtext('v'||i||'s')) % 3000))::uuid, (date '2023-11-01' + (((i*7) % 36) * interval '1 month'))::date,
            CASE WHEN i % 5 < 2 THEN (${ACTIVITIES})[1 + i % 4] END,
            CASE WHEN i % 10 = 0 THEN NULL ELSE md5('p'||(1 + i % 8))::uuid END,
            CASE WHEN abs(hashtext('v'||i)) % 100 < 70 THEN 'realise' WHEN abs(hashtext('v'||i)) % 100 < 95 THEN 'planifie' ELSE 'annule' END
       FROM generate_series(1,10000) i
     ON CONFLICT DO NOTHING`],
  // Doublons site × mois (activité vide, non unique) : une visite = site × mois, comptée une fois.
  ['visites (doublons)', `INSERT INTO site_visits (tenant_id, site_id, period_month, activity, provider_id, status)
     SELECT tenant_id, site_id, period_month, NULL, provider_id, CASE status WHEN 'realise' THEN 'planifie' ELSE 'realise' END
       FROM site_visits WHERE tenant_id = $1 AND activity IS NULL ORDER BY site_id, period_month LIMIT 200`],
  ['visites (tenant B)', `INSERT INTO site_visits (tenant_id, site_id, period_month, status)
     SELECT $1, md5('s2-'||(1 + i % 100))::uuid, (date '2025-11-01' + ((i % 12) * interval '1 month'))::date, 'realise'
       FROM generate_series(1,300) i ON CONFLICT DO NOTHING`, 'B'],
];

/** Charge le jeu (client superutilisateur, base de banc vide et migrée). */
async function loadBenchData(client, log = () => {}) {
  for (const [label, sql, who = 'A'] of STEPS) {
    const t0 = Date.now();
    const { rowCount } = await client.query(sql, who === 'AB' ? [T1, T2] : [who === 'B' ? T2 : T1]);
    log(`  ${label} : ${rowCount} ligne(s) en ${Date.now() - t0} ms`);
  }
  await client.query('ANALYZE');
}

module.exports = { T1, T2, FORMS, DATA_END, uid, loadBenchData };
