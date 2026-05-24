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


const AGE_BANDS = [
  { label: '0–4',   m: 'age_m_0_4',   f: 'age_f_0_4'   },
  { label: '5–9',   m: 'age_m_5_9',   f: 'age_f_5_9'   },
  { label: '10–14', m: 'age_m_10_14', f: 'age_f_10_14' },
  { label: '15–19', m: 'age_m_15_19', f: 'age_f_15_19' },
  { label: '20–24', m: 'age_m_20_24', f: 'age_f_20_24' },
  { label: '25–29', m: 'age_m_25_29', f: 'age_f_25_29' },
  { label: '30–34', m: 'age_m_30_34', f: 'age_f_30_34' },
  { label: '35–39', m: 'age_m_35_39', f: 'age_f_35_39' },
  { label: '40–44', m: 'age_m_40_44', f: 'age_f_40_44' },
  { label: '45–49', m: 'age_m_45_49', f: 'age_f_45_49' },
  { label: '50–54', m: 'age_m_50_54', f: 'age_f_50_54' },
  { label: '55–59', m: 'age_m_55_59', f: 'age_f_55_59' },
  { label: '60–64', m: 'age_m_60_64', f: 'age_f_60_64' },
  { label: '65–69', m: 'age_m_65_69', f: 'age_f_65_69' },
  { label: '70–74', m: 'age_m_70_74', f: 'age_f_70_74' },
  { label: '75–79', m: 'age_m_75_79', f: 'age_f_75_79' },
  { label: '80–84', m: 'age_m_80_84', f: 'age_f_80_84' },
  { label: '85–89', m: 'age_m_85_89', f: 'age_f_85_89' },
  { label: '90–94', m: 'age_m_90_94', f: 'age_f_90_94' },
  { label: '95–99', m: 'age_m_95_99', f: 'age_f_95_99' },
  { label: '100+',  m: 'age_m_100p',  f: 'age_f_100p'  },
];

function buildAgeStructure(areaData, year) {
  // Uses the 3 aggregate age bands always available in the data.
  // Renders a horizontal bar chart split male/female if gender data exists,
  // otherwise a simple 3-bar age breakdown.
  const bands = [
    { label: 'Under 15', id: 'pop_under15_pct', color: '#a8ddc4' },
    { label: '15 – 64',  id: 'pop_15_64_pct',  color: '#2d9b4e' },
    { label: '65+',      id: 'pop_65plus_pct',  color: '#6baed6' },
  ].map(b => ({ ...b, val: areaData?.[b.id]?.[year] ?? null }));

  if (!bands.some(b => b.val != null)) return '';

  const rows = bands.map(b => {
    if (b.val == null) return '';
    return `<div class="age-band-row">
      <div class="age-band-label">${b.label}</div>
      <div class="age-band-track">
        <div class="age-band-fill" style="width:${b.val.toFixed(1)}%;background:${b.color}"></div>
      </div>
      <div class="age-band-value">${b.val.toFixed(1)}%</div>
    </div>`;
  }).join('');

  return `<div class="age-structure-wrap">
    <div class="age-structure-title">AGE STRUCTURE</div>
    ${rows}
  </div>`;
}

