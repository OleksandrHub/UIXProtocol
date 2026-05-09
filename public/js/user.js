import { api } from './http.js';

const id = Number(location.pathname.split('/').filter(Boolean)[0]);
if (!Number.isFinite(id)) location.href = '/';

const APPEARANCE_KEY = 'uix.appearance';
const APPEARANCE_DEFAULTS = {
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
  showFilesStatus: true,
  showModelToast: true,
};

function hexToRgba(hex, opacityPct) {
  const a = Math.max(0, Math.min(100, Number(opacityPct ?? 100))) / 100;
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return `rgba(0,0,0,${a})`;
  const r = parseInt(m[1].slice(0, 2), 16);
  const g = parseInt(m[1].slice(2, 4), 16);
  const b = parseInt(m[1].slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

function shortModel(m) {
  if (!m) return '';
  const match = /^gemini-([\d.]+)-(.+?)(-preview)?$/.exec(m);
  if (!match) return m.replace(/^gemini-/, '');
  return `${match[2]}-${match[1]}`;
}

function loadAppearance() {
  try {
    const raw = localStorage.getItem(APPEARANCE_KEY);
    return raw ? { ...APPEARANCE_DEFAULTS, ...JSON.parse(raw) } : { ...APPEARANCE_DEFAULTS };
  } catch {
    return { ...APPEARANCE_DEFAULTS };
  }
}

function applyAppearance(a) {
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

applyAppearance(loadAppearance());

const frame = document.getElementById('frame');
const me = await api('/me').catch(() => null);
const cfg = await api('/config');

if (me && me.id === id) {
  await enterAuthed(me, { fromLogin: false });
} else {
  await initLogin();
}

async function enterAuthed(me, { fromLogin }) {
  document.body.classList.remove('locked');
  const loginForm = document.getElementById('loginForm');
  if (loginForm) loginForm.hidden = true;

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

function initSettings({ me, proxyBase, onFilesChanged, onAppearanceChanged }) {
  const modal = document.getElementById('settings');
  const urlInput = document.getElementById('urlInput');
  const keysInput = document.getElementById('keysInput');
  const passInput = document.getElementById('passInput');
  const settingsError = document.getElementById('settingsError');

  const tabs = document.querySelectorAll('#settingsTabs .tab');
  const panels = document.querySelectorAll('.tab-panel');
  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      tabs.forEach((t) => t.classList.toggle('is-active', t === tab));
      const target = tab.dataset.tab;
      panels.forEach((p) => { p.hidden = p.dataset.panel !== target; });
    });
  });

  const promptsList = document.getElementById('promptsList');
  const promptTpl = document.getElementById('promptItemTpl');
  let prompts = [];
  let activePromptId = '';

  const renderPrompts = () => {
    promptsList.innerHTML = '';
    prompts.forEach((p) => {
      const node = promptTpl.content.firstElementChild.cloneNode(true);
      const radio = node.querySelector('.prompt-active');
      const name = node.querySelector('.prompt-name');
      const text = node.querySelector('.prompt-text');
      const del = node.querySelector('.prompt-delete');
      radio.checked = p.id === activePromptId;
      radio.addEventListener('change', () => {
        if (radio.checked) activePromptId = p.id;
      });
      name.value = p.name;
      name.addEventListener('input', () => { p.name = name.value; });
      text.value = p.text;
      text.addEventListener('input', () => { p.text = text.value; });
      del.addEventListener('click', () => {
        prompts = prompts.filter((x) => x !== p);
        if (activePromptId === p.id) activePromptId = prompts[0]?.id ?? '';
        renderPrompts();
      });
      promptsList.appendChild(node);
    });
  };

  document.getElementById('promptAddBtn').addEventListener('click', () => {
    const id = `p_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    prompts.push({ id, name: 'Новий промт', text: cfg.defaultPrompt ?? '' });
    if (!activePromptId) activePromptId = id;
    renderPrompts();
  });

  const modelsList = document.getElementById('modelsList');
  let enabledModels = [];
  let activeModel = '';

  const renderModels = () => {
    modelsList.innerHTML = '';
    (cfg.knownModels ?? []).forEach((m) => {
      const row = document.createElement('div');
      row.className = 'model-item';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = enabledModels.includes(m);
      cb.addEventListener('change', () => {
        if (cb.checked) {
          if (!enabledModels.includes(m)) enabledModels.push(m);
        } else {
          enabledModels = enabledModels.filter((x) => x !== m);
          if (activeModel === m) activeModel = enabledModels[0] ?? '';
        }
        renderModels();
      });
      const name = document.createElement('span');
      name.className = 'model-name';
      name.textContent = m;
      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = 'activeModel';
      radio.checked = m === activeModel;
      radio.disabled = !enabledModels.includes(m);
      radio.addEventListener('change', () => {
        if (radio.checked) activeModel = m;
      });
      const lbl = document.createElement('span');
      lbl.className = 'active-label';
      lbl.textContent = 'активна';
      row.append(cb, name, radio, lbl);
      modelsList.appendChild(row);
    });
  };

  const filesList = document.getElementById('filesList');
  let files = [];
  const renderFiles = () => {
    filesList.innerHTML = '';
    if (!files.length) {
      const empty = document.createElement('div');
      empty.className = 'file-empty';
      empty.textContent = 'Жодного файлу не прикріплено.';
      filesList.appendChild(empty);
      return;
    }
    files.forEach((f) => {
      const row = document.createElement('div');
      row.className = 'file-item';
      const name = document.createElement('span');
      name.className = 'file-name';
      name.textContent = f.name;
      const size = document.createElement('span');
      size.className = 'file-size';
      size.textContent = `${(f.size / 1024).toFixed(0)} KB`;
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'file-delete';
      del.textContent = '×';
      del.title = 'Видалити';
      del.addEventListener('click', async () => {
        try {
          await api(`/me/files/${f.id}`, { method: 'DELETE' });
          files = files.filter((x) => x.id !== f.id);
          renderFiles();
          onFilesChanged?.();
        } catch (e) {
          settingsError.textContent = e.message;
        }
      });
      row.append(name, size, del);
      filesList.appendChild(row);
    });
  };

  const fileInput = document.getElementById('fileInput');
  document.getElementById('fileAddBtn').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    settingsError.textContent = '';
    for (const file of fileInput.files) {
      try {
        const dataBase64 = await fileToBase64(file);
        const meta = await api('/me/files', {
          method: 'POST',
          body: JSON.stringify({
            name: file.name,
            mime: file.type || 'application/octet-stream',
            dataBase64,
          }),
        });
        files.push(meta);
      } catch (e) {
        settingsError.textContent = e.message;
      }
    }
    fileInput.value = '';
    renderFiles();
    onFilesChanged?.();
  });

  const ap = {
    resultFont: document.getElementById('apResultFont'),
    resultSize: document.getElementById('apResultSize'),
    resultColor: document.getElementById('apResultColor'),
    resultColorOpacity: document.getElementById('apResultColorOpacity'),
    resultBg: document.getElementById('apResultBg'),
    resultBgOpacity: document.getElementById('apResultBgOpacity'),
    btnFont: document.getElementById('apBtnFont'),
    btnSize: document.getElementById('apBtnSize'),
    btnColor: document.getElementById('apBtnColor'),
    btnColorOpacity: document.getElementById('apBtnColorOpacity'),
    btnBg: document.getElementById('apBtnBg'),
    btnBgOpacity: document.getElementById('apBtnBgOpacity'),
    showFilesStatus: document.getElementById('apShowFilesStatus'),
    showModelToast: document.getElementById('apShowModelToast'),
  };
  const apOut = {
    resultColorOpacity: document.getElementById('apResultColorOpacityOut'),
    resultBgOpacity: document.getElementById('apResultBgOpacityOut'),
    btnColorOpacity: document.getElementById('apBtnColorOpacityOut'),
    btnBgOpacity: document.getElementById('apBtnBgOpacityOut'),
  };

  const updateOpacityLabels = () => {
    apOut.resultColorOpacity.textContent = `${ap.resultColorOpacity.value}%`;
    apOut.resultBgOpacity.textContent = `${ap.resultBgOpacity.value}%`;
    apOut.btnColorOpacity.textContent = `${ap.btnColorOpacity.value}%`;
    apOut.btnBgOpacity.textContent = `${ap.btnBgOpacity.value}%`;
  };

  const populateAppearance = (a) => {
    ap.resultFont.value = a.resultFont || '';
    ap.resultSize.value = a.resultSize ?? 11;
    ap.resultColor.value = a.resultColor || '#404040';
    ap.resultColorOpacity.value = a.resultColorOpacity ?? 100;
    ap.resultBg.value = a.resultBg || '#ffffff';
    ap.resultBgOpacity.value = a.resultBgOpacity ?? 0;
    ap.btnFont.value = a.btnFont || '';
    ap.btnSize.value = a.btnSize ?? 14;
    ap.btnColor.value = a.btnColor || '#1a1a1a';
    ap.btnColorOpacity.value = a.btnColorOpacity ?? 100;
    ap.btnBg.value = a.btnBg || '#ffffff';
    ap.btnBgOpacity.value = a.btnBgOpacity ?? 0;
    ap.showFilesStatus.checked = a.showFilesStatus !== false;
    ap.showModelToast.checked = a.showModelToast !== false;
    updateOpacityLabels();
  };

  const collectAppearance = () => ({
    resultFont: ap.resultFont.value.trim(),
    resultSize: Number(ap.resultSize.value) || 11,
    resultColor: ap.resultColor.value,
    resultColorOpacity: Number(ap.resultColorOpacity.value),
    resultBg: ap.resultBg.value,
    resultBgOpacity: Number(ap.resultBgOpacity.value),
    btnFont: ap.btnFont.value.trim(),
    btnSize: Number(ap.btnSize.value) || 14,
    btnColor: ap.btnColor.value,
    btnColorOpacity: Number(ap.btnColorOpacity.value),
    btnBg: ap.btnBg.value,
    btnBgOpacity: Number(ap.btnBgOpacity.value),
    showFilesStatus: ap.showFilesStatus.checked,
    showModelToast: ap.showModelToast.checked,
  });

  Object.entries(ap).forEach(([key, el]) => {
    const handler = () => {
      updateOpacityLabels();
      applyAppearance(collectAppearance());
      if (key === 'showFilesStatus' || key === 'showModelToast') {
        const stored = loadAppearance();
        stored[key] = el.checked;
        localStorage.setItem(APPEARANCE_KEY, JSON.stringify(stored));
        onAppearanceChanged?.();
      }
    };
    el.addEventListener('input', handler);
    el.addEventListener('change', handler);
  });

  document.getElementById('apResetBtn').addEventListener('click', () => {
    populateAppearance(APPEARANCE_DEFAULTS);
    applyAppearance(APPEARANCE_DEFAULTS);
  });

  document.getElementById('settingsBtn').addEventListener('click', async () => {
    urlInput.value = me.targetUrl ?? '';
    keysInput.value = (me.apiKeys ?? []).join('\n');
    passInput.value = '';
    settingsError.textContent = '';

    prompts = (me.prompts ?? []).map((p) => ({ ...p }));
    activePromptId = me.activePromptId ?? '';
    if (!prompts.length) {
      const id = `p_${Date.now()}`;
      prompts = [{ id, name: 'За замовчуванням', text: cfg.defaultPrompt ?? '' }];
      activePromptId = id;
    } else if (!prompts.some((p) => p.id === activePromptId)) {
      activePromptId = prompts[0].id;
    }
    renderPrompts();

    enabledModels = [...(me.enabledModels ?? [])];
    activeModel = me.activeModel ?? '';
    if (!enabledModels.length && cfg.knownModels?.length) {
      enabledModels = ['gemini-2.5-flash'];
      activeModel = 'gemini-2.5-flash';
    }
    if (!activeModel || !enabledModels.includes(activeModel)) {
      activeModel = enabledModels[0] ?? '';
    }
    renderModels();

    try {
      files = await api('/me/files');
    } catch (e) {
      files = [];
      settingsError.textContent = e.message;
    }
    renderFiles();

    populateAppearance(loadAppearance());

    modal.hidden = false;
  });

  document.getElementById('settingsCancel').addEventListener('click', () => {
    modal.hidden = true;
    applyAppearance(loadAppearance());
  });

  document.getElementById('settingsSave').addEventListener('click', async () => {
    settingsError.textContent = '';
    try {
      const newUrl = urlInput.value.trim();
      const newKeys = keysInput.value.split('\n').map((s) => s.trim()).filter(Boolean);
      const newPass = passInput.value;
      let urlChanged = false;
      if (newUrl !== (me.targetUrl ?? '')) {
        await api('/me/url', { method: 'PUT', body: JSON.stringify({ url: newUrl }) });
        me.targetUrl = newUrl;
        urlChanged = true;
      }
      if (JSON.stringify(newKeys) !== JSON.stringify(me.apiKeys)) {
        await api('/me/api-keys', { method: 'PUT', body: JSON.stringify({ apiKeys: newKeys }) });
        me.apiKeys = newKeys;
      }
      if (newPass) {
        await api('/me/password', { method: 'PUT', body: JSON.stringify({ password: newPass }) });
      }

      const cleanedPrompts = prompts.filter((p) => p.text.trim() || p.name.trim());
      if (
        JSON.stringify(cleanedPrompts) !== JSON.stringify(me.prompts ?? []) ||
        activePromptId !== (me.activePromptId ?? '')
      ) {
        const updated = await api('/me/prompts', {
          method: 'PUT',
          body: JSON.stringify({ prompts: cleanedPrompts, activePromptId }),
        });
        me.prompts = updated.prompts;
        me.activePromptId = updated.activePromptId;
      }

      if (
        JSON.stringify(enabledModels) !== JSON.stringify(me.enabledModels ?? []) ||
        activeModel !== (me.activeModel ?? '')
      ) {
        const updated = await api('/me/models', {
          method: 'PUT',
          body: JSON.stringify({ enabledModels, activeModel }),
        });
        me.enabledModels = updated.enabledModels;
        me.activeModel = updated.activeModel;
      }

      const a = collectAppearance();
      localStorage.setItem(APPEARANCE_KEY, JSON.stringify(a));
      applyAppearance(a);

      modal.hidden = true;
      if (urlChanged) frame.src = proxyBase;
    } catch (e) {
      settingsError.textContent = e.message;
    }
  });
}

function initFilesStatus() {
  const wrap = document.getElementById('filesStatus');
  const btn = document.getElementById('filesStatusBtn');
  const iconEl = document.getElementById('filesStatusIcon');
  const textEl = document.getElementById('filesStatusText');
  const closeBtn = document.getElementById('filesStatusClose');
  let lastStatus = null;

  const isVisibleByPrefs = () => loadAppearance().showFilesStatus !== false;

  const setState = (cls) => {
    wrap.classList.remove('is-ready', 'is-pending', 'is-error', 'is-loading');
    if (cls) wrap.classList.add(cls);
  };

  const render = (status) => {
    lastStatus = status;
    if (!status.hasFiles || !isVisibleByPrefs()) {
      wrap.hidden = true;
      return;
    }
    wrap.hidden = false;
    const fileCount = status.files.length;
    const totalSlots = status.totalKeys * fileCount;
    const cachedSlots = status.files.reduce((acc, f) => acc + f.cachedKeys, 0);
    if (status.totalKeys === 0) {
      iconEl.textContent = '📎';
      textEl.textContent = `${fileCount} ф · нема ключів`;
      setState('is-error');
      return;
    }
    if (cachedSlots === totalSlots) {
      iconEl.textContent = '✓';
      textEl.textContent = `${fileCount} ф · готово`;
      setState('is-ready');
    } else if (cachedSlots === 0) {
      iconEl.textContent = '📎';
      textEl.textContent = `${fileCount} ф · не прогріто`;
      setState('is-pending');
    } else {
      iconEl.textContent = '⏳';
      textEl.textContent = `${cachedSlots}/${totalSlots} кешів`;
      setState('is-pending');
    }
  };

  const refresh = async () => {
    try {
      const status = await api('/me/files/status');
      render(status);
    } catch {}
  };

  btn.addEventListener('click', async () => {
    if (btn.disabled) return;
    btn.disabled = true;
    iconEl.textContent = '⟳';
    textEl.textContent = 'прогріваю…';
    setState('is-loading');
    try {
      const result = await api('/me/files/preload', { method: 'POST' });
      await refresh();
      if (result.errors?.length) {
        textEl.textContent = `помилок: ${result.errors.length}`;
        setState('is-error');
      }
    } catch (e) {
      textEl.textContent = `помилка: ${e.message?.slice(0, 30) ?? ''}`;
      setState('is-error');
    } finally {
      btn.disabled = false;
    }
  });

  closeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const a = { ...loadAppearance(), showFilesStatus: false };
    localStorage.setItem(APPEARANCE_KEY, JSON.stringify(a));
    wrap.hidden = true;
  });

  return {
    refresh,
    applyPrefs: () => { if (lastStatus) render(lastStatus); else refresh(); },
  };
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

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function initGemini() {
  const btn = document.getElementById('screenshotBtn');
  const resultEl = document.getElementById('geminiResult');
  const frameEl = document.getElementById('frame');
  let busy = false;
  let hideTimer = null;
  let onAfterSolve = null;

  const showResult = (text) => {
    resultEl.textContent = text;
    resultEl.hidden = false;
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => { resultEl.hidden = true; }, 12000);
  };

  const getFrameWindow = () => {
    let win;
    try { win = frameEl.contentWindow; } catch { win = null; }
    let doc;
    try { doc = win?.document ?? null; } catch { doc = null; }
    if (!win || !doc) {
      throw new Error('iframe недоступний (cross-origin)');
    }
    return { win, doc };
  };

  const ensureHtml2Canvas = async (win) => {
    if (typeof win.html2canvas === 'function') return win.html2canvas;
    if (typeof window.html2canvas === 'function') {
      win.html2canvas = window.html2canvas;
      return win.html2canvas;
    }
    await new Promise((resolve, reject) => {
      const s = win.document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
      s.onload = resolve;
      s.onerror = () => reject(new Error('html2canvas не завантажився'));
      win.document.head.appendChild(s);
    });
    if (typeof win.html2canvas !== 'function') {
      throw new Error('html2canvas не зареєструвався');
    }
    return win.html2canvas;
  };

  const captureFrame = async () => {
    const { win, doc } = getFrameWindow();
    const h2c = await ensureHtml2Canvas(win);
    const root = doc.body || doc.documentElement;
    return h2c(root, {
      useCORS: true,
      allowTaint: true,
      scale: 1,
      x: win.scrollX || 0,
      y: win.scrollY || 0,
      width: win.innerWidth,
      height: win.innerHeight,
      windowWidth: doc.documentElement.scrollWidth,
      windowHeight: doc.documentElement.scrollHeight,
      logging: false,
      backgroundColor: '#ffffff',
    });
  };

  const canvasToBase64Jpeg = (canvas) =>
    new Promise((resolve, reject) => {
      const maxW = 1600;
      let target = canvas;
      if (canvas.width > maxW) {
        const scale = maxW / canvas.width;
        target = document.createElement('canvas');
        target.width = maxW;
        target.height = Math.round(canvas.height * scale);
        target.getContext('2d').drawImage(canvas, 0, 0, target.width, target.height);
      }
      target.toBlob(
        (blob) => {
          if (!blob) return reject(new Error('blob failed'));
          const reader = new FileReader();
          reader.onloadend = () => resolve(String(reader.result).split(',')[1]);
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(blob);
        },
        'image/jpeg',
        0.7
      );
    });

  const triggerGemini = async () => {
    if (busy) return;
    busy = true;
    btn.disabled = true;
    showResult('...');
    try {
      const canvas = await captureFrame();
      const imageBase64 = await canvasToBase64Jpeg(canvas);
      const { answer } = await api('/gemini/solve', {
        method: 'POST',
        body: JSON.stringify({ imageBase64 }),
      });
      showResult(answer || '—');
      onAfterSolve?.();
    } catch (e) {
      showResult('e');
    } finally {
      busy = false;
      btn.disabled = false;
    }
  };

  const toggleResult = () => {
    if (!resultEl.textContent.trim()) return;
    if (resultEl.hidden) {
      resultEl.hidden = false;
      clearTimeout(hideTimer);
      hideTimer = setTimeout(() => { resultEl.hidden = true; }, 12000);
    } else {
      clearTimeout(hideTimer);
      resultEl.hidden = true;
    }
  };

  btn.addEventListener('click', triggerGemini);

  return {
    triggerGemini,
    toggleResult,
    showResult,
    setAfterSolve(cb) { onAfterSolve = cb; },
  };
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

  const form = document.getElementById('loginForm');
  form.hidden = false;
  const pass = document.getElementById('loginPassword');
  pass.maxLength = 1;
  pass.focus();

  let busy = false;

  const showWrong = () => {
    pass.classList.remove('shake', 'wrong');
    void pass.offsetWidth;
    pass.classList.add('wrong', 'shake');
    pass.value = '';
    pass.focus();
  };

  const tryLogin = async (char) => {
    if (busy) return;
    busy = true;
    pass.disabled = true;
    try {
      const user = await api(`/login/${id}/quick`, {
        method: 'POST',
        body: JSON.stringify({ char }),
      });
      pass.value = '';
      await enterAuthed(user, { fromLogin: true });
    } catch {
      pass.disabled = false;
      showWrong();
    } finally {
      busy = false;
    }
  };

  pass.addEventListener('input', () => {
    pass.classList.remove('shake', 'wrong');
    if (pass.value.length === 1) tryLogin(pass.value);
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (pass.value.length === 1) tryLogin(pass.value);
  });
}
