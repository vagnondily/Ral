import React from 'react';
import { AlertTriangle, CheckCircle2, CircleDashed, Info, OctagonAlert } from 'lucide-react';
import { useI18n } from '../../../lib/i18n.jsx';
import { dayLabel, formatInt, monthLabel } from '../../../lib/format.js';
import { formatParams } from '../../../lib/alerts.js';

/**
 * Mise en forme commune des vues du concepteur (lot 7a) : valeurs selon le type de colonne,
 * classes et statuts (couleur + icône + libellé, jamais la couleur seule), note d'un bloc vide.
 * Les DONNÉES (noms, codes) ne sont jamais traduites ; les libellés et les phrases à paramètres
 * (alertes, parcours) le sont.
 */
export const BAND = {
  exc: ['Excellent', CheckCircle2], sat: ['Satisfaisant', CheckCircle2], imp: ['À améliorer', AlertTriangle],
  urg: ['Action urgente', OctagonAlert], na: ['Non évalué', CircleDashed],
};
// Statuts codés renvoyés par le serveur (couverture, risque, plan, contrat, rapport, pipeline, alerte, configuration) → libellé + ton.
export const STATUS = {
  bon: ['Bon', 'exc'], moyen: ['Moyen', 'sat'], faible: ['Faible', 'imp'], critique: ['Critique', 'urg'],
  elevee: ['Élevé', 'urg'], moyenne: ['Moyen', 'imp'],
  draft: ['Brouillon', 'na'], soumis: ['Soumis', 'sat'], valide: ['Validé', 'exc'], annule: ['Annulé', 'na'], non_applicable: ['Non applicable', 'na'], vide: ['Vide', 'na'],
  brouillon: ['Brouillon', 'na'], en_validation: ['En validation', 'sat'], actif: ['Actif', 'exc'], rejete: ['Rejeté', 'urg'], resilie: ['Résilié', 'na'],
  attendu: ['Attendu', 'imp'], rupture: ['Rupture', 'urg'], couvert: ['Couvert', 'exc'],
  critical: ['Critique', 'urg'], warning: ['À surveiller', 'imp'], info: ['À traiter', 'sat'],
  bloquant: ['Bloquant', 'urg'], a_completer: ['À compléter', 'imp'], pret: ['Prêt', 'exc'], non_mesurable: ['Pas encore mesurable', 'na'],
};
export const TONE_ICON = { exc: CheckCircle2, sat: Info, imp: AlertTriangle, urg: OctagonAlert, na: CircleDashed };

const locale = () => (document.documentElement.lang === 'en' ? 'en-GB' : 'fr-FR');
export const num = (v, d = 0) => Number(v).toLocaleString(locale(), { maximumFractionDigits: d });

/** Valeur formatée selon le type de colonne du jeu de données. */
export function formatCell(type, v, tr) {
  if (v == null || v === '') return '—';
  switch (type) {
    case 'pct': return `${num(v, 1)} %`;
    case 'rate': return `${num(Number(v) * 100, 1)} %`;
    case 'int': return formatInt(v);
    case 'dec': return num(v, 3);
    case 'money': return num(v, 0);
    case 'month': return /^\d{4}-\d{2}$/.test(v) ? monthLabel(v) : String(v);
    case 'date': return /^\d{4}-\d{2}-\d{2}/.test(String(v)) ? dayLabel(String(v).slice(0, 10)) : String(v);
    case 'band': return tr(BAND[v] ? BAND[v][0] : v);
    case 'status': return STATUS[v] ? tr(STATUS[v][0]) : String(v);
    // Phrase française à paramètres (alertes, parcours, état de la configuration) : traduite ici.
    case 'message': return v && typeof v === 'object' ? tr(v.text, formatParams(v.params)) : String(v);
    default: return String(v); // donnée (nom, code) : jamais traduite
  }
}

/** Libellé d'une colonne : mois et domaines dynamiques tels quels, sinon traduit. */
export const colLabel = (c, tr) => (c.key.startsWith('m:') ? monthLabel(c.key.slice(2)) : c.key.startsWith('d:') ? c.label : tr(c.label));

/** Pastille de classe ou de statut : icône + libellé + couleur. */
export function Tone({ tone, children }) {
  const Icon = TONE_ICON[tone] || CircleDashed;
  return <span className={`rb-band rb-band-${tone || 'na'}`}><Icon size={12} aria-hidden="true" className="rb-band-ico" />{children}</span>;
}

/** Cellule de tableau selon son type. */
export function Cell({ col, value, tr }) {
  if (col.type === 'band') return <Tone tone={value || 'na'}>{formatCell('band', value || 'na', tr)}</Tone>;
  if (col.type === 'status') {
    // Statut sans valeur (aucune base : pas de site actif, risque non renseigné) : « — », jamais « aucun plan ».
    if (value == null) return <span className="rb-muted">—</span>;
    return <Tone tone={(STATUS[value] || [])[1] || 'na'}>{formatCell('status', value, tr)}</Tone>;
  }
  return formatCell(col.type, value, tr);
}

// Note d'un bloc vide : phrase du serveur, déjà dans la langue du rapport (jamais retraduite).
export function Empty({ note }) {
  const { tr } = useI18n();
  return <p className="rb-note">{note || tr('Aucune donnée sur la période.')}</p>;
}

export const isNumeric = (c) => ['int', 'dec', 'pct', 'money', 'rate'].includes(c.type);
