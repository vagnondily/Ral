import React, { useEffect, useRef } from 'react';
import { Bold, Italic, Underline, Heading2, Heading3, List, ListOrdered, Quote, Braces } from 'lucide-react';
import { useI18n } from '../../lib/i18n.jsx';

/**
 * Texte riche du concepteur de rapport. Stockage = JSON structuré
 * { nodes: [{ t: 'p'|'h2'|'h3'|'ul'|'ol'|'quote', c?: Inline[], items?: Inline[][] }] }
 * avec Inline = { x, b?, i?, u?, v? } (v = variable). Le RENDU produit des
 * éléments React (jamais de HTML injecté) ; l'ÉDITION passe par un
 * contentEditable dont le DOM est reconverti en JSON (balises inconnues
 * ignorées) — aucune injection possible dans le document enregistré.
 */
const BLOCK_TAGS = { P: 'p', DIV: 'p', H1: 'h2', H2: 'h2', H3: 'h3', H4: 'h3', BLOCKQUOTE: 'quote', UL: 'ul', OL: 'ol' };
// Caractère invisible placé après une variable pour que le curseur ait où se poser ; jamais enregistré.
const ZW = '\u200B';

export function renderInline(seg, vars, key, labelFor, pending) {
  let content = seg.v ? formatVar(vars?.[seg.v], seg.v, labelFor, pending) : seg.x;
  if (seg.u) content = <u>{content}</u>;
  if (seg.i) content = <em>{content}</em>;
  if (seg.b) content = <strong>{content}</strong>;
  return seg.v ? <span key={key} className="rt-var" data-var={seg.v}>{content}</span> : <React.Fragment key={key}>{content}</React.Fragment>;
}

function formatVar(value, name, labelFor, pending) {
  // Valeur calculée pas encore arrivée : « … », remplie à l'arrivée du calcul (rendu progressif).
  if ((value == null || value === '') && pending) return '…';
  if (value == null || value === '') return `{${labelFor ? labelFor(name) : name}}`;
  return typeof value === 'number' ? value.toLocaleString(document.documentElement.lang === 'en' ? 'en-GB' : 'fr-FR') : String(value);
}

/** Rendu en lecture (aperçu, impression, export HTML). */
export function RichTextView({ doc, vars, labelFor, pending }) {
  const nodes = (doc && doc.nodes) || [];
  return (
    <div className="rt">
      {nodes.map((n, i) => {
        const inl = (c) => (c || []).map((s, j) => renderInline(s, vars, j, labelFor, pending));
        if (n.t === 'ul' || n.t === 'ol') {
          const Tag = n.t;
          return <Tag key={i}>{(n.items || []).map((it, j) => <li key={j}>{inl(it)}</li>)}</Tag>;
        }
        if (n.t === 'h2') return <h2 key={i}>{inl(n.c)}</h2>;
        if (n.t === 'h3') return <h3 key={i}>{inl(n.c)}</h3>;
        if (n.t === 'quote') return <blockquote key={i}>{inl(n.c)}</blockquote>;
        return <p key={i}>{inl(n.c)}</p>;
      })}
    </div>
  );
}

// ---- DOM ⇄ JSON ------------------------------------------------------------------
function inlineFromDom(node, fmt = {}, out = []) {
  node.childNodes.forEach((ch) => {
    if (ch.nodeType === 3) { const x = ch.textContent.replaceAll(ZW, ''); if (x) out.push({ x, ...fmt }); return; }
    if (ch.nodeType !== 1) return;
    if (ch.dataset && ch.dataset.var) { out.push({ x: '', v: ch.dataset.var, ...fmt }); return; }
    const tag = ch.tagName;
    // Un <br> final est le « remplisseur » d'un paragraphe vide, pas un retour à la ligne.
    if (tag === 'BR') { if (ch.nextSibling) out.push({ x: '\n', ...fmt }); return; }
    const next = { ...fmt };
    if (tag === 'B' || tag === 'STRONG') next.b = true;
    if (tag === 'I' || tag === 'EM') next.i = true;
    if (tag === 'U') next.u = true;
    const st = ch.getAttribute && ch.getAttribute('style');
    if (st) { if (/font-weight:\s*(bold|[6-9]00)/.test(st)) next.b = true; if (/font-style:\s*italic/.test(st)) next.i = true; if (/underline/.test(st)) next.u = true; }
    inlineFromDom(ch, next, out);
  });
  // Fusion des segments contigus de même format (document compact).
  const merged = [];
  for (const s of out) {
    const last = merged[merged.length - 1];
    if (last && !s.v && !last.v && !!last.b === !!s.b && !!last.i === !!s.i && !!last.u === !!s.u) last.x += s.x;
    else merged.push({ ...s });
  }
  return merged.map((s) => Object.fromEntries(Object.entries(s).filter(([, v]) => v !== false && v !== undefined)));
}

