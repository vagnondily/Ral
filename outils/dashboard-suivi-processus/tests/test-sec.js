(async () => {
  const S = window.__dashSec, sleep = ms => new Promise(r => setTimeout(r, ms)), out = {};
  out.defaultBefore = S.secIsDefault(); out.legacyOk = S.secCheckPw('1234'); out.wrong = S.secCheckPw('12345');
  let t0 = performance.now(); S.secHash('abcd', 'x', 20000); out.hashMs = Math.round(performance.now() - t0);
  window.__ok = 0; S.requireAdmin(() => { window.__ok = 1; }); await sleep(100);
  const pw = document.querySelector('.modal-ov input[type=password]'); pw.value = '1234'; pw.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' })); await sleep(200);
  out.forcedModal = !!Array.from(document.querySelectorAll('.modal h2')).find(h => /mot de passe initial/i.test(h.textContent));
  const ins = document.querySelectorAll('.modal-ov input[type=password]');
  ins[0].value = 'abc'; ins[1].value = 'abc'; Array.from(document.querySelectorAll('.modal-ov button')).find(b => b.textContent === 'Enregistrer').click(); await sleep(100);
  out.shortRefused = document.querySelector('.modal-err').textContent;
  ins[0].value = 'Suivi-Process-2026!'; ins[1].value = 'Suivi-Process-2026!'; Array.from(document.querySelectorAll('.modal-ov button')).find(b => b.textContent === 'Enregistrer').click(); await sleep(2500);
  out.ok = window.__ok; out.authV = S.auth().v; out.it = S.auth().it; out.newOk = S.secCheckPw('Suivi-Process-2026!'); out.oldRefused = !S.secCheckPw('1234'); out.defaultAfter = S.secIsDefault(); out.dirty = S.sess().dirty; out.fileId = S.fileId();
  // carte sécurité dans l'onglet Données
  Array.from(document.querySelectorAll('#tabs button')).find(b => b.textContent.includes('Données')).click(); await sleep(600);
  out.secCard = /Sécurité et confidentialité du fichier/.test(document.getElementById('main').innerText);
  out.noPwShown = !/Mot de passe initial : 1234/.test(document.getElementById('main').innerText);
  out.csp = document.querySelector('meta[http-equiv="Content-Security-Policy"]').content.includes("require-trusted-types-for 'script'");
  // tentative innerHTML : doit être bloquée par Trusted Types
  try { const d = document.createElement('div'); d.innerHTML = '<b>x</b>'; out.innerHTMLBlocked = false; } catch (e) { out.innerHTMLBlocked = true; }
  return out;
})()
