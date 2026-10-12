import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, AlertTriangle, XCircle, Search, Sigma, Variable, BookOpen, CornerDownLeft, Loader2 } from 'lucide-react';
import { api } from '../../api/client.js';
import { Button, Skeleton } from '../../components/ui.jsx';
import { useI18n } from '../../lib/i18n.jsx';
import { formatInt, formatLocale } from '../../lib/format.js';

/**
 * Éditeur de formule « à la Tableau » (retour n° 4) pour les champs calculés :
 *   - zone de saisie avec complétion (Tab) des fonctions et des variables ;
 *   - vérification en direct par le serveur (même moteur que le calcul) :
 *     erreur avec sa position, variables inconnues avec suggestion ;
 *   - panneau de référence : fonctions par catégorie (syntaxe, description,
 *     exemple, Insérer) et variables de la fiche (libellé, choix) ;
 *   - aperçu du résultat sur les soumissions réelles les plus récentes.
 * Le catalogue des fonctions vient de l'API : une seule source pour le calcul,
 * la vérification, l'éditeur et la page de documentation.
 */

export const CALC_CATEGORIES = ['Logique', 'Nombres', 'Texte', 'Choix multiples', 'Valeurs manquantes'];
const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
/** Référence d'une variable dans une formule : nom nu, ou entre crochets s'il contient « / », « . », espaces… */
export const refOf = (name) => (IDENT.test(name) ? name : `[${name}]`);

/** Catalogue des fonctions et opérateurs (mis en cache par le client API). */
export function useCalcFunctions() {
  const [cat, setCat] = useState(null);
  useEffect(() => {
    let alive = true;
    api.monCalcFunctions().then((c) => alive && setCat(c), () => alive && setCat({ functions: [], operators: [], failed: true }));
    return () => { alive = false; };
  }, []);
  return cat;
}

