import { api } from './http.js';

const id = Number(location.pathname.split('/').filter(Boolean)[0]);
if (!Number.isFinite(id)) location.href = '/';

const frame = document.getElementById('frame');
const me = await api('/me').catch(() => null);

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
  const { triggerGemini, toggleResult } = initGemini();

  installShortcuts({ frame, triggerGemini, toggleResult, toggleBar });

  const favicon = document.getElementById('favicon');
  const syncMetaFromFrame = () => {
    try {
      const fdoc = frame.contentDocument;
      if (!fdoc) return;
      const t = fdoc.title && fdoc.title.trim();
      if (t) document.title = t;
      else document.title = me.name;
      if (favicon) {
        const link = fdoc.querySelector('link[rel~="icon"], link[rel="shortcut icon"]');
        if (link && link.href) {
          try {
            const u = new URL(link.href, location.origin);
            if (u.origin === location.origin) {
              favicon.href = '/_p' + u.pathname + u.search;
            } else {
              favicon.href = u.href;
            }
          } catch {}
        } else {
          favicon.href = '/_p/favicon.ico';
        }
      }
    } catch {}
  };
  frame.addEventListener('load', syncMetaFromFrame);

  const cfg = await api('/config');
  frame.setAttribute('allow', cfg.iframePermissions.map((p) => `${p} *`).join('; '));
  const proxyBase = location.origin + cfg.proxyPath;
  if (!fromLogin) frame.src = proxyBase;

  document.getElementById('logoutBtn').addEventListener('click', async () => {
    await api('/logout', { method: 'POST' });
    location.href = '/';
  });

  const modal = document.getElementById('settings');
  const urlInput = document.getElementById('urlInput');
  const keysInput = document.getElementById('keysInput');
  const passInput = document.getElementById('passInput');
  const settingsError = document.getElementById('settingsError');

  document.getElementById('settingsBtn').addEventListener('click', () => {
    urlInput.value = me.targetUrl ?? '';
    keysInput.value = (me.apiKeys ?? []).join('\n');
    passInput.value = '';
    settingsError.textContent = '';
    modal.hidden = false;
  });

  document.getElementById('settingsCancel').addEventListener('click', () => {
    modal.hidden = true;
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
      modal.hidden = true;
      if (urlChanged) frame.src = proxyBase;
    } catch (e) {
      settingsError.textContent = e.message;
    }
  });
}

function initGemini() {
  const btn = document.getElementById('screenshotBtn');
  const resultEl = document.getElementById('geminiResult');
  const frameEl = document.getElementById('frame');
  let busy = false;
  let hideTimer = null;

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
    } catch (e) {
      showResult('Помилка: ' + (e?.message || e));
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

  return { triggerGemini, toggleResult };
}

function installShortcuts({ frame, triggerGemini, toggleResult, toggleBar }) {
  const isTextInput = (el) => {
    if (!el) return false;
    const tag = el.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable;
  };

  const handleKey = (e) => {
    if (!e.altKey || e.ctrlKey || e.metaKey) return;
    if (isTextInput(e.target)) return;
    const k = e.key.toLowerCase();
    if (k !== 'g' && k !== 'h' && k !== 'm') return;
    e.preventDefault();
    e.stopPropagation();
    if (k === 'g') triggerGemini();
    else if (k === 'h') toggleResult();
    else if (k === 'm') toggleBar();
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
