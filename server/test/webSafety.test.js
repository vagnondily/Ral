const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

// Helpers de sécurité du front (web/src/lib/*.js, modules ES purs) testés ici :
// le front n'a pas encore de suite de tests propre.
const webLib = (name) => path.join(__dirname, '../../web/src/lib', name);

test('escapeHtml (popups de carte) : aucune donnée interprétée comme du HTML', async (t) => {
  const file = webLib('html.js');
  if (!fs.existsSync(file)) { t.skip('web/ absent'); return; }
  const { escapeHtml } = await import(pathToFileURL(file).href);
  assert.equal(escapeHtml('<img src=x onerror=alert(1)>'), '&lt;img src=x onerror=alert(1)&gt;');
  assert.equal(escapeHtml('École "A" & l\'annexe'), 'École &quot;A&quot; &amp; l&#39;annexe');
  assert.equal(escapeHtml('<script>x</script>').includes('<'), false);
  assert.equal(escapeHtml(null), '');
  assert.equal(escapeHtml(undefined), '');
  assert.equal(escapeHtml(42), '42');
  assert.equal(escapeHtml('Ambovombe › Site 3'), 'Ambovombe › Site 3');
});

test('popups de la carte des sites : chaque donnée passe par escapeHtml', () => {
  const file = path.join(__dirname, '../../web/src/pages/monitoring/SitesMapPage.jsx');
  if (!fs.existsSync(file)) return;
  const src = fs.readFileSync(file, 'utf8');
  // Toute interpolation dans un bindPopup / bindTooltip est enveloppée par esc(…).
  const popups = src.match(/bind(?:Popup|Tooltip)\(`[\s\S]*?`\)/g) || [];
  assert.ok(popups.length >= 2);
  for (const p of popups) {
    for (const expr of p.match(/\$\{(?!esc\(|d \?|p\.antenneName \?)[^}]*\}/g) || []) {
      assert.fail(`interpolation non échappée dans un popup : ${expr}`);
    }
  }
});
