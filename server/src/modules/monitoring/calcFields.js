/**
 * Champs calculés (nettoyage / préparation « type Tableau ») — logique pure,
 * sans I/O, testée. Deux genres :
 *   • recode     : mappe les valeurs d'un champ source vers de nouvelles
 *                  valeurs (+ valeur par défaut). Ex. oui→1, non→0.
 *   • expression : petite formule sûre sur les champs (pas de eval). Supporte
 *     nombres, chaînes 'x'/"x", champs (nom nu ou [nom avec espaces]), les
 *     opérateurs + - * / % , comparaisons = == != <> < <= > >= , && || ! (ou
 *     AND OR NOT, comme dans Tableau) et les fonctions du catalogue FUNCTIONS.
 *
 * Aucun accès à l'extérieur du row fourni : un parseur récursif descendant
 * évalue un AST, jamais de code arbitraire.
 *
 * FUNCTIONS est la source unique du catalogue : il sert à évaluer, à vérifier
 * une formule (fonction inconnue, nombre d'arguments) et à documenter
 * (éditeur de formule et page « Comment les calculs sont faits »).
 */

/** Erreur de formule, avec la position (index du caractère) où elle se trouve. */
class CalcError extends Error {
  constructor(message, at = null) { super(message); this.at = at; }
}

// ---- Lexer ----------------------------------------------------------------
// Mots-clés à la Tableau, insensibles à la casse (hors crochets) : AND, OR, NOT, NULL.
const KEYWORD_OPS = { and: '&&', or: '||', not: '!' };

function tokenize(src) {
  const toks = [];
  const s = String(src || '');
  let i = 0;
  const two = { '==': '==', '!=': '!=', '<>': '!=', '<=': '<=', '>=': '>=', '&&': '&&', '||': '||' };
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) { i += 1; continue; } // tout blanc Unicode (espace insécable, BOM, tabulation verticale…)
    if (c === '[') { // [nom de champ avec espaces]
      const end = s.indexOf(']', i + 1);
      if (end < 0) throw new CalcError('Crochet [ non fermé', i);
      toks.push({ t: 'id', v: s.slice(i + 1, end).trim(), at: i, quoted: true }); i = end + 1; continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1; let str = '';
      while (j < s.length && s[j] !== c) { str += s[j]; j += 1; }
      if (j >= s.length) throw new CalcError('Texte entre guillemets non fermé', i);
      toks.push({ t: 'str', v: str, at: i }); i = j + 1; continue;
    }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(s[i + 1] || ''))) {
      let j = i; while (j < s.length && /[0-9.]/.test(s[j])) j += 1;
      const text = s.slice(i, j);
      if ((text.match(/\./g) || []).length > 1) throw new CalcError(`Nombre mal écrit « ${text} »`, i);
      toks.push({ t: 'num', v: Number(text), at: i }); i = j; continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i; while (j < s.length && /[A-Za-z0-9_]/.test(s[j])) j += 1;
      const word = s.slice(i, j);
      const lw = word.toLowerCase();
      // AND / OR / NOT sont toujours des opérateurs (« a AND (b OR c) », « NOT (x) ») ;
      // une variable qui porterait ce nom s'écrit entre crochets : [or].
      if (KEYWORD_OPS[lw]) toks.push({ t: 'op', v: KEYWORD_OPS[lw], at: i });
      else if (lw === 'null') toks.push({ t: 'null', at: i });
      else toks.push({ t: 'id', v: word, at: i });
      i = j; continue;
    }
    const pair = s.slice(i, i + 2);
    if (two[pair]) { toks.push({ t: 'op', v: two[pair], at: i }); i += 2; continue; }
    if (c === '=') { toks.push({ t: 'op', v: '==', at: i }); i += 1; continue; } // « = » de Tableau
    if ('+-*/%(),<>!'.includes(c)) { toks.push({ t: 'op', v: c, at: i }); i += 1; continue; }
    throw new CalcError(`Caractère non autorisé « ${c} »`, i);
  }
  return toks;
}