function buildAgePyramid(areaData, year) {
  // Extract values for each band
  const bands = AGE_BANDS.map(b => ({
    label: b.label,
    m: areaData?.[b.m]?.[year] ?? null,
    f: areaData?.[b.f]?.[year] ?? null,
  }));

  const hasData = bands.some(b => b.m != null || b.f != null);
  if (!hasData) return '';

  const maxVal = Math.max(...bands.flatMap(b => [b.m ?? 0, b.f ?? 0]));
  if (maxVal === 0) return '';

  // SVG layout constants
  const W        = 280;   // total SVG width
  const rowH     = 11;    // height per age band row
  const labelW   = 32;    // centre label column width
  const barMaxW  = (W - labelW) / 2 - 4;  // max bar width each side
  const H        = AGE_BANDS.length * rowH + 24; // +24 for header

  const rows = bands.slice().reverse().map((b, i) => {
    const y    = 20 + i * rowH;
    const mPx  = b.m != null ? Math.round((b.m / maxVal) * barMaxW) : 0;
    const fPx  = b.f != null ? Math.round((b.f / maxVal) * barMaxW) : 0;
    const midX = W / 2;
    const mTip = b.m != null ? `${b.m.toFixed(1)}%` : 'N/A';
    const fTip = b.f != null ? `${b.f.toFixed(1)}%` : 'N/A';

    return `
      <g class="pyramid-row">
        <!-- Male bar (left) -->
        <rect x="${midX - labelW/2 - mPx}" y="${y}" width="${mPx}" height="${rowH - 1}"
              fill="#6baed6" opacity="0.85">
          <title>Male ${b.label}: ${mTip}</title>
        </rect>
        <!-- Female bar (right) -->
        <rect x="${midX + labelW/2}" y="${y}" width="${fPx}" height="${rowH - 1}"
              fill="#f768a1" opacity="0.85">
          <title>Female ${b.label}: ${fTip}</title>
        </rect>
        <!-- Age label -->
        <text x="${midX}" y="${y + rowH - 3}" text-anchor="middle"
              font-family="Space Mono, monospace" font-size="7" fill="#a8ddc4">${b.label}</text>
      </g>`;
  }).join('');

  return `
    <div class="detail-pyramid-wrap">
      <div class="detail-section-label">AGE PYRAMID</div>
      <div class="pyramid-legend">
        <span class="pyramid-legend-m">&#9646; Male</span>
        <span class="pyramid-legend-f">&#9646; Female</span>
      </div>
      <svg viewBox="0 0 ${W} ${H}" width="100%" xmlns="http://www.w3.org/2000/svg">
        <!-- Centre divider -->
        <line x1="${W/2}" y1="16" x2="${W/2}" y2="${H}"
              stroke="#2d9b4e" stroke-width="0.5" opacity="0.4"/>
        ${rows}
      </svg>
    </div>`;
}

// ── Province name lookup ─────────────────────────────────────
const PROVINCE_NAMES = { '08': 'Barcelona', '17': 'Girona', '25': 'Lleida', '43': 'Tarragona' };

// ── Shape map (real MapLibre mini-map with roads) ─────────────
let _shapeMap = null;
let _shapeMapLoaded = false;

function getShapeMap() {
  if (_shapeMap) return _shapeMap;
  _shapeMap = new maplibregl.Map({
    container: 'detail-shape-map',
    style: 'https://api.protomaps.com/styles/v4/black/en.json?key=94c1fe33310f3dfe',
    interactive: false,
    attributionControl: false,
    center: [1.7, 41.7],
    zoom: 8,
  });
  _shapeMap.on('load', () => { _shapeMapLoaded = true; });
  return _shapeMap;
}

function updateShapeMap(geometry) {
  const sm  = getShapeMap();
  let flat  = [];
  if (geometry.type === 'Polygon') flat = geometry.coordinates[0];
  else if (geometry.type === 'MultiPolygon') flat = geometry.coordinates.flat(2);
  const lngs   = flat.map(c => c[0]), lats = flat.map(c => c[1]);
  const bounds = [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]];
  const geo    = { type: 'Feature', geometry, properties: {} };

  function apply() {
    sm.resize();
    if (sm.getSource('shape')) {
      sm.getSource('shape').setData(geo);
    } else {
      sm.addSource('shape', { type: 'geojson', data: geo });
      sm.addLayer({ id: 'shape-fill', type: 'fill', source: 'shape',
        paint: { 'fill-color': '#2d9b4e', 'fill-opacity': 0.2 } });
      sm.addLayer({ id: 'shape-line', type: 'line', source: 'shape',
        paint: { 'line-color': '#38b86e', 'line-width': 1.5 } });
    }
    sm.fitBounds(bounds, { padding: 20, duration: 300 });
  }

  if (_shapeMapLoaded) { apply(); }
  else { sm.once('load', apply); }
}

// ── Report helpers ─────────────────────────────────────────────

