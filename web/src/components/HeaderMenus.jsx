import React, { useEffect, useRef, useState } from 'react';
import { Bell, Settings, LogOut, Sun, Moon, Lightbulb, LightbulbOff } from 'lucide-react';
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

          <div className="pref-bar" role="group" aria-label={t('user.preferences', 'Préférences')}>
            <div className="pref-seg" role="group" aria-label={t('user.language', 'Langue')}>
              {LANGS.map((l) => (
                <button
                  key={l.id}
                  type="button"
                  className={lang === l.id ? 'is-active' : ''}
                  aria-pressed={lang === l.id}
                  title={l.label}
                  onClick={() => setLang(l.id)}
                >{l.short}</button>
              ))}
            </div>

            <button
              type="button"
              className={`pref-ic${theme === 'dark' ? ' is-active' : ''}`}
              aria-pressed={theme === 'dark'}
              title={theme === 'dark' ? t('user.theme.dark', 'Mode sombre') : t('user.theme.light', 'Mode clair')}
              aria-label={theme === 'dark' ? t('user.theme.dark', 'Mode sombre') : t('user.theme.light', 'Mode clair')}
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            >
              {theme === 'dark' ? <Moon size={17} aria-hidden="true" /> : <Sun size={17} aria-hidden="true" />}
            </button>

            <button
              type="button"
              className={`pref-ic${tips === 'on' ? ' is-active' : ''}`}
              aria-pressed={tips === 'on'}
              title={tips === 'on' ? t('user.tips.hide', 'Masquer les aides') : t('user.tips.show', 'Afficher les aides')}
              aria-label={tips === 'on' ? t('user.tips.hide', 'Masquer les aides') : t('user.tips.show', 'Afficher les aides')}
              onClick={() => setTips(tips === 'on' ? 'off' : 'on')}
            >
              {tips === 'on' ? <Lightbulb size={17} aria-hidden="true" /> : <LightbulbOff size={17} aria-hidden="true" />}
            </button>
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
