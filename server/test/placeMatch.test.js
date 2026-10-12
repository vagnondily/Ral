const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normPlace, looksLikePcode, jaroWinkler, similarity, buildPlaceIndex, resolvePlace, resolvePath, isAutomatic,
  officeResolver, buildOfficeIndex, resolveOffice, groupUnmatched,
} = require('../src/modules/common/placeMatch');

// Découpage de démonstration (extrait réaliste du sud de Madagascar).
const AREAS = [
  { id: 'r1', depth: 1, name: 'Atsimo-Andrefana', pcode: 'MG51' },
  { id: 'r2', depth: 1, name: 'Atsimo-Atsinanana', pcode: 'MG23' },
  { id: 'r3', depth: 1, name: 'Anosy', pcode: 'MG52' },
  { id: 'd1', depth: 2, name: 'Toliara I', pcode: 'MG51101', parentId: 'r1' },
  { id: 'd2', depth: 2, name: 'Toliara II', pcode: 'MG51102', parentId: 'r1' },
  { id: 'd3', depth: 2, name: 'Betioky Atsimo', pcode: 'MG51103', parentId: 'r1' },
  { id: 'd4', depth: 2, name: 'Ampanihy Ouest', pcode: 'MG51104', parentId: 'r1' },
  { id: 'd5', depth: 2, name: 'Taolagnaro', pcode: 'MG52201', parentId: 'r3' },
  { id: 'c1', depth: 3, name: 'Belalanda', pcode: 'MG51102010', parentId: 'd2' },
  { id: 'c2', depth: 3, name: 'Ankilimalinika', pcode: 'MG51102020', parentId: 'd2' },
  { id: 'c3', depth: 3, name: 'Ankilimalinika', pcode: 'MG51103020', parentId: 'd3' },
  { id: 'c4', depth: 3, name: 'Ampanihy Ouest', pcode: 'MG51507090', parentId: 'd4' },
];
const index = (aliases = []) => buildPlaceIndex({ areas: AREAS, aliases });
const byId = (id) => AREAS.find((a) => a.id === id);
const parentOf = (idx, id) => idx.byId.get(id);

test('normalisation : tirets, préfixes, articles, chiffres romains et points cardinaux', () => {
  assert.equal(normPlace('Atsimo-Andrefana').key, 'atsimo andrefana');
  assert.equal(normPlace('Atsimo Andrefana').key, 'atsimo andrefana');
  assert.equal(normPlace('Betioky Sud').key, normPlace('Betioky Atsimo').key);
  assert.equal(normPlace("CR d'Ampanihy Ouest").key, 'ampanihy andrefana');
  assert.equal(normPlace("Commune Rurale d'Ampanihy").key, 'ampanihy');
  assert.equal(normPlace('Région Anosy').key, 'anosy');
  assert.equal(normPlace('Toliara II').key, 'toliara 2');
  assert.equal(normPlace('  ÉTABLISSEMENT   Été ').key, 'etablissement ete');
  // Un préfixe seul n'est pas retiré (il ne resterait rien).
  assert.equal(normPlace('Commune').key, 'commune');
});

test('normalisation : jetons discriminants (nombres et points cardinaux, même mal orthographiés)', () => {
  assert.equal(normPlace('Toliara II').guards, '2');
  assert.equal(normPlace('Toliara I').guards, '1');
  assert.equal(normPlace('Atsimo-Atsinanana').guards, 'atsimo atsinanana');
  assert.equal(normPlace('Atsimo Antsinanana').guards, 'atsimo atsinanana');
  assert.equal(normPlace('Belalanda').guards, '');
});

test('pcode : forme reconnue, rien d\'autre', () => {
  assert.equal(looksLikePcode('MG51507090'), true);
  assert.equal(looksLikePcode(' mg51 '), true);
  assert.equal(looksLikePcode('Toliara II'), false);
  assert.equal(looksLikePcode('51507090'), false);
  assert.equal(looksLikePcode(null), false);
});

