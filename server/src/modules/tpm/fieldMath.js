/**
 * Suivi terrain — pure, unit-tested math for site-visit coverage.
 * No I/O. A visit has a status ∈ (planifie, realise, annule); coverage is the
 * share of non-cancelled visits actually realised.
 */
const STATUSES = ['planifie', 'realise', 'annule'];

function blank() { return { planifie: 0, realise: 0, annule: 0, total: 0, active: 0, rate: 0 }; }

function add(acc, status) {
  const s = STATUSES.includes(status) ? status : 'planifie';
  acc[s] += 1;
  acc.total += 1;
  acc.active = acc.planifie + acc.realise;       // annulées exclues du dénominateur
  acc.rate = acc.active > 0 ? acc.realise / acc.active : 0;
  return acc;
}

/**
 * Summarize a list of visits into overall coverage + breakdowns by provider,
 * district and activity. `providerLabel` maps a provider id → name.
 */
function summarizeVisits(visits, providerLabel = {}) {
  const overall = blank();
  const byProvider = new Map();
  const byDistrict = new Map();
  const byActivity = new Map();
  const bump = (map, key) => { if (!map.has(key)) map.set(key, blank()); return map.get(key); };

  for (const v of visits || []) {
    add(overall, v.status);
    add(bump(byProvider, v.providerId || 'non_affecte'), v.status);
    add(bump(byDistrict, v.district || '—'), v.status);
    add(bump(byActivity, v.activity || '—'), v.status);
  }

  const shape = (map, labelFor) => [...map.entries()]
    .map(([key, c]) => ({ key, label: labelFor ? labelFor(key) : key, ...c }))
    .sort((a, b) => b.total - a.total);

  return {
    overall,
    byProvider: shape(byProvider, (id) => (id === 'non_affecte' ? 'Non affecté' : (providerLabel[id] || id))),
    byDistrict: shape(byDistrict),
    byActivity: shape(byActivity),
  };
}

module.exports = { STATUSES, summarizeVisits };
