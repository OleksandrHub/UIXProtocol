import { api } from './http.js';
import {
  APPEARANCE_DEFAULTS,
  applyAppearance,
  fetchAppearance,
} from './user-appearance.js';
import { initGemini } from './user-gemini.js';
import { initFilesStatus } from './user-files-status.js';
import { initSettings } from './user-settings.js';

const id = Number(location.pathname.split('/').filter(Boolean)[0]);
if (!Number.isFinite(id)) location.href = '/';

applyAppearance(APPEARANCE_DEFAULTS);

const frame = document.getElementById('frame');
const me = await api('/me').catch(() => null);
const cfg = await api('/config');

if (me && me.id === id) {
  await enterAuthed(me, { fromLogin: false });
} else {
  await initLogin();
}

function shortModel(m) {
  if (!m) return '';
  const match = /^gemini-([\d.]+)-(.+?)(-preview)?$/.exec(m);
  if (!match) return m.replace(/^gemini-/, '');
  return `${match[2]}-${match[1]}`;
}

function initModelToast() {
  const el = document.getElementById('modelToast');
  let hideTimer = null;
  let fadeTimer = null;
  return (text) => {
    if (loadAppearance().showModelToast === false) return;
    el.textContent = text;
    el.hidden = false;
    el.classList.remove('is-fading');
    clearTimeout(hideTimer);
    clearTimeout(fadeTimer);
    fadeTimer = setTimeout(() => el.classList.add('is-fading'), 1600);
    hideTimer = setTimeout(() => { el.hidden = true; }, 2000);
  };
}

async function enterAuthed(me, { fromLogin }) {
  applyAppearance(await fetchAppearance());

  document.body.classList.remove('locked');
  const prompt = document.getElementById('quicklogin');
  if (prompt) prompt.hidden = true;

  const bar = document.getElementById('bar');
  bar.hidden = false;
  document.getElementById('userName').textContent = me.name;
  if (me.isAdmin) document.getElementById('adminLink').hidden = false;

  const barTrigger = document.getElementById('barTrigger');
  const toggleBar = () => bar.classList.toggle('show');

  if (barTrigger) {
    barTrigger.hidden = false;
    barTrigger.addEventListener('click', toggleBar);
  }

  document.getElementById('geminiPanel').hidden = false;
  const gemini = initGemini();
  const showModelToast = initModelToast();
  const filesStatus = initFilesStatus();
  filesStatus.refresh();
  gemini.setAfterSolve(() => filesStatus.refresh());

  const cycleModel = async () => {
    const enabled = me.enabledModels ?? [];
    if (!enabled.length) {
      showModelToast('немає моделей');
      return;
    }
    if (enabled.length < 2) {
      showModelToast(shortModel(enabled[0]));
      return;
    }
    const current = me.activeModel && enabled.includes(me.activeModel) ? me.activeModel : enabled[0];
    const next = enabled[(enabled.indexOf(current) + 1) % enabled.length];
    me.activeModel = next;
    showModelToast(shortModel(next));
    try {
      await api('/me/active-model', {
        method: 'PUT',
        body: JSON.stringify({ activeModel: next }),
      });
    } catch (e) {
      showModelToast(`помилка: ${e.message}`);
    }
  };

  installShortcuts({
    frame,
    triggerGemini: gemini.triggerGemini,
    toggleResult: gemini.toggleResult,
    toggleBar,
    cycleModel,
  });

  installFavicon(me);

  frame.setAttribute('allow', cfg.iframePermissions.map((p) => `${p} *`).join('; '));
  const proxyBase = location.origin + cfg.proxyPath;
  if (!fromLogin) frame.src = proxyBase;

  document.getElementById('logoutBtn').addEventListener('click', async () => {
    await api('/logout', { method: 'POST' });
    location.href = '/';
  });

  initSettings({
    me,
    cfg,
    frame,
    proxyBase,
    onFilesChanged: () => filesStatus.refresh(),
    onAppearanceChanged: () => filesStatus.applyPrefs(),
  });
}

