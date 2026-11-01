/**
 * Clé normalisée d'un libellé d'activité de programme — jumelle EXACTE de
 * server/src/modules/programmes/activityKey.js et de la fonction SQL mems_activity_key
 * (migration 105) : accents retirés (même table), minuscules, tout ce qui n'est pas [a-z0-9]
 * supprimé. Parité testée (server/test/webActivities.test.js). Module pur, sans import.
 */
export const ACCENTS_FROM = 'ÀÁÂÃÄÅàáâãäåÇçÈÉÊËèéêëÌÍÎÏìíîïÑñÒÓÔÕÖòóôõöÙÚÛÜùúûüÝýÿ';
export const ACCENTS_TO = 'AAAAAAaaaaaaCcEEEEeeeeIIIIiiiiNnOOOOOoooooUUUUuuuuYyy';
const TO = [...ACCENTS_TO];
const TRANSLATE = new Map([...ACCENTS_FROM].map((ch, i) => [ch, TO[i]]));

/** « Distribution générale » → « distributiongenerale ». */
export function activityKey(s) {
  let out = '';
  for (const ch of String(s == null ? '' : s)) out += TRANSLATE.has(ch) ? TRANSLATE.get(ch) : ch;
  return out.toLowerCase().replace(/[^a-z0-9]+/g, '');
}
