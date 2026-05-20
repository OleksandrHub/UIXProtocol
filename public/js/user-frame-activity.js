import { loadAppearance, saveAppearance } from './user-appearance.js';

const PARENT_KEYS = [
  ['document.hidden', () => safe(() => document.hidden)],
  ['document.visibilityState', () => safe(() => document.visibilityState)],
  ['document.webkitHidden', () => safe(() => document.webkitHidden)],
  ['document.webkitVisibilityState', () => safe(() => document.webkitVisibilityState)],
  ['document.mozHidden', () => safe(() => document.mozHidden)],
  ['document.msHidden', () => safe(() => document.msHidden)],
  ['document.hasFocus()', () => safe(() => document.hasFocus())],
  ['document.wasDiscarded', () => safe(() => document.wasDiscarded)],
  ['document.prerendering', () => safe(() => document.prerendering)],
  ['document.activeElement', () => safe(() => tag(document.activeElement))],
  ['navigator.onLine', () => safe(() => navigator.onLine)],
  ['navigator.userActivation.isActive', () => safe(() => navigator.userActivation?.isActive)],
  [
    'navigator.userActivation.hasBeenActive',
    () => safe(() => navigator.userActivation?.hasBeenActive),
  ],
];

function safe(fn) {
  try {
    const v = fn();
    if (v === undefined) return '—';
    if (v === null) return 'null';
    if (typeof v === 'boolean') return v ? 'true' : 'false';
    return String(v);
  } catch {
    return 'err';
  }
}
function tag(el) {
  if (!el) return '—';
  const t = (el.tagName || '').toLowerCase();
  const id = el.id ? `#${el.id}` : '';
  return t + id;
}

function frameKeys(frame) {
  return [
    ['contentDocument', () => safe(() => (frame.contentDocument ? 'ok' : 'null'))],
    ['contentWindow', () => safe(() => (frame.contentWindow ? 'ok' : 'null'))],
    ['__uixKeepActive', () => safe(() => !!frame.contentWindow?.__uixKeepActive)],
    ['document.hidden', () => safe(() => frame.contentDocument?.hidden)],
    ['document.visibilityState', () => safe(() => frame.contentDocument?.visibilityState)],
    ['document.webkitHidden', () => safe(() => frame.contentDocument?.webkitHidden)],
    ['document.mozHidden', () => safe(() => frame.contentDocument?.mozHidden)],
    ['document.hasFocus()', () => safe(() => frame.contentDocument?.hasFocus())],
    ['document.wasDiscarded', () => safe(() => frame.contentDocument?.wasDiscarded)],
    ['document.prerendering', () => safe(() => frame.contentDocument?.prerendering)],
    ['document.activeElement', () => safe(() => tag(frame.contentDocument?.activeElement))],
    ['document.URL (path)', () => safe(() => new URL(frame.contentWindow.location.href).pathname)],
    [
      'navigator.onLine',
      () => safe(() => frame.contentWindow?.navigator?.onLine),
    ],
    [
      'navigator.userActivation.isActive',
      () => safe(() => frame.contentWindow?.navigator?.userActivation?.isActive),
    ],
    [
      'navigator.userActivation.hasBeenActive',
      () => safe(() => frame.contentWindow?.navigator?.userActivation?.hasBeenActive),
    ],
  ];
}

