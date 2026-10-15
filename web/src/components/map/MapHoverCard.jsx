import React from 'react';
import { AlertOctagon, AlertTriangle, Clock3, X } from 'lucide-react';
import { useI18n } from '../../lib/i18n.jsx';
import { formatInt } from '../../lib/format.js';
import { formatRate, valueOf } from '../../lib/mapScale.js';

export const SEV_ICON = { critical: AlertOctagon, warning: AlertTriangle, info: Clock3 };
export const SEV_LABEL = { critical: 'Critique', warning: 'À surveiller', info: 'À traiter' };

/** Valeur d'un thème mise en forme (« 1,3 % », « 322 », « — aucun plan », « — »). */
export function useThemeValue() {
  const { tr, lang } = useI18n();
  return (theme, zone) => {
    const v = valueOf(theme.id, zone);
    if (v === 'np') return tr('— aucun plan');
    if (v == null) return '—';
    if (theme.kind === 'pct') return formatRate(v, lang);
    if (theme.kind === 'sev') return tr(['À traiter', 'À surveiller', 'Critique'][v]);
    return formatInt(v);
  };
}

/** Taux d'une ligne : « n · % », ou « — aucun plan ». */
function rateText(r, n, tr, lang) {
  if (!r) return formatInt(n);
  if (r.reason === 'aucun_plan') return tr('— aucun plan');
  if (r.value == null) return formatInt(n);
  return `${formatInt(n)} · ${formatRate(r.value, lang)}`;
}

/**
 * Fiche d'un contour (survol, ou épinglée au clic / au toucher) : nom (+ district qui
 * partage le contour), région · période · « sites distincts », valeur du thème, puis
 * les lignes de la zone et jusqu'à 3 signaux (icône + libellé). Textes en nœuds React
 * (échappés) — jamais du HTML assemblé.
 */
export default function MapHoverCard({ zone, theme, periodText, pos, box, pinned, onClose, onShowSites, multiMonth }) {
  const { tr, lang } = useI18n();
  const fmtValue = useThemeValue();
  if (!zone || !pos) return null;
  const c = zone.counts; const r = zone.rates;
  const W = 300; const H = 360;
  const left = Math.max(8, Math.min(box.width - W - 8, pos.x + 16));
  const top = Math.max(8, Math.min(box.height - H, pos.y - 150));
  const shared = (zone.districts || []).filter((d) => d.name !== zone.name);
  const declaredOnly = Math.max(0, c.realised - c.realisedData);
  return (
    <div className={`mapx-card${pinned ? ' is-pinned' : ''}`} style={{ left, top, width: W }} role={pinned ? 'dialog' : 'tooltip'} aria-label={zone.name}>
      {pinned && <button type="button" className="mapx-card-x" onClick={onClose} aria-label={tr('Fermer')}><X size={14} /></button>}
      <h4>{zone.name}{shared.length > 0 && <span className="mapx-card-shared"> + {shared.map((d) => d.name).join(', ')}</span>}</h4>
      <div className="mapx-card-sub">{[zone.region, periodText, tr('sites distincts')].filter(Boolean).join(' · ')}</div>
      <div className="mapx-card-big tabular">{fmtValue(theme, zone)}</div>
      <div className="mapx-card-theme">{tr(theme.label)}</div>
      <table className="mapx-card-rows">
        <tbody>
          <tr><td>{tr('Sites actifs')}</td><td className="tabular">{formatInt(c.active)}</td></tr>
          <tr><td>{tr('Réalisés (couverture)')}</td><td className="tabular">{rateText(r.coverage, c.realised, tr, lang)}</td></tr>
          {c.realised > 0 && (
            <tr className="mapx-card-sub-row"><td>{tr('dont par les données · déclarées sans donnée')}</td><td className="tabular">{`${formatInt(c.realisedData)} · ${formatInt(declaredOnly)}`}</td></tr>
          )}
          <tr><td>{tr('Prévus (planification)')}</td><td className="tabular">{c.planned ? rateText(r.planning, c.planned, tr, lang) : tr('— aucun plan')}</td></tr>
          <tr><td>{tr('Exécution du plan (visites)')}</td><td className="tabular">{c.visitsPlanned
            ? `${formatInt(c.visitsPlannedRealised)} / ${formatInt(c.visitsPlanned)} · ${formatRate(r.execution.value, lang)}` : tr('— aucun plan')}</td></tr>
          {c.visitsOffPlan > 0 && <tr><td>{tr('Hors plan (données sans visite prévue)')}</td><td className="tabular">{formatInt(c.visitsOffPlan)}</td></tr>}
          <tr><td>{tr('Risque élevé · moyen · faible')}</td><td className="tabular">{`${formatInt(c.riskHigh)} · ${formatInt(c.riskMid)} · ${formatInt(c.riskLow)}`}</td></tr>
          <tr><td>{tr('Données versées')}</td><td className="tabular">{formatInt(c.submissions)} <span className="muted">{tr('({n} au site)', { n: formatInt(c.submissionsSite) })}</span></td></tr>
          {c.communeDataOnly > 0 && <tr><td>{tr('Sites de communes avec données, non comptés comme visites')}</td><td className="tabular">{formatInt(c.communeDataOnly)}</td></tr>}
          {c.neverVisited > 0 && <tr><td>{tr('Jamais visités')}</td><td className="tabular">{formatInt(c.neverVisited)}</td></tr>}
          <tr><td>{tr('Sites GPS')}</td><td className="tabular">{formatInt(c.gps)}</td></tr>
        </tbody>
      </table>
      {(zone.signals || []).length > 0 && (
        <ul className="mapx-card-signals">
          {zone.signals.slice(0, 3).map((s) => {
            const Icon = SEV_ICON[s.sev] || Clock3;
            const params = s.kind === 'plan_exec_low' ? { ...s.params, p: formatRate(s.params.p, lang) } : s.params;
            return <li key={s.kind} className={`sev-${s.sev}`}><Icon size={13} aria-hidden="true" /><span className="sr-only">{tr(SEV_LABEL[s.sev])} : </span>{tr(s.title, params)}</li>;
          })}
        </ul>
      )}
      {shared.length > 0 && (
        <div className="mapx-card-src">{tr('Contour commun : {a} + {b} (contour 2018 non scindé)', { a: zone.name, b: shared.map((d) => d.name).join(', ') })}</div>
      )}
      <div className="mapx-card-src">
        {tr('Source : registre, visites, soumissions MEMS · une donnée rattachée à la seule commune n\'est pas une visite.')}
        {multiMonth ? ` ${tr('Visites déclarées comptées comme prévues.')}` : ''}
      </div>
      {pinned && onShowSites && (
        <button type="button" className="inline-link mapx-card-go" onClick={onShowSites}>{tr('Voir les sites')}</button>
      )}
    </div>
  );
}

