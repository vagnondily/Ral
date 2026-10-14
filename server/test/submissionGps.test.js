/**
 * Position GPS d'une soumission (modules/map/submissionGps.js) — référence lisible de
 * la règle SQL de la migration 061 (parité vérifiée sur la base de démonstration :
 * 562 soumissions, 324 positions, 0 écart). Cas réels mesurés : clé de base préférée
 * à la variante suffixée, choix multiples « 1 2 » refusés.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { extractGps, usable, stripGps, MAX_ACCURACY_M } = require('../src/modules/map/submissionGps');

test('paire Kobo : la clé sans suffixe passe avant la variante _ca6b ; nombres en chaîne ; précision lue', () => {
  const g = extractGps({
    '@_HHCoord_latitude_ca6b': '-21.5', '@_HHCoord_longitude_ca6b': '47.1', '@_HHCoord_precision_ca6b': '3',
    '@_HHCoord_latitude': '-24.1222355', '@_HHCoord_longitude': 45.3429061, '@_HHCoord_precision': '4.8', '@_HHCoord_altitude': '120',
  });
  assert.deepEqual(g, { lat: -24.1222355, lng: 45.3429061, accuracyM: 4.8, key: '@_HHCoord_latitude', source: 'paire' });
});

test('chaîne geopoint « lat lng altitude précision »', () => {
  const g = extractGps({ HHCoord: '-21.1794143 48.2943889 46.2 4.98' });
  assert.deepEqual(g, { lat: -21.1794143, lng: 48.2943889, accuracyM: 4.98, key: 'HHCoord', source: 'geopoint' });
  assert.equal(extractGps({ p: ' -21.1794 48.2943 ' }).accuracyM, null);
});

test('réponses à choix multiples « 1 2 » et « 3 9 10 11 » refusées (faux positifs mesurés)', () => {
  assert.equal(extractGps({ q1: '1 2', q2: '3 9 10 11', q3: '1.5 2.5' }), null);
});

test('(0, 0), hors plage, valeurs non numériques : refusés', () => {
  assert.equal(extractGps({ x_latitude: '0', x_longitude: '0' }), null);
  assert.equal(extractGps({ x_latitude: '95', x_longitude: '45' }), null);
  assert.equal(extractGps({ x_latitude: 'n/a', x_longitude: '45' }), null);
  assert.equal(extractGps({ x_latitude: '-21.5' }), null); // longitude absente
});

test('_geolocation [lat, lng] (API Kobo) en dernier recours', () => {
  assert.deepEqual(extractGps({ _geolocation: [-23.35, 43.67] }), { lat: -23.35, lng: 43.67, accuracyM: null, key: '_geolocation', source: 'geolocation' });
  assert.equal(extractGps({ _geolocation: [null, null] }), null);
  assert.equal(extractGps({ _geolocation: [-23.35, 43.67], gps: '-21.1794 48.2943' }).source, 'geopoint');
});

test('usable : précision ≤ 100 m (inconnue acceptée)', () => {
  assert.equal(MAX_ACCURACY_M, 100);
  assert.equal(usable({ lat: 1, lng: 1, accuracyM: 100 }), true);
  assert.equal(usable({ lat: 1, lng: 1, accuracyM: 909 }), false);
  assert.equal(usable({ lat: 1, lng: 1, accuracyM: null }), true);
  assert.equal(usable(null), false);
  assert.equal(usable({ lat: 1, lng: 1, accuracyM: 150 }, { maxAccuracyM: 200 }), true);
});

test('stripGps : retire paires (suffixes compris), geopoint et _geolocation ; garde le reste ; copie', () => {
  const data = {
    '@_HHCoord_latitude': '-24.1', '@_HHCoord_longitude': '45.3', '@_HHCoord_precision': '4', '@_HHCoord_altitude': '1',
    '@_HHCoord_latitude_ca6b': '-24.1', HHCoord: '-24.1222 45.3429 12 4.5', _geolocation: [-24.1, 45.3],
    q1: '1 2', commune: 'Ebelo', n: 3,
  };
  const out = stripGps(data);
  assert.deepEqual(out, { q1: '1 2', commune: 'Ebelo', n: 3 });
  assert.equal(data.HHCoord, '-24.1222 45.3429 12 4.5'); // entrée intacte
  assert.equal(extractGps(out), null);
});
