const ExcelJS = require('exceljs');
const { COMMODITIES, MODALITIES, colLetter } = require('./pddImport');

/**
 * Modèle vierge de la feuille « PDD base », aux positions de colonnes EXACTES
 * lues par `parsePddWorkbook` (en-tête ligne 5, données dès la ligne 6) — de
 * sorte que « télécharger → remplir → importer » fonctionne sans retouche.
 * Une feuille « Lisez-moi » documente le format. Pur (aucune I/O).
 */
const HEADER_ROW = 5;
const FIRST_ROW = HEADER_ROW + 1;
const TEMPLATE_ROWS = 300;
const MONTH_NAMES = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const FOOD_TOTAL_COL = 41;
const CASH_COL = 43;

// Colonnes lues par l'import : n° → [en-tête, aide, obligatoire ?]
const COLUMNS = {
  1: ['Mois', 'Nom du mois (janvier … décembre ; abréviations sans ambiguïté acceptées : janv., févr., avr., juil., sept., oct., nov., déc.).', true],
  2: ['Année', 'Année sur 4 chiffres, entre 2000 et 2100 (ex. 2026).', true],
  3: ['WBS', 'Code WBS / budgétaire (facultatif).', false],
  4: ['Programme', "Utilisé comme activité si la colonne « Activité » est vide.", false],
  7: ['Activité', "Libellé de l'activité. Contient « cyclone » ou « sécheresse/drought » → aléa détecté automatiquement.", true],
  10: ['Antenne', 'Bureau antenne (libellé du référentiel Bureaux).', false],
  11: ['Sous-bureau', 'Sous-bureau (libellé du référentiel Bureaux).', false],
  12: ['Partenaire', 'Partenaire de mise en œuvre.', false],
  13: ['Corridor', 'Corridor logistique (facultatif).', false],
  14: ['Région', 'Région (libellé).', false],
  15: ['District', 'District — District OU Commune obligatoire.', true],
  16: ['Commune', 'Commune — District OU Commune obligatoire.', true],
  20: ['Bénéficiaires', 'Nombre de personnes (entier ≥ 0).', false],
  21: ['Ménages', 'Nombre de ménages (entier ≥ 0).', false],
  22: ['Modalité', `${Object.keys(MODALITIES).join(', ')} (Inkind = vivres, CBT = transfert monétaire, Mixte = les deux). « Vivres », « Cash », « In-kind »… sont aussi acceptés.`, false],
  [FOOD_TOTAL_COL]: ['Total vivres (MT)', 'Calculé : somme des denrées (ne pas saisir).', false],
  [CASH_COL]: ['Cash (USD)', 'Montant transféré en USD (≥ 0), jamais en ariary : l\'en-tête doit contenir « USD ».', false],
};
for (const [c, name] of COMMODITIES) COLUMNS[c] = [`${name} (MT)`, `Tonnage de ${name} en tonnes métriques (≥ 0, 3 décimales).`, false];

const LAST_COL = CASH_COL;
const FOOD_RANGE = (r) => `${colLetter(COMMODITIES[0][0])}${r}:${colLetter(COMMODITIES[COMMODITIES.length - 1][0])}${r}`;

const BLUE = 'FF0F6CBD';
const GREY = 'FFF6F8FB';
const thin = { style: 'thin', color: { argb: 'FFCCD2DC' } };

/**
 * @param {{ sampleRows?: Array<object> }} [opts] lignes d'exemple (tests / démo)
 *   au format { month, year, activity, district, commune, beneficiaries, items:{Riz:1.2}, cashUsd, … }
 */
