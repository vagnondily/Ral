import React, { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { useI18n } from '../lib/i18n.jsx';
import { periodLabel } from '../lib/period.js';

/**
 * Liste de choix d'un TPM selon la règle commune (retours 30 et 58,
 * server/src/modules/tpm/activeProvider.js selectableProviders) : d'abord les TPM d'un contrat de
 * suivi qui couvre la période (« Actifs selon contrat »), puis les autres TPM actifs, à part (les
 * choisir reste possible : c'est un choix hors contrat). Utilisée par les formations et les
 * rapports attendus. Une erreur de chargement est DITE dans la liste (jamais une liste vide muette).
 *
 *   period   { from, to } (« AAAA-MM ») — les mois à couvrir ; défaut : mois courant
 *   value / onChange(id, provider)
 */
export default function ProviderSelect({ period, value, onChange, id, placeholder, className = 'select', disabled, ariaLabel }) {
  const { tr, lang } = useI18n();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const from = period && period.from; const to = period && period.to;
  useEffect(() => {
    let alive = true;
    api.selectableProviders(from && to ? { from, to } : null)
      .then((d) => { if (alive) { setData(d); setError(null); } })
      .catch((e) => { if (alive) { setData({ groups: [] }); setError(e.message || String(e)); } });
    return () => { alive = false; };
  }, [from, to]); // eslint-disable-line react-hooks/exhaustive-deps

  const groups = (data && data.groups) || [];
  const all = groups.flatMap((g) => g.providers);
  const label = from && to ? periodLabel({ from, to }, lang) : null;
  return (
    <select id={id} className={`${className} ${value ? '' : 'is-empty'}`} value={value || ''} disabled={disabled || !data || Boolean(error)}
      aria-label={ariaLabel} aria-invalid={error ? true : undefined} title={error ? tr('Liste des TPM indisponible : {e}', { e: error }) : undefined}
      onChange={(e) => onChange(e.target.value, all.find((p) => p.id === e.target.value) || null)}>
      <option value="">{error ? tr('Liste des TPM indisponible : {e}', { e: error }) : (placeholder || tr('Choisir…'))}</option>
      {groups.map((g) => (g.providers.length ? (
        <optgroup key={g.key} label={g.key === 'contrat'
          ? (label ? tr('Actifs selon contrat ({period})', { period: label }) : tr('Actifs selon contrat'))
          : tr('Autres TPM (hors contrat)')}>
          {g.providers.map((p) => (
            <option key={p.id} value={p.id}>{p.name}{g.key === 'contrat' && p.contracts.length ? ` · ${p.contracts.map((c) => c.numeroFla || c.numero).join(', ')}` : ''}</option>
          ))}
        </optgroup>
      ) : null))}
    </select>
  );
}