export function initFrameActivity({ frame }) {
  const wrap = document.getElementById('frameActivity');
  const btn = document.getElementById('frameActivityBtn');
  const iconEl = document.getElementById('frameActivityIcon');
  const textEl = document.getElementById('frameActivityText');
  const closeBtn = document.getElementById('frameActivityClose');
  const panelEl = document.getElementById('frameActivityPanel');
  const tableEl = document.getElementById('frameActivityTable');
  if (!wrap || !btn) return { applyPrefs: () => {} };

  const isVisibleByPrefs = () => loadAppearance().showFrameActivity === true;

  const setState = (cls) => {
    wrap.classList.remove('is-ready', 'is-pending', 'is-error', 'is-unknown');
    if (cls) wrap.classList.add(cls);
  };

  const summarize = () => {
    const tabHidden = safe(() => document.hidden) === 'true';
    const tabFocus = safe(() => document.hasFocus()) === 'true';
    let frHidden = '?';
    let frFocus = '?';
    let override = false;
    let frameOk = true;
    try {
      const d = frame.contentDocument;
      const w = frame.contentWindow;
      if (!d || !w) frameOk = false;
      else {
        frHidden = d.hidden === true;
        try { frFocus = d.hasFocus(); } catch {}
        override = !!w.__uixKeepActive;
      }
    } catch {
      frameOk = false;
    }
    return { tabHidden, tabFocus, frHidden, frFocus, override, frameOk };
  };

  const render = () => {
    if (!isVisibleByPrefs()) { wrap.hidden = true; return; }
    wrap.hidden = false;
    const s = summarize();

    if (!s.frameOk) {
      iconEl.textContent = '⛔';
      textEl.textContent = 'iframe недоступний';
      setState('is-unknown');
    } else if (s.tabHidden && s.frHidden === false) {
      iconEl.textContent = '🛡';
      textEl.textContent = `tab: фон · iframe: видим${s.override ? ' · keep-active' : ''}`;
      setState('is-ready');
    } else if (s.tabHidden) {
      iconEl.textContent = '🛌';
      textEl.textContent = `tab: фон · iframe: ${s.frHidden ? 'прих.' : 'видим'}`;
      setState('is-error');
    } else if (!s.tabFocus) {
      iconEl.textContent = '👁';
      textEl.textContent = `tab: видим · без фокусу · iframe: ${s.frFocus ? '✓' : '—'}`;
      setState('is-pending');
    } else {
      iconEl.textContent = s.override ? '🛡' : '✓';
      textEl.textContent = `активний${s.override ? ' · keep-active' : ''}`;
      setState('is-ready');
    }

    if (!panelEl.hidden) renderTable();
  };

  const renderTable = () => {
    const fk = frameKeys(frame);
    const rows = [];
    rows.push('<thead><tr><th colspan="2">Browser tab (parent)</th></tr></thead>');
    rows.push('<tbody>');
    for (const [k, fn] of PARENT_KEYS) {
      rows.push(`<tr><td>${k}</td><td>${fn()}</td></tr>`);
    }
    rows.push('</tbody>');
    rows.push('<thead><tr><th colspan="2">iframe (inside)</th></tr></thead>');
    rows.push('<tbody>');
    for (const [k, fn] of fk) {
      rows.push(`<tr><td>${k}</td><td>${fn()}</td></tr>`);
    }
    rows.push('</tbody>');
    tableEl.innerHTML = rows.join('');
  };

  let pollTimer = null;
  const startPoll = () => {
    if (pollTimer) return;
    pollTimer = setInterval(render, 1000);
  };
  const stopPoll = () => {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  };

  const attachToFrame = () => {
    try {
      const win = frame.contentWindow;
      const doc = frame.contentDocument;
      if (!win || !doc) return;
      ['visibilitychange', 'focus', 'blur', 'pageshow', 'pagehide', 'freeze', 'resume']
        .forEach((t) => win.addEventListener(t, render, true));
      doc.addEventListener('focusin', render, true);
      doc.addEventListener('focusout', render, true);
    } catch {}
  };
  frame.addEventListener('load', () => { attachToFrame(); render(); });
  attachToFrame();

  window.addEventListener('focus', render);
  window.addEventListener('blur', render);
  document.addEventListener('visibilitychange', render);
  window.addEventListener('online', render);
  window.addEventListener('offline', render);

  btn.addEventListener('click', () => {
    panelEl.hidden = !panelEl.hidden;
    if (!panelEl.hidden) renderTable();
  });

  closeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    wrap.hidden = true;
    panelEl.hidden = true;
    saveAppearance({ showFrameActivity: false }).catch(() => {});
    stopPoll();
  });

  const applyPrefs = () => {
    render();
    if (isVisibleByPrefs()) startPoll(); else stopPoll();
  };
  applyPrefs();

  return { applyPrefs };
}
