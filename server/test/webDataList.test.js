const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

// Tri des listes (web/src/lib/dataList.js) : exactement l'ordre de l'ancien tri de DataList
// (localeCompare à chaque comparaison, clé recalculée à chaque fois), en plus rapide.
const file = path.join(__dirname, '../../web/src/lib/dataList.js');
const load = async (t) => {
  if (!fs.existsSync(file)) { t.skip('web/ absent'); return null; }
  return import(pathToFileURL(file).href);
};

// L'ancien tri, mot pour mot.
function oldSort(list, sv, dir) {
  return [...list].sort((a, b) => {
    const va = sv(a); const vb = sv(b);
    const cmp = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va ?? '').localeCompare(String(vb ?? ''));
    return dir === 'asc' ? cmp : -cmp;
  });
}

// Générateur déterministe.
function rng(seed) { let s = seed; return () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; }; }

test('tri des listes : même ordre que l\'ancien tri (textes accentués, nombres, vides, égalités, deux sens)', async (t) => {
  const v = await load(t); if (!v) return;
  const r = rng(42);
  const words = ['Ambovombe', 'ambovombe', 'Éfaté', 'Efate', 'Zébu', 'zebu', 'Ampanihy', 'Bekily', '', null, undefined, 'Tsihombe', 'tsihombe', '10', '9', 'Ihosy'];
  const rows = Array.from({ length: 600 }, (_, i) => ({
    id: i, name: words[Math.floor(r() * words.length)], score: Math.floor(r() * 4),
    mixed: r() < 0.3 ? null : (r() < 0.5 ? Math.floor(r() * 5) : String(Math.floor(r() * 5))),
  }));
  for (const key of ['name', 'score', 'mixed']) {
    for (const dir of ['asc', 'desc']) {
      const sv = (x) => x[key];
      assert.deepEqual(v.sortRows(rows, sv, dir).map((x) => x.id), oldSort(rows, sv, dir).map((x) => x.id), `${key} ${dir}`);
    }
  }
});

test('tri des listes : la clé de tri est lue une fois par ligne ; la liste d\'origine reste intacte', async (t) => {
  const v = await load(t); if (!v) return;
  const rows = Array.from({ length: 200 }, (_, i) => ({ id: i, k: (i * 37) % 11 }));
  const before = rows.map((x) => x.id);
  let calls = 0;
  const out = v.sortRows(rows, (x) => { calls += 1; return x.k; }, 'desc');
  assert.equal(calls, rows.length);
  assert.deepEqual(rows.map((x) => x.id), before);
  assert.equal(out.length, rows.length);
  assert.equal(v.compareValues(2, 10) < 0, true);
  assert.equal(v.compareValues('2', '10') > 0, true); // textes : ordre alphabétique, comme avant
  assert.equal(v.compareValues(null, ''), 0);
});
