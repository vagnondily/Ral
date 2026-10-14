import { useEffect, useRef, useState } from 'react';
import { api } from '../../api/client.js';

/**
 * Données de la carte du suivi (lot 6a) : contours (chargés une fois par session,
 * promesse de module), GET /api/map/districts et GET /api/map/points en parallèle
 * (deux requêtes HTTP distinctes ; côté serveur, chacune lit sa transaction).
 * Une réponse périmée (période ou filtres changés entre-temps) est ignorée.
 * Petit cache de 60 s par requête : la tuile « Couverture » de la page et la carte
 * lisent la MÊME réponse (jamais deux couvertures différentes sur une page).
 */

let geoPromise = null;
/** Contours embarqués (web/public/geo/…, build reproductible web/scripts/build-geo.mjs). */
export function loadGeo(asset = 'geo/mdg-adm2.v1.json') {
  if (!geoPromise) {
    const base = (import.meta.env && import.meta.env.BASE_URL) || '/';
    geoPromise = fetch(`${base}${asset}`).then((r) => {
      if (!r.ok) throw new Error(`Contours indisponibles (${r.status})`);
      return r.json();
    }).catch((e) => { geoPromise = null; throw e; });
  }
  return geoPromise;
}

const CACHE_MS = 60_000;
const cache = new Map();
const keyOf = (kind, period, opts) => JSON.stringify([kind, period && period.from, period && period.to, opts]);
function cached(kind, period, opts, fetcher) {
  const k = keyOf(kind, period, opts);
  const hit = cache.get(k);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.promise;
  const promise = fetcher().catch((e) => { cache.delete(k); throw e; });
  cache.set(k, { at: Date.now(), promise });
  if (cache.size > 40) cache.delete(cache.keys().next().value);
  return promise;
}

/**
 * Vide le cache des réponses de la carte : à appeler après toute écriture qui change ce que la
 * carte montre (correspondance district ↔ contour, centres de district) — sinon l'écran garde
 * jusqu'à 60 s une réponse antérieure à la correction.
 */
export function clearMapCache() {
  cache.clear();
}

/** GET /api/map/districts mis en cache (60 s) — partagé par la carte et les tuiles de la page. */
export function fetchMapDistricts(period, { officeId = null, activity = null, levels = [] } = {}) {
  return cached('d', period, { officeId, activity, levels }, () => api.mapDistricts(period, { officeId, activity, levels }));
}
export function fetchMapPoints(period, { officeId = null, activity = null } = {}) {
  return cached('p', period, { officeId, activity }, () => api.mapPoints(period, { officeId, activity }));
}

/**
 * @param {{from:string,to:string}|null|undefined} period période (undefined = en attente)
 * @param {{ officeId?:string|null, activity?:string|null, withPoints?:boolean, levels?:string[] }} [opts]
 * @returns {{ geo, data, points, loading:boolean, error:string|null, geoError:string|null }}
 */
export function useMapData(period, { officeId = null, activity = null, withPoints = true, levels = [] } = {}) {
  const [geo, setGeo] = useState(null);
  const [geoError, setGeoError] = useState(null);
  const [state, setState] = useState({ data: null, points: null, loading: true, error: null });
  const seq = useRef(0);
  const levelsKey = levels.join(',');

  useEffect(() => {
    let alive = true;
    loadGeo().then((g) => { if (alive) setGeo(g); }, (e) => { if (alive) setGeoError(e.message); });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!period) return undefined;
    const id = ++seq.current;
    setState((s) => ({ ...s, loading: true, error: null }));
    const opts = { officeId, activity };
    Promise.all([
      fetchMapDistricts(period, { ...opts, levels }),
      withPoints ? fetchMapPoints(period, opts).catch(() => null) : Promise.resolve(null),
    ]).then(([data, points]) => {
      if (id !== seq.current) return; // réponse périmée
      try { performance.mark('mapx:data'); } catch { /* sans incidence */ }
      setState({ data, points, loading: false, error: null });
    }, (e) => {
      if (id !== seq.current) return;
      setState((s) => ({ ...s, loading: false, error: e.message || String(e) }));
    });
    return undefined;
  }, [period && period.from, period && period.to, officeId, activity, withPoints, levelsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  return { geo, geoError, ...state };
}

/** Thème sombre de l'application (attribut data-theme du document), suivi en direct. */
export function useDarkTheme() {
  const read = () => typeof document !== 'undefined' && document.documentElement.getAttribute('data-theme') === 'dark';
  const [dark, setDark] = useState(read);
  useEffect(() => {
    const obs = new MutationObserver(() => setDark(read()));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => obs.disconnect();
  }, []);
  return dark;
}
