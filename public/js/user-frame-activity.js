import { loadAppearance, saveAppearance } from './user-appearance.js';

export function initFrameActivity({ frame }) {
  const wrap = document.getElementById('frameActivity');
  const btn = document.getElementById('frameActivityBtn');
  const iconEl = document.getElementById('frameActivityIcon');
  const textEl = document.getElementById('frameActivityText');
  const closeBtn = document.getElementById('frameActivityClose');
  if (!wrap || !btn) return { applyPrefs: () => {} };

  const isVisibleByPrefs = () => loadAppearance().showFrameActivity === true;

  const setState = (cls) => {
    wrap.classList.remove('is-ready', 'is-pending', 'is-error', 'is-unknown');
    if (cls) wrap.classList.add(cls);
  };

  const readState = () => {
    let doc = null;
    let win = null;
    try { doc = frame.contentDocument; } catch {}
    try { win = frame.contentWindow; } catch {}
    if (!doc || !win) return { kind: 'cross' };
    let hasFocus = false;
    try { hasFocus = doc.hasFocus(); } catch {}
    const active = doc.activeElement;
    const activeTag = active && active.tagName ? active.tagName.toLowerCase() : '';
    const url = (() => {
      try { return win.location?.pathname || ''; } catch { return ''; }
    })();
    return {
      kind: 'ok',
      hidden: !!doc.hidden,
      visState: String(doc.visibilityState ?? ''),
      hasFocus,
      activeTag,
      url,
    };
  };

  const render = () => {
    if (!isVisibleByPrefs()) { wrap.hidden = true; return; }
    wrap.hidden = false;
    const st = readState();
    if (st.kind === 'cross') {
      iconEl.textContent = '⛔';
      textEl.textContent = 'iframe недоступний';
      setState('is-unknown');
      return;
    }
    if (st.hidden) {
      iconEl.textContent = '🛌';
      textEl.textContent = `прихований · ${st.visState}`;
      setState('is-error');
      return;
    }
    if (!st.hasFocus) {
      iconEl.textContent = '👁';
      textEl.textContent = 'видимий · без фокусу';
      setState('is-pending');
      return;
    }
    iconEl.textContent = '✓';
    textEl.textContent = `активний · ${st.activeTag || 'body'}`;
    setState('is-ready');
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
      const t = ['visibilitychange', 'focus', 'blur', 'pageshow', 'pagehide'];
      t.forEach((type) => win.addEventListener(type, render, true));
      doc.addEventListener('visibilitychange', render, true);
      doc.addEventListener('focusin', render, true);
      doc.addEventListener('focusout', render, true);
    } catch {}
  };
  frame.addEventListener('load', () => { attachToFrame(); render(); });
  attachToFrame();

  window.addEventListener('focus', render);
  window.addEventListener('blur', render);
  document.addEventListener('visibilitychange', render);

  btn.addEventListener('click', () => {
    try { frame.contentWindow?.focus(); } catch {}
    render();
  });

  closeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    wrap.hidden = true;
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
