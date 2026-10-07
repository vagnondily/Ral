// Labels and small helpers for the Contrats module. The FLA budget structure
// lives in budgetCatalog.js (mirror of the server); the server stays the
// source of truth for rules.
export { SECTIONS, MONITORING_LINE } from './budgetCatalog.js';

// Chaque statut porte une clé d'icône (STATUS_ICONS dans ui.jsx) : un statut
// s'affiche en couleur + icône + libellé (jamais la couleur seule).
export const REPORT_KIND = {
  financier: { label: 'Financier', tone: 'blue' },
  technique: { label: 'Technique', tone: null },
};
export const REPORT_STATUS = {
  attendu: { label: 'Attendu', tone: null, icon: 'clock' },
  soumis: { label: 'Soumis', tone: 'blue', icon: 'clock' },
  valide: { label: 'Validé', tone: 'green', icon: 'check' },
  rejete: { label: 'Rejeté', tone: 'red', icon: 'x' },
  non_applicable: { label: 'Non applicable', tone: null, icon: 'na' },
};

export const CONTRACT_STATUS = {
  brouillon: { label: 'Brouillon', tone: null, icon: 'draft' },
  en_validation: { label: 'En validation', tone: 'blue', icon: 'clock' },
  actif: { label: 'Actif', tone: 'green', icon: 'check' },
  rejete: { label: 'Rejeté', tone: 'red', icon: 'x' },
  resilie: { label: 'Résilié', tone: null, icon: 'ban' },
};

export const AMENDMENT_STATUS = {
  en_validation: { label: 'En validation', tone: 'blue', icon: 'clock' },
  approuve: { label: 'Approuvé', tone: 'green', icon: 'check' },
  rejete: { label: 'Rejeté', tone: 'red', icon: 'x' },
};

export const HISTORY_LABELS = {
  creation: 'Création du contrat',
  modification: 'Modification du brouillon',
  soumission: 'Soumission pour validation',
  approbation: 'Approbation — contrat activé',
  rejet: 'Rejet',
  depense_enregistree: 'Dépense enregistrée',
  depense_annulee: 'Dépense annulée',
  avenant_demande: "Demande d'avenant",
  avenant_approuve: 'Avenant approuvé',
  avenant_rejete: 'Avenant rejeté',
  renouvellement: 'Renouvellement',
  resiliation: 'Résiliation',
};

export function amendmentCode(n) {
  return `AM${String(n).padStart(2, '0')}`;
}

/** "2026-01-01" → "01/01/2026" */
export function formatDate(iso) {
  if (!iso) return '—';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

const SHORT_MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

/** "2026-01-01" → "janv. 2026" */
export function shortMonth(iso) {
  const [y, m] = iso.split('-').map(Number);
  return `${SHORT_MONTHS[m - 1]} ${y}`;
}

export function periodLabel(debut, fin) {
  return `${shortMonth(debut)} – ${shortMonth(fin)}`;
}

/** Flags shown next to the status in lists and detail headers. */
export function contractFlags(c) {
  const flags = [];
  if (c.amendmentRequired) flags.push({ key: 'req', label: 'Avenant requis', tone: 'red' });
  if (c.amendmentPending) flags.push({ key: 'pend', label: 'Avenant en validation', tone: 'orange' });
  if (c.expired) flags.push({ key: 'exp', label: 'Échu', tone: 'orange' });
  return flags;
}

/** Parses "180 000 000", "180000000,50" … into a number ('' when empty). */
export function parseMoney(text) {
  const cleaned = String(text).replace(/[\s  ]/g, '').replace(',', '.');
  if (cleaned === '') return '';
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : NaN;
}
