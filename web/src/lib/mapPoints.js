/**
 * Points de la carte du suivi (retour 94) — règles PURES de la couleur des points et de la
 * légende, testées (server/test/webMap.test.js).
 *
 * Couleur des points, au choix :
 *  - « statut de visite » (réalisé, hors plan, prévu, non prévu, inactif) — symbole par statut ;
 *  - « activité » : palette catégorielle validée (ordre fixe, jamais recyclée), une couleur par
 *    activité du REGISTRE dans l'ordre du nombre de sites (les 8 premières), « Autres » pour le
 *    reste. La couleur suit l'activité, jamais son rang dans la vue : un filtre (bureau,
 *    période) ne repeint jamais les activités qui restent.
 * La forme dit TOUJOURS la précision de la position : position GPS du site (disque), position
 * déduite de ses collectes (disque + anneau), centre de la commune (anneau pointillé, position
 * approximative), point de collecte (petit point).
 *
 * La légende ne montre que ce qui est réellement dessiné, avec l'effectif de chaque élément et
 * une phrase d'explication (« ? »).
 */

/** Nombre de couleurs d'activité (au-delà : « Autres »). */
export const ACTIVITY_SLOTS = 8;

/** Ordre des statuts de visite dans la légende (du « fait » au « hors champ »). */
export const STATUS_ORDER = ['realise', 'hors_plan', 'prevu', 'non_prevu', 'inactif'];

/** Libellés et explications (phrases traduites à l'affichage). */
export const STATUS_TEXT = {
  realise: { label: 'Visité comme prévu', help: 'Site prévu au plan de la période et visité (données reçues ou visite déclarée).' },
  hors_plan: { label: 'Visité hors plan', help: 'Site visité sur la période sans avoir été prévu au plan.' },
  prevu: { label: 'Prévu, pas encore visité', help: 'Site prévu au plan de la période, sans visite enregistrée pour l\'instant.' },
  non_prevu: { label: 'Actif, ni prévu ni visité', help: 'Site actif sur la période, absent du plan et sans visite.' },
  inactif: { label: 'Inactif sur la période', help: 'Site déclaré inactif pour ces mois (grille des sites actifs) : il n\'est pas attendu.' },
};
export const SHAPE_TEXT = {
  gps: { label: 'Position GPS du site', help: 'Coordonnées GPS enregistrées dans le registre des sites : la position exacte du site.' },
  derived: { label: 'Position déduite de ses collectes', help: 'Site sans GPS, placé au centre des positions de ses propres collectes (3 relevés au moins) ; anneau pointillé = position indicative (relevés dispersés).' },
  commune: { label: 'Centre de la commune (position approximative)', help: 'Sites sans position, regroupés au centre des collectes de leur commune ; le chiffre indique le nombre de sites.' },
  collect: { label: 'Point de collecte (ménage)', help: 'Position GPS d\'une collecte reçue ; hors administrateur et gestionnaire, regroupée par maille de 2 km.' },
};
export const ACTIVITY_HELP = 'Couleur = activité du site dans le registre (les 8 activités qui ont le plus de sites, les autres regroupées). Survolez une activité pour ne voir que ses points.';
export const OTHER_LABEL = 'Autres activités';

/** Clé d'une activité (sans casse ni espaces autour) — même règle que le classement par activité du serveur. */
export const activityKey = (v) => String(v == null ? '' : v).trim().toLowerCase();

/**
 * Couleur de chaque activité du registre : son rang (1…ACTIVITY_SLOTS) dans la liste du registre,
 * triée par nombre de sites (GET /api/map/districts → filtersAvailable.activities). Indépendante
 * des filtres de la carte.
 * @param {{ value: string, sites?: number }[]} activities
 * @returns {Map<string, number>} clé d'activité → numéro de couleur
 */
export function activitySlots(activities = [], max = ACTIVITY_SLOTS) {
  const out = new Map();
  for (const a of activities || []) {
    const k = activityKey(a && a.value);
    if (!k || out.has(k)) continue;
    if (out.size >= max) break;
    out.set(k, out.size + 1);
  }
  return out;
}

