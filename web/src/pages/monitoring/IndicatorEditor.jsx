import React, { useEffect, useMemo, useState } from 'react';
import { Check, AlertTriangle, Sparkles, X, Plus, TrendingUp, TrendingDown } from 'lucide-react';
import { api } from '../../api/client.js';
import { Alert, Button, Field, Skeleton } from '../../components/ui.jsx';
import Modal from '../../components/Modal.jsx';
import MonthSelect from '../../components/MonthSelect.jsx';
import { useToast } from '../../components/Toast.jsx';
import { useI18n } from '../../lib/i18n.jsx';
import { choiceText, draftErrors, draftBody, draftPatch, isPctAgg, previewBody, toDraft } from '../../lib/indicatorView.js';
import VariablePicker, { findVariable } from './VariablePicker.jsx';
import IndicatorExplain, { useIndicatorPreview } from './IndicatorExplain.jsx';

/**
 * Éditeur d'indicateur — UN seul, ouvert depuis les Résultats (« Nouvel
 * indicateur », « Modifier » sur une ligne ou dans le détail) et depuis
 * l'onglet Configuration. À gauche la définition (identité, mesure, lecture),
 * à droite « Comment c'est calculé » recalculé en direct sur les soumissions
 * réelles de la période, avec le même moteur que les résultats.
 * Une modification n'envoie QUE les champs changés (rien d'autre n'est touché).
 */
const METHODS = [
  { id: 'percent_yes', label: '% de « oui »', desc: 'Part des réponses positives (oui / 1, ou les valeurs comptées choisies) parmi les réponses comptées.' },
  { id: 'percent_value', label: '% = valeur', desc: 'Part des réponses égales à la (aux) valeur(s) comptée(s) parmi les réponses comptées.' },
  { id: 'mean', label: 'Moyenne', desc: 'Moyenne des réponses numériques (les autres sont ignorées).' },
  { id: 'sum', label: 'Somme', desc: 'Somme des réponses numériques.' },
  { id: 'count', label: 'Nombre', desc: 'Nombre de réponses renseignées.' },
];

function Chips({ options, selected, onToggle, label }) {
  const { tr } = useI18n();
  const on = new Set(selected.map((x) => String(x).toLowerCase()));
  return (
    <div className="ie-chips" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" className="ie-chip" aria-pressed={on.has(String(o.value).toLowerCase())} onClick={() => onToggle(String(o.value))}
          title={o.label ? `${o.value} — ${o.label}` : o.value}>
          {on.has(String(o.value).toLowerCase()) ? <Check size={12} aria-hidden="true" /> : null}
          <span className="mono">{o.value}</span>{o.label && o.label !== o.value && <span className="ie-chip-label">{choiceText(o.label, tr)}</span>}
        </button>
      ))}
    </div>
  );
}

