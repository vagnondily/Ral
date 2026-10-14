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

test('carte des sites et carte du suivi (lot 6a) : aucune chaîne HTML assemblée (fiches en nœuds React, échappés)', () => {
  const files = [path.join(__dirname, '../../web/src/pages/monitoring/SitesMapPage.jsx')];
  const dir = path.join(__dirname, '../../web/src/components/map');
  if (fs.existsSync(dir)) for (const f of fs.readdirSync(dir)) files.push(path.join(dir, f));
  for (const file of files) {
    if (!fs.existsSync(file)) continue;
    const src = fs.readFileSync(file, 'utf8');
    // Plus de popups Leaflet en HTML : noms de sites, communes, districts rendus par React.
    assert.doesNotMatch(src, /bind(?:Popup|Tooltip)\(|innerHTML|dangerouslySetInnerHTML|insertAdjacentHTML/, path.basename(file));
  }
});
