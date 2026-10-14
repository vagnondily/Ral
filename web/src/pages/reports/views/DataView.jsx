import React from 'react';
import { DataTable, HeatTable } from './DataTable.jsx';
import BarChart from './BarChart.jsx';
import ColumnChart from './ColumnChart.jsx';
import LineChart from './LineChart.jsx';
import DonutChart from './DonutChart.jsx';
import StackedBar from './StackedBar.jsx';
import KpiStrip from './KpiStrip.jsx';
import IndicatorCard from './IndicatorCard.jsx';
import ExplainView from './ExplainView.jsx';
import ListView from './ListView.jsx';

/** Vues graphiques : un tableau des mêmes données est proposé (« Voir les données »). */
export const CHART_VIEWS = new Set(['bar', 'column', 'line', 'donut', 'stacked']);

/** Corps d'un bloc « données » selon sa vue (repli sur le tableau pour une vue inconnue). */
export default function DataView({ view, def, data, params, title }) {
  const p = params || {};
  switch (view) {
    case 'bar': return <BarChart def={def} data={data} measure={p.measure} title={title} />;
    case 'column': return <ColumnChart def={def} data={data} measure={p.measure} title={title} />;
    case 'line': return <LineChart def={def} data={data} measure={p.measure} title={title} />;
    case 'donut': return <DonutChart def={def} data={data} measure={p.measure} title={title} />;
    case 'stacked': return <StackedBar def={def} data={data} />;
    case 'heat': return <HeatTable data={data} columns={p.columns} />;
    case 'kpi': case 'gauge': return <KpiStrip data={data} columns={p.columns} />;
    case 'card': return <IndicatorCard data={data} />;
    case 'explain': return <ExplainView data={data} />;
    case 'list': return <ListView data={data} columns={p.columns} />;
    default: return <DataTable data={data} columns={p.columns} annotate={def && def.annotate} annotations={p.annotations} />;
  }
}
