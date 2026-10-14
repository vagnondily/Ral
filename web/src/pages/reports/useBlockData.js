import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../api/client.js';
import { findBlock } from './reportDoc.js';

/**
 * Données d'un rapport, BLOC PAR BLOC (lot 7a) — jamais de page blanche :
 *  1. le contenu fixe s'affiche tout de suite (l'éditeur n'attend rien) ;
 *  2. le PLAN (POST /render/plan, sans calcul lourd) donne les instances, les figures
 *     numérotées et les filtres effectifs ;
 *  3. les blocs de données sont demandés par lots de 8 (POST /render/blocks), 3 requêtes
 *     en parallèle au plus, ceux de la partie visible d'abord (IntersectionObserver),
 *     puis le reste dans l'ordre du document.
 * Cache par SIGNATURE DE DONNÉES (jeu, paramètres utiles, filtres effectifs, langue) :
 * modifier un texte, déplacer un bloc ou changer un titre ne relance aucun calcul ;
 * changer un filtre ne recalcule que les blocs concernés. « Actualiser » vide le cache.
 *
 * États d'un bloc : waiting, loading (startedAt), ready, error (Réessayer).
 * Un document finalisé lit ses données figées (une requête, aucun recalcul).
 */
const MAX_PARALLEL = 3;
const BATCH = 8;
const PLAN_DEBOUNCE = 250;

const mark = (name) => { try { if (typeof performance !== 'undefined' && performance.mark) performance.mark(name); } catch { /* sans incidence */ } };

/** Paramètres d'un bloc qui changent ses DONNÉES (le titre, la vue, les constats n'en font pas partie). */
function dataParams(b) {
  const p = b.params || {};
  switch (b.type) {
    case 'data': return { d: p.dataset, a: p.args, s: p.sort, l: p.limit };
    case 'kpis': return { m: p.metrics };
    case 'bulletin': return { g: !p.doc };
    case 'text': case 'callout': return { v: JSON.stringify(p.doc || {}).match(/"v":"[a-z_0-9]+"/g) };
    default: return {};
  }
}

/**
 * Signature de données d'une instance : tout ce qui détermine ses données, lu dans le
 * DOCUMENT envoyé (paramètres utiles et filtres du bloc, filtres et période du rapport,
 * élément répété de l'identifiant) — jamais dans un plan peut-être en retard.
 */
const signatureOf = (inst, block, doc, lang, epoch) => {
  const repeatPart = inst.iid.includes('~') ? inst.iid.slice(0, inst.iid.lastIndexOf('~')) : '';
  return JSON.stringify([block.type, dataParams(block), (block.params || {}).filters || null, doc.filters || null, doc.period, repeatPart, lang, epoch]);
};

/** Signature du PLAN : structure du document (blocs, répétitions, sections, vues), période, filtres, langue. */
function planSignature(doc, lang) {
  const strip = (b) => {
    const p = b.params || {};
    if (b.type === 'repeat') return [b.id, b.type, p.over, p.blocks.map(strip)];
    if (b.type === 'columns') return [b.id, b.type, p.cols.map((c) => c.map(strip))];
    if (b.type === 'heading') return [b.id, b.type, p.text, p.level];
    if (b.type === 'section') return [b.id, b.type, p.orientation, p.size, p.title, p.header, p.footer];
    if (b.type === 'data') return [b.id, b.type, p.dataset, p.view, p.filters, (p.figure || {}).numbered];
    if (b.type === 'text' || b.type === 'callout') return [b.id, b.type, dataParams(b).v, p.filters];
    return [b.id, b.type, p.filters];
  };
  return JSON.stringify([doc.title, doc.period, doc.filters, doc.page && [doc.page.size, doc.page.orientation, doc.page.header, doc.page.footer], doc.blocks.map(strip), lang]);
}

