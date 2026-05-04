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