function buildPddTemplate({ sampleRows = [] } = {}) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'MEMS 2.0';
  const ws = wb.addWorksheet('PDD base', { views: [{ state: 'frozen', xSplit: 0, ySplit: HEADER_ROW }] });

  ws.getCell('A1').value = 'Plan de Distribution d\'urgence — modèle d\'import';
  ws.getCell('A1').font = { bold: true, size: 14 };
  ws.getCell('A2').value = 'MEMS 2.0 · Suivi & évaluation — remplir à partir de la ligne 6, puis « Importer le PDD ».';
  ws.getCell('A2').font = { color: { argb: 'FF616A7A' } };
  ws.getCell('A3').value = 'Colonnes bleues = obligatoires · colonnes grisées = non lues par l\'import (laisser vides) · voir la feuille « Lisez-moi ».';
  ws.getCell('A3').font = { italic: true, size: 9, color: { argb: 'FF616A7A' } };

  const header = ws.getRow(HEADER_ROW);
  for (let c = 1; c <= LAST_COL; c += 1) {
    const def = COLUMNS[c];
    const cell = header.getCell(c);
    cell.value = def ? def[0] : '—';
    cell.font = { bold: true, color: { argb: def && def[2] ? 'FFFFFFFF' : 'FF14181F' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: def ? (def[2] ? BLUE : 'FFE7E9EF') : 'FFF5F6F9' } };
    cell.alignment = { vertical: 'middle', wrapText: true };
    cell.border = { bottom: thin, right: thin };
    if (def) cell.note = def[1];
    ws.getColumn(c).width = def ? Math.max(11, def[0].length + 2) : 3;
  }
  header.height = 30;

  // Lignes de saisie : validations à la saisie + total vivres en formule.
  for (let r = FIRST_ROW; r < FIRST_ROW + TEMPLATE_ROWS; r += 1) {
    const row = ws.getRow(r);
    row.getCell(1).dataValidation = { type: 'list', allowBlank: true, formulae: [`"${MONTH_NAMES.join(',')}"`], showErrorMessage: true, error: 'Choisissez un mois dans la liste.' };
    row.getCell(2).dataValidation = { type: 'whole', operator: 'between', allowBlank: true, formulae: [2000, 2100], showErrorMessage: true, error: 'Année sur 4 chiffres.' };
    row.getCell(22).dataValidation = { type: 'list', allowBlank: true, formulae: [`"${Object.keys(MODALITIES).join(',')}"`] };
    for (const c of [20, 21]) row.getCell(c).dataValidation = { type: 'whole', operator: 'greaterThanOrEqual', allowBlank: true, formulae: [0], showErrorMessage: true, error: 'Entier ≥ 0.' };
    for (const c of [...COMMODITIES.map(([k]) => k), CASH_COL]) {
      row.getCell(c).dataValidation = { type: 'decimal', operator: 'greaterThanOrEqual', allowBlank: true, formulae: [0], showErrorMessage: true, error: 'Nombre ≥ 0.' };
      row.getCell(c).numFmt = '#,##0.000';
    }
    row.getCell(CASH_COL).numFmt = '#,##0.00';
    row.getCell(FOOD_TOTAL_COL).value = { formula: `SUM(${FOOD_RANGE(r)})` };
    row.getCell(FOOD_TOTAL_COL).numFmt = '#,##0.000';
    row.getCell(FOOD_TOTAL_COL).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GREY } };
  }

  sampleRows.forEach((s, i) => writeRow(ws.getRow(FIRST_ROW + i), FIRST_ROW + i, s));

  addReadme(wb);
  return wb;
}

function writeRow(row, r, s) {
  const set = (c, v) => { if (v != null && v !== '') row.getCell(c).value = v; };
  set(1, s.month ? MONTH_NAMES[s.month - 1] : null);
  set(2, s.year);
  set(3, s.wbs); set(7, s.activity); set(10, s.antenne); set(11, s.sousBureau);
  set(12, s.partner); set(13, s.corridor); set(14, s.region); set(15, s.district); set(16, s.commune);
  set(20, s.beneficiaries); set(21, s.households); set(22, s.modality); set(CASH_COL, s.cashUsd);
  let total = 0;
  for (const [c, name] of COMMODITIES) {
    const q = s.items && s.items[name];
    if (q) { row.getCell(c).value = q; total += q; }
  }
  row.getCell(FOOD_TOTAL_COL).value = { formula: `SUM(${FOOD_RANGE(r)})`, result: Math.round(total * 1000) / 1000 };
}

