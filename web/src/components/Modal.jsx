import React, { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { IconButton } from './ui.jsx';

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Accessible dialog, centered or as a right-hand drawer.
 * - Esc and backdrop click close it
 * - focus moves inside on open, is trapped with Tab, and returns to the
 *   element that opened it on close
 * - page scroll is locked while open
 */
export default function Modal({ open, onClose, title, subtitle, variant = 'dialog', wide, size, footer, children, initialFocus }) {
  const dialogRef = useRef(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose; // Esc handler always calls the latest callback
  const titleId = useId();
  const drawer = variant === 'drawer';

  useEffect(() => {
    if (!open) return undefined;
    const previouslyFocused = document.activeElement;
    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';

    const node = dialogRef.current;
    const target = (initialFocus && node.querySelector(initialFocus)) || node.querySelector(FOCUSABLE);
    target?.focus();

    function onKey(e) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCloseRef.current();
      } else if (e.key === 'Tab') {
        const items = [...node.querySelectorAll(FOCUSABLE)];
        if (items.length === 0) return;
        const first = items[0];
        const last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      previouslyFocused?.focus?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  // Portal to <body>: the overlay must never inherit layout from wherever
  // the component is declared (margins, transforms, overflow clipping).
  return createPortal(
    <div className={`overlay ${drawer ? 'is-drawer' : ''}`} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={dialogRef}
        className={`dialog ${drawer ? 'is-drawer' : ''} ${wide ? 'is-wide' : ''} ${size === 'xl' ? 'is-xwide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="dialog-head">
          <div>
            <h2 className="dialog-title" id={titleId}>{title}</h2>
            {subtitle && <p className="dialog-sub">{subtitle}</p>}
          </div>
          <IconButton icon={X} label="Fermer" onClick={onClose} />
        </div>
        <div className="dialog-body">{children}</div>
        {footer && <div className="dialog-foot">{footer}</div>}
      </div>
    </div>,
    document.body
  );
}
