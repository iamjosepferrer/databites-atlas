// map.js - all MapLibre logic

import { LEVELS, VARIABLE_MAP, DEFAULT_YEAR, COLOR_SCALES } from './config.js';

// tracks which levels are loaded
const loadedLevels = new Set();

// ── Shared value formatter ────────────────────────────────────
// Used by tooltip, click panel, and legend so formatting is always consistent.
function formatValue(val, varCfg) {
  if (val == null) return 'No data';
  if (varCfg.unit === 'EUR') return `€${Math.round(val).toLocaleString('es-ES')}`;
  if (varCfg.unit === 'PCT') return `${val.toFixed(varCfg.decimals)}%`;
  // Absolute number (population, counts, etc.) — force grouping so 4-digit
  // numbers like 1.671 always get the thousands separator.
  if (varCfg.decimals === 0) return Math.round(val).toLocaleString('es-ES', { useGrouping: true });
  return val.toLocaleString('es-ES', {
    minimumFractionDigits: varCfg.decimals,
    maximumFractionDigits: varCfg.decimals,
    useGrouping: true,
  });
}

export function initMap() {
  const map = new maplibregl.Map({
    container: 'map',
    style: `https://api.protomaps.com/styles/v4/black/en.json?key=94c1fe33310f3dfe`,
//  style: `https://api.protomaps.com/styles/v4/grayscale/en.json?key=94c1fe33310f3dfe`,
//  all styles: light, white, dark, black, grayscale
    center:    [1.7, 41.7],
    zoom:      7,
    minZoom:   5,
    maxZoom:   16,
  });
  return map;
}

export function addLevel(map, levelId, geo, data, varId, year = DEFAULT_YEAR, filterSteps = []) {
  const level  = LEVELS.find(l => l.id === levelId);
  const varCfg = VARIABLE_MAP[varId];

  const colored = joinAndColor(geo, data, level.idCol, varId, varCfg, year, filterSteps);

  if (map.getSource(levelId)) return;

  map.addSource(levelId, {
    type:      'geojson',
    data:      colored,
    promoteId: level.idCol,
  });

  map.addLayer({
    id:     `${levelId}-fill`,
    type:   'fill',
    source: levelId,
    paint:  {
      'fill-color':         ['coalesce', ['get', '_color'], '#1a1a2e'],
      'fill-opacity':       ['coalesce', ['get', '_opacity'], 0.65],
      'fill-outline-color': 'rgba(0,0,0,0)',
    },
  });

  if (levelId === 'tracts') {
    map.addLayer({
      id:     `${levelId}-line`,
      type:   'line',
      source: levelId,
      paint:  {
        'line-color':   '#ffffff',
        'line-width':   0.25,
        'line-opacity': 0.25,
      },
    });
  }

  map.addLayer({
    id:     `${levelId}-highlight`,
    type:   'line',
    source: levelId,
    paint:  {
      'line-color':   '#ffffff',
      'line-width':   2.5,
      'line-opacity': [
        'case',
        ['boolean', ['feature-state', 'hovered'], false],
        1,
        0
      ],
    },
  });

  loadedLevels.add(levelId);
}

export function recolorLevel(map, levelId, data, varId, year = DEFAULT_YEAR, filterSteps = []) {
  if (!loadedLevels.has(levelId)) return;

  const level  = LEVELS.find(l => l.id === levelId);
  const varCfg = VARIABLE_MAP[varId];
  const source = map.getSource(levelId);
  if (!source) return;

  const geo     = source._data;
  const colored = joinAndColor(geo, data, level.idCol, varId, varCfg, year, filterSteps);
  source.setData(colored);
}

function joinAndColor(geo, data, idCol, varId, varCfg, year, filterSteps = []) {
  const values = [];
  geo.features.forEach(f => {
    const id    = f.properties[idCol];
    const entry = data[id];
    const val   = entry?.[varId]?.[year];
    if (val != null) values.push(val);
  });

  if (values.length === 0) return geo;

  // Build colour domain thresholds:
  // - logScale variables (income, population): equal steps in log space so
  //   doubling always looks the same regardless of absolute value.
  // - everything else (PCT, ratios): quantile steps so dense bands get
  //   good visual separation.
  const n      = 5;
  const sorted = [...values].sort((a, b) => a - b);
  let thresholds = [];

  if (varCfg.logScale && sorted[0] > 0) {
    const logMin = Math.log(sorted[0]);
    const logMax = Math.log(sorted[sorted.length - 1]);
    for (let i = 0; i <= n; i++) {
      thresholds.push(Math.exp(logMin + (i / n) * (logMax - logMin)));
    }
  } else {
    for (let i = 0; i <= n; i++) {
      const idx = Math.floor((i / n) * (sorted.length - 1));
      thresholds.push(sorted[idx]);
    }
  }

  const uniqueT = [...new Set(thresholds)];
  const scale   = COLOR_SCALES[varCfg.colorScale];
  const colorFn = uniqueT.length > 1
    ? chroma.scale(scale).domain(uniqueT)
    : chroma.scale(scale).domain([sorted[0], sorted[sorted.length - 1]]);

  const features = geo.features.map(f => {
    const id    = f.properties[idCol];
    const entry = data[id];
    const val   = entry?.[varId]?.[year];

    let opacity = 0.65;
    if (filterSteps.length > 0) {
      if (val != null) {
        const inFilter = filterSteps.some(s => val >= s.min && val <= s.max);
        opacity = inFilter ? 0.65 : 0.12;
      } else {
        opacity = 0.12;
      }
    }

    return {
      ...f,
      properties: {
        ...f.properties,
        _value:   val ?? null,
        _color:   val != null ? colorFn(val).hex() : '#1a1a2e',
        _opacity: opacity,
      },
    };
  });

  return { ...geo, features };
}

