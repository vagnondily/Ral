/**
 * Étiquettes de la carte (lot 6a) — module PUR, testé par server/test/webMap.test.js.
 * Placement glouton : priorité aux plus grandes aires (puis aux zones avec données) ;
 * une étiquette qui chevaucherait une autre est omise (visible au zoom, au survol et
 * dans le classement), jamais superposée.
 */

/** Largeur approchée d'un texte (px) en Inter à `size` px (moyenne mesurée ≈ 0,56 em). */
export const textWidth = (text, size = 11) => String(text).length * size * 0.56 + 6;

/**
 * @param {{ key:string, x:number, y:number, text:string, priority:number }[]} items
 * @param {{ size?:number, gap?:number, bounds?:{width:number,height:number} }} [opts]
 * @returns {{ key, x, y, text, box:number[] }[]} étiquettes retenues (ordre de priorité)
 */
export function layoutLabels(items, { size = 11, gap = 2, bounds = null } = {}) {
  const placed = [];
  const sorted = [...items].sort((a, b) => b.priority - a.priority || String(a.key).localeCompare(String(b.key)));
  for (const it of sorted) {
    const w = textWidth(it.text, size); const h = size + 3;
    const box = [it.x - w / 2 - gap, it.y - h / 2 - gap, it.x + w / 2 + gap, it.y + h / 2 + gap];
    if (bounds && (box[0] < 0 || box[1] < 0 || box[2] > bounds.width || box[3] > bounds.height)) continue;
    if (placed.some((p) => !(box[2] <= p.box[0] || box[0] >= p.box[2] || box[3] <= p.box[1] || box[1] >= p.box[3]))) continue;
    placed.push({ key: it.key, x: it.x, y: it.y, text: it.text, box });
  }
  return placed;
}
