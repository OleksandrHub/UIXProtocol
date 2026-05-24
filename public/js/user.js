import { api } from './http.js';
import {
  APPEARANCE_DEFAULTS,
  applyAppearance,
  cycleVariant,
  fetchAppearance,
  loadAppearance,
} from './user-appearance.js';
import { initGemini } from './user-gemini.js';
import { initFilesStatus } from './user-files-status.js';
import { initFrameActivity } from './user-frame-activity.js';
import { initSettings } from './user-settings.js';
import { initArchive } from './user-archive.js';
import { initFriends } from './user-friends.js';

const id = Number(location.pathname.split('/').filter(Boolean)[0]);
if (!Number.isFinite(id)) location.href = '/';

applyAppearance(APPEARANCE_DEFAULTS);

const frame = document.getElementById('frame');
const [me, cfg] = await Promise.all([
  api('/me').catch(() => null),
  api('/config'),
]);

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
    if (loadAppearance().showModelToast !== true) return;
    el.textContent = text;
    el.hidden = false;
    el.classList.remove('is-fading');
    clearTimeout(hideTimer);
    clearTimeout(fadeTimer);
    fadeTimer = setTimeout(() => el.classList.add('is-fading'), 1600);
    hideTimer = setTimeout(() => { el.hidden = true; }, 2000);
  };
}

// Persistent toast for the active helper's name. Visible only while
// friend mode is on; styled via --friend-toast-* CSS variables.
function initFriendToast() {
  const el = document.getElementById('friendToast');
  return {
    show(name) {
      if (!el) return;
      el.textContent = name ? `друг: ${name}` : 'режим друга';
      el.hidden = false;
    },
    hide() {
      if (!el) return;
      el.hidden = true;
      el.textContent = '';
    },
  };
}

async function enterAuthed(me, { fromLogin }) {
  applyAppearance(await fetchAppearance());

  document.body.classList.remove('locked');
  const prompt = document.getElementById('quicklogin');
  if (prompt) prompt.hidden = true;
  const quickInput = document.getElementById('quickloginInput');
  if (quickInput) {
    quickInput.blur();
    quickInput.value = '';
  }

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
  const friendToast = initFriendToast();
  const filesStatus = initFilesStatus();
  filesStatus.refresh();
  const frameActivity = initFrameActivity({ frame });
  gemini.setAfterSolve(() => filesStatus.refresh());

  const friendToggleBtn = document.getElementById('friendToggleBtn');
  const screenshotBtnEl = document.getElementById('screenshotBtn');
  // Reveal floating Д button on first paint — CSS hides it on desktop, so
  // it's only ever clickable on mobile.
  if (friendToggleBtn) friendToggleBtn.hidden = false;

  const friends = initFriends({
    me,
    geminiResultEl: document.getElementById('geminiResult'),
    onModeChange: (m, helperName) => {
      const isFriend = m === 'friend';
      // Friend toggle button is only an "enter" trigger — exit lives in
      // Settings (per spec 3.3). So we hide the button entirely once mode is
      // on, and re-show it on exit.
      if (friendToggleBtn) friendToggleBtn.hidden = isFriend;
      if (screenshotBtnEl) {
        screenshotBtnEl.title = isFriend
          ? `Скріншот → ${helperName ?? 'помічник'}`
          : 'Скріншот → Gemini';
      }
      if (isFriend) friendToast.show(helperName);
      else friendToast.hide();
    },
    showHint: (text) => showModelToast(text),
  });
  if (friendToggleBtn) {
    friendToggleBtn.addEventListener('click', () => friends.enableMode());
  }

  // S-кнопка / Alt+G / wheel-up: Gemini в normal-режимі, screenshot до друга в friend-режимі.
  const triggerScreenshot = () => {
    if (friends.getMode() === 'friend') friends.triggerScreenshot();
    else gemini.triggerGemini();
  };
  if (gemini.button) gemini.button.addEventListener('click', triggerScreenshot);

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

  const cycleVariantHotkey = async () => {
    try {
      const v = await cycleVariant();
      if (v) showModelToast(`вигляд: ${v.name}`);
      else showModelToast('варіантів немає');
    } catch (e) {
      showModelToast(`помилка: ${e.message}`);
    }
  };

  installShortcuts({
    frame,
    triggerGemini: triggerScreenshot,
    toggleResult: gemini.toggleResult,
    toggleBar,
    cycleModel,
    toggleFriendMode: friends.enableMode,
    cycleVariant: cycleVariantHotkey,
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
    onAppearanceChanged: () => {
      filesStatus.applyPrefs();
      frameActivity.applyPrefs();
    },
    onTabShown: (panel) => {
      if (panel === 'friends') {
        const root = document.getElementById('friendsPanel');
        if (root) friends.refreshFriendsPanel(root);
      }
    },
  });

  initArchive({ me });
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
      const isRelevant = (m) => {
        if (m.type === 'attributes') return m.attributeName === 'href';
        if (m.type === 'characterData') {
          return m.target?.parentNode?.nodeName === 'TITLE';
        }
        if (m.type === 'childList') {
          const all = [...m.addedNodes, ...m.removedNodes];
          return all.some(
            (n) => n.nodeName === 'TITLE' || (n.nodeName === 'LINK' && /icon/i.test(n.rel || '')),
          );
        }
        return false;
      };
      metaObserver = new MutationObserver((mutations) => {
        if (mutations.some(isRelevant)) syncMetaFromFrame();
      });
      metaObserver.observe(fdoc.head, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
        attributeFilter: ['href'],
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

function installShortcuts({
  frame,
  triggerGemini,
  toggleResult,
  toggleBar,
  cycleModel,
  toggleFriendMode,
  cycleVariant,
}) {
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
    const isF = k === 'f' || code === 'KeyF';
    const isV = k === 'v' || code === 'KeyV';
    if (!isG && !isH && !isM && !isC && !isF && !isV) return;
    e.preventDefault();
    e.stopPropagation();
    if (isG) triggerGemini();
    else if (isH) toggleResult();
    else if (isM) toggleBar();
    else if (isC) cycleModel();
    else if (isF) toggleFriendMode?.();
    else if (isV) cycleVariant?.();
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
  const input = document.getElementById('quickloginInput');
  prompt.hidden = false;
  if (input) input.value = '';

  let busy = false;
  let lastAttemptAt = 0;
  const MIN_GAP_MS = 100;

  const showWrong = () => {
    prompt.classList.remove('shake', 'wrong');
    void prompt.offsetWidth;
    prompt.classList.add('wrong', 'shake');
  };

  const tryLogin = async (char) => {
    if (busy) return;
    const now = Date.now();
    if (now - lastAttemptAt < MIN_GAP_MS) return;
    lastAttemptAt = now;
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
      if (input) input.value = '';
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

  if (input) {
    input.addEventListener('input', () => {
      if (prompt.hidden || busy) {
        input.value = '';
        return;
      }
      const v = input.value;
      input.value = '';
      if (!v) return;
      const char = Array.from(v)[0];
      if (!char) return;
      prompt.classList.remove('wrong', 'shake');
      tryLogin(char);
    });

    prompt.addEventListener('click', () => {
      if (prompt.hidden || busy) return;
      input.focus();
    });
  }

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
