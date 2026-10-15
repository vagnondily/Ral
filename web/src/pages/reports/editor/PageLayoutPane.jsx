import React from 'react';
import { RectangleHorizontal, RectangleVertical, RotateCcw, Info, PenLine } from 'lucide-react';
import { useI18n } from '../../../lib/i18n.jsx';
import { Button } from '../../../components/ui.jsx';

/**
 * Volet droit quand une PAGE est sélectionnée (onglet Pages ou clic dans la marge d'une feuille,
 * retour 88) : orientation et format de CETTE page seulement — son contenu passe dans une section
 * propre (reportDoc.setPageLayout), les autres pages gardent leur mise en page. Le réglage du
 * document reste celui par défaut (onglet « Page » sans sélection).
 * @param {{ info: { n, total, size, orientation, own, repeatLabel, startsMid, annex }, docPage, onLayout, onReset, onAnnex, children }} props
 */
export default function PageLayoutPane({ info, docPage, onLayout, onReset, onAnnexOrientation, onBands, onDesignBands, children }) {
  const { tr } = useI18n();
  if (!info) return null;
  const docOrient = (docPage && docPage.orientation) || 'portrait';
  const docSize = (docPage && docPage.size) || 'A4';
  const seg = (value, current, set, options) => (
    <div className="rd-seg rd-seg-lg" role="radiogroup">
      {options.map(([v, label, Icon]) => (
        <button key={v} type="button" role="radio" aria-checked={current === v} className={current === v ? 'is-active' : ''} onClick={() => set(v)}>
          {Icon && <Icon size={14} aria-hidden="true" />} {tr(label)}
        </button>
      ))}
    </div>
  );
  const ORIENT = [['portrait', 'Portrait', RectangleVertical], ['landscape', 'Paysage', RectangleHorizontal]];
  if (info.annex) {
    return (
      <div className="section-gap">
        <h3>{tr('Page {n}', { n: info.n })} · {tr('Annexe {l}', { l: info.annex.letter })}</h3>
        <p className="rd-state-line">{info.annex.title}</p>
        <div className="rd-field-l">{tr('Orientation de l\'annexe')}</div>
        {seg(info.annex.mode, info.annex.mode, onAnnexOrientation, [['auto', 'Automatique'], ...ORIENT])}
        <p className="hint">{tr('Automatique : paysage si le tableau est trop large pour une page portrait.')}</p>
      </div>
    );
  }
  return (
    <div className="section-gap">
      <h3>{tr('Page {n}', { n: info.n })} <span className="rd-h3-muted">{tr('sur {total}', { total: info.total })}</span></h3>
      <div className="rd-field-l">{tr('Orientation de cette page')}</div>
      {seg(info.orientation, info.orientation, (v) => onLayout({ orientation: v === docOrient ? undefined : v }), ORIENT)}
      <div className="rd-field-l">{tr('Format de cette page')}</div>
      {seg(info.size, info.size, (v) => onLayout({ size: v === docSize ? undefined : v }), [['A4', 'A4'], ['16:9', '16:9']])}
      {onBands && (
        <div className="rd-row2 rd-page-bands">
          {[['header', 'En-tête'], ['footer', 'Pied de page']].map(([k, l]) => (
            <label key={k} className="hd-field"><span className="rd-field-l">{tr(l)}</span>
              <select className="select" value={info[k] || 'inherit'} onChange={(e) => onBands({ [k]: e.target.value })}>
                <option value="inherit">{tr('Celui du document')}</option>
                <option value="none">{tr('Aucun')}</option>
                <option value="own">{tr('Propre à cette page')}</option>
              </select>
            </label>
          ))}
        </div>
      )}
      {onDesignBands && (info.header === 'own' || info.footer === 'own') && (
        <Button size="sm" icon={PenLine} onClick={onDesignBands}>{tr('Concevoir l\'en-tête de cette page')}</Button>
      )}
      <p className="rd-note-box"><Info size={13} aria-hidden="true" /> {tr('Seule cette page change : son contenu est placé dans une section propre. Les autres pages gardent leur mise en page.')}</p>
      {info.repeatLabel && <p className="rd-state-line">{tr('Cette page fait partie de la section répétée « {name} » : la même page de chaque élément change aussi.', { name: info.repeatLabel })}</p>}
      {info.startsMid && <p className="rd-state-line">{tr('Le bloc « {name} » commence sur la page précédente : il passe en entier dans cette mise en page.', { name: info.startsMid })}</p>}
      {children}
      {info.own && (
        <Button size="sm" variant="secondary" icon={RotateCcw} onClick={onReset}>{tr('Revenir à la mise en page du document')}</Button>
      )}
    </div>
  );
}
