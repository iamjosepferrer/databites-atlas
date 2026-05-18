// main.js - entry point, wires everything together

import { LEVELS, VARIABLES, DEFAULT_VARIABLE, VARIABLE_MAP, DEFAULT_YEAR, COLOR_SCALES } from './config.js';
import { initMap, addLevel, recolorLevel, setActiveLevel, setupHover, setupClick, addRoadsOverlay, raiseOverlays } from './map.js';

// app state
let activeVar     = DEFAULT_VARIABLE;
let activeLevel   = 'provinces';
let activeYear    = DEFAULT_YEAR;
let activeFilters = new Set(); // indices of active legend steps
let legendSteps   = [];
let geoCache      = {};
let dataCache     = {};

const CITIES = [
  { name: 'Barcelona', center: [2.1734, 41.3851], zoom: 12 },
  { name: 'Girona',    center: [2.8214, 41.9794], zoom: 12 },
  { name: 'Lleida',    center: [0.6200, 41.6148], zoom: 12 },
  { name: 'Tarragona', center: [1.2445, 41.1189], zoom: 12 },
  { name: 'Manresa',   center: [1.8264, 41.7285], zoom: 12 },
  { name: 'Sabadell',  center: [2.1078, 41.5433], zoom: 12 },
];

async function loadGeo(levelId) {
  if (geoCache[levelId]) return geoCache[levelId];
  const res  = await fetch(`geo/${levelId}.geojson`);
  const json = await res.json();
  geoCache[levelId] = json;
  window._geoCache  = geoCache;
  return json;
}

async function loadData(levelId) {
  if (dataCache[levelId]) return dataCache[levelId];
  const res  = await fetch(`data/${levelId}.json`);
  const json = await res.json();
  dataCache[levelId] = json;
  return json;
}

async function detectYearRange() {
  const data = await loadData('municipalities');
  const firstEntry = Object.values(data)[0];
  const years = Object.keys(firstEntry?.['net_income_pc'] || {})
    .map(Number)
    .sort((a, b) => a - b);
  return { min: years[0], max: years[years.length - 1] };
}

// ── Filter helpers ───────────────────────────────────────────
function getActiveFilterSteps() {
  if (activeFilters.size === 0) return [];
  return legendSteps.filter(s => activeFilters.has(s.index));
}

function recolorAll(map) {
  const filterSteps = getActiveFilterSteps();
  Object.keys(dataCache).forEach(levelId => {
    recolorLevel(map, levelId, dataCache[levelId], activeVar, activeYear, filterSteps);
  });
}

// ── Legend ───────────────────────────────────────────────────
function computeLegendSteps(data, varId, year, varCfg, n = 5) {
  const values = Object.values(data)
    .map(d => d?.[varId]?.[year])
    .filter(v => v != null)
    .sort((a, b) => a - b);

  if (values.length === 0) return [];

  const scale   = COLOR_SCALES[varCfg.colorScale];
  const colorFn = chroma.scale(scale).domain([0, n - 1]);
  const steps   = [];

  for (let i = 0; i < n; i++) {
    const loIdx = Math.floor((i / n) * values.length);
    const hiIdx = Math.min(Math.floor(((i + 1) / n) * values.length) - 1, values.length - 1);
    steps.push({
      min:   values[loIdx],
      max:   values[hiIdx],
      color: colorFn(i).hex(),
      index: i,
    });
  }
  return steps;
}

function formatLegendVal(val, varCfg) {
  if (varCfg.unit === 'EUR') return `€${Math.round(val).toLocaleString('es-ES')}`;
  if (varCfg.unit === 'PCT') return `${val.toFixed(varCfg.decimals)}%`;
  return val.toFixed(varCfg.decimals);
}

