// Dictionnaire anglais — module « pdd » (clé = phrase française exacte).
// Distribution d'urgence : distributions, synthèse, pipeline (PddPage).
export default {
  // Aléas (HAZARD) et colonnes / filtres de la table des distributions
  'Aléa': 'Hazard',
  'Aléas': 'Hazards',
  'Sécheresse': 'Drought',
  'Cyclone': 'Cyclone',
  'Autre': 'Other',
  'Antenne': 'Antenna',
  'Sous-bureau': 'Sub-office',
  'Corridor': 'Corridor',
  'Modalité': 'Modality',
  'Bénéficiaires': 'Beneficiaries',
  'Ménages': 'Households',
  'Vivres': 'Food',
  'Vivres (t)': 'Food (t)',
  'Cash ($)': 'Cash ($)',
  'Cash (CBT)': 'Cash (CBT)',
  'Lignes': 'Rows',
  'Commune, district, activité…': 'Commune, district, activity…',
  'Tous les mois': 'All months',
  'Tous les aléas': 'All hazards',
  'Toutes les régions': 'All regions',
  'Tous les districts': 'All districts',
  'Toutes': 'All',

  // Distributions
  "Distribution d'urgence — distributions": 'Emergency distribution — distributions',
  'Choisissez un mois pour ouvrir son plan de distribution (vivres & cash par zone et activité).': 'Select a month to open its distribution plan (food & cash by area and activity).',
  'Plan de distribution du mois : table fidèle au classeur, filtrable et exportable.': 'Monthly distribution plan: table matching the workbook, filterable and exportable.',
  "Classeur vierge au format exact de l'import (feuille « PDD base » + feuille « Lisez-moi » qui décrit chaque colonne).":
    'Blank workbook in the exact import format (“PDD base” sheet + “Lisez-moi” read-me sheet describing each column).',
  'Modèle PDD': 'PDD template',
  'Importe le tableau PDD (feuille « PDD base » du modèle ou tableau du classeur réel) : mois, zone, activité, bénéficiaires, tonnages. Les lignes ignorées sont listées avec leur motif. Réimport idempotent (les mois du fichier sont remplacés).':
    'Imports the PDD table (“PDD base” sheet of the template or the table of the actual workbook): month, area, activity, beneficiaries, tonnages. Skipped rows are listed with their reason. Idempotent re-import (the months in the file are replaced).',
  'Importer le PDD': 'Import PDD',
  '{n} distribution(s) · {items} tonnage(s) importé(s) (feuille « {sheet} »)':
    '{n} distribution(s) · {items} tonnage line(s) imported (sheet “{sheet}”)',
  '{skipped} ligne(s) ignorée(s)': '{skipped} row(s) skipped',
  '{n} avertissement(s)': '{n} warning(s)',
  // Résumé d'import (lignes ignorées avec leur motif, avertissements)
  "Résumé de l'import": 'Import summary',
  'Feuille « {sheet} », lignes {from} à {to}': 'Sheet “{sheet}”, rows {from} to {to}',
  'Feuille « {sheet} »': 'Sheet “{sheet}”',
  'Fermer le résumé': 'Close the summary',
  'Distributions importées': 'Distributions imported',
  'Tonnages': 'Tonnage lines',
  'Lignes denrée × distribution': 'Commodity × distribution lines',
  'Lignes ignorées': 'Skipped rows',
  'Mois remplacés': 'Months replaced',
  'Toutes les lignes du tableau ont été importées.': 'All rows in the table were imported.',
  'Colonnes à corriger': 'Columns to fix',
  'Les colonnes doivent rester à leur place (voir le modèle PDD).': 'Columns must stay in their positions (see the PDD template).',
  'Corrigez ces lignes dans le fichier puis réimportez-le : les mois du fichier sont remplacés.':
    'Fix these rows in the file, then re-import it: the months in the file are replaced.',
  'Avertissements': 'Warnings',
  'Ligne': 'Row',
  'Motif': 'Reason',
  'Seules les {n} premières sont affichées.': 'Only the first {n} are shown.',
  // Import partiel (« tout ou rien » par défaut)
  'Import partiel : {n} ligne(s) ignorée(s) manquent dans les mois remplacés. Corrigez-les puis réimportez le fichier pour les ajouter.':
    'Partial import: {n} skipped row(s) are missing from the replaced months. Fix them, then re-import the file to add them.',
  'Importer quand même : les lignes ignorées manqueront dans les mois remplacés':
    'Import anyway: the skipped rows will be missing from the replaced months',
  'Importer les lignes valides': 'Import the valid rows',
  'Mois remplacé ({month})': 'Replaced month ({month})',
  'Mois illisible': 'Unreadable month',

  // Motifs renvoyés par le serveur (pddImport.js, MESSAGES) : { code, params, template }
  'erreur Excel {error} en colonne {col} ({label})': 'Excel error {error} in column {col} ({label})',
  'formule non calculée en colonne {col} ({label}) : ouvrez et enregistrez le fichier dans Excel':
    'formula not calculated in column {col} ({label}): open and save the file in Excel',
  'valeur non numérique « {value} » en colonne {col} ({label})': 'non-numeric value “{value}” in column {col} ({label})',
  'nombre ambigu « {value} » en colonne {col} ({label}) : séparateur de milliers ou décimal ? Saisissez un nombre Excel':
    'ambiguous number “{value}” in column {col} ({label}): thousands or decimal separator? Enter it as an Excel number',
  'valeur négative ({value}) en colonne {col} ({label})': 'negative value ({value}) in column {col} ({label})',
  'valeur hors limites ({value}) en colonne {col} ({label})': 'value out of range ({value}) in column {col} ({label})',
  'mois absent': 'month missing',
  'mois inconnu « {value} »': 'unknown month “{value}”',
  'mois invalide « {value} » (date hors des années 2000 à 2100)': 'invalid month “{value}” (date outside the years 2000 to 2100)',
  'année absente': 'year missing',
  'année invalide « {value} » (attendu : 4 chiffres entre 2000 et 2100, ex. 2026)':
    'invalid year “{value}” (expected: 4 digits between 2000 and 2100, e.g. 2026)',
  'année incohérente ({year} en colonne {col} ({label}), {monthYear} dans le mois)':
    'inconsistent year ({year} in column {col} ({label}), {monthYear} in the month)',
  'activité absente (colonne {col} ou {col2})': 'activity missing (column {col} or {col2})',
  'zone absente (district et commune vides)': 'area missing (district and commune empty)',
  'modalité inconnue « {value} » (attendu : {expected} — ou Vivres, Cash)': 'unknown modality “{value}” (expected: {expected} — or Vivres, Cash)',
  'ligne hors du tableau Excel « {table} » : étendez le tableau': 'row outside the Excel table “{table}”: extend the table',
  '{n} ligne(s) sans mois, activité ni zone portent des erreurs Excel ({errors}) : non importées (lignes {from} à {to})':
    '{n} row(s) without month, activity or area contain Excel errors ({errors}): not imported (rows {from} to {to})',
  'colonne {col} : en-tête « {found} » au lieu de « {label} »': 'column {col}: header “{found}” instead of “{label}”',
  'colonne {col} : en-tête vide au lieu de « {label} »': 'column {col}: empty header instead of “{label}”',
  'colonne {col} : « {found} » est un montant en ariary, cette colonne doit contenir le cash en USD':
    'column {col}: “{found}” is an amount in ariary, this column must contain cash in USD',
  'Fichier vide.': 'Empty file.',
  "Ce fichier n'est pas un classeur Excel .xlsx (format reconnu : {format}) : enregistrez le plan de distribution au format .xlsx puis réessayez.":
    'This file is not an Excel .xlsx workbook (detected format: {format}): save the distribution plan as .xlsx and try again.',
  'Fichier illisible : fournissez un .xlsx du plan de distribution.': 'Unreadable file: provide an .xlsx of the distribution plan.',
  "Aucun tableau PDD détecté : il faut une ligne d'en-tête avec « Mois » en colonne A et « Commune » en colonne P (feuille « PDD base » du modèle).":
    'No PDD table found: a header row with “Mois” in column A and “Commune” in column P is required (“PDD base” sheet of the template).',
  "La feuille « {sheet} » n'a pas la disposition attendue (colonne insérée ou supprimée ?) : rien n'a été importé.":
    'Sheet “{sheet}” does not have the expected layout (column inserted or deleted?): nothing was imported.',
  "La feuille « {sheet} » compte {count} lignes remplies sous l'en-tête, au-delà du plafond de {limit} : découpez le fichier (par exemple par trimestre) puis importez chaque partie. Rien n'a été importé.":
    'Sheet “{sheet}” has {count} filled rows below the header, above the limit of {limit}: split the file (e.g. by quarter) and import each part. Nothing was imported.',
  "Aucune ligne exploitable (mois, année, activité et zone requis) : {skipped} ligne(s) ignorée(s), rien n'a été importé.":
    'No usable rows (month, year, activity and area required): {skipped} row(s) skipped, nothing was imported.',
  "{blocking} ligne(s) ignorée(s) concernent un mois que cet import remplacerait, ou un mois illisible : rien n'a été importé, pour ne pas effacer de distributions. Corrigez ces lignes et réimportez, ou cochez « Importer quand même ».":
    '{blocking} skipped row(s) belong to a month this import would replace, or to an unreadable month: nothing was imported, so that no distributions are erased. Fix these rows and re-import, or tick “Import anyway”.',

  // Libellés de colonnes cités dans les motifs (paramètre `label`)
  'Total vivres': 'Total food',
  'Cash USD': 'Cash USD',
  'WBS': 'WBS',
  'Riz': 'Rice',
  'Mais concassé': 'Crushed maize',
  'Mais en grain': 'Whole maize',
  'Sorgho': 'Sorghum',
  'LS': 'LS',
  'Huile': 'Oil',
  'MNP': 'MNP',
  'P Sup': 'P Sup',
  'CSB+': 'CSB+',
  'CSB++': 'CSB++',
  'P Doz': 'P Doz',
  'LNS-sq': 'LNS-sq',
  'Dattes': 'Dates',
  'HEB': 'HEB',
  '— plan de distribution du mois': '— monthly distribution plan',
  'Distributions du mois': 'Distributions this month',
  'Toutes modalités': 'All modalities',
  'Tonnage du mois': 'Tonnage this month',
  'Transferts monétaires': 'Cash-based transfers',
  'Aucune distribution ce mois-ci': 'No distributions this month',
  'Importez un fichier PDD (.xlsx) pour alimenter le module.': 'Import a PDD file (.xlsx) to populate the module.',
  'Aucune distribution importée pour ce mois.': 'No distributions imported for this month.',
  'Zones (région/district/commune), bureaux (antenne/sous-bureau) et partenaires sont les mêmes référentiels que le reste de MEMS.':
    'Areas (region/district/commune), offices (antenna/sub-office) and partners use the same reference data as the rest of MEMS.',
  'Voir la {synthese} et le {pipeline}.': 'See the {synthese} and the {pipeline}.',
  'Synthèse': 'Summary',
  'Pipeline': 'Pipeline',

  // Tableau des mois
  'Aucune distribution': 'No distributions',
  '1 · Télécharger le modèle': '1 · Download the template',
  '2 · Importer le fichier rempli': '2 · Import the completed file',
  "Le plan de distribution s'alimente depuis un classeur Excel (feuille « PDD base » : une ligne par distribution — mois, zone, activité, bénéficiaires, tonnage par denrée, cash). Le modèle contient les colonnes à leur place exacte, des listes de contrôle à la saisie et une feuille « Lisez-moi » qui décrit chaque colonne. Réimporter un mois remplace ses distributions.":
    'The distribution plan is fed from an Excel workbook (“PDD base” sheet: one row per distribution — month, area, activity, beneficiaries, tonnage per commodity, cash). The template has the columns in their exact positions, validation lists at data entry and a “Lisez-moi” read-me sheet describing each column. Re-importing a month replaces its distributions.',
  'Plan de distribution — par mois': 'Distribution plan — by month',
  'mois': 'month(s)',
  'bénéficiaires': 'beneficiaries',
  'vivres': 'food',
  'Part bénéficiaires': 'Beneficiary share',
  'Action': 'Action',
  'Ouvrir {month}': 'Open {month}',
  'Ouvrir': 'Open',
  'Cliquez un mois (ou « Ouvrir ») pour accéder à ses distributions détaillées.': 'Click a month (or “Open”) to view its detailed distributions.',

  // Synthèse
  "Distribution d'urgence — synthèse": 'Emergency distribution — summary',
  'Totaux recalculés en direct : par aléa, par mois, par zone (région → district → commune) et par denrée.':
    'Totals recomputed live: by hazard, by month, by area (region → district → commune) and by commodity.',
  'Distributions': 'Distributions',
  'Toutes zones': 'All areas',
  'Tonnage total': 'Total tonnage',
  'Par aléa': 'By hazard',
  'Réponse par type de choc.': 'Response by type of shock.',
  'Par mois': 'By month',
  'Échelonnement de la réponse dans le temps.': 'Phasing of the response over time.',
  'Par zone': 'By area',
  'Région → district → commune. Cliquez pour déplier.': 'Region → district → commune. Click to expand.',
  'Zone': 'Area',
  'Par denrée': 'By commodity',
  'Tonnage total planifié par produit.': 'Total planned tonnage per commodity.',
  'Denrée': 'Commodity',
  'Tonnage (t)': 'Tonnage (t)',
  'Part': 'Share',
  'Aucune denrée': 'No commodities',
  "Les tonnages apparaissent dès qu'un PDD est importé.": 'Tonnages appear as soon as a PDD is imported.',

  // Pipeline
  "Choisissez d'abord un mois pour saisir le stock.": 'Select a month first to enter stock.',
  'Stock « {commodity} » enregistré.': 'Stock “{commodity}” saved.',
  "Distribution d'urgence — pipeline": 'Emergency distribution — pipeline',
  'Besoin planifié (tonnages du PDD) confronté au stock disponible, par denrée : écart, couverture et ruptures.':
    'Planned requirement (PDD tonnages) compared with available stock, by commodity: gap, coverage and shortfalls.',
  'Besoin total': 'Total requirement',
  'Tonnage planifié': 'Planned tonnage',
  'Stock disponible': 'Available stock',
  'Saisi': 'Entered',
  'Couverture': 'Coverage',
  'Dispo / besoin': 'Available / requirement',
  'Ruptures': 'Shortfalls',
  'Denrées en déficit': 'Commodities in deficit',
  'Pipeline par denrée': 'Pipeline by commodity',
  "Saisissez le stock disponible et le donateur pour calculer l'écart.": 'Enter the available stock and the donor to compute the gap.',
  'Lecture seule.': 'Read-only.',
  'Aucun besoin': 'No requirements',
  'Importez un PDD (onglet Distributions) pour alimenter le pipeline.': 'Import a PDD (Distributions tab) to populate the pipeline.',
  'Besoin (t)': 'Requirement (t)',
  'Disponible (t)': 'Available (t)',
  'Écart (t)': 'Gap (t)',
  'Donateur': 'Donor',
  'Stock {commodity}': '{commodity} stock',
  'Donateur {commodity}': '{commodity} donor',
  'Rupture': 'Shortfall',
  'Couvert': 'Covered',
  'Le stock se saisit par mois. Choisissez un mois ci-dessus pour enregistrer les quantités disponibles et leur donateur.':
    'Stock is entered per month. Select a month above to record the available quantities and their donor.',
  'stock au {m}': 'stock as of {m}',
};
