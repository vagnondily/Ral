import React, { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Search, Lock } from 'lucide-react';
import { useI18n } from '../../../lib/i18n.jsx';
import { BLOCK_TYPES } from './blockTypes.js';

// Synonymes de recherche par groupe (la recherche porte aussi sur les libellés traduits).
const SYNONYMS = {
  monitoring: 'suivi processus conformité indicateur fiche soumission données collecte visite agent',
  coverage: 'couverture plan visite site actif réalisé complétude terrain mmr',
  rbm: 'risque rbm site registre mmr priorité',
  budget: 'budget contrat réalisé planifié consommation dépense avenant',
  tpm: 'tpm prestataire partenaire facture rapport formation agent évaluation',
  pdd: 'pdd distribution urgence vivres cash bénéficiaire pipeline stock',
  alerts: 'alerte critique échéance',
  quality: 'qualité configuration liaison rattacher',
  map: 'carte district',
};
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/**
 * Volet « Catalogue » : recherche (libellés, groupes, synonymes), groupes repliables avec leur
 * nombre, chaque jeu avec sa page d'origine (« Même calcul que ») et son état (« Disponible avec
 * le lot 6a ») ; un clic insère le bloc après la sélection, on peut aussi le glisser sur la page.
 * En tête : les blocs de composition (titre, texte, encadré, section…).
 */
export default function CatalogPane({ catalog, onInsertType, onInsertDataset, searchRef }) {
  const { tr } = useI18n();
  const [q, setQ] = useState('');
  const [closed, setClosed] = useState(() => new Set());
  const nq = norm(q.trim());
  const groups = useMemo(() => catalog.groups.map((g) => {
    const items = g.items.filter((k) => {
      if (!nq) return true;
      const d = catalog.datasets[k];
      return [d.label, tr(d.label), g.label, tr(g.label), SYNONYMS[g.key], k, ...(d.keywords || [])].some((s) => norm(s).includes(nq));
    });
    return { ...g, items };
  }).filter((g) => g.items.length), [catalog, nq, tr]);
  const drag = (payload) => (e) => { e.dataTransfer.setData('text/x-mems-block', JSON.stringify(payload)); e.dataTransfer.effectAllowed = 'copy'; };
  return (
    <div className="rd-pane-body">
      <label className="rd-search">
        <Search size={14} aria-hidden="true" />
        <input ref={searchRef} type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={tr('couverture, budget, PDD…')} aria-label={tr('Rechercher dans le catalogue')} />
      </label>
      {!nq && (
        <>
          <h3 className="rd-pane-h">{tr('Mise en page et texte')}</h3>
          <div className="rd-palette">
            {BLOCK_TYPES.filter(([k]) => k !== 'data').map(([k, l, Icon]) => (
              <button key={k} type="button" draggable onDragStart={drag({ kind: 'type', key: k })} onClick={() => onInsertType(k)}><Icon size={16} aria-hidden="true" /><span>{tr(l)}</span></button>
            ))}
          </div>
        </>
      )}
      <h3 className="rd-pane-h">{tr('Données de MEMS')}</h3>
      {groups.length === 0 && <p className="hint">{tr('Aucun jeu de données ne correspond.')}</p>}
      {groups.map((g) => {
        const isClosed = !nq && closed.has(g.key);
        return (
          <section key={g.key} className="rd-cat-group">
            <button type="button" className="rd-cat-gh" aria-expanded={!isClosed} onClick={() => setClosed((s) => { const n = new Set(s); if (n.has(g.key)) n.delete(g.key); else n.add(g.key); return n; })}>
              {isClosed ? <ChevronRight size={14} aria-hidden="true" /> : <ChevronDown size={14} aria-hidden="true" />}
              <span>{tr(g.label)}</span><span className="rd-count">{g.items.length}</span>
            </button>
            {!isClosed && (
              <ul className="rd-cat-list">
                {g.items.map((k) => {
                  const d = catalog.datasets[k];
                  const off = d.available === false;
                  return (
                    <li key={k}>
                      <button type="button" className={`rd-cat-item ${off ? 'is-off' : ''}`} disabled={off} draggable={!off}
                        onDragStart={drag({ kind: 'dataset', key: k })} onClick={() => onInsertDataset(k)}
                        title={d.origin ? tr('Même calcul que : {page}', { page: tr(d.origin.page) }) : undefined}>
                        <span className="rd-cat-l">{tr(d.label)}</span>
                        {off ? <span className="rd-cat-o"><Lock size={11} aria-hidden="true" /> {tr(d.reason)}</span>
                          : d.origin && <span className="rd-cat-o">{tr('Même calcul que : {page}', { page: tr(d.origin.page) })}</span>}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}
