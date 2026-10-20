import React, { useEffect, useState } from 'react';
import { RefreshCw, Lightbulb } from 'lucide-react';
import { api } from '../../../api/client.js';
import { useI18n } from '../../../lib/i18n.jsx';
import { Button, Field } from '../../../components/ui.jsx';
import { categoryColumn, chartSeries, viewAdvice } from '../../../lib/reportViz.js';
import { TYPE_LABEL, VIEW_LABELS, VIEW_ADVICE } from './blockTypes.js';
import FiltersPane from './FiltersPane.jsx';
import PagePane from './PagePane.jsx';

const CHART = new Set(['bar', 'column', 'line', 'donut', 'stacked']);

/** Volet droit : onglets Bloc / Filtres (bloc sélectionné) ou Page (document). */
export default function PropertiesPane({ sel, doc, catalog, forms, opts, state, annex, onChangeBlock, onRegenerate, onChangePage, onChangeAnnexes, pageExtra }) {
  const { tr } = useI18n();
  const [tab, setTab] = useState('block');
  const block = sel ? sel.block : null;
  const hasFilters = block && ['data', 'kpis', 'bulletin', 'text', 'callout'].includes(block.type);
  const t = !block ? 'page' : tab === 'filters' && !hasFilters ? 'block' : tab;
  const def = block && block.type === 'data' ? catalog.datasets[block.params.dataset] : null;
  return (
    <>
      <div className="rd-tabs" role="tablist">
        {block && <button type="button" role="tab" aria-selected={t === 'block'} className={t === 'block' ? 'is-active' : ''} onClick={() => setTab('block')}>{tr('Bloc')}</button>}
        {hasFilters && <button type="button" role="tab" aria-selected={t === 'filters'} className={t === 'filters' ? 'is-active' : ''} onClick={() => setTab('filters')}>{tr('Filtres')}</button>}
        <button type="button" role="tab" aria-selected={t === 'page'} className={t === 'page' ? 'is-active' : ''} onClick={() => setTab('page')}>{tr('Page')}</button>
      </div>
      <div className="rd-pane-body">
        {t === 'block' && block && <BlockProps block={block} parent={sel.parent} catalog={catalog} forms={forms} state={state} annex={annex} onChange={onChangeBlock} onRegenerate={onRegenerate} />}
        {t === 'filters' && block && (
          <FiltersPane block={block} doc={doc} forms={forms} opts={opts}
            supported={def ? def.filters : block.type === 'kpis' ? null : ['office', 'form', 'activity', 'partner']}
            officeKinds={def ? def.officeKinds : null}
            onChange={(filters) => onChangeBlock({ filters })} />
        )}
        {t === 'page' && <PagePane doc={doc} onChange={onChangePage} onAnnexes={onChangeAnnexes} extra={pageExtra} />}
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ Bloc sélectionné */
function BlockProps({ block, parent, catalog, forms, state, annex, onChange, onRegenerate }) {
  const { tr } = useI18n();
  const p = block.params;
  const def = block.type === 'data' ? catalog.datasets[p.dataset] : null;
  const result = state && state.result && state.result.ok ? state.result : null;
  const data = result ? result.data : null;
  return (
    <div className="section-gap">
      <h3>{tr(TYPE_LABEL[block.type] || block.type)}</h3>
      {parent && parent.type === 'repeat' && <p className="hint">{tr('Dans une section répétée : recalculé pour chaque élément.')}</p>}
      {block.type === 'heading' && <>
        <Field label={tr('Texte')} hint={tr('{periode}, {activite} et {bureau} sont remplacés automatiquement.')}><input className="input" value={p.text} maxLength={300} onChange={(e) => onChange({ text: e.target.value })} /></Field>
        <Field label={tr('Niveau')}><select className="select" value={p.level} onChange={(e) => onChange({ level: Number(e.target.value) })}><option value={1}>{tr('Titre principal')}</option><option value={2}>{tr('Section')}</option><option value={3}>{tr('Sous-section')}</option></select></Field>
      </>}
      {block.type === 'callout' && <>
        <Field label={tr('Style')}><select className="select" value={p.tone} onChange={(e) => onChange({ tone: e.target.value })}>
          <option value="info">{tr('Information')}</option><option value="success">{tr('Point fort')}</option><option value="warning">{tr('Point d\'attention')}</option><option value="critical">{tr('Critique')}</option>
        </select></Field>
        <Field label={tr('Titre')}><input className="input" value={p.title || ''} maxLength={200} onChange={(e) => onChange({ title: e.target.value })} /></Field>
      </>}
      {(block.type === 'text' || block.type === 'callout') && <p className="hint">{tr('Écrivez directement dans la page ; la barre d\'outils permet gras, titres, listes et insertion de valeurs calculées.')}</p>}
      {block.type === 'bulletin' && <>
        <p className="hint">{p.doc ? tr('Texte modifié à la main : il ne suit plus les chiffres.') : tr('Texte rédigé automatiquement à partir des chiffres de la période ; modifiez-le librement dans la page.')}</p>
        {p.doc && <Button size="sm" variant="secondary" icon={RefreshCw} onClick={onRegenerate}>{tr('Régénérer depuis les chiffres')}</Button>}
      </>}
      {block.type === 'kpis' && (
        <fieldset className="rd-checks"><legend>{tr('Chiffres affichés')}</legend>
          {Object.entries(catalog.kpis).map(([k, kp]) => (
            <label key={k} className="check"><input type="checkbox" checked={p.metrics.includes(k)} disabled={(p.metrics.length >= 8 && !p.metrics.includes(k)) || kp.available === false}
              onChange={(e) => { const m = e.target.checked ? [...p.metrics, k] : p.metrics.filter((x) => x !== k); if (m.length) onChange({ metrics: m }); }} /> {tr(kp.label)}{kp.available === false ? ` — ${tr(kp.reason)}` : ''}</label>
          ))}
        </fieldset>
      )}
      {block.type === 'data' && <DataProps p={p} def={def} catalog={catalog} forms={forms} data={data} result={result} annex={annex} onChange={onChange} />}
      {block.type === 'section' && <>
        <Field label={tr('Orientation')}><select className="select" value={p.orientation || 'portrait'} onChange={(e) => onChange({ orientation: e.target.value })}>
          <option value="portrait">{tr('Portrait')}</option><option value="landscape">{tr('Paysage')}</option>
        </select></Field>
        <Field label={tr('Format')}><select className="select" value={p.size || ''} onChange={(e) => onChange({ size: e.target.value || undefined })}>
          <option value="">{tr('Comme le document')}</option><option value="A4">A4</option><option value="16:9">16:9</option>
        </select></Field>
        <Field label={tr('Titre')} hint={tr('Repris dans le sommaire, le volet Pages et la variable {section} de l\'en-tête.')}><input className="input" value={p.title || ''} maxLength={200} onChange={(e) => onChange({ title: e.target.value || undefined })} /></Field>
        <div className="rd-row2">
          <Field label={tr('En-tête')}><select className="select" value={p.header || 'inherit'} onChange={(e) => onChange({ header: e.target.value })}>
            <option value="inherit">{tr('Celui du document')}</option><option value="none">{tr('Aucun')}</option>
          </select></Field>
          <Field label={tr('Pied de page')}><select className="select" value={p.footer || 'inherit'} onChange={(e) => onChange({ footer: e.target.value })}>
            <option value="inherit">{tr('Celui du document')}</option><option value="none">{tr('Aucun')}</option>
          </select></Field>
        </div>
        <p className="hint">{tr('Une section commence une nouvelle page avec sa propre orientation.')}</p>
      </>}
      {block.type === 'columns' && <Field label={tr('Répartition')}><select className="select" value={p.ratio} onChange={(e) => {
        const ratio = e.target.value; const n = ratio.split(':').length;
        const cols = [...p.cols]; while (cols.length < n) cols.push([]);
        onChange({ ratio, cols: n < cols.length ? [...cols.slice(0, n - 1), cols.slice(n - 1).flat()] : cols });
      }}>{['1:1', '2:1', '1:2', '1:1:1'].map((r) => <option key={r} value={r}>{r}</option>)}</select></Field>}
      {block.type === 'spacer' && <Field label={tr('Hauteur (mm)')}><input className="input" type="number" min="1" max="200" value={p.height || 8} onChange={(e) => onChange({ height: Math.max(1, Math.min(200, Number(e.target.value) || 8)) })} /></Field>}
      {block.type === 'repeat' && <>
        <Field label={tr('Répéter pour chaque')}><select className="select" value={p.over} onChange={(e) => onChange({ over: e.target.value })}>
          <option value="activity">{tr('Activité (fiche de suivi)')}</option><option value="bureau">{tr('Bureau')}</option><option value="partner">{tr('Partenaire')}</option>
        </select></Field>
        <p className="hint">{tr('Les blocs de la section sont recalculés pour chaque activité ou bureau ayant des données sur la période. Sélectionnez la section puis ajoutez des blocs pour les y placer.')}</p>
      </>}
    </div>
  );
}

function DataProps({ p, def, catalog, forms, data, result, annex, onChange }) {
  const { tr } = useI18n();
  const view = p.view || (def && def.defaultView) || 'table';
  const fig = p.figure || {};
  const setFig = (patch) => onChange({ figure: { ...fig, ...patch } });
  // Mesures possibles : toutes les colonnes numériques des données (hors colonnes mensuelles / domaines).
  const series = data ? (data.columns || []).filter((c) => ['int', 'dec', 'pct', 'money', 'rate'].includes(c.type) && !/^[md]:/.test(c.key)) : [];
  const advice = data ? viewAdvice(view, { rows: data.rows.length, series: chartSeries(def, data, { measure: p.measure }).length, timeSeries: (categoryColumn(data) || {}).type === 'month' }) : null;
  return (
    <>
      <Field label={tr('Données')}>
        <select className="select" value={p.dataset} onChange={(e) => { const d = catalog.datasets[e.target.value]; onChange({ dataset: e.target.value, view: d ? d.defaultView : 'table', columns: undefined, measure: undefined, sort: undefined, args: {} }); }}>
          {catalog.groups.map((g) => (
            <optgroup key={g.key} label={tr(g.label)}>
              {g.items.map((k) => <option key={k} value={k} disabled={catalog.datasets[k].available === false}>{tr(catalog.datasets[k].label)}</option>)}
            </optgroup>
          ))}
        </select>
      </Field>
      {def && def.origin && <p className="hint">{tr('Même calcul que : {page}', { page: tr(def.origin.page) })}</p>}
      {def && def.available === false && <p className="hint">{tr(def.reason)}</p>}
      {def && (
        <Field label={tr('Présentation')}>
          <div className="rd-seg" role="radiogroup" aria-label={tr('Présentation')}>
            {def.views.map((v) => <button key={v} type="button" role="radio" aria-checked={view === v} className={view === v ? 'is-active' : ''} onClick={() => onChange({ view: v })}>{tr(VIEW_LABELS[v] || v)}</button>)}
          </div>
        </Field>
      )}
      {advice && <p className="rd-advice"><Lightbulb size={13} aria-hidden="true" /> {tr(VIEW_ADVICE[advice])}</p>}
      {annex && !annex.inColumn && <AnnexProps p={p} annex={annex} onChange={onChange} />}
      {def && CHART.has(view) && series.length > 1 && (
        <Field label={tr('Mesure')}>
          <select className="select" value={p.measure || ''} onChange={(e) => onChange({ measure: e.target.value || undefined })}>
            <option value="">{tr('Mesures par défaut')}</option>
            {series.map((c) => <option key={c.key} value={c.key}>{tr(c.label)}</option>)}
          </select>
        </Field>
      )}
      <ArgsEditor def={def} args={p.args} filters={p.filters} forms={forms} onChange={(args) => onChange({ args })} />
      <fieldset className="rd-checks"><legend>{tr('Figure')}</legend>
        <Field label={tr('Titre')}><input className="input" value={fig.title || ''} maxLength={200} placeholder={def ? tr(def.label) : ''} onChange={(e) => setFig({ title: e.target.value || undefined })} /></Field>
        <Field label={tr('Sous-titre')}><input className="input" value={fig.subtitle || ''} maxLength={300} onChange={(e) => setFig({ subtitle: e.target.value || undefined })} /></Field>
        <Field label={tr('Source')} hint={tr('Vide : source automatique du jeu de données.')}><input className="input" value={fig.source || ''} maxLength={300} placeholder={(data && data.meta && data.meta.source) || ''} onChange={(e) => setFig({ source: e.target.value || undefined })} /></Field>
        <Field label={tr('Note')}><input className="input" value={fig.note || ''} maxLength={500} onChange={(e) => setFig({ note: e.target.value || undefined })} /></Field>
        <label className="check"><input type="checkbox" checked={fig.numbered !== false} onChange={(e) => setFig({ numbered: e.target.checked })} /> {tr('Numéroter (Figure n / Tableau n)')}</label>
        <label className="check"><input type="checkbox" checked={fig.showN !== false} onChange={(e) => setFig({ showN: e.target.checked })} /> {tr('Afficher n')}</label>
      </fieldset>
      {def && !def.dynamicColumns && (
        <fieldset className="rd-checks"><legend>{tr('Colonnes')}</legend>
          {def.columns.map((c) => {
            const cols = p.columns || def.columns.map((x) => x.key);
            return <label key={c.key} className="check"><input type="checkbox" checked={cols.includes(c.key)} onChange={(e) => {
              const next = e.target.checked ? [...cols, c.key] : cols.filter((x) => x !== c.key);
              onChange({ columns: next.length === def.columns.length ? undefined : def.columns.map((x) => x.key).filter((k) => next.includes(k)) });
            }} /> {tr(c.label)}</label>;
          })}
        </fieldset>
      )}
      {def && (
        <div className="rd-row2">
          <Field label={tr('Trier par')}>
            <select className="select" value={(p.sort && p.sort.key) || ''} onChange={(e) => onChange({ sort: e.target.value ? { key: e.target.value, dir: (p.sort && p.sort.dir) || 'desc' } : undefined })}>
              <option value="">{tr('Ordre du jeu')}</option>
              {def.columns.map((c) => <option key={c.key} value={c.key}>{tr(c.label)}</option>)}
            </select>
          </Field>
          <Field label={tr('Sens')}>
            <select className="select" value={(p.sort && p.sort.dir) || 'desc'} disabled={!p.sort} onChange={(e) => onChange({ sort: { ...p.sort, dir: e.target.value } })}>
              <option value="desc">{tr('Décroissant')}</option><option value="asc">{tr('Croissant')}</option>
            </select>
          </Field>
        </div>
      )}
      <Field label={tr('Nombre de lignes max.')}><input className="input" type="number" min="1" max="500" value={p.limit || ''} onChange={(e) => onChange({ limit: e.target.value ? Math.max(1, Math.min(500, Number(e.target.value))) : undefined })} /></Field>
      {def && def.annotate && <Annotations rows={data ? data.rows : []} label={def.annotate.label} value={p.annotations || {}} labelOf={(r) => r[def.columns[0].key]} onChange={(annotations) => onChange({ annotations })} />}
      {result && result.meta && result.meta.ms != null && <p className="hint">{tr('Calculé en {s} s.', { s: (result.meta.ms / 1000).toLocaleString(document.documentElement.lang === 'en' ? 'en-GB' : 'fr-FR', { maximumFractionDigits: 2 }) })}</p>}
    </>
  );
}

/**
 * Annexe (retour 88) : « Placer en annexe » — dans le corps, un renvoi « Voir l'annexe A » ; le bloc
 * est imprimé à la fin du rapport, sur sa propre page, dans son orientation. Coché automatiquement
 * au-delà du seuil de lignes du document (décocher le garde dans le corps).
 */
function AnnexProps({ p, annex, onChange }) {
  const { tr } = useI18n();
  const hint = !annex.effective ? tr('Le bloc est remplacé dans le corps par un renvoi ; il est imprimé à la fin du rapport, sur sa propre page.')
    : p.annex === true ? tr('Dans le corps : « Voir l\'annexe … » ; le bloc est à la fin du rapport, sur sa propre page.')
      : tr('En annexe automatiquement : plus de {n} lignes (réglage du document). Décochez pour le garder dans le corps.', { n: annex.autoRows });
  return (
    <fieldset className="rd-checks"><legend>{tr('Annexe')}</legend>
      <label className="check"><input type="checkbox" checked={annex.effective} onChange={(e) => onChange({ annex: e.target.checked })} /> {tr('Placer en annexe')}</label>
      {/* L'annexe automatique est un ÉTAT (toujours affiché) ; les autres phrases sont des astuces. */}
      <p className={annex.effective && p.annex !== true ? 'rd-state-line' : 'hint'}>{hint}</p>
      {annex.effective && (
        <Field label={tr('Orientation de l\'annexe')}>
          <select className="select" value={p.annexOrientation || 'auto'} onChange={(e) => onChange({ annexOrientation: e.target.value === 'auto' ? undefined : e.target.value })}>
            <option value="auto">{tr('Automatique (paysage si le tableau est large)')}</option>
            <option value="portrait">{tr('Portrait')}</option>
            <option value="landscape">{tr('Paysage')}</option>
          </select>
        </Field>
      )}
    </fieldset>
  );
}

/** Constat par ligne (clé stable) ; une note dont la ligne a disparu est gardée, marquée « ligne disparue ». */
function Annotations({ rows, label, value, labelOf, onChange }) {
  const { tr } = useI18n();
  const textOf = (d) => ((d && d.nodes) || []).map((n) => (n.c || []).map((s) => s.x || '').join('')).join('\n');
  const toDoc = (text) => ({ nodes: String(text).split('\n').map((line) => ({ t: 'p', c: [{ x: line }] })) });
  const keys = new Set(rows.filter((r) => r._key && !r._total).map((r) => r._key));
  const orphans = Object.keys(value).filter((k) => !keys.has(k));
  const set = (k, text) => { const next = { ...value }; if (text.trim()) next[k] = toDoc(text); else delete next[k]; onChange(Object.keys(next).length ? next : undefined); };
  return (
    <fieldset className="rd-checks"><legend>{tr(label)}</legend>
      {rows.filter((r) => r._key && !r._total).map((r) => (
        <Field key={r._key} label={String(labelOf(r) ?? r._key)}>
          <textarea className="input rd-annot-in" rows={2} maxLength={1000} value={textOf(value[r._key])} onChange={(e) => set(r._key, e.target.value)} />
        </Field>
      ))}
      {orphans.map((k) => (
        <Field key={k} label={`${k} — ${tr('ligne disparue')}`}>
          <textarea className="input rd-annot-in" rows={2} value={textOf(value[k])} onChange={(e) => set(k, e.target.value)} />
        </Field>
      ))}
      {!rows.length && !orphans.length && <p className="hint">{tr('Les lignes apparaissent une fois les données calculées.')}</p>}
    </fieldset>
  );
}

/* ------------------------------------------------------------------ Arguments */
const ARG_CHOICES = { activity: 'Programme (activité)', provider: 'TPM', office: 'Bureau', district: 'District' };
// Listes de choix des arguments (contrat, partenaire, facture) : lues à la demande.
const CHOICE_LOADERS = {
  contracts: () => api.listContracts().then((r) => (r || []).filter((c) => c.status !== 'brouillon').map((c) => ({ id: c.id, label: `${c.numero} — ${c.partnerName || ''}` }))),
  partners: () => api.listPartners().then((r) => (r || []).filter((p) => p.active !== false).map((p) => ({ id: p.id, label: p.name }))),
  reports: () => api.listReports({ kind: 'financier' }).then((r) => (r || []).filter((x) => x.kind === 'financier').map((x) => ({ id: x.id, label: `${String(x.periodMonth || '').slice(0, 7)} · ${x.partnerName || ''} · ${x.contractNumero || ''}` }))),
};
function useChoices(kind) {
  const [list, setList] = useState(null);
  useEffect(() => {
    if (!kind || !CHOICE_LOADERS[kind]) { setList(null); return undefined; }
    let alive = true;
    CHOICE_LOADERS[kind]().then((r) => { if (alive) setList(r); }).catch(() => { if (alive) setList([]); });
    return () => { alive = false; };
  }, [kind]);
  return list;
}
function ChoiceArg({ name, spec, value, onChange }) {
  const { tr } = useI18n();
  const list = useChoices(spec.choices);
  return (
    <Field label={tr(spec.label)}>
      <select className="select" value={value || ''} onChange={(e) => onChange(name, e.target.value)}>
        <option value="">{spec.required ? tr('Choisir…') : tr('Hérite du rapport')}</option>
        {(list || []).map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
      </select>
    </Field>
  );
}

/** Arguments d'un jeu de données (indicateur, seuil, regroupement, contrat…), déclarés par le catalogue. */
function ArgsEditor({ def, args, filters, forms, onChange }) {
  const { tr } = useI18n();
  const [inds, setInds] = useState(null);
  const needsInd = !!def && Object.values(def.args || {}).some((a) => a.choices === 'indicators');
  const formId = filters && filters.formId && filters.formId !== 'all' ? filters.formId : (forms.length === 1 ? forms[0].id : null);
  useEffect(() => {
    if (!needsInd || !formId) { setInds(null); return undefined; }
    let alive = true;
    api.monIndicators(formId).then((r) => { if (alive) setInds(r || []); }).catch(() => { if (alive) setInds([]); });
    return () => { alive = false; };
  }, [needsInd, formId]);
  const entries = Object.entries((def && def.args) || {});
  if (!entries.length) return null;
  const set = (k, v) => onChange({ ...(args || {}), [k]: v === '' || v == null ? undefined : v });
  return (
    <fieldset className="rd-checks"><legend>{tr('Paramètres des données')}</legend>
      {entries.map(([k, a]) => {
        const v = (args || {})[k];
        if (a.choices === 'indicators') {
          return (
            <Field key={k} label={tr(a.label)} hint={formId ? null : tr('Choisissez d\'abord une activité (fiche) dans les filtres du bloc.')}>
              <select className="select" value={v || ''} disabled={!formId} onChange={(e) => set(k, e.target.value)}>
                <option value="">{tr('Choisir…')}</option>
                {(inds || []).filter((i) => i.active !== false).map((i) => <option key={i.id} value={i.id}>{i.code ? `${i.code} — ${i.label}` : i.label}</option>)}
              </select>
            </Field>
          );
        }
        if (CHOICE_LOADERS[a.choices]) return <ChoiceArg key={k} name={k} spec={a} value={v} onChange={set} />;
        if (a.type === 'enum') {
          return (
            <Field key={k} label={tr(a.label)}>
              <select className="select" value={v || a.default || ''} onChange={(e) => set(k, e.target.value)}>
                {a.choices.map((c) => <option key={c} value={c}>{tr(ARG_CHOICES[c] || c)}</option>)}
              </select>
            </Field>
          );
        }
        if (a.type === 'number') {
          return <Field key={k} label={tr(a.label)}><input className="input" type="number" value={v ?? ''} placeholder={a.default != null ? String(a.default) : ''} onChange={(e) => set(k, e.target.value === '' ? undefined : Number(e.target.value))} /></Field>;
        }
        return <Field key={k} label={tr(a.label)}><input className="input" value={v || ''} maxLength={200} onChange={(e) => set(k, e.target.value)} /></Field>;
      })}
    </fieldset>
  );
}