function buildSparkline(areaData, varId, levelLookup, W = 200, H = 26) {
  const yearMap = areaData?.[varId];
  if (!yearMap) return '';
  const pts = Object.entries(yearMap).map(([y,v]) => ({ y: Number(y), v })).sort((a,b) => a.y - b.y);
  if (pts.length < 2) return '';

  const avgPts = pts.map(p => {
    const all = Object.values(levelLookup).map(d => d?.[varId]?.[p.y]).filter(v => v != null);
    return { y: p.y, v: all.length ? all.reduce((a,b) => a+b,0)/all.length : null };
  }).filter(p => p.v != null);

  const allV = [...pts.map(p=>p.v), ...avgPts.map(p=>p.v)];
  const gMin = Math.min(...allV), gMax = Math.max(...allV), range = gMax - gMin || 1;

  const toX = (i,n) => (2 + (i/(n-1))*(W-4)).toFixed(1);
  const toY = v  => (H-4 - ((v-gMin)/range)*(H-10)).toFixed(1);

  const line    = pts.map((p,i) => `${toX(i,pts.length)},${toY(p.v)}`).join(' ');
  const avgLine = avgPts.map((p,i) => `${toX(i,avgPts.length)},${toY(p.v)}`).join(' ');
  const lastX   = toX(pts.length-1, pts.length);
  const lastY   = toY(pts[pts.length-1].v);

  const first = pts[0].v, last = pts[pts.length-1].v;
  const tPct  = first !== 0 ? ((last-first)/Math.abs(first)*100).toFixed(1) : null;
  const tUp   = tPct != null && Number(tPct) >= 0;
  const tTxt  = tPct != null ? `${tUp?'↗':'↘'} ${tUp?'+':''}${tPct}%` : '';

  return `<div class="spark-wrap">
    <div class="spark-header">
      <span class="spark-years-left">${pts[0].y}</span>
      ${avgLine ? '<span class="spark-avg">― Catalonia avg</span>' : ''}
      <span class="${tUp ? 'spark-trend trend-up' : 'spark-trend trend-dn'}">${tTxt}</span>
    </div>
    <svg viewBox="0 0 ${W} ${H}" width="100%" xmlns="http://www.w3.org/2000/svg">
      ${avgLine?`<polyline points="${avgLine}" fill="none" stroke="#555e68"
        stroke-width="1" stroke-dasharray="3,3"/>`:''}
      <polyline points="${line}" fill="none" stroke="#e6edf3"
        stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
      <circle cx="${lastX}" cy="${lastY}" r="2.5" fill="#38b86e"/>
    </svg>
    <div class="spark-footer">
      <span class="spark-year-end">${pts[pts.length-1].y}</span>
    </div>
  </div>`;
}

function buildHBar(label, value, rawVal, color) {
  if (rawVal == null) return '';
  return `<div class="hbar-row">
    <div class="hbar-label">${label}</div>
    <div class="hbar-track"><div class="hbar-fill" style="width:${Math.min(rawVal,100).toFixed(1)}%;background:${color||'var(--accent)'}"></div></div>
    <div class="hbar-value">${value}</div>
  </div>`;
}

function buildEduLadder(areaData, year) {
  const segs = [
    { id:'edu_primary_pct',         label:'Primary or below', color:'#e05c5c' },
    { id:'edu_lower_secondary_pct', label:'Lower secondary',  color:'#fe9929' },
    { id:'edu_upper_secondary_pct', label:'Upper secondary',  color:'#74c476' },
    { id:'edu_higher_pct',          label:'Higher education', color:'#6baed6' },
  ].map(s => ({ ...s, val: areaData?.[s.id]?.[year] ?? null }));
  if (!segs.some(s => s.val != null)) return '';
  const rows = segs.map(s => {
    if (s.val == null) return '';
    return `<div class="age-band-row">
      <div class="age-band-label" style="width:100px">${s.label}</div>
      <div class="age-band-track">
        <div class="age-band-fill" style="width:${s.val.toFixed(1)}%;background:${s.color}"></div>
      </div>
      <div class="age-band-value">${s.val.toFixed(1)}%</div>
    </div>`;
  }).join('');
  return `<div class="age-structure-wrap"><div class="age-structure-title">EDUCATION LEVEL</div>${rows}</div>`;
}

