import { api } from './http.js';

// ---- Defaults & shape -------------------------------------------------
//
// Storage shape on the server (encrypted nowhere — just stored as JSON
// in the user_appearance table):
//
// {
//   // Button styling (single set — no variants):
//   btnFont, btnSize, btnColor, btnColorOpacity, btnBg, btnBgOpacity,
//   // Indicator toggles:
//   showFilesStatus, showModelToast, showFrameActivity,
//   // Variant library for the Gemini answer display:
//   variants: [
//     { id: 'v_default', name: 'Default', settings: { resultFont, resultSize, ... } },
//     ...
//   ],
//   activeVariantId: 'v_default',
//   // Flat result* fields are kept in sync with the active variant — both
//   // for backward-compat (older sessions / probes) and so that
//   // applyAppearance() can keep reading flat keys.
//   resultFont, resultSize, resultColor, resultColorOpacity, resultBg, resultBgOpacity
// }

const RESULT_FIELDS = [
  'resultFont',
  'resultSize',
  'resultColor',
  'resultColorOpacity',
  'resultBg',
  'resultBgOpacity',
];

const RESULT_DEFAULTS = {
  resultFont: '',
  resultSize: 11,
  resultColor: '#404040',
  resultColorOpacity: 40,
  resultBg: '#ffffff',
  resultBgOpacity: 0,
};

const NON_VARIANT_DEFAULTS = {
  btnFont: '',
  btnSize: 14,
  btnColor: '#1a1a1a',
  btnColorOpacity: 25,
  btnBg: '#ffffff',
  btnBgOpacity: 0,
  // Active-state colors of the friend toggle (Д). The inactive state reuses
  // the regular btn* styling. These are flat (not per-variant).
  friendActiveColor: '#ffffff',
  friendActiveColorOpacity: 100,
  friendActiveBg: '#2a6df4',
  friendActiveBgOpacity: 100,
  showFilesStatus: false,
  showModelToast: false,
  showFrameActivity: false,
};

export const APPEARANCE_DEFAULTS = {
  ...NON_VARIANT_DEFAULTS,
  ...RESULT_DEFAULTS,
  variants: [
    { id: 'v_default', name: 'Default', settings: { ...RESULT_DEFAULTS } },
  ],
  activeVariantId: 'v_default',
};

let cache = clone(APPEARANCE_DEFAULTS);

function clone(o) {
  return JSON.parse(JSON.stringify(o));
}

