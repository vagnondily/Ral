import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api/client.js';

/**
 * Logos des en-têtes et pieds de page (lot 7a C8, retour 88). Une image est lue UNE fois par
 * session par une requête authentifiée, gardée en URL `blob:` (aperçu, impression) et convertie
 * en `data:` pour l'export HTML (fichier autonome). Une image introuvable (autre compte, supprimée)
 * rend `null` : l'emplacement reste vide, jamais d'erreur bloquante.
 */
const urls = new Map(); // id → URL blob: résolue
const pending = new Map(); // id → promesse en cours

export function loadAssetUrl(id) {
  if (!id) return Promise.resolve(null);
  if (urls.has(id)) return Promise.resolve(urls.get(id));
  if (!pending.has(id)) {
    pending.set(id, api.reportAssetBlob(id)
      .then((blob) => { const u = URL.createObjectURL(blob); urls.set(id, u); return u; })
      .catch(() => null)
      .finally(() => pending.delete(id)));
  }
  return pending.get(id);
}

/** URL affichable d'une image (null tant qu'elle n'est pas lue, ou si elle est introuvable). */
export function useAssetUrl(id) {
  const [url, setUrl] = useState(() => (id && urls.get(id)) || null);
  useEffect(() => {
    let alive = true;
    if (!id) { setUrl(null); return undefined; }
    if (urls.has(id)) { setUrl(urls.get(id)); return undefined; }
    loadAssetUrl(id).then((u) => { if (alive) setUrl(u); });
    return () => { alive = false; };
  }, [id]);
  return url;
}

/** Image en `data:` (export HTML autonome). */
export async function assetDataUrl(id) {
  const u = await loadAssetUrl(id);
  if (!u) return null;
  const blob = await (await fetch(u)).blob();
  return new Promise((resolve) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => resolve(null);
    r.readAsDataURL(blob);
  });
}

export const ASSET_MAX_BYTES = 512 * 1024;
export const ASSET_TYPES = ['image/png', 'image/jpeg'];

/**
 * Logos du compte (sélecteur) et téléversement. Contrôle avant envoi (format annoncé, taille) pour un
 * message immédiat ; le serveur reste juge (format reconnu par les octets, dimensions).
 * @returns {{ list: object[]|null, error: string|null, upload: (file, tr) => Promise<object>, refresh: () => void }}
 */
export function useAssetList() {
  const [list, setList] = useState(null);
  const [error, setError] = useState(null);
  const refresh = useCallback(() => {
    api.reportAssets().then((r) => { setList(r || []); setError(null); }).catch((e) => { setList([]); setError(e.message); });
  }, []);
  useEffect(() => { refresh(); }, [refresh]);
  const upload = useCallback(async (file, tr = (x) => x) => {
    if (!file) return null;
    if (file.type && !ASSET_TYPES.includes(file.type)) throw new Error(tr('Format refusé : choisissez une image PNG ou JPEG.'));
    if (file.size > ASSET_MAX_BYTES) throw new Error(tr('Image trop volumineuse : {kb} Ko (512 Ko au plus).', { kb: Math.ceil(file.size / 1024) }));
    const asset = await api.reportUploadAsset(file);
    setList((l) => [asset, ...(l || []).filter((a) => a.id !== asset.id)]);
    return asset;
  }, []);
  return { list, error, upload, refresh };
}
