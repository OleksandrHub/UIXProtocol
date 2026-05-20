import { api } from './http.js';

export const APPEARANCE_DEFAULTS = {
  resultFont: '',
  resultSize: 11,
  resultColor: '#404040',
  resultColorOpacity: 40,
  resultBg: '#ffffff',
  resultBgOpacity: 0,
  btnFont: '',
  btnSize: 14,
  btnColor: '#1a1a1a',
  btnColorOpacity: 25,
  btnBg: '#ffffff',
  btnBgOpacity: 0,
  showFilesStatus: false,
  showModelToast: false,
  showFrameActivity: false,
};

let cache = { ...APPEARANCE_DEFAULTS };

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
    cache = { ...APPEARANCE_DEFAULTS, ...(data && typeof data === 'object' ? data : {}) };
  } catch {
    cache = { ...APPEARANCE_DEFAULTS };
  }
  return cache;
}

export async function saveAppearance(partial) {
  const merged = { ...cache, ...partial };
  cache = merged;
  await api('/me/appearance', { method: 'PUT', body: JSON.stringify(merged) });
  return cache;
}

export function applyAppearance(a) {
  const root = document.documentElement.style;
  root.setProperty('--result-font', a.resultFont || 'inherit');
  root.setProperty('--result-size', `${Number(a.resultSize) || 11}px`);
  root.setProperty('--result-color', hexToRgba(a.resultColor, a.resultColorOpacity ?? 100));
  root.setProperty('--result-bg', hexToRgba(a.resultBg, a.resultBgOpacity ?? 0));
  root.setProperty('--screenshot-font', a.btnFont || 'inherit');
  root.setProperty('--screenshot-size', `${Number(a.btnSize) || 14}px`);
  root.setProperty('--screenshot-color', hexToRgba(a.btnColor, a.btnColorOpacity ?? 100));
  root.setProperty('--screenshot-bg', hexToRgba(a.btnBg, a.btnBgOpacity ?? 0));
}
