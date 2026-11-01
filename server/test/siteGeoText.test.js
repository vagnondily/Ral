/**
 * P-code de DISTRICT d'un site contre sa graphie (common/placeMatch.resolveSitePath, lu par
 * settings/placeMatch.repository.applySitesGeoTx) : un site déplacé puis corrigé ne garde jamais le code
 * de son ancien district ; un code importé avec le site reste cru quand le texte ne le contredit pas ; le
 * P-code de commune (clé des données reçues) n'est ni écarté ni réécrit.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildPlaceIndex, resolvePath, resolveSitePath } = require('../src/modules/common/placeMatch');

// Androy : découpage PARTIELLEMENT codé (comme la base de démonstration) ou entièrement codé.
const androy = ({ amba = null, tsihombe = null, communes = false } = {}) => [
  { id: 'r', depth: 1, name: 'Androy', pcode: null },
  { id: 'amb', depth: 2, name: 'Ambovombe-Androy', pcode: amba, parentId: 'r' },
  { id: 'tsi', depth: 2, name: 'Tsihombe', pcode: tsihombe, parentId: 'r' },
  { id: 'bek', depth: 2, name: 'Bekily', pcode: null, parentId: 'r' },
  { id: 'r2', depth: 1, name: 'Anosy', pcode: 'MG52' },
  { id: 'tao', depth: 2, name: 'Taolagnaro', pcode: 'MG52201', parentId: 'r2' },
  ...(communes ? [
    { id: 'c-amb', depth: 3, name: 'Ambanisarika', pcode: 'MG25101010', parentId: 'amb' },
    { id: 'c-tsi', depth: 3, name: 'Nikoly', pcode: 'MG25107020', parentId: 'tsi' },
  ] : []),
];
const site = (adm2, pcodes = {}, extra = {}) => ({ adm1: 'Androy', adm2, ...extra, pcodes });

test('site corrigé vers Tsihombe : le code de l\'ancien district (non formé « MG-T-AMBA ») est effacé, Tsihombe n\'a pas de code', () => {
  const idx = buildPlaceIndex({ areas: androy({ amba: 'MG-T-AMBA' }) });
  const p = resolveSitePath(idx, site('Tsihombe', { adm2: 'MG-T-AMBA' }));
  assert.deepEqual([p.dropped, p.finest.id, p.districtPcode], [['adm2'], 'tsi', null], 'districtPcode null : l\'appelant écrit NULL, jamais COALESCE');
  // Déplacement de l'étape 2 : le district nommé donne son code.
  assert.equal(resolveSitePath(idx, site('Ambovombe-Androy')).districtPcode, 'MG-T-AMBA');
});

test('code formé (MG25101) : avant, il gagnait la résolution contre le texte ; il est maintenant écarté', () => {
  const idx = buildPlaceIndex({ areas: androy({ amba: 'MG25101' }) });
  const q = site('Tsihombe', { adm2: 'MG25101' });
  assert.equal(resolvePath(idx, q).finest.id, 'amb', 'règle brute : le code prime (le défaut)');
  const p = resolveSitePath(idx, q);
  assert.deepEqual([p.dropped, p.finest.id, p.levels[1].status, p.districtPcode], [['adm2'], 'tsi', 'exact', null]);
});

test('découpage entièrement codé : un déplacement voulu (Tsihombe → Ambovombe-Androy) est suivi, avec le code du nouveau district', () => {
  const idx = buildPlaceIndex({ areas: androy({ amba: 'MG25101', tsihombe: 'MG25107' }) });
  const moved = resolveSitePath(idx, site('Ambovombe-Androy', { adm2: 'MG25107' }));
  assert.deepEqual([moved.dropped, moved.finest.id, moved.districtPcode], [['adm2'], 'amb', 'MG25101']);
  const back = resolveSitePath(idx, site('Tsihombe', { adm2: 'MG25101' }));
  assert.deepEqual([back.dropped, back.finest.id, back.districtPcode], [['adm2'], 'tsi', 'MG25107']);
  // Texte et code d'accord : rien d'écarté, le même code.
  const same = resolveSitePath(idx, site('Tsihombe', { adm2: 'MG25107' }));
  assert.deepEqual([same.dropped, same.finest.id, same.levels[1].status, same.districtPcode], [[], 'tsi', 'code', 'MG25107']);
});

test('P-code importé avec le site : cru quand le texte ne le contredit pas ; un code hors découpage est gardé', () => {
  const idx = buildPlaceIndex({ areas: androy({ amba: 'MG25101', tsihombe: 'MG25107' }) });
  for (const label of [null, '', 'Tsihombe Centre ville', 'Tsihombé-Nord']) {
    const p = resolveSitePath(idx, site(label, { adm2: 'MG25107' }));
    assert.deepEqual([p.dropped, p.finest && p.finest.id, p.districtPcode], [[], 'tsi', undefined], `graphie ${JSON.stringify(label)} : le code décide, rien à réécrire`);
  }
  // Code absent du découpage (autre jeu de codes) : il ne contredit rien et reste quand le district nommé n'a pas de code.
  const partial = buildPlaceIndex({ areas: androy({ amba: 'MG25101' }) });
  assert.deepEqual([resolveSitePath(partial, site('Tsihombe', { adm2: 'MG99999' })).dropped, resolveSitePath(partial, site('Tsihombe', { adm2: 'MG99999' })).districtPcode], [[], 'MG99999']);
  // … et le district nommé, codé, donne le sien (comme la lignée le faisait déjà).
  assert.equal(resolveSitePath(idx, site('Tsihombe', { adm2: 'MG99999' })).districtPcode, 'MG25107');
  // Code d'une AUTRE région que la région nommée, district illisible : écarté, la lignée (ici aucune) le remplace.
  const other = resolveSitePath(idx, site('Tsihombé-Nord', { adm2: 'MG52201' }));
  assert.deepEqual([other.dropped, other.finest.id, other.districtPcode], [['adm2'], 'r', null]);
  // Région seule (district vide), code d'un district de cette région : gardé.
  const regionOnly = resolveSitePath(idx, { adm1: 'Androy', adm2: null, pcodes: { adm2: 'MG25101' } });
  assert.deepEqual([regionOnly.dropped, regionOnly.finest.id, regionOnly.districtPcode], [[], 'amb', undefined]);
  // Sans code : la résolution de resolvePath, et le code du district nommé.
  const q = site('Bekily');
  assert.equal(resolveSitePath(idx, q).finest.id, resolvePath(idx, q).finest.id);
  assert.deepEqual([resolveSitePath(idx, q).dropped, resolveSitePath(idx, q).districtPcode], [[], null]);
});

test('code de COMMUNE : jamais écarté ni réécrit (clé des données reçues) ; le code de district suit pourtant le texte', () => {
  const idx = buildPlaceIndex({ areas: androy({ amba: 'MG25101', tsihombe: 'MG25107', communes: true }) });
  // Commune codée de Tsihombe, commune illisible : le code de commune donne la commune, comme avant.
  const ok = resolveSitePath(idx, site('Tsihombe', { adm3: 'MG25107020' }, { adm3: 'Nikoly-Bas' }));
  assert.deepEqual([ok.dropped, ok.finest.id, ok.pcodes.adm3, ok.districtPcode], [[], 'c-tsi', 'MG25107020', 'MG25107']);
  // Code de commune d'un AUTRE district de la même région (code d'une autre source qui y tombe) : la résolution
  // reste celle d'avant (le code de commune), mais le code de district suit le texte — il ne fait jamais voter
  // la graphie « tsihombe » pour Ambovombe-Androy.
  const clash = resolveSitePath(idx, site('Tsihombe', { adm3: 'MG25101010' }, { adm3: 'Nikoly' }));
  assert.deepEqual([clash.dropped, clash.finest.id, clash.pcodes.adm2, clash.districtPcode], [[], 'c-amb', 'MG25101', 'MG25107']);
});