// ---- Parser (récursif descendant) ----------------------------------------
function parse(src) {
  const text = String(src || '');
  const toks = tokenize(text);
  let p = 0;
  const peek = () => toks[p];
  const here = () => (toks[p] ? toks[p].at : text.length);
  const isOp = (v) => peek() && peek().t === 'op' && peek().v === v;
  const eat = (v) => {
    const tk = toks[p];
    if (!tk) throw new CalcError(v ? `« ${v} » attendu en fin de formule` : 'Formule incomplète', text.length);
    if (v && tk.v !== v) throw new CalcError(`« ${v} » attendu`, tk.at);
    p += 1; return tk;
  };

  function parseExpr() { return parseOr(); }
  function parseOr() { let a = parseAnd(); while (isOp('||')) { eat(); a = { k: 'bin', op: '||', a, b: parseAnd() }; } return a; }
  function parseAnd() { let a = parseNot(); while (isOp('&&')) { eat(); a = { k: 'bin', op: '&&', a, b: parseNot() }; } return a; }
  /*
   * NOT porte sur toute la COMPARAISON qui suit, comme dans Tableau et SQL : NOT x = null → NOT (x = null),
   * NOT a + b > 5 → NOT ((a + b) > 5). Sans comparaison, il ne porte que sur le terme qui suit, comme
   * un signe : NOT isnull(a) + NOT isnull(b) compte les réponses renseignées (0 à 2).
   */
  const isCmp = () => peek() && peek().t === 'op' && ['==', '!=', '<', '<=', '>', '>='].includes(peek().v);
  function parseNot() {
    if (!isOp('!')) return parseCmp();
    eat();
    if (isOp('!')) return { k: 'un', op: '!', a: parseNot() }; // NOT NOT x = 1 → NOT (NOT (x = 1))
    const start = p;
    const left = parseAdd();
    if (isCmp()) return { k: 'un', op: '!', a: parseCmpRest(left) };
    p = start; // pas de comparaison : NOT ne s'applique qu'au terme suivant
    return parseCmpRest(parseAddRest(parseMulRest({ k: 'un', op: '!', a: parseUnary() })));
  }
  function parseCmp() { return parseCmpRest(parseAdd()); }
  function parseCmpRest(a) {
    let left = a;
    while (isCmp()) { const op = eat().v; left = { k: 'bin', op, a: left, b: parseAdd() }; }
    return left;
  }
  function parseAdd() { return parseAddRest(parseMul()); }
  function parseAddRest(a) { let left = a; while (isOp('+') || isOp('-')) { const op = eat().v; left = { k: 'bin', op, a: left, b: parseMul() }; } return left; }
  function parseMul() { return parseMulRest(parseUnary()); }
  function parseMulRest(a) { let left = a; while (isOp('*') || isOp('/') || isOp('%')) { const op = eat().v; left = { k: 'bin', op, a: left, b: parseUnary() }; } return left; }
  function parseUnary() { if (isOp('-') || isOp('!')) { const op = eat().v; return { k: 'un', op, a: parseUnary() }; } return parsePrimary(); }
  function parsePrimary() {
    const tk = peek();
    if (!tk) throw new CalcError('Formule incomplète : une valeur, une variable ou une fonction est attendue', text.length);
    if (tk.t === 'num') { eat(); return { k: 'num', v: tk.v, at: tk.at }; }
    if (tk.t === 'str') { eat(); return { k: 'str', v: tk.v, at: tk.at }; }
    if (tk.t === 'null') { eat(); return { k: 'null', at: tk.at }; }
    if (isOp('(')) {
      eat('(');
      const e = parseExpr();
      if (!isOp(')')) throw new CalcError('Parenthèse fermante « ) » attendue', here());
      eat(')'); return e;
    }
    if (tk.t === 'id') {
      eat();
      if (!tk.quoted && isOp('(')) { // appel de fonction
        eat('('); const args = [];
        if (!isOp(')')) { args.push(parseExpr()); while (isOp(',')) { eat(','); args.push(parseExpr()); } }
        if (!isOp(')')) throw new CalcError(`« , » ou « ) » attendu dans ${tk.v}( … )`, here());
        eat(')'); return { k: 'call', name: tk.v.toLowerCase(), args, at: tk.at };
      }
      return { k: 'field', name: tk.v, at: tk.at };
    }
    throw new CalcError(`« ${tk.v} » inattendu ici`, tk.at);
  }
  const ast = parseExpr();
  if (p !== toks.length) throw new CalcError(`« ${toks[p].v ?? 'null'} » inattendu : opérateur manquant ?`, toks[p].at);
  return ast;
}

