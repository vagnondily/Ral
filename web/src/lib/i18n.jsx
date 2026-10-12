// Lightweight i18n. French is the reference language (and the fallback for any
// missing key), English is offered via the user menu. Translation is applied to
// the application chrome (navigation, header, user menu, login) and extends into
// the feature modules progressively, module by module.
import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import EN_PHRASES from '../locales/en.js';
import { setFormatLocale } from './format.js';

const KEY = 'mems.lang';
export const LANGS = [
  { id: 'fr', label: 'Français', short: 'FR' },
  { id: 'en', label: 'English', short: 'EN' },
];

// Clés techniques du « chrome » (navigation, en-tête, menu). Le contenu des
// pages utilise tr(phrase) et les dictionnaires de src/locales/.
const DICT = {
  en: {
    // nav groups
    'nav.group.Contractualisation': 'Contracting',
    'nav.group.Suivi & évaluation': 'Monitoring & evaluation',
    'nav.group.Pilotage': 'Steering',
    'nav.group.Administration': 'Administration',
    // modules / subs
    'nav.contrats': 'Contracts',
    'nav.contrats.liste': 'Contract list',
    'nav.tpm': 'Partners & TPM',
    'nav.tpm.prestataires': 'TPM providers',
    'nav.tpm.affectation': 'Assignment & calendar',
    'nav.tpm.formations': 'Trainings',
    'nav.tpm.evaluation': 'Evaluation',
    'nav.tpm.rapports': 'Reports & expenses',
    'nav.tpm.budget': 'Planning & budget',
    'nav.processus': 'Process monitoring',
    'nav.processus.synthese': 'Dashboard',
    'nav.processus.donnees': 'Data & indicators',
    'nav.processus.sites': 'Assignment & visits',
    'nav.processus.rbm': 'Risk-Based Monitoring',
    'nav.processus.carte': 'Site map',
    'nav.dashboard.apercu': 'Overview',
    'nav.dashboard.consolidation': 'Consolidated budget tracking',
    'nav.dashboard': 'Decision dashboard',
    'nav.reporting': 'Reporting',
    'nav.reporting.synthese': 'Synthesis report',
    'nav.alertes': 'Alerts',
    'nav.alertes.centre': 'Alert center',
    'nav.parametrage': 'Settings',
    'nav.parametrage.apercu': 'Overview',
    'nav.parametrage.mmr': 'MMR parameters',
    'nav.parametrage.utilisateurs': 'Users & access',
    'nav.parametrage.taux': 'Exchange rates',
    'nav.parametrage.bureaux': 'Offices & antennas',
    'nav.parametrage.partenaires': 'Partners',
    'nav.parametrage.activites': 'Activities',
    'nav.parametrage.types': 'Partner types',
    'nav.parametrage.localites': 'Localities',
    // shell
    'shell.soon': 'Greyed modules: coming soon',
    'shell.module': 'MEMS 2.0 · module 1 of 12',
    'shell.openMenu': 'Open menu',
    'shell.collapseMenu': 'Collapse menu',
    'shell.expandMenu': 'Expand menu',
    'shell.comingSoon': 'Soon',
    'nav.more': 'More',
    'nav.upcoming': 'Upcoming modules',
    // header / user menu
    'header.notifications': 'Notifications',
    'header.noNotifications': 'No new notifications',
    'user.account': 'Account',
    'user.language': 'Language',
    'user.theme': 'Theme',
    'user.theme.light': 'Light mode',
    'user.theme.dark': 'Dark mode',
    'user.preferences': 'Preferences',
    'user.tips.show': 'Show tips',
    'user.tips.hide': 'Hide tips',
    'user.settings': 'Settings',
    'user.logout': 'Sign out',
    // roles
    'role.admin': 'Administrator',
    'role.manager': 'Monitoring manager',
    'role.viewer': 'Read-only',
    // Priorité de suivi RBM (« Moyenne » seul est déjà la moyenne statistique).
    'priority.Haute': 'High',
    'priority.Moyenne': 'Medium',
    'priority.Basse': 'Low',
  },
};

// Interpolation « {nom} » → vars.nom (nombres formatés selon la langue).
export function interpolate(text, vars, lang = 'fr') {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (m, k) => {
    const v = vars[k];
    if (v == null) return m;
    return typeof v === 'number' ? v.toLocaleString(lang === 'en' ? 'en-US' : 'fr-FR') : String(v);
  });
}

/**
 * Traduction par PHRASE française (référence) : tr('Répertoire des localités'),
 * tr('{n} localité(s)', { n }). Les dictionnaires anglais sont rangés par module
 * dans src/locales/en.js ; une phrase absente reste en français.
 */
export function translatePhrase(lang, text, vars) {
  if (lang === 'en' && EN_PHRASES[text] === undefined && import.meta.env.DEV) reportMissing(text);
  const base = lang === 'en' ? (EN_PHRASES[text] ?? text) : text;
  return interpolate(base, vars, lang);
}

// En développement : phrases demandées sans traduction anglaise, exposées sur
// window.__memsMissingTr (balayage Playwright de contrôle de complétude).
function reportMissing(text) {
  if (typeof window === 'undefined' || !/[A-Za-zÀ-ÿ]/.test(text)) return;
  (window.__memsMissingTr ||= new Set()).add(text);
}

const I18nContext = createContext({ lang: 'fr', t: (k, fb) => fb ?? k, tr: (s, v) => interpolate(s, v), setLang: () => {} });

function storedLang() {
  let lang = 'fr';
  try {
    const v = localStorage.getItem(KEY);
    if (LANGS.some((l) => l.id === v)) lang = v;
  } catch { /* ignore */ }
  setFormatLocale(lang);
  return lang;
}

export function I18nProvider({ children }) {
  const [lang, setLangState] = useState(storedLang);
  // Langue du document dès le chargement (lecteurs d'écran, formats, API du concepteur de rapport).
  useEffect(() => { document.documentElement.setAttribute('lang', lang); }, [lang]);
  const setLang = useCallback((l) => {
    setFormatLocale(l); // formats (nombres, mois, dates) avant le nouveau rendu
    setLangState(l);
    try { localStorage.setItem(KEY, l); } catch { /* ignore */ }
    document.documentElement.setAttribute('lang', l);
  }, []);
  // fb = French fallback text passed by the caller; returned as-is when the
  // active language has no entry (so untranslated pages stay in French).
  const t = useCallback((key, fb) => {
    if (lang === 'fr') return fb ?? key;
    return DICT[lang]?.[key] ?? fb ?? key;
  }, [lang]);
  const tr = useCallback((text, vars) => translatePhrase(lang, text, vars), [lang]);
  return <I18nContext.Provider value={{ lang, t, tr, setLang }}>{children}</I18nContext.Provider>;
}

export function useI18n() { return useContext(I18nContext); }
