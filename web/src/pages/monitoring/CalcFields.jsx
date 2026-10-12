import React, { useEffect, useState } from 'react';
import { Plus, Pencil, Trash2, SlidersHorizontal, X } from 'lucide-react';
import { api } from '../../api/client.js';
import { Badge, Button, Card, CardHeader, EmptyState, Field, Skeleton } from '../../components/ui.jsx';
import Modal from '../../components/Modal.jsx';
import { useToast } from '../../components/Toast.jsx';
import { useI18n } from '../../lib/i18n.jsx';

const CALC_AGG_HELP = 'Fonctions : if(cond, a, b) · num(x) · round(x, n) · lower · upper · len · abs · min · max · coalesce · contains(x,"txt") · concat. Opérateurs : + − × ÷ % , == != < <= > >= , && || . Référez une variable par son nom (ou [nom avec espaces]).';

// Phrase traduite contenant des éléments JSX : « {nom} » → nodes[nom].
function fillNodes(text, nodes) {
  return text.split(/\{(\w+)\}/).map((part, i) => (i % 2 ? <React.Fragment key={i}>{nodes[part]}</React.Fragment> : part));
}

export function CalcFieldsCard({ form, canEdit, onChanged }) {
  const { tr } = useI18n();
  const toast = useToast();
  const [list, setList] = useState(null);
  const [catalog, setCatalog] = useState({ fields: [], choices: [] });
  const [edit, setEdit] = useState(null);

  async function reload() {
    try {
      const [cf, cat] = await Promise.all([api.monCalcFields(form.id), api.monCatalog(form.id)]);
      setList(cf); setCatalog(cat || { fields: [], choices: [] });
    } catch (e) { toast.error(e.message); setList([]); }
  }
  useEffect(() => { setList(null); reload(); /* eslint-disable-next-line */ }, [form.id]);

  async function remove(c) {
    if (!window.confirm(tr('Supprimer le champ calculé « {name} » ?', { name: c.label || c.name }))) return;
    try { await api.monDeleteCalcField(c.id); toast.success(tr('Champ calculé supprimé.')); reload(); onChanged?.(); }
    catch (e) { toast.error(e.message); }
  }

  return (
    <Card aria-labelledby="calc-title">
      <CardHeader id="calc-title" title={tr('Champs calculés & préparation')}
        subtitle={tr("Créez des variables dérivées (recodage de valeurs ou formule) à partir des variables existantes — réutilisables comme source d'indicateur et visibles dans les données. Nettoyage « type Tableau », sans code.")}>
        {canEdit && <Button size="sm" icon={Plus} onClick={() => setEdit({})}>{tr('Nouveau champ calculé')}</Button>}
      </CardHeader>
      {list === null ? <div className="card-body"><Skeleton height={100} /></div>
        : list.length === 0 ? (
          <EmptyState icon={SlidersHorizontal} title={tr('Aucun champ calculé')}
            action={canEdit && <Button icon={Plus} onClick={() => setEdit({})}>{tr('Nouveau champ calculé')}</Button>}>
            {fillNodes(tr('Ex. recoder {field} (oui→1, non→0), ou une formule {formula}.'), { field: <code>cfm</code>, formula: <code className="mono">if(age {'>='} 5, 1, 0)</code> })}
          </EmptyState>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>{tr('Champ')}</th><th>{tr('Type')}</th><th>{tr('Définition')}</th>{canEdit && <th />}</tr></thead>
              <tbody>
                {list.map((c) => (
                  <tr key={c.id}>
                    <td><strong>{c.label || c.name}</strong><div className="site-meta mono">ƒ {c.name}</div></td>
                    <td>{c.kind === 'recode' ? <Badge tone="blue">{tr('recodage')}</Badge> : <Badge tone={null}>{tr('formule')}</Badge>}</td>
                    <td>{c.kind === 'recode'
                      ? <span className="mono ind-sub">{c.sourceField} → {Object.entries(c.mapping || {}).slice(0, 4).map(([k, v]) => `${k}:${v}`).join(', ')}{Object.keys(c.mapping || {}).length > 4 ? '…' : ''}</span>
                      : <code className="skip-expr">{c.expression}</code>}</td>
                    {canEdit && <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <Button size="sm" variant="ghost" icon={Pencil} aria-label={tr('Éditer')} onClick={() => setEdit(c)} />
                      <Button size="sm" variant="ghost" icon={Trash2} aria-label={tr('Supprimer')} onClick={() => remove(c)} />
                    </td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      {edit && <CalcFieldModal form={form} catalog={catalog} calc={edit.id ? edit : null}
        onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); onChanged?.(); }} />}
    </Card>
  );
}

function CalcFieldModal({ form, catalog, calc, onClose, onSaved }) {
  const { tr } = useI18n();
  const toast = useToast();
  const editing = Boolean(calc);
  const [f, setF] = useState(() => calc
    ? { ...calc, pairs: Object.entries(calc.mapping || {}).map(([k, v]) => ({ k, v: String(v) })) }
    : { name: '', label: '', kind: 'expression', expression: '', sourceField: '', defaultValue: '', pairs: [{ k: '', v: '' }] });
  const [saving, setSaving] = useState(false);
  const fields = catalog.fields || [];
  const err = { name: !/^[A-Za-z_][A-Za-z0-9_]*$/.test(f.name.trim()), src: f.kind === 'recode' && !f.sourceField };

  async function save() {
    if (err.name) { toast.error(tr('Nom : lettres/chiffres/_ , sans espace.')); return; }
    if (err.src) { toast.error(tr('Choisissez la variable source à recoder.')); return; }
    const body = { name: f.name.trim(), label: f.label?.trim() || f.name.trim(), kind: f.kind };
    if (f.kind === 'expression') body.expression = f.expression;
    else {
      body.sourceField = f.sourceField;
      body.mapping = Object.fromEntries(f.pairs.filter((p) => p.k !== '').map((p) => [p.k, p.v]));
      body.defaultValue = f.defaultValue?.trim() || undefined;
    }
    setSaving(true);
    try {
      if (editing) await api.monUpdateCalcField(calc.id, body); else await api.monCreateCalcField(form.id, body);
      toast.success(tr('Champ calculé enregistré.')); onSaved();
    } catch (e) { toast.error(e.message); } finally { setSaving(false); }
  }

  const setPair = (i, key, val) => setF((s) => ({ ...s, pairs: s.pairs.map((p, j) => (j === i ? { ...p, [key]: val } : p)) }));

  return (
    <Modal open size="lg" title={editing ? tr('Modifier le champ calculé') : tr('Nouveau champ calculé')}
      subtitle={tr('Variable dérivée à partir des variables existantes.')} onClose={() => !saving && onClose()}
      footer={<><Button variant="secondary" onClick={onClose} disabled={saving}>{tr('Annuler')}</Button><Button onClick={save} loading={saving}>{tr('Enregistrer')}</Button></>}>
      <div style={{ display: 'grid', gap: 14 }}>
        <div className="form-grid">
          <Field label={tr('Libellé')}><input className="input" value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} placeholder={tr('CFM (binaire)')} /></Field>
          <Field label={tr('Nom technique')} required hint={tr("Sans espace ; utilisable dans les formules et comme source d'indicateur.")}>
            <input className="input mono" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="cfm_bin" />
          </Field>
        </div>
        <Field label={tr('Type')}>
          <div className="seg" role="group">
            <button type="button" className={f.kind === 'expression' ? 'is-active' : ''} onClick={() => setF({ ...f, kind: 'expression' })}>{tr('Formule')}</button>
            <button type="button" className={f.kind === 'recode' ? 'is-active' : ''} onClick={() => setF({ ...f, kind: 'recode' })}>{tr('Recodage')}</button>
          </div>
        </Field>

        {f.kind === 'expression' ? (
          <Field label={tr('Formule')} hint={tr(CALC_AGG_HELP)}>
            <input className="input mono" value={f.expression} onChange={(e) => setF({ ...f, expression: e.target.value })} placeholder="if(cfm == &quot;oui&quot;, 1, 0)" />
          </Field>
        ) : (
          <>
            <Field label={tr('Variable source')} required>
              <select className={`select ${f.sourceField ? '' : 'is-empty'}`} value={f.sourceField} onChange={(e) => setF({ ...f, sourceField: e.target.value })}>
                <option value="">{tr('Choisir une variable…')}</option>
                {fields.map((x) => <option key={x.name} value={x.name}>{x.label && x.label !== x.name ? `${x.label} — ${x.name}` : x.name}</option>)}
              </select>
            </Field>
            <div className="field">
              <span className="field-label">{tr('Correspondances (valeur → nouvelle valeur)')}</span>
              <div style={{ display: 'grid', gap: 6 }}>
                {f.pairs.map((p, i) => (
                  <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 24px 1fr 32px', gap: 6, alignItems: 'center' }}>
                    <input className="input" value={p.k} onChange={(e) => setPair(i, 'k', e.target.value)} placeholder={tr('oui')} />
                    <span style={{ textAlign: 'center', color: 'var(--text-faint)' }}>→</span>
                    <input className="input" value={p.v} onChange={(e) => setPair(i, 'v', e.target.value)} placeholder="1" />
                    <Button size="sm" variant="ghost" icon={X} aria-label={tr('Retirer')} onClick={() => setF((s) => ({ ...s, pairs: s.pairs.filter((_, j) => j !== i) }))} />
                  </div>
                ))}
                <Button size="sm" variant="ghost" icon={Plus} onClick={() => setF((s) => ({ ...s, pairs: [...s.pairs, { k: '', v: '' }] }))}>{tr('Ajouter une correspondance')}</Button>
              </div>
            </div>
            <Field label={tr('Valeur par défaut (si aucune correspondance)')}><input className="input" value={f.defaultValue} onChange={(e) => setF({ ...f, defaultValue: e.target.value })} placeholder="0" /></Field>
          </>
        )}
      </div>
    </Modal>
  );
}
