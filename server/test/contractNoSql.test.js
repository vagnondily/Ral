/**
 * N° AFFICHÉ d'un contrat (référence d'avenant « …-AM03 », sinon n° FLA, sinon n° interne) — un seul nom
 * pour la liste des contrats, les alertes, la carte « Rapports attendus », la Consolidation et la fiche 360°.
 * La parité du jumeau SQL avec contracts.domain.displayReference est vérifiée en base
 * (test/tpmReportsCrossDb.test.js) ; ici : le texte du fragment et ses lecteurs.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { contractReferenceSql, contractShownNoSql } = require('../src/modules/contracts/contractNoSql');
const { contractRows } = require('../src/modules/partners/partnerSheet');

const src = (f) => fs.readFileSync(path.join(__dirname, '../src/modules', f), 'utf8');

test('jumeau SQL de la référence : n° FLA + « -AMnn » (2 chiffres au moins, jamais tronqué), NULL sans n° FLA ; affiché = référence, sinon n° interne', () => {
  const ref = contractReferenceSql('c').replace(/\s+/g, ' ');
  assert.equal(ref, "(CASE WHEN NULLIF(c.numero_fla, '') IS NULL THEN NULL WHEN COALESCE(c.amendment_count, 0) > 0 THEN c.numero_fla || '-AM' || lpad(c.amendment_count::text, GREATEST(2, length(c.amendment_count::text)), '0') ELSE c.numero_fla END)");
  assert.equal(contractShownNoSql('k').replace(/\s+/g, ' '), `COALESCE(${contractReferenceSql('k').replace(/\s+/g, ' ')}, k.numero)`);
});

test('lecteurs : carte des rapports attendus (n° affiché), Consolidation et fiche 360° (référence) — plus de COALESCE(numero_fla, numero) sur la carte', () => {
  const reports = src('tpm/reports.repository.js');
  const expected = reports.slice(reports.indexOf('async function expectedReports'));
  assert.ok(!/COALESCE\((c\.)?numero_fla, (c\.)?numero\)/.test(expected), 'carte : jamais le n° FLA sans code d avenant');
  assert.match(expected, /\$\{contractShownNoSql\('c'\)\} AS "contractLabel"/, 'factures de la carte');
  assert.match(expected, /SELECT c\.id, \$\{contractShownNoSql\('c'\)\} AS label FROM contracts c/, 'lignes de la carte');
  assert.match(src('tpm/consolidation.repository.js'), /\$\{contractReferenceSql\('c'\)\} AS reference,/);
  assert.match(src('tpm/consolidation.repository.js'), /reference: refOf\.get\(r\.contractId\) \|\| null/);
  assert.match(src('partners/partners.repository.js'), /c\.numero_fla AS "numeroFla", \$\{contractReferenceSql\('c'\)\} AS reference,/);
  const [row] = contractRows([{ id: 'k', numero: 'CTR-1', numeroFla: 'FLA-1', reference: 'FLA-1-AM03', directCents: 0, monitoringCents: 0 }], [], { partnerId: 'p', month: '2026-10' });
  assert.deepEqual([row.reference, row.numeroFla, row.numero], ['FLA-1-AM03', 'FLA-1', 'CTR-1'], 'la fiche transmet la référence (web roles.contractNo la préfère)');
});

test('web : roles.contractNo d une ligne de contrat préfère la référence — la Consolidation et la fiche la montrent', async (t) => {
  const file = path.join(__dirname, '../../web/src/lib/roles.js');
  if (!fs.existsSync(file)) { t.skip('web/ absent'); return; }
  const { pathToFileURL } = require('url');
  const w = await import(pathToFileURL(file).href);
  assert.equal(w.contractNo({ id: 'k', numero: 'CTR-1', numeroFla: 'FLA-1', reference: 'FLA-1-AM03' }), 'FLA-1-AM03');
  assert.equal(w.contractNo({ id: 'k', numero: 'CTR-1', numeroFla: 'FLA-1', reference: null }), 'FLA-1');
});
