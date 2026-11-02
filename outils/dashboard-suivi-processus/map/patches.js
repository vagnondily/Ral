'use strict';
// Lot « map » : l'onglet Carte est entièrement réécrit dans map/module.js (mapRender).
// Zone : geoNorm / project / renderMap (socle l. 1199-1265). geoNorm et project restent définis (mêmes formules).
module.exports = [
  { label: 'carte : renderMap délègue à mapRender (zoom automatique, synthèse, détail au clic, couches du plan)',
    start: "  const geoNorm = s => s.toLowerCase().normalize('NFD').replace(/[^a-z]/g, '');",
    end: "Fond de carte : limites régionales simplifiées (Highcharts Map Collection, CC BY).' })]));\n    main.appendChild(g);\n  }",
    replace: "  const geoNorm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[^a-z]/g, '');\n" +
      "  function project(lon, lat) { return [(lon - 42.9) * 0.945, (-11.6 - lat) * 1.0]; }\n" +
      "  function renderMap(main) { mapRender(main); }" },
];
