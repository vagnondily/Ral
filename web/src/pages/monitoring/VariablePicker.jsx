import React, { useId, useMemo, useRef, useState } from 'react';
import { Search, ListChecks, Database, FileQuestion, Sigma, AlertTriangle } from 'lucide-react';
import { useI18n } from '../../lib/i18n.jsx';
import { formatInt } from '../../lib/format.js';

/**
 * Choix de la variable source d'un indicateur : liste déroulante avec
 * recherche (nom OU libellé), groupée comme le catalogue de la fiche
 * (GET /forms/:id/variables, variableCatalog côté serveur) :
 *   - Questions du formulaire (XLSForm / .sav) ;
 *   - Options des choix multiples (« X.1 » = « question — choix », 1/0) ;
 *   - Colonnes vues seulement dans les données ;
 *   - Champs calculés (ƒ).
 * Chaque ligne montre le libellé, le nom technique, le type et le nombre de
 * réponses renseignées sur l'échantillon récent. Clavier : ↑ ↓ Entrée Échap.
 */
const GROUPS = [
  { kind: 'question', label: 'Questions du formulaire', icon: FileQuestion },
  { kind: 'option', label: 'Options des choix multiples', icon: ListChecks },
  { kind: 'data', label: 'Colonnes des données', icon: Database },
  { kind: 'calc', label: 'Champs calculés', icon: Sigma },
];
const PER_GROUP = 60;
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const isMultiple = (v) => /^select_multiple\b/i.test(String(v?.type || ''));

/** Variable choisie, par nom exact puis par variante de casse (comme le calcul). */
export function findVariable(all, name) {
  if (!name) return null;
  return all.find((v) => v.name === name) || all.find((v) => v.name.toLowerCase() === String(name).toLowerCase()) || null;
}

function FillText({ v, sampled }) {
  const { tr } = useI18n();
  if (!sampled || v.filled == null) return null;
  if (!v.filled) return <span className="vp-fill is-empty">{tr('jamais renseignée')}</span>;
  return <span className="vp-fill">{tr('renseignée {n}/{t}', { n: formatInt(v.filled), t: formatInt(sampled) })}</span>;
}