export function setActiveLevel(map, levelId) {
  LEVELS.forEach(level => {
    if (!loadedLevels.has(level.id)) return;
    const visibility = level.id === levelId ? 'visible' : 'none';
    map.setLayoutProperty(`${level.id}-fill`, 'visibility', visibility);
    if (map.getLayer(`${level.id}-line`)) {
      map.setLayoutProperty(`${level.id}-line`, 'visibility', visibility);
    }
  });
}

export function setupZoomLevels(map, onZoom) {
  map.on('zoom', () => {
    const zoom = map.getZoom();
    const active = LEVELS.find(l => zoom >= l.minZoom && zoom < l.maxZoom);
    if (!active) return;
    onZoom(active.id);
  });
}

export function setupHover(map, getActiveLevel, getActiveVar) {
  const tooltip = document.getElementById('tooltip');
  let hoveredId    = null;
  let hoveredLevel = null;

  LEVELS.forEach(level => {

    map.on('mouseenter', `${level.id}-fill`, () => {
      map.getCanvas().style.cursor = 'pointer';
    });

    map.on('mouseleave', `${level.id}-fill`, () => {
      map.getCanvas().style.cursor = '';
      tooltip.style.display = 'none';
      if (hoveredId !== null && hoveredLevel) {
        map.setFeatureState(
          { source: hoveredLevel, id: hoveredId },
          { hovered: false }
        );
      }
      hoveredId    = null;
      hoveredLevel = null;
    });

    map.on('mousemove', `${level.id}-fill`, (e) => {
      if (!e.features?.length) return;

      const feature = e.features[0];
      const props   = feature.properties;
      const varId   = getActiveVar();
      const varCfg  = VARIABLE_MAP[varId];
      const value   = props._value;

      if (hoveredId !== null && hoveredLevel) {
        map.setFeatureState(
          { source: hoveredLevel, id: hoveredId },
          { hovered: false }
        );
      }
      hoveredId    = feature.id;
      hoveredLevel = level.id;
      if (hoveredId !== null) {
        map.setFeatureState(
          { source: level.id, id: hoveredId },
          { hovered: true }
        );
      }

      let name = '';
      if (level.id === 'provinces') {
        name = `${props.province_name || props.CPRO}`;
      } else if (level.id === 'municipalities') {
        name = `${props.NMUN || ''} <span class="tooltip-id">(${props.CUMUN || ''})</span>`;
      } else {
        name = `${props.NMUN || ''} <span class="tooltip-id">(${props.CUSEC || ''})</span>`;
      }

      const formatted = formatValue(value, varCfg);

      tooltip.style.display = 'block';
      tooltip.style.left    = `${e.point.x + 14}px`;
      tooltip.style.top     = `${e.point.y - 44}px`;
      tooltip.innerHTML     = `
        <div class="tooltip-name">${name}</div>
        <div class="tooltip-value">${formatted}</div>
        <div class="tooltip-label">${varCfg.label_en}</div>
      `;
    });
  });
}

