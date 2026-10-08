/**
 * Champs calculés (nettoyage / préparation « type Tableau ») — logique pure,
 * sans I/O, testée. Deux genres :
 *   • recode     : mappe les valeurs d'un champ source vers de nouvelles
 *                  valeurs (+ valeur par défaut). Ex. oui→1, non→0.
 *   • expression : petite formule sûre sur les champs (pas de eval). Supporte
 *     nombres, chaînes 'x'/"x", champs (nom nu ou [nom avec espaces]), les
 *     opérateurs + - * / % , comparaisons == != < <= > >= , && || ! et les
 *     fonctions if, num, round, lower, upper, len, abs, min, max, coalesce,
 *     contains, concat.
 *
 * Aucun accès à l'extérieur du row fourni : un parseur récursif descendant
 * évalue un AST, jamais de code arbitraire.
 */

// ---- Lexer ----------------------------------------------------------------
function tokenize(src) {
  const toks = [];
  const s = String(src || '');
  let i = 0;
  const two = { '==': 1, '!=': 1, '<=': 1, '>=': 1, '&&': 1, '||': 1 };
  while (i < s.length) {
    const c = s[i];
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') { i += 1; continue; }
    if (c === '[') { // [field name with spaces]
      const end = s.indexOf(']', i + 1);
      if (end < 0) throw new Error('Crochet [ non fermé');
      toks.push({ t: 'id', v: s.slice(i + 1, end).trim() }); i = end + 1; continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1; let str = '';
      while (j < s.length && s[j] !== c) { str += s[j]; j += 1; }
      if (j >= s.length) throw new Error('Chaîne non fermée');
      toks.push({ t: 'str', v: str }); i = j + 1; continue;
    }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(s[i + 1] || ''))) {
      let j = i; while (j < s.length && /[0-9.]/.test(s[j])) j += 1;
      toks.push({ t: 'num', v: Number(s.slice(i, j)) }); i = j; continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i; while (j < s.length && /[A-Za-z0-9_]/.test(s[j])) j += 1;
      toks.push({ t: 'id', v: s.slice(i, j) }); i = j; continue;
    }
    const pair = s.slice(i, i + 2);
    if (two[pair]) { toks.push({ t: 'op', v: pair }); i += 2; continue; }
    if ('+-*/%(),<>!'.includes(c)) { toks.push({ t: 'op', v: c }); i += 1; continue; }
    throw new Error(`Caractère invalide « ${c} »`);
  }
  return toks;
}

// ---- Parser (récursif descendant) ----------------------------------------
function parse(src) {
  const toks = tokenize(src);
  let p = 0;
  const peek = () => toks[p];
  const eat = (v) => { const tk = toks[p]; if (!tk || (v && tk.v !== v)) throw new Error(`Attendu « ${v} »`); p += 1; return tk; };
  const isOp = (v) => peek() && peek().t === 'op' && peek().v === v;

  function parseExpr() { return parseOr(); }
  function parseOr() { let a = parseAnd(); while (isOp('||')) { eat(); a = { k: 'bin', op: '||', a, b: parseAnd() }; } return a; }
  function parseAnd() { let a = parseCmp(); while (isOp('&&')) { eat(); a = { k: 'bin', op: '&&', a, b: parseCmp() }; } return a; }
  function parseCmp() {
    let a = parseAdd();
    while (peek() && peek().t === 'op' && ['==', '!=', '<', '<=', '>', '>='].includes(peek().v)) {
      const op = eat().v; a = { k: 'bin', op, a, b: parseAdd() };
    }
    return a;
  }
  function parseAdd() { let a = parseMul(); while (isOp('+') || isOp('-')) { const op = eat().v; a = { k: 'bin', op, a, b: parseMul() }; } return a; }
  function parseMul() { let a = parseUnary(); while (isOp('*') || isOp('/') || isOp('%')) { const op = eat().v; a = { k: 'bin', op, a, b: parseUnary() }; } return a; }
  function parseUnary() { if (isOp('-') || isOp('!')) { const op = eat().v; return { k: 'un', op, a: parseUnary() }; } return parsePrimary(); }
  function parsePrimary() {
    const tk = peek();
    if (!tk) throw new Error('Expression incomplète');
    if (tk.t === 'num') { eat(); return { k: 'num', v: tk.v }; }
    if (tk.t === 'str') { eat(); return { k: 'str', v: tk.v }; }
    if (isOp('(')) { eat('('); const e = parseExpr(); eat(')'); return e; }
    if (tk.t === 'id') {
      eat();
      if (isOp('(')) { // appel de fonction
        eat('('); const args = [];
        if (!isOp(')')) { args.push(parseExpr()); while (isOp(',')) { eat(','); args.push(parseExpr()); } }
        eat(')'); return { k: 'call', name: tk.v.toLowerCase(), args };
      }
      return { k: 'field', name: tk.v };
    }
    throw new Error('Jeton inattendu');
  }
  const ast = parseExpr();
  if (p !== toks.length) throw new Error('Expression mal formée');
  return ast;
}