export default function VariablePicker({ id, variables, sampled, value, onChange, invalid, disabled }) {
  const { tr } = useI18n();
  const listId = useId();
  const inputRef = useRef(null);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const all = variables || [];
  const selected = findVariable(all, value);

  const { groups, flat } = useMemo(() => {
    const needle = norm(q.trim());
    const hit = (v) => !needle || norm(v.name).includes(needle) || norm(v.label).includes(needle);
    const out = [];
    const items = [];
    for (const g of GROUPS) {
      const list = all.filter((v) => v.kind === g.kind && hit(v));
      if (!list.length) continue;
      const shown = list.slice(0, PER_GROUP);
      out.push({ ...g, items: shown, hidden: list.length - shown.length });
      items.push(...shown);
    }
    return { groups: out, flat: items };
  }, [all, q]);
  const free = q.trim() && !findVariable(all, q.trim()) ? q.trim() : null;
  const options = free ? [...flat, { name: free, free: true }] : flat;

  function pick(v) {
    onChange(v.name, v.free ? null : v);
    setOpen(false);
    setQ('');
  }
  function onKeyDown(e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive((a) => Math.min(a + 1, options.length - 1)); } else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); } else if (e.key === 'Enter') {
      if (open && options[active]) { e.preventDefault(); pick(options[active]); }
    } else if (e.key === 'Escape' && open) { e.stopPropagation(); setOpen(false); setQ(''); }
  }
  const optId = (i) => `${listId}-o${i}`;
  let index = -1;
  // Options d'une question à choix multiples : à choisir plutôt que la question elle-même.
  const optionsOf = selected && isMultiple(selected) ? all.filter((v) => v.kind === 'option' && String(v.parent || '').toLowerCase() === selected.name.toLowerCase()) : [];

  return (
    <div className={`vp${invalid ? ' is-invalid' : ''}`}>
      <div className="vp-input">
        <Search size={15} aria-hidden="true" />
        <input ref={inputRef} id={id} className="input" role="combobox" aria-autocomplete="list" aria-expanded={open} aria-controls={listId}
          aria-activedescendant={open && options[active] ? optId(active) : undefined} disabled={disabled} autoComplete="off" spellCheck={false}
          value={open ? q : (selected ? (selected.label ? `${selected.label} — ${selected.name}` : selected.name) : value || '')}
          placeholder={tr('Rechercher une variable (nom ou libellé)…')}
          onFocus={() => { setOpen(true); setQ(''); setActive(0); }}
          onChange={(e) => { setQ(e.target.value); setOpen(true); setActive(0); }}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          onKeyDown={onKeyDown} />
      </div>
      {open && (
        <ul id={listId} role="listbox" className="vp-list" aria-label={tr('Variables de la fiche')}>
          {groups.map((g) => {
            const Icon = g.icon;
            return (
              <React.Fragment key={g.kind}>
                <li role="presentation" className="vp-group"><Icon size={13} aria-hidden="true" /> {tr(g.label)}</li>
                {g.items.map((v) => {
                  index += 1;
                  const i = index;
                  return (
                    <li key={`${g.kind}:${v.name}`} id={optId(i)} role="option" aria-selected={selected?.name === v.name}
                      className={`vp-item${i === active ? ' is-active' : ''}${selected?.name === v.name ? ' is-selected' : ''}`}
                      onMouseDown={(e) => e.preventDefault()} onMouseEnter={() => setActive(i)} onClick={() => pick(v)}>
                      <span className="vp-label">{v.kind === 'calc' ? 'ƒ ' : ''}{v.label || v.name}</span>
                      <span className="vp-meta">
                        <span className="mono">{v.name}</span>
                        {v.type && v.kind !== 'option' && <span className="vp-type">{v.type}</span>}
                        <FillText v={v} sampled={sampled} />
                      </span>
                    </li>
                  );
                })}
                {g.hidden > 0 && <li role="presentation" className="vp-more muted">{tr('… {n} autre(s) : affinez la recherche.', { n: formatInt(g.hidden) })}</li>}
              </React.Fragment>
            );
          })}
          {free && (() => {
            index += 1;
            const i = index;
            return (
              <li id={optId(i)} role="option" aria-selected={false} className={`vp-item vp-free${i === active ? ' is-active' : ''}`}
                onMouseDown={(e) => e.preventDefault()} onMouseEnter={() => setActive(i)} onClick={() => pick({ name: free, free: true })}>
                <span className="vp-label">{tr('Utiliser le nom « {name} »', { name: free })}</span>
                <span className="vp-meta muted">{tr('variable absente du catalogue : elle sera vérifiée à l\'enregistrement')}</span>
              </li>
            );
          })()}
          {!options.length && <li role="presentation" className="vp-more muted">{tr('Aucune variable ne correspond.')}</li>}
        </ul>
      )}
      {selected && (
        <div className="vp-selected">
          {selected.label && <div className="vp-sel-label">{selected.label}</div>}
          <div className="vp-meta">
            <span className="mono">{selected.name}</span>
            {selected.group && <span className="vp-group-path" title={selected.group}>{selected.group}</span>}
            <FillText v={selected} sampled={sampled} />
          </div>
          {/* Logique de saut (« relevant » du XLSForm) : la question n'est posée que si elle est vraie. */}
          {selected.relevant && (
            <div className="vp-relevant" title={tr('La question n\'est posée que si cette condition est vraie : les autres soumissions n\'ont pas de réponse (« sans réponse » ou « sans la variable » dans le calcul).')}>
              <span className="muted">{tr('Logique de saut :')}</span> <code className="skip-expr">{selected.relevant}</code>
            </div>
          )}
          {isMultiple(selected) && (
            <div className="vp-warn">
              <AlertTriangle size={14} aria-hidden="true" />
              <span>{tr('Question à choix multiples : sa réponse est une liste de choix (« 1 3 5 »). Pour compter un choix précis, choisissez une de ses options :')}
                {optionsOf.length > 0 && (
                  <span className="vp-opts">
                    {optionsOf.slice(0, 12).map((o) => (
                      <button key={o.name} type="button" className="fx-chip" onClick={() => pick(o)} title={o.label || o.name}>{o.name}</button>
                    ))}
                  </span>
                )}
              </span>
            </div>
          )}
        </div>
      )}
      {!selected && value && <div className="vp-selected muted">{tr('« {name} » n\'est pas dans le catalogue de la fiche : le serveur la vérifiera.', { name: value })}</div>}
    </div>
  );
}
