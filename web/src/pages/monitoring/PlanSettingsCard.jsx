import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Banknote, Clock, Cpu, ExternalLink, FileSpreadsheet, Handshake, Info, Lock, MapPin, MessageSquare, RefreshCw, RotateCcw, Save, ShieldAlert, Undo2,
} from 'lucide-react';
import { api } from '../../api/client.js';
import { Alert, Badge, Button, Card, CardHeader, Skeleton } from '../../components/ui.jsx';
import { useToast } from '../../components/Toast.jsx';
import { useI18n } from '../../lib/i18n.jsx';
import { formatDateTime } from '../../lib/format.js';
import { READ_ONLY_META, SETTING_GROUPS, STRATEGIES, cloneSettings, settingText, settingsDiff, settingsErrors } from '../../lib/planGen.js';
import './autoPlan.css';

/**
 * « Paramètres de la planification automatique » (lot 5, § 6.4 ; retours 107 et 108) —
 * Configuration RBM › Planification automatique (#/processus/rbm/configuration/planification).
 * Le plan suit le MMR, le RBM et la grille des sites actifs : la carte ne règle QUE ce que
 * MEMS ne sait pas ailleurs (stratégie par défaut, agents par véhicule, jours de terrain de
 * repli) et montre en lecture seule, avec leur source et un lien, les valeurs reprises. Chaque
 * champ porte sa source, la marque « modifié » quand il diffère de la valeur initiale, et la
 * valeur initiale. Enregistrement réservé à l'administrateur, avec la révision lue (409 si
 * quelqu'un a enregistré entre-temps).
 */
const SOURCE_ICONS = { classeur: FileSpreadsheet, retour: MessageSquare, mems: Cpu };
const SOURCE_KIND = { classeur: 'Classeur RBM', retour: 'Retour de l\'utilisateur', mems: 'Choix MEMS' };
const READ_ONLY_ICONS = { sites: MapPin, mmr: FileSpreadsheet, pace: Clock, priority: ShieldAlert, budget: Banknote, provider: Handshake };

function SourceChip({ source }) {
  const { tr } = useI18n();
  if (!source) return null;
  const Icon = SOURCE_ICONS[source.kind] || Info;
  // Une référence de cellule du classeur ne se traduit pas ; « Retour 108 », « MEMS »… oui.
  const ref = source.kind === 'classeur' ? source.ref : tr(source.ref);
  const text = `${tr(SOURCE_KIND[source.kind] || source.kind)} — ${tr(source.label)}`;
  return (
    <span className={`ps-source is-${source.kind}`} title={text}>
      <Icon size={12} aria-hidden="true" /> {ref}<span className="sr-only"> ({text})</span>
    </span>
  );
}

function errorText(err, tr) {
  if (!err) return null;
  switch (err.code) {
    case 'required': return tr('Valeur requise, de {min} à {max}.', { min: err.min, max: err.max });
    case 'range': return tr('De {min} à {max}.', { min: err.min, max: err.max });
    case 'integer': return tr('Nombre entier attendu.');
    default: return tr('Valeur invalide.');
  }
}

/** Saisie d'un paramètre selon son type (catalogue lib/planGen.SETTING_GROUPS). */
function SettingControl({ f, id, value, onChange, bounds, disabled }) {
  const { tr } = useI18n();
  if (f.type === 'choice') {
    return (
      <div className="ps-choices" role="radiogroup" aria-labelledby={`${id}-label`}>
        {f.options.map(([v, l]) => (
          <label key={v} className={`ap-strategy ${value === v ? 'is-on' : ''} ${disabled ? 'is-disabled' : ''}`}>
            <input type="radio" name={id} value={v} checked={value === v} disabled={disabled} onChange={() => onChange(v)} />
            <span className="ap-strategy-text">
              <span className="ap-strategy-label">{tr(l)}</span>
              {STRATEGIES[v] && <span className="ap-strategy-help">{tr(STRATEGIES[v].help)}</span>}
            </span>
          </label>
        ))}
      </div>
    );
  }
  const [min, max] = bounds[f.key] || [];
  return (
    <input id={id} className="input ap-num" type="number" min={min} max={max} step={1} value={value ?? ''} disabled={disabled}
      onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))} />
  );
}