function newVariantId() {
  return `v_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

function pickResult(obj) {
  const out = {};
  for (const k of RESULT_FIELDS) {
    out[k] = obj[k] ?? RESULT_DEFAULTS[k];
  }
  return out;
}

// Migrate legacy (no `variants`) data — synthesise a single Default variant
// from the flat result* fields so the user does not lose their current look.
function migrate(raw) {
  const data = { ...NON_VARIANT_DEFAULTS, ...RESULT_DEFAULTS, ...(raw ?? {}) };
  let variants = Array.isArray(data.variants) ? data.variants.filter(isValidVariant) : [];
  if (variants.length === 0) {
    variants = [
      {
        id: 'v_default',
        name: 'Default',
        settings: pickResult(data),
      },
    ];
  }
  let activeId = typeof data.activeVariantId === 'string' ? data.activeVariantId : '';
  if (!variants.some((v) => v.id === activeId)) activeId = variants[0].id;

  // Mirror active variant settings into flat result* fields so existing
  // consumers of cache.resultFont / etc. keep working.
  const active = variants.find((v) => v.id === activeId) ?? variants[0];
  const result = pickResult(active.settings);

  return {
    ...data,
    ...result,
    variants,
    activeVariantId: activeId,
  };
}

function isValidVariant(v) {
  return (
    v &&
    typeof v.id === 'string' &&
    typeof v.name === 'string' &&
    v.settings &&
    typeof v.settings === 'object'
  );
}

export function hexToRgba(hex, opacityPct) {
  const a = Math.max(0, Math.min(100, Number(opacityPct ?? 100))) / 100;
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return `rgba(0,0,0,${a})`;
  const r = parseInt(m[1].slice(0, 2), 16);
  const g = parseInt(m[1].slice(2, 4), 16);
  const b = parseInt(m[1].slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

export function loadAppearance() {
  return cache;
}

export async function fetchAppearance() {
  try {
    const data = await api('/me/appearance');
    cache = migrate(data && typeof data === 'object' ? data : {});
  } catch {
    cache = clone(APPEARANCE_DEFAULTS);
  }
  return cache;
}

// Persists a merged subset. Whatever you pass overrides cache; whatever you
// don't keeps its current value. After save, cache is refreshed to the merged
// shape (re-migrated so invariants hold).
export async function saveAppearance(partial) {
  const merged = migrate({ ...cache, ...(partial ?? {}) });
  cache = merged;
  await api('/me/appearance', { method: 'PUT', body: JSON.stringify(merged) });
  return cache;
}

export function applyAppearance(a) {
  const data = migrate(a ?? cache);
  const root = document.documentElement.style;
  root.setProperty('--result-font', data.resultFont || 'inherit');
  root.setProperty('--result-size', `${Number(data.resultSize) || 11}px`);
  root.setProperty('--result-color', hexToRgba(data.resultColor, data.resultColorOpacity ?? 100));
  root.setProperty('--result-bg', hexToRgba(data.resultBg, data.resultBgOpacity ?? 0));
  root.setProperty('--screenshot-font', data.btnFont || 'inherit');
  root.setProperty('--screenshot-size', `${Number(data.btnSize) || 14}px`);
  root.setProperty('--screenshot-color', hexToRgba(data.btnColor, data.btnColorOpacity ?? 100));
  root.setProperty('--screenshot-bg', hexToRgba(data.btnBg, data.btnBgOpacity ?? 0));
  root.setProperty(
    '--friend-active-color',
    hexToRgba(data.friendActiveColor, data.friendActiveColorOpacity ?? 100),
  );
  root.setProperty(
    '--friend-active-bg',
    hexToRgba(data.friendActiveBg, data.friendActiveBgOpacity ?? 100),
  );
}

// ---- Variant operations ----------------------------------------------

export function getVariants() {
  return cache.variants;
}

export function getActiveVariantId() {
  return cache.activeVariantId;
}

function findActiveVariant() {
  return cache.variants.find((v) => v.id === cache.activeVariantId) ?? cache.variants[0];
}

// Switch which variant is active. Mirrors its settings into the flat
// result* fields so applyAppearance reflects it. Persists immediately.
export async function setActiveVariant(id) {
  const target = cache.variants.find((v) => v.id === id);
  if (!target) return null;
  cache.activeVariantId = id;
  Object.assign(cache, pickResult(target.settings));
  applyAppearance(cache);
  await saveAppearance({ activeVariantId: id, ...pickResult(target.settings) });
  return target;
}

// Cycle to next variant (Alt+V).
export async function cycleVariant() {
  const list = cache.variants;
  if (list.length < 2) return null;
  const idx = list.findIndex((v) => v.id === cache.activeVariantId);
  const next = list[(idx + 1) % list.length];
  return setActiveVariant(next.id);
}

export async function addVariant(name = 'Новий варіант') {
  const active = findActiveVariant();
  const v = { id: newVariantId(), name, settings: clone(active.settings) };
  cache.variants.push(v);
  await saveAppearance({ variants: cache.variants });
  return v;
}

export async function renameVariant(id, name) {
  const v = cache.variants.find((x) => x.id === id);
  if (!v) return null;
  v.name = name;
  await saveAppearance({ variants: cache.variants });
  return v;
}

export async function deleteVariant(id) {
  if (cache.variants.length <= 1) return false;
  cache.variants = cache.variants.filter((v) => v.id !== id);
  if (!cache.variants.some((v) => v.id === cache.activeVariantId)) {
    const first = cache.variants[0];
    cache.activeVariantId = first.id;
    Object.assign(cache, pickResult(first.settings));
  }
  applyAppearance(cache);
  await saveAppearance({
    variants: cache.variants,
    activeVariantId: cache.activeVariantId,
  });
  return true;
}

// Write a result-field change into the active variant's settings (and the
// mirrored flat fields). Doesn't persist on its own — caller decides when.
export function updateActiveVariantSettings(partial) {
  const v = findActiveVariant();
  Object.assign(v.settings, partial);
  Object.assign(cache, pickResult(v.settings));
}