test('similarité : Jaro-Winkler, complétée par la distance d\'édition pour les lettres insérées', () => {
  assert.equal(jaroWinkler('belalanda', 'belalanda'), 1);
  assert.equal(jaroWinkler('', 'x'), 0);
  assert.ok(jaroWinkler('toliary 2', 'toliara 2') >= 0.9);
  assert.ok(jaroWinkler('antsinanana', 'atsinanana') < 0.9);
  assert.ok(similarity('antsinanana', 'atsinanana') >= 0.9);
  assert.ok(similarity('fort dauphin', 'taolagnaro') < 0.5);
});

test('résolution : pcode direct, quel que soit le libellé', () => {
  const idx = index();
  const r = resolvePlace(idx, { depth: 3, label: 'MG51507090' });
  assert.equal(r.status, 'code');
  assert.equal(r.area.id, 'c4');
  const viaColumn = resolvePlace(idx, { depth: 3, label: 'nom illisible', pcode: 'mg51102010' });
  assert.equal(viaColumn.status, 'code');
  assert.equal(viaColumn.area.id, 'c1');
  // Un pcode d'un autre niveau n'est pas pris : on retombe sur le libellé.
  assert.equal(resolvePlace(idx, { depth: 3, label: 'MG51102' }).status, 'introuvable');
});

test('résolution : graphie identique → exact ; variante → normalise', () => {
  const idx = index();
  // Une région n'a pas de parent : elle est cherchée parmi les unités racines.
  assert.equal(resolvePlace(idx, { depth: 1, label: 'Atsimo-Andrefana' }).status, 'exact');
  assert.equal(resolvePlace(idx, { depth: 1, label: 'Region Atsimo Andrefana' }).status, 'normalise');
  const r1 = parentOf(idx, 'r1');
  const exact = resolvePlace(idx, { depth: 2, label: 'Toliara II', parent: r1 });
  assert.deepEqual([exact.status, exact.area.id], ['exact', 'd2']);
  const variant = resolvePlace(idx, { depth: 2, label: 'Betioky Sud', parent: r1 });
  assert.deepEqual([variant.status, variant.area.id], ['normalise', 'd3']);
});

test('résolution : « Toliary-II » est proposé (à valider), jamais appliqué seul', () => {
  const idx = index();
  const r = resolvePlace(idx, { depth: 2, label: 'Toliary-II', parent: parentOf(idx, 'r1') });
  assert.equal(r.status, 'a_valider');
  assert.equal(r.area, null);
  assert.deepEqual(r.candidates.map((c) => c.area.id), ['d2']);
  assert.equal(isAutomatic(r.status), false);
});

test('résolution : « Toliara III » ne propose jamais Toliara I ni II (numéral différent)', () => {
  const idx = index();
  const r = resolvePlace(idx, { depth: 2, label: 'Toliara III', parent: parentOf(idx, 'r1') });
  assert.equal(r.status, 'introuvable');
  assert.deepEqual(r.candidates, []);
  // Même sans Toliara I au référentiel, « Toliara I » ne tombe pas sur Toliara II.
  const onlyII = buildPlaceIndex({ areas: AREAS.filter((a) => a.id !== 'd1') });
  assert.equal(resolvePlace(onlyII, { depth: 2, label: 'Toliara I', parent: onlyII.byId.get('r1') }).status, 'introuvable');
});

test('résolution : « Atsimo Antsinanana » → Atsimo-Atsinanana à valider', () => {
  const idx = index();
  const r = resolvePlace(idx, { depth: 1, label: 'Atsimo Antsinanana' });
  assert.equal(r.status, 'a_valider');
  assert.equal(r.candidates[0].area.id, 'r2');
  assert.ok(r.candidates[0].score >= 0.9);
});