// ---- Valeurs ----------------------------------------------------------------
const isBlank = (v) => v == null || (typeof v === 'string' && v.trim() === '');
/** Littéral qui désigne la valeur vide : null, "" ou "  ". */
const blankLiteral = (node) => node.k === 'null' || (node.k === 'str' && isBlank(node.v));
const toNum = (v) => {
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (isBlank(v)) return null; // « » ou « » n'est pas 0
  const n = Number(typeof v === 'string' ? v.trim() : v); return Number.isNaN(n) ? null : n;
};
// Faux : 0 et les « non » usuels, sans tenir compte de la casse (mêmes valeurs que monitoringMath).
const FALSE_TEXT = new Set(['0', 'no', 'non', 'false', 'faux', 'n']);
const truthy = (v) => {
  if (isBlank(v) || v === false) return false;
  if (typeof v === 'number') return v !== 0 && !Number.isNaN(v);
  const t = String(v).trim().toLowerCase();
  if (FALSE_TEXT.has(t)) return false;
  const n = Number(t);
  return Number.isNaN(n) ? true : n !== 0;
};
const nums = (a) => a.map(toNum).filter((x) => x != null);
// Réponses d'une question à choix multiples : « 1 3 7 » (Kobo / XLSForm).
const choicesOf = (v) => (isBlank(v) ? [] : String(v).trim().split(/\s+/));
const sameValue = (a, b) => {
  const na = toNum(a); const nb = toNum(b);
  if (na != null && nb != null) return na === nb;
  return String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();
};

/**
 * Catalogue des fonctions : nom, catégorie, syntaxe, description, exemple, nombre
 * d'arguments (min / max) et implémentation. Les arguments arrivent évalués.
 */
