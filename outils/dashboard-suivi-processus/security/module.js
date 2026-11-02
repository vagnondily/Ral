  // ================================================================== SÉCURITÉ DU FICHIER (lot security)
  // Mot de passe : empreinte renforcée (v2 = SHA-256 itéré, sel aléatoire propre au fichier), mot de passe initial à changer,
  // verrouillage automatique ; stockage local cloisonné par fichier ; carte « Sécurité et confidentialité ».
  const SEC_IT = 100000, SEC_MINLEN = 10, SEC_IDLE_MS = 30 * 60000;
  function secHash(salt, p, it) { let h = sha256hex(salt + ':' + p); for (let i = 0; i < it; i++) h = sha256hex(h + salt); return h; }
  function secMakeAuth(p) {
    const rnd = new Uint8Array(16); crypto.getRandomValues(rnd);
    const salt = Array.from(rnd).map(b => b.toString(16).padStart(2, '0')).join('');
    if (!CUR.fileId) CUR.fileId = secFileId();   // l'identifiant du fichier ne change pas avec le mot de passe
    return { v: 2, salt, it: SEC_IT, hash: secHash(salt, p, SEC_IT), set: localDay() };
  }
  function secCheckPw(p) {
    const A = CUR.auth || {}; if (!A.hash || typeof p !== 'string') return false;
    if (A.v === 2) return secHash(A.salt || '', p, Math.min(+A.it || SEC_IT, 200000)) === A.hash;
    return sha256hex((A.salt || '') + ':' + p) === A.hash;   // ancienne empreinte (une itération) : acceptée, puis remplacée
  }
  function secIsDefault() { const A = CUR.auth || {}; return !!A.hash && A.v !== 2 && sha256hex((A.salt || '') + ':1234') === A.hash; }
  function secTouch() { SESSION.adminSeen = Date.now(); }
  function secRequireAdmin(fn) {
    if (SESSION.admin && Date.now() - (SESSION.adminSeen || 0) > SEC_IDLE_MS) { SESSION.admin = false; }   // verrouillage après 30 min sans action
    if (SESSION.admin) { secTouch(); fn(); return; }
    askPassword('Déverrouiller le mode administrateur', () => {
      if (secIsDefault()) { secForceChange(() => { SESSION.admin = true; secTouch(); fn(); }); return; }
      if ((CUR.auth || {}).v !== 2) SESSION.authUpgrade = true;   // empreinte ancienne : proposée au remplacement dans l'onglet Données
      SESSION.admin = true; secTouch(); fn();
    });
  }
  // Mot de passe initial « 1234 » : changement obligatoire avant toute fonction d'administration
  function secForceChange(onOk) {
    const ov = el('div', { class: 'modal-ov', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Changer le mot de passe initial' });
    const p1 = inp({ type: 'password', autocomplete: 'new-password', maxlength: 128, 'aria-label': 'Nouveau mot de passe' }), p2 = inp({ type: 'password', autocomplete: 'new-password', maxlength: 128, 'aria-label': 'Confirmer' });
    const msg = el('p', { class: 'modal-err' });
    const close = () => { ov.remove(); document.removeEventListener('keydown', esc); };
    const esc = e => { if (e.key === 'Escape') close(); };
    const ok = () => {
      const v = secPwProblem(p1.value); if (v) { msg.textContent = v; return; }
      if (p1.value !== p2.value) { msg.textContent = 'La confirmation ne correspond pas.'; return; }
      msg.textContent = 'Calcul de l’empreinte…';
      setTimeout(() => { CUR.auth = secMakeAuth(p1.value); SESSION.dirty = true; SESSION.pwChanged = localDay(); close(); onOk(); }, 20);
    };
    ov.appendChild(el('div', { class: 'modal' }, [el('h2', { text: 'Changer le mot de passe initial' }),
      el('p', { class: 'hint', text: 'Ce fichier utilise encore le mot de passe initial, connu de tous ceux qui ont reçu le fichier d’origine. Choisissez-en un nouveau (au moins ' + SEC_MINLEN + ' caractères) ; il sera enregistré dans le fichier quand vous téléchargerez le dashboard mis à jour.' }),
      el('label', { class: 'fld' }, ['Nouveau mot de passe', p1]), el('label', { class: 'fld' }, ['Confirmer', p2]), msg,
      el('div', { class: 'mrow' }, [btn('Enregistrer', ok, 'on'), btn('Annuler', close)])]));
    p2.addEventListener('keydown', e => { if (e.key === 'Enter') ok(); });
    ov.addEventListener('click', e => { if (e.target === ov) close(); }); document.addEventListener('keydown', esc);
    document.body.appendChild(ov); p1.focus();
  }
  function secPwProblem(p) {
    if (typeof p !== 'string' || p.length < SEC_MINLEN) return 'Au moins ' + SEC_MINLEN + ' caractères.';
    if (/^(1234|0000|password|motdepasse|azerty|qwerty)/i.test(p) || /^(.)\1+$/.test(p)) return 'Mot de passe trop facile à deviner.';
    return '';
  }
  // Identifiant du fichier (stable, enregistré dans le fichier) : cloisonne le stockage local entre dashboards ouverts depuis le disque
  function secFileId() { return 'f' + sha256hex(String((CUR.auth || {}).salt || '') + '|' + (CUR.acts || []).map(a => a.code).join(',') + '|' + ((CUR.spec && Object.keys(CUR.spec).join(',')) || '')).slice(0, 16); }
  function secLsKey(base) {
    if (!CUR.fileId) CUR.fileId = secFileId();
    const k = base + '@' + CUR.fileId;
    try { const ls = window.localStorage; if (ls.getItem(k) === null && ls.getItem(base) !== null) ls.setItem(k, ls.getItem(base)); } catch (e) { /* stockage indisponible */ }
    return k;
  }
  function secLocalKeys() { const out = []; try { const ls = window.localStorage; for (let i = 0; i < ls.length; i++) { const k = ls.key(i); if (k && CUR.fileId && k.endsWith('@' + CUR.fileId)) out.push(k); } } catch (e) { /* indisponible */ } return out; }
  // Empreintes (calculées à la demande : le calcul en JavaScript pur prend quelques secondes sur 5 Mo)
  function secFingerprint(text) { return sha256hex(text).replace(/(.{8})/g, '$1 ').trim(); }
  function secCards(main) {
    const A = CUR.auth || {};
    const nAg = (D.agents && D.agents.rows) ? D.agents.rows.length : 0;
    const status = secIsDefault() ? ['bad', 'Mot de passe initial encore actif : il faudra le changer au premier déverrouillage.']
      : A.v === 2 ? ['good', 'Mot de passe personnalisé' + (A.set ? ' depuis le ' + dateFrLong(A.set) : '') + '.']
      : ['mid', 'Mot de passe à renouveler (ancienne protection).'];
    const fpOut = el('p', { class: 'note' }); fpOut.style.display = 'none';
    const fpBtn = btn('Empreintes du fichier', () => {
      fpOut.style.display = ''; fpOut.textContent = 'Calcul en cours…';
      setTimeout(() => {
        const dataEl = document.getElementById('data');
        fpOut.textContent = 'Empreinte du code : ' + secFingerprint(SHELL.js) + '\nEmpreinte des données reçues : ' + (dataEl ? secFingerprint(dataEl.textContent) : '–') +
          '\nÀ comparer avec celles de l’expéditeur pour vérifier que le fichier n’a pas été modifié.';
      }, 30);
    });
    const keys = secLocalKeys();
    const clr = btn('Effacer mes notes locales (' + keys.length + ')', () => {
      requireAdmin(() => { try { keys.forEach(k => window.localStorage.removeItem(k)); } catch (e) { /* indisponible */ } render(); });
    });
    const tipSec = 'Le fichier ne charge rien de l’extérieur et ne peut rien envoyer. Seuls ses propres scripts peuvent s’exécuter (CSP par empreinte, Trusted Types).\n\n' +
      'Le mot de passe protège les mises à jour, pas la lecture. Le mode administrateur se reverrouille après 30 minutes sans action.\n\n' +
      'Données personnelles dans le fichier : ' + fmt(nAg) + ' agents nommés avec leurs notes, positions GPS des fiches (lieu de l’entretien), réponses libres « Autre ». Toute personne qui reçoit le fichier peut les lire.\n\n' +
      'Les notes du rapport restent dans ce navigateur (identifiant du fichier ' + (CUR.fileId || secFileId()) + ') et ne partent pas avec le fichier.\n\n' +
      'Dans les exports CSV et Excel, une cellule qui commence par = + - @ est neutralisée.';
    const c = card('Sécurité', null, [
      el('p', { class: 'note' + (status[0] === 'bad' ? ' warn' : ''), text: status[1] }),
      el('div', { class: 'mrow' }, [fpBtn, clr]), fpOut]);
    const h2 = c.querySelector('.ch'); if (h2) h2.appendChild(infoBtn(tipSec));
    main.appendChild(c);
    if (typeof shareCard === 'function') shareCard(main);   // « Version à partager » (lot share)
  }
  if (/debug/.test(location.hash)) window.__dashSec = { secCheckPw, secIsDefault, requireAdmin, secHash, sess: () => SESSION, auth: () => CUR.auth, fileId: () => CUR.fileId }; /*DEBUG*/
