// Affichage des aides contextuelles (notes explicatives + astuces sous les
// champs/toolbars), piloté par un attribut sur <html> — comme le thème. Masqué
// par défaut (gagne de la place) ; activable depuis le menu utilisateur.
import { useEffect, useState } from 'react';

const KEY = 'mems.tips';
const VALUES = ['on', 'off'];

export function storedTips() {
  try { const v = localStorage.getItem(KEY); if (VALUES.includes(v)) return v; } catch { /* ignore */ }
  return 'off'; // par défaut : aides masquées
}

export function applyTips(v) {
  const t = v === 'on' ? 'on' : 'off';
  document.documentElement.setAttribute('data-tips', t);
  try { localStorage.setItem(KEY, t); } catch { /* ignore */ }
}

export function initTips() {
  document.documentElement.setAttribute('data-tips', storedTips());
}

export function useTips() {
  const [tips, setTips] = useState(storedTips);
  useEffect(() => { applyTips(tips); }, [tips]);
  return { tips, setTips, toggle: () => setTips((t) => (t === 'on' ? 'off' : 'on')) };
}