test('résolution : « Fort Dauphin » introuvable sans alias, résolu avec', () => {
  const anosy = (idx) => parentOf(idx, 'r3');
  const none = index();
  assert.equal(resolvePlace(none, { depth: 2, label: 'Fort Dauphin', parent: anosy(none) }).status, 'introuvable');
  const withAlias = index([{ depth: 2, parentKey: 'MG52', aliasKey: 'fort dauphin', targetPcode: 'MG52201' }]);
  const r = resolvePlace(withAlias, { depth: 2, label: 'Fort-Dauphin', parent: anosy(withAlias) });
  assert.deepEqual([r.status, r.area.id], ['alias', 'd5']);
  // Alias appris sur tout le niveau : valable aussi sans parent connu.
  const levelAlias = index([{ depth: 2, parentKey: '', aliasKey: 'fort dauphin', targetId: 'd5' }]);
  assert.equal(resolvePlace(levelAlias, { depth: 2, label: 'Fort Dauphin' }).status, 'alias');
});

test('résolution : le nom exact dans le parent passe avant un alias, l\'alias du parent avant celui du niveau', () => {
  const idx = index([
    { depth: 2, parentKey: 'MG51', aliasKey: 'toliara 2', targetPcode: 'MG51101' },
    { depth: 2, parentKey: 'MG51', aliasKey: 'tulear', targetPcode: 'MG51101' },
    { depth: 2, parentKey: '', aliasKey: 'tulear', targetPcode: 'MG51102' },
  ]);
  const r1 = parentOf(idx, 'r1');
  assert.equal(resolvePlace(idx, { depth: 2, label: 'Toliara II', parent: r1 }).area.id, 'd2');
  assert.equal(resolvePlace(idx, { depth: 2, label: 'Tuléar', parent: r1 }).area.id, 'd1');
  assert.equal(resolvePlace(idx, { depth: 2, label: 'Tulear' }).area.id, 'd2');
});

test('résolution : un alias qui pointe hors du parent est ignoré', () => {
  const idx = index([{ depth: 2, parentKey: '', aliasKey: 'fort dauphin', targetPcode: 'MG52201' }]);
  const r = resolvePlace(idx, { depth: 2, label: 'Fort Dauphin', parent: parentOf(idx, 'r1') });
  assert.equal(r.status, 'introuvable');
});

test('résolution : homonymes sans parent → ambigu ; avec parent → résolu', () => {
  const idx = index();
  const amb = resolvePlace(idx, { depth: 3, label: 'Ankilimalinika' });
  assert.equal(amb.status, 'ambigu');
  assert.deepEqual(amb.candidates.map((c) => c.area.id).sort(), ['c2', 'c3']);
  const ok = resolvePlace(idx, { depth: 3, label: 'Ankilimalinika', parent: parentOf(idx, 'd3') });
  assert.deepEqual([ok.status, ok.area.id], ['exact', 'c3']);
});

test('résolution : libellé vide → vide (jamais une erreur)', () => {
  const idx = index();
  assert.equal(resolvePlace(idx, { depth: 2, label: '   ' }).status, 'vide');
  assert.equal(resolvePlace(idx, { depth: 2, label: null }).status, 'vide');
});

test('chemin complet : chaque niveau dans son parent, lignée des pcodes', () => {
  const idx = index();
  const p = resolvePath(idx, { adm1: 'Atsimo Andrefana', adm2: 'Toliara-II', adm3: 'Ankilimalinika' });
  assert.equal(p.status, 'resolu');
  assert.equal(p.finest.id, 'c2');
  assert.deepEqual(p.pcodes, { adm1: 'MG51', adm2: 'MG51102', adm3: 'MG51102020' });
  assert.deepEqual(p.levels.map((l) => l.status), ['normalise', 'normalise', 'exact', 'vide']);
});

test('chemin : une commune seule, unique, remonte district et région', () => {
  const p = resolvePath(index(), { adm3: 'Belalanda' });
  assert.equal(p.status, 'resolu');
  assert.deepEqual(p.pcodes, { adm1: 'MG51', adm2: 'MG51102', adm3: 'MG51102010' });
});