const FUNCTIONS = [
  // Logique
  { name: 'if', category: 'Logique', syntax: 'if(condition, si_vrai, si_faux)', min: 2, max: 3,
    description: 'Renvoie « si_vrai » quand la condition est vraie, « si_faux » quand elle est fausse (vide si omis), et vide quand la condition est vide (réponse manquante). Les conditions s\'imbriquent : if(a, x, if(b, y, z)).',
    example: 'if(age >= 5, "5 ans et plus", "moins de 5 ans")',
    fn: (a) => (isBlank(a[0]) ? null : truthy(a[0]) ? a[1] : a[2] ?? null) },
  { name: 'in', category: 'Logique', syntax: 'in(valeur, v1, v2, …)', min: 2, max: 50,
    description: '1 si la valeur est égale à l\'une des valeurs listées (nombres ou textes, sans tenir compte des majuscules), sinon 0 ; vide si la valeur est vide (réponse manquante), sauf si la liste contient "" ou null.',
    example: 'in(Field_office, 6, 7, 9)',
    // Comme x = 6 OR x = 7 : une réponse manquante n'est pas un « non ».
    fn: (a) => (isBlank(a[0]) ? null : a.slice(1).some((x) => sameValue(a[0], x)) ? 1 : 0) },
  { name: 'between', category: 'Logique', syntax: 'between(valeur, min, max)', min: 3, max: 3,
    description: '1 si la valeur est un nombre compris entre min et max (bornes incluses), sinon 0 ; vide si la valeur est vide ou n\'est pas un nombre.',
    example: 'between(age_mois, 6, 59)',
    fn: (a) => { const [v, lo, hi] = a.map(toNum); return v == null ? null : (lo == null || v >= lo) && (hi == null || v <= hi) ? 1 : 0; } },
  // Nombres
  { name: 'num', category: 'Nombres', syntax: 'num(x)', min: 1, max: 1,
    description: 'Convertit en nombre ; 0 si la valeur est vide ou n\'est pas un nombre.',
    example: 'num(nb_menages) * 5',
    fn: (a) => toNum(a[0]) ?? 0 },
  { name: 'round', category: 'Nombres', syntax: 'round(x, décimales)', min: 1, max: 2,
    description: 'Arrondit x au nombre de décimales indiqué (0 par défaut).',
    example: 'round(rations / beneficiaires, 1)',
    fn: (a) => { const n = toNum(a[0]); if (n == null) return null; const f = 10 ** (toNum(a[1]) || 0); return Math.round(n * f) / f; } },
  { name: 'abs', category: 'Nombres', syntax: 'abs(x)', min: 1, max: 1,
    description: 'Valeur absolue (écart sans signe).',
    example: 'abs(recu - prevu)',
    fn: (a) => { const n = toNum(a[0]); return n == null ? null : Math.abs(n); } },
  { name: 'sum', category: 'Nombres', syntax: 'sum(a, b, …)', min: 1, max: 50,
    description: 'Somme des valeurs renseignées, en ignorant les vides (alors que a + b est vide dès qu\'un terme manque).',
    example: 'sum(hommes, femmes)',
    fn: (a) => { const v = nums(a); return v.length ? v.reduce((x, y) => x + y, 0) : null; } },
  { name: 'avg', category: 'Nombres', syntax: 'avg(a, b, …)', min: 1, max: 50,
    description: 'Moyenne des valeurs renseignées (les vides sont ignorés).',
    example: 'avg(note_1, note_2, note_3)',
    fn: (a) => { const v = nums(a); return v.length ? v.reduce((x, y) => x + y, 0) / v.length : null; } },
  { name: 'min', category: 'Nombres', syntax: 'min(a, b, …)', min: 1, max: 50,
    description: 'Plus petite des valeurs renseignées.',
    example: 'min(stock, besoin)',
    fn: (a) => { const v = nums(a); return v.length ? Math.min(...v) : null; } },
  { name: 'max', category: 'Nombres', syntax: 'max(a, b, …)', min: 1, max: 50,
    description: 'Plus grande des valeurs renseignées.',
    example: 'max(0, prevu - recu)',
    fn: (a) => { const v = nums(a); return v.length ? Math.max(...v) : null; } },
  // Texte
  { name: 'lower', category: 'Texte', syntax: 'lower(x)', min: 1, max: 1,
    description: 'Texte en minuscules.', example: 'lower(reponse) = "oui"',
    fn: (a) => String(a[0] ?? '').toLowerCase() },
  { name: 'upper', category: 'Texte', syntax: 'upper(x)', min: 1, max: 1,
    description: 'Texte en majuscules.', example: 'upper(DPName)',
    fn: (a) => String(a[0] ?? '').toUpperCase() },
  { name: 'trim', category: 'Texte', syntax: 'trim(x)', min: 1, max: 1,
    description: 'Retire les espaces au début et à la fin.', example: 'trim(site_autre)',
    fn: (a) => String(a[0] ?? '').trim() },
  { name: 'len', category: 'Texte', syntax: 'len(x)', min: 1, max: 1,
    description: 'Nombre de caractères.', example: 'if(len(commentaire) > 0, 1, 0)',
    fn: (a) => String(a[0] ?? '').length },
  { name: 'left', category: 'Texte', syntax: 'left(x, n)', min: 2, max: 2,
    description: 'Les n premiers caractères (ex. code de région au début d\'un pcode).', example: 'left(Adm3Code, 4)',
    fn: (a) => String(a[0] ?? '').slice(0, Math.max(0, toNum(a[1]) || 0)) },
  { name: 'right', category: 'Texte', syntax: 'right(x, n)', min: 2, max: 2,
    description: 'Les n derniers caractères.', example: 'right(code_site, 3)',
    fn: (a) => { const s = String(a[0] ?? ''); const n = Math.max(0, toNum(a[1]) || 0); return n ? s.slice(-n) : ''; } },
  { name: 'contains', category: 'Texte', syntax: 'contains(texte, recherche)', min: 2, max: 2,
    description: '1 si le texte contient la recherche (sans tenir compte des majuscules), sinon 0 ; vide si le texte est vide (réponse manquante).',
    example: 'contains(probleme_autre, "retard")',
    fn: (a) => (isBlank(a[0]) ? null : String(a[0]).toLowerCase().includes(String(a[1] ?? '').toLowerCase()) ? 1 : 0) },
  { name: 'concat', category: 'Texte', syntax: 'concat(a, b, …)', min: 1, max: 50,
    description: 'Met bout à bout les valeurs (les vides comptent pour rien).', example: 'concat(Adm2Name, " / ", Adm3Name)',
    fn: (a) => a.map((x) => (x == null ? '' : String(x))).join('') },
  // Choix multiples (XLSForm select_multiple)
  { name: 'selected', category: 'Choix multiples', syntax: 'selected(question, "option")', min: 2, max: 2,
    description: '1 si l\'option fait partie des réponses d\'une question à choix multiples (réponses séparées par des espaces, comme dans Kobo), sinon 0 ; vide si la question n\'a pas de réponse.',
    example: 'selected(process_monitoring, "3")',
    fn: (a) => (isBlank(a[0]) ? null : choicesOf(a[0]).some((x) => sameValue(x, a[1])) ? 1 : 0) },
  { name: 'count_selected', category: 'Choix multiples', syntax: 'count_selected(question)', min: 1, max: 1,
    description: 'Nombre d\'options cochées pour une question à choix multiples ; 0 si la question n\'a pas de réponse.',
    example: 'count_selected(problemes_signales)',
    fn: (a) => choicesOf(a[0]).length },
  // Valeurs manquantes
  { name: 'isnull', category: 'Valeurs manquantes', syntax: 'isnull(x)', min: 1, max: 1,
    description: '1 si la valeur est vide (question non répondue), sinon 0.',
    example: 'if(isnull(DPName_Other), DPName, DPName_Other)',
    fn: (a) => (isBlank(a[0]) ? 1 : 0) },
  { name: 'coalesce', category: 'Valeurs manquantes', syntax: 'coalesce(a, b, …)', min: 1, max: 50,
    description: 'Première valeur non vide de la liste.',
    example: 'coalesce(DPName_Other, DPName, "inconnu")',
    fn: (a) => a.find((x) => !isBlank(x)) ?? null },
];
const BY_NAME = new Map(FUNCTIONS.map((f) => [f.name, f]));