function updateLegend(map) {
  const container = document.getElementById('legend');
  if (!container) return;

  const munData = dataCache['municipalities'];
  if (!munData) { container.style.display = 'none'; return; }

  const varCfg = VARIABLE_MAP[activeVar];
  legendSteps  = computeLegendSteps(munData, activeVar, activeYear, varCfg);

  if (legendSteps.length === 0) { container.style.display = 'none'; return; }

  container.style.display = 'flex';
  container.innerHTML = `
    <div class="legend-label">${varCfg.label_en} · ${activeYear}</div>
    <div class="legend-steps">
      ${legendSteps.map(s => `
        <button class="legend-step ${activeFilters.has(s.index) ? 'active' : ''}" data-index="${s.index}">
          <div class="legend-swatch" style="background:${s.color}"></div>
          <div class="legend-range">${formatLegendVal(s.min, varCfg)}<br>${formatLegendVal(s.max, varCfg)}</div>
        </button>
      `).join('')}
    </div>
    ${activeFilters.size > 0 ? '<button class="legend-reset">Reset filter</button>' : ''}
  `;

  container.querySelectorAll('.legend-step').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = Number(btn.dataset.index);
      if (activeFilters.has(idx)) {
        activeFilters.delete(idx);
      } else {
        activeFilters.add(idx);
      }
      updateLegend(map);
      recolorAll(map);
    });
  });

  const resetBtn = container.querySelector('.legend-reset');
  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      activeFilters.clear();
      updateLegend(map);
      recolorAll(map);
    });
  }
}

// ── Minimap ────────────────────────────────────────────────
const CATALONIA_BOUNDS = [[0.15, 40.52], [3.34, 42.86]];

function initMinimap(mainMap) {
  const CAT_BOUNDS = [[0.15, 40.52], [3.34, 42.86]];

  const minimap = new maplibregl.Map({
    container:          'minimap',
    style: {
      version: 8,
      sources: {},
      layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#0d1117' } }],
    },
    bounds:             CAT_BOUNDS,
    fitBoundsOptions:   { padding: 10 },
    interactive:        false,
    attributionControl: false,
  });

  function getClampedViewport() {
    const b = mainMap.getBounds();
    const minLng = Math.max(b.getWest(),  CAT_BOUNDS[0][0]);
    const minLat = Math.max(b.getSouth(), CAT_BOUNDS[0][1]);
    const maxLng = Math.min(b.getEast(),  CAT_BOUNDS[1][0]);
    const maxLat = Math.min(b.getNorth(), CAT_BOUNDS[1][1]);
    const valid  = minLng < maxLng && minLat < maxLat;
    return {
      type: 'Feature',
      geometry: {
        type: 'Polygon',
        coordinates: [valid ? [
          [minLng, minLat], [maxLng, minLat],
          [maxLng, maxLat], [minLng, maxLat],
          [minLng, minLat],
        ] : []],
      },
    };
  }

  minimap.on('load', async () => {
    const res = await fetch('geo/catalonia.geojson');
    const geo = await res.json();

    minimap.addSource('catalonia', { type: 'geojson', data: geo });
    minimap.addLayer({ id: 'catalonia-fill', type: 'fill', source: 'catalonia', paint: { 'fill-color': '#1c2a1e', 'fill-opacity': 1 } });
    minimap.addLayer({ id: 'catalonia-border', type: 'line', source: 'catalonia', paint: { 'line-color': '#4a7c59', 'line-width': 1 } });

    minimap.addSource('viewport', { type: 'geojson', data: getClampedViewport() });
    minimap.addLayer({ id: 'viewport-fill', type: 'fill', source: 'viewport', paint: { 'fill-color': '#ffffff', 'fill-opacity': 0.1 } });
    minimap.addLayer({ id: 'viewport-border', type: 'line', source: 'viewport', paint: { 'line-color': '#ffffff', 'line-width': 1.5 } });

    const update = () => {
      const src = minimap.getSource('viewport');
      if (src) src.setData(getClampedViewport());
    };
    mainMap.on('move', update);
    mainMap.on('zoom', update);
    update();
  });

  minimap.on('click', (e) => {
    mainMap.flyTo({ center: e.lngLat, zoom: mainMap.getZoom() });
  });
}

// ── Jump to ─────────────────────────────────────────────────
function buildJumpTo(map) {
  const container = document.getElementById('jumpto-list');
  if (!container) return;

  CITIES.forEach(city => {
    const btn = document.createElement('button');
    btn.className   = 'jumpto-btn';
    btn.textContent = city.name;
    btn.addEventListener('click', () => {
      map.flyTo({ center: city.center, zoom: city.zoom, duration: 1000 });
    });
    container.appendChild(btn);
  });
}

