const test = require('node:test');
const assert = require('node:assert/strict');
const { parseSubmissions, submissionsFromObjects } = require('../src/modules/monitoring/submissionsImport');

test('parses a CSV, lifting known Kobo columns and keeping raw answers', async () => {
  const csv = [
    '_uuid,SvyDate,field_office,ADMIN1Name,ADMIN4Name,EnuPartner,EnuName,CFM_used',
    'u1,2026-05-03,Ambovombe,Androy,EPP Ankilibe,ONG Lalana,Rakoto,yes',
    'u2,2026-05-04,Ambovombe,Androy,EPP Be,ONG Lalana,Rasoa,no',
  ].join('\n');
  const { submissions } = await parseSubmissions(Buffer.from(csv, 'utf8'), { filename: 'x.csv' });
  assert.equal(submissions.length, 2);
  assert.equal(submissions[0].externalId, 'u1');
  assert.equal(submissions[0].periodMonth, '2026-05-01');
  assert.equal(submissions[0].fieldOffice, 'Ambovombe');
  assert.equal(submissions[0].partner, 'ONG Lalana');
  assert.equal(submissions[0].agent, 'Rakoto');
  assert.equal(submissions[0].data.CFM_used, 'yes'); // raw answer kept for the mapping
});

test('detects a semicolon-delimited CSV', async () => {
  const csv = '_uuid;field_office;q1\nu9;Tulear;A';
  const { submissions } = await parseSubmissions(Buffer.from(csv, 'utf8'), { filename: 'x.csv' });
  assert.equal(submissions.length, 1);
  assert.equal(submissions[0].fieldOffice, 'Tulear');
  assert.equal(submissions[0].data.q1, 'A');
});

test('normalizes Kobo JSON objects, flattening group-prefixed keys', () => {
  const rows = [
    { _uuid: 'k1', _submission_time: '2026-05-10T08:00:00', 'grp/field_office': 'Manakara', 'grp/CFM_used': 'oui' },
  ];
  const subs = submissionsFromObjects(rows, 'kobo');
  assert.equal(subs.length, 1);
  assert.equal(subs[0].externalId, 'k1');
  assert.equal(subs[0].periodMonth, '2026-05-01');
  assert.equal(subs[0].fieldOffice, 'Manakara');
  assert.equal(subs[0].data.CFM_used, 'oui');
});

const { buildLookup } = require('../src/modules/monitoring/submissionsImport');

test('import : le code de commune passe avant son nom, quel que soit l\'ordre des colonnes', () => {
  const headers = ['admin3name', 'admin3', 'admin1name', 'admin1'];
  const rows = [['Ampanihy Ouest', 'MG51507090', 'Atsimo Andrefana', 'MG51'], ['Ejeda', 'MG51507050', 'Atsimo Andrefana', 'MG51']];
  const picks = buildLookup(headers, rows);
  assert.equal(headers[picks.admin3], 'admin3');
  assert.equal(headers[picks.admin1], 'admin1');
});

test('import : une colonne « admin3 » qui contient des noms cède la place à la colonne de codes', () => {
  const headers = ['admin3', 'admin3_pcode'];
  const rows = [['Ampanihy Ouest', 'MG51507090'], ['Ejeda', 'MG51507050']];
  assert.equal(headers[buildLookup(headers, rows).admin3], 'admin3_pcode');
});

test('import : en-têtes accentués reconnus (Niveau régional, Énumérateur)', () => {
  const headers = ['Niveau régional', 'Énumérateur', 'District'];
  const picks = buildLookup(headers, [['MG51', 'Rasoa', 'MG51507']]);
  assert.equal(headers[picks.admin1], 'Niveau régional');
  assert.equal(headers[picks.agent], 'Énumérateur');
  assert.equal(headers[picks.admin2], 'District');
});