/** Opérateurs, pour la documentation (l'évaluation est dans evalAst). */
const OPERATORS = [
  { symbol: '+  -  *  /  %', description: 'Calcul : addition, soustraction, multiplication, division, reste. Vide si un terme est vide ; division par zéro → vide.', example: '(recu / prevu) * 100' },
  { symbol: '=  <>  <  <=  >  >=', description: 'Comparaison (== et != aussi acceptés) : nombres si les deux côtés en sont, sinon textes. Renvoie 1 (vrai) ou 0 (faux), et vide si un côté est vide (réponse manquante) ; « x = null » ou « x = "" » teste si x est vide.', example: 'statut = "oui"' },
  { symbol: 'AND  OR  NOT', description: 'Logique (&&, || et ! aussi acceptés). Faux = 0, « non », « no », « n », « false », « faux » (majuscules ignorées) ; vide = inconnu, sauf si l\'autre côté suffit (faux AND vide = faux, vrai OR vide = vrai). NOT porte sur toute la comparaison qui suit : NOT x = 1 se lit NOT (x = 1).', example: 'age >= 6 AND age <= 59' },
  { symbol: '"texte"  [nom avec espaces]  null', description: 'Texte entre guillemets ; variable dont le nom contient des espaces ou des « / » entre crochets ; null = valeur vide.', example: '[process_monitoring/3] = 1' },
];

