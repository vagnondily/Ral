/**
 * Calculs longs écrits une fois (générateurs) et exécutés d'une traite ou en rendant la main
 * (common/yielding) : MÊME résultat, et la boucle d'événements tourne entre deux paquets. Appliqué
 * à la préparation de l'import (prepareImportAsync) et à l'index des lieux (buildPlaceIndexAsync).
 */
process.env.LOG_LEVEL = 'silent';
const test = require('node:test');
const assert = require('node:assert/strict');
const { runSync, runYielding, isPause } = require('../src/modules/common/yielding');
const { prepareImport, prepareImportAsync, parseSubmissions } = require('../src/modules/monitoring/submissionsImport');
const { buildPlaceIndex, buildPlaceIndexAsync, resolvePath } = require('../src/modules/common/placeMatch');

function* sumSteps(xs, chunk = Infinity) {
  let total = 0; let n = 0;
  for (const x of xs) { total += x; n += 1; if (isPause(n, chunk)) yield n; }
  return total;
}

test('même résultat d\'une traite ou en rendant la main ; la boucle tourne entre deux paquets', async () => {
  const xs = Array.from({ length: 1000 }, (_, i) => i);
  assert.equal(runSync(sumSteps(xs)), 499500);
  let ticks = 0;
  const iv = setInterval(() => { ticks += 1; }, 0);
  const seen = [];
  setImmediate(() => seen.push('autre travail'));
  const total = await runYielding(sumSteps(xs, 100));
  clearInterval(iv);
  assert.equal(total, 499500);
  assert.deepEqual(seen, ['autre travail'], 'un autre travail passe pendant le calcul');
  assert.equal(isPause(100, 100), true);
  assert.equal(isPause(99, 100), false);
  assert.equal(isPause(5, Infinity), false);
  assert.equal(isPause(5, 0), false);
});

test('préparation de l\'import : prepareImportAsync = prepareImport (doublons, catalogue, colonnes choisies, dates)', async () => {
  const lines = ['_uuid,grp/SvyDate,grp/Bureau,grp/Site,_submission_time'];
  for (let i = 0; i < 1203; i += 1) {
    const id = `u${i % 1100}`; // 103 doublons : dernière version gardée
    const day = String((i % 27) + 1).padStart(2, '0');
    lines.push(`${id},2026-0${(i % 9) + 1}-${day},Bureau ${i % 7},Site ${i},2026-10-0${(i % 9) + 1}T08:00:00`);
  }
  const csv = Buffer.from(`${lines.join('\n')}\n`);
  const ctx = {
    catalogNames: ['SvyDate', 'Bureau', 'Site'],
    overrides: [{ dimension: 'field_office', columnName: 'Bureau' }, { dimension: 'survey_date', columnName: 'SvyDate' }, { dimension: 'site', columnName: 'Absente' }],
    headers: ['_uuid', 'grp/SvyDate', 'grp/Bureau', 'grp/Site', '_submission_time'],
  };
  const a = prepareImport((await parseSubmissions(csv)).submissions, ctx);
  const b = await prepareImportAsync((await parseSubmissions(csv)).submissions, ctx, { chunk: 50 });
  assert.equal(a.unique.length, 1100);
  assert.equal(a.duplicates, 103);
  assert.deepEqual(b.unique, a.unique);
  assert.equal(b.duplicates, a.duplicates);
  assert.deepEqual([...b.missing], [...a.missing]);
  assert.deepEqual([...a.missing], [['site', 'Absente']]);
  // u0 apparaît aux lignes 0 et 1100 : la dernière version est gardée, clés ramenées au catalogue.
  assert.equal(a.unique[0].data.Bureau, `Bureau ${1100 % 7}`);
  assert.equal(a.unique[0].fieldOffice, `Bureau ${1100 % 7}`, 'colonne choisie dans « Mapping MEMS » appliquée');
});

test('index des lieux : buildPlaceIndexAsync = buildPlaceIndex (mêmes entrées, même ordre, mêmes résolutions)', async () => {
  const areas = [];
  for (let r = 0; r < 4; r += 1) {
    areas.push({ id: `r${r}`, depth: 1, name: `Région ${['Atsimo-Andrefana', 'Anosy', 'Androy', 'Ihorombe'][r]}`, pcode: `MG${50 + r}`, path: `Région ${r}` });
    for (let d = 0; d < 6; d += 1) {
      areas.push({ id: `d${r}-${d}`, depth: 2, name: `District ${d} Sud`, pcode: `MG${50 + r}${d}`, parentId: `r${r}`, path: `Région ${r} > District ${d} Sud` });
      for (let c = 0; c < 40; c += 1) {
        areas.push({ id: `c${r}-${d}-${c}`, depth: 3, name: `Commune ${c % 25}`, pcode: `MG${50 + r}${d}${String(c).padStart(3, '0')}`, parentId: `d${r}-${d}`, path: `Région ${r} > District ${d} Sud > Commune ${c % 25}` });
      }
    }
  }
  const aliases = [{ depth: 3, parentKey: 'MG500', aliasKey: 'commune zero', targetId: 'c0-0-0', targetPath: 'Région 0 > District 0 Sud > Commune 0' }];
  const a = buildPlaceIndex({ areas, aliases });
  const b = await buildPlaceIndexAsync({ areas, aliases }, { chunk: 37 });
  const flat = (idx) => JSON.stringify({
    byId: [...idx.byId], byPcode: [...idx.byPcode].map(([k, v]) => [k, v.id]), byPath: [...idx.byPath].map(([k, v]) => [k, v.id]),
    inParent: [...idx.inParent].map(([k, m]) => [k, [...m].map(([kk, list]) => [kk, list.map((x) => x.id)])]),
    inLevel: [...idx.inLevel].map(([k, m]) => [k, [...m].map(([kk, list]) => [kk, list.map((x) => x.id)])]),
    aliasMap: [...idx.aliasMap], synonyms: idx.synonyms,
  });
  assert.equal(flat(b), flat(a));
  assert.equal(a.byId.size, areas.length);
  const q = { adm1: 'Atsimo Andrefana', adm2: 'District 3 Atsimo', adm3: 'Commune 7' };
  assert.deepEqual(resolvePath(b, q), resolvePath(a, q));
});
