// Lightweight i18n. French is the reference language (and the fallback for any
// missing key), English is offered via the user menu. Translation is applied to
// the application chrome (navigation, header, user menu, login) and extends into
// the feature modules progressively, module by module.
import React, { createContext, useContext, useState, useCallback } from 'react';

const KEY = 'mems.lang';
export const LANGS = [
  { id: 'fr', label: 'Français', short: 'FR' },
  { id: 'en', label: 'English', short: 'EN' },
];

// Only the chrome is translated for now; feature pages fall back to French.
const DICT = {
  en: {
    // nav groups
    'nav.group.Contractualisation': 'Contracting',
    'nav.group.Suivi & planification': 'Monitoring & planning',
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
    'nav.planification': 'Planning & budget',
    'nav.carte': 'Site map',
    'nav.rbm': 'Risk-Based Monitoring',
    'nav.sites': 'Monitored sites',
    'nav.processus': 'Process monitoring',
    'nav.planning': 'Planning',
    'nav.dashboard': 'Decision dashboard',
    'nav.reporting': 'Reporting',
    'nav.alertes': 'Alerts',
    'nav.parametrage': 'Settings',
    'nav.parametrage.partenaires': 'Partners',
    'nav.parametrage.activites': 'Activities',
    'nav.parametrage.types': 'Partner types',
    'nav.parametrage.localites': 'Localities',
    // shell
    'shell.soon': 'Greyed modules: coming soon',
    'shell.module': 'MEMS 2.0 · module 1 of 12',
    'shell.openMenu': 'Open menu',
    'shell.comingSoon': 'Soon',
    'nav.more': 'More',
    'nav.upcoming': 'Upcoming modules',
    // header / user menu
    'header.notifications': 'Notifications',
    'header.noNotifications': 'No new notifications',
    'user.account': 'Account',
    'user.language': 'Language',
    'user.theme': 'Theme',
    'user.theme.light': 'Light',
    'user.theme.dark': 'Dark',
    'user.settings': 'Settings',
    'user.logout': 'Sign out',
    // roles
    'role.admin': 'Administrator',
    'role.manager': 'Validator',
    'role.viewer': 'Viewer',
  },
};

const I18nContext = createContext({ lang: 'fr', t: (k, fb) => fb ?? k, setLang: () => {} });

function storedLang() {
  try {
    const v = localStorage.getItem(KEY);
    if (LANGS.some((l) => l.id === v)) return v;
  } catch { /* ignore */ }
  return 'fr';
}

export function I18nProvider({ children }) {
  const [lang, setLangState] = useState(storedLang);
  const setLang = useCallback((l) => {
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
  return <I18nContext.Provider value={{ lang, t, setLang }}>{children}</I18nContext.Provider>;
}

export function useI18n() { return useContext(I18nContext); }
