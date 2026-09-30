/**
 * Official WFP FLA budget structure, reconstructed from the real file
 * "Contrat-budget-WFP-MDG-2025-AIN-MULTI-003-AM02-V1.xlsx".
 *
 * Five cost blocks, each a fixed catalogue of cost lines. Amounts are
 * captured per line AND per activity (an FLA budget is allocated across the
 * partner's activities, up to 7 columns in the source file). Section VI
 * (grand total) is always computed, never stored.
 *
 * A budget line is identified by `${section}.${line}` (e.g. "IV.suivi"),
 * which is the code stored in contract_budget_lines.line_code. The "IV.suivi"
 * line is the monitoring / TPM budget the Partenaires & TPM module reports
 * against.
 */

const SECTIONS = [
  {
    code: 'I',
    label: 'Transferts de produits alimentaires',
    short: 'Vivres',
    lines: [
      ['salaires_mt', 'Salaires du personnel (basés sur la MT)'],
      ['salaires_non_mt', 'Salaires du personnel (non basés sur la MT)'],
      ['depenses_mt', 'Dépenses de personnel (basées sur la MT)'],
      ['depenses_non_mt', 'Dépenses de personnel (non basées sur la MT)'],
      ['transport_mt', 'Transport (basé sur la MT)'],
      ['entreposage_mt', 'Entreposage (basé sur la MT)'],
      ['entreposage_non_mt', 'Entreposage (non basé sur la MT)'],
      ['transformation_mt', 'Services de transformation et de gestion des produits alimentaires (basés sur la MT)'],
      ['transformation_non_mt', 'Services de transformation et de gestion des produits alimentaires (non basés sur la MT)'],
    ],
  },
  {
    code: 'II',
    label: 'Transferts de type monétaire (CBT)',
    short: 'Monétaire',
    lines: [
      ['salaires', 'Salaires du personnel'],
      ['depenses', 'Dépenses de personnel'],
      ['autres_livraison', 'Autres coûts de livraison'],
    ],
  },
  {
    code: 'III',
    label: 'Renforcement de capacités',
    short: 'Capacités',
    lines: [
      ['salaires', 'Salaires du personnel'],
      ['depenses', 'Dépenses de personnel'],
      ['materiel', 'Matériel et fournitures'],
      ['services', 'Services contractuels'],
      ['formation', 'Formation, réunions, ateliers'],
      ['transport', 'Transport du matériel et coûts connexes'],
      ['autres', 'Autres coûts'],
    ],
  },
  {
    code: 'IV',
    label: 'Services techniques et spécialisés',
    short: 'Services techniques',
    lines: [
      ['evaluation', 'Évaluation'],
      ['evaluation_mi', 'Évaluation à mi-parcours'],
      ['suivi', 'Suivi (TPM)'],
      ['etude', 'Étude préalable'],
      ['autres_contractuels', 'Autres services contractuels'],
    ],
  },
  {
    code: 'V',
    label: "Coûts d'appui directs du partenaire coopérant",
    short: 'Coûts directs',
    lines: [
      ['salaires', 'Salaires du personnel'],
      ['depenses', 'Dépenses de personnel'],
      ['locaux', 'Coûts de location des locaux et autres frais de fonctionnement'],
      ['vehicules', 'Coûts relatifs aux véhicules et autres frais de fonctionnement'],
      ['materiel', 'Matériel et fournitures'],
    ],
  },
];

// The one line the TPM/monitoring reporting is measured against.
const MONITORING_LINE = 'IV.suivi';

const LINE_CODES = new Set();
const LINE_LABELS = {};
const SECTION_OF = {};
for (const s of SECTIONS) {
  for (const [line, label] of s.lines) {
    const code = `${s.code}.${line}`;
    LINE_CODES.add(code);
    LINE_LABELS[code] = label;
    SECTION_OF[code] = s.code;
  }
}

function isValidLine(code) {
  return LINE_CODES.has(code);
}

export { SECTIONS, MONITORING_LINE, LINE_CODES, LINE_LABELS, SECTION_OF, isValidLine };
