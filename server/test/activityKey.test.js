/**
 * Clé normalisée des activités de programme (migration 105, SPEC_PROGRAMMES § 13) : la jumelle JS
 * `activityKey` donne EXACTEMENT la valeur de `mems_activity_key` en SQL.
 *
 * 1. Les constantes (tables d'accents, motif) sont lues dans le fichier SQL lui-même :
 *    une modification d'un côté seulement casse le test.
 * 2. Un émulateur construit À PARTIR DU TEXTE SQL (translate → lower → regexp_replace)
 *    est comparé à activityKey sur 200 libellés (accents, casse, espaces, ponctuation…).
 * 3. Si MEMS_TEST_DATABASE_URL est fourni (base migrée jusqu'à 105), les 200 libellés
 *    passent aussi par la vraie fonction PostgreSQL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  ACCENTS_FROM, ACCENTS_TO, CODE_RE, activityKey, aliasKeyOf, cleanLabel, codeFromLabel, uniqueCode,
} = require('../src/modules/programmes/activityKey');

const sql = fs.readFileSync(path.join(__dirname, '../src/db/migrations/105_programme_activities.sql'), 'utf8');
const fnBody = sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION mems_activity_key'), sql.indexOf('$$;'));

/** Les deux chaînes du translate de la fonction SQL. */
function sqlTranslatePairs(text) {
  const m = text.match(/translate\(coalesce\(s, ''\),\s*'([^']+)',\s*'([^']+)'\)/);
  assert.ok(m, 'translate(coalesce(s, \'\'), …) introuvable dans mems_activity_key');
  return [m[1], m[2]];
}

