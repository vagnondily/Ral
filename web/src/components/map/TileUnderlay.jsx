import React, { useMemo } from 'react';
import { tilesFor } from '../../lib/mapProjection.js';

/** URL des tuiles du fond en ligne : VITE_MAP_TILES_URL ; absente = OpenStreetMap ; vide = aucun fond proposé. */
export const TILES_URL = (() => {
  const v = import.meta.env && import.meta.env.VITE_MAP_TILES_URL;
  return v === undefined ? 'https://tile.openstreetmap.org/{z}/{x}/{y}.png' : String(v).trim();
})();

/**
 * Sonde UNE tuile avant d'activer le fond en ligne : résout true si elle se charge,
 * false sinon (hors connexion, réseau filtré) ou après `timeoutMs`. Jamais de rafale de
 * requêtes en échec : la couche n'est montée qu'après une sonde réussie.
 */
export function probeTiles(url = TILES_URL, timeoutMs = 6000) {
  return new Promise((resolve) => {
    if (!url) { resolve(false); return; }
    const img = new Image();
    const timer = setTimeout(() => { img.src = ''; resolve(false); }, timeoutMs);
    img.onload = () => { clearTimeout(timer); resolve(true); };
    img.onerror = () => { clearTimeout(timer); resolve(false); };
    img.src = url.replace('{z}', '5').replace('{x}', '20').replace('{y}', '17').replace('{s}', 'a');
  });
}

/**
 * Fond de carte en ligne facultatif (lot 6a) — tuiles XYZ sous le SVG, dans la même
 * projection Web Mercator : alignées sur les contours. Éteint par défaut ; jamais dans
 * l'export. Une tuile en échec coupe toute la couche (onFail).
 */
export default function TileUnderlay({ t, view, width, height, url = TILES_URL, onFail }) {
  const tiles = useMemo(() => {
    if (!t || !url) return [];
    // Emprise visible (degrés) : coins de la fenêtre ramenés dans le cadrage de base.
    const [w, n] = t.invert((0 - view.x) / view.s, (0 - view.y) / view.s);
    const [e, s] = t.invert((width - view.x) / view.s, (height - view.y) / view.s);
    return tilesFor({ bbox: [w, s, e, n], widthPx: width }, url);
  }, [t, view, width, height, url]);
  const toScreen = (lng, lat) => { const [x, y] = t.project(lng, lat); return [x * view.s + view.x, y * view.s + view.y]; };
  return (
    <div className="mapx-tiles" aria-hidden="true">
      {tiles.map((tile) => {
        const [x0, y0] = toScreen(tile.bbox[0], tile.bbox[3]);
        const [x1, y1] = toScreen(tile.bbox[2], tile.bbox[1]);
        return (
          <img key={`${tile.z}/${tile.x}/${tile.y}`} src={tile.url} alt="" draggable="false" referrerPolicy="no-referrer"
            style={{ left: x0, top: y0, width: x1 - x0 + 0.5, height: y1 - y0 + 0.5 }} onError={onFail} />
        );
      })}
      <span className="mapx-tiles-attr">© OpenStreetMap</span>
    </div>
  );
}
