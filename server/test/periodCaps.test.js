const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { PERIOD_CAPS } = require('../src/modules/common/periodCaps');
const period = require('../src/modules/common/period');

// web/src/lib/periodCaps.js et web/src/lib/period.js (modules ES purs) chargés ici, comme webPeriod.test.js.
const load = async (t, file) => {
  const abs = path.join(__dirname, '../../web/src/lib', file);
  if (!fs.existsSync(abs)) { t.skip('web/ absent'); return null; }
  return import(pathToFileURL(abs).href);
};

test('plafonds de période : la table du serveur est celle des écrans (aucune période proposée puis refusée)', async (t) => {
  const web = await load(t, 'periodCaps.js'); if (!web) return;
  assert.deepEqual({ ...web.PERIOD_CAPS }, { ...PERIOD_CAPS });
});

test('plafonds de période : analyse et listes 12 mois, faits terrain 24, documents 60 (= MAX_SPAN)', async (t) => {
  assert.deepEqual({ ...PERIOD_CAPS }, { analysis: 12, facts: 24, list: 12, document: 60 });
  assert.equal(period.MAX_SPAN, PERIOD_CAPS.document);
  const web = await load(t, 'period.js'); if (!web) return;
  assert.equal(web.MAX_SPAN, PERIOD_CAPS.document);
  assert.ok(Object.isFrozen(PERIOD_CAPS));
});
