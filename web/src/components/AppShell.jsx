import React, { useEffect, useState } from 'react';
import {
  FileSignature, Handshake, ClipboardCheck,
  LayoutDashboard, ChartColumn, Bell, Settings, Menu, ChevronRight, PanelLeftClose, PanelLeftOpen,
} from 'lucide-react';
import { IconButton } from './ui.jsx';
import { LogoMark } from './Logo.jsx';
import { NotificationsMenu, UserMenu } from './HeaderMenus.jsx';
import { useI18n } from '../lib/i18n.jsx';

const SIDEBAR_KEY = 'mems.sidebar';

/**
 * Navigation : barre latérale à gauche (modules › sous-modules), et une
 * entête avec cloche de notifications + menu du compte (langue, thème,
 * paramétrage, déconnexion). Les modules non livrés sont grisés.
 */
export const NAV = [
  {
    group: 'Contractualisation',
    items: [
      { id: 'contrats', label: 'Contrats', icon: FileSignature, subs: [{ id: 'liste', label: 'Liste des contrats' }] },
    ],
  },
  {
    group: 'Suivi & évaluation',
    items: [
      {
        id: 'tpm', label: 'Partenaires & TPM', icon: Handshake,
        subs: [
          { id: 'prestataires', label: 'Prestataires TPM' },
          { id: 'formations', label: 'Formations' },
          { id: 'evaluation', label: 'Évaluation' },
          { id: 'affectation', label: 'Affectation & calendrier' },
          { id: 'budget', label: 'Planification & budget' },
          { id: 'rapports', label: 'Rapports & dépenses' },
        ],
      },
      {
        id: 'processus', label: 'Suivi de processus', icon: ClipboardCheck,
        subs: [
          { id: 'synthese', label: 'Tableau de bord' },
          { id: 'donnees', label: 'Données & indicateurs' },
          { id: 'sites', label: 'Sites & visites' },
          { id: 'rbm', label: 'Risk-Based Monitoring' },
          { id: 'couverture', label: 'Récap de couverture' },
          { id: 'carte', label: 'Carte des sites' },
        ],
      },
    ],
  },
  {
    group: 'Pilotage',
    items: [
      {
        id: 'dashboard', label: 'Dashboard décisionnel', icon: LayoutDashboard,
        subs: [
          { id: 'apercu', label: "Vue d'ensemble" },
          { id: 'consolidation', label: 'Suivi budgétaire consolidé' },
        ],
      },
      { id: 'reporting', label: 'Reporting', icon: ChartColumn, subs: [{ id: 'synthese', label: 'Rapport de synthèse' }] },
      { id: 'alertes', label: 'Alertes', icon: Bell, subs: [{ id: 'centre', label: "Centre d'alertes" }] },
    ],
  },
  {
    group: 'Administration',
    items: [
      {
        id: 'parametrage', label: 'Paramétrage', icon: Settings,
        subs: [
          { id: 'apercu', label: "Vue d'ensemble" },
          { heading: 'Référentiels' },
          { id: 'partenaires', label: 'Partenaires' },
          { id: 'types', label: 'Types de partenaire' },
          { id: 'activites', label: 'Activités' },
          { heading: 'Finances' },
          { id: 'taux', label: 'Taux de change' },
          { heading: 'Géographie' },
          { id: 'localites', label: 'Localités' },
          { id: 'bureaux', label: 'Bureaux & antennes' },
          { heading: 'Suivi' },
          { id: 'mmr', label: 'Paramètres MMR' },
          { heading: 'Sécurité' },
          { id: 'utilisateurs', label: 'Utilisateurs & accès' },
        ],
      },
    ],
  },
];

export function findRoute(moduleId, subId) {
  for (const g of NAV) {
    const mod = g.items.find((i) => i.id === moduleId);
    const sub = mod?.subs?.find((s) => s.id === subId);
    // « soon » sub-modules are placeholders with no page — a deep link to one
    // falls back to the default route rather than showing a blank page.
    if (mod && sub && !sub.soon) return { mod, sub };
  }
  return null;
}

