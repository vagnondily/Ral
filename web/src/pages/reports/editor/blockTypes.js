import {
  Heading1, Type, MessageSquareWarning, Gauge, Table2, Sparkles, SeparatorHorizontal, Minus, Repeat,
  RectangleHorizontal, Columns2, MoveVertical, ListOrdered,
} from 'lucide-react';

/**
 * Types de blocs de COMPOSITION de l'éditeur (lot 7a) et libellés partagés par les volets.
 * Les blocs de données viennent du catalogue (volet Catalogue).
 */
export const BLOCK_TYPES = [
  ['heading', 'Titre', Heading1], ['text', 'Texte', Type], ['callout', 'Encadré', MessageSquareWarning],
  ['kpis', 'Chiffres clés', Gauge], ['data', 'Données', Table2],
  ['bulletin', 'Bulletin rédigé', Sparkles], ['section', 'Section', RectangleHorizontal], ['columns', 'Colonnes', Columns2],
  ['repeat', 'Section répétée', Repeat], ['toc', 'Sommaire', ListOrdered], ['spacer', 'Espace', MoveVertical],
  ['pagebreak', 'Saut de page', SeparatorHorizontal], ['divider', 'Séparateur', Minus],
];
export const TYPE_LABEL = Object.fromEntries(BLOCK_TYPES.map(([k, l]) => [k, l]));
export const TYPE_ICON = Object.fromEntries(BLOCK_TYPES.map(([k, , I]) => [k, I]));

export const VIEW_LABELS = {
  table: 'Tableau', bar: 'Barres', column: 'Colonnes', line: 'Courbes', donut: 'Anneau', stacked: 'Barres empilées',
  heat: 'Matrice colorée', kpi: 'Tuile', list: 'Liste', card: 'Carte de résultat', explain: 'Explication', map: 'Carte', gauge: 'Jauge',
};

// Conseils de forme (reportViz.viewAdvice) : phrases traduites à l'affichage.
export const VIEW_ADVICE = {
  donut_too_many: 'Plus de 5 parts : préférez des barres empilées ou des barres.',
  single_value: 'Un seul chiffre : une tuile se lit mieux qu\'un graphique.',
  too_many_categories: 'Plus de 7 catégories : les plus petites sont regroupées dans « Autres » ; un tableau montre tout.',
  line_too_short: 'Moins de 3 points : des colonnes se lisent mieux qu\'une courbe.',
};

// Avertissements de la mise à niveau v1 → v2 (code + paramètres envoyés par le serveur).
export const UPGRADE_WARNINGS = {
  office_removed: 'Filtre bureau « {name} » retiré : aucun bureau MEMS de ce nom (choisissez-le à nouveau).',
  view_replaced: 'Présentation « {from} » remplacée par « {to} » (non proposée pour ces données).',
};

// Blocs qui attendent leurs données dans un cadre nommé (squelette, chronomètre, erreur + Réessayer).
export const FRAMED = new Set(['data', 'kpis', 'bulletin']);
export const DEFAULT_H = { data: 220, kpis: 84, bulletin: 120 };

export function frameLabel(b, catalog, tr) {
  if (b.type === 'data') return (b.params.figure && b.params.figure.title) || tr((catalog.datasets[b.params.dataset] || {}).label || b.params.dataset);
  return tr(TYPE_LABEL[b.type] || b.type);
}

/** Libellé d'un bloc dans le plan. */
export function outlineLabel(b, catalog, tr) {
  if (b.type === 'heading') return b.params.text;
  if (b.type === 'data') return (b.params.figure && b.params.figure.title) || tr((catalog.datasets[b.params.dataset] || {}).label || b.params.dataset);
  if (b.type === 'section') return `${tr('Section')}${b.params.title ? ` · ${b.params.title}` : ''}`;
  return b.params.title || tr(TYPE_LABEL[b.type] || b.type);
}

// Filtres d'un bloc : clé dans le document → clé du catalogue, libellé, note quand non pris en charge.
export const FILTERS = [
  { key: 'office', cat: 'office', label: 'Bureau', unsupported: 'Non disponible par bureau.' },
  { key: 'activity', cat: 'activity', label: 'Activité', unsupported: 'Non disponible par activité.' },
  // TPM ou titulaire (retour 102) : prestataire d'une visite ou d'une soumission ; pour le budget, titulaire du
  // contrat OU TPM rattaché (plan, facture, visite).
  { key: 'partnerId', cat: 'partner', label: 'Prestataire (TPM) ou titulaire', unsupported: 'Non disponible par partenaire.' },
  { key: 'district', cat: 'district', label: 'District', unsupported: 'Non disponible par district.' },
  { key: 'formId', cat: 'form', label: 'Fiche de suivi', unsupported: 'Non disponible par fiche.' },
];