// ---- Évaluation -----------------------------------------------------------
/**
 * Lecture d'une variable dans les réponses : nom exact, sinon sans tenir compte
 * de la casse (le XLSForm dit « field_office », l'export SPSS « Field_office »).
 * L'index en minuscules n'est construit qu'au premier nom absent ; `reset()`
 * après l'ajout d'une valeur (champ calculé suivant).
 */
function makeGetter(scope) {
  let lower = null;
  const get = (name) => {
    if (Object.prototype.hasOwnProperty.call(scope, name)) return scope[name];
    if (!lower) {
      lower = new Map();
      for (const k of Object.keys(scope)) { const l = k.toLowerCase(); if (!lower.has(l)) lower.set(l, k); }
    }
    const k = lower.get(String(name).toLowerCase());
    return k === undefined ? undefined : scope[k];
  };
  get.reset = () => { lower = null; };
  return get;
}

function evalAst(node, get) {
  switch (node.k) {
    case 'num': return node.v;
    case 'str': return node.v;
    case 'null': return null;
    case 'field': { const v = get(node.name); return v === undefined ? null : v; }
    case 'un': {
      const a = evalAst(node.a, get);
      if (node.op === '-') { const n = toNum(a); return n == null ? null : -n; }
      if (isBlank(a)) return null; // NOT d'une réponse manquante : inconnu
      return truthy(a) ? 0 : 1; // !
    }
    case 'call': {
      const def = BY_NAME.get(node.name);
      if (!def) throw new CalcError(`Fonction inconnue « ${node.name} »`, node.at);
      const args = node.args.map((x) => evalAst(x, get));
      // in(x, …) sur une réponse manquante : vide, sauf si la liste ÉCRIT la valeur vide (in(x, "") ou in(x, null)) —
      // une variable de la liste qui se trouve vide ne compte pas comme ce test explicite.
      if (def.name === 'in' && isBlank(args[0])) return node.args.slice(1).some(blankLiteral) ? 1 : null;
      return def.fn(args);
    }
    case 'bin': {
      const { op } = node;
      // Logique à trois valeurs (comme SQL ou Tableau) : une réponse manquante rend la condition
      // vide, sauf si l'autre côté suffit à conclure (faux ET … = faux ; vrai OU … = vrai).
      if (op === '&&' || op === '||') {
        const l = evalAst(node.a, get); const r = evalAst(node.b, get);
        const decisive = op === '&&' ? (v) => !isBlank(v) && !truthy(v) : (v) => !isBlank(v) && truthy(v);
        if (decisive(l) || decisive(r)) return op === '&&' ? 0 : 1;
        if (isBlank(l) || isBlank(r)) return null;
        return op === '&&' ? 1 : 0;
      }
      const a = evalAst(node.a, get); const b = evalAst(node.b, get);
      if (['+', '-', '*', '/', '%'].includes(op)) {
        const na = toNum(a); const nb = toNum(b);
        if (na == null || nb == null) return null;
        if (op === '+') return na + nb; if (op === '-') return na - nb; if (op === '*') return na * nb;
        if (op === '/') return nb === 0 ? null : na / nb;
        return nb === 0 ? null : na % nb;
      }
      // Comparaison avec null ou "" écrits en clair : teste si la valeur est vide.
      if (blankLiteral(node.a) || blankLiteral(node.b)) {
        const same = isBlank(a) === isBlank(b);
        if (op === '==') return same ? 1 : 0;
        if (op === '!=') return same ? 0 : 1;
      }
      // Une réponse manquante n'est ni égale, ni plus petite, ni plus grande : résultat vide.
      if (isBlank(a) || isBlank(b)) return null;
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
        default: throw new CalcError(`Opérateur « ${op} »`);
      }
    }
    default: throw new CalcError('Nœud inconnu');
  }
}