function SettingItem({ f, form, data, setValue, errors, readOnly, wide }) {
  const { tr } = useI18n();
  const id = `ps-${f.key}`;
  const value = form[f.key];
  const changed = value !== data.defaults[f.key];
  const unsaved = value !== data.settings[f.key];
  const err = errorText(errors[f.key], tr);
  return (
    <div className={`ps-item ${changed ? 'is-changed' : ''} ${wide ? 'is-wide' : ''}`}>
      <div className="ps-item-head">
        <label className="ps-item-label" id={`${id}-label`} htmlFor={f.type === 'choice' ? undefined : id}>{tr(f.label)}</label>
        <SourceChip source={data.sources[f.key]} />
      </div>
      <SettingControl f={f} id={id} value={value} onChange={(v) => setValue(f.key, v)} bounds={data.bounds} disabled={readOnly} />
      {f.help && <span className="ps-help">{tr(f.help)}</span>}
      {err && <span className="field-error">{err}</span>}
      {(changed || unsaved) && (
        <div className="ps-item-foot">
          {changed && <Badge tone="orange">{tr('modifié')}</Badge>}
          {changed && <span className="ps-default">{tr('Valeur initiale : {v}', { v: settingText(f, data.defaults[f.key], tr) })}</span>}
          {unsaved && <span className="ps-unsaved">{tr('non enregistré')}</span>}
        </div>
      )}
    </div>
  );
}

/** Ce que la planification reprend d'ailleurs : lecture seule, avec la source et le lien où cela se règle. */
function ReadOnlyItems({ items = [], onSection }) {
  const { tr } = useI18n();
  return (
    <ul className="ap-known ps-known">
      {items.map((r) => {
        const meta = READ_ONLY_META[r.key] || { title: r.key, icon: 'mmr' };
        const Icon = READ_ONLY_ICONS[meta.icon] || Info;
        const inSpace = meta.href === '#/processus/rbm/configuration/mmr' && onSection;
        return (
          <li key={r.key}>
            <Icon size={15} aria-hidden="true" />
            <span className="ap-known-text">
              <strong>{tr(meta.title)}</strong> — {tr(r.source.label)}
              {(r.source.kind === 'classeur' || r.source.ref !== meta.link) && <SourceChip source={r.source} />}
            </span>
            {inSpace
              ? <button type="button" className="link-btn ps-open" onClick={() => onSection('mmr')}><ExternalLink size={13} aria-hidden="true" /> {tr(meta.link)}</button>
              : meta.href && <a className="ap-link" href={meta.href}>{tr(meta.link)} <ExternalLink size={12} aria-hidden="true" /></a>}
          </li>
        );
      })}
    </ul>
  );
}