/** Numéro de couleur d'une activité (0 = « Autres » : hors des 8 premières, ou sans activité). */
export function slotOf(activity, slots) {
  const k = activityKey(activity);
  return (k && slots && slots.get(k)) || 0;
}

/** Sites dessinés selon les couches cochées (GPS, placés par leurs collectes). */
export function drawnSites(points, layers = {}) {
  return ((points && points.sites) || []).filter((s) => (s.kind === 'gps' ? layers.gps : s.kind === 'collectes' ? layers.derived : false));
}

/**
 * Le point correspond-il à l'élément de légende survolé ? (les autres sont estompés)
 * @param {{ kind: string, status?: string, activity?: string|null }} site point de site (ou { kind: 'commune' | 'collect' })
 * @param {{ by: 'status'|'activity'|'shape', value: string|number }|null} focus
 * @param {Map<string, number>} slots
 */
export function matchesFocus(site, focus, slots) {
  if (!focus) return true;
  if (focus.by === 'status') return site.kind !== 'commune' && site.kind !== 'collect' && site.status === focus.value;
  if (focus.by === 'activity') return site.kind !== 'commune' && site.kind !== 'collect' && slotOf(site.activity, slots) === focus.value;
  if (focus.by === 'shape') {
    const shape = site.kind === 'gps' ? 'gps' : site.kind === 'collectes' ? 'derived' : site.kind;
    return shape === focus.value;
  }
  return true;
}

/**
 * Modèle de la légende des points : seulement les éléments dessinés, avec leurs effectifs.
 * @param {object|null} points réponse de GET /api/map/points
 * @param {{ gps?: boolean, derived?: boolean, communes?: boolean, collect?: boolean }} layers couches affichées
 * @param {{ colorBy?: 'status'|'activity', slots?: Map<string, number> }} [opts]
 * @returns {{ color: object[], shape: object[], sites: number }}
 *   color : statut → { id, n } ; activité → { id: slot, slot, label, n, names } (« Autres » : slot 0, en dernier)
 *   shape : { id: 'gps'|'derived'|'commune'|'collect', n, indicative?, sites?, binned? }
 */
export function pointsLegend(points, layers = {}, { colorBy = 'status', slots = new Map() } = {}) {
  const sites = drawnSites(points, layers);
  const shape = [];
  const gps = sites.filter((s) => s.kind === 'gps').length;
  const derived = sites.filter((s) => s.kind === 'collectes');
  if (gps) shape.push({ id: 'gps', n: gps });
  if (derived.length) shape.push({ id: 'derived', n: derived.length, indicative: derived.filter((s) => s.quality && s.quality !== 'fiable').length });
  const communes = (layers.communes && points && points.communes) || [];
  if (communes.length) shape.push({ id: 'commune', n: communes.length, sites: communes.reduce((a, c) => a + (c.sitesWithoutPosition || 0), 0) });
  const collect = layers.collect && points && points.collect;
  if (collect && collect.total > 0) shape.push({ id: 'collect', n: collect.total, binned: collect.mode === 'bins' });

  let color;
  if (colorBy === 'activity') {
    const bySlot = new Map();
    for (const s of sites) {
      const slot = slotOf(s.activity, slots);
      const cur = bySlot.get(slot) || { id: slot, slot, label: null, n: 0, names: new Set() };
      cur.n += 1;
      const name = String(s.activity == null ? '' : s.activity).trim();
      if (name) { cur.names.add(name); if (slot && !cur.label) cur.label = name; }
      bySlot.set(slot, cur);
    }
    color = [...bySlot.values()]
      .map((x) => ({ ...x, names: [...x.names].sort((a, b) => a.localeCompare(b)), label: x.slot ? x.label : null }))
      .sort((a, b) => (a.slot === 0) - (b.slot === 0) || a.slot - b.slot);
  } else {
    const n = new Map();
    for (const s of sites) n.set(s.status, (n.get(s.status) || 0) + 1);
    color = STATUS_ORDER.filter((st) => n.get(st) > 0).map((st) => ({ id: st, n: n.get(st) }));
  }
  return { color, shape, sites: sites.length };
}