// Une formule est analysée une fois puis réutilisée (le calcul passe sur chaque soumission).
const AST_CACHE = new Map();
function compile(expr) {
  const key = String(expr);
  if (AST_CACHE.has(key)) return AST_CACHE.get(key);
  let entry;
  try { entry = { ast: parse(key) }; } catch (error) { entry = { error }; }
  if (AST_CACHE.size >= 500) AST_CACHE.clear();
  AST_CACHE.set(key, entry);
  return entry;
}

/**
 * Évalue une expression sûre. Renvoie la valeur, ou null si erreur/vide.
 * @param {object|Function} scope  réponses, ou une fonction de lecture (makeGetter)
 */
function evalExpression(expr, scope = {}) {
  if (!expr || !String(expr).trim()) return null;
  const { ast } = compile(expr);
  if (!ast) return null;
  try { return evalAst(ast, typeof scope === 'function' ? scope : makeGetter(scope)); } catch { return null; }
}

// ---- Vérification -------------------------------------------------------------
/** Distance d'édition (fonctions et variables mal tapées : « iff » → « if »). */
function editDistance(a, b) {
  const m = a.length; const n = b.length;
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 1; j <= n; j += 1) d[0][j] = j;
  for (let i = 1; i <= m; i += 1) {
    for (let j = 1; j <= n; j += 1) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  }
  return d[m][n];
}
function closest(name, candidates) {
  const low = String(name).toLowerCase();
  let best = null;
  for (const c of candidates) {
    const lc = String(c).toLowerCase();
    if (lc === low) return c;
    const dist = editDistance(low, lc);
    if (dist <= Math.max(1, Math.floor(lc.length / 4)) && (!best || dist < best.dist)) best = { c, dist };
  }
  return best ? best.c : null;
}

/**
 * Vérifie une formule pour l'éditeur : erreur bloquante (syntaxe, fonction
 * inconnue, nombre d'arguments) avec sa position, avertissements (variable
 * inconnue de la fiche) et variables utilisées.
 * @param {string} expr
 * @param {{ fields?: Iterable<string> }} [opts]  variables connues (catalogue, données, champs calculés)
 * @returns {{ error: {message:string, at:number|null}|null, warnings: Array<{message:string, at:number}>, references: string[] }}
 */
function checkExpression(expr, { fields } = {}) {
  if (!expr || !String(expr).trim()) return { error: { message: 'Formule vide.', at: 0 }, warnings: [], references: [] };
  const { ast, error } = compile(expr);
  if (error) return { error: { message: error.message, at: error.at ?? null }, warnings: [], references: [] };
  const known = fields ? [...fields] : null;
  // Une différence de casse seule n'est pas une erreur : la lecture la résout (makeGetter).
  const knownSet = known ? new Set(known.map((k) => String(k).toLowerCase())) : null;
  const references = [];
  const warnings = [];
  let fault = null;
  const walk = (node) => {
    if (!node || fault) return;
    if (node.k === 'field') {
      if (!references.includes(node.name)) references.push(node.name);
      if (knownSet && !knownSet.has(String(node.name).toLowerCase())) {
        const hint = closest(node.name, known);
        warnings.push({ message: `Variable « ${node.name} » inconnue dans cette fiche${hint ? ` — vouliez-vous dire « ${hint} » ?` : ''} (elle sera vide).`, at: node.at, name: node.name });
      }
    }
    if (node.k === 'call') {
      const def = BY_NAME.get(node.name);
      if (!def) {
        const hint = closest(node.name, FUNCTIONS.map((f) => f.name));
        fault = { message: `Fonction inconnue « ${node.name} »${hint ? ` — vouliez-vous dire « ${hint} » ?` : ''}`, at: node.at };
        return;
      }
      const n = node.args.length;
      if (n < def.min || n > def.max) {
        const want = def.min === def.max ? `${def.min}` : def.max >= 50 ? `au moins ${def.min}` : `${def.min} à ${def.max}`;
        fault = { message: `${def.name}( ) attend ${want} argument(s), ${n} donné(s) : ${def.syntax}`, at: node.at };
        return;
      }
      node.args.forEach(walk);
    }
    if (node.k === 'un') walk(node.a);
    if (node.k === 'bin') { walk(node.a); walk(node.b); }
  };
  walk(ast);
  return { error: fault, warnings: fault ? [] : warnings, references };
}