/** Émulateur de mems_activity_key construit depuis le texte SQL. */
function sqlEmulator(text) {
  const [from, to] = sqlTranslatePairs(text);
  const re = text.match(/'\[\^a-z0-9\]\+', '', 'g'\)/) ? /[^a-z0-9]+/g : null;
  assert.ok(re, 'regexp_replace(…, \'[^a-z0-9]+\', \'\', \'g\') introuvable');
  assert.ok(/regexp_replace\(lower\(translate\(/.test(text), 'ordre translate → lower → regexp_replace');
  const map = new Map([...from].map((c, i) => [c, [...to][i]]));
  return (s) => [...(s == null ? '' : String(s))].map((c) => (map.has(c) ? map.get(c) : c)).join('').toLowerCase().replace(re, '');
}

// 200 libellés : graphies réelles (MMR, Activity_tag, PDD) et cas limites.
const BASE = [
  'School meal activities', 'Nutrition treatment activities', 'Malnutrition prevention activities',
  'Unconditional resource transfers to support access to food', 'GD drought', 'GFD Cyclone', 'SMP', 'PECMAM',
  'Distribution générale', 'Transferts de ressources inconditionnels', 'Cantine scolaire', 'Prévention MAM',
  'Création d’actifs (FFA)', 'Résilience — SAMS v2.1', 'Repas scolaires à l’école', 'Éducation nutritionnelle',
  'ÎLES & CÔTES', 'Ñandú', 'Ÿ ŒUVRE Æ ß', 'Kelvin K', 'İstanbul', 'été (NFD)', '  espaces   multiples  ',
  'Tab\tet\nretour', 'emoji 🍲 repas', '—', '', '123', 'PREV-MAM', 'prev mam', 'Prev_Mam', 'MAM/PECMAM', 'a.b.c',
  'Ç’est ça', 'Ûn Ùn Ün Ún', 'ÀÁÂÃÄÅ àáâãäå', 'ÈÉÊË èéêë', 'ÌÍÎÏ ìíîï', 'ÒÓÔÕÖ òóôõö', 'Ý ý ÿ', 'Øresund', 'Ð þ',
];
const VARIANTS = [
  (s) => s, (s) => s.toUpperCase(), (s) => s.toLowerCase(), (s) => ` ${s} `, (s) => s.replace(/ /g, '-'),
];
const LABELS = [];
for (const v of VARIANTS) for (const b of BASE) if (LABELS.length < 200) LABELS.push(v(b));
while (LABELS.length < 200) LABELS.push(`Activité n° ${LABELS.length}`);

test('constantes JS = constantes du fichier SQL (mems_activity_key et reprise)', () => {
  const [from, to] = sqlTranslatePairs(fnBody);
  assert.equal(from, ACCENTS_FROM);
  assert.equal(to, ACCENTS_TO);
  assert.equal([...ACCENTS_FROM].length, [...ACCENTS_TO].length);
  // La reprise (codes) utilise les mêmes tables d'accents et le même motif de code.
  const reprise = sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION mems_programme_activity_reprise'));
  assert.ok(reprise.includes(`'${ACCENTS_FROM}',\n      '${ACCENTS_TO}'`), 'tables d\'accents de la reprise');
  assert.ok(sql.includes(`code ~ '${CODE_RE.source}'`), 'CHECK du code = CODE_RE');
  assert.match(sql, /mems_activity_key\(s text\) RETURNS text LANGUAGE sql IMMUTABLE/);
});

test('parité JS / SQL (émulateur tiré du texte SQL) sur 200 libellés', () => {
  const emulate = sqlEmulator(fnBody);
  assert.equal(LABELS.length, 200);
  for (const l of LABELS) assert.equal(activityKey(l), emulate(l), JSON.stringify(l));
});

// Étapes du code proposé par la reprise SQL, dans l'ordre (vérifiées dans le texte, rejouées en base).
const CODE_STEPS = [
  "v_base := regexp_replace(v_base, '[^A-Z0-9._-]+', '-', 'g');",
  "v_base := regexp_replace(v_base, '-{2,}', '-', 'g');",
  "v_base := regexp_replace(v_base, '^[^A-Z0-9]+', '');",
  "v_base := regexp_replace(left(v_base, 30), '[._-]+$', '');",
];

test('reprise SQL : étapes du code identiques à codeFromLabel (texte)', () => {
  let at = sql.indexOf('v_base := upper(translate(r.label,');
  assert.ok(at > 0, 'upper(translate(…)) en premier');
  for (const step of CODE_STEPS) {
    const i = sql.indexOf(step, at);
    assert.ok(i > at, `étape absente ou déplacée : ${step}`);
    at = i;
  }
  assert.ok(sql.indexOf("IF v_base = '' THEN v_base := 'ACT'; END IF;", at) > at);
});

test('parité JS / SQL dans une vraie base (MEMS_TEST_DATABASE_URL)', async (t) => {
  const url = process.env.MEMS_TEST_DATABASE_URL;
  if (!url) { t.skip('MEMS_TEST_DATABASE_URL absent'); return; }
  const { Client } = require('pg');
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    const { rows } = await client.query('SELECT x, mems_activity_key(x) AS k FROM unnest($1::text[]) AS x', [LABELS]);
    assert.equal(rows.length, 200);
    for (const r of rows) assert.equal(activityKey(r.x), r.k, JSON.stringify(r.x));
    // Code proposé : les mêmes étapes que la reprise, rejouées par PostgreSQL.
    const { rows: codes } = await client.query(
      `SELECT x, COALESCE(NULLIF(regexp_replace(left(regexp_replace(regexp_replace(regexp_replace(
                upper(translate(x, $2, $3)), '[^A-Z0-9._-]+', '-', 'g'), '-{2,}', '-', 'g'), '^[^A-Z0-9]+', ''), 30),
                '[._-]+$', ''), ''), 'ACT') AS c
         FROM unnest($1::text[]) AS x`, [LABELS, ACCENTS_FROM, ACCENTS_TO]);
    for (const r of codes) assert.equal(codeFromLabel(r.x), r.c, JSON.stringify(r.x));
  } finally { await client.end(); }
});

test('activityKey : accents, casse, espaces et ponctuation ne comptent pas', () => {
  assert.equal(activityKey('Distribution générale'), 'distributiongenerale');
  assert.equal(activityKey('DISTRIBUTION-GÉNÉRALE'), 'distributiongenerale');
  assert.equal(activityKey('  distribution   generale '), 'distributiongenerale');
  assert.equal(activityKey('PREV-MAM'), activityKey('prev mam'));
  assert.equal(activityKey(null), '');
  assert.equal(activityKey(undefined), '');
  assert.equal(activityKey(42), '42');
});

test('aliasKeyOf : null sans lettre ni chiffre ; 160 caractères au plus', () => {
  assert.equal(aliasKeyOf('—'), null);
  assert.equal(aliasKeyOf('   '), null);
  assert.equal(aliasKeyOf('GD'), 'gd');
  assert.equal(aliasKeyOf('a'.repeat(400)).length, 160);
  assert.match(aliasKeyOf('Repas scolaires à l’école'), /^[a-z0-9]{1,160}$/);
});

test('cleanLabel : bords retirés, espaces répétés réduits', () => {
  assert.equal(cleanLabel('  cantine   scolaire '), 'cantine scolaire');
  assert.equal(cleanLabel('Tab\tet\nretour'), 'Tab et retour');
  assert.equal(cleanLabel(null), '');
});

test('codeFromLabel : code valide, majuscules sans accents, 30 caractères, « ACT » à défaut', () => {
  assert.equal(codeFromLabel('Distribution générale (GD)'), 'DISTRIBUTION-GENERALE-GD');
  assert.equal(codeFromLabel('School meal activities'), 'SCHOOL-MEAL-ACTIVITIES');
  assert.equal(codeFromLabel('Climate adaptation and risk management activities'), 'CLIMATE-ADAPTATION-AND-RISK-MA');
  assert.equal(codeFromLabel('—'), 'ACT');
  assert.equal(codeFromLabel('...Prev_MAM.'), 'PREV_MAM');
  assert.equal(codeFromLabel('Straße'), 'STRA-E'); // upper() SQL caractère par caractère
  for (const l of LABELS) assert.match(codeFromLabel(l), CODE_RE, JSON.stringify(l));
});

test('uniqueCode : suffixes -2, -3 sans dépasser 30 caractères, casse ignorée', () => {
  assert.equal(uniqueCode('GD', []), 'GD');
  assert.equal(uniqueCode('GD', ['gd']), 'GD-2');
  assert.equal(uniqueCode('GD', ['GD', 'GD-2']), 'GD-3');
  const long = 'UNCONDITIONAL-RESOURCE-TRANSFE';
  assert.equal(uniqueCode(long, [long]), 'UNCONDITIONAL-RESOURCE-TRANS-2');
  assert.match(uniqueCode(long, [long, 'UNCONDITIONAL-RESOURCE-TRANS-2']), CODE_RE);
});
