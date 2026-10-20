import React, { useEffect, useMemo, useState } from 'react';
import { Sparkles, CheckCircle2, SlidersHorizontal, Plus, Layers } from 'lucide-react';
import { api } from '../../api/client.js';
import Modal from '../../components/Modal.jsx';
import { Button, Skeleton } from '../../components/ui.jsx';
import { useToast } from '../../components/Toast.jsx';
import { useI18n } from '../../lib/i18n.jsx';
import { formatInt } from '../../lib/format.js';
import { AGG_LABEL, coveragePct } from '../../lib/templateProposal.js';

/**
 * État vide d'une fiche SANS indicateur (retour 85) : dit exactement quoi faire.
 * Le modèle proposé pour la fiche (celui de son activité, sinon celui qui couvre
 * le mieux ses variables) et « Créer les N indicateurs proposés » d'un clic,
 * après un aperçu de ce qui sera créé. Même règle que la case cochée d'office de
 * la carte du modèle (Configuration) : variable trouvée, type et liste vérifiés,
 * hors sous-table. Sans modèle : créer les indicateurs un par un.
 */
export default function TemplateProposalCta({ form, canEdit, onCreated, onGoConfig, onCreateOne }) {
  const { tr } = useI18n();
  const [data, setData] = useState(undefined); // undefined = en cours, null = indisponible
  const [preview, setPreview] = useState(false);
  useEffect(() => {
    let alive = true;
    setData(undefined);
    api.monTemplate(form.id).then((r) => { if (alive) setData(r); }).catch(() => { if (alive) setData(null); });
    return () => { alive = false; };
  }, [form.id]);

  if (data === undefined) return <Skeleton height={40} />;
  const tpl = data && data.template;
  const n = (data && data.summary && data.summary.proposed) || 0;
  if (!tpl || n === 0) {
    return (
      <div className="tplp-cta">
        <p>{tpl
          ? tr('Le modèle « {label} » ne trouve aucune variable sûre dans cette fiche pour l\'instant : vérifiez-les dans Configuration, ou créez les indicateurs un par un.', { label: tpl.label })
          : tr('Aucun modèle d\'indicateurs ne correspond aux variables de cette fiche : créez les indicateurs un par un (variable + méthode de calcul).')}</p>
        <div className="tplp-actions">
          {canEdit && onCreateOne && <Button icon={Plus} onClick={onCreateOne}>{tr('Nouvel indicateur')}</Button>}
          {onGoConfig && <Button variant="secondary" icon={SlidersHorizontal} onClick={onGoConfig}>{tr('Ouvrir la configuration')}</Button>}
        </div>
      </div>
    );
  }
  const coverage = data.source === 'activity' ? null : coveragePct(data.proposal?.best?.coverage);
  return (
    <div className="tplp-cta">
      <p>
        {data.source === 'activity'
          ? tr('Le modèle de l\'activité « {label} » propose {n} indicateur(s) dont la variable a été trouvée et vérifiée dans cette fiche.', { label: tpl.label, n: formatInt(n) })
          : tr('Le modèle « {label} » correspond à cette fiche ({p} % de ses éléments y sont trouvés) : il propose {n} indicateur(s) dont la variable a été vérifiée.', { label: tpl.label, p: coverage, n: formatInt(n) })}
        {data.summary.subtable > 0 && <> {tr('{n} autre(s) attendent l\'import des sous-tables.', { n: formatInt(data.summary.subtable) })}</>}
      </p>
      <div className="tplp-actions">
        {canEdit && <Button icon={Sparkles} onClick={() => setPreview(true)}>{tr('Créer les {n} indicateurs proposés', { n: formatInt(n) })}</Button>}
        {onGoConfig && <Button variant="secondary" icon={SlidersHorizontal} onClick={onGoConfig}>{tr('Vérifier un par un (Configuration)')}</Button>}
      </div>
      {preview && <ProposalDialog form={form} data={data} onClose={() => setPreview(false)}
        onCreated={(r) => { setPreview(false); onCreated?.(r); }} />}
    </div>
  );
}

/** Aperçu de ce qui sera créé, domaine par domaine, puis création d'un clic. */
function ProposalDialog({ form, data, onClose, onCreated }) {
  const { tr } = useI18n();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const tpl = data.template;
  const groups = useMemo(() => {
    const out = [];
    for (const it of tpl.items) {
      if (!it.suggestion?.preselect || it.existing || it.taken) continue;
      const last = out[out.length - 1];
      if (last && last.module === it.module) last.items.push(it); else out.push({ module: it.module, items: [it] });
    }
    return out;
  }, [tpl]);
  const n = groups.reduce((a, g) => a + g.items.length, 0);
  const scored = groups.reduce((a, g) => a + g.items.filter((i) => i.scored).length, 0);
  async function create() {
    setBusy(true);
    try {
      const r = await api.monApplyProposed(form.id, { template: data.source === 'activity' ? null : tpl.key });
      toast.success(tr('{n} indicateur(s) créé(s) depuis le modèle « {label} ».', { n: formatInt(r.applied), label: tpl.label }));
      onCreated(r);
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  }
  return (
    <Modal open wide onClose={onClose} title={tr('Créer les {n} indicateurs proposés', { n: formatInt(n) })} subtitle={tr('Modèle « {label} » · {form}', { label: tpl.label, form: form.label })}
      footer={<><Button variant="secondary" onClick={onClose}>{tr('Annuler')}</Button>
        <Button icon={CheckCircle2} loading={busy} disabled={!n} onClick={create}>{tr('Créer les {n} indicateurs', { n: formatInt(n) })}</Button></>}>
      <p className="hint" style={{ marginTop: 0 }}>
        {tr('{n} indicateur(s), dont {s} compté(s) dans l\'indice de conformité. Rien d\'autre n\'est modifié ; chaque indicateur reste modifiable ensuite.', { n: formatInt(n), s: formatInt(scored) })}
        {data.summary.subtable > 0 && <> <Layers size={13} aria-hidden="true" style={{ verticalAlign: '-2px' }} /> {tr('Non créés : {n} en sous-table (disponibles après import des sous-tables).', { n: formatInt(data.summary.subtable) })}</>}
        {(data.summary.toCheck + data.summary.missing + data.summary.pendingData) > 0 && <> {tr('{n} à vérifier dans Configuration (variable absente, à confirmer ou attendue avec les données).', { n: formatInt(data.summary.toCheck + data.summary.missing + data.summary.pendingData) })}</>}
      </p>
      <div className="tplp-preview">
        {groups.map((g) => (
          <section key={g.module}>
            <h4>{g.module} <span className="muted">· {formatInt(g.items.length)}</span></h4>
            <ul>
              {g.items.map((it) => (
                <li key={it.code}>
                  <span className="tplp-label">{it.label}</span>
                  <span className="mono muted">{it.suggestion.field}</span>
                  <span className="muted">{tr(AGG_LABEL[it.agg] || it.agg)}{it.suggestion.positiveValue && it.agg !== 'mean' ? ` = ${it.suggestion.positiveValue}` : ''}{it.target != null ? ` · ${tr('cible {v}', { v: it.target })}` : ''}</span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </Modal>
  );
}
