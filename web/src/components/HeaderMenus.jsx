import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Bell, Settings, LogOut, Sun, Moon, Lightbulb, LightbulbOff, ChevronRight } from 'lucide-react';
import { api } from '../api/client.js';
import { alertText, alertsState, goArgs, goHash, sourceList } from '../lib/alerts.js';
import SeverityBadge from './SeverityBadge.jsx';
import { Avatar } from './ui.jsx';
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

const ALERTS_REFRESH_MS = 5 * 60 * 1000;
const BELL_ITEMS = 6;

/**
 * Cloche = Centre d'alertes (retour n° 34) : même liste que la page, lue sur
 * GET /api/alerts. La pastille compte ce qui demande l'attention (critiques +
 * à surveiller) ; le panneau montre les premières alertes et mène au Centre.
 * Rafraîchie à l'ouverture et toutes les 5 minutes ; une erreur réseau laisse
 * simplement la cloche sans pastille. Comme la page, jamais « aucune
 * notification » quand une source n'a pas pu être lue (alertsState).
 * Sur téléphone, le panneau est fixé à l'écran (styles.css, .notif-pop).
 */
export function NotificationsMenu({ onNavigate }) {
  const { t, tr } = useI18n();
  const { open, setOpen, ref } = usePopover();
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(() => {
    api.alerts().then((d) => { setData(d); setFailed(false); }, () => setFailed(true));
  }, []);
  useEffect(() => {
    load();
    const id = setInterval(load, ALERTS_REFRESH_MS);
    return () => clearInterval(id);
  }, [load]);
  useEffect(() => { if (open) load(); }, [open, load]);

  const counts = data?.counts || null;
  const attention = counts?.attention || 0;
  const items = data?.items || [];
  const { status, unavailable } = alertsState(data);
  const go = (args) => { setOpen(false); if (args && onNavigate) onNavigate(...args); };
  // Alerte dont la période voyage avec le lien (exécution du plan → Synthèse sur cette période).
  const openAlert = (a) => { const hash = goHash(a.go); if (hash) { setOpen(false); window.location.hash = hash; } else go(goArgs(a.go)); };
  const label = attention
    ? tr('Alertes : {n} à traiter en priorité', { n: attention })
    : t('header.notifications', 'Notifications');
  return (
    <div className="pop-anchor" ref={ref}>
      <button type="button" className="btn btn-ghost btn-icon bell-btn" aria-label={label} title={label}
        aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Bell size={18} aria-hidden="true" />
        {attention > 0 && <span className={`bell-count${counts.critical ? ' is-critical' : ''}`} aria-hidden="true">{attention > 99 ? '99+' : attention}</span>}
      </button>
      {open && (
        <div className="pop notif-pop" role="menu" aria-label={t('header.notifications', 'Notifications')}>
          <div className="pop-label notif-head">
            <span>{tr('Alertes')}</span>
            {counts && <span className="notif-counts">{tr('{c} critique(s) · {w} à surveiller · {i} à traiter', { c: counts.critical, w: counts.warning, i: counts.info })}</span>}
          </div>
          {data && status === 'alerts' && unavailable.length > 0 && (
            <div className="notif-partial">{tr('Sources non lues : {list}.', { list: sourceList(tr, unavailable) })}</div>
          )}
          {failed && !data ? <div className="notif-empty">{tr('Alertes indisponibles pour le moment.')}</div>
            : !data ? <div className="notif-empty">{tr('Chargement…')}</div>
              : status === 'partial' ? (
                <div className="notif-empty notif-partial-empty">
                  {tr('Aucune alerte dans les sources lues, mais ces sources n\'ont pas pu être lues : {list}. Impossible de dire que tout est au vert ; réessayez plus tard.', { list: sourceList(tr, unavailable) })}
                </div>
              )
              : items.length === 0 ? <div className="notif-empty">{t('header.noNotifications', 'Aucune notification pour le moment')}</div>
                : items.slice(0, BELL_ITEMS).map((a, i) => {
                  const { title, detail } = alertText(tr, a);
                  return (
                    <button type="button" role="menuitem" className="menu-item notif-item" key={`${a.kind}-${i}`} onClick={() => openAlert(a)}>
                      <SeverityBadge sev={a.sev} />
                      <span className="notif-text"><span className="notif-title">{title}</span>{detail && <span className="notif-detail">{detail}</span>}</span>
                    </button>
                  );
                })}
          <div className="pop-sep" />
          <button type="button" role="menuitem" className="menu-item notif-all" onClick={() => go(['alertes', 'centre'])}>
            {items.length > BELL_ITEMS ? tr('Voir toutes les alertes ({n})', { n: items.length }) : tr('Voir toutes les alertes')}
            <ChevronRight size={15} aria-hidden="true" className="mi-icon" />
          </button>
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