/** Fiche d'un point (site, centre de commune, point de collecte) — aucune donnée individuelle de ménage. */
export function PointCard({ point, pos, box, periodText, onClose }) {
  const { tr, lang } = useI18n();
  if (!point || !pos) return null;
  const W = 260;
  const left = Math.max(8, Math.min(box.width - W - 8, pos.x + 14));
  const top = Math.max(8, Math.min(box.height - 190, pos.y - 60));
  const STATUS = { realise: 'Visité', hors_plan: 'Visité hors plan', prevu: 'Prévu, non visité', non_prevu: 'Non prévu', inactif: 'Inactif' };
  const QUAL = { fiable: 'position fiable', indicative: 'position indicative' };
  let body;
  if (point.type === 'site') {
    const s = point.data;
    body = (
      <>
        <h4>{s.name}</h4>
        <div className="mapx-card-sub">{[s.code, periodText].filter(Boolean).join(' · ')}</div>
        <table className="mapx-card-rows"><tbody>
          {s.activity && <tr><td>{tr('Activité')}</td><td>{s.activity}</td></tr>}
          <tr><td>{tr('Statut de la période')}</td><td>{tr(STATUS[s.status] || s.status)}</td></tr>
          {s.execution != null && <tr><td>{tr('Exécution du plan (visites)')}</td><td className="tabular">{formatRate(s.execution, lang)}</td></tr>}
          <tr><td>{tr('Position')}</td><td>{s.kind === 'gps' ? tr('GPS du registre') : tr('placé par ses collectes ({n} relevés, {q})', { n: formatInt(s.n), q: tr(QUAL[s.quality] || s.quality) })}</td></tr>
          {s.byData && <tr><td colSpan={2} className="muted">{tr('Réalisé par des données rattachées au site')}</td></tr>}
        </tbody></table>
      </>
    );
  } else if (point.type === 'commune') {
    const c = point.data;
    body = (
      <>
        <h4>{c.name}</h4>
        <div className="mapx-card-sub">{tr('Centre des collectes de la commune')}</div>
        <table className="mapx-card-rows"><tbody>
          <tr><td>{tr('Sites sans position')}</td><td className="tabular">{formatInt(c.sitesWithoutPosition)}</td></tr>
          <tr><td>{tr('Relevés GPS')}</td><td className="tabular">{formatInt(c.n)}</td></tr>
          <tr><td>{tr('Dispersion médiane')}</td><td className="tabular">{`${c.spreadKm} km`}</td></tr>
        </tbody></table>
        <div className="mapx-card-src">{c.sites.map((x) => x.name).join(', ')}{c.sitesWithoutPosition > c.sites.length ? ' …' : ''}</div>
      </>
    );
  } else {
    const p = point.data;
    body = (
      <>
        <h4>{point.type === 'bin' ? tr('{n} point(s) de collecte', { n: formatInt(p.n) }) : tr('Point de collecte')}</h4>
        <div className="mapx-card-sub">{point.type === 'bin' ? tr('Maille de 2 km (positions de ménages arrondies)') : [p.month, p.form].filter(Boolean).join(' · ')}</div>
      </>
    );
  }
  return (
    <div className="mapx-card is-point" style={{ left, top, width: W }} role="tooltip">
      {onClose && <button type="button" className="mapx-card-x" onClick={onClose} aria-label={tr('Fermer')}><X size={14} /></button>}
      {body}
    </div>
  );
}
