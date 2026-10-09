import React, { useEffect, useState } from 'react';
import { Plus, Pencil, Trash2, SlidersHorizontal, X } from 'lucide-react';
import { api } from '../../api/client.js';
import { Badge, Button, Card, CardHeader, EmptyState, Field, Skeleton } from '../../components/ui.jsx';
import Modal from '../../components/Modal.jsx';
import { useToast } from '../../components/Toast.jsx';

const CALC_AGG_HELP = 'Fonctions : if(cond, a, b) · num(x) · round(x, n) · lower · upper · len · abs · min · max · coalesce · contains(x,"txt") · concat. Opérateurs : + − × ÷ % , == != < <= > >= , && || . Référez une variable par son nom (ou [nom avec espaces]).';

export function CalcFieldsCard({ form, canEdit, onChanged }) {
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
    if (!window.confirm(`Supprimer le champ calculé « ${c.label || c.name} » ?`)) return;
    try { await api.monDeleteCalcField(c.id); toast.success('Champ calculé supprimé.'); reload(); onChanged?.(); }
    catch (e) { toast.error(e.message); }
  }

  return (
    <Card aria-labelledby="calc-title">
      <CardHeader id="calc-title" title="Champs calculés & préparation"
        subtitle="Créez des variables dérivées (recodage de valeurs ou formule) à partir des variables existantes — réutilisables comme source d'indicateur et visibles dans les données. Nettoyage « type Tableau », sans code.">
        {canEdit && <Button size="sm" icon={Plus} onClick={() => setEdit({})}>Nouveau champ calculé</Button>}
      </CardHeader>
      {list === null ? <div className="card-body"><Skeleton height={100} /></div>
        : list.length === 0 ? (
          <EmptyState icon={SlidersHorizontal} title="Aucun champ calculé"
            action={canEdit && <Button icon={Plus} onClick={() => setEdit({})}>Nouveau champ calculé</Button>}>
            Ex. recoder <code>cfm</code> (oui→1, non→0), ou une formule <code className="mono">if(age {'>='} 5, 1, 0)</code>.
          </EmptyState>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Champ</th><th>Type</th><th>Définition</th>{canEdit && <th />}</tr></thead>
              <tbody>
                {list.map((c) => (
                  <tr key={c.id}>
                    <td><strong>{c.label || c.name}</strong><div className="site-meta mono">ƒ {c.name}</div></td>
                    <td>{c.kind === 'recode' ? <Badge tone="blue">recodage</Badge> : <Badge tone={null}>formule</Badge>}</td>
                    <td>{c.kind === 'recode'
                      ? <span className="mono ind-sub">{c.sourceField} → {Object.entries(c.mapping || {}).slice(0, 4).map(([k, v]) => `${k}:${v}`).join(', ')}{Object.keys(c.mapping || {}).length > 4 ? '…' : ''}</span>
                      : <code className="skip-expr">{c.expression}</code>}</td>
                    {canEdit && <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <Button size="sm" variant="ghost" icon={Pencil} aria-label="Éditer" onClick={() => setEdit(c)} />
                      <Button size="sm" variant="ghost" icon={Trash2} aria-label="Supprimer" onClick={() => remove(c)} />
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
  const toast = useToast();
  const editing = Boolean(calc);
  const [f, setF] = useState(() => calc
    ? { ...calc, pairs: Object.entries(calc.mapping || {}).map(([k, v]) => ({ k, v: String(v) })) }
    : { name: '', label: '', kind: 'expression', expression: '', sourceField: '', defaultValue: '', pairs: [{ k: '', v: '' }] });
  const [saving, setSaving] = useState(false);
  const fields = catalog.fields || [];
  const err = { name: !/^[A-Za-z_][A-Za-z0-9_]*$/.test(f.name.trim()), src: f.kind === 'recode' && !f.sourceField };

  async function save() {
    if (err.name) { toast.error('Nom : lettres/chiffres/_ , sans espace.'); return; }
    if (err.src) { toast.error('Choisissez la variable source à recoder.'); return; }
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
      toast.success('Champ calculé enregistré.'); onSaved();
    } catch (e) { toast.error(e.message); } finally { setSaving(false); }
  }

  const setPair = (i, key, val) => setF((s) => ({ ...s, pairs: s.pairs.map((p, j) => (j === i ? { ...p, [key]: val } : p)) }));

  return (
    <Modal open size="lg" title={editing ? 'Modifier le champ calculé' : 'Nouveau champ calculé'}
      subtitle="Variable dérivée à partir des variables existantes." onClose={() => !saving && onClose()}
      footer={<><Button variant="secondary" onClick={onClose} disabled={saving}>Annuler</Button><Button onClick={save} loading={saving}>Enregistrer</Button></>}>
      <div style={{ display: 'grid', gap: 14 }}>
        <div className="form-grid">
          <Field label="Libellé"><input className="input" value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} placeholder="CFM (binaire)" /></Field>
          <Field label="Nom technique" required hint="Sans espace ; utilisable dans les formules et comme source d'indicateur.">
            <input className="input mono" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="cfm_bin" />
          </Field>
        </div>
        <Field label="Type">
          <div className="seg" role="group">
            <button type="button" className={f.kind === 'expression' ? 'is-active' : ''} onClick={() => setF({ ...f, kind: 'expression' })}>Formule</button>
            <button type="button" className={f.kind === 'recode' ? 'is-active' : ''} onClick={() => setF({ ...f, kind: 'recode' })}>Recodage</button>
          </div>
        </Field>

        {f.kind === 'expression' ? (
          <Field label="Formule" hint={CALC_AGG_HELP}>
            <input className="input mono" value={f.expression} onChange={(e) => setF({ ...f, expression: e.target.value })} placeholder="if(cfm == &quot;oui&quot;, 1, 0)" />
          </Field>
        ) : (
          <>
            <Field label="Variable source" required>
              <select className={`select ${f.sourceField ? '' : 'is-empty'}`} value={f.sourceField} onChange={(e) => setF({ ...f, sourceField: e.target.value })}>
                <option value="">Choisir une variable…</option>
                {fields.map((x) => <option key={x.name} value={x.name}>{x.label && x.label !== x.name ? `${x.label} — ${x.name}` : x.name}</option>)}
              </select>
            </Field>
            <div className="field">
              <span className="field-label">Correspondances (valeur → nouvelle valeur)</span>
              <div style={{ display: 'grid', gap: 6 }}>
                {f.pairs.map((p, i) => (
                  <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 24px 1fr 32px', gap: 6, alignItems: 'center' }}>
                    <input className="input" value={p.k} onChange={(e) => setPair(i, 'k', e.target.value)} placeholder="oui" />
                    <span style={{ textAlign: 'center', color: 'var(--text-faint)' }}>→</span>
                    <input className="input" value={p.v} onChange={(e) => setPair(i, 'v', e.target.value)} placeholder="1" />
                    <Button size="sm" variant="ghost" icon={X} aria-label="Retirer" onClick={() => setF((s) => ({ ...s, pairs: s.pairs.filter((_, j) => j !== i) }))} />
                  </div>
                ))}
                <Button size="sm" variant="ghost" icon={Plus} onClick={() => setF((s) => ({ ...s, pairs: [...s.pairs, { k: '', v: '' }] }))}>Ajouter une correspondance</Button>
              </div>
            </div>
            <Field label="Valeur par défaut (si aucune correspondance)"><input className="input" value={f.defaultValue} onChange={(e) => setF({ ...f, defaultValue: e.target.value })} placeholder="0" /></Field>
          </>
        )}
      </div>
    </Modal>
  );
}