// ---- Évaluation -----------------------------------------------------------
const toNum = (v) => { if (v == null || v === '') return null; const n = Number(v); return Number.isNaN(n) ? null : n; };
const truthy = (v) => (v != null && v !== '' && v !== 0 && v !== false && v !== 'false' && v !== 'non' && v !== 'no');

const FUNCS = {
  if: (a) => (truthy(a[0]) ? a[1] : a[2] ?? null),
  num: (a) => toNum(a[0]) ?? 0,
  round: (a) => { const n = toNum(a[0]); if (n == null) return null; const d = a[1] != null ? toNum(a[1]) : 0; const f = 10 ** (d || 0); return Math.round(n * f) / f; },
  lower: (a) => String(a[0] ?? '').toLowerCase(),
  upper: (a) => String(a[0] ?? '').toUpperCase(),
  len: (a) => String(a[0] ?? '').length,
  abs: (a) => { const n = toNum(a[0]); return n == null ? null : Math.abs(n); },
  min: (a) => Math.min(...a.map((x) => toNum(x)).filter((x) => x != null)),
  max: (a) => Math.max(...a.map((x) => toNum(x)).filter((x) => x != null)),
  coalesce: (a) => a.find((x) => x != null && x !== '') ?? null,
  contains: (a) => String(a[0] ?? '').toLowerCase().includes(String(a[1] ?? '').toLowerCase()),
  concat: (a) => a.map((x) => (x == null ? '' : String(x))).join(''),
};

function evalAst(node, scope) {
  switch (node.k) {
    case 'num': return node.v;
    case 'str': return node.v;
    case 'field': { const v = scope[node.name]; return v === undefined ? null : v; }
    case 'un': {
      const a = evalAst(node.a, scope);
      if (node.op === '-') { const n = toNum(a); return n == null ? null : -n; }
      return truthy(a) ? 0 : 1; // !
    }
    case 'call': {
      const fn = FUNCS[node.name];
      if (!fn) throw new Error(`Fonction inconnue « ${node.name} »`);
      return fn(node.args.map((x) => evalAst(x, scope)));
    }
    case 'bin': {
      const { op } = node;
      if (op === '&&') return truthy(evalAst(node.a, scope)) && truthy(evalAst(node.b, scope)) ? 1 : 0;
      if (op === '||') return truthy(evalAst(node.a, scope)) || truthy(evalAst(node.b, scope)) ? 1 : 0;
      const a = evalAst(node.a, scope); const b = evalAst(node.b, scope);
      if (['+', '-', '*', '/', '%'].includes(op)) {
        const na = toNum(a); const nb = toNum(b);
        if (na == null || nb == null) return null;
        if (op === '+') return na + nb; if (op === '-') return na - nb; if (op === '*') return na * nb;
        if (op === '/') return nb === 0 ? null : na / nb;
        return nb === 0 ? null : na % nb;
      }
      // comparaisons : numériques si les deux le sont, sinon chaînes
      const na = toNum(a); const nb = toNum(b);
      let x = a; let y = b;
      if (na != null && nb != null) { x = na; y = nb; } else { x = a == null ? '' : String(a); y = b == null ? '' : String(b); }
      switch (op) {
        case '==': return x === y ? 1 : 0;
        case '!=': return x !== y ? 1 : 0;
        case '<': return x < y ? 1 : 0;
        case '<=': return x <= y ? 1 : 0;
        case '>': return x > y ? 1 : 0;
        case '>=': return x >= y ? 1 : 0;
        default: throw new Error(`Opérateur « ${op} »`);
      }
    }
    default: throw new Error('Nœud inconnu');
  }
}

/** Évalue une expression sûre. Renvoie la valeur, ou null si erreur/vide. */
function evalExpression(expr, scope = {}) {
  if (!expr || !String(expr).trim()) return null;
  try { return evalAst(parse(expr), scope); } catch { return null; }
}

/** Valide une expression : renvoie un message d'erreur ou null si OK. */
function validateExpression(expr) {
  if (!expr || !String(expr).trim()) return 'Formule vide.';
  try { parse(expr); return null; } catch (e) { return e.message; }
}

/** Applique une définition recode : valeur source → mapping → défaut. */
function applyRecode(def, row) {
  const raw = row[def.sourceField];
  const key = raw == null ? '' : String(raw);
  const map = def.mapping || {};
  if (Object.prototype.hasOwnProperty.call(map, key)) return map[key];
  if (def.defaultValue != null && def.defaultValue !== '') return def.defaultValue;
  return raw === undefined ? null : raw;
}

/**
 * Calcule tous les champs dérivés d'un row, dans l'ordre (un champ peut
 * référencer un champ calculé précédent). Renvoie un objet {name: value}.
 */
function computeCalcFields(defs, row) {
  const out = {};
  const scope = { ...row };
  for (const def of defs || []) {
    let val = null;
    if (def.kind === 'recode') val = applyRecode(def, scope);
    else val = evalExpression(def.expression, scope);
    out[def.name] = val;
    scope[def.name] = val; // disponible pour les suivants
  }
  return out;
}

module.exports = { tokenize, parse, evalExpression, validateExpression, applyRecode, computeCalcFields };
