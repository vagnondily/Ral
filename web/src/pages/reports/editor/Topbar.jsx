import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft, Lock, RefreshCw, RotateCw, Undo2, Redo2, Download, Save, Copy, LayoutTemplate, ListFilter, ChevronDown,
  Printer, FileText, FileCode2, FileSpreadsheet,
} from 'lucide-react';
import { useI18n } from '../../../lib/i18n.jsx';
import { Badge, Button, IconButton } from '../../../components/ui.jsx';
import ReportPeriod from './ReportPeriod.jsx';
import { ReportFiltersEditor, filterValueLabel } from './FiltersPane.jsx';
import { FILTERS } from './blockTypes.js';

/** Menu déroulant simple (fermé au clic extérieur et sur Échap). */
function Menu({ label, icon, disabled, title, children }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const off = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', off); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', off); document.removeEventListener('keydown', esc); };
  }, [open]);
  return (
    <div className="rd-menu" ref={ref}>
      <Button variant="secondary" icon={icon} disabled={disabled} title={title} onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="menu">{label} <ChevronDown size={13} aria-hidden="true" /></Button>
      {open && <div className="rd-menu-list" role="menu" onClick={() => setOpen(false)}>{children}</div>}
    </div>
  );
}

/**
 * Barre d'outils de l'éditeur (une ligne dès 1 280 px) : retour, titre, statut, période,
 * filtres du rapport ; progression des calculs (« 9 blocs sur 11 calculés »), annuler /
 * rétablir, actualiser, Exporter ▾, modèle, enregistrer, finaliser. Impression et exports :
 * seulement quand tous les blocs sont calculés (rien d'exporté à moitié).
 */
export default function Topbar({
  doc, meta, dirty, saving, editable, canEdit, final, computing, progress, history, forms, opts, exportBlocked,
  onBack, onTitle, onPeriod, onFilters, onRefresh, onSave, onFinalize, onTemplate, onDuplicate,
  onPdf, onHtml, onWord, onXlsx, topbarRef,
}) {
  const { tr } = useI18n();
  const [showFilters, setShowFilters] = useState(false);
  const f = doc.filters || {};
  const active = FILTERS.filter((x) => f[x.key] != null);
  const all = { ...opts, forms };
  const blocked = computing || exportBlocked;
  const blockedTitle = computing ? tr('{done} blocs sur {total} calculés : attendez la fin du calcul', progress) : exportBlocked || undefined;
  return (
    <div className="rd-topbar" ref={topbarRef}>
      <div className="rd-topbar-row">
        <Button variant="ghost" icon={ArrowLeft} onClick={onBack}>{tr('Rapports')}</Button>
        <input className="input rd-title" value={doc.title} disabled={!editable} maxLength={200} aria-label={tr('Titre du rapport')} onChange={(e) => onTitle(e.target.value)} />
        {final ? <Badge tone="green" icon={Lock}>{tr('Finalisé')}</Badge> : dirty ? <Badge tone="yellow">{tr('Non enregistré')}</Badge> : <Badge>{tr('Enregistré')}{meta.version ? ` · v${meta.version}` : ''}</Badge>}
        <ReportPeriod compact value={doc.period} disabled={!editable} onChange={onPeriod} />
        <Button variant={active.length ? 'secondary' : 'ghost'} size="sm" icon={ListFilter} onClick={() => setShowFilters((s) => !s)} aria-expanded={showFilters} className="rd-filters-btn">
          <span className="rd-ellipsis">{active.length ? active.map((x) => filterValueLabel(x.key, f[x.key], all, tr)).join(' · ') : tr('Filtres')}</span>
        </Button>
        <span className="mmr-spacer" />
        {computing && <span className="rd-loading" aria-live="polite"><RefreshCw size={14} className="spin" aria-hidden="true" /> {tr('{done} blocs sur {total} calculés', progress)}</span>}
        {editable && <>
          <IconButton icon={Undo2} size="sm" onClick={history.undo} disabled={!history.canUndo} label={tr('Annuler (Ctrl+Z)')} />
          <IconButton icon={Redo2} size="sm" onClick={history.redo} disabled={!history.canRedo} label={tr('Rétablir (Ctrl+Y)')} />
        </>}
        {!final && <IconButton icon={RotateCw} size="sm" onClick={onRefresh} label={tr('Actualiser les données (recalculer tous les blocs)')} />}
        <div className="header-actions">
          <Menu label={tr('Exporter')} icon={Download} disabled={blocked} title={blockedTitle}>
            <button type="button" role="menuitem" onClick={onPdf}><Printer size={14} aria-hidden="true" /> {tr('PDF (impression)')}</button>
            <button type="button" role="menuitem" onClick={onWord}><FileText size={14} aria-hidden="true" /> Word</button>
            <button type="button" role="menuitem" onClick={onXlsx}><FileSpreadsheet size={14} aria-hidden="true" /> Excel</button>
            <button type="button" role="menuitem" onClick={onHtml}><FileCode2 size={14} aria-hidden="true" /> HTML</button>
          </Menu>
          {canEdit && <IconButton icon={LayoutTemplate} variant="ghost" onClick={onTemplate} label={tr('Enregistrer comme modèle')} />}
          {canEdit && final && <Button variant="secondary" icon={Copy} onClick={onDuplicate}>{tr('Dupliquer')}</Button>}
          {editable && meta.id && !dirty && <Button variant="secondary" icon={Lock} onClick={onFinalize}>{tr('Finaliser')}</Button>}
          {editable && <Button icon={Save} loading={saving} onClick={onSave} disabled={!dirty || !doc.title.trim()} title={tr('Enregistrer (Ctrl+S)')}>{tr('Enregistrer')}</Button>}
        </div>
      </div>
      {showFilters && (
        <div className="rd-topbar-filters">
          <p className="hint">{tr('Filtres du rapport : appliqués à chaque bloc qui sait les prendre en compte ; un bloc peut les remplacer ou les ignorer (« Tous »).')}</p>
          <ReportFiltersEditor filters={f} onChange={onFilters} forms={forms} opts={opts} disabled={!editable} />
        </div>
      )}
    </div>
  );
}
