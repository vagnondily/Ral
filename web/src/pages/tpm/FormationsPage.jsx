import React, { useEffect, useMemo, useState } from 'react';
import { GraduationCap, Plus, ChevronRight } from 'lucide-react';
import { api } from '../../api/client.js';
import { Button, PageHeader, Stats, StatusBadge } from '../../components/ui.jsx';
import DataList from '../../components/DataList.jsx';
import { useToast } from '../../components/Toast.jsx';
import { formatDate } from '../../lib/contracts.js';
import { formatInt } from '../../lib/format.js';
import { TRAINING_STATUS, formatPct } from '../../lib/trainings.js';
import { useI18n } from '../../lib/i18n.jsx';

/**
 * Formations (lot 8, retour 28.2) : la LISTE des sessions — dates, titre et thèmes, lieu,
 * participants et prestataires, présence, progression pré → post-test, réussite, statut.
 * Ouvrir une formation mène à sa fiche (#/tpm/formations/<id>) : informations, thèmes,
 * prestataires et agents participants, résultats et évaluation de la formation.
 */
export default function FormationsPage({ canEdit, onNavigate }) {
  const { tr } = useI18n();
  const toast = useToast();
  const [rows, setRows] = useState(null);

  useEffect(() => {
    api.listTrainings().then(setRows).catch((e) => { toast.error(e.message); setRows([]); });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const open = (s) => onNavigate('tpm', 'formations', s.id);
  const stats = useMemo(() => {
    if (!rows) return null;
    const done = rows.filter((s) => s.status === 'realisee');
    return {
      sessions: rows.length, done: done.length,
      participants: rows.reduce((n, s) => n + s.participants, 0),
      providers: new Set(rows.flatMap((s) => s.providers.map((p) => p.id))).size,
    };
  }, [rows]);
  const providerOptions = useMemo(() => {
    const m = new Map();
    for (const s of rows || []) for (const p of s.providers) m.set(p.id, p.name);
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1])).map(([id, label]) => ({ id, label }));
  }, [rows]);
  const themeOptions = useMemo(() => {
    const m = new Map();
    for (const s of rows || []) for (const th of s.themes) m.set(th.id, th.label);
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1])).map(([id, label]) => ({ id, label }));
  }, [rows]);
  // « 08/09 – 10/09/2026 » dans une même année, sinon les deux dates complètes.
  const dates = (s) => {
    if (s.startDate === s.endDate) return formatDate(s.startDate);
    return s.startDate.slice(0, 4) === s.endDate.slice(0, 4)
      ? `${formatDate(s.startDate).slice(0, 5)} – ${formatDate(s.endDate)}` : `${formatDate(s.startDate)} – ${formatDate(s.endDate)}`;
  };
  // Thèmes affichés sous le titre, sauf quand ils le répètent (formations reprises de l'historique).
  const themeLine = (s) => s.themes.map((th) => th.label).filter((l) => l.toLowerCase() !== s.title.toLowerCase()).join(' · ');

  return (
    <div className="section-gap">
      <PageHeader title={tr('Formations')}
        description={tr('Les sessions de formation des agents TPM : thèmes couverts, prestataires et agents participants, présence, résultats des tests et avis des participants.')}>
        {canEdit && <Button icon={Plus} onClick={() => onNavigate('tpm', 'formations', 'nouvelle')}>{tr('Nouvelle formation')}</Button>}
      </PageHeader>

      <Stats items={[
        { label: tr('Formations'), value: stats ? stats.sessions : '—', foot: stats ? tr('{n} réalisée(s)', { n: stats.done }) : null },
        { label: tr('Participations'), value: stats ? formatInt(stats.participants) : '—', foot: tr('Agents inscrits, toutes formations') },
        { label: tr('Prestataires formés'), value: stats ? stats.providers : '—', foot: tr('Au moins un agent participant') },
      ]} />

      <DataList
        rows={rows}
        columns={{
          dates: { label: tr('Dates'), sortVal: (s) => s.startDate, csv: (s) => dates(s), render: (s) => <span className="tabular pv-nowrap">{dates(s)}</span> },
          title: { label: tr('Formation'), sortVal: (s) => s.title.toLowerCase(), csv: (s) => s.title,
            render: (s) => (
              <button type="button" className="pv-name-link pv-left tr-title" onClick={() => open(s)}>
                <span><strong>{s.title}</strong>
                  {themeLine(s) && <span className="pv-sub">{themeLine(s)}</span>}</span>
              </button>
            ) },
          place: { label: tr('Lieu'), sortVal: (s) => s.place || '', csv: (s) => s.place || '', render: (s) => s.place || <span className="cell-empty">—</span> },
          participants: { label: tr('Participants'), num: true, sortVal: (s) => s.participants, csv: (s) => s.participants, render: (s) => s.participants },
          providers: { label: tr('Prestataires'), sortVal: (s) => s.providers.length, csv: (s) => s.providers.map((p) => p.name).join(', '),
            render: (s) => (s.providers.length ? <span className="pv-providers">{s.providers.map((p) => p.name).join(', ')}</span> : <span className="cell-empty">—</span>) },
          attendance: { label: tr('Présence'), num: true, sortVal: (s) => (s.attendanceRate == null ? -1 : s.attendanceRate), csv: (s) => s.attendanceRate ?? '',
            render: (s) => formatPct(s.attendanceRate, tr) },
          tests: { label: tr('Pré → post'), sortVal: (s) => (s.avgPost == null ? -1 : s.avgPost), csv: (s) => `${s.avgPre ?? ''} → ${s.avgPost ?? ''}`,
            render: (s) => (s.avgPost == null && s.avgPre == null ? <span className="cell-empty">{tr('— pas de test')}</span>
              : <span className="tabular pv-nowrap">{formatPct(s.avgPre, tr)} → <strong>{formatPct(s.avgPost, tr)}</strong></span>) },
          pass: { label: tr('Réussite'), num: true, sortVal: (s) => (s.passRate == null ? -1 : s.passRate), csv: (s) => s.passRate ?? '', render: (s) => formatPct(s.passRate, tr) },
          status: { label: tr('Statut'), sortVal: (s) => s.status, csv: (s) => tr(TRAINING_STATUS[s.status].label), render: (s) => <StatusBadge map={TRAINING_STATUS} value={s.status} /> },
          action: { label: '', width: 96, csv: () => '', render: (s) => <Button size="sm" variant="secondary" onClick={() => open(s)}>{tr('Ouvrir')} <ChevronRight size={14} aria-hidden="true" /></Button> },
        }}
        defaultColumns={['dates', 'title', 'participants', 'providers', 'attendance', 'tests', 'status']}
        filters={{
          q: { label: tr('Recherche'), type: 'search', placeholder: tr('Formation, thème, prestataire…'),
            match: (s, v) => [s.title, s.place, ...s.themes.map((x) => x.label), ...s.providers.map((x) => x.name)].some((x) => x && String(x).toLowerCase().includes(v.toLowerCase())) },
          period: { label: tr('Période'), type: 'period', start: (s) => s.startDate, end: (s) => s.endDate },
          provider: { label: tr('Prestataire'), type: 'select', options: [{ id: '', label: tr('Tous les prestataires') }, ...providerOptions], match: (s, v) => s.providers.some((p) => p.id === v) },
          theme: { label: tr('Thème'), type: 'select', options: [{ id: '', label: tr('Tous les thèmes') }, ...themeOptions], match: (s, v) => s.themes.some((x) => x.id === v) },
          status: { label: tr('Statut'), type: 'select', options: [{ id: '', label: tr('Tous les statuts') }, ...Object.entries(TRAINING_STATUS).map(([id, d]) => ({ id, label: tr(d.label) }))], match: (s, v) => s.status === v },
        }}
        defaultFilters={['q', 'period', 'provider']}
        storageKey="mems.trainings.v2" defaultSort={{ key: 'dates', dir: 'desc' }}
        onRowDoubleClick={open}
        csvName="formations.csv" emptyIcon={GraduationCap} emptyTitle={tr('Aucune formation')}
        emptyAction={canEdit && <Button icon={Plus} onClick={() => onNavigate('tpm', 'formations', 'nouvelle')}>{tr('Nouvelle formation')}</Button>}
        emptyChildren={tr('Enregistrez une session de formation, ses thèmes et ses participants.')}
      />
    </div>
  );
}
