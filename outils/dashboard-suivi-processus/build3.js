'use strict';
// Construction modulaire du dashboard v3.
// Usage : node build3.js --out <fichier.html> [--sets engine,core,agents,map,planning,overview]
// Ordre fixe des lots (SETS) ; chaque lot = correctifs (ancres exactes) + module injecté dans boot() + CSS.
// Les ancres de chaque lot sont écrites contre le texte « socle » (original + engine + core) et doivent rester
// dans la zone du lot : les lots se composent alors dans n'importe quel ordre.
const fs = require('fs'), crypto = require('crypto'), path = require('path');
const SP = __dirname;
const { applyPatches } = require(__dirname + '/apply-patches.js');
const SETS = [
  { name: 'engine', patches: __dirname + '/engine/patches.js' },
  { name: 'core', patches: __dirname + '/core/patches.js', module: __dirname + '/core/module.js', css: [__dirname + '/core/refonte.css', __dirname + '/core/core.css'] },
  { name: 'agents', patches: __dirname + '/agents/patches.js', module: __dirname + '/agents/module.js', css: [__dirname + '/agents/style.css'] },
  { name: 'map', patches: __dirname + '/map/patches.js', module: __dirname + '/map/module.js', css: [__dirname + '/map/style.css'] },
  { name: 'planning', patches: __dirname + '/planning/patches.js', module: __dirname + '/planning/module.js', css: [__dirname + '/planning/style.css'] },
  { name: 'overview', patches: __dirname + '/overview/patches.js', module: __dirname + '/overview/module.js', css: [__dirname + '/overview/style.css'] },
  { name: 'pilotage', patches: __dirname + '/pilotage/patches.js', module: __dirname + '/pilotage/module.js', css: [__dirname + '/pilotage/style.css'], post: true },
  { name: 'logistique', patches: __dirname + '/logistique/patches.js', module: __dirname + '/logistique/module.js', css: [__dirname + '/logistique/style.css'], post: true },
  { name: 'share', patches: __dirname + '/share/patches.js', module: __dirname + '/share/module.js', css: [__dirname + '/share/style.css'], post: true },
  { name: 'rapport', patches: __dirname + '/rapport/patches.js', module: __dirname + '/rapport/module.js', css: [__dirname + '/rapport/style.css'], post: true },
  { name: 'federation', patches: __dirname + '/federation/patches.js', module: __dirname + '/federation/module.js', css: [__dirname + '/federation/style.css'], post: true },
  // Sécurité : correctifs appliqués APRÈS l'assemblage (ancres sur le texte final), + directives CSP supplémentaires
  { name: 'security', patches: __dirname + '/security/patches.js', module: __dirname + '/security/module.js', css: [__dirname + '/security/style.css'], post: true,
    csp: " require-trusted-types-for 'script'; trusted-types 'none';" },
];
const args = process.argv.slice(2), opt = k => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const OUT = path.resolve(opt('--out') || 'Dashboard.html');
const want = (opt('--sets') || SETS.map(s => s.name).join(',')).split(',');
if (!opt('--src')) { console.error('Usage : node build3.js --src <dashboard d’origine.html> [--out Dashboard.html] [--release]'); process.exit(1); }
const SRC = path.resolve(opt('--src'));   // fichier dashboard d'origine, conservé hors du dépôt (il contient les données)
let html = fs.readFileSync(SRC, 'utf8');
const OPEN = '<script id="app-js">', CLOSE = '</' + 'script>';
const a = html.indexOf(OPEN) + OPEN.length, b = html.indexOf(CLOSE, a);
let js = html.slice(a, b);
const exists = f => f && fs.existsSync(f);
const modules = [], css = [];
for (const s of SETS) {
  if (!want.includes(s.name)) continue;
  if (exists(s.patches) && !s.post) { delete require.cache[require.resolve(s.patches)]; const r = applyPatches(js, require(s.patches), s.name); js = r.text; console.log('· ' + s.name + ' : ' + r.log.length + ' correctif(s)'); }
  if (exists(s.module)) modules.push('  /* ===== MODULE ' + s.name + ' ===== */\n' + fs.readFileSync(s.module, 'utf8') + '\n  /* ===== /MODULE ' + s.name + ' ===== */\n');
  (s.css || []).filter(exists).forEach(f => css.push('/* ===== ' + s.name + ' : ' + path.basename(f) + ' ===== */\n' + fs.readFileSync(f, 'utf8')));
}
// Version livrée : l'accroche de test (#debug → window.__dash) est retirée
if (args.includes('--release')) {
  const re = /\n  \/\/ Accroche de test[^\n]*\n  if \(\/debug\/\.test\(location\.hash\)\) window\.__dash = [^\n]*/;
  if (!re.test(js)) throw new Error('Accroche de test introuvable (release)');
  js = js.replace(re, '');
  js = js.split('\n').filter(l => l.indexOf('/*DEBUG*/') < 0).join('\n');
  console.log('· release : accroche de test retirée');
}
const A2 = '  // ------------------------------------------------------------------ tabs & render';
if (js.split(A2).length !== 2) throw new Error('Ancre « tabs & render » absente ou multiple');
js = js.split(A2).join(modules.join('\n') + A2);   // split/join = remplacement littéral (sûr aux séquences $'/$&/$n dans le code des modules)
// lots « post » : correctifs sur le texte assemblé (lots + modules)
for (const s of SETS) {
  if (!want.includes(s.name) || !s.post || !exists(s.patches)) continue;
  delete require.cache[require.resolve(s.patches)]; const r = applyPatches(js, require(s.patches), s.name); js = r.text; console.log('· ' + s.name + ' (après assemblage) : ' + r.log.length + ' correctif(s)');
}
if (args.includes('--release')) { js = js.split('\n').filter(l => l.indexOf('/*DEBUG*/') < 0 && !/^\s*if \(\/debug\/\.test\(location\.hash\)\) window\.__dash\w* = /.test(l) && !/^\s*if \(window\.__dash\) window\.__dash\.\w+ = /.test(l)).join('\n'); if (/__dash/.test(js)) throw new Error('Référence __dash restante en release'); }
js = js.replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--');   // jamais de fin de script ni de commentaire HTML dans le script inline
html = html.slice(0, a) + js + html.slice(b);
const cspAdd = SETS.filter(s => want.includes(s.name) && s.csp).map(s => s.csp).join('');
if (cspAdd) { const re = /(<meta http-equiv="Content-Security-Policy" content=")([^"]*)(")/; if (!re.test(html)) throw new Error('CSP introuvable'); html = html.replace(re, (m, a, c, z) => a + c.replace(/;?\s*$/, ';') + cspAdd + z); console.log('· CSP : directives ajoutées :' + cspAdd); }
if (css.length) { const i = html.indexOf('</' + 'style>'); html = html.slice(0, i) + '\n' + css.join('\n') + '\n' + html.slice(i); }
// empreintes CSP recalculées sur le contenu final
const between = (open, close) => { const i = html.indexOf(open) + open.length; return html.slice(i, html.indexOf(close, i)); };
const hApp = crypto.createHash('sha256').update(between(OPEN, CLOSE), 'utf8').digest('base64');
const hCss = crypto.createHash('sha256').update(between('<style>', '</' + 'style>'), 'utf8').digest('base64');
const oldApp = 'sha256-ltmECmm/w62LgKK/Xd3oTob3OUdrsFfcn5VpxYfD5ZY=', oldCss = 'sha256-A73bu/0IJjAelyBeId1JOyZNew1iGr+fcHE+teE7NL8=';
if (html.split(oldApp).length !== 2 || html.split(oldCss).length !== 2) throw new Error('Empreintes CSP d’origine introuvables');
html = html.replace(oldApp, 'sha256-' + hApp).replace(oldCss, 'sha256-' + hCss);
// contrôle de syntaxe du script final avant écriture
try { new Function(between(OPEN, CLOSE)); } catch (e) { throw new Error('Script final invalide : ' + e.message); }
fs.writeFileSync(OUT, html);
console.log('→ ' + OUT + ' (' + (fs.statSync(OUT).size / 1048576).toFixed(2) + ' Mo) · lots : ' + want.join(', ') + ' · CSP app ' + hApp.slice(0, 10) + '… css ' + hCss.slice(0, 10) + '…');