export function useBlockData({ doc, frozenId = null, lang = 'fr' }) {
  const [plan, setPlan] = useState(null);
  const [planError, setPlanError] = useState(null);
  const [states, setStates] = useState({}); // iid → { status, startedAt?, result?, sig? }
  const [epoch, setEpoch] = useState(0); // « Actualiser les données »
  const [planNonce, setPlanNonce] = useState(0); // plan à recharger (document modifié entre plan et blocs)
  const cache = useRef(new Map()); // signature → résultat
  const inflight = useRef(new Set()); // signatures en cours
  const queue = useRef([]); // iids en attente, ordre du document
  const running = useRef(0);
  const visible = useRef(new Set());
  const docRef = useRef(doc);
  const planRef = useRef(null);
  docRef.current = doc;

  // ---- Document finalisé : données figées, une requête.
  useEffect(() => {
    if (!frozenId) return undefined;
    let alive = true;
    api.reportDocumentData(frozenId).then((d) => {
      if (!alive) return;
      setPlan(d); planRef.current = d;
      setStates(Object.fromEntries(Object.entries(d.blocks || {}).map(([iid, r]) => [iid, { status: r.ok ? 'ready' : 'error', result: r }])));
    }, (e) => alive && setPlanError(e.message));
    return () => { alive = false; };
  }, [frozenId]);

  // ---- Plan (anti-rebond court) ; le plan précédent reste affiché pendant le recalcul.
  const pSig = useMemo(() => (frozenId ? null : planSignature(doc, lang)), [doc, lang, frozenId]);
  useEffect(() => {
    if (frozenId) return undefined;
    let alive = true;
    const h = setTimeout(() => {
      api.reportPlan(docRef.current).then((p) => {
        if (!alive) return;
        setPlanError(null); setPlan(p); planRef.current = p;
      }, (e) => alive && setPlanError(e.message));
    }, planRef.current ? PLAN_DEBOUNCE : 0);
    return () => { alive = false; clearTimeout(h); };
  }, [pSig, frozenId, planNonce]);

  // ---- Envoi d'un lot.
  const pump = useCallback(() => {
    if (frozenId) return;
    while (running.current < MAX_PARALLEL && queue.current.length) {
      const p = planRef.current;
      if (!p) return;
      const d = docRef.current;
      // Les blocs visibles d'abord, puis l'ordre du document.
      const ordered = [...queue.current].sort((a, b) => (visible.current.has(b) ? 1 : 0) - (visible.current.has(a) ? 1 : 0));
      const batch = []; const sigs = {};
      for (const iid of ordered) {
        if (batch.length >= BATCH) break;
        const inst = p.instances.find((i) => i.iid === iid);
        const found = inst && findBlock(d.blocks, inst.blockId);
        if (!inst || !found) { queue.current = queue.current.filter((x) => x !== iid); continue; }
        const sig = signatureOf(inst, found.block, d, lang, epoch);
        if (inflight.current.has(sig)) { queue.current = queue.current.filter((x) => x !== iid); continue; }
        batch.push(iid); sigs[iid] = sig;
      }
      if (!batch.length) return;
      queue.current = queue.current.filter((x) => !batch.includes(x));
      batch.forEach((iid) => { inflight.current.add(sigs[iid]); mark(`rd:block:${iid}:start`); });
      running.current += 1;
      const startedAt = Date.now();
      setStates((s) => ({ ...s, ...Object.fromEntries(batch.map((iid) => [iid, { ...(s[iid] || {}), status: 'loading', startedAt, sig: sigs[iid] }])) }));
      api.reportBlocks(d, batch).then((r) => {
        const upd = {};
        for (const iid of batch) {
          const res = r.blocks[iid];
          cache.current.set(sigs[iid], res);
          upd[iid] = { status: res && res.ok ? 'ready' : 'error', result: res, sig: sigs[iid] };
          mark(`rd:block:${iid}:end`);
        }
        setStates((s) => ({ ...s, ...upd }));
      }, (e) => {
        const err = { ok: false, error: { code: e.status === 503 ? 'busy' : 'request', message: e.message } };
        setStates((s) => ({ ...s, ...Object.fromEntries(batch.map((iid) => [iid, { status: 'error', result: err, sig: sigs[iid] }])) }));
        // Document modifié entre le plan et les blocs : le plan sera recalculé, les blocs redemandés.
        if (e.details && e.details.code === 'unknown_iid') setPlanNonce((n) => n + 1);
      }).finally(() => {
        batch.forEach((iid) => inflight.current.delete(sigs[iid]));
        running.current -= 1;
        pump();
      });
    }
  }, [frozenId, lang, epoch]);

  // ---- À chaque plan (ou document) : servir le cache, mettre le reste en file.
  useEffect(() => {
    if (frozenId || !plan) return;
    const upd = {}; const want = [];
    for (const inst of plan.instances) {
      if (!inst.needsData) continue;
      const found = findBlock(doc.blocks, inst.blockId);
      if (!found) continue;
      const sig = signatureOf(inst, found.block, doc, lang, epoch);
      const hit = cache.current.get(sig);
      if (hit) upd[inst.iid] = { status: hit.ok ? 'ready' : 'error', result: hit, sig };
      else if (!inflight.current.has(sig)) { upd[inst.iid] = { status: 'waiting', sig }; want.push(inst.iid); }
    }
    setStates((s) => {
      const next = {};
      for (const inst of plan.instances) if (inst.needsData) next[inst.iid] = upd[inst.iid] || s[inst.iid] || { status: 'waiting' };
      return next;
    });
    queue.current = want;
    pump();
  }, [plan, doc, lang, epoch, frozenId, pump]);

  // ---- Visibilité (priorité aux blocs à l'écran).
  const observer = useRef(null);
  const observe = useCallback((iid, el) => {
    if (!el || typeof IntersectionObserver === 'undefined') return;
    if (!observer.current) {
      observer.current = new IntersectionObserver((entries) => {
        for (const e of entries) {
          const id = e.target.getAttribute('data-iid');
          if (e.isIntersecting) visible.current.add(id); else visible.current.delete(id);
        }
      }, { rootMargin: '200px' });
    }
    el.setAttribute('data-iid', iid);
    observer.current.observe(el);
  }, []);
  useEffect(() => () => { if (observer.current) observer.current.disconnect(); }, []);

  const retry = useCallback((iid) => {
    const st = states[iid];
    if (st && st.sig) cache.current.delete(st.sig);
    setStates((s) => ({ ...s, [iid]: { status: 'waiting' } }));
    if (!queue.current.includes(iid)) queue.current.push(iid);
    pump();
  }, [states, pump]);

  const refresh = useCallback(() => { cache.current.clear(); setEpoch((e) => e + 1); }, []);

  const results = useMemo(() => Object.fromEntries(Object.entries(states).map(([iid, s]) => [iid, s.result])), [states]);
  const progress = useMemo(() => {
    const all = Object.values(states);
    return { total: all.length, done: all.filter((s) => s.status === 'ready' || s.status === 'error').length };
  }, [states]);
  return { plan, planError, states, results, progress, observe, retry, refresh };
}

export { signatureOf, planSignature, dataParams };