// ── Level switcher ───────────────────────────────────────────
function buildLevelSwitcher(map) {
  const container = document.getElementById('level-list');
  if (!container) return;

  LEVELS.forEach(level => {
    const btn = document.createElement('button');
    btn.className   = 'level-btn';
    btn.textContent = level.label_en;
    btn.dataset.id  = level.id;
    if (level.id === activeLevel) btn.classList.add('active');

    btn.addEventListener('click', async () => {
      if (!dataCache[level.id]) {
        const geo  = await loadGeo(level.id);
        const data = await loadData(level.id);
        addLevel(map, level.id, geo, data, activeVar, activeYear, getActiveFilterSteps());
        raiseOverlays(map);
      }
      activeLevel = level.id;
      setActiveLevel(map, level.id);
      document.querySelectorAll('.level-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      const targetZoom = level.id === 'provinces' ? 7 : level.id === 'municipalities' ? 9 : 12;
      if (Math.abs(map.getZoom() - targetZoom) > 1) {
        map.flyTo({ zoom: targetZoom, duration: 800 });
      }
    });

    container.appendChild(btn);
  });
}

// ── Year slider ──────────────────────────────────────────────
async function buildYearSlider(map) {
  const container = document.getElementById('year-slider-wrap');
  if (!container) return;

  const { min, max } = await detectYearRange();

  container.innerHTML = `
    <div class="year-slider-header">
      <span class="year-slider-title">Year</span>
      <span id="year-label">${activeYear}</span>
    </div>
    <input type="range" id="year-slider" min="${min}" max="${max}" value="${activeYear}" step="1" />
    <div class="year-range-labels">
      <span>${min}</span>
      <span>${max}</span>
    </div>
  `;

  document.getElementById('year-slider').addEventListener('input', (e) => {
    activeYear = Number(e.target.value);
    document.getElementById('year-label').textContent = activeYear;
    updateLegend(map);
    recolorAll(map);
    updateFeatured(map);
  });
}

// ── Featured top/bottom ──────────────────────────────────────
function updateFeatured(map) {
  const container = document.getElementById('featured-list');
  if (!container) return;

  const munData = dataCache['municipalities'];
  const munGeo  = geoCache['municipalities'];

  if (!munData || !munGeo) {
    container.innerHTML = '<div class="featured-loading">Loading...</div>';
    return;
  }

  const varCfg = VARIABLE_MAP[activeVar];

  const nameLookup = {};
  munGeo.features.forEach(f => {
    nameLookup[f.properties.CUMUN] = f.properties.NMUN || f.properties.CUMUN;
  });

  const entries = Object.entries(munData)
    .map(([id, d]) => ({ id, val: d?.[activeVar]?.[activeYear] }))
    .filter(e => e.val != null)
    .sort((a, b) => b.val - a.val);

  const top3 = entries.slice(0, 3);
  const bot3 = entries.slice(-3).reverse();

  function formatVal(val) {
    return varCfg.unit === 'EUR' ? `€${Math.round(val).toLocaleString('es-ES')}`
      : varCfg.unit === 'PCT' ? `${val.toFixed(varCfg.decimals)}%`
      : val.toFixed(varCfg.decimals);
  }

  function makeItem(entry, rankNum) {
    const div = document.createElement('div');
    div.className = 'featured-item';
    div.innerHTML = `
      <div class="featured-rank">${rankNum}</div>
      <div class="featured-name">${nameLookup[entry.id] || entry.id}</div>
      <div class="featured-value">${formatVal(entry.val)}</div>
    `;
    div.addEventListener('click', () => {
      const feature = munGeo.features.find(f => f.properties.CUMUN === entry.id);
      if (!feature) return;
      const coords = feature.geometry.type === 'Polygon'
        ? feature.geometry.coordinates[0]
        : feature.geometry.coordinates.flat(2);
      const lngs = coords.map(c => c[0]);
      const lats = coords.map(c => c[1]);
      map.fitBounds(
        [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]],
        { padding: 80, duration: 1000 }
      );
    });
    return div;
  }

  container.innerHTML = '';

  const topCol = document.createElement('div');
  const topHeader = document.createElement('div');
  topHeader.className = 'featured-col-header top';
  topHeader.textContent = 'Top 3';
  topCol.appendChild(topHeader);
  top3.forEach((e, i) => topCol.appendChild(makeItem(e, i + 1)));

  const botCol = document.createElement('div');
  const botHeader = document.createElement('div');
  botHeader.className = 'featured-col-header bot';
  botHeader.textContent = 'Bottom 3';
  botCol.appendChild(botHeader);
  bot3.forEach((e, i) => botCol.appendChild(makeItem(e, i + 1)));

  container.appendChild(topCol);
  container.appendChild(botCol);
}

