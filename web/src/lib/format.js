// Formatting helpers — one place for every user-visible number/date so the
// whole UI stays consistent (fr-FR, Ariary without decimals).

const nf = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });

/** 450000 -> "450 000 Ar". Normalizes the narrow no-break space Intl emits
 * (U+202F) to a regular no-break space, which every font renders. */
export function formatAr(value) {
  const n = Number(value) || 0;
  return `${nf.format(n).replace(/ /g, ' ')} Ar`;
}

export function formatInt(value) {
  return nf.format(Number(value) || 0).replace(/ /g, ' ');
}

const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

/** "2026-09" -> "Septembre 2026" (explicit table: no dependency on the
 * browser's locale data, and no timezone involved). */
export function monthLabel(month) {
  const [y, m] = month.split('-').map(Number);
  const name = MONTHS[m - 1];
  return `${name.charAt(0).toUpperCase()}${name.slice(1)} ${y}`;
}

export function shiftMonth(month, delta) {
  const [y, m] = month.split('-').map(Number);
  const idx = y * 12 + (m - 1) + delta;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`;
}

export function currentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Calendar cells for a month, Monday-first, with leading blanks. */
export function monthGrid(month) {
  const [y, m] = month.split('-').map(Number);
  const count = new Date(y, m, 0).getDate();
  const firstDow = (new Date(y, m - 1, 1).getDay() + 6) % 7; // 0 = Monday
  const cells = Array.from({ length: firstDow }, () => null);
  for (let d = 1; d <= count; d += 1) {
    const iso = `${month}-${String(d).padStart(2, '0')}`;
    const dow = (firstDow + d - 1) % 7;
    cells.push({ iso, day: d, weekend: dow >= 5 });
  }
  return cells;
}

export function dayLabel(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

export function formatDateTime(value) {
  if (!value) return '—';
  const d = new Date(value);
  const date = d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const time = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  return `${date} à ${time}`;
}

export function formatTime(value) {
  if (!value) return '—';
  return new Date(value).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

export function initials(name = '') {
  const parts = name.replace(/\./g, ' ').split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export const RISK = {
  faible: { label: 'Faible', tone: 'green' },
  moyenne: { label: 'Moyen', tone: 'orange' },
  elevee: { label: 'Élevé', tone: 'red' },
};

export const ROLE_LABELS = {
  admin: 'Administrateur',
  manager: 'Gestionnaire de suivi',
  viewer: 'Lecture seule',
};

export const PLAN_STATUS = {
  draft: { label: 'Brouillon', tone: 'yellow' },
  submitted: { label: 'Soumis', tone: 'blue' },
  validated: { label: 'Validé', tone: 'green' },
};