export default function AppShell({ user, route, onNavigate, onLogout, children }) {
  const [navOpen, setNavOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem(SIDEBAR_KEY) === 'collapsed'; } catch { return false; }
  });
  const { t } = useI18n();
  const current = findRoute(route.module, route.sub);

  useEffect(() => setNavOpen(false), [route.module, route.sub]);
  useEffect(() => {
    try { localStorage.setItem(SIDEBAR_KEY, collapsed ? 'collapsed' : 'expanded'); } catch { /* ignore */ }
  }, [collapsed]);

  return (
    <div className={`shell ${navOpen ? 'nav-open' : ''} ${collapsed ? 'is-collapsed' : ''}`}>
      <aside className="sidebar" aria-label="Navigation principale">
        <div className="brand">
          <LogoMark size={34} />
          <div className="brand-text">
            <div className="brand-name">MEMS 2.0</div>
            <div className="brand-sub">Suivi &amp; évaluation</div>
          </div>
          <IconButton
            icon={collapsed ? PanelLeftOpen : PanelLeftClose}
            label={collapsed ? t('shell.expandMenu', 'Agrandir le menu') : t('shell.collapseMenu', 'Réduire le menu')}
            size="sm"
            className="collapse-toggle"
            onClick={() => setCollapsed((c) => !c)}
          />
        </div>

        <nav className="nav">
          {NAV.map((g) => (
            <div className="nav-group" key={g.group}>
              <div className="nav-group-label">{t(`nav.group.${g.group}`, g.group)}</div>
              {g.items.map((item) => {
                const Icon = item.icon;
                const available = Boolean(item.subs);
                const open = route.module === item.id;
                // Land on the first real sub-module (skip headings and « soon » placeholders).
                const firstSub = available ? (item.subs.find((s) => s.id && !s.soon) || item.subs.find((s) => s.id)) : null;
                return (
                  <div key={item.id}>
                    <button
                      type="button"
                      className={`nav-item ${open ? 'is-open' : ''}`}
                      disabled={!available}
                      title={available ? t(`nav.${item.id}`, item.label) : t('shell.comingSoon', 'Bientôt disponible')}
                      aria-expanded={available ? open : undefined}
                      onClick={() => available && onNavigate(item.id, firstSub.id)}
                    >
                      <Icon size={18} aria-hidden="true" />
                      <span className="nav-label">{t(`nav.${item.id}`, item.label)}</span>
                      {!available && <span className="sr-only"> ({t('shell.comingSoon', 'bientôt disponible')})</span>}
                    </button>
                    {available && open && (
                      <div className="nav-sub">
                        {item.subs.map((s, idx) => (
                          s.heading ? (
                            <div key={`h${idx}`} className="nav-subgroup">{t(`nav.${item.id}.group.${s.heading}`, s.heading)}</div>
                          ) : (
                            <button
                              key={s.id}
                              type="button"
                              className={`nav-subitem ${route.sub === s.id ? 'is-active' : ''}`}
                              disabled={s.soon}
                              title={s.soon ? t('shell.comingSoon', 'Bientôt disponible') : undefined}
                              aria-current={route.sub === s.id ? 'page' : undefined}
                              onClick={() => !s.soon && onNavigate(item.id, s.id)}
                            >
                              {t(`nav.${item.id}.${s.id}`, s.label)}
                              {s.soon && <span className="sr-only"> ({t('shell.comingSoon', 'bientôt disponible')})</span>}
                            </button>
                          )
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="sidebar-foot">
          <span className="soon-dot" aria-hidden="true" /> {t('shell.soon', 'Modules grisés : à venir')}
        </div>
      </aside>

      {navOpen && <div className="nav-backdrop" onClick={() => setNavOpen(false)} aria-hidden="true" />}

      <div className="main">
        <header className="header">
          <IconButton icon={Menu} label={t('shell.openMenu', 'Ouvrir le menu')} className="menu-toggle" onClick={() => setNavOpen(true)} />
          <nav className="breadcrumb" aria-label="Fil d'Ariane">
            <span>{current ? t(`nav.${current.mod.id}`, current.mod.label) : ''}</span>
            <ChevronRight size={14} aria-hidden="true" />
            <strong>{current ? t(`nav.${current.mod.id}.${current.sub.id}`, current.sub.label) : ''}</strong>
          </nav>
          <div className="header-right">
            <div className="header-tools">
              <NotificationsMenu />
              <UserMenu user={user} onLogout={onLogout} onSettings={() => onNavigate('parametrage', 'partenaires')} />
            </div>
          </div>
        </header>

        <main className="page" id="contenu">{children}</main>
      </div>
    </div>
  );
}
