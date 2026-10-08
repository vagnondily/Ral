import React, { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2, Pencil, Link2, ClipboardCheck, Info, SlidersHorizontal } from 'lucide-react';
import { api } from '../../api/client.js';
import { Alert, Badge, Button, Card, CardHeader, EmptyState, Field, Skeleton } from '../../components/ui.jsx';
import Modal from '../../components/Modal.jsx';
import { useToast } from '../../components/Toast.jsx';

/**
 * Paramétrage › Indicateurs & méthodes de calcul.
 *
 * C'est ici que l'on construit la méthode de calcul de chaque indicateur à
 * partir des variables disponibles (les champs du formulaire importé) : on
 * choisit une variable source, un mode d'agrégation, et — pour un « % égal à
 * une valeur » — la valeur positive est proposée depuis la liste de choix du
 * champ. L'écran « Données & indicateurs » ne fait plus que définir la fiche,
 * importer les données et afficher les résultats recalculés.
 */
const AGG_LABELS = {
  percent_yes: '% de « oui » (réponses oui / non)',
  percent_value: '% égal à une valeur de choix',
  mean: 'Moyenne des valeurs numériques',
  sum: 'Somme des valeurs numériques',
  count: 'Nombre de réponses',
};
const AGG_SHORT = { percent_yes: '% de « oui »', percent_value: '% = valeur', mean: 'Moyenne', sum: 'Somme', count: 'Nombre' };