export function domToDoc(root) {
  const nodes = [];
  const pushPara = (el, t) => { const c = inlineFromDom(el); if (c.length || t !== 'p') nodes.push({ t, c }); };
  // Texte et éléments en ligne posés directement à la racine (frappe dans un éditeur vide,
  // variable insérée…) : regroupés en UN paragraphe, dans l'ordre.
  let run = null;
  const flush = () => { if (run) { pushPara(run, 'p'); run = null; } };
  root.childNodes.forEach((ch) => {
    const block = ch.nodeType === 1 && BLOCK_TAGS[ch.tagName];
    if (!block) {
      if (ch.nodeType !== 3 && ch.nodeType !== 1) return;
      (run ||= document.createElement('p')).appendChild(ch.cloneNode(true));
      return;
    }
    flush();
    if (block === 'ul' || block === 'ol') {
      const items = [...ch.querySelectorAll(':scope > li')].map((li) => inlineFromDom(li));
      nodes.push({ t: block, items: items.length ? items : [[{ x: '' }]] });
    } else pushPara(ch, block);
  });
  flush();
  return { nodes: nodes.slice(0, 400) };
}

/** Éditeur : contentEditable + barre d'outils ; renvoie le JSON à chaque modification. */
export function RichTextEditor({ doc, onChange, vars, variableList = [], labelFor, autoFocus }) {
  const { tr } = useI18n();
  const ref = useRef(null);
  const lastDoc = useRef(null);
  // (Ré)initialise le DOM seulement si le document change de l'extérieur.
  useEffect(() => {
    if (!ref.current || lastDoc.current === doc) return;
    lastDoc.current = doc;
    ref.current.innerHTML = '';
    const frag = document.createDocumentFragment();
    for (const n of (doc && doc.nodes) || []) frag.appendChild(nodeToDom(n, vars, labelFor));
    if (!frag.childNodes.length) { const p = document.createElement('p'); p.appendChild(document.createElement('br')); frag.appendChild(p); }
    ref.current.appendChild(frag);
    if (autoFocus) ref.current.focus();
  }, [doc, vars, labelFor, autoFocus]);

  const emit = () => { const d = domToDoc(ref.current); lastDoc.current = d; onChange(d); };
  const cmd = (name, arg) => { ref.current.focus(); document.execCommand(name, false, arg); emit(); };
  // Dernière position du curseur dans l'éditeur : la liste des variables prend le focus,
  // l'insertion doit se faire là où l'utilisateur écrivait.
  const caret = useRef(null);
  const rememberCaret = () => {
    const sel = window.getSelection();
    if (sel && sel.rangeCount && ref.current?.contains(sel.anchorNode)) caret.current = sel.getRangeAt(0).cloneRange();
  };
  const insertVar = (v) => {
    const root = ref.current;
    root.focus();
    const span = document.createElement('span');
    span.className = 'rt-var'; span.dataset.var = v; span.contentEditable = 'false';
    span.textContent = formatVar(vars?.[v], v, labelFor);
    const after = document.createTextNode(ZW);
    let r = caret.current && root.contains(caret.current.startContainer) ? caret.current : null;
    if (!r) { // pas de position connue : fin du dernier paragraphe
      const last = root.lastElementChild && BLOCK_TAGS[root.lastElementChild.tagName] ? root.lastElementChild : root;
      r = document.createRange(); r.selectNodeContents(last); r.collapse(false);
    }
    r.deleteContents();
    r.insertNode(after); r.insertNode(span);
    const sel = window.getSelection();
    const pos = document.createRange(); pos.setStart(after, 1); pos.collapse(true);
    sel.removeAllRanges(); sel.addRange(pos); caret.current = pos.cloneRange();
    emit();
  };

  return (
    <div className="rt-editor">
      <div className="rt-toolbar" role="toolbar" aria-label={tr('Mise en forme')}>
        <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => cmd('bold')} title={tr('Gras')} aria-label={tr('Gras')}><Bold size={15} /></button>
        <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => cmd('italic')} title={tr('Italique')} aria-label={tr('Italique')}><Italic size={15} /></button>
        <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => cmd('underline')} title={tr('Souligné')} aria-label={tr('Souligné')}><Underline size={15} /></button>
        <span className="rt-sep" />
        <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => cmd('formatBlock', 'H2')} title={tr('Titre')} aria-label={tr('Titre')}><Heading2 size={15} /></button>
        <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => cmd('formatBlock', 'H3')} title={tr('Sous-titre')} aria-label={tr('Sous-titre')}><Heading3 size={15} /></button>
        <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => cmd('formatBlock', 'P')} title={tr('Paragraphe')} aria-label={tr('Paragraphe')}>¶</button>
        <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => cmd('insertUnorderedList')} title={tr('Liste à puces')} aria-label={tr('Liste à puces')}><List size={15} /></button>
        <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => cmd('insertOrderedList')} title={tr('Liste numérotée')} aria-label={tr('Liste numérotée')}><ListOrdered size={15} /></button>
        <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => cmd('formatBlock', 'BLOCKQUOTE')} title={tr('Citation')} aria-label={tr('Citation')}><Quote size={15} /></button>
        {variableList.length > 0 && (
          <label className="rt-varpick" title={tr('Insérer une valeur calculée')}>
            <Braces size={15} aria-hidden="true" />
            <select value="" onMouseDown={(e) => e.stopPropagation()} onChange={(e) => { if (e.target.value) insertVar(e.target.value); e.target.value = ''; }} aria-label={tr('Insérer une valeur calculée')}>
              <option value="">{tr('Variable…')}</option>
              {variableList.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
            </select>
          </label>
        )}
      </div>
      <div ref={ref} className="rt rt-editable" contentEditable suppressContentEditableWarning
        onInput={() => { emit(); rememberCaret(); }} onBlur={emit} onKeyUp={rememberCaret} onMouseUp={rememberCaret}
        onFocus={() => document.execCommand('defaultParagraphSeparator', false, 'p')}
        role="textbox" aria-multiline="true" aria-label={tr('Texte du bloc')}
        onPaste={(e) => { e.preventDefault(); document.execCommand('insertText', false, e.clipboardData.getData('text/plain')); }} />
    </div>
  );
}

function nodeToDom(n, vars, labelFor) {
  const fill = (el, segs) => {
    for (const s of segs || []) {
      let node;
      if (s.v) { node = document.createElement('span'); node.className = 'rt-var'; node.dataset.var = s.v; node.contentEditable = 'false'; node.textContent = formatVar(vars?.[s.v], s.v, labelFor); } else node = document.createTextNode(s.x);
      if (s.u) { const w = document.createElement('u'); w.appendChild(node); node = w; }
      if (s.i) { const w = document.createElement('em'); w.appendChild(node); node = w; }
      if (s.b) { const w = document.createElement('strong'); w.appendChild(node); node = w; }
      el.appendChild(node);
    }
  };
  if (n.t === 'ul' || n.t === 'ol') {
    const list = document.createElement(n.t);
    for (const it of n.items || []) { const li = document.createElement('li'); fill(li, it); if (!li.textContent) li.appendChild(document.createElement('br')); list.appendChild(li); }
    return list;
  }
  const el = document.createElement(n.t === 'quote' ? 'blockquote' : n.t);
  fill(el, n.c);
  if (!el.textContent) el.appendChild(document.createElement('br')); // paragraphe vide : cible du curseur
  return el;
}