export default function PlanSettingsCard({ isAdmin, onSection }) {
  const { tr } = useI18n();
  const toast = useToast();
  const [data, setData] = useState(null);
  const [form, setForm] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [saveError, setSaveError] = useState(null);
  const [conflict, setConflict] = useState(false);
  const [saving, setSaving] = useState(false);
  const readOnly = !isAdmin;

  const load = useCallback(() => {
    setLoadError(null); setSaveError(null); setConflict(false);
    return api.planSettings()
      .then((s) => { setData(s); setForm(cloneSettings(s.settings)); })
      .catch((e) => setLoadError(e.message || tr('Chargement impossible.')));
  }, [tr]);
  useEffect(() => { load(); }, [load]);

  const errors = useMemo(() => (data && form ? settingsErrors(form, data.bounds) : {}), [data, form]);
  const dirty = data && form ? settingsDiff(form, data.settings) : [];
  const fromDefaults = data && form ? settingsDiff(form, data.defaults) : [];
  const setValue = (k, v) => { setSaveError(null); setForm((f) => ({ ...f, [k]: v })); };

  async function save() {
    setSaving(true); setSaveError(null);
    try {
      const res = await api.planSettingsSave({ revision: data.revision, ...cloneSettings(form) });
      setData(res); setForm(cloneSettings(res.settings));
      toast.success(tr('Paramètres de la planification enregistrés.'));
    } catch (e) {
      if (e.status === 409) setConflict(true);
      else setSaveError(e.status === 400 ? tr('Valeurs refusées par le serveur : vérifiez les champs signalés.') : (e.message || tr('Enregistrement impossible.')));
    } finally { setSaving(false); }
  }

  const header = (
    <CardHeader title={tr('Paramètres de la planification automatique')}
      subtitle={tr('Le plan suit le MMR, le RBM et la grille des sites actifs, et dit les agents et les véhicules nécessaires. Ici, seulement ce que MEMS ne sait pas ailleurs ; un aperçu peut le changer pour lui seul.')} />
  );
  if (loadError && !data) {
    return (
      <Card className="ps-card">{header}
        <div className="card-body"><Alert tone="error">{loadError} <button type="button" className="link-btn" onClick={load}>{tr('Réessayer')}</button></Alert></div>
      </Card>
    );
  }
  if (!data || !form) {
    return <Card className="ps-card" aria-busy="true">{header}<div className="card-body"><Skeleton height={120} /><Skeleton height={120} /></div></Card>;
  }
  const meta = data.revision > 0
    ? tr('Révision {r} · enregistrée le {d}{by}', { r: String(data.revision), d: data.updatedAt ? formatDateTime(data.updatedAt) : '—', by: data.updatedBy ? ` ${tr('par {u}', { u: data.updatedBy })}` : '' })
    : tr('Valeurs initiales : jamais enregistrées pour ce compte.');
  const hasErrors = Object.keys(errors).length > 0;
  return (
    <Card className="ps-card">
      {header}
      <div className="card-body">
        {readOnly && <Alert tone="info" icon={Lock}>{tr('Lecture seule : seul un administrateur modifie ces paramètres. Chaque aperçu peut toutefois les ajuster pour lui-même.')}</Alert>}
        {conflict && (
          <Alert tone="warning">
            {tr('Ces paramètres ont été enregistrés par quelqu\'un d\'autre entre-temps. Rechargez-les, puis refaites vos changements.')}{' '}
            <button type="button" className="link-btn" onClick={load}><RefreshCw size={13} aria-hidden="true" /> {tr('Recharger')}</button>
          </Alert>
        )}
        {saveError && <Alert tone="error">{saveError}</Alert>}
        {SETTING_GROUPS.map((g) => (
          <section key={g.id} className="ps-group" aria-labelledby={`ps-g-${g.id}`}>
            <h3 className="ap-h" id={`ps-g-${g.id}`}>{tr(g.title)}</h3>
            <div className="ps-grid">
              {g.fields.map((f) => <SettingItem key={f.key} f={f} form={form} data={data} setValue={setValue} errors={errors} readOnly={readOnly} wide={f.type === 'choice'} />)}
            </div>
          </section>
        ))}
        <section className="ps-group" aria-labelledby="ps-g-ro">
          <h3 className="ap-h" id="ps-g-ro">{tr('Repris du MMR, du RBM et des contrats (lecture seule)')}</h3>
          <ReadOnlyItems items={data.readOnly} onSection={onSection} />
        </section>
        <div className="ps-actions">
          <span className="ps-meta">{meta}</span>
          {!readOnly && (
            <>
              <Button variant="ghost" icon={RotateCcw} disabled={!fromDefaults.length || saving} onClick={() => { setSaveError(null); setForm(cloneSettings(data.defaults)); }}>
                {tr('Rétablir les valeurs initiales')}
              </Button>
              <Button variant="secondary" icon={Undo2} disabled={!dirty.length || saving} onClick={() => { setSaveError(null); setForm(cloneSettings(data.settings)); }}>
                {tr('Annuler les modifications')}
              </Button>
              <Button icon={Save} loading={saving} disabled={!dirty.length || hasErrors || conflict} onClick={save}>
                {dirty.length ? tr('Enregistrer ({n})', { n: dirty.length }) : tr('Enregistrer')}
              </Button>
            </>
          )}
        </div>
      </div>
    </Card>
  );
}