function buildColSection(title, html) {
  return `<div class="col-section"><div class="col-section-title">${title}</div>${html}</div>`;
}

function buildSection(title, html) {
  return `<div class="report-section"><div class="report-section-title">${title}</div>${html}</div>`;
}

export function setupClick(map, getActiveLevel, getAllData, getVarMap, getYear) {
  const panel    = document.getElementById('detail-panel');
  const closeBtn = document.getElementById('detail-close');

  function closePanel() { panel.style.display = 'none'; }
  closeBtn.addEventListener('click', closePanel);

  LEVELS.forEach(level => {
    map.on('click', `${level.id}-fill`, (e) => {
      if (!e.features?.length) return;

      const props       = e.features[0].properties;
      const geom        = e.features[0].geometry;
      const allData     = getAllData();
      const varMap      = getVarMap();
      const year        = getYear();
      const levelId     = level.id;
      const areaId      = props[level.idCol];
      const areaData    = allData[levelId]?.[areaId];
      const levelLookup = allData[levelId] || {};

      // Identity
      let name = '', code = '', parent = '';
      if (levelId === 'provinces') {
        name   = PROVINCE_NAMES[props.CPRO] || `Province ${props.CPRO}`;
        code   = `Province · ${props.CPRO}`;
        parent = 'Catalonia';
      } else if (levelId === 'municipalities') {
        name   = props.NMUN || props.CUMUN;
        code   = `Municipality · ${props.CUMUN}`;
        parent = PROVINCE_NAMES[props.CUMUN?.slice(0,2)] || '';
      } else {
        name   = props.NMUN || `Tract ${props.CUSEC}`;
        code   = `Census tract · ${props.CUSEC}`;
        parent = `${props.NMUN ? props.NMUN+' · ' : ''}${PROVINCE_NAMES[props.CUSEC?.slice(0,2)] || ''} province`;
      }

      // Helpers
      function fmtVal(varId) {
        const v = areaData?.[varId]?.[year];
        return v != null ? formatValue(v, varMap[varId]) : null;
      }
      function rawVal(varId) { return areaData?.[varId]?.[year] ?? null; }
      function spark(varId)  { return buildSparkline(areaData, varId, levelLookup); }
      function hbar(label, varId, color) {
        const v = rawVal(varId);
        return buildHBar(label, fmtVal(varId), v, color);
      }

      // Header
      document.getElementById('detail-title').textContent    = name;
      document.getElementById('detail-subtitle').textContent = code;
      document.getElementById('detail-parent').textContent   = parent;

      // KPI strip — 7 key indicators at a glance
      const kpis = [
        { label: 'Population',        id: 'pop_total'             },
        { label: 'Net income / cap',  id: 'net_income_pc'         },
        { label: 'Foreign born',      id: 'foreign_born_pct'      },
        { label: 'Employment',        id: 'employment_rate'       },
        { label: 'Poverty (<60% med)',id: 'poverty_60_median_pct' },
        { label: 'Pop. aged 15–64',   id: 'pop_15_64_pct'        },
      ];
      document.getElementById('detail-kpi-strip').innerHTML = kpis.map(k => {
        const v = areaData?.[k.id]?.[year];
        const fmt = v != null ? formatValue(v, varMap[k.id]) : '—';
        return `<div class="kpi-item">
          <div class="kpi-label">${k.label}</div>
          <div class="kpi-value">${fmt}</div>
        </div>`;
      }).join('');

      // Position panel below legend to avoid overlap
      function positionPanel() {
        const legend = document.getElementById('legend');
        if (legend && legend.style.display !== 'none') {
          const bottom = legend.getBoundingClientRect().bottom;
          const mapTop = panel.parentElement.getBoundingClientRect().top;
          panel.style.top = Math.max(120, bottom - mapTop + 8) + 'px';
        } else {
          panel.style.top = '120px';
        }
      }
      positionPanel();
      // Reposition if legend changes size (filter clicks)
      new ResizeObserver(positionPanel).observe(document.getElementById('legend'));

      panel.style.display = 'flex';
      updateShapeMap(geom);

      // ── Income section ───────────────────────────────────
      const incomeHtml = `
        <div class="report-grid-2">
          <div class="wiki-card">
            <div class="wiki-card-label">Net income per capita</div>
            <div class="wiki-card-value">${fmtVal('net_income_pc') ?? '—'}</div>
            ${spark('net_income_pc')}
          </div>
          <div class="wiki-card">
            <div class="wiki-card-label">Net income per household</div>
            <div class="wiki-card-value">${fmtVal('net_income_hh') ?? '—'}</div>
            ${spark('net_income_hh')}
          </div>
        </div>
        <div class="report-grid-3">
          <div class="mini-stat"><div class="mini-label">Median income</div><div class="mini-value">${fmtVal('median_income_cu')??'—'}</div></div>
          <div class="mini-stat"><div class="mini-label">Gini index</div><div class="mini-value">${fmtVal('gini')??'—'}</div></div>
          <div class="mini-stat"><div class="mini-label">Poverty rate</div><div class="mini-value">${fmtVal('poverty_60_median_pct')??'—'}</div></div>
        </div>`;

      // ── Population section ───────────────────────────────
      const popHtml = `
        <div class="report-grid-3">
          <div class="wiki-card">
            <div class="wiki-card-label">Total population</div>
            <div class="wiki-card-value">${fmtVal('pop_total') ?? '—'}</div>
            ${spark('pop_total')}
          </div>
          <div class="wiki-card">
            <div class="wiki-card-label">Foreign born</div>
            <div class="wiki-card-value">${fmtVal('foreign_born_pct') ?? '—'}</div>
            ${spark('foreign_born_pct')}
          </div>
          <div class="wiki-card">
            <div class="wiki-card-label">Aged 65+</div>
            <div class="wiki-card-value">${fmtVal('pop_65plus_pct') ?? '—'}</div>
            ${spark('pop_65plus_pct')}
          </div>
        </div>
        ${buildAgePyramid(areaData, year)}`;

      // ── Demographics section ─────────────────────────────
      const demoHtml = `
        <div class="report-grid-2">
          <div>
            <div class="subsection-label">Foreign-born by region</div>
            ${hbar('Europe',   'foreign_europe_pct',   '#6baed6')}
            ${hbar('Americas', 'foreign_americas_pct', '#74c476')}
            ${hbar('Africa',   'foreign_africa_pct',   '#fe9929')}
            ${hbar('Asia',     'foreign_asia_pct',     '#f768a1')}
          </div>
          <div>
            <div class="subsection-label">Age groups</div>
            ${hbar('Under 15', 'pop_under15_pct', '#a8ddc4')}
            ${hbar('15–64',    'pop_15_64_pct',   '#2d9b4e')}
            ${hbar('65+',      'pop_65plus_pct',  '#6baed6')}
          </div>
        </div>`;

      // ── Education section ────────────────────────────────
      const eduHtml = `
        ${buildEduLadder(areaData, year)}
        <div class="report-grid-2" style="margin-top:10px">
          <div class="wiki-card">
            <div class="wiki-card-label">Higher education</div>
            <div class="wiki-card-value">${fmtVal('edu_higher_pct') ?? '—'}</div>
            ${spark('edu_higher_pct')}
          </div>
          <div class="wiki-card">
            <div class="wiki-card-label">Primary or below</div>
            <div class="wiki-card-value">${fmtVal('edu_primary_pct') ?? '—'}</div>
            ${spark('edu_primary_pct')}
          </div>
        </div>`;

      // ── Employment section ───────────────────────────────
      const empHtml = `
        <div class="report-grid-2">
          <div class="wiki-card">
            <div class="wiki-card-label">Employment rate</div>
            <div class="wiki-card-value">${fmtVal('employment_rate') ?? '—'}</div>
            ${spark('employment_rate')}
          </div>
          <div class="wiki-card">
            <div class="wiki-card-label">Unemployment rate</div>
            <div class="wiki-card-value">${fmtVal('unemployment_rate') ?? '—'}</div>
            ${spark('unemployment_rate')}
          </div>
        </div>
        <div class="report-grid-2" style="margin-top:10px">
          <div>
            <div class="subsection-label">Economic sectors</div>
            ${hbar('Services',     'sector_services_pct',     '#2d9b4e')}
            ${hbar('Industry',     'sector_industry_pct',     '#6baed6')}
            ${hbar('Construction', 'sector_construction_pct', '#fe9929')}
            ${hbar('Agriculture',  'sector_agriculture_pct',  '#74c476')}
          </div>
          <div>
            <div class="subsection-label">Occupations</div>
            ${hbar('High-skill',  'occ_high_skill_pct',  '#6baed6')}
            ${hbar('Low-skill',   'occ_low_skill_pct',   '#fe9929')}
            ${hbar('Elementary',  'occ_elementary_pct',  '#e05c5c')}
          </div>
        </div>`;

      // Build horizontally snapping sections
      const SECTIONS = ['Income','Employment','Education','Population'];

      // Nav tabs
      const navHtml = SECTIONS.map((s,i) =>
        `<button class="detail-nav-tab${i===0?' active':''}" data-idx="${i}">${s}</button>`
      ).join('');
      document.getElementById('detail-nav').innerHTML = navHtml;

      // Wire tab clicks to scroll
      document.getElementById('detail-nav').querySelectorAll('.detail-nav-tab').forEach(btn => {
        btn.addEventListener('click', () => {
          const body = document.getElementById('detail-body');
          const idx  = Number(btn.dataset.idx);
          body.scrollTo({ left: idx * body.clientWidth, behavior: 'smooth' });
        });
      });

      // Update active tab on scroll
      const bodyEl = document.getElementById('detail-body');
      bodyEl.onscroll = () => {
        const idx = Math.round(bodyEl.scrollLeft / bodyEl.clientWidth);
        document.getElementById('detail-nav').querySelectorAll('.detail-nav-tab').forEach((b,i) => {
          b.classList.toggle('active', i === idx);
        });
      };

      // Section 1: Income
      const s1 = `<div class="report-section"><div class="section-scroll">
        <div class="wiki-card">
          <div class="wiki-card-label">Net income per capita</div>
          <div class="wiki-card-value">${fmtVal('net_income_pc')??'—'}</div>
          ${spark('net_income_pc')}
        </div>
        <div class="wiki-card">
          <div class="wiki-card-label">Net income per household</div>
          <div class="wiki-card-value">${fmtVal('net_income_hh')??'—'}</div>
          ${spark('net_income_hh')}
        </div>
        <div class="wiki-card">
          <div class="wiki-card-label">Median income (equiv. adult)</div>
          <div class="wiki-card-value">${fmtVal('median_income_cu')??'—'}</div>
          ${spark('median_income_cu')}
        </div>
        <div class="mini-grid-2">
          <div class="mini-stat"><div class="mini-label">Gini index</div><div class="mini-value">${fmtVal('gini')??'—'}</div></div>
          <div class="mini-stat"><div class="mini-label">Poverty rate</div><div class="mini-value">${fmtVal('poverty_60_median_pct')??'—'}</div></div>
        </div>
      </div></div>`;

      // Section 2: Population
      const s2 = `<div class="report-section"><div class="section-scroll">
        <div class="wiki-card">
          <div class="wiki-card-label">Total population</div>
          <div class="wiki-card-value">${fmtVal('pop_total')??'—'}</div>
          ${spark('pop_total')}
        </div>
        ${buildAgeStructure(areaData, year)}
        ${buildAgePyramid(areaData, year)}
      </div></div>`;

      // Section 3: Demographics
      const s3 = `<div class="report-section"><div class="section-scroll">
        <div class="wiki-card">
          <div class="wiki-card-label">Foreign born</div>
          <div class="wiki-card-value">${fmtVal('foreign_born_pct')??'—'}</div>
          ${spark('foreign_born_pct')}
        </div>
        <div class="hbar-section-title">Foreign-born by region</div>
        ${buildHBar('Europe',   fmtVal('foreign_europe_pct'),   rawVal('foreign_europe_pct'),   '#6baed6')}
        ${buildHBar('Americas', fmtVal('foreign_americas_pct'), rawVal('foreign_americas_pct'), '#74c476')}
        ${buildHBar('Africa',   fmtVal('foreign_africa_pct'),   rawVal('foreign_africa_pct'),   '#fe9929')}
        ${buildHBar('Asia',     fmtVal('foreign_asia_pct'),     rawVal('foreign_asia_pct'),     '#f768a1')}
        <div class="hbar-section-title">Gender & age</div>
        ${buildHBar('Male',     fmtVal('gender_ratio'),         rawVal('gender_ratio'),         '#6baed6')}
        ${buildHBar('Under 15', fmtVal('pop_under15_pct'),      rawVal('pop_under15_pct'),      '#a8ddc4')}
        ${buildHBar('65+',      fmtVal('pop_65plus_pct'),       rawVal('pop_65plus_pct'),       '#e05c5c')}
      </div></div>`;

      // Section 4: Education
      const s4 = `<div class="report-section"><div class="section-scroll">
        ${buildEduLadder(areaData, year)}
        <div class="wiki-card">
          <div class="wiki-card-label">Higher education</div>
          <div class="wiki-card-value">${fmtVal('edu_higher_pct')??'—'}</div>
          ${spark('edu_higher_pct')}
        </div>
        <div class="mini-grid-2">
          <div class="mini-stat"><div class="mini-label">Primary or below</div><div class="mini-value">${fmtVal('edu_primary_pct')??'—'}</div></div>
          <div class="mini-stat"><div class="mini-label">Upper secondary</div><div class="mini-value">${fmtVal('edu_upper_secondary_pct')??'—'}</div></div>
        </div>
      </div></div>`;

      // Section 5: Employment
      const s5 = `<div class="report-section"><div class="section-scroll">
        <div class="wiki-card">
          <div class="wiki-card-label">Employment rate</div>
          <div class="wiki-card-value">${fmtVal('employment_rate')??'—'}</div>
          ${spark('employment_rate')}
        </div>
        <div class="mini-grid-2">
          <div class="mini-stat"><div class="mini-label">Unemployment</div><div class="mini-value">${fmtVal('unemployment_rate')??'—'}</div></div>
          <div class="mini-stat"><div class="mini-label">High-skill jobs</div><div class="mini-value">${fmtVal('occ_high_skill_pct')??'—'}</div></div>
        </div>
        <div class="hbar-section-title">Economic sectors</div>
        ${buildHBar('Services',     fmtVal('sector_services_pct'),     rawVal('sector_services_pct'),     '#2d9b4e')}
        ${buildHBar('Industry',     fmtVal('sector_industry_pct'),     rawVal('sector_industry_pct'),     '#6baed6')}
        ${buildHBar('Construction', fmtVal('sector_construction_pct'), rawVal('sector_construction_pct'), '#fe9929')}
        ${buildHBar('Agriculture',  fmtVal('sector_agriculture_pct'),  rawVal('sector_agriculture_pct'),  '#74c476')}
        <div class="hbar-section-title">Occupations</div>
        ${buildHBar('High-skill',  fmtVal('occ_high_skill_pct'),  rawVal('occ_high_skill_pct'),  '#6baed6')}
        ${buildHBar('Elementary',  fmtVal('occ_elementary_pct'),  rawVal('occ_elementary_pct'),  '#e05c5c')}
      </div></div>`;

      document.getElementById('detail-body').innerHTML = s1 + s5 + s4 + s2;
      document.getElementById('detail-body').scrollLeft = 0;

      e.stopPropagation();
    });
  });

  map.on('click', (e) => { if (!e.defaultPrevented) closePanel(); });
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