export default function IndicatorsSettings({ isAdmin }) {
  const toast = useToast();
  const [forms, setForms] = useState(null);
  const [formId, setFormId] = useState('');
  const [indicators, setIndicators] = useState(null);
  const [catalog, setCatalog] = useState({ fields: [], choices: [] });
  const [edit, setEdit] = useState(null); // indicator | {} (new) | null

  async function loadForms() {
    try {
      const list = await api.monForms();
      setForms(list);
      setFormId((cur) => cur || (list[0] && list[0].id) || '');
    } catch (e) { toast.error(e.message); setForms([]); }
  }
  useEffect(() => { loadForms(); /* eslint-disable-next-line */ }, []);

  const form = (forms || []).find((f) => f.id === formId);

  async function reload() {
    if (!formId) { setIndicators([]); return; }
    try {
      const [inds, cat] = await Promise.all([api.monIndicators(formId), api.monCatalog(formId)]);
      setIndicators(inds); setCatalog(cat || { fields: [], choices: [] });
    } catch (e) { toast.error(e.message); setIndicators([]); }
  }
  useEffect(() => { setIndicators(null); reload(); /* eslint-disable-next-line */ }, [formId]);

  async function remove(i) {
    if (!window.confirm(`Supprimer l'indicateur « ${i.label} » ?`)) return;
    try { await api.monDeleteIndicator(i.id); toast.success('Indicateur supprimé.'); reload(); }
    catch (e) { toast.error(e.message); }
  }

  const fieldLabel = useMemo(() => {
    const m = {};
    for (const f of catalog.fields || []) m[f.name] = f.label || f.name;
    return m;
  }, [catalog]);

  return (
    <Card aria-labelledby="ind-set-title">
      <CardHeader id="ind-set-title" title="Indicateurs & méthodes de calcul"
        subtitle="Construisez chaque indicateur à partir des variables disponibles (les champs du formulaire) : une variable source + un mode de calcul. Les résultats sont recalculés en direct depuis les données importées.">
        {forms && forms.length > 0 && (
          <select className="select" style={{ minWidth: 220 }} value={formId} onChange={(e) => setFormId(e.target.value)} aria-label="Formulaire de suivi">
            {forms.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
          </select>
        )}
        {isAdmin && forms && forms.length > 0 && <Button size="sm" icon={Plus} onClick={() => setEdit({})}>Nouvel indicateur</Button>}
      </CardHeader>

      {forms === null ? <div className="card-body"><Skeleton height={120} /></div>
        : forms.length === 0 ? (
          <EmptyState icon={ClipboardCheck} title="Aucun formulaire de suivi">
            Importez d'abord un XLSForm dans <strong>Suivi de processus › Données &amp; indicateurs</strong> pour disposer des variables
            à partir desquelles définir vos indicateurs.
          </EmptyState>
        ) : (
          <>
            <div className="card-body" style={{ paddingBottom: 0 }}>
              <Alert tone="info" icon={Info}>
                {catalog.fields?.length
                  ? <>{catalog.fields.length} variable(s) disponible(s) dans cette fiche. Un indicateur relie une variable à un mode de calcul (ex. « % de bénéficiaires informés » ← champ <code>info_recue</code>, mode « % de oui »).</>
                  : <>Cette fiche n'a pas encore de catalogue de champs. Importez sa définition XLSForm (ou des données réelles) pour lister les variables disponibles.</>}
              </Alert>
            </div>
            {indicators === null ? <div className="card-body"><Skeleton height={100} /></div>
              : indicators.length === 0 ? (
                <EmptyState icon={Link2} title="Aucun indicateur"
                  action={isAdmin && <Button icon={Plus} onClick={() => setEdit({})}>Nouvel indicateur</Button>}>
                  Définissez un indicateur et reliez-le à une variable du formulaire.
                </EmptyState>
              ) : (
                <div className="table-wrap">
                  <table className="table">
                    <thead><tr>
                      <th scope="col">Indicateur</th><th scope="col">Module</th><th scope="col">Variable source</th>
                      <th scope="col">Méthode de calcul</th><th scope="col" className="num">Cible</th><th scope="col">Sens</th>{isAdmin && <th scope="col" />}
                    </tr></thead>
                    <tbody>
                      {indicators.map((i) => (
                        <tr key={i.id}>
                          <td><strong>{i.label}</strong><div className="site-meta mono">{i.code}</div></td>
                          <td>{i.module || <span className="cell-empty">—</span>}</td>
                          <td><span className="mono">{i.sourceField}</span>
                            {fieldLabel[i.sourceField] && fieldLabel[i.sourceField] !== i.sourceField && <div className="site-meta">{fieldLabel[i.sourceField]}</div>}
                            {i.agg === 'percent_value' && i.positiveValue ? <div className="site-meta">= {i.positiveValue}</div> : null}</td>
                          <td>{AGG_SHORT[i.agg] || i.agg}</td>
                          <td className="num mono">{i.target ?? <span className="cell-empty">—</span>}</td>
                          <td>{i.direction === 'lower_better' ? '↓ mieux' : '↑ mieux'}</td>
                          {isAdmin && <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                            <Button size="sm" variant="ghost" icon={Pencil} aria-label="Éditer" onClick={() => setEdit(i)} />
                            <Button size="sm" variant="ghost" icon={Trash2} aria-label="Supprimer" onClick={() => remove(i)} />
                          </td>}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
          </>
        )}

      {edit && <IndicatorModal form={form} catalog={catalog} indicator={edit.id ? edit : null}
        onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} />}
    </Card>
  );
}

function IndicatorModal({ form, catalog, indicator, onClose, onSaved }) {
  const toast = useToast();
  const editing = Boolean(indicator);
  const [f, setF] = useState(() => indicator || { code: '', label: '', module: '', sourceField: '', agg: 'percent_yes', positiveValue: '', target: '', direction: 'higher_better' });
  const [saving, setSaving] = useState(false);
  const [touched, setTouched] = useState(false);
  const err = { code: !f.code.trim(), label: !f.label.trim(), sourceField: !String(f.sourceField).trim() };

  const fields = catalog.fields || [];
  const selField = fields.find((x) => x.name === f.sourceField);
  // Valeurs de choix de la variable sélectionnée (pour « % égal à une valeur »).
  const fieldChoices = useMemo(() => {
    if (!selField?.listName) return [];
    return (catalog.choices || []).filter((c) => c.listName === selField.listName);
  }, [catalog, selField]);

  async function save() {
    setTouched(true);
    if (err.code || err.label || err.sourceField) return;
    const body = {
      code: f.code.trim(), label: f.label.trim(), module: f.module?.trim() || undefined,
      sourceField: String(f.sourceField).trim(), agg: f.agg,
      positiveValue: f.agg === 'percent_value' ? (String(f.positiveValue).trim() || undefined) : undefined,
      target: f.target === '' || f.target == null ? null : Number(f.target),
      direction: f.direction,
    };
    setSaving(true);
    try {
      if (editing) await api.monUpdateIndicator(indicator.id, body);
      else await api.monCreateIndicator(form.id, body);
      toast.success('Indicateur enregistré.'); onSaved();
    } catch (e) { toast.error(e.message); } finally { setSaving(false); }
  }

  return (
    <Modal open size="lg" title={editing ? 'Modifier l\'indicateur' : 'Nouvel indicateur'}
      subtitle="Reliez une variable du formulaire à une méthode de calcul." onClose={() => !saving && onClose()}
      footer={<><Button variant="secondary" onClick={onClose} disabled={saving}>Annuler</Button><Button onClick={save} loading={saving}>Enregistrer</Button></>}>
      <div style={{ display: 'grid', gap: 14 }}>
        <div className="form-grid">
          <Field label="Libellé" required error={touched && err.label ? 'Requis.' : undefined}><input className="input" value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} placeholder="Bénéficiaires informés" /></Field>
          <Field label="Code" required error={touched && err.code ? 'Requis.' : undefined}><input className="input mono" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} placeholder="benef_informes" /></Field>
        </div>
        <Field label="Module (regroupement)" hint="Sert à regrouper les indicateurs dans les résultats (ex. « Information & CFM »).">
          <input className="input" value={f.module} onChange={(e) => setF({ ...f, module: e.target.value })} placeholder="Information & CFM" />
        </Field>

        <div className="field">
          <span className="field-label">Variable source (champ du formulaire) <span className="req">*</span></span>
          <div className="hint" style={{ marginBottom: 6 }}>
            {fields.length ? `${fields.length} variable(s) disponible(s) dans cette fiche.` : 'Aucun catalogue de champs : saisissez le nom exact de la variable.'}
          </div>
          {fields.length ? (
            <select className={`select ${f.sourceField ? '' : 'is-empty'}`} value={f.sourceField}
              onChange={(e) => setF({ ...f, sourceField: e.target.value, positiveValue: '' })}>
              <option value="">Choisir une variable…</option>
              {fields.map((x) => <option key={x.name} value={x.name}>{x.label && x.label !== x.name ? `${x.label} — ${x.name}` : x.name}{x.type ? ` (${x.type})` : ''}</option>)}
            </select>
          ) : (
            <input className="input mono" value={f.sourceField} onChange={(e) => setF({ ...f, sourceField: e.target.value })} placeholder="info_recue" />
          )}
          {touched && err.sourceField && <div className="field-error">Requis.</div>}
          {selField?.group && <div className="site-meta" style={{ marginTop: 4 }}>Groupe : {selField.group}</div>}
        </div>

        <div className="form-grid">
          <Field label="Méthode de calcul">
            <select className="select" value={f.agg} onChange={(e) => setF({ ...f, agg: e.target.value })}>
              {Object.entries(AGG_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Field>
          {f.agg === 'percent_value'
            ? (
              <Field label="Valeur « positive »" hint="Réponse comptée comme atteinte.">
                {fieldChoices.length ? (
                  <select className="select" value={f.positiveValue} onChange={(e) => setF({ ...f, positiveValue: e.target.value })}>
                    <option value="">Choisir une valeur…</option>
                    {fieldChoices.map((c) => <option key={c.value} value={c.value}>{c.label && c.label !== c.value ? `${c.label} (${c.value})` : c.value}</option>)}
                  </select>
                ) : (
                  <input className="input" value={f.positiveValue} onChange={(e) => setF({ ...f, positiveValue: e.target.value })} placeholder="oui / 1 / A" />
                )}
              </Field>
            )
            : <Field label="Cible (optionnel)"><input className="input tabular" inputMode="decimal" value={f.target} onChange={(e) => setF({ ...f, target: e.target.value })} placeholder="80" /></Field>}
        </div>
        <div className="form-grid">
          {f.agg === 'percent_value' && <Field label="Cible (optionnel)"><input className="input tabular" inputMode="decimal" value={f.target} onChange={(e) => setF({ ...f, target: e.target.value })} placeholder="80" /></Field>}
          <Field label="Sens">
            <select className="select" value={f.direction} onChange={(e) => setF({ ...f, direction: e.target.value })}>
              <option value="higher_better">Plus haut = mieux</option>
              <option value="lower_better">Plus bas = mieux</option>
            </select>
          </Field>
        </div>

        <div className="note"><SlidersHorizontal size={18} aria-hidden="true" /><span>
          {f.agg === 'count' && <>Compte le nombre de réponses à la variable.</>}
          {f.agg === 'sum' && <>Additionne les valeurs numériques de la variable.</>}
          {f.agg === 'mean' && <>Moyenne des valeurs numériques de la variable.</>}
          {f.agg === 'percent_yes' && <>Part des réponses « oui » (oui/1/true) sur le total renseigné.</>}
          {f.agg === 'percent_value' && <>Part des réponses égales à <strong>{String(f.positiveValue).trim() || '…'}</strong> sur le total renseigné.</>}
        </span></div>
      </div>
    </Modal>
  );
}