/** Mot en cours de frappe juste avant le curseur (hors crochets et guillemets). */
function wordAt(text, caret) {
  const before = text.slice(0, caret);
  const open = before.lastIndexOf('['); const close = before.lastIndexOf(']');
  const quotes = (before.match(/"/g) || []).length;
  if (open > close || quotes % 2 === 1) return { word: '', start: caret };
  const m = /[A-Za-z_][A-Za-z0-9_]*$/.exec(before);
  return m ? { word: m[0], start: caret - m[0].length } : { word: '', start: caret };
}

/** Aperçu (et vérification) d'une définition, recalculé 450 ms après la dernière frappe. */
export function useCalcPreview(formId, def, excludeId) {
  const [state, setState] = useState({ loading: false, data: null, error: null });
  const key = JSON.stringify(def);
  useEffect(() => {
    const empty = def.kind === 'recode' ? !def.sourceField : !String(def.expression || '').trim();
    if (empty) { setState({ loading: false, data: null, error: null }); return undefined; }
    let alive = true;
    setState((s) => ({ ...s, loading: true }));
    const h = setTimeout(() => {
      api.monCalcPreview(formId, { ...def, ...(excludeId ? { excludeId } : {}) })
        .then((data) => alive && setState({ loading: false, data, error: null }))
        .catch((e) => alive && setState({ loading: false, data: null, error: e.message }));
    }, 450);
    return () => { alive = false; clearTimeout(h); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formId, key, excludeId]);
  return state;
}

/** État de la formule : valide / avertissements / erreur avec le caractère fautif surligné. */
export function CalcStatus({ expression, preview }) {
  const { tr } = useI18n();
  const check = preview.data?.check;
  if (!String(expression || '').trim()) return <div className="fx-status is-idle">{tr('Tapez une formule, ou choisissez une fonction à droite.')}</div>;
  if (preview.loading && !check) return <div className="fx-status is-idle"><Loader2 size={14} className="spin" aria-hidden="true" /> {tr('Vérification…')}</div>;
  if (preview.error) return <div className="fx-status is-error" role="alert"><XCircle size={14} aria-hidden="true" /> {preview.error}</div>;
  if (!check) return null;
  if (check.error) {
    const text = String(expression);
    // Le serveur vérifie la formule sans ses espaces de tête : position recalée sur le texte affiché.
    const lead = text.length - text.trimStart().length;
    const at = check.error.at == null ? null : check.error.at + lead;
    return (
      <div className="fx-status is-error" role="alert">
        <div><XCircle size={14} aria-hidden="true" /> {tr('La formule contient une erreur')} : {check.error.message}
          {at != null && <span className="muted"> — {tr('caractère {n}', { n: at + 1 })}</span>}</div>
        {at != null && (
          <code className="fx-err-line">{text.slice(0, at)}<mark>{text.slice(at, at + 1) || ' '}</mark>{text.slice(at + 1)}</code>
        )}
      </div>
    );
  }
  return (
    <div className={`fx-status ${check.warnings.length ? 'is-warn' : 'is-ok'}`} role="status">
      {check.warnings.length
        ? check.warnings.map((w, i) => <div key={i}><AlertTriangle size={14} aria-hidden="true" /> {w.message}</div>)
        : <div><CheckCircle2 size={14} aria-hidden="true" /> {tr('La formule est valide.')}</div>}
    </div>
  );
}

const cellText = (v) => (v == null || v === '' ? null : typeof v === 'number' ? String(Math.round(v * 1000) / 1000) : String(v));

/** Aperçu du résultat : quelques soumissions réelles (variables → résultat) et répartition des valeurs. */
export function CalcPreviewPanel({ preview }) {
  const { tr } = useI18n();
  const d = preview.data;
  if (!d || d.check?.error || d.n == null) return null;
  if (d.n === 0) return <div className="fx-preview muted">{tr('Aucune soumission dans cette fiche : importez des données pour voir le résultat.')}</div>;
  const refs = (d.references || []).slice(0, 4);
  const filled = d.n - d.empty;
  return (
    <div className={`fx-preview${preview.loading ? ' is-stale' : ''}`}>
      <div className="fx-preview-head">
        <strong>{tr('Aperçu sur les {n} soumissions les plus récentes', { n: formatInt(d.n) })}</strong>
        <span className="muted">{tr('{f} avec un résultat · {e} vide(s) · {k} valeur(s) distincte(s)', { f: formatInt(filled), e: formatInt(d.empty), k: formatInt(d.distinct) })}</span>
      </div>
      <div className="fx-preview-grid">
        <div className="table-wrap">
          <table className="table table-compact">
            <thead><tr>{refs.map((r) => <th key={r} scope="col" className="mono">{r}</th>)}<th scope="col">{tr('Résultat')}</th></tr></thead>
            <tbody>
              {d.samples.map((s, i) => (
                <tr key={i}>
                  {refs.map((r) => <td key={r} className="mono">{cellText(s.inputs[r]) ?? <span className="muted">—</span>}</td>)}
                  <td className="mono"><strong>{cellText(s.value) ?? <span className="muted">{tr('vide')}</span>}</strong></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <ul className="fx-dist" aria-label={tr('Répartition des résultats')}>
          {d.distribution.map((x) => {
            const pct = d.n ? Math.round((x.n / d.n) * 1000) / 10 : 0;
            return (
              <li key={x.value}>
                <span className="fx-dist-value mono" title={x.value}>{x.value}</span>
                <span className="fx-dist-bar" aria-hidden="true"><span style={{ width: `${Math.max(2, pct)}%` }} /></span>
                <span className="tabular">{formatInt(x.n)} <span className="muted">({pct.toLocaleString(formatLocale(), { maximumFractionDigits: 1 })} %)</span></span>
              </li>
            );
          })}
          {d.otherCount > 0 && <li className="muted">{tr('autres valeurs : {n}', { n: formatInt(d.otherCount) })}</li>}
          {d.empty > 0 && <li className="muted">{tr('vides : {n}', { n: formatInt(d.empty) })}</li>}
        </ul>
      </div>
    </div>
  );
}

export default function FormulaEditor({ formId, value, onChange, excludeId, variables }) {
  const { tr } = useI18n();
  const cat = useCalcFunctions();
  const ta = useRef(null);
  const [caret, setCaret] = useState(String(value || '').length);
  const [tab, setTab] = useState('fn');
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('');
  const [picked, setPicked] = useState('if');
  const def = useMemo(() => ({ kind: 'expression', expression: value }), [value]);
  const preview = useCalcPreview(formId, def, excludeId);

  const functions = cat?.functions || [];
  const vars = useMemo(() => {
    // Champs calculés utilisables : ceux qui PRÉCÈDENT celui qu'on édite (calcul dans l'ordre de la liste).
    const calcs = variables?.calcFields || [];
    const at = excludeId ? calcs.findIndex((c) => c.id === excludeId) : -1;
    return [
      ...(at >= 0 ? calcs.slice(0, at) : calcs).map((c) => ({ name: c.name, label: c.label, calc: true })),
      ...(variables?.fields || []),
    ];
  }, [variables, excludeId]);
  const text = String(value || '');
  const current = wordAt(text, caret);
  const needle = (q.trim() || current.word).toLowerCase();

  const fnShown = functions.filter((f) => (!category || f.category === category)
    && (!needle || f.name.includes(needle) || (q.trim() && tr(f.description).toLowerCase().includes(needle))));
  const varShown = vars.filter((v) => !needle || v.name.toLowerCase().includes(needle) || String(v.label || '').toLowerCase().includes(needle)).slice(0, 200);
  // Complétion : ce qui commence par le mot en cours (fonctions d'abord).
  const suggestions = current.word ? [
    ...functions.filter((f) => f.name.startsWith(current.word.toLowerCase()) && f.name !== current.word.toLowerCase()).map((f) => ({ kind: 'fn', name: f.name })),
    ...vars.filter((v) => v.name.toLowerCase().startsWith(current.word.toLowerCase()) && v.name !== current.word).slice(0, 6).map((v) => ({ kind: 'var', name: v.name })),
  ].slice(0, 6) : [];

  function insert(snippet, caretInSnippet = snippet.length) {
    const el = ta.current;
    const start = el ? el.selectionStart : text.length;
    const end = el ? el.selectionEnd : text.length;
    const w = wordAt(text, start);
    const from = w.word && start === end ? w.start : start;
    const next = text.slice(0, from) + snippet + text.slice(end);
    onChange(next);
    const pos = from + caretInSnippet;
    requestAnimationFrame(() => { if (el) { el.focus(); el.setSelectionRange(pos, pos); } setCaret(pos); });
  }
  const insertFn = (name) => insert(`${name}()`, name.length + 1);
  const insertVar = (name) => insert(refOf(name));
  const accept = (s) => (s.kind === 'fn' ? insertFn(s.name) : insertVar(s.name));

  const pickedFn = functions.find((f) => f.name === picked);
  const syncCaret = (e) => setCaret(e.target.selectionStart);

  return (
    <div className="fx-editor">
      <div className="fx-main">
        <label className="field-label" htmlFor="fx-input">{tr('Formule')}</label>
        <textarea id="fx-input" ref={ta} className="input mono fx-input" rows={4} spellCheck={false} value={text}
          placeholder={'if(selected(process_monitoring, "1"), 1, 0)'}
          aria-describedby="fx-help"
          onChange={(e) => { onChange(e.target.value); setCaret(e.target.selectionStart); }}
          onKeyUp={syncCaret} onClick={syncCaret} onSelect={syncCaret}
          onKeyDown={(e) => {
            if (e.key === 'Tab' && !e.shiftKey && suggestions.length) { e.preventDefault(); accept(suggestions[0]); return; }
            // « ) » devant la parenthèse fermante insérée par la complétion : on la saute au lieu d'en ajouter une.
            const el = e.currentTarget;
            if (e.key === ')' && el.selectionStart === el.selectionEnd && text[el.selectionStart] === ')') {
              e.preventDefault(); const pos = el.selectionStart + 1; el.setSelectionRange(pos, pos); setCaret(pos);
            }
          }} />
        <div id="fx-help" className="fx-suggest">
          {suggestions.length ? (
            <>
              <span className="muted"><CornerDownLeft size={12} aria-hidden="true" /> {tr('Tab pour compléter')} :</span>
              {suggestions.map((s) => (
                <button key={`${s.kind}:${s.name}`} type="button" className="fx-chip" onMouseDown={(e) => e.preventDefault()} onClick={() => accept(s)}>
                  {s.kind === 'fn' ? <><Sigma size={12} aria-hidden="true" /> {s.name}( )</> : <><Variable size={12} aria-hidden="true" /> {s.name}</>}
                </button>
              ))}
            </>
          ) : (
            <span className="muted">{tr('Opérateurs : + − * / , = <> < <= > >= , AND OR NOT. Texte entre guillemets ; variable avec « / » ou espaces entre crochets : [process_monitoring/3].')}</span>
          )}
        </div>
        <CalcStatus expression={text} preview={preview} />
        <CalcPreviewPanel preview={preview} />
      </div>

      <aside className="fx-ref" aria-label={tr('Aide à la saisie')}>
        <div className="seg fx-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={tab === 'fn'} className={tab === 'fn' ? 'is-active' : ''} onClick={() => setTab('fn')}>
            <Sigma size={14} aria-hidden="true" /> {tr('Fonctions')}
          </button>
          <button type="button" role="tab" aria-selected={tab === 'var'} className={tab === 'var' ? 'is-active' : ''} onClick={() => setTab('var')}>
            <Variable size={14} aria-hidden="true" /> {tr('Variables')} <span className="muted">{formatInt(vars.length)}</span>
          </button>
        </div>
        <div className="fx-search">
          <Search size={14} aria-hidden="true" />
          <input className="input input-sm" value={q} onChange={(e) => setQ(e.target.value)}
            placeholder={tab === 'fn' ? tr('Rechercher une fonction…') : tr('Rechercher une variable (nom ou libellé)…')} aria-label={tr('Rechercher')} />
        </div>
        {tab === 'fn' ? (
          <>
            <div className="fx-cats" role="group" aria-label={tr('Catégories')}>
              <button type="button" aria-pressed={!category} onClick={() => setCategory('')}>{tr('Toutes')}</button>
              {CALC_CATEGORIES.map((c) => <button key={c} type="button" aria-pressed={category === c} onClick={() => setCategory(category === c ? '' : c)}>{tr(c)}</button>)}
            </div>
            {cat === null ? <Skeleton height={120} /> : (
              <ul className="fx-list">
                {fnShown.map((f) => (
                  <li key={f.name}>
                    <button type="button" className={picked === f.name ? 'is-active' : ''} onClick={() => setPicked(f.name)} onDoubleClick={() => insertFn(f.name)}>
                      <span className="mono">{f.name}</span><span className="muted">{tr(f.category)}</span>
                    </button>
                  </li>
                ))}
                {!fnShown.length && <li className="muted fx-none">{tr('Aucune fonction ne correspond.')}</li>}
              </ul>
            )}
            {pickedFn && (
              <div className="fx-doc">
                <code className="fx-syntax">{pickedFn.syntax}</code>
                <p>{tr(pickedFn.description)}</p>
                <div className="fx-example"><span className="muted">{tr('Exemple')}</span><code>{pickedFn.example}</code></div>
                <Button size="sm" variant="secondary" onClick={() => insertFn(pickedFn.name)}>{tr('Insérer {name}( )', { name: pickedFn.name })}</Button>
              </div>
            )}
          </>
        ) : (
          <ul className="fx-list fx-vars">
            {varShown.map((v) => (
              <li key={`${v.calc ? 'c' : 'f'}:${v.name}`}>
                <button type="button" onClick={() => insertVar(v.name)} title={tr('Insérer {name}', { name: refOf(v.name) })}>
                  <span className="mono">{v.calc ? 'ƒ ' : ''}{v.name}</span>
                  {v.label && v.label !== v.name && <span className="fx-var-label">{v.label}</span>}
                  {v.type === 'select_multiple' && <span className="fx-var-hint">{tr('choix multiples : selected({name}, "…")', { name: refOf(v.name) })}</span>}
                  {v.choices?.length > 0 && v.type !== 'select_multiple' && (
                    <span className="fx-var-hint" title={v.choices.map((c) => `${c.value} = ${c.label}`).join(' · ')}>
                      {v.choices.slice(0, 3).map((c) => `${c.value} = ${c.label}`).join(' · ')}{v.choices.length > 3 ? ' …' : ''}
                    </span>
                  )}
                </button>
              </li>
            ))}
            {!varShown.length && <li className="muted fx-none">{variables ? tr('Aucune variable ne correspond.') : tr('Chargement…')}</li>}
          </ul>
        )}
        <a className="fx-doclink" href="#/processus/calculs" target="_blank" rel="noopener noreferrer">
          <BookOpen size={14} aria-hidden="true" /> {tr('Comment les calculs sont faits')}
        </a>
      </aside>
    </div>
  );
}
