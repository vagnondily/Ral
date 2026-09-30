import React, { useEffect, useState } from 'react';
import {
  FileSignature, Handshake, Wallet, Map, ShieldAlert, MapPin, ClipboardCheck, CalendarDays,
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
    group: 'Suivi & planification',
    items: [
      {
        id: 'tpm', label: 'Partenaires & TPM', icon: Handshake,
        subs: [
          { id: 'prestataires', label: 'Prestataires TPM' },
          { id: 'formations', label: 'Formations' },
          { id: 'evaluation', label: 'Évaluation' },
          { id: 'affectation', label: 'Affectation & calendrier' },
          { id: 'rapports', label: 'Rapports & dépenses' },
        ],
      },
      { id: 'planification', label: 'Planification & budget', icon: Wallet },
      { id: 'carte', label: 'Carte des sites', icon: Map },
      { id: 'rbm', label: 'Risk-Based Monitoring', icon: ShieldAlert },
      { id: 'sites', label: 'Sites suivis', icon: MapPin },
      { id: 'processus', label: 'Suivi de processus', icon: ClipboardCheck },
      { id: 'planning', label: 'Planning', icon: CalendarDays },
    ],
  },
  {
    group: 'Pilotage',
    items: [
      { id: 'dashboard', label: 'Dashboard décisionnel', icon: LayoutDashboard },
      { id: 'reporting', label: 'Reporting', icon: ChartColumn },
      { id: 'alertes', label: 'Alertes', icon: Bell },
    ],
  },
  {
    group: 'Administration',
    items: [
      {
        id: 'parametrage', label: 'Paramétrage', icon: Settings,
        subs: [
          { id: 'partenaires', label: 'Partenaires' },
          { id: 'activites', label: 'Activités' },
          { id: 'types', label: 'Types de partenaire' },
          { id: 'localites', label: 'Localités' },
        ],
      },
    ],
  },
];

export function findRoute(moduleId, subId) {
  for (const g of NAV) {
    const mod = g.items.find((i) => i.id === moduleId);
    const sub = mod?.subs?.find((s) => s.id === subId);
    if (mod && sub) return { mod, sub };
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
          <LogoMark size={36} />
          <div className="brand-text">
            <div className="brand-name">MEMS 2.0</div>
            <div className="brand-sub">Suivi &amp; évaluation</div>
          </div>
        </div>

        <nav className="nav">
          {NAV.map((g) => (
            <div className="nav-group" key={g.group}>
              <div className="nav-group-label">{t(`nav.group.${g.group}`, g.group)}</div>
              {g.items.map((item) => {
                const Icon = item.icon;
                const available = Boolean(item.subs);
                const open = route.module === item.id;
                return (
                  <div key={item.id}>
                    <button
                      type="button"
                      className={`nav-item ${open ? 'is-open' : ''}`}
                      disabled={!available}
                      title={available ? t(`nav.${item.id}`, item.label) : t('shell.comingSoon', 'Bientôt disponible')}
                      aria-expanded={available ? open : undefined}
                      onClick={() => available && onNavigate(item.id, item.subs[0].id)}
                    >
                      <Icon size={18} aria-hidden="true" />
                      <span className="nav-label">{t(`nav.${item.id}`, item.label)}</span>
                      {!available && <span className="sr-only"> ({t('shell.comingSoon', 'bientôt disponible')})</span>}
                    </button>
                    {available && open && (
                      <div className="nav-sub">
                        {item.subs.map((s) => (
                          <button
                            key={s.id}
                            type="button"
                            className={`nav-subitem ${route.sub === s.id ? 'is-active' : ''}`}
                            aria-current={route.sub === s.id ? 'page' : undefined}
                            onClick={() => onNavigate(item.id, s.id)}
                          >
                            {t(`nav.${item.id}.${s.id}`, s.label)}
                          </button>
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
          <IconButton
            icon={collapsed ? PanelLeftOpen : PanelLeftClose}
            label={collapsed ? t('shell.expandMenu', 'Agrandir le menu') : t('shell.collapseMenu', 'Réduire le menu')}
            className="collapse-toggle"
            onClick={() => setCollapsed((c) => !c)}
          />
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