// ── Sidebar variable buttons ─────────────────────────────────
const CATEGORY_META = {
  Income:     { label: 'Income',     icon: 'assets/icons/euro.png' },
  Employment: { label: 'Employment', icon: 'assets/icons/cogwheel.png' },
  Education:  { label: 'Education',  icon: 'assets/icons/mortarboard.png' },
  Population: { label: 'Population', icon: 'assets/icons/population.png' },
};

async function buildSidebar(map) {
  const container = document.getElementById('var-list');
  if (!container) return;
  container.innerHTML = '';

  const { min, max } = await detectYearRange();
  const yearLabel = `${min}\u2013${max}`;

  const grouped = {};
  VARIABLES.forEach(v => {
    const cat = v.category || 'Other';
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(v);
  });

  Object.entries(grouped)
    .sort(([, aVars], [, bVars]) => {
      const aActive = aVars.some(v => v.id === activeVar) ? -1 : 1;
      const bActive = bVars.some(v => v.id === activeVar) ? -1 : 1;
      return aActive - bActive;
    })
    .forEach(([cat, vars]) => {
      const meta = CATEGORY_META[cat] || { label: cat, icon: null };

      const wrapper = document.createElement('div');
      wrapper.className = 'var-category-wrap';

      const header = document.createElement('button');
      header.className = 'var-category-header';
      header.innerHTML = `
        ${meta.icon ? `<img src="${meta.icon}" class="var-category-icon" alt="${meta.label}" />` : ''}
        <span class="var-category-label">${meta.label}</span>
        <span class="var-category-chevron">&#9658;</span>
      `;

      const body = document.createElement('div');
      body.className = 'var-category-body';
      body.style.display = 'none';

      header.addEventListener('click', () => {
        const isOpen = body.style.display !== 'none';
        body.style.display = isOpen ? 'none' : 'flex';
        header.classList.toggle('open', !isOpen);
      });

      if (vars.some(v => v.id === activeVar)) {
        body.style.display = 'flex';
        header.classList.add('open');
        header.classList.add('has-active');
      }

      vars.forEach(v => {
        const btn = document.createElement('button');
        btn.className  = 'var-btn';
        btn.dataset.id = v.id;
        btn.innerHTML  = `
          <span class="var-btn-label">${v.label_en}</span>
          <span class="var-btn-years">${yearLabel}</span>
        `;
        if (v.id === activeVar) btn.classList.add('active');

        btn.addEventListener('click', async () => {
          activeVar = v.id;
          activeFilters.clear();
          await buildSidebar(map);
          recolorAll(map);
          updateLegend(map);
          updateFeatured(map);
        });

        body.appendChild(btn);
      });

      wrapper.appendChild(header);
      wrapper.appendChild(body);
      container.appendChild(wrapper);
    });
}

// ── Init ─────────────────────────────────────────────────────
async function init() {
  const map = initMap();
  await buildSidebar(map);
  window._map = map;

  map.on('load', async () => {
    const geo  = await loadGeo('provinces');
    const data = await loadData('provinces');
    addLevel(map, 'provinces', geo, data, activeVar, activeYear, []);
    setActiveLevel(map, 'provinces');
    addRoadsOverlay(map, '94c1fe33310f3dfe');

    loadGeo('municipalities').then(async geo => {
      const data = await loadData('municipalities');
      addLevel(map, 'municipalities', geo, data, activeVar, activeYear, []);
      raiseOverlays(map);
      updateFeatured(map);
      updateLegend(map);
    });

    const loading = new Set();
    map.on('zoom', async () => {
      const zoom   = map.getZoom();
      const active = LEVELS.find(l => zoom >= l.minZoom && zoom < l.maxZoom);
      if (!active) return;
      if (loading.has(active.id)) return;
      if (!dataCache[active.id]) {
        loading.add(active.id);
        const geo  = await loadGeo(active.id);
        const data = await loadData(active.id);
        addLevel(map, active.id, geo, data, activeVar, activeYear, getActiveFilterSteps());
        raiseOverlays(map);
        loading.delete(active.id);
      }
      setActiveLevel(map, active.id);
      activeLevel = active.id;
      document.querySelectorAll('.level-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.id === active.id);
      });
    });

    buildJumpTo(map);
    buildLevelSwitcher(map);
    await buildYearSlider(map);
    setupHover(map, () => activeLevel, () => activeVar);
    setupClick(map, () => activeLevel, () => dataCache, () => VARIABLE_MAP, () => activeYear);

    initMinimap(map);
  });
}

init();