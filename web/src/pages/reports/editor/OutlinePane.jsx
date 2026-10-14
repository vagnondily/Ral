import React, { useRef } from 'react';
import { ChevronUp, ChevronDown, Copy, Trash2, GripVertical, Type } from 'lucide-react';
import { useI18n } from '../../../lib/i18n.jsx';
import { TYPE_ICON, outlineLabel } from './blockTypes.js';

/**
 * Volet « Plan » : arbre du document (sections avec leur orientation, sections répétées,
 * colonnes) ; sélection, glisser pour réordonner, monter / descendre, dupliquer, supprimer.
 */
export default function OutlinePane({ blocks, catalog, selected, onSelect, onMove, onMoveTo, onRemove, onDuplicate, nested = false }) {
  const { tr } = useI18n();
  const drag = useRef(null);
  if (!nested && !blocks.length) return <p className="hint rd-pane-body">{tr('Le rapport est vide : ajoutez des blocs depuis le catalogue.')}</p>;
  const list = (
    <ol className={`rd-outline ${nested ? 'is-nested' : ''}`}>
      {blocks.map((b, i) => {
        const Icon = TYPE_ICON[b.type] || Type;
        const label = String(outlineLabel(b, catalog, tr));
        return (
          <li key={b.id} draggable onDragStart={(e) => { e.stopPropagation(); drag.current = b.id; }} onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); e.stopPropagation(); if (drag.current && drag.current !== b.id) onMoveTo(drag.current, i); drag.current = null; }}>
            <div className={`rd-ol-row ${selected === b.id ? 'is-selected' : ''}`} onClick={() => onSelect(b.id)}>
              <GripVertical size={13} className="rd-grip" aria-hidden="true" />
              <Icon size={14} aria-hidden="true" />
              <span className="rd-ol-label" title={label}>{label}</span>
              {b.type === 'section' && <span className="rd-orient">{tr(b.params.orientation === 'landscape' ? 'paysage' : 'portrait')}</span>}
              <span className="rd-block-tools">
                <button type="button" onClick={(e) => { e.stopPropagation(); onMove(b.id, -1); }} aria-label={tr('Monter')} disabled={i === 0}><ChevronUp size={13} /></button>
                <button type="button" onClick={(e) => { e.stopPropagation(); onMove(b.id, 1); }} aria-label={tr('Descendre')} disabled={i === blocks.length - 1}><ChevronDown size={13} /></button>
                <button type="button" onClick={(e) => { e.stopPropagation(); onDuplicate(b.id); }} aria-label={tr('Dupliquer')}><Copy size={13} /></button>
                <button type="button" onClick={(e) => { e.stopPropagation(); if (window.confirm(tr('Supprimer ce bloc ?'))) onRemove(b.id); }} aria-label={tr('Supprimer')}><Trash2 size={13} /></button>
              </span>
            </div>
            {b.type === 'repeat' && <OutlinePane nested blocks={b.params.blocks} catalog={catalog} selected={selected} onSelect={onSelect} onMove={onMove} onMoveTo={onMoveTo} onRemove={onRemove} onDuplicate={onDuplicate} />}
            {b.type === 'columns' && b.params.cols.map((col, c) => <OutlinePane key={c} nested blocks={col} catalog={catalog} selected={selected} onSelect={onSelect} onMove={onMove} onMoveTo={onMoveTo} onRemove={onRemove} onDuplicate={onDuplicate} />)}
          </li>
        );
      })}
    </ol>
  );
  return nested ? list : <div className="rd-pane-body">{list}</div>;
}