/** Ajout libre d'une valeur (code hors base ou valeur comptée hors liste). */
function AddValue({ onAdd, placeholder, label }) {
  const [v, setV] = useState('');
  const add = () => { if (v.trim()) { onAdd(v.trim()); setV(''); } };
  return (
    <span className="ie-add">
      <input className="input input-sm mono" value={v} placeholder={placeholder} aria-label={label}
        onChange={(e) => setV(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} />
      <Button size="sm" variant="secondary" icon={Plus} onClick={add} disabled={!v.trim()}>{label}</Button>
    </span>
  );
}

/**
 * @param {{ form: object, indicator?: object|null, period?: string|null, canEdit?: boolean,
 *   onClose: Function, onSaved: Function }} props
 *   indicator null = création ; period = mois de l'aperçu (« AAAA-MM »), '' = toutes les périodes.
 */
export default function IndicatorEditor({ form, indicator, period: initialPeriod, canEdit = true, onClose, onSaved }) {
  const { tr } = useI18n();
  const toast = useToast();
  const editing = Boolean(indicator && indicator.id);
  const [vars, setVars] = useState(null);
  const [months, setMonths] = useState([]);
  const [list, setList] = useState([]);
  const [orig, setOrig] = useState(null);   // brouillon de l'indicateur enregistré
  const [draft, setDraft] = useState(null);
  const [period, setPeriod] = useState(initialPeriod ?? null);
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState(null);

  useEffect(() => {
    let alive = true;
    Promise.all([
      api.monVariables(form.id).catch(() => ({ fields: [], calcFields: [], sampled: 0 })),
      api.monFormMonths(form.id).catch(() => ({ months: [], latest: null })),
      api.monIndicators(form.id).catch(() => []),
    ]).then(([v, m, inds]) => {
      if (!alive) return;
      setVars(v);
      setMonths(m.months || []);
      setList(inds || []);
      if (initialPeriod == null) setPeriod(m.latest || '');
      // Toujours la version enregistrée (la ligne des résultats peut dater).
      const fresh = editing ? (inds || []).find((i) => i.id === indicator.id) || indicator : null;
      const d0 = toDraft(fresh);
      setOrig(d0);
      setDraft(d0);
    });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.id, indicator?.id]);

  const variables = useMemo(() => (vars ? [
    ...(vars.fields || []),
    ...(vars.calcFields || []).map((c) => ({ name: c.name, label: c.label && c.label !== c.name ? c.label : null, kind: 'calc', type: 'calculate', choices: [], filled: c.filled })),
  ] : []), [vars]);
  const modules = useMemo(() => [...new Set(list.map((i) => i.module).filter(Boolean))].sort((a, b) => a.localeCompare(b)), [list]);
  const selected = draft ? findVariable(variables, draft.sourceField) : null;
  const body = useMemo(() => (draft && draft.sourceField.trim() ? previewBody(draft, period || null) : null), [draft, period]);
  const preview = useIndicatorPreview(form.id, body, { enabled: Boolean(draft) && period !== null });

  if (!draft) {
    return (
      <Modal open size="editor" title={editing ? tr('Modifier l\'indicateur') : tr('Nouvel indicateur')} onClose={onClose}>
        <Skeleton height={320} />
      </Modal>
    );
  }

  const errors = draftErrors(draft);
  const set = (patch) => { setDraft((d) => ({ ...d, ...patch })); setServerError(null); };
  const toggle = (key, value) => setDraft((d) => {
    const cur = d[key];
    const has = cur.some((x) => String(x).toLowerCase() === String(value).toLowerCase());
    return { ...d, [key]: has ? cur.filter((x) => String(x).toLowerCase() !== String(value).toLowerCase()) : [...cur, value] };
  });
  // Valeurs proposées : choix de la variable, puis réponses vues dans les données de la période.
  const seen = (preview.data?.explain?.distribution || []).map((r) => ({ value: r.value, label: r.label }));
  const seenNa = (preview.data?.explain?.na || []).map((r) => ({ value: r.value, label: r.label }));
  const choiceList = (() => {
    const out = []; const keys = new Set();
    for (const c of [...(selected?.choices || []), ...seen, ...seenNa]) {
      const k = String(c.value).toLowerCase();
      if (!keys.has(k)) { keys.add(k); out.push({ value: String(c.value), label: c.label || null }); }
    }
    return out.slice(0, 40);
  })();
  const extra = (vals) => vals.filter((v) => !choiceList.some((c) => c.value.toLowerCase() === String(v).toLowerCase())).map((v) => ({ value: v, label: null }));
  const method = METHODS.find((m) => m.id === draft.agg) || METHODS[0];
  const fieldError = (k) => (touched && errors[k] ? tr(errors[k]) : undefined);

  async function save() {
    setTouched(true);
    if (Object.keys(errors).length) return;
    setSaving(true);
    setServerError(null);
    try {
      if (editing) {
        const patch = draftPatch(orig, draft);
        if (Object.keys(patch).length) await api.monUpdateIndicator(indicator.id, patch);
      } else {
        await api.monCreateIndicator(form.id, draftBody(draft));
      }
      toast.success(editing ? tr('Indicateur modifié.') : tr('Indicateur créé.'));
      onSaved?.();
    } catch (e) {
      setServerError(e.message);
      toast.error(e.message);
    } finally { setSaving(false); }
  }

  const readOnly = !canEdit;
  return (
    <Modal open size="editor" title={editing ? tr('Modifier l\'indicateur') : tr('Nouvel indicateur')}
      subtitle={editing ? `${orig.label} · ${orig.code}` : tr('Reliez une variable de la fiche à une méthode de calcul ; le calcul s\'affiche à côté, sur les données réelles.')}
      onClose={() => !saving && onClose()}
      footer={<>
        <Button variant="secondary" onClick={onClose} disabled={saving}>{tr('Annuler')}</Button>
        {!readOnly && <Button icon={Check} onClick={save} loading={saving}>{editing ? tr('Enregistrer') : tr('Créer l\'indicateur')}</Button>}
      </>}>
      <div className="ie">
        <div className="ie-form">
          {indicator?.templateCode && (
            <Alert tone="info" icon={Sparkles}>{tr('Issu du modèle de l\'activité (élément {code}). Vos modifications sont conservées : réappliquer le modèle ne modifie pas les indicateurs déjà créés.', { code: indicator.templateCode })}</Alert>
          )}
          {serverError && <Alert tone="error" icon={AlertTriangle}>{serverError}</Alert>}

          <fieldset className="ie-section" disabled={readOnly}>
            <legend>{tr('Identité')}</legend>
            <div className="form-grid">
              <Field label={tr('Libellé')} htmlFor="ie-label" required error={fieldError('label')}>
                <input id="ie-label" className="input" value={draft.label} maxLength={200} onChange={(e) => set({ label: e.target.value })} placeholder={tr('Bénéficiaires informés')} />
              </Field>
              <Field label={tr('Code')} htmlFor="ie-code" required error={fieldError('code')} hint={editing ? tr('Modifiable ; unique dans la fiche.') : tr('Unique dans la fiche.')}>
                <input id="ie-code" className="input mono" value={draft.code} maxLength={60} onChange={(e) => set({ code: e.target.value })} placeholder="benef_informes" />
              </Field>
            </div>
            <Field label={tr('Domaine (regroupement)')} htmlFor="ie-module" hint={tr('Choisissez un domaine existant : un nom nouveau crée un domaine à part entière dans l\'indice (moyenne des domaines à poids égaux).')}>
              <input id="ie-module" className="input" list={`ie-modules-${form.id}`} value={draft.module} maxLength={80} onChange={(e) => set({ module: e.target.value })} placeholder="D1 · …" />
              <datalist id={`ie-modules-${form.id}`}>{modules.map((m) => <option key={m} value={m} />)}</datalist>
            </Field>
          </fieldset>

          <fieldset className="ie-section" disabled={readOnly}>
            <legend>{tr('Mesure')}</legend>
            <div className="field">
              <label className="field-label" htmlFor="ie-var">{tr('Variable source')} <span className="req" aria-hidden="true">*</span></label>
              {vars === null ? <Skeleton height={38} /> : (
                <VariablePicker id="ie-var" variables={variables} sampled={vars.sampled} value={draft.sourceField} invalid={Boolean(fieldError('sourceField'))}
                  onChange={(name) => set({ sourceField: name })} disabled={readOnly} />
              )}
              {fieldError('sourceField') && <div className="field-error">{fieldError('sourceField')}</div>}
            </div>

            <div className="field">
              <span className="field-label">{tr('Méthode de calcul')}</span>
              <div className="ie-methods" role="radiogroup" aria-label={tr('Méthode de calcul')}>
                {METHODS.map((m) => (
                  <button key={m.id} type="button" role="radio" aria-checked={draft.agg === m.id} className={draft.agg === m.id ? 'is-on' : ''} onClick={() => set({ agg: m.id })}>{tr(m.label)}</button>
                ))}
              </div>
              <div className="hint">{tr(method.desc)}</div>
            </div>

            {isPctAgg(draft.agg) && (
              <div className="field">
                <span className="field-label">{draft.agg === 'percent_value' ? tr('Valeur(s) comptée(s)') : tr('Valeur(s) « oui »')}{draft.agg === 'percent_value' && <span className="req" aria-hidden="true"> *</span>}</span>
                <Chips label={tr('Valeurs comptées')} options={[...choiceList, ...extra(draft.positive)]} selected={draft.positive} onToggle={(v) => toggle('positive', v)} />
                <AddValue label={tr('Ajouter')} placeholder="1" onAdd={(v) => toggle('positive', v)} />
                <div className="hint">{draft.agg === 'percent_yes' && !draft.positive.length
                  ? tr('Aucune valeur choisie : oui, yes, 1, true et vrai comptent comme « oui ».')
                  : tr('Plusieurs valeurs possibles (ex. « Très sûr » et « Sûr ») : chacune compte comme positive.')}</div>
                {fieldError('positive') && <div className="field-error">{fieldError('positive')}</div>}
              </div>
            )}

            <div className="field">
              <span className="field-label">{tr('Réponses hors base')}</span>
              <Chips label={tr('Réponses hors base')} options={[...choiceList, ...extra(draft.naValues)]} selected={draft.naValues} onToggle={(v) => toggle('naValues', v)} />
              <AddValue label={tr('Ajouter')} placeholder="9999" onAdd={(v) => toggle('naValues', v)} />
              <div className="hint">{tr('Retirées du calcul (ni positives, ni négatives) : Sans objet 9999, Ne sait pas 888…')}</div>
              {fieldError('naValues') && <div className="field-error">{fieldError('naValues')}</div>}
            </div>
          </fieldset>

          <fieldset className="ie-section" disabled={readOnly}>
            <legend>{tr('Lecture du résultat')}</legend>
            <div className="form-grid">
              <Field label={tr('Cible (optionnel)')} htmlFor="ie-target" error={fieldError('target')}
                hint={isPctAgg(draft.agg) ? tr('Sans cible, un % est classé par les bandes 80 / 65 / 50.') : tr('Sans cible, une moyenne, une somme ou un nombre n\'est pas classé.')}>
                <input id="ie-target" className="input tabular" inputMode="decimal" value={draft.target} onChange={(e) => set({ target: e.target.value })} placeholder="80" />
              </Field>
              <div className="field">
                <span className="field-label">{tr('Sens')}</span>
                <div className="segmented" role="group" aria-label={tr('Sens')}>
                  <button type="button" aria-pressed={draft.direction === 'higher_better'} onClick={() => set({ direction: 'higher_better' })}><TrendingUp size={14} aria-hidden="true" /> {tr('Plus haut = mieux')}</button>
                  <button type="button" aria-pressed={draft.direction === 'lower_better'} onClick={() => set({ direction: 'lower_better' })}><TrendingDown size={14} aria-hidden="true" /> {tr('Plus bas = mieux')}</button>
                </div>
              </div>
            </div>
            <label className="ie-check"><input type="checkbox" checked={draft.scored} onChange={(e) => set({ scored: e.target.checked })} /> {tr('Compte dans l\'indice de conformité')}</label>
            {editing && <label className="ie-check"><input type="checkbox" checked={draft.active} onChange={(e) => set({ active: e.target.checked })} /> {tr('Actif (calculé et affiché dans les résultats)')}</label>}
          </fieldset>
        </div>

        <aside className="ie-explain" aria-label={tr('Comment c\'est calculé')}>
          <div className="ie-explain-head">
            <h3>{tr('Comment c\'est calculé')}</h3>
            {period !== null && (
              <MonthSelect allowAll value={period} onChange={setPeriod} options={months.map((m) => m.month)}
                counts={Object.fromEntries(months.map((m) => [m.month, m.submissions]))} ariaLabel={tr('Période de l\'aperçu')} />
            )}
          </div>
          <IndicatorExplain preview={preview} direction={draft.direction} scored={draft.scored} />
        </aside>
      </div>
      {touched && Object.keys(errors).length > 0 && <p className="field-error ie-errors"><X size={13} aria-hidden="true" /> {tr('Complétez les champs signalés.')}</p>}
    </Modal>
  );
}