test('chemin : district approché confirmé par la commune → déduit', () => {
  const p = resolvePath(index(), { adm1: 'Atsimo-Andrefana', adm2: 'Toliary II', adm3: 'Belalanda' });
  assert.equal(p.levels[1].status, 'deduit');
  assert.equal(p.levels[1].area.id, 'd2');
  assert.equal(p.status, 'resolu');
  assert.equal(p.finest.id, 'c1');
});

test('chemin : district inconnu → commune cherchée sous la région, le district reste à rapprocher', () => {
  const p = resolvePath(index(), { adm1: 'Atsimo-Andrefana', adm2: 'District inconnu', adm3: 'Belalanda' });
  assert.equal(p.levels[1].status, 'introuvable');
  assert.equal(p.finest.id, 'c1');
  assert.equal(p.status, 'introuvable');
});

test('chemin : la région borne la recherche (pas de commune d\'une autre région)', () => {
  const p = resolvePath(index(), { adm1: 'Anosy', adm3: 'Belalanda' });
  assert.equal(p.levels[2].status, 'introuvable');
  assert.equal(p.finest.id, 'r3');
});

test('chemin : district contradictoire avec la commune → la commune va dans la file', () => {
  const p = resolvePath(index(), { adm1: 'Atsimo-Andrefana', adm2: 'Toliara I', adm3: 'Belalanda' });
  assert.equal(p.levels[1].status, 'exact');
  assert.equal(p.levels[2].status, 'introuvable');
  assert.equal(p.status, 'introuvable');
});

test('chemin : rien de renseigné → vide', () => {
  const p = resolvePath(index(), {});
  assert.equal(p.status, 'vide');
  assert.equal(p.finest, null);
});

const OFFICES = [
  { id: 'o1', code: 'AMP', name: 'Bureau Ampanihy', communes: ['MG51507090', 'MG51102010'] },
  { id: 'o2', code: 'AMPO', name: 'Bureau Ampanihy Ouest', communes: ['MG51507090'] },
  { id: 'o3', code: 'TLR', name: 'Bureau Toliara', communes: ['MG51102010', 'MG51102020'] },
  { id: 'o4', code: 'OLD', name: 'Antenne Betioky', active: false, communes: ['MG51103020'] },
];

test('bureaux : code, nom, nom « cœur » contenu dans le libellé ; le plus long gagne', () => {
  const find = officeResolver(OFFICES);
  assert.equal(find('RBJ Madagascar, Ampanihy Sub Office').id, 'o1');
  assert.equal(find('amp').id, 'o1');
  assert.equal(find('Sous-bureau Ampanihy Ouest').id, 'o2');
  assert.equal(find('Bureau de Toliara').id, 'o3');
  assert.equal(find('Antenne Betioky'), null); // bureau inactif
  assert.equal(find(''), null);
});

test('bureaux : sinon la commune dans les périmètres, le plus spécifique d\'abord', () => {
  const idx = buildOfficeIndex(OFFICES);
  assert.deepEqual(resolveOffice(idx, { label: 'Toliara' }).office.id, 'o3');
  const specific = resolveOffice(idx, { label: 'XYZ', commune: 'MG51507090' });
  assert.deepEqual([specific.status, specific.office.id], ['perimetre', 'o2']);
  const tie = resolveOffice(idx, { commune: 'mg51102010' });
  assert.equal(tie.status, 'ambigu');
  assert.deepEqual(tie.candidates.map((o) => o.id).sort(), ['o1', 'o3']);
  assert.equal(resolveOffice(idx, { commune: 'MG51103020' }).status, 'vide'); // seul bureau inactif
  assert.equal(resolveOffice(idx, { label: 'Inconnu' }).status, 'introuvable');
});

