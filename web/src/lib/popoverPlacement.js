/**
 * Placement d'une fenêtre flottante ancrée à un bouton (retour 86) — logique pure, testée
 * (server/test/webPopover.test.js). La fenêtre est rendue dans un portail en position
 * `fixed` : elle n'est plus coupée par une fenêtre modale, un tiroir ou une carte à
 * défilement, et n'élargit plus leur contenu (barre de défilement horizontale).
 *
 * Règles :
 *  - largeur = largeur naturelle, jamais plus que la fenêtre du navigateur moins les marges ;
 *  - alignée sur le bord gauche du bouton (`align: 'left'`) ou son bord droit ('right'),
 *    puis ramenée dans l'écran (marge de 16 px de chaque côté) ;
 *  - sous le bouton si elle y tient, sinon au-dessus si elle y tient ; sinon du côté qui a le
 *    plus de place, hauteur bornée (`maxHeight`) : le contenu défile dans la fenêtre ;
 *  - jamais au-dessus du haut de l'écran ni sous son bas.
 *
 * @param {{ anchor: {top:number, bottom:number, left:number, right:number},
 *           size: {width:number, height:number}, viewport: {width:number, height:number},
 *           align?: 'left'|'right', gap?: number, margin?: number, minHeight?: number }} o
 * @returns {{ top:number, left:number, width:number, maxHeight:number|null, placement:'below'|'above' }}
 */
export function placePopover({ anchor, size, viewport, align = 'left', gap = 6, margin = 16, minHeight = 160 }) {
  const vw = Math.max(0, viewport.width);
  const vh = Math.max(0, viewport.height);
  const width = Math.max(0, Math.min(size.width, vw - 2 * margin));
  const wantLeft = align === 'right' ? anchor.right - width : anchor.left;
  const left = Math.round(Math.max(margin, Math.min(wantLeft, vw - margin - width)));

  const below = vh - anchor.bottom - gap - margin;
  const above = anchor.top - gap - margin;
  let placement;
  let maxHeight = null;
  if (size.height <= below) placement = 'below';
  else if (size.height <= above) placement = 'above';
  else {
    placement = below >= above ? 'below' : 'above';
    // Bornée à la place disponible (au moins `minHeight`, et jamais plus que l'écran).
    maxHeight = Math.max(0, Math.min(vh - 2 * margin, Math.max(minHeight, placement === 'below' ? below : above)));
  }
  const height = maxHeight == null ? size.height : Math.min(size.height, maxHeight);
  const wantTop = placement === 'below' ? anchor.bottom + gap : anchor.top - gap - height;
  const top = Math.round(Math.max(margin, Math.min(wantTop, vh - margin - height)));
  return { top, left, width, maxHeight: maxHeight == null ? null : Math.round(maxHeight), placement };
}

/**
 * Faut-il fermer la fenêtre sur un défilement ? Oui quand ce qui défile contient le bouton
 * (la page, la fenêtre modale, le tiroir…) : la fenêtre ne suivrait plus son bouton. Non
 * quand le défilement a lieu DANS la fenêtre (liste longue) ou dans un bloc sans rapport.
 * @param {EventTarget|null} target  cible de l'évènement `scroll` (document ou élément)
 * @param {{ contains: Function }|null} trigger  bouton d'ouverture
 * @param {{ contains: Function }|null} popover  fenêtre flottante
 */
export function scrollClosesPopover(target, trigger, popover) {
  if (!target) return false;
  if (popover && (target === popover || popover.contains(target))) return false;
  // Défilement du document (ou de la fenêtre) : l'ancre bouge à l'écran.
  if (target.nodeType === 9 || typeof target.contains !== 'function') return true;
  return !!trigger && target.contains(trigger);
}
