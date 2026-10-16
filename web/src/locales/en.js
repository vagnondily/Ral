/**
 * Dictionnaire anglais par PHRASE française (référence). Un module = un
 * fichier dans ./en/ ; ce fichier les agrège. Une phrase absente reste en
 * français (repli sûr). Garder les variables {nom} identiques à la source.
 * Voir docs/I18N.md.
 */
import common from './en/common.js';
import shell from './en/shell.js';
import contracts from './en/contracts.js';
import tpmReports from './en/tpmReports.js';
import tpmPlanning from './en/tpmPlanning.js';
import monitoring from './en/monitoring.js';
import field from './en/field.js';
import dashboard from './en/dashboard.js';
import settings from './en/settings.js';
import pdd from './en/pdd.js';
import localities from './en/localities.js';
import reports from './en/reports.js';
import planBoard from './en/planBoard.js';
import calc from './en/calc.js';
import importWizard from './en/importWizard.js';
import correspondences from './en/correspondences.js';
import indicatorEditor from './en/indicatorEditor.js';
import dashboards from './en/dashboards.js';
import sites from './en/sites.js';
import deletions from './en/deletions.js';
import activityCoverage from './en/activityCoverage.js';
import period from './en/period.js';
import map from './en/map.js';
import partners from './en/partners.js';
import activation from './en/activation.js';
import reportLayout from './en/reportLayout.js';
import tpmAttribution from './en/tpmAttribution.js';
import coverageDefs from './en/coverageDefs.js';

export default {
  // partners en tête : ses phrases déjà traduites ailleurs gardent la traduction de leur module.
  ...partners, ...common, ...shell, ...contracts, ...tpmReports, ...tpmPlanning, ...monitoring,
  ...field, ...dashboard, ...settings, ...pdd, ...localities, ...reports, ...planBoard, ...calc, ...importWizard, ...correspondences,
  ...indicatorEditor, ...dashboards, ...sites, ...deletions, ...activityCoverage, ...period, ...map, ...activation, ...reportLayout,
  ...tpmAttribution, ...coverageDefs,
};
