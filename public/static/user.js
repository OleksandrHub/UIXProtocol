import { api } from './http.js';

const id = Number(location.pathname.split('/').filter(Boolean)[0]);
if (!Number.isFinite(id)) location.href = '/';

const frame = document.getElementById('frame');
const me = await api('/me').catch(() => null);

if (me && me.id === id) {
  await initAuthed(me);
} else {
  await initLogin();
}

async function initAuthed(me) {
  const bar = document.getElementById('bar');
  const barTrigger = document.getElementById('barTrigger');
  bar.hidden = false;
  barTrigger.hidden = false;
  document.getElementById('title').textContent = me.name;
  document.getElementById('userName').textContent = me.name;
  if (me.isAdmin) document.getElementById('adminLink').hidden = false;

  barTrigger.addEventListener('mouseenter', () => bar.classList.add('show'));
  bar.addEventListener('mouseleave', () => bar.classList.remove('show'));

  document.getElementById('geminiPanel').hidden = false;
  initGemini();

  const cfg = await api('/config');
  frame.setAttribute('allow', cfg.iframePermissions.map((p) => `${p} *`).join('; '));
  const proxyBase = location.origin + cfg.proxyPath;
  frame.src = proxyBase;

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

  const showResult = (text, isError = false) => {
    resultEl.textContent = text;
    resultEl.classList.toggle('gemini-result--error', isError);
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

  btn.addEventListener('click', async () => {
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
      showResult('Помилка: ' + (e?.message || e), true);
    } finally {
      busy = false;
      btn.disabled = false;
    }
  });
}

async function initLogin() {
  document.body.classList.add('locked');
  frame.src = `/_p/${id}/`;

  const form = document.getElementById('loginForm');
  form.hidden = false;
  const pass = document.getElementById('loginPassword');
  pass.focus();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    pass.classList.remove('shake', 'wrong');
    pass.disabled = true;
    try {
      await api(`/login/${id}`, {
        method: 'POST',
        body: JSON.stringify({ password: pass.value }),
      });
      location.reload();
    } catch {
      pass.disabled = false;
      pass.classList.add('wrong');
      void pass.offsetWidth;
      pass.classList.add('shake');
      pass.select();
    }
  });
}