function installFavicon(me) {
  let faviconLink = document.getElementById('favicon');
  const setFavicon = (href) => {
    const busted = href + (href.includes('?') ? '&' : '?') + '_t=' + Date.now();
    const fresh = document.createElement('link');
    fresh.rel = 'icon';
    fresh.id = 'favicon';
    fresh.href = busted;
    if (faviconLink) faviconLink.replaceWith(fresh);
    else document.head.appendChild(fresh);
    faviconLink = fresh;
  };
  let lastTitle = '';
  let lastFavicon = '';
  const syncMetaFromFrame = () => {
    try {
      const fdoc = frame.contentDocument;
      if (!fdoc) return;
      const t = (fdoc.title || '').trim();
      const nextTitle = t || me.name;
      if (nextTitle !== lastTitle) {
        document.title = nextTitle;
        lastTitle = nextTitle;
      }
      let nextHref = '/_p/favicon.ico';
      const link = fdoc.querySelector('link[rel~="icon"], link[rel="shortcut icon"]');
      if (link && link.href) {
        try {
          const u = new URL(link.href, location.origin);
          nextHref = u.origin === location.origin
            ? '/_p' + u.pathname + u.search
            : u.href;
        } catch {}
      }
      if (nextHref !== lastFavicon) {
        setFavicon(nextHref);
        lastFavicon = nextHref;
      }
    } catch {}
  };
  let metaObserver = null;
  const observeFrameHead = () => {
    if (metaObserver) {
      metaObserver.disconnect();
      metaObserver = null;
    }
    try {
      const fdoc = frame.contentDocument;
      if (!fdoc || !fdoc.head) return;
      metaObserver = new MutationObserver(syncMetaFromFrame);
      metaObserver.observe(fdoc.head, {
        childList: true, subtree: true, characterData: true,
      });
    } catch {}
  };
  frame.addEventListener('load', () => {
    syncMetaFromFrame();
    observeFrameHead();
  });
  syncMetaFromFrame();
  observeFrameHead();
}

function installShortcuts({ frame, triggerGemini, toggleResult, toggleBar, cycleModel }) {
  const isTextInput = (el) => {
    if (!el) return false;
    const tag = el.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable;
  };

  const handleKey = (e) => {
    if (!e.altKey || e.ctrlKey || e.metaKey) return;
    if (isTextInput(e.target)) return;
    const k = (e.key || '').toLowerCase();
    const code = e.code || '';
    const isG = k === 'g' || code === 'KeyG';
    const isH = k === 'h' || code === 'KeyH';
    const isM = k === 'm' || code === 'KeyM';
    const isC = k === 'c' || code === 'KeyC';
    if (!isG && !isH && !isM && !isC) return;
    e.preventDefault();
    e.stopPropagation();
    if (isG) triggerGemini();
    else if (isH) toggleResult();
    else if (isM) toggleBar();
    else if (isC) cycleModel();
  };

  let lastWheel = 0;
  const WHEEL_COOLDOWN = 700;
  const handleWheel = (e) => {
    if (!e.deltaY) return;
    if (!e.ctrlKey && !e.altKey) return;
    e.preventDefault();
    e.stopPropagation();
    const now = Date.now();
    if (now - lastWheel < WHEEL_COOLDOWN) return;
    lastWheel = now;
    if (e.deltaY < 0) triggerGemini();
    else toggleResult();
  };

  window.addEventListener('keydown', handleKey, true);
  window.addEventListener('wheel', handleWheel, { passive: false, capture: true });

  const attachToFrame = () => {
    try {
      const fdoc = frame.contentDocument;
      if (!fdoc) return;
      fdoc.addEventListener('keydown', handleKey, true);
      fdoc.addEventListener('wheel', handleWheel, { passive: false, capture: true });
    } catch {}
  };
  frame.addEventListener('load', attachToFrame);
  attachToFrame();
}

async function initLogin() {
  document.body.classList.add('locked');
  frame.src = `/_p/${id}/`;

  const prompt = document.getElementById('quicklogin');
  prompt.hidden = false;

  let busy = false;

  const showWrong = () => {
    prompt.classList.remove('shake', 'wrong');
    void prompt.offsetWidth;
    prompt.classList.add('wrong', 'shake');
  };

  const tryLogin = async (char) => {
    if (busy) return;
    busy = true;
    prompt.classList.add('is-busy');
    try {
      const user = await api(`/login/${id}/quick`, {
        method: 'POST',
        body: JSON.stringify({ char }),
      });
      await enterAuthed(user, { fromLogin: true });
    } catch {
      showWrong();
    } finally {
      busy = false;
      prompt.classList.remove('is-busy');
    }
  };

  const handleKey = (e) => {
    if (prompt.hidden || busy) return;
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    if (!e.key || e.key.length !== 1) return;
    e.preventDefault();
    e.stopPropagation();
    prompt.classList.remove('wrong', 'shake');
    tryLogin(e.key);
  };

  window.addEventListener('keydown', handleKey, true);

  const attachToFrame = () => {
    try {
      const fdoc = frame.contentDocument;
      if (!fdoc) return;
      fdoc.addEventListener('keydown', handleKey, true);
    } catch {}
  };
  frame.addEventListener('load', attachToFrame);
  attachToFrame();
}