export function setupClick(map, getActiveLevel, getAllData, getVarMap, getYear) {
  const panel    = document.getElementById('detail-panel');
  const titleEl  = document.getElementById('detail-title');
  const rowsEl   = document.getElementById('detail-rows');
  const closeBtn = document.getElementById('detail-close');

  function closePanel() {
    panel.style.display = 'none';
  }

  closeBtn.addEventListener('click', closePanel);

  LEVELS.forEach(level => {
    map.on('click', `${level.id}-fill`, (e) => {
      if (!e.features?.length) return;

      const props    = e.features[0].properties;
      const allData  = getAllData();
      const varMap   = getVarMap();
      const year     = getYear();
      const levelId  = level.id;
      const idCol    = level.idCol;
      const areaId   = props[idCol];
      const areaData = allData[levelId]?.[areaId];

      let nameLine = '';
      let codeLine = '';
      if (levelId === 'provinces') {
        nameLine = props.province_name || props.CPRO;
        codeLine = `Province ${props.CPRO}`;
      } else if (levelId === 'municipalities') {
        nameLine = props.NMUN || props.CUMUN;
        codeLine = `Municipality ${props.CUMUN}`;
      } else {
        nameLine = props.NMUN || '';
        codeLine = `Census tract ${props.CUSEC}`;
      }

      titleEl.innerHTML = `${nameLine}<span>${codeLine}</span>`;

      const levelLookup = allData[levelId] || {};

      rowsEl.innerHTML = '';
      Object.entries(varMap).forEach(([varId, varCfg]) => {
        const val = areaData?.[varId]?.[year];

        const allVals = Object.values(levelLookup)
          .map(d => d?.[varId]?.[year])
          .filter(v => v != null);
        const min = Math.min(...allVals);
        const max = Math.max(...allVals);
        const pct = allVals.length && val != null
          ? Math.round(((val - min) / (max - min)) * 100)
          : null;

        const formatted = formatValue(val, varCfg);

        const row = document.createElement('div');
        row.className = 'detail-row';
        row.innerHTML = `
          <div class="detail-row-header">
            <div class="detail-row-label">${varCfg.label_en}</div>
            <div class="detail-row-value">${formatted}</div>
          </div>
          ${pct != null ? `
          <div class="detail-bar-track">
            <div class="detail-bar-fill" style="width:${pct}%"></div>
          </div>
          <div class="detail-row-pct">Top ${100 - pct}% in Catalonia</div>
          ` : ''}
        `;
        rowsEl.appendChild(row);
      });

      panel.style.display = 'block';
      e.stopPropagation();
    });
  });

  map.on('click', (e) => {
    if (!e.defaultPrevented) closePanel();
  });
}

export function addRoadsOverlay(map, apiKey) {
  map.addSource('protomaps-roads', {
    type: 'vector',
    url: `https://api.protomaps.com/tiles/v4.json?key=${apiKey}`,
  });

  map.addLayer({
    id: 'roads-major-casing',
    type: 'line',
    source: 'protomaps-roads',
    'source-layer': 'roads',
    filter: ['in', ['get', 'kind'], ['literal', ['major_road', 'highway']]],
    paint: {
      'line-color': '#e8e0d0',
      'line-width': ['interpolate', ['linear'], ['zoom'], 6, 2.5, 12, 6, 16, 12],
      'line-opacity': 0.5,
    },
  });

  map.addLayer({
    id: 'roads-major',
    type: 'line',
    source: 'protomaps-roads',
    'source-layer': 'roads',
    filter: ['in', ['get', 'kind'], ['literal', ['major_road', 'highway']]],
    paint: {
      'line-color': '#111111',
      'line-width': ['interpolate', ['linear'], ['zoom'], 6, 1, 12, 3, 16, 7],
      'line-opacity': 0.5,
    },
  });

  map.addLayer({
    id: 'roads-secondary-casing',
    type: 'line',
    source: 'protomaps-roads',
    'source-layer': 'roads',
    filter: ['in', ['get', 'kind'], ['literal', ['medium_road', 'minor_road']]],
    paint: {
      'line-color': '#111111',
      'line-width': ['interpolate', ['linear'], ['zoom'], 8, 1.5, 12, 3, 16, 7],
      'line-opacity': 0.5,
    },
  });

  map.addLayer({
    id: 'roads-secondary',
    type: 'line',
    source: 'protomaps-roads',
    'source-layer': 'roads',
    filter: ['in', ['get', 'kind'], ['literal', ['medium_road', 'minor_road']]],
    paint: {
      'line-color': '#d4ccc0',
      'line-width': ['interpolate', ['linear'], ['zoom'], 8, 0.5, 12, 1.5, 16, 4],
      'line-opacity': 0.5,
    },
  });

  map.addLayer({
    id: 'buildings-overlay',
    type: 'fill',
    source: 'protomaps-roads',
    'source-layer': 'buildings',
    minzoom: 14,
    paint: {
      'fill-color': '#ffffff',
      'fill-opacity': ['interpolate', ['linear'], ['zoom'], 14, 0.0, 15, 0.08, 16, 0.15],
    },
  });

  map.addLayer({
    id: 'buildings-outline',
    type: 'line',
    source: 'protomaps-roads',
    'source-layer': 'buildings',
    minzoom: 14,
    paint: {
      'line-color': '#ffffff',
      'line-width': 0.5,
      'line-opacity': ['interpolate', ['linear'], ['zoom'], 14, 0.0, 15, 0.5, 16, 0.9],
    },
  });
}

export function raiseOverlays(map) {
  const overlays = [
    'roads-major-casing', 'roads-major',
    'roads-secondary-casing', 'roads-secondary',
    'buildings-overlay', 'buildings-outline',
    'provinces-highlight', 'municipalities-highlight', 'tracts-highlight',
  ];
  overlays.forEach(id => {
    if (map.getLayer(id)) map.moveLayer(id);
  });
}