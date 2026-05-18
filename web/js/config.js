// config.js - all frontend configuration

export const COLOR_SCALES = {
  sequential:     ['#fef0d9', '#fdcc8a', '#fc8d59', '#d7301f'],  // OrRd — income
  sequentialWarm: ['#ffffd4', '#fed98e', '#fe9929', '#cc4c02'],  // YlOrBr — employment/low-edu
  sequentialCool: ['#f1eef6', '#bdc9e1', '#74a9cf', '#0570b0'],  // PuBu — higher edu
  sequentialAlert:['#feebe2', '#fbb4b9', '#f768a1', '#ae017e'],  // RdPu — unemployment/risk
  sequentialGreen:['#edf8e9', '#bae4b3', '#74c476', '#238b45'],  // Greens — services/salaried
  diverging:      ['#e66101', '#fdb863', '#b2abd2', '#5e3c99'],  // PuOr — reserved for Gini
};

export const VARIABLES = [

  // ── Income ────────────────────────────────────────────────────────────────
  {
    id: 'net_income_pc', label_en: 'Net income per capita',
    label_es: 'Renta neta media por persona', label_ca: 'Renda neta mitjana per persona',
    unit: 'EUR', decimals: 0, colorScale: 'sequential', category: 'Income',
  },
  {
    id: 'net_income_hh', label_en: 'Net income per household',
    label_es: 'Renta neta media por hogar', label_ca: 'Renda neta mitjana per llar',
    unit: 'EUR', decimals: 0, colorScale: 'sequential', category: 'Income',
  },
  {
    id: 'median_income_cu', label_en: 'Median income per equivalent adult',
    label_es: 'Mediana de la renta por unidad de consumo', label_ca: 'Mediana de la renda per unitat de consum',
    unit: 'EUR', decimals: 0, colorScale: 'sequential', category: 'Income',
  },
  {
    id: 'gross_income_pc', label_en: 'Gross income per capita',
    label_es: 'Renta bruta media por persona', label_ca: 'Renda bruta mitjana per persona',
    unit: 'EUR', decimals: 0, colorScale: 'sequential', category: 'Income',
  },
  {
    id: 'gross_income_hh', label_en: 'Gross income per household',
    label_es: 'Renta bruta media por hogar', label_ca: 'Renda bruta mitjana per llar',
    unit: 'EUR', decimals: 0, colorScale: 'sequential', category: 'Income',
  },

  {
    id:       'gini',
    label_en: 'Gini index (inequality)',
    label_es: 'Índice de Gini',
    label_ca: 'Índex de Gini',
    unit:     'PCT',
    decimals: 1,
    colorScale: 'diverging',
    category: 'Income',
  },

  {
    id:       'p80_p20',
    label_en: 'P80/P20 income ratio',
    label_es: 'Distribución de la renta P80/P20',
    label_ca: 'Distribució de la renda P80/P20',
    unit:     '',
    decimals: 2,
    colorScale: 'diverging',
    category: 'Income',
  },

    {
    id:       'poverty_60_median_pct',
    label_en: 'Population below 60% median income',
    label_es: 'Población con ingresos por debajo 60% de la mediana',
    label_ca: 'Població amb ingressos per sota 60% de la mediana',
    unit:     'PCT',
    decimals: 1,
    colorScale: 'sequentialAlert',
    category: 'Income',
  },
  {
    id:       'poverty_10k_pct',
    label_en: 'Population with income below €10,000',
    label_es: 'Población con ingresos por debajo de 10.000€',
    label_ca: 'Població amb ingressos per sota 10.000€',
    unit:     'PCT',
    decimals: 1,
    colorScale: 'sequentialAlert',
    category: 'Income',
  },

  // ── Employment — activity ─────────────────────────────────────────────────
  {
    id: 'employment_rate', label_en: 'Employment rate',
    label_es: 'Tasa de empleo', label_ca: "Taxa d'ocupació",
    unit: 'PCT', decimals: 1, colorScale: 'sequentialWarm', category: 'Employment',
  },
  {
    id: 'unemployment_rate', label_en: 'Unemployment rate',
    label_es: 'Tasa de paro', label_ca: "Taxa d'atur",
    unit: 'PCT', decimals: 1, colorScale: 'sequentialAlert', category: 'Employment',
  },
  {
    id: 'pension_recipients_pct', label_en: 'Pension / disability recipients',
    label_es: 'Perceptores de pensión (incapacidad, jubilación)', label_ca: 'Perceptors de pensió (incapacitat, jubilació)',
    unit: 'PCT', decimals: 1, colorScale: 'sequentialAlert', category: 'Employment',
  },

  // ── Employment — occupation ───────────────────────────────────────────────
  {
    id: 'occ_high_skill_pct', label_en: 'High-skill occupations',
    label_es: 'Ocupaciones de alta cualificación', label_ca: "Ocupacions d'alta qualificació",
    unit: 'PCT', decimals: 1, colorScale: 'sequentialCool', category: 'Employment',
  },
  {
    id: 'occ_low_skill_pct', label_en: 'Low-skill qualified workers',
    label_es: 'Trabajadores cualificados de nivel bajo', label_ca: 'Treballadors qualificats de nivell baix',
    unit: 'PCT', decimals: 1, colorScale: 'sequentialWarm', category: 'Employment',
  },
  {
    id: 'occ_elementary_pct', label_en: 'Elementary occupations',
    label_es: 'Ocupaciones elementales', label_ca: 'Ocupacions elementals',
    unit: 'PCT', decimals: 1, colorScale: 'sequentialAlert', category: 'Employment',
  },

  // ── Employment — sector ───────────────────────────────────────────────────
  {
    id: 'sector_agriculture_pct', label_en: 'Agriculture employment',
    label_es: 'Agricultura, ganadería y pesca', label_ca: 'Agricultura, ramaderia i pesca',
    unit: 'PCT', decimals: 1, colorScale: 'sequentialGreen', category: 'Employment',
  },
  {
    id: 'sector_industry_pct', label_en: 'Industry employment',
    label_es: 'Industria', label_ca: 'Indústria',
    unit: 'PCT', decimals: 1, colorScale: 'sequentialWarm', category: 'Employment',
  },
  {
    id: 'sector_construction_pct', label_en: 'Construction employment',
    label_es: 'Construcción', label_ca: 'Construcció',
    unit: 'PCT', decimals: 1, colorScale: 'sequentialWarm', category: 'Employment',
  },
  {
    id: 'sector_services_pct', label_en: 'Services employment',
    label_es: 'Servicios', label_ca: 'Serveis',
    unit: 'PCT', decimals: 1, colorScale: 'sequentialGreen', category: 'Employment',
  },

  // ── Employment — professional status ─────────────────────────────────────
  {
    id: 'self_employed_pct', label_en: 'Self-employed',
    label_es: 'Trabajadores por cuenta propia', label_ca: 'Treballadors per compte propi',
    unit: 'PCT', decimals: 1, colorScale: 'sequentialWarm', category: 'Employment',
  },
  {
    id: 'employed_pct', label_en: 'Employed (salaried)',
    label_es: 'Trabajadores por cuenta ajena', label_ca: "Treballadors per compte aliè",
    unit: 'PCT', decimals: 1, colorScale: 'sequentialGreen', category: 'Employment',
  },

  // ── Education ─────────────────────────────────────────────────────────────
  {
    id: 'edu_primary_pct', label_en: 'Primary education or below',
    label_es: 'Educación primaria o inferior', label_ca: 'Educació primària o inferior',
    unit: 'PCT', decimals: 1, colorScale: 'sequentialAlert', category: 'Education',
  },
  {
    id: 'edu_lower_secondary_pct', label_en: 'Lower secondary education',
    label_es: 'Primera etapa de Educación Secundaria', label_ca: "Primera etapa d'Educació Secundària",
    unit: 'PCT', decimals: 1, colorScale: 'sequentialWarm', category: 'Education',
  },
  {
    id: 'edu_upper_secondary_pct', label_en: 'Upper secondary education',
    label_es: 'Segunda etapa de Educación Secundaria', label_ca: "Segona etapa d'Educació Secundària",
    unit: 'PCT', decimals: 1, colorScale: 'sequentialWarm', category: 'Education',
  },
  {
    id: 'edu_higher_pct', label_en: 'Higher education',
    label_es: 'Educación superior', label_ca: 'Educació superior',
    unit: 'PCT', decimals: 1, colorScale: 'sequentialCool', category: 'Education',
  },
];

// lookup by id — used everywhere in the app
export const VARIABLE_MAP = Object.fromEntries(VARIABLES.map(v => [v.id, v]));

// geographic levels
export const LEVELS = [
  { id: 'provinces',      label_en: 'Provinces',      minZoom: 0,   maxZoom: 7.5, idCol: 'CPRO'  },
  { id: 'municipalities', label_en: 'Municipalities',  minZoom: 7.5, maxZoom: 10,  idCol: 'CUMUN' },
  { id: 'tracts',         label_en: 'Census tracts',   minZoom: 10,  maxZoom: 22,  idCol: 'CUSEC' },
];

export const DEFAULT_VARIABLE = 'net_income_pc';
export const DEFAULT_YEAR     = 2023;