/** Valide une expression : renvoie un message d'erreur (avec la position) ou null si OK. */
function validateExpression(expr) {
  const { error } = checkExpression(expr);
  if (!error) return null;
  return error.at == null || !String(expr || '').trim() ? error.message : `${error.message} (caractère ${error.at + 1})`;
}

/** Applique une définition recode : valeur source → mapping → défaut. */
function applyRecode(def, row, get = makeGetter(row)) {
  const raw = get(def.sourceField);
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
  const get = makeGetter(scope);
  for (const def of defs || []) {
    let val = null;
    if (def.kind === 'recode') val = applyRecode(def, scope, get);
    else val = evalExpression(def.expression, get);
    out[def.name] = val;
    scope[def.name] = val; // disponible pour les suivants
    get.reset();
  }
  return out;
}

/**
 * Aperçu d'un champ calculé sur des soumissions réelles : quelques lignes
 * (variables utilisées → résultat), répartition des résultats, nombre de vides.
 * Les champs calculés déjà définis (`priorDefs`) sont calculés d'abord.
 * @param {object} def  { kind, expression | sourceField, mapping, defaultValue }
 * @param {object[]} rows  réponses brutes (data) des soumissions
 * @param {object[]} [priorDefs]
 * @param {{ samples?: number, top?: number }} [opts]
 */
function previewCalc(def, rows, priorDefs = [], { samples = 8, top = 10 } = {}) {
  const refs = def.kind === 'recode' ? [def.sourceField].filter(Boolean) : checkExpression(def.expression).references;
  const counts = new Map();
  let empty = 0;
  const filled = []; const others = [];
  for (const row of rows || []) {
    const scope = { ...row, ...computeCalcFields(priorDefs, row) };
    const get = makeGetter(scope);
    const value = def.kind === 'recode' ? applyRecode(def, scope, get) : evalExpression(def.expression, get);
    if (isBlank(value)) empty += 1;
    else { const k = typeof value === 'number' ? String(Math.round(value * 1e6) / 1e6) : String(value); counts.set(k, (counts.get(k) || 0) + 1); }
    const inputs = Object.fromEntries(refs.map((r) => { const v = get(r); return [r, v === undefined ? null : v]; }));
    const sample = { inputs, value: value === undefined ? null : value };
    // Lignes montrées : d'abord celles où une variable utilisée est renseignée.
    const target = refs.some((r) => !isBlank(inputs[r])) ? filled : others;
    if (target.length < samples) target.push(sample);
  }
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return {
    n: (rows || []).length,
    empty,
    distinct: counts.size,
    distribution: sorted.slice(0, top).map(([value, n]) => ({ value, n })),
    otherCount: sorted.slice(top).reduce((s, [, n]) => s + n, 0),
    samples: [...filled, ...others].slice(0, samples),
    references: refs,
  };
}

/** Catalogue publié pour l'éditeur et la documentation (sans les implémentations). */
const functionCatalog = () => ({
  functions: FUNCTIONS.map(({ name, category, syntax, description, example, min, max }) => ({ name, category, syntax, description, example, min, max })),
  operators: OPERATORS,
});

module.exports = {
  tokenize, parse, evalExpression, validateExpression, checkExpression, applyRecode, computeCalcFields,
  previewCalc, functionCatalog, makeGetter, FUNCTIONS, CalcError, closest,
};