test('file « À rapprocher » : regroupement par niveau, parent et graphie normalisée', () => {
  const idx = index();
  const r1 = parentOf(idx, 'r1');
  const items = [
    { depth: 2, parent: r1, label: 'Toliary II', ...resolvePlace(idx, { depth: 2, label: 'Toliary II', parent: r1 }), count: 3 },
    { depth: 2, parent: r1, label: 'Toliary-II', ...resolvePlace(idx, { depth: 2, label: 'Toliary-II', parent: r1 }), count: 2 },
    { depth: 2, parent: r1, label: 'Inconnu', status: 'introuvable', candidates: [] },
    { depth: 2, parent: r1, label: 'Toliara II', status: 'exact', area: byId('d2'), candidates: [] },
    { depth: 3, label: '', status: 'vide', candidates: [] },
  ];
  const queue = groupUnmatched(items);
  assert.equal(queue.length, 2);
  assert.deepEqual(queue[0], {
    kind: 'zone', depth: 2, parentKey: 'MG51', parentLabel: 'Atsimo-Andrefana', rawKey: 'toliary 2', rawLabel: 'Toliary II',
    count: 5, status: 'a_valider', candidates: [{ pcode: 'MG51102', name: 'Toliara II', id: 'd2', score: queue[0].candidates[0].score }],
  });
  assert.equal(queue[1].rawKey, 'inconnu');
  assert.equal(queue[1].count, 1);
});

test('chemin : un niveau absent du découpage n\'est ni résolu ni mis en file', () => {
  const twoLevels = buildPlaceIndex({ areas: AREAS.filter((a) => a.depth <= 2) });
  const p = resolvePath(twoLevels, { adm1: 'Atsimo-Andrefana', adm2: 'Toliara II', adm3: 'Belalanda' });
  assert.equal(p.levels[2].status, 'hors_niveau');
  assert.equal(p.status, 'resolu');
  assert.equal(p.finest.id, 'd2');
  assert.deepEqual(groupUnmatched([{ depth: 3, label: 'Belalanda', status: 'hors_niveau', candidates: [] }]), []);
});

test('résolution : graphie tronquée → propositions à valider, jamais un numéro différent', () => {
  const idx = index();
  const r = resolvePlace(idx, { depth: 2, label: 'Betioky', parent: parentOf(idx, 'r1') });
  assert.equal(r.status, 'a_valider');
  assert.deepEqual(r.candidates.map((c) => c.area.id), ['d3']);
  assert.equal(r.candidates[0].partial, true);
  // « Toliara » seul : I et II portent un numéro → aucune proposition automatique.
  assert.equal(resolvePlace(idx, { depth: 2, label: 'Toliara', parent: parentOf(idx, 'r1') }).status, 'introuvable');
});

test('alias : unité recréée au réimport (nouvel identifiant, sans code) → retrouvée par son chemin', () => {
  const areas = AREAS.map((a) => (a.id === 'd5' ? { ...a, id: 'd5-bis', pcode: null, path: 'Anosy > Taolagnaro' } : { ...a, path: a.path || a.name }));
  const idx = buildPlaceIndex({ areas, aliases: [{ depth: 2, parentKey: 'MG52', aliasKey: 'fort dauphin', targetId: 'd5', targetPath: 'Anosy > Taolagnaro' }] });
  const r = resolvePlace(idx, { depth: 2, label: 'Fort Dauphin', parent: idx.byId.get('r3') });
  assert.deepEqual([r.status, r.area && r.area.id], ['alias', 'd5-bis']);
});

test('bureaux : « Tulear » (étiquette d\'export) = Bureau Toliara, sans toucher au découpage', () => {
  const byLabel = officeResolver([{ id: 'o1', code: 'TLR', name: 'Bureau Toliara' }, { id: 'o2', code: 'FD', name: 'Bureau Fort Dauphin' }]);
  assert.equal(byLabel('Tulear').id, 'o1');
  assert.equal(byLabel('Tuléar').id, 'o1');
  assert.equal(byLabel('Fort Dauphin').id, 'o2');
  assert.equal(byLabel('Tolagnaro').id, 'o2');
  assert.notEqual(normPlace('Tuléar').key, normPlace('Toliara').key); // découpage : graphie à valider
});
