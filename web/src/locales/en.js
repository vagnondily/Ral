/**
 * Dictionnaire anglais par PHRASE française (référence). Un module = un
 * fichier dans ./en/ ; ce fichier les agrège. Une phrase absente reste en
 * français (repli sûr). Garder les variables {nom} identiques à la source.
 */
import common from './en/common.js';
import localities from './en/localities.js';

export default {
  ...common,
  ...localities,
};
