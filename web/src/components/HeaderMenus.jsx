import React, { useEffect, useRef, useState } from 'react';
import { Bell, Settings, LogOut, Sun, Moon, Globe, Check, Eye } from 'lucide-react';
import { Avatar, IconButton } from './ui.jsx';
import { useI18n, LANGS } from '../lib/i18n.jsx';
import { useTheme } from '../lib/theme.js';
import { useTips } from '../lib/tips.js';
import { ROLE_LABELS } from '../lib/format.js';

// Close a popover on outside click or Escape.
function usePopover() {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);
  return { open, setOpen, ref };
}

export function NotificationsMenu() {
  const { t } = useI18n();
  const { open, setOpen, ref } = usePopover();
  return (
    <div className="pop-anchor" ref={ref}>
      <IconButton
        icon={Bell}
        label={t('header.notifications', 'Notifications')}
        className="bell-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      />
      {open && (
        <div className="pop" role="menu" aria-label={t('header.notifications', 'Notifications')}>
          <div className="pop-label">{t('header.notifications', 'Notifications')}</div>
          <div className="notif-empty">{t('header.noNotifications', 'Aucune notification pour le moment')}</div>
        </div>
      )}
    </div>
  );
}

export function UserMenu({ user, onLogout, onSettings }) {
  const { t, lang, setLang } = useI18n();
  const { theme, setTheme } = useTheme();
  const { tips, setTips } = useTips();
  const { open, setOpen, ref } = usePopover();
  const name = user?.email?.split('@')[0] || '?';
  const role = t(`role.${user?.role}`, ROLE_LABELS[user?.role] || user?.role);

  return (
    <div className="pop-anchor" ref={ref}>
      <button
        type="button"
        className="user-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t('user.account', 'Compte')}
        onClick={() => setOpen((o) => !o)}
      >
        <Avatar name={name} />
      </button>
      {open && (
        <div className="pop" role="menu" aria-label={t('user.account', 'Compte')}>
          <div className="pop-head">
            <div className="pop-name">{user?.email}</div>
            <div className="pop-role">{role}</div>
          </div>

          <div className="seg-row">
            <span className="seg-label"><Globe size={16} aria-hidden="true" />{t('user.language', 'Langue')}</span>
            <div className="seg" role="group" aria-label={t('user.language', 'Langue')}>
              {LANGS.map((l) => (
                <button
                  key={l.id}
                  type="button"
                  className={lang === l.id ? 'is-active' : ''}
                  aria-pressed={lang === l.id}
                  onClick={() => setLang(l.id)}
                >{l.short}</button>
              ))}
            </div>
          </div>

          <div className="seg-row">
            <span className="seg-label">
              {theme === 'dark' ? <Moon size={16} aria-hidden="true" /> : <Sun size={16} aria-hidden="true" />}
              {t('user.theme.dark', 'Mode sombre')}
            </span>
            <label className="ui-switch">
              <input type="checkbox" checked={theme === 'dark'} onChange={(e) => setTheme(e.target.checked ? 'dark' : 'light')} aria-label={t('user.theme.dark', 'Mode sombre')} />
              <span className="track"><span className="thumb" /></span>
            </label>
          </div>

          <div className="seg-row">
            <span className="seg-label"><Eye size={16} aria-hidden="true" />{t('user.tips.show', 'Afficher les aides')}</span>
            <label className="ui-switch">
              <input type="checkbox" checked={tips === 'on'} onChange={(e) => setTips(e.target.checked ? 'on' : 'off')} aria-label={t('user.tips.show', 'Afficher les aides')} />
              <span className="track"><span className="thumb" /></span>
            </label>
          </div>

          <div className="pop-sep" />

          {onSettings && (
            <button type="button" className="menu-item" role="menuitem" onClick={() => { setOpen(false); onSettings(); }}>
              <Settings size={16} className="mi-icon" aria-hidden="true" />
              {t('user.settings', 'Paramétrage')}
            </button>
          )}
          <button type="button" className="menu-item is-danger" role="menuitem" onClick={() => { setOpen(false); onLogout(); }}>
            <LogOut size={16} className="mi-icon" aria-hidden="true" />
            {t('user.logout', 'Se déconnecter')}
          </button>
        </div>
      )}
    </div>
  );
}
