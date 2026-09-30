import React, { useEffect, useState } from 'react';
import { Plus, X, MapPin } from 'lucide-react';
import { api } from '../api/client.js';
import { Button } from './ui.jsx';

/**
 * Assigns geographic zones to the provider by picking nodes from the tenant's
 * admin breakdown (configured/imported in Paramétrage › Localités). Cascading
 * dropdowns (Région → District → …), no free text. `value` is a list of
 * { adminAreaId, path }.
 */
export default function AreasSelector({ value, onChange }) {
  const [levels, setLevels] = useState(null);
  const [options, setOptions] = useState([]);   // options[depthIndex] = areas[]
  const [picked, setPicked] = useState([]);     // picked[depthIndex] = { id, name, path }

  useEffect(() => {
    api.listAdminLevels().then(async (lv) => {
      setLevels(lv);
      if (lv.length) setOptions([await api.listAdminAreas({ depth: 1 })]);
    }).catch(() => setLevels([]));
  }, []);

  async function pick(depthIdx, areaId) {
    const opts = options[depthIdx] || [];
    const area = opts.find((a) => a.id === areaId) || null;
    const nextPicked = picked.slice(0, depthIdx);
    nextPicked[depthIdx] = area;
    setPicked(nextPicked);
    const nextOptions = options.slice(0, depthIdx + 1);
    if (area && depthIdx + 1 < (levels?.length || 0)) {
      const children = await api.listAdminAreas({ depth: depthIdx + 2, parentId: area.id });
      if (children.length) nextOptions[depthIdx + 1] = children;
    }
    setOptions(nextOptions);
  }

  function addZone() {
    const leaf = [...picked].reverse().find(Boolean);
    if (!leaf) return;
    if (value.some((v) => v.adminAreaId === leaf.id)) return;
    onChange([...value, { adminAreaId: leaf.id, path: leaf.path }]);
    setPicked([]);
    setOptions(options.length ? [options[0]] : []);
  }

  function remove(id) { onChange(value.filter((v) => v.adminAreaId !== id)); }

  if (levels === null) return <p className="muted" style={{ fontSize: 14 }}>Chargement du découpage…</p>;
  if (levels.length === 0) {
    return (
      <p className="muted" style={{ fontSize: 14 }}>
        Aucun découpage administratif n'est configuré. Importez-le dans <strong>Paramétrage › Localités</strong> (un fichier par pays).
      </p>
    );
  }

  const canAdd = picked.some(Boolean);

  return (
    <div className="areas-selector">
      <div className="areas-cascade">
        {levels.map((lv, i) => (
          <label key={lv.depth} className="field" style={{ minWidth: 180, flex: 1 }}>
            <span className="field-label">{lv.label}</span>
            <select
              className="select"
              value={picked[i]?.id || ''}
              disabled={i > 0 && !picked[i - 1]}
              onChange={(e) => pick(i, e.target.value)}
            >
              <option value="">{i === 0 ? 'Choisir…' : '(tous / non précisé)'}</option>
              {(options[i] || []).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </label>
        ))}
        <Button size="sm" variant="secondary" icon={Plus} onClick={addZone} disabled={!canAdd}>Ajouter la zone</Button>
      </div>

      {value.length > 0 ? (
        <div className="chips areas-chips" style={{ marginTop: 12 }}>
          {value.map((v) => (
            <span key={v.adminAreaId} className="chip is-static">
              <MapPin size={14} aria-hidden="true" /> {v.path}
              <button type="button" className="chip-x" onClick={() => remove(v.adminAreaId)} aria-label={`Retirer ${v.path}`}><X size={13} /></button>
            </span>
          ))}
        </div>
      ) : (
        <p className="muted" style={{ fontSize: 14, marginTop: 10 }}>Aucune zone affectée. Choisissez une zone puis « Ajouter la zone ».</p>
      )}
    </div>
  );
}