function addReadme(wb) {
  const ws = wb.addWorksheet('Lisez-moi');
  ws.getColumn(1).width = 6; ws.getColumn(2).width = 22; ws.getColumn(3).width = 90;
  const lines = [
    ['Format du fichier PDD'],
    [],
    ['•', 'Feuille', 'Le fichier doit contenir une feuille nommée « PDD base » (sinon : la feuille — de préférence un tableau Excel — dont l\'en-tête porte « Mois » en colonne A et « Commune » en colonne P, dans les 12 premières lignes).'],
    ['•', 'En-tête', `Ligne ${HEADER_ROW} ; les données commencent à la ligne ${FIRST_ROW}. Les positions de colonnes sont fixes : ne pas insérer ni supprimer de colonne (sinon l'import est refusé).`],
    ['•', 'Ligne retenue', 'Une ligne est importée si elle a un Mois (nom du mois, accents facultatifs), une Année, une Activité (ou un Programme) et un District ou une Commune. Les autres sont listées avec leur motif dans le résumé d\'import.'],
    ['•', 'Tableau Excel', 'Si les données sont dans un tableau Excel (Insertion › Tableau), une ligne écrite SOUS le tableau n\'est pas importée : elle est listée avec le motif « étendez le tableau ».'],
    ['•', 'Erreurs Excel', 'Une cellule en erreur (#REF!, #N/A, #VALUE!, #DIV/0!…) ou un nombre illisible écarte la ligne : il n\'est jamais lu comme 0. Un nombre écrit comme texte doit être sans ambiguïté : « 1,250 » ou « 1.250 » (mille deux cent cinquante ou 1,25 ?) sont refusés.'],
    ['•', 'Modalité', `Valeurs enregistrées : ${Object.keys(MODALITIES).join(', ')}. Synonymes acceptés : Vivres / In-kind → Inkind ; Cash → CBT ; Mixed → Mixte.`],
    ['•', 'Réimport', 'Idempotent : chaque mois présent dans le fichier REMPLACE les distributions déjà importées pour ce mois. Si une ligne écartée appartient à un mois remplacé (ou si son mois est illisible), rien n\'est importé : corrigez-la, ou cochez « Importer quand même » (la ligne manquera alors dans ce mois).'],
    ['•', 'Aléa', 'Déduit de l\'activité : « cyclone » → cyclone ; « sécheresse » / « drought » → sécheresse ; sinon « autre ».'],
    ['•', 'Formules', 'Les colonnes calculées (ex. Total vivres) sont lues via leur résultat : enregistrez le fichier dans Excel avant l\'import. Une formule sans résultat enregistré écarte la ligne (« formule non calculée »).'],
    [],
    ['Col.', 'En-tête', 'Contenu attendu'],
    ...Object.keys(COLUMNS).map(Number).sort((a, b) => a - b).map((c) => [colLetter(c), COLUMNS[c][0] + (COLUMNS[c][2] ? ' *' : ''), COLUMNS[c][1]]),
    [],
    ['', '* obligatoire', ''],
  ];
  lines.forEach((l, i) => {
    const row = ws.getRow(i + 1);
    l.forEach((v, j) => { row.getCell(j + 1).value = v; });
    row.getCell(3).alignment = { wrapText: true, vertical: 'top' };
  });
  ws.getCell('A1').font = { bold: true, size: 13 };
  ws.getRow(lines.findIndex((l) => l[0] === 'Col.') + 1).font = { bold: true };
}

module.exports = { buildPddTemplate, MONTH_NAMES };
